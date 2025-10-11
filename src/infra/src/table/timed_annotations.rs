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

use std::collections::HashMap;

use chrono::Utc;
use config::{ider, meta::timed_annotations::*};
use sea_orm::{
    ColumnTrait, Condition, DatabaseTransaction, EntityTrait, QueryFilter, Set, TransactionTrait,
    prelude::Expr,
};

use super::{
    entity::{
        dashboards, timed_annotation_panels,
        timed_annotations::{self},
    },
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

pub async fn get(
    dashboard_id: &str,
    panel_ids: Option<Vec<String>>,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<TimedAnnotation>, errors::Error> {
    // make sure only one client is writing to the database (only for SQLite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Step 1: Resolve the user-facing `dashboard_id` to the primary key (KSUID)
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard '{dashboard_id}' not found"
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    // Step 2: Build the query for `timed_annotations`
    let mut query = timed_annotations::Entity::find()
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk));

    // Step 3: Combine panel filtering logic
    if let Some(ref panel_ids) = panel_ids {
        query = query.filter(
            Condition::any()
                .add(
                    Expr::col((
                        timed_annotation_panels::Entity,
                        timed_annotation_panels::Column::PanelId,
                    ))
                    .is_in(panel_ids.to_vec()), /* Include annotations linked to the specified
                                                 * panels */
                )
                .add(
                    Expr::col((
                        timed_annotation_panels::Entity,
                        timed_annotation_panels::Column::PanelId,
                    ))
                    .is_null(), // Include annotations with no panels
                ),
        );
    }

    // Step 4: Filter by time range (overlap condition)
    query = query
        .filter(
            Expr::col((
                timed_annotations::Entity,
                timed_annotations::Column::StartTime,
            ))
            .lte(end_time), // annotation.start_time <= end_time
        )
        .filter(
            Condition::any()
                .add(
                    Expr::col((
                        timed_annotations::Entity,
                        timed_annotations::Column::EndTime,
                    ))
                    .gte(start_time), // annotation.end_time >= start_time
                )
                .add(
                    Condition::all()
                        .add(
                            Expr::col((
                                timed_annotations::Entity,
                                timed_annotations::Column::EndTime,
                            ))
                            .is_null(), // end_time is null
                        )
                        .add(
                            Expr::col((
                                timed_annotations::Entity,
                                timed_annotations::Column::StartTime,
                            ))
                            .gte(start_time), // annotation.start_time >= start_time
                        ),
                ),
        );

    // Step 5: Execute Query with `find_also_related`
    let annotations_with_panels = query
        .find_also_related(timed_annotation_panels::Entity)
        .all(client)
        .await?;

    if annotations_with_panels.is_empty() {
        return Ok(vec![]);
    }

    // Step 6: Group annotations and aggregate panels
    let mut grouped_annotations: HashMap<String, TimedAnnotation> = HashMap::new();

    for (annotation, panel) in annotations_with_panels {
        let annotation_id = annotation.id.clone();

        // Initialize the annotation if not already present in the HashMap
        grouped_annotations
            .entry(annotation_id.clone())
            .or_insert_with(|| TimedAnnotation {
                annotation_id: Some(annotation.id.clone()),
                start_time: annotation.start_time,
                end_time: annotation.end_time,
                title: annotation.title,
                text: annotation.text,
                tags: annotation
                    .tags
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect(),
                panels: vec![], // Initialize with an empty panel list
            });

        // Add the panel ID to the annotation, if it exists
        if let Some(panel) = panel {
            grouped_annotations
                .get_mut(&annotation_id)
                .unwrap()
                .panels
                .push(panel.panel_id.clone());
        }
    }

    // Step 7: Fetch all panels for the annotations (to ensure we include all panels)
    let annotation_ids: Vec<String> = grouped_annotations.keys().cloned().collect();
    let all_panels = timed_annotation_panels::Entity::find()
        .filter(timed_annotation_panels::Column::TimedAnnotationId.is_in(annotation_ids))
        .all(client)
        .await?;

    // Map all panels to their respective annotations
    for panel in all_panels {
        if let Some(annotation) = grouped_annotations.get_mut(&panel.timed_annotation_id)
            && !annotation.panels.contains(&panel.panel_id)
        {
            annotation.panels.push(panel.panel_id.clone());
        }
    }

    // Step 8: Convert grouped annotations back into a Vec
    let results: Vec<TimedAnnotation> = grouped_annotations.into_values().collect();

    Ok(results)
}

pub async fn delete(dashboard_id: &str, timed_annotation_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard '{dashboard_id}' not found"
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    let delete_result = timed_annotations::Entity::delete_many()
        .filter(timed_annotations::Column::Id.eq(timed_annotation_id))
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk))
        .exec(client)
        .await?;

    if delete_result.rows_affected == 0 {
        return Err(errors::Error::DbError(errors::DbError::KeyNotExists(
            format!("Annotation with ID {timed_annotation_id} does not exist"),
        )));
    }

    Ok(())
}

