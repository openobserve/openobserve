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
    meta::stream::{FileKey, FileListDeleted, StreamStats, StreamType},
};
use hashbrown::HashMap;
use infra::{
    errors,
    file_list::{FileRecord, calculate_max_ts_upper_bound},
};
use rayon::slice::ParallelSliceMut;

use super::search::datafusion::exec::prepare_datafusion_context;
use crate::service::search::datafusion::exec::create_parquet_table;

const HOUR_IN_MICRO: i64 = 3600 * 1000 * 1000;

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
    v - (v % HOUR_IN_MICRO)
}

async fn get_dump_files_in_range(
    org: &str,
    stream: Option<&str>,
    range: (i64, i64),
) -> Result<Vec<FileRecord>, errors::Error> {
    let start = round_down_to_hour(range.0);
    let end = round_down_to_hour(range.1) + HOUR_IN_MICRO;

    let list = infra::file_list::get_entries_in_range(org, stream, start, end).await?;

    Ok(list)
}

fn record_batch_to_file_record(rb: RecordBatch) -> Vec<FileRecord> {
    get_col!(id_col, "id", Int64Array, rb);
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

async fn exec(
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
    let tbl = create_parquet_table(
        &session,
        schema.clone(),
        dump_files,
        HashMap::new(),
        false,
        None,
        None,
        vec![],
        false,
    )
    .await?;

    let ctx = prepare_datafusion_context(None, vec![], false, 16).await?;
    ctx.register_table("file_list", tbl).unwrap();
    let df = ctx.sql(query).await.unwrap();
    let ret = df.collect().await.unwrap();

    Ok(ret)
}

pub async fn get_file_list_entries_in_range(
    trace_id: &str,
    org: &str,
    stream: &str,
    stream_type: StreamType,
    range: (i64, i64),
) -> Result<Vec<FileRecord>, errors::Error> {
    let cfg = get_config();
    let stream_key = format!(
        "{org}/{}/{org}_{stream_type}_{stream}",
        StreamType::Filelist
    );
    let dump_files = get_dump_files_in_range(org, Some(&stream_key), range).await?;
    let dump_files: Vec<_> = dump_files
        .into_iter()
        .map(|f| FileKey {
            key: format!("files/{}/{}/{}", stream_key, f.date, f.file),
            meta: (&f).into(),
            deleted: false,
            segment_ids: None,
        })
        .collect();
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
        infra::file_list::get_entries_in_range(org, Some(&stream_key), range.0, range.1).await?;
    let del_items: Vec<_> = list
        .into_iter()
        .map(|f| FileListDeleted {
            file: format!("files/{}/{}/{}", stream_key, f.date, f.file),
            index_file: false,
            flattened: false,
        })
        .collect();

    let mut inserted_into_deleted = false;

    for _ in 0..5 {
        if !inserted_into_deleted {
            if let Err(e) =
                infra::file_list::batch_add_deleted(org, Utc::now().timestamp_micros(), &del_items)
                    .await
            {
                log::error!(
                    "[FILE_LIST_DUMP] batch_add_deleted to db failed, retrying: {}",
                    e
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
        }
        inserted_into_deleted = true;
        let items: Vec<_> = del_items.iter().map(|item| item.file.clone()).collect();
        if let Err(e) = infra::file_list::batch_remove(&items).await {
            log::error!(
                "[FILE_LIST_DUMP] batch_delete to db failed, retrying: {}",
                e
            );
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

pub async fn stats(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
    pk_value: Option<(i64, i64)>,
    deleted: bool,
) -> Result<Vec<(String, StreamStats)>, errors::Error> {
    let cfg = get_config();

    let (field, value, dump_files) = match (stream_type, stream_name) {
        (Some(stype), Some(sname)) => {
            let stream_key = format!("{org_id}/{}/{org_id}_{stype}_{sname}", StreamType::Filelist);
            let dump_files = get_dump_files_in_range(
                org_id,
                Some(&stream_key),
                (0, Utc::now().timestamp_micros()),
            )
            .await?;
            (
                "stream",
                format!(
                    "{}/{}/{}",
                    org_id,
                    stream_type.unwrap(),
                    stream_name.unwrap()
                ),
                dump_files,
            )
        }
        _ => {
            let dump_files =
                get_dump_files_in_range(org_id, None, (0, Utc::now().timestamp_micros())).await?;
            ("org", org_id.to_string(), dump_files)
        }
    };

    let dump_files: Vec<_> = dump_files
        .into_iter()
        .filter(|f| {
            f.stream
                .contains(&format!("{org_id}/{}", StreamType::Filelist))
        })
        .map(|f| FileKey {
            key: format!("files/{}/{}/{}", f.stream, f.date, f.file),
            meta: (&f).into(),
            deleted: false,
            segment_ids: None,
        })
        .collect();

    let mut sql = format!(
        r#"
SELECT stream, MIN(min_ts) AS min_ts, MAX(max_ts) AS max_ts, COUNT(*)::BIGINT AS file_num, 
SUM(records)::BIGINT AS records, SUM(original_size)::BIGINT AS original_size, SUM(compressed_size)::BIGINT AS compressed_size, SUM(index_size)::BIGINT AS index_size
FROM file_list 
WHERE {field} = '{value}'
        "#
    );
    if deleted {
        sql = format!("{} AND deleted IS TRUE", sql);
    }
    let sql = match pk_value {
        None => format!("{} GROUP BY stream", sql),
        Some((0, 0)) => format!("{} GROUP BY stream", sql),
        Some((min, max)) => {
            if deleted {
                format!("{} AND id <= {} GROUP BY stream", sql, max)
            } else {
                format!("{} AND id > {} AND id <= {} GROUP BY stream", sql, min, max)
            }
        }
    };

    let task_id = tokio::task::try_id()
        .map(|id| id.to_string())
        .unwrap_or_else(|| rand::random::<u64>().to_string());
    let fake_trace_id = format!("stats_on_dump-{}", task_id);
    let t = exec(&fake_trace_id, cfg.limit.cpu_num, &dump_files, &sql).await?;
    // we have to do this manually here, otherwise it will not get cleared.
    super::search::datafusion::storage::file_list::clear(&fake_trace_id);
    let ret = t.into_iter().flat_map(record_batch_to_stats).collect();
    Ok(ret)
}
