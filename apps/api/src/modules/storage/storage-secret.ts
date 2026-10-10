// Seals the R2 secret access key saved on Platform → Storage (decision 051). AES-256-GCM with a key held only in
// the deployment environment (STORAGE_CREDENTIAL_KEY_V1); the additional data binds the ciphertext to this use.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { StorageSecretEnvelope } from '@factoryos/db';

const AAD = Buffer.from('factoryos:platform-storage:secret:v1');

function key(raw: string) {
  const b = Buffer.from(raw, 'base64');
  if (b.length !== 32 || b.toString('base64') !== raw) throw new Error('STORAGE_CREDENTIAL_KEY_V1 must be canonical base64 of 32 bytes');
  return b;
}

export function sealStorageSecret(secret: string, raw: string): StorageSecretEnvelope {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(raw), iv);
  c.setAAD(AAD);
  const ciphertext = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return { keyVersion: 'v1', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function openStorageSecret(envelope: StorageSecretEnvelope, raw: string): string {
  if (envelope.keyVersion !== 'v1') throw new Error('Unknown storage secret key version');
  const d = createDecipheriv('aes-256-gcm', key(raw), Buffer.from(envelope.iv, 'base64'));
  d.setAAD(AAD);
  d.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(envelope.ciphertext, 'base64')), d.final()]).toString('utf8');
}
