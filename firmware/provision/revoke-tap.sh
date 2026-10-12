#!/usr/bin/env bash
# Revokes a lost or retired tap's certificate (decision 064): adds it to the CRL, drops it from the ACL and restarts the
# broker so open connections close and the new CRL applies. Other taps are unaffected; they reconnect on their own.
# Usage (as root): firmware/provision/revoke-tap.sh <device>
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$here/common.sh"
need TENANT PLANT
device="${1:-}"
[ -n "$device" ] || die "usage: revoke-tap.sh <device>"
code_ok "$device"
cert="$PKI/taps/$device/cert.pem"
[ -f "$cert" ] || die "no certificate issued to $device"
openssl ca -config "$PKI/openssl.cnf" -revoke "$cert" -crl_reason keyCompromise 2>/dev/null || die "could not revoke $device (already revoked?)"
write_crl
write_acl
$MOSQUITTO_RESTART >/dev/null 2>&1 || echo "warning: could not restart the broker ($MOSQUITTO_RESTART); restart it to apply the CRL"
echo "$device is revoked. Retire it in Plant → Devices too."
