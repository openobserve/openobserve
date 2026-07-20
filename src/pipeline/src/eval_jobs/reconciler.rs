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

//! Reconciler for Online Eval Jobs.
//!
//! Converts a job's declarative state into a hidden evaluation pipeline.
//! The pipeline is the actual execution surface: it carries the realtime
//! source stream binding, the LLM evaluation node, and an output sink.
//!
//! This module is intentionally side-effect bounded — it only reads/writes
//! the underlying pipeline via the pipeline service and repository layers.
//! layers. The caller (`service::llm_evaluations::eval_jobs`) is responsible for persisting any
//! resulting `pipeline_id` on the job row.

use config::{
    ider,
    meta::{
        alerts::{
            ConditionGroup, ConditionItem, ConditionItemCondition, LogicalOperator, Operator,
        },
        pipeline::{
            Pipeline, PipelineKind,
            components::{
                ConditionParams, Edge, LlmEvaluationParams, Node, NodeData, PipelineSource,
            },
        },
        stream::{StreamParams, StreamType},
    },
};
use infra::table::online_eval_jobs::{OnlineEvalJob, SamplingMode};

use crate::service::PipelineError;

/// Errors raised by the reconciler.
#[derive(Debug, thiserror::Error)]
pub enum ReconcileError {
    #[error("PipelineError# {0}")]
    PipelineError(#[from] PipelineError),
    #[error("ReconcileError# {0}")]
    Other(String),
}

/// Reconcile a job into a hidden evaluation pipeline.
///
/// Returns the `pipeline_id` that should be persisted on the job (or `None`
/// if no pipeline should exist for the current status). Idempotent:
/// calling repeatedly with the same job state is a no-op.
pub async fn reconcile(job: &OnlineEvalJob) -> Result<Option<String>, ReconcileError> {
    match job.status.as_str() {
        "draft" => {
            // No pipeline should exist in draft. Tear down any prior one.
            if let Some(pid) = job.pipeline_id.as_deref() {
                best_effort_delete(pid).await;
            }
            Ok(None)
        }
        "archived" => {
            // Same as draft: tear down. Status terminal.
            if let Some(pid) = job.pipeline_id.as_deref() {
                best_effort_delete(pid).await;
            }
            Ok(None)
        }
        "active" => Ok(Some(ensure_pipeline(job, true).await?)),
        "paused" | "degraded" => Ok(Some(ensure_pipeline(job, false).await?)),
        other => Err(ReconcileError::Other(format!(
            "unknown job status '{other}' — cannot reconcile"
        ))),
    }
}

/// Best-effort tear down. Used when a job is deleted; safe to call when the
/// underlying pipeline is already gone.
pub async fn tear_down(job: &OnlineEvalJob) -> Result<(), ReconcileError> {
    if let Some(pid) = job.pipeline_id.as_deref() {
        best_effort_delete(pid).await;
    }
    Ok(())
}

/// Delete the pipeline, swallowing NotFound to remain idempotent.
async fn best_effort_delete(pipeline_id: &str) {
    match crate::management::delete_pipeline(pipeline_id).await {
        Ok(()) => {}
        Err(PipelineError::NotFound(_)) => {
            // Already gone — fine.
        }
        Err(e) => {
            log::warn!(
                "[EvalJob Reconciler] best-effort delete of pipeline {} failed: {}",
                pipeline_id,
                e
            );
        }
    }
}

/// Ensure a pipeline exists for the job, in the desired `enabled` state, and
/// that its config matches `build_pipeline_from_job(job)`.
///
/// This is the central reconciliation entry point for both first-time pipeline
/// provisioning and later drift correction. `desired_enabled` reflects the
/// job lifecycle state: active jobs should run, while paused/degraded jobs keep
/// their pipeline definition but disable execution.
///
/// Returns the pipeline_id.
async fn ensure_pipeline(
    job: &OnlineEvalJob,
    desired_enabled: bool,
) -> Result<String, ReconcileError> {
    match job.pipeline_id.as_deref() {
        None => {
            // First-time provisioning.
            let new_id = ider::generate();
            let pipeline = build_pipeline_from_job(job, &new_id, desired_enabled, 1);
            crate::management::save_pipeline(pipeline).await?;
            // save_pipeline persists `enabled` as-is, so no separate enable_pipeline call
            // is needed for the create path. If we later want to be defensive against
            // future changes in save_pipeline semantics, we can re-assert enable state
            // here for paused/degraded (enable=false is already the default we wrote).
            Ok(new_id)
        }
        Some(pipeline_id) => {
            // Pipeline should already exist. Fetch and compare.
            let existing = match crate::service::get_by_id(pipeline_id).await {
                Ok(p) => p,
                Err(PipelineError::NotFound(_)) => {
                    // Drift: job thinks a pipeline exists but it's gone. Recreate
                    // with the same id so the job row stays consistent.
                    let pipeline = build_pipeline_from_job(job, pipeline_id, desired_enabled, 1);
                    crate::management::save_pipeline(pipeline).await?;
                    return Ok(pipeline_id.to_string());
                }
                Err(e) => return Err(e.into()),
            };

            // Update salient config if drifted.
            if !pipeline_matches_job(&existing, job) {
                let updated =
                    build_pipeline_from_job(job, pipeline_id, desired_enabled, existing.version);
                crate::management::update_pipeline(updated).await?;
            }

            // Ensure enable state. update_pipeline preserves whatever `enabled` was
            // in the new pipeline body, but we still issue an explicit call so the
            // case where only the enabled flag drifted is also handled.
            if existing.enabled != desired_enabled || pipeline_matches_job(&existing, job) {
                // For evaluation pipelines, sampling has no time-of-day semantics
                // so starts_from_now is always false.
                crate::management::enable_pipeline(
                    &job.org_id,
                    pipeline_id,
                    desired_enabled,
                    false,
                )
                .await?;
            }

            Ok(pipeline_id.to_string())
        }
    }
}

/// Build a fresh `Pipeline` from the job's declarative state.
///
/// This is the single source of truth for how a job is materialized as a
/// pipeline; both create and update paths go through here.
fn build_pipeline_from_job(
    job: &OnlineEvalJob,
    pipeline_id: &str,
    enabled: bool,
    version: i32,
) -> Pipeline {
    let stream_type = parse_stream_type(&job.stream_type);
    let source_stream = StreamParams::new(&job.org_id, &job.stream, stream_type);

    // Input node: the source stream we listen on.
    let input_node = Node::new(
        format!("input-{pipeline_id}"),
        NodeData::Stream(source_stream.clone()),
        100.0,
        100.0,
        "input".to_string(),
    );

    let system_id_check_node = build_system_id_check_node(pipeline_id);
    let filter_node = build_filter_node(job, pipeline_id);

    // LLM evaluation node. Sampling is enforced by this node at execution time.
    let sampling_rate = extract_sampling_rate(job);
    let eval_params = LlmEvaluationParams {
        name: format!("eval_{}", job.id),
        sampling_rate,
        scorers: job.scorers.clone(),
        job_id: Some(job.id.clone()),
    };
    let eval_node = Node::new(
        format!("eval-{pipeline_id}"),
        NodeData::LlmEvaluation(eval_params),
        400.0,
        100.0,
        "default".to_string(),
    );

    // Output node: fixed sink stream where eval results are written.
    let output_stream = StreamParams::new(&job.org_id, "_llm_scores", StreamType::Logs);
    let output_node = Node::new(
        format!("output-{pipeline_id}"),
        NodeData::Stream(output_stream),
        500.0,
        100.0,
        "output".to_string(),
    );

    let mut nodes = vec![input_node.clone()];
    let mut edges = Vec::new();
    edges.push(Edge::new(
        input_node.get_node_id(),
        system_id_check_node.get_node_id(),
    ));
    nodes.push(system_id_check_node.clone());

    if let Some(filter_node) = filter_node {
        edges.push(Edge::new(
            system_id_check_node.get_node_id(),
            filter_node.get_node_id(),
        ));
        edges.push(Edge::new(
            filter_node.get_node_id(),
            eval_node.get_node_id(),
        ));
        nodes.push(filter_node);
    } else {
        edges.push(Edge::new(
            system_id_check_node.get_node_id(),
            eval_node.get_node_id(),
        ));
    }
    edges.push(Edge::new(
        eval_node.get_node_id(),
        output_node.get_node_id(),
    ));
    nodes.push(eval_node);
    nodes.push(output_node);

    Pipeline {
        id: pipeline_id.to_string(),
        version,
        enabled,
        org: job.org_id.clone(),
        name: format!("__eval__{}", job.name),
        description: format!("Hidden eval pipeline for job {} ({})", job.name, job.id),
        source: PipelineSource::Realtime(source_stream),
        kind: PipelineKind::Evaluation,
        nodes,
        edges,
    }
}

/// Returns true if `pipeline`'s salient fields match what we would build for
/// `job` right now. Used by `reconcile` to skip needless updates.
///
/// Salient fields:
/// - pipeline kind
/// - source stream (org/name/type)
/// - eval node sampling_rate
/// - eval node scorers
/// - optional filter node condition
pub(crate) fn pipeline_matches_job(pipeline: &Pipeline, job: &OnlineEvalJob) -> bool {
    if pipeline.kind != PipelineKind::Evaluation {
        return false;
    }

    // Source stream
    let expected_stream = StreamParams::new(
        &job.org_id,
        &job.stream,
        parse_stream_type(&job.stream_type),
    );
    let source_matches = match &pipeline.source {
        PipelineSource::Realtime(sp) => sp == &expected_stream,
        _ => false,
    };
    if !source_matches {
        return false;
    }

    let expected_system_id_check = build_system_id_check_condition();
    let system_id_check = pipeline
        .nodes
        .iter()
        .find(|n| n.get_node_id() == format!("id-check-{}", pipeline.id))
        .and_then(|n| match n.get_node_data() {
            NodeData::Condition(p) => Some(p),
            _ => None,
        });
    if system_id_check != Some(expected_system_id_check) {
        return false;
    }

    let expected_filter = build_filter_condition(job);
    let filter = pipeline
        .nodes
        .iter()
        .find(|n| n.get_node_id() == format!("filter-{}", pipeline.id))
        .and_then(|n| match n.get_node_data() {
            NodeData::Condition(p) => Some(p),
            _ => None,
        });
    if filter != expected_filter {
        return false;
    }

    // Eval node config
    let expected_rate = extract_sampling_rate(job);
    let eval = pipeline.nodes.iter().find_map(|n| match n.get_node_data() {
        NodeData::LlmEvaluation(p) => Some(p),
        _ => None,
    });
    match eval {
        None => false,
        Some(params) => {
            (params.sampling_rate - expected_rate).abs() < f64::EPSILON
                && params.scorers == job.scorers
        }
    }
}

fn build_system_id_check_node(pipeline_id: &str) -> Node {
    Node::new(
        format!("id-check-{pipeline_id}"),
        NodeData::Condition(build_system_id_check_condition()),
        200.0,
        100.0,
        "default".to_string(),
    )
}

fn build_system_id_check_condition() -> ConditionParams {
    ConditionParams::V2 {
        conditions: ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "span_id".to_string(),
                    operator: Operator::NotEqualTo,
                    value: serde_json::Value::String(String::new()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "trace_id".to_string(),
                    operator: Operator::NotEqualTo,
                    value: serde_json::Value::String(String::new()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
            ],
        },
    }
}

fn build_filter_node(job: &OnlineEvalJob, pipeline_id: &str) -> Option<Node> {
    build_filter_condition(job).map(|condition| {
        Node::new(
            format!("filter-{pipeline_id}"),
            NodeData::Condition(condition),
            300.0,
            100.0,
            "default".to_string(),
        )
    })
}

fn build_filter_condition(job: &OnlineEvalJob) -> Option<ConditionParams> {
    let condition = &job.filter_condition;
    if condition.is_null()
        || condition.as_object().is_some_and(|o| o.is_empty())
        || condition
            .get("type")
            .and_then(|v| v.as_str())
            .is_some_and(|v| v.eq_ignore_ascii_case("all"))
    {
        return None;
    }

    serde_json::from_value::<ConditionParams>(condition.clone())
        .or_else(|_| {
            serde_json::from_value::<config::meta::alerts::ConditionGroup>(condition.clone())
                .map(|conditions| ConditionParams::V2 { conditions })
        })
        .or_else(|_| {
            serde_json::from_value::<config::meta::alerts::ConditionList>(condition.clone())
                .map(|conditions| ConditionParams::V1 { conditions })
        })
        .ok()
}

/// Parse the job's `stream_type` (a string from the DB) into a `StreamType`,
/// defaulting to `Logs` for unknown values.
fn parse_stream_type(s: &str) -> StreamType {
    match s.to_lowercase().as_str() {
        "traces" => StreamType::Traces,
        "logs" => StreamType::Logs,
        "metrics" => StreamType::Metrics,
        _ => StreamType::Logs,
    }
}

/// Extract the effective sampling rate from the job's sampling config.
/// Defaults to 1.0 (sample all) for `all`/`count` modes or malformed configs.
fn extract_sampling_rate(job: &OnlineEvalJob) -> f64 {
    if job.sampling_mode == SamplingMode::Rate
        && let Some(rate) = job.sampling_value.get("rate").and_then(|v| v.as_f64())
    {
        return rate;
    }
    1.0
}

#[cfg(test)]
mod tests {
    use config::meta::pipeline::components::ScorerRef;

