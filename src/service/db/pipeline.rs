// Copyright 2024 OpenObserve Inc.
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

// use std::sync::Arc;

use anyhow::Result;
use config::meta::{
    pipeline::{components::PipelineSource, Pipeline},
    stream::StreamParams,
};
use infra::pipeline::{self as infra_pipeline};

use crate::{
    common::infra::config::STREAM_EXECUTABLE_PIPELINES,
    service::pipeline::batch_execution::ExecutablePipeline,
};

/// Stores a new pipeline to database.
///
/// Pipeline validation should be handled by the caller.
pub async fn set(pipeline: &Pipeline) -> Result<()> {
    if let Err(e) = infra_pipeline::put(pipeline).await {
        log::error!("Error saving pipeline: {}", e);
        return Err(anyhow::anyhow!("Error saving pipeline: {}", e));
    }

    // save to cache if realtime pipeline
    if let PipelineSource::Realtime(stream_params) = &pipeline.source {
        if pipeline.enabled {
            update_cache(stream_params, pipeline, PipelineTableEvent::Add).await;
        }
    }

    Ok(())
}

/// Updates a pipeline entry with the sane values.
///
/// Pipeline validation should be handled by the caller.
pub async fn update(pipeline: &Pipeline) -> Result<()> {
    if let Err(e) = infra_pipeline::update(pipeline).await {
        log::error!("Error updating pipeline: {}", e);
        return Err(anyhow::anyhow!("Error updating pipeline: {}", e));
    }

    // save to cache if realtime pipeline
    if let PipelineSource::Realtime(stream_params) = &pipeline.source {
        let db_event = if pipeline.enabled {
            PipelineTableEvent::Add
        } else {
            PipelineTableEvent::Remove
        };
        update_cache(stream_params, pipeline, db_event).await;
    }

    Ok(())
}

/// Returns all streams with existing pipelines.
pub async fn list_streams_with_pipeline(org: &str) -> Result<Vec<StreamParams>> {
    infra_pipeline::list_streams_with_pipeline(org)
        .await
        .map_err(|e| {
            log::error!("Error getting streams with pipeline for org({org}): {}", e);
            anyhow::anyhow!("Error getting streams with pipeline for org({org}): {}", e)
        })
}

/// Transform the initialized and enabled pipeline into ExecutablePipeline struct that's ready for
/// batch processing records.
///
/// Used for pipeline execution.
pub async fn get_executable_pipeline(stream_params: &StreamParams) -> Option<ExecutablePipeline> {
    if let Some(exec_pl) = STREAM_EXECUTABLE_PIPELINES.read().await.get(stream_params) {
        return Some(exec_pl.clone());
    }
    let pipeline = infra_pipeline::get_by_stream(stream_params).await.ok();
    match pipeline {
        Some(pl) if pl.enabled => match ExecutablePipeline::new(&pl).await {
            Ok(exec_pl) => {
                let mut stream_exec_pl_cache = STREAM_EXECUTABLE_PIPELINES.write().await;
                stream_exec_pl_cache.insert(stream_params.to_owned(), exec_pl.clone());
                drop(stream_exec_pl_cache);
                Some(exec_pl)
            }
            Err(e) => {
                log::error!(
                    "[Pipeline]: failed to initialize ExecutablePipeline from Pipeline read from database, {}",
                    e
                );
                None
            }
        },
        _ => None,
    }
}

/// Returns the pipeline by id.
///
/// Used to get the pipeline associated with the ID when scheduled job is ran.
pub async fn get_by_id(pipeline_id: &str) -> Result<Pipeline> {
    infra_pipeline::get_by_id(pipeline_id).await.map_err(|e| {
        log::error!("Error getting pipeline with ID({pipeline_id}): {}", e);
        anyhow::anyhow!("Error getting pipeline with ID({pipeline_id}): {}", e)
    })
}

/// Finds the pipeline with the same source
///
/// Used to validate if a duplicate pipeline exists.
pub async fn get_with_same_source_stream(pipeline: &Pipeline) -> Result<Pipeline> {
    infra_pipeline::get_with_same_source_stream(pipeline)
        .await
        .map_err(|_| anyhow::anyhow!("No pipeline with the same source found"))
}

/// Lists all pipelines across all orgs.
pub async fn list() -> Result<Vec<Pipeline>> {
    infra_pipeline::list().await.map_err(|e| {
        log::debug!("Error listing pipelines for all orgs: {}", e);
        anyhow::anyhow!("Error listing pipelines for all orgs: {}", e)
    })
}

/// Lists all pipelines for a given organization.
pub async fn list_by_org(org: &str) -> Result<Vec<Pipeline>> {
    infra_pipeline::list_by_org(org).await.map_err(|e| {
        log::debug!("Error listing pipelines for org({org}): {}", e);
        anyhow::anyhow!("Error listing pipelines for org({org}): {}", e)
    })
}

/// Deletes a pipeline by ID.
pub async fn delete(pipeline_id: &str) -> Result<()> {
    match infra_pipeline::delete(pipeline_id).await {
        Err(e) => {
            log::error!("Error deleting pipeline with ID({pipeline_id}): {}", e);
            return Err(anyhow::anyhow!(
                "Error deleting pipeline with ID({pipeline_id}): {}",
                e
            ));
        }
        Ok(pipeline) => {
            // remove from cache if realtime pipeline
            if let PipelineSource::Realtime(stream_params) = &pipeline.source {
                update_cache(stream_params, &pipeline, PipelineTableEvent::Remove).await;
            }
        }
    }

    Ok(())
}

/// Preload all enabled pipelines into the cache at startup.
pub async fn cache() -> Result<(), anyhow::Error> {
    let pipelines = list().await?;
    let mut stream_exec_pl = STREAM_EXECUTABLE_PIPELINES.write().await;
    for pipeline in pipelines.into_iter() {
        if pipeline.enabled {
            if let PipelineSource::Realtime(stream_params) = &pipeline.source {
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
                        stream_exec_pl.insert(stream_params.clone(), exec_pl);
                    }
                };
            }
        }
    }
    log::info!("[Pipeline] Cached with len: {}", stream_exec_pl.len());
    Ok(())
}

/// Update STREAM_PIPELINES cache for realtime pipelines
async fn update_cache(
    stream_params: &StreamParams,
    pipeline: &Pipeline,
    event: PipelineTableEvent,
) {
    match event {
        PipelineTableEvent::Remove => {
            log::info!("[Pipeline]: pipeline {} removed from cache.", &pipeline.id);
            STREAM_EXECUTABLE_PIPELINES
                .write()
                .await
                .remove(stream_params);
        }
        PipelineTableEvent::Add => {
            let mut stream_pl_exec = STREAM_EXECUTABLE_PIPELINES.write().await;
            match ExecutablePipeline::new(pipeline).await {
                Err(e) => {
                    log::error!(
                        "[Pipeline] {}/{}/{}: Error initializing pipeline into ExecutablePipeline when updating cache: {}",
                        pipeline.org,
                        pipeline.name,
                        pipeline.id,
                        e
                    );
                }
                Ok(exec_pl) => {
                    stream_pl_exec.insert(stream_params.clone(), exec_pl);
                }
            };
            log::info!("[Pipeline]: pipeline {} added to cache.", &pipeline.id);
        }
    }
}

enum PipelineTableEvent {
    Add,
    Remove,
}
