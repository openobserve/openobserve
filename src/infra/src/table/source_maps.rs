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
    ColumnTrait, Condition, EntityTrait, FromQueryResult, QueryFilter, QuerySelect, Set, SqlErr,
    TransactionTrait, prelude::Expr,
};
use serde::{Deserialize, Serialize};

use super::entity::source_maps::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

// Keeps each IN list under the sqlite and postgres bind-parameter limits.
const DELETE_ID_BATCH: usize = 1000;

#[derive(Clone, Serialize, Deserialize)]
pub enum FileType {
    SourceMap,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SourceMap {
    pub id: i32,
    pub org: String,
    pub service: Option<String>,
    pub env: Option<String>,
    pub version: Option<String>,
    pub source_file_name: String,
    pub source_map_file_name: String,
    pub file_store_id: String,
    pub file_type: FileType,
    pub created_at: i64,
    pub cluster: String,
}

impl From<Model> for SourceMap {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            org: value.org,
            service: value.service,
            env: value.env,
            version: value.version,
            source_file_name: value.source_file_name,
            source_map_file_name: value.source_map_file_name,
            file_store_id: value.file_store_id,
            file_type: value.file_type.into(),
            cluster: value.cluster,
            created_at: value.created_at,
        }
    }
}

impl From<FileType> for i32 {
    fn from(val: FileType) -> Self {
        match val {
            FileType::SourceMap => 0,
        }
    }
}

