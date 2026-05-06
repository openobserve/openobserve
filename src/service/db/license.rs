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

use infra::db::Event;

use crate::service::db::get_coordinator;

pub const LICENSE_KEY_PREFIX: &str = "/license/";

pub async fn update() -> Result<(), anyhow::Error> {
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            LICENSE_KEY_PREFIX,
            bytes::Bytes::new(), // todo: send key directly so receiver does not query db
            true,
            None,
        )
        .await?;
    // we do not manually trigger the update here, as the coordinator event handler
    // does that for us, if we do it here, there is a chance of deadlock or very slow update
    // due to lock contention
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let prefix = LICENSE_KEY_PREFIX;
    let cluster_coordinator = get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching license keys");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_license: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(_) => match o2_enterprise::enterprise::license::update_license().await {
                Ok(_) => {
                    log::info!("successfully updated local license")
                }
                Err(e) => {
                    log::error!("error updating local license : {e}")
                }
            },
            Event::Delete(_) | Event::Empty => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_license_key_prefix_value() {
        assert_eq!(LICENSE_KEY_PREFIX, "/license/");
    }

    #[test]
    fn test_license_key_prefix_starts_with_slash() {
        assert!(LICENSE_KEY_PREFIX.starts_with('/'));
    }
}
