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

//! Indexed metrics layout (`ZO_METRICS_INDEX_ENABLED`): when it
//! applies to a stream, how the physical layout of a metrics file is encoded
//! in its name, and the names of the `.midx` metrics-index columns.

use arrow_schema::{DataType, Schema};

use super::HASH_LABEL;
use crate::{FileFormat, meta::stream::StreamType};

pub const METRICS_INDEX_ROW_COUNT: &str = "__oo_midx_row_count";

/// [`metrics_index_enabled`] narrowed to one stream: the layout also
/// needs a `__hash__` column of type `UInt64` (remote-write / OTLP metrics).
pub fn metrics_index_stream(stream_type: StreamType, schema: &Schema) -> bool {
    metrics_index_enabled(stream_type)
        && schema
            .field_with_name(HASH_LABEL)
            .is_ok_and(|field| field.data_type() == &DataType::UInt64)
}

/// True when `stream_type` uses the metrics index layout
/// (`ZO_METRICS_INDEX_ENABLED`): Parquet metrics files ordered by
/// `(__hash__, _timestamp)`, so readers must not assume a `_timestamp` order.
pub fn metrics_index_enabled(stream_type: StreamType) -> bool {
    if stream_type != StreamType::Metrics {
        return false;
    }
    let cfg = crate::get_config();
    cfg.compact.metrics_index_enabled
        && cfg.common.file_format.for_stream(stream_type) == FileFormat::Parquet
}

/// Physical layout of a metrics data file, encoded in its file-name prefix so
/// readers and later merges know the row order without opening the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricsFileLayout {
    /// Classic `_timestamp DESC` file (`{id}.parquet` / `{id}.vortex`).
    Legacy,
    /// Parquet ordered by `(__hash__ ASC, _timestamp ASC)` but not finalized:
    /// written by the ingester and by incremental compactor merges of the
    /// still-open hour (`metrics-hash-sorted-v1-{id}.parquet`).
    HashSorted,
    /// Size-bounded Parquet ordered by `(__hash__ ASC, _timestamp ASC)` with a
    /// `.midx` metrics index (see [`MetricsFileLayout::metrics_index_path`]);
    /// written by the compactor's hour-end merge
    /// (`metrics-indexed-v1-{id}.parquet`).
    Indexed,
}

impl MetricsFileLayout {
    const HASH_SORTED_PREFIX: &'static str = "metrics-hash-sorted-v1-";
    const INDEXED_PREFIX: &'static str = "metrics-indexed-v1-";
    const METRICS_INDEX_DIR: &'static str = "midx";
    const METRICS_INDEX_EXT: &'static str = ".midx";

    /// Layout of the file at `path` (a full object key or a bare file name).
    pub fn of(path: &str) -> Self {
        let file_name = path.rsplit('/').next().unwrap_or(path);
        for (prefix, layout) in [
            (Self::HASH_SORTED_PREFIX, Self::HashSorted),
            (Self::INDEXED_PREFIX, Self::Indexed),
        ] {
            if let Some(id) = file_name.strip_prefix(prefix)
                && let Some(id) = id.strip_suffix(".parquet")
                && !id.is_empty()
            {
                return layout;
            }
        }
        Self::Legacy
    }

    fn prefix(self) -> &'static str {
        match self {
            Self::Legacy => "",
            Self::HashSorted => Self::HASH_SORTED_PREFIX,
            Self::Indexed => Self::INDEXED_PREFIX,
        }
    }

    /// True when the rows are ordered by `(__hash__, _timestamp)`.
    pub fn is_hash_ordered(self) -> bool {
        !matches!(self, Self::Legacy)
    }

    /// File name for a new file of this layout. Marked layouts are always
    /// Parquet; `Legacy` keeps the extension of `file_format`.
    pub fn file_name(self, id: &str, file_format: FileFormat) -> String {
        match self {
            Self::Legacy => format!("{id}{}", file_format.extension()),
            _ => format!("{}{id}.parquet", self.prefix()),
        }
    }

    /// Add this layout's marker to the file name of an existing key
    /// (`files/.../7099.parquet` ->
    /// `files/.../metrics-hash-sorted-v1-7099.parquet`).
    pub fn mark_file_key(self, key: &str) -> String {
        match key.rfind('/') {
            Some(pos) => format!("{}/{}{}", &key[..pos], self.prefix(), &key[pos + 1..]),
            None => format!("{}{key}", self.prefix()),
        }
    }

    /// The `.midx` metrics-index object of an indexed metrics data file. Stored like
    /// the Tantivy index — under its own root instead of next to the data —
    /// but in a distinct tree:
    /// `files/{org}/metrics/{stream}/{date}/{hour}/metrics-indexed-v1-{id}.parquet`
    /// -> `files/{org}/midx/{stream}/{date}/{hour}/metrics-indexed-v1-{id}.midx`.
    pub fn metrics_index_path(path: &str) -> Option<String> {
        if Self::of(path) != Self::Indexed {
            return None;
        }
        let mut parts: Vec<&str> = path.split('/').collect();
        // files/{org}/metrics/{stream}/.../{file}
        if parts.len() < 5 || parts[2] != StreamType::Metrics.as_str() {
            return None;
        }
        parts[2] = Self::METRICS_INDEX_DIR;
        let file_name_pos = parts.len() - 1;
        let file_name = parts[file_name_pos].strip_suffix(".parquet")?;
        let file_name = format!("{file_name}{}", Self::METRICS_INDEX_EXT);
        parts[file_name_pos] = &file_name;
        Some(parts.join("/"))
    }
}

