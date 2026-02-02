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

use config::{meta::self_reporting::error::PipelineError, utils::time::now_micros};
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    table::entity::{pipeline_last_errors, prelude::PipelineLastErrors},
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

/// Upserts a pipeline error record.
///
/// If the pipeline_id already exists, updates the existing record.
/// If it doesn't exist, creates a new record.
pub async fn upsert(
    pipeline_id: &str,
    pipeline_name: &str,
    org_id: &str,
    timestamp: i64,
    error_data: &PipelineError,
) -> Result<(), infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Serialize node_errors to JSON
    let node_errors_json = if !error_data.node_errors.is_empty() {
        Some(serde_json::to_value(&error_data.node_errors)?)
    } else {
        None
    };

    // Check if record exists
    let existing = PipelineLastErrors::find_by_id(pipeline_id)
        .one(client)
        .await?;

    if let Some(existing_model) = existing {
        // Check if error content has actually changed
        let error_changed = existing_model.error_summary != error_data.error
            || existing_model.node_errors != node_errors_json;

        // Only update if error content changed
        if error_changed {
            let mut active_model: pipeline_last_errors::ActiveModel = existing_model.into();
            active_model.last_error_timestamp = Set(timestamp);
            active_model.error_summary = Set(error_data.error.clone());
            active_model.node_errors = Set(node_errors_json);
            active_model.updated_at = Set(now_micros());

            active_model.update(client).await?;
        }
        // If error hasn't changed, skip the write to avoid unnecessary DB load
    } else {
        // Insert new record
        let now = now_micros();
        let active_model = pipeline_last_errors::ActiveModel {
            pipeline_id: Set(pipeline_id.to_string()),
            org_id: Set(org_id.to_string()),
            pipeline_name: Set(pipeline_name.to_string()),
            last_error_timestamp: Set(timestamp),
            error_summary: Set(error_data.error.clone()),
            node_errors: Set(node_errors_json),
            created_at: Set(now),
            updated_at: Set(now),
        };

        active_model.insert(client).await?;
    }

    Ok(())
}

/// Batch upserts multiple pipeline error records in a single transaction.
///
/// This is more efficient than individual upserts when processing multiple errors.
/// Uses a transaction to ensure atomicity.
pub async fn batch_upsert(
    errors: Vec<(String, String, String, i64, PipelineError)>, /* (pipeline_id, pipeline_name, org_id, timestamp, error_data) */
) -> Result<(), infra::errors::Error> {
    if errors.is_empty() {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client.begin().await?;

    // Collect all pipeline_ids to check which exist
    let pipeline_ids: Vec<&str> = errors.iter().map(|(id, ..)| id.as_str()).collect();

    let existing_records = PipelineLastErrors::find()
        .filter(pipeline_last_errors::Column::PipelineId.is_in(pipeline_ids))
        .all(&txn)
        .await?;

    // Store existing records in a map for efficient lookup and comparison
    let existing_map: std::collections::HashMap<String, pipeline_last_errors::Model> =
        existing_records
            .into_iter()
            .map(|r| (r.pipeline_id.clone(), r))
            .collect();

    let now = now_micros();

    for (pipeline_id, pipeline_name, org_id, timestamp, error_data) in errors {
        // Serialize node_errors to JSON
        let node_errors_json = if !error_data.node_errors.is_empty() {
            Some(serde_json::to_value(&error_data.node_errors)?)
        } else {
            None
        };

        if let Some(existing) = existing_map.get(&pipeline_id) {
            // Check if error content has actually changed
            let error_changed = existing.error_summary != error_data.error
                || existing.node_errors != node_errors_json;

            // Only update if error content changed
            if error_changed {
                let mut active_model: pipeline_last_errors::ActiveModel = existing.clone().into();
                active_model.last_error_timestamp = Set(timestamp);
                active_model.error_summary = Set(error_data.error.clone());
                active_model.node_errors = Set(node_errors_json);
                active_model.updated_at = Set(now);

                active_model.update(&txn).await?;
            }
            // If error hasn't changed, skip the write to reduce DB load
        } else {
            // Insert new record
            let active_model = pipeline_last_errors::ActiveModel {
                pipeline_id: Set(pipeline_id),
                org_id: Set(org_id),
                pipeline_name: Set(pipeline_name),
                last_error_timestamp: Set(timestamp),
                error_summary: Set(error_data.error.clone()),
                node_errors: Set(node_errors_json),
                created_at: Set(now),
                updated_at: Set(now),
            };

            active_model.insert(&txn).await?;
        }
    }

    txn.commit().await?;
    Ok(())
}

/// Retrieves all pipeline errors for a given organization.
///
/// Results are ordered by last_error_timestamp descending (most recent first).
pub async fn list_by_org(
    org_id: &str,
) -> Result<Vec<pipeline_last_errors::Model>, infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let errors = PipelineLastErrors::find()
        .filter(pipeline_last_errors::Column::OrgId.eq(org_id))
        .order_by_desc(pipeline_last_errors::Column::LastErrorTimestamp)
        .all(client)
        .await?;

    Ok(errors)
}

