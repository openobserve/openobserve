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

use config::ider;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};

use super::entity::{dashboards, timed_annotation_panels, timed_annotations};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub async fn get_panels(timed_annotation_id: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    let panels = timed_annotation_panels::Entity::find()
        .filter(timed_annotation_panels::Column::TimedAnnotationId.eq(timed_annotation_id))
        .all(client)
        .await?;

    let panel_ids: Vec<String> = panels.into_iter().map(|panel| panel.panel_id).collect();

    Ok(panel_ids)
}

pub async fn insert_many_panels(
    timed_annotation_id: &str,
    panel_ids: Vec<String>,
) -> Result<(), errors::Error> {
    if panel_ids.is_empty() {
        return Ok(());
    }

    let client = get_orm_client_rw().await;
    let txn = client.begin().await?;

    for panel_id in panel_ids {
        let record = timed_annotation_panels::ActiveModel {
            id: Set(ider::uuid()),
            timed_annotation_id: Set(timed_annotation_id.to_string()),
            panel_id: Set(panel_id),
        };

        timed_annotation_panels::Entity::insert(record)
            .exec(&txn) // Use the transaction
            .await?;
    }

    txn.commit().await?;

    Ok(())
}

/// Unscoped: only for replaying a delete the originating cluster already authorized. Callers
/// serving a user request must use [`delete_many_panels_in_dashboard`].
pub async fn delete_many_panels(
    timed_annotation_id: &str,
    panel_ids: Vec<String>,
) -> Result<(), errors::Error> {
    if panel_ids.is_empty() {
        return Ok(());
    }

    let client = get_orm_client_rw().await;
    let txn = client.begin().await?;

    timed_annotation_panels::Entity::delete_many()
        .filter(timed_annotation_panels::Column::TimedAnnotationId.eq(timed_annotation_id))
        .filter(timed_annotation_panels::Column::PanelId.is_in(panel_ids))
        .exec(&txn)
        .await?;

    txn.commit().await?;

    Ok(())
}

/// Removes panel associations only when the annotation belongs to the given dashboard.
pub async fn delete_many_panels_in_dashboard(
    dashboard_id: &str,
    timed_annotation_id: &str,
    panel_ids: Vec<String>,
) -> Result<(), errors::Error> {
    if panel_ids.is_empty() {
        return Ok(());
    }

    let client = get_orm_client_rw().await;
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard '{dashboard_id}' not found"
            )))
        })?;

    timed_annotations::Entity::find()
        .filter(timed_annotations::Column::Id.eq(timed_annotation_id))
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_record.id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "TimedAnnotation with ID {timed_annotation_id} not found in dashboard {dashboard_id}"
            )))
        })?;

    delete_many_panels(timed_annotation_id, panel_ids).await
}
