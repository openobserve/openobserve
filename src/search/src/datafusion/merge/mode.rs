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

//! What a merge produces.
//!
//! The kind of merge (plain time-ordered file, trace time-index aggregation,
//! file-list ordering, metrics downsampling) used to be re-derived at every
//! layer — batching in the compactor, `merge_files`, and again inside
//! `merge_parquet_files` — from stream type, stream name, config and the batch
//! time range. [`MergeMode`] is decided once by the caller and passed down;
//! every layer only asks it questions.

use std::fmt;

use arrow_schema::Schema;
#[cfg(feature = "enterprise")]
use config::meta::promql::DownsamplingRule;
use config::{
    FileFormat, FileFormatConfig, TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::tsid_layout::{MetricsFileLayout, metrics_tsid_major_stream},
        stream::{FileKey, StreamType},
    },
    utils::util::is_trace_time_index_stream,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule;

use crate::datafusion::sort_order::FileSortOrder;

/// The kind of merge, decided once per batch.
#[derive(Debug, Clone)]
pub enum MergeMode {
    /// `SELECT * FROM tbl ORDER BY _timestamp DESC` into one file: logs,
    /// traces, plain metrics — the ingester and the compactor default.
    Classic,
    /// The trace time-index metadata stream: one row per `trace_id`
    /// (`MIN(_timestamp)`, `MIN(min_ts)`, `MAX(max_ts)`, …), one file.
    TraceTimeIndex,
    /// The file-list stream has no `_timestamp`; order by `min_ts DESC`.
    FileList,
    /// Metrics downsampling (enterprise): aggregate every series by the rule's
    /// step, size-split output files. Only for a closed hour, which is merged
    /// as a whole.
    #[cfg(feature = "enterprise")]
    Downsampling(DownsamplingRule),
    /// TSID-major metrics stream (`ZO_METRICS_TSID_MAJOR_ENABLED`, `__hash__:
    /// UInt64`), hour still open: the ingester and the incremental compactor
    /// merges write one Parquet file ordered by `(__hash__, _timestamp)`,
    /// named `tsid-sorted-*`. The hour-end merge turns those into
    /// [`MergeMode::TsidMajor`].
    HashSorted,
    /// TSID-major metrics stream, closed hour: the whole hour is merged as one
    /// batch into size-split `tsid-major-v3-*` Parquet files ordered by
    /// `(__hash__, _timestamp)`.
    TsidMajor,
}

impl MergeMode {
    /// Mode for the compactor's merge of one `stream_name` hour (or day) that
    /// ends at `max_ts`. `finalize` is true once that hour is closed; only then
    /// may the whole hour be rewritten (metrics downsampling, whose rules
    /// select by how old `max_ts` is). Incremental merges of the still-open
    /// hour always use the plain per-stream mode.
    pub fn for_compactor(
        stream_type: StreamType,
        stream_name: &str,
        schema: &Schema,
        _max_ts: i64,
        finalize: bool,
    ) -> Self {
        #[cfg(feature = "enterprise")]
        if finalize
            && stream_type == StreamType::Metrics
            && let Some(rule) = get_largest_downsampling_rule(stream_name, _max_ts)
        {
            return Self::Downsampling(rule.clone());
        }
        if metrics_tsid_major_stream(stream_type, schema) {
            return if finalize {
                Self::TsidMajor
            } else {
                Self::HashSorted
            };
        }
        Self::for_stream(stream_type, stream_name)
    }

    /// Mode for the ingester movers: never downsamples, never finalizes.
    pub fn for_ingester(stream_type: StreamType, stream_name: &str, schema: &Schema) -> Self {
        if metrics_tsid_major_stream(stream_type, schema) {
            return Self::HashSorted;
        }
        Self::for_stream(stream_type, stream_name)
    }

    fn for_stream(stream_type: StreamType, stream_name: &str) -> Self {
        match stream_type {
            StreamType::Metadata if is_trace_time_index_stream(stream_name) => Self::TraceTimeIndex,
            StreamType::Filelist => Self::FileList,
            _ => Self::Classic,
        }
    }

    /// True for the TSID-major hour-end merge.
    pub fn is_tsid_major(&self) -> bool {
        matches!(self, Self::TsidMajor)
    }

    /// True when the whole hour must be merged as one batch — every file of
    /// the hour, including ones already above the size target, and regardless
    /// of `ZO_COMPACT_MAX_FILE_SIZE` (the writer splits the output itself).
    pub fn merges_whole_batch(&self) -> bool {
        match self {
            #[cfg(feature = "enterprise")]
            Self::Downsampling(_) => true,
            Self::TsidMajor => true,
            _ => false,
        }
    }

