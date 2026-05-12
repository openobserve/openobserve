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

use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use config::meta::search::{ScanStats, SearchEventType};
use datafusion::{arrow::datatypes::Schema, error::Result, prelude::SessionContext};
use hashbrown::HashSet;
use promql_parser::label::Matchers;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

mod aggregations;
mod binaries;
pub mod common;
mod engine;
mod exec;
mod functions;
pub mod name_visitor;
mod rewrite;
pub mod search;
pub mod selector_visitor;
mod utils;

pub use engine::Engine;
pub use exec::PromqlContext;

pub(crate) const DEFAULT_LOOKBACK: Duration = Duration::from_secs(300); // 5m
pub(crate) const MINIMAL_INTERVAL: Duration = Duration::from_secs(1); // 1s
pub(crate) const MAX_DATA_POINTS: i64 = 256; // Width of panel: window.innerWidth / 4
pub(crate) const DEFAULT_MAX_POINTS_PER_SERIES: usize = 30000; // Maximum number of points per series
const DEFAULT_STEP: Duration = Duration::from_secs(15); // default step in seconds
const MIN_TIMESERIES_POINTS_FOR_TIME_ROUNDING: i64 = 10; // Adjust this value as needed

#[async_trait]
pub trait TableProvider: Sync + Send + 'static {
    async fn create_context(
        &self,
        org_id: &str,
        stream_name: &str,
        time_range: (i64, i64),
        machers: Matchers,
        label_selector: HashSet<String>,
        filters: &mut [(String, Vec<String>)],
    ) -> Result<Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>>;
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct MetricsQueryRequest {
    pub query: String,
    pub start: i64,
    pub end: i64,
    pub step: i64,
    pub query_exemplars: bool,
    pub use_cache: Option<bool>,
    pub search_type: Option<SearchEventType>,
    pub regions: Vec<String>,
    pub clusters: Vec<String>,
}

/// Converts `t` to the number of microseconds elapsed since the beginning of
/// the Unix epoch.
pub(crate) fn micros_since_epoch(t: SystemTime) -> i64 {
    micros(
        t.duration_since(UNIX_EPOCH)
            .expect("BUG: {t} is earlier than Unix epoch"),
    )
}

pub(crate) fn micros(t: Duration) -> i64 {
    t.as_micros()
        .try_into()
        .expect("BUG: time value is too large to fit in i64")
}

pub fn round_step(mut step: i64) -> i64 {
    // align step to seconds
    let second = micros(Duration::from_secs(1));
    if step >= second {
        step -= step % second;
    }
    if step == 0 {
        micros(DEFAULT_STEP)
    } else if step > (60 * second) {
        step - (step % (60 * second))
    } else if step > (10 * second) {
        step - (step % (5 * second))
    } else {
        step
    }
}

pub fn align_start_end(mut start: i64, mut end: i64, step: i64) -> (i64, i64) {
    // Round start to the nearest smaller value divisible by step.
    start -= start % step;
    // Round end to the nearest bigger value divisible by step.
    let adjust = end % step;
    if adjust > 0 {
        end += step - adjust
    }
    (start, end)
}

pub fn adjust_start_end(start: i64, end: i64, step: i64) -> (i64, i64) {
    let points = (end - start) / step + 1;
    if points < MIN_TIMESERIES_POINTS_FOR_TIME_ROUNDING {
        // Too small number of points for rounding.
        return (start, end);
    }

    // Round start and end to values divisible by step in order
    // to enable response caching.
    let (start, mut end) = align_start_end(start, end, step);

    // Make sure that the new number of points is the same as the initial number of points.
    let mut new_points = (end - start) / step + 1;
    while new_points > points {
        end -= step;
        new_points -= 1;
    }

    (start, end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs_micros(s: u64) -> i64 {
        micros(Duration::from_secs(s))
    }

    #[test]
    fn test_round_step_zero_returns_default_step() {
        assert_eq!(round_step(0), micros(DEFAULT_STEP));
    }

    #[test]
    fn test_round_step_sub_second_returns_default_step() {
        // Sub-second step: less than 1 second → stays as-is (nonzero), but > 0 handled:
        // Actually step < second means we skip the modulo, but step != 0 so we fall through.
        // 5 seconds is within 1s..10s range → unchanged
        let step = secs_micros(5);
        assert_eq!(round_step(step), step);
    }

    #[test]
    fn test_round_step_between_10_and_60s_rounds_to_5s_multiple() {
        // 23 seconds → rounds down to 20 (nearest lower 5s multiple)
        let step = secs_micros(23);
        let expected = secs_micros(20);
        assert_eq!(round_step(step), expected);
    }

    #[test]
    fn test_round_step_above_60s_rounds_to_minute_multiple() {
        // 90 seconds → rounds down to 60
        let step = secs_micros(90);
        let expected = secs_micros(60);
        assert_eq!(round_step(step), expected);
    }

    #[test]
    fn test_round_step_exact_minute_unchanged() {
        let step = secs_micros(120);
        assert_eq!(round_step(step), step);
    }

    #[test]
    fn test_align_start_end_already_aligned() {
        let (s, e) = align_start_end(100, 200, 10);
        assert_eq!(s, 100);
        assert_eq!(e, 200);
    }

    #[test]
    fn test_align_start_end_rounds_start_down() {
        let (s, _) = align_start_end(105, 200, 10);
        assert_eq!(s, 100);
    }

    #[test]
    fn test_align_start_end_rounds_end_up() {
        let (_, e) = align_start_end(100, 205, 10);
        assert_eq!(e, 210);
    }

    #[test]
    fn test_align_start_end_both_misaligned() {
        let (s, e) = align_start_end(13, 27, 10);
        assert_eq!(s, 10);
        assert_eq!(e, 30);
    }

    #[test]
    fn test_adjust_start_end_too_few_points_no_change() {
        // 9 points < MIN_TIMESERIES_POINTS_FOR_TIME_ROUNDING (10) → no change
        let (s, e) = adjust_start_end(0, 80, 10);
        assert_eq!((s, e), (0, 80));
    }

    #[test]
    fn test_adjust_start_end_preserves_point_count_and_aligns() {
        let step = 10i64;
        let start = 105i64;
        let end = 205i64;
        let original_points = (end - start) / step + 1; // 11
        let (new_start, new_end) = adjust_start_end(start, end, step);
        let new_points = (new_end - new_start) / step + 1;
        assert_eq!(new_points, original_points);
        assert_eq!(new_start % step, 0);
    }
}
