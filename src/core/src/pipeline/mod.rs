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

use ::db::{
    authz::{remove_ownership, set_ownership},
    functions as db_functions, scheduler,
};
use common::meta::authz::Authz;
use config::meta::{
    pipeline::{
        Pipeline, PipelineKind,
        components::{DerivedStream, NodeData, PipelineSource},
    },
    search::SearchEventType,
    stream::{ListStreamParams, StreamParams},
    triggers::{Trigger, TriggerModule, TriggerStatus},
};

use self::{db as pipeline, db::PipelineError};
use crate::authz::{Refusal, WriteCheck};

pub mod batch_execution;
pub mod db;

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

/// Fills a blank org on the realtime source and every Stream/Query node with the pipeline's org.
fn default_node_orgs(pipeline: &mut Pipeline) {
    let org = pipeline.org.clone();
    if let PipelineSource::Realtime(stream) = &mut pipeline.source
        && stream.org_id.is_empty()
    {
        stream.org_id = org.clone().into();
    }
    // validate() rebuilds source from the first node, discarding the line above.
    for node in pipeline.nodes.iter_mut() {
        match &mut node.data {
            NodeData::Stream(stream) if stream.org_id.is_empty() => {
                stream.org_id = org.clone().into();
            }
            NodeData::Query(derived_stream) if derived_stream.org_id.is_empty() => {
                derived_stream.org_id = org.clone();
            }
            _ => {}
        }
    }
}

/// A node's org is where runs read and write, so it must be the request's org.
fn refuse_cross_org_node(pipeline: &Pipeline) -> Result<(), PipelineError> {
    match pipeline.cross_org_refusal() {
        Some(refusal) => Err(PipelineError::InvalidPipeline(refusal)),
        None => Ok(()),
    }
}

/// The scheduled source to save; a run searches its org, so it is the pipeline's org.
fn bind_scheduled_source(pipeline: &mut Pipeline) -> Option<DerivedStream> {
    let PipelineSource::Scheduled(derived_stream) = &mut pipeline.source else {
        return None;
    };
    derived_stream.query_condition.search_event_type = Some(SearchEventType::DerivedStream);
    derived_stream.org_id = pipeline.org.clone();
    Some(derived_stream.clone())
}

/// The bound scheduled source with its trigger's schedule, once every check on it passed.
async fn validated_scheduled_source(
    pipeline: &mut Pipeline,
) -> Result<Option<DerivedStream>, PipelineError> {
    let Some(mut derived_stream) = bind_scheduled_source(pipeline) else {
        return Ok(None);
    };
    super::alerts::derived_streams::validate(
        &mut derived_stream,
        &pipeline.name,
        &pipeline.id,
        true,
    )
    .await
    .map_err(|e| PipelineError::InvalidDerivedStream(e.to_string()))?;
    Ok(Some(derived_stream))
}

/// A worker writes its cursor when a run ends, so a row moved during the run repeats a range.
async fn refuse_rename_during_run(
    stored: Option<&Pipeline>,
    pipeline: &Pipeline,
) -> Result<(), PipelineError> {
    let Some(stored) = stored else {
        return Ok(());
    };
    let (Some(stored_source), Some(stored_key), Some(new_key)) = (
        stored.get_derived_stream(),
        stored.scheduler_module_key(),
        pipeline.scheduler_module_key(),
    ) else {
        return Ok(());
    };
    if stored_key != new_key
        && let Ok(trigger) = scheduler::get(
            &stored_source.org_id,
            TriggerModule::DerivedStream,
            &stored_key,
        )
        .await
        && trigger.status == TriggerStatus::Processing
    {
        return Err(PipelineError::RunInProgress(pipeline.id.clone()));
    }
    Ok(())
}

async fn delete_stored_trigger(
    stored: &Pipeline,
    stored_source: &DerivedStream,
) -> Result<(), PipelineError> {
    super::alerts::derived_streams::delete(stored_source, &stored.name, &stored.id)
        .await
        .map_err(trigger_write_error)
}

