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

//! Fleet management org settings: one row per org; no row means the defaults.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, sea_query::OnConflict};

pub use super::entity::fleet_settings::Model;
use super::entity::fleet_settings::{ActiveModel, Column, Entity};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn get_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<Option<Model>, Error> {
    Ok(Entity::find_by_id(org_id.to_string()).one(conn).await?)
}

/// Replaces every setting of the org, creating its row when absent.
pub async fn upsert_with<C: ConnectionTrait>(conn: &C, row: Model) -> Result<(), Error> {
    Entity::insert(active_model(row))
        .on_conflict(
            OnConflict::column(Column::OrgId)
                .update_columns([
                    Column::RestrictedComponents,
                    Column::TargetVersion,
                    Column::FleetDefaults,
                ])
                .to_owned(),
        )
        .exec_without_returning(conn)
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

fn active_model(row: Model) -> ActiveModel {
    ActiveModel {
        org_id: Set(row.org_id),
        restricted_components: Set(row.restricted_components),
        target_version: Set(row.target_version),
        fleet_defaults: Set(row.fleet_defaults),
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_fleet_collectors_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_fleet_collectors_for_test(&db).await.unwrap();
        db
    }

    fn settings(org_id: &str, restricted: &[&str], target: Option<&str>) -> Model {
        Model {
            org_id: org_id.to_string(),
            restricted_components: serde_json::json!(restricted).to_string(),
            target_version: target.map(str::to_string),
            fleet_defaults: None,
        }
    }

    async fn contract(db: &DatabaseConnection) {
        assert_eq!(get_with(db, "o1").await.unwrap(), None);
        upsert_with(db, settings("o1", &[], None)).await.unwrap();

        upsert_with(db, settings("o2", &["debug"], Some("0.170.0")))
            .await
            .unwrap();
        let defaults = Model {
            fleet_defaults: Some(serde_json::json!({"heartbeat_interval_secs": 15}).to_string()),
            ..settings("o2", &["file"], None)
        };
        upsert_with(db, defaults.clone()).await.unwrap();
        assert_eq!(get_with(db, "o2").await.unwrap(), Some(defaults));
        assert_eq!(
            get_with(db, "o1").await.unwrap(),
            Some(settings("o1", &[], None)),
            "another org's upsert left this one alone"
        );

        delete_by_org_with(db, "o2").await.unwrap();
        assert_eq!(get_with(db, "o2").await.unwrap(), None);
        assert!(get_with(db, "o1").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn the_storage_contract_holds_on_sqlite() {
        contract(&db().await).await;
    }
}
