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

use axum::{body::to_bytes, extract::Query};
use config::meta::{
    alerts::{
        alert::Alert,
        priority::AlertPriority,
        state::{AlertState, StateUpdate},
    },
    downtimes::{AlertMuteExtendRequest, AlertMuteRequest, CancelDowntimeQuery},
    folder::{DEFAULT_FOLDER, Folder, FolderType},
    oncall::{ResponderRole, ResponseEventKind, SubjectRef, SubjectType},
    self_reporting::usage::RunOutcome,
    user::UserRole,
};
use o2_enterprise::enterprise::common::config::with_incidents_v2;
use openobserve_api_common::extractors::ValidatedJson;
use svix_ksuid::{Ksuid, KsuidLike};

use super::*;
use crate::request::{
    alerts::{incidents, mute},
    oncall,
};

#[derive(Clone, Copy, Debug)]
enum Identity {
    Human,
    Assistant,
    Mcp,
    Agent,
}

#[derive(Clone, Copy, Debug)]
enum Route {
    Ack,
    TakeOver,
    Unack,
    IncidentAck,
    IncidentUnack,
    Mute,
    Extend,
    Unmute,
    PageAck,
    PageUnack,
    Snooze,
    Unsnooze,
    HandOff,
    Escalate,
    Promote,
    Note,
    ConfirmRecovery,
    Resolve,
}

impl Route {
    const ALL: [Self; 18] = [
        Self::Ack,
        Self::TakeOver,
        Self::Unack,
        Self::IncidentAck,
        Self::IncidentUnack,
        Self::Mute,
        Self::Extend,
        Self::Unmute,
        Self::PageAck,
        Self::PageUnack,
        Self::Snooze,
        Self::Unsnooze,
        Self::HandOff,
        Self::Escalate,
        Self::Promote,
        Self::Note,
        Self::ConfirmRecovery,
        Self::Resolve,
    ];
}

struct Fixture {
    org: String,
    root: String,
    agent: String,
    incident: String,
    alert: String,
    page: String,
}

