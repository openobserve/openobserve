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

use ingester::Entry;
use wal::FilePosition;

#[derive(Clone, Default)]
struct PipelineStreamInfo {
    pub stream_path: PathBuf,
    pub stream_endpoint: String,
    pub stream_org_id: String,
    pub stream_type: String,
    pub stream_name: String,
    pub stream_token: Option<String>,
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
    pub fn get_stream_name(&self) -> &str {
        self.stream_info.stream_name.as_str()
    }

    pub fn get_org_id(&self) -> &str {
        self.stream_info.stream_org_id.as_str()
    }

    pub fn get_stream_type(&self) -> &str {
        self.stream_info.stream_type.as_str()
    }

    pub fn get_token(&self) -> &str {
        // self.stream_info.stream_token.clone().unwrap_or_default()
        self.stream_info.stream_token.as_deref().unwrap_or_default()
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

    pub fn stream_name(mut self, stream_name: String) -> Self {
        self.stream_info.stream_name = stream_name;
        self
    }

    pub fn stream_path(mut self, path: PathBuf) -> Self {
        self.stream_info.stream_path = path;
        self
    }

    pub fn stream_endpoint(mut self, endpoint: String) -> Self {
        self.stream_info.stream_endpoint = endpoint;
        self
    }

    pub fn stream_org_id(mut self, org_id: String) -> Self {
        self.stream_info.stream_org_id = org_id;
        self
    }

    pub fn stream_type(mut self, stream_type: String) -> Self {
        self.stream_info.stream_type = stream_type;
        self
    }

    pub fn stream_token(mut self, token: Option<String>) -> Self {
        if let Some(token) = token {
            self.stream_info.stream_token = Some(format!("Basic {token}"));
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
        let stream_name = entry.stream.to_string();
        self.entry = entry;
        self.stream_name(stream_name)
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
