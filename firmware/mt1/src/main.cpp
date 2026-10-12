// MT-1 machine tap (decision 064): ESP32-S3, a clamp-on current transformer and three opto-isolated stack-light
// inputs. The logic lives in lib/tapcore (host-tested); this file is the hardware and network side.
//
// Identity and network settings come from the NVS partition written by firmware/provision/issue-tap.sh (namespace
// "tap"); the firmware itself carries no secrets.
#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_http_client.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>
#include <mqtt_client.h>
#include <time.h>

#include "ota_key.h"
#include "tapcore.h"

using namespace tapcore;

#ifndef FW_VERSION
#error "FW_VERSION is set in platformio.ini"
#endif

// ── Pins (MT-1 board rev A) ──
static constexpr int PIN_CT = 1;  // ADC1 channel 0: the CT burden, biased at mid-supply
static constexpr int PIN_RED = 4;  // opto outputs pull low when the light is lit
static constexpr int PIN_AMBER = 5;
static constexpr int PIN_GREEN = 6;

static constexpr uint32_t CLOCK_VALID_AFTER = 1767225600;  // 2026-01-01: SNTP has set the clock
static constexpr uint32_t OUTBOX_CAPACITY = 10000;  // about a week of one-a-minute heartbeats
static constexpr uint32_t STATUS_EVERY_MS = 5 * 60 * 1000;
static constexpr uint32_t ROLLBACK_AFTER_MS = 5 * 60 * 1000;  // a new image that can't reach the broker by then rolls back
static constexpr uint32_t INFLIGHT_TIMEOUT_MS = 30 * 1000;

// ── Identity (NVS "tap") ──
struct Identity {
  String ssid, pass, broker, ntp, tenant, plant, device, ca, cert, key;
  uint16_t port;
};
static Identity id;
static String topicState, topicStatus, topicConfig, topicOta;

// ── Flash-backed sequence and outbox ──
struct NvsSeq : SeqStore {
  bool load(uint64_t* hw) override {
    Preferences p;
    p.begin("seq", true);
    const bool has = p.isKey("hw");
    *hw = p.getULong64("hw", 0);
    p.end();
    return has;
  }
  bool save(uint64_t hw) override {
    Preferences p;
    p.begin("seq", false);
    const bool ok = p.putULong64("hw", hw) == sizeof(uint64_t);
    p.end();
    return ok;
  }
};

/** The outbox file: an 8-byte header (head, count) then OUTBOX_CAPACITY records of 16 bytes. */
struct FileRecords : RecordStore {
  File f;
  bool open() {
    const char* path = "/outbox.bin";
    const size_t want = 8 + OUTBOX_CAPACITY * sizeof(Event);
    if (!LittleFS.exists(path) || LittleFS.open(path, "r").size() != want) {
      File n = LittleFS.open(path, "w");
      if (!n) return false;
      uint8_t zero[256] = {};
      for (size_t left = want; left;) left -= n.write(zero, left < sizeof zero ? left : sizeof zero);
      n.close();
    }
    f = LittleFS.open(path, "r+");
    return bool(f);
  }
  uint32_t capacity() const override { return OUTBOX_CAPACITY; }
  bool read(uint32_t slot, Event* e) override { return f.seek(8 + slot * sizeof(Event)) && f.read(reinterpret_cast<uint8_t*>(e), sizeof(Event)) == sizeof(Event); }
  bool write(uint32_t slot, const Event& e) override {
    const bool ok = f.seek(8 + slot * sizeof(Event)) && f.write(reinterpret_cast<const uint8_t*>(&e), sizeof(Event)) == sizeof(Event);
    f.flush();
    return ok;
  }
  bool loadHeader(uint32_t* head, uint32_t* count) override {
    uint32_t h[2];
    if (!f.seek(0) || f.read(reinterpret_cast<uint8_t*>(h), sizeof h) != sizeof h) return false;
    *head = h[0];
    *count = h[1];
    return true;
  }
  bool saveHeader(uint32_t head, uint32_t count) override {
    const uint32_t h[2] = {head, count};
    const bool ok = f.seek(0) && f.write(reinterpret_cast<const uint8_t*>(h), sizeof h) == sizeof h;
    f.flush();
    return ok;
  }
};

static NvsSeq seqStore;
static FileRecords records;
static Sequence seq;
static Outbox outbox;
static Classifier classifier;
static Config config;
static String lastError;
static bool statusDirty = true;

static void fail(const char* e) {
  lastError = e;
  statusDirty = true;
  Serial.println(e);
}

