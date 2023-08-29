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

use actix_web::HttpResponse;
use datafusion::arrow::{datatypes::Schema, json as arrow_json, record_batch::RecordBatch};
use datafusion::{datasource::MemTable, prelude::SessionContext};
use std::io::{Error, ErrorKind};
use std::sync::Arc;

use crate::common::infra::config::{CONFIG, FILE_EXT_JSON};
use crate::common::meta::{common::FileMeta, StreamType};
use crate::common::utils::json;

pub const SQL_FULL_TEXT_SEARCH_FIELDS: [&str; 5] = ["log", "message", "msg", "content", "data"];

#[inline(always)]
pub fn stream_type_query_param_error() -> Result<HttpResponse, Error> {
    /*  return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
        http::StatusCode::BAD_REQUEST.into(),
        Some("only 'type' query param with value 'logs' or 'metrics' allowed".to_string()),
    ))); */

    Err(Error::new(
        ErrorKind::Other,
        "only 'type' query param with value 'logs' or 'metrics' allowed",
    ))
}

#[inline(always)]
pub fn increment_stream_file_num_v1(file_name: &str) -> u32 {
    let last_file_suffix_stream = &file_name.rfind('_').unwrap() + 1;
    let last_file_suffix =
        &file_name[last_file_suffix_stream..file_name.len() - FILE_EXT_JSON.len()];
    last_file_suffix.parse::<u32>().unwrap() + 1
}

#[inline(always)]
pub fn get_stream_file_num_v1(file_name: &str) -> u32 {
    let last_file_suffix_stream = &file_name.rfind('_').unwrap() + 1;
    let last_file_suffix =
        &file_name[last_file_suffix_stream..file_name.len() - FILE_EXT_JSON.len()];
    last_file_suffix.parse::<u32>().unwrap()
}

#[inline(always)]
pub fn get_file_name_v1(org_id: &str, stream_name: &str, suffix: u32) -> String {
    // creates file name like "./data/openobserve/olympics/olympics#2022#09#13#13_1.json"
    format!(
        "{}{}/{}/{}/{}_{}{}",
        &CONFIG.common.data_wal_dir,
        org_id,
        StreamType::Logs,
        stream_name,
        stream_name,
        suffix,
        FILE_EXT_JSON
    )
}

pub async fn populate_file_meta(
    schema: Arc<Schema>,
    batch: Vec<Vec<RecordBatch>>,
    file_meta: &mut FileMeta,
) -> Result<(), anyhow::Error> {
    if schema.fields().is_empty() || batch.is_empty() {
        return Ok(());
    }
    let ctx = SessionContext::new();
    let provider = MemTable::try_new(schema, batch)?;
    ctx.register_table("temp", Arc::new(provider))?;

    let sql = format!(
        "SELECT min({0}) as min, max({0}) as max, count({0}) as num_records FROM temp;",
        CONFIG.common.column_timestamp
    );
    let df = ctx.sql(sql.as_str()).await?;
    let batches = df.collect().await?;
    let batches_ref: Vec<&RecordBatch> = batches.iter().collect();
    let json_rows = arrow_json::writer::record_batches_to_json_rows(&batches_ref)?;
    let mut result: Vec<json::Value> = json_rows.into_iter().map(json::Value::Object).collect();
    if result.is_empty() {
        return Ok(());
    }
    let record = result.pop().expect("No record found");
    if record.is_null() {
        return Ok(());
    }
    file_meta.min_ts = record
        .get("min")
        .expect("No field found: min")
        .as_i64()
        .expect("No value found: min");
    file_meta.max_ts = record
        .get("max")
        .expect("No field found: max")
        .as_i64()
        .expect("No value found: max");
    file_meta.records = record
        .get("num_records")
        .expect("No field found: num_records")
        .as_i64()
        .expect("No value found: num_records");
    Ok(())
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::array::{Int64Array, StringArray};
    use datafusion::arrow::datatypes::{DataType, Field};

    use super::*;

    #[test]
    fn test_increment_stream_file_num_v1() {
        let suffix_nums = vec![1, 9, 11, 78, 100, 234, 546];

        for i in 0..suffix_nums.len() {
            let suffix = increment_stream_file_num_v1(&format!(
                "./data/openobserve/WAL/nexus/logs/olympics/1663064862606912_{}.json",
                suffix_nums[i]
            ));
            assert_eq!(suffix, suffix_nums[i] + 1);
        }
    }

    #[test]
    fn test_get_file_name_v1() {
        let file_key = get_file_name_v1(&"nexus".to_owned(), &"Olympics".to_owned(), 2);
        assert!(file_key
            .as_str()
            .ends_with("/wal/nexus/logs/Olympics/Olympics_2.json"));
    }

    #[test]
    fn test_get_stream_file_num_v1() {
        let file_key =
            get_stream_file_num_v1("./data/openobserve/WAL/logs/nexus/Olympics/Olympics_2.json");
        assert_eq!(file_key, 2);
    }

    #[actix_web::test]
    async fn test_populate_file_meta() {
        // define a schema.
        let val: i64 = 1666093521151350;
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c", "d"])),
                Arc::new(Int64Array::from(vec![1, 2, 1, 2])),
                Arc::new(Int64Array::from(vec![val - 100, val - 10, val - 90, val])),
            ],
        )
        .unwrap();
        //let file_name = path.file_name();
        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 1000,
            compressed_size: 700,
        };
        populate_file_meta(schema, vec![vec![batch]], &mut file_meta)
            .await
            .unwrap();
        assert_eq!(file_meta.records, 4);
        assert_eq!(file_meta.min_ts, val - 100);
    }

    #[test]
    fn test_stream_type_query_param_error() {
        let res = stream_type_query_param_error();
        assert!(res.is_err());
    }
}
