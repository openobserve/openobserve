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
    ops::Range,
    sync::Arc,
};

use anyhow::{Context, Result, bail, ensure};
use arrow::{
    array::{Array, AsArray},
    datatypes::Schema,
};
use config::{
    FileFormat, TIMESTAMP_COL_NAME,
    meta::{
        promql::{NAME_LABEL, VALUE_LABEL, is_metrics_hash_excluded_label},
        stream::{FileKey, FileSelection},
    },
};
use datafusion::{
    common::DFSchema, execution::context::ExecutionProps, logical_expr::Expr,
    physical_expr::create_physical_expr, physical_plan::PhysicalExpr,
};
use futures::{StreamExt, stream};
use promql_parser::label::Matchers;

use crate::{
    block::Index,
    block_cache::{Sidecar, load_index},
    layout::MetricsFileLayout,
};

pub fn matching_blocks(index: &Index, matchers: &Matchers) -> Result<Vec<usize>> {
    ensure!(
        matchers.or_matchers.is_empty(),
        "OR matchers require the source reader"
    );
    for matcher in &matchers.matchers {
        if [NAME_LABEL, VALUE_LABEL, TIMESTAMP_COL_NAME].contains(&matcher.name.as_str()) {
            continue;
        }
        if index
            .labels
            .schema()
            .field_with_name(&matcher.name)
            .is_err()
        {
            if index
                .header
                .source_schema
                .field_with_name(&matcher.name)
                .is_err()
            {
                return Ok(Vec::new());
            }
            bail!("MIDX lacks identity label {}", matcher.name);
        }
    }
    let Some(filter) = create_physical_filter(index.labels.schema().as_ref(), matchers)? else {
        return Ok((0..index.blocks.len()).collect());
    };
    let mask = filter
        .evaluate(&index.labels)?
        .into_array(index.blocks.len())?;
    let mask = mask
        .as_boolean_opt()
        .context("MIDX matcher was not boolean")?;
    Ok((0..mask.len())
        .filter(|&id| !mask.is_null(id) && mask.value(id))
        .collect())
}

/// Apply the `.midx` metrics indexes of indexed metrics files in `files` before
/// registering the metrics table.
///
/// This mirrors the PromQL Tantivy path: matching physical rows are attached
/// to each indexed [`FileKey`] (files without a matching series are
/// dropped) and the generic DataFusion scan later converts that selection into
/// a Parquet access plan. Files of any other layout are left untouched, in
/// place, for a full scan. `Ok(None)` means no file or matcher was eligible.
/// `Ok(Some((took_ms, exact)))`: `exact` means every selection holds exactly
/// the matching rows, so re-applying the matchers row by row is redundant.
pub async fn search(
    trace_id: &str,
    files: &mut Vec<FileKey>,
    table_schema: &Schema,
    matchers: &Matchers,
    target_partitions: usize,
) -> Result<Option<(usize, bool)>> {
    if !matchers.or_matchers.is_empty() {
        return Ok(None);
    }
    let Some(matcher_labels) = metrics_index_labels(table_schema, matchers) else {
        return Ok(None);
    };
    let matcher_labels = Arc::new(matcher_labels);
    if files.is_empty() {
        return Ok(None);
    }

    let mut index_files = BTreeMap::new();
    for file in files.iter() {
        // Zero size means this finalized file was published without a sidecar.
        if index_files.contains_key(&file.key)
            || MetricsFileLayout::of(&file.key) != Some(MetricsFileLayout::Indexed)
            || file.meta.mindex_size <= 0
        {
            continue;
        }
        match Sidecar::of(file) {
            Ok(sidecar) => {
                index_files.insert(file.key.clone(), sidecar);
            }
            Err(error) => log::warn!(
                "[trace_id {trace_id}] promql->metrics-index: indexed file {} has no usable sidecar, leaving the file unpruned: {error}",
                file.key,
            ),
        }
    }
    if index_files.is_empty() {
        return Ok(None);
    }
    let other_files = files.len() - index_files.len();

    let start = std::time::Instant::now();
    let mut evaluated = Vec::with_capacity(index_files.len());
    let concurrency = target_partitions.max(1).saturating_mul(2).min(64);
    let matchers = Arc::new(matchers.clone());
    let mut evaluations = stream::iter(index_files.into_iter().map(|(data_path, sidecar)| {
        let labels = Arc::clone(&matcher_labels);
        let matchers = Arc::clone(&matchers);
        async move {
            let result: Result<_> = async {
                let format = FileFormat::from_extension(&data_path)
                    .context("Unsupported metrics source format")?;
                let index = load_index(&sidecar, &labels).await?;
                let row_group_size = parent_row_group_size(&index, format)?;
                tokio::task::spawn_blocking(move || {
                    let (ranges, complete) = select_rows(&index, &labels, &matchers)?;
                    Ok((Arc::new(ranges), complete, row_group_size))
                })
                .await?
            }
            .await;
            (data_path, result)
        }
    }))
    .buffer_unordered(concurrency);

    // Consume each result as soon as it is decoded and evaluated. This keeps
    // decoded sidecar memory bounded by `concurrency`; only compact row ranges
    // live until they are attached to the files below.
    let mut failed_files = 0usize;
    while let Some((data_path, result)) = evaluations.next().await {
        match result {
            Ok((ranges, complete, row_group_size)) => {
                evaluated.push((data_path, ranges, complete, row_group_size));
            }
            Err(error) => {
                failed_files += 1;
                log::warn!(
                    "[trace_id {}] promql->metrics-index: failed to prune {data_path}, leaving the file for a full scan: {error}",
                    trace_id,
                );
            }
        }
    }

    let selected_files = evaluated
        .iter()
        .filter(|(_, ranges, ..)| !ranges.is_empty())
        .count();
    let selected_ranges = evaluated
        .iter()
        .map(|(_, ranges, ..)| ranges.len())
        .sum::<usize>();
    let indexed_file_count = evaluated.len() + failed_files;
    // An empty selection drops its file, so an incomplete matcher set cannot
    // have over-selected anything there.
    let exact = matchers.or_matchers.is_empty()
        && other_files == 0
        && failed_files == 0
        && residual_matchers_covered(table_schema, &matchers, &matcher_labels)
        && evaluated
            .iter()
            .all(|(_, ranges, complete, _)| *complete || ranges.is_empty());
    let mut selections = evaluated
        .into_iter()
        .map(|(data_path, ranges, _, row_group_size)| (data_path, (ranges, row_group_size)))
        .collect::<HashMap<_, _>>();
    files.retain_mut(|file| {
        let Some((ranges, row_group_size)) = selections.remove(&file.key) else {
            // not indexed metrics: untouched, the caller decides how to scan it
            return true;
        };
        if ranges.is_empty() {
            return false;
        }
        file.with_selection(FileSelection::RowRanges(ranges), row_group_size);
        true
    });

    let took_ms = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {}] promql->metrics-index: selected {selected_ranges} ranges across {selected_files}/{} files, {failed_files} sidecars failed and were left for a full scan, {other_files} files without a usable sidecar left for a full scan, exact: {exact}, took: {took_ms} ms",
        trace_id,
        indexed_file_count,
    );
    Ok(Some((took_ms, exact)))
}

