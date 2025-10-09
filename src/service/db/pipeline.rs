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

use std::sync::Arc;

use config::{
    cluster::LOCAL_NODE,
    meta::{pipeline::Pipeline, stream::StreamParams},
};
use infra::{
    coordinator::pipelines::PIPELINES_WATCH_PREFIX,
    db,
    pipeline::{self as infra_pipeline},
};
use once_cell::sync::Lazy;

use crate::{
    common::infra::config::{
        PIPELINE_STREAM_MAPPING, SCHEDULED_PIPELINES, STREAM_EXECUTABLE_PIPELINES,
    },
    service::pipeline::batch_execution::ExecutablePipeline,
};

#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    // internal
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),
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
    Ok(infra_pipeline::list_streams_with_pipeline(org).await?)
}

/// Retrieve cached ExecutablePipeline struct that's ready for batch processing records by
/// StreamParams
///
/// Used for pipeline execution.
pub async fn get_executable_pipeline(stream_params: &StreamParams) -> Option<ExecutablePipeline> {
    STREAM_EXECUTABLE_PIPELINES
        .read()
        .await
        .get(stream_params)
        .cloned()
}

/// Returns the pipeline by id.
///
/// Used to get the pipeline associated with the ID when scheduled job is ran.
pub async fn get_by_stream(stream_params: &StreamParams) -> Option<Pipeline> {
    infra_pipeline::get_by_stream(stream_params).await.ok()
}

/// Returns the pipeline by id.
///
/// Used to get the pipeline associated with the ID when scheduled job is ran.
pub async fn get_by_id(pipeline_id: &str) -> Result<Pipeline, PipelineError> {
    Ok(infra_pipeline::get_by_id(pipeline_id).await?)
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

/// Finds the pipeline with the same source
///
/// Used to validate if a duplicate pipeline exists.
pub async fn get_with_same_source_stream(pipeline: &Pipeline) -> Result<Pipeline, PipelineError> {
    Ok(infra_pipeline::get_with_same_source_stream(pipeline).await?)
}

/// Lists all pipelines across all orgs.
pub async fn list() -> Result<Vec<Pipeline>, PipelineError> {
    Ok(infra_pipeline::list().await?)
}

/// Lists all pipelines for a given organization.
pub async fn list_by_org(org: &str) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(infra_pipeline::list_by_org(org).await?)
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
        Lazy::force(&crate::job::MMDB_INIT_NOTIFIER)
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
                            stream_exec_pl.insert(stream_params.clone(), exec_pl);
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
                let key = format!("{PIPELINES_WATCH_PREFIX}{}", &pipeline.id);
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
                match &pipeline.source {
                    config::meta::pipeline::components::PipelineSource::Realtime(stream_params) => {
                        let mut pipeline_stream_mapping_cache =
                            PIPELINE_STREAM_MAPPING.write().await;
                        let mut stream_exec_pl = STREAM_EXECUTABLE_PIPELINES.write().await;
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
                                    pipeline_stream_mapping_cache
                                        .insert(pipeline_id.to_string(), stream_params.clone());
                                    stream_exec_pl.insert(stream_params.clone(), exec_pl);
                                    log::info!(
                                        "[Pipeline::watch]: realtime pipeline {} added to cache.",
                                        &pipeline.id
                                    );
                                }
                            };
                        } else if let Some(removed) =
                            pipeline_stream_mapping_cache.remove(pipeline_id)
                            && stream_exec_pl.remove(&removed).is_some()
                        {
                            // remove pipeline from cache if the update is to disable
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
                if let Some(removed) = PIPELINE_STREAM_MAPPING.write().await.remove(pipeline_id)
                    && STREAM_EXECUTABLE_PIPELINES
                        .write()
                        .await
                        .remove(&removed)
                        .is_some()
                {
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
        pipeline::components::{DerivedStream, PipelineSource},
        stream::{StreamParams, StreamType},
    };

    use super::*;

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
        };

        // Cache the scheduled pipeline
        cache_scheduled_pipeline(&scheduled_pipeline).await;

        // Verify only the scheduled pipeline is cached
        let cached = get_scheduled_pipeline_from_cache(scheduled_id).await;
        assert!(cached.is_some());

        // Clean up
        remove_scheduled_pipeline_from_cache(scheduled_id).await;
    }
}
