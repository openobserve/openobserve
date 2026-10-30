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

//! Metrics shard scans: the `__hash__` interval a shard filter pushes down,
//! the file pruning it allows, and the scan rebuilt over the fewest ordered
//! chains of the surviving files.

use std::sync::Arc;

use config::meta::promql::HASH_LABEL;
use datafusion::{
    common::ScalarValue,
    datasource::{
        listing::PartitionedFile,
        physical_plan::{FileGroup, FileScanConfig},
    },
    logical_expr::Operator,
    physical_plan::ExecutionPlan,
    prelude::Expr,
};

use crate::datafusion::{
    sort_order::FileSortOrder,
    table_provider::helpers::{file_scan_config, with_access_plans},
};

/// The closed `__hash__` interval implied by the pushed-down filters, if any.
pub(super) fn hash_interval(filters: &[Expr]) -> Option<(u64, u64)> {
    let mut lo = 0u64;
    let mut hi = u64::MAX;
    let mut found = false;
    for filter in filters {
        let Expr::BinaryExpr(binary) = filter else {
            continue;
        };
        let Expr::Column(column) = binary.left.as_ref() else {
            continue;
        };
        if column.name != HASH_LABEL {
            continue;
        }
        let Expr::Literal(ScalarValue::UInt64(Some(value)), _) = binary.right.as_ref() else {
            continue;
        };
        match binary.op {
            Operator::GtEq => lo = lo.max(*value),
            Operator::Gt => lo = lo.max(value.saturating_add(1)),
            Operator::LtEq => hi = hi.min(*value),
            Operator::Lt => hi = hi.min(value.saturating_sub(1)),
            Operator::Eq => {
                lo = lo.max(*value);
                hi = hi.min(*value);
            }
            _ => continue,
        }
        found = true;
    }
    found.then_some((lo, hi))
}

/// Keeps files whose `__hash__` statistics may intersect `[lo, hi]`; a file
/// without usable statistics always survives.
fn prune_groups_by_hash_range(
    file_groups: &[FileGroup],
    schema: &arrow_schema::Schema,
    (lo, hi): (u64, u64),
) -> Vec<FileGroup> {
    let Ok(hash_index) = schema.index_of(HASH_LABEL) else {
        return file_groups.to_vec();
    };
    let mut pruned: Vec<FileGroup> = file_groups
        .iter()
        .map(|group| {
            FileGroup::new(
                group
                    .iter()
                    .filter(|file| file_may_intersect(file, hash_index, lo, hi))
                    .cloned()
                    .collect(),
            )
        })
        .filter(|group| !group.is_empty())
        .collect();
    // a scan needs at least one (empty) partition
    if pruned.is_empty() {
        pruned.push(FileGroup::new(vec![]));
    }
    pruned
}

/// A metrics shard scan keeps only the files whose `__hash__` statistics
/// intersect the shard and chains them into the fewest ordered chains; one
/// task merges them all, so the scan is never repartitioned.
pub(super) fn handler_metrics_scan(
    trace_id: &str,
    plan: Arc<dyn ExecutionPlan>,
    sort_order: FileSortOrder,
    hash_range: (u64, u64),
    target_partitions: usize,
) -> Arc<dyn ExecutionPlan> {
    let Some(config) = file_scan_config(&plan) else {
        return plan;
    };
    let schema = config.file_source().table_schema().table_schema();
    let mut file_groups = prune_groups_by_hash_range(&config.file_groups, schema, hash_range);

    // an all-pruned shard keeps its single empty group: a scan needs a partition
    if file_groups.iter().any(|group| !group.is_empty()) {
        match sort_order.physical_ordering(schema) {
            Some(ordering) => {
                match FileScanConfig::split_groups_by_statistics(schema, &file_groups, &ordering) {
                    Ok(chains) => file_groups = chains,
                    Err(e) => log::warn!(
                        "[trace_id {trace_id}] failed to chain shard files by statistics for {sort_order}: {e}, keeping file groups as is"
                    ),
                }
            }
            None => log::warn!(
                "[trace_id {trace_id}] sort columns of {sort_order} not found in schema, skipping shard chaining"
            ),
        }
    }

    with_access_plans(trace_id, config, file_groups, target_partitions)
}

fn file_may_intersect(file: &PartitionedFile, hash_index: usize, lo: u64, hi: u64) -> bool {
    let Some(statistics) = file.statistics.as_ref() else {
        return true;
    };
    let Some(column) = statistics.column_statistics.get(hash_index) else {
        return true;
    };
    match (column.min_value.get_value(), column.max_value.get_value()) {
        (Some(ScalarValue::UInt64(Some(min))), Some(ScalarValue::UInt64(Some(max)))) => {
            *max >= lo && *min <= hi
        }
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use datafusion::prelude::{col, lit};

    use super::*;

    #[test]
    fn test_hash_interval_extraction() {
        let ge = col(HASH_LABEL).gt_eq(lit(5u64));
        let le = col(HASH_LABEL).lt_eq(lit(9u64));
        assert_eq!(hash_interval(&[ge.clone(), le.clone()]), Some((5, 9)));
        assert_eq!(hash_interval(&[ge]), Some((5, u64::MAX)));
        assert_eq!(hash_interval(&[le]), Some((0, 9)));
        assert_eq!(
            hash_interval(&[col(HASH_LABEL).gt(lit(5u64)), col(HASH_LABEL).lt(lit(9u64))]),
            Some((6, 8))
        );
        assert_eq!(
            hash_interval(&[col(HASH_LABEL).eq(lit(7u64))]),
            Some((7, 7))
        );
        // other columns, non-u64 literals, and unrelated ops leave no interval
        assert_eq!(hash_interval(&[col("other").gt_eq(lit(5u64))]), None);
        assert_eq!(hash_interval(&[col(HASH_LABEL).gt_eq(lit("5"))]), None);
        assert_eq!(hash_interval(&[]), None);
    }
}
