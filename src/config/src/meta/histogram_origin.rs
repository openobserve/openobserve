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

//! The bucket origin `histogram()` lowers to, and the one rule that depends on it.
//!
//! `rewrite_histogram` does not let `date_bin` default to the Unix epoch: it passes
//! [`ORIGIN_LITERAL`] as `date_bin`'s third argument, so buckets are anchored at
//! 2001-01-01T00:00:00Z. The tantivy index-optimizer fast path instead floors to the epoch
//! (`start_time - start_time % interval`).
//!
//! The two grids therefore agree only where the interval divides [`DATE_BIN_ORIGIN_SECS`],
//! which is 11,323 whole days. That agreement is a **coincidence of the origin, not a
//! guarantee** — the same warning `slo::query` carries — so every consumer reads the constant
//! from here rather than restating the number: `rewrite_histogram` for the `date_bin` argument
//! itself, `merge::downsampling` for the rollup SQL, and the anomaly interval rule for what it
//! accepts. Move the origin here and all three move together.

/// The literal `rewrite_histogram` passes as `date_bin`'s origin argument.
pub const ORIGIN_LITERAL: &str = "2001-01-01T00:00:00";

/// [`ORIGIN_LITERAL`] as a Unix timestamp in seconds.
pub const DATE_BIN_ORIGIN_SECS: i64 = 978_307_200;

/// Whether `histogram()` and the tantivy fast path put this interval on the same grid.
pub fn divides_histogram_origin(interval_secs: i64) -> bool {
    interval_secs > 0 && DATE_BIN_ORIGIN_SECS % interval_secs == 0
}

/// How far the two grids drift apart at this interval, in seconds; 0 when they agree.
pub fn histogram_origin_skew(interval_secs: i64) -> i64 {
    if interval_secs <= 0 {
        return 0;
    }
    DATE_BIN_ORIGIN_SECS % interval_secs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bucket widths an operator can plausibly pick that divide the origin. Adding a value
    /// here that does not divide it fails `an_accepted_interval_puts_both_grids_on_one_edge`.
    const ACCEPTED_INTERVALS: [(&str, i64); 14] = [
        ("30s", 30),
        ("1m", 60),
        ("5m", 300),
        ("10m", 600),
        ("15m", 900),
        ("30m", 1800),
        ("90m", 5400),
        ("1h", 3600),
        ("2h", 7200),
        ("3h", 10800),
        ("4h", 14400),
        ("6h", 21600),
        ("12h", 43200),
        ("1d", 86400),
    ];

    /// Widths a number-plus-unit field accepts that land off the grid.
    const REJECTED_INTERVALS: [(&str, i64); 6] = [
        ("7m", 420),
        ("11m", 660),
        ("5h", 18000),
        ("7h", 25200),
        ("10h", 36000),
        ("2d", 172_800),
    ];

    fn epoch_floor(ts: i64, step: i64) -> i64 {
        ts.div_euclid(step) * step
    }

    fn date_bin(ts: i64, step: i64) -> i64 {
        DATE_BIN_ORIGIN_SECS + (ts - DATE_BIN_ORIGIN_SECS).div_euclid(step) * step
    }

    /// Moving the origin in `rewrite_histogram` must break a test, not detection: this
    /// derives the constant from the literal instead of restating the number.
    #[test]
    fn the_constant_matches_the_literal_rewrite_histogram_passes() {
        let parsed = chrono::NaiveDateTime::parse_from_str(ORIGIN_LITERAL, "%Y-%m-%dT%H:%M:%S")
            .expect("ORIGIN_LITERAL must be the spelling rewrite_histogram.rs passes to date_bin")
            .and_utc()
            .timestamp();
        assert_eq!(
            parsed, DATE_BIN_ORIGIN_SECS,
            "DATE_BIN_ORIGIN_SECS disagrees with ORIGIN_LITERAL"
        );
        assert_eq!(
            DATE_BIN_ORIGIN_SECS % 86_400,
            0,
            "the origin must be a whole number of days for any day-multiple to align"
        );
        assert_eq!(DATE_BIN_ORIGIN_SECS / 86_400, 11_323);
    }

    #[test]
    fn an_accepted_interval_puts_both_grids_on_one_edge() {
        for (interval, secs) in ACCEPTED_INTERVALS {
            assert!(
                divides_histogram_origin(secs),
                "{interval} is on the accepted list but does not divide the origin"
            );
            assert_eq!(histogram_origin_skew(secs), 0, "{interval} must not skew");
            for ts in [0, 1_000_000_000, 1_753_000_000, 2_000_000_123] {
                assert_eq!(
                    epoch_floor(ts, secs),
                    date_bin(ts, secs),
                    "the two grids disagree at ts={ts}, interval={interval}"
                );
            }
        }
    }

    /// The negative control, so the test above cannot pass vacuously.
    #[test]
    fn a_rejected_interval_really_would_drift() {
        for (interval, secs) in REJECTED_INTERVALS {
            assert!(
                !divides_histogram_origin(secs),
                "{interval} is on the rejected list but divides the origin"
            );
            assert_ne!(
                epoch_floor(1_753_000_000, secs),
                date_bin(1_753_000_000, secs),
                "{interval} was put on the rejected list but does not actually drift"
            );
        }
    }

    /// 2d is the trap: every smaller day-multiple divides the origin, but 11,323 is odd.
    #[test]
    fn a_two_day_bucket_is_rejected_even_though_one_day_is_not() {
        assert!(divides_histogram_origin(86_400));
        assert!(!divides_histogram_origin(172_800));
        assert_eq!(histogram_origin_skew(172_800), 86_400);
    }

    #[test]
    fn a_non_positive_interval_never_divides() {
        assert!(!divides_histogram_origin(0));
        assert!(!divides_histogram_origin(-60));
        assert_eq!(histogram_origin_skew(0), 0);
    }
}
