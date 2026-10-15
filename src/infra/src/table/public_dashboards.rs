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

//! Table ops for public dashboard links, org settings and the replication outbox. The caller picks
//! the connection: lifecycle reads and every write use the primary, lists may use the read-only
//! pool.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait,
    IntoActiveModel, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement,
    TransactionTrait,
    prelude::Expr,
    sea_query::{Func, OnConflict},
};

use super::entity::{
    public_dashboard_org_settings as settings, public_dashboard_outbox as outbox,
    public_dashboards as links,
};
use crate::errors;

/// A replicated apply that keeps losing its compare-and-set to local edits retries this often.
const APPLY_ATTEMPTS: usize = 5;
/// How long a soft-deleted link is kept, so a delayed replicated write cannot revive it.
pub const DELETED_RETENTION_MICROS: i64 = 30 * 86_400 * 1_000_000;

/// The result of a capped create.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CreateOutcome {
    Created,
    OrgFull,
    DashboardFull,
}

/// What applying a replicated link row did to the local one.
#[derive(Clone, Debug, PartialEq)]
pub enum Applied {
    /// The replicated row is now the local row.
    Taken,
    /// The local row stays: it is newer, the same write, or soft-deleted.
    Kept,
    /// The local write won a tie of equal revisions and was written again under a new revision,
    /// which the caller sends to the other regions so they converge on it.
    Reasserted(Box<links::Model>),
}

/// How the local row and a replicated one of the same link are ordered.
#[derive(Debug, PartialEq)]
enum Order {
    Keep,
    Take,
    Reassert,
}

/// The next revision of a row: strictly increasing and never behind the clock.
pub fn next_rev(rev: i64, now: i64) -> i64 {
    rev.saturating_add(1).max(now)
}

/// The link with this slug, soft-deleted or not; the slug is global, the URL carries no org.
pub async fn get_by_slug<C: ConnectionTrait>(
    db: &C,
    slug: &str,
) -> Result<Option<links::Model>, errors::Error> {
    Ok(links::Entity::find()
        .filter(links::Column::Slug.eq(slug))
        .one(db)
        .await?)
}

/// The link with this id, soft-deleted or not.
pub async fn get<C: ConnectionTrait>(
    db: &C,
    id: &str,
) -> Result<Option<links::Model>, errors::Error> {
    Ok(links::Entity::find_by_id(id).one(db).await?)
}

/// A live link, only if it belongs to this org and this dashboard.
pub async fn get_on_dashboard<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    dashboard_id: &str,
    id: &str,
) -> Result<Option<links::Model>, errors::Error> {
    Ok(links::Entity::find()
        .filter(links::Column::Id.eq(id))
        .filter(links::Column::OrgId.eq(org_id))
        .filter(links::Column::DashboardId.eq(dashboard_id))
        .filter(links::Column::DeletedAt.is_null())
        .one(db)
        .await?)
}

/// The org's live links, most recently changed first.
pub async fn list<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
) -> Result<Vec<links::Model>, errors::Error> {
    Ok(links::Entity::find()
        .filter(links::Column::OrgId.eq(org_id))
        .filter(links::Column::DeletedAt.is_null())
        .order_by_desc(links::Column::UpdatedAt)
        .all(db)
        .await?)
}

/// One dashboard's live links, newest first.
pub async fn list_by_dashboard<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    dashboard_id: &str,
) -> Result<Vec<links::Model>, errors::Error> {
    Ok(links::Entity::find()
        .filter(links::Column::OrgId.eq(org_id))
        .filter(links::Column::DashboardId.eq(dashboard_id))
        .filter(links::Column::DeletedAt.is_null())
        .order_by_desc(links::Column::CreatedAt)
        .all(db)
        .await?)
}

