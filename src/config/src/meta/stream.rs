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

use std::cmp::max;

use byteorder::{ByteOrder, LittleEndian};
use chrono::Duration;
use proto::cluster_rpc;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::usage::Stats;
use crate::{utils::json, CONFIG};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema, Hash)]
#[serde(rename_all = "lowercase")]
pub enum StreamType {
    #[default]
    Logs,
    Metrics,
    Traces,
    #[serde(rename = "enrichment_tables")]
    EnrichmentTables,
    #[serde(rename = "file_list")]
    Filelist,
    Metadata,
    Index,
}

impl From<&str> for StreamType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "logs" => StreamType::Logs,
            "metrics" => StreamType::Metrics,
            "traces" => StreamType::Traces,
            "enrichment_tables" => StreamType::EnrichmentTables,
            "file_list" => StreamType::Filelist,
            "metadata" => StreamType::Metadata,
            "index" => StreamType::Index,
            _ => StreamType::Logs,
        }
    }
}

impl std::fmt::Display for StreamType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            StreamType::Logs => write!(f, "logs"),
            StreamType::Metrics => write!(f, "metrics"),
            StreamType::Traces => write!(f, "traces"),
            StreamType::EnrichmentTables => write!(f, "enrichment_tables"),
            StreamType::Filelist => write!(f, "file_list"),
            StreamType::Metadata => write!(f, "metadata"),
            StreamType::Index => write!(f, "index"),
        }
    }
}

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

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileMeta {
    pub min_ts: i64, // microseconds
    pub max_ts: i64, // microseconds
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
}

impl From<&FileMeta> for Vec<u8> {
    fn from(value: &FileMeta) -> Vec<u8> {
        let mut bytes = [0; 40];
        LittleEndian::write_i64(&mut bytes[0..8], value.min_ts);
        LittleEndian::write_i64(&mut bytes[8..16], value.max_ts);
        LittleEndian::write_i64(&mut bytes[16..24], value.records);
        LittleEndian::write_i64(&mut bytes[24..32], value.original_size);
        LittleEndian::write_i64(&mut bytes[32..40], value.compressed_size);
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
        let records = LittleEndian::read_i64(&value[16..24]);
        let original_size = LittleEndian::read_i64(&value[24..32]);
        let compressed_size = LittleEndian::read_i64(&value[32..40]);
        Ok(Self {
            min_ts,
            max_ts,
            records,
            original_size,
            compressed_size,
        })
    }
}