    use super::*;

    fn sample_job() -> OnlineEvalJob {
        OnlineEvalJob {
            id: "job-abc".to_string(),
            org_id: "org1".to_string(),
            name: "qa-eval".to_string(),
            description: None,
            stream: "spans".to_string(),
            stream_type: "traces".to_string(),
            filter_condition: serde_json::json!({"type": "all"}),
            scorers: vec![
                ScorerRef {
                    id: "scorer-entity-1".to_string(),
                    version: None,
                },
                ScorerRef {
                    id: "scorer-entity-2".to_string(),
                    version: None,
                },
            ],
            input_mapping: None,
            sampling_mode: SamplingMode::Rate,
            sampling_value: serde_json::json!({"rate": 0.25}),
            status: "active".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn test_build_pipeline_basics() {
        let job = sample_job();
        let pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);

        assert_eq!(pipeline.id, "pipe-1");
        assert_eq!(pipeline.version, 1);
        assert!(pipeline.enabled);
        assert_eq!(pipeline.org, "org1");
        assert_eq!(pipeline.name, "__eval__qa-eval");
        assert!(pipeline.description.contains("qa-eval"));
        assert!(pipeline.description.contains("job-abc"));
        assert_eq!(pipeline.kind, PipelineKind::Evaluation);

        // 4 nodes, 3 edges: input -> system id check -> eval -> output.
        assert_eq!(pipeline.nodes.len(), 4);
        assert_eq!(pipeline.edges.len(), 3);

        // Source must be Realtime(spans/traces).
        match &pipeline.source {
            PipelineSource::Realtime(sp) => {
                assert_eq!(sp.org_id.to_string(), "org1");
                assert_eq!(sp.stream_name.to_string(), "spans");
                assert_eq!(sp.stream_type, StreamType::Traces);
            }
            _ => panic!("expected Realtime source"),
        }

        // Input node: Stream node.
        match pipeline.nodes[0].get_node_data() {
            NodeData::Stream(sp) => {
                assert_eq!(sp.stream_name.to_string(), "spans");
                assert_eq!(sp.stream_type, StreamType::Traces);
            }
            _ => panic!("expected Stream input node"),
        }

        // System eligibility check: span_id and trace_id must be present.
        match pipeline.nodes[1].get_node_data() {
            NodeData::Condition(condition) => {
                assert_eq!(condition, build_system_id_check_condition());
            }
            _ => panic!("expected system id check condition node"),
        }

        // Middle: LlmEvaluation.
        match pipeline.nodes[2].get_node_data() {
            NodeData::LlmEvaluation(params) => {
                assert_eq!(params.name, "eval_job-abc");
                assert!((params.sampling_rate - 0.25).abs() < f64::EPSILON);
                // scorer entity ids are materialized directly in the struct.
                assert_eq!(params.scorers, job.scorers);
            }
            _ => panic!("expected LlmEvaluation middle node"),
        }

        // Output: Stream node to _llm_scores/logs.
        match pipeline.nodes[3].get_node_data() {
            NodeData::Stream(sp) => {
                assert_eq!(sp.stream_name.to_string(), "_llm_scores");
                assert_eq!(sp.stream_type, StreamType::Logs);
            }
            _ => panic!("expected Stream output node"),
        }

        // Edges wire input -> id check -> eval -> output.
        assert_eq!(pipeline.edges[0].source, pipeline.nodes[0].get_node_id());
        assert_eq!(pipeline.edges[0].target, pipeline.nodes[1].get_node_id());
        assert_eq!(pipeline.edges[1].source, pipeline.nodes[1].get_node_id());
        assert_eq!(pipeline.edges[1].target, pipeline.nodes[2].get_node_id());
        assert_eq!(pipeline.edges[2].source, pipeline.nodes[2].get_node_id());
        assert_eq!(pipeline.edges[2].target, pipeline.nodes[3].get_node_id());
    }

    #[test]
    fn test_build_pipeline_sampling_all_defaults_to_1() {
        let mut job = sample_job();
        job.sampling_mode = SamplingMode::All;
        job.sampling_value = serde_json::json!({});
        let pipeline = build_pipeline_from_job(&job, "pipe-2", true, 1);
        match pipeline.nodes[2].get_node_data() {
            NodeData::LlmEvaluation(params) => {
                assert!((params.sampling_rate - 1.0).abs() < f64::EPSILON);
            }
            _ => panic!("expected LlmEvaluation node"),
        }
    }

    #[test]
    fn test_build_pipeline_adds_filter_node_when_job_has_filter_condition() {
        let mut job = sample_job();
        job.filter_condition = serde_json::json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [{
                "filterType": "condition",
                "column": "attributes.llm.system",
                "operator": "=",
                "value": true,
                "logicalOperator": "AND"
            }]
        });