/// The request was valid, and the pipeline row may already be written, so this is a server error.
fn trigger_write_error(error: anyhow::Error) -> PipelineError {
    PipelineError::InfraError(infra::errors::Error::Message(error.to_string()))
}

/// Moves the stored pipeline's trigger to the new key; true when an upsert must still follow.
async fn move_trigger(
    stored: Option<&Pipeline>,
    pipeline: &Pipeline,
) -> Result<bool, PipelineError> {
    let Some(stored) = stored else {
        return Ok(true);
    };
    let (Some(stored_source), Some(stored_key)) =
        (stored.get_derived_stream(), stored.scheduler_module_key())
    else {
        return Ok(true);
    };
    let (Some(source), Some(new_key)) = (
        pipeline.get_derived_stream(),
        pipeline.scheduler_module_key(),
    ) else {
        delete_stored_trigger(stored, &stored_source).await?;
        return Ok(false);
    };
    if new_key == stored_key {
        return Ok(true);
    }
    // A second row would run the pipeline twice, and an UPDATE of the key cannot change the org.
    if source.org_id != stored_source.org_id
        || scheduler::exists(&source.org_id, TriggerModule::DerivedStream, &new_key).await
    {
        delete_stored_trigger(stored, &stored_source).await?;
        return Ok(true);
    }
    if scheduler::rename_key(
        &stored_source.org_id,
        TriggerModule::DerivedStream,
        &stored_key,
        &new_key,
    )
    .await?
    {
        // An upsert gives the row a new next run, which an unchanged schedule must not lose.
        // A re-enable needs it: the disabled row was pushed days ahead.
        return Ok(source.trigger_condition != stored_source.trigger_condition
            || source.tz_offset != stored_source.tz_offset
            || (pipeline.enabled && !stored.enabled));
    }
    // A run that began after the refusal holds the row; handle_derived_stream_triggers moves it.
    Ok(!scheduler::exists(
        &stored_source.org_id,
        TriggerModule::DerivedStream,
        &stored_key,
    )
    .await)
}

/// The trigger must not exist under a new name before the pipeline row has that name.
async fn write_trigger(
    stored: Option<&Pipeline>,
    pipeline: &Pipeline,
    validated_source: Option<DerivedStream>,
) -> Result<(), PipelineError> {
    if move_trigger(stored, pipeline).await?
        && let Some(derived_stream) = validated_source
    {
        super::alerts::derived_streams::upsert_trigger(
            &derived_stream,
            &pipeline.name,
            &pipeline.id,
        )
        .await
        .map_err(trigger_write_error)?;
    }
    Ok(())
}

/// A trigger write can fail after the pipeline write, and a retry of the same body lands here.
async fn repair_missing_trigger(pipeline: &mut Pipeline) -> Result<(), PipelineError> {
    let (Some(source), Some(key)) = (
        pipeline.get_derived_stream(),
        pipeline.scheduler_module_key(),
    ) else {
        return Ok(());
    };
    if !pipeline.enabled
        || scheduler::exists(&source.org_id, TriggerModule::DerivedStream, &key).await
    {
        return Ok(());
    }
    // A row under an older key may be running, and it moves to the current key by itself.
    let suffix = format!("/{}", pipeline.id);
    let rows = scheduler::list_by_org(&source.org_id, Some(TriggerModule::DerivedStream)).await?;
    if rows.iter().any(|row| row.module_key.ends_with(&suffix)) {
        return Ok(());
    }
    let validated_source = validated_scheduled_source(pipeline).await?;
    write_trigger(None, pipeline, validated_source).await
}

async fn run_check(
    check: Option<&dyn WriteCheck<Pipeline>>,
    pipeline: &Pipeline,
) -> Result<(), PipelineError> {
    match check {
        Some(check) => check
            .check(pipeline)
            .await
            .map_err(|response| PipelineError::Refused(Refusal::new(response))),
        None => Ok(()),
    }
}

