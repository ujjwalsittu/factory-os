# @factoryos/edge-agent

The plant edge agent (decision 063, [design](../../docs/superpowers/specs/2026-10-12-iot-metering-design.md)). It runs
on the plant's edge PC next to a local Mosquitto broker:

- subscribes to `factoryos/{tenant}/{plant}/+/state` (the machine taps' state messages, contract in
  [`@factoryos/iot-protocol`](../../packages/iot-protocol));
- writes every valid message to `queue.jsonl` in the data directory before anything else;
- posts batches to the FactoryOS API (`POST /api/iot/ingest`) with the edge key, retrying with backoff while the API
  is unreachable;
- removes events the API accepted or already had, and moves refused ones to `quarantine.jsonl` with the reason.

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

Keep the data directory on persistent storage; it holds the queue across restarts and outages.

## Test

- `pnpm --filter @factoryos/edge-agent test`: queue, forwarder (outage and catch-up, duplicates, quarantine) and the
  agent over an in-process MQTT broker.
- `pnpm --filter @factoryos/edge-agent simulate -- --tenant azeonics --plant NM1 --device MT1-01 --script "idle:5,running:30"`:
  publishes a tap's heartbeats to a broker.
- `API=http://localhost:4000 node scripts/check-against-api.mjs`: end to end against a running API (simulator, broker,
  agent, API).
