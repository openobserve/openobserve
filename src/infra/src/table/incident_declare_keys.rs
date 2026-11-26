// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::meta::alerts::incidents::DeclareIntent;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseTransaction, DbErr, EntityTrait,
    QueryFilter, QuerySelect, Statement, TransactionTrait, sea_query::OnConflict,
};
use sha2::{Digest, Sha256};

use super::entity::incident_declare_keys::{Column, Entity, Model};
use crate::db::get_orm_client_rw;

const EFFECTS_MODULE: &str = "incident_declare_effects";

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    key: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id((org.to_owned(), key.to_owned()))
        .one(conn)
        .await
}

pub async fn insert_in(txn: &DatabaseTransaction, row: Model) -> Result<bool, DbErr> {
    let row: super::entity::incident_declare_keys::ActiveModel = row.into();
    let affected = Entity::insert(row)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::DeclareKey])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(txn)
        .await?;
    Ok(affected > 0)
}

pub async fn set_effects_in(
    txn: &DatabaseTransaction,
    org: &str,
    key: &str,
    intent: &DeclareIntent,
) -> Result<(), DbErr> {
    let value = serde_json::to_string(intent)
        .map_err(|error| DbErr::Custom(format!("encode declare effects: {error}")))?;
    // This metadata shares the commit with the request key and is outside the public KV table.
    let written = txn
        .execute(Statement::from_sql_and_values(
            txn.get_database_backend(),
            "INSERT INTO meta (module, key1, key2, start_dt, value) \
             SELECT $1, org_id, $2, created_at, $3 FROM incident_declare_keys \
             WHERE org_id = $4 AND declare_key = $5 \
             ON CONFLICT (module, key1, key2, start_dt) DO UPDATE SET value = excluded.value",
            [
                EFFECTS_MODULE.into(),
                effect_key(key).into(),
                value.into(),
                org.into(),
                key.into(),
            ],
        ))
        .await?;
    if written.rows_affected() != 1 {
        return Err(DbErr::RecordNotFound("incident declare key".into()));
    }
    Ok(())
}

pub async fn get_intent(org: &str, key: &str) -> Result<Option<DeclareIntent>, DbErr> {
    read_intent(get_orm_client_rw().await, org, key).await
}

pub async fn mutate_intent<T>(
    org: &str,
    key: &str,
    update: impl FnOnce(&mut DeclareIntent) -> Option<T>,
) -> Result<Option<T>, DbErr> {
    let txn = get_orm_client_rw().await.begin().await?;
    let query = Entity::find_by_id((org.to_owned(), key.to_owned()));
    let query = if txn.get_database_backend() == DatabaseBackend::Postgres {
        query.lock_exclusive()
    } else {
        query
    };
    if query.one(&txn).await?.is_none() {
        txn.rollback().await?;
        return Ok(None);
    }
    let Some(mut intent) = read_intent(&txn, org, key).await? else {
        txn.rollback().await?;
        return Ok(None);
    };
    let Some(result) = update(&mut intent) else {
        txn.rollback().await?;
        return Ok(None);
    };
    set_effects_in(&txn, org, key, &intent).await?;
    txn.commit().await?;
    Ok(Some(result))
}

pub async fn delete_by_incident<C: TransactionTrait>(
    conn: &C,
    org: &str,
    incident: &str,
) -> Result<(), DbErr> {
    let txn = conn.begin().await?;
    let delete = Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.eq(incident));
    let keys: Vec<String> = super::delete_returning(&txn, delete, &[Column::DeclareKey]).await?;
    for key in keys {
        txn.execute(Statement::from_sql_and_values(
            txn.get_database_backend(),
            "DELETE FROM meta WHERE module = $1 AND key1 = $2 AND key2 = $3",
            [EFFECTS_MODULE.into(), org.into(), effect_key(&key).into()],
        ))
        .await?;
    }
    txn.commit().await
}

pub async fn delete_by_org<C: TransactionTrait>(conn: &C, org: &str) -> Result<(), DbErr> {
    let txn = conn.begin().await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .exec(&txn)
        .await?;
    txn.execute(Statement::from_sql_and_values(
        txn.get_database_backend(),
        "DELETE FROM meta WHERE module = $1 AND key1 = $2",
        [EFFECTS_MODULE.into(), org.into()],
    ))
    .await?;
    txn.commit().await
}

async fn read_intent<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    key: &str,
) -> Result<Option<DeclareIntent>, DbErr> {
    let row = conn
        .query_one(Statement::from_sql_and_values(
            conn.get_database_backend(),
            "SELECT meta.value FROM meta JOIN incident_declare_keys AS request_key \
             ON request_key.org_id = meta.key1 AND request_key.created_at = meta.start_dt \
             WHERE meta.module = $1 AND meta.key1 = $2 AND meta.key2 = $3 \
             AND request_key.declare_key = $4",
            [
                EFFECTS_MODULE.into(),
                org.into(),
                effect_key(key).into(),
                key.into(),
            ],
        ))
        .await?;
    row.map(|row| {
        let value: String = row.try_get_by_index(0)?;
        serde_json::from_str(&value).map_err(|error| {
            DbErr::Custom(format!(
                "decode declare effects at {}:{}",
                error.line(),
                error.column()
            ))
        })
    })
    .transpose()
}

fn effect_key(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}
