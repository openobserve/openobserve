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
    sync::Arc,
};

use config::meta::secret_store::{
    ConsumerType, ORG_ENV_ID, SecretErrorCode, SecretKind, SecretState, SecretValue, StoreMode,
    ValueState,
    digest::{self, AuthTagInput, BoundRef, DepEntry, KAuth},
    grammar::{self, PinPattern, RefKind},
};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QuerySelect,
    sea_query::Expr,
};
use serde_json::Value;
use zeroize::Zeroizing;

use super::{
    cache::{Allowlist, ValueKey, allowlist_cache, allows, value_cache},
    external::{self, readiness},
    mode,
    redact::Redactor,
};
use crate::{
    secrets::{self, SecretOwnerKind},
    table::{
        cipher,
        credential_values::{NamedValueAd, NamedValueClass, SlotClass},
        org_secret_consumers, org_secret_values as values, org_secrets as policy, secret_aliases,
        secret_consumer_auth as auth, secret_refs, synthetics_environments,
    },
};

// A warm local value still needs a current credential owned by its head and source class.
const OWNED_REFERENCE: &str = "(SELECT c.secret_ref FROM credential_values c
    WHERE c.org_id = org_secret_values.org_id AND c.secret_ref = org_secret_values.value_ref
    AND c.state = 'current' AND c.owner_id = org_secret_values.id AND c.owner_kind = CASE
    WHEN org_secret_values.backend_id IS NULL THEN 'org_secret' ELSE 'org_secret_pointer' END)";

/// Dependency entries and substituted URLs must come from the same primary read used to build the
/// request.
pub struct Snapshot {
    pub org_id: String,
    pub consumer_type: ConsumerType,
    pub consumer_id: String,
    pub stored: Value,
    pub keyed_pointers: Vec<String>,
    pub slot_pointers: Vec<String>,
    pub request_urls: Vec<RequestUrl>,
    pub write_only_names: Vec<String>,
    pub deps: BTreeMap<String, Vec<DepEntry>>,
    pub env_id: String,
    pub job: Option<SyntheticsJob>,
}

/// A job with a missing incarnation cannot use an environment-scoped snapshot.
pub struct SyntheticsJob {
    pub env_incarnation: Option<String>,
    pub leased_by_agent: bool,
}

pub struct RequestUrl {
    pub field: String,
    pub substituted: String,
    pub store_dependency_ids: Vec<String>,
}

pub struct Resolved {
    pub redactor: Redactor,
    values: BTreeMap<String, BTreeMap<String, Arc<SecretValue>>>,
    /// `None` for a synthetics check: its runner fills `{{vars.*}}` from the check's own tiers.
    vars: Option<BTreeMap<String, Arc<SecretValue>>>,
    bound: Vec<policy::Model>,
}

impl Resolved {
    /// The active policy rows of the bound secrets as this attempt checked them, in id order.
    pub fn bound_policies(&self) -> &[policy::Model] {
        &self.bound
    }

    /// After a rename, the same spelling in two fields can bind different immutable IDs.
    pub fn substitute_slot(&self, field: &str, text: &str) -> Result<SecretValue, SecretErrorCode> {
        replace_tokens(text, self.vars.as_ref(), |name| {
            self.values.get(field)?.get(name)
        })
    }

    pub fn value(&self, field: &str, name: &str) -> Option<&Arc<SecretValue>> {
        self.values.get(field)?.get(name)
    }

    /// The store variable value for `{{vars.<name>}}`, read with the value revision the
    /// consumer's dependency digest signed.
    pub fn var(&self, name: &str) -> Option<&Arc<SecretValue>> {
        self.vars.as_ref()?.get(name)
    }
}

/// A validated binding set whose values are not read yet.
pub struct Plan {
    refs: Vec<BoundRef>,
    policies: Vec<policy::Model>,
    dependencies: Vec<policy::Model>,
    vars: Option<BTreeMap<String, VarBinding>>,
}

impl Plan {
    /// The active policy rows `materialize` will read, in id order.
    pub fn bound_policies(&self) -> &[policy::Model] {
        &self.policies
    }

    /// The bound rows plus the store variables the consumer depends on: the sender's Use set.
    pub fn checked_policies(&self) -> impl Iterator<Item = &policy::Model> {
        self.policies.iter().chain(&self.dependencies)
    }
}

struct VarBinding {
    row: policy::Model,
    signed_value_rev: String,
}

struct ResolveEnv {
    refs_enabled: bool,
    mode: StoreMode,
}

pub async fn resolve<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
) -> Result<Resolved, SecretErrorCode> {
    let env = ResolveEnv {
        refs_enabled: config::get_config().common.secret_store_refs_enabled,
        mode: mode::mode(),
    };
    resolve_with(conn, env, snapshot).await
}

/// Every check `resolve` runs, without reading or fetching a value.
pub async fn plan<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
) -> Result<Plan, SecretErrorCode> {
    let env = ResolveEnv {
        refs_enabled: config::get_config().common.secret_store_refs_enabled,
        mode: mode::mode(),
    };
    plan_with(conn, env, snapshot).await
}

/// Reads and decrypts exactly the set `plan` validated, so a caller can authorize that set first.
pub async fn materialize<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
    plan: Plan,
) -> Result<Resolved, SecretErrorCode> {
    let Plan {
        refs,
        policies,
        vars: var_bindings,
        ..
    } = plan;
    let mut read_ids: BTreeSet<_> = policies.iter().map(|row| row.id.as_str()).collect();
    read_ids.extend(
        var_bindings
            .iter()
            .flatten()
            .map(|(_, b)| b.row.id.as_str()),
    );
    let effective = effective_values(conn, snapshot, &read_ids).await?;
    let mut by_id = BTreeMap::new();
    for row in &policies {
        let value = effective
            .get(row.id.as_str())
            .ok_or(SecretErrorCode::SecretUnset)?;
        by_id.insert(row.id.clone(), decrypt(conn, row, value).await?);
    }
    let vars = match &var_bindings {
        Some(bindings) => Some(var_values(conn, bindings, &effective).await?),
        None => None,
    };
    let redactor = Redactor::for_attempt(by_id.values().map(|v| v.as_str()));
    let mut resolved = Resolved {
        redactor,
        values: BTreeMap::new(),
        vars,
        bound: policies,
    };
    for binding in refs {
        let value = by_id
            .get(binding.secret_id.as_str())
            .ok_or(SecretErrorCode::SecretUnavailable)?;
        resolved
            .values
            .entry(binding.field)
            .or_default()
            .insert(binding.token_name, value.clone());
    }
    Ok(resolved)
}

pub fn substitute(text: &str, resolved: &Resolved) -> Result<SecretValue, SecretErrorCode> {
    replace_tokens(text, resolved.vars.as_ref(), |name| {
        let mut matches = resolved.values.values().filter_map(|slot| slot.get(name));
        let first = matches.next()?;
        matches
            .all(|value| Arc::ptr_eq(value, first))
            .then_some(first)
    })
}

/// Each name's live row, else the row its unexpired alias names; the lookup saves and resolves
/// share, in at most three statements however many names.
pub async fn named_policies_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    names: &BTreeSet<String>,
) -> Result<BTreeMap<String, policy::Model>, crate::errors::Error> {
    if names.is_empty() {
        return Ok(BTreeMap::new());
    }
    let mut rows: BTreeMap<_, _> = policy::Entity::find()
        .filter(policy::Column::OrgId.eq(org_id))
        .filter(policy::Column::Name.is_in(names.iter().map(String::as_str)))
        .filter(policy::Column::State.is_in(policy::LIVE_STATES))
        .all(conn)
        .await?
        .into_iter()
        .map(|row| (row.name.clone(), row))
        .collect();
    let missing: Vec<_> = names
        .iter()
        .filter(|name| !rows.contains_key(*name))
        .map(String::as_str)
        .collect();
    if missing.is_empty() {
        return Ok(rows);
    }
    let aliases = secret_aliases::Entity::find()
        .filter(secret_aliases::Column::OrgId.eq(org_id))
        .filter(secret_aliases::Column::Name.is_in(missing))
        .filter(secret_aliases::Column::ExpiresAt.gt(config::utils::time::now_micros()))
        .all(conn)
        .await?;
    if aliases.is_empty() {
        return Ok(rows);
    }
    let by_id: BTreeMap<_, _> = policy::Entity::find()
        .filter(policy::Column::OrgId.eq(org_id))
        .filter(policy::Column::Id.is_in(aliases.iter().map(|a| a.secret_id.as_str())))
        .all(conn)
        .await?
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect();
    for alias in aliases {
        if let Some(row) = by_id.get(&alias.secret_id) {
            rows.insert(alias.name, row.clone());
        }
    }
    Ok(rows)
}

