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
    infra::{config::ORGANIZATION_SETTING, db as infra_db},
    meta::organization::OrganizationSetting,
    utils::json,
};
use bytes::Bytes;

pub async fn set_org_setting(
    org_name: &str,
    setting: &OrganizationSetting,
) -> Result<(), anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = format!("/organization/{}", org_name);
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

pub async fn get_org_setting(org_name: &str) -> Result<Bytes, anyhow::Error> {
    let db = &infra_db::DEFAULT;
    let key = format!("/organization/{}", org_name);

    match ORGANIZATION_SETTING.clone().read().await.get(&key) {
        Some(v) => Ok(json::to_vec(v).unwrap().into()),
        None => Ok(db.get(&key).await?),
    }
}

/// Cache the existing org settings in the beginning
pub async fn cache() -> Result<(), anyhow::Error> {
    let prefix = "/organization";
    let ret = infra_db::DEFAULT.list(prefix).await?;
    for (key, item_value) in ret {
        let json_val: OrganizationSetting = json::from_slice(&item_value).unwrap();
        ORGANIZATION_SETTING
            .clone()
            .write()
            .await
            .insert(key, json_val);
    }
    log::info!("Organization settings Cached {:?}", &ORGANIZATION_SETTING);
    Ok(())
}
