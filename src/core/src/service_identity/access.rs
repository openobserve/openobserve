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
    authz::{
        StreamReadMemo, active_checker,
        list::{
            AuthzUnavailable, Decision, ModeAnswers, ObjectRef, Readable, SITE_SERVICE_EVIDENCE,
            SITE_SERVICE_IDENTITY, TypeAnswers, answer_in_mode, legacy_readable_streams,
            shadow_verdict, stream_answers, unavailable,
        },
    },
};

/// The evidence stream types; one type answer for each serves every row of the request.
const EVIDENCE_TYPES: [StreamType; 3] = [StreamType::Traces, StreamType::Logs, StreamType::Metrics];

pub struct ReadableStreams {
    pub traces: HashSet<String>,
    pub rum: bool,
    /// How `evidence` answers: legacy, served type answers, or legacy compared with sampled shadow
    /// answers.
    pub answers: ModeAnswers,
}

impl ReadableStreams {
    pub async fn load(
        org: &str,
        user: &str,
        summaries: &[WhereSummaryRecord],
    ) -> Result<Self, AuthzUnavailable> {
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
        let checker = checker.as_ref();
        let (readable, answers) = answer_in_mode(
            checker,
            SITE_SERVICE_IDENTITY,
            user,
            &wanted,
            || legacy_readable_streams(checker, user, org, wanted.clone()),
            || {
                stream_answers(
                    checker,
                    SITE_SERVICE_IDENTITY,
                    user,
                    org,
                    &wanted,
                    &EVIDENCE_TYPES,
                )
            },
        )
        .await?;
        Ok(match readable {
            None => Self {
                traces,
                rum: true,
                answers,
            },
            Some(readable) => Self {
                rum: readable.contains(&rum),
                traces: traces
                    .into_iter()
                    .filter(|name| readable.contains(&(StreamType::Traces, name.clone())))
                    .collect(),
                answers,
            },
        })
    }

