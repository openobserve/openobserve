// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Bounded, process-local, in-memory queue backend (`ZO_QUEUE_STORE=memory`).
//!
//! Contract highlights (see `docs/IN_MEMORY_QUEUE_SPEC.md` for the full
//! specification):
//! - one process scope, no durability: all state is lost on exit;
//! - at-least-once delivery within the process lifetime, FIFO for first delivery only;
//! - a single global accounted-memory budget across all topics; over-limit publication is rejected,
//!   unacknowledged messages are never evicted;
//! - one active consumer per topic; unacknowledged messages are redelivered after message drop,
//!   receiver loss, or a fixed visibility timeout.

use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use bytes::Bytes;
use config::metrics;
use parking_lot::{Mutex, MutexGuard};
use tokio::{
    sync::{Notify, mpsc},
    time::Instant,
};

use super::{DeliverPolicy, QueueConfig, StorageType, format_key};
use crate::errors::{QueueError, Result};

/// Fixed accounting overhead charged for every entry in addition to its
/// payload bytes: sequence, timestamps, ack state, deque/map nodes, and
/// shared-pointer metadata. Empty payloads therefore still consume budget.
const ENTRY_ACCOUNTING_OVERHEAD_BYTES: u64 = 128;
/// Fixed accounting overhead charged for every topic in addition to its
/// normalized name length.
const TOPIC_ACCOUNTING_OVERHEAD_BYTES: u64 = 256;
/// Visibility timeout for in-flight messages. Matches the effective default
/// `ack_wait` of the NATS consumer configuration; intentionally not a user
/// configuration in v1.
const VISIBILITY_TIMEOUT: Duration = Duration::from_secs(30);
/// Interval of the maintenance loop (expiration and visibility timeouts).
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(1);
/// How long a pull consumer waits for a message before returning `None`.
/// Matches the batch-request expiry of the NATS pull consumer.
const PULL_WAIT: Duration = Duration::from_secs(30);
/// Delivery channel capacity, same as the NATS backend.
const CHANNEL_CAPACITY: usize = 1024;
/// Metric label for this backend.
const BACKEND_LABEL: &str = "memory";

pub struct MemoryQueue {
    shared: Arc<Shared>,
}

impl MemoryQueue {
    /// Create a queue with the given global accounted-byte limit.
    ///
    /// Must be called from within a Tokio runtime: it spawns the maintenance
    /// task that enforces `max_age` expiration and visibility timeouts.
    pub fn new(limit_bytes: u64) -> Self {
        let shared = Arc::new(Shared {
            limit_bytes,
            inner: Mutex::new(Inner::default()),
        });
        metrics::QUEUE_MEMORY_LIMIT_BYTES
            .with_label_values(&[BACKEND_LABEL])
            .set(limit_bytes.min(i64::MAX as u64) as i64);
        spawn_maintenance(Arc::downgrade(&shared));
        Self { shared }
    }

    pub fn limit_bytes(&self) -> u64 {
        self.shared.limit_bytes
    }

    #[cfg(test)]
    fn used_bytes(&self) -> u64 {
        self.shared.lock_inner().used_bytes
    }
}

impl Default for MemoryQueue {
    fn default() -> Self {
        let cfg = config::get_config();
        // already converted from MB to bytes during config validation
        Self::new(cfg.common.memory_queue_max_size as u64)
    }
}

struct Shared {
    limit_bytes: u64,
    inner: Mutex<Inner>,
}

impl Shared {
    fn lock_inner(&self) -> MutexGuard<'_, Inner> {
        // the lock is never held across an await point
        self.inner.lock()
    }
}

#[derive(Default)]
struct Inner {
    used_bytes: u64,
    next_token: u64,
    topics: HashMap<String, Topic>,
}

struct Topic {
    config: QueueConfig,
    next_sequence: u64,
    next_generation: u64,
    pending: VecDeque<Entry>,
    in_flight: HashMap<u64, InFlight>,
    consumer: Option<Consumer>,
}

struct Entry {
    sequence: u64,
    payload: Bytes,
    /// Original publication time; `max_age` is measured from here even after
    /// redelivery.
    published_at: Instant,
    accounted_bytes: u64,
    deliveries: u32,
}

struct InFlight {
    entry: Entry,
    /// Unique delivery token; a stale ack carrying an older token must not
    /// remove a newer delivery attempt.
    token: u64,
    delivered_at: Instant,
}

struct Consumer {
    generation: u64,
    tx: mpsc::Sender<super::Message>,
    notify: Arc<Notify>,
}

/// Acknowledgement handle for one delivery attempt of one message.
///
/// Dropping the handle without acknowledging schedules the message for
/// redelivery.
pub struct MemoryAckHandle {
    shared: Weak<Shared>,
    topic: Arc<str>,
    sequence: u64,
    token: u64,
    acked: AtomicBool,
}

