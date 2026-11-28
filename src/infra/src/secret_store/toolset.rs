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

//! AI toolsets as secret consumers: slot rules, the signed image, write-only markers and which
//! toolsets an agent principal may receive.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::atomic::{AtomicBool, Ordering},
};

use async_trait::async_trait;
use config::{
    meta::secret_store::{
        ConsumerType, Decision, SecretErrorCode, SecretStoreAuthz,
        digest::{DepEntry, KAuth},
        grammar::{self, PinPattern, RefKind, RefToken, Slot},
    },
    utils::encryption::Algorithm,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseTransaction,
    EntityTrait, IntoActiveModel, QueryFilter, QuerySelect, Set, sea_query::LockType,
};
use serde_json::{Map, Value, json};

use super::{bind::StrictVerb, reauthorize::ConsumerImage, respell::RespellTarget};
use crate::{
    errors::Error,
    table::{
        cipher,
        entity::org_ai_toolsets as toolset_rows,
        org_ai_toolsets::{self, ListFilter, OrgToolset},
        org_secret_values::{self, ORG_ENV},
        org_secrets, secret_aliases, secret_refs,
    },
};

pub const CONSUMER: ConsumerType = ConsumerType::AiToolset;
pub const AUTOMATION_ALLOWED: &str = "automation_allowed";
const KIND_MCP: &str = "mcp";
const KIND_CLI: &str = "cli";
const CLI_WRITE_ONLY: [&str; 2] = ["env", "credential_files"];
/// What ENT `redact_response_data` shows for a saved MCP header; an echo of it keeps the value.
pub const REDACTION_MARKER: &str = "***";
static LATCH_SEEN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentPrincipal {
    /// `role` is the strict role, `root` for a root user.
    User {
        user_id: String,
        role: String,
    },
    Delegated {
        user_id: String,
        link_id: String,
    },
    Automation {
        run_id: String,
    },
}