/// Retrieves a pipeline error by pipeline_id.
pub async fn get_by_pipeline_id(
    pipeline_id: &str,
) -> Result<Option<pipeline_last_errors::Model>, infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let error = PipelineLastErrors::find_by_id(pipeline_id)
        .one(client)
        .await?;

    Ok(error)
}

/// Deletes a pipeline error record by pipeline_id.
pub async fn delete(pipeline_id: &str) -> Result<(), infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    PipelineLastErrors::delete_many()
        .filter(pipeline_last_errors::Column::PipelineId.eq(pipeline_id))
        .exec(client)
        .await?;

    Ok(())
}

/// Deletes all pipeline error records for an organization.
pub async fn delete_by_org(org_id: &str) -> Result<(), infra::errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    PipelineLastErrors::delete_many()
        .filter(pipeline_last_errors::Column::OrgId.eq(org_id))
        .exec(client)
        .await?;

    Ok(())
}

/// Deletes pipeline error records older than the specified cutoff timestamp.
///
/// This is used for periodic cleanup of stale errors.
pub async fn delete_older_than(cutoff_timestamp: i64) -> Result<u64, infra::errors::Error> {
    let _lock = infra::table::get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let result = PipelineLastErrors::delete_many()
        .filter(pipeline_last_errors::Column::LastErrorTimestamp.lt(cutoff_timestamp))
        .exec(client)
        .await?;

    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::meta::self_reporting::error::{NodeErrors, PipelineError};

    use super::*;

    #[tokio::test]
    #[ignore] // Requires database connection
    async fn test_upsert_and_get() {
        let pipeline_id = "test_pipeline_123";
        let org_id = "test_org";
        let pipeline_name = "Test Pipeline";
        let timestamp = now_micros();

        let mut node_errors = HashMap::new();
        node_errors.insert(
            "node_1".to_string(),
            NodeErrors::new("node_1".to_string(), "function".to_string(), None),
        );

        let error_data = PipelineError {
            pipeline_id: pipeline_id.to_string(),
            pipeline_name: pipeline_name.to_string(),
            error: Some("Test error message".to_string()),
            node_errors,
        };

        // Insert
        let result = upsert(pipeline_id, pipeline_name, org_id, timestamp, &error_data).await;
        assert!(result.is_ok());

        // Get
        let retrieved = get_by_pipeline_id(pipeline_id).await.unwrap();
        assert!(retrieved.is_some());
        let model = retrieved.unwrap();
        assert_eq!(model.pipeline_id, pipeline_id);
        assert_eq!(model.org_id, org_id);

        // Update
        let updated_timestamp = timestamp + 1000;
        let result = upsert(
            pipeline_id,
            pipeline_name,
            org_id,
            updated_timestamp,
            &error_data,
        )
        .await;
        assert!(result.is_ok());

        // Verify update
        let retrieved = get_by_pipeline_id(pipeline_id).await.unwrap();
        assert!(retrieved.is_some());
        let model = retrieved.unwrap();
        assert_eq!(model.last_error_timestamp, updated_timestamp);

        // Cleanup
        delete(pipeline_id).await.unwrap();
    }

    #[tokio::test]
    #[ignore] // Requires database connection
    async fn test_list_by_org() {
        let org_id = "test_org_list";
        let timestamp = now_micros();

        let error_data = PipelineError {
            pipeline_id: "pl1".to_string(),
            pipeline_name: "Pipeline 1".to_string(),
            error: Some("Error 1".to_string()),
            node_errors: HashMap::new(),
        };

        // Insert multiple records
        upsert("pl1", "Pipeline 1", org_id, timestamp, &error_data)
            .await
            .unwrap();
        upsert("pl2", "Pipeline 2", org_id, timestamp + 1000, &error_data)
            .await
            .unwrap();

        // List
        let errors = list_by_org(org_id).await.unwrap();
        assert!(errors.len() >= 2);

        // Verify ordering (most recent first)
        if errors.len() >= 2 {
            assert!(errors[0].last_error_timestamp >= errors[1].last_error_timestamp);
        }

        // Cleanup
        delete_by_org(org_id).await.unwrap();
    }

    #[tokio::test]
    #[ignore] // Requires database connection
    async fn test_delete() {
        let pipeline_id = "test_pipeline_delete";
        let org_id = "test_org";
        let timestamp = now_micros();

        let error_data = PipelineError {
            pipeline_id: pipeline_id.to_string(),
            pipeline_name: "Test Pipeline".to_string(),
            error: Some("Test error".to_string()),
            node_errors: HashMap::new(),
        };

        // Insert
        upsert(pipeline_id, "Test Pipeline", org_id, timestamp, &error_data)
            .await
            .unwrap();

        // Verify exists
        let retrieved = get_by_pipeline_id(pipeline_id).await.unwrap();
        assert!(retrieved.is_some());

        // Delete
        delete(pipeline_id).await.unwrap();

        // Verify deleted
        let retrieved = get_by_pipeline_id(pipeline_id).await.unwrap();
        assert!(retrieved.is_none());
    }
}
