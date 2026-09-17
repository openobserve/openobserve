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
//! - A custom compressor for UTF8 fields using Zstd compression
//! - Shared Vortex write strategy and access plan utilities

use std::{
    ops::Range,
    sync::{Arc, LazyLock},
};

use arrow::buffer::BooleanBuffer;
use config::VortexCompression;
use datafusion::{common::stats::Precision, datasource::listing::PartitionedFile};
use tokio::runtime::Runtime;
use vortex::{
    array::{
        ArrayRef, Canonical, ExecutionCtx, IntoArray, arrays::VarBinViewArray,
        session::ArraySessionExt,
    },
    buffer::Buffer,
    compressor::{BtrBlocksCompressor, BtrBlocksCompressorBuilder},
    dtype::DType,
    editions::{ComponentKind, EditionSessionExt},
    encodings::zstd::Zstd,
    error::VortexResult,
    file::WriteStrategyBuilder,
    layout::{LayoutStrategy, layouts::compressed::CompressorPlugin},
    scan::selection::Selection,
    session::VortexSession,
};
use vortex_btrblocks::{SchemeExt, schemes::integer::IntDictScheme};
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

/// Configuration for compressing long UTF8 chunks with Zstd.
#[derive(Clone)]
struct LongTextCompressionOptions {
    /// Zstd compression level.
    zstd_level: i32,
    /// Number of values per Zstd compression frame.
    values_per_page: usize,
    /// Minimum average UTF8 value length that identifies long text.
    min_average_length: usize,
    /// Individual UTF8 value length considered long.
    long_value_length: usize,
    /// Percentage of valid values that must be long when the average is short.
    min_long_value_ratio_percent: usize,
    /// Avoid Zstd for small chunks where its framing overhead is not worthwhile.
    min_total_bytes: usize,
}

impl Default for LongTextCompressionOptions {
    fn default() -> Self {
        Self {
            zstd_level: 1,
            values_per_page: 8192,
            min_average_length: 64,
            long_value_length: 64,
            min_long_value_ratio_percent: 80,
            min_total_bytes: 64 * 1024,
        }
    }
}

/// A compressor optimized for long UTF8 fields using Zstd compression.
///
/// For long UTF8 fields:
/// - Applies Zstd compression directly to VarBinView arrays
/// - Uses configurable compression level (default: 1) and page size (default: 8192)
///
/// For short UTF8, Binary, and all other data types:
/// - Delegates to BtrBlocksCompressor for optimal encoding
#[derive(Clone)]
struct LongTextCompressor {
    /// The underlying BtrBlocks compressor for general compression
    btr_compressor: BtrBlocksCompressor,
    /// Zstd compression and long-text detection options.
    options: LongTextCompressionOptions,
}

impl LongTextCompressor {
    fn new(builder: BtrBlocksCompressorBuilder) -> Self {
        Self {
            btr_compressor: builder.build(),
            options: LongTextCompressionOptions::default(),
        }
    }

    fn compress(&self, chunk: &ArrayRef, ctx: &mut ExecutionCtx) -> VortexResult<ArrayRef> {
        if !matches!(chunk.dtype(), DType::Utf8(_)) {
            return self.btr_compressor.compress(chunk, ctx);
        }

        let canonical = chunk.clone().execute::<Canonical>(ctx)?;
        let Canonical::VarBinView(vbv) = &canonical else {
            return self.btr_compressor.compress(chunk, ctx);
        };

        if !self.should_use_zstd(vbv, ctx)? {
            return self.btr_compressor.compress(chunk, ctx);
        }

        Ok(Zstd::from_var_bin_view(
            vbv,
            self.options.zstd_level,
            self.options.values_per_page,
            ctx,
        )?
        .into_array())
    }

    fn should_use_zstd(
        &self,
        array: &VarBinViewArray,
        ctx: &mut ExecutionCtx,
    ) -> VortexResult<bool> {
        let mut valid_count = 0usize;
        let mut total_bytes = 0usize;
        let mut long_value_count = 0usize;

        for (index, view) in array.views().iter().enumerate() {
            if !array.as_ref().is_valid(index, ctx)? {
                continue;
            }

            let length = view.len() as usize;
            valid_count += 1;
            total_bytes = total_bytes.saturating_add(length);
            if length >= self.options.long_value_length {
                long_value_count += 1;
            }
        }

        if valid_count == 0 || total_bytes < self.options.min_total_bytes {
            return Ok(false);
        }

        let average_is_long = total_bytes / valid_count >= self.options.min_average_length;
        let long_values_dominate = long_value_count.saturating_mul(100)
            >= valid_count.saturating_mul(self.options.min_long_value_ratio_percent);

        Ok(average_is_long || long_values_dominate)
    }
}

