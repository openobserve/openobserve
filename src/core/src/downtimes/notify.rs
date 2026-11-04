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

use config::{
    get_config,
    meta::downtimes::{
        Downtime, DowntimeNotificationLogEntry, DowntimeNotificationTemplate, DowntimeWindow,
        NotificationEvent, TargetModule,
    },
    utils::time::now_micros,
};
use infra::table::downtime_notifications::{self as log_table, DowntimeNotification};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

use super::{DowntimeError, MatchCounts};
use crate::alerts::templates::DOWNTIME_EMAIL_TITLE;

pub const LOG_LIMIT: u64 = 50;
/// How often the notifier ticks; a start one tick back is already behind every healthy checkpoint.
pub const TICK_INTERVAL_SECS: u64 = 30;
pub const RESULT_OK: &str = "ok";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DueEvent {
    pub event: NotificationEvent,
    pub window: DowntimeWindow,
    pub key: i64,
}

impl DueEvent {
    pub fn of_window(event: NotificationEvent, window: DowntimeWindow) -> Self {
        Self {
            event,
            key: window.start,
            window,
        }
    }
}

pub fn this_region() -> String {
    let o2 = get_o2_config();
    if o2.super_cluster.enabled {
        o2.super_cluster.region.clone()
    } else {
        String::new()
    }
}

/// Only the origin region sends, so replicated rows do not notify once per region.
pub fn sends_here(row: &Downtime, region: &str) -> bool {
    row.origin_region
        .as_deref()
        .is_none_or(|origin| origin.is_empty() || origin == region)
}

pub fn wants(row: &Downtime, event: NotificationEvent) -> bool {
    row.notifications
        .as_ref()
        .is_some_and(|n| !n.destinations.is_empty() && n.events.wants(event))
}

pub async fn deliver(row: &Downtime, due: &DueEvent) -> Result<bool, DowntimeError> {
    let Some(record) = record_for(row, due, now_micros()) else {
        return Ok(false);
    };
    if !log_table::insert_if_absent(&record).await? {
        return Ok(false);
    }
    let destinations = destinations_of(row);
    let (result, templates) = send(row, due, record.sent_at, &destinations).await;
    let result = match result {
        Ok(summary) => summary,
        Err(e) => {
            log::warn!(
                "[DOWNTIMES] {} notification of {}/{} failed: {e}",
                due.event.as_str(),
                row.org,
                row.id
            );
            e
        }
    };
    let templates = (!templates.is_empty()).then(|| serde_json::json!(templates));
    log_table::set_result(&record.id, &result, templates).await?;
    Ok(true)
}

pub fn deliver_in_background(row: Downtime, due: DueEvent) {
    if !wants(&row, due.event) {
        return;
    }
    tokio::spawn(async move {
        if let Err(e) = deliver(&row, &due).await {
            log::warn!(
                "[DOWNTIMES] could not record the {} notification of {}/{}: {e}",
                due.event.as_str(),
                row.org,
                row.id
            );
        }
    });
}

pub async fn log_for(
    org: &str,
    downtime_id: &str,
) -> Result<Vec<DowntimeNotificationLogEntry>, DowntimeError> {
    Ok(log_table::list_for_downtime(org, downtime_id, LOG_LIMIT)
        .await?
        .into_iter()
        .map(log_entry)
        .collect())
}

fn record_for(row: &Downtime, due: &DueEvent, now: i64) -> Option<DowntimeNotification> {
    if !wants(row, due.event) {
        return None;
    }
    Some(DowntimeNotification {
        id: infra::table::downtimes::new_id(),
        org: row.org.clone(),
        downtime_id: row.id.clone(),
        window_start: due.key,
        event: due.event.as_str().to_string(),
        sent_at: now,
        destinations: serde_json::json!(destinations_of(row)),
        result: None,
        templates: None,
    })
}

fn destinations_of(row: &Downtime) -> Vec<String> {
    row.notifications
        .as_ref()
        .map(|n| n.destinations.clone())
        .unwrap_or_default()
}

