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

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, AtomicUsize, Ordering},
    },
};

use config::{
    meta::{
        alerts::incidents::{
            AddContextRequest, ContextSource, DeclareEffectKind, DeclareEffectState,
            DeclareRequest, IncidentEventType, ResultSummary,
        },
        oncall::{
            Channel, ResponderRole, ResponseEvent, ResponseEventKind, RoutingDecision, SubjectRef,
            SubjectType,
        },
        stream::StreamType,
        triggers::TriggerModule,
    },
    utils::time::now_micros,
};
use infra::{
    db::get_orm_client_rw,
    race::{Barriers, in_both_orders},
    table::{
        alert_incidents,
        entity::{alert_incident_alerts, incident_contexts},
        incident_declare_keys, incident_events, oncall_responses,
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseTransaction, EntityTrait,
    PaginatorTrait, QueryFilter, TransactionTrait,
};
use serde_json::json;

use super::{
    DeclareError, DeclareResponse, DeclareRouting, DeclareRuntime, ScopeMatch, WriteResult,
    add_context_with, declare_with, effects::Dispatch, prepare_write, preview_with, selected_team,
    subject, write_declare,
};
use crate::authz::{FakeStreamChecker, QuerySource, TypedStream, authorize_with};

const MINUTE_US: i64 = 60_000_000;
const MAX_INCIDENT_BYTES: usize = 1_048_576;
const STREAM: &str = "checkout_logs";
const TEAM: &str = "checkout-responders";

#[derive(Clone, Copy)]
enum Subject {
    Service,
    ServiceWithSource,
    Source,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ContextSize {
    Small,
    Large,
}

struct Runtime {
    checker: FakeStreamChecker,
    pages: AtomicUsize,
    captures: AtomicUsize,
    last_capture_end: AtomicI64,
    clock: AtomicI64,
    downtime_at: AtomicI64,
    downtime_service: Option<&'static str>,
    service_team: Option<&'static str>,
    paged_teams: Mutex<Vec<String>>,
    rcas: AtomicUsize,
    destinations: Vec<String>,
    notifications: Mutex<Vec<String>>,
    fail_once: Mutex<Option<String>>,
    has_route: bool,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            checker: FakeStreamChecker::default(),
            pages: AtomicUsize::new(0),
            captures: AtomicUsize::new(0),
            last_capture_end: AtomicI64::new(0),
            clock: AtomicI64::new(0),
            downtime_at: AtomicI64::new(i64::MAX),
            downtime_service: None,
            service_team: None,
            paged_teams: Mutex::new(Vec::new()),
            rcas: AtomicUsize::new(0),
            destinations: Vec::new(),
            notifications: Mutex::new(Vec::new()),
            fail_once: Mutex::new(None),
            has_route: true,
        }
    }
}

impl DeclareRuntime for Runtime {
    async fn authorize(&self, user: &str, sources: &[QuerySource]) -> Result<(), DeclareError> {
        authorize_with(&self.checker, user, sources)
            .await
            .map_err(|_| DeclareError::Forbidden)
    }

    async fn capture(&self, _org: &str, _user: &str, source: &ContextSource) -> ResultSummary {
        self.captures.fetch_add(1, Ordering::Relaxed);
        self.last_capture_end
            .store(source.target.end_us, Ordering::Relaxed);
        infra::race_point!("declare.test_capture_started");
        infra::race_point!("declare.test_capture_resume");
        ResultSummary::default()
    }

    async fn onset(&self, _org: &str, _user: &str, _source: &ContextSource) -> Option<i64> {
        None
    }

    async fn routing(
        &self,
        _org: &str,
        dimensions: &HashMap<String, String>,
        _fallback: Option<&str>,
    ) -> Result<DeclareRouting, DeclareError> {
        let team = self
            .service_team
            .filter(|_| dimensions.contains_key("service"))
            .unwrap_or(TEAM);
        Ok(DeclareRouting {
            team: self.has_route.then(|| team.to_string()),
            responders: vec![],
            no_route: !self.has_route,
        })
    }

    fn oncall_enabled(&self) -> bool {
        true
    }

    fn now(&self) -> i64 {
        match self.clock.load(Ordering::Relaxed) {
            0 => now_micros(),
            time => time,
        }
    }

    fn muted_downtime(
        &self,
        _org: &str,
        dimensions: &HashMap<String, String>,
        at: i64,
    ) -> Option<String> {
        (at >= self.downtime_at.load(Ordering::Relaxed)
            && self.downtime_service.is_none_or(|service| {
                dimensions
                    .get("service")
                    .is_some_and(|value| value == service)
            }))
        .then(|| "test-downtime".to_owned())
    }

    async fn destinations(
        &self,
        _txn: &DatabaseTransaction,
        _incident: &super::Incident,
    ) -> anyhow::Result<Vec<String>> {
        Ok(self.destinations.clone())
    }

    async fn run_effect(&self, effect: Dispatch<'_>) -> anyhow::Result<()> {
        match effect.kind {
            DeclareEffectKind::Page => {
                self.paged_teams
                    .lock()
                    .unwrap()
                    .push(effect.intent.team.clone().unwrap());
                self.pages.fetch_add(1, Ordering::Relaxed);
            }
            DeclareEffectKind::Rca => {
                self.rcas.fetch_add(1, Ordering::Relaxed);
            }
            DeclareEffectKind::Notify { destination } => {
                self.notifications.lock().unwrap().push(destination.clone());
                let mut fail = self.fail_once.lock().unwrap();
                if fail.as_ref() == Some(destination) {
                    fail.take();
                    anyhow::bail!("delivery failed");
                }
            }
        }
        Ok(())
    }
}

