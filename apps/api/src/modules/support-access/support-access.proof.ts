// Audited support access (decision 050): native proof for approval, policy enablement and start.
// The real native session (no cookie cache, no renewal) and the real native password verifier; the server snapshots
// the security epoch and credential version first, so a password or factor change during the check refuses.
import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../common/access.js';
import { AUTH } from '../../common/tokens.js';
import type { Auth } from '../../auth.js';
import { SupportAccessStore, SupportError } from './support-access.store.js';
import type { SupportProof } from './support-access.types.js';

@Injectable()
export class SupportProofService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly store: SupportAccessStore,
  ) {}

  /** Authoritative native actor for this request: never served from the cookie cache, never extended. */
  async actor(headers: Headers): Promise<RequestContext> {
    const session = await this.auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } }).catch(() => null);
    if (!session) throw new SupportError('SUPPORT_REAUTHENTICATE', 'no-session');
    return {
      user: { id: session.user.id, email: session.user.email, name: session.user.name },
      sessionId: session.session.id,
      platformAdminLevel: null,
      tenant: null,
      ip: null,
      userAgent: null,
    };
  }

  /**
   * Confirms the password of the native session that sent `headers` and returns a server-only proof. The caller's
   * transaction must still run `store.checkProof` under its locks before relying on it.
   */
  async confirm(headers: Headers, password: string, expectedUserId?: string): Promise<SupportProof> {
    const actor = await this.actor(headers);
    if (expectedUserId && actor.user.id !== expectedUserId) throw new SupportError('SUPPORT_REAUTHENTICATE', 'session-mismatch');
    const proof = await this.store.captureProofVersion(actor);
    let ok = false;
    try {
      ok = (await this.auth.api.verifyPassword({ body: { password }, headers })).status === true;
    } catch {
      ok = false;
    }
    if (!ok) throw new SupportError('SUPPORT_REAUTHENTICATE', 'password');
    return proof;
  }
}
