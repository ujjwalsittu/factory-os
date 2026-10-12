#include <ArduinoJson.h>
#include <stdio.h>
#include <string.h>

#include "tapcore.h"

namespace tapcore {

void isoTime(uint32_t t, char* out) {
  // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
  int64_t z = t / 86400 + 719468;
  const uint32_t secs = t % 86400;
  const int64_t era = z / 146097;
  const uint32_t doe = static_cast<uint32_t>(z - era * 146097);
  const uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const uint32_t mp = (5 * doy + 2) / 153;
  const uint32_t d = doy - (153 * mp + 2) / 5 + 1;
  const uint32_t m = mp < 10 ? mp + 3 : mp - 9;
  const int64_t y = static_cast<int64_t>(yoe) + era * 400 + (m <= 2 ? 1 : 0);
  // Years 1970–9999 give exactly 20 characters; the wider scratch buffer keeps the compiler's worst case in bounds.
  char tmp[64];
  snprintf(tmp, sizeof tmp, "%04d-%02u-%02uT%02u:%02u:%02uZ", static_cast<int>(y % 10000), static_cast<unsigned>(m), static_cast<unsigned>(d), static_cast<unsigned>(secs / 3600), static_cast<unsigned>(secs / 60 % 60), static_cast<unsigned>(secs % 60));
  memcpy(out, tmp, 20);
  out[20] = 0;
}

size_t formatState(const Event& e, char* out, size_t n) {
  char at[21];
  isoTime(e.at, at);
  const int len = snprintf(out, n, "{\"seq\":%llu,\"state\":\"%s\",\"at\":\"%s\"}", static_cast<unsigned long long>(e.seq), stateName(static_cast<State>(e.state)), at);
  return len > 0 && static_cast<size_t>(len) < n ? static_cast<size_t>(len) : 0;
}

size_t formatStatus(const Status& s, char* out, size_t n) {
  JsonDocument d;
  d["fwVersion"] = s.fwVersion;
  if (s.configVersion) d["configVersion"] = s.configVersion;
  else d["configVersion"] = nullptr;
  d["uptime"] = s.uptime;
  if (s.rssi) d["rssi"] = s.rssi;
  else d["rssi"] = nullptr;
  d["outbox"] = s.outbox;
  if (s.lastError && *s.lastError) d["lastError"] = s.lastError;
  else d["lastError"] = nullptr;
  char at[21];
  isoTime(s.at, at);
  d["at"] = at;
  if (measureJson(d) >= n) return 0;
  return serializeJson(d, out, n);
}

static bool meaning(JsonVariantConst v, const char* const* allowed, Meaning* out) {
  if (!v.is<const char*>()) return false;
  const char* s = v.as<const char*>();
  static const struct { const char* name; Meaning m; } names[] = {{"none", Meaning::None}, {"alarm", Meaning::Alarm}, {"idle", Meaning::Idle}, {"setup", Meaning::Setup}, {"running", Meaning::Running}};
  for (const char* const* a = allowed; *a; a++) {
    if (strcmp(s, *a) != 0) continue;
    for (const auto& n : names) {
      if (strcmp(n.name, s) == 0) {
        *out = n.m;
        return true;
      }
    }
  }
  return false;
}

static bool number(JsonVariantConst v, float lo, float hi, float* out) {
  if (!v.is<float>()) return false;
  const float x = v.as<float>();
  if (!(x >= lo && x <= hi)) return false;
  *out = x;
  return true;
}

static bool whole(JsonVariantConst v, uint32_t lo, uint32_t hi, uint32_t* out) {
  if (!v.is<uint32_t>()) return false;
  const uint32_t x = v.as<uint32_t>();
  if (x < lo || x > hi) return false;
  *out = x;
  return true;
}

bool parseConfig(const char* json, size_t len, Config* out, const char** error) {
  JsonDocument d;
  if (deserializeJson(d, json, len) || !d.is<JsonObjectConst>()) return (*error = "config: not JSON"), false;
  Config c;
  static const char* const red[] = {"alarm", "none", nullptr};
  static const char* const amber[] = {"idle", "setup", "alarm", "none", nullptr};
  static const char* const green[] = {"running", "none", nullptr};
  if (!whole(d["version"], 1, 0x7fffffff, &c.version)) return (*error = "config: bad version"), false;
  if (!whole(d["heartbeatSeconds"], 10, 600, &c.heartbeatSeconds)) return (*error = "config: bad heartbeat"), false;
  if (!number(d["offAmps"], 0, 500, &c.offAmps) || !number(d["runAmps"], 0.1f, 500, &c.runAmps) || c.offAmps >= c.runAmps) return (*error = "config: bad thresholds"), false;
  if (!number(d["ctAmpsPerVolt"], 1, 1000, &c.ctAmpsPerVolt)) return (*error = "config: bad CT calibration"), false;
  if (!whole(d["debounceSeconds"], 1, 120, &c.debounceSeconds)) return (*error = "config: bad debounce"), false;
  JsonVariantConst l = d["lights"];
  if (!meaning(l["red"], red, &c.red) || !meaning(l["amber"], amber, &c.amber) || !meaning(l["green"], green, &c.green)) return (*error = "config: bad lights"), false;
  *out = c;
  return true;
}

}  // namespace tapcore
