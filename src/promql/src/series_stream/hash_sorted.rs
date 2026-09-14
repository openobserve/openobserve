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

//! The hash-sorted stream: one partition's hash-ordered chains read one series at a time, the
//! minimum head hash across chains being the next series.

use std::{hash::Hasher, sync::Arc};

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        HASH_LABEL, VALUE_LABEL,
        value::{Labels, Sample},
    },
    utils::hash::gxhash,
};
use datafusion::{
    arrow::{
        array::{AsArray, RecordBatch},
        datatypes::{Float64Type, Int64Type, UInt64Type},
    },
    error::{DataFusionError, Result},
    execution::SendableRecordBatchStream,
};
use futures::TryStreamExt;

use super::SeriesStream;
use crate::{
    series_loader::label_interner::{LabelColumn, LabelInterner},
    utils::batch_run_len,
};

/// One partition's series stream; every chain holds one run per series, so the minimum head hash is
/// the next series.
pub(crate) struct HashSortedSeriesStream {
    cursors: Vec<ChainCursor>,
    group_cols: Arc<Vec<String>>,
    /// One interner per group column, so the emitted series share label allocations.
    interners: Vec<LabelInterner>,
    offset: i64,
    /// Hash of the series `advance` yielded, until `consume` takes it.
    current: Option<u64>,
    samples: Vec<Sample>,
}

impl HashSortedSeriesStream {
    pub(super) async fn start(
        streams: Vec<SendableRecordBatchStream>,
        group_cols: Arc<Vec<String>>,
        offset: i64,
    ) -> Result<Self> {
        let mut cursors = Vec::with_capacity(streams.len());
        for stream in streams {
            cursors.push(ChainCursor::start(stream).await?);
        }
        let interners = group_cols
            .iter()
            .map(|name| LabelInterner::new(name.clone()))
            .collect();
        Ok(Self {
            cursors,
            group_cols,
            interners,
            offset,
            current: None,
            samples: Vec::new(),
        })
    }

    /// The head batch and row of the first chain holding the current series.
    fn head(&self) -> (&RecordBatch, usize) {
        let hash = self.current.expect("a series is current");
        let cursor = self
            .cursors
            .iter()
            .find(|cursor| cursor.head_hash() == Some(hash))
            .expect("the minimum head hash has a contributing chain");
        let batch = cursor.batch.as_ref().expect("head_hash implies a batch");
        (batch, cursor.row)
    }

    fn label_columns<'a>(&self, batch: &'a RecordBatch) -> Result<Vec<LabelColumn<'a>>> {
        self.group_cols
            .iter()
            .map(|name| {
                LabelColumn::try_from_array(batch[name.as_str()].as_ref()).ok_or_else(|| {
                    DataFusionError::Execution(format!(
                        "label column {name} is not Utf8 or Utf8View"
                    ))
                })
            })
            .collect()
    }
}

impl SeriesStream for HashSortedSeriesStream {
    async fn advance(&mut self) -> Result<Option<u64>> {
        let Some(hash) = self.cursors.iter().filter_map(ChainCursor::head_hash).min() else {
            self.current = None;
            return Ok(None);
        };
        self.current = Some(hash);
        let (batch, row) = self.head();
        let cols = self.label_columns(batch)?;
        let mut hasher = gxhash::new_hasher();
        for (values, name) in cols.iter().zip(self.group_cols.iter()) {
            if !values.is_null(row) {
                hasher.write(name.as_bytes());
                hasher.write(values.value(row).as_bytes());
            }
        }
        Ok(Some(hasher.finish()))
    }

    fn labels(&mut self) -> Labels {
        let (batch, row) = self.head();
        let batch = batch.clone();
        let cols = self
            .label_columns(&batch)
            .expect("advance validated the group columns");
        cols.iter()
            .zip(self.interners.iter_mut())
            .filter(|(values, _)| !values.is_null(row))
            .map(|(values, interner)| interner.intern(values.value(row)))
            .collect()
    }

    async fn consume(&mut self) -> Result<&[Sample]> {
        let hash = self.current.take().expect("advance yielded a series");
        self.samples.clear();
        for cursor in &mut self.cursors {
            if cursor.head_hash() == Some(hash) {
                cursor
                    .consume_run(hash, self.offset, &mut self.samples)
                    .await?;
            }
        }
        // classic parity: chains interleave in time, so restore per-series order
        self.samples.sort_unstable_by_key(|sample| sample.timestamp);
        Ok(&self.samples)
    }
}

/// One hash-ordered chain of non-overlapping files; a series is a single run per chain.
struct ChainCursor {
    stream: SendableRecordBatchStream,
    batch: Option<RecordBatch>,
    row: usize,
}

impl ChainCursor {
    async fn start(stream: SendableRecordBatchStream) -> Result<Self> {
        let mut cursor = Self {
            stream,
            batch: None,
            row: 0,
        };
        cursor.next_batch().await?;
        Ok(cursor)
    }

