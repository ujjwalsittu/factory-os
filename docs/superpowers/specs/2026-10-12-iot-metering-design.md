# IoT pilot and machine-hour metering (decision 063)

The first Phase 5 slice. It closes open question B20, and builds on [07 · IoT](../../07-iot.md),
[11 · IoT machine plan](../../11-iot-machine-plan.md) (rollout step 1) and MaaS bookings (decision 055).

User choices, 2026-10-12:

1. **B20, pilot hardware approved:** the full pilot.
   - About 10 MT-1 machine taps: ESP32, a clamp-on current sensor and stack-light inputs.
   - 1 edge PC.
   - 2 scale bridges.
2. **B20, board marking:**
   - SMT boards get **printed 2D labels**: a Zebra-class printer with high-temperature polyimide labels that survive
     reflow;
   - FactoryOS prints serials as ZPL;
   - there is no laser marker. This matters from rollout step 2 (SMT traceability), not in this slice.
3. **First slice:** **machine-hour metering**. Taps report machine states, FactoryOS shows each machine's live state,
   and booking usage comes from the meter.
4. **Transport:**
   - MQTT stays **inside the plant**: the taps talk to Mosquitto on the edge PC;
   - the edge agent sends state changes to the FactoryOS API over **HTTPS** with its own credential, buffering while
     offline;
   - there is no cloud broker. This replaces the EMQX box in doc 07 for now.
5. **Billable time:** **occupied time**, meaning everything between booking start and stop except off and maintenance
   (running, setup, idle and alarm). It matches today's timer.
6. **Review:**
   - When a booking stops on a metered machine, the metered minutes become its usage, provided they are within **10%**
     of the timer and the meter covered the whole booking.
   - Otherwise a **supervisor confirms or corrects** them with a reason before the booking can be billed.
7. **Scope:**
   - cloud side: devices, ingest, states and metering;
   - the edge agent (local MQTT to HTTPS, with an offline buffer);
   - a tap simulator.
   - ESP32 firmware is the next slice, once the boards arrive.

## Data model (migration `0045_iot_metering`)

- **`iot_edge`** (entity):
  - one per plant edge PC: `code`, `name`, `status` (active or revoked);
  - its **credential**:
    - a random 32-byte key shown once at creation or rotation;
    - stored only as a SHA-256 hash with a short prefix to identify it;
    - `rotated_at` and `last_seen_at`.
- **`iot_device`** (entity):
  - one per tap: `code` (unique per entity, the MQTT device id), `name`, `kind` (`machine_tap` for now) and `edge_id`;
  - `machine_id`: the machine it meters. At most one active tap per machine;
  - `heartbeat_seconds` (default 60), `status` (active or retired), `last_seen_at` and `last_state`.