impl CompressorPlugin for LongTextCompressor {
    fn compress_chunk(&self, chunk: &ArrayRef, ctx: &mut ExecutionCtx) -> VortexResult<ArrayRef> {
        self.compress(chunk, ctx)
    }
}

/// Build the Vortex file write strategy selected by `ZO_VORTEX_COMPRESSION`.
pub(super) fn vortex_write_strategy(session: &VortexSession) -> Arc<dyn LayoutStrategy> {
    build_vortex_write_strategy(session, config::get_config().common.vortex_compression)
}

fn build_vortex_write_strategy(
    session: &VortexSession,
    compression: VortexCompression,
) -> Arc<dyn LayoutStrategy> {
    // Custom strategies must filter editions because they bypass the writer's defaults.
    let arrays = session.arrays();
    let allowed = session
        .enabled_component_ids(ComponentKind::Array)
        .iter()
        .filter_map(|id| arrays.registry().get(id))
        .map(|plugin| plugin.id())
        .collect();
    let btrblocks = match compression {
        VortexCompression::Compact => BtrBlocksCompressorBuilder::default().with_compact(),
        VortexCompression::O2 | VortexCompression::Native => BtrBlocksCompressorBuilder::default(),
    }
    .retain_allowed_encodings(&allowed);
    let builder = WriteStrategyBuilder::default().with_btrblocks_builder(btrblocks.clone());
    match compression {
        VortexCompression::Native | VortexCompression::Compact => builder.build(),
        VortexCompression::O2 => {
            // probe keeps IntDictScheme so DictStrategy can pick dict; data side must not re-dict
            // codes
            let probe = LongTextCompressor::new(btrblocks.clone());
            let data = LongTextCompressor::new(btrblocks.exclude_schemes([IntDictScheme.id()]));
            builder
                .with_compressor(data)
                .with_probe_compressor(probe)
                .build()
        }
    }
}

/// Generate a vortex access plan from a per-row match bitmap.
pub fn generate_vortex_access_plan(row_ids: &BooleanBuffer) -> Option<VortexAccessPlan> {
    let indices: Vec<u64> = row_ids.set_indices().map(|i| i as u64).collect();

    let buffer = Buffer::from(indices);
    let selection = VortexAccessPlan::default().with_selection(Selection::IncludeByIndex(
        vortex::scan::strict_sorted_buffer::StrictSortedBuffer::try_new(buffer)
            .expect("bitmap set indices are strictly increasing"),
    ));
    Some(selection)
}

/// Generate a Vortex access plan directly from sorted, non-overlapping row
/// ranges stored in a Metrics index. A roaring selection preserves the compact
/// range representation instead of expanding every range into row IDs.
pub fn generate_vortex_access_plan_from_ranges(
    file: &PartitionedFile,
    ranges: impl IntoIterator<Item = Range<usize>>,
) -> Option<VortexAccessPlan> {
    let stats = file.statistics.as_ref()?;
    let Precision::Exact(num_rows) = stats.num_rows else {
        return None;
    };
    let mut selection = Selection::IncludeRoaring(Default::default());
    let Selection::IncludeRoaring(rows) = &mut selection else {
        unreachable!()
    };
    let mut previous_end = 0;
    for range in ranges {
        assert!(
            previous_end <= range.start && range.start < range.end && range.end <= num_rows,
            "invalid sorted Vortex row range {range:?} for file {} with {num_rows} rows",
            file.path().as_ref()
        );
        previous_end = range.end;
        rows.insert_range(u64::try_from(range.start).ok()?..u64::try_from(range.end).ok()?);
    }

    Some(VortexAccessPlan::default().with_selection(selection))
}

#[cfg(test)]
mod tests {
    use datafusion::common::Statistics;
    use vortex::{
        VortexSessionDefault,
        array::{
            IntoArray,
            arrays::{StructArray, VarBinViewArray},
            expr::{root, select},
            stream::ArrayStreamExt,
        },
        dtype::{DType, FieldNames, Nullability},
        file::{OpenOptionsSessionExt, VortexWriteOptions},
        io::session::RuntimeSessionExt,
        session::VortexSession,
    };

    use super::*;

    #[test]
    fn test_long_text_compression_defaults() {
        let options = LongTextCompressionOptions::default();

        assert_eq!(options.zstd_level, 1);
        assert_eq!(options.values_per_page, 8192);
    }

