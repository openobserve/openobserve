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

//! Each shared path of a scheduled alert against fixtures that main's code wrote.
//! `O2_CAPTURE_MAIN_COMPAT=1` rewrites them; run it only on a checkout of main's files.

use config::meta::alerts::{
    content_spec::ContentSpec, level::AlertLevel, notification_kind::NotificationKind,
};

use super::{
    ChannelFormat, NotificationContext,
    chart::{payload::ChartPayload, render::render_png},
    custom::apply_custom_template,
    default_template::compiled_default_content,
    render::{RenderedMessage, render},
    resolve::resolve_content,
};

const DIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/alerts/notifications/render/testdata/main_compat"
);
const FORMATS: [ChannelFormat; 10] = [
    ChannelFormat::Slack,
    ChannelFormat::TeamsAdaptiveCard,
    ChannelFormat::TeamsMessageCard,
    ChannelFormat::Discord,
    ChannelFormat::PagerDuty,
    ChannelFormat::Opsgenie,
    ChannelFormat::ServiceNow,
    ChannelFormat::Email,
    ChannelFormat::Sns,
    ChannelFormat::Webhook,
];
/// The variables this branch added; another kind reads each as empty, where main shows "–".
const NEW_VARIABLES: [&str; 7] = [
    "anomaly_headline",
    "expected_lower",
    "expected_upper",
    "value_change_percent",
    "anomaly_started",
    "anomaly_bucket",
    "chart_url",
];

fn capturing() -> bool {
    std::env::var("O2_CAPTURE_MAIN_COMPAT").is_ok_and(|v| v == "1")
}

/// Writes the fixture on capture, else returns main's output.
fn fixture(name: &str, output: &[u8]) -> Vec<u8> {
    let path = format!("{DIR}/{name}");
    if capturing() {
        std::fs::create_dir_all(DIR).unwrap();
        std::fs::write(&path, output).unwrap();
    }
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn scheduled_ctx() -> NotificationContext {
    let mut row = serde_json::Map::new();
    row.insert("host".into(), "web-1".into());
    row.insert("expected_lower".into(), "10".into());
    row.insert("expected_upper".into(), "20".into());
    row.insert("anomaly_score".into(), "0.97".into());
    NotificationContext {
        org_name: "acme".into(),
        stream_type: "logs".into(),
        stream_name: "web-logs".into(),
        alert_name: "error rate on web-logs".into(),
        alert_type: "scheduled".into(),
        alert_period: "10".into(),
        alert_operator: ">=".into(),
        alert_threshold: "5".into(),
        alert_count: "12".into(),
        alert_agg_value: "12".into(),
        alert_level: "critical".into(),
        alert_status: "firing".into(),
        alert_url: "https://o2.acme.com/web/logs?stream=web-logs&org_identifier=acme".into(),
        alert_url_label: "View logs".into(),
        alert_detail_url: "https://o2.acme.com/web/alerts/detail/a1?org_identifier=acme".into(),
        alert_detail_label: "Open alert".into(),
        alert_trigger_time: 1_793_613_900_000_000,
        alert_trigger_time_str: "2026-11-02T10:05:00Z".into(),
        alert_description: "Errors over the threshold".into(),
        rows: vec![row],
        row_columns: vec![
            ("host".into(), vec!["web-1".into()]),
            ("expected_lower".into(), vec!["10".into()]),
            ("expected_upper".into(), vec!["20".into()]),
            ("anomaly_score".into(), vec!["0.97".into()]),
        ],
        level: Some(AlertLevel::Critical),
        kind: NotificationKind::Alert,
        cluster_name: "dev".into(),
        ..Default::default()
    }
}

fn rendered(spec: &ContentSpec, ctx: &NotificationContext) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    for format in FORMATS {
        let content = resolve_content(spec, ctx, format.channel_family());
        let value = match render(format, &content, ctx) {
            Ok(RenderedMessage::Http { body }) => serde_json::from_str(&body).unwrap(),
            Ok(RenderedMessage::Email {
                subject,
                html,
                text,
            }) => serde_json::json!({"subject": subject, "html": html, "text": text}),
            Ok(RenderedMessage::Sns { subject, message }) => {
                serde_json::json!({"subject": subject, "message": message})
            }
            Err(e) => serde_json::json!({"error": e.to_string()}),
        };
        out.insert(format!("{format:?}"), value);
    }
    serde_json::Value::Object(out)
}

