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

//! Per kind sample contexts and variable lists, shared by preview and the example goldens.

use config::meta::alerts::{
    level::AlertLevel,
    notification_kind::{NotificationEvent, NotificationKind},
};

use super::{
    STATUS_FIRING, STATUS_RESOLVED,
    context::{NotificationContext, build_row_columns},
};

pub const ANOMALY_VARIABLES: [&str; 13] = [
    "anomaly_id",
    "anomaly_name",
    "anomaly_kind",
    "anomaly_count",
    "max_deviation_percent",
    "deviation_kind",
    "worst_actual_value",
    "worst_expected",
    "score",
    "threshold",
    "window_start",
    "window_end",
    "anomaly_url",
];

pub const INCIDENT_VARIABLES: [&str; 6] = [
    "incident_id",
    "incident_title",
    "incident_event",
    "incident_severity",
    "incident_service",
    "incident_url",
];

pub const SYNTHETICS_VARIABLES: [&str; 16] = [
    "check_id",
    "check_name",
    "check_type",
    "check_target",
    "check_status",
    "check_status_label",
    "check_status_reason",
    "check_locations_line",
    "check_location_count",
    "check_consecutive_failures",
    "check_flaky",
    "check_degraded",
    "check_run_id",
    "check_url",
    "check_error",
    "check_title",
];

pub const ONCALL_VARIABLES: [&str; 8] = [
    "oncall_team",
    "oncall_reason",
    "oncall_stage",
    "oncall_priority",
    "oncall_recipient",
    "oncall_response_id",
    "oncall_ack_url",
    "runbook_url",
];

pub const DOWNTIME_VARIABLES: [&str; 8] = [
    "downtime_name",
    "downtime_event",
    "downtime_reason",
    "downtime_starts_at",
    "downtime_ends_at",
    "downtime_targets",
    "downtime_counts",
    "downtime_url",
];

const COMMON_VARIABLES: [&str; 27] = [
    "org_name",
    "stream_type",
    "stream_name",
    "alert_name",
    "alert_type",
    "alert_period",
    "alert_operator",
    "alert_threshold",
    "alert_count",
    "alert_agg_value",
    "alert_level",
    "alert_status",
    "episode_id",
    "recovery_reason",
    "alert_priority",
    "alert_tags",
    "alert_threshold_crit",
    "alert_threshold_warn",
    "alert_warning_threshold",
    "alert_start_time",
    "alert_end_time",
    "alert_url",
    "alert_trigger_time_str",
    "alert_time",
    "alert_description",
    "rows",
    "group.<label>",
];

/// The variables a template of `kind` can use: common, shared send path, then the kind's own.
pub fn variables_for(kind: NotificationKind) -> Vec<String> {
    let kind_vars: &[&str] = match kind {
        NotificationKind::Anomaly => &ANOMALY_VARIABLES,
        NotificationKind::Incident => &INCIDENT_VARIABLES,
        NotificationKind::Synthetics => &SYNTHETICS_VARIABLES,
        NotificationKind::Downtime => &DOWNTIME_VARIABLES,
        NotificationKind::OnCall => &ONCALL_VARIABLES,
        _ => &[],
    };
    COMMON_VARIABLES
        .iter()
        .chain(super::resolve::EXTRA_SCALAR_NAMES.iter())
        .chain(kind_vars)
        .map(|v| v.to_string())
        .collect()
}

/// One group of the variable guide: `common`, or a kind whose producer renders templates.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct VariableGroup {
    pub name: String,
    pub variables: Vec<String>,
}

/// The kinds whose producer sends through templates in this release; the UI hides the others.
pub const SHIPPED_KINDS: [NotificationKind; 6] = [
    NotificationKind::Alert,
    NotificationKind::Incident,
    NotificationKind::Anomaly,
    NotificationKind::Synthetics,
    NotificationKind::Downtime,
    NotificationKind::OnCall,
];

/// `common`, then one group per shipped kind with its own variables.
pub fn variable_groups() -> Vec<VariableGroup> {
    let group = |name: &str, vars: &[&str]| VariableGroup {
        name: name.to_string(),
        variables: vars.iter().map(|v| v.to_string()).collect(),
    };
    let common: Vec<&str> = COMMON_VARIABLES
        .iter()
        .chain(super::resolve::EXTRA_SCALAR_NAMES.iter())
        .copied()
        .collect();
    let mut groups = vec![group("common", &common)];
    for kind in SHIPPED_KINDS {
        let vars: &[&str] = match kind {
            NotificationKind::Anomaly => &ANOMALY_VARIABLES,
            NotificationKind::Incident => &INCIDENT_VARIABLES,
            NotificationKind::Synthetics => &SYNTHETICS_VARIABLES,
            NotificationKind::Downtime => &DOWNTIME_VARIABLES,
            NotificationKind::OnCall => &ONCALL_VARIABLES,
            _ => &[],
        };
        groups.push(group(kind.as_str(), vars));
    }
    groups
}

