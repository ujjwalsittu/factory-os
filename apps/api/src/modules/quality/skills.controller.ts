// Decision 062: the skill catalogue, what machines and work centres need, certifications (append-only; revoked once),
// the people × skills matrix, one-time overrides for an uncertified job card start, and certified counts per machine.
import { attachment, type Database, machine, machineSkill, skill, skillCertification, skillOverride, user, workCentre, workCentreSkill, workOrder, workOrderOperation } from '@factoryos/db';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Ctx, RequirePermission, type TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { parse } from '../../common/validation.js';
import { businessDate, entityOf } from '../accounting/accounting-lock.js';
import { addMonths, counts, SkillsService } from './skills.service.js';

const skillInput = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  recertifyMonths: z.number().int().min(1, 'At least a month').max(60, 'At most 60 months'),
  isActive: z.boolean().default(true),
});
const requirementInput = z.union([z.object({ machineId: z.uuid(), skillIds: z.array(z.uuid()).max(20) }), z.object({ workCentreId: z.uuid(), skillIds: z.array(z.uuid()).max(20) })]);
const certifyInput = z.object({ userId: z.string().min(1), skillId: z.uuid(), level: z.enum(['trainee', 'qualified', 'trainer']), certifiedOn: z.iso.date().optional(), note: z.string().trim().max(1000).nullable().optional() });
const overrideInput = z.object({ userId: z.string().min(1), operationId: z.uuid(), machineId: z.uuid().nullable().optional(), reason: z.string().trim().min(5, 'Give the reason').max(500) });

