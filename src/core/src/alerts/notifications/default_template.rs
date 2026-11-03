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

//! Terminal fallback content template (design §4.4).
//!
//! `compiled_default_content` is embedded as literal Rust source rather than a
//! database row so resolution can never dead-end: a fresh org, a dangling
//! `default_alert_template` pointer, or a seeding race that hasn't run yet
//! all still resolve to *something* sensible, with no DB read on this branch
//! at all. `o2_default_content` is the seeded DB copy of the same content —
//! what most orgs actually read via their `default_alert_template` pointer —
//! kept byte-identical to this function by test.

use config::{
    DEFAULT_ORG,
    meta::{
        alerts::{
            content_spec::{ChartSpec, ContentField, ContentSpec, RowsSpec},
            notification_kind::NotificationKind,
        },
        destinations::{Template, TemplateKind, TemplateType},
    },
};
use db::alerts::templates::TemplateError;

/// Reserved name for the compiled-in default content template's seeded DB
/// copy. Joins the `prebuilt_*` reserved-name set — see
/// `is_reserved_template_name`.
pub const DEFAULT_CONTENT_TEMPLATE_NAME: &str = "o2_default_content";

/// Terminal fallback — same content as the shipped seed. Infallible by
/// construction (asserted by test), so resolution can never dead-end (§4.4).
pub fn compiled_default_content() -> ContentSpec {
    ContentSpec {
        title: "[{alert_level}] {alert_name} on {stream_name}".into(),
        title_overrides: Default::default(),
        body: "**{alert_name}** is {alert_status} for stream **{stream_name}**.\n\n{alert_description}".into(),
        fields: vec![
            ContentField {
                label: "Threshold".into(),
                value: "{alert_operator} {alert_threshold}".into(),
                show_when: None,
            },
            ContentField {
                label: "Value".into(),
                value: "{alert_agg_value}".into(),
                show_when: None,
            },
            ContentField {
                label: "Triggered".into(),
                value: "{alert_trigger_time_str}".into(),
                show_when: None,
            },
        ],
        rows: RowsSpec {
            enabled: true,
            max: 5,
            columns: None,
            format: None,
        },
        // The alert-URL link is auto-appended by resolve_content.
        links: vec![],
        chart: ChartSpec { enabled: false },
    }
}

/// The compiled default for `kind`; kinds whose stage has not shipped use the alert card.
pub fn compiled_content_for(kind: NotificationKind) -> ContentSpec {
    match kind {
        NotificationKind::Incident => compiled_incident_content(),
        NotificationKind::Anomaly => compiled_anomaly_content(),
        NotificationKind::Synthetics => compiled_synthetics_content(),
        _ => compiled_default_content(),
    }
}

/// The reserved name that `compiled_content_for(kind)` is seeded under.
pub fn compiled_name_for(kind: NotificationKind) -> &'static str {
    match kind {
        NotificationKind::Incident | NotificationKind::Anomaly | NotificationKind::Synthetics => {
            kind.compiled_default_name()
        }
        _ => DEFAULT_CONTENT_TEMPLATE_NAME,
    }
}

pub fn compiled_anomaly_content() -> ContentSpec {
    ContentSpec {
        title: "Anomaly {alert_status}: {anomaly_name} on {stream_name}".into(),
        title_overrides: Default::default(),
        body: "{alert_description}".into(),
        fields: vec![
            field("Worst value", "{worst_actual_value}"),
            field("Expected", "{worst_expected}"),
            field("Window", "{window_start} to {window_end}"),
            field("Score", "{score} vs {threshold}"),
        ],
        rows: RowsSpec {
            enabled: false,
            max: 5,
            columns: None,
            format: None,
        },
        links: vec![],
        chart: ChartSpec { enabled: false },
    }
}

/// The title is today's subject line, so a mail or SNS subject reads exactly as before.
pub fn compiled_synthetics_content() -> ContentSpec {
    ContentSpec {
        title: "{check_title}".into(),
        title_overrides: Default::default(),
        body: "{alert_description}".into(),
        fields: vec![
            field("Check", "{check_name} ({check_type})"),
            field("Target", "{check_target}"),
            field("Locations", "{check_locations_line}"),
            field("Error", "{check_error}"),
        ],
        rows: RowsSpec {
            enabled: false,
            max: 5,
            columns: None,
            format: None,
        },
        links: vec![],
        chart: ChartSpec { enabled: false },
    }
}

pub fn compiled_incident_content() -> ContentSpec {
    ContentSpec {
        title: "Incident {incident_severity}: {incident_title}".into(),
        title_overrides: Default::default(),
        body: "Incident **{incident_event}** for service **{incident_service}**.\n\n{alert_description}"
            .into(),
        fields: vec![
            field("Event", "{incident_event}"),
            field("Severity", "{incident_severity}"),
            field("Service", "{incident_service}"),
            field("Alert", "{alert_name}"),
        ],
        rows: RowsSpec {
            enabled: true,
            max: 5,
            columns: None,
            format: None,
        },
        links: vec![],
        chart: ChartSpec { enabled: false },
    }
}

fn field(label: &str, value: &str) -> ContentField {
    ContentField {
        label: label.into(),
        value: value.into(),
        show_when: None,
    }
}

/// True for template names the system reserves and manages: the
/// `prebuilt_*` family, plus `o2_default_content`. Users can never
/// create/update/delete these (root-only, same enforcement path as
/// prebuilt).
pub fn is_reserved_template_name(name: &str) -> bool {
    config::prebuilt_loader::is_prebuilt_template_name(name)
        || name.starts_with(infra::table::templates::RESERVED_PREFIX)
        || crate::alerts::templates::is_downtime_template_name(name)
}

/// Seed the read only DEFAULT_ORG copies of the compiled defaults under `should_apply_prebuilt`.
pub(crate) async fn ensure_default_content_template(
    shipped_rev: u32,
    applied_rev: u32,
) -> Result<(), anyhow::Error> {
    for kind in [
        NotificationKind::Alert,
        NotificationKind::Incident,
        NotificationKind::Anomaly,
        NotificationKind::Synthetics,
    ] {
        ensure_compiled_row(
            compiled_name_for(kind),
            &compiled_content_for(kind),
            shipped_rev,
            applied_rev,
        )
        .await?;
    }
    Ok(())
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
    use config::meta::alerts::level::AlertLevel;

    use super::*;
    use crate::alerts::notifications::{
        format::ChannelFormat, preview::synthetic_context, render::render, resolve::resolve_content,
    };

    #[test]
    fn compiled_default_parses_and_renders_everywhere() {
        for kind in NotificationKind::ALL {
            let spec = compiled_content_for(kind);
            assert!(!spec.title.is_empty());
            renders_everywhere(&spec);
        }
    }

    fn renders_everywhere(spec: &ContentSpec) {
        let ctx = synthetic_context(None);
        // Every channel format must render the compiled-in default without
        // error — this is the terminal fallback (see module doc comment),
        // so it can never be the thing that dead-ends a notification.
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
            let content = resolve_content(spec, &ctx, f.channel_family());
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
    fn o2_default_content_is_reserved() {
        assert!(is_reserved_template_name("o2_default_content"));
        assert!(is_reserved_template_name("o2_default_anomaly"));
        assert!(is_reserved_template_name("o2_default_incident"));
        assert!(is_reserved_template_name("prebuilt_slack"));
        assert!(is_reserved_template_name("o2_default_synthetics"));
        assert!(is_reserved_template_name("o2_default_on_call"));
        assert!(!is_reserved_template_name("user_o2_default_anomaly"));
        assert!(!is_reserved_template_name("my_template"));
    }
}
