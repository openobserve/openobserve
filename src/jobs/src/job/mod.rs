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

use config::{DEFAULT_ORG, cluster::LOCAL_NODE, spawn_pausable_job};
use db;
#[cfg(feature = "cloud")]
use openobserve_core::self_reporting;
use openobserve_core::{alerts, users};
use regex::Regex;
#[cfg(feature = "enterprise")]
use {
    o2_enterprise::enterprise::{common::config::get_config as get_o2_config, search::admission},
    o2_openfga::config::get_config as get_openfga_config,
};

use crate::common::meta::user::{UserOrgRole, UserRequest};

#[cfg(feature = "enterprise")]
fn eval_scheduler_fetch_size(total: usize, max_rows: usize) -> anyhow::Result<i64> {
    if total > max_rows {
        return Err(anyhow::anyhow!(
            "online eval scheduler interval has {total} rows, exceeding the safe limit of {max_rows}"
        ));
    }
    let fetch_size = total
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("online eval scheduler result count exceeds search size"))?;
    i64::try_from(fetch_size)
        .map_err(|_| anyhow::anyhow!("online eval scheduler result count exceeds search size"))
}

#[cfg(feature = "enterprise")]
pub mod alert_grouping;
mod alert_manager;
#[cfg(feature = "cloud")]
mod cloud;
mod compactor;
pub mod config_watcher;
mod file_list_dump;
pub(crate) mod files;
mod flatten_compactor;
#[cfg(feature = "enterprise")]
mod incidents;
pub mod metrics;
mod mmdb_downloader;
#[cfg(feature = "enterprise")]
mod org_storage;
#[cfg(feature = "enterprise")]
pub(crate) mod pipeline;
mod pipeline_error_cleanup;
mod promql;
mod promql_self_consume;
#[cfg(feature = "enterprise")]
mod service_graph;
mod session_cleanup;
mod stats;

use enrichment_data::enrichment_table::geoip::wait_for_initialization;
use openobserve_core::org_cleanup::StreamDataCleanup;

struct CompactionStreamDataCleanup;

#[async_trait::async_trait]
impl StreamDataCleanup for CompactionStreamDataCleanup {
    async fn delete_stream_data(
        &self,
        org_id: &str,
        stream_type: config::meta::stream::StreamType,
        stream_name: &str,
    ) -> Result<(), anyhow::Error> {
        compaction::retention::delete_all(org_id, stream_type, stream_name).await
    }
}

#[cfg(feature = "enterprise")]
async fn patch_sre_readonly_alerts_incidents() {
    use bytes::Bytes;

    const MIGRATION_ORG: &str = "_migration";
    const FLAG_KEY: &str = "sre_readonly_afolder_incidents_v2";

    if openobserve_core::kv::get(MIGRATION_ORG, FLAG_KEY)
        .await
        .is_ok()
    {
        return;
    }

    let is_leader = infra::cluster::get_cached_online_nodes()
        .await
        .and_then(|mut nodes| {
            nodes.sort_by_key(|n| n.id);
            nodes.into_iter().next()
        })
        .map(|first| first.id == LOCAL_NODE.id)
        .unwrap_or(true);

    if !is_leader {
        log::debug!("patch_sre_readonly_alerts_incidents: not the lowest-id node, skipping");
        return;
    }

    let orgs = match db::organization::list(None).await {
        Ok(orgs) => orgs,
        Err(e) => {
            log::error!("Failed to list orgs for sre-readonly alerts/incidents patch: {e}");
            return;
        }
    };

    let mut failed = false;
    for org in orgs {
        if let Err(e) =
            o2_openfga::authorizer::roles::patch_sre_readonly_role_alerts_incidents(&org.identifier)
                .await
        {
            log::warn!(
                "Failed to patch sre-readonly alerts/incidents for org '{}': {e}",
                org.identifier
            );
            failed = true;
        }
    }

    if failed {
        log::warn!("sre-readonly alerts/incidents patch had failures — will retry on next startup");
        return;
    }

    if let Err(e) =
        openobserve_core::kv::set(MIGRATION_ORG, FLAG_KEY, Bytes::from_static(b"done")).await
    {
        log::error!("Failed to set sre_readonly_afolder_incidents migration flag: {e}");
    } else {
        log::info!("sre-readonly alerts/incidents patch complete");
    }
}

