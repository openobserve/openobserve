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

//! Which issue-context records a caller may see: each subject gets its own GET route's read check.

use std::collections::BTreeSet;

use async_trait::async_trait;
use futures::{StreamExt, stream};
use o2_enterprise::enterprise::autoobserve::{
    context::{PROVIDER_RECORDS, ViewerResolver, ViewerSet},
    contract::EntityRef,
    names::{dims, kinds},
};
use openobserve_core::{auth::check_permissions, background_access::rbac_enforced};

use super::{readable_streams, readable_subjects};
use crate::request::{organization::require_credential_access, security::security_allowed};

const PIPELINE_CHECK_CONCURRENCY: usize = 16;

/// The read check each subject kind's own GET route makes.
#[async_trait]
pub trait ReadRights: Send + Sync {
    /// One answer per (stream type, stream name).
    async fn streams(&self, ids: Vec<(String, String)>) -> Vec<bool>;
    /// One answer per alert subject.
    async fn alerts(&self, subjects: Vec<EntityRef>) -> Vec<bool>;
    async fn pipeline(&self, pipeline_id: &str) -> bool;
    async fn ingestion_tokens(&self) -> bool;
    async fn security(&self) -> bool;
}

/// The web caller's resolver, used by every route that serves issue context.
pub struct WebViewer {
    pub user_id: String,
}

#[async_trait]
impl ViewerResolver for WebViewer {
    async fn resolve(&self, org: &str, subjects: &[EntityRef]) -> ViewerSet {
        let rights = LiveRights {
            org_id: org,
            user_id: &self.user_id,
        };
        resolve_with(&rights, subjects).await
    }
}

/// The caller's rights as RBAC grants them.
struct LiveRights<'a> {
    org_id: &'a str,
    user_id: &'a str,
}

#[async_trait]
impl ReadRights for LiveRights<'_> {
    async fn streams(&self, ids: Vec<(String, String)>) -> Vec<bool> {
        readable_streams(self.org_id, self.user_id, ids).await
    }

    async fn alerts(&self, subjects: Vec<EntityRef>) -> Vec<bool> {
        readable_subjects(self.org_id, self.user_id, subjects).await
    }

    /// The pipeline GET route's middleware check: `pipelines:<id>`, its own parent.
    async fn pipeline(&self, pipeline_id: &str) -> bool {
        !rbac_enforced().await
            || check_permissions(
                pipeline_id,
                self.org_id,
                self.user_id,
                "pipelines",
                "GET",
                None,
                false,
                false,
                true,
            )
            .await
    }

    /// The token list route needs Admin or Root even with RBAC off.
    async fn ingestion_tokens(&self) -> bool {
        require_credential_access(self.org_id, self.user_id, "read ingestion tokens")
            .await
            .is_ok()
    }

    async fn security(&self) -> bool {
        security_allowed(self.org_id, self.user_id, "GET").await
    }
}

/// Unknown kinds, and a subject missing the dims its check needs, stay unreadable.
pub async fn resolve_with<R: ReadRights>(rights: &R, subjects: &[EntityRef]) -> ViewerSet {
    let distinct: BTreeSet<&EntityRef> = subjects.iter().take(PROVIDER_RECORDS).collect();
    let dim = |s: &EntityRef, k: &str| s.key_dims.get(k).cloned();
    let (mut streams, mut alerts, mut pipelines, mut tokens) = (vec![], vec![], vec![], vec![]);
    for s in distinct {
        match s.kind.as_str() {
            kinds::STREAM => {
                if let (Some(t), Some(n)) = (dim(s, dims::STREAM_TYPE), dim(s, dims::STREAM_NAME)) {
                    streams.push((s.clone(), (t, n)));
                }
            }
            kinds::ALERT => alerts.push(s.clone()),
            kinds::PIPELINE => {
                if let Some(id) = dim(s, dims::ENTITY_ID) {
                    pipelines.push((s.clone(), id));
                }
            }
            kinds::INGESTION_TOKEN => tokens.push(s.clone()),
            // L4 replaces this with the fleet routes' own check.
            kinds::FLEET => {}
            _ => {}
        }
    }
    let mut readable = BTreeSet::new();
    let (subjects, ids): (Vec<_>, Vec<_>) = streams.into_iter().unzip();
    keep(&mut readable, subjects, rights.streams(ids).await);
    keep(&mut readable, alerts.clone(), rights.alerts(alerts).await);
    let pipelines: Vec<(EntityRef, bool)> = stream::iter(pipelines)
        .map(|(s, id)| async move { (s, rights.pipeline(&id).await) })
        .buffer_unordered(PIPELINE_CHECK_CONCURRENCY)
        .collect()
        .await;
    readable.extend(pipelines.into_iter().filter_map(|(s, ok)| ok.then_some(s)));
    if !tokens.is_empty() && rights.ingestion_tokens().await {
        readable.extend(tokens);
    }
    ViewerSet {
        readable,
        security: rights.security().await,
        names_allowed: true,
    }
}

