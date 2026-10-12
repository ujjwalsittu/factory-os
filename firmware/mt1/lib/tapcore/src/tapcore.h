// MT-1 machine tap logic (decision 064), free of hardware so it is unit-tested on the host.
// The message contract mirrors packages/iot-protocol: keep the two in step.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace tapcore {

// ── States and settings ──

enum class State : uint8_t { Off, Idle, Setup, Running, Alarm };
const char* stateName(State s);

/** What a lit stack light means; set per light in Plant → Devices. */
enum class Meaning : uint8_t { None, Alarm, Idle, Setup, Running };

struct Config {
  uint32_t version = 0;  // 0: never received; the defaults below apply
  uint32_t heartbeatSeconds = 60;
  float offAmps = 0.5f;
  float runAmps = 3.0f;
  float ctAmpsPerVolt = 30.0f;
  uint32_t debounceSeconds = 5;
  Meaning red = Meaning::Alarm;
  Meaning amber = Meaning::Idle;
  Meaning green = Meaning::Running;
};

struct Lights {
  bool red = false;
  bool amber = false;
  bool green = false;
};

/**
 * The state right now: off below the off threshold; alarm while a light meaning alarm is lit; running at or above the
 * run threshold or while a light meaning running is lit; setup while a light meaning setup is lit; otherwise idle.
 */
State classify(const Config& c, float amps, const Lights& l);

/** Applies the debounce: a new state must hold for the debounce time before it becomes the current state. */
class Classifier {
 public:
  /** Feeds one reading; true when the current state changed (or was first established), with the new state. */
  bool update(const Config& c, uint32_t nowMs, float amps, const Lights& l, State* changedTo);
  bool known() const { return known_; }
  State current() const { return current_; }

 private:
  bool known_ = false;
  State current_ = State::Off;
  bool pending_ = false;
  State candidate_ = State::Off;
  uint32_t since_ = 0;
};

// ── Sequence numbers ──

struct SeqStore {
  virtual ~SeqStore() = default;
  virtual bool load(uint64_t* highWater) = 0;
  virtual bool save(uint64_t highWater) = 0;
};

/**
 * Strictly increasing event numbers that survive reboots. The store holds a high-water mark: every number below it
 * may have been used. Blocks of SEQ_BLOCK are reserved at a time, so flash is written once per block and a reboot
 * skips the rest of the block instead of reusing numbers.
 */
class Sequence {
 public:
  static constexpr uint64_t SEQ_BLOCK = 1000;
  bool begin(SeqStore* store);
  /** The next number; 0 only when the store failed (the caller then publishes nothing). */
  uint64_t take();

 private:
  SeqStore* store_ = nullptr;
  uint64_t next_ = 0;
  uint64_t highWater_ = 0;
};

// ── Outbox ──

struct Event {
  uint64_t seq;
  uint32_t at;  // Unix seconds
  uint8_t state;
  uint8_t heartbeat;  // 1: a heartbeat, which may be dropped when the outbox is full; 0: a state change
  uint8_t pad[2];
};
static_assert(sizeof(Event) == 16, "Event is stored as 16 bytes");

/** Fixed-size record storage (a file on LittleFS on the tap, memory in tests). */
struct RecordStore {
  virtual ~RecordStore() = default;
  virtual uint32_t capacity() const = 0;
  virtual bool read(uint32_t slot, Event* e) = 0;
  virtual bool write(uint32_t slot, const Event& e) = 0;
  virtual bool loadHeader(uint32_t* head, uint32_t* count) = 0;
  virtual bool saveHeader(uint32_t head, uint32_t count) = 0;
};

/**
 * Events wait here until the broker acknowledges them. A ring over the record store; when it is full, the oldest
 * heartbeat is dropped to make room, and the oldest state change only when there is no heartbeat left.
 */
class Outbox {
 public:
  bool begin(RecordStore* store);
  bool push(const Event& e);
  bool front(Event* e);
  /** Removes the front event if it is still `seq` (it may have been dropped while in flight). */
  void ack(uint64_t seq);
  uint32_t size() const { return count_; }
  uint32_t dropped() const { return dropped_; }

 private:
  uint32_t slot(uint32_t i) const { return (head_ + i) % store_->capacity(); }
  RecordStore* store_ = nullptr;
  uint32_t head_ = 0;
  uint32_t count_ = 0;
  uint32_t dropped_ = 0;
};

// ── Messages ──

/** `YYYY-MM-DDTHH:MM:SSZ` for Unix seconds; `out` holds at least 21 bytes. */
void isoTime(uint32_t unixSeconds, char* out);

/** The `state` message: `{"seq":…,"state":"…","at":"…"}`. Returns the length, 0 when it doesn't fit. */
size_t formatState(const Event& e, char* out, size_t n);

struct Status {
  const char* fwVersion;
  uint32_t configVersion;  // 0: none applied yet (null)
  uint32_t uptime;
  int32_t rssi;  // 0: not connected (null)
  uint32_t outbox;
  const char* lastError;  // nullptr or empty: none (null)
  uint32_t at;
};
/** The retained `status` message. Returns the length, 0 when it doesn't fit. */
size_t formatStatus(const Status& s, char* out, size_t n);

/** Parses and validates a retained `config` message (the same limits as the API). False with a reason otherwise. */
bool parseConfig(const char* json, size_t len, Config* out, const char** error);

// ── Signed firmware updates ──

struct Manifest {
  char version[24];
  uint32_t size;
  char sha256Hex[65];
  uint8_t sha256[32];
  char url[200];
  uint8_t signature[64];
};

/** Orders `major.minor.patch[-label]` like compareFwVersions in iot-protocol; -2 when either is malformed. */
int compareVersions(const char* a, const char* b);

bool parseManifest(const char* json, size_t len, Manifest* out, const char** error);

/** Ed25519 check of `factoryos-mt1|{version}|{size}|{sha256}` against the public key compiled into the firmware. */
bool verifyManifest(const Manifest& m, const uint8_t publicKey[32]);

/**
 * Whether to install a verified build: only a newer version, and a development build (`-dev`, signed with the test
 * key) only takes development versions, a release build only release versions.
 */
bool wantUpdate(const Manifest& m, const char* running, const char** why);

/** Decodes standard base64 into exactly `n` bytes. */
bool base64Decode(const char* in, uint8_t* out, size_t n);

}  // namespace tapcore
