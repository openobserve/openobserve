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

use common::meta::http::HttpResponse;
use config::meta::promql::{
    ApiFuncResponse, QueryResult,
    value::{Exemplar, InstantValue, Label, Labels, RangeValue, Sample, Value as PromValue},
};
use serde_json::{Value, json};

use super::{JSON, find_op, published_ops, published_spec};

// Doc-only unions over shapes that can overlap, so each must be anyOf, never oneOf.
const UNION_COMPONENTS: &[&str] = &[
    "CloneAlertAnswer",
    "CreateLocationAnswer",
    "JobAckAnswer",
    "LatestTracesAnswer",
    "ResolvedVariablesAnswer",
    "SaveUserAnswer",
    "UpdateFunctionAnswer",
    "UpdateServiceAccountAnswer",
];

/// Panics with every validation error unless each answer fits the op's published 200 body.
fn assert_fits(method: &str, path: &str, answers: &[Value]) {
    assert_fits_status(method, path, "200", answers);
}

fn assert_fits_status(method: &str, path: &str, status: &str, answers: &[Value]) {
    let validator = response_validator(method, path, status);
    for answer in answers {
        let errors: Vec<String> = validator
            .iter_errors(answer)
            .map(|error| format!("{} at {}", error, error.instance_path()))
            .collect();
        assert!(
            errors.is_empty(),
            "{method} {path} {status} rejects {answer}: {errors:?}"
        );
    }
}

fn response_validator(method: &str, path: &str, status: &str) -> jsonschema::Validator {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, method, path).unwrap_or_else(|| panic!("{method} {path} unpublished"));
    let mut root = op["responses"][status]["content"][JSON]["schema"].clone();
    assert!(
        root.is_object(),
        "{method} {path} has no JSON {status} schema"
    );
    root["components"] = spec["components"].clone();
    jsonschema::draft202012::new(&root).unwrap()
}

/// The schema a response publishes for `media`, with any `$ref` followed.
fn media_schema(method: &str, path: &str, status: &str, media: &str) -> Value {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, method, path).unwrap_or_else(|| panic!("{method} {path} unpublished"));
    let schema = &op["responses"][status]["content"][media]["schema"];
    super::resolved(&spec, schema).clone()
}

#[cfg(feature = "cloud")]
fn default_answer<F, Fut, T, E>(_: F) -> T
where
    F: FnOnce(&'static str, &'static str) -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    T: Default,
{
    T::default()
}

