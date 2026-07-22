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

use std::sync::{Arc, LazyLock as Lazy};

use ::db::pipeline as db_pipeline;
use config::{
    cluster::LOCAL_NODE,
    meta::{
        pipeline::{Pipeline, PipelineKind},
        stream::StreamParams,
    },
};
use infra::{coordinator::pipelines::PIPELINES_WATCH_PREFIX, db, pipeline as infra_pipeline};

use crate::{
    common::infra::config::{
        PIPELINE_ID_TO_ORG, PIPELINE_STREAM_MAPPING, SCHEDULED_PIPELINES,
        STREAM_EXECUTABLE_PIPELINES,
    },
    service::pipeline::batch_execution::ExecutablePipeline,
};

#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    // internal
    #[error("InfraError# {0}")]
    InfraError(infra::errors::Error),
    // not found
    #[error("Pipeline with ID {0} not found.")]
    NotFound(String),
    // conflict
    #[error("Pipeline with ID {0} modified by someone else. Please refresh.")]
    Modified(String),
    // bad request
    #[error("A realtime pipeline with same source stream already exists")]
    StreamInUse,
    #[error("Invalid pipeline {0}")]
    InvalidPipeline(String),
    #[error("Invalid DerivedStream config: {0}")]
    InvalidDerivedStream(String),
    #[error("Reset only applied to scheduled pipelines")]
    PipelineDoesNotApply,
    #[error("Error deleting previous DerivedStream: {0}")]
    DeleteDerivedStream(String),
}

impl From<infra::errors::Error> for PipelineError {
    fn from(value: infra::errors::Error) -> Self {
        match value {
            infra::errors::Error::DbError(infra::errors::DbError::KeyNotExists(key)) => {
                PipelineError::NotFound(key)
            }
            err => PipelineError::InfraError(err),
        }
    }
}

/// Stores a new pipeline to database.
///
/// Pipeline validation should be handled by the caller.
pub async fn set(pipeline: &Pipeline) -> Result<(), PipelineError> {
    infra_pipeline::put(pipeline).await?;
    update_cache(PipelineTableEvent::Add(pipeline)).await;

    Ok(())
}

/// Updates a pipeline entry with the sane values.
///
/// Pipeline validation should be handled by the caller.
pub async fn update(
    pipeline: &Pipeline,
    prev_source_stream: Option<StreamParams>,
) -> Result<(), PipelineError> {
    if prev_source_stream.is_some() {
        // remove first since source stream changed
        update_cache(PipelineTableEvent::Remove(&pipeline.id)).await;
    }

    infra_pipeline::put(pipeline).await?;
    update_cache(PipelineTableEvent::Add(pipeline)).await;

    Ok(())
}

/// Returns all streams with existing pipelines.
pub async fn list_streams_with_pipeline(org: &str) -> Result<Vec<StreamParams>, PipelineError> {
    Ok(db_pipeline::list_streams_with_pipeline(org).await?)
}

/// Retrieve cached ExecutablePipelines for a stream. User pipelines come first,
/// followed by evaluation pipelines.
///
/// Used for pipeline execution.
pub async fn get_executable_pipelines(stream_params: &StreamParams) -> Vec<ExecutablePipeline> {
    let mut pipelines: Vec<ExecutablePipeline> = STREAM_EXECUTABLE_PIPELINES
        .read()
        .await
        .get(stream_params)
        .cloned()
        .unwrap_or_default();
    pipelines.sort_by_key(|p| p.kind != PipelineKind::User);
    pipelines
}

/// Returns all realtime pipelines for the given stream. User pipelines first.
pub async fn get_by_stream(stream_params: &StreamParams) -> Vec<Pipeline> {
    db_pipeline::get_by_stream(stream_params)
        .await
        .unwrap_or_default()
}

/// Returns the pipeline by id.
///
/// Used to get the pipeline associated with the ID when scheduled job is ran.
pub async fn get_by_id(pipeline_id: &str) -> Result<Pipeline, PipelineError> {
    Ok(db_pipeline::get_by_id(pipeline_id).await?)
}

