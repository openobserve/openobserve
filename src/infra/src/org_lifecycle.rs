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

use crate::{dist_lock, local_lock};

const LIFECYCLE_LOCK_PREFIX: &str = "/org_cleanup/lifecycle/";

/// Serializes an org's deletion start with a tombstone purge and the compactor's row removal.
#[must_use = "the org lifecycle guard must be released"]
pub struct OrgLifecycleGuard {
    inner: LifecycleLock,
}

impl OrgLifecycleGuard {
    pub async fn acquire(org_id: &str) -> Result<Self, anyhow::Error> {
        let key = format!("{LIFECYCLE_LOCK_PREFIX}{org_id}");
        let inner = if config::get_config().common.local_mode {
            let holder = local_lock::lock(&key).await?;
            LifecycleLock::Local(holder.lock_owned().await)
        } else {
            LifecycleLock::Distributed(dist_lock::lock(&key, 0).await?)
        };
        Ok(Self { inner })
    }

    pub async fn release(self) {
        match self.inner {
            LifecycleLock::Local(guard) => drop(guard),
            LifecycleLock::Distributed(locker) => {
                if let Err(e) = dist_lock::unlock(&locker).await {
                    log::error!("[org_cleanup] failed to release lifecycle lock: {e}");
                }
            }
        }
    }
}

enum LifecycleLock {
    Local(tokio::sync::OwnedMutexGuard<bool>),
    Distributed(Option<dist_lock::Locker>),
}
