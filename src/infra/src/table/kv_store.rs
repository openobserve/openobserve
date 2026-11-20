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

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, QuerySelect, Set,
    Statement, Value, sea_query::Expr,
};

use super::entity::kv_store::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// A lease row its holder's transaction must still own, by the database clock, when it commits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeaseFence {
    pub org_id: String,
    pub key: String,
    pub token: Vec<u8>,
    pub ttl_us: i64,
}

impl LeaseFence {
    /// True while the lease is live; on Postgres it also share-locks the row, so a claim waits.
    pub async fn check_in<C: ConnectionTrait>(&self, txn: &C) -> Result<bool, errors::Error> {
        let backend = txn.get_database_backend();
        let lock = if backend == DatabaseBackend::Postgres {
            // A holder frozen inside its transaction must not hold a takeover off.
            txn.execute_unprepared("SET LOCAL idle_in_transaction_session_timeout = '5s'")
                .await?;
            " FOR SHARE"
        } else {
            ""
        };
        let sql = format!(
            "SELECT 1 AS live FROM kv_store WHERE org_id = ? AND \"key\" = ? AND value = ? \
             AND updated_at >= {} - ?{lock}",
            db_now_sql(backend)
        );
        let values = vec![
            self.org_id.clone().into(),
            self.key.clone().into(),
            self.token.clone().into(),
            self.ttl_us.into(),
        ];
        let row = txn.query_one(statement(backend, &sql, values)?).await?;
        Ok(row.is_some())
    }
}

/// A lease row with the database's clock read in the same statement.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeaseRow {
    pub key: String,
    pub value: Vec<u8>,
    pub updated_at_us: i64,
    pub db_now_us: i64,
}

impl LeaseRow {
    pub fn is_live(&self, ttl_us: i64) -> bool {
        self.updated_at_us >= self.db_now_us - ttl_us
    }
}

/// Gets a KV value by org_id and key
pub async fn get(org_id: &str, key: &str) -> Result<Option<Model>, errors::Error> {
    get_in(get_orm_client_ro().await, org_id, key).await
}

/// [`get`] from the primary, for a read that must see a write a lagging replica may not have yet.
pub async fn get_primary(org_id: &str, key: &str) -> Result<Option<Model>, errors::Error> {
    get_in(get_orm_client_rw().await, org_id, key).await
}

/// Sets a KV value (upsert: insert or update)
pub async fn set(org_id: &str, key: &str, value: &[u8]) -> Result<(), errors::Error> {
    // Get client first, then acquire lock to prevent deadlock
    // (get_or_init may internally acquire locks during connection)
    let client = get_orm_client_rw().await;
    let now = chrono::Utc::now().timestamp_micros();

    let active_model = ActiveModel {
        org_id: Set(org_id.to_string()),
        key: Set(key.to_string()),
        value: Set(value.to_vec()),
        created_at: Set(now),
        updated_at: Set(now),
    };

    // Use insert with on_conflict to handle upsert
    Entity::insert(active_model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([Column::OrgId, Column::Key])
                .update_columns([Column::Value, Column::UpdatedAt])
                .to_owned(),
        )
        .exec(client)
        .await?;

    Ok(())
}

/// Writes only while the row still holds `expected` (None: no row), so a stale writer is refused.
pub async fn compare_and_set(
    org_id: &str,
    key: &str,
    expected: Option<&[u8]>,
    value: &[u8],
) -> Result<bool, errors::Error> {
    compare_and_set_in(get_orm_client_rw().await, org_id, key, expected, value).await
}

