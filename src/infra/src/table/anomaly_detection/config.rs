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

//! Table-level CRUD for `anomaly_detection_config`.
//!
//! The critical invariant: every function that writes to an existing row
//! **fetches the row first** so the primary key is `Unchanged` in the
//! resulting `ActiveModel`. This guarantees SeaORM generates a correct
//! `UPDATE … WHERE anomaly_id = ?` rather than silently updating 0 rows.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};

use crate::{
    errors::{self, Error},
    table::entity::{anomaly_detection_config, folders},
};

type Model = anomaly_detection_config::Model;
type Result<T> = std::result::Result<T, Error>;

/// Returns a config by its primary key, scoped to `org_id`.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    anomaly_id: &str,
) -> Result<Option<Model>> {
    let _lock = super::super::get_lock().await;
    let model = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(model)
}

/// Lists all configs for an organisation, ordered by `created_at` descending.
pub async fn list_by_org<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<Vec<Model>> {
    let _lock = super::super::get_lock().await;
    let models = anomaly_detection_config::Entity::find()
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .order_by_desc(anomaly_detection_config::Column::CreatedAt)
        .all(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(models)
}

/// Lists all enabled configs across all organisations.
/// Used by startup recovery to re-create any missing detection triggers.
pub async fn list_all_enabled<C: ConnectionTrait>(conn: &C) -> Result<Vec<Model>> {
    let _lock = super::super::get_lock().await;
    let models = anomaly_detection_config::Entity::find()
        .filter(anomaly_detection_config::Column::Enabled.eq(true))
        .all(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(models)
}

/// Inserts a new config row.
///
/// Verifies the referenced folder exists inside the same transaction, matching
/// the pattern used by `alerts::create` and `dashboards::create`.
///
/// Returns an error if the folder does not exist or if a row with the same
/// primary key already exists. Use `create_if_not_exists` for idempotent inserts.
pub async fn create<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
    config: Model,
) -> Result<Model> {
    let _lock = super::super::get_lock().await;
    let txn = conn.begin().await?;

    let folder_exists = folders::Entity::find_by_id(&config.folder_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
        .is_some();
    if !folder_exists {
        return Err(Error::DbError(errors::DbError::PutAnomalyConfig(
            errors::PutAnomalyConfigError::FolderDoesNotExist,
        )));
    }

    let anomaly_id = config.anomaly_id.clone();
    log::info!("[anomaly_detection_config] create: inserting id={anomaly_id}");
    let result = anomaly_detection_config::Entity::insert(into_active_model(config))
        .exec_with_returning(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    txn.commit().await?;
    log::info!("[anomaly_detection_config] create: inserted id={anomaly_id}");
    Ok(result)
}

/// Inserts a new config row. Skips silently if a row with the same primary key
/// already exists (idempotent — matches the alerts Create handler behaviour).
pub async fn create_if_not_exists<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
    config: Model,
) -> Result<()> {
    let _lock = super::super::get_lock().await;
    let txn = conn.begin().await?;

    let anomaly_id = config.anomaly_id.clone();
    let exists = anomaly_detection_config::Entity::find_by_id(&anomaly_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
        .is_some();

    if exists {
        log::debug!(
            "[anomaly_detection_config] create_if_not_exists: skipping, row already exists id={anomaly_id}"
        );
    } else {
        anomaly_detection_config::Entity::insert(into_active_model(config))
            .exec(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
        log::debug!("[anomaly_detection_config] create_if_not_exists: inserted id={anomaly_id}");
    }

    txn.commit().await?;
    Ok(())
}

/// Updates an existing config row with all fields from `incoming`.
///
/// Fetches the current DB row first so the `ActiveModel` PK is `Unchanged`,
/// guaranteeing SeaORM generates `UPDATE … WHERE anomaly_id = ?`.
///
/// Returns an error if the row does not exist.
pub async fn update<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
    incoming: Model,
) -> Result<Model> {
    let _lock = super::super::get_lock().await;
    let txn = conn.begin().await?;

    let existing = anomaly_detection_config::Entity::find_by_id(&incoming.anomaly_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| {
            Error::DbError(errors::DbError::SeaORMError(format!(
                "anomaly config not found: {}",
                incoming.anomaly_id
            )))
        })?;

    // If folder is changing, verify the new folder exists — matches alerts::update behaviour.
    if existing.folder_id != incoming.folder_id {
        let folder_exists = folders::Entity::find_by_id(&incoming.folder_id)
            .one(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
            .is_some();
        if !folder_exists {
            return Err(Error::DbError(errors::DbError::PutAnomalyConfig(
                errors::PutAnomalyConfigError::FolderDoesNotExist,
            )));
        }
    }

    let mut active = existing.into_active_model();
    patch_all_fields(&mut active, incoming);

    let updated: Model = active
        .update(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;

    txn.commit().await?;
    Ok(updated)
}

/// Stores a config row — updates if it exists, inserts if it doesn't.
/// Matches HTTP PUT semantics: "store this resource regardless of whether it
/// already exists." Used by the super-cluster ConfigUpdate handler to stay in
/// sync even when the ConfigCreate message was never received.
pub async fn put<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
    incoming: Model,
) -> Result<Model> {
    let _lock = super::super::get_lock().await;
    let txn = conn.begin().await?;

    let anomaly_id = incoming.anomaly_id.clone();
    let existing = anomaly_detection_config::Entity::find_by_id(&anomaly_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;

    let result: Model = if let Some(existing) = existing {
        log::debug!("[anomaly_detection_config] put: updating existing row id={anomaly_id}");
        let mut active = existing.into_active_model();
        patch_all_fields(&mut active, incoming);
        let updated = active
            .update(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
        log::debug!("[anomaly_detection_config] put: update done id={anomaly_id}");
        updated
    } else {
        log::debug!("[anomaly_detection_config] put: row not found, inserting id={anomaly_id}");
        let inserted = anomaly_detection_config::Entity::insert(into_active_model(incoming))
            .exec_with_returning(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
        log::debug!("[anomaly_detection_config] put: insert done id={anomaly_id}");
        inserted
    };

    txn.commit().await?;
    Ok(result)
}

/// Deletes a config by `anomaly_id` + `org_id`.
pub async fn delete<C: ConnectionTrait>(conn: &C, org_id: &str, anomaly_id: &str) -> Result<()> {
    let _lock = super::super::get_lock().await;
    anomaly_detection_config::Entity::delete_many()
        .filter(anomaly_detection_config::Column::AnomalyId.eq(anomaly_id))
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .exec(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Overwrites every non-PK field of `active` with the values from `src`.
/// `created_at` is intentionally excluded — it must never be overwritten.
fn patch_all_fields(active: &mut anomaly_detection_config::ActiveModel, src: Model) {
    active.org_id = Set(src.org_id);
    active.stream_name = Set(src.stream_name);
    active.stream_type = Set(src.stream_type);
    active.enabled = Set(src.enabled);
    active.name = Set(src.name);
    active.description = Set(src.description);
    active.query_mode = Set(src.query_mode);
    active.filters = Set(src.filters);
    active.custom_sql = Set(src.custom_sql);
    active.detection_function = Set(src.detection_function);
    active.histogram_interval = Set(src.histogram_interval);
    active.schedule_interval = Set(src.schedule_interval);
    active.detection_window_seconds = Set(src.detection_window_seconds);
    active.training_window_days = Set(src.training_window_days);
    active.retrain_interval_days = Set(src.retrain_interval_days);
    active.threshold = Set(src.threshold);
    active.seasonality = Set(src.seasonality);
    active.is_trained = Set(src.is_trained);
    active.training_started_at = Set(src.training_started_at);
    active.training_completed_at = Set(src.training_completed_at);
    active.last_error = Set(src.last_error);
    active.last_processed_timestamp = Set(src.last_processed_timestamp);
    active.current_model_version = Set(src.current_model_version);
    active.rcf_num_trees = Set(src.rcf_num_trees);
    active.rcf_tree_size = Set(src.rcf_tree_size);
    active.rcf_shingle_size = Set(src.rcf_shingle_size);
    active.alert_enabled = Set(src.alert_enabled);
    active.alert_destinations = Set(src.alert_destinations);
    active.folder_id = Set(src.folder_id);
    active.owner = Set(src.owner);
    active.status = Set(src.status);
    active.retries = Set(src.retries);
    active.last_updated = Set(src.last_updated);
    active.updated_at = Set(src.updated_at);
    // created_at is NOT patched — it is set once at insert time and never changed.
}

/// Converts a `Model` into a fully-`Set` `ActiveModel` for inserts.
fn into_active_model(m: Model) -> anomaly_detection_config::ActiveModel {
    // For inserts the PK must be Set (it is not auto-increment).
    // `into_active_model()` sets every field including PK as Set, which is
    // correct for INSERT — only UPDATE requires the PK to be Unchanged.
    m.into_active_model()
}

#[cfg(test)]
mod tests {
    use sea_orm::IntoActiveModel;

    use super::*;

    fn make_model(anomaly_id: &str, org_id: &str) -> Model {
        Model {
            anomaly_id: anomaly_id.to_string(),
            org_id: org_id.to_string(),
            stream_name: "default".to_string(),
            stream_type: "logs".to_string(),
            enabled: true,
            name: "test-config".to_string(),
            description: None,
            query_mode: "sql".to_string(),
            filters: None,
            custom_sql: None,
            detection_function: "rcf".to_string(),
            histogram_interval: "1h".to_string(),
            schedule_interval: "5m".to_string(),
            detection_window_seconds: 3600,
            training_window_days: 7,
            retrain_interval_days: 1,
            threshold: 95,
            seasonality: "none".to_string(),
            is_trained: false,
            training_started_at: None,
            training_completed_at: None,
            last_error: None,
            last_processed_timestamp: None,
            current_model_version: 0,
            rcf_num_trees: 50,
            rcf_tree_size: 256,
            rcf_shingle_size: 8,
            alert_enabled: false,
            alert_destinations: None,
            folder_id: "folder-1".to_string(),
            owner: None,
            status: 0,
            retries: 0,
            last_updated: 0,
            created_at: 1_000_000,
            updated_at: 1_000_000,
        }
    }

    #[test]
    fn test_patch_all_fields_overwrites_org_id() {
        let original = make_model("anom-1", "org-original");
        let mut active = original.into_active_model();
        let replacement = make_model("anom-1", "org-replaced");
        patch_all_fields(&mut active, replacement);
        assert_eq!(active.org_id.unwrap(), "org-replaced");
    }

    #[test]
    fn test_patch_all_fields_does_not_change_created_at() {
        let original = make_model("anom-1", "org");
        let created_at_before = original.created_at;
        let mut active = original.into_active_model();
        let mut replacement = make_model("anom-1", "org");
        replacement.created_at = 9_999_999;
        patch_all_fields(&mut active, replacement);
        // created_at must remain as the original value (not patched)
        assert_eq!(active.created_at.unwrap(), created_at_before);
    }

    #[test]
    fn test_patch_all_fields_updates_enabled_and_status() {
        let original = make_model("anom-1", "org");
        let mut active = original.into_active_model();
        let mut replacement = make_model("anom-1", "org");
        replacement.enabled = false;
        replacement.status = 3;
        patch_all_fields(&mut active, replacement);
        assert!(!active.enabled.unwrap());
        assert_eq!(active.status.unwrap(), 3);
    }

    #[test]
    fn test_into_active_model_sets_pk() {
        let m = make_model("anom-pk", "org");
        let active = into_active_model(m);
        assert_eq!(active.anomaly_id.unwrap(), "anom-pk");
    }

    #[test]
    fn test_patch_all_fields_updates_numeric_params() {
        let original = make_model("anom-1", "org");
        let mut active = original.into_active_model();
        let mut replacement = make_model("anom-1", "org");
        replacement.threshold = 99;
        replacement.rcf_num_trees = 100;
        replacement.rcf_tree_size = 512;
        replacement.rcf_shingle_size = 16;
        replacement.training_window_days = 30;
        replacement.retrain_interval_days = 7;
        patch_all_fields(&mut active, replacement);
        assert_eq!(active.threshold.unwrap(), 99);
        assert_eq!(active.rcf_num_trees.unwrap(), 100);
        assert_eq!(active.rcf_tree_size.unwrap(), 512);
        assert_eq!(active.rcf_shingle_size.unwrap(), 16);
        assert_eq!(active.training_window_days.unwrap(), 30);
        assert_eq!(active.retrain_interval_days.unwrap(), 7);
    }

    #[test]
    fn test_patch_all_fields_updates_string_fields() {
        let original = make_model("anom-1", "org");
        let mut active = original.into_active_model();
        let mut replacement = make_model("anom-1", "org");
        replacement.stream_name = "new-stream".to_string();
        replacement.stream_type = "metrics".to_string();
        replacement.seasonality = "daily".to_string();
        replacement.detection_function = "zscore".to_string();
        patch_all_fields(&mut active, replacement);
        assert_eq!(active.stream_name.unwrap(), "new-stream");
        assert_eq!(active.stream_type.unwrap(), "metrics");
        assert_eq!(active.seasonality.unwrap(), "daily");
        assert_eq!(active.detection_function.unwrap(), "zscore");
    }

    #[test]
    fn test_into_active_model_sets_all_fields() {
        let m = make_model("anom-all", "org-all");
        let active = into_active_model(m);
        assert_eq!(active.anomaly_id.unwrap(), "anom-all");
        assert_eq!(active.org_id.unwrap(), "org-all");
        assert_eq!(active.stream_name.unwrap(), "default");
        assert_eq!(active.enabled.unwrap(), true);
        assert_eq!(active.threshold.unwrap(), 95);
    }
}
