// Skill matrix (decision 062): skills required by a machine, an uncertified start refused, certifying (never oneself;
// trainer only by a trainer once one exists), a trainee's card waiting for a qualified co-signer from their own login,
// revocation ending the standing, a supervisor's one-time override, expiry and the expiring list, certified counts
// per machine, an inspection plan whose submission needs the skill, and isolation.
// Usage: API=http://localhost:4000 node apps/api/scripts/smoke-skill-matrix.mjs
import assert from 'node:assert/strict';
import { Client } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const c = await new Client().init('Skill matrix');
const fail = async (method, path, body, status, label, pattern, who = c) => {
  const r = await who.raw(method, path, body);
  assert.equal(r.status, status, `${label}: ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(JSON.stringify(r.data), pattern, label);
  c.checks++;
  ok(label);
  return r.data;
};
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + n * 86400e3));
const today = day(0);

// ── Shop: a 5-axis machine in a CNC centre, an inspection bench, a released work order ──
const uoms = await c.req('GET', '/uoms');
const u = (code) => uoms.find((x) => x.code === code).id;
const bar = await c.req('POST', '/items', { code: 'TI64', name: 'Ti-6Al-4V bar', type: 'raw_material', tracking: 'none', stockUomId: u('KG'), hsnCode: '76042910' }, 201);
const part = await c.req('POST', '/items', { code: 'HSG', name: 'Housing', type: 'finished_good', tracking: 'none', stockUomId: u('NOS'), hsnCode: '88073000' }, 201);
const sto = await c.req('POST', '/warehouses', { code: 'STO', name: 'Stores', type: 'stores' }, 201);
const fg = await c.req('POST', '/warehouses', { code: 'FG', name: 'Finished goods', type: 'finished_goods' }, 201);
const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC', hourlyRate: '2500' }, 201);
const qcw = await c.req('POST', '/manufacturing/work-centres', { code: 'QC', name: 'Inspection', hourlyRate: '600' }, 201);
const m5 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M5X', name: 'Variaxis 5-axis' }, 201);
const m3 = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'M3X', name: 'VMC 3-axis' }, 201);
const bench = await c.req('POST', `/manufacturing/work-centres/${qcw.id}/machines`, { code: 'Q1', name: 'Inspection bench' }, 201);
const bom = await c.req('POST', '/manufacturing/boms', {
  itemId: part.id,
  revision: 'A',
  materials: [{ itemId: bar.id, qty: '2' }],
  operations: [
    { seq: 10, name: '5-axis mill', workCentreId: cnc.id, runMinutesPerUnit: '90' },
    { seq: 20, name: 'CMM', workCentreId: qcw.id, runMinutesPerUnit: '20' },
  ],
}, 201);
await c.req('POST', `/manufacturing/boms/${bom.id}/activate`, {}, 201);
const draft = await c.req('POST', '/manufacturing/work-orders', { itemId: part.id, plannedQty: '5', sourceWarehouseId: sto.id, targetWarehouseId: fg.id }, 201);
const wo = await c.req('POST', `/manufacturing/work-orders/${draft.id}/release`, {}, 201);
const op10 = wo.operations.find((o) => o.seq === 10);

// ── Two shop people with a custom role (job cards, inspections, read the matrix) ──
const role = await c.req('POST', '/roles', { name: 'Machinist-inspector', permissions: ['manufacturing.job_card.read', 'manufacturing.job_card.update', 'manufacturing.job_card.submit', 'quality.inspection.read', 'quality.inspection.create', 'quality.inspection.submit', 'quality.skill.read'] }, 201);
const join = async (name) => {
  const who = new Client();
  const email = `${name.split(' ')[0].toLowerCase()}-${Date.now()}@example.com`;
  const inv = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
  await who.req('POST', '/auth/sign-up/email', { name, email, password: 'Sup3r-secret-pw' });
  await who.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
  who.tenantId = c.tenantId;
  who.entityId = c.entityId;
  return who;
};
const tara = await join('Tara Trainee');
const qadir = await join('Qadir Qualified');
const people = (await c.req('GET', '/quality/skill-matrix')).people;
const id = (name) => people.find((p) => p.name === name).id;
const [T, Q, me] = [id('Tara Trainee'), id('Qadir Qualified'), id('Skill matrix')];

// ── Skills and requirements ──
await fail('POST', '/quality/skills', { code: '5AX', name: '5-axis milling', recertifyMonths: 61 }, 400, 'the re-certification interval is 1 to 60 months');
const ax5 = await c.req('POST', '/quality/skills', { code: '5ax', name: '5-axis milling', recertifyMonths: 12 }, 201);
assert.equal(ax5.code, '5AX');
await fail('POST', '/quality/skills', { code: '5AX', name: 'Again', recertifyMonths: 12 }, 409, 'skill codes are unique', /already exists/);
const cmm = await c.req('POST', '/quality/skills', { code: 'CMM', name: 'CMM programming', recertifyMonths: 24 }, 201);
await c.req('PUT', '/quality/skill-requirements', { machineId: m5.id, skillIds: [ax5.id] });
await fail('PUT', '/quality/skill-requirements', { machineId: m5.id, skillIds: ['00000000-0000-4000-8000-000000000000'] }, 404, 'requirements name this entity’s skills');
const listed = await c.req('GET', '/quality/skills');
assert.deepEqual(listed.find((s) => s.code === '5AX').machines.map((m) => m.code), ['M5X']);
ok('5-axis milling (12 months) required by M5X; CMM programming (24 months)');

// ── Uncertified: refused on the 5-axis, free on the 3-axis ──
await fail('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id }, 409, 'an uncertified start on the 5-axis is refused', /skill_missing.*5-axis milling/, tara);
const free = await tara.req('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m3.id }, 201);
await tara.req('POST', `/manufacturing/job-cards/${free.id}/stop`, { goodQty: '1' }, 201);
ok('a machine without required skills starts as before');

// ── Certify: never oneself; trainer only by a trainer once one exists ──
await fail('POST', '/quality/skill-certifications', { userId: me, skillId: ax5.id, level: 'trainer' }, 403, 'nobody certifies themselves', /Someone else/);
await fail('POST', '/quality/skill-certifications', { userId: Q, skillId: ax5.id, level: 'qualified' }, 403, 'a shop role can’t certify', undefined, tara);
await c.req('POST', '/quality/skill-certifications', { userId: Q, skillId: ax5.id, level: 'trainer', note: 'OEM course, Mazak' }, 201);
await fail('POST', '/quality/skill-certifications', { userId: T, skillId: ax5.id, level: 'trainer' }, 403, 'once a trainer exists, only a trainer makes another', /Only a trainer/);
await fail('POST', '/quality/skill-certifications', { userId: T, skillId: ax5.id, level: 'trainee', certifiedOn: day(-400) }, 400, 'a certification already past its interval is refused', /already have expired/);
await fail('POST', '/quality/skill-certifications', { userId: T, skillId: ax5.id, level: 'trainee', certifiedOn: day(1) }, 400, 'no certification in the future', /future/);
const tCert = await c.req('POST', '/quality/skill-certifications', { userId: T, skillId: ax5.id, level: 'trainee' }, 201);
assert.equal(tCert.expiresOn > today, true);
ok('Qadir trainer (first trainer, by the owner); Tara trainee');

// ── Trainee: co-sign by a qualified person from their own login ──
const need = await fail('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id }, 409, 'a trainee names a co-signer', /cosign_required/, tara);
assert.deepEqual(need.cosigners.map((p) => p.name), ['Qadir Qualified']);
await fail('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id, cosignUserId: me }, 400, 'the co-signer must be certified', /qualified or a trainer/, tara);
let card = await tara.req('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id, cosignUserId: Q }, 201);
assert.deepEqual([card.cosigner, card.cosignedAt], ['Qadir Qualified', null]);
await fail('POST', `/manufacturing/job-cards/${card.id}/pause`, { reason: 'Tea' }, 409, 'the card can’t pause before the co-sign', /Waiting for Qadir Qualified/, tara);
await fail('POST', `/manufacturing/job-cards/${card.id}/stop`, { goodQty: '1' }, 409, 'or stop', /cosign_pending/, tara);
await fail('POST', `/manufacturing/job-cards/${card.id}/cosign`, undefined, 403, 'only the named co-signer confirms', /named co-signer/);
card = await qadir.req('POST', `/manufacturing/job-cards/${card.id}/cosign`, undefined, 201);
assert.ok(card.cosignedAt);
await tara.req('POST', `/manufacturing/job-cards/${card.id}/stop`, { goodQty: '1' }, 201);
ok('Tara’s card waited for Qadir’s co-sign, then ran and stopped');

// ── Revoke: no standing until certified again; then a supervisor's one-time override ──
await fail('POST', `/quality/skill-certifications/${tCert.id}/revoke`, { reason: 'x' }, 400, 'revoking needs a reason');
await c.req('POST', `/quality/skill-certifications/${tCert.id}/revoke`, { reason: 'Crashed the B-axis on a dry run' }, 201);
await fail('POST', `/quality/skill-certifications/${tCert.id}/revoke`, { reason: 'Again please' }, 409, 'revoked once', /Already revoked/);
await fail('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id, cosignUserId: Q }, 409, 'a revoked certification no longer counts', /skill_missing/, tara);
await fail('POST', '/quality/skill-overrides', { userId: T, operationId: op10.id, machineId: m5.id, reason: 'Urgent AOG part' }, 403, 'a shop role can’t override', undefined, qadir);
await fail('POST', '/quality/skill-overrides', { userId: me, operationId: op10.id, machineId: m5.id, reason: 'Myself, urgently' }, 403, 'nobody overrides for themselves', /Someone else/);
await fail('POST', '/quality/skill-overrides', { userId: T, operationId: op10.id, machineId: bench.id, reason: 'Wrong machine' }, 400, 'the machine belongs to the operation’s work centre', /work centre/);
await c.req('POST', '/quality/skill-overrides', { userId: T, operationId: op10.id, machineId: m5.id, reason: 'AOG part; Qadir standing by the machine' }, 201);
await fail('POST', '/quality/skill-overrides', { userId: T, operationId: op10.id, machineId: m5.id, reason: 'A second one' }, 409, 'one unused allowance at a time', /already exists/);
card = await tara.req('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id }, 201);
assert.deepEqual([card.override?.reason, card.override?.by, card.cosigner], ['AOG part; Qadir standing by the machine', 'Skill matrix', null]);
await tara.req('POST', `/manufacturing/job-cards/${card.id}/stop`, { goodQty: '1' }, 201);
await fail('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id }, 409, 'the allowance is used once', /skill_missing/, tara);
const overrides = await c.req('GET', `/quality/skill-overrides?operationId=${op10.id}`);
assert.deepEqual([overrides.length, overrides[0].jobCardId], [1, card.id]);
ok('override: logged on the card, used once');

// ── Expiry and the expiring list; qualified runs without a co-sign ──
await c.req('POST', '/quality/skill-certifications', { userId: T, skillId: ax5.id, level: 'qualified', certifiedOn: day(-350), note: 'Assessed on the HSG-01 first article' }, 201);
const matrix = await c.req('GET', '/quality/skill-matrix');
const cell = matrix.cells.find((x) => x.userId === T && x.skillId === ax5.id);
assert.deepEqual([cell.level, cell.state], ['qualified', 'expiring']);
assert.deepEqual(matrix.expiring.map((x) => `${x.userName}/${x.skillName}`), ['Tara Trainee/5-axis milling']);
const hist = await c.req('GET', `/quality/skill-certifications?userId=${T}&skillId=${ax5.id}`);
assert.deepEqual(hist.map((h) => [h.level, !!h.revokedAt]), [['qualified', false], ['trainee', true]]);
card = await tara.req('POST', '/manufacturing/job-cards', { operationId: op10.id, machineId: m5.id }, 201);
assert.equal(card.cosigner, null);
await tara.req('POST', `/manufacturing/job-cards/${card.id}/stop`, { goodQty: '1' }, 201);
ok('qualified (expiring in about two weeks): listed as expiring, runs without a co-sign; history kept');

// ── Certified count per machine ──
const cov = await c.req('GET', '/quality/skill-coverage');
const of = (m) => cov.find((x) => x.machineId === m.id);
assert.deepEqual([of(m5).certified, of(m5).skills.map((s) => s.code), of(m3).certified, of(bench).certified], [2, ['5AX'], null, null]);
const cand = await tara.req('GET', `/quality/skill-candidates?operationId=${op10.id}&machineId=${m5.id}`);
assert.deepEqual(cand.people.map((p) => p.name), ['Qadir Qualified']);
ok('M5X has 2 certified people; machines without required skills show none');

// ── Inspection plan requiring a skill: anyone drafts, only the certified submit ──
const plan = await c.req('POST', '/quality/plans', { itemId: part.id, stage: 'in_process', operationSeq: 10, revision: 'A', characteristics: [{ balloon: '1', description: 'Datum A flatness', kind: 'dimension', upperLimit: '0.02', unit: 'mm', sampleSize: 1 }] }, 201);
await c.req('POST', `/quality/plans/${plan.id}/activate`, {}, 201);
const withSkill = await c.req('PUT', `/quality/plans/${plan.id}/required-skill`, { skillId: cmm.id });
assert.equal(withSkill.requiredSkillId, cmm.id);
let ir = await tara.req('POST', '/quality/inspections', { stage: 'in_process', itemId: part.id, qty: '1', sourceType: 'operation', workOrderId: wo.id, operationId: op10.id }, 201);
assert.equal(ir.plan?.id, plan.id);
ir = await tara.req('POST', `/quality/inspections/${ir.id}/results`, { results: [{ characteristicId: ir.characteristics[0].id, sampleNo: 1, measured: '0.012' }] }, 201);
await fail('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '1', qtyRejected: '0' }, 403, 'an uncertified inspector drafts but can’t submit', /needs someone qualified in CMM programming/, tara);
await c.req('POST', '/quality/skill-certifications', { userId: T, skillId: cmm.id, level: 'qualified' }, 201);
ir = await tara.req('POST', `/quality/inspections/${ir.id}/submit`, { qtyAccepted: '1', qtyRejected: '0' }, 201);
assert.equal(ir.status, 'submitted');
ok('once certified in CMM programming, the same person submits');

// ── Isolation ──
const outsider = await new Client().init('Elsewhere');
await fail('GET', '/quality/skills', undefined, 200, 'another tenant sees its own (empty) catalogue', /^\[\]$/, outsider);
await fail('POST', '/quality/skill-certifications', { userId: T, skillId: ax5.id, level: 'qualified' }, 400, 'another tenant can’t certify our people', /active member/, outsider);
await fail('POST', `/quality/skill-certifications/${tCert.id}/revoke`, { reason: 'Not yours to revoke' }, 404, 'or revoke our certifications', undefined, outsider);

console.log(`\nSkill matrix smoke passed (${c.checks + tara.checks + qadir.checks} request checks).`);