fn log_entry(row: DowntimeNotification) -> DowntimeNotificationLogEntry {
    DowntimeNotificationLogEntry {
        window_start: row.window_start,
        event: row.event,
        sent_at: row.sent_at,
        destinations: serde_json::from_value(row.destinations).unwrap_or_default(),
        result: row.result,
        templates: row
            .templates
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
    }
}

async fn send(
    row: &Downtime,
    due: &DueEvent,
    claimed_at: i64,
    destinations: &[String],
) -> (Result<String, String>, Vec<DowntimeNotificationTemplate>) {
    use crate::alerts::notifications::notify::notify;

    let counts = super::match_counts(row).await.ok();
    let vars = variables(
        row,
        due.event,
        &due.window,
        counts.as_ref(),
        &get_config().common.web_url,
    );
    let ctx = downtime_context(row, due, claimed_at, vars);
    let mut results = Vec::with_capacity(destinations.len());
    let mut templates = Vec::new();
    for name in destinations {
        let mut ctx = ctx.clone();
        let sent = notify(&row.org, name, &[], None, &mut ctx).await;
        if let Ok(outcome) = &sent {
            templates.push(DowntimeNotificationTemplate {
                destination: name.clone(),
                template_name: outcome.template_name.clone(),
                template_source: outcome.template_source.clone(),
            });
        }
        results.push((name.as_str(), sent.map(|_| ())));
    }
    (summarize(&results), templates)
}

/// One part per destination; a skip is named but only a real error fails the event.
fn summarize(
    results: &[(
        &str,
        Result<(), crate::alerts::notifications::notify::NotifyError>,
    )],
) -> Result<String, String> {
    use crate::alerts::notifications::notify::NotifyError;

    if results.iter().all(|(_, r)| r.is_ok()) {
        return Ok(RESULT_OK.to_string());
    }
    let summary = results
        .iter()
        .map(|(name, r)| match r {
            Ok(()) => format!("{name}: {RESULT_OK}"),
            Err(e) => format!("{name}: {e}"),
        })
        .collect::<Vec<_>>()
        .join("; ");
    let failed = results
        .iter()
        .any(|(_, r)| matches!(r, Err(e) if !matches!(e, NotifyError::Skipped(_))));
    if failed { Err(summary) } else { Ok(summary) }
}

