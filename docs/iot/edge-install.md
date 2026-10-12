# Edge PC install guide (decision 064)

One fanless PC per plant runs the plant's side of the IoT pilot:

- **Mosquitto**, the MQTT broker the machine taps report to. It accepts TLS with a client certificate per tap, and
  nothing anonymous.
- **chrony**, the plant's time server. Taps don't record anything until their clock is set from it.
- **The edge agent** ([`apps/edge-agent`](../../apps/edge-agent)), which:
  - forwards the taps' states to FactoryOS;
  - publishes their settings;
  - relays their status;
  - serves signed firmware updates.
- **The plant CA** ([`firmware/provision`](../../firmware/provision)), which issues and revokes the taps' certificates.

Background: [design](../superpowers/specs/2026-10-12-tap-firmware-design.md),
[IoT machine plan](../11-iot-machine-plan.md), [firmware](../../firmware/README.md).

Throughout, the example plant is `NM1`, the edge PC is `edge-nm1.plant` at `10.20.0.2`, and the taps' network is
`10.20.0.0/24`.

## 1. Before you start

- **FactoryOS:**
  - In Plant → Devices, **add an edge** with the plant code (`NM1`), and copy its key: it is shown once.
  - Add a **tap** for each machine. The tap code (e.g. `MT1-01`) is its identity everywhere.