- **`machine_state_event`** (append-only):
  - `device_id`, `machine_id`, `seq` (the device's own counter; unique per device, so a resent batch is ignored),
    `state` (`off`, `idle`, `setup`, `running`, `alarm` or `maintenance`), `at`, and `received_at`;
  - a heartbeat repeats the current state. The pilot is ~10 taps × 1 event a minute, about 15,000 rows a day, fine in
    PostgreSQL. TimescaleDB stays a later choice (decision 001) for raw tags.
- **`maas_usage.source`** gains `meter`.
- **`maas_booking`** gains:
  - `meter_status`: none, applied or review;
  - `metered_minutes` and `timer_minutes` (captured at stop);
  - `meter_reviewed_by`, `meter_reviewed_at` and `meter_review_note`.

## Behaviour

- **Ingest:**
  - `POST /iot/ingest` is device-authenticated, outside user sessions, with `Authorization: Bearer <edge key>`;
  - it takes up to 1,000 events, each `{device, seq, state, at}`;
  - the key decides the entity; devices must belong to that edge and be active;
  - events more than 5 minutes in the future, or older than 30 days, are refused one by one, and the response counts
    accepted, duplicate and refused;
  - it updates the device's and the edge's `last_seen_at` and the device's `last_state`;
  - it is rate-limited per edge.
- **Machine state over time:**
  - each event starts an interval that lasts until the machine's next event;
  - a gap longer than **3 × the heartbeat** is **unknown**, after one heartbeat's grace.
- **Occupied minutes** for a window:
  - the minutes in states other than off and maintenance;
  - **covered** when no unknown time falls inside the window.
- **Booking stop**, on a machine with an active tap:
  - the timer minutes are recorded as today, as a `timer` usage row;
  - the metered occupied minutes over [started, stopped] are computed;
  - **if covered and within 10% of the timer:** a `meter` usage row adds the difference (metered − timer), so the
    usage total equals the metered minutes. `meter_status = applied`;
  - **otherwise:** `meter_status = review`, and billing the booking (alone or in a billing run) is refused with "Usage
    needs review".
  - Machines without a tap behave exactly as today.
- **Review** (`services.usage.approve`), on the booking page:
  - it shows the timer, the metered minutes (recomputed now, so late buffered data counts), coverage and a state
    strip;
  - the supervisor chooses **metered**, **timer** or a **corrected** number, with a note;
  - the difference is recorded as one usage row (source `meter` or `manual`) and `meter_status = applied`.
- **Edge credential:**
  - created, rotated and revoked with `plant.device.manage`;
  - rotating invalidates the old key at once;
  - every change is audited without the key.
- **Live state:** Plant → Machines (the existing Phase 5 placeholder) shows each machine's state, its tap, the time
  since the last event (stale after 3 heartbeats) and today's occupied hours. The machine page shows today's state
  strip.

## Edge agent (`apps/edge-agent`) and simulator

- **Edge agent**, a Node service on the edge PC:
  - subscribes to `factoryos/{plant}/{device}/state` on the local Mosquitto;
  - appends each message to a local file queue;
  - posts batches to `/iot/ingest`, with retry and backoff, and removes only what the API acknowledged, so data
    survives a restart or an internet outage;
  - configured by environment variables: the API URL, the key and the plant;
  - runs in Docker next to Mosquitto.
- **Tap simulator** (`apps/edge-agent/scripts/simulate-tap.mjs`): publishes MT-1-shaped messages (state, sequence,
  heartbeat) for named devices, with scripted runs, idle spells and dropouts.
- **Tests:**
  - an in-process MQTT broker in the edge agent's tests: queueing, restart recovery and an outage then catch-up;
  - a smoke against the API.
- **New dependencies**, all in the edge agent only:
  - `mqtt` (client);
  - `aedes` (an in-process broker, tests only).

## Permissions and roles

- New:
  - `plant.device.read|create|update|manage` (manage covers credentials);
  - `plant.machine_state.read`;
  - `services.usage.approve` (metered usage review).
- **Administrator** and **Owner** get all of them.
- **Production planner** reads devices and machine states.
- **Services coordinator** reads machine states and gets `services.usage.approve`.
- **Operator** reads machine states.

## Screens

- **Plant → Devices:**
  - edge agents (with Show key once, Rotate and Revoke);
  - taps (code, name, machine, heartbeat, last seen, last state, and retire).
- **Plant → Machines:** the live state grid and the machine page with today's state strip.
- **Booking page:**
  - the metered minutes and coverage next to the timer;
  - "Usage needs review" with the review dialog;
  - the state strip for the booking window.
- **Bookings list and billing-run preview:** bookings waiting for review are flagged and not billable.

## Not in this slice

- ESP32 MT-1 firmware (next slice, once the boards arrive).
- Job card metering ("job-card truth"), OEE, alerts and maintenance counters.
- Controller drivers (MTConnect and OPC UA), the SMT line over CFX, scales and label printing.
- TimescaleDB and raw tag storage.

## Tasks

1. Claim in STATUS, this design and decision 063, and close B20 in the open questions (docs-only PR).
2. Migration `0045_iot_metering`, permissions and roles.
3. API:
   - edges, devices and credentials;
   - ingest;
   - the state timeline;
   - booking stop metering and review, and the billing guard;
   - smoke `smoke-iot-metering.mjs`.
4. Edge agent and tap simulator, with tests.
5. Web:
   - Plant → Devices and Machines;
   - booking metering and review;
   - e2e `iot-metering.mjs` (desktop and 390 px).
6. Regression and wrap-up:
   - MaaS, memberships, billing runs and scheduling smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
