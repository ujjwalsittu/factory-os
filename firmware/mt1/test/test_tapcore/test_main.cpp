// Host tests of the tap logic (decision 064): `pio test -e native`.
#include <string.h>
#include <unity.h>

#include <map>
#include <string>

#include "tapcore.h"

using namespace tapcore;

void setUp() {}
void tearDown() {}

// ── Classifier ──

static Lights L(bool r, bool a, bool g) {
  Lights l;
  l.red = r;
  l.amber = a;
  l.green = g;
  return l;
}

static void test_classify_follows_the_rules() {
  Config c;
  TEST_ASSERT_EQUAL(State::Off, classify(c, 0.2f, L(true, false, false)));  // off wins: a dark machine has no alarm
  TEST_ASSERT_EQUAL(State::Alarm, classify(c, 8.0f, L(true, false, true)));
  TEST_ASSERT_EQUAL(State::Running, classify(c, 3.0f, L(false, false, false)));
  TEST_ASSERT_EQUAL(State::Running, classify(c, 1.0f, L(false, false, true)));
  TEST_ASSERT_EQUAL(State::Idle, classify(c, 1.0f, L(false, true, false)));
  TEST_ASSERT_EQUAL(State::Idle, classify(c, 1.0f, L(false, false, false)));
  c.amber = Meaning::Setup;
  TEST_ASSERT_EQUAL(State::Setup, classify(c, 1.0f, L(false, true, false)));
  c.green = Meaning::None;
  TEST_ASSERT_EQUAL(State::Setup, classify(c, 1.0f, L(false, true, true)));
}

static void test_debounce_holds_a_state_before_changing() {
  Config c;  // 5 s debounce
  Classifier k;
  State s;
  TEST_ASSERT_FALSE(k.update(c, 0, 5.0f, L(0, 0, 0), &s));
  TEST_ASSERT_FALSE(k.known());
  TEST_ASSERT_TRUE(k.update(c, 5000, 5.0f, L(0, 0, 0), &s));
  TEST_ASSERT_EQUAL(State::Running, s);
  // A 3 s dip to idle is ignored.
  TEST_ASSERT_FALSE(k.update(c, 6000, 1.0f, L(0, 0, 0), &s));
  TEST_ASSERT_FALSE(k.update(c, 9000, 1.0f, L(0, 0, 0), &s));
  TEST_ASSERT_FALSE(k.update(c, 9500, 5.0f, L(0, 0, 0), &s));
  TEST_ASSERT_FALSE(k.update(c, 14000, 1.0f, L(0, 0, 0), &s));
  // A held change goes through; a flicker to a third state restarts the clock.
  TEST_ASSERT_FALSE(k.update(c, 18000, 0.1f, L(0, 0, 0), &s));
  TEST_ASSERT_FALSE(k.update(c, 19000, 1.0f, L(0, 0, 0), &s));
  TEST_ASSERT_TRUE(k.update(c, 24000, 1.0f, L(0, 0, 0), &s));
  TEST_ASSERT_EQUAL(State::Idle, s);
  // Across the millis() wrap.
  Classifier w;
  TEST_ASSERT_FALSE(w.update(c, 0xFFFFF000u, 0.1f, L(0, 0, 0), &s));
  TEST_ASSERT_TRUE(w.update(c, 0x00000F00u + 3000u, 0.1f, L(0, 0, 0), &s));
}

// ── Sequence ──

struct MemSeq : SeqStore {
  uint64_t v = 0;
  bool has = false;
  int saves = 0;
  bool fail = false;
  bool load(uint64_t* hw) override {
    *hw = v;
    return has;
  }
  bool save(uint64_t hw) override {
    if (fail) return false;
    v = hw;
    has = true;
    saves++;
    return true;
  }
};

static void test_sequence_never_reuses_a_number_across_reboots() {
  MemSeq store;
  Sequence a;
  a.begin(&store);
  TEST_ASSERT_EQUAL(0, store.saves);
  TEST_ASSERT_EQUAL_UINT64(1, a.take());
  for (int i = 0; i < 1500; i++) a.take();
  TEST_ASSERT_EQUAL(2, store.saves);  // one flash write per 1,000 numbers
  const uint64_t last = a.take();
  Sequence b;  // reboot
  b.begin(&store);
  TEST_ASSERT_TRUE(b.take() > last);
  // A provisioned start (the time in ms) is honoured.
  MemSeq fresh;
  fresh.v = 1760000000000ULL;
  fresh.has = true;
  Sequence c;
  c.begin(&fresh);
  TEST_ASSERT_EQUAL_UINT64(1760000000000ULL, c.take());
  fresh.fail = true;
  for (int i = 0; i < 999; i++) c.take();
  TEST_ASSERT_EQUAL_UINT64(0, c.take());  // can't reserve: refuse rather than risk a reused number
}

