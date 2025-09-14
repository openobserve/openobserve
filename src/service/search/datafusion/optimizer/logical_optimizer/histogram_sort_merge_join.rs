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

use std::{fmt, sync::Arc};

use datafusion::{
    common::{DFSchemaRef, Result},
    logical_expr::{Expr, LogicalPlan, UserDefinedLogicalNodeCore},
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder},
    prelude::JoinType,
};

/// Logical node representing a histogram-based sort-merge join
#[derive(Debug)]
pub struct HistogramJoinNode {
    pub left: LogicalPlan,
    pub right: LogicalPlan,
    pub left_time_column: String,
    pub right_time_column: String,
    pub join_columns: Vec<(String, String)>,
    pub time_bin_interval: String,
    pub join_type: JoinType,
    pub filter: Option<Expr>,
    pub schema: DFSchemaRef,
}

impl PartialEq for HistogramJoinNode {
    fn eq(&self, other: &Self) -> bool {
        self.left == other.left
            && self.right == other.right
            && self.left_time_column == other.left_time_column
            && self.right_time_column == other.right_time_column
            && self.join_columns == other.join_columns
            && self.time_bin_interval == other.time_bin_interval
            && self.join_type == other.join_type
            && self.filter == other.filter
            // Compare schema fields for equality
            && self.schema.fields() == other.schema.fields()
    }
}

impl Eq for HistogramJoinNode {}

impl std::hash::Hash for HistogramJoinNode {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.left.hash(state);
        self.right.hash(state);
        self.left_time_column.hash(state);
        self.right_time_column.hash(state);
        self.join_columns.hash(state);
        self.time_bin_interval.hash(state);
        self.join_type.hash(state);
        self.filter.hash(state);
        // Hash schema fields
        for field in self.schema.fields() {
            field.name().hash(state);
            field.data_type().hash(state);
        }
    }
}

impl PartialOrd for HistogramJoinNode {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HistogramJoinNode {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.left_time_column.cmp(&other.left_time_column)
            .then_with(|| self.right_time_column.cmp(&other.right_time_column))
            .then_with(|| self.time_bin_interval.cmp(&other.time_bin_interval))
    }
}

impl HistogramJoinNode {
    pub fn new(
        left: LogicalPlan,
        right: LogicalPlan,
        left_time_column: String,
        right_time_column: String,
        join_columns: Vec<(String, String)>,
        time_bin_interval: String,
        join_type: JoinType,
        filter: Option<Expr>,
        schema: DFSchemaRef,
    ) -> Self {
        Self {
            left,
            right,
            left_time_column,
            right_time_column,
            join_columns,
            time_bin_interval,
            join_type,
            filter,
            schema,
        }
    }
}

impl UserDefinedLogicalNodeCore for HistogramJoinNode {
    fn name(&self) -> &str {
        "HistogramJoin"
    }

    fn inputs(&self) -> Vec<&LogicalPlan> {
        vec![&self.left, &self.right]
    }

    fn schema(&self) -> &DFSchemaRef {
        &self.schema
    }

    fn expressions(&self) -> Vec<Expr> {
        if let Some(filter) = &self.filter {
            vec![filter.clone()]
        } else {
            vec![]
        }
    }

    fn fmt_for_explain(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "HistogramJoin: left_time={}, right_time={}, interval={}, join_cols={:?}",
            self.left_time_column,
            self.right_time_column,
            self.time_bin_interval,
            self.join_columns
        )
    }

    fn with_exprs_and_inputs(
        &self,
        exprs: Vec<Expr>,
        inputs: Vec<LogicalPlan>,
    ) -> Result<Self> {
        if inputs.len() != 2 {
            return Err(datafusion::common::DataFusionError::Internal(
                "HistogramJoinNode requires exactly 2 inputs".to_string(),
            ));
        }

        Ok(HistogramJoinNode {
            left: inputs[0].clone(),
            right: inputs[1].clone(),
            left_time_column: self.left_time_column.clone(),
            right_time_column: self.right_time_column.clone(),
            join_columns: self.join_columns.clone(),
            time_bin_interval: self.time_bin_interval.clone(),
            join_type: self.join_type,
            filter: exprs.into_iter().next(),
            schema: self.schema.clone(),
        })
    }
}

/// Optimizer rule that converts regular joins to histogram-based sort-merge joins
/// when time-based binning is beneficial
/// 
/// This rule uses the histogram interval from the SQL query context to determine
/// the appropriate time binning interval for the join operation. The interval
/// is extracted from the Sql struct's histogram_interval field and converted
/// to a human-readable string format.
/// 
/// Example:
/// - If sql.histogram_interval = Some(300), the rule will use "5 minutes"
/// - If sql.histogram_interval = Some(3600), the rule will use "1 hour"
/// - If sql.histogram_interval = None, the rule will use a default interval
#[derive(Debug)]
pub struct HistogramSortMergeJoinRule {
    histogram_interval: Option<i64>,
}

impl HistogramSortMergeJoinRule {
    pub fn new(histogram_interval: Option<i64>) -> Self {
        Self {
            histogram_interval,
        }
    }
}

