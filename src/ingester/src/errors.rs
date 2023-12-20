// Copyright 2023 Zinc Labs Inc.
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
    Message {
        message: String,
    },
    CreateFileError {
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
    WriteParquetRecordBatchError {
        source: parquet::errors::ParquetError,
    },
}
