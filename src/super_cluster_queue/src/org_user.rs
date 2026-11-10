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

use bytes::Bytes;
use config::utils::json;
use db::org_users as db_org_users;
use infra::{
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    errors::{Error, Result},
    table::{
        ai_grants,
        org_users::{self, OrgUserPut},
    },
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::OrgUserAdd => {
            add(msg).await?;
        }
        MessageType::OrgUserDelete => {
            delete(msg).await?;
        }
        MessageType::OrgUserUpdate => {
            update(msg).await?;
        }
        MessageType::OrgUserUpdateToken => {
            update_token(msg).await?;
        }
        MessageType::OrgUserUpdateRumToken => {
            update_rum_token(msg).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

async fn add(msg: Message) -> Result<()> {
    let org_user: OrgUserPut = json::from_slice(&msg.value.unwrap())?;
    if db_org_users::get(&org_user.org_id, &org_user.email)
        .await
        .is_ok()
    {
        // Duplicate add, ignore
        log::warn!(
            "[SUPER_CLUSTER:sync] Duplicate add org user: {}/{}, ignore",
            org_user.org_id,
            org_user.email
        );
        return Ok(());
    }
    if let Err(e) = org_users::add(
        &org_user.org_id,
        &org_user.email,
        org_user.role,
        &org_user.token,
        org_user.rum_token,
    )
    .await
    {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to add org user: {}/{}, error: {}",
            org_user.org_id,
            org_user.email,
            e
        );
        return Err(e);
    }
    let _ = put_into_db_coordinator(&msg.key, Bytes::new(), msg.need_watch, None).await;
    Ok(())
}

async fn update(msg: Message) -> Result<()> {
    let org_user: OrgUserPut = json::from_slice(&msg.value.unwrap())?;
    if db_org_users::get(&org_user.org_id, &org_user.email)
        .await
        .is_err()
    {
        // User not found, ignore
        log::warn!(
            "[SUPER_CLUSTER:sync] User not found, ignore update org user: {}/{}, ignore",
            org_user.org_id,
            org_user.email
        );
        return Ok(());
    }
    if let Err(e) = org_users::update(
        &org_user.org_id,
        &org_user.email,
        org_user.role,
        &org_user.token,
        org_user.rum_token,
    )
    .await
    {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to update org user: {}/{}, error: {}",
            org_user.org_id,
            org_user.email,
            e
        );
        return Err(e);
    }
    let _ = put_into_db_coordinator(&msg.key, Bytes::new(), msg.need_watch, None).await;
    Ok(())
}

async fn update_token(msg: Message) -> Result<()> {
    let token = match msg.value {
        Some(ref value) => String::from_utf8_lossy(value).to_string(),
        None => "".to_string(),
    };
    let keys = msg.key.split('/').collect::<Vec<&str>>();
    if keys.len() < 5 {
        return Err(Error::Message("Invalid key".to_string()));
    }
    let org_id = keys[3];
    let user_email = keys[4];
    if db_org_users::get(org_id, user_email).await.is_err() {
        // User not found, ignore
        log::warn!(
            "[SUPER_CLUSTER:sync] User not found, ignore update token org user: {org_id}/{user_email}, ignore",
        );
        return Ok(());
    }
    if let Err(e) = org_users::update_token(org_id, user_email, &token).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to update token for org user: {org_id}/{user_email}, error: {e}"
        );
        return Err(e);
    }
    let _ = put_into_db_coordinator(&msg.key, Bytes::new(), msg.need_watch, None).await;
    Ok(())
}

