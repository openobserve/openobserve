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
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseTransaction, DbErr, EntityTrait,
    FromQueryResult, QueryFilter, QueryOrder, QuerySelect, Select, sea_query::Query,
};

use super::entity::{
    alert_incidents,
    incident_contexts::{Column, Entity, Model},
};

pub const MAX_ROW_BYTES: usize = 16 * 1024;
pub const MAX_INCIDENT_BYTES: usize = 1024 * 1024;
pub const MAX_INCIDENT_ROWS: usize = 100;

#[derive(FromQueryResult)]
pub struct Metadata {
    pub id: String,
    pub role: String,
    pub kind: String,
    pub title: String,
    pub created_by: String,
    pub start_at: i64,
    pub end_at: i64,
    pub target: String,
}

#[derive(FromQueryResult)]
pub struct CandidateContext {
    pub incident_id: String,
    pub target: String,
}

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    incident: &str,
    context: &str,
) -> Result<Option<Model>, DbErr> {
    live_contexts(org, incident)
        .filter(Column::Id.eq(context))
        .one(conn)
        .await
}

pub async fn get_id_by_key<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    incident: &str,
    key: &str,
) -> Result<Option<String>, DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.eq(incident))
        .filter(Column::ClientKey.eq(key))
        .select_only()
        .column(Column::Id)
        .into_tuple()
        .one(conn)
        .await
}

pub async fn list_metadata<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    incident: &str,
) -> Result<Vec<Metadata>, DbErr> {
    live_contexts(org, incident)
        .select_only()
        .columns([
            Column::Id,
            Column::Role,
            Column::Kind,
            Column::Title,
            Column::CreatedBy,
            Column::StartAt,
            Column::EndAt,
            Column::Target,
        ])
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .into_model()
        .all(conn)
        .await
}

pub async fn candidate_contexts<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    window_start: i64,
    now: i64,
) -> Result<Vec<CandidateContext>, DbErr> {
    let incidents = Query::select()
        .column(alert_incidents::Column::Id)
        .from(alert_incidents::Entity)
        .and_where(alert_incidents::Column::OrgId.eq(org))
        .and_where(alert_incidents::Column::SecurityCase.eq(false))
        .and_where(alert_incidents::Column::Status.is_in(["open", "acknowledged"]))
        .and_where(alert_incidents::Column::MergedIntoId.is_null())
        .to_owned();
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.in_subquery(incidents))
        .filter(Column::DeletedAt.is_null())
        .filter(Column::Role.is_in(["declared", "added"]))
        .filter(Column::EndAt.gte(window_start))
        .filter(Column::StartAt.lte(now))
        .select_only()
        .columns([Column::IncidentId, Column::Target])
        .order_by_desc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .into_model()
        .all(conn)
        .await
}

/// The caller holds the incident row lock until the size check and insert commit.
pub async fn insert_in(txn: &DatabaseTransaction, row: Model) -> Result<bool, DbErr> {
    let mut row = row;
    let mut bytes = serde_json::to_vec(&row)
        .map_err(|err| DbErr::Custom(err.to_string()))?
        .len();
    if bytes > MAX_ROW_BYTES {
        return Ok(false);
    }
    loop {
        row.bytes = bytes as i32;
        let size = serde_json::to_vec(&row)
            .map_err(|err| DbErr::Custom(err.to_string()))?
            .len();
        if size == bytes {
            break;
        }
        bytes = size;
    }
    if bytes > MAX_ROW_BYTES || !fits_in(txn, &row).await? {
        return Ok(false);
    }
    let row: super::entity::incident_contexts::ActiveModel = row.into();
    row.insert(txn).await?;
    Ok(true)
}

pub async fn delete_by_incident<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    incident: &str,
) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.eq(incident))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org<C: ConnectionTrait>(conn: &C, org: &str) -> Result<(), DbErr> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .exec(conn)
        .await?;
    Ok(())
}

fn live_contexts(org: &str, incident: &str) -> Select<Entity> {
    Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::IncidentId.eq(incident))
        .filter(Column::DeletedAt.is_null())
}

async fn fits_in(txn: &DatabaseTransaction, row: &Model) -> Result<bool, DbErr> {
    let sizes: Vec<i32> = Entity::find()
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::IncidentId.eq(&row.incident_id))
        .select_only()
        .column(Column::Bytes)
        .into_tuple()
        .all(txn)
        .await?;
    let bytes = sizes.iter().map(|&bytes| i64::from(bytes)).sum::<i64>() + i64::from(row.bytes);
    Ok(sizes.len() < MAX_INCIDENT_ROWS && bytes <= MAX_INCIDENT_BYTES as i64)
}
