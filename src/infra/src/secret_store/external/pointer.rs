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

use config::{
    ider::ksuid,
    meta::secret_store::{
        ORG_ENV_ID, SecretErrorCode, SecretKind, SecretValue, ValueState, external::Pointer,
    },
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseTransaction, EntityTrait,
    IntoActiveModel, QueryFilter, QueryOrder, QuerySelect, sea_query::Expr,
};
use zeroize::Zeroizing;

use super::{check_locator, readiness};
use crate::{
    cluster,
    errors::Error,
    secret_store::{capability::release_floor_ignored, mode},
    secrets::{CURRENT, SecretPurpose},
    table::{
        credential_values::{
            self as credentials, NamedValueAd, NamedValueClass, SecretRecord, SlotClass,
        },
        entity::{credential_values as credential, synthetics_environments as environments},
        org_secret_values as heads, org_secrets, secret_backends,
        synthetics_environments::SyntheticsEnvironmentRecord,
    },
};

// A pre-pointer binary can report the P1 store floor while it is still a live writer.
pub const P1E1_RELEASE: &str = "v1.3.0-rc1";

pub struct PointerWrite {
    pub org_id: String,
    pub secret_id: String,
    pub env_id: String,
    pub kind: SecretKind,
    pub pointer: Pointer,
    pub actor: String,
}

struct ValueSlot<'a> {
    org: &'a str,
    secret: &'a str,
    env: &'a str,
    actor: &'a str,
}

