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

use std::{
    cmp::{max, min},
    collections::HashMap,
};

use async_trait::async_trait;
use aws_sdk_dynamodb::{operation::query::QueryOutput, types::*};
use chrono::{DateTime, Duration, TimeZone, Utc};
use config::{
    meta::stream::{FileKey, FileMeta, StreamType},
    utils::parquet::parse_file_key_columns,
    CONFIG,
};
use tokio_stream::StreamExt;

use crate::common::{
    infra::{
        db::dynamo::get_db_client,
        errors::{Error, Result},
    },
    meta::stream::{PartitionTimeLevel, StreamStats},
    utils::time::BASE_TIME,
};

pub struct DynamoFileList {
    file_list_table: String,
    file_list_deleted_table: String,
    stream_stats_table: String,
}

impl DynamoFileList {
    pub fn new() -> Self {
        Self {
            file_list_table: CONFIG.dynamo.file_list_table.clone(),
            file_list_deleted_table: CONFIG.dynamo.file_list_deleted_table.clone(),
            stream_stats_table: CONFIG.dynamo.stream_stats_table.clone(),
        }
    }
}

impl Default for DynamoFileList {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl super::FileList for DynamoFileList {
    async fn create_table(&self) -> Result<()> {
        create_table().await
    }

    async fn create_table_index(&self) -> Result<()> {
        create_table_index().await
    }

    async fn set_initialised(&self) -> Result<()> {
        Ok(())
    }

    async fn get_initialised(&self) -> Result<bool> {
        Ok(true)
    }

