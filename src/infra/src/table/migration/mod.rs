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

// Allow enterprise feature cfg check (defined at workspace level)
#![allow(unexpected_cfgs)]

use config::meta::meta_store::MetaStore;
pub use sea_orm_migration::prelude::*;

mod m20241114_000001_create_folders_table;
mod m20241115_150000_populate_folders_table;
mod m20241116_000001_delete_metas;
mod m20241116_000002_drop_folders_created_at_column;
mod m20241119_000001_create_dashboards_table;
mod m20241119_000002_populate_dashboards_table;
mod m20241119_000003_delete_metas;
mod m20241204_143100_create_table_search_queue;
mod m20241209_120000_create_alerts_table;
mod m20241215_190333_delete_metas;
mod m20241217_154900_alter_folders_table_idx;
mod m20241217_155000_populate_alerts_table;
mod m20241222_085111_search_jobs;
mod m20241222_085135_search_job_partitions;
mod m20241222_085148_search_job_results;
mod m20241227_000001_create_organizations_table;
mod m20241227_000100_populate_organizations_table;
mod m20241227_000200_create_users_table;
mod m20241227_000300_create_org_users_table;
mod m20241227_000400_populate_users_table;
// mod m20241227_000500_delete_meta_users_table;
mod m20250107_160900_delete_bad_dashboards;
mod m20250109_092400_recreate_tables_with_ksuids;
mod m20250113_144600_create_unique_folder_name_idx;
mod m20250121_120000_create_cipher_table;
mod m20250122_000001_create_table_action_scripts;
mod m20250124_000001_create_timed_annotations_table;
mod m20250124_000002_create_timed_annotation_panels_table;
mod m20250125_102300_create_destinations_table;
mod m20250125_115400_create_templates_table;
mod m20250125_132500_populate_templates_table;
mod m20250125_133700_populate_destinations_table;
mod m20250125_153005_delete_metas_destinations;
mod m20250125_172300_delete_metas_templates;
mod m20250213_000001_add_dashboard_updated_at;
mod m20250217_115548_ratelimit_table;
mod m20250320_000001_remove_alert_name_unique_constraint;
mod m20250422_000001_add_alert_align_time;
mod m20250520_000001_add_trial_end_col;
mod m20250611_000001_create_reports_table;
mod m20250611_000002_populate_reports_table;
mod m20250611_000003_populate_reports_scheduled_jobs;
mod m20250612_000001_create_re_pattern_table;
mod m20250612_000002_create_re_pattern_stream_map_table;
mod m20250716_000001_create_enrichment_table;
mod m20250731_000001_create_compactor_manual_jobs;
mod m20250801_000001_create_system_prompts_table;
mod m20250822_093713_add_updated_at_for_file_list_table;
mod m20250923_000001_update_enrichment_table_data_size;
mod m20250930_000001_create_pipeline_last_errors_table;
mod m20251024_000001_add_alert_deduplication;
mod m20251105_000001_update_enrichment_table_created_at_mysql;
mod m20251118_000001_add_alert_row_template_type;
mod m20251118_000002_create_sessions_table;
mod m20251118_000003_delete_meta_sessions;
mod m20251126_100001_create_service_streams_table;
mod m20251126_100002_create_service_streams_dimensions_table;
mod m20251128_000001_create_kv_store_table;
mod m20251128_000002_populate_kv_store_table;
mod m20251128_000003_delete_kv_from_meta;
mod m20251204_000001_create_alert_incidents_table;
mod m20251207_000001_create_system_settings_table;
mod m20251218_000001_add_expires_at_to_sessions;
mod m20251219_000001_add_org_id_to_search_queue;
mod m20251221_000001_create_enrichment_table_urls;
mod m20251226_000001_add_enrichment_table_urls_is_local_region;
mod m20251229_000001_create_backfill_jobs;
mod m20251230_000001_add_allow_static_token_to_org_users;
mod m20260107_000001_sync_distinct_stream_retention;
mod m20260108_000001_recreate_enrichment_table_urls_with_ksuids;
mod m20260113_000001_add_alert_template;
mod m20260116_000001_add_enabled_to_backfill_jobs;
mod m20260119_000001_add_stat_interval_to_ratelimit;
mod m20260121_00001_create_sourcemap_table;
mod m20260131_000001_add_unique_constraint_templates_org_name;
mod m20260212_000001_widen_incident_correlation_key;
mod m20260214_000001_create_incident_events_table;
mod m20260227_000001_add_alert_creates_incident;
mod m20260305_000001_create_trial_quota_usage_table;
mod m20260310_000001_create_anomaly_detection_config_table;
mod m20260310_000002_create_anomaly_detection_models_table;
mod m20260312_000001_create_eval_templates_table;
mod m20260317_000001_add_anomaly_detection_config_columns;
mod m20260318_000001_recreate_service_streams_schema;
mod m20260318_000002_drop_service_streams_dimensions;
mod m20260318_000003_alter_alert_incidents_schema;
mod m20260318_000004_add_set_id_to_service_streams;
mod m20260318_000005_add_all_dimensions_to_service_streams;
mod m20260326_000001_add_field_name_mapping_to_service_streams;
mod m20260331_000001_create_sys_rca_agent_service_accounts;
mod m20260401_00001_create_org_s3_table;
mod m20260402_000001_reports_add_image_fields;
mod m20260414_000001_add_is_system_to_cipher_keys;
mod m20260414_000002_create_org_ai_toolsets;
mod m20260415_000001_create_model_pricing_table;
mod m20260415_000002_add_source_to_model_pricing;
mod m20260504_000001_add_anomaly_detection_config_folder_fk;
mod m20260506_000001_create_org_ingestion_tokens_table;
mod m20260520_000001_create_providers_table;
mod m20260520_000002_create_score_configs_table;
mod m20260520_000003_create_scorers_table;
mod m20260520_000004_create_online_eval_jobs_table;
mod m20260520_000005_drop_eval_templates_table;
mod m20260604_000001_add_kind_to_pipeline;
mod m20260622_000001_add_org_id_to_short_urls;
mod m20260623_000001_create_org_cleanup_tasks;
mod m20260623_000002_add_status_and_deleted_at_to_organizations;
mod m20260629_000001_create_gen_ai_agents_table;
mod m20260707_000001_create_synthetics_monitors;
mod m20260707_000002_create_synthetics_runs;
mod m20260707_000003_create_synthetics_jobs;
mod m20260707_000004_create_synthetics_probe_tokens;
mod m20260710_000001_add_target_scope_to_online_eval_jobs;
mod m20260714_000001_create_synthetics_locations;
mod m20260714_000002_create_synthetics_agents;
mod m20260720_000001_add_alert_workflows_col;
mod m20260720_000001_create_workflow_errors_table;
mod m20260720_000001_create_workflow_run_data_table;
mod m20260720_000001_create_workflows_table;
mod m20260723_000001_add_env_version_to_gen_ai_agents;
mod m20260724_000001_add_name_is_default_to_synthetics_probe_tokens;
mod m20260724_000002_add_token_id_to_synthetics_agents;
mod m20260725_000001_create_alert_states_tables;
mod m20260725_000002_add_threshold_and_level_columns;
mod m20260726_000001_add_priority_and_tags_to_alerts;
mod m20260726_000002_add_priority_and_tags_to_anomaly_config;
mod m20260726_000003_add_group_lifecycle_columns;
mod m20260727_000001_create_slo_tables;
mod m20260727_000002_add_slo_columns_to_alerts;
mod m20260728_000001_create_workflows_associations_table;
mod m20260729_000001_add_promql_multi_alert_to_alerts;
mod m20260730_000001_add_alert_state_to_synthetics_monitors;
mod m20260730_000002_create_incident_integrations;
mod m20260730_000003_create_external_alerts;
mod m20260730_000004_add_alert_kind_to_incident_alerts;
mod m20260731_000001_create_llm_annotation_queue_tables;
mod m20260731_000003_create_llm_dataset_tables;
mod m20260802_000001_add_template_kind;
mod m20260803_000001_add_destinations_to_incident_integrations;
mod m20260803_000001_add_down_notified_at_to_synthetics_locations;
mod m20260804_000001_create_workflow_drafts_table;
mod m20260806_000001_create_oncall_tables;
mod m20260807_000001_create_oncall_ownership;
mod m20260809_000001_create_alert_eval_intervals_table;
mod m20260811_000001_create_llm_experiments;
mod m20260811_000001_create_oncall_unrouted_signals;
mod m20260812_000001_add_provider_rate_limits;
mod m20260812_000001_create_composite_alerts;
mod m20260812_000001_create_oncall_routing_config;
mod m20260812_000002_create_oncall_overrides;
mod m20260812_000003_create_oncall_contacts_and_reads;
mod m20260813_000001_create_oncall_unavailability;
mod m20260818_000001_create_llm_idempotency_records;
mod m20260818_000002_create_llm_remote_tasks;
mod m20260820_000001_add_icon_to_folders;
mod m20260820_000003_create_llm_secrets;
mod m20260822_000001_create_status_pages_tables;
mod m20260824_000001_add_incident_acknowledged_columns;
mod m20260824_000001_create_llm_playground_snapshots;
mod m20260825_000001_add_alert_pending_period_col;
mod m20260825_000001_add_steps_configured_to_synthetics_jobs;
mod m20260825_000001_create_status_page_custom_domains;
mod m20260827_000001_drop_table_action_scripts;
mod m20260831_000001_add_exhausted_at_to_oncall_responses;
mod m20260901_000001_reset_anomaly_detection_retries;
mod m20260903_000001_add_anomaly_last_failed_at;
mod m20260906_000001_add_anomaly_last_alert_fired_at;
mod m20260908_000001_create_synthetics_refs;
mod m20260910_000001_add_folder_id_to_workflows;
mod m20260911_000001_add_splunk_token_to_org_ingestion_tokens;
mod m20260912_000001_add_anomaly_alert_budget;
mod m20260912_000002_add_anomaly_last_recovery_notified_at;
mod m20260915_000001_add_profiles_streams_to_service_streams;
mod m20260916_000001_add_folder_id_to_workflow_drafts;
mod m20260917_000001_add_env_to_synthetics_jobs;
mod m20260917_000001_create_llm_experiment_slot_retries;
mod m20260917_000001_create_synthetics_shared_variables;
mod m20260918_000001_create_oncall_response_reports;
mod m20260920_000001_add_anomaly_level_half_width;
mod m20260921_000001_add_input_preview_to_llm_annotation_queue_items;
mod m20260922_000001_add_password_policy_columns_to_users;
mod m20260922_000002_create_user_password_history_table;
mod m20260922_000003_create_user_auth_state_table;
mod m20260923_000001_create_ai_chat_sessions;
mod m20260923_000001_create_llm_prompts;
mod m20260924_000001_add_recovery_episode_columns;
mod m20260928_000001_add_alert_recovery_destinations;
mod m20261001_000001_add_anomaly_band_settings;
mod m20261003_000001_create_rum_pa_tables;
mod m20261004_000001_create_query_history;
mod m20261005_000001_create_fleet;
mod m20261006_000001_create_ai_chat_shares;
mod m20261007_000001_create_ai_chat_turns;
mod m20261007_000001_scope_alert_dedup_state_by_org;
mod m20261007_000002_add_redact_tools_to_ai_chat_shares;
mod m20261008_000001_add_name_to_rum_pa_tombstones;
mod m20261009_000001_add_promql_rule_mode;
mod m20261009_000001_create_downtimes;
mod m20261009_000002_add_muted_by_downtime_id_to_alert_incidents;
mod m20261009_000003_add_last_downtime_id_to_alert_states;
mod m20261009_000004_add_kind_to_slo_backfill_jobs;
mod m20261009_000005_create_downtime_notifications;
mod m20261012_000001_create_alert_calibration_configs;
mod m20261013_000001_create_oncall_phone_verifications;
mod m20261013_000002_create_org_telephony;
mod m20261015_000001_reports_add_last_run_columns;
mod m20261016_000001_add_first_event_at_to_ai_chat_turns;
mod m20261016_000001_create_rca_runs;
mod m20261016_000001_create_rum_pa_app_settings;
mod m20261017_000001_add_rca_run_progress_columns;
mod m20261018_000001_create_rca_steering;
mod m20261018_000001_create_slack_tables;
mod m20261020_000001_add_health_to_org_ai_toolsets;
mod m20261020_000001_create_eval_job_states_tables;
mod m20261020_000002_create_ai_grants;
mod m20261020_000003_create_ai_actions;
mod m20261020_000004_create_ai_access_requests;
mod m20261020_000005_create_ai_turn_marks;
mod m20261021_000001_add_history_to_ai_chat_sessions;
mod m20261021_000001_create_public_dashboards;
mod m20261021_000001_status_pages_add_favicon_img;
mod m20261021_000002_add_search_type_to_search_queue;
mod m20261021_000002_add_versions_to_ai_chat_turns;
mod m20261021_000003_add_hide_attachments_to_ai_chat_shares;
mod m20261021_000004_create_ai_chat_feedback;
mod m20261021_000005_create_ai_chat_imports;
mod m20261021_000006_create_paid_overage_attribution;
mod m20261021_000007_create_ai_approvals;
mod m20261024_000001_add_lease_to_org_cleanup_tasks;
mod m20261025_000001_add_firing_started_at_to_alert_states;
mod m20261025_000002_create_alert_acks;
mod m20261025_000003_add_mute_targets_to_downtimes;
mod m20261025_000004_create_slack_alert_messages;
mod m20261025_000005_add_held_action_to_slack_link_requests;
mod m20261026_000001_backfill_v1_rca_pointer;
mod m20261028_000001_add_group_label_set_to_alert_states;
mod m20261029_000001_widen_alert_dedup_fingerprint;
/// Shared body of the two `folder_id` migrations above; not a migration itself.
mod workflow_folder_id;

