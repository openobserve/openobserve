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

use config::meta::promql::value::{EvalContext, Labels, Value};
use datafusion::error::{DataFusionError, Result};

use super::{
    SeriesRange, absent::absent_series, drop_stale_markers, present_over_time::PresentOverTimeFunc,
};

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#absent_over_time
pub(crate) fn absent_over_time(
    data: Value,
    labels: Labels,
    eval_ctx: &EvalContext,
) -> Result<Value> {
    let matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => vec![],
        other => {
            return Err(DataFusionError::Plan(format!(
                "absent_over_time: matrix argument expected but got {}",
                other.get_type()
            )));
        }
    };
    let timestamps = eval_ctx.timestamps();
    let mut present = vec![false; timestamps.len()];
    let mut missing = timestamps.len();
    for mut series in matrix {
        if missing == 0 {
            return Ok(Value::None);
        }
        let range = series
            .time_window
            .as_ref()
            .ok_or_else(|| {
                DataFusionError::Internal("absent_over_time: series without a range".into())
            })?
            .range;
        drop_stale_markers(&mut series.samples, &PresentOverTimeFunc);
        for (slot, _) in SeriesRange::new(
            &series.samples,
            &PresentOverTimeFunc,
            range,
            eval_ctx,
            &timestamps,
        ) {
            if !present[slot] {
                present[slot] = true;
                missing -= 1;
            }
        }
    }
    Ok(absent_series(
        labels,
        timestamps
            .into_iter()
            .zip(present)
            .filter_map(|(timestamp, present)| (!present).then_some(timestamp)),
    ))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{RangeValue, Sample, TimeWindow};

    use super::*;

    fn reported(value: &Value) -> Vec<(i64, f64)> {
        match value {
            Value::Matrix(v) => v
                .iter()
                .flat_map(|series| series.samples.iter())
                .map(|sample| (sample.timestamp, sample.value))
                .collect(),
            Value::None => vec![],
            _ => panic!("Expected Matrix result"),
        }
    }

    fn series(timestamps: &[i64]) -> RangeValue {
        RangeValue {
            labels: Labels::default(),
            samples: timestamps.iter().map(|&ts| Sample::new(ts, 5.0)).collect(),
            exemplars: None,
            time_window: Some(TimeWindow {
                range: Duration::from_micros(2000),
                offset: Duration::ZERO,
            }),
        }
    }

    fn absent_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        absent_over_time(data, Labels::default(), &eval_ctx)
    }

    #[test]
    fn test_absent_over_time_value_none_input() {
        let result = absent_over_time_test_helper(Value::None).unwrap();
        match &result {
            Value::Matrix(v) => assert_eq!(
                v.len(),
                1,
                "a metric that is entirely gone is still one answer"
            ),
            _ => panic!("Expected Matrix result"),
        }
        assert_eq!(reported(&result), vec![(3000, 1.0)]);
        let result = absent_over_time_test_helper(Value::Matrix(vec![])).unwrap();
        assert_eq!(reported(&result), vec![(3000, 1.0)]);
    }

    #[test]
    fn test_absent_over_time_reports_every_step_of_a_range_query() {
        let eval_ctx = EvalContext::new(1000, 3000, 1000, "test".to_string());
        let result = absent_over_time(Value::None, Labels::default(), &eval_ctx).unwrap();
        assert_eq!(
            reported(&result),
            vec![(1000, 1.0), (2000, 1.0), (3000, 1.0)]
        );
    }

    #[test]
    fn test_absent_over_time_is_silent_while_the_metric_reports() {
        let result = absent_over_time_test_helper(Value::Matrix(vec![series(&[3000])])).unwrap();
        assert!(
            reported(&result).is_empty(),
            "present data must report no absence"
        );
    }

    #[test]
    fn test_absent_over_time_reports_gaps_of_an_existing_series() {
        let eval_ctx = EvalContext::new(2000, 10000, 2000, "test".to_string());
        // windows are (t - 2000, t], so 3000 covers step 4000 and 9000 covers step 10000
        let data = Value::Matrix(vec![series(&[3000]), series(&[9000])]);
        let result = absent_over_time(data, Labels::default(), &eval_ctx).unwrap();
        assert_eq!(
            reported(&result),
            vec![(2000, 1.0), (6000, 1.0), (8000, 1.0)]
        );
    }

    #[test]
    fn test_absent_over_time_invalid_input_returns_err() {
        let result = absent_over_time_test_helper(Value::Float(1.0));
        assert!(result.is_err());
    }
}
