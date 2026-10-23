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

use std::collections::BTreeSet;

use axum::body::Body;
use tower::ServiceExt;

use super::*;

/// Every route `search_routes_with` registers, as (method, template, handler).
#[rustfmt::skip]
const GATED: [(&str, &str, &str); 49] = [
    ("POST", "/{org_id}/_search_multi", "search::multi_streams::search_multi"),
    ("POST", "/{org_id}/_search_multi_stream", "search::multi_streams::search_multi_stream"),
    ("POST", "/{org_id}/_search_partition_multi", "search::multi_streams::_search_partition_multi"),
    ("GET", "/{org_id}/{stream_names}/_around_multi", "search::multi_streams::around_multi"),
    ("GET", "/{org_id}/{stream_name}/traces/{trace_id}/details", "traces::details::get_trace_details"),
    ("GET", "/{org_id}/prometheus/api/v1/label/{label_name}/values", "promql::label_values"),
    ("POST", "/v2/{org_id}/downtimes/resources", "downtimes::downtime_resources"),
    ("POST", "/v2/{org_id}/downtimes/values", "downtimes::downtime_values"),
    ("PATCH", "/v2/{org_id}/alerts/{alert_id}/trigger", "alerts::trigger_alert"),
    ("PATCH", "/v2/{org_id}/alerts/{alert_id}/retrain", "alerts::retrain_alert"),
    ("GET", "/{org_id}/db_monitoring/databases", "db_monitoring::handler::get_dbm_databases"),
    ("GET", "/{org_id}/db_monitoring/queries", "db_monitoring::handler::get_dbm_queries"),
    ("GET", "/{org_id}/db_monitoring/query/history", "db_monitoring::handler::get_dbm_query_history"),
    ("GET", "/{org_id}/db_monitoring/query/endpoints", "db_monitoring::handler::get_dbm_query_endpoints"),
    ("GET", "/{org_id}/db_monitoring/samples", "db_monitoring::handler::get_dbm_samples"),
    ("GET", "/{org_id}/db_monitoring/deadlocks", "db_monitoring::handler::get_dbm_deadlocks"),
    ("GET", "/{org_id}/db_monitoring/blocking", "db_monitoring::handler::get_dbm_blocking"),
    ("GET", "/{org_id}/db_monitoring/activity", "db_monitoring::handler::get_dbm_activity"),
    ("GET", "/{org_id}/db_monitoring/query/insights", "db_monitoring::handler::get_dbm_query_insights"),
    ("GET", "/{org_id}/db_monitoring/query/plans", "db_monitoring::handler::get_dbm_query_plans"),
    ("GET", "/{org_id}/db_monitoring/query/server_metrics", "db_monitoring::handler::get_dbm_query_server_metrics"),
    ("GET", "/{org_id}/db_monitoring/server_queries", "db_monitoring::handler::get_dbm_server_queries"),
    ("GET", "/{org_id}/db_monitoring/server_samples", "db_monitoring::handler::get_dbm_server_samples"),
    ("GET", "/{org_id}/db_monitoring/table_health", "db_monitoring::handler::get_dbm_table_health"),
    ("GET", "/{org_id}/db_monitoring/instances", "db_monitoring::handler::get_dbm_instances"),
    ("GET", "/{org_id}/db_monitoring/instance_metrics", "db_monitoring::handler::get_dbm_instance_metrics"),
    ("GET", "/{org_id}/db_monitoring/badges", "db_monitoring::handler::get_dbm_badges"),
    ("POST", "/{org_id}/anomaly_detection/{config_id}/train", "anomaly_detection::train_model"),
    ("POST", "/{org_id}/anomaly_detection/{config_id}/detect", "anomaly_detection::detect_anomalies"),
    ("POST", "/{org_id}/search_jobs", "search::search_job::submit_job"),
    ("GET", "/{org_id}/search_jobs/{job_id}/result", "search::search_job::get_job_result"),
    ("POST", "/{org_id}/search_jobs/{job_id}/retry", "search::search_job::retry_job"),
    ("GET", "/{org_id}/traces/service_graph/topology/current", "traces::get_current_topology"),
    ("GET", "/{org_id}/traces/service_graph/edge/history", "traces::get_edge_history"),
    ("GET", "/{org_id}/traces/agent_signals", "traces::get_agent_signals"),
    ("POST", "/{org_id}/traces/agent_signals/compare", "traces::compare_agent_versions"),
    ("POST", "/{org_id}/streams/{stream_name}/patterns/extract", "patterns::extract_patterns"),
    ("POST", "/{org_id}/annotation_queues/{queue_id}/items", "annotation_queues::enqueue_annotation_queue_item"),
    ("GET", "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}", "annotation_queues::get_annotation_queue_item"),
    ("GET", "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/reviews", "annotation_queues::list_annotation_queue_item_reviews"),
    ("POST", "/{org_id}/annotation_queues/{queue_id}/items/{queue_item_id}/push_to_dataset", "datasets::push_annotation_queue_item_to_dataset"),
    ("POST", "/{org_id}/datasets/{dataset_id}/items", "datasets::push_dataset_item"),
    ("GET", "/{org_id}/experiments/compare", "experiments::compare_experiments"),
    ("GET", "/{org_id}/experiments/{experiment_id}", "experiments::get_experiment"),
    ("GET", "/{org_id}/experiments/{experiment_id}/rows", "experiments::list_experiment_result_rows"),
    ("GET", "/{org_id}/experiments/{experiment_id}/rows/{row_id}", "experiments::get_experiment_row"),
    ("GET", "/{org_id}/discovery", "discovery::list_discovery_items"),
    ("GET", "/{org_id}/tasks/{entity_id}/stats", "remote_tasks::get_remote_task_stats"),
    ("POST", "/{org_id}/eval_jobs/{job_id}/manual_eval", "eval_jobs::manual_eval_job"),
];

