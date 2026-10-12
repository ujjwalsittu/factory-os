# MT-1 tap firmware, provisioning and OTA (decision 064)

The second IoT slice, after machine-hour metering (decision 063). It builds the self-built **MT-1 machine tap** of
[11 · IoT machine plan](../../11-iot-machine-plan.md) §3 (ESP32-S3, a clamp-on current sensor and opto-isolated
stack-light inputs) so the pilot boards can meter real machines the day they arrive.

User choices, 2026-10-12:

1. **Next slice:** the tap firmware now. The pilot boards are on order, and on-board testing happens when they arrive.
2. **Tap authentication:**
   - TLS to the plant's Mosquitto, with a **client certificate per tap** issued by a small **plant CA** on the edge PC;
   - Mosquitto limits each tap to its own topics;
   - a lost tap's certificate is revoked on its own.
3. **Configuration from FactoryOS:**
   - thresholds, stack-light meanings and the heartbeat are set on the tap in Plant → Devices;
   - the edge agent fetches them and publishes them as a retained config message;
   - the tap applies them and reports which version it runs.
4. **Updates:**
   - **signed OTA through the edge**: we sign each build;
   - the edge agent serves it on the plant network;
   - taps verify the signature before installing, and roll back automatically if the new image doesn't come up.
5. **Scope:**
   - the firmware, with its logic unit-tested on the host and the ESP32 build compiled;
   - provisioning scripts;
   - the edge PC install guide.

## Firmware (`firmware/mt1`, PlatformIO, Arduino core on ESP32-S3)