// ── Outbox ──

struct MemRecords : RecordStore {
  explicit MemRecords(uint32_t cap) : cap_(cap) {}
  uint32_t cap_;
  std::map<uint32_t, Event> slots;
  uint32_t head = 0, count = 0;
  bool hasHeader = false;
  uint32_t capacity() const override { return cap_; }
  bool read(uint32_t s, Event* e) override {
    *e = slots[s];
    return true;
  }
  bool write(uint32_t s, const Event& e) override {
    slots[s] = e;
    return true;
  }
  bool loadHeader(uint32_t* h, uint32_t* c) override {
    *h = head;
    *c = count;
    return hasHeader;
  }
  bool saveHeader(uint32_t h, uint32_t c) override {
    head = h;
    count = c;
    hasHeader = true;
    return true;
  }
};

static Event ev(uint64_t seq, bool hb) {
  Event e{};
  e.seq = seq;
  e.at = 1760000000u + static_cast<uint32_t>(seq);
  e.state = static_cast<uint8_t>(State::Running);
  e.heartbeat = hb ? 1 : 0;
  return e;
}

static void test_outbox_keeps_events_until_acknowledged_across_a_reboot() {
  MemRecords store(10);
  Outbox o;
  o.begin(&store);
  for (uint64_t s = 1; s <= 3; s++) o.push(ev(s, true));
  Event f;
  TEST_ASSERT_TRUE(o.front(&f));
  o.ack(99);  // not the front: ignored
  TEST_ASSERT_EQUAL(3, o.size());
  o.ack(1);
  Outbox again;  // reboot
  again.begin(&store);
  TEST_ASSERT_EQUAL(2, again.size());
  again.front(&f);
  TEST_ASSERT_EQUAL_UINT64(2, f.seq);
  // Wraps around the ring.
  for (uint64_t s = 4; s <= 11; s++) again.push(ev(s, true));
  for (uint64_t s = 2; s <= 11; s++) {
    again.front(&f);
    TEST_ASSERT_EQUAL_UINT64(s, f.seq);
    again.ack(s);
  }
  TEST_ASSERT_EQUAL(0, again.size());
  TEST_ASSERT_FALSE(again.front(&f));
}

static void test_a_full_outbox_drops_the_oldest_heartbeat_first() {
  MemRecords store(4);
  Outbox o;
  o.begin(&store);
  o.push(ev(1, false));  // a state change
  o.push(ev(2, true));
  o.push(ev(3, false));
  o.push(ev(4, true));
  o.push(ev(5, false));  // full: drops heartbeat 2
  o.push(ev(6, false));  // drops heartbeat 4
  o.push(ev(7, false));  // no heartbeat left: drops the oldest change, 1
  TEST_ASSERT_EQUAL(4, o.size());
  TEST_ASSERT_EQUAL(3, o.dropped());
  uint64_t want[] = {3, 5, 6, 7};
  Event f;
  for (uint64_t s : want) {
    o.front(&f);
    TEST_ASSERT_EQUAL_UINT64(s, f.seq);
    o.ack(s);
  }
}

static void test_a_corrupt_header_starts_empty() {
  MemRecords store(4);
  store.hasHeader = true;
  store.head = 9;
  store.count = 2;
  Outbox o;
  o.begin(&store);
  TEST_ASSERT_EQUAL(0, o.size());
}

// ── Messages ──

