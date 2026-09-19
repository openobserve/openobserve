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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::{
    RwHashMap,
    meta::synthetics_variables::{SyntheticsVariableView, VariableValueView},
};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set, SqlErr};

use super::entity::synthetics_variables::{ActiveModel, Column, Entity, Model};
use crate::errors::{self, DbError, Error};

/// The stored `kind` for a write-only variable.
pub const KIND_SECRET: &str = "secret";
/// The stored `kind` for a variable whose value has no access boundary of its own.
pub const KIND_PLAIN: &str = "plain";

/// `org_id` → every shared variable in the org, with the time it was loaded.
static VARIABLE_CACHE: LazyLock<RwHashMap<String, (Vec<SyntheticsVariableRecord>, Instant)>> =
    LazyLock::new(Default::default);

const VARIABLE_CACHE_TTL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticsVariableRecord {
    pub id: String,
    pub org_id: String,
    pub env: String,
    pub name: String,
    pub value: String,
    pub kind: String,
    pub description: String,
    pub example: String,
    pub tags: Vec<String>,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for SyntheticsVariableRecord {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            org_id: m.org_id,
            env: m.env,
            name: m.name,
            value: m.value,
            kind: m.kind,
            description: m.description,
            example: m.example,
            tags: serde_json::from_value(m.tags).unwrap_or_default(),
            owner: m.owner,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

impl SyntheticsVariableRecord {
    pub fn is_secret(&self) -> bool {
        self.kind == KIND_SECRET
    }

    fn to_active_model(&self) -> Result<ActiveModel, errors::Error> {
        Ok(ActiveModel {
            id: Set(self.id.clone()),
            org_id: Set(self.org_id.clone()),
            env: Set(self.env.clone()),
            name: Set(self.name.clone()),
            value: Set(self.value.clone()),
            kind: Set(self.kind.clone()),
            description: Set(self.description.clone()),
            example: Set(self.example.clone()),
            tags: Set(serde_json::to_value(&self.tags)?),
            owner: Set(self.owner.clone()),
            created_at: Set(self.created_at),
            updated_at: Set(self.updated_at),
        })
    }

    /// The read projection, given the plaintext for a plain variable.
    pub fn to_view(&self, plain_value: Option<String>) -> SyntheticsVariableView {
        SyntheticsVariableView {
            id: self.id.clone(),
            name: self.name.clone(),
            value: if self.is_secret() {
                VariableValueView::Secret {
                    has_value: !self.value.is_empty(),
                }
            } else {
                VariableValueView::Plain {
                    value: plain_value.unwrap_or_default(),
                    has_value: !self.value.is_empty(),
                }
            },
            description: self.description.clone(),
            example: self.example.clone(),
            tags: self.tags.clone(),
            used_by_checks: 0,
            used_by: Vec::new(),
            owner: self.owner.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

pub fn invalidate_cache(org_id: &str) {
    VARIABLE_CACHE.remove(org_id);
}

/// Every shared variable in an org, served from [`VARIABLE_CACHE`] when fresh.
pub async fn list_cached<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<SyntheticsVariableRecord>, errors::Error> {
    if let Some(entry) = VARIABLE_CACHE.get(org_id)
        && entry.1.elapsed() < VARIABLE_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }
    let rows = list(conn, org_id).await?;
    VARIABLE_CACHE.insert(org_id.to_string(), (rows.clone(), Instant::now()));
    Ok(rows)
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<SyntheticsVariableRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::Name)
        .all(conn)
        .await?
        .into_iter()
        .map(SyntheticsVariableRecord::from)
        .collect())
}

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<SyntheticsVariableRecord>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
        .map(SyntheticsVariableRecord::from))
}

pub async fn add<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<(), errors::Error> {
    insert_row(conn, record).await?;
    invalidate_and_publish(&record.org_id).await;
    Ok(())
}

/// Inserts a variable without touching the cache.
pub async fn insert_row<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<(), errors::Error> {
    match Entity::insert(record.to_active_model()?).exec(conn).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(duplicate_name(&record.name)),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

pub async fn update<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<bool, errors::Error> {
    let Some(model) = Entity::find()
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::Id.eq(&record.id))
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    let mut am: ActiveModel = model.into();
    am.name = Set(record.name.clone());
    am.value = Set(record.value.clone());
    am.kind = Set(record.kind.clone());
    am.description = Set(record.description.clone());
    am.example = Set(record.example.clone());
    am.tags = Set(serde_json::to_value(&record.tags)?);
    am.updated_at = Set(record.updated_at);
    match Entity::update(am).exec(conn).await {
        Ok(_) => {
            invalidate_and_publish(&record.org_id).await;
            Ok(true)
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(duplicate_name(&record.name)),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

pub async fn set_env<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    env: &str,
    updated_at: i64,
) -> Result<bool, errors::Error> {
    let Some(model) = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    let mut am: ActiveModel = model.into();
    am.env = Set(env.to_string());
    am.updated_at = Set(updated_at);
    match Entity::update(am).exec(conn).await {
        Ok(_) => {
            invalidate_and_publish(org_id).await;
            Ok(true)
        }
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => Err(Error::Message(
                "a variable with that name already exists in the destination scope".to_string(),
            )),
            _ => Err(Error::DbError(DbError::SeaORMError(e.to_string()))),
        },
    }
}

pub async fn delete<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let removed = delete_row(conn, org_id, id).await?;
    invalidate_and_publish(org_id).await;
    Ok(removed)
}

