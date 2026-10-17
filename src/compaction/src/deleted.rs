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
use infra::{file_list as infra_file_list, org_lifecycle::OrgLifecycleGuard, storage};
use metrics_index::MetricsFileLayout;
use tokio::sync::oneshot;

// Batch size for deleting files from file_list_deleted table
const BATCH_SIZE: i64 = 10000;

static REMOVAL_PAUSE: std::sync::Mutex<Option<RemovalPause>> = std::sync::Mutex::new(None);

struct RemovalPause {
    org_id: String,
    reached: oneshot::Sender<()>,
    resume: oneshot::Receiver<()>,
}

/// Delete the objects `key` maps the files to from storage, ignoring
/// `not found` (already deleted, or a derived object that was never written).
async fn delete_from_storage<'a>(
    kind: &str,
    files: &'a [FileListDeleted],
    key: impl Fn(&'a FileListDeleted) -> Option<Cow<'a, str>>,
    strict: bool,
) -> Result<(), anyhow::Error> {
    let objects = files
        .iter()
        .filter_map(|file| key(file).map(|key| (file.account.as_str(), key)))
        .collect::<Vec<_>>();
    if objects.is_empty() {
        return Ok(());
    }
    let pairs = objects
        .iter()
        .map(|(account, key)| (*account, key.as_ref()))
        .collect();
    let deleted = if strict {
        storage::del_strict(pairs).await
    } else {
        storage::del(pairs).await
    };
    // In strict mode del_strict already skipped missing objects, so a "not found" is the store.
    if let Err(e) = deleted
        && (strict || !e.to_string().to_lowercase().contains("not found"))
    {
        log::error!("[COMPACTOR] delete {kind} files from storage failed: {e}");
        return Err(e.into());
    }
    Ok(())
}

pub async fn delete(org_id: &str, time_max: i64) -> Result<i64, anyhow::Error> {
    delete_batch(org_id, time_max, false).await
}

/// Strict `delete`: fails and keeps unreachable rows, but drops those of the org's gone provider.
pub async fn drain(org_id: &str, time_max: i64) -> Result<i64, anyhow::Error> {
    delete_batch(org_id, time_max, true).await
}

/// Test hook, debug and release-ci builds: the next lenient batch of `org_id` stops before removal.
pub fn pause_before_removal(org_id: &str) -> (oneshot::Receiver<()>, oneshot::Sender<()>) {
    let (reached_tx, reached_rx) = oneshot::channel();
    let (resume_tx, resume_rx) = oneshot::channel();
    *REMOVAL_PAUSE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(RemovalPause {
        org_id: org_id.to_string(),
        reached: reached_tx,
        resume: resume_rx,
    });
    (reached_rx, resume_tx)
}

async fn delete_batch(org_id: &str, time_max: i64, strict: bool) -> Result<i64, anyhow::Error> {
    let files = infra_file_list::query_deleted(org_id, time_max, BATCH_SIZE).await?;
    if files.is_empty() {
        return Ok(0);
    }
    let files_num = files.len() as i64;

    // Read after the query, so rows queued by the org's cleanup always meet strict deletion.
    let strict = strict || is_org_deleting(org_id).await?;
    let files = if strict {
        drop_unreachable_rows(org_id, files).await?
    } else {
        files
    };
    if files.is_empty() {
        return Ok(files_num);
    }
    delete_or_release(&files, strict, time_max).await?;
    if !strict {
        // Lenient deletes may have swallowed errors: decide and remove while no deletion can start.
        let guard = OrgLifecycleGuard::acquire(org_id).await?;
        let removed = remove_unless_deleting(org_id, &files).await;
        guard.release().await;
        if removed? {
            return Ok(files_num);
        }
        delete_or_release(&files, true, time_max).await?;
    }
    remove_rows(&files).await?;
    Ok(files_num)
}

