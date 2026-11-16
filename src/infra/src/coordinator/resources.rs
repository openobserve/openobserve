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

use std::sync::atomic::{AtomicU64, Ordering};

use config::meta::resources::ResourceKind;

use crate::db::{Event, EventData};

pub const CONTINUITY_LOST_KEY: &str = "/resource_catalog/_continuity_lost";
pub const CONTINUITY_RESTORED_KEY: &str = "/resource_catalog/_continuity_restored";
static CONTINUITY: Continuity = Continuity::new();

struct Continuity {
    state: AtomicU64,
}

impl Continuity {
    const fn new() -> Self {
        Self {
            state: AtomicU64::new(0),
        }
    }

    fn snapshot(&self) -> (bool, u64) {
        let state = self.state.load(Ordering::Acquire);
        (state & 1 != 0, state >> 1)
    }

    fn invalidate(&self) {
        self.state.fetch_add(2, Ordering::AcqRel);
    }

    fn transition(&self, healthy: bool) {
        self.state
            .try_update(Ordering::AcqRel, Ordering::Acquire, |state| {
                Some((state.wrapping_add(2) & !1) | u64::from(healthy))
            })
            .expect("continuity update always supplies a state");
    }
}

pub fn continuity_snapshot() -> (bool, u64) {
    CONTINUITY.snapshot()
}

pub fn local_subscription_ready() {
    if config::get_config().common.local_mode {
        CONTINUITY.transition(!crate::db::sqlite::CHANNEL.watch_tx.is_closed());
    }
}

pub async fn changed(org: &str, kind: ResourceKind, id: &str) {
    announce(&format!("/resource_catalog/{kind}/{org}/{id}")).await;
}

pub async fn folder_changed(org: &str) {
    announce(&format!("/resource_catalog/folder/{org}")).await;
}

pub(crate) fn continuity_event(key: &str) -> Event {
    Event::Put(EventData {
        key: key.into(),
        value: None,
        start_dt: None,
    })
}

pub(crate) fn mark_lost() {
    CONTINUITY.transition(false);
}

pub(crate) fn mark_restored() {
    CONTINUITY.transition(true);
}

pub(crate) fn mark_hint_lost() {
    CONTINUITY.invalidate();
}

async fn announce(key: &str) {
    // Hints carry no stored metadata; the committed rows remain the authoritative baseline.
    let result = if config::get_config().common.local_mode {
        crate::db::sqlite::CHANNEL
            .send(continuity_event(key))
            .await
            .map_err(|error| crate::errors::Error::Message(error.to_string()))
    } else {
        super::events::put_event(key, None, None).await
    };
    if let Err(error) = result {
        log::error!("[resources] change notification failed: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuity_starts_unhealthy_and_epochs_fence_disconnected_builds() {
        let state = Continuity::new();
        assert_eq!(state.snapshot(), (false, 0));
        state.transition(true);
        let before = state.snapshot();
        assert!(before.0);
        state.transition(false);
        let lost = state.snapshot();
        assert!(!lost.0);
        assert_ne!(lost.1, before.1);
        state.transition(true);
        let restored = state.snapshot();
        assert!(restored.0);
        assert_ne!(restored.1, before.1);
        assert_ne!(restored.1, lost.1);
        state.invalidate();
        let missed_hint = state.snapshot();
        assert!(missed_hint.0);
        assert_ne!(missed_hint.1, restored.1);
        state.transition(false);
        state.invalidate();
        assert!(!state.snapshot().0);
    }
}
