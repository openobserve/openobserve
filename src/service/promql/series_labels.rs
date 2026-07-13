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

//! Attaches series labels to loaded samples: serves them from the label
//! cache when possible and scans the label columns only for the series that
//! are not cached yet.

use std::sync::Arc;

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        HASH_LABEL,
        value::{Label, Labels, QueryContext, RangeValue},
    },
    utils::hash::{Sum64, gxhash},
};
use datafusion::{
    arrow::{
        array::{Array, StringArray, UInt64Array},
        datatypes::DataType,
    },
    error::Result,
    prelude::{DataFrame, col, lit},
};
use hashbrown::{HashMap, HashSet};
use rayon::iter::{IntoParallelIterator, IntoParallelRefIterator, ParallelIterator};

use super::label_cache;

/// Upper bound on the number of series hashes put into an in-list filter when
/// narrowing the label scan to cache-missed series.
const MAX_HASH_INLIST_FILTER: usize = 8192;

/// Attach labels to every series in `metrics`. Labels are immutable per
/// series hash: cached ones are attached in parallel, the rest are extracted
/// from a label-column scan (and cached for the next query).
pub async fn attach_series_labels(
    query_ctx: &QueryContext,
    table_name: &str,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    metrics: &mut HashMap<u64, RangeValue>,
) -> Result<()> {
    let start = std::time::Instant::now();
    let label_cache = &*label_cache::LABEL_CACHE;
    // bypass the cache when the working set won't fit (stored labels
    // exclude the hash column)
    let cache_enabled = label_cache.admit(label_col_names.len().saturating_sub(1), metrics.len());
    if !cache_enabled {
        log::info!(
            "[trace_id: {}] label cache bypassed: {} series x {} label cols exceeds the cache budget",
            query_ctx.trace_id,
            metrics.len(),
            label_col_names.len(),
        );
    }
    let ctx_fp = label_cache::context_fingerprint(&query_ctx.org_id, table_name, label_col_names);
    let missing_hashes: Vec<u64> = if cache_enabled {
        attach_cached_labels(ctx_fp, query_ctx.query_data, metrics)
    } else {
        metrics.keys().copied().collect()
    };
    let cache_hits = metrics.len() - missing_hashes.len();
    config::metrics::QUERY_METRICS_LABEL_CACHE_HIT_COUNT
        .with_label_values(&[&query_ctx.org_id])
        .inc_by(cache_hits as u64);
    config::metrics::QUERY_METRICS_LABEL_CACHE_MISS_COUNT
        .with_label_values(&[&query_ctx.org_id])
        .inc_by(missing_hashes.len() as u64);

    if !missing_hashes.is_empty() {
        let cache_fp = cache_enabled.then_some(ctx_fp);
        scan_missing_labels(
            query_ctx,
            df_group,
            hash_field_type,
            label_col_names,
            &missing_hashes,
            cache_fp,
            metrics,
        )
        .await?;
    }

    log::info!(
        "[trace_id: {}] load all labels took: {:?}, label cache hits: {}, misses: {}",
        query_ctx.trace_id,
        start.elapsed(),
        cache_hits,
        missing_hashes.len(),
    );
    Ok(())
}

/// Attach cached labels in parallel — millions of series make the
/// lookup+clone loop CPU-bound. Returns the hashes that missed the cache.
fn attach_cached_labels(
    ctx_fp: u64,
    query_data: bool,
    metrics: &mut HashMap<u64, RangeValue>,
) -> Vec<u64> {
    let label_cache = &*label_cache::LABEL_CACHE;
    metrics
        .iter_mut()
        .collect::<Vec<_>>()
        .into_par_iter()
        .filter_map(|(hash, range_val)| match label_cache.get(ctx_fp, *hash) {
            Some(labels) => {
                range_val.labels = maybe_prepend_hash_label(labels, *hash, query_data);
                None
            }
            None => Some(*hash),
        })
        .collect()
}