fn keep(readable: &mut BTreeSet<EntityRef>, subjects: Vec<EntityRef>, allowed: Vec<bool>) {
    readable.extend(
        subjects
            .into_iter()
            .zip(allowed)
            .filter_map(|(s, ok)| ok.then_some(s)),
    );
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// Grants exactly the listed names, and counts how often each check ran.
    #[derive(Default)]
    struct FakeRights {
        allowed: BTreeSet<&'static str>,
        security: bool,
        calls: AtomicUsize,
    }

    impl FakeRights {
        fn grants(&self, name: &str) -> bool {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.allowed.contains(name)
        }
    }

    #[async_trait]
    impl ReadRights for FakeRights {
        async fn streams(&self, ids: Vec<(String, String)>) -> Vec<bool> {
            ids.iter()
                .map(|(t, n)| self.grants(&format!("{t}/{n}")))
                .collect()
        }

        async fn alerts(&self, subjects: Vec<EntityRef>) -> Vec<bool> {
            subjects
                .iter()
                .map(|s| self.grants(&s.key_dims[dims::ENTITY_ID]))
                .collect()
        }

        async fn pipeline(&self, pipeline_id: &str) -> bool {
            self.grants(pipeline_id)
        }

        async fn ingestion_tokens(&self) -> bool {
            self.grants("tokens")
        }

        async fn security(&self) -> bool {
            self.security
        }
    }

    fn stream(t: &str, n: &str) -> EntityRef {
        EntityRef::new(
            kinds::STREAM,
            &[(dims::STREAM_TYPE, t), (dims::STREAM_NAME, n)],
        )
    }

    fn by_id(kind: &str, id: &str) -> EntityRef {
        EntityRef::new(kind, &[(dims::ENTITY_ID, id)])
    }

    #[tokio::test]
    async fn each_subject_is_readable_only_through_its_own_kinds_check() {
        let rights = FakeRights {
            allowed: ["logs/app", "a1", "p1", "tokens", "f1", "d1", "app"].into(),
            security: true,
            ..Default::default()
        };
        let cases = [
            ("readable stream", stream("logs", "app"), true),
            ("unreadable stream", stream("logs", "billing"), false),
            (
                "stream without a type",
                EntityRef::new(kinds::STREAM, &[(dims::STREAM_NAME, "app")]),
                false,
            ),
            ("readable alert", by_id(kinds::ALERT, "a1"), true),
            ("unreadable alert", by_id(kinds::ALERT, "a2"), false),
            ("readable pipeline", by_id(kinds::PIPELINE, "p1"), true),
            ("unreadable pipeline", by_id(kinds::PIPELINE, "p2"), false),
            ("ingestion token", by_id(kinds::INGESTION_TOKEN, "ci"), true),
            ("fleet stub", by_id(kinds::FLEET, "f1"), false),
            ("unknown kind", by_id(kinds::DASHBOARD, "d1"), false),
        ];
        let subjects: Vec<EntityRef> = cases.iter().map(|(_, s, _)| s.clone()).collect();
        let set = resolve_with(&rights, &subjects).await;
        for (what, subject, readable) in &cases {
            assert_eq!(set.readable.contains(subject), *readable, "{what}");
        }
        assert!(set.security && set.names_allowed);

        let denied = FakeRights {
            allowed: ["tokens"].into(),
            ..Default::default()
        };
        let set = resolve_with(&denied, &[stream("logs", "app"), stream("logs", "app")]).await;
        assert!(set.readable.is_empty() && !set.security);
        assert_eq!(
            denied.calls.load(Ordering::Relaxed),
            1,
            "a repeated subject is checked once"
        );
    }
}
