//! Transactional persistence for composite definitions and their derived
//! child-reference index.

use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait, ActiveValue,
    ActiveValue::Set,
    ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Statement, TransactionTrait, UpdateMany,
    sea_query::{Expr, LockType},
};
use serde::{Deserialize, Serialize};

use super::entity::{alert_composite_children, alert_composites, alerts};
use crate::errors::{DbError, Error};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i16)]
pub enum ChildKind {
    Alert = 0,
    Composite = 1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompositeWithChildren {
    pub definition: alert_composites::Model,
    pub children: Vec<alert_composite_children::Model>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resolution {
    NotFound,
    // Boxed: `alerts::Model` is ~1.4KB, so the unboxed enum dwarfed the
    // `HashMap<String, Resolution>` returned by `resolve_many` (used on every
    // composite evaluation).
    Alert(Box<alerts::Model>),
    Composite(Box<alert_composites::Model>),
    DuplicateId,
}

/// Which replicated message carried a definition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplicatedKind {
    Create,
    Update,
}

/// What a replicated definition does to this region's row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplicaWrite {
    Insert,
    Replace { evaluation_generation: i64 },
    Skip,
}

pub async fn create_with_children<C>(
    conn: &C,
    definition: alert_composites::ActiveModel,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let id = active_string(&definition.id, "composite id")?;
    validate_child_ownership(&children, &id)?;

    let txn = conn.begin().await?;
    let saved = insert_in(&txn, definition, children).await?;
    txn.commit().await?;
    publish_put(&saved.definition.org, &id).await;
    Ok(saved)
}

pub async fn update_with_children<C>(
    conn: &C,
    replacement: alert_composites::ActiveModel,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let id = active_string(&replacement.id, "composite id")?;
    let org = active_string(&replacement.org, "composite org")?;
    validate_child_ownership(&children, &id)?;

    let txn = conn.begin().await?;
    let current = lock_current(&txn, &org, &id)
        .await?
        .ok_or_else(|| sea_orm::DbErr::RecordNotFound(id.clone()))?;
    let evaluation_generation = current
        .evaluation_generation
        .checked_add(1)
        .ok_or_else(|| sea_orm::DbErr::Custom("evaluation generation overflow".into()))?;
    let saved = replace_in(&txn, replacement, evaluation_generation, children).await?;
    txn.commit().await?;
    publish_put(&org, &id).await;
    Ok(saved)
}

/// Decides a replicated definition against the local row; a missing `updated_at` is the oldest.
/// [pure]
pub fn replica_write(
    kind: ReplicatedKind,
    local: Option<&alert_composites::Model>,
    incoming: &alert_composites::Model,
) -> ReplicaWrite {
    match (kind, local) {
        (ReplicatedKind::Create, None) => ReplicaWrite::Insert,
        (ReplicatedKind::Update, None) => ReplicaWrite::Skip,
        (ReplicatedKind::Create | ReplicatedKind::Update, Some(local)) => {
            if incoming.updated_at > local.updated_at {
                ReplicaWrite::Replace {
                    evaluation_generation: local.evaluation_generation.saturating_add(1),
                }
            } else {
                ReplicaWrite::Skip
            }
        }
    }
}

/// Applies a definition another region wrote and returns what [`replica_write`] decided. [strong]
pub async fn apply_replicated<C>(
    conn: &C,
    kind: ReplicatedKind,
    incoming: CompositeWithChildren,
) -> Result<ReplicaWrite, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let CompositeWithChildren {
        definition,
        children,
    } = incoming;
    let children = children
        .into_iter()
        .map(IntoActiveModel::into_active_model)
        .collect::<Vec<_>>();
    validate_child_ownership(&children, &definition.id)?;
    let (org, id) = (definition.org.clone(), definition.id.clone());

    let txn = conn.begin().await?;
    let current = lock_current(&txn, &definition.org, &definition.id).await?;
    let write = replica_write(kind, current.as_ref(), &definition);
    // `reset_all` marks every column set, so the update writes the whole incoming row.
    let mut row = definition.into_active_model().reset_all();
    match write {
        ReplicaWrite::Insert => {
            row.evaluation_generation = Set(0);
            insert_in(&txn, row, children).await?;
        }
        ReplicaWrite::Replace {
            evaluation_generation,
        } => {
            replace_in(&txn, row, evaluation_generation, children).await?;
        }
        ReplicaWrite::Skip => {}
    }
    txn.commit().await?;
    if write != ReplicaWrite::Skip {
        publish_put(&org, &id).await;
    }
    Ok(write)
}

