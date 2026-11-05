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

pub const ANOMALY_VARIABLES: [&str; 16] = [
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
    "anomaly_score",
    "anomaly_explore_url",
    "anomaly_explore_label",
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

pub const SYNTHETICS_VARIABLES: [&str; 18] = [
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
    "check_environments",
    "check_checked_at",
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

pub const DOWNTIME_VARIABLES: [&str; 9] = [
    "downtime_name",
    "downtime_event",
    "downtime_reason",
    "downtime_starts_at",
    "downtime_ends_at",
    "downtime_window",
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

/// The state a synthetics sample shows: the Playground lists failing, degraded, flaky, recovered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckSample {
    Failing,
    Degraded,
    Flaky,
    Recovered,
}

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

/// Every kind's own variables; one of them reads blank for another kind rather than unknown.
pub fn kind_variables() -> impl Iterator<Item = &'static str> {
    ANOMALY_VARIABLES
        .into_iter()
        .chain(INCIDENT_VARIABLES)
        .chain(SYNTHETICS_VARIABLES)
        .chain(ONCALL_VARIABLES)
        .chain(DOWNTIME_VARIABLES)
}

pub fn is_kind_variable(name: &str) -> bool {
    kind_variables().any(|v| v == name)
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
    let check = if resolved {
        CheckSample::Recovered
    } else {
        CheckSample::Failing
    };
    sample(kind, resolved, "P2", check)
}

/// The sample for the Playground severity `level`, so its priority and check state read through.
pub fn example_context_at(
    kind: NotificationKind,
    level: Option<AlertLevel>,
) -> NotificationContext {
    let check = match level {
        Some(AlertLevel::Ok) => CheckSample::Recovered,
        Some(AlertLevel::Warning) => CheckSample::Degraded,
        Some(AlertLevel::NoData) => CheckSample::Flaky,
        _ => CheckSample::Failing,
    };
    let priority = sample_priority(level);
    let mut ctx = sample(kind, level == Some(AlertLevel::Ok), priority, check);
    // The level a live send of this kind carries, so the dot and show_when match it.
    match kind {
        NotificationKind::Incident if level != Some(AlertLevel::Ok) => {
            ctx.level = Some(match priority {
                "P1" | "P2" => AlertLevel::Critical,
                _ => AlertLevel::Warning,
            });
        }
        NotificationKind::OnCall if level != Some(AlertLevel::Ok) => {
            ctx.level = match priority {
                "P1" => Some(AlertLevel::Critical),
                "P2" => Some(AlertLevel::Warning),
                _ => None,
            };
        }
        NotificationKind::Anomaly => {
            if let Some(level) = level {
                ctx.level = Some(level);
                ctx.alert_level = level.as_str().into();
            }
        }
        _ => {}
    }
    ctx
}

/// The priority a Playground severity reads as: P1 to P4 in the order the panel lists them.
pub fn sample_priority(level: Option<AlertLevel>) -> &'static str {
    match level {
        Some(AlertLevel::Critical) => "P1",
        Some(AlertLevel::Warning) => "P2",
        None | Some(AlertLevel::Ok) => "P3",
        Some(AlertLevel::NoData) => "P4",
    }
}