/// Live links per org, split into (enabled and not expired, paused and not expired, expired).
pub async fn count_by_org_status<C: ConnectionTrait>(
    db: &C,
    now: i64,
) -> Result<Vec<(String, &'static str, i64)>, errors::Error> {
    let not_expired = links::Column::ExpiresAt
        .is_null()
        .or(links::Column::ExpiresAt.gt(now));
    let mut out = Vec::new();
    for (filter, enabled) in [(not_expired.clone(), true), (not_expired, false)] {
        let rows: Vec<(String, i64)> = links::Entity::find()
            .select_only()
            .column(links::Column::OrgId)
            .column_as(links::Column::Id.count(), "n")
            .filter(links::Column::DeletedAt.is_null())
            .filter(links::Column::Enabled.eq(enabled))
            .filter(filter)
            .group_by(links::Column::OrgId)
            .into_tuple()
            .all(db)
            .await?;
        let status = if enabled { "live" } else { "paused" };
        out.extend(rows.into_iter().map(|(org, n)| (org, status, n)));
    }
    let expired: Vec<(String, i64)> = links::Entity::find()
        .select_only()
        .column(links::Column::OrgId)
        .column_as(links::Column::Id.count(), "n")
        .filter(links::Column::DeletedAt.is_null())
        .filter(links::Column::ExpiresAt.lte(now))
        .group_by(links::Column::OrgId)
        .into_tuple()
        .all(db)
        .await?;
    out.extend(expired.into_iter().map(|(org, n)| (org, "expired", n)));
    Ok(out)
}

/// Inserts the link unless its org or dashboard is at its cap; the count and the insert run under
/// a per-org advisory lock on Postgres and behind SQLite's single writer, so no create overshoots.
pub async fn insert_capped(
    db: &DatabaseConnection,
    model: &links::Model,
    org_max: u32,
    dashboard_max: u32,
) -> Result<CreateOutcome, errors::Error> {
    let txn = db.begin().await?;
    if txn.get_database_backend() == DbBackend::Postgres {
        txn.execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [format!("public_dashboards/{}", model.org_id).into()],
        ))
        .await?;
    }
    let live_in_org = links::Entity::find()
        .filter(links::Column::OrgId.eq(&model.org_id))
        .filter(links::Column::DeletedAt.is_null());
    if live_in_org.clone().count(&txn).await? >= u64::from(org_max) {
        return Ok(CreateOutcome::OrgFull);
    }
    let on_dashboard = live_in_org
        .filter(links::Column::DashboardId.eq(&model.dashboard_id))
        .count(&txn)
        .await?;
    if on_dashboard >= u64::from(dashboard_max) {
        return Ok(CreateOutcome::DashboardFull);
    }
    model.clone().into_active_model().insert(&txn).await?;
    txn.commit().await?;
    Ok(CreateOutcome::Created)
}

