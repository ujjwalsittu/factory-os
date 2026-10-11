'use client';
// Support workspace (decision 050): the read-only view of one started approval. The banner (who, as whom, where, why,
// until when, Stop) is always visible; ended access clears all data and never resumes automatically.
import { Alert, Badge, Button, buttonClass, Card } from '@factoryos/ui';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SupportAccessPanels } from '@/components/support-access-panels';
import { type SupportEnd, SupportAccessProvider, useSupportAccess } from '@/components/support-access-provider';
import { formatDateTime } from '@/lib/format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default function SupportWorkspacePage() {
  const { grantId } = useParams<{ grantId: string }>();
  if (!UUID.test(grantId)) return <Alert tone="danger">This support link is not valid.</Alert>;
  return (
    <SupportAccessProvider key={grantId} grantId={grantId}>
      <Workspace />
    </SupportAccessProvider>
  );
}

const ENDED: Record<SupportEnd, string> = {
  ended: 'This support access has ended.',
  expired: 'The approved time is over. This support access has ended.',
  stopped: 'You stopped this support access.',
  'signed-out': 'Your sign-in changed, so this support access was closed.',
  unavailable: 'This support access is no longer available.',
};

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Workspace() {
  const { context, ended, verifying, remainingMs, stop } = useSupportAccess();
  if (ended)
    return (
      <Card className="space-y-4 p-6">
        <Alert tone="warning" title="Support access ended">
          {ENDED[ended]} Ask the customer for a new approval if more help is needed.
        </Alert>
        <Link href="/support" className={buttonClass('secondary', 'sm')}>
          Back to the inbox
        </Link>
      </Card>
    );
  if (!context) return <p className="text-muted">Checking access…</p>;
  const g = context.grant;
  return (
    <div className="space-y-5">
      <Card className="sticky top-0 z-10 space-y-3 p-4" aria-label="Support session">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">
            <Eye className="size-3" /> Read-only support
          </Badge>
          <span className="font-medium">{g.tenantName}</span>
          <span className="text-muted">· {g.entityName}</span>
          <span className="ml-auto font-mono text-[13px]" aria-label="Time left">
            {remainingMs !== null ? clock(remainingMs) : ''}
          </span>
          <Button size="sm" variant="danger" onClick={() => void stop()}>
            Stop
          </Button>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="inline text-muted">Operator </dt>
            <dd className="inline">{context.actor.name}</dd>
          </div>
          <div>
            <dt className="inline text-muted">Viewing as </dt>
            <dd className="inline">{g.subject.name}</dd>
          </div>
          <div>
            <dt className="inline text-muted">Ends </dt>
            <dd className="inline">{formatDateTime(context.expiresAt)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="inline text-muted">Reason </dt>
            <dd className="inline break-words">{g.reason}</dd>
          </div>
        </dl>
      </Card>
      {verifying && <p className="text-muted">Checking access…</p>}
      {/* Hidden, not unmounted, while access is re-checked: tabs, drill-downs and pages survive a window switch. */}
      <div hidden={verifying} aria-hidden={verifying}>
        <SupportAccessPanels context={context} />
      </div>
    </div>
  );
}