#[cfg(feature = "enterprise")]
async fn backfill_sys_rca_agent_openfga_tuples() {
    use bytes::Bytes;

    // Use a dedicated system org for migration flags, separate from user orgs.
    const MIGRATION_ORG: &str = "_migration";
    const FLAG_KEY: &str = "sys_rca_agent_openfga_migration_v1";

    // Check if already done via KV flag
    if openobserve_core::kv::get(MIGRATION_ORG, FLAG_KEY)
        .await
        .is_ok()
    {
        return; // Already done
    }

    // Get all orgs and ensure SA exists (idempotent — creates OpenFGA tuples for existing DB rows)
    match db::organization::list(None).await {
        Ok(orgs) => {
            for org in orgs {
                if let Err(e) =
                    openobserve_core::organization::ensure_sys_rca_agent(&org.identifier).await
                {
                    log::warn!(
                        "Failed to backfill SysRcaAgent OpenFGA tuples for org '{}': {e}",
                        org.identifier
                    );
                }
            }
            // Set flag so we don't run again
            if let Err(e) =
                openobserve_core::kv::set(MIGRATION_ORG, FLAG_KEY, Bytes::from_static(b"done"))
                    .await
            {
                log::error!("Failed to set OpenFGA backfill flag: {e}");
            } else {
                log::info!("SysRcaAgent OpenFGA tuple backfill complete");
            }
        }
        Err(e) => {
            log::error!("Failed to list orgs for OpenFGA backfill: {e}");
        }
    }
}

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
        stream::save_stream_settings(META_ORG_ID, USAGE_STREAM, StreamType::Logs, s)
            .await
            .unwrap(); //unwrap is intentional, we should panic if this fails
    }
}

#[cfg(feature = "cloud")]
async fn get_metering_lock() -> Result<Option<()>, infra::errors::Error> {
    if !LOCAL_NODE.is_alert_manager() {
        return Ok(None);
    }
    use infra::{cluster::get_node_by_uuid, dist_lock};

    let db = infra::db::get_db().await;
    let node = db
        .get("/cloud/metering/node")
        .await
        .ok()
        .unwrap_or_default();
    let node = String::from_utf8_lossy(&node);
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        log::info!("[o2::ENT] metering is locked by node {node}");
        return Ok(None); // other node is processing
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let locker = infra::dist_lock::lock("/cloud/metering/node", 0).await?;
        // check the working node again, maybe other node locked it first
        let node = db
            .get("/cloud/metering/node")
            .await
            .ok()
            .unwrap_or_default();
        let node = String::from_utf8_lossy(&node);
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(None); // other node is processing
        }
        // set to current node
        let ret = db
            .put(
                "/cloud/metering/node",
                LOCAL_NODE.uuid.clone().into(),
                infra::db::NO_NEED_WATCH,
                None,
            )
            .await;
        // Check db.put result before releasing the lock to ensure consistent state
        if let Err(e) = ret {
            dist_lock::unlock(&locker).await?;
            drop(locker);
            return Err(e);
        }
        dist_lock::unlock(&locker).await?;
        log::info!("[o2::ENT] Metering lock acquired");
        drop(locker);
    }

    Ok(Some(()))
}

