#!/usr/bin/env bash
# Issues a tap's identity and writes it to the tap (decision 064):
#   - a key and certificate (CN = device code, 5 years) from the plant CA;
#   - the tap in the broker's ACL: write its state and status, read its config and the plant's ota;
#   - the tap's NVS image: Wi-Fi, broker, NTP, CA, certificate, key, tenant, plant, device code, and the first
#     sequence number (the time in ms, so a re-provisioned tap never repeats an old number);
#   - with --port, flashed over USB with esptool. The key and the image are then deleted from the edge PC (--keep
#     keeps them).
# The tap must already carry the MT-1 firmware (see firmware/README.md).
# Usage (as root): firmware/provision/issue-tap.sh <device> [--port /dev/ttyACM0] [--reissue] [--keep]
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
need TENANT PLANT EDGE_HOST WIFI_SSID WIFI_PASS
device="${1:-}"
[ -n "$device" ] || die "usage: issue-tap.sh <device> [--port /dev/ttyACM0] [--reissue] [--keep]"
code_ok "$device"
[ "$device" = edge-agent ] && die "edge-agent is reserved"
shift
port="" reissue="" keep=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    --reissue) reissue=1; shift ;;
    --keep) keep=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[ -f "$PKI/ca.key" ] || die "no plant CA yet: run plant-ca.sh first"

dir="$PKI/taps/$device"
if awk -F'\t' -v d="/CN=$device" '$1 == "V" && index($6, "/OU=FactoryOS tap/") && substr($6, length($6) - length(d) + 1) == d { f = 1 } END { exit !f }' "$PKI/index.txt"; then
  [ -n "$reissue" ] || die "$device already has a valid certificate; pass --reissue to revoke it and issue a new one"
  "$here/revoke-tap.sh" "$device"
fi
rm -rf "$dir"
mkdir -p "$dir"

echo "→ certificate for $device"
openssl ecparam -name prime256v1 -genkey -noout -out "$dir/key.pem"
openssl req -new -key "$dir/key.pem" -subj "/O=FactoryOS/OU=FactoryOS tap/CN=$device" -out "$dir/csr.pem"
openssl ca -batch -config "$PKI/openssl.cnf" -extensions client_cert -days 1825 -notext -in "$dir/csr.pem" -out "$dir/cert.pem" 2>/dev/null
rm "$dir/csr.pem"
write_acl
$MOSQUITTO_RELOAD >/dev/null 2>&1 || echo "warning: could not reload the broker ($MOSQUITTO_RELOAD); reload it to apply the ACL"

echo "→ NVS image"
# Built with Python's csv module so a comma or quote in the Wi-Fi password is written correctly.
python3 - "$dir/nvs.csv" "$device" "$PKI/ca.crt" "$dir/cert.pem" "$dir/key.pem" "$(date +%s%3N)" <<'PY'
import csv, os, sys
out, device, ca, cert, key, seq = sys.argv[1:]
env = os.environ
rows = [
    ("key", "type", "encoding", "value"),
    ("tap", "namespace", "", ""),
    ("wifi_ssid", "data", "string", env["WIFI_SSID"]),
    ("wifi_pass", "data", "string", env["WIFI_PASS"]),
    ("broker", "data", "string", env.get("BROKER_HOST") or env["EDGE_HOST"]),
    ("port", "data", "u16", env.get("BROKER_PORT") or "8883"),
    ("ntp", "data", "string", env.get("NTP_HOST") or env.get("BROKER_HOST") or env["EDGE_HOST"]),
    ("tenant", "data", "string", env["TENANT"]),
    ("plant", "data", "string", env["PLANT"]),
    ("device", "data", "string", device),
    ("ca", "file", "string", ca),
    ("cert", "file", "string", cert),
    ("key", "file", "string", key),
    ("seq", "namespace", "", ""),
    ("hw", "data", "u64", seq),
]
with open(out, "w", newline="") as f:
    csv.writer(f).writerows(rows)
PY
# The NVS partition of default_8MB.csv: offset 0x9000, size 0x5000.
python3 -m esp_idf_nvs_partition_gen generate "$dir/nvs.csv" "$dir/nvs.bin" 0x5000 >/dev/null

if [ -n "$port" ]; then
  echo "→ flashing $device's identity on $port"
  python3 -m esptool --chip esp32s3 --port "$port" write_flash 0x9000 "$dir/nvs.bin"
  [ -n "$keep" ] || rm -f "$dir/key.pem" "$dir/nvs.csv" "$dir/nvs.bin"
  echo "$device is provisioned. Plug it in on its machine; it shows in Plant → Devices once it reports."
else
  echo "$device is issued. Flash it with:"
  echo "  python3 -m esptool --chip esp32s3 --port /dev/ttyACM0 write_flash 0x9000 $dir/nvs.bin"
  echo "then delete $dir/key.pem, nvs.csv and nvs.bin: they hold the tap's key and the Wi-Fi password."
fi
