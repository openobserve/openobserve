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
use infra::table::{
    entity::org_domain_requests::Model,
    org_domain_requests::{self, Status},
};

pub async fn save_org_domain_request(
    org_id: &str,
    domain: &str,
    req_by: &str,
) -> Result<(), anyhow::Error> {
    let now = now_micros();
    let req = Model {
        id: config::ider::generate(),
        org_id: org_id.to_string(),
        domain: domain.trim().to_lowercase(),
        created_at: now,
        updated_at: now,
        requested_by: req_by.to_string(),
        answered_by: None,
        status: Status::Pending as i32,
        reason: None,
    };
    org_domain_requests::save_org_domain_request(req).await?;
    Ok(())
}

pub async fn list_all_req() -> Result<Vec<Model>, anyhow::Error> {
    Ok(org_domain_requests::list_all().await?)
}

pub async fn list_by_org(org_id: &str) -> Result<Vec<Model>, anyhow::Error> {
    Ok(org_domain_requests::list_by_org(org_id).await?)
}
pub async fn get_req_by_id(id: &str) -> Result<Option<Model>, anyhow::Error> {
    Ok(org_domain_requests::get_by_id(id).await?)
}

pub async fn get_req_by_org_domain(
    org_id: &str,
    domain: &str,
) -> Result<Option<Model>, anyhow::Error> {
    Ok(org_domain_requests::get_by_org_domain(org_id, domain).await?)
}

pub async fn update_status(
    id: &str,
    user: &str,
    new_status: Status,
    reason: String,
) -> Result<(), anyhow::Error> {
    Ok(org_domain_requests::update_status(id, user, new_status, reason).await?)
}
