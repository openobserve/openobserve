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

use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::{Expr as PromExpr, LabelModifier};

use crate::service::promql::{
    Engine,
    value::{InstantValue, Label, Sample, Value},
};

pub async fn count_values(
    ctx: &mut Engine,
    timestamp: i64,
    param: Box<PromExpr>,
    modifier: &Option<LabelModifier>,
    data: Value,
) -> Result<Value> {
    let param = ctx.exec_expr(&param).await?;
    let label_name = match param {
        Value::String(v) => v,
        _ => {
            return Err(DataFusionError::Plan(
                "[label_name] param must be a String".to_string(),
            ));
        }
    };
    if !Label::is_valid_label_name(&label_name) {
        return Err(DataFusionError::Plan(
            "[label_name] param invalid. Check https://prometheus.io/docs/concepts/data_model/#metric-names-and-labels".to_string(),
        ));
    }
    let score_values = super::eval_count_values(modifier, data, "count_values", &label_name)?;
    if score_values.is_none() {
        return Ok(Value::None);
    }

    let values = score_values
        .unwrap()
        .values()
        .map(|it| InstantValue {
            labels: it.labels.clone(),
            sample: Sample::new(timestamp, it.count as f64),
        })
        .collect();

    Ok(Value::Vector(values))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use promql_parser::parser::{Expr as PromExpr, StringLiteral};

    use super::*;
    use crate::service::promql::{
        aggregations::bottomk::tests::MockTableProvider,
        value::{InstantValue, Labels, Sample, Value},
    };

    // Helper function to create a mock Engine for testing
    async fn create_mock_engine() -> Engine {
        use crate::service::promql::exec::PromqlContext;

        let ctx = PromqlContext::new("test_org", MockTableProvider, false, 30);
        Engine::new("test_trace", Arc::new(ctx), 1640995200)
    }

    #[tokio::test]
    async fn test_count_values_invalid_label_name() {
        let timestamp = 1640995200;
        let mut engine = create_mock_engine().await;

        let data = Value::Vector(vec![InstantValue {
            labels: Labels::default(),
            sample: Sample::new(timestamp, 10.5),
        }]);

        // Create parameter expression with invalid label name
        let param = Box::new(PromExpr::StringLiteral(StringLiteral {
            val: "invalid-label-name!".to_string(),
        }));

        // Test count_values with invalid label name
        let result = count_values(&mut engine, timestamp, param, &None, data).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("invalid"));
    }

    #[tokio::test]
    async fn test_count_values_invalid_param_type() {
        let timestamp = 1640995200;
        let mut engine = create_mock_engine().await;

        let data = Value::Vector(vec![InstantValue {
            labels: Labels::default(),
            sample: Sample::new(timestamp, 10.5),
        }]);

        // Create parameter expression with wrong type (number instead of string)
        let param = Box::new(PromExpr::NumberLiteral(
            promql_parser::parser::NumberLiteral { val: 42.0 },
        ));

        // Test count_values with invalid parameter type
        let result = count_values(&mut engine, timestamp, param, &None, data).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must be a String"));
    }
}