impl AgentPrincipal {
    pub fn audit_label(&self) -> String {
        match self {
            Self::User { user_id, .. } => format!("user:{user_id}"),
            Self::Delegated { user_id, link_id } => format!("delegated:{user_id}:{link_id}"),
            Self::Automation { run_id } => format!("automation:{run_id}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CredentialSlot {
    pub pointer: String,
    pub slot: Slot,
    pub tokens: Vec<RefToken>,
    pub inline: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Omitted {
    RefNotAllowedInField,
    AuthorityOverrideRefused,
    Unbound,
    Malformed,
    Delegated,
    AutomationNotAllowed,
    Denied,
    PermissionsUnavailable,
}

impl Omitted {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RefNotAllowedInField => "ref_not_allowed_in_field",
            Self::AuthorityOverrideRefused => "authority_override_refused",
            Self::Unbound => "secret_unbound",
            Self::Malformed => "malformed",
            Self::Delegated => "delegated",
            Self::AutomationNotAllowed => "automation_not_allowed",
            Self::Denied => "denied",
            Self::PermissionsUnavailable => "permissions_unavailable",
        }
    }
}

/// One toolset as the loader classifies it from its row and its `secret_refs` rows.
#[derive(Clone, Debug)]
pub struct Candidate {
    pub toolset: OrgToolset,
    pub data: Value,
    pub ref_ids: BTreeSet<String>,
    pub inline: bool,
    /// A `{{vars.*}}` needs a resolve even when no secret is bound.
    pub has_vars: bool,
    pub automation_allowed: bool,
    pub refused: Option<Omitted>,
}

impl Candidate {
    pub fn classify(toolset: OrgToolset, refs: &[secret_refs::Model]) -> Self {
        let mut candidate = Self {
            data: Value::Null,
            ref_ids: refs.iter().map(|r| r.secret_id.clone()).collect(),
            inline: false,
            has_vars: false,
            automation_allowed: false,
            refused: None,
            toolset,
        };
        let data = match parse_data(&candidate.toolset) {
            Ok(data) => data,
            Err(_) => {
                candidate.refused = Some(Omitted::Malformed);
                return candidate;
            }
        };
        candidate.automation_allowed = automation_allowed(&data);
        match slots(&candidate.toolset.kind, &data) {
            Ok(slots) => {
                candidate.inline = slots.iter().any(|s| s.inline);
                candidate.has_vars = slots
                    .iter()
                    .any(|s| s.tokens.iter().any(|t| t.kind == RefKind::Var));
                if !all_bound(&slots, refs) {
                    candidate.refused = Some(Omitted::Unbound);
                }
            }
            Err(SecretErrorCode::RefNotAllowedInField) => {
                candidate.refused = Some(Omitted::RefNotAllowedInField);
            }
            Err(SecretErrorCode::AuthorityOverrideRefused) => {
                candidate.refused = Some(Omitted::AuthorityOverrideRefused);
            }
            Err(_) => candidate.refused = Some(Omitted::Malformed),
        }
        candidate.data = data;
        candidate
    }

    /// Secret-bearing means effective credentials: a bound ref or any non-empty inline slot.
    pub fn secret_bearing(&self) -> bool {
        !self.ref_ids.is_empty() || self.inline
    }

    pub async fn admit(
        &self,
        principal: &AgentPrincipal,
        authz: &dyn SecretStoreAuthz,
    ) -> Result<(), Omitted> {
        self.admit_at(principal, authz, store_latched().await).await
    }

    pub(crate) async fn admit_at(
        &self,
        principal: &AgentPrincipal,
        authz: &dyn SecretStoreAuthz,
        latched: bool,
    ) -> Result<(), Omitted> {
        if let Some(refused) = self.refused {
            return Err(refused);
        }
        // Inline-only toolsets load for everyone until the store latches, as they did before it.
        if !self.secret_bearing() || (!latched && self.ref_ids.is_empty()) {
            return Ok(());
        }
        match principal {
            AgentPrincipal::Delegated { .. } => Err(Omitted::Delegated),
            // Inline-only toolsets keep loading for automation until their P2 migration.
            AgentPrincipal::Automation { .. } => {
                if self.ref_ids.is_empty() || self.automation_allowed {
                    Ok(())
                } else {
                    Err(Omitted::AutomationNotAllowed)
                }
            }
            AgentPrincipal::User { user_id, role } => {
                for (object, verb) in self.user_checks() {
                    let org = &self.toolset.org;
                    match authz.check_strict(org, user_id, role, &object, verb).await {
                        Ok(Decision::Allow) => {}
                        Ok(Decision::Deny) => return Err(Omitted::Denied),
                        Err(_) => return Err(Omitted::PermissionsUnavailable),
                    }
                }
                Ok(())
            }
        }
    }

    fn user_checks(&self) -> Vec<(String, &'static str)> {
        let mut checks: Vec<_> = self
            .ref_ids
            .iter()
            .flat_map(|id| {
                let object = format!("secrets:{id}");
                [(object.clone(), "GET"), (object, "PUT")]
            })
            .collect();
        if self.inline {
            checks.push((format!("ai_toolsets:_all_{}", self.toolset.org), "PUT"));
        }
        checks
    }
}

/// What a loader hands to the agent, and why each other toolset stayed behind.
#[derive(Debug, Default)]
pub struct Admitted {
    pub loaded: Vec<Candidate>,
    pub omitted: Vec<(String, Omitted)>,
}

/// Respells toolset MCP headers; registered with the respell job by default.
pub struct ToolsetRespell;

#[async_trait]
impl RespellTarget for ToolsetRespell {
    fn consumer_type(&self) -> ConsumerType {
        CONSUMER
    }

    async fn load_locked(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
        _k_auth: &KAuth,
    ) -> Result<Option<ConsumerImage>, Error> {
        let Some(row) = lock_row(txn, org_id, consumer_id).await? else {
            return Ok(None);
        };
        let toolset = decrypt_row(row).await?;
        let data = parse_data(&toolset).map_err(Error::SecretStore)?;
        let deps = BTreeMap::from([(
            ORG_ENV.to_owned(),
            dependencies_in(txn, org_id, &data, &toolset.kind).await?,
        )]);
        Ok(Some(
            image(&toolset, &data, deps).map_err(Error::SecretStore)?,
        ))
    }

    async fn store_in(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
        stored: &Value,
    ) -> Result<(), Error> {
        let row = lock_row(txn, org_id, consumer_id)
            .await?
            .ok_or(Error::SecretStore(SecretErrorCode::DeliveryStale))?;
        let data = stored
            .get("data")
            .ok_or(Error::SecretStore(SecretErrorCode::DeliveryStale))?
            .to_string();
        let dek = cipher::get_dek(org_id).await?;
        let encrypted = Algorithm::Aes256Siv
            .encrypt(&dek, &data)
            .map_err(|e| Error::Message(e.to_string()))?;
        let mut update = row.into_active_model();
        update.data = Set(Some(encrypted));
        update.update(txn).await?;
        Ok(())
    }

    async fn request_urls(
        &self,
        txn: &DatabaseTransaction,
        org_id: &str,
        consumer_id: &str,
    ) -> Result<Vec<String>, Error> {
        let Some(row) = toolset_rows::Entity::find()
            .filter(toolset_rows::Column::Org.eq(org_id))
            .filter(toolset_rows::Column::Id.eq(consumer_id))
            .one(txn)
            .await?
        else {
            return Ok(Vec::new());
        };
        let data = parse_data(&decrypt_row(row).await?).map_err(Error::SecretStore)?;
        Ok(data
            .get("url")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .into_iter()
            .collect())
    }
}

/// JSON pointer to one stored field, escaped per RFC 6901.
pub fn pointer(parts: &[&str]) -> String {
    parts.iter().fold(String::new(), |mut out, part| {
        out.push('/');
        out.push_str(&part.replace('~', "~0").replace('/', "~1"));
        out
    })
}

pub fn parse_data(toolset: &OrgToolset) -> Result<Value, SecretErrorCode> {
    match toolset.data.as_deref() {
        None => Ok(Value::Object(Map::new())),
        Some(raw) => serde_json::from_str(raw).map_err(|_| SecretErrorCode::SecretUnavailable),
    }
}

pub fn automation_allowed(data: &Value) -> bool {
    data.get(AUTOMATION_ALLOWED).and_then(Value::as_bool) == Some(true)
}

/// Every string in `data` with its slot; a ref outside an MCP header value is refused (V40 N2).
pub fn slots(kind: &str, data: &Value) -> Result<Vec<CredentialSlot>, SecretErrorCode> {
    let mut out = Vec::new();
    let mut path = Vec::new();
    walk(kind, data, &mut path, &mut out)?;
    if kind == KIND_MCP {
        let has_secret = out
            .iter()
            .any(|s| s.tokens.iter().any(|t| t.kind == RefKind::Secret));
        for headers in ["headers", "write_headers"]
            .into_iter()
            .filter_map(|field| data.get(field).and_then(Value::as_object))
        {
            for name in headers.keys() {
                grammar::check_header_name(name, has_secret)?;
            }
        }
    }
    Ok(out)
}

/// The stored shape the delivery digest signs; `/name` and `/description` are excluded from it.
pub fn stored(toolset: &OrgToolset, data: &Value) -> Value {
    json!({
        "name": toolset.name,
        "description": toolset.description,
        "kind": toolset.kind,
        "data": data,
    })
}

pub fn image(
    toolset: &OrgToolset,
    data: &Value,
    deps: BTreeMap<String, Vec<DepEntry>>,
) -> Result<ConsumerImage, SecretErrorCode> {
    let keyed_pointers = slots(&toolset.kind, data)?
        .into_iter()
        .filter(|s| s.inline)
        .map(|s| s.pointer)
        .collect();
    Ok(ConsumerImage {
        name: toolset.name.clone(),
        stored: stored(toolset, data),
        keyed_pointers,
        deps,
    })
}

/// The denial a toolset save returns for a strict check it failed.
pub fn denied_code(verb: StrictVerb) -> SecretErrorCode {
    match verb {
        StrictVerb::Use => SecretErrorCode::SecretUseDenied,
        StrictVerb::Manage => SecretErrorCode::SecretManageRequiredForToolset,
        StrictVerb::AccessPut => SecretErrorCode::SecretAccessRequired,
    }
}

/// Advisory `allowed_hosts` for the MCP wire entry, from the pins the resolve just checked.
pub async fn advisory_hosts_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    ref_ids: &BTreeSet<String>,
    url: &str,
) -> Result<Vec<String>, SecretErrorCode> {
    let rows = org_secrets::Entity::find()
        .filter(org_secrets::Column::OrgId.eq(org))
        .filter(org_secrets::Column::Id.is_in(ref_ids.iter().cloned()))
        .all(conn)
        .await
        .map_err(|_| SecretErrorCode::SecretUnavailable)?;
    let pins = rows
        .iter()
        .filter(|row| row.kind == "secret" && row.pin_mode == org_secrets::PinMode::Hosts)
        .map(|row| {
            row.allowed_hosts
                .lines()
                .map(PinPattern::parse)
                .collect::<Result<Vec<_>, _>>()
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| SecretErrorCode::PinMismatch)?;
    pin_intersection(&pins, url)
}

/// Turning `automation_allowed` on hands every ref to unattended runs, so it needs manage on each.
pub fn automation_checks(ref_ids: &BTreeSet<String>) -> BTreeSet<(String, StrictVerb)> {
    ref_ids
        .iter()
        .map(|id| (id.clone(), StrictVerb::Manage))
        .collect()
}

/// Replaces each saved CLI env value and credential file with its write-only marker.
pub fn redact_write_only(kind: &str, data: &mut Value, updated_at: i64, updated_by: &str) {
    if kind != KIND_CLI {
        return;
    }
    for section in CLI_WRITE_ONLY {
        if let Some(Value::Object(entries)) = data.get_mut(section) {
            for value in entries.values_mut() {
                if value.as_str().is_some_and(|text| !text.is_empty()) {
                    *value =
                        json!({"set": true, "updated_at": updated_at, "updated_by": updated_by});
                }
            }
        }
    }
}

/// Resolves `{"keep": true}` from the stored row; any other object in a write-only slot is refused.
pub fn merge_kept(
    kind: &str,
    new: &mut Value,
    stored: Option<&Value>,
) -> Result<(), SecretErrorCode> {
    if kind == KIND_MCP {
        return merge_kept_headers(new, stored);
    }
    if kind != KIND_CLI {
        return Ok(());
    }
    for section in CLI_WRITE_ONLY {
        let Some(Value::Object(entries)) = new.get_mut(section) else {
            continue;
        };
        for (key, value) in entries.iter_mut() {
            if value.is_string() {
                continue;
            }
            if value.get("keep").and_then(Value::as_bool) != Some(true) {
                return Err(SecretErrorCode::SlotValueRequired);
            }
            let kept = stored
                .and_then(|s| s.get(section))
                .and_then(|s| s.get(key))
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .ok_or(SecretErrorCode::SlotValueRequired)?;
            *value = Value::String(kept.to_owned());
        }
    }
    Ok(())
}

/// The `_org` dependency entries of every `{{vars.*}}` in the toolset's header slots.
pub async fn dependencies_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    data: &Value,
    kind: &str,
) -> Result<Vec<DepEntry>, Error> {
    let names: BTreeSet<String> = slots(kind, data)
        .map_err(Error::SecretStore)?
        .into_iter()
        .flat_map(|s| s.tokens)
        .filter(|t| t.kind == RefKind::Var)
        .map(|t| t.name)
        .collect();
    let mut entries = Vec::with_capacity(names.len());
    for name in names {
        let row = match org_secrets::get_live_by_name_in(conn, org, &name).await? {
            Some(row) => Some(row),
            None => match secret_aliases::get_alias_in(
                conn,
                org,
                &name,
                config::utils::time::now_micros(),
            )
            .await?
            {
                Some(alias) => org_secrets::get_secret_in(conn, org, &alias.secret_id).await?,
                None => None,
            },
        };
        let Some(row) = row.filter(|r| r.state == "active") else {
            entries.push(DepEntry::Absent { name });
            continue;
        };
        let head = org_secret_values::get_value_in(conn, org, &row.id, ORG_ENV, "").await?;
        entries.push(match head.filter(|h| h.state == "set") {
            Some(head) => DepEntry::Store {
                secret_id: row.id,
                value_rev: head.value_rev,
            },
            None => DepEntry::StoreMissing { secret_id: row.id },
        });
    }
    Ok(entries)
}

/// The org's toolsets and their refs from one connection; pass the primary for load decisions.
pub async fn candidates_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Vec<Candidate>, Error> {
    let toolsets = org_ai_toolsets::list_with(conn, org, ListFilter::default(), None).await?;
    let mut refs: BTreeMap<String, Vec<secret_refs::Model>> = BTreeMap::new();
    for row in secret_refs::Entity::find()
        .filter(secret_refs::Column::OrgId.eq(org))
        .filter(secret_refs::Column::ConsumerType.eq(CONSUMER.as_str()))
        .all(conn)
        .await?
    {
        refs.entry(row.consumer_id.clone()).or_default().push(row);
    }
    Ok(toolsets
        .into_iter()
        .map(|t| {
            let rows = refs.remove(&t.id).unwrap_or_default();
            Candidate::classify(t, &rows)
        })
        .collect())
}

pub async fn admitted_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    principal: &AgentPrincipal,
    authz: &dyn SecretStoreAuthz,
) -> Result<Admitted, Error> {
    admitted_at(conn, org, principal, authz, store_latched().await).await
}

