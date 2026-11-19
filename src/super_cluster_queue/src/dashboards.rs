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

use config::meta::dashboards::Dashboard;
use infra::{errors::Result, table};
use o2_enterprise::enterprise::super_cluster::queue::{DashboardMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into()?;
    process_msg(msg).await?;
    Ok(())
}

pub(crate) async fn process_msg(msg: DashboardMessage) -> Result<()> {
    match msg {
        DashboardMessage::Put {
            org_id,
            folder_id,
            new_folder_id,
            dashboard,
            ..
        } => {
            let (folder_id, new_folder_id) =
                settled_move(&org_id, folder_id, new_folder_id, &dashboard).await?;
            // `clone` is always true for super cluster
            let dashboard = table::dashboards::put(
                &org_id,
                &folder_id,
                new_folder_id.as_deref(),
                dashboard,
                true,
            )
            .await?;
            // Logged, not returned: a redelivered update could land after a newer one.
            if let Some(id) = dashboard.dashboard_id()
                && let Err(e) = infra::coordinator::dashboards::emit_put_event(&org_id, id).await
            {
                log::error!("[SUPER_CLUSTER:dashboards] put event failed for {org_id}/{id}: {e}");
            }
        }
        DashboardMessage::Delete {
            org_id,
            folder_id,
            dashboard_id,
        } => {
            table::dashboards::delete_from_folder(&org_id, &folder_id, &dashboard_id).await?;
            // Returned so the message is redelivered; deleting a missing dashboard is a no-op.
            infra::coordinator::dashboards::emit_delete_event(&org_id, &dashboard_id).await?;
        }
        DashboardMessage::TimedAnnotationCreate {
            dashboard_id,
            timed_annotation,
        } => {
            table::timed_annotations::add(
                &dashboard_id,
                timed_annotation,
                true, // always true for super cluster
            )
            .await?;
        }
        DashboardMessage::TimedAnnotationUpdate {
            dashboard_id,
            timed_annotation,
        } => {
            table::timed_annotations::update(&dashboard_id, timed_annotation).await?;
        }
        DashboardMessage::TimedAnnotationDelete {
            dashboard_id,
            timed_annotation_id,
        } => {
            table::timed_annotations::delete(&dashboard_id, &timed_annotation_id).await?;
        }
        DashboardMessage::TimedAnnotationPanelsCreate {
            timed_annotation_id,
            panels,
        } => {
            table::timed_annotation_panels::insert_many_panels(&timed_annotation_id, panels)
                .await?;
        }
        DashboardMessage::TimedAnnotationPanelsDelete {
            timed_annotation_id,
            panels,
        } => {
            table::timed_annotation_panels::delete_many_panels(&timed_annotation_id, panels)
                .await?;
        }
        _ => {
            // Temporarily do catch-all message handling so that we can add new message types to
            // o2_enterprise without breaking the build.
            log::warn!("Unsupported dashboard super cluster message: {msg:?}");
        }
    };
    Ok(())
}

/// A redelivered move finds the dashboard already in its target folder, so it updates it there
/// instead of recreating it in the folder it left.
async fn settled_move(
    org_id: &str,
    folder_id: String,
    new_folder_id: Option<String>,
    dashboard: &Dashboard,
) -> Result<(String, Option<String>)> {
    let (Some(target), Some(id)) = (new_folder_id.as_deref(), dashboard.dashboard_id()) else {
        return Ok((folder_id, new_folder_id));
    };
    match table::dashboards::get_by_id_primary(org_id, id).await? {
        Some((current, _)) if current.folder_id == target && target != folder_id => {
            Ok((current.folder_id, None))
        }
        _ => Ok((folder_id, new_folder_id)),
    }
}
