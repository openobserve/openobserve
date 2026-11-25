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

use std::sync::Arc;

use arrow_schema::DataType;
use config::meta::{
    alerts::{Condition, Operator},
    stream::StreamType,
};
use serde_json::json;

use super::{
    index::{IndexState, IndexedEntry, LibraryIndex, ManifestEntry},
    *,
};

// Trimmed copies of published library entries, one per shape the phase 2 hit-rate study found.
fn library() -> IndexState {
    let sql = |id: &str, t: &str, stream: &str, severity: &str, q: &str| {
        let (pack, name) = id.split_once('/').unwrap();
        let entry = ManifestEntry {
            id: id.into(),
            name: name.into(),
            pack: pack.into(),
            title: name.into(),
            severity: severity.into(),
            stream: stream.into(),
            stream_type: t.into(),
            query_type: "sql".into(),
            path: format!("packs/{id}.json"),
            ..Default::default()
        };
        let file = json!({"name": name, "stream_type": t, "stream_name": stream, "destinations": ["x"],
            "query_condition": {"type": "sql", "sql": q},
            "trigger_condition": {"period": 10, "operator": ">=", "threshold": 1, "frequency": 5}});
        IndexedEntry::new(entry, false, file)
    };
    let anomaly = IndexedEntry::new(
        sql(
            "k8s/logs_stderr_ratio_anomaly",
            "logs",
            "default",
            "info",
            "",
        )
        .entry,
        true,
        json!({"stream_name": "default", "anomaly_config": {"custom_sql":
            "SELECT histogram(_timestamp, '5m') AS b, SUM(CASE WHEN log_iostream = 'stderr' THEN 1 ELSE 0 END) AS r FROM \"default\" GROUP BY b",
            "detection_function_field": "r"}}),
    );
    let ratio = IndexedEntry::new(
        ManifestEntry {
            id: "cloud/alb_5xx_ratio".into(),
            name: "alb_5xx_ratio".into(),
            pack: "cloud".into(),
            title: "ALB 5xx ratio".into(),
            severity: "critical".into(),
            stream: "alb_5xx_count".into(),
            stream_type: "metrics".into(),
            query_type: "promql".into(),
            ..Default::default()
        },
        false,
        json!({"query_condition": {"type": "promql",
            "promql": "sum by (load_balancer) (alb_5xx_count) / sum by (load_balancer) (alb_request_count)",
            "promql_condition": {"column": "value", "operator": ">", "value": 0.05}}}),
    );
    let entries = vec![
        sql(
            "ai/llm_error_rate_high",
            "traces",
            "default",
            "critical",
            "SELECT service_name, COUNT(*) AS calls FROM \"default\" WHERE gen_ai_operation_name IN ('chat') AND span_status = 'ERROR' GROUP BY service_name",
        ),
        sql(
            "apm/service_error_rate_high",
            "traces",
            "default",
            "critical",
            "SELECT service_name, SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS error_pct FROM \"default\" WHERE span_kind IN ('2', '5') GROUP BY service_name",
        ),
        sql(
            "k8s/high_warning_event_rate",
            "logs",
            "k8s_events",
            "warning",
            "SELECT count(*) as event_count, k8s_cluster FROM \"k8s_events\" WHERE k8s_resource_name = 'events' AND body_object_type = 'Warning' GROUP BY k8s_cluster HAVING event_count > 100",
        ),
        sql(
            "k8s/oom_killing_events",
            "logs",
            "k8s_events",
            "critical",
            "SELECT count(*) as event_count, k8s_cluster FROM \"k8s_events\" WHERE body_object_type = 'Warning' AND str_match(body_object_reason, 'OOMKilling') GROUP BY k8s_cluster",
        ),
        sql(
            "ci/logs_stopped",
            "logs",
            "githubactions",
            "warning",
            "SELECT count(*) AS n FROM \"githubactions\" WHERE job_id IS NOT NULL HAVING count(*) > 0",
        ),
        anomaly,
        ratio,
    ];
    IndexState::Ready(Arc::new(LibraryIndex {
        version: "v1".into(),
        entries,
    }))
}

fn request(t: StreamType, name: &str, cols: &[&str], fresh: bool, anomaly: bool) -> SuggestRequest {
    SuggestRequest {
        facts: StreamFacts {
            stream_type: t,
            name: name.into(),
            columns: cols.iter().map(|c| c.to_string()).collect(),
            fresh,
            metrics: ["alb_5xx_count", "alb_request_count"]
                .iter()
                .map(|m| m.to_string())
                .collect(),
        },
        fields: cols
            .iter()
            .map(|c| (c.to_string(), DataType::Utf8))
            .collect(),
        anomaly,
        limit: DEFAULT_LIMIT,
        existing: Vec::new(),
    }
}

