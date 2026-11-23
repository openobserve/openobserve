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

use std::collections::HashSet;

use config::meta::{service_identity::WhereSummaryRecord, stream::StreamType};

use crate::{
    auth::check_permissions,
    authz::{StreamReadMemo, active_checker, readable_streams},
};

pub struct ReadableStreams {
    pub traces: HashSet<String>,
    pub rum: bool,
}

impl ReadableStreams {
    pub async fn load(org: &str, user: &str, summaries: &[WhereSummaryRecord]) -> Self {
        let traces: HashSet<String> = summaries
            .iter()
            .filter(|row| row.signal == "traces")
            .map(|row| row.source_stream.clone())
            .collect();
        let rum = (StreamType::Logs, "_rumdata".to_string());
        let wanted = traces
            .iter()
            .map(|name| (StreamType::Traces, name.clone()))
            .chain([rum.clone()])
            .collect();
        let checker = active_checker();
        match readable_streams(checker.as_ref(), user, org, wanted).await {
            None => Self { traces, rum: true },
            Some(readable) => Self {
                rum: readable.contains(&rum),
                traces: traces
                    .into_iter()
                    .filter(|name| readable.contains(&(StreamType::Traces, name.clone())))
                    .collect(),
            },
        }
    }

    pub fn visible(&self, rows: &[WhereSummaryRecord]) -> Vec<WhereSummaryRecord> {
        rows.iter()
            .filter(|row| self.contains(row))
            .cloned()
            .collect()
    }

    pub fn contains(&self, row: &WhereSummaryRecord) -> bool {
        match row.signal.as_str() {
            "traces" => self.traces.contains(&row.source_stream),
            "rum" => self.rum && row.source_stream == "_rumdata",
            _ => false,
        }
    }
}

pub async fn endpoint(org: &str, user: &str, method: &str) -> bool {
    check_permissions(
        org,
        org,
        user,
        "service_streams",
        method,
        None,
        true,
        false,
        false,
    )
    .await
}

pub async fn evidence(
    org: &str,
    user: &str,
    streams: &[String],
    overflow: bool,
    org_wide_read: bool,
    memo: &StreamReadMemo,
) -> bool {
    if overflow && !org_wide_read {
        return false;
    }
    for stream in streams {
        let Some((kind, name)) = stream.split_once('/') else {
            return false;
        };
        let kind = match kind {
            "traces" => StreamType::Traces,
            "logs" => StreamType::Logs,
            "metrics" => StreamType::Metrics,
            _ => return false,
        };
        if name.is_empty()
            || (!org_wide_read
                && !memo
                    .can_read(active_checker().as_ref(), user, org, kind, name)
                    .await)
        {
            return false;
        }
    }
    true
}

/// Root and admin users read evidence org-wide.
pub async fn org_wide_read(org: &str, user: &str) -> bool {
    crate::users::get_user(Some(org), user)
        .await
        .is_some_and(|user| {
            matches!(
                user.role,
                config::meta::user::UserRole::Root | config::meta::user::UserRole::Admin
            )
        })
}

#[cfg(all(test, feature = "test-utils"))]
mod tests {
    use super::*;
    use crate::authz::{TypedStream, fake_checker};

