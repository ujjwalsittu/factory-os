import { GST_STATES, validateGstin, isValidPan } from '@factoryos/compliance-in';
import {
  readTallyXml,
  tallyRoot,
  toTallyMaster,
  toTallyVoucher,
  unpackTallyFiles,
  TallyArchiveTooLarge,
  type TallyGroup,
  type TallyGodown,
  type TallyLedger,
  type TallyMaster,
  type TallyStockItem,
  type TallyUnit,
  type TallyVoucher,
} from '@factoryos/core/tally';
import {
  accountGroup,
  accountingSettings,
  glAccount,
  openingWorksheet,
  item,
  party,
  tallyImport,
  tallyLink,
  tallyStaged,
  tallyVoucher,
  uom,
  warehouse,
  type Database,
} from '@factoryos/db';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TenantRequestContext } from '../../common/access.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../common/tokens.js';
import { lockAccounting, type Db, type Tx } from '../accounting/accounting-lock.js';
import { seedChart, STANDARD_GROUPS } from '../accounting/chart.js';
import { GlPostingService } from '../accounting/gl-posting.service.js';
import { itemInput, normaliseParty, partyInput } from '../masters.controller.js';
import { OpeningWriter, openingActions, openingSummary, stageOpenings } from './tally-openings.js';
import { notInExport, stageVouchers, writeVouchers } from './tally-vouchers.js';

/**
 * Decision 072: Tally XML imports. An import reads the files into staged rows, proposes an action for each
 * (new, link, update, unchanged, conflict, skip), lets the user change them, and commits all of it in one
 * transaction. Tally GUIDs linked here make every later import of the same company duplicate-free.
 */

export type Kind = 'group' | 'ledger' | 'party' | 'stockgroup' | 'unit' | 'godown' | 'stockitem' | 'opening' | 'stock' | 'voucher';
export type Action = 'new' | 'link' | 'update' | 'unchanged' | 'conflict' | 'skip';
type Candidate = { id: string; label: string; reason: string };
type Root = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Order of commit: parents and units before what refers to them. Opening balances and stock are written after all of these. */
const KIND_ORDER: Kind[] = ['group', 'ledger', 'party', 'unit', 'godown', 'stockgroup', 'stockitem'];
/** Readable names for Tally objects this import does not read. */
const TAG_NAMES: Record<string, string> = { VOUCHERTYPE: 'voucher type', COSTCENTRE: 'cost centre', COSTCATEGORY: 'cost category', CURRENCY: 'currency', BUDGET: 'budget', EMPLOYEE: 'employee', ATTENDANCETYPE: 'attendance type' };
/** Ledgers whose balance FactoryOS computes itself. */
const COMPUTED_LEDGERS = new Set(['profit & loss a/c']);
const STATE_CODE = new Map(Object.entries(GST_STATES).map(([code, name]) => [name.toLowerCase(), code]));

/** Common spellings of the same unit in Tally and FactoryOS, so "Kgs (Kilograms)" links to KG instead of duplicating it. */
const UNIT_SYNONYMS: string[][] = [
  ['nos', 'no', 'no.', 'number', 'numbers'],
  ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo'],
  ['g', 'gm', 'gms', 'gram', 'grams'],
  ['m', 'mtr', 'mtrs', 'metre', 'metres', 'meter', 'meters'],
  ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'],
  ['l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters'],
  ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  ['sqm', 'sq m', 'sq.m', 'square metre', 'square metres', 'square meter', 'square meters'],
  ['set', 'sets'],
  ['box', 'boxes'],
  ['reel', 'reels'],
  ['hr', 'hrs', 'hour', 'hours'],
  ['day', 'days'],
];
const unitKey = (s: string | null | undefined) => {
  const n = (s ?? '').trim().toLowerCase();
  return UNIT_SYNONYMS.find((g) => g.includes(n))?.[0] ?? n;
};
const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/** A code built from a name: upper case letters and digits, the separators the masters allow, and a length cap. */
function codeFrom(name: string, max: number, extra = '') {
  const base = name.toUpperCase().replace(/&/g, ' AND ').replace(new RegExp(`[^A-Z0-9${extra}]+`, 'g'), '-').replace(/^[^A-Z0-9]+|-+$/g, '');
  return (base || 'TALLY').slice(0, max).replace(/-+$/, '');
}

interface StagedInput {
  kind: Kind;
  guid: string | null;
  alterId: number | null;
  name: string;
  payload: Record<string, unknown>;
  proposed: Action;
  targetId: string | null;
  candidates: Candidate[];
  notes: string[];
}

export interface DecisionInput {
  id: string;
  action: Action;
  targetId?: string | null;
}