@Controller('quality')
export class SkillsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly skills: SkillsService,
  ) {}

  // ── Catalogue and requirements ──

  @Get('skills')
  @RequirePermission('quality.skill.read')
  async list(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const rows = await this.db.select().from(skill).where(eq(skill.entityId, entityId)).orderBy(asc(skill.code));
    const ids = rows.map((r) => r.id);
    const machines = ids.length ? await this.db.select({ skillId: machineSkill.skillId, id: machine.id, code: machine.code }).from(machineSkill).innerJoin(machine, eq(machine.id, machineSkill.machineId)).where(inArray(machineSkill.skillId, ids)) : [];
    const centres = ids.length ? await this.db.select({ skillId: workCentreSkill.skillId, id: workCentre.id, code: workCentre.code }).from(workCentreSkill).innerJoin(workCentre, eq(workCentre.id, workCentreSkill.workCentreId)).where(inArray(workCentreSkill.skillId, ids)) : [];
    return rows.map((s) => ({ ...s, machines: machines.filter((m) => m.skillId === s.id).map(({ id, code }) => ({ id, code })), workCentres: centres.filter((w) => w.skillId === s.id).map(({ id, code }) => ({ id, code })) }));
  }

  @Post('skills')
  @RequirePermission('quality.skill.create')
  async create(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(skillInput, body);
    return this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: skill.id }).from(skill).where(and(eq(skill.entityId, entityId), eq(skill.code, input.code)));
      if (dup) throw new ConflictException({ message: `Skill ${input.code} already exists`, issues: [{ path: 'code', message: 'Already used' }] });
      const [s] = await tx.insert(skill).values({ tenantId: ctx.tenant.tenantId, entityId, ...input, description: input.description ?? null }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'skill.create', targetType: 'skill', targetId: s!.id, after: input }, tx);
      return s!;
    });
  }

  /** Name, interval and active flag. A new interval applies to certifications given from now on. */
  @Put('skills/:id')
  @RequirePermission('quality.skill.update')
  async update(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(skillInput, body);
    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(skill).where(and(eq(skill.id, id), eq(skill.entityId, entityId))).for('update');
      if (!s) throw new NotFoundException('Skill not found');
      if (input.code !== s.code) {
        const [dup] = await tx.select({ id: skill.id }).from(skill).where(and(eq(skill.entityId, entityId), eq(skill.code, input.code)));
        if (dup) throw new ConflictException({ message: `Skill ${input.code} already exists`, issues: [{ path: 'code', message: 'Already used' }] });
      }
      const [after] = await tx.update(skill).set({ ...input, description: input.description ?? null, updatedAt: new Date() }).where(eq(skill.id, id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'skill.update', targetType: 'skill', targetId: id, before: s, after: input }, tx);
      return after!;
    });
  }

  /** Replace the skills a machine or work centre needs. */
  @Put('skill-requirements')
  @RequirePermission('quality.skill.update')
  async requirements(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(requirementInput, body);
    const ids = [...new Set(input.skillIds)];
    return this.db.transaction(async (tx) => {
      if (ids.length) {
        const found = await tx.select({ id: skill.id }).from(skill).where(and(inArray(skill.id, ids), eq(skill.entityId, entityId)));
        if (found.length !== ids.length) throw new NotFoundException('Skill not found in this entity');
      }
      if ('machineId' in input) {
        const [m] = await tx.select({ id: machine.id }).from(machine).where(and(eq(machine.id, input.machineId), eq(machine.entityId, entityId)));
        if (!m) throw new NotFoundException('Machine not found');
        await tx.delete(machineSkill).where(eq(machineSkill.machineId, m.id));
        if (ids.length) await tx.insert(machineSkill).values(ids.map((skillId) => ({ machineId: m.id, skillId })));
      } else {
        const [w] = await tx.select({ id: workCentre.id }).from(workCentre).where(and(eq(workCentre.id, input.workCentreId), eq(workCentre.entityId, entityId)));
        if (!w) throw new NotFoundException('Work centre not found');
        await tx.delete(workCentreSkill).where(eq(workCentreSkill.workCentreId, w.id));
        if (ids.length) await tx.insert(workCentreSkill).values(ids.map((skillId) => ({ workCentreId: w.id, skillId })));
      }
      const target = 'machineId' in input ? { targetType: 'machine', targetId: input.machineId } : { targetType: 'work_centre', targetId: input.workCentreId };
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'skill.requirements', ...target, after: { skillIds: ids } }, tx);
      return { ok: true };
    });
  }

  @Get('skill-requirements')
  @RequirePermission('quality.skill.read')
  async requirementList(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const machines = await this.db.select({ machineId: machineSkill.machineId, skillId: machineSkill.skillId }).from(machineSkill).innerJoin(skill, eq(skill.id, machineSkill.skillId)).where(eq(skill.entityId, entityId));
    const workCentres = await this.db.select({ workCentreId: workCentreSkill.workCentreId, skillId: workCentreSkill.skillId }).from(workCentreSkill).innerJoin(skill, eq(skill.id, workCentreSkill.skillId)).where(eq(skill.entityId, entityId));
    return { machines, workCentres };
  }

  // ── Matrix and certifications ──

  @Get('skill-matrix')
  @RequirePermission('quality.skill.read')
  async matrix(@Ctx() ctx: TenantRequestContext) {
    const entityId = entityOf(ctx);
    const today = businessDate();
    const soon = addDays(today, 30);
    const skills = await this.db.select({ id: skill.id, code: skill.code, name: skill.name, recertifyMonths: skill.recertifyMonths }).from(skill).where(and(eq(skill.entityId, entityId), eq(skill.isActive, true))).orderBy(asc(skill.code));
    const people = await this.skills.members(this.db, ctx.tenant.tenantId);
    const st = (await this.skills.standings(this.db, entityId)).filter((s) => !s.revoked);
    const cells = st.map((s) => ({ ...s, state: s.expiresOn < today ? 'expired' : s.expiresOn <= soon ? 'expiring' : 'valid' }));
    const expiring = cells
      .filter((c) => c.state === 'expiring' && skills.some((s) => s.id === c.skillId) && people.some((p) => p.id === c.userId))
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
      .map((c) => ({ ...c, userName: people.find((p) => p.id === c.userId)!.name, skillName: skills.find((s) => s.id === c.skillId)!.name }));
    return { today, skills, people, cells, expiring };
  }

  @Get('skill-certifications')
  @RequirePermission('quality.skill.read')
  async history(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ userId: z.string().min(1), skillId: z.uuid() }), query);
    const by = alias(user, 'certifier');
    const revoker = alias(user, 'revoker');
    const rows = await this.db
      .select({ c: skillCertification, certifiedByName: by.name, revokedByName: revoker.name })
      .from(skillCertification)
      .innerJoin(by, eq(by.id, skillCertification.certifiedBy))
      .leftJoin(revoker, eq(revoker.id, skillCertification.revokedBy))
      .where(and(eq(skillCertification.entityId, entityId), eq(skillCertification.userId, q.userId), eq(skillCertification.skillId, q.skillId)))
      .orderBy(desc(skillCertification.createdAt), desc(skillCertification.id));
    const ids = rows.map((r) => r.c.id);
    const files = ids.length
      ? await this.db.select({ id: attachment.id, ownerId: attachment.ownerId, fileName: attachment.fileName }).from(attachment).where(and(eq(attachment.entityId, entityId), eq(attachment.ownerType, 'skill_certification'), inArray(attachment.ownerId, ids), isNull(attachment.withdrawnAt)))
      : [];
    return rows.map((r) => ({ ...r.c, certifiedByName: r.certifiedByName, revokedByName: r.revokedByName, files: files.filter((f) => f.ownerId === r.c.id).length }));
  }

  /** Certify, re-certify or change a level: always a new record. Not for oneself; trainer only by a trainer once one exists. */
  @Post('skill-certifications')
  @RequirePermission('quality.skill.approve')
  async certify(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(certifyInput, body);
    if (input.userId === ctx.user.id) throw new ForbiddenException('Someone else certifies you');
    const people = await this.skills.members(this.db, ctx.tenant.tenantId);
    if (!people.some((p) => p.id === input.userId)) throw new BadRequestException({ message: 'Certify an active member', issues: [{ path: 'userId', message: 'Not an active member' }] });
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(skill).where(and(eq(skill.id, input.skillId), eq(skill.entityId, entityId))).for('update');
      if (!s) throw new NotFoundException('Skill not found');
      if (!s.isActive) throw new ConflictException(`${s.name} is inactive`);
      const certifiedOn = input.certifiedOn ?? today;
      if (certifiedOn > today) throw new BadRequestException({ message: 'The certification date can’t be in the future', issues: [{ path: 'certifiedOn', message: 'In the future' }] });
      const expiresOn = addMonths(certifiedOn, s.recertifyMonths);
      if (expiresOn < today) throw new BadRequestException({ message: `A certification from ${certifiedOn} would already have expired (${s.recertifyMonths} months)`, issues: [{ path: 'certifiedOn', message: 'Already expired' }] });
      if (input.level === 'trainer') {
        const st = await this.skills.standings(tx, entityId, { skillIds: [s.id] });
        const trainers = st.filter((x) => x.level === 'trainer' && counts(x, today));
        if (trainers.length && !trainers.some((x) => x.userId === ctx.user.id)) throw new ForbiddenException(`Only a trainer in ${s.name} makes someone a trainer`);
      }
      const [c] = await tx.insert(skillCertification).values({ tenantId: ctx.tenant.tenantId, entityId, userId: input.userId, skillId: s.id, level: input.level, certifiedOn, expiresOn, certifiedBy: ctx.user.id, note: input.note ?? null }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'skill.certify', targetType: 'skill_certification', targetId: c!.id, after: { userId: input.userId, skill: s.code, level: input.level, certifiedOn, expiresOn } }, tx);
      return c!;
    });
  }

  @Post('skill-certifications/:id/revoke')
  @RequirePermission('quality.skill.approve')
  async revoke(@Ctx() ctx: TenantRequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give the reason').max(500) }), body);
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(skillCertification).where(and(eq(skillCertification.id, id), eq(skillCertification.entityId, entityId))).for('update');
      if (!c) throw new NotFoundException('Certification not found');
      if (c.revokedAt) throw new ConflictException('Already revoked');
      if (c.userId === ctx.user.id) throw new ForbiddenException('Someone else revokes your certification');
      await tx.update(skillCertification).set({ revokedAt: new Date(), revokedBy: ctx.user.id, revokeReason: reason }).where(eq(skillCertification.id, id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'skill.revoke', targetType: 'skill_certification', targetId: id, reason }, tx);
      return { ok: true };
    });
  }

  // ── Overrides and coverage ──

  /** Allow one uncertified start today: this person, this operation, this machine (or none). */
  @Post('skill-overrides')
  @RequirePermission('quality.skill.manage')
  async override(@Ctx() ctx: TenantRequestContext, @Body() body: unknown) {
    const entityId = entityOf(ctx);
    const input = parse(overrideInput, body);
    if (input.userId === ctx.user.id) throw new ForbiddenException('Someone else allows your start');
    const people = await this.skills.members(this.db, ctx.tenant.tenantId);
    if (!people.some((p) => p.id === input.userId)) throw new BadRequestException({ message: 'Choose an active member', issues: [{ path: 'userId', message: 'Not an active member' }] });
    const machineId = input.machineId ?? null;
    const today = businessDate();
    return this.db.transaction(async (tx) => {
      const [op] = await tx
        .select({ id: workOrderOperation.id, workCentreId: workOrderOperation.workCentreId, status: workOrder.status, number: workOrder.number, seq: workOrderOperation.seq })
        .from(workOrderOperation)
        .innerJoin(workOrder, eq(workOrder.id, workOrderOperation.workOrderId))
        .where(and(eq(workOrderOperation.id, input.operationId), eq(workOrder.entityId, entityId)));
      if (!op) throw new NotFoundException('Operation not found');
      if (op.status !== 'released') throw new ConflictException('Allow starts on a released work order');
      if (machineId) {
        const [m] = await tx.select({ workCentreId: machine.workCentreId }).from(machine).where(and(eq(machine.id, machineId), eq(machine.entityId, entityId)));
        if (!m || m.workCentreId !== op.workCentreId) throw new BadRequestException({ message: 'Choose a machine of the operation’s work centre', issues: [{ path: 'machineId', message: 'Wrong work centre' }] });
      }
      const [open] = await tx
        .select({ id: skillOverride.id })
        .from(skillOverride)
        .where(and(eq(skillOverride.userId, input.userId), eq(skillOverride.operationId, op.id), machineId ? eq(skillOverride.machineId, machineId) : isNull(skillOverride.machineId), eq(skillOverride.validOn, today), isNull(skillOverride.jobCardId)));
      if (open) throw new ConflictException('An unused allowance for this start already exists today');
      const [o] = await tx.insert(skillOverride).values({ tenantId: ctx.tenant.tenantId, entityId, userId: input.userId, operationId: op.id, machineId, reason: input.reason, validOn: today, grantedBy: ctx.user.id }).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'skill.override', targetType: 'work_order_operation', targetId: op.id, reason: input.reason, after: { userId: input.userId, machineId, workOrder: op.number, seq: op.seq } }, tx);
      return o!;
    });
  }

  @Get('skill-overrides')
  @RequirePermission('quality.skill.read')
  async overrides(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ operationId: z.uuid().optional(), workOrderId: z.uuid().optional() }), query);
    const person = alias(user, 'person');
    const granter = alias(user, 'granter');
    return this.db
      .select({ id: skillOverride.id, operationId: skillOverride.operationId, machineId: skillOverride.machineId, machine: machine.code, userId: skillOverride.userId, userName: person.name, reason: skillOverride.reason, validOn: skillOverride.validOn, grantedByName: granter.name, grantedAt: skillOverride.grantedAt, jobCardId: skillOverride.jobCardId, seq: workOrderOperation.seq })
      .from(skillOverride)
      .innerJoin(person, eq(person.id, skillOverride.userId))
      .innerJoin(granter, eq(granter.id, skillOverride.grantedBy))
      .innerJoin(workOrderOperation, eq(workOrderOperation.id, skillOverride.operationId))
      .leftJoin(machine, eq(machine.id, skillOverride.machineId))
      .where(and(eq(skillOverride.entityId, entityId), q.operationId ? eq(skillOverride.operationId, q.operationId) : undefined, q.workOrderId ? eq(workOrderOperation.workOrderId, q.workOrderId) : undefined))
      .orderBy(desc(skillOverride.grantedAt))
      .limit(200);
  }

  @Get('skill-coverage')
  @RequirePermission('quality.skill.read')
  coverage(@Ctx() ctx: TenantRequestContext) {
    return this.skills.coverage(ctx, entityOf(ctx));
  }

  /** Who could co-sign or run this operation: people qualified or trainer in its required skills. */
  @Get('skill-candidates')
  @RequirePermission('quality.skill.read')
  async candidates(@Ctx() ctx: TenantRequestContext, @Query() query: unknown) {
    const entityId = entityOf(ctx);
    const q = parse(z.object({ operationId: z.uuid(), machineId: z.uuid().optional() }), query);
    const [op] = await this.db.select({ workCentreId: workOrderOperation.workCentreId }).from(workOrderOperation).innerJoin(workOrder, eq(workOrder.id, workOrderOperation.workOrderId)).where(and(eq(workOrderOperation.id, q.operationId), eq(workOrder.entityId, entityId)));
    if (!op?.workCentreId) throw new NotFoundException('Operation not found');
    const required = await this.skills.required(this.db, op.workCentreId, q.machineId ?? null);
    return { required, people: await this.skills.certifiedPeople(this.db, ctx, entityId, required, ctx.user.id) };
  }
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
}
