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
    #[error("Error# watcher is exists {0}")]
    WatcherExists(String),
    #[error("Error# {0}")]
    Message(String),
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