impl Fixture {
    async fn new() -> Option<Self> {
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return None;
        }
        crate::request::security::tests::meta_store().await;
        let org = format!("s15_{}", config::ider::uuid());
        let root = format!("root-{org}@example.com");
        let agent = sre_agent(&org);
        for email in [&root, &agent] {
            common::infra::config::ORG_USERS.insert(
                format!("{}/{email}", config::DEFAULT_ORG),
                infra::table::org_users::OrgUserRecord::new(
                    config::DEFAULT_ORG,
                    email,
                    UserRole::Root,
                    "token",
                    None,
                ),
            );
        }
        let now = config::utils::time::now_micros();
        let id = Ksuid::new(None, None);
        let mut alert = Alert::default();
        alert.id = Some(id);
        alert.org_id = org.clone();
        alert.name = "checkout errors".to_string();
        alert.priority = Some(AlertPriority::P3);
        let folder = Folder {
            folder_id: DEFAULT_FOLDER.to_string(),
            ..Default::default()
        };
        infra::table::folders::get_or_create(&org, folder.clone(), FolderType::Downtimes)
            .await
            .unwrap();
        common::infra::config::ALERTS.write().await.insert(
            db::alerts::alert::cache_alert_key(&org, &id.to_string()),
            (folder, alert),
        );
        infra::table::alert_states::persist(
            &StateUpdate {
                state: Some(AlertState {
                    last_outcome: Some(RunOutcome::Firing),
                    last_outcome_at: Some(now),
                    since: Some(now),
                    firing_started_at: Some(now),
                    ..AlertState::empty(&id.to_string(), "")
                }),
                transition: None,
            },
            None,
        )
        .await
        .unwrap();
        let incident = infra::table::alert_incidents::create(
            &org,
            "P3",
            serde_json::json!({}),
            "alert",
            now,
            Some("Checkout".to_string()),
        )
        .await
        .unwrap();
        infra::table::alert_incidents::add_alert_to_incident(
            &incident.id,
            &id.to_string(),
            "checkout errors",
            "alert",
            now,
            "test",
        )
        .await
        .unwrap();
        let page = infra::table::oncall_responses::open(
            &org,
            &SubjectRef::new(SubjectType::Incident, &incident.id, 1),
            None,
            3,
            Some("Checkout"),
            ResponderRole::Owner,
            None,
        )
        .await
        .unwrap();
        infra::table::oncall_responses::attach_incident(&org, &page.id, &incident.id)
            .await
            .unwrap();
        Some(Self {
            org,
            root,
            agent,
            incident: incident.id,
            alert: id.to_string(),
            page: page.id,
        })
    }

    fn request(
        &self,
        identity: Identity,
    ) -> (
        Headers<UserEmail>,
        Option<Extension<DelegatedCaller>>,
        HeaderMap,
    ) {
        let email = if matches!(identity, Identity::Agent) {
            &self.agent
        } else {
            &self.root
        };
        let delegated = matches!(identity, Identity::Assistant).then(|| {
            Extension(DelegatedCaller {
                org: self.org.clone(),
                ..caller(SCOPE_ASSISTANT)
            })
        });
        let headers = if matches!(identity, Identity::Mcp) {
            mcp_call()
        } else {
            HeaderMap::new()
        };
        (
            Headers(UserEmail {
                user_id: email.clone(),
            }),
            delegated,
            headers,
        )
    }

    async fn call(&self, route: Route, identity: Identity) -> Response {
        let (user, delegated, headers) = self.request(identity);
        let alert = Path((self.org.clone(), self.alert.clone()));
        let incident = Path((self.org.clone(), self.incident.clone()));
        let page = Path((self.org.clone(), self.page.clone()));
        match route {
            Route::Ack | Route::TakeOver => {
                ack_alert(
                    alert,
                    user,
                    delegated,
                    headers,
                    Json(AckRequest {
                        take_over: matches!(route, Route::TakeOver),
                        ..Default::default()
                    }),
                )
                .await
            }
            Route::Unack => {
                unack_alert(
                    alert,
                    user,
                    delegated,
                    headers,
                    Json(UnackRequest::default()),
                )
                .await
            }
            Route::IncidentAck => {
                ack_incident(incident, user, delegated, headers, Bytes::new()).await
            }
            Route::IncidentUnack => unack_incident(incident, user, delegated, headers).await,
            Route::Mute => {
                mute::mute_alert(
                    alert,
                    user,
                    delegated,
                    headers,
                    Json(AlertMuteRequest {
                        minutes: Some(30),
                        ..Default::default()
                    }),
                )
                .await
            }
            Route::Extend => {
                mute::extend_alert_mute(
                    Path((self.org.clone(), self.alert.clone(), "missing".to_string())),
                    user,
                    delegated,
                    headers,
                    Json(AlertMuteExtendRequest {
                        version: 1,
                        minutes: Some(30),
                        until_clear: false,
                        ends_at: None,
                    }),
                )
                .await
            }
            Route::Unmute => {
                mute::cancel_alert_mute(
                    Path((self.org.clone(), self.alert.clone(), "missing".to_string())),
                    Query(CancelDowntimeQuery { version: Some(1) }),
                    user,
                    delegated,
                    headers,
                )
                .await
            }
            Route::PageAck => {
                oncall::acknowledge_response(page, user, delegated, headers, Bytes::new()).await
            }
            Route::PageUnack => {
                oncall::unacknowledge_response(page, user, delegated, headers).await
            }
            Route::Snooze => {
                oncall::snooze_response(
                    page,
                    user,
                    delegated,
                    headers,
                    ValidatedJson(oncall::SnoozeRequest { minutes: 10 }),
                )
                .await
            }
            Route::Unsnooze => oncall::unsnooze_response(page, user, delegated, headers).await,
            Route::HandOff => {
                oncall::handoff_response(
                    page,
                    user,
                    delegated,
                    headers,
                    ValidatedJson(oncall::HandoffRequest {
                        to: Some("missing@example.com".to_string()),
                        to_team_id: None,
                        note: None,
                    }),
                )
                .await
            }
            Route::Escalate => {
                oncall::escalate_response(page, user, delegated, headers, ValidatedJson(None)).await
            }
            Route::Promote => {
                oncall::promote_to_incident(page, user, delegated, headers, ValidatedJson(None))
                    .await
            }
            Route::Note => {
                oncall::add_note(
                    page,
                    user,
                    delegated,
                    headers,
                    ValidatedJson(oncall::AddNoteRequest {
                        body: "Checking checkout".to_string(),
                    }),
                )
                .await
            }
            Route::ConfirmRecovery => {
                oncall::confirm_recovery(page, user, delegated, headers, ValidatedJson(None)).await
            }
            Route::Resolve => {
                oncall::resolve_response(page, user, delegated, headers, ValidatedJson(None)).await
            }
        }
    }

    async fn own(&self, email: &str, body: serde_json::Value) -> Response {
        ack_incident(
            Path((self.org.clone(), self.incident.clone())),
            Headers(UserEmail {
                user_id: email.to_string(),
            }),
            None,
            HeaderMap::new(),
            Bytes::from(serde_json::to_vec(&body).unwrap()),
        )
        .await
    }

    async fn model(&self) -> infra::table::entity::alert_incidents::Model {
        infra::table::alert_incidents::get_rw(&self.org, &self.incident)
            .await
            .unwrap()
            .unwrap()
    }
}

