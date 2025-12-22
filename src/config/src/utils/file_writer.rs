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

use std::sync::Arc;

use arrow::record_batch::RecordBatch;
use arrow_schema::Schema;
use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

use crate::{config, meta::stream::FileMeta, utils::parquet::new_parquet_writer};

pub static VORTEX_RUNTIME: Lazy<Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .thread_name("vortex_runtime")
        .worker_threads(config::get_config().limit.vortex_thread_num)
        .thread_stack_size(16 * 1024 * 1024)
        .enable_all()
        .build()
        .unwrap()
});

/// Configuration for writing record batches to a file
pub struct WriteConfig<'a> {
    pub schema: &'a Arc<Schema>,
    pub bloom_filter_fields: &'a [String],
    pub metadata: &'a FileMeta,
    pub write_metadata: bool,
    pub compression: Option<&'a str>,
}

/// Write record batches to a buffer in Parquet format
pub async fn write_recordbatches_to_buf(
    batches: &[RecordBatch],
    config: WriteConfig<'_>,
) -> Result<Vec<u8>, anyhow::Error> {
    write_recordbatches_to_parquet(batches, config).await
}

/// Write record batches to a Parquet buffer
async fn write_recordbatches_to_parquet(
    batches: &[RecordBatch],
    config: WriteConfig<'_>,
) -> Result<Vec<u8>, anyhow::Error> {
    let mut buf = Vec::new();
    // TODO: remove write metadata from parquet writer
    let mut writer = new_parquet_writer(
        &mut buf,
        config.schema,
        config.bloom_filter_fields,
        config.metadata,
        config.write_metadata,
        config.compression,
    );

    for batch in batches {
        writer.write(batch).await?;
    }
    writer.close().await?;

    Ok(buf)
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Int32Array, StringArray},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };

    use super::*;

    fn create_test_batch() -> (Arc<Schema>, RecordBatch) {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int32, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let id_array = Int32Array::from(vec![1, 2, 3]);
        let name_array = StringArray::from(vec!["Alice", "Bob", "Charlie"]);

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(id_array), Arc::new(name_array)],
        )
        .unwrap();

        (schema, batch)
    }

    #[tokio::test]
    async fn test_write_parquet() {
        let (schema, batch) = create_test_batch();
        let metadata = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 3,
            original_size: 100,
            ..Default::default()
        };

        let config = WriteConfig {
            schema: &schema,
            bloom_filter_fields: &["name".to_string()],
            metadata: &metadata,
            write_metadata: true,
            compression: None,
        };

        let result =
            write_recordbatches_to_buf(std::slice::from_ref(&batch), config)
                .await;

        assert!(result.is_ok());
        assert!(!result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_write_multiple_batches() {
        let (schema, batch) = create_test_batch();
        let metadata = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 3,
            original_size: 100,
            ..Default::default()
        };

        let config = WriteConfig {
            schema: &schema,
            bloom_filter_fields: &[],
            metadata: &metadata,
            write_metadata: true,
            compression: None,
        };

        let result =
            write_recordbatches_to_buf(&[batch.clone(), batch], config)
                .await;

        assert!(result.is_ok());
        assert!(!result.unwrap().is_empty());
    }
}
