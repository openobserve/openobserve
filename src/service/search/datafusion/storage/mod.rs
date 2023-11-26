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

use thiserror::Error as ThisError;

pub mod file_list;
pub mod memory;
pub mod tmpfs;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageType {
    Memory,
    Tmpfs,
}

/// A specialized `Error` for in-memory object store-related errors
#[derive(ThisError, Debug)]
#[allow(missing_docs)]
enum Error {
    #[error("Out of range")]
    OutOfRange(String),
    #[error("Bad range")]
    BadRange(String),
}

impl From<Error> for object_store::Error {
    fn from(source: Error) -> Self {
        Self::Generic {
            store: "storage",
            source: Box::new(source),
        }
    }
}