impl MemoryAckHandle {
    /// Extend the visibility deadline for the current delivery attempt.
    pub(crate) fn progress(&self) {
        if self.acked.load(Ordering::SeqCst) {
            return;
        }
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let mut inner = shared.lock_inner();
        let Some(topic) = inner.topics.get_mut(self.topic.as_ref()) else {
            return;
        };
        if let Some(in_flight) = topic.in_flight.get_mut(&self.sequence)
            && in_flight.token == self.token
        {
            in_flight.delivered_at = Instant::now();
        }
    }

    /// Idempotent: a second ack, or an ack racing with expiration, timeout
    /// redelivery, or topic removal, is a successful no-op.
    pub(crate) fn ack(&self) {
        if self.acked.swap(true, Ordering::SeqCst) {
            return;
        }
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let mut inner = shared.lock_inner();
        let released = {
            let Some(topic) = inner.topics.get_mut(self.topic.as_ref()) else {
                return;
            };
            match topic.in_flight.get(&self.sequence) {
                Some(inf) if inf.token == self.token => {
                    let inf = topic.in_flight.remove(&self.sequence).unwrap();
                    Some(inf.entry.accounted_bytes)
                }
                // stale ack: the entry was requeued, expired, or re-delivered
                _ => None,
            }
        };
        if let Some(bytes) = released {
            inner.used_bytes = inner.used_bytes.saturating_sub(bytes);
            update_gauges(&inner);
        }
    }
}

impl Drop for MemoryAckHandle {
    fn drop(&mut self) {
        if self.acked.load(Ordering::SeqCst) {
            return;
        }
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let mut inner = shared.lock_inner();
        let Some(topic) = inner.topics.get_mut(self.topic.as_ref()) else {
            return;
        };
        let current = matches!(
            topic.in_flight.get(&self.sequence),
            Some(inf) if inf.token == self.token
        );
        if current {
            // requeue for redelivery; the budget charge moves with the entry
            let inf = topic.in_flight.remove(&self.sequence).unwrap();
            topic.pending.push_back(inf.entry);
            metrics::QUEUE_REDELIVERY_TOTAL
                .with_label_values(&[self.topic.as_ref(), "dropped"])
                .inc();
            if let Some(consumer) = &topic.consumer {
                consumer.notify.notify_one();
            }
        }
    }
}

/// Pull consumer over the in-memory queue.
///
/// Messages stay in the topic's pending deque until [`Self::next`] hands them
/// to the caller, so the visibility timeout only starts at actual delivery —
/// there is no channel buffering messages ahead of the consumer.
pub struct MemoryPullConsumer {
    shared: Arc<Shared>,
    topic: Arc<str>,
    generation: u64,
    notify: Arc<Notify>,
    /// Occupies the topic's consumer slot: dropping this receiver closes the
    /// slot's sender so a new consumer can attach.
    _liveness: mpsc::Receiver<super::Message>,
}

impl MemoryPullConsumer {
    pub(crate) fn ack_wait(&self) -> Duration {
        VISIBILITY_TIMEOUT
    }

    pub(crate) async fn next(&mut self) -> Result<Option<super::Message>> {
        let deadline = Instant::now() + PULL_WAIT;
        loop {
            if let Some(message) = self.try_next()? {
                return Ok(Some(message));
            }
            // a permit stored by notify_one before we start waiting completes
            // the wait immediately, so a publish between the check above and
            // this await cannot be missed
            if tokio::time::timeout_at(deadline, self.notify.notified())
                .await
                .is_err()
            {
                return Ok(None);
            }
        }
    }

    fn try_next(&self) -> Result<Option<super::Message>> {
        let mut inner = self.shared.lock_inner();
        // reserve the token before borrowing the topic to keep the borrows disjoint
        inner.next_token += 1;
        let token = inner.next_token;
        let Some(topic_state) = inner.topics.get_mut(self.topic.as_ref()) else {
            return Err(QueueError::TopicNotFound(self.topic.to_string()).into());
        };
        if !topic_state
            .consumer
            .as_ref()
            .is_some_and(|c| c.generation == self.generation)
        {
            return Err(QueueError::ConsumerAlreadyActive(self.topic.to_string()).into());
        }
        let Some(mut entry) = topic_state.pending.pop_front() else {
            return Ok(None);
        };
        entry.deliveries += 1;
        let sequence = entry.sequence;
        let payload = entry.payload.clone();
        // insert into in_flight before returning so an ack can never miss the entry
        topic_state.in_flight.insert(
            sequence,
            InFlight {
                entry,
                token,
                delivered_at: Instant::now(),
            },
        );
        let handle = MemoryAckHandle {
            shared: Arc::downgrade(&self.shared),
            topic: self.topic.clone(),
            sequence,
            token,
            acked: AtomicBool::new(false),
        };
        Ok(Some(super::Message::from_memory(payload, handle)))
    }
}

#[async_trait]
impl super::Queue for MemoryQueue {
    async fn create(&self, topic: &str) -> Result<()> {
        self.create_with_config(topic, super::QueueConfigBuilder::new().build())
            .await
    }

