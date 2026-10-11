'use client';
// Settings → Support access (decision 050): tenant policy, approvals and history.
import { PageHeader } from '@factoryos/ui';
import { ReadOnlyNotice, SupportAccessControls } from '@/components/support-access-controls';
import { useWorkspace } from '@/components/workspace';
import { authClient } from '@/lib/auth-client';

export default function SupportAccessSettingsPage() {
  const ws = useWorkspace();
  const session = authClient.useSession();
  if (!session.data?.user || session.data.user.id !== ws.me.user.id) return null;
  return (
    <>
      <PageHeader title="Support access" description="Let a FactoryOS support person view this tenant's records for a short, approved time." />
      <ReadOnlyNotice />
      <SupportAccessControls key={`${ws.me.user.id}:${ws.tenantId}`} tenantId={ws.tenantId} />
    </>
  );
}
