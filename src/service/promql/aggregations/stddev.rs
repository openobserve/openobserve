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
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use crate::service::promql::{
    common::std_deviation2,
    value::{InstantValue, Sample, Value},
};

pub fn stddev(timestamp: i64, param: &Option<LabelModifier>, data: Value) -> Result<Value> {
    let score_values = super::eval_std_dev_var(param, data, "stddev")?;
    if score_values.is_none() {
        return Ok(Value::None);
    }
    let values = score_values
        .unwrap()
        .into_par_iter()
        .map(|(_, mut v)| {
            let std_var = std_deviation2(&v.values, v.current_mean, v.current_count).unwrap();
            InstantValue {
                labels: std::mem::take(&mut v.labels),
                sample: Sample::new(timestamp, std_var),
            }
        })
        .collect();
    Ok(Value::Vector(values))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::promql::value::{InstantValue, Labels, Sample, Value, Label};
    use std::sync::Arc;

    #[test]
    fn test_stddev_function() {
        let timestamp = 1640995200; // 2022-01-01 00:00:00 UTC
        
        // Create test data with multiple samples
        let mut labels1 = Labels::default();
        labels1.push(Arc::new(Label::new("instance", "server1")));
        labels1.push(Arc::new(Label::new("job", "node_exporter")));
        
        let mut labels2 = Labels::default();
        labels2.push(Arc::new(Label::new("instance", "server2")));
        labels2.push(Arc::new(Label::new("job", "node_exporter")));
        
        let data = Value::Vector(vec![
            InstantValue {
                labels: labels1.clone(),
                sample: Sample::new(timestamp, 10.0),
            },
            InstantValue {
                labels: labels1.clone(),
                sample: Sample::new(timestamp, 20.0),
            },
            InstantValue {
                labels: labels2.clone(),
                sample: Sample::new(timestamp, 30.0),
            },
        ]);
        
        // Test stddev without label grouping - should return standard deviation
        let result = stddev(timestamp, &None, data.clone()).unwrap();
        
        match result {
            Value::Vector(values) => {
                assert_eq!(values.len(), 1);
                // All samples are grouped together when no label modifier is provided
                // Standard deviation of [10.0, 20.0, 30.0] should be approximately 8.165
                assert!((values[0].sample.value - 8.165).abs() < 0.01);
                assert_eq!(values[0].sample.timestamp, timestamp);
                // Should have empty labels since all samples are grouped together
                assert!(values[0].labels.is_empty());
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
