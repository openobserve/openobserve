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

//! Correlate for one caller: OSS decides which candidate rows count, ENT answers from those only.

use std::collections::HashMap;

use config::meta::{
    correlation::{FieldAlias, ServiceIdentityConfig},
    service_streams::CorrelationResponse,
};
use o2_enterprise::enterprise::service_streams::{
    SourceIdentity,
    storage::{candidate_rows, correlate},
};

use super::signals::record_services::Reader;
use crate::authz::StreamAccessChecker;

/// `correlate` from the rows `reader` counts; a row that appears after the candidate read is not
/// admitted, so it fails closed. The system reader counts every row, as Live does.
pub async fn correlate_for(
    org_id: &str,
    reader: Reader<'_>,
    dims: &HashMap<String, String>,
    identity: &ServiceIdentityConfig,
    groups: &[FieldAlias],
    source: Option<&SourceIdentity>,
) -> anyhow::Result<Option<CorrelationResponse>> {
    let checker = crate::authz::active_checker();
    correlate_with(
        checker.as_ref(),
        org_id,
        reader,
        dims,
        identity,
        groups,
        source,
    )
    .await
}

/// [`correlate_for`] with the caller's checker given, so tests can drive the production path.
pub async fn correlate_with(
    checker: &dyn StreamAccessChecker,
    org_id: &str,
    reader: Reader<'_>,
    dims: &HashMap<String, String>,
    identity: &ServiceIdentityConfig,
    groups: &[FieldAlias],
    source: Option<&SourceIdentity>,
) -> anyhow::Result<Option<CorrelationResponse>> {
    let admitted = match reader {
        Reader::System => None,
        Reader::User(user_id) => {
            let rows = candidate_rows(org_id, dims, identity, groups, source).await?;
            let view: Vec<_> = rows
                .iter()
                .map(|row| (row.id.as_str(), &row.streams, row.streams_cut))
                .collect();
            crate::authz::admitted_rows(checker, user_id, org_id, &view).await
        }
    };
    correlate(org_id, dims, identity, groups, source, admitted.as_ref()).await
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use config::meta::{
        correlation::{FieldAlias, IdentitySet, ServiceIdentityConfig},
        service_streams::{CorrelationResponse, StreamInfo},
        stream::StreamType,
    };
    use o2_enterprise::enterprise::service_streams::{
        cache::update_services_cache, meta::ServiceMetadata,
    };

    use super::*;
    use crate::authz::TypedStream;

    const ORG: &str = "test_org_correlate_scope";

    /// C1 reads `o2_logs` by a per-stream grant, C2 is an org admin, C3 holds org-wide logs and
    /// profiles grants, C4 reads nothing.
    #[derive(Default)]
    struct Callers {
        grants: HashSet<(String, String)>,
        admins: HashSet<String>,
        org_wide: HashSet<(String, StreamType)>,
    }

    #[async_trait::async_trait]
    impl StreamAccessChecker for Callers {
        async fn enforces_rbac(&self) -> bool {
            true
        }

        async fn is_root(&self, _user_id: &str) -> bool {
            false
        }

        async fn is_root_or_admin(&self, org_id: &str, user_id: &str) -> bool {
            org_id == ORG && self.admins.contains(user_id)
        }

        async fn can_read_stream(&self, user_id: &str, stream: &TypedStream) -> bool {
            let key = format!("{}/{}/{}", stream.org_id, stream.stream_type, stream.name);
            self.grants.contains(&(user_id.to_string(), key))
                || self
                    .org_wide
                    .contains(&(user_id.to_string(), stream.stream_type))
        }

        async fn org_wide_readable(
            &self,
            user_id: &str,
            _org_id: &str,
            wanted: &[StreamType],
        ) -> HashSet<StreamType> {
            wanted
                .iter()
                .copied()
                .filter(|t| self.org_wide.contains(&(user_id.to_string(), *t)))
                .collect()
        }

        async fn can_use_cipher_key(&self, _org_id: &str, _user_id: &str, _key: &str) -> bool {
            false
        }

        async fn can_read_dashboard(&self, _: &str, _: &str, _: &str, _: &str) -> bool {
            false
        }
    }

    fn row(namespace: Option<&str>, logs: &str) -> ServiceMetadata {
        let mut row = ServiceMetadata::new("openobserve".to_string());
        let dims: HashMap<String, String> = namespace
            .map(|ns| HashMap::from([("k8s-namespace".to_string(), ns.to_string())]))
            .unwrap_or_default();
        row.disambiguation = dims.clone();
        row.all_dimensions = dims.clone();
        row.add_stream(
            StreamType::Logs,
            StreamInfo::with_type_and_filters(logs.to_string(), StreamType::Logs, dims),
        );
        row
    }

    /// The o2 row lists `o2_logs`; the secret row lists `app_secret`, `prof_a`, `team=ledger`
    /// with its logs cut.
    async fn seed() -> (
        HashMap<String, String>,
        ServiceIdentityConfig,
        Vec<FieldAlias>,
    ) {
        let mut secret = row(None, "app_secret");
        secret
            .all_dimensions
            .insert("team".to_string(), "ledger".to_string());
        secret.add_stream(
            StreamType::Profiles,
            StreamInfo::with_type("prof_a".to_string(), StreamType::Profiles),
        );
        secret.streams_cut = config::meta::service_streams::STREAMS_CUT_LOGS;
        let services = HashMap::from([
            ("o2".to_string(), row(Some("o2"), "o2_logs")),
            ("secret".to_string(), secret),
        ]);
        update_services_cache(ORG, &services).await;
        let identity = ServiceIdentityConfig {
            sets: vec![IdentitySet {
                id: "k8s".to_string(),
                label: "k8s".to_string(),
                distinguish_by: vec!["k8s-namespace".to_string()],
            }],
            ..Default::default()
        };
        let groups = vec![
            FieldAlias::new("service", "Service", &["service", "service_name"]),
            FieldAlias::new("k8s-namespace", "K8s Namespace", &["k8s_namespace_name"]),
        ];
        let dims = HashMap::from([
            ("service_name".to_string(), "openobserve".to_string()),
            ("k8s_namespace_name".to_string(), "o2".to_string()),
        ]);
        (dims, identity, groups)
    }

    fn log_names(resp: &Option<CorrelationResponse>) -> Option<Vec<String>> {
        resp.as_ref().map(|resp| {
            let mut logs: Vec<String> = resp
                .related_streams
                .logs
                .iter()
                .map(|s| s.stream_name.clone())
                .collect();
            logs.sort();
            logs
        })
    }

    #[tokio::test]
    async fn correlate_for_answers_each_caller_from_its_admitted_rows_only() {
        let (dims, identity, groups) = seed().await;
        let mut callers = Callers::default();
        let o2_logs = format!("{ORG}/logs/o2_logs");
        callers.grants.insert(("c1".to_string(), o2_logs));
        callers.admins.insert("c2".to_string());
        for stream_type in [StreamType::Logs, StreamType::Profiles] {
            callers.org_wide.insert(("c3".to_string(), stream_type));
        }
        let both = Some(vec!["app_secret".to_string(), "o2_logs".to_string()]);
        let mut answers = Vec::new();
        for reader in [
            Reader::User("c1"),
            Reader::User("c2"),
            Reader::User("c3"),
            Reader::User("c4"),
            Reader::System,
        ] {
            let resp = correlate_with(&callers, ORG, reader, &dims, &identity, &groups, None)
                .await
                .unwrap();
            answers.push(resp);
        }
        assert_eq!(log_names(&answers[0]), Some(vec!["o2_logs".to_string()]));
        let c1 = serde_json::to_string(&answers[0]).unwrap();
        for hidden in ["app_secret", "ledger", "prof_a"] {
            assert!(!c1.contains(hidden), "C1 sees {hidden}: {c1}");
        }
        assert_eq!(log_names(&answers[1]), both, "C2 is Live");
        assert_eq!(
            log_names(&answers[2]),
            both,
            "C3's org-wide grants cover the cut row"
        );
        assert!(answers[3].is_none(), "C4 counts no row: the Live null");
        assert_eq!(
            log_names(&answers[4]),
            both,
            "the system reader counts every row"
        );
    }
}
