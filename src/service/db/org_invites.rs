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

use anyhow::{anyhow, Context};
use infra::{
    // db::{Event, NEED_WATCH},
    table::org_invites::{self, InvitationRecord},
};

// DBKey to set Org invites's
pub const ORG_INVITES_KEY: &str = "/org_invites/";

pub async fn list_by_user(user_id: &str) -> Result<Vec<InvitationRecord>, anyhow::Error> {
    let invites = org_invites::list_by_invitee(user_id)
        .await
        .map_err(|e| anyhow!("Failed to fetch invites: {}", e))?;
    // TODO: cache the result
    Ok(invites)
}

pub async fn add(
    inviter_id: &str,
    invitee_id: &str,
    entry: &InvitationRecord,
) -> Result<(), anyhow::Error> {
    if let Err(e) = org_invites::add(
        &entry.org_id,
        &entry.token,
        inviter_id,
        invitee_id,
        entry.expires_at,
        &entry.role,
    )
    .await
    {
        return Err(e).context("Failed to add invite token to DB");
    }

    // TODO: Cache the trigger watch event
    // db::put(
    //     &format!("{SHORT_URL_KEY}{short_id}"),
    //     Bytes::new(),
    //     NEED_WATCH,
    //     None,
    // )
    // .await?;

    Ok(())
}

pub async fn add_many(
    role: &str,
    inviter_id: &str,
    org_id: &str,
    token: &str,
    expires_at: i64,
    invitee_ids: Vec<String>,
) -> Result<(), anyhow::Error> {
    org_invites::add_many(role, inviter_id, org_id, token, expires_at, invitee_ids)
        .await
        .map_err(|e| anyhow!("Failed to add invites: {}", e))
}

pub async fn remove(token: &str, user: &str) -> Result<(), anyhow::Error> {
    org_invites::remove(token, user)
        .await
        .map_err(|e| anyhow!("Failed to remove invite: {}", e))
}

pub async fn get_by_token_user(
    token: &str,
    user_id: &str,
) -> Result<InvitationRecord, anyhow::Error> {
    let invite = org_invites::get_by_token_user(token, user_id)
        .await
        .map_err(|e| anyhow!("Failed to fetch invite: {}", e))?;
    Ok(invite)
}
