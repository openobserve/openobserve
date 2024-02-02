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

use config::utils::json;
use infra::db as infra_db;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::meta::mapping::OFGAModel;

pub mod alerts;
pub mod compact;
pub mod dashboards;
pub mod enrichment_table;
pub mod file_list;
pub mod functions;
pub mod kv;
pub mod metrics;
pub mod organization;
pub mod saved_view;
pub mod schema;
pub mod syslog;
pub mod user;
pub mod version;

pub async fn get_instance() -> Result<Option<String>, anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/instance/";
    let ret = db.get(key).await?;
    let loc_value = json::from_slice(&ret).unwrap();
    let value = Some(loc_value);
    Ok(value)
}

pub async fn set_instance(id: &str) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/instance/";
    match db
        .put(
            key,
            json::to_vec(&id).unwrap().into(),
            infra_db::NO_NEED_WATCH,
        )
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

#[cfg(feature = "enterprise")]
pub async fn set_ofga_model(existing_meta: Option<OFGAModel>) -> Result<String, anyhow::Error> {
    use o2_enterprise::enterprise::openfga::model::{
        create_open_fga_store, read_ofga_model, write_auth_models,
    };

    let meta = read_ofga_model().await;
    if let Some(existing_model) = existing_meta {
        if meta.version == existing_model.version {
            log::info!("OFGA model already exists & no changes required");
            Ok(existing_model.store_id)
        } else {
            let store_id = if existing_model.store_id.is_empty() {
                create_open_fga_store().await.unwrap()
            } else {
                existing_model.store_id
            };
            match write_auth_models(&meta, &store_id).await {
                Ok(_) => {
                    let db = infra_db::get_db().await;
                    let key = "/ofga/model";

                    let mut loc_meta = meta.clone();
                    loc_meta.store_id = store_id;
                    loc_meta.model = None;

                    match db
                        .put(
                            key,
                            json::to_vec(&loc_meta).unwrap().into(),
                            infra_db::NO_NEED_WATCH,
                        )
                        .await
                    {
                        Ok(_) => Ok(loc_meta.store_id),
                        Err(e) => Err(anyhow::anyhow!(e)),
                    }
                }
                Err(e) => Err(anyhow::anyhow!(e)),
            }
        }
    } else {
        let store_id = create_open_fga_store().await.unwrap();
        match write_auth_models(&meta, &store_id).await {
            Ok(_) => {
                let db = infra_db::get_db().await;
                let key = "/ofga/model";

                let mut loc_meta = meta.clone();
                loc_meta.store_id = store_id;
                loc_meta.model = None;

                match db
                    .put(
                        key,
                        json::to_vec(&loc_meta).unwrap().into(),
                        infra_db::NO_NEED_WATCH,
                    )
                    .await
                {
                    Ok(_) => Ok(loc_meta.store_id),
                    Err(e) => Err(anyhow::anyhow!(e)),
                }
            }
            Err(e) => Err(anyhow::anyhow!(e)),
        }
    }
}
#[cfg(feature = "enterprise")]
pub async fn get_ofga_model() -> Result<Option<OFGAModel>, anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/ofga/model";
    let ret = db.get(key).await?;
    let loc_value = json::from_slice(&ret).unwrap();
    let value = Some(loc_value);
    Ok(value)
}
