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

//! MIDX framing, sidecar paths, and block-scan context shared across crates.

use anyhow::{Context, Result, ensure};

use crate::{
    FileFormat,
    meta::stream::{FileKey, StreamType},
};

pub const MIDX_VERSION: u32 = 3;
pub const MIDX_MAGIC: &[u8; 8] = b"O2MIDX03";
pub const MIDX_TRAILER_LEN: usize = 32;

/// Lengths of the label, directory and header regions preceding the trailer, in file order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MidxTrailer {
    pub label_len: u64,
    pub directory_len: u64,
    pub header_len: u32,
}

impl MidxTrailer {
    pub fn encode(&self) -> [u8; MIDX_TRAILER_LEN] {
        let mut trailer = [0; MIDX_TRAILER_LEN];
        trailer[..8].copy_from_slice(&self.label_len.to_le_bytes());
        trailer[8..16].copy_from_slice(&self.directory_len.to_le_bytes());
        trailer[16..20].copy_from_slice(&self.header_len.to_le_bytes());
        trailer[20..24].copy_from_slice(&MIDX_VERSION.to_le_bytes());
        trailer[24..].copy_from_slice(MIDX_MAGIC);
        trailer
    }

    /// Parses the trailer that ends a file of `file_size` bytes and checks that its regions fit.
    pub fn read(trailer: &[u8], file_size: u64) -> Result<Self> {
        ensure!(
            trailer.len() == MIDX_TRAILER_LEN,
            "invalid MIDX trailer length"
        );
        ensure!(&trailer[24..] == MIDX_MAGIC, "unsupported MIDX magic");
        let version = u32::from_le_bytes(trailer[20..24].try_into()?);
        ensure!(
            version == MIDX_VERSION,
            "unsupported MIDX version {version}"
        );
        let parsed = Self {
            label_len: u64::from_le_bytes(trailer[..8].try_into()?),
            directory_len: u64::from_le_bytes(trailer[8..16].try_into()?),
            header_len: u32::from_le_bytes(trailer[16..20].try_into()?),
        };
        ensure!(parsed.header_len > 0, "empty MIDX header");
        ensure!(parsed.directory_len > 0, "empty MIDX directory");
        let metadata = parsed
            .label_len
            .checked_add(parsed.directory_len)
            .and_then(|len| len.checked_add(u64::from(parsed.header_len)))
            .and_then(|len| len.checked_add(MIDX_TRAILER_LEN as u64))
            .context("MIDX region length overflow")?;
        ensure!(metadata < file_size, "MIDX regions exceed file size");
        Ok(parsed)
    }

    /// End of the sample blocks and start of the label region; valid for the size read with.
    pub fn blocks_end(&self, file_size: u64) -> u64 {
        self.directory_start(file_size)
            .saturating_sub(self.label_len)
    }

    pub fn directory_start(&self, file_size: u64) -> u64 {
        self.header_start(file_size)
            .saturating_sub(self.directory_len)
    }

    pub fn header_start(&self, file_size: u64) -> u64 {
        file_size.saturating_sub(MIDX_TRAILER_LEN as u64 + u64::from(self.header_len))
    }
}

/// Immutable files selected for one PromQL block scan.
#[derive(Debug, Clone)]
pub struct MetricsBlockScan {
    pub table_name: String,
    pub files: Vec<FileKey>,
}

pub fn metrics_index_path(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 5 || parts[0] != "files" || parts[2] != StreamType::Metrics.as_str() {
        return None;
    }
    let name = *parts.last()?;
    let format = FileFormat::from_extension(name)?;
    let stem = name.strip_suffix(format.extension())?;
    if stem.strip_prefix("indexed-v3-").is_none_or(str::is_empty) {
        return None;
    }
    parts[2] = "mindex";
    let filename = format!("{stem}.midx");
    *parts.last_mut()? = &filename;
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trailer(header_len: u32, version: u32, magic: &[u8; 8]) -> Vec<u8> {
        let mut bytes = MidxTrailer {
            label_len: 5,
            directory_len: 7,
            header_len,
        }
        .encode()
        .to_vec();
        bytes[20..24].copy_from_slice(&version.to_le_bytes());
        bytes[24..].copy_from_slice(magic);
        bytes
    }

    #[test]
    fn trailer_bounds_regions_version_and_magic() {
        let parsed = MidxTrailer::read(&trailer(10, MIDX_VERSION, MIDX_MAGIC), 100).unwrap();
        assert_eq!(parsed.header_start(100), 58);
        assert_eq!(parsed.directory_start(100), 51);
        assert_eq!(parsed.blocks_end(100), 46);
        let mut overflow = trailer(10, MIDX_VERSION, MIDX_MAGIC);
        overflow[..8].copy_from_slice(&u64::MAX.to_le_bytes());
        let mut empty_directory = trailer(10, MIDX_VERSION, MIDX_MAGIC);
        empty_directory[8..16].copy_from_slice(&0u64.to_le_bytes());
        for (bytes, size) in [
            (trailer(10, MIDX_VERSION, MIDX_MAGIC), 54),
            (trailer(0, MIDX_VERSION, MIDX_MAGIC), 100),
            (trailer(u32::MAX, MIDX_VERSION, MIDX_MAGIC), 1024),
            (trailer(10, 2, MIDX_MAGIC), 100),
            (trailer(10, MIDX_VERSION, b"O2MIDX02"), 100),
            (trailer(10, MIDX_VERSION, MIDX_MAGIC)[1..].to_vec(), 100),
            (overflow, u64::MAX),
            (empty_directory, 100),
        ] {
            assert!(MidxTrailer::read(&bytes, size).is_err());
        }
    }
}