    /// Row order the merge writes.
    pub fn output_sort_order(&self) -> FileSortOrder {
        match self {
            Self::HashSorted | Self::TsidMajor => FileSortOrder::HashTimestampAsc,
            _ => FileSortOrder::TimestampDesc,
        }
    }

    /// Layout of the file(s) the merge writes.
    pub fn file_layout(&self) -> MetricsFileLayout {
        match self {
            Self::HashSorted => MetricsFileLayout::HashSorted,
            Self::TsidMajor => MetricsFileLayout::TsidMajor,
            _ => MetricsFileLayout::Legacy,
        }
    }

    /// Physical order of the input `files` the merge query may rely on.
    ///
    /// A hash-ordered output over inputs that are all `(__hash__, _timestamp)`
    /// ordered (`tsid-sorted-*` / `tsid-major-v3-*`) declares that order, so
    /// DataFusion merges the pre-sorted files (SortPreservingMerge, one file per
    /// partition) instead of a full sort. Any hash-ordered file in a batch that
    /// is not merged that way (mixed layouts, or the layout switched off) means
    /// no order can be assumed. Otherwise the classic `_timestamp DESC`.
    pub fn input_sort_order(&self, files: &[FileKey]) -> FileSortOrder {
        let hash_ordered = files
            .iter()
            .filter(|f| MetricsFileLayout::of(&f.key).is_hash_ordered())
            .count();
        match self {
            Self::HashSorted | Self::TsidMajor if hash_ordered == files.len() => {
                FileSortOrder::HashTimestampAsc
            }
            _ if hash_ordered > 0 => FileSortOrder::None,
            Self::HashSorted | Self::TsidMajor => FileSortOrder::None,
            _ => FileSortOrder::TimestampDesc,
        }
    }

    /// The merge query over the union table `tbl`.
    pub(super) fn sql(&self, schema: &Schema) -> String {
        match self {
            Self::Classic => format!("SELECT * FROM tbl ORDER BY {TIMESTAMP_COL_NAME} DESC"),
            Self::TraceTimeIndex => {
                // Files whose records all had a null session_id were persisted
                // without the column (all-null columns are pruned), so only
                // select it when present.
                let session_id_col = if schema.column_with_name("session_id").is_some() {
                    ", MAX(session_id) AS session_id"
                } else {
                    ""
                };
                format!(
                    "SELECT MIN({TIMESTAMP_COL_NAME}) AS {TIMESTAMP_COL_NAME}, trace_id{session_id_col}, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts FROM tbl GROUP BY trace_id ORDER BY {TIMESTAMP_COL_NAME} DESC"
                )
            }
            Self::FileList => "SELECT * FROM tbl ORDER BY min_ts DESC".to_string(),
            #[cfg(feature = "enterprise")]
            Self::Downsampling(rule) => {
                super::downsampling::generate_downsampling_sql(schema, rule)
            }
            Self::HashSorted | Self::TsidMajor => format!(
                "SELECT * FROM tbl ORDER BY {}",
                FileSortOrder::HashTimestampAsc
                    .order_by_clause()
                    .expect("hash order has sort columns")
            ),
        }
    }
}

impl fmt::Display for MergeMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Classic => write!(f, "classic"),
            Self::TraceTimeIndex => write!(f, "trace_time_index"),
            Self::FileList => write!(f, "file_list"),
            #[cfg(feature = "enterprise")]
            Self::Downsampling(rule) => write!(f, "downsampling(step={}s)", rule.step),
            Self::HashSorted => write!(f, "hash_sorted"),
            Self::TsidMajor => write!(f, "tsid_major"),
        }
    }
}

/// Where the merged file goes: file format and Parquet compression depend on
/// whether the ingester or the compactor is writing.
#[derive(Debug, Clone, Copy)]
pub struct MergeOutput {
    pub file_format: FileFormat,
    /// Parquet compression override (`None` = configured default).
    pub parquet_compression: Option<&'static str>,
}

impl MergeOutput {
    /// Ingester movers: metrics always stay Parquet, optional no-compression.
    pub fn for_ingester(stream_type: StreamType) -> Self {
        let cfg = get_config();
        Self {
            file_format: output_file_format(stream_type, true, cfg.common.file_format),
            parquet_compression: cfg
                .common
                .feature_ingester_none_compression
                .then_some("none"),
        }
    }

    /// Compactor: the configured format for the stream.
    pub fn for_compactor(stream_type: StreamType) -> Self {
        Self {
            file_format: output_file_format(stream_type, false, get_config().common.file_format),
            parquet_compression: None,
        }
    }
}