/// Sources persisted before they were qualified carry an empty org, which means the
/// pipeline's own org: without this they escape the guard forever.
fn qualified_org<'a>(stream: &'a StreamParams, org: &'a str) -> &'a str {
    if stream.org_id.is_empty() {
        org
    } else {
        stream.org_id.as_ref()
    }
}

#[tracing::instrument(skip(pipeline))]
pub async fn save_pipeline(pipeline: Pipeline) -> Result<(), PipelineError> {
    save_pipeline_checked(pipeline, None).await
}

/// [`save_pipeline`], running `check` after every check of its own and before any write.
#[tracing::instrument(skip(pipeline, check))]
pub async fn save_pipeline_checked(
    mut pipeline: Pipeline,
    check: Option<&dyn WriteCheck<Pipeline>>,
) -> Result<(), PipelineError> {
    // check if id is missing
    if pipeline.id.is_empty() {
        return Err(PipelineError::InvalidPipeline(
            "Missing pipeline ID".to_string(),
        ));
    }
    default_node_orgs(&mut pipeline);

    // validate pipeline
    if let Err(e) = pipeline.validate() {
        return Err(PipelineError::InvalidPipeline(e.to_string()));
    }
    refuse_cross_org_node(&pipeline)?;

    // Runs after validate(), which rebuilds source from the first node: checking
    // pipeline.source before that compares a value which is never persisted.
    // Evaluation pipelines: any number allowed, no exclusivity check
    if pipeline.is_user()
        && let PipelineSource::Realtime(stream) = &pipeline.source
        && pipeline::list_streams_with_pipeline(&pipeline.org)
            .await
            .is_ok_and(|list| {
                list.iter().any(|existing| {
                    existing.stream_name == stream.stream_name
                        && existing.stream_type == stream.stream_type
                        && qualified_org(existing, &pipeline.org)
                            == qualified_org(stream, &pipeline.org)
                })
            })
    {
        return Err(PipelineError::StreamInUse);
    }

    // validate no JavaScript functions in pipeline
    validate_no_javascript_functions(&pipeline).await?;
    run_check(check, &pipeline).await?;

    let mut validated_source = validated_scheduled_source(&mut pipeline).await?;
    let stored = pipeline::get_by_id(&pipeline.id).await.ok();
    refuse_rename_during_run(stored.as_ref(), &pipeline).await?;

    // A new pipeline has no row to move, so its failed trigger write must leave no pipeline behind.
    if stored.is_none()
        && let Some(derived_stream) = validated_source.take()
    {
        super::alerts::derived_streams::upsert_trigger(
            &derived_stream,
            &pipeline.name,
            &pipeline.id,
        )
        .await
        .map_err(trigger_write_error)?;
    }

    if let Err(e) = pipeline::set(&pipeline).await {
        log::error!("Failed to save pipeline: {e}");
        return Err(e);
    }
    set_ownership(&pipeline.org, "pipelines", Authz::new(&pipeline.id)).await;
    write_trigger(stored.as_ref(), &pipeline, validated_source).await
}

#[tracing::instrument(skip(pipeline))]
pub async fn save_user_pipeline(pipeline: Pipeline) -> Result<(), PipelineError> {
    save_user_pipeline_checked(pipeline, None).await
}

/// [`save_user_pipeline`], running `check` after every check of its own and before any write.
#[tracing::instrument(skip(pipeline, check))]
pub async fn save_user_pipeline_checked(
    mut pipeline: Pipeline,
    check: Option<&dyn WriteCheck<Pipeline>>,
) -> Result<(), PipelineError> {
    if let Ok(existing_pipeline) = pipeline::get_by_id(&pipeline.id).await
        && (existing_pipeline.org != pipeline.org || !existing_pipeline.is_user())
    {
        return Err(PipelineError::NotFound(pipeline.id));
    }

    pipeline.kind = PipelineKind::User;
    save_pipeline_checked(pipeline, check).await
}

#[tracing::instrument(skip(pipeline))]
pub async fn update_pipeline(pipeline: Pipeline) -> Result<(), PipelineError> {
    update_pipeline_checked(pipeline, None).await
}