pub async fn delete_many(
    dashboard_id: &str,
    timed_annotation_ids: &[String],
) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard '{dashboard_id}' not found"
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    // Step 1: Build the condition to match multiple annotation IDs
    let mut condition = Condition::any(); // Use `Condition::any()` to OR multiple conditions
    for id in timed_annotation_ids {
        condition = condition.add(timed_annotations::Column::Id.eq(id));
    }

    // Step 2: Perform the batch deletion
    let delete_result = timed_annotations::Entity::delete_many()
        .filter(condition) // Match the IDs
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk)) // Ensure they belong to the same dashboard
        .exec(client)
        .await?;

    // Step 3: Check if any rows were deleted
    if delete_result.rows_affected == 0 {
        return Err(errors::Error::DbError(errors::DbError::KeyNotExists(
            "No matching annotations found for deletion".to_string(),
        )));
    }

    Ok(())
}

pub async fn get_one(
    dashboard_id: &str,
    timed_annotation_id: &str,
) -> Result<TimedAnnotation, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    // Initialize the ORM client
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Step 1: Resolve the user-facing `dashboard_id` to the primary key
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard '{dashboard_id}' not found"
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    // Step 2: Fetch the annotation by `dashboard_id` and `timed_annotation_id`
    let annotation = timed_annotations::Entity::find()
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk))
        .filter(timed_annotations::Column::Id.eq(timed_annotation_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "TimedAnnotation with ID {timed_annotation_id} not found in dashboard {dashboard_id}"
            )))
        })?;

    // Step 3: Fetch associated panels for the annotation
    let panels = timed_annotation_panels::Entity::find()
        .filter(timed_annotation_panels::Column::TimedAnnotationId.eq(timed_annotation_id))
        .all(client)
        .await?;

    // Step 4: Collect panel IDs
    let panel_ids: Vec<String> = panels.into_iter().map(|panel| panel.panel_id).collect();

    // Step 5: Map the database model (`timed_annotations::Model`) to the domain model
    // (`TimedAnnotation`)
    let timed_annotation = TimedAnnotation {
        annotation_id: Some(annotation.id),
        start_time: annotation.start_time,
        end_time: annotation.end_time,
        title: annotation.title,
        text: annotation.text,
        tags: annotation
            .tags
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        panels: panel_ids,
    };

    // Step 6: Return the result
    Ok(timed_annotation)
}

// Update db using `TimedAnnotation` if panels or tags is empty it should delete the old
// entries
pub async fn update(
    dashboard_id: &str,
    timed_annotation: TimedAnnotation,
) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    // Initialize the ORM client
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let txn = client.begin().await?;

    // Step 1: Resolve the user-facing `dashboard_id` to the primary key
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(&txn)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard '{dashboard_id}' not found"
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    let timed_annotation_id = timed_annotation
        .annotation_id
        .ok_or_else(|| errors::Error::Message("Annotation ID is required".to_string()))?;

    // Step 2: Build the update query
    let mut update_query = timed_annotations::Entity::update_many()
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk))
        .filter(timed_annotations::Column::Id.eq(timed_annotation_id.clone()));

    // start_time
    update_query = update_query.col_expr(
        timed_annotations::Column::StartTime,
        Expr::value(timed_annotation.start_time),
    );

    // end_time
    if let Some(end_time) = timed_annotation.end_time {
        update_query =
            update_query.col_expr(timed_annotations::Column::EndTime, Expr::value(end_time));
    } else {
        update_query = update_query.col_expr(
            timed_annotations::Column::EndTime,
            Expr::value(Option::<i64>::None),
        );
    }

    // title
    update_query = update_query.col_expr(
        timed_annotations::Column::Title,
        Expr::value(timed_annotation.title),
    );

    // text
    if let Some(text) = timed_annotation.text {
        update_query = update_query.col_expr(timed_annotations::Column::Text, Expr::value(text));
    } else {
        update_query = update_query.col_expr(
            timed_annotations::Column::Text,
            Expr::value(sea_orm::Value::Json(None)),
        );
    }

    // tags
    let tags_json = serde_json::to_value(&timed_annotation.tags).map_err(|e| {
        let err_msg = format!("Failed to serialize tags: {e}");
        log::error!("{err_msg}");
        errors::Error::Message(err_msg)
    })?;
    update_query = update_query.col_expr(timed_annotations::Column::Tags, Expr::value(tags_json));

    // Step 3: Execute the update query
    update_query.exec(&txn).await?;

    // Step 4: Handle panels
    if timed_annotation.panels.is_empty() {
        // Delete old panels
        timed_annotation_panels::Entity::delete_many()
            .filter(
                timed_annotation_panels::Column::TimedAnnotationId.eq(timed_annotation_id.clone()),
            )
            .exec(&txn)
            .await?;
    } else {
        // Update panels
        let panel_ids: Vec<_> = timed_annotation.panels.to_vec();
        let existing_panels: Vec<String> = timed_annotation_panels::Entity::find()
            .filter(
                timed_annotation_panels::Column::TimedAnnotationId.eq(timed_annotation_id.clone()),
            )
            .all(&txn)
            .await?
            .into_iter()
            .map(|panel| panel.panel_id)
            .collect();

        let panels_to_delete: Vec<_> = existing_panels
            .iter()
            .filter(|id| !panel_ids.contains(id))
            .cloned()
            .collect();
        let panels_to_add: Vec<_> = panel_ids
            .iter()
            .filter(|id| !existing_panels.contains(id))
            .cloned()
            .collect();

        if !panels_to_delete.is_empty() {
            timed_annotation_panels::Entity::delete_many()
                .filter(
                    Condition::all()
                        .add(
                            timed_annotation_panels::Column::TimedAnnotationId
                                .eq(timed_annotation_id.clone()),
                        )
                        .add(timed_annotation_panels::Column::PanelId.is_in(panels_to_delete)),
                )
                .exec(&txn)
                .await?;
        }

        for panel_id in panels_to_add {
            let panel_record = timed_annotation_panels::ActiveModel {
                id: Set(ider::uuid()),
                timed_annotation_id: Set(timed_annotation_id.clone()),
                panel_id: Set(panel_id),
            };

            timed_annotation_panels::Entity::insert(panel_record)
                .exec(&txn)
                .await?;
        }
    }

    // Commit the transaction
    txn.commit().await?;

    Ok(())
}

