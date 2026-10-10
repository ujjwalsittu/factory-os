'use client';
// Audited support access (decision 050): read-only panels for the catalogued areas. Only fixed panels are offered; no
// edit forms, autosave, exports, downloads or attachments are mounted. Every request goes through the provider.
import { SUPPORT_AREAS, type SupportArea, type SupportCell, type SupportPanelResult, type SupportQuery, type SupportTable, type SupportWorkspaceContext } from '@factoryos/auth';
import { Alert, Button, Card, Table, Td, Th, Tr, cn } from '@factoryos/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supportQueryKey, useSupportAccess } from '@/components/support-access-provider';
import { AREA_LABELS, supportErrorText } from '@/lib/support-access';

const LIMIT = 50;
/** Reference columns let a row open its detail; they are never shown. */
const HIDDEN = new Set(['id', 'itemId']);

type View =
  | { area: 'inventory'; panel: 'balance' | 'ledger'; itemId?: string; label?: string }
  | { area: 'sales-invoices' | 'purchase-invoices' | 'work-orders'; panel: 'list' | 'detail'; id?: string; label?: string }
  | { area: 'accounting'; panel: 'status' | 'trial-balance' | 'ledger' | 'day-book'; accountId?: string; label?: string };

const START: Record<SupportArea, View> = {
  inventory: { area: 'inventory', panel: 'balance' },
  'sales-invoices': { area: 'sales-invoices', panel: 'list' },
  'purchase-invoices': { area: 'purchase-invoices', panel: 'list' },
  'work-orders': { area: 'work-orders', panel: 'list' },
  accounting: { area: 'accounting', panel: 'status' },
};
const TABS: Partial<Record<SupportArea, { panel: string; label: string }[]>> = {
  inventory: [{ panel: 'balance', label: 'Stock balance' }],
  accounting: [
    { panel: 'status', label: 'Status' },
    { panel: 'trial-balance', label: 'Trial balance' },
    { panel: 'day-book', label: 'Day book' },
  ],
};

export function SupportAccessPanels({ context }: { context: SupportWorkspaceContext }) {
  const areas = context.effectiveAreas;
  const [area, setArea] = useState<SupportArea | null>(areas[0] ?? null);
  const unavailable = SUPPORT_AREAS.filter((a) => !areas.includes(a));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="Areas">
        {areas.map((a) => (
          <button key={a} role="tab" aria-selected={area === a} onClick={() => setArea(a)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium', area === a ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg')}>
            {AREA_LABELS[a]}
          </button>
        ))}
      </div>
      {area ? <AreaPanel key={area} context={context} area={area} /> : <Alert tone="warning">None of the approved areas are available for this member.</Alert>}
      {unavailable.length > 0 && <p className="text-[12px] text-muted">Unavailable in this support session: {unavailable.map((a) => AREA_LABELS[a]).join(', ')}. Editing, exports, downloads and attachments are never available in support.</p>}
    </div>
  );
}

function AreaPanel({ context, area }: { context: SupportWorkspaceContext; area: SupportArea }) {
  const [stack, setStack] = useState<View[]>([START[area]]);
  const view = stack[stack.length - 1]!;
  const open = (v: View) => setStack((s) => [...s, v]);
  const tabs = TABS[area];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {stack.length > 1 && (
          <Button size="sm" variant="secondary" onClick={() => setStack((s) => s.slice(0, -1))}>
            Back
          </Button>
        )}
        {stack.length === 1 &&
          tabs?.map((t) => (
            <Button key={t.panel} size="sm" variant={view.panel === t.panel ? 'primary' : 'ghost'} onClick={() => setStack([{ area, panel: t.panel } as View])}>
              {t.label}
            </Button>
          ))}
        {view.label && <span className="text-[13px] font-medium">{view.label}</span>}
      </div>
      <PanelView key={JSON.stringify(view)} context={context} view={view} open={open} />
    </div>
  );
}

