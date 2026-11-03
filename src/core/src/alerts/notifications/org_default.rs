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

//! Per-org pointer to the template that resolves when neither the alert nor
//! the destination binds one (design §4.4). Stored in system_settings v2,
//! `SettingScope::Org`, key [`DEFAULT_ALERT_TEMPLATE_KEY`] — NOT the legacy
//! `OrganizationSetting` meta-KV (its watcher ignores Delete events).
//!
//! A missing/dangling pointer is never an error — the caller
//! (`resolve_effective_template`, Task 4) falls through to the compiled-in
//! [`super::default_template::compiled_default_content`] fallback. This
//! module only owns reading/writing the pointer value itself.

use config::meta::{
    alerts::notification_kind::NotificationKind,
    destinations::{DestinationType, Template, TemplateKind, TemplateType},
    system_settings::{SettingScope, SystemSetting},
};
use db::system_settings;

use super::default_template::{
    DEFAULT_CONTENT_TEMPLATE_NAME, compiled_content_for, compiled_name_for,
    is_reserved_template_name,
};

pub const DEFAULT_ALERT_TEMPLATE_KEY: &str = "default_alert_template";
pub const DEFAULT_TEMPLATES_KEY: &str = "default_templates";

/// Extract the template name from a stored setting value, treating an empty
/// string the same as absent — pure so it's testable without a DB.
pub(crate) fn pointer_from_value(v: &serde_json::Value) -> Option<String> {
    v.get("template")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// Read the org's default-template pointer. `None` when unset — dangling
/// handling (does the pointed-at template still exist?) is the CALLER's job;
/// resolution always falls through to the compiled-in fallback either way.
pub async fn get_org_default_template(org_id: &str) -> Option<String> {
    match system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        DEFAULT_ALERT_TEMPLATE_KEY,
    )
    .await
    {
        Ok(Some(setting)) => pointer_from_value(&setting.setting_value),
        Ok(None) => None,
        Err(e) => {
            log::error!("[TEMPLATES] read default_alert_template failed for org {org_id}: {e}");
            None
        }
    }
}

/// Set the org's default-template pointer.
pub async fn set_org_default_template(
    org_id: &str,
    template_name: &str,
) -> Result<(), anyhow::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let setting = SystemSetting {
        id: None,
        scope: SettingScope::Org,
        org_id: Some(org_id.to_string()),
        user_id: None,
        setting_key: DEFAULT_ALERT_TEMPLATE_KEY.to_string(),
        setting_category: Some("alerts".to_string()),
        setting_value: serde_json::json!({ "template": template_name }),
        description: Some("Default content template for this org's alert notifications".into()),
        created_at: now,
        updated_at: now,
        created_by: None,
        updated_by: None,
    };
    system_settings::set(&setting).await?;
    Ok(())
}

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

/// A `default_templates` value: an object of kind to user template name that applies to it.
pub async fn validate_default_templates(
    org_id: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let Some(map) = value.as_object() else {
        return Err(format!(
            "{DEFAULT_TEMPLATES_KEY}: expected an object of kind to template"
        ));
    };
    for (key, name) in map {
        let Some(kind) = NotificationKind::parse(key) else {
            return Err(format!(
                "{DEFAULT_TEMPLATES_KEY}: unknown kind '{key}'; allowed: alert, incident, anomaly, synthetics, downtime, on_call"
            ));
        };
        let Some(name) = name.as_str().filter(|n| !n.is_empty()) else {
            return Err(format!(
                "{DEFAULT_TEMPLATES_KEY}.{key}: expected a template name; omit the key to clear it"
            ));
        };
        crate::alerts::templates::check_binding(org_id, name, kind)
            .await
            .map_err(|e| format!("{DEFAULT_TEMPLATES_KEY}.{}: {e}", kind.as_str()))?;
    }
    Ok(())
}

/// Which precedence level supplied the template (Backend section 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TemplateSource {
    Explicit,
    Destination,
    OrgDefault,
    LegacyAlertDefault,
    Compiled,
}

