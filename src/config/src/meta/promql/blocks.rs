// Copyright 2026 OpenObserve Inc.
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

use crate::{
    FileFormat,
    meta::stream::{FileKey, StreamType},
};

pub fn metrics_index_path(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 5 || parts[0] != "files" || parts[2] != StreamType::Metrics.as_str() {
        return None;
    }
    let name = *parts.last()?;
    let format = FileFormat::from_extension(name)?;
    let stem = name.strip_suffix(format.extension())?;
    if stem.strip_prefix("indexed-v1-").is_none_or(str::is_empty) {
        return None;
    }
    parts[2] = "midx";
    let filename = format!("{stem}.midx");
    *parts.last_mut()? = &filename;
    Some(parts.join("/"))
}

/// Query-authorized immutable files with exact selections or an unfiltered full scan.
#[derive(Debug, Clone)]
pub struct MetricsBlockScan {
    pub table_name: String,
    pub files: Vec<FileKey>,
    pub unfiltered: bool,
}
