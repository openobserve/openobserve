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

use config::utils::{rand::generate_random_string, time::now_micros};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QuerySelect,
};

use super::entity::{org_domain_ownership::*, prelude::OrgDomainOwnership};
use crate::db::{get_orm_client_ro, get_orm_client_rw};

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
    let client = get_orm_client_ro().await;
    let records = OrgDomainOwnership::find()
        .select_only()
        .column(Column::OrgId)
        .column(Column::Domain)
        .filter(Column::VerificationState.eq(OwnershipState::Verfied as i32))
        .into_tuple::<(String, String)>()
        .all(client)
        .await?;
    Ok(records.into_iter().collect())
}

pub async fn get_verified_org_for_domain(domain: &str) -> Result<Option<String>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let record = OrgDomainOwnership::find()
        .select_only()
        .column(Column::OrgId)
        .filter(Column::Domain.eq(domain))
        .filter(Column::VerificationState.eq(OwnershipState::Verfied as i32))
        .into_tuple::<(String,)>()
        .one(client)
        .await?;
    Ok(record.map(|v| v.0))
}

pub async fn get_domains_for_org(org_id: &str) -> Result<Vec<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let records = OrgDomainOwnership::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await?;
    Ok(records)
}

pub async fn save_org_domain_mapping(record: OwnershipRecord) -> Result<(), anyhow::Error> {
    let client = get_orm_client_rw().await;
    let now = now_micros();
    let token = format!("o2v_{}_{}", record.org_id, generate_random_string(32));

    let m = ActiveModel {
        id: Set(config::ider::generate()),
        org_id: Set(record.org_id),
        domain: Set(record.domain),
        verification_token: Set(token),
        verification_state: Set(0),
        verification_failure_reason: Set(None),
        verified_at: Set(None),
        released_at: Set(None),
        last_checked_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };
    OrgDomainOwnership::insert(m).exec(client).await?;
    Ok(())
}

pub async fn delete_linked_domain(org_id: &str, domain: &str) -> Result<(), anyhow::Error> {
    let client = get_orm_client_rw().await;
    OrgDomainOwnership::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Domain.eq(domain))
        .exec(client)
        .await?;
    Ok(())
}

pub async fn get_domain_org_record(
    org_id: &str,
    domain: &str,
) -> Result<Option<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let res = OrgDomainOwnership::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Domain.eq(domain))
        .one(client)
        .await?;
    Ok(res)
}

pub async fn save_domain_org_record(model: Model) -> Result<(), anyhow::Error> {
    let client = get_orm_client_rw().await;
    let am = model.clone().into_active_model().reset_all();
    am.update(client).await?;
    Ok(())
}

pub async fn list_all() -> Result<Vec<Model>, anyhow::Error> {
    let client = get_orm_client_ro().await;
    let res = OrgDomainOwnership::find().all(client).await?;
    Ok(res)
}
