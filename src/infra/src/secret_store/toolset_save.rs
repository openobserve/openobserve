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

//! The toolset save: slot rules, write-only keeps, strict checks and the U42 bind transaction.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

use config::{
    meta::secret_store::{
        BindRequest, Decision, SecretErrorCode, SecretStoreAuthz,
        digest::{BoundRef, KAuth},
        grammar::RefKind,
    },
    utils::encryption::Algorithm,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ConnectionTrait, DatabaseTransaction, EntityTrait, Set,
    SqlErr, TransactionTrait,
};
use serde_json::{Value, json};

use super::{
    bind::{self, BindError, BindPlan, Preflight, SecretBindOption, StrictVerb},
    reauthorize::k_auth_for,
    toolset::{self, CONSUMER, automation_allowed},
};
use crate::{
    db::get_orm_client_rw,
    errors::{DbError, Error},
    table::{
        cipher, entity::org_ai_toolsets as rows, org_ai_toolsets::OrgToolset,
        org_secret_values::ORG_ENV, org_secrets, secret_aliases, secret_dependencies, secret_refs,
    },
};

/// The saver; `role` is the strict role, `root` for a root user.
pub struct Actor<'a> {
    pub user_id: &'a str,
    pub role: &'a str,
    pub authz: &'a dyn SecretStoreAuthz,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub code: SecretErrorCode,
    pub secret: Option<String>,
    pub suggested_hosts: Vec<String>,
}

impl Refusal {
    fn named(code: SecretErrorCode, secret: &str) -> Self {
        Self {
            code,
            secret: Some(secret.to_owned()),
            suggested_hosts: Vec::new(),
        }
    }

    pub fn status(&self) -> u16 {
        match self.code {
            SecretErrorCode::SecretConflict => 409,
            code => code.http_status().unwrap_or(503),
        }
    }

    pub fn body(&self) -> Value {
        use SecretErrorCode::*;
        let message = match self.code {
            SecretUseDenied => "You do not have permission to use this secret in the toolset.",
            SecretNotFound => "The secret does not exist.",
            SecretManageRequiredForToolset => {
                "A toolset hands the value to an agent, so it needs manage on every secret."
            }
            SecretAccessRequired => {
                "Changing this secret binding requires access-management permission."
            }
            RefNotAllowedInField => {
                "Secrets can't be used here: the agent could print them. Use an MCP header."
            }
            SlotValueRequired => "Enter a value for every credential that has no saved value.",
            PermissionsUnavailable => "The permission service is unavailable.",
            PolicyChanged => "The toolset or secret policy changed. Retry the save.",
            StoreGateClosed | StoreDisabled => "The secret store is not accepting bindings.",
            _ => "The toolset's secret binding could not be saved.",
        };
        let mut body = json!({"code": self.code, "message": message});
        if let Some(name) = &self.secret {
            body["secret"] = json!(name);
        }
        if self.code == SecretPinRequired {
            body["suggested_hosts"] = json!(self.suggested_hosts);
        }
        body
    }
}