/// The shared path's context for one downtime event; platforms are skipped, so it has no key.
fn downtime_context(
    row: &Downtime,
    due: &DueEvent,
    claimed_at: i64,
    vars: Vec<(&'static str, String)>,
) -> crate::alerts::notifications::NotificationContext {
    use config::meta::alerts::notification_kind::{self, NotificationKind};

    use crate::alerts::notifications::{
        NotificationContext, STATUS_FIRING, STATUS_RESOLVED, context::RenderHints,
    };

    let ended = matches!(
        due.event,
        NotificationEvent::Ended | NotificationEvent::Cancelled
    );
    let subject = render_title(&vars);
    let url = vars
        .iter()
        .find(|(name, _)| *name == "downtime_url")
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    NotificationContext {
        org_name: row.org.clone(),
        alert_name: row.name.clone(),
        alert_status: if ended {
            STATUS_RESOLVED
        } else {
            STATUS_FIRING
        }
        .to_string(),
        alert_start_time: utc(due.window.start),
        alert_end_time: utc(due.window.end),
        alert_start_time_millis: (due.window.start / 1000).to_string(),
        alert_end_time_millis: (due.window.end / 1000).to_string(),
        alert_url: url,
        alert_trigger_time: claimed_at,
        alert_trigger_time_str: utc(claimed_at),
        alert_description: row.reason.clone().unwrap_or_default(),
        context_attributes: vars
            .into_iter()
            .filter(|(name, _)| *name != "org_name")
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        kind: NotificationKind::Downtime,
        // Matches alert_status; platforms still skip every downtime event (D8).
        event: match due.event {
            NotificationEvent::Started => notification_kind::NotificationEvent::Firing,
            NotificationEvent::Ended | NotificationEvent::Cancelled => {
                notification_kind::NotificationEvent::Resolved
            }
            NotificationEvent::EndingSoon | NotificationEvent::Extended => {
                notification_kind::NotificationEvent::Informational
            }
        },
        cluster_name: config::get_cluster_name(),
        render_hints: RenderHints {
            fallback_subject: Some(subject),
            escape_email_attributes: true,
        },
        ..Default::default()
    }
}

/// Today's subject, for a destination whose template has no title of its own.
fn render_title(vars: &[(&'static str, String)]) -> String {
    let mut title = DOWNTIME_EMAIL_TITLE.to_string();
    for (name, value) in vars {
        title = title.replace(&format!("{{{name}}}"), value);
    }
    title
}

fn variables(
    row: &Downtime,
    event: NotificationEvent,
    window: &DowntimeWindow,
    counts: Option<&MatchCounts>,
    web_url: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("downtime_name", row.name.clone()),
        ("downtime_event", event_phrase(event).to_string()),
        ("downtime_reason", row.reason.clone().unwrap_or_default()),
        ("downtime_starts_at", utc(window.start)),
        ("downtime_ends_at", utc(window.end)),
        ("downtime_targets", targets_phrase(row)),
        ("downtime_counts", counts_phrase(row, counts)),
        (
            "downtime_url",
            format!("{web_url}/web/downtimes?org_identifier={}", row.org),
        ),
        ("org_name", row.org.clone()),
    ]
}

fn event_phrase(event: NotificationEvent) -> &'static str {
    match event {
        NotificationEvent::Started => "started",
        NotificationEvent::EndingSoon => "ends soon",
        NotificationEvent::Ended => "ended",
        NotificationEvent::Cancelled => "was cancelled",
        NotificationEvent::Extended => "was extended",
    }
}

fn utc(micros: i64) -> String {
    chrono::DateTime::from_timestamp_micros(micros)
        .map(|at| at.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_default()
}

fn targets_phrase(row: &Downtime) -> String {
    row.targets
        .iter()
        .map(|t| module_words(t.module).1)
        .collect::<Vec<_>>()
        .join(", ")
}

fn counts_phrase(row: &Downtime, counts: Option<&MatchCounts>) -> String {
    let Some(counts) = counts else {
        return String::new();
    };
    row.targets
        .iter()
        .map(|t| {
            let n = counts.of(t.module);
            let (one, many) = module_words(t.module);
            format!("{n} {}", if n == 1 { one } else { many })
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn module_words(module: TargetModule) -> (&'static str, &'static str) {
    match module {
        TargetModule::Alerts => ("alert", "alerts"),
        TargetModule::AnomalyDetections => ("anomaly detection", "anomaly detections"),
        TargetModule::Synthetics => ("synthetics check", "synthetics checks"),
        TargetModule::Slos => ("SLO", "SLOs"),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::downtimes::{
        DowntimeNotifications, DowntimeSchedule, DowntimeTarget, NotificationEvents, Repeat,
        TargetFolders,
    };
    use infra::table::entity::downtime_notifications::Entity as LogEntity;
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::alerts::templates::downtime_templates;

    const HOUR: i64 = 3_600_000_000;

    fn row(origin: Option<&str>) -> Downtime {
        Downtime {
            alert_groups: None,
            end_on_clear: None,
            source: None,
            id: "2f9KQe4b7Nq1vH3sT0mLzXpRcWd".to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: "Nightly \"deploy\" <db>".to_string(),
            reason: Some("CHG-1".to_string()),
            condition: None,
            targets: [TargetModule::Alerts, TargetModule::Synthetics]
                .into_iter()
                .map(|module| DowntimeTarget {
                    module,
                    folders: TargetFolders::All,
                    tags: vec![],
                    ids: vec![],
                    slo_mode: None,
                    incident_mode: Default::default(),
                })
                .collect(),
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: 10 * HOUR,
                ends_at: Some(12 * HOUR),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: 7200,
                weekdays: vec![],
            },
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            notifications: Some(DowntimeNotifications {
                destinations: vec!["slack".to_string(), "pagerduty".to_string()],
                events: NotificationEvents {
                    started: true,
                    ended: true,
                    ..Default::default()
                },
                ending_soon_lead_secs: 600,
                continues: None,
            }),
            origin_region: origin.map(str::to_string),
            version: 0,
            created_by: "lin".to_string(),
            created_at: 1,
            updated_by: "lin".to_string(),
            updated_at: 1,
        }
    }

    fn window() -> DowntimeWindow {
        DowntimeWindow {
            start: 10 * HOUR,
            end: 12 * HOUR,
        }
    }

    async fn log_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(LogEntity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db.execute_unprepared(
            "CREATE UNIQUE INDEX downtime_notifications_window_event_idx \
             ON downtime_notifications (downtime_id, window_start, event)",
        )
        .await
        .unwrap();
        db
    }

    #[test]
    fn a_row_without_an_origin_sends_from_every_region_and_one_with_it_only_from_there() {
        for region in ["", "us-east", "eu-west"] {
            assert!(sends_here(&row(None), region));
            assert!(sends_here(&row(Some("")), region));
        }
        assert!(sends_here(&row(Some("us-east")), "us-east"));
        assert!(!sends_here(&row(Some("us-east")), "eu-west"));
        assert!(!sends_here(&row(Some("us-east")), ""));
    }

    #[test]
    fn only_a_wanted_event_with_destinations_gets_a_log_row() {
        let d = row(None);
        let due = DueEvent::of_window(NotificationEvent::Started, window());
        let record = record_for(&d, &due, 7).unwrap();
        assert_eq!(record.window_start, 10 * HOUR);
        assert_eq!(record.event, "started");
        assert_eq!(record.sent_at, 7);
        assert_eq!(
            record.destinations,
            serde_json::json!(["slack", "pagerduty"])
        );
        assert_eq!(record.result, None);

        let reminder = DueEvent::of_window(NotificationEvent::EndingSoon, window());
        assert!(record_for(&d, &reminder, 7).is_none());
        let mut silent = row(None);
        silent.notifications.as_mut().unwrap().destinations.clear();
        assert!(record_for(&silent, &due, 7).is_none());
        silent.notifications = None;
        assert!(record_for(&silent, &due, 7).is_none());
    }

    #[tokio::test]
    async fn a_second_node_finds_the_claim_and_sends_nothing() {
        let db = log_db().await;
        let d = row(None);
        let due = DueEvent::of_window(NotificationEvent::Started, window());
        let first = record_for(&d, &due, 1).unwrap();
        let second = record_for(&d, &due, 2).unwrap();
        assert_ne!(first.id, second.id);
        assert!(log_table::insert_if_absent_with(&db, &first).await.unwrap());
        assert!(
            !log_table::insert_if_absent_with(&db, &second)
                .await
                .unwrap()
        );

        let ended = DueEvent::of_window(NotificationEvent::Ended, window());
        let ended = record_for(&d, &ended, 3).unwrap();
        assert!(log_table::insert_if_absent_with(&db, &ended).await.unwrap());
        let rows = log_table::list_for_downtime_with(&db, "acme", &d.id, LOG_LIMIT)
            .await
            .unwrap();
        let entries: Vec<_> = rows.into_iter().map(log_entry).collect();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].event, "ended");
        assert_eq!(entries[0].destinations, ["slack", "pagerduty"]);
        assert!(entries[0].templates.is_empty());
    }

    #[tokio::test]
    async fn the_log_entry_names_the_template_each_destination_sent_with() {
        let db = log_db().await;
        let d = row(None);
        let record = record_for(&d, &due(NotificationEvent::Started), 1).unwrap();
        assert!(
            log_table::insert_if_absent_with(&db, &record)
                .await
                .unwrap()
        );
        let sent = vec![DowntimeNotificationTemplate {
            destination: "slack".to_string(),
            template_name: "o2_default_downtime".to_string(),
            template_source: "org_default".to_string(),
        }];
        log_table::set_result_with(&db, &record.id, RESULT_OK, Some(serde_json::json!(sent)))
            .await
            .unwrap();

        let rows = log_table::list_for_downtime_with(&db, "acme", &d.id, LOG_LIMIT)
            .await
            .unwrap();
        let entry = log_entry(rows.into_iter().next().unwrap());
        assert_eq!(entry.templates, sent);
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["templates"][0]["template_name"], "o2_default_downtime");
    }

    fn due(event: NotificationEvent) -> DueEvent {
        DueEvent::of_window(event, window())
    }

    #[test]
    fn the_seeded_pair_renders_through_the_shared_path_escaped_for_its_format() {
        use crate::alerts::notifications::custom::apply_custom_template;

        let counts = MatchCounts {
            alerts: 2,
            synthetics: 1,
            ..Default::default()
        };
        let vars = variables(
            &row(None),
            NotificationEvent::EndingSoon,
            &window(),
            Some(&counts),
            "https://o2.example.com",
        );
        let ctx = downtime_context(&row(None), &due(NotificationEvent::EndingSoon), 7, vars);
        let [http, email] = downtime_templates();

        let body = apply_custom_template(&http.body, &ctx, false);
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["downtime"]["name"], "Nightly \"deploy\" <db>");
        assert_eq!(json["downtime"]["event"], "ends soon");
        assert_eq!(json["downtime"]["starts_at"], "1970-01-01 10:00 UTC");
        assert_eq!(json["downtime"]["ends_at"], "1970-01-01 12:00 UTC");
        assert_eq!(json["downtime"]["targets"], "alerts, synthetics checks");
        assert_eq!(json["downtime"]["counts"], "2 alerts, 1 synthetics check");
        assert_eq!(
            json["downtime"]["url"],
            "https://o2.example.com/web/downtimes?org_identifier=acme"
        );
        assert_eq!(json["downtime"]["org"], "acme");
        assert_eq!(json["downtime"]["reason"], "CHG-1");

        let html = apply_custom_template(&email.body, &ctx, true);
        assert!(html.contains("Nightly &quot;deploy&quot; &lt;db&gt;"));
        assert!(!html.contains("{downtime_"));
        assert!(!html.contains("{org_name}"));
    }

    #[test]
    fn a_downtime_event_follows_its_status_with_no_platform_key() {
        use config::meta::alerts::notification_kind::{NotificationEvent as Event, PlatformAction};

        use crate::alerts::notifications::custom::apply_custom_template;

        let vars = || variables(&row(None), NotificationEvent::Started, &window(), None, "");
        let started = downtime_context(&row(None), &due(NotificationEvent::Started), 5, vars());
        assert_eq!(started.kind.as_str(), "downtime");
        assert_eq!(started.event, Event::Firing);
        assert_eq!(started.episode_id, None);
        assert_eq!(started.alert_status, "firing");
        let ended = downtime_context(&row(None), &due(NotificationEvent::Ended), 6, vars());
        assert_eq!(ended.event, Event::Resolved);
        assert_eq!(ended.alert_status, "resolved");
        let body = "{notification_event}";
        assert_eq!(apply_custom_template(body, &started, false), "firing");
        assert_eq!(apply_custom_template(body, &ended, false), "resolved");
        for ctx in [&started, &ended] {
            assert_eq!(ctx.kind.platform_action(ctx.event), PlatformAction::Skip);
        }
        let notice = downtime_context(&row(None), &due(NotificationEvent::EndingSoon), 7, vars());
        assert_eq!(notice.event, Event::Informational);
        assert_eq!(
            started.render_hints.fallback_subject.as_deref(),
            Some("OpenObserve downtime Nightly \"deploy\" <db>: started")
        );
    }

    #[test]
    fn a_platform_skip_is_named_but_does_not_fail_the_event() {
        use crate::alerts::notifications::notify::{NotifyError, SkipReason};
        let skipped = || Err(NotifyError::Skipped(SkipReason::PlatformNotForKind));
        assert_eq!(
            summarize(&[("slack", Ok(())), ("pagerduty", skipped())]),
            Ok("slack: ok; pagerduty: skipped: PlatformNotForKind".to_string())
        );
        assert_eq!(summarize(&[("slack", Ok(()))]), Ok(RESULT_OK.to_string()));
        assert_eq!(
            summarize(&[
                ("slack", Ok(())),
                ("hook", Err(NotifyError::Transport("refused".into())))
            ]),
            Err("slack: ok; hook: refused".to_string())
        );
    }

    #[test]
    fn counts_are_empty_when_unknown() {
        assert_eq!(counts_phrase(&row(None), None), "");
    }
}
