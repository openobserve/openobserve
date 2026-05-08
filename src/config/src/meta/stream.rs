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

use std::{cmp::max, fmt::Display, str::FromStr, sync::Arc};

use chrono::{DateTime, Duration, TimeZone, Utc};
use hashbrown::HashMap;
use proto::cluster_rpc;
use serde::{Deserialize, Serialize, Serializer, ser::SerializeStruct};
use utoipa::ToSchema;

use super::bitvec::BitVec;
use crate::{
    get_config,
    meta::self_reporting::usage::Stats,
    stats::MemorySize,
    utils::{
        hash::{Sum64, gxhash},
        json::{self, Value},
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "PascalCase")]
pub enum DataType {
    #[default]
    Utf8,
    LargeUtf8,
    Int64,
    Uint64,
    Float64,
    Boolean,
}

impl From<DataType> for arrow_schema::DataType {
    fn from(data_type: DataType) -> Self {
        match data_type {
            DataType::Utf8 => Self::Utf8,
            DataType::LargeUtf8 => Self::LargeUtf8,
            DataType::Int64 => Self::Int64,
            DataType::Uint64 => Self::UInt64,
            DataType::Float64 => Self::Float64,
            DataType::Boolean => Self::Boolean,
        }
    }
}

impl Display for DataType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DataType::Utf8 => write!(f, "Utf8"),
            DataType::LargeUtf8 => write!(f, "LargeUtf8"),
            DataType::Int64 => write!(f, "Int64"),
            DataType::Uint64 => write!(f, "Uint64"),
            DataType::Float64 => write!(f, "Float64"),
            DataType::Boolean => write!(f, "Boolean"),
        }
    }
}

impl FromStr for DataType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "utf8" => Ok(DataType::Utf8),
            "largeutf8" => Ok(DataType::LargeUtf8),
            "int64" => Ok(DataType::Int64),
            "uint64" => Ok(DataType::Uint64),
            "float64" => Ok(DataType::Float64),
            "boolean" => Ok(DataType::Boolean),
            _ => Err(format!("Unknown data type: {s}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
pub struct DataField {
    pub name: String,
    pub r#type: DataType,
}

impl DataField {
    pub fn new(name: &str, r#type: DataType) -> Self {
        Self {
            name: name.to_string(),
            r#type,
        }
    }
}

impl PartialEq for DataField {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.r#type == other.r#type
    }
}

pub const ALL_STREAM_TYPES: [StreamType; 8] = [
    StreamType::Logs,
    StreamType::Metrics,
    StreamType::Traces,
    StreamType::ServiceGraph,
    StreamType::EnrichmentTables,
    StreamType::Filelist,
    StreamType::Metadata,
    StreamType::Index,
];

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema, Hash)]
#[serde(rename_all = "lowercase")]
pub enum StreamType {
    #[default]
    Logs,
    Metrics,
    Traces,
    #[serde(rename = "service_graph")]
    ServiceGraph,
    #[serde(rename = "enrichment_tables")]
    EnrichmentTables,
    #[serde(rename = "file_list")]
    Filelist,
    Metadata,
    Index,
}

impl StreamType {
    pub fn support_index(&self) -> bool {
        matches!(
            *self,
            StreamType::Logs | StreamType::Metrics | StreamType::Traces | StreamType::Metadata
        )
    }

    pub fn support_uds(&self) -> bool {
        matches!(
            *self,
            StreamType::Logs | StreamType::Metrics | StreamType::Traces
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            StreamType::Logs => "logs",
            StreamType::Metrics => "metrics",
            StreamType::Traces => "traces",
            StreamType::ServiceGraph => "service_graph",
            StreamType::EnrichmentTables => "enrichment_tables",
            StreamType::Filelist => "file_list",
            StreamType::Metadata => "metadata",
            StreamType::Index => "index",
        }
    }
}

impl From<&str> for StreamType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "logs" => StreamType::Logs,
            "metrics" => StreamType::Metrics,
            "traces" => StreamType::Traces,
            "service_graph" => StreamType::ServiceGraph,
            "enrichment_tables" | "enrich" => StreamType::EnrichmentTables,
            "file_list" => StreamType::Filelist,
            "metadata" => StreamType::Metadata,
            "index" => StreamType::Index,
            _ => StreamType::default(),
        }
    }
}

impl From<String> for StreamType {
    fn from(s: String) -> Self {
        StreamType::from(s.as_str())
    }
}

impl std::fmt::Display for StreamType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            StreamType::Logs => write!(f, "logs"),
            StreamType::Metrics => write!(f, "metrics"),
            StreamType::Traces => write!(f, "traces"),
            StreamType::ServiceGraph => write!(f, "service_graph"),
            StreamType::EnrichmentTables => write!(f, "enrichment_tables"),
            StreamType::Filelist => write!(f, "file_list"),
            StreamType::Metadata => write!(f, "metadata"),
            StreamType::Index => write!(f, "index"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, ToSchema)]
#[serde(default)]
pub struct StreamParams {
    #[schema(value_type = String)]
    pub org_id: faststr::FastStr,
    #[schema(value_type = String)]
    pub stream_name: faststr::FastStr,
    pub stream_type: StreamType,
}

impl MemorySize for StreamParams {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<StreamParams>() + self.org_id.mem_size() + self.stream_name.mem_size()
    }
}

impl Default for StreamParams {
    fn default() -> Self {
        Self {
            org_id: String::default().into(),
            stream_name: String::default().into(),
            stream_type: StreamType::default(),
        }
    }
}

impl std::fmt::Display for StreamParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}/{}/{}",
            self.org_id, self.stream_name, self.stream_type
        )
    }
}

impl StreamParams {
    pub fn new(org_id: &str, stream_name: &str, stream_type: StreamType) -> Self {
        Self {
            org_id: org_id.to_string().into(),
            stream_name: stream_name.to_string().into(),
            stream_type,
        }
    }

