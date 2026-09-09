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

//! Org-scoped serialization for parent-save, child-save and delete, so no interleaving can commit
//! a dangling reference (§5.5).

#[must_use = "the composition guard must be released after the mutation"]
pub struct CompositionGuard {
    inner: Inner,
}

enum Inner {
    Local(tokio::sync::OwnedMutexGuard<bool>),
    Distributed(Option<infra::dist_lock::Locker>),
}

/// Acquire the one composition lock for `org_id`.
pub async fn lock(org_id: &str) -> Result<CompositionGuard, infra::errors::Error> {
    let key = format!("/synthetics/composition/{org_id}");
    let inner = if config::get_config().common.local_mode {
        let holder = infra::local_lock::lock(&key).await?;
        Inner::Local(holder.lock_owned().await)
    } else {
        Inner::Distributed(infra::dist_lock::lock(&key, 0).await?)
    };
    Ok(CompositionGuard { inner })
}

impl CompositionGuard {
    /// Release the lock. Distributed release errors are returned so mutations
    /// can surface a temporary-unavailability response instead of pretending
    /// composition serialization completed cleanly.
    pub async fn release(self) -> Result<(), infra::errors::Error> {
        match &self.inner {
            Inner::Local(guard) => {
                let _ = **guard;
                Ok(())
            }
            Inner::Distributed(locker) => infra::dist_lock::unlock(locker).await,
        }
    }
}
