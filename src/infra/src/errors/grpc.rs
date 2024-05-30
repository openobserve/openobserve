// Copyright 2024 Zinc Labs Inc.
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

fn get_key_from_error(err: &str, pos: usize) -> Option<String> {
    for punctuation in ['\'', '"'] {
        let pos_start = err[pos..].find(punctuation);
        if pos_start.is_none() {
            continue;
        }
        let pos_start = pos_start.unwrap();
        let pos_end = err[pos + pos_start + 1..].find(punctuation);
        if pos_end.is_none() {
            continue;
        }
        let pos_end = pos_end.unwrap();
        return Some(err[pos + pos_start + 1..pos + pos_start + 1 + pos_end].to_string());
    }
    None
}

impl From<DataFusionError> for Error {
    fn from(err: DataFusionError) -> Self {
        if let DataFusionError::SchemaError(
            SchemaError::FieldNotFound {
                field,
                valid_fields: _,
            },
            _,
        ) = err
        {
            return Error::ErrorCode(ErrorCodes::SearchFieldNotFound(field.name));
        }

        let err = err.to_string();
        if err.contains("Schema error: No field named") {
            let pos = err.find("Schema error: No field named").unwrap();
            return match get_key_from_error(&err, pos) {
                Some(key) => Error::ErrorCode(ErrorCodes::SearchFieldNotFound(key)),
                None => Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(err)),
            };
        }
        if err.contains("parquet not found") {
            return Error::ErrorCode(ErrorCodes::SearchParquetFileNotFound);
        }
        if err.contains("Invalid function ") {
            let pos = err.find("Invalid function ").unwrap();
            return match get_key_from_error(&err, pos) {
                Some(key) => Error::ErrorCode(ErrorCodes::SearchFunctionNotDefined(key)),
                None => Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(err)),
            };
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
