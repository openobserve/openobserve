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

//! Fixed-window per-IP limiter shared by the unauthenticated public planes.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use axum::{
    http::{HeaderValue, header},
    response::Response,
};
use config::axum::middlewares::RealIp;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// How a client whose `RealIp` was not resolved shows up in logs.
pub const UNKNOWN_IP: &str = "unknown";
pub const MAX_KEYS: usize = 65_536;

/// Hit counts per key in fixed windows, holding at most a fixed number of keys.
pub struct Counters {
    max_keys: usize,
    fail_open: bool,
    state: Mutex<CounterState>,
}

impl Counters {
    pub fn new(max_keys: usize) -> Self {
        Self {
            max_keys,
            fail_open: false,
            state: Mutex::new(CounterState::default()),
        }
    }

    /// Fails open: a new key while the map is full is admitted rather than refused.
    pub fn fail_open(max_keys: usize) -> Self {
        Self {
            fail_open: true,
            ..Self::new(max_keys)
        }
    }

    /// True past the key budget, or for a new key when a fail-closed map is full.
    pub fn over_budget(&self, key: &str, window: Duration, max: u32) -> bool {
        self.over_budget_at(key, window, max, 1, Instant::now())
    }

    /// Counts `amount` units for `key`, for budgets measured in bytes rather than calls.
    pub fn over_budget_by(&self, key: &str, window: Duration, max: u32, amount: u32) -> bool {
        self.over_budget_at(key, window, max, amount, Instant::now())
    }

    fn over_budget_at(
        &self,
        key: &str,
        window: Duration,
        max: u32,
        amount: u32,
        now: Instant,
    ) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        // One sweep per window keeps a flood of keys from making every hit O(n).
        if state
            .swept_at
            .is_none_or(|at| now.duration_since(at) >= window)
        {
            state
                .hits
                .retain(|_, (_, at)| now.duration_since(*at) < window);
            state.swept_at = Some(now);
        }
        let full = state.hits.len() >= self.max_keys;
        match state.hits.get_mut(key) {
            Some(entry) => {
                if now.duration_since(entry.1) >= window {
                    *entry = (0, now);
                }
                entry.0 = entry.0.saturating_add(amount);
                entry.0 > max
            }
            None if full => !self.fail_open,
            None => {
                state.hits.insert(key.to_owned(), (amount, now));
                amount > max
            }
        }
    }
}

impl Default for Counters {
    fn default() -> Self {
        Self::new(MAX_KEYS)
    }
}

#[derive(Default)]
struct CounterState {
    hits: HashMap<String, (u32, Instant)>,
    swept_at: Option<Instant>,
}

/// The client's address for logs: the ingress-resolved `RealIp`, or [`UNKNOWN_IP`].
pub fn client_ip(ip: Option<RealIp>) -> String {
    ip.map_or_else(|| UNKNOWN_IP.to_owned(), |ip| ip.0.to_string())
}

/// A JSON 429 telling the client when to come back.
pub fn too_many_requests(retry_after: Duration) -> Response {
    let mut resp = MetaHttpResponse::too_many_requests("Too many requests; please retry later");
    resp.headers_mut().insert(
        header::RETRY_AFTER,
        HeaderValue::from(retry_after.as_secs().max(1)),
    );
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn over_budget_trips_after_max_hits_in_the_window() {
        let counters = Counters::default();
        let window = Duration::from_secs(60);
        assert!(!counters.over_budget("ip", window, 2));
        assert!(!counters.over_budget("ip", window, 2));
        assert!(counters.over_budget("ip", window, 2));
        assert!(!counters.over_budget("other", window, 2));
    }

    #[test]
    fn a_full_map_refuses_new_keys_until_the_window_sweeps_them() {
        let counters = Counters::new(2);
        let window = Duration::from_secs(60);
        let t0 = Instant::now();
        assert!(!counters.over_budget_at("a", window, 5, 1, t0));
        assert!(!counters.over_budget_at("b", window, 5, 1, t0));
        assert!(counters.over_budget_at("c", window, 5, 1, t0));
        assert!(!counters.over_budget_at("a", window, 5, 1, t0));
        let later = t0 + window;
        assert!(!counters.over_budget_at("c", window, 5, 1, later));
        assert_eq!(counters.state.lock().unwrap().hits.len(), 1);
    }

    #[test]
    fn a_full_ip_map_fails_open() {
        let counters = Counters::fail_open(2);
        let window = Duration::from_secs(60);
        let t0 = Instant::now();
        assert!(!counters.over_budget_at("a", window, 1, 1, t0));
        assert!(!counters.over_budget_at("b", window, 1, 1, t0));
        assert!(!counters.over_budget_at("c", window, 1, 1, t0));
        assert!(!counters.over_budget_at("c", window, 1, 1, t0));
        assert!(
            counters.over_budget_at("a", window, 1, 1, t0),
            "keys already tracked keep their budget"
        );
        assert_eq!(counters.state.lock().unwrap().hits.len(), 2);
    }

    #[test]
    fn byte_budget_counts_bytes_not_calls() {
        let counters = Counters::default();
        let window = Duration::from_secs(60);
        assert!(!counters.over_budget_by("org", window, 1000, 600));
        assert!(!counters.over_budget_by("org", window, 1000, 400));
        assert!(counters.over_budget_by("org", window, 1000, 1));
        assert!(!counters.over_budget_by("other", window, 1000, 1000));
        assert!(counters.over_budget_by("big", window, 1000, 1001));
    }

    #[tokio::test]
    async fn too_many_requests_is_json_with_retry_after() {
        let resp = too_many_requests(Duration::from_secs(60));
        assert_eq!(resp.status(), axum::http::StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(resp.headers()[header::RETRY_AFTER], "60");
        let body = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["code"], 429);
        assert_eq!(
            too_many_requests(Duration::ZERO).headers()[header::RETRY_AFTER],
            "1"
        );
    }

    #[test]
    fn unresolved_clients_log_as_unknown() {
        assert_eq!(client_ip(None), UNKNOWN_IP);
    }
}
