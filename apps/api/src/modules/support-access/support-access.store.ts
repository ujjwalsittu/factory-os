// Audited support access (decision 050): consent state, authority revisions and lock order.
// Lock order everywhere: user epochs (key order) → tenant policy → grant. Source rows are never locked here; they are
// read as committed and compared through the revisions the source triggers bump in their own transactions.
import { createHmac } from 'node:crypto';
import {
  effectivePermissions,
  type ScopedGrant,
  SUPPORT_AREAS,
  SUPPORT_MAX_DURATION_SECONDS,
  SUPPORT_READ_CATALOG,
  type SupportApprovalInput,
  type SupportArea,
  type SupportEventKind,
  type SupportGrantPage,
  type SupportGrantSummary,
  type SupportHistoryEntry,
  type SupportIdentity,
  type SupportListQuery,
  type SupportPolicy,
  type SupportState,
} from '@factoryos/auth';
import { type Database, supportAccessEvent, supportAccessGrant, supportAccessPolicy } from '@factoryos/db';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RequestContext, TenantRequestContext } from '../../common/access.js';
import type { AuditService } from '../../common/audit.service.js';
import { CONFIG, DB } from '../../common/tokens.js';
import type { AppConfig } from '../../config.js';
import type { SupportEvidence, SupportProof, SupportReadAuthority, SupportScope, SupportTx } from './support-access.types.js';

export type SupportGrantRecord = typeof supportAccessGrant.$inferSelect;
export const CONTROL_BUDGET_MS = 5000;

/** Thrown for every refusal; the code is the only thing a caller ever sees. */
export class SupportError extends Error {
  constructor(
    readonly code: 'SUPPORT_UNAVAILABLE' | 'SUPPORT_REAUTHENTICATE' | 'SUPPORT_ENDED' | 'SUPPORT_INVALID_INPUT' | 'SUPPORT_NOT_FOUND' | 'SUPPORT_CONFLICT',
    readonly reasonCode: string | null = null,
  ) {
    super(code);
  }
}

type Assessed = { state: SupportState; reasonCode: string | null };
const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
/** A text[] parameter: drizzle would otherwise expand a JS array into a parameter list. */
const uuidArray = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::uuid[]`;
const textArray = (values: string[]) => (values.length ? sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]` : sql`array[]::text[]`);

@Injectable()
export class SupportAccessStore {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * A bounded control transaction: lock and statement waits never exceed what is left of the overall budget, so
   * several statements cannot add up past it either. Callers re-read the database clock after any wait.
   */
  async control<T>(fn: (tx: SupportTx, budget: () => Promise<void>) => Promise<T>): Promise<T> {
    const deadline = Date.now() + CONTROL_BUDGET_MS;
    return this.db.transaction(async (tx) => {
      const budget = async () => {
        const left = deadline - Date.now();
        if (left <= 50) throw new SupportError('SUPPORT_UNAVAILABLE', 'timeout');
        await tx.execute(sql.raw(`set local lock_timeout = ${left}; set local statement_timeout = ${left}`));
      };
      await budget();
      return fn(tx, budget);
    });
  }

  /** Locks a grant and everything it depends on, in the canonical order, and checks it is usable right now. */
  async withAuthority<T>(actor: RequestContext, grantId: string, fn: (tx: SupportTx, authority: SupportReadAuthority) => Promise<T>): Promise<T> {
    return this.control(async (tx, budget) => {
      const row = await this.lockGrant(tx, grantId, budget);
      if (!row || row.operatorUserId !== actor.user.id) throw new SupportError('SUPPORT_NOT_FOUND');
      const assessed = await this.assess(tx, row);
      if (assessed.state !== 'active') {
        await this.observeTerminal(tx, row, assessed);
        throw new SupportError('SUPPORT_ENDED', assessed.reasonCode);
      }
      if (row.actorSessionId !== actor.sessionId) throw new SupportError('SUPPORT_REAUTHENTICATE', 'session-mismatch');
      const scope = await this.currentScope(tx, row.subjectMembershipId, row.tenantId, row.entityId);
      if (scope.subjectUserId !== row.subjectUserId) throw new SupportError('SUPPORT_ENDED', 'subject-changed');
      return fn(tx, { grant: await this.summary(tx, row, assessed), scope, actorSessionId: row.actorSessionId! });
    });
  }