@Injectable()
export class TallyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly gl: GlPostingService,
  ) {}

  // ── Read and stage ──

  async read(ctx: TenantRequestContext, entityId: string, files: { name: string; bytes: Uint8Array }[]) {
    if (!files.length) throw new BadRequestException('Choose one or more Tally XML files');
    let unpacked: ReturnType<typeof unpackTallyFiles>;
    try {
      unpacked = unpackTallyFiles(files);
    } catch (e) {
      if (e instanceof TallyArchiveTooLarge) throw new BadRequestException(e.message);
      throw e;
    }
    if (!unpacked.length) throw new BadRequestException('The upload holds no .xml files');
    const warnings: string[] = [];
    const masters: TallyMaster[] = [];
    const vouchers: TallyVoucher[] = [];
    const skippedTags = new Map<string, number>();
    let company: string | null = null;
    for (const f of unpacked) {
      const r = readTallyXml(f.xml);
      company ??= r.company;
      warnings.push(...r.warnings.map((w) => `${f.name}: ${w}`));
      for (const o of r.objects) {
        const m = toTallyMaster(o);
        const v = m ? null : toTallyVoucher(o);
        if (m && m.name) masters.push(m);
        else if (v) vouchers.push(v);
        else skippedTags.set(o.tag, (skippedTags.get(o.tag) ?? 0) + 1);
      }
    }
    for (const [tag, n] of skippedTags)
      warnings.push(`${n} ${(TAG_NAMES[tag] ?? tag.toLowerCase()) + (n === 1 ? '' : 's')} not imported (not used by FactoryOS yet).`);
    if (!masters.length && !vouchers.length)
      throw new BadRequestException({ message: 'No Tally masters or vouchers were found in the upload', issues: warnings.map((w) => ({ path: 'files', message: w })) });
    const deduped = this.lastOfEachGuid(masters, warnings);
    const dedupedVouchers = this.lastOfEachGuid(vouchers, warnings);

    return this.db.transaction(async (tx) => {
      // The standard chart may not exist yet in a new workspace; Tally's groups are matched against it.
      await lockAccounting(tx, entityId);
      await seedChart(tx, ctx, entityId);
      const staged = [...(await this.match(tx, ctx, entityId, deduped)), ...(await stageVouchers(tx, entityId, dedupedVouchers))];
      const counts = this.countActions(staged);
      const [imp] = await tx
        .insert(tallyImport)
        .values({
          tenantId: ctx.tenant.tenantId,
          entityId,
          files: files.map((f) => ({ name: f.name, sha256: createHash('sha256').update(f.bytes).digest('hex'), bytes: f.bytes.byteLength })),
          company,
          counts,
          warnings,
          createdBy: ctx.user.id,
        })
        .returning();
      for (let i = 0; i < staged.length; i += 500)
        await tx.insert(tallyStaged).values(
          staged.slice(i, i + 500).map((s, j) => ({ ...s, tenantId: ctx.tenant.tenantId, entityId, importId: imp!.id, ordinal: i + j, action: s.proposed })),
        );
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounts.tally.read', targetType: 'tally_import', targetId: imp!.id, after: { files: imp!.files, counts } }, tx);
      return imp!;
    });
  }

  /** The same GUID twice (two files from overlapping exports): keep the highest ALTERID. */
  private lastOfEachGuid<T extends { guid: string | null; alterId: number | null }>(masters: T[], warnings: string[]) {
    const byGuid = new Map<string, T>();
    const out: T[] = [];
    let dupes = 0;
    for (const m of masters) {
      if (!m.guid) {
        out.push(m);
        continue;
      }
      const prior = byGuid.get(m.guid);
      if (prior) dupes++;
      if (!prior || (m.alterId ?? 0) >= (prior.alterId ?? 0)) byGuid.set(m.guid, m);
    }
    if (dupes) warnings.push(`${dupes} object${dupes === 1 ? '' : 's'} appeared more than once in the upload (Tally repeats some masters within an export, and exports can overlap); the latest version of each is used.`);
    return [...out, ...byGuid.values()];
  }

  private countActions(staged: { kind: string; proposed: string }[]) {
    const counts: Record<string, number> = {};
    for (const s of staged) counts[`${s.kind}.${s.proposed}`] = (counts[`${s.kind}.${s.proposed}`] ?? 0) + 1;
    return counts;
  }

  // ── Matching ──

  private async match(tx: Db, ctx: TenantRequestContext, entityId: string, masters: TallyMaster[]): Promise<StagedInput[]> {
    const tenantId = ctx.tenant.tenantId;
    const [links, groups, ledgers, parties, units, godowns, items] = await Promise.all([
      tx.select().from(tallyLink).where(eq(tallyLink.entityId, entityId)),
      tx.select().from(accountGroup).where(eq(accountGroup.entityId, entityId)),
      tx.select().from(glAccount).where(eq(glAccount.entityId, entityId)),
      tx.select().from(party).where(eq(party.tenantId, tenantId)),
      tx.select().from(uom).where(eq(uom.tenantId, tenantId)),
      tx.select().from(warehouse).where(eq(warehouse.entityId, entityId)),
      tx.select().from(item).where(eq(item.tenantId, tenantId)),
    ]);
    const link = (kind: Kind, guid: string | null) => (guid ? links.find((l) => l.kind === kind && l.guid === guid) : undefined);

    // Group classification comes from Tally's own tree, so it is known before anything is written.
    const tallyGroups = masters.filter((m): m is TallyGroup => m.kind === 'group');
    const exportUnits = new Set(masters.filter((m) => m.kind === 'unit').map((m) => m.name));
    const groupParent = groupTree(tallyGroups, groups);
    const nature = primaryNatures(tallyGroups);
    const rootOf = (name: string | null) => (name ? (tallyRoot(name, (n) => groupParent.get(n), (n) => nature.get(n)) as Root | null) : null);
    const under = (name: string | null, target: string) => {
      const seen = new Set<string>();
      for (let c = name; c && !seen.has(c); c = groupParent.get(c) ?? null) {
        if (c === target) return true;
        seen.add(c);
      }
      return false;
    };

    const out: StagedInput[] = [];
    const base = (m: TallyMaster, kind: Kind): Omit<StagedInput, 'proposed' | 'targetId' | 'candidates' | 'notes'> => ({
      kind,
      guid: m.guid,
      alterId: m.alterId,
      name: m.name,
      payload: m as unknown as Record<string, unknown>,
    });
    /** A GUID linked before decides: unchanged, update (newer ALTERID), or new again when its record is gone. */
    const fromLink = (kind: Kind, m: TallyMaster, exists: (id: string) => string | null): Partial<StagedInput> | null => {
      const l = link(kind, m.guid);
      if (!l) return null;
      const label = exists(l.targetId);
      if (!label) return { proposed: 'conflict', candidates: [], notes: ['Linked in an earlier import, but that record no longer exists.'] };
      const newer = (m.alterId ?? 0) > (l.alterId ?? 0);
      return { proposed: newer ? 'update' : 'unchanged', targetId: l.targetId, candidates: [{ id: l.targetId, label, reason: 'Linked in an earlier import' }] };
    };
    const decide = (cands: Candidate[], notes: string[] = []): Partial<StagedInput> =>
      cands.length === 1
        ? { proposed: 'link', targetId: cands[0]!.id, candidates: cands, notes }
        : cands.length > 1
          ? { proposed: 'conflict', candidates: cands, notes: [...notes, 'More than one record matches; choose one, or create a new one.'] }
          : { proposed: 'new', candidates: [], notes };
    const push = (m: TallyMaster, kind: Kind, r: Partial<StagedInput>) =>
      out.push({ ...base(m, kind), proposed: r.proposed ?? 'new', targetId: r.targetId ?? null, candidates: r.candidates ?? [], notes: r.notes ?? [] });

    for (const m of masters) {
      switch (m.kind) {
        case 'group': {
          const root = rootOf(m.name);
          const fl = fromLink('group', m, (id) => groups.find((g) => g.id === id)?.name ?? null);
          if (fl) {
            push(m, 'group', fl);
            break;
          }
          if (!root) {
            push(m, 'group', { proposed: 'conflict', notes: [`Its parent group "${m.parent}" is not in the export, so its classification is unknown. Skip it, or export all masters.`] });
            break;
          }
          const same = groups.filter((g) => norm(g.name) === norm(m.name));
          const fit = same.filter((g) => g.root === root);
          if (fit.length || !same.length) push(m, 'group', decide(fit.map((g) => ({ id: g.id, label: `${g.name} (${g.root})`, reason: 'Same name and classification' }))));
          else push(m, 'group', { proposed: 'conflict', candidates: [], notes: [`A group named "${same[0]!.name}" exists as ${same[0]!.root}, but in Tally it is ${root}. Create a separate group or skip.`] });
          break;
        }
        case 'ledger': {
          if (under(m.parent, 'Sundry Debtors') || under(m.parent, 'Sundry Creditors')) {
            push(m, 'party', this.matchParty(m, under(m.parent, 'Sundry Debtors'), parties, fromLink));
            break;
          }
          const root = rootOf(m.parent);
          const fl = fromLink('ledger', m, (id) => ledgers.find((a) => a.id === id)?.name ?? null);
          if (fl) {
            push(m, 'ledger', fl);
            break;
          }
          if (COMPUTED_LEDGERS.has(norm(m.name)) || m.reservedName === 'Profit & Loss A/c') {
            push(m, 'ledger', { proposed: 'skip', notes: ['FactoryOS works out profit and loss itself.'] });
            break;
          }
          if (!root) {
            push(m, 'ledger', { proposed: 'conflict', notes: [`Its group "${m.parent}" is not in the export, so its classification is unknown. Skip it, or export all masters.`] });
            break;
          }
          const groupRoot = (id: string) => groups.find((g) => g.id === id)?.root;
          const named = ledgers.filter((a) => norm(a.name) === norm(m.name) || m.aliases.some((x) => a.code === x.toUpperCase()));
          const fit = named.filter((a) => groupRoot(a.groupId) === root);
          const taxLedger = m.taxType === 'GST' || under(m.parent, 'Duties & Taxes');
          // Tally keeps input tax under Duties & Taxes; FactoryOS keeps it under Input tax credits. Same name, same ledger.
          if (taxLedger && named.length === 1 && !fit.length) {
            push(m, 'ledger', decide([{ id: named[0]!.id, label: `${named[0]!.name} · ${named[0]!.code}`, reason: 'Same tax ledger name' }]));
            break;
          }
          if (named.length && !fit.length) {
            push(m, 'ledger', { proposed: 'conflict', notes: [`A ledger named "${named[0]!.name}" exists with a different classification. Create a separate ledger or skip.`] });
            break;
          }
          if (!fit.length && taxLedger) {
            push(m, 'ledger', {
              proposed: 'skip',
              notes: ['Tax ledgers are matched to the posting ledgers (Input/Output CGST, TDS payable…) when opening balances are imported. Choose Create only for a tax ledger FactoryOS does not have.'],
            });
            break;
          }
          push(m, 'ledger', decide(fit.map((a) => ({ id: a.id, label: `${a.name} · ${a.code}`, reason: 'Same name and classification' }))));
          break;
        }
        case 'unit': {
          const fl = fromLink('unit', m, (id) => units.find((u) => u.id === id)?.code ?? null);
          if (fl) {
            push(m, 'unit', fl);
            break;
          }
          const cands = units
            .filter((u) => {
              const mine = new Set([unitKey(u.code), unitKey(u.name)]);
              return mine.has(unitKey(m.name)) || (!!m.formalName && mine.has(unitKey(m.formalName)));
            })
            .map((u) => ({ id: u.id, label: `${u.code} · ${u.name}`, reason: 'Same code or name' }));
          push(m, 'unit', m.simple ? decide(cands) : { proposed: 'skip', notes: ['Compound units (such as "Box of 10 Nos") are not imported; items use their base unit.'] });
          break;
        }
        case 'godown': {
          const fl = fromLink('godown', m, (id) => warehouses(godowns, id));
          if (fl) {
            push(m, 'godown', fl);
            break;
          }
          push(m, 'godown', decide(godowns.filter((w) => norm(w.name) === norm(m.name) || norm(w.code) === norm(codeFrom(m.name, 20))).map((w) => ({ id: w.id, label: `${w.code} · ${w.name}`, reason: 'Same name' }))));
          break;
        }
        case 'stockgroup':
          push(m, 'stockgroup', { proposed: 'skip', notes: ['FactoryOS has no item groups yet; the stock group stays with each item in the import record.'] });
          break;
        case 'stockitem': {
          const fl = fromLink('stockitem', m, (id) => items.find((i) => i.id === id)?.code ?? null);
          if (fl) {
            push(m, 'stockitem', fl);
            break;
          }
          const keys = new Set([m.name, ...m.aliases].map((x) => x.toUpperCase()));
          const cands = items
            .filter((i) => keys.has(i.code) || norm(i.name) === norm(m.name))
            .map((i) => ({ id: i.id, label: `${i.code} · ${i.name}`, reason: keys.has(i.code) ? 'Same code' : 'Same name' }));
          const notes = cands.length ? [] : ['Created as raw material; change the item type after the import if needed.'];
          if (!m.unit) notes.push('Tally gives no unit for this item. Link it to an existing item, or skip it.');
          // The commit finds units among the export's units and FactoryOS's unit codes; anything else cannot be saved.
          const unitKnown = !m.unit || exportUnits.has(m.unit) || units.some((u) => u.code === m.unit);
          if (!unitKnown) notes.push(`Its unit "${m.unit}" is not in the export. Export the units too, or skip the item.`);
          push(m, 'stockitem', !cands.length && (!m.unit || !unitKnown) ? { proposed: 'conflict', notes } : decide(cands, notes));
          break;
        }
      }
    }
    // Two Tally ledgers with one GSTIN become one FactoryOS party: the first creates it, the next links to it.
    const firstByGstin = new Map<string, string>();
    for (const r of out) {
      if (r.kind !== 'party' || r.proposed !== 'new') continue;
      const g = (r.payload as unknown as TallyLedger).gstin;
      const v = g ? validateGstin(g) : null;
      if (!v?.valid) continue;
      const first = firstByGstin.get(v.gstin);
      if (first) r.notes.push(`Same GSTIN as "${first}" in this export; both are saved as one party.`);
      else firstByGstin.set(v.gstin, r.name);
    }
    // Groups first (by depth), then the rest in commit order: the preview and the commit read the same sequence.
    const depth = (name: string) => {
      let d = 0;
      const seen = new Set<string>();
      for (let c = groupParent.get(name) ?? null; c && !seen.has(c); c = groupParent.get(c) ?? null) seen.add(c), d++;
      return d;
    };
    out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.kind === 'group' ? depth(a.name) - depth(b.name) : 0) || a.name.localeCompare(b.name));
    // Opening balances and stock follow the masters' proposals (decisions 072 and 073).
    const openings = await stageOpenings(tx, entityId, masters, out, under);
    return [...out, ...openings.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'opening' ? -1 : 1))];
  }

  private matchParty(
    m: TallyLedger,
    debtor: boolean,
    parties: (typeof party.$inferSelect)[],
    fromLink: (kind: Kind, m: TallyMaster, exists: (id: string) => string | null) => Partial<StagedInput> | null,
  ): Partial<StagedInput> {
    const fl = fromLink('party', m, (id) => parties.find((p) => p.id === id)?.name ?? null);
    if (fl) return fl;
    const notes: string[] = [];
    const g = m.gstin ? validateGstin(m.gstin) : null;
    if (g && !g.valid) notes.push(`Tally GSTIN ${m.gstin} is not valid (${g.reason}); a new party is created without it.`);
    const pan = (g?.valid ? g.pan : m.pan) ?? null;
    const label = (p: (typeof party.$inferSelect)) => `${p.code} · ${p.name}${p.gstin ? ` · ${p.gstin}` : ''}`;
    let cands: Candidate[] = [];
    if (g?.valid) cands = parties.filter((p) => p.gstin === g.gstin).map((p) => ({ id: p.id, label: label(p), reason: 'Same GSTIN' }));
    if (!cands.length && pan && isValidPan(pan))
      cands = parties.filter((p) => !p.gstin && p.pan === pan).map((p) => ({ id: p.id, label: label(p), reason: 'Same PAN' }));
    if (!cands.length)
      cands = parties
        .filter((p) => norm(p.name) === norm(m.name) && (!g?.valid || !p.gstin))
        .map((p) => ({ id: p.id, label: label(p), reason: 'Same name' }));
    // A name match against a party holding a different GSTIN is never linked silently.
    const sameNameOtherGstin = g?.valid && !cands.length && parties.some((p) => norm(p.name) === norm(m.name) && p.gstin && p.gstin !== g.gstin);
    if (sameNameOtherGstin) notes.push('A party with this name exists with a different GSTIN; a separate party is created.');
    const only = cands.length === 1 ? parties.find((p) => p.id === cands[0]!.id)! : null;
    if (only && !only.gstin && g?.valid) notes.push(`The linked party has no GSTIN; ${g.gstin} from Tally is added.`);
    const role = debtor ? 'isCustomer' : 'isSupplier';
    const missingRole = cands.length === 1 && !parties.find((p) => p.id === cands[0]!.id)![role];
    if (missingRole) notes.push(`The linked party is marked as a ${debtor ? 'customer' : 'supplier'} too.`);
    if (g && !g.valid && !cands.length) return { proposed: 'conflict', candidates: [], notes };
    return cands.length === 1
      ? { proposed: 'link', targetId: cands[0]!.id, candidates: cands, notes }
      : cands.length > 1
        ? { proposed: 'conflict', candidates: cands, notes: [...notes, 'More than one party matches; choose one, or create a new one.'] }
        : { proposed: 'new', candidates: [], notes };
  }

  // ── Reads ──

  async list(entityId: string) {
    return this.db.select().from(tallyImport).where(eq(tallyImport.entityId, entityId)).orderBy(sql`${tallyImport.createdAt} desc`).limit(50);
  }

  async get(entityId: string, id: string, db: Db = this.db) {
    const [imp] = await db.select().from(tallyImport).where(and(eq(tallyImport.id, id), eq(tallyImport.entityId, entityId)));
    if (!imp) throw new NotFoundException('Import not found');
    const rows = await db
      .select({ kind: tallyStaged.kind, action: tallyStaged.action, n: sql<number>`count(*)::int` })
      .from(tallyStaged)
      .where(eq(tallyStaged.importId, id))
      .groupBy(tallyStaged.kind, tallyStaged.action);
    const current: Record<string, number> = {};
    for (const r of rows) current[`${r.kind}.${r.action}`] = r.n;
    return { ...imp, current, openings: await this.openings(db, entityId, id), missing: await notInExport(db, entityId, id) };
  }

  /** Opening balances and stock as currently decided, with what the commit would replace; null when there are none. */
  private async openings(db: Db, entityId: string, id: string) {
    const rows = await db
      .select({ kind: tallyStaged.kind, action: tallyStaged.action, payload: tallyStaged.payload })
      .from(tallyStaged)
      .where(and(eq(tallyStaged.importId, id), inArray(tallyStaged.kind, ['opening', 'stock'])));
    if (!rows.length) return null;
    const [w] = await db.select().from(openingWorksheet).where(eq(openingWorksheet.entityId, entityId));
    const [settings] = await db.select({ active: accountingSettings.active }).from(accountingSettings).where(eq(accountingSettings.entityId, entityId));
    return { ...openingSummary(rows), active: !!settings?.active, worksheet: { lines: w?.lines.length ?? 0, bills: w?.bills.length ?? 0 } };
  }

  async rows(entityId: string, id: string, f: { kind?: Kind; action?: Action; q?: string; offset: number; limit: number }) {
    await this.get(entityId, id);
    const where = and(
      eq(tallyStaged.importId, id),
      eq(tallyStaged.entityId, entityId),
      f.kind ? eq(tallyStaged.kind, f.kind) : undefined,
      f.action ? eq(tallyStaged.action, f.action) : undefined,
      f.q ? sql`${tallyStaged.name} ilike ${'%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'}` : undefined,
    );
    const [{ total }] = (await this.db.select({ total: sql<number>`count(*)::int` }).from(tallyStaged).where(where)) as [{ total: number }];
    const data = await this.db.select().from(tallyStaged).where(where).orderBy(asc(tallyStaged.ordinal)).offset(f.offset).limit(f.limit);
    return { total, data };
  }

  // ── Decisions ──

  async decide(ctx: TenantRequestContext, entityId: string, id: string, decisions: DecisionInput[]) {
    return this.db.transaction(async (tx) => {
      const imp = await this.openImport(tx, entityId, id);
      const rows = await tx.select().from(tallyStaged).where(and(eq(tallyStaged.importId, imp.id), inArray(tallyStaged.id, decisions.map((d) => d.id))));
      if (rows.length !== new Set(decisions.map((d) => d.id)).size) throw new BadRequestException('Some rows are not part of this import');
      for (const d of decisions) {
        const row = rows.find((r) => r.id === d.id)!;
        const allowed = this.allowedActions(row);
        if (row.kind === 'opening' && d.action === 'new' && row.proposed === 'conflict')
          throw new BadRequestException(`"${row.name}" is not imported as a ledger; choose the ledger that takes its balance, or skip it`);
        if (!allowed.includes(d.action)) throw new BadRequestException(`"${row.name}" cannot be set to ${d.action}`);
        if (d.action === 'new' && row.kind === 'stockitem' && !(row.payload as unknown as TallyStockItem).unit)
          throw new BadRequestException(`"${row.name}" has no unit in Tally, so it cannot be created. Link it to an existing item, or skip it.`);
        let targetId: string | null = null;
        if (d.action === 'link' || d.action === 'update' || d.action === 'unchanged') {
          if (row.kind === 'voucher') {
            // A voucher only re-syncs onto the history row with its own GUID; the choice of target is not the client's.
            const [own] = await tx
              .select({ id: tallyVoucher.id })
              .from(tallyVoucher)
              .where(and(eq(tallyVoucher.entityId, entityId), eq(tallyVoucher.guid, row.guid ?? '')));
            if (!own || (d.targetId && d.targetId !== own.id)) throw new BadRequestException(`"${row.name}" can only update its own Tally history`);
            await tx.update(tallyStaged).set({ action: d.action, targetId: own.id }).where(eq(tallyStaged.id, row.id));
            continue;
          }
          targetId = d.targetId ?? row.targetId;
          if (!targetId) throw new BadRequestException(`Choose the FactoryOS record to link "${row.name}" to`);
          const taken = await this.assertTarget(tx, ctx, entityId, row.kind as Kind, targetId);
          if (taken && taken.guid !== row.guid && row.kind !== 'party') throw new BadRequestException(`That record is already linked to the Tally ${row.kind} "${taken.name}"`);
        }
        await tx.update(tallyStaged).set({ action: d.action, targetId }).where(eq(tallyStaged.id, row.id));
      }
      return this.get(entityId, id, tx);
    });
  }

  /** What a row may be set to: never back to conflict; update/unchanged only for rows linked by GUID before. */
  allowedActions(row: { proposed: string; kind: string; payload?: unknown }): Action[] {
    if (row.kind === 'stockgroup') return ['skip'];
    if (row.kind === 'opening' || row.kind === 'stock') return openingActions({ ...row, payload: row.payload });
    if (row.kind === 'voucher') return row.proposed === 'update' || row.proposed === 'unchanged' ? ['update', 'unchanged', 'skip'] : ['new', 'skip'];
    if (row.proposed === 'update' || row.proposed === 'unchanged') return ['update', 'unchanged', 'skip'];
    return ['new', 'link', 'skip'];
  }

  private async assertTarget(tx: Db, ctx: TenantRequestContext, entityId: string, kind: Kind, id: string) {
    const tenantId = ctx.tenant.tenantId;
    const found =
      kind === 'group'
        ? await tx.select({ id: accountGroup.id }).from(accountGroup).where(and(eq(accountGroup.id, id), eq(accountGroup.entityId, entityId)))
        : kind === 'ledger' || kind === 'opening'
          ? await tx.select({ id: glAccount.id }).from(glAccount).where(and(eq(glAccount.id, id), eq(glAccount.entityId, entityId)))
          : kind === 'party'
            ? await tx.select({ id: party.id }).from(party).where(and(eq(party.id, id), eq(party.tenantId, tenantId)))
            : kind === 'unit'
              ? await tx.select({ id: uom.id }).from(uom).where(and(eq(uom.id, id), eq(uom.tenantId, tenantId)))
              : kind === 'godown'
                ? await tx.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.id, id), eq(warehouse.entityId, entityId)))
                : await tx.select({ id: item.id }).from(item).where(and(eq(item.id, id), eq(item.tenantId, tenantId)));
    if (!found.length) throw new BadRequestException('The chosen record is not available in this workspace and entity');
    // An opening balance only points at a ledger; it is not a Tally link.
    if (kind === 'opening') return null;
    // One FactoryOS record links to one Tally object per entity.
    const [taken] = await tx.select().from(tallyLink).where(and(eq(tallyLink.entityId, entityId), eq(tallyLink.kind, kind), eq(tallyLink.targetId, id)));
    return taken ?? null;
  }

  private async openImport(tx: Db, entityId: string, id: string) {
    const [imp] = await tx.select().from(tallyImport).where(and(eq(tallyImport.id, id), eq(tallyImport.entityId, entityId))).for('update');
    if (!imp) throw new NotFoundException('Import not found');
    if (imp.status !== 'read') throw new ConflictException(`This import is already ${imp.status}`);
    return imp;
  }

  async discard(ctx: TenantRequestContext, entityId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const imp = await this.openImport(tx, entityId, id);
      await tx.update(tallyImport).set({ status: 'discarded' }).where(eq(tallyImport.id, imp.id));
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounts.tally.discard', targetType: 'tally_import', targetId: imp.id }, tx);
      return { ok: true };
    });
  }

  // ── Commit ──

  async commit(ctx: TenantRequestContext, entityId: string, id: string, acceptDifference?: string) {
    return this.db.transaction(async (tx) => {
      await lockAccounting(tx, entityId);
      await seedChart(tx, ctx, entityId);
      const imp = await this.openImport(tx, entityId, id);
      const rows = await tx.select().from(tallyStaged).where(eq(tallyStaged.importId, imp.id)).orderBy(asc(tallyStaged.ordinal));
      const open = rows.filter((r) => r.action === 'conflict');
      if (open.length)
        throw new BadRequestException({ message: `${open.length} record${open.length === 1 ? ' needs' : 's need'} a decision before the import can be saved`, issues: open.slice(0, 20).map((r) => ({ path: r.id, message: r.name })) });
      const w = new CommitWriter(tx, ctx, entityId, imp.id);
      await w.prepare(rows);
      const results: Record<string, number> = {};
      const resultOf = new Map<string, string | null>();
      for (const kind of KIND_ORDER)
        for (const r of rows.filter((x) => x.kind === kind)) {
          const resultId = await w.apply(r).catch((e: unknown) => {
            if (e instanceof BadRequestException || e instanceof ConflictException) throw e;
            // Validation of Tally data (a name too short, a code clash) names the record instead of failing blindly.
            const reason =
              e instanceof z.ZodError
                ? e.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ')
                : e instanceof Error
                  ? e.message.split('\n')[0]
                  : String(e);
            throw new BadRequestException(`"${r.name}" (${r.kind}) could not be saved: ${reason}`);
          });
          if (resultId !== r.resultId) await tx.update(tallyStaged).set({ resultId }).where(eq(tallyStaged.id, r.id));
          resultOf.set(`${r.kind}:${r.guid ?? r.name}`, resultId);
          results[`${r.kind}.${r.action}`] = (results[`${r.kind}.${r.action}`] ?? 0) + 1;
        }
      // Openings refer to masters by GUID (godowns by name): this commit's result first, then an earlier import's link.
      const linked = async (kind: Kind, guid: string | null, name?: string) => {
        const key = `${kind}:${guid ?? name}`;
        if (resultOf.has(key)) return resultOf.get(key) ?? null;
        const [l] = await tx
          .select()
          .from(tallyLink)
          .where(and(eq(tallyLink.entityId, entityId), eq(tallyLink.kind, kind), guid ? eq(tallyLink.guid, guid) : eq(tallyLink.name, name ?? '')));
        return l?.targetId ?? null;
      };
      const godownGuid = new Map(rows.filter((r) => r.kind === 'godown').map((r) => [r.name, r.guid]));
      const openingResults = await new OpeningWriter(tx, ctx, entityId, imp.id, this.gl, this.audit).write(
        rows,
        (kind, guid, name) => linked(kind, guid, name),
        async (name) => {
          const viaTally = await linked('godown', godownGuid.get(name) ?? null, name);
          if (viaTally) return viaTally;
          const [w] = await tx.select({ id: warehouse.id }).from(warehouse).where(and(eq(warehouse.entityId, entityId), eq(warehouse.name, name)));
          return w?.id ?? null;
        },
        acceptDifference,
      );
      for (const r of rows.filter((x) => x.kind === 'opening' || x.kind === 'stock')) {
        const resultId = openingResults.get(r.id) ?? null;
        if (resultId !== r.resultId) await tx.update(tallyStaged).set({ resultId }).where(eq(tallyStaged.id, r.id));
        results[`${r.kind}.${r.action}`] = (results[`${r.kind}.${r.action}`] ?? 0) + 1;
      }
      // History last: its lines link to the ledgers and parties written above (decision 072, part 3).
      const voucherRows = rows.filter((x) => x.kind === 'voucher');
      const voucherResults = await writeVouchers(tx, ctx, entityId, imp.id, this.audit, voucherRows);
      const pairs = [...voucherResults];
      for (let i = 0; i < pairs.length; i += 1000) {
        const chunk = pairs.slice(i, i + 1000);
        // Both arrays travel as bound parameters in Postgres array syntax.
        const ids = `{${chunk.map(([k]) => k).join(',')}}`;
        const targets = `{${chunk.map(([, v]) => v).join(',')}}`;
        await tx.execute(sql`update ${tallyStaged} set result_id = v.result_id from unnest(${ids}::uuid[], ${targets}::uuid[]) as v(id, result_id) where ${tallyStaged.id} = v.id`);
      }
      for (const r of voucherRows) results[`${r.kind}.${r.action}`] = (results[`${r.kind}.${r.action}`] ?? 0) + 1;
      const [done] = await tx.update(tallyImport).set({ status: 'committed', committedBy: ctx.user.id, committedAt: new Date() }).where(eq(tallyImport.id, imp.id)).returning();
      await this.audit.record(ctx, { tenantId: ctx.tenant.tenantId, entityId, action: 'accounts.tally.import', targetType: 'tally_import', targetId: imp.id, after: { results } }, tx);
      return { ...done!, results };
    });
  }
}