    pub fn is_valid(&self) -> bool {
        !(self.org_id.is_empty() || self.stream_name.is_empty())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ListStreamParams {
    pub list: Vec<StreamParams>,
}

#[derive(Default, Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, ToSchema)]
#[serde(default)]
pub struct RemoteStreamParams {
    #[schema(value_type = String)]
    pub org_id: faststr::FastStr,
    #[schema(value_type = String)]
    pub destination_name: faststr::FastStr,
}

impl MemorySize for RemoteStreamParams {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<RemoteStreamParams>()
            + self.org_id.mem_size()
            + self.destination_name.mem_size()
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FileKey {
    pub id: i64,
    pub account: String,
    pub key: String,
    pub meta: FileMeta,
    pub deleted: bool,
    pub segment_ids: Option<Arc<BitVec>>,
}

impl FileKey {
    pub fn new(id: i64, account: String, key: String, meta: FileMeta, deleted: bool) -> Self {
        Self {
            id,
            account,
            key,
            meta,
            deleted,
            segment_ids: None,
        }
    }

    pub fn from_file_name(file: &str) -> Self {
        Self {
            id: 0,
            account: String::default(),
            key: file.to_string(),
            meta: FileMeta::default(),
            deleted: false,
            segment_ids: None,
        }
    }

    pub fn with_segment_ids(&mut self, segment_ids: BitVec) {
        self.segment_ids = Some(Arc::new(segment_ids));
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileMeta {
    pub min_ts: i64, // microseconds
    pub max_ts: i64, // microseconds
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
    pub index_size: i64,
    #[serde(default)]
    pub bloom_ver: i64, // 0 = no .bf; otherwise = microsecond ts encoded in .bf filename
    pub flattened: bool,
}

impl FileMeta {
    pub fn is_empty(&self) -> bool {
        self.records == 0 && self.original_size == 0
    }
}

impl MemorySize for FileMeta {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<FileMeta>()
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

#[derive(Clone, Debug, Default)]
pub struct FileListDeleted {
    pub id: i64,
    pub account: String,
    pub file: String,
    pub index_file: bool,
    pub flattened: bool,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone, Copy, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StorageType {
    #[default]
    Normal,
    Compliance,
}

impl std::fmt::Display for StorageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageType::Normal => write!(f, "normal"),
            StorageType::Compliance => write!(f, "compliance"),
        }
    }
}

impl std::str::FromStr for StorageType {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "compliance" => StorageType::Compliance,
            _ => StorageType::Normal,
        })
    }
}

impl StorageType {
    pub fn is_compliance(&self) -> bool {
        matches!(self, StorageType::Compliance)
    }
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub enum QueryPartitionStrategy {
    #[default]
    FileNum,
    FileSize,
    FileHash,
}

impl std::str::FromStr for QueryPartitionStrategy {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "file_num" => QueryPartitionStrategy::FileNum,
            "file_size" => QueryPartitionStrategy::FileSize,
            "file_hash" => QueryPartitionStrategy::FileHash,
            _ => QueryPartitionStrategy::FileNum,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MergeStrategy {
    FileSize,
    FileTime,
    TimeRange,
}

impl From<&String> for MergeStrategy {
    fn from(s: &String) -> Self {
        match s.to_lowercase().as_str() {
            "file_size" => MergeStrategy::FileSize,
            "file_time" => MergeStrategy::FileTime,
            "time_range" => MergeStrategy::TimeRange,
            _ => MergeStrategy::FileSize,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StreamStats {
    pub created_at: i64,
    pub doc_time_min: i64,
    pub doc_time_max: i64,
    pub doc_num: i64,
    pub file_num: i64,
    pub storage_size: f64,
    pub compressed_size: f64,
    pub index_size: f64,
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
        let file_push_interval = Duration::try_seconds(get_config().limit.file_push_interval as _)
            .unwrap()
            .num_microseconds()
            .unwrap();
        (self.doc_time_min, self.doc_time_max + file_push_interval)
    }

    pub fn add_file_meta(&mut self, meta: &FileMeta) {
        self.file_num += 1;
        self.doc_num = max(0, self.doc_num + meta.records);
        self.doc_time_min = if self.doc_time_min == 0 {
            meta.min_ts
        } else if meta.min_ts == 0 {
            self.doc_time_min
        } else {
            self.doc_time_min.min(meta.min_ts)
        };
        self.doc_time_max = self.doc_time_max.max(meta.max_ts);
        self.storage_size += meta.original_size as f64;
        self.compressed_size += meta.compressed_size as f64;
        self.index_size += meta.index_size as f64;
        if self.storage_size < 0.0 {
            self.storage_size = 0.0;
        }
        if self.compressed_size < 0.0 {
            self.compressed_size = 0.0;
        }
        if self.index_size < 0.0 {
            self.index_size = 0.0;
        }
    }

    pub fn format_by(&mut self, stats: &StreamStats) {
        self.file_num = stats.file_num;
        self.doc_num = stats.doc_num;
        self.storage_size = stats.storage_size;
        self.compressed_size = stats.compressed_size;
        self.index_size = stats.index_size;
        self.doc_time_min = if self.doc_time_min == 0 {
            stats.doc_time_min
        } else if stats.doc_time_min == 0 {
            self.doc_time_min
        } else {
            self.doc_time_min.min(stats.doc_time_min)
        };
        self.doc_time_max = self.doc_time_max.max(stats.doc_time_max);
    }

    pub fn merge(&mut self, other: &StreamStats) {
        self.created_at = self.created_at.min(other.created_at);
        self.doc_time_min = if self.doc_time_min == 0 {
            other.doc_time_min
        } else if other.doc_time_min == 0 {
            self.doc_time_min
        } else {
            self.doc_time_min.min(other.doc_time_min)
        };
        self.doc_time_max = self.doc_time_max.max(other.doc_time_max);
        self.doc_num += other.doc_num;
        self.file_num += other.file_num;
        self.storage_size += other.storage_size;
        self.compressed_size += other.compressed_size;
        self.index_size += other.index_size;
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
            index_size: meta.index_size.unwrap_or_default(),
        }
    }
}

impl std::ops::Sub<&StreamStats> for &StreamStats {
    type Output = StreamStats;

    fn sub(self, rhs: &StreamStats) -> Self::Output {
        StreamStats {
            created_at: self.created_at,
            file_num: self.file_num - rhs.file_num,
            doc_num: self.doc_num - rhs.doc_num,
            doc_time_min: if self.doc_time_min == 0 {
                rhs.doc_time_min
            } else if rhs.doc_time_min == 0 {
                self.doc_time_min
            } else {
                self.doc_time_min.min(rhs.doc_time_min)
            },
            doc_time_max: self.doc_time_max.max(rhs.doc_time_max),
            storage_size: self.storage_size - rhs.storage_size,
            compressed_size: self.compressed_size - rhs.compressed_size,
            index_size: self.index_size - rhs.index_size,
        }
    }
}

impl std::ops::Add<&StreamStats> for &StreamStats {
    type Output = StreamStats;