- **Network:**
  - A Wi-Fi network for the taps. A separate SSID or VLAN is best, with the edge PC reachable from it.
  - A DNS name (or a hosts entry on the taps' DHCP/DNS server) for the edge PC: `edge-nm1.plant`. The taps reach it by
    this name, and it is in the edge's certificate.
- **The FactoryOS workspace slug** (Settings → Workspace), e.g. `azeonics`.

## 2. Operating system

Ubuntu Server 24.04 LTS, with a static address on the plant network. Then:

```sh
sudo apt update && sudo apt install -y docker.io chrony ufw python3-venv openssl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo python3 -m venv /opt/esp-tools
sudo /opt/esp-tools/bin/pip install esptool esp-idf-nvs-partition-gen
echo 'export PATH=/opt/esp-tools/bin:$PATH' | sudo tee /etc/profile.d/esp-tools.sh
```

Enable automatic security updates (`sudo dpkg-reconfigure unattended-upgrades`) and keep SSH on keys only.

## 3. Settings and the plant CA

Get the provisioning scripts onto the PC: clone the repository, or copy `firmware/provision` to `/opt/factoryos/provision`.

`/etc/factoryos-edge/provision.env` is read as a shell file, so quote values with spaces or symbols. It holds the Wi-Fi
password, so only root may read it:

```sh
sudo mkdir -p /etc/factoryos-edge && sudo chmod 700 /etc/factoryos-edge
sudo tee /etc/factoryos-edge/provision.env >/dev/null <<'ENV'
TENANT=azeonics
PLANT=NM1
EDGE_HOST=edge-nm1.plant
EDGE_IP=10.20.0.2
WIFI_SSID='Azeonics taps'
WIFI_PASS='the tap network password'
ENV
sudo chmod 600 /etc/factoryos-edge/provision.env
sudo /opt/factoryos/provision/plant-ca.sh
```

This creates:

- `/etc/factoryos-edge/pki`: the plant CA (ECDSA P-256) and every certificate it issues. **Root only; back it up
  encrypted.** Losing it means re-provisioning every tap.
- `/etc/factoryos-edge/mosquitto`: the broker's config, certificate, CRL and ACL.
- `/etc/factoryos-edge/agent`: the edge agent's MQTT client certificate and the firmware server's certificate.

## 4. Mosquitto

```sh
sudo docker run -d --name factoryos-mosquitto --restart unless-stopped \
  -p 8883:8883 \
  -v /etc/factoryos-edge/mosquitto:/mosquitto/config \
  -v factoryos-mosquitto-data:/mosquitto/data \
  eclipse-mosquitto:2.0.20
sudo docker logs factoryos-mosquitto   # "mosquitto version 2.0.20 running"
```

The generated `mosquitto.conf` sets:

- TLS 1.2+ on 8883, a client certificate required, checked against the CRL;
- the certificate's name as the user;
- the ACL;
- no anonymous access.

The ACL allows:

- each tap to write its own `state` and `status` and read its own `config` and the plant's `ota`;
- the edge agent everything under `factoryos/azeonics/NM1/`.

The provisioning scripts reload the broker after a change (`docker kill --signal=HUP`) and restart it after a revocation.

## 5. Time server

`/etc/chrony/conf.d/plant.conf`:

```
# Serve time to the taps, and keep serving it if the internet is down.
allow 10.20.0.0/24
local stratum 10
```

`sudo systemctl restart chrony`, then check with `chronyc tracking`.

## 6. The edge agent

Build it on a development machine from the repository, then copy the result across:

```sh
pnpm install
pnpm turbo build --filter @factoryos/edge-agent...
pnpm --filter @factoryos/edge-agent deploy --legacy --prod ./factoryos-edge
rsync -a ./factoryos-edge/ edge-nm1.plant:/opt/factoryos-edge/
```

On the edge PC:

```sh
sudo useradd --system --home /var/lib/factoryos-edge --create-home factoryos-edge
sudo mkdir -p /var/lib/factoryos-edge/firmware
sudo chown -R factoryos-edge: /var/lib/factoryos-edge /etc/factoryos-edge/agent
sudo chmod 750 /etc/factoryos-edge && sudo chgrp factoryos-edge /etc/factoryos-edge
sudo tee /etc/factoryos-edge/agent/agent.env >/dev/null <<'ENV'
FACTORYOS_API_URL=https://factoryos.azeonics.com/api
FACTORYOS_EDGE_KEY=fos_edge_…
FACTORYOS_TENANT=azeonics
FACTORYOS_PLANT=NM1
FACTORYOS_DATA_DIR=/var/lib/factoryos-edge
MQTT_URL=mqtts://localhost:8883
MQTT_CA=/etc/factoryos-edge/agent/ca.crt
MQTT_CERT=/etc/factoryos-edge/agent/mqtt-client.crt
MQTT_KEY=/etc/factoryos-edge/agent/mqtt-client.key
FIRMWARE_DIR=/var/lib/factoryos-edge/firmware
OTA_PUBLIC_KEY=<the release public key>
OTA_BASE_URL=https://edge-nm1.plant:8443
OTA_PORT=8443
OTA_TLS_CERT=/etc/factoryos-edge/agent/ota-server.crt
OTA_TLS_KEY=/etc/factoryos-edge/agent/ota-server.key
ENV
sudo chown factoryos-edge: /etc/factoryos-edge/agent/agent.env && sudo chmod 600 /etc/factoryos-edge/agent/agent.env
```

Two things to check in it:

- `FACTORYOS_EDGE_KEY` is the key from Plant → Devices.
- `OTA_PUBLIC_KEY` is the public half of the release signing key (see [firmware](../../firmware/README.md#signing-keys)).
  Pilot boards running development firmware use the development key instead:
  `node firmware/scripts/sign.mjs pubkey --dev`.

`/etc/systemd/system/factoryos-edge.service`:

```ini
[Unit]
Description=FactoryOS edge agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=factoryos-edge
EnvironmentFile=/etc/factoryos-edge/agent/agent.env
WorkingDirectory=/opt/factoryos-edge
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/factoryos-edge
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now factoryos-edge
journalctl -u factoryos-edge -f   # "subscribed to factoryos/azeonics/NM1/+/state", "firmware server on port 8443"
```

The data directory holds the queue of states waiting for FactoryOS. Keep it on the local disk.

## 7. Firewall

Only the tap network reaches the plant services. Outbound HTTPS to FactoryOS stays open.

```sh
sudo ufw default deny incoming
sudo ufw allow from 10.20.0.0/24 to any port 8883 proto tcp   # MQTT over TLS
sudo ufw allow from 10.20.0.0/24 to any port 123 proto udp    # NTP
sudo ufw allow from 10.20.0.0/24 to any port 8443 proto tcp   # firmware downloads
sudo ufw allow from <admin network> to any port 22 proto tcp
sudo ufw enable
```

Docker publishes ports past ufw. To keep 8883 to the tap network, bind it to the plant address instead:
`-p 10.20.0.2:8883:8883`. The edge agent then connects with `MQTT_URL=mqtts://edge-nm1.plant:8883`, which resolves
to that address.

## 8. Provisioning a tap

Each tap must already run the MT-1 firmware. Flash it once at the bench, from the repository:

```sh
cd firmware/mt1 && pio run -e esp32s3-release -t upload
```

Use `esp32s3-dev` for pilot boards. Then, on the edge PC, with the tap on USB:

```sh
sudo /opt/factoryos/provision/issue-tap.sh MT1-01 --port /dev/ttyACM0
```

This does four things:

- issues the tap's certificate (5 years);
- adds the tap to the ACL;
- writes its identity: Wi-Fi, broker, time server, certificates, codes, and the first sequence number;
- flashes the identity into the tap's NVS partition, then deletes the tap's key and image from the PC.

The firmware carries no secrets. A tap's identity is only in its own flash.

Mount the tap on its machine:

- the CT on one phase of the machine's supply;
- the light inputs on the stack light.

Then check FactoryOS:

1. **Plant → Devices:** the tap shows a status within a minute: "Config v1 applied", its firmware, signal and outbox.
   "Not reported" means the tap hasn't reached the broker. See the troubleshooting section below.
2. Set the tap's thresholds and light meanings with **Settings**. The tap shows "v2 pending" until it has applied them,
   usually within a minute.
3. **Plant → Machines:** the machine shows its live state. Its timeline fills as it works.

Calibrate the CT once per machine:

1. Measure the running current with a clamp meter.
2. Compare it with what the tap reports.
3. Adjust "CT calibration (A per V)".

## 9. Revoking a tap

For a lost, stolen or retired tap:

```sh
sudo /opt/factoryos/provision/revoke-tap.sh MT1-01
```

- Its certificate goes on the CRL and it leaves the ACL. The broker restarts, so any open connection closes; other taps
  reconnect by themselves.
- Retire the tap in Plant → Devices as well.
- To replace a tap's identity (e.g. a reflashed board), use `issue-tap.sh MT1-01 --reissue --port …`. It revokes the
  old certificate first.

## 10. Firmware updates

1. Build and sign a release (see [firmware](../../firmware/README.md#signing-keys)).
2. Copy `mt1-<version>.bin` and its `.manifest.json` to `/var/lib/factoryos-edge/firmware`.

Within a minute the edge agent:

- checks the size, the SHA-256 and the signature;
- logs and skips anything that fails;
- serves the newest valid build and announces it to the plant's taps.

Each tap then checks the signature again and installs only a newer version of its own kind. It confirms the new image
once it is back on the broker; otherwise it rolls back. Watch the firmware version per tap in Plant → Devices.

All taps of the plant take the announced version; there are no staged rollouts yet. Test a build on one bench tap
first.

## Troubleshooting

| Symptom | Check |
|---|---|
| Tap "Not reported" | Its console at 115200 baud: Wi-Fi joined? "Not provisioned"? `docker logs factoryos-mosquitto` for a TLS or ACL refusal. Is its clock set (chrony reachable)? |
| Every tap refused at once | The CRL is out of date or missing: `openssl crl -in /etc/factoryos-edge/mosquitto/crl.pem -noout -nextupdate` |
| "v2 pending" for long | The tap's last error in Plant → Devices (e.g. `config: bad thresholds`); `journalctl -u factoryos-edge` for "config v2 published" |
| States not arriving in FactoryOS | `journalctl -u factoryos-edge`: API unreachable (the queue keeps them) or quarantined events; `/var/lib/factoryos-edge/quarantine.jsonl` |
| Firmware not offered | `journalctl -u factoryos-edge` for "firmware skipped: … Bad signature" (wrong key) or "SHA-256 differs" |