pub(crate) async fn admitted_at<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    principal: &AgentPrincipal,
    authz: &dyn SecretStoreAuthz,
    latched: bool,
) -> Result<Admitted, Error> {
    let mut admitted = Admitted::default();
    for candidate in candidates_in(conn, org).await? {
        match candidate.admit_at(principal, authz, latched).await {
            Ok(()) => admitted.loaded.push(candidate),
            Err(reason) => admitted
                .omitted
                .push((candidate.toolset.id.clone(), reason)),
        }
    }
    Ok(admitted)
}

/// The latch is one-way, so once seen it is cached; an unreadable latch keeps today's loading.
async fn store_latched() -> bool {
    if LATCH_SEEN.load(Ordering::Relaxed) {
        return true;
    }
    let latched = super::gate::durably_latched().await.unwrap_or(false);
    if latched {
        LATCH_SEEN.store(true, Ordering::Relaxed);
    }
    latched
}

fn walk(
    kind: &str,
    value: &Value,
    path: &mut Vec<String>,
    out: &mut Vec<CredentialSlot>,
) -> Result<(), SecretErrorCode> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                path.push(key.clone());
                walk(kind, child, path, out)?;
                path.pop();
            }
        }
        Value::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                path.push(i.to_string());
                walk(kind, child, path, out)?;
                path.pop();
            }
        }
        Value::String(text) => {
            let slot = slot_at(kind, path);
            let tokens = grammar::parse_refs(text)?;
            let allowed = |t: &RefToken| {
                slot.as_ref()
                    .is_some_and(|s| grammar::slot_allows(CONSUMER, s, t.kind))
            };
            if !tokens.iter().all(allowed) {
                return Err(SecretErrorCode::RefNotAllowedInField);
            }
            if let Some(slot @ (Slot::McpHeaderValue | Slot::CliEnvValue | Slot::CredentialFile)) =
                slot
            {
                let mut parts = vec!["data"];
                parts.extend(path.iter().map(String::as_str));
                out.push(CredentialSlot {
                    pointer: pointer(&parts),
                    inline: tokens.is_empty() && !text.trim().is_empty(),
                    slot,
                    tokens,
                });
            }
        }
        _ => {}
    }
    Ok(())
}