    fn add(self, rhs: &StreamStats) -> Self::Output {
        StreamStats {
            created_at: self.created_at,
            file_num: self.file_num + rhs.file_num,
            doc_num: self.doc_num + rhs.doc_num,
            doc_time_min: if self.doc_time_min == 0 {
                rhs.doc_time_min
            } else if rhs.doc_time_min == 0 {
                self.doc_time_min
            } else {
                self.doc_time_min.min(rhs.doc_time_min)
            },
            doc_time_max: self.doc_time_max.max(rhs.doc_time_max),
            storage_size: self.storage_size + rhs.storage_size,
            compressed_size: self.compressed_size + rhs.compressed_size,
            index_size: self.index_size + rhs.index_size,
        }
    }
}

impl MemorySize for StreamStats {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<StreamStats>()
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
            index_size: req.index_size,
            bloom_ver: req.bloom_ver,
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
            flattened: false,
            index_size: req.index_size,
            bloom_ver: req.bloom_ver,
        }
    }
}

impl From<&FileKey> for cluster_rpc::FileKey {
    fn from(req: &FileKey) -> Self {
        cluster_rpc::FileKey {
            id: req.id,
            account: req.account.clone(),
            key: req.key.clone(),
            meta: Some(cluster_rpc::FileMeta::from(&req.meta)),
            deleted: req.deleted,
            segment_ids: None,
        }
    }
}

impl From<&cluster_rpc::FileKey> for FileKey {
    fn from(req: &cluster_rpc::FileKey) -> Self {
        FileKey {
            id: req.id,
            account: req.account.clone(),
            key: req.key.clone(),
            meta: FileMeta::from(req.meta.as_ref().unwrap()),
            deleted: req.deleted,
            segment_ids: None,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct UpdateSettingsWrapper<D> {
    #[serde(default)]
    pub add: Vec<D>,
    #[serde(default)]
    pub remove: Vec<D>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone, ToSchema)]
pub struct PatternAssociation {
    pub field: String,
    pub pattern_name: String,
    pub description: String,
    pub pattern: String,
    pub pattern_id: String,
    pub policy: String,
    pub apply_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct StreamField {
    pub name: String,
    pub r#type: String,
}

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
pub struct UpdateStreamSettings {
    #[serde(skip_serializing, default)]
    pub fields: UpdateSettingsWrapper<StreamField>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub partition_keys: UpdateSettingsWrapper<StreamPartition>,
    #[serde(default)]
    pub full_text_search_keys: UpdateSettingsWrapper<String>,
    #[serde(default)]
    pub index_fields: UpdateSettingsWrapper<String>,
    #[serde(default)]
    pub bloom_filter_fields: UpdateSettingsWrapper<String>,
    #[serde(skip_serializing_if = "Option::None", default)]
    pub data_retention: Option<i64>,
    #[serde(skip_serializing_if = "Option::None", default)]
    pub flatten_level: Option<i64>,
    #[serde(default)]
    pub defined_schema_fields: UpdateSettingsWrapper<String>,
    #[serde(default)]
    pub distinct_value_fields: UpdateSettingsWrapper<String>,
    #[serde(default)]
    pub max_query_range: Option<i64>,
    #[serde(default)]
    pub store_original_data: Option<bool>,
    #[serde(default)]
    pub approx_partition: Option<bool>,
    #[serde(default)]
    pub extended_retention_days: UpdateSettingsWrapper<TimeRange>,
    #[serde(default)]
    pub index_original_data: Option<bool>,
    #[serde(default)]
    pub index_all_values: Option<bool>,
    #[serde(default)]
    pub pattern_associations: UpdateSettingsWrapper<PatternAssociation>,
    #[serde(default)]
    pub enable_distinct_fields: Option<bool>,
    #[serde(default)]
    pub enable_log_patterns_extraction: Option<bool>,
    #[serde(default)]
    pub cross_links: UpdateSettingsWrapper<CrossLink>,
    #[serde(default)]
    pub storage_type: Option<StorageType>,
    #[serde(default)]
    pub is_llm_stream: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
/// WARNING: this implements Eq trait based only on the name,
/// so the timestamp will not be considered when comparing two entries
pub struct DistinctField {
    pub name: String,
    pub added_ts: i64,
}

impl PartialEq for DistinctField {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
    }
}
impl Eq for DistinctField {}

impl MemorySize for DistinctField {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<DistinctField>() + self.name.mem_size()
    }
}

/// A cross-link entry for drill-down/navigation from log/trace records
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CrossLink {
    /// Display name for the link
    pub name: String,
    /// URL template with {field_name} placeholders
    pub url: String,
    /// Show link only when at least one field matches the record.
    /// If empty, the link is always shown.
    #[serde(default)]
    pub fields: Vec<CrossLinkField>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CrossLinkField {
    pub name: String,
    /// Populated by result_schema: the alias used in the query for this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema, PartialEq, Eq, Hash)]
pub struct TimeRange {
    /// Start timestamp in microseconds
    pub start: i64,
    /// End timestamp in microseconds
    pub end: i64,
}

impl Display for TimeRange {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        let time_range_start: DateTime<Utc> = Utc.timestamp_nanos(self.start * 1000);
        let time_range_end: DateTime<Utc> = Utc.timestamp_nanos(self.end * 1000);
        write!(f, "{time_range_start} to {time_range_end}")
    }
}

impl MemorySize for TimeRange {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<TimeRange>()
    }
}

impl TimeRange {
    pub fn new(start: i64, end: i64) -> Self {
        Self { start, end }
    }

    pub fn is_empty(&self) -> bool {
        self.start == 0 && self.end == 0
    }

    pub fn contains(&self, other: &Self) -> bool {
        self.start <= other.start && self.end >= other.end
    }

    pub fn intersects(&self, other: &Self) -> bool {
        self.start < other.end && self.end > other.start
    }

    /// Returns the intersection of two time ranges
    /// If the time ranges do not intersect, returns nothing
    /// If the time ranges intersect, returns the inverse of the intersection
    pub fn split_by_range(&self, other: &Self) -> anyhow::Result<(Option<Self>, Option<Self>)> {
        let mut left = None;
        let mut right = None;

        if self == other {
            return Ok((left, right));
        }

        if !self.intersects(other) {
            return Err(anyhow::anyhow!("Time ranges do not intersect"));
        }

        if self.start < other.start {
            left = Some(Self::new(self.start, other.start));
        }
        if self.end > other.end {
            right = Some(Self::new(other.end, self.end));
        }
        Ok((left, right))
    }

    pub fn flatten_overlapping_ranges(ranges: Vec<Self>) -> Vec<Self> {
        if ranges.is_empty() {
            return ranges;
        }
        let mut ranges = ranges;
        ranges.sort_by(|a, b| a.start.cmp(&b.start));
        let mut result = Vec::new();
        let mut current = ranges[0].clone();
        for range in ranges.iter().skip(1) {
            if current.intersects(range) {
                current.end = range.end;
            } else {
                result.push(current.clone());
                current = range.clone();
            }
        }
        result.push(current);
        result
    }
}

#[derive(Clone, Debug, Deserialize, ToSchema, PartialEq)]
pub struct StreamSettings {
    #[serde(default)]
    pub partition_keys: Vec<StreamPartition>,
    #[serde(default)]
    pub full_text_search_keys: Vec<String>,
    #[serde(default)]
    pub index_fields: Vec<String>,
    #[serde(default)]
    pub bloom_filter_fields: Vec<String>,
    #[serde(default)]
    pub data_retention: i64,
    #[serde(default)]
    pub flatten_level: Option<i64>,
    #[serde(default)]
    pub defined_schema_fields: Vec<String>,
    #[serde(default)]
    pub max_query_range: i64, // hours
    #[serde(default)]
    pub store_original_data: bool,
    #[serde(default)]
    pub approx_partition: bool,
    #[serde(default)]
    pub distinct_value_fields: Vec<DistinctField>,
    #[serde(default)]
    pub index_updated_at: i64,
    #[serde(default)]
    pub extended_retention_days: Vec<TimeRange>,
    #[serde(default)]
    pub index_original_data: bool,
    #[serde(default)]
    pub index_all_values: bool,
    #[serde(default)]
    pub enable_distinct_fields: bool,
    #[serde(default)]
    pub enable_log_patterns_extraction: bool,
    #[serde(default)]
    pub is_llm_stream: bool,
    #[serde(default)]
    pub cross_links: Vec<CrossLink>,
    #[serde(default)]
    pub storage_type: StorageType,
}

impl Default for StreamSettings {
    fn default() -> Self {
        Self {
            partition_keys: Vec::new(),
            full_text_search_keys: Vec::new(),
            index_fields: Vec::new(),
            bloom_filter_fields: Vec::new(),
            data_retention: 0,
            flatten_level: None,
            defined_schema_fields: Vec::new(),
            max_query_range: 0,
            store_original_data: false,
            approx_partition: false,
            distinct_value_fields: Vec::new(),
            index_updated_at: 0,
            extended_retention_days: Vec::new(),
            index_original_data: false,
            index_all_values: false,
            enable_distinct_fields: true,
            enable_log_patterns_extraction: false,
            is_llm_stream: false,
            cross_links: Vec::new(),
            storage_type: StorageType::Normal,
        }
    }
}

impl Serialize for StreamSettings {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("stream_settings", 4)?;
        let mut part_keys = HashMap::new();
        for (index, key) in self.partition_keys.iter().enumerate() {
            part_keys.insert(format!("L{index}"), key);
        }
        state.serialize_field("partition_keys", &part_keys)?;
        state.serialize_field("full_text_search_keys", &self.full_text_search_keys)?;
        state.serialize_field("index_fields", &self.index_fields)?;
        state.serialize_field("bloom_filter_fields", &self.bloom_filter_fields)?;
        state.serialize_field("distinct_value_fields", &self.distinct_value_fields)?;
        state.serialize_field("data_retention", &self.data_retention)?;
        state.serialize_field("max_query_range", &self.max_query_range)?;
        state.serialize_field("store_original_data", &self.store_original_data)?;
        state.serialize_field("approx_partition", &self.approx_partition)?;
        state.serialize_field("index_updated_at", &self.index_updated_at)?;
        state.serialize_field("extended_retention_days", &self.extended_retention_days)?;
        state.serialize_field("index_original_data", &self.index_original_data)?;
        state.serialize_field("index_all_values", &self.index_all_values)?;
        state.serialize_field("enable_distinct_fields", &self.enable_distinct_fields)?;
        state.serialize_field(
            "enable_log_patterns_extraction",
            &self.enable_log_patterns_extraction,
        )?;

        if !self.defined_schema_fields.is_empty() {
            let mut fields = self.defined_schema_fields.clone();
            fields.sort_unstable();
            fields.dedup();
            state.serialize_field("defined_schema_fields", &fields)?;
        } else {
            state.skip_field("defined_schema_fields")?;
        }
        match self.flatten_level.as_ref() {
            Some(flatten_level) => {
                state.serialize_field("flatten_level", flatten_level)?;
            }
            None => {
                state.skip_field("flatten_level")?;
            }
        }
        state.serialize_field("is_llm_stream", &self.is_llm_stream)?;
        if !self.cross_links.is_empty() {
            state.serialize_field("cross_links", &self.cross_links)?;
        } else {
            state.skip_field("cross_links")?;
        }
        state.serialize_field("storage_type", &self.storage_type)?;
        state.end()
    }
}

impl From<&str> for StreamSettings {
    fn from(data: &str) -> Self {
        let settings: json::Value = json::from_slice(data.as_bytes()).unwrap();

        let mut partition_keys = Vec::new();
        if let Some(value) = settings.get("partition_keys") {
            let mut v: Vec<_> = value.as_object().unwrap().into_iter().collect();
            v.sort_by(|a, b| a.0.cmp(b.0));
            for (_, value) in v.iter() {
                match value {
                    json::Value::String(v) => {
                        partition_keys.push(StreamPartition::new(v));
                    }
                    json::Value::Object(v) => {
                        let val: StreamPartition =
                            json::from_value(json::Value::Object(v.to_owned())).unwrap();
                        partition_keys.push(val);
                    }
                    _ => {}
                }
            }
        }

        let mut full_text_search_keys = Vec::new();
        let fields = settings.get("full_text_search_keys");
        if let Some(value) = fields {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                full_text_search_keys.push(item.as_str().unwrap().to_string())
            }
        }