/// Writes the semantic columns of `next` only while the stored rev is still `seen`; false when
/// another write won. Counter columns are never written here.
pub async fn update_cas<C: ConnectionTrait>(
    db: &C,
    next: &links::Model,
    seen: i64,
) -> Result<bool, errors::Error> {
    let res = links::Entity::update_many()
        .col_expr(links::Column::Name, Expr::value(next.name.clone()))
        .col_expr(links::Column::Visibility, Expr::value(next.visibility))
        .col_expr(
            links::Column::TimeRanges,
            Expr::value(next.time_ranges.clone()),
        )
        .col_expr(
            links::Column::DefaultRangeKey,
            Expr::value(next.default_range_key.clone()),
        )
        .col_expr(
            links::Column::FrozenVariables,
            Expr::value(next.frozen_variables.clone()),
        )
        .col_expr(links::Column::RefreshSecs, Expr::value(next.refresh_secs))
        .col_expr(links::Column::Enabled, Expr::value(next.enabled))
        .col_expr(links::Column::ExpiresAt, Expr::value(next.expires_at))
        .col_expr(
            links::Column::UpdatedBy,
            Expr::value(next.updated_by.clone()),
        )
        .col_expr(links::Column::UpdatedAt, Expr::value(next.updated_at))
        .col_expr(links::Column::Rev, Expr::value(next.rev))
        .col_expr(links::Column::DeletedAt, Expr::value(next.deleted_at))
        .filter(links::Column::Id.eq(&next.id))
        .filter(links::Column::Rev.eq(seen))
        .exec(db)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Applies a link row replicated from region `origin`: a higher rev wins, equal revs are ordered by
/// `(updated_at, origin region)`, a soft delete always wins and is never revived, and a delete
/// that arrives before the first Put is kept as a deleted row. Access counters stay region-local.
pub async fn apply_replicated<C: ConnectionTrait>(
    db: &C,
    incoming: &links::Model,
    origin: &str,
    local_origin: &str,
    now: i64,
) -> Result<Applied, errors::Error> {
    for _ in 0..APPLY_ATTEMPTS {
        let Some(local) = get(db, &incoming.id).await? else {
            let row = links::Model {
                last_accessed_at: None,
                access_count: 0,
                ..incoming.clone()
            };
            row.into_active_model().insert(db).await?;
            return Ok(Applied::Taken);
        };
        let (next, applied) = match replicated_order(&local, incoming, origin, local_origin) {
            Order::Keep => return Ok(Applied::Kept),
            Order::Take => {
                let rev = incoming.rev.max(local.rev);
                (
                    links::Model {
                        rev,
                        ..incoming.clone()
                    },
                    Applied::Taken,
                )
            }
            Order::Reassert => {
                let next = links::Model {
                    rev: next_rev(local.rev, now),
                    ..local.clone()
                };
                (next.clone(), Applied::Reasserted(Box::new(next)))
            }
        };
        if update_cas(db, &next, local.rev).await? {
            return Ok(applied);
        }
    }
    Err(errors::Error::Message(format!(
        "public link {} kept changing while applying a replicated write",
        incoming.id
    )))
}

/// Adds `count` data requests and moves `last_accessed_at` forward only; never touches rev.
pub async fn flush_access<C: ConnectionTrait>(
    db: &C,
    id: &str,
    accessed_at: i64,
    count: i64,
) -> Result<(), errors::Error> {
    links::Entity::update_many()
        .col_expr(
            links::Column::LastAccessedAt,
            Func::greatest([
                Expr::col(links::Column::LastAccessedAt).if_null(0),
                Expr::value(accessed_at),
            ])
            .into(),
        )
        .col_expr(
            links::Column::AccessCount,
            Expr::col(links::Column::AccessCount).add(count),
        )
        .filter(links::Column::Id.eq(id))
        .exec(db)
        .await?;
    Ok(())
}

/// Hard-deletes links soft-deleted before `before`; returns how many went.
pub async fn purge_deleted<C: ConnectionTrait>(db: &C, before: i64) -> Result<u64, errors::Error> {
    let res = links::Entity::delete_many()
        .filter(links::Column::DeletedAt.lt(before))
        .exec(db)
        .await?;
    Ok(res.rows_affected)
}

/// The org's live links published by `user`, for pausing them when the user leaves the org.
pub async fn list_by_publisher<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    user: &str,
) -> Result<Vec<links::Model>, errors::Error> {
    Ok(links::Entity::find()
        .filter(links::Column::OrgId.eq(org_id))
        .filter(links::Column::PublishedBy.eq(user))
        .filter(links::Column::DeletedAt.is_null())
        .all(db)
        .await?)
}

/// The org's settings row; `None` means enabled with the env default link limit.
pub async fn get_settings<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
) -> Result<Option<settings::Model>, errors::Error> {
    Ok(settings::Entity::find_by_id(org_id).one(db).await?)
}

/// Writes the org's settings, moving its rev to `max(rev + 1, now)`, and returns the stored row.
pub async fn upsert_settings<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    enabled: bool,
    max_links: Option<i32>,
    updated_by: &str,
    now: i64,
) -> Result<settings::Model, errors::Error> {
    let columns = [settings::Column::Enabled, settings::Column::MaxLinks];
    upsert_settings_columns(db, org_id, enabled, max_links, &columns, updated_by, now).await
}

/// Writes only the org's switch; a concurrent write of its link limit is kept. A new row has no
/// limit of its own.
pub async fn set_settings_enabled<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    enabled: bool,
    updated_by: &str,
    now: i64,
) -> Result<settings::Model, errors::Error> {
    let columns = [settings::Column::Enabled];
    upsert_settings_columns(db, org_id, enabled, None, &columns, updated_by, now).await
}

/// Writes only the org's link limit; a concurrent write of its switch is kept. A new row is on.
pub async fn set_settings_max_links<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    max_links: Option<i32>,
    updated_by: &str,
    now: i64,
) -> Result<settings::Model, errors::Error> {
    let columns = [settings::Column::MaxLinks];
    upsert_settings_columns(db, org_id, true, max_links, &columns, updated_by, now).await
}

