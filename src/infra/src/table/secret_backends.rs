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
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
};

pub use super::entity::secret_backends::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn get_in<C: ConnectionTrait>(
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

pub async fn get_by_name_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(conn)
        .await?)
}

pub async fn list_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::Name)
        .all(conn)
        .await?)
}

pub async fn insert_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<Model, Error> {
    Ok(row.insert(conn).await?)
}

pub async fn update_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    mut row: ActiveModel,
) -> Result<Option<Model>, Error> {
    // A no-op update in SeaORM fetches by primary key and discards the org filter.
    row.org_id = Set(org_id.to_owned());
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

pub async fn delete_in<C: ConnectionTrait>(conn: &C, org_id: &str, id: &str) -> Result<u64, Error> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?
        .rows_affected)
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
    use super::*;
    use crate::table::testing::{meta_store, unique};

    #[tokio::test]
    async fn unchanged_backend_updates_respect_org_ownership() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let org = unique("backend_owner");
        let foreign = unique("backend_foreign");
        let backend = insert_in(
            conn,
            ActiveModel {
                id: Set(config::ider::ksuid()),
                org_id: Set(org.clone()),
                name: Set("primary".to_owned()),
                kind: Set("aws_sm".to_owned()),
                config: Set("{}".to_owned()),
                path_prefixes: Set("[]".to_owned()),
                auth_mode: Set("static".to_owned()),
                state: Set("active".to_owned()),
                backend_rev: Set(config::ider::ksuid()),
                ttl_secs: Set(60),
                stale_max_secs: Set(60),
                created_by: Set("owner".to_owned()),
                updated_by: Set("owner".to_owned()),
                created_at: Set(1),
                updated_at: Set(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(
            update_in(conn, &foreign, backend.clone().into())
                .await
                .unwrap()
                .is_none()
        );
        let mut update: ActiveModel = backend.clone().into();
        update.org_id = Set(foreign);
        update.description = Set("updated".to_owned());
        let updated = update_in(conn, &org, update).await.unwrap().unwrap();
        assert_eq!(updated.org_id, org);
        assert_eq!(updated.description, "updated");
        assert_eq!(delete_in(conn, &org, &backend.id).await.unwrap(), 1);
    }
}