// ── MQTT (esp-mqtt over TLS with the tap's certificate) ──
// The event handler runs in the MQTT task; it hands work to loop() through this queue.
enum class Inbound : uint8_t { Connected, Disconnected, Published, Config, Ota };
struct InMsg {
  Inbound kind;
  int msgId;
  uint16_t len;
  char data[1024];
};
static QueueHandle_t inbox;
static esp_mqtt_client_handle_t mqtt;
static bool connected = false;
static int inflightId = -1;
static uint64_t inflightSeq = 0;
static uint32_t inflightAt = 0;

static void onMqtt(void*, esp_event_base_t, int32_t eventId, void* data) {
  auto* ev = static_cast<esp_mqtt_event_handle_t>(data);
  static InMsg m;  // only the MQTT task touches it
  m.len = 0;
  switch (static_cast<esp_mqtt_event_id_t>(eventId)) {
    case MQTT_EVENT_CONNECTED: m.kind = Inbound::Connected; break;
    case MQTT_EVENT_DISCONNECTED: m.kind = Inbound::Disconnected; break;
    case MQTT_EVENT_PUBLISHED:
      m.kind = Inbound::Published;
      m.msgId = ev->msg_id;
      break;
    case MQTT_EVENT_DATA: {
      // Whole messages only (buffer_size is above the largest config or manifest); fragments are dropped.
      if (ev->current_data_offset != 0 || ev->data_len != ev->total_data_len || ev->data_len >= static_cast<int>(sizeof m.data)) return;
      const String topic(ev->topic, ev->topic_len);
      if (topic == topicConfig) m.kind = Inbound::Config;
      else if (topic == topicOta) m.kind = Inbound::Ota;
      else return;
      memcpy(m.data, ev->data, ev->data_len);
      m.len = static_cast<uint16_t>(ev->data_len);
      m.data[m.len] = 0;
      break;
    }
    default: return;
  }
  xQueueSend(inbox, &m, 0);
}

static void startMqtt() {
  static String uri = "mqtts://" + id.broker + ":" + String(id.port);
  esp_mqtt_client_config_t c = {};
  c.uri = uri.c_str();
  c.client_id = id.device.c_str();
  c.cert_pem = id.ca.c_str();
  c.client_cert_pem = id.cert.c_str();
  c.client_key_pem = id.key.c_str();
  c.keepalive = 30;
  c.buffer_size = 2048;
  c.reconnect_timeout_ms = 5000;
  mqtt = esp_mqtt_client_init(&c);
  esp_mqtt_client_register_event(mqtt, MQTT_EVENT_ANY, onMqtt, nullptr);
  esp_mqtt_client_start(mqtt);
}

// ── Settings ──

static void loadSavedConfig() {
  Preferences p;
  p.begin("cfg", true);
  const String saved = p.getString("json", "");
  p.end();
  const char* err = nullptr;
  if (saved.length() && !parseConfig(saved.c_str(), saved.length(), &config, &err)) fail(err);
}

static void applyConfig(const char* json, size_t len) {
  if (!len) return;  // the retained config was cleared: keep running the last settings
  Config next;
  const char* err = nullptr;
  if (!parseConfig(json, len, &next, &err)) return fail(err);
  if (next.version == config.version) return;
  config = next;
  Preferences p;
  p.begin("cfg", false);
  p.putString("json", String(json).substring(0, len));
  p.end();
  statusDirty = true;
  Serial.printf("config v%u applied\n", config.version);
}

// ── Signed updates ──

static bool pendingVerify = false;
static String refusedOta;  // a version that failed to install is not retried until the next boot

/** Arduino core hook: we mark a new image valid ourselves, once it has reached the broker. */
extern "C" bool verifyRollbackLater() { return true; }

