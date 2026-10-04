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

use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};

use config::meta::{
    folder::{Folder, FolderType},
    search::{Query, Request, RequestEncoding, SearchEventType},
    stream::StreamType,
};
use db::folders::FolderError;
use openobserve_core::{
    anomaly_detection,
    traces::red_insights::{
        self, FOLDER_NAME, MANAGED_TAG, MAX_CREATES, MAX_SERVICES, MIN_REQUESTS_24H,
        ManagedDetector, ServiceVolume, StreamColumns,
    },
};

const CYCLE: Duration = Duration::from_secs(6 * 60 * 60);
/// Lets the job-cluster election resolve before the first claim check.
const FIRST_RUN_DELAY: Duration = Duration::from_secs(5 * 60);
const VOLUME_WINDOW_US: i64 = 24 * 60 * 60 * 1_000_000;

pub async fn run() {
    let start = tokio::time::Instant::now() + FIRST_RUN_DELAY;
    let mut ticker = tokio::time::interval_at(start, CYCLE);
    loop {
        ticker.tick().await;
        // The per-org dist lock is regional, so only the region holding the claim reconciles.
        if !super::anomaly_holds_job_cluster_claim().await {
            continue;
        }
        // The per-org lock waits, not skips, so each scheduler would re-reconcile in turn.
        if !super::leader::is_alert_manager_leader().await {
            continue;
        }
        let orgs = match db::organization::list(None).await {
            Ok(orgs) => orgs,
            Err(e) => {
                log::error!("[RED insights] could not list orgs: {e}");
                continue;
            }
        };
        for org in orgs {
            if let Err(e) = reconcile_if_needed(&org.identifier).await {
                log::error!("[RED insights] org {}: {e}", org.identifier);
            }
        }
    }
}

async fn reconcile_if_needed(org_id: &str) -> anyhow::Result<()> {
    let prefetched = if db::organization::get_org_setting_red_insights_enabled(org_id).await? {
        None
    } else {
        let configs = managed_configs(org_id).await?;
        if configs.is_empty() {
            return Ok(());
        }
        Some(configs)
    };
    let locker = infra::dist_lock::lock(&format!("red_insights/{org_id}"), 0).await?;
    let result = reconcile(org_id, prefetched).await;
    if let Err(e) = infra::dist_lock::unlock(&locker).await {
        log::warn!("[RED insights] org {org_id}: failed to release the lock: {e}");
    }
    result
}

async fn reconcile(org_id: &str, prefetched: Option<Vec<serde_json::Value>>) -> anyhow::Result<()> {
    let configs = match prefetched {
        Some(configs) => configs,
        None => managed_configs(org_id).await?,
    };
    if !db::organization::get_org_setting_red_insights_enabled(org_id).await? {
        for config in &configs {
            delete(org_id, config_str(config, "anomaly_id")).await;
        }
        return Ok(());
    }

    let streams = stream_columns(org_id).await?;
    let volumes = service_volumes(org_id, &streams).await?;
    let detectors: Vec<_> = configs.iter().filter_map(managed_detector).collect();
    let removed = removed_streams(org_id, &detectors, &streams).await;
    let existing = red_insights::on_read_streams(detectors, &streams, &removed);
    // Uncapped here: a signal the template skips must not use up the per-cycle create budget.
    let plan = red_insights::plan(
        true,
        &volumes,
        &existing,
        MAX_SERVICES,
        MIN_REQUESTS_24H,
        usize::MAX,
    );
    for id in &plan.delete {
        delete(org_id, id).await;
    }

    let templates: Vec<_> = plan
        .create
        .iter()
        .filter_map(|(stream, service, signal)| {
            red_insights::template(stream, service, *signal, streams.get(stream)?)
        })
        .take(MAX_CREATES)
        .collect();
    if templates.is_empty() {
        return Ok(());
    }
    let folder_id = red_folder(org_id, &configs).await?;
    for template in templates {
        let name = template.name.clone();
        if let Err(e) =
            anomaly_detection::create_config(org_id, template.into_request(&folder_id)).await
        {
            log::error!("[RED insights] org {org_id}: failed to create '{name}': {e}");
        }
    }
    Ok(())
}

async fn managed_configs(org_id: &str) -> anyhow::Result<Vec<serde_json::Value>> {
    let configs = anomaly_detection::list_configs(org_id, None, None).await?;
    Ok(configs
        .into_iter()
        .filter(|c| config_tags(c).iter().any(|t| t == MANAGED_TAG))
        .collect())
}

fn config_tags(config: &serde_json::Value) -> Vec<String> {
    config
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|tags| {
            tags.iter()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn config_str<'a>(config: &'a serde_json::Value, key: &str) -> &'a str {
    config.get(key).and_then(|v| v.as_str()).unwrap_or_default()
}

