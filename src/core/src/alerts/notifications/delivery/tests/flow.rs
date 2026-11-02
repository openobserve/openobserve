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

fn calls(seen: &Seen, path: &str) -> Vec<(String, Vec<u8>)> {
    seen.lock()
        .unwrap()
        .iter()
        .filter(|(p, ..)| p == path)
        .map(|(_, ct, body)| (ct.clone(), body.clone()))
        .collect()
}

async fn store() {
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
    isolated(
        concat!(
            module_path!(),
            "::a_crash_after_the_answer_sends_again_after_the_lease_with_one_key"
        ),
        &[LOOPBACK],
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
    isolated(
        concat!(
            module_path!(),
            "::two_workers_claiming_one_send_reach_the_destination_once"
        ),
        &[LOOPBACK],
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
    isolated(
        concat!(
            module_path!(),
            "::a_batch_retried_after_one_failure_resends_only_the_failed_destination"
        ),
        &[LOOPBACK],
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
    isolated(
        concat!(
            module_path!(),
            "::a_resolve_that_finds_nothing_open_finishes_sent"
        ),
        &[LOOPBACK],
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
    isolated(
        concat!(
            module_path!(),
            "::a_replay_resends_the_attachment_and_an_oversized_image_is_dropped"
        ),
        &[LOOPBACK],
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
    isolated(
        concat!(
            module_path!(),
            "::an_unmuted_incident_opens_again_as_its_own_row"
        ),
        &[LOOPBACK],
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

#[cfg(feature = "enterprise")]
#[test]
fn a_timeout_resolve_closes_the_episode_and_writes_the_resolve_rows() {
    isolated(
        concat!(
            module_path!(),
            "::a_timeout_resolve_closes_the_episode_and_writes_the_resolve_rows"
        ),
        &[LOOPBACK],
        || async {
            use infra::table::entity::{alert_incident_alerts, alert_incidents};
            use sea_orm::{ConnectionTrait, Schema};
            store().await;
            let db = infra::db::get_orm_client_rw().await;
            let backend = db.get_database_backend();
            for mut table in [
                Schema::new(backend).create_table_from_entity(alert_incidents::Entity),
                Schema::new(backend).create_table_from_entity(alert_incident_alerts::Entity),
            ] {
                db.execute(backend.build(table.if_not_exists()))
                    .await
                    .unwrap();
            }
            let (base, seen) = mock().await;
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
            let episode = format!("{}:{}", incident.id, incident.episode_opened_at);
            let mut ctx = example_context(NotificationKind::Incident, false);
            ctx.object_id = incident.id.clone();
            ctx.episode_id = Some(episode.clone());
            ctx.event = "opened".into();
            let pd = resolved("pd-timeout", http(format!("{base}/ok"), "pagerduty"));
            send("acme", &pd, None, &mut ctx).await.unwrap();
            assert_eq!(calls(&seen, "/ok").len(), 1);

            // What the auto-resolve job now runs for every stale incident.
            crate::alerts::incidents::resolve_status("acme", &incident.id, false)
                .await
                .unwrap();

            let key = ledger::EpisodeKey {
                org: "acme".into(),
                kind: "incident".into(),
                episode_id: episode,
            };
            let closed = ledger::get_episode(db, &key).await.unwrap().unwrap();
            assert_eq!(closed.closed_by.as_deref(), Some(ledger::CLOSED_BY_RESOLVE));
            let filter = ListFilter {
                org: "acme".into(),
                kind: "incident".into(),
                object_id: Some(incident.id.clone()),
                event: Some("resolved".into()),
                size: 50,
                ..Default::default()
            };
            let (total, rows) = ledger::list(db, &filter).await.unwrap();
            assert_eq!(
                total, 1,
                "one resolve row for the destination the episode recorded"
            );
            assert_eq!(rows[0].destination, "pd-timeout");
            let status = infra::table::alert_incidents::get("acme", &incident.id)
                .await
                .unwrap()
                .unwrap()
                .status;
            assert_eq!(status, "resolved");
        },
    );
}
