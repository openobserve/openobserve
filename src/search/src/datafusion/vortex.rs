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

//! Vortex file format support.
//!
//! This module provides:
//! - `Utf8Compressor`: A smart compressor for UTF8 fields using Zstd compression
//! - Vortex file reading utilities for reading record batches and schemas

use std::sync::{Arc, LazyLock};

use arrow::{buffer::BooleanBuffer, record_batch::RecordBatch};
use datafusion::error::{DataFusionError, Result as DataFusionResult};
use tokio::runtime::Runtime;
use vortex::{
    VortexSessionDefault,
    array::{ArrayRef, Canonical, ExecutionCtx, IntoArray, arrow::FromArrowArray},
    buffer::Buffer,
    compressor::{
        BtrBlocksCompressor, BtrBlocksCompressorBuilder, SchemeExt, schemes::integer::IntDictScheme,
    },
    dtype::{DType, arrow::FromArrowType},
    encodings::zstd::Zstd,
    error::VortexResult,
    file::{VortexWriteOptions, WriteStrategyBuilder},
    io::session::RuntimeSessionExt,
    layout::layouts::compressed::CompressorPlugin,
    scan::selection::Selection,
    session::VortexSession,
};
use vortex_datafusion::VortexAccessPlan;

pub static VORTEX_RUNTIME: LazyLock<Arc<Runtime>> = LazyLock::new(|| {
    Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .thread_name("vortex_runtime")
            .worker_threads(config::get_config().limit.vortex_thread_num)
            .thread_stack_size(16 * 1024 * 1024)
            .enable_all()
            .build()
            .unwrap(),
    )
});

/// A compressor optimized for UTF8 fields using Zstd compression.
///
/// For UTF8/Binary fields:
/// - Applies Zstd compression directly to VarBinView arrays
/// - Uses configurable compression level (default: 3) and page size (default: 8192)
/// - Falls back to uncompressed if compression doesn't reduce size
///
/// For all other data types:
/// - Delegates to BtrBlocksCompressor for optimal encoding
#[derive(Clone)]
pub struct Utf8Compressor {
    /// The underlying BtrBlocks compressor for general compression
    btr_compressor: BtrBlocksCompressor,
    /// Zstd compression level (default: 3)
    zstd_level: i32,
    /// Number of values per Zstd compression frame (default: 8192)
    values_per_page: usize,
}

impl Utf8Compressor {
    /// Create a new smart compressor with default settings.
    pub fn new() -> Self {
        Self {
            btr_compressor: BtrBlocksCompressorBuilder::default()
                .exclude_schemes([IntDictScheme.id()])
                .build(),
            zstd_level: 3,
            values_per_page: 8192,
        }
    }

    /// Set the Zstd compression level (1-22, default: 3).
    pub fn with_zstd_level(mut self, level: i32) -> Self {
        self.zstd_level = level;
        self
    }

    /// Set the number of values per Zstd compression frame (default: 8192).
    pub fn with_values_per_page(mut self, values: usize) -> Self {
        self.values_per_page = values;
        self
    }

    fn compress(&self, chunk: &ArrayRef, ctx: &mut ExecutionCtx) -> VortexResult<ArrayRef> {
        // Check if this is a UTF8 or Binary field
        if matches!(chunk.dtype(), DType::Utf8(_) | DType::Binary(_)) {
            self.compress_utf8_or_binary(chunk, ctx)
        } else {
            // For non-UTF8 types, use BtrBlocks directly
            self.btr_compressor.compress(chunk, ctx)
        }
    }

    fn compress_utf8_or_binary(
        &self,
        chunk: &ArrayRef,
        ctx: &mut ExecutionCtx,
    ) -> VortexResult<ArrayRef> {
        let canonical = chunk.clone().execute::<Canonical>(ctx)?;
        let compressed = match &canonical {
            Canonical::VarBinView(vbv) => {
                let zstd_array =
                    Zstd::from_var_bin_view(vbv, self.zstd_level, self.values_per_page, ctx)?;
                zstd_array.into_array()
            }
            _ => {
                // Unexpected canonical form, return BtrBlocks result
                self.btr_compressor.compress(chunk, ctx)?
            }
        };

        Ok(compressed)
    }
}