/**
 * Tally group name → parent name: the export's own groups first, then FactoryOS's groups and the standard tree, so an
 * export of ledgers alone still finds Sundry Debtors under Current Assets.
 */
function groupTree(tally: TallyGroup[], existing: (typeof accountGroup.$inferSelect)[]) {
  const standard = new Map<string, string | null>(STANDARD_GROUPS.map(([name, , parent]) => [name, parent]));
  // A reserved Tally group exported without its parent keeps its standard place.
  const tree = new Map<string, string | null>(tally.map((g) => [g.name, g.parent ?? (g.reservedName ? (standard.get(g.name) ?? null) : null)]));
  const byId = new Map(existing.map((g) => [g.id, g.name]));
  for (const g of existing) if (!tree.has(g.name)) tree.set(g.name, g.parentId ? (byId.get(g.parentId) ?? null) : null);
  for (const [name, parent] of standard) if (!tree.has(name)) tree.set(name, parent);
  return tree;
}

/** The primary groups the company created in Tally, with the classification their flags give. */
function primaryNatures(tally: TallyGroup[]) {
  return new Map(tally.filter((g) => !g.parent && !g.reservedName && g.nature).map((g) => [g.name, g.nature]));
}

const warehouses = (list: (typeof warehouse.$inferSelect)[], id: string) => {
  const w = list.find((x) => x.id === id);
  return w ? `${w.code} · ${w.name}` : null;
};