/// Inserts the row, or on an existing one updates `columns` and the rev and audit fields only.
async fn upsert_settings_columns<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    enabled: bool,
    max_links: Option<i32>,
    columns: &[settings::Column],
    updated_by: &str,
    now: i64,
) -> Result<settings::Model, errors::Error> {
    let row = settings::ActiveModel {
        org_id: Set(org_id.to_string()),
        rev: Set(now),
        enabled: Set(enabled),
        max_links: Set(max_links),
        updated_at: Set(now),
        updated_by: Set(updated_by.to_string()),
    };
    settings::Entity::insert(row)
        .on_conflict(
            OnConflict::column(settings::Column::OrgId)
                .value(
                    settings::Column::Rev,
                    Func::greatest([
                        Expr::col((settings::Entity, settings::Column::Rev)).add(1),
                        Expr::value(now),
                    ]),
                )
                .update_columns(
                    columns
                        .iter()
                        .copied()
                        .chain([settings::Column::UpdatedAt, settings::Column::UpdatedBy]),
                )
                .to_owned(),
        )
        .exec(db)
        .await?;
    get_settings(db, org_id)
        .await?
        .ok_or_else(|| errors::Error::Message(format!("settings of {org_id} vanished")))
}

/// Records a failed emit of `rev`; a pending entry keeps the higher rev and its attempt count.
pub async fn outbox_put<C: ConnectionTrait>(
    db: &C,
    link_id: &str,
    rev: i64,
    now: i64,
) -> Result<(), errors::Error> {
    let row = outbox::ActiveModel {
        link_id: Set(link_id.to_string()),
        rev: Set(rev),
        attempts: Set(0),
        created_at: Set(now),
        updated_at: Set(now),
    };
    outbox::Entity::insert(row)
        .on_conflict(
            OnConflict::column(outbox::Column::LinkId)
                .value(
                    outbox::Column::Rev,
                    Func::greatest([
                        Expr::col((outbox::Entity, outbox::Column::Rev)).into(),
                        Expr::value(rev),
                    ]),
                )
                .update_column(outbox::Column::UpdatedAt)
                .to_owned(),
        )
        .exec(db)
        .await?;
    Ok(())
}

/// Entries last tried at or before `before`, oldest first.
pub async fn outbox_list_due<C: ConnectionTrait>(
    db: &C,
    before: i64,
    limit: u64,
) -> Result<Vec<outbox::Model>, errors::Error> {
    Ok(outbox::Entity::find()
        .filter(outbox::Column::UpdatedAt.lte(before))
        .order_by_asc(outbox::Column::UpdatedAt)
        .limit(limit)
        .all(db)
        .await?)
}

/// Counts one more failed retry of the entry.
pub async fn outbox_bump_attempts<C: ConnectionTrait>(
    db: &C,
    link_id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    outbox::Entity::update_many()
        .col_expr(
            outbox::Column::Attempts,
            Expr::col(outbox::Column::Attempts).add(1),
        )
        .col_expr(outbox::Column::UpdatedAt, Expr::value(now))
        .filter(outbox::Column::LinkId.eq(link_id))
        .exec(db)
        .await?;
    Ok(())
}

/// Removes the entry once `rev` was delivered, unless a newer rev was queued meanwhile.
pub async fn outbox_delete<C: ConnectionTrait>(
    db: &C,
    link_id: &str,
    rev: i64,
) -> Result<(), errors::Error> {
    outbox::Entity::delete_many()
        .filter(outbox::Column::LinkId.eq(link_id))
        .filter(outbox::Column::Rev.lte(rev))
        .exec(db)
        .await?;
    Ok(())
}

/// Creates the three tables if absent, for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub async fn create_tables_for_tests(db: &DatabaseConnection) -> Result<(), sea_orm::DbErr> {
    super::migration::create_public_dashboards_schema_for_test(db).await
}

