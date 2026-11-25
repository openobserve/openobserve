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

//! `alert_leases`: rows the lease service writes and the expiry sweep claims.

use config::meta::alerts::lease::{AlertLease, LeaseKind, LeaseState, PURGE_AFTER_US};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
    sea_query::{Expr, LockBehavior, LockType},
};

use super::{
    entity::alert_leases::{ActiveModel, Column, Entity, Model},
    slack_shared::decode_all,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

/// A claim older than this is taken to be from a sweeper that died mid-end.
pub const CLAIM_TTL_US: i64 = 5 * 60 * 1_000_000;
/// A pending lease older than this belongs to a request that died; no alert save runs this long.
pub const PENDING_TTL_US: i64 = 5 * 60 * 1_000_000;

pub async fn insert(lease: &AlertLease) -> Result<(), Error> {
    insert_with(get_orm_client_rw().await, lease).await
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<AlertLease>, Error> {
    get_with(get_orm_client_rw().await, org_id, id).await
}

pub async fn delete(org_id: &str, id: &str) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected)
}

/// The org's leases, newest first; `alert_id` and `state` narrow it.
pub async fn list(
    org_id: &str,
    alert_id: Option<&str>,
    state: Option<LeaseState>,
    limit: u64,
) -> Result<Vec<AlertLease>, Error> {
    list_with(get_orm_client_ro().await, org_id, alert_id, state, limit).await
}

/// The newest `limit` leases on these alerts, read in chunks so a large id list stays in one
/// query's parameter budget.
pub async fn list_for_alerts(
    org_id: &str,
    alert_ids: &[String],
    state: Option<LeaseState>,
    limit: u64,
) -> Result<Vec<AlertLease>, Error> {
    let conn = get_orm_client_ro().await;
    let mut out = Vec::new();
    for chunk in alert_ids.chunks(1000) {
        let mut query = Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::AlertId.is_in(chunk.to_vec()));
        if let Some(state) = state {
            query = query.filter(Column::State.eq(state.as_str()));
        }
        let models = query
            .order_by_desc(Column::StartsAtUs)
            .limit(limit)
            .all(conn)
            .await?;
        out.extend(decode_all(
            "alert_leases",
            models,
            |m| m.id.clone(),
            from_model,
        ));
    }
    out.sort_by_key(|l| std::cmp::Reverse(l.starts_at_us));
    out.truncate(limit as usize);
    Ok(out)
}

/// The active leases of these alerts, for the list badges.
pub async fn active_for_alerts(
    org_id: &str,
    alert_ids: &[String],
) -> Result<Vec<AlertLease>, Error> {
    if alert_ids.is_empty() {
        return Ok(vec![]);
    }
    let models = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.is_in(alert_ids.to_vec()))
        .filter(Column::State.eq(LeaseState::Active.as_str()))
        .order_by_asc(Column::EndsAtUs)
        .all(get_orm_client_ro().await)
        .await?;
    Ok(decode_all(
        "alert_leases",
        models,
        |m| m.id.clone(),
        from_model,
    ))
}

pub async fn active_for(
    org_id: &str,
    alert_id: &str,
    kind: LeaseKind,
) -> Result<Option<AlertLease>, Error> {
    let model = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.eq(alert_id))
        .filter(Column::Kind.eq(kind.as_str()))
        .filter(Column::State.eq(LeaseState::Active.as_str()))
        .one(get_orm_client_rw().await)
        .await?;
    model.map(from_model).transpose()
}

/// A change to this alert whose request has not finished, of either kind.
pub async fn pending_for(org_id: &str, alert_id: &str) -> Result<Option<AlertLease>, Error> {
    let model = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::AlertId.eq(alert_id))
        .filter(Column::State.eq(LeaseState::Pending.as_str()))
        .one(get_orm_client_rw().await)
        .await?;
    model.map(from_model).transpose()
}

/// Makes a pending lease active once its change has landed; false when a sweeper took it first.
pub async fn activate(org_id: &str, id: &str, now_us: i64) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::State, Expr::value(LeaseState::Active.as_str()))
        .col_expr(Column::UpdatedAtUs, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::State.eq(LeaseState::Pending.as_str()))
        .filter(Column::ClaimedAtUs.is_null())
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Drops a pending lease under the claim it was read with; false when another claim replaced it.
pub async fn discard(lease: &AlertLease) -> Result<bool, Error> {
    discard_with(get_orm_client_rw().await, lease).await
}