impl ValueSlot<'_> {
    async fn current<C: ConnectionTrait>(
        &self,
        txn: &C,
    ) -> Result<(String, Option<heads::Model>), Error> {
        // Lock the parent even for the first value, where there is no head row to lock.
        let row = org_secrets::get_for_update_in(txn, self.org, self.secret)
            .await?
            .ok_or(Error::SecretStore(SecretErrorCode::SecretNotFound))?;
        if row.kind != SecretKind::Secret.as_str() {
            return Err(Error::SecretStore(
                SecretErrorCode::ExternalSourceRequiresSecret,
            ));
        }
        if row.state != "active" {
            return Err(Error::SecretStore(SecretErrorCode::SecretNotFound));
        }
        let incarnation = if self.env == ORG_ENV_ID {
            String::new()
        } else {
            let env = environments::Entity::find()
                .filter(environments::Column::Id.eq(self.env))
                .filter(environments::Column::OrgId.eq(self.org))
                .lock_shared()
                .one(txn)
                .await?
                .ok_or(Error::SecretStore(SecretErrorCode::SecretNotFound))?;
            SyntheticsEnvironmentRecord::from(env).incarnation()
        };
        let head = heads::get_value_in(txn, self.org, self.secret, self.env, &incarnation).await?;
        self.authenticate_kind(txn, head.as_ref()).await?;
        Ok((incarnation, head))
    }

    async fn authenticate_kind<C: ConnectionTrait>(
        &self,
        txn: &C,
        target: Option<&heads::Model>,
    ) -> Result<(), Error> {
        let other;
        let head =
            if let Some(head) = target.filter(|h| h.value_ref.is_some() && h.state != "deleted") {
                head
            } else {
                // A new or unset environment cannot hide a kind mismatch in another current value.
                other = heads::Entity::find()
                    .filter(heads::Column::OrgId.eq(self.org))
                    .filter(heads::Column::SecretId.eq(self.secret))
                    .filter(heads::Column::ValueRef.is_not_null())
                    .filter(heads::Column::State.ne("deleted"))
                    .order_by_asc(heads::Column::Id)
                    .one(txn)
                    .await?;
                let Some(witness) = other.as_ref() else {
                    return Ok(());
                };
                witness
            };
        let reference = head
            .value_ref
            .as_deref()
            .ok_or(Error::SecretStore(SecretErrorCode::ValueMissingInRegion))?;
        let model = credentials::find_state(txn, self.org, reference, CURRENT)
            .await?
            .ok_or(Error::SecretStore(SecretErrorCode::ValueMissingInRegion))?;
        let slot = named_slot(head, reference);
        let record = match credentials::decrypt_model_in(txn, model, &slot).await {
            Ok(record) => record,
            Err(error) if error.is_authentication_failure() => {
                log::error!(
                    "named value authentication failed for org {} secret {}",
                    self.org,
                    self.secret
                );
                return Err(Error::SecretStore(SecretErrorCode::SecretKindMismatch));
            }
            Err(error) => return Err(error.into()),
        };
        if let Some(backend_id) = &head.backend_id {
            let pointer: Pointer = serde_json::from_str(&record.value)
                .map_err(|_| Error::SecretStore(SecretErrorCode::SecretUnavailable))?;
            if pointer.backend_id != *backend_id {
                return Err(Error::SecretStore(SecretErrorCode::SecretUnavailable));
            }
        }
        Ok(())
    }

    async fn replace<C: ConnectionTrait>(
        &self,
        txn: &C,
        incarnation: String,
        old: Option<&heads::Model>,
        source: Source<'_>,
    ) -> Result<heads::Model, Error> {
        if matches!(&source, Source::Local(Some(value)) if value.is_empty()) {
            return Err(Error::SecretStore(SecretErrorCode::SlotValueRequired));
        }
        let previous_version = old.map_or(0, |h| h.value_version);
        let next_version = previous_version
            .checked_add(1)
            .ok_or(Error::SecretStore(SecretErrorCode::SecretUnavailable))?;
        let now = now_micros();
        let state = match &source {
            Source::Local(None) => ValueState::Unset,
            _ => ValueState::Set,
        };
        let head = heads::Model {
            id: old.map_or_else(ksuid, |h| h.id.clone()),
            org_id: self.org.to_owned(),
            secret_id: self.secret.to_owned(),
            env_id: self.env.to_owned(),
            env_incarnation: incarnation,
            state: state.as_str().into(),
            value_ref: (state == ValueState::Set).then(ksuid),
            backend_id: match &source {
                Source::Pointer(p) => Some(p.backend_id.clone()),
                Source::Local(_) => None,
            },
            value_rev: ksuid(),
            value_version: now.max(next_version),
            updated_by: self.actor.to_owned(),
        };
        let material = match source {
            Source::Pointer(p) => {
                Some(Zeroizing::new(serde_json::to_string(p).map_err(|_| {
                    Error::SecretStore(SecretErrorCode::SecretUnavailable)
                })?))
            }
            Source::Local(value) => value.cloned(),
        };
        if let Some(value) = material {
            let credential = seal(txn, &head, value, now / 1000).await?;
            credentials::insert(txn, credential).await?;
        }
        if let Some(old) = old {
            if let Some(reference) = &old.value_ref {
                retire(txn, old, reference, now / 1000).await?;
            }
            head.clone()
                .into_active_model()
                .reset_all()
                .update(txn)
                .await?;
        } else {
            heads::insert_in(txn, head.clone().into_active_model()).await?;
        }
        Ok(head)
    }
}

