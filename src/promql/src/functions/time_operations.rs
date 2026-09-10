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

use chrono::{Datelike, NaiveDate, Timelike};
use config::{meta::promql::value::Value, utils::time::parse_i64_to_timestamp_micros};
use datafusion::error::Result;
use strum::EnumIter;

#[derive(Debug, EnumIter)]
pub enum TimeOperationType {
    Minute,
    Hour,
    DayOfWeek,
    DayOfMonth,
    DayOfYear,
    DaysInMonth,
    Month,
    Year,
}

impl TimeOperationType {
    /// Given a timestamp, get the TimeOperationType component from it
    /// for e.g. month(), year(), day() etc.
    pub fn get_component_from_ts(&self, timestamp: i64) -> u32 {
        let timestamp = parse_i64_to_timestamp_micros(timestamp);
        let naive_datetime = chrono::DateTime::from_timestamp_micros(timestamp).unwrap();
        match self {
            Self::Minute => naive_datetime.minute(),
            Self::Hour => naive_datetime.hour(),
            Self::Month => naive_datetime.month(),
            Self::Year => naive_datetime.year() as u32,
            Self::DayOfWeek => naive_datetime.weekday().num_days_from_sunday(), // Starting from 0
            Self::DayOfMonth => naive_datetime.day(),
            Self::DayOfYear => naive_datetime.ordinal(), // Starting from 1
            Self::DaysInMonth => {
                let cur_month = naive_datetime.month();
                let cur_year = naive_datetime.year();
                let naive_date = if cur_month == 12 {
                    NaiveDate::from_ymd_opt(cur_year + 1, 1, 1)
                } else {
                    NaiveDate::from_ymd_opt(cur_year, cur_month + 1, 1)
                };
                naive_date
                    .unwrap()
                    .signed_duration_since(NaiveDate::from_ymd_opt(cur_year, cur_month, 1).unwrap())
                    .num_days() as u32
            }
        }
    }
}

pub(crate) fn minute(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::Minute)
}

pub(crate) fn hour(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::Hour)
}

pub(crate) fn month(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::Month)
}

pub(crate) fn year(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::Year)
}

pub(crate) fn day_of_month(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::DayOfMonth)
}

pub(crate) fn day_of_week(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::DayOfWeek)
}

pub(crate) fn day_of_year(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::DayOfYear)
}

pub(crate) fn days_in_month(data: Value) -> Result<Value> {
    exec(data, &TimeOperationType::DaysInMonth)
}

pub(crate) fn timestamp(data: Value) -> Result<Value> {
    super::map_samples(data, "timestamp", |sample| {
        // Convert timestamp from microseconds to seconds for all samples
        (sample.timestamp / 1_000_000) as f64
    })
}

fn exec(data: Value, op: &TimeOperationType) -> Result<Value> {
    super::map_samples(data, "time operation", |sample| {
        op.get_component_from_ts(sample.value as i64) as f64
    })
}

#[cfg(test)]
mod tests {
    use strum::IntoEnumIterator;

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
    fn test_get_component_from_ts() {
        let timestamp_micros = 1688379261000000; // Mon Jul 03 2023 10:14:21 GMT+0000

        let expected_outputs = [14, 10, 1, 3, 184, 31, 7]; // Strict ordering based on TimeOperationType
        for (op, expected) in std::iter::zip(TimeOperationType::iter(), expected_outputs) {
            let got = op.get_component_from_ts(timestamp_micros);
            assert!(
                got == expected,
                "operation type: {op:?} expected {expected} got {got}"
            );
        }
    }
}
