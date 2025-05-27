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

use sea_orm::Statement;
use sea_orm_migration::prelude::*;

use super::m20250109_092400_recreate_tables_with_ksuids::ALERTS_ORG_STREAM_TYPE_STREAM_NAME_NAME_IDX;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        log::debug!(
            "[SCHEDULED_TRIGGERS_MIGRATION] dropping alerts_org_stream_type_stream_name_name_idx_2 index"
        );
        // drop the index only if it exists
        let index_exists = manager
            .has_index(
                Alerts::Table.to_string().as_str(),
                ALERTS_ORG_STREAM_TYPE_STREAM_NAME_NAME_IDX,
            )
            .await?;
        if index_exists {
            manager
                .drop_index(
                    Index::drop()
                        .name(ALERTS_ORG_STREAM_TYPE_STREAM_NAME_NAME_IDX)
                        .table(Alerts::Table)
                        .to_owned(),
                )
                .await?;
        }

        log::debug!("[SCHEDULED_TRIGGERS_MIGRATION] updating scheduled triggers");
        update_scheduled_triggers(manager).await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Reversing this migration is not supported.
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ScheduledJobs {
    Table,
    Org,
    Module,
    ModuleKey,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    Id,
    Org,
    StreamType,
    StreamName,
    Name,
}

/// This function updates the scheduled triggers to such that the trigger module_key which
/// previously has stream_type/stream_name/alert_name as the key, now will have alert_id as the key.
async fn update_scheduled_triggers(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    // Query the alerts and scheduled jobs tables
    let db = manager.get_connection();
    let backend = db.get_database_backend();

    log::debug!("[SCHEDULED_TRIGGERS_MIGRATION] db backend: {:?}", backend);

    let select_query = Query::select()
        .column(ScheduledJobs::ModuleKey)
        .column(ScheduledJobs::Org)
        .from(ScheduledJobs::Table)
        .and_where(Expr::col(ScheduledJobs::Module).eq(1))
        .to_owned();

    let (sql, values) = match backend {
        sea_orm::DatabaseBackend::MySql => select_query.build(MysqlQueryBuilder),
        sea_orm::DatabaseBackend::Postgres => select_query.build(PostgresQueryBuilder),
        sea_orm::DatabaseBackend::Sqlite => select_query.build(SqliteQueryBuilder),
    };
    let statement = Statement::from_sql_and_values(backend, sql, values);
    log::debug!("[SCHEDULED_TRIGGERS_MIGRATION] select_query: {}", statement);

    // 1. Get all alert triggers from the scheduled jobs table
    let triggers_result = db
        .query_all(statement)
        .await
        .map_err(|e| DbErr::Custom(format!("Failed to query scheduled jobs: {}", e)))?;

    log::debug!(
        "[SCHEDULED_TRIGGERS_MIGRATION] triggers_result length: {}",
        triggers_result.len()
    );
    // 2. For each trigger
    for trigger_row in triggers_result {
        let org = trigger_row
            .try_get::<String>("", "org")
            .map_err(|e| DbErr::Custom(format!("Failed to get org: {}", e)))?;

        let module_key = trigger_row
            .try_get::<String>("", "module_key")
            .map_err(|e| DbErr::Custom(format!("Failed to get module_key: {}", e)))?;

        // Skip if the module_key doesn't match the expected pattern
        let parts: Vec<&str> = module_key.split('/').collect();
        if parts.len() != 3 {
            continue;
        }

        let stream_type = parts[0];
        let stream_name = parts[1];
        let alert_name = parts[2];

        // Query the corresponding alert to get its ID
        let alert_query = Query::select()
            .column(Alerts::Id)
            .from(Alerts::Table)
            .and_where(Expr::col(Alerts::Org).eq(org.clone()))
            .and_where(Expr::col(Alerts::StreamType).eq(stream_type))
            .and_where(Expr::col(Alerts::StreamName).eq(stream_name))
            .and_where(Expr::col(Alerts::Name).eq(alert_name))
            .to_owned();

        let backend = db.get_database_backend();
        let (sql, values) = match backend {
            sea_orm::DatabaseBackend::MySql => alert_query.build(MysqlQueryBuilder),
            sea_orm::DatabaseBackend::Postgres => alert_query.build(PostgresQueryBuilder),
            sea_orm::DatabaseBackend::Sqlite => alert_query.build(SqliteQueryBuilder),
        };
        let statement = Statement::from_sql_and_values(backend, sql, values);
        log::debug!(
            "[SCHEDULED_TRIGGERS_MIGRATION] alert_query to get id: {}",
            statement
        );
        let alert_result = db
            .query_one(statement)
            .await
            .map_err(|e| DbErr::Custom(format!("Failed to query alert: {}", e)))?;
        log::debug!(
            "[SCHEDULED_TRIGGERS_MIGRATION] alert_result is found: {}",
            alert_result.is_some()
        );

        // If we found the alert
        if let Some(alert_row) = alert_result {
            let alert_id = alert_row
                .try_get::<String>("", "id")
                .map_err(|e| DbErr::Custom(format!("Failed to get alert ID: {}", e)))?;

            log::debug!(
                "[SCHEDULED_TRIGGERS_MIGRATION] alert_id to upgrade: {}",
                alert_id
            );
            // Update the trigger module_key
            let update_query = Query::update()
                .table(ScheduledJobs::Table)
                .value(ScheduledJobs::ModuleKey, alert_id)
                .and_where(Expr::col(ScheduledJobs::Org).eq(org))
                .and_where(Expr::col(ScheduledJobs::Module).eq(1))
                .and_where(Expr::col(ScheduledJobs::ModuleKey).eq(module_key))
                .to_owned();
            let (sql, values) = match backend {
                sea_orm::DatabaseBackend::MySql => update_query.build(MysqlQueryBuilder),
                sea_orm::DatabaseBackend::Postgres => update_query.build(PostgresQueryBuilder),
                sea_orm::DatabaseBackend::Sqlite => update_query.build(SqliteQueryBuilder),
            };
            let statement = Statement::from_sql_and_values(backend, sql, values);
            log::debug!(
                "[SCHEDULED_TRIGGERS_MIGRATION] update_query alert scheduled job statement: {}",
                statement
            );
            db.execute(statement)
                .await
                .map_err(|e| DbErr::Custom(format!("Failed to update scheduled job: {}", e)))?;
        }
    }

    Ok(())
}