struct Fixture {
    org: String,
    user: String,
    window_start: i64,
    runtime: Runtime,
}

impl Fixture {
    fn new() -> Self {
        let org = format!("declare_{}", config::ider::uuid());
        Self {
            user: format!("{org}@example.test"),
            org,
            window_start: now_micros() - 5 * MINUTE_US,
            runtime: Runtime::default(),
        }
    }

    fn grant_read(&self) {
        self.runtime.checker.grant_read(
            &self.user,
            &TypedStream {
                org_id: self.org.clone(),
                stream_type: StreamType::Logs,
                name: STREAM.to_string(),
            },
        );
    }

    fn source(&self, size: ContextSize) -> ContextSource {
        let mut value = json!({
            "kind": "logs",
            "title": "Checkout errors",
            "target": {
                "signal": "logs",
                "stream_type": "logs",
                "streams": [STREAM],
                "sql": format!("SELECT * FROM {STREAM} WHERE level = 'error'"),
                "start_us": self.window_start,
                "end_us": self.window_start + MINUTE_US,
            },
            "origin": {"route": "/logs"},
        });
        if size == ContextSize::Large {
            value["origin"]["variables"] = json!({"selected": "x".repeat(11_700)});
        }
        serde_json::from_value(value).unwrap()
    }

    fn request(&self, subject: Subject) -> DeclareRequest {
        serde_json::from_value(json!({
            "title": "Checkout errors",
            "severity": "P2",
            "service": (!matches!(subject, Subject::Source)).then_some("checkout"),
            "env": "prod",
            "region": "east",
            "impact_start_at": self.window_start,
            "source": (!matches!(subject, Subject::Service))
                .then(|| self.source(ContextSize::Small)),
        }))
        .unwrap()
    }

    async fn declare(
        &self,
        key: &str,
        request: DeclareRequest,
    ) -> Result<DeclareResponse, DeclareError> {
        declare_with(&self.org, &self.user, key, request, &self.runtime).await
    }

    async fn add(&self, id: &str, key: &str, size: ContextSize) -> Result<String, DeclareError> {
        let request = AddContextRequest {
            source: self.source(size),
            note: None,
        };
        add_context_with(&self.org, id, &self.user, Some(key), request, &self.runtime).await
    }

    async fn stored_contexts(&self, id: &str) -> Vec<incident_contexts::Model> {
        incident_contexts::Entity::find()
            .filter(incident_contexts::Column::OrgId.eq(&self.org))
            .filter(incident_contexts::Column::IncidentId.eq(id))
            .all(get_orm_client_rw().await)
            .await
            .unwrap()
    }

    async fn incident_count(&self) -> usize {
        alert_incidents::list_with(get_orm_client_rw().await, &self.org, None, 10, 0)
            .await
            .unwrap()
            .len()
    }
}

pub(in crate::alerts::incidents) async fn initialize_meta_store() -> bool {
    static READY: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
    if std::env::var("ZO_META_STORE").is_err() {
        eprintln!("skipped: set ZO_META_STORE for incident DB tests");
        return false;
    }
    READY
        .get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
            infra::db_init().await.unwrap();
            infra::table::migrate().await.unwrap();
        })
        .await;
    true
}

async fn scoped_declare(
    fixture: Arc<Fixture>,
    race: Barriers,
    key: &'static str,
    subject: Subject,
) -> DeclareResponse {
    race.run(fixture.declare(key, fixture.request(subject)))
        .await
        .unwrap()
}

async fn assert_single_declare(fixture: &Fixture, a: DeclareResponse, b: DeclareResponse) {
    assert_eq!(a.incident_id, b.incident_id);
    assert_ne!(a.created, b.created);
    assert_eq!(fixture.incident_count().await, 1);
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
    let db = get_orm_client_rw().await;
    let row = alert_incidents::get_with(db, &fixture.org, &a.incident_id)
        .await
        .unwrap()
        .unwrap();
    assert!(row.assigned_to.is_none());
    assert_eq!(row.first_alert_at, row.last_alert_at);
    assert_eq!(row.impact_start_at, Some(fixture.window_start));
    assert_eq!(row.alert_count, 0);
    let firings = alert_incident_alerts::Entity::find()
        .filter(alert_incident_alerts::Column::IncidentId.eq(&a.incident_id))
        .count(db)
        .await
        .unwrap();
    assert_eq!(firings, 0);
}

async fn race_declares(first: Subject, second: Subject) {
    if !initialize_meta_store().await {
        return;
    }
    if get_orm_client_rw().await.get_database_backend() == DatabaseBackend::Postgres {
        let fixture = Arc::new(Fixture::new());
        fixture.grant_read();
        let race = Barriers::new();
        race.arm("declare.before_lock", 2);
        let a = tokio::spawn(scoped_declare(fixture.clone(), race.clone(), "a", first));
        let b = tokio::spawn(scoped_declare(fixture.clone(), race.clone(), "b", second));
        assert_single_declare(&fixture, a.await.unwrap(), b.await.unwrap()).await;
        race.assert_all_met();
        return;
    }

    let runs = in_both_orders(move |_| async move {
        let fixture = Arc::new(Fixture::new());
        fixture.grant_read();
        let race = Barriers::new();
        race.arm("declare.before_lock", 1);
        let b = scoped_declare(fixture.clone(), race.clone(), "b", second);
        let a = async move {
            let response = scoped_declare(fixture.clone(), race.clone(), "a", first).await;
            (fixture, race, response)
        };
        (a, b)
    })
    .await;
    for run in runs {
        let (fixture, race, a) = run.a;
        assert_single_declare(&fixture, a, run.b).await;
        assert_eq!(race.arrived("declare.before_lock"), 2);
        race.assert_all_met();
    }
}

