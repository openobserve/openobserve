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

//! File and limit fixtures shared by the rule tests.

use std::sync::Arc;

use arrow_schema::Schema;
use config::meta::stream::{FileKey, FileMeta, MergeStrategy};

use super::BatchLimits;

pub(super) fn create_file_key(key: &str, min_ts: i64, max_ts: i64, original_size: i64) -> FileKey {
    FileKey {
        id: 0,
        account: "test_account".to_string(),
        key: key.to_string(),
        meta: FileMeta {
            min_ts,
            max_ts,
            records: 100,
            original_size,
            compressed_size: original_size / 2,
            index_size: 0,
            mindex_size: 0,
            flattened: false,
            bloom_ver: 0,
        },
        deleted: false,
        selection: None,
        row_group_size: None,
    }
}

pub(super) fn limits(
    strategy: &MergeStrategy,
    max_group_files: usize,
    is_incremental: bool,
) -> BatchLimits<'_> {
    BatchLimits {
        strategy,
        max_file_size: 1000,
        max_group_files,
        is_incremental,
        merge_max_original_size: 950,
        max_merge_groups: 100,
    }
}

pub(super) fn schema() -> Arc<Schema> {
    Arc::new(Schema::empty())
}

pub(super) fn metrics_file(name: &str, size: i64) -> FileKey {
    create_file_key(
        &format!("files/default/metrics/m/2026/08/18/10/{name}"),
        10,
        20,
        size,
    )
}

pub(super) fn names(files: &[FileKey]) -> Vec<&str> {
    files
        .iter()
        .map(|f| f.key.rsplit('/').next().unwrap())
        .collect()
}

pub(super) fn hash_file(name: &str, compressed_size: i64) -> FileKey {
    let mut file = metrics_file(name, compressed_size * 40);
    file.meta.compressed_size = compressed_size;
    file
}
