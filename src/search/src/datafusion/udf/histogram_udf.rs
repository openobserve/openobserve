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

use std::sync::LazyLock as Lazy;

use arrow::datatypes::{DataType, DataType::Timestamp, TimeUnit::Microsecond};
use datafusion::{
    common::Result,
    error::DataFusionError,
    logical_expr::{ColumnarValue, ScalarUDF, ScalarUDFImpl, Signature, Volatility},
};

pub const HISTOGRAM_UDF_NAME: &str = "histogram";

pub static HISTOGRAM_UDF: Lazy<ScalarUDF> = Lazy::new(|| ScalarUDF::from(HistogramUdf::new()));

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct HistogramUdf {
    signature: Signature,
}

impl HistogramUdf {
    fn new() -> Self {
        Self {
            signature: Signature::variadic_any(Volatility::Immutable),
        }
    }
}

impl ScalarUDFImpl for HistogramUdf {
    fn name(&self) -> &str {
        HISTOGRAM_UDF_NAME
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(Timestamp(Microsecond, None))
    }

    fn invoke_with_args(
        &self,
        _args: datafusion::logical_expr::ScalarFunctionArgs,
    ) -> Result<ColumnarValue> {
        Err(DataFusionError::Internal(
            "histogram function don't support sql with multiple streams".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::datatypes::{DataType, Field, TimeUnit};
    use datafusion::{
        common::config::ConfigOptions, logical_expr::ScalarUDFImpl as _,
        physical_plan::ColumnarValue,
    };

    use super::*;

    #[test]
    fn test_histogram_udf_name() {
        let udf = HistogramUdf::new();
        assert_eq!(udf.name(), HISTOGRAM_UDF_NAME);
        assert_eq!(HISTOGRAM_UDF_NAME, "histogram");
    }

    #[test]
    fn test_histogram_udf_return_type_is_timestamp_microsecond() {
        let udf = HistogramUdf::new();
        let ret = udf.return_type(&[]).unwrap();
        assert_eq!(ret, DataType::Timestamp(TimeUnit::Microsecond, None));
    }

    #[test]
    fn test_histogram_udf_return_type_ignores_args() {
        let udf = HistogramUdf::new();
        let ret1 = udf.return_type(&[]).unwrap();
        let ret2 = udf.return_type(&[DataType::Int64, DataType::Utf8]).unwrap();
        assert_eq!(ret1, ret2);
    }

    #[test]
    fn test_histogram_udf_name_constant() {
        assert_eq!(HISTOGRAM_UDF_NAME, "histogram");
    }

    #[test]
    fn test_invoke_with_args_errors_instead_of_panicking() {
        let udf = HistogramUdf::new();
        let args = datafusion::logical_expr::ScalarFunctionArgs {
            args: vec![ColumnarValue::Scalar(
                datafusion::scalar::ScalarValue::Int64(Some(1)),
            )],
            arg_fields: vec![Arc::new(Field::new("f", DataType::Int64, true))],
            number_rows: 1,
            return_field: Arc::new(Field::new(
                "histogram",
                DataType::Timestamp(TimeUnit::Microsecond, None),
                true,
            )),
            config_options: Arc::new(ConfigOptions::default()),
        };
        assert!(udf.invoke_with_args(args).is_err());
    }
}