fn to_json(value: impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

fn ok_message(message: &str) -> Value {
    to_json(HttpResponse::message(200u16, message))
}

fn labels(pairs: &[(&str, &str)]) -> Labels {
    pairs
        .iter()
        .map(|(name, value)| Arc::new(Label::new(*name, *value)))
        .collect()
}

fn sample(seconds: i64, value: f64) -> Sample {
    Sample {
        timestamp: seconds * 1_000_000,
        value,
    }
}

fn range(with_exemplars: bool) -> RangeValue {
    let exemplar = Exemplar {
        timestamp: 1_600_096_945_000_000,
        value: 6.0,
        labels: labels(&[("trace_id", "EpTxMJ40fUus7aGY")]),
    };
    RangeValue {
        labels: labels(&[("__name__", "up"), ("job", "node")]),
        samples: vec![sample(1_700_000_000, 1.0), sample(1_700_000_015, 0.5)],
        exemplars: with_exemplars.then(|| vec![Arc::new(exemplar)]),
        time_window: None,
    }
}

/// Every `value::Value` variant the engine can hand back.
fn prom_values() -> Vec<PromValue> {
    let instant = InstantValue {
        labels: labels(&[("__name__", "up")]),
        sample: sample(1_700_000_000, 1.0),
    };
    vec![
        PromValue::Instant(instant.clone()),
        PromValue::Range(range(false)),
        PromValue::Range(range(true)),
        PromValue::Vector(vec![instant.clone(), instant]),
        PromValue::Vector(vec![]),
        PromValue::Matrix(vec![range(false), range(false)]),
        PromValue::Matrix(vec![range(true)]),
        PromValue::Sample(sample(1_700_000_000, f64::NAN)),
        PromValue::Float(2.5),
        PromValue::String("text".to_string()),
        PromValue::None,
    ]
}

fn ack_response() -> openobserve_synthetics::job_api::AckResponse {
    openobserve_synthetics::job_api::AckResponse {
        run_complete: true,
        run_status: None,
        job_count: 2,
        org_id: "default".to_string(),
        job_id: "job".to_string(),
        run_id: "run".to_string(),
        synthetics_id: "check".to_string(),
        synthetics_name: "Check".to_string(),
        synthetic_type: "http".to_string(),
        target: "https://example.com".to_string(),
        destinations: vec!["email".to_string()],
        location: "us-east".to_string(),
        pool: "public".to_string(),
        trigger_type: "scheduled".to_string(),
        alert: Default::default(),
        status_reason: Some("certificate".to_string()),
        consecutive_failures: 0,
        failing_locations: vec![],
        passing_locations: vec!["us-east".to_string()],
        usage_events: vec![],
        failing_environments: vec![],
        suppressed_by: None,
    }
}

#[cfg(feature = "enterprise")]
fn anomaly_clone_answer() -> Value {
    use infra::table::entity::anomaly_detection_config::Model;

    let row = Model {
        anomaly_id: "2abc".to_string(),
        org_id: "default".to_string(),
        stream_name: "logs".to_string(),
        stream_type: "logs".to_string(),
        enabled: true,
        name: "spike_copy".to_string(),
        description: None,
        query_mode: "filters".to_string(),
        filters: Some(json!([])),
        custom_sql: None,
        detection_function: "count".to_string(),
        histogram_interval: "5m".to_string(),
        schedule_interval: "5m".to_string(),
        detection_window_seconds: 3600,
        training_window_days: 14,
        retrain_interval_days: 7,
        threshold: 97,
        alert_budget_per_day: None,
        level_half_width_seconds: None,
        band_width: None,
        alert_direction: None,
        alert_window_buckets: None,
        alert_window_fire_pct: None,
        alert_window_recover_pct: None,
        band_grouping: None,
        band_k: None,
        seasonality: "hour".to_string(),
        is_trained: false,
        training_started_at: None,
        training_completed_at: None,
        last_error: None,
        last_processed_timestamp: None,
        current_model_version: 0,
        rcf_num_trees: 100,
        rcf_tree_size: 256,
        rcf_shingle_size: 8,
        alert_enabled: true,
        alert_destinations: Some(json!(["email"])),
        folder_id: "2folderpk".to_string(),
        owner: Some("root@example.com".to_string()),
        priority: None,
        tags: None,
        status: 0,
        retries: 0,
        last_failed_at: None,
        last_alert_fired_at: None,
        last_recovery_notified_at: None,
        detection_lease_us: None,
        last_updated: 1,
        created_at: 1,
        updated_at: 1,
    };
    let mut answer = to_json(row);
    answer["status"] = json!(o2_enterprise::enterprise::anomaly_detection::types::Status::label(0));
    answer["notice_class"] = Value::Null;
    answer["folder_id"] = json!("default");
    answer
}

/// The list_workflows row: the flattened stored workflow with the resolved folder laid over it.
#[cfg(feature = "enterprise")]
fn workflow_list_answer(folder: Option<(&str, &str)>, is_draft: bool) -> Value {
    let workflow = infra::table::workflows::Workflow {
        id: "wf".to_string(),
        org_id: "default".to_string(),
        folder_id: "2folderpk".to_string(),
        created_at: 1,
        updated_at: 1,
        created_by: "root@example.com".to_string(),
        enabled: true,
        name: "flow".to_string(),
        description: String::new(),
        nodes: vec![],
        edges: vec![],
    };
    let mut answer = to_json(workflow);
    answer["associations"] = json!([]);
    answer["is_draft"] = json!(is_draft);
    answer["folder_id"] = json!(folder.map(|(slug, _)| slug));
    if let Some((_, display)) = folder {
        answer["folder_name"] = json!(display);
    }
    answer
}

#[test]
fn response_unions_are_any_of() {
    let spec = published_spec();
    for name in UNION_COMPONENTS {
        let schema = &spec["components"]["schemas"][*name];
        assert!(schema["anyOf"].is_array(), "{name} is not anyOf: {schema}");
        assert!(schema.get("oneOf").is_none(), "{name}: {schema}");
    }
}

#[test]
fn prometheus_query_and_range_accept_every_value_variant() {
    let mut answers: Vec<Value> = prom_values()
        .into_iter()
        .map(|value| {
            to_json(ApiFuncResponse::ok_with_warnings(
                QueryResult {
                    result_type: value.get_type().to_string(),
                    result: value,
                },
                vec!["partial".to_string()],
                Some("trace".to_string()),
            ))
        })
        .collect();
    answers.push(to_json(ApiFuncResponse::ok(
        QueryResult {
            result_type: "scalar".to_string(),
            result: PromValue::Float(1.0),
        },
        None,
    )));
    for path in ["query", "query_range"] {
        for method in ["GET", "POST"] {
            assert_fits(
                method,
                &format!("/api/{{org_id}}/prometheus/api/v1/{path}"),
                &answers,
            );
        }
    }
}

#[test]
fn prometheus_query_rejects_a_sample_that_is_not_a_pair() {
    let spec = published_spec();
    let ops = published_ops(&spec);
    let op = find_op(&ops, "GET", "/api/{org_id}/prometheus/api/v1/query").unwrap();
    let mut root = op["responses"]["200"]["content"][JSON]["schema"].clone();
    root["components"] = spec["components"].clone();
    let validator = jsonschema::draft202012::new(&root).unwrap();
    let flat = json!({"status": "success", "data": {"resultType": "vector", "result": [{"metric": {}, "value": 1}]}});
    assert!(!validator.is_valid(&flat));
    let unknown = json!({"status": "success", "data": {"resultType": "table", "result": null}});
    assert!(!validator.is_valid(&unknown));
}

#[test]
fn prometheus_exemplars_accept_the_engine_answers() {
    let answers: Vec<Value> = [PromValue::Matrix(vec![range(true)]), PromValue::None]
        .into_iter()
        .map(|value| to_json(ApiFuncResponse::ok(value, Some("trace".to_string()))))
        .collect();
    for method in ["GET", "POST"] {
        assert_fits(
            method,
            "/api/{org_id}/prometheus/api/v1/query_exemplars",
            &answers,
        );
    }
}

#[test]
fn save_user_accepts_both_answers() {
    let service_account = common::meta::service_account::ServiceAccountCreateResponse {
        code: 200,
        message: "User saved successfully".to_string(),
        token: "token".to_string(),
        user: "sa@example.com".to_string(),
    };
    assert_fits(
        "POST",
        "/api/{org_id}/users",
        &[
            to_json(service_account),
            ok_message("User saved successfully"),
        ],
    );
}

#[test]
fn save_user_union_as_one_of_would_reject_the_service_account_answer() {
    let mut spec = published_spec();
    let union = &mut spec["components"]["schemas"]["SaveUserAnswer"];
    let items = union["anyOf"].take();
    *union = json!({"oneOf": items});
    let root =
        json!({"$ref": "#/components/schemas/SaveUserAnswer", "components": spec["components"]});
    let validator = jsonschema::draft202012::new(&root).unwrap();
    let service_account = to_json(
        common::meta::service_account::ServiceAccountCreateResponse {
            code: 200,
            message: "User saved successfully".to_string(),
            token: "token".to_string(),
            user: "sa@example.com".to_string(),
        },
    );
    assert!(!validator.is_valid(&service_account));
}

#[test]
fn update_service_account_accepts_both_answers() {
    let rotated = common::meta::service_account::APIToken {
        token: "token".to_string(),
        user: "sa@example.com".to_string(),
    };
    assert_fits(
        "PUT",
        "/api/{org_id}/service_accounts/{email_id}",
        &[
            to_json(rotated),
            ok_message("Service Account updated successfully"),
        ],
    );
}

#[test]
fn update_function_accepts_both_answers() {
    let unchanged = config::meta::function::Transform {
        function: ".a = 1".to_string(),
        name: "f".to_string(),
        params: "row".to_string(),
        num_args: 1,
        trans_type: Some(0),
        streams: None,
    };
    assert_fits(
        "PUT",
        "/api/{org_id}/functions/{name}",
        &[
            to_json(unchanged),
            ok_message("Function updated successfully"),
        ],
    );
}

#[test]
fn latest_traces_accepts_both_answers() {
    let page = config::meta::search::PaginatedResponse {
        took: 3,
        total: 1,
        from: 0,
        size: 10,
        hits: vec![json!({"trace_id": "t"})],
        trace_id: "trace".to_string(),
        function_error: String::new(),
    };
    assert_fits(
        "GET",
        "/api/{org_id}/{stream_name}/traces/latest",
        &[
            to_json(config::meta::search::Response::default()),
            to_json(page),
            to_json(config::meta::search::PaginatedResponse::default()),
        ],
    );
}

#[test]
fn resolved_variables_accepts_flat_and_grouped() {
    use config::meta::synthetics_variables::{ResolvedVariableView, ResolvedVariablesGrouped};

    let view = ResolvedVariableView {
        name: "host".to_string(),
        scope: "global".to_string(),
        ..Default::default()
    };
    let grouped = ResolvedVariablesGrouped {
        environments: vec![String::new()],
        resolved: [(String::new(), vec![view.clone()])].into_iter().collect(),
    };
    assert_fits(
        "GET",
        "/api/{org_id}/synthetics/{id}/resolved-variables",
        &[
            to_json(vec![view]),
            to_json(Vec::<ResolvedVariableView>::new()),
            to_json(grouped),
        ],
    );
}

#[test]
fn job_ack_accepts_one_ack_and_a_batch() {
    // The batch rows are the json! literals job_ack builds.
    let batch = json!({"results": [
        {"job_id": "a", "ok": true, "run_complete": false},
        {"job_id": "b", "ok": false, "error": "late ack"},
    ]});
    assert_fits(
        "POST",
        "/api/{org_id}/synthetics/jobs/ack",
        &[to_json(ack_response()), batch, json!({"results": []})],
    );
}

#[test]
fn create_location_accepts_one_location_and_a_batch() {
    let created = openobserve_synthetics::service::CreateLocationResponse {
        location: infra::table::synthetics_locations::SyntheticsLocationRecord {
            id: "loc".to_string(),
            org_id: Some("default".to_string()),
            kind: "private".to_string(),
            provider: "self".to_string(),
            region: "r".to_string(),
            label: "l".to_string(),
            pool: "pool".to_string(),
            enabled: true,
            created_at: 1,
            updated_at: 1,
        },
        token: Some("o2syn_token".to_string()),
        install: None,
    };
    // The batch rows are the json! literals the create_location handler builds.
    let batch = json!({"results": [
        {"id": "loc", "pool": "pool", "ok": true},
        {"label": "l", "ok": false, "error": "forbidden"},
    ]});
    assert_fits(
        "POST",
        "/api/{org_id}/synthetics/locations",
        &[to_json(created), batch],
    );
}

#[test]
fn clone_alert_accepts_scheduled_and_composite_answers() {
    // The composite answer is the json! literal clone_alert builds.
    let composite = json!({"id": "c", "name": "copy", "alert_type": "composite"});
    let scheduled = config::meta::alerts::alert::Alert::default();
    assert_fits(
        "POST",
        "/api/v2/{org_id}/alerts/{alert_id}/clone",
        &[to_json(scheduled), composite],
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn clone_alert_accepts_the_anomaly_clone_answer() {
    assert_fits(
        "POST",
        "/api/v2/{org_id}/alerts/{alert_id}/clone",
        &[anomaly_clone_answer()],
    );
    let spec = published_spec();
    let union = &spec["components"]["schemas"]["CloneAlertAnswer"];
    assert_eq!(union["anyOf"].as_array().map(Vec::len), Some(3), "{union}");
}

#[cfg(feature = "enterprise")]
#[test]
fn list_workflows_accepts_resolved_and_unresolved_folders() {
    let resolved = workflow_list_answer(Some(("default", "Default")), false);
    let unresolved = workflow_list_answer(None, true);
    assert_eq!(unresolved["folder_id"], Value::Null);
    assert!(unresolved.get("folder_name").is_none());
    assert_fits(
        "GET",
        "/api/{org_id}/workflows",
        &[json!([resolved, unresolved]), json!([])],
    );
}

#[test]
fn otlp_export_answers_fit_their_json_schemas() {
    use common::meta::otlp::export_response_to_proto_json as to_proto_json;
    use opentelemetry_proto::tonic::collector::{
        logs::v1::{ExportLogsPartialSuccess, ExportLogsServiceResponse},
        metrics::v1::{ExportMetricsPartialSuccess, ExportMetricsServiceResponse},
        profiles::v1development::{ExportProfilesPartialSuccess, ExportProfilesServiceResponse},
        trace::v1::{ExportTracePartialSuccess, ExportTraceServiceResponse},
    };

    let cases = [(0, ""), (3, "bad records"), (0, "a warning"), (5, "")];
    let logs: Vec<Value> = cases
        .iter()
        .map(|(rejected, message)| {
            to_proto_json(&ExportLogsServiceResponse {
                partial_success: Some(ExportLogsPartialSuccess {
                    rejected_log_records: *rejected,
                    error_message: message.to_string(),
                }),
            })
        })
        .collect();
    let metrics: Vec<Value> = cases
        .iter()
        .map(|(rejected, message)| {
            to_proto_json(&ExportMetricsServiceResponse {
                partial_success: Some(ExportMetricsPartialSuccess {
                    rejected_data_points: *rejected,
                    error_message: message.to_string(),
                }),
            })
        })
        .collect();
    let traces: Vec<Value> = cases
        .iter()
        .map(|(rejected, message)| {
            to_proto_json(&ExportTraceServiceResponse {
                partial_success: Some(ExportTracePartialSuccess {
                    rejected_spans: *rejected,
                    error_message: message.to_string(),
                }),
            })
        })
        .collect();
    let profiles: Vec<Value> = cases
        .iter()
        .map(|(rejected, message)| {
            to_proto_json(&ExportProfilesServiceResponse {
                partial_success: Some(ExportProfilesPartialSuccess {
                    rejected_profiles: *rejected,
                    error_message: message.to_string(),
                }),
            })
        })
        .collect();
    assert_eq!(logs[0], json!({}));
    assert_eq!(logs[1]["partialSuccess"]["rejectedLogRecords"], "3");
    let mut defaults = vec![
        to_proto_json(&ExportLogsServiceResponse::default()),
        to_proto_json(&ExportMetricsServiceResponse::default()),
    ];
    defaults.extend(logs.iter().cloned());
    assert_fits("POST", "/api/{org_id}/v1/logs", &defaults);
    assert_fits("POST", "/api/{org_id}/v1/profiles", &profiles);
    for (path, answers) in [("metrics", &metrics), ("traces", &traces)] {
        let path = format!("/api/{{org_id}}/v1/{path}");
        assert_fits("POST", &path, answers);
        assert_fits_status("POST", &path, "206", answers);
    }
}

#[test]
fn otlp_export_json_schema_rejects_numbers_and_other_keys() {
    let validator = response_validator("POST", "/api/{org_id}/v1/logs", "200");
    assert!(!validator.is_valid(&json!({"partialSuccess": {"rejectedLogRecords": 3}})));
    assert!(!validator.is_valid(&json!({"partialSuccess": {"rejectedSpans": "3"}})));
    assert!(!validator.is_valid(&json!({"accepted": true})));
}

#[test]
fn otlp_protobuf_answers_are_binary() {
    for signal in ["logs", "metrics", "traces", "profiles"] {
        let path = format!("/api/{{org_id}}/v1/{signal}");
        let schema = media_schema("POST", &path, "200", "application/x-protobuf");
        assert_eq!(schema["type"], "string", "{path}: {schema}");
        assert_eq!(schema["format"], "binary", "{path}: {schema}");
    }
}

#[cfg(feature = "cloud")]
#[tokio::test]
async fn billing_redirects_answer_what_their_302_publishes() {
    use axum::http::header::{CONTENT_TYPE, LOCATION};
    use common::utils::redirect_response::RedirectResponseBuilder;

    let spec = published_spec();
    let ops = published_ops(&spec);
    for path in [
        "/api/{org_id}/billings/hosted_subscription_url",
        "/api/{org_id}/billings/checkout_session_detail",
    ] {
        let published = &find_op(&ops, "GET", path).unwrap()["responses"]["302"];
        for len in [1023, 1024] {
            let url = format!("https://example.com/{}", "a".repeat(len - 20));
            assert_eq!(url.len(), len);
            let answer = RedirectResponseBuilder::new(&url).build().redirect_http();
            assert_eq!(answer.status(), 302, "{path} {len}");
            let location = answer.headers().get(LOCATION).cloned();
            let media = answer.headers().get(CONTENT_TYPE).cloned();
            assert_eq!(location.is_some(), len < 1024, "{path} {len}");
            let body = axum::body::to_bytes(answer.into_body(), usize::MAX)
                .await
                .unwrap();
            match (location, media) {
                (Some(location), None) => {
                    assert_eq!(location, url.as_str(), "{path} {len}");
                    assert!(body.is_empty(), "{path} {len}");
                    assert!(published["headers"]["Location"].is_object(), "{published}");
                }
                (None, Some(media)) => {
                    let schema = &published["content"][media.to_str().unwrap()]["schema"];
                    let schema = super::resolved(&spec, schema);
                    assert_eq!(schema["type"], "string", "{path} {len}: {published}");
                    let html = String::from_utf8(body.to_vec()).unwrap();
                    assert!(html.contains(&url), "{path} {len}");
                }
                other => panic!("{path} {len}: unexpected headers {other:?}"),
            }
        }
    }
}

#[cfg(feature = "cloud")]
#[test]
fn stripe_checkout_session_fits_its_mirror() {
    use o2_enterprise::enterprise::cloud::billings::CheckoutResult;

    let CheckoutResult::Session(mut session) = CheckoutResult::Session(Box::default()) else {
        unreachable!()
    };
    let bare = to_json(&session);
    session.id = "cs_test_a1".parse().unwrap();
    session.url = Some("https://checkout.stripe.com/c/pay/cs_test_a1".to_string());
    session.customer_email = Some("root@example.com".to_string());
    session.client_reference_id = Some("default".to_string());
    session.amount_total = Some(2000);
    session.created = 1_700_000_000;
    session.expires_at = 1_700_086_400;
    session.payment_method_types = vec!["card".to_string()];
    session.metadata = Some([("org_id".to_string(), "default".to_string())].into());
    assert_fits(
        "GET",
        "/api/{org_id}/billings/hosted_subscription_url",
        &[bare, to_json(&session)],
    );
}

#[cfg(feature = "cloud")]
#[test]
fn stripe_billing_portal_session_fits_its_mirror() {
    let mut portal =
        default_answer(o2_enterprise::enterprise::cloud::billings::create_customer_portal_session);
    let bare = to_json(&portal);
    portal.id = "bps_test_a1".parse().unwrap();
    portal.url = "https://billing.stripe.com/p/session/test_a1".to_string();
    portal.customer = "cus_a1".to_string();
    portal.return_url = Some("https://example.com/web/billings/plans".to_string());
    portal.created = 1_700_000_000;
    assert_fits(
        "GET",
        "/api/{org_id}/billings/billing_portal",
        &[bare, to_json(&portal)],
    );
}

#[test]
fn search_multi_accepts_flat_and_per_query_hits() {
    let row = json!({"message": "row"});
    let mut flat = config::meta::search::Response::default();
    flat.hits.push(row.clone());
    let mut grouped = config::meta::search::Response::default();
    grouped.hits.push(Value::Array(vec![row]));
    grouped.hits.push(Value::Array(vec![]));
    grouped
        .hits
        .push(Value::Array(vec![json!("text"), json!(7)]));
    assert_fits(
        "POST",
        "/api/{org_id}/_search_multi",
        &[to_json(flat), to_json(grouped)],
    );
}
