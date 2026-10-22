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

use infra::table::rum_pa::{
    self, AppSettingsRow, FunnelRow, Funnels, MAX_PER_APP, NamedEventRow, NamedEvents,
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde::Serialize;

use super::{
    AppSettings, CreateFunnel, CreateNamedEvent, Current, FunnelDef, FunnelRef, NamedEvent,
    NamedEventRef, PutAppSettings, RumPaError, SavedFunnel, UpdateFunnel, UpdateNamedEvent,
    settings_id, validate_def, validate_description, validate_name, validate_rules,
    validate_rules_hash, validate_settings, validate_sql,
};

/// The super-cluster meta-topic module; keys are `/rum_analytics/{org}/{table}/{id}`.
pub const REPLICATION_MODULE: &str = "rum_analytics";
pub const EVENTS_TABLE: &str = "named_events";
pub const FUNNELS_TABLE: &str = "funnels";
pub const APP_SETTINGS_TABLE: &str = "app_settings";

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
    rules_hash: Option<String>,
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

/// The names deleted named events among `ids` had just before deletion; ids never captured
/// (never deleted, or deleted before this capture existed) are omitted.
pub async fn deleted_event_names<C: ConnectionTrait>(
    db: &C,
    org: &str,
    ids: &[String],
) -> Result<Vec<NamedEventRef>, RumPaError> {
    Ok(rum_pa::tombstoned_names::<NamedEvents, _>(db, org, ids)
        .await?
        .into_iter()
        .map(|(id, name)| NamedEventRef { id, name })
        .collect())
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
    let current = current_rules_hash(db, scope).await?;
    Ok(rum_pa::list::<Funnels, _>(db, scope.org, scope.app)
        .await?
        .into_iter()
        .map(|row| SavedFunnel::new(row, current.clone()))
        .collect())
}

pub async fn get_funnel<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
    id: &str,
) -> Result<SavedFunnel, RumPaError> {
    let row = rum_pa::get::<Funnels, _>(db, scope.org, scope.app, id)
        .await?
        .ok_or(RumPaError::NotFound)?;
    Ok(SavedFunnel::new(row, current_rules_hash(db, scope).await?))
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
        body.rules_hash.as_deref(),
    )?;
    let current = current_rules_hash(db, scope).await?;
    let row = retry_once(|| create_funnel_once(db, scope, user, &draft)).await?;
    emit_put(scope.org, FUNNELS_TABLE, &row.id, &row).await;
    Ok(SavedFunnel::new(row, current))
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
        body.rules_hash.as_deref(),
    )?;
    let current = current_rules_hash(db, scope).await?;
    let row = retry_once(|| update_funnel_once(db, scope, id, user, &draft, body.version)).await?;
    emit_put(scope.org, FUNNELS_TABLE, &row.id, &row).await;
    Ok(SavedFunnel::new(row, current))
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

/// The stored settings, or the built-in default when the app has never saved any.
pub async fn get_app_settings<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
) -> Result<AppSettings, RumPaError> {
    Ok(stored_settings(db, scope)
        .await?
        .map_or_else(|| AppSettings::unsaved(scope.app), AppSettings::from))
}

