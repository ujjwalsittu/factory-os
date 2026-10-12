// Decision 065: SMT board traceability by scanning. Reels and paste jars (containers of a component lot) with their
// MSL and paste clocks, feeder setup per work order, panels with board serials reserved at label printing, and the
// trace from a board to the reels it saw and back.
import {
  boardLabel,
  containerLabel,
  formatSerial,
  loadsAt,
  type MslLevel,
  MSL_LEVELS,
  panelLabel,
  PASTE_EVENTS,
  pasteEventsAllowed,
  type PasteEventKind,
  pasteState,
  REEL_EVENTS,
  reelClock,
  reelEventsAllowed,
  type ReelEventKind,
} from '@factoryos/core';
import {
  batch,
  bom,
  type Database,
  item,
  machine,
  serialCounter,
  smtBoard,
  smtContainer,
  smtContainerEvent,
  smtFeederLoad,
  smtPanel,
  stockBin,
  uom,
  warehouse,
  workOrder,
  workOrderMaterial,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import type { Tx } from '../accounting/accounting-lock.js';
import { LabelService } from '../iot/labels.service.js';

type Db = Database | Tx;
type Container = typeof smtContainer.$inferSelect;
type Item = typeof item.$inferSelect;
type Batch = typeof batch.$inferSelect;

export interface ContainerStatus {
  phase: string;
  /** Why it can't go on a feeder now; null when it can. */
  blocked: string | null;
  clock: ReturnType<typeof reelClock> | null;
  paste: ReturnType<typeof pasteState> | null;
  allowed: readonly string[];
}

const IST_MS = 5.5 * 3600_000;
const todayIst = (now: Date) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);