/// Marks an undone pending lease and keeps its claim, so the sweep takes it again only once the
/// claim has aged; false when another claim replaced this one.
pub async fn hold_for_recheck(lease: &AlertLease, now_us: i64) -> Result<bool, Error> {
    let mut update = Entity::update_many()
        .col_expr(Column::EndedAtUs, Expr::value(now_us))
        .col_expr(Column::UpdatedAtUs, Expr::value(now_us))
        .filter(Column::Id.eq(lease.id.as_str()))
        .filter(Column::State.eq(LeaseState::Pending.as_str()));
    update = match lease.claimed_at_us {
        Some(claimed) => update.filter(Column::ClaimedAtUs.eq(claimed)),
        None => update.filter(Column::ClaimedAtUs.is_null()),
    };
    Ok(update.exec(get_orm_client_rw().await).await?.rows_affected == 1)
}

/// Moves an active lease's end; false when it is not active or is being ended right now.
pub async fn extend(org_id: &str, id: &str, ends_at_us: i64, now_us: i64) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::EndsAtUs, Expr::value(ends_at_us))
        .col_expr(Column::UpdatedAtUs, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::State.eq(LeaseState::Active.as_str()))
        .filter(Column::ClaimedAtUs.is_null())
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Makes an active temporary alert permanent; false when it is not one or is being ended.
pub async fn keep(org_id: &str, id: &str, by: &str, now_us: i64) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::State, Expr::value(LeaseState::Kept.as_str()))
        .col_expr(Column::StateReason, Expr::value(format!("Kept by {by}")))
        .col_expr(Column::EndedAtUs, Expr::value(now_us))
        .col_expr(Column::UpdatedAtUs, Expr::value(now_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::Kind.eq(LeaseKind::Created.as_str()))
        .filter(Column::State.eq(LeaseState::Active.as_str()))
        .filter(Column::ClaimedAtUs.is_null())
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected == 1)
}

/// Claims due leases for one sweeper: ended windows, and temporary alerts past their grace.
pub async fn claim_due(now_us: i64, limit: u64) -> Result<Vec<AlertLease>, Error> {
    claim_due_with(get_orm_client_rw().await, now_us, limit).await
}

/// Claims one lease in `state` to finish it now; None when it is not in it or another end holds it.
pub async fn claim_one(
    org_id: &str,
    id: &str,
    state: LeaseState,
    now_us: i64,
) -> Result<Option<AlertLease>, Error> {
    let conn = get_orm_client_rw().await;
    let Some(lease) = get_with(conn, org_id, id).await? else {
        return Ok(None);
    };
    if lease.state != state || !claimable(lease.claimed_at_us, now_us) {
        return Ok(None);
    }
    stamp_claim(conn, lease, now_us).await
}

/// Records how a claimed lease finished; false when another sweeper's claim has replaced this one.
pub async fn finish(
    lease: &AlertLease,
    state: LeaseState,
    state_reason: Option<String>,
    now_us: i64,
) -> Result<bool, Error> {
    finish_with(
        get_orm_client_rw().await,
        lease,
        state,
        state_reason,
        now_us,
    )
    .await
}

pub(crate) async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    lease: &AlertLease,
) -> Result<(), Error> {
    ActiveModel {
        id: Set(lease.id.clone()),
        org_id: Set(lease.org_id.clone()),
        alert_id: Set(lease.alert_id.clone()),
        kind: Set(lease.kind.as_str().to_string()),
        set_value: Set(lease.set_value),
        prior_enabled: Set(lease.prior_enabled),
        prior_creates_incident: Set(lease.prior_creates_incident),
        alert_version_us: Set(lease.alert_version_us),
        end_version_us: Set(lease.end_version_us),
        starts_at_us: Set(lease.starts_at_us),
        ends_at_us: Set(lease.ends_at_us),
        set_by: Set(lease.set_by.clone()),
        reason: Set(lease.reason.clone()),
        origin_ref: Set(lease.origin_ref.clone()),
        state: Set(lease.state.as_str().to_string()),
        state_reason: Set(lease.state_reason.clone()),
        ended_at_us: Set(lease.ended_at_us),
        claimed_at_us: Set(lease.claimed_at_us),
        region: Set(lease.region.clone()),
        created_at_us: Set(lease.created_at_us),
        updated_at_us: Set(lease.updated_at_us),
    }
    .insert(conn)
    .await?;
    Ok(())
}

pub(crate) async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<AlertLease>, Error> {
    let model = Entity::find_by_id(id.to_string())
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await?;
    model.map(from_model).transpose()
}