fn library_ids(resp: &SuggestResponse) -> Vec<(String, Fit, bool)> {
    resp.suggestions
        .iter()
        .filter(|s| s.kind == SuggestionKind::Library)
        .map(|s| (s.id.clone(), s.fit, s.stream_swap.is_some()))
        .collect()
}

#[test]
fn suggestions_reproduce_the_hit_rate_study_shapes() {
    use Fit::*;
    let lib = library();
    let k8s_cols = [
        "k8s_cluster",
        "k8s_resource_name",
        "body_object_type",
        "body_object_reason",
    ];
    let trace_cols = ["service_name", "span_kind", "span_status", "duration"];
    let app_cols = ["body", "level", "log_iostream", "job_id"];
    let row = |id: &str, fit: Fit, swap: bool| (id.to_string(), fit, swap);
    // (request, expected library suggestions in rank order)
    let cases = vec![
        // traces: product-shaped schemas fit the APM entries by swap; gen-AI ones need their
        // columns
        (
            request(StreamType::Traces, "svc_traces", &trace_cols, true, false),
            vec![row("apm/service_error_rate_high", Fits, true)],
        ),
        (
            request(
                StreamType::Traces,
                "default",
                &[&trace_cols[..], &["gen_ai_operation_name"]].concat(),
                true,
                false,
            ),
            vec![
                row("ai/llm_error_rate_high", Fits, false),
                row("apm/service_error_rate_high", Fits, false),
            ],
        ),
        // logs: k8s-event-shaped streams under another name, critical first; stale reads Likely
        (
            request(StreamType::Logs, "cluster_events", &k8s_cols, true, false),
            vec![
                row("k8s/oom_killing_events", Fits, true),
                row("k8s/high_warning_event_rate", Fits, true),
            ],
        ),
        (
            request(StreamType::Logs, "k8s_events", &k8s_cols, false, false),
            vec![
                row("k8s/oom_killing_events", Likely, false),
                row("k8s/high_warning_event_rate", Likely, false),
            ],
        ),
        // a swap resting on one generic column is only Likely (the study's one precision miss)
        (
            request(StreamType::Logs, "app_logs", &app_cols, true, false),
            vec![row("ci/logs_stopped", Likely, true)],
        ),
        (
            request(StreamType::Logs, "app_logs", &app_cols, true, true),
            vec![row("k8s/logs_stderr_ratio_anomaly", Likely, true)],
        ),
        // metrics: the ratio is offered on its denominator; a missing `by` label makes it Likely
        (
            request(
                StreamType::Metrics,
                "alb_request_count",
                &["load_balancer"],
                true,
                false,
            ),
            vec![row("cloud/alb_5xx_ratio", Fits, false)],
        ),
        (
            request(
                StreamType::Metrics,
                "alb_5xx_count",
                &["region"],
                true,
                false,
            ),
            vec![row("cloud/alb_5xx_ratio", Likely, false)],
        ),
        (
            request(
                StreamType::Metrics,
                "unrelated_total",
                &["load_balancer"],
                true,
                false,
            ),
            vec![],
        ),
    ];
    for (i, (req, expected)) in cases.into_iter().enumerate() {
        let resp = suggest_with(&lib, &req);
        assert_eq!(library_ids(&resp), expected, "case {i}");
        assert_eq!(
            resp.counts.total,
            resp.counts.fits + resp.counts.likely,
            "case {i}"
        );
    }
}

