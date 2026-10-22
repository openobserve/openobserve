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

//! Trigger upkeep the worker runs under its lock, and the tombstone of a deleted workflow.

use std::{collections::BTreeMap, time::Duration};

use config::utils::time::now_micros;
use infra::{
    db::get_orm_client_rw,
    secrets::{self, SecretOwnerKind},
    table::{
        entity::{
            workflow_http_trigger_credentials as credentials, workflow_http_triggers as triggers,
        },
        workflow_http_triggers::{self as http_triggers, CredentialState, TOMBSTONE_TTL_US},
    },
};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect, TransactionTrait,
    sea_query::Expr,
};

pub const ANTI_ENTROPY_EVERY: Duration = Duration::from_secs(24 * 3600);

#[derive(Debug, Default, PartialEq, Eq)]
struct Expired {
    credentials: u64,
    triggers: Vec<String>,
}

/// Only the region that last wrote a trigger revokes its credentials, so regions never race.
pub async fn expire_retiring(now_us: i64) -> Result<u64, anyhow::Error> {
    let db = get_orm_client_rw().await;
    let expired = expire_retiring_in(db, &config::get_cluster_name(), now_us).await?;
    for trigger_id in &expired.triggers {
        emit_after_commit(trigger_id).await;
    }
    Ok(expired.credentials)
}

pub async fn sweep_tombstones(now_us: i64) -> Result<u64, anyhow::Error> {
    let swept = sweep_tombstones_in(get_orm_client_rw().await, now_us).await?;
    for trigger_id in &swept {
        if let Err(e) = db::workflow_http_triggers::forget_local(trigger_id).await {
            log::warn!("[WORKFLOW_HOOK] cache key of swept trigger {trigger_id} not dropped: {e}");
        }
    }
    Ok(u64::try_from(swept.len()).unwrap_or(u64::MAX))
}

pub async fn anti_entropy_emit(now_us: i64) -> Result<u64, anyhow::Error> {
    if !get_o2_config().super_cluster.enabled {
        return Ok(0);
    }
    let db = get_orm_client_rw().await;
    let targets = anti_entropy_targets_in(db, &config::get_cluster_name(), now_us).await?;
    let mut emitted = 0;
    for trigger_id in targets {
        let snapshot = match http_triggers::load_snapshot(&trigger_id).await {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => continue,
            Err(e) => {
                log::error!("[WORKFLOW_HOOK] anti-entropy skips trigger {trigger_id}: {e}");
                continue;
            }
        };
        if db::workflow_http_triggers::emit_prepared(&snapshot)
            .await
            .is_ok()
        {
            emitted += 1;
        }
    }
    Ok(emitted)
}

/// The deleting region takes over as writer, so its tombstone wins in every region.
pub async fn tombstone_workflow_trigger(
    org_id: &str,
    workflow_id: &str,
) -> Result<(), anyhow::Error> {
    let db = get_orm_client_rw().await;
    let tombstoned = tombstone_workflow_trigger_in(
        db,
        org_id,
        workflow_id,
        &config::get_cluster_name(),
        now_micros(),
    )
    .await?;
    if let Some(trigger_id) = tombstoned {
        emit_after_commit(&trigger_id).await;
    }
    Ok(())
}

async fn expire_retiring_in<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    local_cluster: &str,
    now_us: i64,
) -> Result<Expired, anyhow::Error> {
    let mut by_trigger: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for credential in http_triggers::list_expired_retiring(db, local_cluster, now_us).await? {
        by_trigger
            .entry(credential.trigger_id)
            .or_default()
            .push(credential.id);
    }
    let mut expired = Expired::default();
    for (trigger_id, credential_ids) in by_trigger {
        let revoked =
            revoke_expired_in(db, &trigger_id, &credential_ids, local_cluster, now_us).await?;
        if revoked > 0 {
            expired.credentials += revoked;
            expired.triggers.push(trigger_id);
        }
    }
    Ok(expired)
}

