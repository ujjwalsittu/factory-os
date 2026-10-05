import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client } from './accounting-test-helpers.mjs';
const c = new Client();
process.loadEnvFile(new URL('../../../.env', import.meta.url));
const db = createDb(process.env.DATABASE_URL);
try {
  await c.init('Settlement concurrency');
  const p = await c.req('POST', '/parties', { code: 'CUS', name: 'Concurrent customer', isCustomer: true, gstTreatment: 'unregistered' }, 201);
  await c.activate([{ ...c.line('debtors', '8000'), partyId: p.id, billReference: 'RACE' }, c.line('equity', '0', '8000')], [], [{ partyId: p.id, reference: 'RACE', side: 'debit', amount: '8000', currency: 'USD', exchangeRate: '80', originalAmount: '100' }]);
  const bill = (await c.req('GET', '/accounts/bills'))[0];
  const input = { direction: 'receipt', partyId: p.id, postingDate: c.settings.cutoverDate, currency: 'USD', exchangeRate: '83', accountId: c.account('bank'), amount: '70', bankReference: '', narration: 'Competing receipt allocation', allocations: [{ billId: bill.id, amount: '70' }] };
  const a = await c.req('POST', '/accounts/settlements', input, 201), b = await c.req('POST', '/accounts/settlements', input, 201);
  const results = await Promise.all([c.raw('POST', `/accounts/settlements/${a.id}/submit`, {}), c.raw('POST', `/accounts/settlements/${b.id}/submit`, {})]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal((await c.req('GET', '/accounts/bills')).find(x => x.id === bill.id).openAmount, '30.000000');
  assert.deepEqual((await c.req('GET', '/accounts/trade-reconciliation')).differences, []);
  const winner = results[0].status === 200 ? a : b;
  await c.req('POST', `/accounts/settlements/${winner.id}/submit`, {}, 409);
  const own = await db.$client.query('select count(*)::int as n from journal_voucher where entity_id=$1 and source_type=$2 and source_id=$3 and purpose=$4', [c.entityId, 'settlement', winner.id, 'main']);
  assert.equal(own.rows[0].n, 1);
  const failed = await c.req('POST', '/accounts/settlements', { ...input, amount: '10', allocations: [{ billId: bill.id, amount: '10' }] }, 201);
  const name = `test_settlement_${randomUUID().replaceAll('-', '')}`;
  await db.$client.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = '${c.entityId}' AND EXISTS (SELECT 1 FROM journal_voucher WHERE id=NEW.voucher_id AND source_id='${failed.id}') THEN RAISE EXCEPTION 'forced settlement posting failure'; END IF; RETURN NEW; END $$`);
  try {
    await db.$client.query(`CREATE TRIGGER ${name} BEFORE INSERT ON gl_entry FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    await c.req('POST', `/accounts/settlements/${failed.id}/submit`, {}, 500);
    assert.equal((await c.req('GET', `/accounts/settlements/${failed.id}`)).status, 'draft');
    assert.equal((await c.req('GET', '/accounts/bills')).find(x => x.id === bill.id).openAmount, '30.000000');
    const none = await db.$client.query('select count(*)::int as n from journal_voucher where entity_id=$1 and source_id=$2', [c.entityId, failed.id]);
    assert.equal(none.rows[0].n, 0);
  } finally {
    await db.$client.query(`DROP TRIGGER IF EXISTS ${name} ON gl_entry`);
    await db.$client.query(`DROP FUNCTION ${name}()`);
  }
  assert.deepEqual((await c.req('GET', '/accounts/trade-reconciliation')).differences, []);
  console.log('PASS concurrent bill consumption, duplicate rejection and transactional posting rollback', c.checks);
} finally { await db.$client.end(); }