#[tokio::test]
async fn concurrent_declares_create_once() {
    race_declares(Subject::Service, Subject::Service).await;
}

#[tokio::test]
async fn concurrent_declares_across_service_and_stream_keys_create_once() {
    race_declares(Subject::ServiceWithSource, Subject::Source).await;
}

#[tokio::test]
async fn incident_declare_keys_replay_with_and_without_a_source_after_resolution() {
    if !initialize_meta_store().await {
        return;
    }
    for subject in [Subject::ServiceWithSource, Subject::Service] {
        let fixture = Fixture::new();
        fixture.grant_read();
        let source = matches!(subject, Subject::ServiceWithSource);
        let race = Barriers::new();
        race.arm("declare.candidate_query", 1);
        let first = race
            .run(fixture.declare("replay", fixture.request(subject)))
            .await
            .unwrap();
        assert!(first.created);
        assert_eq!(first.context_id.is_some(), source);
        let queries = race.arrived("declare.candidate_query");
        assert!(queries > 0);

        for resolved in [false, true] {
            if resolved {
                alert_incidents::update_status(&fixture.org, &first.incident_id, "resolved")
                    .await
                    .unwrap();
            }
            let replay = race
                .run(fixture.declare("replay", fixture.request(subject)))
                .await
                .unwrap();
            assert_eq!(replay.incident_id, first.incident_id);
            assert_eq!(replay.context_id, first.context_id);
            assert_eq!(replay.created, first.created);
            assert_eq!(race.arrived("declare.candidate_query"), queries);
            assert_eq!(
                fixture.runtime.captures.load(Ordering::Relaxed),
                usize::from(source)
            );
            assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
            assert_eq!(fixture.incident_count().await, 1);
        }
        race.assert_all_met();
    }
}

#[tokio::test]
async fn incident_declare_keys_replay_an_attach_after_resolution() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    fixture.grant_read();
    let opened = fixture
        .declare("open", fixture.request(Subject::Service))
        .await
        .unwrap();
    let attached = fixture
        .declare("attach", fixture.request(Subject::ServiceWithSource))
        .await
        .unwrap();
    assert!(!attached.created);
    assert_eq!(attached.incident_id, opened.incident_id);
    assert!(attached.context_id.is_some());
    alert_incidents::update_status(&fixture.org, &opened.incident_id, "resolved")
        .await
        .unwrap();
    let replay = fixture
        .declare("attach", fixture.request(Subject::ServiceWithSource))
        .await
        .unwrap();
    assert!(!replay.created);
    assert_eq!(replay.incident_id, attached.incident_id);
    assert_eq!(replay.context_id, attached.context_id);
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
    assert_eq!(fixture.runtime.captures.load(Ordering::Relaxed), 1);
    assert_eq!(fixture.incident_count().await, 1);
}

#[tokio::test]
async fn declare_rejects_source_without_read_permission() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    let result = fixture
        .declare("unauthorized", fixture.request(Subject::ServiceWithSource))
        .await;
    assert!(matches!(result, Err(DeclareError::Forbidden)));
    assert_eq!(fixture.runtime.captures.load(Ordering::Relaxed), 0);
    assert_eq!(fixture.incident_count().await, 0);
}

#[tokio::test]
async fn declare_does_not_attach_a_possible_scope_match() {
    if !initialize_meta_store().await {
        return;
    }
    for (env, region, stored_region) in [
        ("stage", Some("east"), Some("east")),
        ("prod", Some("west"), Some("east")),
        ("prod", None, Some("east")),
        ("prod", Some("east"), None),
    ] {
        let fixture = Fixture::new();
        let mut stored = fixture.request(Subject::Service);
        stored.region = stored_region.map(str::to_string);
        let first = fixture.declare("prod", stored).await.unwrap();
        let request = || {
            let mut request = fixture.request(Subject::Service);
            request.env = Some(env.to_string());
            request.region = region.map(str::to_string);
            request
        };
        let preview = preview_with(&fixture.org, &fixture.user, request(), &fixture.runtime)
            .await
            .unwrap();
        let candidate = preview.candidate.unwrap();
        assert_eq!(candidate.incident_id, first.incident_id);
        assert!(matches!(candidate.scope_match, ScopeMatch::Possible));
        let second = fixture.declare("possible", request()).await.unwrap();
        assert!(second.created);
        assert_ne!(second.incident_id, first.incident_id);
        assert_eq!(fixture.incident_count().await, 2);
    }
}

#[tokio::test]
async fn declare_refuses_paging_without_a_team() {
    if !initialize_meta_store().await {
        return;
    }
    let mut fixture = Fixture::new();
    fixture.runtime.has_route = false;
    let result = fixture
        .declare("unrouted", fixture.request(Subject::Service))
        .await;
    assert!(matches!(result, Err(DeclareError::NoTeam)));
    assert_eq!(fixture.incident_count().await, 0);
}

