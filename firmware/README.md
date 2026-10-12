# MT-1 machine tap firmware

Decision 064 ([design](../docs/superpowers/specs/2026-10-12-tap-firmware-design.md)). The MT-1 is an ESP32-S3 with a
clamp-on current transformer and three opto-isolated stack-light inputs. It reports its machine's state to the plant's
edge PC over MQTT with TLS. The edge agent ([`apps/edge-agent`](../apps/edge-agent)) forwards the reports to FactoryOS.

| Path | What |
|---|---|
| `mt1/lib/tapcore` | The logic, without hardware, host-tested: classifier and debounce, sequence numbers, the outbox, messages, settings, signed-update checks |
| `mt1/lib/monocypher` | [Monocypher](https://monocypher.org) 4.0.2, vendored (CC0 / BSD-2), for Ed25519 |
| `mt1/src/main.cpp` | The hardware side: CT sampling, light inputs, Wi-Fi, SNTP, MQTT over TLS, LittleFS outbox, OTA with rollback |
| `mt1/test` | Unity tests run on the host (`pio test -e native`) |
| `scripts/check.sh` | Host tests, the ESP32-S3 build, and a signed build checked like the edge agent checks it |
| `scripts/sign.mjs` | Signing keys and builds |
| `provision/` | Plant CA, issuing and revoking tap certificates, flashing a tap (run on the edge PC) |

## Build and test

You need [PlatformIO](https://platformio.org) (`pip install platformio`) and Node 22.

```sh
pnpm --filter @factoryos/edge-agent build   # once, for the last step of the check
firmware/scripts/check.sh
```

Environments in `mt1/platformio.ini`:

- `native`: the host tests.
- `esp32s3-dev` (default): version `x.y.z-dev`. It trusts only the public development key.
- `esp32s3-release`: version `x.y.z`. It trusts the release key, passed at build time:

  ```sh
  MT1_RELEASE_PUBKEY=<public key> pio run -e esp32s3-release
  ```

  Without the key it does not compile.

The version is `fw_version` under `[common]`. Raise it for every build you ship: taps only install a newer version.

## What the tap does

- **Sensing.** Once a second it takes the RMS current over ten 50 Hz cycles and reads the stack lights, then classifies
  the state:
  - `off` below the off threshold;
  - `alarm` while a light meaning alarm is lit;
  - `running` at or above the run threshold, or while a light meaning running is lit;
  - `setup` while a light meaning setup is lit;
  - otherwise `idle`.

  A new state must hold for the debounce time before it counts.
- **Reporting.**
  - It records each state change at once, and the current state every heartbeat. The `{seq, state, at}` message on
    `…/{device}/state` is unchanged from decision 063.
  - Nothing is recorded until SNTP (from the edge PC) has set the clock.
  - Sequence numbers come from flash in blocks of 1,000, so a reboot never reuses one.
  - Events wait in a 10,000-event outbox on LittleFS until the broker acknowledges them (QoS 1).
  - When the outbox is full, the oldest heartbeat goes first; the oldest state change goes only when no heartbeat is
    left.
- **Status.** Retained on `…/{device}/status`, on every change and every 5 minutes. It carries:
  - the firmware version and the settings version applied;
  - uptime, Wi-Fi RSSI and outbox depth;
  - the last error.
- **Settings.**
  - It applies the retained `…/{device}/config` from Plant → Devices and keeps it in flash, so it runs the same
    settings offline.
  - A message that fails validation is ignored and reported as the last error.
- **Updates.**
  - When `…/ota` announces a build, the tap checks:
    - the Ed25519 signature against its built-in key;
    - that the version is newer;
    - that the build is the same kind as its own: a development build takes only `-dev` versions, and a release build
      takes none.
  - It then downloads the build from the edge over HTTPS, trusting the plant CA, and checks the SHA-256 before
    switching partitions.
  - The new image confirms itself once it reaches the broker. If it doesn't within 5 minutes, or crashes first, the
    bootloader goes back to the previous image.
  - A version that failed to install is not retried until the next boot.

## Signing keys

```sh
node firmware/scripts/sign.mjs keygen     # once: the release key
```

- **Release key.** Azeonics creates it and keeps the private half **offline, with a backup**; it is never in the
  repository or CI.
  - The public half is `MT1_RELEASE_PUBKEY` for release builds, and `OTA_PUBLIC_KEY` for the edge agent.
  - Losing the private key means no further updates over the air: taps would have to be reflashed by USB.
- **Signing a release:**

  ```sh
  MT1_SIGNING_KEY=<private> node firmware/scripts/sign.mjs sign mt1/.pio/build/esp32s3-release/firmware.bin --version 1.0.0 --out <dir>
  ```

  Then copy `mt1-1.0.0.bin` and its `.manifest.json` into the edge agent's `FIRMWARE_DIR`. The edge checks them, serves
  them and announces them.
- **Development key.** It is derived from a public string in `sign.mjs` (`--dev`) and is public on purpose.
  - It signs `-dev` builds only and cannot sign a release.
  - Release firmware never trusts it.

## Pins (board rev A)

| GPIO | Use |
|---|---|
| 1 (ADC1 ch 0) | CT burden voltage, biased at mid-supply |
| 4, 5, 6 | Red, amber and green light inputs. The opto output pulls low when the light is lit |

The CT calibration (amps per volt of burden) is a per-tap setting in Plant → Devices. Set it when the tap is
calibrated on its machine.