/// Returns the owning org for a pipeline id from the in-memory `PIPELINE_ID_TO_ORG` cache.
///
/// On a cache miss this falls back to a DB read so callers do not see false negatives during
/// startup or briefly after a pipeline is created. The cache is populated for every pipeline
/// (enabled or disabled, realtime or scheduled) by `cache_id_to_org()` and kept in sync by the
/// `watch()` loop.
pub async fn get_org_by_id(pipeline_id: &str) -> Option<String> {
    if let Some(org) = PIPELINE_ID_TO_ORG.read().await.get(pipeline_id).cloned() {
        return Some(org);
    }
    match db_pipeline::get_by_id(pipeline_id).await {
        Ok(p) => {
            PIPELINE_ID_TO_ORG
                .write()
                .await
                .insert(p.id.clone(), p.org.clone());
            Some(p.org)
        }
        Err(_) => None,
    }
}

/// Populates `PIPELINE_ID_TO_ORG` from the DB. Lightweight — does not initialize any
/// `ExecutablePipeline` and is safe to call on every node type (routers included).
pub async fn cache_id_to_org() -> Result<(), anyhow::Error> {
    let pipelines = list().await?;
    let mut id_to_org = PIPELINE_ID_TO_ORG.write().await;
    id_to_org.clear();
    for pl in pipelines.iter() {
        id_to_org.insert(pl.id.clone(), pl.org.clone());
    }
    log::info!(
        "[Pipeline] Cached id->org mapping for {} pipelines",
        id_to_org.len()
    );
    Ok(())
}

/// Returns the cached scheduled pipeline by id, or fetches from DB if not cached.
pub async fn get_scheduled_pipeline_from_cache(pipeline_id: &str) -> Option<Pipeline> {
    SCHEDULED_PIPELINES.read().await.get(pipeline_id).cloned()
}

/// Adds or updates a scheduled pipeline in the cache.
pub async fn cache_scheduled_pipeline(pipeline: &Pipeline) {
    if matches!(
        pipeline.source,
        config::meta::pipeline::components::PipelineSource::Scheduled(_)
    ) {
        SCHEDULED_PIPELINES
            .write()
            .await
            .insert(pipeline.id.clone(), pipeline.clone());
    }
}

/// Removes a scheduled pipeline from the cache.
pub async fn remove_scheduled_pipeline_from_cache(pipeline_id: &str) {
    SCHEDULED_PIPELINES.write().await.remove(pipeline_id);
}

/// Returns the number of scheduled pipelines in the cache.
pub async fn get_scheduled_pipelines_cache_size() -> usize {
    SCHEDULED_PIPELINES.read().await.len()
}

/// Returns cache statistics for monitoring.
pub async fn get_cache_stats() -> (usize, usize) {
    let realtime_count = STREAM_EXECUTABLE_PIPELINES.read().await.len();
    let scheduled_count = SCHEDULED_PIPELINES.read().await.len();
    (realtime_count, scheduled_count)
}

/// Clears the scheduled pipelines cache. Used for maintenance.
pub async fn clear_scheduled_pipelines_cache() {
    SCHEDULED_PIPELINES.write().await.clear();
    log::info!("[Pipeline] Scheduled pipelines cache cleared");
}

/// Finds the pipelines with the same source
///
/// Used to validate if a duplicate pipeline exists.
pub async fn get_with_same_source_stream(
    pipeline: &Pipeline,
) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(db_pipeline::get_with_same_source_stream(pipeline).await?)
}

/// Lists all pipelines across all orgs.
pub async fn list() -> Result<Vec<Pipeline>, PipelineError> {
    Ok(db_pipeline::list().await?)
}

/// Lists all pipelines for a given organization.
pub async fn list_by_org(org: &str) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(db_pipeline::list_by_org(org).await?)
}

/// Deletes a pipeline by ID.
pub async fn delete(pipeline_id: &str) -> Result<(), PipelineError> {
    // remove from cache first
    update_cache(PipelineTableEvent::Remove(pipeline_id)).await;

    infra_pipeline::delete(pipeline_id).await?;

    Ok(())
}