async fn race_adds_at_limit(size: ContextSize) {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Arc::new(Fixture::new());
    fixture.grant_read();
    let result = fixture
        .declare("open", fixture.request(Subject::Service))
        .await
        .unwrap();
    let id = result.incident_id;
    fixture.add(&id, "context-000", size).await.unwrap();
    let bytes = fixture.stored_contexts(&id).await[0].bytes as usize;
    let limit = if size == ContextSize::Large {
        let byte_limit = MAX_INCIDENT_BYTES / bytes;
        assert!(
            byte_limit < 100,
            "the byte cap must be reached before the row cap"
        );
        byte_limit
    } else {
        assert!(100 * bytes < MAX_INCIDENT_BYTES);
        100
    };
    for index in 1..limit - 1 {
        fixture
            .add(&id, &format!("context-{index:03}"), size)
            .await
            .unwrap();
    }

    let race = Barriers::new();
    race.arm("declare.before_context_lock", 2);
    let task = |key: &'static str| {
        let (fixture, race, id) = (fixture.clone(), race.clone(), id.clone());
        tokio::spawn(async move { race.run(fixture.add(&id, key, size)).await })
    };
    let a = task("context-998");
    let b = task("context-999");
    match (a.await.unwrap(), b.await.unwrap()) {
        (Ok(_), Err(DeclareError::Conflict("Attachment limit reached")))
        | (Err(DeclareError::Conflict("Attachment limit reached")), Ok(_)) => {}
        other => panic!("expected one Add to and one attachment-limit conflict: {other:?}"),
    }
    let rows = fixture.stored_contexts(&id).await;
    assert_eq!(rows.len(), limit);
    let total_bytes = rows.iter().map(|row| row.bytes as usize).sum::<usize>();
    assert!(total_bytes <= MAX_INCIDENT_BYTES);
    if size == ContextSize::Large {
        assert!(total_bytes + bytes > MAX_INCIDENT_BYTES);
    }
    let events = incident_events::get_rw(&fixture.org, &id).await.unwrap();
    let attached = events
        .iter()
        .filter(|event| matches!(&event.event_type, IncidentEventType::ContextAttached { .. }))
        .count();
    assert_eq!(attached, limit);
    race.assert_all_met();
}

#[tokio::test]
async fn incident_contexts_concurrent_adds_reject_row_101() {
    race_adds_at_limit(ContextSize::Small).await;
}

#[tokio::test]
async fn incident_contexts_concurrent_adds_reject_over_one_mebibyte() {
    race_adds_at_limit(ContextSize::Large).await;
}

#[tokio::test]
async fn concurrent_incident_declare_keys_replay_across_distinct_lock_keys() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Arc::new(Fixture::new());
    let race = Barriers::new();
    if get_orm_client_rw().await.get_database_backend() == DatabaseBackend::Postgres {
        race.arm("declare.before_key_insert", 2);
    } else {
        race.arm("declare.before_key_insert", 1);
    }
    let declare = |service: &'static str| {
        let fixture = fixture.clone();
        let race = race.clone();
        async move {
            let mut request = fixture.request(Subject::Service);
            request.service = Some(service.to_owned());
            race.run(fixture.declare("same-key", request))
                .await
                .unwrap()
        }
    };
    let (a, b) = if get_orm_client_rw().await.get_database_backend() == DatabaseBackend::Postgres {
        let a = tokio::spawn(declare("checkout"));
        let b = tokio::spawn(declare("payment"));
        (a.await.unwrap(), b.await.unwrap())
    } else {
        (declare("checkout").await, declare("payment").await)
    };
    assert_eq!(a, b);
    assert!(a.created);
    assert_eq!(fixture.incident_count().await, 1);
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
    race.assert_all_met();
}

#[tokio::test]
async fn incident_contexts_restrict_metadata_and_payload_without_source_read() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    fixture.grant_read();
    let mut request = fixture.request(Subject::ServiceWithSource);
    request.note = Some("Author's detail".to_owned());
    let declared = fixture.declare("capture", request).await.unwrap();
    let incident = declared.incident_id;
    let context = declared.context_id.unwrap();

    let viewer = "cannot-read@example.test";
    let expected = json!({
        "kind": "logs",
        "created_by": fixture.user,
        "start_at": fixture.window_start,
        "end_at": fixture.window_start + MINUTE_US,
        "title": "Restricted context",
    });
    let listed = super::list_contexts_with(&fixture.org, &incident, viewer, &fixture.runtime)
        .await
        .unwrap();
    assert_eq!(listed, [expected.clone()]);
    let restricted =
        super::get_context_with(&fixture.org, &incident, &context, viewer, &fixture.runtime)
            .await
            .unwrap();
    assert_eq!(restricted, expected);

    let listed =
        super::list_contexts_with(&fixture.org, &incident, &fixture.user, &fixture.runtime)
            .await
            .unwrap();
    assert_eq!(listed[0]["id"], context);
    assert_eq!(listed[0]["title"], "Checkout errors");
    assert!(listed[0].get("target").is_none());
    let full = super::get_context_with(
        &fixture.org,
        &incident,
        &context,
        &fixture.user,
        &fixture.runtime,
    )
    .await
    .unwrap();
    assert_eq!(full["target"]["streams"], json!([STREAM]));
    assert_eq!(full["note"], "Author's detail");
}

