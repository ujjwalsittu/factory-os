'use client';
import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CURRENCIES, errorText, GST_RATE_OPTIONS } from '@/lib/buying';
import { formatAmount, formatDateTime, formatQty, today } from '@/lib/format';
import {
  SELLING,
  SUPPLIES,
  useSellingTax,
  type CreditStatus,
  type SellingDocument,
  type SellingKind,
} from '@/lib/selling';
import { STATUS_TONE } from '@/lib/stock';
import type { Batch, Item, Party, Warehouse } from '@/lib/types';
import { FormDialog } from './form-dialog';
import { ItemPicker } from './item-picker';
import { useOurGstins } from './purchase-order-form';
import { TaxSummary } from './tax-summary';
import { useWorkspace } from './workspace';

interface DraftLine {
  key: string;
  item:
    | (Pick<Item, 'id' | 'code' | 'name' | 'tracking' | 'isStockItem'> & {
        uomCode?: string;
      })
    | null;
  description: string;
  qty: string;
  rate: string;
  gstRate: string;
  warehouseId: string;
  batchId: string;
  soLineId: string | null;
}
const blank = (): DraftLine => ({
  key: crypto.randomUUID(),
  item: null,
  description: '',
  qty: '',
  rate: '',
  gstRate: '',
  warehouseId: '',
  batchId: '',
  soLineId: null,
});
const decimal = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim());