/// Preload all enabled pipelines into the cache at startup.
pub async fn cache() -> Result<(), anyhow::Error> {
    // The id->org map is needed on every node type (including routers) for cross-org
    // IDOR checks in HTTP handlers, so populate it before the heavy-cache early-return.
    cache_id_to_org().await?;

    if !LOCAL_NODE.is_ingester() && !LOCAL_NODE.is_querier() && !LOCAL_NODE.is_alert_manager() {
        return Ok(());
    }
    let pipelines = list().await?;
    if pipelines
        .iter()
        .any(|pl| pl.enabled && pl.num_of_func() > 0)
        && !config::get_config().common.mmdb_disable_download
    {
        log::info!("[PIPELINE:CACHE] waiting mmdb data to be available");
        Lazy::force(&crate::service::enrichment_table::geoip::MMDB_INIT_NOTIFIER)
            .notified()
            .await;
        log::info!("[PIPELINE:CACHE] done waiting");
    }
    let mut pipeline_stream_mapping_cache = PIPELINE_STREAM_MAPPING.write().await;
    let mut stream_exec_pl = STREAM_EXECUTABLE_PIPELINES.write().await;
    let mut scheduled_pipelines_cache = SCHEDULED_PIPELINES.write().await;
    // clear the cache first in case of a refresh
    pipeline_stream_mapping_cache.clear();
    stream_exec_pl.clear();
    scheduled_pipelines_cache.clear();

    for pipeline in pipelines.into_iter() {
        if pipeline.enabled {
            match &pipeline.source {
                config::meta::pipeline::components::PipelineSource::Realtime(stream_params) => {
                    match ExecutablePipeline::new(&pipeline).await {
                        Err(e) => {
                            log::error!(
                                "[Pipeline] error initializing ExecutablePipeline from pipeline {}/{}. {}. Not cached",
                                pipeline.org,
                                pipeline.id,
                                e
                            )
                        }
                        Ok(exec_pl) => {
                            pipeline_stream_mapping_cache
                                .insert(pipeline.id.clone(), stream_params.clone());
                            stream_exec_pl
                                .entry(stream_params.clone())
                                .or_default()
                                .push(exec_pl);
                        }
                    };
                }
                config::meta::pipeline::components::PipelineSource::Scheduled(_) => {
                    scheduled_pipelines_cache.insert(pipeline.id.clone(), pipeline);
                }
            }
        }
    }

    log::info!(
        "[Pipeline] Cached realtime pipelines: {}, scheduled pipelines: {}",
        stream_exec_pl.len(),
        scheduled_pipelines_cache.len()
    );
    Ok(())
}

/// Update STREAM_PIPELINES cache for realtime pipelines
async fn update_cache(event: PipelineTableEvent<'_>) {
    match event {
        PipelineTableEvent::Remove(pipeline_id) => {
            if let Err(e) = infra::coordinator::pipelines::emit_delete_event(pipeline_id).await {
                log::error!("[Pipeline] error triggering event to remove pipeline from cache: {e}");
            }

            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
            {
                let key = format!("{PIPELINES_WATCH_PREFIX}{pipeline_id}");
                if let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::pipelines_delete(&key).await
                {
                    log::error!(
                        "[Pipeline] error triggering super cluster event to remove pipeline from cache: {e}"
                    );
                }
            }
        }
        PipelineTableEvent::Add(pipeline) => {
            if let Err(e) = infra::coordinator::pipelines::emit_put_event(&pipeline.id).await {
                log::error!("[Pipeline] error triggering event to add pipeline to cache: {e}");
            }

            // super cluster
            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
            {
                let key = format!("{PIPELINES_WATCH_PREFIX}{}", pipeline.id);
                match config::utils::json::to_vec(pipeline) {
                    Err(e) => {
                        log::error!(
                            "[Pipeline] error serializing pipeline for super_cluster event: {e}"
                        );
                    }
                    Ok(value_vec) => {
                        if let Err(e) =
                            o2_enterprise::enterprise::super_cluster::queue::pipelines_put(
                                &key,
                                value_vec.into(),
                            )
                            .await
                        {
                            log::error!(
                                "[Pipeline] error triggering super cluster event to add pipeline to cache: {e}"
                            );
                        }
                    }
                };
            }
        }
    }
}