#[tokio::test]
async fn declare_raising_attach_records_severity_and_pages_once() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    fixture.grant_read();
    let mut initial = fixture.request(Subject::Service);
    initial.severity = config::meta::alerts::incidents::IncidentSeverity::P3;
    let opened = fixture.declare("initial", initial).await.unwrap();
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 0);
    let raised = fixture
        .declare("raise", fixture.request(Subject::ServiceWithSource))
        .await
        .unwrap();
    assert_eq!(opened.incident_id, raised.incident_id);
    assert!(!raised.created);
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
    let events = incident_events::get_rw(&fixture.org, &raised.incident_id)
        .await
        .unwrap();
    assert!(
        events
            .iter()
            .any(|event| matches!(event.event_type, IncidentEventType::SeverityUpgrade { .. }))
    );
}

#[test]
fn declare_team_prefers_ownership_then_selected_team_then_catch_all() {
    let ownership = RoutingDecision::Ownership {
        team_id: "owner".to_owned(),
        rule_id: "rule".to_owned(),
        path: "service=checkout".to_owned(),
    };
    let default = RoutingDecision::Default {
        team_id: "catch-all".to_owned(),
    };
    for (decision, fallback, selected) in [
        (ownership, Some("picked"), None),
        (default.clone(), Some("picked"), Some("picked")),
        (default, None, None),
        (RoutingDecision::Unrouted, Some("picked"), Some("picked")),
    ] {
        assert_eq!(selected_team(&decision, fallback), selected);
    }
}

#[tokio::test]
async fn declare_started_first_can_attach_to_a_later_request_that_commits_first() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Arc::new(Fixture::new());
    fixture.grant_read();
    let start = fixture.window_start + 5 * MINUTE_US;
    fixture.runtime.clock.store(start, Ordering::Relaxed);
    let race = Barriers::new();
    race.arm("declare.test_capture_started", 2);
    race.arm("declare.test_capture_resume", 2);
    let slow = tokio::spawn(scoped_declare(
        fixture.clone(),
        race.clone(),
        "slow",
        Subject::ServiceWithSource,
    ));
    race.wait("declare.test_capture_started").await;
    fixture
        .runtime
        .clock
        .store(start + 10 * MINUTE_US, Ordering::Relaxed);
    let fast = fixture
        .declare("fast", fixture.request(Subject::ServiceWithSource))
        .await
        .unwrap();
    fixture
        .runtime
        .clock
        .store(start - MINUTE_US, Ordering::Relaxed);
    race.wait("declare.test_capture_resume").await;
    let slow = slow.await.unwrap();
    assert!(fast.created);
    assert_single_declare(&fixture, fast, slow).await;
    race.assert_all_met();
}

#[tokio::test]
async fn declare_mutes_a_downtime_that_starts_during_capture() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Arc::new(Fixture::new());
    fixture.grant_read();
    let start = fixture.window_start + 5 * MINUTE_US;
    fixture.runtime.clock.store(start, Ordering::Relaxed);
    fixture
        .runtime
        .downtime_at
        .store(start + 1, Ordering::Relaxed);
    let race = Barriers::new();
    race.arm("declare.test_capture_started", 2);
    race.arm("declare.test_capture_resume", 2);
    let pending = tokio::spawn(scoped_declare(
        fixture.clone(),
        race.clone(),
        "mute",
        Subject::ServiceWithSource,
    ));
    race.wait("declare.test_capture_started").await;
    fixture.runtime.clock.store(start + 2, Ordering::Relaxed);
    race.wait("declare.test_capture_resume").await;
    let response = pending.await.unwrap();
    let row = alert_incidents::get_rw(&fixture.org, &response.incident_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.muted_by_downtime_id.as_deref(), Some("test-downtime"));
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 0);
    race.assert_all_met();
}

async fn commit_declare_without_dispatch(
    fixture: &Fixture,
    key: &str,
    request: &DeclareRequest,
) -> DeclareResponse {
    let note = super::validate_request(&fixture.org, &fixture.user, request)
        .await
        .unwrap();
    let mut prepared = prepare_write(
        subject(
            &fixture.org,
            request,
            request.source.as_ref(),
            fixture.runtime.now(),
        ),
        &fixture.user,
        key,
        request,
        note,
        &fixture.runtime,
    )
    .await
    .unwrap();
    let txn = get_orm_client_rw().await.begin().await.unwrap();
    let WriteResult::Written(response) = write_declare(&txn, &mut prepared, &fixture.runtime)
        .await
        .unwrap()
    else {
        panic!("Expected a new declare");
    };
    txn.commit().await.unwrap();
    response
}

#[tokio::test]
async fn declare_rechecks_downtime_after_commit_and_uses_committed_confirmation() {
    if !initialize_meta_store().await {
        return;
    }
    for page_through in [false, true] {
        let fixture = Fixture::new();
        let start = fixture.window_start + 5 * MINUTE_US;
        fixture.runtime.clock.store(start, Ordering::Relaxed);
        fixture
            .runtime
            .downtime_at
            .store(start + 1, Ordering::Relaxed);
        let mut request = fixture.request(Subject::Service);
        request.page_through_downtime = page_through;
        let committed = commit_declare_without_dispatch(&fixture, "after-commit", &request).await;
        let row = alert_incidents::get_rw(&fixture.org, &committed.incident_id)
            .await
            .unwrap()
            .unwrap();
        assert!(row.muted_by_downtime_id.is_none());
        fixture.runtime.clock.store(start + 2, Ordering::Relaxed);
        request.page_through_downtime = !page_through;
        let replay = fixture.declare("after-commit", request).await.unwrap();
        assert_eq!(committed, replay);
        assert_eq!(
            fixture.runtime.pages.load(Ordering::Relaxed),
            usize::from(page_through)
        );
    }
}