fn replicated_order(
    local: &links::Model,
    incoming: &links::Model,
    origin: &str,
    local_origin: &str,
) -> Order {
    // Counters are region-local, so two copies of one write differ only there.
    let same = links::Model {
        last_accessed_at: local.last_accessed_at,
        access_count: local.access_count,
        ..incoming.clone()
    } == *local;
    if same || local.deleted_at.is_some() {
        return Order::Keep;
    }
    if incoming.deleted_at.is_some() || incoming.rev > local.rev {
        return Order::Take;
    }
    if incoming.rev < local.rev {
        return Order::Keep;
    }
    if (incoming.updated_at, origin) > (local.updated_at, local_origin) {
        Order::Take
    } else {
        Order::Reassert
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database};

    use super::*;
    use crate::table::migration::create_public_dashboards_schema_for_test;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_public_dashboards_schema_for_test(&db).await.unwrap();
        db
    }

    fn link(id: &str, org: &str, dashboard: &str) -> links::Model {
        links::Model {
            id: id.into(),
            org_id: org.into(),
            folder_id: "f".into(),
            dashboard_id: dashboard.into(),
            slug: format!("slug-{id}"),
            name: "n".into(),
            visibility: 1,
            time_ranges: None,
            default_range_key: None,
            frozen_variables: None,
            refresh_secs: 300,
            dashboard_version: 8,
            published_by: "p".into(),
            enabled: true,
            expires_at: None,
            created_by: "p".into(),
            updated_by: None,
            created_at: 1,
            updated_at: 1,
            rev: 1,
            deleted_at: None,
            last_accessed_at: None,
            access_count: 0,
        }
    }

    #[test]
    fn next_rev_is_monotonic_and_never_behind_the_clock() {
        assert_eq!(next_rev(5, 100), 100);
        assert_eq!(next_rev(500, 100), 501);
        assert_eq!(next_rev(i64::MAX, 0), i64::MAX);
    }

    #[tokio::test]
    async fn creates_stop_at_the_org_and_dashboard_caps() {
        let db = db().await;
        let ins = |id: &str, dash: &str| {
            let m = link(id, "o", dash);
            let db = &db;
            async move { insert_capped(db, &m, 3, 2).await.unwrap() }
        };
        assert_eq!(ins("a", "d1").await, CreateOutcome::Created);
        assert_eq!(ins("b", "d1").await, CreateOutcome::Created);
        assert_eq!(ins("c", "d1").await, CreateOutcome::DashboardFull);
        assert_eq!(ins("c", "d2").await, CreateOutcome::Created);
        assert_eq!(ins("d", "d3").await, CreateOutcome::OrgFull);
        assert_eq!(list(&db, "o").await.unwrap().len(), 3);

        // A soft-deleted link frees its slot but keeps its slug reserved.
        let mut gone = get(&db, "a").await.unwrap().unwrap();
        gone.deleted_at = Some(10);
        gone.rev = next_rev(1, 10);
        assert!(update_cas(&db, &gone, 1).await.unwrap());
        assert_eq!(ins("d", "d3").await, CreateOutcome::Created);
        assert!(get_by_slug(&db, "slug-a").await.unwrap().is_some());
        assert!(
            get_on_dashboard(&db, "o", "d1", "a")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn concurrent_creates_at_the_cap_admit_none_over_it() {
        let db = std::sync::Arc::new(db().await);
        let tasks: Vec<_> = (0..8)
            .map(|i| {
                let db = db.clone();
                tokio::spawn(async move {
                    let m = link(&format!("l{i}"), "o", "d");
                    insert_capped(&db, &m, 50, 5).await.unwrap()
                })
            })
            .collect();
        let mut created = 0;
        for t in tasks {
            if t.await.unwrap() == CreateOutcome::Created {
                created += 1;
            }
        }
        assert_eq!(created, 5);
        assert_eq!(list_by_dashboard(&*db, "o", "d").await.unwrap().len(), 5);
    }

    #[tokio::test]
    async fn a_stale_rev_loses_and_counters_survive_edits() {
        let db = db().await;
        insert_capped(&db, &link("l", "o", "d"), 10, 10)
            .await
            .unwrap();
        flush_access(&db, "l", 50, 3).await.unwrap();
        flush_access(&db, "l", 40, 2).await.unwrap();

        let mut edit = get(&db, "l").await.unwrap().unwrap();
        edit.name = "renamed".into();
        edit.rev = next_rev(1, 2);
        assert!(update_cas(&db, &edit, 1).await.unwrap());
        let mut stale = edit.clone();
        stale.name = "lost".into();
        assert!(!update_cas(&db, &stale, 1).await.unwrap());

        let row = get(&db, "l").await.unwrap().unwrap();
        assert_eq!(row.name, "renamed");
        assert_eq!(row.rev, 2);
        assert_eq!(row.access_count, 5);
        assert_eq!(row.last_accessed_at, Some(50));
    }

    #[tokio::test]
    async fn purge_removes_only_rows_deleted_before_the_cutoff() {
        let db = db().await;
        for (id, deleted_at) in [("old", Some(5)), ("new", Some(50)), ("live", None)] {
            let mut m = link(id, "o", "d");
            m.deleted_at = deleted_at;
            insert_capped(&db, &m, 10, 10).await.unwrap();
        }
        assert_eq!(purge_deleted(&db, 10).await.unwrap(), 1);
        assert!(get(&db, "old").await.unwrap().is_none());
        assert!(get(&db, "new").await.unwrap().is_some());
        assert!(get(&db, "live").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn settings_rev_moves_forward_on_every_write() {
        let db = db().await;
        assert!(get_settings(&db, "o").await.unwrap().is_none());
        let first = upsert_settings(&db, "o", true, Some(3), "admin", 100)
            .await
            .unwrap();
        assert_eq!((first.rev, first.max_links), (100, Some(3)));
        let second = upsert_settings(&db, "o", false, None, "admin", 50)
            .await
            .unwrap();
        assert_eq!(second.rev, 101);
        assert!(!second.enabled);
        assert_eq!(second.max_links, None);
        let third = upsert_settings(&db, "o", true, None, "admin", 500)
            .await
            .unwrap();
        assert_eq!(third.rev, 500);
    }

    #[tokio::test]
    async fn each_settings_writer_keeps_the_other_column() {
        let db = db().await;
        // New rows: the switch writer leaves no limit, the limit writer leaves the org on.
        let row = set_settings_enabled(&db, "a", false, "admin", 10)
            .await
            .unwrap();
        assert_eq!((row.enabled, row.max_links), (false, None));
        let row = set_settings_max_links(&db, "b", Some(3), "plan_sync", 10)
            .await
            .unwrap();
        assert_eq!((row.enabled, row.max_links), (true, Some(3)));

        // The plan sync does not undo a kill switch, and the switch does not undo an upgrade.
        let row = set_settings_max_links(&db, "a", Some(50), "plan_sync", 20)
            .await
            .unwrap();
        assert_eq!((row.enabled, row.max_links, row.rev), (false, Some(50), 20));
        let row = set_settings_enabled(&db, "b", false, "admin", 20)
            .await
            .unwrap();
        assert_eq!((row.enabled, row.max_links, row.rev), (false, Some(3), 20));
        assert_eq!(row.updated_by, "admin");
    }

    #[tokio::test]
    async fn outbox_keeps_the_newest_rev_until_it_is_delivered() {
        let db = db().await;
        outbox_put(&db, "l", 5, 10).await.unwrap();
        outbox_put(&db, "l", 3, 20).await.unwrap();
        outbox_bump_attempts(&db, "l", 30).await.unwrap();
        assert!(outbox_list_due(&db, 29, 10).await.unwrap().is_empty());
        let due = outbox_list_due(&db, 30, 10).await.unwrap();
        assert_eq!((due[0].rev, due[0].attempts), (5, 1));

        outbox_put(&db, "l", 7, 40).await.unwrap();
        outbox_delete(&db, "l", 5).await.unwrap();
        assert_eq!(outbox_list_due(&db, 40, 10).await.unwrap()[0].rev, 7);
        outbox_delete(&db, "l", 7).await.unwrap();
        assert!(outbox_list_due(&db, 100, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn links_are_counted_per_org_by_lifecycle_status() {
        let db = db().await;
        let mut paused = link("b", "o1", "d");
        paused.enabled = false;
        let mut expired = link("c", "o1", "d");
        expired.expires_at = Some(5);
        let mut deleted = link("d", "o2", "d");
        deleted.deleted_at = Some(1);
        for model in [
            link("a", "o1", "d"),
            paused,
            expired,
            deleted,
            link("e", "o2", "d"),
        ] {
            assert_eq!(
                insert_capped(&db, &model, 50, 50).await.unwrap(),
                CreateOutcome::Created
            );
        }
        let mut got = count_by_org_status(&db, 10).await.unwrap();
        got.sort();
        assert_eq!(
            got,
            [
                ("o1".to_string(), "expired", 1),
                ("o1".to_string(), "live", 1),
                ("o1".to_string(), "paused", 1),
                ("o2".to_string(), "live", 1),
            ]
        );
    }

    fn replicated(id: &str, rev: i64, updated_at: i64) -> links::Model {
        links::Model {
            rev,
            updated_at,
            ..link(id, "o", "d")
        }
    }

    #[tokio::test]
    async fn gate07_a_put_inserts_and_a_newer_put_replaces_but_counters_stay_local() {
        let db = db().await;
        let mut first = replicated("l", 10, 10);
        first.access_count = 99;
        let applied = apply_replicated(&db, &first, "b", "a", 0).await.unwrap();
        assert_eq!(applied, Applied::Taken);
        let row = get(&db, "l").await.unwrap().unwrap();
        assert_eq!((row.rev, row.access_count), (10, 0));
        flush_access(&db, "l", 5, 3).await.unwrap();

        let newer = links::Model {
            name: "renamed".into(),
            ..replicated("l", 20, 20)
        };
        assert_eq!(
            apply_replicated(&db, &newer, "b", "a", 0).await.unwrap(),
            Applied::Taken
        );
        let row = get(&db, "l").await.unwrap().unwrap();
        assert_eq!(
            (row.name.as_str(), row.rev, row.access_count),
            ("renamed", 20, 3)
        );

        let older = links::Model {
            name: "older".into(),
            ..replicated("l", 15, 15)
        };
        assert_eq!(
            apply_replicated(&db, &older, "b", "a", 0).await.unwrap(),
            Applied::Kept
        );
        assert_eq!(get(&db, "l").await.unwrap().unwrap().name, "renamed");
    }

    #[tokio::test]
    async fn gate07_a_delete_wins_and_no_later_put_resurrects_it() {
        let db = db().await;
        apply_replicated(&db, &replicated("l", 10, 10), "b", "a", 0)
            .await
            .unwrap();
        let delete = links::Model {
            deleted_at: Some(30),
            ..replicated("l", 30, 30)
        };
        assert_eq!(
            apply_replicated(&db, &delete, "b", "a", 0).await.unwrap(),
            Applied::Taken
        );
        for put in [replicated("l", 20, 20), replicated("l", 40, 40)] {
            assert_eq!(
                apply_replicated(&db, &put, "b", "a", 0).await.unwrap(),
                Applied::Kept
            );
        }
        let row = get(&db, "l").await.unwrap().unwrap();
        assert_eq!((row.deleted_at, row.rev), (Some(30), 30));
        assert!(
            get_on_dashboard(&db, "o", "d", "l")
                .await
                .unwrap()
                .is_none()
        );

        // A revoke wins even over a later local edit the other region had not seen.
        apply_replicated(&db, &replicated("m", 50, 50), "b", "a", 0)
            .await
            .unwrap();
        let stale_delete = links::Model {
            deleted_at: Some(45),
            ..replicated("m", 45, 45)
        };
        apply_replicated(&db, &stale_delete, "b", "a", 0)
            .await
            .unwrap();
        let row = get(&db, "m").await.unwrap().unwrap();
        assert_eq!((row.deleted_at, row.rev), (Some(45), 50));
    }

    #[tokio::test]
    async fn gate07_a_delete_before_the_first_put_stays_deleted() {
        let db = db().await;
        let delete = links::Model {
            deleted_at: Some(30),
            ..replicated("l", 30, 30)
        };
        assert_eq!(
            apply_replicated(&db, &delete, "b", "a", 0).await.unwrap(),
            Applied::Taken
        );
        for put in [replicated("l", 10, 10), replicated("l", 99, 99)] {
            apply_replicated(&db, &put, "b", "a", 0).await.unwrap();
        }
        let row = get(&db, "l").await.unwrap().unwrap();
        assert_eq!(row.deleted_at, Some(30));
        assert!(get_by_slug(&db, "slug-l").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn gate07_duplicate_messages_are_idempotent() {
        let db = db().await;
        let put = replicated("l", 10, 10);
        apply_replicated(&db, &put, "b", "a", 0).await.unwrap();
        flush_access(&db, "l", 5, 2).await.unwrap();
        let before = get(&db, "l").await.unwrap().unwrap();
        for _ in 0..3 {
            assert_eq!(
                apply_replicated(&db, &put, "b", "a", 0).await.unwrap(),
                Applied::Kept
            );
        }
        assert_eq!(get(&db, "l").await.unwrap().unwrap(), before);
    }

    /// Two regions write the same revision; each applies the other's Put and both end equal.
    #[tokio::test]
    async fn gate07_concurrent_cross_region_pause_and_edit_converge_by_the_stated_order() {
        for (pause_at, edit_at) in [(200, 201), (201, 200), (200, 200)] {
            let (a, b) = (db().await, db().await);
            for region in [&a, &b] {
                apply_replicated(region, &replicated("l", 100, 100), "x", "y", 0)
                    .await
                    .unwrap();
            }
            let paused = links::Model {
                enabled: false,
                ..replicated("l", 300, pause_at)
            };
            let edited = links::Model {
                name: "edited".into(),
                ..replicated("l", 300, edit_at)
            };
            assert!(update_cas(&a, &paused, 100).await.unwrap());
            assert!(update_cas(&b, &edited, 100).await.unwrap());

            let mut inbox = vec![
                (&a, edited.clone(), "b", "a"),
                (&b, paused.clone(), "a", "b"),
            ];
            while let Some((region, row, from, here)) = inbox.pop() {
                if let Applied::Reasserted(again) =
                    apply_replicated(region, &row, from, here, 1_000)
                        .await
                        .unwrap()
                {
                    let other = if std::ptr::eq(region, &a) { &b } else { &a };
                    inbox.push((other, *again, here, from));
                }
            }
            let (row_a, row_b) = (
                get(&a, "l").await.unwrap().unwrap(),
                get(&b, "l").await.unwrap().unwrap(),
            );
            assert_eq!(row_a, row_b, "pause at {pause_at}, edit at {edit_at}");
            // The later write wins; on an exact tie the larger region id ("b", the edit) does.
            let edit_wins = edit_at >= pause_at;
            assert_eq!(row_a.enabled, edit_wins);
            assert_eq!(row_a.name == "edited", edit_wins);
        }

        // Different revisions need no tie-break: the higher one stands in both regions.
        let (a, b) = (db().await, db().await);
        let paused = links::Model {
            enabled: false,
            ..replicated("l", 400, 400)
        };
        let edited = links::Model {
            name: "edited".into(),
            ..replicated("l", 300, 300)
        };
        for (region, local, remote, from) in
            [(&a, &paused, &edited, "b"), (&b, &edited, &paused, "a")]
        {
            apply_replicated(region, local, "here", "here", 0)
                .await
                .unwrap();
            apply_replicated(region, remote, from, "here", 0)
                .await
                .unwrap();
        }
        assert_eq!(get(&a, "l").await.unwrap(), get(&b, "l").await.unwrap());
        assert!(!get(&a, "l").await.unwrap().unwrap().enabled);
    }

    #[tokio::test]
    async fn gate07_local_concurrent_edits_serialize_on_the_compare_and_set() {
        let db = std::sync::Arc::new(db().await);
        insert_capped(&db, &link("l", "o", "d"), 10, 10)
            .await
            .unwrap();
        let tasks: Vec<_> = (0..6)
            .map(|i| {
                let db = db.clone();
                tokio::spawn(async move {
                    loop {
                        let mut row = get(&*db, "l").await.unwrap().unwrap();
                        let seen = row.rev;
                        row.name = format!("{}+{i}", row.name);
                        row.rev = next_rev(seen, 0);
                        if update_cas(&*db, &row, seen).await.unwrap() {
                            return;
                        }
                    }
                })
            })
            .collect();
        for t in tasks {
            t.await.unwrap();
        }
        let row = get(&*db, "l").await.unwrap().unwrap();
        assert_eq!(row.rev, 7, "every edit moved the rev once");
        for i in 0..6 {
            assert!(row.name.contains(&format!("+{i}")), "{}", row.name);
        }
    }
}
