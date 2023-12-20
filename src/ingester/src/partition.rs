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
    fs::{create_dir_all, OpenOptions},
    path::PathBuf,
    sync::Arc,
};

use arrow::{json::ReaderBuilder, record_batch::RecordBatch};
use arrow_schema::Schema;
use chrono::Utc;
use snafu::ResultExt;

use crate::{
    entry::Entry,
    errors::*,
    parquet::{new_parquet_writer, FileMeta},
    rwmap::RwMap,
    ARROW_DIR,
};

pub(crate) struct Partition {
    schema: Arc<Schema>,
    files: RwMap<Arc<str>, PartitionFile>, // key: hour, val: files
}

impl Partition {
    pub(crate) fn new(schema: Arc<Schema>) -> Self {
        Self {
            schema,
            files: RwMap::default(),
        }
    }

    pub(crate) async fn write(&mut self, entry: Entry) -> Result<()> {
        let mut rw = self.files.write().await;
        let partition = rw
            .entry(entry.partition_key.clone())
            .or_insert_with(|| PartitionFile::new());
        partition.write(self.schema.clone(), entry)?;
        Ok(())
    }

    pub(crate) async fn read(
        &self,
        time_range: Option<(i64, i64)>,
    ) -> Result<(Arc<Schema>, Vec<RecordBatch>)> {
        let r = self.files.read().await;
        let mut batches = Vec::with_capacity(r.len());
        for file in r.values() {
            batches.extend(file.read(time_range)?);
        }
        Ok((self.schema.clone(), batches))
    }

    pub(crate) async fn persist(
        &self,
        org_id: &str,
        stream_type: &str,
        stream_name: &str,
        schema_key: &str,
    ) -> Result<()> {
        let thread_id = 0;
        let r = self.files.read().await;
        let mut path = PathBuf::from(ARROW_DIR);
        path.push(org_id);
        path.push(stream_type);
        path.push(stream_name);
        path.push(thread_id.to_string());
        for (hour, data) in r.iter() {
            let file_name = Utc::now().timestamp_nanos_opt().unwrap().to_string();
            let mut path = path.clone();
            path.push(hour.to_string());
            path.push(schema_key);
            path.push(file_name);
            path.set_extension("parquet");
            create_dir_all(path.parent().unwrap())
                .context(CreateFileSnafu { path: path.clone() })?;
            let mut f = OpenOptions::new()
                .create(true)
                .write(true)
                .open(&path)
                .context(CreateFileSnafu { path: path.clone() })?;
            let file_meta = FileMeta {
                min_ts: 0,
                max_ts: 0,
                records: data.data.iter().map(|b| b.num_rows()).sum::<usize>() as i64,
                original_size: 0,
                compressed_size: 0,
            };
            let mut writer = new_parquet_writer(&mut f, &self.schema, &[], &file_meta);
            for batch in data.data.iter() {
                writer.write(batch).context(WriteParquetRecordBatchSnafu)?;
            }
            writer.close().context(WriteParquetRecordBatchSnafu)?;
        }
        Ok(())
    }
}

struct PartitionFile {
    data: Vec<RecordBatch>,
}

impl PartitionFile {
    fn new() -> Self {
        Self { data: Vec::new() }
    }

    fn write(&mut self, schema: Arc<Schema>, entry: Entry) -> Result<()> {
        let mut decoder = ReaderBuilder::new(schema)
            .with_batch_size(8192)
            .build_decoder()
            .context(CreateArrowJsonEncoderSnafu)?;
        let _ = decoder.serialize(&entry.data);
        let batch = decoder.flush().context(ArrowJsonEncodeSnafu)?;
        if let Some(batch) = batch {
            println!(
                "columns: {}, rows: {}",
                batch.num_columns(),
                batch.num_rows()
            );
            self.data.push(batch);
        }
        Ok(())
    }

    fn read(&self, _time_range: Option<(i64, i64)>) -> Result<Vec<RecordBatch>> {
        Ok(self.data.clone())
    }
}
