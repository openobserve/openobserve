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

/// Get the default maximum query range in hours considering the stream setting max query range
/// and the environment variable ZO_DEFAULT_MAX_QUERY_RANGE_DAYS
pub fn get_default_max_query_range(stream_max_query_range: i64) -> i64 {
    let cfg = crate::get_config();
    let default_max_query_range = cfg.limit.default_max_query_range_days * 24;

    // This will allow the stream setting to override the global setting
    if stream_max_query_range > 0 {
        stream_max_query_range
    } else {
        default_max_query_range
    }
}

/// Start time limited to `max_hours` before `end`, or `None` when no clamp applies.
pub fn clamp_start_time(start: i64, end: i64, max_hours: i64) -> Option<i64> {
    if max_hours <= 0 {
        return None;
    }
    // Stream settings accept any i64 hours; a plain multiply wraps and pushes start past end.
    let max_micros = max_hours.saturating_mul(3600 * 1_000_000);
    (end.saturating_sub(start) > max_micros).then(|| end - max_micros)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 3600 * 1_000_000;

    #[test]
    fn clamp_start_time_limits_the_range() {
        assert_eq!(clamp_start_time(0, 10 * HOUR, 2), Some(8 * HOUR));
        assert_eq!(clamp_start_time(9 * HOUR, 10 * HOUR, 2), None);
        assert_eq!(clamp_start_time(8 * HOUR, 10 * HOUR, 2), None);
        assert_eq!(clamp_start_time(0, 10 * HOUR, 0), None);
        assert_eq!(clamp_start_time(0, 10 * HOUR, -5), None);
    }

    #[test]
    fn clamp_start_time_survives_a_huge_max_query_range() {
        let (start, end) = (1_792_919_976_430_732, 1_793_524_776_430_732);
        assert_eq!(clamp_start_time(start, end, 4_746_838_768), None);
        assert_eq!(clamp_start_time(start, end, i64::MAX), None);
        assert_eq!(clamp_start_time(i64::MIN, end, i64::MAX / HOUR + 1), None);
    }

    #[test]
    fn clamp_start_time_survives_extreme_start_times() {
        let end = 1_793_524_776_430_732;
        assert_eq!(clamp_start_time(i64::MIN, end, 2), Some(end - 2 * HOUR));
        assert_eq!(
            clamp_start_time(i64::MIN, i64::MAX, 2),
            Some(i64::MAX - 2 * HOUR)
        );
    }
}