/// `compare_and_set` on `conn`, so a caller's transaction holds it with its other writes.
pub async fn compare_and_set_in<C: ConnectionTrait>(
    client: &C,
    org_id: &str,
    key: &str,
    expected: Option<&[u8]>,
    value: &[u8],
) -> Result<bool, errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let written = match expected {
        None => {
            let row = ActiveModel {
                org_id: Set(org_id.to_string()),
                key: Set(key.to_string()),
                value: Set(value.to_vec()),
                created_at: Set(now),
                updated_at: Set(now),
            };
            Entity::insert(row)
                .on_conflict(
                    sea_orm::sea_query::OnConflict::columns([Column::OrgId, Column::Key])
                        .do_nothing()
                        .to_owned(),
                )
                .exec_without_returning(client)
                .await?
        }
        Some(expected) => {
            Entity::update_many()
                .col_expr(Column::Value, Expr::value(value.to_vec()))
                .col_expr(Column::UpdatedAt, Expr::value(now))
                .filter(Column::OrgId.eq(org_id))
                .filter(Column::Key.eq(key))
                .filter(Column::Value.eq(expected.to_vec()))
                .exec(client)
                .await?
                .rows_affected
        }
    };
    Ok(written == 1)
}

/// Deletes a KV entry by org_id and key
pub async fn delete(org_id: &str, key: &str) -> Result<(), errors::Error> {
    // Get client first, then acquire lock to prevent deadlock
    // (get_or_init may internally acquire locks during connection)
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Key.eq(key))
        .exec(client)
        .await?;
    Ok(())
}

/// Deletes only while the row still holds `expected`, so a newer write is never removed.
pub async fn compare_and_delete(
    org_id: &str,
    key: &str,
    expected: &[u8],
) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let removed = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Key.eq(key))
        .filter(Column::Value.eq(expected.to_vec()))
        .exec(client)
        .await?
        .rows_affected;
    Ok(removed == 1)
}

/// Lists all keys for an org_id with optional prefix filter
pub async fn list(org_id: &str, prefix: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;

    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .select_only()
        .column(Column::Key);

    // Add prefix filter if provided
    if !prefix.is_empty() {
        let prefix_pattern = format!("{}%", prefix);
        query = query.filter(Column::Key.like(&prefix_pattern));
    }

    let keys = query.into_tuple::<String>().all(client).await?;

    Ok(keys)
}

/// Every key of the org.
pub async fn list_keys_by_org(org_id: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    let keys = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .select_only()
        .column(Column::Key)
        .into_tuple::<String>()
        .all(client)
        .await?;
    Ok(keys)
}

/// Clears all KV entries from the table
pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many().exec(client).await?;
    Ok(())
}

/// Deletes all KV entries belonging to the given org and returns their keys.
pub async fn delete_by_org(org_id: &str) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_rw().await;
    let delete = Entity::delete_many().filter(Column::OrgId.eq(org_id));
    Ok(super::delete_returning(client, delete, &[Column::Key]).await?)
}

/// The database's clock in microseconds, the only clock a lease is judged by.
pub async fn db_now_us() -> Result<i64, errors::Error> {
    let client = get_orm_client_rw().await;
    let backend = client.get_database_backend();
    let sql = format!("SELECT {} AS now_us", db_now_sql(backend));
    let row = client
        .query_one(statement(backend, &sql, Vec::new())?)
        .await?
        .ok_or_else(|| errors::Error::Message("the database returned no clock".to_string()))?;
    Ok(row.try_get::<i64>("", "now_us")?)
}

/// Inserts the lease when `seen` is None, else replaces `seen` once it expired by the database
/// clock.
pub async fn lease_claim(
    org_id: &str,
    key: &str,
    seen: Option<&[u8]>,
    token: &[u8],
    ttl_us: i64,
) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let now = db_now_sql(client.get_database_backend());
    let (sql, values): (String, Vec<Value>) = match seen {
        None => (
            format!(
                "INSERT INTO kv_store (org_id, \"key\", value, created_at, updated_at) \
                 VALUES (?, ?, ?, {now}, {now}) ON CONFLICT (org_id, \"key\") DO NOTHING"
            ),
            vec![org_id.into(), key.into(), token.to_vec().into()],
        ),
        Some(seen) => (
            format!(
                "UPDATE kv_store SET value = ?, updated_at = {now} WHERE org_id = ? \
                 AND \"key\" = ? AND value = ? AND updated_at < {now} - ?"
            ),
            vec![
                token.to_vec().into(),
                org_id.into(),
                key.into(),
                seen.to_vec().into(),
                ttl_us.into(),
            ],
        ),
    };
    Ok(execute_counted(client, &sql, values).await? == 1)
}

