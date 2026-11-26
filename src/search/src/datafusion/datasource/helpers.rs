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

use std::sync::Arc;

use arrow_schema::{DataType, SchemaRef};
use config::{FileFormat, TIMESTAMP_COL_NAME, meta::stream::FileSelection};
use datafusion::{
    catalog::memory::DataSourceExec,
    common::{DataFusionError, Result, project_schema, stats::Precision},
    datasource::{
        listing::PartitionedFile,
        physical_plan::{FileGroup, FileScanConfig, parquet::ParquetRowSelection},
    },
    logical_expr::Operator,
    parquet::arrow::arrow_reader::RowSelection,
    physical_expr::conjunction,
    physical_plan::{
        ExecutionPlan, PhysicalExpr,
        expressions::{BinaryExpr, CastExpr, Column, Literal},
        filter::FilterExecBuilder,
        projection::ProjectionExec,
    },
    scalar::ScalarValue,
};
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::sampling::execution::generate_row_group_row_selection;
use rayon::prelude::*;

use crate::{
    datafusion::{
        storage,
        vortex::{generate_vortex_access_plan, generate_vortex_access_plan_from_ranges},
    },
    index::IndexCondition,
};

/// Attach the access plan for this file as a typed [`PartitionedFile`] extension.
pub fn generate_access_plan(file: &mut PartitionedFile) {
    let Some(storage::file_list::ScanSelection { selection, .. }) =
        storage::file_list::get_scan_selection(file.path().as_ref())
    else {
        return;
    };

    let Some(file_format) = FileFormat::from_extension(file.path().as_ref()) else {
        return;
    };

    match file_format {
        FileFormat::Parquet => match selection {
            FileSelection::Rows(row_ids) => {
                let selection = RowSelection::from_boolean_buffer((*row_ids).clone());
                file.extensions.insert(ParquetRowSelection::new(selection));
            }
            FileSelection::RowRanges(ranges) => {
                if let Some(num_rows) = exact_num_rows(file) {
                    let selection =
                        RowSelection::from_consecutive_ranges(ranges.iter().cloned(), num_rows);
                    file.extensions.insert(ParquetRowSelection::new(selection));
                }
            }
            #[cfg(feature = "enterprise")]
            FileSelection::RowGroups(row_group_ids) => {
                if let Some(num_rows) = exact_num_rows(file) {
                    let selection = generate_row_group_row_selection(
                        &row_group_ids,
                        num_rows,
                        file.path().as_ref(),
                    );
                    file.extensions.insert(selection);
                }
            }
            #[cfg(not(feature = "enterprise"))]
            FileSelection::RowGroups(_) => {}
        },
        FileFormat::Vortex => match selection {
            FileSelection::Rows(row_ids) => {
                if let Some(access_plan) = generate_vortex_access_plan(&row_ids) {
                    file.extensions.insert(access_plan);
                }
            }
            FileSelection::RowRanges(ranges) => {
                if let Some(access_plan) =
                    generate_vortex_access_plan_from_ranges(file, ranges.iter().cloned())
                {
                    file.extensions.insert(access_plan);
                }
            }
            // Row-group sampling remains Parquet-only.
            FileSelection::RowGroups(_) => {}
        },
    }
}

fn exact_num_rows(file: &PartitionedFile) -> Option<usize> {
    match file.statistics.as_ref()?.num_rows {
        Precision::Exact(num_rows) => Some(num_rows),
        _ => None,
    }
}

pub fn apply_projection(
    schema: &SchemaRef,
    diff_rules: &HashMap<String, DataType>,
    projection: Option<&[usize]>,
    memory_exec: Arc<dyn ExecutionPlan>,
) -> Result<Arc<dyn ExecutionPlan>> {
    if diff_rules.is_empty() {
        return Ok(memory_exec);
    }
    let projected_schema = project_schema(schema, projection)?;
    let mut exprs: Vec<(Arc<dyn PhysicalExpr>, String)> =
        Vec::with_capacity(projected_schema.fields().len());
    for (idx, field) in projected_schema.fields().iter().enumerate() {
        let name = field.name().to_string();
        let col = Arc::new(Column::new(&name, idx));
        if let Some(data_type) = diff_rules.get(&name) {
            exprs.push((Arc::new(CastExpr::new(col, data_type.clone(), None)), name));
        } else {
            exprs.push((col, name));
        }
    }
    Ok(Arc::new(ProjectionExec::try_new(exprs, memory_exec)?))
}

