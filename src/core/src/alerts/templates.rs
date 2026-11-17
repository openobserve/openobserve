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
use std::collections::HashMap;

use config::{
    DEFAULT_ORG,
    meta::{
        alerts::{content_spec::ContentSpec, notification_kind::NotificationKind},
        destinations::{Template, TemplateKind, TemplateType},
    },
};
use db::{
    self,
    alerts::templates::TemplateError,
    authz::{remove_ownership, set_ownership},
};
use infra::table::templates::NAME_MAX_CHARS;

use crate::{
    alerts::notifications::default_template::{
        DEFAULT_CONTENT_TEMPLATE_NAME, is_reserved_template_name,
    },
    auth::is_ofga_unsupported,
    common::meta::authz::Authz,
};

pub const DOWNTIME_EMAIL_TITLE: &str = "OpenObserve downtime {downtime_name}: {downtime_event}";

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

// Only root may reach a shared `default` template through another org's path.
pub(crate) fn write_org(
    path_org: &str,
    existing_org: &str,
    is_root: bool,
) -> Result<String, TemplateError> {
    if existing_org == path_org || is_root {
        Ok(existing_org.to_string())
    } else {
        Err(TemplateError::NotFound)
    }
}

/// The org a saved template's ownership tuple names, which org deletion looks up.
pub(crate) fn ownership_of(saved: &Template) -> (&str, Authz) {
    (&saved.org_id, Authz::new(&saved.name))
}