impl From<SecretErrorCode> for Refusal {
    fn from(code: SecretErrorCode) -> Self {
        Self {
            code,
            secret: None,
            suggested_hosts: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub enum SaveError {
    Refused(Refusal),
    NameTaken,
    Infra(Error),
}

impl From<Error> for SaveError {
    fn from(error: Error) -> Self {
        match error {
            Error::SecretStore(code) => Self::Refused(code.into()),
            Error::DbError(DbError::UniqueViolation) => Self::NameTaken,
            other => Self::Infra(other),
        }
    }
}

/// `toolset` carries the new plaintext row with its final id and keeps already merged.
pub struct SaveRequest {
    pub toolset: OrgToolset,
    pub previous: Option<OrgToolset>,
    pub binds: Vec<SecretBindOption>,
}

struct Prepared {
    plan: BindPlan,
    names: BTreeMap<String, String>,
    extra: BTreeSet<(String, StrictVerb)>,
}

struct BindSave<'a> {
    actor: &'a Actor<'a>,
    request: &'a SaveRequest,
    refusal: OnceLock<Refusal>,
    key: tokio::sync::OnceCell<KAuth>,
}

impl BindSave<'_> {
    fn record(&self, refusal: Refusal) -> BindError {
        let code = refusal.code;
        self.refusal.get_or_init(|| refusal);
        BindError::Code(code)
    }

    fn refusal(&self, error: BindError, names: &BTreeMap<String, String>) -> BindError {
        let name = |id: &str| names.get(id).cloned().unwrap_or_else(|| id.to_owned());
        match error {
            BindError::PinRequired {
                secret_id,
                suggested_hosts,
            } => self.record(Refusal {
                code: SecretErrorCode::SecretPinRequired,
                secret: Some(name(&secret_id)),
                suggested_hosts,
            }),
            BindError::ConsumerNotAllowed { secret_id, .. } => self.record(Refusal::named(
                SecretErrorCode::ConsumerNotAllowed,
                &name(&secret_id),
            )),
            other => other,
        }
    }

    async fn prepare<C: ConnectionTrait>(&self, conn: &C) -> Result<Prepared, BindError> {
        prepare(conn, self.actor, self.request)
            .await
            .map_err(|e| match e {
                SaveError::Refused(r) => self.record(r),
                SaveError::NameTaken => BindError::Code(SecretErrorCode::SecretNameTaken),
                SaveError::Infra(e) => BindError::Infra(e),
            })
    }

    async fn preflight(&self) -> Result<Preflight, BindError> {
        let db = get_orm_client_rw().await;
        let prepared = self.prepare(db).await?;
        let key = self
            .key
            .get_or_try_init(|| k_auth_for(&self.request.toolset.org))
            .await?;
        let mut checked = bind::preflight_in(db, &prepared.plan, key)
            .await
            .map_err(|e| self.refusal(e, &prepared.names))?;
        checked.checks.extend(prepared.extra.iter().cloned());
        strict_checks(
            self.actor,
            &self.request.toolset.org,
            &checked,
            &prepared.names,
        )
        .await
        .map_err(|r| self.record(r))?;
        Ok(checked)
    }

    async fn write_in(
        &self,
        txn: &DatabaseTransaction,
        checked: &Preflight,
        key: &KAuth,
    ) -> Result<Option<BindRequest>, BindError> {
        lock_unchanged(txn, self.request).await?;
        let prepared = self.prepare(txn).await?;
        if !prepared.extra.is_subset(&checked.checks) {
            return Err(BindError::Retry);
        }
        let mut row = self.request.toolset.clone();
        row.data = Some(prepared.plan.image.stored["data"].to_string());
        write_row_in(txn, &row, self.request.previous.is_none())
            .await
            .map_err(|e| match SaveError::from(e) {
                SaveError::NameTaken => BindError::Code(SecretErrorCode::SecretNameTaken),
                SaveError::Refused(r) => self.record(r),
                SaveError::Infra(e) => BindError::Infra(e),
            })?;
        let request = bind::bind_in(txn, &prepared.plan, checked, key)
            .await
            .map_err(|e| self.refusal(e, &prepared.names))?;
        // The policy locks now cover every bound name; a rename since preparation must re-run.
        for bound in &prepared.plan.refs {
            if !org_secrets::get_secret_in(txn, &prepared.plan.org_id, &bound.secret_id)
                .await?
                .is_some_and(|row| row.name == bound.token_name)
            {
                return Err(BindError::Retry);
            }
        }
        Ok(request)
    }

    async fn attempt(&self, checked: Preflight) -> Result<Option<BindRequest>, BindError> {
        let txn = get_orm_client_rw()
            .await
            .begin()
            .await
            .map_err(Error::from)?;
        let key = self.key.get().ok_or(SecretErrorCode::SecretUnavailable)?;
        match self.write_in(&txn, &checked, key).await {
            Ok(request) => {
                txn.commit().await.map_err(Error::from)?;
                Ok(request)
            }
            Err(e) => {
                txn.rollback().await.map_err(Error::from)?;
                Err(e)
            }
        }
    }
}

/// Saves the toolset row and, when it holds or held store refs, its binding in one transaction.
pub async fn save(
    actor: &Actor<'_>,
    request: &SaveRequest,
) -> Result<Option<BindRequest>, SaveError> {
    let data = toolset::parse_data(&request.toolset).map_err(Error::SecretStore)?;
    let slots = toolset::slots(&request.toolset.kind, &data).map_err(Error::SecretStore)?;
    // A first DEK is written on its own connection, which a SQLite write transaction would block.
    cipher::get_dek(&request.toolset.org).await?;
    let has_refs = slots.iter().any(|s| !s.tokens.is_empty());
    let had_refs = match &request.previous {
        Some(old) => !secret_refs::list_for_consumer_in(
            get_orm_client_rw().await,
            &old.org,
            CONSUMER.as_str(),
            &old.id,
        )
        .await?
        .is_empty(),
        None => false,
    };
    if !has_refs && !had_refs {
        if let Some(option) = request.binds.first() {
            return Err(SaveError::Refused(Refusal::named(
                SecretErrorCode::SecretUseDenied,
                &option.secret_id,
            )));
        }
        let txn = get_orm_client_rw()
            .await
            .begin()
            .await
            .map_err(Error::from)?;
        lock_unchanged(&txn, request).await.map_err(|e| match e {
            BindError::Infra(e) => SaveError::Infra(e),
            other => SaveError::Refused(other.code().into()),
        })?;
        write_row_in(&txn, &request.toolset, request.previous.is_none()).await?;
        txn.commit().await.map_err(Error::from)?;
        return Ok(None);
    }
    let save = BindSave {
        actor,
        request,
        refusal: OnceLock::new(),
        key: tokio::sync::OnceCell::new(),
    };
    match bind::bind_with_retry(|| save.preflight(), |checked| save.attempt(checked)).await {
        Ok(request) => Ok(request),
        Err(BindError::Infra(e)) => Err(SaveError::Infra(e)),
        Err(BindError::Code(SecretErrorCode::SecretNameTaken)) => Err(SaveError::NameTaken),
        Err(e) => Err(SaveError::Refused(
            save.refusal
                .get()
                .cloned()
                .unwrap_or_else(|| e.code().into()),
        )),
    }
}

/// The response shape: CLI write-only markers, MCP header refs shown, literals as the ENT
/// redaction.
pub fn response_data(kind: &str, raw: &Value, redacted: Value, updated_at: i64, by: &str) -> Value {
    let mut shown = redacted;
    if kind == "cli" {
        shown = raw.clone();
        toolset::redact_write_only(kind, &mut shown, updated_at, by);
    }
    if kind == "mcp"
        && let (Some(Value::Object(raw_headers)), Some(Value::Object(headers))) =
            (raw.get("headers"), shown.get_mut("headers"))
    {
        for (name, value) in raw_headers {
            if value
                .as_str()
                .is_some_and(config::meta::secret_store::grammar::has_secret_ref)
            {
                headers.insert(name.clone(), value.clone());
            }
        }
    }
    shown
}

async fn prepare<C: ConnectionTrait>(
    conn: &C,
    actor: &Actor<'_>,
    request: &SaveRequest,
) -> Result<Prepared, SaveError> {
    let toolset = &request.toolset;
    let org = &toolset.org;
    let mut data = toolset::parse_data(toolset).map_err(Error::SecretStore)?;
    let slots = toolset::slots(&toolset.kind, &data).map_err(Error::SecretStore)?;
    let old_refs = match &request.previous {
        Some(_) => {
            secret_refs::list_for_consumer_in(conn, org, CONSUMER.as_str(), &toolset.id).await?
        }
        None => Vec::new(),
    };
    let old_data = request
        .previous
        .as_ref()
        .and_then(|p| toolset::parse_data(p).ok());
    let mut refs = BTreeMap::new();
    let mut names = BTreeMap::new();
    let mut changed_secret_ids = BTreeSet::new();
    let mut extra = BTreeSet::new();
    for slot in &slots {
        let data_pointer = slot.pointer.trim_start_matches("/data");
        let changed =
            old_data.as_ref().and_then(|d| d.pointer(data_pointer)) != data.pointer(data_pointer);
        let Some(Value::String(text)) = data.pointer_mut(data_pointer) else {
            return Err(Error::SecretStore(SecretErrorCode::SecretUnavailable).into());
        };
        for token in slot
            .tokens
            .iter()
            .rev()
            .filter(|t| t.kind == RefKind::Secret)
        {
            let bound = old_refs
                .iter()
                .find(|r| r.field == slot.pointer && r.token_name == token.name);
            let row = match bound {
                Some(old) => org_secrets::get_secret_in(conn, org, &old.secret_id).await?,
                None => resolve_name(conn, org, &token.name).await?,
            }
            .filter(|row| row.state == "active")
            .ok_or_else(|| {
                SaveError::Refused(Refusal::named(
                    bind::missing_secret_code(actor.role),
                    &token.name,
                ))
            })?;
            names
                .entry(row.id.clone())
                .or_insert_with(|| token.name.clone());
            if changed {
                extra.insert((row.id.clone(), StrictVerb::Use));
                extra.insert((row.id.clone(), StrictVerb::Manage));
            }
            if !old_refs
                .iter()
                .any(|old| old.field == slot.pointer && old.secret_id == row.id)
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
                (slot.pointer.clone(), row.id.clone()),
                BoundRef {
                    field: slot.pointer.clone(),
                    token_name: row.name,
                    secret_id: row.id,
                },
            );
        }
    }
    for option in &request.binds {
        if !names.contains_key(&option.secret_id) {
            return Err(SaveError::Refused(Refusal::named(
                SecretErrorCode::SecretUseDenied,
                &option.secret_id,
            )));
        }
    }
    if automation_allowed(&data) && !old_data.as_ref().is_some_and(automation_allowed) {
        let ids = refs
            .values()
            .map(|r: &BoundRef| r.secret_id.clone())
            .collect();
        extra.extend(toolset::automation_checks(&ids));
    }
    let (dep_keys, dep_names) = dependency_keys(conn, org, &slots, actor.role).await?;
    let dep_secret_ids = dep_names.keys().cloned().collect();
    for (id, name) in dep_names {
        names.entry(id).or_insert(name);
    }
    let entries = toolset::dependencies_in(conn, org, &data, &toolset.kind).await?;
    let url = |d: &Value| d.get("url").and_then(Value::as_str).map(str::to_owned);
    let origin =
        |u: Option<String>| u.and_then(|u| reqwest::Url::parse(&u).ok().map(|u| u.origin()));
    let host_changed = origin(old_data.as_ref().and_then(url)) != origin(url(&data));
    let image = toolset::image(
        toolset,
        &data,
        BTreeMap::from([(ORG_ENV.to_owned(), entries)]),
    )
    .map_err(Error::SecretStore)?;
    Ok(Prepared {
        plan: BindPlan {
            org_id: org.clone(),
            consumer_type: CONSUMER,
            consumer_id: toolset.id.clone(),
            saved_by: actor.user_id.to_owned(),
            image,
            refs: refs.into_values().collect(),
            changed_secret_ids,
            host_changed,
            request_urls: url(&data).into_iter().collect(),
            dep_keys,
            dep_secret_ids,
            binds: request.binds.clone(),
        },
        names,
        extra,
    })
}