static void test_state_and_status_messages_match_the_contract() {
  char at[21];
  isoTime(0, at);
  TEST_ASSERT_EQUAL_STRING("1970-01-01T00:00:00Z", at);
  isoTime(1795046399u, at);  // 2026-11-18T23:59:59Z
  TEST_ASSERT_EQUAL_STRING("2026-11-18T23:59:59Z", at);
  isoTime(1709210096u, at);  // a leap day
  TEST_ASSERT_EQUAL_STRING("2024-02-29T12:34:56Z", at);
  char buf[160];
  Event e = ev(1760000000123ULL, false);
  e.at = 1760262000u;
  e.state = static_cast<uint8_t>(State::Alarm);
  TEST_ASSERT_TRUE(formatState(e, buf, sizeof buf) > 0);
  TEST_ASSERT_EQUAL_STRING("{\"seq\":1760000000123,\"state\":\"alarm\",\"at\":\"2025-10-12T09:40:00Z\"}", buf);
  TEST_ASSERT_EQUAL(0, formatState(e, buf, 20));
  Status s{"1.0.0-dev", 3, 3600, -61, 12, "ota: \"bad\" signature", 1760262000u};
  char out[256];
  TEST_ASSERT_TRUE(formatStatus(s, out, sizeof out) > 0);
  TEST_ASSERT_EQUAL_STRING("{\"fwVersion\":\"1.0.0-dev\",\"configVersion\":3,\"uptime\":3600,\"rssi\":-61,\"outbox\":12,\"lastError\":\"ota: \\\"bad\\\" signature\",\"at\":\"2025-10-12T09:40:00Z\"}", out);
  Status none{"1.0.0", 0, 5, 0, 0, nullptr, 1760262000u};
  formatStatus(none, out, sizeof out);
  TEST_ASSERT_EQUAL_STRING("{\"fwVersion\":\"1.0.0\",\"configVersion\":null,\"uptime\":5,\"rssi\":null,\"outbox\":0,\"lastError\":null,\"at\":\"2025-10-12T09:40:00Z\"}", out);
}

static void test_config_messages_are_validated() {
  const char* ok = "{\"version\":4,\"heartbeatSeconds\":30,\"offAmps\":1,\"runAmps\":6.5,\"ctAmpsPerVolt\":50,\"debounceSeconds\":10,\"lights\":{\"red\":\"alarm\",\"amber\":\"setup\",\"green\":\"none\"}}";
  Config c;
  const char* err = nullptr;
  TEST_ASSERT_TRUE(parseConfig(ok, strlen(ok), &c, &err));
  TEST_ASSERT_EQUAL(4, c.version);
  TEST_ASSERT_EQUAL(30, c.heartbeatSeconds);
  TEST_ASSERT_EQUAL_FLOAT(6.5f, c.runAmps);
  TEST_ASSERT_EQUAL(Meaning::Setup, c.amber);
  TEST_ASSERT_EQUAL(Meaning::None, c.green);
  struct { std::string from, to, err; } bad[] = {
      {"\"runAmps\":6.5", "\"runAmps\":0.5", "config: bad thresholds"},
      {"\"heartbeatSeconds\":30", "\"heartbeatSeconds\":5", "config: bad heartbeat"},
      {"\"version\":4", "\"version\":0", "config: bad version"},
      {"\"debounceSeconds\":10", "\"debounceSeconds\":121", "config: bad debounce"},
      {"\"green\":\"none\"", "\"green\":\"alarm\"", "config: bad lights"},
      {"\"ctAmpsPerVolt\":50", "\"ctAmpsPerVolt\":\"50\"", "config: bad CT calibration"},
  };
  for (auto& b : bad) {
    std::string j(ok);
    j.replace(j.find(b.from), b.from.size(), b.to);
    Config keep = c;
    TEST_ASSERT_FALSE(parseConfig(j.c_str(), j.size(), &keep, &err));
    TEST_ASSERT_EQUAL_STRING(b.err.c_str(), err);
    TEST_ASSERT_EQUAL(4, keep.version);  // a bad message changes nothing
  }
  TEST_ASSERT_FALSE(parseConfig("nope", 4, &c, &err));
}

// ── Signed updates ──

// From `node firmware/scripts/sign.mjs` with the development key: a build "mt1 test image" as version 1.2.0-dev.
static const char* DEV_PUB = "YWTjNFutMlWqyA5T8NiLkQqw10XuZzYqORfT84H1snY=";
static const char* SIGNED =
    "{\"version\":\"1.2.0-dev\",\"size\":14,\"sha256\":\"611dcf2bd47db5e1a1e9622c80ed98345732c725b4494ce4f03535e0b9ebd253\","
    "\"url\":\"https://edge-nm1.plant:8443/firmware/mt1-1.2.0-dev.bin\","
    "\"signature\":\"gGaxz/SbiXeU7gNqpZNRpk/4QBcU5L6xg1gqJi69DlWqPep7vDTRV8iIYv0i9+C29w95qNoPsQM+lYBL8YtpBA==\"}";

