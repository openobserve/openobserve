// Copyright 2024 Zinc Labs Inc.
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

use config::{meta::stream::StreamType, utils::json};

use crate::{
    common::{
        infra::config::DERIVED_STREAMS, meta::scheduled_ops::derived_streams::DerivedStreamMeta,
    },
    service::db::{self, scheduler},
};

pub async fn get(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<Option<DerivedStreamMeta>, anyhow::Error> {
    let key = format!("/derived_streams/{org_id}/{stream_type}/{stream_name}/{name}");
    if let Some(derived_stream) = DERIVED_STREAMS.get(&key) {
        return Ok(Some(derived_stream.clone()));
    }
    match db::get(&key).await {
        Ok(val) => Ok(json::from_slice(&val)?),
        Err(_) => Ok(None),
    }
}

pub async fn set(derived_stream: &DerivedStreamMeta, create: bool) -> Result<(), anyhow::Error> {
    match db::put(
        &derived_stream.get_store_key(),
        json::to_vec(derived_stream).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await
    {
        Ok(_) => {
            let trigger = scheduler::Trigger {
                org: derived_stream.source.org_id.to_string(),
                module: scheduler::TriggerModule::DerivedStream,
                module_key: derived_stream.get_schedule_key(),
                next_run_at: chrono::Utc::now().timestamp_micros(),
                is_realtime: derived_stream.is_real_time,
                is_silenced: false,
                ..Default::default()
            };
            if create {
                match db::scheduler::push(trigger).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        log::error!("Failed to save trigger: {}", e);
                        Ok(())
                    }
                }
            } else {
                match db::scheduler::update_trigger(trigger).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        log::error!("Failed to update trigger: {}", e);
                        Ok(())
                    }
                }
            }
        }
        Err(e) => Err(anyhow::anyhow!("Error save derived stream: {}", e)),
    }
}

pub async fn delete(derived_stream: DerivedStreamMeta) -> Result<(), anyhow::Error> {
    match db::delete(&derived_stream.get_store_key(), false, db::NEED_WATCH, None).await {
        Ok(_) => {
            match db::scheduler::delete(
                &derived_stream.source.org_id,
                scheduler::TriggerModule::DerivedStream,
                &derived_stream.get_schedule_key(),
            )
            .await
            {
                Ok(_) => Ok(()),
                Err(e) => {
                    log::error!("Failed to delete trigger: {}", e);
                    Ok(())
                }
            }
        }
        Err(e) => Err(anyhow::anyhow!("Error deleting derived stream: {e}")),
    }
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/derived_streams/";
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching derived streams");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_derived_streams: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let cache_key = ev.key.clone();
                let item_value: DerivedStreamMeta =
                    if config::get_config().common.meta_store_external {
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
                DERIVED_STREAMS.insert(cache_key, item_value);
            }
            db::Event::Delete(ev) => {
                DERIVED_STREAMS.remove(&ev.key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let key = "/derived_streams/";
    let ret = db::list(key).await?;
    for (_, item_value) in ret {
        let derived_stream: DerivedStreamMeta = json::from_slice(&item_value).unwrap();
        let key = derived_stream.get_store_key();
        DERIVED_STREAMS.insert(key, derived_stream);
    }
    log::info!("Derived stream Cached");
    Ok(())
}

pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/derived_streams/";
    Ok(db::delete(key, true, db::NO_NEED_WATCH, None).await?)
}