/// Re-checked under the trigger lock: a rotate or a takeover may have run since the list.
async fn revoke_expired_in<C: TransactionTrait>(
    db: &C,
    trigger_id: &str,
    credential_ids: &[String],
    local_cluster: &str,
    now_us: i64,
) -> Result<u64, anyhow::Error> {
    let txn = db.begin().await?;
    let trigger = http_triggers::get_for_update(&txn, trigger_id)
        .await?
        .filter(|trigger| trigger.deleted_at.is_none() && trigger.origin_cluster == local_cluster);
    let Some(trigger) = trigger else {
        txn.rollback().await?;
        return Ok(0);
    };
    let mut revoked = 0;
    for credential_id in credential_ids {
        let updated = credentials::Entity::update_many()
            .col_expr(
                credentials::Column::State,
                Expr::value(CredentialState::Revoked.as_str()),
            )
            .col_expr(credentials::Column::RevokedAt, Expr::value(now_us))
            .col_expr(credentials::Column::UpdatedAt, Expr::value(now_us))
            .col_expr(
                credentials::Column::SecretRef,
                Expr::value(Option::<String>::None),
            )
            .filter(credentials::Column::Id.eq(credential_id))
            .filter(credentials::Column::TriggerId.eq(trigger_id))
            .filter(credentials::Column::State.eq(CredentialState::Retiring.as_str()))
            .filter(credentials::Column::ExpiresAt.lt(now_us))
            .exec(&txn)
            .await?
            .rows_affected;
        if updated == 0 {
            continue;
        }
        secrets::delete_for_owner_in(
            &txn,
            &trigger.org_id,
            SecretOwnerKind::WorkflowTrigger,
            credential_id,
        )
        .await?;
        revoked += updated;
    }
    if revoked == 0 {
        txn.rollback().await?;
        return Ok(0);
    }
    triggers::Entity::update_many()
        .col_expr(triggers::Column::Version, Expr::value(trigger.version + 1))
        .col_expr(triggers::Column::UpdatedAt, Expr::value(now_us))
        .filter(triggers::Column::Id.eq(trigger_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(revoked)
}

async fn sweep_tombstones_in<C: ConnectionTrait>(
    db: &C,
    now_us: i64,
) -> Result<Vec<String>, anyhow::Error> {
    let before_us = now_us - TOMBSTONE_TTL_US;
    let swept = triggers::Entity::find()
        .select_only()
        .column(triggers::Column::Id)
        .filter(triggers::Column::DeletedAt.lt(before_us))
        .into_tuple()
        .all(db)
        .await?;
    http_triggers::delete_tombstones_before(db, before_us).await?;
    Ok(swept)
}

async fn anti_entropy_targets_in<C: ConnectionTrait>(
    db: &C,
    local_cluster: &str,
    now_us: i64,
) -> Result<Vec<String>, anyhow::Error> {
    let originated =
        http_triggers::list_originated(db, local_cluster, now_us - TOMBSTONE_TTL_US).await?;
    Ok(originated.into_iter().map(|trigger| trigger.id).collect())
}

async fn tombstone_workflow_trigger_in<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    org_id: &str,
    workflow_id: &str,
    local_cluster: &str,
    now_us: i64,
) -> Result<Option<String>, anyhow::Error> {
    let txn = db.begin().await?;
    let live = http_triggers::get_by_workflow(&txn, org_id, workflow_id)
        .await?
        .is_some_and(|trigger| trigger.deleted_at.is_none());
    let tombstoned = if live {
        http_triggers::tombstone_for_workflow(&txn, workflow_id, now_us).await?
    } else {
        None
    };
    let Some(trigger_id) = tombstoned else {
        txn.rollback().await?;
        return Ok(None);
    };
    triggers::Entity::update_many()
        .col_expr(triggers::Column::OriginCluster, Expr::value(local_cluster))
        .filter(triggers::Column::Id.eq(&trigger_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(Some(trigger_id))
}

/// The local change is committed, so a failed emit is logged and healed by anti-entropy.
async fn emit_after_commit(trigger_id: &str) {
    if let Err(e) = db::workflow_http_triggers::emit_snapshot(trigger_id).await {
        log::error!("[WORKFLOW_HOOK] snapshot emit for trigger {trigger_id} failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use infra::table::{
        entity::{llm_secrets, workflow_http_trigger_requests as requests},
        workflow_http_trigger_requests::{self as ledger, NewHookRequest},
        workflow_http_triggers::{AuthMode, CredentialKind},
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, PaginatorTrait};

    use super::*;

    const NOW: i64 = 1_760_000_000_000_000;
    const DAY: i64 = 24 * 3600 * 1_000_000;
    const LOCAL: &str = "r1";

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        http_triggers::create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn trigger(id: &str, origin: &str, deleted_at: Option<i64>) -> triggers::Model {
        triggers::Model {
            id: id.to_string(),
            org_id: "acme".to_string(),
            workflow_id: format!("wf-{id}"),
            enabled: true,
            auth_mode: AuthMode::Signature.as_str().to_string(),
            max_body_bytes: 1_048_576,
            rate_limit_per_minute: 60,
            created_by: "a@x.io".to_string(),
            created_at: NOW - 30 * DAY,
            updated_at: NOW - 30 * DAY,
            version: 1,
            origin_cluster: origin.to_string(),
            deleted_at,
            last_invoked_at: None,
            rejections: None,
        }
    }

    fn credential(
        id: &str,
        trigger_id: &str,
        state: CredentialState,
        expires_at: Option<i64>,
    ) -> credentials::Model {
        credentials::Model {
            id: id.to_string(),
            trigger_id: trigger_id.to_string(),
            org_id: "acme".to_string(),
            kind: CredentialKind::SigningSecret.as_str().to_string(),
            display_prefix: "whsec_abcd…wxyz".to_string(),
            token_sha256: None,
            secret_ref: None,
            state: state.as_str().to_string(),
            expires_at,
            revoked_at: (state == CredentialState::Revoked).then_some(NOW - 30 * DAY),
            created_by: "a@x.io".to_string(),
            created_at: NOW - 30 * DAY,
            updated_at: NOW - 30 * DAY,
            last_used_at: None,
        }
    }

    async fn seed(
        db: &DatabaseConnection,
        trigger: triggers::Model,
        credentials: &[credentials::Model],
    ) {
        http_triggers::insert_trigger(db, trigger).await.unwrap();
        for credential in credentials {
            let mut credential = credential.clone();
            let prepared = secrets::prepared_for_tests(
                "acme",
                SecretOwnerKind::WorkflowTrigger,
                &credential.id,
            );
            credential.secret_ref = Some(
                secrets::insert_prepared(db, prepared)
                    .await
                    .unwrap()
                    .metadata
                    .secret_ref,
            );
            http_triggers::insert_credential(db, credential)
                .await
                .unwrap();
        }
    }

    async fn queue_run(db: &DatabaseConnection, trigger_id: &str, run_id: &str) {
        let request = NewHookRequest {
            trigger_id: trigger_id.to_string(),
            org_id: "acme".to_string(),
            workflow_id: format!("wf-{trigger_id}"),
            run_id: run_id.to_string(),
            idem_key: None,
            body_sha256: "cd".repeat(32),
            body_bytes: 2,
            content_type: None,
            meta: "{}".to_string(),
            credential_id: "c1".to_string(),
            credential_prefix: "whsec_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.7".to_string(),
            received_at: NOW,
        };
        ledger::enqueue(db, request, "{}".to_string())
            .await
            .unwrap();
    }

    async fn stored(db: &DatabaseConnection, trigger_id: &str) -> Option<triggers::Model> {
        http_triggers::get(db, trigger_id).await.unwrap()
    }

    async fn credential_of(db: &DatabaseConnection, id: &str) -> Option<credentials::Model> {
        credentials::Entity::find_by_id(id).one(db).await.unwrap()
    }

    async fn secrets_of(db: &DatabaseConnection, owner_id: &str) -> u64 {
        llm_secrets::Entity::find()
            .filter(llm_secrets::Column::OwnerKind.eq("workflow_trigger"))
            .filter(llm_secrets::Column::OwnerId.eq(owner_id))
            .count(db)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn tombstoning_a_workflow_trigger_revokes_and_drops_queued_rows() {
        let db = db().await;
        seed(
            &db,
            trigger("t1", "r2", None),
            &[credential("c1", "t1", CredentialState::Active, None)],
        )
        .await;
        queue_run(&db, "t1", "run-1").await;

        let tombstoned = tombstone_workflow_trigger_in(&db, "acme", "wf-t1", LOCAL, NOW)
            .await
            .unwrap();
        assert_eq!(tombstoned.as_deref(), Some("t1"));
        let trigger = stored(&db, "t1").await.unwrap();
        assert_eq!(trigger.deleted_at, Some(NOW));
        assert_eq!(trigger.version, 2);
        assert_eq!(
            trigger.origin_cluster, LOCAL,
            "the deleting region takes over"
        );
        let revoked = credential_of(&db, "c1").await.unwrap();
        assert_eq!(revoked.state, "revoked");
        assert_eq!(revoked.revoked_at, Some(NOW));
        assert_eq!(secrets_of(&db, "c1").await, 0);
        assert_eq!(requests::Entity::find().count(&db).await.unwrap(), 0);

        let again = tombstone_workflow_trigger_in(&db, "acme", "wf-t1", LOCAL, NOW + 1)
            .await
            .unwrap();
        assert_eq!(again, None, "a tombstone is not tombstoned twice");
        assert_eq!(stored(&db, "t1").await.unwrap().version, 2);
    }

    #[tokio::test]
    async fn a_workflow_of_another_org_is_not_tombstoned() {
        let db = db().await;
        seed(&db, trigger("t1", LOCAL, None), &[]).await;
        let tombstoned = tombstone_workflow_trigger_in(&db, "other", "wf-t1", LOCAL, NOW)
            .await
            .unwrap();
        assert_eq!(tombstoned, None);
        assert_eq!(stored(&db, "t1").await.unwrap().deleted_at, None);
    }

    #[tokio::test]
    async fn expired_retiring_credentials_are_revoked_only_for_local_triggers() {
        let db = db().await;
        seed(
            &db,
            trigger("t-local", LOCAL, None),
            &[
                credential("c-old", "t-local", CredentialState::Retiring, Some(NOW - 1)),
                credential(
                    "c-live",
                    "t-local",
                    CredentialState::Retiring,
                    Some(NOW + DAY),
                ),
                credential("c-active", "t-local", CredentialState::Active, None),
            ],
        )
        .await;
        seed(
            &db,
            trigger("t-remote", "r2", None),
            &[credential(
                "c-remote",
                "t-remote",
                CredentialState::Retiring,
                Some(NOW - 1),
            )],
        )
        .await;

        let expired = expire_retiring_in(&db, LOCAL, NOW).await.unwrap();
        assert_eq!(
            expired,
            Expired {
                credentials: 1,
                triggers: vec!["t-local".to_string()],
            }
        );
        let old = credential_of(&db, "c-old").await.unwrap();
        assert_eq!(
            (
                old.state.as_str(),
                old.revoked_at,
                old.updated_at,
                old.secret_ref
            ),
            ("revoked", Some(NOW), NOW, None)
        );
        assert_eq!(secrets_of(&db, "c-old").await, 0);
        assert_eq!(
            credential_of(&db, "c-live").await.unwrap().state,
            "retiring"
        );
        assert_eq!(
            credential_of(&db, "c-active").await.unwrap().state,
            "active"
        );
        assert_eq!(secrets_of(&db, "c-live").await, 1);
        let local = stored(&db, "t-local").await.unwrap();
        assert_eq!((local.version, local.updated_at), (2, NOW));
        assert_eq!(
            credential_of(&db, "c-remote").await.unwrap().state,
            "retiring",
            "the origin region expires its own credentials"
        );
        assert_eq!(stored(&db, "t-remote").await.unwrap().version, 1);

        let again = expire_retiring_in(&db, LOCAL, NOW).await.unwrap();
        assert_eq!(again, Expired::default());
    }

    #[tokio::test]
    async fn expiring_a_retiring_token_deletes_its_secret() {
        let db = db().await;
        let mut trig = trigger("t-tok", LOCAL, None);
        trig.auth_mode = AuthMode::Token.as_str().to_string();
        let mut old = credential("c-tok", "t-tok", CredentialState::Retiring, Some(NOW - 1));
        old.kind = CredentialKind::Token.as_str().to_string();
        old.display_prefix = "o2wh_abcd…wxyz".to_string();
        old.token_sha256 = Some("ab".repeat(32));
        seed(&db, trig, &[old]).await;
        assert_eq!(secrets_of(&db, "c-tok").await, 1);

        let expired = expire_retiring_in(&db, LOCAL, NOW).await.unwrap();
        assert_eq!(expired.credentials, 1);
        let stored = credential_of(&db, "c-tok").await.unwrap();
        assert_eq!(
            (stored.state.as_str(), stored.secret_ref),
            ("revoked", None)
        );
        assert_eq!(secrets_of(&db, "c-tok").await, 0);
        assert_eq!(stored.token_sha256, Some("ab".repeat(32)));
    }

    #[tokio::test]
    async fn tombstones_older_than_seven_days_are_deleted() {
        let db = db().await;
        seed(
            &db,
            trigger("t-old", LOCAL, Some(NOW - 8 * DAY)),
            &[credential("c-old", "t-old", CredentialState::Revoked, None)],
        )
        .await;
        seed(&db, trigger("t-recent", "r2", Some(NOW - DAY)), &[]).await;
        let mut swept = credential("c-swept", "t-live", CredentialState::Revoked, None);
        swept.revoked_at = Some(NOW - 8 * DAY);
        let mut kept = credential("c-kept", "t-live", CredentialState::Revoked, None);
        kept.revoked_at = Some(NOW - DAY);
        seed(&db, trigger("t-live", LOCAL, None), &[swept, kept]).await;

        let swept = sweep_tombstones_in(&db, NOW).await.unwrap();
        assert_eq!(
            swept,
            ["t-old"],
            "swept triggers are named so their keys go too"
        );
        assert!(stored(&db, "t-old").await.is_none());
        assert!(credential_of(&db, "c-old").await.is_none());
        assert!(stored(&db, "t-recent").await.is_some());
        assert!(stored(&db, "t-live").await.is_some());
        assert!(credential_of(&db, "c-swept").await.is_none());
        assert!(credential_of(&db, "c-kept").await.is_some());
    }

    #[tokio::test]
    async fn anti_entropy_emits_every_local_trigger_including_recent_tombstones() {
        let db = db().await;
        seed(&db, trigger("t-live", LOCAL, None), &[]).await;
        seed(&db, trigger("t-recent", LOCAL, Some(NOW - DAY)), &[]).await;
        seed(&db, trigger("t-old", LOCAL, Some(NOW - 8 * DAY)), &[]).await;
        seed(&db, trigger("t-remote", "r2", None), &[]).await;
        let targets = anti_entropy_targets_in(&db, LOCAL, NOW).await.unwrap();
        assert_eq!(targets, ["t-live", "t-recent"]);
    }
}