/// Lightweight watcher that only maintains the `PIPELINE_ID_TO_ORG` cache.
///
/// Runs on every node type (including dedicated routers) so HTTP handlers can perform
/// O(1) cross-org ownership checks without a DB round trip. The heavy `watch()` below
/// (which also initializes `ExecutablePipeline` objects) remains gated to ingester /
/// querier / alert_manager nodes.
pub async fn watch_id_to_org() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(PIPELINES_WATCH_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[Pipeline::watch_id_to_org] started");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("[Pipeline::watch_id_to_org] event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let pipeline_id = ev.key.strip_prefix(PIPELINES_WATCH_PREFIX).unwrap();
                let Ok(pipeline) = get_by_id(pipeline_id).await else {
                    log::error!(
                        "[Pipeline::watch_id_to_org] error getting pipeline {pipeline_id} from db"
                    );
                    continue;
                };
                PIPELINE_ID_TO_ORG
                    .write()
                    .await
                    .insert(pipeline.id, pipeline.org);
            }
            db::Event::Delete(ev) => {
                let pipeline_id = ev.key.strip_prefix(PIPELINES_WATCH_PREFIX).unwrap();
                PIPELINE_ID_TO_ORG.write().await.remove(pipeline_id);
            }
            db::Event::Empty => {}
        }
    }
    log::info!("[Pipeline::watch_id_to_org] ended");
    Ok(())
}

/// Inserts or replaces a realtime pipeline's `ExecutablePipeline` in the stream caches.
///
/// A coordinator Put event fires for updates as well as creates, so any previously cached
/// copy of the same pipeline id must be dropped first — including one cached under a
/// different source stream if the pipeline was re-pointed. Otherwise every save of an
/// enabled pipeline would stack another copy and records would be processed once per save.
async fn upsert_realtime_pipeline_cache(
    pipeline_id: &str,
    stream_params: &StreamParams,
    exec_pl: ExecutablePipeline,
) {
    let mut pipeline_stream_mapping_cache = PIPELINE_STREAM_MAPPING.write().await;
    let mut stream_exec_pl = STREAM_EXECUTABLE_PIPELINES.write().await;
    if let Some(prev_stream) =
        pipeline_stream_mapping_cache.insert(pipeline_id.to_string(), stream_params.clone())
        && prev_stream != *stream_params
        && let Some(vec) = stream_exec_pl.get_mut(&prev_stream)
    {
        vec.retain(|pl| pl.id != pipeline_id);
        if vec.is_empty() {
            stream_exec_pl.remove(&prev_stream);
        }
    }
    let vec = stream_exec_pl.entry(stream_params.clone()).or_default();
    vec.retain(|pl| pl.id != pipeline_id);
    vec.push(exec_pl);
}