pub(crate) async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: Option<&str>,
    state: Option<LeaseState>,
    limit: u64,
) -> Result<Vec<AlertLease>, Error> {
    let mut query = Entity::find().filter(Column::OrgId.eq(org_id));
    if let Some(alert_id) = alert_id {
        query = query.filter(Column::AlertId.eq(alert_id));
    }
    if let Some(state) = state {
        query = query.filter(Column::State.eq(state.as_str()));
    }
    let models = query
        .order_by_desc(Column::StartsAtUs)
        .limit(limit)
        .all(conn)
        .await?;
    Ok(decode_all(
        "alert_leases",
        models,
        |m| m.id.clone(),
        from_model,
    ))
}

pub(crate) async fn claim_due_with<C: TransactionTrait>(
    conn: &C,
    now_us: i64,
    limit: u64,
) -> Result<Vec<AlertLease>, Error> {
    let txn = conn.begin().await?;
    let ending = Condition::all()
        .add(Column::State.eq(LeaseState::Active.as_str()))
        .add(Column::EndsAtUs.lte(now_us));
    let purging = Condition::all()
        .add(Column::State.eq(LeaseState::Ended.as_str()))
        .add(Column::Kind.eq(LeaseKind::Created.as_str()))
        .add(Column::EndedAtUs.lte(now_us - PURGE_AFTER_US));
    let unfinished = Condition::all()
        .add(Column::State.eq(LeaseState::Pending.as_str()))
        .add(Column::CreatedAtUs.lte(now_us - PENDING_TTL_US));
    let unclaimed = Condition::any()
        .add(Column::ClaimedAtUs.is_null())
        .add(Column::ClaimedAtUs.lt(now_us - CLAIM_TTL_US));
    let mut query = Entity::find()
        .filter(Condition::any().add(ending).add(purging).add(unfinished))
        .filter(unclaimed)
        .order_by_asc(Column::EndsAtUs)
        .limit(limit);
    // Each scheduler node sweeps; the lock and skip keep two nodes off one lease.
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock_with_behavior(LockType::Update, LockBehavior::SkipLocked);
    }
    let models = query.all(&txn).await?;
    let mut claimed = Vec::with_capacity(models.len());
    for lease in decode_all("alert_leases", models, |m| m.id.clone(), from_model) {
        if let Some(lease) = stamp_claim(&txn, lease, now_us).await? {
            claimed.push(lease);
        }
    }
    txn.commit().await?;
    Ok(claimed)
}

pub(crate) async fn finish_with<C: ConnectionTrait>(
    conn: &C,
    lease: &AlertLease,
    state: LeaseState,
    state_reason: Option<String>,
    now_us: i64,
) -> Result<bool, Error> {
    let ended_at = lease.ended_at_us.unwrap_or(now_us);
    let mut update = Entity::update_many()
        .col_expr(Column::State, Expr::value(state.as_str()))
        .col_expr(Column::StateReason, Expr::value(state_reason))
        .col_expr(Column::EndedAtUs, Expr::value(ended_at))
        .col_expr(Column::ClaimedAtUs, Expr::value(Option::<i64>::None))
        .col_expr(Column::UpdatedAtUs, Expr::value(now_us))
        .filter(Column::Id.eq(lease.id.as_str()));
    update = match lease.claimed_at_us {
        Some(claimed) => update.filter(Column::ClaimedAtUs.eq(claimed)),
        None => update.filter(Column::ClaimedAtUs.is_null()),
    };
    Ok(update.exec(conn).await?.rows_affected == 1)
}

pub(crate) async fn discard_with<C: ConnectionTrait>(
    conn: &C,
    lease: &AlertLease,
) -> Result<bool, Error> {
    let mut delete = Entity::delete_many()
        .filter(Column::Id.eq(lease.id.as_str()))
        .filter(Column::State.eq(LeaseState::Pending.as_str()));
    delete = match lease.claimed_at_us {
        Some(claimed) => delete.filter(Column::ClaimedAtUs.eq(claimed)),
        None => delete.filter(Column::ClaimedAtUs.is_null()),
    };
    Ok(delete.exec(conn).await?.rows_affected == 1)
}

