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

//! `synthetics_env_retired`: the newest deleted life of each environment id, so a recreate
//! always gets a later `created_at` and therefore a new incarnation.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, sea_query};

pub use super::entity::synthetics_env_retired::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn get_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env_id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EnvId.eq(env_id))
        .one(conn)
        .await?)
}

/// Raises the watermark to `created_at`; never lowers it, so a late delete of an older life
/// cannot reopen its incarnation.
pub async fn retire_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env_id: &str,
    created_at: i64,
) -> Result<(), Error> {
    let row = ActiveModel {
        org_id: Set(org_id.to_string()),
        env_id: Set(env_id.to_string()),
        retired_created_at: Set(created_at),
    };
    Entity::insert(row)
        .on_conflict(
            sea_query::OnConflict::columns([Column::OrgId, Column::EnvId])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Entity::update_many()
        .col_expr(Column::RetiredCreatedAt, sea_query::Expr::value(created_at))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EnvId.eq(env_id))
        .filter(Column::RetiredCreatedAt.lt(created_at))
        .exec(conn)
        .await?;
    Ok(())
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
    async fn the_watermark_only_rises_and_org_cleanup_removes_only_that_org() {
        if !meta_store().await {
            return;
        }
        let conn = get_orm_client_rw().await;
        let (org_a, org_b) = (unique("ret_a"), unique("ret_b"));
        let env = format!("{org_a}/prod");
        assert!(get_in(conn, &org_a, &env).await.unwrap().is_none());
        retire_in(conn, &org_a, &env, 50).await.unwrap();
        retire_in(conn, &org_a, &env, 20).await.unwrap();
        assert_eq!(
            get_in(conn, &org_a, &env)
                .await
                .unwrap()
                .unwrap()
                .retired_created_at,
            50
        );
        retire_in(conn, &org_a, &env, 70).await.unwrap();
        assert_eq!(
            get_in(conn, &org_a, &env)
                .await
                .unwrap()
                .unwrap()
                .retired_created_at,
            70
        );
        retire_in(conn, &org_b, &env, 1).await.unwrap();
        assert_eq!(
            get_in(conn, &org_b, &env)
                .await
                .unwrap()
                .unwrap()
                .retired_created_at,
            1,
            "another org's row is separate"
        );

        assert_eq!(delete_by_org(&org_a).await.unwrap(), 1);
        assert!(get_in(conn, &org_a, &env).await.unwrap().is_none());
        assert!(get_in(conn, &org_b, &env).await.unwrap().is_some());
        delete_by_org(&org_b).await.unwrap();
    }
}