#[tokio::test]
async fn incident_declare_keys_resume_committed_effects_and_retry_only_the_missing_destination() {
    if !initialize_meta_store().await {
        return;
    }
    let mut fixture = Fixture::new();
    fixture.runtime.destinations = vec!["sent".to_owned(), "retry".to_owned()];
    *fixture.runtime.fail_once.lock().unwrap() = Some("retry".to_owned());
    let key = "missed-effect";
    let mut request = fixture.request(Subject::Service);
    request.note = Some("Keep this guidance private".to_owned());
    let committed = commit_declare_without_dispatch(&fixture, key, &request).await;
    let seq = incident_events::seq(&fixture.org, &committed.incident_id)
        .await
        .unwrap();
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 0);
    assert!(fixture.runtime.notifications.lock().unwrap().is_empty());

    for _ in 0..3 {
        let replay = fixture
            .declare(key, fixture.request(Subject::Service))
            .await
            .unwrap();
        assert_eq!(committed, replay);
    }
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
    assert_eq!(fixture.runtime.rcas.load(Ordering::Relaxed), 1);
    assert_eq!(
        *fixture.runtime.notifications.lock().unwrap(),
        ["sent", "retry", "retry"]
    );
    assert_eq!(
        incident_events::seq(&fixture.org, &committed.incident_id)
            .await
            .unwrap(),
        seq
    );
    use infra::table::entity::incident_events as timeline;
    let row = timeline::Entity::find_by_id((fixture.org.clone(), committed.incident_id.clone()))
        .one(get_orm_client_rw().await)
        .await
        .unwrap()
        .unwrap();
    assert!(!row.events.to_string().contains("DeclareEffects"));
    assert!(
        !row.events
            .to_string()
            .contains("Keep this guidance private")
    );
    let intent = incident_declare_keys::get_intent(&fixture.org, key)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        intent.source_less_guidance.as_deref(),
        Some("Keep this guidance private")
    );
    assert!(
        intent
            .effects
            .iter()
            .all(|entry| entry.state == DeclareEffectState::Complete)
    );
    assert!(
        intent
            .effects
            .iter()
            .find(|entry| entry.kind
                == DeclareEffectKind::Notify {
                    destination: "retry".to_owned(),
                })
            .unwrap()
            .possible_duplicate
    );
}

#[tokio::test]
async fn incident_declare_keys_reclaim_an_interrupted_effect_after_its_lease() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    let key = "interrupted";
    let start = fixture.window_start + 5 * MINUTE_US;
    fixture.runtime.clock.store(start, Ordering::Relaxed);
    let committed =
        commit_declare_without_dispatch(&fixture, key, &fixture.request(Subject::Service)).await;
    incident_declare_keys::mutate_intent(&fixture.org, key, |intent| {
        intent.effects[0].state = DeclareEffectState::Claimed { at: start };
        Some(())
    })
    .await
    .unwrap()
    .unwrap();
    fixture
        .declare(key, fixture.request(Subject::Service))
        .await
        .unwrap();
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 0);
    assert_eq!(fixture.runtime.rcas.load(Ordering::Relaxed), 0);
    fixture
        .runtime
        .clock
        .store(start + 6 * MINUTE_US, Ordering::Relaxed);
    let replay = fixture
        .declare(key, fixture.request(Subject::Service))
        .await
        .unwrap();
    assert_eq!(replay, committed);
    assert_eq!(fixture.runtime.pages.load(Ordering::Relaxed), 1);
    assert_eq!(fixture.runtime.rcas.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn incident_contexts_cap_future_window_end_before_capture_and_storage() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    fixture.grant_read();
    let now = fixture.window_start + 5 * MINUTE_US;
    fixture.runtime.clock.store(now, Ordering::Relaxed);
    let incident = fixture
        .declare("new", fixture.request(Subject::Service))
        .await
        .unwrap()
        .incident_id;
    let mut source = fixture.source(ContextSize::Small);
    source.target.end_us = now + MINUTE_US;
    add_context_with(
        &fixture.org,
        &incident,
        &fixture.user,
        None,
        AddContextRequest {
            source: source.clone(),
            note: None,
        },
        &fixture.runtime,
    )
    .await
    .unwrap();
    assert_eq!(
        fixture.runtime.last_capture_end.load(Ordering::Relaxed),
        now
    );
    let rows = fixture.stored_contexts(&incident).await;
    assert_eq!(rows[0].end_at, now);
    let stored: config::meta::alerts::incidents::ContextTarget =
        serde_json::from_str(&rows[0].target).unwrap();
    assert_eq!(stored.end_us, now);

    source.target.start_us = now + 1;
    let error = add_context_with(
        &fixture.org,
        &incident,
        &fixture.user,
        None,
        AddContextRequest { source, note: None },
        &fixture.runtime,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, DeclareError::BadRequest(_)));
    assert_eq!(fixture.runtime.captures.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn declare_caps_the_initial_context_window_before_capture_and_storage() {
    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    fixture.grant_read();
    let now = fixture.window_start + 5 * MINUTE_US;
    fixture.runtime.clock.store(now, Ordering::Relaxed);
    let mut request = fixture.request(Subject::ServiceWithSource);
    request.source.as_mut().unwrap().target.end_us = now + MINUTE_US;

    let declared = fixture.declare("future-window", request).await.unwrap();
    let rows = fixture.stored_contexts(&declared.incident_id).await;
    let stored: config::meta::alerts::incidents::ContextTarget =
        serde_json::from_str(&rows[0].target).unwrap();
    assert_eq!(
        (
            fixture.runtime.last_capture_end.load(Ordering::Relaxed),
            rows[0].end_at,
            stored.end_us,
        ),
        (now, now, now)
    );
}

#[tokio::test]
async fn declare_raising_attach_uses_the_declare_route_and_downtime_dimensions() {
    if !initialize_meta_store().await {
        return;
    }
    for muted in [false, true] {
        let mut fixture = Fixture::new();
        fixture.grant_read();
        fixture.runtime.service_team = Some("selected-team");
        fixture.runtime.downtime_service = Some("checkout");
        let mut initial = fixture.request(Subject::Source);
        initial.severity = config::meta::alerts::incidents::IncidentSeverity::P3;
        let original = fixture.declare("source", initial).await.unwrap();

        if muted {
            fixture.runtime.downtime_at.store(0, Ordering::Relaxed);
        }
        let raised = fixture
            .declare("raise", fixture.request(Subject::ServiceWithSource))
            .await
            .unwrap();
        assert_eq!(raised.incident_id, original.incident_id);
        assert!(!raised.created);

        let intent = incident_declare_keys::get_intent(&fixture.org, "raise")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            intent.request_dimensions.get("service").map(String::as_str),
            Some("checkout")
        );
        assert!(!intent.dimensions.contains_key("service"));
        assert_eq!(intent.team.as_deref(), Some("selected-team"));
        let paged = fixture.runtime.paged_teams.lock().unwrap();
        if muted {
            assert!(paged.is_empty());
        } else {
            assert_eq!(*paged, ["selected-team"]);
        }
    }
}

