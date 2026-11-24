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
use openobserve_core::{
    auth::check_permissions,
    authz::{StreamReadMemo, active_checker, readable_service_records},
    autoobserve::causes::deploy::{EVIDENCE, EVIDENCE_OVERFLOW},
    background_access::rbac_enforced,
    service_identity::access,
};

use super::{PERMISSION_CHECK_CONCURRENCY, readable_streams, readable_subjects};
use crate::request::{organization::require_credential_access, security::security_allowed};

/// The read check each subject kind's own GET route makes.
#[async_trait]
pub trait ReadRights: Send + Sync {
    /// One answer per (stream type, stream name).
    async fn streams(&self, ids: Vec<(String, String)>) -> Vec<bool>;
    /// One answer per alert subject.
    async fn alerts(&self, subjects: Vec<EntityRef>) -> Vec<bool>;
    async fn pipeline(&self, pipeline_id: &str) -> bool;
    async fn fleet(&self, fleet_id: &str) -> bool;
    async fn ingestion_tokens(&self) -> bool;
    /// One answer per service name.
    async fn services(&self, names: Vec<String>) -> Vec<bool>;
    /// The Versions tab's deploy check: every evidence stream readable, a cut list org-wide.
    async fn evidence(&self, streams: &[String], overflow: bool) -> bool;
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
            evidence: Default::default(),
        };
        resolve_with(&rights, subjects).await
    }
}

/// The caller's rights as RBAC grants them.
struct LiveRights<'a> {
    org_id: &'a str,
    user_id: &'a str,
    evidence: StreamReadMemo,
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

    /// The fleet GET routes' own check, the only fleet RBAC.
    async fn fleet(&self, fleet_id: &str) -> bool {
        openobserve_core::fleet::fleet_allowed(self.org_id, self.user_id, fleet_id, "GET").await
    }

    /// The token list route needs Admin or Root even with RBAC off.
    async fn ingestion_tokens(&self) -> bool {
        require_credential_access(self.org_id, self.user_id, "read ingestion tokens")
            .await
            .is_ok()
    }

    /// The service list route: its org-wide check, then only services with a stream it can read.
    async fn services(&self, names: Vec<String>) -> Vec<bool> {
        let listed = check_permissions(
            self.org_id,
            self.org_id,
            self.user_id,
            "service_streams",
            "GET",
            None,
            true,
            false,
            false,
        )
        .await;
        if !listed {
            return vec![false; names.len()];
        }
        let records = match infra::table::service_streams::list(self.org_id).await {
            Ok(records) => records,
            Err(e) => {
                log::warn!("[autoobserve] org {}: listing services: {e}", self.org_id);
                return vec![false; names.len()];
            }
        };
        let wanted = records
            .into_iter()
            .filter(|r| names.contains(&r.service_name))
            .collect();
        let checker = active_checker();
        let readable: BTreeSet<String> =
            readable_service_records(checker.as_ref(), self.user_id, self.org_id, wanted)
                .await
                .into_iter()
                .map(|r| r.service_name)
                .collect();
        names.iter().map(|n| readable.contains(n)).collect()
    }

    async fn evidence(&self, streams: &[String], overflow: bool) -> bool {
        let admin = access::org_wide_read(self.org_id, self.user_id).await;
        !streams.is_empty()
            && access::evidence(
                self.org_id,
                self.user_id,
                streams,
                overflow,
                admin,
                &self.evidence,
            )
            .await
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
    let (mut services, mut fleets) = (vec![], vec![]);
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
            kinds::SERVICE => {
                if let Some(name) = dim(s, dims::SERVICE_NAME) {
                    services.push((s.clone(), name));
                }
            }
            kinds::FLEET => {
                if let Some(id) = dim(s, dims::ENTITY_ID) {
                    fleets.push((s.clone(), id));
                }
            }
            _ => {}
        }
    }
    let mut readable = BTreeSet::new();
    let (subjects, ids): (Vec<_>, Vec<_>) = streams.into_iter().unzip();
    keep(&mut readable, subjects, rights.streams(ids).await);
    keep(&mut readable, alerts.clone(), rights.alerts(alerts).await);
    let pipelines: Vec<(EntityRef, bool)> = stream::iter(pipelines)
        .map(|(s, id)| async move { (s, rights.pipeline(&id).await) })
        .buffer_unordered(PERMISSION_CHECK_CONCURRENCY)
        .collect()
        .await;
    readable.extend(pipelines.into_iter().filter_map(|(s, ok)| ok.then_some(s)));
    let fleets: Vec<(EntityRef, bool)> = stream::iter(fleets)
        .map(|(s, id)| async move { (s, rights.fleet(&id).await) })
        .buffer_unordered(PERMISSION_CHECK_CONCURRENCY)
        .collect()
        .await;
    readable.extend(fleets.into_iter().filter_map(|(s, ok)| ok.then_some(s)));
    if !services.is_empty() {
        let (subjects, names): (Vec<_>, Vec<_>) = services.into_iter().unzip();
        let listed = rights.services(names).await;
        let services: Vec<(EntityRef, bool)> = stream::iter(subjects.into_iter().zip(listed))
            .map(|(s, ok)| async move {
                let ok = ok && evidence_readable(rights, &s).await;
                (s, ok)
            })
            .buffer_unordered(PERMISSION_CHECK_CONCURRENCY)
            .collect()
            .await;
        readable.extend(services.into_iter().filter_map(|(s, ok)| ok.then_some(s)));
    }
    if !tokens.is_empty() && rights.ingestion_tokens().await {
        readable.extend(tokens);
    }
    ViewerSet {
        readable,
        security: rights.security().await,
        names_allowed: true,
    }
}

