#include "tapcore.h"

namespace tapcore {

bool Sequence::begin(SeqStore* store) {
  store_ = store;
  uint64_t hw = 0;
  if (!store_->load(&hw)) hw = 0;
  next_ = hw;
  highWater_ = 0;  // reserve on the first take, so a tap that never publishes never writes flash
  return true;
}

uint64_t Sequence::take() {
  if (next_ >= highWater_) {
    const uint64_t hw = next_ + SEQ_BLOCK;
    if (!store_ || !store_->save(hw)) return 0;
    highWater_ = hw;
  }
  // Seq 0 is reserved for "failed", so a fresh tap starts at 1.
  if (next_ == 0) next_ = 1;
  return next_++;
}

bool Outbox::begin(RecordStore* store) {
  store_ = store;
  dropped_ = 0;
  if (!store_->loadHeader(&head_, &count_) || head_ >= store_->capacity() || count_ > store_->capacity()) {
    head_ = 0;
    count_ = 0;
    return store_->saveHeader(0, 0);
  }
  return true;
}

bool Outbox::push(const Event& e) {
  const uint32_t cap = store_->capacity();
  if (count_ == cap) {
    // Find the oldest heartbeat and close the gap by moving the older state changes up one slot.
    uint32_t victim = 0;
    Event x;
    for (uint32_t i = 0; i < count_; i++) {
      if (store_->read(slot(i), &x) && x.heartbeat) {
        victim = i;
        break;
      }
    }
    for (uint32_t j = victim; j > 0; j--) {
      if (!store_->read(slot(j - 1), &x) || !store_->write(slot(j), x)) return false;
    }
    head_ = (head_ + 1) % cap;
    count_--;
    dropped_++;
  }
  if (!store_->write(slot(count_), e)) return false;
  count_++;
  return store_->saveHeader(head_, count_);
}

bool Outbox::front(Event* e) {
  return count_ > 0 && store_->read(head_, e);
}

void Outbox::ack(uint64_t seq) {
  Event f;
  if (!front(&f) || f.seq != seq) return;
  head_ = (head_ + 1) % store_->capacity();
  count_--;
  store_->saveHeader(head_, count_);
}

}  // namespace tapcore
