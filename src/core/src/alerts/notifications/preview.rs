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

//! Template preview: post a draft `ContentSpec` and get back the real wire
//! payload plus a normalized FE rendering schema, for any supported channel.
//!
//! **Central requirement:** preview MUST share the same code path as the
//! send path — this module calls the exact same [`resolve_content`] +
//! [`render`] functions Task 9's `send_notification` calls, never a
//! reimplementation. See `preview_uses_production_renderer` below.

use config::meta::alerts::{content_spec::ContentSpec, level::AlertLevel};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    context::NotificationContext,
    format::ChannelFormat,
    render::{RenderedMessage, markdown::markdown_to_html, render, severity_color},
    resolve::resolve_content,
};

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct PreviewRequest {
    pub definition: ContentSpec,
    /// "slack" | "teams_adaptivecard" | "teams_messagecard" | "email" |
    /// "webhook" | "discord" | "pagerduty" | "opsgenie" | "servicenow" | "sns"
    pub channel: String,
    /// "critical" | "warning" | "ok" | "no_data" | "single_level" (default)
    #[serde(default)]
    pub severity: Option<String>,
    /// Reserved for the Phase-1b alert-driven sample source; ignored in 1a.
    #[serde(default)]
    pub sample: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PreviewResponse {
    /// The real wire payload (raw tab).
    pub payload: serde_json::Value,
    /// FE card rendering schema.
    pub preview_model: PreviewModel,
    pub unknown_variables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PreviewModel {
    pub title: String,
    /// Server-rendered markdown; the FE sanitizes with dompurify.
    pub body_html: String,
    pub fields: Vec<PreviewKv>,
    pub links: Vec<PreviewLink>,
    /// Severity color hex.
    pub color: String,
    pub severity: Option<String>,
    pub footer: String,
    pub chart_placeholder: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PreviewKv {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PreviewLink {
    pub label: String,
    pub url: String,
}

/// Error mapped to HTTP 400 by the handler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewError {
    UnknownChannel(String),
    UnknownSeverity(String),
    RenderFailed(String),
    /// Draft fails the same content validation `templates::save` applies.
    InvalidContent(String),
}

impl std::fmt::Display for PreviewError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownChannel(c) => write!(f, "unknown channel: {c}"),
            Self::UnknownSeverity(s) => write!(
                f,
                "unknown severity: {s} (expected critical, warning, ok, no_data, or single_level)"
            ),
            Self::RenderFailed(e) => write!(f, "preview render failed: {e}"),
            Self::InvalidContent(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PreviewError {}

/// Map the wire channel string to [`ChannelFormat`].
fn parse_channel(channel: &str) -> Result<ChannelFormat, PreviewError> {
    match channel {
        "slack" => Ok(ChannelFormat::Slack),
        "teams_adaptivecard" => Ok(ChannelFormat::TeamsAdaptiveCard),
        "teams_messagecard" => Ok(ChannelFormat::TeamsMessageCard),
        "email" => Ok(ChannelFormat::Email),
        "webhook" => Ok(ChannelFormat::Webhook),
        "discord" => Ok(ChannelFormat::Discord),
        "pagerduty" => Ok(ChannelFormat::PagerDuty),
        "opsgenie" => Ok(ChannelFormat::Opsgenie),
        "servicenow" => Ok(ChannelFormat::ServiceNow),
        "sns" => Ok(ChannelFormat::Sns),
        other => Err(PreviewError::UnknownChannel(other.to_string())),
    }
}

/// Map the wire severity string to `Option<AlertLevel>`. Absent, empty, or
/// `"single_level"` all mean "no severity axis" (`None`) — design §4.2.1.
fn parse_severity(severity: &Option<String>) -> Result<Option<AlertLevel>, PreviewError> {
    match severity.as_deref() {
        None | Some("single_level") | Some("") => Ok(None),
        Some("critical") => Ok(Some(AlertLevel::Critical)),
        Some("warning") => Ok(Some(AlertLevel::Warning)),
        Some("ok") => Ok(Some(AlertLevel::Ok)),
        Some("no_data") => Ok(Some(AlertLevel::NoData)),
        // A typo'd severity must not silently become "no severity axis" — that
        // would render a preview the caller did not ask for and mask a client
        // bug. Same rule as an unknown channel: reject it.
        Some(other) => Err(PreviewError::UnknownSeverity(other.to_string())),
    }
}

/// Deterministic fixture context for previews — no search, no DB lookups, no
/// URL shortening. Fixed sample rows and timestamps so the same request
/// always previews identically.
pub fn synthetic_context(level: Option<AlertLevel>) -> NotificationContext {
    let alert_level_str = match level {
        Some(AlertLevel::Critical) => "critical",
        Some(AlertLevel::Warning) => "warning",
        Some(AlertLevel::Ok) => "ok",
        Some(AlertLevel::NoData) => "no_data",
        None => "",
    }
    .to_string();

    NotificationContext {
        org_name: "default".into(),
        stream_type: "logs".into(),
        stream_name: "app_logs".into(),
        alert_name: "Sample CPU alert".into(),
        alert_type: "scheduled".into(),
        alert_period: "10".into(),
        alert_operator: ">=".into(),
        alert_threshold: "80".into(),
        alert_count: "2".into(),
        alert_agg_value: "92.5".into(),
        alert_level: alert_level_str,
        alert_priority: "P1".into(),
        alert_tags: "infra, prod".into(),
        alert_threshold_crit: "90".into(),
        alert_threshold_warn: "80".into(),
        alert_start_time: "2026-08-01T10:00:00".into(),
        alert_end_time: "2026-08-01T10:10:00".into(),
        alert_url: "https://example.openobserve.ai/alerts/sample".into(),
        alert_trigger_time: 1_754_000_000_000_000,
        alert_trigger_time_str: "2026-08-01T10:10:00".into(),
        alert_description: "cpu > 80 for 10m".into(),
        promql_operator: None,
        promql_value: None,
        rows: vec![
            serde_json::from_str(r#"{"host":"web-1","cpu":92.5}"#).unwrap(),
            serde_json::from_str(r#"{"host":"web-2","cpu":88.1}"#).unwrap(),
        ],
        rows_tpl_val: vec![
            serde_json::json!("web-1 92.5"),
            serde_json::json!("web-2 88.1"),
        ],
        row_columns: vec![
            ("host".into(), vec!["web-1".into(), "web-2".into()]),
            ("cpu".into(), vec!["92.5".into(), "88.1".into()]),
        ],
        context_attributes: vec![],
        metadata: vec![],
        group_labels: None,
        level,
        chart_url: None,
        chart_png: None,
    }
}

/// Preview a draft `ContentSpec` for one channel, sharing the exact
/// `resolve_content` + `render` code path the send path uses.
pub fn preview(req: &PreviewRequest) -> Result<PreviewResponse, PreviewError> {
    let format = parse_channel(&req.channel)?;
    let level = parse_severity(&req.severity)?;

    // Hold the draft to the same bar `templates::save` applies. Previewing a
    // spec that cannot be saved would report it as fine and defer the error
    // to the save click — and `preview_model.links` echoes the raw authored
    // URL back to the UI, so it must not carry a hostile scheme either.
    req.definition
        .validate()
        .map_err(PreviewError::InvalidContent)?;

    let ctx = synthetic_context(level);

    let content = resolve_content(&req.definition, &ctx, format.channel_family());
    let rendered =
        render(format, &content, &ctx).map_err(|e| PreviewError::RenderFailed(e.to_string()))?;

    let payload = match &rendered {
        RenderedMessage::Http { body } => {
            serde_json::from_str(body).unwrap_or(serde_json::Value::Null)
        }
        RenderedMessage::Email {
            subject,
            html,
            text,
        } => serde_json::json!({ "subject": subject, "html": html, "text": text }),
        RenderedMessage::Sns { subject, message } => {
            serde_json::json!({ "subject": subject, "message": message })
        }
    };

    let footer = content
        .links
        .iter()
        .find(|(label, _)| label.is_empty())
        .map(|(_, url)| url.clone())
        .unwrap_or_default();

    let preview_model = PreviewModel {
        title: content.title.clone(),
        body_html: markdown_to_html(&content.body_markdown),
        fields: content
            .fields
            .iter()
            .map(|(label, value)| PreviewKv {
                label: label.clone(),
                value: value.clone(),
            })
            .collect(),
        links: content
            .links
            .iter()
            .filter(|(label, _)| !label.is_empty())
            .map(|(label, url)| PreviewLink {
                label: label.clone(),
                url: url.clone(),
            })
            .collect(),
        color: severity_color(level).to_string(),
        severity: req.severity.clone(),
        footer,
        chart_placeholder: req.definition.chart.enabled,
    };

    Ok(PreviewResponse {
        payload,
        preview_model,
        unknown_variables: content.unknown_variables,
    })
}

#[cfg(test)]
fn sample_spec() -> ContentSpec {
    ContentSpec {
        title: "{alert_name} fired".into(),
        body: "**{alert_name}** exceeded threshold at {alert_agg_value}".into(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::content_spec::{ContentField, ContentLink, SeverityFilter};

    use super::*;

    /// A draft whose link scheme `save` would reject must be rejected here
    /// too. Previewing it cleanly and only failing on save teaches the author
    /// the template is fine when it is not (#13742).
    #[test]
    fn preview_rejects_a_draft_the_save_path_would_reject() {
        let mut spec = sample_spec();
        spec.links.push(ContentLink {
            label: "click".into(),
            url: "javascript:alert(1)".into(),
            show_when: None,
        });
        let req = PreviewRequest {
            definition: spec,
            channel: "slack".into(),
            severity: Some("critical".into()),
            sample: None,
        };
        let err = preview(&req).expect_err("hostile link previewed cleanly");
        assert!(
            err.to_string().contains("click"),
            "error should name the offending link, got: {err}"
        );
    }

    #[test]
    fn preview_uses_production_renderer() {
        let req = PreviewRequest {
            definition: sample_spec(),
            channel: "slack".into(),
            severity: Some("critical".into()),
            sample: None,
        };
        let resp = preview(&req).unwrap();
        // Same payload the send path would produce for the same spec +
        // synthetic ctx: reconstruct it directly via resolve_content/render.
        let ctx = synthetic_context(Some(AlertLevel::Critical));
        let content = resolve_content(&req.definition, &ctx, "slack");
        let RenderedMessage::Http { body } = render(ChannelFormat::Slack, &content, &ctx).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            resp.payload,
            serde_json::from_str::<serde_json::Value>(&body).unwrap()
        );
    }

    #[test]
    fn severity_picker_drives_show_when() {
        let mut spec = sample_spec();
        spec.fields.push(ContentField {
            label: "runbook".into(),
            value: "x".into(),
            show_when: Some(SeverityFilter {
                levels: vec![AlertLevel::Critical],
            }),
        });
        let crit = preview(&PreviewRequest {
            definition: spec.clone(),
            channel: "slack".into(),
            severity: Some("critical".into()),
            sample: None,
        })
        .unwrap();
        assert!(
            crit.preview_model
                .fields
                .iter()
                .any(|f| f.label == "runbook")
        );
        // "single_level" (default) → level None → show_when field vanishes
        // (§4.2.1).
        let single = preview(&PreviewRequest {
            definition: spec,
            channel: "slack".into(),
            severity: None,
            sample: None,
        })
        .unwrap();
        assert!(
            !single
                .preview_model
                .fields
                .iter()
                .any(|f| f.label == "runbook")
        );
    }

    #[test]
    fn unknown_variables_reported() {
        let mut spec = sample_spec();
        spec.body = "{alert_name} {alert_time_zzz}".into();
        let resp = preview(&PreviewRequest {
            definition: spec,
            channel: "webhook".into(),
            severity: None,
            sample: None,
        })
        .unwrap();
        assert_eq!(resp.unknown_variables, vec!["alert_time_zzz"]);
    }

    #[test]
    fn typo_severity_is_rejected_not_silently_downgraded() {
        // A typo must not quietly render as "no severity axis" — that would
        // show the user a preview they did not ask for and hide a client bug.
        let err = preview(&PreviewRequest {
            definition: sample_spec(),
            channel: "slack".into(),
            severity: Some("criticall".into()),
            sample: None,
        })
        .unwrap_err();
        assert!(matches!(err, PreviewError::UnknownSeverity(ref s) if s == "criticall"));

        // Absence, the explicit sentinel, and empty string are the three
        // documented spellings of "single-level" and must render identically —
        // note `preview_model.severity` echoes the request string verbatim, so
        // compare the rendered payload rather than that field.
        let mut payloads = vec![];
        for ok in [None, Some("single_level".to_string()), Some(String::new())] {
            let resp = preview(&PreviewRequest {
                definition: sample_spec(),
                channel: "slack".into(),
                severity: ok,
                sample: None,
            })
            .expect("documented severity values must be accepted");
            payloads.push(resp.payload);
        }
        assert_eq!(payloads[0], payloads[1]);
        assert_eq!(payloads[1], payloads[2]);
    }
}
