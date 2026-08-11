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

// The "is this a system-managed template?" check lives next to
// `get_prebuilt_template` in `config::prebuilt_loader` so the HTTP model, the
// service-layer guards below, and any future caller all derive the same
// answer from one place. Re-exported here as a thin wrapper so existing
// callers in this module keep working without a long path.
use config::{
    DEFAULT_ORG,
    meta::{
        alerts::content_spec::ContentSpec,
        destinations::{Template, TemplateKind, TemplateType},
    },
};
use db::{
    self,
    alerts::templates::TemplateError,
    authz::{remove_ownership, set_ownership},
};

use crate::{
    alerts::notifications::default_template::{
        DEFAULT_CONTENT_TEMPLATE_NAME, is_reserved_template_name,
    },
    auth::is_ofga_unsupported,
    common::meta::authz::Authz,
};

/// Sticky-kind rule (design §6.2): create defaults absent→Custom; update
/// preserves the existing kind when the client didn't specify one.
pub(crate) fn resolve_kind(
    requested: Option<TemplateKind>,
    existing: Option<TemplateKind>,
    create: bool,
) -> TemplateKind {
    match requested {
        Some(k) => k,
        None if create => TemplateKind::Custom,
        None => existing.unwrap_or(TemplateKind::Custom),
    }
}

pub async fn save(
    name: &str,
    mut template: Template,
    requested_kind: Option<TemplateKind>,
    create: bool,
    is_root: bool,
) -> Result<Template, TemplateError> {
    if template.body.is_empty() {
        return Err(TemplateError::EmptyBody);
    }
    if !name.is_empty() {
        template.name = name.to_owned();
    }
    template.name = template.name.trim().to_string();
    if template.name.is_empty() {
        return Err(TemplateError::EmptyName);
    }
    // Don't allow the characters not supported by ofga
    if template.name.contains('/') || is_ofga_unsupported(&template.name) {
        return Err(TemplateError::InvalidName);
    }

    if is_reserved_template_name(&template.name) {
        if create {
            // Nobody may create a new template with a reserved name — it would
            // shadow or conflict with the system-managed record.
            return Err(TemplateError::ReservedName(template.name.clone()));
        }
        // Updates are allowed for root (internal ops / self-hosted admins);
        // all other callers get a 403.
        if !is_root {
            return Err(TemplateError::PrebuiltReadOnly(template.name.clone()));
        }
    }

    let existing = match db::alerts::templates::get(&template.org_id, &template.name).await {
        Ok(existing) => {
            if create {
                return Err(TemplateError::AlreadyExists);
            } else {
                template.org_id = existing.org_id.clone(); // since org can be default
                Some(existing)
            }
        }
        Err(_) => {
            if !create {
                return Err(TemplateError::NotFound);
            }
            None
        }
    };

    let existing_kind = existing.as_ref().map(|e| e.kind);
    template.kind = resolve_kind(requested_kind, existing_kind, create);

    if template.kind == TemplateKind::Content {
        let spec = ContentSpec::parse(&template.body)
            .map_err(|e| TemplateError::InvalidContentSpec(e.to_string()))?;
        // Reject an unsupported link scheme HERE rather than neutralizing it
        // on every send: the author gets a fixable error instead of a
        // template whose link silently never works (#13742).
        spec.validate().map_err(TemplateError::InvalidContentSpec)?;
    } else if let TemplateType::Email { title } = &template.template_type
        && title.is_empty()
    {
        // Content templates have no email-title concept — the renderer owns
        // the subject — so this validation only applies to custom templates.
        return Err(TemplateError::EmptyTitle);
    }

    template.is_default = template.org_id.eq(DEFAULT_ORG);
    let saved = db::alerts::templates::set(template).await?;
    if name.is_empty() {
        set_ownership(&saved.name, "templates", Authz::new(&saved.name)).await;
    }
    Ok(saved)
}

pub async fn get(org_id: &str, name: &str) -> Result<Template, TemplateError> {
    db::alerts::templates::get(org_id, name).await
}