impl From<&[parquet::file::metadata::KeyValue]> for FileMeta {
    fn from(values: &[parquet::file::metadata::KeyValue]) -> Self {
        let mut meta = FileMeta::default();
        for kv in values {
            match kv.key.as_str() {
                "min_ts" => meta.min_ts = kv.value.as_ref().unwrap().parse().unwrap(),
                "max_ts" => meta.max_ts = kv.value.as_ref().unwrap().parse().unwrap(),
                "records" => meta.records = kv.value.as_ref().unwrap().parse().unwrap(),
                "original_size" => meta.original_size = kv.value.as_ref().unwrap().parse().unwrap(),
                "compressed_size" => {
                    meta.compressed_size = kv.value.as_ref().unwrap().parse().unwrap()
                }
                _ => {}
            }
        }
        meta
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum QueryPartitionStrategy {
    FileNum,
    FileSize,
    FileHash,
}

impl From<&String> for QueryPartitionStrategy {
    fn from(s: &String) -> Self {
        match s.to_lowercase().as_str() {
            "file_num" => QueryPartitionStrategy::FileNum,
            "file_size" => QueryPartitionStrategy::FileSize,
            "file_hash" => QueryPartitionStrategy::FileHash,
            _ => QueryPartitionStrategy::FileNum,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StreamStats {
    pub created_at: i64,
    pub doc_time_min: i64,
    pub doc_time_max: i64,
    pub doc_num: i64,
    pub file_num: i64,
    pub storage_size: f64,
    pub compressed_size: f64,
}

impl StreamStats {
    /// Returns true iff [start, end] time range intersects with the stream's
    /// time range.
    pub fn time_range_intersects(&self, start: i64, end: i64) -> bool {
        assert!(start <= end);
        let (min, max) = self.time_range();
        // [min, max] does *not* intersect with [start, end] if either
        //
        // max < start
        // |--------------------|         |--------------------|
        // min                  max       start                end
        //
        // or min >= end
        // |--------------------|         |--------------------|
        // start                end       min                  max
        //
        // The time ranges intersect iff !(max < start || min >= end)
        max >= start && min < end
    }

    fn time_range(&self) -> (i64, i64) {
        assert!(self.doc_time_min <= self.doc_time_max);
        let file_push_interval = Duration::try_seconds(CONFIG.limit.file_push_interval as _)
            .unwrap()
            .num_microseconds()
            .unwrap();
        (self.doc_time_min, self.doc_time_max + file_push_interval)
    }

    pub fn add_file_meta(&mut self, meta: &FileMeta) {
        self.file_num += 1;
        self.doc_num = max(0, self.doc_num + meta.records);
        self.doc_time_min = self.doc_time_min.min(meta.min_ts);
        self.doc_time_max = self.doc_time_max.max(meta.max_ts);
        self.storage_size += meta.original_size as f64;
        self.compressed_size += meta.compressed_size as f64;
        if self.doc_time_min == 0 {
            self.doc_time_min = meta.min_ts;
        }
        if self.storage_size < 0.0 {
            self.storage_size = 0.0;
        }
        if self.compressed_size < 0.0 {
            self.compressed_size = 0.0;
        }
    }

    pub fn add_stream_stats(&mut self, stats: &StreamStats) {
        self.file_num = max(0, self.file_num + stats.file_num);
        self.doc_num = max(0, self.doc_num + stats.doc_num);
        self.doc_time_min = self.doc_time_min.min(stats.doc_time_min);
        self.doc_time_max = self.doc_time_max.max(stats.doc_time_max);
        self.storage_size += stats.storage_size;
        self.compressed_size += stats.compressed_size;
        if self.doc_time_min == 0 {
            self.doc_time_min = stats.doc_time_min;
        }
        if self.storage_size < 0.0 {
            self.storage_size = 0.0;
        }
        if self.compressed_size < 0.0 {
            self.compressed_size = 0.0;
        }
    }
}

impl From<&str> for StreamStats {
    fn from(data: &str) -> Self {
        json::from_str::<StreamStats>(data).unwrap()
    }
}

impl From<StreamStats> for Vec<u8> {
    fn from(value: StreamStats) -> Vec<u8> {
        json::to_vec(&value).unwrap()
    }
}

impl From<StreamStats> for String {
    fn from(data: StreamStats) -> Self {
        json::to_string(&data).unwrap()
    }
}

impl From<Stats> for StreamStats {
    fn from(meta: Stats) -> StreamStats {
        StreamStats {
            created_at: 0,
            doc_time_min: meta.min_ts,
            doc_time_max: meta.max_ts,
            doc_num: meta.records,
            file_num: 0,
            storage_size: meta.original_size,
            compressed_size: meta.compressed_size.unwrap_or_default(),
        }
    }
}

impl std::ops::Sub<FileMeta> for StreamStats {
    type Output = Self;

    fn sub(self, rhs: FileMeta) -> Self::Output {
        let mut ret = Self {
            created_at: self.created_at,
            file_num: self.file_num - 1,
            doc_num: self.doc_num - rhs.records,
            doc_time_min: self.doc_time_min.min(rhs.min_ts),
            doc_time_max: self.doc_time_max.max(rhs.max_ts),
            storage_size: self.storage_size - rhs.original_size as f64,
            compressed_size: self.compressed_size - rhs.compressed_size as f64,
        };
        if ret.doc_time_min == 0 {
            ret.doc_time_min = rhs.min_ts;
        }
        ret
    }
}

impl From<&FileMeta> for cluster_rpc::FileMeta {
    fn from(req: &FileMeta) -> Self {
        cluster_rpc::FileMeta {
            min_ts: req.min_ts,
            max_ts: req.max_ts,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&cluster_rpc::FileMeta> for FileMeta {
    fn from(req: &cluster_rpc::FileMeta) -> Self {
        FileMeta {
            min_ts: req.min_ts,
            max_ts: req.max_ts,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&FileKey> for cluster_rpc::FileKey {
    fn from(req: &FileKey) -> Self {
        cluster_rpc::FileKey {
            key: req.key.clone(),
            meta: Some(cluster_rpc::FileMeta::from(&req.meta)),
            deleted: req.deleted,
        }
    }
}

impl From<&cluster_rpc::FileKey> for FileKey {
    fn from(req: &cluster_rpc::FileKey) -> Self {
        FileKey {
            key: req.key.clone(),
            meta: FileMeta::from(req.meta.as_ref().unwrap()),
            deleted: req.deleted,
        }
    }
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PartitionTimeLevel {
    #[default]
    Unset,
    Hourly,
    Daily,
}

impl PartitionTimeLevel {
    pub fn duration(self) -> i64 {
        match self {
            PartitionTimeLevel::Unset => 0,
            PartitionTimeLevel::Hourly => 3600, // seconds, 1 hour
            PartitionTimeLevel::Daily => 86400, // seconds, 24 hour
        }
    }
}

impl From<&str> for PartitionTimeLevel {
    fn from(data: &str) -> Self {
        match data.to_lowercase().as_str() {
            "unset" => PartitionTimeLevel::Unset,
            "hourly" => PartitionTimeLevel::Hourly,
            "daily" => PartitionTimeLevel::Daily,
            _ => PartitionTimeLevel::Unset,
        }
    }
}

impl std::fmt::Display for PartitionTimeLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PartitionTimeLevel::Unset => write!(f, "unset"),
            PartitionTimeLevel::Hourly => write!(f, "hourly"),
            PartitionTimeLevel::Daily => write!(f, "daily"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_file_meta() {
        let file_meta = FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };

        let rpc_meta = cluster_rpc::FileMeta::from(&file_meta);
        let resp = FileMeta::from(&rpc_meta);
        assert_eq!(file_meta, resp);
    }
}
