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

use std::{
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
};

use hashbrown::HashMap;
use infra::errors::{Error, Result};
use ingester::Entry;
use serde::{Deserialize, Serialize};
use wal::{FilePosition, ReadFrom, Reader, ENTRY_HEADER_LEN};

use crate::service::{
    alerts::destinations,
    db,
    pipeline::{pipeline_exporter::PipelineExporter, pipeline_wal_writer::get_metadata_motified},
};

/// File position to use when reading a new file.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadFromConfig {
    /// Read from the beginning of the file.
    Beginning,

    /// Start reading from the current end of the file.
    End,
}

impl From<ReadFromConfig> for ReadFrom {
    fn from(rfc: ReadFromConfig) -> Self {
        match rfc {
            ReadFromConfig::Beginning => ReadFrom::Beginning,
            ReadFromConfig::End => ReadFrom::End,
        }
    }
}
pub struct PipelineReceiver {
    pub path: PathBuf,
    org_id: String,
    reader: Reader<BufReader<File>>,
    file_position: FilePosition,
    pub pipeline_exporter: Option<PipelineExporter>,
    pub reader_header: wal::FileHeader,
}

impl std::fmt::Debug for PipelineReceiver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileReceiver")
            .field("path", &self.path)
            .field("org_id", &self.org_id)
            .field("reader_header", &self.reader_header)
            .field("file_position", &self.get_file_position())
            .finish()
    }
}

impl PipelineReceiver {
    pub fn new(path: PathBuf, read_from: ReadFrom) -> Result<PipelineReceiver> {
        let mut reader = Reader::from_path_position(path.clone(), read_from)
            .map_err(|e| Error::WalFileError(e.to_string()))?;
        let file_position = match read_from {
            ReadFrom::Checkpoint(file_position) if file_position > 0 => file_position,
            ReadFrom::Checkpoint(_) => reader.current_position()?,
            ReadFrom::Beginning => reader.current_position()?,
            ReadFrom::End => {
                // impossible
                unimplemented!("should not read from end");
            }
        };

        let file_str = Self::strip_and_format_path(&path)?;
        let file_columns = file_str.split('/').collect::<Vec<_>>();
        if file_columns.len() < 3 {
            return Err(Error::Message(format!(
                "Invalid file path: {}",
                path.display()
            )));
        }

        let _ = file_columns[file_columns.len() - 2]; // this should be always pipeline
        let org_id = file_columns[file_columns.len() - 3];

        let reader_header = reader.header().clone();

        Ok(PipelineReceiver {
            path,
            org_id: org_id.to_string(),
            reader,
            file_position,
            pipeline_exporter: None,
            reader_header,
        })
    }

    fn strip_and_format_path(path: &Path) -> Result<String> {
        let wal_dir = PathBuf::from(&config::get_config().pipeline.remote_stream_wal_dir)
            .join(ingester::WAL_DIR_DEFAULT_PREFIX);

        path.strip_prefix(&wal_dir)
            .map_err(|_| {
                Error::Message(format!(
                    "Path does not start with wal_dir: {}, path: {}",
                    wal_dir.display(),
                    path.display(),
                ))
            })?
            .to_str()
            .ok_or_else(|| Error::Message(format!("Invalid UTF-8 in path: {}", path.display())))
            .map(|s| s.replace('\\', "/"))
    }

    pub fn get_file_position(&self) -> FilePosition {
        self.file_position
    }

    pub fn set_file_position(&mut self, len: u64) {
        self.file_position += ENTRY_HEADER_LEN + len
    }

    pub fn get_org_id(&self) -> &str {
        self.org_id.as_str()
    }

    pub async fn get_destination_name(&self) -> Result<String> {
        self.reader_header
            .get("destination_name")
            .map(|s| s.to_string())
            .ok_or(Error::Message(
                "get_stream_endpoint get destination_name fail".to_string(),
            ))
    }