pub async fn list(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Template>, TemplateError> {
    Ok(db::alerts::templates::list(org_id)
        .await?
        .into_iter()
        .filter(|template| {
            permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("template:{}", template.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("template:_all_{org_id}"))
        })
        .collect())
}

pub async fn delete(org_id: &str, name: &str, is_root: bool) -> Result<(), TemplateError> {
    if !is_root && is_reserved_template_name(name) {
        return Err(TemplateError::PrebuiltReadOnly(name.to_string()));
    }
    db::alerts::templates::delete(org_id, name).await?;
    remove_ownership(org_id, "templates", Authz::new(name)).await;
    Ok(())
}

pub(crate) const PREBUILT_REVISION_KEY: &str = "prebuilt_templates_revision";

/// Reseed gate (design §6.3): overwrite a stored prebuilt template when the
/// shipped revision is newer, or when revisions are equal but the stored
/// body/type drifted — equal-revision drift is the old-binary-revert
/// signature (an old node's overwrite code reverts body/type but never
/// touches the revision record). Never downgrade.
pub(crate) fn should_apply_prebuilt(shipped: u32, applied: u32, drifted: bool) -> bool {
    shipped > applied || (shipped == applied && drifted)
}

/// Ensures system prebuilt templates exist in the database.
/// Creates templates in DEFAULT_ORG if they don't exist.
/// Uses distributed lock to prevent race conditions in distributed mode.
pub async fn ensure_system_templates() -> Result<(), anyhow::Error> {
    use config::{
        meta::system_settings::{SettingScope, SystemSetting},
        prebuilt_loader::get_prebuilt_template,
    };
    use db::system_settings;
    use infra::dist_lock;

    let lock_key = "/system/templates/init";

    // Acquire distributed lock to ensure only one instance initializes templates
    let locker = dist_lock::lock(lock_key, 0).await?;

    let shipped_rev = config::prebuilt_loader::get_prebuilt_revision();
    let applied_rev: u32 = match system_settings::get(
        &SettingScope::System,
        None,
        None,
        PREBUILT_REVISION_KEY,
    )
    .await
    {
        Ok(Some(s)) => s.setting_value.as_u64().unwrap_or(0) as u32,
        _ => 0,
    };

    let prebuilt_types = vec![
        "slack",
        "msteams",
        "pagerduty",
        "discord",
        "webhook",
        "opsgenie",
        "servicenow",
        "email",
    ];

    let mut created_count = 0;
    let mut updated_count = 0;
    let mut skipped_count = 0;

    for prebuilt_type in prebuilt_types {
        if let Some(mut template) = get_prebuilt_template(prebuilt_type) {
            // Set org_id to DEFAULT_ORG for global visibility
            template.org_id = DEFAULT_ORG.to_string();

            // Check if template already exists
            match db::alerts::templates::get(DEFAULT_ORG, &template.name).await {
                Ok(existing) => {
                    // System templates are protected from user edits, so the
                    // prebuilt definition is the source of truth. Refresh the
                    // stored copy when it has drifted (e.g. a shipped fix to the
                    // body/title) so existing installs pick up the correction —
                    // but only when the reseed gate says to (revision-gated, see
                    // `should_apply_prebuilt`).
                    let drifted = existing.body != template.body
                        || existing.template_type != template.template_type;
                    if should_apply_prebuilt(shipped_rev, applied_rev, drifted) && drifted {
                        // Preserve the stored id so this is an update, not an insert.
                        template.id = existing.id;
                        match db::alerts::templates::set(template.clone()).await {
                            Ok(_) => {
                                updated_count += 1;
                                log::info!(
                                    "[TEMPLATES] Updated system template '{}' in {}",
                                    template.name,
                                    DEFAULT_ORG
                                );
                            }
                            Err(e) => {
                                log::error!(
                                    "[TEMPLATES] Failed to update system template '{}': {}",
                                    template.name,
                                    e
                                );
                            }
                        }
                    } else {
                        skipped_count += 1;
                        log::debug!(
                            "[TEMPLATES] System template '{}' already up to date in {}",
                            template.name,
                            DEFAULT_ORG
                        );
                    }
                }
                Err(TemplateError::NotFound) => {
                    // Template doesn't exist, create it
                    match db::alerts::templates::set(template.clone()).await {
                        Ok(_) => {
                            created_count += 1;
                            log::info!(
                                "[TEMPLATES] Created system template '{}' in {}",
                                template.name,
                                DEFAULT_ORG
                            );
                        }
                        Err(e) => {
                            log::error!(
                                "[TEMPLATES] Failed to create system template '{}': {}",
                                template.name,
                                e
                            );
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "[TEMPLATES] Error checking system template '{}': {}",
                        template.name,
                        e
                    );
                }
            }
        }
    }

    // Seed the compiled-in default content template's DB copy — same
    // dist_lock + revision-gate scope as the prebuilt loop above, so it
    // converges on the same startup pass rather than racing it.
    if let Err(e) = super::notifications::default_template::ensure_default_content_template(
        shipped_rev,
        applied_rev,
    )
    .await
    {
        log::error!("[TEMPLATES] Failed to seed '{DEFAULT_CONTENT_TEMPLATE_NAME}': {e}");
    }

    // Record the newly-applied revision so future startups don't re-overwrite
    // already-converged templates. Only advance forward, never downgrade.
    if shipped_rev > applied_rev {
        let now = chrono::Utc::now().timestamp_micros();
        let setting = SystemSetting {
            id: None,
            scope: SettingScope::System,
            org_id: None,
            user_id: None,
            setting_key: PREBUILT_REVISION_KEY.to_string(),
            setting_category: Some("alerts".to_string()),
            setting_value: serde_json::json!(shipped_rev),
            description: Some("Applied revision of shipped prebuilt alert templates".to_string()),
            created_at: now,
            updated_at: now,
            created_by: None,
            updated_by: None,
        };
        if let Err(e) = system_settings::set(&setting).await {
            log::error!("[TEMPLATES] Failed to record prebuilt template revision: {e}");
        }
    }

    // Release the lock
    dist_lock::unlock(&locker).await?;
    drop(locker);

    log::info!(
        "[TEMPLATES] System templates initialization complete: {} created, {} updated, {} already existed",
        created_count,
        updated_count,
        skipped_count
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_apply_prebuilt_gate() {
        // shipped newer than applied: always apply
        assert!(should_apply_prebuilt(1, 0, false));
        assert!(should_apply_prebuilt(2, 1, true));
        // equal revisions: apply only on drift (old-node revert self-heal)
        assert!(!should_apply_prebuilt(1, 1, false));
        assert!(should_apply_prebuilt(1, 1, true));
        // shipped older (downgrade): never apply
        assert!(!should_apply_prebuilt(1, 2, false));
        assert!(!should_apply_prebuilt(1, 2, true));
    }

    #[test]
    fn test_resolve_kind_sticky() {
        use TemplateKind::*;
        assert_eq!(resolve_kind(None, None, true), Custom); // old-shape create
        assert_eq!(resolve_kind(Some(Content), None, true), Content); // explicit create
        assert_eq!(resolve_kind(None, Some(Content), false), Content); // sticky update
        assert_eq!(resolve_kind(Some(Custom), Some(Content), false), Custom); // explicit downgrade
    }
}
