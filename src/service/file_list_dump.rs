use arrow::array::{BooleanArray, Int64Array, RecordBatch, StringArray};
use chrono::Utc;
use config::{
    get_config,
    meta::stream::{FileKey, FileListDeleted, StreamType},
};
use hashbrown::HashMap;
use infra::{
    errors,
    file_list::{FileRecord, calculate_max_ts_upper_bound},
};

use super::search::datafusion::exec::prepare_datafusion_context;
use crate::service::search::datafusion::exec::create_parquet_table;

const HOUR_IN_MILI: i64 = 3600 * 1000;

#[inline]
fn round_down_to_hour(v: i64) -> i64 {
    v - (v % HOUR_IN_MILI * 1000)
}

async fn get_dump_files_in_range(
    org: &str,
    stream: &str,
    range: (i64, i64),
) -> Result<Vec<FileRecord>, errors::Error> {
    let start = round_down_to_hour(range.0);
    let end = round_down_to_hour(range.1) + HOUR_IN_MILI * 1000;

    let list = infra::file_list::get_entries_in_range(org, stream, start, end).await?;

    Ok(list)
}

fn record_batch_to_file_record(rb: RecordBatch) -> Vec<FileRecord> {
    let id_col = rb
        .column_by_name("id")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    let org_col = rb
        .column_by_name("org")
        .unwrap()
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();
    let stream_col = rb
        .column_by_name("stream")
        .unwrap()
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();
    let date_col = rb
        .column_by_name("date")
        .unwrap()
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();
    let file_col = rb
        .column_by_name("file")
        .unwrap()
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap();
    let deleted_col = rb
        .column_by_name("deleted")
        .unwrap()
        .as_any()
        .downcast_ref::<BooleanArray>()
        .unwrap();
    let flattened_col = rb
        .column_by_name("flattened")
        .unwrap()
        .as_any()
        .downcast_ref::<BooleanArray>()
        .unwrap();
    let min_ts_col = rb
        .column_by_name("min_ts")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    let max_ts_col = rb
        .column_by_name("max_ts")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    let records_col = rb
        .column_by_name("records")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    let original_size_col = rb
        .column_by_name("original_size")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    let compressed_size_col = rb
        .column_by_name("compressed_size")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
    let index_size_col = rb
        .column_by_name("index_size")
        .unwrap()
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap();
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
    ret
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
    let dump_files = get_dump_files_in_range(org, &stream_key, range).await?;
    let dump_files: Vec<_> = dump_files
        .into_iter()
        .map(|f| FileKey {
            key: format!("files/{}/{}/{}", stream_key, f.date, f.file),
            meta: (&f).into(),
            deleted: false,
            segment_ids: None,
        })
        .collect();

    let schema = super::super::job::FILE_LIST_SCHEMA.clone();

    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: config::meta::search::StorageType::Memory,
        work_group: None,
        target_partitions: cfg.limit.cpu_num,
    };
    let tbl = create_parquet_table(
        &session,
        schema.clone(),
        &dump_files,
        HashMap::new(),
        false,
        None,
        None,
        vec![],
        false,
    )
    .await?;

    let max_ts_upper_bound = calculate_max_ts_upper_bound(range.1, stream_type);

    let stream_key = format!("{org}/{stream_type}/{stream}");
    let query = format!(
        "SELECT * FROM file_list WHERE org= '{org}' AND stream = '{stream_key}' AND max_ts >= {} AND max_ts <= {} AND min_ts <= {};",
        range.0, max_ts_upper_bound, range.1
    );

    let ctx = prepare_datafusion_context(None, vec![], false, 16).await?;
    ctx.register_table("file_list", tbl).unwrap();
    let df = ctx.sql(&query).await.unwrap();
    let t = df.collect().await.unwrap();
    let ret = t
        .into_iter()
        .flat_map(|rb| record_batch_to_file_record(rb))
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
    let list = infra::file_list::get_entries_in_range(org, &stream_key, range.0, range.1).await?;
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