impl TemplateSource {
    /// The `template_source` value the send log line carries.
    pub fn as_str(self) -> &'static str {
        match self {
            TemplateSource::Explicit => "explicit",
            TemplateSource::Destination => "destination",
            TemplateSource::OrgDefault | TemplateSource::LegacyAlertDefault => "org_default",
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

/// Not a reserved row (`prebuilt_*`, `o2_default_*`, `prebuilt_downtime*`).
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
pub async fn resolve_effective_template(
    org_id: &str,
    explicit: Option<Template>,
) -> EffectiveTemplate {
    let explicit: Vec<Template> = explicit.into_iter().collect();
    resolve_effective_template_for(org_id, NotificationKind::Alert, &explicit, None, None).await
}

/// Walk levels 1 to 4 for one send; the alert path passes no `dt` and skips the transport rule.
pub async fn resolve_effective_template_for(
    org_id: &str,
    kind: NotificationKind,
    explicit: &[Template],
    dest_template: Option<Template>,
    dt: Option<&DestinationType>,
) -> EffectiveTemplate {
    let mut skipped = Vec::new();
    if let Some((template, source)) =
        choose_explicit_or_destination(kind, explicit, dest_template, dt, &mut skipped)
    {
        return EffectiveTemplate {
            template,
            source,
            skipped,
        };
    }
    let defaults = get_default_templates(org_id).await;
    let org_default_name = defaults.get(kind).map(str::to_string);
    let org_default = match &org_default_name {
        Some(name) => db::alerts::templates::get(org_id, name).await.ok(),
        None => None,
    };
    let legacy_default = if kind == NotificationKind::Alert && org_default.is_none() {
        match get_org_default_template(org_id).await {
            Some(name) => db::alerts::templates::get(org_id, &name).await.ok(),
            None => None,
        }
    } else {
        None
    };
    let fallback = OrgFallback {
        explicit,
        org_default,
        org_default_name,
        legacy_default,
    };
    choose_org_or_compiled(org_id, kind, fallback, dt, skipped)
}

/// Levels 1 and 2; `None` sends the caller on to the org levels with `skipped` filled.
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

/// What levels 3 and 4 have to offer, loaded by the caller so the walk itself is pure.
pub struct OrgFallback<'a> {
    pub explicit: &'a [Template],
    pub org_default: Option<Template>,
    pub org_default_name: Option<String>,
    pub legacy_default: Option<Template>,
}

/// Levels 3 and 4; a name already tried at level 1 is not tried again.
pub fn choose_org_or_compiled(
    org_id: &str,
    kind: NotificationKind,
    fallback: OrgFallback<'_>,
    dt: Option<&DestinationType>,
    mut skipped: Vec<(TemplateSource, String)>,
) -> EffectiveTemplate {
    let fits = |t: &Template| dt.is_none_or(|dt| fits_transport(t, dt));
    let tried_at_level_1 = |name: &str| fallback.explicit.iter().any(|t| t.name == name);
    match (fallback.org_default, fallback.org_default_name) {
        (Some(t), _) if tried_at_level_1(&t.name) => {}
        (Some(t), _) if fits(&t) => {
            return EffectiveTemplate {
                template: t,
                source: TemplateSource::OrgDefault,
                skipped,
            };
        }
        (Some(t), _) => skipped.push((
            TemplateSource::OrgDefault,
            format!("{}: transport_mismatch", t.name),
        )),
        (None, Some(name)) if !tried_at_level_1(&name) => {
            skipped.push((TemplateSource::OrgDefault, format!("{name}: missing")))
        }
        (None, _) => {}
    }
    if let Some(t) = fallback.legacy_default
        && fits(&t)
    {
        return EffectiveTemplate {
            template: t,
            source: TemplateSource::LegacyAlertDefault,
            skipped,
        };
    }
    EffectiveTemplate {
        template: compiled_fallback_for_transport(org_id, kind, dt),
        source: TemplateSource::Compiled,
        skipped,
    }
}

/// One pointer per kind, from the `default_templates` org setting; never seeded.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DefaultTemplates(pub std::collections::BTreeMap<String, String>);

impl DefaultTemplates {
    pub fn get(&self, kind: NotificationKind) -> Option<&str> {
        self.0
            .get(kind.as_str())
            .map(String::as_str)
            .filter(|n| !n.is_empty())
    }

