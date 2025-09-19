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

use arrow::array::{BooleanArray, Int64Array, RecordBatch, StringArray};
use chrono::Utc;
use config::{
    get_config,
    meta::stream::{ALL_STREAM_TYPES, FileKey, FileListDeleted, StreamStats, StreamType},
    utils::time::hour_micros,
};
use hashbrown::HashMap;
use infra::{
    errors,
    file_list::{FileId, FileRecord, calculate_max_ts_upper_bound},
};
use rayon::slice::ParallelSliceMut;

use crate::service::search::datafusion::exec::{DataFusionContextBuilder, TableBuilder};

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

#[inline]
fn round_down_to_hour(v: i64) -> i64 {
    v - (v % hour_micros(1))
}

async fn get_dump_files_in_range(
    org: &str,
    stream: Option<&str>,
    range: (i64, i64),
    min_id: Option<i64>,
) -> Result<Vec<FileRecord>, errors::Error> {
    let start = round_down_to_hour(range.0);
    let end = round_down_to_hour(range.1) + hour_micros(1);

    let list = infra::file_list::get_entries_in_range(org, stream, start, end, min_id).await?;
    let list = list
        .into_iter()
        .filter(|f| {
            let columns = f.stream.split('/').collect::<Vec<&str>>();
            if columns.len() != 3 {
                return false;
            }
            let stream_type = StreamType::from(columns[1]);
            stream_type == StreamType::Filelist
        })
        .collect();

    Ok(list)
}