/// Removes rows of the org's own account once its provider row or DEK is gone; returns the rest.
async fn drop_unreachable_rows(
    org_id: &str,
    files: Vec<FileListDeleted>,
) -> Result<Vec<FileListDeleted>, anyhow::Error> {
    let account = storage::org_account(org_id);
    if storage::has_account(&account) || !files.iter().any(|file| file.account == account) {
        return Ok(files);
    }
    // An unloaded account whose provider row and DEK both remain may only lag here: stay strict.
    if infra::table::org_storage_providers::exists_for_org(org_id).await?
        && infra::table::cipher::find_dek(org_id).await?.is_some()
    {
        return Ok(files);
    }
    let (gone, kept): (Vec<_>, Vec<_>) = files.into_iter().partition(|f| f.account == account);
    remove_rows(&gone).await?;
    log::warn!(
        "[COMPACTOR] org={org_id}: removed {} file_list_deleted rows of account {account}, whose \
         storage provider or its key is gone; their objects cannot be deleted",
        gone.len()
    );
    Ok(kept)
}

/// A failed strict delete hands its rows back as mature, so the next drain retries them at once.
async fn delete_or_release(
    files: &[FileListDeleted],
    strict: bool,
    time_max: i64,
) -> Result<(), anyhow::Error> {
    let deleted = delete_objects(files, strict).await;
    if deleted.is_err() && strict {
        let ids: Vec<i64> = files.iter().map(|file| file.id).collect();
        if let Err(e) = infra_file_list::release_deleted(&ids, time_max - 1).await {
            log::error!(
                "[COMPACTOR] release of {} undeleted rows failed: {e}",
                ids.len()
            );
        }
    }
    deleted
}

async fn delete_objects(files: &[FileListDeleted], strict: bool) -> Result<(), anyhow::Error> {
    delete_from_storage(
        "data",
        files,
        |file| (!ingester::is_wal_file(&file.file)).then_some(Cow::Borrowed(file.file.as_str())),
        strict,
    )
    .await?;

    // derived objects are not tracked in file_list: delete them together with
    // their parent data file
    delete_from_storage(
        "inverted index",
        files,
        |file| {
            file.index_file
                .then(|| to_tantivy_name(&file.file).map(Cow::Owned))
                .flatten()
        },
        strict,
    )
    .await?;

    // delete metrics index files
    delete_from_storage("metrics index", files, metrics_index_key, strict).await?;

    delete_from_storage(
        "flattened",
        files,
        |file| {
            file.flattened
                .then(|| Cow::Owned(super::flatten::generate_flatten_file_key(&file.file)))
        },
        strict,
    )
    .await
}

async fn is_org_deleting(org_id: &str) -> Result<bool, anyhow::Error> {
    let status = infra::table::organizations::get_status_uncached(org_id).await?;
    Ok(matches!(status.as_deref(), Some("deleting" | "deleted")))
}

/// Removes the rows of a lenient batch while the org is not deleting; the caller holds its lock.
async fn remove_unless_deleting(
    org_id: &str,
    files: &[FileListDeleted],
) -> Result<bool, anyhow::Error> {
    pause_point(org_id).await;
    let ids: Vec<i64> = files.iter().map(|file| file.id).collect();
    Ok(infra_file_list::remove_deleted_unless_org_deleting(org_id, &ids).await?)
}

async fn remove_rows(files: &[FileListDeleted]) -> Result<(), anyhow::Error> {
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
    Ok(())
}

async fn pause_point(org_id: &str) {
    if !cfg!(debug_assertions) {
        return;
    }
    let pause = {
        let mut slot = REMOVAL_PAUSE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if slot.as_ref().is_some_and(|pause| pause.org_id == org_id) {
            slot.take()
        } else {
            None
        }
    };
    if let Some(pause) = pause {
        let _ = pause.reached.send(());
        let _ = pause.resume.await;
    }
}

fn metrics_index_key(file: &FileListDeleted) -> Option<Cow<'_, str>> {
    if !file.mindex_file {
        return None;
    }
    MetricsFileLayout::metrics_index_path(&file.file).map(Cow::Owned)
}

#[cfg(test)]
mod tests {
    use infra::table::org_storage_providers::{self, OrgStorageProvider, ProviderType};

