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
        alerts::content_spec::{ChartSpec, ContentField, ContentSpec, RowsSpec},
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
        body: "**{alert_name}** fired for stream **{stream_name}**.\n\n{alert_description}".into(),
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

/// True for template names the system reserves and manages: the
/// `prebuilt_*` family, plus `o2_default_content`. Users can never
/// create/update/delete these (root-only, same enforcement path as
/// prebuilt).
pub fn is_reserved_template_name(name: &str) -> bool {
    config::prebuilt_loader::is_prebuilt_template_name(name)
        || name == DEFAULT_CONTENT_TEMPLATE_NAME
}

/// Create-if-missing (and overwrite under the same `should_apply_prebuilt`
/// rule as the prebuilt loop) the seeded DB copy of the compiled default in
/// DEFAULT_ORG. Called from `ensure_system_templates`, inside the same
/// dist_lock + revision gate, after the prebuilt loop.
pub(crate) async fn ensure_default_content_template(
    shipped_rev: u32,
    applied_rev: u32,
) -> Result<(), anyhow::Error> {
    let spec = compiled_default_content();
    let body = serde_json::to_string(&spec)?;

    let mut template = Template {
        id: None,
        org_id: DEFAULT_ORG.to_string(),
        name: DEFAULT_CONTENT_TEMPLATE_NAME.to_string(),
        is_default: false,
        template_type: TemplateType::Http,
        body: body.clone(),
        kind: TemplateKind::Content,
    };

    match db::alerts::templates::get(DEFAULT_ORG, DEFAULT_CONTENT_TEMPLATE_NAME).await {
        Ok(existing) => {
            let drifted = existing.body != body || existing.template_type != TemplateType::Http;
            if super::super::templates::should_apply_prebuilt(shipped_rev, applied_rev, drifted)
                && drifted
            {
                template.id = existing.id;
                db::alerts::templates::set(template).await?;
                log::info!(
                    "[TEMPLATES] Updated system template '{DEFAULT_CONTENT_TEMPLATE_NAME}' in {DEFAULT_ORG}"
                );
            }
        }
        Err(TemplateError::NotFound) => {
            db::alerts::templates::set(template).await?;
            log::info!(
                "[TEMPLATES] Created system template '{DEFAULT_CONTENT_TEMPLATE_NAME}' in {DEFAULT_ORG}"
            );
        }
        Err(e) => {
            log::error!(
                "[TEMPLATES] Error checking system template '{DEFAULT_CONTENT_TEMPLATE_NAME}': {e}"
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
        let spec = compiled_default_content();
        assert!(!spec.title.is_empty());
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
    fn o2_default_content_is_reserved() {
        assert!(is_reserved_template_name("o2_default_content"));
        assert!(is_reserved_template_name("prebuilt_slack"));
        assert!(!is_reserved_template_name("my_template"));
    }
}
