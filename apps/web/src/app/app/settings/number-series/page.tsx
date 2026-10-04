'use client';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Table,
  Td,
  Th,
} from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EntityGate } from '@/components/entity-gate';
import { FormDialog, fieldErrors } from '@/components/form-dialog';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { NumberSeries } from '@/lib/selling';

export default function Page() {
  return (
    <>
      <PageHeader
        title="Number series"
        description="Continue numbering from existing books. Numbers can only move forward; tax invoices have a separate series for each GSTIN and financial year."
      />
      <EntityGate what="number series">
        <SeriesList />
      </EntityGate>
    </>
  );
}
function SeriesList() {
  const ws = useWorkspace();
  const [selected, setSelected] = useState<NumberSeries | null>(null);
  const q = useQuery({
    queryKey: ['number-series', ws.tenantId, ws.entityId],
    queryFn: () => api<NumberSeries[]>('/number-series', { scope: ws.scope }),
    retry: false,
  });
  return (
    <>
      <Card>
        {q.error && <Alert tone="danger">{q.error.message}</Alert>}
        {q.isLoading && <p className="p-4">Loading…</p>}
        <Table>
          <thead>
            <tr>
              <Th>Document</Th>
              <Th>GSTIN</Th>
              <Th>FY</Th>
              <Th>Next value</Th>
              <Th>Next number</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.docType}>
                <Td>{r.label}</Td>
                <Td className="font-mono">{r.gstin ?? 'Entity-wide'}</Td>
                <Td>{r.fy}</Td>
                <Td className="tabular">{r.nextValue}</Td>
                <Td className="font-mono">{r.nextNumber}</Td>
                <Td>
                  {ws.can('settings.entity.update') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelected(r)}
                    >
                      Set next number
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {selected && (
        <SeriesDialog
          key={`${ws.entityId}:${selected.docType}`}
          series={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function SeriesDialog({
  series,
  onClose,
}: {
  series: NumberSeries;
  onClose: () => void;
}) {
  const ws = useWorkspace(),
    qc = useQueryClient();
  const [value, setValue] = useState(String(series.nextValue));
  const m = useMutation({
    mutationFn: () =>
      api('/number-series', {
        method: 'PUT',
        body: {
          docType: series.docType,
          fy: series.fy,
          nextValue: Number(value),
        },
        scope: ws.scope,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['number-series'] });
      onClose();
    },
  });
  return (
    <FormDialog
      title={`Set next number · ${series.label}`}
      description={`FY ${series.fy}. Current next value: ${series.nextValue}. Moving forward cannot be undone.`}
      onClose={onClose}
      onSubmit={() => m.mutate()}
      pending={m.isPending}
      error={m.error}
    >
      <Field label="Next value" error={fieldErrors(m.error).nextValue}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={1}
            max={99999999}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        )}
      </Field>
    </FormDialog>
  );
}
