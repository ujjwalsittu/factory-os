# MT-1 tap firmware, provisioning and OTA — review and evidence (decision 064)

[Design](../specs/2026-10-12-tap-firmware-design.md). Migration `0046_tap_config`.

## What changed

- **DB:** `iot_device` gains:
  - `config` (JSON, defaulting to off 0.5 A, run 3 A, CT 30 A/V, debounce 5 s, red alarm, amber idle, green running)
    and `config_version`;
  - what the tap reports: `fw_version`, `applied_config_version`, `rssi`, `outbox`, `last_error` and `status_at`.
- **API:**
  - `PUT /plant/devices/:id/config` (`plant.device.update`, audited) validates the ranges, requires off below run,
    restricts the meaning of each light, and raises the version. A new heartbeat also raises it; a rename does not.
  - `GET /iot/config` and `POST /iot/status` are authenticated by the edge key like ingest:
    - config lists only the edge's active taps;
    - status gives a result per tap, refusing a retired, unknown or other edge's tap and a future timestamp.
- **iot-protocol:** the config, status and OTA message types; the `config`, `status` and `ota` topics; the signing
  payload `factoryos-mt1|{version}|{size}|{sha256}`; and a firmware version order (`-dev` sorts before the release),
  all with tests.
- **Web, Plant → Devices:**
  - a Settings dialog: thresholds, CT calibration, debounce, heartbeat and the meaning of each light;
  - a Tap status column: "Config vN applied" or "vN pending (runs vM)", the firmware, signal in words and dBm, queued
    events, when, and the last error.
- **Edge agent:**
  - `ConfigSync` publishes each changed config retained and clears the config of a tap that left;
  - `StatusRelay` forwards the latest retained status per tap, keeps it through an outage, and drops refused or
    invalid reports;
  - `OtaServer` checks every build in `FIRMWARE_DIR` (size, SHA-256, Ed25519) and serves only the newest valid one
    over HTTPS. It also announces the manifest retained, and withdraws it when no valid build is left;
  - optional TLS to Mosquitto with the agent's own certificate.
- **Firmware** (`firmware/mt1`, PlatformIO, Arduino core 2.0.17 / IDF 4.4):
  - `lib/tapcore`, without hardware and host-tested:
    - classifier and debounce;
    - flash-backed sequence numbers, reserved in blocks of 1,000;
    - a 10,000-event outbox that drops the oldest heartbeat first;
    - state and status messages, and config validation (the same limits as the API);
    - manifest parsing, the Ed25519 check (Monocypher 4.0.2, vendored and checked against the upstream tag), the
      version rule, and the rule that each kind of build takes only its own kind (dev or release).
  - `src/main.cpp`:
    - sensing: the RMS of the CT over 10 cycles every second, and the light inputs;
    - network: Wi-Fi; SNTP, with nothing recorded before the clock is set; esp-mqtt over TLS with the tap's
      certificate; QoS 1, one event in flight, acknowledged before it leaves the outbox;
    - settings: the retained config is applied and saved;
    - updates: OTA by HTTPS from the edge with the SHA-256 checked while writing, and rollback when the new image
      doesn't reach the broker within 5 minutes.
  - Builds: `esp32s3-dev` trusts the public development key; `esp32s3-release` doesn't compile without
    `MT1_RELEASE_PUBKEY`.
  - `scripts/sign.mjs` handles keys and signing, and refuses to sign a release with the development key.
    `scripts/check.sh` runs the host tests and the ESP32-S3 build, then has the real image signed and accepted by the
    edge agent's check.
- **Provisioning** (`firmware/provision`):
  - `plant-ca.sh` creates the plant CA (P-256), the broker and firmware server certificate, the agent's client
    certificate, `mosquitto.conf`, a 10-year CRL, and an ACL generated from the CA index;
  - `issue-tap.sh` issues a tap's certificate (5 years), adds it to the ACL, and writes its NVS image (CSV through
    Python's csv module; the first sequence number is the time in ms, so a reissued tap never repeats a number). It
    can flash the image with esptool, then deletes the key and image. A second certificate needs `--reissue`;
  - `revoke-tap.sh` puts the certificate on the CRL, removes the tap from the ACL and restarts the broker.
