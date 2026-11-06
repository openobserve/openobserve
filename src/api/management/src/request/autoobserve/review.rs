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

//! Verdicts affect paging eligibility, so review reads must reflect committed saves.

use axum::{
    body::Bytes,
    extract::{Path, Query, RawQuery, rejection::QueryRejection},
    response::Response,
};
use config::utils::time::now_micros;
use o2_enterprise::enterprise::autoobserve::review::{self, ReviewWindow, Verdict, VerdictPut};
use openobserve_api_common::extractors::Headers;
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

use super::{deployment_disabled, failed, parse_query, serve};
use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::auth::UserEmail};

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ReviewQuery {
    pub start: Option<i64>,
    pub end: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VerdictBody {
    #[schema(value_type = String, example = "confirmed")]
    pub verdict: Verdict,
    pub note: Option<String>,
}

impl VerdictBody {
    fn parse(body: &[u8]) -> Result<Self, String> {
        serde_json::from_slice(body).map_err(|e| format!("invalid verdict body: {e}"))
    }
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/review",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveReview",
    summary = "Review the findings AutoObserve would have paged for",
    description = "For each finding kind, every group of streams AutoObserve would have paged for in the window, newest first: the streams with their onset and usual volume, how many other streams in the same group were held back and why, and the verdict a person gave. Each kind has a summary with precision (confirmed over confirmed plus false alarms) and whether it meets the 0.5 bar. At most 500 groups are listed; `truncated` says more were cut.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), ReviewQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "A start not before the end, a window longer than 60 days, or a malformed query", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List the findings AutoObserve would have paged for, with their verdicts and precision", "category": "autoobserve"}))
    )
)]
pub async fn get_review(
    Path(org_id): Path<String>,
    query: Result<Query<ReviewQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    let window = match ReviewWindow::new(query.start, query.end, now_micros()) {
        Ok(window) => window,
        Err(e) => return failed(&e),
    };
    serve(|deps| async move { review::review(&deps, &org_id, window).await }).await
}