enum Source<'a> {
    Pointer(&'a Pointer),
    Local(Option<&'a SecretValue>),
}

/// The caller owns the transaction across the credential and value head writes. Returns the new
/// value revision.
pub async fn write_pointer_in<C: ConnectionTrait>(
    conn: &C,
    write: &PointerWrite,
) -> Result<String, Error> {
    if write.kind == SecretKind::Variable {
        return Err(Error::SecretStore(
            SecretErrorCode::ExternalSourceRequiresSecret,
        ));
    }
    mode::require_single_cluster().map_err(Error::SecretStore)?;
    // A passing readiness read must cover the pointer insert even if a backend edit or delete
    // races.
    if secret_backends::Entity::find()
        .select_only()
        .column(secret_backends::Column::Id)
        .filter(secret_backends::Column::OrgId.eq(&write.org_id))
        .filter(secret_backends::Column::Id.eq(&write.pointer.backend_id))
        .lock_shared()
        .into_tuple::<String>()
        .one(conn)
        .await?
        .is_none()
    {
        return Err(Error::SecretStore(SecretErrorCode::SecretNotFound));
    }
    let ready = readiness::ready_in(conn, &write.org_id, &write.pointer.backend_id)
        .await
        .map_err(Error::SecretStore)?;
    check_locator(&ready.backend, ready.kind, &write.pointer).map_err(Error::SecretStore)?;
    if !release_floor_ignored() && !cluster::all_live_nodes_at_least(P1E1_RELEASE).await {
        return Err(Error::SecretStore(SecretErrorCode::StoreGateClosed));
    }
    persist_pointer_in(conn, write).await
}

pub async fn replace_pointer_with_local_in(
    txn: &DatabaseTransaction,
    org: &str,
    secret: &str,
    env: &str,
    actor: &str,
    value: Option<&SecretValue>,
) -> Result<heads::Model, Error> {
    mode::require_single_cluster().map_err(Error::SecretStore)?;
    let slot = ValueSlot {
        org,
        secret,
        env,
        actor,
    };
    let (incarnation, old) = slot.current(txn).await?;
    let old = old
        .filter(|h| h.backend_id.is_some())
        .ok_or(Error::SecretStore(SecretErrorCode::SecretNotFound))?;
    if old.value_ref.is_none() || old.state != ValueState::Set.as_str() {
        return Err(Error::SecretStore(SecretErrorCode::SecretUnavailable));
    }
    slot.replace(txn, incarnation, Some(&old), Source::Local(value))
        .await
}

pub(crate) async fn open_pointer_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    reference: &str,
    slot: &SlotClass<'_>,
) -> Result<Pointer, SecretErrorCode> {
    let unavailable = SecretErrorCode::SecretUnavailable;
    if !matches!(slot, SlotClass::NamedValue(ad) if ad.class == NamedValueClass::OrgSecretPointer
        && ad.kind == SecretKind::Secret && ad.org_id == org && ad.secret_ref == reference)
    {
        return Err(unavailable);
    }
    let model = credentials::find_state(conn, org, reference, CURRENT)
        .await
        .map_err(|_| unavailable)?
        .ok_or(unavailable)?;
    let record = credentials::decrypt_model_in(conn, model, slot)
        .await
        .map_err(|_| unavailable)?;
    serde_json::from_str(&record.value).map_err(|_| unavailable)
}

async fn persist_pointer_in<C: ConnectionTrait>(
    conn: &C,
    write: &PointerWrite,
) -> Result<String, Error> {
    let slot = ValueSlot {
        org: &write.org_id,
        secret: &write.secret_id,
        env: &write.env_id,
        actor: &write.actor,
    };
    let (incarnation, old) = slot.current(conn).await?;
    Ok(slot
        .replace(
            conn,
            incarnation,
            old.as_ref(),
            Source::Pointer(&write.pointer),
        )
        .await?
        .value_rev)
}

fn class(head: &heads::Model) -> NamedValueClass {
    if head.backend_id.is_some() {
        NamedValueClass::OrgSecretPointer
    } else {
        NamedValueClass::OrgSecret
    }
}

fn named_slot<'a>(head: &'a heads::Model, reference: &'a str) -> SlotClass<'a> {
    SlotClass::NamedValue(NamedValueAd {
        org_id: &head.org_id,
        secret_ref: reference,
        value_row_id: &head.id,
        secret_id: &head.secret_id,
        kind: SecretKind::Secret,
        class: class(head),
        env_id: &head.env_id,
        env_incarnation: &head.env_incarnation,
        value_rev: &head.value_rev,
    })
}

