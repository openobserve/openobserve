// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use std::sync::Arc;

use crate::common::json;
use crate::infra::config::{ROOT_USER, USERS};
use crate::infra::db::Event;
use crate::meta::user::{DBUser, User, UserRole};

#[tracing::instrument]
pub async fn get(org_id: Option<&str>, name: &str) -> Result<Option<User>, anyhow::Error> {
    let user = match org_id {
        None => ROOT_USER.get("root"),
        Some(org_id) => USERS.get(&format!("{org_id}/{name}")),
    };

    if let Some(user) = user {
        return Ok(Some(user.clone()));
    }

    let org_id = org_id.expect("BUG");

    let db = &crate::infra::db::DEFAULT;
    let key = format!("/user/{name}");
    let val = db.get(&key).await?;
    let db_user: DBUser = json::from_slice(&val).unwrap();
    Ok(db_user.get_user(org_id.to_string()))
}

#[tracing::instrument]
pub async fn get_db_user(name: &str) -> Result<DBUser, anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/user/{name}");
    let val = db.get(&key).await?;
    Ok(json::from_slice::<DBUser>(&val).unwrap())
}

#[tracing::instrument(skip_all)]
pub async fn set(user: DBUser) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/user/{}", user.email);
    db.put(&key, json::to_vec(&user).unwrap().into()).await?;
    // cache user
    for org in user.organizations {
        USERS.insert(
            format!("{}/{}", org.name, user.email),
            User {
                email: user.email.clone(),
                first_name: user.first_name.clone(),
                last_name: user.last_name.clone(),
                password: user.password.clone(),
                role: org.role,
                org: org.name,
                token: org.token,
                salt: user.salt.clone(),
            },
        );
    }
    Ok(())
}

#[tracing::instrument]
pub async fn delete(name: &str) -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/user/{name}");
    Ok(db.delete(&key, false).await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/user/";
    let mut events = db.watch(key).await?;
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
            Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let item_value: DBUser = json::from_slice(&ev.value.unwrap()).unwrap();
                let users = item_value.get_all_users();
                for user in users {
                    if user.role.eq(&UserRole::Root) {
                        ROOT_USER.insert("root".to_string(), user.clone());
                    }
                    USERS.insert(format!("{}/{}", user.org, item_key), user);
                }
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                for user in USERS.clone() {
                    if user.1.email.eq(item_key) {
                        USERS.remove(&format!("{}/{}", user.1.org, user.1.email));
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/user/";
    let ret = db.list(key).await?;
    for (item_key, item_value) in ret {
        let item_key = item_key.strip_prefix(key).unwrap();
        let json_val: DBUser = json::from_slice(&item_value).unwrap();
        let users = json_val.get_all_users();
        for user in users {
            if user.role.eq(&UserRole::Root) {
                ROOT_USER.insert("root".to_string(), user.clone());
            }
            USERS.insert(format!("{}/{}", user.org, item_key), user);
        }
    }
    log::info!("Users Cached");
    Ok(())
}

pub async fn root_user_exists() -> bool {
    let db = &crate::infra::db::DEFAULT;
    let key = "/user/";
    let mut ret = db.list_values(key).await.unwrap();
    ret.retain(|item| {
        let user: DBUser = json::from_slice(item).unwrap();
        user.organizations
            .first()
            .as_ref()
            .unwrap()
            .role
            .eq(&crate::meta::user::UserRole::Root)
    });
    !ret.is_empty()
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/user/";
    db.delete(key, true).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::user::UserOrg;

    #[actix_web::test]
    async fn test_user() {
        let org_id = "dummy".to_string();
        let email = "user@example.com";
        let resp = set(DBUser {
            email: email.to_string(),
            password: "pass".to_string(),
            salt: String::from("sdfjshdkfshdfkshdfkshdfkjh"),
            first_name: "admin".to_owned(),
            last_name: "".to_owned(),
            organizations: vec![UserOrg {
                role: crate::meta::user::UserRole::Admin,
                name: org_id.clone(),
                token: "Abcd".to_string(),
            }],
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
