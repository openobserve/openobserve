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

use std::time::Duration;

use config::meta::promql::value::Sample;

use crate::functions::RangeFunc;

pub struct PresentOverTimeFunc;

impl RangeFunc for PresentOverTimeFunc {
    fn name(&self) -> &'static str {
        "present_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        Some(1.0)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{EvalContext, Labels, RangeValue, TimeWindow, Value};
    use datafusion::error::Result;

    use super::*;

    fn present_over_time(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        crate::functions::eval_range(data, PresentOverTimeFunc, &eval_ctx)
    }

    #[test]
    fn test_present_over_time_value_none_input() {
        let result = present_over_time(Value::None).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_present_over_time_invalid_input_returns_err() {
        assert!(present_over_time(Value::Float(1.0)).is_err());
    }

    #[test]
    fn test_present_over_time_exec_empty_samples_returns_none() {
        assert!(PresentOverTimeFunc.exec(&[], 0, &Duration::ZERO).is_none());
    }

    #[test]
    fn test_present_over_time_is_one_regardless_of_sample_values() {
        let range_value = RangeValue {
            labels: Labels::default(),
            samples: vec![
                Sample::new(1000, 0.0),
                Sample::new(2000, f64::NAN),
                Sample::new(3000, -30.0),
            ],
            exemplars: None,
            time_window: Some(TimeWindow {
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };

        let Value::Matrix(m) = present_over_time(Value::Matrix(vec![range_value])).unwrap() else {
            panic!("Expected Matrix result");
        };
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].samples.len(), 1);
        assert_eq!(m[0].samples[0].value, 1.0);
        assert_eq!(m[0].samples[0].timestamp, 3000);
    }
}
