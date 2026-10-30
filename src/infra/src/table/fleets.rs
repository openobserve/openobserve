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

//! Fleets' desired and stable configuration versions and setting overrides; no row means none.

use config::meta::folder::FolderType;
use sea_orm::{
    ActiveValue::NotSet,
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, FromQueryResult, JoinType, Order,
    QueryFilter, QuerySelect, Set,
    sea_query::{Alias, Expr, LockType, OnConflict, Query},
};

pub use super::entity::fleets::Model;
use super::{
    entity::{
        fleets::{ActiveModel, Column, Entity},
        folders,
    },
    folders::folder_type_into_i16,
};
use crate::{db::get_orm_client_rw, errors::Error};

/// A fleet with its desired and stable versions, if any were ever set.
#[derive(Clone, Debug, PartialEq, FromQueryResult)]
pub struct FleetState {
    pub fleet_id: String,
    pub name: String,
    pub config_id: Option<String>,
    pub config_version: Option<i64>,
    pub stable_config_id: Option<String>,
    pub stable_config_version: Option<i64>,
    pub settings: Option<String>,
}

/// Every fleet of the org, oldest first, as the shared folder list orders them.
pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<FleetState>, Error> {
    let (f, ff) = (Alias::new("f"), Alias::new("ff"));
    let query = Query::select()
        .expr(Expr::cust(
            "f.folder_id AS fleet_id, f.name, ff.config_id, ff.config_version, \
             ff.stable_config_id, ff.stable_config_version, ff.settings",
        ))
        .from_as(Alias::new("folders"), f.clone())
        .join_as(
            JoinType::LeftJoin,
            Alias::new("fleets"),
            ff,
            Expr::cust("ff.org_id = f.org AND ff.fleet_id = f.folder_id"),
        )
        .and_where(Expr::col((f.clone(), folders::Column::Org)).eq(org_id))
        .and_where(
            Expr::col((f.clone(), folders::Column::Type))
                .eq(folder_type_into_i16(FolderType::Fleets)),
        )
        .order_by((f, folders::Column::Id), Order::Asc)
        .to_owned();
    let backend = conn.get_database_backend();
    Ok(FleetState::find_by_statement(backend.build(&query))
        .all(conn)
        .await?)
}

/// Takes the fleet row's lock on PostgreSQL; `None` when the fleet does not exist.
pub async fn lock_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
) -> Result<Option<String>, Error> {
    let mut query = folders::Entity::find()
        .select_only()
        .column(folders::Column::Name)
        .filter(folders::Column::Org.eq(org_id))
        .filter(folders::Column::FolderId.eq(fleet_id))
        .filter(folders::Column::Type.eq(folder_type_into_i16(FolderType::Fleets)));
    if conn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock(LockType::Update);
    }
    Ok(query.into_tuple::<String>().one(conn).await?)
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet_id))
        .one(conn)
        .await?)
}

/// Sets desired, keeping stable; creates the row on the fleet's first change.
pub async fn set_desired_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
    (config_id, version): (&str, i64),
    actor: &str,
    now_us: i64,
) -> Result<(), Error> {
    let row = ActiveModel {
        org_id: Set(org_id.to_string()),
        fleet_id: Set(fleet_id.to_string()),
        config_id: Set(Some(config_id.to_string())),
        config_version: Set(Some(version)),
        stable_config_id: Set(None),
        stable_config_version: Set(None),
        updated_at: Set(now_us),
        updated_by: Set(actor.to_string()),
        settings: NotSet,
    };
    Entity::insert(row)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::FleetId])
                .update_columns([
                    Column::ConfigId,
                    Column::ConfigVersion,
                    Column::UpdatedAt,
                    Column::UpdatedBy,
                ])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

/// Replaces the fleet's setting overrides, keeping its versions; creates the row when absent.
pub async fn set_settings_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
    settings: Option<String>,
    actor: &str,
    now_us: i64,
) -> Result<(), Error> {
    let row = ActiveModel {
        org_id: Set(org_id.to_string()),
        fleet_id: Set(fleet_id.to_string()),
        config_id: Set(None),
        config_version: Set(None),
        stable_config_id: Set(None),
        stable_config_version: Set(None),
        updated_at: Set(now_us),
        updated_by: Set(actor.to_string()),
        settings: Set(settings),
    };
    Entity::insert(row)
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::FleetId])
                .update_columns([Column::Settings, Column::UpdatedAt, Column::UpdatedBy])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

pub async fn set_stable_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
    (config_id, version): (&str, i64),
) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::StableConfigId, Expr::value(config_id))
        .col_expr(Column::StableConfigVersion, Expr::value(version))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    fleet_id: &str,
) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::FleetId.eq(fleet_id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<(), Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::*;
    use crate::table::migration::create_fleet_collectors_for_test;

    #[tokio::test]
    async fn settings_and_desired_never_overwrite_each_other() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_fleet_collectors_for_test(&db).await.unwrap();
        let overrides = serde_json::json!({"heartbeat_interval_secs": 10});

        set_settings_with(&db, "o1", "f1", Some(overrides.to_string()), "u", 1)
            .await
            .unwrap();
        set_desired_with(&db, "o1", "f1", ("edge", 2), "u", 2)
            .await
            .unwrap();
        let row = get_with(&db, "o1", "f1").await.unwrap().unwrap();
        assert_eq!(row.settings, Some(overrides.to_string()));
        assert_eq!(
            (row.config_id.as_deref(), row.config_version),
            (Some("edge"), Some(2))
        );

        set_settings_with(&db, "o1", "f1", None, "u", 3)
            .await
            .unwrap();
        let row = get_with(&db, "o1", "f1").await.unwrap().unwrap();
        assert_eq!(row.settings, None);
        assert_eq!(row.config_version, Some(2), "desired kept");
        assert_eq!(get_with(&db, "o1", "f2").await.unwrap(), None);
    }
}
