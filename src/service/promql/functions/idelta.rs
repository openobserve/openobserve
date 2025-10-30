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

use datafusion::error::Result;

use crate::service::promql::{
    functions::RangeFunc,
    value::{EvalContext, Labels, RangeValue, Sample, TimeWindow, Value},
};

/// Enhanced version that processes all timestamps at once for range queries
pub(crate) fn idelta_range(data: Value, eval_ctx: &EvalContext) -> Result<Value> {
    let start = std::time::Instant::now();
    log::info!("[PromQL Timing] idelta_range() started");
    let result = super::eval_range(data, IdeltaFunc::new(), eval_ctx);
    log::info!(
        "[PromQL Timing] idelta_range() execution took: {:?}",
        start.elapsed()
    );
    result
}

pub struct IdeltaFunc;

impl IdeltaFunc {
    pub fn new() -> Self {
        IdeltaFunc {}
    }
}

impl RangeFunc for IdeltaFunc {
    fn name(&self) -> &'static str {
        "idelta"
    }

    fn exec_instant(&self, _data: RangeValue) -> Option<f64> {
        None
    }

    fn exec_range(
        &self,
        _labels: &Labels,
        samples: &[Sample],
        _time_win: &Option<TimeWindow>,
    ) -> Option<f64> {
        if samples.len() < 2 {
            return None;
        }
        let last = samples.last().unwrap();
        let previous = samples.get(samples.len() - 2).unwrap();
        Some(last.value - previous.value)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::service::promql::value::{Labels, RangeValue, TimeWindow};
    // Test helper
    fn idelta_test_helper(data: Value) -> Result<Value> {
        let eval_ctx = EvalContext::instant(3000);
        idelta_range(data, &eval_ctx)
    }

    #[test]
    fn test_idelta_function() {
        // Create a range value with sample data
        let samples = vec![
            crate::service::promql::value::Sample::new(1000, 10.0),
            crate::service::promql::value::Sample::new(2000, 15.0),
            crate::service::promql::value::Sample::new(3000, 25.0),
        ];

        let range_value = RangeValue {
            labels: Labels::default(),
            samples,
            exemplars: None,
            time_window: Some(TimeWindow {
                eval_ts: 3000,
                range: Duration::from_secs(2),
                offset: Duration::ZERO,
            }),
        };

        let matrix = Value::Matrix(vec![range_value]);
        let result = idelta_test_helper(matrix).unwrap();

        // Should return a vector with idelta value
        match result {
            Value::Vector(v) => {
                assert_eq!(v.len(), 1);
                // Idelta should be 25.0 - 15.0 = 10.0
                assert!((v[0].sample.value - 10.0).abs() < 0.001);
                assert_eq!(v[0].sample.timestamp, 3000);
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
