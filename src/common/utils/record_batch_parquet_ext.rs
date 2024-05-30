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

use arrow::record_batch::RecordBatch;
use async_trait::async_trait;
use config::{meta::stream::FileMeta, utils::parquet::new_parquet_writer};

use super::stream::populate_file_meta;

#[async_trait]
/// Extension trait for `RecordBatch` providing additional functionality.
pub trait RecordBatchParquetExt {
    /// Converts the `RecordBatch` to a Parquet buffer asynchronously.
    ///
    /// # Arguments
    ///
    /// * `original_file_size` - The original file size in bytes.
    ///
    /// # Returns
    ///
    /// A tuple containing the Parquet buffer as a `Vec<u8>` and the `FileMeta` information.
    ///
    /// # Errors
    ///
    /// Returns an `anyhow::Error` if there was an error converting the `RecordBatch` to Parquet.
    ///
    /// # Example
    ///
    /// ```
    /// use anyhow::Result;
    /// use openobserve::common::utils::RecordBatchExt;
    ///
    /// #[tokio::main]
    /// async fn main() -> Result<()> {
    ///     let record_batch = /* create a RecordBatch */;
    ///     let original_file_size = 1024;
    ///
    ///     let (parquet_buf, file_meta) = record_batch.to_parquet_buf(original_file_size).await?;
    ///
    ///     // Do something with the Parquet buffer and file meta information
    ///
    ///     Ok(())
    /// }
    /// ```
    async fn to_parquet_buf(
        &self,
        original_file_size: u64,
    ) -> Result<(Vec<u8>, FileMeta), anyhow::Error>;
}

#[async_trait]
impl RecordBatchParquetExt for Vec<RecordBatch> {
    async fn to_parquet_buf(
        &self,
        original_file_size: u64,
    ) -> Result<(Vec<u8>, FileMeta), anyhow::Error> {
        let schema = if let Some(first_batch) = self.first() {
            first_batch.schema()
        } else {
            return Err(anyhow::anyhow!("No record batches found"));
        };

        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: original_file_size as i64,
            compressed_size: 0,
        };
        populate_file_meta(schema.clone(), vec![self.to_vec()], &mut file_meta).await?;
        // write parquet file
        let mut buf_parquet = Vec::new();
        let mut writer = new_parquet_writer(&mut buf_parquet, &schema, &[], &file_meta);
        for batch in self {
            writer.write(&batch).await?;
        }
        writer.close().await?;
        file_meta.compressed_size = buf_parquet.len() as i64;
        Ok((buf_parquet, file_meta))
    }
}
