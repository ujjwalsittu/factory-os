# 07 · Machines & IoT Integration

## Goals (in priority order)

1. **Metering for billing**: accurate machine-hours for pay-per-use customers.
2. **Job-card truth**: actual run/idle/setup/alarm times and part counts, not operator guesses.
3. **OEE & utilisation** per machine / shift / customer.
4. **Environmental evidence**: cleanroom particle counts, T/RH; TVAC/vibration chamber logs
   attached to test reports and travelers.
5. **Condition alerts**: alarms, spindle load anomalies, maintenance counters → maintenance orders.

## Architecture

```
 Plant (Navi Mumbai)                                    Cloud
┌─────────────────────────────────────────┐        ┌───────────────────────────────┐
│ 5-axis CNC ──MTConnect / OPC UA──┐      │        │ MQTT broker (EMQX, mTLS)      │
│ LPBF printer ──OPC UA / vendor API┤      │        │   └─► iot ingest (worker)     │
│ SMT line ──vendor logs / IPC-CFX──┤      │ MQTT/  │        ├─► Timescale hypertables│
│ TVAC/vib chambers ──Modbus TCP───┤ edge  │ TLS    │        ├─► machine state machine │
│ Cleanroom sensors ──Modbus/BACnet┤ agent ├───────►│        ├─► usage records → billing│
│ Energy meters ──Modbus───────────┘(buffer)│        │        └─► alerts / maintenance  │
│ Tablets (job cards) ─────────────────────┼───────►│ API / WebSocket                 │
└─────────────────────────────────────────┘        └───────────────────────────────┘
```

- **edge-agent** (`apps/edge-agent`): Node service on an industrial PC; protocol drivers (OPC UA,
  MTConnect, Modbus TCP, file/CSV watchers for machines without APIs); normalises to
  `packages/iot-protocol` schemas; **store-and-forward** when offline; remote config from cloud.
- Topic scheme (Sparkplug-B-compatible): `factoryos/{tenant}/{plant}/{device}/{metric}`.
- **Machine state model**: `off → idle → setup → running → alarm → maintenance`, derived from tags
  (spindle speed, program running, feed hold, alarm active) with debounce rules per machine.
- Each state interval is linked to the active **job card** or **booking** → that is the metered
  usage. Gaps/mismatches flagged for supervisor review before billing.
- Machines without connectivity: retrofit kit (current transformer on spindle + ESP32/PLC) as a
  fallback **[confirm budget]**.

## Data

- Raw tags: Timescale hypertable with compression + retention (e.g. raw 90 days, 1-min rollups
  forever).
- State intervals and usage records: normal OLTP tables (they drive money).
- Environmental logs for a campaign/build are frozen into a **signed evidence bundle** attached to
  the report/traveler.

## What I need from you

The make/model/controller of each machine (e.g. DMG Mori w/ Siemens 840D, Haas, EOS M290,
SLM, Yamaha/Juki SMT, chamber PLC brand), and which already expose MTConnect/OPC UA. That decides
the first drivers.