async fn resolve_name<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    name: &str,
) -> Result<Option<org_secrets::Model>, Error> {
    if let Some(row) = org_secrets::get_live_by_name_in(conn, org, name).await? {
        return Ok(Some(row));
    }
    let now = config::utils::time::now_micros();
    match secret_aliases::get_alias_in(conn, org, name, now).await? {
        Some(alias) => org_secrets::get_secret_in(conn, org, &alias.secret_id).await,
        None => Ok(None),
    }
}

async fn dependency_keys<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    slots: &[toolset::CredentialSlot],
    role: &str,
) -> Result<(Vec<String>, BTreeMap<String, String>), SaveError> {
    let names: BTreeSet<_> = slots
        .iter()
        .flat_map(|s| &s.tokens)
        .filter(|t| t.kind == RefKind::Var)
        .map(|t| t.name.clone())
        .collect();
    let mut keys = BTreeSet::new();
    let mut resolved_names = BTreeMap::new();
    for name in names {
        match resolve_name(conn, org, &name)
            .await?
            .filter(|r| r.state == "active")
        {
            Some(row) => {
                keys.insert(secret_dependencies::var_dep_key(&row.id));
                resolved_names.insert(row.id, name);
            }
            None => {
                return Err(SaveError::Refused(Refusal::named(
                    bind::missing_secret_code(role),
                    &name,
                )));
            }
        }
    }
    Ok((keys.into_iter().collect(), resolved_names))
}

