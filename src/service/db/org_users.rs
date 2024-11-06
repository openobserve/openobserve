// Copyright 2024 OpenObserve Inc.
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

use infra::table::org_users::{
    self, OrgUserExpandedRecord, OrgUserRecord, UserOrgExpandedRecord, UserRole,
};

// TODO: Check how we can use cache for org_users
pub async fn add(
    org_id: &str,
    user_email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,
) -> Result<(), anyhow::Error> {
    org_users::add(org_id, user_email, role, token, rum_token)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to add user to org: {}", e))
}

pub async fn update(
    org_id: &str,
    user_email: &str,
    role: UserRole,
    token: &str,
    rum_token: Option<String>,
) -> Result<(), anyhow::Error> {
    org_users::update(org_id, user_email, role, token, rum_token)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to update user role: {}", e))
}

pub async fn remove(org_id: &str, user_email: &str) -> Result<(), anyhow::Error> {
    org_users::remove(org_id, user_email)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to remove user from org: {}", e))
}

pub async fn remove_by_user(email: &str) -> Result<(), anyhow::Error> {
    org_users::remove_by_user(email)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to remove user from org: {}", e))
}

pub async fn get(org_id: &str, user_email: &str) -> Result<OrgUserRecord, anyhow::Error> {
    let org_user = org_users::get(org_id, user_email)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch user role: {}", e))?;
    Ok(org_user)
}

pub async fn get_expanded_user_org(
    org_id: &str,
    user_email: &str,
) -> Result<OrgUserExpandedRecord, anyhow::Error> {
    let org_user = org_users::get_expanded_user_org(org_id, user_email)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch user role: {}", e))?;
    Ok(org_user)
}

pub async fn get_user_by_rum_token(
    org_id: &str,
    rum_token: &str,
) -> Result<OrgUserExpandedRecord, anyhow::Error> {
    let org_user = org_users::get_user_by_rum_token(org_id, rum_token)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch user role: {}", e))?;
    Ok(org_user)
}

pub async fn list_orgs_by_user(
    user_email: &str,
) -> Result<Vec<UserOrgExpandedRecord>, anyhow::Error> {
    let orgs = org_users::list_orgs_by_user(user_email)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch orgs: {}", e))?;
    Ok(orgs)
}

pub async fn list_users_by_org(org_id: &str) -> Result<Vec<OrgUserRecord>, anyhow::Error> {
    let users = org_users::list_users_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch users: {}", e))?;
    Ok(users)
}

pub async fn update_rum_token(
    org_id: &str,
    user_email: &str,
    rum_token: &str,
) -> Result<(), anyhow::Error> {
    org_users::update_rum_token(org_id, user_email, rum_token)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to update rum token: {}", e))
}

pub async fn update_token(
    org_id: &str,
    user_email: &str,
    token: &str,
) -> Result<(), anyhow::Error> {
    org_users::update_token(org_id, user_email, token)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to update token: {}", e))
}