    pub async fn get_stream_endpoint(&self) -> Result<String> {
        let destination_name = self.get_destination_name().await?;
        let org_id = self.get_org_id();
        match destinations::get(org_id, destination_name.as_str()).await {
            Ok(data) => {
                if data.url.ends_with('/') {
                    Ok(data.url.trim_end_matches('/').to_string())
                } else {
                    Ok(data.url)
                }
            }
            Err(_) => Ok("".to_string()),
        }
    }

    pub async fn get_skip_tls_verify(&self, org_id: &str, destination_name: &str) -> bool {
        match destinations::get(org_id, destination_name).await {
            Ok(data) => data.skip_tls_verify,
            Err(_) => true,
        }
    }

    pub async fn get_stream_endpoint_header(&self) -> Option<HashMap<String, String>> {
        let destination_name = self.get_destination_name().await.unwrap_or("".to_string());
        let org_id = self.get_org_id();
        match destinations::get(org_id, destination_name.as_str()).await {
            Ok(data) => data.headers,
            Err(_) => None,
        }
    }

    // unit is seconds, need to convert to milliseconds
    pub async fn get_stream_export_max_retry_time(&self) -> u64 {
        config::get_config().pipeline.remote_request_max_retry_time * 1000
    }

    pub async fn get_stream_data_retention_days(&self) -> i64 {
        let pipeline_id = self.reader_header.get("pipeline_id").ok_or(Error::Message(
            "get_stream_data_retention_days get pipeline_id fail".to_string(),
        ));

        if pipeline_id.is_err() {
            return config::get_config().compact.data_retention_days;
        }

        let pipeline = db::pipeline::get_by_id(pipeline_id.unwrap().as_str()).await;

        if pipeline.is_err() {
            return config::get_config().compact.data_retention_days;
        }

        let stream_params = pipeline.unwrap().get_source_stream_params();
        match infra::schema::get_settings(
            stream_params.org_id.as_str(),
            stream_params.stream_name.as_str(),
            stream_params.stream_type,
        )
        .await
        {
            Some(settings) if settings.data_retention > 0 => settings.data_retention,
            Some(_) => config::get_config().compact.data_retention_days,
            None => config::get_config().compact.data_retention_days,
        }
    }

    /// Read a entry from the wal file
    pub fn read_entry(&mut self) -> Result<(Option<Entry>, FilePosition)> {
        let (entry_bytes, len) = match self.read_entry_vecu8()? {
            (Some(bytes), len) => (bytes, len),
            (None, _) => return Ok((None, 0)), // read to the end of the file
        };

        let entry = Entry::from_bytes(&entry_bytes).map_err(|e| {
            let str = e.to_string();
            log::error!("Unable to read entry : {}, skipping entry", str);
            Error::Message(str)
        })?;

        self.set_file_position(len);

        Ok((Some(entry), self.get_file_position()))
    }

    pub fn read_entry_vecu8(&mut self) -> Result<(Option<Vec<u8>>, u64)> {
        self.reader
            .read_entry_with_length()
            .map_err(|e| Error::Message(e.to_string()))
    }

    /// delete file when receiver read to the end and wal file modified time over
    /// max_file_retention_time
    pub fn should_delete_on_file_retention(&self) -> bool {
        if let Ok(metadata) = self.reader.metadata() {
            let modified = get_metadata_motified(&metadata);
            let cfg = &config::get_config();
            log::debug!(
                "PipelineReceiver should_delete_on_file_retention file {} modified elapsed: {} ",
                self.reader.path().display(),
                modified.elapsed().as_secs()
            );
            modified.elapsed().as_secs() > cfg.limit.max_file_retention_time
        } else {
            true
        }
    }