    pub async fn evidence(
        &self,
        org: &str,
        user: &str,
        streams: &[String],
        overflow: bool,
        org_wide_read: bool,
        memo: &StreamReadMemo,
    ) -> Result<bool, AuthzUnavailable> {
        match &self.answers {
            ModeAnswers::Legacy => {
                Ok(evidence(org, user, streams, overflow, org_wide_read, memo).await)
            }
            ModeAnswers::Serve(answers) => {
                if overflow && !org_wide_read {
                    return Ok(false);
                }
                let objects = evidence_prefix(streams);
                if objects.len() != streams.len() {
                    return Ok(false);
                }
                if org_wide_read {
                    return Ok(true);
                }
                new_verdict(answers, &objects)
                    .await
                    .map_err(|e| unavailable(SITE_SERVICE_EVIDENCE, e))
                    .map(|decision| decision.verdict.is_ok())
            }
            ModeAnswers::Shadow(answers) => {
                if overflow || org_wide_read {
                    return Ok(evidence(org, user, streams, overflow, org_wide_read, memo).await);
                }
                let objects = evidence_prefix(streams);
                Ok(shadow_verdict(
                    SITE_SERVICE_EVIDENCE,
                    answers,
                    &objects,
                    || legacy_verdict(org, user, streams, overflow, org_wide_read, memo),
                    || new_shadow_verdict(answers, &objects, streams.len()),
                )
                .await
                .is_ok())
            }
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
    let (decision, _) = legacy_verdict(org, user, streams, overflow, org_wide_read, memo).await;
    decision.verdict.is_ok()
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

async fn legacy_verdict(
    org: &str,
    user: &str,
    streams: &[String],
    overflow: bool,
    org_wide_read: bool,
    memo: &StreamReadMemo,
) -> (Decision, bool) {
    let decision = |verdict, decided| Decision { verdict, decided };
    if overflow && !org_wide_read {
        return (decision(Err(None), 0), false);
    }
    let mut had_error = false;
    for (index, stream) in streams.iter().enumerate() {
        let Some((kind, name)) = evidence_stream(stream) else {
            return (decision(Err(None), 0), had_error);
        };
        if org_wide_read {
            continue;
        }
        let answer = memo
            .read(active_checker().as_ref(), user, org, kind, name)
            .await;
        had_error |= answer.had_error;
        if !answer.allowed {
            return (decision(Err(Some(kind)), index + 1), had_error);
        }
    }
    (decision(Ok(()), streams.len()), had_error)
}

async fn new_verdict(
    answers: &TypeAnswers,
    objects: &[ObjectRef<'_>],
) -> Result<Decision, AuthzUnavailable> {
    let checker = active_checker();
    let readable = answers
        .decide(checker.as_ref(), SITE_SERVICE_EVIDENCE, objects)
        .await?;
    if let Readable::Only(set) = readable
        && let Some((index, object)) = objects
            .iter()
            .enumerate()
            .find(|(_, o)| !set.contains(&(o.stream_type, o.id.to_string())))
    {
        return Ok(Decision {
            verdict: Err(Some(object.stream_type)),
            decided: index + 1,
        });
    }
    Ok(Decision {
        verdict: Ok(()),
        decided: objects.len(),
    })
}

async fn new_shadow_verdict(
    answers: &TypeAnswers,
    prefix: &[ObjectRef<'_>],
    stream_count: usize,
) -> Result<Decision, AuthzUnavailable> {
    if prefix.len() == stream_count {
        return new_verdict(answers, prefix).await;
    }
    let checker = active_checker();
    // A later fallback error must not mask a denial that already decides the row.
    for (index, object) in prefix.iter().enumerate() {
        let readable = answers
            .decide(
                checker.as_ref(),
                SITE_SERVICE_EVIDENCE,
                std::slice::from_ref(object),
            )
            .await?;
        if let Readable::Only(set) = readable
            && set.is_empty()
        {
            return Ok(Decision {
                verdict: Err(Some(object.stream_type)),
                decided: index + 1,
            });
        }
    }
    Ok(Decision {
        verdict: Err(None),
        decided: 0,
    })
}

fn evidence_prefix(streams: &[String]) -> Vec<ObjectRef<'_>> {
    streams
        .iter()
        .map_while(|stream| {
            evidence_stream(stream).map(|(kind, name)| ObjectRef::stream(kind, name))
        })
        .collect()
}

/// A `kind/name` evidence entry; an unknown kind or an empty name is no stream.
fn evidence_stream(stream: &str) -> Option<(StreamType, &str)> {
    let (kind, name) = stream.split_once('/')?;
    let kind = match kind {
        "traces" => StreamType::Traces,
        "logs" => StreamType::Logs,
        "metrics" => StreamType::Metrics,
        _ => return None,
    };
    (!name.is_empty()).then_some((kind, name))
}

#[cfg(all(test, feature = "test-utils"))]
mod tests {
    use config::metrics::authz as metrics;

    use super::*;
    use crate::authz::{
        TypedStream, fake_checker,
        list::{ListMode, SHADOW_TESTS},
        within_budget,
    };

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
        let readable = ReadableStreams::load(org, user, &summaries).await.unwrap();
        assert!(readable.contains(&summaries[0]));
        assert!(!readable.contains(&summaries[1]));
        assert!(!readable.contains(&summaries[2]));
        let other = ReadableStreams::load(org, denied, &summaries)
            .await
            .unwrap();
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
        let readable = ReadableStreams::load(org, user, &summaries).await.unwrap();
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
        let readable = ReadableStreams::load(org, user, &summaries).await.unwrap();
        assert!(summaries.iter().all(|row| readable.contains(row)));
        assert_eq!(checker.calls(user).streams, 3, "t1, t2 and _rumdata");
    }

    #[tokio::test]
    async fn with_no_trace_rows_rum_costs_one_check_and_no_org_wide_question() {
        let org = "issue3592_no_traces";
        let user = "issue3592-no-traces@example.com";
        let checker = fake_checker();
        let summaries = [row(org, "rum", "_rumdata")];
        let readable = ReadableStreams::load(org, user, &summaries).await.unwrap();
        assert!(!readable.rum && readable.traces.is_empty());
        assert!(checker.calls(user).org_wide.is_empty());
        assert_eq!(checker.calls(user).streams, 1);
    }

    #[tokio::test]
    async fn on_mode_answers_from_one_type_set_and_reuses_it_for_evidence() {
        let org = "u9_row11";
        let user = "u9-row11@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "t1".into(),
            },
        );
        checker.grant_read_all(user, org, StreamType::Metrics);
        let summaries = [row(org, "traces", "t1"), row(org, "traces", "t2")];
        let readable = within_budget(9, ReadableStreams::load(org, user, &summaries))
            .await
            .unwrap();
        assert!(readable.contains(&summaries[0]) && !readable.contains(&summaries[1]));
        let calls = checker.calls(user);
        assert_eq!(
            (calls.types_access, calls.object_checks, calls.streams),
            (1, 0, 0)
        );

        let memo = StreamReadMemo::default();
        within_budget(0, async {
            let k1 = ["metrics/kube_pod_info".to_string()];
            assert!(
                readable
                    .evidence(org, user, &k1, false, false, &memo)
                    .await
                    .unwrap()
            );
            let unnamed = ["logs/never_in_a_summary".to_string()];
            assert!(
                !readable
                    .evidence(org, user, &unnamed, false, false, &memo)
                    .await
                    .unwrap()
            );
        })
        .await;
        assert_eq!(
            checker.calls(user).types_access,
            1,
            "no type-level call per row"
        );
        assert_eq!(checker.calls(user).object_checks, 0);
    }

    #[tokio::test]
    async fn on_mode_memoizes_fallback_evidence_checks() {
        let org = "c8_evidence_on";
        let user = "c8-evidence-on@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        let name = "x".repeat(201);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Logs,
                name: name.clone(),
            },
        );
        let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Serve(_)));
        let stream = format!("logs/{name}");
        let memo = StreamReadMemo::default();
        within_budget(1, async {
            for streams in [vec![stream.clone(), stream.clone()], vec![stream]] {
                assert!(
                    readable
                        .evidence(org, user, &streams, false, false, &memo)
                        .await
                        .unwrap()
                );
            }
        })
        .await;
        assert_eq!(checker.calls(user).object_checks, 1);
    }

    #[tokio::test]
    async fn an_evidence_check_error_is_unavailable_never_restricted() {
        use crate::authz::list::UnavailableReason;

        let org = "u9_row12";
        let user = "u9-row12@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        let readable = within_budget(
            10,
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")]),
        )
        .await
        .unwrap();
        checker.fail_object_check_once(user, UnavailableReason::Server(500));
        let uncovered = [format!("logs/{}", "x".repeat(300))];
        let malformed = [uncovered[0].clone(), "unknown/name".into()];
        let memo = StreamReadMemo::default();
        assert!(
            !within_budget(
                0,
                readable.evidence(org, user, &malformed, false, false, &memo)
            )
            .await
            .unwrap()
        );
        let err = within_budget(
            1,
            readable.evidence(org, user, &uncovered, false, false, &memo),
        )
        .await
        .unwrap_err();
        assert_eq!(err.reason, UnavailableReason::Server(500));
        assert!(
            !within_budget(
                1,
                readable.evidence(org, user, &uncovered, false, false, &memo),
            )
            .await
            .unwrap()
        );
        assert_eq!(checker.calls(user).object_checks, 2);
    }

    #[tokio::test]
    async fn evidence_fallback_metrics_use_the_evidence_site() {
        const CHILD: &str = "O2_AUTHZ_EVIDENCE_METRICS_CHILD";
        // Other tests write to these process-wide site counters.
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "service_identity::access::tests::evidence_fallback_metrics_use_the_evidence_site",
                ])
                .env(CHILD, "1")
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let org = "c5_evidence_metrics";
        let user = "c5-evidence-metrics@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        let stream = "x".repeat(201);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Logs,
                name: stream.clone(),
            },
        );
        let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
        let counts = |site| {
            (
                metrics::AUTHZ_FALLBACK_CHECKS_TOTAL
                    .with_label_values(&[site])
                    .get(),
                metrics::AUTHZ_OBJECTS_AUTHORIZED
                    .with_label_values(&[site])
                    .get_sample_count(),
            )
        };
        let identity_before = counts(SITE_SERVICE_IDENTITY);
        let (checks_before, objects_before) = counts(SITE_SERVICE_EVIDENCE);
        let memo = StreamReadMemo::default();
        let streams = [format!("logs/{stream}")];
        for _ in 0..2 {
            assert!(
                readable
                    .evidence(org, user, &streams, false, false, &memo)
                    .await
                    .unwrap()
            );
        }
        assert_eq!(
            counts(SITE_SERVICE_EVIDENCE),
            (checks_before + 1, objects_before + 2)
        );
        assert_eq!(counts(SITE_SERVICE_IDENTITY), identity_before);
    }

    #[tokio::test]
    async fn a_failed_type_question_fails_the_load() {
        use crate::authz::list::UnavailableReason;

        let org = "u9_row11_fail";
        let user = "u9-row11-fail@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.fail_types_access_once(user, UnavailableReason::Transport);
        let loaded = ReadableStreams::load(org, user, &[row(org, "traces", "t1")]).await;
        assert_eq!(
            loaded.err().map(|e| e.reason),
            Some(UnavailableReason::Transport)
        );
    }

    #[tokio::test]
    async fn off_mode_keeps_no_answers_and_evidence_takes_the_legacy_check() {
        let org = "u9_row12_off";
        let user = "u9-row12-off@example.com";
        let checker = fake_checker();
        let readable = within_budget(
            2,
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")]),
        )
        .await
        .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Legacy));
        let streams = ["traces/t1".to_string()];
        let memo = StreamReadMemo::default();
        assert!(
            !within_budget(
                1,
                readable.evidence(org, user, &streams, false, false, &memo)
            )
            .await
            .unwrap()
        );
        assert_eq!(checker.calls(user).types_access, 0);
    }

    #[tokio::test]
    async fn off_mode_reuses_a_failed_evidence_check() {
        let org = "c8_evidence_off";
        let user = "c8-evidence-off@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Off);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "shared".into(),
            },
        );
        let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Legacy));
        let before = checker.calls(user).streams;
        checker.fail_stream_read_once(user, "shared");
        let streams = ["traces/shared".into()];
        let memo = StreamReadMemo::default();
        within_budget(1, async {
            for _ in 0..2 {
                assert!(
                    !readable
                        .evidence(org, user, &streams, false, false, &memo)
                        .await
                        .unwrap()
                );
            }
        })
        .await;
        assert_eq!(checker.calls(user).streams - before, 1);
    }

    #[tokio::test]
    async fn shadow_mode_skips_memoized_legacy_evidence_errors() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c8_evidence_shadow";
        let user = "c8-evidence-shadow@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "shared".into(),
            },
        );
        let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
        let skipped = metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL
            .with_label_values(&[SITE_SERVICE_EVIDENCE, "legacy_error"]);
        let before = (
            checker.calls(user).streams,
            evidence_mismatches(),
            skipped.get(),
        );
        checker.fail_stream_read_once(user, "shared");
        let streams = ["traces/shared".into()];
        let memo = StreamReadMemo::default();
        within_budget(1, async {
            for _ in 0..2 {
                assert!(
                    !readable
                        .evidence(org, user, &streams, false, false, &memo)
                        .await
                        .unwrap()
                );
            }
        })
        .await;
        assert_eq!(checker.calls(user).streams - before.0, 1);
        assert_eq!(evidence_mismatches(), before.1);
        assert_eq!(skipped.get() - before.2, 2);
    }

    #[tokio::test]
    async fn shadow_mode_compares_matching_evidence_and_serves_legacy() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c3_row12_shadow_match";
        let user = "c3-row12-shadow-match@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        for name in ["t1", "t2"] {
            checker.grant_read(
                user,
                &TypedStream {
                    org_id: org.into(),
                    stream_type: StreamType::Traces,
                    name: name.into(),
                },
            );
        }
        let readable = ReadableStreams::load(org, user, &[row(org, "traces", "t1")])
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&[SITE_SERVICE_EVIDENCE, "list"]);
        let before = (compared.get(), evidence_mismatches());
        let memo = StreamReadMemo::default();
        assert!(
            readable
                .evidence(
                    org,
                    user,
                    &["traces/t1".into(), "traces/t2".into()],
                    false,
                    false,
                    &memo,
                )
                .await
                .unwrap()
        );
        assert_eq!(compared.get(), before.0 + 1);
        assert_eq!(evidence_mismatches(), before.1);
    }

    fn evidence_mismatches() -> u64 {
        ["unknown", "traces", "logs", "metrics"]
            .into_iter()
            .flat_map(|kind| {
                ["new_allows_more", "new_allows_less"].map(|direction| {
                    metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
                        .with_label_values(&[SITE_SERVICE_EVIDENCE, kind, direction])
                        .get()
                })
            })
            .sum()
    }

    #[tokio::test]
    async fn shadow_evidence_matches_legacy_before_malformed_entries() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c7_evidence_malformed";
        let allowed_user = "c7-evidence-allowed-prefix@example.com";
        let denied_user = "c7-evidence-denied-prefix@example.com";
        let checker = fake_checker();
        checker.grant_read(
            allowed_user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Logs,
                name: "allowed".into(),
            },
        );
        checker.fail_object_check_once(denied_user, crate::authz::list::UnavailableReason::Timeout);
        let uncovered = format!("logs/{}", "x".repeat(300));
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&[SITE_SERVICE_EVIDENCE, "list"]);
        let cases: [(&str, &[&str], u64); 3] = [
            (denied_user, &["logs/denied", "unknown/name"], 1),
            (allowed_user, &["logs/allowed", "unknown/name"], 0),
            (denied_user, &["logs/denied", &uncovered, "unknown/name"], 1),
        ];
        for (user, entries, compared_delta) in cases {
            checker.set_list_mode(user, ListMode::Shadow);
            checker.set_shadow_sample(user, 1.0);
            let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
            assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
            let before = (compared.get(), evidence_mismatches());
            let streams: Vec<_> = entries.iter().map(|entry| entry.to_string()).collect();
            let memo = StreamReadMemo::default();
            assert!(
                !readable
                    .evidence(org, user, &streams, false, false, &memo)
                    .await
                    .unwrap(),
                "{entries:?}"
            );
            assert_eq!(compared.get() - before.0, compared_delta, "{entries:?}");
            assert_eq!(evidence_mismatches(), before.1, "{entries:?}");
        }
        assert_eq!(checker.calls(denied_user).object_checks, 0);
    }

    #[tokio::test]
    async fn shadow_evidence_stops_credit_at_the_matching_first_denial() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c4_evidence_matching_denial";
        let user = "c4-evidence-matching-denial@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "allowed".into(),
            },
        );
        let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&[SITE_SERVICE_EVIDENCE, "list"]);
        let before = (compared.get(), evidence_mismatches());
        let streams = [format!("logs/{}", "x".repeat(300)), "traces/allowed".into()];
        let memo = StreamReadMemo::default();
        assert!(
            !readable
                .evidence(org, user, &streams, false, false, &memo)
                .await
                .unwrap()
        );
        assert_eq!(checker.calls(user).object_checks, 1);
        assert_eq!((compared.get(), evidence_mismatches()), before);
    }

    #[tokio::test]
    async fn shadow_evidence_records_different_denials_without_credit() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c4_evidence_different_denials";
        let user = "c4-evidence-different-denials@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.list_extra_once(user, StreamType::Traces, "new_only");
        let readable = ReadableStreams::load(org, user, &[]).await.unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Logs,
                name: "legacy_only".into(),
            },
        );
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&[SITE_SERVICE_EVIDENCE, "list"]);
        let before = compared.get();
        let memo = StreamReadMemo::default();
        for (first, second, kind, direction) in [
            (
                "traces/new_only",
                "logs/denied",
                "traces",
                "new_allows_more",
            ),
            (
                "logs/legacy_only",
                "traces/denied",
                "logs",
                "new_allows_less",
            ),
            (
                "traces/new_only",
                "unknown/name",
                "traces",
                "new_allows_more",
            ),
            (
                "logs/legacy_only",
                "unknown/name",
                "logs",
                "new_allows_less",
            ),
        ] {
            let mismatch = metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL.with_label_values(&[
                SITE_SERVICE_EVIDENCE,
                kind,
                direction,
            ]);
            let mismatches_before = (mismatch.get(), evidence_mismatches());
            assert!(
                !readable
                    .evidence(
                        org,
                        user,
                        &[first.into(), second.into()],
                        false,
                        false,
                        &memo
                    )
                    .await
                    .unwrap()
            );
            assert_eq!(mismatch.get(), mismatches_before.0 + 1);
            assert_eq!(evidence_mismatches(), mismatches_before.1 + 1);
        }
        assert_eq!(compared.get(), before);
    }

    #[tokio::test]
    async fn shadow_mode_records_an_evidence_mismatch_and_serves_legacy() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c3_row12_shadow_mismatch";
        let user = "c3-row12-shadow-mismatch@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.list_extra_once(user, StreamType::Logs, "b");
        let readable = ReadableStreams::load(org, user, &[row(org, "traces", "t1")])
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
        let mismatches = metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL.with_label_values(&[
            SITE_SERVICE_EVIDENCE,
            "logs",
            "new_allows_more",
        ]);
        let before = mismatches.get();
        let memo = StreamReadMemo::default();
        assert!(
            !readable
                .evidence(org, user, &["logs/b".into()], false, false, &memo)
                .await
                .unwrap()
        );
        assert_eq!(mismatches.get(), before + 1);
    }
}
