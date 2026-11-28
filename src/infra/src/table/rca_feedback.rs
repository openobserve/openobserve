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

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter, QueryOrder,
    sea_query::{Expr, OnConflict},
};

use super::entity::rca_feedback::{ActiveModel, Column, Entity, Model};

pub async fn upsert_in(txn: &DatabaseTransaction, row: Model) -> Result<(), DbErr> {
    let now = row.updated_at;
    let previous = Expr::col((Entity, Column::UpdatedAt));
    let updated_at = Expr::case(previous.clone().gte(now), previous.add(1)).finally(now);
    Entity::insert(ActiveModel::from(row))
        .on_conflict(
            OnConflict::columns([
                Column::RunId,
                Column::TargetKind,
                Column::TargetId,
                Column::AuthorEmail,
            ])
            .update_columns([
                Column::Verdict,
                Column::Band,
                Column::Outcome,
                Column::CauseClass,
                Column::ActualCause,
                Column::Note,
            ])
            .value(Column::UpdatedAt, updated_at)
            .to_owned(),
        )
        .exec_without_returning(txn)
        .await?;
    Ok(())
}

pub async fn list_for_run(
    conn: &impl ConnectionTrait,
    org: &str,
    incident: &str,
    run: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.eq(incident))
        .filter(Column::RunId.eq(run))
        .filter(Column::DeletedAt.is_null())
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .all(conn)
        .await
}

pub async fn delete_by_org(conn: &impl ConnectionTrait, org: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .exec(conn)
        .await?;
    Ok(())
}