        let pipeline = build_pipeline_from_job(&job, "pipe-filter", true, 1);

        assert_eq!(pipeline.nodes.len(), 5);
        assert_eq!(pipeline.edges.len(), 4);
        assert!(matches!(
            pipeline.nodes[1].get_node_data(),
            NodeData::Condition(_)
        ));
        assert!(matches!(
            pipeline.nodes[2].get_node_data(),
            NodeData::Condition(_)
        ));
        assert!(matches!(
            pipeline.nodes[3].get_node_data(),
            NodeData::LlmEvaluation(_)
        ));
        assert_eq!(pipeline.edges[0].source, pipeline.nodes[0].get_node_id());
        assert_eq!(pipeline.edges[0].target, pipeline.nodes[1].get_node_id());
        assert_eq!(pipeline.edges[1].source, pipeline.nodes[1].get_node_id());
        assert_eq!(pipeline.edges[1].target, pipeline.nodes[2].get_node_id());
        assert_eq!(pipeline.edges[2].source, pipeline.nodes[2].get_node_id());
        assert_eq!(pipeline.edges[2].target, pipeline.nodes[3].get_node_id());
        assert_eq!(pipeline.edges[3].source, pipeline.nodes[3].get_node_id());
        assert_eq!(pipeline.edges[3].target, pipeline.nodes[4].get_node_id());
    }

