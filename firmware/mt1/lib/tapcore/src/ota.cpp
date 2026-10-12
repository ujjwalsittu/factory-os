#include <ArduinoJson.h>
#include <monocypher-ed25519.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tapcore.h"

namespace tapcore {

struct Parsed {
  long n[3];
  const char* label;  // nullptr: a release
  size_t labelLen;
};

static bool parseVersion(const char* v, Parsed* p) {
  const char* s = v;
  for (int i = 0; i < 3; i++) {
    if (*s < '0' || *s > '9') return false;
    char* end = nullptr;
    p->n[i] = strtol(s, &end, 10);
    if (end - s > 5) return false;
    s = end;
    if (i < 2 && *s++ != '.') return false;
  }
  p->label = nullptr;
  p->labelLen = 0;
  if (*s == 0) return true;
  if (*s++ != '-') return false;
  p->label = s;
  for (; *s; s++) {
    const char c = *s;
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '.' || c == '-')) return false;
  }
  p->labelLen = static_cast<size_t>(s - p->label);
  return p->labelLen >= 1 && p->labelLen <= 20;
}

int compareVersions(const char* a, const char* b) {
  Parsed x, y;
  if (!parseVersion(a, &x) || !parseVersion(b, &y)) return -2;
  for (int i = 0; i < 3; i++) {
    if (x.n[i] != y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  }
  if (!x.label && !y.label) return 0;
  if (!x.label) return 1;
  if (!y.label) return -1;
  const int c = strcmp(x.label, y.label);
  return c == 0 ? 0 : (c < 0 ? -1 : 1);
}

static int b64(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

bool base64Decode(const char* in, uint8_t* out, size_t n) {
  size_t len = strlen(in);
  while (len && in[len - 1] == '=') len--;
  if ((len * 6) / 8 != n) return false;
  uint32_t acc = 0;
  int bits = 0;
  size_t o = 0;
  for (size_t i = 0; i < len; i++) {
    const int v = b64(in[i]);
    if (v < 0) return false;
    acc = (acc << 6) | static_cast<uint32_t>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = static_cast<uint8_t>(acc >> bits);
    }
  }
  return o == n;
}

static bool hex32(const char* s, uint8_t out[32]) {
  if (strlen(s) != 64) return false;
  for (int i = 0; i < 32; i++) {
    unsigned v = 0;
    for (int j = 0; j < 2; j++) {
      const char c = s[i * 2 + j];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= static_cast<unsigned>(c - '0');
      else if (c >= 'a' && c <= 'f') v |= static_cast<unsigned>(c - 'a' + 10);
      else return false;  // lowercase only, as the signer writes it
    }
    out[i] = static_cast<uint8_t>(v);
  }
  return true;
}

bool parseManifest(const char* json, size_t len, Manifest* out, const char** error) {
  JsonDocument d;
  if (deserializeJson(d, json, len) || !d.is<JsonObjectConst>()) return (*error = "ota: manifest not JSON"), false;
  Manifest m{};
  const char* version = d["version"] | "";
  const char* sha = d["sha256"] | "";
  const char* url = d["url"] | "";
  const char* sig = d["signature"] | "";
  Parsed p;
  if (strlen(version) >= sizeof m.version || !parseVersion(version, &p)) return (*error = "ota: bad version"), false;
  if (!d["size"].is<uint32_t>() || d["size"].as<uint32_t>() == 0) return (*error = "ota: bad size"), false;
  if (!hex32(sha, m.sha256)) return (*error = "ota: bad sha256"), false;
  if (strlen(url) >= sizeof m.url || strncmp(url, "https://", 8) != 0) return (*error = "ota: the url must be https"), false;
  if (!base64Decode(sig, m.signature, sizeof m.signature)) return (*error = "ota: bad signature encoding"), false;
  strcpy(m.version, version);
  strcpy(m.sha256Hex, sha);
  strcpy(m.url, url);
  m.size = d["size"].as<uint32_t>();
  *out = m;
  return true;
}

bool verifyManifest(const Manifest& m, const uint8_t publicKey[32]) {
  char payload[160];
  const int len = snprintf(payload, sizeof payload, "factoryos-mt1|%s|%lu|%s", m.version, static_cast<unsigned long>(m.size), m.sha256Hex);
  if (len <= 0 || static_cast<size_t>(len) >= sizeof payload) return false;
  return crypto_ed25519_check(m.signature, publicKey, reinterpret_cast<const uint8_t*>(payload), static_cast<size_t>(len)) == 0;
}

static bool isDev(const char* v) {
  const size_t n = strlen(v);
  return n > 4 && strcmp(v + n - 4, "-dev") == 0;
}

bool wantUpdate(const Manifest& m, const char* running, const char** why) {
  if (isDev(m.version) != isDev(running)) return (*why = isDev(running) ? "ota: a development build takes only -dev versions" : "ota: a release build takes no -dev version"), false;
  const int c = compareVersions(m.version, running);
  if (c == -2) return (*why = "ota: bad version"), false;
  if (c <= 0) return (*why = "ota: not newer"), false;
  return true;
}

}  // namespace tapcore