/// Parent row ranges that may match, and whether the sidecar holds every label in `labels`.
pub(super) fn select_rows(
    index: &Index,
    labels: &[String],
    matchers: &Matchers,
) -> Result<(Vec<Range<usize>>, bool)> {
    let stored = |name: &str| index.labels.column_by_name(name).is_some();
    let complete = labels.iter().all(|label| stored(label));
    // a label this file never had cannot be evaluated here: skip it and over-select
    let answerable = Matchers::new(
        matchers
            .matchers
            .iter()
            .filter(|matcher| stored(&matcher.name))
            .cloned()
            .collect(),
    );
    let mut ranges: Vec<Range<usize>> = Vec::new();
    for id in matching_blocks(index, &answerable)? {
        let block = index.blocks.block(id);
        let start = usize::try_from(block.row_start)?;
        let end = start + block.row_count as usize;
        match ranges.last_mut() {
            Some(last) if last.end == start => last.end = end,
            _ => ranges.push(start..end),
        }
    }
    Ok((ranges, complete))
}

/// Parquet parents are split into equal row groups; Vortex parents have none.
fn parent_row_group_size(index: &Index, format: FileFormat) -> Result<Option<u32>> {
    match (format, index.header.row_group_size) {
        (FileFormat::Parquet, Some(size)) => Ok(Some(size)),
        (FileFormat::Vortex, None) => Ok(None),
        _ => bail!("Invalid block parent format/row-group binding"),
    }
}

/// Whether every matcher the query would re-apply on the table is one the
/// sidecars were asked to evaluate; matchers the sidecar cannot see (e.g. on
/// hash-excluded labels) leave the selection a superset.
pub(super) fn residual_matchers_covered(
    table_schema: &Schema,
    matchers: &Matchers,
    matcher_labels: &[String],
) -> bool {
    matchers.matchers.iter().all(|matcher| {
        crate::matcher_residual_field(table_schema, matcher).is_none()
            || matcher_labels.contains(&matcher.name)
    })
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
    let Some(filter) = crate::matcher_predicates(sidecar_schema, matchers)
        .into_iter()
        .reduce(Expr::and)
    else {
        return Ok(None);
    };
    let df_schema = DFSchema::try_from(sidecar_schema.clone())?;
    // plain expression planning: no session/registry needed for column
    // comparisons and regexp_like
    Ok(Some(create_physical_expr(
        &filter,
        &df_schema,
        &ExecutionProps::new(),
        &Default::default(),
    )?))
}