    pub fn from_value(v: &serde_json::Value) -> Self {
        let map = v
            .as_object()
            .map(|o| {
                o.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        Self(map)
    }
}

/// Read the org's `default_templates` map; a missing row is cached so later sends skip the read.
pub async fn get_default_templates(org_id: &str) -> DefaultTemplates {
    match system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        DEFAULT_TEMPLATES_KEY,
    )
    .await
    {
        Ok(Some(setting)) => DefaultTemplates::from_value(&setting.setting_value),
        Ok(None) => {
            system_settings::set_only_cached(&default_templates_setting(
                org_id,
                serde_json::json!({}),
            ))
            .await;
            DefaultTemplates::default()
        }
        Err(e) => {
            log::error!("[TEMPLATES] read default_templates failed for org {org_id}: {e}");
            DefaultTemplates::default()
        }
    }
}

/// Write `default_templates = {}` for an org that has no row yet.
pub async fn init_default_templates(org_id: &str) -> Result<(), anyhow::Error> {
    let existing = system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        DEFAULT_TEMPLATES_KEY,
    )
    .await?;
    if existing.is_some_and(|s| s.id.is_some()) {
        return Ok(());
    }
    system_settings::set(&default_templates_setting(org_id, serde_json::json!({}))).await?;
    Ok(())
}

fn default_templates_setting(org_id: &str, value: serde_json::Value) -> SystemSetting {
    let now = chrono::Utc::now().timestamp_micros();
    SystemSetting {
        id: None,
        scope: SettingScope::Org,
        org_id: Some(org_id.to_string()),
        user_id: None,
        setting_key: DEFAULT_TEMPLATES_KEY.to_string(),
        setting_category: Some("alerts".to_string()),
        setting_value: value,
        description: Some("Default notification template per kind for this org".into()),
        created_at: now,
        updated_at: now,
        created_by: None,
        updated_by: None,
    }
}

/// A transient `Template` holding the kind's compiled default; never read from the database.
pub fn compiled_fallback_for(org_id: &str, kind: NotificationKind) -> Template {
    Template {
        id: None,
        org_id: org_id.to_string(),
        name: compiled_name_for(kind).to_string(),
        is_default: false,
        template_type: TemplateType::Http,
        body: serde_json::to_string(&compiled_content_for(kind))
            .unwrap_or_else(|_| "{}".to_string()),
        kind: TemplateKind::Content,
        applies_to: Vec::new(),
    }
}

/// Level 4 for one transport: downtimes keep the seeded pair (D3), other kinds their card.
pub fn compiled_fallback_for_transport(
    org_id: &str,
    kind: NotificationKind,
    dt: Option<&DestinationType>,
) -> Template {
    if kind != NotificationKind::Downtime {
        return compiled_fallback_for(org_id, kind);
    }
    let [http, email] = crate::alerts::templates::downtime_templates();
    let mut template = if matches!(dt, Some(DestinationType::Email(_))) {
        email
    } else {
        http
    };
    template.org_id = org_id.to_string();
    template
}

/// Idempotent: set the pointer (to the compiled default) for every org that
/// doesn't already have one. Runs at startup, after
/// `ensure_default_content_template`, under its own dist_lock — safe to run
/// on every boot, and safe to run concurrently with the org-creation hook
/// (both are create-if-missing on a per-org basis, never overwrite).
pub async fn backfill_org_default_templates() -> Result<(), anyhow::Error> {
    use infra::dist_lock;

    let lock_key = "/system/templates/org_default_backfill";
    let locker = dist_lock::lock(lock_key, 0).await?;

    // A blocked org's rows are deleted by its cleanup, which a restart must not undo.
    let orgs = crate::db::organization::list_unblocked()
        .await
        .unwrap_or_default();
    let mut backfilled = 0;
    for org in &orgs {
        if let Err(e) = init_default_templates(&org.identifier).await {
            log::error!(
                "[TEMPLATES] backfill default_templates failed for org {}: {e}",
                org.identifier
            );
        }
        if get_org_default_template(&org.identifier).await.is_some() {
            continue; // already has a pointer — never overwrite
        }
        match set_org_default_template(&org.identifier, DEFAULT_CONTENT_TEMPLATE_NAME).await {
            Ok(()) => backfilled += 1,
            Err(e) => log::error!(
                "[TEMPLATES] backfill default_alert_template failed for org {}: {e}",
                org.identifier
            ),
        }
    }

    dist_lock::unlock(&locker).await?;
    drop(locker);

    log::info!(
        "[TEMPLATES] default_alert_template backfill complete: {backfilled}/{} orgs have a pointer",
        orgs.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pointer_codec() {
        assert_eq!(
            pointer_from_value(&serde_json::json!({"template":"x"})),
            Some("x".into())
        );
        assert_eq!(
            pointer_from_value(&serde_json::json!({"template":""})),
            None
        );
        assert_eq!(pointer_from_value(&serde_json::json!({})), None);
    }

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

    /// Nothing else in this test module migrates the meta store the settings read.
    async fn meta_store() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
    }

    #[tokio::test]
    async fn a_missing_default_templates_row_is_cached_until_a_real_row_replaces_it() {
        meta_store().await;
        // The meta store outlives the run, and this test leaves a row for its org.
        let org = &format!("org_default_templates_miss_{}", config::ider::generate());
        assert_eq!(
            get_default_templates(org)
                .await
                .get(NotificationKind::Incident),
            None
        );
        let cached =
            system_settings::get(&SettingScope::Org, Some(org), None, DEFAULT_TEMPLATES_KEY)
                .await
                .unwrap()
                .expect("the miss is cached");
        assert_eq!(cached.id, None, "the placeholder is not a stored row");

        // The placeholder does not stop the backfill from writing the real row.
        init_default_templates(org).await.unwrap();
        let stored =
            system_settings::get(&SettingScope::Org, Some(org), None, DEFAULT_TEMPLATES_KEY)
                .await
                .unwrap()
                .unwrap();
        assert!(stored.id.is_some());

        system_settings::set(&default_templates_setting(
            org,
            serde_json::json!({"incident": "ops-card"}),
        ))
        .await
        .unwrap();
        assert_eq!(
            get_default_templates(org)
                .await
                .get(NotificationKind::Incident),
            Some("ops-card")
        );
    }

    #[tokio::test]
    async fn resolve_effective_template_explicit_short_circuits() {
        let explicit = tpl("my_template", TemplateKind::Content, TemplateType::Http);
        let resolved = resolve_effective_template("org1", Some(explicit.clone())).await;
        assert_eq!(resolved.source, TemplateSource::Explicit);
        assert_eq!(resolved.template.name, explicit.name);
    }

    #[test]
    fn compiled_fallback_template_shape() {
        let t = compiled_fallback_for("org1", NotificationKind::Alert);
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

    /// Kind, explicit, destination, org default, destination type, expected source, skip count.
    type Case = (
        NotificationKind,
        Vec<Template>,
        Option<Template>,
        Option<Template>,
        DestinationType,
        TemplateSource,
        usize,
    );

    /// One walk over loaded candidates; `org` is level 3.
    fn walk(
        kind: NotificationKind,
        explicit: &[Template],
        dest: Option<Template>,
        org: Option<Template>,
        dt: &DestinationType,
    ) -> EffectiveTemplate {
        let mut skipped = Vec::new();
        if let Some((template, source)) =
            choose_explicit_or_destination(kind, explicit, dest, Some(dt), &mut skipped)
        {
            return EffectiveTemplate {
                template,
                source,
                skipped,
            };
        }
        let org_default_name = org.as_ref().map(|t| t.name.clone());
        choose_org_or_compiled(
            "org1",
            kind,
            OrgFallback {
                explicit,
                org_default: org,
                org_default_name,
                legacy_default: None,
            },
            Some(dt),
            skipped,
        )
    }

    #[test]
    fn a_downtime_falls_back_to_the_seeded_pair_for_its_transport() {
        let http = compiled_fallback_for_transport(
            "acme",
            NotificationKind::Downtime,
            Some(&slack_dest()),
        );
        assert_eq!(http.name, "prebuilt_downtime");
        assert_eq!(http.org_id, "acme");
        let email = compiled_fallback_for_transport(
            "acme",
            NotificationKind::Downtime,
            Some(&email_dest()),
        );
        assert_eq!(email.name, "prebuilt_downtime_email");
        assert_eq!(
            compiled_fallback_for_transport("acme", NotificationKind::Synthetics, None).name,
            "o2_default_synthetics"
        );
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
                None,
                slack_dest(),
                TemplateSource::Compiled,
                1,
            ),
            (
                Anomaly,
                vec![],
                Some(anomaly_only.clone()),
                None,
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // Alerts keep any destination template, whatever it applies to.
            (
                Alert,
                vec![],
                Some(anomaly_only.clone()),
                None,
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // Level 1 wins when it fits.
            (
                Anomaly,
                vec![user.clone()],
                Some(user.clone()),
                None,
                slack_dest(),
                TemplateSource::Explicit,
                0,
            ),
            // A Custom http override on email falls through, recording transport_mismatch.
            (
                Anomaly,
                vec![hook.clone()],
                None,
                None,
                email_dest(),
                TemplateSource::Compiled,
                1,
            ),
            (
                Anomaly,
                vec![hook.clone()],
                Some(user.clone()),
                None,
                email_dest(),
                TemplateSource::Destination,
                1,
            ),
            // D2: a reserved destination template never shadows a kind default.
            (
                Anomaly,
                vec![],
                Some(prebuilt.clone()),
                None,
                slack_dest(),
                TemplateSource::Compiled,
                1,
            ),
            (
                Incident,
                vec![],
                Some(prebuilt.clone()),
                None,
                slack_dest(),
                TemplateSource::Compiled,
                1,
            ),
            // Alerts keep any destination template.
            (
                Alert,
                vec![],
                Some(prebuilt.clone()),
                None,
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // A user destination template applies to every kind.
            (
                Anomaly,
                vec![],
                Some(user.clone()),
                None,
                slack_dest(),
                TemplateSource::Destination,
                0,
            ),
            // Level 3 is used when levels 1 and 2 give nothing.
            (
                Anomaly,
                vec![],
                Some(prebuilt.clone()),
                Some(user.clone()),
                slack_dest(),
                TemplateSource::OrgDefault,
                1,
            ),
            // A Custom http org default on email is skipped too.
            (
                Anomaly,
                vec![],
                None,
                Some(hook.clone()),
                email_dest(),
                TemplateSource::Compiled,
                1,
            ),
            // Incident 1a: the org incident override first, then 1b the alert's template.
            (
                Incident,
                vec![hook.clone(), user.clone()],
                None,
                None,
                email_dest(),
                TemplateSource::Explicit,
                1,
            ),
            (
                Incident,
                vec![user.clone(), hook.clone()],
                None,
                None,
                email_dest(),
                TemplateSource::Explicit,
                0,
            ),
        ];
        for (i, (kind, explicit, dest, org, dt, want, skips)) in cases.into_iter().enumerate() {
            let got = walk(kind, &explicit, dest, org, &dt);
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
            None,
            &email_dest(),
        );
        assert_eq!(got.template.name, "alert-card");
        assert_eq!(got.skipped[0].1, "incident-hook: transport_mismatch");
        assert!(got.skipped_json().contains("transport_mismatch"));
    }

    #[test]
    fn a_name_tried_at_level_1_is_not_tried_again_at_level_3() {
        let hook = custom_http("hook");
        let got = walk(
            NotificationKind::Incident,
            std::slice::from_ref(&hook),
            None,
            Some(hook.clone()),
            &email_dest(),
        );
        assert_eq!(got.source, TemplateSource::Compiled);
        assert_eq!(got.skipped.len(), 1);
    }

    #[test]
    fn the_compiled_default_follows_the_kind() {
        let got = walk(NotificationKind::Anomaly, &[], None, None, &slack_dest());
        assert_eq!(got.template.name, "o2_default_anomaly");
        let got = walk(NotificationKind::Incident, &[], None, None, &slack_dest());
        assert_eq!(got.template.name, "o2_default_incident");
    }

    #[test]
    fn default_templates_codec() {
        let d =
            DefaultTemplates::from_value(&serde_json::json!({"incident": "ops", "anomaly": ""}));
        assert_eq!(d.get(NotificationKind::Incident), Some("ops"));
        assert_eq!(d.get(NotificationKind::Anomaly), None);
        assert_eq!(d.get(NotificationKind::OnCall), None);
    }
}
