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
    collections::{HashMap, VecDeque},
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
const MAX_KEYS: usize = 65_536;

/// Hit counts per key in fixed windows, holding at most a fixed number of keys; a full map evicts
/// the oldest window.
pub struct Counters {
    max_keys: usize,
    state: Mutex<CounterState>,
}

impl Counters {
    pub fn new(max_keys: usize) -> Self {
        Self {
            max_keys,
            state: Mutex::new(CounterState::default()),
        }
    }

    /// Counts one hit for `key`; true past its budget.
    pub fn over_budget(&self, key: &str, window: Duration, max: u32) -> bool {
        self.over_budget_at(key, window, max, Instant::now())
    }

    /// Whether `key` already spent `max` hits in its window; counts nothing.
    pub fn exhausted(&self, key: &str, window: Duration, max: u32) -> bool {
        let Ok(state) = self.state.lock() else {
            return false;
        };
        state
            .hits
            .get(key)
            .is_some_and(|(n, at)| Instant::now().duration_since(*at) < window && *n >= max)
    }

    fn over_budget_at(&self, key: &str, window: Duration, max: u32, now: Instant) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        // One sweep per window keeps a flood of keys from making every hit O(n).
        if state
            .swept_at
            .is_none_or(|at| now.duration_since(at) >= window)
        {
            let CounterState { hits, order, .. } = &mut *state;
            hits.retain(|_, (_, at)| now.duration_since(*at) < window);
            order.retain(|(k, at)| hits.get(k).is_some_and(|e| e.1 == *at));
            state.swept_at = Some(now);
        }
        if let Some(entry) = state.hits.get_mut(key) {
            let renewed = now.duration_since(entry.1) >= window;
            if renewed {
                *entry = (0, now);
            }
            entry.0 = entry.0.saturating_add(1);
            let over = entry.0 > max;
            if renewed {
                state.order.push_back((key.to_owned(), now));
            }
            return over;
        }
        if state.hits.len() >= self.max_keys {
            state.evict_oldest();
        }
        state.hits.insert(key.to_owned(), (1, now));
        state.order.push_back((key.to_owned(), now));
        max == 0
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
    // Window starts in arrival order; an entry whose start no longer matches `hits` is stale.
    order: VecDeque<(String, Instant)>,
    swept_at: Option<Instant>,
}

impl CounterState {
    fn evict_oldest(&mut self) {
        while let Some((key, at)) = self.order.pop_front() {
            if self.hits.get(&key).is_some_and(|e| e.1 == at) {
                self.hits.remove(&key);
                return;
            }
        }
    }
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
    fn a_full_map_admits_a_new_key_by_evicting_the_oldest() {
        let counters = Counters::new(2);
        let window = Duration::from_secs(60);
        let t0 = Instant::now();
        assert!(!counters.over_budget_at("a", window, 1, t0));
        assert!(!counters.over_budget_at("b", window, 1, t0 + Duration::from_secs(1)));
        assert!(!counters.over_budget_at("c", window, 1, t0 + Duration::from_secs(2)));
        {
            let state = counters.state.lock().unwrap();
            assert_eq!(state.hits.len(), 2);
            assert!(!state.hits.contains_key("a"), "the oldest key is evicted");
            assert!(state.hits.contains_key("b") && state.hits.contains_key("c"));
        }
        assert!(
            counters.over_budget_at("b", window, 1, t0 + Duration::from_secs(3)),
            "a kept key keeps its count"
        );
        assert!(!counters.over_budget_at("a", window, 1, t0 + Duration::from_secs(4)));
        assert!(!counters.state.lock().unwrap().hits.contains_key("b"));
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

    #[test]
    fn exhausted_reads_the_budget_without_counting() {
        let counters = Counters::default();
        let window = Duration::from_secs(60);
        assert!(!counters.exhausted("slug", window, 2));
        assert!(!counters.over_budget("slug", window, 2));
        assert!(!counters.exhausted("slug", window, 2));
        assert!(!counters.over_budget("slug", window, 2));
        assert!(counters.exhausted("slug", window, 2));
        assert!(counters.exhausted("slug", window, 2), "a peek is not a hit");
        assert!(!counters.exhausted("other", window, 2));
    }
}
