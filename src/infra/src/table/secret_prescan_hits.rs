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

//! `secret_prescan_hits`: `{{secrets.*}}` tokens the upgrade pre-scan found; token text only.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, sea_query};

pub use super::entity::secret_prescan_hits::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

/// Records the hit; a repeat scan of the same field keeps the first `found_at`.
pub async fn add_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<(), Error> {
    Entity::insert(row)
        .on_conflict(
            sea_query::OnConflict::columns([
                Column::OrgId,
                Column::ConsumerType,
                Column::ConsumerId,
                Column::Field,
                Column::Token,
            ])
            .do_nothing()
            .to_owned(),
        )
        .do_nothing()
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn list_for_org_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::ConsumerType)
        .order_by_asc(Column::ConsumerId)
        .order_by_asc(Column::Field)
        .all(conn)
        .await?)
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
