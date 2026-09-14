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
                    "Unsupported scalar comparison operation: {token:?} {lhs:?} {rhs:?}",
                )));
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
                    "Must filter this lhs value scalar operation: {token:?} {lhs:?} {rhs:?}",
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
                    "Unsupported scalar operation: {token:?} {lhs:?} {rhs:?}"
                )));
            }
        }
    };
    Ok(value)
}

#[cfg(test)]
mod tests {
    use promql_parser::parser::token;

    use super::*;

    #[test]
    fn test_add() {
        let r = scalar_binary_operations(token::T_ADD, 3.0, 2.0, false, false);
        assert_eq!(r.unwrap(), 5.0);
    }

    #[test]
    fn test_sub() {
        let r = scalar_binary_operations(token::T_SUB, 10.0, 4.0, false, false);
        assert_eq!(r.unwrap(), 6.0);
    }

    #[test]
    fn test_mul() {
        let r = scalar_binary_operations(token::T_MUL, 3.0, 4.0, false, false);
        assert_eq!(r.unwrap(), 12.0);
    }

    #[test]
    fn test_div() {
        let r = scalar_binary_operations(token::T_DIV, 10.0, 2.0, false, false);
        assert_eq!(r.unwrap(), 5.0);
    }

    #[test]
    fn test_pow() {
        let r = scalar_binary_operations(token::T_POW, 2.0, 8.0, false, false);
        assert_eq!(r.unwrap(), 256.0);
    }

    #[test]
    fn test_mod() {
        let r = scalar_binary_operations(token::T_MOD, 10.0, 3.0, false, false);
        assert_eq!(r.unwrap(), 1.0);
    }

    #[test]
    fn test_comparison_equal_return_bool_true() {
        let r = scalar_binary_operations(token::T_EQLC, 5.0, 5.0, true, true);
        assert_eq!(r.unwrap(), 1.0);
    }

    #[test]
    fn test_comparison_equal_return_bool_false() {
        let r = scalar_binary_operations(token::T_EQLC, 5.0, 6.0, true, true);
        assert_eq!(r.unwrap(), 0.0);
    }

    #[test]
    fn test_comparison_not_equal_return_bool() {
        let r = scalar_binary_operations(token::T_NEQ, 5.0, 6.0, true, true);
        assert_eq!(r.unwrap(), 1.0);
    }

    #[test]
    fn test_comparison_greater_than_satisfied_returns_lhs() {
        let r = scalar_binary_operations(token::T_GTR, 10.0, 5.0, false, true);
        assert_eq!(r.unwrap(), 10.0);
    }

    #[test]
    fn test_comparison_greater_than_not_satisfied_returns_err() {
        let r = scalar_binary_operations(token::T_GTR, 3.0, 5.0, false, true);
        assert!(r.is_err());
    }

    #[test]
    fn test_comparison_less_than_return_bool() {
        let r = scalar_binary_operations(token::T_LSS, 3.0, 5.0, true, true);
        assert_eq!(r.unwrap(), 1.0);
    }

    #[test]
    fn test_comparison_gte_return_bool() {
        let r = scalar_binary_operations(token::T_GTE, 5.0, 5.0, true, true);
        assert_eq!(r.unwrap(), 1.0);
    }

    #[test]
    fn test_comparison_lte_return_bool() {
        let r = scalar_binary_operations(token::T_LTE, 4.0, 5.0, true, true);
        assert_eq!(r.unwrap(), 1.0);
    }

    #[test]
    fn test_unknown_arithmetic_token_returns_err() {
        let r = scalar_binary_operations(0u8, 1.0, 2.0, false, false);
        assert!(r.is_err());
    }

    #[test]
    fn test_unknown_comparison_token_returns_err() {
        let r = scalar_binary_operations(0u8, 1.0, 2.0, false, true);
        assert!(r.is_err());
    }
}