    async fn create_with_config(&self, topic: &str, config: QueueConfig) -> Result<()> {
        let topic_key = format_key(topic);
        let mut inner = self.shared.lock_inner();
        if let Some(existing) = inner.topics.get(&topic_key) {
            if existing.config == config {
                return Ok(());
            }
            return Err(QueueError::TopicConfigConflict(topic_key).into());
        }
        let overhead = TOPIC_ACCOUNTING_OVERHEAD_BYTES.saturating_add(topic_key.len() as u64);
        if inner.used_bytes.saturating_add(overhead) > self.shared.limit_bytes {
            return Err(QueueError::QueueFull {
                requested_bytes: overhead,
                used_bytes: inner.used_bytes,
                limit_bytes: self.shared.limit_bytes,
            }
            .into());
        }
        if config.storage_type == StorageType::File {
            log::debug!(
                "queue backend=memory topic={topic_key} requested storage_type=file; data is kept in memory only and is not durable"
            );
        }
        inner.topics.insert(
            topic_key,
            Topic {
                config,
                next_sequence: 0,
                next_generation: 0,
                pending: VecDeque::new(),
                in_flight: HashMap::new(),
                consumer: None,
            },
        );
        inner.used_bytes += overhead;
        update_gauges(&inner);
        Ok(())
    }

    async fn publish(&self, topic: &str, value: Bytes) -> Result<()> {
        let topic_key = format_key(topic);
        let now = Instant::now();
        let limit = self.shared.limit_bytes;
        let mut inner = self.shared.lock_inner();
        if !inner.topics.contains_key(&topic_key) {
            return Err(QueueError::TopicNotFound(topic_key).into());
        }

        let Some(accounted) = (value.len() as u64).checked_add(ENTRY_ACCOUNTING_OVERHEAD_BYTES)
        else {
            metrics::QUEUE_PUBLISH_TOTAL
                .with_label_values(&[&topic_key, "rejected_too_large"])
                .inc();
            return Err(QueueError::MessageTooLarge {
                requested_bytes: u64::MAX,
                limit_bytes: limit,
            }
            .into());
        };
        if accounted > limit {
            metrics::QUEUE_PUBLISH_TOTAL
                .with_label_values(&[&topic_key, "rejected_too_large"])
                .inc();
            return Err(QueueError::MessageTooLarge {
                requested_bytes: accounted,
                limit_bytes: limit,
            }
            .into());
        }
        if inner.used_bytes.saturating_add(accounted) > limit {
            // lazy sweep: only when capacity is short, reclaim expired
            // entries (from every topic, the budget is global) so a queue
            // full of expired garbage cannot reject a valid publication; the
            // happy path stays O(1) and routine expiration is handled by the
            // maintenance loop
            let mut released = 0u64;
            let keys: Vec<String> = inner.topics.keys().cloned().collect();
            for key in keys {
                let topic_state = inner.topics.get_mut(&key).unwrap();
                released += sweep_expired(topic_state, &key, now);
            }
            inner.used_bytes = inner.used_bytes.saturating_sub(released);
        }
        if inner.used_bytes.saturating_add(accounted) > limit {
            metrics::QUEUE_PUBLISH_TOTAL
                .with_label_values(&[&topic_key, "rejected_full"])
                .inc();
            return Err(QueueError::QueueFull {
                requested_bytes: accounted,
                used_bytes: inner.used_bytes,
                limit_bytes: limit,
            }
            .into());
        }

        let topic_state = inner.topics.get_mut(&topic_key).unwrap();
        topic_state.next_sequence += 1;
        topic_state.pending.push_back(Entry {
            sequence: topic_state.next_sequence,
            payload: value,
            published_at: now,
            accounted_bytes: accounted,
            deliveries: 0,
        });
        if let Some(consumer) = &topic_state.consumer {
            consumer.notify.notify_one();
        }
        inner.used_bytes += accounted;
        metrics::QUEUE_PUBLISH_TOTAL
            .with_label_values(&[&topic_key, "accepted"])
            .inc();
        update_gauges(&inner);
        Ok(())
    }

    async fn consume(
        &self,
        topic: &str,
        deliver_policy: Option<DeliverPolicy>,
    ) -> Result<Arc<mpsc::Receiver<super::Message>>> {
        let topic_key: Arc<str> = format_key(topic).into();
        let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
        let notify = Arc::new(Notify::new());
        let generation;
        {
            let mut inner = self.shared.lock_inner();
            let Some(topic_state) = inner.topics.get_mut(topic_key.as_ref()) else {
                return Err(QueueError::TopicNotFound(topic_key.to_string()).into());
            };
            if topic_state
                .consumer
                .as_ref()
                .is_some_and(|c| !c.tx.is_closed())
            {
                return Err(QueueError::ConsumerAlreadyActive(topic_key.to_string()).into());
            }
            // the default NATS deliver policy is All; keep the same default
            // here without introducing another configuration value
            let released =
                apply_deliver_policy(topic_state, deliver_policy.unwrap_or(DeliverPolicy::All));
            topic_state.next_generation += 1;
            generation = topic_state.next_generation;
            topic_state.consumer = Some(Consumer {
                generation,
                tx: tx.clone(),
                notify: notify.clone(),
            });
            if !topic_state.pending.is_empty() {
                notify.notify_one();
            }
            inner.used_bytes = inner.used_bytes.saturating_sub(released);
            update_gauges(&inner);
        }
        tokio::spawn(dispatch_loop(
            self.shared.clone(),
            topic_key,
            generation,
            tx,
            notify,
        ));
        Ok(Arc::new(rx))
    }

