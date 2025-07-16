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

use crate::service::promql::{aggregations::score_to_instant_value, value::Value};

pub fn sum(timestamp: i64, param: &Option<LabelModifier>, data: Value) -> Result<Value> {
    let score_values = super::eval_arithmetic(param, data, "sum", |total, val| total + val)?;
    if score_values.is_none() {
        return Ok(Value::None);
    }
    Ok(Value::Vector(score_to_instant_value(
        timestamp,
        score_values,
    )))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::service::promql::value::{InstantValue, Label, Sample, Value};

    #[test]
    fn test_sum_function() {
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
                sample: Sample::new(timestamp, 10.5),
            },
            InstantValue {
                labels: labels1.clone(),
                sample: Sample::new(timestamp, 15.3),
            },
            InstantValue {
                labels: labels2.clone(),
                sample: Sample::new(timestamp, 8.2),
            },
        ]);

        // Test sum without label grouping - all samples should be summed together
        let result = sum(timestamp, &None, data.clone()).unwrap();

        match result {
            Value::Vector(values) => {
                assert_eq!(values.len(), 1);
                // All samples are grouped together when no label modifier is provided
                assert_eq!(values[0].sample.value, 34.0); // 10.5 + 15.3 + 8.2
                assert_eq!(values[0].sample.timestamp, timestamp);
                // Should have empty labels since all samples are grouped together
                assert!(values[0].labels.is_empty());
            }
            _ => panic!("Expected Vector result"),
        }
    }
}
