// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{collections::HashSet, sync::LazyLock};

use config::{RwHashMap, RwHashSet, meta::stream::FileMeta};
use dashmap::{DashMap, DashSet};

pub mod broadcast;
pub mod local;
mod repository;

pub use repository::{cache_stats, set};

/// Files currently being deduplicated by file-list workers.
pub static DEDUPLICATE_FILES: LazyLock<RwHashSet<String>> =
    LazyLock::new(|| DashSet::with_capacity_and_hasher(1024, Default::default()));

/// Recently deleted file metadata used by status and cleanup paths.
pub static DELETED_FILES: LazyLock<RwHashMap<String, FileMeta>> =
    LazyLock::new(|| DashMap::with_capacity_and_hasher(64, Default::default()));

/// Organizations excluded from compaction and ingestion by configuration.
pub static BLOCKED_ORGS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    config::get_config()
        .compact
        .blocked_orgs
        .split(',')
        .map(ToOwned::to_owned)
        .collect()
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_file_state_is_accessible() {
        let file = "stream_catalog_test.parquet";
        DEDUPLICATE_FILES.insert(file.to_string());
        assert!(DEDUPLICATE_FILES.contains(file));
        DEDUPLICATE_FILES.remove(file);
    }
}
