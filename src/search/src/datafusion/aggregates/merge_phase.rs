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

//! Hash aggregation

use std::sync::Arc;

use arrow::{array::*, datatypes::SchemaRef};
use datafusion::{
    common::Result,
    logical_expr::{EmitTo, GroupsAccumulator},
    physical_expr::{GroupsAccumulatorAdapter, aggregate::AggregateFunctionExpr},
    physical_plan::{
        PhysicalExpr,
        aggregates::{
            AggregateExec, AggregateMode, PhysicalGroupBy, aggregate_expressions,
            evaluate_group_by, evaluate_many,
            group_values::{GroupValues, new_group_values},
            order::GroupOrdering,
        },
    },
};
use log::debug;

#[derive(Debug, Clone)]
/// This object tracks the aggregation phase (input/output)
pub(crate) enum ExecutionState {
    ReadingInput,
    /// When producing output, the remaining rows to output are stored
    /// here and are sliced off as needed in batch_size chunks
    ProducingOutput(RecordBatch),
    /// All input has been consumed and all groups have been emitted
    Done,
}

pub struct GroupedHashAggregateStream {
    // ========================================================================
    // PROPERTIES:
    // These fields are initialized at the start and remain constant throughout
    // the execution.
    // ========================================================================
    schema: SchemaRef,
    mode: AggregateMode,

    /// Arguments to pass to each accumulator.
    ///
    /// The arguments in `accumulator[i]` is passed `aggregate_arguments[i]`
    ///
    /// The argument to each accumulator is itself a `Vec` because
    /// some aggregates such as `CORR` can accept more than one
    /// argument.
    aggregate_arguments: Vec<Vec<Arc<dyn PhysicalExpr>>>,

    /// GROUP BY expressions
    group_by: PhysicalGroupBy,

    // ========================================================================
    // STATE FLAGS:
    // These fields will be updated during the execution. And control the flow of
    // the execution.
    // ========================================================================
    /// Tracks if this stream is generating input or output
    exec_state: ExecutionState,

    /// Have we seen the end of the input
    input_done: bool,

    // ========================================================================
    // STATE BUFFERS:
    // These fields will accumulate intermediate results during the execution.
    // ========================================================================
    /// An interning store of group keys
    group_values: Box<dyn GroupValues>,

    /// scratch space for the current input [`RecordBatch`] being
    /// processed. Reused across batches here to avoid reallocations
    current_group_indices: Vec<usize>,

    /// Accumulators, one for each `AggregateFunctionExpr` in the query
    ///
    /// For example, if the query has aggregates, `SUM(x)`,
    /// `COUNT(y)`, there will be two accumulators, each one
    /// specialized for that particular aggregate and its input types
    accumulators: Vec<Box<dyn GroupsAccumulator>>,
}

impl GroupedHashAggregateStream {
    /// Create a new GroupedHashAggregateStream
    pub fn new(agg: &AggregateExec) -> Result<Self> {
        debug!("Creating GroupedHashAggregateStream");
        let agg_schema = agg.input().schema();
        let agg_group_by = agg.group_expr().clone();
        let aggregate_exprs = agg.aggr_expr();
        let aggregate_arguments =
            aggregate_expressions(agg.aggr_expr(), agg.mode(), agg_group_by.num_group_exprs())?;

        // Instantiate the accumulators
        let accumulators: Vec<_> = aggregate_exprs
            .iter()
            .map(create_group_accumulator)
            .collect::<Result<_>>()?;

        let group_schema = agg_group_by.group_schema(&agg.input().schema())?;

        let group_values = new_group_values(group_schema, &GroupOrdering::None)?;

        let exec_state = ExecutionState::ReadingInput;

        Ok(GroupedHashAggregateStream {
            schema: agg_schema,
            mode: *agg.mode(),
            accumulators,
            aggregate_arguments,
            group_by: agg_group_by,
            group_values,
            current_group_indices: Default::default(),
            exec_state,
            input_done: false,
        })
    }

    pub fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
    }
}

