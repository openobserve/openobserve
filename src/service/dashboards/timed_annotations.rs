// Copyright 2024 OpenObserve Inc.
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

use config::meta::timed_annotations::{
    TimedAnnotation, TimedAnnotationDelete, TimedAnnotationReq, TimedAnnotationUpdate,
};
use infra::table;

#[tracing::instrument]
pub async fn create_timed_annotations(
    dashboard_id: &str,
    req: TimedAnnotationReq,
) -> Result<Vec<TimedAnnotation>, anyhow::Error> {
    let res = table::timed_annotations::add_many(&dashboard_id, req.timed_annotations).await?;
    // TODO: send WATCH for super cluster
    Ok(res)
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
    // TODO: send WATCH for super cluster
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
    // TODO: send WATCH for super cluster
    Ok(())
}

#[tracing::instrument]
pub async fn update_timed_annotations(
    dashboard_id: &str,
    timed_annotation_id: &str,
    req: &TimedAnnotationUpdate,
) -> Result<TimedAnnotation, anyhow::Error> {
    table::timed_annotations::update(dashboard_id, timed_annotation_id, req.clone()).await?;

    if let Some(new_panels) = &req.panels {
        let existing_panels =
            table::timed_annotation_panels::get_panels(timed_annotation_id).await?;
        let panels_to_add: Vec<String> = new_panels
            .iter()
            .filter(|panel| !existing_panels.contains(panel))
            .cloned()
            .collect();

        // Add only new panels
        if !panels_to_add.is_empty() {
            table::timed_annotation_panels::insert_many_panels(timed_annotation_id, panels_to_add)
                .await?;
        }
    }
    let updated_record =
        table::timed_annotations::get_one(dashboard_id, timed_annotation_id).await?;

    // TODO: send WATCH for super cluster
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
    table::timed_annotation_panels::delete_many_panels(timed_annotation_id, panels).await?;

    Ok(())
}