async fn json_body(response: Response) -> serde_json::Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

#[tokio::test]
async fn every_incident_entrypoint_refuses_all_three_ai_identities_before_writing() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    let before = fixture.model().await;
    with_incidents_v2(true, async {
        for identity in [Identity::Assistant, Identity::Mcp, Identity::Agent] {
            for route in Route::ALL {
                let response = fixture.call(route, identity).await;
                assert_eq!(
                    response.status(),
                    StatusCode::FORBIDDEN,
                    "{identity:?} {route:?}"
                );
                let refusal: ActRefusal =
                    serde_json::from_value(json_body(response).await).unwrap();
                assert!(
                    refusal.message.contains("AI assistant"),
                    "{identity:?} {route:?}"
                );
            }
        }
    })
    .await;
    assert_eq!(fixture.model().await, before);
    assert!(
        infra::table::oncall_responses::list_events(&fixture.page)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        infra::table::alert_acks::list_for_alert(&fixture.org, &fixture.alert)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn v2_off_preserves_the_live_result_for_every_incident_entrypoint() {
    with_incidents_v2(false, async {
        for route in Route::ALL {
            let Some(person) = Fixture::new().await else {
                return;
            };
            let live = person.call(route, Identity::Human).await.status();
            assert!(!live.is_server_error(), "{route:?} {live}");
            if matches!(
                route,
                Route::Ack
                    | Route::TakeOver
                    | Route::Unack
                    | Route::IncidentAck
                    | Route::IncidentUnack
                    | Route::PageAck
                    | Route::PageUnack
                    | Route::Resolve
            ) {
                assert_eq!(live, StatusCode::OK, "{route:?}");
            }
            for identity in [Identity::Assistant, Identity::Mcp, Identity::Agent] {
                let Some(fixture) = Fixture::new().await else {
                    return;
                };
                let actual = fixture.call(route, identity).await.status();
                let expected = if matches!(route, Route::Resolve) {
                    StatusCode::FORBIDDEN
                } else {
                    live
                };
                assert_eq!(actual, expected, "{identity:?} {route:?}");
            }
        }
    })
    .await;
}

#[tokio::test]
async fn ai_ack_with_v2_off_does_not_assign_the_empty_lead() {
    with_incidents_v2(false, async {
        for identity in [Identity::Assistant, Identity::Mcp, Identity::Agent] {
            let Some(fixture) = Fixture::new().await else {
                return;
            };
            assert_eq!(
                fixture.call(Route::IncidentAck, identity).await.status(),
                StatusCode::OK
            );
            assert_eq!(fixture.model().await.assigned_to, None);
        }
    })
    .await;
}

#[tokio::test]
async fn new_ownership_fields_refuse_when_v2_is_off_and_old_body_still_works() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    with_incidents_v2(false, async {
        for body in [
            serde_json::json!({"assign_self": false}),
            serde_json::json!({"expected_holder": null}),
            serde_json::json!({"expected_lead": null}),
        ] {
            let response = fixture.own(&fixture.root, body).await;
            assert_eq!(response.status(), StatusCode::CONFLICT);
            assert_eq!(
                json_body(response).await["message"],
                common::meta::incidents_v2::INCIDENTS_V2_OFF_MESSAGE
            );
        }
        assert_eq!(
            fixture
                .own(&fixture.root, serde_json::json!({}))
                .await
                .status(),
            StatusCode::OK
        );
    })
    .await;
}

