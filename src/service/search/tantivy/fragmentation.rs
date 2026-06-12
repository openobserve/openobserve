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

//! Fragmentation fuse for index row selections.
//!
//! A row-level selection costs DataFusion ~2 RowSelectors (32B) per
//! consecutive-id run plus a vectorization-breaking batch split at every run
//! boundary, while its benefit is the rows it skips. When the matched ids
//! form too many runs, a coalesced superset selection plus the pushed-down
//! filter is as fast (measured within ~10%) and avoids materializing
//! hundreds of MB of selectors.

/// Cap on the number of consecutive-id runs a per-file row selection may
/// have before it degrades to a coalesced superset selection.
///
/// `records / 128` sits at the crossover of the two cost curves: each run
/// costs the parquet reader a fixed ~50-190ns batch split plus 32B of
/// materialized RowSelectors, while each row it skips saves ~1-2ns of
/// decoding. It also bounds the worst-case selector memory at 0.25 byte per
/// row (~2x the old per-file bitmap). The floor avoids degrading small files
/// where either path is cheap.
const RUNS_CAP_DIVISOR: usize = 128;
const RUNS_CAP_MIN: usize = 4096;

/// When degrading, gaps smaller than one decode batch are merged into the
/// surrounding select runs: skipping less than a batch saves no IO (pages
/// are the IO unit) and its decode saving is outweighed by the batch split.
/// After merging, remaining gaps are all >= this, so a file yields at most
/// `records / COALESCE_GAP` ranges regardless of the hit pattern.
const COALESCE_GAP: u32 = 8192;

/// Maximum number of consecutive-id runs a file of `records` rows may carry
/// as an exact row selection before it should degrade.
pub(super) fn runs_cap(records: usize) -> usize {
    (records / RUNS_CAP_DIVISOR).max(RUNS_CAP_MIN)
}

/// Number of consecutive-id runs in a sorted, deduped id list.
pub(super) fn count_runs(sorted_ids: &[u32]) -> usize {
    if sorted_ids.is_empty() {
        return 0;
    }
    1 + sorted_ids.windows(2).filter(|w| w[1] - w[0] > 1).count()
}

/// Merge sorted, deduped ids into `[start, end)` ranges, bridging gaps
/// smaller than [`COALESCE_GAP`]. The result is a superset of the input ids,
/// so the original filter must be re-applied by the query engine.
pub(super) fn coalesce_sorted_ids(sorted_ids: &[u32]) -> Vec<(u32, u32)> {
    coalesce_sorted_ids_with_gap(sorted_ids, COALESCE_GAP)
}

fn coalesce_sorted_ids_with_gap(sorted_ids: &[u32], max_gap: u32) -> Vec<(u32, u32)> {
    let mut ranges = Vec::new();
    let Some(&first) = sorted_ids.first() else {
        return ranges;
    };
    let (mut start, mut end) = (first, first + 1);
    for &id in &sorted_ids[1..] {
        if id - end < max_gap {
            end = id + 1;
        } else {
            ranges.push((start, end));
            start = id;
            end = id + 1;
        }
    }
    ranges.push((start, end));
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runs_cap() {
        // large files scale with 1/128, small files hit the floor
        assert_eq!(runs_cap(4_300_000), 33593);
        assert_eq!(runs_cap(100_000), RUNS_CAP_MIN);
        assert_eq!(runs_cap(0), RUNS_CAP_MIN);
    }

    #[test]
    fn test_count_runs() {
        assert_eq!(count_runs(&[]), 0);
        assert_eq!(count_runs(&[5]), 1);
        assert_eq!(count_runs(&[1, 2, 3]), 1);
        assert_eq!(count_runs(&[1, 2, 4, 5, 9]), 3);
        assert_eq!(count_runs(&[0, 2, 4, 6]), 4);
    }

    #[test]
    fn test_coalesce_sorted_ids() {
        // gaps below max_gap are bridged, larger gaps split
        assert_eq!(
            coalesce_sorted_ids_with_gap(&[], 8),
            Vec::<(u32, u32)>::new()
        );
        assert_eq!(coalesce_sorted_ids_with_gap(&[5], 8), vec![(5, 6)]);
        // gap of 3 (< 8) bridged; gap of 100 (>= 8) splits
        assert_eq!(
            coalesce_sorted_ids_with_gap(&[1, 2, 6, 200], 8),
            vec![(1, 7), (200, 201)]
        );
        // gap exactly max_gap is NOT bridged
        assert_eq!(
            coalesce_sorted_ids_with_gap(&[0, 9], 8),
            vec![(0, 1), (9, 10)]
        );
        // gap of max_gap - 1 is bridged
        assert_eq!(coalesce_sorted_ids_with_gap(&[0, 8], 8), vec![(0, 9)]);
    }
}
