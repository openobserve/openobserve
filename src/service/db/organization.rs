// Copyright 2023 Zinc Labs Inc.
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

use crate::common::{
    infra::{
        config::ORGANIZATION_SETTING,
        db as infra_db,
        errors::{self, Error},
    },
    meta::organization::OrganizationSetting,
    utils::json,
};
use bytes::Bytes;
use std::sync::Arc;

// DBKey to set settings for an org
pub const ORG_SETTINGS_KEY_PREFIX: &str = "/organization/setting";

pub async fn set_org_setting(org_name: &str, setting: &OrganizationSetting) -> errors::Result<()> {
    let db = &infra_db::DEFAULT;
    let key = format!("{}/{}", ORG_SETTINGS_KEY_PREFIX, org_name);
    db.put(
        &key,
        json::to_vec(&setting).unwrap().into(),
        infra_db::NEED_WATCH,
    )
    .await?;

    // cache the org setting
    ORGANIZATION_SETTING
        .clone()
        .write()
        .await
        .insert(format!("{}", key), setting.clone());
    Ok(())
}

pub async fn get_org_setting(org_id: &str) -> Result<Bytes, Error> {
    let db = &infra_db::DEFAULT;
    let key = format!("{}/{}", ORG_SETTINGS_KEY_PREFIX, org_id);
    match ORGANIZATION_SETTING.clone().read().await.get(&key) {
        Some(v) => Ok(json::to_vec(v).unwrap().into()),
        None => Ok(db.get(&key).await?),
    }
}

/// Cache the existing org settings in the beginning
pub async fn cache() -> Result<(), anyhow::Error> {
    let prefix = ORG_SETTINGS_KEY_PREFIX;
    let ret = infra_db::DEFAULT.list(prefix).await?;
    for (key, item_value) in ret {
        let json_val: OrganizationSetting = json::from_slice(&item_value).unwrap();
        ORGANIZATION_SETTING
            .clone()
            .write()
            .await
            .insert(key, json_val);
    }
    log::info!("Organization settings Cached");
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = ORG_SETTINGS_KEY_PREFIX;
    let db = &infra_db::CLUSTER_COORDINATOR;
    let mut events = db.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching organization settings");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_settings: event channel closed");
                return Ok(());
            }
        };

        if let infra_db::Event::Put(ev) = ev {
            let item_key = ev.key;
            let item_value = ev.value.unwrap();
            let json_val: OrganizationSetting = json::from_slice(&item_value).unwrap();
            ORGANIZATION_SETTING
                .clone()
                .write()
                .await
                .insert(item_key, json_val);
        }
    }
}
