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
    SearchFieldNotFound,
    SearchFunctionNotDefined,
    SearchParquetFileNotFound,
    SearchFieldHasNoCompatibleDataType,
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
            ErrorCodes::SearchFieldNotFound => 20004,
            ErrorCodes::SearchFunctionNotDefined => 20005,
            ErrorCodes::SearchParquetFileNotFound => 20006,
            ErrorCodes::SearchFieldHasNoCompatibleDataType => 20007,
        }
    }
    pub fn get_message(&self) -> String {
        match self {
            ErrorCodes::ServerInternalError(msg) => msg.to_owned(),
            ErrorCodes::SearchSQLNotValid(sql) => format!("Search SQL not valid, sql: [{}]", sql),
            ErrorCodes::SearchStreamNotFound(stream) => {
                format!("Search stream not found, stream: [{}]", stream)
            }
            ErrorCodes::FullTextSearchFieldNotFound => {
                "Full text search field not found".to_string()
            }
            ErrorCodes::SearchFieldNotFound => "Search field not found".to_string(),
            ErrorCodes::SearchFunctionNotDefined => "Search function not defined".to_string(),
            ErrorCodes::SearchParquetFileNotFound => "Search parquet file not found".to_string(),
            ErrorCodes::SearchFieldHasNoCompatibleDataType => {
                "Search field has no compatible data type".to_string()
            }
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
