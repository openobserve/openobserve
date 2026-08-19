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

//! The TSID-major metrics layout (`ZO_METRICS_TSID_MAJOR_ENABLED`): when it
//! applies to a stream and how the physical layout of a metrics file is
//! encoded in its name.

use arrow_schema::{DataType, Schema};

use super::HASH_LABEL;
use crate::{FileFormat, meta::stream::StreamType};

/// True when `stream_type` uses the TSID-major layout
/// (`ZO_METRICS_TSID_MAJOR_ENABLED`): Parquet metrics files ordered by
/// `(__hash__, _timestamp)`, written hash-sorted by the ingester and
/// size-split by the compactor. Readers must not assume a `_timestamp` order
/// for such streams.
pub fn metrics_tsid_major_enabled(stream_type: StreamType) -> bool {
    if stream_type != StreamType::Metrics {
        return false;
    }
    let cfg = crate::get_config();
    cfg.compact.metrics_tsid_major_enabled
        && cfg.common.file_format.for_stream(stream_type) == FileFormat::Parquet
}

/// [`metrics_tsid_major_enabled`] narrowed to one stream: the layout also
/// needs a `__hash__` column of type `UInt64` (remote-write / OTLP metrics).
/// Streams whose `__hash__` is stored as a string (the JSON ingest path)
/// keep the classic layout, otherwise the TSID-major writer would fail on
/// every merge of that stream.
pub fn metrics_tsid_major_stream(stream_type: StreamType, schema: &Schema) -> bool {
    metrics_tsid_major_enabled(stream_type)
        && schema
            .field_with_name(HASH_LABEL)
            .is_ok_and(|field| field.data_type() == &DataType::UInt64)
}

/// Physical layout of a metrics data file, encoded in its file-name prefix so
/// readers and later merges know the row order without opening the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricsFileLayout {
    /// Classic `_timestamp DESC` file (`{id}.parquet` / `{id}.vortex`).
    Legacy,
    /// Parquet ordered by `(__hash__ ASC, _timestamp ASC)` but not finalized:
    /// written by the ingester and by incremental compactor merges of the
    /// still-open hour (`tsid-sorted-{id}.parquet`).
    HashSorted,
    /// Size-bounded Parquet ordered by `(__hash__ ASC, _timestamp ASC)`,
    /// written by the compactor's hour-end merge (`tsid-major-v3-{id}.parquet`).
    TsidMajor,
}

impl MetricsFileLayout {
    const HASH_SORTED_PREFIX: &'static str = "tsid-sorted-";
    const TSID_MAJOR_PREFIX: &'static str = "tsid-major-v3-";

    /// Layout of the file at `path` (a full object key or a bare file name).
    pub fn of(path: &str) -> Self {
        let file_name = path.rsplit('/').next().unwrap_or(path);
        for (prefix, layout) in [
            (Self::HASH_SORTED_PREFIX, Self::HashSorted),
            (Self::TSID_MAJOR_PREFIX, Self::TsidMajor),
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
            Self::TsidMajor => Self::TSID_MAJOR_PREFIX,
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
    /// (`files/.../7099.parquet` -> `files/.../tsid-sorted-7099.parquet`).
    pub fn mark_file_key(self, key: &str) -> String {
        match key.rfind('/') {
            Some(pos) => format!("{}/{}{}", &key[..pos], self.prefix(), &key[pos + 1..]),
            None => format!("{}{key}", self.prefix()),
        }
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
                "files/default/metrics/cpu/2026/08/18/10/tsid-sorted-7099.parquet"
            ),
            MetricsFileLayout::HashSorted
        );
        assert_eq!(
            MetricsFileLayout::of(
                "files/default/metrics/test/2026/08/13/10/tsid-major-v3-456.parquet"
            ),
            MetricsFileLayout::TsidMajor
        );
        // wrong format, empty id, other versions, marker in a directory name
        for name in [
            "tsid-major-v3-x.vortex",
            "tsid-sorted-1.vortex",
            "tsid-major-v3-.parquet",
            "tsid-sorted-.parquet",
            "tsid-major-v1-x.parquet",
            "tsid-range-v3-b04-p000a-x.parquet",
            "files/tsid-sorted-dir/1.parquet",
        ] {
            assert_eq!(
                MetricsFileLayout::of(name),
                MetricsFileLayout::Legacy,
                "{name}"
            );
        }
        assert!(MetricsFileLayout::HashSorted.is_hash_ordered());
        assert!(MetricsFileLayout::TsidMajor.is_hash_ordered());
        assert!(!MetricsFileLayout::Legacy.is_hash_ordered());
    }

    #[test]
    fn builds_and_marks_file_names() {
        assert_eq!(
            MetricsFileLayout::TsidMajor.file_name("456", FileFormat::Parquet),
            "tsid-major-v3-456.parquet"
        );
        assert_eq!(
            MetricsFileLayout::HashSorted.file_name("456", FileFormat::Parquet),
            "tsid-sorted-456.parquet"
        );
        assert_eq!(
            MetricsFileLayout::Legacy.file_name("456", FileFormat::Vortex),
            "456.vortex"
        );
        let key = "files/default/metrics/cpu/2026/08/18/10/7099.parquet";
        let marked = MetricsFileLayout::HashSorted.mark_file_key(key);
        assert_eq!(
            marked,
            "files/default/metrics/cpu/2026/08/18/10/tsid-sorted-7099.parquet"
        );
        assert_eq!(
            MetricsFileLayout::of(&marked),
            MetricsFileLayout::HashSorted
        );
        assert_eq!(MetricsFileLayout::Legacy.mark_file_key(key), key);
        assert_eq!(
            MetricsFileLayout::HashSorted.mark_file_key("1.parquet"),
            "tsid-sorted-1.parquet"
        );
    }
}
