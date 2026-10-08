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

//! Every mutation is one transaction; row locks are taken events first, each in id order.

use std::future::Future;

use infra::table::rum_pa::{self, FunnelRow, Funnels, MAX_PER_APP, NamedEventRow, NamedEvents};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::Serialize;

use super::{
    CreateFunnel, CreateNamedEvent, Current, FunnelDef, FunnelRef, NamedEvent, RumPaError,
    SavedFunnel, UpdateFunnel, UpdateNamedEvent, validate_def, validate_description, validate_name,
    validate_rules, validate_sql,
};

/// The super-cluster meta-topic module; keys are `/rum_analytics/{org}/{table}/{id}`.
pub const REPLICATION_MODULE: &str = "rum_analytics";
pub const EVENTS_TABLE: &str = "named_events";
pub const FUNNELS_TABLE: &str = "funnels";

/// The org and app every query is filtered by; never taken from a body.
#[derive(Debug, Clone, Copy)]
pub struct Scope<'a> {
    pub org: &'a str,
    pub app: &'a str,
}

/// A validated named event, ready to store.
struct EventDraft {
    name: String,
    rules: serde_json::Value,
}

/// A validated saved funnel, ready to store.
struct FunnelDraft {
    name: String,
    description: Option<String>,
    definition: serde_json::Value,
    event_ids: Vec<String>,
    sql: String,
}

pub fn row_key(org: &str, table: &str, id: &str) -> String {
    format!("/{REPLICATION_MODULE}/{org}/{table}/{id}")
}

pub fn org_key(org: &str) -> String {
    format!("/{REPLICATION_MODULE}/{org}/")
}

pub async fn list_events<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
) -> Result<Vec<NamedEvent>, RumPaError> {
    Ok(rum_pa::list::<NamedEvents, _>(db, scope.org, scope.app)
        .await?
        .into_iter()
        .map(NamedEvent::from)
        .collect())
}

pub async fn get_event<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
) -> Result<NamedEvent, RumPaError> {
    rum_pa::get::<NamedEvents, _>(db, scope.org, scope.app, id)
        .await?
        .map(NamedEvent::from)
        .ok_or(RumPaError::NotFound)
}

pub async fn create_event<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    user: &str,
    body: &CreateNamedEvent,
) -> Result<NamedEvent, RumPaError> {
    let draft = event_draft(&body.name, &body.rules)?;
    let row = retry_once(|| create_event_once(db, scope, user, &draft)).await?;
    emit_put(scope.org, EVENTS_TABLE, &row.id, &row).await;
    Ok(row.into())
}

pub async fn update_event<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
    user: &str,
    body: &UpdateNamedEvent,
) -> Result<NamedEvent, RumPaError> {
    let draft = event_draft(&body.name, &body.rules)?;
    let row = retry_once(|| update_event_once(db, scope, id, user, &draft, body.version)).await?;
    emit_put(scope.org, EVENTS_TABLE, &row.id, &row).await;
    Ok(row.into())
}

/// Without `force`, an event a saved funnel still uses is refused with those funnels.
pub async fn delete_event<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
    force: bool,
) -> Result<(), RumPaError> {
    let row = retry_once(|| delete_event_once(db, scope, id, force)).await?;
    emit_delete(scope.org, EVENTS_TABLE, &row.id, row.version).await;
    Ok(())
}

/// The saved funnels whose steps use the event, whether or not the event still exists.
pub async fn event_usages<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
) -> Result<Vec<FunnelRef>, RumPaError> {
    Ok(rum_pa::list::<Funnels, _>(db, scope.org, scope.app)
        .await?
        .into_iter()
        .filter(|f| uses(f, id))
        .map(|f| FunnelRef {
            id: f.id,
            name: f.name,
        })
        .collect())
}

pub async fn list_funnels<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
) -> Result<Vec<SavedFunnel>, RumPaError> {
    Ok(rum_pa::list::<Funnels, _>(db, scope.org, scope.app)
        .await?
        .into_iter()
        .map(SavedFunnel::from)
        .collect())
}

pub async fn get_funnel<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
) -> Result<SavedFunnel, RumPaError> {
    rum_pa::get::<Funnels, _>(db, scope.org, scope.app, id)
        .await?
        .map(SavedFunnel::from)
        .ok_or(RumPaError::NotFound)
}

pub async fn create_funnel<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    user: &str,
    body: &CreateFunnel,
) -> Result<SavedFunnel, RumPaError> {
    let draft = funnel_draft(
        &body.name,
        body.description.as_deref(),
        &body.def,
        &body.sql,
    )?;
    let row = retry_once(|| create_funnel_once(db, scope, user, &draft)).await?;
    emit_put(scope.org, FUNNELS_TABLE, &row.id, &row).await;
    Ok(row.into())
}

/// Ids already in the stored `event_ids` may outlive their event; new ones must exist.
pub async fn update_funnel<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
    user: &str,
    body: &UpdateFunnel,
) -> Result<SavedFunnel, RumPaError> {
    let draft = funnel_draft(
        &body.name,
        body.description.as_deref(),
        &body.def,
        &body.sql,
    )?;
    let row = retry_once(|| update_funnel_once(db, scope, id, user, &draft, body.version)).await?;
    emit_put(scope.org, FUNNELS_TABLE, &row.id, &row).await;
    Ok(row.into())
}