        let mut index_fields = Vec::new();
        let fields = settings.get("index_fields");
        if let Some(value) = fields {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                index_fields.push(item.as_str().unwrap().to_string())
            }
        }

        let mut bloom_filter_fields = Vec::new();
        let fields = settings.get("bloom_filter_fields");
        if let Some(value) = fields {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                bloom_filter_fields.push(item.as_str().unwrap().to_string())
            }
        }

        let mut data_retention = 0;
        if let Some(v) = settings.get("data_retention") {
            data_retention = v.as_i64().unwrap();
        };

        let mut max_query_range = 0;
        if let Some(v) = settings.get("max_query_range") {
            max_query_range = v.as_i64().unwrap();
        };

        let mut defined_schema_fields = Vec::<String>::new();
        if let Some(value) = settings.get("defined_schema_fields") {
            let mut fields = value
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item.as_str().unwrap().to_string())
                .collect::<Vec<_>>();

            fields.sort_unstable();
            fields.dedup();
            defined_schema_fields = fields;
        }

        let flatten_level = settings.get("flatten_level").and_then(Value::as_i64);

        let store_original_data = settings
            .get("store_original_data")
            .and_then(Value::as_bool)
            .unwrap_or_default();

        let approx_partition = settings
            .get("approx_partition")
            .and_then(Value::as_bool)
            .unwrap_or(
                get_config()
                    .common
                    .use_stream_settings_for_partitions_enabled,
            );

        let mut distinct_value_fields = Vec::new();
        let fields = settings.get("distinct_value_fields");
        if let Some(value) = fields {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                distinct_value_fields.push(json::from_value(item.clone()).unwrap())
            }
        }

        let index_updated_at = settings
            .get("index_updated_at")
            .and_then(Value::as_i64)
            .unwrap_or_default();

        let mut extended_retention_days = vec![];
        if let Some(values) = settings
            .get("extended_retention_days")
            .and_then(|v| v.as_array())
        {
            for item in values {
                let start = item
                    .get("start")
                    .and_then(Value::as_i64)
                    .unwrap_or_default();
                let end = item.get("end").and_then(Value::as_i64).unwrap_or_default();
                extended_retention_days.push(TimeRange::new(start, end));
            }
        }

        let index_original_data = settings
            .get("index_original_data")
            .and_then(Value::as_bool)
            .unwrap_or_default();

        let index_all_values = settings
            .get("index_all_values")
            .and_then(Value::as_bool)
            .unwrap_or_default();
        let enable_distinct_fields = settings
            .get("enable_distinct_fields")
            .and_then(Value::as_bool)
            .unwrap_or_default();
        let enable_log_patterns_extraction = settings
            .get("enable_log_patterns_extraction")
            .and_then(Value::as_bool)
            .unwrap_or_default();
        let is_llm_stream = settings
            .get("is_llm_stream")
            .and_then(Value::as_bool)
            .unwrap_or_default();
        let mut cross_links = Vec::new();
        if let Some(value) = settings.get("cross_links").and_then(|v| v.as_array()) {
            for item in value {
                if let Ok(link) = json::from_value::<CrossLink>(item.clone()) {
                    cross_links.push(link);
                }
            }
        }
        let storage_type = settings
            .get("storage_type")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<StorageType>().ok())
            .unwrap_or_default();
        Self {
            partition_keys,
            full_text_search_keys,
            index_fields,
            bloom_filter_fields,
            data_retention,
            max_query_range,
            flatten_level,
            defined_schema_fields,
            store_original_data,
            approx_partition,
            distinct_value_fields,
            index_updated_at,
            extended_retention_days,
            index_original_data,
            index_all_values,
            enable_distinct_fields,
            enable_log_patterns_extraction,
            is_llm_stream,
            cross_links,
            storage_type,
        }
    }
}

impl MemorySize for StreamSettings {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<StreamSettings>()
            + self.partition_keys.mem_size()
            + self.full_text_search_keys.mem_size()
            + self.index_fields.mem_size()
            + self.bloom_filter_fields.mem_size()
            + self.defined_schema_fields.mem_size()
            + self.distinct_value_fields.mem_size()
            + self.extended_retention_days.mem_size()
    }
}

#[derive(Clone, Debug, Default, Hash, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StreamPartition {
    pub field: String,
    #[serde(default)]
    pub types: StreamPartitionType,
    #[serde(default)]
    pub disabled: bool,
}

impl StreamPartition {
    pub fn new(field: &str) -> Self {
        Self {
            field: field.to_string(),
            types: StreamPartitionType::Value,
            disabled: false,
        }
    }

    pub fn new_hash(field: &str, buckets: u64) -> Self {
        Self {
            field: field.to_string(),
            types: StreamPartitionType::Hash(std::cmp::max(16, buckets)),
            disabled: false,
        }
    }

    pub fn new_prefix(field: &str) -> Self {
        Self {
            field: field.to_string(),
            types: StreamPartitionType::Prefix,
            disabled: false,
        }
    }

    pub fn get_partition_key(&self, value: &str) -> String {
        format!("{}={}", self.field, self.get_partition_value(value))
    }

    pub fn get_partition_value(&self, value: &str) -> String {
        let val = match &self.types {
            StreamPartitionType::Value => value.to_string(),
            StreamPartitionType::Hash(n) => {
                let h = gxhash::new().sum64(value);
                let bucket = h % n;
                bucket.to_string()
            }
            StreamPartitionType::Prefix => value
                .to_ascii_lowercase()
                .chars()
                .next()
                .unwrap_or('_')
                .to_string(),
        };
        if val.is_ascii() {
            val
        } else {
            urlencoding::encode(&val).into_owned()
        }
    }
}

impl MemorySize for StreamPartition {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<StreamPartition>() + self.field.mem_size()
    }
}

#[derive(Clone, Debug, Default, Hash, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StreamPartitionType {
    #[default]
    Value, // each value is a partition
    Hash(u64), // partition with fixed bucket size by hash
    Prefix,    // partition by first letter of term
}

impl Display for StreamPartitionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StreamPartitionType::Value => write!(f, "value"),
            StreamPartitionType::Hash(_) => write!(f, "hash"),
            StreamPartitionType::Prefix => write!(f, "prefix"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EnrichmentTableMetaStreamStats {
    pub start_time: i64,
    pub end_time: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub enum FileListBookKeepMode {
    History,
    #[default]
    Deleted,
    None,
}

impl std::fmt::Display for FileListBookKeepMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileListBookKeepMode::History => write!(f, "history"),
            FileListBookKeepMode::Deleted => write!(f, "deleted"),
            FileListBookKeepMode::None => write!(f, "none"),
        }
    }
}

impl From<&str> for FileListBookKeepMode {
    fn from(s: &str) -> Self {
        match s {
            "history" => FileListBookKeepMode::History,
            "deleted" => FileListBookKeepMode::Deleted,
            "none" => FileListBookKeepMode::None,
            _ => FileListBookKeepMode::default(),
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
            flattened: false,
            index_size: 0,
            bloom_ver: 0,
        };

        let rpc_meta = cluster_rpc::FileMeta::from(&file_meta);
        let resp = FileMeta::from(&rpc_meta);
        assert_eq!(file_meta, resp);
    }

    #[test]
    fn test_stream_stats_add_file_meta() {
        let mut stats = StreamStats::default();
        let meta = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 1000,
            compressed_size: 500,
            index_size: 50,
            flattened: false,
            bloom_ver: 0,
        };

