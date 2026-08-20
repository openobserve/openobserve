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

//! What the compactor merges in a closed TSID-major hour: nothing when it is
//! finalized, the late files alone while fragmentation is low, else the
//! whole hour.

use config::meta::{promql::tsid_layout::MetricsFileLayout, stream::FileKey};

/// Finalized `tsid-major-v3-*` files a closed hour may hold beyond the ideal
/// `total_size / max_file_size` before the whole hour is rewritten.
const TSID_MAJOR_REWRITE_SLACK: usize = 4;

/// What the merge of a closed TSID-major hour covers.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum TsidMajorMergeScope {
    /// Every file is `tsid-major-v3-*` and the count fits the current
    /// `max_file_size`: leave the hour alone.
    Skip,
    /// Merge only the late (non-v3) files into one new v3; finalized files
    /// stay. The hour's v3 hash ranges then overlap, which readers handle
    /// per file.
    LateFilesOnly,
    /// Too many finalized files: rewrite the whole hour. Reached by late
    /// merges piling up fragments (amortizes their full-rewrite cost) or by
    /// a raised `max_file_size` shrinking the ideal count (such hours are
    /// re-enqueued by the old-data sweep).
    WholeHour,
}

pub(super) fn tsid_major_merge_scope(
    files: &[FileKey],
    max_file_size: usize,
) -> TsidMajorMergeScope {
    let finalized = files
        .iter()
        .filter(|f| MetricsFileLayout::of(&f.key) == MetricsFileLayout::TsidMajor)
        .count();
    let total_original_size: i64 = files.iter().map(|f| f.meta.original_size.max(0)).sum();
    let ideal_file_count = (total_original_size as usize).div_ceil(max_file_size.max(1));
    if finalized > ideal_file_count + TSID_MAJOR_REWRITE_SLACK {
        TsidMajorMergeScope::WholeHour
    } else if finalized == files.len() {
        TsidMajorMergeScope::Skip
    } else {
        TsidMajorMergeScope::LateFilesOnly
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    fn file_key(name: &str, original_size: i64) -> FileKey {
        let mut key = FileKey::from_file_name(&format!("files/o/metrics/m/2026/08/18/10/{name}"));
        key.meta = FileMeta {
            min_ts: 10,
            max_ts: 20,
            records: 100,
            original_size,
            ..Default::default()
        };
        key
    }

    #[test]
    fn test_tsid_major_merge_scope() {
        let max_file_size = 100_usize;
        let v3 = |id: usize| file_key(&format!("tsid-major-v3-{id}.parquet"), 10);
        let late = |id: usize| file_key(&format!("tsid-sorted-{id}.parquet"), 10);

        // every file finalized and acceptably sized: the hour is left alone
        assert_eq!(
            tsid_major_merge_scope(&[v3(1), v3(2)], max_file_size),
            TsidMajorMergeScope::Skip
        );
        // max_file_size raised (files written at a smaller target): an all-v3
        // hour above the cap is rewritten to the new size, no late data needed
        let raised: Vec<FileKey> = (1..=10).map(v3).collect();
        assert_eq!(
            tsid_major_merge_scope(&raised, max_file_size),
            TsidMajorMergeScope::WholeHour
        );
        // same files under the original target (ideal 10): left alone
        assert_eq!(
            tsid_major_merge_scope(&raised, 10),
            TsidMajorMergeScope::Skip
        );
        // no finalized files yet (first hour-end pass): merge everything
        assert_eq!(
            tsid_major_merge_scope(&[late(1), late(2)], max_file_size),
            TsidMajorMergeScope::LateFilesOnly
        );
        // few finalized files: only the late ones merge
        assert_eq!(
            tsid_major_merge_scope(&[v3(1), v3(2), v3(3), late(4)], max_file_size),
            TsidMajorMergeScope::LateFilesOnly
        );
        // fragmentation cap: 8 finalized files, total size 90 -> ideal 1,
        // 8 > 1 + TSID_MAJOR_REWRITE_SLACK -> rewrite the whole hour
        let mut fragmented: Vec<FileKey> = (1..=8).map(v3).collect();
        fragmented.push(late(9));
        assert_eq!(
            tsid_major_merge_scope(&fragmented, max_file_size),
            TsidMajorMergeScope::WholeHour
        );
        // same file count but a large hour (ideal 9): still a late-only merge
        let mut large: Vec<FileKey> = (1..=8)
            .map(|id| file_key(&format!("tsid-major-v3-{id}.parquet"), 100))
            .collect();
        large.push(late(9));
        assert_eq!(
            tsid_major_merge_scope(&large, max_file_size),
            TsidMajorMergeScope::LateFilesOnly
        );
    }
}
