// Copyright 2025 OpenObserve Inc.
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

use config::meta::timed_annotations::{TimedAnnotation, TimedAnnotationDelete, TimedAnnotationReq};
use infra::table;

#[tracing::instrument]
pub async fn create_timed_annotations(
    dashboard_id: &str,
    req: TimedAnnotationReq,
) -> Result<Vec<TimedAnnotation>, anyhow::Error> {
    let timed_annotations_res =
        table::timed_annotations::add_many(dashboard_id, req.timed_annotations, false).await?;

    #[cfg(feature = "enterprise")]
    for timed_annotation in timed_annotations_res.iter() {
        match super_cluster::emit_timed_annotation_create_event(
            dashboard_id,
            timed_annotation.clone(),
        )
        .await
        {
            Ok(_) => (),
            Err(e) => log::error!(
                "[dashboard_id: {dashboard_id}] Failed to emit event to super cluster: {e:?}"
            ),
        };
    }

    Ok(timed_annotations_res)
}

#[tracing::instrument]
pub async fn get_timed_annotations(
    dashboard_id: &str,
    panels: Option<Vec<String>>,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<TimedAnnotation>, anyhow::Error> {
    let annotations =
        table::timed_annotations::get(dashboard_id, panels, start_time, end_time).await?;
    Ok(annotations)
}

#[tracing::instrument]
pub async fn delete_timed_annotations(
    dashboard_id: &str,
    req: TimedAnnotationDelete,
) -> Result<(), anyhow::Error> {
    if req.annotation_ids.is_empty() {
        return Err(anyhow::anyhow!("annotation_ids cannot be empty"));
    }
    table::timed_annotations::delete_many(dashboard_id, &req.annotation_ids).await?;

    #[cfg(feature = "enterprise")]
    for id in req.annotation_ids.iter() {
        match super_cluster::emit_timed_annotation_delete_event(dashboard_id, id).await {
            Ok(_) => (),
            Err(e) => log::error!(
                "[timed_annotation_id: {id}] Failed to emit event to super cluster: {e:?}"
            ),
        };
    }

    Ok(())
}

#[tracing::instrument]
pub async fn update_timed_annotations(
    dashboard_id: &str,
    timed_annotation_id: &str,
    req: &TimedAnnotation,
) -> Result<TimedAnnotation, anyhow::Error> {
    table::timed_annotations::update(dashboard_id, req.clone()).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_timed_annotation_put_event(dashboard_id, req.clone()).await?;

    let updated_record =
        table::timed_annotations::get_one(dashboard_id, timed_annotation_id).await?;

    Ok(updated_record)
}

#[tracing::instrument]
pub async fn delete_timed_annotation_panels(
    timed_annotation_id: &str,
    panels: Vec<String>,
) -> Result<(), anyhow::Error> {
    if panels.is_empty() {
        return Err(anyhow::anyhow!("panels cannot be empty"));
    }
    table::timed_annotation_panels::delete_many_panels(timed_annotation_id, panels.clone()).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_timed_annotation_panels_delete_event(timed_annotation_id, panels).await?;

    Ok(())
}

/// Helper functions for sending events to the super cluster queue.
#[cfg(feature = "enterprise")]
mod super_cluster {
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    use super::TimedAnnotation;

    pub async fn emit_timed_annotation_create_event(
        dashboard_id: &str,
        timed_annotation: TimedAnnotation,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::timed_annotations_create(
                dashboard_id,
                timed_annotation,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to super cluster queue for a new timed annotation entry.    
    pub async fn emit_timed_annotation_put_event(
        dashboard_id: &str,
        timed_annotation: TimedAnnotation,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::timed_annotations_put(
                dashboard_id,
                timed_annotation,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to super cluster queue for a deleted timed annotation entry.
    pub async fn emit_timed_annotation_delete_event(
        dashboard_id: &str,
        timed_annotation_id: &str,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::timed_annotations_delete(
                dashboard_id,
                timed_annotation_id,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    // TODO: remove if not required
    /// Sends event to super cluster queue for a new timed annotation panels entry.
    pub async fn _emit_timed_annotation_panels_put_event(
        timed_annotation_id: &str,
        panels: Vec<String>,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::timed_annotation_panels_put(
                timed_annotation_id,
                panels,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to super cluster queue for a deleted timed annotation panels entry.
    pub async fn emit_timed_annotation_panels_delete_event(
        timed_annotation_id: &str,
        panels: Vec<String>,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::timed_annotation_panels_delete(
                timed_annotation_id,
                panels,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }
}
