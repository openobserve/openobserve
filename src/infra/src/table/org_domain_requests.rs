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

use config::utils::time::now_micros;
use sea_orm::{ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, sea_query::Expr};

use super::entity::{org_domain_requests::*, prelude::OrgDomainRequests};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

#[derive(Debug)]
pub enum Status {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
}
impl From<i32> for Status {
    fn from(value: i32) -> Self {
        match value {
            0 => Self::Pending,
            1 => Self::Approved,
            2 => Self::Rejected,
            _ => Self::Pending,
        }
    }
}

pub async fn save_org_domain_request(req: Model) -> Result<(), anyhow::Error> {
    let client = get_orm_client_rw().await;
    let m = req.into_active_model();
    OrgDomainRequests::insert(m).exec(client).await?;
    Ok(())
}

pub async fn list_all() -> Result<Vec<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let res = OrgDomainRequests::find().all(client).await?;
    Ok(res)
}

pub async fn list_by_org(org_id: &str) -> Result<Vec<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let res = OrgDomainRequests::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await?;
    Ok(res)
}

pub async fn update_status(
    id: &str,
    user: &str,
    new_status: Status,
    reason: String,
) -> Result<(), anyhow::Error> {
    let now = now_micros();
    let client = get_orm_client_rw().await;
    OrgDomainRequests::update_many()
        .filter(Column::Id.eq(id))
        .col_expr(Column::Status, Expr::value(new_status as i32))
        .col_expr(Column::AnsweredBy, Expr::value(user))
        .col_expr(Column::Reason, Expr::value(reason))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .exec(client)
        .await?;
    Ok(())
}

pub async fn get_by_id(id: &str) -> Result<Option<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let res = OrgDomainRequests::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?;
    Ok(res)
}

pub async fn get_by_org_domain(org_id: &str, domain: &str) -> Result<Option<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let res = OrgDomainRequests::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Domain.eq(domain))
        .filter(Column::Status.ne(Status::Approved as i32))
        .one(client)
        .await?;
    Ok(res)
}
