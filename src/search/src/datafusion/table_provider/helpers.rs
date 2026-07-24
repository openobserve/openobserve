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

use std::{ops::Range, sync::Arc};

use arrow::buffer::BooleanBuffer;
use arrow_schema::{DataType, SchemaRef};
use config::{FileFormat, TIMESTAMP_COL_NAME, meta::stream::FileSelection};
use datafusion::{
    common::{DataFusionError, Result, project_schema, stats::Precision},
    datasource::{listing::PartitionedFile, physical_plan::parquet::ParquetAccessPlan},
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
use o2_enterprise::enterprise::search::sampling::execution::generate_row_group_access_plan;

use crate::{
    datafusion::{storage, vortex::generate_vortex_access_plan},
    index::IndexCondition,
};

/// Row group size used by writers before the `row_group_size` puffin property
/// existed. Any .ttv file without the property was produced with this value.
const LEGACY_ROW_GROUP_SIZE: usize = 1024 * 1024;

/// Attach the access plan for this file as a typed [`PartitionedFile`] extension.
pub fn generate_access_plan(file: &mut PartitionedFile) {
    let Some(storage::file_list::ScanSelection {
        selection,
        row_group_size,
    }) = storage::file_list::get_scan_selection(file.path().as_ref())
    else {
        return;
    };

    let Some(file_format) = FileFormat::from_extension(file.path().as_ref()) else {
        return;
    };

    match file_format {
        FileFormat::Parquet => match selection {
            FileSelection::Rows(row_ids) => {
                if let Some(access_plan) =
                    generate_parquet_access_plan(file, &row_ids, row_group_size)
                {
                    file.extensions.insert(access_plan);
                }
            }
            #[cfg(feature = "enterprise")]
            FileSelection::RowGroups(row_group_ids) => {
                if let Some((num_rows, row_group_size)) = parquet_file_layout(file, row_group_size)
                {
                    let access_plan = generate_row_group_access_plan(
                        &row_group_ids,
                        num_rows.div_ceil(row_group_size),
                        file.path().as_ref(),
                    );
                    file.extensions.insert_arc(access_plan);
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
            // row-group sampling is parquet only; vortex falls back to a full scan
            FileSelection::RowGroups(_) => {}
        },
    }
}

fn generate_parquet_access_plan(
    file: &PartitionedFile,
    row_ids: &BooleanBuffer,
    row_group_size: Option<u32>,
) -> Option<ParquetAccessPlan> {
    let (num_rows, row_group_size) = parquet_file_layout(file, row_group_size)?;
    let row_group_count = num_rows.div_ceil(row_group_size);

    let mut access_plan = ParquetAccessPlan::new_none(row_group_count);
    let mut row_group_selection =
        RowGroupSelectionBuilder::new(&mut access_plan, row_group_size, num_rows);

    for (start, end) in row_ids.set_slices() {
        if end > num_rows {
            unreachable!("row_ids set slice end {end} exceeds num_rows {num_rows}");
        }

        row_group_selection.push_selected_range(start, end);
    }
    row_group_selection.finish();

    log::debug!(
        "file path: file={:?}, row_group_count={row_group_count}, access_plan={access_plan:?}",
        file.path().as_ref()
    );
    Some(access_plan)
}

struct RowGroupSelectionBuilder<'a> {
    access_plan: &'a mut ParquetAccessPlan,
    row_group_size: usize,
    num_rows: usize,
    current_row_group: Option<usize>,
    current_ranges: Vec<Range<usize>>,
}

impl<'a> RowGroupSelectionBuilder<'a> {
    fn new(access_plan: &'a mut ParquetAccessPlan, row_group_size: usize, num_rows: usize) -> Self {
        Self {
            access_plan,
            row_group_size,
            num_rows,
            current_row_group: None,
            current_ranges: Vec::new(),
        }
    }

    fn push_selected_range(&mut self, mut start: usize, end: usize) {
        while start < end {
            let row_group_id = start / self.row_group_size;
            let row_group_start = row_group_id * self.row_group_size;
            let row_group_end = (row_group_start + self.row_group_size).min(self.num_rows);
            let selected_end = end.min(row_group_end);

            self.start_row_group(row_group_id);
            self.current_ranges
                .push((start - row_group_start)..(selected_end - row_group_start));
            start = selected_end;
        }
    }

    fn finish(mut self) {
        self.flush();
    }

    fn start_row_group(&mut self, row_group_id: usize) {
        if self.current_row_group == Some(row_group_id) {
            return;
        }

        self.flush();
        self.current_row_group = Some(row_group_id);
    }

    fn flush(&mut self) {
        let Some(row_group_id) = self.current_row_group else {
            return;
        };

        let row_group_start = row_group_id * self.row_group_size;
        let row_group_len =
            (row_group_start + self.row_group_size).min(self.num_rows) - row_group_start;

        self.access_plan.scan(row_group_id);
        self.access_plan.scan_selection(
            row_group_id,
            RowSelection::from_consecutive_ranges(
                std::mem::take(&mut self.current_ranges).into_iter(),
                row_group_len,
            ),
        );
        self.current_row_group = None;
    }
}

/// Exact row count of the file and the row group size.
fn parquet_file_layout(
    file: &PartitionedFile,
    row_group_size: Option<u32>,
) -> Option<(usize, usize)> {
    let stats = file.statistics.as_ref()?;
    let Precision::Exact(num_rows) = stats.num_rows else {
        return None;
    };
    let row_group_size = row_group_size
        .map(|v| v as usize)
        .unwrap_or(LEGACY_ROW_GROUP_SIZE);
    Some((num_rows, row_group_size))
}

pub fn apply_projection(
    schema: &SchemaRef,
    diff_rules: &HashMap<String, DataType>,
    projection: Option<&Vec<usize>>,
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
        let col = Arc::new(datafusion::physical_expr::expressions::Column::new(
            &name, idx,
        ));
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
    filter_projection: Option<&Vec<usize>>,
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
            .apply_projection(filter_projection.cloned())?
            .build()?,
    ))
}

