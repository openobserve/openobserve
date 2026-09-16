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

//! Service graph v4: per-window rollup of trace streams into `traces_service_graph_*` metrics.

pub mod resolution;
pub mod resolve;
pub mod schedule;
pub mod sql;
pub mod state;
pub mod writer;

use std::sync::{Arc, LazyLock, atomic::AtomicBool};

use config::utils::time::SECOND_MICRO_SECS;
use dashmap::DashMap;
use tokio::sync::{Mutex, RwLock};

use self::{resolution::ResolutionTable, state::StreamState};

/// Caps catch-up per tick so one far-behind stream cannot hold a scheduler task for hours.
pub const MAX_WINDOWS_PER_TICK: usize = 120;
pub const LEARN_INTERVAL_SECS: i64 = 300;
pub const SERIES_TTL_MICROS: i64 = 24 * 3600 * SECOND_MICRO_SECS;
pub const RESOLUTION_MAX_KEYS: usize = 200_000;
pub const SNAPSHOT_INTERVAL_SECS: i64 = 600;
pub const GRACE_LEARN_CYCLES: u32 = 2;
pub const EDGE_HARD_CAP: usize = 50_000;
pub const NODE_HARD_CAP: usize = 15_000;
pub const LEARN_SAMPLE: u32 = 64;
/// An offset further behind than this jumps to the present; there is no history backfill.
pub const MAX_BACKLOG_MICROS: i64 = 24 * 3600 * SECOND_MICRO_SECS;
pub const PROCESSED_TIMESTAMP_STREAM: &str = "traces_service_graph_processed_timestamp";
/// Ancestor levels the JOIN form of Q5/Q6 climbs to find the owning agent (design §4.2).
pub const AGENT_INHERIT_DEPTH: usize = 4;

/// Per-(org, stream) series state; only the stream's holder task touches an entry.
pub(crate) static STREAM_STATES: LazyLock<DashMap<(String, String), StateRef>> =
    LazyLock::new(DashMap::new);
/// Per-org resolution table; read by every stream of the org, written by the learning pass.
pub(crate) static ORG_TABLES: LazyLock<DashMap<String, TableRef>> = LazyLock::new(DashMap::new);
/// Retained (edges, nodes) per stream, kept so a stream's next update can be applied as a delta.
pub(crate) static RETAINED: LazyLock<DashMap<(String, String), (usize, usize)>> =
    LazyLock::new(DashMap::new);
/// Running per-org totals of `RETAINED`, so the org gauges cost O(1) per window.
pub(crate) static ORG_RETAINED: LazyLock<DashMap<String, (usize, usize)>> =
    LazyLock::new(DashMap::new);
/// `started_at` is write-once per process; this guard avoids a meta-db read on every window.
pub(crate) static STARTED_AT_WRITTEN: AtomicBool = AtomicBool::new(false);

pub type StateRef = Arc<Mutex<StreamState>>;
pub type TableRef = Arc<RwLock<ResolutionTable>>;

/// The three env-backed knobs plus the reused `ZO_CACHE_DELAY_SECS`; nothing else is configurable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settings {
    pub interval_secs: u64,
    pub flush_secs: u64,
    pub cache_delay_secs: i64,
}

impl Settings {
    #[cfg(feature = "enterprise")]
    pub fn from_config() -> Self {
        let sg = &o2_enterprise::enterprise::common::config::get_config().service_graph;
        Self {
            interval_secs: sg.interval_secs,
            flush_secs: sg.flush_secs.max(1),
            cache_delay_secs: config::get_config().limit.cache_delay_secs,
        }
    }

    pub fn flush_micros(&self) -> i64 {
        (self.flush_secs as i64).max(1) * SECOND_MICRO_SECS
    }

    /// Newest window end allowed: data younger than `cache_delay_secs` may still be in flight.
    pub fn horizon(&self, now: i64) -> i64 {
        now - self.cache_delay_secs * SECOND_MICRO_SECS
    }
}

pub fn stream_concurrency() -> usize {
    (config::get_config().limit.cpu_num / 4).max(2)
}

pub async fn run_tick(settings: Settings) {
    schedule::run_tick(&settings).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_window_arithmetic() {
        let s = Settings {
            interval_secs: 60,
            flush_secs: 60,
            cache_delay_secs: 300,
        };
        assert_eq!(s.flush_micros(), 60 * SECOND_MICRO_SECS);
        assert_eq!(
            s.horizon(1_000 * SECOND_MICRO_SECS),
            700 * SECOND_MICRO_SECS
        );
        let zero = Settings { flush_secs: 0, ..s };
        assert_eq!(zero.flush_micros(), SECOND_MICRO_SECS);
    }

    #[test]
    fn test_constants() {
        assert_eq!(MAX_WINDOWS_PER_TICK, 120);
        assert_eq!(GRACE_LEARN_CYCLES, 2);
        assert_eq!(LEARN_SAMPLE, 64);
        assert!(stream_concurrency() >= 2);
    }
}
