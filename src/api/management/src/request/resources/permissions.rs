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

use std::{sync::Arc, time::Duration};

use config::meta::resources::{ResourceKind, SourceReason};
use openobserve_core::resources::ResourceAccess;
use tokio::time::Instant;

// The OpenFGA client sets no request timeout; 5 s matches the OpenFGA request deadline.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

pub(super) async fn resolve(
    org: &str,
    subject: &str,
    kinds: &[ResourceKind],
) -> Vec<ResourceAccess> {
    resolve_by(org, subject, kinds, Instant::now() + RESOLVE_TIMEOUT).await
}

pub(super) fn enabled(kind: ResourceKind) -> bool {
    let cfg = config::get_config();
    match kind {
        ResourceKind::ServiceAccount if !cfg.auth.service_account_enabled => false,
        ResourceKind::Synthetic if !cfg.synthetics.enabled => false,
        #[cfg(feature = "enterprise")]
        _ => super::rbac::licensed(kind),
        #[cfg(not(feature = "enterprise"))]
        _ => true,
    }
}

pub(super) fn unavailable(kind: ResourceKind, reason: SourceReason) -> ResourceAccess {
    ResourceAccess {
        kind,
        predicate: Arc::new(|_| false),
        partial: false,
        unavailable_reason: Some(reason),
    }
}

/// Resolves one kind by `deadline`, so a slow kind does not hide the kinds that answered.
#[cfg(any(feature = "enterprise", test))]
pub(super) async fn bounded(
    kind: ResourceKind,
    deadline: Instant,
    access: impl std::future::Future<Output = ResourceAccess>,
) -> ResourceAccess {
    tokio::time::timeout_at(deadline, access)
        .await
        .unwrap_or_else(|_| unavailable(kind, SourceReason::PermissionUnavailable))
}

#[cfg(feature = "enterprise")]
async fn resolve_by(
    org: &str,
    subject: &str,
    kinds: &[ResourceKind],
    deadline: Instant,
) -> Vec<ResourceAccess> {
    super::rbac::resolve(org, subject, kinds, deadline).await
}

#[cfg(not(feature = "enterprise"))]
async fn resolve_by(
    _org: &str,
    _subject: &str,
    kinds: &[ResourceKind],
    _deadline: Instant,
) -> Vec<ResourceAccess> {
    kinds
        .iter()
        .map(|&kind| {
            if !enabled(kind) {
                return unavailable(kind, SourceReason::Disabled);
            }
            ResourceAccess {
                kind,
                predicate: Arc::new(|_| true),
                partial: false,
                unavailable_reason: None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_stalled_kind_does_not_hide_the_kinds_that_answered() {
        let deadline = Instant::now() + RESOLVE_TIMEOUT;
        let (stalled, ready) = tokio::join!(
            bounded(
                ResourceKind::Dashboard,
                deadline,
                futures::future::pending()
            ),
            bounded(ResourceKind::User, deadline, async {
                unavailable(ResourceKind::User, SourceReason::Disabled)
            }),
        );
        assert_eq!(
            (stalled.kind, stalled.unavailable_reason),
            (
                ResourceKind::Dashboard,
                Some(SourceReason::PermissionUnavailable)
            )
        );
        assert_eq!(ready.unavailable_reason, Some(SourceReason::Disabled));
    }

    #[tokio::test(start_paused = true)]
    async fn a_kind_answering_just_before_the_deadline_passes_through() {
        let deadline = Instant::now() + RESOLVE_TIMEOUT;
        let access = bounded(ResourceKind::User, deadline, async {
            tokio::time::sleep(RESOLVE_TIMEOUT - Duration::from_millis(1)).await;
            unavailable(ResourceKind::User, SourceReason::Disabled)
        })
        .await;
        assert_eq!(access.unavailable_reason, Some(SourceReason::Disabled));
    }
}
