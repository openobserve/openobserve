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
use promql_parser::parser::Expr as PromExpr;
use rayon::prelude::*;

use crate::service::promql::{
    Engine, aggregations::prepare_vector, common::quantile as calculate_quantile, value::Value,
};

pub async fn quantile(
    ctx: &mut Engine,
    timestamp: i64,
    param: Box<PromExpr>,
    data: Value,
) -> Result<Value> {
    let param = ctx.exec_expr(&param).await?;
    let qtile = match param {
        Value::Float(v) => v,
        _ => {
            return Err(DataFusionError::Plan(
                "[quantile] param must be a NumberLiteral".to_string(),
            ));
        }
    };
    let data = match data {
        Value::Vector(v) => v,
        Value::None => return Ok(Value::None),
        _ => {
            return Err(DataFusionError::Plan(
                "[quantile] function only accept vector values".to_string(),
            ));
        }
    };

    if qtile < 0 as f64 || qtile > 1_f64 || qtile.is_nan() {
        let value = match qtile.signum() as i32 {
            1 => f64::INFINITY,
            -1 => f64::NEG_INFINITY,
            _ => f64::NAN,
        };
        return prepare_vector(timestamp, value);
    }

    if data.is_empty() {
        return prepare_vector(timestamp, f64::NAN);
    }

    let values: Vec<f64> = data.into_par_iter().map(|item| item.sample.value).collect();
    let quantile_value = calculate_quantile(&values, qtile).unwrap();
    prepare_vector(timestamp, quantile_value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quantile_calculation() {
        // Test the core quantile calculation logic
        let values = vec![10.0, 20.0, 30.0];
        let qtile = 0.5; // 50th percentile

        let quantile_value = calculate_quantile(&values, qtile).unwrap();
        assert_eq!(quantile_value, 20.0); // 50th percentile should be 20.0
    }

    #[test]
    fn test_quantile_edge_cases() {
        // Test edge cases for quantile calculation
        let values = vec![10.0, 20.0, 30.0];

        // 0th percentile (minimum)
        let min_value = calculate_quantile(&values, 0.0).unwrap();
        assert_eq!(min_value, 10.0);

        // 100th percentile (maximum)
        let max_value = calculate_quantile(&values, 1.0).unwrap();
        assert_eq!(max_value, 30.0);
    }
}