impl From<i32> for FileType {
    fn from(value: i32) -> Self {
        match value {
            0 => Self::SourceMap,
            _ => Self::SourceMap,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_type_to_i32() {
        assert_eq!(i32::from(FileType::SourceMap), 0);
    }

    #[test]
    fn test_i32_to_file_type_zero() {
        assert!(matches!(FileType::from(0), FileType::SourceMap));
    }

    #[test]
    fn test_i32_to_file_type_unknown_defaults_to_source_map() {
        assert!(matches!(FileType::from(99), FileType::SourceMap));
        assert!(matches!(FileType::from(-1), FileType::SourceMap));
    }

    #[test]
    fn test_from_model_to_source_map() {
        use super::super::entity::source_maps::Model;
        let model = Model {
            id: 42,
            org: "myorg".to_string(),
            service: Some("api".to_string()),
            env: Some("prod".to_string()),
            version: Some("1.0.0".to_string()),
            source_file_name: "app.js".to_string(),
            source_map_file_name: "app.js.map".to_string(),
            file_store_id: "store-1".to_string(),
            file_type: 0,
            created_at: 1_000_000,
            cluster: "us-east".to_string(),
        };
        let sm = SourceMap::from(model);
        assert_eq!(sm.id, 42);
        assert_eq!(sm.org, "myorg");
        assert_eq!(sm.service.as_deref(), Some("api"));
        assert_eq!(sm.env.as_deref(), Some("prod"));
        assert_eq!(sm.version.as_deref(), Some("1.0.0"));
        assert_eq!(sm.source_file_name, "app.js");
        assert_eq!(sm.source_map_file_name, "app.js.map");
        assert_eq!(sm.file_store_id, "store-1");
        assert_eq!(sm.created_at, 1_000_000);
        assert_eq!(sm.cluster, "us-east");
        assert!(matches!(sm.file_type, FileType::SourceMap));
    }
}

#[derive(FromQueryResult)]
struct Value {
    value: Option<String>,
}

pub fn get_file_path(org_id: &str, name: &str) -> String {
    format!("files/{org_id}/sourcemaps/{name}")
}

pub async fn add_many(entries: Vec<SourceMap>) -> Result<(), errors::Error> {
    let models = entries
        .into_iter()
        .map(|entry| ActiveModel {
            org: Set(entry.org),
            service: Set(entry.service),
            env: Set(entry.env),
            version: Set(entry.version),
            source_file_name: Set(entry.source_file_name),
            source_map_file_name: Set(entry.source_map_file_name),
            file_store_id: Set(entry.file_store_id),
            file_type: Set(entry.file_type.into()),
            cluster: Set(entry.cluster),
            created_at: Set(entry.created_at),
            ..Default::default()
        })
        .collect::<Vec<_>>();

    let client = get_orm_client_rw().await;

    let txn = client.begin().await?;

    for model in models {
        match Entity::insert(model).exec(&txn).await {
            Ok(_) => {}
            Err(e) => {
                txn.rollback().await?;
                match e.sql_err() {
                    Some(SqlErr::UniqueConstraintViolation(_)) => {
                        return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
                    }
                    _ => {
                        return Err(e.into());
                    }
                }
            }
        }
    }
    txn.commit().await?;

    Ok(())
}

/// Deletes the exact group and returns the removed rows so callers can release their files.
pub async fn delete_group(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Vec<SourceMap>, errors::Error> {
    let client = get_orm_client_rw().await;

    let cond = Condition::all()
        .add(Column::Org.eq(org))
        .add(service.map_or(Column::Service.is_null(), |s| Column::Service.eq(s)))
        .add(env.map_or(Column::Env.is_null(), |e| Column::Env.eq(e)))
        .add(version.map_or(Column::Version.is_null(), |v| Column::Version.eq(v)));

    let txn = client.begin().await?;
    let rows = Entity::find().filter(cond).all(&txn).await?;
    // Delete by id: rows committed concurrently stay instead of being removed unreturned.
    for chunk in rows.chunks(DELETE_ID_BATCH) {
        Entity::delete_many()
            .filter(Column::Id.is_in(chunk.iter().map(|m| m.id)))
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;

    Ok(rows.into_iter().map(|model| model.into()).collect())
}

pub async fn get_sourcemap_file(
    org: &str,
    source_file: &str,
    service: &Option<String>,
    env: &Option<String>,
    version: &Option<String>,
) -> Result<Option<SourceMap>, errors::Error> {
    let client = get_orm_client_ro().await;

    let mut stmt = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::SourceFileName.eq(source_file));

    if let Some(s) = service.as_ref() {
        stmt = stmt.filter(Column::Service.eq(s));
    }

    if let Some(e) = env.as_ref() {
        stmt = stmt.filter(Column::Env.eq(e));
    }

    if let Some(v) = version.as_ref() {
        stmt = stmt.filter(Column::Version.eq(v));
    }

    let res = stmt.one(client).await?.map(|model| model.into());
    Ok(res)
}

pub async fn list_files(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Vec<SourceMap>, errors::Error> {
    let client = get_orm_client_ro().await;

    let mut stmt = Entity::find().filter(Column::Org.eq(org));

    if let Some(s) = service {
        stmt = stmt.filter(Column::Service.eq(s));
    }

    if let Some(e) = env {
        stmt = stmt.filter(Column::Env.eq(e));
    }

    if let Some(v) = version {
        stmt = stmt.filter(Column::Version.eq(v));
    }

    let res = stmt
        .all(client)
        .await?
        .into_iter()
        .map(|model| model.into())
        .collect();
    Ok(res)
}

pub async fn update_cluster(entry: SourceMap) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;

    Entity::update_many()
        .filter(Column::Org.eq(entry.org))
        .filter(Column::FileStoreId.eq(entry.file_store_id))
        .filter(Column::SourceMapFileName.eq(entry.source_map_file_name))
        .col_expr(Column::Cluster, Expr::value(entry.cluster))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get_values(
    org_id: &str,
    limit: u64,
) -> Result<(Vec<String>, Vec<String>, Vec<String>), errors::Error> {
    let client = get_orm_client_ro().await;

    let services = Entity::find()
        .filter(Column::Org.eq(org_id))
        .select_only()
        .distinct()
        .column_as(Column::Service, "value")
        .limit(limit)
        .into_model::<Value>()
        .all(client)
        .await?;

    let envs = Entity::find()
        .filter(Column::Org.eq(org_id))
        .select_only()
        .distinct()
        .column_as(Column::Env, "value")
        .limit(limit)
        .into_model::<Value>()
        .all(client)
        .await?;

    let versions = Entity::find()
        .filter(Column::Org.eq(org_id))
        .select_only()
        .distinct()
        .column_as(Column::Version, "value")
        .limit(limit)
        .into_model::<Value>()
        .all(client)
        .await?;

    let services: Vec<_> = services
        .into_iter()
        .map(|v| v.value.unwrap_or_default())
        .collect();
    let envs: Vec<_> = envs
        .into_iter()
        .map(|v| v.value.unwrap_or_default())
        .collect();
    let versions: Vec<_> = versions
        .into_iter()
        .map(|v| v.value.unwrap_or_default())
        .collect();

    Ok((services, envs, versions))
}