/// An unparseable managed detector maps to `None`, so the plan leaves it alone.
fn managed_detector(config: &serde_json::Value) -> Option<ManagedDetector> {
    let (service, signal) =
        red_insights::parse_managed(&config_tags(config), config_str(config, "custom_sql"))?;
    Some(ManagedDetector {
        id: config_str(config, "anomaly_id").to_string(),
        stream: config_str(config, "stream_name").to_string(),
        service,
        signal,
        enabled: config
            .get("enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
    })
}

async fn delete(org_id: &str, anomaly_id: &str) {
    if let Err(e) = anomaly_detection::delete_config(org_id, anomaly_id).await {
        log::error!("[RED insights] org {org_id}: failed to delete {anomaly_id}: {e}");
    }
}

/// The public folder id, which is what `create_config`'s `folder_id` takes.
async fn red_folder(org_id: &str, configs: &[serde_json::Value]) -> anyhow::Result<String> {
    if let Some(folder_id) = configs
        .iter()
        .map(|c| config_str(c, "folder_id"))
        .find(|id| !id.is_empty())
    {
        return Ok(folder_id.to_string());
    }
    match db::folders::get_folder_by_name(org_id, FOLDER_NAME, FolderType::Alerts).await {
        Ok(folder) => return Ok(folder.folder_id),
        Err(FolderError::NotFound) => {}
        Err(e) => return Err(e.into()),
    }
    let folder = Folder {
        folder_id: String::new(),
        name: FOLDER_NAME.to_string(),
        description: "Anomaly detectors managed by RED insights".to_string(),
        icon: None,
    };
    match db::folders::save_folder(org_id, folder, FolderType::Alerts, false).await {
        Ok(folder) => Ok(folder.folder_id),
        Err(FolderError::FolderNameAlreadyExists) => {
            Ok(
                db::folders::get_folder_by_name(org_id, FOLDER_NAME, FolderType::Alerts)
                    .await?
                    .folder_id,
            )
        }
        Err(e) => Err(e.into()),
    }
}

/// Rankable trace streams; a schema error fails the org, as a search error does.
async fn stream_columns(org_id: &str) -> anyhow::Result<BTreeMap<String, StreamColumns>> {
    let mut out = BTreeMap::new();
    for stream in db::schema::list_streams_from_cache(org_id, StreamType::Traces).await {
        let schema = infra::schema::get(org_id, &stream, StreamType::Traces)
            .await
            .map_err(|e| anyhow::anyhow!("schema read for {stream} failed: {e}"))?;
        let has = |name: &str| schema.field_with_name(name).is_ok();
        if !has("service_name") || !has("span_kind") {
            log::info!("[RED insights] org {org_id}: {stream} has no service_name/span_kind");
            continue;
        }
        let cols = StreamColumns {
            has_parent: has("reference_parent_span_id"),
            has_status: has("span_status"),
            has_duration: has("duration"),
        };
        out.insert(stream, cols);
    }
    Ok(out)
}

/// A lookup error leaves the stream out, so a transient failure never deletes its detectors.
async fn removed_streams(
    org_id: &str,
    detectors: &[ManagedDetector],
    streams: &BTreeMap<String, StreamColumns>,
) -> BTreeSet<String> {
    let unread: BTreeSet<&str> = detectors
        .iter()
        .map(|d| d.stream.as_str())
        .filter(|s| !streams.contains_key(*s))
        .collect();
    let mut removed = BTreeSet::new();
    for stream in unread {
        match infra::schema::get(org_id, stream, StreamType::Traces).await {
            // A missing stream reads back as an empty schema, never as an error.
            Ok(schema) if schema.fields().is_empty() => {
                removed.insert(stream.to_string());
            }
            Ok(_) => {}
            Err(e) => {
                log::warn!("[RED insights] org {org_id}: schema read for {stream} failed: {e}")
            }
        }
    }
    removed
}

/// Fails on any stream error: a missing stream would read as zero traffic and lose its detectors.
async fn service_volumes(
    org_id: &str,
    streams: &BTreeMap<String, StreamColumns>,
) -> anyhow::Result<Vec<ServiceVolume>> {
    let end_time = config::utils::time::now_micros();
    let mut volumes = Vec::new();
    for (stream, cols) in streams {
        let req = Request {
            query: Query {
                sql: red_insights::volume_sql(stream, cols),
                from: 0,
                size: (MAX_SERVICES * 2) as i64,
                start_time: end_time - VOLUME_WINDOW_US,
                end_time,
                track_total_hits: false,
                uses_zo_fn: false,
                query_fn: None,
                ..Default::default()
            },
            encoding: RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            timeout: 0,
            // Background nodes, as for anomaly training, so this never lands on interactive ones.
            search_type: Some(SearchEventType::DerivedStream),
            search_event_context: None,
            use_cache: false,
            clear_cache: false,
            local_mode: None,
            agent_options: None,
        };
        let trace_id = config::ider::generate_trace_id();
        let resp = search_service::search(&trace_id, org_id, StreamType::Traces, None, &req)
            .await
            .map_err(|e| anyhow::anyhow!("volume search on {stream} failed: {e}"))?;
        if resp.is_partial {
            anyhow::bail!("volume search on {stream} returned partial results");
        }
        volumes.extend(resp.hits.iter().filter_map(|hit| {
            let service = hit
                .get("service_name")?
                .as_str()
                .filter(|s| !s.is_empty())?;
            Some(ServiceVolume {
                stream: stream.clone(),
                service: service.to_string(),
                requests_24h: hit.get("requests")?.as_u64()?,
            })
        }));
    }
    Ok(volumes)
}
