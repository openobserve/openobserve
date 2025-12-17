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

use std::sync::Arc;

use arrow::array::{BooleanArray, Int64Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field, Schema};
use config::{
    get_config, ider,
    meta::{
        search::ScanStats,
        stream::{FileKey, PartitionTimeLevel, StreamStats, StreamType},
    },
};
use hashbrown::HashMap;
use infra::{
    errors,
    file_list::{FileId, FileRecord, calculate_max_ts_upper_bound},
};
use itertools::Itertools;
use once_cell::sync::Lazy;
use rayon::slice::ParallelSliceMut;

use crate::service::search::datafusion::exec::{DataFusionContextBuilder, TableBuilder};

pub static FILE_LIST_SCHEMA: Lazy<Arc<Schema>> = Lazy::new(|| {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Int64, false),
        Field::new("account", DataType::Utf8, false),
        Field::new("org", DataType::Utf8, false),
        Field::new("stream", DataType::Utf8, false),
        Field::new("date", DataType::Utf8, false),
        Field::new("file", DataType::Utf8, false),
        Field::new("deleted", DataType::Boolean, false),
        Field::new("flattened", DataType::Boolean, false),
        Field::new("min_ts", DataType::Int64, false),
        Field::new("max_ts", DataType::Int64, false),
        Field::new("records", DataType::Int64, false),
        Field::new("original_size", DataType::Int64, false),
        Field::new("compressed_size", DataType::Int64, false),
        Field::new("index_size", DataType::Int64, false),
        Field::new("created_at", DataType::Int64, false),
        Field::new("updated_at", DataType::Int64, false),
    ]))
});

enum QueryType {
    FileRecord,
    FileId,
}

macro_rules! get_col {
    ($var:ident, $name:literal, $typ:ty, $rbatch:ident) => {
        let $var = $rbatch
            .column_by_name($name)
            .unwrap()
            .as_any()
            .downcast_ref::<$typ>()
            .unwrap();
    };
}

pub fn record_batch_to_file_record(rb: RecordBatch) -> Vec<FileRecord> {
    get_col!(id_col, "id", Int64Array, rb);
    get_col!(account_col, "account", StringArray, rb);
    get_col!(org_col, "org", StringArray, rb);
    get_col!(stream_col, "stream", StringArray, rb);
    get_col!(date_col, "date", StringArray, rb);
    get_col!(file_col, "file", StringArray, rb);
    get_col!(deleted_col, "deleted", BooleanArray, rb);
    get_col!(flattened_col, "flattened", BooleanArray, rb);
    get_col!(min_ts_col, "min_ts", Int64Array, rb);
    get_col!(max_ts_col, "max_ts", Int64Array, rb);
    get_col!(records_col, "records", Int64Array, rb);
    get_col!(original_size_col, "original_size", Int64Array, rb);
    get_col!(compressed_size_col, "compressed_size", Int64Array, rb);
    get_col!(index_size_col, "index_size", Int64Array, rb);
    get_col!(created_at_col, "created_at", Int64Array, rb);
    get_col!(updated_at_col, "updated_at", Int64Array, rb);
    let mut ret = Vec::with_capacity(rb.num_rows());
    for idx in 0..rb.num_rows() {
        let t = FileRecord {
            id: id_col.value(idx),
            account: account_col.value(idx).to_string(),
            org: org_col.value(idx).to_string(),
            stream: stream_col.value(idx).to_string(),
            date: date_col.value(idx).to_string(),
            file: file_col.value(idx).to_string(),
            deleted: deleted_col.value(idx),
            flattened: flattened_col.value(idx),
            min_ts: min_ts_col.value(idx),
            max_ts: max_ts_col.value(idx),
            records: records_col.value(idx),
            original_size: original_size_col.value(idx),
            compressed_size: compressed_size_col.value(idx),
            index_size: index_size_col.value(idx),
            created_at: created_at_col.value(idx),
            updated_at: updated_at_col.value(idx),
        };
        ret.push(t);
    }
    ret.par_sort_unstable_by_key(|f| f.id);
    ret.dedup_by_key(|f| f.id);
    ret
}

