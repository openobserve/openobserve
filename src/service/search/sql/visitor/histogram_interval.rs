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
    pub interval: Option<i64>,
    time_range: Option<(i64, i64)>,
}

impl HistogramIntervalVisitor {
    pub fn new(time_range: Option<(i64, i64)>) -> Self {
        Self {
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
                self.interval = match convert_histogram_interval_to_seconds(&interval) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::error!("{e:?}");
                        Some(0)
                    }
                };
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
