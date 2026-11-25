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

use std::{future::Future, sync::Arc, time::Duration};

use config::meta::resources::{ResourceKind, SourceReason};
use openobserve_core::resources::ResourceAccess;

// The OpenFGA client sets no request timeout, and every debounced keystroke resolves again.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(1);

pub(super) async fn resolve(
    org: &str,
    subject: &str,
    kinds: &[ResourceKind],
) -> Vec<ResourceAccess> {
    bounded(
        kinds,
        RESOLVE_TIMEOUT,
        resolve_unbounded(org, subject, kinds),
    )
    .await
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

async fn bounded(
    kinds: &[ResourceKind],
    limit: Duration,
    access: impl Future<Output = Vec<ResourceAccess>>,
) -> Vec<ResourceAccess> {
    tokio::time::timeout(limit, access)
        .await
        .unwrap_or_else(|_| {
            kinds
                .iter()
                .map(|&kind| unavailable(kind, SourceReason::PermissionUnavailable))
                .collect()
        })
}

#[cfg(feature = "enterprise")]
async fn resolve_unbounded(
    org: &str,
    subject: &str,
    kinds: &[ResourceKind],
) -> Vec<ResourceAccess> {
    super::rbac::resolve(org, subject, kinds).await
}

#[cfg(not(feature = "enterprise"))]
async fn resolve_unbounded(
    _org: &str,
    _subject: &str,
    kinds: &[ResourceKind],
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
    async fn a_stalled_permission_lookup_reports_every_kind_unavailable() {
        let kinds = [ResourceKind::Dashboard, ResourceKind::Alert];
        let access = bounded(&kinds, RESOLVE_TIMEOUT, futures::future::pending()).await;
        let reasons = access
            .iter()
            .map(|item| (item.kind, item.unavailable_reason))
            .collect::<Vec<_>>();
        assert_eq!(
            reasons,
            [
                (
                    ResourceKind::Dashboard,
                    Some(SourceReason::PermissionUnavailable)
                ),
                (
                    ResourceKind::Alert,
                    Some(SourceReason::PermissionUnavailable)
                ),
            ]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_prompt_permission_lookup_passes_through() {
        let kinds = [ResourceKind::Dashboard];
        let ready = vec![unavailable(ResourceKind::Dashboard, SourceReason::Disabled)];
        let access = bounded(&kinds, RESOLVE_TIMEOUT, async { ready }).await;
        assert_eq!(access[0].unavailable_reason, Some(SourceReason::Disabled));
    }
}
