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

use std::{fs::create_dir_all, path::PathBuf, sync::Arc};

use arrow_schema::Schema;
use config::{
    meta::stream::FileMeta,
    metrics,
    utils::{
        parquet::{generate_filename_with_time_range, new_parquet_writer},
        schema_ext::SchemaExt,
    },
    CONFIG,
};
use snafu::ResultExt;
use tokio::{fs::OpenOptions, io::AsyncWriteExt};

use crate::{
    entry::{Entry, PersistStat, RecordBatchEntry},
    errors::*,
    rwmap::RwMap,
};

pub(crate) struct Partition {
    schema: Arc<Schema>,
    files: RwMap<Arc<str>, PartitionFile>, // key: hour, val: files
}

impl Partition {
    pub(crate) fn new(schema: Arc<Schema>) -> Self {
        metrics::INGEST_MEMTABLE_ARROW_BYTES
            .with_label_values(&[])
            .add(schema.size() as i64);
        Self {
            schema,
            files: RwMap::default(),
        }
    }

    pub(crate) async fn write(&self, entry: Entry) -> Result<usize> {
        let mut rw = self.files.write().await;
        let partition = rw
            .entry(entry.partition_key.clone())
            .or_insert_with(PartitionFile::new);
        partition.write(self.schema.clone(), entry)
    }

    pub(crate) async fn read(
        &self,
        time_range: Option<(i64, i64)>,
    ) -> Result<(Arc<Schema>, Vec<Arc<RecordBatchEntry>>)> {
        let r = self.files.read().await;
        let mut batches = Vec::with_capacity(r.len());
        for file in r.values() {
            batches.extend(file.read(time_range)?);
        }
        drop(r);
        Ok((self.schema.clone(), batches))
    }

    pub(crate) async fn persist(
        &self,
        thread_id: usize,
        org_id: &str,
        stream_type: &str,
        stream_name: &str,
    ) -> Result<(usize, Vec<(PathBuf, PersistStat)>)> {
        let base_path = PathBuf::from(&CONFIG.common.data_wal_dir);
        let mut path = base_path.clone();
        path.push("files");
        path.push(org_id);
        path.push(stream_type);
        path.push(stream_name);
        path.push(thread_id.to_string());
        let r = self.files.read().await;
        let mut paths = Vec::with_capacity(r.len());
        for (hour, data) in r.iter() {
            if data.data.is_empty() {
                continue;
            }
            let mut file_meta = FileMeta::default();
            data.data.iter().for_each(|r| {
                file_meta.original_size += r.data_json_size as i64;
                file_meta.records += r.data.num_rows() as i64;
                if file_meta.min_ts == 0 || file_meta.min_ts > r.min_ts {
                    file_meta.min_ts = r.min_ts;
                }
                if file_meta.max_ts < r.max_ts {
                    file_meta.max_ts = r.max_ts;
                }
            });
            let mut persist_stat = PersistStat {
                json_size: file_meta.original_size,
                arrow_size: 0,
                file_num: 1,
                batch_num: data.data.len(),
            };
            // write into parquet buf
            let (bloom_filter_fields, full_text_search_fields) =
                if self.schema.fields().len() > CONFIG.limit.file_move_fields_limit {
                    let bloom_filter_fields =
                        infra::schema::get_stream_setting_bloom_filter_fields(self.schema.as_ref())
                            .unwrap();
                    let full_text_search_fields =
                        infra::schema::get_stream_setting_fts_fields(self.schema.as_ref()).unwrap();
                    (bloom_filter_fields, full_text_search_fields)
                } else {
                    (vec![], vec![])
                };
            let mut buf_parquet = Vec::new();
            let mut writer = new_parquet_writer(
                &mut buf_parquet,
                &self.schema,
                &bloom_filter_fields,
                &full_text_search_fields,
                &file_meta,
            );
            for batch in data.data.iter() {
                persist_stat.arrow_size += batch.data_arrow_size;
                writer
                    .write(&batch.data)
                    .await
                    .context(WriteParquetRecordBatchSnafu)?;
            }
            writer.close().await.context(WriteParquetRecordBatchSnafu)?;
            file_meta.compressed_size = buf_parquet.len() as i64;

            // write into local file
            let file_name = generate_filename_with_time_range(file_meta.min_ts, file_meta.max_ts);
            let mut path = path.clone();
            path.push(hour.to_string());
            path.push(file_name);
            path.set_extension("par");
            create_dir_all(path.parent().unwrap())
                .context(CreateFileSnafu { path: path.clone() })?;
            let mut f = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&path)
                .await
                .context(CreateFileSnafu { path: path.clone() })?;
            f.write_all(&buf_parquet)
                .await
                .context(WriteFileSnafu { path: path.clone() })?;

            // set parquet metadata cache
            let mut file_key = path.clone();
            file_key.set_extension("parquet");
            let file_key = file_key
                .strip_prefix(base_path.clone())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
                .trim_start_matches('/')
                .to_string();
            super::WAL_PARQUET_METADATA
                .write()
                .await
                .insert(file_key, file_meta);

            // update metrics
            metrics::INGEST_WAL_USED_BYTES
                .with_label_values(&[org_id, stream_type])
                .add(buf_parquet.len() as i64);
            metrics::INGEST_WAL_WRITE_BYTES
                .with_label_values(&[org_id, stream_type])
                .inc_by(buf_parquet.len() as u64);

            paths.push((path, persist_stat));
        }
        Ok((self.schema.size(), paths))
    }
}

struct PartitionFile {
    data: Vec<Arc<RecordBatchEntry>>,
}

impl PartitionFile {
    fn new() -> Self {
        Self { data: Vec::new() }
    }

    fn write(&mut self, schema: Arc<Schema>, entry: Entry) -> Result<usize> {
        let Some(batch) = entry.into_batch(schema)? else {
            return Ok(0);
        };
        let arrow_size = batch.data_arrow_size;
        self.data.push(batch);
        metrics::INGEST_MEMTABLE_ARROW_BYTES
            .with_label_values(&[])
            .add(arrow_size as i64);
        metrics::INGEST_MEMTABLE_BYTES
            .with_label_values(&[])
            .add(entry.data_size as i64);
        Ok(arrow_size)
    }

    fn read(&self, time_range: Option<(i64, i64)>) -> Result<Vec<Arc<RecordBatchEntry>>> {
        match time_range {
            None | Some((0, 0)) => Ok(self.data.clone()),
            Some((min_ts, max_ts)) => Ok(self
                .data
                .iter()
                .filter(|r| r.min_ts <= max_ts && r.max_ts >= min_ts)
                .cloned()
                .collect()),
        }
    }
}
