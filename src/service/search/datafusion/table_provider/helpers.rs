// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

// Copyright 2025 OpenObserve Inc.
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

//! Helper functions for the table implementation

use std::sync::Arc;

use arrow_schema::{DataType, SchemaRef};
use config::{PARQUET_MAX_ROW_GROUP_SIZE, TIMESTAMP_COL_NAME};
use datafusion::{
    common::{DataFusionError, Result, project_schema, stats::Precision},
    datasource::{listing::PartitionedFile, physical_plan::parquet::ParquetAccessPlan},
    logical_expr::Operator,
    parquet::arrow::arrow_reader::{RowSelection, RowSelector},
    physical_expr::conjunction,
    physical_plan::{
        ExecutionPlan, PhysicalExpr,
        expressions::{BinaryExpr, CastExpr, Column, Literal},
        filter::FilterExec,
        projection::ProjectionExec,
    },
    scalar::ScalarValue,
};
use hashbrown::HashMap;

use crate::service::search::{datafusion::storage, index::IndexCondition};

pub fn generate_access_plan(file: &PartitionedFile) -> Option<Arc<ParquetAccessPlan>> {
    let segment_ids = storage::file_list::get_segment_ids(file.path().as_ref())?;
    let stats = file.statistics.as_ref()?;
    let Precision::Exact(num_rows) = stats.num_rows else {
        return None;
    };
    let row_group_count = num_rows.div_ceil(PARQUET_MAX_ROW_GROUP_SIZE);

    // Determine sampling mode based on BitVec size:
    // - If BitVec size == row_group_count: row-group-level sampling (enterprise feature)
    // - If BitVec size == num_rows: row-level sampling (original behavior)

    #[cfg(feature = "enterprise")]
    if segment_ids.len() == row_group_count {
        // Row-group-level sampling: each bit represents a row group
        return Some(
            o2_enterprise::enterprise::search::sampling::execution::generate_row_group_access_plan(
                &segment_ids,
                row_group_count,
                file.path().as_ref(),
            ),
        );
    }

    // Row-level sampling: each bit represents a row (original behavior)
    let mut access_plan = ParquetAccessPlan::new_none(row_group_count);

    for (row_group_id, chunk) in segment_ids.chunks(PARQUET_MAX_ROW_GROUP_SIZE).enumerate() {
        let mut selection = Vec::new();
        let mut current_count = 0;
        let mut current_select = false;

        for val in chunk
            .iter()
            .take(num_rows - row_group_id * PARQUET_MAX_ROW_GROUP_SIZE)
        {
            if *val == current_select {
                current_count += 1;
            } else {
                if current_count > 0 {
                    if current_select {
                        selection.push(RowSelector::select(current_count));
                    } else {
                        selection.push(RowSelector::skip(current_count));
                    }
                }
                current_select = *val;
                current_count = 1;
            }
        }

        // handle the last batch
        if current_count > 0 {
            if current_select {
                selection.push(RowSelector::select(current_count));
            } else {
                selection.push(RowSelector::skip(current_count));
            }
        }

        if selection.iter().any(|s| !s.skip) {
            access_plan.scan(row_group_id);
            access_plan.scan_selection(row_group_id, RowSelection::from(selection));
        }
    }

    log::debug!(
        "file path: file={:?}, row_group_count={}, access_plan={:?}",
        file.path().as_ref(),
        row_group_count,
        access_plan
    );
    Some(Arc::new(access_plan))
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
        FilterExec::try_new(combined_expr, exec_plan)?
            .with_projection(filter_projection.cloned())?,
    ))
}
