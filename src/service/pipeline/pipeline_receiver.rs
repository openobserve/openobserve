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

use infra::errors::{Error, Result};
use ingester::Entry;
use serde::{Deserialize, Serialize};
use wal::{FilePosition, ReadFrom, Reader, ENTRY_HEADER_LEN};
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
    pub org_id: String,
    pub stream_type: String,
    reader: Reader<BufReader<File>>,
    file_position: FilePosition,
}

impl std::fmt::Debug for PipelineReceiver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileReceiver")
            .field("path", &self.path)
            .field("org_id", &self.org_id)
            .field("stream_type", &self.stream_type)
            .field("file_position", &self.get_file_position())
            .finish()
    }
}

impl PipelineReceiver {
    pub fn new(path: PathBuf, read_from: ReadFrom) -> Result<PipelineReceiver> {
        let reader = Reader::from_path_position(path.clone(), read_from).unwrap();
        let file_position = match read_from {
            ReadFrom::Checkpoint(file_position) => file_position,
            ReadFrom::Beginning => wal::FILE_TYPE_IDENTIFIER_LEN as u64,
            ReadFrom::End => {
                // cant be possible
                unimplemented!();
            }
        };

        let file_str = Self::strip_and_format_path(&path)?;
        let file_columns = file_str.split('/').collect::<Vec<_>>();
        let stream_type = file_columns[file_columns.len() - 2];
        let org_id = file_columns[file_columns.len() - 3];
        // todo: find out stream_name
        Ok(PipelineReceiver {
            path,
            org_id: org_id.to_string(),
            stream_type: stream_type.to_string(),
            reader,
            file_position,
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

    /// Read a entry from the wal file
    pub(super) fn read_entry(&mut self) -> Result<(Option<Entry>, FilePosition)> {
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

    pub(super) fn read_entry_vecu8(&mut self) -> Result<(Option<Vec<u8>>, u64)> {
        self.reader
            .read_entry_with_length()
            .map_err(|e| Error::Message(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs::remove_file, path, sync::Arc};

    use ingester::{Entry, WAL_DIR_DEFAULT_PREFIX};
    use parquet::data_type::AsBytes;
    use serde_json::Value;
    use wal::{build_file_path, ReadFrom, Writer};

    use crate::service::pipeline::pipeline_receiver::PipelineReceiver;
    #[test]
    fn test_read_entry_vecu8() {
        env::set_var("ZO_PIPELINE_REMOTE_STREAM_WAL_DIR", "/tmp");
        let entry_num = 100;
        let config = &config::get_config();
        let dir = path::PathBuf::from(&config.pipeline.remote_stream_wal_dir)
            .join(WAL_DIR_DEFAULT_PREFIX);
        let mut writer = Writer::new(dir.clone(), "org", "stream", 1, 1024_1024, 8 * 1024).unwrap();
        for i in 0..entry_num {
            let data = format!("hello world {}", i);
            writer.write(data.as_bytes()).unwrap();
        }
        writer.close().unwrap();

        let path = build_file_path(dir, "org", "stream", 1);
        let mut fw = PipelineReceiver::new(path.clone(), ReadFrom::Beginning).unwrap();
        for i in 0..entry_num {
            let data = format!("hello world {}", i);
            log::info!("{}", data);
            let entry = fw.read_entry_vecu8().unwrap();
            assert_eq!(entry.0.unwrap(), data.as_bytes());
        }
        remove_file(path).unwrap();
    }

    #[test]
    fn test_read_entry() {
        env::set_var("ZO_PIPELINE_REMOTE_STREAM_WAL_DIR", "/tmp");
        let entry_num = 100;
        let config = &config::get_config();
        let dir = path::PathBuf::from(&config.pipeline.remote_stream_wal_dir)
            .join(WAL_DIR_DEFAULT_PREFIX);
        let mut writer = Writer::new(dir.clone(), "org", "stream", 2, 1024_1024, 8 * 1024).unwrap();
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

        let path = build_file_path(dir, "org", "stream", 2);
        let mut fw = PipelineReceiver::new(path.clone(), ReadFrom::Beginning).unwrap();
        for _ in 0..entry_num {
            let entry = fw.read_entry().unwrap();
            assert_eq!(entry.0.unwrap().stream, Arc::from("example_stream"));
        }

        remove_file(path).unwrap();
    }
}
