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

//! Aggregate without grouping columns

use std::{borrow::Cow, sync::Arc};

use arrow::{array::ArrayRef, datatypes::SchemaRef, record_batch::RecordBatch};
use datafusion::{
    common::Result,
    physical_plan::{
        PhysicalExpr,
        aggregates::{
            AccumulatorItem, AggregateExec, AggregateMode, aggregate_expressions,
            create_accumulators,
        },
        filter::batch_filter,
    },
};
use itertools::Itertools;

/// stream struct for aggregation without grouping columns
pub struct AggregateStream {
    schema: SchemaRef,
    mode: AggregateMode,
    aggregate_expressions: Vec<Vec<Arc<dyn PhysicalExpr>>>,
    filter_expressions: Vec<Option<Arc<dyn PhysicalExpr>>>,
    accumulators: Vec<AccumulatorItem>,
}

impl AggregateStream {
    /// Create a new AggregateStream
    pub fn new(agg: &AggregateExec) -> Result<Self> {
        let agg_schema = agg.input().schema();
        let agg_filter_expr = agg.filter_expr().to_vec();

        let aggregate_expressions = aggregate_expressions(agg.aggr_expr(), agg.mode(), 0)?;
        let filter_expressions = match *agg.mode() {
            AggregateMode::Partial | AggregateMode::Single | AggregateMode::SinglePartitioned => {
                agg_filter_expr
            }
            AggregateMode::Final
            | AggregateMode::FinalPartitioned
            | AggregateMode::PartialReduce => {
                vec![None; agg.aggr_expr().len()]
            }
        };
        let accumulators = create_accumulators(agg.aggr_expr())?;

        Ok(AggregateStream {
            schema: agg_schema,
            mode: *agg.mode(),
            aggregate_expressions,
            filter_expressions,
            accumulators,
        })
    }

    pub fn aggregate_batch(&mut self, batch: RecordBatch) -> Result<()> {
        let _ = aggregate_batch(
            &self.mode,
            batch,
            &mut self.accumulators,
            &self.aggregate_expressions,
            &self.filter_expressions,
        )?;

        Ok(())
    }

    pub fn finalize_aggregation(&mut self) -> Result<Vec<RecordBatch>> {
        let result = finalize_aggregation(&mut self.accumulators)?;
        let batch = RecordBatch::try_new(Arc::clone(&self.schema), result)?;

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

fn aggregate_batch(
    mode: &AggregateMode,
    batch: RecordBatch,
    accumulators: &mut [AccumulatorItem],
    expressions: &[Vec<Arc<dyn PhysicalExpr>>],
    filters: &[Option<Arc<dyn PhysicalExpr>>],
) -> Result<usize> {
    let mut allocated = 0usize;

    // 1.1 iterate accumulators and respective expressions together
    // 1.2 filter the batch if necessary
    // 1.3 evaluate expressions
    // 1.4 update / merge accumulators with the expressions' values

    // 1.1
    accumulators
        .iter_mut()
        .zip(expressions)
        .zip(filters)
        .try_for_each(|((accum, expr), filter)| {
            // 1.2
            let batch = match filter {
                Some(filter) => Cow::Owned(batch_filter(&batch, filter)?),
                None => Cow::Borrowed(&batch),
            };

            // 1.3
            let values = &expr
                .iter()
                .map(|e| {
                    e.evaluate(&batch)
                        .and_then(|v| v.into_array(batch.num_rows()))
                })
                .collect::<Result<Vec<_>>>()?;

            // 1.4
            let size_pre = accum.size();
            let res = match mode {
                AggregateMode::Partial
                | AggregateMode::Single
                | AggregateMode::SinglePartitioned => accum.update_batch(values),
                AggregateMode::Final
                | AggregateMode::FinalPartitioned
                | AggregateMode::PartialReduce => accum.merge_batch(values),
            };
            let size_post = accum.size();
            allocated += size_post.saturating_sub(size_pre);
            res
        })?;

    Ok(allocated)
}

fn finalize_aggregation(accumulators: &mut [AccumulatorItem]) -> Result<Vec<ArrayRef>> {
    // Build the vector of states
    accumulators
        .iter_mut()
        .map(|accumulator| {
            accumulator.state().and_then(|e| {
                e.iter()
                    .map(|v| v.to_array())
                    .collect::<Result<Vec<ArrayRef>>>()
            })
        })
        .flatten_ok()
        .collect()
}