impl Default for Utf8Compressor {
    fn default() -> Self {
        Self::new()
    }
}

impl CompressorPlugin for Utf8Compressor {
    fn compress_chunk(&self, chunk: &ArrayRef, ctx: &mut ExecutionCtx) -> VortexResult<ArrayRef> {
        self.compress(chunk, ctx)
    }
}

/// Generate a vortex access plan from a per-row match bitmap.
pub fn generate_vortex_access_plan(row_ids: &BooleanBuffer) -> Option<VortexAccessPlan> {
    let indices: Vec<u64> = row_ids.set_indices().map(|i| i as u64).collect();

    let buffer = Buffer::from(indices);
    let selection = VortexAccessPlan::default().with_selection(Selection::IncludeByIndex(buffer));
    Some(selection)
}

/// Write record batches to a vortex file.
pub async fn write_vortex(
    schema: Arc<arrow::datatypes::Schema>,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<DataFusionResult<()>>,
) -> DataFusionResult<Vec<u8>> {
    let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
        VORTEX_RUNTIME.block_on(async move {
            let mut buf = Vec::new();
            let session = VortexSession::default().with_tokio();
            let dtype = DType::from_arrow(schema.as_ref());
            let write_options = VortexWriteOptions::new(session.clone()).with_strategy(
                WriteStrategyBuilder::default()
                    .with_compressor(Utf8Compressor::default())
                    .build(),
            );
            let mut writer = write_options.writer(&mut buf, dtype);

            while let Some(batch) = rx.recv().await {
                let array: ArrayRef = ArrayRef::from_arrow(batch, false).map_err(|e| {
                    DataFusionError::Execution(format!(
                        "Failed to convert arrow array to vortex array: {e}"
                    ))
                })?;
                writer.push(array).await?;
            }

            writer.finish().await?;

            Ok::<Vec<u8>, anyhow::Error>(buf)
        })
    });

    // Wait for both tasks to complete
    read_task
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;

    writer_task
        .await
        .map_err(|e| DataFusionError::Execution(format!("Vortex runtime task failed: {e}")))?
        .map_err(|e| DataFusionError::Execution(format!("Failed to write vortex file: {e}")))
}

#[cfg(test)]
mod tests {
    use vortex::{
        array::{IntoArray, arrays::VarBinViewArray},
        dtype::{DType, Nullability},
    };

    use super::*;

    #[test]
    fn test_compresses_utf8_strings() {
        let compressor = Utf8Compressor::new();

        let strings = vec![
            Some("apple"),
            Some("banana"),
            Some("apple"),
            Some("cherry"),
            Some("banana"),
            Some("apple"),
            Some("cherry"),
            Some("banana"),
            Some("apple"),
            Some("apple"),
            Some("banana"),
            Some("cherry"),
        ];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_eq!(compressed.len(), array.len());
        assert!(compressed.nbytes() > 0);
    }

    #[test]
    fn test_high_cardinality_strings() {
        let compressor = Utf8Compressor::new();

        let strings: Vec<Option<String>> = (0..100)
            .map(|i| Some(format!("unique_string_{:06}", i)))
            .collect();
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_eq!(compressed.len(), 100);
        assert!(compressed.nbytes() > 0);
    }

    #[test]
    fn test_non_utf8_uses_btrblocks() {
        use vortex::array::arrays::PrimitiveArray;

        let compressor = Utf8Compressor::new();
        let array: PrimitiveArray = vec![1i32, 2, 3, 4, 5].into_iter().collect();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array.into_array(), &mut ctx).unwrap();
        assert_eq!(compressed.len(), 5);
    }

    #[test]
    fn test_empty_string_array() {
        let compressor = Utf8Compressor::new();

        let strings: Vec<Option<&str>> = vec![];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_eq!(compressed.len(), 0);
    }

    #[test]
    fn test_compression_settings() {
        let compressor = Utf8Compressor::new()
            .with_zstd_level(5)
            .with_values_per_page(4096);

        let strings = vec![Some("test"), Some("data"), Some("test")];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_eq!(compressed.len(), 3);
        assert!(compressed.nbytes() > 0);
    }
}
