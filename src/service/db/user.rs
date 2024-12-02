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

use bytes::Bytes;
use config::meta::user::{DBUser, User, UserOrg, UserRole};
#[cfg(feature = "enterprise")]
use infra::table::org_invites::InvitationRecord;
use infra::{
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    table::users,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::org_invites;

use super::org_users::{self, get_cached_user_org};
use crate::{
    common::infra::config::{ROOT_USER, USERS, USERS_RUM_TOKEN},
    service::db,
};

pub async fn get_user_record(email: &str) -> Result<users::UserRecord, anyhow::Error> {
    let email = email.to_lowercase();
    users::get(&email)
        .await
        .map_err(|e| anyhow::anyhow!("Error getting user record: {e}"))
}

pub async fn get(org_id: Option<&str>, name: &str) -> Result<Option<User>, anyhow::Error> {
    let name = name.to_lowercase();
    let user = match org_id {
        None => ROOT_USER.get("root").map(|v| v.value().clone()),
        Some(org_id) => get_cached_user_org(org_id, &name),
    };

    if let Some(user) = user {
        return Ok(Some(user.clone()));
    }
    if org_id.is_none() {
        return Err(anyhow::anyhow!("Missing org_id"));
    }

    let org_id = org_id.unwrap();
    let user = org_users::get_expanded_user_org(org_id, &name).await?;

    Ok(Some(User {
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        password: user.password,
        role: user.role,
        org: user.org_id,
        token: user.token,
        rum_token: user.rum_token,
        salt: user.salt,
        is_external: user.user_type.is_external(),
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
        role: user.role,
        org: user.org_id,
        token: user.token,
        rum_token: user.rum_token,
        salt: user.salt,
        is_external: user.user_type.is_external(),
        password_ext: user.password_ext,
    }))
}

pub async fn get_db_user(name: &str) -> Result<DBUser, anyhow::Error> {
    let name = name.to_lowercase();
    let user = match users::get(&name).await {
        Ok(user) => user,
        Err(e) => {
            log::error!("Error retrieving user from db: {e}");
            return Err(anyhow::anyhow!("User not found"));
        }
    };

    log::debug!("User: {:#?}", user);
    log::debug!("User name: {}", user.email);
    let orgs = org_users::list_orgs_by_user(&name).await?;
    Ok(DBUser {
        email: user.email,
        password: user.password,
        salt: user.salt,
        first_name: user.first_name,
        last_name: user.last_name,
        is_external: user.user_type.is_external(),
        organizations: orgs
            .into_iter()
            .map(|org| UserOrg {
                role: org.role,
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
    let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;

    // Add user to orgs
    for org in &db_user.organizations {
        org_users::add(
            &org.name,
            &user.email,
            org.role.clone(),
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
    let user_email = user_email.to_lowercase();
    let key = format!("/user_record/{user_email}");
    users::update(&user_email, first_name, last_name, password, password_ext)
        .await
        .map_err(|e| anyhow::anyhow!("Error updating user: {e}"))?;
    let _ = put_into_db_coordinator(&key, Bytes::new(), true, None).await;
    Ok(())
}

pub async fn delete(name: &str) -> Result<(), anyhow::Error> {
    let name = name.to_lowercase();
    let key = format!("/user_record/{name}");
    // First delete all org_user entries for this user
    org_users::remove_by_user(&name).await?;
    match users::remove(&name).await {
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

#[cfg(feature = "enterprise")]
pub async fn list_user_invites(user_id: &str) -> Result<Vec<InvitationRecord>, anyhow::Error> {
    let user_id = user_id.to_lowercase();
    org_invites::list_by_user(&user_id).await
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
                    match get_user_record(item_key).await {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!("Error getting value: {}", e);
                            continue;
                        }
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
                is_external: user.user_type.is_external(),
                organizations: orgs
                    .into_iter()
                    .map(|org| UserOrg {
                        role: org.role,
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
                role: UserRole::Admin,
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