pub(crate) use m20261021_000001_create_public_dashboards::forget_draft_migrations;

#[cfg(any(test, feature = "test-utils"))]
pub(crate) async fn create_public_dashboards_schema_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    m20261021_000001_create_public_dashboards::Migration
        .up(&SchemaManager::new(db))
        .await
}

/// The search queue as migrations 109 and earlier leave it.
#[cfg(test)]
pub(crate) async fn create_search_queue_schema_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    let manager = SchemaManager::new(db);
    m20241204_143100_create_table_search_queue::Migration
        .up(&manager)
        .await?;
    m20251219_000001_add_org_id_to_search_queue::Migration
        .up(&manager)
        .await?;
    m20261021_000002_add_search_type_to_search_queue::Migration
        .up(&manager)
        .await
}

#[cfg(any(test, feature = "test-utils"))]
pub async fn create_fleet_collectors_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    use sea_orm::ConnectionTrait;

    let manager = SchemaManager::new(db);
    m20261005_000001_create_fleet::Migration
        .up(&manager)
        .await?;
    // Folder rows are what fleet writes lock, so the fleet tests need the shared table too.
    let backend = db.get_database_backend();
    let mut folders =
        sea_orm::Schema::new(backend).create_table_from_entity(super::entity::folders::Entity);
    db.execute(backend.build(folders.if_not_exists())).await?;
    Ok(())
}

