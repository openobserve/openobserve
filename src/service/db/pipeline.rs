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
use config::{
    get_config,
    meta::{
        pipeline::{components::PipelineSource, Pipeline, PipelineExecDFS},
        stream::StreamParams,
    },
};
use infra::pipeline::{self as infra_pipeline};

use crate::{
    common::infra::config::{STREAM_EXECUTABLE_PIPELINES, STREAM_PIPELINES},
    service::pipeline::{
        batch_execution::PipelineExecBatch,
        execution::{PipelineExecutionPlan, PipelineExt},
    },
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

/// Returns the pipeline_params by stream..
///
/// Used for pipeline execution.
pub async fn get_by_stream(stream_params: &StreamParams) -> Option<PipelineExecDFS> {
    if let Some(pl_params) = STREAM_PIPELINES.read().await.get(stream_params) {
        return Some(pl_params.clone());
    }
    let pipeline = infra_pipeline::get_by_stream(stream_params).await.ok();
    match pipeline {
        Some(pl) if pl.enabled => {
            let node_map = pl.get_node_map();
            match (
                pl.build_adjacency_list(&node_map),
                pl.register_functions().await,
            ) {
                (Ok(graph), Ok(vrl_map)) => Some((pl, node_map, graph, vrl_map)),
                _ => {
                    log::error!(
                        "[Pipeline] {}/{}/{}: Error prep pipeline execution parameters.",
                        pl.org,
                        pl.name,
                        pl.id,
                    );
                    None
                }
            }
        }
        _ => None,
    }
}

/// Returns the pipeline execution plan by stream..
///
/// Used for pipeline execution.
pub async fn get_pipeline_execution_plan(
    stream_params: &StreamParams,
) -> Option<PipelineExecutionPlan> {
    if let Some(pl_exec) = STREAM_EXECUTABLE_PIPELINES.read().await.get(stream_params) {
        return Some(pl_exec.clone());
    }
    let pipeline = infra_pipeline::get_by_stream(stream_params).await.ok();
    match pipeline {
        Some(pl) if pl.enabled => {
            if get_config().common.pipeline_execution_plan == "dfs" {
                let node_map = pl.get_node_map();
                match (
                    pl.build_adjacency_list(&node_map),
                    pl.register_functions().await,
                ) {
                    (Ok(graph), Ok(vrl_map)) => {
                        Some(PipelineExecutionPlan::DFS((pl, node_map, graph, vrl_map)))
                    }
                    _ => {
                        log::error!(
                            "[Pipeline] {}/{}/{}: Error prep pipeline execution parameters.",
                            pl.org,
                            pl.name,
                            pl.id,
                        );
                        None
                    }
                }
            } else {
                match PipelineExecBatch::new(&pl).await {
                    Ok(pl_exec) => Some(PipelineExecutionPlan::Batch(pl_exec)),
                    Err(e) => {
                        log::error!(
                            "[Pipeline]: failed to initialize PipelineExecBatch from Pipeline read from database, {}",
                            e
                        );
                        None
                    }
                }
            }
        }
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
    let cfg = get_config();
    let mut stream_pls = STREAM_PIPELINES.write().await;
    let mut stream_pl_exec = STREAM_EXECUTABLE_PIPELINES.write().await;
    for pipeline in pipelines.into_iter() {
        if pipeline.enabled {
            if let PipelineSource::Realtime(stream_params) = &pipeline.source {
                let node_map = pipeline.get_node_map();
                if let (Ok(graph), Ok(vrl_map)) = (
                    pipeline.build_adjacency_list(&node_map),
                    pipeline.register_functions().await,
                ) {
                    if cfg.common.pipeline_execution_plan == "dfs" {
                        stream_pl_exec.insert(
                            stream_params.clone(),
                            PipelineExecutionPlan::DFS((
                                pipeline.clone(),
                                node_map.clone(),
                                graph.clone(),
                                vrl_map.clone(),
                            )),
                        );
                    } else {
                        let pl_exec_batch = PipelineExecBatch::new(&pipeline).await?;
                        stream_pl_exec.insert(
                            stream_params.clone(),
                            PipelineExecutionPlan::Batch(pl_exec_batch),
                        );
                    }
                    stream_pls.insert(stream_params.clone(), (pipeline, node_map, graph, vrl_map));
                }
            }
        }
    }
    log::info!("[Pipeline] Cached with len: {}", stream_pls.len());
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
            STREAM_PIPELINES.write().await.remove(stream_params);
            STREAM_EXECUTABLE_PIPELINES
                .write()
                .await
                .remove(stream_params);
        }
        PipelineTableEvent::Add => {
            let node_map = pipeline.get_node_map();
            match (
                pipeline.build_adjacency_list(&node_map),
                pipeline.register_functions().await,
            ) {
                (Ok(graph), Ok(vrl_map)) => {
                    let mut stream_pls = STREAM_PIPELINES.write().await;
                    stream_pls.insert(
                        stream_params.clone(),
                        (
                            pipeline.clone(),
                            node_map.clone(),
                            graph.clone(),
                            vrl_map.clone(),
                        ),
                    );

                    let mut stream_pl_exec = STREAM_EXECUTABLE_PIPELINES.write().await;
                    if get_config().common.pipeline_execution_plan == "dfs" {
                        stream_pl_exec.insert(
                            stream_params.clone(),
                            PipelineExecutionPlan::DFS((
                                pipeline.clone(),
                                node_map,
                                graph,
                                vrl_map,
                            )),
                        );
                    } else {
                        match PipelineExecBatch::new(&pipeline).await {
                            Err(e) => {
                                log::error!(
                                    "[Pipeline] {}/{}/{}: Error converting to PipelineExecBatch: {}",
                                    pipeline.org,
                                    pipeline.name,
                                    pipeline.id,
                                    e
                                );
                            }
                            Ok(pl_exec_batch) => {
                                stream_pl_exec.insert(
                                    stream_params.clone(),
                                    PipelineExecutionPlan::Batch(pl_exec_batch),
                                );
                            }
                        };
                    }
                    log::info!("[Pipeline]: pipeline {} added to cache.", &pipeline.id);
                }
                _ => {
                    log::error!(
                        "[Pipeline] {}/{}/{}: Error adding to cache for failing to prepare for its params",
                        pipeline.org,
                        pipeline.name,
                        pipeline.id,
                    );
                }
            }
        }
    }
}

enum PipelineTableEvent {
    Add,
    Remove,
}
