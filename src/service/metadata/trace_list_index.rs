use std::{
    collections::HashMap,
    hash::Hash,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use arrow_schema::{DataType, Field, Schema};
use config::{
    meta::stream::StreamType,
    utils::{json, schema_ext::SchemaExt},
    CONFIG,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::{
    common::meta::stream::{SchemaRecords, StreamPartition, StreamSettings},
    service::{
        db, ingestion,
        metadata::{Metadata, MetadataItem},
        stream,
        stream::unwrap_partition_time_level,
    },
};

const STREAM_NAME: &str = "trace_list_index";

static PARTITION_KEYS: Lazy<[StreamPartition; 1]> =
    Lazy::new(|| [StreamPartition::new("service_name")]);

pub struct TraceListIndex {
    schema: Arc<Schema>,
    db_schema_init: AtomicBool,
}

#[derive(Debug, Default, Eq, Hash, PartialEq, Clone, Serialize, Deserialize)]
pub struct TraceListItem {
    pub stream_name: String,
    pub service_name: String,
    pub trace_id: String,
    pub _timestamp: u64,
}

impl Metadata for TraceListIndex {
    fn generate_schema(&self) -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(
                CONFIG.common.column_timestamp.as_str(),
                DataType::Int64,
                false,
            ),
            Field::new("stream_name", DataType::Utf8, false),
            Field::new("service_name", DataType::Utf8, false),
            Field::new("trace_id", DataType::Utf8, false),
        ]))
    }
    async fn write(&self, org_id: &str, items: Vec<MetadataItem>) -> infra::errors::Result<()> {
        if items.is_empty() {
            return Ok(());
        }

        // write to wal
        let timestamp = chrono::Utc::now().timestamp_micros();
        let schema_key = self.schema.hash_key();

        if !self.db_schema_init.load(Ordering::Relaxed) {
            self.set_db_schema(org_id).await?
        }

        let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
        for item in items {
            let MetadataItem::TraceListIndexer(item) = item;
            let mut data = json::to_value(item).unwrap();
            let data = data.as_object_mut().unwrap();
            let hour_key = ingestion::get_wal_time_key(
                timestamp,
                PARTITION_KEYS.to_vec().as_ref(),
                unwrap_partition_time_level(None, StreamType::Metadata),
                data,
                Some(&schema_key),
            );
            let data = json::Value::Object(data.clone());
            let data_size = json::to_vec(&data).unwrap_or_default().len();

            let hour_buf = buf.entry(hour_key).or_insert_with(|| SchemaRecords {
                schema_key: schema_key.clone(),
                schema: self.schema.clone(),
                records: vec![],
                records_size: 0,
            });

            hour_buf.records.push(Arc::new(data));
            hour_buf.records_size += data_size;
        }

        let writer = ingester::get_writer(0, org_id, &StreamType::Metadata.to_string()).await;
        _ = ingestion::write_file(&writer, STREAM_NAME, buf).await;
        if let Err(e) = writer.sync().await {
            log::error!("[TraceListIndex] error while syncing writer: {}", e);
        }

        Ok(())
    }
    async fn flush(&self) -> infra::errors::Result<()> {
        // do nothing
        Ok(())
    }
    async fn stop(&self) -> infra::errors::Result<()> {
        if let Err(e) = self.flush().await {
            log::error!("[TraceListIndex] flush error: {}", e);
        }
        Ok(())
    }
}

impl Default for TraceListIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl TraceListIndex {
    pub fn new() -> Self {
        let mut res = Self {
            schema: Arc::new(Schema {
                fields: Default::default(),
                metadata: Default::default(),
            }),
            db_schema_init: AtomicBool::new(false),
        };

        res.schema = res.generate_schema();
        res
    }

    async fn set_db_schema(&self, org_id: &str) -> infra::errors::Result<()> {
        // check for schema
        let db_schema = db::schema::get(org_id, STREAM_NAME, StreamType::Metadata)
            .await
            .unwrap();
        if db_schema.fields().is_empty() {
            let schema = self.schema.as_ref().clone();
            if let Err(e) = db::schema::set(
                org_id,
                STREAM_NAME,
                StreamType::Metadata,
                &schema,
                None,
                false,
            )
            .await
            {
                log::error!("[TraceListIndex] error while setting schema: {}", e);
            }

            let settings = StreamSettings {
                partition_keys: PARTITION_KEYS.to_vec(),
                partition_time_level: None,
                full_text_search_keys: vec![],
                bloom_filter_fields: vec!["trace_id".to_string()],
                data_retention: 0,
            };

            stream::save_stream_settings(org_id, STREAM_NAME, StreamType::Metadata, settings)
                .await?;
        }

        self.db_schema_init.store(true, Ordering::Release);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use config::{meta::stream::StreamType, utils::json, CONFIG};

    use crate::{
        common::meta::stream::SchemaRecords,
        service::{
            ingestion, metadata,
            metadata::{
                trace_list_index::{TraceListIndex, TraceListItem, STREAM_NAME},
                Metadata, MetadataItem,
            },
            stream::unwrap_partition_time_level,
        },
    };

    #[tokio::test]
    async fn test_write() {
        let t = TraceListIndex::new();
        let data = vec![MetadataItem::TraceListIndexer(TraceListItem::default())];

        let res = t.write("default", data).await;
        assert_eq!((), res.unwrap());
    }

    #[tokio::test]
    async fn test_write_file() {
        let t = TraceListIndex::new();
        let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
        let item = metadata::MetadataItem::TraceListIndexer(TraceListItem {
            stream_name: "default".to_string(),
            service_name: "oojaeger".to_string(),
            trace_id: "b09e986672880927996155acd4ef113c".to_string(),
            _timestamp: 1711267573271714542,
        });
        let schema_key = "9d384d5af30d1657";
        let timestamp = chrono::Utc::now().timestamp_micros();
        let mut data = json::to_value(item).unwrap();
        let data = data.as_object_mut().unwrap();
        data.insert(
            CONFIG.common.column_timestamp.clone(),
            json::Value::Number(timestamp.into()),
        );
        let hour_key = ingestion::get_wal_time_key(
            timestamp,
            &vec![],
            unwrap_partition_time_level(None, StreamType::Metadata),
            data,
            Some(schema_key.clone()),
        );
        let data = json::Value::Object(data.clone());
        let data_size = json::to_vec(&data).unwrap_or_default().len();
        let schema = t.generate_schema();
        let hour_buf = buf.entry(hour_key).or_insert_with(|| SchemaRecords {
            schema_key: schema_key.to_string(),
            schema: schema.clone(),
            records: vec![],
            records_size: 0,
        });
        hour_buf.records.push(Arc::new(data.clone()));
        hour_buf.records.push(Arc::new(data));
        hour_buf.records_size += data_size;

        let writer =
            ingester::get_writer(0, "openobserve", &StreamType::Metadata.to_string()).await;
        for (key, val) in buf.iter() {
            println!(
                "key: {key} val: {:?} schema: {}, records_size: {}, records: {:?}",
                val.schema_key, val.schema, val.records_size, val.records
            );
        }
        let r = ingestion::write_file(&writer, STREAM_NAME, buf).await;
        println!("r: {:?}", r);
    }
}
