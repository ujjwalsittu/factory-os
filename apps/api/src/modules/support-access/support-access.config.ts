// Audited support access (decision 050): the deployment switch. Off by default; no emergency bypass.
import { SUPPORT_MAX_DURATION_SECONDS } from '@factoryos/auth';
import type { SupportConfig } from './support-access.types.js';

const invalid = () => new Error('Invalid SUPPORT_ACCESS configuration');

/** Only the canonical web origin may drive support requests in this release; extra trusted origins do not widen it. */
function canonicalOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw invalid();
  if (raw !== url.origin && raw !== `${url.origin}/`) throw invalid();
  return url.origin;
}

export function loadSupportConfig(env: NodeJS.ProcessEnv, webOrigin: string): SupportConfig {
  const flag = env.SUPPORT_ACCESS_ENABLED ?? 'false';
  if (flag !== 'true' && flag !== 'false') throw invalid();
  return { enabled: flag === 'true', maxDurationSeconds: SUPPORT_MAX_DURATION_SECONDS, origins: [canonicalOrigin(webOrigin)] };
}
