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

use std::sync::Arc;

use config::{
    ider,
    meta::stream::{FileMeta, StreamPartition, StreamType},
    utils::{
        arrow::record_batches_to_json_rows, json::get_string_value, parquet::new_parquet_writer,
        record_batch_ext::convert_json_to_record_batch,
    },
    FILE_EXT_PARQUET,
};
use hashbrown::HashMap;
use infra::storage;

use crate::common::utils::stream::populate_file_meta;

fn generate_index_file_name_from_compacted_file(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    compacted_file_name: &str,
    prefix: &str,
) -> String {
    // eg: files/default/logs/quickstart1/2024/02/16/16/7164299619311026293.parquet
    let file_columns = compacted_file_name.split('/').collect::<Vec<&str>>();
    let stream_key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let file_date = format!(
        "{}/{}/{}/{}",
        file_columns[4], file_columns[5], file_columns[6], file_columns[7]
    );
    let file_name = ider::generate();
    format!("files/{stream_key}/{file_date}/{prefix}/{file_name}{FILE_EXT_PARQUET}")
}

pub(crate) async fn write_parquet_index_to_disk(
    batches: Vec<arrow::record_batch::RecordBatch>,
    file_size: u64,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    file_name: &str,
    caller: &str,
) -> Result<Vec<(String, FileMeta)>, anyhow::Error> {
    let schema = if let Some(first_batch) = batches.first() {
        first_batch.schema()
    } else {
        return Err(anyhow::anyhow!("No record batches found"));
    };
    let partition = StreamPartition::new_prefix("term");

    let json_rows = record_batches_to_json_rows(&batches.iter().collect::<Vec<_>>())?;

    let mut partition_buf: HashMap<String, Vec<Arc<serde_json::Value>>> = HashMap::new();
    for row in json_rows {
        let val = match row.get("term") {
            Some(v) => get_string_value(v),
            None => "null".to_string(),
        };
        let prefix = partition.get_partition_key(&val);
        let batch = partition_buf.entry(prefix).or_insert_with(|| Vec::new());
        let entry = serde_json::Value::Object(row);
        batch.push(Arc::new(entry));
    }
    let mut ret = Vec::new();

    for (prefix, records) in partition_buf.into_iter() {
        // write metadata
        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: file_size as i64,
            compressed_size: 0,
            flattened: false,
        };
        let batch = convert_json_to_record_batch(&schema, &records)?;
        populate_file_meta(
            schema.clone(),
            vec![vec![batch.clone()]],
            &mut file_meta,
            Some("min_ts"),
            Some("max_ts"),
        )
        .await?;

        // write parquet file
        let mut buf_parquet = Vec::new();
        let mut writer = new_parquet_writer(&mut buf_parquet, &schema, &[], &file_meta);
        writer.write(&batch).await?;
        writer.close().await?;
        file_meta.compressed_size = buf_parquet.len() as i64;

        let new_idx_file_name = generate_index_file_name_from_compacted_file(
            org_id,
            stream_type,
            stream_name,
            file_name,
            &prefix,
        );
        log::info!(
            "[JOB] IDX: write_to_disk: {}/{}/{} {} {} {}",
            org_id,
            stream_name,
            stream_type,
            new_idx_file_name,
            file_name,
            caller,
        );

        let store_file_name = new_idx_file_name.clone();
        match storage::put(&store_file_name, bytes::Bytes::from(buf_parquet)).await {
            Ok(_) => {
                log::info!("[JOB] disk file upload succeeded: {}", &new_idx_file_name);
                ret.push((new_idx_file_name, file_meta));
            }
            Err(err) => {
                log::error!("[JOB] disk file upload error: {:?}", err);
                return Err(anyhow::anyhow!(err));
            }
        }
    }
    Ok(ret)
}
