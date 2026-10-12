// Decision 062: who may run what. A job card needs the active skills of its machine and its work centre; a person holds
// a skill when their latest certification for it is not revoked and has not expired. Trainees need a co-signer;
// anyone else uncertified needs a one-time override from a supervisor.
import { type Database, machine, machineSkill, membership, skill, skillCertification, skillOverride, user, workCentreSkill } from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { DB } from '../../common/tokens.js';
import { businessDate, type Tx } from '../accounting/accounting-lock.js';

export type Level = 'trainee' | 'qualified' | 'trainer';
export interface Standing {
  userId: string;
  skillId: string;
  certificationId: string;
  level: Level;
  certifiedOn: string;
  expiresOn: string;
  revoked: boolean;
}
type Skill = { id: string; code: string; name: string };

/** Calendar months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Counts on `on`: the latest certification is not revoked and has not expired. */
export const counts = (s: Standing | undefined, on: string): s is Standing => !!s && !s.revoked && s.expiresOn >= on;
const certified = (s: Standing | undefined, on: string) => counts(s, on) && s.level !== 'trainee';

@Injectable()
export class SkillsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Each person's latest certification per skill (revoked ones included, so a revocation ends the standing). */
  async standings(db: Database | Tx, entityId: string, filter: { userIds?: string[]; skillIds?: string[] } = {}): Promise<Standing[]> {
    const rows = await db
      .selectDistinctOn([skillCertification.userId, skillCertification.skillId], {
        userId: skillCertification.userId,
        skillId: skillCertification.skillId,
        certificationId: skillCertification.id,
        level: skillCertification.level,
        certifiedOn: skillCertification.certifiedOn,
        expiresOn: skillCertification.expiresOn,
        revokedAt: skillCertification.revokedAt,
      })
      .from(skillCertification)
      .where(and(eq(skillCertification.entityId, entityId), filter.userIds ? inArray(skillCertification.userId, filter.userIds) : undefined, filter.skillIds ? inArray(skillCertification.skillId, filter.skillIds) : undefined))
      .orderBy(skillCertification.userId, skillCertification.skillId, sql`${skillCertification.createdAt} desc`, sql`${skillCertification.id} desc`);
    return rows.map(({ revokedAt, ...r }) => ({ ...r, revoked: !!revokedAt }));
  }

  /** The active skills a card on this machine (or, without one, this work centre) needs. */
  async required(db: Database | Tx, workCentreId: string, machineId: string | null): Promise<Skill[]> {
    const cols = { id: skill.id, code: skill.code, name: skill.name };
    const fromCentre = await db.select(cols).from(workCentreSkill).innerJoin(skill, eq(skill.id, workCentreSkill.skillId)).where(and(eq(workCentreSkill.workCentreId, workCentreId), eq(skill.isActive, true)));
    const fromMachine = machineId ? await db.select(cols).from(machineSkill).innerJoin(skill, eq(skill.id, machineSkill.skillId)).where(and(eq(machineSkill.machineId, machineId), eq(skill.isActive, true))) : [];
    return [...new Map([...fromCentre, ...fromMachine].map((s) => [s.id, s])).values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Active members qualified or trainer, valid today, in every one of these skills. */
  async certifiedPeople(db: Database | Tx, ctx: TenantRequestContext, entityId: string, skills: Skill[], except?: string) {
    if (!skills.length) return [];
    const today = businessDate();
    const st = await this.standings(db, entityId, { skillIds: skills.map((s) => s.id) });
    const people = await this.members(db, ctx.tenant.tenantId);
    return people.filter((p) => p.id !== except && skills.every((s) => certified(st.find((x) => x.userId === p.id && x.skillId === s.id), today)));
  }

  async members(db: Database | Tx, tenantId: string) {
    return db
      .select({ id: user.id, name: user.name })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.tenantId, tenantId), eq(membership.status, 'active')))
      .orderBy(user.name);
  }

  /**
   * The start gate. Returns the override used (if any) and the co-signer the card waits for (if any);
   * refuses an uncertified start without an override, and a trainee's start without a valid co-signer.
   */
  async checkStart(tx: Tx, ctx: TenantRequestContext, entityId: string, op: { id: string; workCentreId: string }, machineId: string | null, cosignUserId: string | null) {
    const req = await this.required(tx, op.workCentreId, machineId);
    if (!req.length) return { overrideId: null, cosignUserId: null };
    const today = businessDate();
    const mine = await this.standings(tx, entityId, { userIds: [ctx.user.id], skillIds: req.map((s) => s.id) });
    const missing = req.filter((s) => !counts(mine.find((x) => x.skillId === s.id), today));
    const trainee = req.filter((s) => mine.find((x) => x.skillId === s.id && counts(x, today))?.level === 'trainee');
    if (missing.length) {
      const [o] = await tx
        .select({ id: skillOverride.id })
        .from(skillOverride)
        .where(and(eq(skillOverride.entityId, entityId), eq(skillOverride.userId, ctx.user.id), eq(skillOverride.operationId, op.id), machineId ? eq(skillOverride.machineId, machineId) : isNull(skillOverride.machineId), eq(skillOverride.validOn, today), isNull(skillOverride.jobCardId)))
        .limit(1)
        .for('update');
      if (o) return { overrideId: o.id, cosignUserId: null };
      throw new ConflictException({
        message: `You aren't certified for ${missing.map((s) => s.name).join(', ')}. A supervisor can allow this start.`,
        code: 'skill_missing',
        skills: missing,
      });
    }
    if (!trainee.length) return { overrideId: null, cosignUserId: null };
    const cosigners = await this.certifiedPeople(tx, ctx, entityId, req, ctx.user.id);
    if (!cosignUserId)
      throw new ConflictException({
        message: `You are a trainee in ${trainee.map((s) => s.name).join(', ')}; name a qualified person or trainer to co-sign`,
        code: 'cosign_required',
        skills: trainee,
        cosigners,
        issues: [{ path: 'cosignUserId', message: 'Choose who co-signs' }],
      });
    if (!cosigners.some((p) => p.id === cosignUserId))
      throw new BadRequestException({ message: `The co-signer must be another active member qualified or a trainer in ${req.map((s) => s.name).join(', ')}`, issues: [{ path: 'cosignUserId', message: 'Not certified' }] });
    return { overrideId: null, cosignUserId };
  }

  /** People certified for each machine's required skills (information for the schedule and dispatch list). */
  async coverage(ctx: TenantRequestContext, entityId: string) {
    const machines = await this.db.select({ id: machine.id, workCentreId: machine.workCentreId }).from(machine).where(and(eq(machine.entityId, entityId), eq(machine.isActive, true)));
    const active = await this.db.select({ id: skill.id, code: skill.code, name: skill.name }).from(skill).where(and(eq(skill.entityId, entityId), eq(skill.isActive, true)));
    const byId = new Map(active.map((s) => [s.id, s]));
    const ms = machines.length ? await this.db.select().from(machineSkill).where(inArray(machineSkill.machineId, machines.map((m) => m.id))) : [];
    const ws = await this.db.select().from(workCentreSkill).where(inArray(workCentreSkill.skillId, [...byId.keys(), '00000000-0000-0000-0000-000000000000']));
    const st = await this.standings(this.db, entityId);
    const people = await this.members(this.db, ctx.tenant.tenantId);
    const today = businessDate();
    return machines.map((m) => {
      const ids = [...new Set([...ws.filter((w) => w.workCentreId === m.workCentreId).map((w) => w.skillId), ...ms.filter((x) => x.machineId === m.id).map((x) => x.skillId)])].filter((id) => byId.has(id));
      const req = ids.map((id) => byId.get(id)!).sort((a, b) => a.code.localeCompare(b.code));
      const certifiedCount = req.length ? people.filter((p) => req.every((s) => certified(st.find((x) => x.userId === p.id && x.skillId === s.id), today))).length : null;
      return { machineId: m.id, skills: req, certified: certifiedCount };
    });
  }
}