static void test_versions_order_like_the_edge_agent() {
  TEST_ASSERT_EQUAL(-1, compareVersions("1.2.0", "1.10.0"));
  TEST_ASSERT_EQUAL(1, compareVersions("2.0.0", "1.99.99"));
  TEST_ASSERT_EQUAL(0, compareVersions("1.0.0", "1.0.0"));
  TEST_ASSERT_EQUAL(-1, compareVersions("1.0.0-dev", "1.0.0"));
  TEST_ASSERT_EQUAL(1, compareVersions("1.0.0", "1.0.0-dev"));
  TEST_ASSERT_EQUAL(-2, compareVersions("1.0", "1.0.0"));
  TEST_ASSERT_EQUAL(-2, compareVersions("1.0.0;rm", "1.0.0"));
}

static void test_a_signed_manifest_verifies_and_a_changed_one_does_not() {
  uint8_t pk[32];
  TEST_ASSERT_TRUE(base64Decode(DEV_PUB, pk, sizeof pk));
  Manifest m;
  const char* err = nullptr;
  TEST_ASSERT_TRUE(parseManifest(SIGNED, strlen(SIGNED), &m, &err));
  TEST_ASSERT_EQUAL(14, m.size);
  TEST_ASSERT_EQUAL_HEX8(0x61, m.sha256[0]);
  TEST_ASSERT_TRUE(verifyManifest(m, pk));
  Manifest t = m;
  t.size = 15;
  TEST_ASSERT_FALSE(verifyManifest(t, pk));
  t = m;
  strcpy(t.version, "1.3.0-dev");
  TEST_ASSERT_FALSE(verifyManifest(t, pk));
  t = m;
  t.sha256Hex[0] = '7';
  TEST_ASSERT_FALSE(verifyManifest(t, pk));
  uint8_t other[32];
  memcpy(other, pk, 32);
  other[0] ^= 1;
  TEST_ASSERT_FALSE(verifyManifest(m, other));
  std::string http(SIGNED);
  http.replace(http.find("https://"), 8, "http://");
  TEST_ASSERT_FALSE(parseManifest(http.c_str(), http.size(), &m, &err));
  TEST_ASSERT_EQUAL_STRING("ota: the url must be https", err);
}

static void test_only_newer_builds_of_the_same_kind_are_installed() {
  Manifest m;
  const char* why = nullptr;
  parseManifest(SIGNED, strlen(SIGNED), &m, &why);
  TEST_ASSERT_TRUE(wantUpdate(m, "1.1.0-dev", &why));
  TEST_ASSERT_FALSE(wantUpdate(m, "1.2.0-dev", &why));
  TEST_ASSERT_EQUAL_STRING("ota: not newer", why);
  TEST_ASSERT_FALSE(wantUpdate(m, "1.0.0", &why));
  TEST_ASSERT_EQUAL_STRING("ota: a release build takes no -dev version", why);
  strcpy(m.version, "2.0.0");
  TEST_ASSERT_FALSE(wantUpdate(m, "1.0.0-dev", &why));
  TEST_ASSERT_EQUAL_STRING("ota: a development build takes only -dev versions", why);
  TEST_ASSERT_TRUE(wantUpdate(m, "1.0.0", &why));
}

static void test_base64_rejects_the_wrong_length_or_alphabet() {
  uint8_t out[32];
  TEST_ASSERT_FALSE(base64Decode("AAAA", out, sizeof out));
  TEST_ASSERT_FALSE(base64Decode("YWTjNFutMlWqyA5T8NiLkQqw10XuZzYqORfT84H1sn*=", out, sizeof out));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_classify_follows_the_rules);
  RUN_TEST(test_debounce_holds_a_state_before_changing);
  RUN_TEST(test_sequence_never_reuses_a_number_across_reboots);
  RUN_TEST(test_outbox_keeps_events_until_acknowledged_across_a_reboot);
  RUN_TEST(test_a_full_outbox_drops_the_oldest_heartbeat_first);
  RUN_TEST(test_a_corrupt_header_starts_empty);
  RUN_TEST(test_state_and_status_messages_match_the_contract);
  RUN_TEST(test_config_messages_are_validated);
  RUN_TEST(test_versions_order_like_the_edge_agent);
  RUN_TEST(test_a_signed_manifest_verifies_and_a_changed_one_does_not);
  RUN_TEST(test_only_newer_builds_of_the_same_kind_are_installed);
  RUN_TEST(test_base64_rejects_the_wrong_length_or_alphabet);
  return UNITY_END();
}
