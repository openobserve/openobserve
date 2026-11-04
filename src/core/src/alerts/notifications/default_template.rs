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

//! The one compiled default every kind falls back to (amendment A, D3).
//!
//! It is literal Rust rather than a database row, so resolution never dead-ends on a fresh
//! org or a seeding race. `o2_default` is its seeded read only copy, kept identical by test.
//! A field whose variables are blank for a kind hides, so each kind shows only its own facts.

use config::{
    DEFAULT_ORG,
    meta::{
        alerts::content_spec::{ChartSpec, ContentField, ContentSpec, RowsSpec},
        destinations::{Template, TemplateKind, TemplateType},
    },
};
use db::alerts::templates::TemplateError;

/// Reserved name of the compiled default's seeded copy.
pub const DEFAULT_CONTENT_TEMPLATE_NAME: &str = infra::table::templates::DEFAULT_TEMPLATE_NAME;

/// The field superset in the amendment's order; Slack shows at most ten, and no kind fills more.
const FIELDS: [(&str, &str); 17] = [
    ("Level", "{alert_level_label}"),
    ("Event", "{notification_event_label}"),
    ("Stream", "{stream_name}"),
    ("Threshold", "{alert_operator} {alert_threshold}"),
    ("Value", "{alert_agg_value}"),
    ("Score", "{anomaly_score}"),
    ("Check", "{check_name} ({check_type})"),
    ("Target", "{check_target}"),
    ("Status", "{check_status_label}"),
    ("Locations", "{check_locations_line}"),
    ("Environments", "{check_environments}"),
    ("Error", "{check_error}"),
    ("Window", "{downtime_window}"),
    ("Muted", "{downtime_targets}"),
    ("Team", "{oncall_team}"),
    ("Reason", "{oncall_reason}"),
    ("Time", "{alert_trigger_time_utc}"),
];

/// Terminal fallback, infallible by construction (asserted by test).
pub fn compiled_default_content() -> ContentSpec {
    ContentSpec {
        title: "{status_dot} {alert_name} is {alert_status}".into(),
        title_overrides: Default::default(),
        body: "{alert_description}".into(),
        fields: FIELDS
            .iter()
            .map(|(label, value)| ContentField {
                label: (*label).into(),
                value: (*value).into(),
                show_when: None,
            })
            .collect(),
        rows: RowsSpec {
            enabled: true,
            max: 5,
            columns: None,
            format: None,
        },
        // resolve_content appends the View in OpenObserve link to alert_url.
        links: vec![],
        chart: ChartSpec { enabled: false },
    }
}

/// The `prebuilt_*` family, `o2_default` and its prefix, and the retired names: system owned.
pub fn is_reserved_template_name(name: &str) -> bool {
    config::prebuilt_loader::is_prebuilt_template_name(name)
        || infra::table::templates::is_reserved_default_name(name)
        || infra::table::templates::RETIRED_DEFAULT_NAMES.contains(&name)
}

/// Seed the read only DEFAULT_ORG copy of the compiled default under `should_apply_prebuilt`.
pub(crate) async fn ensure_default_content_template(
    shipped_rev: u32,
    applied_rev: u32,
) -> Result<(), anyhow::Error> {
    ensure_compiled_row(
        DEFAULT_CONTENT_TEMPLATE_NAME,
        &compiled_default_content(),
        shipped_rev,
        applied_rev,
    )
    .await
}

