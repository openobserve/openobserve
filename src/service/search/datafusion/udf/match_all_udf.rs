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

use std::{any::Any, sync::LazyLock as Lazy};

use arrow::datatypes::DataType;
use datafusion::{
    common::{DataFusionError, Result},
    logical_expr::{ColumnarValue, ScalarUDF, ScalarUDFImpl, Signature, Volatility},
};

pub const MATCH_ALL_UDF_NAME: &str = "match_all";
pub const FUZZY_MATCH_ALL_UDF_NAME: &str = "fuzzy_match_all";

pub(crate) static MATCH_ALL_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(MatchAllUdf::new()));

pub(crate) static FUZZY_MATCH_ALL_UDF: Lazy<ScalarUDF> =
    Lazy::new(|| ScalarUDF::from(FuzzyMatchAllUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct MatchAllUdf {
    signature: Signature,
}

impl MatchAllUdf {
    fn new() -> Self {
        Self {
            signature: Signature::exact(vec![DataType::Utf8], Volatility::Immutable),
        }
    }
}

impl ScalarUDFImpl for MatchAllUdf {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn name(&self) -> &str {
        MATCH_ALL_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(
        &self,
        _args: datafusion::logical_expr::ScalarFunctionArgs,
    ) -> Result<ColumnarValue> {
        Err(DataFusionError::Internal(
            "match_all function don't support sql with multiple streams".to_string(),
        ))
    }
}

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct FuzzyMatchAllUdf {
    signature: Signature,
}

impl FuzzyMatchAllUdf {
    fn new() -> Self {
        Self {
            signature: Signature::exact(
                vec![DataType::Utf8, DataType::Int64],
                Volatility::Immutable,
            ),
        }
    }
}

impl ScalarUDFImpl for FuzzyMatchAllUdf {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn name(&self) -> &str {
        FUZZY_MATCH_ALL_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Boolean)
    }

    fn invoke_with_args(
        &self,
        _args: datafusion::logical_expr::ScalarFunctionArgs,
    ) -> Result<ColumnarValue> {
        Err(DataFusionError::Internal(
            "fuzzy_match_all function don't support sql with multiple streams".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use datafusion::logical_expr::ScalarUDFImpl as _;

    use super::*;

    #[test]
    fn test_match_all_udf_name() {
        let udf = MatchAllUdf::new();
        assert_eq!(udf.name(), MATCH_ALL_UDF_NAME);
        assert_eq!(MATCH_ALL_UDF_NAME, "match_all");
    }

    #[test]
    fn test_match_all_udf_return_type_is_boolean() {
        let udf = MatchAllUdf::new();
        assert_eq!(udf.return_type(&[]).unwrap(), DataType::Boolean);
    }

    #[test]
    fn test_match_all_static_udf_name() {
        assert_eq!(MATCH_ALL_UDF.name(), MATCH_ALL_UDF_NAME);
    }

    #[test]
    fn test_fuzzy_match_all_udf_name() {
        let udf = FuzzyMatchAllUdf::new();
        assert_eq!(udf.name(), FUZZY_MATCH_ALL_UDF_NAME);
        assert_eq!(FUZZY_MATCH_ALL_UDF_NAME, "fuzzy_match_all");
    }

    #[test]
    fn test_fuzzy_match_all_udf_return_type_is_boolean() {
        let udf = FuzzyMatchAllUdf::new();
        assert_eq!(udf.return_type(&[]).unwrap(), DataType::Boolean);
    }

    #[test]
    fn test_fuzzy_match_all_static_udf_name() {
        assert_eq!(FUZZY_MATCH_ALL_UDF.name(), FUZZY_MATCH_ALL_UDF_NAME);
    }
}