async fn strict_checks(
    actor: &Actor<'_>,
    org: &str,
    checked: &Preflight,
    names: &BTreeMap<String, String>,
) -> Result<(), Refusal> {
    for (id, verb) in &checked.checks {
        let (object, method) = match verb {
            StrictVerb::Use => (format!("secrets:{id}"), "GET"),
            StrictVerb::Manage => (format!("secrets:{id}"), "PUT"),
            StrictVerb::AccessPut => (format!("secret_access:{id}"), "PUT"),
        };
        let decision = actor
            .authz
            .check_strict(org, actor.user_id, actor.role, &object, method)
            .await
            .map_err(Refusal::from)?;
        if decision == Decision::Deny {
            let name = names.get(id).map_or(id.as_str(), String::as_str);
            return Err(Refusal::named(toolset::denied_code(*verb), name));
        }
    }
    Ok(())
}

/// A concurrent edit since the caller read `previous` re-runs the save.
async fn lock_unchanged(txn: &DatabaseTransaction, request: &SaveRequest) -> Result<(), BindError> {
    let current = toolset::lock_row(txn, &request.toolset.org, &request.toolset.id).await?;
    match (&request.previous, current) {
        (None, None) => Ok(()),
        (Some(old), Some(row)) if row.updated_at == old.updated_at => Ok(()),
        _ => Err(BindError::Retry),
    }
}