#[tokio::test]
async fn stale_expected_values_return_actual_values_and_write_nothing() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    with_incidents_v2(true, async {
        let response = fixture.own(&fixture.root, serde_json::json!({"assign_self": true})).await;
        assert_eq!(response.status(), StatusCode::OK);
        let before = fixture.model().await;
        for (holder, lead) in [("stale", fixture.root.as_str()), (fixture.root.as_str(), "stale")] {
            let response = fixture.own(&fixture.root, serde_json::json!({
                "take_over": true, "assign_self": true, "expected_holder": holder, "expected_lead": lead,
            })).await;
            assert_eq!(response.status(), StatusCode::CONFLICT);
            let body = json_body(response).await;
            assert_eq!(body["acked"], fixture.root);
            assert_eq!(body["assigned_to"], fixture.root);
            assert_eq!(fixture.model().await, before);
        }
    }).await;
}

#[tokio::test]
async fn page_acknowledgement_refuses_a_stale_expected_lead() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    with_incidents_v2(true, async {
        let before = infra::table::alert_incidents::update_assigned_to(
            &fixture.org,
            &fixture.incident,
            Some("current-lead@example.com"),
        )
        .await
        .unwrap();
        let (user, delegated, headers) = fixture.request(Identity::Human);
        let response = oncall::acknowledge_response(
            Path((fixture.org.clone(), fixture.page.clone())),
            user,
            delegated,
            headers,
            Bytes::from_static(
                br#"{"assign_self":true,"expected_lead":"former-lead@example.com"}"#,
            ),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(fixture.model().await, before);
    })
    .await;
}

#[tokio::test]
async fn another_persons_hold_stays_until_an_explicit_takeover() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    let other = format!("other-{}@example.com", fixture.org);
    common::infra::config::ORG_USERS.insert(
        format!("{}/{other}", config::DEFAULT_ORG),
        infra::table::org_users::OrgUserRecord::new(
            config::DEFAULT_ORG,
            &other,
            UserRole::Root,
            "token",
            None,
        ),
    );
    with_incidents_v2(true, async {
        assert_eq!(fixture.own(&fixture.root, serde_json::json!({"assign_self": true})).await.status(), StatusCode::OK);
        let before = fixture.model().await;
        let mut body = serde_json::json!({"assign_self": true, "expected_holder": fixture.root, "expected_lead": fixture.root});
        let response = fixture.own(&other, body.clone()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let actual = json_body(response).await;
        assert_eq!(actual["acked"], fixture.root);
        assert_eq!(actual["assigned_to"], fixture.root);
        assert_eq!(fixture.model().await, before);
        body["take_over"] = true.into();
        let response = fixture.own(&other, body).await;
        assert_eq!(response.status(), StatusCode::OK);
        let actual = json_body(response).await;
        assert_eq!(actual["acked"], other);
        assert_eq!(actual["assigned_to"], other);
        let firing = infra::table::alert_acks::get(&fixture.org, &fixture.alert, "").await.unwrap().unwrap();
        assert_eq!(firing.acked_by, other);
    }).await;
}