function drill(view: View, row: Record<string, SupportCell>): View | null {
  const ref = (k: string) => (typeof row[k] === 'string' ? (row[k] as string) : null);
  if (view.area === 'inventory' && view.panel === 'balance' && ref('itemId')) return { area: 'inventory', panel: 'ledger', itemId: ref('itemId')!, label: `Ledger · ${row.itemCode ?? ''}` };
  if ((view.area === 'sales-invoices' || view.area === 'purchase-invoices' || view.area === 'work-orders') && view.panel === 'list' && ref('id')) return { area: view.area, panel: 'detail', id: ref('id')!, label: String(row.number ?? '') };
  if (view.area === 'accounting' && view.panel === 'trial-balance' && ref('id')) return { area: 'accounting', panel: 'ledger', accountId: ref('id')!, label: `Ledger · ${row.code ?? ''} ${row.name ?? ''}` };
  return null;
}

function PanelView({ context, view, open }: { context: SupportWorkspaceContext; view: View; open: (v: View) => void }) {
  const { fetchPanel } = useSupportAccess();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const { label: _label, ...rest } = view;
  const query = { ...rest, limit: LIMIT, ...(cursors.at(-1) ? { cursor: cursors.at(-1) } : {}) } as SupportQuery;
  const result = useQuery({ queryKey: supportQueryKey(context, query), queryFn: ({ signal }) => fetchPanel(query, signal) });
  if (result.error) return <Alert tone="danger">{supportErrorText(result.error)}</Alert>;
  if (!result.data) return <p className="text-muted">Loading…</p>;
  const pager = (t: SupportTable) => (
    <div className="flex gap-2 px-4 py-3">
      {cursors.length > 1 && (
        <Button size="sm" variant="secondary" onClick={() => setCursors((c) => c.slice(0, -1))}>
          Previous
        </Button>
      )}
      {t.nextCursor && (
        <Button size="sm" variant="secondary" onClick={() => setCursors((c) => [...c, t.nextCursor!])}>
          Next
        </Button>
      )}
    </div>
  );
  return <Result result={result.data} onRow={(row) => drill(view, row)} open={open} pager={pager} />;
}

function Result({ result, onRow, open, pager }: { result: SupportPanelResult; onRow: (row: Record<string, SupportCell>) => View | null; open: (v: View) => void; pager: (t: SupportTable) => React.ReactNode }) {
  if (result.kind === 'table')
    return (
      <Card>
        <DataTable table={result.table} onRow={onRow} open={open} />
        {pager(result.table)}
      </Card>
    );
  const { fields, tables } = result.detail;
  return (
    <div className="space-y-4">
      {fields.length > 0 && (
        <Card className="p-5">
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <div key={f.label}>
                <dt className="text-muted">{f.label}</dt>
                <dd className="font-medium">{show(f.value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      {tables.map((t) => (
        <Card key={t.label}>
          <h3 className="border-b border-line px-5 py-3 text-[13px] font-semibold">{t.label}</h3>
          <DataTable table={t.table} onRow={onRow} open={open} />
          {t.table.nextCursor && pager(t.table)}
        </Card>
      ))}
    </div>
  );
}

function DataTable({ table, onRow, open }: { table: SupportTable; onRow: (row: Record<string, SupportCell>) => View | null; open: (v: View) => void }) {
  const columns = table.columns.filter((c) => !HIDDEN.has(c.key));
  if (table.rows.length === 0) return <p className="px-5 py-6 text-[13px] text-muted">No records.</p>;
  return (
    <Table>
      <thead>
        <tr>
          {columns.map((c) => (
            <Th key={c.key}>{c.label}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => {
          const next = onRow(row);
          return (
            <Tr key={i} className={next ? 'cursor-pointer' : undefined} onClick={next ? () => open(next) : undefined}>
              {columns.map((c, j) => (
                <Td key={c.key} className="whitespace-nowrap">
                  {j === 0 && next ? (
                    <button type="button" className="font-medium text-accent hover:underline" onClick={(e) => (e.stopPropagation(), open(next))}>
                      {show(row[c.key] ?? null)}
                    </button>
                  ) : (
                    show(row[c.key] ?? null)
                  )}
                </Td>
              ))}
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

const show = (v: SupportCell) => (v === null ? '—' : v === true ? 'Yes' : v === false ? 'No' : v);
