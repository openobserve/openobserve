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

use crate::get_coordinator;

pub const LICENSE_KEY_PREFIX: &str = "/license/";

fn should_refresh_usage(event: &Event, node_id: &str) -> bool {
    matches!(event, Event::Put(event) if event.value.as_ref().is_none_or(|v| v.as_ref() != node_id.as_bytes()))
}

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

pub async fn watch_usage() -> Result<(), anyhow::Error> {
    let coordinator = get_coordinator().await;
    let mut events = coordinator.watch("/license_usage/").await?;
    let events = Arc::get_mut(&mut events).unwrap();
    while let Some(event) = events.recv().await {
        if should_refresh_usage(&event, &config::cluster::LOCAL_NODE.uuid) {
            o2_enterprise::enterprise::license::refresh_usage();
        }
    }
    Ok(())
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

    #[test]
    fn holder_notifications_refresh_followers_without_waking_the_holder() {
        let event = Event::Put(infra::db::EventData {
            key: "/license_usage/".into(),
            value: Some(bytes::Bytes::from_static(b"holder")),
            start_dt: None,
        });
        assert!(!should_refresh_usage(&event, "holder"));
        assert!(should_refresh_usage(&event, "follower"));
        assert!(!should_refresh_usage(&Event::Empty, "follower"));
    }
}