async fn assert_one_page_stop(fixture: &Fixture, winner: &str) {
    let page = infra::table::oncall_responses::get(&fixture.org, &fixture.page)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(page.acked_by.as_deref(), Some(winner));
    let events = infra::table::oncall_responses::list_events(&fixture.page)
        .await
        .unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == ResponseEventKind::Ack)
            .count(),
        1
    );
    let firing = infra::table::alert_acks::get(&fixture.org, &fixture.alert, "")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(firing.acked_by, winner);
}

#[tokio::test]
async fn take_ownership_has_one_winner_and_stops_pages_once() {
    for reverse in [false, true] {
        let Some(fixture) = Fixture::new().await else {
            return;
        };
        let other = format!("other-{}@example.com", fixture.org);
        common::infra::config::ORG_USERS.insert(
            format!("{}/{other}", config::DEFAULT_ORG),
            infra::table::org_users::OrgUserRecord::new(
                config::DEFAULT_ORG,
                &other,
                UserRole::Root,
                "token",
                None,
            ),
        );
        let actors = if reverse {
            [&other, &fixture.root]
        } else {
            [&fixture.root, &other]
        };
        with_incidents_v2(true, async {
            let body = serde_json::json!({"assign_self": true, "take_over": true});
            let (first, second) = if config::get_config().common.meta_store == "postgres" {
                let barriers = infra::race::Barriers::new();
                barriers.arm("alert_incidents.ownership_before_lock", 2);
                let pair = tokio::join!(
                    barriers.run(fixture.own(actors[0], body.clone())),
                    barriers.run(fixture.own(actors[1], body.clone())),
                );
                barriers.assert_all_met();
                pair
            } else {
                (
                    fixture.own(actors[0], body.clone()).await,
                    fixture.own(actors[1], body).await,
                )
            };
            let statuses = [first.status(), second.status()];
            assert!(
                statuses == [StatusCode::OK, StatusCode::CONFLICT]
                    || statuses == [StatusCode::CONFLICT, StatusCode::OK]
            );
            let winner = if statuses[0] == StatusCode::OK {
                actors[0]
            } else {
                actors[1]
            };
            for response in [first, second] {
                let body = json_body(response).await;
                assert_eq!(body["acked"], winner.as_str());
                assert_eq!(body["assigned_to"], winner.as_str());
            }
            assert_one_page_stop(&fixture, winner).await;
        })
        .await;
    }
}