/// Create an accumulator for `agg_expr` -- a [`GroupsAccumulator`] if
/// that is supported by the aggregate, or a
/// [`GroupsAccumulatorAdapter`] if not.
pub(crate) fn create_group_accumulator(
    agg_expr: &Arc<AggregateFunctionExpr>,
) -> Result<Box<dyn GroupsAccumulator>> {
    if agg_expr.groups_accumulator_supported() {
        agg_expr.create_groups_accumulator()
    } else {
        // Note in the log when the slow path is used
        debug!(
            "Creating GroupsAccumulatorAdapter for {}: {agg_expr:?}",
            agg_expr.name()
        );
        let agg_expr_captured = Arc::clone(agg_expr);
        let factory = move || agg_expr_captured.create_accumulator();
        Ok(Box::new(GroupsAccumulatorAdapter::new(factory)))
    }
}

impl GroupedHashAggregateStream {
    /// Perform group-by aggregation for the given [`RecordBatch`].
    pub fn group_aggregate_batch(&mut self, batch: RecordBatch) -> Result<()> {
        // Evaluate the grouping expressions
        let group_by_values = evaluate_group_by(&self.group_by, &batch)?;

        // Evaluate the aggregation expressions.
        let input_values = evaluate_many(&self.aggregate_arguments, &batch)?;

        for group_values in &group_by_values {
            // calculate the group indices for each input row
            self.group_values
                .intern(group_values, &mut self.current_group_indices)?;
            let group_indices = &self.current_group_indices;

            // Update ordering information if necessary
            let total_num_groups = self.group_values.len();

            // Gather the inputs to call the actual accumulator
            let t = self.accumulators.iter_mut().zip(input_values.iter());

            for (acc, values) in t {
                // Call the appropriate method on each aggregator with
                // the entire input row and the relevant group indexes
                match self.mode {
                    AggregateMode::Partial
                    | AggregateMode::Single
                    | AggregateMode::SinglePartitioned => {
                        acc.update_batch(values, group_indices, None, total_num_groups)?;
                    }
                    _ => {
                        // if aggregation is over intermediate states,
                        // use merge
                        acc.merge_batch(values, group_indices, total_num_groups)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Create an output RecordBatch with the group keys and
    /// accumulator states/values specified in emit_to
    fn emit(&mut self, emit_to: EmitTo) -> Result<Option<RecordBatch>> {
        let schema = self.schema();
        if self.group_values.is_empty() {
            return Ok(None);
        }

        let mut output = self.group_values.emit(emit_to)?;

        // Next output each aggregate value
        for acc in self.accumulators.iter_mut() {
            output.extend(acc.state(emit_to)?);
        }

        let batch = RecordBatch::try_new(schema, output)?;
        debug_assert!(batch.num_rows() > 0);
        Ok(Some(batch))
    }

    /// Clear memory and shirk capacities to the size of the batch.
    fn clear_shrink(&mut self, num_rows: usize) {
        self.group_values.clear_shrink(num_rows);
        self.current_group_indices.clear();
        self.current_group_indices.shrink_to(num_rows);
    }

    /// Clear memory and shirk capacities to zero.
    fn clear_all(&mut self) {
        self.clear_shrink(0);
    }

    /// common function for signalling end of processing of the input stream
    fn set_input_done_and_produce_output(&mut self) -> Result<()> {
        self.input_done = true;
        let batch = self.emit(EmitTo::All)?;
        self.exec_state = batch.map_or(ExecutionState::Done, ExecutionState::ProducingOutput);
        Ok(())
    }

    pub fn get_final_result(&mut self) -> Result<Vec<RecordBatch>> {
        self.set_input_done_and_produce_output()?;
        let batch = match &self.exec_state {
            ExecutionState::ProducingOutput(batch) => batch.clone(),
            _ => RecordBatch::new_empty(self.schema()),
        };
        self.exec_state = ExecutionState::Done;
        self.clear_all();

        // split the batch into multiple batches
        let num_rows = batch.num_rows();
        // early return for empty batches
        if num_rows == 0 {
            return Ok(vec![]);
        }
        // calculate optimal batch size and pre-allocate vector
        let batch_size = 8192;
        let full_batches = num_rows / batch_size;
        let has_remaining = !num_rows.is_multiple_of(batch_size);
        let total_batches = full_batches + if has_remaining { 1 } else { 0 };
        let mut result_vec = Vec::with_capacity(total_batches);
        for i in 0..full_batches {
            result_vec.push(batch.slice(i * batch_size, batch_size));
        }
        if has_remaining {
            let start_idx = full_batches * batch_size;
            let remaining_rows = num_rows - start_idx;
            result_vec.push(batch.slice(start_idx, remaining_rows));
        }

        Ok(result_vec)
    }
}
