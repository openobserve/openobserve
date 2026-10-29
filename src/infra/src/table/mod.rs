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
#[cfg(any(test, feature = "test-utils"))]
pub use migration::create_fleet_collectors_for_test;
use sea_orm::DatabaseConnection;
use sea_orm_migration::{MigratorTrait, SchemaManager};

use crate::{db::get_orm_client_ddl, dist_lock};

pub mod ai_access_requests;
pub mod ai_actions;
pub mod ai_approvals;
pub mod ai_chat_feedback;
pub mod ai_chat_imports;
pub mod ai_chat_sessions;
pub mod ai_chat_shares;
pub mod ai_chat_turns;
pub mod ai_grants;
pub mod ai_turn_marks;
pub mod alert_acks;
pub mod alert_calibration;
pub mod alert_composites;
pub mod alert_eval_intervals;
pub mod alert_incidents;
#[cfg(test)]
mod alert_slack_postgres_tests;
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
pub mod downtime_notifications;
pub mod downtimes;
pub mod enrichment_table_urls;
pub mod enrichment_tables;
pub mod entity;
pub mod eval_job_states;
pub mod evaluation_watermarks;
pub mod external_alerts;
pub mod external_identity_links;
pub mod fleet_collectors;
pub mod fleet_configs;
pub mod fleet_rollouts;
pub mod fleet_settings;
pub mod fleet_tokens;
pub mod fleets;
pub mod folders;
pub mod gen_ai_agents;
pub mod incident_events;
pub mod incident_integrations;
pub mod kv_store;
pub mod llm_eval;
pub mod llm_prompts;
pub mod llm_secrets;
mod migration;
pub mod model_pricing;
pub mod oncall_deliveries;
pub mod oncall_overrides;
pub mod oncall_ownership;
pub mod oncall_phone_verifications;
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
pub mod org_telephony;
pub mod org_users;
pub mod organizations;
#[cfg(feature = "cloud")]
pub mod paid_overage_attribution;
pub mod providers;
pub mod public_dashboards;
pub mod query_history;
pub mod ratelimit;
pub mod rca_runs;
pub mod rca_steering;
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
#[cfg(any(test, feature = "test-utils"))]
pub mod slack;
pub mod slack_alert_messages;
pub mod slack_channel_defaults;
pub mod slack_installations;
pub mod slack_link_requests;
pub mod slack_org_connections;
mod slack_shared;
pub mod slack_threads;
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
#[cfg(test)]
pub(crate) mod testing;
pub mod timed_annotation_panels;
pub mod timed_annotations;
#[cfg(feature = "cloud")]
pub mod trial_quota_usage;
mod ttl_cache;
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
    // read the history under the same lock the migrations write it under
    run_migrations(get_orm_client_ddl().await).await?;
    dist_lock::unlock(&locker).await?;
    Ok(())
}

async fn run_migrations(client: &DatabaseConnection) -> Result<(), anyhow::Error> {
    // Reading the history fails on the draft migrations' missing files, so forget them first.
    migration::forget_draft_migrations(client).await?;
    check_migration_history(client).await?;
    // This is a hack to fix the failing alerts migration
    // For postgres, we need to run the migration that populates the alerts table first.
    // Otherwise, the `m20250109_092400_recreate_tables_with_ksuids` migration will fail.
    let first_stage = get_alerts_populate_migration_index(client).await?;
    Migrator::up(client, Some(first_stage)).await?; // hack for failing alerts migration
    Migrator::up(client, None).await?;
    Ok(())
}

