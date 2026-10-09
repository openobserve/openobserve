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
    meta::{
        destinations::{DestinationType, Module, Template, TemplateType},
        downtimes::{
            Downtime, DowntimeNotificationLogEntry, DowntimeWindow, NotificationEvent, TargetModule,
        },
    },
    utils::time::now_micros,
};
use infra::table::downtime_notifications::{self as log_table, DowntimeNotification};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

use super::{DowntimeError, MatchCounts};
use crate::alerts::templates::{DOWNTIME_EMAIL_TITLE, downtime_templates};

pub const LOG_LIMIT: u64 = 50;
pub const RESULT_OK: &str = "ok";
const DOWNTIME_VARIABLE_PREFIX: &str = "{downtime_";

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Escape {
    Json,
    Html,
    Plain,
}

impl Escape {
    fn apply(self, value: &str) -> String {
        match self {
            Self::Json => {
                let quoted = serde_json::Value::String(value.to_string()).to_string();
                quoted[1..quoted.len() - 1].to_string()
            }
            Self::Html => value
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
                .replace('\'', "&#39;"),
            Self::Plain => value.to_string(),
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
    let result = match send(row, due, &destinations).await {
        Ok(()) => RESULT_OK.to_string(),
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
    log_table::set_result(&record.id, &result).await?;
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
    }
}

async fn send(row: &Downtime, due: &DueEvent, destinations: &[String]) -> Result<(), String> {
    let counts = super::match_counts(row).await.ok();
    let vars = variables(
        row,
        due.event,
        &due.window,
        counts.as_ref(),
        &get_config().common.web_url,
    );
    let mut errors = Vec::new();
    for name in destinations {
        if let Err(e) = send_one(&row.org, name, &vars).await {
            errors.push(format!("{name}: {e}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

async fn send_one(org: &str, name: &str, vars: &[(&str, String)]) -> Result<(), String> {
    let dest = crate::alerts::destinations::get(org, name)
        .await
        .map_err(|e| e.to_string())?;
    let Module::Alert {
        template,
        destination_type,
    } = dest.module
    else {
        return Err("not an alert destination".to_string());
    };
    let own = match template {
        Some(template) => db::alerts::templates::get(org, &template).await.ok(),
        None => None,
    };
    let template = template_for(own, &destination_type);
    let escape = if matches!(destination_type, DestinationType::Email(_)) {
        Escape::Html
    } else {
        Escape::Json
    };
    let body = render(&template.body, vars, escape);
    let subject = match &template.template_type {
        TemplateType::Email { title } if !title.is_empty() => render(title, vars, Escape::Plain),
        _ => render(DOWNTIME_EMAIL_TITLE, vars, Escape::Plain),
    };
    crate::alerts::alert::dispatch_notification(&destination_type, &subject, body)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn template_for(own: Option<Template>, destination_type: &DestinationType) -> Template {
    if let Some(own) = own.filter(|t| t.body.contains(DOWNTIME_VARIABLE_PREFIX)) {
        return own;
    }
    let [http, email] = downtime_templates();
    if matches!(destination_type, DestinationType::Email(_)) {
        email
    } else {
        http
    }
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

/// One pass, so a value that itself reads like `{downtime_url}` is not substituted again.
fn render(body: &str, vars: &[(&str, String)], escape: Escape) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let tail = &rest[open..];
        let hit = tail.find('}').and_then(|close| {
            let name = &tail[1..close];
            vars.iter()
                .find(|(n, _)| *n == name)
                .map(|(_, value)| (close, value))
        });
        match hit {
            Some((close, value)) => {
                out.push_str(&escape.apply(value));
                rest = &tail[close + 1..];
            }
            None => {
                out.push('{');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
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
    use config::meta::{
        destinations::{Email, Endpoint},
        downtimes::{
            DowntimeNotifications, DowntimeSchedule, DowntimeTarget, NotificationEvents, Repeat,
            TargetFolders,
        },
    };
    use infra::table::entity::downtime_notifications::Entity as LogEntity;
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Schema};

    use super::*;

    const HOUR: i64 = 3_600_000_000;

    fn row(origin: Option<&str>) -> Downtime {
        Downtime {
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
    }

    #[test]
    fn variables_fill_both_prebuilt_templates_escaped_for_their_format() {
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
        let [http, email] = downtime_templates();

        let body = render(&http.body, &vars, Escape::Json);
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

        let html = render(&email.body, &vars, Escape::Html);
        assert!(html.contains("Nightly &quot;deploy&quot; &lt;db&gt;"));
        assert!(!html.contains("{downtime_"));
        assert!(!html.contains("{org_name}"));
    }

    #[test]
    fn render_substitutes_once_and_leaves_unknown_braces_alone() {
        let vars = vec![
            ("downtime_name", "{downtime_url}".to_string()),
            ("downtime_url", "https://x".to_string()),
        ];
        assert_eq!(
            render(
                "{downtime_name} {alert_name} {downtime_url} {",
                &vars,
                Escape::Plain
            ),
            "{downtime_url} {alert_name} https://x {"
        );
        assert_eq!(Escape::Json.apply("a\"b\nc"), "a\\\"b\\nc");
    }

    #[test]
    fn a_destination_template_is_used_only_when_written_for_downtimes() {
        let http = DestinationType::Http(Endpoint::default());
        let email = DestinationType::Email(Email::default());
        let own = |body: &str| Template {
            name: "mine".to_string(),
            body: body.to_string(),
            ..Default::default()
        };
        assert_eq!(
            template_for(Some(own("{downtime_name} is {downtime_event}")), &http).name,
            "mine"
        );
        assert_eq!(
            template_for(Some(own("[{alert_status}] {alert_name}")), &http).name,
            "prebuilt_downtime"
        );
        assert_eq!(template_for(None, &email).name, "prebuilt_downtime_email");
    }

    #[test]
    fn counts_are_empty_when_unknown() {
        assert_eq!(counts_phrase(&row(None), None), "");
    }
}
