//! Transactional persistence for composite definitions and their derived
//! child-reference index.

use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait, ActiveValue,
    ActiveValue::Set,
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Statement, TransactionTrait,
    sea_query::{Expr, LockType},
};

use super::entity::{alert_composite_children, alert_composites, alerts};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i16)]
pub enum ChildKind {
    Alert = 0,
    Composite = 1,
}

#[derive(Clone, Debug, PartialEq, Eq)]
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
    let definition = definition.insert(&txn).await?;
    if !children.is_empty() {
        alert_composite_children::Entity::insert_many(children)
            .exec(&txn)
            .await?;
    }
    let children = children_for(&txn, &definition.id).await?;
    txn.commit().await?;
    Ok(CompositeWithChildren {
        definition,
        children,
    })
}

pub async fn update_with_children<C>(
    conn: &C,
    mut replacement: alert_composites::ActiveModel,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, sea_orm::DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let id = active_string(&replacement.id, "composite id")?;
    let org = active_string(&replacement.org, "composite org")?;
    validate_child_ownership(&children, &id)?;

    let txn = conn.begin().await?;
    let mut current_query =
        alert_composites::Entity::find_by_id(&id).filter(alert_composites::Column::Org.eq(&org));
    if txn.get_database_backend() == sea_orm::DatabaseBackend::Postgres {
        current_query = current_query.lock(LockType::Update);
    }
    let current = current_query
        .one(&txn)
        .await?
        .ok_or_else(|| sea_orm::DbErr::RecordNotFound(id.clone()))?;

    replacement.evaluation_generation = Set(current
        .evaluation_generation
        .checked_add(1)
        .ok_or_else(|| sea_orm::DbErr::Custom("evaluation generation overflow".into()))?);
    let definition = replacement.update(&txn).await?;
    alert_composite_children::Entity::delete_many()
        .filter(alert_composite_children::Column::CompositeId.eq(&id))
        .exec(&txn)
        .await?;
    if !children.is_empty() {
        alert_composite_children::Entity::insert_many(children)
            .exec(&txn)
            .await?;
    }
    let children = children_for(&txn, &id).await?;
    txn.commit().await?;
    Ok(CompositeWithChildren {
        definition,
        children,
    })
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

/// Total composite definitions across every org — the super-cluster startup
/// preflight fails closed when this is non-zero.
pub async fn count_all<C: ConnectionTrait>(conn: &C) -> Result<u64, sea_orm::DbErr> {
    alert_composites::Entity::find().count(conn).await
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

pub async fn load_graph<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<HashMap<String, Vec<String>>, sea_orm::DbErr> {
    let definitions = list_by_org(conn, org).await?;
    let ids = definitions
        .into_iter()
        .map(|definition| definition.id)
        .collect::<Vec<_>>();
    let mut graph = ids
        .iter()
        .cloned()
        .map(|id| (id, Vec::new()))
        .collect::<HashMap<_, _>>();
    if ids.is_empty() {
        return Ok(graph);
    }
    let children = alert_composite_children::Entity::find()
        .filter(alert_composite_children::Column::CompositeId.is_in(ids))
        .filter(alert_composite_children::Column::ChildKind.eq(ChildKind::Composite as i16))
        .order_by_asc(alert_composite_children::Column::DisplayOrder)
        .all(conn)
        .await?;
    for child in children {
        if let Some(parent_children) = graph.get_mut(&child.composite_id) {
            parent_children.push(child.child_alert_id);
        }
    }
    Ok(graph)
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
            .filter(alert_composite_children::Column::CompositeId.is_in(ids))
            .exec(&txn)
            .await?;
    }
    alert_composites::Entity::delete_many()
        .filter(alert_composites::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    txn.commit().await?;
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
