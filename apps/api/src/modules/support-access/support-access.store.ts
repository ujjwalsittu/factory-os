// Audited support access (decision 050): consent state, authority revisions and lock order.
// Lock order everywhere: user epochs (key order) → tenant policy → grant. Source rows are never locked here; they are
// read as committed and compared through the revisions the source triggers bump in their own transactions.
import { createHmac } from 'node:crypto';
import {
  type SupportArea,
  type SupportEventKind,
  type SupportGrantSummary,
  type SupportIdentity,
  type SupportState,
  SUPPORT_READ_CATALOG,
  effectivePermissions,
  type ScopedGrant,
} from '@factoryos/auth';
import { type Database, supportAccessGrant, supportAccessEvent } from '@factoryos/db';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RequestContext } from '../../common/access.js';
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
    const [now] = rows<{ now: Date }>(await tx.execute(sql`select clock_timestamp() as now`));
    const at = now!.now.getTime();
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

  /** Re-checks a proof under the caller's locks: same native session, same epoch, same credential. */
  async checkProof(tx: SupportTx, proof: SupportProof) {
    const [r] = rows<{ epoch: string | null; password: string | null; session_ok: boolean | null }>(
      await tx.execute(
        sql`select (select security_epoch::text from support_access_user_epoch where user_id = ${proof.userId}) as epoch,
                   (select password from account where user_id = ${proof.userId} and provider_id = 'credential' limit 1) as password,
                   (select expires_at > clock_timestamp() from session where id = ${proof.sessionId} and user_id = ${proof.userId}) as session_ok`,
      ),
    );
    if (!r?.session_ok) throw new SupportError('SUPPORT_REAUTHENTICATE', 'session-ended');
    if (r.epoch !== proof.securityEpoch || !r.password || this.passwordVersion(proof.userId, r.password) !== proof.passwordVersion)
      throw new SupportError('SUPPORT_REAUTHENTICATE', 'credentials-changed');
  }

  private passwordVersion(userId: string, storedHash: string) {
    const key = createHmac('sha256', this.config.BETTER_AUTH_SECRET).update('factoryos/support-access/password-version/v1').digest();
    return createHmac('sha256', key).update(`${userId}\u0000${storedHash}`).digest('hex');
  }
}
