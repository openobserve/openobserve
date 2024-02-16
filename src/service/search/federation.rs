// Copyright 2023 Zinc Labs Inc.
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

use std::{sync::Arc, time::Duration};

use ::datafusion::arrow::record_batch::RecordBatch;
use arrow::ipc::reader::StreamReader;
use config::utils::json;
use hashbrown::HashMap;
use infra::errors::ErrorCodes;

use crate::{
    common::meta::search,
    handler::grpc::cluster_rpc,
    service::search::{datafusion::exec, ipc::writer::StreamWriter},
};

// Function to serialize a RecordBatch into a Vec<u8>
fn serialize_record_batch(batch: &RecordBatch) -> arrow::error::Result<Vec<u8>> {
    let schema = batch.schema();
    let mut writer = Vec::new();
    {
        let mut ipc_writer = StreamWriter::try_new(&mut writer, &schema)?;
        ipc_writer.write(batch)?;
        ipc_writer.finish()?;
    }
    Ok(writer)
}

pub fn serialize_response(
    data: HashMap<String, Vec<RecordBatch>>,
    took_wait: usize,
) -> Result<Vec<u8>, String> {
    let mut serialized_data = HashMap::new();

    for (key, batches) in data {
        let mut serialized_batches = Vec::new();
        for batch in batches {
            let serialized_batch = serialize_record_batch(&batch).map_err(|e| e.to_string())?;
            // Encode the serialized RecordBatch as base64 to embed in JSON
            let base64_encoded =
                config::utils::base64::encode_url_safe_no_padding(&serialized_batch);
            serialized_batches.push(base64_encoded);
        }
        serialized_data.insert(key, serialized_batches);
    }

    // Serialize the entire structure to JSON
    let full_structure = serde_json::json!({
        "data": serialized_data,
        "took_wait": took_wait
    });

    serde_json::to_vec(&full_structure).map_err(|e| e.to_string()) // Convert serde_json error to String
}

pub fn de_serialize_response(data: Vec<u8>) -> Result<search::SearchFollowerResponse, String> {
    let json: json::Value = json::from_slice(&data).map_err(|e| e.to_string())?;
    let took_wait = json["took_wait"]
        .as_u64()
        .ok_or("Count missing or invalid")? as usize;

    let mut deserialized_data: HashMap<String, Vec<RecordBatch>> = HashMap::new();

    let data_map = json["data"].as_object().ok_or("Data missing or invalid")?;
    for (key, value) in data_map {
        let mut batches = Vec::new();
        for encoded_batch in value.as_array().ok_or("Batches missing or invalid")? {
            let ipc_data = config::utils::base64::decode_url_safe_no_padding(
                encoded_batch
                    .as_str()
                    .ok_or("Batch data missing or invalid")?,
            )
            .map_err(|e| e.to_string())?;

            let reader = std::io::Cursor::new(ipc_data);
            let reader = StreamReader::try_new(reader, None).map_err(|e| e.to_string())?;

            for read_result in reader {
                let record_batch = read_result.unwrap();
                if record_batch.num_rows() > 0 {
                    batches.push(record_batch)
                }
            }
        }
        deserialized_data.insert(key.clone(), batches);
    }

    Ok(search::SearchFollowerResponse {
        data: deserialized_data,
        took_wait,
    })
}

pub async fn make_inter_cluster_req(
    req: &cluster_rpc::SearchRequest,
    token: &str,
    url: &str,
    timeout: u64,
) -> Result<search::SearchFollowerResponse, infra::errors::Error> {
    let client = reqwest::Client::new();
    let req = serde_json::to_string(req).unwrap();
    println!("make_inter_cluster_req req: {}", req);
    println!("url : {}", url);
    println!("url : {}", token);
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "Authorization",
        reqwest::header::HeaderValue::from_str(token).unwrap(),
    );
    headers.insert(
        "Content-type",
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    let req_client = client
        .post(url)
        .headers(headers)
        .timeout(Duration::from_secs(timeout));

    match req_client.body(req).send().await {
        Ok(res) => {
            log::info!("make_inter_cluster_req res: {:?}", res);
            de_serialize_response(res.bytes().await.unwrap().to_vec()).map_err(|e| {
                infra::errors::Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string()))
            })
        }
        Err(err) => {
            log::error!("make_inter_cluster_req error: {}", err);
            Err(infra::errors::Error::ErrorCode(
                ErrorCodes::ServerInternalError(err.to_string()),
            ))
        }
    }
}

pub async fn merge_cluster_responses(
    responses: Vec<search::SearchFollowerResponse>,
    req: &cluster_rpc::SearchRequest,
) -> Result<hashbrown::HashMap<String, Vec<arrow::record_batch::RecordBatch>>, infra::errors::Error>
{
    // merge multiple Cluster data
    // let mut scan_stats = ScanStats::new();
    let meta = super::sql::Sql::new(&req).await?;
    let sql = Arc::new(meta);
    let mut final_data = HashMap::new();
    for response in responses {
        for (name, batches) in response.data {
            let val = final_data.entry(name.clone()).or_insert_with(|| vec![]);
            val.extend(batches);
        }
    }

    // merge all batches
    let mut merge_batches = hashbrown::HashMap::new();
    for (name, batch) in final_data {
        let merge_sql = if name == "query" {
            sql.origin_sql.clone()
        } else {
            sql.aggs
                .get(name.strip_prefix("agg_").unwrap())
                .unwrap()
                .0
                .clone()
        };
        let batch = match exec::merge(
            &sql.org_id,
            sql.meta.offset,
            sql.meta.limit,
            &merge_sql,
            &batch,
        )
        .await
        {
            Ok(res) => res,
            Err(err) => {
                // search done, release lock
                return Err(infra::errors::Error::ErrorCode(
                    ErrorCodes::ServerInternalError(err.to_string()),
                ));
            }
        };
        merge_batches.insert(name, batch);
    }

    Ok(merge_batches)
}