/// Scan the label columns for the missing series, attach the extracted
/// labels, and store them in the cache when `cache_fp` is set.
async fn scan_missing_labels(
    query_ctx: &QueryContext,
    df_group: DataFrame,
    hash_field_type: &DataType,
    label_col_names: &[String],
    missing_hashes: &[u64],
    cache_fp: Option<u64>,
    metrics: &mut HashMap<u64, RangeValue>,
) -> Result<()> {
    // membership test for the extraction loop; skip the set when every
    // series missed (cache bypassed or cold)
    let all_missing = missing_hashes.len() == metrics.len();
    let missing_set: HashSet<u64> = if all_missing {
        HashSet::new()
    } else {
        missing_hashes.iter().copied().collect()
    };
    // hashes whose labels were extracted in this scan (dedup)
    let mut labeled_set: HashSet<u64> = HashSet::new();
    // Each missing series has a row at its own max timestamp, so scanning
    // those timestamps yields at least one label row per missing series.
    let series_timestamps = missing_hashes
        .par_iter()
        .filter_map(|hash| {
            let range_val = metrics.get(hash)?;
            let sample_max = range_val.samples.iter().map(|s| s.timestamp).max();
            let exemplar_max = range_val
                .exemplars
                .as_ref()
                .and_then(|v| v.iter().map(|e| e.timestamp).max());
            sample_max.max(exemplar_max)
        })
        .collect::<Vec<_>>();

    let mut df_series = df_group;
    // narrow the scan to the missing series when the hash column allows
    // building an in-list filter of reasonable size
    if hash_field_type == &DataType::UInt64 && missing_hashes.len() <= MAX_HASH_INLIST_FILTER {
        df_series = df_series.filter(col(HASH_LABEL).in_list(
            missing_hashes.iter().map(|&v| lit(v)).collect::<Vec<_>>(),
            false,
        ))?;
    }
    let label_cols = label_col_names
        .iter()
        .map(|name| col(name.as_str()))
        .collect::<Vec<_>>();
    let series = if config::get_config().limit.metrics_inlist_filter_enabled
        || series_timestamps.is_empty()
    {
        // many series share the same max timestamp; dedup to keep the
        // in-list filter small
        let mut in_list_timestamps = series_timestamps;
        in_list_timestamps.sort_unstable();
        in_list_timestamps.dedup();
        df_series
            .filter(
                col(TIMESTAMP_COL_NAME).in_list(
                    in_list_timestamps
                        .iter()
                        .map(|&v| lit(v))
                        .collect::<Vec<_>>(),
                    false,
                ),
            )?
            .select(label_cols)?
            .collect()
            .await?
    } else {
        let min = series_timestamps.iter().min().unwrap();
        let max = series_timestamps.iter().max().unwrap();
        df_series
            .filter(col(TIMESTAMP_COL_NAME).between(lit(*min), lit(*max)))?
            .select(label_cols)?
            .collect()
            .await?
    };

    for batch in series {
        let columns = batch.columns();
        let schema = batch.schema();
        let fields = schema.fields();
        let cols = fields
            .iter()
            .zip(columns)
            .filter_map(|(field, col)| {
                if field.name() == HASH_LABEL {
                    None
                } else {
                    col.as_any()
                        .downcast_ref::<StringArray>()
                        .map(|col| (field.name(), col))
                }
            })
            .collect::<Vec<(_, _)>>();
        let mut attach_row_labels = |hash: u64, i: usize| {
            if (!all_missing && !missing_set.contains(&hash)) || labeled_set.contains(&hash) {
                return;
            }
            let Some(range_val) = metrics.get_mut(&hash) else {
                return;
            };
            let mut labels = Vec::with_capacity(cols.len());
            for (name, value) in cols.iter() {
                if value.is_null(i) {
                    continue;
                }
                labels.push(Arc::new(Label {
                    name: name.to_string(),
                    value: value.value(i).to_string(),
                }));
            }
            labeled_set.insert(hash);
            if let Some(ctx_fp) = cache_fp {
                label_cache::LABEL_CACHE.put(ctx_fp, hash, labels.clone());
            }
            range_val.labels = maybe_prepend_hash_label(labels, hash, query_ctx.query_data);
        };
        if hash_field_type == &DataType::UInt64 {
            let hash_values = batch
                .column_by_name(HASH_LABEL)
                .unwrap()
                .as_any()
                .downcast_ref::<UInt64Array>()
                .unwrap();
            for i in 0..batch.num_rows() {
                attach_row_labels(hash_values.value(i), i);
            }
        } else {
            let hash_values = batch
                .column_by_name(HASH_LABEL)
                .unwrap()
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            for i in 0..batch.num_rows() {
                attach_row_labels(gxhash::new().sum64(hash_values.value(i)), i);
            }
        }
    }
    Ok(())
}

/// Prepend the synthetic `__hash__` label when the query asked for raw data
/// (`query_data`); otherwise return the labels unchanged.
fn maybe_prepend_hash_label(labels: Labels, hash: u64, query_data: bool) -> Labels {
    if !query_data {
        return labels;
    }
    let mut with_hash = Vec::with_capacity(labels.len() + 1);
    with_hash.push(Arc::new(Label {
        name: HASH_LABEL.to_string(),
        value: hash.to_string(),
    }));
    with_hash.extend(labels);
    with_hash
}