    #[tokio::test]
    async fn source_visibility_uses_typed_get_grants_for_every_request() {
        let org = "stage4_visibility";
        let user = "stage4-stream-reader@example.com";
        let denied = "stage4-no-streams@example.com";
        let checker = fake_checker();
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "allowed".into(),
            },
        );
        let summaries = [
            WhereSummaryRecord {
                signal: "traces".into(),
                source_stream: "allowed".into(),
                summary_key: String::new(),
                org_id: org.into(),
                service_name: "svc".into(),
                where_key: "env:prod".into(),
                scope_key: String::new(),
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "prod".into(),
                env_source: config::meta::service_identity::EnvSource::Attribute,
                env_source_value: String::new(),
                envs: Vec::new(),
                newest_version: "v1".into(),
                newest_version_key: String::new(),
                newest_first_seen: 0,
                has_version: true,
                first_seen: 0,
                last_seen: 0,
                purged_versions: 0,
                updated_at: 0,
            },
            WhereSummaryRecord {
                signal: "traces".into(),
                source_stream: "hidden".into(),
                summary_key: String::new(),
                org_id: org.into(),
                service_name: "svc".into(),
                where_key: "env:prod".into(),
                scope_key: String::new(),
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "prod".into(),
                env_source: config::meta::service_identity::EnvSource::Attribute,
                env_source_value: String::new(),
                envs: Vec::new(),
                newest_version: "v1".into(),
                newest_version_key: String::new(),
                newest_first_seen: 0,
                has_version: true,
                first_seen: 0,
                last_seen: 0,
                purged_versions: 0,
                updated_at: 0,
            },
            WhereSummaryRecord {
                signal: "rum".into(),
                source_stream: "_rumdata".into(),
                summary_key: String::new(),
                org_id: org.into(),
                service_name: "svc".into(),
                where_key: "env:prod".into(),
                scope_key: String::new(),
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "prod".into(),
                env_source: config::meta::service_identity::EnvSource::Attribute,
                env_source_value: String::new(),
                envs: Vec::new(),
                newest_version: "v1".into(),
                newest_version_key: String::new(),
                newest_first_seen: 0,
                has_version: true,
                first_seen: 0,
                last_seen: 0,
                purged_versions: 0,
                updated_at: 0,
            },
        ];
        let readable = ReadableStreams::load(org, user, &summaries).await;
        assert!(readable.contains(&summaries[0]));
        assert!(!readable.contains(&summaries[1]));
        assert!(!readable.contains(&summaries[2]));
        let other = ReadableStreams::load(org, denied, &summaries).await;
        assert!(summaries.iter().all(|row| !other.contains(row)));
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "kube_pod_container_info".into(),
            },
        );
        assert!(
            !evidence(
                org,
                user,
                &["metrics/kube_pod_container_info".into()],
                false,
                false,
                &StreamReadMemo::default()
            )
            .await
        );
        assert!(
            !evidence(
                org,
                user,
                &["allowed".into()],
                false,
                true,
                &StreamReadMemo::default()
            )
            .await
        );
    }

    fn row(org: &str, signal: &str, stream: &str) -> WhereSummaryRecord {
        WhereSummaryRecord {
            signal: signal.into(),
            source_stream: stream.into(),
            summary_key: String::new(),
            org_id: org.into(),
            service_name: "svc".into(),
            where_key: "env:prod".into(),
            scope_key: String::new(),
            k8s_cluster: String::new(),
            k8s_namespace: String::new(),
            env: "prod".into(),
            env_source: config::meta::service_identity::EnvSource::Attribute,
            env_source_value: String::new(),
            envs: Vec::new(),
            newest_version: "v1".into(),
            newest_version_key: String::new(),
            newest_first_seen: 0,
            has_version: true,
            first_seen: 0,
            last_seen: 0,
            purged_versions: 0,
            updated_at: 0,
        }
    }

    #[tokio::test]
    async fn an_org_wide_traces_grant_opens_every_trace_stream_and_not_rum() {
        let org = "issue3592_wide_traces";
        let user = "issue3592-wide-traces@example.com";
        let checker = fake_checker();
        checker.grant_read_all(user, org, StreamType::Traces);
        let summaries = [
            row(org, "traces", "t1"),
            row(org, "traces", "t2"),
            row(org, "rum", "_rumdata"),
        ];
        let readable = ReadableStreams::load(org, user, &summaries).await;
        assert!(readable.contains(&summaries[0]) && readable.contains(&summaries[1]));
        assert!(!readable.contains(&summaries[2]));

        let calls = checker.calls(user);
        assert_eq!(calls.streams, 1, "only _rumdata needs its own Check");
        assert_eq!(calls.org_wide.len(), 1);
        assert_eq!(
            calls.org_wide[0],
            [StreamType::Traces],
            "_rumdata is a lone logs stream"
        );
    }

    #[tokio::test]
    async fn a_failed_org_wide_question_falls_back_to_stream_checks() {
        let org = "issue3592_failed_wide";
        let user = "issue3592-failed-wide@example.com";
        let checker = fake_checker();
        checker.grant_read_all(user, org, StreamType::Traces);
        checker.fail_org_wide_once(user);
        let summaries = [row(org, "traces", "t1"), row(org, "traces", "t2")];
        let readable = ReadableStreams::load(org, user, &summaries).await;
        assert!(summaries.iter().all(|row| readable.contains(row)));
        assert_eq!(checker.calls(user).streams, 3, "t1, t2 and _rumdata");
    }

    #[tokio::test]
    async fn with_no_trace_rows_rum_costs_one_check_and_no_org_wide_question() {
        let org = "issue3592_no_traces";
        let user = "issue3592-no-traces@example.com";
        let checker = fake_checker();
        let summaries = [row(org, "rum", "_rumdata")];
        let readable = ReadableStreams::load(org, user, &summaries).await;
        assert!(!readable.rum && readable.traces.is_empty());
        assert!(checker.calls(user).org_wide.is_empty());
        assert_eq!(checker.calls(user).streams, 1);
    }
}