/** Writes one committed import, resolving Tally names to the FactoryOS ids created or linked earlier in the same commit. */
class CommitWriter {
  private groupByTallyName = new Map<string, string>();
  private unitByTallyName = new Map<string, string>();
  private usedCodes = { party: new Set<string>(), item: new Set<string>(), uom: new Set<string>(), warehouse: new Set<string>(), ledger: new Set<string>() };
  private groups: (typeof accountGroup.$inferSelect)[] = [];
  private tree = new Map<string, string | null>();
  private natures = new Map<string, string>();

  constructor(
    private readonly tx: Tx,
    private readonly ctx: TenantRequestContext,
    private readonly entityId: string,
    private readonly importId: string,
  ) {}

  private get tenantId() {
    return this.ctx.tenant.tenantId;
  }

  async prepare(rows: (typeof tallyStaged.$inferSelect)[]) {
    const tx = this.tx;
    this.groups = await tx.select().from(accountGroup).where(eq(accountGroup.entityId, this.entityId));
    const tallyGroups = rows.filter((r) => r.kind === 'group').map((r) => r.payload as unknown as TallyGroup);
    this.tree = groupTree(tallyGroups, this.groups);
    this.natures = primaryNatures(tallyGroups);
    // Standard group names resolve directly, so a ledger under "Bank Accounts" lands there even when the group row was skipped.
    for (const g of this.groups) if (!this.groupByTallyName.has(g.name)) this.groupByTallyName.set(g.name, g.id);
    const [p, i, u, w, a] = await Promise.all([
      tx.select({ c: party.code }).from(party).where(eq(party.tenantId, this.tenantId)),
      tx.select({ c: item.code }).from(item).where(eq(item.tenantId, this.tenantId)),
      tx.select({ c: uom.code }).from(uom).where(eq(uom.tenantId, this.tenantId)),
      tx.select({ c: warehouse.code }).from(warehouse).where(eq(warehouse.entityId, this.entityId)),
      tx.select({ c: glAccount.code }).from(glAccount).where(eq(glAccount.entityId, this.entityId)),
    ]);
    p.forEach((x) => this.usedCodes.party.add(x.c));
    i.forEach((x) => this.usedCodes.item.add(x.c));
    u.forEach((x) => this.usedCodes.uom.add(x.c));
    w.forEach((x) => this.usedCodes.warehouse.add(x.c));
    a.forEach((x) => this.usedCodes.ledger.add(x.c));
    for (const uRow of await tx.select().from(uom).where(eq(uom.tenantId, this.tenantId))) this.unitByTallyName.set(uRow.code, uRow.id);
  }