/// Removes a realtime pipeline's `ExecutablePipeline` from the stream caches.
///
/// Used when a pipeline is disabled or deleted. Returns true if the pipeline was cached.
async fn remove_realtime_pipeline_cache(pipeline_id: &str) -> bool {
    let mut pipeline_stream_mapping_cache = PIPELINE_STREAM_MAPPING.write().await;
    let mut stream_exec_pl = STREAM_EXECUTABLE_PIPELINES.write().await;
    let Some(removed_stream) = pipeline_stream_mapping_cache.remove(pipeline_id) else {
        return false;
    };
    if let Some(vec) = stream_exec_pl.get_mut(&removed_stream) {
        vec.retain(|pl| pl.id != pipeline_id);
        if vec.is_empty() {
            stream_exec_pl.remove(&removed_stream);
        }
    }
    true
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(PIPELINES_WATCH_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[Pipeline::watch] His watch is started");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("[Pipeline::watch] event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let pipeline_id = ev.key.strip_prefix(PIPELINES_WATCH_PREFIX).unwrap();
                let Ok(pipeline) = get_by_id(pipeline_id).await else {
                    log::error!("[Pipeline::watch] error getting pipeline by id from db");
                    continue;
                };
                PIPELINE_ID_TO_ORG
                    .write()
                    .await
                    .insert(pipeline.id.clone(), pipeline.org.clone());
                match &pipeline.source {
                    config::meta::pipeline::components::PipelineSource::Realtime(stream_params) => {
                        if pipeline.enabled {
                            match ExecutablePipeline::new(&pipeline).await {
                                Err(e) => {
                                    log::error!(
                                        "[Pipeline::watch] {}/{}/{}: Error initializing pipeline into ExecutablePipeline when updating cache: {}",
                                        pipeline.org,
                                        pipeline.name,
                                        pipeline.id,
                                        e
                                    );
                                }
                                Ok(exec_pl) => {
                                    upsert_realtime_pipeline_cache(
                                        pipeline_id,
                                        stream_params,
                                        exec_pl,
                                    )
                                    .await;
                                    log::info!(
                                        "[Pipeline::watch]: realtime pipeline {} added to cache.",
                                        pipeline.id
                                    );
                                }
                            };
                        } else if remove_realtime_pipeline_cache(pipeline_id).await {
                            log::info!(
                                "[Pipeline]: realtime pipeline {pipeline_id} disabled and removed from cache."
                            );
                        }
                    }
                    config::meta::pipeline::components::PipelineSource::Scheduled(_) => {
                        let mut scheduled_pipelines_cache = SCHEDULED_PIPELINES.write().await;
                        if pipeline.enabled {
                            scheduled_pipelines_cache.insert(pipeline_id.to_string(), pipeline);
                            log::info!(
                                "[Pipeline::watch]: scheduled pipeline {pipeline_id} added to cache."
                            );
                        } else {
                            // remove pipeline from cache if the update is to disable
                            if scheduled_pipelines_cache.remove(pipeline_id).is_some() {
                                log::info!(
                                    "[Pipeline]: scheduled pipeline {pipeline_id} disabled and removed from cache."
                                );
                            }
                        }
                    }
                }
            }
            db::Event::Delete(ev) => {
                let pipeline_id = ev.key.strip_prefix(PIPELINES_WATCH_PREFIX).unwrap();
                PIPELINE_ID_TO_ORG.write().await.remove(pipeline_id);
                if remove_realtime_pipeline_cache(pipeline_id).await {
                    log::info!(
                        "[Pipeline]: realtime pipeline {pipeline_id} deleted and removed from cache."
                    );
                }
                // Also remove from scheduled pipelines cache
                if SCHEDULED_PIPELINES
                    .write()
                    .await
                    .remove(pipeline_id)
                    .is_some()
                {
                    log::info!(
                        "[Pipeline]: scheduled pipeline {pipeline_id} deleted and removed from cache."
                    );
                }
            }
            db::Event::Empty => {}
        }
    }

    log::info!("[Pipeline::watch] His watch is ended");
    Ok(())
}

