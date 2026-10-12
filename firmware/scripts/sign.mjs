#!/usr/bin/env node
// Signs an MT-1 firmware build for over-the-air updates (decision 064).
//
//   node firmware/scripts/sign.mjs keygen                      new release key: keep the private half offline
//   node firmware/scripts/sign.mjs pubkey                      the public key of MT1_SIGNING_KEY (or --dev)
//   node firmware/scripts/sign.mjs sign <firmware.bin> --version 1.2.0 [--out dir]
//   node firmware/scripts/sign.mjs sign <firmware.bin> --version 1.2.0-dev --dev [--out dir]
//
// `sign` writes `<out>/mt1-<version>.bin` and `mt1-<version>.bin.manifest.json` ({version, size, sha256, signature}),
// the pair the edge agent's FIRMWARE_DIR takes. The signature is Ed25519 over `factoryos-mt1|{version}|{size}|{sha256}`.
//
// Keys are 32-byte Ed25519 seeds in base64. The release key comes from MT1_SIGNING_KEY or --key <file> and is never
// in the repository. --dev uses the development key below, which is public on purpose: development firmware
// (version `-dev`) trusts only it, and release firmware never trusts it.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEV_SEED = createHash('sha256').update('factoryos-mt1 development signing key: public by design, never for release').digest();

export const privateKeyFromSeed = (seed) => createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
export const publicKeyRaw = (seed) => Buffer.from(createPublicKey(privateKeyFromSeed(seed)).export({ format: 'jwk' }).x, 'base64url');
export const signingPayload = (m) => `factoryos-mt1|${m.version}|${m.size}|${m.sha256}`;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.-]{1,20})?$/;

/** The manifest for a build; `dev` builds must be `-dev` versions and release builds must not. */
export function manifestFor(bin, version, seed, dev) {
  if (!VERSION.test(version)) throw new Error(`Bad version ${version}: use major.minor.patch[-label]`);
  if (dev !== version.endsWith('-dev')) throw new Error(dev ? 'Development builds are versioned x.y.z-dev' : 'A release version cannot end in -dev');
  if (!dev && seed.equals(DEV_SEED)) throw new Error('The development key cannot sign a release');
  const m = { version, size: bin.length, sha256: createHash('sha256').update(bin).digest('hex') };
  return { ...m, signature: sign(null, Buffer.from(signingPayload(m)), privateKeyFromSeed(seed)).toString('base64') };
}

function seedFrom(args) {
  if (args.includes('--dev')) return DEV_SEED;
  const k = args.indexOf('--key');
  const b64 = (k >= 0 ? readFileSync(args[k + 1], 'utf8') : process.env.MT1_SIGNING_KEY ?? '').trim();
  const seed = Buffer.from(b64, 'base64');
  if (seed.length !== 32) throw new Error('Set MT1_SIGNING_KEY (or --key <file>) to the 32-byte signing key in base64, or pass --dev');
  return seed;
}

function main(argv) {
  const [cmd, ...args] = argv;
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (cmd === 'keygen') {
    const seed = randomBytes(32);
    console.log(`private (keep offline, with a backup): ${seed.toString('base64')}`);
    console.log(`public  (MT1_RELEASE_PUBKEY and OTA_PUBLIC_KEY): ${publicKeyRaw(seed).toString('base64')}`);
  } else if (cmd === 'pubkey') {
    console.log(publicKeyRaw(seedFrom(args)).toString('base64'));
  } else if (cmd === 'sign') {
    const file = args[0];
    const version = opt('--version');
    if (!file || !version) throw new Error('Usage: sign <firmware.bin> --version x.y.z [--dev] [--out dir]');
    const dev = args.includes('--dev');
    const bin = readFileSync(file);
    const m = manifestFor(bin, version, seedFrom(args), dev);
    const out = opt('--out') ?? '.';
    mkdirSync(out, { recursive: true });
    const name = `mt1-${version}.bin`;
    copyFileSync(file, join(out, name));
    writeFileSync(join(out, `${name}.manifest.json`), `${JSON.stringify(m, null, 2)}\n`);
    console.log(`signed ${name} (${m.size} bytes, sha256 ${m.sha256}) into ${out}`);
  } else {
    throw new Error('Commands: keygen | pubkey [--dev] | sign <firmware.bin> --version x.y.z [--dev] [--out dir]');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