pub async fn save(
    name: &str,
    mut template: Template,
    requested_kind: Option<TemplateKind>,
    requested_applies_to: Option<Vec<NotificationKind>>,
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
    // Create only: older rows over the limit (SQLite does not enforce it) stay editable.
    if create && template.name.chars().count() > NAME_MAX_CHARS {
        return Err(TemplateError::NameTooLong(NAME_MAX_CHARS));
    }

    if is_reserved_template_name(&template.name) {
        if create {
            // Nobody may create a new template with a reserved name — it would
            // shadow or conflict with the system-managed record.
            return Err(TemplateError::ReservedName(template.name.clone()));
        }
        // Updates are allowed for root (internal ops / self-hosted admins);
        // all other callers get a 403. The `prebuilt_default` row mirrors code
        // and stay read only for root too: the seeder owns them.
        if !is_root || is_compiled_default_name(&template.name) {
            return Err(TemplateError::PrebuiltReadOnly(template.name.clone()));
        }
    }

    let existing = match db::alerts::templates::get(&template.org_id, &template.name).await {
        Ok(existing) => {
            if create {
                return Err(TemplateError::AlreadyExists);
            }
            template.org_id = write_org(&template.org_id, &existing.org_id, is_root)?;
            Some(existing)
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
    template.applies_to = match &existing {
        // Reserved rows are read only; root edits keep the stored list.
        Some(e) if is_reserved_template_name(&e.name) => e.applies_to.clone(),
        Some(e) => requested_applies_to.unwrap_or_else(|| e.applies_to.clone()),
        None => requested_applies_to.unwrap_or_default(),
    };
    if let Some(existing) = &existing {
        check_narrowing(existing, &template.applies_to, is_root).await?;
    }

    if template.kind == TemplateKind::Content {
        let spec = ContentSpec::parse(&template.body)
            .map_err(|e| TemplateError::InvalidContentSpec(e.to_string()))?;
        // Reject an unsupported link scheme HERE rather than neutralizing it
        // on every send: the author gets a fixable error instead of a
        // template whose link silently never works (#13742).
        spec.validate().map_err(TemplateError::InvalidContentSpec)?;
        // Save only, not `validate()`: preview and test send still render a stored blank title.
        if spec.title.trim().is_empty() {
            return Err(TemplateError::EmptyTitle);
        }
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
        let (owner, object) = ownership_of(&saved);
        set_ownership(owner, "templates", object).await;
    }
    Ok(saved)
}

/// The seeded `prebuilt_default` row and its reserved prefix: read only for every caller, root
/// included.
fn is_compiled_default_name(name: &str) -> bool {
    infra::table::templates::is_reserved_default_name(name)
}

pub async fn get(org_id: &str, name: &str) -> Result<Template, TemplateError> {
    db::alerts::templates::get(org_id, name).await
}

pub async fn list(
    org_id: &str,
    permitted: Option<Vec<String>>,
    filter: ListFilter,
) -> Result<Vec<Template>, TemplateError> {
    let templates = apply_list_filter(db::alerts::templates::list(org_id).await?, filter);
    Ok(templates
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
    if (!is_root && is_reserved_template_name(name)) || is_compiled_default_name(name) {
        return Err(TemplateError::PrebuiltReadOnly(name.to_string()));
    }
    let existing = db::alerts::templates::get(org_id, name).await?;
    let owner = write_org(org_id, &existing.org_id, is_root)?;
    let used = used_by(&owner, name).await?;
    if let Some(by) = used.bindings_outside_caches(&owner, is_root) {
        return Err(TemplateError::DeleteWithBinding(by));
    }
    let owners = owners_to_disown(&owner, name).await?;
    db::alerts::templates::delete_as(&owner, name, is_root).await?;
    for owner in owners {
        remove_ownership(&owner, "templates", Authz::new(name)).await;
    }
    Ok(())
}

/// Parses wire kind names; the first unknown one is the error.
pub fn parse_applies_to(names: &[String]) -> Result<Vec<NotificationKind>, TemplateError> {
    let mut kinds = Vec::with_capacity(names.len());
    for name in names {
        let kind = NotificationKind::parse(name.trim())
            .ok_or_else(|| TemplateError::UnknownKind(name.clone()))?;
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    Ok(kinds)
}

/// Kinds the old list covered that the new one drops; an empty new list drops nothing.
pub(crate) fn dropped_kinds(
    old: &[NotificationKind],
    new: &[NotificationKind],
) -> Vec<NotificationKind> {
    if new.is_empty() {
        return Vec::new();
    }
    NotificationKind::ALL
        .into_iter()
        .filter(|k| (old.is_empty() || old.contains(k)) && !new.contains(k))
        .collect()
}

/// Narrowing rule: a dropped kind must have no level 1 or level 3 binding of this template.
async fn check_narrowing(
    existing: &Template,
    applies_to: &[NotificationKind],
    is_root: bool,
) -> Result<(), TemplateError> {
    for kind in dropped_kinds(&existing.applies_to, applies_to) {
        let by = bindings_for(&existing.org_id, &existing.name, kind).await?;
        if !by.is_empty() {
            return Err(TemplateError::InUseForKind {
                kind: kind.as_str().to_string(),
                by: describe_bindings(&by, &existing.org_id, is_root),
            });
        }
    }
    Ok(())
}

/// One reference to a template: the org that holds it and how an error names it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Binding {
    pub(crate) org: String,
    pub(crate) label: String,
}

impl Binding {
    fn new(org: String, label: String) -> Self {
        Self { org, label }
    }
}

/// Error text for `bindings`. A `default` template is shared, so its bindings can sit in other
/// orgs. Only root, or a caller in the binding's own org, sees the name; the rest is a count.
/// A non-root caller only reaches a template of its own org (`write_org`), so `caller_org` is
/// the template's org.
pub(crate) fn describe_bindings(bindings: &[Binding], caller_org: &str, is_root: bool) -> String {
    let (shown, hidden): (Vec<&Binding>, Vec<&Binding>) = bindings
        .iter()
        .partition(|b| is_root || b.org == caller_org);
    let mut parts: Vec<String> = shown.into_iter().map(|b| b.label.clone()).collect();
    if !hidden.is_empty() {
        parts.push(format!("{} in another organization", hidden.len()));
    }
    parts.join(", ")
}

/// A `default` template is shared, so its bindings are looked up in every org.
fn binding_scope(org_id: &str) -> Option<&str> {
    (org_id != DEFAULT_ORG).then_some(org_id)
}

/// Level 1 overrides of `kind` that name the template.
pub(crate) async fn bindings_for(
    org_id: &str,
    name: &str,
    kind: NotificationKind,
) -> Result<Vec<Binding>, TemplateError> {
    let mut by = Vec::new();
    match kind {
        NotificationKind::Anomaly => {
            let db_conn = infra::db::get_orm_client_ro().await;
            for (org, config) in infra::table::anomaly_detection::config::names_using_template(
                db_conn,
                binding_scope(org_id),
                name,
            )
            .await?
            {
                by.push(Binding::new(org, format!("anomaly config '{config}'")));
            }
        }
        NotificationKind::Synthetics => {
            let db_conn = infra::db::get_orm_client_ro().await;
            for (org, check) in infra::table::synthetics_checks::names_using_template(
                db_conn,
                binding_scope(org_id),
                name,
            )
            .await?
            {
                by.push(Binding::new(org, format!("synthetics check '{check}'")));
            }
        }
        NotificationKind::OnCall => {
            for (org, team) in
                infra::table::oncall_policies::teams_using_template(binding_scope(org_id), name)
                    .await?
            {
                by.push(Binding::new(
                    org,
                    format!("on-call policy of team '{team}'"),
                ));
            }
        }
        NotificationKind::Alert => {
            let (_, alerts) = db::alerts::templates::cached_references(org_id, name).await;
            by.extend(
                alerts
                    .into_iter()
                    .map(|(org, a)| Binding::new(org, format!("alert '{a}'"))),
            );
            let db_conn = infra::db::get_orm_client_ro().await;
            for (org, composite) in infra::table::alert_composites::names_using_template(
                db_conn,
                binding_scope(org_id),
                name,
            )
            .await?
            {
                by.push(Binding::new(org, format!("composite alert '{composite}'")));
            }
        }
        _ => {}
    }
    Ok(by)
}

/// Where a template is referenced (Data section 2, GET template).
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct UsedBy {
    pub destinations: usize,
    pub alerts: usize,
    pub anomaly: usize,
    pub synthetics: usize,
    pub on_call: usize,
    pub composites: usize,
    #[serde(skip)]
    binding_names: Vec<Binding>,
}

impl UsedBy {
    /// The references the cached delete guard does not see, as one message for the caller.
    fn bindings_outside_caches(&self, caller_org: &str, is_root: bool) -> Option<String> {
        (!self.binding_names.is_empty())
            .then(|| describe_bindings(&self.binding_names, caller_org, is_root))
    }
}

pub async fn used_by(org_id: &str, name: &str) -> Result<UsedBy, TemplateError> {
    let (destinations, alerts) = db::alerts::templates::cached_references(org_id, name).await;
    let anomaly_names: Vec<Binding> =
        infra::table::anomaly_detection::config::names_using_template(
            infra::db::get_orm_client_ro().await,
            binding_scope(org_id),
            name,
        )
        .await?
        .into_iter()
        .map(|(org, config)| Binding::new(org, format!("anomaly config '{config}'")))
        .collect();
    let synthetics_names: Vec<Binding> = infra::table::synthetics_checks::names_using_template(
        infra::db::get_orm_client_ro().await,
        binding_scope(org_id),
        name,
    )
    .await?
    .into_iter()
    .map(|(org, check)| Binding::new(org, format!("synthetics check '{check}'")))
    .collect();
    let on_call_names: Vec<Binding> =
        infra::table::oncall_policies::teams_using_template(binding_scope(org_id), name)
            .await?
            .into_iter()
            .map(|(org, team)| Binding::new(org, format!("on-call policy of team '{team}'")))
            .collect();
    let composite_names: Vec<Binding> = infra::table::alert_composites::names_using_template(
        infra::db::get_orm_client_ro().await,
        binding_scope(org_id),
        name,
    )
    .await?
    .into_iter()
    .map(|(org, composite)| Binding::new(org, format!("composite alert '{composite}'")))
    .collect();
    Ok(UsedBy {
        destinations: destinations.len(),
        alerts: alerts.len(),
        anomaly: anomaly_names.len(),
        synthetics: synthetics_names.len(),
        on_call: on_call_names.len(),
        composites: composite_names.len(),
        binding_names: anomaly_names
            .into_iter()
            .chain(synthetics_names)
            .chain(on_call_names)
            .chain(composite_names)
            .collect(),
    })
}

/// `used_by` for every template name of the org, aggregated once for the list (no query per row).
/// Names without references are absent. `binding_names` stays empty: the list carries counts only.
pub async fn all_used_by(org_id: &str) -> Result<HashMap<String, UsedBy>, TemplateError> {
    let scope = binding_scope(org_id);
    let (destinations, alerts) = db::alerts::templates::cached_reference_counts(org_id).await;
    let db_conn = infra::db::get_orm_client_ro().await;
    let anomaly = infra::table::anomaly_detection::config::templates_in_use(db_conn, scope).await?;
    let synthetics = infra::table::synthetics_checks::templates_in_use(db_conn, scope).await?;
    let on_call = infra::table::oncall_policies::templates_in_use(scope).await?;
    let composites = infra::table::alert_composites::templates_in_use(db_conn, scope).await?;
    Ok(fold_used_by(
        destinations,
        alerts,
        [anomaly, synthetics, on_call, composites],
    ))
}

/// `used_by` for each listed template, in order. One aggregate per owner org, usually one or two.
pub async fn list_used_by(
    request_org: &str,
    templates: &[Template],
) -> Result<Vec<UsedBy>, TemplateError> {
    let mut by_owner: HashMap<String, HashMap<String, UsedBy>> = HashMap::new();
    for t in templates {
        let owner = usage_owner(request_org, &t.org_id);
        if !by_owner.contains_key(owner) {
            let usage = all_used_by(owner).await?;
            by_owner.insert(owner.to_string(), usage);
        }
    }
    Ok(pick_used_by(request_org, templates, &by_owner))
}

/// A level 1 or level 3 binding must name a user template that applies to `kind`.
pub async fn check_binding(org_id: &str, name: &str, kind: NotificationKind) -> Result<(), String> {
    let template = db::alerts::templates::get(org_id, name)
        .await
        .map_err(|_| format!("template '{name}' does not exist"))?;
    if is_reserved_template_name(&template.name) {
        return Err(format!("template '{name}' is reserved"));
    }
    if !template.applies_to_kind(kind) {
        return Err(format!(
            "template '{name}' does not apply to {}",
            kind.as_str()
        ));
    }
    Ok(())
}

/// The list filter of `GET templates?applies_to=&type=`.
#[derive(Clone, Copy, Debug, Default)]
pub struct ListFilter {
    pub applies_to: Option<NotificationKind>,
    /// Custom templates of other types are dropped; Content fits every type.
    pub template_type: Option<TemplateTypeFilter>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TemplateTypeFilter {
    Http,
    Email,
    Sns,
}

impl TemplateTypeFilter {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "http" => Some(Self::Http),
            "email" => Some(Self::Email),
            "sns" => Some(Self::Sns),
            _ => None,
        }
    }

    fn matches(self, t: &TemplateType) -> bool {
        matches!(
            (self, t),
            (Self::Http, TemplateType::Http)
                | (Self::Email, TemplateType::Email { .. })
                | (Self::Sns, TemplateType::Sns)
        )
    }
}

/// With a kind: user templates that apply to it, Content first; reserved rows are left out.
pub fn apply_list_filter(templates: Vec<Template>, filter: ListFilter) -> Vec<Template> {
    let keep_type = |t: &Template| match filter.template_type {
        Some(ty) => t.kind == TemplateKind::Content || ty.matches(&t.template_type),
        None => true,
    };
    let Some(kind) = filter.applies_to else {
        return templates.into_iter().filter(keep_type).collect();
    };
    let (content, custom): (Vec<_>, Vec<_>) = templates
        .into_iter()
        .filter(|t| !is_reserved_template_name(&t.name) && t.applies_to_kind(kind))
        .filter(keep_type)
        .partition(|t| t.kind == TemplateKind::Content);
    content.into_iter().chain(custom).collect()
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

    // A row an old node created under the reserved prefix moves before the seed lands.
    match db::alerts::templates::rename_reserved_collisions().await {
        Ok(renames) => {
            for r in renames {
                log::info!(
                    "[TEMPLATES] renamed reserved template '{}' in org {} to '{}'",
                    r.from,
                    r.org,
                    r.to
                );
            }
        }
        Err(e) => log::error!("[TEMPLATES] reserved name rename failed: {e}"),
    }

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
        "jira",
        "email",
    ];

    let mut created_count = 0;
    let mut updated_count = 0;
    let mut skipped_count = 0;

    let prebuilt = prebuilt_types.into_iter().filter_map(get_prebuilt_template);
    for mut template in prebuilt {
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
                                "[TEMPLATES] Failed to update system template '{}' in {}: {}",
                                template.name,
                                DEFAULT_ORG,
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
                            "[TEMPLATES] Failed to create system template '{}' in {}: {}",
                            template.name,
                            DEFAULT_ORG,
                            e
                        );
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "[TEMPLATES] Error checking system template '{}' in {}: {}",
                    template.name,
                    DEFAULT_ORG,
                    e
                );
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
    // An old node reseeds the retired rows during a rolling upgrade, so every boot folds them
    // again.
    match db::alerts::templates::retire_default_templates().await {
        Ok(moved) => {
            for r in moved {
                log::info!("[TEMPLATES] retired template '{}' into '{}'", r.from, r.to);
            }
        }
        Err(e) => log::error!("[TEMPLATES] retiring the old default templates failed: {e}"),
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

/// Owners whose template tuple a delete removes; a legacy tuple a live org shares stays.
async fn owners_to_disown(org_id: &str, name: &str) -> Result<Vec<String>, TemplateError> {
    let name = name.to_string();
    let mut owners =
        db::alerts::templates::tuple_owners(org_id, std::slice::from_ref(&name)).await?;
    Ok(owners.remove(&name).unwrap_or_default())
}

/// Folds cache counts and one template name per consumer row into `UsedBy` per name.
/// `rows` is anomaly, synthetics, on_call, composites, in that order.
fn fold_used_by(
    destinations: HashMap<String, usize>,
    alerts: HashMap<String, usize>,
    rows: [Vec<String>; 4],
) -> HashMap<String, UsedBy> {
    let mut by_name: HashMap<String, UsedBy> = HashMap::new();
    for (name, n) in destinations {
        by_name.entry(name).or_default().destinations += n;
    }
    for (name, n) in alerts {
        by_name.entry(name).or_default().alerts += n;
    }
    let [anomaly, synthetics, on_call, composites] = rows;
    for name in anomaly {
        by_name.entry(name).or_default().anomaly += 1;
    }
    for name in synthetics {
        by_name.entry(name).or_default().synthetics += 1;
    }
    for name in on_call {
        by_name.entry(name).or_default().on_call += 1;
    }
    for name in composites {
        by_name.entry(name).or_default().composites += 1;
    }
    by_name
}

/// The org whose references count for a listed template: its owner, as GET template uses.
/// A default-org template listed in another org counts references in every org.
fn usage_owner<'a>(request_org: &'a str, template_org: &'a str) -> &'a str {
    if template_org.is_empty() {
        request_org
    } else {
        template_org
    }
}

/// Each template's counts from its owner org's aggregate; a name with no references is zero.
fn pick_used_by(
    request_org: &str,
    templates: &[Template],
    by_owner: &HashMap<String, HashMap<String, UsedBy>>,
) -> Vec<UsedBy> {
    templates
        .iter()
        .map(|t| {
            by_owner
                .get(usage_owner(request_org, &t.org_id))
                .and_then(|by_name| by_name.get(&t.name))
                .cloned()
                .unwrap_or_default()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_used_by_counts_every_reference_kind_per_name() {
        let names = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let by_name = fold_used_by(
            HashMap::from([("a".to_string(), 2)]),
            HashMap::from([("a".to_string(), 1), ("b".to_string(), 3)]),
            [
                names(&["a", "c"]),
                names(&["c", "c"]),
                names(&["a"]),
                names(&["b"]),
            ],
        );
        let get = |n: &str| {
            let u = &by_name[n];
            (
                u.destinations,
                u.alerts,
                u.anomaly,
                u.synthetics,
                u.on_call,
                u.composites,
            )
        };
        assert_eq!(get("a"), (2, 1, 1, 0, 1, 0));
        assert_eq!(get("b"), (0, 3, 0, 0, 0, 1));
        // A template bound only to a detector and checks is in use (B3).
        assert_eq!(get("c"), (0, 0, 1, 2, 0, 0));
        assert_eq!(by_name.len(), 3);
        assert!(fold_used_by(HashMap::new(), HashMap::new(), Default::default()).is_empty());
    }

    #[test]
    fn pick_used_by_reads_each_template_from_its_owner_org() {
        let tpl = |org: &str, name: &str| Template {
            org_id: org.to_string(),
            name: name.to_string(),
            ..Default::default()
        };
        let used = |anomaly: usize| UsedBy {
            anomaly,
            ..Default::default()
        };
        let by_owner = HashMap::from([
            (
                "org1".to_string(),
                HashMap::from([
                    ("shared".to_string(), used(1)),
                    ("own".to_string(), used(2)),
                ]),
            ),
            (
                DEFAULT_ORG.to_string(),
                HashMap::from([("shared".to_string(), used(7))]),
            ),
        ]);
        let picked = pick_used_by(
            "org1",
            &[
                tpl(DEFAULT_ORG, "shared"),
                tpl("org1", "own"),
                tpl("org1", "unused"),
                tpl("", "own"),
            ],
            &by_owner,
        );
        // The default-org template takes the every-org count, not org1's.
        assert_eq!(
            picked.iter().map(|u| u.anomaly).collect::<Vec<_>>(),
            vec![7, 2, 0, 2]
        );
        assert!(pick_used_by("org1", &[], &by_owner).is_empty());
    }

    #[test]
    fn usage_owner_is_the_template_org_as_get_template_uses() {
        // A default-org template listed in org1 counts references in every org, as GET does.
        assert_eq!(usage_owner("org1", DEFAULT_ORG), DEFAULT_ORG);
        assert_eq!(usage_owner("org1", "org1"), "org1");
        // A row with no stored org falls back to the org of the request.
        assert_eq!(usage_owner("org1", ""), "org1");
        assert_eq!(binding_scope(DEFAULT_ORG), None);
        assert_eq!(binding_scope("org1"), Some("org1"));
    }

    fn user(name: &str, kind: TemplateKind, applies_to: Vec<NotificationKind>) -> Template {
        Template {
            name: name.to_string(),
            kind,
            applies_to,
            ..Default::default()
        }
    }

    #[test]
    fn narrowing_drops_only_kinds_the_old_list_covered() {
        use NotificationKind::*;
        assert!(dropped_kinds(&[], &[]).is_empty());
        assert!(dropped_kinds(&[Anomaly], &[]).is_empty());
        assert_eq!(
            dropped_kinds(&[Anomaly, Incident], &[Incident]),
            vec![Anomaly]
        );
        assert_eq!(
            dropped_kinds(&[], &[Anomaly]),
            vec![Alert, Incident, Synthetics, Downtime, OnCall]
        );
        assert!(dropped_kinds(&[Incident], &[Incident, Anomaly]).is_empty());
    }

    #[test]
    fn applies_to_rejects_an_unknown_kind_with_the_allowed_list() {
        let err = parse_applies_to(&["anomaly".to_string(), "pages".to_string()]).unwrap_err();
        assert_eq!(
            err.to_string(),
            "applies_to: unknown kind 'pages'; allowed: alert, incident, anomaly, synthetics, downtime, on_call"
        );
        assert_eq!(
            parse_applies_to(&["on_call".to_string(), "on_call".to_string()]).unwrap(),
            vec![NotificationKind::OnCall]
        );
    }

    #[test]
    fn the_kind_filter_lists_user_templates_that_apply_content_first() {
        use NotificationKind::*;
        let email = Template {
            template_type: TemplateType::Email {
                title: "t".to_string(),
            },
            ..user("mail", TemplateKind::Custom, vec![])
        };
        let all = vec![
            user("a-hook", TemplateKind::Custom, vec![]),
            user("b-card", TemplateKind::Content, vec![Anomaly]),
            user("c-incident", TemplateKind::Content, vec![Incident]),
            user("prebuilt_default", TemplateKind::Content, vec![]),
            user("prebuilt_slack", TemplateKind::Content, vec![]),
            email,
        ];
        let names = |filter| -> Vec<String> {
            apply_list_filter(all.clone(), filter)
                .into_iter()
                .map(|t| t.name)
                .collect()
        };
        assert_eq!(
            names(ListFilter {
                applies_to: Some(Anomaly),
                template_type: None,
            }),
            vec!["b-card", "a-hook", "mail"]
        );
        assert_eq!(
            names(ListFilter {
                applies_to: Some(Anomaly),
                template_type: Some(TemplateTypeFilter::Http),
            }),
            vec!["b-card", "a-hook"]
        );
        // Without a kind the list is unchanged, reserved rows included.
        assert_eq!(names(ListFilter::default()).len(), all.len());
    }

    #[tokio::test]
    async fn creating_any_name_under_the_reserved_prefix_is_refused() {
        for name in [
            "prebuilt_default",
            "o2_default_anomaly",
            "o2_default_x",
            "prebuilt_downtime",
        ] {
            let template = Template {
                org_id: "acme".to_string(),
                body: "{}".to_string(),
                ..Default::default()
            };
            let err = save(name, template, None, None, true, false)
                .await
                .unwrap_err();
            assert!(
                matches!(err, TemplateError::ReservedName(ref n) if n == name),
                "{name}: {err}"
            );
        }
    }

    #[tokio::test]
    async fn root_cannot_update_or_delete_a_seeded_default_row() {
        let template = Template {
            org_id: DEFAULT_ORG.to_string(),
            body: "{}".to_string(),
            ..Default::default()
        };
        let err = save("prebuilt_default", template, None, None, false, true)
            .await
            .unwrap_err();
        assert!(
            matches!(err, TemplateError::PrebuiltReadOnly(ref n) if n == "prebuilt_default"),
            "{err}"
        );
        let err = delete(DEFAULT_ORG, "prebuilt_default", true)
            .await
            .unwrap_err();
        assert!(
            matches!(err, TemplateError::PrebuiltReadOnly(ref n) if n == "prebuilt_default"),
            "{err}"
        );
    }

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    /// Every firing of a composite whose template is gone fails before any destination is tried.
    #[tokio::test]
    async fn test_a_template_only_a_composite_uses_is_not_deleted() {
        use infra::table::entity::alert_composites;
        use sea_orm::ActiveValue::Set;

        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let (org, name) = (format!("t_comp_org_{suffix}"), format!("t_comp_{suffix}"));
        let template = Template {
            org_id: org.clone(),
            name: name.clone(),
            body: "{}".to_string(),
            ..Default::default()
        };
        infra::table::templates::put(template).await.unwrap();
        let composite = alert_composites::ActiveModel {
            id: Set(format!("t_comp_id_{suffix}")),
            org: Set(org.clone()),
            folder_id: Set("default".to_string()),
            name: Set("the composite".to_string()),
            description: Set(None),
            expression: Set("true".to_string()),
            warning_counts_as_firing: Set(false),
            stale_child_policy: Set(0),
            destinations: Set(serde_json::json!([])),
            template: Set(Some(name.clone())),
            context_attributes: Set(None),
            enabled: Set(true),
            silence_seconds: Set(0),
            creates_incident: Set(false),
            workflows: Set(serde_json::json!([])),
            priority: Set(None),
            tags: Set(None),
            owner: Set(None),
            last_edited_by: Set(None),
            updated_at: Set(None),
            evaluation_generation: Set(0),
            pending_period_sec: Set(0),
            incident_title_template: Set(None),
        };
        infra::table::alert_composites::create_with_children(
            infra::db::get_orm_client_rw().await,
            composite,
            vec![],
        )
        .await
        .unwrap();

        let refused = delete(&org, &name, false).await;
        assert!(
            matches!(&refused, Err(TemplateError::DeleteWithBinding(by)) if by.contains("the composite")),
            "{refused:?}"
        );
        // Narrowing `applies_to` would leave the composite on a template its next save refuses.
        let bound = bindings_for(&org, &name, NotificationKind::Alert)
            .await
            .unwrap();
        assert_eq!(
            bound,
            vec![Binding::new(
                org.clone(),
                "composite alert 'the composite'".to_string()
            )]
        );
    }

    #[test]
    fn describe_bindings_names_only_what_the_caller_may_see() {
        let labels = [
            "anomaly config 'a'",
            "synthetics check 'c'",
            "on-call policy of team 't'",
            "composite alert 'x'",
            "alert 'y'",
        ];
        for label in labels {
            let own = vec![Binding::new(DEFAULT_ORG.to_string(), label.to_string())];
            let other = vec![Binding::new("acme".to_string(), label.to_string())];
            // Same org and root see the name.
            assert_eq!(describe_bindings(&own, DEFAULT_ORG, false), label);
            assert_eq!(describe_bindings(&other, DEFAULT_ORG, true), label);
            // A non-root caller of another org gets a count only.
            assert_eq!(
                describe_bindings(&other, DEFAULT_ORG, false),
                "1 in another organization"
            );
        }
        let mixed = vec![
            Binding::new(DEFAULT_ORG.to_string(), "alert 'mine'".to_string()),
            Binding::new("acme".to_string(), "alert 'theirs'".to_string()),
            Binding::new("beta".to_string(), "alert 'more'".to_string()),
        ];
        assert_eq!(
            describe_bindings(&mixed, DEFAULT_ORG, false),
            "alert 'mine', 2 in another organization"
        );
        assert_eq!(
            describe_bindings(&mixed, DEFAULT_ORG, true),
            "alert 'mine', alert 'theirs', alert 'more'"
        );
    }

    /// A non-root `default` admin must not read another org's binding names (B41).
    #[tokio::test]
    async fn test_a_shared_template_hides_another_orgs_binding_names() {
        use infra::table::entity::alert_composites;
        use sea_orm::ActiveValue::Set;

        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let (other, name) = (format!("t_b41_org_{suffix}"), format!("t_b41_{suffix}"));
        let template = Template {
            org_id: DEFAULT_ORG.to_string(),
            name: name.clone(),
            body: "{}".to_string(),
            is_default: true,
            ..Default::default()
        };
        infra::table::templates::put(template.clone())
            .await
            .unwrap();
        let composite = alert_composites::ActiveModel {
            id: Set(format!("t_b41_id_{suffix}")),
            org: Set(other.clone()),
            folder_id: Set("default".to_string()),
            name: Set("secret composite".to_string()),
            description: Set(None),
            expression: Set("true".to_string()),
            warning_counts_as_firing: Set(false),
            stale_child_policy: Set(0),
            destinations: Set(serde_json::json!([])),
            template: Set(Some(name.clone())),
            context_attributes: Set(None),
            enabled: Set(true),
            silence_seconds: Set(0),
            creates_incident: Set(false),
            workflows: Set(serde_json::json!([])),
            priority: Set(None),
            tags: Set(None),
            owner: Set(None),
            last_edited_by: Set(None),
            updated_at: Set(None),
            evaluation_generation: Set(0),
            pending_period_sec: Set(0),
            incident_title_template: Set(None),
        };
        infra::table::alert_composites::create_with_children(
            infra::db::get_orm_client_rw().await,
            composite,
            vec![],
        )
        .await
        .unwrap();

        // Single and bulk delete both run `delete`.
        let refused = delete(DEFAULT_ORG, &name, false).await;
        assert!(
            matches!(&refused, Err(TemplateError::DeleteWithBinding(by)) if by == "1 in another organization"),
            "{refused:?}"
        );
        let refused = delete(DEFAULT_ORG, &name, true).await;
        assert!(
            matches!(&refused, Err(TemplateError::DeleteWithBinding(by)) if by.contains("secret composite")),
            "{refused:?}"
        );

        // Narrowing `applies_to` off `alert`.
        let narrowed = save(
            &name,
            template.clone(),
            None,
            Some(vec![NotificationKind::Incident]),
            false,
            false,
        )
        .await;
        assert!(
            matches!(&narrowed, Err(TemplateError::InUseForKind { by, .. }) if by == "1 in another organization"),
            "{narrowed:?}"
        );
        let narrowed = save(
            &name,
            template,
            None,
            Some(vec![NotificationKind::Incident]),
            false,
            true,
        )
        .await;
        assert!(
            matches!(&narrowed, Err(TemplateError::InUseForKind { by, .. }) if by.contains("secret composite")),
            "{narrowed:?}"
        );
    }

    #[tokio::test]
    async fn test_single_delete_disowns_only_tracked_owners_and_an_unshared_legacy_tuple() {
        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let (org, other) = (format!("t_sd_org_{suffix}"), format!("t_sd_other_{suffix}"));
        let (solo, shared) = (
            format!("t_sd_solo_{suffix}"),
            format!("t_sd_shared_{suffix}"),
        );
        for (owner, name) in [(&org, &solo), (&org, &shared), (&other, &shared)] {
            let template = Template {
                org_id: owner.to_string(),
                name: name.to_string(),
                body: "{}".to_string(),
                ..Default::default()
            };
            infra::table::templates::put(template).await.unwrap();
        }
        infra::table::organizations::add(
            &other,
            &other,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        let solo_owners = owners_to_disown(&org, &solo).await.unwrap();
        let shared_owners = owners_to_disown(&org, &shared).await.unwrap();
        infra::table::templates::delete_by_org(&org).await.unwrap();
        infra::table::templates::delete_by_org(&other)
            .await
            .unwrap();
        infra::table::organizations::remove(&other).await.unwrap();

        // Without OpenFGA there are no tuples, so the delete looks up no owners.
        let tracked = |owners: &[&str]| -> Vec<String> {
            if !db::authz::tracks_ownership() {
                return vec![];
            }
            owners.iter().map(|o| o.to_string()).collect()
        };
        assert_eq!(solo_owners, tracked(&[org.as_str(), solo.as_str()]));
        assert_eq!(shared_owners, tracked(&[org.as_str()]));
    }

    #[test]
    fn test_new_template_ownership_names_its_org() {
        let template = Template {
            org_id: "acme".to_string(),
            name: "tpl_acme".to_string(),
            ..Default::default()
        };
        let (owner, object) = ownership_of(&template);
        assert_eq!((owner, object.obj_id.as_str()), ("acme", "tpl_acme"));
        #[cfg(feature = "enterprise")]
        {
            let tuples = db::authz::ownership_tuples(owner, "templates", &object);
            let shapes: Vec<_> = tuples
                .iter()
                .map(|t| (t.user.as_str(), t.relation.as_str(), t.object.as_str()))
                .collect();
            assert_eq!(shapes, [("org:acme", "owningOrg", "template:tpl_acme")]);
        }
    }

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
    fn test_write_org_keeps_the_path_org_for_non_root() {
        assert_eq!(write_org("acme", "acme", false).unwrap(), "acme");
        assert!(matches!(
            write_org("acme", DEFAULT_ORG, false),
            Err(TemplateError::NotFound)
        ));
        assert_eq!(write_org("acme", DEFAULT_ORG, true).unwrap(), DEFAULT_ORG);
    }

    #[tokio::test]
    async fn test_save_non_root_update_of_a_default_template_is_not_found() {
        let name = "tpl_scope_shared";
        let shared = Template {
            org_id: DEFAULT_ORG.to_string(),
            name: name.to_string(),
            body: "shared".to_string(),
            template_type: TemplateType::Http,
            ..Default::default()
        };
        common::infra::config::ALERTS_TEMPLATES.insert(format!("{DEFAULT_ORG}/{name}"), shared);
        let mut mine = Template {
            org_id: "tpl_scope_acme".to_string(),
            name: name.to_string(),
            body: "mine".to_string(),
            template_type: TemplateType::Http,
            ..Default::default()
        };
        let err = save(name, mine.clone(), None, None, false, false)
            .await
            .unwrap_err();
        assert!(matches!(err, TemplateError::NotFound), "{err}");
        mine.org_id = DEFAULT_ORG.to_string();
        let err = save(name, mine, None, None, true, false).await.unwrap_err();
        assert!(matches!(err, TemplateError::AlreadyExists), "{err}");
    }

    #[tokio::test]
    async fn test_delete_non_root_of_a_default_template_is_not_found() {
        let name = "tpl_scope_shared_delete";
        let shared = Template {
            org_id: DEFAULT_ORG.to_string(),
            name: name.to_string(),
            body: "shared".to_string(),
            template_type: TemplateType::Http,
            ..Default::default()
        };
        common::infra::config::ALERTS_TEMPLATES.insert(format!("{DEFAULT_ORG}/{name}"), shared);
        let err = delete("tpl_scope_acme", name, false).await.unwrap_err();
        assert!(matches!(err, TemplateError::NotFound), "{err}");
    }

    #[tokio::test]
    async fn test_save_refuses_a_name_over_256_chars_on_create() {
        let template = Template {
            org_id: "tpl_long_acme".to_string(),
            body: "{}".to_string(),
            template_type: TemplateType::Http,
            ..Default::default()
        };
        let err = save(&"é".repeat(257), template, None, None, true, false)
            .await
            .unwrap_err();
        assert!(matches!(err, TemplateError::NameTooLong(256)), "{err}");
    }

    /// A blank Content title is refused on save; 256 characters pass the name check first.
    #[tokio::test]
    async fn test_save_refuses_a_blank_content_title() {
        for title in ["", "   "] {
            let body = serde_json::json!({ "title": title, "body": "hi" }).to_string();
            let template = Template {
                org_id: "tpl_title_acme".to_string(),
                body,
                template_type: TemplateType::Http,
                ..Default::default()
            };
            let err = save(
                &"é".repeat(256),
                template,
                Some(TemplateKind::Content),
                None,
                true,
                false,
            )
            .await
            .unwrap_err();
            assert!(matches!(err, TemplateError::EmptyTitle), "{title:?}: {err}");
        }
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
