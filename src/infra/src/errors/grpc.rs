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

use datafusion::{common::SchemaError, error::DataFusionError};

use super::{Error, ErrorCodes};

impl From<DataFusionError> for Error {
    fn from(err: DataFusionError) -> Self {
        if let DataFusionError::SchemaError(schema_err, _) = &err
            && let SchemaError::FieldNotFound {
                field,
                valid_fields: _,
            } = schema_err.as_ref()
        {
            return Error::ErrorCode(ErrorCodes::SearchFieldNotFound(field.name.clone()));
        }

        let err = err.to_string();
        if err.contains("Schema error: No field named") {
            return Error::ErrorCode(ErrorCodes::SearchFieldNotFound(err));
        }
        if err.contains("parquet not found") || err.contains("parquet file not found") {
            log::error!("[Datafusion] Parquet file not found: {err}");
            return Error::ErrorCode(ErrorCodes::SearchParquetFileNotFound);
        }
        if err.contains("Invalid function ") {
            return Error::ErrorCode(ErrorCodes::SearchFunctionNotDefined(err));
        }
        if err.contains("Incompatible data types") {
            let pos = err.find("for field").unwrap();
            let pos_start = err[pos..].find(' ').unwrap();
            let pos_end = err[pos + pos_start + 1..].find('.').unwrap();
            let field = err[pos + pos_start + 1..pos + pos_start + 1 + pos_end].to_string();
            return Error::ErrorCode(ErrorCodes::SearchFieldHasNoCompatibleDataType(field));
        }
        Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(err))
    }
}

#[cfg(test)]
mod tests {
    use datafusion::error::DataFusionError;

    use super::*;

    #[test]
    fn test_from_datafusion_schema_no_field_named() {
        let df_err =
            DataFusionError::Plan("Schema error: No field named `missing_col`".to_string());
        let err = Error::from(df_err);
        assert!(matches!(
            err,
            Error::ErrorCode(ErrorCodes::SearchFieldNotFound(_))
        ));
    }

    #[test]
    fn test_from_datafusion_parquet_not_found() {
        let df_err = DataFusionError::Plan("parquet not found on disk".to_string());
        let err = Error::from(df_err);
        assert!(matches!(
            err,
            Error::ErrorCode(ErrorCodes::SearchParquetFileNotFound)
        ));
    }

    #[test]
    fn test_from_datafusion_parquet_file_not_found() {
        let df_err = DataFusionError::Plan("parquet file not found".to_string());
        let err = Error::from(df_err);
        assert!(matches!(
            err,
            Error::ErrorCode(ErrorCodes::SearchParquetFileNotFound)
        ));
    }

    #[test]
    fn test_from_datafusion_invalid_function() {
        let df_err = DataFusionError::Plan("Invalid function my_udf".to_string());
        let err = Error::from(df_err);
        assert!(matches!(
            err,
            Error::ErrorCode(ErrorCodes::SearchFunctionNotDefined(_))
        ));
    }

    #[test]
    fn test_from_datafusion_generic_error_falls_through_to_sql_execute() {
        let df_err = DataFusionError::Plan("some unrecognized error".to_string());
        let err = Error::from(df_err);
        assert!(matches!(
            err,
            Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(_))
        ));
    }

    #[test]
    fn test_from_datafusion_incompatible_data_types_extracts_field_name() {
        let df_err = DataFusionError::Plan(
            "Incompatible data types for field myField. Expected Int64 but got Utf8".to_string(),
        );
        let err = Error::from(df_err);
        match err {
            Error::ErrorCode(ErrorCodes::SearchFieldHasNoCompatibleDataType(field)) => {
                // The parsing extracts the substring after the first space in "for field <name>."
                assert_eq!(field, "field myField");
            }
            _ => panic!("expected SearchFieldHasNoCompatibleDataType"),
        }
    }
}