pub fn apply_combined_filter(
    index_condition: Option<&IndexCondition>,
    timestamp_filter: Option<(i64, i64)>,
    schema: &arrow_schema::Schema,
    fst_fields: &[String],
    exec_plan: Arc<dyn ExecutionPlan>,
    filter_projection: Option<&[usize]>,
) -> Result<Arc<dyn ExecutionPlan>> {
    if index_condition.is_none() && timestamp_filter.is_none() {
        return Ok(exec_plan);
    }

    let mut filter_exprs = Vec::new();

    // add index condition filter if present
    if let Some(condition) = index_condition {
        let expr = condition
            .to_physical_expr(schema, fst_fields)
            .map_err(|e| DataFusionError::External(e.into()))?;
        filter_exprs.push(expr);
    }

    // add timestamp filter if present
    if let Some((start_time, end_time)) = timestamp_filter {
        let timestamp_idx = schema.index_of(TIMESTAMP_COL_NAME)?;
        let timestamp_col = Arc::new(Column::new(TIMESTAMP_COL_NAME, timestamp_idx));

        // create filter: _timestamp >= start_time AND _timestamp < end_time
        let ge_expr = Arc::new(BinaryExpr::new(
            timestamp_col.clone(),
            Operator::GtEq,
            Arc::new(Literal::new(ScalarValue::Int64(Some(start_time)))),
        ));
        let le_expr = Arc::new(BinaryExpr::new(
            timestamp_col,
            Operator::Lt,
            Arc::new(Literal::new(ScalarValue::Int64(Some(end_time)))),
        ));
        let timestamp_expr: Arc<dyn PhysicalExpr> =
            Arc::new(BinaryExpr::new(ge_expr, Operator::And, le_expr));
        filter_exprs.push(timestamp_expr);
    }

    // combine all filters with AND
    let combined_expr = conjunction(filter_exprs);

    Ok(Arc::new(
        FilterExecBuilder::new(combined_expr, exec_plan)
            .apply_projection(filter_projection.map(<[usize]>::to_vec))?
            .build()?,
    ))
}

/// Attaches the tantivy access plans to every file and rebuilds the scan over
/// the given groups.
pub(crate) fn with_access_plans(
    trace_id: &str,
    config: &FileScanConfig,
    file_groups: Vec<FileGroup>,
    target_partitions: usize,
) -> Arc<dyn ExecutionPlan> {
    let start = std::time::Instant::now();
    let new_file_groups: Vec<_> = file_groups
        .into_par_iter()
        .map(|file_group| {
            let group: Vec<_> = file_group
                .into_inner()
                .into_iter()
                .map(|mut file| {
                    generate_access_plan(&mut file);
                    file
                })
                .collect();
            // TODO: check if we need statistics for FileGroup
            // the statistics in FileGroup is used in ExecutionPlan::partition_statistics
            FileGroup::new(group)
        })
        .collect();

    let groups_len = new_file_groups.len();
    let max_group_len = new_file_groups.iter().map(|g| g.len()).max().unwrap_or(0);
    let files_nums = new_file_groups.iter().map(|g| g.len()).sum::<usize>();

    log::info!(
        "[trace_id {trace_id}] listing table adapter, target_partitions: {target_partitions}, file groups: {groups_len}, max group len: {max_group_len}, total files: {files_nums}, took: {} ms",
        start.elapsed().as_millis() as usize,
    );

    let mut config = config.clone();
    config.file_groups = new_file_groups;
    Arc::new(DataSourceExec::new(Arc::new(config)))
}

pub(crate) fn file_scan_config(plan: &Arc<dyn ExecutionPlan>) -> Option<&FileScanConfig> {
    plan.downcast_ref::<DataSourceExec>()?
        .data_source()
        .downcast_ref::<FileScanConfig>()
}

#[cfg(test)]
mod tests {
    use arrow::{
        buffer::BooleanBuffer,
        datatypes::{DataType, Field, Schema},
    };
    use config::meta::stream::FileKey;
    use datafusion::{
        common::Statistics, parquet::arrow::arrow_reader::RowSelector,
        physical_plan::empty::EmptyExec,
    };
    use vortex::scan::selection::Selection;
    use vortex_datafusion::VortexAccessPlan;

    use super::*;

    async fn attach_plan(
        trace_id: &str,
        file_key: &str,
        selection: FileSelection,
        num_rows: Option<usize>,
    ) -> PartitionedFile {
        let format = FileFormat::from_extension(file_key).unwrap().to_string();
        let mut file = FileKey::from_file_name(file_key);
        file.with_selection(selection, None);
        storage::file_list::set(trace_id, "schema", &format, vec![file]).await;
        let location =
            storage::file_list::get(&format!("{trace_id}/schema=schema/format={format}"))
                .unwrap()
                .remove(0)
                .location;
        let mut partitioned_file = PartitionedFile::new(location.to_string(), 100);
        if let Some(num_rows) = num_rows {
            let mut stats = Statistics::new_unknown(&Schema::empty());
            stats.num_rows = Precision::Exact(num_rows);
            partitioned_file.statistics = Some(Arc::new(stats));
        }
        generate_access_plan(&mut partitioned_file);
        storage::file_list::clear(trace_id);
        partitioned_file
    }