    async fn pull_consume(
        &self,
        topic: &str,
        // group is meaningful for distributed backends; a process-local queue
        // has exactly one consumer per topic, so it is ignored here
        _group: &str,
        deliver_policy: Option<DeliverPolicy>,
    ) -> Result<super::PullConsumer> {
        let topic_key: Arc<str> = format_key(topic).into();
        // the sender occupies the consumer slot; the receiver only signals
        // liveness (dropping the pull consumer closes it, freeing the slot)
        let (tx, rx) = mpsc::channel(1);
        let notify = Arc::new(Notify::new());
        let generation;
        {
            let mut inner = self.shared.lock_inner();
            let Some(topic_state) = inner.topics.get_mut(topic_key.as_ref()) else {
                return Err(QueueError::TopicNotFound(topic_key.to_string()).into());
            };
            if topic_state
                .consumer
                .as_ref()
                .is_some_and(|c| !c.tx.is_closed())
            {
                return Err(QueueError::ConsumerAlreadyActive(topic_key.to_string()).into());
            }
            let released =
                apply_deliver_policy(topic_state, deliver_policy.unwrap_or(DeliverPolicy::All));
            topic_state.next_generation += 1;
            generation = topic_state.next_generation;
            topic_state.consumer = Some(Consumer {
                generation,
                tx,
                notify: notify.clone(),
            });
            inner.used_bytes = inner.used_bytes.saturating_sub(released);
            update_gauges(&inner);
        }
        Ok(super::PullConsumer::from_memory(MemoryPullConsumer {
            shared: self.shared.clone(),
            topic: topic_key,
            generation,
            notify,
            _liveness: rx,
        }))
    }

    async fn purge(&self, _topic: &str, _sequence: usize) -> Result<()> {
        // same no-op behavior as the NATS backend; sequence-based purge
        // semantics require a separate specification
        Ok(())
    }
}

// the step value is transient, so the size difference between variants is fine
#[allow(clippy::large_enum_variant)]
enum DispatchStep {
    Deliver(super::Message),
    Wait,
    Exit,
}

async fn dispatch_loop(
    shared: Arc<Shared>,
    topic_key: Arc<str>,
    generation: u64,
    tx: mpsc::Sender<super::Message>,
    notify: Arc<Notify>,
) {
    loop {
        match next_delivery(&shared, &topic_key, generation, &tx) {
            DispatchStep::Exit => break,
            DispatchStep::Wait => {
                tokio::select! {
                    _ = notify.notified() => {}
                    _ = tx.closed() => {}
                }
            }
            DispatchStep::Deliver(message) => {
                if tx.send(message).await.is_err() {
                    // receiver gone; the returned message is dropped here and
                    // its ack-handle Drop requeues the entry
                    break;
                }
            }
        }
    }
    // free the consumer slot if it is still ours so a new receiver can attach
    let mut inner = shared.lock_inner();
    if let Some(topic_state) = inner.topics.get_mut(topic_key.as_ref())
        && topic_state
            .consumer
            .as_ref()
            .is_some_and(|c| c.generation == generation)
    {
        topic_state.consumer = None;
    }
}

fn next_delivery(
    shared: &Arc<Shared>,
    topic_key: &Arc<str>,
    generation: u64,
    tx: &mpsc::Sender<super::Message>,
) -> DispatchStep {
    let mut inner = shared.lock_inner();
    // reserve the token before borrowing the topic to keep the borrows disjoint
    inner.next_token += 1;
    let token = inner.next_token;
    let Some(topic_state) = inner.topics.get_mut(topic_key.as_ref()) else {
        return DispatchStep::Exit;
    };
    if !topic_state
        .consumer
        .as_ref()
        .is_some_and(|c| c.generation == generation)
    {
        return DispatchStep::Exit;
    }
    if tx.is_closed() {
        return DispatchStep::Exit;
    }
    let Some(mut entry) = topic_state.pending.pop_front() else {
        return DispatchStep::Wait;
    };
    entry.deliveries += 1;
    let sequence = entry.sequence;
    let payload = entry.payload.clone();
    // insert into in_flight before sending so an ack can never miss the entry
    topic_state.in_flight.insert(
        sequence,
        InFlight {
            entry,
            token,
            delivered_at: Instant::now(),
        },
    );
    let handle = MemoryAckHandle {
        shared: Arc::downgrade(shared),
        topic: topic_key.clone(),
        sequence,
        token,
        acked: AtomicBool::new(false),
    };
    DispatchStep::Deliver(super::Message::from_memory(payload, handle))
}

