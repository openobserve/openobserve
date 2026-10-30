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

//! Org-wide serialization of saves and deletes, so no interleaving commits a dangling reference.

#[cfg(test)]
pub(crate) static LOCK_CALLS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, usize>>,
> = std::sync::LazyLock::new(Default::default);

#[must_use = "the composition guard must be released after the mutation"]
pub struct CompositionGuard {
    inner: Inner,
}

enum Inner {
    Local(tokio::sync::OwnedMutexGuard<bool>),
    Distributed(Option<infra::dist_lock::Locker>),
}

/// Longest a save or delete waits for the org-wide composition lock locally.
/// The existing lock-wait config (`ZO_NATS_LOCK_WAIT_TIMEOUT`, 3600s) belongs to
/// NATS and is far too long for a request, so this is a fixed bound. A stuck
/// holder then fails the request with a retryable error instead of hanging it.
const LOCAL_LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

async fn lock_local(
    key: &str,
    wait: std::time::Duration,
) -> Result<tokio::sync::OwnedMutexGuard<bool>, infra::errors::Error> {
    let holder = infra::local_lock::lock(key).await?;
    tokio::time::timeout(wait, holder.lock_owned())
        .await
        .map_err(|_| {
            infra::errors::Error::Message(format!(
                "timed out after {}s waiting for the synthetics composition lock; retry shortly",
                wait.as_secs()
            ))
        })
}

pub async fn lock(org_id: &str) -> Result<CompositionGuard, infra::errors::Error> {
    #[cfg(test)]
    {
        *LOCK_CALLS
            .lock()
            .unwrap()
            .entry(org_id.to_owned())
            .or_default() += 1;
    }
    let key = format!("/synthetics/composition/{org_id}");
    let inner = if config::get_config().common.local_mode {
        Inner::Local(lock_local(&key, LOCAL_LOCK_WAIT).await?)
    } else {
        Inner::Distributed(infra::dist_lock::lock(&key, 0).await?)
    };
    Ok(CompositionGuard { inner })
}

impl CompositionGuard {
    /// Distributed release errors are returned so a mutation can report a temporary failure.
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn local_lock_contention_times_out_then_recovers_on_release() {
        let key = "/synthetics/composition/lock-timeout-test";
        let held = lock_local(key, Duration::from_secs(1)).await.unwrap();
        let err = lock_local(key, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("retry"), "{err}");
        drop(held);
        lock_local(key, Duration::from_millis(50)).await.unwrap();
    }
}
