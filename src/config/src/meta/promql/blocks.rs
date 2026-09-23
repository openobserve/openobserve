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

use std::ops::Range;

use anyhow::{Context, Result, ensure};

use crate::{
    FileFormat,
    meta::stream::{FileKey, StreamType},
};

pub const MIDX_FOOTER_LEN: usize = 32;
pub const MIDX_VERSION: u32 = 2;
pub const MIDX_FOOTER_MAGIC: &[u8; 8] = b"O2MIDX02";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidxFooter {
    pub version: u32,
    pub metadata_range: Range<u64>,
    pub payload_end: u64,
}

pub fn read_midx_footer(bytes: &[u8], file_size: u64) -> Result<MidxFooter> {
    ensure!(
        bytes.len() == MIDX_FOOTER_LEN && file_size >= MIDX_FOOTER_LEN as u64,
        "invalid footer length"
    );
    let u32_at = |start: usize| -> Result<u32> {
        Ok(u32::from_le_bytes(
            bytes
                .get(start..start + 4)
                .context("truncated footer")?
                .try_into()?,
        ))
    };
    let u64_at = |start: usize| -> Result<u64> {
        Ok(u64::from_le_bytes(
            bytes
                .get(start..start + 8)
                .context("truncated footer")?
                .try_into()?,
        ))
    };
    let version = u32_at(0)?;
    ensure!(
        version == MIDX_VERSION && &bytes[24..] == MIDX_FOOTER_MAGIC,
        "unsupported block-index version/magic"
    );
    ensure!(u32_at(4)? == 0, "unsupported block-index reserved field");
    let offset = u64_at(8)?;
    let length = u64_at(16)?;
    ensure!(length > 0, "metadata size limit");
    let end = offset
        .checked_add(length)
        .context("metadata range overflow")?;
    ensure!(
        end.checked_add(MIDX_FOOTER_LEN as u64) == Some(file_size),
        "metadata/footer outside file bounds"
    );
    Ok(MidxFooter {
        version,
        metadata_range: offset..end,
        payload_end: offset,
    })
}

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