pub async fn delete_funnel<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
) -> Result<(), RumPaError> {
    let row = retry_once(|| delete_funnel_once(db, scope, id)).await?;
    emit_delete(scope.org, FUNNELS_TABLE, &row.id, row.version).await;
    Ok(())
}

/// Replicates an org's removal; org cleanup only runs in the region that started it.
pub async fn emit_delete_org(org: &str) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::delete(
            &org_key(org),
            true,
            false,
            None,
        )
        .await
    {
        log::error!("[rum_pa] super-cluster org delete publish failed for {org}: {e}");
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = org;
}

fn event_draft(name: &str, rules: &[super::Rule]) -> Result<EventDraft, RumPaError> {
    let name = validate_name(name)?;
    validate_rules(rules)?;
    Ok(EventDraft {
        name,
        rules: serde_json::to_value(rules).map_err(internal)?,
    })
}

fn funnel_draft(
    name: &str,
    description: Option<&str>,
    def: &FunnelDef,
    sql: &str,
) -> Result<FunnelDraft, RumPaError> {
    let name = validate_name(name)?;
    let description = validate_description(description)?;
    let (definition, event_ids) = validate_def(def)?;
    validate_sql(sql)?;
    Ok(FunnelDraft {
        name,
        description,
        definition,
        event_ids,
        sql: sql.to_string(),
    })
}

/// Runs a transaction again once after a Postgres deadlock or serialization failure.
async fn retry_once<T, F, Fut>(mut attempt: F) -> Result<T, RumPaError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, RumPaError>>,
{
    match attempt().await {
        Err(RumPaError::Internal {
            message,
            retry: true,
        }) => {
            log::warn!("[rum_pa] retrying after a lock conflict: {message}");
            attempt().await
        }
        other => other,
    }
}

async fn create_event_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    user: &str,
    draft: &EventDraft,
) -> Result<NamedEventRow, RumPaError> {
    let txn = db.begin().await?;
    rum_pa::lock_app_ordered::<NamedEvents, _>(&txn, scope.org, scope.app).await?;
    if rum_pa::count::<NamedEvents, _>(&txn, scope.org, scope.app).await? >= MAX_PER_APP {
        return Err(RumPaError::LimitReached);
    }
    let now = now_ms();
    let row = NamedEventRow {
        id: config::ider::uuid(),
        org_id: scope.org.to_string(),
        app: scope.app.to_string(),
        name: draft.name.clone(),
        name_key: rum_pa::name_key(&draft.name),
        rules: draft.rules.clone(),
        version: 1,
        created_by: user.to_string(),
        updated_by: user.to_string(),
        created_at: now,
        updated_at: now,
    };
    rum_pa::insert::<NamedEvents, _>(&txn, row.clone()).await?;
    txn.commit().await?;
    Ok(row)
}

async fn update_event_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
    user: &str,
    draft: &EventDraft,
    version: i32,
) -> Result<NamedEventRow, RumPaError> {
    let txn = db.begin().await?;
    let stored = rum_pa::get::<NamedEvents, _>(&txn, scope.org, scope.app, id)
        .await?
        .ok_or(RumPaError::NotFound)?;
    let row = NamedEventRow {
        name: draft.name.clone(),
        name_key: rum_pa::name_key(&draft.name),
        rules: draft.rules.clone(),
        version: version.saturating_add(1),
        updated_by: user.to_string(),
        updated_at: now_ms(),
        ..stored
    };
    let changed = rum_pa::update_if_version::<NamedEvents, _>(
        &txn,
        scope.org,
        scope.app,
        id,
        version,
        row.clone(),
    )
    .await?;
    if changed == 0 {
        return Err(
            match rum_pa::get::<NamedEvents, _>(&txn, scope.org, scope.app, id).await? {
                Some(current) => {
                    RumPaError::VersionConflict(Box::new(Current::Event(current.into())))
                }
                None => RumPaError::NotFound,
            },
        );
    }
    txn.commit().await?;
    Ok(row)
}

async fn delete_event_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
    force: bool,
) -> Result<NamedEventRow, RumPaError> {
    let txn = db.begin().await?;
    let row = rum_pa::get_for_update::<NamedEvents, _>(&txn, scope.org, scope.app, id)
        .await?
        .ok_or(RumPaError::NotFound)?;
    if !force {
        let users = event_usages(&txn, scope, id).await?;
        if !users.is_empty() {
            return Err(RumPaError::EventInUse(users));
        }
    }
    rum_pa::delete::<NamedEvents, _>(&txn, scope.org, scope.app, id, row.version).await?;
    txn.commit().await?;
    Ok(row)
}