/// Saves at the version the caller read: 0 creates, any other must equal the stored version.
pub async fn put_app_settings<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    user: &str,
    body: &PutAppSettings,
) -> Result<AppSettings, RumPaError> {
    validate_settings(body)?;
    let row = retry_once(|| put_settings_once(db, scope, user, body)).await?;
    emit_put(scope.org, APP_SETTINGS_TABLE, &row.id, &row).await;
    Ok(row.into())
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
    rules_hash: Option<&str>,
) -> Result<FunnelDraft, RumPaError> {
    let name = validate_name(name)?;
    let description = validate_description(description)?;
    let (definition, event_ids) = validate_def(def)?;
    validate_sql(sql)?;
    validate_rules_hash(rules_hash)?;
    Ok(FunnelDraft {
        name,
        description,
        definition,
        event_ids,
        sql: sql.to_string(),
        rules_hash: rules_hash.map(str::to_string),
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
    rum_pa::delete::<NamedEvents, _>(&txn, scope.org, scope.app, id, row.version, &row.name)
        .await?;
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
        rules_hash: draft.rules_hash.clone(),
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
        rules_hash: draft.rules_hash.clone(),
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
                Some(current) => RumPaError::VersionConflict(Box::new(Current::Funnel(
                    SavedFunnel::new(current, current_rules_hash(&txn, scope).await?),
                ))),
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
    rum_pa::delete::<Funnels, _>(&txn, scope.org, scope.app, id, row.version, &row.name).await?;
    txn.commit().await?;
    Ok(row)
}

/// Version 0 inserts at the derived id; any other version must equal the stored one.
async fn put_settings_once<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    scope: Scope<'_>,
    user: &str,
    body: &PutAppSettings,
) -> Result<AppSettingsRow, RumPaError> {
    let now = now_ms();
    let sessions = serde_json::to_value(&body.sessions).map_err(internal)?;
    let pages = serde_json::to_value(&body.pages).map_err(internal)?;
    if body.version == 0 {
        let row = AppSettingsRow {
            id: settings_id(scope.org, scope.app),
            org_id: scope.org.to_string(),
            app: scope.app.to_string(),
            bots: body.bots,
            sessions,
            pages,
            version: 1,
            created_by: user.to_string(),
            updated_by: user.to_string(),
            created_at: now,
            updated_at: now,
        };
        return match rum_pa::insert::<rum_pa::AppSettings, _>(db, row.clone()).await {
            Ok(()) => Ok(row),
            Err(e)
                if matches!(
                    e.sql_err(),
                    Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
                ) =>
            {
                // Read outside the failed statement: Postgres aborts a transaction on the error.
                Err(settings_conflict(db, scope).await?)
            }
            Err(e) => Err(e.into()),
        };
    }
    let txn = db.begin().await?;
    let Some(stored) = stored_settings(&txn, scope).await? else {
        return Err(settings_conflict(&txn, scope).await?);
    };
    let id = stored.id.clone();
    let row = AppSettingsRow {
        bots: body.bots,
        sessions,
        pages,
        version: body.version.saturating_add(1),
        updated_by: user.to_string(),
        updated_at: now,
        ..stored
    };
    let changed = rum_pa::update_if_version::<rum_pa::AppSettings, _>(
        &txn,
        scope.org,
        scope.app,
        &id,
        body.version,
        row.clone(),
    )
    .await?;
    if changed == 0 {
        return Err(settings_conflict(&txn, scope).await?);
    }
    txn.commit().await?;
    Ok(row)
}

async fn stored_settings<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
) -> Result<Option<AppSettingsRow>, RumPaError> {
    let id = settings_id(scope.org, scope.app);
    Ok(rum_pa::get::<rum_pa::AppSettings, _>(db, scope.org, scope.app, &id).await?)
}

async fn settings_conflict<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
) -> Result<RumPaError, RumPaError> {
    let current = get_app_settings(db, scope).await?;
    Ok(RumPaError::VersionConflict(Box::new(Current::AppSettings(
        current,
    ))))
}