/// [`update_pipeline`], running `check` after every check of its own and before any write.
#[tracing::instrument(skip(pipeline, check))]
pub async fn update_pipeline_checked(
    mut pipeline: Pipeline,
    check: Option<&dyn WriteCheck<Pipeline>>,
) -> Result<(), PipelineError> {
    default_node_orgs(&mut pipeline);

    let Ok(mut existing_pipeline) = pipeline::get_by_id(&pipeline.id).await else {
        return Err(PipelineError::NotFound(pipeline.id));
    };
    // Both sides, or a legacy row's empty org reads as a source change on every edit.
    default_node_orgs(&mut existing_pipeline);

    // A retry after a failed trigger write carries the version from before its first attempt.
    let client_version = std::mem::replace(&mut pipeline.version, existing_pipeline.version);
    if existing_pipeline == pipeline {
        return repair_missing_trigger(&mut pipeline).await;
    }

    // check version
    if existing_pipeline.version != client_version {
        return Err(PipelineError::Modified(pipeline.id));
    }

    // validate pipeline
    pipeline
        .validate()
        .map_err(|e| PipelineError::InvalidPipeline(e.to_string()))?;
    refuse_cross_org_node(&pipeline)?;

    // validate no JavaScript functions in pipeline
    validate_no_javascript_functions(&pipeline).await?;

    // additional checks when the source is changed
    let source_changed = existing_pipeline.source != pipeline.source;
    // check if the new source exists in another pipeline
    if source_changed
        && pipeline::get_with_same_source_stream(&pipeline)
            .await
            .is_ok()
    {
        return Err(PipelineError::StreamInUse);
    }
    run_check(check, &pipeline).await?;

    let validated_source = validated_scheduled_source(&mut pipeline).await?;
    refuse_rename_during_run(Some(&existing_pipeline), &pipeline).await?;

    // realtime: remove prev. src. stream_params from cache
    let prev_source_stream = match &existing_pipeline.source {
        PipelineSource::Realtime(stream_params) if source_changed => Some(stream_params.clone()),
        _ => None,
    };

    // update the pipeline version
    pipeline.version += 1;

    pipeline::update(&pipeline, prev_source_stream).await?;

    write_trigger(Some(&existing_pipeline), &pipeline, validated_source).await
}

#[tracing::instrument(skip(pipeline))]
pub async fn update_user_pipeline(org_id: &str, pipeline: Pipeline) -> Result<(), PipelineError> {
    update_user_pipeline_checked(org_id, pipeline, None).await
}

/// [`update_user_pipeline`], running `check` after every check of its own and before any write.
#[tracing::instrument(skip(pipeline, check))]
pub async fn update_user_pipeline_checked(
    org_id: &str,
    mut pipeline: Pipeline,
    check: Option<&dyn WriteCheck<Pipeline>>,
) -> Result<(), PipelineError> {
    get_user_pipeline(org_id, &pipeline.id).await?;
    pipeline.kind = PipelineKind::User;
    update_pipeline_checked(pipeline, check).await
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
                    .contains(&format!("pipeline:{}", pipeline.id))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("pipeline:_all_{org_id}"))
        })
        .collect())
}

