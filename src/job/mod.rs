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

use config::{cluster::LOCAL_NODE, spawn_pausable_job};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_enterprise_config;
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
use regex::Regex;

use crate::{
    common::meta::{
        organization::DEFAULT_ORG,
        user::{UserOrgRole, UserRequest},
    },
    service::{db, self_reporting, users},
};

#[cfg(feature = "enterprise")]
pub mod alert_grouping;
mod alert_manager;
#[cfg(feature = "enterprise")]
mod cipher;
#[cfg(feature = "cloud")]
mod cloud;
mod compactor;
pub mod config_watcher;
mod file_downloader;
mod file_list_dump;
pub(crate) mod files;
mod flatten_compactor;
#[cfg(feature = "enterprise")]
mod incidents;
pub mod metrics;
mod mmdb_downloader;
#[cfg(feature = "enterprise")]
pub(crate) mod pipeline;
mod pipeline_error_cleanup;
mod promql;
mod promql_self_consume;
#[cfg(feature = "enterprise")]
mod service_graph;
mod session_cleanup;
mod stats;

pub use file_downloader::{download_from_node, queue_download};
pub use mmdb_downloader::MMDB_INIT_NOTIFIER;

#[cfg(feature = "enterprise")]
async fn enforce_usage_stream_retention() {
    use config::{
        META_ORG_ID,
        meta::{self_reporting::usage::USAGE_STREAM, stream::StreamType},
    };
    if let Some(mut s) =
        infra::schema::get_settings(META_ORG_ID, USAGE_STREAM, StreamType::Logs).await
        && s.data_retention < 32
    {
        s.data_retention = 32;
        crate::service::stream::save_stream_settings(
            META_ORG_ID,
            USAGE_STREAM,
            StreamType::Logs,
            s,
        )
        .await
        .unwrap(); //unwrap is intentional, we should panic if this fails
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    let email_regex = Regex::new(
        r"^([a-z0-9_+]([a-z0-9_+.-]*[a-z0-9_+])?)@([a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6})",
    )
    .expect("Email regex is valid");

    let cfg = config::get_config();
    // init root user
    if !db::user::root_user_exists().await {
        if cfg.auth.root_user_email.is_empty()
            || !email_regex.is_match(&cfg.auth.root_user_email)
            || cfg.auth.root_user_password.is_empty()
        {
            panic!(
                "Please set root user email-id & password using ZO_ROOT_USER_EMAIL & ZO_ROOT_USER_PASSWORD environment variables. This can also indicate an invalid email ID. Email ID must comply with ([a-z0-9_+]([a-z0-9_+.-]*[a-z0-9_+])?)@([a-z0-9]+([\\-\\.]{{1}}[a-z0-9]+)*\\.[a-z]{{2,6}})"
            );
        }
        let _ = crate::service::organization::check_and_create_org_without_ofga(DEFAULT_ORG).await;
        if let Err(e) = users::create_root_user(
            DEFAULT_ORG,
            UserRequest {
                email: cfg.auth.root_user_email.clone(),
                password: cfg.auth.root_user_password.clone(),
                role: UserOrgRole {
                    base_role: config::meta::user::UserRole::Root,
                    custom_role: None,
                },
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
                token: if cfg.auth.root_user_token.is_empty() {
                    None
                } else {
                    Some(cfg.auth.root_user_token.clone())
                },
            },
        )
        .await
        {
            panic!("Failed to create root user: {e}");
        }
    }

    if !cfg.common.mmdb_disable_download
        && (LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager())
    {
        // Try to download the mmdb files, if its not disabled.
        tokio::task::spawn(mmdb_downloader::run());
    }

    // Initialize URL job processor for enrichment tables on ingesters
    // This ensures the stale job recovery task starts even if this ingester
    // never receives a URL enrichment event. Critical for distributed deployments.
    if LOCAL_NODE.is_ingester() {
        crate::service::enrichment_table::init_url_processor();
    }

    db::user::cache().await.expect("user cache failed");
    db::organization::cache()
        .await
        .expect("organizations cache failed");
    db::org_users::cache().await.expect("org user cache failed");

    db::organization::org_settings_cache()
        .await
        .expect("organization settings cache sync failed");

    // watch org users
    tokio::task::spawn(db::user::watch());
    tokio::task::spawn(db::org_users::watch());
    tokio::task::spawn(db::organization::watch());

    #[cfg(feature = "cloud")]
    tokio::task::spawn(o2_enterprise::enterprise::cloud::billings::watch());

    // check version
    db::metas::version::set()
        .await
        .expect("db version set failed");

    // check tantivy _timestamp update time
    _ = db::metas::tantivy_index::get_ttv_timestamp_updated_at().await;
    // check tantivy secondary index update time
    _ = db::metas::tantivy_index::get_ttv_secondary_index_updated_at().await;

    // Auth auditing should be done by router also
    #[cfg(feature = "enterprise")]
    if self_reporting::run_audit_publish().is_none() {
        log::error!("Failed to run audit publish");
    };
    #[cfg(feature = "cloud")]
    tokio::task::spawn(self_reporting::cloud_events::flush_cloud_events());

    #[cfg(feature = "enterprise")]
    {
        tokio::task::spawn(db::ofga::watch());
        db::ofga::cache().await.expect("ofga model cache failed");
        o2_openfga::authorizer::authz::init_open_fga().await;
        // RBAC model
        if get_openfga_config().enabled
            && let Err(e) = crate::common::infra::ofga::init().await
        {
            log::error!("OFGA init failed: {e}");
        }
    }

    tokio::task::spawn(promql_self_consume::run());

    #[cfg(feature = "enterprise")]
    {
        tokio::task::spawn(async move {
            loop {
                enforce_usage_stream_retention().await;
                tokio::time::sleep(tokio::time::Duration::from_secs(10 * 60)).await;
            }
        });
    }

    // Router doesn't need to initialize job
    if LOCAL_NODE.is_router() && LOCAL_NODE.is_single_role() {
        return Ok(());
    }

    // telemetry run
    if cfg.common.telemetry_enabled && LOCAL_NODE.is_querier() {
        spawn_pausable_job!(
            "telemetry",
            config::get_config().common.telemetry_heartbeat,
            {
                crate::common::meta::telemetry::Telemetry::new()
                    .heart_beat("OpenObserve - heartbeat", None)
                    .await;
            }
        );
    }

    tokio::task::spawn(self_reporting::run());

    // cache short_urls
    tokio::task::spawn(db::short_url::watch());
    db::short_url::cache()
        .await
        .expect("short url cache failed");

    // initialize metadata watcher
    tokio::task::spawn(db::schema::watch());
    tokio::task::spawn(db::functions::watch());
    tokio::task::spawn(db::compact::retention::watch());
    tokio::task::spawn(db::metrics::watch_prom_cluster_leader());
    tokio::task::spawn(db::system_settings::watch());
    tokio::task::spawn(db::alerts::templates::watch());
    tokio::task::spawn(db::alerts::destinations::watch());
    tokio::task::spawn(db::alerts::realtime_triggers::watch());
    tokio::task::spawn(db::alerts::alert::watch());
    tokio::task::spawn(db::organization::org_settings_watch());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(o2_enterprise::enterprise::domain_management::db::watch());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(db::ai_prompts::watch());
    // Service streams watch only needed on queriers - they serve the UI APIs
    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_querier() {
        tokio::task::spawn(async move {
            o2_enterprise::enterprise::service_streams::cache::watch().await
        });
    }

    // pipeline not used on compactors
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager() {
        tokio::task::spawn(db::pipeline::watch());
    }

    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() {
        tokio::task::spawn(db::session::watch());
    }
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager() {
        tokio::task::spawn(db::enrichment_table::watch());
    }

    tokio::task::yield_now().await;

    // cache core metadata
    db::schema::cache().await.expect("stream cache failed");
    db::functions::cache()
        .await
        .expect("functions cache failed");
    db::compact::retention::cache()
        .await
        .expect("compact delete cache failed");
    db::metrics::cache_prom_cluster_leader()
        .await
        .expect("prom cluster leader cache failed");

    // cache system settings (FQN priority, etc.)
    db::system_settings::cache()
        .await
        .expect("system settings cache failed");

    // cache alerts
    db::alerts::templates::cache()
        .await
        .expect("alerts templates cache failed");
    db::alerts::destinations::cache()
        .await
        .expect("alerts destinations cache failed");
    db::alerts::realtime_triggers::cache()
        .await
        .expect("alerts realtime triggers cache failed");
    db::alerts::alert::cache()
        .await
        .expect("alerts cache failed");
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::domain_management::db::cache()
        .await
        .expect("domain management cache failed");
    #[cfg(feature = "enterprise")]
    db::ai_prompts::cache()
        .await
        .expect("ai prompts cache failed");
    // Service streams cache only needed on queriers - they serve the UI APIs
    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_querier() {
        o2_enterprise::enterprise::service_streams::cache::init_cache()
            .await
            .expect("service discovery cache failed");
    }

    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager() {
        db::session::cache()
            .await
            .expect("user session cache failed");
    }

    // check wal directory
    if LOCAL_NODE.is_ingester() {
        // create wal dir
        if let Err(e) = std::fs::create_dir_all(&cfg.common.data_wal_dir) {
            log::error!("Failed to create wal dir: {e}");
        }
    }

    config_watcher::run();
    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_querier() && get_enterprise_config().ai.enabled {
        tokio::task::spawn(async move {
            o2_enterprise::enterprise::ai::agent::prompt::prompts::load_system_prompt()
                .await
                .expect("load system prompt failed");
        });
    }
    tokio::task::spawn(files::run());
    tokio::task::spawn(stats::run());
    tokio::task::spawn(compactor::run());
    tokio::task::spawn(flatten_compactor::run());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(service_graph::run());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(incidents::run());
    tokio::task::spawn(metrics::run());
    let _ = promql::run();
    tokio::task::spawn(alert_manager::run());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(alert_grouping::process_expired_batches());
    tokio::task::spawn(file_downloader::run());
    // Note: Service discovery extraction runs automatically during parquet file processing
    // See src/job/files/parquet.rs:queue_services_from_parquet for implementation
    #[cfg(feature = "enterprise")]
    spawn_pausable_job!(
        "service_streams_batch_processor",
        get_enterprise_config().service_streams.batch_flush_interval_seconds,
        {
            o2_enterprise::enterprise::service_streams::batch_processor::run_once().await;
        },
        pause_if: !get_enterprise_config().service_streams.enabled
    );
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(pipeline::run());
    pipeline_error_cleanup::run();
    session_cleanup::run();

    if LOCAL_NODE.is_compactor() {
        tokio::task::spawn(file_list_dump::run());
    }

    // load metrics disk cache
    tokio::task::spawn(crate::service::promql::search::init());
    // start pipeline data retention
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(o2_enterprise::enterprise::pipeline::pipeline_job::run());

    #[cfg(feature = "enterprise")]
    {
        tokio::task::spawn(cipher::run());
        tokio::task::spawn(db::keys::watch());
        tokio::task::spawn(db::re_pattern::watch_patterns());
        tokio::task::spawn(db::re_pattern::watch_pattern_associations());
        // we do this call here so the pattern manager gets init-ed at the very start instead at
        // first use helpful for stream settings case, where if not already init-ed, it
        // returns empty array for associations because it is a sync fn and cannot init
        // manager itself
        tokio::task::spawn(async move {
            o2_enterprise::enterprise::re_patterns::get_pattern_manager().await
        });
    }

    // additional for cloud
    #[cfg(feature = "cloud")]
    {
        // OpenFGA migration
        o2_enterprise::enterprise::cloud::ofga_migrate()
            .await
            .expect("cloud ofga migrations failed");

        use crate::service::self_reporting::{ingest_data_retention_usages, search::get_usage};
        o2_enterprise::enterprise::metering::init(get_usage, ingest_data_retention_usages)
            .await
            .expect("cloud usage metering job init failed");

        // run these cloud jobs only in alert manager
        if LOCAL_NODE.is_alert_manager() {
            cloud::start();
        }
    }

    // Shouldn't serve request until initialization finishes
    log::info!("Job initialization complete");

    Ok(())
}

/// Additional jobs that init processes should be deferred until the gRPC service
/// starts in the main thread
pub async fn init_deferred() -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::license::start_license_check(
            crate::service::self_reporting::search::get_usage,
            LOCAL_NODE.is_router() && LOCAL_NODE.is_single_role(),
        )
        .await;
        tokio::task::spawn(db::license::watch());
    }

    if !LOCAL_NODE.is_ingester() && !LOCAL_NODE.is_querier() && !LOCAL_NODE.is_alert_manager() {
        return Ok(());
    }

    // Clean up old JSON format enrichment tables before caching (one-time check at startup)
    config::utils::enrichment_local_cache::cleanup_old_json_format()
        .await
        .expect("Failed to clean up old JSON format enrichment tables");

    db::schema::cache_enrichment_tables()
        .await
        .expect("EnrichmentTables cache failed");
    // pipelines can potentially depend on enrichment tables, so cached afterwards
    db::pipeline::cache().await.expect("Pipeline cache failed");

    Ok(())
}