        stats.add_file_meta(&meta);
        assert_eq!(stats.file_num, 1);
        assert_eq!(stats.doc_num, 100);
        assert_eq!(stats.doc_time_min, 1000);
        assert_eq!(stats.doc_time_max, 2000);
        assert_eq!(stats.storage_size, 1000.0);
        assert_eq!(stats.compressed_size, 500.0);

        // Test with negative values (should be clamped to 0)
        let negative_meta = FileMeta {
            original_size: -100,
            compressed_size: -50,
            index_size: -10,
            ..meta
        };
        let mut negative_stats = StreamStats {
            storage_size: 50.0,
            compressed_size: 25.0,
            index_size: 5.0,
            ..Default::default()
        };
        negative_stats.add_file_meta(&negative_meta);
        assert_eq!(negative_stats.storage_size, 0.0);
        assert_eq!(negative_stats.compressed_size, 0.0);
        assert_eq!(negative_stats.index_size, 0.0);
    }

    #[test]
    fn test_stream_stats_operations() {
        let stats1 = StreamStats {
            file_num: 5,
            doc_num: 100,
            storage_size: 1000.0,
            compressed_size: 500.0,
            doc_time_min: 1000,
            doc_time_max: 2000,
            ..Default::default()
        };

        let stats2 = StreamStats {
            file_num: 3,
            doc_num: 50,
            storage_size: 300.0,
            compressed_size: 150.0,
            doc_time_min: 1500,
            doc_time_max: 2500,
            ..Default::default()
        };

        // Test addition
        let sum = &stats1 + &stats2;
        assert_eq!(sum.file_num, 8);
        assert_eq!(sum.doc_num, 150);
        assert_eq!(sum.storage_size, 1300.0);
        assert_eq!(sum.doc_time_min, 1000);
        assert_eq!(sum.doc_time_max, 2500);

        // Test subtraction
        let diff = &stats1 - &stats2;
        assert_eq!(diff.file_num, 2);
        assert_eq!(diff.doc_num, 50);
        assert_eq!(diff.storage_size, 700.0);
    }

    #[test]
    fn test_stream_partition_types() {
        // Test prefix partition
        let prefix_part = StreamPartition::new_prefix("field");
        assert_eq!(prefix_part.types, StreamPartitionType::Prefix);
        assert_eq!(prefix_part.get_partition_value("Hello"), "h");
        assert_eq!(prefix_part.get_partition_value(""), "_");
        assert_eq!(prefix_part.get_partition_value("123"), "1");

        // Test value partition
        let value_part = StreamPartition::new("field");
        assert_eq!(value_part.get_partition_value("test_value"), "test_value");

        // Test non-ASCII encoding
        let non_ascii_part = StreamPartition::new("field");
        let encoded = non_ascii_part.get_partition_value("测试");
        assert!(encoded.contains("%"));

        // Test Display for StreamPartitionType
        assert_eq!(format!("{}", StreamPartitionType::Value), "value");
        assert_eq!(format!("{}", StreamPartitionType::Hash(32)), "hash");
        assert_eq!(format!("{}", StreamPartitionType::Prefix), "prefix");
    }

    #[cfg(feature = "gxhash")]
    #[test]
    fn test_hash_partition() {
        let part = StreamPartition::new("field");
        assert_eq!(
            json::to_string(&part).unwrap(),
            r#"{"field":"field","types":"value","disabled":false}"#
        );
        let part = StreamPartition::new_hash("field", 32);
        assert_eq!(
            json::to_string(&part).unwrap(),
            r#"{"field":"field","types":{"hash":32},"disabled":false}"#
        );

        assert_eq!(part.get_partition_key("hello"), "field=20");
        assert_eq!(part.get_partition_key("world"), "field=13");
        assert_eq!(part.get_partition_key("foo"), "field=21");
        assert_eq!(part.get_partition_key("bar"), "field=4");
        assert_eq!(part.get_partition_key("test"), "field=10");
        assert_eq!(part.get_partition_key("test1"), "field=21");
        assert_eq!(part.get_partition_key("test2"), "field=18");
        assert_eq!(part.get_partition_key("test3"), "field=6");
    }

    #[cfg(not(feature = "gxhash"))]
    #[test]
    fn test_hash_partition() {
        let part = StreamPartition::new("field");
        assert_eq!(
            json::to_string(&part).unwrap(),
            r#"{"field":"field","types":"value","disabled":false}"#
        );
        let part = StreamPartition::new_hash("field", 32);
        assert_eq!(
            json::to_string(&part).unwrap(),
            r#"{"field":"field","types":{"hash":32},"disabled":false}"#
        );

        for key in &[
            "hello", "world", "foo", "bar", "test", "test1", "test2", "test3",
        ] {
            println!("{}: {}", key, part.get_partition_key(key));
        }
        assert_eq!(part.get_partition_key("hello"), "field=30");
        assert_eq!(part.get_partition_key("world"), "field=20");
        assert_eq!(part.get_partition_key("foo"), "field=26");
        assert_eq!(part.get_partition_key("bar"), "field=7");
        assert_eq!(part.get_partition_key("test"), "field=13");
        assert_eq!(part.get_partition_key("test1"), "field=25");
        assert_eq!(part.get_partition_key("test2"), "field=4");
        assert_eq!(part.get_partition_key("test3"), "field=2");
    }

    #[test]
    fn test_stream_params() {
        let params = StreamParams::new("org_id", "stream_name", StreamType::Logs);
        let param2 = StreamParams::new("org_id", "stream_name", StreamType::Logs);
        let param3 = StreamParams::new("org_id", "stream_name", StreamType::Index);
        assert_eq!(params.org_id, "org_id");
        assert_eq!(params.stream_name, "stream_name");
        assert_eq!(params.stream_type, StreamType::Logs);
        let mut map = HashMap::new();
        map.insert(params, 1);
        map.insert(param2, 2);
        map.insert(param3, 2);
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn test_split_ranges() {
        // contains
        let range = TimeRange::new(0, 400);
        let other = TimeRange::new(50, 150);
        let (left, right) = range.split_by_range(&other).unwrap();
        assert!(left.as_ref().and(right.as_ref()).is_some());
        assert_eq!(left.unwrap(), TimeRange::new(0, 50));
        assert_eq!(right.unwrap(), TimeRange::new(150, 400));

        // partial overlap
        let range = TimeRange::new(0, 100);
        let other = TimeRange::new(50, 100);
        let (left, right) = range.split_by_range(&other).unwrap();
        assert!(left.as_ref().is_some());
        assert!(right.is_none());
        assert_eq!(left.unwrap(), TimeRange::new(0, 50));

        // equals
        let range = TimeRange::new(0, 100);
        let other = TimeRange::new(0, 100);
        let (left, right) = range.split_by_range(&other).unwrap();
        assert!(left.and(right).is_none());

        // does not intersect
        let range = TimeRange::new(0, 100);
        let other = TimeRange::new(200, 300);
        let res = range.split_by_range(&other);
        assert!(res.is_err());
    }

    #[test]
    fn test_flatten_ranges() {
        let ranges = vec![TimeRange::new(0, 150), TimeRange::new(100, 200)];
        let expected_res = TimeRange::new(0, 200);
        let mut ranges = TimeRange::flatten_overlapping_ranges(ranges);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0], expected_res);

        ranges.clear();

        ranges = vec![
            TimeRange::new(0, 150),
            TimeRange::new(200, 300),
            TimeRange::new(100, 199),
        ];
        let expected_res = vec![TimeRange::new(0, 199), TimeRange::new(200, 300)];
        assert_eq!(TimeRange::flatten_overlapping_ranges(ranges), expected_res);
    }

    // ── DataType Display / FromStr / From<DataType> for arrow_schema::DataType ─

    #[test]
    fn test_data_type_display() {
        assert_eq!(DataType::Utf8.to_string(), "Utf8");
        assert_eq!(DataType::LargeUtf8.to_string(), "LargeUtf8");
        assert_eq!(DataType::Int64.to_string(), "Int64");
        assert_eq!(DataType::Uint64.to_string(), "Uint64");
        assert_eq!(DataType::Float64.to_string(), "Float64");
        assert_eq!(DataType::Boolean.to_string(), "Boolean");
    }

    #[test]
    fn test_data_type_from_str() {
        assert_eq!("utf8".parse::<DataType>().unwrap(), DataType::Utf8);
        assert_eq!("UTF8".parse::<DataType>().unwrap(), DataType::Utf8);
        assert_eq!(
            "largeutf8".parse::<DataType>().unwrap(),
            DataType::LargeUtf8
        );
        assert_eq!("int64".parse::<DataType>().unwrap(), DataType::Int64);
        assert_eq!("uint64".parse::<DataType>().unwrap(), DataType::Uint64);
        assert_eq!("float64".parse::<DataType>().unwrap(), DataType::Float64);
        assert_eq!("boolean".parse::<DataType>().unwrap(), DataType::Boolean);
        assert!("unknown_type".parse::<DataType>().is_err());
    }

    #[test]
    fn test_data_type_into_arrow() {
        use arrow_schema::DataType as ArrowDT;
        assert_eq!(ArrowDT::from(DataType::Utf8), ArrowDT::Utf8);
        assert_eq!(ArrowDT::from(DataType::LargeUtf8), ArrowDT::LargeUtf8);
        assert_eq!(ArrowDT::from(DataType::Int64), ArrowDT::Int64);
        assert_eq!(ArrowDT::from(DataType::Uint64), ArrowDT::UInt64);
        assert_eq!(ArrowDT::from(DataType::Float64), ArrowDT::Float64);
        assert_eq!(ArrowDT::from(DataType::Boolean), ArrowDT::Boolean);
    }

    // ── StreamType methods ────────────────────────────────────────────────────

    #[test]
    fn test_stream_type_support_index() {
        assert!(StreamType::Logs.support_index());
        assert!(StreamType::Metrics.support_index());
        assert!(StreamType::Traces.support_index());
        assert!(StreamType::Metadata.support_index());
        assert!(!StreamType::EnrichmentTables.support_index());
        assert!(!StreamType::Filelist.support_index());
        assert!(!StreamType::ServiceGraph.support_index());
        assert!(!StreamType::Index.support_index());
    }

    #[test]
    fn test_stream_type_support_uds() {
        assert!(StreamType::Logs.support_uds());
        assert!(StreamType::Metrics.support_uds());
        assert!(StreamType::Traces.support_uds());
        assert!(!StreamType::EnrichmentTables.support_uds());
        assert!(!StreamType::Filelist.support_uds());
        assert!(!StreamType::Metadata.support_uds());
        assert!(!StreamType::Index.support_uds());
        assert!(!StreamType::ServiceGraph.support_uds());
    }

    #[test]
    fn test_stream_type_as_str() {
        assert_eq!(StreamType::Logs.as_str(), "logs");
        assert_eq!(StreamType::Metrics.as_str(), "metrics");
        assert_eq!(StreamType::Traces.as_str(), "traces");
        assert_eq!(StreamType::ServiceGraph.as_str(), "service_graph");
        assert_eq!(StreamType::EnrichmentTables.as_str(), "enrichment_tables");
        assert_eq!(StreamType::Filelist.as_str(), "file_list");
        assert_eq!(StreamType::Metadata.as_str(), "metadata");
        assert_eq!(StreamType::Index.as_str(), "index");
    }

    #[test]
    fn test_stream_type_from_string_owned() {
        assert_eq!(StreamType::from("logs".to_string()), StreamType::Logs);
        assert_eq!(
            StreamType::from("enrichment_tables".to_string()),
            StreamType::EnrichmentTables
        );
        assert_eq!(
            StreamType::from("enrich".to_string()),
            StreamType::EnrichmentTables
        );
        // unknown maps to default
        assert_eq!(
            StreamType::from("unknown".to_string()),
            StreamType::default()
        );
    }

    // ── StorageType ───────────────────────────────────────────────────────────

    #[test]
    fn test_storage_type_display() {
        assert_eq!(StorageType::Normal.to_string(), "normal");
        assert_eq!(StorageType::Compliance.to_string(), "compliance");
    }

    #[test]
    fn test_storage_type_from_str() {
        assert_eq!(
            "compliance".parse::<StorageType>().unwrap(),
            StorageType::Compliance
        );
        assert_eq!(
            "COMPLIANCE".parse::<StorageType>().unwrap(),
            StorageType::Compliance
        );
        assert_eq!(
            "normal".parse::<StorageType>().unwrap(),
            StorageType::Normal
        );
        // unknown maps to Normal
        assert_eq!(
            "anything".parse::<StorageType>().unwrap(),
            StorageType::Normal
        );
    }

    #[test]
    fn test_storage_type_is_compliance() {
        assert!(StorageType::Compliance.is_compliance());
        assert!(!StorageType::Normal.is_compliance());
    }

    // ── QueryPartitionStrategy FromStr ────────────────────────────────────────

    #[test]
    fn test_query_partition_strategy_from_str() {
        assert_eq!(
            "file_num".parse::<QueryPartitionStrategy>().unwrap(),
            QueryPartitionStrategy::FileNum
        );
        assert_eq!(
            "file_size".parse::<QueryPartitionStrategy>().unwrap(),
            QueryPartitionStrategy::FileSize
        );
        assert_eq!(
            "file_hash".parse::<QueryPartitionStrategy>().unwrap(),
            QueryPartitionStrategy::FileHash
        );
        // unknown maps to default FileNum
        assert_eq!(
            "unknown".parse::<QueryPartitionStrategy>().unwrap(),
            QueryPartitionStrategy::FileNum
        );
    }

    // ── MergeStrategy From<&String> ───────────────────────────────────────────

    #[test]
    fn test_merge_strategy_from_string() {
        assert_eq!(
            MergeStrategy::from(&"file_size".to_string()),
            MergeStrategy::FileSize
        );
        assert_eq!(
            MergeStrategy::from(&"file_time".to_string()),
            MergeStrategy::FileTime
        );
        assert_eq!(
            MergeStrategy::from(&"time_range".to_string()),
            MergeStrategy::TimeRange
        );
        assert_eq!(
            MergeStrategy::from(&"FILE_SIZE".to_string()),
            MergeStrategy::FileSize
        );
        // unknown maps to FileSize
        assert_eq!(
            MergeStrategy::from(&"unknown".to_string()),
            MergeStrategy::FileSize
        );
    }

    // ── StreamStats::time_range_intersects ────────────────────────────────────

    #[test]
    fn test_stream_stats_time_range_intersects() {
        // Use large timestamps so file_push_interval (10s = 10_000_000 µs) doesn't confuse results
        let base: i64 = 1_700_000_000_000_000; // ~2023-11-14 in µs
        let stats = StreamStats {
            doc_time_min: base,
            doc_time_max: base + 1_000_000, // +1 second
            ..Default::default()
        };
        // query fully within stream range
        assert!(stats.time_range_intersects(base + 200_000, base + 800_000));
        // query starts before, ends within
        assert!(stats.time_range_intersects(base - 500_000, base + 500_000));
        // query starts within, ends after
        assert!(stats.time_range_intersects(base + 500_000, base + 2_000_000));
        // query fully contains stream range
        assert!(stats.time_range_intersects(base - 1_000_000, base + 5_000_000));
        // query ends exactly at stream min — no intersection (min < end: base < base is false)
        assert!(!stats.time_range_intersects(base - 1_000_000, base));
        // query starts well after effective max (doc_time_max + file_push_interval ~10s)
        assert!(!stats.time_range_intersects(base + 20_000_000, base + 30_000_000));
    }

    // ── PartitionTimeLevel ────────────────────────────────────────────────────

    #[test]
    fn test_partition_time_level_duration() {
        assert_eq!(PartitionTimeLevel::Unset.duration(), 0);
        assert_eq!(PartitionTimeLevel::Hourly.duration(), 3600);
        assert_eq!(PartitionTimeLevel::Daily.duration(), 86400);
    }

    #[test]
    fn test_partition_time_level_from_str() {
        assert_eq!(
            PartitionTimeLevel::from("hourly"),
            PartitionTimeLevel::Hourly
        );
        assert_eq!(
            PartitionTimeLevel::from("HOURLY"),
            PartitionTimeLevel::Hourly
        );
        assert_eq!(PartitionTimeLevel::from("daily"), PartitionTimeLevel::Daily);
        assert_eq!(PartitionTimeLevel::from("unset"), PartitionTimeLevel::Unset);
        assert_eq!(
            PartitionTimeLevel::from("unknown"),
            PartitionTimeLevel::Unset
        );
    }

    #[test]
    fn test_partition_time_level_display() {
        assert_eq!(PartitionTimeLevel::Unset.to_string(), "unset");
        assert_eq!(PartitionTimeLevel::Hourly.to_string(), "hourly");
        assert_eq!(PartitionTimeLevel::Daily.to_string(), "daily");
    }

    // ── FileMeta::is_empty ────────────────────────────────────────────────────

    #[test]
    fn test_file_meta_is_empty() {
        assert!(FileMeta::default().is_empty());
        let non_empty = FileMeta {
            records: 100,
            original_size: 1024,
            ..Default::default()
        };
        assert!(!non_empty.is_empty());
        // has records but no size
        let records_only = FileMeta {
            records: 1,
            ..Default::default()
        };
        assert!(!records_only.is_empty());
    }

    // ── FileKey::from_file_name ───────────────────────────────────────────────

    #[test]
    fn test_file_key_from_file_name() {
        let key = FileKey::from_file_name("files/default/logs/test/2024-01-01/chunk.parquet");
        assert_eq!(key.key, "files/default/logs/test/2024-01-01/chunk.parquet");
        assert_eq!(key.id, 0);
        assert!(key.account.is_empty());
        assert!(!key.deleted);
        assert!(key.segment_ids.is_none());
    }

    #[test]
    fn test_file_key_new() {
        let meta = FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 10,
            original_size: 1024,
            compressed_size: 512,
            index_size: 0,
            flattened: false,
            bloom_ver: 0,
        };
        let key = FileKey::new(
            42,
            "acc".to_string(),
            "files/k.parquet".to_string(),
            meta.clone(),
            false,
        );
        assert_eq!(key.id, 42);
        assert_eq!(key.account, "acc");
        assert_eq!(key.key, "files/k.parquet");
        assert_eq!(key.meta, meta);
        assert!(!key.deleted);
        assert!(key.segment_ids.is_none());
    }

    #[test]
    fn test_file_key_with_segment_ids() {
        let mut key = FileKey::from_file_name("files/k.parquet");
        assert!(key.segment_ids.is_none());
        let bv = BitVec::new();
        key.with_segment_ids(bv);
        assert!(key.segment_ids.is_some());
    }

    #[test]
    fn test_stream_params_is_valid() {
        let valid = StreamParams::new("org", "stream", StreamType::Logs);
        assert!(valid.is_valid());

        let no_org = StreamParams::new("", "stream", StreamType::Logs);
        assert!(!no_org.is_valid());

        let no_stream = StreamParams::new("org", "", StreamType::Logs);
        assert!(!no_stream.is_valid());
    }

    #[test]
    fn test_stream_stats_format_by() {
        let mut stats = StreamStats {
            doc_time_min: 500,
            doc_time_max: 1000,
            ..Default::default()
        };
        let src = StreamStats {
            file_num: 5,
            doc_num: 100,
            storage_size: 2048.0,
            compressed_size: 1024.0,
            index_size: 10.0,
            doc_time_min: 200,
            doc_time_max: 800,
            ..Default::default()
        };
        stats.format_by(&src);
        assert_eq!(stats.file_num, 5);
        assert_eq!(stats.doc_num, 100);
        assert_eq!(stats.storage_size, 2048.0);
        // doc_time_min: min(500, 200) = 200
        assert_eq!(stats.doc_time_min, 200);
        // doc_time_max: max(1000, 800) = 1000
        assert_eq!(stats.doc_time_max, 1000);
    }

    #[test]
    fn test_stream_stats_merge() {
        let mut a = StreamStats {
            file_num: 3,
            doc_num: 60,
            storage_size: 300.0,
            compressed_size: 150.0,
            index_size: 5.0,
            doc_time_min: 1000,
            doc_time_max: 2000,
            created_at: 100,
            ..Default::default()
        };
        let b = StreamStats {
            file_num: 2,
            doc_num: 40,
            storage_size: 200.0,
            compressed_size: 100.0,
            index_size: 3.0,
            doc_time_min: 500,
            doc_time_max: 3000,
            created_at: 50,
            ..Default::default()
        };
        a.merge(&b);
        assert_eq!(a.file_num, 5);
        assert_eq!(a.doc_num, 100);
        assert_eq!(a.storage_size, 500.0);
        assert_eq!(a.doc_time_min, 500);
        assert_eq!(a.doc_time_max, 3000);
        assert_eq!(a.created_at, 50);
    }

    #[test]
    fn test_stream_stats_from_str_roundtrip() {
        let stats = StreamStats {
            file_num: 7,
            doc_num: 200,
            storage_size: 1024.0,
            ..Default::default()
        };
        let json_str = String::from(stats.clone());
        let restored = StreamStats::from(json_str.as_str());
        assert_eq!(restored.file_num, stats.file_num);
        assert_eq!(restored.doc_num, stats.doc_num);
    }

    #[test]
    fn test_stream_stats_into_vec_and_string() {
        let stats = StreamStats {
            doc_num: 42,
            ..Default::default()
        };
        let v: Vec<u8> = stats.clone().into();
        assert!(!v.is_empty());
        let s: String = stats.into();
        assert!(s.contains("42"));
    }

    #[test]
    fn test_stream_stats_format_by_self_zero_doc_time_min() {
        // self.doc_time_min == 0 → take stats.doc_time_min
        let mut stats = StreamStats {
            doc_time_min: 0,
            ..Default::default()
        };
        let src = StreamStats {
            doc_time_min: 300,
            ..Default::default()
        };
        stats.format_by(&src);
        assert_eq!(stats.doc_time_min, 300);
    }

    #[test]
    fn test_stream_stats_format_by_src_zero_doc_time_min() {
        // stats.doc_time_min == 0 → keep self.doc_time_min
        let mut stats = StreamStats {
            doc_time_min: 400,
            ..Default::default()
        };
        let src = StreamStats {
            doc_time_min: 0,
            ..Default::default()
        };
        stats.format_by(&src);
        assert_eq!(stats.doc_time_min, 400);
    }

    #[test]
    fn test_stream_stats_merge_self_zero_doc_time_min() {
        // self.doc_time_min == 0 → take other.doc_time_min
        let mut a = StreamStats {
            doc_time_min: 0,
            ..Default::default()
        };
        let b = StreamStats {
            doc_time_min: 1500,
            ..Default::default()
        };
        a.merge(&b);
        assert_eq!(a.doc_time_min, 1500);
    }

    #[test]
    fn test_stream_stats_merge_other_zero_doc_time_min() {
        // other.doc_time_min == 0 → keep self.doc_time_min
        let mut a = StreamStats {
            doc_time_min: 800,
            ..Default::default()
        };
        let b = StreamStats {
            doc_time_min: 0,
            ..Default::default()
        };
        a.merge(&b);
        assert_eq!(a.doc_time_min, 800);
    }

    #[test]
    fn test_stream_stats_sub_zero_self_doc_time_min() {
        // self.doc_time_min == 0 → take rhs.doc_time_min
        let a = StreamStats {
            doc_time_min: 0,
            doc_num: 10,
            ..Default::default()
        };
        let b = StreamStats {
            doc_time_min: 500,
            doc_num: 3,
            ..Default::default()
        };
        let result = &a - &b;
        assert_eq!(result.doc_time_min, 500);
        assert_eq!(result.doc_num, 7);
    }

    #[test]
    fn test_stream_stats_sub_zero_rhs_doc_time_min() {
        // rhs.doc_time_min == 0 → keep self.doc_time_min
        let a = StreamStats {
            doc_time_min: 600,
            doc_num: 20,
            ..Default::default()
        };
        let b = StreamStats {
            doc_time_min: 0,
            doc_num: 5,
            ..Default::default()
        };
        let result = &a - &b;
        assert_eq!(result.doc_time_min, 600);
        assert_eq!(result.doc_num, 15);
    }

    #[test]
    fn test_stream_stats_from_usage_stats_none_compressed_index() {
        use crate::meta::self_reporting::usage::Stats;
        let usage = Stats {
            records: 50,
            stream_type: StreamType::Logs,
            org_id: "org".to_string(),
            stream_name: "s".to_string(),
            original_size: 1024.0,
            _timestamp: 0,
            min_ts: 100,
            max_ts: 200,
            compressed_size: None,
            index_size: None,
        };
        let stream_stats = StreamStats::from(usage);
        assert_eq!(stream_stats.doc_num, 50);
        assert_eq!(stream_stats.compressed_size, 0.0);
        assert_eq!(stream_stats.index_size, 0.0);
    }

    #[test]
    fn test_stream_stats_from_usage_stats() {
        use crate::meta::self_reporting::usage::Stats;
        let usage = Stats {
            records: 100,
            stream_type: StreamType::Logs,
            org_id: "org".to_string(),
            stream_name: "s".to_string(),
            original_size: 2048.0,
            _timestamp: 0,
            min_ts: 1000,
            max_ts: 5000,
            compressed_size: Some(1024.0),
            index_size: Some(50.0),
        };
        let stream_stats = StreamStats::from(usage);
        assert_eq!(stream_stats.doc_num, 100);
        assert_eq!(stream_stats.storage_size, 2048.0);
        assert_eq!(stream_stats.doc_time_min, 1000);
        assert_eq!(stream_stats.doc_time_max, 5000);
        assert_eq!(stream_stats.compressed_size, 1024.0);
        assert_eq!(stream_stats.index_size, 50.0);
    }

    #[test]
    fn test_file_list_bookkeep_mode_display() {
        assert_eq!(FileListBookKeepMode::History.to_string(), "history");
        assert_eq!(FileListBookKeepMode::Deleted.to_string(), "deleted");
        assert_eq!(FileListBookKeepMode::None.to_string(), "none");
    }

    #[test]
    fn test_file_list_bookkeep_mode_from_str() {
        assert!(matches!(
            FileListBookKeepMode::from("history"),
            FileListBookKeepMode::History
        ));
        assert!(matches!(
            FileListBookKeepMode::from("deleted"),
            FileListBookKeepMode::Deleted
        ));
        assert!(matches!(
            FileListBookKeepMode::from("none"),
            FileListBookKeepMode::None
        ));
        // unknown → default (Deleted)
        assert!(matches!(
            FileListBookKeepMode::from("unknown"),
            FileListBookKeepMode::Deleted
        ));
    }

    #[test]
    fn test_file_list_bookkeep_mode_default_is_deleted() {
        let m: FileListBookKeepMode = Default::default();
        assert!(matches!(m, FileListBookKeepMode::Deleted));
    }

    #[test]
    fn test_enrichment_table_meta_stream_stats_default() {
        let s = EnrichmentTableMetaStreamStats::default();
        assert_eq!(s.start_time, 0);
        assert_eq!(s.end_time, 0);
        assert_eq!(s.size, 0);
    }

    #[test]
    fn test_cross_link_field_alias_none_absent_from_json() {
        let f = CrossLinkField {
            name: "ts".to_string(),
            alias: None,
        };
        let json = serde_json::to_value(&f).unwrap();
        assert!(!json.as_object().unwrap().contains_key("alias"));
    }

    #[test]
    fn test_cross_link_field_alias_some_present_in_json() {
        let f = CrossLinkField {
            name: "ts".to_string(),
            alias: Some("timestamp".to_string()),
        };
        let json = serde_json::to_value(&f).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("alias"));
        assert_eq!(obj["alias"], serde_json::json!("timestamp"));
    }

    #[test]
    fn test_time_range_is_empty_true() {
        let r = TimeRange::new(0, 0);
        assert!(r.is_empty());
    }

    #[test]
    fn test_time_range_is_empty_false() {
        let r = TimeRange::new(100, 200);
        assert!(!r.is_empty());
    }

    #[test]
    fn test_time_range_is_empty_partial_zero() {
        // Only both zero counts as empty
        let r = TimeRange::new(0, 100);
        assert!(!r.is_empty());
    }

    #[test]
    fn test_time_range_contains_exact() {
        let outer = TimeRange::new(0, 100);
        let inner = TimeRange::new(0, 100);
        assert!(outer.contains(&inner));
    }

    #[test]
    fn test_time_range_contains_strict_subset() {
        let outer = TimeRange::new(0, 100);
        let inner = TimeRange::new(20, 80);
        assert!(outer.contains(&inner));
    }

    #[test]
    fn test_time_range_contains_not_contained() {
        let outer = TimeRange::new(0, 50);
        let inner = TimeRange::new(40, 100);
        assert!(!outer.contains(&inner));
    }

    #[test]
    fn test_time_range_intersects_overlap() {
        let a = TimeRange::new(0, 100);
        let b = TimeRange::new(50, 150);
        assert!(a.intersects(&b));
        assert!(b.intersects(&a));
    }

    #[test]
    fn test_time_range_intersects_no_overlap() {
        let a = TimeRange::new(0, 50);
        let b = TimeRange::new(50, 100);
        // a.end == b.start: condition is a.start < b.end && a.end > b.start => 0<100 && 50>50 =>
        // false
        assert!(!a.intersects(&b));
    }

    #[test]
    fn test_time_range_intersects_disjoint() {
        let a = TimeRange::new(0, 30);
        let b = TimeRange::new(50, 100);
        assert!(!a.intersects(&b));
    }

    // ── bloom_ver coverage on FileMeta ─────────────────────────────────────────

    #[test]
    fn test_file_meta_default_bloom_ver_is_zero() {
        let m = FileMeta::default();
        assert_eq!(m.bloom_ver, 0);
    }

    #[test]
    fn test_file_meta_grpc_roundtrip_preserves_bloom_ver() {
        let original = FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 10,
            original_size: 1024,
            compressed_size: 512,
            index_size: 64,
            flattened: false,
            bloom_ver: 1_715_000_000_000_000,
        };
        let rpc = cluster_rpc::FileMeta::from(&original);
        assert_eq!(rpc.bloom_ver, original.bloom_ver);
        let back = FileMeta::from(&rpc);
        assert_eq!(back.bloom_ver, original.bloom_ver);
    }

    #[test]
    fn test_file_meta_serde_json_roundtrip_with_bloom_ver() {
        let m = FileMeta {
            min_ts: 1,
            max_ts: 2,
            records: 3,
            original_size: 4,
            compressed_size: 5,
            index_size: 6,
            flattened: true,
            bloom_ver: 42,
        };
        let s = serde_json::to_string(&m).unwrap();
        assert!(s.contains("\"bloom_ver\":42"));
        let parsed: FileMeta = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed, m);
    }

    #[test]
    fn test_file_meta_serde_json_legacy_without_bloom_ver_defaults_to_zero() {
        // Old payloads written before bloom_ver was added must still deserialize.
        let legacy = r#"{
            "min_ts": 1,
            "max_ts": 2,
            "records": 3,
            "original_size": 4,
            "compressed_size": 5,
            "index_size": 6,
            "flattened": false
        }"#;
        let parsed: FileMeta = serde_json::from_str(legacy).unwrap();
        assert_eq!(parsed.bloom_ver, 0);
    }

    #[test]
    fn test_file_meta_is_empty_independent_of_bloom_ver() {
        // bloom_ver should not affect emptiness.
        let mut m = FileMeta::default();
        assert!(m.is_empty());
        m.bloom_ver = 99;
        assert!(m.is_empty());
    }

    #[test]
    fn test_kv_metadata_to_file_meta_leaves_bloom_ver_zero() {
        // Parquet KV metadata never carries bloom_ver — it must default to 0.
        use parquet::file::metadata::KeyValue;
        let kvs = vec![
            KeyValue::new("min_ts".to_string(), "10".to_string()),
            KeyValue::new("max_ts".to_string(), "20".to_string()),
            KeyValue::new("records".to_string(), "5".to_string()),
            KeyValue::new("original_size".to_string(), "100".to_string()),
            KeyValue::new("compressed_size".to_string(), "50".to_string()),
        ];
        let m: FileMeta = (kvs.as_slice()).into();
        assert_eq!(m.min_ts, 10);
        assert_eq!(m.max_ts, 20);
        assert_eq!(m.bloom_ver, 0);
    }
}
