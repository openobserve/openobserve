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
mod m20260119_000001_add_stat_interval_to_ratelimit;

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
            Box::new(m20260119_000001_add_stat_interval_to_ratelimit::Migration),
        ]
    }
}

pub fn get_text_type() -> &'static str {
    let db_type = config::get_config().common.meta_store.as_str().into();
    match db_type {
        MetaStore::MySQL => "longtext",
        _ => "text",
    }
}

pub fn get_binary_type() -> &'static str {
    let db_type = config::get_config().common.meta_store.as_str().into();
    match db_type {
        MetaStore::MySQL => "longblob",
        MetaStore::Sqlite => "blob",
        _ => "bytea",
    }
}