pub fn is_draft_with_store_ref(delivery_fields: &[&str]) -> Result<(), SecretErrorCode> {
    if delivery_fields
        .iter()
        .any(|text| grammar::has_secret_ref(text))
    {
        return Err(SecretErrorCode::SaveBeforeTest);
    }
    Ok(())
}

async fn resolve_with<C: ConnectionTrait>(
    conn: &C,
    env: ResolveEnv,
    snapshot: &Snapshot,
) -> Result<Resolved, SecretErrorCode> {
    let plan = plan_with(conn, env, snapshot).await?;
    materialize(conn, snapshot, plan).await
}

async fn plan_with<C: ConnectionTrait>(
    conn: &C,
    env: ResolveEnv,
    snapshot: &Snapshot,
) -> Result<Plan, SecretErrorCode> {
    if !env.refs_enabled || env.mode != StoreMode::SingleCluster {
        return Err(SecretErrorCode::StoreDisabled);
    }
    let refs = bindings(conn, snapshot).await?;
    let rows = read_policies(conn, snapshot, &refs).await?;
    let ids = bound_ids(snapshot, &refs);
    let policies = active_policies(&ids, &rows)?;
    let dep_ids: BTreeSet<_> = policy_ids(snapshot, &refs)
        .difference(&ids)
        .copied()
        .collect();
    let dependencies = active_policies(&dep_ids, &rows)?;
    for row in policies.iter().chain(&dependencies) {
        check_allowlist(conn, snapshot, row).await?;
    }
    check_auth(conn, snapshot, &refs).await?;
    check_urls(snapshot, &rows, !refs.is_empty())?;
    for row in &policies {
        check_pin(snapshot, row)?;
    }
    let vars = var_bindings(conn, snapshot).await?;
    Ok(Plan {
        refs,
        policies: policies.into_iter().cloned().collect(),
        dependencies: dependencies.into_iter().cloned().collect(),
        vars,
    })
}

async fn bindings<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
) -> Result<Vec<BoundRef>, SecretErrorCode> {
    let rows = secret_refs::list_for_consumer_in(
        conn,
        &snapshot.org_id,
        snapshot.consumer_type.as_str(),
        &snapshot.consumer_id,
    )
    .await
    .map_err(|_| SecretErrorCode::SecretUnavailable)?;
    let mut bound = BTreeSet::new();
    for row in &rows {
        if !bound.insert((&row.field, row.token_name.as_str())) {
            return Err(SecretErrorCode::SecretUnbound);
        }
    }
    for field in &snapshot.slot_pointers {
        let text = snapshot
            .stored
            .pointer(field)
            .and_then(Value::as_str)
            .ok_or(SecretErrorCode::SecretUnbound)?;
        for token in grammar::parse_refs(text)? {
            if token.kind == RefKind::Secret && !bound.contains(&(field, token.name.as_str())) {
                return Err(SecretErrorCode::SecretUnbound);
            }
        }
    }
    Ok(rows
        .into_iter()
        .map(|row| BoundRef {
            field: row.field,
            token_name: row.token_name,
            secret_id: row.secret_id,
        })
        .collect())
}

fn bound_ids<'a>(snapshot: &'a Snapshot, refs: &'a [BoundRef]) -> BTreeSet<&'a str> {
    refs.iter()
        .map(|row| row.secret_id.as_str())
        .chain(
            snapshot
                .request_urls
                .iter()
                .flat_map(|url| url.store_dependency_ids.iter().map(String::as_str)),
        )
        .collect()
}

fn policy_ids<'a>(snapshot: &'a Snapshot, refs: &'a [BoundRef]) -> BTreeSet<&'a str> {
    bound_ids(snapshot, refs)
        .into_iter()
        .chain(
            snapshot
                .deps
                .get(&snapshot.env_id)
                .into_iter()
                .flatten()
                .filter_map(|entry| match entry {
                    DepEntry::Store { secret_id, .. } => Some(secret_id.as_str()),
                    _ => None,
                }),
        )
        .collect()
}

async fn read_policies<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
    refs: &[BoundRef],
) -> Result<BTreeMap<String, policy::Model>, SecretErrorCode> {
    let ids = policy_ids(snapshot, refs);
    let rows = policy::Entity::find()
        .filter(policy::Column::OrgId.eq(&snapshot.org_id))
        .filter(policy::Column::Id.is_in(ids))
        .all(conn)
        .await
        .map_err(|_| SecretErrorCode::SecretUnavailable)?;
    Ok(rows.into_iter().map(|row| (row.id.clone(), row)).collect())
}

fn active_policies<'a>(
    ids: &BTreeSet<&str>,
    rows: &'a BTreeMap<String, policy::Model>,
) -> Result<Vec<&'a policy::Model>, SecretErrorCode> {
    ids.iter()
        .map(|id| {
            let row = rows.get(*id).ok_or(SecretErrorCode::SecretMissing)?;
            match row
                .state
                .parse::<SecretState>()
                .map_err(|_| SecretErrorCode::SecretUnavailable)?
            {
                SecretState::Active => Ok(row),
                SecretState::Purged => Err(SecretErrorCode::SecretMissing),
                SecretState::Deleted => Err(SecretErrorCode::SecretDeleted),
                SecretState::Conflict => Err(SecretErrorCode::SecretConflict),
            }
        })
        .collect()
}

async fn check_allowlist<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
    row: &policy::Model,
) -> Result<(), SecretErrorCode> {
    let cache = allowlist_cache();
    let entries = match cache.get(&row.org_id, &row.id, &row.policy_rev) {
        Some(entries) => entries,
        None => {
            let rows = org_secret_consumers::list_consumers_in(conn, &row.org_id, &row.id)
                .await
                .map_err(|_| SecretErrorCode::SecretUnavailable)?;
            // A policy write between the two reads would pair its allowlist with the old pin.
            let current = policy::get_secret_in(conn, &row.org_id, &row.id)
                .await
                .map_err(|_| SecretErrorCode::SecretUnavailable)?;
            if current.is_none_or(|current| current.policy_rev != row.policy_rev) {
                return Err(SecretErrorCode::SecretUnavailable);
            }
            let set: Allowlist = rows
                .into_iter()
                .map(|r| (r.consumer_type, r.consumer_id))
                .collect();
            let set = Arc::new(set);
            cache.insert(&row.org_id, &row.id, &row.policy_rev, set.clone());
            set
        }
    };
    if !allows(
        &entries,
        snapshot.consumer_type.as_str(),
        &snapshot.consumer_id,
    ) {
        return Err(SecretErrorCode::ConsumerNotAllowed);
    }
    Ok(())
}

async fn check_auth<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
    refs: &[BoundRef],
) -> Result<(), SecretErrorCode> {
    let stale = SecretErrorCode::DeliveryStale;
    let auth = auth::get_in(
        conn,
        &snapshot.org_id,
        snapshot.consumer_type.as_str(),
        &snapshot.consumer_id,
    )
    .await
    .map_err(|_| SecretErrorCode::SecretUnavailable)?
    .ok_or(stale)?;
    if auth.consumer_id != snapshot.consumer_id || auth.auth_state != auth::AuthState::Ok {
        return Err(stale);
    }
    let deps = digest::decode_dep_digests(&auth.dep_digests)?;
    let key = KAuth::derive(&org_dek(conn, &snapshot.org_id).await?);
    let input = AuthTagInput {
        org_id: &snapshot.org_id,
        consumer_type: snapshot.consumer_type,
        consumer_id: &snapshot.consumer_id,
        consumer_rev: auth.consumer_rev,
        refs,
        delivery_digest: &auth.delivery_digest,
        dep_digests: &deps,
    };
    if !key.verify_auth_tag(&input, &auth.auth_tag) {
        return Err(stale);
    }
    let delivery = digest::delivery_digest(
        snapshot.consumer_type,
        &snapshot.stored,
        &snapshot.keyed_pointers,
        &key,
        |field, name| {
            refs.iter()
                .find(|r| r.field == field && r.token_name == name)
                .map(|r| r.secret_id.clone())
        },
    )
    .map_err(|_| stale)?;
    let entries = snapshot.deps.get(&snapshot.env_id).ok_or(stale)?;
    if delivery != auth.delivery_digest
        || !digest::dep_digest_matches(
            &deps,
            &snapshot.env_id,
            &digest::dep_digest(entries).map_err(|_| stale)?,
        )
    {
        return Err(stale);
    }

    Ok(())
}

