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

use std::sync::Arc;

use datafusion::{
    arrow::datatypes::DataType,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, Volatility},
    prelude::create_udf,
};
use once_cell::sync::Lazy;

/// The name of the match_all_hash UDF given to DataFusion.
pub const MATCH_ALL_HASH_UDF_NAME: &str = "match_all_hash";

/// Implementation of match_all_hash
pub(crate) static MATCH_ALL_HASH_UDF: Lazy<ScalarUDF> = Lazy::new(|| {
    create_udf(
        MATCH_ALL_HASH_UDF_NAME,
        // expects one string argument
        vec![DataType::Utf8],
        // returns boolean (like match_all)
        DataType::Boolean,
        Volatility::Immutable,
        Arc::new(match_all_hash_expr_impl),
    )
});

/// match_all_hash function for datafusion
/// This is a placeholder that returns an error because match_all_hash doesn't support
/// SQL with multiple streams. The actual matching is done by the query optimizer.
pub fn match_all_hash_expr_impl(
    _args: &[ColumnarValue],
) -> datafusion::error::Result<ColumnarValue> {
    Err(DataFusionError::Internal(
        "match_all_hash function don't support sql with multiple streams".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_match_all_hash_udf_name() {
        // Test that the UDF has the correct name
        assert_eq!(MATCH_ALL_HASH_UDF.name(), "match_all_hash");
    }

    #[test]
    fn test_match_all_hash_signature() {
        // Test that the UDF has the correct signature (accepts one string argument)
        let signature = MATCH_ALL_HASH_UDF.signature();
        // Just verify the signature exists
        assert_eq!(
            signature.volatility,
            datafusion::logical_expr::Volatility::Immutable
        );
    }

    #[test]
    fn test_match_all_hash_return_type() {
        // Test that the UDF returns a boolean
        let return_type = MATCH_ALL_HASH_UDF.return_type(&[DataType::Utf8]).unwrap();
        assert_eq!(return_type, DataType::Boolean);
    }
}