impl OptimizerRule for HistogramSortMergeJoinRule {
    fn name(&self) -> &str {
        "histogram_sort_merge_join"
    }

    fn apply_order(&self) -> Option<ApplyOrder> {
        Some(ApplyOrder::TopDown)
    }

    fn supports_rewrite(&self) -> bool {
        true
    }

    fn rewrite(
        &self,
        plan: LogicalPlan,
        _config: &dyn OptimizerConfig,
    ) -> Result<datafusion::common::tree_node::Transformed<LogicalPlan>> {
        match plan {
            LogicalPlan::Join(join) => {
                // Check if this join can benefit from histogram-based processing
                if self.should_use_histogram_join(&join) {
                    log::info!("HistogramSortMergeJoinRule: Converting join to histogram join");

                    // Extract actual time columns from the join schemas
                    let (left_time_col, right_time_col) = self.find_time_columns(&join.left, &join.right);

                    // Extract histogram interval from query context if available (default to 5 minutes)
                    let interval = self.extract_histogram_interval().unwrap_or("5 minutes".to_string());

                    log::info!("HistogramSortMergeJoinRule: Using time columns left='{}', right='{}', interval='{}'",
                        left_time_col, right_time_col, interval);

                    let histogram_join = HistogramJoinNode::new(
                        (*join.left).clone(),
                        (*join.right).clone(),
                        left_time_col,
                        right_time_col,
                        self.extract_join_columns(&join.on),
                        interval,
                        join.join_type,
                        join.filter,
                        join.schema.clone(),
                    );

                    return Ok(datafusion::common::tree_node::Transformed::yes(
                        LogicalPlan::Extension(datafusion::logical_expr::Extension { 
                            node: Arc::new(histogram_join) 
                        }),
                    ));
                }
                Ok(datafusion::common::tree_node::Transformed::no(LogicalPlan::Join(join)))
            }
            _ => Ok(datafusion::common::tree_node::Transformed::no(plan)),
        }
    }
}

impl HistogramSortMergeJoinRule {
    /// Determine if a join should use histogram-based processing
    fn should_use_histogram_join(&self, join: &datafusion::logical_expr::Join) -> bool {
        log::info!("HistogramSortMergeJoinRule: Evaluating join - type: {:?}, left_has_ts: {}, right_has_ts: {}",
            join.join_type,
            self.has_timestamp_columns(&join.left),
            self.has_timestamp_columns(&join.right)
        );

        // Use histogram join for inner joins with time-based data
        // We'll be more aggressive and convert any inner join with timestamp columns
        // since the histogram function might be in projections above the join
        let should_use = matches!(join.join_type, JoinType::Inner) &&
            self.has_timestamp_columns(&join.left) &&
            self.has_timestamp_columns(&join.right);

        log::info!("HistogramSortMergeJoinRule: Should use histogram join: {}", should_use);
        should_use
    }

    /// Check if a plan has timestamp columns
    fn has_timestamp_columns(&self, plan: &LogicalPlan) -> bool {
        let schema = plan.schema();
        schema.fields().iter().any(|field| {
            field.name().contains("timestamp") || 
            field.name() == "_timestamp" ||
            matches!(field.data_type(), arrow_schema::DataType::Timestamp(_, _))
        })
    }


    /// Extract join column pairs from join conditions
    fn extract_join_columns(&self, on: &[(Expr, Expr)]) -> Vec<(String, String)> {
        on.iter()
            .filter_map(|(left, right)| {
                if let (Expr::Column(left_col), Expr::Column(right_col)) = (left, right) {
                    Some((left_col.name.clone(), right_col.name.clone()))
                } else {
                    None
                }
            })
            .collect()
    }

    /// Find actual time columns from join plans (handles aliases like a._timestamp, b._timestamp)
    fn find_time_columns(&self, left_plan: &LogicalPlan, right_plan: &LogicalPlan) -> (String, String) {
        let left_time_col = self.find_time_column_in_plan(left_plan)
            .unwrap_or_else(|| "_timestamp".to_string());
        let right_time_col = self.find_time_column_in_plan(right_plan)
            .unwrap_or_else(|| "_timestamp".to_string());

        (left_time_col, right_time_col)
    }

    /// Find timestamp column in a logical plan
    fn find_time_column_in_plan(&self, plan: &LogicalPlan) -> Option<String> {
        let schema = plan.schema();

        // Look for timestamp columns with various patterns
        for field in schema.fields() {
            let name = field.name();
            if name.contains("timestamp") ||
               name == "_timestamp" ||
               name.ends_with("._timestamp") ||
               matches!(field.data_type(), arrow_schema::DataType::Timestamp(_, _)) {
                return Some(name.clone());
            }
        }

        None
    }

    /// Extract histogram interval from query context
    /// 
    /// This method converts the histogram interval from seconds (as stored in the Sql struct)
    /// to a human-readable string format (e.g., "5 minutes", "1 hour", "2 days").
    /// The interval is used for time-based binning in histogram sort-merge joins.
    fn extract_histogram_interval(&self) -> Option<String> {
        use crate::service::search::sql::visitor::histogram_interval::convert_seconds_to_interval_string;
        
        self.histogram_interval.map(convert_seconds_to_interval_string)
    }
}