// TODO: in a separate PR, replace the metering lock fn with this one instead
#[cfg(feature = "enterprise")]
pub async fn get_nats_lock(key: String) -> Result<String, anyhow::Error> {
    use infra::{cluster::get_node_by_uuid, dist_lock};

    let db = infra::db::get_db().await;
    let node = db.get(&key).await.ok().unwrap_or_default();
    let node = String::from_utf8_lossy(&node);
    if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some() {
        return Ok(node.to_string());
    }

    if node.is_empty() || LOCAL_NODE.uuid.ne(&node) {
        let locker = infra::dist_lock::lock(&key, 0).await?;
        // check the working node again, maybe other node locked it first
        let node = db.get(&key).await.ok().unwrap_or_default();
        let node = String::from_utf8_lossy(&node);
        if !node.is_empty() && LOCAL_NODE.uuid.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            dist_lock::unlock(&locker).await?;
            return Ok(node.to_string());
        }
        // set to current node
        let ret = db
            .put(
                &key,
                LOCAL_NODE.uuid.clone().into(),
                infra::db::NO_NEED_WATCH,
                None,
            )
            .await;
        // Check db.put result before releasing the lock to ensure consistent state
        if let Err(e) = ret {
            dist_lock::unlock(&locker).await?;
            drop(locker);
            return Err(e.into());
        }
        dist_lock::unlock(&locker).await?;
        drop(locker);
    }

    Ok(LOCAL_NODE.uuid.clone())
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
        if let Err(msg) =
            config::utils::password::validate_password_strength(&cfg.auth.root_user_password)
        {
            panic!("ZO_ROOT_USER_PASSWORD is too weak: {msg}");
        }
        let _ =
            openobserve_core::organization::check_and_create_org_without_ofga(DEFAULT_ORG).await;
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
        enrichment_data::enrichment_table::init_url_processor();
    }

    db::user::cache().await.expect("user cache failed");
    db::organization::cache()
        .await
        .expect("organizations cache failed");
    db::org_users::cache().await.expect("org user cache failed");
    db::org_ingestion_tokens::cache()
        .await
        .expect("org ingestion tokens cache failed");

    db::organization::org_settings_cache()
        .await
        .expect("organization settings cache sync failed");

    // watch org users
    tokio::task::spawn(db::user::watch());
    tokio::task::spawn(db::org_users::watch());
    tokio::task::spawn(db::org_ingestion_tokens::watch());
    tokio::task::spawn(db::organization::watch());
    tokio::task::spawn(db::org_status::watch());
    if let Err(e) = db::org_status::load_from_db().await {
        log::error!("Failed to load org status cache: {e}");
    }

    #[cfg(feature = "cloud")]
    tokio::task::spawn(o2_enterprise::enterprise::cloud::billings::watch());

    // check version
    db::metas::version::set()
        .await
        .expect("db version set failed");

    // check tantivy _timestamp update time
    _ = infra::db::tantivy_index::get_ttv_timestamp_updated_at().await;
    // check tantivy secondary index update time
    _ = infra::db::tantivy_index::get_ttv_secondary_index_updated_at().await;

    // Auth auditing should be done by router also
    #[cfg(feature = "enterprise")]
    if audit::run_publish_job().is_none() {
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
            && let Err(e) = openobserve_core::ofga::init().await
        {
            log::error!("OFGA init failed: {e}");
        }
        // One-time OpenFGA migrations — dist_lock ensures only one node runs each
        // migration even in multi-node deployments. KV flag prevents re-runs.
        backfill_sys_rca_agent_openfga_tuples().await;
        patch_sre_readonly_alerts_incidents().await;
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

    // All nodes need org settings watch for consistent cache
    tokio::task::spawn(db::organization::org_settings_watch());

    // Domain management (allow-list + blocklist) is enforced in the auth path —
    // `validate_credentials`, `validate_credentials_ext`, `token_validator` and `process_token`
    // — which runs on ALL node roles, including single-role routers. Initialize and watch its
    // cache BEFORE the router early-return below so a router keeps the blocklist fresh;
    // otherwise its cache would go stale and a newly-blocked user could keep
    // authenticating/ingesting through that router.
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::domain_management::db::cache()
            .await
            .expect("domain management cache failed");
        tokio::task::spawn(o2_enterprise::enterprise::domain_management::db::watch());
    }

    // Routers serve AI usage and organization-management requests, so their
    // quota cache must be populated and kept in sync even though they skip the
    // remaining background jobs below.
    #[cfg(feature = "cloud")]
    {
        openobserve_core::trial_quota::init_from_db().await;
        cloud::start_trial_quota_jobs();
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
                common::meta::telemetry::Telemetry::new()
                    .heart_beat("OpenObserve - heartbeat", None)
                    .await;
            }
        );
    }

    tokio::task::spawn(usage_reporting::run());

    // cache short_urls
    tokio::task::spawn(db::short_url::watch());
    db::short_url::cache()
        .await
        .expect("short url cache failed");

    // initialize metadata watcher
    tokio::task::spawn(openobserve_core::schema_watcher::watch());
    tokio::task::spawn(db::functions::watch());
    tokio::task::spawn(db::compact::retention::watch());
    tokio::task::spawn(db::metrics::watch_prom_cluster_leader());
    tokio::task::spawn(db::system_settings::watch());
    tokio::task::spawn(db::model_pricing::watch());
    tokio::task::spawn(db::alerts::templates::watch());
    tokio::task::spawn(db::alerts::destinations::watch());
    tokio::task::spawn(db::alerts::realtime_triggers::watch());
    tokio::task::spawn(db::alerts::alert::watch());
    // org_settings_watch already started above for all nodes including routers
    // Watch needed on queriers (UI APIs) and on whichever node role is the configured
    // processing node (ingester or compactor) so their local cache stays in sync with
    // coordinator events emitted by the flusher.
    #[cfg(feature = "enterprise")]
    if get_o2_config().service_streams.enabled
        && get_o2_config().service_streams.local_node_needs_cache()
    {
        tokio::task::spawn(async move {
            o2_enterprise::enterprise::service_streams::cache::watch().await
        });
    }

    // pipeline not used on compactors
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager() {
        tokio::task::spawn(openobserve_core::pipeline::db::watch());
    } else {
        // On nodes that do not run the heavy pipeline watch (e.g. routers), still maintain
        // PIPELINE_ID_TO_ORG so HTTP handlers can perform cross-org IDOR checks in O(1).
        tokio::task::spawn(openobserve_core::pipeline::db::watch_id_to_org());
    }

    // Dashboard id->org cache: maintained on every node type so HTTP handlers (e.g.
    // timed annotations) can perform cross-org IDOR checks in O(1).
    tokio::task::spawn(db::dashboards::watch_id_to_org());

    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() {
        tokio::task::spawn(db::session::watch());
    }
    if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager() {
        tokio::task::spawn(enrichment_data::enrichment_table::runtime::watch());
    }

    tokio::task::yield_now().await;

    // cache core metadata
    db::schema::cache().await.expect("stream cache failed");
    openobserve_core::functions_cache::cache()
        .await
        .expect("functions cache failed");
    db::compact::retention::cache()
        .await
        .expect("compact delete cache failed");
    db::metrics::cache_prom_cluster_leader()
        .await
        .expect("prom cluster leader cache failed");

    db::system_settings::cache()
        .await
        .expect("system settings cache failed");

    if config::get_config().common.model_pricing_enabled {
        db::model_pricing::cache()
            .await
            .expect("model pricing cache failed");

        // Sync built-in model pricing from GitHub (initial + periodic)
        if LOCAL_NODE.is_querier() {
            tokio::task::spawn(async {
                if let Err(e) =
                    openobserve_builtins::model_pricing::sync_built_in_from_github(false).await
                {
                    log::error!("[model_pricing] initial built-in sync failed: {e}");
                }
            });
            tokio::task::spawn(async {
                let interval = std::time::Duration::from_secs(
                    config::get_config().common.model_pricing_sync_interval_secs,
                );
                loop {
                    tokio::time::sleep(interval).await;
                    if let Err(e) =
                        openobserve_builtins::model_pricing::sync_built_in_from_github(false).await
                    {
                        log::error!("[model_pricing] periodic built-in sync failed: {e}");
                    }
                }
            });
        }
    }

    // ensure system templates exist in database BEFORE caching
    alerts::templates::ensure_system_templates()
        .await
        .expect("system templates initialization failed");

    // cache alerts (this will include the system templates we just created)
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
    // Warm the cache on queriers (UI APIs) and on whichever node role is the configured
    // processing node so that get_coverage_deficit returns accurate data from startup
    // rather than always returning (0, 0) until files happen to be processed.
    #[cfg(feature = "enterprise")]
    if get_o2_config().service_streams.enabled
        && get_o2_config().service_streams.local_node_needs_cache()
    {
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

    // Initialize slot-based admission ledger on querier nodes
    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_querier() && get_o2_config().work_group.max_nodes_per_query > 0 {
        admission::init_slot_ledger(cfg.limit.real_cpu_num as f64, cfg.limit.mem_total as f64);
        // Run the TTL sweep at ≤ 1/4 of the reservation TTL so that expired
        // reservations are reaped promptly without spinning.
        let sweep_ms = (get_o2_config().work_group.slot_reserved_ttl_ms / 4).max(100);
        admission::ledger::spawn_ttl_cleanup_task(sweep_ms);
    }

    tokio::task::spawn(files::run());
    tokio::task::spawn(stats::run());
    tokio::task::spawn(compactor::run());
    tokio::task::spawn(flatten_compactor::run());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(service_graph::run());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(incidents::run());
    // Register enterprise callbacks before durable consumers and scheduler startup.
    // HTTP/background work can land on querier, ingester, or alert_manager nodes,
    // so callbacks must be available everywhere before consumers start.
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::register_score_writer(
            |org_id, records| {
                Box::pin(async move {
                    if records.is_empty() {
                        return Ok(());
                    }

                    openobserve_core::self_reporting::llm_scores_schema::ensure_llm_scores_stream_initialized(&org_id)
                        .await
                        .map_err(|e| anyhow::anyhow!(e))?;

                    let req = proto::cluster_rpc::IngestionRequest {
                        org_id: org_id.clone(),
                        stream_name: config::meta::self_reporting::llm_scores::LLM_SCORES_STREAM
                            .to_string(),
                        stream_type: config::meta::stream::StreamType::Logs.to_string(),
                        data: Some(proto::cluster_rpc::IngestionData::from(records)),
                        ingestion_type: Some(proto::cluster_rpc::IngestionType::Json.into()),
                        metadata: None,
                    };

                    match openobserve_core::ingestion::ingestion_service::ingest(req).await {
                        Ok(resp) if resp.status_code == 200 => Ok(()),
                        Ok(resp) => Err(anyhow::anyhow!(
                            "_llm_scores ingestion failed with status {}: {}",
                            resp.status_code,
                            resp.message
                        )),
                        Err(e) => Err(anyhow::anyhow!(e)),
                    }
                })
            },
        );

        o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::register_evaluator_trace_exporter(
            |org_id, traces, node_idx| {
                Box::pin(async move {
                    if let Err(e) = openobserve_core::self_reporting::evaluator_schema::ensure_evaluator_stream_initialized(&org_id).await {
                        log::warn!(
                            "[Pipeline]: LLM evaluation node {node_idx} failed to ensure _evaluator stream initialized for {org_id}: {e}"
                        );
                    }
                    openobserve_core::llm_evaluations::evaluator_trace_exporter::EvaluatorTraceExporter::export(
                        &org_id,
                        traces,
                        node_idx,
                    )
                    .await;
                })
            },
        );

        o2_enterprise::enterprise::llm_evaluations::eval_jobs::scheduler::register_search_executor(
            |org_id, stream_type, sql, start_time, end_time| {
                Box::pin(async move {
                    let count_req = config::meta::search::Request {
                        query: config::meta::search::Query {
                            sql: sql.clone(),
                            start_time,
                            end_time,
                            size: 1,
                            track_total_hits: true,
                            ..Default::default()
                        },
                        use_cache: false,
                        ..Default::default()
                    };
                    let stream_type = config::meta::stream::StreamType::from(stream_type.as_str());
                    let count_response =
                        search_service::search("", &org_id, stream_type, None, &count_req)
                            .await
                            .map_err(|e| anyhow::anyhow!(e))?;
                    if count_response.is_partial || !count_response.function_error.is_empty() {
                        return Ok(o2_enterprise::enterprise::llm_evaluations::eval_jobs::scheduler::SchedulerSearchResult {
                            total: count_response.total,
                            is_partial: count_response.is_partial,
                            function_error: count_response.function_error,
                            hits: Vec::new(),
                        });
                    }

                    let total = count_response.total;
                    if total == 0 {
                        return Ok(Default::default());
                    }
                    let max_rows = o2_enterprise::enterprise::common::config::get_config()
                        .llm_eval_config
                        .max_buffer_size
                        .saturating_mul(10)
                        .max(10_001);
                    let size = eval_scheduler_fetch_size(total, max_rows)?;
                    let data_req = config::meta::search::Request {
                        query: config::meta::search::Query {
                            sql,
                            start_time,
                            end_time,
                            size,
                            track_total_hits: false,
                            ..Default::default()
                        },
                        use_cache: false,
                        ..Default::default()
                    };
                    search_service::search("", &org_id, stream_type, None, &data_req)
                        .await
                        .map(|response| {
                            o2_enterprise::enterprise::llm_evaluations::eval_jobs::scheduler::SchedulerSearchResult {
                                hits: response.hits,
                                total,
                                is_partial: response.is_partial,
                                function_error: response.function_error,
                            }
                        })
                        .map_err(|e| anyhow::anyhow!(e))
                })
            },
        );

        o2_enterprise::enterprise::llm_evaluations::eval_jobs::search::register_executor(
            |request| {
                Box::pin(async move {
                    let stream_type =
                        config::meta::stream::StreamType::from(request.stream_type.as_str());
                    let req = config::meta::search::Request {
                        query: config::meta::search::Query {
                            sql: request.sql,
                            start_time: request.start_time,
                            end_time: request.end_time,
                            from: request.from as i64,
                            size: request.size as i64,
                            track_total_hits: request.track_total_hits,
                            ..Default::default()
                        },
                        use_cache: false,
                        ..Default::default()
                    };
                    search_service::search(
                        "",
                        &request.org_id,
                        stream_type,
                        None,
                        &req,
                    )
                    .await
                    .map(|response| {
                        o2_enterprise::enterprise::llm_evaluations::eval_jobs::search::EvalSearchResponse {
                            hits: response.hits,
                            total: response.total,
                            is_partial: response.is_partial,
                            function_error: response.function_error,
                        }
                    })
                    .map_err(|error| anyhow::anyhow!(error))
                })
            },
        );

        o2_enterprise::enterprise::llm_evaluations::eval_jobs::async_executor::start_eval_task_consumers();
        o2_enterprise::enterprise::llm_evaluations::eval_jobs::scheduler::start_eval_scheduler();

        o2_enterprise::enterprise::anomaly_detection::query_executor::register_query_executor(
            |org_id, sql, start, end, cfg_id, stream_type| {
                Box::pin(async move {
                    openobserve_core::anomaly_detection::execute_anomaly_query(
                        &org_id,
                        &sql,
                        start,
                        end,
                        &cfg_id,
                        &stream_type,
                    )
                    .await
                })
            },
        );

        o2_enterprise::enterprise::anomaly_detection::query_executor::register_anomaly_writer(
            |org_id, records| {
                Box::pin(async move {
                    openobserve_core::anomaly_detection::write_anomalies_to_stream(&org_id, records)
                        .await
                })
            },
        );

        o2_enterprise::enterprise::anomaly_detection::query_executor::register_alert_sender(
            |org_id,
             dest_id,
             cfg_name,
             cfg_id,
             anomaly_count,
             stream_name,
             max_deviation_percent,
             worst_actual_value,
             window_start_us,
             window_end_us| {
                Box::pin(async move {
                    openobserve_core::anomaly_detection::send_anomaly_alert(
                        org_id,
                        dest_id,
                        cfg_name,
                        cfg_id,
                        anomaly_count,
                        stream_name,
                        max_deviation_percent,
                        worst_actual_value,
                        window_start_us,
                        window_end_us,
                    )
                    .await
                })
            },
        );

        // When training completes, reset the scheduled_jobs trigger to now so
        // detection starts immediately rather than waiting for the next retry cycle.
        o2_enterprise::enterprise::anomaly_detection::query_executor::register_training_complete_notifier(
            |org_id, config_id| {
                Box::pin(async move {
                    use config::{meta::triggers::TriggerModule, utils::time::now_micros};
                    match db::scheduler::get(&org_id, TriggerModule::AnomalyDetection, &config_id).await {
                        Ok(mut trigger) => {
                            trigger.next_run_at = now_micros();
                            trigger.status = db::scheduler::TriggerStatus::Waiting;
                            db::scheduler::update_trigger(trigger, false, "").await
                                .map_err(|e| anyhow::anyhow!(e))
                        }
                        Err(e) => {
                            log::warn!("[anomaly_detection {config_id}] trigger not found after training: {e}");
                            Ok(())
                        }
                    }
                })
            },
        );

        o2_enterprise::enterprise::anomaly_detection::query_executor::register_training_reporter(
            |org_id, anomaly_id, anomaly_name, success, error_msg, start_us, end_us| {
                Box::pin(async move {
                    use config::meta::self_reporting::usage::{
                        TriggerData, TriggerDataStatus, TriggerDataType,
                    };
                    usage_reporting::publish_triggers_usage(TriggerData {
                        _timestamp: start_us,
                        org: org_id,
                        module: TriggerDataType::AnomalyDetectionTraining,
                        key: format!("{anomaly_name}/{anomaly_id}"),
                        next_run_at: 0,
                        is_realtime: false,
                        is_silenced: false,
                        status: if success {
                            TriggerDataStatus::Completed
                        } else {
                            TriggerDataStatus::Failed
                        },
                        start_time: start_us,
                        end_time: end_us,
                        retries: 0,
                        error: error_msg,
                        evaluation_took_in_secs: Some((end_us - start_us) as f64 / 1_000_000.0),
                        ..Default::default()
                    });
                    Ok(())
                })
            },
        );
    }

    // The scheduler and startup recovery only run on alert_manager nodes.
    // Skip entirely when anomaly detection is disabled — no training and no detection.
    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_alert_manager()
        && !o2_enterprise::enterprise::common::config::get_config()
            .anomaly_detection
            .disabled
    {
        // Ensure every enabled anomaly config has a live detection trigger after restart.
        // Handles: trigger row missing, or stuck in Processing from a previous crash.
        openobserve_core::anomaly_detection::recover_detection_triggers_on_startup().await;

        if let Err(e) =
            o2_enterprise::enterprise::anomaly_detection::scheduler::start_scheduler().await
        {
            log::error!("Failed to start anomaly detection scheduler: {e}");
        }
    }
    #[cfg(feature = "enterprise")]
    if LOCAL_NODE.is_alert_manager() {
        o2_enterprise::enterprise::synthetics::init().await;
        if get_o2_config().synthetics.enabled {
            tokio::task::spawn(crate::service::synthetics::location_staleness_watcher());
        }
    }
    tokio::task::spawn(metrics::run());
    let _ = promql::run();
    tokio::task::spawn(alert_manager::run());
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(alert_grouping::process_expired_batches());
    tokio::task::spawn(infra::cache::file_downloader::run());
    // Note: Service discovery extraction runs automatically during parquet file processing
    // See src/jobs/src/job/files/parquet.rs:queue_services_from_data_file for
    // implementation
    #[cfg(feature = "enterprise")]
    spawn_pausable_job!(
        "service_streams_batch_processor",
        get_o2_config().service_streams.batch_flush_interval_secs,
        {
            o2_enterprise::enterprise::service_streams::batch_processor::run_once().await;
        },
        pause_if: !get_o2_config().service_streams.enabled
    );
    #[cfg(feature = "enterprise")]
    spawn_pausable_job!(
        "gen_ai_agent_registry_batch_processor",
        get_o2_config()
            .gen_ai_agent_registry
            .batch_flush_interval_secs,
        {
            o2_enterprise::enterprise::llm_evaluations::agent_registry::run_once().await;
        }
    );
    #[cfg(feature = "enterprise")]
    spawn_pausable_job!(
        "service_streams_cleanup",
        get_o2_config().service_streams.cleanup_interval_mins * 60, // convert minutes to seconds
        {
            use config::metrics;

            let stale_age_us =  get_o2_config().service_streams.stale_threshold_hours as i64 * 3600 * 1_000_000; // convert hours to microseconds

            // Leader election: smallest UUID ingester runs cleanup
            let is_leader = match infra::cluster::get_cached_online_ingester_nodes().await {
                Some(mut nodes) if !nodes.is_empty() => {
                    nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                    nodes[0].uuid == LOCAL_NODE.uuid
                }
                _ => true, // single-node fallback
            };

            if !is_leader {
                continue;
            }

            let orgs = match infra::table::service_streams::list_distinct_orgs().await {
                Ok(orgs) => orgs,
                Err(e) => {
                    log::error!("[service_streams_cleanup] Failed to list orgs: {e}");
                    metrics::SERVICE_STREAMS_CLEANUP_RUNS
                        .with_label_values(&["error"])
                        .inc();
                    continue;
                }
            };

            let cutoff_us = chrono::Utc::now().timestamp_micros() - stale_age_us;

            for org_id in &orgs {
                let start = std::time::Instant::now();
                match infra::table::service_streams::delete_stale(org_id, cutoff_us).await {
                    Ok(evicted) => {
                        let duration = start.elapsed().as_secs_f64();
                        metrics::SERVICE_STREAMS_CLEANUP_DURATION_SECONDS
                            .with_label_values(&[org_id])
                            .observe(duration);
                        metrics::SERVICE_STREAMS_CLEANUP_RUNS
                            .with_label_values(&["success"])
                            .inc();
                        if evicted > 0 {
                            metrics::SERVICE_STREAMS_CLEANUP_ROWS_EVICTED
                                .with_label_values(&[org_id])
                                .inc_by(evicted);
                            log::info!(
                                "[service_streams_cleanup] org={} evicted={} duration={:.3}s",
                                org_id, evicted, duration
                            );
                        }
                    }
                    Err(e) => {
                        metrics::SERVICE_STREAMS_CLEANUP_RUNS
                            .with_label_values(&["error"])
                            .inc();
                        log::error!("[service_streams_cleanup] org={} error={e}", org_id);
                    }
                }
            }
        },
        pause_if: !get_o2_config().service_streams.enabled
    );
    #[cfg(feature = "enterprise")]
    tokio::task::spawn(pipeline::run());
    pipeline_error_cleanup::run();
    session_cleanup::run();

    if LOCAL_NODE.is_compactor() {
        tokio::task::spawn(file_list_dump::run());
        // Org deletion is data-lifecycle work (object-store + file_list + DB teardown,
        // via the same compact::retention path the compactor already uses), so both
        // the cleanup worker and the grace-period promotion scheduler run on the
        // compactor. Cluster coordination is unchanged: the worker holds a dist-lock
        // to fetch tasks and a per-task CAS guards execution; the promotion sweep uses
        // an atomic status CAS — so multiple compactors remain safe, just less
        // contended. (The org_status cache watch loop stays on every node — see below.)
        tokio::task::spawn(openobserve_core::org_cleanup::run(std::sync::Arc::new(
            CompactionStreamDataCleanup,
        )));
        tokio::task::spawn(openobserve_core::org_cleanup::run_promotion_scheduler());
    }

    // load metrics disk cache
    tokio::task::spawn(promql_service::search::init());

    // start pipeline data retention
    #[cfg(feature = "enterprise")]
    {
        tokio::task::spawn(o2_enterprise::enterprise::pipeline::pipeline_job::run());
        tokio::task::spawn(db::keys::cache::cache());
        tokio::task::spawn(db::keys::watch::watch());
        tokio::task::spawn(org_storage::run());
        tokio::task::spawn(openobserve_org_storage::watch::watch());
        tokio::task::spawn(openobserve_core::workflows::runtime::clean());
        tokio::task::spawn(db::workflows::watch());
        if LOCAL_NODE.is_alert_manager() {
            tokio::task::spawn(openobserve_core::workflows::runtime::watch_workflow_triggers());
        }
    }

    #[cfg(feature = "vectorscan")]
    {
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

    // Initialize the remaining cloud tasks. AI quota state and synchronization
    // are initialized above because single-role routers also serve quota APIs.
    #[cfg(feature = "cloud")]
    {
        // OpenFGA migration
        o2_enterprise::enterprise::cloud::ofga_migrate()
            .await
            .expect("cloud ofga migrations failed");

        use openobserve_core::self_reporting::{ingest_data_retention_usages, search::get_usage};
        o2_enterprise::enterprise::metering::init(
            get_metering_lock,
            get_usage,
            ingest_data_retention_usages,
        )
        .await
        .expect("cloud usage metering job init failed");

        // Initialize AWS Marketplace SQS notification polling
        o2_enterprise::enterprise::aws_marketplace::init()
            .await
            .expect("AWS Marketplace integration init failed");

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
            openobserve_core::self_reporting::search::get_usage,
            get_nats_lock,
            openobserve_core::self_reporting::search::get_license_usage_data_from_node,
            LOCAL_NODE.is_router() || LOCAL_NODE.is_single_role(),
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

    enrichment_data::enrichment_table::cache::cache_enrichment_tables()
        .await
        .expect("EnrichmentTables cache failed");
    // pipelines can potentially depend on enrichment tables, so cached afterwards
    openobserve_core::pipeline::db::cache(wait_for_initialization)
        .await
        .expect("Pipeline cache failed");

    // Lightweight dashboard id->org cache for cross-org IDOR checks. Runs on every node.
    db::dashboards::cache_id_to_org()
        .await
        .expect("Dashboard id->org cache failed");

    Ok(())
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use super::eval_scheduler_fetch_size;

    #[test]
    fn eval_scheduler_fetches_one_row_past_the_count() {
        assert_eq!(eval_scheduler_fetch_size(10_001, 100_000).unwrap(), 10_002);
    }

    #[test]
    fn eval_scheduler_rejects_intervals_above_the_safe_limit() {
        let error = eval_scheduler_fetch_size(100_001, 100_000).unwrap_err();
        assert!(error.to_string().contains("exceeding the safe limit"));
    }
}