/// Extends a live lease to the database's now; false means it was lost and nothing may be written.
pub async fn lease_renew(
    org_id: &str,
    key: &str,
    token: &[u8],
    ttl_us: i64,
) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let now = db_now_sql(client.get_database_backend());
    let sql = format!(
        "UPDATE kv_store SET updated_at = {now} WHERE org_id = ? AND \"key\" = ? AND value = ? \
         AND updated_at >= {now} - ?"
    );
    let values = vec![
        org_id.into(),
        key.into(),
        token.to_vec().into(),
        ttl_us.into(),
    ];
    Ok(execute_counted(client, &sql, values).await? == 1)
}

/// Expires the holder's own lease at once, so the next claimer need not wait out the TTL.
pub async fn lease_release(org_id: &str, key: &str, token: &[u8]) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let sql = "UPDATE kv_store SET updated_at = 0 WHERE org_id = ? AND \"key\" = ? AND value = ?";
    let values = vec![org_id.into(), key.into(), token.to_vec().into()];
    Ok(execute_counted(client, sql, values).await? == 1)
}

/// Deletes the row only if it expired by the database clock more than `ttl_us` ago.
pub async fn lease_reap(org_id: &str, key: &str, ttl_us: i64) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let now = db_now_sql(client.get_database_backend());
    let sql =
        format!("DELETE FROM kv_store WHERE org_id = ? AND \"key\" = ? AND updated_at < {now} - ?");
    let values = vec![org_id.into(), key.into(), ttl_us.into()];
    Ok(execute_counted(client, &sql, values).await? == 1)
}

/// Every lease row under `prefix`, read from the primary with the database's clock.
pub async fn lease_rows(org_id: &str, prefix: &str) -> Result<Vec<LeaseRow>, errors::Error> {
    let client = get_orm_client_rw().await;
    let backend = client.get_database_backend();
    let sql = format!(
        "SELECT \"key\", value, updated_at, {} AS now_us FROM kv_store \
         WHERE org_id = ? AND \"key\" LIKE ?",
        db_now_sql(backend)
    );
    let values = vec![org_id.into(), format!("{prefix}%").into()];
    let rows = client.query_all(statement(backend, &sql, values)?).await?;
    let mut leases = Vec::with_capacity(rows.len());
    for row in rows {
        let key: String = row.try_get("", "key")?;
        // LIKE reads `_` as a wildcard, and reserved keys are full of them.
        if !key.starts_with(prefix) {
            continue;
        }
        leases.push(LeaseRow {
            key,
            value: row.try_get("", "value")?,
            updated_at_us: row.try_get("", "updated_at")?,
            db_now_us: row.try_get("", "now_us")?,
        });
    }
    Ok(leases)
}

fn db_now_sql(backend: DatabaseBackend) -> &'static str {
    match backend {
        DatabaseBackend::Postgres => "(extract(epoch from clock_timestamp()) * 1000000)::bigint",
        _ => "CAST((julianday('now') - 2440587.5) * 86400000000.0 AS INTEGER)",
    }
}

fn statement(
    backend: DatabaseBackend,
    sql: &str,
    values: Vec<Value>,
) -> Result<Statement, errors::Error> {
    let sql = crate::scheduler::numbered(backend, sql)?;
    Ok(Statement::from_sql_and_values(backend, sql, values))
}