/// Discard historical backlog according to the deliver policy and return the
/// released accounted bytes. Entries that were already delivered once
/// (requeued from a prior receiver) are not considered historical backlog.
fn apply_deliver_policy(topic: &mut Topic, policy: DeliverPolicy) -> u64 {
    let mut released = 0u64;
    match policy {
        DeliverPolicy::All => {}
        DeliverPolicy::Last => {
            let newest_fresh = topic
                .pending
                .iter()
                .filter(|e| e.deliveries == 0)
                .map(|e| e.sequence)
                .max();
            topic.pending.retain(|e| {
                if e.deliveries == 0 && Some(e.sequence) != newest_fresh {
                    released += e.accounted_bytes;
                    false
                } else {
                    true
                }
            });
        }
        DeliverPolicy::New => {
            topic.pending.retain(|e| {
                if e.deliveries == 0 {
                    released += e.accounted_bytes;
                    false
                } else {
                    true
                }
            });
        }
    }
    released
}

/// Remove entries whose age exceeds the topic `max_age` (measured from the
/// original publication time) and return the released accounted bytes.
fn sweep_expired(topic: &mut Topic, topic_key: &str, now: Instant) -> u64 {
    let Some(max_age) = topic.config.max_age else {
        return 0;
    };
    let mut released = 0u64;
    topic.pending.retain(|e| {
        if now.duration_since(e.published_at) >= max_age {
            released += e.accounted_bytes;
            metrics::QUEUE_MESSAGE_EXPIRED_TOTAL
                .with_label_values(&[topic_key, "pending"])
                .inc();
            false
        } else {
            true
        }
    });
    let expired: Vec<u64> = topic
        .in_flight
        .iter()
        .filter(|(_, inf)| now.duration_since(inf.entry.published_at) >= max_age)
        .map(|(seq, _)| *seq)
        .collect();
    for seq in expired {
        let inf = topic.in_flight.remove(&seq).unwrap();
        released += inf.entry.accounted_bytes;
        metrics::QUEUE_MESSAGE_EXPIRED_TOTAL
            .with_label_values(&[topic_key, "in_flight"])
            .inc();
    }
    released
}

/// Requeue in-flight entries whose visibility timeout has expired.
fn requeue_timed_out(topic: &mut Topic, topic_key: &str, now: Instant) {
    let timed_out: Vec<u64> = topic
        .in_flight
        .iter()
        .filter(|(_, inf)| now.duration_since(inf.delivered_at) >= VISIBILITY_TIMEOUT)
        .map(|(seq, _)| *seq)
        .collect();
    if timed_out.is_empty() {
        return;
    }
    for seq in timed_out {
        let inf = topic.in_flight.remove(&seq).unwrap();
        // a redelivered message goes behind already-pending messages so one
        // poison message cannot permanently block the topic
        topic.pending.push_back(inf.entry);
        metrics::QUEUE_REDELIVERY_TOTAL
            .with_label_values(&[topic_key, "timeout"])
            .inc();
    }
    if let Some(consumer) = &topic.consumer {
        consumer.notify.notify_one();
    }
}

fn update_gauges(inner: &Inner) {
    metrics::QUEUE_MEMORY_USED_BYTES
        .with_label_values(&[BACKEND_LABEL])
        .set(inner.used_bytes.min(i64::MAX as u64) as i64);
    for (topic_key, topic) in &inner.topics {
        metrics::QUEUE_MESSAGES
            .with_label_values(&[topic_key, "pending"])
            .set(topic.pending.len() as i64);
        metrics::QUEUE_MESSAGES
            .with_label_values(&[topic_key, "in_flight"])
            .set(topic.in_flight.len() as i64);
    }
}

fn spawn_maintenance(shared: Weak<Shared>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(MAINTENANCE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Some(shared) = shared.upgrade() else {
                // the queue was dropped, stop the maintenance loop
                break;
            };
            run_maintenance(&shared);
        }
    });
}

