// Copyright 2025 OpenObserve Inc.
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

use std::ops::ControlFlow;

use infra::errors::{Error, ErrorCodes};
use sqlparser::ast::{Expr, FunctionArguments, VisitorMut};

#[derive(Debug)]
pub struct HistogramIntervalVisitor {
    pub is_histogram: bool,
    pub interval: Option<i64>,
    time_range: Option<(i64, i64)>,
}

impl HistogramIntervalVisitor {
    pub fn new(time_range: Option<(i64, i64)>) -> Self {
        Self {
            is_histogram: false,
            interval: None,
            time_range,
        }
    }
}

impl VisitorMut for HistogramIntervalVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr
            && func.name.to_string().eq_ignore_ascii_case("histogram")
        {
            self.is_histogram = true;
            if let FunctionArguments::List(list) = &func.args {
                let mut args = list.args.iter();
                // first is field
                let _ = args.next();
                // second is interval
                let interval = if let Some(interval) = args.next() {
                    interval
                        .to_string()
                        .trim_matches(|v| v == '\'' || v == '"')
                        .to_string()
                } else {
                    generate_histogram_interval(self.time_range).to_string()
                };
                let interval_seconds =
                    convert_histogram_interval_to_seconds(&interval).unwrap_or_default();
                // Validate and adjust the histogram interval
                self.interval = Some(validate_and_adjust_histogram_interval(
                    interval_seconds,
                    self.time_range,
                ));
            }
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

/// Utility macro to generate microsecond-duration pairs concisely
macro_rules! intervals {
    ($(($unit:tt, $amount:expr, $label:expr)),+ $(,)?) => {
        [
            $((intervals!(@unit $unit)($amount).num_microseconds().unwrap(), $label)),+
        ]
    };

    (@unit h) => { chrono::Duration::hours };
    (@unit m) => { chrono::Duration::minutes };
}

pub fn generate_histogram_interval(time_range: Option<(i64, i64)>) -> &'static str {
    let Some((start, end)) = time_range else {
        return "1 hour";
    };
    if (start, end).eq(&(0, 0)) {
        return "1 hour";
    }
    let duration = end - start;

    const INTERVALS: [(i64, &str); 10] = intervals![
        (h, 24 * 60, "1 day"),
        (h, 24 * 30, "12 hour"),
        (h, 24 * 28, "6 hour"),
        (h, 24 * 21, "3 hour"),
        (h, 24 * 15, "2 hour"),
        (h, 6, "1 hour"),
        (h, 2, "1 minute"),
        (h, 1, "30 second"),
        (m, 30, "15 second"),
        (m, 15, "10 second"),
    ];

    for (time, interval) in INTERVALS.iter() {
        if duration >= *time {
            return interval;
        }
    }
    "10 second"
}

pub fn convert_histogram_interval_to_seconds(interval: &str) -> Result<i64, Error> {
    let interval = interval.trim();
    let pos = interval
        .find(|c: char| !c.is_numeric())
        .ok_or_else(|| Error::Message(format!("Invalid interval format: '{interval}'")))?;

    let (num_str, unit_str) = interval.split_at(pos);
    let num = num_str.parse::<i64>().map_err(|_| {
        Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "Invalid number format".to_string(),
        ))
    })?;

    let unit = unit_str.trim().to_lowercase();
    let seconds = match unit.as_str() {
        "second" | "seconds" | "s" | "secs" | "sec" => num,
        "minute" | "minutes" | "m" | "mins" | "min" => num * 60,
        "hour" | "hours" | "h" | "hrs" | "hr" => num * 3600,
        "day" | "days" | "d" => num * 86400,
        _ => {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Unsupported histogram interval unit".to_string(),
            )));
        }
    };

    Ok(seconds)
}

