# 11 · IoT Machine Plan (from the CAPEX Machine Register, Jul 2026)

Source: `Azeonics_CAPEX_Machine_Register.xlsx` (41 lines, 4 sections, ~80% accurate per the user).
This builds on the architecture in [07-iot.md](./07-iot.md).

> **Note on interface claims:** the interfaces below are what these machine classes normally offer.
> **Every one must be confirmed in writing by the vendor**, preferably as a PO clause (see §5).
> Most POs have not been released yet, and none of the Section D (CNC/EDM/metrology) lines have a
> vendor yet, so this is the cheapest moment to get connectivity included.

## 1. What we want from machines

| Purpose | Data needed | Used by |
|---|---|---|
| **Batch / board / part traceability** | Which serial/lot was processed, when, with which program/recipe, and the result | Genealogy, CoC packs, AS9100 audits |
| **Process logs** | Reflow profile, N₂ ppm, laser power, chamber O₂, wash conductivity, tip temperature | Evidence bundles, NCR investigation |
| **Inspection results** | SPI volumes, AOI defects, X-ray voids, ionic contamination, CMM measurements | Quality, FAI, yield |
| **Machine state & time** | Running / idle / setup / alarm, part count, program | Job cards, OEE, **MaaS billing** |
| **Material estimation & consumption** | Paste volume, component picks and drops, powder used/recovered, stock removed | MRP attrition factors, costing, buy-to-fly |
| **Environment** | Dry-cabinet RH, cleanroom T/RH/particles | MSL clocks, cleanroom compliance |

## 2. Machine-by-machine plan

### Section A — SMT line (vendor: NMTronics)

The SMT line is the best traceability case: **every board gets a 2D code (laser or label) before
the printer**, and each machine reports results against that code.

| # | Machine | Integration route | What we capture |
|---|---|---|---|
| 1 | FUJI **GPX-CII** solder paste printer | **IPC-CFX** / IPC-HERMES-9852 via FUJI line software (confirm option) | Board ID, stencil ID, paste lot, print parameters, squeegee count |
| 2 | FUJI **AIMEX IIIc** placer | IPC-CFX; FUJI Nexim-type line software for feeder/reel verification (confirm) | Board ID → component reel IDs per placement head (genealogy); pick/drop counts → **attrition factors** for MRP; feeder setup verification |
| 3 | Koh Young **KY8030-2** 3D SPI | IPC-CFX / Koh Young result export (confirm) | Per-board pass/fail, **paste volume per pad** → paste consumption estimate |
| 4 | Koh Young **Zenith Alpha HS** 3D AOI | IPC-CFX / result export | Per-board defects, false-call rate, repair loop |
| 5 | Heller **1826 MK7-N2** reflow | IPC-CFX / Heller oven software export (confirm) | Recipe, zone temperatures, conveyor speed, **N₂ ppm** per board passage |
| 6–8, 10–11 | NMTA loader/unloader/conveyors (SMEMA) | No data needed; IPC-HERMES between machines handles board ID handover | — |
| 9 | Thinky **SR 500** paste mixer | Likely no interface → **self-built node** (§3, power-current tap) + scan paste jar QR at mixer tablet | Mix start/stop, paste jar lot, thaw-to-use time |

**Line-level outcome:** a board serial page showing paste lot, every reel used, print/SPI/AOI
results, reflow profile and any rework, all automatically.

### Section B — Test, inspection, rework & cleaning (vendor: iNETest)

| # | Machine | Integration route | What we capture |
|---|---|---|---|
| 13–14 | YXLON **Cougar** X-ray + 3D microslice | Result/report files to a watched folder (edge agent file driver); check for MES interface option | Board ID, void %, BGA results, images linked to serial |
| 15–18 | JBC **RMSE-2QJ** rework, **LC-2BIA** stations | JBC station network connectivity (confirm model support) else self-built node | Tip temperature traceability per rework, operator, board ID scanned at bench |
| 19 | Aurotek **AUO3000E** depaneling router | PLC/controller signals → self-built node or Modbus (confirm) | Panel ID → board serials split, spindle hours |
| 20 | SCS **Ionograph SMDV** ionic contamination | Result files / report export | Per-lot cleanliness (µg/cm² NaCl eq.) → attached to CoC |
| 21 | PBT **SuperSwash III** cleaner | Process data export/PLC (confirm) | Program, wash temperature, rinse resistivity per batch |
| 22 | ACE Dragon **XC 1200-6G** dry cabinet | Built-in logger if networked; else **self-built RH/T node** | RH and T time series → **MSL floor-life clocks pause** while parts are inside |
| 23–25 | Seamark alternatives | Not selected | — |
| 26 | SPEA flying probe | Deferred; when bought, require test-result export per board | — |

### Section C — Additive manufacturing

| # | Machine | Integration route | What we capture |
|---|---|---|---|
| 27 | Intech **iFusion325 Lite** LPBF | Build log/report export and any OPC UA/API option (ask Intech: they are the OEM and an Indian company, so a custom export is realistic) | Build ID, job file, layer count, laser power, **chamber O₂**, gas flow, build time, alarms → **build job record**; powder loaded/recovered weights from **scale integration** (§3) |
| 28 | Markforged **FX10** (or X7) | Markforged cloud software exposes an API (confirm plan/tier) | Print jobs, material used, part IDs |

Powder traceability is mostly a **process + scale** problem, not a machine-interface problem:
weigh every container in and out on a networked scale and scan the powder-lot QR.

### Section D — CNC, EDM & metrology (no vendor yet: put requirements in RFQs)