fn run_maintenance(shared: &Shared) {
    let now = Instant::now();
    let mut inner = shared.lock_inner();
    let topic_keys: Vec<String> = inner.topics.keys().cloned().collect();
    let mut total_released = 0u64;
    for topic_key in topic_keys {
        let oldest = {
            let topic_state = inner.topics.get_mut(&topic_key).unwrap();
            total_released += sweep_expired(topic_state, &topic_key, now);
            requeue_timed_out(topic_state, &topic_key, now);
            topic_state
                .pending
                .iter()
                .map(|e| e.published_at)
                .chain(topic_state.in_flight.values().map(|f| f.entry.published_at))
                .min()
        };
        let age_secs = oldest.map_or(0, |t| now.duration_since(t).as_secs());
        metrics::QUEUE_OLDEST_MESSAGE_AGE_SECONDS
            .with_label_values(&[&topic_key])
            .set(age_secs.min(i64::MAX as u64) as i64);
    }
    inner.used_bytes = inner.used_bytes.saturating_sub(total_released);
    update_gauges(&inner);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{errors::Error, queue::Queue};

    const TOPIC: &str = "test_topic";

    fn topic_overhead(topic: &str) -> u64 {
        TOPIC_ACCOUNTING_OVERHEAD_BYTES + format_key(topic).len() as u64
    }

    fn entry_bytes(payload_len: usize) -> u64 {
        payload_len as u64 + ENTRY_ACCOUNTING_OVERHEAD_BYTES
    }

    async fn recv_one(rx: &mut mpsc::Receiver<super::super::Message>) -> super::super::Message {
        tokio::time::timeout(Duration::from_millis(200), rx.recv())
            .await
            .expect("expected a message before timeout")
            .expect("channel closed unexpectedly")
    }

    async fn expect_empty(rx: &mut mpsc::Receiver<super::super::Message>) {
        let res = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await;
        assert!(res.is_err(), "expected no message, but received one");
    }

    fn take_receiver(
        rx: Arc<mpsc::Receiver<super::super::Message>>,
    ) -> mpsc::Receiver<super::super::Message> {
        Arc::try_unwrap(rx).unwrap_or_else(|_| panic!("receiver Arc has multiple owners"))
    }

    fn assert_queue_error(err: Error, check: impl Fn(&QueueError) -> bool) {
        match err {
            Error::QueueError(e) => assert!(check(&e), "unexpected queue error: {e}"),
            other => panic!("expected QueueError, got: {other}"),
        }
    }

    #[tokio::test]
    async fn test_create_is_idempotent_for_same_config() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        let used = q.used_bytes();
        q.create(TOPIC).await.unwrap();
        // repeated creation charges the topic overhead only once
        assert_eq!(q.used_bytes(), used);
        assert_eq!(used, topic_overhead(TOPIC));
    }

    #[tokio::test]
    async fn test_create_with_conflicting_config_fails() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        let conflicting = super::super::QueueConfigBuilder::new()
            .max_age(Duration::from_secs(60))
            .build();
        let err = q.create_with_config(TOPIC, conflicting).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::TopicConfigConflict(_)));
    }

    #[tokio::test]
    async fn test_publish_and_consume_before_create_fail() {
        let q = MemoryQueue::new(1024 * 1024);
        let err = q
            .publish(TOPIC, Bytes::from_static(b"x"))
            .await
            .unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::TopicNotFound(_)));
        let err = q.consume(TOPIC, None).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::TopicNotFound(_)));
    }

    #[tokio::test(start_paused = true)]
    async fn test_fifo_first_delivery() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        for i in 0..5u8 {
            q.publish(TOPIC, Bytes::from(vec![i])).await.unwrap();
        }
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        for i in 0..5u8 {
            let msg = recv_one(&mut rx).await;
            assert_eq!(msg.message().as_ref(), &[i]);
            msg.ack().await.unwrap();
        }
    }

    #[tokio::test(start_paused = true)]
    async fn test_deliver_policy_all_replays_backlog() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"a")).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"b")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, Some(DeliverPolicy::All)).await.unwrap());
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"a");
        msg.ack().await.unwrap();
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"b");
        msg.ack().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn test_deliver_policy_last_keeps_newest_only() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"a")).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"b")).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"c")).await.unwrap();
        let used_before = q.used_bytes();
        let mut rx = take_receiver(q.consume(TOPIC, Some(DeliverPolicy::Last)).await.unwrap());
        // discarded messages release their accounting immediately
        assert_eq!(q.used_bytes(), used_before - 2 * entry_bytes(1));
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"c");
        msg.ack().await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"d")).await.unwrap();
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"d");
        msg.ack().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn test_deliver_policy_new_discards_backlog() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"a")).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"b")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, Some(DeliverPolicy::New)).await.unwrap());
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        expect_empty(&mut rx).await;
        q.publish(TOPIC, Bytes::from_static(b"c")).await.unwrap();
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"c");
        msg.ack().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn test_ack_releases_memory_once_and_double_ack_is_harmless() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"abc")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        let msg = recv_one(&mut rx).await;
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC) + entry_bytes(3));
        msg.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        msg.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        drop(msg);
        // an acked message is never redelivered
        expect_empty(&mut rx).await;
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test(start_paused = true)]
    async fn test_progress_extends_visibility_timeout() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        let first = recv_one(&mut rx).await;

        tokio::time::sleep(VISIBILITY_TIMEOUT - Duration::from_secs(1)).await;
        first.progress().await.unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
        expect_empty(&mut rx).await;

        tokio::time::sleep(VISIBILITY_TIMEOUT).await;
        let second = recv_one(&mut rx).await;
        assert_eq!(second.message().as_ref(), b"x");
        second.ack().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn test_double_ack_completes_message() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        let msg = recv_one(&mut rx).await;

        msg.double_ack().await.unwrap();

        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        drop(msg);
        expect_empty(&mut rx).await;
    }

    #[tokio::test(start_paused = true)]
    async fn test_dropped_unacked_message_is_redelivered() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        let msg = recv_one(&mut rx).await;
        drop(msg);
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"x");
        msg.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test(start_paused = true)]
    async fn test_visibility_timeout_redelivery_and_stale_ack() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        let first = recv_one(&mut rx).await;
        // exceed the visibility timeout while the first delivery is unacked
        tokio::time::sleep(VISIBILITY_TIMEOUT + Duration::from_secs(2)).await;
        let second = recv_one(&mut rx).await;
        assert_eq!(second.message().as_ref(), b"x");
        // the stale ack must not remove the newer delivery attempt
        first.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC) + entry_bytes(1));
        second.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test(start_paused = true)]
    async fn test_receiver_closure_requeues_in_flight() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"a")).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"b")).await.unwrap();
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        let msg = recv_one(&mut rx).await;
        assert_eq!(msg.message().as_ref(), b"a");
        // close the receiver without acking; both the held message and any
        // channel-buffered messages must be requeued
        drop(msg);
        drop(rx);
        tokio::task::yield_now().await;
        let mut rx = take_receiver(q.consume(TOPIC, Some(DeliverPolicy::All)).await.unwrap());
        let mut payloads = Vec::new();
        for _ in 0..2 {
            let msg = recv_one(&mut rx).await;
            payloads.push(msg.message().to_vec());
            msg.ack().await.unwrap();
        }
        payloads.sort();
        assert_eq!(payloads, vec![b"a".to_vec(), b"b".to_vec()]);
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test(start_paused = true)]
    async fn test_capacity_limits() {
        // room for the topic plus exactly two 10-byte messages
        let limit = topic_overhead(TOPIC) + 2 * entry_bytes(10);
        let q = MemoryQueue::new(limit);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from(vec![0u8; 10])).await.unwrap();
        // exact-limit publication is accepted
        q.publish(TOPIC, Bytes::from(vec![1u8; 10])).await.unwrap();
        assert_eq!(q.used_bytes(), limit);
        // one byte over the limit fails
        let err = q
            .publish(TOPIC, Bytes::from_static(b"x"))
            .await
            .unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::QueueFull { .. }));
        // a single message larger than the whole queue is a distinct error
        let big = vec![0u8; limit as usize + 1];
        let err = q.publish(TOPIC, Bytes::from(big)).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::MessageTooLarge { .. }));
        // rejection never evicts existing messages
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        for expected in [vec![0u8; 10], vec![1u8; 10]] {
            let msg = recv_one(&mut rx).await;
            assert_eq!(msg.message().as_ref(), &expected[..]);
            msg.ack().await.unwrap();
        }
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test]
    async fn test_multiple_topics_share_global_budget() {
        let limit = topic_overhead("t1") + topic_overhead("t2") + entry_bytes(10);
        let q = MemoryQueue::new(limit);
        q.create("t1").await.unwrap();
        q.create("t2").await.unwrap();
        q.publish("t1", Bytes::from(vec![0u8; 10])).await.unwrap();
        let err = q.publish("t2", Bytes::from_static(b"x")).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::QueueFull { .. }));
    }

    #[tokio::test]
    async fn test_empty_messages_consume_overhead() {
        let limit = topic_overhead(TOPIC) + 2 * entry_bytes(0);
        let q = MemoryQueue::new(limit);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::new()).await.unwrap();
        q.publish(TOPIC, Bytes::new()).await.unwrap();
        let err = q.publish(TOPIC, Bytes::new()).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::QueueFull { .. }));
    }

    #[tokio::test]
    async fn test_topic_creation_cannot_bypass_limit() {
        let limit = topic_overhead("t1");
        let q = MemoryQueue::new(limit);
        q.create("t1").await.unwrap();
        let err = q.create("t2").await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::QueueFull { .. }));
    }

    #[tokio::test(start_paused = true)]
    async fn test_publish_reclaims_expired_budget_when_full() {
        // room for the topic plus exactly two 10-byte messages
        let limit = topic_overhead(TOPIC) + 2 * entry_bytes(10);
        let q = MemoryQueue::new(limit);
        let config = super::super::QueueConfigBuilder::new()
            .max_age(Duration::from_secs(5))
            .build();
        q.create_with_config(TOPIC, config).await.unwrap();
        q.publish(TOPIC, Bytes::from(vec![0u8; 10])).await.unwrap();
        q.publish(TOPIC, Bytes::from(vec![1u8; 10])).await.unwrap();
        let err = q
            .publish(TOPIC, Bytes::from(vec![2u8; 10]))
            .await
            .unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::QueueFull { .. }));
        // once the backlog expires, its budget is reclaimed and the same
        // publication succeeds
        tokio::time::sleep(Duration::from_secs(6)).await;
        q.publish(TOPIC, Bytes::from(vec![2u8; 10])).await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC) + entry_bytes(10));
    }

    #[tokio::test(start_paused = true)]
    async fn test_max_age_expires_pending_and_in_flight() {
        let q = MemoryQueue::new(1024 * 1024);
        let config = super::super::QueueConfigBuilder::new()
            .max_age(Duration::from_secs(5))
            .build();
        q.create_with_config(TOPIC, config).await.unwrap();
        // pending expiration
        q.publish(TOPIC, Bytes::from_static(b"a")).await.unwrap();
        tokio::time::sleep(Duration::from_secs(6)).await;
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        let mut rx = take_receiver(q.consume(TOPIC, None).await.unwrap());
        expect_empty(&mut rx).await;
        // in-flight expiration measured from the original publication time
        q.publish(TOPIC, Bytes::from_static(b"b")).await.unwrap();
        let msg = recv_one(&mut rx).await;
        tokio::time::sleep(Duration::from_secs(6)).await;
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        // late ack after expiration is a harmless no-op
        msg.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
        expect_empty(&mut rx).await;
    }

    #[tokio::test(start_paused = true)]
    async fn test_second_active_consumer_fails_and_resubscribe_succeeds() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        let rx = q.consume(TOPIC, None).await.unwrap();
        let err = q.consume(TOPIC, None).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::ConsumerAlreadyActive(_)));
        drop(rx);
        tokio::task::yield_now().await;
        let rx = q.consume(TOPIC, None).await.unwrap();
        drop(rx);
    }

    #[tokio::test(start_paused = true)]
    async fn test_pull_consume_delivers_fifo_and_acks() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        for i in 0..3u8 {
            q.publish(TOPIC, Bytes::from(vec![i])).await.unwrap();
        }
        let mut consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();
        assert_eq!(consumer.ack_wait(), VISIBILITY_TIMEOUT);
        for i in 0..3u8 {
            let msg = consumer.next().await.unwrap().expect("expected a message");
            assert_eq!(msg.message().as_ref(), &[i]);
            msg.ack().await.unwrap();
        }
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test(start_paused = true)]
    async fn test_pull_consume_returns_none_when_empty() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        let mut consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();
        // mirrors the NATS batch expiry: an empty poll returns None
        assert!(consumer.next().await.unwrap().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn test_pull_consume_wakes_up_on_publish() {
        let q = Arc::new(MemoryQueue::new(1024 * 1024));
        q.create(TOPIC).await.unwrap();
        let mut consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();
        let publisher = {
            let q = Arc::clone(&q);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(1)).await;
                q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
            })
        };
        let msg = consumer.next().await.unwrap().expect("expected a message");
        assert_eq!(msg.message().as_ref(), b"x");
        msg.ack().await.unwrap();
        publisher.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn test_pull_consume_visibility_timeout_starts_at_delivery() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
        let mut consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();

        // the message waits far longer than the visibility timeout before the
        // consumer picks it up; a pull consumer must not count that as in-flight
        tokio::time::sleep(VISIBILITY_TIMEOUT * 3).await;
        let msg = consumer.next().await.unwrap().expect("expected a message");
        assert_eq!(msg.message().as_ref(), b"x");

        // now it is in flight: the timeout runs from the moment of delivery
        tokio::time::sleep(VISIBILITY_TIMEOUT + Duration::from_secs(1)).await;
        let redelivered = consumer.next().await.unwrap().expect("expected redelivery");
        assert_eq!(redelivered.message().as_ref(), b"x");
        redelivered.ack().await.unwrap();
        // the stale first handle acks into nothing
        msg.ack().await.unwrap();
        assert_eq!(q.used_bytes(), topic_overhead(TOPIC));
    }

    #[tokio::test(start_paused = true)]
    async fn test_pull_consume_unacked_drop_requeues() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        q.publish(TOPIC, Bytes::from_static(b"x")).await.unwrap();
        let mut consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();
        let msg = consumer.next().await.unwrap().expect("expected a message");
        drop(msg);
        let msg = consumer.next().await.unwrap().expect("expected redelivery");
        assert_eq!(msg.message().as_ref(), b"x");
        msg.ack().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn test_pull_consume_enforces_single_consumer_and_releases_slot() {
        let q = MemoryQueue::new(1024 * 1024);
        q.create(TOPIC).await.unwrap();
        let consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();
        let err = q.pull_consume(TOPIC, "group", None).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::ConsumerAlreadyActive(_)));
        let err = q.consume(TOPIC, None).await.unwrap_err();
        assert_queue_error(err, |e| matches!(e, QueueError::ConsumerAlreadyActive(_)));
        drop(consumer);
        let consumer = q.pull_consume(TOPIC, "group", None).await.unwrap();
        drop(consumer);
    }
}