/// Writes a row as another region has it; `false` when a newer or winning row is kept instead.
pub async fn apply_upsert<C: ConnectionTrait>(
    conn: &C,
    record: &SyntheticsVariableRecord,
) -> Result<bool, errors::Error> {
    if get(conn, &record.org_id, &record.id)
        .await?
        .is_some_and(|stored| stored.updated_at > record.updated_at)
    {
        return Ok(false);
    }
    let rival = Entity::find()
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::Env.eq(&record.env))
        .filter(Column::Name.eq(&record.name))
        .filter(Column::Id.ne(&record.id))
        .one(conn)
        .await?
        .map(SyntheticsVariableRecord::from);
    if let Some(rival) = rival {
        if !incoming_wins(record, &rival) {
            // The loser is the same id in every region, so its local copy goes too unless newer.
            Entity::delete_many()
                .filter(Column::OrgId.eq(&record.org_id))
                .filter(Column::Id.eq(&record.id))
                .filter(Column::UpdatedAt.lte(record.updated_at))
                .exec(conn)
                .await?;
            return Ok(false);
        }
        delete_row(conn, &rival.org_id, &rival.id).await?;
    }
    let model = record.to_active_model()?;
    let updated = Entity::update_many()
        .set(model.clone())
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::Id.eq(&record.id))
        .filter(Column::UpdatedAt.lte(record.updated_at))
        .exec(conn)
        .await?;
    if updated.rows_affected > 0 {
        return Ok(true);
    }
    // A stored row that is newer makes this a no-op rather than an overwrite.
    let inserted = Entity::insert(model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(Column::Id)
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(inserted > 0)
}

pub async fn delete_row<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

pub async fn delete_by_env<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Env.eq(env))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Invalidates locally **and** tells every other node.
pub async fn invalidate_and_publish(org_id: &str) {
    invalidate_cache(org_id);
    if let Err(e) = crate::coordinator::synthetics::emit_variables_changed(org_id).await {
        log::error!("[synthetics] emit variable cache event failed for {org_id}: {e}");
    }
}

/// Two ids for one `(org, env, name)`: newer `updated_at` wins, then the lower id, in every region.
fn incoming_wins(incoming: &SyntheticsVariableRecord, stored: &SyntheticsVariableRecord) -> bool {
    (incoming.updated_at, std::cmp::Reverse(&incoming.id))
        > (stored.updated_at, std::cmp::Reverse(&stored.id))
}

