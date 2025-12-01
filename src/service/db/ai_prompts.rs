// Copyright 2025 OpenObserve Inc.
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

#[cfg(feature = "enterprise")]
use std::sync::Arc;

#[cfg(feature = "enterprise")]
use infra::coordinator::ai_prompts::AI_PROMPTS_WATCH_PREFIX;

#[cfg(feature = "enterprise")]
use crate::service::db;

#[cfg(feature = "enterprise")]
pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(AI_PROMPTS_WATCH_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching AI prompts");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_ai_prompts: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(_) => {
                // Call the enterprise update_prompt_in_memory function to update the cache
                if let Err(e) =
                    o2_enterprise::enterprise::ai::agent::prompt::service::update_prompt_in_memory()
                        .await
                {
                    log::error!("Failed to update AI prompt in memory cache: {e}");
                }
                log::debug!("Updated AI prompt in memory cache");
            }
            db::Event::Empty | db::Event::Delete(_) => {}
        }
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
pub async fn cache() -> Result<(), anyhow::Error> {
    // Use the existing enterprise prompt manager to load all prompts
    o2_enterprise::enterprise::ai::agent::prompt::prompts::load_system_prompt().await?;
    log::info!("AI prompts loaded into enterprise prompt manager cache");
    Ok(())
}