  /** Canonical lock order for one grant: participant epochs, then the tenant policy, then the grant row. */
  async lockGrant(tx: SupportTx, grantId: string, budget?: () => Promise<void>): Promise<SupportGrantRecord | null> {
    const [peek] = rows<{ tenant_id: string; operator_user_id: string; subject_user_id: string; approver_user_id: string }>(
      await tx.execute(sql`select tenant_id, operator_user_id, subject_user_id, approver_user_id from support_access_grant where id = ${grantId}`),
    );
    if (!peek) return null;
    await budget?.();
    await this.lockUsers(tx, [peek.operator_user_id, peek.subject_user_id, peek.approver_user_id]);
    await tx.execute(sql`select 1 from support_access_policy where tenant_id = ${peek.tenant_id} for update`);
    const [row] = await tx.select().from(supportAccessGrant).where(sql`${supportAccessGrant.id} = ${grantId}`).for('update');
    return row ?? null;
  }

  async lockUsers(tx: SupportTx, userIds: string[]) {
    const ids = [...new Set(userIds)].sort();
    await tx.execute(sql`select 1 from support_access_user_epoch where user_id = any(${textArray(ids)}) order by user_id for update`);
  }

  /** Derives the state from immutable deadlines and current revisions; no worker is needed. */
  async assess(tx: SupportTx, row: SupportGrantRecord): Promise<Assessed> {
    if (row.endedAt) return { state: row.endKind as SupportState, reasonCode: row.endReason };
    const [now] = rows<{ now: string }>(await tx.execute(sql`select clock_timestamp() as now`));
    const at = new Date(now!.now).getTime();
    if (!row.startedAt && at > row.startBy.getTime()) return { state: 'expired', reasonCode: 'not-started' };
    if (row.startedAt && at >= row.expiresAt!.getTime()) return { state: 'expired', reasonCode: 'deadline' };
    if (!this.config.supportAccess.enabled) return { state: 'invalidated', reasonCode: 'deployment-disabled' };
    const [policy] = rows<{ enabled: boolean; config_revision: string; authority_revision: string }>(
      await tx.execute(sql`select enabled, config_revision::text, authority_revision::text from support_access_policy where tenant_id = ${row.tenantId}`),
    );
    if (!policy || !policy.enabled || policy.config_revision !== String(row.policyConfigRevision)) return { state: 'invalidated', reasonCode: 'policy-changed' };
    if (policy.authority_revision !== String(row.tenantAuthorityRevision)) return { state: 'invalidated', reasonCode: 'authority-changed' };
    const epochs = new Map(
      rows<{ user_id: string; security_epoch: string }>(
        await tx.execute(
          sql`select user_id, security_epoch::text from support_access_user_epoch where user_id = any(${textArray([row.operatorUserId, row.subjectUserId, row.approverUserId])})`,
        ),
      ).map((e) => [e.user_id, e.security_epoch]),
    );
    for (const [id, captured] of [
      [row.operatorUserId, row.operatorEpoch],
      [row.subjectUserId, row.subjectEpoch],
      [row.approverUserId, row.approverEpoch],
    ] as const)
      if (epochs.get(id) !== String(captured)) return { state: 'invalidated', reasonCode: 'security-changed' };
    if (!row.startedAt) return { state: 'approved', reasonCode: null };
    const [session] = rows<{ ok: boolean }>(
      await tx.execute(sql`select expires_at > clock_timestamp() as ok from session where id = ${row.actorSessionId} and user_id = ${row.operatorUserId}`),
    );
    if (!session?.ok) return { state: 'invalidated', reasonCode: 'actor-session-ended' };
    return { state: 'active', reasonCode: null };
  }