/// The sample of the Examples tab for `kind`; `resolved` gives the recovery of the same episode.
pub fn example_context(kind: NotificationKind, resolved: bool) -> NotificationContext {
    match kind {
        NotificationKind::Anomaly => anomaly_example(resolved),
        NotificationKind::Incident => incident_example(resolved),
        NotificationKind::Synthetics => synthetics_example(resolved),
        NotificationKind::OnCall => on_call_example(resolved),
        _ => {
            let level = if resolved {
                AlertLevel::Ok
            } else {
                AlertLevel::Critical
            };
            let mut ctx = super::preview::synthetic_context(Some(level));
            ctx.kind = kind;
            ctx
        }
    }
}

fn base(kind: NotificationKind, resolved: bool, level: AlertLevel) -> NotificationContext {
    NotificationContext {
        org_name: "acme".into(),
        stream_type: "logs".into(),
        stream_name: "web-logs".into(),
        alert_status: if resolved {
            STATUS_RESOLVED
        } else {
            STATUS_FIRING
        }
        .into(),
        alert_level: level_str(level).into(),
        level: Some(level),
        kind,
        cluster_name: "o2-acme".into(),
        alert_start_time: "N/A".into(),
        alert_end_time: "N/A".into(),
        alert_start_time_millis: "N/A".into(),
        alert_end_time_millis: "N/A".into(),
        ..Default::default()
    }
}