async fn write_row_in(
    txn: &DatabaseTransaction,
    row: &OrgToolset,
    insert: bool,
) -> Result<(), Error> {
    let data = match &row.data {
        Some(plain) => {
            let dek = cipher::get_dek(&row.org).await?;
            Some(
                Algorithm::Aes256Siv
                    .encrypt(&dek, plain)
                    .map_err(|e| Error::Message(e.to_string()))?,
            )
        }
        None => None,
    };
    let model = rows::ActiveModel {
        id: Set(row.id.clone()),
        org: Set(row.org.clone()),
        name: Set(row.name.clone()),
        kind: Set(row.kind.clone()),
        description: Set(row.description.clone()),
        data: Set(data),
        created_by: Set(row.created_by.clone()),
        created_at: Set(row.created_at),
        updated_at: Set(row.updated_at),
        // An update leaves the switch and health to their own writers.
        enabled: if insert { Set(row.enabled) } else { NotSet },
        ..Default::default()
    };
    let result = if insert {
        rows::Entity::insert(model).exec(txn).await.map(|_| ())
    } else {
        model.update(txn).await.map(|_| ())
    };
    match result {
        Err(e) if matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_))) => {
            Err(Error::DbError(DbError::UniqueViolation))
        }
        other => Ok(other?),
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeSet, process::Command};

    use async_trait::async_trait;
    use config::{
        ider::ksuid,
        meta::secret_store::{Decision, GateState, SecretErrorCode, SecretStoreAuthz},
    };
    use sea_orm::{IntoActiveModel, Set};
    use serde_json::{Value, json};

    use super::*;
    use crate::{
        secret_store::gate::{self, GateView},
        table::{
            org_ai_toolsets, org_secret_consumers, org_secret_values,
            org_secrets::PinMode,
            secret_consumer_auth as auth,
            testing::{meta_store, unique},
        },
    };

    struct Grants(BTreeSet<(String, String)>);

    impl Grants {
        fn of(id: &str, verbs: &[&str]) -> Self {
            Self(
                verbs
                    .iter()
                    .map(|v| (format!("secrets:{id}"), (*v).to_owned()))
                    .chain([(format!("secret_access:{id}"), "PUT".to_owned())])
                    .collect(),
            )
        }
    }

    #[async_trait]
    impl SecretStoreAuthz for Grants {
        async fn check_strict(
            &self,
            _: &str,
            _: &str,
            _: &str,
            object: &str,
            verb: &str,
        ) -> Result<Decision, SecretErrorCode> {
            Ok(if self.0.contains(&(object.to_owned(), verb.to_owned())) {
                Decision::Allow
            } else {
                Decision::Deny
            })
        }

        async fn list_objects(
            &self,
            _: &str,
            _: &str,
            _: &str,
            _: &str,
            _: &str,
        ) -> Result<Vec<String>, SecretErrorCode> {
            Ok(vec![])
        }
    }

    fn row(org: &str, id: &str, name: &str, kind: &str, data: Value) -> OrgToolset {
        OrgToolset {
            id: id.into(),
            org: org.into(),
            name: name.into(),
            kind: kind.into(),
            description: None,
            data: Some(data.to_string()),
            created_by: "u@acme.test".into(),
            created_at: 1,
            updated_at: config::utils::time::now_micros(),
            enabled: true,
            status_state: None,
            status_since: None,
            last_error: None,
            last_used_at: None,
        }
    }

    async fn ready_secret(org: &str, name: &str) -> String {
        let conn = get_orm_client_rw().await;
        let id = ksuid();
        org_secrets::insert_in(
            conn,
            org_secrets::ActiveModel {
                org_id: Set(org.into()),
                id: Set(id.clone()),
                name: Set(name.into()),
                kind: Set("secret".into()),
                pin_mode: Set(PinMode::Hosts),
                state: Set("active".into()),
                allowed_hosts: Set("https://mcp.example.com:443".into()),
                description: Set(String::new()),
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
        org_secret_consumers::add_in(
            conn,
            org_secret_consumers::ActiveModel {
                org_id: Set(org.into()),
                secret_id: Set(id.clone()),
                consumer_type: Set(CONSUMER.as_str().into()),
                consumer_id: Set(org_secret_consumers::ANY_CONSUMER.into()),
                added_by: Set("owner".into()),
                added_at: Set(1),
            },
        )
        .await
        .unwrap();
        let mut value = <org_secret_values::ActiveModel as sea_orm::ActiveModelBehavior>::new();
        value.org_id = Set(org.into());
        value.id = Set(ksuid());
        value.secret_id = Set(id.clone());
        value.env_id = Set(ORG_ENV.into());
        value.env_incarnation = Set(String::new());
        value.state = Set("set".into());
        value.value_ref = Set(Some(ksuid()));
        value.value_rev = Set(ksuid());
        value.value_version = Set(1);
        value.updated_by = Set("owner".into());
        org_secret_values::insert_in(conn, value).await.unwrap();
        id
    }

    async fn run(grants: &Grants, request: &SaveRequest) -> Result<Option<BindRequest>, SaveError> {
        let actor = Actor {
            user_id: "u@acme.test",
            role: "editor",
            authz: grants,
        };
        save(&actor, request).await
    }

    fn refused(result: Result<Option<BindRequest>, SaveError>) -> SecretErrorCode {
        match result {
            Err(SaveError::Refused(r)) => r.code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    fn mcp(automation: bool) -> Value {
        json!({
            "url": "https://mcp.example.com/mcp",
            "headers": {"Authorization": "Bearer {{secrets.GH}}"},
            "automation_allowed": automation,
        })
    }

    #[tokio::test]
    async fn missing_toolset_secret_is_hidden_only_from_non_admins() {
        for (role, code) in [
            ("root", SecretErrorCode::SecretNotFound),
            ("admin", SecretErrorCode::SecretNotFound),
            ("editor", SecretErrorCode::SecretUseDenied),
        ] {
            let conn = sea_orm::MockDatabase::new(sea_orm::DatabaseBackend::Sqlite)
                .append_query_results([Vec::<org_secrets::Model>::new()])
                .append_query_results([Vec::<secret_aliases::Model>::new()])
                .into_connection();
            let request = SaveRequest {
                toolset: row("org", "toolset", "toolset", "mcp", mcp(false)),
                previous: None,
                binds: vec![],
            };
            let grants = Grants(BTreeSet::new());
            let actor = Actor {
                user_id: "user",
                role,
                authz: &grants,
            };
            match prepare(&conn, &actor, &request).await {
                Err(SaveError::Refused(refusal)) => assert_eq!(refusal.code, code),
                _ => panic!("expected missing-secret refusal"),
            }
        }
    }

    #[test]
    fn response_shows_header_refs_and_cli_markers_only() {
        let raw = json!({"url": "u", "headers": {"A": "Bearer {{secrets.GH}}", "B": "literal"}});
        let redacted = json!({"url": "u", "headers": {"A": "[REDACTED]", "B": "[REDACTED]"}});
        let shown = response_data("mcp", &raw, redacted, 1, "u");
        assert_eq!(shown["headers"]["A"], "Bearer {{secrets.GH}}");
        assert_eq!(shown["headers"]["B"], "[REDACTED]");
        let cli = json!({"command": "gh", "env": {"T": "v"}});
        let shown = response_data("cli", &cli, json!({}), 7, "alice");
        assert_eq!(
            shown["env"]["T"],
            json!({"set": true, "updated_at": 7, "updated_by": "alice"})
        );
        assert_eq!(shown["command"], "gh");
    }

    #[test]
    fn refusal_bodies_name_the_secret_and_keep_the_code_status() {
        let r = Refusal::named(SecretErrorCode::SecretManageRequiredForToolset, "GH");
        assert_eq!(r.status(), 403);
        assert_eq!(r.body()["code"], "secret_manage_required_for_toolset");
        assert_eq!(r.body()["secret"], "GH");
        assert_eq!(
            Refusal::from(SecretErrorCode::RefNotAllowedInField).status(),
            400
        );
    }

    #[tokio::test]
    async fn editor_without_use_cannot_bind_a_variable() {
        if !meta_store().await {
            return;
        }
        const CHILD: &str = "O2_VARIABLE_USE_TEST";
        if std::env::var_os(CHILD).is_none() {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "secret_store::toolset_save::tests::editor_without_use_cannot_bind_a_variable",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .env("O2_SECRET_STORE_REFS_ENABLED", "true")
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
        gate::force_state_for_tests(Some(GateView {
            state: GateState::Latched,
            suspended: false,
        }));
        let org = unique("variable_use");
        let variable = ready_secret(&org, "REGION").await;
        let conn = get_orm_client_rw().await;
        let mut policy = org_secrets::get_secret_in(conn, &org, &variable)
            .await
            .unwrap()
            .unwrap()
            .into_active_model();
        policy.kind = Set("variable".into());
        policy.pin_mode = Set(PinMode::None);
        org_secrets::update_in(conn, &org, policy).await.unwrap();
        let id = ksuid();
        let request = SaveRequest {
            toolset: row(
                &org,
                &id,
                "service",
                "mcp",
                json!({"url":"https://mcp.example.com/mcp", "headers":{"Region":"{{vars.REGION}}"}}),
            ),
            previous: None,
            binds: vec![],
        };
        assert_eq!(
            refused(run(&Grants::of(&variable, &["PUT"]), &request).await),
            SecretErrorCode::SecretUseDenied
        );
        assert!(org_ai_toolsets::get(&org, &id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn toolset_saves() {
        if !meta_store().await {
            return;
        }
        const CASE: &str = "secret_store::toolset_save::tests::toolset_saves";
        const CHILD: &str = "O2_TOOLSET_SAVE_TEST";
        // The cipher key installs once and the gate override affects every test in the process.
        if std::env::var_os(CHILD).is_none() {
            let output = Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CASE, "--nocapture"])
                .env(CHILD, "1")
                .env("O2_SECRET_STORE_REFS_ENABLED", "true")
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
        gate::force_state_for_tests(Some(GateView {
            state: GateState::Latched,
            suspended: false,
        }));
        v40_n2_cli_refs_refused_at_save().await;
        v37_manage_regate_and_automation_flag().await;
        unknown_secret_and_plain_toolsets().await;
        variable_dependency_names_are_hidden_on_toolset_save().await;
    }

    async fn variable_dependency_names_are_hidden_on_toolset_save() {
        for (role, code) in [
            ("root", SecretErrorCode::SecretNotFound),
            ("admin", SecretErrorCode::SecretNotFound),
            ("editor", SecretErrorCode::SecretUseDenied),
        ] {
            let org = unique("tsave_var_visibility");
            let id = ksuid();
            let request = SaveRequest {
                toolset: row(
                    &org,
                    &id,
                    "service",
                    "mcp",
                    json!({"url":"https://mcp.example.com/mcp", "headers":{"Region":"{{vars.REGION}}"}}),
                ),
                previous: None,
                binds: vec![],
            };
            let grants = Grants(BTreeSet::new());
            let actor = Actor {
                user_id: "editor@example.org",
                role,
                authz: &grants,
            };
            let Err(SaveError::Refused(absent)) = save(&actor, &request).await else {
                panic!("expected missing dependency refusal")
            };
            assert_eq!(absent.code, code);
            assert_eq!(absent.secret.as_deref(), Some("REGION"));
            if role == "editor" {
                ready_secret(&org, "REGION").await;
                let Err(SaveError::Refused(denied)) = save(&actor, &request).await else {
                    panic!("expected dependency Use refusal")
                };
                assert_eq!(absent.body(), denied.body());
            }
            assert!(org_ai_toolsets::get(&org, &id).await.unwrap().is_none());
        }
    }

    async fn v40_n2_cli_refs_refused_at_save() {
        let org = unique("tsave_cli");
        let id = ksuid();
        let cli = row(
            &org,
            &id,
            "gh",
            "cli",
            json!({"command": "gh", "env": {"T": "{{secrets.GH}}"}}),
        );
        let request = SaveRequest {
            toolset: cli,
            previous: None,
            binds: vec![],
        };
        let all = Grants(BTreeSet::new());
        assert_eq!(
            refused(run(&all, &request).await),
            SecretErrorCode::RefNotAllowedInField
        );
        assert!(org_ai_toolsets::get(&org, &id).await.unwrap().is_none());
        let files = row(
            &org,
            &id,
            "kube",
            "cli",
            json!({"command": "kubectl", "credential_files": {"K": "{{secrets.KUBE}}"}}),
        );
        let request = SaveRequest {
            toolset: files,
            previous: None,
            binds: vec![],
        };
        assert_eq!(
            refused(run(&all, &request).await),
            SecretErrorCode::RefNotAllowedInField
        );
    }

    async fn v37_manage_regate_and_automation_flag() {
        let org = unique("tsave_mcp");
        let secret = ready_secret(&org, "GH").await;
        let id = ksuid();
        let new = SaveRequest {
            toolset: row(&org, &id, "github", "mcp", mcp(false)),
            previous: None,
            binds: vec![],
        };
        let use_only = Grants::of(&secret, &["GET"]);
        assert_eq!(
            refused(run(&use_only, &new).await),
            SecretErrorCode::SecretManageRequiredForToolset
        );
        assert!(org_ai_toolsets::get(&org, &id).await.unwrap().is_none());
        let none = Grants(BTreeSet::new());
        assert_eq!(
            refused(run(&none, &new).await),
            SecretErrorCode::SecretUseDenied
        );

        let manage = Grants::of(&secret, &["GET", "PUT"]);
        let request = run(&manage, &new).await.unwrap().unwrap();
        assert_eq!(request.refs.len(), 1);
        assert_eq!(request.refs[0].secret_id, secret);
        let conn = get_orm_client_rw().await;
        let refs = secret_refs::list_for_consumer_in(conn, &org, CONSUMER.as_str(), &id)
            .await
            .unwrap();
        assert_eq!(refs[0].field, "/data/headers/Authorization");
        let signed = auth::get_in(conn, &org, CONSUMER.as_str(), &id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(signed.auth_state, auth::AuthState::Ok);

        let stored = org_ai_toolsets::get(&org, &id).await.unwrap().unwrap();
        let turn_on = SaveRequest {
            toolset: OrgToolset {
                updated_at: stored.updated_at + 1,
                ..row(&org, &id, "github", "mcp", mcp(true))
            },
            previous: Some(stored.clone()),
            binds: vec![],
        };
        assert_eq!(
            refused(run(&use_only, &turn_on).await),
            SecretErrorCode::SecretManageRequiredForToolset
        );
        let unchanged = org_ai_toolsets::get(&org, &id).await.unwrap().unwrap();
        assert!(!toolset::automation_allowed(
            &toolset::parse_data(&unchanged).unwrap()
        ));
        run(&manage, &turn_on).await.unwrap();
        let on = org_ai_toolsets::get(&org, &id).await.unwrap().unwrap();
        assert!(toolset::automation_allowed(
            &toolset::parse_data(&on).unwrap()
        ));
    }

    async fn unknown_secret_and_plain_toolsets() {
        let org = unique("tsave_plain");
        let unknown = SaveRequest {
            toolset: row(&org, &ksuid(), "github", "mcp", mcp(false)),
            previous: None,
            binds: vec![],
        };
        let none = Grants(BTreeSet::new());
        assert_eq!(
            refused(run(&none, &unknown).await),
            SecretErrorCode::SecretUseDenied
        );

        let id = ksuid();
        let inline = SaveRequest {
            toolset: row(
                &org,
                &id,
                "gh",
                "cli",
                json!({"command": "gh", "env": {"T": "v"}}),
            ),
            previous: None,
            binds: vec![],
        };
        assert!(run(&none, &inline).await.unwrap().is_none());
        let saved = org_ai_toolsets::get(&org, &id).await.unwrap().unwrap();
        assert_eq!(toolset::parse_data(&saved).unwrap()["env"]["T"], "v");
        let conn = get_orm_client_rw().await;
        assert!(
            auth::get_in(conn, &org, CONSUMER.as_str(), &id)
                .await
                .unwrap()
                .is_none()
        );
        let dup = SaveRequest {
            toolset: row(&org, &ksuid(), "gh", "cli", json!({"command": "gh"})),
            previous: None,
            binds: vec![],
        };
        assert!(matches!(run(&none, &dup).await, Err(SaveError::NameTaken)));
    }
}
