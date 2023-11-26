// Copyright 2023 Zinc Labs Inc.
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
    let db = infra_db::get_db().await;
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
        .insert(key.to_string(), setting.clone());
    Ok(())
}

pub async fn get_org_setting(org_id: &str) -> Result<Bytes, Error> {
    let db = infra_db::get_db().await;
    let key = format!("{}/{}", ORG_SETTINGS_KEY_PREFIX, org_id);
    match ORGANIZATION_SETTING.clone().read().await.get(&key) {
        Some(v) => Ok(json::to_vec(v).unwrap().into()),
        None => Ok(db.get(&key).await?),
    }
}

/// Cache the existing org settings in the beginning
pub async fn cache() -> Result<(), anyhow::Error> {
    let prefix = ORG_SETTINGS_KEY_PREFIX;
    let db = infra_db::get_db().await;
    let ret = db.list(prefix).await?;
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
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
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