/// A cached DEK skips the per-org load lock, which only coalesces store reads.
async fn org_dek<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Zeroizing<Vec<u8>>, SecretErrorCode> {
    if let Some(dek) = cipher::cached_existing_dek(org_id) {
        return Ok(dek);
    }
    value_cache()
        .load_dek_coalesced(org_id, || async {
            cipher::get_existing_dek_in(conn, org_id)
                .await
                .map(|dek| dek.map(Zeroizing::new))
        })
        .await
        .map_err(|_| SecretErrorCode::SecretUnavailable)?
        .ok_or(SecretErrorCode::SecretUnavailable)
}

fn check_urls(
    snapshot: &Snapshot,
    rows: &BTreeMap<String, policy::Model>,
    has_refs: bool,
) -> Result<(), SecretErrorCode> {
    let stale = SecretErrorCode::DeliveryStale;
    let names: Vec<_> = snapshot
        .write_only_names
        .iter()
        .map(String::as_str)
        .collect();
    for url in &snapshot.request_urls {
        let raw = snapshot
            .stored
            .pointer(&url.field)
            .and_then(Value::as_str)
            .ok_or(stale)?;
        if has_refs {
            // A query can begin immediately after the host, without a slash.
            let before_query = raw.split(['?', '#']).next().unwrap_or(raw);
            grammar::check_request_url(before_query, false, true).map_err(|_| stale)?;
            let original = url::Url::parse(raw).map_err(|_| stale)?;
            let substituted = url::Url::parse(&url.substituted).map_err(|_| stale)?;
            if original[..url::Position::BeforePath] != substituted[..url::Position::BeforePath] {
                return Err(stale);
            }
        }
        if snapshot.consumer_type == ConsumerType::SyntheticsCheck {
            grammar::check_synthetics_url(raw, &names)?;
            for id in &url.store_dependency_ids {
                let row = rows.get(id).ok_or(stale)?;
                if row.kind != SecretKind::Variable.as_str() {
                    return Err(stale);
                }
            }
        }
    }
    Ok(())
}

fn check_pin(snapshot: &Snapshot, row: &policy::Model) -> Result<(), SecretErrorCode> {
    if row
        .kind
        .parse::<SecretKind>()
        .map_err(|_| SecretErrorCode::SecretUnavailable)?
        == SecretKind::Variable
    {
        return Ok(());
    }
    match row.pin_mode {
        policy::PinMode::None => return Err(SecretErrorCode::SecretPinRequired),
        policy::PinMode::Hosts => {
            if snapshot.request_urls.is_empty() {
                return Err(SecretErrorCode::PinMismatch);
            }
            let pins = row
                .allowed_hosts
                .lines()
                .map(PinPattern::parse)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| SecretErrorCode::PinMismatch)?;
            if !snapshot
                .request_urls
                .iter()
                .all(|url| grammar::all_match(&pins, &url.substituted))
            {
                return Err(SecretErrorCode::PinMismatch);
            }
        }
        policy::PinMode::Any | policy::PinMode::Legacy => {}
    }
    if snapshot.job.as_ref().is_some_and(|job| job.leased_by_agent)
        && row.private_locations != policy::PrivateLocations::On
    {
        return Err(SecretErrorCode::PrivateLocationRefused);
    }
    Ok(())
}

/// Maps each `{{vars.*}}` name in the slots to the active store variable that the verified
/// dependency digest signed; a name the digest does not carry is unbound.
async fn var_bindings<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
) -> Result<Option<BTreeMap<String, VarBinding>>, SecretErrorCode> {
    if snapshot.consumer_type == ConsumerType::SyntheticsCheck {
        return Ok(None);
    }
    let mut names = BTreeSet::new();
    for field in &snapshot.slot_pointers {
        let text = snapshot
            .stored
            .pointer(field)
            .and_then(Value::as_str)
            .ok_or(SecretErrorCode::SecretUnbound)?;
        names.extend(
            grammar::parse_refs(text)?
                .into_iter()
                .filter(|token| token.kind == RefKind::Var)
                .map(|token| token.name),
        );
    }
    let signed: BTreeMap<&str, &str> = snapshot
        .deps
        .get(&snapshot.env_id)
        .into_iter()
        .flatten()
        .filter_map(|entry| match entry {
            DepEntry::Store {
                secret_id,
                value_rev,
            } => Some((secret_id.as_str(), value_rev.as_str())),
            _ => None,
        })
        .collect();
    let mut rows = named_policies_in(conn, &snapshot.org_id, &names)
        .await
        .map_err(|_| SecretErrorCode::SecretUnavailable)?;
    let mut bindings = BTreeMap::new();
    for name in names {
        let row = rows
            .remove(&name)
            .filter(|row| {
                row.state == SecretState::Active.as_str()
                    && row.kind == SecretKind::Variable.as_str()
            })
            .ok_or(SecretErrorCode::SecretUnbound)?;
        let signed_value_rev = signed
            .get(row.id.as_str())
            .ok_or(SecretErrorCode::SecretUnbound)?
            .to_string();
        check_allowlist(conn, snapshot, &row).await?;
        bindings.insert(
            name,
            VarBinding {
                row,
                signed_value_rev,
            },
        );
    }
    Ok(Some(bindings))
}

/// A value read at a revision other than the signed one is stale: a value write must re-sign.
async fn var_values<C: ConnectionTrait>(
    conn: &C,
    bindings: &BTreeMap<String, VarBinding>,
    effective: &BTreeMap<String, values::Model>,
) -> Result<BTreeMap<String, Arc<SecretValue>>, SecretErrorCode> {
    let mut vars = BTreeMap::new();
    for (name, binding) in bindings {
        let value = effective
            .get(binding.row.id.as_str())
            .ok_or(SecretErrorCode::SecretUnset)?;
        if value.value_rev != binding.signed_value_rev {
            return Err(SecretErrorCode::DeliveryStale);
        }
        vars.insert(name.clone(), decrypt(conn, &binding.row, value).await?);
    }
    Ok(vars)
}

async fn effective_values<C: ConnectionTrait>(
    conn: &C,
    snapshot: &Snapshot,
    ids: &BTreeSet<&str>,
) -> Result<BTreeMap<String, values::Model>, SecretErrorCode> {
    let mut scope = Condition::any().add(
        values::Column::EnvId
            .eq(ORG_ENV_ID)
            .and(values::Column::EnvIncarnation.eq("")),
    );
    if snapshot.env_id == ORG_ENV_ID {
        if snapshot
            .job
            .as_ref()
            .and_then(|job| job.env_incarnation.as_deref())
            .is_some_and(|life| !life.is_empty())
        {
            return Err(SecretErrorCode::SecretUnset);
        }
    } else {
        let env = synthetics_environments::get_by_id(conn, &snapshot.org_id, &snapshot.env_id)
            .await
            .map_err(|_| SecretErrorCode::SecretUnavailable)?;
        let incarnation = env.map(|env| env.incarnation());
        if let Some(job) = &snapshot.job
            && (incarnation.is_none() || job.env_incarnation != incarnation)
        {
            return Err(SecretErrorCode::SecretUnset);
        }
        if let Some(incarnation) = incarnation {
            scope = scope.add(
                values::Column::EnvId
                    .eq(&snapshot.env_id)
                    .and(values::Column::EnvIncarnation.eq(incarnation)),
            );
        }
    }
    let rows = values::Entity::find()
        .select_only()
        .columns(values::Column::iter().filter(|col| !matches!(col, values::Column::ValueRef)))
        .column_as(Expr::cust(OWNED_REFERENCE), values::Column::ValueRef)
        .filter(values::Column::OrgId.eq(&snapshot.org_id))
        .filter(values::Column::SecretId.is_in(ids.iter().copied()))
        .filter(scope)
        .all(conn)
        .await
        .map_err(|_| SecretErrorCode::SecretUnavailable)?;
    let mut org = BTreeMap::new();
    let mut overrides = BTreeMap::new();
    for row in rows {
        let scope = if row.env_id == ORG_ENV_ID {
            &mut org
        } else {
            &mut overrides
        };
        scope.insert(row.secret_id.clone(), row);
    }
    let mut selected = BTreeMap::new();
    for &id in ids {
        let row = match overrides.remove(id) {
            Some(row) if row.state != ValueState::Inherit.as_str() => Some(row),
            _ => org.remove(id),
        }
        .filter(|row| row.state == ValueState::Set.as_str())
        .ok_or(SecretErrorCode::SecretUnset)?;
        selected.insert(id.to_owned(), row);
    }
    Ok(selected)
}