    #[tokio::test]
    async fn test_generate_access_plan_attaches_parquet_row_mask() {
        let row_ids = Arc::new(BooleanBuffer::from_iter(
            (0..10u32).map(|i| [0u32, 1, 5, 9].contains(&i)),
        ));
        let file = attach_plan(
            "test_parquet_row_mask",
            "files/org/logs/app/2026/01/01/00/indexed-v1-1.parquet",
            FileSelection::Rows(row_ids.clone()),
            None,
        )
        .await;

        let selection = file
            .extensions
            .get::<ParquetRowSelection>()
            .expect("Parquet row mask should be attached");
        let mask = selection
            .selection()
            .as_mask()
            .expect("selection is mask-backed");
        assert_eq!(mask, row_ids.as_ref());
        assert_eq!(mask.inner().as_ptr(), row_ids.inner().as_ptr());
    }

    #[tokio::test]
    async fn test_generate_access_plan_attaches_parquet_row_ranges() {
        let file = attach_plan(
            "test_parquet_row_ranges",
            "files/org/metrics/cpu/2026/01/01/00/indexed-v1-1.parquet",
            FileSelection::RowRanges(Arc::new(vec![1..3, 5..8, 10..12])),
            Some(14),
        )
        .await;

        let selection = file
            .extensions
            .get::<ParquetRowSelection>()
            .expect("Parquet row-range selection should be attached");
        let expected = RowSelection::from(vec![
            RowSelector::skip(1),
            RowSelector::select(2),
            RowSelector::skip(2),
            RowSelector::select(3),
            RowSelector::skip(2),
            RowSelector::select(2),
            RowSelector::skip(2),
        ]);
        assert_eq!(selection.selection(), &expected);
    }

    #[tokio::test]
    async fn test_generate_access_plan_skips_parquet_row_ranges_without_row_count() {
        let file = attach_plan(
            "test_parquet_row_ranges_no_stats",
            "files/org/metrics/cpu/2026/01/01/00/indexed-v1-2.parquet",
            FileSelection::RowRanges(Arc::new(vec![1..3, 5..6])),
            None,
        )
        .await;

        assert!(file.extensions.get::<ParquetRowSelection>().is_none());
    }

    #[tokio::test]
    async fn test_generate_access_plan_attaches_vortex_metrics_ranges() {
        let file = attach_plan(
            "test_vortex_metrics_ranges",
            "files/org/metrics/cpu/2026/01/01/00/indexed-v1-1.vortex",
            FileSelection::RowRanges(Arc::new(vec![1..3, 5..8])),
            Some(8),
        )
        .await;

        let plan = file
            .extensions
            .get::<VortexAccessPlan>()
            .expect("Vortex row-range plan should be attached");
        let Selection::IncludeRoaring(rows) = plan.selection().unwrap() else {
            panic!("expected roaring row selection")
        };
        assert_eq!(rows.iter().collect::<Vec<_>>(), vec![1, 2, 5, 6, 7]);
    }

    fn make_exec() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("col", DataType::Utf8, false)]));
        Arc::new(EmptyExec::new(schema))
    }

    #[test]
    fn test_apply_combined_filter_both_none_returns_input() {
        let exec = make_exec();
        let schema = exec.schema();
        let schema_ref: arrow_schema::Schema = schema.as_ref().clone();
        let result = apply_combined_filter(None, None, &schema_ref, &[], exec.clone(), None);
        assert!(result.is_ok());
        // should return the same plan (EmptyExec) since no filters
        let plan = result.unwrap();
        assert_eq!(plan.name(), "EmptyExec");
    }

    #[test]
    fn test_apply_projection_empty_diff_rules_returns_input() {
        use hashbrown::HashMap;

        let exec = make_exec();
        let schema = exec.schema();
        let diff_rules: HashMap<String, DataType> = HashMap::new();
        let result = apply_projection(&schema, &diff_rules, None, exec.clone());
        assert!(result.is_ok());
        let plan = result.unwrap();
        assert_eq!(plan.name(), "EmptyExec");
    }

    #[test]
    fn test_apply_combined_filter_timestamp_only_wraps_filter() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("col", DataType::Utf8, false),
        ]));
        let exec = Arc::new(EmptyExec::new(schema.clone())) as Arc<dyn ExecutionPlan>;
        let schema_ref: arrow_schema::Schema = schema.as_ref().clone();
        let result = apply_combined_filter(None, Some((1000, 2000)), &schema_ref, &[], exec, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().name(), "FilterExec");
    }

    #[test]
    fn test_apply_projection_with_diff_rules_produces_projection() {
        use hashbrown::HashMap;
        let schema = Arc::new(Schema::new(vec![Field::new("col", DataType::Utf8, false)]));
        let exec = Arc::new(EmptyExec::new(schema.clone())) as Arc<dyn ExecutionPlan>;
        let mut diff_rules: HashMap<String, DataType> = HashMap::new();
        diff_rules.insert("col".to_string(), DataType::LargeUtf8);
        let result = apply_projection(&schema, &diff_rules, None, exec);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().name(), "ProjectionExec");
    }
}
