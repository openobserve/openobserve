// Copyright 2022 Zinc Labs Inc. and Contributors
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

use aws_sdk_dynamodb::{
    operation::query::QueryOutput,
    types::{AttributeValue, DeleteRequest, PutRequest, Select, WriteRequest},
};
use chrono::{DateTime, Duration, TimeZone, Utc};
use std::collections::HashMap;
use tokio_stream::StreamExt;

use crate::common::{
    infra::{config::CONFIG, db::dynamo_db::DYNAMO_DB_CLIENT},
    meta::{
        common::{FileKey, FileMeta},
        StreamType,
    },
};

pub async fn write_file(file_key: &FileKey) -> Result<(), anyhow::Error> {
    let file_columns = file_key.key.splitn(5, '/').collect::<Vec<&str>>();
    match DYNAMO_DB_CLIENT
        .get()
        .await
        .put_item()
        .table_name(&CONFIG.common.dynamo_file_list_table)
        .item(
            "stream",
            AttributeValue::S(format!(
                "{}/{}/{}",
                file_columns[1], file_columns[2], file_columns[3]
            )),
        )
        .item("file", AttributeValue::S(file_columns[4].to_owned()))
        .item("deleted", AttributeValue::Bool(file_key.deleted))
        .item(
            "min_ts",
            AttributeValue::N(file_key.meta.min_ts.to_string()),
        )
        .item(
            "max_ts",
            AttributeValue::N(file_key.meta.max_ts.to_string()),
        )
        .item(
            "records",
            AttributeValue::N(file_key.meta.records.to_string()),
        )
        .item(
            "original_size",
            AttributeValue::N(file_key.meta.original_size.to_string()),
        )
        .item(
            "compressed_size",
            AttributeValue::N(file_key.meta.compressed_size.to_string()),
        )
        .send()
        .await
    {
        Ok(_output) => {
            log::info!("[JOB] File_list saved to db: {}", file_key.key);
            Ok(())
        }
        Err(err) => {
            log::error!("[JOB] File_list db save error: {:?}", err);
            Err(anyhow::anyhow!(err))
        }
    }
}

pub async fn batch_write(file_keys: &[FileKey]) -> Result<(), anyhow::Error> {
    for batch in file_keys.chunks(25) {
        let mut write_requests: Vec<WriteRequest> = vec![];
        for file_key in batch {
            let req = PutRequest::builder()
                .set_item(Some(file_key.into()))
                .build();
            write_requests.push(WriteRequest::builder().put_request(req).build());
        }

        match DYNAMO_DB_CLIENT
            .get()
            .await
            .batch_write_item()
            .request_items(&CONFIG.common.dynamo_file_list_table, write_requests)
            .send()
            .await
        {
            Ok(_output) => {
                log::info!("[JOB] File_lists saved to db");
            }
            Err(err) => {
                log::error!("[JOB] File_list db save error: {:?}", err);
            }
        }
    }
    Ok(())
}

pub async fn batch_delete(file_keys: &[String]) -> Result<(), anyhow::Error> {
    for batch in file_keys.chunks(25) {
        let mut write_requests: Vec<WriteRequest> = vec![];
        for file_key in batch {
            let mut item = HashMap::new();
            let file_columns = file_key.splitn(5, '/').collect::<Vec<&str>>();
            item.insert(
                "stream".to_string(),
                AttributeValue::S(format!(
                    "{}/{}/{}",
                    file_columns[1], file_columns[2], file_columns[3]
                )),
            );
            item.insert(
                "file".to_string(),
                AttributeValue::S(file_columns[4].to_owned()),
            );
            let req = DeleteRequest::builder().set_key(Some(item)).build();
            write_requests.push(WriteRequest::builder().delete_request(req).build());
        }
        match DYNAMO_DB_CLIENT
            .get()
            .await
            .batch_write_item()
            .request_items(&CONFIG.common.dynamo_file_list_table, write_requests)
            .send()
            .await
        {
            Ok(_output) => {
                log::info!("[JOB] File_lists deleted from db");
            }
            Err(err) => {
                log::error!("[JOB] File_list db delete error: {:?}", err);
            }
        }
    }
    Ok(())
}

