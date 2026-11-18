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

//! State, summary and window of a detector, read from the scored buckets of its current model.

use serde::{Deserialize, Serialize};

/// The latest judgment of one bucket of the current model.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExploreBucket {
    pub ts_us: i64,
    pub value: Option<f64>,
    pub expected: Option<f64>,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub is_anomaly: bool,
    pub is_absence: bool,
    pub is_partial_drop: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExploreState {
    Ongoing,
    BackInRange,
    #[default]
    None,
    NoRuns,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ExploreSummary {
    /// "value", "absence" or "partial_drop".
    pub kind: String,
    pub actual: Option<f64>,
    pub expected: Option<f64>,
    pub expected_lower: Option<f64>,
    pub expected_upper: Option<f64>,
    pub change_percent: Option<f64>,
    pub started_us: Option<i64>,
    pub since_us: Option<i64>,
}

/// The unpadded anomaly window; `clipped` when it reaches the start of the read range.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExploreWindow {
    pub start_us: i64,
    pub end_us: i64,
    pub clipped: bool,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExploreDecision {
    pub state: ExploreState,
    pub summary: Option<ExploreSummary>,
    pub window: Option<ExploreWindow>,
}

/// The body of `GET /api/{org_id}/anomaly_detection/{anomaly_id}/explore` in Phase 1.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ExploreResponse {
    pub url: String,
    pub label: String,
    /// "logs", "traces" or "metrics".
    pub target: String,
    pub filter_applied: bool,
    pub name: String,
    pub measure: String,
    pub stream: String,
    pub filter: Option<String>,
    pub state: ExploreState,
    /// Always "buckets" in Phase 1.
    pub state_source: String,
    pub summary: Option<ExploreSummary>,
    /// `current_model_version` when trained, else 0.
    pub model_version: i64,
    pub last_detection_run: Option<i64>,
    pub cursor_us: Option<i64>,
    pub no_new_data_since_us: Option<i64>,
    pub window: Option<ExploreWindow>,
    pub explore_start_us: i64,
}

/// Decides the strip state from `buckets`, oldest first; a detector that never ran is `NoRuns`.
pub fn decide(
    buckets: &[ExploreBucket],
    bucket_us: i64,
    range_start_us: i64,
    has_run: bool,
    is_trained: bool,
) -> ExploreDecision {
    let _ = (buckets, bucket_us, range_start_us, has_run, is_trained);
    todo!("endpoint stream")
}
