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

/// Carries an `ErrorCodes` through DataFusion so the HTTP status survives the round trip.
#[derive(Debug)]
struct DataFusionErrorCode(ErrorCodes);

impl std::fmt::Display for DataFusionErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for DataFusionErrorCode {}

impl From<ErrorCodes> for DataFusionError {
    fn from(code: ErrorCodes) -> Self {
        Self::External(Box::new(DataFusionErrorCode(code)))
    }
}

impl Error {
    /// A 503 crosses a gRPC hop as `Unavailable` carrying its error code JSON, so the peer
    /// answers 503 too; None for every other error.
    pub fn to_unavailable_status(&self) -> Option<tonic::Status> {
        let code = match self {
            Error::ResourceError(reason) => ErrorCodes::ServiceUnavailable(reason.clone()),
            Error::ErrorCode(code @ ErrorCodes::ServiceUnavailable(_)) => code.clone(),
            _ => return None,
        };
        Some(tonic::Status::unavailable(code.to_json()))
    }
}

impl ErrorCodes {
    /// Decodes the status of [`Error::to_unavailable_status`] sent by a peer node.
    pub fn from_unavailable_status(status: &tonic::Status) -> Option<Self> {
        if status.code() != tonic::Code::Unavailable {
            return None;
        }
        match ErrorCodes::from_json(status.message()) {
            Ok(code @ ErrorCodes::ServiceUnavailable(_)) => Some(code),
            _ => None,
        }
    }
}

impl From<DataFusionError> for Error {
    fn from(err: DataFusionError) -> Self {
        // Operators such as RepartitionExec wrap a child's error in Shared or Context.
        if let DataFusionError::External(external) = err.find_root()
            && let Some(code) = external.downcast_ref::<DataFusionErrorCode>()
        {
            return Error::ErrorCode(code.0.clone());
        }
        if let DataFusionError::SchemaError(schema_err, _) = &err
            && let SchemaError::FieldNotFound {
                field,
                valid_fields,
            } = schema_err.as_ref()
        {
            // Keep the same textual shape DataFusion's Display uses so the
            // HTTP layer can parse candidates out of either origin and offer
            // did-you-mean suggestions.
            let valid = valid_fields
                .iter()
                .map(|f| f.flat_name())
                .collect::<Vec<_>>()
                .join(", ");
            return Error::ErrorCode(ErrorCodes::SearchFieldNotFound(if valid.is_empty() {
                format!("No field named {}.", field.name)
            } else {
                format!("No field named {}. Valid fields are {}.", field.name, valid)
            }));
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
    fn test_from_datafusion_error_code_round_trips() {
        let df_err: DataFusionError = ErrorCodes::SearchCancelQuery("canceled".to_string()).into();
        assert!(matches!(
            Error::from(df_err),
            Error::ErrorCode(ErrorCodes::SearchCancelQuery(message)) if message == "canceled"
        ));
    }

    #[test]
    fn test_from_datafusion_error_code_survives_wrapping() {
        let code: DataFusionError = ErrorCodes::ServiceUnavailable("full".to_string()).into();
        let wrapped = DataFusionError::Shared(std::sync::Arc::new(code)).context("repartition");
        assert!(matches!(
            Error::from(wrapped),
            Error::ErrorCode(ErrorCodes::ServiceUnavailable(reason)) if reason == "full"
        ));
    }

    #[test]
    fn test_a_503_crosses_grpc_as_unavailable() {
        let status = Error::ResourceError("memory is full".to_string())
            .to_unavailable_status()
            .unwrap();
        assert_eq!(status.code(), tonic::Code::Unavailable);
        assert!(matches!(
            ErrorCodes::from_json(status.message()).unwrap(),
            ErrorCodes::ServiceUnavailable(reason) if reason == "memory is full"
        ));
        assert!(matches!(
            ErrorCodes::from_unavailable_status(&status),
            Some(ErrorCodes::ServiceUnavailable(reason)) if reason == "memory is full"
        ));
        let relayed = Error::ErrorCode(ErrorCodes::ServiceUnavailable("full".to_string()));
        assert_eq!(
            relayed.to_unavailable_status().unwrap().message(),
            ErrorCodes::ServiceUnavailable("full".to_string()).to_json()
        );
    }

    #[test]
    fn test_other_errors_keep_their_grpc_status() {
        for err in [
            Error::ErrorCode(ErrorCodes::SearchTimeout("slow".to_string())),
            Error::Message("boom".to_string()),
        ] {
            assert!(err.to_unavailable_status().is_none(), "{err}");
        }
        for status in [
            tonic::Status::unavailable("tcp connect error"),
            tonic::Status::internal(ErrorCodes::ServiceUnavailable("x".to_string()).to_json()),
        ] {
            assert!(
                ErrorCodes::from_unavailable_status(&status).is_none(),
                "{status}"
            );
        }
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