async fn decrypt<C: ConnectionTrait>(
    conn: &C,
    policy: &policy::Model,
    value: &values::Model,
) -> Result<Arc<SecretValue>, SecretErrorCode> {
    let unavailable = SecretErrorCode::SecretUnavailable;
    let value_ref = value.value_ref.as_deref().ok_or(unavailable)?;
    let key = ValueKey {
        org_id: policy.org_id.clone(),
        secret_id: policy.id.clone(),
        effective_env_id: value.env_id.clone(),
        env_incarnation: value.env_incarnation.clone(),
        value_rev: value.value_rev.clone(),
        policy_rev: policy.policy_rev.clone(),
    };
    let kind = policy.kind.parse().map_err(|_| unavailable)?;
    let class = if value.backend_id.is_some() {
        if kind != SecretKind::Secret {
            return Err(unavailable);
        }
        NamedValueClass::OrgSecretPointer
    } else {
        NamedValueClass::OrgSecret
    };
    let slot = SlotClass::NamedValue(NamedValueAd {
        org_id: &policy.org_id,
        class,
        value_row_id: &value.id,
        secret_ref: value_ref,
        secret_id: &policy.id,
        kind,
        env_id: &value.env_id,
        env_incarnation: &value.env_incarnation,
        value_rev: &value.value_rev,
    });
    let resolved = if let Some(backend_id) = &value.backend_id {
        let pointer =
            external::pointer::open_pointer_in(conn, &policy.org_id, value_ref, &slot).await?;
        if &pointer.backend_id != backend_id {
            return Err(unavailable);
        }
        let ready = readiness::ready_in(conn, &policy.org_id, backend_id).await?;
        external::check_locator(&ready.backend, ready.kind, &pointer).map_err(|_| unavailable)?;
        external::cache::fetch_in(conn, key, &ready, &pointer).await?
    } else {
        value_cache()
            .get_or_fill(&key, || async {
                secrets::resolve_value_in(
                    conn,
                    &policy.org_id,
                    value_ref,
                    SecretOwnerKind::OrgSecret,
                    &value.id,
                    secrets::CURRENT,
                    &slot,
                )
                .await
                .map(|(_, value)| value)
                .map_err(|_| unavailable)
            })
            .await?
    };
    if resolved.is_empty() {
        return Err(SecretErrorCode::SecretUnset);
    }
    Ok(resolved)
}