#[tracing::instrument]
pub async fn list_user_pipelines(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Pipeline>, PipelineError> {
    Ok(pipeline::list_by_org(org_id)
        .await?
        .into_iter()
        .filter(|pipeline| is_user_pipeline_visible(pipeline, org_id, permitted.as_ref()))
        .collect())
}

pub(crate) fn is_user_pipeline_visible(
    pipeline: &Pipeline,
    org_id: &str,
    permitted: Option<&Vec<String>>,
) -> bool {
    if !pipeline.is_user() {
        return false;
    }

    match permitted {
        Some(permitted) => {
            permitted.contains(&format!("pipeline:{}", pipeline.id))
                || permitted.contains(&format!("pipeline:_all_{org_id}"))
        }
        None => true,
    }
}

#[tracing::instrument]
pub async fn get_user_pipeline(org_id: &str, pipeline_id: &str) -> Result<Pipeline, PipelineError> {
    let pipeline = pipeline::get_by_id(pipeline_id).await?;
    if pipeline.org != org_id || !pipeline.is_user() {
        return Err(PipelineError::NotFound(pipeline_id.to_string()));
    }
    Ok(pipeline)
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
    if enable {
        refuse_cross_org_node(&pipeline)?;
    }

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
pub async fn enable_user_pipeline(
    org_id: &str,
    pipeline_id: &str,
    enable: bool,
    starts_from_now: bool,
) -> Result<(), PipelineError> {
    get_user_pipeline(org_id, pipeline_id).await?;
    enable_pipeline(org_id, pipeline_id, enable, starts_from_now).await
}

#[tracing::instrument]
pub async fn delete_pipeline(pipeline_id: &str) -> Result<(), PipelineError> {
    let Ok(existing_pipeline) = pipeline::get_by_id(pipeline_id).await else {
        return Err(PipelineError::NotFound(pipeline_id.to_string()));
    };
    delete_listed_pipeline(existing_pipeline).await
}

/// A row under an older name cannot heal once its pipeline is gone, and only logs errors.
async fn delete_older_triggers(org: &str, pipeline_id: &str) {
    let suffix = format!("/{pipeline_id}");
    let rows = match scheduler::list_by_org(org, Some(TriggerModule::DerivedStream)).await {
        Ok(rows) => rows,
        Err(error) => {
            log::warn!("failed to list triggers of deleted pipeline {pipeline_id}: {error}");
            return;
        }
    };
    for row in rows.iter().filter(|row| row.module_key.ends_with(&suffix)) {
        if let Err(error) =
            scheduler::delete(org, TriggerModule::DerivedStream, &row.module_key).await
        {
            log::warn!("failed to delete stale trigger {}: {error}", row.module_key);
        }
    }
}

/// `delete_pipeline` for a pipeline the caller already read, such as from a primary listing.
pub async fn delete_listed_pipeline(existing_pipeline: Pipeline) -> Result<(), PipelineError> {
    let pipeline_id = existing_pipeline.id.as_str();
    // delete DerivedStream details if there's any
    if let PipelineSource::Scheduled(derived_stream) = existing_pipeline.source {
        if let Err(error) = super::alerts::derived_streams::delete(
            &derived_stream,
            &existing_pipeline.name,
            &existing_pipeline.id,
        )
        .await
        {
            return Err(PipelineError::DeleteDerivedStream(error.to_string()));
        }
        delete_older_triggers(&derived_stream.org_id, pipeline_id).await;
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

#[tracing::instrument]
pub async fn delete_user_pipeline(org_id: &str, pipeline_id: &str) -> Result<(), PipelineError> {
    get_user_pipeline(org_id, pipeline_id).await?;
    delete_pipeline(pipeline_id).await
}

#[cfg(test)]
mod tests {
    use config::meta::{
        pipeline::{
            Pipeline, PipelineKind,
            components::{DerivedStream, NodeData, PipelineSource},
        },
        stream::StreamParams,
    };

    use super::is_user_pipeline_visible;

    fn test_pipeline(id: &str, kind: PipelineKind) -> Pipeline {
        Pipeline {
            id: id.to_string(),
            version: 1,
            enabled: true,
            org: "test_org".to_string(),
            name: id.to_string(),
            description: String::new(),
            source: PipelineSource::Realtime(StreamParams::default()),
            nodes: vec![],
            edges: vec![],
            kind,
        }
    }

    #[test]
    fn test_is_user_pipeline_visible_excludes_evaluation_pipelines() {
        let user_pipeline = test_pipeline("user_pipeline", PipelineKind::User);
        let evaluation_pipeline = test_pipeline("evaluation_pipeline", PipelineKind::Evaluation);

        assert!(is_user_pipeline_visible(&user_pipeline, "test_org", None));
        assert!(!is_user_pipeline_visible(
            &evaluation_pipeline,
            "test_org",
            None
        ));
    }

    #[test]
    fn test_is_user_pipeline_visible_applies_permissions() {
        let pipeline = test_pipeline("user_pipeline", PipelineKind::User);

        assert!(is_user_pipeline_visible(
            &pipeline,
            "test_org",
            Some(&vec!["pipeline:user_pipeline".to_string()])
        ));
        assert!(is_user_pipeline_visible(
            &pipeline,
            "test_org",
            Some(&vec!["pipeline:_all_test_org".to_string()])
        ));
        assert!(!is_user_pipeline_visible(
            &pipeline,
            "test_org",
            Some(&vec!["pipeline:other_pipeline".to_string()])
        ));
    }

    #[test]
    fn test_is_user_pipeline_visible_keeps_scheduled_user_pipelines() {
        let mut pipeline = test_pipeline("scheduled_pipeline", PipelineKind::User);
        pipeline.source = PipelineSource::Scheduled(DerivedStream::default());

        assert!(is_user_pipeline_visible(&pipeline, "test_org", None));
    }

    struct Unreached;

    #[async_trait::async_trait]
    impl crate::authz::WriteCheck<Pipeline> for Unreached {
        async fn check(&self, _: &Pipeline) -> Result<(), axum::response::Response> {
            panic!("the write check must run only after every check of the save's own");
        }
    }

    #[tokio::test]
    async fn the_save_s_own_errors_answer_before_the_write_check() {
        use super::{PipelineError, save_user_pipeline_checked, update_user_pipeline_checked};

        let mut invalid: Pipeline = serde_json::from_value(serde_json::json!({
            "pipeline_id": "write-check-pipeline",
            "name": "",
            "nodes": [],
            "edges": []
        }))
        .unwrap();
        invalid.org = "write_check_org".to_string();
        let saved = save_user_pipeline_checked(invalid.clone(), Some(&Unreached)).await;
        assert!(
            matches!(saved, Err(PipelineError::InvalidPipeline(_))),
            "{saved:?}"
        );

        let updated =
            update_user_pipeline_checked("write_check_org", invalid, Some(&Unreached)).await;
        assert!(
            !matches!(updated, Ok(()) | Err(PipelineError::Refused(_))),
            "{updated:?}"
        );
    }

    /// The meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.unwrap();
            infra::table::migrate().await.unwrap();
        })
        .await;
        true
    }

    fn scheduled_pipeline(id: &str, org: &str, source_org: &str, dest_org: &str) -> Pipeline {
        let mut pipeline: Pipeline = serde_json::from_value(serde_json::json!({
            "pipeline_id": id,
            "name": id,
            "nodes": [
                {
                    "id": "src",
                    "data": {
                        "node_type": "query",
                        "org_id": source_org,
                        "stream_type": "logs",
                        "query_condition": {"type": "sql", "sql": "SELECT _timestamp FROM src_stream"},
                        "trigger_condition": {"period": 5, "frequency": 5}
                    },
                    "position": {"x": 0.0, "y": 0.0},
                    "io_type": "input"
                },
                {
                    "id": "dst",
                    "data": {
                        "node_type": "stream",
                        "org_id": dest_org,
                        "stream_name": "dst_stream",
                        "stream_type": "logs"
                    },
                    "position": {"x": 0.0, "y": 100.0},
                    "io_type": "output"
                }
            ],
            "edges": [{"id": "esrc-dst", "source": "src", "target": "dst"}]
        }))
        .unwrap();
        pipeline.org = org.to_string();
        pipeline
    }

    struct Reached;

    #[async_trait::async_trait]
    impl crate::authz::WriteCheck<Pipeline> for Reached {
        async fn check(&self, _: &Pipeline) -> Result<(), axum::response::Response> {
            Err(axum::response::Response::default())
        }
    }

    #[tokio::test]
    async fn save_refuses_a_node_in_another_org() {
        use super::{PipelineError, save_pipeline_checked};

        for (source_org, dest_org, node) in
            [("b", "a", "scheduled query"), ("a", "b", "logs/dst_stream")]
        {
            let pipeline = scheduled_pipeline("cross_org_pl", "a", source_org, dest_org);
            let result = save_pipeline_checked(pipeline, Some(&Unreached)).await;
            assert!(
                matches!(&result, Err(PipelineError::InvalidPipeline(msg)) if msg.contains(node)),
                "{source_org}->{dest_org}: {result:?}"
            );
        }
    }

    #[tokio::test]
    async fn save_replaces_a_stale_source_org_instead_of_refusing_it() {
        use super::{PipelineError, save_pipeline_checked};

        let mut pipeline = scheduled_pipeline("stale_source_pl", "a", "a", "a");
        pipeline.source = PipelineSource::Scheduled(DerivedStream {
            org_id: "b".to_string(),
            ..Default::default()
        });
        let saved = save_pipeline_checked(pipeline, Some(&Reached)).await;
        assert!(matches!(saved, Err(PipelineError::Refused(_))), "{saved:?}");
    }

    #[tokio::test]
    async fn update_refuses_a_foreign_node_only_on_an_existing_pipeline() {
        use super::{PipelineError, update_pipeline_checked};

        if !meta_store().await {
            return;
        }
        let missing = scheduled_pipeline("update_missing_pl", "update_org_a", "update_org_b", "");
        let updated = update_pipeline_checked(missing, Some(&Unreached)).await;
        assert!(
            matches!(updated, Err(PipelineError::NotFound(_))),
            "{updated:?}"
        );

        let stored = scheduled_pipeline("update_cross_org_pl", "update_org_a", "", "");
        super::db::set(&stored).await.unwrap();
        let foreign = scheduled_pipeline("update_cross_org_pl", "update_org_a", "update_org_b", "");
        let updated = update_pipeline_checked(foreign, Some(&Unreached)).await;
        super::delete_pipeline(&stored.id).await.unwrap();
        assert!(
            matches!(&updated, Err(PipelineError::InvalidPipeline(msg)) if msg.contains("scheduled query")),
            "{updated:?}"
        );
    }

    #[tokio::test]
    async fn enabling_a_stored_cross_org_pipeline_is_refused() {
        use super::PipelineError;

        if !meta_store().await {
            return;
        }
        let mut stored = scheduled_pipeline("enable_cross_org_pl", "enable_org_a", "", "");
        stored.enabled = false;
        stored.source = PipelineSource::Scheduled(DerivedStream {
            org_id: "enable_org_b".to_string(),
            ..Default::default()
        });
        super::db::set(&stored).await.unwrap();

        let enabled = super::enable_pipeline("enable_org_a", &stored.id, true, false).await;
        assert!(
            matches!(&enabled, Err(PipelineError::InvalidPipeline(_))),
            "{enabled:?}"
        );
        assert!(!super::db::get_by_id(&stored.id).await.unwrap().enabled);
        super::delete_pipeline(&stored.id).await.unwrap();
    }

    #[test]
    fn the_saved_scheduled_source_is_bound_to_the_pipeline_org() {
        let mut pipeline = scheduled_pipeline("bind_src", "a", "", "");
        pipeline.source = PipelineSource::Scheduled(DerivedStream::default());
        let saved = super::bind_scheduled_source(&mut pipeline).unwrap();
        assert_eq!(saved.org_id, "a");
        assert_eq!(pipeline.get_derived_stream(), Some(saved));

        pipeline.source = PipelineSource::Realtime(StreamParams::default());
        assert_eq!(super::bind_scheduled_source(&mut pipeline), None);
    }

    #[test]
    fn an_org_less_stream_or_query_node_gets_the_pipeline_org() {
        let mut pipeline = scheduled_pipeline("bind_pl", "a", "", "");
        super::default_node_orgs(&mut pipeline);
        for node in &pipeline.nodes {
            let node_org = match &node.data {
                NodeData::Query(derived_stream) => derived_stream.org_id.clone(),
                NodeData::Stream(params) => params.org_id.to_string(),
                other => panic!("unexpected node {other:?}"),
            };
            assert_eq!(node_org, "a", "{}", node.id);
        }
    }
}
