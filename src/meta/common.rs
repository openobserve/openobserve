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

use serde::{Deserialize, Serialize};

use super::StreamType;
use crate::common::json;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileKey {
    pub key: String,
    pub meta: FileMeta,
    pub deleted: bool,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileDescriptor {
    pub meta: FileMeta,
    pub file_type: StreamType,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileMeta {
    pub min_ts: i64, // microseconds
    pub max_ts: i64, // microseconds
    pub records: u64,
    pub original_size: u64,
    pub compressed_size: u64,
}

impl From<&str> for FileMeta {
    fn from(data: &str) -> Self {
        json::from_str::<FileMeta>(data).unwrap()
    }
}

impl From<FileMeta> for Vec<u8> {
    fn from(value: FileMeta) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap()
    }
}

impl From<FileMeta> for String {
    fn from(data: FileMeta) -> Self {
        json::to_string(&data).unwrap()
    }
}

impl From<FileMeta> for bytes::Bytes {
    fn from(value: FileMeta) -> bytes::Bytes {
        serde_json::to_vec(&value).unwrap().into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_meta() {
        let file_meta = FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 1000,
            original_size: 10000,
            compressed_size: 150,
        };
        let file_meta_str = json::to_string(&file_meta).unwrap();
        assert_eq!(FileMeta::try_from(file_meta_str.as_str()), Ok(file_meta));
    }
}