fn replace_tokens<'a>(
    text: &str,
    vars: Option<&'a BTreeMap<String, Arc<SecretValue>>>,
    lookup: impl Fn(&str) -> Option<&'a Arc<SecretValue>>,
) -> Result<SecretValue, SecretErrorCode> {
    let mut result = Zeroizing::new(String::with_capacity(text.len()));
    let mut end = 0;
    for token in grammar::parse_refs(text)? {
        let value = match (token.kind, vars) {
            (RefKind::Secret, _) => lookup(&token.name),
            (RefKind::Var, Some(vars)) => vars.get(&token.name),
            (RefKind::Var, None) => continue,
        };
        result.push_str(&text[end..token.start]);
        result.push_str(value.ok_or(SecretErrorCode::SecretUnbound)?);
        end = token.end;
    }
    result.push_str(&text[end..]);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        path::Path,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use base64::{Engine, engine::general_purpose::STANDARD};
    use config::{
        ider::ksuid,
        meta::{
            organization::OrganizationType,
            secret_store::{
                ConsumerType, ORG_ENV_ID, SecretErrorCode as Code, SecretKind, SecretValue,
                StoreMode,
                digest::{self, AuthTagInput, BoundRef, DepEntry, KAuth},
                external::{
                    BackendKind, ExternalSecretBackend, FetchBudget, FetchError, Pointer,
                    ResolvedIdentity, VersionSelector,
                },
            },
        },
    };
    use sea_orm::{
        ActiveModelTrait, DatabaseBackend, DatabaseConnection, EntityTrait, IntoActiveModel,
        MockDatabase, Set,
    };
    use serde_json::json;

    use super::{
        RequestUrl, ResolveEnv, Resolved, Snapshot, is_draft_with_store_ref, org_dek, resolve_with,
        substitute,
    };
    use crate::{
        secret_store::{cache::allowlist_cache, gate::tests::isolated_store_test, mode},
        secrets::{self, CURRENT, SecretOwnerKind},
        table::{
            cipher,
            credential_values::{
                self as credentials, NamedValueAd, NamedValueClass, ProbeTokenAd, SecretRecord,
                SlotClass,
            },
            org_secret_consumers, org_secret_values as values,
            org_secrets::{self, PinMode},
            organizations, secret_backends, secret_consumer_auth as auth, secret_refs,
            synthetics_environments as envs,
            testing::unique,
        },
    };

    const FIELD: &str = "/headers/Authorization";
    const TOKEN: &str = "{{secrets.X}}";
    const URL: &str = "https://api.example.com/path";

    struct CountingBackend {
        fetches: AtomicUsize,
        conn: &'static DatabaseConnection,
        org: String,
    }

    #[async_trait::async_trait]
    impl ExternalSecretBackend for CountingBackend {
        fn kind(&self) -> BackendKind {
            BackendKind::AzureKv
        }

        async fn fetch(
            &self,
            pointer: &Pointer,
            _: &ResolvedIdentity,
            _: &FetchBudget,
        ) -> Result<SecretValue, FetchError> {
            if self.fetches.fetch_add(1, Ordering::Relaxed) == 0 {
                let mut backend =
                    secret_backends::get_in(self.conn, &self.org, &pointer.backend_id)
                        .await
                        .unwrap()
                        .unwrap()
                        .into_active_model();
                backend.backend_rev = Set(ksuid());
                backend.update(self.conn).await.unwrap();
            }
            Ok(SecretValue::new("fake backend value".into()))
        }
    }

    struct Fixture {
        conn: &'static DatabaseConnection,
        snapshot: Snapshot,
        row: org_secrets::Model,
        key: KAuth,
    }

    impl Fixture {
        async fn new(ty: ConsumerType) -> Option<Self> {
            if !secrets::sealed_value_test_store().await {
                return None;
            }
            let conn = credentials::client().await;
            let snapshot = snapshot(ty);
            let org = &snapshot.org_id;
            let key = KAuth::derive(&zeroize::Zeroizing::new(
                cipher::get_dek(org).await.unwrap(),
            ));
            let row = org_secrets::ActiveModel {
                id: Set(ksuid()),
                org_id: Set(org.clone()),
                name: Set("X".into()),
                kind: Set("secret".into()),
                state: Set("active".into()),
                description: Set(String::new()),
                allowed_hosts: Set("api.example.com".into()),
                pin_mode: Set(PinMode::Hosts),
                policy_rev: Set(ksuid()),
                policy_version: Set(1),
                created_by: Set("user".into()),
                updated_by: Set("user".into()),
                created_at: Set(1),
                updated_at: Set(1),
                ..Default::default()
            }
            .insert(conn)
            .await
            .unwrap();
            let fixture = Self {
                conn,
                snapshot,
                row,
                key,
            };
            fixture.bind().await;
            Some(fixture)
        }

        fn binding(&self) -> BoundRef {
            BoundRef {
                field: FIELD.into(),
                token_name: "X".into(),
                secret_id: self.row.id.clone(),
            }
        }

        async fn bind(&self) {
            let s = &self.snapshot;
            secret_refs::ActiveModel {
                id: Set(ksuid()),
                org_id: Set(s.org_id.clone()),
                consumer_type: Set(s.consumer_type.as_str().into()),
                consumer_id: Set(s.consumer_id.clone()),
                field: Set(FIELD.into()),
                secret_id: Set(self.row.id.clone()),
                token_name: Set("X".into()),
                created_at: Set(1),
            }
            .insert(self.conn)
            .await
            .unwrap();
            org_secret_consumers::ActiveModel {
                org_id: Set(s.org_id.clone()),
                secret_id: Set(self.row.id.clone()),
                consumer_type: Set(s.consumer_type.as_str().into()),
                consumer_id: Set(s.consumer_id.clone()),
                added_by: Set("user".into()),
                added_at: Set(1),
            }
            .insert(self.conn)
            .await
            .unwrap();
            self.sign().await;
        }

        async fn sign(&self) {
            let s = &self.snapshot;
            let delivery = digest::delivery_digest(
                s.consumer_type,
                &s.stored,
                &s.keyed_pointers,
                &self.key,
                |field, name| (field == FIELD && name == "X").then(|| self.row.id.clone()),
            )
            .unwrap();
            let deps = digest::dep_digests(&s.deps).unwrap();
            let tag = self.key.auth_tag(&AuthTagInput {
                org_id: &s.org_id,
                consumer_type: s.consumer_type,
                consumer_id: &s.consumer_id,
                consumer_rev: 1,
                refs: &[self.binding()],
                delivery_digest: &delivery,
                dep_digests: &deps,
            });
            auth::delete_in(
                self.conn,
                &s.org_id,
                s.consumer_type.as_str(),
                &s.consumer_id,
            )
            .await
            .unwrap();
            auth::ActiveModel {
                org_id: Set(s.org_id.clone()),
                consumer_type: Set(s.consumer_type.as_str().into()),
                consumer_id: Set(s.consumer_id.clone()),
                consumer_name: Set("test".into()),
                consumer_rev: Set(1),
                delivery_digest: Set(delivery),
                dep_digests: Set(digest::encode_dep_digests(&deps).unwrap()),
                authorized_by: Set("user".into()),
                via: Set("save".into()),
                auth_tag: Set(tag),
                auth_state: Set(auth::AuthState::Ok),
                updated_at: Set(1),
            }
            .insert(self.conn)
            .await
            .unwrap();
        }

        async fn authorize(&self) -> Result<Resolved, Code> {
            resolve_with(self.conn, enabled(), &self.snapshot).await
        }

        async fn expect_error(&self, code: Code) {
            assert_eq!(self.authorize().await.err(), Some(code));
        }

        async fn add_environment(&mut self) -> String {
            let mut env = envs::SyntheticsEnvironmentRecord {
                id: ksuid(),
                name: "prod".into(),
                org_id: self.snapshot.org_id.clone(),
                description: String::new(),
                owner: None,
                is_global: false,
                created_at: 1,
                updated_at: 1,
            };
            envs::add(self.conn, &mut env).await.unwrap();
            self.snapshot.env_id.clone_from(&env.id);
            self.snapshot.deps.insert(env.id.clone(), vec![]);
            self.sign().await;
            env.incarnation()
        }

        async fn value(&self, env: &str, incarnation: &str, state: &str) -> values::Model {
            self.value_for(&self.row.id, env, incarnation, state).await
        }

        async fn value_for(
            &self,
            secret_id: &str,
            env: &str,
            incarnation: &str,
            state: &str,
        ) -> values::Model {
            values::ActiveModel {
                id: Set(ksuid()),
                secret_id: Set(secret_id.into()),
                org_id: Set(self.snapshot.org_id.clone()),
                env_id: Set(env.into()),
                env_incarnation: Set(incarnation.into()),
                state: Set(state.into()),
                value_ref: Set((state == "set").then(ksuid)),
                value_rev: Set(ksuid()),
                value_version: Set(1),
                updated_by: Set("user".into()),
                backend_id: Set(None),
            }
            .insert(self.conn)
            .await
            .unwrap()
        }

        async fn seal(&self, row: &values::Model, class: NamedValueClass, plaintext: &str) {
            seal_named(self.conn, row, SecretKind::Secret, class, plaintext).await;
        }

        /// An active store variable `name` with an org-scope value, plus its signed dependency.
        async fn variable(&mut self, name: &str, plaintext: &str) -> values::Model {
            let mut var = self.row.clone().into_active_model();
            var.id = Set(ksuid());
            var.name = Set(name.into());
            var.kind = Set("variable".into());
            let var = var.insert(self.conn).await.unwrap();
            org_secret_consumers::ActiveModel {
                org_id: Set(self.snapshot.org_id.clone()),
                secret_id: Set(var.id.clone()),
                consumer_type: Set(self.snapshot.consumer_type.as_str().into()),
                consumer_id: Set(self.snapshot.consumer_id.clone()),
                added_by: Set("owner".into()),
                added_at: Set(1),
            }
            .insert(self.conn)
            .await
            .unwrap();
            let head = self.value_for(&var.id, ORG_ENV_ID, "", "set").await;
            seal_named(
                self.conn,
                &head,
                SecretKind::Variable,
                NamedValueClass::OrgSecret,
                plaintext,
            )
            .await;
            self.snapshot
                .deps
                .get_mut(ORG_ENV_ID)
                .unwrap()
                .push(DepEntry::Store {
                    secret_id: var.id,
                    value_rev: head.value_rev.clone(),
                });
            head
        }

        async fn ready_pointer(&self) -> values::Model {
            let org = &self.row.org_id;
            organizations::add(org, org, OrganizationType::Custom)
                .await
                .unwrap();
            let backend = secret_backends::ActiveModel {
                id: Set(ksuid()),
                org_id: Set(org.clone()),
                kind: Set("azure_kv".into()),
                name: Set("fake".into()),
                config: Set("{}".into()),
                path_prefixes: Set(r#"["team"]"#.into()),
                auth_mode: Set("static".into()),
                cred_ref: Set(Some(ksuid())),
                credential_rev: Set(ksuid()),
                state: Set("active".into()),
                backend_rev: Set(ksuid()),
                ttl_secs: Set(300),
                stale_max_secs: Set(600),
                created_by: Set("user".into()),
                updated_by: Set("user".into()),
                created_at: Set(1),
                updated_at: Set(1),
                ..Default::default()
            }
            .insert(self.conn)
            .await
            .unwrap();
            super::readiness::record_pass_in(
                self.conn,
                org,
                &backend.id,
                &backend.backend_rev,
                &ResolvedIdentity::Static {
                    credential_rev: backend.credential_rev,
                },
            )
            .await
            .unwrap();
            let mut head = self.value(ORG_ENV_ID, "", "set").await.into_active_model();
            head.backend_id = Set(Some(backend.id.clone()));
            let head = head.update(self.conn).await.unwrap();
            let pointer = Pointer {
                backend_id: backend.id,
                locator: "team-x".into(),
                version_selector: VersionSelector::Latest,
                json_key: None,
            };
            self.seal(
                &head,
                NamedValueClass::OrgSecretPointer,
                &serde_json::to_string(&pointer).unwrap(),
            )
            .await;
            head
        }

        async fn copy_pointer_to_other_secret(
            &self,
            head: &values::Model,
        ) -> (org_secrets::Model, values::Model) {
            let mut other = self.row.clone().into_active_model();
            other.id = Set(ksuid());
            other.name = Set("Y".into());
            let other = other.insert(self.conn).await.unwrap();
            let reference = ksuid();
            let mut copy = head.clone().into_active_model();
            copy.id = Set(ksuid());
            copy.secret_id = Set(other.id.clone());
            copy.value_ref = Set(Some(reference.clone()));
            let copy = copy.insert(self.conn).await.unwrap();
            let mut cred = self.credential(head).await;
            cred.id = Set(ksuid());
            cred.secret_ref = Set(reference);
            cred.owner_id = Set(copy.id.clone());
            cred.insert(self.conn).await.unwrap();
            (other, copy)
        }

        async fn credential(
            &self,
            row: &values::Model,
        ) -> crate::table::entity::credential_values::ActiveModel {
            credentials::find_state(
                self.conn,
                &row.org_id,
                row.value_ref.as_deref().unwrap(),
                CURRENT,
            )
            .await
            .unwrap()
            .unwrap()
            .into_active_model()
        }

        async fn pin(&self, pin: PinMode, hosts: &str) {
            let mut row = self.row.clone().into_active_model();
            row.pin_mode = Set(pin);
            row.allowed_hosts = Set(hosts.into());
            row.update(self.conn).await.unwrap();
        }
    }

    fn snapshot(ty: ConsumerType) -> Snapshot {
        Snapshot {
            org_id: unique(&ksuid()),
            consumer_type: ty,
            consumer_id: ksuid(),
            stored: json!({"url":URL,"headers":{"Authorization":TOKEN}}),
            keyed_pointers: vec![],
            slot_pointers: vec![FIELD.into()],
            request_urls: vec![RequestUrl {
                field: "/url".into(),
                substituted: URL.into(),
                store_dependency_ids: vec![],
            }],
            write_only_names: vec![],
            deps: BTreeMap::from([(ORG_ENV_ID.into(), vec![])]),
            env_id: ORG_ENV_ID.into(),
            job: None,
        }
    }

    fn enabled() -> ResolveEnv {
        ResolveEnv {
            refs_enabled: true,
            mode: StoreMode::SingleCluster,
        }
    }

    fn record(org: &str, kind: &str, owner: &str, sref: &str, plaintext: &str) -> SecretRecord {
        SecretRecord {
            id: ksuid(),
            secret_ref: sref.into(),
            org_id: org.into(),
            owner_kind: kind.into(),
            owner_id: owner.into(),
            purpose: "auth".into(),
            key_id: None,
            state: CURRENT.into(),
            value: plaintext.to_owned().into(),
            last_verified_at: None,
            grace_expires_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    async fn seal(conn: &DatabaseConnection, record: &SecretRecord, slot: &SlotClass<'_>) {
        let row = credentials::encrypted_active_model(record, slot)
            .await
            .unwrap();
        credentials::insert(conn, row).await.unwrap();
    }

    async fn seal_named(
        conn: &DatabaseConnection,
        row: &values::Model,
        kind: SecretKind,
        class: NamedValueClass,
        plaintext: &str,
    ) {
        let sref = row.value_ref.as_ref().unwrap();
        let record = record(&row.org_id, class.owner_kind(), &row.id, sref, plaintext);
        let slot = SlotClass::NamedValue(NamedValueAd {
            org_id: &row.org_id,
            class,
            value_row_id: &row.id,
            secret_ref: sref,
            secret_id: &row.secret_id,
            kind,
            env_id: &row.env_id,
            env_incarnation: &row.env_incarnation,
            value_rev: &row.value_rev,
        });
        seal(conn, &record, &slot).await;
    }

    fn count_value_queries(conn: &DatabaseConnection) -> (DatabaseConnection, Arc<AtomicUsize>) {
        let mut observed = match conn {
            DatabaseConnection::SqlxSqlitePoolConnection(pool) => {
                DatabaseConnection::SqlxSqlitePoolConnection(pool.clone())
            }
            DatabaseConnection::SqlxPostgresPoolConnection(pool) => {
                DatabaseConnection::SqlxPostgresPoolConnection(pool.clone())
            }
            _ => panic!("expected a meta-store pool"),
        };
        let reads = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&reads);
        observed.set_metric_callback(move |info| {
            if info.statement.sql.contains("org_secret_values") {
                count.fetch_add(1, Ordering::Relaxed);
            }
        });
        (observed, reads)
    }

    #[test]
    fn check_0_disabled_before_any_read() {
        isolated_store_test(
            "secret_store::resolver::tests::check_0_disabled_before_any_read",
            async {
                let conn = MockDatabase::new(DatabaseBackend::Sqlite).into_connection();
                let s = snapshot(ConsumerType::AlertDestination);
                let switch_off = ResolveEnv {
                    refs_enabled: false,
                    ..enabled()
                };
                assert_eq!(
                    resolve_with(&conn, switch_off, &s).await.err(),
                    Some(Code::StoreDisabled)
                );
                mode::set_super_cluster(true, "b");
                let super_cluster = ResolveEnv {
                    mode: mode::mode(),
                    ..enabled()
                };
                let result = resolve_with(&conn, super_cluster, &s).await;
                mode::set_super_cluster(false, "b");
                assert_eq!(result.err(), Some(Code::StoreDisabled));
                assert!(conn.into_transaction_log().is_empty());
            },
        );
    }

    #[tokio::test]
    async fn empty_decrypted_secret_refuses_delivery_instead_of_sending_empty() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let head = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&head, NamedValueClass::OrgSecret, "").await;
        f.expect_error(Code::SecretUnset).await;
    }

    #[tokio::test]
    async fn check_1_ref_must_be_bound_in_its_slot() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let refs = secret_refs::list_for_consumer_in(
            f.conn,
            &f.snapshot.org_id,
            f.snapshot.consumer_type.as_str(),
            &f.snapshot.consumer_id,
        )
        .await
        .unwrap();
        let mut wrong_slot = refs.into_iter().next().unwrap().into_active_model();
        wrong_slot.field = Set("/elsewhere".into());
        wrong_slot.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnbound).await;
    }

    #[tokio::test]
    async fn check_2_missing_deleted_or_conflicted_precedes_no_value() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        for (state, code) in [
            ("deleted", Code::SecretDeleted),
            ("conflict", Code::SecretConflict),
            ("purged", Code::SecretMissing),
        ] {
            let mut row = f.row.clone().into_active_model();
            row.state = Set(state.into());
            row.update(f.conn).await.unwrap();
            f.expect_error(code).await;
        }
        org_secrets::Entity::delete_by_id(f.row.id.clone())
            .exec(f.conn)
            .await
            .unwrap();
        f.expect_error(Code::SecretMissing).await;
    }

    #[tokio::test]
    async fn check_3_old_policy_rev_never_authorizes() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let s = &f.snapshot;
        let allow = [(s.consumer_type.as_str().into(), s.consumer_id.clone())]
            .into_iter()
            .collect();
        allowlist_cache().insert(&s.org_id, &f.row.id, &f.row.policy_rev, Arc::new(allow));
        let mut row = f.row.clone().into_active_model();
        row.policy_rev = Set(ksuid());
        row.update(f.conn).await.unwrap();
        org_secret_consumers::Entity::delete_by_id((
            f.row.id.clone(),
            s.consumer_type.as_str().to_owned(),
            s.consumer_id.clone(),
        ))
        .exec(f.conn)
        .await
        .unwrap();
        f.expect_error(Code::ConsumerNotAllowed).await;
    }

    #[tokio::test]
    async fn t11_cold_allowlist_read_never_pairs_with_an_older_policy_rev() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let stale = f.row.clone();
        let mut row = f.row.clone().into_active_model();
        row.policy_rev = Set(ksuid());
        row.update(f.conn).await.unwrap();
        assert_eq!(
            super::check_allowlist(f.conn, &f.snapshot, &stale).await,
            Err(Code::SecretUnavailable)
        );
        let s = &f.snapshot;
        assert!(
            allowlist_cache()
                .get(&s.org_id, &stale.id, &stale.policy_rev)
                .is_none()
        );
    }

    #[tokio::test]
    async fn check_4_auth_dep_digest_and_tag_must_verify() {
        let Some(mut f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        f.snapshot.stored["extra"] = json!(true);
        f.expect_error(Code::DeliveryStale).await;
        f.snapshot.stored.as_object_mut().unwrap().remove("extra");
        f.snapshot
            .deps
            .get_mut(ORG_ENV_ID)
            .unwrap()
            .push(DepEntry::Absent {
                name: "missing".into(),
            });
        f.expect_error(Code::DeliveryStale).await;
        f.snapshot.deps.get_mut(ORG_ENV_ID).unwrap().clear();
        let s = &f.snapshot;
        let original = auth::get_in(f.conn, &s.org_id, s.consumer_type.as_str(), &s.consumer_id)
            .await
            .unwrap()
            .unwrap();
        for edit in ["env", "tag", "state"] {
            let mut row = original.clone().into_active_model();
            match edit {
                "env" => {
                    row.dep_digests = Set("{}".into());
                    row.auth_tag = Set(f.key.auth_tag(&AuthTagInput {
                        org_id: &s.org_id,
                        consumer_type: s.consumer_type,
                        consumer_id: &s.consumer_id,
                        consumer_rev: original.consumer_rev,
                        refs: &[f.binding()],
                        delivery_digest: &original.delivery_digest,
                        dep_digests: &BTreeMap::new(),
                    }));
                }
                "tag" => row.auth_tag = Set("00".repeat(32)),
                _ => row.auth_state = Set(auth::AuthState::Stale),
            }
            row.update(f.conn).await.unwrap();
            f.expect_error(Code::DeliveryStale).await;
            original
                .clone()
                .into_active_model()
                .reset_all()
                .update(f.conn)
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn check_4_synthetics_url_dependency_cannot_be_secret() {
        let Some(mut f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        f.snapshot.stored["url"] = json!("https://api.example.com/path?q={{LOOKUP}}");
        f.snapshot
            .deps
            .get_mut(ORG_ENV_ID)
            .unwrap()
            .push(DepEntry::Store {
                secret_id: f.row.id.clone(),
                value_rev: ksuid(),
            });
        f.snapshot.request_urls[0]
            .store_dependency_ids
            .push(f.row.id.clone());
        f.sign().await;
        f.expect_error(Code::DeliveryStale).await;
    }

    #[tokio::test]
    async fn check_4_urls_keep_literal_authorities_and_refuse_write_only_placeholders() {
        let Some(mut f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        f.snapshot.write_only_names.push("BROWSER_KEY".into());
        for (raw, code) in [
            ("https://api.example.com?key={{vars.X}}", Code::SecretUnset),
            ("https://{{HOST}}/path", Code::DeliveryStale),
            ("https://elsewhere.example/path", Code::DeliveryStale),
            (
                "https://api.example.com?key={{_AUTH_TOKEN}}",
                Code::RefNotAllowedInField,
            ),
            (
                "https://api.example.com/{{BROWSER_KEY}}",
                Code::RefNotAllowedInField,
            ),
        ] {
            f.snapshot.stored["url"] = json!(raw);
            f.sign().await;
            f.expect_error(code).await;
        }
    }

    #[tokio::test]
    async fn check_5_pin_and_private_location_precede_value_read() {
        let Some(mut f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        let (observed, reads) = count_value_queries(f.conn);
        for (pin, hosts, leased, code) in [
            (PinMode::None, "", false, Code::SecretPinRequired),
            (
                PinMode::Hosts,
                "other.example.com",
                false,
                Code::PinMismatch,
            ),
            (PinMode::Any, "", true, Code::PrivateLocationRefused),
        ] {
            f.pin(pin, hosts).await;
            f.snapshot.job = Some(super::SyntheticsJob {
                env_incarnation: None,
                leased_by_agent: leased,
            });
            assert_eq!(
                resolve_with(&observed, enabled(), &f.snapshot).await.err(),
                Some(code)
            );
            assert_eq!(reads.load(Ordering::Relaxed), 0);
        }
        f.snapshot.job = None;
        for pin in [PinMode::Any, PinMode::Legacy, PinMode::Hosts] {
            f.pin(pin, "api.example.com").await;
            assert_eq!(
                resolve_with(&observed, enabled(), &f.snapshot).await.err(),
                Some(Code::SecretUnset)
            );
        }
        assert_eq!(reads.load(Ordering::Relaxed), 3);
    }

    #[tokio::test]
    async fn hosts_pinned_secret_requires_request_urls() {
        let Some(mut f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        f.snapshot.request_urls.clear();
        f.expect_error(Code::PinMismatch).await;
    }

    #[tokio::test]
    async fn check_6_effective_environment_value_and_incarnation() {
        let Some(mut f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        let incarnation = f.add_environment().await;
        let env = f.snapshot.env_id.clone();
        f.value(&env, "past-incarnation", "set").await;
        f.expect_error(Code::SecretUnset).await;
        let org_row = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&org_row, NamedValueClass::OrgSecret, "org").await;
        let env_row = f.value(&env, &incarnation, "inherit").await;
        assert!(
            substitute(TOKEN, &f.authorize().await.unwrap())
                .unwrap()
                .as_str()
                == "org"
        );
        let mut unset = env_row.into_active_model();
        unset.state = Set("unset".into());
        let unset = unset.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnset).await;
        let mut set = unset.into_active_model();
        set.state = Set("set".into());
        set.value_ref = Set(Some(ksuid()));
        set.value_rev = Set(ksuid());
        let set = set.update(f.conn).await.unwrap();
        f.seal(&set, NamedValueClass::OrgSecret, "env").await;
        f.snapshot.job = Some(super::SyntheticsJob {
            env_incarnation: Some(incarnation),
            leased_by_agent: false,
        });
        assert!(
            substitute(TOKEN, &f.authorize().await.unwrap())
                .unwrap()
                .as_str()
                == "env"
        );
        f.snapshot.job.as_mut().unwrap().env_incarnation = None;
        f.expect_error(Code::SecretUnset).await;
        f.snapshot.job.as_mut().unwrap().env_incarnation = Some("earlier-life".into());
        f.expect_error(Code::SecretUnset).await;
    }

    #[tokio::test]
    async fn check_7_foreign_owner_refused_and_named_values_substitute_once() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let row = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&row, NamedValueClass::OrgSecretPointer, "pointer")
            .await;
        f.expect_error(Code::SecretUnavailable).await;
        let mut replacement = row.into_active_model();
        replacement.value_ref = Set(Some(ksuid()));
        replacement.value_rev = Set(ksuid());
        let replacement = replacement.update(f.conn).await.unwrap();
        let canary = "é/$ {{secrets.X}}";
        f.seal(&replacement, NamedValueClass::OrgSecret, canary)
            .await;
        let resolved = f.authorize().await.unwrap();
        let actual = substitute("π{{secrets.X}}/{{secrets.X}}", &resolved).unwrap();
        assert!(actual.as_str() == format!("π{canary}/{canary}"));
        assert!(resolved.redactor.redact(&actual) == "π[REDACTED]/[REDACTED]");
    }

    #[tokio::test]
    async fn t19_store_variables_substitute_at_the_signed_value_rev() {
        let Some(mut f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let secret = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&secret, NamedValueClass::OrgSecret, "s3cret").await;
        let text = "Bearer {{secrets.X}} {{vars.REGION}}";
        f.snapshot.stored["headers"]["Authorization"] = json!(text);
        f.sign().await;
        f.expect_error(Code::SecretUnbound).await;

        let head = f.variable("REGION", "eu-1").await;
        f.sign().await;
        let resolved = f.authorize().await.unwrap();
        let sent = resolved.substitute_slot(FIELD, text).unwrap();
        assert_eq!(sent.as_str(), "Bearer s3cret eu-1");
        assert_eq!(resolved.var("REGION").unwrap().as_str(), "eu-1");
        assert_eq!(substitute(text, &resolved).unwrap().as_str(), sent.as_str());
        assert_eq!(
            resolved.substitute_slot(FIELD, "{{vars.OTHER}}").err(),
            Some(Code::SecretUnbound)
        );

        let mut edited = head.into_active_model();
        edited.value_rev = Set(ksuid());
        edited.update(f.conn).await.unwrap();
        f.expect_error(Code::DeliveryStale).await;
    }

    #[tokio::test]
    async fn variable_dependencies_are_included_in_sender_use_checks() {
        let Some(mut f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        f.snapshot.stored["headers"]["Authorization"] = json!("{{secrets.X}} {{vars.REGION}}");
        let variable = f.variable("REGION", "eu-1").await;
        f.sign().await;
        let plan = super::plan_with(f.conn, enabled(), &f.snapshot)
            .await
            .unwrap();
        assert!(
            plan.checked_policies()
                .any(|row| row.id == variable.secret_id)
        );
        assert!(
            !plan
                .bound_policies()
                .iter()
                .any(|row| row.id == variable.secret_id)
        );
    }

    #[tokio::test]
    async fn variable_outside_its_allowlist_is_refused_at_resolve() {
        let Some(mut f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let secret = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&secret, NamedValueClass::OrgSecret, "secret").await;
        f.snapshot.stored["headers"]["Authorization"] = json!("{{secrets.X}} {{vars.REGION}}");
        let variable = f.variable("REGION", "eu-1").await;
        f.sign().await;
        org_secret_consumers::delete_for_secret_in(f.conn, &f.snapshot.org_id, &variable.secret_id)
            .await
            .unwrap();
        f.expect_error(Code::ConsumerNotAllowed).await;
    }

    #[tokio::test]
    async fn store_variables_share_name_reads_and_recheck_each_allowlist() {
        let Some(mut f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let secret = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&secret, NamedValueClass::OrgSecret, "s3cret").await;
        let text = "{{secrets.X}} {{vars.A}} {{vars.B}} {{vars.C}} {{vars.D}}";
        f.snapshot.stored["headers"]["Authorization"] = json!(text);
        for name in ["A", "B", "C", "D"] {
            f.variable(name, name).await;
        }
        f.sign().await;
        let mut observed = match f.conn {
            DatabaseConnection::SqlxPostgresPoolConnection(pool) => {
                DatabaseConnection::SqlxPostgresPoolConnection(pool.clone())
            }
            DatabaseConnection::SqlxSqlitePoolConnection(pool) => {
                DatabaseConnection::SqlxSqlitePoolConnection(pool.clone())
            }
            _ => panic!("expected a meta-store pool"),
        };
        let reads = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&reads);
        observed.set_metric_callback(move |info| {
            let sql = &info.statement.sql;
            if sql.contains(r#"FROM "org_secrets""#) || sql.contains(r#"FROM "secret_aliases""#) {
                count.fetch_add(1, Ordering::Relaxed);
            }
        });
        let resolved = resolve_with(&observed, enabled(), &f.snapshot)
            .await
            .unwrap();
        assert_eq!(
            substitute(text, &resolved).unwrap().as_str(),
            "s3cret A B C D"
        );
        // Each allowlist must be paired with its current policy revision before a value is read.
        assert_eq!(reads.load(Ordering::Relaxed), 7);
    }

    #[tokio::test]
    async fn t19_synthetics_leaves_vars_to_the_runner() {
        let Some(f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        let secret = f.value(ORG_ENV_ID, "", "set").await;
        f.seal(&secret, NamedValueClass::OrgSecret, "s").await;
        let resolved = f.authorize().await.unwrap();
        assert!(resolved.var("V").is_none());
        let sent = resolved
            .substitute_slot(FIELD, "{{secrets.X}}{{vars.V}}")
            .unwrap();
        assert_eq!(sent.as_str(), "s{{vars.V}}");
    }

    #[tokio::test]
    async fn d229_pointer_authentication_precedes_even_a_warm_cache() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let fake = Arc::new(CountingBackend {
            fetches: AtomicUsize::new(0),
            conn: f.conn,
            org: f.row.org_id.clone(),
        });
        super::external::register_backend(BackendKind::AzureKv, fake.clone());
        let head = f.ready_pointer().await;
        // The first fetch rotates the backend before its result can be installed.
        f.expect_error(Code::SecretUnavailable).await;
        let backend = super::readiness::test_target_in(
            f.conn,
            &f.row.org_id,
            head.backend_id.as_deref().unwrap(),
        )
        .await
        .unwrap();
        super::readiness::record_pass_in(
            f.conn,
            &f.row.org_id,
            &backend.backend.id,
            &backend.backend.backend_rev,
            &backend.identity,
        )
        .await
        .unwrap();
        let (first, second) = tokio::join!(f.authorize(), f.authorize());
        for result in [first, second] {
            assert!(result.unwrap().value(FIELD, "X").unwrap().as_str() == "fake backend value");
        }
        assert_eq!(fake.fetches.load(Ordering::Relaxed), 2);

        assert!(
            organizations::set_status_if_in(f.conn, &f.row.org_id, "active", "pending_deletion")
                .await
                .unwrap()
        );
        assert_eq!(
            organizations::get(&f.row.org_id).await.unwrap().status,
            "active"
        );
        f.expect_error(Code::SecretUnavailable).await;
        assert!(
            organizations::set_status_if_in(f.conn, &f.row.org_id, "pending_deletion", "active")
                .await
                .unwrap()
        );

        let mut wrong_backend = head.clone();
        wrong_backend.backend_id = Some(ksuid());
        assert!(matches!(
            super::decrypt(f.conn, &f.row, &wrong_backend).await,
            Err(Code::SecretUnavailable)
        ));
        let (other, copied) = f.copy_pointer_to_other_secret(&head).await;
        assert!(matches!(
            super::decrypt(f.conn, &other, &copied).await,
            Err(Code::SecretUnavailable)
        ));
        let mut variable = f.row.clone();
        variable.kind = "variable".into();
        assert!(matches!(
            super::decrypt(f.conn, &variable, &head).await,
            Err(Code::SecretUnavailable)
        ));

        let mut credential = f.credential(&head).await;
        // A same-length edit at the locator offset preserves the ciphertext envelope.
        let body = credential
            .ciphertext
            .as_ref()
            .strip_prefix(credentials::AD_PREFIX)
            .unwrap();
        let mut sealed = STANDARD.decode(body).unwrap();
        let prefix = format!(
            r#"{{"backend_id":"{}","locator":"team-"#,
            head.backend_id.as_ref().unwrap()
        );
        sealed[16 + prefix.len()] ^= b'x' ^ b'y';
        credential.ciphertext = Set(format!(
            "{}{}",
            credentials::AD_PREFIX,
            STANDARD.encode(sealed)
        ));
        credential.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnavailable).await;
        assert_eq!(fake.fetches.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn d229_owner_and_ad_class_swaps_refuse_both_sources() {
        let Some(f) = Fixture::new(ConsumerType::AlertDestination).await else {
            return;
        };
        let head = f.ready_pointer().await;
        let mut pointer = f.credential(&head).await;
        pointer.owner_kind = Set(NamedValueClass::OrgSecret.owner_kind().into());
        pointer.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnavailable).await;
        let mut head = head.into_active_model();
        head.backend_id = Set(None);
        let local = head.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnavailable).await;

        let mut local = local.into_active_model();
        local.value_rev = Set(ksuid());
        local.value_ref = Set(Some(ksuid()));
        let local = local.update(f.conn).await.unwrap();
        f.seal(&local, NamedValueClass::OrgSecret, "local").await;
        let _warm = f.authorize().await.unwrap();
        let mut cred = f.credential(&local).await;
        cred.owner_kind = Set(NamedValueClass::OrgSecretPointer.owner_kind().into());
        cred.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnavailable).await;
        let mut local = local.into_active_model();
        local.backend_id = Set(Some(ksuid()));
        local.update(f.conn).await.unwrap();
        f.expect_error(Code::SecretUnavailable).await;
    }

    #[tokio::test]
    async fn d230_probe_token_still_resolves_with_store_disabled() {
        let Some(f) = Fixture::new(ConsumerType::SyntheticsCheck).await else {
            return;
        };
        let off = ResolveEnv {
            refs_enabled: false,
            ..enabled()
        };
        assert_eq!(
            resolve_with(f.conn, off, &f.snapshot).await.err(),
            Some(Code::StoreDisabled)
        );
        let owner = ksuid();
        let sref = ksuid();
        let probe = record(
            &f.snapshot.org_id,
            SecretOwnerKind::ProbeToken.as_str(),
            &owner,
            &sref,
            "probe-canary",
        );
        let slot = SlotClass::ProbeToken(ProbeTokenAd {
            org_id: &probe.org_id,
            token_id: &owner,
            secret_ref: &sref,
            token_sha256: "signed-hash",
        });
        seal(f.conn, &probe, &slot).await;
        let (_, value) = secrets::resolve_value_in(
            f.conn,
            &probe.org_id,
            &sref,
            SecretOwnerKind::ProbeToken,
            &owner,
            CURRENT,
            &slot,
        )
        .await
        .unwrap();
        assert!(value.as_str() == "probe-canary");
    }

    #[tokio::test]
    async fn d29_draft_with_store_refs_refuses_before_any_read() {
        let conn = MockDatabase::new(DatabaseBackend::Sqlite).into_connection();
        let s = snapshot(ConsumerType::AlertDestination);
        for fields in [
            vec!["https://example.com", TOKEN],
            vec!["https://example.com/{{secrets.X}}"],
        ] {
            let result = async {
                is_draft_with_store_ref(&fields)?;
                resolve_with(&conn, enabled(), &s).await
            }
            .await;
            assert_eq!(result.err(), Some(Code::SaveBeforeTest));
        }
        assert!(conn.into_transaction_log().is_empty());
        assert_eq!(
            is_draft_with_store_ref(&["https://example.com", "literal"]),
            Ok(())
        );
    }

    #[test]
    fn d253_store_modules_read_the_primary() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/secret_store");
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|extension| extension != "rs") {
                continue;
            }
            let source = fs::read_to_string(&path).unwrap();
            let production = source
                .split_once("\n#[cfg(test)]\nmod tests {")
                .or_else(|| source.split_once("\n#[cfg(test)]\npub(super) mod tests {"))
                .map_or(source.as_str(), |(code, _)| code);
            assert!(
                !production.contains("get_orm_client_ro"),
                "{}",
                path.display()
            );
        }
    }

    #[tokio::test]
    async fn a_cached_dek_skips_the_org_load_lock() {
        let org = unique("dek_lock");
        cipher::cache_dek_for_tests(&org, vec![7; 32]);
        let holder = org.clone();
        let (held, wait_held) = tokio::sync::oneshot::channel();
        let blocker = tokio::spawn(async move {
            crate::secret_store::cache::value_cache()
                .load_dek_coalesced(&holder, || async {
                    let _ = held.send(());
                    std::future::pending::<Result<Option<zeroize::Zeroizing<Vec<u8>>>, ()>>().await
                })
                .await
        });
        wait_held.await.unwrap();
        let conn = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let dek = tokio::time::timeout(std::time::Duration::from_secs(1), org_dek(&conn, &org))
            .await
            .expect("a cache hit never waits on a stuck load")
            .unwrap();
        blocker.abort();
        assert_eq!(*dek, vec![7; 32]);
    }
}
