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

use db::org_storage_providers::OSP_PREFIX;
use infra::{db::Event, table::org_storage_providers::OrgStorageProvider};
use parquet::data_type::AsBytes;

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = ::infra::db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(OSP_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching org_storage_providers");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_storage_providers: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                let Some(item_v) = ev.value else {
                    log::error!("watch_org_storage_providers : missing value for put");
                    continue;
                };
                let Ok(entry) = serde_json::from_slice::<OrgStorageProvider>(item_v.as_bytes())
                else {
                    log::error!("watch_org_storage_providers : invalid json value for put");
                    continue;
                };
                let org_id = entry.org_id.clone();
                let provider = match super::get_provider(&org_id, entry.provider_type, &entry.data)
                    .await
                {
                    Ok(provider) => provider,
                    Err(err) => {
                        log::error!(
                            "[org_storage] error getting provider for org {org_id} which was synced via events, skipping update : {err}"
                        );
                        continue;
                    }
                };
                log::info!("[org_storage]: received provider info via nats org {org_id}");
                infra::storage::add_account(&org_id, provider).await;
                ::db::org_storage_providers::update_cached_entry(entry).await;
            }
            Event::Delete(ev) => {
                log::error!(
                    "watch_org_storage_providers: delete is not supported, yet received for key {}",
                    ev.key
                );
            }
            Event::Empty => {}
        }
    }
}