  private uniqueCode(kind: keyof CommitWriter['usedCodes'], base: string, max: number, sep = '-') {
    const used = this.usedCodes[kind];
    let code = base.slice(0, max);
    for (let n = 2; used.has(code); n++) code = `${base.slice(0, max - String(n).length - sep.length)}${sep}${n}`;
    used.add(code);
    return code;
  }

  async apply(r: typeof tallyStaged.$inferSelect): Promise<string | null> {
    const action = r.action as Action;
    if (action === 'skip') return null;
    const m = r.payload as unknown as TallyMaster;
    let id: string;
    if (action === 'new') id = await this.create(r.kind as Kind, m);
    else {
      id = r.targetId!;
      if (action === 'update') await this.update(r.kind as Kind, id, m);
      if (r.kind === 'party' && action !== 'unchanged') {
        await this.markRole(id, m as TallyLedger);
        await this.fillParty(id, m as TallyLedger);
      }
    }
    if (r.kind === 'group') this.groupByTallyName.set(m.name, id);
    if (r.kind === 'unit') this.unitByTallyName.set(m.name, id);
    if (m.guid) await this.link(r.kind as Kind, m, id);
    return id;
  }

  private async link(kind: Kind, m: TallyMaster, targetId: string) {
    const tx = this.tx;
    // A FactoryOS record already linked to another Tally object of this kind keeps its first link. Parties are the
    // exception: two Tally ledgers with one GSTIN are one FactoryOS party.
    const [other] =
      kind === 'party'
        ? []
        : await tx
            .select()
            .from(tallyLink)
            .where(and(eq(tallyLink.entityId, this.entityId), eq(tallyLink.kind, kind), eq(tallyLink.targetId, targetId)));
    if (other && other.guid !== m.guid) throw new ConflictException(`"${m.name}" is linked to a record that another Tally ${kind} already uses ("${other.name}"). Create a new record or skip it.`);
    await tx
      .insert(tallyLink)
      .values({ tenantId: this.tenantId, entityId: this.entityId, kind, guid: m.guid!, targetId, alterId: m.alterId, name: m.name, importId: this.importId })
      .onConflictDoUpdate({
        target: [tallyLink.entityId, tallyLink.kind, tallyLink.guid],
        set: { targetId, alterId: m.alterId, name: m.name, importId: this.importId, updatedAt: new Date() },
      });
  }