fn anomaly_example(resolved: bool) -> NotificationContext {
    let link = "https://o2.acme.com/web/alerts/anomaly/edit/a1b2c3?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut ctx = base(NotificationKind::Anomaly, resolved, level);
    ctx.alert_name = "error rate on web-logs".into();
    ctx.alert_url = link.into();
    ctx.event = event_of(resolved);
    ctx.episode_id = Some("a1b2c3".into());
    let (start, end) = if resolved {
        ("2026-11-02 10:25 UTC", "2026-11-02 10:40 UTC")
    } else {
        ("2026-11-02 09:50 UTC", "2026-11-02 10:05 UTC")
    };
    ctx.alert_trigger_time_str = if resolved {
        "2026-11-02 10:40:00"
    } else {
        "2026-11-02 10:05:00"
    }
    .into();
    ctx.alert_description = if resolved {
        format!("a full detection run found no anomalies in window {start}\u{2013}{end}")
    } else {
        format!(
            "3 anomalies in window {start}\u{2013}{end} | worst value: 342.00 (expected ~98.00 \
             for this hour) | score 0.91 vs threshold 0.80 (score 14.0% over its bar)"
        )
    };
    let (count, worst, expected, score, deviation, kind) = if resolved {
        ("0", "", "", "0.00", "", "recovery")
    } else {
        ("3", "342.00", "98.00", "0.91", "14.0", "value")
    };
    ctx.context_attributes = [
        ("anomaly_id", "a1b2c3"),
        ("anomaly_name", "error rate on web-logs"),
        ("anomaly_kind", kind),
        ("anomaly_count", count),
        ("max_deviation_percent", deviation),
        (
            "deviation_kind",
            if resolved { "" } else { "score_over_threshold" },
        ),
        ("worst_actual_value", worst),
        ("worst_expected", expected),
        ("score", score),
        ("threshold", "0.80"),
        ("window_start", start),
        ("window_end", end),
        ("anomaly_url", link),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn synthetics_example(resolved: bool) -> NotificationContext {
    let url = "https://o2.acme.com/web/synthetic/chk_9d/results?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut ctx = base(NotificationKind::Synthetics, resolved, level);
    ctx.stream_type = "synthetics".into();
    ctx.stream_name = "https://shop.acme.com/api/health".into();
    ctx.alert_name = "checkout API".into();
    ctx.alert_url = url.into();
    ctx.episode_id = Some("chk_9d".into());
    ctx.event = event_of(resolved);
    ctx.alert_trigger_time_str = "2026-11-02 10:05:00".into();
    let (title, description, label, locations, error) = if resolved {
        (
            "[OpenObserve Synthetics] ✅ checkout API has RECOVERED",
            "checkout API has recovered",
            "recovered",
            "us-east-1, eu-west-1 recovered",
            "",
        )
    } else {
        (
            "[OpenObserve Synthetics] 🔴 checkout API is FAILED",
            "checkout API is failing\nconnection timed out after 10s",
            "failed",
            "1 of 2 failed: us-east-1",
            "connection timed out after 10s",
        )
    };
    ctx.alert_description = description.into();
    ctx.context_attributes = [
        ("check_id", "chk_9d"),
        ("check_name", "checkout API"),
        ("check_type", "http"),
        ("check_target", "https://shop.acme.com/api/health"),
        ("check_status", if resolved { "passed" } else { "failed" }),
        ("check_status_label", label),
        ("check_status_reason", ""),
        ("check_locations_line", locations),
        ("check_location_count", "2"),
        (
            "check_consecutive_failures",
            if resolved { "0" } else { "3" },
        ),
        ("check_flaky", "false"),
        ("check_degraded", "false"),
        ("check_run_id", "run_42"),
        ("check_url", url),
        ("check_error", error),
        ("check_title", title),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn on_call_example(resolved: bool) -> NotificationContext {
    let url = "https://o2.acme.com/web/oncall/responses/resp_31?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut ctx = base(NotificationKind::OnCall, resolved, level);
    ctx.alert_name = "High error rate on web-logs".into();
    ctx.alert_url = url.into();
    ctx.episode_id = Some("resp_31".into());
    ctx.event = event_of(resolved);
    ctx.alert_trigger_time_str = "2026-11-02 10:05:00".into();
    ctx.alert_description = "error rate 12.4% over the 5% threshold on checkout".into();
    let (stage, reason, ack) = if resolved {
        ("resolved", "the incident was resolved", "")
    } else {
        (
            "1",
            "paged by policy checkout-escalation",
            "https://o2.acme.com/api/acme/oncall/ack/resp_31",
        )
    };
    ctx.context_attributes = [
        ("oncall_team", "checkout"),
        ("oncall_reason", reason),
        ("oncall_stage", stage),
        ("oncall_priority", "P2"),
        ("oncall_recipient", "maria@acme.com"),
        ("oncall_response_id", "resp_31"),
        ("oncall_ack_url", ack),
        ("runbook_url", "https://wiki.acme.com/runbooks/checkout"),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn incident_example(resolved: bool) -> NotificationContext {
    let url = "https://o2.acme.com/web/alerts/incidents/inc_7f3a?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut ctx = base(NotificationKind::Incident, resolved, level);
    ctx.alert_name = "High error rate".into();
    ctx.alert_url = url.into();
    ctx.incident_id = "inc_7f3a".into();
    ctx.episode_id = Some("inc_7f3a".into());
    let event = if resolved {
        STATUS_RESOLVED
    } else {
        "new_incident_created"
    };
    ctx.event = event_of(resolved);
    ctx.alert_description = if resolved {
        "All linked alerts recovered"
    } else {
        "Error rate above 5% for 5 minutes"
    }
    .into();
    ctx.alert_trigger_time_str = if resolved {
        "2026-11-02 10:40:00"
    } else {
        "2026-11-02 10:05:00"
    }
    .into();
    if !resolved {
        ctx.rows = vec![
            serde_json::from_str(r#"{"host":"web-1","errors":9}"#).unwrap(),
            serde_json::from_str(r#"{"host":"web-2","errors":3}"#).unwrap(),
        ];
        ctx.row_columns = build_row_columns(&ctx.rows);
    }
    ctx.context_attributes = [
        ("incident_id", "inc_7f3a"),
        ("incident_title", "High error rate on web-logs"),
        ("incident_event", event),
        ("incident_severity", "P2"),
        ("incident_service", "checkout"),
        ("incident_url", url),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn event_of(resolved: bool) -> NotificationEvent {
    if resolved {
        NotificationEvent::Resolved
    } else {
        NotificationEvent::Firing
    }
}

fn level_str(level: AlertLevel) -> &'static str {
    match level {
        AlertLevel::Critical => "critical",
        AlertLevel::Warning => "warning",
        AlertLevel::Ok => "ok",
        AlertLevel::NoData => "no_data",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alerts::notifications::{
        default_template::compiled_content_for,
        format::ChannelFormat,
        render::{RenderedMessage, render},
        resolve::resolve_content,
    };

    const EXAMPLE_ANOMALY: &str = include_str!("render/testdata/examples/anomaly.json");
    const EXAMPLE_INCIDENT: &str = include_str!("render/testdata/examples/incident.json");
    const EXAMPLE_SYNTHETICS: &str = include_str!("render/testdata/examples/synthetics.json");
    const EXAMPLE_ON_CALL: &str = include_str!("render/testdata/examples/on_call.json");

    fn rendered(
        kind: NotificationKind,
        resolved: bool,
        format: ChannelFormat,
    ) -> serde_json::Value {
        let ctx = example_context(kind, resolved);
        let content = resolve_content(&compiled_content_for(kind), &ctx, format.channel_family());
        match render(format, &content, &ctx).unwrap() {
            RenderedMessage::Http { body } => serde_json::from_str(&body).unwrap(),
            RenderedMessage::Email {
                subject,
                html,
                text,
            } => serde_json::json!({"subject": subject, "html": html, "text": text}),
            RenderedMessage::Sns { subject, message } => {
                serde_json::json!({"subject": subject, "message": message})
            }
        }
    }

    fn example(kind: NotificationKind) -> serde_json::Value {
        serde_json::json!({
            "slack_firing": rendered(kind, false, ChannelFormat::Slack),
            "slack_resolved": rendered(kind, true, ChannelFormat::Slack),
            "webhook_firing": rendered(kind, false, ChannelFormat::Webhook),
            "email_firing": rendered(kind, false, ChannelFormat::Email),
            "sns_firing": rendered(kind, false, ChannelFormat::Sns),
        })
    }

    #[test]
    fn golden_example_anomaly() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_ANOMALY).unwrap();
        assert_eq!(example(NotificationKind::Anomaly), want);
        let title = &want["slack_firing"]["attachments"][0]["blocks"][0]["text"]["text"];
        assert!(
            title
                .as_str()
                .unwrap()
                .contains("Anomaly firing: error rate on web-logs on web-logs")
        );
    }

    #[test]
    fn golden_example_incident() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_INCIDENT).unwrap();
        assert_eq!(example(NotificationKind::Incident), want);
        assert_eq!(
            want["webhook_firing"]["context"]["kind"], "incident",
            "the envelope names the kind"
        );
    }

    #[test]
    fn golden_example_synthetics_keeps_the_subject_line_as_its_title() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_SYNTHETICS).unwrap();
        assert_eq!(example(NotificationKind::Synthetics), want);
        let title = &want["slack_firing"]["attachments"][0]["blocks"][0]["text"]["text"];
        assert!(
            title
                .as_str()
                .unwrap()
                .contains("[OpenObserve Synthetics] 🔴 checkout API is FAILED")
        );
    }

    #[test]
    fn golden_example_on_call_keeps_todays_header_and_drops_an_unset_ack_link() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_ON_CALL).unwrap();
        assert_eq!(example(NotificationKind::OnCall), want);
        let firing = want["slack_firing"].to_string();
        assert!(
            firing.contains("P2 · High error rate on web-logs"),
            "{firing}"
        );
        assert!(firing.contains("Acknowledge"));
        assert!(!want["slack_resolved"].to_string().contains("Acknowledge"));
    }

    #[test]
    fn anomaly_recovery_hides_empty_fields() {
        let ctx = example_context(NotificationKind::Anomaly, true);
        let content = resolve_content(
            &compiled_content_for(NotificationKind::Anomaly),
            &ctx,
            "slack",
        );
        let labels: Vec<&str> = content.fields.iter().map(|(l, _)| l.as_str()).collect();
        assert_eq!(labels, ["Window", "Score"]);
    }

    #[test]
    fn variables_for_lists_the_kind_group_after_the_common_one() {
        let vars = variables_for(NotificationKind::Anomaly);
        assert!(vars.contains(&"alert_name".to_string()));
        assert!(vars.contains(&"notification_kind".to_string()));
        assert!(vars.contains(&"anomaly_count".to_string()));
        assert!(!variables_for(NotificationKind::Alert).contains(&"anomaly_count".to_string()));
    }

    /// Regenerate `render/testdata/examples/`; hand-check every file before committing it.
    #[test]
    #[ignore]
    fn capture_examples() {
        let dir = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/alerts/notifications/render/testdata/examples"
        );
        std::fs::create_dir_all(dir).unwrap();
        for (kind, file) in [
            (NotificationKind::Anomaly, "anomaly.json"),
            (NotificationKind::Incident, "incident.json"),
            (NotificationKind::Synthetics, "synthetics.json"),
            (NotificationKind::OnCall, "on_call.json"),
        ] {
            let body = serde_json::to_string_pretty(&example(kind)).unwrap() + "\n";
            std::fs::write(format!("{dir}/{file}"), body).unwrap();
        }
    }
}
