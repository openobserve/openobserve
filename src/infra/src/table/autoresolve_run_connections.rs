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

//! `autoresolve_run_connections`: the connections a run chose, one row each, so the run list can
//! filter by one; `autoresolve_runs.connection_ids` stays what a run reads.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

use super::entity::autoresolve_run_connections::{ActiveModel, Column, Entity};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn insert_many_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    run_id: &str,
    connection_ids: &[String],
) -> Result<(), Error> {
    if connection_ids.is_empty() {
        return Ok(());
    }
    let rows = connection_ids.iter().map(|id| ActiveModel {
        org: Set(org.to_string()),
        run_id: Set(run_id.to_string()),
        connection_id: Set(id.clone()),
    });
    Entity::insert_many(rows).exec(conn).await?;
    Ok(())
}

pub async fn delete_by_org(org: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected)
}
