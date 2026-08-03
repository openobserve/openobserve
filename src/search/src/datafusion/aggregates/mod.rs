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

pub mod merge_phase;
pub mod no_grouping_merge_phase;

use std::sync::Arc;

use arrow::array::{Array, ArrayRef, AsArray, RecordBatch, RecordBatchOptions, StringViewBuilder};

/// refer to: https://github.com/apache/datafusion/pull/11587
/// Heuristically compact `StringViewArray`s to reduce memory usage, if needed
///
/// Decides when to consolidate the StringView into a new buffer to reduce
/// memory usage and improve string locality for better performance.
///
/// This differs from `StringViewArray::gc` because:
/// 1. It may not compact the array depending on a heuristic.
/// 2. It uses a precise block size to reduce the number of buffers to track.
///
/// # Heuristic
///
/// If the average size of each view is larger than 32 bytes, we compact the array.
///
/// `StringViewArray` include pointers to buffer that hold the underlying data.
/// One of the great benefits of `StringViewArray` is that many operations
/// (e.g., `filter`) can be done without copying the underlying data.
///
/// However, after a while (e.g., after `FilterExec` or `HashJoinExec`) the
/// `StringViewArray` may only refer to a small portion of the buffer,
/// significantly increasing memory usage.
pub(crate) fn gc_string_view_batch(batch: &RecordBatch) -> RecordBatch {
    let new_columns: Vec<ArrayRef> = batch
        .columns()
        .iter()
        .map(|c| {
            // Try to re-create the `StringViewArray` to prevent holding the underlying buffer too
            // long.
            let Some(s) = c.as_string_view_opt() else {
                return Arc::clone(c);
            };

            // Fast path: if the data buffers are empty, we can return the original array
            if s.data_buffers().is_empty() {
                return Arc::clone(c);
            }

            let ideal_buffer_size: usize = s
                .views()
                .iter()
                .map(|v| {
                    let len = (*v as u32) as usize;
                    if len > 12 { len } else { 0 }
                })
                .sum();

            // We don't use get_buffer_memory_size here, because gc is for the contents of the
            // data buffers, not views and nulls.
            let actual_buffer_size = s.data_buffers().iter().map(|b| b.capacity()).sum::<usize>();

            // Re-creating the array copies data and can be time consuming.
            // We only do it if the array is sparse
            if actual_buffer_size > (ideal_buffer_size * 2) {
                // We set the block size to `ideal_buffer_size` so that the new StringViewArray only
                // has one buffer, which accelerate later concat_batches. See https://github.com/apache/arrow-rs/issues/6094 for more details.
                let mut builder = StringViewBuilder::with_capacity(s.len());
                if ideal_buffer_size > 0 {
                    builder = builder.with_fixed_block_size(ideal_buffer_size as u32);
                }

                for v in s.iter() {
                    builder.append_option(v);
                }

                let gc_string = builder.finish();

                debug_assert!(gc_string.data_buffers().len() <= 1); // buffer count can be 0 if the `ideal_buffer_size` is 0

                Arc::new(gc_string)
            } else {
                Arc::clone(c)
            }
        })
        .collect();
    let mut options = RecordBatchOptions::new();
    options = options.with_row_count(Some(batch.num_rows()));
    RecordBatch::try_new_with_options(batch.schema(), new_columns, &options)
        .expect("Failed to re-create the gc'ed record batch")
}
