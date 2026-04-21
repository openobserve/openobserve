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

//! Super-cluster queue processor for anomaly detection config synchronization.
//!
//! Synchronizes anomaly detection configs across regions including:
//! - Config creation, update, and deletion
//! - Model training state updates (is_trained, version, training_completed_at)
//!
//! Only updates the local database for API reads. Training and detection run
//! exclusively on the primary region (where the alert manager runs).

use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::Result,
    table::entity::anomaly_detection_config,
};
use o2_enterprise::enterprise::super_cluster::queue::{AnomalyDetectionMessage, Message};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg: AnomalyDetectionMessage = msg.try_into().map_err(|e| {
        log::error!("[SUPER_CLUSTER:anomaly_detection] failed to deserialize message: {e}");
        infra::errors::Error::Message(format!("[ANOMALY_DETECTION] Failed to deserialize: {e}"))
    })?;
    log::debug!(
        "[SUPER_CLUSTER:anomaly_detection] deserialized message ok, dispatching to process_msg"
    );
    process_msg(msg).await
}

pub(crate) async fn process_msg(msg: AnomalyDetectionMessage) -> Result<()> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;

    match msg {
        AnomalyDetectionMessage::ConfigCreate { config } => {
            let anomaly_id = config.anomaly_id.clone();
            log::info!(
                "[SUPER_CLUSTER:anomaly_detection] ConfigCreate org={} id={} status={} is_trained={} updated_at={}",
                config.org_id,
                anomaly_id,
                config.status,
                config.is_trained,
                config.updated_at,
            );
            let exists = anomaly_detection_config::Entity::find_by_id(&anomaly_id)
                .one(db)
                .await
                .map_err(|e| {
                    log::error!(
                        "[SUPER_CLUSTER:anomaly_detection] ConfigCreate find_by_id failed id={}: {e}",
                        anomaly_id
                    );
                    infra::errors::Error::Message(e.to_string())
                })?
                .is_some();
            if exists {
                // Row already exists — skip. ConfigCreate fires once at creation time;
                // any replay is always the original stale message. Matches alerts behavior.
                log::info!(
                    "[SUPER_CLUSTER:anomaly_detection] ConfigCreate skipped (already exists) id={}",
                    anomaly_id
                );
            } else {
                anomaly_detection_config::Entity::insert(config.into_active_model())
                    .exec(db)
                    .await
                    .map_err(|e| {
                        log::error!(
                            "[SUPER_CLUSTER:anomaly_detection] ConfigCreate insert failed id={}: {e}",
                            anomaly_id
                        );
                        infra::errors::Error::Message(e.to_string())
                    })?;
                log::info!(
                    "[SUPER_CLUSTER:anomaly_detection] ConfigCreate inserted new row id={}",
                    anomaly_id
                );
            }
        }
        AnomalyDetectionMessage::ConfigUpdate { config } => {
            let anomaly_id = config.anomaly_id.clone();
            log::info!(
                "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate org={} id={} status={} is_trained={} schedule_interval={} updated_at={}",
                config.org_id,
                anomaly_id,
                config.status,
                config.is_trained,
                config.schedule_interval,
                config.updated_at,
            );
            // Upsert: update if the row exists, insert if it somehow doesn't.
            // A plain update would fail with RecordNotUpdated if ConfigCreate was
            // never received, leaving this cluster permanently out of sync.
            let existing = anomaly_detection_config::Entity::find_by_id(&anomaly_id)
                .one(db)
                .await
                .map_err(|e| {
                    log::error!(
                        "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate find_by_id failed id={}: {e}",
                        anomaly_id
                    );
                    infra::errors::Error::Message(e.to_string())
                })?;
            if existing.is_some() {
                config.into_active_model().update(db).await.map_err(|e| {
                    log::error!(
                        "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate update failed id={}: {e}",
                        anomaly_id
                    );
                    infra::errors::Error::Message(e.to_string())
                })?;
                log::info!(
                    "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate successfully wrote to DB id={} updated_at={}",
                    anomaly_id,
                    config.updated_at,
                );
            } else {
                log::warn!(
                    "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate: row not found for id={}, inserting instead",
                    anomaly_id
                );
                anomaly_detection_config::Entity::insert(config.into_active_model())
                    .exec(db)
                    .await
                    .map_err(|e| {
                        log::error!(
                            "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate insert failed id={}: {e}",
                            anomaly_id
                        );
                        infra::errors::Error::Message(e.to_string())
                    })?;
                log::info!(
                    "[SUPER_CLUSTER:anomaly_detection] ConfigUpdate inserted missing row id={}",
                    anomaly_id
                );
            }
        }
        AnomalyDetectionMessage::ConfigDelete { org_id, config_id } => {
            log::debug!(
                "[SUPER_CLUSTER:anomaly_detection] ConfigDelete org={org_id} id={config_id}"
            );
            anomaly_detection_config::Entity::delete_many()
                .filter(anomaly_detection_config::Column::AnomalyId.eq(&config_id))
                .filter(anomaly_detection_config::Column::OrgId.eq(&org_id))
                .exec(db)
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
            // Clear any locally cached model entry on non-primary regions.
            #[cfg(feature = "enterprise")]
            o2_enterprise::enterprise::anomaly_detection::cache::invalidate_config(&config_id)
                .await;
        }
        AnomalyDetectionMessage::ModelTrained { .. } => {
            // Config state (is_trained, current_model_version, training_completed_at)
            // arrives via the accompanying ConfigUpdate broadcast from trainer.rs.
            // Non-primary regions do not run detection and do not need model metadata rows.
        }
    }

    Ok(())
}
