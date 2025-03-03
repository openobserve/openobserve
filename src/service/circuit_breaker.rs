// Copyright 2025 OpenObserve Inc.
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

use std::sync::{
    Arc, LazyLock,
    atomic::{AtomicI64, AtomicU64, Ordering},
};

use chrono::Utc;

const UPDATE_STATE_RETRY_TIMES: usize = 5;

static CIRCUIT_BREAKER: LazyLock<Arc<CircuitBreaker>> = LazyLock::new(|| {
    let cfg = config::get_config();
    CircuitBreaker::new(
        cfg.limit.circuit_breaker_watching_window,
        cfg.limit.circuit_breaker_reset_window_num,
        cfg.limit.circuit_breaker_slow_request_threshold,
        cfg.limit.http_slow_log_threshold,
    )
});

pub fn watch_request(req_took_time: u64) {
    CIRCUIT_BREAKER.watch(req_took_time);
}

/// CircuitBreaker is a circuit breaker that can be used to prevent a service from being overloaded.
/// It is a state machine that can be in one of three states: Closed, Open, or HalfOpen.
///
/// The circuit breaker will be in the Closed state when the service is healthy.
/// When the service is unhealthy, the circuit breaker will be in the Open state.
///
/// It watches the slow requests in the current window, and if the number of slow requests exceeds
/// the threshold, the circuit breaker will be in the Open state.
///
/// (TODO) The circuit breaker will be in the HalfOpen state when the service is recovering.
struct CircuitBreaker {
    watching_window: i64,         // watching window in seconds
    reset_window_num: i64,        // reset window number
    slow_request_threshold: u64,  // slow request threshold in requests
    http_slow_log_threshold: u64, // http slow log threshold in seconds
    current_window: AtomicI64,    // current window timestamp
    total_requests: AtomicU64,    // current window requests
    slow_requests: AtomicU64,     // current window slow requests
    state: AtomicU64,             // circuit breaker state
    will_reset_at: AtomicI64,     // will reset at timestamp
}

enum CircuitBreakerState {
    Closed,
    Open,
    #[allow(dead_code)]
    HalfOpen,
}

impl CircuitBreaker {
    fn new(
        watching_window: i64,
        reset_window_num: i64,
        slow_request_threshold: u64,
        http_slow_log_threshold: u64,
    ) -> Arc<Self> {
        let cb = Self {
            watching_window,
            reset_window_num,
            slow_request_threshold,
            http_slow_log_threshold,
            current_window: AtomicI64::new(0),
            total_requests: AtomicU64::new(0),
            slow_requests: AtomicU64::new(0),
            state: AtomicU64::new(CircuitBreakerState::Closed as u64),
            will_reset_at: AtomicI64::new(0),
        };
        // reset the current window
        cb.reset_current_window();
        Arc::new(cb)
    }

    fn watch(&self, req_took_time: u64) {
        // check if need reset current window
        self.reset_current_window();

        self.total_requests.fetch_add(1, Ordering::Relaxed);
        if req_took_time < self.http_slow_log_threshold {
            return; // not a slow request
        }

        let slow_reqs = self.slow_requests.fetch_add(1, Ordering::Relaxed);
        // check if need to open the circuit breaker
        if slow_reqs >= self.slow_request_threshold
            && self.state.load(Ordering::Relaxed) == CircuitBreakerState::Closed as u64
        {
            self.open();
        }
    }

    fn open(&self) {
        self.state
            .store(CircuitBreakerState::Open as u64, Ordering::Relaxed);
        self.will_reset_at.store(
            Utc::now().timestamp() + self.watching_window * self.reset_window_num,
            Ordering::Relaxed,
        );

        log::warn!(
            "[CIRCUIT_BREAKER] circuit breaker is open, total reqs: {}, slow reqs: {}",
            self.total_requests.load(Ordering::Relaxed),
            self.slow_requests.load(Ordering::Relaxed)
        );

        // change the cluster node status to unSchedulable
        tokio::spawn(async move {
            for _ in 0..UPDATE_STATE_RETRY_TIMES {
                match crate::common::infra::cluster::set_unschedulable().await {
                    Ok(_) => {
                        log::warn!(
                            "[CIRCUIT_BREAKER] set the cluster node status to unSchedulable"
                        );
                        break;
                    }
                    Err(e) => {
                        log::error!(
                            "[CIRCUIT_BREAKER] failed to set the cluster node status to unSchedulable: {}",
                            e
                        );
                    }
                }
            }
        });
    }

    fn reset_state(&self) {
        if self.state.load(Ordering::Relaxed) == CircuitBreakerState::Open as u64
            && self.will_reset_at.load(Ordering::Relaxed) < Utc::now().timestamp()
            && self.slow_requests.load(Ordering::Relaxed) < self.slow_request_threshold
        {
            self.state
                .store(CircuitBreakerState::Closed as u64, Ordering::Relaxed);

            // change the cluster node status to schedulable
            tokio::spawn(async move {
                for _ in 0..UPDATE_STATE_RETRY_TIMES {
                    match crate::common::infra::cluster::set_schedulable().await {
                        Ok(_) => {
                            log::warn!(
                                "[CIRCUIT_BREAKER] set the cluster node status to schedulable"
                            );
                            break;
                        }
                        Err(e) => {
                            log::error!(
                                "[CIRCUIT_BREAKER] failed to set the cluster node status to schedulable: {}",
                                e
                            );
                        }
                    }
                }
            });
        }
    }

    fn reset_current_window(&self) {
        if self.current_window.load(Ordering::Relaxed) == self.get_current_window_timestamp() {
            return;
        }
        self.reset_state();
        self.current_window
            .store(self.get_current_window_timestamp(), Ordering::Relaxed);
        self.total_requests.store(0, Ordering::Relaxed);
        self.slow_requests.store(0, Ordering::Relaxed);
    }

    fn get_current_window_timestamp(&self) -> i64 {
        Utc::now().timestamp() / self.watching_window
    }
}