#[tokio::test]
async fn declare_checks_request_downtime_and_keeps_a_stored_incident_mute() {
    if !initialize_meta_store().await {
        return;
    }
    for stored_muted in [false, true] {
        let mut fixture = Fixture::new();
        fixture.grant_read();
        fixture.runtime.downtime_service = Some("checkout");
        if stored_muted {
            fixture.runtime.downtime_at.store(0, Ordering::Relaxed);
        }
        let mut original = fixture.request(Subject::ServiceWithSource);
        original.severity = config::meta::alerts::incidents::IncidentSeverity::P3;
        let original = fixture.declare("service", original).await.unwrap();

        fixture.runtime.downtime_at.store(0, Ordering::Relaxed);
        let raised = fixture
            .declare("raise", fixture.request(Subject::Source))
            .await
            .unwrap();

        assert_eq!(raised.incident_id, original.incident_id);
        assert!(!raised.created);
        let row = alert_incidents::get_rw(&fixture.org, &raised.incident_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.muted_by_downtime_id.as_deref(),
            stored_muted.then_some("test-downtime")
        );
        assert_eq!(
            fixture.runtime.pages.load(Ordering::Relaxed),
            usize::from(!stored_muted)
        );
    }
}

#[tokio::test]
async fn declare_rearms_unfinished_impacted_deliveries_even_with_a_page_event() {
    if !initialize_meta_store().await {
        return;
    }
    infra::scheduler::init().await.unwrap();
    let fixture = Fixture::new();
    let incident = fixture
        .declare("open", fixture.request(Subject::Service))
        .await
        .unwrap();
    let owner = oncall_responses::open(
        &fixture.org,
        &SubjectRef::new(SubjectType::Incident, &incident.incident_id, 1),
        Some(TEAM),
        2,
        None,
        ResponderRole::Owner,
        None,
    )
    .await
    .unwrap();
    let mut pages = Vec::new();
    for team in ["interrupted", "finished", "partial"] {
        let source = format!("{}:impacted:{team}", incident.incident_id);
        let page = oncall_responses::open(
            &fixture.org,
            &SubjectRef::new(SubjectType::Incident, source, 1),
            Some(team),
            2,
            None,
            ResponderRole::Impacted,
            Some(&owner.id),
        )
        .await
        .unwrap();
        pages.push(page);
    }
    for page in &pages[1..] {
        oncall_responses::add_event(
            &page.id,
            &ResponseEvent::new(
                ResponseEventKind::Page,
                now_micros(),
                "engine",
                "Opening page",
            )
            .at_rung(0)
            .in_run(page.current_run()),
        )
        .await
        .unwrap();
    }
    let partial = &pages[2];
    let pair = oncall_responses::DeliveryPair {
        response_id: &partial.id,
        ladder_run: partial.current_run(),
        rung_micros: 0,
        recipient: "pending@example.test",
        channel: Channel::Email,
    };
    assert!(
        oncall_responses::claim_delivery(&fixture.org, &pair, "engine", "pending", 0)
            .await
            .unwrap()
            .is_some()
    );
    let timeline = oncall_responses::list_events(&partial.id).await.unwrap();
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].kind, ResponseEventKind::Page);
    assert!(
        oncall_responses::with_delivery_retries(
            &partial.id,
            oncall_responses::list_events(&partial.id),
        )
        .await
        .unwrap()
        .is_empty()
    );

    let now = now_micros();
    super::effects::resume_impacted_openings(&fixture.org, &owner.id, now)
        .await
        .unwrap();
    let job = infra::scheduler::get(&fixture.org, TriggerModule::OncallEscalation, &pages[0].id)
        .await
        .unwrap();
    assert_eq!(job.next_run_at, now);
    assert!(
        infra::scheduler::get(&fixture.org, TriggerModule::OncallEscalation, &pages[1].id)
            .await
            .is_err()
    );
    let partial_job =
        infra::scheduler::get(&fixture.org, TriggerModule::OncallEscalation, &partial.id)
            .await
            .unwrap();
    assert_eq!(partial_job.next_run_at, now);
    super::effects::resume_impacted_openings(&fixture.org, &owner.id, now + MINUTE_US)
        .await
        .unwrap();
    let job = infra::scheduler::get(&fixture.org, TriggerModule::OncallEscalation, &pages[0].id)
        .await
        .unwrap();
    assert_eq!(job.next_run_at, now);

    let sent = ResponseEvent::new(ResponseEventKind::Delivery, now, "engine", "sent")
        .at_rung(pair.rung_micros)
        .in_run(pair.ladder_run)
        .delivered_to(pair.recipient, pair.channel, true);
    oncall_responses::add_event(&partial.id, &sent)
        .await
        .unwrap();
    let timeline = oncall_responses::with_delivery_retries(
        &partial.id,
        oncall_responses::list_events(&partial.id),
    )
    .await
    .unwrap();
    assert_eq!(timeline.len(), 1);
    assert_eq!(timeline[0].kind, ResponseEventKind::Page);
}