/// Modules whose every registered handler reads data through search.
const FULLY_GATED_MODULES: [&str; 5] = [
    "search::multi_streams::",
    "db_monitoring::handler::",
    "patterns::",
    "discovery::",
    "traces::details::",
];

/// Modules that hold gated and ungated handlers side by side.
const MIXED_MODULES: [&str; 11] = [
    "alerts",
    "eval_jobs",
    "search::search_job",
    "anomaly_detection",
    "experiments",
    "annotation_queues",
    "datasets",
    "remote_tasks",
    "downtimes",
    "promql",
    "traces",
];

/// Each ungated handler of a mixed module, with why it stays open.
#[rustfmt::skip]
const UNGATED_SIBLINGS: &[(&str, &str)] = &[
    ("alerts::clone_alert", "alert bookkeeping, no search"),
    ("alerts::create_alert", "alert bookkeeping, no search"),
    ("alerts::delete_alert", "alert bookkeeping, no search"),
    ("alerts::delete_alert_bulk", "alert bookkeeping, no search"),
    ("alerts::enable_alert", "alert bookkeeping; evaluation is background work"),
    ("alerts::enable_alert_bulk", "alert bookkeeping; evaluation is background work"),
    ("alerts::export_alert", "alert bookkeeping, no search"),
    ("alerts::generate_sql", "writes SQL text, runs no query"),
    ("alerts::get_alert", "alert bookkeeping, no search"),
    ("alerts::get_composite_references", "stored composite definitions, no search"),
    ("alerts::get_composite_timeline", "stored child-alert states, no search"),
    ("alerts::list_alert_group_transitions", "stored group state, no search"),
    ("alerts::list_alert_groups", "stored group state, no search"),
    ("alerts::list_alert_tags", "alert bookkeeping, no search"),
    ("alerts::list_alerts", "alert bookkeeping, no search"),
    ("alerts::move_alerts", "alert bookkeeping, no search"),
    ("alerts::update_alert", "alert bookkeeping, no search"),
    ("alerts::validate_composite_alert", "evaluates stored child-alert states, no search"),
    ("annotation_queues::archive_annotation_queue_items", "queue bookkeeping, no search"),
    ("annotation_queues::clear_annotation_queue_items", "queue bookkeeping, no search"),
    ("annotation_queues::create_annotation_queue", "queue bookkeeping, no search"),
    ("annotation_queues::delete_annotation_queue", "queue bookkeeping, no search"),
    ("annotation_queues::get_annotation_queue", "queue bookkeeping, no search"),
    ("annotation_queues::list_annotation_queue_items", "stored queue items, no search"),
    ("annotation_queues::list_annotation_queues", "queue bookkeeping, no search"),
    ("annotation_queues::review_annotation_queue_item", "stores a human review, no search"),
    ("annotation_queues::update_annotation_queue", "queue bookkeeping, no search"),
    ("anomaly_detection::cancel_training", "stops work, no search"),
    ("anomaly_detection::create_config", "create-time training waits in the scheduler while blocked"),
    ("anomaly_detection::delete_config", "config bookkeeping, no search"),
    ("anomaly_detection::get_config", "config bookkeeping, no search"),
    ("anomaly_detection::get_detection_history", "operational history of the org's own detections"),
    ("anomaly_detection::list_configs", "config bookkeeping, no search"),
    ("anomaly_detection::update_config", "config bookkeeping, no search"),
    ("datasets::create_dataset", "dataset bookkeeping, no search"),
    ("datasets::delete_dataset", "dataset bookkeeping, no search"),
    ("datasets::delete_dataset_item", "dataset bookkeeping, no search"),
    ("datasets::get_dataset", "dataset bookkeeping, no search"),
    ("datasets::get_dataset_item_versions", "stored dataset rows, no search"),
    ("datasets::get_dataset_snapshot_rows", "stored dataset rows, no search"),
    ("datasets::import_dataset_items", "rows come from the uploaded CSV, not telemetry"),
    ("datasets::list_dataset_items", "stored dataset rows, no search"),
    ("datasets::list_datasets", "dataset bookkeeping, no search"),
    ("datasets::update_dataset", "dataset bookkeeping, no search"),
    ("datasets::update_dataset_item", "rows come from the caller, not telemetry"),
    ("datasets::upsert_dataset_items", "rows come from the caller, not telemetry"),
    ("downtimes::cancel_downtime", "downtime bookkeeping, no search"),
    ("downtimes::create_downtime", "downtime bookkeeping, no search"),
    ("downtimes::delete_downtime", "downtime bookkeeping, no search"),
    ("downtimes::extend_downtime", "downtime bookkeeping, no search"),
    ("downtimes::get_downtime", "downtime bookkeeping, no search"),
    ("downtimes::list_downtimes", "downtime bookkeeping, no search"),
    ("downtimes::move_downtimes", "downtime bookkeeping, no search"),
    ("downtimes::preview_downtime", "inventory match only"),
    ("downtimes::update_downtime", "downtime bookkeeping, no search"),
    ("eval_jobs::activate_eval_job", "job bookkeeping; scoring runs in the background executor"),
    ("eval_jobs::archive_eval_job", "job bookkeeping, no search"),
    ("eval_jobs::create_eval_job", "job bookkeeping, no search"),
    ("eval_jobs::delete_eval_job", "job bookkeeping, no search"),
    ("eval_jobs::get_eval_job", "job bookkeeping, no search"),
    ("eval_jobs::list_eval_jobs", "job bookkeeping, no search"),
    ("eval_jobs::pause_eval_job", "job bookkeeping, no search"),
    ("eval_jobs::resume_eval_job", "job bookkeeping; scoring runs in the background executor"),
    ("eval_jobs::update_eval_job", "job bookkeeping, no search"),
    ("experiments::cancel_experiment", "stops work, no search"),
    ("experiments::clear_experiment_baseline", "experiment bookkeeping, no search"),
    ("experiments::clone_experiment", "experiment bookkeeping; runs score as background eval work"),
    ("experiments::create_experiment", "runs score as background eval work"),
    ("experiments::delete_experiment", "experiment bookkeeping, no search"),
    ("experiments::finalize_experiment", "experiment bookkeeping, no search"),
    ("experiments::list_experiment_slots", "slot bookkeeping, no search"),
    ("experiments::list_experiments", "summary skipped while blocked (S4)"),
    ("experiments::preview_experiment", "previews the dataset, not telemetry"),
    ("experiments::retry_experiment", "runs score as background eval work"),
    ("experiments::retry_experiment_slot", "runs score as background eval work"),
    ("experiments::set_experiment_baseline", "experiment bookkeeping, no search"),
    ("experiments::submit_experiment_records", "records come from the caller"),
    ("promql::format_query_get", "formats the query text, no data"),
    ("promql::format_query_post", "formats the query text, no data"),
    ("promql::labels_get", "schema only"),
    ("promql::labels_post", "schema only"),
    ("promql::metadata", "schema only"),
    ("promql::parse_tree", "parses the query text, no data"),
    ("promql::query_exemplars_get", "checks the licence in the handler (query_range)"),
    ("promql::query_exemplars_post", "checks the licence in the handler (query_range)"),
    ("promql::query_get", "checks the licence in the handler"),
    ("promql::query_post", "checks the licence in the handler"),
    ("promql::query_range_get", "checks the licence in the handler"),
    ("promql::query_range_post", "checks the licence in the handler"),
    ("promql::remote_write", "ingestion"),
    ("promql::series_get", "checks the licence in the handler"),
    ("promql::series_post", "checks the licence in the handler"),
    ("remote_tasks::activate_remote_task_signing_candidate", "task bookkeeping, no search"),
    ("remote_tasks::create_remote_task", "task bookkeeping, no search"),
    ("remote_tasks::delete_remote_task", "task bookkeeping, no search"),
    ("remote_tasks::discard_remote_task_draft", "task bookkeeping, no search"),
    ("remote_tasks::end_remote_task_signing_grace", "task bookkeeping, no search"),
    ("remote_tasks::get_remote_task", "task bookkeeping, no search"),
    ("remote_tasks::get_remote_task_draft", "task bookkeeping, no search"),
    ("remote_tasks::get_remote_task_signing_status", "task bookkeeping, no search"),
    ("remote_tasks::list_remote_task_versions", "task bookkeeping, no search"),
    ("remote_tasks::list_remote_tasks", "task bookkeeping, no search"),
    ("remote_tasks::publish_remote_task", "calls the remote endpoint, no search"),
    ("remote_tasks::replace_remote_task_auth_secret", "task bookkeeping, no search"),
    ("remote_tasks::replace_remote_task_header_secret", "task bookkeeping, no search"),
    ("remote_tasks::revoke_remote_task_auth_secret", "task bookkeeping, no search"),
    ("remote_tasks::revoke_remote_task_header_secret", "task bookkeeping, no search"),
    ("remote_tasks::revoke_remote_task_signing_secret", "task bookkeeping, no search"),
    ("remote_tasks::rotate_remote_task_signing_secret", "task bookkeeping, no search"),
    ("remote_tasks::save_remote_task_draft", "task bookkeeping, no search"),
    ("remote_tasks::test_remote_task", "calls the remote endpoint, no search"),
    ("remote_tasks::test_remote_task_signing_candidate", "calls the remote endpoint, no search"),
    ("remote_tasks::test_run_remote_task", "calls the remote endpoint on caller input"),
    ("search::search_job::cancel_job", "job bookkeeping, no search"),
    ("search::search_job::delete_job", "job bookkeeping, no search"),
    ("search::search_job::get_status", "job bookkeeping, no search"),
    ("search::search_job::list_status", "job bookkeeping, no search"),
    ("traces::get_latest_traces", "checks the licence in the handler"),
    ("traces::get_latest_traces_stream", "checks the licence in the handler"),
    ("traces::traces_write", "ingestion"),
];

