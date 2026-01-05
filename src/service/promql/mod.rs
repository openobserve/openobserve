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