#[test]
fn already_set_up_needs_the_same_query_and_condition_and_ranks_last() {
    use Operator::{GreaterThan, GreaterThanEquals};
    let lib = library();
    let k8s_cols = [
        "k8s_cluster",
        "k8s_resource_name",
        "body_object_type",
        "body_object_reason",
    ];
    let logs = request(StreamType::Logs, "cluster_events", &k8s_cols, true, false);
    let metrics = request(
        StreamType::Metrics,
        "alb_request_count",
        &["load_balancer"],
        true,
        false,
    );
    let oom = "select COUNT(*) as event_count, k8s_cluster from cluster_events\n where body_object_type = 'Warning' and str_match(body_object_reason, 'OOMKilling') group by k8s_cluster";
    let alert = |edit: &dyn Fn(&mut Alert)| {
        let mut a = Alert::default();
        edit(&mut a);
        a
    };
    let sql = |query: &str, operator: Operator, threshold: i64| {
        let query = query.to_string();
        alert(&move |a| {
            a.stream_name = "cluster_events".into();
            a.query_condition.query_type = QueryType::SQL;
            a.query_condition.sql = Some(query.clone());
            a.trigger_condition.operator = operator;
            a.trigger_condition.threshold = threshold;
        })
    };
    let promql = |value: serde_json::Value| {
        alert(&move |a| {
            a.query_condition.query_type = QueryType::PromQL;
            a.query_condition.promql = Some(
                "sum by (load_balancer) (alb_5xx_count)  /  sum by (load_balancer) (alb_request_count)"
                    .into(),
            );
            a.query_condition.promql_condition = Some(Condition {
                column: "value".into(),
                operator: GreaterThan,
                value: value.clone(),
                ignore_case: false,
                case_insensitive: None,
            });
        })
    };
    let mut library_id_only = sql("SELECT 1 FROM cluster_events", GreaterThanEquals, 1);
    library_id_only.context_attributes =
        Some([("library_id".into(), "k8s/oom_killing_events".into())].into());
    let mut pack_tag_only = sql("SELECT 1 FROM cluster_events", GreaterThanEquals, 1);
    pack_tag_only.name = "oom_killing_events".into();
    pack_tag_only.tags = vec!["pack:k8s".into()];
    let cases = [
        (
            &logs,
            sql(oom, GreaterThanEquals, 1),
            vec!["k8s/oom_killing_events"],
        ),
        (&logs, sql(oom, GreaterThanEquals, 2), vec![]),
        (&logs, sql(oom, GreaterThan, 1), vec![]),
        (&logs, library_id_only, vec![]),
        (&logs, pack_tag_only, vec![]),
        (
            &metrics,
            promql(json!("0.050")),
            vec!["cloud/alb_5xx_ratio"],
        ),
        (&metrics, promql(json!(0.1)), vec![]),
    ];
    for (i, (req, alert, expected)) in cases.into_iter().enumerate() {
        let mut req = req.clone();
        req.existing = vec![ExistingAlert::of(&alert)];
        let resp = suggest_with(&lib, &req);
        let tied: Vec<_> = resp
            .suggestions
            .iter()
            .filter(|s| !s.already_set_up.is_empty())
            .map(|s| s.id.as_str())
            .collect();
        assert_eq!(tied, expected, "case {i}");
        assert_eq!(resp.counts.already_set_up, expected.len(), "case {i}");
        let last = library_ids(&resp).pop().map(|(id, ..)| id);
        assert!(
            expected.is_empty() || last.as_deref() == Some(expected[0]),
            "case {i}"
        );
    }
    let mut capped = logs.clone();
    capped.limit = 1;
    let resp = suggest_with(&lib, &capped);
    assert_eq!(
        (library_ids(&resp).len(), resp.counts.total),
        (1, 2),
        "limit caps rows, not counts"
    );
}

#[test]
fn prefill_swaps_only_the_stream_identifier_and_never_sets_name_or_destinations() {
    let lib = library();
    let req = request(
        StreamType::Logs,
        "cluster_events",
        &[
            "k8s_cluster",
            "k8s_resource_name",
            "body_object_type",
            "body_object_reason",
        ],
        true,
        false,
    );
    let resp = suggest_with(&lib, &req);
    let oom = resp
        .suggestions
        .iter()
        .find(|s| s.id == "k8s/oom_killing_events")
        .unwrap();
    let sql = oom
        .prefill
        .pointer("/query_condition/sql")
        .and_then(|v| v.as_str())
        .unwrap();
    assert!(sql.contains("FROM \"cluster_events\" WHERE"), "{sql}");
    assert_eq!(oom.prefill["stream_name"], "cluster_events");
    assert!(oom.prefill.get("name").is_none() && oom.prefill.get("destinations").is_none());
    assert_eq!(
        oom.stream_swap,
        Some(StreamSwap {
            written_for: "k8s_events".into(),
            will_use: "cluster_events".into()
        })
    );
}

#[test]
fn an_unreachable_library_still_answers_with_starters() {
    let req = request(StreamType::Logs, "app_logs", &["level"], true, false);
    let resp = suggest_with(&IndexState::Unavailable, &req);
    assert_eq!(resp.library, LibraryState::Unavailable);
    assert_eq!((resp.counts.total, resp.counts.starters), (0, 3));
    assert!(
        resp.suggestions
            .iter()
            .all(|s| s.kind == SuggestionKind::Starter)
    );
    let metrics = request(StreamType::Metrics, "m", &["level"], true, false);
    assert!(
        suggest_with(&IndexState::Unavailable, &metrics)
            .suggestions
            .is_empty()
    );
}