fn record_batch_to_file_id(rb: RecordBatch) -> Vec<FileId> {
    get_col!(id_col, "id", Int64Array, rb);
    get_col!(records_col, "records", Int64Array, rb);
    get_col!(original_size_col, "original_size", Int64Array, rb);

    let mut ret = Vec::with_capacity(rb.num_rows());
    for idx in 0..rb.num_rows() {
        let t = FileId {
            id: id_col.value(idx),
            records: records_col.value(idx),
            original_size: original_size_col.value(idx),
            deleted: false,
        };
        ret.push(t);
    }
    ret.par_sort_unstable_by_key(|f| f.id);
    ret.dedup_by_key(|f| f.id);
    ret
}

fn record_batch_to_stats(rb: RecordBatch) -> Vec<(String, StreamStats)> {
    get_col!(stream_col, "stream", StringArray, rb);
    get_col!(min_ts_col, "min_ts", Int64Array, rb);
    get_col!(max_ts_col, "max_ts", Int64Array, rb);
    get_col!(file_num_col, "file_num", Int64Array, rb);
    get_col!(records_col, "records", Int64Array, rb);
    get_col!(original_size_col, "original_size", Int64Array, rb);
    get_col!(compressed_size_col, "compressed_size", Int64Array, rb);
    get_col!(index_size_col, "index_size", Int64Array, rb);

    let mut ret = Vec::with_capacity(rb.num_rows());
    for idx in 0..rb.num_rows() {
        let t = StreamStats {
            created_at: 0,
            doc_time_min: min_ts_col.value(idx),
            doc_time_max: max_ts_col.value(idx),
            doc_num: records_col.value(idx),
            file_num: file_num_col.value(idx),
            storage_size: original_size_col.value(idx) as f64,
            compressed_size: compressed_size_col.value(idx) as f64,
            index_size: index_size_col.value(idx) as f64,
        };
        let stream = stream_col.value(idx).to_string();
        ret.push((stream, t));
    }
    ret
}

pub fn generate_dump_stream_name(stream_type: StreamType, stream_name: &str) -> String {
    format!("{}_{}", stream_name, stream_type)
}

pub async fn exec(
    trace_id: &str,
    partitions: usize,
    files: Vec<FileKey>,
    query: &str,
) -> Result<Vec<RecordBatch>, errors::Error> {
    // load files to local cache
    let start = std::time::Instant::now();
    let mut scan_stats = ScanStats::default();
    let (cache_type, ..) = super::search::grpc::storage::cache_files(
        trace_id,
        &files
            .iter()
            .map(|f| {
                (
                    f.id,
                    &f.account,
                    &f.key,
                    f.meta.compressed_size,
                    f.meta.max_ts,
                )
            })
            .collect_vec(),
        &mut scan_stats,
        "parquet",
    )
    .await;

    scan_stats.querier_files = files.len() as i64;
    let cached_ratio = (scan_stats.querier_memory_cached_files
        + scan_stats.querier_disk_cached_files) as f64
        / scan_stats.querier_files as f64;

    let download_msg = if cache_type == infra::cache::file_data::CacheType::None {
        "".to_string()
    } else {
        format!(" downloading others into {cache_type:?} in background,")
    };
    log::info!(
        "[FILE_LIST_DUMP {trace_id}] query load files {}, memory cached {}, disk cached {}, cached ratio {}%,{download_msg} took: {} ms",
        scan_stats.querier_files,
        scan_stats.querier_memory_cached_files,
        scan_stats.querier_disk_cached_files,
        (cached_ratio * 100.0) as usize,
        start.elapsed().as_millis()
    );

    // search real file list by datafusion
    let trace_id = format!("{trace_id}-file-list-dump");
    let ret = inner_exec(&trace_id, partitions, files, query).await;
    // we always have to clear the files loaded
    super::search::datafusion::storage::file_list::clear(&trace_id);
    ret
}

async fn inner_exec(
    trace_id: &str,
    partitions: usize,
    dump_files: Vec<FileKey>,
    query: &str,
) -> Result<Vec<RecordBatch>, errors::Error> {
    let schema = FILE_LIST_SCHEMA.clone();

    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: config::meta::search::StorageType::Memory,
        work_group: None,
        target_partitions: partitions,
    };
    let table = TableBuilder::new()
        .build(session, dump_files, schema.clone())
        .await?;
    let ctx = DataFusionContextBuilder::new()
        .trace_id(trace_id)
        .build(partitions)
        .await?;
    ctx.register_table("file_list", table)?;
    let df = ctx.sql(query).await?;
    let ret = df.collect().await?;
    Ok(ret)
}

