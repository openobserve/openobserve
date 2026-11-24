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

//! `org_secrets`: one row per named secret or variable; every op is bound to its org.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, sea_query::LockType,
};

pub use super::entity::org_secrets::{
    ActiveModel, Column, Entity, Model, PinMode, PrivateLocations,
};
use crate::{db::get_orm_client_rw, errors::Error};

/// States held by the partial unique index on `(org_id, name)`.
pub const LIVE_STATES: [&str; 2] = ["active", "deleted"];

/// The `policy_stamp` of a policy, name or state write over a row stamped `current`.
pub fn next_policy_stamp(now: i64, current: i64) -> i64 {
    now.max(current.saturating_add(1))
}

pub async fn get_secret_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?)
}

/// The live (`active` or `deleted`) row holding `name`, if any.
pub async fn get_live_by_name_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .filter(Column::State.is_in(LIVE_STATES))
        .one(conn)
        .await?)
}

/// The row locked `FOR UPDATE` on PostgreSQL; SQLite serializes writers on its own.
pub async fn get_for_update_in<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id));
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock(LockType::Update);
    }
    Ok(query.one(txn).await?)
}

/// The org's rows among `ids`, locked `FOR SHARE` in id order on PostgreSQL.
pub async fn lock_for_share<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    ids: &[String],
) -> Result<Vec<Model>, Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.is_in(ids.iter().cloned()))
        .order_by_asc(Column::Id);
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock(LockType::Share);
    }
    Ok(query.all(txn).await?)
}

pub async fn insert_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<Model, Error> {
    Ok(row.insert(conn).await?)
}