async fn seal<C: ConnectionTrait>(
    conn: &C,
    head: &heads::Model,
    value: SecretValue,
    now_ms: i64,
) -> Result<credential::ActiveModel, Error> {
    let reference = head
        .value_ref
        .as_deref()
        .ok_or(Error::SecretStore(SecretErrorCode::SecretUnavailable))?;
    let record = SecretRecord {
        id: ksuid(),
        org_id: head.org_id.clone(),
        secret_ref: reference.to_owned(),
        owner_kind: class(head).owner_kind().to_owned(),
        owner_id: head.id.clone(),
        purpose: SecretPurpose::Auth.as_str().into(),
        key_id: None,
        state: CURRENT.into(),
        value,
        last_verified_at: None,
        grace_expires_at: None,
        created_at: now_ms,
        updated_at: now_ms,
    };
    credentials::encrypted_active_model_in(conn, &record, &named_slot(head, reference)).await
}

async fn retire<C: ConnectionTrait>(
    txn: &C,
    old: &heads::Model,
    reference: &str,
    now_ms: i64,
) -> Result<(), Error> {
    let retired = credential::Entity::update_many()
        .col_expr(credential::Column::State, Expr::value("retired"))
        .col_expr(credential::Column::GraceExpiresAt, Expr::value(now_ms))
        .col_expr(credential::Column::UpdatedAt, Expr::value(now_ms))
        .filter(credential::Column::OrgId.eq(&old.org_id))
        .filter(credential::Column::OwnerKind.eq(class(old).owner_kind()))
        .filter(credential::Column::OwnerId.eq(&old.id))
        .filter(credential::Column::SecretRef.eq(reference))
        .filter(credential::Column::State.eq(CURRENT))
        .exec(txn)
        .await?;
    if retired.rows_affected != 1 {
        return Err(Error::SecretStore(SecretErrorCode::SecretUnavailable));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::meta::{
        cluster::{Node, NodeStatus},
        organization::OrganizationType,
        secret_store::external::{ResolvedIdentity, VersionSelector},
    };
    use sea_orm::{DatabaseConnection, Set, TransactionTrait};
    use tokio::time::timeout;

    use super::*;
    use crate::{
        secret_store::gate::tests::isolated_store_test,
        secrets::{self, SecretOwnerKind},
        table::{cipher, organizations, testing::unique},
    };

    fn write() -> PointerWrite {
        PointerWrite {
            org_id: unique("pointer"),
            secret_id: ksuid(),
            env_id: ORG_ENV_ID.to_owned(),
            kind: SecretKind::Secret,
            actor: "writer".into(),
            pointer: Pointer {
                backend_id: ksuid(),
                locator: "project-token".into(),
                version_selector: VersionSelector::Latest,
                json_key: None,
            },
        }
    }

    #[tokio::test]
    async fn variable_source_is_refused_before_a_database_read() {
        let mut write = write();
        write.kind = SecretKind::Variable;
        assert!(matches!(
            write_pointer_in(&DatabaseConnection::Disconnected, &write).await,
            Err(Error::SecretStore(
                SecretErrorCode::ExternalSourceRequiresSecret
            ))
        ));
    }

    #[tokio::test]
    async fn empty_local_replacement_is_refused_before_any_database_read() {
        let conn = DatabaseConnection::Disconnected;
        let slot = ValueSlot {
            org: "org",
            secret: "secret",
            env: ORG_ENV_ID,
            actor: "admin",
        };
        let empty = SecretValue::new(String::new());
        assert!(matches!(
            slot.replace(&conn, String::new(), None, Source::Local(Some(&empty)))
                .await,
            Err(Error::SecretStore(SecretErrorCode::SlotValueRequired))
        ));
    }

    #[tokio::test]
    async fn foreign_backend_id_is_not_found_before_any_write() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let conn = credentials::client().await;
        let input = write();
        let backend = backend(&input, &unique("foreign"));
        let txn = conn.begin().await.unwrap();
        secret_backends::insert_in(&txn, backend).await.unwrap();
        assert!(matches!(
            write_pointer_in(&txn, &input).await,
            Err(Error::SecretStore(SecretErrorCode::SecretNotFound))
        ));
        txn.rollback().await.unwrap();
    }

    fn backend(input: &PointerWrite, org: &str) -> secret_backends::ActiveModel {
        secret_backends::ActiveModel {
            id: Set(input.pointer.backend_id.clone()),
            org_id: Set(org.to_owned()),
            name: Set("foreign".into()),
            kind: Set("azure_kv".into()),
            config: Set("{}".into()),
            path_prefixes: Set(r#"["project"]"#.into()),
            auth_mode: Set("static".into()),
            cred_ref: Set(Some(ksuid())),
            credential_rev: Set(ksuid()),
            state: Set("active".into()),
            backend_rev: Set(ksuid()),
            ttl_secs: Set(30),
            stale_max_secs: Set(0),
            created_by: Set("owner".into()),
            updated_by: Set("owner".into()),
            created_at: Set(1),
            updated_at: Set(1),
            ..Default::default()
        }
    }

    #[test]
    fn every_live_node_must_support_pointer_creation_and_rotation() {
        isolated_store_test(
            "secret_store::external::pointer::tests::every_live_node_must_support_pointer_creation_and_rotation",
            pointer_gate_and_rotation(),
        );
    }

    async fn pointer_gate_and_rotation() {
        if !secrets::sealed_value_test_store().await {
            return;
        }
        let conn = credentials::client().await;
        let mut input = write();
        create_secret(conn, &input).await;
        organizations::add(&input.org_id, "pointers", OrganizationType::Custom)
            .await
            .unwrap();
        let model = secret_backends::insert_in(conn, backend(&input, &input.org_id))
            .await
            .unwrap();
        readiness::record_pass_in(
            conn,
            &input.org_id,
            &model.id,
            &model.backend_rev,
            &ResolvedIdentity::Static {
                credential_rev: model.credential_rev,
            },
        )
        .await
        .unwrap();
        let mut node = Node {
            uuid: ksuid(),
            name: "old-writer".into(),
            version: "v1.2.0".into(),
            status: NodeStatus::Online,
            ..Default::default()
        };
        cluster::add_node_to_cache(node.clone()).await;
        let txn = conn.begin().await.unwrap();
        assert!(matches!(
            write_pointer_in(&txn, &input).await,
            Err(Error::SecretStore(SecretErrorCode::StoreGateClosed))
        ));
        assert!(
            heads::get_value_in(&txn, &input.org_id, &input.secret_id, ORG_ENV_ID, "")
                .await
                .unwrap()
                .is_none()
        );
        txn.rollback().await.unwrap();
        node.version = "v1.2.0-rc1".into();
        cluster::add_node_to_cache(node.clone()).await;
        let mut cfg = config::config::init();
        cfg.common.secret_store_ignore_release_floor = true;
        config::CONFIG.store(std::sync::Arc::new(cfg));
        let txn = conn.begin().await.unwrap();
        let first_rev = write_pointer_in(&txn, &input).await.unwrap();
        let first = heads::get_value_in(&txn, &input.org_id, &input.secret_id, ORG_ENV_ID, "")
            .await
            .unwrap()
            .unwrap();
        txn.commit().await.unwrap();
        config::CONFIG.store(std::sync::Arc::new(config::config::init()));
        node.version = P1E1_RELEASE.to_owned();
        cluster::add_node_to_cache(node).await;
        input.pointer.locator = "project-rotated".into();
        let txn = conn.begin().await.unwrap();
        let new_rev = write_pointer_in(&txn, &input).await.unwrap();
        txn.commit().await.unwrap();
        let second = heads::get_value_in(conn, &input.org_id, &input.secret_id, ORG_ENV_ID, "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first_rev, first.value_rev);
        assert_eq!(new_rev, second.value_rev);
        assert_eq!(first.id, second.id);
        assert_eq!(second.backend_id, Some(input.pointer.backend_id.clone()));
        assert_ne!(first.value_rev, second.value_rev);
        assert_ne!(first.value_ref, second.value_ref);
        assert!(first.value_version < second.value_version);
        assert!(
            credentials::find_state(
                conn,
                &input.org_id,
                first.value_ref.as_deref().unwrap(),
                "retired"
            )
            .await
            .unwrap()
            .is_some()
        );
        let reference = second.value_ref.as_deref().unwrap();
        let pointer = open_pointer_in(
            conn,
            &input.org_id,
            reference,
            &named_slot(&second, reference),
        )
        .await
        .unwrap();
        assert!(pointer == input.pointer);
    }

    async fn create_secret(conn: &DatabaseConnection, input: &PointerWrite) {
        org_secrets::ActiveModel {
            id: Set(input.secret_id.clone()),
            org_id: Set(input.org_id.clone()),
            name: Set("pointer".into()),
            kind: Set("secret".into()),
            state: Set("active".into()),
            policy_rev: Set(ksuid()),
            policy_version: Set(1),
            pin_mode: Set(org_secrets::PinMode::Hosts),
            allowed_hosts: Set("example.org".into()),
            created_by: Set("writer".into()),
            updated_by: Set("writer".into()),
            created_at: Set(1),
            updated_at: Set(1),
            ..Default::default()
        }
        .insert(conn)
        .await
        .unwrap();
        drop(Zeroizing::new(
            cipher::get_dek(&input.org_id).await.unwrap(),
        ));
    }

    #[tokio::test]
    async fn pointer_write_authenticates_a_local_value_in_another_environment() {
        if !secrets::sealed_value_test_store().await {
            return;
        }
        let conn = credentials::client().await;
        let input = write();
        create_secret(conn, &input).await;
        let witness = ValueSlot {
            org: &input.org_id,
            secret: &input.secret_id,
            env: "other",
            actor: &input.actor,
        };
        let txn = conn.begin().await.unwrap();
        let value = Zeroizing::new("fixture".to_owned());
        let original = witness
            .replace(&txn, ksuid(), None, Source::Local(Some(&value)))
            .await
            .unwrap();
        let mut changed = original.clone().into_active_model();
        changed.value_rev = Set(ksuid());
        changed.update(&txn).await.unwrap();
        assert!(matches!(
            persist_pointer_in(&txn, &input).await,
            Err(Error::SecretStore(SecretErrorCode::SecretKindMismatch))
        ));
        assert!(
            heads::get_value_in(&txn, &input.org_id, &input.secret_id, ORG_ENV_ID, "")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            credentials::find_state(
                &txn,
                &input.org_id,
                original.value_ref.as_deref().unwrap(),
                CURRENT
            )
            .await
            .unwrap()
            .is_some()
        );
        txn.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn pointer_to_local_replacement_rolls_back_and_commits_as_one_write() {
        if !secrets::sealed_value_test_store().await {
            return;
        }
        let conn = credentials::client().await;
        let input = write();
        create_secret(conn, &input).await;
        let slot = ValueSlot {
            org: &input.org_id,
            secret: &input.secret_id,
            env: ORG_ENV_ID,
            actor: &input.actor,
        };
        let txn = conn.begin().await.unwrap();
        let rev = persist_pointer_in(&txn, &input).await.unwrap();
        txn.commit().await.unwrap();
        let pointer = heads::get_value_in(conn, slot.org, slot.secret, slot.env, "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pointer.value_rev, rev);
        assert_eq!(pointer.backend_id, Some(input.pointer.backend_id.clone()));
        let old_ref = pointer.value_ref.as_deref().unwrap();
        let txn = conn.begin().await.unwrap();
        let unset =
            replace_pointer_with_local_in(&txn, slot.org, slot.secret, slot.env, slot.actor, None)
                .await
                .unwrap();
        assert!(unset.value_ref.is_none() && unset.backend_id.is_none());
        assert_eq!(unset.state, ValueState::Unset.as_str());
        txn.rollback().await.unwrap();
        assert_eq!(
            heads::get_value_in(conn, slot.org, slot.secret, slot.env, "")
                .await
                .unwrap(),
            Some(pointer.clone())
        );
        assert!(
            credentials::find_state(conn, slot.org, old_ref, CURRENT)
                .await
                .unwrap()
                .is_some()
        );

        let txn = conn.begin().await.unwrap();
        let local = replace_pointer_with_local_in(
            &txn,
            slot.org,
            slot.secret,
            slot.env,
            slot.actor,
            Some(&Zeroizing::new("local".to_owned())),
        )
        .await
        .unwrap();
        txn.commit().await.unwrap();
        let stored = heads::get_value_in(conn, slot.org, slot.secret, slot.env, "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored, local);
        assert!(stored.backend_id.is_none());
        assert_ne!(stored.value_rev, pointer.value_rev);
        assert_ne!(stored.value_ref, pointer.value_ref);
        assert!(stored.value_version > pointer.value_version);
        let reference = stored.value_ref.as_deref().unwrap();
        let (_, plaintext) = secrets::resolve_value_in(
            conn,
            slot.org,
            reference,
            SecretOwnerKind::OrgSecret,
            &stored.id,
            CURRENT,
            &named_slot(&stored, reference),
        )
        .await
        .unwrap();
        assert!(plaintext.as_str() == "local");
        assert!(
            credentials::find_state(conn, slot.org, old_ref, "retired")
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn cold_dek_cache_pointer_write_and_replace_complete_while_the_txn_holds_the_writer() {
        if !secrets::sealed_value_test_store().await {
            return;
        }
        let conn = credentials::client().await;
        let input = write();
        create_secret(conn, &input).await;
        let txn = conn.begin().await.unwrap();
        org_secrets::update_in(
            &txn,
            &input.org_id,
            org_secrets::ActiveModel {
                id: Set(input.secret_id.clone()),
                updated_by: Set("txn-writer".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();

        let deadline = Duration::from_secs(10);
        cipher::forget_cached_dek(&input.org_id);
        let rev = timeout(deadline, persist_pointer_in(&txn, &input))
            .await
            .expect("pointer write timed out")
            .unwrap();
        let head = heads::get_value_in(&txn, &input.org_id, &input.secret_id, ORG_ENV_ID, "")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(head.value_rev, rev);
        let reference = head.value_ref.as_deref().unwrap();
        cipher::forget_cached_dek(&input.org_id);
        let pointer = timeout(
            deadline,
            open_pointer_in(
                &txn,
                &input.org_id,
                reference,
                &named_slot(&head, reference),
            ),
        )
        .await
        .expect("pointer open timed out")
        .unwrap();
        assert!(pointer == input.pointer);

        let value = Zeroizing::new("local".to_owned());
        cipher::forget_cached_dek(&input.org_id);
        let local = timeout(
            deadline,
            replace_pointer_with_local_in(
                &txn,
                &input.org_id,
                &input.secret_id,
                ORG_ENV_ID,
                &input.actor,
                Some(&value),
            ),
        )
        .await
        .expect("pointer replacement timed out")
        .unwrap();
        let reference = local.value_ref.as_deref().unwrap();
        cipher::forget_cached_dek(&input.org_id);
        let (_, plaintext) = timeout(
            deadline,
            secrets::resolve_value_in(
                &txn,
                &input.org_id,
                reference,
                SecretOwnerKind::OrgSecret,
                &local.id,
                CURRENT,
                &named_slot(&local, reference),
            ),
        )
        .await
        .expect("local value resolution timed out")
        .unwrap();
        assert!(plaintext == value);
        txn.commit().await.unwrap();
    }
}