/// Validates and adjusts histogram intervals to ensure they work well with charts.
///
/// This function accepts any interval and ensures it's either:
/// 1. A **multiple** of 24 hours (2 days, 7 days, 30 days, etc.) - returned as-is
/// 2. A **factor** of 24 hours (6h, 12h, etc.) - returned as-is
/// 3. Otherwise, rounds up to the nearest valid factor of 24 hours
///
/// Examples:
/// - 6 hours → 6 hours (factor: 24 / 6 = 4) ✓
/// - 7 days → 7 days (multiple: 7 × 24 hours) ✓
/// - 5 hours → 6 hours (not valid, rounds up to nearest factor)
pub fn validate_and_adjust_histogram_interval(
    interval_seconds: i64,
    time_range: Option<(i64, i64)>,
) -> i64 {
    const TWENTY_FOUR_HOURS_SECONDS: i64 = 24 * 60 * 60; // 86400 seconds

    // If the interval is 0 or negative, return a default value
    if interval_seconds <= 0 {
        // Default to 1 hour
        let interval = generate_histogram_interval(time_range);
        let interval_seconds = convert_histogram_interval_to_seconds(interval).unwrap_or(10);
        return interval_seconds;
    }

    // Check if the interval is a multiple of 24 hours (like 2 days, 7 days, etc.)
    // Example: 7 days (604800 sec) % 86400 sec = 0 ✓
    if interval_seconds % TWENTY_FOUR_HOURS_SECONDS == 0 {
        return interval_seconds;
    }

    // Check if the interval can divide 24 hours evenly (is a factor of 24h)
    // Example: 6 hours (21600 sec): 86400 % 21600 = 0 ✓
    if TWENTY_FOUR_HOURS_SECONDS % interval_seconds == 0 {
        return interval_seconds;
    }

    // Find the next valid interval that can divide 24 hours evenly
    // We'll try intervals that are factors of 24 hours (sorted in ascending order)
    let valid_intervals = [
        1,     // 1 second
        5,     // 5 seconds
        10,    // 10 seconds
        15,    // 15 seconds
        30,    // 30 seconds
        60,    // 1 minute
        300,   // 5 minutes
        600,   // 10 minutes
        900,   // 15 minutes
        1800,  // 30 minutes
        3600,  // 1 hour
        7200,  // 2 hours
        14400, // 4 hours
        21600, // 6 hours
        28800, // 8 hours
        43200, // 12 hours
        86400, // 1 day
    ];

    // Find the smallest valid interval that is >= the requested interval
    for &valid_interval in &valid_intervals {
        if valid_interval >= interval_seconds {
            return valid_interval;
        }
    }

    // If no valid interval found (requested interval is larger than max valid interval)
    // Return the maximum valid interval (1 day)
    *valid_intervals.last().unwrap()
}

#[cfg(test)]
mod tests {

    use sqlparser::{ast::VisitMut, dialect::GenericDialect};

    use super::*;

    #[test]
    fn test_convert_histogram_interval_full_words() {
        // Test full word formats
        assert_eq!(
            convert_histogram_interval_to_seconds("1 second").unwrap(),
            1
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("1 seconds").unwrap(),
            1
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("5 minute").unwrap(),
            300
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("5 minutes").unwrap(),
            300
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("2 hour").unwrap(),
            7200
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("2 hours").unwrap(),
            7200
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("1 day").unwrap(),
            86400
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("1 days").unwrap(),
            86400
        );
        assert!(convert_histogram_interval_to_seconds("1 week").is_err()); // week is not supported
        assert!(convert_histogram_interval_to_seconds("1 weeks").is_err()); // weeks is not supported
        assert!(convert_histogram_interval_to_seconds("1 month").is_err()); // month is not supported
        assert!(convert_histogram_interval_to_seconds("1 months").is_err()); // months is not supported
        assert!(convert_histogram_interval_to_seconds("1 year").is_err()); // year is not supported
        assert!(convert_histogram_interval_to_seconds("1 years").is_err()); // years is not
        // supported
    }

