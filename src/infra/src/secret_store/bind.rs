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
    future::Future,
};

use config::{
    get_config, ider,
    meta::secret_store::{
        BindRef, BindRequest, ConsumerType, GateState, SecretErrorCode,
        digest::{self, AuthTagInput, BoundRef, DepDigests, KAuth},
        grammar::{PinPattern, all_match, parse_pins},
    },
    utils::time::now_micros,
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseTransaction, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, sea_query::LockType,
};
use url::Url;

use super::{gate, metadata, mode, reauthorize::ConsumerImage};
use crate::{
    errors::Error,
    table::{
        org_secret_consumers::{self as consumers, ANY_CONSUMER},
        org_secret_values::{self as values, ORG_ENV},
        org_secrets::{self, PinMode},
        secret_consumer_auth::{self as auth, AuthState},
        secret_dependencies, secret_refs,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum StrictVerb {
    Use,
    Manage,
    AccessPut,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BindPin {
    Keep,
    Hosts(Vec<String>),
}

#[derive(Clone, Debug)]
pub struct SecretBindOption {
    pub secret_id: String,
    pub allow_this_consumer: bool,
    pub pin: BindPin,
    pub expected_policy_rev: String,
}

impl SecretBindOption {
    fn changes_policy(&self) -> bool {
        self.allow_this_consumer || self.pin != BindPin::Keep
    }
}

#[derive(Clone)]
pub struct BindPlan {
    pub org_id: String,
    pub consumer_type: ConsumerType,
    pub consumer_id: String,
    pub saved_by: String,
    pub image: ConsumerImage,
    pub refs: Vec<BoundRef>,
    pub changed_secret_ids: BTreeSet<String>,
    pub host_changed: bool,
    pub request_urls: Vec<String>,
    pub dep_keys: Vec<String>,
    pub dep_secret_ids: Vec<String>,
    pub binds: Vec<SecretBindOption>,
}

impl BindPlan {
    fn ref_ids(&self) -> BTreeSet<&String> {
        self.refs.iter().map(|r| &r.secret_id).collect()
    }

    fn secret_ids(&self) -> Vec<String> {
        self.refs
            .iter()
            .map(|r| &r.secret_id)
            .chain(&self.dep_secret_ids)
            .chain(self.binds.iter().map(|b| &b.secret_id))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .cloned()
            .collect()
    }

    fn digests(&self, key: &KAuth) -> Result<(String, DepDigests), SecretErrorCode> {
        let delivery = digest::delivery_digest(
            self.consumer_type,
            &self.image.stored,
            &self.image.keyed_pointers,
            key,
            |field, name| {
                self.refs
                    .iter()
                    .find(|r| r.field == field && r.token_name == name)
                    .map(|r| r.secret_id.clone())
            },
        )?;
        Ok((delivery, digest::dep_digests(&self.image.deps)?))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Preflight {
    pub checks: BTreeSet<(String, StrictVerb)>,
    pub policy_revs: BTreeMap<String, String>,
}

#[derive(Debug)]
pub enum BindError {
    Code(SecretErrorCode),
    ConsumerNotAllowed {
        secret_id: String,
        consumer_type: ConsumerType,
        consumer_id: String,
    },
    PinRequired {
        secret_id: String,
        suggested_hosts: Vec<String>,
    },
    Retry,
    Infra(Error),
}

impl BindError {
    pub fn code(&self) -> SecretErrorCode {
        match self {
            Self::Code(code) | Self::Infra(Error::SecretStore(code)) => *code,
            Self::ConsumerNotAllowed { .. } => SecretErrorCode::ConsumerNotAllowed,
            Self::PinRequired { .. } => SecretErrorCode::SecretPinRequired,
            Self::Retry => SecretErrorCode::PolicyChanged,
            Self::Infra(_) => SecretErrorCode::SecretUnavailable,
        }
    }
}

impl From<Error> for BindError {
    fn from(error: Error) -> Self {
        match error {
            Error::SecretStore(code) => Self::Code(code),
            other => Self::Infra(other),
        }
    }
}

impl From<SecretErrorCode> for BindError {
    fn from(code: SecretErrorCode) -> Self {
        Self::Code(code)
    }
}

/// Org-wide managers can already list secret names; other callers must not learn whether one
/// exists.
pub fn missing_secret_code(role: &str) -> SecretErrorCode {
    match role {
        "root" | "admin" => SecretErrorCode::SecretNotFound,
        _ => SecretErrorCode::SecretUseDenied,
    }
}

pub fn required_set(
    plan: &BindPlan,
    secrets: &[org_secrets::Model],
    auth: Option<&auth::Model>,
    k_auth: &KAuth,
) -> BTreeSet<(String, StrictVerb)> {
    let current = auth.is_some_and(|row| {
        row.auth_state == AuthState::Ok
            && plan.digests(k_auth).is_ok_and(|(delivery, deps)| {
                row.delivery_digest == delivery
                    && digest::decode_dep_digests(&row.dep_digests) == Ok(deps)
            })
    });
    let refs = plan.ref_ids();
    let deps: BTreeSet<_> = plan.dep_secret_ids.iter().collect();
    let edits: BTreeSet<_> = plan
        .binds
        .iter()
        .filter(|b| b.changes_policy())
        .map(|b| &b.secret_id)
        .collect();
    let mut checks = BTreeSet::new();
    for row in secrets {
        let id = &row.id;
        if edits.contains(id) {
            checks.insert((id.clone(), StrictVerb::AccessPut));
        }
        let dependency = deps.contains(id);
        if !refs.contains(id) && !dependency {
            continue;
        }
        let changed = plan.changed_secret_ids.contains(id);
        if !current || changed {
            checks.insert((id.clone(), StrictVerb::Use));
            if plan.consumer_type == ConsumerType::AiToolset {
                checks.insert((id.clone(), StrictVerb::Manage));
            }
        }
        if row.kind == "secret" && row.pin_mode == PinMode::Any && (changed || plan.host_changed) {
            checks.insert((id.clone(), StrictVerb::AccessPut));
        }
    }
    checks
}

pub async fn preflight_in<C: ConnectionTrait>(
    conn: &C,
    plan: &BindPlan,
    k_auth: &KAuth,
) -> Result<Preflight, BindError> {
    mode::require_single_cluster()?;
    if !get_config().common.secret_store_refs_enabled {
        return Err(SecretErrorCode::StoreDisabled.into());
    }
    gate::require(GateState::Latched)?;
    let rows = org_secrets::Entity::find()
        .filter(org_secrets::Column::OrgId.eq(&plan.org_id))
        .filter(org_secrets::Column::Id.is_in(plan.secret_ids()))
        .all(conn)
        .await
        .map_err(Error::from)?;
    let auth = auth::get_in(
        conn,
        &plan.org_id,
        plan.consumer_type.as_str(),
        &plan.consumer_id,
    )
    .await?;
    let auth = verified_auth(conn, plan, auth, k_auth).await?;
    Ok(Preflight {
        checks: required_set(plan, &rows, auth.as_ref(), k_auth),
        policy_revs: rows
            .into_iter()
            .map(|row| (row.id, row.policy_rev))
            .collect(),
    })
}

/// The caller holds the consumer write lock and rolls back its entire save on any error.
pub async fn bind_in(
    txn: &DatabaseTransaction,
    plan: &BindPlan,
    checked: &Preflight,
    k_auth: &KAuth,
) -> Result<Option<BindRequest>, BindError> {
    let rows = lock_policies(txn, plan, checked).await?;
    let auth = auth::get_for_update_in(
        txn,
        &plan.org_id,
        plan.consumer_type.as_str(),
        &plan.consumer_id,
    )
    .await?;
    let verified = verified_auth(txn, plan, auth.clone(), k_auth).await?;
    if !required_set(plan, &rows, verified.as_ref(), k_auth).is_subset(&checked.checks) {
        return Err(BindError::Retry);
    }
    let now = now_micros();
    let mut rows: BTreeMap<_, _> = rows.into_iter().map(|row| (row.id.clone(), row)).collect();
    for option in plan.binds.iter().filter(|opt| opt.changes_policy()) {
        let row = rows
            .remove(&option.secret_id)
            .ok_or(SecretErrorCode::SecretUseDenied)?;
        let updated = apply_option(txn, plan, row, option, now).await?;
        rows.insert(updated.id.clone(), updated);
    }
    let refs = plan.ref_ids();
    let deps: BTreeSet<_> = plan.dep_secret_ids.iter().collect();
    // A store variable is substituted at send, so its consumer needs a signed auth row too.
    let mut secret_bearing = !refs.is_empty();
    for row in rows.values() {
        if refs.contains(&row.id) || deps.contains(&row.id) {
            check_ref(txn, plan, row).await?;
            secret_bearing = true;
        }
    }
    if !secret_bearing {
        let ty = plan.consumer_type.as_str();
        secret_refs::delete_for_consumer_in(txn, &plan.org_id, ty, &plan.consumer_id).await?;
        secret_dependencies::delete_for_consumer_in(txn, &plan.org_id, ty, &plan.consumer_id)
            .await?;
        auth::delete_in(txn, &plan.org_id, ty, &plan.consumer_id).await?;
        return Ok(None);
    }
    save_binding(txn, plan, auth.as_ref(), k_auth, now)
        .await
        .map(Some)
}

pub async fn bind_with_retry<P, PF, A, AF>(
    mut preflight: P,
    mut attempt: A,
) -> Result<Option<BindRequest>, BindError>
where
    P: FnMut() -> PF,
    PF: Future<Output = Result<Preflight, BindError>>,
    A: FnMut(Preflight) -> AF,
    AF: Future<Output = Result<Option<BindRequest>, BindError>>,
{
    let mut retried = false;
    loop {
        let result = match preflight().await {
            Ok(checked) => attempt(checked).await,
            Err(error) => Err(error),
        };
        match result {
            Err(BindError::Retry) if !retried => retried = true,
            Err(BindError::Retry) => return Err(SecretErrorCode::PolicyChanged.into()),
            result => return result,
        }
    }
}

/// A row whose keyed tag fails counts as absent, so a forged `ok` row never skips the use checks.
async fn verified_auth<C: ConnectionTrait>(
    conn: &C,
    plan: &BindPlan,
    auth: Option<auth::Model>,
    k_auth: &KAuth,
) -> Result<Option<auth::Model>, BindError> {
    let Some(row) = auth else {
        return Ok(None);
    };
    let Ok(deps) = digest::decode_dep_digests(&row.dep_digests) else {
        return Ok(None);
    };
    let refs: Vec<BoundRef> = secret_refs::list_for_consumer_in(
        conn,
        &plan.org_id,
        plan.consumer_type.as_str(),
        &plan.consumer_id,
    )
    .await?
    .into_iter()
    .map(|r| BoundRef {
        field: r.field,
        token_name: r.token_name,
        secret_id: r.secret_id,
    })
    .collect();
    let input = AuthTagInput {
        org_id: &plan.org_id,
        consumer_type: plan.consumer_type,
        consumer_id: &plan.consumer_id,
        consumer_rev: row.consumer_rev,
        refs: &refs,
        delivery_digest: &row.delivery_digest,
        dep_digests: &deps,
    };
    Ok(k_auth.verify_auth_tag(&input, &row.auth_tag).then_some(row))
}

async fn lock_policies(
    txn: &DatabaseTransaction,
    plan: &BindPlan,
    checked: &Preflight,
) -> Result<Vec<org_secrets::Model>, BindError> {
    let ids = plan.secret_ids();
    if txn.get_database_backend() == DatabaseBackend::Postgres
        && plan.binds.iter().any(SecretBindOption::changes_policy)
    {
        // Two policy writers cannot both upgrade a shared lock. Take write locks in the same
        // global order as readers before the common locked policy read.
        org_secrets::Entity::find()
            .select_only()
            .column(org_secrets::Column::Id)
            .filter(org_secrets::Column::OrgId.eq(&plan.org_id))
            .filter(org_secrets::Column::Id.is_in(ids.iter().cloned()))
            .order_by_asc(org_secrets::Column::Id)
            .lock(LockType::Update)
            .into_tuple::<String>()
            .all(txn)
            .await
            .map_err(Error::from)?;
    }
    let rows = org_secrets::lock_for_share(txn, &plan.org_id, &ids).await?;
    if rows.len() != ids.len() || rows.iter().any(|row| row.state != "active") {
        return Err(SecretErrorCode::SecretUseDenied.into());
    }
    if rows
        .iter()
        .any(|row| checked.policy_revs.get(&row.id) != Some(&row.policy_rev))
    {
        return Err(BindError::Retry);
    }
    for option in &plan.binds {
        if checked.policy_revs.get(&option.secret_id) != Some(&option.expected_policy_rev) {
            return Err(SecretErrorCode::PolicyChanged.into());
        }
    }
    Ok(rows)
}

async fn apply_option(
    txn: &DatabaseTransaction,
    plan: &BindPlan,
    mut row: org_secrets::Model,
    option: &SecretBindOption,
    now: i64,
) -> Result<org_secrets::Model, BindError> {
    if let BindPin::Hosts(hosts) = &option.pin {
        if hosts.is_empty() {
            return Err(SecretErrorCode::PinHostsEmpty.into());
        }
        row.allowed_hosts = parse_pins(hosts)?
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        row.pin_mode = PinMode::Hosts;
        row.pin_override_by.clear();
        row.pin_override_reason.clear();
        row.pin_override_at = 0;
    }
    let allowlist = if option.allow_this_consumer {
        let mut entries = consumers::list_consumers_in(txn, &plan.org_id, &row.id).await?;
        if !entries.iter().any(|entry| {
            entry.consumer_type == plan.consumer_type.as_str()
                && entry.consumer_id == plan.consumer_id
        }) {
            entries.push(consumers::Model {
                secret_id: row.id.clone(),
                org_id: plan.org_id.clone(),
                consumer_type: plan.consumer_type.as_str().into(),
                consumer_id: plan.consumer_id.clone(),
                added_by: plan.saved_by.clone(),
                added_at: now,
            });
        }
        Some(entries)
    } else {
        None
    };
    row.policy_rev = ider::ksuid();
    row.policy_version = row
        .policy_version
        .checked_add(1)
        .ok_or_else(|| Error::Message("policy version overflow".into()))?;
    row.policy_stamp = org_secrets::next_policy_stamp(now, row.policy_stamp);
    row.origin_region.clear();
    row.updated_at = now;
    row.updated_by.clone_from(&plan.saved_by);
    let write = metadata::MetadataWrite {
        row: metadata::RowWrite::Update(row),
        allowlist,
        add_aliases: vec![],
    };
    Ok(metadata::write_in(txn, &plan.org_id, write).await?)
}

async fn check_ref(
    txn: &DatabaseTransaction,
    plan: &BindPlan,
    row: &org_secrets::Model,
) -> Result<(), BindError> {
    let allowlist = consumers::list_consumers_in(txn, &plan.org_id, &row.id).await?;
    if !allowlist.iter().any(|entry| {
        entry.consumer_type == plan.consumer_type.as_str()
            && (entry.consumer_id == plan.consumer_id || entry.consumer_id == ANY_CONSUMER)
    }) {
        return Err(BindError::ConsumerNotAllowed {
            secret_id: row.id.clone(),
            consumer_type: plan.consumer_type,
            consumer_id: plan.consumer_id.clone(),
        });
    }
    if row.kind == "secret" {
        check_pins(plan, row)?;
    }
    if plan.consumer_type != ConsumerType::SyntheticsCheck
        && !values::get_value_in(txn, &plan.org_id, &row.id, ORG_ENV, "")
            .await?
            .is_some_and(|value| value.state == "set")
    {
        return Err(SecretErrorCode::NoOrgValue.into());
    }
    Ok(())
}

fn check_pins(plan: &BindPlan, row: &org_secrets::Model) -> Result<(), BindError> {
    match row.pin_mode {
        PinMode::Any => Ok(()),
        PinMode::Legacy if !plan.host_changed && !plan.changed_secret_ids.contains(&row.id) => {
            Ok(())
        }
        PinMode::None | PinMode::Legacy => {
            let hosts: BTreeSet<_> = plan
                .request_urls
                .iter()
                .filter_map(|raw| Url::parse(raw).ok())
                .filter(|url| url.has_host())
                .map(|url| url[url::Position::BeforeHost..url::Position::AfterPort].to_owned())
                .collect();
            Err(BindError::PinRequired {
                secret_id: row.id.clone(),
                suggested_hosts: hosts.into_iter().collect(),
            })
        }
        PinMode::Hosts => {
            let pins = row
                .allowed_hosts
                .lines()
                .map(PinPattern::parse)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| SecretErrorCode::PinMismatch)?;
            if plan.request_urls.iter().all(|url| all_match(&pins, url)) {
                Ok(())
            } else {
                Err(SecretErrorCode::PinMismatch.into())
            }
        }
    }
}

async fn save_binding(
    txn: &DatabaseTransaction,
    plan: &BindPlan,
    old: Option<&auth::Model>,
    key: &KAuth,
    now: i64,
) -> Result<BindRequest, BindError> {
    let org = &plan.org_id;
    let ty = plan.consumer_type.as_str();
    let id = &plan.consumer_id;
    let refs = plan
        .refs
        .iter()
        .map(|r| secret_refs::ActiveModel {
            id: Set(ider::ksuid()),
            org_id: Set(org.clone()),
            consumer_type: Set(ty.into()),
            consumer_id: Set(id.clone()),
            field: Set(r.field.clone()),
            token_name: Set(r.token_name.clone()),
            secret_id: Set(r.secret_id.clone()),
            created_at: Set(now),
        })
        .collect();
    secret_refs::replace_for_consumer_in(txn, org, ty, id, refs).await?;
    secret_dependencies::replace_for_consumer_in(txn, org, ty, id, &plan.dep_keys).await?;
    write_auth(txn, plan, old, key, now).await?;
    Ok(BindRequest {
        saved_by: plan.saved_by.clone(),
        refs: plan
            .refs
            .iter()
            .map(|r| BindRef {
                field: r.field.clone(),
                secret_id: r.secret_id.clone(),
            })
            .collect(),
    })
}

async fn write_auth(
    txn: &DatabaseTransaction,
    plan: &BindPlan,
    old: Option<&auth::Model>,
    key: &KAuth,
    now: i64,
) -> Result<(), BindError> {
    let (delivery, deps) = plan.digests(key)?;
    let rev = old
        .map_or(0, |row| row.consumer_rev)
        .checked_add(1)
        .ok_or_else(|| Error::Message("consumer revision overflow".into()))?;
    let tag = key.auth_tag(&AuthTagInput {
        org_id: &plan.org_id,
        consumer_type: plan.consumer_type,
        consumer_id: &plan.consumer_id,
        consumer_rev: rev,
        refs: &plan.refs,
        delivery_digest: &delivery,
        dep_digests: &deps,
    });
    let row = auth::ActiveModel {
        org_id: Set(plan.org_id.clone()),
        consumer_type: Set(plan.consumer_type.as_str().into()),
        consumer_id: Set(plan.consumer_id.clone()),
        consumer_name: Set(plan.image.name.clone()),
        consumer_rev: Set(rev),
        delivery_digest: Set(delivery),
        dep_digests: Set(digest::encode_dep_digests(&deps)?),
        authorized_by: Set(plan.saved_by.clone()),
        via: Set("user:save".into()),
        auth_tag: Set(tag),
        auth_state: Set(AuthState::Ok),
        updated_at: Set(now),
    };
    if old.is_some() {
        auth::update_in(txn, &plan.org_id, row)
            .await?
            .ok_or(BindError::Retry)?;
    } else {
        auth::insert_in(txn, row).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        collections::{BTreeMap, BTreeSet},
        future::ready,
        process::Command,
    };

    use config::{
        ider::ksuid,
        meta::secret_store::{
            BindRef, BindRequest, ConsumerType, GateState, SecretErrorCode,
            digest::{
                AuthTagInput, BoundRef, DepEntry, KAuth, decode_dep_digests, delivery_digest,
                empty_dep_digest,
            },
        },
    };
    use sea_orm::{DatabaseConnection, IntoActiveModel, Set, TransactionTrait};
    use serde_json::json;

    use super::{
        BindError, BindPin, BindPlan, Preflight, SecretBindOption, StrictVerb, bind_in,
        bind_with_retry, preflight_in, required_set,
    };
    use crate::{
        db::get_orm_client_rw,
        secret_store::{
            gate::{self, GateView},
            metadata::METADATA_CAP_BYTES,
            reauthorize::ConsumerImage,
        },
        table::{
            cipher, org_secret_consumers,
            org_secret_values::{self, ORG_ENV},
            org_secrets::{self, PinMode},
            secret_consumer_auth as auth, secret_dependencies, secret_refs,
            testing::unique,
        },
    };

    struct Fixture {
        conn: &'static DatabaseConnection,
        plan: BindPlan,
        key: KAuth,
    }

    impl Fixture {
        async fn new(consumer_type: ConsumerType) -> Self {
            let org = unique("bind");
            let key = KAuth::derive(&cipher::get_dek(&org).await.unwrap());
            Self {
                conn: get_orm_client_rw().await,
                plan: BindPlan {
                    org_id: org,
                    consumer_type,
                    consumer_id: ksuid(),
                    saved_by: "saver".into(),
                    image: ConsumerImage {
                        name: "consumer".into(),
                        stored: json!({"url":"https://api.example.com/send","headers":{}}),
                        keyed_pointers: vec![],
                        deps: BTreeMap::from([(ORG_ENV.into(), vec![])]),
                    },
                    refs: vec![],
                    changed_secret_ids: BTreeSet::new(),
                    host_changed: false,
                    request_urls: vec!["https://api.example.com/send".into()],
                    dep_keys: vec![],
                    dep_secret_ids: vec![],
                    binds: vec![],
                },
                key,
            }
        }

        async fn add_ref(&mut self, name: &str, kind: &str, pin: PinMode) -> org_secrets::Model {
            let id = ksuid();
            self.plan.refs.push(BoundRef {
                field: format!("/headers/{name}"),
                token_name: name.into(),
                secret_id: id.clone(),
            });
            self.plan.image.stored["headers"][name] = json!(format!("{{{{secrets.{name}}}}}"));
            self.plan.changed_secret_ids.insert(id.clone());
            org_secrets::insert_in(
                self.conn,
                org_secrets::ActiveModel {
                    org_id: Set(self.plan.org_id.clone()),
                    id: Set(id),
                    name: Set(name.into()),
                    kind: Set(kind.into()),
                    pin_mode: Set(pin),
                    state: Set("active".into()),
                    allowed_hosts: Set(if pin == PinMode::Hosts {
                        "https://api.example.com:443"
                    } else {
                        ""
                    }
                    .into()),
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
            .unwrap()
        }

        async fn allow(&self, id: &str, consumer_id: &str) {
            org_secret_consumers::add_in(
                self.conn,
                org_secret_consumers::ActiveModel {
                    org_id: Set(self.plan.org_id.clone()),
                    secret_id: Set(id.into()),
                    consumer_type: Set(self.plan.consumer_type.as_str().into()),
                    consumer_id: Set(consumer_id.into()),
                    added_by: Set("owner".into()),
                    added_at: Set(1),
                },
            )
            .await
            .unwrap();
        }

        async fn set_value(&self, id: &str) {
            // Field-by-field so the fixture builds whether or not the entity has optional columns.
            let mut row = <org_secret_values::ActiveModel as sea_orm::ActiveModelBehavior>::new();
            row.org_id = Set(self.plan.org_id.clone());
            row.id = Set(ksuid());
            row.secret_id = Set(id.into());
            row.env_id = Set(ORG_ENV.into());
            row.env_incarnation = Set(String::new());
            row.state = Set("set".into());
            row.value_ref = Set(Some(ksuid()));
            row.value_rev = Set(ksuid());
            row.value_version = Set(1);
            row.updated_by = Set("owner".into());
            org_secret_values::insert_in(self.conn, row).await.unwrap();
        }

        async fn ready_secret(&mut self, name: &str, pin: PinMode) -> org_secrets::Model {
            let row = self.add_ref(name, "secret", pin).await;
            self.allow(&row.id, &self.plan.consumer_id).await;
            self.set_value(&row.id).await;
            row
        }

        async fn preflight(&self) -> Result<Preflight, BindError> {
            preflight_in(self.conn, &self.plan, &self.key).await
        }

        async fn attempt(&self, checked: Preflight) -> Result<Option<BindRequest>, BindError> {
            let txn = self.conn.begin().await.unwrap();
            let result = bind_in(&txn, &self.plan, &checked, &self.key).await;
            if result.is_ok() {
                txn.commit().await.unwrap();
            } else {
                txn.rollback().await.unwrap();
            }
            result
        }

        async fn save(&self) -> Result<Option<BindRequest>, BindError> {
            self.attempt(self.preflight().await?).await
        }

        async fn auth(&self) -> Option<auth::Model> {
            auth::get_in(
                self.conn,
                &self.plan.org_id,
                self.plan.consumer_type.as_str(),
                &self.plan.consumer_id,
            )
            .await
            .unwrap()
        }

        async fn refs(&self) -> Vec<secret_refs::Model> {
            secret_refs::list_for_consumer_in(
                self.conn,
                &self.plan.org_id,
                self.plan.consumer_type.as_str(),
                &self.plan.consumer_id,
            )
            .await
            .unwrap()
        }

        async fn dep_keys(&self) -> Vec<String> {
            secret_dependencies::list_for_consumer_in(
                self.conn,
                &self.plan.org_id,
                self.plan.consumer_type.as_str(),
                &self.plan.consumer_id,
            )
            .await
            .unwrap()
            .into_iter()
            .map(|dep| dep.dep_key)
            .collect()
        }

        async fn secret(&self, id: &str) -> org_secrets::Model {
            org_secrets::get_secret_in(self.conn, &self.plan.org_id, id)
                .await
                .unwrap()
                .unwrap()
        }

        fn option(&mut self, row: &org_secrets::Model, allow_this_consumer: bool, pin: BindPin) {
            self.plan.binds = vec![SecretBindOption {
                secret_id: row.id.clone(),
                expected_policy_rev: row.policy_rev.clone(),
                allow_this_consumer,
                pin,
            }];
        }
    }

    fn isolated(test: &str) -> bool {
        let path = format!("secret_store::bind::tests::{test}");
        // The cipher key installs once and the gate override affects every test in the process.
        if std::env::var("O2_BIND_TEST").as_deref() == Ok(path.as_str()) {
            cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
            gate::force_state_for_tests(Some(GateView {
                state: GateState::Latched,
                suspended: false,
            }));
            return true;
        }
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &path, "--nocapture"])
            .env("O2_BIND_TEST", path)
            .env("O2_SECRET_STORE_REFS_ENABLED", "true")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success() && stdout.contains("1 passed"),
            "{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        false
    }

    #[tokio::test]
    async fn d252_bind_request_and_signed_rows_follow_each_save() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("d252_bind_request_and_signed_rows_follow_each_save") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let token = f.ready_secret("TOKEN", PinMode::Hosts).await;
        let other = f.ready_secret("OTHER", PinMode::Hosts).await;
        let expected = vec![
            BindRef {
                field: "/headers/TOKEN".into(),
                secret_id: token.id,
            },
            BindRef {
                field: "/headers/OTHER".into(),
                secret_id: other.id,
            },
        ];
        assert_eq!(
            f.save().await.unwrap(),
            Some(BindRequest {
                saved_by: "saver".into(),
                refs: expected.clone(),
            })
        );
        let refs: BTreeSet<_> = f
            .refs()
            .await
            .into_iter()
            .map(|r| (r.field, r.secret_id))
            .collect();
        assert_eq!(
            refs,
            expected
                .into_iter()
                .map(|r| (r.field, r.secret_id))
                .collect()
        );
        let row = f.auth().await.unwrap();
        assert_eq!(row.auth_state, auth::AuthState::Ok);
        assert_eq!(row.consumer_rev, 1);
        assert_eq!(row.via, "user:save");
        assert_eq!(row.authorized_by, f.plan.saved_by);
        assert_eq!(row.consumer_name, f.plan.image.name);
        let deps = decode_dep_digests(&row.dep_digests).unwrap();
        assert_eq!(deps, BTreeMap::from([(ORG_ENV.into(), empty_dep_digest())]));
        let delivery = delivery_digest(
            f.plan.consumer_type,
            &f.plan.image.stored,
            &[],
            &f.key,
            |field, name| {
                f.plan
                    .refs
                    .iter()
                    .find(|r| r.field == field && r.token_name == name)
                    .map(|r| r.secret_id.clone())
            },
        )
        .unwrap();
        assert_eq!(row.delivery_digest, delivery);
        assert!(f.key.verify_auth_tag(
            &AuthTagInput {
                org_id: &f.plan.org_id,
                consumer_type: f.plan.consumer_type,
                consumer_id: &f.plan.consumer_id,
                consumer_rev: 1,
                refs: &f.plan.refs,
                delivery_digest: &delivery,
                dep_digests: &deps,
            },
            &row.auth_tag
        ));
        f.plan.dep_keys.push("SETTING".into());
        f.plan
            .image
            .deps
            .get_mut(ORG_ENV)
            .unwrap()
            .push(DepEntry::Absent {
                name: "SETTING".into(),
            });
        f.save().await.unwrap();
        assert_eq!(f.auth().await.unwrap().consumer_rev, 2);
        assert_eq!(f.dep_keys().await, ["SETTING"]);
        f.plan.refs.clear();
        f.plan.image.stored["headers"] = json!({});
        f.plan.changed_secret_ids.clear();
        assert_eq!(f.save().await.unwrap(), None);
        assert!(f.refs().await.is_empty());
        assert!(f.dep_keys().await.is_empty());
        assert!(f.auth().await.is_none());
    }

    #[tokio::test]
    async fn r14_07_stale_or_changed_digests_require_every_ref() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("r14_07_stale_or_changed_digests_require_every_ref") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::SyntheticsCheck).await;
        let a = f.ready_secret("FIRST", PinMode::Hosts).await;
        let b = f.ready_secret("SECOND", PinMode::Hosts).await;
        f.save().await.unwrap();
        let mut auth = f.auth().await.unwrap();
        f.plan.changed_secret_ids.clear();
        f.plan.image.stored["description"] = json!("editor's change");
        let all = BTreeSet::from([
            (a.id.clone(), StrictVerb::Use),
            (b.id.clone(), StrictVerb::Use),
        ]);
        let rows = [a, b];
        assert!(required_set(&f.plan, &rows, Some(&auth), &f.key).is_empty());
        auth.auth_state = auth::AuthState::Stale;
        assert_eq!(required_set(&f.plan, &rows, Some(&auth), &f.key), all);
        auth.auth_state = auth::AuthState::Ok;
        f.plan.image.stored["url"] = json!("https://api.example.com/other");
        assert_eq!(required_set(&f.plan, &rows, Some(&auth), &f.key), all);
        f.plan.image.stored["url"] = json!("https://api.example.com/send");
        f.plan
            .image
            .deps
            .get_mut(ORG_ENV)
            .unwrap()
            .push(DepEntry::Absent {
                name: "CHANGED".into(),
            });
        assert_eq!(required_set(&f.plan, &rows, Some(&auth), &f.key), all);
        f.plan.image.deps.get_mut(ORG_ENV).unwrap().pop();
        assert!(f.preflight().await.unwrap().checks.is_empty());
        let mut forged = f.auth().await.unwrap().into_active_model();
        forged.auth_tag = Set("00".repeat(32));
        auth::update_in(f.conn, &f.plan.org_id, forged)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(f.preflight().await.unwrap().checks, all);
    }

    #[tokio::test]
    async fn r14_08_races_require_fresh_preflight() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("r14_08_races_require_fresh_preflight") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let secret = f.ready_secret("TOKEN", PinMode::Hosts).await;
        f.save().await.unwrap();
        f.plan.changed_secret_ids.clear();
        let narrow = f.preflight().await.unwrap();
        assert!(narrow.checks.is_empty());
        let mut stale = f.auth().await.unwrap().into_active_model();
        stale.auth_state = Set(auth::AuthState::Stale);
        let before = auth::update_in(f.conn, &f.plan.org_id, stale)
            .await
            .unwrap();
        let before_refs = f.refs().await;
        assert!(matches!(
            f.attempt(narrow.clone()).await,
            Err(BindError::Retry)
        ));
        let result =
            bind_with_retry(|| ready(Ok(narrow.clone())), |checked| f.attempt(checked)).await;
        assert!(matches!(
            result,
            Err(BindError::Code(SecretErrorCode::PolicyChanged))
        ));
        assert_eq!(f.auth().await, before);
        assert_eq!(f.refs().await, before_refs);
        let first = Cell::new(true);
        let result = bind_with_retry(
            || {
                let cached = first.replace(false).then(|| narrow.clone());
                let f = &f;
                async move {
                    match cached {
                        Some(checked) => Ok(checked),
                        None => f.preflight().await,
                    }
                }
            },
            |checked| f.attempt(checked),
        )
        .await;
        assert!(result.unwrap().is_some());
        let row = f.auth().await.unwrap();
        assert_eq!(row.auth_state, auth::AuthState::Ok);
        assert_eq!(row.consumer_rev, 2);
        let checked = f.preflight().await.unwrap();
        let mut policy = secret.into_active_model();
        policy.policy_rev = Set(ksuid());
        org_secrets::update_in(f.conn, &f.plan.org_id, policy)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(f.attempt(checked).await, Err(BindError::Retry)));
        assert_eq!(f.auth().await, Some(row));
    }

    #[tokio::test]
    async fn d270_unpinned_secret_refuses_the_bind() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("d270_unpinned_secret_refuses_the_bind") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let row = f.ready_secret("TOKEN", PinMode::None).await;
        f.plan.request_urls.extend([
            "https://z.example.com/test".into(),
            "https://api.example.com/two".into(),
        ]);
        let Err(BindError::PinRequired {
            secret_id,
            suggested_hosts,
        }) = f.save().await
        else {
            panic!("expected pin requirement");
        };
        assert_eq!(secret_id, row.id);
        assert_eq!(suggested_hosts, ["api.example.com", "z.example.com"]);
        assert!(f.refs().await.is_empty());
        assert!(f.auth().await.is_none());
        f.option(&row, false, BindPin::Hosts(vec![]));
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::PinHostsEmpty
        );
        f.option(
            &row,
            false,
            BindPin::Hosts(vec!["http://api.example.com".into()]),
        );
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::PinEntryInvalid
        );
        f.option(&row, false, BindPin::Hosts(vec!["API.EXAMPLE.COM".into()]));
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::PinMismatch
        );
        assert_eq!(f.secret(&row.id).await, row);
        f.plan.request_urls.truncate(1);
        f.plan.binds[0].expected_policy_rev = ksuid();
        assert!(matches!(
            f.save().await,
            Err(BindError::Code(SecretErrorCode::PolicyChanged))
        ));
        f.plan.binds[0]
            .expected_policy_rev
            .clone_from(&row.policy_rev);
        let checked = f.preflight().await.unwrap();
        assert!(
            checked
                .checks
                .contains(&(row.id.clone(), StrictVerb::AccessPut))
        );
        f.attempt(checked).await.unwrap();
        let updated = f.secret(&row.id).await;
        assert_eq!(updated.pin_mode, PinMode::Hosts);
        assert_eq!(updated.allowed_hosts, "https://api.example.com:443");
        assert_ne!(updated.policy_rev, row.policy_rev);
        assert_eq!(updated.policy_version, row.policy_version + 1);
        assert!(updated.policy_stamp > row.policy_stamp);
        assert_eq!(updated.updated_by, f.plan.saved_by);
        f.plan.binds.clear();
        let legacy = f.ready_secret("LEGACY", PinMode::Legacy).await;
        assert!(
            matches!(f.save().await, Err(BindError::PinRequired {secret_id, ..}) if secret_id == legacy.id)
        );
    }

    #[tokio::test]
    async fn d271_any_host_binds_require_access_put() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("d271_any_host_binds_require_access_put") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AiToolset).await;
        let any = f.ready_secret("ANY", PinMode::Any).await;
        let hosts = f.ready_secret("HOSTS", PinMode::Hosts).await;
        let checks = f.preflight().await.unwrap().checks;
        let access = (any.id.clone(), StrictVerb::AccessPut);
        assert!(checks.contains(&access));
        assert!(!checks.contains(&(hosts.id.clone(), StrictVerb::AccessPut)));
        for id in [&any.id, &hosts.id] {
            assert!(checks.contains(&(id.clone(), StrictVerb::Manage)));
            assert!(checks.contains(&(id.clone(), StrictVerb::Use)));
        }
        f.save().await.unwrap();
        f.plan.changed_secret_ids.clear();
        assert!(f.preflight().await.unwrap().checks.is_empty());
        f.plan.host_changed = true;
        assert!(f.preflight().await.unwrap().checks.contains(&access));
    }

    #[tokio::test]
    async fn variable_dependency_outside_its_allowlist_is_refused_at_bind() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("variable_dependency_outside_its_allowlist_is_refused_at_bind") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let variable = f.add_ref("REGION", "variable", PinMode::None).await;
        f.set_value(&variable.id).await;
        f.plan.refs.clear();
        f.plan.image.stored["headers"] = json!({"Region":"{{vars.REGION}}"});
        f.plan.image.deps.insert(
            ORG_ENV.into(),
            vec![DepEntry::Store {
                secret_id: variable.id.clone(),
                value_rev: "v1".into(),
            }],
        );
        f.plan.dep_secret_ids = vec![variable.id.clone()];
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::ConsumerNotAllowed
        );
        assert!(f.auth().await.is_none());
    }

    #[tokio::test]
    async fn f18_variables_bind_without_pins_and_d15_requires_an_org_value() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("f18_variables_bind_without_pins_and_d15_requires_an_org_value") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let row = f.add_ref("VARIABLE", "variable", PinMode::None).await;
        f.allow(&row.id, &f.plan.consumer_id).await;
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::NoOrgValue
        );
        f.plan.consumer_type = ConsumerType::SyntheticsCheck;
        f.allow(&row.id, &f.plan.consumer_id).await;
        assert!(f.save().await.unwrap().is_some());
        f.plan.consumer_type = ConsumerType::AlertDestination;
        f.set_value(&row.id).await;
        assert!(f.save().await.unwrap().is_some());
    }

    #[tokio::test]
    async fn d263_allowlist_changes_share_the_metadata_cap() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("d263_allowlist_changes_share_the_metadata_cap") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let a = f.add_ref("FIRST", "secret", PinMode::Hosts).await;
        f.set_value(&a.id).await;
        let Err(BindError::ConsumerNotAllowed {
            secret_id,
            consumer_type,
            consumer_id,
        }) = f.save().await
        else {
            panic!("expected allowlist refusal");
        };
        assert_eq!(
            (secret_id, consumer_type, consumer_id),
            (
                a.id.clone(),
                f.plan.consumer_type,
                f.plan.consumer_id.clone()
            )
        );
        f.allow(&a.id, org_secret_consumers::ANY_CONSUMER).await;
        f.save().await.unwrap();
        let b = f.add_ref("SECOND", "secret", PinMode::Hosts).await;
        f.set_value(&b.id).await;
        f.allow(&b.id, "another-consumer").await;
        f.option(&b, true, BindPin::Keep);
        let checked = f.preflight().await.unwrap();
        assert!(
            checked
                .checks
                .contains(&(b.id.clone(), StrictVerb::AccessPut))
        );
        f.attempt(checked).await.unwrap();
        let consumers = org_secret_consumers::list_consumers_in(f.conn, &f.plan.org_id, &b.id)
            .await
            .unwrap();
        let ids: BTreeSet<_> = consumers
            .into_iter()
            .map(|entry| entry.consumer_id)
            .collect();
        assert_eq!(
            ids,
            BTreeSet::from(["another-consumer".into(), f.plan.consumer_id.clone()])
        );

        let c = f.add_ref("FULL", "secret", PinMode::None).await;
        let mut full = c.into_active_model();
        full.description = Set("x".repeat(METADATA_CAP_BYTES - "FULL".len()));
        let full = org_secrets::update_in(f.conn, &f.plan.org_id, full)
            .await
            .unwrap()
            .unwrap();
        f.option(&full, true, BindPin::Keep);
        let before = f.auth().await;
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::SecretMetadataTooLarge
        );
        assert_eq!(f.auth().await, before);
        assert_eq!(f.secret(&full.id).await, full);
        assert!(
            org_secret_consumers::list_consumers_in(f.conn, &f.plan.org_id, &full.id)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn r14_08_dependency_only_save_signs_and_denies_inactive_or_unknown_secrets() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("r14_08_dependency_only_save_signs_and_denies_inactive_or_unknown_secrets") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::SyntheticsCheck).await;
        let row = f.ready_secret("DEP", PinMode::Hosts).await;
        f.plan.refs.clear();
        f.plan.changed_secret_ids.clear();
        f.plan.image.stored["headers"] = json!({});
        f.plan
            .image
            .deps
            .get_mut(ORG_ENV)
            .unwrap()
            .push(DepEntry::Store {
                secret_id: row.id.clone(),
                value_rev: "v1".into(),
            });
        f.plan.dep_secret_ids.push(row.id.clone());
        f.plan
            .dep_keys
            .push(secret_dependencies::var_dep_key(&row.id));
        assert_eq!(
            f.preflight().await.unwrap().checks,
            BTreeSet::from([(row.id.clone(), StrictVerb::Use)])
        );
        assert_eq!(
            f.save().await.unwrap(),
            Some(BindRequest {
                saved_by: "saver".into(),
                refs: vec![]
            })
        );
        assert_eq!(f.dep_keys().await, f.plan.dep_keys);
        assert_eq!(f.auth().await.unwrap().consumer_rev, 1);
        f.plan.request_urls = vec!["https://other.example.com".into()];
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::PinMismatch
        );
        assert_eq!(f.auth().await.unwrap().consumer_rev, 1);
        let mut inactive = row.into_active_model();
        inactive.state = Set("deleted".into());
        org_secrets::update_in(f.conn, &f.plan.org_id, inactive)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::SecretUseDenied
        );
        f.plan.dep_secret_ids = vec![ksuid()];
        assert!(f.preflight().await.unwrap().checks.is_empty());
        assert_eq!(
            f.save().await.unwrap_err().code(),
            SecretErrorCode::SecretUseDenied
        );
        assert_eq!(f.auth().await.unwrap().consumer_rev, 1);
        let variable = f.add_ref("PLAIN", "variable", PinMode::None).await;
        f.allow(&variable.id, &f.plan.consumer_id).await;
        f.plan.refs.clear();
        f.plan.image.stored["headers"] = json!({});
        f.plan.image.deps.insert(
            ORG_ENV.into(),
            vec![DepEntry::Store {
                secret_id: variable.id.clone(),
                value_rev: "v2".into(),
            }],
        );
        let var_key = secret_dependencies::var_dep_key(&variable.id);
        f.plan.dep_keys = vec![var_key.clone()];
        f.plan.dep_secret_ids = vec![variable.id];
        f.save().await.unwrap();
        assert_eq!(f.dep_keys().await, vec![var_key]);
        assert!(f.auth().await.is_some());
    }

    #[tokio::test]
    async fn d162_gate_must_be_latched_before_preflight() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("d162_gate_must_be_latched_before_preflight") {
            return;
        }
        let f = Fixture::new(ConsumerType::AlertDestination).await;
        gate::force_state_for_tests(Some(GateView {
            state: GateState::Writable,
            suspended: false,
        }));
        assert!(matches!(
            f.preflight().await,
            Err(BindError::Code(SecretErrorCode::StoreGateClosed))
        ));
        crate::secret_store::mode::set_super_cluster(true, "region");
        assert!(matches!(
            f.preflight().await,
            Err(BindError::Code(SecretErrorCode::StoreDisabled))
        ));
    }

    #[tokio::test]
    async fn d301_one_spelling_in_two_fields_signs_each_field_binding() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if !isolated("d301_one_spelling_in_two_fields_signs_each_field_binding") {
            return;
        }
        let mut f = Fixture::new(ConsumerType::AlertDestination).await;
        let renamed = f.ready_secret("OLD", PinMode::Hosts).await;
        let current = f.ready_secret("NEW", PinMode::Hosts).await;
        f.plan.image.stored["headers"] = json!({
            "OLD": "{{secrets.TOKEN}}",
            "NEW": "{{secrets.TOKEN}}",
        });
        for r in &mut f.plan.refs {
            r.token_name = "TOKEN".into();
        }
        f.save().await.unwrap();
        let digest_with = |lookup: &dyn Fn(&str, &str) -> Option<String>| {
            delivery_digest(
                f.plan.consumer_type,
                &f.plan.image.stored,
                &[],
                &f.key,
                lookup,
            )
            .unwrap()
        };
        let by_field = digest_with(&|field, name| {
            f.plan
                .refs
                .iter()
                .find(|r| r.field == field && r.token_name == name)
                .map(|r| r.secret_id.clone())
        });
        let by_name = digest_with(&|_, name| {
            f.plan
                .refs
                .iter()
                .find(|r| r.token_name == name)
                .map(|r| r.secret_id.clone())
        });
        assert_ne!(renamed.id, current.id);
        assert_ne!(by_field, by_name);
        assert_eq!(f.auth().await.unwrap().delivery_digest, by_field);
    }

    #[tokio::test]
    async fn r14_08_two_retries_return_policy_changed() {
        let preflights = Cell::new(0);
        let attempts = Cell::new(0);
        let result = bind_with_retry(
            || {
                preflights.set(preflights.get() + 1);
                ready(Ok(Preflight {
                    checks: BTreeSet::new(),
                    policy_revs: BTreeMap::new(),
                }))
            },
            |_| {
                attempts.set(attempts.get() + 1);
                ready(Err(BindError::Retry))
            },
        )
        .await;
        assert!(matches!(
            result,
            Err(BindError::Code(SecretErrorCode::PolicyChanged))
        ));
        assert_eq!((preflights.get(), attempts.get()), (2, 2));
    }
}