/// Inside a write's transaction: holds the pending lease row while it is still unclaimed, so a
/// sweeper's claim waits for the write, and a write after a sweeper let it go lands nothing.
pub(crate) async fn hold_pending_in<C: ConnectionTrait>(conn: &C, id: &str) -> Result<bool, Error> {
    let res = Entity::update_many()
        .col_expr(Column::ClaimedAtUs, Expr::value(Option::<i64>::None))
        .filter(Column::Id.eq(id))
        .filter(Column::State.eq(LeaseState::Pending.as_str()))
        .filter(Column::ClaimedAtUs.is_null())
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

fn claimable(claimed_at_us: Option<i64>, now_us: i64) -> bool {
    claimed_at_us.is_none_or(|at| at < now_us - CLAIM_TTL_US)
}

/// Stamps the claim and the end version, only while the claim read is still the stored one.
async fn stamp_claim<C: ConnectionTrait>(
    conn: &C,
    mut lease: AlertLease,
    now_us: i64,
) -> Result<Option<AlertLease>, Error> {
    let end_version = lease.end_stamp(now_us);
    let mut update = Entity::update_many()
        .col_expr(Column::ClaimedAtUs, Expr::value(now_us))
        .col_expr(Column::EndVersionUs, Expr::value(end_version))
        .filter(Column::Id.eq(lease.id.as_str()))
        .filter(Column::State.eq(lease.state.as_str()));
    update = match lease.claimed_at_us {
        Some(claimed) => update.filter(Column::ClaimedAtUs.eq(claimed)),
        None => update.filter(Column::ClaimedAtUs.is_null()),
    };
    if update.exec(conn).await?.rows_affected != 1 {
        return Ok(None);
    }
    lease.claimed_at_us = Some(now_us);
    lease.end_version_us = Some(end_version);
    Ok(Some(lease))
}

fn from_model(m: Model) -> Result<AlertLease, Error> {
    let kind = m.kind.parse::<LeaseKind>().map_err(Error::Message)?;
    let state = m.state.parse::<LeaseState>().map_err(Error::Message)?;
    Ok(AlertLease {
        id: m.id,
        org_id: m.org_id,
        alert_id: m.alert_id,
        kind,
        set_value: m.set_value,
        prior_enabled: m.prior_enabled,
        prior_creates_incident: m.prior_creates_incident,
        alert_version_us: m.alert_version_us,
        end_version_us: m.end_version_us,
        starts_at_us: m.starts_at_us,
        ends_at_us: m.ends_at_us,
        set_by: m.set_by,
        reason: m.reason,
        origin_ref: m.origin_ref,
        state,
        state_reason: m.state_reason,
        ended_at_us: m.ended_at_us,
        claimed_at_us: m.claimed_at_us,
        region: m.region,
        created_at_us: m.created_at_us,
        updated_at_us: m.updated_at_us,
    })
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};
    use sea_orm_migration::{MigrationTrait, SchemaManager};

    use super::*;
    use crate::table::migration::alert_leases_migration_for_test as migration;

    const NOW: i64 = 1_000_000_000_000;

    /// SQLite, then a fresh Postgres schema when `ZO_META_POSTGRES_DSN` is set.
    async fn backends() -> Vec<(&'static str, DatabaseConnection, Option<String>)> {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let mut out = vec![("sqlite", Database::connect(opts).await.unwrap(), None)];
        if let Some(schema) = pg_schema().await {
            out.push(("postgres", pg_connection(&schema).await, Some(schema)));
        }
        out
    }

    async fn pg_schema() -> Option<String> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!(
            "lease_test_{}",
            config::ider::generate().to_ascii_lowercase()
        );
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        Some(schema)
    }

    async fn pg_connection(schema: &str) -> DatabaseConnection {
        let mut options = ConnectOptions::new(std::env::var("ZO_META_POSTGRES_DSN").unwrap());
        options
            .max_connections(1)
            .set_schema_search_path(schema.to_string());
        Database::connect(options).await.unwrap()
    }

    async fn drop_schema(schema: Option<String>) {
        let Some(schema) = schema else { return };
        let admin = Database::connect(std::env::var("ZO_META_POSTGRES_DSN").unwrap())
            .await
            .unwrap();
        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .await
            .unwrap();
    }

    fn lease(id: &str, state: LeaseState, kind: LeaseKind, ends_at_us: i64) -> AlertLease {
        AlertLease {
            id: id.to_string(),
            org_id: "acme".into(),
            alert_id: "a1".into(),
            kind,
            set_value: true,
            alert_version_us: 10,
            starts_at_us: 1,
            ends_at_us,
            set_by: "dana@acme.com".into(),
            reason: "checkout stopped".into(),
            state,
            region: "default".into(),
            created_at_us: 1,
            updated_at_us: 1,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn the_migration_builds_and_drops_the_table_on_each_backend() {
        for (backend, db, schema) in backends().await {
            let manager = SchemaManager::new(&db);
            migration().up(&manager).await.unwrap();
            assert!(
                manager.has_table("alert_leases").await.unwrap(),
                "{backend}"
            );
            for column in [
                "alert_version_us",
                "end_version_us",
                "claimed_at_us",
                "region",
            ] {
                assert!(
                    manager.has_column("alert_leases", column).await.unwrap(),
                    "{backend} {column}"
                );
            }
            for index in [
                "alert_leases_org_alert_state_idx",
                "alert_leases_state_ends_at_idx",
            ] {
                assert!(
                    manager.has_index("alert_leases", index).await.unwrap(),
                    "{backend} {index}"
                );
            }
            insert_with(&db, &lease("l1", LeaseState::Active, LeaseKind::Created, 5))
                .await
                .unwrap();
            assert_eq!(
                get_with(&db, "acme", "l1").await.unwrap().unwrap().kind,
                LeaseKind::Created
            );
            migration().down(&manager).await.unwrap();
            assert!(
                !manager.has_table("alert_leases").await.unwrap(),
                "{backend}"
            );
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn a_sweep_claims_only_what_is_due_and_not_held() {
        use LeaseKind::{Created, CreatesIncident};
        use LeaseState::{Active, Ended, Pending};
        let fresh = Some(NOW - 1);
        let stale = Some(NOW - CLAIM_TTL_US - 1);
        let purge_due = Some(NOW - PURGE_AFTER_US - 1);
        let cases = [
            ("window over", Active, Created, NOW - 1, None, None, true),
            (
                "window open",
                Active,
                CreatesIncident,
                NOW + 1,
                None,
                None,
                false,
            ),
            (
                "held by a live sweeper",
                Active,
                Created,
                NOW - 1,
                fresh,
                None,
                false,
            ),
            (
                "held by a dead sweeper",
                Active,
                Created,
                NOW - 1,
                stale,
                None,
                true,
            ),
            (
                "temporary alert past grace",
                Ended,
                Created,
                1,
                None,
                purge_due,
                true,
            ),
            (
                "temporary alert in grace",
                Ended,
                Created,
                1,
                None,
                Some(NOW),
                false,
            ),
            (
                "ended toggle",
                Ended,
                CreatesIncident,
                1,
                None,
                purge_due,
                false,
            ),
            (
                "request died",
                Pending,
                CreatesIncident,
                1,
                None,
                None,
                true,
            ),
            ("request running", Pending, Created, NOW, None, None, false),
        ];
        for (backend, db, schema) in backends().await {
            migration().up(&SchemaManager::new(&db)).await.unwrap();
            for (name, state, kind, ends_at, claimed, ended_at, _) in cases {
                let mut row = lease(name, state, kind, ends_at);
                row.claimed_at_us = claimed;
                row.ended_at_us = ended_at;
                // A pending row ages from `created_at_us`; these cases put it at their `ends_at`.
                if state == Pending {
                    row.created_at_us = ends_at;
                }
                insert_with(&db, &row).await.unwrap();
            }
            let claimed = claim_due_with(&db, NOW, 100).await.unwrap();
            for (name, .., due) in cases {
                let got = claimed.iter().find(|l| l.id == name);
                assert_eq!(got.is_some(), due, "{backend}: {name}");
                if let Some(got) = got {
                    assert_eq!(got.claimed_at_us, Some(NOW), "{backend}: {name}");
                    assert_eq!(got.end_version_us, Some(NOW), "{backend}: {name}");
                }
            }
            assert!(
                claim_due_with(&db, NOW, 100).await.unwrap().is_empty(),
                "{backend}: a second sweep in the same instant finds every due lease held"
            );
            drop_schema(schema).await;
        }
    }

    #[tokio::test]
    async fn two_sweepers_on_postgres_claim_each_lease_once() {
        let Some(schema) = pg_schema().await else {
            eprintln!("skipped: needs ZO_META_POSTGRES_DSN");
            return;
        };
        let (a, b) = (pg_connection(&schema).await, pg_connection(&schema).await);
        migration().up(&SchemaManager::new(&a)).await.unwrap();
        let ids: Vec<String> = (0..40).map(|n| format!("due-{n:02}")).collect();
        for id in &ids {
            insert_with(
                &a,
                &lease(id, LeaseState::Active, LeaseKind::Created, NOW - 1),
            )
            .await
            .unwrap();
        }
        let mut seen = std::collections::HashSet::new();
        for _ in 0..4 {
            let (x, y) = tokio::join!(claim_due_with(&a, NOW, 15), claim_due_with(&b, NOW, 15));
            for lease in x.unwrap().into_iter().chain(y.unwrap()) {
                assert!(seen.insert(lease.id.clone()), "{} claimed twice", lease.id);
            }
        }
        assert_eq!(seen.len(), ids.len());
        drop_schema(Some(schema)).await;
    }
}
