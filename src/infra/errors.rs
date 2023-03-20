// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use thiserror::Error as ThisError;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(ThisError, Debug)]
pub enum Error {
    #[error("DbError# {0}")]
    DbError(#[from] DbError),
    #[error("EtcdError# {0}")]
    EtcdError(#[from] etcd_client::Error),
    #[error("SledError# {0}")]
    SledError(#[from] sled::Error),
    #[error("SerdeJsonError# {0}")]
    SerdeJsonError(#[from] serde_json::Error),
    #[error("SimdJsonError# {0}")]
    SimdJsonError(#[from] simd_json::Error),
    #[error("DataFusionError# {0}")]
    DataFusionError(#[from] datafusion::error::DataFusionError),
    #[error("WatchError# watcher is exists {0}")]
    WatcherExists(String),
    #[error("Error# {0}")]
    Message(String),
    #[error("ErrorCode# {0}")]
    ErrorCode(ErrorCodes),
    #[error("Not implemented")]
    NotImplemented,
    #[error("Unknown error")]
    Unknown,
}

#[derive(ThisError, Debug)]
pub enum DbError {
    #[error("key:{0} not exists")]
    KeyNotExists(String),
}

#[derive(ThisError, Debug)]
pub enum ErrorCodes {
    ServerInternalError(String),
    SearchSQLNotValid(String),
    SearchStreamNotFound(String),
    FullTextSearchFieldNotFound,
    SearchFieldNotFound(String),
    SearchFunctionNotDefined(String),
    SearchParquetFileNotFound,
    SearchFieldHasNoCompatibleDataType(String),
}

impl std::fmt::Display for ErrorCodes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            r#"{{"error_code": {}, "error_msg": "{}"}}"#,
            self.get_code(),
            self.get_message()
        )
    }
}

impl ErrorCodes {
    pub fn get_code(&self) -> u16 {
        match self {
            ErrorCodes::ServerInternalError(_) => 10001,
            ErrorCodes::SearchSQLNotValid(_) => 20001,
            ErrorCodes::SearchStreamNotFound(_) => 20002,
            ErrorCodes::FullTextSearchFieldNotFound => 20003,
            ErrorCodes::SearchFieldNotFound(_) => 20004,
            ErrorCodes::SearchFunctionNotDefined(_) => 20005,
            ErrorCodes::SearchParquetFileNotFound => 20006,
            ErrorCodes::SearchFieldHasNoCompatibleDataType(_) => 20007,
        }
    }

    pub fn get_message(&self) -> String {
        match self {
            ErrorCodes::ServerInternalError(msg) => msg.to_owned(),
            ErrorCodes::SearchSQLNotValid(sql) => format!("Search SQL not valid: {}", sql),
            ErrorCodes::SearchStreamNotFound(stream) => {
                format!("Search stream not found: {}", stream)
            }
            ErrorCodes::FullTextSearchFieldNotFound => {
                "Full text search field not found".to_string()
            }
            ErrorCodes::SearchFieldNotFound(field) => format!("Search field not found: {}", field),
            ErrorCodes::SearchFunctionNotDefined(func) => {
                format!("Search function not defined: {}", func)
            }
            ErrorCodes::SearchParquetFileNotFound => "Search parquet file not found".to_string(),
            ErrorCodes::SearchFieldHasNoCompatibleDataType(field) => {
                format!("Search field has no compatible data type: {}", field)
            }
        }
    }

    pub fn get_inner_message(&self) -> String {
        match self {
            ErrorCodes::ServerInternalError(msg) => msg.to_owned(),
            ErrorCodes::SearchSQLNotValid(sql) => sql.to_owned(),
            ErrorCodes::SearchStreamNotFound(stream) => stream.to_owned(),
            ErrorCodes::FullTextSearchFieldNotFound => "".to_string(),
            ErrorCodes::SearchFieldNotFound(field) => field.to_owned(),
            ErrorCodes::SearchFunctionNotDefined(func) => func.to_owned(),
            ErrorCodes::SearchParquetFileNotFound => "".to_string(),
            ErrorCodes::SearchFieldHasNoCompatibleDataType(field) => field.to_owned(),
        }
    }

    pub fn to_json(&self) -> String {
        format!(
            r#"{{"code": {}, "message": "{}", "inner": "{}"}}"#,
            self.get_code(),
            self.get_message(),
            self.get_inner_message()
        )
    }

    pub fn from_json(json: &str) -> Result<ErrorCodes> {
        let val: serde_json::Value = match serde_json::from_str(json) {
            Ok(val) => val,
            Err(_) => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        let map = match val.as_object() {
            Some(map) => map,
            None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        let code = match map.get("code") {
            Some(code) => match code.as_i64() {
                Some(code) => code as u16,
                None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
            },
            None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        let message = match map.get("inner") {
            Some(message) => match message {
                serde_json::Value::String(message) => message.to_owned(),
                _ => message.to_string(),
            },
            None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        match code {
            10001 => Ok(ErrorCodes::ServerInternalError(message)),
            20001 => Ok(ErrorCodes::SearchSQLNotValid(message)),
            20002 => Ok(ErrorCodes::SearchStreamNotFound(message)),
            20003 => Ok(ErrorCodes::FullTextSearchFieldNotFound),
            20004 => Ok(ErrorCodes::SearchFieldNotFound(message)),
            20005 => Ok(ErrorCodes::SearchFunctionNotDefined(message)),
            20006 => Ok(ErrorCodes::SearchParquetFileNotFound),
            20007 => Ok(ErrorCodes::SearchFieldHasNoCompatibleDataType(message)),
            _ => Ok(ErrorCodes::ServerInternalError(json.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error() {
        let err = Error::Message("test".to_string());
        assert_eq!(err.to_string(), "Error# test");

        let err = Error::from(DbError::KeyNotExists("test".to_string()));
        assert_eq!(err.to_string(), "DbError# key:test not exists");
        assert_eq!(format!("{:?}", err), "DbError(KeyNotExists(\"test\"))");
    }
}