/// Writes `row` only when it belongs to `org_id`; a foreign id changes nothing.
pub async fn update_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    row: ActiveModel,
) -> Result<Option<Model>, Error> {
    match Entity::update(row)
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await
    {
        Ok(model) => Ok(Some(model)),
        Err(sea_orm::DbErr::RecordNotUpdated) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_in(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Set, TransactionTrait};

    use super::*;
    use crate::table::testing::{meta_store, unique};

    /// Every store table-op module; each public op that takes an id also takes `org_id`.
    const STORE_OP_SOURCES: [(&str, &str); 15] = [
        ("org_secrets", include_str!("org_secrets.rs")),
        ("org_secret_values", include_str!("org_secret_values.rs")),
        ("secret_backends", include_str!("secret_backends.rs")),
        (
            "secret_backend_identities",
            include_str!("secret_backend_identities.rs"),
        ),
        (
            "secret_identity_jobs",
            include_str!("secret_identity_jobs.rs"),
        ),
        (
            "secret_backend_readiness",
            include_str!("secret_backend_readiness.rs"),
        ),
        (
            "org_secret_consumers",
            include_str!("org_secret_consumers.rs"),
        ),
        ("secret_refs", include_str!("secret_refs.rs")),
        (
            "secret_dependencies",
            include_str!("secret_dependencies.rs"),
        ),
        (
            "secret_consumer_auth",
            include_str!("secret_consumer_auth.rs"),
        ),
        ("secret_aliases", include_str!("secret_aliases.rs")),
        (
            "org_secret_value_status",
            include_str!("org_secret_value_status.rs"),
        ),
        (
            "secret_arrival_pending",
            include_str!("secret_arrival_pending.rs"),
        ),
        (
            "secret_prescan_hits",
            include_str!("secret_prescan_hits.rs"),
        ),
        (
            "secret_store_job_markers",
            include_str!("secret_store_job_markers.rs"),
        ),
    ];

    fn row(org: &str, name: &str) -> ActiveModel {
        let now = config::utils::time::now_micros();
        ActiveModel {
            id: Set(config::ider::ksuid()),
            org_id: Set(org.to_string()),
            name: Set(name.to_string()),
            kind: Set("secret".to_string()),
            description: Set(String::new()),
            allowed_hosts: Set(String::new()),
            pin_mode: Set(PinMode::None),
            pin_override_reason: Set(String::new()),
            pin_override_by: Set(String::new()),
            pin_override_at: Set(0),
            private_locations: Set(PrivateLocations::Off),
            private_locations_reason: Set(String::new()),
            private_locations_by: Set(String::new()),
            private_locations_at: Set(0),
            state: Set("active".to_string()),
            policy_rev: Set(config::ider::ksuid()),
            policy_version: Set(1),
            policy_stamp: Set(0),
            origin_region: Set(String::new()),
            created_by: Set("u".to_string()),
            updated_by: Set("u".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
            deleted_at: Set(0),
            purge_after: Set(0),
            purged_at: Set(0),
        }
    }

    /// `(name, params)` of every `pub async fn` (the DB ops) in `source`.
    fn public_ops(source: &str) -> Vec<(String, String)> {
        let body = source.split("#[cfg(test)]").next().unwrap_or(source);
        let mut out = Vec::new();
        for (at, _) in body.match_indices("pub async fn ") {
            let rest = &body[at + "pub async fn ".len()..];
            let name_end = rest.find(['(', '<']).unwrap();
            let open = rest.find('(').unwrap();
            let close = rest.find(')').unwrap();
            out.push((
                rest[..name_end].to_string(),
                rest[open + 1..close].to_string(),
            ));
        }
        out
    }

    #[test]
    fn every_public_op_that_takes_an_id_takes_org_id() {
        let mut offenders = Vec::new();
        let mut seen = 0;
        for (module, source) in STORE_OP_SOURCES {
            for (name, params) in public_ops(source) {
                seen += 1;
                let takes_id = params
                    .split(',')
                    .filter_map(|p| p.split(':').next())
                    .map(str::trim)
                    .any(|p| p == "id" || p == "ids" || p.ends_with("_id") || p.ends_with("_ids"));
                if takes_id && !params.contains("org_id: &str") {
                    offenders.push(format!("{module}::{name}"));
                }
            }
        }
        assert!(seen > 30, "the scan found only {seen} public ops");
        assert!(offenders.is_empty(), "{offenders:?}");
    }

    #[test]
    fn every_store_query_filters_org_first() {
        for (module, source) in STORE_OP_SOURCES {
            let body = source.split("#[cfg(test)]").next().unwrap();
            for (at, _) in body.match_indices("::find()") {
                let next = body[at..].find(".filter(").map(|i| &body[at + i..]);
                let first = next.and_then(|f| f.split(')').next()).unwrap_or("");
                assert!(
                    first.contains("OrgId"),
                    "{module}: a query's first filter is `{first}`"
                );
            }
            for (at, _) in body.match_indices("::delete_many()") {
                let first = body[at..]
                    .find(".filter(")
                    .map(|i| body[at + i..].split(')').next().unwrap())
                    .unwrap_or("");
                assert!(
                    first.contains("OrgId"),
                    "{module}: a delete's first filter is `{first}`"
                );
            }
        }
    }

    #[test]
    fn policy_stamps_strictly_increase_and_climb_over_a_future_row() {
        let now = 1_700_000_000_000_000;
        let first = next_policy_stamp(now, 0);
        let second = next_policy_stamp(now, first);
        assert_eq!(first, now);
        assert!(second > first);
        let future = now + 3_600_000_000;
        assert_eq!(next_policy_stamp(now, future), future + 1);
        assert_eq!(next_policy_stamp(now, i64::MAX), i64::MAX);
    }

    #[tokio::test]
    async fn two_policy_writes_in_one_microsecond_get_increasing_stamps() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org = unique("sec_stamp");
        let id = insert_in(conn, row(&org, "TOKEN")).await.unwrap().id;
        let now = config::utils::time::now_micros();
        let mut stamps = Vec::new();
        for _ in 0..2 {
            let txn = conn.begin().await.unwrap();
            let current = get_for_update_in(&txn, &org, &id).await.unwrap().unwrap();
            let stamp = next_policy_stamp(now, current.policy_stamp);
            let mut am: ActiveModel = current.into();
            am.policy_stamp = Set(stamp);
            am.policy_rev = Set(config::ider::ksuid());
            update_in(&txn, &org, am).await.unwrap().unwrap();
            txn.commit().await.unwrap();
            stamps.push(stamp);
        }
        assert!(stamps[1] > stamps[0], "{stamps:?}");
        delete_by_org(&org).await.unwrap();
    }

    #[tokio::test]
    async fn foreign_ids_read_lock_and_update_nothing() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org_a = unique("sec_bind_a");
        let org_b = unique("sec_bind_b");
        let b_row = insert_in(conn, row(&org_b, "TOKEN")).await.unwrap();

        assert!(
            get_secret_in(conn, &org_a, &b_row.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            get_live_by_name_in(conn, &org_a, "TOKEN")
                .await
                .unwrap()
                .is_none()
        );
        let txn = conn.begin().await.unwrap();
        assert!(
            lock_for_share(&txn, &org_a, std::slice::from_ref(&b_row.id))
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            get_for_update_in(&txn, &org_a, &b_row.id)
                .await
                .unwrap()
                .is_none()
        );
        let locked = lock_for_share(&txn, &org_b, std::slice::from_ref(&b_row.id))
            .await
            .unwrap();
        txn.commit().await.unwrap();
        assert_eq!(locked.len(), 1);

        let mut am: ActiveModel = b_row.clone().into();
        am.description = Set("changed".to_string());
        assert!(update_in(conn, &org_a, am).await.unwrap().is_none());
        let after = get_secret_in(conn, &org_b, &b_row.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.description, "");

        assert_eq!(delete_by_org(&org_a).await.unwrap(), 0);
        assert_eq!(delete_by_org(&org_b).await.unwrap(), 1);
    }
}
