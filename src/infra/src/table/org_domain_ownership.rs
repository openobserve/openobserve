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

use std::collections::HashMap;

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

use super::entity::{org_domain_ownership::*, prelude::OrgDomainOwnership};
use crate::db::get_orm_client_rw;

pub enum OwnershipState {
    Pending = 0,
    Verfied = 1,
    Failed = 2,
}
pub struct OwnershipRecord {
    pub org_id: String,
    pub domain: String,
    pub state: OwnershipState,
}

pub async fn list_active_domain_org_map() -> Result<HashMap<String, String>, anyhow::Error> {
    let client = get_orm_client_rw().await;
    let records = OrgDomainOwnership::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Domain)
        .filter(Column::VerificationState.eq(OwnershipState::Verfied as u8))
        .into_tuple::<(String, String)>()
        .all(client)
        .await?;
    Ok(records.into_iter().collect())
}

pub async fn get_org_for_domain(domain: &str) -> Result<Option<String>, anyhow::Error> {
    let client = get_orm_client_rw().await;
    let record = OrgDomainOwnership::find()
        .select_only()
        .column(Column::OrgId)
        .filter(Column::Domain.eq(domain))
        .into_tuple::<(String,)>()
        .one(client)
        .await?;
    Ok(record.map(|v| v.0))
}

pub async fn get_domains_for_org(org_id: &str) -> Result<Vec<String>, anyhow::Error> {
    let client = get_orm_client_rw().await;
    let records = OrgDomainOwnership::find()
        .select_only()
        .column(Column::Domain)
        .filter(Column::OrgId.eq(org_id))
        .into_tuple::<(String,)>()
        .all(client)
        .await?;
    Ok(records.into_iter().map(|v| v.0).collect())
}
