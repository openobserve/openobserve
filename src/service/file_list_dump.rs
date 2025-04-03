use arrow::array::{BooleanArray, Int64Array, RecordBatch, StringArray};
use config::meta::stream::{FileKey, StreamType};
use hashbrown::HashMap;
use infra::{
    errors,
    file_list::{FileRecord, calculate_max_ts_upper_bound},
    table::{self, file_list_dump::FileListDump},
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
) -> Result<Vec<FileListDump>, errors::DbError> {
    let start = round_down_to_hour(range.0);
    let end = round_down_to_hour(range.1) + HOUR_IN_MILI * 1000;

    let list = table::file_list_dump::get_all_in_range(org, stream, start, end).await?;

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
    let stream_key = format!("{org}/{stream_type}/{stream}");
    let dump_files = get_dump_files_in_range(org, &stream_key, range).await?;

    let dir_name = super::super::job::FILE_LIST_CACHE_DIR_NAME;
    let dump_files: Vec<_> = dump_files
        .into_iter()
        .map(|f| FileKey {
            key: format!("files/{org}/{}/{}/{}", dir_name, stream_key, f.file),
            meta: f.file_meta(),
            deleted: false,
            segment_ids: None,
        })
        .collect();

    let schema = super::super::job::FILE_LIST_SCHEMA.clone();

    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: config::meta::search::StorageType::Memory,
        work_group: None,
        target_partitions: 16,
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

pub async fn delete_all_for_stream(org: &str, stream: &str) -> Result<(), errors::Error> {
    infra::table::file_list_dump::delete_all_for_stream(org, stream).await
}

pub async fn delete_in_time_range(
    org: &str,
    stream: &str,
    range: (i64, i64),
) -> Result<(), errors::Error> {
    infra::table::file_list_dump::delete_in_time_range(org, stream, range).await
}