pub async fn query(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<QueryOutput>, aws_sdk_dynamodb::Error> {
    if time_range.is_some() && (time_range.unwrap().0 == 0 || time_range.unwrap().1 == 0) {
        return Ok(vec![]); // disallow empty query
    }
    let stream = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let (file_start, file_end) = if time_range.is_none() {
        ("".to_string(), "".to_string())
    } else {
        let (t1, t2) = time_range.unwrap();
        let t1: DateTime<Utc> = Utc.timestamp_nanos(t1 * 1000);
        // here must add one hour, because the between does not include the end hour
        let t2: DateTime<Utc> = Utc.timestamp_nanos(t2 * 1000) + Duration::hours(1);
        (
            t1.format("%Y/%m/%d/%H/").to_string(),
            t2.format("%Y/%m/%d/%H/").to_string(),
        )
    };
    let client = DYNAMO_DB_CLIENT.get().await;
    let query = if time_range.is_none() {
        client
            .query()
            .table_name(&CONFIG.common.dynamo_file_list_table)
            .key_condition_expression("#stream = :stream")
            .expression_attribute_names("#stream", "stream".to_string())
            .expression_attribute_values(":stream", AttributeValue::S(stream))
    } else {
        client
            .query()
            .table_name(&CONFIG.common.dynamo_file_list_table)
            .key_condition_expression("#stream = :stream AND #file BETWEEN :file1 AND :file2")
            .expression_attribute_names("#stream", "stream".to_string())
            .expression_attribute_names("#file", "file".to_string())
            .expression_attribute_values(":stream", AttributeValue::S(stream))
            .expression_attribute_values(":file1", AttributeValue::S(file_start))
            .expression_attribute_values(":file2", AttributeValue::S(file_end))
    };
    let resp: Result<Vec<_>, _> = query
        .select(Select::AllAttributes)
        .into_paginator()
        .page_size(1000)
        .send()
        .collect()
        .await;
    Ok(resp?)
}

pub async fn get_stream_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>, anyhow::Error> {
    let resp = query(org_id, stream_name, stream_type, Some((time_min, time_max))).await?;
    Ok(resp
        .iter()
        .filter(|v| v.count() > 0)
        .flat_map(|v| v.items().unwrap())
        .map(FileKey::from)
        .collect())
}

pub async fn get_file_meta(file: &str) -> Result<FileMeta, anyhow::Error> {
    let file_columns = file.splitn(5, '/').collect::<Vec<&str>>();
    let stream = format!(
        "{}/{}/{}",
        file_columns[1], file_columns[2], file_columns[3]
    );
    let file = file_columns[4].to_owned();

    let client = DYNAMO_DB_CLIENT.get().await;
    let resp = client
        .query()
        .table_name(&CONFIG.common.dynamo_file_list_table)
        .key_condition_expression("#stream = :stream AND #file = :file")
        .expression_attribute_names("#stream", "stream".to_string())
        .expression_attribute_values(":stream", AttributeValue::S(stream))
        .expression_attribute_names("#file", "file".to_string())
        .expression_attribute_values(":file", AttributeValue::S(file))
        .select(Select::AllAttributes)
        .send()
        .await?;
    let items = resp.items().unwrap();
    if items.is_empty() {
        return Err(anyhow::anyhow!("file not found"));
    }
    let item = items[0].clone();
    let file_key = FileKey::from(&item);
    Ok(file_key.meta)
}

#[cfg(test)]
mod tests {
    use crate::common::meta::common::FileMeta;

    use super::*;

    #[actix_web::test]
    async fn test_files() {
        let mut file_keys = vec![];
        for i in 0..50 {
            file_keys.push(format!(
                "files/nexus/logs/default/2022/10/03/10/6982652937134804993_{}.parquet",
                i
            ));
        }
        let file_meta = FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };
        let mut items = vec![];
        for file_key in file_keys.clone() {
            items.push(FileKey {
                key: file_key,
                meta: file_meta.clone(),
                deleted: false,
            });
        }
        let resp = batch_write(&items).await;
        assert!(resp.is_ok());
        let resp = batch_delete(&file_keys).await;
        assert!(resp.is_ok());
    }
}
