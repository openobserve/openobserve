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
    sync::RwLock,
    time::{Duration, Instant},
};

use config::axum::middlewares::RealIp;

/// The limiter key when no `RealIp` was resolved: one bucket still bounds the load.
pub const SHARED_IP: &str = "shared";

pub type Counters = RwLock<HashMap<String, (u32, Instant)>>;

/// The limiter key: the ingress-resolved `RealIp`, or one shared bucket when that layer isn't
/// installed.
pub fn client_ip(ip: Option<RealIp>) -> String {
    ip.map_or_else(|| SHARED_IP.to_owned(), |ip| ip.0.to_string())
}

/// Counts one hit for `key` and reports whether the window's budget is exceeded; fails open on a
/// poisoned lock.
pub fn over_budget(counters: &Counters, key: String, window: Duration, max: u32) -> bool {
    let Ok(mut guard) = counters.write() else {
        return false;
    };
    let now = Instant::now();
    // Opportunistic cleanup keeps the map bounded.
    if guard.len() > 8192 {
        guard.retain(|_, (_, at)| now.duration_since(*at) < window);
    }
    let e = guard.entry(key).or_insert((0, now));
    if now.duration_since(e.1) >= window {
        *e = (0, now);
    }
    e.0 = e.0.saturating_add(1);
    e.0 > max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn over_budget_trips_after_max_hits_in_the_window() {
        let counters: Counters = RwLock::new(HashMap::new());
        let window = Duration::from_secs(60);
        assert!(!over_budget(&counters, "ip".into(), window, 2));
        assert!(!over_budget(&counters, "ip".into(), window, 2));
        assert!(over_budget(&counters, "ip".into(), window, 2));
        assert!(!over_budget(&counters, "other".into(), window, 2));
    }
}
