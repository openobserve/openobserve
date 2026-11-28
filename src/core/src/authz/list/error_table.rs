// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#![cfg(all(test, feature = "enterprise", feature = "test-utils"))]

use std::collections::{BTreeMap, HashSet};

use axum::{body, http::StatusCode, response::Response};
use config::{
    meta::{
        service_identity::{
            EnvSource, NOT_SERVING_K8S_REASON, NotServingPod, NotServingPods, WhereSummaryRecord,
        },
        stream::StreamType,
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    table::entity::{service_version_deploys, service_version_verdicts},
};
use sea_orm::{EntityTrait, IntoActiveModel};
use serde_json::{Value, json};

use super::{
    AuthzUnavailable, CheckerChecks, ListMode, ModeAnswers, ObjectRef, SITE_SERVICE_STREAMS,
    SMALL_REQUEST_OBJECTS, Scope, StreamSet, UnavailableReason, error_denials_of, probe_covers,
    readable_streams, stream_read_query,
};
use crate::{
    authz::{CheckCalls, FakeStreamChecker, StreamAccessChecker, TypedStream, fake_checker},
    service_identity::{
        access::{ReadableStreams, RumReads},
        api::Context,
        global_tables_for_tests,
        signals::{api::attach_pod_evidence, reads},
    },
    traces::service_graph::api::readable_among,
};

const VISIBLE: &str = "visible";
const DENIED: &str = "denied";
const TIMEOUT: UnavailableReason = UnavailableReason::Timeout;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Site {
    ServiceStreams,
    ServiceIdentity,
    EvidenceRow,
    Verdict,
    Versions,
    RegionMerge,
    PodStatus,
    ServiceGraph,
    Catalog,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Shape {
    Small,
    Large,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ErrorPosition {
    BeforeDeny,
    AfterDeny,
    BeforeHeldDeny,
    Unrequested,
    OutOfScope,
    Filtered,
    InRegionMerge { sibling_readable: bool },
    CoveredSelection,
    UncoveredDeniedSelection,
}

#[derive(Clone, Copy)]
enum Expected {
    Served,
    Unavailable,
}

#[derive(Clone, Copy)]
enum OnCalls {
    AtMostOff,
    AtMost(usize),
}

type Row = (Site, Shape, ErrorPosition, Expected, OnCalls);
type Answer = Result<Value, ()>;

struct Request<'a> {
    checker: &'a FakeStreamChecker,
    site: Site,
    shape: Shape,
    position: ErrorPosition,
    mode: ListMode,
    org: &'a str,
    user: &'a str,
    failing: &'a str,
    uncovered_deny: &'a str,
}

impl Request<'_> {
    fn grant_trace(&self, name: &str) {
        self.checker.grant_read(
            self.user,
            &TypedStream {
                org_id: self.org.into(),
                stream_type: StreamType::Traces,
                name: name.into(),
            },
        );
    }

    fn uses_object_checks(&self) -> bool {
        self.mode == ListMode::On && (self.shape == Shape::Large || self.site == Site::ServiceGraph)
    }

    fn fail_stream(&self, name: &str) {
        if self.uses_object_checks() {
            self.checker.fail_object_check_of(self.user, name, TIMEOUT);
        } else {
            self.checker.fail_stream_read_once(self.user, name);
        }
    }

    async fn assert_failing_check_pending(&self) {
        let stream_type = if self.site == Site::ServiceIdentity {
            StreamType::Logs
        } else {
            StreamType::Traces
        };
        if self.uses_object_checks() {
            let query = stream_read_query(
                SITE_SERVICE_STREAMS,
                self.org,
                self.user,
                std::slice::from_ref(&stream_type),
            );
            let object = ObjectRef::stream(stream_type, self.failing);
            assert_eq!(
                self.checker
                    .check_object(self.user, self.org, &query, &object)
                    .await,
                Err(TIMEOUT.into()),
                "{}",
                self.user,
            );
        } else {
            let stream = TypedStream {
                org_id: self.org.into(),
                stream_type,
                name: self.failing.into(),
            };
            let (_, denials) =
                error_denials_of(self.checker.can_read_stream(self.user, &stream)).await;
            assert_eq!(denials.first(), Some(TIMEOUT), "{}", self.user);
        }
    }

    fn requested_traces(&self) -> Vec<String> {
        let mut names = vec![VISIBLE.into(), DENIED.into()];
        match self.position {
            ErrorPosition::BeforeDeny => names.insert(1, self.failing.into()),
            ErrorPosition::AfterDeny => names.push(self.failing.into()),
            ErrorPosition::Unrequested | ErrorPosition::OutOfScope | ErrorPosition::Filtered => (),
            position => unreachable!("set case {position:?}"),
        }
        names
    }

    fn unit_sources(&self) -> [String; 2] {
        let denied = typed_trace(self.uncovered_deny);
        let failing = typed_trace(self.failing);
        match self.position {
            ErrorPosition::BeforeDeny | ErrorPosition::BeforeHeldDeny => [failing, denied],
            ErrorPosition::AfterDeny => [denied, failing],
            ErrorPosition::Unrequested => [typed_trace(VISIBLE), denied],
            position => unreachable!("all-of case {position:?}"),
        }
    }

    fn calls(&self) -> usize {
        counted_calls(&self.checker.calls(self.user))
    }

    fn assert_unit_calls(&self, before: usize) {
        if self.position != ErrorPosition::Unrequested {
            assert_eq!(self.calls() - before, 1, "{}", self.user);
        }
    }

    fn assert_mode(&self, answers: &ModeAnswers) {
        assert!(
            matches!(
                (self.mode, self.shape, answers),
                (ListMode::Off, _, ModeAnswers::Legacy)
                    | (ListMode::On, Shape::Small, ModeAnswers::SmallOn)
                    | (ListMode::On, Shape::Large, ModeAnswers::Serve(_))
            ),
            "{}: {answers:?}",
            self.user,
        );
    }

    async fn context(&self) -> Context {
        let summaries = [trace_summary(self.org, VISIBLE)];
        let readable = ReadableStreams::load(self.org, self.user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
        self.assert_mode(&readable.answers);
        let ctx = Context {
            org: self.org.into(),
            user: self.user.into(),
            summaries: readable.visible(&summaries),
            readable,
            evidence: Default::default(),
            identity: Default::default(),
            aliases: Default::default(),
        };
        if self.position == ErrorPosition::BeforeHeldDeny {
            assert_eq!(
                ctx.readable
                    .evidence(
                        self.org,
                        self.user,
                        &[typed_trace(self.uncovered_deny)],
                        false,
                        false,
                        &ctx.evidence,
                    )
                    .await,
                Ok(false)
            );
        }
        ctx
    }
}

fn typed_trace(name: &str) -> String {
    format!("traces/{name}")
}

fn trace_summary(org: &str, stream: &str) -> WhereSummaryRecord {
    WhereSummaryRecord {
        summary_key: format!("{org}-{stream}"),
        org_id: org.into(),
        service_name: "svc".into(),
        where_key: "default".into(),
        scope_key: org.into(),
        source_stream: stream.into(),
        signal: "traces".into(),
        k8s_cluster: String::new(),
        k8s_namespace: String::new(),
        env: "default".into(),
        env_source: EnvSource::Default,
        env_source_value: String::new(),
        envs: Vec::new(),
        newest_version: "v1".into(),
        newest_version_key: "v1".into(),
        newest_first_seen: 1,
        has_version: true,
        first_seen: 1,
        last_seen: 2,
        purged_versions: 0,
        updated_at: 2,
    }
}

fn checked_authz<T>(result: Result<T, AuthzUnavailable>) -> Result<T, ()> {
    result.map_err(|error| assert_eq!(error.reason, TIMEOUT))
}

async fn checked_http<T>(result: Result<T, Response>) -> Result<T, ()> {
    let response = match result {
        Ok(value) => return Ok(value),
        Err(response) => response,
    };
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()["x-o2-authz"], "unavailable");
    assert_eq!(response.headers()["retry-after"], "3");
    let bytes = body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(payload["error_code"], "authz_unavailable");
    Err(())
}

async fn service_streams(request: &Request<'_>) -> Answer {
    let mut streams: StreamSet = request
        .requested_traces()
        .into_iter()
        .map(|name| (StreamType::Traces, name))
        .collect();
    let failing = (StreamType::Traces, request.failing.into());
    let scope = match request.position {
        ErrorPosition::OutOfScope => Scope::requested(streams.iter().cloned()),
        ErrorPosition::Filtered => Scope::every().filtered([failing.clone()]),
        _ => Scope::every(),
    };
    if matches!(
        request.position,
        ErrorPosition::OutOfScope | ErrorPosition::Filtered
    ) {
        streams.insert(failing);
    }
    let readable = checked_authz(
        readable_streams(
            request.checker,
            SITE_SERVICE_STREAMS,
            request.user,
            request.org,
            streams,
            &scope,
        )
        .await,
    )?;
    assert_eq!(
        readable,
        Some(StreamSet::from([(StreamType::Traces, VISIBLE.into())]))
    );
    Ok(json!(readable))
}

async fn service_identity(request: &Request<'_>) -> Answer {
    let mut summaries: Vec<_> = request
        .requested_traces()
        .iter()
        .map(|name| trace_summary(request.org, name))
        .collect();
    let show_rum = request.position != ErrorPosition::Filtered;
    if show_rum {
        request
            .checker
            .grant_read_all(request.user, request.org, StreamType::Logs);
        let mut rum = trace_summary(request.org, "_rumdata");
        rum.signal = "rum".into();
        summaries.push(rum);
    } else {
        request
            .checker
            .fail_list_incomplete_once(request.user, StreamType::Logs);
    }
    let readable = checked_authz(
        ReadableStreams::load(request.org, request.user, &summaries, RumReads::Summaries).await,
    )?;
    request.assert_mode(&readable.answers);
    assert_eq!(readable.traces, HashSet::from([VISIBLE.to_string()]));
    assert_eq!(readable.rum, show_rum);
    Ok(json!({"traces": readable.traces, "rum": readable.rum}))
}

async fn evidence_row(request: &Request<'_>) -> Answer {
    let ctx = request.context().await;
    let before = request.calls();
    let result = ctx
        .readable
        .evidence(
            &ctx.org,
            &ctx.user,
            &request.unit_sources(),
            false,
            false,
            &ctx.evidence,
        )
        .await;
    request.assert_unit_calls(before);
    let allowed = checked_authz(result)?;
    assert!(!allowed, "{}", request.user);
    Ok(json!(allowed))
}

async fn verdict(request: &Request<'_>) -> Answer {
    let ctx = request.context().await;
    let rows = ["a", "b"]
        .into_iter()
        .zip(request.unit_sources())
        .map(|(region, source)| service_version_verdicts::Model {
            verdict_key: format!("{}-{region}", request.org),
            org_id: request.org.into(),
            cluster: region.into(),
            source_streams: json!([source]).to_string(),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    let before = request.calls();
    let result = reads::summary(&ctx, &rows).await;
    request.assert_unit_calls(before);
    let answer = checked_http(result).await?;
    assert_eq!(answer["restricted"], true, "{}", request.user);
    Ok(answer)
}

async fn versions(request: &Request<'_>) -> Answer {
    let ctx = request.context().await;
    let mut versions = [json!({"version_key": "v1"})];
    let before = request.calls();
    let result = reads::enrich_versions(&ctx, &mut versions).await;
    request.assert_unit_calls(before);
    checked_http(result).await?;
    let [version] = versions;
    assert_eq!(version["restricted"], true, "{}", request.user);
    assert_eq!(version["deploys"].as_array().unwrap().len(), 2);
    Ok(version)
}

async fn region_merge(request: &Request<'_>) -> Answer {
    let ctx = request.context().await;
    let params = BTreeMap::from([("service".into(), "svc".into())]);
    let answer = checked_http(reads::deploys(&ctx, &params).await).await?;
    let markers = answer["deploys"].as_array().unwrap();
    assert_eq!(markers.len(), 1, "{}", request.user);
    assert_eq!(markers[0]["regions"], json!(["a", "b"]));
    assert_eq!(markers[0]["verdict"], json!({"restricted": true}));
    Ok(answer)
}

async fn pod_status(request: &Request<'_>) -> Answer {
    let ctx = request.context().await;
    let table = NotServingPods {
        pods: vec![NotServingPod {
            k8s_pod: "pod-a".into(),
            status: Some("waiting".into()),
            ..Default::default()
        }],
        source_streams: vec![typed_trace(request.uncovered_deny)],
        status_streams: vec![typed_trace(request.failing)],
        ..Default::default()
    };
    let mut summary = json!({"verdict": "not_serving", "reason_code": NOT_SERVING_K8S_REASON, "restricted": false});
    let original = summary.clone();
    let before = request.calls();
    let result = attach_pod_evidence(&ctx, &table, &mut summary, false).await;
    assert_eq!(request.calls() - before, 1, "{}", request.user);
    checked_http(result).await?;
    assert_eq!(summary, original);
    Ok(summary)
}

async fn service_graph(request: &Request<'_>) -> Answer {
    let (streams, selected, expected) = match request.position {
        ErrorPosition::OutOfScope => (
            vec![VISIBLE.into(), request.failing.into()],
            VISIBLE,
            vec![VISIBLE.into()],
        ),
        ErrorPosition::CoveredSelection => {
            if request.mode == ListMode::On {
                request.checker.fail_list_once(request.user, TIMEOUT);
            } else {
                request.fail_stream(VISIBLE);
            }
            (vec![VISIBLE.into(), DENIED.into()], VISIBLE, Vec::new())
        }
        ErrorPosition::UncoveredDeniedSelection => {
            if request.mode == ListMode::On {
                request
                    .checker
                    .fail_types_access_once(request.user, TIMEOUT);
            } else {
                request.fail_stream(VISIBLE);
            }
            (
                vec![VISIBLE.into(), request.uncovered_deny.into()],
                request.uncovered_deny,
                Vec::new(),
            )
        }
        _ => (
            request.requested_traces(),
            VISIBLE,
            vec![VISIBLE.to_string()],
        ),
    };
    let scope = if request.position == ErrorPosition::OutOfScope {
        Scope::requested([(StreamType::Traces, selected.into())])
    } else {
        Scope::every()
    };
    let result = readable_among(
        request.checker,
        &CheckerChecks(request.checker),
        request.org,
        request.user,
        || std::future::ready(streams.clone()),
        "placeholder",
        Some(selected),
        &scope,
    )
    .await;
    if request.mode == ListMode::On {
        let calls = request.checker.calls(request.user);
        match request.position {
            ErrorPosition::CoveredSelection => {
                assert_eq!((calls.lists, calls.object_checks), (1, 0));
            }
            ErrorPosition::UncoveredDeniedSelection => {
                assert_eq!((calls.lists, calls.object_checks), (0, 1));
            }
            _ => (),
        }
    }
    let readable = checked_authz(result)?;
    assert_eq!(readable, Some(expected), "{}", request.user);
    Ok(json!(readable))
}

async fn catalog(request: &Request<'_>) -> Answer {
    let mut ctx = request.context().await;
    let unversioned = format!("{}-unversioned", request.org);
    ctx.summaries.push(WhereSummaryRecord {
        scope_key: unversioned.clone(),
        has_version: false,
        ..trace_summary(request.org, VISIBLE)
    });
    let mut scopes = vec![
        json!({"scope_key": request.org, "newest_version": "v1"}),
        json!({"scope_key": unversioned}),
    ];
    let params = BTreeMap::from([("verdict".into(), "no_version".into())]);
    checked_http(reads::enrich_catalog(&ctx, &mut scopes, &params).await).await?;
    assert_eq!(scopes.len(), 1);
    assert_eq!(scopes[0]["scope_key"], unversioned);
    Ok(json!(scopes))
}

async fn insert_catalog_verdict(request: &Request<'_>) {
    service_version_verdicts::Entity::insert(
        service_version_verdicts::Model {
            verdict_key: request.org.into(),
            org_id: request.org.into(),
            scope_key: request.org.into(),
            version: "v1".into(),
            verdict: "ok".into(),
            source_streams: json!([typed_trace(request.failing)]).to_string(),
            ..Default::default()
        }
        .into_active_model(),
    )
    .exec_without_returning(get_orm_client_rw().await)
    .await
    .unwrap();
}

async fn insert_deploys(request: &Request<'_>) {
    let (sources, times) = match request.position {
        ErrorPosition::InRegionMerge { sibling_readable } => {
            let sibling = if sibling_readable { VISIBLE } else { DENIED };
            (
                [typed_trace(request.failing), typed_trace(sibling)],
                [1, 599_000_001],
            )
        }
        _ => (request.unit_sources(), [2, 1]),
    };
    let rows = ["a", "b"]
        .into_iter()
        .zip(times)
        .zip(sources)
        .map(|((region, at), source)| {
            service_version_deploys::Model {
                deploy_key: format!("{}-{region}", request.org),
                org_id: request.org.into(),
                scope_key: request.org.into(),
                where_key: "default".into(),
                service_name: "svc".into(),
                cluster: region.into(),
                to_version: "v1".into(),
                to_version_key: "v1".into(),
                kind: "deploy".into(),
                at,
                source_streams: json!([source]).to_string(),
                ..Default::default()
            }
            .into_active_model()
        });
    service_version_deploys::Entity::insert_many(rows)
        .exec_without_returning(get_orm_client_rw().await)
        .await
        .unwrap();
}

fn counted_calls(calls: &CheckCalls) -> usize {
    calls.streams
        + calls.org_wide.len()
        + calls.types_access
        + calls.lists
        + calls.object_checks
        + calls.org_wide_checks
}

async fn read_site(request: &Request<'_>) -> Answer {
    request.checker.set_list_mode(request.user, request.mode);
    let cutoff = match request.shape {
        Shape::Small => SMALL_REQUEST_OBJECTS,
        Shape::Large => 0,
    };
    request
        .checker
        .set_small_request_objects(request.user, cutoff);
    request.grant_trace(VISIBLE);
    request.grant_trace(request.failing);
    request.fail_stream(request.failing);
    match request.site {
        Site::ServiceStreams => service_streams(request).await,
        Site::ServiceIdentity => service_identity(request).await,
        Site::EvidenceRow => evidence_row(request).await,
        Site::Verdict => verdict(request).await,
        Site::Versions => versions(request).await,
        Site::RegionMerge => region_merge(request).await,
        Site::PodStatus => pod_status(request).await,
        Site::ServiceGraph => service_graph(request).await,
        Site::Catalog => catalog(request).await,
    }
}

async fn check_row(
    checker: &FakeStreamChecker,
    org: &str,
    row: Row,
    failing: &str,
    uncovered_deny: &str,
) {
    let (site, shape, position, expected, on_calls) = row;
    let failing = if site == Site::ServiceIdentity && position == ErrorPosition::Filtered {
        "_rumdata"
    } else {
        failing
    };
    let case = format!("{site:?}/{shape:?}/{position:?}");
    let off_user = format!("{org}-off@example.com");
    let on_user = format!("{org}-on@example.com");
    let off_request = Request {
        checker,
        site,
        shape,
        position,
        mode: ListMode::Off,
        org,
        user: &off_user,
        failing,
        uncovered_deny,
    };
    let on_request = Request {
        user: &on_user,
        mode: ListMode::On,
        ..off_request
    };
    if matches!(site, Site::Versions | Site::RegionMerge) {
        insert_deploys(&off_request).await;
    }
    if site == Site::Catalog {
        insert_catalog_verdict(&off_request).await;
    }
    let off = read_site(&off_request).await.unwrap();
    let on = read_site(&on_request).await;
    match expected {
        Expected::Served => assert_eq!(on, Ok(off), "{case}"),
        Expected::Unavailable => assert_eq!(on, Err(()), "{case}"),
    }
    let limit = match on_calls {
        OnCalls::AtMostOff => off_request.calls(),
        OnCalls::AtMost(limit) => limit,
    };
    let calls = checker.calls(&on_user);
    assert_eq!(
        calls.types_access,
        usize::from(shape == Shape::Large),
        "{case}"
    );
    assert!(
        counted_calls(&calls) <= limit,
        "{case}: limit {limit}, {calls:?}"
    );
    if matches!(
        position,
        ErrorPosition::OutOfScope | ErrorPosition::Filtered
    ) {
        // Off runs main's catalog path, which checks the evidence of rows its filter then drops.
        if site != Site::Catalog {
            off_request.assert_failing_check_pending().await;
        }
        on_request.assert_failing_check_pending().await;
    }
}

fn rows() -> Vec<Row> {
    use ErrorPosition::{
        AfterDeny, BeforeDeny, BeforeHeldDeny, CoveredSelection, Filtered, InRegionMerge,
        OutOfScope, UncoveredDeniedSelection, Unrequested,
    };
    use Expected::{Served, Unavailable};
    use OnCalls::{AtMost, AtMostOff};
    use Shape::{Large, Small};

    let sets = [
        (BeforeDeny, Unavailable),
        (AfterDeny, Unavailable),
        (Unrequested, Served),
    ];
    let all_of = [
        (BeforeDeny, Unavailable),
        (AfterDeny, Served),
        (BeforeHeldDeny, Served),
        (Unrequested, Served),
    ];
    let merge = [
        (
            InRegionMerge {
                sibling_readable: false,
            },
            Served,
        ),
        (
            InRegionMerge {
                sibling_readable: true,
            },
            Unavailable,
        ),
    ];
    let sites = [
        (Site::ServiceStreams, sets.as_slice(), 12),
        (Site::ServiceIdentity, sets.as_slice(), 12),
        (Site::EvidenceRow, all_of.as_slice(), 12),
        (Site::Verdict, all_of.as_slice(), 12),
        (Site::Versions, all_of.as_slice(), 12),
        (Site::RegionMerge, merge.as_slice(), 12),
        (Site::PodStatus, &[(Unrequested, Served)][..], 12),
        (Site::ServiceGraph, sets.as_slice(), 6),
    ];
    let mut rows = Vec::new();
    for (site, cases, budget) in sites {
        for &(position, expected) in cases {
            rows.push((site, Small, position, expected, AtMostOff));
            rows.push((site, Large, position, expected, AtMost(budget)));
        }
    }
    for (site, position, budget) in [
        (Site::ServiceStreams, OutOfScope, 12),
        (Site::ServiceStreams, Filtered, 12),
        (Site::ServiceIdentity, Filtered, 12),
        (Site::ServiceGraph, OutOfScope, 6),
        (Site::Catalog, Filtered, 12),
    ] {
        rows.push((site, Small, position, Served, AtMostOff));
        rows.push((site, Large, position, Served, AtMost(budget)));
    }
    rows.extend([
        (
            Site::ServiceGraph,
            Large,
            CoveredSelection,
            Unavailable,
            AtMost(6),
        ),
        (
            Site::ServiceGraph,
            Large,
            UncoveredDeniedSelection,
            Served,
            AtMost(6),
        ),
    ]);
    rows
}

#[tokio::test]
async fn an_openfga_error_fails_a_core_site_only_where_it_could_change_the_answer() {
    global_tables_for_tests().await;
    infra::db::get_db().await.create_table().await.unwrap();
    let checker = fake_checker();
    let failing = "f".repeat(220);
    let uncovered_deny = "d".repeat(300);
    assert!(!probe_covers(&failing));
    assert!(!probe_covers(&uncovered_deny));
    let run = now_micros();
    for (index, row) in rows().into_iter().enumerate() {
        let org = format!("core-authz-error-table-{run}-{index}");
        check_row(&checker, &org, row, &failing, &uncovered_deny).await;
    }
}
