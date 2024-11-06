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
use infra::table::{org_invites::InvitationRecord, users};

use super::org_users;
use crate::{
    common::{
        infra::config::{ROOT_USER, USERS, USERS_RUM_TOKEN},
        meta::user::{DBUser, User, UserOrg, UserRole},
        utils::auth::is_root_user,
    },
    service::db,
};

impl From<&DBUser> for users::UserRecord {
    fn from(user: &DBUser) -> Self {
        users::UserRecord::new(
            &user.email,
            &user.first_name,
            &user.last_name,
            &user.password,
            &user.salt,
            is_root_user(&user.email),
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
        None => ROOT_USER.get("root"),
        Some(org_id) => USERS.get(&format!("{org_id}/{name}")),
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
            .map(|v| v.value().clone()),
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

pub async fn add(user: &DBUser) -> Result<(), anyhow::Error> {
    users::add(users::UserRecord::from(user))
        .await
        .map_err(|e| anyhow::anyhow!("Error adding user: {e}"))?;

    // Add user to orgs
    for org in &user.organizations {
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
    users::update(user_email, first_name, last_name, password, password_ext)
        .await
        .map_err(|e| anyhow::anyhow!("Error updating user: {e}"))
}

// pub async fn set(user: &DBUser) -> Result<(), anyhow::Error> {
//     let key = format!("/user/{}", user.email);
//     db::put(
//         &key,
//         json::to_vec(&user).unwrap().into(),
//         db::NEED_WATCH,
//         None,
//     )
//     .await?;

//     // cache user
//     for org in &user.organizations {
//         let user = User {
//             email: user.email.clone(),
//             first_name: user.first_name.clone(),
//             last_name: user.last_name.clone(),
//             password: user.password.clone(),
//             role: org.role.clone(),
//             org: org.name.clone(),
//             token: org.token.clone(),
//             rum_token: org.rum_token.clone(),
//             salt: user.salt.clone(),
//             is_external: user.is_external,
//             password_ext: user.password_ext.clone(),
//         };
//         USERS.insert(
//             format!("{}/{}", org.name.clone(), user.email.clone()),
//             user.clone(),
//         );

//         if let Some(rum_token) = &org.rum_token {
//             USERS_RUM_TOKEN
//                 .clone()
//                 .insert(format!("{}/{}", org.name, rum_token), user);
//         }
//     }
//     Ok(())
// }

pub async fn delete(name: &str) -> Result<(), anyhow::Error> {
    // First delete all org_user entries for this user
    org_users::remove_by_user(name).await?;
    match users::remove(name).await {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!("Error deleting user: {}", e);
            Err(anyhow::anyhow!("Error deleting user: {}", e))
        }
    }
}

pub async fn list_user_invites(user_id: &str) -> Result<Vec<InvitationRecord>, anyhow::Error> {
    db::org_invites::list_by_user(user_id).await
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/user/";
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

                let item_value: DBUser = if config::get_config().common.meta_store_external {
                    match db::get(&ev.key).await {
                        Ok(val) => match json::from_slice(&val) {
                            Ok(val) => val,
                            Err(e) => {
                                log::error!("Error getting value: {}", e);
                                continue;
                            }
                        },
                        Err(e) => {
                            log::error!("Error getting value: {}", e);
                            continue;
                        }
                    }
                } else {
                    json::from_slice(&ev.value.unwrap()).unwrap()
                };

                let users = item_value.get_all_users();
                // Invalidate the entire RUM-TOKEN-CACHE
                for (_, user) in USERS.clone() {
                    if user.email.eq(item_key) {
                        USERS_RUM_TOKEN.clone().remove(&format!(
                            "{}/{}",
                            user.org,
                            user.rum_token.as_ref().unwrap()
                        ));
                    }
                }

                #[cfg(not(feature = "enterprise"))]
                for mut user in users {
                    if user.role.eq(&UserRole::Root) {
                        ROOT_USER.insert("root".to_string(), user.clone());
                    } else {
                        user.role = UserRole::Admin;
                    };
                    USERS.insert(format!("{}/{}", user.org, item_key), user.clone());
                    if let Some(rum_token) = &user.rum_token {
                        USERS_RUM_TOKEN
                            .clone()
                            .insert(format!("{}/{}", user.org, rum_token), user);
                    }
                }

                #[cfg(feature = "enterprise")]
                for user in users {
                    if user.role.eq(&UserRole::Root) {
                        ROOT_USER.insert("root".to_string(), user.clone());
                    }
                    USERS.insert(format!("{}/{}", user.org, item_key), user.clone());
                    if let Some(rum_token) = &user.rum_token {
                        USERS_RUM_TOKEN
                            .clone()
                            .insert(format!("{}/{}", user.org, rum_token), user);
                    }
                }
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                for (_, user) in USERS.clone() {
                    if user.email.eq(item_key) {
                        USERS.remove(&format!("{}/{}", user.org, user.email));
                        // Invalidate the entire RUM-TOKEN-CACHE
                        USERS_RUM_TOKEN.clone().remove(&format!(
                            "{}/{}",
                            user.org,
                            user.rum_token.as_ref().unwrap()
                        ));
                    }
                }
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/user/";
    let ret = db::list(key).await?;
    for (_, item_value) in ret {
        // let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: DBUser = json::from_slice(&item_value).unwrap();
        let users = json_val.get_all_users();
        #[cfg(not(feature = "enterprise"))]
        for mut user in users {
            if user.role.eq(&UserRole::Root) {
                ROOT_USER.insert("root".to_string(), user.clone());
            } else {
                user.role = UserRole::Admin;
            }
            USERS.insert(format!("{}/{}", user.org, user.email), user.clone());
            if let Some(rum_token) = &user.rum_token {
                USERS_RUM_TOKEN
                    .clone()
                    .insert(format!("{}/{}", user.org, rum_token), user);
            }
        }

        #[cfg(feature = "enterprise")]
        for user in users {
            if user.role.eq(&UserRole::Root) {
                ROOT_USER.insert("root".to_string(), user.clone());
            }
            USERS.insert(format!("{}/{}", user.org, user.email), user.clone());
            if let Some(rum_token) = &user.rum_token {
                USERS_RUM_TOKEN
                    .clone()
                    .insert(format!("{}/{}", user.org, rum_token), user);
            }
        }
    }
    log::info!("Users Cached");
    Ok(())
}

pub async fn root_user_exists() -> bool {
    let key = "/user/";
    let mut ret = db::list_values(key).await.unwrap_or_default();
    ret.retain(|item| {
        let user: DBUser = json::from_slice(item).unwrap();
        if user.organizations.is_empty() {
            return false;
        }
        user.organizations
            .first()
            .as_ref()
            .unwrap()
            .role
            .eq(&crate::common::meta::user::UserRole::Root)
    });
    !ret.is_empty()
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/user/";
    db::delete(key, true, db::NO_NEED_WATCH, None).await?;
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
            log::error!("Error getting user: {}", e);
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