#[tokio::test]
async fn delayed_takeover_effects_never_overwrite_a_newer_holder() {
    for repeated in [false, true] {
        let Some(fixture) = Fixture::new().await else {
            return;
        };
        let newer_holder = format!("newer-{}@example.com", fixture.org);
        common::infra::config::ORG_USERS.insert(
            format!("{}/{newer_holder}", config::DEFAULT_ORG),
            infra::table::org_users::OrgUserRecord::new(
                config::DEFAULT_ORG,
                &newer_holder,
                UserRole::Root,
                "token",
                None,
            ),
        );
        with_incidents_v2(true, async {
            let mut body = serde_json::json!({"assign_self": true, "take_over": true});
            if repeated {
                assert_eq!(
                    fixture.own(&fixture.root, body.clone()).await.status(),
                    StatusCode::OK
                );
                body["expected_holder"] = fixture.root.clone().into();
                body["expected_lead"] = fixture.root.clone().into();
            }
            let barriers = infra::race::Barriers::new();
            barriers.arm("incident_ack.after_commit", 2);
            barriers.arm("incident_ack.before_effects", 2);
            let older = barriers.run(fixture.own(&fixture.root, body));
            let newer = async {
                barriers.wait("incident_ack.after_commit").await;
                assert_eq!(
                    fixture.model().await.acknowledged_by.as_deref(),
                    Some(fixture.root.as_str())
                );
                let response = fixture
                    .own(
                        &newer_holder,
                        serde_json::json!({
                            "assign_self": true, "take_over": true,
                            "expected_holder": fixture.root, "expected_lead": fixture.root,
                        }),
                    )
                    .await;
                assert_eq!(response.status(), StatusCode::OK);
                let actual = json_body(response).await;
                assert_eq!(actual["acked"], newer_holder);
                assert_eq!(actual["assigned_to"], newer_holder);
                let committed = fixture.model().await;
                barriers.wait("incident_ack.before_effects").await;
                committed
            };
            let (older, committed) = tokio::join!(older, newer);
            barriers.assert_all_met();
            assert_eq!(older.status(), StatusCode::OK);
            let actual = json_body(older).await;
            assert_eq!(actual["acked"], newer_holder);
            assert_eq!(actual["assigned_to"], newer_holder);
            assert_eq!(fixture.model().await, committed);
            let firing = infra::table::alert_acks::get(&fixture.org, &fixture.alert, "")
                .await
                .unwrap()
                .unwrap();
            assert_eq!(firing.acked_by, newer_holder);
            let page = infra::table::oncall_responses::get(&fixture.org, &fixture.page)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(page.acked_by.as_deref(), Some(newer_holder.as_str()));
        })
        .await;
    }
}

#[tokio::test]
async fn m52_refuses_ai_updates_unconditionally_but_allows_titles_and_people() {
    let Some(fixture) = Fixture::new().await else {
        return;
    };
    for enabled in [false, true] {
        with_incidents_v2(enabled, async {
            for identity in [Identity::Assistant, Identity::Mcp, Identity::Agent] {
                for payload in [
                    serde_json::json!({"status":"acknowledged"}),
                    serde_json::json!({"status":"open"}),
                    serde_json::json!({"status":"resolved"}),
                    serde_json::json!({"severity":"P2"}),
                    serde_json::json!({"assigned_to": fixture.root}),
                ] {
                    let (user, delegated, headers) = fixture.request(identity);
                    let response = incidents::update_incident(
                        Path((fixture.org.clone(), fixture.incident.clone())),
                        user,
                        delegated,
                        headers,
                        Json(serde_json::from_value(payload).unwrap()),
                    )
                    .await;
                    assert_eq!(
                        response.status(),
                        StatusCode::FORBIDDEN,
                        "{enabled} {identity:?}"
                    );
                }
                let (user, delegated, headers) = fixture.request(identity);
                let response = incidents::update_incident(
                    Path((fixture.org.clone(), fixture.incident.clone())),
                    user,
                    delegated,
                    headers,
                    Json(incidents::UpdatePayload::Title {
                        title: "Checkout delayed".to_string(),
                    }),
                )
                .await;
                assert_eq!(response.status(), StatusCode::OK);
                assert_eq!(
                    fixture.call(Route::Resolve, identity).await.status(),
                    StatusCode::FORBIDDEN
                );
            }
            let (user, delegated, headers) = fixture.request(Identity::Human);
            let response = incidents::update_incident(
                Path((fixture.org.clone(), fixture.incident.clone())),
                user,
                delegated,
                headers,
                Json(incidents::UpdatePayload::Severity {
                    severity: incidents::IncidentSeverity::P2,
                }),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            for payload in [
                serde_json::json!({"assigned_to": ""}),
                serde_json::json!({"status": "acknowledged"}),
                serde_json::json!({"status": "open"}),
            ] {
                let (user, delegated, headers) = fixture.request(Identity::Human);
                let response = incidents::update_incident(
                    Path((fixture.org.clone(), fixture.incident.clone())),
                    user,
                    delegated,
                    headers,
                    Json(serde_json::from_value(payload).unwrap()),
                )
                .await;
                assert_eq!(response.status(), StatusCode::OK);
            }
        })
        .await;
    }
}