#[cfg(test)]
mod tests {
    use arrow::datatypes::{DataType, Field, Schema};
    use datafusion::{common::Statistics, parquet::arrow::arrow_reader::RowSelector};

    use super::*;

    fn make_partitioned_file(num_rows: usize) -> PartitionedFile {
        let mut file = PartitionedFile::new("test.parquet".to_string(), 100);
        let mut stats = Statistics::new_unknown(&Schema::empty());
        stats.num_rows = Precision::Exact(num_rows);
        file.statistics = Some(Arc::new(stats));
        file
    }

    #[test]
    fn test_generate_parquet_access_plan_from_sorted_row_ids() {
        // 10 rows, row groups of 4: rg0=[0..4), rg1=[4..8), rg2=[8..10)
        let file = make_partitioned_file(10);
        let row_ids = BooleanBuffer::from_iter((0..10u32).map(|i| [0u32, 1, 5, 9].contains(&i)));

        let plan = generate_parquet_access_plan(&file, &row_ids, Some(4)).unwrap();

        let mut expected = ParquetAccessPlan::new_none(3);
        expected.scan(0);
        expected.scan_selection(
            0,
            RowSelection::from(vec![RowSelector::select(2), RowSelector::skip(2)]),
        );
        expected.scan(1);
        expected.scan_selection(
            1,
            RowSelection::from(vec![
                RowSelector::skip(1),
                RowSelector::select(1),
                RowSelector::skip(2),
            ]),
        );
        expected.scan(2);
        expected.scan_selection(
            2,
            RowSelection::from(vec![RowSelector::skip(1), RowSelector::select(1)]),
        );
        assert_eq!(plan, expected);
    }

    #[test]
    fn test_generate_parquet_access_plan_skips_untouched_row_groups() {
        // only the middle row group has matches
        let file = make_partitioned_file(12);
        let row_ids = BooleanBuffer::from_iter((0..12u32).map(|i| [4u32, 5, 6, 7].contains(&i)));

        let plan = generate_parquet_access_plan(&file, &row_ids, Some(4)).unwrap();

        let mut expected = ParquetAccessPlan::new_none(3);
        expected.scan(1);
        expected.scan_selection(1, RowSelection::from(vec![RowSelector::select(4)]));
        assert_eq!(plan, expected);
    }

    #[test]
    fn test_generate_parquet_access_plan_keeps_disjoint_ranges_in_same_row_group() {
        let file = make_partitioned_file(8);
        let row_ids = BooleanBuffer::from_iter((0..8u32).map(|i| [0u32, 2].contains(&i)));

        let plan = generate_parquet_access_plan(&file, &row_ids, Some(4)).unwrap();

        let mut expected = ParquetAccessPlan::new_none(2);
        expected.scan(0);
        expected.scan_selection(
            0,
            RowSelection::from(vec![
                RowSelector::select(1),
                RowSelector::skip(1),
                RowSelector::select(1),
                RowSelector::skip(1),
            ]),
        );
        assert_eq!(plan, expected);
    }

    #[test]
    fn test_generate_parquet_access_plan_run_crossing_row_group_boundary() {
        // a consecutive run 2..=5 spans rg0 [0..4) and rg1 [4..8); it must be
        // split at the boundary so both row groups get their own selection
        let file = make_partitioned_file(10);
        let row_ids = BooleanBuffer::from_iter((0..10u32).map(|i| [2u32, 3, 4, 5].contains(&i)));

        let plan = generate_parquet_access_plan(&file, &row_ids, Some(4)).unwrap();

        let mut expected = ParquetAccessPlan::new_none(3);
        expected.scan(0);
        expected.scan_selection(
            0,
            RowSelection::from(vec![RowSelector::skip(2), RowSelector::select(2)]),
        );
        expected.scan(1);
        expected.scan_selection(
            1,
            RowSelection::from(vec![RowSelector::select(2), RowSelector::skip(2)]),
        );
        assert_eq!(plan, expected);
    }

    fn make_exec() -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("col", DataType::Utf8, false)]));
        Arc::new(datafusion::physical_plan::empty::EmptyExec::new(schema))
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
        use arrow_schema::{Field, Schema};
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("col", DataType::Utf8, false),
        ]));
        let exec = Arc::new(datafusion::physical_plan::empty::EmptyExec::new(
            schema.clone(),
        )) as Arc<dyn ExecutionPlan>;
        let schema_ref: arrow_schema::Schema = schema.as_ref().clone();
        let result = apply_combined_filter(None, Some((1000, 2000)), &schema_ref, &[], exec, None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().name(), "FilterExec");
    }

    #[test]
    fn test_apply_projection_with_diff_rules_produces_projection() {
        use arrow_schema::{Field, Schema};
        use hashbrown::HashMap;
        let schema = Arc::new(Schema::new(vec![Field::new("col", DataType::Utf8, false)]));
        let exec = Arc::new(datafusion::physical_plan::empty::EmptyExec::new(
            schema.clone(),
        )) as Arc<dyn ExecutionPlan>;
        let mut diff_rules: HashMap<String, DataType> = HashMap::new();
        diff_rules.insert("col".to_string(), DataType::LargeUtf8);
        let result = apply_projection(&schema, &diff_rules, None, exec);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().name(), "ProjectionExec");
    }
}
