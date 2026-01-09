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

use config::meta::{
    pipeline::{
        Pipeline,
        components::{NodeData, PipelineSource},
    },
    search::SearchEventType,
    stream::ListStreamParams,
    triggers::{Trigger, TriggerModule},
};

use super::db::{
    functions as db_functions,
    pipeline::{self, PipelineError},
    scheduler,
};
use crate::common::{
    meta::authz::Authz,
    utils::auth::{remove_ownership, set_ownership},
};

pub mod batch_execution;

/// Validates that no JavaScript functions are used in the pipeline.
/// JavaScript functions are restricted from pipelines in ALL organizations (including _meta).
/// JavaScript functions in _meta org are for SSO claim parsing only, not pipeline execution.
/// Pipelines can only use VRL functions for data transformation.
async fn validate_no_javascript_functions(pipeline: &Pipeline) -> Result<(), PipelineError> {
    for node in &pipeline.nodes {
        if let NodeData::Function(function_params) = &node.data {
            // Load the function to check its trans_type
            let function = db_functions::get(&pipeline.org, &function_params.name)
                .await
                .map_err(|e| {
                    PipelineError::InvalidPipeline(format!(
                        "Failed to load function '{}': {}",
                        function_params.name, e
                    ))
                })?;

            if function.is_js() {
                return Err(PipelineError::InvalidPipeline(format!(
                    "JavaScript functions cannot be used in pipelines. Function '{}' is a JavaScript function. Please use VRL functions instead.",
                    function_params.name
                )));
            }
        }
    }
    Ok(())
}

#[tracing::instrument(skip(pipeline))]
pub async fn save_pipeline(mut pipeline: Pipeline) -> Result<(), PipelineError> {
    // check if id is missing
    if pipeline.id.is_empty() {
        return Err(PipelineError::InvalidPipeline(
            "Missing pipeline ID".to_string(),
        ));
    }
    // check if another realtime pipeline with the same source stream already exists
    if let PipelineSource::Realtime(stream) = &pipeline.source
        && pipeline::list_streams_with_pipeline(&pipeline.org)
            .await
            .is_ok_and(|list| list.iter().any(|existing| existing == stream))
    {
        return Err(PipelineError::StreamInUse);
    }

    // validate pipeline
    if let Err(e) = pipeline.validate() {
        return Err(PipelineError::InvalidPipeline(e.to_string()));
    }

    // validate no JavaScript functions in pipeline
    validate_no_javascript_functions(&pipeline).await?;

    // Save DerivedStream details if there's any
    if let PipelineSource::Scheduled(derived_stream) = &mut pipeline.source {
        derived_stream.query_condition.search_event_type = Some(SearchEventType::DerivedStream);
        derived_stream.org_id = pipeline.org.clone();
        // save derived_stream to triggers table
        if let Err(e) = super::alerts::derived_streams::save(
            derived_stream.clone(),
            &pipeline.name,
            &pipeline.id,
            true,
        )
        .await
        {
            return Err(PipelineError::InvalidDerivedStream(e.to_string()));
        }
    }

    if let Err(e) = pipeline::set(&pipeline).await {
        log::error!("Failed to save pipeline: {e}");
        return Err(e);
    }
    set_ownership(&pipeline.org, "pipelines", Authz::new(&pipeline.id)).await;
    Ok(())
}

#[tracing::instrument(skip(pipeline))]
pub async fn update_pipeline(mut pipeline: Pipeline) -> Result<(), PipelineError> {
    let Ok(existing_pipeline) = pipeline::get_by_id(&pipeline.id).await else {
        return Err(PipelineError::NotFound(pipeline.id));
    };

    if existing_pipeline == pipeline {
        return Ok(());
    }

    // check version
    if existing_pipeline.version != pipeline.version {
        return Err(PipelineError::Modified(pipeline.id));
    }

    // validate pipeline
    pipeline
        .validate()
        .map_err(|e| PipelineError::InvalidPipeline(e.to_string()))?;

    // validate no JavaScript functions in pipeline
    validate_no_javascript_functions(&pipeline).await?;

    // additional checks when the source is changed
    let prev_source_stream = if existing_pipeline.source != pipeline.source {
        // check if the new source exists in another pipeline
        if pipeline::get_with_same_source_stream(&pipeline)
            .await
            .is_ok()
        {
            return Err(PipelineError::StreamInUse);
        }
        match existing_pipeline.source {
            // realtime: remove prev. src. stream_params from cache
            PipelineSource::Realtime(stream_params) => Some(stream_params),
            // scheduled: delete prev. trigger if source has changed
            PipelineSource::Scheduled(derived_stream) => {
                if pipeline.source.is_realtime() {
                    // source changed, delete prev. trigger
                    if let Err(error) = super::alerts::derived_streams::delete(
                        &derived_stream,
                        &existing_pipeline.name,
                        &existing_pipeline.id,
                    )
                    .await
                    {
                        return Err(PipelineError::DeleteDerivedStream(error.to_string()));
                    }
                }
                None
            }
        }
    } else {
        None
    };

    // update the pipeline version
    pipeline.version += 1;

    // Save DerivedStream details if there's any
    if let PipelineSource::Scheduled(derived_stream) = &mut pipeline.source {
        derived_stream.query_condition.search_event_type = Some(SearchEventType::DerivedStream);
        if let Err(e) = super::alerts::derived_streams::save(
            derived_stream.clone(),
            &pipeline.name,
            &pipeline.id,
            true,
        )
        .await
        {
            return Err(PipelineError::InvalidDerivedStream(e.to_string()));
        }
    }

    pipeline::update(&pipeline, prev_source_stream).await?;
    Ok(())
}

