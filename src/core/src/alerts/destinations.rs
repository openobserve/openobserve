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

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

use config::{
    get_config,
    meta::{
        destinations::{
            Destination, DestinationType, Email, Endpoint, Module, SecretBindInput, SecretBindPin,
            Template,
        },
        secret_store::{
            BindRequest, ConsumerType, Decision, GateState, ORG_ENV_ID, SecretErrorCode,
            digest::{BoundRef, DepEntry, KAuth},
            grammar::{self, RefKind, RefToken, Slot},
        },
        user::UserRole,
    },
};
use db::{
    self,
    alerts::{destinations::DestinationError, templates::TemplateError},
    authz::{remove_ownership, set_ownership},
    org_users, user,
};
use infra::{
    db::get_orm_client_rw,
    errors::Error as InfraError,
    secret_store::{
        bind::{self, BindError, BindPin, BindPlan, Preflight, SecretBindOption, StrictVerb},
        gate,
        reauthorize::{ConsumerImage, k_auth_for},
        resolver::named_policies_in,
        respell::{self, RespellTarget},
    },
    table::{
        self, org_secrets, secret_consumer_auth, secret_dependencies, secret_refs,
        templates::NAME_MAX_CHARS,
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseTransaction, EntityTrait, QueryFilter,
    QuerySelect, TransactionTrait,
};
use serde_json::{Value, json};

#[cfg(not(test))]
use crate::authz::check_strict as check_secret_permission;
use crate::{auth::is_ofga_unsupported, common::meta::authz::Authz};

#[cfg(test)]
tokio::task_local! {
    static SECRET_GRANTS: BTreeSet<(String, String)>;
}

#[derive(Clone, Debug)]
pub struct SavePrincipal {
    pub user_id: String,
    pub role: UserRole,
}

impl SavePrincipal {
    pub async fn for_user(org: &str, user_id: &str) -> Result<Self, SecretRefusal> {
        if user_id.is_empty() {
            return Err(SecretErrorCode::SecretUseDenied.into());
        }
        let role = if user::is_root_user(user_id) {
            UserRole::Root
        } else {
            org_users::get_optional(org, user_id)
                .await
                .map_err(|_| SecretErrorCode::PermissionsUnavailable)?
                .ok_or(SecretErrorCode::SecretUseDenied)?
                .role
        };
        Ok(Self {
            user_id: user_id.into(),
            role,
        })
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{code}")]
pub struct SecretRefusal {
    pub code: SecretErrorCode,
    pub secret: Option<String>,
    pub suggested_hosts: Vec<String>,
    pub consumer_type: Option<String>,
    pub consumer_id: Option<String>,
}

impl SecretRefusal {
    pub fn status(&self) -> u16 {
        match self.code {
            SecretErrorCode::SecretConflict | SecretErrorCode::SecretUnbound => 409,
            code => code.http_status().unwrap_or(503),
        }
    }

    pub fn body(&self) -> Value {
        use SecretErrorCode::*;
        let message = match self.code {
            SecretUseDenied => {
                "You do not have permission to save this destination with the requested secret."
            }
            SecretNotFound => "The secret does not exist.",
            SecretAccessRequired => {
                "Changing this secret binding requires access-management permission."
            }
            PermissionsUnavailable => "The permission service is unavailable.",
            ConsumerNotAllowed => "The secret policy does not allow this destination.",
            SecretPinRequired => "Pin the secret to an allowed host before saving.",
            PinMismatch => "The destination URL does not match the secret's allowed hosts.",
            NoOrgValue => "This destination requires an organization-wide secret value.",
            PolicyChanged => "The destination or secret policy changed. Retry the save.",
            StoreGateClosed | StoreDisabled => "The secret store is not accepting bindings.",
            RefNotAllowedInField => "This field does not accept store references.",
            RefTypo => "Check the spelling of the store reference.",
            TemplatedAuthorityRefused => {
                "Use a literal scheme, host and port for this destination."
            }
            AuthorityOverrideRefused => "Remove the Host or :authority header.",
            InsecureTransport => "Use HTTPS with TLS verification enabled.",
            PinEntryInvalid | PinHostsEmpty => "Supply at least one valid host to pin this secret.",
            SecretMetadataTooLarge => "The binding would exceed the secret metadata limit.",
            SaveBeforeTest => "Save, then test.",
            SecretUnbound => "The destination has no saved secret binding.",
            _ => "The destination's secret binding could not be saved.",
        };
        let mut body = json!({"code": self.code, "message": message});
        if let Some(name) = &self.secret {
            body["secret"] = json!(name);
        }
        if self.code == SecretErrorCode::SecretPinRequired {
            body["suggested_hosts"] = json!(self.suggested_hosts);
        }
        if let Some(ty) = &self.consumer_type {
            body["consumer_type"] = json!(ty);
        }
        if let Some(id) = &self.consumer_id {
            body["consumer_id"] = json!(id);
        }
        body
    }

    fn named(code: SecretErrorCode, name: &str) -> Self {
        Self {
            secret: Some(name.to_owned()),
            ..code.into()
        }
    }
}

impl From<SecretErrorCode> for SecretRefusal {
    fn from(code: SecretErrorCode) -> Self {
        Self {
            code,
            secret: None,
            suggested_hosts: vec![],
            consumer_type: None,
            consumer_id: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DestinationSaveError {
    #[error(transparent)]
    Destination(#[from] DestinationError),
    #[error(transparent)]
    Secret(#[from] SecretRefusal),
}

impl From<DestinationSaveError> for DestinationError {
    fn from(error: DestinationSaveError) -> Self {
        match error {
            DestinationSaveError::Destination(e) => e,
            DestinationSaveError::Secret(e) => Self::InfraError(InfraError::SecretStore(e.code)),
        }
    }
}

struct Dependencies {
    keys: Vec<String>,
    names: BTreeMap<String, String>,
    entries: Vec<DepEntry>,
}

impl Dependencies {
    fn require_present(&self, role: &str) -> Result<(), SecretRefusal> {
        for entry in &self.entries {
            if let DepEntry::Absent { name } = entry {
                return Err(SecretRefusal::named(bind::missing_secret_code(role), name));
            }
        }
        Ok(())
    }
}

struct RefSlot {
    field: String,
    tokens: Vec<RefToken>,
    changed: bool,
}

struct PreparedBind {
    destination: Destination,
    plan: BindPlan,
    typed_names: BTreeMap<String, String>,
    changed_uses: BTreeSet<(String, StrictVerb)>,
}

impl PreparedBind {
    fn refusal(&self, error: BindError) -> SecretRefusal {
        let mut refusal = SecretRefusal::from(error.code());
        let id = match error {
            BindError::PinRequired {
                secret_id,
                suggested_hosts,
            } => {
                refusal.suggested_hosts = suggested_hosts;
                secret_id
            }
            BindError::ConsumerNotAllowed {
                secret_id,
                consumer_type,
                consumer_id,
            } => {
                refusal.consumer_type = Some(consumer_type.as_str().into());
                refusal.consumer_id = Some(consumer_id);
                secret_id
            }
            _ => return refusal,
        };
        refusal.secret = Some(self.typed_names.get(&id).cloned().unwrap_or(id));
        refusal
    }

    async fn strict_checks(
        &self,
        actor: &SavePrincipal,
        checked: &Preflight,
    ) -> Result<(), SecretRefusal> {
        for (id, verb) in &checked.checks {
            let (resource, method, denied) = match verb {
                StrictVerb::Use => ("secrets", "GET", SecretErrorCode::SecretUseDenied),
                StrictVerb::Manage => ("secrets", "PUT", SecretErrorCode::SecretUseDenied),
                StrictVerb::AccessPut => (
                    "secret_access",
                    "PUT",
                    SecretErrorCode::SecretAccessRequired,
                ),
            };
            let object = format!("{resource}:{id}");
            let decision = check_secret_permission(
                &self.plan.org_id,
                &actor.user_id,
                actor.role.clone(),
                &object,
                method,
            )
            .await?;
            if decision == Decision::Deny {
                return Err(SecretRefusal::named(
                    denied,
                    self.typed_names.get(id).unwrap_or(id),
                ));
            }
        }
        Ok(())
    }
}

struct BindSave<'a> {
    destination: Destination,
    previous: Option<&'a Destination>,
    slots: Vec<RefSlot>,
    actor: &'a SavePrincipal,
    binds: Vec<SecretBindOption>,
    refusal: OnceLock<SecretRefusal>,
    key: tokio::sync::OnceCell<KAuth>,
}

impl BindSave<'_> {
    fn record(&self, refusal: SecretRefusal) -> BindError {
        let code = refusal.code;
        self.refusal.get_or_init(|| refusal);
        BindError::Code(code)
    }

    async fn prepare<C: ConnectionTrait>(&self, db: &C) -> Result<PreparedBind, BindError> {
        prepare_bind(
            db,
            &self.destination,
            self.previous,
            &self.slots,
            self.actor,
            &self.binds,
        )
        .await
        .map_err(|e| self.record(e))
    }

    async fn preflight(&self) -> Result<Preflight, BindError> {
        let db = get_orm_client_rw().await;
        let prepared = self.prepare(db).await?;
        let key = self
            .key
            .get_or_try_init(|| k_auth_for(&self.destination.org_id))
            .await?;
        let mut checked = bind::preflight_in(db, &prepared.plan, key).await?;
        checked.checks.extend(prepared.changed_uses.iter().cloned());
        prepared
            .strict_checks(self.actor, &checked)
            .await
            .map_err(|e| self.record(e))?;
        Ok(checked)
    }

    async fn write_in(
        &self,
        txn: &DatabaseTransaction,
        checked: &Preflight,
        key: &KAuth,
    ) -> Result<(Destination, Option<BindRequest>), BindError> {
        lock_destination(txn, &self.destination, self.previous).await?;
        let prepared = self.prepare(txn).await?;
        if !prepared.changed_uses.is_subset(&checked.checks) {
            return Err(BindError::Retry);
        }
        let saved = table::destinations::put_in(txn, prepared.destination.clone()).await?;
        if saved.id != self.destination.id {
            return Err(BindError::Retry);
        }
        if let Some(old) = self
            .previous
            .filter(|old| consumer_type(old) != prepared.plan.consumer_type)
        {
            remove_binding(txn, old).await?;
        }
        let request = match bind::bind_in(txn, &prepared.plan, checked, key).await {
            Ok(request) => request,
            Err(BindError::Retry) => return Err(BindError::Retry),
            Err(e) => return Err(self.record(prepared.refusal(e))),
        };
        // The policy locks now cover every resolved name. A rename or dependency edit during
        // preparation must not leave a newly signed stale snapshot.
        for bound in &prepared.plan.refs {
            if !org_secrets::get_secret_in(txn, &prepared.plan.org_id, &bound.secret_id)
                .await?
                .is_some_and(|row| row.name == bound.token_name)
            {
                return Err(BindError::Retry);
            }
        }
        let variables = self
            .slots
            .iter()
            .flat_map(|s| &s.tokens)
            .filter(|t| t.kind == RefKind::Var)
            .map(|t| t.name.clone())
            .collect();
        let deps = dependencies(txn, &prepared.plan.org_id, &variables)
            .await
            .map_err(|e| self.record(e))?;
        if deps.keys != prepared.plan.dep_keys
            || !deps.names.keys().eq(&prepared.plan.dep_secret_ids)
            || prepared.plan.image.deps.get(ORG_ENV_ID) != Some(&deps.entries)
        {
            return Err(BindError::Retry);
        }
        Ok((saved, request))
    }

    async fn attempt(
        &self,
        checked: Preflight,
        saved: &OnceLock<Destination>,
    ) -> Result<Option<BindRequest>, BindError> {
        let txn = get_orm_client_rw()
            .await
            .begin()
            .await
            .map_err(InfraError::from)?;
        let key = self.key.get().ok_or(SecretErrorCode::SecretUnavailable)?;
        match self.write_in(&txn, &checked, key).await {
            Ok((destination, request)) => {
                txn.commit().await.map_err(InfraError::from)?;
                saved.get_or_init(|| destination);
                Ok(request)
            }
            Err(e) => {
                txn.rollback().await.map_err(InfraError::from)?;
                Err(e)
            }
        }
    }
}

/// Respells a destination's refs after a secret rename, under the same image its save signs.
pub struct DestinationRespell(pub ConsumerType);

#[async_trait::async_trait]
impl RespellTarget for DestinationRespell {
    fn consumer_type(&self) -> ConsumerType {
        self.0
    }

    async fn load_locked(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
        _k_auth: &KAuth,
    ) -> Result<Option<ConsumerImage>, InfraError> {
        let Some(destination) = lock_by_id(txn, org_id, consumer_id).await? else {
            return Ok(None);
        };
        if consumer_type(&destination) != self.0 {
            return Ok(None);
        }
        signed_image(txn, &destination)
            .await
            .map(Some)
            .map_err(|e| InfraError::SecretStore(e.code))
    }

    async fn store_in(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
        stored: &Value,
    ) -> Result<(), InfraError> {
        let stale = || InfraError::SecretStore(SecretErrorCode::DeliveryStale);
        let current = lock_by_id(txn, org_id, consumer_id)
            .await?
            .ok_or_else(stale)?;
        let respelled: Destination = serde_json::from_value(stored.clone()).map_err(|_| stale())?;
        if respelled.org_id != current.org_id
            || respelled.name != current.name
            || respelled.id != current.id
        {
            return Err(stale());
        }
        table::destinations::put_in(txn, respelled).await?;
        Ok(())
    }

    async fn request_urls(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
    ) -> Result<Vec<String>, InfraError> {
        use table::entity::destinations::{Column, Entity};
        let Some(row) = Entity::find()
            .filter(Column::Org.eq(org_id))
            .filter(Column::Id.eq(consumer_id))
            .one(txn)
            .await?
        else {
            return Ok(Vec::new());
        };
        let destination = table::destinations::get_on(txn, org_id, &row.name).await?;
        Ok(destination
            .as_ref()
            .and_then(endpoint)
            .map(|ep| ep.url.clone())
            .into_iter()
            .collect())
    }

    async fn after_commit(&self, org_id: &str, consumer_id: &str) {
        let refreshed: Result<Option<Destination>, InfraError> = async {
            let txn = get_orm_client_rw().await.begin().await?;
            let found = lock_by_id(&txn, org_id, consumer_id).await?;
            txn.commit().await?;
            Ok(found)
        }
        .await;
        let Ok(Some(saved)) = refreshed else {
            log::error!("respelled destination {consumer_id} could not be re-read for the cache");
            return;
        };
        // Senders read this cache; the old spelling would fail closed until the watch event.
        common::infra::config::DESTINATIONS
            .insert(format!("{}/{}", saved.org_id, saved.name), saved.clone());
        if publish_destination(&saved).await.is_err() {
            log::error!("respelled destination {consumer_id} was not published to other nodes");
        }
    }
}

/// Helper function to ensure a prebuilt template exists for the given type.
/// Returns the template name if successful.
///
/// This function implements template reuse: if a template with the standardized
/// name already exists, it returns that name. Otherwise, it creates a new template
/// from the prebuilt configuration.
async fn ensure_prebuilt_template(
    org_id: &str,
    prebuilt_type: &str,
) -> Result<String, DestinationError> {
    let template_name = format!("prebuilt_{}", prebuilt_type);

    // CRITICAL: Check if template already exists (avoid duplicates)
    match db::alerts::templates::get(org_id, &template_name).await {
        Ok(_existing_template) => {
            // Template exists, reuse it
            log::info!(
                "Reusing existing template '{}' for org '{}' and prebuilt type '{}'",
                template_name,
                org_id,
                prebuilt_type
            );
            Ok(template_name)
        }
        Err(TemplateError::NotFound) => {
            // Template doesn't exist, create it from prebuilt config
            log::info!(
                "Creating new template '{}' for org '{}' and prebuilt type '{}'",
                template_name,
                org_id,
                prebuilt_type
            );

            // Load template definition from prebuilt config
            let mut template_def = config::prebuilt_loader::get_prebuilt_template(prebuilt_type)
                .ok_or_else(|| {
                    DestinationError::PrebuiltTemplateNotFound(prebuilt_type.to_string())
                })?;

            // Set org_id and name
            template_def.org_id = org_id.to_string();
            template_def.name = template_name.clone();
            template_def.is_default = false;

            // Save to database
            // Note: With unique constraint on (org, name), concurrent creates will fail
            // gracefully with a database constraint violation
            match db::alerts::templates::set(template_def).await {
                Ok(_) => {}
                Err(e) => {
                    let error_msg = e.to_string();
                    // Check if this is a duplicate key error (race condition)
                    if error_msg.contains("UNIQUE constraint")
                        || error_msg.contains("duplicate key")
                        || error_msg.contains("Duplicate entry")
                    {
                        // Template was created by another concurrent request
                        // This is expected behavior with the race condition fix
                        log::info!(
                            "Template '{}' for org '{}' already exists (concurrent creation)",
                            template_name,
                            org_id
                        );
                        return Ok(template_name);
                    }
                    // Other database errors should still fail
                    log::error!(
                        "Failed to create template '{}' for org '{}': {}",
                        template_name,
                        org_id,
                        e
                    );
                    return Err(DestinationError::TemplateCreationFailed(error_msg));
                }
            }

            log::info!(
                "Successfully created template '{}' for org '{}'",
                template_name,
                org_id
            );

            Ok(template_name)
        }
        Err(e) => {
            // Other error (DB failure, etc.)
            log::error!(
                "Error checking for template '{}' in org '{}': {}",
                template_name,
                org_id,
                e
            );
            Err(DestinationError::TemplateRetrievalFailed(e.to_string()))
        }
    }
}

/// Rejects a recipient list naming any non-member of the org. [strong]
async fn ensure_org_members(org_id: &str, recipients: &[String]) -> Result<(), DestinationError> {
    reject_non_members(org_member_split(org_id, recipients).await)
}

/// Passes a split with nobody skipped; a lookup error stays an error, not a non-member. [pure]
fn reject_non_members(
    split: Result<(Vec<String>, Vec<String>), anyhow::Error>,
) -> Result<(), DestinationError> {
    let (_, skipped) = split
        .map_err(|e| DestinationError::InfraError(infra::errors::Error::Message(e.to_string())))?;
    if skipped.is_empty() {
        Ok(())
    } else {
        Err(DestinationError::UserNotPermitted(skipped.join(", ")))
    }
}

/// The stored row of a save, read so a row this node cannot decode is never overwritten.
async fn existing(
    org_id: &str,
    name: &str,
    create: bool,
) -> Result<Option<Destination>, DestinationError> {
    let db = get_orm_client_rw().await;
    match table::destinations::get_on(db, org_id, name).await? {
        Some(_) if create => Err(DestinationError::AlreadyExists),
        Some(found) => Ok(Some(found)),
        None if table::destinations::exists_row_on(db, org_id, name).await? => {
            Err(super::slack_destination::newer_row(name))
        }
        None if create => Ok(None),
        None => Err(DestinationError::NotFound),
    }
}

/// An alert saved against a webhook skipped the Jira checks, so a turn into Jira runs them now.
async fn check_jira_conversion(
    destination: &Destination,
    previous: Option<&Destination>,
) -> Result<(), DestinationError> {
    if !super::notifications::jira::becomes_jira(destination, previous) {
        return Ok(());
    }
    let conn = infra::db::get_orm_client_ro().await;
    let alerts = db::alerts::alert::list_with_folders_fully_decoded(
        conn,
        config::meta::alerts::alert::ListAlertsParams::new(&destination.org_id),
    )
    .await?;
    match super::notifications::jira::conversion_refusal(
        &destination.name,
        alerts.iter().map(|(_, alert)| alert),
    ) {
        Some(refusal) => Err(DestinationError::JiraAlertsUnsupported(refusal)),
        None => Ok(()),
    }
}

pub async fn save(
    name: &str,
    destination: Destination,
    create: bool,
) -> Result<Destination, DestinationError> {
    save_by(name, destination, create, "").await
}

/// [`save`] by `by`, who becomes the `updated_by` of a channel default a Slack app save fills.
pub async fn save_by(
    name: &str,
    destination: Destination,
    create: bool,
    by: &str,
) -> Result<Destination, DestinationError> {
    save_in(
        &super::slack_destination::LiveEnv,
        name,
        destination,
        create,
        by,
    )
    .await
}

/// [`save_by`] with the Slack and cluster reads a test can replace.
pub async fn save_in(
    env: &dyn super::slack_destination::SaveEnv,
    name: &str,
    destination: Destination,
    create: bool,
    by: &str,
) -> Result<Destination, DestinationError> {
    save_internal(env, name, destination, create, by, None, vec![])
        .await
        .map(|(saved, _)| saved)
        .map_err(Into::into)
}

pub async fn authorize_destination_save(
    principal: &SavePrincipal,
    org_id: &str,
    stored: Option<&Destination>,
    new: &Destination,
) -> Result<(), SecretRefusal> {
    if has_store_ref(new) {
        infra::secret_store::mode::require_single_cluster()?;
        gate::require(GateState::Latched)?;
    }
    if principal.user_id.is_empty() {
        return Err(SecretErrorCode::SecretUseDenied.into());
    }
    let (method, object) = stored.map_or(("POST", org_id), |d| ("PUT", d.name.as_str()));
    let allowed = crate::authz::check_permissions(
        &principal.user_id,
        crate::auth::AuthExtractor {
            auth: String::new(),
            method: method.into(),
            o2_type: format!("destination:{object}"),
            org_id: org_id.into(),
            bypass_check: false,
            parent_id: String::new(),
            use_all_org: stored.is_none(),
            use_self_context: false,
            use_self_parent: stored.is_some(),
            feature: None,
        },
        principal.role.clone(),
        false,
    )
    .await;
    if allowed {
        Ok(())
    } else {
        Err(SecretErrorCode::SecretUseDenied.into())
    }
}

pub async fn authorize_human_send(
    principal: &SavePrincipal,
    destination: &Destination,
) -> Result<(), SecretRefusal> {
    if !has_store_ref(destination) {
        return Ok(());
    }
    let slots = destination_slots(destination, Some(destination))?;
    let has_secrets = slots
        .iter()
        .flat_map(|slot| &slot.tokens)
        .any(|token| token.kind == RefKind::Secret);
    if has_secrets && destination.id.is_none() {
        return Err(SecretErrorCode::SecretUnbound.into());
    }
    let db = get_orm_client_rw().await;
    let refs = match destination.id {
        Some(id) => secret_refs::list_for_consumer_in(
            db,
            &destination.org_id,
            consumer_type(destination).as_str(),
            &id.to_string(),
        )
        .await
        .map_err(|_| SecretErrorCode::PermissionsUnavailable)?,
        None => vec![],
    };
    if has_secrets && refs.is_empty() {
        return Err(SecretErrorCode::SecretUnbound.into());
    }
    let variables = slots
        .iter()
        .flat_map(|slot| &slot.tokens)
        .filter(|token| token.kind == RefKind::Var)
        .map(|token| token.name.clone())
        .collect();
    let deps = dependencies(db, &destination.org_id, &variables).await?;
    deps.require_present(&principal.role.to_string())?;
    let mut names = deps.names;
    for row in refs {
        names.entry(row.secret_id).or_insert(row.token_name);
    }
    for (id, name) in names {
        let decision = check_secret_permission(
            &destination.org_id,
            &principal.user_id,
            principal.role.clone(),
            &format!("secrets:{id}"),
            "GET",
        )
        .await?;
        if decision == Decision::Deny {
            return Err(SecretRefusal::named(
                SecretErrorCode::SecretUseDenied,
                &name,
            ));
        }
    }
    Ok(())
}

pub async fn authorize_human_sends(
    org_id: &str,
    user_id: &str,
    names: &[String],
) -> Result<(), SecretRefusal> {
    let mut principal = None;
    for name in names {
        let destination = match get(org_id, name).await {
            Ok(destination) => destination,
            Err(DestinationError::NotFound) => continue,
            Err(_) => return Err(SecretErrorCode::PermissionsUnavailable.into()),
        };
        if !has_store_ref(&destination) {
            continue;
        }
        let principal = match &principal {
            Some(principal) => principal,
            None => principal.insert(SavePrincipal::for_user(org_id, user_id).await?),
        };
        authorize_human_send(principal, &destination).await?;
    }
    Ok(())
}

/// Saves and senders must key the same literal credential fields when computing a delivery digest.
pub fn destination_keyed_pointers(destination: &Destination) -> Vec<String> {
    let Some(ep) = endpoint(destination) else {
        return vec![];
    };
    let base = endpoint_pointer(destination);
    let mut pointers = Vec::new();
    for (key, value) in ep.headers.iter().flatten() {
        if !grammar::has_secret_ref(value) {
            pointers.push(format!("{base}/headers/{}", pointer_component(key)));
        }
    }
    if is_pagerduty(destination)
        && ep
            .metadata
            .get("routing_key")
            .is_some_and(|v| !grammar::has_secret_ref(v))
    {
        pointers.push(format!("{base}/metadata/routing_key"));
    }
    pointers.sort();
    pointers
}

pub async fn destination_snapshot(
    destination: &Destination,
) -> Result<Option<infra::secret_store::resolver::Snapshot>, SecretErrorCode> {
    use infra::secret_store::resolver::{RequestUrl, Snapshot};

    let Some(endpoint) = endpoint(destination).filter(|_| has_store_ref(destination)) else {
        return Ok(None);
    };
    let slots = destination_slots(destination, Some(destination)).map_err(|e| e.code)?;
    let variables = slots
        .iter()
        .flat_map(|slot| &slot.tokens)
        .filter(|token| token.kind == RefKind::Var)
        .map(|token| token.name.clone())
        .collect();
    let deps = dependencies(get_orm_client_rw().await, &destination.org_id, &variables)
        .await
        .map_err(|e| e.code)?;
    Ok(Some(Snapshot {
        org_id: destination.org_id.clone(),
        consumer_type: consumer_type(destination),
        consumer_id: destination
            .id
            .ok_or(SecretErrorCode::SecretUnbound)?
            .to_string(),
        stored: image(destination).map_err(|e| e.code)?,
        keyed_pointers: destination_keyed_pointers(destination),
        slot_pointers: slots.into_iter().map(|slot| slot.field).collect(),
        request_urls: vec![RequestUrl {
            field: format!("{}/url", endpoint_pointer(destination)),
            substituted: endpoint.url.clone(),
            store_dependency_ids: deps.names.into_keys().collect(),
        }],
        write_only_names: vec![],
        deps: BTreeMap::from([(ORG_ENV_ID.into(), deps.entries)]),
        env_id: ORG_ENV_ID.into(),
        job: None,
    }))
}

pub async fn save_with_binds(
    name: &str,
    destination: Destination,
    create: bool,
    principal: &SavePrincipal,
    binds: Vec<SecretBindInput>,
) -> Result<(Destination, Option<BindRequest>), DestinationSaveError> {
    save_internal(
        &super::slack_destination::LiveEnv,
        name,
        destination,
        create,
        &principal.user_id,
        Some(principal),
        binds,
    )
    .await
}

/// Alert and pipeline destinations join the respell job; call once at startup.
pub fn register_respell_targets() {
    for ty in [
        ConsumerType::AlertDestination,
        ConsumerType::PipelineDestination,
    ] {
        respell::register(std::sync::Arc::new(DestinationRespell(ty)));
    }
}

/// Validates email destination configuration and sends a test email.
/// Performs the same validations as save() for email destinations:
/// 1. Checks SMTP is enabled
/// 2. Validates recipients are not empty
/// 3. Validates each recipient is a user in the org
/// 4. Sends a test email via the shared send_email_notification function
pub async fn test_email(
    org_id: &str,
    recipients: &[String],
    body: Option<&str>,
) -> Result<String, DestinationError> {
    if !get_config().smtp.smtp_enabled {
        return Err(DestinationError::SMTPUnavailable);
    }

    if recipients.is_empty() {
        return Err(DestinationError::EmptyEmail);
    }

    let validated_recipients: Vec<String> = recipients
        .iter()
        .map(|email| email.trim().to_lowercase())
        .collect();
    ensure_org_members(org_id, &validated_recipients).await?;

    let default_body = "<html><body><h2>OpenObserve Test Email</h2>\
         <p>This is a test email from OpenObserve to verify your email destination \
         is configured correctly.</p>\
         <p>If you received this email, your email destination is working.</p></body></html>";
    let email_body = body.unwrap_or(default_body).to_string();

    let email = Email {
        recipients: validated_recipients,
    };

    super::alert::send_email_notification(
        "OpenObserve - Test Email Destination",
        &email,
        None,
        email_body,
    )
    .await
    .map_err(|e| DestinationError::EmailSendFailed(e.to_string()))
}

/// Appends the skipped addresses to a send response; unchanged when none were skipped. [pure]
pub fn note_skipped(response: String, skipped: &[String]) -> String {
    if skipped.is_empty() {
        return response;
    }
    format!(
        "{response} (skipped recipients not part of this org: {})",
        skipped.join(", ")
    )
}

/// Splits recipients into org members and non-members; a failed lookup fails the split. [pure]
pub fn split_org_members(
    checked: Vec<(String, Result<bool, anyhow::Error>)>,
) -> Result<(Vec<String>, Vec<String>), anyhow::Error> {
    let mut kept = vec![];
    let mut skipped = vec![];
    for (recipient, member) in checked {
        if member? {
            kept.push(recipient);
        } else {
            skipped.push(recipient);
        }
    }
    Ok((kept, skipped))
}

/// Looks up each recipient's org membership and splits kept from skipped. [strong]
pub async fn org_member_split(
    org_id: &str,
    recipients: &[String],
) -> Result<(Vec<String>, Vec<String>), anyhow::Error> {
    let mut checked = Vec::with_capacity(recipients.len());
    for recipient in recipients {
        let email = recipient.trim().to_lowercase();
        let member = if user::is_root_user(&email) {
            Ok(true)
        } else {
            org_users::get_optional(org_id, &email)
                .await
                .map(|found| found.is_some())
        };
        checked.push((recipient.clone(), member));
    }
    split_org_members(checked)
}

pub async fn get(org_id: &str, name: &str) -> Result<Destination, DestinationError> {
    db::alerts::destinations::get(org_id, name).await
}

/// Gets a destination with its optional template.
/// Returns the destination and optionally the template if one is configured.
pub async fn get_with_template(
    org_id: &str,
    name: &str,
) -> Result<(Destination, Option<Template>), DestinationError> {
    let dest = get(org_id, name).await?;
    if let Module::Alert { template, .. } = &dest.module {
        if let Some(template_name) = template {
            let template = db::alerts::templates::get(org_id, template_name)
                .await
                .map_err(|_| DestinationError::TemplateNotFound)?;
            Ok((dest, Some(template)))
        } else {
            // Template is optional at destination level
            Ok((dest, None))
        }
    } else {
        // Pipeline destinations don't have templates
        Ok((dest, None))
    }
}

pub async fn list(
    org_id: &str,
    module: Option<&str>,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Destination>, DestinationError> {
    Ok(db::alerts::destinations::list(org_id, module)
        .await?
        .into_iter()
        .filter(|dest| {
            permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("destination:{}", dest.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("destination:_all_{org_id}"))
        })
        .collect())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), DestinationError> {
    // first_use decides cheaply; only a refusal pays for the full walk to name every blocker.
    if !super::destination_usage::first_use(org_id, name)
        .await?
        .is_empty()
    {
        let uses = super::destination_usage::destination_usage(org_id, name).await?;
        return Err(DestinationError::InUse(
            super::destination_usage::usage_message(name, &uses),
        ));
    }

    db::alerts::destinations::delete(org_id, name).await?;
    remove_ownership(org_id, "destinations", Authz::new(name)).await;
    Ok(())
}

/// Every consumer's references to every destination in the org — the usage endpoint's data.
pub async fn all_usage(
    org_id: &str,
) -> Result<
    std::collections::HashMap<String, Vec<super::destination_usage::DestinationUse>>,
    DestinationError,
> {
    super::destination_usage::all_usage(org_id).await
}

#[cfg(test)]
async fn check_secret_permission(
    org_id: &str,
    user_id: &str,
    role: UserRole,
    object: &str,
    verb: &str,
) -> Result<Decision, SecretErrorCode> {
    if let Ok(allowed) =
        SECRET_GRANTS.try_with(|grants| grants.contains(&(object.to_owned(), verb.to_owned())))
    {
        return Ok(if allowed {
            Decision::Allow
        } else {
            Decision::Deny
        });
    }
    crate::authz::check_strict(org_id, user_id, role, object, verb).await
}

async fn validate_delivery(destination: &mut Destination) -> Result<(), DestinationError> {
    // First validate the `destination` according to its `destination_type`
    match &mut destination.module {
        Module::Alert {
            destination_type, ..
        } => match destination_type {
            DestinationType::Email(email) => {
                if email.recipients.is_empty() {
                    return Err(DestinationError::EmptyEmail);
                }
                if !config::get_config().smtp.smtp_enabled {
                    return Err(DestinationError::SMTPUnavailable);
                }
                let lowercase_emails: Vec<String> = email
                    .recipients
                    .iter()
                    .map(|email| email.trim().to_lowercase())
                    .collect();
                ensure_org_members(&destination.org_id, &lowercase_emails).await?;
                email.recipients = lowercase_emails;
            }
            DestinationType::Http(endpoint) => {
                if endpoint.url.is_empty() {
                    return Err(DestinationError::EmptyUrl);
                }
                // SSRF protection: validate the URL (incl. DNS resolution) before
                // persisting so the alert fire path can't be tricked into reading
                // internal services via a destination saved with a malicious URL.
                if let Err(e) =
                    common::utils::ssrf_guard::SsrfGuard::validate_destination_url_with_config_async(
                        &endpoint.url,
                    )
                    .await
                {
                    return Err(DestinationError::SsrfBlocked(e));
                }
            }
            DestinationType::Sns(aws_sns) => {
                if aws_sns.sns_topic_arn.is_empty() || aws_sns.aws_region.is_empty() {
                    return Err(DestinationError::InvalidSns);
                }
            }
            DestinationType::SlackApp(target) => {
                super::slack_destination::validate_fields(target)?;
            }
        },
        Module::Pipeline { endpoint, .. } => {
            if endpoint.url.is_empty() {
                return Err(DestinationError::EmptyUrl);
            }
            if let Err(e) =
                common::utils::ssrf_guard::SsrfGuard::validate_destination_url_with_config_async(
                    &endpoint.url,
                )
                .await
            {
                return Err(DestinationError::SsrfBlocked(e));
            }
        }
    }

    Ok(())
}

async fn save_internal(
    env: &dyn super::slack_destination::SaveEnv,
    name: &str,
    mut destination: Destination,
    create: bool,
    by: &str,
    principal: Option<&SavePrincipal>,
    binds: Vec<SecretBindInput>,
) -> Result<(Destination, Option<BindRequest>), DestinationSaveError> {
    if !name.is_empty() {
        destination.name = name.to_string();
    }
    destination.name = destination.name.trim().to_string();
    if destination.name.is_empty() {
        return Err(DestinationError::EmptyName.into());
    }
    if destination.name.contains('/') || is_ofga_unsupported(&destination.name) {
        return Err(DestinationError::InvalidName.into());
    }
    // Create only: older rows over the limit (SQLite does not enforce it) stay editable.
    if create && destination.name.chars().count() > NAME_MAX_CHARS {
        return Err(DestinationError::NameTooLong(NAME_MAX_CHARS).into());
    }

    let previous = existing(&destination.org_id, &destination.name, create).await?;
    super::notifications::jira::keep_saved_token(&mut destination, previous.as_ref())?;
    let store_refs_enabled = get_config().common.secret_store_refs_enabled;
    let carries_store_ref = endpoint(&destination).is_some_and(Endpoint::has_store_ref);
    let binding = has_store_ref(&destination)
        || previous.as_ref().is_some_and(has_store_ref)
        || !binds.is_empty();
    let resolved;
    // `by` alone only stamps a Slack channel default; secret use is checked only when binding.
    let principal = if principal.is_none() && binding {
        if by.is_empty() {
            return Err(SecretRefusal::from(SecretErrorCode::SecretUseDenied).into());
        }
        resolved = SavePrincipal::for_user(&destination.org_id, by).await?;
        Some(&resolved)
    } else {
        principal
    };
    if !store_refs_enabled && carries_store_ref && !binds.is_empty() {
        infra::secret_store::mode::require_single_cluster().map_err(SecretRefusal::from)?;
        gate::require(GateState::Latched).map_err(SecretRefusal::from)?;
    }
    if let Some(actor) = principal {
        authorize_destination_save(actor, &destination.org_id, previous.as_ref(), &destination)
            .await?;
    }
    if !store_refs_enabled
        && carries_store_ref
        && (!binds.is_empty() || gate::durably_latched().await.unwrap_or(false))
    {
        return Err(SecretRefusal::from(SecretErrorCode::StoreDisabled).into());
    }
    if binds
        .iter()
        .any(|b| matches!(&b.pin, SecretBindPin::Hosts(hosts) if hosts.is_empty()))
    {
        return Err(SecretRefusal::from(SecretErrorCode::PinHostsEmpty).into());
    }
    let slots = if store_refs_enabled {
        destination_slots(&destination, previous.as_ref())?
    } else {
        vec![]
    };
    validate_delivery(&mut destination).await?;
    if let Some(target) = super::slack_destination::slack_app_target(&destination) {
        super::slack_destination::check_save(env, &destination, target, previous.as_ref()).await?;
    }
    check_jira_conversion(&destination, previous.as_ref()).await?;

    prepare_template(&mut destination).await?;
    let (saved, request) = if binding {
        let actor =
            principal.ok_or_else(|| SecretRefusal::from(SecretErrorCode::SecretUseDenied))?;
        let result = persist_binding(destination, previous.as_ref(), slots, actor, binds).await?;
        publish_destination(&result.0).await?;
        result
    } else {
        let saved = persist_plain(destination).await?;
        publish_destination(&saved).await?;
        (saved, None)
    };
    if name.is_empty() {
        set_ownership(&saved.org_id, "destinations", Authz::new(&saved.name)).await;
    }
    if let Some(target) = super::slack_destination::slack_app_target(&saved) {
        super::slack_destination::fill_channel_default(&saved.org_id, target, by).await;
    }
    Ok((saved, request))
}

async fn prepare_template(destination: &mut Destination) -> Result<(), DestinationError> {
    // For prebuilt destinations, ensure template exists before saving destination
    // This implements template reuse: multiple destinations can share the same prebuilt template
    if let Module::Alert {
        ref mut template,
        ref destination_type,
    } = destination.module
    {
        // Check if this is a prebuilt destination (has destination_type metadata).
        // Templates are optional now (design §4.4 — org-default/compiled-in
        // fallback covers the None case), so a missing template no longer
        // implies "assume prebuilt" — only an EXPLICIT `prebuilt_*` reference
        // triggers the auto-association below.
        let prebuilt_type = match destination_type {
            DestinationType::Http(endpoint) => endpoint.destination_type.as_deref(),
            DestinationType::Email(_) => {
                if template
                    .as_ref()
                    .is_some_and(|t| t.starts_with("prebuilt_"))
                {
                    Some("email")
                } else {
                    None
                }
            }
            DestinationType::Sns(_) => None, // SNS doesn't have prebuilt templates yet
            DestinationType::SlackApp(_) => template.is_none().then_some("slack"),
        };

        // If it's a prebuilt type and doesn't have a custom template, ensure prebuilt template
        // exists
        if let Some(pb_type) = prebuilt_type {
            // Skip "custom" type (user wants to use custom template)
            if pb_type != "custom" {
                // Ensure the prebuilt template exists (creates if needed, reuses if exists)
                let template_name = ensure_prebuilt_template(&destination.org_id, pb_type).await?;

                // Update destination to reference the template (only if not already set)
                if template.is_none() {
                    *template = Some(template_name);
                    log::info!(
                        "Associated destination '{}' with prebuilt template for type '{}'",
                        destination.name,
                        pb_type
                    );
                }
            }
        }
    }

    // The write stores null for a name it finds no row for, so refuse it here. The lookup falls
    // back to the default org and follows renames; the canonical name is what the write resolves.
    if let Module::Alert {
        template: Some(template_name),
        ..
    } = &mut destination.module
        && !template_name.is_empty()
    {
        match db::alerts::templates::get(&destination.org_id, template_name).await {
            Ok(found) => *template_name = found.name,
            Err(TemplateError::NotFound) => {
                return Err(DestinationError::UnknownTemplate(template_name.clone()));
            }
            Err(TemplateError::InfraError(e)) => return Err(DestinationError::InfraError(e)),
            Err(e) => return Err(DestinationError::TemplateRetrievalFailed(e.to_string())),
        }
    }

    Ok(())
}

fn endpoint(destination: &Destination) -> Option<&Endpoint> {
    match &destination.module {
        Module::Alert {
            destination_type: DestinationType::Http(endpoint),
            ..
        }
        | Module::Pipeline { endpoint } => Some(endpoint),
        _ => None,
    }
}

fn has_store_ref(destination: &Destination) -> bool {
    endpoint(destination).is_some_and(Endpoint::uses_store_refs)
}

fn consumer_type(destination: &Destination) -> ConsumerType {
    match destination.module {
        Module::Alert { .. } => ConsumerType::AlertDestination,
        Module::Pipeline { .. } => ConsumerType::PipelineDestination,
    }
}

fn image(destination: &Destination) -> Result<Value, SecretRefusal> {
    serde_json::to_value(destination).map_err(|_| SecretErrorCode::SecretUnavailable.into())
}

fn literal_tokens(text: &str) -> Vec<RefToken> {
    // An unchanged typo is literal text. It cannot hide a valid token later in the same slot.
    let mut parts = text.match_indices("{{").peekable();
    let mut tokens = Vec::new();
    while let Some((start, _)) = parts.next() {
        let end = parts.peek().map_or(text.len(), |(pos, _)| *pos);
        if let Ok(found) = grammar::parse_refs(&text[start..end]) {
            tokens.extend(found.into_iter().map(|mut t| {
                t.start += start;
                t.end += start;
                t
            }));
        }
    }
    tokens
}

fn refuse_tokens(text: &str) -> Result<(), SecretErrorCode> {
    if literal_tokens(text).is_empty() {
        Ok(())
    } else {
        Err(SecretErrorCode::RefNotAllowedInField)
    }
}

fn refuse_nested_refs(value: &Value) -> Result<(), SecretErrorCode> {
    match value {
        Value::String(text) => refuse_tokens(text)?,
        Value::Array(items) => {
            for item in items {
                refuse_nested_refs(item)?;
            }
        }
        Value::Object(fields) => {
            for (key, value) in fields {
                refuse_tokens(key)?;
                refuse_nested_refs(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn collect_slot(
    slots: &mut Vec<RefSlot>,
    ty: ConsumerType,
    slot: Slot,
    field: String,
    text: &str,
    previous: &Value,
) -> Result<(), SecretErrorCode> {
    let changed = previous.pointer(&field).and_then(Value::as_str) != Some(text);
    let tokens = if changed && grammar::slot_allows(ty, &slot, RefKind::Secret) {
        grammar::check_slot(ty, &slot, text)?
    } else {
        let tokens = literal_tokens(text);
        if tokens
            .iter()
            .any(|token| !grammar::slot_allows(ty, &slot, token.kind))
        {
            return Err(SecretErrorCode::RefNotAllowedInField);
        }
        tokens
    };
    if !tokens.is_empty() {
        slots.push(RefSlot {
            field,
            tokens,
            changed,
        });
    }
    Ok(())
}

fn collect_url(
    slots: &mut Vec<RefSlot>,
    ty: ConsumerType,
    ep: &Endpoint,
    field: String,
    previous: &Value,
) -> Result<(), SecretErrorCode> {
    let raw = &ep.url;
    let request = raw.split('#').next().unwrap_or(raw);
    let origin_start = raw.find("://").map_or(0, |end| end + 3);
    let origin_end = raw[origin_start..]
        .find(['/', '?', '#'])
        .map_or(raw.len(), |end| origin_start + end);
    grammar::check_request_url(&raw[..origin_end], ep.skip_tls_verify, ep.has_store_ref())?;
    refuse_tokens(&raw[..origin_end])?;
    refuse_tokens(&raw[request.len()..])?;
    let changed = previous.pointer(&field).and_then(Value::as_str) != Some(raw);
    let path_query = &raw[origin_end..request.len().max(origin_end)];
    let mut tokens = if changed {
        grammar::check_slot(ty, &Slot::UrlPath, path_query)?
    } else {
        literal_tokens(path_query)
    };
    for token in &mut tokens {
        token.start += origin_end;
        token.end += origin_end;
    }
    if !tokens.is_empty() {
        slots.push(RefSlot {
            field,
            tokens,
            changed,
        });
    }
    Ok(())
}

fn endpoint_pointer(destination: &Destination) -> &'static str {
    if destination.is_pipeline_destination() {
        "/module/pipeline/endpoint"
    } else {
        "/module/alert/destination_type"
    }
}

fn pointer_component(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn is_pagerduty(destination: &Destination) -> bool {
    use super::notifications::platform::{Platform, platform_of};
    matches!(&destination.module, Module::Alert { destination_type, .. } if platform_of(destination_type) == Some(Platform::PagerDuty))
}

fn destination_slots(
    destination: &Destination,
    previous: Option<&Destination>,
) -> Result<Vec<RefSlot>, SecretRefusal> {
    let mut stored = image(destination)?;
    let mut slots = Vec::new();
    if let Some(ep) = endpoint(destination) {
        let ty = consumer_type(destination);
        let base = endpoint_pointer(destination);
        let previous = previous.map(image).transpose()?.unwrap_or_default();
        collect_url(&mut slots, ty, ep, format!("{base}/url"), &previous)?;
        let has_secret = ep.has_store_ref();
        for (key, value) in ep.headers.iter().flatten() {
            refuse_tokens(key)?;
            grammar::check_header_name(key, has_secret)?;
            collect_slot(
                &mut slots,
                ty,
                Slot::HeaderValue,
                format!("{base}/headers/{}", pointer_component(key)),
                value,
                &previous,
            )?;
        }
        let platform = if is_pagerduty(destination) {
            "pagerduty"
        } else {
            ""
        };
        for (key, value) in &ep.metadata {
            refuse_tokens(key)?;
            let slot = Slot::Metadata {
                platform: platform.into(),
                key: key.clone(),
            };
            collect_slot(
                &mut slots,
                ty,
                slot,
                format!("{base}/metadata/{}", pointer_component(key)),
                value,
                &previous,
            )?;
        }
        let object = stored
            .pointer_mut(base)
            .and_then(Value::as_object_mut)
            .ok_or(SecretErrorCode::SecretUnavailable)?;
        for key in ["url", "headers", "metadata"] {
            object.remove(key);
        }
    }
    refuse_nested_refs(&stored)?;
    slots.sort_by(|a, b| a.field.cmp(&b.field));
    Ok(slots)
}

async fn resolve_name<C: ConnectionTrait>(
    db: &C,
    org: &str,
    name: &str,
) -> Result<Option<org_secrets::Model>, InfraError> {
    let names = BTreeSet::from([name.to_owned()]);
    Ok(named_policies_in(db, org, &names).await?.remove(name))
}

fn store_error(err: InfraError) -> SecretRefusal {
    BindError::from(err).code().into()
}

async fn dependencies<C: ConnectionTrait>(
    db: &C,
    org: &str,
    names: &BTreeSet<String>,
) -> Result<Dependencies, SecretRefusal> {
    use table::org_secret_values as values;

    let mut rows = named_policies_in(db, org, names)
        .await
        .map_err(store_error)?;
    rows.retain(|_, row| row.state == "active");
    let ids: BTreeSet<&str> = rows.values().map(|row| row.id.as_str()).collect();
    let mut heads = BTreeMap::new();
    if !ids.is_empty() {
        for head in values::Entity::find()
            .filter(values::Column::OrgId.eq(org))
            .filter(values::Column::SecretId.is_in(ids))
            .filter(values::Column::EnvId.eq(ORG_ENV_ID))
            .filter(values::Column::EnvIncarnation.eq(""))
            .all(db)
            .await
            .map_err(|e| store_error(e.into()))?
        {
            heads.insert(head.secret_id.clone(), head);
        }
    }
    let mut keys = BTreeSet::new();
    let mut resolved_names = BTreeMap::new();
    let mut entries = Vec::new();
    for name in names {
        if let Some(row) = rows.get(name) {
            let id = row.id.clone();
            keys.insert(secret_dependencies::var_dep_key(&id));
            resolved_names.insert(id.clone(), name.clone());
            entries.push(match heads.get(&id).filter(|head| head.state == "set") {
                Some(head) => DepEntry::Store {
                    secret_id: id,
                    value_rev: head.value_rev.clone(),
                },
                None => DepEntry::StoreMissing { secret_id: id },
            });
        } else {
            keys.insert(name.clone());
            entries.push(DepEntry::Absent { name: name.clone() });
        }
    }
    Ok(Dependencies {
        keys: keys.into_iter().collect(),
        names: resolved_names,
        entries,
    })
}

async fn prepare_bind<C: ConnectionTrait>(
    db: &C,
    destination: &Destination,
    previous: Option<&Destination>,
    slots: &[RefSlot],
    actor: &SavePrincipal,
    binds: &[SecretBindOption],
) -> Result<PreparedBind, SecretRefusal> {
    let org = &destination.org_id;
    let ty = consumer_type(destination);
    let id = destination
        .id
        .ok_or(SecretErrorCode::SecretUnavailable)?
        .to_string();
    let old_refs = secret_refs::list_for_consumer_in(db, org, ty.as_str(), &id)
        .await
        .map_err(store_error)?;
    let mut stored = image(destination)?;
    let mut refs = BTreeMap::new();
    let mut changed_secret_ids = BTreeSet::new();
    let mut typed_names = BTreeMap::new();
    let mut variables = BTreeSet::new();
    let mut changed_uses = BTreeSet::new();
    for slot in slots {
        let value = stored
            .pointer_mut(&slot.field)
            .ok_or(SecretErrorCode::SecretUnavailable)?;
        let Value::String(text) = value else {
            return Err(SecretErrorCode::SecretUnavailable.into());
        };
        for token in slot.tokens.iter().rev() {
            if token.kind == RefKind::Var {
                variables.insert(token.name.clone());
                continue;
            }
            let bound = old_refs
                .iter()
                .find(|r| r.field == slot.field && r.token_name == token.name);
            let row = match bound {
                Some(old) => org_secrets::get_secret_in(db, org, &old.secret_id).await,
                None => resolve_name(db, org, &token.name).await,
            }
            .map_err(store_error)?
            .filter(|row| row.state == "active")
            .ok_or_else(|| {
                SecretRefusal::named(
                    bind::missing_secret_code(&actor.role.to_string()),
                    &token.name,
                )
            })?;
            typed_names
                .entry(row.id.clone())
                .or_insert_with(|| token.name.clone());
            if slot.changed {
                changed_uses.insert((row.id.clone(), StrictVerb::Use));
            }
            if !old_refs
                .iter()
                .any(|old| old.field == slot.field && old.secret_id == row.id)
            {
                changed_secret_ids.insert(row.id.clone());
            }
            if row.name != token.name {
                text.replace_range(
                    token.start..token.end,
                    &format!("{{{{secrets.{}}}}}", row.name),
                );
            }
            refs.insert(
                (slot.field.clone(), row.id.clone()),
                BoundRef {
                    field: slot.field.clone(),
                    token_name: row.name,
                    secret_id: row.id,
                },
            );
        }
    }
    let destination: Destination =
        serde_json::from_value(stored.clone()).map_err(|_| SecretErrorCode::SecretUnavailable)?;
    let url = endpoint(&destination)
        .ok_or(SecretErrorCode::RefNotAllowedInField)?
        .url
        .clone();
    let origin = |url: &str| reqwest::Url::parse(url).ok().map(|url| url.origin());
    let old_url = previous.and_then(endpoint).map(|ep| ep.url.as_str());
    let host_changed = old_url.and_then(origin) != origin(&url);
    let deps = dependencies(db, org, &variables).await?;
    deps.require_present(&actor.role.to_string())?;
    let dep_secret_ids = deps.names.keys().cloned().collect();
    for (id, name) in deps.names {
        typed_names.entry(id).or_insert(name);
    }
    for option in binds {
        if !typed_names.contains_key(&option.secret_id) {
            return Err(SecretRefusal::named(
                SecretErrorCode::SecretUseDenied,
                &option.secret_id,
            ));
        }
    }
    let plan = BindPlan {
        org_id: org.clone(),
        consumer_type: ty,
        consumer_id: id,
        saved_by: actor.user_id.clone(),
        image: ConsumerImage {
            name: destination.name.clone(),
            stored,
            keyed_pointers: destination_keyed_pointers(&destination),
            deps: BTreeMap::from([(ORG_ENV_ID.into(), deps.entries)]),
        },
        refs: refs.into_values().collect(),
        changed_secret_ids,
        host_changed,
        request_urls: vec![url],
        dep_keys: deps.keys,
        dep_secret_ids,
        binds: binds.to_vec(),
    };
    Ok(PreparedBind {
        destination,
        plan,
        typed_names,
        changed_uses,
    })
}

/// Holds the destination row on Postgres until the transaction ends; SQLite serializes writers.
async fn lock_row(
    txn: &DatabaseTransaction,
    destination: &Destination,
) -> Result<bool, InfraError> {
    use table::entity::destinations::{Column, Entity};
    let mut query = Entity::find()
        .filter(Column::Org.eq(&destination.org_id))
        .filter(Column::Name.eq(&destination.name));
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock_exclusive();
    }
    Ok(query.one(txn).await?.is_some())
}

async fn lock_destination(
    txn: &DatabaseTransaction,
    new: &Destination,
    previous: Option<&Destination>,
) -> Result<(), BindError> {
    if lock_row(txn, new).await? != previous.is_some() {
        return Err(BindError::Retry);
    }
    if let Some(old) = previous {
        let current = table::destinations::get_on(txn, &new.org_id, &new.name)
            .await?
            .ok_or(BindError::Retry)?;
        if serde_json::to_value(old).map_err(InfraError::from)?
            != serde_json::to_value(current).map_err(InfraError::from)?
        {
            return Err(BindError::Retry);
        }
    }
    Ok(())
}

async fn remove_binding(txn: &DatabaseTransaction, old: &Destination) -> Result<(), BindError> {
    let org = &old.org_id;
    let ty = consumer_type(old).as_str();
    let id = old
        .id
        .ok_or(SecretErrorCode::SecretUnavailable)?
        .to_string();
    secret_refs::delete_for_consumer_in(txn, org, ty, &id).await?;
    secret_dependencies::delete_for_consumer_in(txn, org, ty, &id).await?;
    secret_consumer_auth::delete_in(txn, org, ty, &id).await?;
    Ok(())
}

async fn persist_binding(
    mut destination: Destination,
    previous: Option<&Destination>,
    slots: Vec<RefSlot>,
    actor: &SavePrincipal,
    binds: Vec<SecretBindInput>,
) -> Result<(Destination, Option<BindRequest>), DestinationSaveError> {
    destination.id = Some(match previous {
        Some(d) => {
            d.id.ok_or_else(|| SecretRefusal::from(SecretErrorCode::SecretUnavailable))?
        }
        None => config::ider::ksuid()
            .parse()
            .map_err(|_| SecretRefusal::from(SecretErrorCode::SecretUnavailable))?,
    });
    if !has_store_ref(&destination) {
        if let Some(option) = binds.first() {
            return Err(
                SecretRefusal::named(SecretErrorCode::SecretUseDenied, &option.secret_id).into(),
            );
        }
        let old = previous.ok_or_else(|| SecretRefusal::from(SecretErrorCode::PolicyChanged))?;
        let txn = get_orm_client_rw()
            .await
            .begin()
            .await
            .map_err(InfraError::from)
            .map_err(DestinationError::from)?;
        lock_destination(&txn, &destination, previous)
            .await
            .map_err(|e| SecretRefusal::from(e.code()))?;
        let saved = table::destinations::put_in(&txn, destination)
            .await
            .map_err(DestinationError::from)?;
        remove_binding(&txn, old)
            .await
            .map_err(|e| SecretRefusal::from(e.code()))?;
        txn.commit()
            .await
            .map_err(InfraError::from)
            .map_err(DestinationError::from)?;
        return Ok((saved, None));
    }
    let options = binds
        .into_iter()
        .map(|b| SecretBindOption {
            secret_id: b.secret_id,
            allow_this_consumer: b.allow_this_consumer,
            expected_policy_rev: b.expected_policy_rev,
            pin: match b.pin {
                SecretBindPin::Keep(_) => BindPin::Keep,
                SecretBindPin::Hosts(hosts) => BindPin::Hosts(hosts),
            },
        })
        .collect();
    let save = BindSave {
        destination,
        previous,
        slots,
        actor,
        binds: options,
        refusal: OnceLock::new(),
        key: tokio::sync::OnceCell::new(),
    };
    let saved = OnceLock::new();
    let result =
        bind::bind_with_retry(|| save.preflight(), |checked| save.attempt(checked, &saved)).await;
    let request =
        result.map_err(|e| save.refusal.into_inner().unwrap_or_else(|| e.code().into()))?;
    Ok((
        saved
            .into_inner()
            .ok_or_else(|| SecretRefusal::from(SecretErrorCode::SecretUnavailable))?,
        request,
    ))
}

/// The consumer id is the row id; the row is held on Postgres until the respell commits.
async fn lock_by_id(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
) -> Result<Option<Destination>, InfraError> {
    use table::entity::destinations::{Column, Entity};
    let mut query = Entity::find()
        .filter(Column::Org.eq(org_id))
        .filter(Column::Id.eq(id));
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock_exclusive();
    }
    let Some(row) = query.one(txn).await? else {
        return Ok(None);
    };
    table::destinations::get_on(txn, org_id, &row.name).await
}

async fn signed_image(
    txn: &DatabaseTransaction,
    destination: &Destination,
) -> Result<ConsumerImage, SecretRefusal> {
    let variables = destination_slots(destination, Some(destination))?
        .iter()
        .flat_map(|slot| &slot.tokens)
        .filter(|token| token.kind == RefKind::Var)
        .map(|token| token.name.clone())
        .collect();
    let deps = dependencies(txn, &destination.org_id, &variables).await?;
    Ok(ConsumerImage {
        name: destination.name.clone(),
        stored: image(destination)?,
        keyed_pointers: destination_keyed_pointers(destination),
        deps: BTreeMap::from([(ORG_ENV_ID.into(), deps.entries)]),
    })
}

/// A ref-free save must not overwrite a row a concurrent save bound, or its binding rows go stale.
async fn persist_plain(destination: Destination) -> Result<Destination, DestinationSaveError> {
    let txn = get_orm_client_rw()
        .await
        .begin()
        .await
        .map_err(|e| DestinationError::from(InfraError::from(e)))?;
    let written: Result<Destination, DestinationSaveError> = async {
        lock_row(&txn, &destination)
            .await
            .map_err(DestinationError::from)?;
        let current = table::destinations::get_on(&txn, &destination.org_id, &destination.name)
            .await
            .map_err(DestinationError::from)?;
        if current.as_ref().is_some_and(has_store_ref) {
            return Err(SecretRefusal::from(SecretErrorCode::PolicyChanged).into());
        }
        table::destinations::put_in(&txn, destination)
            .await
            .map_err(|e| DestinationError::from(e).into())
    }
    .await;
    let finished = match written {
        Ok(_) => txn.commit().await,
        Err(_) => txn.rollback().await,
    };
    let saved = written?;
    finished.map_err(|e| DestinationError::from(InfraError::from(e)))?;
    Ok(saved)
}

async fn publish_destination(saved: &Destination) -> Result<(), DestinationError> {
    let event_key = format!("/destinations/{}/{}", saved.org_id, saved.name);
    infra::coordinator::emit_put(&event_key).await?;
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && o2_enterprise::enterprise::super_cluster::queue::destinations_put(
            &event_key,
            saved.clone(),
        )
        .await
        .is_err()
    {
        log::error!(
            "Failed to publish destination update for org {}",
            saved.org_id
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{DestinationType, Endpoint, HTTPType, Module};

    use super::*;

    fn addrs(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    mod secret_saves {
        use std::future::Future;

        use config::{
            ider::ksuid,
            meta::{
                destinations::SecretBindInput,
                secret_store::{BindRequest, ConsumerType, GateState, SecretErrorCode, digest},
                user::UserRole,
            },
        };
        use infra::{
            db::get_orm_client_rw,
            secret_store::{gate, metadata::METADATA_CAP_BYTES},
            table::{
                cipher, org_secret_consumers,
                org_secret_values::{self, ORG_ENV},
                org_secrets::{self, PinMode},
                secret_consumer_auth as auth, secret_dependencies, secret_refs,
            },
        };
        use sea_orm::{IntoActiveModel, Set};
        use serde_json::json;

        use super::*;

        const HOST: &str = "8.8.8.8";
        const TOKEN: &str = "{{secrets.TOKEN}}";
        const HEADER_FIELD: &str = "/module/alert/destination_type/headers/Authorization";

        struct Fixture {
            org: String,
            root: SavePrincipal,
        }

        impl Fixture {
            fn new() -> Self {
                Self {
                    org: ksuid(),
                    root: SavePrincipal {
                        user_id: "root@example.org".into(),
                        role: UserRole::Root,
                    },
                }
            }

            fn destination(&self, header: &str) -> Destination {
                Destination {
                    name: "webhook".into(),
                    org_id: self.org.clone(),
                    module: Module::Alert {
                        template: None,
                        destination_type: DestinationType::Http(Endpoint {
                            url: format!("https://{HOST}/events"),
                            headers: Some([("Authorization".into(), header.into())].into()),
                            ..Default::default()
                        }),
                    },
                    ..Default::default()
                }
            }

            async fn secret(&self, pin: PinMode, env: &str) -> org_secrets::Model {
                self.policy("TOKEN", "secret", pin, env).await
            }

            async fn variable(&self, name: &str) -> org_secrets::Model {
                self.policy(name, "variable", PinMode::None, ORG_ENV).await
            }

            async fn policy(
                &self,
                name: &str,
                kind: &str,
                pin: PinMode,
                env: &str,
            ) -> org_secrets::Model {
                let db = get_orm_client_rw().await;
                cipher::get_dek(&self.org).await.unwrap();
                let row = org_secrets::insert_in(
                    db,
                    org_secrets::ActiveModel {
                        org_id: Set(self.org.clone()),
                        id: Set(ksuid()),
                        name: Set(name.into()),
                        kind: Set(kind.into()),
                        pin_mode: Set(pin),
                        allowed_hosts: Set(if pin == PinMode::Hosts {
                            format!("https://{HOST}:443")
                        } else {
                            String::new()
                        }),
                        description: Set(String::new()),
                        state: Set("active".into()),
                        policy_rev: Set(ksuid()),
                        policy_version: Set(1),
                        created_by: Set("owner".into()),
                        updated_by: Set("owner".into()),
                        created_at: Set(1),
                        updated_at: Set(1),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
                org_secret_values::insert_in(
                    db,
                    org_secret_values::ActiveModel {
                        org_id: Set(self.org.clone()),
                        id: Set(ksuid()),
                        secret_id: Set(row.id.clone()),
                        env_id: Set(env.into()),
                        env_incarnation: Set(String::new()),
                        state: Set("set".into()),
                        value_ref: Set(Some(ksuid())),
                        backend_id: Set(None),
                        value_rev: Set(ksuid()),
                        value_version: Set(1),
                        updated_by: Set("owner".into()),
                    },
                )
                .await
                .unwrap();
                row
            }

            async fn allow(&self, row: &org_secrets::Model) {
                org_secret_consumers::add_in(
                    get_orm_client_rw().await,
                    org_secret_consumers::ActiveModel {
                        org_id: Set(self.org.clone()),
                        secret_id: Set(row.id.clone()),
                        consumer_type: Set(ConsumerType::AlertDestination.as_str().into()),
                        consumer_id: Set(org_secret_consumers::ANY_CONSUMER.into()),
                        added_by: Set("owner".into()),
                        added_at: Set(1),
                    },
                )
                .await
                .unwrap();
            }

            async fn save(
                &self,
                dest: Destination,
                create: bool,
            ) -> Result<(Destination, Option<BindRequest>), DestinationSaveError> {
                save_with_binds("", dest, create, &self.root, vec![]).await
            }

            async fn auth(&self, id: &str) -> Option<auth::Model> {
                auth::get_in(
                    get_orm_client_rw().await,
                    &self.org,
                    ConsumerType::AlertDestination.as_str(),
                    id,
                )
                .await
                .unwrap()
            }
        }

        fn run(path: &str, enabled: bool, task: impl Future<Output = ()>) {
            if std::env::var_os("ZO_META_STORE").is_none() {
                return;
            }
            let base = std::env::var_os("ZO_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            let data = base.join(format!("destination-save-{}", ksuid()));
            let dir = format!("{}/", data.display());
            // The gate override and master key apply process-wide.
            crate::ssrf_test_support::isolated(
                path,
                &[
                    (
                        "O2_SECRET_STORE_REFS_ENABLED",
                        if enabled { "true" } else { "false" },
                    ),
                    ("O2_OPENFGA_ENABLED", "false"),
                    ("ZO_DATA_DIR", &dir),
                ],
                || async {
                    meta_store().await;
                    cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
                    set_gate(if enabled {
                        GateState::Latched
                    } else {
                        GateState::Closed
                    });
                    task.await;
                },
            );
            if data.exists() {
                std::fs::remove_dir_all(data).unwrap();
            }
        }

        fn set_gate(state: GateState) {
            gate::force_state_for_tests(Some(gate::GateView {
                state,
                suspended: false,
            }));
        }

        fn endpoint(dest: &mut Destination) -> &mut Endpoint {
            let Module::Alert {
                destination_type: DestinationType::Http(endpoint),
                ..
            } = &mut dest.module
            else {
                panic!("expected alert webhook");
            };
            endpoint
        }

        fn refusal(err: DestinationSaveError, code: SecretErrorCode) -> SecretRefusal {
            let DestinationSaveError::Secret(refusal) = err else {
                panic!("expected secret refusal: {err:?}")
            };
            assert_eq!(refusal.code, code);
            assert_eq!(refusal.status(), code.http_status().unwrap());
            refusal
        }

        #[test]
        fn refs_off_saves_store_ref_text_like_main() {
            run(
                concat!(module_path!(), "::refs_off_saves_store_ref_text_like_main"),
                false,
                async {
                    let f = Fixture::new();
                    for pipeline in [false, true] {
                        let mut destination = f.destination("Bearer {{secrets.tok}}");
                        let ep = endpoint(&mut destination);
                        ep.url.push_str("?region={{vars.x}}");
                        ep.metadata.insert("note".into(), "{{vars.x}}".into());
                        let expected = ep.clone();
                        if pipeline {
                            destination.name = "pipeline".into();
                            destination.module = Module::Pipeline {
                                endpoint: expected.clone(),
                            };
                        }
                        let saved = save("", destination, true).await.unwrap();
                        let saved = save("", saved, false).await.unwrap();
                        let stored = table::destinations::get(&f.org, &saved.name)
                            .await
                            .unwrap()
                            .unwrap();
                        assert_eq!(
                            crate::alerts::destinations::endpoint(&stored),
                            Some(&expected)
                        );
                        let id = stored.id.unwrap().to_string();
                        let ty = consumer_type(&stored).as_str();
                        let db = get_orm_client_rw().await;
                        assert!(
                            secret_refs::list_for_consumer_in(db, &f.org, ty, &id)
                                .await
                                .unwrap()
                                .is_empty()
                        );
                        assert!(
                            secret_dependencies::list_for_consumer_in(db, &f.org, ty, &id)
                                .await
                                .unwrap()
                                .is_empty()
                        );
                        assert!(auth::get_in(db, &f.org, ty, &id).await.unwrap().is_none());
                    }
                },
            );
        }

        #[test]
        fn refs_off_explicit_binds_keep_the_gate_refusal() {
            run(
                concat!(
                    module_path!(),
                    "::refs_off_explicit_binds_keep_the_gate_refusal"
                ),
                false,
                async {
                    let f = Fixture::new();
                    let mut destination = f.destination(TOKEN);
                    endpoint(&mut destination).destination_type = Some("pagerduty".into());
                    let binds = serde_json::from_value(json!([{
                        "secret_id": "tok",
                        "pin": "keep",
                        "expected_policy_rev": "revision",
                    }]))
                    .unwrap();
                    refusal(
                        save_with_binds("", destination, true, &f.root, binds)
                            .await
                            .unwrap_err(),
                        SecretErrorCode::StoreGateClosed,
                    );
                    assert!(
                        table::templates::get_own(&f.org, "prebuilt_pagerduty")
                            .await
                            .unwrap()
                            .is_none()
                    );
                },
            );
        }

        #[test]
        fn refs_off_endpoints_use_literal_delivery() {
            crate::ssrf_test_support::isolated(
                concat!(module_path!(), "::refs_off_endpoints_use_literal_delivery"),
                &[("O2_SECRET_STORE_REFS_ENABLED", "false")],
                || async {
                    let endpoint = Endpoint {
                        url: "https://8.8.8.8/{{vars.x}}".into(),
                        headers: Some(
                            [("Authorization".into(), "Bearer {{secrets.tok}}".into())].into(),
                        ),
                        metadata: [("note".into(), "{{vars.x}}".into())].into(),
                        ..Default::default()
                    };
                    assert!(endpoint.has_store_ref());
                    assert!(!endpoint.uses_store_refs());
                    assert!(
                        crate::alerts::notifications::send::refuse_endpoint_refs(&endpoint).is_ok()
                    );
                    assert!(
                        crate::alerts::notifications::send::SecretRequest::new(
                            None,
                            &endpoint,
                            reqwest::Client::builder()
                        )
                        .await
                        .unwrap()
                        .is_none()
                    );
                    let ctx = crate::alerts::notifications::NotificationContext {
                        metadata: vec![
                            ("note".into(), "{{vars.x}}".into()),
                            ("credential".into(), "{{secrets.tok}}".into()),
                        ],
                        ..Default::default()
                    };
                    assert_eq!(
                        crate::alerts::notifications::apply_custom_template(
                            "{note}|{credential}",
                            &ctx,
                            false
                        ),
                        "{{vars.x}}|{{secrets.tok}}"
                    );
                    let context =
                        crate::alerts::notifications::render::webhook::context_object(&ctx);
                    assert_eq!(context["note"], "{{vars.x}}");
                    assert_eq!(context["credential"], "{{secrets.tok}}");
                },
            );
        }

        #[test]
        fn human_send_authorizes_ref_free_and_rejects_unsaved_destinations() {
            crate::ssrf_test_support::isolated(
                concat!(
                    module_path!(),
                    "::human_send_authorizes_ref_free_and_rejects_unsaved_destinations"
                ),
                &[("O2_SECRET_STORE_REFS_ENABLED", "true")],
                || async {
                    let f = Fixture::new();
                    authorize_human_send(&f.root, &f.destination("literal"))
                        .await
                        .unwrap();
                    let refused = authorize_human_send(&f.root, &f.destination(TOKEN))
                        .await
                        .unwrap_err();
                    assert_eq!(refused.code, SecretErrorCode::SecretUnbound);
                },
            );
        }

        #[test]
        fn t22_super_cluster_ref_save_is_store_disabled() {
            run(
                concat!(
                    module_path!(),
                    "::t22_super_cluster_ref_save_is_store_disabled"
                ),
                true,
                async {
                    let f = Fixture::new();
                    infra::secret_store::mode::set_super_cluster(true, "r1");
                    let refused =
                        authorize_destination_save(&f.root, &f.org, None, &f.destination(TOKEN))
                            .await
                            .unwrap_err();
                    assert_eq!(refused.code, SecretErrorCode::StoreDisabled);
                },
            );
        }

        #[test]
        fn human_send_requires_permission_to_every_bound_secret() {
            run(
                concat!(
                    module_path!(),
                    "::human_send_requires_permission_to_every_bound_secret"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let mut unbound = f.destination(TOKEN);
                    unbound.id = Some(ksuid().parse().unwrap());
                    let refused = authorize_human_send(&f.root, &unbound).await.unwrap_err();
                    assert_eq!(refused.code, SecretErrorCode::SecretUnbound);

                    let secret = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&secret).await;
                    let (dest, _) = f.save(f.destination(TOKEN), true).await.unwrap();
                    authorize_human_send(&f.root, &dest).await.unwrap();

                    let member = SavePrincipal {
                        user_id: "member@example.org".into(),
                        role: UserRole::Editor,
                    };
                    let refused = authorize_human_send(&member, &dest).await.unwrap_err();
                    assert_eq!(refused.code, SecretErrorCode::SecretUseDenied);
                    assert_eq!(refused.secret.as_deref(), Some("TOKEN"));
                },
            );
        }

        #[test]
        fn variable_destination_save_and_human_authorization_require_use() {
            run(
                concat!(
                    module_path!(),
                    "::variable_destination_save_and_human_authorization_require_use"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let variable = f.variable("REGION").await;
                    f.allow(&variable).await;
                    let editor = SavePrincipal {
                        user_id: "editor@example.org".into(),
                        role: UserRole::Editor,
                    };
                    refusal(
                        save_with_binds(
                            "",
                            f.destination("{{vars.REGION}}"),
                            true,
                            &editor,
                            vec![],
                        )
                        .await
                        .unwrap_err(),
                        SecretErrorCode::SecretUseDenied,
                    );
                    assert!(
                        table::destinations::get(&f.org, "webhook")
                            .await
                            .unwrap()
                            .is_none()
                    );
                    let grants =
                        BTreeSet::from([(format!("secrets:{}", variable.id), "GET".into())]);
                    let (saved, bind) = SECRET_GRANTS
                        .scope(
                            grants.clone(),
                            save_with_binds(
                                "",
                                f.destination("{{vars.REGION}}"),
                                true,
                                &editor,
                                vec![],
                            ),
                        )
                        .await
                        .unwrap();
                    assert!(bind.unwrap().refs.is_empty());
                    assert!(f.auth(&saved.id.unwrap().to_string()).await.is_some());
                    SECRET_GRANTS
                        .scope(grants, authorize_human_send(&editor, &saved))
                        .await
                        .unwrap();
                    authorize_human_send(&f.root, &saved).await.unwrap();
                    let denied = authorize_human_send(&editor, &saved).await.unwrap_err();
                    assert_eq!(denied.code, SecretErrorCode::SecretUseDenied);
                    assert_eq!(denied.secret.as_deref(), Some("REGION"));
                },
            );
        }

        #[test]
        fn variable_dependency_bind_options_can_extend_allowlist() {
            run(
                concat!(
                    module_path!(),
                    "::variable_dependency_bind_options_can_extend_allowlist"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let variable = f.variable("REGION").await;
                    refusal(
                        f.save(f.destination("{{vars.REGION}}"), true)
                            .await
                            .unwrap_err(),
                        SecretErrorCode::ConsumerNotAllowed,
                    );
                    let binds = serde_json::from_value(json!([{
                        "secret_id": variable.id,
                        "allow_this_consumer": true,
                        "pin": "keep",
                        "expected_policy_rev": variable.policy_rev,
                    }]))
                    .unwrap();
                    let admin = SavePrincipal {
                        user_id: "admin@example.org".into(),
                        role: UserRole::Admin,
                    };
                    let grants = BTreeSet::from([
                        (format!("secrets:{}", variable.id), "GET".into()),
                        (format!("secret_access:{}", variable.id), "PUT".into()),
                    ]);
                    let (saved, bind) = SECRET_GRANTS
                        .scope(
                            grants,
                            save_with_binds(
                                "",
                                f.destination("{{vars.REGION}}"),
                                true,
                                &admin,
                                binds,
                            ),
                        )
                        .await
                        .unwrap();
                    assert!(bind.is_some());
                    let allowed = org_secret_consumers::list_consumers_in(
                        get_orm_client_rw().await,
                        &f.org,
                        &variable.id,
                    )
                    .await
                    .unwrap();
                    assert!(
                        allowed
                            .iter()
                            .any(|row| row.consumer_id == saved.id.unwrap().to_string())
                    );
                },
            );
        }

        #[test]
        fn unchanged_variable_dependencies_allow_template_edits_without_use() {
            run(
                concat!(
                    module_path!(),
                    "::unchanged_variable_dependencies_allow_template_edits_without_use"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let region = f.variable("REGION").await;
                    f.allow(&region).await;
                    let (mut saved, _) = f
                        .save(f.destination("{{vars.REGION}}"), true)
                        .await
                        .unwrap();
                    table::templates::put(Template {
                        org_id: f.org.clone(),
                        name: "new".into(),
                        body: "{}".into(),
                        ..Default::default()
                    })
                    .await
                    .unwrap();
                    let Module::Alert { template, .. } = &mut saved.module else {
                        panic!("expected alert")
                    };
                    *template = Some("new".into());
                    let editor = SavePrincipal {
                        user_id: "editor@example.org".into(),
                        role: UserRole::Editor,
                    };
                    let (mut saved, _) = save_with_binds("", saved, false, &editor, vec![])
                        .await
                        .unwrap();
                    let other = f.variable("OTHER").await;
                    f.allow(&other).await;
                    endpoint(&mut saved)
                        .headers
                        .as_mut()
                        .unwrap()
                        .insert("X-Other".into(), "{{vars.OTHER}}".into());
                    refusal(
                        save_with_binds("", saved, false, &editor, vec![])
                            .await
                            .unwrap_err(),
                        SecretErrorCode::SecretUseDenied,
                    );
                },
            );
        }

        #[test]
        fn missing_variable_dependencies_follow_secret_role_visibility() {
            run(
                concat!(
                    module_path!(),
                    "::missing_variable_dependencies_follow_secret_role_visibility"
                ),
                true,
                async {
                    for (role, code) in [
                        (UserRole::Root, SecretErrorCode::SecretNotFound),
                        (UserRole::Admin, SecretErrorCode::SecretNotFound),
                        (UserRole::Editor, SecretErrorCode::SecretUseDenied),
                        (UserRole::Viewer, SecretErrorCode::SecretUseDenied),
                    ] {
                        let f = Fixture::new();
                        let actor = SavePrincipal {
                            user_id: "user@example.org".into(),
                            role,
                        };
                        let absent = refusal(
                            save_with_binds(
                                "",
                                f.destination("{{vars.MISSING}}"),
                                true,
                                &actor,
                                vec![],
                            )
                            .await
                            .unwrap_err(),
                            code,
                        );
                        assert_eq!(absent.secret.as_deref(), Some("MISSING"));
                        if code == SecretErrorCode::SecretUseDenied {
                            let variable = f.variable("MISSING").await;
                            f.allow(&variable).await;
                            let denied = refusal(
                                save_with_binds(
                                    "",
                                    f.destination("{{vars.MISSING}}"),
                                    true,
                                    &actor,
                                    vec![],
                                )
                                .await
                                .unwrap_err(),
                                code,
                            );
                            assert_eq!(absent.body(), denied.body());
                        }
                    }
                },
            );
        }

        #[test]
        fn closed_gate_allows_literals_and_unchanged_legacy_headers() {
            run(
                concat!(
                    module_path!(),
                    "::closed_gate_allows_literals_and_unchanged_legacy_headers"
                ),
                true,
                async {
                    set_gate(GateState::Closed);
                    let f = Fixture::new();
                    let (dest, bind) = f.save(f.destination("literal"), true).await.unwrap();
                    assert!(bind.is_none());
                    let mut legacy = dest;
                    endpoint(&mut legacy)
                        .headers
                        .as_mut()
                        .unwrap()
                        .insert("Authorization".into(), "{{secret.X}}".into());
                    infra::table::destinations::put(legacy.clone())
                        .await
                        .unwrap();
                    assert!(f.save(legacy.clone(), false).await.unwrap().1.is_none());
                    endpoint(&mut legacy)
                        .headers
                        .as_mut()
                        .unwrap()
                        .insert("Authorization".into(), "new {{secret.X}}".into());
                    refusal(
                        f.save(legacy, false).await.unwrap_err(),
                        SecretErrorCode::RefTypo,
                    );
                    let mut with_ref = f.destination(TOKEN);
                    endpoint(&mut with_ref).destination_type = Some("pagerduty".into());
                    refusal(
                        f.save(with_ref, false).await.unwrap_err(),
                        SecretErrorCode::StoreGateClosed,
                    );
                    assert!(
                        infra::table::templates::get_own(&f.org, "prebuilt_pagerduty")
                            .await
                            .unwrap()
                            .is_none()
                    );
                },
            );
        }

        #[test]
        fn url_and_header_slots_enforce_transport_and_authority() {
            use SecretErrorCode::{
                AuthorityOverrideRefused, InsecureTransport, RefNotAllowedInField,
                TemplatedAuthorityRefused,
            };

            let f = Fixture::new();
            for (url, skip_verify, header, expected) in [
                (
                    "http://8.8.8.8/events",
                    false,
                    "X-Auth",
                    Some(InsecureTransport),
                ),
                ("https://8.8.8.8/", true, "X-Auth", Some(InsecureTransport)),
                (
                    "https://{{vars.HOST}}/events",
                    false,
                    "X-Auth",
                    Some(TemplatedAuthorityRefused),
                ),
                (
                    "https://8.8.8.8/",
                    false,
                    "hOsT",
                    Some(AuthorityOverrideRefused),
                ),
                (
                    "https://8.8.8.8/",
                    false,
                    ":authority",
                    Some(AuthorityOverrideRefused),
                ),
                (
                    "https://8.8.8.8/",
                    false,
                    "{{vars.KEY}}",
                    Some(RefNotAllowedInField),
                ),
                (
                    "https://8.8.8.8/#{{secrets.TOKEN}}",
                    false,
                    "X-Auth",
                    Some(RefNotAllowedInField),
                ),
                (
                    "https://8.8.8.8?key={{secrets.TOKEN}}",
                    false,
                    "X-Auth",
                    None,
                ),
            ] {
                let mut dest = f.destination(TOKEN);
                let ep = endpoint(&mut dest);
                ep.url = url.into();
                ep.skip_tls_verify = skip_verify;
                ep.headers = Some([(header.into(), TOKEN.into())].into());
                let slots = destination_slots(&dest, None);
                if let Some(code) = expected {
                    assert_eq!(
                        slots.err().map(|err| err.code),
                        Some(code),
                        "{url} {header}"
                    );
                } else {
                    let slots = slots.unwrap();
                    assert!(
                        slots
                            .iter()
                            .any(|s| s.field.ends_with("/url") && s.tokens[0].name == "TOKEN")
                    );
                }
            }
        }

        #[test]
        fn routing_key_uses_the_effective_alert_render_format() {
            let f = Fixture::new();
            for (platform, override_format, accepts) in [
                ("custom", "pagerduty", true),
                ("pagerduty", "webhook", false),
            ] {
                let mut dest = f.destination("literal");
                let ep = endpoint(&mut dest);
                ep.destination_type = Some(platform.into());
                ep.metadata
                    .insert("render_format".into(), override_format.into());
                ep.metadata.insert("routing_key".into(), TOKEN.into());
                let result = destination_slots(&dest, None);
                if accepts {
                    assert!(result.is_ok());
                } else {
                    assert_eq!(
                        result.err().map(|err| err.code),
                        Some(SecretErrorCode::RefNotAllowedInField)
                    );
                }
            }
        }

        #[test]
        fn only_pagerduty_routing_key_accepts_metadata_refs() {
            run(
                concat!(
                    module_path!(),
                    "::only_pagerduty_routing_key_accepts_metadata_refs"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let row = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&row).await;
                    for (platform, key) in [
                        ("servicenow", "routing_key"),
                        ("pagerduty", "note"),
                        ("custom", "routing_key"),
                        ("pagerduty", "routing_key"),
                    ] {
                        let mut dest = f.destination("literal");
                        let ep = endpoint(&mut dest);
                        ep.destination_type = Some(platform.into());
                        ep.metadata.insert(key.into(), TOKEN.into());
                        let result = f.save(dest, true).await;
                        if platform == "pagerduty" && key == "routing_key" {
                            let (_, bind) = result.unwrap();
                            assert_eq!(bind.unwrap().refs[0].secret_id, row.id);
                        } else {
                            refusal(result.unwrap_err(), SecretErrorCode::RefNotAllowedInField);
                        }
                    }
                },
            );
        }

        #[test]
        fn missing_secret_is_not_found_for_org_admins_and_hidden_from_members() {
            run(
                concat!(
                    module_path!(),
                    "::missing_secret_is_not_found_for_org_admins_and_hidden_from_members"
                ),
                true,
                async {
                    for (role, code) in [
                        (UserRole::Root, SecretErrorCode::SecretNotFound),
                        (UserRole::Admin, SecretErrorCode::SecretNotFound),
                        (UserRole::Editor, SecretErrorCode::SecretUseDenied),
                        (UserRole::Viewer, SecretErrorCode::SecretUseDenied),
                    ] {
                        let f = Fixture::new();
                        let mut destination = f.destination("Bearer {{secrets.MISSING}}");
                        destination.id = Some(ksuid().parse().unwrap());
                        let slots = destination_slots(&destination, None).unwrap();
                        let actor = SavePrincipal { role, ..f.root };
                        let refused = prepare_bind(
                            get_orm_client_rw().await,
                            &destination,
                            None,
                            &slots,
                            &actor,
                            &[],
                        )
                        .await
                        .err()
                        .unwrap();
                        assert_eq!(refused.code, code);
                        assert_eq!(refused.secret.as_deref(), Some("MISSING"));
                    }
                },
            );
        }

        #[test]
        fn env_only_value_and_missing_pin_refuse_the_write() {
            run(
                concat!(
                    module_path!(),
                    "::env_only_value_and_missing_pin_refuse_the_write"
                ),
                true,
                async {
                    let unknown = Fixture::new();
                    let error = refusal(
                        unknown
                            .save(unknown.destination("Bearer {{secrets.MISSING}}"), true)
                            .await
                            .unwrap_err(),
                        SecretErrorCode::SecretNotFound,
                    );
                    assert_eq!(error.body()["secret"], "MISSING");
                    for (env, pin, code) in [
                        ("staging", PinMode::Hosts, SecretErrorCode::NoOrgValue),
                        (ORG_ENV, PinMode::None, SecretErrorCode::SecretPinRequired),
                    ] {
                        let f = Fixture::new();
                        let secret = f.secret(pin, env).await;
                        f.allow(&secret).await;
                        let error =
                            refusal(f.save(f.destination(TOKEN), true).await.unwrap_err(), code);
                        if pin == PinMode::None {
                            let body = error.body();
                            assert_eq!(body["suggested_hosts"], json!([HOST]));
                            assert_eq!(body["secret"], "TOKEN");
                        }
                        assert!(
                            !infra::table::destinations::exists_row(&f.org, "webhook")
                                .await
                                .unwrap()
                        );
                        assert!(
                            secret_refs::list_for_secret_in(
                                get_orm_client_rw().await,
                                &f.org,
                                &secret.id
                            )
                            .await
                            .unwrap()
                            .is_empty()
                        );
                    }
                },
            );
        }

        #[test]
        fn allowlist_over_cap_rolls_back_destination_and_policy() {
            run(
                concat!(
                    module_path!(),
                    "::allowlist_over_cap_rolls_back_destination_and_policy"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let db = get_orm_client_rw().await;
                    let secret = f.secret(PinMode::Hosts, ORG_ENV).await;
                    let room = METADATA_CAP_BYTES - secret.name.len() - secret.allowed_hosts.len();
                    let mut full = secret.into_active_model();
                    full.description = Set("x".repeat(room));
                    let secret = org_secrets::update_in(db, &f.org, full)
                        .await
                        .unwrap()
                        .unwrap();
                    let binds: Vec<SecretBindInput> = serde_json::from_value(json!([{
                    "secret_id": secret.id, "allow_this_consumer": true, "pin": "keep", "expected_policy_rev": secret.policy_rev
                }])).unwrap();
                    let err = save_with_binds("", f.destination(TOKEN), true, &f.root, binds)
                        .await
                        .unwrap_err();
                    refusal(err, SecretErrorCode::SecretMetadataTooLarge);
                    assert!(
                        !infra::table::destinations::exists_row(&f.org, "webhook")
                            .await
                            .unwrap()
                    );
                    assert!(
                        secret_refs::list_for_secret_in(db, &f.org, &secret.id)
                            .await
                            .unwrap()
                            .is_empty()
                    );
                    assert!(
                        org_secret_consumers::list_consumers_in(db, &f.org, &secret.id)
                            .await
                            .unwrap()
                            .is_empty()
                    );
                    assert_eq!(
                        org_secrets::get_secret_in(db, &f.org, &secret.id)
                            .await
                            .unwrap()
                            .unwrap(),
                        secret
                    );
                },
            );
        }

        #[test]
        fn stale_auth_requires_use_for_a_template_only_edit() {
            run(
                concat!(
                    module_path!(),
                    "::stale_auth_requires_use_for_a_template_only_edit"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let db = get_orm_client_rw().await;
                    let secret = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&secret).await;
                    let (mut saved, bind) = f.save(f.destination(TOKEN), true).await.unwrap();
                    let request = bind.unwrap();
                    assert_eq!(request.saved_by, f.root.user_id);
                    assert_eq!(request.refs.len(), 1);
                    assert_eq!(request.refs[0].field, HEADER_FIELD);
                    assert_eq!(request.refs[0].secret_id, secret.id);
                    let id = saved.id.unwrap().to_string();
                    let signed = f.auth(&id).await.unwrap();
                    let digests = digest::decode_dep_digests(&signed.dep_digests).unwrap();
                    assert_eq!(
                        digests,
                        [(ORG_ENV.into(), digest::empty_dep_digest())].into()
                    );
                    let mut stale = signed.clone().into_active_model();
                    stale.auth_state = Set(auth::AuthState::Stale);
                    auth::update_in(db, &f.org, stale).await.unwrap().unwrap();
                    infra::table::templates::put(Template {
                        org_id: f.org.clone(),
                        name: "new".into(),
                        body: "{}".into(),
                        ..Default::default()
                    })
                    .await
                    .unwrap();
                    let Module::Alert { template, .. } = &mut saved.module else {
                        panic!("expected alert")
                    };
                    *template = Some("new".into());
                    let editor = SavePrincipal {
                        user_id: "editor@example.org".into(),
                        role: UserRole::Editor,
                    };
                    refusal(
                        save_with_binds("", saved.clone(), false, &editor, vec![])
                            .await
                            .unwrap_err(),
                        SecretErrorCode::SecretUseDenied,
                    );
                    assert_eq!(
                        f.auth(&id).await.unwrap().auth_state,
                        auth::AuthState::Stale
                    );
                    assert!(f.save(saved, false).await.unwrap().1.is_some());
                    let resigned = f.auth(&id).await.unwrap();
                    assert_eq!(resigned.auth_state, auth::AuthState::Ok);
                    assert_eq!(resigned.delivery_digest, signed.delivery_digest);
                    assert_eq!(resigned.consumer_rev, signed.consumer_rev + 1);
                },
            );
        }

        #[test]
        fn changed_slot_keeps_bound_id_after_name_reuse_and_unbinds_with_gate_closed() {
            run(
                concat!(
                    module_path!(),
                    "::changed_slot_keeps_bound_id_after_name_reuse_and_unbinds_with_gate_closed"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let db = get_orm_client_rw().await;
                    let original = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&original).await;
                    let (saved, _) = f.save(f.destination(TOKEN), true).await.unwrap();
                    let id = saved.id.unwrap().to_string();
                    let mut renamed = original.clone().into_active_model();
                    renamed.name = Set("RENAMED".into());
                    org_secrets::update_in(db, &f.org, renamed)
                        .await
                        .unwrap()
                        .unwrap();
                    let reused = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&reused).await;
                    let region = f.variable("REGION").await;
                    f.allow(&region).await;
                    let (_, bind) = f
                        .save(
                            f.destination("Bearer {{secrets.TOKEN}} {{vars.REGION}}"),
                            false,
                        )
                        .await
                        .unwrap();
                    assert_eq!(bind.unwrap().refs[0].secret_id, original.id);
                    let mut stored = infra::table::destinations::get(&f.org, "webhook")
                        .await
                        .unwrap()
                        .unwrap();
                    assert_eq!(
                        endpoint(&mut stored).headers.as_ref().unwrap()["Authorization"],
                        "Bearer {{secrets.RENAMED}} {{vars.REGION}}"
                    );
                    let ty = ConsumerType::AlertDestination.as_str();
                    let refs = secret_refs::list_for_consumer_in(db, &f.org, ty, &id)
                        .await
                        .unwrap();
                    assert_eq!(refs.len(), 1);
                    assert_eq!(refs[0].token_name, "RENAMED");
                    assert_eq!(refs[0].secret_id, original.id);
                    let deps = secret_dependencies::list_for_consumer_in(db, &f.org, ty, &id)
                        .await
                        .unwrap();
                    assert_eq!(deps.len(), 1);
                    assert_eq!(
                        deps[0].dep_key,
                        secret_dependencies::var_dep_key(&region.id)
                    );
                    set_gate(GateState::Closed);
                    assert!(
                        f.save(f.destination("literal"), false)
                            .await
                            .unwrap()
                            .1
                            .is_none()
                    );
                    assert!(f.auth(&id).await.is_none());
                    assert!(
                        secret_refs::list_for_consumer_in(db, &f.org, ty, &id)
                            .await
                            .unwrap()
                            .is_empty()
                    );
                    assert!(
                        secret_dependencies::list_for_consumer_in(db, &f.org, ty, &id)
                            .await
                            .unwrap()
                            .is_empty()
                    );
                },
            );
        }

        #[test]
        fn a_renamed_secret_is_respelled_in_the_destination_and_stays_authorized() {
            run(
                concat!(
                    module_path!(),
                    "::a_renamed_secret_is_respelled_in_the_destination_and_stays_authorized"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let db = get_orm_client_rw().await;
                    let secret = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&secret).await;
                    let (saved, _) = f.save(f.destination(TOKEN), true).await.unwrap();
                    let id = saved.id.unwrap().to_string();
                    let signed = f.auth(&id).await.unwrap();
                    let mut renamed = secret.into_active_model();
                    renamed.name = Set("RENAMED".into());
                    org_secrets::update_in(db, &f.org, renamed)
                        .await
                        .unwrap()
                        .unwrap();
                    let ty = ConsumerType::AlertDestination;
                    let key = k_auth_for(&f.org).await.unwrap();
                    let other = DestinationRespell(ConsumerType::PipelineDestination);
                    assert!(
                        infra::secret_store::respell::respell_consumer(
                            &f.org, ty, &id, &other, &key
                        )
                        .await
                        .is_err()
                    );
                    let cache_key = format!("{}/webhook", f.org);
                    common::infra::config::DESTINATIONS.insert(cache_key.clone(), saved.clone());
                    let target = DestinationRespell(ty);
                    assert!(
                        infra::secret_store::respell::respell_consumer(
                            &f.org, ty, &id, &target, &key
                        )
                        .await
                        .unwrap()
                    );
                    let mut stored = infra::table::destinations::get(&f.org, "webhook")
                        .await
                        .unwrap()
                        .unwrap();
                    assert_eq!(stored.id, saved.id);
                    assert_eq!(
                        endpoint(&mut stored).headers.as_ref().unwrap()["Authorization"],
                        "{{secrets.RENAMED}}"
                    );
                    let resigned = f.auth(&id).await.unwrap();
                    assert_eq!(resigned.delivery_digest, signed.delivery_digest);
                    assert_eq!(resigned.via, "system:respell");
                    assert!(destination_snapshot(&stored).await.unwrap().is_some());
                    let mut cached = common::infra::config::DESTINATIONS
                        .get(&cache_key)
                        .unwrap()
                        .clone();
                    assert_eq!(
                        endpoint(&mut cached).headers.as_ref().unwrap()["Authorization"],
                        "{{secrets.RENAMED}}"
                    );
                },
            );
        }

        #[test]
        fn human_sends_skip_ref_free_and_missing_names_and_refuse_a_non_member() {
            run(
                concat!(
                    module_path!(),
                    "::human_sends_skip_ref_free_and_missing_names_and_refuse_a_non_member"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let mut plain = f.destination("literal");
                    plain.name = "plain".into();
                    f.save(plain, true).await.unwrap();
                    let names = ["missing".to_string(), "plain".to_string()];
                    authorize_human_sends(&f.org, "nobody@example.org", &names)
                        .await
                        .unwrap();
                    let secret = f.secret(PinMode::Hosts, ORG_ENV).await;
                    f.allow(&secret).await;
                    f.save(f.destination(TOKEN), true).await.unwrap();
                    let names = ["plain".to_string(), "webhook".to_string()];
                    let refused = authorize_human_sends(&f.org, "nobody@example.org", &names)
                        .await
                        .unwrap_err();
                    assert_eq!(refused.code, SecretErrorCode::SecretUseDenied);
                },
            );
        }

        #[test]
        fn a_plain_save_does_not_overwrite_a_row_bound_after_it_was_read() {
            run(
                concat!(
                    module_path!(),
                    "::a_plain_save_does_not_overwrite_a_row_bound_after_it_was_read"
                ),
                true,
                async {
                    let f = Fixture::new();
                    let (plain, _) = f.save(f.destination("literal"), true).await.unwrap();
                    let mut bound = plain.clone();
                    endpoint(&mut bound)
                        .headers
                        .as_mut()
                        .unwrap()
                        .insert("Authorization".into(), TOKEN.into());
                    infra::table::destinations::put(bound).await.unwrap();
                    let mut edit = plain.clone();
                    endpoint(&mut edit).url = format!("https://{HOST}/other");
                    refusal(
                        persist_plain(edit).await.unwrap_err(),
                        SecretErrorCode::PolicyChanged,
                    );
                    let mut stored = infra::table::destinations::get(&f.org, "webhook")
                        .await
                        .unwrap()
                        .unwrap();
                    let stored = endpoint(&mut stored);
                    assert_eq!(stored.url, format!("https://{HOST}/events"));
                    assert_eq!(stored.headers.as_ref().unwrap()["Authorization"], TOKEN);
                    infra::table::destinations::put(plain.clone())
                        .await
                        .unwrap();
                    let mut edit = plain;
                    endpoint(&mut edit).url = format!("https://{HOST}/other");
                    let mut saved = persist_plain(edit).await.unwrap();
                    assert_eq!(endpoint(&mut saved).url, format!("https://{HOST}/other"));
                },
            );
        }
    }

    /// Nothing else in this binary migrates the meta store `save` writes to.
    async fn meta_store() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
    }

    #[test]
    fn test_split_org_members() {
        type Checked<'a> = &'a [(&'a str, Option<bool>)];
        type Split = (Vec<String>, Vec<String>);
        let cases: Vec<(Checked, Option<Split>)> = vec![
            (
                &[("a@x.com", Some(true)), ("b@x.com", Some(true))],
                Some((addrs(&["a@x.com", "b@x.com"]), vec![])),
            ),
            (
                &[("a@x.com", Some(true)), ("gone@x.com", Some(false))],
                Some((addrs(&["a@x.com"]), addrs(&["gone@x.com"]))),
            ),
            (
                &[("gone@x.com", Some(false)), ("left@x.com", Some(false))],
                Some((vec![], addrs(&["gone@x.com", "left@x.com"]))),
            ),
            (&[], Some((vec![], vec![]))),
            (&[("a@x.com", Some(true)), ("db@x.com", None)], None),
            (&[("gone@x.com", Some(false)), ("db@x.com", None)], None),
        ];
        for (checked, expected) in cases {
            let input = checked
                .iter()
                .map(|(r, m)| (r.to_string(), m.ok_or_else(|| anyhow::anyhow!("db down"))))
                .collect();
            let got = split_org_members(input);
            assert_eq!(got.ok(), expected, "split for {checked:?}");
        }
    }

    #[test]
    fn test_reject_non_members() {
        type Split = Result<(Vec<String>, Vec<String>), anyhow::Error>;
        let cases: Vec<(Split, Result<(), String>)> = vec![
            (Ok((addrs(&["a@x.com"]), vec![])), Ok(())),
            (Ok((vec![], vec![])), Ok(())),
            (
                Ok((addrs(&["a@x.com"]), addrs(&["gone@x.com"]))),
                Err("UserNotPermitted(\"gone@x.com\")".to_string()),
            ),
            (
                Ok((vec![], addrs(&["gone@x.com", "left@x.com"]))),
                Err("UserNotPermitted(\"gone@x.com, left@x.com\")".to_string()),
            ),
            (
                Err(anyhow::anyhow!("db down")),
                Err("InfraError(Message(\"db down\"))".to_string()),
            ),
        ];
        for (split, expected) in cases {
            let got = reject_non_members(split).map_err(|e| format!("{e:?}"));
            assert_eq!(got, expected);
        }
    }

    #[test]
    fn test_note_skipped() {
        assert_eq!(note_skipped("sent".to_string(), &[]), "sent");
        assert_eq!(
            note_skipped("sent".to_string(), &addrs(&["gone@x.com", "left@x.com"])),
            "sent (skipped recipients not part of this org: gone@x.com, left@x.com)"
        );
    }

    #[test]
    fn test_user_not_permitted_names_the_address() {
        let msg = DestinationError::UserNotPermitted("gone@x.com".to_string()).to_string();
        assert!(msg.contains("gone@x.com"), "{msg}");
    }

    /// Test that ensure_prebuilt_template creates a new template when it doesn't exist
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_ensure_prebuilt_template_creates_new() {
        let org_id = "test_org_create";
        let prebuilt_type = "slack";

        // Clean up any existing template
        let _ = db::alerts::templates::delete(org_id, &format!("prebuilt_{}", prebuilt_type)).await;

        // Ensure template - should create new one
        let result = ensure_prebuilt_template(org_id, prebuilt_type).await;

        assert!(
            result.is_ok(),
            "Should successfully create template, error: {:?}",
            result.as_ref().err()
        );
        let template_name = result.unwrap();
        assert_eq!(template_name, "prebuilt_slack");

        // Verify template was created in database
        let template = db::alerts::templates::get(org_id, &template_name).await;
        assert!(template.is_ok(), "Template should exist in database");

        // Clean up
        let _ = db::alerts::templates::delete(org_id, &template_name).await;
    }

    /// Test that ensure_prebuilt_template reuses existing template
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_ensure_prebuilt_template_reuses_existing() {
        let org_id = "test_org_reuse";
        let prebuilt_type = "slack";
        let template_name = format!("prebuilt_{}", prebuilt_type);

        // Clean up
        let _ = db::alerts::templates::delete(org_id, &template_name).await;

        // Create template first time
        let result1 = ensure_prebuilt_template(org_id, prebuilt_type).await;
        assert!(
            result1.is_ok(),
            "Should successfully create template on first call, error: {:?}",
            result1.as_ref().err()
        );

        // Get template ID to verify it's the same one later
        let template1 = db::alerts::templates::get(org_id, &template_name)
            .await
            .unwrap();

        // Try to ensure template again - should reuse existing
        let result2 = ensure_prebuilt_template(org_id, prebuilt_type).await;
        assert!(
            result2.is_ok(),
            "Should successfully reuse existing template, error: {:?}",
            result2.as_ref().err()
        );
        assert_eq!(result2.unwrap(), template_name);

        // Verify it's the same template (not recreated)
        let template2 = db::alerts::templates::get(org_id, &template_name)
            .await
            .unwrap();
        assert_eq!(template1.name, template2.name);
        assert_eq!(template1.body, template2.body);

        // Clean up
        let _ = db::alerts::templates::delete(org_id, &template_name).await;
    }

    /// Test that multiple destinations of same type share one template
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_multiple_destinations_share_template() {
        let org_id = "test_org_share";

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_1").await;
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_2").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;

        // Create first Slack destination
        let dest1 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_1".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST1".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let saved1 = save("slack_dest_1", dest1.clone(), true).await;
        assert!(
            saved1.is_ok(),
            "First destination should save successfully: {:?}",
            saved1.err()
        );

        // Verify template was created
        let template_check1 = db::alerts::templates::get(org_id, "prebuilt_slack").await;
        assert!(
            template_check1.is_ok(),
            "Template should be created after first destination"
        );

        // Create second Slack destination
        let dest2 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_2".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST2".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let saved2 = save("slack_dest_2", dest2.clone(), true).await;
        assert!(
            saved2.is_ok(),
            "Second destination should save successfully: {:?}",
            saved2.err()
        );

        // Verify both destinations reference the same template
        let dest1_retrieved = get(org_id, "slack_dest_1").await.unwrap();
        let dest2_retrieved = get(org_id, "slack_dest_2").await.unwrap();

        if let Module::Alert {
            template: template1,
            ..
        } = dest1_retrieved.module
            && let Module::Alert {
                template: template2,
                ..
            } = dest2_retrieved.module
        {
            assert_eq!(template1, Some("prebuilt_slack".to_string()));
            assert_eq!(template2, Some("prebuilt_slack".to_string()));
            assert_eq!(
                template1, template2,
                "Both destinations should use the same template"
            );
        }

        // Verify only ONE template exists
        let templates = db::alerts::templates::list(org_id).await.unwrap();
        let slack_templates: Vec<_> = templates
            .iter()
            .filter(|t| t.name == "prebuilt_slack")
            .collect();
        assert_eq!(
            slack_templates.len(),
            1,
            "Should have exactly one prebuilt_slack template"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_1").await;
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_2").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;
    }

    /// Test that template is auto-recreated if manually deleted
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_template_recreation_after_deletion() {
        let org_id = "test_org_recreate";

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_recreate").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;

        // Create first destination (creates template)
        let dest1 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_recreate".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let _ = save("slack_dest_recreate", dest1.clone(), true).await;

        // Verify template exists
        assert!(
            db::alerts::templates::get(org_id, "prebuilt_slack")
                .await
                .is_ok()
        );

        // Force delete the template (simulating manual deletion)
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;

        // Verify template is gone
        assert!(
            db::alerts::templates::get(org_id, "prebuilt_slack")
                .await
                .is_err()
        );

        // Create another destination of same type - should recreate template
        let dest2 = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "slack_dest_recreate2".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/TEST2".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("slack".to_string()),
                    ..Default::default()
                }),
            },
        };

        let result = save("slack_dest_recreate2", dest2.clone(), true).await;
        assert!(
            result.is_ok(),
            "Should successfully create destination and recreate template: {:?}",
            result.err()
        );

        // Verify template was recreated
        assert!(
            db::alerts::templates::get(org_id, "prebuilt_slack")
                .await
                .is_ok(),
            "Template should be recreated"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_recreate").await;
        let _ = db::alerts::destinations::delete(org_id, "slack_dest_recreate2").await;
        let _ = db::alerts::templates::delete(org_id, "prebuilt_slack").await;
    }

    /// Test that custom destination type is skipped from auto-template
    #[tokio::test]
    #[ignore] // Test requires full infrastructure (NATS/DB)
    async fn test_custom_destination_no_auto_template() {
        let org_id = "test_org_custom";

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "custom_webhook").await;

        // Create custom destination with "custom" type
        let dest = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "custom_webhook".to_string(),
            module: Module::Alert {
                template: Some("my_custom_template".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://my-service.com/webhook".to_string(),
                    method: HTTPType::POST,
                    destination_type: Some("custom".to_string()),
                    ..Default::default()
                }),
            },
        };

        let _ = save("custom_webhook", dest.clone(), true).await;

        // Verify no "prebuilt_custom" template was created
        let template_check = db::alerts::templates::get(org_id, "prebuilt_custom").await;
        assert!(
            template_check.is_err(),
            "Should not create prebuilt template for 'custom' type"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "custom_webhook").await;
    }

    /// Templates are optional at the destination level (design §4.4) — a
    /// missing or empty template no longer fails save(); resolution falls
    /// through to the org default / compiled-in fallback at send time
    /// instead. Supersedes the old `test_alert_destination_requires_template`.
    #[tokio::test]
    async fn test_alert_destination_template_is_optional() {
        meta_store().await;
        let org_id = "test_org_no_template";

        // Clean up any leftover state
        let _ = db::alerts::destinations::delete(org_id, "test_no_template").await;
        let _ = db::alerts::destinations::delete(org_id, "test_empty_template").await;

        let dest = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "test_no_template".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://8.8.8.8/webhook".to_string(),
                    method: HTTPType::POST,
                    ..Default::default()
                }),
            },
        };

        let result = save("test_no_template", dest, true).await;
        assert!(
            result.is_ok(),
            "Should save when template is None: {result:?}"
        );
        let saved = result.unwrap();
        if let Module::Alert { template, .. } = &saved.module {
            assert!(
                template.is_none(),
                "template stays None — no auto-association without an explicit prebuilt_* reference, got {template:?}"
            );
        } else {
            panic!("expected Module::Alert");
        }

        let dest_empty = Destination {
            id: None,
            org_id: org_id.to_string(),
            name: "test_empty_template".to_string(),
            module: Module::Alert {
                template: Some("".to_string()),
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://8.8.8.8/webhook".to_string(),
                    method: HTTPType::POST,
                    ..Default::default()
                }),
            },
        };

        let result_empty = save("test_empty_template", dest_empty, true).await;
        assert!(
            result_empty.is_ok(),
            "Should save when template is an empty string: {result_empty:?}"
        );

        // Clean up
        let _ = db::alerts::destinations::delete(org_id, "test_no_template").await;
        let _ = db::alerts::destinations::delete(org_id, "test_empty_template").await;
    }

    fn sns_destination(org_id: &str, name: &str, template: Option<&str>) -> Destination {
        Destination {
            id: None,
            org_id: org_id.to_string(),
            name: name.to_string(),
            module: Module::Alert {
                template: template.map(str::to_string),
                destination_type: DestinationType::Sns(config::meta::destinations::AwsSns {
                    sns_topic_arn: "arn:aws:sns:us-east-1:000000000000:t".to_string(),
                    aws_region: "us-east-1".to_string(),
                }),
            },
        }
    }

    /// An unknown name is refused; a name only the default org holds still saves.
    #[tokio::test]
    async fn test_save_refuses_an_unknown_template_and_keeps_the_default_org_fallback() {
        meta_store().await;
        let org_id = "test_org_unknown_template";
        let shared = "b22_shared_template";
        let _ = db::alerts::destinations::delete(org_id, "b22_typo").await;
        let _ = db::alerts::destinations::delete(org_id, "b22_shared").await;

        let err = save(
            "b22_typo",
            sns_destination(org_id, "", Some("no_such_t")),
            true,
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, DestinationError::UnknownTemplate(ref n) if n == "no_such_t"),
            "{err:?}"
        );
        assert_eq!(err.to_string(), "template 'no_such_t' does not exist");

        infra::table::templates::put(Template {
            org_id: config::DEFAULT_ORG.to_string(),
            name: shared.to_string(),
            body: "{}".to_string(),
            template_type: config::meta::destinations::TemplateType::Http,
            ..Default::default()
        })
        .await
        .expect("default org template");
        let saved = save(
            "b22_shared",
            sns_destination(org_id, "", Some(shared)),
            true,
        )
        .await
        .expect("default org fallback saves");
        assert!(
            matches!(&saved.module, Module::Alert { template: Some(t), .. } if t == shared),
            "{saved:?}"
        );
        // Read the row back: the write stored the default org template's id, not null.
        let stored = infra::table::destinations::get(org_id, "b22_shared")
            .await
            .expect("read back")
            .expect("row");
        assert!(
            matches!(&stored.module, Module::Alert { template: Some(t), .. } if t == shared),
            "{stored:?}"
        );

        let _ = db::alerts::destinations::delete(org_id, "b22_shared").await;
        let _ = infra::table::templates::delete(config::DEFAULT_ORG, shared).await;
    }

    #[tokio::test]
    async fn dependencies_read_every_variable_in_two_statements() {
        use config::ider::ksuid;
        use infra::table::org_secret_values;
        use sea_orm::Set;

        if std::env::var_os("ZO_META_STORE").is_none() {
            return;
        }
        meta_store().await;
        let db = get_orm_client_rw().await;
        let org = format!("pf4_{}", ksuid());
        let names: BTreeSet<String> = ["A", "B", "C", "D"].map(String::from).into();
        for name in &names {
            let row = org_secrets::insert_in(
                db,
                org_secrets::ActiveModel {
                    org_id: Set(org.clone()),
                    id: Set(ksuid()),
                    name: Set(name.clone()),
                    kind: Set("variable".into()),
                    description: Set(String::new()),
                    state: Set("active".into()),
                    policy_rev: Set(ksuid()),
                    policy_version: Set(1),
                    created_by: Set("owner".into()),
                    updated_by: Set("owner".into()),
                    created_at: Set(1),
                    updated_at: Set(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            org_secret_values::insert_in(
                db,
                org_secret_values::ActiveModel {
                    org_id: Set(org.clone()),
                    id: Set(ksuid()),
                    secret_id: Set(row.id),
                    env_id: Set(ORG_ENV_ID.into()),
                    env_incarnation: Set(String::new()),
                    state: Set("set".into()),
                    value_ref: Set(Some(ksuid())),
                    backend_id: Set(None),
                    value_rev: Set(ksuid()),
                    value_version: Set(1),
                    updated_by: Set("owner".into()),
                },
            )
            .await
            .unwrap();
        }
        let mut observed = match db {
            sea_orm::DatabaseConnection::SqlxPostgresPoolConnection(pool) => {
                sea_orm::DatabaseConnection::SqlxPostgresPoolConnection(pool.clone())
            }
            sea_orm::DatabaseConnection::SqlxSqlitePoolConnection(pool) => {
                sea_orm::DatabaseConnection::SqlxSqlitePoolConnection(pool.clone())
            }
            _ => panic!("expected a meta-store pool"),
        };
        let reads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = reads.clone();
        observed.set_metric_callback(move |_| {
            count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        });
        let deps = dependencies(&observed, &org, &names).await.unwrap();
        assert_eq!(deps.names.len(), 4);
        assert!(
            deps.entries
                .iter()
                .all(|entry| matches!(entry, DepEntry::Store { .. }))
        );
        assert_eq!(reads.load(std::sync::atomic::Ordering::Relaxed), 2);
    }

    /// A create over the 256-character column refuses with a 400 error, not the raw DB error.
    #[tokio::test]
    async fn test_save_refuses_a_name_over_256_chars_on_create() {
        meta_store().await;
        let org_id = "test_org_long_name";
        let over = "é".repeat(257);
        let err = save(&over, sns_destination(org_id, "", None), true)
            .await
            .unwrap_err();
        assert!(matches!(err, DestinationError::NameTooLong(256)), "{err:?}");

        // 256 multi-byte characters still fit the varchar(256) column.
        let fits = "é".repeat(256);
        let _ = db::alerts::destinations::delete(org_id, &fits).await;
        save(&fits, sns_destination(org_id, "", None), true)
            .await
            .expect("256 characters save");
        let _ = db::alerts::destinations::delete(org_id, &fits).await;
    }

    /// A delete blocked by three kinds names all three, not just the one `first_use` stopped at.
    #[tokio::test]
    #[ignore] // requires the local sqlite/coordinator infra to be initialized
    async fn test_delete_names_every_blocker_not_just_the_first() {
        use config::meta::{
            alerts::alert::Alert,
            folder::{Folder, FolderType},
            synthetics::{Synthetic, SyntheticType},
        };

        let org_id = "test_org_delete_multi";
        let name = "du-dest-delete-multi";
        let folder = Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Default::default()
        };
        infra::table::folders::get_or_create(org_id, folder, FolderType::Alerts)
            .await
            .unwrap();

        let alert_conn = infra::db::get_orm_client_rw().await;
        let alert: Alert = serde_json::from_value(serde_json::json!({
            "name": "du-multi-alert",
            "destinations": [name],
        }))
        .unwrap();
        infra::table::alerts::create(alert_conn, org_id, "default", alert, false)
            .await
            .unwrap();

        let check_conn = infra::db::get_orm_client_rw().await;
        let check = Synthetic {
            name: "du-multi-check".to_string(),
            check_type: SyntheticType::Http,
            target: "https://example.com".to_string(),
            destinations: vec![name.to_string()],
            ..Default::default()
        };
        infra::table::synthetics_checks::create(check_conn, org_id, check, false)
            .await
            .unwrap();

        let team_id = "du-multi-team";
        let policy = infra::table::oncall_policies::get_or_create(org_id, team_id)
            .await
            .unwrap();
        infra::table::oncall_policies::update_rungs(
            org_id,
            team_id,
            &policy.rungs,
            Some(&[name.to_string()]),
            None,
        )
        .await
        .unwrap();

        let err = delete(org_id, name).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("alert"), "should name the alert: {msg}");
        assert!(
            msg.contains("synthetic check"),
            "should name the synthetic check: {msg}"
        );
        assert!(
            msg.contains("escalation policy"),
            "should name the escalation policy: {msg}"
        );
    }

    /// Pure regression for D1, no DB: `usage_message` itself must name every kind it is given.
    #[test]
    fn test_usage_message_names_every_consumer_kind_it_is_given() {
        use crate::alerts::destination_usage::{
            DestinationConsumer, DestinationUse, usage_message,
        };

        let uses = vec![
            DestinationUse {
                consumer: DestinationConsumer::Alert,
                id: "a1".to_string(),
                name: "cpu-hot".to_string(),
                folder_id: Some("default".to_string()),
                destination_name: "dest-shared".to_string(),
            },
            DestinationUse {
                consumer: DestinationConsumer::CompositeAlert,
                id: "c1".to_string(),
                name: "disk-full".to_string(),
                folder_id: Some("default".to_string()),
                destination_name: "dest-shared".to_string(),
            },
            DestinationUse {
                consumer: DestinationConsumer::Pipeline,
                id: "p1".to_string(),
                name: "ingest-pipe".to_string(),
                folder_id: None,
                destination_name: "dest-shared".to_string(),
            },
        ];

        let msg = usage_message("dest-shared", &uses);
        assert!(msg.contains("cpu-hot"), "should name the alert: {msg}");
        assert!(
            msg.contains("disk-full"),
            "should name the composite alert: {msg}"
        );
        assert!(
            msg.contains("ingest-pipe"),
            "should name the pipeline: {msg}"
        );
    }
}
