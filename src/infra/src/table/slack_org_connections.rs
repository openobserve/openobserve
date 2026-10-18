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

use config::meta::slack::SlackOrgConnection;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, Select, Set,
    sea_query::OnConflict,
};

use super::{
    entity::slack_org_connections::{ActiveModel, Column, Entity, Model},
    slack_shared::db_err,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

pub async fn put(row: &SlackOrgConnection) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(installation_id: &str, org_id: &str) -> Result<Option<SlackOrgConnection>, Error> {
    get_with(get_orm_client_ro().await, installation_id, org_id).await
}

pub async fn list_by_installation(installation_id: &str) -> Result<Vec<SlackOrgConnection>, Error> {
    list_by_installation_with(get_orm_client_ro().await, installation_id).await
}

pub async fn list_by_org(org_id: &str) -> Result<Vec<SlackOrgConnection>, Error> {
    list_by_org_with(get_orm_client_ro().await, org_id).await
}

pub async fn delete(installation_id: &str, org_id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, installation_id, org_id).await
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn put_with<C: ConnectionTrait>(conn: &C, row: &SlackOrgConnection) -> Result<(), Error> {
    let key = [Column::InstallationId, Column::OrgId];
    Entity::insert(to_active(row))
        .on_conflict(
            OnConflict::columns(key)
                .update_columns(
                    Column::iter().filter(|c| !matches!(c, Column::InstallationId | Column::OrgId)),
                )
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    org_id: &str,
) -> Result<Option<SlackOrgConnection>, Error> {
    Ok(live()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await?
        .map(from_model))
}

pub async fn list_by_installation_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
) -> Result<Vec<SlackOrgConnection>, Error> {
    Ok(live()
        .filter(Column::InstallationId.eq(installation_id))
        .order_by_asc(Column::OrgId)
        .all(conn)
        .await?
        .into_iter()
        .map(from_model)
        .collect())
}

pub async fn list_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<SlackOrgConnection>, Error> {
    Ok(live()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::InstallationId)
        .all(conn)
        .await?
        .into_iter()
        .map(from_model)
        .collect())
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    installation_id: &str,
    org_id: &str,
) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::InstallationId.eq(installation_id))
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org_with<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

fn to_active(row: &SlackOrgConnection) -> ActiveModel {
    ActiveModel {
        installation_id: Set(row.installation_id.clone()),
        org_id: Set(row.org_id.clone()),
        connected_by: Set(row.connected_by.clone()),
        help_contact: Set(row.help_contact.clone()),
        created_at: Set(row.created_at),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
    }
}

fn from_model(model: Model) -> SlackOrgConnection {
    SlackOrgConnection {
        installation_id: model.installation_id,
        org_id: model.org_id,
        connected_by: model.connected_by,
        help_contact: model.help_contact,
        created_at: model.created_at,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::slack::create_tables_for_test;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn connection(installation_id: &str, org_id: &str) -> SlackOrgConnection {
        SlackOrgConnection {
            installation_id: installation_id.to_string(),
            org_id: org_id.to_string(),
            connected_by: "admin@acme.com".to_string(),
            help_contact: Some("#o2-help".to_string()),
            created_at: 100,
            updated_at: 200,
            origin_region: "default".to_string(),
            deleted_at: None,
        }
    }

    fn keys(rows: Vec<SlackOrgConnection>) -> Vec<(String, String)> {
        rows.into_iter()
            .map(|r| (r.installation_id, r.org_id))
            .collect()
    }

    #[tokio::test]
    async fn every_column_reads_back_and_put_replaces() {
        let db = db().await;
        let row = connection("i1", "acme");
        put_with(&db, &row).await.unwrap();
        assert_eq!(
            get_with(&db, "i1", "acme").await.unwrap(),
            Some(row.clone())
        );
        let replaced = SlackOrgConnection {
            help_contact: None,
            connected_by: "other@acme.com".to_string(),
            updated_at: 300,
            ..row
        };
        put_with(&db, &replaced).await.unwrap();
        assert_eq!(get_with(&db, "i1", "acme").await.unwrap(), Some(replaced));
        assert_eq!(list_by_installation_with(&db, "i1").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn lists_and_deletes_by_installation_and_org() {
        let db = db().await;
        for (installation, org) in [("i1", "acme"), ("i1", "globex"), ("i2", "acme")] {
            put_with(&db, &connection(installation, org)).await.unwrap();
        }
        put_with(
            &db,
            &SlackOrgConnection {
                deleted_at: Some(1),
                ..connection("i3", "acme")
            },
        )
        .await
        .unwrap();
        let pair = |a: &str, b: &str| (a.to_string(), b.to_string());
        assert_eq!(
            keys(list_by_installation_with(&db, "i1").await.unwrap()),
            [pair("i1", "acme"), pair("i1", "globex")]
        );
        assert_eq!(
            keys(list_by_org_with(&db, "acme").await.unwrap()),
            [pair("i1", "acme"), pair("i2", "acme")]
        );
        assert_eq!(get_with(&db, "i3", "acme").await.unwrap(), None);

        delete_with(&db, "i1", "globex").await.unwrap();
        assert_eq!(get_with(&db, "i1", "globex").await.unwrap(), None);
        assert_eq!(delete_by_org_with(&db, "acme").await.unwrap(), 3);
        assert!(list_by_org_with(&db, "acme").await.unwrap().is_empty());
    }
}
