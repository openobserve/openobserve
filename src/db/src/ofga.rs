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

use std::sync::Arc;

use config::utils::json;
#[cfg(feature = "cloud")]
use o2_enterprise::enterprise::cloud::is_ofga_migrations_done;
use o2_openfga::{
    config::OFGA_STORE_ID,
    meta::mapping::OFGAModel,
    model::{create_open_fga_store, read_ofga_model, write_auth_models},
};

use crate as db;
pub const OFGA_KEY_PREFIX: &str = "/ofga/model";

/// Outcome of writing the shipped model to OpenFGA.
pub struct ModelSetup {
    pub record: OFGAModel,
    pub matched: bool,
    pub new_store: bool,
}

/// Whether to save the model version once the back-fill tuple write is done. [pure]
pub fn save_version_after_write(new_store: bool, tuples_written: bool) -> bool {
    !new_store && tuples_written
}

/// Writes the shipped model to OpenFGA. [weak: the model may land unrecorded; a retry rewrites it]
pub async fn set_ofga_model(existing_meta: Option<OFGAModel>) -> Result<ModelSetup, anyhow::Error> {
    let meta = read_ofga_model().await;
    let reusable_store_id = match existing_meta {
        Some(existing_model) if existing_model.version == meta.version => {
            log::info!("OFGA model already exists & no changes required");
            return Ok(ModelSetup {
                record: existing_model,
                matched: true,
                new_store: false,
            });
        }
        Some(existing_model) => {
            #[cfg(not(feature = "cloud"))]
            let force_create_new_store = false;
            #[cfg(feature = "cloud")]
            let force_create_new_store = !is_ofga_migrations_done().await.unwrap();
            (!existing_model.store_id.is_empty() && !force_create_new_store)
                .then_some(existing_model.store_id)
        }
        None => None,
    };
    let new_store = reusable_store_id.is_none();
    let store_id = match reusable_store_id {
        Some(store_id) => store_id,
        None => create_open_fga_store().await.unwrap(),
    };
    write_auth_models(&meta, &store_id)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    let mut record = meta;
    record.store_id = store_id;
    record.model = None;
    // Reused store: save the version only after the back-fill, so a failed write is retried.
    if new_store {
        set_ofga_model_to_db(record.clone()).await?;
    }
    Ok(ModelSetup {
        record,
        matched: false,
        new_store,
    })
}

pub async fn set_ofga_model_to_db(mut meta: OFGAModel) -> Result<String, anyhow::Error> {
    let key = OFGA_KEY_PREFIX;
    meta.model = None;
    match db::put(
        key,
        json::to_vec(&meta).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await
    {
        Ok(_) => Ok(meta.store_id),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

pub async fn get_ofga_model() -> Result<Option<OFGAModel>, anyhow::Error> {
    let key = OFGA_KEY_PREFIX;
    let ret = db::get(key).await?;
    let mut loc_value: OFGAModel = json::from_slice(&ret).unwrap();
    loc_value.version = loc_value.version.trim_matches('"').to_string();
    Ok(Some(loc_value))
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = OFGA_KEY_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching {OFGA_KEY_PREFIX}");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_ofga_model: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let item_value: OFGAModel = match db::get(&ev.key).await {
                    Ok(val) => match json::from_slice(&val) {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!("Error getting value: {e}");
                            continue;
                        }
                    },
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                };
                log::info!("[WATCH] Got store id {}", item_value.store_id);
                OFGA_STORE_ID.insert("store_id".to_owned(), item_value.store_id);
            }
            db::Event::Delete(_) => {
                OFGA_STORE_ID.remove("store_id");
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = OFGA_KEY_PREFIX;
    let ret = db::list(key).await?;
    for (_, item_value) in ret {
        let json_val: OFGAModel = json::from_slice(&item_value).unwrap();
        log::info!("Caching store id {}", json_val.store_id);
        OFGA_STORE_ID.insert("store_id".to_owned(), json_val.store_id);
    }
    log::info!("/ofga/model Cached ");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ofga_key_prefix_value() {
        assert_eq!(OFGA_KEY_PREFIX, "/ofga/model");
    }

    #[test]
    fn test_ofga_key_prefix_starts_with_slash() {
        assert!(OFGA_KEY_PREFIX.starts_with('/'));
    }

    #[test]
    fn test_save_version_after_write() {
        let cases = [
            (true, true, false),
            (true, false, false),
            (false, true, true),
            (false, false, false),
        ];
        for (new_store, tuples_written, expected) in cases {
            assert_eq!(
                save_version_after_write(new_store, tuples_written),
                expected,
                "new_store={new_store} tuples_written={tuples_written}"
            );
        }
    }
}
