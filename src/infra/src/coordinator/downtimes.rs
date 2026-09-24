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

use std::{future::Future, sync::Arc};

use crate::{db::Event, errors::Error};

pub const DOWNTIME_WATCHER_PREFIX: &str = "/downtimes/";

/// Tells every node that this downtime row changed; the payload is empty, nodes reload the org.
pub async fn emit_put_event(org: &str, id: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(&downtime_key(org, id), bytes::Bytes::new(), true, None)
        .await?;
    Ok(())
}

pub async fn emit_delete_event(org: &str, id: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .delete(&downtime_key(org, id), false, true, None)
        .await
}

pub async fn watch_events<OnPut, OnPutFut, OnDelete, OnDeleteFut>(
    on_put: OnPut,
    on_delete: OnDelete,
) -> Result<(), anyhow::Error>
where
    OnPut: Fn(String, String) -> OnPutFut,
    OnPutFut: Future<Output = Result<(), anyhow::Error>>,
    OnDelete: Fn(String, String) -> OnDeleteFut,
    OnDeleteFut: Future<Output = Result<(), anyhow::Error>>,
{
    let cluster_coordinator = super::get_coordinator().await;
    let mut events = cluster_coordinator.watch(DOWNTIME_WATCHER_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching downtimes");
    while let Some(ev) = events.recv().await {
        let (key, is_put) = match &ev {
            Event::Put(ev) => (ev.key.as_str(), true),
            Event::Delete(ev) => (ev.key.as_str(), false),
            Event::Empty => continue,
        };
        let Some((org, id)) = parse_downtime_key(key) else {
            log::error!("watch_downtimes: failed to parse event key {key}");
            continue;
        };
        let result = if is_put {
            (on_put)(org, id).await
        } else {
            (on_delete)(org, id).await
        };
        if let Err(e) = result {
            log::error!("watch_downtimes: handler failed: {e}");
        }
    }
    log::error!("watch_downtimes: event channel closed");
    Ok(())
}

pub fn parse_downtime_key(key: &str) -> Option<(String, String)> {
    let mut parts = key.trim_start_matches('/').split('/');
    if parts.next()? != "downtimes" {
        return None;
    }
    let org = parts.next().filter(|s| !s.is_empty())?;
    let id = parts.next().filter(|s| !s.is_empty())?;
    Some((org.to_owned(), id.to_owned()))
}

fn downtime_key(org: &str, id: &str) -> String {
    format!("{DOWNTIME_WATCHER_PREFIX}{org}/{id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_round_trips() {
        let key = downtime_key("acme", "2f9KQe4b7Nq1vH3sT0mLzXpRcWd");
        assert_eq!(key, "/downtimes/acme/2f9KQe4b7Nq1vH3sT0mLzXpRcWd");
        assert_eq!(
            parse_downtime_key(&key),
            Some((
                "acme".to_string(),
                "2f9KQe4b7Nq1vH3sT0mLzXpRcWd".to_string()
            ))
        );
    }

    #[test]
    fn a_foreign_or_short_key_does_not_parse() {
        assert!(parse_downtime_key("/alerts/acme/x").is_none());
        assert!(parse_downtime_key("/downtimes/acme").is_none());
        assert!(parse_downtime_key("/downtimes/acme/").is_none());
    }
}