async fn current_rules_hash<C: ConnectionTrait>(
    db: &C,
    scope: Scope<'_>,
) -> Result<String, RumPaError> {
    Ok(get_app_settings(db, scope).await?.rules_hash)
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
    use crate::rum_pa::{replication, validate_id};

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
        serde_json::from_value(serde_json::json!({
            "name": name, "rules": [{"t": "view", "op": "eq", "value": "/signup"}]
        }))
        .unwrap()
    }

    fn funnel_def(steps: &[(&str, &str)]) -> serde_json::Value {
        let s: Vec<[&str; 2]> = steps.iter().map(|(k, v)| [*k, *v]).collect();
        serde_json::json!({"s": s})
    }

    fn funnel_body(name: &str, steps: &[(&str, &str)]) -> CreateFunnel {
        serde_json::from_value(serde_json::json!({
            "name": name, "def": funnel_def(steps), "sql": "SELECT 1"
        }))
        .unwrap()
    }

    fn funnel_update(created: &SavedFunnel, steps: &[(&str, &str)]) -> UpdateFunnel {
        serde_json::from_value(serde_json::json!({
            "name": created.name, "def": funnel_def(steps), "sql": "SELECT 2",
            "version": created.version
        }))
        .unwrap()
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
    async fn a_deleted_event_s_name_is_recoverable_by_id_afterwards() {
        let db = db().await;
        let event = create(&db, SCOPE, "Signup").await;
        delete_event(&db, SCOPE, &event.id, false).await.unwrap();
        let refs = deleted_event_names(&db, SCOPE.org, &[event.id.clone(), "absent".into()])
            .await
            .unwrap();
        assert_eq!(
            refs,
            [NamedEventRef {
                id: event.id,
                name: "Signup".into()
            }]
        );
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

    const HASH: &str = "0123456789abcdef";

    fn builtin_bots() -> serde_json::Value {
        serde_json::json!({"version": 1, "families": ["HeadlessChrome", "PhantomJS", "Spider"], "devices": ["Spider"]})
    }

    fn settings_id(org: &str, app: &str) -> String {
        use sha2::{Digest, Sha256};
        let hex: String = Sha256::digest(format!("{org}/{app}").as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        hex[..27].to_string()
    }

    fn is_rules_hash(value: &serde_json::Value) -> bool {
        value.as_str().is_some_and(|h| {
            h.len() == 16
                && h.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    }

    fn session(field: &str, op: &str, values: &[&str]) -> serde_json::Value {
        serde_json::json!({"field": field, "op": op, "values": values})
    }

    fn page(op: &str, value: &str) -> serde_json::Value {
        serde_json::json!({"op": op, "value": value})
    }

    fn settings_body(
        bots: bool,
        sessions: serde_json::Value,
        pages: serde_json::Value,
        version: i64,
    ) -> PutAppSettings {
        serde_json::from_value(
            serde_json::json!({"bots": bots, "sessions": sessions, "pages": pages, "version": version}),
        )
        .unwrap()
    }

    async fn put_settings(
        db: &DatabaseConnection,
        scope: Scope<'_>,
        user: &str,
        body: &PutAppSettings,
    ) -> Result<serde_json::Value, RumPaError> {
        put_app_settings(db, scope, user, body)
            .await
            .map(|s| serde_json::to_value(s).unwrap())
    }

    async fn read_settings(db: &DatabaseConnection, scope: Scope<'_>) -> serde_json::Value {
        serde_json::to_value(get_app_settings(db, scope).await.unwrap()).unwrap()
    }

    /// The status a first save of these rules gets on an empty store.
    async fn first_save_status(sessions: serde_json::Value, pages: serde_json::Value) -> u16 {
        let db = db().await;
        match put_app_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, sessions, pages, 0),
        )
        .await
        {
            Ok(_) => 200,
            Err(e) => e.status(),
        }
    }

    fn funnel_json(name: &str, def: serde_json::Value, rules_hash: Option<&str>) -> CreateFunnel {
        let mut body = serde_json::json!({"name": name, "def": def, "sql": "SELECT 1"});
        if let Some(hash) = rules_hash {
            body["rules_hash"] = hash.into();
        }
        serde_json::from_value(body).unwrap()
    }

    fn funnel_update_json(created: &SavedFunnel, version: i32, rules_hash: &str) -> UpdateFunnel {
        serde_json::from_value(serde_json::json!({
            "name": created.name, "def": {"s": [["p", "/"], ["p", "/b"]]}, "sql": "SELECT 2",
            "version": version, "rules_hash": rules_hash
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn p2_r6_without_a_row_a_read_returns_the_defaults() {
        let db = db().await;
        let s = read_settings(&db, SCOPE).await;
        assert_eq!(s["app"], APP, "{s}");
        assert_eq!(s.get("id"), Some(&serde_json::Value::Null), "{s}");
        assert_eq!(s["version"], 0, "{s}");
        assert_eq!(s["bots"], true, "{s}");
        assert_eq!(s["sessions"], serde_json::json!([]), "{s}");
        assert_eq!(s["pages"], serde_json::json!([]), "{s}");
        assert_eq!(s["builtinBots"], builtin_bots(), "{s}");
        assert!(is_rules_hash(&s["rulesHash"]), "{s}");
        for audit in ["createdBy", "createdAt", "updatedBy", "updatedAt"] {
            assert_eq!(
                s.get(audit),
                Some(&serde_json::Value::Null),
                "{audit} in {s}"
            );
        }
    }

    #[tokio::test]
    async fn p2_r4_every_read_carries_the_builtin_bot_list() {
        let db = db().await;
        let saved = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(false, serde_json::json!([]), serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        assert_eq!(saved["builtinBots"], builtin_bots(), "{saved}");
        assert_eq!(
            read_settings(&db, SCOPE).await["builtinBots"],
            builtin_bots()
        );
    }

    #[tokio::test]
    async fn p2_r10_settings_serialise_camel_case() {
        let db = db().await;
        let saved = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, serde_json::json!([]), serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        assert_eq!(saved["app"], APP, "{saved}");
        assert_eq!(read_settings(&db, SCOPE).await["app"], APP);
        assert_eq!(saved["createdBy"], "a@x.io", "{saved}");
        assert_eq!(saved["updatedBy"], "a@x.io", "{saved}");
        assert!(
            saved["createdAt"].is_i64() && saved["updatedAt"].is_i64(),
            "{saved}"
        );
        assert!(is_rules_hash(&saved["rulesHash"]), "{saved}");
        for snake in [
            "builtin_bots",
            "rules_hash",
            "created_by",
            "created_at",
            "updated_by",
            "updated_at",
        ] {
            assert!(saved.get(snake).is_none(), "{snake} in {saved}");
        }
    }

    #[tokio::test]
    async fn p2_r1_session_and_page_rules_round_trip() {
        let db = db().await;
        let sessions: Vec<serde_json::Value> = [
            "user_agent_user_agent_family",
            "user_agent_os_family",
            "user_agent_device_family",
            "geo_info_country",
            "geo_info_city",
            "usr_id",
            "usr_email",
            "usr_anonymous_id",
            "env",
            "version",
        ]
        .iter()
        .zip(
            ["eq", "in", "prefix", "suffix", "contains", "regex"]
                .iter()
                .cycle(),
        )
        .map(|(field, op)| session(field, op, &["x"]))
        .collect();
        let pages = serde_json::json!([
            page("eq", "/login"),
            page("prefix", "/auth/"),
            page("regex", "^/cb")
        ]);
        let body = settings_body(true, sessions.clone().into(), pages.clone(), 0);
        put_settings(&db, SCOPE, "a@x.io", &body).await.unwrap();
        let s = read_settings(&db, SCOPE).await;
        assert_eq!(s["sessions"], serde_json::Value::from(sessions));
        assert_eq!(s["pages"], pages);
    }

    #[tokio::test]
    async fn p2_r5_the_id_is_derived_from_org_and_app() {
        let expected = settings_id(ORG, APP);
        let body = settings_body(true, serde_json::json!([]), serde_json::json!([]), 0);
        for _ in 0..2 {
            let db = db().await;
            let saved = put_settings(&db, SCOPE, "a@x.io", &body).await.unwrap();
            assert_eq!(saved["id"], expected.as_str(), "{saved}");
        }
        let db = db().await;
        let other = Scope {
            org: ORG,
            app: "ios",
        };
        let saved = put_settings(&db, other, "a@x.io", &body).await.unwrap();
        assert_eq!(saved["id"], settings_id(ORG, "ios").as_str(), "{saved}");
    }

    #[tokio::test]
    async fn p2_r7_version_zero_creates_and_the_stored_version_updates() {
        let db = db().await;
        let created = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, serde_json::json!([]), serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        let version = created["version"].as_i64().unwrap();
        assert!(version >= 1, "{created}");
        let rules = serde_json::json!([session("env", "eq", &["staging"])]);
        let updated = put_settings(
            &db,
            SCOPE,
            "b@x.io",
            &settings_body(true, rules.clone(), serde_json::json!([]), version),
        )
        .await
        .unwrap();
        assert!(updated["version"].as_i64().unwrap() > version, "{updated}");
        assert_eq!(
            (&updated["createdBy"], &updated["updatedBy"]),
            (&"a@x.io".into(), &"b@x.io".into())
        );
        assert_eq!(read_settings(&db, SCOPE).await["sessions"], rules);
    }

    #[tokio::test]
    async fn p2_r7_a_stale_version_is_a_conflict_carrying_the_current_settings() {
        let db = db().await;
        let created = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, serde_json::json!([]), serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        let stale = created["version"].as_i64().unwrap();
        let rules = serde_json::json!([session("env", "eq", &["staging"])]);
        put_settings(
            &db,
            SCOPE,
            "b@x.io",
            &settings_body(true, rules, serde_json::json!([]), stale),
        )
        .await
        .unwrap();
        let err = put_app_settings(
            &db,
            SCOPE,
            "c@x.io",
            &settings_body(false, serde_json::json!([]), serde_json::json!([]), stale),
        )
        .await
        .unwrap_err();
        assert_eq!((err.code(), err.status()), ("version_conflict", 409));
        let body = serde_json::to_value(err.body()).unwrap();
        assert_eq!(body["current"], read_settings(&db, SCOPE).await, "{body}");
    }

    #[tokio::test]
    async fn p2_r7_a_second_create_is_a_conflict_not_a_duplicate_name() {
        let db = db().await;
        let rules = serde_json::json!([session("env", "eq", &["staging"])]);
        put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, rules, serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        let before = read_settings(&db, SCOPE).await;
        let err = put_app_settings(
            &db,
            SCOPE,
            "b@x.io",
            &settings_body(false, serde_json::json!([]), serde_json::json!([]), 0),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "version_conflict");
        assert_eq!(serde_json::to_value(err.body()).unwrap()["current"], before);
        assert_eq!(read_settings(&db, SCOPE).await, before);
    }

    #[tokio::test]
    async fn p2_r3_at_most_twenty_session_rules_and_twenty_page_rules() {
        let sessions = |n: usize| serde_json::Value::from(vec![session("env", "eq", &["x"]); n]);
        let pages = |n: usize| serde_json::Value::from(vec![page("eq", "/login"); n]);
        assert_eq!(first_save_status(sessions(20), pages(20)).await, 200);
        assert_eq!(first_save_status(sessions(21), pages(0)).await, 400);
        assert_eq!(first_save_status(sessions(0), pages(21)).await, 400);
    }

    #[tokio::test]
    async fn p2_r3_an_in_rule_holds_at_most_twenty_values() {
        let values = |n: usize| -> Vec<String> { (0..n).map(|i| format!("v{i}")).collect() };
        let in_rule =
            |n: usize| serde_json::json!([{"field": "env", "op": "in", "values": values(n)}]);
        assert_eq!(
            first_save_status(in_rule(20), serde_json::json!([])).await,
            200
        );
        assert_eq!(
            first_save_status(in_rule(21), serde_json::json!([])).await,
            400
        );
    }

    #[tokio::test]
    async fn p2_r3_a_session_value_is_one_to_1024_utf16_units() {
        let with_value = |v: &str| serde_json::json!([session("usr_email", "eq", &[v])]);
        let longest = "a".repeat(1024);
        let too_long = format!("{}😀", "a".repeat(1023));
        assert_eq!(
            first_save_status(with_value(&longest), serde_json::json!([])).await,
            200
        );
        assert_eq!(
            first_save_status(with_value(""), serde_json::json!([])).await,
            400
        );
        assert_eq!(
            first_save_status(with_value(&too_long), serde_json::json!([])).await,
            400
        );
    }

    #[tokio::test]
    async fn p2_r3_a_pattern_is_bounded_and_must_compile() {
        let longest = "a".repeat(256);
        let too_long = "a".repeat(257);
        for (pattern, status) in [
            (longest.as_str(), 200),
            (too_long.as_str(), 400),
            (r"(a)\1", 400),
        ] {
            let sessions = serde_json::json!([session("usr_email", "regex", &[pattern])]);
            assert_eq!(
                first_save_status(sessions, serde_json::json!([])).await,
                status,
                "{pattern}"
            );
            let pages = serde_json::json!([page("regex", pattern)]);
            assert_eq!(
                first_save_status(serde_json::json!([]), pages).await,
                status,
                "{pattern}"
            );
        }
    }

    #[tokio::test]
    async fn p2_r9_ignored_pages_leave_the_rules_hash_unchanged() {
        let db = db().await;
        let default_hash = read_settings(&db, SCOPE).await["rulesHash"].clone();
        let saved = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(
                true,
                serde_json::json!([]),
                serde_json::json!([page("eq", "/login")]),
                0,
            ),
        )
        .await
        .unwrap();
        assert_eq!(saved["rulesHash"], default_hash);
        let version = saved["version"].as_i64().unwrap();
        let more_pages = serde_json::json!([page("eq", "/login"), page("prefix", "/auth/")]);
        let saved = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, serde_json::json!([]), more_pages, version),
        )
        .await
        .unwrap();
        assert_eq!(saved["rulesHash"], default_hash);
        assert_eq!(read_settings(&db, SCOPE).await["rulesHash"], default_hash);
    }

    #[tokio::test]
    async fn p2_r9_session_rules_and_the_bot_switch_change_the_rules_hash() {
        let db = db().await;
        let default_hash = read_settings(&db, SCOPE).await["rulesHash"].clone();
        let rules = serde_json::json!([session("env", "eq", &["staging"])]);
        let with_rule = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, rules.clone(), serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        assert!(is_rules_hash(&with_rule["rulesHash"]), "{with_rule}");
        assert_ne!(with_rule["rulesHash"], default_hash);
        let version = with_rule["version"].as_i64().unwrap();
        let bots_off = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(false, rules, serde_json::json!([]), version),
        )
        .await
        .unwrap();
        assert_ne!(bots_off["rulesHash"], with_rule["rulesHash"]);
        assert_ne!(bots_off["rulesHash"], default_hash);
    }

    #[tokio::test]
    async fn p2_r9_the_rules_hash_depends_on_the_rules_not_the_app() {
        let db = db().await;
        let rules = serde_json::json!([session("geo_info_country", "in", &["US", "IN"])]);
        let ios = Scope {
            org: ORG,
            app: "ios",
        };
        let web = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, rules.clone(), serde_json::json!([]), 0),
        )
        .await
        .unwrap();
        let ios_saved = put_settings(
            &db,
            ios,
            "b@x.io",
            &settings_body(true, rules, serde_json::json!([page("eq", "/x")]), 0),
        )
        .await
        .unwrap();
        assert_eq!(web["rulesHash"], ios_saved["rulesHash"]);
        assert_eq!(read_settings(&db, ios).await["rulesHash"], web["rulesHash"]);
    }

    #[tokio::test]
    async fn p2_r12_a_rules_hash_is_sixteen_lowercase_hex_and_stored_as_sent() {
        let db = db().await;
        let def = serde_json::json!({"s": [["p", "/"], ["p", "/a"]]});
        for (i, bad) in [
            "0123456789ABCDEF",
            "0123456789abcde",
            "0123456789abcdeg",
            "0123456789abcdef0",
        ]
        .iter()
        .enumerate()
        {
            let err = create_funnel(
                &db,
                SCOPE,
                "a@x.io",
                &funnel_json(&format!("bad{i}"), def.clone(), Some(bad)),
            )
            .await
            .unwrap_err();
            assert_eq!(err.status(), 400, "{bad}");
        }
        let created = create_funnel(&db, SCOPE, "a@x.io", &funnel_json("F", def, Some(HASH)))
            .await
            .unwrap();
        assert_eq!(serde_json::to_value(&created).unwrap()["rulesHash"], HASH);
        let other = "fedcba9876543210";
        let updated = update_funnel(
            &db,
            SCOPE,
            &created.id,
            "a@x.io",
            &funnel_update_json(&created, created.version, other),
        )
        .await
        .unwrap();
        assert_eq!(serde_json::to_value(&updated).unwrap()["rulesHash"], other);
        let err = update_funnel(
            &db,
            SCOPE,
            &created.id,
            "a@x.io",
            &funnel_update_json(&updated, updated.version, "FEDCBA9876543210"),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), 400);
    }

    #[tokio::test]
    async fn p2_r13_every_saved_funnel_carries_its_and_the_current_rules_hash() {
        let db = db().await;
        let rules = serde_json::json!([session("env", "eq", &["staging"])]);
        let current = put_settings(
            &db,
            SCOPE,
            "a@x.io",
            &settings_body(true, rules, serde_json::json!([]), 0),
        )
        .await
        .unwrap()["rulesHash"]
            .clone();
        assert!(is_rules_hash(&current), "{current}");
        let hashes = |f: &SavedFunnel| {
            let v = serde_json::to_value(f).unwrap();
            (v["rulesHash"].clone(), v["currentRulesHash"].clone())
        };
        let expected = (serde_json::Value::from(HASH), current.clone());
        let def = serde_json::json!({"s": [["p", "/"], ["p", "/a"]]});
        let created = create_funnel(&db, SCOPE, "a@x.io", &funnel_json("F", def, Some(HASH)))
            .await
            .unwrap();
        assert_eq!(hashes(&created), expected);
        assert_eq!(
            hashes(&get_funnel(&db, SCOPE, &created.id).await.unwrap()),
            expected
        );
        assert_eq!(
            hashes(&list_funnels(&db, SCOPE).await.unwrap()[0]),
            expected
        );
        let updated = update_funnel(
            &db,
            SCOPE,
            &created.id,
            "a@x.io",
            &funnel_update_json(&created, created.version, HASH),
        )
        .await
        .unwrap();
        assert_eq!(hashes(&updated), expected);
        let err = update_funnel(
            &db,
            SCOPE,
            &created.id,
            "a@x.io",
            &funnel_update_json(&created, created.version, HASH),
        )
        .await
        .unwrap_err();
        let body = serde_json::to_value(err.body()).unwrap();
        assert_eq!(
            (
                body["current"]["rulesHash"].clone(),
                body["current"]["currentRulesHash"].clone()
            ),
            expected,
            "{body}"
        );
    }

    #[tokio::test]
    async fn p3_r4_an_event_used_only_by_an_exclusion_is_in_use() {
        let db = db().await;
        let event = create(&db, SCOPE, "Bounce").await;
        let def = serde_json::json!({
            "s": [["p", "/"], ["p", "/a"]],
            "x": [{"s": ["e", event.id], "a": 1, "b": 2}]
        });
        let funnel = create_funnel(&db, SCOPE, "a@x.io", &funnel_json("Flow", def, None))
            .await
            .unwrap();
        let err = delete_event(&db, SCOPE, &event.id, false)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            RumPaError::EventInUse(vec![FunnelRef {
                id: funnel.id,
                name: "Flow".into()
            }])
        );
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
        p2_r7_two_first_settings_puts_racing_admit_one_and_conflict_the_other(db).await;
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

    async fn p2_r7_two_first_settings_puts_racing_admit_one_and_conflict_the_other(
        db: &'static DatabaseConnection,
    ) {
        let org = format!("rumpa_{}", config::ider::uuid());
        let racer = |org: String, user: &'static str, env: &'static str| {
            tokio::spawn(async move {
                let scope = Scope {
                    org: &org,
                    app: APP,
                };
                let rules = serde_json::json!([session("env", "eq", &[env])]);
                let body = settings_body(true, rules, serde_json::json!([]), 0);
                put_app_settings(db, scope, user, &body).await
            })
        };
        let (a, b) = (
            racer(org.clone(), "a@x.io", "dev"),
            racer(org.clone(), "b@x.io", "prod"),
        );
        let results = [a.await.unwrap(), b.await.unwrap()];
        let scope = Scope {
            org: &org,
            app: APP,
        };
        let stored = read_settings(db, scope).await;
        let winners: Vec<serde_json::Value> = results
            .iter()
            .filter_map(|r| r.as_ref().ok())
            .map(|s| serde_json::to_value(s).unwrap())
            .collect();
        assert_eq!(winners, std::slice::from_ref(&stored), "{results:?}");
        let loser = results.iter().find_map(|r| r.as_ref().err()).unwrap();
        assert_eq!(loser.code(), "version_conflict", "{loser:?}");
        assert_eq!(
            serde_json::to_value(loser.body()).unwrap()["current"],
            stored
        );
        rum_pa::apply_delete_org(db, &org).await.unwrap();
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
