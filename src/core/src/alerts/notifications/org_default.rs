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

//! Picks the template for one send: the producer's override, then the destination's
//! template when it applies to the kind, then the compiled `prebuilt_default`.

use config::meta::{
    alerts::notification_kind::NotificationKind,
    destinations::{DestinationType, Template, TemplateKind, TemplateType},
};

use super::default_template::{
    DEFAULT_CONTENT_TEMPLATE_NAME, compiled_default_content, is_reserved_template_name,
};

/// A producer's level 1 override by name; a missing one falls through to the next level.
pub async fn load_override(org_id: &str, name: Option<&str>) -> Vec<Template> {
    let Some(name) = name.filter(|n| !n.is_empty()) else {
        return Vec::new();
    };
    match db::alerts::templates::get(org_id, name).await {
        Ok(t) => vec![t],
        Err(e) => {
            log::warn!("[TEMPLATES] template override '{name}' in {org_id} not found: {e}");
            Vec::new()
        }
    }
}

/// Which precedence level supplied the template (Backend section 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TemplateSource {
    Explicit,
    Destination,
    Compiled,
}

impl TemplateSource {
    /// The `template_source` value the send log line carries.
    pub fn as_str(self) -> &'static str {
        match self {
            TemplateSource::Explicit => "explicit",
            TemplateSource::Destination => "destination",
            TemplateSource::Compiled => "compiled",
        }
    }
}

#[derive(Clone, Debug)]
pub struct EffectiveTemplate {
    pub template: Template,
    pub source: TemplateSource,
    /// Levels passed over, with the reason, in the order they were tried.
    pub skipped: Vec<(TemplateSource, String)>,
}

impl EffectiveTemplate {
    pub fn template(&self) -> &Template {
        &self.template
    }

    /// `template_skipped` as the send log line carries it.
    pub fn skipped_json(&self) -> String {
        let list: Vec<serde_json::Value> = self
            .skipped
            .iter()
            .map(|(source, reason)| {
                serde_json::json!({ "level": source.as_str(), "reason": reason })
            })
            .collect();
        serde_json::Value::Array(list).to_string()
    }
}

/// Not a reserved row (`prebuilt_*`, `prebuilt_default`).
pub fn is_user_template(t: &Template) -> bool {
    !is_reserved_template_name(&t.name)
}

/// Level 2 (D2): alerts keep any destination template; other kinds need a user one that applies.
pub fn destination_template_applies(t: &Template, kind: NotificationKind) -> bool {
    kind == NotificationKind::Alert || (is_user_template(t) && t.applies_to_kind(kind))
}

/// A Content template fits every transport; a Custom one only its own (Http, Email, Sns).
pub fn fits_transport(t: &Template, dt: &DestinationType) -> bool {
    match t.kind {
        TemplateKind::Content => true,
        TemplateKind::Custom => matches!(
            (&t.template_type, dt),
            (
                TemplateType::Http,
                DestinationType::Http(_) | DestinationType::SlackApp(_)
            ) | (TemplateType::Email { .. }, DestinationType::Email(_))
                | (TemplateType::Sns, DestinationType::Sns(_))
        ),
    }
}

/// The alert path's resolution: `explicit` is what `choose_template` already picked.
pub fn resolve_effective_template(org_id: &str, explicit: Option<Template>) -> EffectiveTemplate {
    let explicit: Vec<Template> = explicit.into_iter().collect();
    resolve_effective_template_for(org_id, NotificationKind::Alert, &explicit, None, None)
}

/// Walk the three levels for one send; the alert path passes no `dt` and skips the transport rule.
pub fn resolve_effective_template_for(
    org_id: &str,
    kind: NotificationKind,
    explicit: &[Template],
    dest_template: Option<Template>,
    dt: Option<&DestinationType>,
) -> EffectiveTemplate {
    let mut skipped = Vec::new();
    match choose_explicit_or_destination(kind, explicit, dest_template, dt, &mut skipped) {
        Some((template, source)) => EffectiveTemplate {
            template,
            source,
            skipped,
        },
        None => EffectiveTemplate {
            template: compiled_fallback(org_id),
            source: TemplateSource::Compiled,
            skipped,
        },
    }
}

