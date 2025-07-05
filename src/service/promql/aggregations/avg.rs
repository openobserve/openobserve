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

use crate::service::promql::value::{InstantValue, Sample, Value};

pub fn avg(timestamp: i64, param: &Option<LabelModifier>, data: Value) -> Result<Value> {
    let score_values = super::eval_arithmetic(param, data, "avg", |total, val| total + val)?;
    if score_values.is_none() {
        return Ok(Value::None);
    }
    let values = score_values
        .unwrap()
        .into_par_iter()
        .map(|(_, mut v)| InstantValue {
            labels: std::mem::take(&mut v.labels),
            sample: Sample::new(timestamp, v.value / v.num as f64),
        })
        .collect();
    Ok(Value::Vector(values))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::service::promql::value::{InstantValue, Label, Sample, Value};

    #[test]
    fn test_avg_function() {
        let timestamp = 1640995200; // 2022-01-01 00:00:00 UTC

        // Create test data with multiple samples
        let labels1 = vec![
            Arc::new(Label::new("instance", "server1")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let labels2 = vec![
            Arc::new(Label::new("instance", "server2")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

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

        // Test avg without label grouping - all samples should be averaged together
        let result = avg(timestamp, &None, data.clone()).unwrap();

        match result {
            Value::Vector(values) => {
                assert_eq!(values.len(), 1);
                // All samples are grouped together when no label modifier is provided
                assert_eq!(values[0].sample.value, 20.0); // (10 + 20 + 30) / 3
                assert_eq!(values[0].sample.timestamp, timestamp);
                // Should have empty labels since all samples are grouped together
                assert!(values[0].labels.is_empty());
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