static bool downloadAndInstall(const Manifest& m) {
  const esp_partition_t* part = esp_ota_get_next_update_partition(nullptr);
  if (!part || m.size > part->size) return fail("ota: the build doesn't fit"), false;
  esp_http_client_config_t hc = {};
  hc.url = m.url;
  hc.cert_pem = id.ca.c_str();  // the edge's certificate is from the plant CA
  hc.timeout_ms = 15000;
  esp_http_client_handle_t http = esp_http_client_init(&hc);
  esp_ota_handle_t ota = 0;
  bool ok = false;
  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts_ret(&sha, 0);
  do {
    if (esp_http_client_open(http, 0) != ESP_OK) { fail("ota: can't reach the firmware server"); break; }
    if (esp_http_client_fetch_headers(http) != static_cast<int>(m.size) || esp_http_client_get_status_code(http) != 200) { fail("ota: unexpected response"); break; }
    if (esp_ota_begin(part, m.size, &ota) != ESP_OK) { fail("ota: can't start writing"); break; }
    static uint8_t buf[4096];
    uint32_t got = 0;
    while (got < m.size) {
      const int n = esp_http_client_read(http, reinterpret_cast<char*>(buf), sizeof buf);
      if (n <= 0) break;
      mbedtls_sha256_update_ret(&sha, buf, n);
      if (esp_ota_write(ota, buf, n) != ESP_OK) break;
      got += n;
      delay(1);
    }
    uint8_t digest[32];
    mbedtls_sha256_finish_ret(&sha, digest);
    if (got != m.size || memcmp(digest, m.sha256, 32) != 0) { fail("ota: the download doesn't match the signed hash"); break; }
    if (esp_ota_end(ota) != ESP_OK) { ota = 0; fail("ota: the image is not valid"); break; }
    ota = 0;
    if (esp_ota_set_boot_partition(part) != ESP_OK) { fail("ota: can't switch partitions"); break; }
    ok = true;
  } while (false);
  if (ota) esp_ota_abort(ota);
  mbedtls_sha256_free(&sha);
  esp_http_client_cleanup(http);
  return ok;
}

static void handleOta(const char* json, size_t len) {
  if (!len) return;  // announcement withdrawn
  Manifest m;
  const char* why = nullptr;
  if (!parseManifest(json, len, &m, &why)) return fail(why);
  uint8_t key[32];
  if (!base64Decode(FOS_OTA_KEY_B64, key, sizeof key) || !verifyManifest(m, key)) return fail("ota: bad signature; not installed");
  if (!wantUpdate(m, FW_VERSION, &why)) return;  // not newer, or the wrong kind of build: nothing to report
  if (refusedOta == m.version) return;
  Serial.printf("ota: installing %s\n", m.version);
  if (!downloadAndInstall(m)) {
    refusedOta = m.version;
    return;
  }
  Serial.println("ota: installed; restarting");
  esp_mqtt_client_stop(mqtt);
  delay(500);
  esp_restart();
}

// ── Sensing ──

/** RMS current over 10 mains cycles at 50 Hz (1 kHz sampling), from the CT burden's AC component. */
static float readAmps() {
  static constexpr int N = 200;
  static uint16_t mv[N];
  uint32_t t = micros();
  int64_t sum = 0;
  for (int i = 0; i < N; i++) {
    while (micros() - t < 1000) {
    }
    t += 1000;
    mv[i] = analogReadMilliVolts(PIN_CT);
    sum += mv[i];
  }
  const float mean = static_cast<float>(sum) / N;
  float sq = 0;
  for (int i = 0; i < N; i++) sq += (mv[i] - mean) * (mv[i] - mean);
  return sqrtf(sq / N) / 1000.0f * config.ctAmpsPerVolt;
}

static Lights readLights() {
  Lights l;
  l.red = digitalRead(PIN_RED) == LOW;
  l.amber = digitalRead(PIN_AMBER) == LOW;
  l.green = digitalRead(PIN_GREEN) == LOW;
  return l;
}

static uint32_t now() { return static_cast<uint32_t>(time(nullptr)); }

static void record(State s, bool heartbeat) {
  if (now() < CLOCK_VALID_AFTER) return;  // nothing is published until the clock is set
  Event e{};
  e.seq = seq.take();
  if (!e.seq) return fail("seq: can't reserve numbers in flash");
  e.at = now();
  e.state = static_cast<uint8_t>(s);
  e.heartbeat = heartbeat ? 1 : 0;
  if (!outbox.push(e)) fail("outbox: flash write failed");
}

// ── Setup and loop ──

static bool loadIdentity() {
  Preferences p;
  if (!p.begin("tap", true)) return false;
  id.ssid = p.getString("wifi_ssid", "");
  id.pass = p.getString("wifi_pass", "");
  id.broker = p.getString("broker", "");
  id.port = p.getUShort("port", 8883);
  id.ntp = p.getString("ntp", "");
  id.tenant = p.getString("tenant", "");
  id.plant = p.getString("plant", "");
  id.device = p.getString("device", "");
  id.ca = p.getString("ca", "");
  id.cert = p.getString("cert", "");
  id.key = p.getString("key", "");
  p.end();
  return id.ssid.length() && id.broker.length() && id.tenant.length() && id.plant.length() && id.device.length() && id.ca.length() && id.cert.length() && id.key.length();
}

