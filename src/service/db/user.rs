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

use std::sync::Arc;

use config::utils::json;
use infra::{
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    table::{org_invites::InvitationRecord, users},
};

use super::org_users::{self, get_cached_user_org};
use crate::{
    common::{
        infra::config::{ROOT_USER, USERS, USERS_RUM_TOKEN},
        meta::user::{DBUser, User, UserOrg, UserRole},
    },
    service::db,
};

impl From<&DBUser> for users::UserRecord {
    fn from(user: &DBUser) -> Self {
        let is_root = user
            .organizations
            .iter()
            .any(|org| org.role.eq(&UserRole::Root));
        users::UserRecord::new(
            &user.email,
            &user.first_name,
            &user.last_name,
            &user.password,
            &user.salt,
            is_root,
            user.password_ext.clone(),
            if user.is_external {
                users::UserType::External
            } else {
                users::UserType::Internal
            },
        )
    }
}

impl From<&users::UserRecord> for DBUser {
    fn from(user: &users::UserRecord) -> Self {
        DBUser {
            email: user.email.clone(),
            password: user.password.clone(),
            salt: user.salt.clone(),
            first_name: user.first_name.clone(),
            last_name: user.last_name.clone(),
            is_external: match user.user_type {
                users::UserType::External => true,
                users::UserType::Internal => false,
            },
            organizations: vec![],
            password_ext: user.password_ext.clone(),
        }
    }
}

impl Into<UserRole> for infra::table::org_users::UserRole {
    #[cfg(not(feature = "enterprise"))]
    fn into(self) -> UserRole {
        match self {
            infra::table::org_users::UserRole::Root => UserRole::Root,
            _ => UserRole::Admin,
        }
    }

    #[cfg(feature = "enterprise")]
    fn into(self) -> UserRole {
        match self {
            infra::table::org_users::UserRole::Admin => UserRole::Admin,
            infra::table::org_users::UserRole::User => UserRole::User,
            infra::table::org_users::UserRole::Root => UserRole::Root,
            infra::table::org_users::UserRole::Viewer => UserRole::Viewer,
            infra::table::org_users::UserRole::Editor => UserRole::Editor,
            infra::table::org_users::UserRole::ServiceAccount => UserRole::ServiceAccount,
        }
    }
}

pub async fn get_user_record(email: &str) -> Result<users::UserRecord, anyhow::Error> {
    users::get(email)
        .await
        .map_err(|e| anyhow::anyhow!("Error getting user record: {e}"))
}

pub async fn get(org_id: Option<&str>, name: &str) -> Result<Option<User>, anyhow::Error> {
    let user = match org_id {
        None => ROOT_USER.get("root").map(|v| v.value().clone()),
        Some(org_id) => get_cached_user_org(org_id, name),
    };

    if let Some(user) = user {
        return Ok(Some(user.clone()));
    }
    if org_id.is_none() {
        return Err(anyhow::anyhow!("Missing org_id"));
    }

    let org_id = org_id.unwrap();
    let user = org_users::get_expanded_user_org(org_id, name).await?;

    Ok(Some(User {
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        password: user.password,
        role: user.role.into(),
        org: user.org_id,
        token: user.token,
        rum_token: user.rum_token,
        salt: user.salt,
        is_external: match user.user_type {
            users::UserType::External => true,
            users::UserType::Internal => false,
        },
        password_ext: user.password_ext,
    }))
}

/// Retrieve the user object given token and the requested org
pub async fn get_by_token(
    org_id: Option<&str>,
    token: &str,
) -> Result<Option<User>, anyhow::Error> {
    let user = match org_id {
        None => ROOT_USER.get("root").map(|v| v.value().clone()),
        Some(org_id) => USERS_RUM_TOKEN
            .clone()
            .get(&format!("{org_id}/{token}"))
            .and_then(|v| get_cached_user_org(org_id, &v.email)),
    };

    if let Some(user) = user {
        return Ok(Some(user.clone()));
    }
    if org_id.is_none() {
        return Err(anyhow::anyhow!("Missing org_id"));
    }

    let org_id = org_id.unwrap();
    let user = org_users::get_user_by_rum_token(org_id, token).await?;

    Ok(Some(User {
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        password: user.password,
        role: user.role.into(),
        org: user.org_id,
        token: user.token,
        rum_token: user.rum_token,
        salt: user.salt,
        is_external: match user.user_type {
            users::UserType::External => true,
            users::UserType::Internal => false,
        },
        password_ext: user.password_ext,
    }))
}

pub async fn get_db_user(name: &str) -> Result<DBUser, anyhow::Error> {
    let user = match users::get(name).await {
        Ok(user) => user,
        Err(e) => {
            log::error!("Error retrieving user from db: {e}");
            return Err(anyhow::anyhow!("User not found"));
        }
    };

    log::debug!("User: {:#?}", user);
    log::debug!("User name: {}", user.email);
    let orgs = org_users::list_orgs_by_user(name).await?;
    Ok(DBUser {
        email: user.email,
        password: user.password,
        salt: user.salt,
        first_name: user.first_name,
        last_name: user.last_name,
        is_external: match user.user_type {
            users::UserType::External => true,
            users::UserType::Internal => false,
        },
        organizations: orgs
            .into_iter()
            .map(|org| UserOrg {
                role: org.role.into(),
                name: org.org_id,
                token: org.token,
                rum_token: org.rum_token,
            })
            .collect(),
        password_ext: user.password_ext,
    })
}

