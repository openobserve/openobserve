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

use chrono::{DateTime, Datelike, NaiveDate, Timelike, Utc};
use config::{
    meta::promql::value::{EvalContext, Labels, RangeValue, Sample, Value},
    utils::time::parse_i64_to_timestamp_micros,
};
use datafusion::error::Result;

pub(crate) fn minute(data: Value) -> Result<Value> {
    exec(data, Timelike::minute)
}

pub(crate) fn hour(data: Value) -> Result<Value> {
    exec(data, Timelike::hour)
}

pub(crate) fn month(data: Value) -> Result<Value> {
    exec(data, Datelike::month)
}

pub(crate) fn year(data: Value) -> Result<Value> {
    exec(data, |date| date.year() as u32)
}

pub(crate) fn day_of_month(data: Value) -> Result<Value> {
    exec(data, Datelike::day)
}

pub(crate) fn day_of_week(data: Value) -> Result<Value> {
    exec(data, |date| date.weekday().num_days_from_sunday()) // Starting from 0
}

pub(crate) fn day_of_year(data: Value) -> Result<Value> {
    exec(data, Datelike::ordinal) // Starting from 1
}

pub(crate) fn days_in_month(data: Value) -> Result<Value> {
    exec(data, |date| {
        let cur_month = date.month();
        let cur_year = date.year();
        let naive_date = if cur_month == 12 {
            NaiveDate::from_ymd_opt(cur_year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(cur_year, cur_month + 1, 1)
        };
        naive_date
            .unwrap()
            .signed_duration_since(NaiveDate::from_ymd_opt(cur_year, cur_month, 1).unwrap())
            .num_days() as u32
    })
}

pub(crate) fn timestamp(data: Value) -> Result<Value> {
    super::map_samples(data, "timestamp", |sample| {
        // Convert timestamp from microseconds to seconds for all samples
        (sample.timestamp / 1_000_000) as f64
    })
}

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#time
pub(crate) fn time(eval_ctx: &EvalContext) -> Value {
    // Prometheus evaluates on millisecond timestamps
    let seconds = |micros: i64| (micros / 1_000) as f64 / 1_000.0;
    // exec and the binary operators only treat a Float as a scalar
    if eval_ctx.is_instant() {
        return Value::Float(seconds(eval_ctx.start));
    }
    let samples = eval_ctx
        .timestamps()
        .into_iter()
        .map(|ts| Sample::new(ts, seconds(ts)));
    Value::Matrix(vec![RangeValue::new(Labels::default(), samples)])
}

/// Given a timestamp, get the component from it
/// for e.g. month(), year(), day() etc.
fn exec(data: Value, op: impl Fn(&DateTime<Utc>) -> u32 + Sync) -> Result<Value> {
    super::map_samples(data, "time operation", |sample| {
        let timestamp = parse_i64_to_timestamp_micros(sample.value as i64);
        let naive_datetime = DateTime::from_timestamp_micros(timestamp).unwrap();
        op(&naive_datetime) as f64
    })
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{RangeValue, Sample};

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
    fn test_time_instant_is_a_millisecond_scalar() {
        let eval_ctx = EvalContext::new(
            1_640_995_200_123_456,
            1_640_995_200_123_456,
            60_000_000,
            "t".into(),
        );
        let Value::Float(value) = time(&eval_ctx) else {
            panic!("expected scalar");
        };
        assert_eq!(value, 1_640_995_200.123);
    }

    #[test]
    fn test_time_range_follows_each_step() {
        let start = 1_640_995_200_500_000;
        let eval_ctx = EvalContext::new(start, start + 120_000_000, 60_000_000, "t".into());
        let Value::Matrix(series) = time(&eval_ctx) else {
            panic!("expected matrix");
        };
        assert_eq!(series.len(), 1);
        assert!(series[0].labels.is_empty());
        let samples: Vec<(i64, f64)> = series[0]
            .samples
            .iter()
            .map(|sample| (sample.timestamp, sample.value))
            .collect();
        assert_eq!(
            samples,
            vec![
                (start, 1_640_995_200.5),
                (start + 60_000_000, 1_640_995_260.5),
                (start + 120_000_000, 1_640_995_320.5),
            ]
        );
    }

    #[test]
    fn test_time_ops_invalid_input_returns_err() {
        assert!(minute(Value::Float(1.0)).is_err());
        assert!(timestamp(Value::Float(1.0)).is_err());
    }

    #[test]
    fn test_get_component_from_ts() {
        let timestamp_micros: i64 = 1688379261000000; // Mon Jul 03 2023 10:14:21 GMT+0000

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
        for input in [
            timestamp_micros,
            timestamp_micros / 1_000,
            timestamp_micros / 1_000_000,
        ] {
            for (op, expected) in std::iter::zip(operations, expected_outputs) {
                let data = Value::Matrix(vec![RangeValue::new(
                    vec![],
                    [Sample::new(0, input as f64)],
                )]);
                let Value::Matrix(matrix) = op(data).unwrap() else {
                    panic!("expected matrix");
                };
                assert_eq!(matrix[0].samples[0].value, expected as f64);
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
                .timestamp_micros();
            let data = Value::Matrix(vec![RangeValue::new(
                vec![],
                [Sample::new(0, timestamp as f64)],
            )]);
            let Value::Matrix(matrix) = days_in_month(data).unwrap() else {
                panic!("expected matrix");
            };
            assert_eq!(matrix[0].samples[0].value, expected);
        }
    }
}
