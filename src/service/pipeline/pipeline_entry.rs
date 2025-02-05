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

use std::{path::PathBuf, sync::Arc};

use hashbrown::HashMap;
use ingester::Entry;
use wal::FilePosition;

#[derive(Clone, Default)]
struct PipelineStreamInfo {
    pub stream_path: PathBuf,
    pub stream_endpoint: String,
    pub stream_header: Option<HashMap<String, String>>,
    #[allow(dead_code)]
    pub stream_tls_cert_path: Option<String>,
    #[allow(dead_code)]
    pub stream_tls_key_path: Option<String>,
}
#[derive(Clone, Default)]
pub struct PipelineEntry {
    stream_info: PipelineStreamInfo,
    entry: Entry,
    entry_position: FilePosition,
}

impl PipelineEntry {
    pub fn get_stream_endpoint_header(&self) -> Option<&HashMap<String, String>> {
        self.stream_info.stream_header.as_ref()
    }

    pub fn get_stream_path(&self) -> PathBuf {
        self.stream_info.stream_path.clone()
    }

    pub fn get_stream_endpoint(&self) -> &str {
        self.stream_info.stream_endpoint.as_str()
    }

    pub fn get_entry_data(&self) -> &Vec<Arc<serde_json::Value>> {
        &self.entry.data
    }

    pub fn get_entry_position(&self) -> FilePosition {
        self.entry_position
    }
}

#[derive(Default)]
pub struct PipelineEntryBuilder {
    stream_info: PipelineStreamInfo,
    entry: Entry,
    entry_position: FilePosition,
}

impl PipelineEntryBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stream_path(mut self, path: PathBuf) -> Self {
        self.stream_info.stream_path = path;
        self
    }

    pub fn stream_endpoint(mut self, endpoint: String) -> Self {
        self.stream_info.stream_endpoint = endpoint;
        self
    }

    pub fn stream_header(mut self, header: Option<HashMap<String, String>>) -> Self {
        if let Some(header) = header {
            self.stream_info.stream_header = Some(header);
        }
        self
    }

    #[allow(dead_code)]
    pub fn stream_tls_cert_path(mut self, cert_path: Option<String>) -> Self {
        self.stream_info.stream_tls_cert_path = cert_path;
        self
    }

    #[allow(dead_code)]
    pub fn stream_tls_key_path(mut self, key_path: Option<String>) -> Self {
        self.stream_info.stream_tls_key_path = key_path;
        self
    }

    pub fn entry(mut self, entry: Entry) -> Self {
        self.entry = entry;
        self
    }

    pub fn set_entry_position_of_file(mut self, position: FilePosition) -> Self {
        self.entry_position = position;
        self
    }

    pub fn build(self) -> PipelineEntry {
        PipelineEntry {
            stream_info: self.stream_info,
            entry: self.entry,
            entry_position: self.entry_position,
        }
    }
}