pub async fn add(db_user: &DBUser) -> Result<(), anyhow::Error> {
    let key = format!("/user_record/{}", db_user.email);
    let user = users::UserRecord::from(db_user);
    users::add(user.clone())
        .await
        .map_err(|e| anyhow::anyhow!("Error adding user: {e}"))?;
    let _ = put_into_db_coordinator(&key, json::to_vec(&user).unwrap().into(), true, None).await;

    // Add user to orgs
    for org in &db_user.organizations {
        org_users::add(
            &org.name,
            &user.email,
            org.role.clone().into(),
            &org.token,
            org.rum_token.clone(),
        )
        .await?;
    }
    Ok(())
}

pub async fn update(
    user_email: &str,
    first_name: &str,
    last_name: &str,
    password: &str,
    password_ext: Option<String>,
) -> Result<(), anyhow::Error> {
    let key = format!("/user_record/{user_email}");
    let updated_user = users::update(user_email, first_name, last_name, password, password_ext)
        .await
        .map_err(|e| anyhow::anyhow!("Error updating user: {e}"))?;
    let _ = put_into_db_coordinator(
        &key,
        json::to_vec(&updated_user).unwrap().into(),
        true,
        None,
    )
    .await;
    Ok(())
}

pub async fn delete(name: &str) -> Result<(), anyhow::Error> {
    let key = format!("/user_record/{name}");
    // First delete all org_user entries for this user
    org_users::remove_by_user(name).await?;
    match users::remove(name).await {
        Ok(_) => {
            let _ = delete_from_db_coordinator(&key, false, true, None).await;
            Ok(())
        }
        Err(e) => {
            log::error!("Error deleting user: {}", e);
            Err(anyhow::anyhow!("Error deleting user: {}", e))
        }
    }
}

pub async fn list_user_invites(user_id: &str) -> Result<Vec<InvitationRecord>, anyhow::Error> {
    db::org_invites::list_by_user(user_id).await
}

pub async fn list_users(
    limit: Option<i64>,
) -> Result<Vec<infra::table::users::UserRecord>, anyhow::Error> {
    users::list(limit)
        .await
        .map_err(|e| anyhow::anyhow!("Error listing users: {e}"))
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/user_record/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching user");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_users: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: infra::table::users::UserRecord =
                    if config::get_config().common.meta_store_external {
                        match get_user_record(item_key).await {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error getting value: {}", e);
                                continue;
                            }
                        }
                    } else {
                        json::from_slice(&ev.value.unwrap()).unwrap()
                    };

                USERS.insert(item_key.to_string(), item_value);
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                USERS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let users = list_users(None).await?;
    for user in users {
        USERS.insert(user.email.clone(), user);
    }
    log::info!("Users Cached");
    Ok(())
}

pub async fn root_user_exists() -> bool {
    // Cache into the ROOT_USER
    match users::get_root_user().await {
        Ok(user) => {
            ROOT_USER.insert(
                "root".to_string(),
                User {
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    password: user.password,
                    role: UserRole::Root,
                    org: "".to_string(),
                    token: "".to_string(),
                    rum_token: None,
                    salt: user.salt,
                    is_external: false,
                    password_ext: user.password_ext,
                },
            );
            true
        }
        _ => false,
    }
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let _key = "/user_record/";
    users::clear()
        .await
        .map_err(|e| anyhow::anyhow!("Error clearing users: {e}"))?;
    // TODO: Clear all coordinator keys
    Ok(())
}

pub async fn get_user_by_email(email: &str) -> Option<DBUser> {
    let user = users::get(email).await;
    match user {
        Ok(user) => match org_users::list_orgs_by_user(email).await {
            Ok(orgs) => Some(DBUser {
                email: user.email,
                password: user.password,
                salt: user.salt,
                first_name: user.first_name,
                last_name: user.last_name,
                is_external: match user.user_type {
                    users::UserType::External => true,
                    users::UserType::Internal => false,
                },
                organizations: orgs
                    .into_iter()
                    .map(|org| UserOrg {
                        role: org.role.into(),
                        name: org.org_id,
                        token: org.token,
                        rum_token: org.rum_token,
                    })
                    .collect(),
                password_ext: user.password_ext,
            }),
            Err(e) => {
                log::error!("Error getting orgs the user is member of: {}", e);
                None
            }
        },
        Err(e) => {
            log::error!("Error getting user {email}: {}", e);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_user() {
        let org_id = "dummy".to_string();
        let email = "user3@example.com";
        let resp = set(&DBUser {
            email: email.to_string(),
            password: "pass".to_string(),
            salt: String::from("sdfjshdkfshdfkshdfkshdfkjh"),
            first_name: "admin".to_owned(),
            last_name: "".to_owned(),
            is_external: false,
            organizations: vec![UserOrg {
                role: crate::common::meta::user::UserRole::Admin,
                name: org_id.clone(),
                token: "Abcd".to_string(),
                rum_token: Some("rumAbcd".to_string()),
            }],
            password_ext: Some("pass".to_string()),
        })
        .await;
        assert!(resp.is_ok());
        let _ = cache().await;

        let resp = get(Some(&org_id), email).await;
        assert!(resp.unwrap().is_some());

        let resp = delete(email).await;
        assert!(resp.is_ok());
    }
}