    fn head_hash(&self) -> Option<u64> {
        let batch = self.batch.as_ref()?;
        Some(batch[HASH_LABEL].as_primitive::<UInt64Type>().values()[self.row])
    }

    async fn next_batch(&mut self) -> Result<()> {
        self.row = 0;
        loop {
            match self.stream.try_next().await? {
                Some(batch) if batch.num_rows() == 0 => continue,
                batch => {
                    self.batch = batch;
                    return Ok(());
                }
            }
        }
    }

    /// Appends this chain's samples of series `hash`, following the run across
    /// batch boundaries until the hash changes or the chain ends.
    async fn consume_run(
        &mut self,
        hash: u64,
        offset: i64,
        samples: &mut Vec<Sample>,
    ) -> Result<()> {
        while let Some(batch) = &self.batch {
            let hashes = batch[HASH_LABEL].as_primitive::<UInt64Type>().values();
            if hashes[self.row] != hash {
                return Ok(());
            }
            let run_len = batch_run_len(hashes, self.row);
            let times = batch[TIMESTAMP_COL_NAME]
                .as_primitive::<Int64Type>()
                .values();
            let values = batch[VALUE_LABEL].as_primitive::<Float64Type>().values();
            samples.extend(
                times[self.row..self.row + run_len]
                    .iter()
                    .zip(&values[self.row..self.row + run_len])
                    .map(|(&timestamp, &value)| Sample::new(timestamp + offset, value)),
            );
            self.row += run_len;
            if self.row < hashes.len() {
                return Ok(());
            }
            self.next_batch().await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use config::meta::promql::value::Value;
    use hashbrown::HashSet;

    use super::super::{matrix::group_sources, plan::series_label_columns, tests::*};
    use crate::{
        functions::{self, RangeFunc},
        streaming_eval::{FusedAggOp, RangeExpr, aggregate, eval_range, tests::*},
    };

    #[tokio::test]
    async fn test_streaming_matches_fused_for_all_pairs() {
        let ctx = session_ctx();
        register_sorted_table(&ctx);
        let range = Duration::from_secs(60);

        let agg_cases = [
            FusedAggOp::Avg,
            FusedAggOp::Count,
            FusedAggOp::Group,
            FusedAggOp::Max,
            FusedAggOp::Min,
            FusedAggOp::Stddev,
            FusedAggOp::Stdvar,
            FusedAggOp::Sum,
        ];
        let func_cases = ["rate", "increase", "sum_over_time", "last_over_time"];
        let modifiers = [
            None,
            by(&["path"]),
            by(&["instance", "path"]),
            by(&["nope"]),
        ];

        for op in agg_cases {
            for func_name in func_cases {
                for modifier in &modifiers {
                    let func: Arc<dyn RangeFunc> =
                        Arc::from(functions::fusable_range_func(func_name).unwrap());
                    let (sources, range) =
                        group_sources(Value::Matrix(reference_matrix(range)), modifier, func_name)
                            .unwrap()
                            .unwrap();
                    let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx()));
                    let expected = aggregate(sources, op, eval).await.unwrap().0;

                    let actual = run_streaming(&ctx, modifier, func_name, op, range)
                        .await
                        .expect("streaming path must not fall back on the sorted table");

                    assert_matrix_close(
                        canonical_matrix(expected),
                        canonical_matrix(actual),
                        &format!(
                            "streaming {}({func_name}) (modifier: {modifier:?})",
                            op.name()
                        ),
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_range_series_matches_eval_range_for_all_funcs() {
        let ctx = session_ctx();
        register_sorted_table(&ctx);
        let range = Duration::from_secs(60);
        let eval_ctx = eval_ctx();
        let all_labels = HashSet::new();
        let func_cases = [
            "avg_over_time",
            "changes",
            "count_over_time",
            "delta",
            "deriv",
            "idelta",
            "increase",
            "irate",
            "last_over_time",
            "max_over_time",
            "min_over_time",
            "rate",
            "resets",
            "stddev_over_time",
            "stdvar_over_time",
            "sum_over_time",
        ];
        for func_name in func_cases {
            let func: Arc<dyn RangeFunc> =
                Arc::from(functions::fusable_range_func(func_name).unwrap());
            let expected = functions::eval_range(
                Value::Matrix(reference_matrix(range)),
                func.clone(),
                &eval_ctx,
            )
            .unwrap();
            let label_cols = series_label_columns(&arrow_schema(), &all_labels, func_name);
            let sources = sorted_table_sources(&ctx, label_cols, range)
                .await
                .expect("the sorted table streams");
            let eval = Arc::new(RangeExpr::new(func, range, &eval_ctx));
            let (actual, _) = eval_range(sources, eval).await.unwrap();
            assert_matrix_close(
                canonical_matrix(expected),
                canonical_matrix(Value::Matrix(actual)),
                &format!("streaming {func_name}()"),
            );
        }
    }
}