    fn vortex_file_with_rows(num_rows: usize) -> PartitionedFile {
        let mut file = PartitionedFile::new("test.vortex".to_string(), 100);
        let mut stats = Statistics::new_unknown(&arrow_schema::Schema::empty());
        stats.num_rows = Precision::Exact(num_rows);
        file.statistics = Some(Arc::new(stats));
        file
    }

    #[test]
    fn test_access_plan_from_metrics_index_ranges() {
        let file = vortex_file_with_rows(12);
        let plan = generate_vortex_access_plan_from_ranges(&file, [1..3, 5..8, 10..12]).unwrap();
        let Selection::IncludeRoaring(rows) = plan.selection().unwrap() else {
            panic!("expected roaring row selection")
        };

        assert_eq!(rows.iter().collect::<Vec<_>>(), vec![1, 2, 5, 6, 7, 10, 11]);
    }

    #[test]
    fn test_access_plan_from_ranges_without_exact_row_count_full_scans() {
        let mut file = vortex_file_with_rows(12);
        file.statistics = None;

        assert!(generate_vortex_access_plan_from_ranges(&file, [1..3, 5..8]).is_none());
    }

    #[test]
    #[should_panic(expected = "invalid sorted Vortex row range")]
    fn test_access_plan_from_ranges_rejects_out_of_bounds() {
        let file = vortex_file_with_rows(7);
        generate_vortex_access_plan_from_ranges(&file, [1..3, 5..8]);
    }

    #[test]
    fn test_long_utf8_uses_zstd() {
        let compressor = LongTextCompressor::new(BtrBlocksCompressorBuilder::default());
        let strings = (0..1024)
            .map(|i| Some(format!("long log message {i}: {}", "x".repeat(192))))
            .collect::<Vec<_>>();
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_eq!(compressed.len(), array.len());
        assert_eq!(compressed.encoding_id().as_ref(), "vortex.zstd");
    }

    #[test]
    fn test_short_utf8_delegates_to_btrblocks() {
        let compressor = LongTextCompressor::new(BtrBlocksCompressorBuilder::default());
        let strings: Vec<_> = (0..8192)
            .map(|i| Some(format!("node-{}", i % 32)))
            .collect();
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_ne!(compressed.encoding_id().as_ref(), "vortex.zstd");
    }

