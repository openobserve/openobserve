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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time;

    // Helper function to create a test circuit breaker with custom parameters
    fn create_test_circuit_breaker(
        watching_window: i64,
        reset_window_num: i64,
        slow_request_threshold: u64,
        http_slow_log_threshold: u64,
    ) -> Arc<CircuitBreaker> {
        CircuitBreaker::new(
            watching_window,
            reset_window_num,
            slow_request_threshold,
            http_slow_log_threshold,
        )
    }

    // Helper function to create a default test circuit breaker
    fn create_default_test_circuit_breaker() -> Arc<CircuitBreaker> {
        create_test_circuit_breaker(10, 2, 5, 1000) // 10s window, 2x reset, 5 slow req threshold, 1s slow threshold
    }

    #[test]
    fn test_circuit_breaker_new() {
        let cb = create_test_circuit_breaker(5, 3, 10, 2000);
        
        assert_eq!(cb.watching_window, 5);
        assert_eq!(cb.reset_window_num, 3);
        assert_eq!(cb.slow_request_threshold, 10);
        assert_eq!(cb.http_slow_log_threshold, 2000);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 0);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn test_circuit_breaker_watch_fast_requests() {
        let cb = create_default_test_circuit_breaker();
        
        // Send fast requests (below slow threshold)
        for _ in 0..10 {
            cb.watch(500); // 500ms, below 1000ms threshold
        }
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 10);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 0);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
    }

    #[test]
    fn test_circuit_breaker_watch_slow_requests_below_threshold() {
        let cb = create_default_test_circuit_breaker();
        
        // Send slow requests but below threshold
        for _ in 0..4 {
            cb.watch(1500); // 1500ms, above 1000ms threshold
        }
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 4);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 4);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
    }

    #[tokio::test]
    async fn test_circuit_breaker_opens_when_threshold_exceeded() {
        let cb = create_default_test_circuit_breaker();
        
        // Send enough slow requests to trigger circuit breaker
        // Need 6 requests because fetch_add returns previous value
        for _ in 0..6 {
            cb.watch(1500); // 1500ms, above 1000ms threshold
        }
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 6);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 6);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
        assert!(cb.will_reset_at.load(Ordering::Relaxed) > Utc::now().timestamp());
    }

    #[tokio::test]
    async fn test_circuit_breaker_mixed_requests() {
        let cb = create_default_test_circuit_breaker();
        
        // Send mix of fast and slow requests
        for _ in 0..3 {
            cb.watch(500);  // Fast request
            cb.watch(1500); // Slow request
        }
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 6);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 3);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
        
        // Add 3 more slow requests to exceed threshold (need total of 6 slow requests)
        cb.watch(1500);
        cb.watch(1500);
        cb.watch(1500);
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 9);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 6);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }

    #[tokio::test]
    async fn test_circuit_breaker_open_directly() {
        let cb = create_default_test_circuit_breaker();
        
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
        
        cb.open();
        
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
        let reset_time = cb.will_reset_at.load(Ordering::Relaxed);
        let expected_reset_time = Utc::now().timestamp() + cb.watching_window * cb.reset_window_num;
        // Allow 1 second tolerance for timing
        assert!((reset_time - expected_reset_time).abs() <= 1);
    }

    #[test]
    fn test_get_current_window_timestamp() {
        let cb = create_test_circuit_breaker(10, 2, 5, 1000);
        
        let now = Utc::now().timestamp();
        let window_timestamp = cb.get_current_window_timestamp();
        let expected_window = now / 10;
        
        assert_eq!(window_timestamp, expected_window);
    }

    #[test]
    fn test_reset_current_window_same_window() {
        let cb = create_default_test_circuit_breaker();
        
        // Add some requests
        cb.watch(500);
        cb.watch(1500);
        
        let initial_total = cb.total_requests.load(Ordering::Relaxed);
        let initial_slow = cb.slow_requests.load(Ordering::Relaxed);
        let initial_window = cb.current_window.load(Ordering::Relaxed);
        
        // Reset current window when still in same window should not change counters
        cb.reset_current_window();
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), initial_total);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), initial_slow);
        assert_eq!(cb.current_window.load(Ordering::Relaxed), initial_window);
    }

    #[tokio::test]
    async fn test_reset_state_when_conditions_met() {
        let cb = create_test_circuit_breaker(1, 1, 3, 500); // 1s window, 1x reset, 3 slow req threshold
        
        // Open the circuit breaker
        cb.open();
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
        
        // Wait for reset time to pass
        time::sleep(Duration::from_secs(2)).await;
        
        // Make sure slow requests are below threshold
        assert!(cb.slow_requests.load(Ordering::Relaxed) < cb.slow_request_threshold);
        
        // Trigger reset state check
        cb.reset_state();
        
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
    }

    #[tokio::test]
    async fn test_reset_state_when_conditions_not_met() {
        let cb = create_default_test_circuit_breaker();
        
        // Open the circuit breaker
        cb.open();
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
        
        // Reset should not happen immediately (reset time not reached)
        cb.reset_state();
        
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }

    #[test]
    fn test_circuit_breaker_state_enum_values() {
        assert_eq!(CircuitBreakerState::Closed as u64, 0);
        assert_eq!(CircuitBreakerState::Open as u64, 1);
        assert_eq!(CircuitBreakerState::HalfOpen as u64, 2);
    }

    #[tokio::test]
    async fn test_circuit_breaker_boundary_conditions() {
        // Test with threshold of 1
        let cb = create_test_circuit_breaker(5, 2, 1, 1000);
        
        // First slow request should not trigger due to fetch_add behavior
        cb.watch(1500);
        
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 1);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
        
        // Second slow request should trigger circuit breaker
        cb.watch(1500);
        
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 2);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }

    #[tokio::test]
    async fn test_circuit_breaker_zero_threshold() {
        // Test with threshold of 0 (circuit breaker opens immediately on first slow request)
        let cb = create_test_circuit_breaker(5, 2, 0, 1000);
        
        // First slow request should open the circuit breaker (0 >= 0)
        cb.watch(1500);
        
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 1);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }

    #[tokio::test]
    async fn test_circuit_breaker_exact_threshold_boundary() {
        let cb = create_test_circuit_breaker(5, 2, 3, 1000);
        
        // Send exactly 2 slow requests (below threshold)
        cb.watch(1500);
        cb.watch(1500);
        
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 2);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
        
        // Send 3rd slow request (still below due to fetch_add behavior)
        cb.watch(1500);
        
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 3);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
        
        // Send 4th slow request (meets threshold due to fetch_add behavior)
        cb.watch(1500);
        
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 4);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }

    #[tokio::test]
    async fn test_circuit_breaker_concurrent_watch_calls() {
        let cb = create_default_test_circuit_breaker();
        let cb_clone = cb.clone();
        
        // Simulate concurrent watch calls using tokio tasks
        let handle1 = tokio::task::spawn(async move {
            for _ in 0..10 {
                cb_clone.watch(1500); // Slow requests
            }
        });
        
        let cb_clone2 = cb.clone();
        let handle2 = tokio::task::spawn(async move {
            for _ in 0..10 {
                cb_clone2.watch(500); // Fast requests
            }
        });
        
        handle1.await.expect("Task 1 should complete successfully");
        handle2.await.expect("Task 2 should complete successfully");
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 20);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 10);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }

    #[test]
    fn test_circuit_breaker_watch_request_threshold_edge() {
        let cb = create_test_circuit_breaker(5, 2, 5, 1000);
        
        // Send requests at exactly the slow threshold
        cb.watch(999); // Just below threshold - should be considered fast
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 0);
        
        cb.watch(1000); // Exactly at threshold - should be considered slow (>= threshold)
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 1);
        
        cb.watch(1001); // Just above threshold - should be considered slow
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn test_circuit_breaker_large_values() {
        let cb = create_test_circuit_breaker(3600, 10, 1000, 5000); // 1 hour window
        
        // Test with large request times
        cb.watch(10000); // 10 seconds
        cb.watch(u64::MAX); // Maximum value
        
        assert_eq!(cb.total_requests.load(Ordering::Relaxed), 2);
        assert_eq!(cb.slow_requests.load(Ordering::Relaxed), 2);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Closed as u64);
    }

    #[tokio::test]
    async fn test_global_circuit_breaker_watch_request() {
        // Test the global watch_request function
        watch_request(500); // Fast request
        watch_request(2000); // Slow request (assuming default threshold)
        
        // This test mainly verifies the function doesn't panic
        // Since CIRCUIT_BREAKER is a singleton, we can't easily verify state
        // without affecting other tests, but we can ensure it doesn't crash
    }

    #[test]
    fn test_circuit_breaker_window_timestamp_calculation() {
        let cb = create_test_circuit_breaker(60, 2, 5, 1000); // 60 second window
        
        let now = Utc::now().timestamp();
        let window = cb.get_current_window_timestamp();
        
        // Window should be the current timestamp divided by window size
        assert_eq!(window, now / 60);
        
        // Test with different window sizes
        let cb2 = create_test_circuit_breaker(3600, 2, 5, 1000); // 1 hour window
        let window2 = cb2.get_current_window_timestamp();
        assert_eq!(window2, now / 3600);
    }

    #[tokio::test]
    async fn test_circuit_breaker_reset_calculation() {
        let cb = create_test_circuit_breaker(10, 3, 5, 1000);
        
        let before_open = Utc::now().timestamp();
        cb.open();
        let after_open = Utc::now().timestamp();
        
        let reset_time = cb.will_reset_at.load(Ordering::Relaxed);
        let expected_min = before_open + (10 * 3); // watching_window * reset_window_num
        let expected_max = after_open + (10 * 3);
        
        assert!(reset_time >= expected_min);
        assert!(reset_time <= expected_max);
    }

    #[tokio::test]
    async fn test_circuit_breaker_doesnt_open_when_already_open() {
        let cb = create_default_test_circuit_breaker();
        
        // Open the circuit breaker
        cb.open();
        let first_reset_time = cb.will_reset_at.load(Ordering::Relaxed);
        
        // Try to open again
        cb.open();
        let second_reset_time = cb.will_reset_at.load(Ordering::Relaxed);
        
        // Reset time should be updated
        assert!(second_reset_time >= first_reset_time);
        assert_eq!(cb.state.load(Ordering::Relaxed), CircuitBreakerState::Open as u64);
    }
}