    async fn add(&self, file: &str, meta: &FileMeta) -> Result<()> {
        let (stream_key, date_key, file_name) = parse_file_key_columns(file)?;
        let org_id = stream_key[..stream_key.find('/').unwrap()].to_string();
        let file_name = format!("{date_key}/{file_name}");
        let client = get_db_client().await.clone();
        client
            .put_item()
            .table_name(&self.file_list_table)
            .item("org", AttributeValue::S(org_id))
            .item("stream", AttributeValue::S(stream_key))
            .item("file", AttributeValue::S(file_name))
            .item("deleted", AttributeValue::Bool(false))
            .item("min_ts", AttributeValue::N(meta.min_ts.to_string()))
            .item("max_ts", AttributeValue::N(meta.max_ts.to_string()))
            .item("records", AttributeValue::N(meta.records.to_string()))
            .item(
                "original_size",
                AttributeValue::N(meta.original_size.to_string()),
            )
            .item(
                "compressed_size",
                AttributeValue::N(meta.compressed_size.to_string()),
            )
            .item(
                "created_at",
                AttributeValue::N(Utc::now().timestamp_micros().to_string()),
            )
            .send()
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn remove(&self, file: &str) -> Result<()> {
        let (stream_key, date_key, file_name) = parse_file_key_columns(file)?;
        let file_name = format!("{date_key}/{file_name}");
        let mut key = HashMap::new();
        key.insert("stream".to_string(), AttributeValue::S(stream_key));
        key.insert("file".to_string(), AttributeValue::S(file_name));
        let client = get_db_client().await.clone();
        client
            .delete_item()
            .table_name(&self.file_list_table)
            .set_key(Some(key))
            .send()
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn batch_add(&self, files: &[FileKey]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        for batch in files.chunks(25) {
            let mut reqs: Vec<WriteRequest> = Vec::with_capacity(batch.len());
            for file in batch {
                let req = PutRequest::builder().set_item(Some(file.into())).build();
                reqs.push(WriteRequest::builder().put_request(req).build());
            }
            let client = get_db_client().await.clone();
            client
                .batch_write_item()
                .request_items(&self.file_list_table, reqs)
                .send()
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    async fn batch_remove(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        for batch in files.chunks(25) {
            let mut reqs: Vec<WriteRequest> = Vec::with_capacity(batch.len());
            for file in batch {
                let (stream_key, date_key, file_name) = parse_file_key_columns(file)?;
                let file_name = format!("{date_key}/{file_name}");
                let mut key = HashMap::new();
                key.insert("stream".to_string(), AttributeValue::S(stream_key));
                key.insert("file".to_string(), AttributeValue::S(file_name));
                let req = DeleteRequest::builder().set_key(Some(key)).build();
                reqs.push(WriteRequest::builder().delete_request(req).build());
            }
            let client = get_db_client().await.clone();
            client
                .batch_write_item()
                .request_items(&self.file_list_table, reqs)
                .send()
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    async fn batch_add_deleted(
        &self,
        org_id: &str,
        created_at: i64,
        files: &[String],
    ) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        let created_at = created_at.to_string();
        for batch in files.chunks(25) {
            let mut reqs: Vec<WriteRequest> = Vec::with_capacity(batch.len());
            for file in batch {
                let (stream_key, date_key, file_name) = parse_file_key_columns(file).unwrap();
                let file_name = format!("{date_key}/{file_name}");
                let mut item = HashMap::new();
                item.insert("org".to_string(), AttributeValue::S(org_id.to_string()));
                item.insert("stream".to_string(), AttributeValue::S(stream_key));
                item.insert("file".to_string(), AttributeValue::S(file_name));
                item.insert(
                    "created_at".to_string(),
                    AttributeValue::N(created_at.clone()),
                );
                let req = PutRequest::builder().set_item(Some(item)).build();
                reqs.push(WriteRequest::builder().put_request(req).build());
            }
            let client = get_db_client().await.clone();
            client
                .batch_write_item()
                .request_items(&self.file_list_deleted_table, reqs)
                .send()
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    async fn batch_remove_deleted(&self, files: &[String]) -> Result<()> {
        if files.is_empty() {
            return Ok(());
        }
        for batch in files.chunks(25) {
            let mut reqs: Vec<WriteRequest> = Vec::with_capacity(batch.len());
            for file in batch {
                let (stream_key, date_key, file_name) = parse_file_key_columns(file)?;
                let file_name = format!("{date_key}/{file_name}");
                let mut key = HashMap::new();
                key.insert("stream".to_string(), AttributeValue::S(stream_key));
                key.insert("file".to_string(), AttributeValue::S(file_name));
                let req = DeleteRequest::builder().set_key(Some(key)).build();
                reqs.push(WriteRequest::builder().delete_request(req).build());
            }
            let client = get_db_client().await.clone();
            client
                .batch_write_item()
                .request_items(&self.file_list_deleted_table, reqs)
                .send()
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    async fn get(&self, file: &str) -> Result<FileMeta> {
        let (stream_key, date_key, file_name) = parse_file_key_columns(file)?;
        let file_name = format!("{date_key}/{file_name}");

        let client = get_db_client().await.clone();
        let resp = client
            .query()
            .table_name(&self.file_list_table)
            .key_condition_expression("#stream = :stream AND #file = :file")
            .expression_attribute_names("#stream", "stream".to_string())
            .expression_attribute_names("#file", "file".to_string())
            .expression_attribute_values(":stream", AttributeValue::S(stream_key))
            .expression_attribute_values(":file", AttributeValue::S(file_name))
            .select(Select::AllAttributes)
            .send()
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        let items = resp.items().unwrap();
        if items.is_empty() {
            return Err(Error::Message("file not found".to_string()));
        }
        let file_key = FileKey::from(items.first().unwrap());
        Ok(file_key.meta)
    }

    async fn contains(&self, file: &str) -> Result<bool> {
        Ok(self.get(file).await.is_ok())
    }

    async fn list(&self) -> Result<Vec<(String, FileMeta)>> {
        return Ok(vec![]); // disallow list all data
    }

    async fn query(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_level: PartitionTimeLevel,
        time_range: (i64, i64),
    ) -> Result<Vec<(String, FileMeta)>> {
        let (mut time_start, mut time_end) = time_range;
        if time_start == 0 {
            time_start = BASE_TIME.timestamp_micros();
        }
        if time_end == 0 {
            time_end = Utc::now().timestamp_micros();
        }

        let t1: DateTime<Utc> = Utc.timestamp_nanos(time_start * 1000);
        let t2: DateTime<Utc> = Utc.timestamp_nanos(time_end * 1000) + Duration::hours(1);
        let (file_start, file_end) = if time_level == PartitionTimeLevel::Daily {
            (
                t1.format("%Y/%m/%d/00/").to_string(),
                t2.format("%Y/%m/%d/%H/").to_string(),
            )
        } else {
            (
                t1.format("%Y/%m/%d/%H/").to_string(),
                t2.format("%Y/%m/%d/%H/").to_string(),
            )
        };

        let stream_key = format!("{org_id}/{stream_type}/{stream_name}");

        let client = get_db_client().await.clone();
        let resp: std::result::Result<Vec<QueryOutput>, _> = client
            .query()
            .table_name(&self.file_list_table)
            .key_condition_expression("#stream = :stream AND #file BETWEEN :file1 AND :file2")
            .expression_attribute_names("#stream", "stream".to_string())
            .expression_attribute_names("#file", "file".to_string())
            .expression_attribute_values(":stream", AttributeValue::S(stream_key))
            .expression_attribute_values(":file1", AttributeValue::S(file_start))
            .expression_attribute_values(":file2", AttributeValue::S(file_end))
            .select(Select::AllAttributes)
            .into_paginator()
            .page_size(1000)
            .send()
            .collect()
            .await;
        let resp = resp.map_err(|e| Error::Message(e.to_string()))?;

        // filter by time range
        let resp: Vec<_> = resp
            .iter()
            .filter(|v| v.count() > 0)
            .flat_map(|v| v.items().unwrap())
            .filter_map(|v| {
                let file = FileKey::from(v);
                if file.meta.min_ts <= time_end && file.meta.max_ts >= time_start {
                    Some((file.key.to_owned(), file.meta.to_owned()))
                } else {
                    None
                }
            })
            .collect();
        Ok(resp)
    }

    async fn query_deleted(&self, org_id: &str, time_max: i64, limit: i64) -> Result<Vec<String>> {
        if time_max == 0 {
            return Ok(Vec::new());
        }
        let client = get_db_client().await.clone();
        let resp: std::result::Result<Vec<QueryOutput>, _> = client
            .query()
            .table_name(&self.file_list_deleted_table)
            .index_name("org-created-at-index")
            .key_condition_expression("#org = :org AND #created_at < :ts")
            .expression_attribute_names("#org", "org".to_string())
            .expression_attribute_names("#created_at", "created_at".to_string())
            .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
            .expression_attribute_values(":ts", AttributeValue::N(time_max.to_string()))
            .select(Select::AllAttributes)
            .limit(limit as i32)
            .into_paginator()
            .page_size(1000)
            .send()
            .collect()
            .await;
        let resp = resp.map_err(|e| Error::Message(e.to_string()))?;
        let resp: Vec<_> = resp
            .iter()
            .filter(|v| v.count() > 0)
            .flat_map(|v| v.items().unwrap())
            .map(|v| {
                format!(
                    "files/{}/{}",
                    v.get("stream").unwrap().as_s().unwrap(),
                    v.get("file").unwrap().as_s().unwrap()
                )
            })
            .collect();
        Ok(resp)
    }

    async fn get_min_ts(
        &self,
        _org_id: &str,
        _stream_type: StreamType,
        _stream_name: &str,
    ) -> Result<i64> {
        Ok(0) // TODO
    }

    async fn get_max_pk_value(&self) -> Result<i64> {
        // we subtract 10 minutes to avoid the case that the last file insert at the
        // same time
        Ok(Utc::now().timestamp_micros() - Duration::minutes(10).num_microseconds().unwrap())
    }

    async fn stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
        pk_value: Option<(i64, i64)>,
    ) -> Result<Vec<(String, StreamStats)>> {
        let (time_start, time_end) = pk_value.unwrap_or((0, 0));
        let client = get_db_client().await.clone();
        let query = if stream_type.is_some() && stream_name.is_some() {
            let stream_key = format!("{org_id}/{}/{}", stream_type.unwrap(), stream_name.unwrap());
            if time_start == 0 && time_end == 0 {
                client
                    .query()
                    .table_name(&self.file_list_table)
                    .index_name("org-created-at-index")
                    .key_condition_expression("#org = :org AND #stream = :stream")
                    .expression_attribute_names("#org", "org".to_string())
                    .expression_attribute_names("#stream", "stream".to_string())
                    .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
                    .expression_attribute_values(":stream", AttributeValue::S(stream_key))
            } else {
                let time_start = time_start + 1; // because the beween is [start, end], we don't want to include the start
                client
                    .query()
                    .table_name(&self.file_list_table)
                    .index_name("org-created-at-index")
                    .key_condition_expression(
                        "#org = :org AND #stream = :stream AND #created_at BETWEEN :ts1 AND :ts2",
                    )
                    .expression_attribute_names("#org", "org".to_string())
                    .expression_attribute_names("#stream", "stream".to_string())
                    .expression_attribute_names("#created_at", "created_at".to_string())
                    .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
                    .expression_attribute_values(":stream", AttributeValue::S(stream_key))
                    .expression_attribute_values(":ts1", AttributeValue::N(time_start.to_string()))
                    .expression_attribute_values(":ts2", AttributeValue::N(time_end.to_string()))
            }
        } else if time_start == 0 && time_end == 0 {
            client
                .query()
                .table_name(&self.file_list_table)
                .index_name("org-created-at-index")
                .key_condition_expression("org = :org")
                .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
        } else {
            let time_start = time_start + 1; // because the beween is [start, end], we don't want to include the start
            client
                .query()
                .table_name(&self.file_list_table)
                .index_name("org-created-at-index")
                .key_condition_expression("#org = :org AND #created_at BETWEEN :ts1 AND :ts2")
                .expression_attribute_names("#org", "org".to_string())
                .expression_attribute_names("#created_at", "created_at".to_string())
                .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
                .expression_attribute_values(":ts1", AttributeValue::N(time_start.to_string()))
                .expression_attribute_values(":ts2", AttributeValue::N(time_end.to_string()))
        };

        let resp: std::result::Result<Vec<QueryOutput>, _> = query
            .select(Select::AllAttributes)
            .into_paginator()
            .page_size(1000)
            .send()
            .collect()
            .await;
        let resp = resp.map_err(|e| Error::Message(e.to_string()))?;
        let resp: Vec<_> = resp
            .iter()
            .filter(|v| v.count() > 0)
            .flat_map(|v| v.items().unwrap())
            .map(|v| {
                let file = FileKey::from(v);
                (file.key.to_owned(), file.meta.to_owned())
            })
            .collect();

        // calculate stats
        let mut stats = HashMap::new();
        for (file, meta) in resp {
            let (stream_key, _date_key, _file_name) = parse_file_key_columns(&file)?;
            let stream_stats = stats.entry(stream_key).or_insert_with(StreamStats::default);
            stream_stats.add_file_meta(&meta);
        }

        Ok(stats.into_iter().collect())
    }

    async fn get_stream_stats(
        &self,
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> Result<Vec<(String, StreamStats)>> {
        let client = get_db_client().await.clone();
        let query = if stream_type.is_some() && stream_name.is_some() {
            let stream_key = format!("{org_id}/{}/{}", stream_type.unwrap(), stream_name.unwrap());
            client
                .query()
                .table_name(&self.stream_stats_table)
                .key_condition_expression("#org = :org AND #stream = :stream")
                .expression_attribute_names("#org", "org".to_string())
                .expression_attribute_names("#stream", "stream".to_string())
                .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
                .expression_attribute_values(":stream", AttributeValue::S(stream_key))
        } else {
            client
                .query()
                .table_name(&self.stream_stats_table)
                .key_condition_expression("#org = :org")
                .expression_attribute_names("#org", "org".to_string())
                .expression_attribute_values(":org", AttributeValue::S(org_id.to_string()))
        };

        let resp: std::result::Result<Vec<QueryOutput>, _> = query
            .select(Select::AllAttributes)
            .into_paginator()
            .page_size(1000)
            .send()
            .collect()
            .await;
        let resp = resp.map_err(|e| Error::Message(e.to_string()))?;
        let resp: Vec<_> = resp
            .iter()
            .filter(|v| v.count() > 0)
            .flat_map(|v| v.items().unwrap())
            .map(|v| {
                let stat = super::StatsRecord::from(v);
                (stat.stream.to_owned(), (&stat).into())
            })
            .collect();
        Ok(resp)
    }

    async fn set_stream_stats(
        &self,
        org_id: &str,
        streams: &[(String, StreamStats)],
    ) -> Result<()> {
        let client = get_db_client().await.clone();
        let old_stats = self.get_stream_stats(org_id, None, None).await?;
        let old_stats = old_stats.into_iter().collect::<HashMap<_, _>>();
        let mut update_streams = Vec::with_capacity(streams.len());
        for (stream_key, meta) in streams {
            let mut stats = match old_stats.get(stream_key) {
                Some(s) => s.to_owned(),
                None => StreamStats::default(),
            };
            stats.file_num = max(0, stats.file_num + meta.file_num);
            stats.doc_num = max(0, stats.doc_num + meta.doc_num);
            stats.doc_time_min = min(stats.doc_time_min, meta.doc_time_min);
            if stats.doc_time_min == 0 {
                stats.doc_time_min = meta.doc_time_min;
            }
            stats.doc_time_max = max(stats.doc_time_max, meta.doc_time_max);
            stats.storage_size += meta.storage_size;
            if stats.storage_size < 0.0 {
                stats.storage_size = 0.0;
            }
            stats.compressed_size += meta.compressed_size;
            if stats.compressed_size < 0.0 {
                stats.compressed_size = 0.0;
            }
            update_streams.push((stream_key, stats));
        }

        for batch in update_streams.chunks(25) {
            let mut reqs: Vec<WriteRequest> = Vec::with_capacity(batch.len());
            for (stream_key, stats) in batch {
                let mut item = HashMap::with_capacity(10);
                item.insert("org".to_string(), AttributeValue::S(org_id.to_string()));
                item.insert(
                    "stream".to_string(),
                    AttributeValue::S(stream_key.to_string()),
                );
                item.insert(
                    "file_num".to_string(),
                    AttributeValue::N(stats.file_num.to_string()),
                );
                item.insert(
                    "min_ts".to_string(),
                    AttributeValue::N(stats.doc_time_min.to_string()),
                );
                item.insert(
                    "max_ts".to_string(),
                    AttributeValue::N(stats.doc_time_max.to_string()),
                );
                item.insert(
                    "records".to_string(),
                    AttributeValue::N(stats.doc_num.to_string()),
                );
                item.insert(
                    "original_size".to_string(),
                    AttributeValue::N((stats.storage_size as i64).to_string()),
                );
                item.insert(
                    "compressed_size".to_string(),
                    AttributeValue::N((stats.compressed_size as i64).to_string()),
                );
                let req = PutRequest::builder().set_item(Some(item)).build();
                reqs.push(WriteRequest::builder().put_request(req).build());
            }
            client
                .batch_write_item()
                .request_items(&self.stream_stats_table, reqs)
                .send()
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    async fn reset_stream_stats(&self) -> Result<()> {
        Ok(()) // TODO
    }

    async fn reset_stream_stats_min_ts(
        &self,
        org_id: &str,
        stream: &str,
        min_ts: i64,
    ) -> Result<()> {
        let mut key = HashMap::new();
        key.insert("org".to_string(), AttributeValue::S(org_id.to_string()));
        key.insert("stream".to_string(), AttributeValue::S(stream.to_string()));
        let mut updates = HashMap::new();
        updates.insert(
            "min_ts".to_string(),
            AttributeValueUpdate::builder()
                .set_value(Some(AttributeValue::N(min_ts.to_string())))
                .build(),
        );
        let client = get_db_client().await.clone();
        client
            .update_item()
            .table_name(&self.stream_stats_table)
            .set_key(Some(key))
            .set_attribute_updates(Some(updates))
            .send()
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        Ok(())
    }

    async fn len(&self) -> usize {
        0 // TODO
    }

    async fn is_empty(&self) -> bool {
        false // TODO
    }

    async fn clear(&self) -> Result<()> {
        Ok(())
    }
}

pub async fn create_table() -> Result<()> {
    create_table_file_list().await?;
    create_table_file_list_deleted().await?;
    create_table_stream_stats().await?;
    Ok(())
}

pub async fn create_table_index() -> Result<()> {
    create_table_file_list_index().await?;
    create_table_file_list_deleted_index().await?;
    create_table_stream_stats_index().await?;
    Ok(())
}

pub async fn create_table_file_list() -> Result<()> {
    let client = get_db_client().await.clone();
    let table_name = &CONFIG.dynamo.file_list_table;
    let tables = client
        .list_tables()
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    if tables
        .table_names()
        .unwrap_or(&[])
        .contains(&table_name.to_string())
    {
        return Ok(());
    }

    let key_schema = vec![
        KeySchemaElement::builder()
            .attribute_name("stream")
            .key_type(KeyType::Hash)
            .build(),
        KeySchemaElement::builder()
            .attribute_name("file")
            .key_type(KeyType::Range)
            .build(),
    ];
    let attribute_definitions = vec![
        AttributeDefinition::builder()
            .attribute_name("org")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("stream")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("file")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("created_at")
            .attribute_type(ScalarAttributeType::N)
            .build(),
    ];

    let index_created = GlobalSecondaryIndex::builder()
        .index_name("org-created-at-index")
        .set_key_schema(Some(vec![
            KeySchemaElement::builder()
                .attribute_name("org")
                .key_type(KeyType::Hash)
                .build(),
            KeySchemaElement::builder()
                .attribute_name("created_at")
                .key_type(KeyType::Range)
                .build(),
        ]))
        .set_projection(Some(
            Projection::builder()
                .projection_type(ProjectionType::All)
                .build(),
        ))
        .build();

    client
        .create_table()
        .table_name(table_name)
        .set_key_schema(Some(key_schema))
        .set_attribute_definitions(Some(attribute_definitions))
        .set_global_secondary_indexes(Some(vec![index_created]))
        .billing_mode(BillingMode::PayPerRequest)
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;

    log::info!("Table {} created successfully", table_name);

    Ok(())
}

pub async fn create_table_file_list_deleted() -> Result<()> {
    let client = get_db_client().await.clone();
    let table_name = &CONFIG.dynamo.file_list_deleted_table;
    let tables = client
        .list_tables()
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    if tables
        .table_names()
        .unwrap_or(&[])
        .contains(&table_name.to_string())
    {
        return Ok(());
    }

    let key_schema = vec![
        KeySchemaElement::builder()
            .attribute_name("stream")
            .key_type(KeyType::Hash)
            .build(),
        KeySchemaElement::builder()
            .attribute_name("file")
            .key_type(KeyType::Range)
            .build(),
    ];
    let attribute_definitions = vec![
        AttributeDefinition::builder()
            .attribute_name("org")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("stream")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("file")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("created_at")
            .attribute_type(ScalarAttributeType::N)
            .build(),
    ];

    let index_created = GlobalSecondaryIndex::builder()
        .index_name("org-created-at-index")
        .set_key_schema(Some(vec![
            KeySchemaElement::builder()
                .attribute_name("org")
                .key_type(KeyType::Hash)
                .build(),
            KeySchemaElement::builder()
                .attribute_name("created_at")
                .key_type(KeyType::Range)
                .build(),
        ]))
        .set_projection(Some(
            Projection::builder()
                .projection_type(ProjectionType::All)
                .build(),
        ))
        .build();

    client
        .create_table()
        .table_name(table_name)
        .set_key_schema(Some(key_schema))
        .set_attribute_definitions(Some(attribute_definitions))
        .set_global_secondary_indexes(Some(vec![index_created]))
        .billing_mode(BillingMode::PayPerRequest)
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;

    log::info!("Table {} created successfully", table_name);

    Ok(())
}

pub async fn create_table_file_list_org_crated_at_index() -> Result<()> {
    let client = get_db_client().await.clone();
    let table_name = &CONFIG.dynamo.file_list_table;

    let attribute_definitions = vec![
        AttributeDefinition::builder()
            .attribute_name("org")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("stream")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("file")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("created_at")
            .attribute_type(ScalarAttributeType::N)
            .build(),
    ];
    let index_created = GlobalSecondaryIndexUpdate::builder()
        .create(
            CreateGlobalSecondaryIndexAction::builder()
                .index_name("org-created-at-index")
                .set_key_schema(Some(vec![
                    KeySchemaElement::builder()
                        .attribute_name("org")
                        .key_type(KeyType::Hash)
                        .build(),
                    KeySchemaElement::builder()
                        .attribute_name("created_at")
                        .key_type(KeyType::Range)
                        .build(),
                ]))
                .set_projection(Some(
                    Projection::builder()
                        .projection_type(ProjectionType::All)
                        .build(),
                ))
                .build(),
        )
        .build();

    client
        .update_table()
        .table_name(table_name)
        .set_attribute_definitions(Some(attribute_definitions))
        .set_global_secondary_index_updates(Some(vec![index_created]))
        .billing_mode(BillingMode::PayPerRequest)
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;

    log::info!("Table {} index created successfully", table_name);

    Ok(())
}

pub async fn create_table_stream_stats() -> Result<()> {
    let client = get_db_client().await.clone();
    let table_name = &CONFIG.dynamo.stream_stats_table;
    let tables = client
        .list_tables()
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    if tables
        .table_names()
        .unwrap_or(&[])
        .contains(&table_name.to_string())
    {
        return Ok(());
    }

    let key_schema = vec![
        KeySchemaElement::builder()
            .attribute_name("org")
            .key_type(KeyType::Hash)
            .build(),
        KeySchemaElement::builder()
            .attribute_name("stream")
            .key_type(KeyType::Range)
            .build(),
    ];
    let attribute_definitions = vec![
        AttributeDefinition::builder()
            .attribute_name("org")
            .attribute_type(ScalarAttributeType::S)
            .build(),
        AttributeDefinition::builder()
            .attribute_name("stream")
            .attribute_type(ScalarAttributeType::S)
            .build(),
    ];
    client
        .create_table()
        .table_name(table_name)
        .set_key_schema(Some(key_schema))
        .set_attribute_definitions(Some(attribute_definitions))
        .billing_mode(BillingMode::PayPerRequest)
        .send()
        .await
        .map_err(|e| Error::Message(e.to_string()))?;

    log::info!("Table {} created successfully", table_name);

    Ok(())
}

pub async fn create_table_file_list_index() -> Result<()> {
    Ok(())
}

pub async fn create_table_file_list_deleted_index() -> Result<()> {
    Ok(())
}

pub async fn create_table_stream_stats_index() -> Result<()> {
    Ok(())
}