#[utoipa::path(
    put,
    path = "/v2/{org_id}/autoobserve/review/{decision_kind}/{cohort_id}",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObservePutVerdict",
    summary = "Record a verdict on a finding",
    description = "Says whether a group of streams AutoObserve would have paged for was a real problem (`confirmed`), a `false_alarm`, or `unclear`. The latest verdict wins and keeps who gave it and when; `unclear` takes a group out of precision again. A put equal to the stored verdict answers `unchanged`, keeps who gave it and when, and sends the stored value again, so a retry completes a save that failed part way.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("decision_kind" = String, Path, description = "The finding kind, e.g. stream_silence"),
        ("cohort_id" = String, Path, description = "The group's id from the review: 1 to 20 digits, then for a source silence a dash and 16 lowercase hex characters"),
    ),
    request_body(content = inline(VerdictBody), content_type = "application/json"),
    responses(
        (status = 200, description = "`change` is created, updated or unchanged", content_type = "application/json", body = Object),
        (status = 400, description = "An unknown kind, a malformed group id, an unknown verdict, an over-long note, a query string, or an invalid body", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "The write failed", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Record whether a finding AutoObserve would have paged for was real", "category": "autoobserve"}))
    )
)]
pub async fn put_verdict(
    Path((org_id, decision_kind, cohort_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    if query.as_deref().is_some_and(|q| !q.is_empty()) {
        return MetaHttpResponse::bad_request("a verdict PUT takes no query string");
    }
    let body = match VerdictBody::parse(&body) {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let put = VerdictPut {
        decision_kind,
        cohort_id,
        verdict: body.verdict,
        note: body.note,
    };
    // Refused before the engine is asked, so a node without one still answers 400.
    if let Err(e) = put.check() {
        return failed(&e);
    }
    serve(|deps| async move {
        review::put_verdict(&deps, &org_id, &put, &user.user_id, now_micros()).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing,
    };
    use o2_enterprise::enterprise::autoobserve::{
        contract::{DecisionRow, SECOND_US},
        names::{
            decision_kinds, fields, kinds, reasons, source_silence as source_label, stream_silence,
            stream_volume,
        },
        review::{CohortVerdict, Review, Verdicts, assemble},
        source_silence::source_group_key,
        stream_silence::cohort_key,
        stream_volume::{Direction, volume_cohort_key},
    };
    use tower::ServiceExt;

    use super::*;

    const FIXTURE: &str = include_str!(
        "../../../../../../web/src/components/autoobserve/live/__fixtures__/autoobserveReview.json"
    );
    const ORG: &str = "demo-org";

    fn app() -> Router {
        Router::new()
            .route("/v2/{org_id}/autoobserve/review", routing::get(get_review))
            .route(
                "/v2/{org_id}/autoobserve/review/{decision_kind}/{cohort_id}",
                routing::put(put_verdict),
            )
    }

    async fn send(method: &str, uri: &str, body: &str) -> (StatusCode, String) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("user_id", "reviewer@example.com")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app().oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    fn engine_on(on: bool) {
        super::super::tests::ENGINE_ON.with(|c| c.set(Some(on)));
    }

    fn row(kind: &str, stream: &str, onset: i64, bucket: i64, reason: &str) -> DecisionRow {
        let bucket_us = bucket * SECOND_US;
        let group_key = if kind == decision_kinds::STREAM_DROP {
            volume_cohort_key(ORG, Direction::Drop, bucket_us)
        } else {
            cohort_key(ORG, bucket_us)
        };
        DecisionRow {
            org_id: ORG.into(),
            entity_type: kinds::STREAM.into(),
            entity_id: format!("logs/{stream}"),
            decision_kind: kind.into(),
            signal_at: onset * SECOND_US,
            run: reason == stream_silence::ELIGIBLE,
            reason: reason.into(),
            protected: false,
            ts: (onset + 60) * SECOND_US,
            settings_version: 1,
            details: BTreeMap::from([(fields::GROUP_KEY.to_string(), group_key)]),
        }
    }

    fn with(mut r: DecisionRow, pairs: &[(&str, &str)]) -> DecisionRow {
        for (k, v) in pairs {
            r.details.insert((*k).to_string(), (*v).to_string());
        }
        r
    }

    fn verdict(v: Verdict, note: Option<&str>, at: i64) -> CohortVerdict {
        CohortVerdict {
            verdict: v,
            note: note.map(str::to_string),
            decided_by: "reviewer@example.com".into(),
            decided_at: at,
        }
    }

    fn source(host: &str, onset: i64, bucket: i64, reason: &str) -> DecisionRow {
        let key = source_group_key(ORG, bucket * SECOND_US, "host_name", host);
        let r = row(
            decision_kinds::SOURCE_SILENCE,
            "checkout",
            onset,
            bucket,
            reason,
        );
        with(
            r,
            &[
                (fields::GROUP_KEY, key.as_str()),
                (source_label::SOURCE_CLASS, source_label::HOST),
                (source_label::SOURCE_FIELD, "host_name"),
                (source_label::SOURCE_VALUE, host),
            ],
        )
    }

    fn fixture_review() -> Review {
        let (silence, fall) = (decision_kinds::STREAM_SILENCE, decision_kinds::STREAM_DROP);
        let (rows_per_day, width) = (stream_silence::ROWS_PER_DAY, stream_silence::WIDTH_SECS);
        let vetoed_key = "cohort:demo-org:1730800800:vetoed_by_stats";
        let rows = vec![
            with(
                row(
                    silence,
                    "checkout",
                    1_730_801_100,
                    1_730_800_800,
                    "eligible",
                ),
                &[(rows_per_day, "48000"), (width, "900")],
            ),
            with(
                row(
                    silence,
                    "payments",
                    1_730_801_400,
                    1_730_800_800,
                    "eligible",
                ),
                &[(rows_per_day, "96000"), (width, "900")],
            ),
            row(silence, "audit", 1_730_801_200, 1_730_800_800, "low_volume"),
            row(
                silence,
                "metrics-agent",
                1_730_801_200,
                1_730_800_800,
                "low_volume",
            ),
            row(silence, "batch", 1_730_801_300, 1_730_800_800, "low_volume"),
            with(
                row(
                    silence,
                    "orders",
                    1_730_801_500,
                    1_730_800_800,
                    "vetoed_by_stats",
                ),
                &[(fields::GROUP_KEY, vetoed_key)],
            ),
            with(
                row(fall, "payments", 1_731_405_600, 1_731_405_600, "eligible"),
                &[
                    (rows_per_day, "120000"),
                    (width, "900"),
                    (stream_volume::RATIO, "0.1"),
                    (fields::ACTION_RUN_ID, "inc-0001"),
                ],
            ),
            with(
                row(
                    silence,
                    "orders",
                    1_732_010_700,
                    1_732_010_400,
                    reasons::BUDGET,
                ),
                &[(rows_per_day, "5200"), (width, "3600")],
            ),
            with(
                source("node-4", 1_731_701_100, 1_731_700_800, "eligible"),
                &[(rows_per_day, "4800"), (width, "3600")],
            ),
            source("node-9", 1_731_701_400, 1_731_700_800, "low_volume"),
        ];
        let verdicts: Verdicts = BTreeMap::from([
            (
                (silence.to_string(), "1730800800".to_string()),
                verdict(
                    Verdict::Confirmed,
                    Some("collector OOM"),
                    1_730_900_000_000_000,
                ),
            ),
            (
                (fall.to_string(), "1731405600".to_string()),
                verdict(Verdict::FalseAlarm, None, 1_731_500_000_000_000),
            ),
        ]);
        let window = ReviewWindow::new(None, None, 1_732_419_200_000_000).unwrap();
        assemble(window, decision_kinds::ALL, &rows, &verdicts)
    }

    #[tokio::test]
    async fn the_review_routes_refuse_bad_input_with_a_json_400() {
        engine_on(true);
        let put = "/v2/o/autoobserve/review/stream_silence/1730800800";
        for (method, uri, body) in [
            ("GET", "/v2/o/autoobserve/review?start=5&end=5", ""),
            ("GET", "/v2/o/autoobserve/review?start=abc", ""),
            (
                "GET",
                "/v2/o/autoobserve/review?start=0&end=5184000000001",
                "",
            ),
            (
                "PUT",
                format!("{put}?note=x").as_str(),
                r#"{"verdict":"confirmed"}"#,
            ),
            ("PUT", put, ""),
            ("PUT", put, "{not json"),
            ("PUT", put, r#"{"verdict":"maybe"}"#),
            ("PUT", put, r#"{"verdict":"confirmed","notes":"x"}"#),
            (
                "PUT",
                "/v2/o/autoobserve/review/stream_other/1730800800",
                r#"{"verdict":"confirmed"}"#,
            ),
            (
                "PUT",
                "/v2/o/autoobserve/review/stream_silence/17308a",
                r#"{"verdict":"confirmed"}"#,
            ),
            (
                "PUT",
                "/v2/o/autoobserve/review/source_silence/1731700800-C3F5E04BC4C1D36E",
                r#"{"verdict":"confirmed"}"#,
            ),
            (
                "PUT",
                put,
                format!(r#"{{"verdict":"unclear","note":"{}"}}"#, "x".repeat(1025)).as_str(),
            ),
        ] {
            let (status, text) = send(method, uri, body).await;
            assert_eq!(
                status,
                StatusCode::BAD_REQUEST,
                "{method} {uri} {body}: {text}"
            );
            assert!(text.starts_with('{'), "a JSON body: {text}");
        }
    }

    #[tokio::test]
    async fn valid_requests_reach_the_engine_and_a_switched_off_deployment_is_a_404() {
        engine_on(true);
        let put = "/v2/o/autoobserve/review/stream_drop/1731405600";
        let body = r#"{"verdict":"false_alarm","note":"planned batch pause"}"#;
        let source = "/v2/o/autoobserve/review/source_silence/1731700800-c3f5e04bc4c1d36e";
        for (method, uri, body) in [
            ("GET", "/v2/o/autoobserve/review", ""),
            ("PUT", put, body),
            ("PUT", source, body),
        ] {
            let (status, text) = send(method, uri, body).await;
            assert_eq!(
                status,
                StatusCode::SERVICE_UNAVAILABLE,
                "{method}: no engine on this test node: {text}"
            );
        }
        engine_on(false);
        for (method, uri, body) in [("GET", "/v2/o/autoobserve/review", ""), ("PUT", put, body)] {
            assert_eq!(
                send(method, uri, body).await.0,
                StatusCode::NOT_FOUND,
                "{method}"
            );
        }
    }

    #[test]
    fn the_review_body_matches_the_web_fixture_byte_for_byte() {
        let built = fixture_review();
        let text = serde_json::to_string_pretty(&built).unwrap() + "\n";
        assert_eq!(
            text, FIXTURE,
            "regenerate the fixture from this test's output"
        );
        let parsed: Review = serde_json::from_str(FIXTURE).unwrap();
        assert_eq!(parsed, built);
        let silence = &built.kinds[0];
        assert_eq!(
            (silence.cohorts, silence.reviewed, silence.precision),
            (2, 1, Some(1.0))
        );
        assert_eq!(built.cohorts[3].quieted.values().sum::<usize>(), 4);
        let host = &built.cohorts[1];
        assert_eq!(host.cohort_id, "1731700800-c3f5e04bc4c1d36e");
        assert_eq!(host.members[0].source_value.as_deref(), Some("node-4"));
        assert_eq!(host.quieted.get("low_volume"), Some(&1));
    }
}