fn record_batch_to_file_record(rb: RecordBatch) -> Vec<FileRecord> {
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

async fn inner_exec(
    trace_id: &str,
    partitions: usize,
    dump_files: &[FileKey],
    query: &str,
) -> Result<Vec<RecordBatch>, errors::Error> {
    let schema = super::super::job::FILE_LIST_SCHEMA.clone();

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

async fn exec(
    trace_id: &str,
    partitions: usize,
    dump_files: &[FileKey],
    query: &str,
) -> Result<Vec<RecordBatch>, errors::Error> {
    let trace_id = format!("{trace_id}-file-list-dump");
    let ret = inner_exec(&trace_id, partitions, dump_files, query).await;
    // we always have to clear the files loaded
    super::search::datafusion::storage::file_list::clear(&trace_id);
    ret
}

pub async fn query(
    trace_id: &str,
    org: &str,
    stream: &str,
    stream_type: StreamType,
    range: (i64, i64),
    id_hint: Option<i64>,
) -> Result<Vec<FileRecord>, errors::Error> {
    let cfg = get_config();
    if !cfg.common.file_list_dump_enabled {
        return Ok(vec![]);
    }

    let stream_key = format!(
        "{org}/{}/{org}_{stream_type}_{stream}",
        StreamType::Filelist
    );
    let db_start = std::time::Instant::now();
    let dump_files = get_dump_files_in_range(org, Some(&stream_key), range, id_hint).await?;
    if dump_files.is_empty() {
        return Ok(vec![]);
    }
    let db_time = db_start.elapsed().as_millis();

    let process_start = std::time::Instant::now();
    let dump_files: Vec<_> = dump_files.iter().map(|f| f.into()).collect();
    let max_ts_upper_bound = calculate_max_ts_upper_bound(range.1, stream_type);

    let stream_key = format!("{org}/{stream_type}/{stream}");
    let query = format!(
        "SELECT * FROM file_list WHERE org= '{org}' AND stream = '{stream_key}' AND max_ts >= {} AND max_ts <= {} AND min_ts <= {};",
        range.0, max_ts_upper_bound, range.1
    );

    let t = exec(trace_id, cfg.limit.cpu_num, &dump_files, &query).await?;

    let ret = t
        .into_iter()
        .flat_map(record_batch_to_file_record)
        .collect();
    let process_time = process_start.elapsed().as_millis();

    log::info!(
        "[FILE_LIST_DUMP: {trace_id}] : getting dump files from db took {db_time} ms, searching for entries took {process_time} ms"
    );

    Ok(ret)
}

pub async fn get_ids_in_range(
    trace_id: &str,
    org: &str,
    stream: &str,
    stream_type: StreamType,
    range: (i64, i64),
) -> Result<Vec<FileId>, errors::Error> {
    let cfg = get_config();
    let stream_key = format!(
        "{org}/{}/{org}_{stream_type}_{stream}",
        StreamType::Filelist
    );
    let db_start = std::time::Instant::now();
    let dump_files = get_dump_files_in_range(org, Some(&stream_key), range, None).await?;
    if dump_files.is_empty() {
        return Ok(vec![]);
    }
    let db_time = db_start.elapsed().as_millis();

    let process_start = std::time::Instant::now();
    let dump_files: Vec<_> = dump_files.iter().map(|f| f.into()).collect();
    let max_ts_upper_bound = calculate_max_ts_upper_bound(range.1, stream_type);

    let stream_key = format!("{org}/{stream_type}/{stream}");

    let query = format!(
        "SELECT id,records,original_size FROM file_list WHERE org= '{org}' AND stream = '{stream_key}' AND max_ts >= {} AND max_ts <= {} AND min_ts <= {};",
        range.0, max_ts_upper_bound, range.1
    );

    let t = exec(trace_id, cfg.limit.cpu_num, &dump_files, &query).await?;

    let ret = t.into_iter().flat_map(record_batch_to_file_id).collect();
    let process_time = process_start.elapsed().as_millis();

    log::info!(
        "[FILE_LIST_DUMP: {trace_id}] : getting dump files from db took {db_time} ms, searching for entries took {process_time} ms"
    );

    Ok(ret)
}

async fn move_and_delete(
    org: &str,
    stream_type: StreamType,
    stream: &str,
    range: (i64, i64),
) -> Result<(), errors::Error> {
    let stream_key = format!(
        "{org}/{}/{org}_{stream_type}_{stream}",
        StreamType::Filelist
    );
    let list =
        infra::file_list::get_entries_in_range(org, Some(&stream_key), range.0, range.1, None)
            .await?;

    // for deleting dump files themselves, we explicitly make sure that
    // the min and max ts both are in the range given, so to not accidentally delete
    // dump files which may have entries outside the range
    let dump_files: Vec<_> = get_dump_files_in_range(org, Some(stream), range, None)
        .await?
        .into_iter()
        .filter(|f| f.min_ts >= range.0 && f.max_ts <= range.1)
        .collect();
    let del_items: Vec<_> = list
        .iter()
        .chain(dump_files.iter())
        .map(|f| FileListDeleted {
            id: 0,
            account: f.account.to_string(),
            file: format!("files/{}/{}/{}", stream_key, f.date, f.file),
            index_file: false,
            flattened: false,
        })
        .collect();

    let mut inserted_into_deleted = false;

    for _ in 0..5 {
        if !inserted_into_deleted
            && let Err(e) =
                infra::file_list::batch_add_deleted(org, Utc::now().timestamp_micros(), &del_items)
                    .await
        {
            log::error!("[FILE_LIST_DUMP] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        inserted_into_deleted = true;
        let items: Vec<_> = list
            .iter()
            .chain(dump_files.iter())
            .map(|f| {
                let mut f = FileKey::from(f);
                f.deleted = true;
                f.segment_ids = None;
                f
            })
            .collect();
        if let Err(e) = infra::file_list::batch_process(&items).await {
            log::error!("[FILE_LIST_DUMP] batch_delete to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        break;
    }

    Ok(())
}

pub async fn delete_all_for_stream(
    org: &str,
    stream_type: StreamType,
    stream: &str,
) -> Result<(), errors::Error> {
    move_and_delete(org, stream_type, stream, (0, Utc::now().timestamp_micros())).await
}

pub async fn delete_in_time_range(
    org: &str,
    stream_type: StreamType,
    stream: &str,
    range: (i64, i64),
) -> Result<(), errors::Error> {
    move_and_delete(org, stream_type, stream, range).await
}

// we never store deleted file in dump, so we never have to consider deleted in this
pub async fn stats(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
    pk_value: Option<(i64, i64)>,
) -> Result<Vec<(String, StreamStats)>, errors::Error> {
    let stream_types = match stream_type {
        Some(stype) => vec![stype],
        None => ALL_STREAM_TYPES.to_vec(),
    };

    let mut ret = HashMap::new();
    for stream_type in stream_types {
        if stream_type == StreamType::Filelist {
            continue;
        }
        let stream_names = match stream_name {
            Some(name) => vec![name.to_string()],
            None => crate::service::db::schema::list_streams_from_cache(org_id, stream_type).await,
        };
        for stream_name in stream_names {
            let stats = stats_inner(org_id, stream_type, &stream_name, pk_value).await?;
            ret.extend(stats);
            log::debug!(
                "[FILE_LIST_DUMP] stats for {org_id}/{stream_type}/{stream_name}: pk: {pk_value:?}",
            );
        }
    }
    Ok(ret.into_iter().collect())
}

async fn stats_inner(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    pk_value: Option<(i64, i64)>,
) -> Result<Vec<(String, StreamStats)>, errors::Error> {
    let cfg = get_config();

    // in case of dual write, we have no way of de-duping with ids for stats.
    // so we simply do not consider dumped files when dual-write is enabled.
    if cfg.common.file_list_dump_dual_write {
        return Ok(vec![]);
    }

    // we can be sure that file with id x will always be dumped in a dump file with id > x
    // because file dump is taken after original file entry, and id always increases
    let min_id = match pk_value {
        Some((min, _)) => Some(min),
        _ => None,
    };

    let stream_key = format!(
        "{org_id}/{}/{org_id}_{stream_type}_{stream_name}",
        StreamType::Filelist
    );
    let dump_files = get_dump_files_in_range(
        org_id,
        Some(&stream_key),
        (0, Utc::now().timestamp_micros()),
        min_id,
    )
    .await?;

    if dump_files.is_empty() {
        return Ok(vec![]);
    }

    let dump_files: Vec<_> = dump_files.iter().map(|f| f.into()).collect();

    let field = "stream";
    let value = format!("{org_id}/{stream_type}/{stream_name}");
    let sql = format!(
        r#"
SELECT stream, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts, COUNT(*)::BIGINT AS file_num, 
SUM(records)::BIGINT AS records, SUM(original_size)::BIGINT AS original_size, SUM(compressed_size)::BIGINT AS compressed_size, SUM(index_size)::BIGINT AS index_size
FROM file_list 
WHERE {field} = '{value}'
        "#
    );
    let sql = match pk_value {
        None => format!("{sql} GROUP BY stream"),
        Some((0, 0)) => format!("{sql} GROUP BY stream"),
        Some((min, max)) => {
            format!("{sql} AND id > {min} AND id <= {max} GROUP BY stream")
        }
    };

    let task_id = tokio::task::try_id()
        .map(|id| id.to_string())
        .unwrap_or_else(|| rand::random::<u64>().to_string());
    let fake_trace_id = format!("stats_on_dump-{task_id}");
    let t = exec(&fake_trace_id, cfg.limit.cpu_num, &dump_files, &sql).await?;
    let ret = t.into_iter().flat_map(record_batch_to_stats).collect();
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

    #[test]
    fn test_round_down_to_hour_basic() {
        // Test basic hour rounding
        let hour_micros = 3_600_000_000i64; // 1 hour in microseconds

        // Test exact hour boundary
        let timestamp = hour_micros * 5; // 5 hours
        assert_eq!(round_down_to_hour(timestamp), timestamp);

        // Test within hour - should round down
        let timestamp = hour_micros * 5 + 1_800_000_000; // 5.5 hours
        assert_eq!(round_down_to_hour(timestamp), hour_micros * 5);

        // Test just before next hour
        let timestamp = hour_micros * 3 + hour_micros - 1; // Almost 4 hours
        assert_eq!(round_down_to_hour(timestamp), hour_micros * 3);
    }

    #[test]
    fn test_round_down_to_hour_zero() {
        // Test zero timestamp
        assert_eq!(round_down_to_hour(0), 0);

        // Test small value less than an hour
        let small_timestamp = 1_800_000_000i64; // 30 minutes
        assert_eq!(round_down_to_hour(small_timestamp), 0);
    }

    #[test]
    fn test_round_down_to_hour_negative() {
        // Test negative timestamps (edge case)
        let hour_micros = 3_600_000_000i64;
        let negative_timestamp = -hour_micros / 2; // -30 minutes = -1,800,000,000

        // For negative_timestamp = -1,800,000,000
        // negative_timestamp % hour_micros = -1,800,000,000 % 3,600,000,000 = -1,800,000,000 (in
        // Rust) So result = -1,800,000,000 - (-1,800,000,000) = 0
        let result = round_down_to_hour(negative_timestamp);

        // For negative values, the "floor" behavior is different in Rust's % operator
        // The function actually rounds toward zero, not down for negatives
        assert_eq!(result, 0); // Should be 0 for this specific case
    }

    #[test]
    fn test_round_down_to_hour_large_values() {
        // Test with large timestamps (years in the future)
        let hour_micros = 3_600_000_000i64;
        let large_timestamp = hour_micros * 10000 + 1_500_000_000; // 10000.25 hours

        let result = round_down_to_hour(large_timestamp);
        assert_eq!(result, hour_micros * 10000);
        assert!(result <= large_timestamp);
        assert!(large_timestamp - result < hour_micros);
    }

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
            ],
        )
        .unwrap();

        let records = record_batch_to_file_record(empty_rb);
        assert_eq!(records.len(), 0);
    }

    #[test]
    fn test_time_boundary_calculations() {
        let hour_micros = 3_600_000_000i64;

        // Test range calculations as used in get_dump_files_in_range
        let range = (
            hour_micros * 2 + 1_800_000_000,
            hour_micros * 5 + 600_000_000,
        ); // 2.5 to 5.1 hours
        let start = round_down_to_hour(range.0);
        let end = round_down_to_hour(range.1) + hour_micros;

        // Start should be rounded down to 2 hours
        assert_eq!(start, hour_micros * 2);
        // End should be rounded down to 5 hours then add 1 hour = 6 hours
        assert_eq!(end, hour_micros * 6);

        // Verify range covers the original timestamps
        assert!(start <= range.0);
        assert!(end > range.1);
    }
}
