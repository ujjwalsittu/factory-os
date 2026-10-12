#include "tapcore.h"

namespace tapcore {

const char* stateName(State s) {
  switch (s) {
    case State::Off: return "off";
    case State::Idle: return "idle";
    case State::Setup: return "setup";
    case State::Running: return "running";
    case State::Alarm: return "alarm";
  }
  return "off";
}

static bool lit(const Config& c, const Lights& l, Meaning m) {
  return (l.red && c.red == m) || (l.amber && c.amber == m) || (l.green && c.green == m);
}

State classify(const Config& c, float amps, const Lights& l) {
  if (amps < c.offAmps) return State::Off;
  if (lit(c, l, Meaning::Alarm)) return State::Alarm;
  if (amps >= c.runAmps || lit(c, l, Meaning::Running)) return State::Running;
  if (lit(c, l, Meaning::Setup)) return State::Setup;
  return State::Idle;
}

bool Classifier::update(const Config& c, uint32_t nowMs, float amps, const Lights& l, State* changedTo) {
  const State raw = classify(c, amps, l);
  if (known_ && raw == current_) {
    pending_ = false;
    return false;
  }
  if (!pending_ || raw != candidate_) {
    pending_ = true;
    candidate_ = raw;
    since_ = nowMs;
  }
  // Unsigned subtraction stays right across the millis() wrap.
  if (nowMs - since_ < c.debounceSeconds * 1000u) return false;
  known_ = true;
  current_ = raw;
  pending_ = false;
  if (changedTo) *changedTo = raw;
  return true;
}

}  // namespace tapcore
