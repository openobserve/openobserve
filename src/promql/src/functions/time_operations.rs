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

use chrono::{DateTime, Datelike, Timelike, Utc};
use config::meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value};
use datafusion::error::Result;

pub(crate) fn minute(data: Value) -> Result<Value> {
    exec(data, |date| date.minute().into())
}

pub(crate) fn hour(data: Value) -> Result<Value> {
    exec(data, |date| date.hour().into())
}

pub(crate) fn month(data: Value) -> Result<Value> {
    exec(data, |date| date.month().into())
}

pub(crate) fn year(data: Value) -> Result<Value> {
    exec(data, |date| date.year().into())
}

pub(crate) fn day_of_month(data: Value) -> Result<Value> {
    exec(data, |date| date.day().into())
}

pub(crate) fn day_of_week(data: Value) -> Result<Value> {
    exec(data, |date| date.weekday().num_days_from_sunday().into()) // Starting from 0
}

pub(crate) fn day_of_year(data: Value) -> Result<Value> {
    exec(data, |date| date.ordinal().into()) // Starting from 1
}

pub(crate) fn days_in_month(data: Value) -> Result<Value> {
    exec(data, |date| date.num_days_in_month().into())
}

pub(crate) fn timestamp(data: Value) -> Result<Value> {
    super::map_samples(data, "timestamp", |sample| seconds(sample.timestamp))
}

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#time
pub(crate) fn time(eval_ctx: &EvalContext) -> Value {
    if eval_ctx.is_instant() {
        return Value::Float(seconds(eval_ctx.start));
    }
    // a range-evaluated scalar is one label-less series with a sample per step
    Value::Matrix(vec![RangeValue::new(
        Labels::default(),
        eval_ctx
            .timestamps()
            .into_iter()
            .map(|timestamp| Sample::new(timestamp, seconds(timestamp))),
    )])
}

// Prometheus timestamps are whole milliseconds, so the microseconds below that are dropped
fn seconds(micros: i64) -> f64 {
    micros.div_euclid(1_000) as f64 / 1_000.0
}

/// Given a timestamp, get the component from it
/// for e.g. month(), year(), day() etc.
fn exec(data: Value, op: impl Fn(&DateTime<Utc>) -> f64 + Sync) -> Result<Value> {
    super::map_samples(data, "time operation", |sample| {
        // Prometheus reads Unix seconds truncated toward zero; beyond chrono's range gives NaN
        let date = sample
            .value
            .is_finite()
            .then(|| DateTime::from_timestamp(sample.value as i64, 0))
            .flatten();
        date.map_or(f64::NAN, |date| op(&date))
    })
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::*;

    #[test]
    fn test_time_ops_value_none_input() {
        assert!(matches!(minute(Value::None).unwrap(), Value::None));
        assert!(matches!(hour(Value::None).unwrap(), Value::None));
        assert!(matches!(month(Value::None).unwrap(), Value::None));
        assert!(matches!(year(Value::None).unwrap(), Value::None));
        assert!(matches!(day_of_week(Value::None).unwrap(), Value::None));
        assert!(matches!(day_of_month(Value::None).unwrap(), Value::None));
        assert!(matches!(day_of_year(Value::None).unwrap(), Value::None));
        assert!(matches!(days_in_month(Value::None).unwrap(), Value::None));
        assert!(matches!(timestamp(Value::None).unwrap(), Value::None));
    }

    #[test]
    fn test_time_ops_invalid_input_returns_err() {
        assert!(minute(Value::Float(1.0)).is_err());
        assert!(timestamp(Value::Float(1.0)).is_err());
    }

    #[test]
    fn test_time_and_timestamp_truncate_to_milliseconds() {
        let instant = 1_640_995_200_123_456;
        let eval_ctx = EvalContext::new(instant, instant, 0, "test".into());
        assert!(matches!(time(&eval_ctx), Value::Float(t) if t == 1_640_995_200.123));

        let data = Value::Matrix(vec![RangeValue::new(
            vec![],
            [Sample::new(instant, 0.0), Sample::new(-1_500, 0.0)],
        )]);
        let Value::Matrix(matrix) = timestamp(data).unwrap() else {
            panic!("expected matrix");
        };
        let values: Vec<f64> = matrix[0].samples.iter().map(|s| s.value).collect();
        assert_eq!(values, [1_640_995_200.123, -0.002]);
    }

    fn apply(op: fn(Value) -> Result<Value>, input: f64) -> f64 {
        let data = Value::Matrix(vec![RangeValue::new(vec![], [Sample::new(0, input)])]);
        let Value::Matrix(matrix) = op(data).unwrap() else {
            panic!("expected matrix");
        };
        matrix[0].samples[0].value
    }

    #[test]
    fn test_get_component_from_ts() {
        let timestamp_seconds: i64 = 1688379261; // Mon Jul 03 2023 10:14:21 GMT+0000

        let operations = [
            minute,
            hour,
            day_of_week,
            day_of_month,
            day_of_year,
            days_in_month,
            month,
            year,
        ];
        let expected_outputs = [14, 10, 1, 3, 184, 31, 7, 2023]; // Strict ordering based on operations
        for (op, expected) in std::iter::zip(operations, expected_outputs) {
            assert_eq!(apply(op, timestamp_seconds as f64 + 0.9), expected as f64);
        }
    }

    #[test]
    fn test_date_functions_read_unix_seconds() {
        assert_eq!(apply(day_of_week, 0.0), 4.0);
        assert_eq!(apply(year, 0.0), 1970.0);
        assert_eq!(apply(hour, 0.0), 0.0);
        assert_eq!(apply(year, 4e10), 3237.0);
        assert_eq!(apply(year, -0.5), 1970.0);
        assert_eq!(apply(year, -1e11), -1199.0);
    }

    #[test]
    fn test_date_functions_out_of_range_are_nan() {
        for input in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -9e12,
            -1e13,
            1e13,
            1e300,
        ] {
            for op in [year, days_in_month, day_of_week] {
                assert!(apply(op, input).is_nan(), "{input}");
            }
        }
    }

    #[test]
    fn test_days_in_month_boundaries() {
        for (date, expected) in [
            ("2024-02-29", 29.0),
            ("2023-02-28", 28.0),
            ("2023-12-31", 31.0),
        ] {
            let timestamp = NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .unwrap()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp();
            assert_eq!(apply(days_in_month, timestamp as f64), expected);
        }
    }
}