/// Written to be shown: `DbError` would prefix it with its own type names.
fn duplicate_name(name: &str) -> Error {
    Error::Message(format!("variable '{name}' already exists in this scope"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(kind: &str, value: &str) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            id: "id1".into(),
            org_id: "acme".into(),
            env: "env1".into(),
            name: "TOKEN".into(),
            value: value.into(),
            kind: kind.into(),
            description: "the token".into(),
            example: "sk-...".into(),
            tags: vec!["auth".into()],
            owner: Some("someone@example.com".into()),
            created_at: 1,
            updated_at: 2,
        }
    }

    #[test]
    fn a_secret_view_carries_presence_not_the_value() {
        // Even handed a plaintext, the secret variant has nowhere to put it.
        let view = record(KIND_SECRET, "AESenc:abc").to_view(Some("hunter2".into()));
        assert_eq!(view.value, VariableValueView::Secret { has_value: true });
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("AESenc"), "{json}");
        assert!(!json.contains("hunter2"), "{json}");
        assert!(!json.contains("\"value\""), "{json}");
    }

    #[test]
    fn an_empty_stored_secret_reads_as_absent() {
        assert_eq!(
            record(KIND_SECRET, "").to_view(None).value,
            VariableValueView::Secret { has_value: false }
        );
    }

    #[test]
    fn a_plain_view_carries_the_decrypted_value() {
        assert_eq!(
            record(KIND_PLAIN, "AESenc:abc")
                .to_view(Some("https://shop.test".into()))
                .value,
            VariableValueView::Plain {
                value: "https://shop.test".into(),
                has_value: true
            }
        );
    }

    #[test]
    fn a_plain_row_that_will_not_decrypt_reads_as_empty() {
        // One corrupt row must not fail the whole list.
        assert_eq!(
            record(KIND_PLAIN, "AESenc:corrupt").to_view(None).value,
            VariableValueView::Plain {
                value: String::new(),
                has_value: true
            }
        );
    }

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectOptions, Database, Schema};
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        db.execute_unprepared("CREATE UNIQUE INDEX u ON synthetics_variables (org_id, env, name)")
            .await
            .unwrap();
        db
    }

    fn row(id: &str, value: &str, updated_at: i64) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            id: id.into(),
            value: value.into(),
            updated_at,
            ..record(KIND_PLAIN, "")
        }
    }

    async fn stored(db: &sea_orm::DatabaseConnection) -> Vec<SyntheticsVariableRecord> {
        list(db, "acme").await.unwrap()
    }

    #[tokio::test]
    async fn an_older_replicated_row_never_overwrites_a_newer_one() {
        let db = db().await;
        assert!(apply_upsert(&db, &row("id1", "new", 5)).await.unwrap());
        assert!(!apply_upsert(&db, &row("id1", "old", 3)).await.unwrap());
        assert_eq!(stored(&db).await[0].value, "new");
        assert!(apply_upsert(&db, &row("id1", "newer", 6)).await.unwrap());
        assert_eq!(stored(&db).await[0].value, "newer");
    }

    #[tokio::test]
    async fn the_same_name_under_two_ids_keeps_the_newer_row_in_every_region() {
        let db = db().await;
        apply_upsert(&db, &row("id-b", "b", 5)).await.unwrap();
        assert!(!apply_upsert(&db, &row("id-a", "a", 4)).await.unwrap());
        assert_eq!(stored(&db).await.len(), 1);
        assert_eq!(stored(&db).await[0].id, "id-b");

        assert!(apply_upsert(&db, &row("id-c", "c", 9)).await.unwrap());
        let rows = stored(&db).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "id-c");
    }

    #[tokio::test]
    async fn a_rename_that_loses_to_a_newer_create_removes_the_renamed_row() {
        let db = db().await;
        apply_upsert(
            &db,
            &SyntheticsVariableRecord {
                name: "URL".into(),
                ..row("id1", "old", 1)
            },
        )
        .await
        .unwrap();
        apply_upsert(&db, &row("id2", "created", 6)).await.unwrap();

        assert!(!apply_upsert(&db, &row("id1", "renamed", 5)).await.unwrap());
        let rows = stored(&db).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "id2");
    }

    #[tokio::test]
    async fn a_losing_message_never_removes_a_newer_local_copy_of_its_id() {
        let db = db().await;
        let newer = SyntheticsVariableRecord {
            name: "OTHER".into(),
            ..row("id1", "newer", 9)
        };
        apply_upsert(&db, &newer).await.unwrap();
        apply_upsert(&db, &row("id2", "created", 6)).await.unwrap();

        assert!(!apply_upsert(&db, &row("id1", "stale", 5)).await.unwrap());
        assert_eq!(stored(&db).await.len(), 2);
    }

    #[tokio::test]
    async fn a_stale_message_that_will_not_apply_never_removes_the_rival() {
        let db = db().await;
        let newer = SyntheticsVariableRecord {
            name: "OTHER".into(),
            ..row("id1", "newer", 9)
        };
        apply_upsert(&db, &newer).await.unwrap();
        apply_upsert(&db, &row("id2", "rival", 6)).await.unwrap();

        assert!(!apply_upsert(&db, &row("id1", "stale", 7)).await.unwrap());
        let ids: Vec<String> = stored(&db).await.into_iter().map(|r| r.id).collect();
        assert_eq!(ids, ["id1", "id2"]);
    }

    #[tokio::test]
    async fn a_tie_on_updated_at_goes_to_the_lower_id() {
        let db = db().await;
        apply_upsert(&db, &row("id-b", "b", 5)).await.unwrap();
        assert!(apply_upsert(&db, &row("id-a", "a", 5)).await.unwrap());
        assert!(!apply_upsert(&db, &row("id-b", "b", 5)).await.unwrap());
        let rows = stored(&db).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "id-a");
    }

    #[test]
    fn a_plain_view_reports_whether_a_value_is_stored() {
        let view = record(KIND_PLAIN, "AESenc:abc").to_view(Some("x".into()));
        assert_eq!(
            view.value,
            VariableValueView::Plain {
                value: "x".into(),
                has_value: true
            }
        );
    }
}