#[cfg(test)]
pub(crate) async fn create_llm_prompt_schema_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    m20260923_000001_create_llm_prompts::Migration
        .up(&SchemaManager::new(db))
        .await
}

#[cfg(test)]
pub(crate) async fn create_scheduled_jobs_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    let manager = SchemaManager::new(db);
    manager
        .create_table(
            Table::create()
                .table(Alias::new("scheduled_jobs"))
                .if_not_exists()
                .col(
                    ColumnDef::new(Alias::new("id"))
                        .big_integer()
                        .not_null()
                        .primary_key()
                        .auto_increment(),
                )
                // The scheduler owns `claim_epoch` (see infra::scheduler's
                // idempotent bootstrap); the test helper mirrors that so the
                // composite migration never has to add it.
                .col(
                    ColumnDef::new(Alias::new("claim_epoch"))
                        .big_integer()
                        .not_null()
                        .default(0),
                )
                .to_owned(),
        )
        .await
}

#[cfg(test)]
pub(crate) async fn create_composite_alert_tables_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    use m20260825_000001_add_alert_pending_period_col as update;
    use sea_orm_migration::MigrationTrait;

    create_scheduled_jobs_for_test(db).await?;
    let manager = SchemaManager::new(db);
    m20260812_000001_create_composite_alerts::Migration
        .up(&manager)
        .await?;
    manager
        .alter_table(update::get_update_stmt_composites())
        .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn composite_alert_migration_sql_for_test(
    backend: sea_orm::DatabaseBackend,
) -> Vec<String> {
    use m20260812_000001_create_composite_alerts as migration;
    use m20260825_000001_add_alert_pending_period_col as update;

    let mut sql = vec![
        backend
            .build(&migration::composites_statement())
            .to_string(),
        backend.build(&migration::children_statement()).to_string(),
        backend
            .build(&migration::reverse_index_statement())
            .to_string(),
        backend
            .build(&update::get_update_stmt_composites())
            .to_string(),
    ];
    sql.extend(
        migration::composite_indexes()
            .iter()
            .map(|statement| backend.build(statement).to_string()),
    );
    sql
}

/// Apply **only** the SLO tables, for targeted integration tests.
///
/// `Migrator::up` replays the whole chain from 2022, whose earliest migrations
/// assume the legacy `meta` table already exists — it is created outside the
/// migrator during normal startup. Tests that only care about the SLO tables
/// would otherwise have to reconstruct that history, which would test the
/// fixture rather than the schema.
#[cfg(test)]
pub(crate) async fn create_slo_tables_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    use sea_orm_migration::MigrationTrait;
    let manager = SchemaManager::new(db);
    m20260727_000001_create_slo_tables::Migration
        .up(&manager)
        .await?;
    m20261009_000004_add_kind_to_slo_backfill_jobs::Migration
        .up(&manager)
        .await
}

#[cfg(test)]
pub(crate) async fn create_downtime_notifications_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    use sea_orm_migration::MigrationTrait;
    m20261009_000005_create_downtime_notifications::Migration
        .up(&SchemaManager::new(db))
        .await
}

#[cfg(test)]
pub(crate) async fn create_alert_calibration_configs_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    m20261012_000001_create_alert_calibration_configs::Migration
        .up(&SchemaManager::new(db))
        .await
}

/// Apply only the RUM Product Analytics tables, idempotently, for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub(crate) async fn create_rum_pa_tables(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    use sea_orm_migration::MigrationTrait;
    let manager = SchemaManager::new(db);
    m20261003_000001_create_rum_pa_tables::Migration
        .up(&manager)
        .await?;
    m20261008_000001_add_name_to_rum_pa_tombstones::Migration
        .up(&manager)
        .await?;
    m20261016_000001_create_rum_pa_app_settings::Migration
        .up(&manager)
        .await
}

/// Apply only the Slack app tables, idempotently, for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub(crate) async fn create_slack_tables<C: sea_orm::ConnectionTrait>(db: &C) -> Result<(), DbErr> {
    m20261018_000001_create_slack_tables::create_all(db).await?;
    m20261025_000004_create_slack_alert_messages::create_all(db).await?;
    m20261025_000005_add_held_action_to_slack_link_requests::add_column(db).await
}

/// Apply only `alert_acks`, idempotently, for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub(crate) async fn create_alert_acks_table<C: sea_orm::ConnectionTrait>(
    db: &C,
) -> Result<(), DbErr> {
    m20261025_000002_create_alert_acks::create_all(db).await
}