async fn create_funnel_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    user: &str,
    draft: &FunnelDraft,
) -> Result<FunnelRow, RumPaError> {
    let txn = db.begin().await?;
    check_events(&txn, scope, &draft.event_ids, &[]).await?;
    rum_pa::lock_app_ordered::<Funnels, _>(&txn, scope.org, scope.app).await?;
    if rum_pa::count::<Funnels, _>(&txn, scope.org, scope.app).await? >= MAX_PER_APP {
        return Err(RumPaError::LimitReached);
    }
    let now = now_ms();
    let row = FunnelRow {
        id: config::ider::uuid(),
        org_id: scope.org.to_string(),
        app: scope.app.to_string(),
        name: draft.name.clone(),
        name_key: rum_pa::name_key(&draft.name),
        description: draft.description.clone(),
        definition: draft.definition.clone(),
        sql: draft.sql.clone(),
        event_ids: serde_json::to_value(&draft.event_ids).map_err(internal)?,
        version: 1,
        created_by: user.to_string(),
        updated_by: user.to_string(),
        created_at: now,
        updated_at: now,
    };
    rum_pa::insert::<Funnels, _>(&txn, row.clone()).await?;
    txn.commit().await?;
    Ok(row)
}

async fn update_funnel_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
    user: &str,
    draft: &FunnelDraft,
    version: i32,
) -> Result<FunnelRow, RumPaError> {
    let txn = db.begin().await?;
    let stored = rum_pa::get::<Funnels, _>(&txn, scope.org, scope.app, id)
        .await?
        .ok_or(RumPaError::NotFound)?;
    check_events(&txn, scope, &draft.event_ids, &stored_ids(&stored)).await?;
    let row = FunnelRow {
        name: draft.name.clone(),
        name_key: rum_pa::name_key(&draft.name),
        description: draft.description.clone(),
        definition: draft.definition.clone(),
        sql: draft.sql.clone(),
        event_ids: serde_json::to_value(&draft.event_ids).map_err(internal)?,
        version: version.saturating_add(1),
        updated_by: user.to_string(),
        updated_at: now_ms(),
        ..stored
    };
    let changed = rum_pa::update_if_version::<Funnels, _>(
        &txn,
        scope.org,
        scope.app,
        id,
        version,
        row.clone(),
    )
    .await?;
    if changed == 0 {
        return Err(
            match rum_pa::get::<Funnels, _>(&txn, scope.org, scope.app, id).await? {
                Some(current) => {
                    RumPaError::VersionConflict(Box::new(Current::Funnel(current.into())))
                }
                None => RumPaError::NotFound,
            },
        );
    }
    txn.commit().await?;
    Ok(row)
}

async fn delete_funnel_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
) -> Result<FunnelRow, RumPaError> {
    let txn = db.begin().await?;
    let row = rum_pa::get_for_update::<Funnels, _>(&txn, scope.org, scope.app, id)
        .await?
        .ok_or(RumPaError::NotFound)?;
    rum_pa::delete::<Funnels, _>(&txn, scope.org, scope.app, id, row.version).await?;
    txn.commit().await?;
    Ok(row)
}

/// Locks the referenced events `FOR SHARE`, so none is deleted before this save commits.
async fn check_events<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
    ids: &[String],
    allowed_orphans: &[String],
) -> Result<(), RumPaError> {
    let found = rum_pa::lock_events_ordered(db, scope.org, scope.app, ids).await?;
    let missing: Vec<String> = ids
        .iter()
        .filter(|id| !found.iter().any(|row| &row.id == *id) && !allowed_orphans.contains(id))
        .cloned()
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(RumPaError::UnknownEvent(missing))
    }
}

fn stored_ids(row: &FunnelRow) -> Vec<String> {
    serde_json::from_value(row.event_ids.clone()).unwrap_or_default()
}

fn uses(row: &FunnelRow, event_id: &str) -> bool {
    row.event_ids
        .as_array()
        .is_some_and(|ids| ids.iter().any(|v| v.as_str() == Some(event_id)))
}

fn internal(e: impl std::fmt::Display) -> RumPaError {
    RumPaError::Internal {
        message: e.to_string(),
        retry: false,
    }
}

fn now_ms() -> i64 {
    config::utils::time::now_micros() / 1000
}

/// Best-effort: a publish failure is logged and never fails the local write.
async fn emit_put<R: Serialize + Sync>(org: &str, table: &str, id: &str, row: &R) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = row_key(org, table, id);
        match serde_json::to_vec(row) {
            Ok(value) => {
                if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::put(
                    &key,
                    value.into(),
                    false,
                    None,
                )
                .await
                {
                    log::error!("[rum_pa] super-cluster put publish failed for {key}: {e}");
                }
            }
            Err(e) => log::error!("[rum_pa] serialize {key} for replication failed: {e}"),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org, table, id, row);
}

/// The deleted row's version rides in `start_dt`: the generic delete carries no value.
async fn emit_delete(org: &str, table: &str, id: &str, version: i32) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = row_key(org, table, id);
        if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::delete(
            &key,
            false,
            false,
            Some(i64::from(version)),
        )
        .await
        {
            log::error!("[rum_pa] super-cluster delete publish failed for {key}: {e}");
        }
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org, table, id, version);
}

#[cfg(test)]
mod tests {
    use std::{
        sync::atomic::{AtomicUsize, Ordering},
        time::Duration,
    };

    use infra::table::rum_pa::PaTable;
    use sea_orm::{
        ColumnTrait, ConnectOptions, Database, DatabaseConnection, DbBackend, EntityTrait,
        QueryFilter, QueryOrder, QuerySelect, Statement,
        sea_query::{LockBehavior, LockType},
    };

