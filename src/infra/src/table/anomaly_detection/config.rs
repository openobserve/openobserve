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
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel,
    JsonValue as Json, QueryFilter, QueryOrder, Set, TransactionTrait,
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
    let model = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(model)
}

/// Lists all configs for an organisation, ordered by `created_at` descending.
pub async fn list_by_org<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<Vec<Model>> {
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
    active.filters = Set(normalize_filters(src.filters));
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
    // last_failed_at is NOT patched: a replicated anchor can only corrupt the local backoff.
    // last_alert_fired_at is NOT patched either: each region alerts to its own
    // destinations, so a peer's fire time must not suppress a local alert.
}

/// Collapses the `filters` shapes that mean "no filters" to NULL, on every model-based write.
fn normalize_filters(filters: Option<Json>) -> Option<Json> {
    match filters {
        Some(Json::Null) => None,
        Some(Json::Object(ref map)) if map.is_empty() => None,
        other => other,
    }
}

/// Converts a `Model` into a fully-`Set` `ActiveModel` for inserts.
fn into_active_model(mut m: Model) -> anomaly_detection_config::ActiveModel {
    m.filters = normalize_filters(m.filters);
    // Held local like patch_all_fields does: a new row inherits no peer's anchor.
    m.last_failed_at = None;
    m.last_alert_fired_at = None;
    // For inserts the PK must be Set (it is not auto-increment).
    // `into_active_model()` sets every field including PK as Set, which is
    // correct for INSERT — only UPDATE requires the PK to be Unchanged.
    m.into_active_model()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait as _, IntoActiveModel};

    use super::*;

    /// Whether a super-cluster peer's row is allowed to overwrite a column locally.
    enum Scope {
        PrimaryKey,
        Replicated,
        RegionLocal,
        Immutable,
    }

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
            priority: None,
            tags: None,
            status: 0,
            retries: 0,
            last_failed_at: None,
            last_alert_fired_at: None,
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
    fn test_normalize_filters_collapses_the_no_filter_shapes() {
        assert_eq!(normalize_filters(None), None);
        assert_eq!(normalize_filters(Some(Json::Null)), None);
        assert_eq!(normalize_filters(Some(serde_json::json!({}))), None);
    }

    #[test]
    fn test_normalize_filters_leaves_every_other_value_alone() {
        let empty_array = serde_json::json!([]);
        assert_eq!(
            normalize_filters(Some(empty_array.clone())),
            Some(empty_array)
        );
        let rows = serde_json::json!([{"field": "a", "operator": "=", "value": "b"}]);
        assert_eq!(normalize_filters(Some(rows.clone())), Some(rows));
        // Not silently dropped: the read path must still reject it rather than widen the query.
        let populated_object = serde_json::json!({"a": "b"});
        assert_eq!(
            normalize_filters(Some(populated_object.clone())),
            Some(populated_object)
        );
    }

    /// A legacy `{}` must not survive a clone or a super-cluster replication into a new row.
    #[test]
    fn test_into_active_model_normalizes_a_legacy_empty_object() {
        let mut m = make_model("id", "org");
        m.filters = Some(serde_json::json!({}));
        let active = into_active_model(m);
        assert_eq!(
            active.filters.into_value(),
            Some(sea_orm::Value::Json(None))
        );
    }

    #[test]
    fn test_patch_all_fields_normalizes_a_legacy_empty_object() {
        let mut active = make_model("id", "org").into_active_model();
        let mut src = make_model("id", "org");
        src.filters = Some(serde_json::json!({}));
        patch_all_fields(&mut active, src);
        assert_eq!(
            active.filters.into_value(),
            Some(sea_orm::Value::Json(None))
        );
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

    /// A peer's ConfigUpdate must not move this region's retry anchor: it never trained.
    #[test]
    fn test_patch_all_fields_leaves_last_failed_at_alone() {
        let mut original = make_model("anom-1", "org");
        original.last_failed_at = Some(1_700_000_000_000_000);
        let mut active = original.into_active_model();

        let mut replicated = make_model("anom-1", "org");
        replicated.last_failed_at = None;
        patch_all_fields(&mut active, replicated);

        assert_eq!(active.last_failed_at.unwrap(), Some(1_700_000_000_000_000));
    }

    /// `put()` may insert a ConfigUpdate for an unknown row, so it holds the anchor local.
    #[test]
    fn test_into_active_model_drops_a_replicated_last_failed_at() {
        let mut m = make_model("anom-1", "org");
        m.last_failed_at = Some(1_700_000_000_000_000);
        let active = into_active_model(m);
        assert_eq!(active.last_failed_at.unwrap(), None);
    }

    #[test]
    fn test_into_active_model_sets_all_fields() {
        let m = make_model("anom-all", "org-all");
        let active = into_active_model(m);
        assert_eq!(active.anomaly_id.unwrap(), "anom-all");
        assert_eq!(active.org_id.unwrap(), "org-all");
        assert_eq!(active.stream_name.unwrap(), "default");
        assert!(active.enabled.unwrap());
        assert_eq!(active.threshold.unwrap(), 95);
    }

    /// The super-cluster broadcasts whole rows, so this list is the only thing keeping a
    /// region-local column from being clobbered by a peer. Adding a column breaks this
    /// destructure and forces the replicated-vs-region-local decision to be made here.
    fn replication_scope(m: Model) -> Vec<(&'static str, Scope)> {
        let Model {
            anomaly_id,
            org_id,
            stream_name,
            stream_type,
            enabled,
            name,
            description,
            query_mode,
            filters,
            custom_sql,
            detection_function,
            histogram_interval,
            schedule_interval,
            detection_window_seconds,
            training_window_days,
            retrain_interval_days,
            threshold,
            seasonality,
            is_trained,
            training_started_at,
            training_completed_at,
            last_error,
            last_processed_timestamp,
            current_model_version,
            rcf_num_trees,
            rcf_tree_size,
            rcf_shingle_size,
            alert_enabled,
            alert_destinations,
            folder_id,
            owner,
            priority,
            tags,
            status,
            retries,
            last_failed_at,
            last_alert_fired_at,
            last_updated,
            created_at,
            updated_at,
        } = m;
        let _ = (
            &anomaly_id,
            &org_id,
            &stream_name,
            &stream_type,
            &enabled,
            &name,
            &description,
            &query_mode,
            &filters,
            &custom_sql,
            &detection_function,
            &histogram_interval,
            &schedule_interval,
            &detection_window_seconds,
            &training_window_days,
            &retrain_interval_days,
            &threshold,
            &seasonality,
            &is_trained,
            &training_started_at,
            &training_completed_at,
            &last_error,
            &last_processed_timestamp,
            &current_model_version,
            &rcf_num_trees,
            &rcf_tree_size,
            &rcf_shingle_size,
            &alert_enabled,
            &alert_destinations,
            &folder_id,
            &owner,
            &priority,
            &tags,
            &status,
            &retries,
            &last_failed_at,
            &last_alert_fired_at,
            &last_updated,
            &created_at,
            &updated_at,
        );
        vec![
            ("anomaly_id", Scope::PrimaryKey),
            ("org_id", Scope::Replicated),
            ("stream_name", Scope::Replicated),
            ("stream_type", Scope::Replicated),
            ("enabled", Scope::Replicated),
            ("name", Scope::Replicated),
            ("description", Scope::Replicated),
            ("query_mode", Scope::Replicated),
            ("filters", Scope::Replicated),
            ("custom_sql", Scope::Replicated),
            ("detection_function", Scope::Replicated),
            ("histogram_interval", Scope::Replicated),
            ("schedule_interval", Scope::Replicated),
            ("detection_window_seconds", Scope::Replicated),
            ("training_window_days", Scope::Replicated),
            ("retrain_interval_days", Scope::Replicated),
            ("threshold", Scope::Replicated),
            ("seasonality", Scope::Replicated),
            ("is_trained", Scope::Replicated),
            ("training_started_at", Scope::Replicated),
            ("training_completed_at", Scope::Replicated),
            ("last_error", Scope::Replicated),
            ("last_processed_timestamp", Scope::Replicated),
            ("current_model_version", Scope::Replicated),
            ("rcf_num_trees", Scope::Replicated),
            ("rcf_tree_size", Scope::Replicated),
            ("rcf_shingle_size", Scope::Replicated),
            ("alert_enabled", Scope::Replicated),
            ("alert_destinations", Scope::Replicated),
            ("folder_id", Scope::Replicated),
            ("owner", Scope::Replicated),
            // Not in patch_all_fields today; pinned as-is so the omission is visible, not silent.
            ("priority", Scope::RegionLocal),
            ("tags", Scope::RegionLocal),
            ("status", Scope::Replicated),
            // P0.7: paired with last_failed_at, or regions back off on each other's failures.
            ("retries", Scope::RegionLocal),
            ("last_failed_at", Scope::RegionLocal),
            // P0.3: one region's alert must never silence another region's cooldown.
            ("last_alert_fired_at", Scope::RegionLocal),
            ("last_updated", Scope::Replicated),
            ("created_at", Scope::Immutable),
            ("updated_at", Scope::Replicated),
        ]
    }

    /// Every field carries a distinct value from `make_model`, so "changed" is unambiguous.
    fn peer_model() -> Model {
        Model {
            anomaly_id: "anom-1".to_string(),
            org_id: "peer-org".to_string(),
            stream_name: "peer-stream".to_string(),
            stream_type: "metrics".to_string(),
            enabled: false,
            name: "peer-config".to_string(),
            description: Some("peer".to_string()),
            query_mode: "filters".to_string(),
            filters: Some(serde_json::json!([{"field": "peer"}])),
            custom_sql: Some("select 1".to_string()),
            detection_function: "zscore".to_string(),
            histogram_interval: "10m".to_string(),
            schedule_interval: "30m".to_string(),
            detection_window_seconds: 7200,
            training_window_days: 30,
            retrain_interval_days: 7,
            threshold: 99,
            seasonality: "daily".to_string(),
            is_trained: true,
            training_started_at: Some(11),
            training_completed_at: Some(12),
            last_error: Some("peer boom".to_string()),
            last_processed_timestamp: Some(13),
            current_model_version: 9,
            rcf_num_trees: 100,
            rcf_tree_size: 512,
            rcf_shingle_size: 16,
            alert_enabled: true,
            alert_destinations: Some(serde_json::json!(["peer-dest"])),
            folder_id: "peer-folder".to_string(),
            owner: Some("peer-owner".to_string()),
            priority: Some(2),
            tags: Some(serde_json::json!(["peer-tag"])),
            status: 3,
            retries: 7,
            last_failed_at: Some(1_700_000_000_000_001),
            last_alert_fired_at: Some(1_700_000_000_000_002),
            last_updated: 21,
            created_at: 9_999_999,
            updated_at: 22,
        }
    }

    fn active_field(active: &anomaly_detection_config::ActiveModel, field: &str) -> sea_orm::Value {
        let column = <anomaly_detection_config::Column as std::str::FromStr>::from_str(field)
            .unwrap_or_else(|_| panic!("unknown column {field}"));
        active
            .get(column)
            .into_value()
            .unwrap_or_else(|| panic!("field {field} is NotSet"))
    }

    /// Pins the exact replication scope of every column: a replicated row may overwrite the
    /// Replicated set and nothing else.
    #[test]
    fn test_patch_all_fields_replication_scope_is_exhaustive() {
        // Region-local fields carry non-default values so "cleared" cannot pass as "preserved".
        let mut local = make_model("anom-1", "local-org");
        local.priority = Some(5);
        local.tags = Some(serde_json::json!(["local-tag"]));
        local.retries = 2;
        local.last_failed_at = Some(1_700_000_000_000_900);
        local.last_alert_fired_at = Some(1_700_000_000_000_800);
        let peer = peer_model();

        let mut active = local.clone().into_active_model();
        patch_all_fields(&mut active, peer.clone());

        let local_active = local.into_active_model();
        let peer_active = into_active_model(peer.clone());

        for (field, scope) in replication_scope(peer) {
            let got = active_field(&active, field);
            match scope {
                Scope::Replicated => assert_eq!(
                    got,
                    active_field(&peer_active, field),
                    "{field} is replicated and must take the peer's value"
                ),
                Scope::PrimaryKey | Scope::Immutable | Scope::RegionLocal => assert_eq!(
                    got,
                    active_field(&local_active, field),
                    "{field} is region-local and must keep this region's value"
                ),
            }
        }
    }

    /// A peer whose columns are NULL must not clear a region-local value either.
    #[test]
    fn test_patch_all_fields_region_local_survives_a_null_peer() {
        let mut local = make_model("anom-1", "org");
        local.retries = 5;
        local.last_failed_at = Some(1_700_000_000_000_000);
        local.last_alert_fired_at = Some(1_700_000_000_000_100);
        let mut active = local.into_active_model();

        let mut peer = make_model("anom-1", "org");
        peer.retries = 0;
        peer.last_failed_at = None;
        peer.last_alert_fired_at = None;
        patch_all_fields(&mut active, peer);

        assert_eq!(active.retries.unwrap(), 5);
        assert_eq!(active.last_failed_at.unwrap(), Some(1_700_000_000_000_000));
        assert_eq!(
            active.last_alert_fired_at.unwrap(),
            Some(1_700_000_000_000_100)
        );
    }

    /// A peer's cooldown anchor must not suppress this region's first alert.
    #[test]
    fn test_patch_all_fields_leaves_last_alert_fired_at_alone() {
        let mut local = make_model("anom-1", "org");
        local.last_alert_fired_at = None;
        let mut active = local.into_active_model();

        let mut peer = make_model("anom-1", "org");
        peer.last_alert_fired_at = Some(1_700_000_000_000_000);
        patch_all_fields(&mut active, peer);

        assert_eq!(active.last_alert_fired_at.unwrap(), None);
    }

    /// P0.7: a peer's failure count must not push this region into a backoff it never earned.
    #[test]
    fn test_patch_all_fields_leaves_retries_alone() {
        let mut local = make_model("anom-1", "org");
        local.retries = 0;
        let mut active = local.into_active_model();

        let mut peer = make_model("anom-1", "org");
        peer.retries = 9;
        patch_all_fields(&mut active, peer);

        assert_eq!(active.retries.unwrap(), 0);
    }

    /// `put()` inserts unknown rows, so a fresh region starts its own backoff from zero.
    #[test]
    fn test_into_active_model_drops_replicated_region_local_state() {
        let mut m = make_model("anom-1", "org");
        m.retries = 6;
        m.last_failed_at = Some(1_700_000_000_000_000);
        m.last_alert_fired_at = Some(1_700_000_000_000_100);
        let active = into_active_model(m);
        assert_eq!(active.retries.unwrap(), 0);
        assert_eq!(active.last_failed_at.unwrap(), None);
        assert_eq!(active.last_alert_fired_at.unwrap(), None);
    }
}