- **`lib/tapcore`**: plain C++ with no hardware dependency, unit-tested on the host (PlatformIO `native` + Unity). It
  holds:
  - **Classifier:**
    - RMS current from the CT and the three stack-light inputs give a state;
    - `off` below the off threshold;
    - `alarm` while the light mapped to alarm is lit;
    - `running` at or above the run threshold (or a light mapped to running);
    - `setup` while a light mapped to setup is lit;
    - otherwise `idle`;
    - a state must hold for the **debounce** time (default 5 s) before it changes.
  - **Sequence:**
    - an increasing counter kept in flash (NVS);
    - it reserves blocks of 1,000, so a reboot never reuses a number and flash is written rarely.
  - **Outbox:**
    - events wait in a ring on flash (LittleFS) until the broker acknowledges them (QoS 1);
    - about 10,000 events (a week at one a minute);
    - when full, the oldest heartbeats are dropped first, and state changes are kept.
  - **Config:** parses and validates the retained config message: version, thresholds, light mapping, heartbeat and
    debounce. A bad message is ignored and reported.
  - **Update check:** verifies an OTA manifest (version, size, SHA-256) with an **Ed25519** signature against the
    public key built into the firmware ([Monocypher](https://monocypher.org), vendored, CC0/BSD-2).
- **`src/`**, the hardware side:
  - ADC sampling of the CT burden: 1 kHz over whole 50 Hz cycles, giving RMS amps by a calibration factor;
  - GPIO inputs for the lights;
  - Wi-Fi;
  - **SNTP from the edge PC**: nothing is published until the clock is set;
  - MQTT over TLS with the tap's certificate;
  - LittleFS for the outbox;
  - OTA download from the edge over HTTPS into the spare partition. The new image marks itself valid only after it
    reconnects to the broker, otherwise the bootloader rolls back.
- **Topics**, with the contract in `packages/iot-protocol`:
  - publishes `…/{device}/state` (`{seq, state, at}`, unchanged from decision 063) on each change and each heartbeat;
  - publishes `…/{device}/status`, retained (firmware version, config version, uptime, Wi-Fi RSSI, outbox depth,
    last error);
  - subscribes to `…/{device}/config` and to `…/ota`, both retained.
- **Build check:** `firmware/scripts/check.sh` runs the host tests and the ESP32-S3 build.

## Provisioning (`firmware/provision`)

All of it runs on the edge PC:

- `plant-ca.sh`: creates the plant CA (ECDSA P-256) once. The private key stays on the edge PC, readable only by root.
- `issue-tap.sh <device>`:
  - issues the tap's key and certificate (CN = device code, 5 years);
  - adds the tap to the Mosquitto ACL: write its `state` and `status`, read its `config` and the plant's `ota`;
  - builds the tap's NVS image: Wi-Fi, broker host, CA, certificate and key, tenant, plant and device codes;
  - flashes it over USB with `esptool`.
- `revoke-tap.sh <device>`: adds the certificate to the CRL and reloads Mosquitto.
- The firmware itself carries no secrets. Each tap's identity lives only in its NVS partition.

## FactoryOS and the edge agent

- **Device settings** (migration `0046_tap_config`), on `iot_device`:
  - `config` (JSON: off and run amps, CT calibration, light mapping, debounce seconds);
  - `config_version`, which goes up on every change;
  - reported by the tap: `fw_version`, `applied_config_version`, `rssi`, `outbox` and `last_error`.
- **API:**
  - `PUT /plant/devices/:id/config` (`plant.device.update`), validated, raises the version;
  - `GET /iot/config` (edge key): the configs of the edge's active taps;
  - `POST /iot/status` (edge key): taps' status reports.
- **Edge agent:**
  - fetches the configs every minute and publishes changes as retained `config` messages;
  - forwards `status` messages;
  - serves signed firmware files from `FIRMWARE_DIR` over HTTPS on the plant network, and publishes the latest valid
    manifest as retained `ota`.
  - It checks the signature itself before announcing anything.
- **Web, Plant → Devices:**
  - the tap's settings (thresholds, lights, heartbeat and debounce);
  - "config v3 applied" or "pending";
  - firmware version, signal, outbox depth and last error.

## Signing key

- `firmware/scripts/sign.mjs` signs a build (manifest plus Ed25519 signature) with a private key from an environment
  variable or file. The key is **never in the repository**.
- The **release key** is created and kept by Azeonics: offline, plus a backup. Its public key is compiled into the
  firmware.
- A **test key** generated by the tests signs throwaway builds. Firmware built with it is labelled `-dev` and
  refuses release manifests.

## Edge PC install guide (`docs/iot/edge-install.md`)

- Ubuntu LTS on the fanless PC.
- Docker running **Mosquitto**:
  - TLS on 8883, requiring client certificates;
  - the CRL and the ACL file;
  - no anonymous access.
- **chrony** serving NTP to the plant network.
- The edge agent as a **systemd** service:
  - data directory on disk;
  - environment file holding the key, readable only by its user.
- Firewall: only 8883 (MQTT), 123 (NTP) and the OTA port, and only from the tap network.
- Provisioning a tap step by step, and checking it in Plant → Devices and Plant → Machines.

## Not in this slice

- On-board tests and the CT calibration on real machines (when the boards arrive).
- The environment node (EN-1) and the scale bridge (SB-1).
- Accelerometer and vibration analysis.
- Fleet-wide staged OTA rollouts: all taps of a plant take the announced version.

## Tasks

1. Claim in STATUS, this design and decision 064 to main (docs-only PR).
2. Migration `0046_tap_config`:
   - the device config and status API, and the edge config and status endpoints;
   - the Plant → Devices settings;
   - smoke `smoke-tap-config.mjs`.
3. Edge agent:
   - config publishing, status forwarding, and the OTA server and announcement;
   - the topics added to `iot-protocol`;
   - tests.
4. Firmware:
   - `tapcore` with host tests, and the ESP32-S3 app;
   - the build check, and the signing script with a test key.
5. Provisioning scripts and the edge install guide. The scripts are checked against a local Mosquitto in Docker if
   available, otherwise with openssl only.
6. Regression and wrap-up:
   - metering smokes and browsers;
   - root checks;
   - review, STATUS/LOG and the PR.