    use super::*;
    use crate::rum_pa::{Rule, ViewOp, replication, validate_id};

    const ORG: &str = "acme";
    const APP: &str = "web";
    const SCOPE: Scope<'static> = Scope { org: ORG, app: APP };
    /// Ids that `en_US` sorts one way and byte order the other.
    const COLLATION_PAIR: [&str; 2] =
        ["3K5oMUeRsLbOzg2dWJ8nizxS9yx", "3K5oMUSC7GimYH50eWZTjjYy9Sc"];

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        rum_pa::create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn event_body(name: &str) -> CreateNamedEvent {
        CreateNamedEvent {
            name: name.to_string(),
            rules: vec![Rule::View {
                op: ViewOp::Eq,
                value: "/signup".to_string(),
            }],
        }
    }

    fn funnel_def(steps: &[(&str, &str)]) -> FunnelDef {
        FunnelDef {
            s: steps
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            u: None,
            w: None,
            b: None,
        }
    }

    fn funnel_body(name: &str, steps: &[(&str, &str)]) -> CreateFunnel {
        CreateFunnel {
            name: name.to_string(),
            description: None,
            def: funnel_def(steps),
            sql: "SELECT 1".to_string(),
        }
    }

    fn funnel_update(created: &SavedFunnel, steps: &[(&str, &str)]) -> UpdateFunnel {
        UpdateFunnel {
            name: created.name.clone(),
            description: None,
            def: funnel_def(steps),
            sql: "SELECT 2".to_string(),
            version: created.version,
        }
    }

    async fn create(db: &DatabaseConnection, scope: Scope<'_>, name: &str) -> NamedEvent {
        create_event(db, scope, "a@x.io", &event_body(name))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_created_id_passes_the_id_validator() {
        let db = db().await;
        let event = create(&db, SCOPE, "Signup").await;
        validate_id(&event.id).unwrap();
        assert_eq!((event.version, event.created_by.as_str()), (1, "a@x.io"));
        let funnel = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body("F", &[("p", "/"), ("e", &event.id)]),
        )
        .await
        .unwrap();
        validate_id(&funnel.id).unwrap();
    }

