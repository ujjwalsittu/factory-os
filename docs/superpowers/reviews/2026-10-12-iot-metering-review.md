# IoT pilot and machine-hour metering — review and evidence (decision 063)

[Design](../specs/2026-10-12-iot-metering-design.md). Migration `0045_iot_metering`.

## What changed

- **DB:**
  - `iot_edge`: a plant edge PC, with its key stored only as a SHA-256 hash and a prefix;
  - `iot_device`: a machine tap on an edge, at most one active per machine;
  - `machine_state_event`: append-only by trigger, and unique per `(device, seq)`;
  - booking metering columns, and usage source `meter`;
  - permissions `plant.device.read|create|update|manage` and `plant.machine_state.read`, and `approve` on
    `services.usage`.
  - Roles:
    - Administrators get the plant permissions;
    - planners read devices and states;
    - operators read states;
    - the Services coordinator reviews metered usage.
- **Core** (`metering.ts`, with unit tests):
  - turns state events into segments, with gaps longer than 3 heartbeats shown as unknown after one heartbeat's grace;
  - computes occupied minutes, which exclude off and maintenance;
  - applies the 10% rule.
- **API:**
  - Plant: edges (create returns the key once; rotate; revoke), taps (create, update, retire), the live machine grid
    and the machine timeline;
  - `POST /iot/ingest`:
    - authenticated by the edge key, outside user sessions;
    - up to 1,000 events, with a result for each one: accepted, duplicate, or refused with a reason;
    - rate-limited per edge;
  - **booking stop** on a metered machine:
    - a `meter` usage row brings the total to the occupied minutes when the meter covered the booking and is within
      10% of the timer;
    - otherwise the booking waits for review;
  - **review** (`services.usage.approve`): metered (recomputed), timer, or a corrected figure, with a note;
  - while a booking waits for review, billing it (alone or in a billing run) and manual usage are refused.
- **iot-protocol:** the topic `factoryos/{tenant}/{plant}/{device}/state` and the `{seq, state, at}` message, with
  validation and tests.
- **Edge agent** (`apps/edge-agent`):
  - subscribes to the plant topics and writes every message to a file queue first;
  - forwards it with backoff;
  - removes accepted and duplicate events, and quarantines refused ones or malformed batches.
  - Also the tap simulator, and a check against a running API.
- **Web:**
  - Plant → Devices, Plant → Machines and the machine page;
  - the booking page's Meter card, with its state strip and review dialog;
  - a review flag in the bookings list.

## Review

One adversarial pass over the diff, plus CodeRabbit's two findings on the design, fixed before building: a result for
each event, and the canonical MQTT topic. Fixed while building:

- **Fixed:** the end-to-end check ran the simulator with a blocking call, which froze the in-process broker. It now
  runs as an async child process.
- **Checked:**
  - The key is never listed or logged; audit rows hold only its prefix.
  - After rotation the old key gets 401 at once, and a revoked edge stays revoked.
  - Another tenant's key can't post to our taps ("Unknown device"), and sees no edges.
  - A resent event is a duplicate, and the database refuses any edit or delete of state events.
  - Machines without a tap stop as before: the MaaS, memberships, billing runs, campaigns, projects and scheduling
    smokes are unchanged.
- **Noticed, not changed:**
  - Ingest inserts one event at a time, which is fine for ~10 taps at a heartbeat a minute; batch it when the pilot
    grows.
  - The rate limit is held in memory, per API instance. That is enough for one instance on dev.
  - Metering trusts the taps' timestamps, so the edge PC and the taps must keep NTP time. The firmware slice should
    set the clock from the edge.
  - State events keep their tenant without cascade, like machine usage, so deleting a tenant with metering history
    needs a deliberate clean-up.
  - A tap retired during a booking still meters the part of the booking before its retirement, so the rest shows as a
    gap and goes to review.

## Evidence

| Check | Result |
|---|---|
| `smoke-iot-metering.mjs` (new) | 72 request checks PASS |
| `e2e:iot-metering` (new, desktop + 390 px) | PASS |
| core `metering.test.ts` / iot-protocol / edge agent (queue, outage and catch-up, MQTT) | 7 / 2 / 4 tests PASS |
| `apps/edge-agent/scripts/check-against-api.mjs` (simulator → MQTT → agent → API) | PASS |
| State-event trigger: update and delete in psql | refused |
| `smoke-maas` / memberships / billing runs / campaigns / projects / scheduling | 93 / 76 / 81 / 74 / 141 / 58 PASS |
| `e2e:maas` / `e2e:billing-runs` / `e2e:scheduling` | PASS |
| `pnpm typecheck` / `pnpm build` / `turbo run test --force` | 20 / 12 / 14 tasks PASS |
| `pnpm lint` | 0 configured tasks |
| `git diff --check`, drizzle drift | clean, none |