pub async fn query(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    range: (i64, i64),
    ids: &[i64],
) -> Result<Vec<FileRecord>, errors::Error> {
    let cfg = get_config();
    if !cfg.compact.file_list_dump_enabled {
        return Ok(vec![]);
    }
    let start = std::time::Instant::now();
    let batches = query_inner(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        range,
        ids,
        QueryType::FileRecord,
    )
    .await?;
    let ret = batches
        .into_iter()
        .flat_map(record_batch_to_file_record)
        .collect();
    log::info!(
        "[FILE_LIST_DUMP {trace_id}] query took {} ms",
        start.elapsed().as_millis()
    );
    Ok(ret)
}

pub async fn query_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    range: (i64, i64),
) -> Result<Vec<FileId>, errors::Error> {
    let cfg = get_config();
    if !cfg.compact.file_list_dump_enabled {
        return Ok(vec![]);
    }
    let start = std::time::Instant::now();
    let batches = query_inner(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        range,
        &[],
        QueryType::FileId,
    )
    .await?;
    let ret = batches
        .into_iter()
        .flat_map(record_batch_to_file_id)
        .collect();
    log::info!(
        "[FILE_LIST_DUMP {trace_id}] query_ids took {} ms",
        start.elapsed().as_millis()
    );
    Ok(ret)
}

async fn query_inner(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    range: (i64, i64),
    ids: &[i64],
    query_type: QueryType,
) -> Result<Vec<RecordBatch>, errors::Error> {
    let dump_stream_name = generate_dump_stream_name(stream_type, stream_name);
    let db_start = std::time::Instant::now();
    let dump_files = infra::file_list::query(
        org_id,
        StreamType::Filelist,
        &dump_stream_name,
        PartitionTimeLevel::Hourly,
        range,
        None,
    )
    .await?;
    if dump_files.is_empty() {
        return Ok(vec![]);
    }
    let db_time = db_start.elapsed().as_millis();

    let process_start = std::time::Instant::now();
    let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
    let fields = match query_type {
        QueryType::FileRecord => "*",
        QueryType::FileId => "id, records, original_size",
    };
    let query = if !ids.is_empty() && ids.len() <= 1000 {
        format!(
            "SELECT {fields} FROM file_list WHERE id IN ({})",
            ids.iter()
                .map(|id| id.to_string())
                .collect::<Vec<String>>()
                .join(",")
        )
    } else {
        let max_ts_upper_bound = calculate_max_ts_upper_bound(range.1, stream_type);
        format!(
            "SELECT {fields} FROM file_list WHERE org = '{org_id}' AND stream = '{stream_key}' AND max_ts >= {} AND max_ts <= {} AND min_ts <= {};",
            range.0, max_ts_upper_bound, range.1
        )
    };
    let ret = exec(trace_id, get_config().limit.cpu_num, dump_files, &query).await?;
    let process_time = process_start.elapsed().as_millis();

    log::info!(
        "[FILE_LIST_DUMP {trace_id}] getting dump files from db took {db_time} ms, searching for entries took {process_time} ms"
    );

    Ok(ret)
}

// 1. use updated_at time range to get changed file_list dump files
// 2. group the files by deleted flag, one for added, one for deleted
// 3. calculate the stats for each group
// 4. return the stats
pub async fn stats(
    time_range: (i64, i64),
    need_apply_time_range: bool,
) -> Result<Vec<(String, StreamStats)>, errors::Error> {
    if !get_config().compact.file_list_dump_enabled {
        return Ok(vec![]);
    }

    let mut ret = Vec::new();
    let dump_files = infra::file_list::query_for_dump_by_updated_at(time_range).await?;
    let (deleted_files, added_files): (Vec<_>, Vec<_>) =
        dump_files.into_iter().partition(|file| file.deleted);
    // calculate the stats
    let added_stats = stats_inner(added_files, time_range, need_apply_time_range).await?;
    let deleted_stats = stats_inner(deleted_files, time_range, false).await?;
    // we need convert deleted stats to negative
    let deleted_stats = deleted_stats.into_iter().map(|(stream, stats)| {
        (
            stream,
            StreamStats {
                doc_num: -stats.doc_num,
                file_num: -stats.file_num,
                storage_size: -stats.storage_size,
                compressed_size: -stats.compressed_size,
                index_size: -stats.index_size,
                doc_time_min: 0,
                doc_time_max: 0,
                created_at: 0,
            },
        )
    });
    ret.extend(added_stats);
    ret.extend(deleted_stats);
    Ok(ret)
}