    #[test]
    fn test_non_utf8_uses_btrblocks() {
        use vortex::array::arrays::PrimitiveArray;

        let compressor = LongTextCompressor::new(BtrBlocksCompressorBuilder::default());
        let array: PrimitiveArray = vec![1i32, 2, 3, 4, 5].into_iter().collect();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array.into_array(), &mut ctx).unwrap();
        assert_eq!(compressed.len(), 5);
    }

    #[test]
    fn test_empty_string_array() {
        let compressor = LongTextCompressor::new(BtrBlocksCompressorBuilder::default());

        let strings: Vec<Option<&str>> = vec![];
        let array =
            VarBinViewArray::from_iter(strings, DType::Utf8(Nullability::NonNullable)).into_array();

        let mut ctx = ExecutionCtx::new(VortexSession::default());
        let compressed = compressor.compress(&array, &mut ctx).unwrap();
        assert_eq!(compressed.len(), 0);
    }

    #[tokio::test]
    async fn test_native_and_custom_write_strategies_create_files() {
        for compression in [
            VortexCompression::O2,
            VortexCompression::Native,
            VortexCompression::Compact,
        ] {
            // Monotonic integers exercise encodings that require opt-in editions.
            let array = vortex::array::arrays::PrimitiveArray::from_iter(0..8192i64).into_array();
            let dtype = array.dtype().clone();
            let session = VortexSession::default().with_tokio();
            let write_options = VortexWriteOptions::new(session.clone())
                .with_strategy(build_vortex_write_strategy(&session, compression));
            let mut buf = Vec::new();
            let mut writer = write_options.writer(&mut buf, dtype.clone());

            writer.push(array).await.unwrap();
            writer.finish().await.unwrap();

            assert!(!buf.is_empty());
        }
    }

    #[tokio::test]
    async fn test_long_text_probe_skips_dict_layout() {
        let body = VarBinViewArray::from_iter(
            (0..8192).map(|i| Some(format!("long log message {i}: {}", "x".repeat(192)))),
            DType::Utf8(Nullability::NonNullable),
        )
        .into_array();
        let tag = VarBinViewArray::from_iter(
            (0..8192).map(|i| Some(format!("node-{}", i % 32))),
            DType::Utf8(Nullability::NonNullable),
        )
        .into_array();
        let array = StructArray::try_new(
            FieldNames::from(["body", "tag"]),
            vec![body, tag],
            8192,
            vortex::array::validity::Validity::NonNullable,
        )
        .unwrap()
        .into_array();
        let dtype = array.dtype().clone();
        let session = VortexSession::default().with_tokio();
        let write_options = VortexWriteOptions::new(session.clone())
            .with_strategy(build_vortex_write_strategy(&session, VortexCompression::O2));
        let mut buf = Vec::new();
        let mut writer = write_options.writer(&mut buf, dtype.clone());

        writer.push(array).await.unwrap();
        writer.finish().await.unwrap();

        let projected = session
            .open_options()
            .open_buffer(buf)
            .unwrap()
            .scan()
            .unwrap()
            .with_projection(select(["body", "tag"], root()).bind(&dtype).unwrap())
            .into_array_stream()
            .unwrap()
            .read_all()
            .await
            .unwrap();
        let encoding_tree = projected.display_tree_encodings_only().to_string();

        assert!(encoding_tree.contains("body: vortex.zstd"));
        assert!(!encoding_tree.contains("body: vortex.dict"));
        assert!(encoding_tree.contains("tag: vortex.dict"));
    }

    #[tokio::test]
    async fn test_custom_strategy_dict_encodes_low_cardinality_integers() {
        // 240 distinct scrape timestamps cycling over series, as in a hash-sorted metrics file
        let ts = vortex::array::arrays::PrimitiveArray::from_iter(
            (0..8192i64).map(|i| 1_789_452_000_000_000 + (i % 240) * 15_000_000),
        )
        .into_array();
        let array = StructArray::try_new(
            FieldNames::from(["ts"]),
            vec![ts],
            8192,
            vortex::array::validity::Validity::NonNullable,
        )
        .unwrap()
        .into_array();
        let dtype = array.dtype().clone();
        let session = VortexSession::default().with_tokio();
        let write_options = VortexWriteOptions::new(session.clone())
            .with_strategy(build_vortex_write_strategy(&session, VortexCompression::O2));
        let mut buf = Vec::new();
        let mut writer = write_options.writer(&mut buf, dtype.clone());

        writer.push(array).await.unwrap();
        writer.finish().await.unwrap();

        let projected = session
            .open_options()
            .open_buffer(buf)
            .unwrap()
            .scan()
            .unwrap()
            .with_projection(select(["ts"], root()).bind(&dtype).unwrap())
            .into_array_stream()
            .unwrap()
            .read_all()
            .await
            .unwrap();
        let encoding_tree = projected.display_tree_encodings_only().to_string();

        assert!(encoding_tree.contains("ts: vortex.dict"), "{encoding_tree}");
        assert_eq!(
            encoding_tree.matches("vortex.dict").count(),
            1,
            "{encoding_tree}"
        );
    }

    #[tokio::test]
    async fn test_compact_strategy_uses_pco() {
        // jittered 15s scrape steps defeat dict, sequence and plain bitpacking
        let ts = vortex::array::arrays::PrimitiveArray::from_iter(
            (0..8192i64).map(|i| 1_789_452_000_000_000 + i * 15_000_000 + (i % 7) * 1_000),
        )
        .into_array();
        let array = StructArray::try_new(
            FieldNames::from(["ts"]),
            vec![ts],
            8192,
            vortex::array::validity::Validity::NonNullable,
        )
        .unwrap()
        .into_array();
        let dtype = array.dtype().clone();
        let session = VortexSession::default().with_tokio();
        let write_options = VortexWriteOptions::new(session.clone()).with_strategy(
            build_vortex_write_strategy(&session, VortexCompression::Compact),
        );
        let mut buf = Vec::new();
        let mut writer = write_options.writer(&mut buf, dtype.clone());

        writer.push(array).await.unwrap();
        writer.finish().await.unwrap();

        let projected = session
            .open_options()
            .open_buffer(buf)
            .unwrap()
            .scan()
            .unwrap()
            .with_projection(select(["ts"], root()).bind(&dtype).unwrap())
            .into_array_stream()
            .unwrap()
            .read_all()
            .await
            .unwrap();
        let encoding_tree = projected.display_tree_encodings_only().to_string();

        assert!(encoding_tree.contains("vortex.pco"), "{encoding_tree}");
    }
}