async fn ensure_compiled_row(
    name: &str,
    spec: &ContentSpec,
    shipped_rev: u32,
    applied_rev: u32,
) -> Result<(), anyhow::Error> {
    let body = serde_json::to_string(spec)?;
    let mut template = Template {
        id: None,
        org_id: DEFAULT_ORG.to_string(),
        name: name.to_string(),
        is_default: false,
        template_type: TemplateType::Http,
        body: body.clone(),
        kind: TemplateKind::Content,
        applies_to: Vec::new(),
    };

    match db::alerts::templates::get(DEFAULT_ORG, name).await {
        Ok(existing) => {
            let drifted = existing.body != body || existing.template_type != TemplateType::Http;
            if super::super::templates::should_apply_prebuilt(shipped_rev, applied_rev, drifted)
                && drifted
            {
                template.id = existing.id;
                db::alerts::templates::set(template).await?;
                log::info!("[TEMPLATES] Updated system template '{name}' in {DEFAULT_ORG}");
            }
        }
        Err(TemplateError::NotFound) => {
            db::alerts::templates::set(template).await?;
            log::info!("[TEMPLATES] Created system template '{name}' in {DEFAULT_ORG}");
        }
        Err(e) => {
            log::error!(
                "[TEMPLATES] Error checking system template '{name}' in {DEFAULT_ORG}: {e}"
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::{level::AlertLevel, notification_kind::NotificationKind};

    use super::*;
    use crate::alerts::notifications::{
        examples::example_context, format::ChannelFormat, preview::synthetic_context,
        render::render, resolve::resolve_content,
    };

    #[test]
    fn compiled_default_parses_and_renders_everywhere() {
        let spec = compiled_default_content();
        let ctx = synthetic_context(None);
        // The terminal fallback can never be the thing that dead-ends a notification.
        for f in [
            ChannelFormat::Slack,
            ChannelFormat::TeamsAdaptiveCard,
            ChannelFormat::TeamsMessageCard,
            ChannelFormat::Email,
            ChannelFormat::Webhook,
            ChannelFormat::Discord,
            ChannelFormat::PagerDuty,
            ChannelFormat::Opsgenie,
            ChannelFormat::ServiceNow,
            ChannelFormat::Sns,
        ] {
            let content = resolve_content(&spec, &ctx, f.channel_family());
            assert!(render(f, &content, &ctx).is_ok(), "{f:?}");
        }
    }

    #[test]
    fn compiled_default_renders_for_every_severity_level() {
        let spec = compiled_default_content();
        for level in [
            None,
            Some(AlertLevel::Critical),
            Some(AlertLevel::Warning),
            Some(AlertLevel::Ok),
            Some(AlertLevel::NoData),
        ] {
            let ctx = synthetic_context(level);
            let content = resolve_content(&spec, &ctx, "webhook");
            assert!(
                render(ChannelFormat::Webhook, &content, &ctx).is_ok(),
                "{level:?}"
            );
        }
    }

    #[test]
    fn each_kind_shows_only_its_own_fields_under_ten() {
        let labels = |kind: NotificationKind| -> Vec<String> {
            let ctx = example_context(kind, false);
            let content = resolve_content(&compiled_default_content(), &ctx, "slack");
            assert!(content.unknown_variables.is_empty(), "{kind:?}");
            content.fields.into_iter().map(|(label, _)| label).collect()
        };
        use NotificationKind::*;
        let want: [(NotificationKind, &[&str]); 6] = [
            (
                Alert,
                &["Level", "Event", "Stream", "Threshold", "Value", "Time"],
            ),
            (
                Incident,
                &["Level", "Event", "Stream", "Threshold", "Value", "Time"],
            ),
            (
                Anomaly,
                &["Level", "Event", "Stream", "Value", "Score", "Time"],
            ),
            (
                Synthetics,
                &[
                    "Event",
                    "Check",
                    "Target",
                    "Status",
                    "Locations",
                    "Environments",
                    "Error",
                    "Time",
                ],
            ),
            (Downtime, &["Event", "Window", "Muted", "Time"]),
            (OnCall, &["Level", "Event", "Team", "Reason", "Time"]),
        ];
        for (kind, fields) in want {
            assert_eq!(labels(kind), fields, "{kind:?}");
        }
    }

    #[test]
    fn o2_default_and_the_retired_names_are_reserved() {
        for name in [
            "o2_default",
            "o2_default_content",
            "o2_default_anomaly",
            "o2_default_x",
            "prebuilt_downtime",
            "prebuilt_downtime_email",
            "prebuilt_slack",
        ] {
            assert!(is_reserved_template_name(name), "{name}");
        }
        assert!(!is_reserved_template_name("user_o2_default_anomaly"));
        assert!(!is_reserved_template_name("o2_defaults"));
        assert!(!is_reserved_template_name("my_template"));
    }
}
