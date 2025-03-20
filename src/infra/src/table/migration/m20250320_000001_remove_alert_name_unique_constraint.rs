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

//! Removes the alert_name unique constraint

use sea_orm_migration::prelude::*;

use super::m20250109_092400_recreate_tables_with_ksuids::ALERTS_ORG_STREAM_TYPE_STREAM_NAME_NAME_IDX;


#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_index(Index::drop().name(ALERTS_ORG_STREAM_TYPE_STREAM_NAME_NAME_IDX).to_owned()).await?;

        update_scheduled_triggers(manager).await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

/// This function updates the scheduled triggers to such that the trigger module_key which previously
/// has stream_type/stream_name/alert_name as the key, now will have alert_id as the key.
async fn update_scheduled_triggers(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    // Query the alerts and scheduled jobs tables
    let db = manager.get_connection();
    
    // 1. Get all alert triggers from the scheduled jobs table
    let triggers_result = db
        .query_all(
            r#"
            SELECT 
                org, 
                module_key, 
                next_run_at, 
                is_realtime, 
                is_silenced, 
                status, 
                start_time, 
                end_time, 
                retries, 
                data
            FROM scheduled_jobs
            WHERE module = 1 -- Module = Alert
            "#,
        )
        .await
        .map_err(|e| DbErr::Query(format!("Failed to query scheduled jobs: {}", e)))?;

    // 2. For each trigger
    for trigger_row in triggers_result {
        let org = trigger_row.try_get::<String>("", "org")
            .map_err(|e| DbErr::Query(format!("Failed to get org: {}", e)))?;
        
        let module_key = trigger_row.try_get::<String>("", "module_key")
            .map_err(|e| DbErr::Query(format!("Failed to get module_key: {}", e)))?;
        
        // Skip if the module_key doesn't match the expected pattern
        let parts: Vec<&str> = module_key.split('/').collect();
        if parts.len() != 3 {
            continue;
        }
        
        let stream_type = parts[0];
        let stream_name = parts[1];
        let alert_name = parts[2];
        
        // Query the corresponding alert to get its ID
        let alert_result = db
            .query_one(
                r#"
                SELECT id 
                FROM alerts 
                WHERE org = ? AND stream_type = ? AND stream_name = ? AND name = ?
                "#,
            )
            .bind(org.clone())
            .bind(stream_type)
            .bind(stream_name)
            .bind(alert_name)
            .await
            .map_err(|e| DbErr::Query(format!("Failed to query alert: {}", e)))?;
        
        // If we found the alert
        if let Some(alert_row) = alert_result {
            let alert_id = alert_row.try_get::<String>("", "id")
                .map_err(|e| DbErr::Query(format!("Failed to get alert ID: {}", e)))?;
            
            // Create the new module_key with alert_id
            let new_module_key = format!("{}/{}/{}", stream_type, stream_name, alert_id);
            
            // Skip update if the keys are the same (shouldn't happen, but just in case)
            if module_key == new_module_key {
                continue;
            }
            
            // Update the trigger module_key
            db.execute(
                r#"
                UPDATE scheduled_jobs
                SET module_key = ?
                WHERE org = ? AND module = 1 AND module_key = ?
                "#,
            )
            .bind(new_module_key)
            .bind(org)
            .bind(module_key)
            .await
            .map_err(|e| DbErr::Query(format!("Failed to update scheduled job: {}", e)))?;
        }
    }
    
    Ok(())
}