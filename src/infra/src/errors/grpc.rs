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
