// Copyright 2023 Zinc Labs Inc.
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
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::common::infra::file_list::parse_file_key_columns;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileKey {
    pub key: String,
    pub meta: FileMeta,
    pub deleted: bool,
}

impl FileKey {
    pub fn new(key: &str, meta: FileMeta, deleted: bool) -> Self {
        Self {
            key: key.to_string(),
            meta,
            deleted,
        }
    }

    pub fn from_file_name(file: &str) -> Self {
        Self {
            key: file.to_string(),
            meta: FileMeta::default(),
            deleted: false,
        }
    }
}

impl From<&FileKey> for HashMap<String, AttributeValue> {
    fn from(file_key: &FileKey) -> Self {
        let mut item = HashMap::new();
        let (stream_key, date_key, file_name) = parse_file_key_columns(&file_key.key).unwrap();
        let file_name = format!("{date_key}/{file_name}");
        item.insert("stream".to_string(), AttributeValue::S(stream_key));
        item.insert("file".to_string(), AttributeValue::S(file_name));
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

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileMeta {
    pub min_ts: i64, // microseconds
    pub max_ts: i64, // microseconds
    pub records: u64,
    pub original_size: u64,
    pub compressed_size: u64,
}

impl From<&FileMeta> for Vec<u8> {
    fn from(value: &FileMeta) -> Vec<u8> {
        let mut bytes = [0; 40];
        LittleEndian::write_i64(&mut bytes[0..8], value.min_ts);
        LittleEndian::write_i64(&mut bytes[8..16], value.max_ts);
        LittleEndian::write_u64(&mut bytes[16..24], value.records);
        LittleEndian::write_u64(&mut bytes[24..32], value.original_size);
        LittleEndian::write_u64(&mut bytes[32..40], value.compressed_size);
        bytes.to_vec()
    }
}

impl TryFrom<&[u8]> for FileMeta {
    type Error = std::io::Error;

    fn try_from(value: &[u8]) -> Result<Self, Self::Error> {
        if value.len() < 40 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Invalid FileMeta",
            ));
        }
        let min_ts = LittleEndian::read_i64(&value[0..8]);
        let max_ts = LittleEndian::read_i64(&value[8..16]);
        let records = LittleEndian::read_u64(&value[16..24]);
        let original_size = LittleEndian::read_u64(&value[24..32]);
        let compressed_size = LittleEndian::read_u64(&value[32..40]);
        Ok(Self {
            min_ts,
            max_ts,
            records,
            original_size,
            compressed_size,
        })
    }
}
