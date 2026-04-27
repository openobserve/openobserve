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

use std::{io, path::PathBuf};

use snafu::Snafu;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum Error {
    WalError {
        source: wal::Error,
    },
    #[snafu(display("Failed to open file {}: {}", path.display(), source))]
    OpenFileError {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to open directory {}: {}", path.display(), source))]
    OpenDirError {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to create file {}: {}", path.display(), source))]
    CreateFileError {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to delete file {}: {}", path.display(), source))]
    DeleteFileError {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to rename file {}: {}", path.display(), source))]
    RenameFileError {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to read file {}: {}", path.display(), source))]
    ReadFileError {
        source: io::Error,
        path: PathBuf,
    },
    #[snafu(display("Failed to write file {}: {}", path.display(), source))]
    WriteFileError {
        source: io::Error,
        path: PathBuf,
    },
    WriteDataError {
        source: io::Error,
    },
    ReadDataError {
        source: io::Error,
    },
    JSONSerialization {
        source: serde_json::Error,
    },
    FromUtf8Error {
        source: std::string::FromUtf8Error,
    },
    NotImplemented,
    InferJsonSchemaError {
        source: arrow::error::ArrowError,
    },
    MergeSchemaError {
        source: arrow::error::ArrowError,
    },
    CreateArrowWriterError {
        source: arrow::error::ArrowError,
    },
    WriteArrowRecordBatchError {
        source: arrow::error::ArrowError,
    },
    CreateArrowJsonEncoder {
        source: arrow::error::ArrowError,
    },
    ArrowJsonEncodeError {
        source: arrow::error::ArrowError,
    },
    ReadParquetFileError {
        source: parquet::errors::ParquetError,
    },
    WriteParquetRecordBatchError {
        source: parquet::errors::ParquetError,
    },
    MergeRecordBatchError {
        source: datafusion::error::DataFusionError,
    },
    TokioJoinError {
        source: tokio::task::JoinError,
    },
    TokioMpscSendError {
        source: tokio::sync::mpsc::error::SendError<PathBuf>,
    },
    TokioMpscSendEntriesError {
        source:
            tokio::sync::mpsc::error::SendError<(crate::WriterSignal, crate::ProcessedBatch, bool)>,
    },
    #[snafu(display("MemoryTableOverflowError"))]
    MemoryTableOverflowError {},
    #[snafu(display("MemoryCircuitBreakerError"))]
    MemoryCircuitBreakerError {},
    #[snafu(display("DiskCircuitBreakerError"))]
    DiskCircuitBreakerError {},
    ExternalError {
        source: Box<dyn std::error::Error + Send + Sync>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_table_overflow_error_display() {
        let e = Error::MemoryTableOverflowError {};
        assert_eq!(e.to_string(), "MemoryTableOverflowError");
    }

    #[test]
    fn test_memory_circuit_breaker_error_display() {
        let e = Error::MemoryCircuitBreakerError {};
        assert_eq!(e.to_string(), "MemoryCircuitBreakerError");
    }

    #[test]
    fn test_disk_circuit_breaker_error_display() {
        let e = Error::DiskCircuitBreakerError {};
        assert_eq!(e.to_string(), "DiskCircuitBreakerError");
    }

    #[test]
    fn test_open_file_error_display() {
        let e = Error::OpenFileError {
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "no such file"),
            path: "/tmp/test.wal".into(),
        };
        assert!(e.to_string().contains("/tmp/test.wal"));
    }

    #[test]
    fn test_open_dir_error_display() {
        let e = Error::OpenDirError {
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "not found"),
            path: "/tmp/test_dir".into(),
        };
        assert!(e.to_string().contains("/tmp/test_dir"));
        assert!(e.to_string().contains("Failed to open directory"));
    }

    #[test]
    fn test_create_file_error_display() {
        let e = Error::CreateFileError {
            source: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
            path: "/tmp/new.wal".into(),
        };
        assert!(e.to_string().contains("/tmp/new.wal"));
        assert!(e.to_string().contains("Failed to create file"));
    }

    #[test]
    fn test_delete_file_error_display() {
        let e = Error::DeleteFileError {
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "missing"),
            path: "/tmp/old.wal".into(),
        };
        assert!(e.to_string().contains("/tmp/old.wal"));
        assert!(e.to_string().contains("Failed to delete file"));
    }

    #[test]
    fn test_rename_file_error_display() {
        let e = Error::RenameFileError {
            source: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "no perms"),
            path: "/tmp/rename.wal".into(),
        };
        assert!(e.to_string().contains("/tmp/rename.wal"));
        assert!(e.to_string().contains("Failed to rename file"));
    }

    #[test]
    fn test_read_file_error_display() {
        let e = Error::ReadFileError {
            source: std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof"),
            path: "/tmp/read.wal".into(),
        };
        assert!(e.to_string().contains("/tmp/read.wal"));
        assert!(e.to_string().contains("Failed to read file"));
    }

    #[test]
    fn test_write_file_error_display() {
        let e = Error::WriteFileError {
            source: std::io::Error::new(std::io::ErrorKind::WriteZero, "no space"),
            path: "/tmp/write.wal".into(),
        };
        assert!(e.to_string().contains("/tmp/write.wal"));
        assert!(e.to_string().contains("Failed to write file"));
    }
}
