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
use tracing::info_span;

use crate::common::json;
use crate::infra::config::{ROOT_USER, USERS};
use crate::infra::db::Event;
use crate::meta::user::User;

pub async fn get(org_id: Option<&str>, name: &str) -> Result<Option<User>, anyhow::Error> {
    let db_span = info_span!("db:user:get");
    let _guard = db_span.enter();
    let db = &crate::infra::db::DEFAULT;
    let key = match org_id {
        Some(org) => format!("/user/{}/{}", org, name),
        None => format!("/user/{}", name),
    };
    let ret = db.get(&key).await?;
    let loc_value = json::from_slice(&ret).unwrap();
    let value = Some(loc_value);
    Ok(value)
}

pub async fn set(org_id: &str, user: User) -> Result<(), anyhow::Error> {
    let db_span = info_span!("db:user:set");
    let _guard = db_span.enter();
    let db = &crate::infra::db::DEFAULT;

    let key = match user.role {
        crate::meta::user::UserRole::Admin => format!("/user/{}/{}", org_id, user.email),
        crate::meta::user::UserRole::User => format!("/user/{}/{}", org_id, user.email),
        crate::meta::user::UserRole::Root => format!("/user/{}", user.email),
    };
    db.put(&key, json::to_vec(&user).unwrap().into()).await?;
    Ok(())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), anyhow::Error> {
    let db_span = info_span!("db:user:delete");
    let _guard = db_span.enter();
    let db = &crate::infra::db::DEFAULT;
    let key = format!("/user/{}/{}", org_id, name);
    match db.delete(&key, false).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let db = &crate::infra::db::DEFAULT;
    let key = "/user/";
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[TRACE] Start watching user");
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
                let item_value: User = json::from_slice(&ev.value.unwrap()).unwrap();
                USERS.insert(item_key.to_owned(), item_value);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                USERS.remove(item_key);
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
        let json_val: User = json::from_slice(&item_value).unwrap();
        if !item_key.contains('/') {
            ROOT_USER.insert("root".to_string(), json_val.clone());
        }
        USERS.insert(item_key.to_string(), json_val);
    }
    log::info!("[TRACE] Users Cached");
    Ok(())
}

pub async fn root_user_exists() -> bool {
    let db_span = info_span!("db:user:root_user_exists");
    let _guard = db_span.enter();
    let db = &crate::infra::db::DEFAULT;
    let key = "/user/";
    let mut ret = db.list_values(key).await.unwrap();
    ret.retain(|item| {
        let user: User = json::from_slice(item).unwrap();
        user.role.eq(&crate::meta::user::UserRole::Root)
    });
    !ret.is_empty()
}
