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

#[cfg(test)]
use std::time::Duration;

use config::meta::promql::value::{EvalContext, RangeValue, Sample, Value};
use datafusion::error::{DataFusionError, Result};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

#[cfg(test)]
use crate::functions::RangeFunc;
use crate::micros;

pub(crate) fn last_over_time(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let matrix = match data {
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(Value::None),
        value => {
            return Err(DataFusionError::Plan(format!(
                "last_over_time: matrix argument expected but got {}",
                value.get_type()
            )));
        }
    };
    let timestamps = eval_ctx.timestamps();
    let results: Vec<Result<Option<RangeValue>>> = matrix
        .into_par_iter()
        .map(|metric| {
            let time_window = metric.time_window.clone().ok_or_else(|| {
                DataFusionError::Plan("last_over_time: range selector required".into())
            })?;
            let range_micros = micros(time_window.range);
            let histograms = metric.histogram_samples.as_deref().unwrap_or_default();
            let mut float_output = Vec::new();
            let mut histogram_output = Vec::new();
            let mut float_start = 0;
            let mut float_end = 0;
            let mut histogram_start = 0;
            let mut histogram_end = 0;
            for &eval_ts in &timestamps {
                let window_start = eval_ts - range_micros;
                let floats = super::advance_sample_window(
                    &metric.samples,
                    window_start,
                    eval_ts,
                    &mut float_start,
                    &mut float_end,
                );
                let histograms = super::advance_histogram_window(
                    histograms,
                    window_start,
                    eval_ts,
                    &mut histogram_start,
                    &mut histogram_end,
                );
                let latest_float = floats.last();
                let latest_histogram = histograms.last();
                if latest_histogram.is_some_and(|histogram| {
                    latest_float.is_none_or(|float| histogram.timestamp >= float.timestamp)
                }) {
                    let histogram = latest_histogram.expect("latest histogram must exist");
                    if histogram
                        .histogram
                        .is_stale()
                        .map_err(|err| DataFusionError::Execution(err.to_string()))?
                    {
                        continue;
                    }
                    let mut histogram = histogram.clone();
                    histogram.timestamp = eval_ts;
                    histogram_output.push(histogram);
                } else if let Some(sample) = latest_float {
                    float_output.push(Sample::new(eval_ts, sample.value));
                }
            }
            if float_output.is_empty() && histogram_output.is_empty() {
                return Ok(None);
            }
            Ok(Some(RangeValue {
                labels: metric.labels,
                samples: float_output,
                histogram_samples: (!histogram_output.is_empty()).then_some(histogram_output),
                exemplars: None,
                time_window: Some(time_window),
            }))
        })
        .collect();
    let output = results
        .into_iter()
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();
    Ok(Value::Matrix(output))
}

#[cfg(test)]
pub struct LastOverTimeFunc;

#[cfg(test)]
impl LastOverTimeFunc {
    pub fn new() -> Self {
        LastOverTimeFunc {}
    }
}

#[cfg(test)]
impl RangeFunc for LastOverTimeFunc {
    fn name(&self) -> &'static str {
        "last_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        if samples.is_empty() {
            return None;
        }
        // NOTE: Comment taken from prometheus golang source.
        // The last_over_time function acts like offset; thus, it
        // should keep the metric name.  For all the other range
        // vector functions, the only change needed is to drop the
        // metric name in the output.
        Some(samples.last().unwrap().value)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::promql::value::{Labels, RangeValue, TimeWindow};

    use super::*;

    // Test helper
    fn last_over_time_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::new(3000, 3000, 0, "test".to_string());
        last_over_time(data, &eval_ctx)
    }

    #[test]
    fn test_last_over_time_value_none_input() {
        let result = last_over_time_test_helper(Value::None).unwrap();
        assert!(matches!(result, Value::None));
    }

    #[test]
    fn test_last_over_time_invalid_input_returns_err() {
        let result = last_over_time_test_helper(Value::Float(1.0));
        assert!(result.is_err());
    }

    #[test]
    fn test_last_over_time_exec_empty_samples_returns_none() {
        let func = LastOverTimeFunc::new();
        assert!(func.exec(&[], 0, &Duration::ZERO).is_none());
    }

    #[test]
    fn test_last_over_time_function() {
        // Create a range value with sample data
        let samples = vec![
            Sample::new(1000, 10.0),
            Sample::new(2000, 20.0),
            Sample::new(3000, 30.0),
        ];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            histogram_samples: None,
            exemplars: None,
            time_window: Some(TimeWindow {
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = last_over_time_test_helper(matrix).unwrap();

        // Should return a matrix with last value
        match result {
            Value::Matrix(m) => {
                assert_eq!(m.len(), 1);
                assert_eq!(m[0].samples.len(), 1);
                // Should return the last value: 30.0
                assert!((m[0].samples[0].value - 30.0).abs() < 0.001);
                assert_eq!(m[0].samples[0].timestamp, 3000);
            }
            _ => panic!("Expected Matrix result"),
        }
    }
}
