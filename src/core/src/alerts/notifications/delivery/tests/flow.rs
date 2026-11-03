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

//! The shared send path end to end: the ledger in the test store and a loopback destination.

use std::sync::{Arc, Mutex};

use config::meta::{
    alerts::notification_kind::NotificationKind,
    destinations::{Destination, DestinationType, Endpoint},
};
use infra::table::notification_deliveries::{self as ledger, Claim, LEASE_US, ListFilter};

use super::super::*;
use crate::{
    alerts::notifications::{
        examples::example_context,
        notify::{Resolved, send},
        org_default::{EffectiveTemplate, compiled_fallback_for},
        platform::{Platform, ResolveAnswer, resolve_for_ledger},
    },
    ssrf_test_support::isolated,
};

const LOOPBACK: (&str, &str) = ("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32");

/// One request the mock saw: path, content type, body.
type Seen = Arc<Mutex<Vec<(String, String, Vec<u8>)>>>;

/// One message the SMTP mock accepted: its recipients and its data.
type Mails = Arc<Mutex<Vec<(Vec<String>, String)>>>;

/// `/ok` is 200, `/fail` 503, `/slow` 200 late, an Opsgenie close 404, ServiceNow empty.
async fn mock() -> (String, Seen) {
    let seen: Seen = Arc::default();
    let log = seen.clone();
    let app = axum::Router::new().fallback(
        move |uri: axum::http::Uri, headers: axum::http::HeaderMap, body: axum::body::Bytes| {
            let log = log.clone();
            async move {
                let content_type = headers
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default()
                    .to_string();
                log.lock()
                    .unwrap()
                    .push((uri.path().to_string(), content_type, body.to_vec()));
                let path = uri.path();
                if path == "/slow" {
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                }
                match path {
                    "/fail" => (axum::http::StatusCode::SERVICE_UNAVAILABLE, String::new()),
                    p if p.ends_with("/close") => {
                        (axum::http::StatusCode::NOT_FOUND, "no alert".to_string())
                    }
                    "/snow" => (axum::http::StatusCode::OK, r#"{"result":[]}"#.to_string()),
                    _ => (axum::http::StatusCode::OK, "ok".to_string()),
                }
            }
        },
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, seen)
}

/// `isolated` with a loopback allowlist and its own data directory, so stores never lock each
/// other.
fn run<F: std::future::Future<Output = ()>>(
    path: &str,
    extra: &[(&str, &str)],
    task: impl FnOnce() -> F,
) {
    let name = path.rsplit("::").next().unwrap_or(path);
    let dir = std::env::temp_dir().join(format!("o2-notify-flow-{name}-{}", std::process::id()));
    let dir = format!("{}/", dir.display());
    let mut envs = vec![LOOPBACK, ("ZO_DATA_DIR", dir.as_str())];
    envs.extend_from_slice(extra);
    isolated(path, &envs, task);
}

fn calls(seen: &Seen, path: &str) -> Vec<(String, Vec<u8>)> {
    seen.lock()
        .unwrap()
        .iter()
        .filter(|(p, ..)| p == path)
        .map(|(_, ct, body)| (ct.clone(), body.clone()))
        .collect()
}

async fn store() {
    std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
    ledger::create_tables_for_test(infra::db::get_orm_client_rw().await)
        .await
        .unwrap();
}

fn http(url: String, destination_type: &str) -> DestinationType {
    DestinationType::Http(Endpoint {
        url,
        destination_type: Some(destination_type.to_string()),
        ..Default::default()
    })
}

fn resolved(name: &str, destination_type: DestinationType) -> Resolved {
    Resolved {
        destination: Destination {
            name: name.to_string(),
            ..Default::default()
        },
        channel: derive_channel_format(&destination_type),
        destination_type,
        effective: EffectiveTemplate {
            template: compiled_fallback_for("acme", NotificationKind::Anomaly),
            source: crate::alerts::notifications::org_default::TemplateSource::Compiled,
            skipped: vec![],
        },
    }
}

/// An anomaly firing under a fresh object, so tests sharing the store never meet.
fn firing() -> (String, NotificationContext) {
    let object = svix_ksuid::Ksuid::new(None, None).to_string();
    let mut ctx = example_context(NotificationKind::Anomaly, false);
    ctx.object_id = object.clone();
    ctx.episode_id = Some(format!("{object}:1"));
    ctx.event = "firing:1".into();
    (object, ctx)
}

async fn rows(
    org: &str,
    object: &str,
) -> Vec<infra::table::entity::notification_deliveries::Model> {
    let filter = ListFilter {
        org: org.to_string(),
        kind: "anomaly".into(),
        object_id: Some(object.to_string()),
        size: 50,
        ..Default::default()
    };
    ledger::list(infra::db::get_orm_client_rw().await, &filter)
        .await
        .unwrap()
        .1
}

#[test]
fn a_crash_after_the_answer_sends_again_after_the_lease_with_one_key() {
    run(
        concat!(
            module_path!(),
            "::a_crash_after_the_answer_sends_again_after_the_lease_with_one_key"
        ),
        &[],
        || async {
            store().await;
            let (base, seen) = mock().await;
            let r = resolved("pd", http(format!("{base}/ok"), "pagerduty"));
            let (_, mut ctx) = firing();
            super::super::super::notify::apply_destination_metadata(&r.destination_type, &mut ctx);
            let prepared = prepare(&r, None, &ctx).unwrap();
            let mut new = new_delivery("acme", &r, &ctx, None);
            new.payload = prepared.record.to_stored().0;
            let t0 = now_micros();
            let db = infra::db::get_orm_client_rw().await;
            let Claim::Owned(row) = ledger::claim(db, &new, "w1", t0).await.unwrap() else {
                panic!("first claim owns the row");
            };
            // The transport accepts, then the node dies before the finish.
            transport("acme", &r.destination_type, &prepared.record)
                .await
                .unwrap();
            ledger::expire_leases(db, t0 + LEASE_US + 1).await.unwrap();
            let again = replay_at(&row.id, Some(&r.destination_type), t0 + LEASE_US + 2)
                .await
                .unwrap();
            assert_eq!(again.attempt, 2);
            let sent = calls(&seen, "/ok");
            assert_eq!(sent.len(), 2, "the duplicate is the bounded crash case");
            let keys: Vec<String> = sent
                .iter()
                .map(|(_, b)| {
                    serde_json::from_slice::<serde_json::Value>(b).unwrap()["dedup_key"]
                        .as_str()
                        .unwrap()
                        .to_string()
                })
                .collect();
            assert_eq!(keys[0], keys[1], "both triggers carry one key");
        },
    );
}

#[test]
fn two_workers_claiming_one_send_reach_the_destination_once() {
    run(
        concat!(
            module_path!(),
            "::two_workers_claiming_one_send_reach_the_destination_once"
        ),
        &[],
        || async {
            store().await;
            let (base, seen) = mock().await;
            let r = resolved("slack", http(format!("{base}/slow"), "slack"));
            let (_, ctx) = firing();
            let (mut a, mut b) = (ctx.clone(), ctx);
            let (first, second) = tokio::join!(
                send("acme", &r, None, &mut a),
                send("acme", &r, None, &mut b)
            );
            let outcomes = [first, second];
            assert_eq!(outcomes.iter().filter(|o| o.is_ok()).count(), 1);
            assert!(outcomes.iter().any(|o| matches!(
                o,
                Err(NotifyError::Skipped(
                    SkipReason::InFlight | SkipReason::AlreadyDelivered
                ))
            )));
            assert_eq!(calls(&seen, "/slow").len(), 1);
        },
    );
}

#[test]
fn a_batch_retried_after_one_failure_resends_only_the_failed_destination() {
    run(
        concat!(
            module_path!(),
            "::a_batch_retried_after_one_failure_resends_only_the_failed_destination"
        ),
        &[],
        || async {
            store().await;
            let (base, seen) = mock().await;
            let one = resolved("one", http(format!("{base}/ok"), "slack"));
            let two = resolved("two", http(format!("{base}/fail"), "slack"));
            let (object, ctx) = firing();
            let mut c = ctx.clone();
            assert!(send("acme", &one, None, &mut c).await.is_ok());
            assert!(matches!(
                send("acme", &two, None, &mut c).await,
                Err(NotifyError::Rejected { status: 503, .. })
            ));
            // The producer retries the whole batch at once.
            assert!(matches!(
                send("acme", &one, None, &mut c).await,
                Err(NotifyError::Skipped(SkipReason::AlreadyDelivered))
            ));
            assert!(matches!(
                send("acme", &two, None, &mut c).await,
                Err(NotifyError::Skipped(SkipReason::RetryScheduled))
            ));
            assert_eq!(calls(&seen, "/ok").len(), 1);
            assert_eq!(calls(&seen, "/fail").len(), 1);
            // At its retry time the sweeper sends destination two again, now healthy.
            let failed = rows("acme", &object)
                .await
                .into_iter()
                .find(|r| r.destination == "two")
                .unwrap();
            let healthy = http(format!("{base}/ok"), "slack");
            let retried = replay_at(&failed.id, Some(&healthy), now_micros() + 61_000_000)
                .await
                .unwrap();
            assert_eq!(retried.attempt, 2);
            assert_eq!(calls(&seen, "/ok").len(), 2);
        },
    );
}

#[test]
fn a_resolve_that_finds_nothing_open_finishes_sent() {
    run(
        concat!(
            module_path!(),
            "::a_resolve_that_finds_nothing_open_finishes_sent"
        ),
        &[],
        || async {
            let (base, _) = mock().await;
            let opsgenie = Endpoint {
                url: format!("{base}/og"),
                ..Default::default()
            };
            let answer = resolve_for_ledger(Platform::Opsgenie, &opsgenie, "k1", None)
                .await
                .unwrap();
            assert!(matches!(answer, ResolveAnswer::NothingToClose(_)));
            let servicenow = Endpoint {
                url: format!("{base}/snow"),
                ..Default::default()
            };
            let answer = resolve_for_ledger(Platform::ServiceNow, &servicenow, "k1", None)
                .await
                .unwrap();
            let ResolveAnswer::NothingToClose(text) = answer else {
                panic!("an empty lookup is nothing to close");
            };
            assert!(finish_of(&Ok(text), false, true).sent);
        },
    );
}

#[test]
fn a_replay_resends_the_attachment_and_an_oversized_image_is_dropped() {
    run(
        concat!(
            module_path!(),
            "::a_replay_resends_the_attachment_and_an_oversized_image_is_dropped"
        ),
        &[],
        || async {
            store().await;
            let (base, seen) = mock().await;
            for (size, keeps_image) in [(16usize, true), (300 * 1024, false)] {
                let r = resolved("discord", http(format!("{base}/fail"), "discord"));
                let (object, mut ctx) = firing();
                let png: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
                ctx.chart_png = Some(Arc::new(png.clone()));
                let before = calls(&seen, "/ok").len();
                assert!(send("acme", &r, None, &mut ctx).await.is_err());
                let first = calls(&seen, "/fail").pop().unwrap();
                assert!(
                    first.0.starts_with("multipart/form-data"),
                    "the first send carries the image"
                );
                let row = rows("acme", &object).await.pop().unwrap();
                assert_eq!(
                    row.error
                        .as_deref()
                        .unwrap_or_default()
                        .ends_with(IMAGE_DROPPED),
                    !keeps_image
                );
                // A new process replays the stored record to the destination as it is now.
                let healthy = http(format!("{base}/ok"), "discord");
                replay_at(&row.id, Some(&healthy), now_micros() + 61_000_000)
                    .await
                    .unwrap();
                let replayed = calls(&seen, "/ok");
                assert_eq!(replayed.len(), before + 1);
                let (content_type, body) = replayed.last().unwrap();
                if keeps_image {
                    assert!(content_type.starts_with("multipart/form-data"));
                    assert!(
                        body.windows(png.len()).any(|w| w == png.as_slice()),
                        "the image bytes resend as they were"
                    );
                } else {
                    assert_eq!(content_type, "application/json");
                }
            }
        },
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn an_unmuted_incident_opens_again_as_its_own_row() {
    run(
        concat!(
            module_path!(),
            "::an_unmuted_incident_opens_again_as_its_own_row"
        ),
        &[],
        || async {
            store().await;
            let (base, _) = mock().await;
            let incident = svix_ksuid::Ksuid::new(None, None).to_string();
            let mut ctx = example_context(NotificationKind::Incident, false);
            ctx.object_id = incident.clone();
            ctx.episode_id = Some(format!("{incident}:7"));
            ctx.event = "opened".into();
            let r = resolved("slack", http(format!("{base}/ok"), "slack"));
            send("acme", &r, None, &mut ctx).await.unwrap();
            let event = crate::alerts::incidents::repeat_opened_event(
                "acme",
                &incident,
                7,
                "opened".into(),
                99,
            )
            .await;
            assert_eq!(
                event, "opened:99",
                "the un-mute page is a new row, not AlreadyDelivered"
            );
            ctx.event = event;
            send("acme", &r, None, &mut ctx).await.unwrap();
        },
    );
}

/// Stores a destination in the cache `destinations::get` reads first.
fn register(name: &str, destination_type: DestinationType) {
    crate::common::infra::config::DESTINATIONS.insert(
        format!("acme/{name}"),
        Destination {
            id: None,
            org_id: "acme".into(),
            name: name.to_string(),
            module: config::meta::destinations::Module::Alert {
                template: None,
                destination_type,
            },
        },
    );
}

#[cfg(feature = "enterprise")]
async fn incident_tables() {
    use infra::table::entity::{alert_incident_alerts, alert_incidents, incident_events};
    use sea_orm::{ConnectionTrait, Schema};
    let db = infra::db::get_orm_client_rw().await;
    let backend = db.get_database_backend();
    for mut table in [
        Schema::new(backend).create_table_from_entity(alert_incidents::Entity),
        Schema::new(backend).create_table_from_entity(alert_incident_alerts::Entity),
        Schema::new(backend).create_table_from_entity(incident_events::Entity),
    ] {
        db.execute(backend.build(table.if_not_exists()))
            .await
            .unwrap();
    }
}

/// An open incident whose last alert is `age_us` old, with a sent "opened" trigger to `dest`.
#[cfg(feature = "enterprise")]
async fn paged_incident(dest: &str, base: &str, age_us: i64) -> (String, String) {
    let incident = infra::table::alert_incidents::create(
        "acme",
        "P2",
        serde_json::json!({}),
        "service",
        now_micros() - age_us,
        Some("High error rate".into()),
    )
    .await
    .unwrap();
    let episode = format!("{}:{}", incident.id, incident.episode_opened_at);
    let mut ctx = example_context(NotificationKind::Incident, false);
    ctx.object_id = incident.id.clone();
    ctx.episode_id = Some(episode.clone());
    ctx.event = "opened".into();
    let destination_type = http(format!("{base}/ok"), "pagerduty");
    register(dest, destination_type.clone());
    send("acme", &resolved(dest, destination_type), None, &mut ctx)
        .await
        .unwrap();
    (incident.id, episode)
}

/// One resolve row went to `dest` and the platform got one resolve with the episode key.
#[cfg(feature = "enterprise")]
async fn assert_resolved_once(incident: &str, episode: &str, dest: &str, seen: &Seen) {
    let db = infra::db::get_orm_client_rw().await;
    let key = ledger::EpisodeKey {
        org: "acme".into(),
        kind: "incident".into(),
        episode_id: episode.to_string(),
    };
    let closed = ledger::get_episode(db, &key).await.unwrap().unwrap();
    assert_eq!(closed.closed_by.as_deref(), Some(ledger::CLOSED_BY_RESOLVE));
    let filter = ListFilter {
        org: "acme".into(),
        kind: "incident".into(),
        object_id: Some(incident.to_string()),
        event: Some("resolved".into()),
        size: 50,
        ..Default::default()
    };
    // Whatever the producer could not finish is the sweeper's, exactly as in production.
    let mut rows = ledger::list(db, &filter).await.unwrap().1;
    for _ in 0..10 {
        if rows
            .iter()
            .filter(|r| r.destination == dest)
            .all(|r| r.status == ledger::STATUS_SENT)
        {
            break;
        }
        let _ = retry_tick().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        rows = ledger::list(db, &filter).await.unwrap().1;
    }
    let mine: Vec<_> = rows.iter().filter(|r| r.destination == dest).collect();
    assert_eq!(mine.len(), 1, "one resolve row per destination");
    assert_eq!(mine[0].status, ledger::STATUS_SENT);
    let resolves: Vec<serde_json::Value> = calls(seen, "/ok")
        .iter()
        .filter_map(|(_, b)| serde_json::from_slice::<serde_json::Value>(b).ok())
        .filter(|v| v["event_action"] == "resolve")
        .collect();
    assert_eq!(resolves.len(), 1);
    assert_eq!(resolves[0]["dedup_key"], episode);
    let status = infra::table::alert_incidents::get("acme", incident)
        .await
        .unwrap()
        .unwrap()
        .status;
    assert_eq!(status, "resolved");
}

/// The incident's resolved timeline events.
#[cfg(feature = "enterprise")]
async fn resolved_events(incident: &str) -> usize {
    infra::table::incident_events::get("acme", incident)
        .await
        .unwrap()
        .into_iter()
        .filter(|e| {
            matches!(
                e.event_type,
                config::meta::alerts::incidents::IncidentEventType::Resolved { .. }
            )
        })
        .count()
}

#[cfg(feature = "enterprise")]
async fn resolved_at(incident: &str) -> Option<i64> {
    infra::table::alert_incidents::get("acme", incident)
        .await
        .unwrap()
        .unwrap()
        .resolved_at
}

#[cfg(feature = "enterprise")]
#[test]
fn the_timeout_sweep_resolves_through_the_fan_out() {
    run(
        concat!(
            module_path!(),
            "::the_timeout_sweep_resolves_through_the_fan_out"
        ),
        &[],
        || async {
            store().await;
            incident_tables().await;
            let (base, seen) = mock().await;
            let hour = 3600 * 1_000_000;
            let (incident, episode) = paged_incident("pd-sweep", &base, 2 * hour).await;
            // The child's store holds only this test's incidents, so the whole sweep runs.
            assert_eq!(
                crate::alerts::incidents::auto_resolve_stale(hour)
                    .await
                    .unwrap(),
                1
            );
            assert_resolved_once(&incident, &episode, "pd-sweep", &seen).await;
            let first = resolved_at(&incident).await;
            assert!(first.is_some());
            assert_eq!(
                crate::alerts::incidents::auto_resolve_stale(hour)
                    .await
                    .unwrap(),
                0,
                "a resolved incident is not stale again"
            );
            assert_eq!(
                resolved_at(&incident).await,
                first,
                "resolved_at is written once"
            );
            assert_eq!(resolved_events(&incident).await, 1);
        },
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn an_on_call_page_close_resolves_through_the_fan_out() {
    run(
        concat!(
            module_path!(),
            "::an_on_call_page_close_resolves_through_the_fan_out"
        ),
        &[],
        || async {
            store().await;
            incident_tables().await;
            let (base, seen) = mock().await;
            let (incident, episode) = paged_incident("pd-oncall", &base, 0).await;
            // The same registration as the jobs init, then the entry the page close calls.
            o2_enterprise::enterprise::oncall::escalation::register_incident_resolver(
                |org_id, incident_id| {
                    Box::pin(async move {
                        crate::alerts::incidents::resolve_from_oncall(&org_id, &incident_id).await
                    })
                },
            );
            o2_enterprise::enterprise::oncall::escalation::resolve_incident("acme", &incident)
                .await
                .unwrap();
            assert_resolved_once(&incident, &episode, "pd-oncall", &seen).await;
            assert_eq!(resolved_events(&incident).await, 1);
        },
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn three_resolves_in_one_second_write_one_resolve() {
    run(
        concat!(
            module_path!(),
            "::three_resolves_in_one_second_write_one_resolve"
        ),
        &[],
        || async {
            store().await;
            incident_tables().await;
            let (base, seen) = mock().await;
            let jira = DestinationType::Http(Endpoint {
                url: format!("{base}/jira"),
                destination_type: Some("jira".into()),
                metadata: [
                    ("jira_deployment", "cloud"),
                    ("jira_project_key", "OPS"),
                    ("jira_issue_type_id", "10004"),
                ]
                .into_iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
                ..Default::default()
            });
            register("jira-race", jira);
            let (incident, episode) = paged_incident("pd-race", &base, 0).await;
            let alert_id = svix_ksuid::Ksuid::new(None, None);
            let mut alert = config::meta::alerts::alert::Alert::default();
            alert.id = Some(alert_id);
            alert.org_id = "acme".into();
            alert.name = "High error rate".into();
            alert.destinations = vec!["pd-race".into(), "jira-race".into()];
            crate::common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key("acme", &alert_id.to_string()),
                (Default::default(), alert),
            );
            infra::table::alert_incidents::add_alert_to_incident(
                &incident,
                &alert_id.to_string(),
                "High error rate",
                "scheduled",
                now_micros(),
                "test",
            )
            .await
            .unwrap();
            let jira_calls = || {
                seen.lock()
                    .unwrap()
                    .iter()
                    .filter(|(p, ..)| p.starts_with("/jira"))
                    .count()
            };
            let jira_before = jira_calls();
            // Manual, timeout and alert recovery in the same second.
            let (manual, sweep, recovery) = tokio::join!(
                crate::alerts::incidents::resolve_incident_as("acme", &incident, Some("u1"), false),
                crate::alerts::incidents::record_auto_resolved("acme", &incident, None),
                crate::alerts::incidents::resolve_incident_as("acme", &incident, Some("u2"), false),
            );
            let winners = [
                manual.unwrap().is_some(),
                sweep.unwrap(),
                recovery.unwrap().is_some(),
            ]
            .into_iter()
            .filter(|won| *won)
            .count();
            assert_eq!(winners, 1, "one resolve wins; the others write nothing");
            assert_resolved_once(&incident, &episode, "pd-race", &seen).await;
            assert_eq!(resolved_events(&incident).await, 1);
            let after = jira_calls() - jira_before;
            assert!(after > 0, "the Jira resolve goes out");
            // Every Jira send searches once first, so one search means one outside send.
            let searches = seen
                .lock()
                .unwrap()
                .iter()
                .filter(|(p, ..)| p.ends_with("/search/jql"))
                .count();
            assert_eq!(searches, 1, "one outside send");
        },
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn a_manual_reopen_writes_an_opened_row_under_the_new_key() {
    run(
        concat!(
            module_path!(),
            "::a_manual_reopen_writes_an_opened_row_under_the_new_key"
        ),
        &[],
        || async {
            store().await;
            incident_tables().await;
            let (base, seen) = mock().await;
            register("slack-reopen", http(format!("{base}/ok"), "slack"));
            let alert_id = svix_ksuid::Ksuid::new(None, None);
            let mut alert = config::meta::alerts::alert::Alert::default();
            alert.id = Some(alert_id);
            alert.org_id = "acme".into();
            alert.name = "High error rate".into();
            alert.destinations = vec!["slack-reopen".into()];
            crate::common::infra::config::ALERTS.write().await.insert(
                db::alerts::alert::cache_alert_key("acme", &alert_id.to_string()),
                (Default::default(), alert),
            );
            let incident = infra::table::alert_incidents::create(
                "acme",
                "P2",
                serde_json::json!({}),
                "service",
                now_micros(),
                Some("High error rate".into()),
            )
            .await
            .unwrap();
            infra::table::alert_incidents::add_alert_to_incident(
                &incident.id,
                &alert_id.to_string(),
                "High error rate",
                "scheduled",
                now_micros(),
                "test",
            )
            .await
            .unwrap();
            infra::table::alert_incidents::update_status("acme", &incident.id, "resolved")
                .await
                .unwrap();
            let reopened =
                infra::table::alert_incidents::update_status("acme", &incident.id, "open")
                    .await
                    .unwrap();
            assert_ne!(reopened.episode_opened_at, incident.episode_opened_at);
            // What `update_status_as` sends when the status leaves resolved.
            crate::alerts::incidents::send_incident_reopened_notification("acme", &incident.id)
                .await;
            let filter = ListFilter {
                org: "acme".into(),
                kind: "incident".into(),
                episode_id: Some(format!("{}:{}", incident.id, reopened.episode_opened_at)),
                event: Some("opened".into()),
                size: 50,
                ..Default::default()
            };
            let (total, rows) = ledger::list(infra::db::get_orm_client_rw().await, &filter)
                .await
                .unwrap();
            assert_eq!(
                total, 1,
                "the reopen writes an opened row under the new key"
            );
            assert_eq!(rows[0].destination, "slack-reopen");
            assert_eq!(rows[0].status, ledger::STATUS_SENT);
            assert_eq!(calls(&seen, "/ok").len(), 1);
        },
    );
}

/// A minimal SMTP server on `port` that refuses the first message and records each delivery.
async fn smtp_mock(port: u16) -> Mails {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let delivered: Mails = Arc::default();
    let log = delivered.clone();
    let refused_once = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    tokio::spawn(async move {
        while let Ok((sock, _)) = listener.accept().await {
            let log = log.clone();
            let refused_once = refused_once.clone();
            tokio::spawn(async move {
                let (read, mut write) = sock.into_split();
                let mut lines = BufReader::new(read).lines();
                let _ = write.write_all(b"220 mock\r\n").await;
                let mut rcpt = Vec::new();
                while let Ok(Some(line)) = lines.next_line().await {
                    let upper = line.to_uppercase();
                    let reply: &[u8] = if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                        b"250-mock\r\n250 OK\r\n"
                    } else if upper.starts_with("RCPT TO:") {
                        rcpt.push(line[8..].trim().trim_matches(['<', '>']).to_string());
                        b"250 OK\r\n"
                    } else if upper == "DATA" {
                        let _ = write.write_all(b"354 go\r\n").await;
                        let mut data = String::new();
                        while let Ok(Some(l)) = lines.next_line().await {
                            if l == "." {
                                break;
                            }
                            data.push_str(&l);
                            data.push('\n');
                        }
                        if refused_once.swap(true, std::sync::atomic::Ordering::SeqCst) {
                            log.lock().unwrap().push((std::mem::take(&mut rcpt), data));
                            b"250 queued\r\n"
                        } else {
                            rcpt.clear();
                            b"451 try later\r\n"
                        }
                    } else if upper == "QUIT" {
                        let _ = write.write_all(b"221 bye\r\n").await;
                        break;
                    } else {
                        b"250 OK\r\n"
                    };
                    let _ = write.write_all(reply).await;
                }
            });
        }
    });
    delivered
}

fn member(email: &str) {
    crate::common::infra::config::ORG_USERS.insert(
        format!("acme/{email}"),
        infra::table::org_users::OrgUserRecord {
            role: config::meta::user::UserRole::Admin,
            token: String::new(),
            rum_token: None,
            org_id: "acme".to_string(),
            email: email.to_string(),
            created_at: 0,
            allow_static_token: false,
        },
    );
}

#[test]
fn an_email_with_an_inline_chart_replays_and_filters_recipients_again() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
        .to_string();
    run(
        concat!(
            module_path!(),
            "::an_email_with_an_inline_chart_replays_and_filters_recipients_again"
        ),
        &[
            ("ZO_SMTP_ENABLED", "true"),
            ("ZO_SMTP_HOST", "127.0.0.1"),
            ("ZO_SMTP_PORT", &port),
            ("ZO_SMTP_FROM_EMAIL", "o2@acme.com"),
        ],
        || async {
            use infra::table::entity::org_users;
            use sea_orm::{ConnectionTrait, Schema};
            store().await;
            let db = infra::db::get_orm_client_rw().await;
            let backend = db.get_database_backend();
            let mut table = Schema::new(backend).create_table_from_entity(org_users::Entity);
            db.execute(backend.build(table.if_not_exists()))
                .await
                .unwrap();
            let port: u16 = std::env::var("ZO_SMTP_PORT").unwrap().parse().unwrap();
            let delivered = smtp_mock(port).await;
            member("member@acme.com");
            let email = DestinationType::Email(config::meta::destinations::Email {
                recipients: vec!["member@acme.com".into(), "stranger@acme.com".into()],
            });
            let r = resolved("mail", email.clone());
            let (object, mut ctx) = firing();
            let png = vec![137u8, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];
            ctx.chart_png = Some(Arc::new(png.clone()));
            assert!(
                send("acme", &r, None, &mut ctx).await.is_err(),
                "the server refuses once"
            );
            // The stranger joins the org before the retry: the filter runs again on replay.
            member("stranger@acme.com");
            let row = rows("acme", &object).await.pop().unwrap();
            replay_at(&row.id, Some(&email), now_micros() + 61_000_000)
                .await
                .unwrap();
            let delivered = delivered.lock().unwrap().clone();
            assert_eq!(delivered.len(), 1);
            let (rcpt, data) = &delivered[0];
            assert_eq!(rcpt, &["member@acme.com", "stranger@acme.com"]);
            assert!(data.contains("Content-ID: <alert-chart>"));
            use base64::Engine as _;
            let encoded = base64::engine::general_purpose::STANDARD.encode(&png);
            assert!(
                data.replace('\n', "").contains(&encoded),
                "the inline PNG replays"
            );
        },
    );
}

#[cfg(feature = "enterprise")]
async fn kind_rows(
    kind: &str,
    object: &str,
) -> Vec<infra::table::entity::notification_deliveries::Model> {
    let filter = ListFilter {
        org: "acme".to_string(),
        kind: kind.into(),
        object_id: Some(object.to_string()),
        size: 50,
        ..Default::default()
    };
    ledger::list(infra::db::get_orm_client_rw().await, &filter)
        .await
        .unwrap()
        .1
}

#[cfg(feature = "enterprise")]
fn synthetics_close(
    check: &str,
    since: i64,
    send_resolves: bool,
    won: bool,
) -> openobserve_synthetics::alerting::EpisodeClose {
    openobserve_synthetics::alerting::EpisodeClose {
        org_id: "acme".into(),
        check_id: check.to_string(),
        check_name: "checkout".into(),
        check_type: "http".into(),
        target: "https://shop.acme.com".into(),
        episode_id: format!("{check}:{since}"),
        run_id: "r2".into(),
        destinations: vec!["pd-syn".into(), "slack-syn".into()],
        template: None,
        send_resolves,
        swap: Box::new(move |_| Box::pin(async move { Ok(won) })),
    }
}

#[cfg(feature = "enterprise")]
#[test]
fn a_synthetics_recovery_resolves_the_firing_record_and_a_muted_one_writes_no_row() {
    run(
        concat!(
            module_path!(),
            "::a_synthetics_recovery_resolves_the_firing_record_and_a_muted_one_writes_no_row"
        ),
        &[],
        || async {
            store().await;
            let (base, seen) = mock().await;
            register("pd-syn", http(format!("{base}/pd"), "pagerduty"));
            register("slack-syn", http(format!("{base}/ok"), "slack"));
            let check = svix_ksuid::Ksuid::new(None, None).to_string();
            crate::synthetics::notify_check_result(crate::synthetics::CheckNotification {
                org_id: "acme".into(),
                check_name: "checkout".into(),
                check_id: check.clone(),
                check_type: "http".into(),
                target: "https://shop.acme.com".into(),
                destinations: vec!["pd-syn".into(), "slack-syn".into()],
                run_id: "r1".into(),
                status: "failed".into(),
                job_count: 1,
                error: Some("timeout".into()),
                checked_at: 1,
                recovery: false,
                consecutive_failures: 1,
                flaky: false,
                status_reason: None,
                error_source: String::new(),
                degraded: false,
                failing_locations: vec!["us-east-1".into()],
                passing_locations: vec![],
                failing_environments: vec![],
                template: None,
                alerting_since: 100,
            })
            .await;
            let triggers = calls(&seen, "/pd");
            assert_eq!(triggers.len(), 1, "the firing reached PagerDuty once");

            // A lost swap closes nothing and writes no row.
            assert!(
                !crate::synthetics::close_alert_episode(synthetics_close(&check, 100, true, false))
                    .await
                    .unwrap()
            );
            assert!(
                kind_rows("synthetics", &check)
                    .await
                    .iter()
                    .all(|r| r.event != "resolved")
            );

            assert!(
                crate::synthetics::close_alert_episode(synthetics_close(&check, 100, true, true))
                    .await
                    .unwrap()
            );
            let pd = calls(&seen, "/pd");
            assert_eq!(pd.len(), 2, "one trigger, then one resolve");
            let resolve = String::from_utf8_lossy(&pd[1].1).to_string();
            let trigger = String::from_utf8_lossy(&pd[0].1).to_string();
            assert!(resolve.contains("resolve"), "{resolve}");
            assert!(
                trigger.contains(&format!("{check}:100"))
                    && resolve.contains(&format!("{check}:100"))
            );
            let resolved: Vec<_> = kind_rows("synthetics", &check)
                .await
                .into_iter()
                .filter(|r| r.event == "resolved")
                .collect();
            assert_eq!(resolved.len(), 2);
            assert!(resolved.iter().all(|r| r.status == "sent"), "{resolved:?}");

            // A muted recovery closes its episode without a resolve row.
            assert!(
                crate::synthetics::close_alert_episode(synthetics_close(&check, 200, false, true))
                    .await
                    .unwrap()
            );
            assert!(
                kind_rows("synthetics", &check)
                    .await
                    .iter()
                    .all(|r| r.episode_id != format!("{check}:200"))
            );
            assert_eq!(
                calls(&seen, "/pd").len(),
                2,
                "nothing more reached PagerDuty"
            );
        },
    );
}
