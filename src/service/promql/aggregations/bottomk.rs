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
use promql_parser::parser::{Expr as PromExpr, LabelModifier};

use crate::service::promql::{Engine, value::Value};

pub async fn bottomk(
    ctx: &mut Engine,
    param: Box<PromExpr>,
    modifier: &Option<LabelModifier>,
    data: Value,
) -> Result<Value> {
    super::eval_top(ctx, param, data, modifier, true).await
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::Arc;

    use promql_parser::parser::{Expr as PromExpr, NumberLiteral};
    use tonic::async_trait;

    use super::*;
    use crate::service::promql::{
        exec::PromqlContext,
        value::{InstantValue, Label, Sample, Value},
    };

    #[tokio::test]
    async fn test_bottomk_function() {
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

        let labels3 = vec![
            Arc::new(Label::new("instance", "server3")),
            Arc::new(Label::new("job", "node_exporter")),
        ];

        let data = Value::Vector(vec![
            InstantValue {
                labels: labels1.clone(),
                sample: Sample::new(timestamp, 15.3), // Highest value
            },
            InstantValue {
                labels: labels1.clone(),
                sample: Sample::new(timestamp, 10.5), // Middle value
            },
            InstantValue {
                labels: labels2.clone(),
                sample: Sample::new(timestamp, 8.2), // Lowest value
            },
            InstantValue {
                labels: labels3.clone(),
                sample: Sample::new(timestamp, 12.1), // Second lowest
            },
        ]);

        // Create a mock Engine context
        let ctx = Arc::new(PromqlContext::new("test_org", MockTableProvider, false, 30));
        let mut engine = Engine::new("test_trace", ctx, timestamp);

        // Test bottomk(2) without label grouping - should return 2 lowest values
        let param = Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 }));
        let result = bottomk(&mut engine, param, &None, data.clone())
            .await
            .unwrap();

        match result {
            Value::Vector(values) => {
                assert_eq!(values.len(), 2);
                // Should return the 2 lowest values: 8.2 and 10.5
                let values_sorted: Vec<f64> = values.iter().map(|v| v.sample.value).collect();
                assert!(values_sorted.contains(&8.2));
                assert!(values_sorted.contains(&10.5));
                assert!(!values_sorted.contains(&15.3)); // Should not contain highest
                assert!(!values_sorted.contains(&12.1)); // Should not contain this one

                // All samples should have the same timestamp
                for value in &values {
                    assert_eq!(value.sample.timestamp, timestamp);
                }
            }
            _ => panic!("Expected Vector result"),
        }
    }

    #[tokio::test]
    async fn test_bottomk_empty_input() {
        let timestamp = 1640995200;

        // Create empty data
        let data = Value::Vector(vec![]);

        // Create a mock Engine context
        let ctx = Arc::new(PromqlContext::new("test_org", MockTableProvider, false, 30));
        let mut engine = Engine::new("test_trace", ctx, timestamp);

        // Test bottomk(2) with empty input
        let param = Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 }));
        let result = bottomk(&mut engine, param, &None, data).await.unwrap();

        match result {
            Value::Vector(values) => {
                assert_eq!(values.len(), 0); // Should return empty vector
            }
            _ => panic!("Expected Vector result"),
        }
    }

    // Mock TableProvider for testing
    pub struct MockTableProvider;

    #[async_trait]
    impl crate::service::promql::TableProvider for MockTableProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _machers: promql_parser::label::Matchers,
            _label_selector: Option<std::collections::HashSet<String>>,
            _filters: &mut [(String, Vec<String>)],
        ) -> datafusion::error::Result<
            Vec<(
                datafusion::prelude::SessionContext,
                std::sync::Arc<arrow::datatypes::Schema>,
                config::meta::search::ScanStats,
            )>,
        > {
            // Return empty result for testing
            Ok(vec![])
        }
    }
}