async fn stats_inner(
    files: Vec<FileRecord>,
    time_range: (i64, i64),
    need_apply_time_range: bool,
) -> Result<Vec<(String, StreamStats)>, errors::Error> {
    if files.is_empty() {
        return Ok(vec![]);
    }

    let cfg = get_config();
    let (min_ts, max_ts) = time_range;
    let dump_files: Vec<_> = files.iter().map(|f| f.into()).collect();
    let filter = if need_apply_time_range {
        format!("WHERE updated_at > {min_ts} AND updated_at <= {max_ts}")
    } else {
        "".to_string()
    };
    let sql = format!(
        r#"
SELECT stream, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts, COUNT(*)::BIGINT AS file_num, 
SUM(records)::BIGINT AS records, SUM(original_size)::BIGINT AS original_size, SUM(compressed_size)::BIGINT AS compressed_size, SUM(index_size)::BIGINT AS index_size
FROM file_list {filter} GROUP BY stream
        "#
    );

    let mut stats_map = HashMap::new();
    log::info!(
        "[O2::FILE_DUMP::STATS] total dump file count: {}",
        dump_files.len(),
    );

    let trace_id = ider::generate_trace_id();
    let t = exec(&trace_id, cfg.limit.cpu_num, dump_files, &sql).await?;
    let ret = t
        .into_iter()
        .flat_map(record_batch_to_stats)
        .collect::<Vec<_>>();
    for (stream, stats) in ret {
        let entry = stats_map.entry(stream).or_insert(StreamStats::default());
        *entry = &*entry + &stats;
    }

    let ret = stats_map.into_iter().collect();
    Ok(ret)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{BooleanArray, Int64Array, RecordBatch, StringArray},
        datatypes::{DataType, Field, Schema},
    };

    use super::*;

    fn create_test_record_batch() -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("account", DataType::Utf8, false),
            Field::new("org", DataType::Utf8, false),
            Field::new("stream", DataType::Utf8, false),
            Field::new("date", DataType::Utf8, false),
            Field::new("file", DataType::Utf8, false),
            Field::new("deleted", DataType::Boolean, false),
            Field::new("flattened", DataType::Boolean, false),
            Field::new("min_ts", DataType::Int64, false),
            Field::new("max_ts", DataType::Int64, false),
            Field::new("records", DataType::Int64, false),
            Field::new("original_size", DataType::Int64, false),
            Field::new("compressed_size", DataType::Int64, false),
            Field::new("index_size", DataType::Int64, false),
            Field::new("created_at", DataType::Int64, false),
            Field::new("updated_at", DataType::Int64, false),
        ]));

        let id_array = Arc::new(Int64Array::from(vec![1, 2, 3]));
        let account_array = Arc::new(StringArray::from(vec!["account1", "account2", "account3"]));
        let org_array = Arc::new(StringArray::from(vec!["org1", "org2", "org3"]));
        let stream_array = Arc::new(StringArray::from(vec!["stream1", "stream2", "stream3"]));
        let date_array = Arc::new(StringArray::from(vec![
            "2024-01-01",
            "2024-01-02",
            "2024-01-03",
        ]));
        let file_array = Arc::new(StringArray::from(vec![
            "file1.parquet",
            "file2.parquet",
            "file3.parquet",
        ]));
        let deleted_array = Arc::new(BooleanArray::from(vec![false, true, false]));
        let flattened_array = Arc::new(BooleanArray::from(vec![true, false, true]));
        let min_ts_array = Arc::new(Int64Array::from(vec![1000, 2000, 3000]));
        let max_ts_array = Arc::new(Int64Array::from(vec![1100, 2100, 3100]));
        let records_array = Arc::new(Int64Array::from(vec![100, 200, 300]));
        let original_size_array = Arc::new(Int64Array::from(vec![1000, 2000, 3000]));
        let compressed_size_array = Arc::new(Int64Array::from(vec![500, 1000, 1500]));
        let index_size_array = Arc::new(Int64Array::from(vec![50, 100, 150]));
        let created_at_array = Arc::new(Int64Array::from(vec![1000, 2000, 3000]));
        let updated_at_array = Arc::new(Int64Array::from(vec![1100, 2100, 3100]));

        RecordBatch::try_new(
            schema,
            vec![
                id_array,
                account_array,
                org_array,
                stream_array,
                date_array,
                file_array,
                deleted_array,
                flattened_array,
                min_ts_array,
                max_ts_array,
                records_array,
                original_size_array,
                compressed_size_array,
                index_size_array,
                created_at_array,
                updated_at_array,
            ],
        )
        .unwrap()
    }

    #[test]
    fn test_record_batch_to_file_record() {
        let rb = create_test_record_batch();
        let records = record_batch_to_file_record(rb);

        assert_eq!(records.len(), 3);

        // Check first record
        let first = &records[0];
        assert_eq!(first.id, 1);
        assert_eq!(first.account, "account1");
        assert_eq!(first.org, "org1");
        assert_eq!(first.stream, "stream1");
        assert_eq!(first.date, "2024-01-01");
        assert_eq!(first.file, "file1.parquet");
        assert!(!first.deleted);
        assert!(first.flattened);
        assert_eq!(first.min_ts, 1000);
        assert_eq!(first.max_ts, 1100);
        assert_eq!(first.records, 100);
        assert_eq!(first.original_size, 1000);
        assert_eq!(first.compressed_size, 500);
        assert_eq!(first.index_size, 50);

        // Check that records are sorted by id
        assert!(records[0].id <= records[1].id);
        assert!(records[1].id <= records[2].id);
    }

    #[test]
    fn test_record_batch_to_file_record_deduplication() {
        // Create record batch with duplicate IDs
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("account", DataType::Utf8, false),
            Field::new("org", DataType::Utf8, false),
            Field::new("stream", DataType::Utf8, false),
            Field::new("date", DataType::Utf8, false),
            Field::new("file", DataType::Utf8, false),
            Field::new("deleted", DataType::Boolean, false),
            Field::new("flattened", DataType::Boolean, false),
            Field::new("min_ts", DataType::Int64, false),
            Field::new("max_ts", DataType::Int64, false),
            Field::new("records", DataType::Int64, false),
            Field::new("original_size", DataType::Int64, false),
            Field::new("compressed_size", DataType::Int64, false),
            Field::new("index_size", DataType::Int64, false),
            Field::new("created_at", DataType::Int64, false),
            Field::new("updated_at", DataType::Int64, false),
        ]));

        let rb = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(vec![1, 1, 2])), // Duplicate ID 1
                Arc::new(StringArray::from(vec!["acc1", "acc1", "acc2"])),
                Arc::new(StringArray::from(vec!["org1", "org1", "org2"])),
                Arc::new(StringArray::from(vec!["stream1", "stream1", "stream2"])),
                Arc::new(StringArray::from(vec![
                    "2024-01-01",
                    "2024-01-01",
                    "2024-01-02",
                ])),
                Arc::new(StringArray::from(vec!["file1", "file1", "file2"])),
                Arc::new(BooleanArray::from(vec![false, false, false])),
                Arc::new(BooleanArray::from(vec![true, true, true])),
                Arc::new(Int64Array::from(vec![1000, 1000, 2000])),
                Arc::new(Int64Array::from(vec![1100, 1100, 2100])),
                Arc::new(Int64Array::from(vec![100, 100, 200])),
                Arc::new(Int64Array::from(vec![1000, 1000, 2000])),
                Arc::new(Int64Array::from(vec![500, 500, 1000])),
                Arc::new(Int64Array::from(vec![50, 50, 100])),
                Arc::new(Int64Array::from(vec![1000, 1000, 2000])),
                Arc::new(Int64Array::from(vec![1100, 1100, 2100])),
            ],
        )
        .unwrap();

        let records = record_batch_to_file_record(rb);

        // Should deduplicate - only 2 unique records
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].id, 1);
        assert_eq!(records[1].id, 2);
    }

    fn create_test_file_id_record_batch() -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("records", DataType::Int64, false),
            Field::new("original_size", DataType::Int64, false),
        ]));

        RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(vec![101, 102, 103])),
                Arc::new(Int64Array::from(vec![1000, 2000, 3000])),
                Arc::new(Int64Array::from(vec![10000, 20000, 30000])),
            ],
        )
        .unwrap()
    }

    #[test]
    fn test_record_batch_to_file_id() {
        let rb = create_test_file_id_record_batch();
        let file_ids = record_batch_to_file_id(rb);

        assert_eq!(file_ids.len(), 3);

        // Check first file ID
        let first = &file_ids[0];
        assert_eq!(first.id, 101);
        assert_eq!(first.records, 1000);
        assert_eq!(first.original_size, 10000);
        assert!(!first.deleted); // Always false in conversion

        // Check sorting
        assert!(file_ids[0].id <= file_ids[1].id);
        assert!(file_ids[1].id <= file_ids[2].id);
    }

    #[test]
    fn test_record_batch_to_file_id_deduplication() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("records", DataType::Int64, false),
            Field::new("original_size", DataType::Int64, false),
        ]));

        let rb = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(vec![101, 101, 102])), // Duplicate 101
                Arc::new(Int64Array::from(vec![1000, 1000, 2000])),
                Arc::new(Int64Array::from(vec![10000, 10000, 20000])),
            ],
        )
        .unwrap();

        let file_ids = record_batch_to_file_id(rb);

        // Should deduplicate
        assert_eq!(file_ids.len(), 2);
        assert_eq!(file_ids[0].id, 101);
        assert_eq!(file_ids[1].id, 102);
    }

    fn create_test_stats_record_batch() -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![
            Field::new("stream", DataType::Utf8, false),
            Field::new("min_ts", DataType::Int64, false),
            Field::new("max_ts", DataType::Int64, false),
            Field::new("file_num", DataType::Int64, false),
            Field::new("records", DataType::Int64, false),
            Field::new("original_size", DataType::Int64, false),
            Field::new("compressed_size", DataType::Int64, false),
            Field::new("index_size", DataType::Int64, false),
        ]));

        RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec!["stream1", "stream2"])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
                Arc::new(Int64Array::from(vec![5000, 6000])),
                Arc::new(Int64Array::from(vec![10, 20])),
                Arc::new(Int64Array::from(vec![1000, 2000])),
                Arc::new(Int64Array::from(vec![100000, 200000])),
                Arc::new(Int64Array::from(vec![50000, 100000])),
                Arc::new(Int64Array::from(vec![5000, 10000])),
            ],
        )
        .unwrap()
    }

    #[test]
    fn test_record_batch_to_stats() {
        let rb = create_test_stats_record_batch();
        let stats = record_batch_to_stats(rb);

        assert_eq!(stats.len(), 2);

        // Check first stream stats
        let (stream1, stats1) = &stats[0];
        assert_eq!(stream1, "stream1");
        assert_eq!(stats1.created_at, 0);
        assert_eq!(stats1.doc_time_min, 1000);
        assert_eq!(stats1.doc_time_max, 5000);
        assert_eq!(stats1.doc_num, 1000);
        assert_eq!(stats1.file_num, 10);
        assert_eq!(stats1.storage_size, 100000.0);
        assert_eq!(stats1.compressed_size, 50000.0);
        assert_eq!(stats1.index_size, 5000.0);

        // Check second stream stats
        let (stream2, stats2) = &stats[1];
        assert_eq!(stream2, "stream2");
        assert_eq!(stats2.doc_time_min, 2000);
        assert_eq!(stats2.doc_time_max, 6000);
        assert_eq!(stats2.doc_num, 2000);
        assert_eq!(stats2.file_num, 20);
        assert_eq!(stats2.storage_size, 200000.0);
        assert_eq!(stats2.compressed_size, 100000.0);
        assert_eq!(stats2.index_size, 10000.0);
    }

    #[test]
    fn test_empty_record_batch_conversion() {
        // Test with empty record batches
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("account", DataType::Utf8, false),
            Field::new("org", DataType::Utf8, false),
            Field::new("stream", DataType::Utf8, false),
            Field::new("date", DataType::Utf8, false),
            Field::new("file", DataType::Utf8, false),
            Field::new("deleted", DataType::Boolean, false),
            Field::new("flattened", DataType::Boolean, false),
            Field::new("min_ts", DataType::Int64, false),
            Field::new("max_ts", DataType::Int64, false),
            Field::new("records", DataType::Int64, false),
            Field::new("original_size", DataType::Int64, false),
            Field::new("compressed_size", DataType::Int64, false),
            Field::new("index_size", DataType::Int64, false),
            Field::new("created_at", DataType::Int64, false),
            Field::new("updated_at", DataType::Int64, false),
        ]));

        let empty_rb = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(StringArray::from(Vec::<String>::new())),
                Arc::new(StringArray::from(Vec::<String>::new())),
                Arc::new(StringArray::from(Vec::<String>::new())),
                Arc::new(StringArray::from(Vec::<String>::new())),
                Arc::new(StringArray::from(Vec::<String>::new())),
                Arc::new(BooleanArray::from(Vec::<bool>::new())),
                Arc::new(BooleanArray::from(Vec::<bool>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
                Arc::new(Int64Array::from(Vec::<i64>::new())),
            ],
        )
        .unwrap();

        let records = record_batch_to_file_record(empty_rb);
        assert_eq!(records.len(), 0);
    }

    #[test]
    fn test_generate_dump_stream_name() {
        // Test with different stream types
        let result = generate_dump_stream_name(StreamType::Logs, "my_stream");
        assert_eq!(result, "my_stream_logs");

        let result = generate_dump_stream_name(StreamType::Metrics, "metric_stream");
        assert_eq!(result, "metric_stream_metrics");

        let result = generate_dump_stream_name(StreamType::Traces, "trace_stream");
        assert_eq!(result, "trace_stream_traces");

        // Test with stream name containing special characters
        let result = generate_dump_stream_name(StreamType::Logs, "my-stream_2024");
        assert_eq!(result, "my-stream_2024_logs");

        // Test with empty stream name
        let result = generate_dump_stream_name(StreamType::Logs, "");
        assert_eq!(result, "_logs");
    }

    #[test]
    fn test_file_list_schema() {
        // Verify the schema has the expected fields
        let schema = FILE_LIST_SCHEMA.clone();

        assert_eq!(schema.fields().len(), 16);

        // Check key field names and types
        assert_eq!(schema.field(0).name(), "id");
        assert_eq!(schema.field(0).data_type(), &DataType::Int64);

        assert_eq!(schema.field(1).name(), "account");
        assert_eq!(schema.field(1).data_type(), &DataType::Utf8);

        assert_eq!(schema.field(2).name(), "org");
        assert_eq!(schema.field(2).data_type(), &DataType::Utf8);

        assert_eq!(schema.field(3).name(), "stream");
        assert_eq!(schema.field(3).data_type(), &DataType::Utf8);

        assert_eq!(schema.field(6).name(), "deleted");
        assert_eq!(schema.field(6).data_type(), &DataType::Boolean);

        assert_eq!(schema.field(7).name(), "flattened");
        assert_eq!(schema.field(7).data_type(), &DataType::Boolean);
    }

    #[test]
    fn test_record_batch_to_file_record_empty() {
        let schema = FILE_LIST_SCHEMA.clone();
        let empty_batch = RecordBatch::new_empty(schema);

        let records = record_batch_to_file_record(empty_batch);
        assert_eq!(records.len(), 0);
    }

    #[test]
    fn test_record_batch_to_file_record_preserves_order() {
        let rb = create_test_record_batch();
        let records = record_batch_to_file_record(rb);

        // Verify records are in the same order as input
        assert_eq!(records[0].id, 1);
        assert_eq!(records[1].id, 2);
        assert_eq!(records[2].id, 3);

        assert_eq!(records[0].org, "org1");
        assert_eq!(records[1].org, "org2");
        assert_eq!(records[2].org, "org3");
    }

    #[test]
    fn test_record_batch_to_file_record_handles_boolean_fields() {
        let rb = create_test_record_batch();
        let records = record_batch_to_file_record(rb);

        // Verify boolean fields
        assert!(!records[0].deleted);
        assert!(records[1].deleted);
        assert!(!records[2].deleted);

        assert!(records[0].flattened);
        assert!(!records[1].flattened);
        assert!(records[2].flattened);
    }

    #[test]
    fn test_record_batch_to_file_record_handles_timestamps() {
        let rb = create_test_record_batch();
        let records = record_batch_to_file_record(rb);

        // Verify timestamp fields
        assert_eq!(records[0].min_ts, 1000);
        assert_eq!(records[0].max_ts, 1100);
        assert_eq!(records[1].min_ts, 2000);
        assert_eq!(records[1].max_ts, 2100);
        assert_eq!(records[2].min_ts, 3000);
        assert_eq!(records[2].max_ts, 3100);
    }

    #[test]
    fn test_record_batch_to_file_record_handles_sizes() {
        let rb = create_test_record_batch();
        let records = record_batch_to_file_record(rb);

        // Verify size fields
        assert_eq!(records[0].original_size, 1000);
        assert_eq!(records[0].compressed_size, 500);
        assert_eq!(records[0].index_size, 50);

        assert_eq!(records[1].original_size, 2000);
        assert_eq!(records[1].compressed_size, 1000);
        assert_eq!(records[1].index_size, 100);

        assert_eq!(records[2].original_size, 3000);
        assert_eq!(records[2].compressed_size, 1500);
        assert_eq!(records[2].index_size, 150);
    }

    #[test]
    fn test_record_batch_to_file_record_all_fields() {
        let rb = create_test_record_batch();
        let records = record_batch_to_file_record(rb);

        // Comprehensive test of first record
        let first = &records[0];
        assert_eq!(first.id, 1);
        assert_eq!(first.account, "account1");
        assert_eq!(first.org, "org1");
        assert_eq!(first.stream, "stream1");
        assert_eq!(first.date, "2024-01-01");
        assert_eq!(first.file, "file1.parquet");
        assert!(!first.deleted);
        assert!(first.flattened);
        assert_eq!(first.min_ts, 1000);
        assert_eq!(first.max_ts, 1100);
        assert_eq!(first.records, 100);
        assert_eq!(first.original_size, 1000);
        assert_eq!(first.compressed_size, 500);
        assert_eq!(first.index_size, 50);
        assert_eq!(first.created_at, 1000);
        assert_eq!(first.updated_at, 1100);
    }

    #[test]
    fn test_generate_dump_stream_name_with_various_stream_types() {
        // Test all stream types
        let stream_types = vec![
            (StreamType::Logs, "logs"),
            (StreamType::Metrics, "metrics"),
            (StreamType::Traces, "traces"),
        ];

        for (stream_type, suffix) in stream_types {
            let result = generate_dump_stream_name(stream_type, "test");
            assert_eq!(result, format!("test_{}", suffix));
        }
    }

    #[test]
    fn test_file_list_schema_field_ordering() {
        let schema = FILE_LIST_SCHEMA.clone();

        // Verify the exact order of fields
        let expected_fields = vec![
            ("id", DataType::Int64),
            ("account", DataType::Utf8),
            ("org", DataType::Utf8),
            ("stream", DataType::Utf8),
            ("date", DataType::Utf8),
            ("file", DataType::Utf8),
            ("deleted", DataType::Boolean),
            ("flattened", DataType::Boolean),
            ("min_ts", DataType::Int64),
            ("max_ts", DataType::Int64),
            ("records", DataType::Int64),
            ("original_size", DataType::Int64),
            ("compressed_size", DataType::Int64),
            ("index_size", DataType::Int64),
            ("created_at", DataType::Int64),
            ("updated_at", DataType::Int64),
        ];

        for (i, (name, dtype)) in expected_fields.iter().enumerate() {
            assert_eq!(schema.field(i).name(), name);
            assert_eq!(schema.field(i).data_type(), dtype);
        }
    }

    #[test]
    fn test_file_list_schema_nullability() {
        let schema = FILE_LIST_SCHEMA.clone();

        // All fields should be non-nullable
        for field in schema.fields() {
            assert!(
                !field.is_nullable(),
                "Field {} should not be nullable",
                field.name()
            );
        }
    }

    #[test]
    fn test_record_batch_to_file_record_consistency() {
        // Create batch twice and verify results are consistent
        let rb1 = create_test_record_batch();
        let rb2 = create_test_record_batch();

        let records1 = record_batch_to_file_record(rb1);
        let records2 = record_batch_to_file_record(rb2);

        assert_eq!(records1.len(), records2.len());
        for (r1, r2) in records1.iter().zip(records2.iter()) {
            assert_eq!(r1.id, r2.id);
            assert_eq!(r1.account, r2.account);
            assert_eq!(r1.org, r2.org);
            assert_eq!(r1.stream, r2.stream);
        }
    }

    #[test]
    fn test_generate_dump_stream_name_idempotent() {
        // Calling multiple times with same inputs should give same output
        let result1 = generate_dump_stream_name(StreamType::Logs, "test_stream");
        let result2 = generate_dump_stream_name(StreamType::Logs, "test_stream");
        assert_eq!(result1, result2);
    }
}
