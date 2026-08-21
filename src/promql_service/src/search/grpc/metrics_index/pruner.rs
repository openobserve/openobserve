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
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

use arrow::datatypes::Schema;
use config::{
    PARQUET_MAX_ROW_GROUP_SIZE,
    meta::{
        promql::{is_metrics_hash_excluded_label, layout::MetricsFileLayout},
        stream::{FileKey, FileSelection},
    },
};
use datafusion::{
    common::{DFSchema, DataFusionError, Result},
    execution::context::ExecutionProps,
    logical_expr::Expr,
    physical_expr::create_physical_expr,
    physical_plan::PhysicalExpr,
};
use futures::{StreamExt, stream};
use promql_parser::label::Matchers;
use rayon::prelude::*;
use search::types::QueryParams;

use super::{
    cache::METRICS_INDEX_SELECTION_CACHE,
    reader::{evaluate_metrics_index, load_metrics_index_file},
};

/// Apply the `.midx` metrics indexes of indexed metrics files in `files` before
/// registering the metrics table.
///
/// This mirrors the PromQL Tantivy path: matching physical rows are attached
/// to each indexed [`FileKey`] (files without a matching series are
/// dropped) and the generic DataFusion scan later converts that selection into
/// a Parquet access plan. Files of any other layout are left untouched, in
/// place, for the caller to run Tantivy / a full scan over. `Ok(None)` means
/// no file or matcher was eligible and nothing was changed.
pub(in crate::search::grpc) async fn search(
    query: &QueryParams,
    files: &mut Vec<FileKey>,
    table_schema: &Schema,
    matchers: &Matchers,
    target_partitions: usize,
) -> Result<Option<usize>> {
    let Some(matcher_labels) = metrics_index_labels(table_schema, matchers) else {
        return Ok(None);
    };
    let matcher_labels = Arc::new(matcher_labels);
    if files.is_empty() {
        return Ok(None);
    }

    // Keep the complete matcher set in the key. A short hash collision could
    // otherwise reuse physical row ranges selected by a different query.
    let filter_key = format!("{matchers:?}");
    let mut index_files = BTreeMap::new();
    for file in files.iter() {
        // only indexed metrics files own a sidecar; other layouts stay as they are
        if MetricsFileLayout::of(&file.key) != MetricsFileLayout::Indexed {
            continue;
        }
        let sidecar_path = MetricsFileLayout::metrics_index_path(&file.key).ok_or_else(|| {
            DataFusionError::Execution(format!(
                "indexed metrics file has no metrics-index path: {}",
                file.key
            ))
        })?;
        let cache_key = format!("{}\0{sidecar_path}\0{filter_key}", file.account);
        index_files.entry(file.key.clone()).or_insert((
            file.account.clone(),
            sidecar_path,
            cache_key,
        ));
    }
    if index_files.is_empty() {
        return Ok(None);
    }
    let other_files = files.len() - index_files.len();

    let start = std::time::Instant::now();
    let mut evaluated = Vec::with_capacity(index_files.len());
    let mut misses = Vec::new();
    {
        let mut cache = METRICS_INDEX_SELECTION_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (data_path, (account, sidecar_path, cache_key)) in index_files {
            if let Some(ranges) = cache.get(&cache_key) {
                evaluated.push((data_path, ranges));
            } else {
                misses.push((data_path, account, sidecar_path, cache_key));
            }
        }
    }
    let cache_hits = evaluated.len();
    let concurrency = target_partitions.max(1).saturating_mul(2).min(64);
    let loaded = stream::iter(misses.into_iter().map(
        |(data_path, account, sidecar_path, cache_key)| {
            let labels = Arc::clone(&matcher_labels);
            async move {
                load_metrics_index_file(&account, &sidecar_path, labels)
                    .await
                    .map(|data| (data_path, cache_key, data))
            }
        },
    ))
    .buffer_unordered(concurrency)
    .collect::<Vec<_>>()
    .await;

    let loaded_files = loaded.into_iter().collect::<Result<Vec<_>>>()?;
    // Sidecars written at different times can carry different label sets and
    // column orders, so the physical filter is resolved by name against each
    // file's own schema instead of being shared across files.
    let newly_evaluated = loaded_files
        .into_par_iter()
        .map(|(path, cache_key, data)| {
            let physical_filter = create_physical_filter(data.schema.as_ref(), matchers)?;
            evaluate_metrics_index(&data, physical_filter.as_deref())
                .map(|ranges| (path, cache_key, Arc::new(ranges)))
        })
        .collect::<Result<Vec<_>>>()?;
    {
        let mut cache = METRICS_INDEX_SELECTION_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (path, cache_key, ranges) in newly_evaluated {
            cache.insert(cache_key, Arc::clone(&ranges));
            evaluated.push((path, ranges));
        }
    }

    let selected_files = evaluated
        .iter()
        .filter(|(_, ranges)| !ranges.is_empty())
        .count();
    let selected_ranges = evaluated
        .iter()
        .map(|(_, ranges)| ranges.len())
        .sum::<usize>();
    let indexed_file_count = evaluated.len();
    let mut selections = evaluated.into_iter().collect::<HashMap<_, _>>();
    files.retain_mut(|file| {
        let Some(ranges) = selections.remove(&file.key) else {
            // not indexed metrics: untouched, the caller decides how to scan it
            return true;
        };
        if ranges.is_empty() {
            return false;
        }
        file.with_selection(
            FileSelection::RowRanges(ranges),
            Some(PARQUET_MAX_ROW_GROUP_SIZE as u32),
        );
        true
    });

    let took = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {}] promql->metrics-index: selected {selected_ranges} ranges across {selected_files}/{} files, {other_files} files without a sidecar left to tantivy/full scan, selection cache hits: {cache_hits}, took: {took} ms",
        query.trace_id,
        indexed_file_count,
    );
    Ok(Some(took))
}

/// Labels referenced by the matchers that the sidecar can answer. `None`
/// when no matcher can be evaluated on the metrics index.
pub(super) fn metrics_index_labels(
    table_schema: &Schema,
    matchers: &Matchers,
) -> Option<Vec<String>> {
    let mut labels: Vec<String> = Vec::new();
    for matcher in &matchers.matchers {
        if is_metrics_hash_excluded_label(&matcher.name)
            || table_schema.field_with_name(&matcher.name).is_err()
        {
            continue;
        }
        if !labels.contains(&matcher.name) {
            labels.push(matcher.name.clone());
        }
    }
    (!labels.is_empty()).then_some(labels)
}

/// Physical filter over the sidecar columns. `None` when none of the matchers
/// can be evaluated on this sidecar (all matched labels are missing): every
/// series of the file must then be scanned.
pub(super) fn create_physical_filter(
    sidecar_schema: &Schema,
    matchers: &Matchers,
) -> Result<Option<Arc<dyn PhysicalExpr>>> {
    let Some(filter) = promql::utils::matcher_predicates(sidecar_schema, matchers)
        .into_iter()
        .reduce(Expr::and)
    else {
        return Ok(None);
    };
    let df_schema = DFSchema::try_from(sidecar_schema.clone())?;
    // plain expression planning: no session/registry needed for column
    // comparisons and regexp_like
    create_physical_expr(&filter, &df_schema, &ExecutionProps::new()).map(Some)
}
