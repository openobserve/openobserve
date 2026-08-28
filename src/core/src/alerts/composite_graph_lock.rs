// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Organization-scoped serialization for composite graph mutations.
//!
//! `infra::dist_lock` intentionally becomes a no-op in local mode. Composite
//! graph integrity needs serialization in both deployments, so every creator,
//! updater and guarded deleter shares this adapter instead of calling the
//! distributed lock directly.

#[must_use = "the composite graph guard must be released after the mutation"]
pub struct CompositeGraphGuard {
    inner: Inner,
}

enum Inner {
    Local(tokio::sync::OwnedMutexGuard<bool>),
    Distributed(Option<infra::dist_lock::Locker>),
}

/// Acquire the one graph lock for `org_id`.
pub async fn lock(org_id: &str) -> Result<CompositeGraphGuard, infra::errors::Error> {
    let key = format!("/alerts/composite_graph/{org_id}");
    let inner = if config::get_config().common.local_mode {
        let holder = infra::local_lock::lock(&key).await?;
        Inner::Local(holder.lock_owned().await)
    } else {
        Inner::Distributed(infra::dist_lock::lock(&key, 0).await?)
    };
    Ok(CompositeGraphGuard { inner })
}

impl CompositeGraphGuard {
    /// Release the lock. Distributed release errors are returned so mutations
    /// can surface a temporary-unavailability response instead of pretending
    /// graph serialization completed cleanly.
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