/// A deploy's subject names its evidence; a service subject without it needs only the list check.
async fn evidence_readable<R: ReadRights>(rights: &R, subject: &EntityRef) -> bool {
    let Some(listed) = subject.key_dims.get(EVIDENCE) else {
        return true;
    };
    let overflow = subject.key_dims.contains_key(EVIDENCE_OVERFLOW);
    match serde_json::from_str::<Vec<String>>(listed) {
        Ok(streams) => rights.evidence(&streams, overflow).await,
        Err(_) => false,
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

        async fn fleet(&self, fleet_id: &str) -> bool {
            self.grants(fleet_id)
        }

        async fn ingestion_tokens(&self) -> bool {
            self.grants("tokens")
        }

        async fn services(&self, names: Vec<String>) -> Vec<bool> {
            names.iter().map(|n| self.grants(n)).collect()
        }

        async fn evidence(&self, streams: &[String], overflow: bool) -> bool {
            !overflow && !streams.is_empty() && streams.iter().all(|s| self.grants(s))
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

    fn service(name: &str) -> EntityRef {
        EntityRef::new(kinds::SERVICE, &[(dims::SERVICE_NAME, name)])
    }

    const PUBLIC: &str = r#"["traces/public"]"#;

    fn deploy(evidence: &[(&str, bool)]) -> EntityRef {
        openobserve_core::autoobserve::causes::deploy::scoped("checkout", evidence)
    }

    fn by_id(kind: &str, id: &str) -> EntityRef {
        EntityRef::new(kind, &[(dims::ENTITY_ID, id)])
    }

    #[tokio::test]
    async fn each_subject_is_readable_only_through_its_own_kinds_check() {
        let rights = FakeRights {
            allowed: [
                "logs/app",
                "a1",
                "p1",
                "tokens",
                "f1",
                "d1",
                "app",
                "checkout",
                "traces/public",
            ]
            .into(),
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
            ("readable fleet", by_id(kinds::FLEET, "f1"), true),
            ("unreadable fleet", by_id(kinds::FLEET, "f2"), false),
            ("readable service", service("checkout"), true),
            ("unreadable service", service("billing"), false),
            (
                "service without a name",
                by_id(kinds::SERVICE, "checkout"),
                false,
            ),
            ("unknown kind", by_id(kinds::DASHBOARD, "d1"), false),
            (
                "deploy with readable evidence",
                deploy(&[(PUBLIC, false)]),
                true,
            ),
            (
                "deploy whose verdict reads an unreadable stream",
                deploy(&[(PUBLIC, false), (r#"["traces/private"]"#, false)]),
                false,
            ),
            (
                "deploy with overflowed evidence",
                deploy(&[(PUBLIC, true)]),
                false,
            ),
            (
                "deploy with unreadable evidence",
                deploy(&[("not json", false)]),
                false,
            ),
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
