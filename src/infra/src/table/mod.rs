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

use migration::Migrator;
use sea_orm::DatabaseConnection;
use sea_orm_migration::{MigratorTrait, SchemaManager};

use crate::{db::get_orm_client_ddl, dist_lock};

pub mod ai_chat_sessions;
pub mod ai_chat_shares;
pub mod alert_composites;
pub mod alert_eval_intervals;
pub mod alert_incidents;
pub mod alert_states;
pub mod alerts;
pub mod anomaly_detection;
pub mod backfill_jobs;
pub mod cipher;
pub mod compactor_manual_jobs;
#[cfg(test)]
mod composite_alerts_contract_tests;
pub mod dashboards;
pub mod destinations;
pub mod distinct_values;
pub mod enrichment_table_urls;
pub mod enrichment_tables;
pub mod entity;
pub mod evaluation_watermarks;
pub mod external_alerts;
pub mod folders;
pub mod gen_ai_agents;
pub mod incident_events;
pub mod incident_integrations;
pub mod kv_store;
pub mod llm_prompts;
pub mod llm_secrets;
mod migration;
pub mod model_pricing;
pub mod oncall_deliveries;
pub mod oncall_overrides;
pub mod oncall_ownership;
pub mod oncall_policies;
pub mod oncall_response_reports;
pub mod oncall_responses;
pub mod oncall_routing_config;
pub mod oncall_schedules;
pub mod oncall_teams;
pub mod oncall_unavailability;
pub mod oncall_user_contacts;
pub mod online_eval_jobs;
pub mod org_ai_toolsets;
pub mod org_cleanup_tasks;
pub mod org_ingestion_tokens;
pub mod org_storage_providers;
pub mod org_users;
pub mod organizations;
pub mod providers;
pub mod query_history;
pub mod ratelimit;
pub mod re_pattern;
pub mod re_pattern_stream_map;
pub mod reports;
pub mod rum_pa;
pub mod score_configs;
pub mod scorers;
pub mod search_job;
pub mod search_queue;
pub mod service_streams;
pub mod sessions;
pub mod short_urls;
pub mod slo;
pub mod slo_backfill_jobs;
pub mod slo_budget;
pub mod slos;
pub mod source_maps;
pub mod status_pages;
pub mod super_cluster_oncall;
pub mod synthetics_agents;
pub mod synthetics_checks;
pub mod synthetics_environments;
pub mod synthetics_jobs;
pub mod synthetics_locations;
pub mod synthetics_probe_tokens;
pub mod synthetics_refs;
pub mod synthetics_runs;
pub mod synthetics_variables;
pub mod system_prompts;
pub mod system_settings;
pub mod templates;
pub mod timed_annotation_panels;
pub mod timed_annotations;
#[cfg(feature = "cloud")]
pub mod trial_quota_usage;
pub mod user_auth_state;
pub mod user_password_history;
pub mod users;
pub mod workflows;

pub async fn init() -> Result<(), anyhow::Error> {
    distinct_values::init().await?;
    short_urls::init().await?;
    Ok(())
}

pub async fn migrate() -> Result<(), anyhow::Error> {
    let locker = dist_lock::lock("/database/migration", 0).await?;
    let client = get_orm_client_ddl().await;
    // read the history under the same lock the migrations write it under
    check_migration_history(client).await?;
    // This is a hack to fix the failing alerts migration
    // For postgres, we need to run the migration that populates the alerts table first.
    // Otherwise, the `m20250109_092400_recreate_tables_with_ksuids` migration will fail.
    let first_stage = get_alerts_populate_migration_index().await?;
    Migrator::up(client, Some(first_stage)).await?; // hack for failing alerts migration
    Migrator::up(client, None).await?;
    dist_lock::unlock(&locker).await?;
    Ok(())
}

/// Get the index of the migration that populates the alerts table.
/// This index is used as the first stage of the migration process.
async fn get_alerts_populate_migration_index() -> Result<u32, anyhow::Error> {
    let client = get_orm_client_ddl().await;
    let migrations = Migrator::get_pending_migrations(client).await?;
    let mut index: u32 = 0;
    for (i, migration) in migrations.iter().enumerate() {
        if migration.name() == "m20241217_155000_populate_alerts_table" {
            index = i as u32 + 1;
            break;
        }
    }
    // If the migration is not found, it is already applied so return 0
    log::debug!(
        "Migration m20241217_155000_populate_alerts_table at step {index} (0 means already applied)"
    );
    Ok(index)
}

/// Refuses to run every migration again on a database whose migration history is gone.
async fn check_migration_history(client: &DatabaseConnection) -> Result<(), anyhow::Error> {
    let manager = SchemaManager::new(client);
    // the first migration creates folders, so only a database that has run the chain has it
    if !manager.has_table("folders").await? {
        return Ok(());
    }
    // checked first because reading the history creates its table when it is missing
    if manager.has_table("seaql_migrations").await?
        && !Migrator::get_applied_migrations(client).await?.is_empty()
    {
        return Ok(());
    }
    Err(anyhow::anyhow!(
        "the migration history in seaql_migrations is empty or missing, but this database \
         already has tables created by migrations; running every migration again would fail or \
         rebuild tables that hold data, so the upgrade stops here. Restore the seaql_migrations \
         rows, for example from a backup, and start again"
    ))
}

pub async fn down(steps: Option<u32>) -> Result<(), anyhow::Error> {
    let client = get_orm_client_ddl().await;
    Migrator::down(client, steps).await?;
    Ok(())
}

pub async fn create_user_tables() -> Result<(), anyhow::Error> {
    organizations::create_table().await?;
    users::create_table().await?;
    org_users::create_table().await?;
    user_password_history::create_table().await?;
    user_auth_state::create_table().await?;

    Ok(())
}

#[macro_export]
macro_rules! orm_err {
    ($e:expr) => {
        Err($crate::errors::Error::DbError(
            $crate::errors::DbError::SeaORMError($e.to_string()),
        ))
    };
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[tokio::test]
    async fn test_check_migration_history_allows_a_fresh_database() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        check_migration_history(&db).await.unwrap();
    }

    #[tokio::test]
    async fn test_check_migration_history_allows_a_recorded_history() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(1)).await.unwrap();
        check_migration_history(&db).await.unwrap();
    }

    #[tokio::test]
    async fn test_check_migration_history_refuses_tables_without_history() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(1)).await.unwrap();
        db.execute_unprepared("DELETE FROM seaql_migrations")
            .await
            .unwrap();
        let err = check_migration_history(&db).await.unwrap_err();
        assert!(err.to_string().contains("seaql_migrations"), "{err}");
    }

    #[tokio::test]
    async fn test_check_migration_history_refuses_a_dropped_history_without_writing() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        Migrator::up(&db, Some(1)).await.unwrap();
        db.execute_unprepared("DROP TABLE seaql_migrations")
            .await
            .unwrap();
        check_migration_history(&db).await.unwrap_err();
        let manager = SchemaManager::new(&db);
        assert!(!manager.has_table("seaql_migrations").await.unwrap());
    }
}