    #[tokio::test]
    async fn the_51st_create_in_an_app_is_limit_reached() {
        let db = db().await;
        for i in 0..50 {
            create(&db, SCOPE, &format!("event {i}")).await;
        }
        let err = create_event(&db, SCOPE, "a@x.io", &event_body("one more"))
            .await
            .unwrap_err();
        assert_eq!(err, RumPaError::LimitReached);
        create(
            &db,
            Scope {
                org: ORG,
                app: "ios",
            },
            "one more",
        )
        .await;
        for i in 0..50 {
            create_funnel(
                &db,
                SCOPE,
                "a@x.io",
                &funnel_body(&format!("f{i}"), &[("p", "/"), ("p", "/a")]),
            )
            .await
            .unwrap();
        }
        let err = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body("f50", &[("p", "/"), ("p", "/a")]),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "limit_reached");
    }

    #[tokio::test]
    async fn duplicate_name_folds_case_and_trims() {
        let db = db().await;
        let first = create(&db, SCOPE, "Signup").await;
        let err = create_event(&db, SCOPE, "a@x.io", &event_body("  SIGNUP "))
            .await
            .unwrap_err();
        assert_eq!(err, RumPaError::DuplicateName);
        let other = create(&db, SCOPE, "Login").await;
        let rename = UpdateNamedEvent {
            name: "signup".into(),
            rules: event_body("x").rules,
            version: other.version,
        };
        assert_eq!(
            update_event(&db, SCOPE, &other.id, "a@x.io", &rename)
                .await
                .unwrap_err(),
            RumPaError::DuplicateName
        );
        assert_eq!(
            get_event(&db, SCOPE, &first.id).await.unwrap().name,
            "Signup"
        );
    }

    #[tokio::test]
    async fn a_stale_version_is_a_conflict_carrying_the_current_row() {
        let db = db().await;
        let created = create(&db, SCOPE, "Signup").await;
        let edit = |name: &str| UpdateNamedEvent {
            name: name.into(),
            rules: event_body("x").rules,
            version: created.version,
        };
        let saved = update_event(&db, SCOPE, &created.id, "b@x.io", &edit("Signed up"))
            .await
            .unwrap();
        assert_eq!((saved.version, saved.updated_by.as_str()), (2, "b@x.io"));
        let err = update_event(&db, SCOPE, &created.id, "c@x.io", &edit("Stale"))
            .await
            .unwrap_err();
        assert_eq!(err.code(), "version_conflict");
        assert_eq!(err.body().current, Some(Current::Event(saved.clone())));
        let gone = update_event(
            &db,
            SCOPE,
            "2kY9pF34Qy6nB3Wwd25rq4f5zr3",
            "c@x.io",
            &edit("x"),
        )
        .await
        .unwrap_err();
        assert_eq!(gone, RumPaError::NotFound);
    }

    #[tokio::test]
    async fn an_event_in_use_needs_force_and_its_funnel_keeps_the_orphan_id() {
        let db = db().await;
        let event = create(&db, SCOPE, "Signup").await;
        let funnel = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body("Flow", &[("p", "/"), ("e", &event.id)]),
        )
        .await
        .unwrap();
        assert_eq!(funnel.event_ids, serde_json::json!([event.id]));

        let err = delete_event(&db, SCOPE, &event.id, false)
            .await
            .unwrap_err();
        let refs = vec![FunnelRef {
            id: funnel.id.clone(),
            name: "Flow".into(),
        }];
        assert_eq!(err, RumPaError::EventInUse(refs.clone()));
        assert_eq!(err.body().funnels, Some(refs.clone()));
        delete_event(&db, SCOPE, &event.id, true).await.unwrap();
        assert_eq!(
            get_event(&db, SCOPE, &event.id).await.unwrap_err(),
            RumPaError::NotFound
        );
        assert_eq!(event_usages(&db, SCOPE, &event.id).await.unwrap(), refs);

        let kept = update_funnel(
            &db,
            SCOPE,
            &funnel.id,
            "b@x.io",
            &funnel_update(&funnel, &[("e", &event.id), ("p", "/")]),
        )
        .await
        .unwrap();
        assert_eq!(kept.version, 2);
        let err = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body("Copy", &[("p", "/"), ("e", &event.id)]),
        )
        .await
        .unwrap_err();
        assert_eq!(err, RumPaError::UnknownEvent(vec![event.id.clone()]));
    }

    #[tokio::test]
    async fn an_update_adding_a_missing_event_is_unknown_event() {
        let db = db().await;
        let funnel = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body("Flow", &[("p", "/"), ("p", "/a")]),
        )
        .await
        .unwrap();
        let other_app = create(
            &db,
            Scope {
                org: ORG,
                app: "ios",
            },
            "Signup",
        )
        .await;
        let err = update_funnel(
            &db,
            SCOPE,
            &funnel.id,
            "a@x.io",
            &funnel_update(&funnel, &[("p", "/"), ("e", &other_app.id)]),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "unknown_event");
    }

    #[tokio::test]
    async fn event_ids_are_derived_from_the_definition() {
        let db = db().await;
        let a = create(&db, SCOPE, "A").await;
        let b = create(&db, SCOPE, "B").await;
        let funnel = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body(
                "Flow",
                &[("e", &b.id), ("p", "/"), ("e", &a.id), ("e", &b.id)],
            ),
        )
        .await
        .unwrap();
        assert_eq!(funnel.event_ids, serde_json::json!([b.id, a.id]));
        assert_eq!(funnel.def["u"], "sessions");
        assert_eq!(funnel.def["w"], "session");
    }

    #[tokio::test]
    async fn saving_a_deleted_funnel_is_not_found() {
        let db = db().await;
        let funnel = create_funnel(
            &db,
            SCOPE,
            "a@x.io",
            &funnel_body("Flow", &[("p", "/"), ("p", "/a")]),
        )
        .await
        .unwrap();
        delete_funnel(&db, SCOPE, &funnel.id).await.unwrap();
        assert_eq!(
            update_funnel(
                &db,
                SCOPE,
                &funnel.id,
                "a@x.io",
                &funnel_update(&funnel, &[("p", "/"), ("p", "/b")])
            )
            .await
            .unwrap_err(),
            RumPaError::NotFound
        );
        assert_eq!(
            delete_funnel(&db, SCOPE, &funnel.id).await.unwrap_err(),
            RumPaError::NotFound
        );
    }

    #[tokio::test]
    async fn a_lock_conflict_is_retried_once_and_other_errors_never() {
        let calls = AtomicUsize::new(0);
        let retryable = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>(RumPaError::Internal {
                message: "deadlock detected".into(),
                retry: true,
            })
        };
        assert_eq!(retry_once(retryable).await.unwrap_err().status(), 500);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let calls = AtomicUsize::new(0);
        let plain = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>(RumPaError::LimitReached)
        };
        assert!(retry_once(plain).await.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    /// The global RW client, which CI's unit-test jobs point at an init-db'd Postgres or SQLite.
    async fn global() -> Option<&'static DatabaseConnection> {
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return None;
        }
        let db = infra::db::get_orm_client_rw().await;
        rum_pa::create_tables_for_tests(db).await.unwrap();
        Some(db)
    }

    /// One test: the global pool is bound to the runtime that first opened it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrency_on_the_global_meta_store() {
        let Some(db) = global().await else { return };
        concurrent_creates_at_49_admit_exactly_one(db).await;
        a_racing_delete_and_funnel_save_never_leave_a_dangling_reference(db).await;
        for ids in [None, Some(COLLATION_PAIR)] {
            the_applier_locks_rows_in_id_order_like_a_local_create(db, ids).await;
            an_applier_racing_a_local_create_converges(db, ids).await;
        }
        tombstones_keep_deleted_rows_away(db).await;
        two_puts_racing_on_an_absent_row_keep_the_newer(db).await;
        a_put_racing_its_delete_never_resurrects_the_row(db).await;
    }

    async fn tombstones_keep_deleted_rows_away(db: &'static DatabaseConnection) {
        let org = format!("rumpa_{}", config::ider::uuid());
        let early = stored_event(&org, &config::ider::uuid(), "early delete");
        unreplicate(db, &early, 1).await.unwrap();
        replicate(db, &early).await.unwrap();
        assert!(stored(db, &early).await.is_none(), "delete before put");

        let redelivered = stored_event(&org, &config::ider::uuid(), "redelivered");
        replicate(db, &redelivered).await.unwrap();
        unreplicate(db, &redelivered, 1).await.unwrap();
        replicate(db, &redelivered).await.unwrap();
        assert!(stored(db, &redelivered).await.is_none(), "put after delete");

        let scope = Scope {
            org: &org,
            app: APP,
        };
        let local = create(db, scope, "local").await;
        let row = rum_pa::get::<NamedEvents, _>(db, &org, APP, &local.id)
            .await
            .unwrap()
            .unwrap();
        delete_event(db, scope, &local.id, false).await.unwrap();
        replicate(db, &row).await.unwrap();
        assert!(stored(db, &row).await.is_none(), "put after a local delete");
        assert!(list_events(db, scope).await.unwrap().is_empty());

        let newer = NamedEventRow {
            version: 2,
            ..early.clone()
        };
        replicate(db, &newer).await.unwrap();
        assert_eq!(stored(db, &newer).await.map(|r| r.version), Some(2));
        rum_pa::apply_delete_org(db, &org).await.unwrap();
    }

    /// v1 lands first while v2 already passed its read; v2 must still win.
    async fn two_puts_racing_on_an_absent_row_keep_the_newer(db: &'static DatabaseConnection) {
        let pg = db.get_database_backend() == DbBackend::Postgres;
        for round in 0..10 {
            let org = format!("rumpa_{}", config::ider::uuid());
            let anchor = create(
                db,
                Scope {
                    org: &org,
                    app: APP,
                },
                "anchor",
            )
            .await;
            let v1 = stored_event(&org, &config::ider::uuid(), "raced");
            let v2 = NamedEventRow {
                version: 2,
                updated_at: 2,
                ..v1.clone()
            };
            let gate = if pg {
                Some(hold_row(db, &org, &anchor.id).await)
            } else {
                None
            };
            let first = v1.clone();
            let a = tokio::spawn(async move { replicate(db, &first).await });
            if pg {
                wait_until_waiting(db, 1).await;
            }
            let second = v2.clone();
            let b = tokio::spawn(async move { replicate(db, &second).await });
            if pg {
                wait_until_waiting(db, 2).await;
            }
            if let Some(gate) = gate {
                gate.commit().await.unwrap();
            }
            let (a, b) = (a.await.unwrap(), b.await.unwrap());
            assert!(a.is_ok() && b.is_ok(), "round {round}: {a:?} {b:?}");
            assert_eq!(
                stored(db, &v1).await.map(|r| r.version),
                Some(2),
                "round {round}: the newer put was dropped"
            );
            rum_pa::apply_delete_org(db, &org).await.unwrap();
        }
    }

    /// The delete runs while the put waits before its tombstone read, then at its insert.
    async fn a_put_racing_its_delete_never_resurrects_the_row(db: &'static DatabaseConnection) {
        let pg = db.get_database_backend() == DbBackend::Postgres;
        for at_insert in [false, true] {
            for round in 0..10 {
                let org = format!("rumpa_{}", config::ider::uuid());
                let anchor = create(
                    db,
                    Scope {
                        org: &org,
                        app: APP,
                    },
                    "anchor",
                )
                .await;
                let row = stored_event(&org, &config::ider::uuid(), "doomed");
                let gate = match (pg, at_insert) {
                    (false, _) => None,
                    (true, false) => Some(hold_row(db, &org, &anchor.id).await),
                    (true, true) => Some(hold_id(db, &row).await),
                };
                let incoming = row.clone();
                let put = tokio::spawn(async move { replicate(db, &incoming).await });
                if pg {
                    wait_until_waiting(db, 1).await;
                }
                let doomed = row.clone();
                let delete = tokio::spawn(async move { unreplicate(db, &doomed, 1).await });
                if pg {
                    for _ in 0..3000 {
                        if delete.is_finished() || waiting(db).await >= 2 {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                }
                if let Some(gate) = gate {
                    gate.rollback().await.unwrap();
                }
                let (put, delete) = (put.await.unwrap(), delete.await.unwrap());
                let at = if at_insert { "insert" } else { "app lock" };
                assert!(
                    put.is_ok() && delete.is_ok(),
                    "{at} {round}: {put:?} {delete:?}"
                );
                assert!(
                    stored(db, &row).await.is_none(),
                    "{at} {round}: the deleted row came back"
                );
                rum_pa::apply_delete_org(db, &org).await.unwrap();
            }
        }
    }

    /// A transaction holding the row `FOR UPDATE`, which every applier's app lock waits on.
    async fn hold_row(
        db: &'static DatabaseConnection,
        org: &str,
        id: &str,
    ) -> sea_orm::DatabaseTransaction {
        let gate = db.begin().await.unwrap();
        rum_pa::get_for_update::<NamedEvents, _>(&gate, org, APP, id)
            .await
            .unwrap();
        gate
    }

    /// An uncommitted insert of the row's id, which an applier's insert waits on.
    async fn hold_id(
        db: &'static DatabaseConnection,
        row: &NamedEventRow,
    ) -> sea_orm::DatabaseTransaction {
        let gate = db.begin().await.unwrap();
        rum_pa::insert::<NamedEvents, _>(&gate, row.clone())
            .await
            .unwrap();
        gate
    }

    async fn unreplicate(
        db: &'static DatabaseConnection,
        row: &NamedEventRow,
        version: i64,
    ) -> Result<(), String> {
        let key = row_key(&row.org_id, EVENTS_TABLE, &row.id);
        let op = replication::Op::Delete {
            prefix: false,
            version: Some(version),
        };
        replication::apply(db, &key, op).await
    }

    async fn stored(db: &'static DatabaseConnection, row: &NamedEventRow) -> Option<NamedEventRow> {
        rum_pa::get::<NamedEvents, _>(db, &row.org_id, APP, &row.id)
            .await
            .unwrap()
    }

    /// Sessions of this database currently waiting on a lock.
    async fn waiting(db: &DatabaseConnection) -> i64 {
        let probe = Statement::from_string(
            DbBackend::Postgres,
            "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0",
        );
        let row = db.query_one(probe).await.unwrap().unwrap();
        row.try_get::<i64>("", "n").unwrap()
    }

    async fn wait_until_waiting(db: &DatabaseConnection, n: i64) {
        for _ in 0..3000 {
            if waiting(db).await >= n {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("fewer than {n} sessions ever waited on a lock");
    }

    async fn concurrent_creates_at_49_admit_exactly_one(db: &'static DatabaseConnection) {
        let org = format!("rumpa_{}", config::ider::uuid());
        let scope = Scope {
            org: &org,
            app: APP,
        };
        for i in 0..49 {
            create(db, scope, &format!("event {i}")).await;
        }
        let org_a = org.clone();
        let org_b = org.clone();
        let a = tokio::spawn(async move {
            create_event(
                db,
                Scope {
                    org: &org_a,
                    app: APP,
                },
                "a@x.io",
                &event_body("A"),
            )
            .await
        });
        let b = tokio::spawn(async move {
            create_event(
                db,
                Scope {
                    org: &org_b,
                    app: APP,
                },
                "b@x.io",
                &event_body("B"),
            )
            .await
        });
        let results = [a.await.unwrap(), b.await.unwrap()];
        let ok = results.iter().filter(|r| r.is_ok()).count();
        let capped = results
            .iter()
            .filter(|r| matches!(r, Err(RumPaError::LimitReached)))
            .count();
        assert_eq!((ok, capped), (1, 1), "{results:?}");
        assert_eq!(list_events(db, scope).await.unwrap().len(), 50);
        rum_pa::apply_delete_org(db, &org).await.unwrap();
    }

    async fn a_racing_delete_and_funnel_save_never_leave_a_dangling_reference(
        db: &'static DatabaseConnection,
    ) {
        let org = format!("rumpa_{}", config::ider::uuid());
        for round in 0..20 {
            let scope = Scope {
                org: &org,
                app: APP,
            };
            let event = create(db, scope, &format!("event {round}")).await;
            let (org_a, org_b, id_a, id_b) =
                (org.clone(), org.clone(), event.id.clone(), event.id.clone());
            let delete = tokio::spawn(async move {
                delete_event(
                    db,
                    Scope {
                        org: &org_a,
                        app: APP,
                    },
                    &id_a,
                    false,
                )
                .await
            });
            let save = tokio::spawn(async move {
                let body =
                    funnel_body(&format!("flow {}", &id_b[..8]), &[("p", "/"), ("e", &id_b)]);
                create_funnel(
                    db,
                    Scope {
                        org: &org_b,
                        app: APP,
                    },
                    "a@x.io",
                    &body,
                )
                .await
            });
            let (deleted, saved) = (delete.await.unwrap(), save.await.unwrap());
            let still_there = get_event(db, scope, &event.id).await.is_ok();
            match (&deleted, &saved) {
                (Ok(()), Err(RumPaError::UnknownEvent(_))) => assert!(!still_there),
                (Err(RumPaError::EventInUse(_)), Ok(_)) => assert!(still_there),
                other => panic!("round {round}: unexpected outcome {other:?}"),
            }
        }
        rum_pa::apply_delete_org(db, &org).await.unwrap();
    }

    /// A fresh org's two events, and a peer's edit giving the higher id the lower one's name.
    async fn a_clashing_edit(
        db: &'static DatabaseConnection,
        org: &str,
        ids: Option<[&str; 2]>,
    ) -> (NamedEventRow, NamedEventRow) {
        let scope = Scope { org, app: APP };
        match ids {
            Some(ids) => {
                NamedEvents::delete_many()
                    .filter(NamedEvents::ID.is_in(ids))
                    .exec(db)
                    .await
                    .unwrap();
                for (id, name) in ids.into_iter().zip(["first", "second"]) {
                    rum_pa::insert::<NamedEvents, _>(db, stored_event(org, id, name))
                        .await
                        .unwrap();
                }
            }
            None => {
                create(db, scope, "first").await;
                create(db, scope, "second").await;
            }
        }
        // The store's collation orders ids, and en_US can disagree with Rust's byte order.
        let mut ordered = NamedEvents::find()
            .filter(NamedEvents::ORG_ID.eq(org))
            .order_by_asc(NamedEvents::ID)
            .all(db)
            .await
            .unwrap();
        let (stored, low) = (ordered.pop().unwrap(), ordered.pop().unwrap());
        let edit = NamedEventRow {
            name: low.name.clone(),
            name_key: rum_pa::name_key(&low.name),
            version: stored.version + 1,
            updated_at: stored.updated_at + 1,
            updated_by: "peer@x.io".into(),
            ..stored
        };
        (low, edit)
    }

    fn stored_event(org: &str, id: &str, name: &str) -> NamedEventRow {
        NamedEventRow {
            id: id.into(),
            org_id: org.into(),
            app: APP.into(),
            name: name.into(),
            name_key: rum_pa::name_key(name),
            rules: serde_json::json!([]),
            version: 1,
            created_by: "a@x.io".into(),
            updated_by: "a@x.io".into(),
            created_at: 1,
            updated_at: 1,
        }
    }

    async fn replicate(db: &'static DatabaseConnection, row: &NamedEventRow) -> Result<(), String> {
        let payload = serde_json::to_vec(row).unwrap();
        let key = row_key(&row.org_id, EVENTS_TABLE, &row.id);
        replication::apply(db, &key, replication::Op::Put(Some(&payload))).await
    }

    /// The lower id is locked locally; once the applier waits on it, the higher id must be free.
    async fn the_applier_locks_rows_in_id_order_like_a_local_create(
        db: &'static DatabaseConnection,
        ids: Option<[&str; 2]>,
    ) {
        if db.get_database_backend() != DbBackend::Postgres {
            eprintln!("skipped: row lock order exists only on Postgres");
            return;
        }
        let org = format!("rumpa_{}", config::ider::uuid());
        let (low, edit) = a_clashing_edit(db, &org, ids).await;
        let local = db.begin().await.unwrap();
        rum_pa::get_for_update::<NamedEvents, _>(&local, &org, APP, &low.id)
            .await
            .unwrap();
        let pid = backend_pid(&local).await;
        let incoming = edit.clone();
        let applier = tokio::spawn(async move { replicate(db, &incoming).await });
        wait_until_blocked_by(db, pid).await;
        let high = NamedEvents::find()
            .filter(NamedEvents::ORG_ID.eq(&org))
            .filter(NamedEvents::ID.eq(&edit.id))
            .lock_with_behavior(LockType::Update, LockBehavior::Nowait)
            .one(&local)
            .await;
        assert!(
            high.is_ok(),
            "the applier holds {} while it waits on {}: {high:?}",
            edit.id,
            low.id
        );
        local.commit().await.unwrap();
        let applied = tokio::time::timeout(Duration::from_secs(30), applier).await;
        assert!(
            matches!(applied, Ok(Ok(Ok(())))),
            "the applier did not finish: {applied:?}"
        );
        let stored = rum_pa::get::<NamedEvents, _>(db, &org, APP, &edit.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.version, edit.version, "the replicated edit was lost");
        rum_pa::apply_delete_org(db, &org).await.unwrap();
    }

    async fn backend_pid<C: ConnectionTrait>(conn: &C) -> i32 {
        let row = conn
            .query_one(Statement::from_string(
                DbBackend::Postgres,
                "SELECT pg_backend_pid() AS pid",
            ))
            .await
            .unwrap()
            .unwrap();
        row.try_get("", "pid").unwrap()
    }

    /// Polls `pg_stat_activity` until some session waits on a lock `pid` holds.
    async fn wait_until_blocked_by(db: &DatabaseConnection, pid: i32) {
        let probe = Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT count(*) AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
            [pid.into()],
        );
        for _ in 0..3000 {
            let row = db.query_one(probe.clone()).await.unwrap().unwrap();
            if row.try_get::<i64>("", "n").unwrap() > 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the applier never waited on the locally locked lower id");
    }

    async fn an_applier_racing_a_local_create_converges(
        db: &'static DatabaseConnection,
        ids: Option<[&str; 2]>,
    ) {
        for round in 0..20 {
            let org = format!("rumpa_{}", config::ider::uuid());
            let (low, edit) = a_clashing_edit(db, &org, ids).await;
            let incoming = edit.clone();
            let applier = tokio::spawn(async move { replicate(db, &incoming).await });
            let org_c = org.clone();
            let local = tokio::spawn(async move {
                let scope = Scope {
                    org: &org_c,
                    app: APP,
                };
                create_event(db, scope, "c@x.io", &event_body("third")).await
            });
            let (applied, created) = (applier.await.unwrap(), local.await.unwrap());
            assert!(
                applied.is_ok() && created.is_ok(),
                "round {round}: {applied:?} {created:?}"
            );
            let rows = rum_pa::list::<NamedEvents, _>(db, &org, APP).await.unwrap();
            assert_eq!(rows.len(), 3, "round {round}");
            let edited = rows.iter().find(|r| r.id == edit.id).unwrap();
            assert_eq!(edited.version, edit.version, "round {round}: edit lost");
            assert!(rows.iter().any(|r| r.name == low.name), "round {round}");
            rum_pa::apply_delete_org(db, &org).await.unwrap();
        }
    }
}
