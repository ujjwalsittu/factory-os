// "My work" Home (decision 068, slice 2): GET /home returns what needs the signed-in person in the active entity as
// tiles with counts, top rows and links. Checked here: every tile is computed without error, counts and rows for the
// tiles that can be seeded through the API (reorder level, expiring quotations, old drafts, late purchase orders,
// maintenance due, gauges due), permission scoping (a tile is absent when its data is unreadable), other people's
// drafts never counted, tenant and entity isolation, no active entity, and one slow tile never blocks the rest.
// Slice 5: rows carry their hand-off action (here "Create purchase order" for the reorder shortfall).
// Usage: API=http://localhost:4000 node --env-file=.env apps/api/scripts/smoke-home.mjs
import assert from 'node:assert/strict';
import { createDb } from '../../../packages/db/dist/index.js';
import { Client, gstin } from './accounting-test-helpers.mjs';

const ok = (label) => console.log(`✓ ${label}`);
const db = createDb(process.env.DATABASE_URL);
const q = async (text, params = []) => (await db.$client.query(text, params)).rows;
const pause = () => new Promise((r) => setTimeout(r, 20e3));
const c = await new Client().init('Home owner');
const check = async (label, fn) => {
  await fn();
  c.checks++;
  ok(label);
};
const ist = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const tiles = async (who = c, headers = true) => {
  const r = await who.raw('GET', '/home');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const tile = (home, id) => home.tiles.find((t) => t.id === id);

try {
  // ── Seed ──
  await c.req('POST', `/entities/${c.entityId}/gst-registrations`, { gstin: gstin('27AAACA1234B1Z') }, 201);
  await c.req('POST', '/hsn-codes', { code: '72249000', kind: 'hsn', description: 'Steel bars', gstRate: '18', effectiveFrom: '2025-04-01' }, 201);
  const uoms = await c.req('GET', '/uoms');
  const nos = uoms.find((x) => x.code === 'NOS').id;
  const low = await c.req('POST', '/items', { code: 'LOW-ITEM', name: 'Below its level', type: 'raw_material', stockUomId: nos, hsnCode: '72249000', reorderLevel: '100' }, 201);
  const fine = await c.req('POST', '/items', { code: 'FINE-ITEM', name: 'Above its level', type: 'raw_material', stockUomId: nos, hsnCode: '72249000', reorderLevel: '10' }, 201);
  const none = await c.req('POST', '/items', { code: 'NEVER-ITEM', name: 'No stock at all', type: 'raw_material', stockUomId: nos, hsnCode: '72249000', reorderLevel: '5' }, 201);
  await c.req('POST', '/items', { code: 'NOLEVEL-ITEM', name: 'No reorder level', type: 'raw_material', stockUomId: nos, hsnCode: '72249000' }, 201);
  const cust = await c.req('POST', '/parties', { code: 'ORBIT', name: 'Orbit Aerospace', isCustomer: true, gstin: gstin('27AABCO1234B1Z') }, 201);
  const sup = await c.req('POST', '/parties', { code: 'TIMET', name: 'Titanium Metals', isSupplier: true, gstin: gstin('27AAACT1234B1Z') }, 201);
  const wh = await c.req('POST', '/warehouses', { code: 'STO', name: 'Main stores', type: 'stores' }, 201);
  const rec = await c.req('POST', '/stock-entries', { purpose: 'receipt', postingDate: ist(), partyId: sup.id, lines: [{ itemId: low.id, qty: '40', toWarehouseId: wh.id, rate: '10' }, { itemId: fine.id, qty: '50', toWarehouseId: wh.id, rate: '10' }] }, 201);
  await c.req('POST', `/stock-entries/${rec.id}/submit`, {}, 201);
  const lines = [{ itemId: fine.id, qty: '1', rate: '100' }];
  const quote = async (validTill, submit = true) => {
    const x = await c.req('POST', '/quotations', { customerId: cust.id, quotationDate: ist(), validTill, lines }, 201);
    if (submit) await c.req('POST', `/quotations/${x.id}/submit`, undefined, 201);
    return x;
  };
  const soon = await quote(ist(3));
  await quote(ist(30));
  const converted = await quote(ist(2));
  await c.req('POST', `/quotations/${converted.id}/order`, { customerPoNo: 'PO/1', customerPoDate: ist() }, 201);
  const old = await quote(ist(40), false);
  await quote(ist(40), false);
  await q("update quotation set created_at = now() - interval '3 days' where id = $1", [old.id]);
  const po = async (expectedDate) => {
    const x = await c.req('POST', '/purchase-orders', { supplierId: sup.id, orderDate: ist(-10), expectedDate, lines: [{ itemId: low.id, qty: '10', rate: '10' }] }, 201);
    await c.req('POST', `/purchase-orders/${x.id}/submit`, undefined, 201);
    return x;
  };
  const late = await po(ist(-1));
  await po(ist(5));
  const cnc = await c.req('POST', '/manufacturing/work-centres', { code: 'CNC', name: 'CNC machining', hourlyRate: '1800' }, 201);
  const vmc = await c.req('POST', `/manufacturing/work-centres/${cnc.id}/machines`, { code: 'VMC-1', name: 'VMC 3-axis', critical: true }, 201);
  const plan = await c.req('POST', '/maintenance/plans', { machineId: vmc.id, name: 'Monthly service', everyDays: 30, leadDays: 3, plannedMinutes: 60, lastDoneAt: new Date(Date.now() - 90 * 86400e3).toISOString(), items: [{ text: 'Spindle runout', unit: 'mm', min: '0', max: '0.005' }] }, 201);
  await c.req('POST', '/quality/gauges', { code: 'CAL-OLD', description: 'Vernier 150 mm', intervalDays: 180, lastCalibrated: ist(-400) }, 201);
  await c.req('POST', '/quality/gauges', { code: 'CAL-NEW', description: 'Micrometer', intervalDays: 365, lastCalibrated: ist(-10) }, 201);
  ok('seeded');

  // ── The owner's Home ──
  const home = await tiles();
  await check('every tile the owner can see is computed without error', async () => {
    assert.equal(home.needsEntity, false);
    assert.equal(home.asOf, ist());
    assert.ok(home.tiles.length >= 15, `${home.tiles.length} tiles`);
    assert.deepEqual(home.tiles.filter((t) => t.error).map((t) => t.id), []);
    for (const t of home.tiles) assert.ok(t.href.startsWith('/app') && t.rows.length <= 5 && t.count >= t.rows.length, t.id);
  });
  await check('items below their reorder level: counts own stock, treats no stock as zero, skips items with no level', async () => {
    const t = tile(home, 'below-reorder');
    assert.equal(t.count, 2);
    assert.deepEqual(t.rows.map((r) => r.label.split(' ')[0]).sort(), ['LOW-ITEM', 'NEVER-ITEM']);
    assert.match(t.rows.find((r) => r.label.startsWith('LOW')).detail, /40 on hand, reorder at 100/);
    // Slice 5 hand-off: the row offers a purchase order for the shortfall; the item page knows the same shortfall.
    assert.deepEqual(t.rows.find((r) => r.label.startsWith('LOW')).action, { label: 'Create purchase order', href: `/app/buying/orders/new?item=${low.id}&qty=60`, permission: 'buying.purchase_order.create' });
    const overview = await c.req('GET', `/items/${low.id}/overview`);
    assert.equal(Number(overview.belowReorder.shortfall), 60);
    assert.equal((await c.req('GET', `/items/${fine.id}/overview`)).belowReorder, null);
    assert.equal((await c.req('GET', `/items/${low.id}`)).uomCode, 'NOS');
  });
  await check('quotations expiring within 7 days: submitted only, not already ordered', async () => {
    const t = tile(home, 'quotations-expiring');
    assert.equal(t.count, 1);
    assert.equal(t.rows[0].href, `/app/selling/quotations/${soon.id}`);
  });
  await check('my drafts older than a day: only mine, only old ones', async () => {
    const t = tile(home, 'my-drafts');
    assert.equal(t.count, 1);
    assert.equal(t.rows[0].href, `/app/selling/quotations/${old.id}`);
    assert.match(t.rows[0].detail, /^Quotation · started /);
  });
  await check('purchase orders past their expected date: submitted and not fully received', async () => {
    const t = tile(home, 'late-purchase-orders');
    assert.equal(t.count, 1);
    assert.equal(t.rows[0].href, `/app/buying/orders/${late.id}`);
  });
  await check('maintenance due: a plan with no open order, and gone once its order is open', async () => {
    const t = tile(home, 'maintenance-due');
    assert.equal(t.count, 1);
    assert.match(t.rows[0].detail, /Monthly service · overdue/);
    await c.req('POST', `/maintenance/plans/${plan.id}/order`, {}, 201);
    assert.equal(tile(await tiles(), 'maintenance-due').count, 0);
  });
  await check('gauges due: the overdue one only', async () => {
    const t = tile(home, 'gauges-due');
    assert.equal(t.count, 1);
    assert.equal(t.rows[0].label, 'CAL-OLD');
    assert.match(t.rows[0].detail, /overdue since/);
  });
  await check('nothing seeded for the rest: zero, no error, and money tiles carry an amount', async () => {
    for (const id of ['timesheets-approve', 'ncr-dispositions', 'maintenance-verify', 'job-work-due', 'late-work-orders', 'my-job-cards', 'open-ncrs', 'capa-overdue', 'machines-down', 'taps-silent']) assert.equal(tile(home, id).count, 0, id);
    for (const id of ['overdue-receivables', 'payables-due']) {
      assert.equal(tile(home, id).count, 0, id);
      assert.equal(tile(home, id).amountInr, '0.00', id);
    }
  });

  // ── Entities, workspaces, people ──
  await check('no active entity: nothing is counted and the page is told to ask for one', async () => {
    const bare = new Client();
    bare.cookie = c.cookie;
    bare.tenantId = c.tenantId;
    const r = await bare.raw('GET', '/home');
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.needsEntity, r.data.tiles.length], [true, 0]);
  });
  await check('a second entity of the same workspace has its own counts (items are shared, stock is per entity)', async () => {
    const e2 = await c.req('POST', '/entities', { legalName: 'Second Unit Pvt Ltd', shortName: 'Second', code: 'S2', pan: 'AAACB1234C' }, 201);
    const other = new Client();
    other.cookie = c.cookie;
    other.tenantId = c.tenantId;
    other.entityId = e2.id;
    const h = await tiles(other);
    for (const id of ['quotations-expiring', 'my-drafts', 'late-purchase-orders', 'maintenance-due', 'gauges-due']) assert.equal(tile(h, id)?.count, 0, id);
    // Items are shared by the workspace, so the three with a reorder level are all short here, where nothing is stocked.
    assert.equal(tile(h, 'below-reorder').count, 3);
  });
  await check('another workspace sees none of this', async () => {
    await pause();
    const stranger = await new Client().init('Home stranger');
    const h = await tiles(stranger);
    assert.deepEqual(h.tiles.filter((t) => t.count > 0 && t.id !== 'below-reorder').map((t) => t.id), []);
    assert.equal(tile(h, 'below-reorder').count, 0);
  });

  const role = await c.req('POST', '/roles', { name: 'Stores clerk', permissions: ['masters.item.read', 'inventory.report.read', 'selling.quotation.read', 'selling.quotation.create'] }, 201);
  await pause();
  const clerk = new Client();
  const email = `clerk-${Date.now()}@example.com`;
  const inv = await c.req('POST', '/invitations', { email, roles: [{ roleId: role.id, entityIds: [c.entityId] }] }, 201);
  await clerk.req('POST', '/auth/sign-up/email', { name: 'Kiran Clerk', email, password: 'Sup3r-secret-pw' });
  await clerk.req('POST', '/invitations/accept', { token: inv.inviteUrl.split('/').at(-1) }, 201);
  clerk.tenantId = c.tenantId;
  clerk.entityId = c.entityId;
  await check('a person sees only the tiles they can read, and only their own drafts', async () => {
    const mine = await clerk.req('POST', '/quotations', { customerId: cust.id, quotationDate: ist(), lines }, 201);
    await q("update quotation set created_at = now() - interval '2 days' where id = $1", [mine.id]);
    const h = await tiles(clerk);
    assert.deepEqual(h.tiles.map((t) => t.id).sort(), ['below-reorder', 'my-drafts', 'quotations-expiring']);
    assert.equal(tile(h, 'my-drafts').count, 1);
    assert.equal(tile(h, 'my-drafts').rows[0].href, `/app/selling/quotations/${mine.id}`);
    assert.equal(tile(h, 'below-reorder').count, 2);
    assert.ok(tile(h, 'below-reorder').rows.every((r) => !r.action), 'no purchase order hand-off without permission to create one');
    // The owner's old draft is still the owner's only.
    assert.equal(tile(await tiles(), 'my-drafts').count, 1);
  });
  await check('signed out is refused', async () => assert.equal((await new Client().raw('GET', '/home')).status, 401));

  // ── One slow tile never blocks the others ──
  await check('a tile that cannot finish reports an error and the rest still arrive', async () => {
    const holder = await db.$client.connect();
    try {
      await holder.query('begin');
      await holder.query('lock table gauge in access exclusive mode');
      const t0 = Date.now();
      const h = await tiles();
      assert.ok(Date.now() - t0 < 15000, 'the endpoint gave up on the stuck tile');
      assert.equal(tile(h, 'gauges-due').error, true);
      assert.equal(tile(h, 'gauges-due').count, 0);
      assert.equal(tile(h, 'below-reorder').count, 2);
      assert.deepEqual(h.tiles.filter((t) => t.error).map((t) => t.id), ['gauges-due']);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
  });

  console.log(`\nHome smoke: ${c.checks} request checks, all passing`);
} finally {
  await db.$client.end();
}
