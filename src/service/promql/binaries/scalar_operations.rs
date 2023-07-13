use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::token;

/// Supported operation between two float type values.
pub fn scalar_binary_operations(
    token: u8,
    lhs: f64,
    rhs: f64,
    return_bool: bool,
    comparison_operator: bool,
) -> Result<f64> {
    let value = if comparison_operator {
        let val = match token {
            token::T_EQLC => lhs == rhs,
            token::T_NEQ => lhs != rhs,
            token::T_GTR => lhs > rhs,
            token::T_LSS => lhs < rhs,
            token::T_GTE => lhs >= rhs,
            token::T_LTE => lhs <= rhs,
            _ => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported scalar comparison operation: {:?} {:?} {:?}",
                    token, lhs, rhs
                )))
            }
        };
        if return_bool {
            val as u32 as f64
        } else {
            // if the return value was true, that means our element
            // satisfies the comparison, hence return it
            if val {
                lhs
            } else {
                return Err(DataFusionError::NotImplemented(format!(
                    "Must filter this lhs value scalar operation: {:?} {:?} {:?}",
                    token, lhs, rhs
                )));
            }
        }
    } else {
        match token {
            token::T_ADD => lhs + rhs,
            token::T_SUB => lhs - rhs,
            token::T_MUL => lhs * rhs,
            token::T_DIV => lhs / rhs,
            token::T_POW => lhs.powf(rhs),
            token::T_MOD => lhs % rhs,
            token::T_ATAN2 => lhs.atan2(rhs),
            _ => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported scalar operation: {:?} {:?} {:?}",
                    token, lhs, rhs
                )))
            }
        }
    };
    Ok(value)
}
