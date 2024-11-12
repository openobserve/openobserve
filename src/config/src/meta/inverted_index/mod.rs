// Copyright 2024 OpenObserve Inc.
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

pub mod reader;
pub mod search;
pub mod writer;

use anyhow::Result;
use serde::{Deserialize, Serialize};

const INDEX_FILE_METAS_SIZE_SIZE: u64 = 4;

type Bytes = Vec<u8>;
type BytesRef<'a> = &'a [u8];

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ColumnIndexMeta {
    // total byte size of this column index date
    #[serde(default)]
    pub index_size: u64,
    // fst bytes offset relative to the `base_offset`
    #[serde(default)]
    pub relative_fst_offset: u32,
    // total byte size of fst bytes
    #[serde(default)]
    pub fst_size: u32,
    // the minimum term length indexed in this column
    #[serde(default = "default_min_len")]
    pub min_len: usize,
    // the maximum term length indexed in this column
    #[serde(default)]
    pub max_len: usize,
    // the minimum value (alphabetically) indexed in this column.
    #[serde(default)]
    pub min_val: Bytes,
    // the maximum value (alphabetically) indexed in this column.
    #[serde(default)]
    pub max_val: Bytes,
}

const fn default_min_len() -> usize {
    usize::MAX
}

/// Supported inverted index formats:
///  - Parquet (v2): Index is stored in parquet format
///  - Tantivy (v3): Index is stored in custom puffin format files
///  - both: Use both Parquet and Tantivy. Note that this will generate two inverted index files.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Default)]
pub enum InvertedIndexFormat {
    #[default]
    Parquet,
    Both,
    Tantivy,
}

impl From<&String> for InvertedIndexFormat {
    fn from(s: &String) -> Self {
        match s.to_lowercase().as_str() {
            "both" => InvertedIndexFormat::Both,
            "tantivy" => InvertedIndexFormat::Tantivy,
            _ => InvertedIndexFormat::Parquet,
        }
    }
}

impl std::fmt::Display for InvertedIndexFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InvertedIndexFormat::Parquet => write!(f, "parquet"),
            InvertedIndexFormat::Both => write!(f, "both"),
            InvertedIndexFormat::Tantivy => write!(f, "tantivy"),
        }
    }
}
