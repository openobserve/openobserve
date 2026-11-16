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

use std::sync::atomic::{AtomicI64, Ordering};

use config::{
    Config, get_config, metrics,
    utils::{rand::get_rand_num_within, size::bytes_to_human_readable, time::now_micros},
};

use crate::errors::{Error, Result};

const RETRY_AFTER_SECS: u64 = 5;
const RETRY_AFTER_JITTER_SECS: u64 = 5;

/// Trip time in microseconds, 0 while the breaker is closed.
static TRIPPED_AT: AtomicI64 = AtomicI64::new(0);

/// The memory limits one sample is judged against, in bytes of RSS.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Limits {
    trip: usize,
    release: usize,
    ratio: usize,
    release_ratio: usize,
}

impl Limits {
    /// None while the breaker is disabled.
    fn from_config(cfg: &Config) -> Option<Self> {
        let ratio = cfg.common.memory_circuit_breaker_ratio;
        if !cfg.common.memory_circuit_breaker_enabled || ratio == 0 {
            return None;
        }
        let release_ratio = cfg.common.memory_circuit_breaker_release_ratio;
        Some(Self {
            trip: cfg.limit.mem_total / 100 * ratio,
            release: cfg.limit.mem_total / 100 * release_ratio,
            ratio,
            release_ratio,
        })
    }

    fn error(&self, rss: usize) -> Error {
        Error::MemoryCircuitBreakerError {
            rss,
            trip: self.trip,
            release: self.release,
            ratio: self.ratio,
            release_ratio: self.release_ratio,
        }
    }
}

/// Rejects the request while the breaker is tripped; one atomic load when it is not.
pub fn check_memory_circuit_breaker() -> Result<()> {
    if TRIPPED_AT.load(Ordering::Relaxed) == 0 {
        return Ok(());
    }
    match Limits::from_config(&get_config()) {
        Some(limits) => Err(limits.error(current_rss())),
        None => Ok(()),
    }
}

/// Seconds a refused client should wait before retrying, None while the breaker is closed.
pub fn memory_circuit_breaker_retry_after() -> Option<u64> {
    (TRIPPED_AT.load(Ordering::Relaxed) != 0).then(retry_after_secs)
}

/// Judges one memory sample and records a trip or a release; only the memory sampler calls it.
pub fn update_memory_circuit_breaker(rss: usize) {
    let limits = Limits::from_config(&get_config());
    let now = now_micros();
    let tripped_at = TRIPPED_AT.load(Ordering::Relaxed);
    let next = limits.map_or(0, |limits| next_tripped_at(tripped_at, rss, &limits, now));
    // Both series are written every sample so they exist before the first trip.
    metrics::MEMORY_CIRCUIT_BREAKER_TRIPPED
        .with_label_values::<&str>(&[])
        .set(i64::from(next != 0));
    let trips = metrics::MEMORY_CIRCUIT_BREAKER_TRIPS.with_label_values::<&str>(&[]);
    if next == tripped_at {
        return;
    }
    TRIPPED_AT.store(next, Ordering::Relaxed);
    match limits {
        Some(limits) if next != 0 => {
            trips.inc();
            log::warn!(
                "[INGESTER] memory circuit breaker tripped: {}",
                limits.error(rss)
            );
        }
        _ => {
            log::info!(
                "[INGESTER] memory circuit breaker released after {}s, memory usage {}",
                (now - tripped_at) / 1_000_000,
                bytes_to_human_readable(rss as f64)
            );
        }
    }
}

fn current_rss() -> usize {
    metrics::NODE_MEMORY_USAGE
        .with_label_values::<&str>(&[])
        .get() as usize
}

/// The trip time after judging `rss` at `now`: trips above `trip`, releases below `release`.
fn next_tripped_at(tripped_at: i64, rss: usize, limits: &Limits, now: i64) -> i64 {
    if tripped_at == 0 {
        if rss > limits.trip { now } else { 0 }
    } else if rss < limits.release {
        0
    } else {
        tripped_at
    }
}

/// Jittered so the clients refused during one trip do not all retry at the same moment.
fn retry_after_secs() -> u64 {
    get_rand_num_within(
        RETRY_AFTER_SECS,
        RETRY_AFTER_SECS + RETRY_AFTER_JITTER_SECS + 1,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: usize = 1024 * 1024 * 1024;
    const SEC: i64 = 1_000_000;

    fn limits() -> Limits {
        Limits {
            trip: 9 * GIB,
            release: 8 * GIB,
            ratio: 90,
            release_ratio: 80,
        }
    }

    #[test]
    fn test_next_tripped_at() {
        let t0 = 1_000 * SEC;
        for (name, tripped_at, rss, now, expected) in [
            ("closed at the trip limit stays closed", 0, 9 * GIB, t0, 0),
            ("closed above the trip limit trips", 0, 9 * GIB + 1, t0, t0),
            (
                "below release releases on the next sample",
                t0,
                8 * GIB - 1,
                t0 + SEC,
                0,
            ),
            (
                "at the release limit stays tripped",
                t0,
                8 * GIB,
                t0 + 600 * SEC,
                t0,
            ),
            (
                "between the limits stays tripped",
                t0,
                8 * GIB + 1,
                t0 + 600 * SEC,
                t0,
            ),
            (
                "above the trip limit keeps the first trip time",
                t0,
                10 * GIB,
                t0 + SEC,
                t0,
            ),
        ] {
            assert_eq!(
                next_tripped_at(tripped_at, rss, &limits(), now),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn test_a_cycle_needs_a_full_swing_across_the_gap() {
        let mut tripped_at = 0;
        let mut states = vec![];
        for (second, rss) in [100, 85, 95, 85, 70, 85, 89, 95].into_iter().enumerate() {
            let now = (second as i64 + 1) * SEC;
            tripped_at = next_tripped_at(tripped_at, rss * GIB / 10, &limits(), now);
            states.push(tripped_at != 0);
        }
        assert_eq!(states, [true, true, true, true, false, false, false, true]);
    }

    #[test]
    fn test_limits_from_config() {
        let mut cfg = Config::default();
        cfg.limit.mem_total = 100 * GIB;
        cfg.common.memory_circuit_breaker_ratio = 90;
        cfg.common.memory_circuit_breaker_release_ratio = 80;
        assert_eq!(Limits::from_config(&cfg), None);

        cfg.common.memory_circuit_breaker_enabled = true;
        assert_eq!(
            Limits::from_config(&cfg),
            Some(Limits {
                trip: 90 * GIB,
                release: 80 * GIB,
                ratio: 90,
                release_ratio: 80,
            })
        );

        cfg.common.memory_circuit_breaker_ratio = 0;
        assert_eq!(Limits::from_config(&cfg), None);
    }

    #[test]
    fn test_error_names_usage_and_limits() {
        let message = limits().error(9 * GIB + GIB / 2).to_string();
        assert_eq!(
            message,
            "MemoryCircuitBreakerError: memory usage 9.50 GB, trips above 9.00 GB (90% of total), \
             releases below 8.00 GB (80%)"
        );
    }
}
