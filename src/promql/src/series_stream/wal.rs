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

//! The WAL rows of a selector, held in hash order so every partition's merge takes its own
//! slice without a scan.

use config::meta::promql::HASH_LABEL;
use datafusion::{
    arrow::{
        array::{AsArray, RecordBatch},
        datatypes::{SchemaRef, UInt64Type},
    },
    execution::SendableRecordBatchStream,
    physical_plan::stream::RecordBatchStreamAdapter,
};
use futures::stream;

/// Batches in `(__hash__, _timestamp)` order across their whole sequence, as one node's sorted
/// scan or a sort-preserving merge over several delivers them.
pub struct SortedWalRows {
    batches: Vec<RecordBatch>,
}

impl SortedWalRows {
    pub fn new(batches: Vec<RecordBatch>) -> Self {
        Self { batches }
    }

    /// The schema of the rows; `None` when there are no batches.
    pub(crate) fn schema(&self) -> Option<SchemaRef> {
        self.batches.first().map(RecordBatch::schema)
    }

    /// The rows whose hash lies in `lo..=hi`, as one ordered chain of zero-copy slices; `None`
    /// when there are none.
    pub(crate) fn chain(&self, lo: u64, hi: u64) -> Option<SendableRecordBatchStream> {
        let mut slices = Vec::new();
        for batch in &self.batches {
            let hashes = batch[HASH_LABEL].as_primitive::<UInt64Type>().values();
            let (Some(first), Some(last)) = (hashes.first(), hashes.last()) else {
                continue;
            };
            if *first > hi {
                break;
            }
            if *last < lo {
                continue;
            }
            let start = hashes.partition_point(|&hash| hash < lo);
            let end = hashes.partition_point(|&hash| hash <= hi);
            if end > start {
                slices.push(batch.slice(start, end - start));
            }
        }
        let schema = slices.first()?.schema();
        Some(Box::pin(RecordBatchStreamAdapter::new(
            schema,
            stream::iter(slices.into_iter().map(Ok)),
        )))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::arrow::{
        array::UInt64Array,
        datatypes::{DataType, Field, Schema},
    };
    use futures::TryStreamExt;

    use super::*;

    fn batch(hashes: &[u64]) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new(
            HASH_LABEL,
            DataType::UInt64,
            false,
        )]));
        RecordBatch::try_new(schema, vec![Arc::new(UInt64Array::from(hashes.to_vec()))]).unwrap()
    }

    /// The hashes of each batch the chain yields; `None` when there is no chain.
    async fn chain_hashes(rows: &SortedWalRows, lo: u64, hi: u64) -> Option<Vec<Vec<u64>>> {
        let batches: Vec<RecordBatch> = rows.chain(lo, hi)?.try_collect().await.unwrap();
        Some(
            batches
                .iter()
                .map(|batch| {
                    batch[HASH_LABEL]
                        .as_primitive::<UInt64Type>()
                        .values()
                        .to_vec()
                })
                .collect(),
        )
    }

    #[tokio::test]
    async fn test_chain_cuts_runs_at_the_partition_bounds() {
        let rows = SortedWalRows::new(vec![
            batch(&[1, 1, 3]),
            batch(&[3, 5, 8]),
            batch(&[]),
            batch(&[8, 9, 20]),
            batch(&[30, 31]),
        ]);
        // inclusive bounds, a run continuing across batches, an empty batch in between
        assert_eq!(
            chain_hashes(&rows, 3, 9).await,
            Some(vec![vec![3], vec![3, 5, 8], vec![8, 9]])
        );
        assert_eq!(
            chain_hashes(&rows, 0, u64::MAX)
                .await
                .unwrap()
                .concat()
                .len(),
            11
        );
        assert_eq!(chain_hashes(&rows, 31, 31).await, Some(vec![vec![31]]));
        assert_eq!(chain_hashes(&rows, 10, 19).await, None);
        assert_eq!(chain_hashes(&rows, 32, u64::MAX).await, None);
    }
}
