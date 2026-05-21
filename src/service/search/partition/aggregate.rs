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

#[cfg(feature = "enterprise")]
use {
    config::utils::sql::is_simple_aggregate_query,
    o2_enterprise::enterprise::search::cache_aggs_util,
};

/// Determine whether a streaming aggregate query should be used for the given SQL query.
#[cfg(feature = "enterprise")]
pub(crate) fn is_streaming_aggregate(
    sql: &str,
    ts_column: Option<&str>,
    is_http_distinct: bool,
) -> bool {
    let feature_query_streaming_aggs = config::get_config().common.feature_query_streaming_aggs;
    let mut is_cachable_aggs = is_simple_aggregate_query(sql).unwrap_or(false);

    let res: Result<cache_aggs_util::CacheAggregationAnalysisResult, String> =
        cache_aggs_util::analyze_count_aggregation_pattern(sql);
    if let Ok(result) = res {
        is_cachable_aggs = result.matches_pattern || is_cachable_aggs;
    }

    ts_column.is_none() && is_cachable_aggs && feature_query_streaming_aggs && !is_http_distinct
}

#[cfg(not(feature = "enterprise"))]
pub(crate) fn is_streaming_aggregate(
    _sql: &str,
    _ts_column: Option<&str>,
    _is_http_distinct: bool,
) -> bool {
    false
}