async fn update_rum_token(msg: Message) -> Result<()> {
    let rum_token = match msg.value {
        Some(ref value) => String::from_utf8_lossy(value).to_string(),
        None => "".to_string(),
    };
    let keys = msg.key.split('/').collect::<Vec<&str>>();
    if keys.len() < 5 {
        return Err(Error::Message("Invalid key".to_string()));
    }
    let org_id = keys[3];
    let user_email = keys[4];
    if db_org_users::get(org_id, user_email).await.is_err() {
        // User not found, ignore
        log::warn!(
            "[SUPER_CLUSTER:sync] User not found, ignore update RUM token org user: {org_id}/{user_email}, ignore",
        );
        return Ok(());
    }
    if let Err(e) = org_users::update_rum_token(org_id, user_email, &rum_token).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to update RUM token for org user: {org_id}/{user_email}, error: {e}"
        );
        return Err(e);
    }
    let _ = put_into_db_coordinator(&msg.key, Bytes::new(), msg.need_watch, None).await;
    Ok(())
}

async fn delete(msg: Message) -> Result<()> {
    let keys = msg.key.split('/').collect::<Vec<&str>>();
    if keys.len() < 5 {
        return Err(Error::Message("Invalid key".to_string()));
    }
    let org_id = keys[3];
    let user_email = keys[4];
    if keys[2].eq("many") {
        if let Err(e) = org_users::remove_by_user(user_email).await {
            log::error!("[SUPER_CLUSTER:sync] Failed to delete org user: {user_email}, error: {e}");
            return Err(e);
        }
        forget_grants(None, user_email).await;
    } else {
        if let Err(e) = org_users::remove(org_id, user_email).await {
            log::error!(
                "[SUPER_CLUSTER:sync] Failed to delete org user: {org_id}/{user_email}, error: {e}"
            );
            return Err(e);
        }
        forget_grants(Some(org_id), user_email).await;
    }
    let _ = delete_from_db_coordinator(&msg.key, false, true, None).await;
    Ok(())
}

/// A member removed on another cluster keeps no standing assistant approval here either.
pub(crate) async fn forget_grants(org_id: Option<&str>, user_email: &str) {
    if let Err(e) = ai_grants::delete_for_member(org_id, user_email).await {
        log::error!(
            "[SUPER_CLUSTER:sync] cannot remove the assistant grants of {user_email} in {org_id:?}: {e}"
        );
    }
}

#[cfg(test)]
mod tests {
    use infra::table::ai_grants::NewGrant;
    use tokio::sync::OnceCell;

    use super::*;

    async fn meta_store() {
        static ONCE: OnceCell<()> = OnceCell::const_new();
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
            infra::db::create_table().await.unwrap();
            infra::db_init().await.unwrap();
            infra::table::migrate().await.unwrap();
        })
        .await;
    }

    fn grant<'a>(org_id: &'a str, user_email: &'a str) -> NewGrant<'a> {
        NewGrant {
            org_id,
            user_email,
            tool: "UpdateAlert",
            operation: "update",
            scope: ai_grants::SCOPE_ALWAYS,
            chat_id: None,
            granted_by: user_email,
        }
    }

    fn removal(key: String) -> Message {
        Message::new(key, None, None, false, MessageType::OrgUserDelete)
    }

    async fn holders(org_id: &str) -> Vec<String> {
        let grants = ai_grants::list(org_id, None).await.unwrap();
        grants.into_iter().map(|g| g.user_email).collect()
    }

    #[tokio::test]
    async fn a_replicated_membership_removal_drops_the_members_grants() {
        meta_store().await;
        let org = format!("sc{}", config::utils::time::now_micros());
        let other = format!("{org}b");
        for (org_id, email) in [
            (&org, "Gone@x.io"),
            (&org, "stays@x.io"),
            (&other, "gone@x.io"),
        ] {
            ai_grants::insert(&grant(org_id, email), 1).await.unwrap();
        }
        process(removal(format!("/org_users/single/{org}/gone@x.io")))
            .await
            .unwrap();
        assert_eq!(holders(&org).await, ["stays@x.io"]);
        assert_eq!(holders(&other).await, ["gone@x.io"]);

        process(removal("/org_users/many/user/gone@x.io".to_string()))
            .await
            .unwrap();
        assert!(holders(&other).await.is_empty());
    }
}