    #[test]
    fn test_convert_histogram_interval_spacing_variants() {
        // Test different spacing formats
        assert_eq!(
            convert_histogram_interval_to_seconds("10second").unwrap(),
            10
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("10 second").unwrap(),
            10
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("10  second").unwrap(),
            10
        ); // double space
        assert_eq!(
            convert_histogram_interval_to_seconds("10\tsecond").unwrap(),
            10
        ); // tab
        assert_eq!(
            convert_histogram_interval_to_seconds("10seconds").unwrap(),
            10
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("10 seconds").unwrap(),
            10
        );
    }

    #[test]
    fn test_convert_histogram_interval_larger_numbers() {
        // Test larger numbers
        assert_eq!(
            convert_histogram_interval_to_seconds("60 seconds").unwrap(),
            60
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("90 minutes").unwrap(),
            5400
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("24 hours").unwrap(),
            86400
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("30 days").unwrap(),
            2592000
        );
        assert!(convert_histogram_interval_to_seconds("52 weeks").is_err());
    }

    #[test]
    fn test_convert_histogram_interval_invalid_inputs() {
        // Test invalid inputs
        assert!(convert_histogram_interval_to_seconds("").is_err());
        assert!(convert_histogram_interval_to_seconds("invalid").is_err());
        assert!(convert_histogram_interval_to_seconds("5x").is_err());
        assert!(convert_histogram_interval_to_seconds("s").is_err());
        assert!(convert_histogram_interval_to_seconds("-1s").is_err());
        assert!(convert_histogram_interval_to_seconds("1.5 seconds").is_err());
        assert!(convert_histogram_interval_to_seconds("second").is_err());
        assert!(convert_histogram_interval_to_seconds(" 5 seconds").is_ok()); // leading space
        assert!(convert_histogram_interval_to_seconds("5 seconds ").is_ok()); // trailing space
        assert!(convert_histogram_interval_to_seconds("five seconds").is_err());
    }

    #[test]
    fn test_convert_histogram_interval_edge_cases() {
        // Test edge cases
        assert_eq!(
            convert_histogram_interval_to_seconds("0 seconds").unwrap(),
            0
        );
        assert_eq!(convert_histogram_interval_to_seconds("0s").unwrap(), 0);
        assert_eq!(
            convert_histogram_interval_to_seconds("1000000 seconds").unwrap(),
            1000000
        );
    }

    #[test]
    fn test_validate_and_adjust_histogram_interval() {
        // Test valid intervals that don't need adjustment (factors of 24 hours)
        assert_eq!(validate_and_adjust_histogram_interval(3600, None), 3600); // 1 hour
        assert_eq!(validate_and_adjust_histogram_interval(7200, None), 7200); // 2 hours
        assert_eq!(validate_and_adjust_histogram_interval(21600, None), 21600); // 6 hours
        assert_eq!(validate_and_adjust_histogram_interval(86400, None), 86400); // 1 day

        // Test intervals that need adjustment (example from TODO: 5 hours -> 6 hours)
        assert_eq!(validate_and_adjust_histogram_interval(18000, None), 21600); // 5 hours -> 6 hours
        assert_eq!(validate_and_adjust_histogram_interval(10000, None), 14400); // ~2.8 hours -> 4 hours
        assert_eq!(validate_and_adjust_histogram_interval(5000, None), 7200); // ~1.4 hours -> 2 hours

        // Test edge cases
        assert_eq!(validate_and_adjust_histogram_interval(0, None), 3600); // 0 -> default 1 hour
        assert_eq!(validate_and_adjust_histogram_interval(-100, None), 3600); // negative -> default 1 hour
        assert_eq!(validate_and_adjust_histogram_interval(1, None), 1); // 1 second is valid
    }

    #[test]
    fn test_validate_and_adjust_histogram_interval_multiples_of_24h() {
        // Test intervals that are multiples of 24 hours (2 days, 7 days, 30 days, etc.)
        // These should be returned as-is, not adjusted
        assert_eq!(validate_and_adjust_histogram_interval(86400, None), 86400); // 1 day
        assert_eq!(validate_and_adjust_histogram_interval(172800, None), 172800); // 2 days
        assert_eq!(validate_and_adjust_histogram_interval(259200, None), 259200); // 3 days
        assert_eq!(validate_and_adjust_histogram_interval(604800, None), 604800); // 7 days
        assert_eq!(
            validate_and_adjust_histogram_interval(1209600, None),
            1209600
        ); // 14 days
        assert_eq!(
            validate_and_adjust_histogram_interval(2592000, None),
            2592000
        ); // 30 days
        assert_eq!(
            validate_and_adjust_histogram_interval(7776000, None),
            7776000
        ); // 90 days
    }