    /// delete file when wal file modified time over max data retention
    pub async fn should_delete_on_data_retention(&self) -> bool {
        if let Ok(metadata) = self.reader.metadata() {
            let modified = get_metadata_motified(&metadata);
            let retention_time = self.get_stream_data_retention_days().await;
            log::debug!(
                "PipelineReceiver should_delete_on_data_retention file {} modified elapsed: {}, retention_time: {} ",
                self.reader.path().display(),
                modified.elapsed().as_secs(),
                retention_time
            );
            modified.elapsed().as_secs() > (retention_time * 24 * 3600) as u64
        } else {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs::remove_file, path, sync::Arc, thread::sleep, time::Duration};

    use ingester::{Entry, WAL_DIR_DEFAULT_PREFIX};
    use parquet::data_type::AsBytes;
    use serde_json::Value;
    use wal::{build_file_path, ReadFrom, Writer};

    use crate::service::pipeline::pipeline_receiver::PipelineReceiver;

    #[test]
    fn test_read_entry() {
        env::set_var("ZO_PIPELINE_REMOTE_STREAM_WAL_DIR", "/tmp");
        let entry_num = 100;
        let config = &config::get_config();
        let dir = path::PathBuf::from(&config.pipeline.remote_stream_wal_dir)
            .join(WAL_DIR_DEFAULT_PREFIX);
        let mut writer = Writer::build(
            dir.clone(),
            "org",
            "stream",
            "2".to_string(),
            1024_1024,
            8 * 1024,
            None,
        )
        .unwrap();
        for i in 0..entry_num {
            let mut entry = Entry {
                stream: Arc::from("example_stream"),
                schema: None, // 示例空 Schema
                schema_key: Arc::from("example_schema_key"),
                partition_key: Arc::from("2023/12/18/00/country=US/state=CA"),
                data: vec![Arc::new(Value::String(format!("example_data_{i}")))],
                data_size: 1,
            };
            let bytes_entries = entry.into_bytes().unwrap();
            writer.write(bytes_entries.as_bytes()).unwrap();
        }
        writer.close().unwrap();

        let path = build_file_path(dir, "org", "stream", "2".to_string());
        let mut fw = PipelineReceiver::new(path.clone(), ReadFrom::Beginning).unwrap();
        for _ in 0..entry_num {
            let entry = fw.read_entry().unwrap();
            assert_eq!(entry.0.unwrap().stream, Arc::from("example_stream"));
        }

        remove_file(path).unwrap();
    }

    // #[test]
    // fn test_read_wal_raw() {
    //     let path =
    // PathBuf::from("./data/openobserve/remote_stream_wal/logs/default/logs/1736958873319801.wal");
    //     let mut fw = PipelineReceiver::new(path.clone(), ReadFrom::Beginning).unwrap();
    //     while let (Some(entry), pos) = fw.read_entry().unwrap() {
    //         println!("post:{}, stream: {}, schema_key: {}, data: {:?}", pos, entry.stream,
    // entry.schema_key, entry.data);     }
    // }
    #[test]
    fn test_file_position() {
        env::set_var("ZO_PIPELINE_REMOTE_STREAM_WAL_DIR", "/tmp");
        let entry_num = 100;
        let config = &config::get_config();
        let dir = path::PathBuf::from(&config.pipeline.remote_stream_wal_dir)
            .join(WAL_DIR_DEFAULT_PREFIX);
        let mut writer = Writer::build(
            dir.clone(),
            "org",
            "stream",
            "3".to_string(),
            1024_1024,
            8 * 1024,
            None,
        )
        .unwrap();
        for i in 0..entry_num {
            let mut entry = Entry {
                stream: Arc::from("example_stream"),
                schema: None, // Schema
                schema_key: Arc::from("example_schema_key"),
                partition_key: Arc::from("2023/12/18/00/country=US/state=CA"),
                data: vec![Arc::new(Value::String(format!("example_data_{i}")))],
                data_size: 1,
            };
            let bytes_entries = entry.into_bytes().unwrap();
            writer.write(bytes_entries.as_bytes()).unwrap();
        }
        writer.close().unwrap();

        let path = build_file_path(dir, "org", "stream", "3".to_string());
        let mut fw = PipelineReceiver::new(path.clone(), ReadFrom::Beginning).unwrap();
        let mut file_position = fw.get_file_position();
        for _ in 0..entry_num {
            let (_, tmp_file_position) = fw.read_entry().unwrap();
            file_position = tmp_file_position;
        }

        let _fw = PipelineReceiver::new(path.clone(), ReadFrom::Checkpoint(file_position)).unwrap();
        sleep(Duration::from_secs(1));
        if let Err(err) = remove_file(path) {
            println!("remove file error: {:?}", err);
        }
    }
}