/// Flips `enabled` with a new `updated_at` and generation; `None` when the id is absent.
pub async fn set_enabled<C>(
    conn: &C,
    org: &str,
    id: &str,
    enabled: bool,
    updated_at: i64,
) -> Result<Option<CompositeWithChildren>, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let change = alert_composites::Entity::update_many()
        .col_expr(alert_composites::Column::Enabled, Expr::value(enabled));
    stamp_and_reload(conn, org, id, change, updated_at).await
}

/// Moves a composite to `folder_id` with a new `updated_at` and generation; `None` when absent.
pub async fn move_to_folder<C>(
    conn: &C,
    org: &str,
    id: &str,
    folder_id: &str,
    editor: &str,
    updated_at: i64,
) -> Result<Option<CompositeWithChildren>, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let change = alert_composites::Entity::update_many()
        .col_expr(alert_composites::Column::FolderId, Expr::value(folder_id))
        .col_expr(alert_composites::Column::LastEditedBy, Expr::value(editor));
    stamp_and_reload(conn, org, id, change, updated_at).await
}

async fn insert_in<C: ConnectionTrait>(
    txn: &C,
    definition: alert_composites::ActiveModel,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, sea_orm::DbErr> {
    let definition = definition.insert(txn).await?;
    if !children.is_empty() {
        alert_composite_children::Entity::insert_many(children)
            .exec(txn)
            .await?;
    }
    let children = children_for(txn, &definition.id).await?;
    Ok(CompositeWithChildren {
        definition,
        children,
    })
}

/// Reads the row to replace; PostgreSQL holds its lock until the caller's transaction ends.
async fn lock_current<C: ConnectionTrait>(
    txn: &C,
    org: &str,
    id: &str,
) -> Result<Option<alert_composites::Model>, sea_orm::DbErr> {
    let mut current =
        alert_composites::Entity::find_by_id(id).filter(alert_composites::Column::Org.eq(org));
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Postgres {
        current = current.lock(LockType::Update);
    }
    current.one(txn).await
}

async fn replace_in<C: ConnectionTrait>(
    txn: &C,
    mut replacement: alert_composites::ActiveModel,
    evaluation_generation: i64,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, sea_orm::DbErr> {
    let id = active_string(&replacement.id, "composite id")?;
    replacement.evaluation_generation = Set(evaluation_generation);
    let definition = replacement.update(txn).await?;
    alert_composite_children::Entity::delete_many()
        .filter(alert_composite_children::Column::CompositeId.eq(&id))
        .exec(txn)
        .await?;
    if !children.is_empty() {
        alert_composite_children::Entity::insert_many(children)
            .exec(txn)
            .await?;
    }
    let children = children_for(txn, &id).await?;
    Ok(CompositeWithChildren {
        definition,
        children,
    })
}

async fn stamp_and_reload<C>(
    conn: &C,
    org: &str,
    id: &str,
    change: UpdateMany<alert_composites::Entity>,
    updated_at: i64,
) -> Result<Option<CompositeWithChildren>, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let txn = conn.begin().await?;
    let result = change
        .col_expr(alert_composites::Column::UpdatedAt, Expr::value(updated_at))
        .col_expr(
            alert_composites::Column::EvaluationGeneration,
            Expr::col(alert_composites::Column::EvaluationGeneration).add(1),
        )
        .filter(alert_composites::Column::Org.eq(org))
        .filter(alert_composites::Column::Id.eq(id))
        .exec(&txn)
        .await?;
    let saved = if result.rows_affected == 0 {
        None
    } else {
        get_by_id(&txn, org, id).await?
    };
    txn.commit().await?;
    if saved.is_some() {
        publish_put(org, id).await;
    }
    Ok(saved)
}

fn validate_child_ownership(
    children: &[alert_composite_children::ActiveModel],
    composite_id: &str,
) -> Result<(), sea_orm::DbErr> {
    for child in children {
        if active_string(&child.composite_id, "child composite id")? != composite_id {
            return Err(sea_orm::DbErr::Custom(
                "child reference belongs to another composite".to_string(),
            ));
        }
    }
    Ok(())
}

fn active_string(
    value: &sea_orm::ActiveValue<String>,
    field: &str,
) -> Result<String, sea_orm::DbErr> {
    match value {
        ActiveValue::Set(value) | ActiveValue::Unchanged(value) => Ok(value.clone()),
        ActiveValue::NotSet => Err(sea_orm::DbErr::Custom(format!("{field} is not set"))),
    }
}

async fn children_for<C: ConnectionTrait>(
    conn: &C,
    composite_id: &str,
) -> Result<Vec<alert_composite_children::Model>, sea_orm::DbErr> {
    alert_composite_children::Entity::find()
        .filter(alert_composite_children::Column::CompositeId.eq(composite_id))
        .order_by_asc(alert_composite_children::Column::DisplayOrder)
        .all(conn)
        .await
}

/// Sent after commit so watchers re-read the write; a failure is logged because it committed.
async fn publish_put(org: &str, id: &str) {
    if let Err(e) = crate::coordinator::alert_composites::emit_put_event(org, id).await {
        log::error!("[COMPOSITE_ALERT] put event failed for {org}/{id}: {e}");
    }
}

async fn publish_delete(org: &str, id: &str) {
    if let Err(e) = crate::coordinator::alert_composites::emit_delete_event(org, id).await {
        log::error!("[COMPOSITE_ALERT] delete event failed for {org}/{id}: {e}");
    }
}

pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<CompositeWithChildren>, sea_orm::DbErr> {
    let Some(definition) = alert_composites::Entity::find_by_id(id)
        .filter(alert_composites::Column::Org.eq(org))
        .one(conn)
        .await?
    else {
        return Ok(None);
    };
    let children = children_for(conn, id).await?;
    Ok(Some(CompositeWithChildren {
        definition,
        children,
    }))
}

pub async fn list_by_org<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Vec<alert_composites::Model>, sea_orm::DbErr> {
    alert_composites::Entity::find()
        .filter(alert_composites::Column::Org.eq(org))
        .order_by_asc(alert_composites::Column::Name)
        .all(conn)
        .await
}

/// Composites in a folder, by the folder slug they store.
pub async fn count_in_folder<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    folder_id: &str,
) -> Result<u64, Error> {
    alert_composites::Entity::find()
        .filter(alert_composites::Column::Org.eq(org))
        .filter(alert_composites::Column::FolderId.eq(folder_id))
        .count(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// `(org, name)` of each composite whose template is `template`; `None` is every org.
pub async fn names_using_template<C: ConnectionTrait>(
    conn: &C,
    org: Option<&str>,
    template: &str,
) -> Result<Vec<(String, String)>, Error> {
    let mut query = alert_composites::Entity::find()
        .select_only()
        .column(alert_composites::Column::Org)
        .column(alert_composites::Column::Name)
        .filter(alert_composites::Column::Template.eq(template));
    if let Some(org) = org {
        query = query.filter(alert_composites::Column::Org.eq(org));
    }
    query
        .order_by_asc(alert_composites::Column::Name)
        .into_tuple::<(String, String)>()
        .all(conn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// The template each composite in scope names, one entry per composite, for the template list's
/// usage counts.
pub async fn templates_in_use<C: ConnectionTrait>(
    conn: &C,
    org: Option<&str>,
) -> Result<Vec<String>, Error> {
    let mut query = alert_composites::Entity::find()
        .select_only()
        .column(alert_composites::Column::Template)
        .filter(alert_composites::Column::Template.is_not_null());
    if let Some(org) = org {
        query = query.filter(alert_composites::Column::Org.eq(org));
    }
    query
        .into_tuple::<Option<String>>()
        .all(conn)
        .await
        .map(|rows| rows.into_iter().flatten().collect())
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

pub async fn list_parents<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    kind: ChildKind,
    child_id: &str,
) -> Result<Vec<alert_composites::Model>, sea_orm::DbErr> {
    alert_composites::Entity::find()
        .inner_join(alert_composite_children::Entity)
        .filter(alert_composites::Column::Org.eq(org))
        .filter(alert_composite_children::Column::ChildKind.eq(kind as i16))
        .filter(alert_composite_children::Column::ChildAlertId.eq(child_id))
        .order_by_asc(alert_composites::Column::Id)
        .all(conn)
        .await
}

/// Bulk reverse-reference lookup: map child ID -> referencing composite
/// definitions. Replaces N per-row `list_parents` calls on the list/enrich
/// paths with a fixed pair of queries.
pub async fn list_parents_for_many<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    kind: ChildKind,
    child_ids: &[String],
) -> Result<HashMap<String, Vec<alert_composites::Model>>, sea_orm::DbErr> {
    let mut grouped: HashMap<String, Vec<alert_composites::Model>> = HashMap::new();
    if child_ids.is_empty() {
        return Ok(grouped);
    }
    let links = alert_composite_children::Entity::find()
        .filter(alert_composite_children::Column::ChildKind.eq(kind as i16))
        .filter(alert_composite_children::Column::ChildAlertId.is_in(child_ids.iter().cloned()))
        .all(conn)
        .await?;
    if links.is_empty() {
        return Ok(grouped);
    }
    let parents = alert_composites::Entity::find()
        .filter(alert_composites::Column::Org.eq(org))
        .filter(
            alert_composites::Column::Id.is_in(links.iter().map(|link| link.composite_id.clone())),
        )
        .order_by_asc(alert_composites::Column::Id)
        .all(conn)
        .await?;
    let parents_by_id: HashMap<String, alert_composites::Model> = parents
        .into_iter()
        .map(|parent| (parent.id.clone(), parent))
        .collect();
    for link in links {
        if let Some(parent) = parents_by_id.get(&link.composite_id) {
            grouped
                .entry(link.child_alert_id)
                .or_default()
                .push(parent.clone());
        }
    }
    Ok(grouped)
}

/// Bulk child count for a set of composite IDs (`child_count` on the unified
/// alert list). Replaces N per-row `get_by_id` calls.
pub async fn children_count_for_many<C: ConnectionTrait>(
    conn: &C,
    composite_ids: &[String],
) -> Result<HashMap<String, usize>, sea_orm::DbErr> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    if composite_ids.is_empty() {
        return Ok(counts);
    }
    let children = alert_composite_children::Entity::find()
        .filter(alert_composite_children::Column::CompositeId.is_in(composite_ids.iter().cloned()))
        .all(conn)
        .await?;
    for child in children {
        *counts.entry(child.composite_id).or_default() += 1;
    }
    Ok(counts)
}

pub async fn current_generation<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<i64>, sea_orm::DbErr> {
    Ok(alert_composites::Entity::find_by_id(id)
        .filter(alert_composites::Column::Org.eq(org))
        .one(conn)
        .await?
        .map(|definition| definition.evaluation_generation))
}

pub async fn increment_evaluation_generation<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<i64, sea_orm::DbErr> {
    let backend = conn.get_database_backend();
    let sql = match backend {
        sea_orm::DatabaseBackend::Postgres => {
            "UPDATE alert_composites SET evaluation_generation = evaluation_generation + 1 \
             WHERE id = $1 AND org = $2 RETURNING evaluation_generation"
        }
        sea_orm::DatabaseBackend::Sqlite => {
            "UPDATE alert_composites SET evaluation_generation = evaluation_generation + 1 \
             WHERE id = ? AND org = ? RETURNING evaluation_generation"
        }
        sea_orm::DatabaseBackend::MySql => {
            let result = alert_composites::Entity::update_many()
                .col_expr(
                    alert_composites::Column::EvaluationGeneration,
                    Expr::col(alert_composites::Column::EvaluationGeneration).add(1),
                )
                .filter(alert_composites::Column::Id.eq(id))
                .filter(alert_composites::Column::Org.eq(org))
                .exec(conn)
                .await?;
            if result.rows_affected != 1 {
                return Err(sea_orm::DbErr::RecordNotFound(id.to_string()));
            }
            return alert_composites::Entity::find_by_id(id)
                .filter(alert_composites::Column::Org.eq(org))
                .one(conn)
                .await?
                .map(|definition| definition.evaluation_generation)
                .ok_or_else(|| sea_orm::DbErr::RecordNotFound(id.to_string()));
        }
    };
    let row = conn
        .query_one(Statement::from_sql_and_values(
            backend,
            sql,
            [id.into(), org.into()],
        ))
        .await?;
    row.map(|row| row.try_get::<i64>("", "evaluation_generation"))
        .transpose()?
        .ok_or_else(|| sea_orm::DbErr::RecordNotFound(id.to_string()))
}

pub async fn delete_by_id<C>(conn: &C, org: &str, id: &str) -> Result<(), sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let txn = conn.begin().await?;
    let exists = alert_composites::Entity::find_by_id(id)
        .filter(alert_composites::Column::Org.eq(org))
        .one(&txn)
        .await?
        .is_some();
    if !exists {
        txn.commit().await?;
        return Ok(());
    }
    alert_composite_children::Entity::delete_many()
        .filter(alert_composite_children::Column::CompositeId.eq(id))
        .exec(&txn)
        .await?;
    alert_composites::Entity::delete_many()
        .filter(alert_composites::Column::Id.eq(id))
        .filter(alert_composites::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    publish_delete(org, id).await;
    Ok(())
}

/// Organization teardown bypass: remove the polymorphic child index before
/// definitions so no retained reference can outlive its graph node.
pub async fn delete_by_org<C>(conn: &C, org: &str) -> Result<(), sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let txn = conn.begin().await?;
    let ids = alert_composites::Entity::find()
        .select_only()
        .column(alert_composites::Column::Id)
        .filter(alert_composites::Column::Org.eq(org))
        .into_tuple::<String>()
        .all(&txn)
        .await?;
    if !ids.is_empty() {
        alert_composite_children::Entity::delete_many()
            .filter(alert_composite_children::Column::CompositeId.is_in(ids.clone()))
            .exec(&txn)
            .await?;
    }
    alert_composites::Entity::delete_many()
        .filter(alert_composites::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    for id in &ids {
        publish_delete(org, id).await;
    }
    Ok(())
}

pub async fn resolve_by_id<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Resolution, sea_orm::DbErr> {
    let ordinary = alerts::Entity::find_by_id(id)
        .filter(alerts::Column::Org.eq(org))
        .one(conn)
        .await?;
    let composite = alert_composites::Entity::find_by_id(id)
        .filter(alert_composites::Column::Org.eq(org))
        .one(conn)
        .await?;
    Ok(match (ordinary, composite) {
        (Some(_), Some(_)) => Resolution::DuplicateId,
        (Some(alert), None) => Resolution::Alert(Box::new(alert)),
        (None, Some(composite)) => Resolution::Composite(Box::new(composite)),
        (None, None) => Resolution::NotFound,
    })
}

/// Resolve an evaluation fan-in with exactly two definition queries. Looking
/// in both tables for every ID is deliberate: a corrupt cross-table collision
/// must fail closed rather than trusting the derived child-kind index.
pub async fn resolve_many<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    ids: &[String],
) -> Result<HashMap<String, Resolution>, sea_orm::DbErr> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let ordinary = alerts::Entity::find()
        .filter(alerts::Column::Org.eq(org))
        .filter(alerts::Column::Id.is_in(ids.iter().cloned()))
        .all(conn)
        .await?
        .into_iter()
        .map(|alert| (alert.id.clone(), alert))
        .collect::<HashMap<_, _>>();
    let composites = alert_composites::Entity::find()
        .filter(alert_composites::Column::Org.eq(org))
        .filter(alert_composites::Column::Id.is_in(ids.iter().cloned()))
        .all(conn)
        .await?
        .into_iter()
        .map(|composite| (composite.id.clone(), composite))
        .collect::<HashMap<_, _>>();
    Ok(ids
        .iter()
        .cloned()
        .map(|id| {
            let resolution = match (ordinary.get(&id), composites.get(&id)) {
                (Some(_), Some(_)) => Resolution::DuplicateId,
                (Some(alert), None) => Resolution::Alert(Box::new(alert.clone())),
                (None, Some(composite)) => Resolution::Composite(Box::new(composite.clone())),
                (None, None) => Resolution::NotFound,
            };
            (id, resolution)
        })
        .collect())
}