/// The origins inside every pin list, else the URL's own origin; never empty, since an empty
/// list would read as "no limit".
fn pin_intersection(pins: &[Vec<PinPattern>], url: &str) -> Result<Vec<String>, SecretErrorCode> {
    if pins.is_empty() {
        let url = reqwest::Url::parse(url).map_err(|_| SecretErrorCode::InsecureTransport)?;
        return match (url.scheme(), url.host_str(), url.port_or_known_default()) {
            ("https", Some(host), Some(port)) => Ok(vec![format!("https://{host}:{port}")]),
            _ => Err(SecretErrorCode::InsecureTransport),
        };
    }
    let inside_all = |candidate: &PinPattern| {
        pins.iter()
            .all(|list| list.iter().any(|p| p.covers(candidate)))
    };
    let common: Vec<&PinPattern> = pins.iter().flatten().filter(|p| inside_all(p)).collect();
    let mut origins: Vec<String> = common
        .iter()
        .filter(|p| !common.iter().any(|q| q != *p && q.covers(p)))
        .map(ToString::to_string)
        .collect();
    origins.sort();
    origins.dedup();
    if origins.is_empty() {
        return Err(SecretErrorCode::PinMismatch);
    }
    Ok(origins)
}

fn slot_at(kind: &str, path: &[String]) -> Option<Slot> {
    match (kind, path) {
        (KIND_MCP, [section, _]) if section == "headers" || section == "write_headers" => {
            Some(Slot::McpHeaderValue)
        }
        (KIND_MCP, [field]) if field == "url" => Some(Slot::McpUrlHost),
        (KIND_CLI, [section, _]) if section == "env" => Some(Slot::CliEnvValue),
        (KIND_CLI, [section, _]) if section == "credential_files" => Some(Slot::CredentialFile),
        (KIND_CLI, [field]) if field == "command" => Some(Slot::Command),
        _ => None,
    }
}

fn all_bound(slots: &[CredentialSlot], refs: &[secret_refs::Model]) -> bool {
    slots.iter().all(|slot| {
        slot.tokens
            .iter()
            .filter(|t| t.kind == RefKind::Secret)
            .all(|t| {
                refs.iter()
                    .any(|r| r.field == slot.pointer && r.token_name == t.name)
            })
    })
}

pub(super) async fn lock_row(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
) -> Result<Option<toolset_rows::Model>, Error> {
    let mut query = toolset_rows::Entity::find()
        .filter(toolset_rows::Column::Org.eq(org_id))
        .filter(toolset_rows::Column::Id.eq(id));
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock(LockType::Update);
    }
    Ok(query.one(txn).await?)
}

async fn decrypt_row(row: toolset_rows::Model) -> Result<OrgToolset, Error> {
    let data = match row.data.as_deref() {
        Some(cipher_text) => {
            let dek = cipher::get_dek(&row.org).await?;
            Some(
                Algorithm::Aes256Siv
                    .decrypt(&dek, cipher_text)
                    .map_err(|e| Error::Message(e.to_string()))?,
            )
        }
        None => None,
    };
    Ok(OrgToolset {
        id: row.id,
        org: row.org,
        name: row.name,
        kind: row.kind,
        description: row.description,
        data,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        enabled: row.enabled,
        status_state: row.status_state,
        status_since: row.status_since,
        last_error: row.last_error,
        last_used_at: row.last_used_at,
    })
}