  private groupFor(name: string | null, root: Root): string {
    const id = name ? this.groupByTallyName.get(name) : undefined;
    if (id) return id;
    throw new BadRequestException(`Group "${name ?? 'Primary'}" was skipped, so what sits under it cannot be created. Include the group, or skip what is under it.`);
  }

  private rootOf(name: string | null): Root {
    const root = tallyRoot(name ?? '', (n) => this.tree.get(n), (n) => this.natures.get(n)) as Root | null;
    if (root) return root;
    throw new BadRequestException(`The classification of group "${name}" is unknown`);
  }

  private async create(kind: Kind, m: TallyMaster): Promise<string> {
    const tx = this.tx;
    const scope = { tenantId: this.tenantId };
    switch (kind) {
      case 'group': {
        const g = m as TallyGroup;
        const root = this.rootOf(g.name);
        const parentId = g.parent ? this.groupFor(g.parent, root) : null;
        const [row] = await tx
          .insert(accountGroup)
          .values({ ...scope, entityId: this.entityId, key: `${g.name}:${root}`, name: g.name, root, parentId })
          .onConflictDoNothing()
          .returning();
        if (!row) throw new ConflictException(`A ${root} group named "${g.name}" already exists; link to it instead`);
        this.groups.push(row);
        return row.id;
      }
      case 'ledger': {
        const l = m as TallyLedger;
        const root = this.rootOf(l.parent);
        const groupId = this.groupFor(l.parent, root);
        const code = this.uniqueCode('ledger', codeFrom(l.aliases[0] ?? l.name, 32, '_'), 32);
        const [row] = await tx.insert(glAccount).values({ ...scope, entityId: this.entityId, code, name: l.name.slice(0, 120), groupId }).returning();
        return row!.id;
      }
      case 'party': {
        const input = this.partyFrom(m as TallyLedger);
        // The same party may have been created since the preview (another entity's import); link instead of duplicating.
        if (input.gstin) {
          // Serialises concurrent imports of the same GSTIN until this transaction ends.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${this.tenantId + ':gstin:' + input.gstin}))`);
          const [existing] = await tx.select().from(party).where(and(eq(party.tenantId, this.tenantId), eq(party.gstin, input.gstin)));
          if (existing) {
            await this.markRole(existing.id, m as TallyLedger);
            return existing.id;
          }
        }
        const [row] = await tx.insert(party).values({ ...input, ...scope }).returning();
        return row!.id;
      }
      case 'unit': {
        const u = m as TallyUnit;
        // Unit codes are 1–8 letters or digits (the units master's rule).
        const code = this.uniqueCode('uom', u.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'UNIT', 8, '');
        const [row] = await tx.insert(uom).values({ ...scope, code, name: (u.formalName ?? u.name).slice(0, 60), decimals: Math.min(Math.max(u.decimals, 0), 6) }).returning();
        return row!.id;
      }
      case 'godown': {
        const g = m as TallyGodown;
        const code = this.uniqueCode('warehouse', codeFrom(g.name, 20), 20);
        const [row] = await tx.insert(warehouse).values({ ...scope, entityId: this.entityId, code, name: g.name.slice(0, 120), type: 'stores' }).returning();
        return row!.id;
      }
      case 'stockitem': {
        const s = m as TallyStockItem;
        const stockUomId = s.unit ? this.unitByTallyName.get(s.unit) : undefined;
        if (!stockUomId) throw new BadRequestException(`The unit "${s.unit ?? ''}" of item "${s.name}" was skipped or is missing. Include the unit, or skip the item.`);
        const code = this.uniqueCode('item', codeFrom(s.aliases[0] ?? s.name, 40, '._/'), 40);
        const hsn = s.hsn && /^\d{4,8}$/.test(s.hsn) ? s.hsn : null;
        const input = itemInput.parse({ code, name: s.name.slice(0, 200).padEnd(2, '.'), type: 'raw_material', tracking: s.batchwise ? 'batch' : 'none', stockUomId, hsnCode: hsn });
        const [row] = await tx.insert(item).values({ ...input, tenantId: this.tenantId }).returning();
        return row!.id;
      }
      default:
        throw new BadRequestException(`Tally ${kind} records are not created`);
    }
  }