| # | Machine | Integration route (require in RFQ) | What we capture |
|---|---|---|---|
| 29 | DMG 3-axis VMC | **OPC UA** or **MTConnect** option on the controller (Siemens/Heidenhain), license included | State, program, part count, spindle load, alarms, feed override |
| 32 | Mazak **Variaxis-800 NEO** 5-axis | Mazak SMOOTH controllers commonly offer **MTConnect** (confirm included) | Same as above; **spindle-on hours for MaaS billing** |
| 33 | Mazak 4-axis TurnMill | MTConnect (confirm) | Same |
| 30–31, 34–35 | Sodick / Mitsubishi EDM | Ask for MTConnect/OPC UA or controller data export; fallback self-built node (current + stack light) | Run state, program, hours, wire usage if exposed |
| 36 | LMW turning | Ask controller make (FANUC → FOCAS/MTConnect adapter, Siemens → OPC UA); fallback self-built node | State, part count |
| 37 | Mitutoyo **CRYSTA-Apex V** CMM | Measurement report export (CSV / DMIS / QIF, confirm) → parser maps to inspection characteristics | **FAI Form 3 actuals** automatically, pass/fail per characteristic, linked to serial |
| 38–39 | Zoller presetter + tool crib | Tool data export / Zoller TMS interface (confirm) | Tool IDs, measured lengths/radii, tool life, crib issue/return |
| 40 | Height gauges etc. | Bluetooth/USB gauges into inspection tablet | Measurements directly into inspection forms |
| 41 | FARO portable CMM arm | Report export from its inspection software | Same as CMM |

**Option A vs B:** connectivity requirements are identical; only the drivers differ.

## 3. Self-built IoT (yes, we can build and code our own)

For equipment without a usable interface, and for things machines don't measure, we build three
node types. All speak MQTT to the plant edge agent using the `@factoryos/iot-protocol` schemas.

| Node | Hardware (indicative) | Measures | Typical use |
|---|---|---|---|
| **Machine tap (MT-1)** | ESP32-S3 board, split-core CT sensor (non-invasive, on the machine supply), opto-isolated inputs for stack-light colours, optional accelerometer, DIN-rail enclosure, 24 V supply | Run/idle/alarm state, power and energy, cycle count, vibration | EDM, lathe, paste mixer, depaneler, any legacy machine |
| **Environment node (EN-1)** | ESP32 + calibrated T/RH sensor; Modbus link to a certified particle counter | T, RH, (particles from a certified counter) | Dry cabinets, stores, cleanroom |
| **Scale bridge (SB-1)** | RS-232/USB from industrial weighing scales to the edge PC | Weight with item/lot scan | Powder in/out, swarf/scrap by alloy, bar stock |

Plus off-the-shelf: barcode/2D scanners, Zebra-class label printers (ZPL), rugged tablets per work
center, and an industrial fanless PC (x86, 16 GB) per plant running the edge agent and a local MQTT
broker (Mosquitto) in Docker.

**Honest limits:**
- Low-cost particle sensors are **not acceptable as ISO 14644 cleanroom evidence**. Use a
  calibrated particle counter with Modbus/serial output for compliance data; self-built sensors
  are only indicative.
- Self-built nodes give *state and energy*, not program names or part counts. Use controller
  interfaces wherever they exist.
- Anything that becomes quality evidence needs a calibration record in the calibration register.

**Firmware:** C++ (PlatformIO/ESP-IDF) with OTA updates signed by us, per-device certificates (mTLS),
local buffering in flash when offline, and config pushed from FactoryOS (thresholds, tag names).
Lives in `firmware/` in this repo when we start (Phase 5).

## 4. Material estimation features this enables

| Process | Estimation | Learning loop |
|---|---|---|
| CNC | Stock size from part bounding box + allowance → bar length / plate size; buy-to-fly ratio | Actual swarf weight (scale) vs estimate per part number |
| LPBF | Powder = part volume + supports × density × factor; build time from layer count | Actual loaded − recovered powder per build |
| SMT | Paste per board from SPI volumes; component quantity × (1 + attrition) | Attrition from placer pick/drop counts per part number |
| Wash/clean | Chemistry consumption per batch | Wash machine logs |

## 5. RFQ / PO connectivity clause (recommended)

> "Supplier shall provide, at no extra cost, a documented machine data interface (IPC-CFX for SMT
> equipment; MTConnect or OPC UA for CNC/EDM/metrology controllers; or documented file/report export
> where neither is available) exposing at minimum: machine state, alarms, active program/recipe,
> part/board identifiers processed, cycle results and process parameters. Required software options
> and licenses shall be included and activated at installation. Interface documentation shall be
> provided before installation."

Apply this to: FUJI ×2, Koh Young ×2, Heller (confirm before PO release), PBT, YXLON, Intech, and all
Section D RFQs.

## 6. Rollout order (Phase 5)

1. Edge PC + MQTT + MT-1 nodes on 2–3 machines (fast win: real machine-hours).
2. SMT line via CFX: board traceability end-to-end.
3. CNC via MTConnect/OPC UA as Section D machines arrive; MaaS metering from spindle hours.
4. CMM report parser → automatic FAI.
5. Dry cabinet + cleanroom environment nodes → MSL clocks and evidence bundles.
6. LPBF build logs + powder scale bridge.

## 7. Questions for the user

1. Controller makes for the CNC/EDM/lathe once vendors are chosen.
2. Will boards be laser-marked or labelled with a 2D code? (Laser marker = one more machine.)
3. Budget approval for ~10 MT-1 nodes + 1 edge PC + 2 scales for the pilot.
