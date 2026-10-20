"use client";
import { Alert, buttonClass, Card } from "@factoryos/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { useWorkspace } from "./workspace";
export function InvoiceBalance({
  type,
  id,
  partyId,
}: {
  type: "sales" | "purchase";
  id: string;
  /** The customer or supplier, for the "Record receipt/payment" hand-off (decision 068). */
  partyId?: string;
}) {
  const ws = useWorkspace();
  const q = useQuery({
    queryKey: ["invoice-balance", ws.tenantId, ws.entityId, type, id],
    queryFn: () =>
      api<{
        active: boolean;
        currency: string;
        openAmount: string;
        carryingInr: string;
      }>(`/${type}-invoices/${id}/balance`, { scope: ws.scope }),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  if (q.error) return <Alert tone="danger">{q.error.message}</Alert>;
  // Only booked bills can be settled: before cut-over there is nothing to allocate a receipt or payment to.
  const open = !!q.data?.active && Number(q.data.openAmount) > 0;
  const direction = type === "sales" ? "receipt" : "payment";
  return (
    <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          Remaining bill balance:{" "}
          <span className="font-mono">
            {q.data ? `${q.data.currency} ${q.data.openAmount}` : "Loading…"}
          </span>
          {q.data?.active && (
            <span className="text-muted"> · INR {q.data.carryingInr}</span>
          )}
        </p>
        {q.data && !q.data.active && (
          <p className="text-xs text-muted">
            Accounting inactive; this shows the submitted invoice total until
            cut-over establishes outstanding bills.
          </p>
        )}
      </div>
      {open && partyId && ws.can("accounts.settlement.create") && (
        <Link
          href={`/app/accounts/settlements/new?direction=${direction}&party=${partyId}`}
          className={buttonClass("secondary", "sm")}
        >
          {type === "sales" ? "Record receipt" : "Record payment"}
        </Link>
      )}
    </Card>
  );
}