  /** Records an observed terminal state once; repeating it changes nothing. */
  async observeTerminal(tx: SupportTx, row: SupportGrantRecord, assessed: Assessed) {
    if (row.endedAt || !['expired', 'invalidated'].includes(assessed.state)) return;
    const ended = rows<{ id: string }>(
      await tx.execute(
        sql`update support_access_grant set ended_at = clock_timestamp(), end_kind = ${assessed.state}, end_reason = ${assessed.reasonCode} where id = ${row.id} and ended_at is null returning id`,
      ),
    );
    if (ended.length)
      await tx.insert(supportAccessEvent).values({
        tenantId: row.tenantId,
        grantId: row.id,
        kind: assessed.state as SupportEventKind,
        operatorUserId: row.operatorUserId,
        subjectUserId: row.subjectUserId,
        reasonCode: assessed.reasonCode,
      });
  }

  /**
   * The subject's current authority in the approved entity, computed from role assignments only: no owner or
   * platform shortcut. Refuses an inactive membership, tenant or entity, and any subject with a platform role.
   */
  async currentScope(tx: SupportTx, membershipId: string, tenantId: string, entityId: string): Promise<SupportScope> {
    const [m] = rows<{ user_id: string; status: string; tenant_status: string }>(
      await tx.execute(
        sql`select m.user_id, m.status, t.status as tenant_status from membership m join tenant t on t.id = m.tenant_id where m.id = ${membershipId} and m.tenant_id = ${tenantId}`,
      ),
    );
    if (!m || m.status !== 'active' || m.tenant_status !== 'active') throw new SupportError('SUPPORT_ENDED', 'subject-unavailable');
    const [entity] = rows<{ ok: boolean }>(await tx.execute(sql`select is_active as ok from legal_entity where id = ${entityId} and tenant_id = ${tenantId}`));
    if (!entity?.ok) throw new SupportError('SUPPORT_ENDED', 'entity-unavailable');
    const [admin] = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from platform_admin where user_id = ${m.user_id}`));
    if (admin!.n > 0) throw new SupportError('SUPPORT_ENDED', 'subject-platform-admin');
    const grants: ScopedGrant[] = rows<{ permissions: string[]; entity_ids: string[] | null }>(
      await tx.execute(sql`select r.permissions, a.entity_ids from role_assignment a join role r on r.id = a.role_id where a.membership_id = ${membershipId} and a.tenant_id = ${tenantId} and r.tenant_id = ${tenantId}`),
    ).map((g) => ({ permissions: g.permissions, entityIds: g.entity_ids }));
    const all = effectivePermissions(grants, entityId);
    // Only the catalogued read permissions ever leave this function.
    const permissions = new Set(Object.values(SUPPORT_READ_CATALOG).filter((p) => all.has(p)));
    return { tenantId, entityId, membershipId, subjectUserId: m.user_id, permissions };
  }

  /** Public DTO. Private revisions, proof versions and session IDs never appear here. */
  async summary(tx: SupportTx, row: SupportGrantRecord, assessed?: Assessed): Promise<SupportGrantSummary> {
    const state = assessed ?? (await this.assess(tx, row));
    const ids = [row.operatorUserId, row.subjectUserId, row.approverUserId];
    const people = new Map(
      rows<SupportIdentity>(await tx.execute(sql`select id, name, email from "user" where id = any(${textArray(ids)})`)).map((u) => [u.id, u]),
    );
    const person = (id: string): SupportIdentity => people.get(id) ?? { id, name: 'Removed user', email: '' };
    const [names] = rows<{ tenant: string | null; entity: string | null }>(
      await tx.execute(
        sql`select (select name from tenant where id = ${row.tenantId}) as tenant, (select short_name from legal_entity where id = ${row.entityId} and tenant_id = ${row.tenantId}) as entity`,
      ),
    );
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: names?.tenant ?? '',
      entityId: row.entityId,
      entityName: names?.entity ?? '',
      operator: person(row.operatorUserId),
      subject: person(row.subjectUserId),
      approver: person(row.approverUserId),
      areas: row.areas as SupportArea[],
      reason: row.reason,
      durationSeconds: row.durationSeconds,
      approvedAt: row.approvedAt.toISOString(),
      startBy: row.startBy.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      state: state.state,
    };
  }

  async appendEvent(tx: SupportTx, actor: RequestContext | null, grantId: string | null, tenantId: string, scope: SupportScope | null, evidence: SupportEvidence & { operatorUserId?: string | null; subjectUserId?: string | null }) {
    await tx.insert(supportAccessEvent).values({
      tenantId,
      grantId,
      kind: evidence.kind,
      actorUserId: actor?.user.id ?? null,
      subjectUserId: scope?.subjectUserId ?? evidence.subjectUserId ?? null,
      operatorUserId: evidence.operatorUserId ?? null,
      area: evidence.area,
      reasonCode: evidence.reasonCode,
    });
  }

  /** Creates the participant's epoch row if missing (it starts at 0); later authority changes then bump it. */
  async seedEpochs(tx: SupportTx | Database, userIds: string[]) {
    const ids = [...new Set(userIds)].sort();
    await tx.execute(sql`insert into support_access_user_epoch (user_id) select unnest(${textArray(ids)}) order by 1 on conflict (user_id) do nothing`);
  }

  /**
   * Snapshot taken before the native password check: the user's security epoch and a server HMAC of the stored
   * credential. Neither is ever returned to a client; the HMAC key is derived from the auth secret for this use only.
   */
  async captureProofVersion(actor: RequestContext): Promise<SupportProof> {
    await this.seedEpochs(this.db, [actor.user.id]);
    const [r] = rows<{ epoch: string; password: string | null }>(
      await this.db.execute(
        sql`select e.security_epoch::text as epoch, (select password from account where user_id = ${actor.user.id} and provider_id = 'credential' limit 1) as password from support_access_user_epoch e where e.user_id = ${actor.user.id}`,
      ),
    );
    if (!r?.password) throw new SupportError('SUPPORT_REAUTHENTICATE', 'no-password');
    return { userId: actor.user.id, sessionId: actor.sessionId, securityEpoch: r.epoch, passwordVersion: this.passwordVersion(actor.user.id, r.password) };
  }

  /**
   * Re-checks a proof under the caller's locks, at database time: the same native session, still completed (no
   * pending SSO/passkey/factor challenge) and created less than 300 seconds ago; a verified email and an enabled,
   * verified local TOTP factor; and the same security epoch and credential version as before the password check.
   */
  async checkProof(tx: SupportTx, proof: SupportProof) {
    const [r] = rows<{ epoch: string | null; password: string | null; session_ok: boolean | null; fresh: boolean | null; verified: boolean | null; totp: boolean | null }>(
      await tx.execute(
        sql`select (select security_epoch::text from support_access_user_epoch where user_id = ${proof.userId}) as epoch,
                   (select password from account where user_id = ${proof.userId} and provider_id = 'credential' limit 1) as password,
                   (select expires_at > clock_timestamp() and not sso_pending and not passkey_pending from session where id = ${proof.sessionId} and user_id = ${proof.userId}) as session_ok,
                   (select created_at <= clock_timestamp() and created_at > clock_timestamp() - interval '300 seconds' from session where id = ${proof.sessionId}) as fresh,
                   (select email_verified from "user" where id = ${proof.userId}) as verified,
                   (select coalesce(u.two_factor_enabled, false) and exists (select 1 from two_factor t where t.user_id = u.id and coalesce(t.verified, true)) from "user" u where u.id = ${proof.userId}) as totp`,
      ),
    );
    if (!r?.session_ok || !r.fresh) throw new SupportError('SUPPORT_REAUTHENTICATE', 'sign-in-again');
    if (!r.verified) throw new SupportError('SUPPORT_REAUTHENTICATE', 'email-unverified');
    if (!r.totp) throw new SupportError('SUPPORT_REAUTHENTICATE', 'totp-required');
    if (r.epoch !== proof.securityEpoch || !r.password || this.passwordVersion(proof.userId, r.password) !== proof.passwordVersion)
      throw new SupportError('SUPPORT_REAUTHENTICATE', 'credentials-changed');
  }

  // ── tenant policy ──

  async getPolicy(tenantId: string): Promise<SupportPolicy> {
    const [p] = await this.db.select().from(supportAccessPolicy).where(sql`${supportAccessPolicy.tenantId} = ${tenantId}`);
    return p ? { enabled: p.enabled, maxDurationSeconds: p.maxDurationSeconds, allowedAreas: p.allowedAreas as SupportArea[] } : { enabled: false, maxDurationSeconds: SUPPORT_MAX_DURATION_SECONDS, allowedAreas: [...SUPPORT_AREAS] };
  }

  /** Every change, including a relaxing one, bumps the configuration revision and so ends all earlier consent. */
  async setPolicy(actor: TenantRequestContext, input: SupportPolicy, proof: SupportProof | null, audit: AuditService): Promise<SupportPolicy> {
    if (input.enabled && !proof) throw new SupportError('SUPPORT_REAUTHENTICATE', 'password');
    if (input.enabled && !this.config.supportAccess.enabled) throw new SupportError('SUPPORT_UNAVAILABLE', 'deployment-disabled');
    const tenantId = actor.tenant.tenantId;
    return this.control(async (tx, budget) => {
      if (proof) {
        await this.seedEpochs(tx, [proof.userId]);
        await this.lockUsers(tx, [proof.userId]);
      }
      await budget();
      const prior = await this.getPolicyIn(tx, tenantId, true);
      // Private revisions never reach audit payloads.
      const before = prior.exists ? { enabled: prior.enabled, maxDurationSeconds: prior.maxDurationSeconds, allowedAreas: prior.allowedAreas } : null;
      if (proof) await this.checkProof(tx, proof);
      const values = { enabled: input.enabled, maxDurationSeconds: input.maxDurationSeconds, allowedAreas: input.allowedAreas, updatedBy: actor.user.id, updatedAt: new Date() };
      await tx
        .insert(supportAccessPolicy)
        .values({ tenantId, ...values, configRevision: 1n })
        .onConflictDoUpdate({ target: supportAccessPolicy.tenantId, set: { ...values, configRevision: sql`${supportAccessPolicy.configRevision} + 1` } });
      await this.appendEvent(tx, actor, null, tenantId, null, { kind: 'policy-changed', area: null, reasonCode: input.enabled ? 'enabled' : 'disabled' });
      const after = { enabled: input.enabled, maxDurationSeconds: input.maxDurationSeconds, allowedAreas: input.allowedAreas };
      await audit.record(actor, { action: 'settings.support_access.configure', targetType: 'support_access_policy', targetId: tenantId, tenantId, before, after }, tx);
      return after;
    });
  }

  private async getPolicyIn(tx: SupportTx, tenantId: string, lock: boolean): Promise<SupportPolicy & { exists: boolean; configRevision: bigint; authorityRevision: bigint }> {
    const q = tx.select().from(supportAccessPolicy).where(sql`${supportAccessPolicy.tenantId} = ${tenantId}`);
    const [p] = await (lock ? q.for('update') : q);
    if (!p) return { exists: false, enabled: false, maxDurationSeconds: SUPPORT_MAX_DURATION_SECONDS, allowedAreas: [...SUPPORT_AREAS], configRevision: 0n, authorityRevision: 0n };
    return { exists: true, enabled: p.enabled, maxDurationSeconds: p.maxDurationSeconds, allowedAreas: p.allowedAreas as SupportArea[], configRevision: p.configRevision, authorityRevision: p.authorityRevision };
  }

  // ── consent ──

  /**
   * Creates one immutable, fully scoped consent. The operator is found by exact email among current platform
   * operators only; every refusal about the operator is the same generic answer, so this is not a directory.
   */
  async approve(actor: TenantRequestContext, input: SupportApprovalInput, proof: SupportProof, audit: AuditService): Promise<SupportGrantSummary> {
    if (!this.config.supportAccess.enabled) throw new SupportError('SUPPORT_UNAVAILABLE', 'deployment-disabled');
    if (proof.userId !== actor.user.id || proof.sessionId !== actor.sessionId) throw new SupportError('SUPPORT_REAUTHENTICATE', 'session-mismatch');
    const tenantId = actor.tenant.tenantId;
    const [operator] = rows<{ id: string }>(
      await this.db.execute(
        sql`select u.id from "user" u join platform_admin p on p.user_id = u.id where lower(u.email) = ${input.operatorEmail} and p.level in ('superadmin', 'support')`,
      ),
    );
    if (!operator || operator.id === actor.user.id) throw new SupportError('SUPPORT_UNAVAILABLE', 'operator');
    const [target] = rows<{ user_id: string }>(
      await this.db.execute(sql`select user_id from membership where id = ${input.targetMembershipId} and tenant_id = ${tenantId}`),
    );
    if (!target || target.user_id === operator.id) throw new SupportError('SUPPORT_UNAVAILABLE', 'target');
    const people = [operator.id, target.user_id, actor.user.id];
    await this.seedEpochs(this.db, people);
    return this.control(async (tx, budget) => {
      await this.lockUsers(tx, people);
      await budget();
      const policy = await this.getPolicyIn(tx, tenantId, true);
      if (!policy.exists || !policy.enabled) throw new SupportError('SUPPORT_UNAVAILABLE', 'policy-disabled');
      if (input.durationSeconds > policy.maxDurationSeconds || input.areas.some((a) => !policy.allowedAreas.includes(a))) throw new SupportError('SUPPORT_INVALID_INPUT', 'outside-policy');
      await this.checkProof(tx, proof);
      // The operator must still be a platform operator, now, under the epoch lock.
      const [op] = rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from platform_admin where user_id = ${operator.id} and level in ('superadmin', 'support')`));
      if (!op!.n) throw new SupportError('SUPPORT_UNAVAILABLE', 'operator');
      const scope = await this.currentScope(tx, input.targetMembershipId, tenantId, input.entityId).catch(() => {
        throw new SupportError('SUPPORT_UNAVAILABLE', 'target');
      });
      if (input.areas.some((a) => !scope.permissions.has(SUPPORT_READ_CATALOG[a]))) throw new SupportError('SUPPORT_INVALID_INPUT', 'target-lacks-permission');
      const epochs = new Map(
        rows<{ user_id: string; security_epoch: string }>(await tx.execute(sql`select user_id, security_epoch::text from support_access_user_epoch where user_id = any(${textArray(people)})`)).map((e) => [e.user_id, BigInt(e.security_epoch)]),
      );
      const [row] = await tx
        .insert(supportAccessGrant)
        .values({
          tenantId,
          entityId: input.entityId,
          operatorUserId: operator.id,
          subjectUserId: target.user_id,
          subjectMembershipId: input.targetMembershipId,
          approverUserId: actor.user.id,
          areas: input.areas,
          reason: input.reason,
          durationSeconds: input.durationSeconds,
          // One instant for both (taken after every wait in this transaction), so the 600-second window is exact.
          approvedAt: sql`statement_timestamp()`,
          startBy: sql`statement_timestamp() + interval '600 seconds'`,
          policyConfigRevision: policy.configRevision,
          tenantAuthorityRevision: policy.authorityRevision,
          operatorEpoch: epochs.get(operator.id)!,
          subjectEpoch: epochs.get(target.user_id)!,
          approverEpoch: epochs.get(actor.user.id)!,
          approverPasswordVersion: proof.passwordVersion,
          approverSessionId: proof.sessionId,
        })
        .returning();
      await this.appendEvent(tx, actor, row!.id, tenantId, scope, { kind: 'approved', area: null, reasonCode: null, operatorUserId: operator.id });
      const summary = await this.summary(tx, row!);
      await audit.record(
        actor,
        {
          action: 'settings.support_access.approve',
          targetType: 'support_access_grant',
          targetId: row!.id,
          tenantId,
          entityId: input.entityId,
          after: { operatorUserId: operator.id, subjectUserId: target.user_id, areas: input.areas, durationSeconds: input.durationSeconds, startBy: summary.startBy },
          reason: input.reason,
        },
        tx,
      );
      return summary;
    });
  }

  /** Tenant history: grants (newest first, keyset cursor) and their lifecycle evidence. */
  async listTenant(tenantId: string, query: SupportListQuery): Promise<SupportGrantPage> {
    return this.db.transaction(async (tx) => {
      const after = decodeCursor(query.cursor);
      const page = await tx
        .select()
        .from(supportAccessGrant)
        .where(
          after
            ? sql`${supportAccessGrant.tenantId} = ${tenantId} and (${supportAccessGrant.approvedAt}, ${supportAccessGrant.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
            : sql`${supportAccessGrant.tenantId} = ${tenantId}`,
        )
        .orderBy(sql`${supportAccessGrant.approvedAt} desc, ${supportAccessGrant.id} desc`)
        .limit(query.limit + 1);
      const more = page.length > query.limit;
      const shown = page.slice(0, query.limit);
      const grants = [];
      for (const row of shown) grants.push(await this.summary(tx, row));
      const ids = shown.map((g) => g.id);
      const events = await tx
        .select()
        .from(supportAccessEvent)
        .where(ids.length ? sql`${supportAccessEvent.tenantId} = ${tenantId} and (${supportAccessEvent.grantId} = any(${uuidArray(ids)}) or ${supportAccessEvent.grantId} is null)` : sql`${supportAccessEvent.tenantId} = ${tenantId} and ${supportAccessEvent.grantId} is null`)
        .orderBy(sql`${supportAccessEvent.occurredAt} desc`)
        .limit(500);
      const last = shown.at(-1);
      return {
        grants,
        events: events.map(historyEntry),
        nextCursor: more && last ? encodeCursor(last.approvedAt, last.id) : null,
      };
    });
  }

  private passwordVersion(userId: string, storedHash: string) {
    const key = createHmac('sha256', this.config.BETTER_AUTH_SECRET).update('factoryos/support-access/password-version/v1').digest();
    return createHmac('sha256', key).update(`${userId}\u0000${storedHash}`).digest('hex');
  }
}

type EventRow = typeof supportAccessEvent.$inferSelect;
function historyEntry(e: EventRow): SupportHistoryEntry {
  return {
    id: e.id,
    grantId: e.grantId,
    kind: e.kind as SupportEventKind,
    occurredAt: e.occurredAt.toISOString(),
    actorUserId: e.actorUserId,
    subjectUserId: e.subjectUserId,
    operatorUserId: e.operatorUserId,
    area: e.area as SupportArea | null,
    reasonCode: e.reasonCode,
  };
}

/** Keyset cursor: base64url of `<iso time>|<uuid>`; validated, never trusted for scope. */
export function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}
export function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw new SupportError('SUPPORT_INVALID_INPUT', 'cursor');
  return { at, id };
}
