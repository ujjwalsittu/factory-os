#!/usr/bin/env bash
# Checks the provisioning scripts (decision 064) in a throwaway directory against a real Mosquitto in Docker: the plant
# CA, two taps, what each may publish and read, and revoking one. Needs docker, openssl, python3 with
# esp-idf-nvs-partition-gen, and the edge agent's dependencies installed (pnpm install).
# Usage: firmware/provision/test/check.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
name="factoryos-mosquitto-test-$$"
port="${PORT:-18883}"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

export EDGE_DIR="$work/edge"
mkdir -p "$EDGE_DIR"
cat > "$EDGE_DIR/provision.env" <<ENV
TENANT=azeonics
PLANT=NM1
EDGE_HOST=edge-nm1.plant
WIFI_SSID='Plant floor'
WIFI_PASS='pa,ss"word'
MOSQUITTO_RELOAD="docker kill --signal=HUP $name"
MOSQUITTO_RESTART="docker restart $name"
ENV

echo "→ plant CA and two taps"
"$here/../plant-ca.sh" >/dev/null
"$here/../issue-tap.sh" MT1-01 >/dev/null
"$here/../issue-tap.sh" MT1-02 >/dev/null
if "$here/../issue-tap.sh" MT1-01 >/dev/null 2>&1; then echo "a second certificate for MT1-01 was issued without --reissue"; exit 1; fi
pki="$EDGE_DIR/pki"
openssl verify -CAfile "$pki/ca.crt" "$pki/taps/MT1-01/cert.pem" >/dev/null
openssl x509 -in "$pki/taps/MT1-01/cert.pem" -noout -subject | grep -q "CN = MT1-01"
python3 -m esp_idf_nvs_partition_gen --help >/dev/null
[ "$(stat -c %s "$pki/taps/MT1-01/nvs.bin")" = 20480 ] || { echo "the NVS image is not 0x5000 bytes"; exit 1; }
grep -q '"pa,ss""word"' "$pki/taps/MT1-01/nvs.csv" || { echo "the Wi-Fi password is not quoted in the NVS CSV"; exit 1; }
[ "$(stat -c %a "$pki")" = 700 ] || { echo "the PKI directory is readable by others"; exit 1; }
grep -q "user MT1-02" "$EDGE_DIR/mosquitto/acl"

echo "→ Mosquitto with the generated config"
docker run -d --name "$name" -p "127.0.0.1:$port:8883" -v "$EDGE_DIR/mosquitto:/mosquitto/config" eclipse-mosquitto:2.0.20 >/dev/null
node -e "setTimeout(()=>{},2000)"
node "$here/check.mjs" before "$port" "$EDGE_DIR"

echo "→ revoke MT1-01"
"$here/../revoke-tap.sh" MT1-01 >/dev/null
grep -q "user MT1-01" "$EDGE_DIR/mosquitto/acl" && { echo "MT1-01 is still in the ACL"; exit 1; }
openssl verify -crl_check -CAfile "$pki/ca.crt" -CRLfile "$pki/crl.pem" "$pki/taps/MT1-01/cert.pem" >/dev/null 2>&1 && { echo "MT1-01 still verifies"; exit 1; }
node -e "setTimeout(()=>{},2000)"
node "$here/check.mjs" after "$port" "$EDGE_DIR"
echo "→ reissue MT1-01"
"$here/../issue-tap.sh" MT1-01 --reissue >/dev/null
grep -q "user MT1-01" "$EDGE_DIR/mosquitto/acl"
echo "Provisioning check passed."