pub async fn add(
    dashboard_id: &str,
    timed_annotation: TimedAnnotation,
    use_given_id: bool,
) -> Result<Vec<TimedAnnotation>, errors::Error> {
    add_many(dashboard_id, vec![timed_annotation], use_given_id).await
}

pub async fn add_many(
    dashboard_id: &str,
    timed_annotations: Vec<TimedAnnotation>,
    use_given_id: bool,
) -> Result<Vec<TimedAnnotation>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let txn = client.begin().await?;
    let mut inserted_annotations = Vec::new();

    for timed_annotation in timed_annotations {
        let annotation =
            insert_timed_annotation(&txn, dashboard_id, timed_annotation, use_given_id).await?;
        inserted_annotations.push(annotation);
    }

    txn.commit().await?;
    Ok(inserted_annotations)
}

/// Helper function to insert a single `TimedAnnotation` record and its associated panels
async fn insert_timed_annotation(
    txn: &DatabaseTransaction,
    dashboard_id: &str,
    timed_annotation: TimedAnnotation,
    use_given_id: bool,
) -> Result<TimedAnnotation, errors::Error> {
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(txn)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard with ID {dashboard_id} not found"
            )))
        })?;
    let dashboard_pk = dashboard_record.id;

    let annotation_id: String = if use_given_id {
        timed_annotation.annotation_id.ok_or_else(|| {
            let err_msg = "Annotation ID is required when `use_given_id` is set to true";
            log::error!("{err_msg}");
            errors::Error::Message(err_msg.to_string())
        })?
    } else {
        ider::uuid()
    };
    let record = timed_annotations::ActiveModel {
        id: Set(annotation_id.clone()),
        dashboard_id: Set(dashboard_pk.to_string()),
        start_time: Set(timed_annotation.start_time),
        end_time: Set(timed_annotation.end_time),
        title: Set(timed_annotation.title.clone()),
        text: Set(timed_annotation.text.clone()),
        tags: Set(timed_annotation.tags.clone().into()),
        created_at: Set(Utc::now().timestamp_micros()),
    };

    timed_annotations::Entity::insert(record).exec(txn).await?;

    for panel_id in &timed_annotation.panels {
        let panel_record = timed_annotation_panels::ActiveModel {
            id: Set(ider::uuid()),
            timed_annotation_id: Set(annotation_id.clone()),
            panel_id: Set(panel_id.clone()),
        };

        timed_annotation_panels::Entity::insert(panel_record)
            .exec(txn)
            .await?;
    }

    Ok(TimedAnnotation {
        annotation_id: Some(annotation_id),
        start_time: timed_annotation.start_time,
        end_time: timed_annotation.end_time,
        title: timed_annotation.title,
        text: timed_annotation.text,
        tags: timed_annotation.tags,
        panels: timed_annotation.panels,
    })
}