/// Pages an over-limit customer needs to understand and fix their state; none may be gated.
const OPERATIONAL_READS: [&str; 22] = [
    "/v2/{org_id}/alerts/history",
    "/v2/{org_id}/reports/history",
    "/{org_id}/pipelines/history",
    "/{org_id}/workflows/{id}/history",
    "/v2/{org_id}/alert_calibration/digests",
    "/v2/{org_id}/alert_calibration/digests/alerts",
    "/v2/{org_id}/alert_calibration/digests/records",
    "/v2/{org_id}/alert_calibration/digests/rules",
    "/v2/{org_id}/alert_calibration/digests/run",
    "/{org_id}/ai/chats",
    "/{org_id}/ai/chats/{session_id}",
    "/{org_id}/synthetics",
    "/{org_id}/synthetics/{id}/runs",
    "/{org_id}/_search_history",
    "/{org_id}/search/profile",
    "/license",
    "/license/refresh",
    "/{org_id}/config",
    "/{org_id}/anomaly_detection/{config_id}/history",
    "/{org_id}/anomaly_detection/history",
    "/v2/{org_id}/alerts/incidents/{incident_id}",
    "/{org_id}/search_jobs/{job_id}",
];

/// Background functions that run a search, each with the one `src/api` dir allowed to call it.
const BACKGROUND_SEARCH_FNS: [(&str, Option<&str>); 10] = [
    ("evaluate_scheduled(", None),
    ("run_alert_count_query(", None),
    ("fetch_series(", None),
    ("partitioned_search::", None),
    ("slo::job::", None),
    ("slo::reconcile::", None),
    ("search_slices_page(", None),
    ("red_insights::", None),
    ("SearchAdapter", None),
    (
        "run_dbm_search(",
        Some("api/management/src/request/db_monitoring/"),
    ),
];

