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

//! Delayed deletion of compacted files.

use std::borrow::Cow;

use config::{
    meta::stream::{FileKey, FileListDeleted, FileMeta},
    utils::inverted_index::to_tantivy_name,
};
use infra::{file_list as infra_file_list, storage};

// Batch size for deleting files from file_list_deleted table
const BATCH_SIZE: i64 = 10000;

/// Delete the objects `key` maps the files to from storage, ignoring
/// `not found` (already deleted, or a derived object that was never written).
async fn delete_from_storage<'a>(
    kind: &str,
    files: &'a [FileListDeleted],
    key: impl Fn(&'a FileListDeleted) -> Option<Cow<'a, str>>,
) -> Result<(), anyhow::Error> {
    let objects = files
        .iter()
        .filter_map(|file| key(file).map(|key| (file.account.as_str(), key)))
        .collect::<Vec<_>>();
    if objects.is_empty() {
        return Ok(());
    }
    if let Err(e) = storage::del(
        objects
            .iter()
            .map(|(account, key)| (*account, key.as_ref()))
            .collect(),
    )
    .await
        && !e.to_string().to_lowercase().contains("not found")
    {
        log::error!("[COMPACTOR] delete {kind} files from storage failed: {e}");
        return Err(e.into());
    }
    Ok(())
}

pub async fn delete(org_id: &str, time_max: i64) -> Result<i64, anyhow::Error> {
    let files = infra_file_list::query_deleted(org_id, time_max, BATCH_SIZE).await?;
    if files.is_empty() {
        return Ok(0);
    }
    let files_num = files.len() as i64;

    // delete files from storage
    delete_from_storage("data", &files, |file| {
        (!ingester::is_wal_file(&file.file)).then_some(Cow::Borrowed(file.file.as_str()))
    })
    .await?;

    // derived objects are not tracked in file_list: delete them together with
    // their parent data file
    delete_from_storage("inverted index", &files, |file| {
        file.index_file
            .then(|| to_tantivy_name(&file.file).map(Cow::Owned))
            .flatten()
    })
    .await?;
    delete_from_storage("flattened", &files, |file| {
        file.flattened
            .then(|| Cow::Owned(super::flatten::generate_flatten_file_key(&file.file)))
    })
    .await?;

    // delete files from file_list_deleted table
    if let Err(e) = infra_file_list::batch_remove_deleted(
        &files
            .iter()
            .map(|file| {
                FileKey::new(
                    file.id,
                    file.account.clone(),
                    file.file.clone(),
                    FileMeta::default(),
                    false,
                )
            })
            .collect::<Vec<_>>(),
    )
    .await
    {
        log::error!("[COMPACTOR] delete files from table failed: {e}");
        return Err(e.into());
    }

    Ok(files_num)
}