#[cfg(test)]
pub(crate) async fn create_alert_states_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    use sea_orm_migration::MigrationTrait;
    let manager = SchemaManager::new(db);
    m20260725_000001_create_alert_states_tables::Migration
        .up(&manager)
        .await?;
    m20261025_000001_add_firing_started_at_to_alert_states::Migration
        .up(&manager)
        .await?;
    m20261028_000001_add_group_label_set_to_alert_states::Migration
        .up(&manager)
        .await
}

/// Tables the Phase 2 migrations alter; `downtimes` is bare to skip its folder key.
#[cfg(test)]
pub(crate) async fn create_alert_slack_prerequisites_for_test(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), DbErr> {
    use sea_orm::ConnectionTrait;
    use sea_orm_migration::MigrationTrait;
    m20260725_000001_create_alert_states_tables::Migration
        .up(&SchemaManager::new(db))
        .await?;
    m20261018_000001_create_slack_tables::create_all(db).await?;
    db.execute_unprepared("CREATE TABLE IF NOT EXISTS downtimes (id varchar(27) PRIMARY KEY)")
        .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn alert_slack_migrations_for_test() -> Vec<Box<dyn MigrationTrait>> {
    vec![
        Box::new(m20261025_000001_add_firing_started_at_to_alert_states::Migration),
        Box::new(m20261025_000002_create_alert_acks::Migration),
        Box::new(m20261025_000003_add_mute_targets_to_downtimes::Migration),
        Box::new(m20261025_000004_create_slack_alert_messages::Migration),
        Box::new(m20261025_000005_add_held_action_to_slack_link_requests::Migration),
    ]
}

/// Run the v1 run-pointer backfill over the current rows, for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub(crate) async fn backfill_v1_rca_pointer(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    m20261026_000001_backfill_v1_rca_pointer::Migration
        .up(&SchemaManager::new(db))
        .await
}

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20241114_000001_create_folders_table::Migration),
            Box::new(m20241115_150000_populate_folders_table::Migration),
            Box::new(m20241116_000001_delete_metas::Migration),
            Box::new(m20241116_000002_drop_folders_created_at_column::Migration),
            Box::new(m20241119_000001_create_dashboards_table::Migration),
            Box::new(m20241119_000002_populate_dashboards_table::Migration),
            Box::new(m20241119_000003_delete_metas::Migration),
            Box::new(m20241204_143100_create_table_search_queue::Migration),
            Box::new(m20241209_120000_create_alerts_table::Migration),
            Box::new(m20241215_190333_delete_metas::Migration),
            Box::new(m20241217_154900_alter_folders_table_idx::Migration),
            Box::new(m20241217_155000_populate_alerts_table::Migration),
            Box::new(m20241222_085111_search_jobs::Migration),
            Box::new(m20241222_085135_search_job_partitions::Migration),
            Box::new(m20241222_085148_search_job_results::Migration),
            Box::new(m20241227_000001_create_organizations_table::Migration),
            Box::new(m20241227_000100_populate_organizations_table::Migration),
            Box::new(m20241227_000200_create_users_table::Migration),
            Box::new(m20241227_000300_create_org_users_table::Migration),
            Box::new(m20241227_000400_populate_users_table::Migration),
            // TODO: Include this in a future pr
            // Box::new(m20241227_000500_delete_meta_users_table::Migration),
            Box::new(m20250107_160900_delete_bad_dashboards::Migration),
            Box::new(m20250109_092400_recreate_tables_with_ksuids::Migration),
            Box::new(m20250113_144600_create_unique_folder_name_idx::Migration),
            Box::new(m20250121_120000_create_cipher_table::Migration),
            Box::new(m20250122_000001_create_table_action_scripts::Migration),
            Box::new(m20250124_000001_create_timed_annotations_table::Migration),
            Box::new(m20250124_000002_create_timed_annotation_panels_table::Migration),
            Box::new(m20250125_115400_create_templates_table::Migration),
            Box::new(m20250125_132500_populate_templates_table::Migration),
            Box::new(m20250125_172300_delete_metas_templates::Migration),
            Box::new(m20250125_102300_create_destinations_table::Migration),
            Box::new(m20250125_133700_populate_destinations_table::Migration),
            Box::new(m20250125_153005_delete_metas_destinations::Migration),
            Box::new(m20250213_000001_add_dashboard_updated_at::Migration),
            Box::new(m20250217_115548_ratelimit_table::Migration),
            Box::new(m20250320_000001_remove_alert_name_unique_constraint::Migration),
            Box::new(m20250422_000001_add_alert_align_time::Migration),
            Box::new(m20250520_000001_add_trial_end_col::Migration),
            Box::new(m20250611_000001_create_reports_table::Migration),
            Box::new(m20250611_000002_populate_reports_table::Migration),
            Box::new(m20250611_000003_populate_reports_scheduled_jobs::Migration),
            Box::new(m20250612_000001_create_re_pattern_table::Migration),
            Box::new(m20250612_000002_create_re_pattern_stream_map_table::Migration),
            Box::new(m20250716_000001_create_enrichment_table::Migration),
            Box::new(m20250731_000001_create_compactor_manual_jobs::Migration),
            Box::new(m20250801_000001_create_system_prompts_table::Migration),
            Box::new(m20250822_093713_add_updated_at_for_file_list_table::Migration),
            Box::new(m20250923_000001_update_enrichment_table_data_size::Migration),
            Box::new(m20250930_000001_create_pipeline_last_errors_table::Migration),
            Box::new(m20251024_000001_add_alert_deduplication::Migration),
            Box::new(m20251105_000001_update_enrichment_table_created_at_mysql::Migration),
            Box::new(m20251118_000001_add_alert_row_template_type::Migration),
            Box::new(m20251118_000002_create_sessions_table::Migration),
            Box::new(m20251118_000003_delete_meta_sessions::Migration),
            Box::new(m20251126_100001_create_service_streams_table::Migration),
            Box::new(m20251126_100002_create_service_streams_dimensions_table::Migration),
            Box::new(m20251128_000001_create_kv_store_table::Migration),
            Box::new(m20251128_000002_populate_kv_store_table::Migration),
            Box::new(m20251128_000003_delete_kv_from_meta::Migration),
            Box::new(m20251204_000001_create_alert_incidents_table::Migration),
            Box::new(m20251207_000001_create_system_settings_table::Migration),
            Box::new(m20251219_000001_add_org_id_to_search_queue::Migration),
            Box::new(m20251221_000001_create_enrichment_table_urls::Migration),
            Box::new(m20251218_000001_add_expires_at_to_sessions::Migration),
            Box::new(m20251226_000001_add_enrichment_table_urls_is_local_region::Migration),
            Box::new(m20251229_000001_create_backfill_jobs::Migration),
            Box::new(m20251230_000001_add_allow_static_token_to_org_users::Migration),
            Box::new(m20260107_000001_sync_distinct_stream_retention::Migration),
            Box::new(m20260108_000001_recreate_enrichment_table_urls_with_ksuids::Migration),
            Box::new(m20260113_000001_add_alert_template::Migration),
            Box::new(m20260116_000001_add_enabled_to_backfill_jobs::Migration),
            Box::new(m20260119_000001_add_stat_interval_to_ratelimit::Migration),
            Box::new(m20260121_00001_create_sourcemap_table::Migration),
            Box::new(m20260131_000001_add_unique_constraint_templates_org_name::Migration),
            Box::new(m20260212_000001_widen_incident_correlation_key::Migration),
            Box::new(m20260214_000001_create_incident_events_table::Migration),
            Box::new(m20260227_000001_add_alert_creates_incident::Migration),
            Box::new(m20260305_000001_create_trial_quota_usage_table::Migration),
            Box::new(m20260310_000001_create_anomaly_detection_config_table::Migration),
            Box::new(m20260310_000002_create_anomaly_detection_models_table::Migration),
            Box::new(m20260312_000001_create_eval_templates_table::Migration),
            Box::new(m20260317_000001_add_anomaly_detection_config_columns::Migration),
            Box::new(m20260318_000001_recreate_service_streams_schema::Migration),
            Box::new(m20260318_000002_drop_service_streams_dimensions::Migration),
            Box::new(m20260318_000003_alter_alert_incidents_schema::Migration),
            Box::new(m20260318_000004_add_set_id_to_service_streams::Migration),
            Box::new(m20260318_000005_add_all_dimensions_to_service_streams::Migration),
            Box::new(m20260326_000001_add_field_name_mapping_to_service_streams::Migration),
            Box::new(m20260331_000001_create_sys_rca_agent_service_accounts::Migration),
            Box::new(m20260402_000001_reports_add_image_fields::Migration),
            Box::new(m20260414_000001_add_is_system_to_cipher_keys::Migration),
            Box::new(m20260414_000002_create_org_ai_toolsets::Migration),
            Box::new(m20260415_000001_create_model_pricing_table::Migration),
            Box::new(m20260415_000002_add_source_to_model_pricing::Migration),
            Box::new(m20260504_000001_add_anomaly_detection_config_folder_fk::Migration),
            Box::new(m20260506_000001_create_org_ingestion_tokens_table::Migration),
            Box::new(m20260401_00001_create_org_s3_table::Migration),
            Box::new(m20260520_000001_create_providers_table::Migration),
            Box::new(m20260520_000002_create_score_configs_table::Migration),
            Box::new(m20260520_000003_create_scorers_table::Migration),
            Box::new(m20260520_000004_create_online_eval_jobs_table::Migration),
            Box::new(m20260520_000005_drop_eval_templates_table::Migration),
            Box::new(m20260604_000001_add_kind_to_pipeline::Migration),
            Box::new(m20260622_000001_add_org_id_to_short_urls::Migration),
            Box::new(m20260623_000001_create_org_cleanup_tasks::Migration),
            Box::new(m20260623_000002_add_status_and_deleted_at_to_organizations::Migration),
            Box::new(m20260629_000001_create_gen_ai_agents_table::Migration),
            Box::new(m20260707_000001_create_synthetics_monitors::Migration),
            Box::new(m20260707_000002_create_synthetics_runs::Migration),
            Box::new(m20260707_000003_create_synthetics_jobs::Migration),
            Box::new(m20260707_000004_create_synthetics_probe_tokens::Migration),
            Box::new(m20260710_000001_add_target_scope_to_online_eval_jobs::Migration),
            Box::new(m20260714_000001_create_synthetics_locations::Migration),
            Box::new(m20260714_000002_create_synthetics_agents::Migration),
            Box::new(m20260720_000001_create_workflows_table::Migration),
            Box::new(m20260720_000001_create_workflow_errors_table::Migration),
            Box::new(m20260720_000001_create_workflow_run_data_table::Migration),
            Box::new(m20260720_000001_add_alert_workflows_col::Migration),
            Box::new(m20260723_000001_add_env_version_to_gen_ai_agents::Migration),
            Box::new(m20260724_000001_add_name_is_default_to_synthetics_probe_tokens::Migration),
            Box::new(m20260724_000002_add_token_id_to_synthetics_agents::Migration),
            Box::new(m20260725_000001_create_alert_states_tables::Migration),
            Box::new(m20260725_000002_add_threshold_and_level_columns::Migration),
            Box::new(m20260726_000001_add_priority_and_tags_to_alerts::Migration),
            Box::new(m20260726_000002_add_priority_and_tags_to_anomaly_config::Migration),
            Box::new(m20260726_000003_add_group_lifecycle_columns::Migration),
            Box::new(m20260727_000001_create_slo_tables::Migration),
            Box::new(m20260727_000002_add_slo_columns_to_alerts::Migration),
            Box::new(m20260728_000001_create_workflows_associations_table::Migration),
            Box::new(m20260729_000001_add_promql_multi_alert_to_alerts::Migration),
            Box::new(m20260730_000001_add_alert_state_to_synthetics_monitors::Migration),
            Box::new(m20260730_000002_create_incident_integrations::Migration),
            Box::new(m20260730_000003_create_external_alerts::Migration),
            Box::new(m20260730_000004_add_alert_kind_to_incident_alerts::Migration),
            Box::new(m20260731_000001_create_llm_annotation_queue_tables::Migration),
            Box::new(m20260731_000003_create_llm_dataset_tables::Migration),
            Box::new(m20260802_000001_add_template_kind::Migration),
            Box::new(m20260803_000001_add_down_notified_at_to_synthetics_locations::Migration),
            Box::new(m20260803_000001_add_destinations_to_incident_integrations::Migration),
            Box::new(m20260804_000001_create_workflow_drafts_table::Migration),
            Box::new(m20260809_000001_create_alert_eval_intervals_table::Migration),
            Box::new(m20260811_000001_create_llm_experiments::Migration),
            Box::new(m20260812_000001_add_provider_rate_limits::Migration),
            Box::new(m20260812_000001_create_composite_alerts::Migration),
            Box::new(m20260818_000001_create_llm_idempotency_records::Migration),
            Box::new(m20260818_000002_create_llm_remote_tasks::Migration),
            Box::new(m20260820_000001_add_icon_to_folders::Migration),
            Box::new(m20260820_000003_create_llm_secrets::Migration),
            Box::new(m20260822_000001_create_status_pages_tables::Migration),
            Box::new(m20260824_000001_create_llm_playground_snapshots::Migration),
            Box::new(m20260825_000001_add_steps_configured_to_synthetics_jobs::Migration),
            Box::new(m20260825_000001_add_alert_pending_period_col::Migration),
            Box::new(m20260825_000001_create_status_page_custom_domains::Migration),
            Box::new(m20260827_000001_drop_table_action_scripts::Migration),
            Box::new(m20260806_000001_create_oncall_tables::Migration),
            Box::new(m20260807_000001_create_oncall_ownership::Migration),
            Box::new(m20260811_000001_create_oncall_unrouted_signals::Migration),
            Box::new(m20260812_000001_create_oncall_routing_config::Migration),
            Box::new(m20260812_000002_create_oncall_overrides::Migration),
            Box::new(m20260812_000003_create_oncall_contacts_and_reads::Migration),
            Box::new(m20260813_000001_create_oncall_unavailability::Migration),
            Box::new(m20260824_000001_add_incident_acknowledged_columns::Migration),
            Box::new(m20260831_000001_add_exhausted_at_to_oncall_responses::Migration),
            Box::new(m20260901_000001_reset_anomaly_detection_retries::Migration),
            Box::new(m20260903_000001_add_anomaly_last_failed_at::Migration),
            Box::new(m20260906_000001_add_anomaly_last_alert_fired_at::Migration),
            Box::new(m20260910_000001_add_folder_id_to_workflows::Migration),
            Box::new(m20260911_000001_add_splunk_token_to_org_ingestion_tokens::Migration),
            Box::new(m20260912_000001_add_anomaly_alert_budget::Migration),
            Box::new(m20260912_000002_add_anomaly_last_recovery_notified_at::Migration),
            Box::new(m20260915_000001_add_profiles_streams_to_service_streams::Migration),
            Box::new(m20260916_000001_add_folder_id_to_workflow_drafts::Migration),
            Box::new(m20260917_000001_create_llm_experiment_slot_retries::Migration),
            Box::new(m20260917_000001_create_synthetics_shared_variables::Migration),
            Box::new(m20260917_000001_add_env_to_synthetics_jobs::Migration),
            Box::new(m20260921_000001_add_input_preview_to_llm_annotation_queue_items::Migration),
            Box::new(m20260922_000001_add_password_policy_columns_to_users::Migration),
            Box::new(m20260922_000002_create_user_password_history_table::Migration),
            Box::new(m20260922_000003_create_user_auth_state_table::Migration),
            Box::new(m20260920_000001_add_anomaly_level_half_width::Migration),
            Box::new(m20260923_000001_create_llm_prompts::Migration),
            Box::new(m20260924_000001_add_recovery_episode_columns::Migration),
            Box::new(m20260928_000001_add_alert_recovery_destinations::Migration),
            Box::new(m20260918_000001_create_oncall_response_reports::Migration),
            Box::new(m20260908_000001_create_synthetics_refs::Migration),
            Box::new(m20261001_000001_add_anomaly_band_settings::Migration),
            Box::new(m20261003_000001_create_rum_pa_tables::Migration),
            Box::new(m20261004_000001_create_query_history::Migration),
            Box::new(m20261007_000001_scope_alert_dedup_state_by_org::Migration),
            Box::new(m20261008_000001_add_name_to_rum_pa_tombstones::Migration),
            Box::new(m20261009_000001_add_promql_rule_mode::Migration),
            Box::new(m20261009_000001_create_downtimes::Migration),
            Box::new(m20261009_000002_add_muted_by_downtime_id_to_alert_incidents::Migration),
            Box::new(m20261009_000003_add_last_downtime_id_to_alert_states::Migration),
            Box::new(m20261009_000004_add_kind_to_slo_backfill_jobs::Migration),
            Box::new(m20261009_000005_create_downtime_notifications::Migration),
            Box::new(m20261012_000001_create_alert_calibration_configs::Migration),
            Box::new(m20260923_000001_create_ai_chat_sessions::Migration),
            Box::new(m20261006_000001_create_ai_chat_shares::Migration),
            Box::new(m20261007_000001_create_ai_chat_turns::Migration),
            Box::new(m20261007_000002_add_redact_tools_to_ai_chat_shares::Migration),
            Box::new(m20261013_000001_create_oncall_phone_verifications::Migration),
            Box::new(m20261013_000002_create_org_telephony::Migration),
            Box::new(m20261015_000001_reports_add_last_run_columns::Migration),
            Box::new(m20261016_000001_create_rum_pa_app_settings::Migration),
            Box::new(m20261020_000001_create_eval_job_states_tables::Migration),
            Box::new(m20261018_000001_create_slack_tables::Migration),
            Box::new(m20261016_000001_create_rca_runs::Migration),
            Box::new(m20261017_000001_add_rca_run_progress_columns::Migration),
            Box::new(m20261018_000001_create_rca_steering::Migration),
            Box::new(m20261021_000001_status_pages_add_favicon_img::Migration),
            Box::new(m20261005_000001_create_fleet::Migration),
            Box::new(m20261024_000001_add_lease_to_org_cleanup_tasks::Migration),
            Box::new(m20261021_000001_create_public_dashboards::Migration),
            Box::new(m20261021_000002_add_search_type_to_search_queue::Migration),
            Box::new(m20261026_000001_backfill_v1_rca_pointer::Migration),
            Box::new(m20261025_000001_add_firing_started_at_to_alert_states::Migration),
            Box::new(m20261025_000002_create_alert_acks::Migration),
            Box::new(m20261025_000003_add_mute_targets_to_downtimes::Migration),
            Box::new(m20261025_000004_create_slack_alert_messages::Migration),
            Box::new(m20261025_000005_add_held_action_to_slack_link_requests::Migration),
            Box::new(m20261028_000001_add_group_label_set_to_alert_states::Migration),
            Box::new(m20261029_000001_widen_alert_dedup_fingerprint::Migration),
            Box::new(m20261016_000001_add_first_event_at_to_ai_chat_turns::Migration),
            Box::new(m20261020_000001_add_health_to_org_ai_toolsets::Migration),
            Box::new(m20261020_000002_create_ai_grants::Migration),
            Box::new(m20261020_000003_create_ai_actions::Migration),
            Box::new(m20261020_000004_create_ai_access_requests::Migration),
            Box::new(m20261020_000005_create_ai_turn_marks::Migration),
            Box::new(m20261021_000001_add_history_to_ai_chat_sessions::Migration),
            Box::new(m20261021_000002_add_versions_to_ai_chat_turns::Migration),
            Box::new(m20261021_000003_add_hide_attachments_to_ai_chat_shares::Migration),
            Box::new(m20261021_000004_create_ai_chat_feedback::Migration),
            Box::new(m20261021_000005_create_ai_chat_imports::Migration),
            Box::new(m20261021_000006_create_paid_overage_attribution::Migration),
            Box::new(m20261021_000007_create_ai_approvals::Migration),
        ]
    }
}