    #[test]
    fn test_validate_and_adjust_histogram_interval_edge_cases_above_1_day() {
        // Test intervals between 1 day and 2 days (not perfect multiples of 24h)
        // These get capped at 1 day (86400 sec) which is the current behavior

        // 25 hours (90000 sec) - not a multiple of 24h, gets capped at 1 day
        let result = validate_and_adjust_histogram_interval(90000, None);
        assert_eq!(result, 86400); // Currently returns 1 day (86400)

        // 1.5 days (129600 sec) - not a multiple of 24h, gets capped at 1 day
        let result = validate_and_adjust_histogram_interval(129600, None);
        assert_eq!(result, 86400); // Currently returns 1 day (86400)

        // 1.9 days (164160 sec) - not a multiple of 24h, gets capped at 1 day
        let result = validate_and_adjust_histogram_interval(164160, None);
        assert_eq!(result, 86400); // Currently returns 1 day (86400)
    }

    #[test]
    fn test_validate_and_adjust_histogram_interval_24_hour_division() {
        // Test that all returned intervals can divide 24 hours evenly
        let test_intervals = [
            18000, // 5 hours (should become 6 hours)
            10000, // ~2.8 hours (should become 4 hours)
            5000,  // ~1.4 hours (should become 2 hours)
            3000,  // 50 minutes (should become 1 hour)
            1500,  // 25 minutes (should become 30 minutes)
            700,   // ~11.7 minutes (should become 15 minutes)
            400,   // ~6.7 minutes (should become 10 minutes)
            200,   // ~3.3 minutes (should become 5 minutes)
            45,    // 45 seconds (should become 1 minute)
            25,    // 25 seconds (should become 30 seconds)
            8,     // 8 seconds (should become 10 seconds)
            3,     // 3 seconds (should become 5 seconds)
        ];

        const TWENTY_FOUR_HOURS: i64 = 24 * 60 * 60; // 86400 seconds

        for &interval in &test_intervals {
            let adjusted = validate_and_adjust_histogram_interval(interval, None);
            // Verify that the adjusted interval can divide 24 hours evenly
            assert_eq!(
                TWENTY_FOUR_HOURS % adjusted,
                0,
                "Interval {adjusted} seconds cannot divide 24 hours evenly"
            );
            // Verify that the adjusted interval is >= the original interval
            assert!(
                adjusted >= interval,
                "Adjusted interval {adjusted} is less than original interval {interval}"
            );
        }
    }

    #[test]
    fn test_histogram_interval_visitor() {
        // Test with time range and histogram function
        let sql = "SELECT histogram(_timestamp, '10 second') FROM logs";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let time_range = Some((1640995200000000, 1641081600000000)); // 2022-01-01 to 2022-01-02
        let mut histogram_interval_visitor = HistogramIntervalVisitor::new(time_range);
        let _ = statement.visit(&mut histogram_interval_visitor);

        // Should extract the interval from the histogram function
        assert_eq!(histogram_interval_visitor.interval, Some(10));
    }

    #[test]
    fn test_histogram_interval_visitor_with_zero_time_range() {
        // Test with zero time range
        let sql = "SELECT histogram(_timestamp) FROM logs";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let time_range = Some((0, 0));
        let mut histogram_interval_visitor = HistogramIntervalVisitor::new(time_range);
        let _ = statement.visit(&mut histogram_interval_visitor);

        // Should return default interval of 1 hour (3600 seconds)
        assert_eq!(histogram_interval_visitor.interval, Some(3600));
    }
}