@Injectable()
export class SmtService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly labels: LabelService,
  ) {}

  // ── Containers ──

  /** Clock state of a container from its events. Reels and paste follow decision 065's rules. */
  status(c: Container, it: Item, b: Batch, events: { kind: string; at: Date }[], now = new Date()): ContainerStatus {
    if (c.kind === 'reel') {
      const level = MSL_LEVELS.includes(it.mslLevel as MslLevel) ? (it.mslLevel as MslLevel) : null;
      const clock = reelClock(level, events as { kind: ReelEventKind; at: Date }[], now, c.labelHours);
      const blocked =
        clock.phase === 'empty'
          ? 'The reel is empty'
          : b.expiryDate && b.expiryDate < todayIst(now)
            ? `Lot ${b.batchNo} expired on ${b.expiryDate}`
            : clock.needsBake
              ? level === '6' && !events.some((e) => e.kind === 'baked')
                ? 'MSL 6: bake it before use'
                : 'Floor life used up: bake it first'
              : null;
      return { phase: clock.phase, blocked, clock, paste: null, allowed: reelEventsAllowed(clock.phase) };
    }
    const paste = pasteState(events as { kind: PasteEventKind; at: Date }[], now, { thawMinutes: it.pasteThawMinutes ?? 0, openHours: it.pasteOpenHours ?? 24, expiryDate: b.expiryDate });
    const blocked =
      paste.phase === 'cold'
        ? 'Take it out of the fridge and let it thaw first'
        : paste.phase === 'thawing'
          ? `Still thawing until ${paste.readyAt!.toISOString()}`
          : paste.phase === 'over_open_time'
            ? 'Open too long: discard it'
            : paste.phase === 'expired'
              ? `Lot ${b.batchNo} is past its expiry date`
              : paste.phase === 'empty'
                ? 'The jar is empty'
                : null;
    return { phase: paste.phase, blocked, clock: null, paste, allowed: pasteEventsAllowed(paste.phase) };
  }

  async containerByCode(db: Db, entityId: string, code: string, lock = false) {
    const q = db.select().from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.code, code.trim())));
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException(`No reel or paste jar ${code}`);
    return c;
  }

  async containerById(db: Db, entityId: string, id: string, lock = false) {
    const q = db.select().from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.id, id)));
    const [c] = lock ? await q.for('update') : await q;
    if (!c) throw new NotFoundException('Reel or paste jar not found');
    return c;
  }

  /** The container with its item, lot, events, status and current feeder load. */
  async describe(db: Db, c: Container, now = new Date()) {
    const [it] = await db.select().from(item).where(eq(item.id, c.itemId));
    const [b] = await db.select().from(batch).where(eq(batch.id, c.batchId));
    const events = await db.select().from(smtContainerEvent).where(eq(smtContainerEvent.containerId, c.id)).orderBy(asc(smtContainerEvent.at), asc(smtContainerEvent.id));
    const [load] = await db
      .select({ id: smtFeederLoad.id, slot: smtFeederLoad.slot, workOrderId: smtFeederLoad.workOrderId, workOrder: workOrder.number, machine: machine.code, loadedAt: smtFeederLoad.loadedAt })
      .from(smtFeederLoad)
      .innerJoin(workOrder, eq(workOrder.id, smtFeederLoad.workOrderId))
      .innerJoin(machine, eq(machine.id, smtFeederLoad.machineId))
      .where(and(eq(smtFeederLoad.containerId, c.id), isNull(smtFeederLoad.unloadedAt)));
    return {
      ...c,
      itemCode: it!.code,
      itemName: it!.name,
      mslLevel: it!.mslLevel,
      batchNo: b!.batchNo,
      supplierBatchNo: b!.supplierBatchNo,
      expiryDate: b!.expiryDate,
      status: this.status(c, it!, b!, events, now),
      events: events.map((e) => ({ id: e.id, kind: e.kind, at: e.at, note: e.note, by: e.createdBy })),
      load: load ?? null,
    };
  }

  async createContainer(
    tx: Tx,
    ctx: TenantRequestContext,
    entityId: string,
    input: { kind: 'reel' | 'paste'; batchId: string; qty: string; code?: string | null; warehouseId?: string | null; labelHours?: number | null; printerId?: string | null },
  ) {
    const [b] = await tx.select().from(batch).where(and(eq(batch.id, input.batchId), eq(batch.tenantId, ctx.tenant.tenantId)));
    if (!b || b.kind !== 'lot') throw new NotFoundException('Lot not found');
    const [it] = await tx.select().from(item).where(eq(item.id, b.itemId));
    const paste = it!.pasteThawMinutes !== null && it!.pasteOpenHours !== null;
    if (input.kind === 'paste' && !paste) throw new BadRequestException({ message: `${it!.code} has no paste thaw and open times; set them on the item`, issues: [{ path: 'batchId', message: 'Not a solder paste' }] });
    if (input.kind === 'reel' && paste) throw new BadRequestException({ message: `${it!.code} is a solder paste; add a paste jar`, issues: [{ path: 'kind', message: 'Use paste' }] });
    if (it!.mslLevel === '6' && input.kind === 'reel' && !input.labelHours) throw new BadRequestException({ message: 'MSL 6: enter the floor life from the label, in hours', issues: [{ path: 'labelHours', message: 'Required for MSL 6' }] });
    // The lot must be in this entity's stock: reels split a lot for traceability only.
    const [stock] = await tx
      .select({ qty: sql<string>`coalesce(sum(${stockBin.qty}), 0)` })
      .from(stockBin)
      .where(and(eq(stockBin.entityId, entityId), eq(stockBin.batchId, b.id), gt(stockBin.qty, '0')));
    if (Number(stock?.qty ?? 0) <= 0) throw new BadRequestException({ message: `Lot ${b.batchNo} has no stock in this entity`, issues: [{ path: 'batchId', message: 'No stock' }] });
    if (input.warehouseId) {
      const [w] = await tx.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.id, input.warehouseId), eq(warehouse.entityId, entityId)));
      if (!w) throw new NotFoundException('Warehouse not found');
    }
    let code = input.code?.trim() || '';
    if (!code) {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(smtContainer).where(eq(smtContainer.batchId, b.id))) as [{ n: number }];
      code = `${input.kind === 'reel' ? 'R' : 'PJ'}-${b.batchNo}-${String(n + 1).padStart(2, '0')}`;
    }
    const [dup] = await tx.select({ id: smtContainer.id }).from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.code, code)));
    if (dup) throw new ConflictException({ message: `${code} already exists`, issues: [{ path: 'code', message: 'Already exists' }] });
    const [c] = await tx
      .insert(smtContainer)
      .values({ tenantId: ctx.tenant.tenantId, entityId, kind: input.kind, code, itemId: it!.id, batchId: b.id, warehouseId: input.warehouseId ?? null, qty: input.qty, labelHours: input.labelHours ?? null, createdBy: ctx.user.id })
      .returning();
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'smt_container.create', targetType: 'smt_container', targetId: c!.id, after: { code, kind: input.kind, batch: b.batchNo, qty: input.qty } }, tx);
    let job = null;
    if (input.printerId) job = await this.printContainer(tx, ctx, entityId, c!, input.printerId);
    return { container: c!, job };
  }

  async printContainer(tx: Tx, ctx: TenantRequestContext, entityId: string, c: Container, printerId: string) {
    const d = await this.describe(tx, c);
    const [u] = await tx.select({ code: uom.code }).from(item).innerJoin(uom, eq(uom.id, item.stockUomId)).where(eq(item.id, c.itemId));
    const note = c.kind === 'paste' ? 'Solder paste' : d.mslLevel ? `MSL ${d.mslLevel}` : null;
    return this.labels.queue(tx, ctx, entityId, printerId, {
      kind: 'container',
      sourceId: c.id,
      label: c.code,
      render: (size) => containerLabel({ code: c.code, item: d.itemCode, lot: d.batchNo, qty: c.qty, uom: u?.code ?? '', note }, size),
    });
  }

  /** Records an event allowed by the container's phase. Emptying a loaded container unloads it at the same moment. */
  async event(tx: Tx, ctx: TenantRequestContext, entityId: string, containerId: string, kind: string, note: string | null) {
    const c = await this.containerById(tx, entityId, containerId, true);
    const known: readonly string[] = c.kind === 'reel' ? REEL_EVENTS : PASTE_EVENTS;
    if (!known.includes(kind)) throw new BadRequestException(`A ${c.kind === 'reel' ? 'reel' : 'paste jar'} has no event ${kind}`);
    const d = await this.describe(tx, c);
    if (!d.status.allowed.includes(kind)) throw new ConflictException(`${c.code} is ${d.status.phase.replaceAll('_', ' ')}; ${kind.replaceAll('_', ' ')} isn't possible now`);
    const now = new Date();
    if (d.load) {
      if (kind !== 'empty') throw new ConflictException(`${c.code} is on ${d.load.machine} slot ${d.load.slot}; unload it first`);
      await tx.update(smtFeederLoad).set({ unloadedAt: now, unloadedBy: ctx.user.id }).where(eq(smtFeederLoad.id, d.load.id));
    }
    await tx.insert(smtContainerEvent).values({ tenantId: ctx.tenant.tenantId, containerId: c.id, kind, at: now, note, createdBy: ctx.user.id });
    return this.describe(tx, c);
  }

  // ── Feeder setup ──

  private async releasedOrder(db: Db, entityId: string, workOrderId: string, lock = false) {
    const q = db.select().from(workOrder).where(and(eq(workOrder.id, workOrderId), eq(workOrder.entityId, entityId)));
    const [wo] = lock ? await q.for('update') : await q;
    if (!wo) throw new NotFoundException('Work order not found');
    if (wo.status !== 'released') throw new ConflictException(`Work order ${wo.number ?? ''} is ${wo.status}; the line works on released orders`);
    return wo;
  }

  private async machineOf(db: Db, entityId: string, machineId: string) {
    const [m] = await db.select().from(machine).where(and(eq(machine.id, machineId), eq(machine.entityId, entityId)));
    if (!m) throw new NotFoundException('Machine not found');
    if (!m.isActive) throw new ConflictException(`Machine ${m.code} is inactive`);
    return m;
  }

  /**
   * Loads a container on a slot. Refused for a part that is not a material of the work order, an expired or unready
   * container, a busy slot (unless splicing, which unloads the old one at the same moment) or a container already on
   * a feeder. Scanning it on records that a sealed reel was opened, that it left the dry cabinet, or that paste was opened.
   */
  async load(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { workOrderId: string; machineId: string; slot: string; code: string; splice?: boolean }) {
    const wo = await this.releasedOrder(tx, entityId, input.workOrderId, true);
    const m = await this.machineOf(tx, entityId, input.machineId);
    const c = await this.containerByCode(tx, entityId, input.code, true);
    const mats = await tx.select({ itemId: workOrderMaterial.itemId }).from(workOrderMaterial).where(eq(workOrderMaterial.workOrderId, wo.id));
    const d = await this.describe(tx, c);
    if (!mats.some((x) => x.itemId === c.itemId)) throw new ConflictException({ message: `Wrong part: ${d.itemCode} is not a material of ${wo.number}`, issues: [{ path: 'code', message: 'Not on this work order' }] });
    if (d.load) throw new ConflictException(`${c.code} is already on ${d.load.machine} slot ${d.load.slot} for ${d.load.workOrder}`);
    const now = new Date();
    // What a scan onto the feeder implies, recorded before the readiness check.
    const implied: string[] = [];
    if (c.kind === 'reel' && d.status.phase === 'cabinet') implied.push('cabinet_out');
    if (c.kind === 'reel' && d.status.phase === 'sealed' && !d.status.blocked) implied.push('opened');
    if (d.status.blocked) throw new ConflictException({ message: `${c.code}: ${d.status.blocked}`, issues: [{ path: 'code', message: d.status.blocked }] });
    if (c.kind === 'paste' && d.status.phase === 'ready') implied.push('opened');
    const [busy] = await tx
      .select({ id: smtFeederLoad.id, containerId: smtFeederLoad.containerId })
      .from(smtFeederLoad)
      .where(and(eq(smtFeederLoad.workOrderId, wo.id), eq(smtFeederLoad.machineId, m.id), eq(smtFeederLoad.slot, input.slot), isNull(smtFeederLoad.unloadedAt)))
      .for('update');
    if (busy) {
      if (!input.splice) {
        const [old] = await tx.select({ code: smtContainer.code }).from(smtContainer).where(eq(smtContainer.id, busy.containerId));
        throw new ConflictException({ message: `Slot ${input.slot} holds ${old!.code}; unload it or splice`, issues: [{ path: 'slot', message: 'Slot in use' }] });
      }
      await tx.update(smtFeederLoad).set({ unloadedAt: now, unloadedBy: ctx.user.id }).where(eq(smtFeederLoad.id, busy.id));
    } else if (input.splice) throw new ConflictException({ message: `Slot ${input.slot} is empty: load instead of splicing`, issues: [{ path: 'slot', message: 'Nothing to splice' }] });
    for (const kind of implied) await tx.insert(smtContainerEvent).values({ tenantId: ctx.tenant.tenantId, containerId: c.id, kind, at: now, note: `Loaded on ${m.code} ${input.slot}`, createdBy: ctx.user.id });
    await tx.insert(smtFeederLoad).values({ tenantId: ctx.tenant.tenantId, entityId, workOrderId: wo.id, machineId: m.id, slot: input.slot, containerId: c.id, loadedAt: now, loadedBy: ctx.user.id });
    return this.setup(tx, entityId, wo.id);
  }

  async unload(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { workOrderId: string; machineId: string; slot: string }) {
    const [l] = await tx
      .select({ id: smtFeederLoad.id })
      .from(smtFeederLoad)
      .where(and(eq(smtFeederLoad.entityId, entityId), eq(smtFeederLoad.workOrderId, input.workOrderId), eq(smtFeederLoad.machineId, input.machineId), eq(smtFeederLoad.slot, input.slot), isNull(smtFeederLoad.unloadedAt)))
      .for('update');
    if (!l) throw new NotFoundException(`Nothing is loaded on slot ${input.slot}`);
    await tx.update(smtFeederLoad).set({ unloadedAt: new Date(), unloadedBy: ctx.user.id }).where(eq(smtFeederLoad.id, l.id));
    return this.setup(tx, entityId, input.workOrderId);
  }

  /** The work order's SMT view: materials and what is loaded for them, panels and board counts. */
  async setup(db: Db, entityId: string, workOrderId: string) {
    const [wo] = await db.select().from(workOrder).where(and(eq(workOrder.id, workOrderId), eq(workOrder.entityId, entityId)));
    if (!wo) throw new NotFoundException('Work order not found');
    const [it] = await db.select().from(item).where(eq(item.id, wo.itemId));
    const [b] = wo.bomId ? await db.select({ boardsPerPanel: bom.boardsPerPanel, revision: bom.revision }).from(bom).where(eq(bom.id, wo.bomId)) : [];
    const mats = await db
      .select({ itemId: workOrderMaterial.itemId, code: item.code, name: item.name, mslLevel: item.mslLevel, requiredQty: workOrderMaterial.requiredQty })
      .from(workOrderMaterial)
      .innerJoin(item, eq(item.id, workOrderMaterial.itemId))
      .where(eq(workOrderMaterial.workOrderId, wo.id))
      .orderBy(asc(workOrderMaterial.lineNo));
    const open = await db
      .select({ l: smtFeederLoad, c: smtContainer, machine: machine.code })
      .from(smtFeederLoad)
      .innerJoin(smtContainer, eq(smtContainer.id, smtFeederLoad.containerId))
      .innerJoin(machine, eq(machine.id, smtFeederLoad.machineId))
      .where(and(eq(smtFeederLoad.workOrderId, wo.id), isNull(smtFeederLoad.unloadedAt)))
      .orderBy(asc(machine.code), asc(smtFeederLoad.slot));
    const now = new Date();
    type Loaded = { id: string; machineId: string; machine: string; slot: string; loadedAt: Date; container: { id: string; code: string; kind: 'reel' | 'paste'; itemId: string; itemCode: string; batchNo: string; status: ContainerStatus } };
    const loads: Loaded[] = [];
    for (const o of open) {
      const d = await this.describe(db, o.c, now);
      loads.push({ id: o.l.id, machineId: o.l.machineId, machine: o.machine, slot: o.l.slot, loadedAt: o.l.loadedAt, container: { id: o.c.id, code: o.c.code, kind: o.c.kind, itemId: o.c.itemId, itemCode: d.itemCode, batchNo: d.batchNo, status: d.status } });
    }
    const panels = await db.select().from(smtPanel).where(eq(smtPanel.workOrderId, wo.id)).orderBy(asc(smtPanel.seq));
    const boards = await db.select().from(smtBoard).where(eq(smtBoard.workOrderId, wo.id)).orderBy(asc(smtBoard.position));
    return {
      workOrder: { id: wo.id, number: wo.number, status: wo.status, itemCode: it!.code, itemName: it!.name, revision: b?.revision ?? it!.revision, plannedQty: wo.plannedQty, producedQty: wo.producedQty, boardsPerPanel: b?.boardsPerPanel ?? null, serialTracked: it!.tracking === 'serial' },
      materials: mats.map((x) => ({ ...x, loaded: loads.filter((l) => l.container.itemId === x.itemId).map((l) => `${l.machine} ${l.slot}`) })),
      loads,
      panels: panels.map((p) => ({ ...p, boards: boards.filter((bd) => bd.panelId === p.id).map((bd) => ({ id: bd.id, position: bd.position, serialNo: bd.serialNo, batchId: bd.batchId, scrappedAt: bd.scrappedAt, scrapReason: bd.scrapReason })) })),
      counts: {
        boards: boards.length,
        waiting: boards.filter((bd) => !bd.batchId && !bd.scrappedAt && panels.find((p) => p.id === bd.panelId)?.depaneledAt).length,
        output: boards.filter((bd) => bd.batchId).length,
        scrapped: boards.filter((bd) => bd.scrappedAt).length,
      },
    };
  }

  // ── Panels and boards ──

  /** Creates `count` panels with a reserved serial per board position and prints their labels. */
  async printPanels(tx: Tx, ctx: TenantRequestContext, entityId: string, workOrderId: string, count: number, printerId: string | null) {
    const wo = await this.releasedOrder(tx, entityId, workOrderId, true);
    const [it] = await tx.select().from(item).where(eq(item.id, wo.itemId));
    const [b] = wo.bomId ? await tx.select().from(bom).where(eq(bom.id, wo.bomId)) : [];
    if (it!.tracking !== 'serial' || !b?.boardsPerPanel) throw new ConflictException(`${wo.number} is not a panelized SMT order: set boards per panel on a serial-tracked item's BOM`);
    const per = b.boardsPerPanel;
    const [{ pending }] = (await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(smtBoard)
      .where(and(eq(smtBoard.workOrderId, wo.id), isNull(smtBoard.batchId), isNull(smtBoard.scrappedAt)))) as [{ pending: number }];
    const remaining = Math.ceil(Number(wo.plannedQty) - Number(wo.producedQty)) - pending;
    const maxPanels = Math.max(0, Math.ceil(remaining / per));
    if (count > maxPanels) throw new ConflictException({ message: maxPanels ? `At most ${maxPanels} more panel${maxPanels === 1 ? '' : 's'} for ${wo.number}` : `${wo.number} already has panels for its whole quantity`, issues: [{ path: 'count', message: `At most ${maxPanels}` }] });
    const n = count * per;
    const [counter] = await tx
      .insert(serialCounter)
      .values({ tenantId: ctx.tenant.tenantId, itemId: it!.id, nextValue: n + 1 })
      .onConflictDoUpdate({ target: [serialCounter.tenantId, serialCounter.itemId], set: { nextValue: sql`${serialCounter.nextValue} + ${n}` } })
      .returning({ next: serialCounter.nextValue });
    let serial = counter!.next - n;
    const [{ last }] = (await tx.select({ last: max(smtPanel.seq) }).from(smtPanel).where(eq(smtPanel.workOrderId, wo.id))) as [{ last: number | null }];
    const made: (typeof smtPanel.$inferSelect & { serials: string[] })[] = [];
    for (let k = 1; k <= count; k++) {
      const seq = (last ?? 0) + k;
      const [p] = await tx
        .insert(smtPanel)
        .values({ tenantId: ctx.tenant.tenantId, entityId, workOrderId: wo.id, seq, code: `P-${wo.number}-${String(seq).padStart(3, '0')}`, createdBy: ctx.user.id })
        .returning();
      const serials = Array.from({ length: per }, () => formatSerial(it!.serialPrefix || it!.code, serial++));
      await tx.insert(smtBoard).values(serials.map((s, i) => ({ tenantId: ctx.tenant.tenantId, entityId, panelId: p!.id, workOrderId: wo.id, itemId: it!.id, position: i + 1, serialNo: s })));
      made.push({ ...p!, serials });
    }
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'smt_panel.create', targetType: 'work_order', targetId: wo.id, after: { panels: made.map((p) => p.code), boards: n } }, tx);
    let job = null;
    if (printerId)
      job = await this.labels.queue(tx, ctx, entityId, printerId, {
        kind: 'panel',
        sourceId: wo.id,
        label: count === 1 ? made[0]!.code : `${made[0]!.code} … ${made.at(-1)!.code}`,
        render: (size) => made.map((p) => panelLabel({ code: p.code, workOrder: wo.number!, item: it!.code, revision: b.revision, boards: per }, size)).join('\n'),
      });
    return { panels: made.map((p) => ({ id: p.id, code: p.code, serials: p.serials })), job };
  }

  /**
   * Scans along the line. Placed ties the panel's boards to what is loaded on the placement machine for its work
   * order now, and is refused when nothing is loaded or a loaded container has gone out of date. Depaneled prints a
   * label for each good board.
   */
  async scanPanel(tx: Tx, ctx: TenantRequestContext, entityId: string, input: { code: string; step: 'placed' | 'depaneled'; machineId?: string | null; printerId?: string | null }) {
    const [p] = await tx.select().from(smtPanel).where(and(eq(smtPanel.entityId, entityId), eq(smtPanel.code, input.code.trim()))).for('update');
    if (!p) throw new NotFoundException(`No panel ${input.code}`);
    const wo = await this.releasedOrder(tx, entityId, p.workOrderId);
    const now = new Date();
    if (input.step === 'placed') {
      if (p.placedAt) throw new ConflictException(`${p.code} was placed at ${p.placedAt.toISOString()}`);
      if (!input.machineId) throw new BadRequestException({ message: 'Choose the placement machine', issues: [{ path: 'machineId', message: 'Required' }] });
      const m = await this.machineOf(tx, entityId, input.machineId);
      const setup = await this.setup(tx, entityId, wo.id);
      const here = setup.loads.filter((l) => l.machineId === m.id);
      if (!here.length) throw new ConflictException(`Nothing is loaded on ${m.code} for ${wo.number}: set up the feeders first`);
      const stale = here.find((l) => l.container.status.blocked);
      if (stale) throw new ConflictException(`${stale.container.code} on ${stale.slot}: ${stale.container.status.blocked}. Unload it first`);
      await tx.update(smtPanel).set({ placedAt: now, placedBy: ctx.user.id, machineId: m.id }).where(eq(smtPanel.id, p.id));
      // Materials with nothing on this machine: often fine (the bare board, hand-fitted parts), so a warning.
      const notLoaded = setup.materials.filter((x) => !here.some((l) => l.container.itemId === x.itemId)).map((x) => x.code);
      return { panel: p.code, step: 'placed', at: now, notLoaded, job: null };
    }
    if (!p.placedAt) throw new ConflictException(`${p.code} hasn't been placed yet`);
    if (p.depaneledAt) throw new ConflictException(`${p.code} was depaneled at ${p.depaneledAt.toISOString()}`);
    await tx.update(smtPanel).set({ depaneledAt: now, depaneledBy: ctx.user.id }).where(eq(smtPanel.id, p.id));
    let job = null;
    if (input.printerId) job = await this.printBoards(tx, ctx, entityId, p.id, input.printerId);
    return { panel: p.code, step: 'depaneled', at: now, notLoaded: [], job };
  }

  async printBoards(tx: Tx, ctx: TenantRequestContext, entityId: string, panelId: string, printerId: string) {
    const [p] = await tx.select().from(smtPanel).where(and(eq(smtPanel.id, panelId), eq(smtPanel.entityId, entityId)));
    if (!p) throw new NotFoundException('Panel not found');
    const boards = await tx.select().from(smtBoard).where(and(eq(smtBoard.panelId, p.id), isNull(smtBoard.scrappedAt))).orderBy(asc(smtBoard.position));
    if (!boards.length) throw new ConflictException(`Every board of ${p.code} is scrapped`);
    const [it] = await tx.select().from(item).where(eq(item.id, boards[0]!.itemId));
    const [wo] = await tx.select({ bomId: workOrder.bomId }).from(workOrder).where(eq(workOrder.id, p.workOrderId));
    const [b] = wo?.bomId ? await tx.select({ revision: bom.revision }).from(bom).where(eq(bom.id, wo.bomId)) : [];
    return this.labels.queue(tx, ctx, entityId, printerId, {
      kind: 'board',
      sourceId: p.id,
      label: `Boards of ${p.code}`,
      render: (size) => boards.map((bd) => boardLabel({ serial: bd.serialNo, item: it!.code, revision: b?.revision ?? it!.revision }, size)).join('\n'),
    });
  }

  async scrapBoard(tx: Tx, ctx: TenantRequestContext, entityId: string, serial: string, reason: string) {
    const rows = await tx.select().from(smtBoard).where(and(eq(smtBoard.entityId, entityId), eq(smtBoard.serialNo, serial.trim()))).for('update');
    if (!rows.length) throw new NotFoundException(`No board ${serial}`);
    if (rows.length > 1) throw new ConflictException(`${serial} is ambiguous across items`);
    const bd = rows[0]!;
    if (bd.batchId) throw new ConflictException(`${serial} is already in stock; scrap it through stock or an NCR`);
    if (bd.scrappedAt) throw new ConflictException(`${serial} is already scrapped`);
    await tx.update(smtBoard).set({ scrappedAt: new Date(), scrappedBy: ctx.user.id, scrapReason: reason }).where(eq(smtBoard.id, bd.id));
    await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'smt_board.scrap', targetType: 'smt_board', targetId: bd.id, after: { serial, reason } }, tx);
    return { serial, scrapped: true };
  }

  // ── Output (called by the work order's output) ──

  /**
   * The boards a panelized work order's output takes: the given serials, or the oldest depaneled boards. Each must be
   * depaneled, not scrapped and not yet output. Null when the order is not panelized.
   */
  async boardsForOutput(tx: Tx, woId: string, bomId: string | null, units: number, serials?: string[]) {
    if (!bomId) return null;
    const [b] = await tx.select({ per: bom.boardsPerPanel }).from(bom).where(eq(bom.id, bomId));
    if (!b?.per) return null;
    const eligible = await tx
      .select({ id: smtBoard.id, serialNo: smtBoard.serialNo })
      .from(smtBoard)
      .innerJoin(smtPanel, eq(smtPanel.id, smtBoard.panelId))
      .where(and(eq(smtBoard.workOrderId, woId), isNull(smtBoard.batchId), isNull(smtBoard.scrappedAt), isNotNull(smtPanel.depaneledAt)))
      .orderBy(asc(smtPanel.seq), asc(smtBoard.position))
      .for('update', { of: smtBoard });
    if (serials?.length) {
      if (new Set(serials).size !== serials.length) throw new BadRequestException('A board is listed twice');
      if (serials.length !== units) throw new BadRequestException(`Scan ${units} board${units === 1 ? '' : 's'} for this output`);
      const picked = serials.map((s) => eligible.find((e) => e.serialNo === s.trim()));
      const bad = serials.filter((_, i) => !picked[i]);
      if (bad.length) throw new ConflictException(`Not waiting for output (not depaneled, scrapped, already output or another order's): ${bad.join(', ')}`);
      return picked as { id: string; serialNo: string }[];
    }
    if (eligible.length < units) throw new ConflictException(`Only ${eligible.length} depaneled board${eligible.length === 1 ? ' is' : 's are'} waiting for output`);
    return eligible.slice(0, units);
  }

  async attachOutput(tx: Tx, boards: { id: string }[], batchIds: (string | null)[]) {
    for (const [k, bd] of boards.entries()) await tx.update(smtBoard).set({ batchId: batchIds[k]! }).where(eq(smtBoard.id, bd.id));
  }

  /** A cancelled output frees its boards for a later output (their serial batches are reused). */
  async detachOutput(tx: Tx, batchIds: string[]) {
    if (batchIds.length) await tx.update(smtBoard).set({ batchId: null }).where(inArray(smtBoard.batchId, batchIds));
  }

  // ── Trace ──

  /** A board's SMT history: its panel, the scans, and the containers on its machine when its panel was placed. */
  async boardTrace(db: Db, entityId: string, batchId: string) {
    const [bd] = await db.select().from(smtBoard).where(and(eq(smtBoard.entityId, entityId), eq(smtBoard.batchId, batchId)));
    if (!bd) return null;
    return this.traceOf(db, bd);
  }

  async boardTraceBySerial(db: Db, entityId: string, serial: string) {
    const [bd] = await db.select().from(smtBoard).where(and(eq(smtBoard.entityId, entityId), eq(smtBoard.serialNo, serial.trim())));
    if (!bd) throw new NotFoundException(`No board ${serial}`);
    return this.traceOf(db, bd);
  }

  private async traceOf(db: Db, bd: typeof smtBoard.$inferSelect) {
    const [p] = await db.select().from(smtPanel).where(eq(smtPanel.id, bd.panelId));
    const [wo] = await db.select({ id: workOrder.id, number: workOrder.number }).from(workOrder).where(eq(workOrder.id, bd.workOrderId));
    let reels: unknown[] = [];
    if (p!.placedAt && p!.machineId) {
      const loads = await db
        .select({ l: smtFeederLoad, c: smtContainer })
        .from(smtFeederLoad)
        .innerJoin(smtContainer, eq(smtContainer.id, smtFeederLoad.containerId))
        .where(and(eq(smtFeederLoad.workOrderId, bd.workOrderId), eq(smtFeederLoad.machineId, p!.machineId)));
      const seen = loadsAt(loads.map((x) => ({ ...x.l, containerId: x.c.id, row: x })), p!.placedAt);
      reels = [];
      for (const s of seen.sort((a, b) => a.slot.localeCompare(b.slot))) {
        const d = await this.describe(db, s.row.c, p!.placedAt);
        reels.push({ slot: s.slot, loadedAt: s.loadedAt, unloadedAt: s.unloadedAt, container: { id: d.id, code: d.code, kind: d.kind }, itemCode: d.itemCode, itemName: d.itemName, batchId: d.batchId, batchNo: d.batchNo, supplierBatchNo: d.supplierBatchNo, mslLevel: d.mslLevel, atPlacement: d.status });
      }
    }
    const [m] = p!.machineId ? await db.select({ code: machine.code }).from(machine).where(eq(machine.id, p!.machineId)) : [];
    return {
      serialNo: bd.serialNo,
      position: bd.position,
      batchId: bd.batchId,
      scrappedAt: bd.scrappedAt,
      scrapReason: bd.scrapReason,
      workOrder: wo,
      panel: { id: p!.id, code: p!.code, placedAt: p!.placedAt, depaneledAt: p!.depaneledAt, machine: m?.code ?? null },
      reels,
    };
  }

  /** Boards built while a container was loaded: for a recall from a reel, or (with `byBatch`) from a whole lot. */
  async boardsOf(db: Db, entityId: string, ids: { containerId?: string; batchId?: string }) {
    const containers = ids.containerId
      ? await db.select().from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.id, ids.containerId)))
      : await db.select().from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.batchId, ids.batchId!)));
    if (!containers.length) return [];
    const loads = await db.select().from(smtFeederLoad).where(inArray(smtFeederLoad.containerId, containers.map((c) => c.id)));
    const out = new Map<string, { serialNo: string; batchId: string | null; scrapped: boolean; panel: string; workOrder: string | null; placedAt: Date; via: string }>();
    for (const l of loads) {
      const panels = await db
        .select({ p: smtPanel, wo: workOrder.number })
        .from(smtPanel)
        .innerJoin(workOrder, eq(workOrder.id, smtPanel.workOrderId))
        .where(
          and(
            eq(smtPanel.workOrderId, l.workOrderId),
            eq(smtPanel.machineId, l.machineId),
            sql`${smtPanel.placedAt} >= ${l.loadedAt}`,
            l.unloadedAt ? sql`${smtPanel.placedAt} < ${l.unloadedAt}` : undefined,
          ),
        );
      for (const { p, wo } of panels) {
        const boards = await db.select().from(smtBoard).where(eq(smtBoard.panelId, p.id)).orderBy(asc(smtBoard.position));
        const via = containers.find((c) => c.id === l.containerId)!.code;
        for (const bd of boards) out.set(bd.id, { serialNo: bd.serialNo, batchId: bd.batchId, scrapped: !!bd.scrappedAt, panel: p.code, workOrder: wo, placedAt: p.placedAt!, via });
      }
    }
    return [...out.values()].sort((a, b) => a.serialNo.localeCompare(b.serialNo));
  }

  /** Containers sorted by floor life left (open and in-cabinet reels first), for the MSL board and the list. */
  async list(db: Db, entityId: string, opts: { q?: string; includeEmpty?: boolean }) {
    const rows = await db.select().from(smtContainer).where(eq(smtContainer.entityId, entityId)).orderBy(desc(smtContainer.createdAt)).limit(500);
    const now = new Date();
    type Row = { id: string; kind: 'reel' | 'paste'; code: string; itemCode: string; itemName: string; batchNo: string; mslLevel: string | null; qty: string; status: ContainerStatus; load: Awaited<ReturnType<SmtService['describe']>>['load'] };
    const out: Row[] = [];
    for (const c of rows) {
      const d = await this.describe(db, c, now);
      if (!opts.includeEmpty && d.status.phase === 'empty') continue;
      if (opts.q && ![d.code, d.itemCode, d.batchNo].some((s) => s.toLowerCase().includes(opts.q!.toLowerCase()))) continue;
      out.push({ id: d.id, kind: d.kind, code: d.code, itemCode: d.itemCode, itemName: d.itemName, batchNo: d.batchNo, mslLevel: d.mslLevel, qty: d.qty, status: d.status, load: d.load });
    }
    const left = (x: (typeof out)[number]) => x.status.clock?.remainingMinutes ?? (x.status.paste?.openUntil ? (x.status.paste.openUntil.getTime() - now.getTime()) / 60_000 : Number.POSITIVE_INFINITY);
    return out.sort((a, b) => left(a) - left(b));
  }

  /** What a scanned code is: a panel, a board, or a container. */
  async resolve(db: Db, entityId: string, code: string) {
    const c = code.trim();
    const [p] = await db.select({ id: smtPanel.id, workOrderId: smtPanel.workOrderId }).from(smtPanel).where(and(eq(smtPanel.entityId, entityId), eq(smtPanel.code, c)));
    if (p) return { kind: 'panel' as const, id: p.id, workOrderId: p.workOrderId, code: c };
    const [bd] = await db.select({ id: smtBoard.id, workOrderId: smtBoard.workOrderId, batchId: smtBoard.batchId }).from(smtBoard).where(and(eq(smtBoard.entityId, entityId), eq(smtBoard.serialNo, c)));
    if (bd) return { kind: 'board' as const, id: bd.id, workOrderId: bd.workOrderId, batchId: bd.batchId, code: c };
    const [ct] = await db.select({ id: smtContainer.id }).from(smtContainer).where(and(eq(smtContainer.entityId, entityId), eq(smtContainer.code, c)));
    if (ct) return { kind: 'container' as const, id: ct.id, code: c };
    throw new NotFoundException(`${c} is not a panel, board, reel or paste jar here`);
  }

}
