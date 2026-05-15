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

use std::{io, num, path::PathBuf};

use snafu::Snafu;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum Error {
    FileIdentifierMismatch {},
    #[snafu(display("Failed to open file {}: {}", path.display(), source))]
    FileOpen {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to read file {}: {}", path.display(), source))]
    FileRead {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to write file {}: {}", path.display(), source))]
    FileWrite {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to sync file {}: {}", path.display(), source))]
    FileSync {
        source: io::Error,
        path: PathBuf,
    },
    WriteFileType {
        source: io::Error,
    },
    EntrySizeTooLarge {
        source: num::TryFromIntError,
        actual: usize,
    },
    UnableToCompressData {
        source: io::Error,
    },
    WriteChecksum {
        source: io::Error,
    },
    WriteLength {
        source: io::Error,
    },
    WriteData {
        source: io::Error,
    },
    UnableToReadArray {
        source: io::Error,
        length: usize,
    },
    UnableToReadChecksum {
        source: io::Error,
    },
    UnableToReadLength {
        source: io::Error,
    },
    UnableToReadData {
        source: io::Error,
    },
    LengthMismatch {
        expected: u64,
        actual: u64,
    },
    ChecksumMismatch {
        expected: u32,
        actual: u32,
    },
    WriteQueueFull {
        idx: usize,
    },
    #[snafu(display("Provided path '{}' has no parent directory", path.display()))]
    NoParentDir {
        path: PathBuf,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_length_mismatch_debug() {
        let err = Error::LengthMismatch {
            expected: 10,
            actual: 5,
        };
        let s = format!("{err:?}");
        assert!(s.contains("LengthMismatch"));
    }

    #[test]
    fn test_checksum_mismatch_debug() {
        let err = Error::ChecksumMismatch {
            expected: 0xdeadbeef,
            actual: 0x12345678,
        };
        let s = format!("{err:?}");
        assert!(s.contains("ChecksumMismatch"));
    }

    #[test]
    fn test_file_identifier_mismatch_debug() {
        let err = Error::FileIdentifierMismatch {};
        let s = format!("{err:?}");
        assert!(s.contains("FileIdentifierMismatch"));
    }

    #[test]
    fn test_no_parent_dir_display() {
        let err = Error::NoParentDir {
            path: PathBuf::from("/file.wal"),
        };
        let display = format!("{err}");
        assert!(display.contains("/file.wal"));
    }

    #[test]
    fn test_write_queue_full_debug() {
        let err = Error::WriteQueueFull { idx: 7 };
        let s = format!("{err:?}");
        assert!(s.contains("WriteQueueFull"));
    }

    #[test]
    fn test_file_open_display() {
        let err = Error::FileOpen {
            source: io::Error::new(io::ErrorKind::NotFound, "no such file"),
            path: PathBuf::from("/tmp/test.wal"),
        };
        let display = format!("{err}");
        assert!(display.contains("/tmp/test.wal"));
        assert!(display.contains("Failed to open file"));
    }

    #[test]
    fn test_file_read_display() {
        let err = Error::FileRead {
            source: io::Error::new(io::ErrorKind::BrokenPipe, "broken"),
            path: PathBuf::from("/tmp/read.wal"),
        };
        let display = format!("{err}");
        assert!(display.contains("/tmp/read.wal"));
        assert!(display.contains("Failed to read file"));
    }

    #[test]
    fn test_file_write_display() {
        let err = Error::FileWrite {
            source: io::Error::new(io::ErrorKind::PermissionDenied, "denied"),
            path: PathBuf::from("/tmp/write.wal"),
        };
        let display = format!("{err}");
        assert!(display.contains("/tmp/write.wal"));
        assert!(display.contains("Failed to write file"));
    }

    #[test]
    fn test_file_sync_display() {
        let err = Error::FileSync {
            source: io::Error::new(io::ErrorKind::Other, "sync failed"),
            path: PathBuf::from("/tmp/sync.wal"),
        };
        let display = format!("{err}");
        assert!(display.contains("/tmp/sync.wal"));
        assert!(display.contains("Failed to sync file"));
    }

    #[test]
    fn test_write_file_type_debug() {
        let err = Error::WriteFileType {
            source: io::Error::new(io::ErrorKind::WriteZero, "zero"),
        };
        let s = format!("{err:?}");
        assert!(s.contains("WriteFileType"));
    }

    #[test]
    fn test_unable_to_compress_data_debug() {
        let err = Error::UnableToCompressData {
            source: io::Error::new(io::ErrorKind::InvalidData, "bad"),
        };
        let s = format!("{err:?}");
        assert!(s.contains("UnableToCompressData"));
    }

    #[test]
    fn test_unable_to_read_array_debug() {
        let err = Error::UnableToReadArray {
            source: io::Error::new(io::ErrorKind::UnexpectedEof, "eof"),
            length: 42,
        };
        let s = format!("{err:?}");
        assert!(s.contains("UnableToReadArray"));
    }
}