    use super::*;

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
            // Provider rows are encrypted, so the cipher mode must be installed first.
            infra::table::cipher::boot(None).await.expect("cipher");
        })
        .await;
        true
    }

    async fn queue(org: &str, account: &str, stream: &str, n: usize) {
        let files: Vec<FileListDeleted> = (0..n)
            .map(|i| FileListDeleted {
                account: account.to_string(),
                file: format!("files/{org}/logs/{stream}/2026/01/01/00/{i}.parquet"),
                ..Default::default()
            })
            .collect();
        infra_file_list::batch_add_deleted(org, 1, &files)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn drain_removes_rows_whose_storage_provider_is_gone() {
        if !meta_store().await {
            return;
        }
        let org = format!("t_provider_gone_{}", config::utils::time::now_micros());
        queue(&org, &storage::org_account(&org), "gone", 3).await;
        queue(&org, "", "kept", 1).await;

        let removed = drain(&org, i64::MAX).await;
        let left = infra_file_list::has_deleted_by_org(&org).await.unwrap();

        assert_eq!(removed.unwrap(), 4);
        assert!(!left, "rows of a gone provider kept the drain pending");
    }

    #[tokio::test]
    async fn drain_removes_rows_whose_storage_provider_key_is_gone() {
        if !meta_store().await {
            return;
        }
        let org = format!("t_provider_key_gone_{}", config::utils::time::now_micros());
        org_storage_providers::add(OrgStorageProvider {
            org_id: org.clone(),
            provider_type: ProviderType::AwsCredentials,
            created_at: 1,
            updated_at: 1,
            data: "{}".to_string(),
        })
        .await
        .unwrap();
        // What PR 1's step 300 leaves when it fails between deleting the keys and the providers.
        infra::table::cipher::delete_by_org(&org).await.unwrap();
        queue(&org, &storage::org_account(&org), "key_gone", 2).await;

        let drained = drain(&org, i64::MAX).await;
        let left = infra_file_list::has_deleted_by_org(&org).await.unwrap();
        org_storage_providers::delete_by_org(&org).await.unwrap();
        org_storage_providers::remove_from_cache(&org);
        let queued = infra_file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap();
        remove_rows(&queued).await.unwrap();

        assert_eq!(drained.unwrap(), 2);
        assert!(
            !left,
            "rows of a provider whose key is gone kept the drain pending"
        );
    }

    #[tokio::test]
    async fn drain_stays_strict_while_the_storage_provider_exists() {
        if !meta_store().await {
            return;
        }
        let org = format!("t_provider_kept_{}", config::utils::time::now_micros());
        org_storage_providers::add(OrgStorageProvider {
            org_id: org.clone(),
            provider_type: ProviderType::AwsCredentials,
            created_at: 1,
            updated_at: 1,
            data: "{}".to_string(),
        })
        .await
        .unwrap();
        queue(&org, &storage::org_account(&org), "kept", 2).await;

        let drained = drain(&org, i64::MAX).await;
        let left = infra_file_list::has_deleted_by_org(&org).await.unwrap();
        org_storage_providers::delete_by_org(&org).await.unwrap();
        org_storage_providers::remove_from_cache(&org);
        infra::table::cipher::delete_by_org(&org).await.unwrap();
        let queued = infra_file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap();
        remove_rows(&queued).await.unwrap();

        let err = drained.unwrap_err().to_string();
        assert!(err.contains("not loaded"), "{err}");
        assert!(left, "rows of an existing provider were dropped");
    }

    fn deleted_file(file: &str) -> FileListDeleted {
        FileListDeleted {
            file: file.to_string(),
            mindex_file: true,
            ..Default::default()
        }
    }

    #[test]
    fn metrics_index_key_only_for_indexed_metrics_files() {
        let file = deleted_file("files/default/metrics/cpu/2026/08/19/07/indexed-v1-456.parquet");
        assert_eq!(
            metrics_index_key(&file).as_deref(),
            Some("files/default/mindex/cpu/2026/08/19/07/indexed-v1-456.midx")
        );

        let file_without_index = FileListDeleted {
            mindex_file: false,
            ..file
        };
        assert!(metrics_index_key(&file_without_index).is_none());

        for file in [
            "files/default/logs/app/2026/08/19/07/indexed-v1-456.parquet",
            "files/default/metrics/cpu/2026/08/19/07/indexed-v3-456.parquet",
            "files/default/metrics/cpu/2026/08/19/07/hash-sorted-v1-456.parquet",
            "files/default/metrics/cpu/2026/08/19/07/456.parquet",
        ] {
            assert!(metrics_index_key(&deleted_file(file)).is_none(), "{file}");
        }
    }
}
