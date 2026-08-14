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

//! Coordinates label-cache lookup with loading the remaining labels.

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{HASH_LABEL, value::QueryContext},
};
use datafusion::{
    arrow::datatypes::DataType,
    error::Result,
    prelude::{DataFrame, col, lit},
};
use hashbrown::HashSet;

use super::{PartitionedMetrics, label_cache, load_labels::load_labels};

const MAX_HASH_INLIST_FILTER: usize = 8192;
const TIMESTAMP_IN_LIST_MAX_VALUES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TimestampFilterStrategy {
    InList,
    Between { min: i64, max: i64 },
}

/// Choose the cheaper timestamp predicate using a bounded empirical model.
fn timestamp_filter_strategy(timestamp_set: &HashSet<i64>) -> TimestampFilterStrategy {
    if timestamp_set.len() <= TIMESTAMP_IN_LIST_MAX_VALUES {
        return TimestampFilterStrategy::InList;
    }

    let (min, max) = timestamp_set
        .iter()
        .fold((i64::MAX, i64::MIN), |(min, max), &timestamp| {
            (min.min(timestamp), max.max(timestamp))
        });

    TimestampFilterStrategy::Between { min, max }
}

/// Attach labels to every loaded series. Cache hits are attached first, then
/// the loader scans and extracts labels only for the remaining series.
pub(super) async fn load_series_labels(
    query_ctx: &QueryContext,
    table_name: &str,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    timestamp_set: &HashSet<i64>,
    mut metrics: PartitionedMetrics,
) -> Result<PartitionedMetrics> {
    let start = std::time::Instant::now();

    let misses = label_cache::attach_cached_labels(
        &query_ctx.org_id,
        table_name,
        label_col_names,
        query_ctx.query_data,
        &mut metrics,
    );
    let (cache_hits, cache_misses) = (misses.hits(), misses.count());

    if !misses.is_empty() {
        let series_df = missing_label_scan(
            &query_ctx.trace_id,
            df_group,
            hash_field_type,
            label_col_names,
            timestamp_set,
            &misses,
        )?;
        let observer = misses.write_observer(&query_ctx.trace_id, label_col_names.len());
        metrics = load_labels(
            &query_ctx.trace_id,
            hash_field_type,
            series_df,
            query_ctx.query_data,
            observer,
            misses.into_selected_hashes(),
            metrics,
        )
        .await?;
    }

    log::info!(
        "[trace_id: {}] load and process all labels took: {:?}, label cache hits: {cache_hits}, misses: {cache_misses}",
        query_ctx.trace_id,
        start.elapsed(),
    );
    Ok(metrics)
}

/// Build the scan that recovers the missing series' labels: label columns
/// only, narrowed by a hash in-list when the misses are few, and by the
/// series max timestamps the sample scan already collected (every series has
/// a label row at its own max sample/exemplar timestamp).
///
/// The timestamp set covers all series rather than just the misses: series
/// share scrape timestamps, so a miss-only set is virtually identical, and
/// deriving it would cost a full pass over the loaded samples.
fn missing_label_scan(
    trace_id: &str,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    timestamp_set: &HashSet<i64>,
    misses: &label_cache::CacheMisses,
) -> Result<DataFrame> {
    let mut df = df_group;
    if hash_field_type == &DataType::UInt64 && misses.count() <= MAX_HASH_INLIST_FILTER {
        let hashes = misses.hashes().map(lit).collect();
        df = df.filter(col(HASH_LABEL).in_list(hashes, false))?;
    }

    let filter_strategy = timestamp_filter_strategy(timestamp_set);
    let timestamp_filter = match filter_strategy {
        TimestampFilterStrategy::InList => {
            let mut timestamps = timestamp_set.iter().copied().collect::<Vec<_>>();
            timestamps.sort_unstable();
            col(TIMESTAMP_COL_NAME).in_list(timestamps.into_iter().map(lit).collect(), false)
        }
        TimestampFilterStrategy::Between { min, max } => {
            col(TIMESTAMP_COL_NAME).between(lit(min), lit(max))
        }
    };
    log::info!(
        "[trace_id: {trace_id}] load labels with {filter_strategy:?} timestamp filter for {} values",
        timestamp_set.len(),
    );

    let label_cols = label_col_names
        .iter()
        .map(|name| col(name.as_str()))
        .collect::<Vec<_>>();
    df.filter(timestamp_filter)?.select(label_cols)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamps(count: usize, gap_micros: i64) -> HashSet<i64> {
        (0..count)
            .map(|timestamp| timestamp as i64 * gap_micros)
            .collect()
    }

    #[test]
    fn test_timestamp_filter_strategy_uses_in_list_up_to_limit() {
        assert_eq!(
            timestamp_filter_strategy(&HashSet::new()),
            TimestampFilterStrategy::InList
        );
        assert_eq!(
            timestamp_filter_strategy(&timestamps(TIMESTAMP_IN_LIST_MAX_VALUES, 1)),
            TimestampFilterStrategy::InList
        );
    }

    #[test]
    fn test_timestamp_filter_strategy_caps_in_list_size() {
        let count = TIMESTAMP_IN_LIST_MAX_VALUES + 1;
        let sparse_gap = 10;
        let sparse = timestamps(count, sparse_gap);
        assert_eq!(
            timestamp_filter_strategy(&sparse),
            TimestampFilterStrategy::Between {
                min: 0,
                max: (count - 1) as i64 * sparse_gap,
            }
        );
    }
}
