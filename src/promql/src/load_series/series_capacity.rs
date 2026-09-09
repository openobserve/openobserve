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

//! Sample-capacity estimation for hash-sorted series materialization.

use config::utils::time::hour_micros;

const MAX_SERIES_FRAGMENT_HINT: usize = 24;
const MAX_INITIAL_SERIES_CAPACITY: usize = 2048;

/// Length of the contiguous run of equal hashes starting at `start`.
pub(crate) fn batch_run_len(hashes: &[u64], start: usize) -> usize {
    let hash = hashes[start];
    let mut end = start + 1;
    while end < hashes.len() && hashes[end] == hash {
        end += 1;
    }
    end - start
}

/// Estimate the total sample count of a series from its first contiguous run
/// of `first_run_len` rows spanning `[run_first_ts, run_last_ts]`.
///
/// Two estimates cover the common shapes: `run × fragments` fits a series
/// whose runs arrive whole, `duration / interval` recovers a first run
/// truncated by a batch boundary. Overestimating (short-lived series, the
/// sparse-window optimization path) only wastes capacity, bounded by
/// `MAX_INITIAL_SERIES_CAPACITY`.
pub(super) fn initial_series_capacity(
    first_run_len: usize,
    fragment_hint: usize,
    run_first_ts: i64,
    run_last_ts: i64,
    query_duration: i64,
) -> usize {
    let run_based = first_run_len.saturating_mul(fragment_hint);
    // At least two intervals, so a single anomalous gap (adjacent
    // near-duplicate rows in time-sorted input) cannot dictate the estimate.
    let interval_based = if first_run_len >= 3 && run_last_ts > run_first_ts {
        let sample_interval =
            ((run_last_ts - run_first_ts) / (first_run_len - 1) as i64).max(1) as u64;
        let samples = (query_duration.max(0) as u64)
            .div_ceil(sample_interval)
            .saturating_add(1);
        usize::try_from(samples).unwrap_or(MAX_INITIAL_SERIES_CAPACITY)
    } else {
        0
    };
    // The current batch already proves first_run_len samples exist, so the
    // cap never allocates below that.
    let cap = MAX_INITIAL_SERIES_CAPACITY.max(first_run_len);
    run_based.max(interval_based).min(cap)
}

/// Hash-sorted parquet is written per storage hour, so a series arrives as
/// roughly one contiguous run per hour fragment of the query span.
pub(super) fn series_fragment_hint(query_duration: i64) -> usize {
    let hourly_fragments = (query_duration.max(0) as u64).div_ceil(hour_micros(1) as u64);
    hourly_fragments.clamp(1, MAX_SERIES_FRAGMENT_HINT as u64) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_run_len() {
        let hashes = [7u64, 7, 7, 9, 9, 1];
        assert_eq!(batch_run_len(&hashes, 0), 3);
        assert_eq!(batch_run_len(&hashes, 3), 2);
        assert_eq!(batch_run_len(&hashes, 5), 1);
    }

    #[test]
    fn test_initial_series_capacity_is_bounded() {
        assert_eq!(initial_series_capacity(160, 4, 0, 0, 0), 640);
        assert_eq!(
            initial_series_capacity(100, 4, 0, 99 * 15 * 1_000_000, 11_100 * 1_000_000),
            741,
        );
        assert_eq!(initial_series_capacity(1024, 4, 0, 0, 0), 2048);
        assert_eq!(initial_series_capacity(4096, 4, 0, 0, 0), 4096);
        // A 2-row run must not infer an interval from its single gap.
        assert_eq!(
            initial_series_capacity(2, 4, 0, 1_000, 11_100 * 1_000_000),
            8
        );
    }

    #[test]
    fn test_series_fragment_hint_is_bounded() {
        let hour = hour_micros(1);
        assert_eq!(series_fragment_hint(3 * hour + 5 * 60 * 1_000_000), 4);
        assert_eq!(series_fragment_hint(0), 1);
        assert_eq!(series_fragment_hint(100 * hour), MAX_SERIES_FRAGMENT_HINT);
    }
}
