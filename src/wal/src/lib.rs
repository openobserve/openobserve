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

mod errors;
mod reader;
mod writer;

use std::{collections::HashMap, path::PathBuf};

pub use errors::*;
pub use reader::Reader;
pub use writer::Writer;

const SOFT_MAX_BUFFER_LEN: usize = 1024 * 128; // 128KB

pub const FILE_TYPE_IDENTIFIER_LEN: usize = 13;
pub const ENTRY_HEADER_LEN: u64 = 8;
type FileTypeIdentifier = [u8; FILE_TYPE_IDENTIFIER_LEN];
const FILE_TYPE_IDENTIFIER: &FileTypeIdentifier = b"OPENOBSERVEV2";
const FILE_TYPE_IDENTIFIER_WITH_HEADER: &FileTypeIdentifier = b"OPENOBSERVEV3";
/// File extension for segment files.
const FILE_EXTENSION: &str = "wal";

pub type FilePosition = u64;
pub type FileHeader = HashMap<String, String>;
pub const WAL_FILE_HEADER_LEN: usize = 4;

#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum ReadFrom {
    #[default]
    Beginning,
    End,
    Checkpoint(FilePosition),
}

pub fn build_file_path(
    root_dir: impl Into<PathBuf>,
    org_id: &str,
    stream_type: &str,
    id: String,
) -> PathBuf {
    let mut path = root_dir.into();
    path.push(org_id);
    path.push(stream_type);
    path.push(id);
    path.set_extension(FILE_EXTENSION);
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_file_path_basic() {
        let path = build_file_path("/data", "myorg", "logs", "123".to_string());
        assert_eq!(path, PathBuf::from("/data/myorg/logs/123.wal"));
    }

    #[test]
    fn test_build_file_path_extension_is_wal() {
        let path = build_file_path("/tmp", "org", "metrics", "xyz".to_string());
        assert_eq!(path.extension().unwrap(), "wal");
    }

    #[test]
    fn test_build_file_path_contains_org_and_stream() {
        let path = build_file_path("/root", "tenant1", "traces", "abc-123".to_string());
        let s = path.to_str().unwrap();
        assert!(s.contains("tenant1"));
        assert!(s.contains("traces"));
        assert!(s.ends_with(".wal"));
    }

    #[test]
    fn test_read_from_default_is_beginning() {
        let r: ReadFrom = Default::default();
        assert_eq!(r, ReadFrom::Beginning);
    }

    #[test]
    fn test_read_from_checkpoint_stores_position() {
        let pos: FilePosition = 42;
        let r = ReadFrom::Checkpoint(pos);
        assert_eq!(r, ReadFrom::Checkpoint(42));
    }
}
