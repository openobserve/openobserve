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

use config::meta::self_reporting::llm_scores::LlmScoreTargetScope;
use openobserve_core::llm_evaluations::quality::{
    DEFAULT_PAGE_SIZE, ListQualityScores, QualityFilter,
};
use serde::Deserialize;
use utoipa::IntoParams;

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct QualitySummaryQuery {
    /// Inclusive Score write-time lower bound, in microseconds.
    pub start_time: i64,
    /// Exclusive Score write-time upper bound, in microseconds.
    pub end_time: i64,
    /// `span`, `trace` or `session`. Omit for all scopes.
    #[param(value_type = Option<String>, example = "trace")]
    pub scope: Option<LlmScoreTargetScope>,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_env: Option<String>,
    pub agent_version: Option<String>,
}

impl From<QualitySummaryQuery> for QualityFilter {
    fn from(value: QualitySummaryQuery) -> Self {
        Self {
            start_time: value.start_time,
            end_time: value.end_time,
            scope: value.scope,
            agent_id: value.agent_id,
            agent_name: value.agent_name,
            agent_env: value.agent_env,
            agent_version: value.agent_version,
        }
    }
}

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct ListQualityScoresQuery {
    /// Inclusive Score write-time lower bound, in microseconds.
    pub start_time: i64,
    /// Exclusive Score write-time upper bound, in microseconds.
    pub end_time: i64,
    /// `span`, `trace` or `session`. Omit for all scopes.
    #[param(value_type = Option<String>, example = "trace")]
    pub scope: Option<LlmScoreTargetScope>,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_env: Option<String>,
    pub agent_version: Option<String>,
    /// Only Scores that fail the config's healthy threshold.
    pub unhealthy_only: Option<bool>,
    /// Numeric configs: first distribution bucket index to include.
    pub bucket_from: Option<i64>,
    /// Numeric configs: last distribution bucket index to include. Defaults to
    /// `bucket_from`.
    pub bucket_to: Option<i64>,
    /// Boolean and categorical configs: exact value to include.
    pub value: Option<String>,
    /// Zero-based result offset. Defaults to 0.
    pub from: Option<usize>,
    /// Page size from 1 through 100. Defaults to 20.
    pub size: Option<usize>,
}

impl From<ListQualityScoresQuery> for ListQualityScores {
    fn from(value: ListQualityScoresQuery) -> Self {
        Self {
            filter: QualityFilter {
                start_time: value.start_time,
                end_time: value.end_time,
                scope: value.scope,
                agent_id: value.agent_id,
                agent_name: value.agent_name,
                agent_env: value.agent_env,
                agent_version: value.agent_version,
            },
            unhealthy_only: value.unhealthy_only.unwrap_or(false),
            buckets: match (value.bucket_from, value.bucket_to) {
                (Some(from), to) => Some((from, to.unwrap_or(from))),
                (None, Some(to)) => Some((to, to)),
                (None, None) => None,
            },
            value: value.value,
            from: value.from.unwrap_or(0),
            size: value.size.unwrap_or(DEFAULT_PAGE_SIZE),
        }
    }
}