#[cfg(test)]
mod metrics_file_layout_tests {
    use FileFormat;

    use super::*;

    #[test]
    fn recognizes_layouts_from_file_names() {
        assert_eq!(
            MetricsFileLayout::of("files/default/metrics/cpu/2026/08/18/10/7099.parquet"),
            MetricsFileLayout::Legacy
        );
        assert_eq!(
            MetricsFileLayout::of("7099.vortex"),
            MetricsFileLayout::Legacy
        );
        assert_eq!(
            MetricsFileLayout::of(
                "files/default/metrics/cpu/2026/08/18/10/metrics-hash-sorted-v1-7099.parquet"
            ),
            MetricsFileLayout::HashSorted
        );
        assert_eq!(
            MetricsFileLayout::of(
                "files/default/metrics/test/2026/08/13/10/metrics-indexed-v1-456.parquet"
            ),
            MetricsFileLayout::Indexed
        );
        // wrong format, empty id, other versions, marker in a directory name
        for name in [
            "metrics-indexed-v1-x.vortex",
            "metrics-hash-sorted-v1-1.vortex",
            "metrics-indexed-v1-.parquet",
            "metrics-hash-sorted-v1-.parquet",
            "metrics-indexed-v2-x.parquet",
            "metrics-range-v1-b04-p000a-x.parquet",
            "files/metrics-hash-sorted-v1-dir/1.parquet",
        ] {
            assert_eq!(
                MetricsFileLayout::of(name),
                MetricsFileLayout::Legacy,
                "{name}"
            );
        }
        assert!(MetricsFileLayout::HashSorted.is_hash_ordered());
        assert!(MetricsFileLayout::Indexed.is_hash_ordered());
        assert!(!MetricsFileLayout::Legacy.is_hash_ordered());
    }

    #[test]
    fn builds_and_marks_file_names() {
        assert_eq!(
            MetricsFileLayout::Indexed.file_name("456", FileFormat::Parquet),
            "metrics-indexed-v1-456.parquet"
        );
        assert_eq!(
            MetricsFileLayout::HashSorted.file_name("456", FileFormat::Parquet),
            "metrics-hash-sorted-v1-456.parquet"
        );
        assert_eq!(
            MetricsFileLayout::Legacy.file_name("456", FileFormat::Vortex),
            "456.vortex"
        );
        let key = "files/default/metrics/cpu/2026/08/18/10/7099.parquet";
        let marked = MetricsFileLayout::HashSorted.mark_file_key(key);
        assert_eq!(
            marked,
            "files/default/metrics/cpu/2026/08/18/10/metrics-hash-sorted-v1-7099.parquet"
        );
        assert_eq!(
            MetricsFileLayout::of(&marked),
            MetricsFileLayout::HashSorted
        );
        assert_eq!(MetricsFileLayout::Legacy.mark_file_key(key), key);
        assert_eq!(
            MetricsFileLayout::HashSorted.mark_file_key("1.parquet"),
            "metrics-hash-sorted-v1-1.parquet"
        );
    }

    #[test]
    fn metrics_index_path_only_for_indexed_metrics_keys() {
        assert_eq!(
            MetricsFileLayout::metrics_index_path(
                "files/default/metrics/cpu/2026/08/19/07/metrics-indexed-v1-456.parquet"
            ),
            Some("files/default/midx/cpu/2026/08/19/07/metrics-indexed-v1-456.midx".to_string())
        );
        // other layouts have no metrics index
        assert_eq!(
            MetricsFileLayout::metrics_index_path(
                "files/default/metrics/cpu/2026/08/19/07/metrics-hash-sorted-v1-456.parquet"
            ),
            None
        );
        assert_eq!(
            MetricsFileLayout::metrics_index_path(
                "files/default/metrics/cpu/2026/08/19/07/456.parquet"
            ),
            None
        );
        // not a full metrics object key
        assert_eq!(
            MetricsFileLayout::metrics_index_path("files/default/metrics-indexed-v1-456.parquet"),
            None
        );
        assert_eq!(
            MetricsFileLayout::metrics_index_path(
                "files/default/logs/app/2026/08/19/07/metrics-indexed-v1-456.parquet"
            ),
            None
        );
    }
}
