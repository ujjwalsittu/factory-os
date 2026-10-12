#!/usr/bin/env bash
# MT-1 firmware check (decision 064): host tests of tapcore, the ESP32-S3 development build, and the built image
# signed with the development key and checked the way the edge agent checks it.
# Usage: firmware/scripts/check.sh   (PIO=/path/to/pio to override; the edge agent must be built for the last step)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
pio="${PIO:-$(command -v pio || echo "$HOME/.local/bin/pio")}"
cd "$here/../mt1"

echo "→ host tests (tapcore)"
"$pio" test -e native
echo "→ ESP32-S3 development build"
"$pio" run -e esp32s3-dev

echo "→ sign the build with the development key and check it like the edge agent"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
version="$(sed -n 's/^fw_version = //p' platformio.ini)-dev"
node "$here/sign.mjs" sign .pio/build/esp32s3-dev/firmware.bin --version "$version" --dev --out "$out"
agent="$here/../../apps/edge-agent/dist/index.js"
if [ -f "$agent" ]; then
  node --input-type=module -e "
    const { scanFirmware, ed25519PublicKey } = await import('$agent');
    const { valid, skipped } = scanFirmware('$out', ed25519PublicKey('$(node "$here/sign.mjs" pubkey --dev)'));
    if (valid[0]?.manifest.version !== '$version' || skipped.length) throw new Error('The edge agent refused the build: ' + JSON.stringify(skipped));
    console.log('the edge agent accepts', valid[0].file);
  "
else
  echo "(skipped: build the edge agent first with pnpm --filter @factoryos/edge-agent build)"
fi
echo "Firmware check passed."