/// A header echoed as the redaction marker, or sent as `{"keep": true}`, keeps its stored text.
fn merge_kept_headers(new: &mut Value, stored: Option<&Value>) -> Result<(), SecretErrorCode> {
    let Some(Value::Object(headers)) = new.get_mut("headers") else {
        return Ok(());
    };
    for (name, value) in headers.iter_mut() {
        let keep = match &*value {
            Value::String(text) => text == REDACTION_MARKER,
            other => other.get("keep").and_then(Value::as_bool) == Some(true),
        };
        if !keep {
            if value.is_string() {
                continue;
            }
            return Err(SecretErrorCode::SlotValueRequired);
        }
        let kept = stored
            .and_then(|s| s.get("headers"))
            .and_then(|h| h.get(name))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .ok_or(SecretErrorCode::SlotValueRequired)?;
        *value = Value::String(kept.to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use async_trait::async_trait;
    use config::meta::secret_store::{Decision, SecretErrorCode, SecretStoreAuthz};
    use parking_lot::Mutex;
    use sea_orm::{ActiveModelTrait, Set};
    use serde_json::{Value, json};

    use super::*;
    use crate::table::{cipher, entity::secret_refs as ref_entity, testing::unique};

    const ORG: &str = "acme";

    #[derive(Default)]
    struct FakeAuthz {
        allowed: BTreeSet<(String, String)>,
        unavailable: bool,
        calls: Mutex<Vec<(String, String)>>,
    }

    impl FakeAuthz {
        fn allowing(grants: &[(&str, &str)]) -> Self {
            Self {
                allowed: grants
                    .iter()
                    .map(|(o, v)| ((*o).to_owned(), (*v).to_owned()))
                    .collect(),
                ..Self::default()
            }
        }
    }

    #[async_trait]
    impl SecretStoreAuthz for FakeAuthz {
        async fn check_strict(
            &self,
            _org_id: &str,
            _user_id: &str,
            _role: &str,
            object: &str,
            verb: &str,
        ) -> Result<Decision, SecretErrorCode> {
            self.calls.lock().push((object.into(), verb.into()));
            if self.unavailable {
                return Err(SecretErrorCode::PermissionsUnavailable);
            }
            let key = (object.to_owned(), verb.to_owned());
            Ok(if self.allowed.contains(&key) {
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

    fn toolset(id: &str, kind: &str, data: Value) -> OrgToolset {
        OrgToolset {
            id: id.into(),
            org: ORG.into(),
            name: format!("{id}-name"),
            kind: kind.into(),
            description: Some("d".into()),
            data: Some(data.to_string()),
            created_by: "creator".into(),
            created_at: 1,
            updated_at: 2,
            enabled: true,
            status_state: None,
            status_since: None,
            last_error: None,
            last_used_at: None,
        }
    }

    fn ref_row(consumer: &str, field: &str, token: &str, secret: &str) -> secret_refs::Model {
        secret_refs::Model {
            id: format!("{consumer}{field}{token}"),
            org_id: ORG.into(),
            consumer_type: CONSUMER.as_str().into(),
            consumer_id: consumer.into(),
            field: field.into(),
            secret_id: secret.into(),
            token_name: token.into(),
            created_at: 1,
        }
    }

    fn user() -> AgentPrincipal {
        AgentPrincipal::User {
            user_id: "u@acme.test".into(),
            role: "editor".into(),
        }
    }

    fn delegated() -> AgentPrincipal {
        AgentPrincipal::Delegated {
            user_id: "u@acme.test".into(),
            link_id: "link".into(),
        }
    }

    fn automation() -> AgentPrincipal {
        AgentPrincipal::Automation {
            run_id: "run".into(),
        }
    }

    fn mcp_with_ref(automation: bool) -> Candidate {
        let data = json!({
            "url": "https://mcp.acme.test",
            "headers": {"Authorization": "Bearer {{secrets.GH}}"},
            "automation_allowed": automation,
        });
        Candidate::classify(
            toolset("t1", "mcp", data),
            &[ref_row("t1", "/data/headers/Authorization", "GH", "2pA")],
        )
    }

    fn cli_inline() -> Candidate {
        let data = json!({"command": "gh", "env": {"GH_TOKEN": "literal"}});
        Candidate::classify(toolset("t2", "cli", data), &[])
    }

    fn plain_skill() -> Candidate {
        Candidate::classify(toolset("t3", "skill", json!({"content": "# runbook"})), &[])
    }

    #[test]
    fn pointer_escapes_per_rfc_6901() {
        assert_eq!(
            pointer(&["data", "headers", "a/b~c"]),
            "/data/headers/a~1b~0c"
        );
    }

    #[test]
    fn v40_n2_cli_slots_refuse_every_store_ref() {
        let refused = [
            (
                "cli",
                json!({"command": "gh", "env": {"T": "{{secrets.GH}}"}}),
            ),
            (
                "cli",
                json!({"command": "gh", "env": {"T": "x{{vars.HOST}}"}}),
            ),
            (
                "cli",
                json!({"command": "gh", "credential_files": {"K": "{{secrets.KUBE}}"}}),
            ),
            ("cli", json!({"command": "{{secrets.GH}}"})),
            ("mcp", json!({"url": "https://{{vars.HOST}}/mcp"})),
            ("skill", json!({"content": "{{secrets.GH}}"})),
        ];
        for (kind, data) in refused {
            assert_eq!(
                slots(kind, &data),
                Err(SecretErrorCode::RefNotAllowedInField),
                "{kind} {data}"
            );
        }
        let header = json!({"url": "https://m", "headers": {"A": "Bearer {{secrets.GH}}"}});
        let found = slots("mcp", &header).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].pointer, "/data/headers/A");
        assert_eq!(found[0].slot, Slot::McpHeaderValue);
        assert!(!found[0].inline);
    }

    #[test]
    fn t32_mcp_authority_header_is_refused_beside_a_secret_ref() {
        for field in ["headers", "write_headers"] {
            for name in ["Host", " host", ":authority"] {
                let data =
                    json!({"url": "https://m", field: {name: "x", "A": "{{secrets.TOKEN}}"}});
                assert_eq!(
                    slots("mcp", &data),
                    Err(SecretErrorCode::AuthorityOverrideRefused),
                    "{field} {name}"
                );
            }
        }
        let plain = json!({"url": "https://m", "headers": {"Host": "x", "A": "literal"}});
        assert!(slots("mcp", &plain).is_ok());
        let var_only = json!({"url": "https://m", "headers": {"Host": "{{vars.H}}"}});
        assert!(slots("mcp", &var_only).is_ok());
        let data = json!({"headers": {"Host": "x", "A": "{{secrets.GH}}"}});
        assert_eq!(
            Candidate::classify(toolset("t4", "mcp", data), &[]).refused,
            Some(Omitted::AuthorityOverrideRefused)
        );
    }

    #[test]
    fn mcp_write_header_refs_use_header_value_slots() {
        let data = json!({"write_headers": {"Authorization": "Bearer {{secrets.TOKEN}}"}});
        let found = slots("mcp", &data).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].pointer, "/data/write_headers/Authorization");
        assert_eq!(found[0].slot, Slot::McpHeaderValue);
        assert!(!found[0].inline);
        assert_eq!(found[0].tokens[0].kind, RefKind::Secret);
        assert_eq!(found[0].tokens[0].name, "TOKEN");

        let data = json!({"headers": {"Host": "x"}, "write_headers": {"A": "{{secrets.TOKEN}}"}});
        assert_eq!(
            slots("mcp", &data),
            Err(SecretErrorCode::AuthorityOverrideRefused)
        );
        let data = json!({"headers": {"A": "{{secrets.TOKEN}}"}, "write_headers": {"Host": "x"}});
        assert_eq!(
            slots("mcp", &data),
            Err(SecretErrorCode::AuthorityOverrideRefused)
        );
    }

    #[test]
    fn response_shows_only_write_header_ref_templates() {
        let raw = json!({"write_headers": {
            "Authorization": "Bearer {{secrets.TOKEN}}",
            "Region": "{{vars.REGION}}",
            "Literal": "stored-credential",
        }});
        let shown = super::super::toolset_save::response_data(
            "mcp",
            &raw,
            json!({"write_header_names": ["Authorization", "Region", "Literal"]}),
            1,
            "u",
        );
        assert_eq!(
            shown["write_header_refs"],
            json!({
                "Authorization": "Bearer {{secrets.TOKEN}}",
                "Region": "{{vars.REGION}}",
            })
        );
        assert!(shown.get("write_headers").is_none());
        assert!(!shown.to_string().contains("stored-credential"));

        let raw = json!({"write_headers": {"Literal": "stored-credential"}});
        let shown = super::super::toolset_save::response_data("mcp", &raw, json!({}), 1, "u");
        assert!(shown.get("write_header_refs").is_none());
    }

    #[test]
    fn t31_advisory_hosts_intersect_pins_else_the_mcp_origin() {
        let pins = |entries: &[&str]| -> Vec<PinPattern> {
            entries
                .iter()
                .map(|e| PinPattern::parse(e).unwrap())
                .collect()
        };
        assert_eq!(
            pin_intersection(&[], "https://mcp.example/x"),
            Ok(vec!["https://mcp.example:443".to_string()])
        );
        assert_eq!(
            pin_intersection(&[], "http://mcp.example/x"),
            Err(SecretErrorCode::InsecureTransport)
        );
        let both = [pins(&["*.example", "other.test"]), pins(&["mcp.example"])];
        let hosts = pin_intersection(&both, "https://mcp.example/x").unwrap();
        assert_eq!(hosts.len(), 1);
        assert!(hosts[0].contains("mcp.example"), "{hosts:?}");
        assert_eq!(
            pin_intersection(&[pins(&["a.test"]), pins(&["b.test"])], "https://a.test"),
            Err(SecretErrorCode::PinMismatch)
        );
    }

    #[test]
    fn t19_a_var_only_mcp_toolset_is_marked_for_resolve() {
        let data = json!({"url": "https://m", "headers": {"X-Region": "{{vars.REGION}}"}});
        let c = Candidate::classify(toolset("t5", "mcp", data), &[]);
        assert!(c.has_vars && c.refused.is_none() && !c.secret_bearing());
        assert!(!plain_skill().has_vars);
    }

    #[test]
    fn inline_credentials_are_non_empty_literal_slots() {
        let cases = [
            ("mcp", json!({"headers": {"A": "literal"}}), true),
            ("mcp", json!({"headers": {"A": "  "}}), false),
            ("cli", json!({"env": {"T": "v"}}), true),
            (
                "cli",
                json!({"credential_files": {"K": "apiVersion: v1"}}),
                true,
            ),
            ("cli", json!({"command": "gh", "env": {}}), false),
            ("skill", json!({"content": "token-looking text"}), false),
        ];
        for (kind, data, inline) in cases {
            let any = slots(kind, &data).unwrap().iter().any(|s| s.inline);
            assert_eq!(any, inline, "{kind} {data}");
        }
    }

    #[test]
    fn image_keys_inline_literals_and_signs_data_with_automation_flag() {
        let data = json!({
            "headers": {"A": "literal", "B": "{{secrets.GH}}"},
            "automation_allowed": true,
        });
        let t = toolset("t1", "mcp", data.clone());
        let image = image(&t, &data, BTreeMap::new()).unwrap();
        assert_eq!(image.keyed_pointers, vec!["/data/headers/A".to_string()]);
        assert_eq!(image.stored["data"]["automation_allowed"], true);
        assert_eq!(image.stored["name"], "t1-name");
    }

    #[test]
    fn classify_refuses_unbound_and_pre_pr_cli_refs() {
        let unbound = Candidate::classify(
            toolset("t1", "mcp", json!({"headers": {"A": "{{secrets.GH}}"}})),
            &[],
        );
        assert_eq!(unbound.refused, Some(Omitted::Unbound));
        let wrong_field = Candidate::classify(
            toolset("t1", "mcp", json!({"headers": {"A": "{{secrets.GH}}"}})),
            &[ref_row("t1", "/data/headers/B", "GH", "2pA")],
        );
        assert_eq!(wrong_field.refused, Some(Omitted::Unbound));
        let cli = Candidate::classify(
            toolset("t2", "cli", json!({"env": {"T": "{{secrets.GH}}"}})),
            &[],
        );
        assert_eq!(cli.refused, Some(Omitted::RefNotAllowedInField));
        let broken = Candidate::classify(
            OrgToolset {
                data: Some("{".into()),
                ..toolset("t4", "mcp", json!({}))
            },
            &[],
        );
        assert_eq!(broken.refused, Some(Omitted::Malformed));
    }

    #[tokio::test]
    async fn refused_rows_load_for_no_principal() {
        let cli = Candidate::classify(
            toolset("t2", "cli", json!({"env": {"T": "{{secrets.GH}}"}})),
            &[],
        );
        let root = FakeAuthz::allowing(&[]);
        for principal in [user(), delegated(), automation()] {
            assert_eq!(
                cli.admit(&principal, &root).await,
                Err(Omitted::RefNotAllowedInField)
            );
        }
    }

    #[tokio::test]
    async fn d41_delegated_chat_gets_no_secret_bearing_toolset_even_with_manage() {
        let authz = FakeAuthz::allowing(&[("secrets:2pA", "GET"), ("secrets:2pA", "PUT")]);
        assert_eq!(
            mcp_with_ref(true).admit(&delegated(), &authz).await,
            Err(Omitted::Delegated)
        );
        assert!(authz.calls.lock().is_empty());
        assert_eq!(plain_skill().admit(&delegated(), &authz).await, Ok(()));
    }

    #[tokio::test]
    async fn d42_automation_loads_a_ref_toolset_only_when_allowed_and_asks_fga_nothing() {
        let authz = FakeAuthz::default();
        assert_eq!(
            mcp_with_ref(false).admit(&automation(), &authz).await,
            Err(Omitted::AutomationNotAllowed)
        );
        assert_eq!(
            mcp_with_ref(true).admit(&automation(), &authz).await,
            Ok(())
        );
        assert!(authz.calls.lock().is_empty());
    }

    #[tokio::test]
    async fn v37_direct_chat_needs_use_and_manage_on_every_ref() {
        let use_only = FakeAuthz::allowing(&[("secrets:2pA", "GET")]);
        assert_eq!(
            mcp_with_ref(false).admit(&user(), &use_only).await,
            Err(Omitted::Denied)
        );
        let manage = FakeAuthz::allowing(&[("secrets:2pA", "GET"), ("secrets:2pA", "PUT")]);
        assert_eq!(mcp_with_ref(false).admit(&user(), &manage).await, Ok(()));
        let down = FakeAuthz {
            unavailable: true,
            ..FakeAuthz::default()
        };
        assert_eq!(
            mcp_with_ref(false).admit(&user(), &down).await,
            Err(Omitted::PermissionsUnavailable)
        );
    }

    #[tokio::test]
    async fn d289_inline_credentials_are_secret_bearing() {
        let t = cli_inline();
        assert!(t.secret_bearing());
        let none = FakeAuthz::default();
        assert_eq!(
            t.admit_at(&delegated(), &none, true).await,
            Err(Omitted::Delegated)
        );
        assert_eq!(t.admit_at(&user(), &none, true).await, Err(Omitted::Denied));
        let org_object = FakeAuthz::allowing(&[("ai_toolsets:acme", "PUT")]);
        assert_eq!(
            t.admit_at(&user(), &org_object, true).await,
            Err(Omitted::Denied)
        );
        let put = FakeAuthz::allowing(&[("ai_toolsets:_all_acme", "PUT")]);
        assert_eq!(t.admit_at(&user(), &put, true).await, Ok(()));
        // RCA keeps loading inline-only toolsets until the P2 migration writes the flag.
        assert_eq!(t.admit_at(&automation(), &none, true).await, Ok(()));
        for principal in [user(), delegated(), automation()] {
            assert_eq!(plain_skill().admit(&principal, &none).await, Ok(()));
        }
    }

    #[test]
    fn automation_flag_needs_manage_and_maps_denials() {
        let ids = BTreeSet::from(["a".to_string(), "b".to_string()]);
        assert_eq!(
            automation_checks(&ids),
            BTreeSet::from([
                ("a".to_string(), StrictVerb::Manage),
                ("b".to_string(), StrictVerb::Manage)
            ])
        );
        assert_eq!(
            denied_code(StrictVerb::Manage),
            SecretErrorCode::SecretManageRequiredForToolset
        );
        assert_eq!(
            denied_code(StrictVerb::Use),
            SecretErrorCode::SecretUseDenied
        );
    }

    #[test]
    fn an_echoed_mcp_header_marker_keeps_the_stored_value() {
        let stored = json!({"url": "u", "headers": {"A": "real", "B": "other"}});
        let mut put = json!({"url": "u", "headers": {"A": REDACTION_MARKER, "B": {"keep": true}, "C": "new"}});
        merge_kept("mcp", &mut put, Some(&stored)).unwrap();
        assert_eq!(
            put["headers"],
            json!({"A": "real", "B": "other", "C": "new"})
        );
        let mut unknown = json!({"headers": {"Z": REDACTION_MARKER}});
        assert_eq!(
            merge_kept("mcp", &mut unknown, Some(&stored)),
            Err(SecretErrorCode::SlotValueRequired)
        );
        let mut object = json!({"headers": {"A": {"set": true}}});
        assert_eq!(
            merge_kept("mcp", &mut object, Some(&stored)),
            Err(SecretErrorCode::SlotValueRequired)
        );
    }

    #[test]
    fn write_only_markers_round_trip() {
        let stored =
            json!({"command": "gh", "env": {"T": "v", "E": ""}, "credential_files": {"K": "f"}});
        let mut shown = stored.clone();
        redact_write_only("cli", &mut shown, 17, "alice");
        assert_eq!(
            shown["env"]["T"],
            json!({"set": true, "updated_at": 17, "updated_by": "alice"})
        );
        assert_eq!(shown["env"]["E"], "");
        assert!(!shown.to_string().contains("\"v\""));
        let mut put = json!({"command": "gh", "env": {"T": {"keep": true}, "N": "new"}, "credential_files": {"K": {"keep": true}}});
        merge_kept("cli", &mut put, Some(&stored)).unwrap();
        assert_eq!(put["env"]["T"], "v");
        assert_eq!(put["env"]["N"], "new");
        assert_eq!(put["credential_files"]["K"], "f");
        let mut missing = json!({"env": {"X": {"keep": true}}});
        assert_eq!(
            merge_kept("cli", &mut missing, Some(&stored)),
            Err(SecretErrorCode::SlotValueRequired)
        );
        let mut echoed = json!({"env": {"T": {"set": true}}});
        assert_eq!(
            merge_kept("cli", &mut echoed, Some(&stored)),
            Err(SecretErrorCode::SlotValueRequired)
        );
    }

    #[tokio::test]
    async fn candidates_read_rows_and_refs_from_one_connection() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        const CASE: &str =
            "secret_store::toolset::tests::candidates_read_rows_and_refs_from_one_connection";
        const CHILD: &str = "O2_TOOLSET_TEST_CHILD";
        // The cipher key installs once per process, and the cipher tests require an uninitialized
        // key.
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CASE, "--nocapture"])
                .env(CHILD, "1")
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
        let org = unique("toolset_load");
        let rows = [
            (
                "t1",
                "mcp",
                json!({"url": "https://m", "headers": {"A": "{{secrets.GH}}"}}),
            ),
            (
                "t2",
                "cli",
                json!({"command": "gh", "env": {"T": "literal"}}),
            ),
            (
                "t3",
                "cli",
                json!({"command": "gh", "env": {"T": "{{secrets.GH}}"}}),
            ),
            ("t4", "skill", json!({"content": "# runbook"})),
        ];
        for (id, kind, data) in rows {
            org_ai_toolsets::add(OrgToolset {
                org: org.clone(),
                name: id.into(),
                ..toolset(&config::ider::ksuid(), kind, data)
            })
            .await
            .unwrap();
        }
        let conn = crate::db::get_orm_client_rw().await;
        let names: BTreeMap<String, String> =
            org_ai_toolsets::list(&org, ListFilter::default(), None)
                .await
                .unwrap()
                .into_iter()
                .map(|t| (t.id, t.name))
                .collect();
        let t1_id = names.iter().find(|(_, n)| *n == "t1").unwrap().0.clone();
        ref_entity::ActiveModel {
            id: Set(config::ider::ksuid()),
            org_id: Set(org.clone()),
            consumer_type: Set(CONSUMER.as_str().into()),
            consumer_id: Set(t1_id.clone()),
            field: Set("/data/headers/A".into()),
            secret_id: Set("2pA".into()),
            token_name: Set("GH".into()),
            created_at: Set(1),
        }
        .insert(conn)
        .await
        .unwrap();

        let by_id = |admitted: &Admitted| {
            let loaded: BTreeSet<_> = admitted
                .loaded
                .iter()
                .map(|c| c.toolset.name.clone())
                .collect();
            let omitted: BTreeMap<_, _> = admitted
                .omitted
                .iter()
                .map(|(id, why)| (names[id].clone(), *why))
                .collect();
            (loaded, omitted)
        };
        let manage = FakeAuthz::allowing(&[("secrets:2pA", "GET"), ("secrets:2pA", "PUT")]);
        // E2-1: with no latch on record the inline-only CLI toolset loads as before the store.
        assert!(!crate::secret_store::gate::durably_latched().await.unwrap());
        for principal in [user(), delegated()] {
            let none = FakeAuthz::default();
            let (loaded, omitted) =
                by_id(&admitted_in(conn, &org, &principal, &none).await.unwrap());
            assert!(loaded.contains("t2"), "{loaded:?}");
            assert!(!omitted.contains_key("t2"));
        }
        let (loaded, omitted) = by_id(
            &admitted_at(conn, &org, &user(), &manage, true)
                .await
                .unwrap(),
        );
        assert_eq!(loaded, BTreeSet::from(["t1".into(), "t4".into()]));
        assert_eq!(omitted["t2"], Omitted::Denied);
        assert_eq!(omitted["t3"], Omitted::RefNotAllowedInField);

        let (loaded, omitted) = by_id(
            &admitted_at(conn, &org, &delegated(), &manage, true)
                .await
                .unwrap(),
        );
        assert_eq!(loaded, BTreeSet::from(["t4".into()]));
        assert_eq!(omitted["t1"], Omitted::Delegated);
        assert_eq!(omitted["t2"], Omitted::Delegated);

        let (loaded, omitted) = by_id(
            &admitted_at(conn, &org, &automation(), &FakeAuthz::default(), true)
                .await
                .unwrap(),
        );
        assert_eq!(loaded, BTreeSet::from(["t2".into(), "t4".into()]));
        assert_eq!(omitted["t1"], Omitted::AutomationNotAllowed);
        respell_rewrites_a_signed_toolset_header(&org).await;
    }

    /// D164 respell half on a real toolset row: the header is respelled and the digest is kept.
    async fn respell_rewrites_a_signed_toolset_header(org: &str) {
        use config::meta::secret_store::digest::{
            AuthTagInput, BoundRef, delivery_digest, dep_digests, encode_dep_digests,
        };

        use crate::{
            secret_store::{reauthorize::k_auth_for, respell},
            table::{entity::org_secrets as secret_rows, secret_consumer_auth as auth},
        };

        let conn = crate::db::get_orm_client_rw().await;
        let now = config::utils::time::now_micros();
        let secret = secret_rows::ActiveModel {
            id: Set(config::ider::ksuid()),
            org_id: Set(org.into()),
            name: Set("OLD".into()),
            kind: Set("secret".into()),
            state: Set("active".into()),
            policy_rev: Set(config::ider::ksuid()),
            policy_version: Set(1),
            created_by: Set("c".into()),
            updated_by: Set("c".into()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        }
        .insert(conn)
        .await
        .unwrap();
        let id = config::ider::ksuid();
        let data = json!({"url": "https://m", "headers": {"A": "Bearer {{secrets.OLD}}"}});
        org_ai_toolsets::add(OrgToolset {
            org: org.into(),
            name: format!("r1-{org}"),
            ..toolset(&id, "mcp", data)
        })
        .await
        .unwrap();
        let binding = BoundRef {
            field: "/data/headers/A".into(),
            token_name: "OLD".into(),
            secret_id: secret.id.clone(),
        };
        ref_entity::ActiveModel {
            id: Set(config::ider::ksuid()),
            org_id: Set(org.into()),
            consumer_type: Set(CONSUMER.as_str().into()),
            consumer_id: Set(id.clone()),
            field: Set(binding.field.clone()),
            secret_id: Set(secret.id.clone()),
            token_name: Set("OLD".into()),
            created_at: Set(now),
        }
        .insert(conn)
        .await
        .unwrap();
        let key = k_auth_for(org).await.unwrap();
        let row = org_ai_toolsets::get(org, &id).await.unwrap().unwrap();
        let data = parse_data(&row).unwrap();
        let deps = BTreeMap::from([(ORG_ENV.to_owned(), vec![])]);
        let signed_image = image(&row, &data, deps).unwrap();
        let digest = delivery_digest(
            CONSUMER,
            &signed_image.stored,
            &signed_image.keyed_pointers,
            &key,
            |f, n| (f == binding.field && n == binding.token_name).then(|| secret.id.clone()),
        )
        .unwrap();
        let deps = dep_digests(&signed_image.deps).unwrap();
        let tag = key.auth_tag(&AuthTagInput {
            org_id: org,
            consumer_type: CONSUMER,
            consumer_id: &id,
            consumer_rev: 1,
            refs: std::slice::from_ref(&binding),
            delivery_digest: &digest,
            dep_digests: &deps,
        });
        auth::insert_in(
            conn,
            auth::ActiveModel {
                org_id: Set(org.into()),
                consumer_type: Set(CONSUMER.as_str().into()),
                consumer_id: Set(id.clone()),
                consumer_name: Set(row.name.clone()),
                consumer_rev: Set(1),
                delivery_digest: Set(digest.clone()),
                dep_digests: Set(encode_dep_digests(&deps).unwrap()),
                authorized_by: Set("c".into()),
                via: Set("user".into()),
                auth_tag: Set(tag),
                auth_state: Set(auth::AuthState::Ok),
                updated_at: Set(now),
            },
        )
        .await
        .unwrap();
        let mut renamed: secret_rows::ActiveModel = secret.into();
        renamed.name = Set("NEW".into());
        renamed.update(conn).await.unwrap();

        let target = ToolsetRespell;
        assert!(
            respell::respell_consumer(org, CONSUMER, &id, &target, &key)
                .await
                .unwrap()
        );
        let row = org_ai_toolsets::get(org, &id).await.unwrap().unwrap();
        assert_eq!(
            parse_data(&row).unwrap()["headers"]["A"],
            "Bearer {{secrets.NEW}}"
        );
        let signed = auth::get_in(conn, org, CONSUMER.as_str(), &id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(signed.delivery_digest, digest);
        assert_eq!(signed.consumer_rev, 2);
        assert_eq!(signed.via, "system:respell");
    }
}