pub fn get_text_type() -> &'static str {
    "text"
}

pub fn get_binary_type() -> &'static str {
    let db_type: MetaStore = config::get_config().common.meta_store.as_str().into();
    match db_type {
        MetaStore::Sqlite => "blob",
        _ => "bytea",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_text_type_returns_text() {
        assert_eq!(get_text_type(), "text");
    }

    /// Newest migration per `DB_SCHEMA_VERSION`: `init_db` skips upgrades on version match.
    const VERSION_COVERAGE: &[(u64, &str)] = &[
        (78, "m20260827_000001_drop_table_action_scripts"),
        (79, "m20260831_000001_add_exhausted_at_to_oncall_responses"),
        (
            80,
            "m20260911_000001_add_splunk_token_to_org_ingestion_tokens",
        ),
        (81, "m20260912_000002_add_anomaly_last_recovery_notified_at"),
        (
            82,
            "m20260915_000001_add_profiles_streams_to_service_streams",
        ),
        (83, "m20260910_000001_add_folder_id_to_workflows"),
        (84, "m20260916_000001_add_folder_id_to_workflow_drafts"),
        (85, "m20260917_000001_create_llm_experiment_slot_retries"),
        (86, "m20260917_000001_create_synthetics_shared_variables"),
        (
            87,
            "m20260921_000001_add_input_preview_to_llm_annotation_queue_items",
        ),
        (88, "m20260922_000003_create_user_auth_state_table"),
        (89, "m20260920_000001_add_anomaly_level_half_width"),
        (90, "m20260923_000001_create_llm_prompts"),
        (91, "m20260924_000001_add_recovery_episode_columns"),
        (92, "m20260928_000001_add_alert_recovery_destinations"),
        (93, "m20260918_000001_create_oncall_response_reports"),
        (94, "m20260908_000001_create_synthetics_refs"),
        (95, "m20261001_000001_add_anomaly_band_settings"),
        (96, "m20261003_000001_create_rum_pa_tables"),
        (97, "m20261004_000001_create_query_history"),
        (98, "m20261007_000001_scope_alert_dedup_state_by_org"),
        (99, "m20261008_000001_add_name_to_rum_pa_tombstones"),
        (100, "m20261009_000001_add_promql_rule_mode"),
        (101, "m20261009_000004_add_kind_to_slo_backfill_jobs"),
        (102, "m20261009_000005_create_downtime_notifications"),
        (103, "m20261012_000001_create_alert_calibration_configs"),
        (104, "m20260923_000001_create_ai_chat_sessions"),
        (105, "m20261006_000001_create_ai_chat_shares"),
        (106, "m20261007_000001_create_ai_chat_turns"),
        (107, "m20261007_000002_add_redact_tools_to_ai_chat_shares"),
        (108, "m20261013_000002_create_org_telephony"),
        (109, "m20261015_000001_reports_add_last_run_columns"),
        (110, "m20261016_000001_create_rum_pa_app_settings"),
        (111, "m20261020_000001_create_eval_job_states_tables"),
        (112, "m20261018_000001_create_slack_tables"),
        (113, "m20261016_000001_create_rca_runs"),
        (114, "m20261017_000001_add_rca_run_progress_columns"),
        (115, "m20261018_000001_create_rca_steering"),
        (116, "m20261021_000001_status_pages_add_favicon_img"),
        (117, "m20261005_000001_create_fleet"),
        (118, "m20261024_000001_add_lease_to_org_cleanup_tasks"),
        (119, "m20261021_000001_create_public_dashboards"),
        (120, "m20261021_000002_add_search_type_to_search_queue"),
        (121, "m20261026_000001_backfill_v1_rca_pointer"),
        (
            122,
            "m20261025_000001_add_firing_started_at_to_alert_states",
        ),
        (123, "m20261025_000002_create_alert_acks"),
        (124, "m20261025_000003_add_mute_targets_to_downtimes"),
        (125, "m20261025_000004_create_slack_alert_messages"),
        (
            126,
            "m20261025_000005_add_held_action_to_slack_link_requests",
        ),
        (127, "m20261028_000001_add_group_label_set_to_alert_states"),
        (128, "m20261029_000001_widen_alert_dedup_fingerprint"),
        (129, "m20261016_000001_add_first_event_at_to_ai_chat_turns"),
        (130, "m20261020_000005_create_ai_turn_marks"),
        (131, "m20261021_000005_create_ai_chat_imports"),
        (132, "m20261021_000006_create_paid_overage_attribution"),
        (133, "m20261021_000007_create_ai_approvals"),
    ];

    // Two branches that each claim the next version merge cleanly, so a reused number must fail
    // here.
    #[test]
    fn version_coverage_claims_each_version_once_up_to_db_schema_version() {
        let mut seen = std::collections::HashSet::new();
        for (version, name) in VERSION_COVERAGE {
            assert!(
                seen.insert(*version),
                "version {version} is claimed twice (again by `{name}`)"
            );
        }
        assert_eq!(
            VERSION_COVERAGE.iter().map(|(v, _)| *v).max(),
            Some(config::DB_SCHEMA_VERSION),
            "the highest VERSION_COVERAGE entry must equal DB_SCHEMA_VERSION"
        );
    }

    #[test]
    fn db_schema_version_covers_every_registered_migration() {
        let newest = Migrator::migrations()
            .into_iter()
            .map(|migration| migration.name().to_string())
            .max()
            .expect("at least one migration is registered");

        let (required, _) = VERSION_COVERAGE
            .iter()
            .find(|(_, name)| *name == newest)
            .unwrap_or_else(|| {
                panic!(
                    "migration `{newest}` is registered but no DB_SCHEMA_VERSION claims to cover \
                     it.\nYou added a migration: bump DB_SCHEMA_VERSION in \
                     src/config/src/config.rs to {}, then add ({}, \"{newest}\") to \
                     VERSION_COVERAGE here.\nWithout the bump `init_db` skips the upgrade on any \
                     database already stamped at the current version and the new column is never \
                     created.",
                    config::DB_SCHEMA_VERSION + 1,
                    config::DB_SCHEMA_VERSION + 1,
                )
            });

        assert!(
            config::DB_SCHEMA_VERSION >= *required,
            "DB_SCHEMA_VERSION is {} but migration `{newest}` requires at least {required}.\nBump \
             DB_SCHEMA_VERSION in src/config/src/config.rs to {required} so `init_db` actually \
             runs the upgrade on existing databases.",
            config::DB_SCHEMA_VERSION,
        );
    }

    #[test]
    fn each_migration_is_registered_once_and_after_the_schema_it_builds_on() {
        let names: Vec<String> = Migrator::migrations()
            .into_iter()
            .map(|migration| migration.name().to_string())
            .collect();
        let position = |name: &str| {
            let found: Vec<usize> = names
                .iter()
                .enumerate()
                .filter(|(_, n)| n.as_str() == name)
                .map(|(i, _)| i)
                .collect();
            assert_eq!(found.len(), 1, "{name} is registered {} times", found.len());
            found[0]
        };

        let unique: std::collections::HashSet<&String> = names.iter().collect();
        assert_eq!(unique.len(), names.len(), "a migration is registered twice");

        // Registration alone is what makes a migration run at all.
        position("m20260812_000001_create_composite_alerts");
        position("m20260923_000001_create_ai_chat_sessions");

        for (earlier, later) in [
            (
                "m20260707_000003_create_synthetics_jobs",
                "m20260917_000001_add_env_to_synthetics_jobs",
            ),
            (
                "m20260917_000001_create_synthetics_shared_variables",
                "m20260917_000001_add_env_to_synthetics_jobs",
            ),
            (
                "m20260812_000001_create_composite_alerts",
                "m20260825_000001_create_status_page_custom_domains",
            ),
            (
                "m20260921_000001_add_input_preview_to_llm_annotation_queue_items",
                "m20260922_000001_add_password_policy_columns_to_users",
            ),
            (
                "m20260725_000001_create_alert_states_tables",
                "m20260924_000001_add_recovery_episode_columns",
            ),
            (
                "m20260725_000001_create_alert_states_tables",
                "m20261028_000001_add_group_label_set_to_alert_states",
            ),
            (
                "m20250109_092400_recreate_tables_with_ksuids",
                "m20261009_000001_create_downtimes",
            ),
            (
                "m20251204_000001_create_alert_incidents_table",
                "m20261009_000002_add_muted_by_downtime_id_to_alert_incidents",
            ),
            (
                "m20260725_000001_create_alert_states_tables",
                "m20261009_000003_add_last_downtime_id_to_alert_states",
            ),
            (
                "m20260727_000001_create_slo_tables",
                "m20261009_000004_add_kind_to_slo_backfill_jobs",
            ),
            (
                "m20261007_000001_scope_alert_dedup_state_by_org",
                "m20261009_000001_create_downtimes",
            ),
            (
                "m20261007_000001_scope_alert_dedup_state_by_org",
                "m20261029_000001_widen_alert_dedup_fingerprint",
            ),
            (
                "m20261009_000001_create_downtimes",
                "m20261009_000005_create_downtime_notifications",
            ),
            (
                "m20260923_000001_create_ai_chat_sessions",
                "m20261006_000001_create_ai_chat_shares",
            ),
            (
                "m20261006_000001_create_ai_chat_shares",
                "m20261007_000002_add_redact_tools_to_ai_chat_shares",
            ),
            (
                "m20260923_000001_create_ai_chat_sessions",
                "m20261007_000001_create_ai_chat_turns",
            ),
            (
                "m20251204_000001_create_alert_incidents_table",
                "m20261016_000001_create_rca_runs",
            ),
            (
                "m20261016_000001_create_rca_runs",
                "m20261017_000001_add_rca_run_progress_columns",
            ),
            (
                "m20261016_000001_create_rca_runs",
                "m20261018_000001_create_rca_steering",
            ),
            (
                "m20260725_000001_create_alert_states_tables",
                "m20261025_000001_add_firing_started_at_to_alert_states",
            ),
            (
                "m20261009_000001_create_downtimes",
                "m20261025_000003_add_mute_targets_to_downtimes",
            ),
            (
                "m20261018_000001_create_slack_tables",
                "m20261025_000004_create_slack_alert_messages",
            ),
            (
                "m20261018_000001_create_slack_tables",
                "m20261025_000005_add_held_action_to_slack_link_requests",
            ),
            (
                "m20261007_000001_create_ai_chat_turns",
                "m20261016_000001_add_first_event_at_to_ai_chat_turns",
            ),
            (
                "m20260414_000002_create_org_ai_toolsets",
                "m20261020_000001_add_health_to_org_ai_toolsets",
            ),
            (
                "m20261007_000001_create_ai_chat_turns",
                "m20261021_000002_add_versions_to_ai_chat_turns",
            ),
            (
                "m20261007_000002_add_redact_tools_to_ai_chat_shares",
                "m20261021_000003_add_hide_attachments_to_ai_chat_shares",
            ),
            (
                "m20260923_000001_create_ai_chat_sessions",
                "m20261021_000001_add_history_to_ai_chat_sessions",
            ),
        ] {
            assert!(
                position(earlier) < position(later),
                "{later} must be registered after {earlier}"
            );
        }
    }

    const APP_SETTINGS_MIGRATION: &str = "m20261016_000001_create_rum_pa_app_settings";

    #[test]
    fn p1_r4_app_settings_migration_is_registered_after_alert_dedup_scope() {
        let names: Vec<String> = Migrator::migrations()
            .into_iter()
            .map(|migration| migration.name().to_string())
            .collect();
        let at = |name: &str| names.iter().position(|n| n == name);
        let settings =
            at(APP_SETTINGS_MIGRATION).expect("the app-settings migration is registered");
        let dedup = at("m20261007_000001_scope_alert_dedup_state_by_org").unwrap();
        assert!(dedup < settings);
    }

    #[test]
    fn p1_r5_schema_version_110_covers_the_app_settings_migration() {
        assert!(VERSION_COVERAGE.contains(&(110, APP_SETTINGS_MIGRATION)));
    }

    #[tokio::test]
    async fn p1_r4_the_rum_pa_test_helper_also_builds_app_settings() {
        let mut opts = sea_orm::ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = sea_orm::Database::connect(opts).await.unwrap();
        create_rum_pa_tables(&db).await.unwrap();
        create_rum_pa_tables(&db).await.unwrap();
        let manager = SchemaManager::new(&db);
        assert!(manager.has_table("rum_pa_app_settings").await.unwrap());
        assert!(
            manager
                .has_column("rum_pa_funnels", "rules_hash")
                .await
                .unwrap()
        );
    }
}
