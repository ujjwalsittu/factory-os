'use client';
import { Alert, Button, buttonClass, Card, Logo } from '@factoryos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FullPageLoading } from '@/components/loading';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { formatDate } from '@/lib/format';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const session = authClient.useSession();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<{ tenantName: string; email: string; expiresAt: string }>(`/invitations/lookup/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api<{ tenantId: string }>('/invitations/accept', { method: 'POST', body: { token } }),
    onSuccess: ({ tenantId }) => {
      try {
        localStorage.setItem('fos.tenant', tenantId);
      } catch {}
      router.replace('/app');
    },
  });

  if (invite.isLoading || session.isPending) return <FullPageLoading label="Checking your invitation…" />;
  const here = `/invite/${token}`;
  const user = session.data?.user;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md p-8">
        <Logo />
        {invite.error ? (
          <Alert tone="danger" className="mt-6" title="This invitation can't be used">
            {invite.error instanceof ApiError && invite.error.status === 410 ? 'It has expired.' : 'It was already used, revoked, or the link is incomplete.'} Ask your administrator for a new one.
          </Alert>
        ) : (
          invite.data && (
            <>
              <h1 className="mt-6 text-xl font-semibold">Join {invite.data.tenantName}</h1>
              <p className="mt-1 text-sm text-muted">
                Invitation for <span className="font-medium text-fg">{invite.data.email}</span> · valid until {formatDate(invite.data.expiresAt)}
              </p>
              {accept.error && (
                <Alert tone="danger" className="mt-4">
                  {accept.error.message}
                </Alert>
              )}
              <div className="mt-6 space-y-3">
                {!user && (
                  <>
                    <Link href={`/sign-up?email=${encodeURIComponent(invite.data.email)}&next=${encodeURIComponent(here)}`} className={buttonClass('primary', 'lg', 'w-full')}>
                      Create account and join
                    </Link>
                    <Link href={`/sign-in?next=${encodeURIComponent(here)}`} className={buttonClass('secondary', 'lg', 'w-full')}>
                      I already have an account
                    </Link>
                  </>
                )}
                {user && user.email.toLowerCase() === invite.data.email && (
                  <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
                    Accept invitation
                  </Button>
                )}
                {user && user.email.toLowerCase() !== invite.data.email && (
                  <>
                    <Alert tone="warning">
                      You're signed in as {user.email}. Sign out and continue as {invite.data.email}.
                    </Alert>
                    <Button variant="secondary" className="w-full" onClick={async () => (await authClient.signOut(), session.refetch())}>
                      Sign out
                    </Button>
                  </>
                )}
              </div>
            </>
          )
        )}
      </Card>
    </div>
  );
}