const SEARCH_ENTRY: &str = r"(?:search_service|SearchService|crate::search|core_promql::search)::(?:cache::)?(?:search|search_multi|search_partition|search_partition_multi)\(|\bgrpc_search(?:_partition)?\(|process_search_stream_request(?:_multi)?\(|eval_jobs::search::execute|execute_training_query\(";

/// Every production file that calls a search entry point, and how its search is licence-gated.
#[rustfmt::skip]
const SEARCH_CALLERS: [(&str, Caller); 39] = [
    ("api/management/src/request/alert_calibration/digests.rs", Caller::Operational),
    ("api/management/src/request/alerts/history.rs", Caller::Exempt("the org's own alert and anomaly run history; its routes stay open")),
    ("api/management/src/request/dashboards/reports_history.rs", Caller::Exempt("the org's own report run history; its route stays open")),
    ("api/management/src/request/db_monitoring/service/common.rs", Caller::Routed("db_monitoring::handler::")),
    ("api/management/src/request/db_monitoring/service/instance_metrics.rs", Caller::Routed("db_monitoring::handler::")),
    ("api/management/src/request/synthetics/last_check.rs", Caller::Exempt("last check on the synthetics list; its route stays open")),
    ("api/management/src/request/workflows/mod.rs", Caller::Exempt("the org's own workflow run history; its route stays open")),
    ("api/pipelines/src/request/pipelines/history.rs", Caller::Exempt("the org's own pipeline run history; its route stays open")),
    ("api/search/src/profiles/mod.rs", Caller::InHandler),
    ("api/search/src/promql/mod.rs", Caller::InHandler),
    ("api/search/src/rum/lookup/query.rs", Caller::Helper("called by rum lookup, which checks the licence in rum/lookup/mod.rs")),
    ("api/search/src/search/around.rs", Caller::Helper("around v1/v2 check in search/mod.rs; around_multi is in the gated group")),
    ("api/search/src/search/mod.rs", Caller::InHandler),
    ("api/search/src/search/multi_streams.rs", Caller::Routed("search::multi_streams::")),
    ("api/search/src/search/patterns.rs", Caller::Routed("patterns::")),
    ("api/search/src/search/search_inspector.rs", Caller::Exempt("search/profile stays open (D13)")),
    ("api/search/src/search/search_stream.rs", Caller::InHandler),
    ("api/search/src/traces/dag.rs", Caller::InHandler),
    ("api/search/src/traces/details.rs", Caller::Routed("traces::details::")),
    ("api/search/src/traces/list/query.rs", Caller::Helper("latest traces; traces/mod.rs checks the licence")),
    ("api/search/src/traces/list/stream.rs", Caller::Helper("latest traces; traces/mod.rs checks the licence")),
    ("api/search/src/traces/session.rs", Caller::InHandler),
    ("api/search/src/traces/time_index/mod.rs", Caller::InHandler),
    ("api/search/src/traces/user.rs", Caller::InHandler),
    ("core/src/ai_chat.rs", Caller::Operational),
    ("core/src/alerts/alert_calibration/mod.rs", Caller::Background("calibration runs")),
    ("core/src/alerts/mod.rs", Caller::Background("alert evaluation")),
    ("core/src/alerts/notifications/chart/mod.rs", Caller::Background("notification charts")),
    ("core/src/anomaly_detection/partitioned_search.rs", Caller::Background("anomaly detection runs")),
    ("core/src/db_monitoring/rollup.rs", Caller::Background("DBM rollup")),
    ("core/src/downtimes/values.rs", Caller::Routed("downtimes::")),
    ("core/src/metrics/prom.rs", Caller::Routed("promql::label_values")),
    ("core/src/self_reporting/search.rs", Caller::Exempt("licence usage from the meta org")),
    ("core/src/slo/job.rs", Caller::Background("SLO job")),
    ("core/src/slo/reconcile.rs", Caller::Background("SLO reconcile")),
    ("core/src/traces/agent_signals/api.rs", Caller::Routed("traces::get_agent_signals")),
    ("core/src/traces/service_graph/mod.rs", Caller::Routed("traces::get_current_topology")),
    ("jobs/src/job/mod.rs", Caller::Background("eval-job scoring")),
    ("jobs/src/job/red_insights.rs", Caller::Background("red_insights")),
];