#[tokio::test]
async fn declare_rca_recovers_a_run_and_its_bound_session_until_a_turn_is_admitted() {
    use config::meta::alerts::rca_runs::{RunMode, RunSubjectType, RunTrigger};
    use infra::table::{ai_chat_sessions, ai_chat_turns, rca_runs};

    use super::effects::{RcaRecovery, rca_recovery};

    if !initialize_meta_store().await {
        return;
    }
    let fixture = Fixture::new();
    let incident = fixture
        .declare("open", fixture.request(Subject::Service))
        .await
        .unwrap()
        .incident_id;
    let id = rca_runs::new_run_id();
    let new = rca_runs::NewRun {
        run_id: id.clone(),
        org_id: fixture.org.clone(),
        subject_type: RunSubjectType::Incident,
        subject_id: incident.clone(),
        incident_id: Some(incident.clone()),
        trigger: RunTrigger::AutoNewIncident,
        mode: RunMode::Fresh,
        started_by: "system".to_owned(),
        guidance: None,
        oncall_subjects: None,
        context_used: None,
        recipients: vec![],
        page_key: None,
    };
    assert!(matches!(
        rca_runs::start_run(
            new,
            rca_runs::StartGuards {
                now_us: now_micros(),
                rca_timeout_secs: 60,
                cooldown_us: None,
                history_limit: 10,
                latest_run_id: None,
                first_run: false,
            },
            None,
            None
        )
        .await
        .unwrap(),
        rca_runs::StartResult::Started { .. }
    ));
    assert_eq!(
        rca_recovery(&fixture.org, &incident).await.unwrap(),
        RcaRecovery::Launch {
            run_id: id.clone(),
            session_id: None,
        }
    );

    let session = config::ider::uuid();
    rca_runs::update_run(
        &fixture.org,
        &id,
        rca_runs::RunUpdate {
            session_id: Some(session.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let recover_bound = RcaRecovery::Launch {
        run_id: id,
        session_id: Some(session.clone()),
    };
    assert_eq!(
        rca_recovery(&fixture.org, &incident).await.unwrap(),
        recover_bound
    );

    let now = now_micros();
    let session_row =
        ai_chat_sessions::get_or_create(&fixture.org, &session, "owner", &fixture.user, "rca", now)
            .await
            .unwrap();
    let turn = config::ider::uuid();
    ai_chat_turns::admit(&fixture.org, &session, &turn, 1, now)
        .await
        .unwrap();
    assert_eq!(
        rca_recovery(&fixture.org, &incident).await.unwrap(),
        recover_bound
    );
    let epoch = session_row.session_epoch;
    assert_eq!(
        ai_chat_sessions::bump_epoch_for_turn(&fixture.org, &session, &turn, epoch - 1, now)
            .await
            .unwrap(),
        None
    );
    ai_chat_turns::finish(
        &fixture.org,
        &session,
        &turn,
        ai_chat_turns::TURN_FAILED,
        Some("epoch_conflict"),
        None,
        None,
        now,
    )
    .await
    .unwrap();
    assert_eq!(
        rca_recovery(&fixture.org, &incident).await.unwrap(),
        recover_bound
    );
    let retry = config::ider::uuid();
    ai_chat_turns::admit(&fixture.org, &session, &retry, 1, now)
        .await
        .unwrap();
    assert_eq!(
        ai_chat_sessions::bump_epoch_for_turn(&fixture.org, &session, &retry, epoch, now)
            .await
            .unwrap(),
        Some(epoch + 1)
    );
    assert_eq!(
        rca_recovery(&fixture.org, &incident).await.unwrap(),
        RcaRecovery::Complete
    );
}
