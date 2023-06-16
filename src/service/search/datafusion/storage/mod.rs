// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use thiserror::Error as ThisError;

pub mod file_list;
pub mod memory; // fsm: File system with memory cache
pub mod nocache; // fsn: File system without memory cahce
pub mod tmpfs;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageType {
    FsMemory,  // fsm
    FsNoCache, // fsn
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
