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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::Duration,
};

use flight::profile::ProfileNode;
use parking_lot::Mutex;
use tokio::sync::watch;

/// The shortest a node holds a finished run's profile for its caller to fetch.
const MIN_HOLD: Duration = Duration::from_secs(60);

/// Profiles of this node's EXPLAIN ANALYZE runs, keyed by job trace id, held until fetched.
static HELD: LazyLock<Mutex<HashMap<String, Sender>>> = LazyLock::new(Default::default);

type Sender = Arc<watch::Sender<Option<ProfileNode>>>;

/// Where one run puts its profile; a run that ends without one leaves nothing to fetch.
pub(crate) struct ProfileSlot {
    key: String,
    hold: Duration,
    sender: Option<Sender>,
}

impl ProfileSlot {
    /// The profile is held until fetched, or for the longer of `MIN_HOLD` and `hold` once filled.
    pub(super) fn open(key: &str, hold: Duration) -> Self {
        let sender = Arc::new(watch::channel(None).0);
        HELD.lock().insert(key.to_string(), Arc::clone(&sender));
        Self {
            key: key.to_string(),
            hold: hold.max(MIN_HOLD),
            sender: Some(sender),
        }
    }

    pub(crate) fn fill(mut self, profile: ProfileNode) {
        let Some(sender) = self.sender.take() else {
            return;
        };
        sender.send_replace(Some(profile));
        let key = std::mem::take(&mut self.key);
        let hold = self.hold;
        tokio::spawn(async move {
            tokio::time::sleep(hold).await;
            HELD.lock().remove(&key);
        });
    }
}

impl Drop for ProfileSlot {
    fn drop(&mut self) {
        // Dropping the sender ends the wait of a fetch already under way.
        if self.sender.take().is_some() {
            HELD.lock().remove(&self.key);
        }
    }
}

/// Waits for the run's profile and removes it; `None` if no run with this key is held.
pub(super) async fn take_profile(key: &str) -> Option<ProfileNode> {
    let mut rx = HELD.lock().get(key)?.subscribe();
    let profile = rx.wait_for(Option::is_some).await.ok()?.clone();
    HELD.lock().remove(key);
    profile
}
