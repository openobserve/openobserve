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

/// https://prometheus.io/docs/prometheus/latest/querying/functions/#aggregation_over_time
pub struct FirstOverTimeFunc;

impl RangeFunc for FirstOverTimeFunc {
    fn name(&self) -> &'static str {
        "first_over_time"
    }

    fn exec(&self, samples: &[Sample], _eval_ts: i64, _range: &Duration) -> Option<f64> {
        samples.first().map(|sample| sample.value)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::promql::value::{EvalContext, Label, RangeValue, TimeWindow, Value};

    use super::*;

    #[test]
    fn test_first_over_time_reads_the_oldest_sample_and_keeps_the_name() {
        let series = RangeValue {
            labels: vec![
                Arc::new(Label::new("__name__", "data")),
                Arc::new(Label::new("type", "some_nan")),
            ],
            samples: [(0, 1.0), (20, 2.0), (40, f64::NAN), (60, 3.0)]
                .map(|(t, v)| Sample::new(t * 1_000_000, v))
                .to_vec(),
            exemplars: None,
            time_window: Some(TimeWindow::new(Duration::from_secs(60))),
        };
        let eval_ctx = EvalContext::new(60_000_000, 60_000_000, 0, "test".into());
        let Value::Matrix(result) =
            crate::functions::eval_range(Value::Matrix(vec![series]), FirstOverTimeFunc, &eval_ctx)
                .unwrap()
        else {
            panic!("expected a matrix");
        };
        assert_eq!(result[0].labels.len(), 2);
        let values: Vec<_> = result[0]
            .samples
            .iter()
            .map(|s| (s.timestamp / 1_000_000, s.value))
            .collect();
        assert_eq!(values, vec![(60, 2.0)]);
        assert!(FirstOverTimeFunc.exec(&[], 0, &Duration::ZERO).is_none());
    }
}