fn pretty(v: &serde_json::Value) -> Vec<u8> {
    (serde_json::to_string_pretty(v).unwrap() + "\n").into_bytes()
}

#[test]
fn a_scheduled_alert_through_the_default_template_matches_main() {
    let ctx = scheduled_ctx();
    let got = pretty(&rendered(&compiled_default_content(), &ctx));
    assert_eq!(
        String::from_utf8(got.clone()).unwrap(),
        String::from_utf8(fixture("default_content.json", &got)).unwrap()
    );
}

#[test]
fn a_content_template_of_another_kind_matches_main_but_the_new_names() {
    let marker = |i: usize| format!("n{i}");
    let body = NEW_VARIABLES
        .iter()
        .enumerate()
        .map(|(i, v)| format!("{}=[{{{v}}}]", marker(i)))
        .collect::<Vec<_>>()
        .join(" ");
    let spec: ContentSpec = serde_json::from_value(serde_json::json!({
        "title": "{alert_name} {alert_status}",
        "body": format!("{{alert_description}} {body} score=[{{anomaly_score}}]"),
        "fields": [{"label": "Host", "value": "{host}"}],
    }))
    .unwrap();
    let got = pretty(&rendered(&spec, &scheduled_ctx()));
    let main = String::from_utf8(fixture("other_kind_content.json", &got)).unwrap();
    let mut want = main.clone();
    // Markdown escapes the brackets, and JSON escapes that backslash again.
    for i in 0..NEW_VARIABLES.len() {
        let m = marker(i);
        for (open, close) in [("[", "]"), ("\\\\[", "\\\\]")] {
            want = want.replace(
                &format!("{m}={open}–{close}"),
                &format!("{m}={open}{close}"),
            );
        }
    }
    assert!(
        capturing() || want != main,
        "main shows a marker for the new names"
    );
    assert_eq!(String::from_utf8(got).unwrap(), want);
}

#[test]
fn a_scheduled_custom_template_matches_main() {
    let tpl = r#"{"text":"{alert_name} {alert_status} {alert_agg_value} {host} {chart_url} {anomaly_headline} {alert_url}"}"#;
    let ctx = scheduled_ctx();
    let got = [
        apply_custom_template(tpl, &ctx, false),
        apply_custom_template("{alert_name} {chart_url} {expected_lower}", &ctx, true),
    ]
    .join("\n")
        + "\n";
    assert_eq!(
        got,
        String::from_utf8(fixture("scheduled_custom.txt", got.as_bytes())).unwrap()
    );
}

#[test]
fn a_scheduled_chart_with_a_lone_point_matches_main() {
    let t0 = 1_793_610_000u64;
    let mut points: Vec<(u64, f64)> = (0..10).map(|i| (t0 + i * 60, 3.0 + i as f64)).collect();
    points.push((t0 + 9 * 60 + 600, 9.0));
    points.extend((0..10).map(|i| (t0 + 9 * 60 + 1_200 + i * 60, 4.0 + i as f64 * 0.5)));
    let payload: ChartPayload = serde_json::from_value(serde_json::json!({
        "v": 1,
        "exp": 2_000_000_000u64,
        "title": "error rate on web-logs",
        "points": points,
        "crit": 12.0,
        "warn": 8.0,
        "trigger_ts": t0 + 9 * 60 + 1_740,
    }))
    .unwrap();
    let got = render_png(&payload).unwrap();
    assert!(
        got == fixture("scheduled_chart.png", &got),
        "the PNG differs from main"
    );
}