#[tracing::instrument]
pub async fn list_pipelines(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(pipeline::list_by_org(org_id)
        .await?
        .into_iter()
        .filter(|pipeline| {
            permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("pipeline:{}", &pipeline.id))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("pipeline:_all_{org_id}"))
        })
        .collect())
}

#[tracing::instrument]
pub async fn list_pipeline_triggers(org_id: &str) -> Result<Vec<Trigger>, PipelineError> {
    Ok(
        scheduler::list_by_org(org_id, Some(TriggerModule::DerivedStream))
            .await
            .unwrap_or_default(),
    )
}

#[tracing::instrument]
pub async fn list_streams_with_pipeline(org: &str) -> Result<ListStreamParams, PipelineError> {
    let list = pipeline::list_streams_with_pipeline(org).await?;
    Ok(ListStreamParams { list })
}

#[tracing::instrument]
pub async fn enable_pipeline(
    org_id: &str,
    pipeline_id: &str,
    enable: bool,
    starts_from_now: bool,
) -> Result<(), PipelineError> {
    let Ok(mut pipeline) = pipeline::get_by_id(pipeline_id).await else {
        return Err(PipelineError::NotFound(pipeline_id.to_string()));
    };

    pipeline.enabled = enable;
    // add or remove trigger if it's a scheduled pipeline
    if let PipelineSource::Scheduled(derived_stream) = &mut pipeline.source {
        derived_stream.query_condition.search_event_type = Some(SearchEventType::DerivedStream);
        if enable {
            if starts_from_now {
                super::alerts::derived_streams::delete(derived_stream, &pipeline.name, pipeline_id)
                    .await
                    .map_err(|e| PipelineError::DeleteDerivedStream(e.to_string()))?;
                super::alerts::derived_streams::save(
                    derived_stream.clone(),
                    &pipeline.name,
                    pipeline_id,
                    false,
                )
                .await
                .map_err(|e| PipelineError::InvalidDerivedStream(e.to_string()))?;
            } else {
                super::alerts::derived_streams::save(
                    derived_stream.clone(),
                    &pipeline.name,
                    pipeline_id,
                    false,
                )
                .await
                .map_err(|e| PipelineError::InvalidDerivedStream(e.to_string()))?;
            }
        }
    }

    pipeline::update(&pipeline, None).await?;
    Ok(())
}

#[tracing::instrument]
pub async fn delete_pipeline(pipeline_id: &str) -> Result<(), PipelineError> {
    let Ok(existing_pipeline) = pipeline::get_by_id(pipeline_id).await else {
        return Err(PipelineError::NotFound(pipeline_id.to_string()));
    };

    // delete DerivedStream details if there's any
    if let PipelineSource::Scheduled(derived_stream) = existing_pipeline.source
        && let Err(error) = super::alerts::derived_streams::delete(
            &derived_stream,
            &existing_pipeline.name,
            &existing_pipeline.id,
        )
        .await
    {
        return Err(PipelineError::DeleteDerivedStream(error.to_string()));
    }

    // Delete all backfill jobs associated with this pipeline
    if let Err(error) = super::alerts::backfill::delete_backfill_jobs_by_pipeline(
        &existing_pipeline.org,
        pipeline_id,
    )
    .await
    {
        log::error!(
            "[PIPELINE] Failed to delete backfill jobs for pipeline {}: {}",
            pipeline_id,
            error
        );
        // Don't fail the pipeline deletion if backfill job deletion fails
        // Just log the error and continue
    }

    pipeline::delete(pipeline_id).await?;
    remove_ownership(
        &existing_pipeline.org,
        "pipelines",
        Authz::new(&existing_pipeline.id),
    )
    .await;
    Ok(())
}