- **Docs:**
  - [`docs/iot/edge-install.md`](../../iot/edge-install.md): Ubuntu, Mosquitto in Docker, chrony, the agent under
    systemd with a hardened unit, the firewall, provisioning and calibration, revocation, updates, troubleshooting;
  - `firmware/README.md`;
  - the edge agent README.

## Evidence

| Check | Result |
|---|---|
| `smoke-tap-config.mjs` (new) | 37 request checks |
| `smoke-iot-metering.mjs` (regression) | 72 request checks |
| `e2e/iot-metering.mjs`, extended with tap settings and status | Desktop and 390 px. Settings saved; "v2 pending (runs v1)" then "Config v2 applied", "signal good (-58 dBm) · 3 queued" |
| `iot-protocol` tests | 5 |
| Edge agent tests | 11, 7 of them new: config publish and clear, status relay through an outage, firmware checks (tampered, wrong size, wrong key, signature over another version), serving only the announced build, and the agent over an in-process broker |
| Edge agent `check-against-api.mjs` against the running API | Simulator → MQTT → agent → API, then settings v2 reaching the tap retained and its status reaching Devices |
| Firmware host tests (`pio test -e native`) | 12 cases |
| ESP32-S3 builds | Dev: RAM 16%, flash 29% of the OTA slot. Release: refused without the key, builds with one |
| `firmware/scripts/check.sh` | Host tests, the build, and the real image signed with `sign.mjs` and accepted by the edge agent |
| `firmware/provision/test/check.sh` against `eclipse-mosquitto:2.0.20` | See below |
| Root checks | Typecheck 20, build 12, tests 14 |

The provisioning check covered:

- no client certificate: refused;
- a tap can publish its own state, but not another tap's state or its own config;
- a tap reads only its own config and the plant's `ota`;
- revoked: refused, and the other tap carries on;
- `--reissue` works;
- the NVS image is 0x5000 bytes;
- a comma and a quote in the Wi-Fi password are quoted correctly;
- the PKI directory is mode 700.

## Self-review

Fixed during the build:

- **Heartbeat version.** A heartbeat change didn't raise the config version, so a tap would never get the new
  heartbeat. Fixed in `PUT /plant/devices/:id`, with a smoke check.
- **`issue-tap.sh` failed.** The OpenSSL config referenced `${ENV::SAN}`, which only exists while `plant-ca.sh` runs.
  The server SAN moved to its own extensions file.
- **Settings not reaching the NVS image.** `provision.env` values weren't exported to the Python step. The file is now
  sourced with `set -a`.
- **A test expectation.** A debounce test expectation was wrong: a flicker to a third state correctly restarts the
  clock.

Limits and follow-ups (not blocking the pilot):

1. **No hardware yet.** Nothing has run on hardware:
   - ADC sampling, light polarity, TLS to Mosquitto from the ESP32, and OTA with rollback are compiled but unproven
     on the board;
   - first-board checklist: provisioning, a TLS connection, a state change, a config round trip, a dev OTA, and a
     forced rollback (a build that never connects).
2. **Development key.** Pilot boards on `esp32s3-dev` trust the public development key. Anyone who can publish on the
   plant's `ota` topic could offer a dev build signed with it. Only the edge agent may write that topic (ACL), and only
   from the edge PC. Move taps to release firmware before production.
3. **Tap keys in plain flash.** NVS is not encrypted, so a stolen tap gives up its key. Revocation is the answer. NVS
   encryption with flash encryption is a later hardening step: it needs eFuses burned per board.
4. **OTA blocks sensing.** The download runs in the main loop, so sensing pauses while it runs (about a minute for a
   1 MB image). States around an update can be late by that much.
5. **Retained configs after a restart.** A tap retired while the edge agent was down keeps its retained config on the
   broker: the agent only clears configs it published itself since it started. This is harmless, since a retired tap
   is refused at ingest and in the ACL once revoked.
6. **Double version bump.** Saving settings and a new heartbeat together raises the version twice (two requests). This
   is cosmetic.
7. **Mosquitto subscriptions.** Mosquitto 2 grants a subscription the ACL denies, and then filters what it delivers.
   The test checks what is delivered, not the SUBACK codes.