#[derive(Debug)]
enum PipelineTableEvent<'a> {
    Add(&'a Pipeline),
    Remove(&'a str),
}

#[cfg(test)]
mod tests {
    use config::meta::{
        pipeline::components::{DerivedStream, Edge, Node, NodeData, PipelineSource},
        stream::{StreamParams, StreamType},
    };

    use super::*;

    fn realtime_pipeline(id: &str, source_stream: &StreamParams) -> Pipeline {
        let source = Node::new(
            "source".to_string(),
            NodeData::Stream(source_stream.clone()),
            0.0,
            0.0,
            "input".to_string(),
        );
        let dest = Node::new(
            "dest".to_string(),
            NodeData::Stream(StreamParams::new(
                &source_stream.org_id,
                "dest_stream",
                StreamType::Logs,
            )),
            100.0,
            0.0,
            "output".to_string(),
        );
        Pipeline {
            id: id.to_string(),
            version: 1,
            enabled: true,
            org: source_stream.org_id.to_string(),
            name: id.to_string(),
            description: String::new(),
            source: PipelineSource::Realtime(source_stream.clone()),
            nodes: vec![source, dest],
            edges: vec![Edge::new("source".to_string(), "dest".to_string())],
            kind: config::meta::pipeline::PipelineKind::User,
        }
    }

    async fn clear_realtime_cache_entries(pipeline_ids: &[&str], streams: &[&StreamParams]) {
        let mut mapping = PIPELINE_STREAM_MAPPING.write().await;
        let mut stream_exec_pl = STREAM_EXECUTABLE_PIPELINES.write().await;
        for id in pipeline_ids {
            mapping.remove(*id);
        }
        for stream in streams {
            stream_exec_pl.remove(*stream);
        }
    }

    // regression test for #13169: every save of an enabled realtime pipeline stacked
    // another ExecutablePipeline copy, multiplying ingester CPU and destination writes
    #[tokio::test]
    async fn test_upsert_realtime_pipeline_cache_replaces_on_update() {
        let stream = StreamParams::new("upsert_org_1", "upsert_stream_1", StreamType::Logs);
        let pipeline = realtime_pipeline("upsert_pl_1", &stream);

        for _ in 0..3 {
            let exec_pl = ExecutablePipeline::new(&pipeline).await.unwrap();
            upsert_realtime_pipeline_cache(&pipeline.id, &stream, exec_pl).await;
        }

        let cached = get_executable_pipelines(&stream).await;
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, pipeline.id);

        clear_realtime_cache_entries(&[&pipeline.id], &[&stream]).await;
    }

    #[tokio::test]
    async fn test_upsert_realtime_pipeline_cache_keeps_other_pipelines() {
        let stream = StreamParams::new("upsert_org_2", "upsert_stream_2", StreamType::Logs);
        let pipeline_a = realtime_pipeline("upsert_pl_2a", &stream);
        let pipeline_b = realtime_pipeline("upsert_pl_2b", &stream);

        let exec_a = ExecutablePipeline::new(&pipeline_a).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline_a.id, &stream, exec_a).await;
        let exec_b = ExecutablePipeline::new(&pipeline_b).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline_b.id, &stream, exec_b).await;

        // both pipelines coexist on the same stream
        assert_eq!(get_executable_pipelines(&stream).await.len(), 2);

        // updating one must not drop or duplicate the other
        let exec_a = ExecutablePipeline::new(&pipeline_a).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline_a.id, &stream, exec_a).await;
        let cached = get_executable_pipelines(&stream).await;
        assert_eq!(cached.len(), 2);
        assert!(cached.iter().any(|pl| pl.id == pipeline_a.id));
        assert!(cached.iter().any(|pl| pl.id == pipeline_b.id));

        clear_realtime_cache_entries(&[&pipeline_a.id, &pipeline_b.id], &[&stream]).await;
    }

    #[tokio::test]
    async fn test_remove_realtime_pipeline_cache() {
        let stream = StreamParams::new("upsert_org_4", "upsert_stream_4", StreamType::Logs);
        let pipeline_a = realtime_pipeline("upsert_pl_4a", &stream);
        let pipeline_b = realtime_pipeline("upsert_pl_4b", &stream);

        let exec_a = ExecutablePipeline::new(&pipeline_a).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline_a.id, &stream, exec_a).await;
        let exec_b = ExecutablePipeline::new(&pipeline_b).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline_b.id, &stream, exec_b).await;

        // removing one keeps the other
        assert!(remove_realtime_pipeline_cache(&pipeline_a.id).await);
        let cached = get_executable_pipelines(&stream).await;
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, pipeline_b.id);

        // removing the last one drops the stream key entirely
        assert!(remove_realtime_pipeline_cache(&pipeline_b.id).await);
        assert!(
            !STREAM_EXECUTABLE_PIPELINES
                .read()
                .await
                .contains_key(&stream)
        );

        // removing an uncached pipeline is a no-op
        assert!(!remove_realtime_pipeline_cache(&pipeline_a.id).await);
    }

    #[tokio::test]
    async fn test_upsert_realtime_pipeline_cache_moves_on_source_stream_change() {
        let old_stream = StreamParams::new("upsert_org_3", "upsert_stream_3a", StreamType::Logs);
        let new_stream = StreamParams::new("upsert_org_3", "upsert_stream_3b", StreamType::Logs);
        let pipeline = realtime_pipeline("upsert_pl_3", &old_stream);

        let exec_pl = ExecutablePipeline::new(&pipeline).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline.id, &old_stream, exec_pl).await;
        let exec_pl = ExecutablePipeline::new(&pipeline).await.unwrap();
        upsert_realtime_pipeline_cache(&pipeline.id, &new_stream, exec_pl).await;

        assert!(get_executable_pipelines(&old_stream).await.is_empty());
        let cached = get_executable_pipelines(&new_stream).await;
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, pipeline.id);

        clear_realtime_cache_entries(&[&pipeline.id], &[&old_stream, &new_stream]).await;
    }

    #[tokio::test]
    async fn test_scheduled_pipeline_cache_operations() {
        let test_id = "test_pipeline_cache_ops_456";

        // Create a test scheduled pipeline
        let pipeline = Pipeline {
            id: test_id.to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "test_pipeline".to_string(),
            description: "Test pipeline".to_string(),
            source: PipelineSource::Scheduled(DerivedStream::default()),
            nodes: vec![],
            edges: vec![],
            kind: config::meta::pipeline::PipelineKind::User,
        };

        // Cache the pipeline
        cache_scheduled_pipeline(&pipeline).await;

        // Retrieve from cache
        let cached_pipeline = get_scheduled_pipeline_from_cache(test_id).await;
        assert!(cached_pipeline.is_some());
        assert_eq!(cached_pipeline.unwrap().id, test_id);

        // Remove from cache
        remove_scheduled_pipeline_from_cache(test_id).await;

        // Verify it's not in cache anymore
        let cached_pipeline = get_scheduled_pipeline_from_cache(test_id).await;
        assert!(cached_pipeline.is_none());
    }

    #[tokio::test]
    async fn test_cache_only_scheduled_pipelines() {
        let realtime_id = "realtime_pipeline_789";
        let scheduled_id = "scheduled_pipeline_789";

        // Create a realtime pipeline
        let realtime_pipeline = Pipeline {
            id: realtime_id.to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "realtime_pipeline".to_string(),
            description: "Realtime pipeline".to_string(),
            source: PipelineSource::Realtime(StreamParams::new(
                "test_org",
                "test_stream",
                StreamType::Logs,
            )),
            nodes: vec![],
            edges: vec![],
            kind: config::meta::pipeline::PipelineKind::User,
        };

        // Try to cache the realtime pipeline (should be ignored)
        cache_scheduled_pipeline(&realtime_pipeline).await;

        // Verify realtime pipeline was not cached
        let cached_realtime = get_scheduled_pipeline_from_cache(realtime_id).await;
        assert!(cached_realtime.is_none());

        // Create a scheduled pipeline
        let scheduled_pipeline = Pipeline {
            id: scheduled_id.to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: "scheduled_pipeline".to_string(),
            description: "Scheduled pipeline".to_string(),
            source: PipelineSource::Scheduled(DerivedStream::default()),
            nodes: vec![],
            edges: vec![],
            kind: config::meta::pipeline::PipelineKind::User,
        };

        // Cache the scheduled pipeline
        cache_scheduled_pipeline(&scheduled_pipeline).await;

        // Verify only the scheduled pipeline is cached
        let cached = get_scheduled_pipeline_from_cache(scheduled_id).await;
        assert!(cached.is_some());

        // Clean up
        remove_scheduled_pipeline_from_cache(scheduled_id).await;
    }

    #[test]
    fn test_key_not_exists_maps_to_not_found() {
        let err = PipelineError::from(infra::errors::Error::DbError(
            infra::errors::DbError::KeyNotExists("0".to_string()),
        ));

        assert!(matches!(err, PipelineError::NotFound(id) if id == "0"));
    }
}