    #[test]
    fn test_pipeline_matches_job_false_without_system_id_check() {
        let job = sample_job();
        let mut pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);
        pipeline
            .nodes
            .retain(|node| node.get_node_id() != "id-check-pipe-1");
        assert!(!pipeline_matches_job(&pipeline, &job));
    }

    #[test]
    fn test_system_id_check_condition_requires_span_and_trace_ids() {
        let ConditionParams::V2 { conditions } = build_system_id_check_condition() else {
            panic!("expected V2 condition group");
        };

        assert_eq!(conditions.conditions.len(), 2);
        let expected = [
            ("span_id", Operator::NotEqualTo),
            ("trace_id", Operator::NotEqualTo),
        ];
        for (condition, (expected_column, expected_operator)) in
            conditions.conditions.iter().zip(expected)
        {
            let ConditionItem::Condition(condition) = condition else {
                panic!("expected condition item");
            };
            assert_eq!(condition.column, expected_column);
            assert_eq!(condition.operator, expected_operator);
            assert_eq!(condition.value, serde_json::Value::String(String::new()));
            assert_eq!(condition.logical_operator, LogicalOperator::And);
        }
    }

    #[test]
    fn test_pipeline_matches_job_true() {
        let job = sample_job();
        let pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);
        assert!(pipeline_matches_job(&pipeline, &job));
    }

    #[test]
    fn test_pipeline_matches_job_false_on_kind_drift() {
        let job = sample_job();
        let mut pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);
        pipeline.kind = PipelineKind::User;

        assert!(!pipeline_matches_job(&pipeline, &job));
    }

    #[test]
    fn test_pipeline_matches_job_false_on_sampling_drift() {
        let job = sample_job();
        let pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);

        // Mutate job's sampling rate; pipeline should no longer match.
        let mut drifted = job.clone();
        drifted.sampling_value = serde_json::json!({"rate": 0.99});
        assert!(!pipeline_matches_job(&pipeline, &drifted));
    }

    #[test]
    fn test_pipeline_matches_job_false_on_scorer_drift() {
        let job = sample_job();
        let pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);

        let mut drifted = job.clone();
        drifted.scorers = vec![ScorerRef {
            id: "completely-different-entity".to_string(),
            version: None,
        }];
        assert!(!pipeline_matches_job(&pipeline, &drifted));
    }

    #[test]
    fn test_pipeline_matches_job_false_on_filter_drift() {
        let job = sample_job();
        let pipeline = build_pipeline_from_job(&job, "pipe-1", true, 1);

        let mut drifted = job.clone();
        drifted.filter_condition = serde_json::json!({
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [{
                "filterType": "condition",
                "column": "attributes.llm.system",
                "operator": "=",
                "value": true,
                "logicalOperator": "AND"
            }]
        });

        assert!(!pipeline_matches_job(&pipeline, &drifted));
    }

    #[test]
    fn test_parse_stream_type() {
        assert_eq!(parse_stream_type("traces"), StreamType::Traces);
        assert_eq!(parse_stream_type("Traces"), StreamType::Traces);
        assert_eq!(parse_stream_type("logs"), StreamType::Logs);
        assert_eq!(parse_stream_type("metrics"), StreamType::Metrics);
        // Default fallback for unknown values.
        assert_eq!(parse_stream_type("bogus"), StreamType::Logs);
        assert_eq!(parse_stream_type(""), StreamType::Logs);
    }

    #[test]
    fn test_extract_sampling_rate_rate_mode() {
        let mut job = sample_job();
        job.sampling_mode = SamplingMode::Rate;
        job.sampling_value = serde_json::json!({"rate": 0.1});
        assert!((extract_sampling_rate(&job) - 0.1).abs() < f64::EPSILON);
    }

    #[test]
    fn test_extract_sampling_rate_count_mode_defaults_to_1() {
        let mut job = sample_job();
        job.sampling_mode = SamplingMode::Count;
        job.sampling_value = serde_json::json!({"count": 100});
        assert!((extract_sampling_rate(&job) - 1.0).abs() < f64::EPSILON);
    }
}
