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
//! Works directly with the SeaORM entity `Model` — no domain-type conversion
//! needed because the entity fields map 1-to-1 to the API/scheduler surface.
//!
//! The critical invariant: every function that writes to an existing row
//! **fetches the row first** so the primary key is `Unchanged` in the
//! resulting `ActiveModel`. This guarantees SeaORM generates a correct
//! `UPDATE … WHERE anomaly_id = ?` rather than silently updating 0 rows.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};

use crate::{
    errors::{self, Error},
    table::entity::anomaly_detection_config,
};

type Model = anomaly_detection_config::Model;
type Result<T> = std::result::Result<T, Error>;

/// Returns a config by its primary key, scoped to `org_id`.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    anomaly_id: &str,
) -> Result<Option<Model>> {
    let _lock = super::get_lock().await;
    let model = anomaly_detection_config::Entity::find_by_id(anomaly_id)
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .one(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(model)
}

/// Inserts a new config row. Skips silently if a row with the same primary key
/// already exists (idempotent — matches the alerts Create handler behaviour).
pub async fn create_if_not_exists<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
    config: Model,
) -> Result<()> {
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;

    let exists = anomaly_detection_config::Entity::find_by_id(&config.anomaly_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
        .is_some();

    if !exists {
        anomaly_detection_config::Entity::insert(into_active_model(config))
            .exec(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
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
    let _lock = super::get_lock().await;
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

    let mut active = existing.into_active_model();
    patch_all_fields(&mut active, incoming);

    let updated = active
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
    let _lock = super::get_lock().await;
    let txn = conn.begin().await?;

    let existing = anomaly_detection_config::Entity::find_by_id(&incoming.anomaly_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;

    let result = if let Some(existing) = existing {
        let mut active = existing.into_active_model();
        patch_all_fields(&mut active, incoming);
        active
            .update(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
    } else {
        anomaly_detection_config::Entity::insert(into_active_model(incoming))
            .exec_with_returning(&txn)
            .await
            .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?
    };

    txn.commit().await?;
    Ok(result)
}

/// Deletes a config by `anomaly_id` + `org_id`.
pub async fn delete<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    anomaly_id: &str,
) -> Result<()> {
    let _lock = super::get_lock().await;
    anomaly_detection_config::Entity::delete_many()
        .filter(anomaly_detection_config::Column::AnomalyId.eq(anomaly_id))
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .exec(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(())
}

/// Lists all configs for an organisation.
pub async fn list_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<Model>> {
    let _lock = super::get_lock().await;
    let models = anomaly_detection_config::Entity::find()
        .filter(anomaly_detection_config::Column::OrgId.eq(org_id))
        .all(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(models)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Overwrites every non-PK field of `active` with the values from `src`.
/// `created_at` is intentionally excluded — it must never be overwritten.
fn patch_all_fields(
    active: &mut anomaly_detection_config::ActiveModel,
    src: Model,
) {
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
    use sea_orm::ActiveModelTrait;
    // For inserts the PK must be Set (it is not auto-increment).
    // `into_active_model()` sets every field including PK as Set, which is
    // correct for INSERT — only UPDATE requires the PK to be Unchanged.
    m.into_active_model()
}
