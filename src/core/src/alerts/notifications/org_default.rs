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
    destinations::{Template, TemplateKind, TemplateType},
    system_settings::{SettingScope, SystemSetting},
};
use db::system_settings;

use super::default_template::{DEFAULT_CONTENT_TEMPLATE_NAME, compiled_default_content};

pub const DEFAULT_ALERT_TEMPLATE_KEY: &str = "default_alert_template";

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

/// Which layer of the resolution chain actually supplied the template used
/// for a notification (design §6.1).
pub enum EffectiveTemplate {
    /// Alert-level or destination-level — the caller already had a `Template`
    /// in hand (from a DB lookup elsewhere) and just wants precedence applied.
    Explicit(Template),
    /// Resolved via the org's `default_alert_template` pointer.
    OrgDefault(Template),
    /// Terminal — pointer missing/dangling/unseeded. Never an error.
    CompiledFallback(Template),
}

impl EffectiveTemplate {
    pub fn template(&self) -> &Template {
        match self {
            EffectiveTemplate::Explicit(t)
            | EffectiveTemplate::OrgDefault(t)
            | EffectiveTemplate::CompiledFallback(t) => t,
        }
    }
}

/// A transient (never persisted) `Template` wrapping the compiled-in
/// fallback content, for callers that need the same `Template` shape as a DB
/// row without a DB read.
fn compiled_fallback_template(org_id: &str) -> Template {
    Template {
        id: None,
        org_id: org_id.to_string(),
        name: DEFAULT_CONTENT_TEMPLATE_NAME.to_string(),
        is_default: false,
        template_type: TemplateType::Http,
        body: serde_json::to_string(&compiled_default_content())
            .unwrap_or_else(|_| "{}".to_string()),
        kind: TemplateKind::Content,
    }
}

/// Resolve the template that should actually render this notification:
/// alert-level → destination-level → org `default_alert_template` → compiled-in
/// fallback. Never returns an error — the compiled fallback is infallible by
/// construction (asserted by `default_template`'s own tests).
///
/// `alert_tpl`/`dest_tpl` are `None` when nothing explicit is bound; this
/// function does NOT decide alert-vs-destination precedence between two
/// explicit values — see `alert::choose_template` for that pure rule. Callers
/// pass in whichever of the two `choose_template` already picked (or `None`
/// if neither was set) as `explicit`.
pub async fn resolve_effective_template(
    org_id: &str,
    explicit: Option<Template>,
) -> EffectiveTemplate {
    if let Some(t) = explicit {
        return EffectiveTemplate::Explicit(t);
    }

    if let Some(name) = get_org_default_template(org_id).await
        && let Ok(t) = db::alerts::templates::get(org_id, &name).await
    {
        // `db::alerts::templates::get` already falls back to the DEFAULT_ORG
        // row by name when the org-scoped row is absent — the pointer to
        // `o2_default_content` resolves through exactly that fallback.
        return EffectiveTemplate::OrgDefault(t);
    }

    // Pointer missing, or set but dangling — terminal fallback, never an error.
    EffectiveTemplate::CompiledFallback(compiled_fallback_template(org_id))
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

    let orgs = crate::organization::list_all_orgs(None)
        .await
        .unwrap_or_default();
    let mut backfilled = 0;
    for org in &orgs {
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

    /// `Explicit` short-circuits before any DB read — the only branch of
    /// `resolve_effective_template` testable without a DB connection. The
    /// `OrgDefault`/`CompiledFallback` branches are covered by
    /// `resolve_resolution_chain_e2e` (Task 11's E2E, DB-backed).
    #[tokio::test]
    async fn resolve_effective_template_explicit_short_circuits() {
        let explicit = Template {
            id: None,
            org_id: "org1".into(),
            name: "my_template".into(),
            is_default: false,
            template_type: TemplateType::Http,
            body: "{}".into(),
            kind: TemplateKind::Content,
        };
        let resolved = resolve_effective_template("org1", Some(explicit.clone())).await;
        match resolved {
            EffectiveTemplate::Explicit(t) => assert_eq!(t.name, explicit.name),
            _ => panic!("expected Explicit"),
        }
    }

    #[test]
    fn compiled_fallback_template_shape() {
        let t = compiled_fallback_template("org1");
        assert_eq!(t.org_id, "org1");
        assert_eq!(t.name, DEFAULT_CONTENT_TEMPLATE_NAME);
        assert_eq!(t.kind, TemplateKind::Content);
        assert!(!t.body.is_empty());
        // Round-trips through the same ContentSpec the compiled fallback uses.
        let spec: config::meta::alerts::content_spec::ContentSpec =
            serde_json::from_str(&t.body).expect("body must parse as ContentSpec");
        assert!(!spec.title.is_empty());
    }
}