fn output_file_format(
    stream_type: StreamType,
    is_ingester: bool,
    configured: FileFormatConfig,
) -> FileFormat {
    let configured = configured.for_stream(stream_type);
    if is_ingester {
        FileFormat::for_ingester_stream(stream_type, configured)
    } else {
        configured
    }
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field};

    use super::*;

    #[test]
    fn mode_by_stream() {
        let schema = Schema::empty();
        assert!(matches!(
            MergeMode::for_ingester(StreamType::Logs, "app", &schema),
            MergeMode::Classic
        ));
        assert!(matches!(
            MergeMode::for_compactor(StreamType::Traces, "app", &schema, 0, true),
            MergeMode::Classic
        ));
        assert!(matches!(
            MergeMode::for_compactor(StreamType::Filelist, "x", &schema, 0, false),
            MergeMode::FileList
        ));
        assert!(!MergeMode::Classic.merges_whole_batch());
        assert!(MergeMode::TsidMajor.merges_whole_batch());
        assert!(!MergeMode::HashSorted.merges_whole_batch());
        assert_eq!(
            MergeMode::Classic.input_sort_order(&[]),
            FileSortOrder::TimestampDesc
        );
        assert_eq!(MergeMode::Classic.file_layout(), MetricsFileLayout::Legacy);
        assert_eq!(
            MergeMode::HashSorted.file_layout(),
            MetricsFileLayout::HashSorted
        );
        assert_eq!(
            MergeMode::TsidMajor.output_sort_order(),
            FileSortOrder::HashTimestampAsc
        );
    }

    #[test]
    fn input_sort_order_by_file_layout() {
        let legacy = FileKey::from_file_name("files/o/metrics/m/2026/08/18/10/1.parquet");
        let sorted =
            FileKey::from_file_name("files/o/metrics/m/2026/08/18/10/tsid-sorted-2.parquet");
        let major =
            FileKey::from_file_name("files/o/metrics/m/2026/08/18/10/tsid-major-v3-3.parquet");
        // all inputs hash ordered: the hash modes merge them pre-sorted
        for mode in [MergeMode::HashSorted, MergeMode::TsidMajor] {
            assert_eq!(
                mode.input_sort_order(std::slice::from_ref(&sorted)),
                FileSortOrder::HashTimestampAsc
            );
            assert_eq!(
                mode.input_sort_order(&[sorted.clone(), major.clone()]),
                FileSortOrder::HashTimestampAsc
            );
            // a legacy file in the batch: nothing can be assumed
            assert_eq!(
                mode.input_sort_order(&[sorted.clone(), legacy.clone()]),
                FileSortOrder::None
            );
        }
        // classic merge over hash-ordered files (layout switched off): no order
        assert_eq!(
            MergeMode::Classic.input_sort_order(&[legacy.clone(), sorted.clone()]),
            FileSortOrder::None
        );
        assert_eq!(
            MergeMode::Classic.input_sort_order(std::slice::from_ref(&legacy)),
            FileSortOrder::TimestampDesc
        );
    }

    #[test]
    fn output_file_format_uses_parquet_for_ingester_metrics() {
        let configured = "parquet,metrics=vortex"
            .parse::<FileFormatConfig>()
            .unwrap();
        assert_eq!(
            output_file_format(StreamType::Metrics, true, configured),
            FileFormat::Parquet
        );
        assert_eq!(
            output_file_format(StreamType::Logs, true, configured),
            FileFormat::Parquet
        );
        assert_eq!(
            output_file_format(StreamType::Metrics, false, configured),
            FileFormat::Vortex
        );
        assert_eq!(
            output_file_format(StreamType::Traces, false, configured),
            FileFormat::Parquet
        );

        let configured = FileFormatConfig::new(FileFormat::Vortex);
        assert_eq!(
            output_file_format(StreamType::Logs, true, configured),
            FileFormat::Vortex
        );
    }

    #[test]
    fn sql_by_mode() {
        let with_session = Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("trace_id", DataType::Utf8, false),
            Field::new("session_id", DataType::Utf8, true),
        ]);
        let without_session = Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("trace_id", DataType::Utf8, false),
        ]);
        assert_eq!(
            MergeMode::Classic.sql(&without_session),
            "SELECT * FROM tbl ORDER BY _timestamp DESC"
        );
        assert_eq!(
            MergeMode::FileList.sql(&without_session),
            "SELECT * FROM tbl ORDER BY min_ts DESC"
        );
        assert_eq!(
            MergeMode::TsidMajor.sql(&without_session),
            "SELECT * FROM tbl ORDER BY __hash__ ASC, _timestamp ASC"
        );
        assert!(
            MergeMode::TraceTimeIndex
                .sql(&with_session)
                .contains("MAX(session_id) AS session_id")
        );
        assert!(
            !MergeMode::TraceTimeIndex
                .sql(&without_session)
                .contains("session_id")
        );
    }
}
