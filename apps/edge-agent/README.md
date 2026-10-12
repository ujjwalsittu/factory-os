# @factoryos/edge-agent

The plant edge agent (decision 063, [design](../../docs/superpowers/specs/2026-10-12-iot-metering-design.md)). It runs
on the plant's edge PC next to a local Mosquitto broker:

- subscribes to `factoryos/{tenant}/{plant}/+/state` (the machine taps' state messages, contract in
  [`@factoryos/iot-protocol`](../../packages/iot-protocol));
- writes every valid message to `queue.jsonl` in the data directory before anything else;
- posts batches to the FactoryOS API (`POST /api/iot/ingest`) with the edge key, retrying with backoff while the API
  is unreachable;
- removes events the API accepted or already had, and moves refused ones to `quarantine.jsonl` with the reason.

Decision 064 ([design](../../docs/superpowers/specs/2026-10-12-tap-firmware-design.md)) adds, once a minute:

- **Settings:** fetches the taps' settings (`GET /api/iot/config`) and publishes each changed one, retained, on
  `…/{device}/config`. A tap that is retired or moved to another edge has its retained config cleared.
- **Status:** forwards the latest retained `…/{device}/status` of each tap to `POST /api/iot/status`; Plant → Devices
  shows whether the tap runs the current settings, its firmware, signal, outbox and last error.
- **Firmware updates** (when `FIRMWARE_DIR` is set):
  - checks every `<name>.bin` + `<name>.bin.manifest.json` in the directory: size, SHA-256 and the Ed25519
    signature against `OTA_PUBLIC_KEY`;
  - serves only the newest valid build over HTTPS (`/firmware/<name>.bin`, the edge's certificate from the plant
    CA);
  - announces it, retained, on `factoryos/{tenant}/{plant}/ota`. Builds that fail a check are logged and skipped.

Decision 065 ([design](../../docs/superpowers/specs/2026-10-12-smt-traceability-design.md)) adds **label printing**:

- every 3 seconds the agent claims its printers' label jobs (`GET /api/iot/print-jobs`, with a 60 s lease);
- it sends each job's ZPL over raw TCP to the printer, then reports the result (`POST /api/iot/print-jobs/:id/result`);
- a failure is retried up to three times, then shows as failed in Plant → Devices with Reprint.

The printer's address comes from FactoryOS, so the agent only connects to printer ports (`PRINTER_PORTS`, default
9100). Set `PRINTER_HOSTS` to restrict it to the plant's printers too.

## Run

Node 22. Build with `pnpm --filter @factoryos/edge-agent build`, then:

```sh
FACTORYOS_API_URL=https://factoryos.example.com/api \
FACTORYOS_EDGE_KEY=fos_edge_…      # Plant → Devices → the edge's key (shown once)
FACTORYOS_TENANT=azeonics          # the workspace slug
FACTORYOS_PLANT=NM1                # the plant code used in the taps' topics
MQTT_URL=mqtt://localhost:1883 \
FACTORYOS_DATA_DIR=/var/lib/factoryos-edge \
node dist/main.js
```

Optional:

| Variable | Meaning |
|---|---|
| `MQTT_CA`, `MQTT_CERT`, `MQTT_KEY` | PEM files: the plant CA, and the agent's own certificate and key, for TLS to Mosquitto on 8883 |
| `FIRMWARE_DIR` | Directory of signed builds; turns firmware updates on |
| `OTA_PUBLIC_KEY` | The signing public key (32 bytes, base64), the same one compiled into the firmware |
| `OTA_BASE_URL` | How taps reach the firmware server, e.g. `https://edge-nm1.plant:8443` (must match its certificate) |
| `OTA_PORT` | Firmware server port (default 8443) |
| `OTA_TLS_KEY`, `OTA_TLS_CERT` | PEM files for the firmware server, issued by the plant CA |
| `PRINT_POLL_MS` | How often to ask for label jobs (default 3000; 0 turns printing off) |
| `PRINTER_PORTS` | Comma-separated ports the agent may print to (default 9100) |
| `PRINTER_HOSTS` | Comma-separated printer hosts the agent may print to (default: any host on an allowed port) |

The full edge PC setup is in [`docs/iot/edge-install.md`](../../docs/iot/edge-install.md).

Keep the data directory on persistent storage; it holds the queue across restarts and outages.

## Test

- `pnpm --filter @factoryos/edge-agent test`: queue, forwarder (outage and catch-up, duplicates, quarantine), settings
  and status relays, firmware checks (tampered, mis-signed, wrong size) and the server, label printing to a fake TCP
  printer (allowed ports and hosts), and the agent over an in-process MQTT broker.
- `pnpm --filter @factoryos/edge-agent simulate -- --tenant azeonics --plant NM1 --device MT1-01 --script "idle:5,running:30"`:
  publishes a tap's heartbeats to a broker.
- `API=http://localhost:4000 node scripts/check-against-api.mjs`: end to end against a running API (simulator, broker,
  agent, API).