/// Get the index of the migration that populates the alerts table.
/// This index is used as the first stage of the migration process.
async fn get_alerts_populate_migration_index(
    client: &DatabaseConnection,
) -> Result<u32, anyhow::Error> {
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

/// Deletes the rows `delete` matches and returns `cols` of each, in one statement.
pub(crate) async fn delete_returning<E, T, C>(
    conn: &C,
    delete: sea_orm::DeleteMany<E>,
    cols: &[E::Column],
) -> Result<Vec<T>, sea_orm::DbErr>
where
    E: sea_orm::EntityTrait,
    T: sea_orm::TryGetableMany,
    C: sea_orm::ConnectionTrait,
{
    use sea_orm::{Iden, QueryTrait, sea_query::Query};
    let mut stmt = delete.into_query();
    stmt.returning(Query::returning().columns(cols.iter().copied()));
    let names: Vec<String> = cols.iter().map(|c| c.to_string()).collect();
    let rows = conn
        .query_all(conn.get_database_backend().build(&stmt))
        .await?;
    rows.iter()
        .map(|row| T::try_get_many(row, "", &names).map_err(sea_orm::DbErr::from))
        .collect()
}

/// `delete_returning` of whole rows; sea-orm's `exec_with_returning` panics on SQLite here.
pub(crate) async fn delete_returning_models<E, C>(
    conn: &C,
    delete: sea_orm::DeleteMany<E>,
) -> Result<Vec<E::Model>, sea_orm::DbErr>
where
    E: sea_orm::EntityTrait,
    C: sea_orm::ConnectionTrait,
{
    use sea_orm::{FromQueryResult, QueryTrait, sea_query::Query};
    let mut stmt = delete.into_query();
    stmt.returning(Query::returning().all());
    let rows = conn
        .query_all(conn.get_database_backend().build(&stmt))
        .await?;
    rows.iter()
        .map(|row| E::Model::from_query_result(row, ""))
        .collect()
}

/// `value` cut to `max_chars` characters, so a row never fails a Postgres/MySQL column width.
pub(crate) fn fit(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
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
    use sea_orm::{ConnectionTrait, Database, Statement};

    use super::*;

    #[test]
    fn fit_cuts_on_characters_not_bytes() {
        assert_eq!(fit("héllo", 2), "hé");
        assert_eq!(fit("ok", 64), "ok");
    }

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

    /// A database that ran the public dashboard migrations under their 15 October names.
    #[tokio::test]
    async fn test_migrate_renames_the_pre_merge_public_dashboard_migrations() {
        const OLD: [&str; 2] = [
            "m20261015_000001_create_public_dashboards",
            "m20261015_000002_add_search_type_to_search_queue",
        ];
        const NEW: [&str; 2] = [
            "m20261021_000001_create_public_dashboards",
            "m20261021_000002_add_search_type_to_search_queue",
        ];
        let db = Database::connect("sqlite::memory:").await.unwrap();
        migration::create_search_queue_schema_for_test(&db)
            .await
            .unwrap();
        migration::create_public_dashboards_schema_for_test(&db)
            .await
            .unwrap();
        Migrator::install(&db).await.unwrap();
        let names: Vec<String> = Migrator::migrations()
            .iter()
            .map(|m| m.name().to_string())
            .filter(|n| !NEW.contains(&n.as_str()))
            .chain(OLD.map(String::from))
            .collect();
        for name in &names {
            db.execute_unprepared(&format!(
                "INSERT INTO seaql_migrations (version, applied_at) VALUES ('{name}', 1)"
            ))
            .await
            .unwrap();
        }
        for sql in [
            "CREATE TABLE folders (id varchar(27) NOT NULL PRIMARY KEY)",
            "INSERT INTO public_dashboards (id, org_id, folder_id, dashboard_id, slug, name, \
             dashboard_version, published_by, created_by, created_at, updated_at, rev) VALUES \
             ('l1', 'o', 'f', 'd', 's', 'wall', 8, 'p', 'p', 1, 2, 3)",
            "INSERT INTO public_dashboard_org_settings (org_id, rev, enabled, max_links, \
             updated_at, updated_by) VALUES ('o', 4, false, 7, 5, 'admin')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }

        run_migrations(&db).await.unwrap();

        let applied: Vec<String> = Migrator::get_applied_migrations(&db)
            .await
            .unwrap()
            .iter()
            .map(|m| m.name().to_string())
            .collect();
        for name in NEW {
            assert!(applied.iter().any(|n| n == name), "{name} did not run");
        }
        for name in OLD {
            assert!(
                !applied.iter().any(|n| n == name),
                "{name} is still recorded"
            );
        }
        assert!(
            Migrator::get_pending_migrations(&db)
                .await
                .unwrap()
                .is_empty()
        );
        let link = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT slug, name, rev FROM public_dashboards WHERE id = 'l1'",
            ))
            .await
            .unwrap()
            .expect("the link survives");
        assert_eq!(link.try_get::<String>("", "slug").unwrap(), "s");
        assert_eq!(link.try_get::<String>("", "name").unwrap(), "wall");
        assert_eq!(link.try_get::<i64>("", "rev").unwrap(), 3);
        let settings = db
            .query_one(Statement::from_string(
                db.get_database_backend(),
                "SELECT rev, enabled, max_links FROM public_dashboard_org_settings \
                 WHERE org_id = 'o'",
            ))
            .await
            .unwrap()
            .expect("the org settings survive");
        assert_eq!(settings.try_get::<i64>("", "rev").unwrap(), 4);
        assert!(!settings.try_get::<bool>("", "enabled").unwrap());
        assert_eq!(settings.try_get::<i32>("", "max_links").unwrap(), 7);
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