export function SellingForm({
  kind,
  doc,
  sourceOrder,
}: {
  kind: SellingKind;
  doc?: SellingDocument;
  sourceOrder?: SellingDocument;
}) {
  const ws = useWorkspace(),
    router = useRouter(),
    qc = useQueryClient(),
    config = SELLING[kind];
  const resource = `selling.${config.resource}`,
    editable = !doc || doc.status === 'draft';
  const canEdit = editable && ws.can(`${resource}.create`);
  const initial = doc ?? sourceOrder;
  const gstins = useOurGstins();
  const customers = useQuery({
    queryKey: ['parties', ws.tenantId, '', 'customer'],
    queryFn: () =>
      api<Party[]>('/parties?role=customer&limit=500', { scope: ws.scope }),
    enabled: ws.can('masters.party.read'),
  });
  const warehouses = useQuery({
    queryKey: ['warehouses', ws.entityId],
    queryFn: () => api<Warehouse[]>('/warehouses', { scope: ws.scope }),
    enabled: kind === 'invoices' && canEdit,
  });
  const [header, setHeader] = useState({
    customerId: initial?.customerId ?? '',
    gstRegistrationId: initial?.gstRegistrationId ?? '',
    date: doc?.[config.date] ?? today(),
    validTill: doc?.validTill ?? '',
    deliveryDate: doc?.deliveryDate ?? '',
    customerRef: doc?.customerRef ?? '',
    customerPoNo: initial?.customerPoNo ?? '',
    customerPoDate: doc?.customerPoDate ?? '',
    paymentTermsDays: initial?.paymentTermsDays?.toString() ?? '',
    supplyType: initial?.supplyType ?? '',
    placeOfSupplyStateCode: initial?.placeOfSupplyStateCode ?? '',
    currency: initial?.currency ?? 'INR',
    exchangeRate: initial?.exchangeRate ?? '',
    billingAddressLabel: doc?.billingAddress?.label ?? '',
    shippingAddressLabel: doc?.shippingAddress?.label ?? '',
    shippingBillNo: doc?.shippingBillNo ?? '',
    shippingBillDate: doc?.shippingBillDate ?? '',
    portCode: doc?.portCode ?? '',
    remarks: initial?.remarks ?? '',
  });
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial
      ? initial.lines
          .filter((l) => doc || Number(l.pendingQty) > 0)
          .map((l) => ({
            key: l.id,
            item: {
              id: l.itemId,
              code: l.itemCode,
              name: l.itemName,
              tracking: l.tracking ?? 'none',
              isStockItem: l.isStockItem ?? true,
              uomCode: l.uomCode,
            },
            description: l.description ?? '',
            qty: doc ? l.qty : l.pendingQty!,
            rate: l.rate,
            gstRate: l.gstRate,
            warehouseId: l.warehouseId ?? '',
            batchId: l.batchId ?? '',
            soLineId: doc ? (l.soLineId ?? null) : l.id,
          }))
      : [blank()],
  );
  const [draftId, setDraftId] = useState(doc?.id ?? null);
  const idRef = useRef(doc?.id ?? null),
    busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null),
    [creditWarning, setCreditWarning] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    'cancel' | 'close' | 'delete' | 'credit' | null
  >(null);
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const customer = customers.data?.find((c) => c.id === header.customerId);
  const input = (
    key: keyof typeof header,
    label: string,
    type = 'text',
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      {(p) => (
        <Input
          {...p}
          type={type}
          value={header[key]}
          onChange={(e) => setHeader((h) => ({ ...h, [key]: e.target.value }))}
          disabled={!canEdit}
        />
      )}
    </Field>
  );
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const body = {
    customerId: header.customerId,
    gstRegistrationId: header.gstRegistrationId || null,
    [config.date]: header.date,
    supplyType: header.supplyType || null,
    placeOfSupplyStateCode: header.placeOfSupplyStateCode || null,
    currency: header.currency,
    exchangeRate:
      header.currency === 'INR' ? null : header.exchangeRate || null,
    remarks: header.remarks || null,
    ...(kind === 'quotations'
      ? {
          validTill: header.validTill || null,
          customerRef: header.customerRef || null,
        }
      : { customerPoNo: header.customerPoNo || null }),
    ...(kind === 'orders'
      ? {
          deliveryDate: header.deliveryDate || null,
          customerPoDate: header.customerPoDate || null,
          quotationId: doc?.quotationId ?? null,
          paymentTermsDays: header.paymentTermsDays
            ? Number(header.paymentTermsDays)
            : null,
        }
      : {}),
    ...(kind === 'invoices'
      ? {
          salesOrderId: doc?.salesOrderId ?? sourceOrder?.id ?? null,
          billingAddressLabel: header.billingAddressLabel || null,
          shippingAddressLabel: header.shippingAddressLabel || null,
          shippingBillNo: header.shippingBillNo || null,
          shippingBillDate: header.shippingBillDate || null,
          portCode: header.portCode || null,
        }
      : {}),
    lines: lines
      .filter((l) => l.item)
      .map((l) => ({
        itemId: l.item!.id,
        description: l.description || null,
        qty: l.qty.trim(),
        rate: l.rate.trim(),
        ...(l.gstRate && { gstRate: l.gstRate }),
        ...(kind === 'invoices' && {
          soLineId: l.soLineId,
          warehouseId: l.warehouseId || null,
          batchId: l.batchId || null,
        }),
      })),
  };
  const valid =
    !!header.customerId &&
    !!header.date &&
    body.lines.length > 0 &&
    lines.every((l) => l.item && decimal(l.qty) && decimal(l.rate));
  const payload = JSON.stringify(body);
  const saved = savedPayload === payload;
  const previewLines = lines.filter(
    (l) => l.item && decimal(l.qty) && decimal(l.rate),
  );
  const preview = useSellingTax(
    JSON.stringify({
      ...body,
      date: header.date,
      lines: previewLines.map((l) => ({
        itemId: l.item!.id,
        qty: l.qty,
        rate: l.rate,
        ...(l.gstRate && { gstRate: l.gstRate }),
      })),
    }),
    canEdit && ws.can('selling.quotation.read'),
  );
  const credit = useQuery({
    queryKey: ['selling-credit', ws.entityId, header.customerId],
    queryFn: () =>
      api<CreditStatus>(
        `/selling/credit-status?customerId=${header.customerId}`,
        { scope: ws.scope },
      ),
    enabled:
      kind !== 'quotations' &&
      !!header.customerId &&
      ws.can('selling.sales_order.read'),
  });
  const lastSaved = useRef(doc ? payload : '');
  const failedPayload = useRef<string | null>(null);
  const save = useMutation({
    mutationFn: async ({
      submit,
      override = false,
      automatic = false,
    }: {
      submit: boolean;
      override?: boolean;
      automatic?: boolean;
    }) => {
      if (busyRef.current)
        throw new Error('A save is already running. Please wait.');
      if (!canEdit && submit && doc) {
        // Reviewers can submit an unchanged draft without editing it. The API
        // validates submission and credit override permissions independently.
        setError(null);
        await api(`/${config.endpoint}/${doc.id}/submit`, {
          method: 'POST',
          body: { acceptCreditWarning: override },
          scope: ws.scope,
        });
        return { id: doc.id, automatic };
      }
      if (!valid)
        throw new Error(
          'Choose a customer and complete every item, quantity and rate',
        );
      busyRef.current = true;
      setError(null);
      try {
        let id = idRef.current;
        if (id)
          await api(`/${config.endpoint}/${id}`, {
            method: 'PUT',
            body: JSON.parse(payload),
            scope: ws.scope,
          });
        else {
          id = (
            await api<{ id: string }>(`/${config.endpoint}`, {
              method: 'POST',
              body: JSON.parse(payload),
              scope: ws.scope,
            })
          ).id;
          idRef.current = id;
          setDraftId(id);
        }
        lastSaved.current = payload;
        setSavedPayload(payload);
        if (submit)
          await api(`/${config.endpoint}/${id}/submit`, {
            method: 'POST',
            body: { acceptCreditWarning: override },
            scope: ws.scope,
          });
        return { id, automatic };
      } catch (e) {
        failedPayload.current = payload;
        throw e;
      } finally {
        busyRef.current = false;
      }
    },
    onSuccess: ({ id, automatic }, { submit }) => {
      void qc.invalidateQueries({ queryKey: ['selling', kind] });
      if (submit) {
        setDialog(null);
        void qc.invalidateQueries({ queryKey: ['selling', 'orders'] });
        void qc.invalidateQueries({ queryKey: ['balance'] });
      }
      if (!automatic) {
        router.replace(`/app/selling/${kind}/${id}`);
        router.refresh();
      }
    },
    onError: (e) => {
      setError(errorText(e));
      if (
        e instanceof ApiError &&
        e.issues.some((i) => i.path === 'acceptCreditWarning')
      ) {
        setCreditWarning(e.message);
        if (ws.can(`${resource}.approve`)) setDialog('credit');
      }
    },
  });
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  useEffect(() => {
    if (
      !canEdit ||
      !valid ||
      payload === lastSaved.current ||
      (error && failedPayload.current === payload) ||
      save.isPending
    )
      return;
    if (error) setError(null);
    const t = setTimeout(() => {
      if (!busyRef.current) saveRef.current({ submit: false, automatic: true });
    }, 1500);
    return () => clearTimeout(t);
  }, [payload, canEdit, valid, error, save.isPending]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'Enter' &&
        canEdit &&
        !busyRef.current
      ) {
        e.preventDefault();
        saveRef.current({ submit: false });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit]);
  const conversion = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/quotations/${doc!.id}/order`, {
        method: 'POST',
        body: {},
        scope: ws.scope,
      }),
    onSuccess: (order) => router.push(`/app/selling/orders/${order.id}`),
    onError: (e) => setError(errorText(e)),
  });
  const displayedName = doc?.customerName ?? doc?.partyName ?? customer?.name;
  const submitted = doc?.status === 'submitted';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            className="text-[13px] text-muted"
            href={`/app/selling/${kind}`}
          >
            {config.title}
          </Link>
          <h1 className="mt-1 text-[22px] font-semibold">
            {doc?.number ?? `New ${config.singular}`}{' '}
            {doc && (
              <Badge tone={STATUS_TONE[doc.status]}>
                {doc.status === 'submitted'
                  ? 'Submitted'
                  : doc.status === 'cancelled'
                    ? 'Cancelled'
                    : 'Draft'}
              </Badge>
            )}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {displayedName}
            {canEdit &&
              (saved
                ? ' · Draft saved'
                : ' · Drafts save automatically when complete')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && draftId && (
            <Button
              variant="ghost"
              onClick={() => setDialog('delete')}
              disabled={save.isPending}
            >
              Delete draft
            </Button>
          )}
          {canEdit && (
            <Button
              variant="secondary"
              onClick={() => save.mutate({ submit: false })}
              disabled={save.isPending}
            >
              Save draft
            </Button>
          )}
          {editable && (canEdit || doc) && ws.can(`${resource}.submit`) && (
            <Button
              onClick={() => save.mutate({ submit: true })}
              loading={save.isPending}
            >
              Submit
            </Button>
          )}
          {submitted &&
            kind === 'quotations' &&
            ws.can('selling.sales_order.create') && (
              <Button
                onClick={() => conversion.mutate()}
                loading={conversion.isPending}
              >
                Create sales order
              </Button>
            )}
          {submitted &&
            kind === 'orders' &&
            !doc.closedAt &&
            doc.lines.some((l) => Number(l.pendingQty) > 0) &&
            ws.can('selling.sales_invoice.create') && (
              <Link
                className={buttonClass('primary', 'md')}
                href={`/app/selling/invoices/new?so=${doc.id}`}
              >
                Create invoice
              </Link>
            )}
          {submitted &&
            kind === 'orders' &&
            !doc.closedAt &&
            ws.can(`${resource}.submit`) && (
              <Button variant="secondary" onClick={() => setDialog('close')}>
                Short-close
              </Button>
            )}
          {submitted && kind === 'invoices' && ws.can(`${resource}.export`) && (
            <Link
              className={buttonClass('secondary', 'md')}
              href={`/app/selling/invoices/${doc.id}/print`}
            >
              Print / PDF
            </Link>
          )}
          {submitted && ws.can(`${resource}.cancel`) && (
            <Button variant="secondary" onClick={() => setDialog('cancel')}>
              Cancel {config.singular}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <Alert tone="danger" title="Not saved or submitted">
          {error}
        </Alert>
      )}
      {doc?.cancelReason && (
        <Alert tone="danger" title="Cancelled">
          {doc.cancelReason}
        </Alert>
      )}
      {doc?.closedAt && (
        <Alert tone="info">
          Short-closed. No more invoices can be raised against this order.
        </Alert>
      )}
      {kind === 'invoices' && canEdit && (
        <Alert tone="info" title="Submitting ships the goods">
          Stock lines issue from the selected warehouse and batch at FIFO cost.
          Service lines record billing only. Cancelling reverses the delivery.
        </Alert>
      )}
      {credit.data?.creditLimit != null && (
        <Alert tone="info" title="Customer credit">
          Outstanding {formatAmount(credit.data.outstanding)} · limit{' '}
          {formatAmount(credit.data.creditLimit)}
          {credit.data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Alert>
      )}
      <fieldset
        disabled={save.isPending && !save.variables?.automatic}
        className="space-y-5"
      >
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Customer"
              hint={customer?.gstin ?? customer?.gstTreatment}
            >
              {(p) => (
                <Select
                  {...p}
                  value={header.customerId}
                  onChange={(e) =>
                    setHeader((h) => ({
                      ...h,
                      customerId: e.target.value,
                      supplyType: '',
                      placeOfSupplyStateCode: '',
                      billingAddressLabel: '',
                      shippingAddressLabel: '',
                    }))
                  }
                  disabled={!canEdit || !!sourceOrder || !!doc?.salesOrderId}
                >
                  <option value="">{displayedName ?? 'Choose…'}</option>
                  {customers.data
                    ?.filter((c) => c.isActive || c.id === header.customerId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            {input(
              'date',
              kind === 'quotations'
                ? 'Quotation date'
                : kind === 'orders'
                  ? 'Order date'
                  : 'Invoice date',
              'date',
            )}
            <Field label="Our GSTIN">
              {(p) => (
                <Select
                  {...p}
                  value={header.gstRegistrationId}
                  onChange={(e) =>
                    setHeader((h) => ({
                      ...h,
                      gstRegistrationId: e.target.value,
                    }))
                  }
                  disabled={!canEdit}
                >
                  <option value="">Default GST registration</option>
                  {gstins.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.gstin}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Supply type">
              {(p) => (
                <Select
                  {...p}
                  value={header.supplyType}
                  onChange={(e) =>
                    setHeader((h) => ({ ...h, supplyType: e.target.value }))
                  }
                  disabled={!canEdit}
                >
                  <option value="">From customer GST treatment</option>
                  {Object.entries(SUPPLIES).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {input(
              'placeOfSupplyStateCode',
              'Place of supply state',
              'text',
              'Two-digit state code; leave blank to use the shipping address or customer state',
            )}
            <Field label="Currency">
              {(p) => (
                <Select
                  {...p}
                  value={header.currency}
                  onChange={(e) =>
                    setHeader((h) => ({ ...h, currency: e.target.value }))
                  }
                  disabled={!canEdit}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
            {header.currency !== 'INR' &&
              input(
                'exchangeRate',
                `Exchange rate (₹ per 1 ${header.currency})`,
              )}
            {kind === 'quotations' ? (
              <>
                {input('validTill', 'Valid until', 'date')}
                {input('customerRef', 'Customer enquiry reference')}
              </>
            ) : (
              <>
                {input('customerPoNo', 'Customer PO number')}
                {kind === 'orders' && (
                  <>
                    {input('customerPoDate', 'Customer PO date', 'date')}
                    {input('deliveryDate', 'Delivery date', 'date')}
                    {input(
                      'paymentTermsDays',
                      'Payment terms (days)',
                      'number',
                    )}
                  </>
                )}
              </>
            )}
            {kind === 'invoices' && (
              <>
                {(['billingAddressLabel', 'shippingAddressLabel'] as const).map(
                  (k) => (
                    <Field
                      key={k}
                      label={
                        k === 'billingAddressLabel'
                          ? 'Billing address'
                          : 'Shipping address'
                      }
                    >
                      {(p) => (
                        <Select
                          {...p}
                          value={header[k]}
                          onChange={(e) =>
                            setHeader((h) => ({ ...h, [k]: e.target.value }))
                          }
                          disabled={!canEdit}
                        >
                          <option value="">First customer address</option>
                          {customer?.addresses?.map((a) => (
                            <option key={a.label} value={a.label}>
                              {a.label} · {a.city}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  ),
                )}
                {header.supplyType.startsWith('export') && (
                  <>
                    {input('shippingBillNo', 'Shipping bill number')}
                    {input('shippingBillDate', 'Shipping bill date', 'date')}
                    {input('portCode', 'Port code')}
                  </>
                )}
              </>
            )}
            {input('remarks', 'Remarks')}
          </div>
        </Card>
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Item / description</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Rate ({header.currency})</Th>
                <Th>GST %</Th>
                {kind === 'invoices' && <Th>Dispatch</Th>}
                <Th className="text-right">Taxable value</Th>
                {canEdit && <Th />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="align-top">
                  <Td className="min-w-56">
                    {canEdit ? (
                      <>
                        <ItemPicker
                          value={l.item}
                          stockOnly={false}
                          onChange={(it) =>
                            update(l.key, {
                              item: it,
                              batchId: '',
                              soLineId: null,
                            })
                          }
                        />
                        <Input
                          className="mt-1"
                          aria-label="Description"
                          placeholder="Description / drawing revision"
                          value={l.description}
                          onChange={(e) =>
                            update(l.key, { description: e.target.value })
                          }
                        />
                      </>
                    ) : (
                      <>
                        <span className="font-mono">{l.item?.code}</span>
                        <p>{l.item?.name}</p>
                        <p className="text-muted">{l.description}</p>
                      </>
                    )}
                  </Td>
                  <Td className="min-w-28">
                    {canEdit ? (
                      <Input
                        aria-label="Quantity"
                        inputMode="decimal"
                        className="tabular text-right"
                        value={l.qty}
                        onChange={(e) => update(l.key, { qty: e.target.value })}
                      />
                    ) : (
                      formatQty(l.qty)
                    )}
                    <span className="text-[11px] text-muted">
                      {l.item?.uomCode}
                    </span>
                  </Td>
                  <Td className="min-w-32">
                    {canEdit ? (
                      <Input
                        aria-label="Rate"
                        inputMode="decimal"
                        className="tabular text-right"
                        value={l.rate}
                        onChange={(e) =>
                          update(l.key, { rate: e.target.value })
                        }
                      />
                    ) : (
                      formatAmount(l.rate, header.currency)
                    )}
                  </Td>
                  <Td>
                    {canEdit ? (
                      <Select
                        aria-label="GST rate"
                        value={l.gstRate}
                        onChange={(e) =>
                          update(l.key, { gstRate: e.target.value })
                        }
                      >
                        <option value="">From HSN/SAC</option>
                        {GST_RATE_OPTIONS.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </Select>
                    ) : (
                      `${l.gstRate}%`
                    )}
                  </Td>
                  {kind === 'invoices' && (
                    <Td className="min-w-44">
                      {canEdit && l.item?.isStockItem ? (
                        <>
                          <Select
                            aria-label="Warehouse"
                            value={l.warehouseId}
                            onChange={(e) =>
                              update(l.key, {
                                warehouseId: e.target.value,
                                batchId: '',
                              })
                            }
                          >
                            <option value="">Default dispatch warehouse</option>
                            {warehouses.data
                              ?.filter((w) => w.isActive && w.availableForIssue)
                              .map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.code} · {w.name}
                                </option>
                              ))}
                          </Select>
                          {l.item.tracking === 'batch' && (
                            <div className="mt-2">
                              <DispatchBatch
                                itemId={l.item.id}
                                warehouseId={l.warehouseId}
                                value={l.batchId}
                                onChange={(batchId) =>
                                  update(l.key, { batchId })
                                }
                              />
                            </div>
                          )}
                        </>
                      ) : canEdit ? (
                        'Service — no stock'
                      ) : (
                        <>
                          {doc?.lines[i]?.warehouseCode ?? 'Service'}
                          <p className="font-mono">{doc?.lines[i]?.batchNo}</p>
                        </>
                      )}
                    </Td>
                  )}
                  <Td className="tabular whitespace-nowrap text-right">
                    {formatAmount(
                      canEdit
                        ? (preview.data?.lines[previewLines.indexOf(l)]
                            ?.taxableValue ?? null)
                        : (doc?.lines[i]?.taxableValue ?? null),
                      header.currency,
                    )}
                  </Td>
                  {canEdit && (
                    <Td>
                      <Button
                        variant="ghost"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() =>
                          setLines((ls) => ls.filter((x) => x.key !== l.key))
                        }
                        disabled={lines.length === 1}
                      >
                        Remove
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          {canEdit && (
            <Button
              variant="link"
              onClick={() => setLines((ls) => [...ls, blank()])}
            >
              Add line
            </Button>
          )}
        </Card>
      </fieldset>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {(doc?.soNumber || sourceOrder?.number) && (
            <p>
              Against sales order{' '}
              <Link
                className="font-mono text-accent"
                href={`/app/selling/orders/${doc?.salesOrderId ?? sourceOrder?.id}`}
              >
                {doc?.soNumber ?? sourceOrder?.number}
              </Link>
            </p>
          )}
          {doc?.quotationNumber && (
            <p>
              From quotation{' '}
              <Link
                className="font-mono text-accent"
                href={`/app/selling/quotations/${doc.quotationId}`}
              >
                {doc.quotationNumber}
              </Link>
            </p>
          )}
          {doc?.stockEntryId && (
            <p>
              Delivery{' '}
              <Link
                className="font-mono text-accent"
                href={`/app/inventory/entries/${doc.stockEntryId}`}
              >
                {doc.stockEntryNumber}
              </Link>
            </p>
          )}
          {doc?.orders?.map((o) => (
            <p key={o.id}>
              Sales order{' '}
              <Link
                href={`/app/selling/orders/${o.id}`}
                className="text-accent"
              >
                {o.number ?? 'Draft'}
              </Link>
            </p>
          ))}
          {doc?.invoices?.map((inv) => (
            <p key={inv.id}>
              <Link
                href={`/app/selling/invoices/${inv.id}`}
                className="text-accent"
              >
                {inv.number ?? 'Draft invoice'}
              </Link>{' '}
              · {inv.status}
            </p>
          ))}
          {doc && (
            <Card className="p-4">
              <h2 className="font-semibold">Document history</h2>
              <p>Created {formatDateTime(doc.createdAt)}</p>
              {doc.submittedAt && (
                <p>Submitted {formatDateTime(doc.submittedAt)}</p>
              )}
              {doc.creditOverride && (
                <p className="text-warning">
                  Credit warning overridden by an approver
                </p>
              )}
              {doc.cancelledAt && (
                <p>
                  Cancelled {formatDateTime(doc.cancelledAt)} ·{' '}
                  {doc.cancelReason}
                </p>
              )}
            </Card>
          )}
        </div>
        <TaxSummary
          preview={canEdit ? preview.data : undefined}
          fixed={!canEdit && doc ? doc : undefined}
          loading={canEdit && preview.isFetching}
          error={canEdit ? preview.error : null}
          currency={header.currency}
        />
      </div>
      {dialog === 'credit' && (
        <FormDialog
          title="Credit warning"
          description={creditWarning ?? ''}
          onClose={() => setDialog(null)}
          onSubmit={() => save.mutate({ submit: true, override: true })}
          pending={save.isPending}
          error={save.error}
          submitLabel="Override and submit"
        >
          <p>Submitting over this warning will be recorded in the audit log.</p>
        </FormDialog>
      )}
      {dialog && dialog !== 'credit' && draftId && (
        <SellingAction
          kind={kind}
          id={draftId}
          action={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function DispatchBatch({
  itemId,
  warehouseId,
  value,
  onChange,
}: {
  itemId: string;
  warehouseId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ['batches', ws.entityId, itemId, warehouseId, 'company'],
    queryFn: () =>
      api<Batch[]>(
        `/batches?itemId=${itemId}&inStock=true&owner=company${warehouseId ? `&warehouseId=${warehouseId}` : ''}`,
        { scope: ws.scope },
      ),
    retry: false,
  });
  return (
    <>
      <Select
        aria-label="Batch"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose batch…</option>
        {q.data?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.batchNo} · {formatQty(b.qty)}
          </option>
        ))}
      </Select>
      {q.error && <p className="text-danger">{q.error.message}</p>}
    </>
  );
}
function SellingAction({
  kind,
  id,
  action,
  onClose,
}: {
  kind: SellingKind;
  id: string;
  action: 'cancel' | 'close' | 'delete';
  onClose: () => void;
}) {
  const ws = useWorkspace(),
    qc = useQueryClient(),
    router = useRouter(),
    config = SELLING[kind];
  const [reason, setReason] = useState('');
  const label =
    action === 'delete'
      ? 'Delete draft'
      : action === 'close'
        ? 'Short-close'
        : `Cancel ${config.singular}`;
  const m = useMutation({
    mutationFn: () =>
      api(
        `/${config.endpoint}/${id}${action === 'delete' ? '' : `/${action}`}`,
        {
          method: action === 'delete' ? 'DELETE' : 'POST',
          body: action === 'delete' ? undefined : { reason },
          scope: ws.scope,
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['selling'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
      onClose();
      if (action === 'delete') router.replace(`/app/selling/${kind}`);
    },
  });
  return (
    <FormDialog
      title={label}
      description={
        action === 'delete'
          ? 'Permanently remove this draft?'
          : kind === 'invoices'
            ? 'Cancellation reverses the stock delivery and keeps the original invoice for audit.'
            : 'The original document remains visible in the audit trail.'
      }
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
      submitLabel={label}
    >
      {action !== 'delete' && (
        <Field label="Reason">
          {(p) => (
            <Input
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              required
            />
          )}
        </Field>
      )}
    </FormDialog>
  );
}