/// Levels 1 and 2; `None` sends the caller on to the compiled default with `skipped` filled.
pub fn choose_explicit_or_destination(
    kind: NotificationKind,
    explicit: &[Template],
    dest_template: Option<Template>,
    dt: Option<&DestinationType>,
    skipped: &mut Vec<(TemplateSource, String)>,
) -> Option<(Template, TemplateSource)> {
    let fits = |t: &Template| dt.is_none_or(|dt| fits_transport(t, dt));
    for t in explicit {
        if fits(t) {
            return Some((t.clone(), TemplateSource::Explicit));
        }
        skipped.push((
            TemplateSource::Explicit,
            format!("{}: transport_mismatch", t.name),
        ));
    }
    let t = dest_template?;
    if !destination_template_applies(&t, kind) {
        let reason = if is_user_template(&t) {
            "not_applicable"
        } else {
            "reserved"
        };
        skipped.push((TemplateSource::Destination, format!("{}: {reason}", t.name)));
        return None;
    }
    if !fits(&t) {
        skipped.push((
            TemplateSource::Destination,
            format!("{}: transport_mismatch", t.name),
        ));
        return None;
    }
    Some((t, TemplateSource::Destination))
}

/// A transient `Template` holding the compiled `prebuilt_default`; never read from the database.
pub fn compiled_fallback(org_id: &str) -> Template {
    Template {
        id: None,
        org_id: org_id.to_string(),
        name: DEFAULT_CONTENT_TEMPLATE_NAME.to_string(),
        is_default: false,
        template_type: TemplateType::Http,
        body: serde_json::to_string(&compiled_default_content())
            .unwrap_or_else(|_| "{}".to_string()),
        kind: TemplateKind::Content,
        applies_to: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tpl(name: &str, kind: TemplateKind, template_type: TemplateType) -> Template {
        Template {
            id: None,
            org_id: "org1".into(),
            name: name.into(),
            is_default: false,
            template_type,
            body: "{}".into(),
            kind,
            applies_to: Vec::new(),
        }
    }

    #[test]
    fn resolve_effective_template_explicit_short_circuits() {
        let explicit = tpl("my_template", TemplateKind::Content, TemplateType::Http);
        let resolved = resolve_effective_template("org1", Some(explicit.clone()));
        assert_eq!(resolved.source, TemplateSource::Explicit);
        assert_eq!(resolved.template.name, explicit.name);
    }

    #[test]
    fn compiled_fallback_template_shape() {
        let t = compiled_fallback("org1");
        assert_eq!(t.org_id, "org1");
        assert_eq!(t.name, DEFAULT_CONTENT_TEMPLATE_NAME);
        assert_eq!(t.kind, TemplateKind::Content);
        assert!(!t.body.is_empty());
        // Round-trips through the same ContentSpec the compiled fallback uses.
        let spec: config::meta::alerts::content_spec::ContentSpec =
            serde_json::from_str(&t.body).expect("body must parse as ContentSpec");
        assert!(!spec.title.is_empty());
    }

    fn content(name: &str) -> Template {
        tpl(name, TemplateKind::Content, TemplateType::Http)
    }

    fn custom_http(name: &str) -> Template {
        tpl(name, TemplateKind::Custom, TemplateType::Http)
    }

    fn email_dest() -> DestinationType {
        DestinationType::Email(Default::default())
    }

    fn slack_dest() -> DestinationType {
        DestinationType::Http(config::meta::destinations::Endpoint {
            destination_type: Some("slack".into()),
            ..Default::default()
        })
    }

    /// Kind, explicit, destination, destination type, expected source, skip count.
    type Case = (
        NotificationKind,
        Vec<Template>,
        Option<Template>,
        DestinationType,
        TemplateSource,
        usize,
    );

    fn walk(
        kind: NotificationKind,
        explicit: &[Template],
        dest: Option<Template>,
        dt: &DestinationType,
    ) -> EffectiveTemplate {
        resolve_effective_template_for("org1", kind, explicit, dest, Some(dt))
    }

    #[test]
    fn every_kind_and_transport_falls_back_to_prebuilt_default() {
        for kind in NotificationKind::ALL {
            for dt in [slack_dest(), email_dest()] {
                let got = walk(kind, &[], None, &dt);
                assert_eq!(got.source, TemplateSource::Compiled);
                assert_eq!(got.template.name, "prebuilt_default", "{kind:?}");
                assert_eq!(got.template.org_id, "org1");
            }
        }
        // D3: a user template applies to downtimes without naming a downtime variable.
        assert!(destination_template_applies(
            &content("ops-card"),
            NotificationKind::Downtime
        ));
        assert!(!destination_template_applies(
            &content("prebuilt_slack"),
            NotificationKind::Downtime
        ));
    }

    #[test]
    fn a_skipped_destination_template_names_why() {
        let reason = |dest: Template| {
            let mut skipped = Vec::new();
            let chosen = choose_explicit_or_destination(
                NotificationKind::Synthetics,
                &[],
                Some(dest),
                Some(&slack_dest()),
                &mut skipped,
            );
            assert!(chosen.is_none());
            skipped
        };
        let alert_only = Template {
            applies_to: vec![NotificationKind::Alert],
            ..content("ut_hook_alert")
        };
        assert_eq!(
            reason(alert_only),
            vec![(
                TemplateSource::Destination,
                "ut_hook_alert: not_applicable".to_string()
            )]
        );
        assert_eq!(
            reason(content("prebuilt_slack")),
            vec![(
                TemplateSource::Destination,
                "prebuilt_slack: reserved".to_string()
            )]
        );
    }

    #[test]
    fn resolution_table() {
        use NotificationKind::*;
        let prebuilt = content("prebuilt_slack");
        let user = content("ops-card");
        let hook = custom_http("hook");
        let anomaly_only = Template {
            applies_to: vec![Anomaly],
            ..content("anomaly-card")
        };
        let cases: Vec<Case> = vec![
            // Level 2 re-checks applies_to: skipped for synthetics, used for anomaly.
            (
                Synthetics,
                vec![],
                Some(anomaly_only.clone()),
                slack_dest(),
                TemplateSource::Compiled,
                1,
            ),
            (
                Anomaly,
                vec![],
                Some(anomaly_only.clone()),
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // Alerts keep any destination template, whatever it applies to.
            (
                Alert,
                vec![],
                Some(anomaly_only.clone()),
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // Level 1 wins when it fits.
            (
                Anomaly,
                vec![user.clone()],
                Some(user.clone()),
                slack_dest(),
                TemplateSource::Explicit,
                0,
            ),
            // A Custom http override on email falls through, recording transport_mismatch.
            (
                Anomaly,
                vec![hook.clone()],
                None,
                email_dest(),
                TemplateSource::Compiled,
                1,
            ),
            (
                Anomaly,
                vec![hook.clone()],
                Some(user.clone()),
                email_dest(),
                TemplateSource::Destination,
                1,
            ),
            // D2: a reserved destination template never shadows a kind default.
            (
                Anomaly,
                vec![],
                Some(prebuilt.clone()),
                slack_dest(),
                TemplateSource::Compiled,
                1,
            ),
            (
                Incident,
                vec![],
                Some(prebuilt.clone()),
                slack_dest(),
                TemplateSource::Compiled,
                1,
            ),
            // Alerts keep any destination template.
            (
                Alert,
                vec![],
                Some(prebuilt.clone()),
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // A user destination template applies to every kind.
            (
                Anomaly,
                vec![],
                Some(user.clone()),
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // Overrides are tried in order until one fits the transport.
            (
                Incident,
                vec![hook.clone(), user.clone()],
                None,
                email_dest(),
                TemplateSource::Explicit,
                1,
            ),
            (
                Incident,
                vec![user.clone(), hook.clone()],
                None,
                email_dest(),
                TemplateSource::Explicit,
                0,
            ),
        ];
        for (i, (kind, explicit, dest, dt, want, skips)) in cases.into_iter().enumerate() {
            let got = walk(kind, &explicit, dest, &dt);
            assert_eq!(got.source, want, "case {i}");
            assert_eq!(got.skipped.len(), skips, "case {i}: {:?}", got.skipped);
        }
    }

    #[test]
    fn an_incident_override_that_does_not_fit_falls_to_the_alert_template() {
        let got = walk(
            NotificationKind::Incident,
            &[custom_http("incident-hook"), content("alert-card")],
            None,
            &email_dest(),
        );
        assert_eq!(got.template.name, "alert-card");
        assert_eq!(got.skipped[0].1, "incident-hook: transport_mismatch");
        assert!(got.skipped_json().contains("transport_mismatch"));
    }
}
