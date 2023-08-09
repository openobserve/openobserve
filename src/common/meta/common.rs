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

use aws_sdk_dynamodb::types::AttributeValue;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::common::infra::cache::file_list::parse_file_key_columns;
use crate::common::json;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileKey {
    pub key: String,
    pub meta: FileMeta,
    pub deleted: bool,
}

impl FileKey {
    pub fn from_file_name(file: &str) -> Self {
        Self {
            key: file.to_string(),
            meta: FileMeta::default(),
            deleted: false,
        }
    }
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
        json::to_vec(&value).unwrap()
    }
}

impl From<FileMeta> for String {
    fn from(data: FileMeta) -> Self {
        json::to_string(&data).unwrap()
    }
}

impl From<FileMeta> for bytes::Bytes {
    fn from(value: FileMeta) -> bytes::Bytes {
        json::to_vec(&value).unwrap().into()
    }
}

impl From<&FileKey> for HashMap<String, AttributeValue> {
    fn from(file_key: &FileKey) -> Self {
        let mut item = HashMap::new();
        let (stream_key, date_key, file_name) = parse_file_key_columns(&file_key.key).unwrap();
        item.insert("stream".to_string(), AttributeValue::S(stream_key));
        item.insert(
            "file".to_string(),
            AttributeValue::S(format!("{}/{}", date_key, file_name)),
        );
        item.insert(
            "deleted".to_string(),
            AttributeValue::Bool(file_key.deleted),
        );
        item.insert(
            "min_ts".to_string(),
            AttributeValue::N(file_key.meta.min_ts.to_string()),
        );
        item.insert(
            "max_ts".to_string(),
            AttributeValue::N(file_key.meta.max_ts.to_string()),
        );
        item.insert(
            "records".to_string(),
            AttributeValue::N(file_key.meta.records.to_string()),
        );
        item.insert(
            "original_size".to_string(),
            AttributeValue::N(file_key.meta.original_size.to_string()),
        );
        item.insert(
            "compressed_size".to_string(),
            AttributeValue::N(file_key.meta.compressed_size.to_string()),
        );
        item
    }
}

impl From<&HashMap<String, AttributeValue>> for FileKey {
    fn from(data: &HashMap<String, AttributeValue>) -> Self {
        let mut item = FileKey {
            key: format!(
                "files/{}/{}",
                data.get("stream").unwrap().as_s().unwrap(),
                data.get("file").unwrap().as_s().unwrap()
            ),
            ..Default::default()
        };
        for (k, v) in data {
            match k.as_str() {
                "deleted" => {
                    item.deleted = v.as_bool().unwrap().to_owned();
                }
                "min_ts" => {
                    item.meta.min_ts = v.as_n().unwrap().parse::<i64>().unwrap();
                }
                "max_ts" => {
                    item.meta.max_ts = v.as_n().unwrap().parse::<i64>().unwrap();
                }
                "records" => {
                    item.meta.records = v.as_n().unwrap().parse::<u64>().unwrap();
                }
                "original_size" => {
                    item.meta.original_size = v.as_n().unwrap().parse::<u64>().unwrap();
                }
                "compressed_size" => {
                    item.meta.compressed_size = v.as_n().unwrap().parse::<u64>().unwrap();
                }
                _ => {}
            }
        }
        item
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_key() {
        let file_key = FileKey::default();
        let file_key_str = json::to_string(&file_key).unwrap();
        let file_key2: FileKey = json::from_str(&file_key_str).unwrap();
        assert_eq!(format!("{:?}", file_key), format!("{:?}", file_key2));
    }

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

        let file_meta_str: Vec<u8> = file_meta.into();
        let file_meta_string: String = file_meta.into();
        let file_meta_bytes: bytes::Bytes = file_meta.into();
        assert_eq!(
            String::from_utf8(file_meta_str.clone()).unwrap(),
            file_meta_string
        );
        assert_eq!(file_meta_str, file_meta_bytes.to_vec());
    }
}
