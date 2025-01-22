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

use chrono::Utc;
use config::{ider, meta::timed_annotations::*};
use sea_orm::{
    prelude::Expr, ColumnTrait, Condition, DatabaseTransaction, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};

use super::{
    entity::{
        dashboards, timed_annotation_panels,
        timed_annotations::{self},
    },
    get_lock,
};
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors,
};

pub async fn get(
    dashboard_id: &str,
    panel_ids: Option<Vec<String>>,
    start_time: i64,
    end_time: i64,
) -> Result<Vec<TimedAnnotation>, errors::Error> {
    use sea_orm::{entity::*, query::*, sea_query::JoinType};

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
                "Dashboard '{}' not found",
                dashboard_id
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    // Step 2: Build the query for `timed_annotations` with a JOIN on `annotation_panels`
    let mut query = timed_annotations::Entity::find()
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk))
        .join(
            JoinType::InnerJoin,
            timed_annotations::Relation::TimedAnnotationPanels.def(),
        );

    // Step 3: If `panel_ids` is provided, filter by `panel_id`
    if let Some(panel_ids) = panel_ids {
        query = query.filter(
            Expr::col((
                timed_annotation_panels::Entity,
                timed_annotation_panels::Column::PanelId,
            ))
            .is_in(panel_ids),
        );
    }

    // Step 4: Filter by time range (overlap condition)
    // Handle entries where end_time is null and ensure start_time is within the query range
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

    // Step 5: Execute Query
    let annotations = query.all(client).await?;

    if annotations.is_empty() {
        return Ok(vec![]); // No annotations found
    }

    let annotation_ids: Vec<String> = annotations.iter().map(|a| a.id.clone()).collect();

    // Step 6: Fetch associated panels for the retrieved annotations
    let panels = timed_annotation_panels::Entity::find()
        .filter(timed_annotation_panels::Column::TimedAnnotationId.is_in(annotation_ids.clone()))
        .all(client)
        .await?;

    // Step 7: Group panel IDs by annotation ID
    let mut panels_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for panel in panels {
        panels_map
            .entry(panel.timed_annotation_id.clone())
            .or_default()
            .push(panel.panel_id.clone());
    }

    // Step 8: Combine annotations with their associated panel IDs
    let results = annotations
        .into_iter()
        .map(|annotation| TimedAnnotation {
            panels: panels_map
                .get(&annotation.id)
                .cloned()
                .unwrap_or_else(Vec::new),
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
        })
        .collect();

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
                "Dashboard '{}' not found",
                dashboard_id
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
            format!("Annotation with ID {} does not exist", timed_annotation_id),
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
                "Dashboard '{}' not found",
                dashboard_id
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
                "Dashboard '{}' not found",
                dashboard_id
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
                "TimedAnnotation with ID {} not found in dashboard {}",
                timed_annotation_id, dashboard_id
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

pub async fn update(
    dashboard_id: &str,
    timed_annotation_id: &str,
    timed_annotation: TimedAnnotationUpdate,
) -> Result<(), errors::Error> {
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
                "Dashboard '{}' not found",
                dashboard_id
            )))
        })?;

    let dashboard_pk = dashboard_record.id;

    // Step 2: Build the update query
    let mut update_query = timed_annotations::Entity::update_many()
        .filter(timed_annotations::Column::DashboardId.eq(dashboard_pk))
        .filter(timed_annotations::Column::Id.eq(timed_annotation_id));

    // Step 3: Apply updates from the `TimedAnnotationUpdate` struct
    if let Some(start_time) = timed_annotation.start_time {
        update_query = update_query.col_expr(
            timed_annotations::Column::StartTime,
            Expr::value(start_time),
        );
    }
    if let Some(end_time) = timed_annotation.end_time {
        update_query =
            update_query.col_expr(timed_annotations::Column::EndTime, Expr::value(end_time));
    }
    if let Some(title) = timed_annotation.title {
        update_query = update_query.col_expr(timed_annotations::Column::Title, Expr::value(title));
    }
    if let Some(text) = timed_annotation.text {
        update_query = update_query.col_expr(timed_annotations::Column::Text, Expr::value(text));
    }
    if let Some(tags) = timed_annotation.tags {
        // Serialize tags into a JSON value
        let tags_json = serde_json::to_value(&tags).map_err(|e| {
            let err_msg = format!("Failed to serialize tags: {}", e);
            log::error!("{}", err_msg);
            errors::Error::Message(err_msg)
        })?;
        update_query =
            update_query.col_expr(timed_annotations::Column::Tags, Expr::value(tags_json));
    }

    // Step 4: Execute the update query
    let result = update_query.exec(client).await?;

    // Step 5: Check if any rows were affected
    if result.rows_affected == 0 {
        return Err(errors::Error::DbError(errors::DbError::KeyNotExists(
            format!(
                "TimedAnnotation with ID {} not found in dashboard {}",
                timed_annotation_id, dashboard_id
            ),
        )));
    }

    Ok(())
}

pub async fn add(
    dashboard_id: &str,
    timed_annotation: TimedAnnotation,
) -> Result<Vec<TimedAnnotation>, errors::Error> {
    add_many(dashboard_id, vec![timed_annotation]).await
}

pub async fn add_many(
    dashboard_id: &str,
    timed_annotations: Vec<TimedAnnotation>,
) -> Result<Vec<TimedAnnotation>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let txn = client.begin().await?;
    let mut inserted_annotations = Vec::new();

    for timed_annotation in timed_annotations {
        let annotation = insert_timed_annotation(&txn, dashboard_id, timed_annotation).await?;
        inserted_annotations.push(annotation);
    }

    txn.commit().await?;
    Ok(inserted_annotations)
}

/// Helper function to insert a single `TimedAnnotation` record and its associated panels
async fn insert_timed_annotation<'a>(
    txn: &'a DatabaseTransaction,
    dashboard_id: &str,
    timed_annotation: TimedAnnotation,
) -> Result<TimedAnnotation, errors::Error> {
    let dashboard_record = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(txn)
        .await?
        .ok_or_else(|| {
            errors::Error::DbError(errors::DbError::KeyNotExists(format!(
                "Dashboard with ID {} not found",
                dashboard_id
            )))
        })?;
    let dashboard_pk = dashboard_record.id;

    let annotation_id = ider::uuid();
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