async fn execute_counted<C: ConnectionTrait>(
    client: &C,
    sql: &str,
    values: Vec<Value>,
) -> Result<u64, errors::Error> {
    let statement = statement(client.get_database_backend(), sql, values)?;
    Ok(client.execute(statement).await?.rows_affected())
}

async fn get_in<C: ConnectionTrait>(
    client: &C,
    org_id: &str,
    key: &str,
) -> Result<Option<Model>, errors::Error> {
    let kv_entry = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Key.eq(key))
        .one(client)
        .await?;
    Ok(kv_entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_org_delete_returns_exactly_the_keys_it_removed() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_kv");
        let other = format!("{org}_other");
        for (org, key) in [(&org, "a"), (&org, "b"), (&other, "a")] {
            set(org, key, b"v").await.unwrap();
        }

        let mut removed = delete_by_org(&org).await.unwrap();
        removed.sort();
        let left = list_keys_by_org(&org).await.unwrap();
        let kept = list_keys_by_org(&other).await.unwrap();
        delete_by_org(&other).await.unwrap();

        assert_eq!(removed, ["a", "b"]);
        assert!(left.is_empty());
        assert_eq!(kept, ["a"]);
    }

    #[tokio::test]
    async fn a_compare_and_set_writes_only_over_the_expected_value() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_kv_cas");
        assert!(compare_and_set(&org, "k", None, b"v1").await.unwrap());
        assert!(!compare_and_set(&org, "k", None, b"v2").await.unwrap());
        assert!(
            !compare_and_set(&org, "k", Some(b"v0"), b"v2")
                .await
                .unwrap()
        );
        assert_eq!(get(&org, "k").await.unwrap().unwrap().value, b"v1");
        assert!(
            compare_and_set(&org, "k", Some(b"v1"), b"v1")
                .await
                .unwrap()
        );
        assert!(
            compare_and_set(&org, "k", Some(b"v1"), b"v2")
                .await
                .unwrap()
        );
        assert!(
            !compare_and_set(&org, "k", Some(b"v1"), b"v3")
                .await
                .unwrap()
        );
        assert_eq!(get(&org, "k").await.unwrap().unwrap().value, b"v2");
        assert!(
            !compare_and_set(&org, "gone", Some(b"v1"), b"v2")
                .await
                .unwrap()
        );
        assert!(get(&org, "gone").await.unwrap().is_none());
        delete_by_org(&org).await.unwrap();
    }

    const TTL: i64 = 30_000_000;
    const LEASE: &str = "_o2_ao/lease/r1/0";

    /// Moves the row's database time back, as the database's clock passing would.
    async fn age(org: &str, key: &str, by_us: i64) {
        let client = get_orm_client_rw().await;
        let now = db_now_sql(client.get_database_backend());
        let sql =
            format!("UPDATE kv_store SET updated_at = {now} - ? WHERE org_id = ? AND \"key\" = ?");
        let values = vec![by_us.into(), org.into(), key.into()];
        assert_eq!(execute_counted(client, &sql, values).await.unwrap(), 1);
    }

    fn fence(org: &str, token: &[u8]) -> LeaseFence {
        LeaseFence {
            org_id: org.to_string(),
            key: LEASE.to_string(),
            token: token.to_vec(),
            ttl_us: TTL,
        }
    }

    #[tokio::test]
    async fn a_lease_lives_and_expires_by_the_database_clock_alone() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_lease");
        let db = get_orm_client_rw().await;
        assert!(lease_claim(&org, LEASE, None, b"a|1", TTL).await.unwrap());
        assert!(!lease_claim(&org, LEASE, None, b"b|1", TTL).await.unwrap());
        assert!(
            !lease_claim(&org, LEASE, Some(b"a|1"), b"b|2", TTL)
                .await
                .unwrap()
        );
        assert!(lease_renew(&org, LEASE, b"a|1", TTL).await.unwrap());
        assert!(!lease_renew(&org, LEASE, b"b|2", TTL).await.unwrap());
        assert!(fence(&org, b"a|1").check_in(db).await.unwrap());
        assert!(
            !lease_reap(&org, LEASE, TTL).await.unwrap(),
            "a live row is never reaped"
        );

        age(&org, LEASE, TTL + 1).await;
        assert!(!fence(&org, b"a|1").check_in(db).await.unwrap());
        assert!(!lease_renew(&org, LEASE, b"a|1", TTL).await.unwrap());
        assert!(
            lease_claim(&org, LEASE, Some(b"a|1"), b"b|2", TTL)
                .await
                .unwrap()
        );
        assert!(
            !lease_claim(&org, LEASE, Some(b"a|1"), b"c|2", TTL)
                .await
                .unwrap()
        );
        assert!(!fence(&org, b"a|1").check_in(db).await.unwrap());
        assert!(fence(&org, b"b|2").check_in(db).await.unwrap());

        assert!(!lease_release(&org, LEASE, b"a|1").await.unwrap());
        assert!(lease_release(&org, LEASE, b"b|2").await.unwrap());
        let rows = lease_rows(&org, "_o2_ao/lease/").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].is_live(TTL), "a released lease is expired at once");
        assert!(
            lease_claim(&org, LEASE, Some(b"b|2"), b"c|3", TTL)
                .await
                .unwrap()
        );
        let rows = lease_rows(&org, "_o2_ao/lease/").await.unwrap();
        assert_eq!(
            (rows[0].value.as_slice(), rows[0].is_live(TTL)),
            (&b"c|3"[..], true)
        );
        assert!(lease_rows(&org, "_o2_ao/leasex").await.unwrap().is_empty());

        age(&org, LEASE, 2 * TTL + 1).await;
        assert!(lease_reap(&org, LEASE, 2 * TTL).await.unwrap());
        assert!(get(&org, LEASE).await.unwrap().is_none());
        delete_by_org(&org).await.unwrap();
    }

    #[tokio::test]
    async fn a_claim_waits_for_a_fenced_transaction_to_commit_on_postgres() {
        use sea_orm::TransactionTrait;

        if !crate::table::testing::meta_store().await
            || config::get_config().common.meta_store != "postgres"
        {
            return;
        }
        let org = crate::table::testing::unique("t_lease_fence");
        assert!(lease_claim(&org, LEASE, None, b"a|1", TTL).await.unwrap());
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        assert!(fence(&org, b"a|1").check_in(&txn).await.unwrap());
        // A TTL of 0 makes the row look expired to this claimer, as a paused holder's would.
        let claim_org = org.clone();
        let claim =
            tokio::spawn(
                async move { lease_claim(&claim_org, LEASE, Some(b"a|1"), b"b|2", 0).await },
            );
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(!claim.is_finished(), "the claim waits on the fence");
        assert!(
            compare_and_set_in(&txn, &org, "effect", None, b"a")
                .await
                .unwrap()
        );
        txn.commit().await.unwrap();
        assert!(
            claim.await.unwrap().unwrap(),
            "the claim lands after the fenced commit"
        );
        assert_eq!(
            get_primary(&org, "effect").await.unwrap().unwrap().value,
            b"a"
        );
        let db = get_orm_client_rw().await;
        assert!(!fence(&org, b"a|1").check_in(db).await.unwrap());
        delete_by_org(&org).await.unwrap();
    }

    #[tokio::test]
    async fn a_compare_and_delete_removes_only_the_expected_value() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_kv_cad");
        set(&org, "k", b"v2").await.unwrap();
        assert!(!compare_and_delete(&org, "k", b"v1").await.unwrap());
        assert_eq!(get(&org, "k").await.unwrap().unwrap().value, b"v2");
        assert!(compare_and_delete(&org, "k", b"v2").await.unwrap());
        assert!(get(&org, "k").await.unwrap().is_none());
        assert!(!compare_and_delete(&org, "k", b"v2").await.unwrap());
    }
}
