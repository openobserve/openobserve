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

use std::path::PathBuf;

use once_cell::sync::Lazy;
use parking_lot::Mutex;

use crate::{memtable::MemTable, writer::WriterKey};

pub static IMMUTABLES: Lazy<Mutex<Vec<Entry>>> = Lazy::new(|| Mutex::new(Vec::with_capacity(16)));

#[warn(dead_code)]
pub struct Entry {
    key: WriterKey,
    wal_path: PathBuf,
    memtable: MemTable,
}

impl Entry {
    pub fn new(key: WriterKey, wal_path: PathBuf, memtable: MemTable) -> Self {
        Self {
            key,
            wal_path,
            memtable,
        }
    }
}
