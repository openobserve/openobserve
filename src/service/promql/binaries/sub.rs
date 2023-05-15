use datafusion::error::{DataFusionError, Result};

use crate::service::promql::value::Value;

pub fn sub(lhs: &Value, rhs: &Value) -> Result<Value> {
    if let (Value::Float(lhs), Value::Float(rhs)) = (lhs.clone(), rhs.clone()) {
        Ok(Value::Float(lhs - rhs))
    } else {
        Err(DataFusionError::NotImplemented(format!(
            "Unsupported Binary: {:?} - {:?}",
            lhs, rhs
        )))
    }
}
