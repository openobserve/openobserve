// Copyright 2024 Zinc Labs Inc.
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
}
