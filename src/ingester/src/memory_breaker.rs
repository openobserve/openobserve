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
    utils::{size::bytes_to_human_readable, time::now_micros},
};

use crate::errors::{Error, Result};

const MIN_TRIP_HOLD_MICROS: i64 = 30_000_000;

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

/// Seconds until a tripped breaker can release at the earliest, None while it is closed.
pub fn memory_circuit_breaker_retry_after() -> Option<u64> {
    let tripped_at = TRIPPED_AT.load(Ordering::Relaxed);
    (tripped_at != 0).then(|| retry_after_secs(tripped_at, now_micros()))
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

/// The trip time after judging `rss` at `now`: trips above `trip`, releases below `release`
/// once the trip is at least `MIN_TRIP_HOLD_MICROS` old.
fn next_tripped_at(tripped_at: i64, rss: usize, limits: &Limits, now: i64) -> i64 {
    if tripped_at == 0 {
        return if rss > limits.trip { now } else { 0 };
    }
    if rss < limits.release && now - tripped_at >= MIN_TRIP_HOLD_MICROS {
        0
    } else {
        tripped_at
    }
}

fn retry_after_secs(tripped_at: i64, now: i64) -> u64 {
    let remaining = (tripped_at + MIN_TRIP_HOLD_MICROS - now).max(0) as u64;
    remaining.div_ceil(1_000_000).max(1)
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
        let hold = MIN_TRIP_HOLD_MICROS;
        for (name, tripped_at, rss, now, expected) in [
            ("closed at the trip limit stays closed", 0, 9 * GIB, t0, 0),
            ("closed above the trip limit trips", 0, 9 * GIB + 1, t0, t0),
            (
                "below release inside the hold stays tripped",
                t0,
                GIB,
                t0 + hold - 1,
                t0,
            ),
            (
                "below release after the hold releases",
                t0,
                8 * GIB - 1,
                t0 + hold,
                0,
            ),
            (
                "at the release limit stays tripped",
                t0,
                8 * GIB,
                t0 + 10 * hold,
                t0,
            ),
            (
                "between the limits stays tripped",
                t0,
                8 * GIB + 1,
                t0 + 10 * hold,
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
    fn test_no_flapping_at_the_trip_limit() {
        // RSS swings across the trip limit every second, never down to the release limit.
        let mut tripped_at = 0;
        let mut trips = 0;
        for second in 0..600 {
            let rss = if second % 2 == 0 {
                9 * GIB + 1
            } else {
                9 * GIB - 1
            };
            let next = next_tripped_at(tripped_at, rss, &limits(), (second + 1) * SEC);
            trips += i32::from(tripped_at == 0 && next != 0);
            tripped_at = next;
        }
        assert_eq!(trips, 1);
        assert_ne!(tripped_at, 0);
    }

    #[test]
    fn test_no_cycle_shorter_than_the_hold() {
        // Worst case: RSS swings between above-trip and below-release every second.
        let mut tripped_at = 0;
        let mut transitions = vec![];
        for second in 0..600 {
            let rss = if second % 2 == 0 { 10 * GIB } else { GIB };
            let now = (second + 1) * SEC;
            let next = next_tripped_at(tripped_at, rss, &limits(), now);
            if next != tripped_at {
                transitions.push((now, next != 0));
            }
            tripped_at = next;
        }
        assert!(transitions.len() > 2, "{transitions:?}");
        for pair in transitions.windows(2) {
            let ((tripped, true), (released, false)) = (pair[0], pair[1]) else {
                continue;
            };
            assert!(released - tripped >= MIN_TRIP_HOLD_MICROS, "{pair:?}");
        }
    }

    #[test]
    fn test_retry_after_secs_counts_down_the_hold() {
        let t0 = 1_000 * SEC;
        assert_eq!(retry_after_secs(t0, t0), 30);
        assert_eq!(retry_after_secs(t0, t0 + SEC / 2), 30);
        assert_eq!(retry_after_secs(t0, t0 + 29 * SEC), 1);
        assert_eq!(retry_after_secs(t0, t0 + 300 * SEC), 1);
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
