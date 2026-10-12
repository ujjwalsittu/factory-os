# Tap provisioning (decision 064)

Run on the plant's edge PC as root. The step-by-step setup is in
[the edge PC install guide](../../docs/iot/edge-install.md).

| Script | What it does |
|---|---|
| `plant-ca.sh` | Once per plant: the plant CA, the broker and firmware server certificate, the edge agent's client certificate, and the broker's config, CRL and ACL |
| `issue-tap.sh <device> [--port …] [--reissue] [--keep]` | A tap's certificate and ACL entry, its NVS identity image, flashed over USB |
| `revoke-tap.sh <device>` | Puts the tap's certificate on the CRL, removes it from the ACL and restarts the broker |
| `test/check.sh` | Runs the scripts in a temporary directory against Mosquitto in Docker: refusals, the ACL, revocation, reissue |

Settings come from `$EDGE_DIR/provision.env` (default `/etc/factoryos-edge`): `TENANT`, `PLANT`, `EDGE_HOST`, optional
`EDGE_IP`, `WIFI_SSID`, `WIFI_PASS`, and optionally `BROKER_HOST`, `BROKER_PORT`, `NTP_HOST`, `MOSQUITTO_RELOAD`,
`MOSQUITTO_RESTART`.