void setup() {
  Serial.begin(115200);
  Serial.printf("MT-1 firmware %s\n", FW_VERSION);
  pinMode(PIN_RED, INPUT_PULLUP);
  pinMode(PIN_AMBER, INPUT_PULLUP);
  pinMode(PIN_GREEN, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_CT, ADC_11db);

  esp_ota_img_states_t st;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY) pendingVerify = true;

  if (!loadIdentity()) {
    // Not provisioned: say so on the console and wait; the board stays safe to flash.
    for (;;) {
      Serial.println("Not provisioned: run firmware/provision/issue-tap.sh for this tap");
      delay(10000);
    }
  }
  const String base = "factoryos/" + id.tenant + "/" + id.plant + "/" + id.device;
  topicState = base + "/state";
  topicStatus = base + "/status";
  topicConfig = base + "/config";
  topicOta = "factoryos/" + id.tenant + "/" + id.plant + "/ota";

  if (!LittleFS.begin(true) || !records.open() || !outbox.begin(&records)) fail("outbox: LittleFS unavailable");
  seq.begin(&seqStore);
  loadSavedConfig();

  inbox = xQueueCreate(8, sizeof(InMsg));
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(id.ssid.c_str(), id.pass.c_str());
  configTime(0, 0, id.ntp.length() ? id.ntp.c_str() : id.broker.c_str());  // the edge PC serves NTP
  startMqtt();
}

void loop() {
  static uint32_t lastSample = 0, lastBeat = 0, lastStatus = 0;
  const uint32_t ms = millis();

  // Inbound MQTT work.
  static InMsg m;
  while (xQueueReceive(inbox, &m, 0) == pdTRUE) {
    switch (m.kind) {
      case Inbound::Connected:
        connected = true;
        inflightId = -1;
        esp_mqtt_client_subscribe(mqtt, topicConfig.c_str(), 1);
        esp_mqtt_client_subscribe(mqtt, topicOta.c_str(), 1);
        statusDirty = true;
        if (pendingVerify) {
          esp_ota_mark_app_valid_cancel_rollback();
          pendingVerify = false;
          Serial.println("ota: new image confirmed");
        }
        break;
      case Inbound::Disconnected:
        connected = false;
        inflightId = -1;  // resent after reconnecting; the API keeps one copy per seq
        break;
      case Inbound::Published:
        if (m.msgId == inflightId) {
          outbox.ack(inflightSeq);
          inflightId = -1;
        }
        break;
      case Inbound::Config: applyConfig(m.data, m.len); break;
      case Inbound::Ota: handleOta(m.data, m.len); break;
    }
  }

  if (pendingVerify && ms > ROLLBACK_AFTER_MS) {
    Serial.println("ota: the new image never reached the broker; rolling back");
    esp_ota_mark_app_invalid_rollback_and_reboot();
  }

  // Sense once a second; record changes at once and the state every heartbeat.
  if (ms - lastSample >= 1000) {
    lastSample = ms;
    State s;
    if (classifier.update(config, ms, readAmps(), readLights(), &s)) {
      record(s, false);
      lastBeat = ms;
    } else if (classifier.known() && ms - lastBeat >= config.heartbeatSeconds * 1000u) {
      record(classifier.current(), true);
      lastBeat = ms;
    }
  }

  // Publish the outbox one event at a time, each acknowledged by the broker (QoS 1).
  if (inflightId >= 0 && ms - inflightAt > INFLIGHT_TIMEOUT_MS) inflightId = -1;
  Event e;
  if (connected && inflightId < 0 && outbox.front(&e)) {
    char json[128];
    const size_t n = formatState(e, json, sizeof json);
    const int idOut = esp_mqtt_client_publish(mqtt, topicState.c_str(), json, n, 1, 0);
    if (idOut > 0) {
      inflightId = idOut;
      inflightSeq = e.seq;
      inflightAt = ms;
    }
  }

  // Retained status: on change and every few minutes.
  if (connected && now() >= CLOCK_VALID_AFTER && (statusDirty || ms - lastStatus >= STATUS_EVERY_MS)) {
    Status s{FW_VERSION, config.version, ms / 1000, WiFi.isConnected() ? WiFi.RSSI() : 0, outbox.size(), lastError.c_str(), now()};
    char json[384];
    const size_t n = formatStatus(s, json, sizeof json);
    if (n && esp_mqtt_client_publish(mqtt, topicStatus.c_str(), json, n, 1, 1) >= 0) {
      statusDirty = false;
      lastStatus = ms;
    }
  }
  delay(10);
}
