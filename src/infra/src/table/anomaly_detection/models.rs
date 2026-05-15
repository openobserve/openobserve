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

//! Table-level CRUD for `anomaly_detection_models`.
//!
//! Composite PK: (`anomaly_id`, `version`).  Rows are written once at
//! training completion and never mutated — only inserted and deleted.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder,
};

use crate::{
    errors::{self, Error},
    table::entity::anomaly_detection_models,
};

type Model = anomaly_detection_models::Model;
type Result<T> = std::result::Result<T, Error>;

/// Inserts a new model-metadata row.
///
/// Called once per training run after the serialised model has been written to
/// object storage.  Returns the inserted row so callers can inspect the stored
/// values.
pub async fn insert<C: ConnectionTrait>(conn: &C, model: Model) -> Result<Model> {
    let _lock = super::super::get_lock().await;
    let anomaly_id = model.anomaly_id.clone();
    let version = model.version;
    log::info!("[anomaly_detection_models] insert: anomaly_id={anomaly_id} version={version}");
    let result = anomaly_detection_models::Entity::insert(model.into_active_model())
        .exec_with_returning(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(result)
}

/// Returns all model-metadata rows for a config, sorted by `version`
/// descending (newest first).
///
/// Used by the training cleanup routine to find and delete old versions.
pub async fn list_by_anomaly_id_desc<C: ConnectionTrait>(
    conn: &C,
    anomaly_id: &str,
) -> Result<Vec<Model>> {
    let _lock = super::super::get_lock().await;
    let models = anomaly_detection_models::Entity::find()
        .filter(anomaly_detection_models::Column::AnomalyId.eq(anomaly_id))
        .order_by_desc(anomaly_detection_models::Column::Version)
        .all(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(models)
}

/// Deletes a single model-metadata row by its composite primary key.
pub async fn delete_by_key<C: ConnectionTrait>(
    conn: &C,
    anomaly_id: &str,
    version: i64,
) -> Result<()> {
    let _lock = super::super::get_lock().await;
    anomaly_detection_models::Entity::delete_many()
        .filter(anomaly_detection_models::Column::AnomalyId.eq(anomaly_id))
        .filter(anomaly_detection_models::Column::Version.eq(version))
        .exec(conn)
        .await
        .map_err(|e| Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
    Ok(())
}