fn sample(
    kind: NotificationKind,
    resolved: bool,
    priority: &str,
    check: CheckSample,
) -> NotificationContext {
    match kind {
        NotificationKind::Anomaly => anomaly_example(resolved),
        NotificationKind::Incident => incident_example(resolved, priority),
        NotificationKind::Synthetics => synthetics_example(check),
        NotificationKind::OnCall => on_call_example(resolved, priority),
        NotificationKind::Downtime => downtime_example(resolved),
        _ => {
            let level = if resolved {
                AlertLevel::Ok
            } else {
                AlertLevel::Critical
            };
            let mut ctx = super::preview::synthetic_context(Some(level));
            ctx.kind = kind;
            ctx.event = event_of(resolved);
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
        alert_trigger_time: if resolved {
            1_793_616_000_000_000
        } else {
            1_793_613_900_000_000
        },
        cluster_name: "o2-acme".into(),
        alert_start_time: "N/A".into(),
        alert_end_time: "N/A".into(),
        alert_start_time_millis: "N/A".into(),
        alert_end_time_millis: "N/A".into(),
        ..Default::default()
    }
}

fn anomaly_example(resolved: bool) -> NotificationContext {
    let link =
        "https://o2.acme.com/web/alerts/detail/a1b2c3?org_identifier=acme&tab=anomalyDetection";
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
    ctx.alert_agg_value = worst.into();
    let anomaly_score = format!("{score} vs 0.80");
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
        ("anomaly_score", &anomaly_score),
        (
            "anomaly_explore_url",
            "https://o2.acme.com/web/logs?stream_type=logs&stream=web-logs&stream_value=web-logs&from=1793612100000000&to=1793613900000000&sql_mode=true&query=U0VMRUNUICogRlJPTSAid2ViLWxvZ3MiIFdIRVJFIGxldmVsID0gJ2Vycm9yJw..&org_identifier=acme&show_histogram=true",
        ),
        ("anomaly_explore_label", "View data around the window"),
        ("window_start", start),
        ("window_end", end),
        ("anomaly_url", link),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn synthetics_example(check: CheckSample) -> NotificationContext {
    let url = "https://o2.acme.com/web/synthetics/chk_9d/results?org_identifier=acme";
    let resolved = check == CheckSample::Recovered;
    let level = match check {
        CheckSample::Recovered => AlertLevel::Ok,
        CheckSample::Degraded | CheckSample::Flaky => AlertLevel::Warning,
        CheckSample::Failing => AlertLevel::Critical,
    };
    let mut ctx = base(NotificationKind::Synthetics, resolved, level);
    ctx.stream_type = "synthetics".into();
    ctx.stream_name = String::new();
    ctx.alert_level = String::new();
    ctx.alert_name = "checkout API".into();
    ctx.alert_url = url.into();
    ctx.episode_id = Some("chk_9d".into());
    // A live degraded or flaky send is a notice, which platforms skip.
    ctx.event = match check {
        CheckSample::Degraded | CheckSample::Flaky => NotificationEvent::Informational,
        _ => event_of(resolved),
    };
    ctx.alert_trigger_time_str = "2026-11-02 10:05:00".into();
    // (state word, subject, headline, label, raw status, locations, error)
    let (state, title, description, label, status, locations, error) = match check {
        CheckSample::Recovered => (
            "recovered",
            "[OpenObserve Synthetics] ✅ checkout API has RECOVERED",
            "checkout API has recovered",
            "Recovered",
            "passed",
            "us-east-1, eu-west-1 recovered",
            "",
        ),
        CheckSample::Degraded => (
            "degraded",
            "[OpenObserve Synthetics] 🟡 checkout API is DEGRADED",
            "checkout API is degraded\nresponse took 4.2s, over the 2s limit",
            "Degraded",
            "warning",
            "1 of 2 slow: us-east-1",
            "",
        ),
        CheckSample::Flaky => (
            "flaky",
            "[OpenObserve Synthetics] 🔁 checkout API is FLAKY",
            "checkout API is flaky\n2 of the last 5 runs failed",
            "Flaky",
            "failed",
            "1 of 2 failed: us-east-1",
            "connection reset by peer",
        ),
        CheckSample::Failing => (
            "failing",
            "[OpenObserve Synthetics] 🔴 checkout API is FAILED",
            "checkout API is failing\nconnection timed out after 10s",
            "Failing",
            "failed",
            "1 of 2 failed: us-east-1",
            "connection timed out after 10s",
        ),
    };
    ctx.alert_status = state.into();
    ctx.alert_description = description.into();
    ctx.context_attributes = [
        ("check_id", "chk_9d"),
        ("check_name", "checkout API"),
        ("check_type", "http"),
        ("check_target", "https://shop.acme.com/api/health"),
        ("check_status", status),
        ("check_status_label", label),
        ("check_status_reason", ""),
        ("check_locations_line", locations),
        ("check_location_count", "2"),
        (
            "check_consecutive_failures",
            if resolved { "0" } else { "3" },
        ),
        (
            "check_flaky",
            if check == CheckSample::Flaky {
                "true"
            } else {
                "false"
            },
        ),
        (
            "check_degraded",
            if check == CheckSample::Degraded {
                "true"
            } else {
                "false"
            },
        ),
        ("check_run_id", "run_42"),
        ("check_url", url),
        ("check_error", error),
        ("check_environments", "production"),
        ("check_checked_at", "2026-11-02 10:05:00 UTC"),
        ("check_title", title),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn on_call_example(resolved: bool, priority: &str) -> NotificationContext {
    let url = "https://o2.acme.com/web/oncall/responses/resp_31?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut ctx = base(NotificationKind::OnCall, resolved, level);
    let (stage, reason, ack) = if resolved {
        ("resolved", "the incident was resolved", "")
    } else {
        (
            "1",
            "paged by policy checkout-escalation",
            "https://o2.acme.com/api/acme/oncall/ack/resp_31",
        )
    };
    // The engine's subject and plain-text page, as `render_subject` and `render_body` build them.
    ctx.alert_name = format!("[{priority}] High error rate on web-logs — checkout");
    ctx.alert_level = priority.into();
    ctx.stream_type = String::new();
    ctx.stream_name = String::new();
    ctx.alert_status = if resolved { "acknowledged" } else { "paged" }.into();
    ctx.alert_url = url.into();
    ctx.episode_id = Some("resp_31".into());
    ctx.event = event_of(resolved);
    ctx.alert_trigger_time_str = "2026-11-02 10:05:00".into();
    let ack_line = if ack.is_empty() {
        "\nAcknowledge from the incident page (no link available).\n".to_string()
    } else {
        format!("Acknowledge: {ack}\n")
    };
    ctx.alert_description = format!(
        "{priority} · High error rate on web-logs\n\n{reason} for checkout.\n\nerror rate 12.4% over the 5% threshold on checkout\n\nRunbook: https://wiki.acme.com/runbooks/checkout\n\nDetails: {url}\n{ack_line}"
    );
    ctx.context_attributes = [
        ("oncall_team", "checkout"),
        ("oncall_reason", reason),
        ("oncall_stage", stage),
        ("oncall_priority", priority),
        ("oncall_recipient", "maria@acme.com"),
        ("oncall_response_id", "resp_31"),
        ("oncall_ack_url", ack),
        ("runbook_url", "https://wiki.acme.com/runbooks/checkout"),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

/// A downtime start, or its end; platforms skip both (D8), so it has no key.
fn downtime_example(resolved: bool) -> NotificationContext {
    let url = "https://o2.acme.com/web/downtimes/dt_4k2?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Warning
    };
    let mut ctx = base(NotificationKind::Downtime, resolved, level);
    ctx.stream_type = String::new();
    ctx.stream_name = String::new();
    ctx.alert_level = String::new();
    ctx.level = None;
    ctx.alert_name = "Nightly database upgrade".into();
    ctx.alert_url = url.into();
    ctx.event = event_of(resolved);
    ctx.alert_start_time = "2026-11-02 22:00 UTC".into();
    ctx.alert_end_time = "2026-11-03 00:00 UTC".into();
    ctx.alert_trigger_time_str = if resolved {
        "2026-11-03 00:00 UTC"
    } else {
        "2026-11-02 22:00 UTC"
    }
    .into();
    ctx.alert_description = "CHG-1042 Postgres 17 upgrade".into();
    let event = if resolved { "ended" } else { "started" };
    ctx.alert_status = event.into();
    ctx.alert_trigger_time = if resolved {
        1_793_664_000_000_000
    } else {
        1_793_656_800_000_000
    };
    ctx.context_attributes = [
        ("downtime_name", "Nightly database upgrade"),
        ("downtime_event", event),
        ("downtime_reason", "CHG-1042 Postgres 17 upgrade"),
        ("downtime_starts_at", "2026-11-02 22:00 UTC"),
        ("downtime_ends_at", "2026-11-03 00:00 UTC"),
        (
            "downtime_window",
            "2026-11-02 22:00 UTC to 2026-11-03 00:00 UTC",
        ),
        ("downtime_targets", "alerts, synthetics checks"),
        ("downtime_counts", "4 alerts, 2 synthetics checks"),
        ("downtime_url", url),
    ]
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .to_vec();
    ctx
}

fn incident_example(resolved: bool, priority: &str) -> NotificationContext {
    let url = "https://o2.acme.com/web/alerts/incidents/inc_7f3a?org_identifier=acme";
    let level = if resolved {
        AlertLevel::Ok
    } else {
        AlertLevel::Critical
    };
    let mut ctx = base(NotificationKind::Incident, resolved, level);
    ctx.alert_name = "High error rate".into();
    // A live incident reads its severity as its level.
    ctx.alert_level = priority.into();
    ctx.alert_operator = ">".into();
    ctx.alert_threshold = "5".into();
    ctx.alert_agg_value = "12.4".into();
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
        ("incident_severity", priority),
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
        default_template::compiled_default_content,
        format::ChannelFormat,
        render::{RenderedMessage, render},
        resolve::resolve_content,
    };

    const EXAMPLE_ANOMALY: &str = include_str!("render/testdata/examples/anomaly.json");
    const EXAMPLE_INCIDENT: &str = include_str!("render/testdata/examples/incident.json");
    const EXAMPLE_SYNTHETICS: &str = include_str!("render/testdata/examples/synthetics.json");
    const EXAMPLE_ON_CALL: &str = include_str!("render/testdata/examples/on_call.json");
    const EXAMPLE_DOWNTIME: &str = include_str!("render/testdata/examples/downtime.json");

    fn rendered(
        kind: NotificationKind,
        resolved: bool,
        format: ChannelFormat,
    ) -> serde_json::Value {
        let ctx = example_context(kind, resolved);
        let content = resolve_content(&compiled_default_content(), &ctx, format.channel_family());
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
        let title = &want["slack_firing"]["blocks"][0]["text"]["text"];
        assert!(
            title
                .as_str()
                .unwrap()
                .contains("🔴 error rate on web-logs firing")
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
    fn golden_example_synthetics_reads_its_own_state_word() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_SYNTHETICS).unwrap();
        assert_eq!(example(NotificationKind::Synthetics), want);
        let title = &want["slack_firing"]["blocks"][0]["text"]["text"];
        assert!(title.as_str().unwrap().contains("🔴 checkout API failing"));
    }

    #[test]
    fn golden_example_on_call_keeps_todays_header_and_drops_an_unset_ack_link() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_ON_CALL).unwrap();
        assert_eq!(example(NotificationKind::OnCall), want);
        let firing = want["slack_firing"].to_string();
        assert!(
            firing.contains("[P2] High error rate on web-logs — checkout paged"),
            "{firing}"
        );
        assert!(firing.contains("Acknowledge"));
        assert!(!want["slack_resolved"].to_string().contains("oncall/ack/"));
    }

    #[test]
    fn golden_example_downtime_is_not_the_alert_sample() {
        let want: serde_json::Value = serde_json::from_str(EXAMPLE_DOWNTIME).unwrap();
        assert_eq!(example(NotificationKind::Downtime), want);
        let all = want.to_string();
        assert!(!all.contains("Sample CPU alert"), "{all}");
        assert!(all.contains("Nightly database upgrade"), "{all}");
        let ctx = example_context(NotificationKind::Downtime, false);
        assert_eq!(ctx.episode_id, None);
        let attr = |ctx: &NotificationContext| {
            ctx.context_attributes
                .iter()
                .find(|(k, _)| k == "downtime_event")
                .map(|(_, v)| v.clone())
        };
        assert_eq!(attr(&ctx).as_deref(), Some("started"));
        let ended = example_context(NotificationKind::Downtime, true);
        assert_eq!(attr(&ended).as_deref(), Some("ended"));
    }

    #[test]
    fn anomaly_recovery_hides_empty_fields() {
        let ctx = example_context(NotificationKind::Anomaly, true);
        let content = resolve_content(&compiled_default_content(), &ctx, "slack");
        let labels: Vec<&str> = content.fields.iter().map(|(l, _)| l.as_str()).collect();
        assert_eq!(labels, ["Level", "Event", "Stream", "Score", "Time"]);
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
    fn alert_example_event_follows_resolved() {
        let kind = NotificationKind::Alert;
        assert_eq!(
            example_context(kind, false).event,
            NotificationEvent::Firing
        );
        assert_eq!(
            example_context(kind, true).event,
            NotificationEvent::Resolved
        );
    }

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
            (NotificationKind::Downtime, "downtime.json"),
        ] {
            let body = serde_json::to_string_pretty(&example(kind)).unwrap() + "\n";
            std::fs::write(format!("{dir}/{file}"), body).unwrap();
        }
    }
}