  private partyFrom(l: TallyLedger) {
    const g = l.gstin ? validateGstin(l.gstin) : null;
    const stateCode = g?.valid ? g.stateCode : (l.stateName && STATE_CODE.get(l.stateName.toLowerCase())) || null;
    const debtor = this.isUnder(l.parent, 'Sundry Debtors');
    const lines = l.address.filter(Boolean);
    const address =
      lines.length && stateCode && l.pincode && /^\d{6}$/.test(l.pincode)
        ? [{ label: 'Tally', line1: lines[0]!.slice(0, 200), ...(lines[1] && { line2: lines.slice(1).join(', ').slice(0, 200) }), city: (lines.at(-1) ?? '').split(',').at(-1)!.trim().slice(0, 80) || '-', stateCode, pincode: l.pincode }]
        : [];
    const raw = {
      code: this.uniqueCode('party', codeFrom(l.aliases[0] ?? l.name, 30, '._'), 30),
      name: l.name.slice(0, 200).padEnd(2, '.'),
      isCustomer: debtor,
      isSupplier: !debtor,
      gstTreatment: g?.valid ? 'registered' : 'unregistered',
      gstin: g?.valid ? g.gstin : null,
      pan: g?.valid ? g.pan : l.pan && isValidPan(l.pan) ? l.pan : null,
      stateCode,
      creditDays: l.creditDays !== null && l.creditDays <= 365 ? l.creditDays : null,
      email: l.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) ? l.email : null,
      addresses: address,
    };
    return normaliseParty(partyInput.parse(raw));
  }

  private isUnder(name: string | null, target: string) {
    const seen = new Set<string>();
    for (let c = name; c && !seen.has(c); c = this.tree.get(c) ?? null) {
      if (c === target) return true;
      seen.add(c);
    }
    return false;
  }

  /** A party linked from Sundry Debtors is a customer; from Sundry Creditors, a supplier. */
  private async markRole(id: string, l: TallyLedger) {
    const debtor = this.isUnder(l.parent, 'Sundry Debtors');
    await this.tx
      .update(party)
      .set(debtor ? { isCustomer: true, updatedAt: new Date() } : { isSupplier: true, updatedAt: new Date() })
      .where(and(eq(party.id, id), eq(party.tenantId, this.tenantId)));
  }

  /** Identifiers FactoryOS lacks are taken from Tally; ones it has are never overwritten. */
  private async fillParty(id: string, l: TallyLedger) {
    const [p] = await this.tx.select().from(party).where(and(eq(party.id, id), eq(party.tenantId, this.tenantId)));
    if (!p) return;
    const g = l.gstin ? validateGstin(l.gstin) : null;
    const fill = {
      ...(!p.gstin && g?.valid && { gstin: g.gstin, gstTreatment: 'registered' as const, stateCode: g.stateCode, pan: g.pan }),
      ...(!p.pan && !p.gstin && !g?.valid && l.pan && isValidPan(l.pan) && { pan: l.pan }),
      ...(p.creditDays === null && l.creditDays !== null && l.creditDays <= 365 && { creditDays: l.creditDays }),
      ...(!p.email && l.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email) && { email: l.email }),
    };
    if (Object.keys(fill).length) await this.tx.update(party).set({ ...fill, updatedAt: new Date() }).where(eq(party.id, id));
  }

  /** A newer Tally version refreshes names and fills identifiers FactoryOS does not have yet; it never overwrites them. */
  private async update(kind: Kind, id: string, m: TallyMaster) {
    const tx = this.tx;
    switch (kind) {
      case 'group':
        await tx.update(accountGroup).set({ name: m.name }).where(and(eq(accountGroup.id, id), eq(accountGroup.entityId, this.entityId)));
        break;
      case 'ledger':
        await tx.update(glAccount).set({ name: m.name.slice(0, 120) }).where(and(eq(glAccount.id, id), eq(glAccount.entityId, this.entityId)));
        break;
      case 'party':
        // The identifiers are filled by fillParty, which also runs for links.
        await tx.update(party).set({ name: m.name.slice(0, 200), updatedAt: new Date() }).where(and(eq(party.id, id), eq(party.tenantId, this.tenantId)));
        break;
      case 'stockitem': {
        const s = m as TallyStockItem;
        const [i] = await tx.select().from(item).where(and(eq(item.id, id), eq(item.tenantId, this.tenantId)));
        if (!i) break;
        await tx
          .update(item)
          .set({ name: s.name.slice(0, 200), ...(!i.hsnCode && s.hsn && /^\d{4,8}$/.test(s.hsn) && { hsnCode: s.hsn }), updatedAt: new Date() })
          .where(eq(item.id, id));
        break;
      }
      case 'godown':
        await tx.update(warehouse).set({ name: m.name.slice(0, 120) }).where(and(eq(warehouse.id, id), eq(warehouse.entityId, this.entityId)));
        break;
      default:
        break;
    }
  }
}