/// How a search call site is licence-gated.
enum Caller {
    /// The file calls `check_search_allowed` itself.
    InHandler,
    /// The file serves handlers under this prefix, which sit in the gated group.
    Routed(&'static str),
    /// The file reads only an operational stream.
    Operational,
    Background(&'static str),
    Helper(&'static str),
    Exempt(&'static str),
}

type Registration = (String, String, String);

fn production_source() -> &'static str {
    include_str!("mod.rs")
        .split_once("\n#[cfg(test)]\nmod tests {")
        .unwrap()
        .0
}

fn fn_body<'a>(source: &'a str, signature: &str) -> &'a str {
    let start = source.find(signature).unwrap();
    &source[start..start + source[start..].find("\n}\n").unwrap()]
}

/// The `/api` tree the router serves, minus the gated group.
fn api_span_outside_the_group() -> String {
    let source = production_source();
    let section = |from: &str, to: &str| {
        let start = source.find(from).unwrap();
        &source[start..start + source[start..].find(to).unwrap()]
    };
    let api = section("fn ai_chat_routes(", "pub fn other_service_routes(");
    let group = fn_body(source, "fn search_routes_with(");
    format!(
        "{}{}",
        api.replace(group, ""),
        section("fn es_compat_routes(", "\n}\n")
    )
}

/// Every (method, template, handler) the `.route(` calls in `text` register.
fn registrations(text: &str) -> BTreeSet<Registration> {
    let handler = regex::Regex::new(
        r"(?:^|[\s(.,])(get|post|put|delete|patch|head)\(([A-Za-z_][A-Za-z0-9_:]*)\)",
    )
    .unwrap();
    let mut found = BTreeSet::new();
    for (at, _) in text.match_indices(".route(") {
        let args = &text[at + ".route(".len()..];
        let mut depth = 1;
        let end = args
            .char_indices()
            .find(|(_, c)| {
                depth += match c {
                    '(' => 1,
                    ')' => -1,
                    _ => 0,
                };
                depth == 0
            })
            .unwrap()
            .0;
        let args = &args[..end];
        let template = args.split('"').nth(1).unwrap().to_string();
        for c in handler.captures_iter(args) {
            found.insert((c[1].to_uppercase(), template.clone(), c[2].to_string()));
        }
    }
    found
}

fn gated() -> BTreeSet<Registration> {
    GATED
        .iter()
        .map(|(m, t, h)| (m.to_string(), t.to_string(), h.to_string()))
        .collect()
}

fn module_of(handler: &str) -> &str {
    handler.rsplit_once("::").map_or("", |(module, _)| module)
}

fn search_call_files() -> BTreeSet<String> {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut roots: Vec<_> = std::fs::read_dir(src.join("api"))
        .unwrap()
        .map(|e| e.unwrap().path().join("src"))
        .collect();
    roots.extend(["core/src", "mcp/src", "synthetics/src", "jobs/src"].map(|d| src.join(d)));
    let entry = regex::Regex::new(SEARCH_ENTRY).unwrap();
    let mut hits = BTreeSet::new();
    let mut pending = roots;
    while let Some(path) = pending.pop() {
        if path.is_dir() {
            pending.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
            continue;
        }
        let rel = path
            .strip_prefix(&src)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        // This file quotes the entry pattern, so scanning it would find itself.
        if !rel.ends_with(".rs") || rel.ends_with("router/search_gate_tests.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let production = text.split("\n#[cfg(test)]\nmod tests").next().unwrap();
        if entry.is_match(production) {
            hits.insert(rel);
        }
    }
    hits
}

/// Every production `.rs` file under `src/api`, by path relative to `src`.
fn api_sources() -> Vec<(String, String)> {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut pending = vec![src.join("api")];
    let mut found = Vec::new();
    while let Some(path) = pending.pop() {
        if path.is_dir() {
            pending.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
            continue;
        }
        let rel = path
            .strip_prefix(&src)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if !rel.ends_with(".rs") || rel.ends_with("router/search_gate_tests.rs") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let production = text
            .split("\n#[cfg(test)]\nmod tests")
            .next()
            .unwrap()
            .to_string();
        found.push((rel, production));
    }
    found
}

fn caller_source(file: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(file);
    let text = std::fs::read_to_string(path).unwrap();
    text.split("\n#[cfg(test)]\nmod tests")
        .next()
        .unwrap()
        .to_string()
}

#[cfg(feature = "enterprise")]
fn filled(template: &str) -> String {
    template
        .split('/')
        .map(|segment| match segment {
            "{org_id}" => "acme".to_string(),
            "{stream_name}" => "s1".to_string(),
            "{job_id}" => "j1".to_string(),
            "{stream_names}" => config::utils::base64::encode_url("s1"),
            s if s.starts_with('{') => "p1".to_string(),
            s => s.to_string(),
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[test]
fn search_routes_hold_exactly_the_gated_routes() {
    let group = registrations(fn_body(production_source(), "fn search_routes_with("));
    assert_eq!(group, gated());
}

#[test]
fn no_gated_handler_is_registered_outside_search_routes() {
    let outside = registrations(&api_span_outside_the_group());
    let gated_handlers: BTreeSet<String> = GATED.iter().map(|(_, _, h)| h.to_string()).collect();
    let siblings: BTreeSet<&str> = UNGATED_SIBLINGS.iter().map(|(h, _)| *h).collect();
    let mut seen_siblings = BTreeSet::new();
    for (method, template, handler) in &outside {
        let route = format!("{method} {template} {handler}");
        assert!(
            !gated_handlers.contains(handler),
            "gated handler outside the group: {route}"
        );
        assert!(
            !FULLY_GATED_MODULES.iter().any(|m| handler.starts_with(m)),
            "a fully gated module registers outside the group: {route}"
        );
        if MIXED_MODULES.contains(&module_of(handler)) {
            assert!(
                siblings.contains(handler.as_str()),
                "unclassified handler: {route}"
            );
            seen_siblings.insert(handler.as_str());
        }
    }
    assert_eq!(
        seen_siblings, siblings,
        "UNGATED_SIBLINGS lists a handler no route registers"
    );
    assert!(
        UNGATED_SIBLINGS
            .iter()
            .all(|(_, reason)| !reason.is_empty())
    );
}

#[test]
fn operational_reads_stay_outside_the_gate() {
    let group: BTreeSet<String> =
        registrations(fn_body(production_source(), "fn search_routes_with("))
            .into_iter()
            .map(|(_, template, _)| template)
            .collect();
    let outside: BTreeSet<String> = registrations(&api_span_outside_the_group())
        .into_iter()
        .map(|(_, template, _)| template)
        .collect();
    for template in OPERATIONAL_READS {
        assert!(
            outside.contains(template),
            "{template} is no longer registered"
        );
        assert!(
            !group.contains(template),
            "{template} must stay outside the gate"
        );
    }
}

#[test]
fn the_gate_is_a_route_layer_on_the_group_only() {
    let source = production_source();
    assert_eq!(
        source.matches("from_fn(search_license_middleware)").count(),
        1
    );
    assert!(
        fn_body(source, "fn search_routes_with(")
            .contains(".route_layer(middleware::from_fn(search_license_middleware))")
    );
    assert!(!source.contains(".layer(middleware::from_fn(search_license_middleware"));
}

#[tokio::test]
async fn route_layer_does_not_reach_methods_merged_on_the_same_path() {
    const PATH: &str = "/v2/{org_id}/downtimes/values";
    let _built = Router::new()
        .merge(search_routes_with(false))
        .route(PATH, get(|| async { "stub" }));
    let closed = middleware::from_fn(|_: Request, _: Next| async {
        common::meta::http::HttpResponse::too_many_requests("blocked")
    });
    let app = Router::new()
        .merge(
            Router::new()
                .route(PATH, post(|| async { "gated" }))
                .route_layer(closed),
        )
        .route(PATH, get(|| async { "open" }));
    let send = |method: Method| {
        app.clone().oneshot(
            axum::http::Request::builder()
                .method(method)
                .uri("/v2/acme/downtimes/values")
                .body(Body::empty())
                .unwrap(),
        )
    };
    assert_eq!(send(Method::GET).await.unwrap().status(), StatusCode::OK);
    assert_eq!(
        send(Method::POST).await.unwrap().status(),
        StatusCode::TOO_MANY_REQUESTS
    );
}

#[test]
fn every_search_call_site_is_classified() {
    let listed: BTreeSet<String> = SEARCH_CALLERS.iter().map(|(f, _)| f.to_string()).collect();
    assert_eq!(
        search_call_files(),
        listed,
        "classify every search call site in SEARCH_CALLERS"
    );
    let operational = ["DIGEST_STREAM", "AI_CHAT_EVENTS_STREAM"]
        .into_iter()
        .chain(search_service::OPERATIONAL_STREAMS);
    let operational: Vec<&str> = operational.collect();
    for (file, class) in SEARCH_CALLERS {
        match class {
            Caller::InHandler => {
                assert!(
                    caller_source(file).contains("check_search_allowed("),
                    "{file}"
                )
            }
            Caller::Routed(prefix) => {
                assert!(
                    GATED.iter().any(|(_, _, h)| h.starts_with(prefix)),
                    "{file}"
                )
            }
            Caller::Operational => {
                let text = caller_source(file);
                assert!(operational.iter().any(|name| text.contains(name)), "{file}")
            }
            Caller::Background(reason) | Caller::Helper(reason) | Caller::Exempt(reason) => {
                assert!(!reason.is_empty(), "{file}")
            }
        }
    }
}

#[test]
fn no_api_handler_reaches_a_background_search() {
    for (file, text) in api_sources() {
        for (needle, allowed) in BACKGROUND_SEARCH_FNS {
            let permitted = allowed.is_some_and(|dir| file.starts_with(dir));
            assert!(
                permitted || !text.contains(needle),
                "{file} calls the background search {needle}; gate its route or classify it"
            );
        }
    }
}

#[cfg(feature = "enterprise")]
#[tokio::test]
async fn closed_gate_refuses_every_gated_route() {
    use o2_enterprise::enterprise::license::close_search_gate_for_tests;

    let _gate = close_search_gate_for_tests().await;
    let app = search_routes_with(true);
    for (method, template, handler) in GATED {
        let request = axum::http::Request::builder()
            .method(method)
            .uri(filled(template))
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "{method} {template} {handler}"
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["code"], 429, "{template}");
        let message = json["message"].as_str().unwrap();
        assert!(
            message.starts_with(
                "Error# Search is temporarily disabled due to exceeding allotted ingestion limit."
            ) && message.ends_with("Please contact your administrator."),
            "{template}: {message}"
        );
    }
}

#[cfg(feature = "enterprise")]
#[tokio::test]
async fn an_operational_stream_in_the_path_does_not_open_the_gate() {
    use o2_enterprise::enterprise::license::close_search_gate_for_tests;

    let _gate = close_search_gate_for_tests().await;
    let request = axum::http::Request::post("/acme/streams/_o2_ai_chat_events/patterns/extract")
        .body(Body::empty())
        .unwrap();
    let response = search_routes_with(true).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[cfg(feature = "enterprise")]
#[tokio::test]
async fn meta_org_passes_the_closed_gate() {
    use o2_enterprise::enterprise::license::close_search_gate_for_tests;

    let _gate = close_search_gate_for_tests().await;
    let request = axum::http::Request::post(format!("/{}/_search_multi", config::META_ORG_ID))
        .body(Body::empty())
        .unwrap();
    let response = search_routes_with(true).oneshot(request).await.unwrap();
    assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[cfg(feature = "enterprise")]
#[tokio::test]
async fn open_gate_lets_a_gated_route_through() {
    let _held = o2_enterprise::enterprise::license::TEST_STATICS_LOCK
        .lock()
        .await;
    let app = Router::new()
        .route("/{org_id}/{stream_name}/probe", get(|| async { "ok" }))
        .route_layer(middleware::from_fn(search_license_middleware));
    let request = axum::http::Request::get("/acme/logs/probe")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::OK);
}
