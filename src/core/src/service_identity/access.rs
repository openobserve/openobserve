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

use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, Ordering},
};

use config::meta::{service_identity::WhereSummaryRecord, stream::StreamType};

use crate::{
    auth::check_permissions,
    authz::{
        StreamReadMemo, active_checker,
        list::{
            AuthzUnavailable, Calls, Decision, Folded, ModeAnswers, ObjectRef, Outcome,
            SITE_SERVICE_EVIDENCE, SITE_SERVICE_IDENTITY, Scope, UnavailableReason, all_of,
            answer_in_mode, legacy_readable_streams, shadow_verdict, stream_answers_for_query,
            stream_read_query, unavailable,
        },
    },
};

/// The evidence stream types; one type answer for each serves every row of the request.
const EVIDENCE_TYPES: [StreamType; 3] = [StreamType::Traces, StreamType::Logs, StreamType::Metrics];

/// What a caller reads from `_rumdata`: only the RUM rows its summaries list, or raw RUM as well.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RumReads {
    Summaries,
    Raw,
}

impl RumReads {
    /// A compare reads raw `_rumdata` whenever its signals include `rum`.
    pub fn for_compare(signals: &[serde_json::Value]) -> Self {
        if signals.iter().any(|signal| signal == "rum") {
            Self::Raw
        } else {
            Self::Summaries
        }
    }
}

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
        rum_reads: RumReads,
    ) -> Result<Self, AuthzUnavailable> {
        let traces: HashSet<String> = summaries
            .iter()
            .filter(|row| row.signal == "traces")
            .map(|row| row.source_stream.clone())
            .collect();
        let rum = (StreamType::Logs, "_rumdata".to_string());
        let scope = if rum_reads == RumReads::Raw
            || summaries
                .iter()
                .any(|row| row.signal == "rum" && row.source_stream == rum.1)
        {
            Scope::every()
        } else {
            Scope::every().filtered([rum.clone()])
        };
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
            &scope,
            |wanted| legacy_readable_streams(checker, user, org, wanted),
            |wanted| async move {
                let mut types: Vec<_> = wanted.iter().map(|(kind, _)| *kind).collect();
                types.sort_unstable_by_key(|kind| kind.as_str());
                types.dedup();
                let query = stream_read_query(SITE_SERVICE_IDENTITY, org, user, &types);
                let (readable, answers) =
                    stream_answers_for_query(checker, &query, &wanted).await?;
                Ok((readable, answers.with_later_types(&EVIDENCE_TYPES)))
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
        match self
            .evidence_outcome(
                org,
                user,
                streams,
                overflow,
                org_wide_read,
                memo,
                Calls::Send,
            )
            .await
        {
            Some(Outcome::Error(reason)) => Err(evidence_unavailable(reason)),
            outcome => Ok(outcome == Some(Outcome::Allow)),
        }
    }

    #[expect(clippy::too_many_arguments)]
    pub async fn evidence_outcome(
        &self,
        org: &str,
        user: &str,
        streams: &[String],
        overflow: bool,
        org_wide_read: bool,
        memo: &StreamReadMemo,
        calls: Calls,
    ) -> Option<Outcome> {
        let Some(parsed) = parse_evidence(streams, overflow, org_wide_read) else {
            return Some(Outcome::Deny);
        };
        if org_wide_read {
            return Some(Outcome::Allow);
        }
        match &self.answers {
            ModeAnswers::Legacy | ModeAnswers::SmallOn => {
                let (folded, _) = legacy_evidence(org, user, &parsed, memo, calls).await;
                match folded.outcome {
                    Some(Outcome::Error(_)) if matches!(self.answers, ModeAnswers::Legacy) => {
                        Some(Outcome::Deny)
                    }
                    outcome => outcome,
                }
            }
            ModeAnswers::Serve(answers) => {
                let objects = evidence_objects(&parsed);
                answers
                    .all_allowed(
                        active_checker().as_ref(),
                        SITE_SERVICE_EVIDENCE,
                        &objects,
                        calls,
                    )
                    .await
                    .outcome
            }
            ModeAnswers::Shadow(_) if calls == Calls::HeldOnly => {
                let (folded, _) = legacy_evidence(org, user, &parsed, memo, calls).await;
                folded.outcome.map(|outcome| match outcome {
                    Outcome::Error(_) => Outcome::Deny,
                    outcome => outcome,
                })
            }
            ModeAnswers::Shadow(answers) => {
                let objects = evidence_objects(&parsed);
                let verdict = shadow_verdict(
                    SITE_SERVICE_EVIDENCE,
                    answers,
                    &objects,
                    || async {
                        let (folded, had_error) =
                            legacy_evidence(org, user, &parsed, memo, Calls::Send).await;
                        let verdict = match folded.outcome {
                            Some(Outcome::Allow) => Ok(()),
                            Some(Outcome::Deny) => Err(parsed
                                .get(folded.decided.saturating_sub(1))
                                .map(|&(kind, _)| kind)),
                            Some(Outcome::Error(_)) | None => Err(None),
                        };
                        (
                            Decision {
                                verdict,
                                decided: folded.decided,
                            },
                            had_error,
                        )
                    },
                    || async {
                        answers
                            .decide_prefix(
                                active_checker().as_ref(),
                                SITE_SERVICE_EVIDENCE,
                                &objects,
                                streams.len(),
                            )
                            .await
                    },
                )
                .await;
                Some(if verdict.is_ok() {
                    Outcome::Allow
                } else {
                    Outcome::Deny
                })
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
    let Some(parsed) = parse_evidence(streams, overflow, org_wide_read) else {
        return false;
    };
    if org_wide_read {
        return true;
    }
    let (folded, _) = legacy_evidence(org, user, &parsed, memo, Calls::Send).await;
    folded.outcome == Some(Outcome::Allow)
}

pub fn evidence_unavailable(reason: UnavailableReason) -> AuthzUnavailable {
    unavailable(SITE_SERVICE_EVIDENCE, reason.into())
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

async fn legacy_evidence(
    org: &str,
    user: &str,
    streams: &[(StreamType, &str)],
    memo: &StreamReadMemo,
    calls: Calls,
) -> (Folded, bool) {
    let checker = active_checker();
    let checker = checker.as_ref();
    let had_error = AtomicBool::new(false);
    let had_error = &had_error;
    let folded = all_of(calls, streams, |&(kind, name), calls| async move {
        let answer = match calls {
            Calls::Send => Some(memo.read(checker, user, org, kind, name).await),
            Calls::HeldOnly => memo.held(kind, name),
        }?;
        if answer.had_error || answer.error_denial.is_some() {
            had_error.store(true, Ordering::Relaxed);
        }
        Some(match (answer.allowed, answer.error_denial) {
            (true, _) => Outcome::Allow,
            (false, Some(reason)) => Outcome::Error(reason),
            (false, None) => Outcome::Deny,
        })
    })
    .await;
    (folded, had_error.load(Ordering::Relaxed))
}

fn parse_evidence(
    streams: &[String],
    overflow: bool,
    org_wide_read: bool,
) -> Option<Vec<(StreamType, &str)>> {
    if overflow && !org_wide_read {
        return None;
    }
    streams
        .iter()
        .map(|stream| evidence_stream(stream))
        .collect()
}

fn evidence_objects<'a>(streams: &[(StreamType, &'a str)]) -> Vec<ObjectRef<'a>> {
    streams
        .iter()
        .map(|&(kind, name)| ObjectRef::stream(kind, name))
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
        list::{ListMode, SHADOW_TESTS, SMALL_REQUEST_OBJECTS, UnavailableReason},
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
        let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
        assert!(readable.contains(&summaries[0]));
        assert!(!readable.contains(&summaries[1]));
        assert!(!readable.contains(&summaries[2]));
        let other = ReadableStreams::load(org, denied, &summaries, RumReads::Summaries)
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
        let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
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
        let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
        assert!(summaries.iter().all(|row| readable.contains(row)));
        assert_eq!(checker.calls(user).streams, 2, "t1 and t2");
    }

    #[tokio::test]
    async fn with_no_trace_rows_rum_costs_one_check_and_no_org_wide_question() {
        let org = "issue3592_no_traces";
        let user = "issue3592-no-traces@example.com";
        let checker = fake_checker();
        let summaries = [row(org, "rum", "_rumdata")];
        checker.fail_stream_read_once(user, "_rumdata");
        let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
        assert!(!readable.rum && readable.traces.is_empty());
        assert!(checker.calls(user).org_wide.is_empty());
        assert_eq!(checker.calls(user).streams, 1);

        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        checker.fail_stream_read_once(user, "_rumdata");
        assert_eq!(
            ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
                .await
                .err(),
            Some(UnavailableReason::Timeout.into())
        );
        assert_eq!(checker.calls(user).streams, 2);
    }

    #[tokio::test]
    async fn load_skips_a_failing_rum_check_without_a_matching_summary() {
        let org = "identity_without_rum";
        let checker = fake_checker();
        let summaries = [row(org, "traces", "t1"), row(org, "rum", "other")];
        let mut answers = Vec::new();
        for (user, mode) in [
            ("identity-without-rum-off@example.com", ListMode::Off),
            ("identity-without-rum-on@example.com", ListMode::On),
        ] {
            checker.set_list_mode(user, mode);
            checker.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
            checker.grant_read(
                user,
                &TypedStream {
                    org_id: org.into(),
                    stream_type: StreamType::Traces,
                    name: "t1".into(),
                },
            );
            checker.fail_stream_read_once(user, "_rumdata");
            let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
                .await
                .unwrap();
            assert_eq!(readable.visible(&summaries), summaries[..1]);
            assert_eq!(checker.calls(user).streams, 1);
            answers.push((readable.traces, readable.rum));
        }
        assert_eq!(answers[0], answers[1]);
        assert!(!answers[1].1);
    }

    #[tokio::test]
    async fn on_mode_reuses_type_answers_and_loads_evidence_types_once() {
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
        let readable = within_budget(
            4,
            ReadableStreams::load(org, user, &summaries, RumReads::Summaries),
        )
        .await
        .unwrap();
        assert!(readable.contains(&summaries[0]) && !readable.contains(&summaries[1]));
        let calls = checker.calls(user);
        assert_eq!(
            (calls.types_access, calls.object_checks, calls.streams),
            (1, 0, 0)
        );

        let memo = StreamReadMemo::default();
        let k1 = ["metrics/kube_pod_info".to_string()];
        assert_eq!(
            within_budget(6, readable.evidence(org, user, &k1, false, false, &memo)).await,
            Ok(true)
        );
        within_budget(0, async {
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
        assert_eq!(checker.calls(user).types_access, 2);
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
        let readable = ReadableStreams::load(
            org,
            user,
            &[row(org, "rum", "_rumdata")],
            RumReads::Summaries,
        )
        .await
        .unwrap();
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
    async fn small_on_evidence_sends_the_calls_of_legacy_for_a_type_wide_reader() {
        let org = "small_on_evidence_metrics";
        let on_user = "small-on-evidence-metrics@example.com";
        let off_user = "off-evidence-metrics@example.com";
        let checker = fake_checker();
        checker.set_list_mode(on_user, ListMode::On);
        checker.set_small_request_objects(on_user, SMALL_REQUEST_OBJECTS);
        checker.set_list_mode(off_user, ListMode::Off);
        for user in [on_user, off_user] {
            checker.grant_read_all(user, org, StreamType::Metrics);
        }
        let readable = ReadableStreams::load(org, on_user, &[], RumReads::Summaries)
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::SmallOn));
        ReadableStreams::load(org, off_user, &[], RumReads::Summaries)
            .await
            .unwrap();
        let on_before = checker.calls(on_user);
        let off_before = checker.calls(off_user);
        let streams: Vec<_> = (0..4).map(|i| format!("metrics/m{i}")).collect();
        let memo = StreamReadMemo::default();
        assert_eq!(
            within_budget(
                2,
                readable.evidence(org, on_user, &streams, false, false, &memo)
            )
            .await,
            Ok(true)
        );
        assert!(
            within_budget(
                2,
                evidence(
                    org,
                    off_user,
                    &streams,
                    false,
                    false,
                    &StreamReadMemo::default()
                ),
            )
            .await
        );

        let on_after = checker.calls(on_user);
        let off_after = checker.calls(off_user);
        let stream_checks = on_after.streams - on_before.streams;
        let probes = on_after.org_wide.len() - on_before.org_wide.len();
        assert_eq!(stream_checks, off_after.streams - off_before.streams);
        assert_eq!(probes, off_after.org_wide.len() - off_before.org_wide.len());
        assert!(stream_checks + probes <= 2);
        assert_eq!((on_after.object_checks, on_after.types_access), (0, 0));
    }

    #[tokio::test]
    async fn small_on_evidence_sends_the_calls_of_off_for_a_wide_metrics_row() {
        let org = "small_on_evidence_wide_row";
        let on_user = "small-on-evidence-wide-row@example.com";
        let off_user = "off-evidence-wide-row@example.com";
        let checker = fake_checker();
        checker.set_list_mode(on_user, ListMode::On);
        checker.set_small_request_objects(on_user, SMALL_REQUEST_OBJECTS);
        checker.set_list_mode(off_user, ListMode::Off);
        for user in [on_user, off_user] {
            checker.grant_read_all(user, org, StreamType::Metrics);
        }
        let readable = ReadableStreams::load(org, on_user, &[], RumReads::Summaries)
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::SmallOn));
        ReadableStreams::load(org, off_user, &[], RumReads::Summaries)
            .await
            .unwrap();
        let on_before = checker.calls(on_user);
        let off_before = checker.calls(off_user);
        let streams: Vec<_> = (0..60).map(|i| format!("metrics/m{i}")).collect();
        assert_eq!(
            readable
                .evidence(
                    org,
                    on_user,
                    &streams,
                    false,
                    false,
                    &StreamReadMemo::default()
                )
                .await,
            Ok(true)
        );
        assert!(
            evidence(
                org,
                off_user,
                &streams,
                false,
                false,
                &StreamReadMemo::default()
            )
            .await
        );
        let on_after = checker.calls(on_user);
        let off_after = checker.calls(off_user);
        assert_eq!(
            on_after.streams - on_before.streams,
            off_after.streams - off_before.streams
        );
        assert_eq!(
            on_after.org_wide[on_before.org_wide.len()..],
            off_after.org_wide[off_before.org_wide.len()..]
        );
        for (before, after) in [(on_before, on_after), (off_before, off_after)] {
            assert_eq!(
                (
                    after.types_access - before.types_access,
                    after.probe_b - before.probe_b,
                    after.lists - before.lists,
                    after.object_checks - before.object_checks
                ),
                (0, 0, 0, 0)
            );
        }
    }

    #[tokio::test]
    async fn small_on_evidence_reports_the_failed_checks_reason_without_a_second_pass() {
        let org = "small_on_evidence_timeout";
        let user = "small-on-evidence-timeout@example.com";
        let off_user = "off-evidence-timeout@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, 1);
        checker.set_list_mode(off_user, ListMode::Off);
        for user in [user, off_user] {
            checker.set_role(org, user, "user");
            checker.grant_read(
                user,
                &TypedStream {
                    org_id: org.into(),
                    stream_type: StreamType::Traces,
                    name: "app".into(),
                },
            );
        }
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::SmallOn));
        ReadableStreams::load(org, off_user, &[], RumReads::Summaries)
            .await
            .unwrap();
        let on_before = checker.calls(user).streams;
        let off_before = checker.calls(off_user).streams;
        for user in [user, off_user] {
            checker.fail_every_call(user, UnavailableReason::Timeout);
        }
        let streams = ["traces/app".to_string()];
        assert_eq!(
            readable
                .evidence(
                    org,
                    user,
                    &streams,
                    false,
                    false,
                    &StreamReadMemo::default()
                )
                .await,
            Err(UnavailableReason::Timeout.into())
        );
        assert!(
            !evidence(
                org,
                off_user,
                &streams,
                false,
                false,
                &StreamReadMemo::default()
            )
            .await
        );
        let calls = checker.calls(user);
        assert_eq!((calls.types_access, calls.lists), (0, 0));
        assert_eq!(
            calls.streams - on_before,
            checker.calls(off_user).streams - off_before
        );
    }

    #[tokio::test]
    async fn small_on_evidence_keeps_a_later_definite_deny_after_an_error() {
        let org = "small_on_later_deny";
        let user = "small-on-later-deny@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        checker.grant_read(
            user,
            &TypedStream {
                org_id: org.into(),
                stream_type: StreamType::Traces,
                name: "a".into(),
            },
        );
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
        let memo = StreamReadMemo::default();
        assert!(
            !memo
                .can_read(checker.as_ref(), user, org, StreamType::Traces, "denied")
                .await
        );
        checker.fail_stream_read_once(user, "a");
        let before = checker.calls(user);
        let streams = ["traces/a".into(), "traces/denied".into()];
        assert_eq!(
            readable
                .evidence(org, user, &streams, false, false, &memo)
                .await,
            Ok(false)
        );
        let calls = checker.calls(user);
        assert_eq!(calls.streams - before.streams, 1);
        assert_eq!((calls.types_access, calls.lists), (0, 0));
    }

    #[tokio::test]
    async fn small_on_evidence_rejects_a_malformed_row_before_any_call() {
        let org = "small_on_malformed_row";
        let user = "small-on-malformed-row@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
        checker.fail_every_call(user, UnavailableReason::Timeout);
        let valid: Vec<_> = (0..6).map(|i| format!("metrics/m{i}")).collect();
        let mut malformed = valid.clone();
        malformed.push("nope/x".into());
        let before = checker.calls(user);
        for (streams, overflow) in [(malformed, false), (valid, true)] {
            assert_eq!(
                readable
                    .evidence(
                        org,
                        user,
                        &streams,
                        overflow,
                        false,
                        &StreamReadMemo::default()
                    )
                    .await,
                Ok(false)
            );
            assert_eq!(checker.calls(user), before);
        }
    }

    #[tokio::test]
    async fn small_on_evidence_keeps_a_definite_deny() {
        let org = "small_on_evidence_deny";
        let user = "small-on-evidence-deny@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, 1);
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
        let streams = ["traces/app".to_string()];
        let memo = StreamReadMemo::default();
        assert_eq!(
            within_budget(
                1,
                readable.evidence(org, user, &streams, false, false, &memo)
            )
            .await,
            Ok(false)
        );
        assert_eq!(checker.calls(user).types_access, 0);
    }

    #[tokio::test]
    async fn small_on_evidence_keeps_the_legacy_offline_grant() {
        let org = "small_on_evidence_offline";
        let user = "small-on-evidence-offline@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, 1);
        checker.set_role(org, user, "editor");
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
        checker.fail_every_call(user, UnavailableReason::Transport);
        let streams = ["traces/app".to_string()];
        let memo = StreamReadMemo::default();
        let actual = within_budget(
            1,
            readable.evidence(org, user, &streams, false, false, &memo),
        )
        .await;
        let legacy = within_budget(
            1,
            evidence(
                org,
                user,
                &streams,
                false,
                false,
                &StreamReadMemo::default(),
            ),
        )
        .await;
        assert!(legacy);
        assert_eq!(actual, Ok(legacy));
        assert_eq!(checker.calls(user).types_access, 0);
    }

    #[tokio::test]
    async fn on_evidence_keeps_a_later_definite_deny_after_a_fallback_error() {
        let org = "evidence_fallback_error_then_deny";
        let user = "evidence-fallback-error-then-deny@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, 0);
        let readable =
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries)
                .await
                .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Serve(_)));
        checker.fail_object_check_once(user, UnavailableReason::Transport);
        let before = checker.calls(user).object_checks;
        let streams = [format!("logs/{}", "x".repeat(201)), "traces/denied".into()];
        assert_eq!(
            readable
                .evidence(
                    org,
                    user,
                    &streams,
                    false,
                    false,
                    &StreamReadMemo::default()
                )
                .await,
            Ok(false)
        );
        assert_eq!(checker.calls(user).object_checks - before, 1);
    }

    #[tokio::test]
    async fn on_evidence_stops_before_a_fallback_error_after_a_definite_deny() {
        use crate::authz::list::UnavailableReason;

        let org = "evidence_deny_prefix";
        let user = "evidence-deny-prefix@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        let readable =
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries)
                .await
                .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Serve(_)));
        checker.fail_object_check_once(user, UnavailableReason::Transport);
        let fallback = format!("logs/{}", "x".repeat(201));
        let streams = ["traces/denied".into(), fallback.clone()];
        let memo = StreamReadMemo::default();
        assert!(!evidence(org, user, &streams, false, false, &memo).await);
        assert_eq!(
            readable
                .evidence(org, user, &streams, false, false, &memo)
                .await,
            Ok(false)
        );
        let ModeAnswers::Serve(answers) = &readable.answers else {
            unreachable!()
        };
        let parsed = parse_evidence(&streams, false, false).unwrap();
        let actual = answers
            .decide_prefix(
                checker.as_ref(),
                SITE_SERVICE_EVIDENCE,
                &evidence_objects(&parsed),
                streams.len(),
            )
            .await
            .unwrap();
        assert_eq!(
            (actual.verdict, actual.decided),
            (Err(Some(StreamType::Traces)), 1)
        );
        assert_eq!(checker.calls(user).object_checks, 0);
        assert_eq!(
            readable
                .evidence(org, user, &[fallback], false, false, &memo)
                .await,
            Err(UnavailableReason::Transport.into())
        );
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
            ReadableStreams::load(
                org,
                user,
                &[row(org, "traces", "t1"), row(org, "rum", "_rumdata")],
                RumReads::Summaries,
            ),
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
        assert_eq!(
            within_budget(
                0,
                readable.evidence(org, user, &uncovered, false, false, &memo)
            )
            .await,
            Err(err)
        );
        assert_eq!(checker.calls(user).object_checks, 1);
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
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
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
    async fn metrics_type_failure_only_affects_metrics_evidence() {
        let org = "evidence_metrics_type_failure";
        let user = "evidence-metrics-type-failure@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        checker.grant_read_all(user, org, StreamType::Traces);
        checker.grant_read_all(user, org, StreamType::Logs);
        let summaries: Vec<_> = (0..SMALL_REQUEST_OBJECTS)
            .map(|i| row(org, "traces", &format!("t{i}")))
            .chain([row(org, "rum", "_rumdata")])
            .collect();
        let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Serve(_)));
        assert_eq!(readable.visible(&summaries), summaries);
        let before = checker.calls(user);
        assert_eq!((before.types_access, before.probe_b), (1, 4));

        // Metrics is the only remaining type, so the next evidence query can fail it alone.
        checker.fail_types_access_once(user, UnavailableReason::Timeout);
        let memo = StreamReadMemo::default();
        assert_eq!(
            readable
                .evidence(
                    org,
                    user,
                    &["metrics/kube_pod_info".into()],
                    false,
                    false,
                    &memo
                )
                .await,
            Err(UnavailableReason::Timeout.into())
        );
        let after_metrics = checker.calls(user);
        assert_eq!(after_metrics.types_access - before.types_access, 1);
        assert_eq!(
            readable
                .evidence(org, user, &["traces/t0".into()], false, false, &memo)
                .await,
            Ok(true)
        );
        assert_eq!(checker.calls(user), after_metrics);
    }

    #[tokio::test]
    async fn a_failed_type_question_fails_the_load() {
        use crate::authz::list::UnavailableReason;

        let org = "u9_row11_fail";
        let user = "u9-row11-fail@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::On);
        checker.fail_types_access_once(user, UnavailableReason::Transport);
        let loaded =
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries)
                .await;
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
            1,
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries),
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
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
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
        let readable =
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries)
                .await
                .unwrap();
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
        let readable =
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries)
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
    async fn shadow_evidence_rejects_malformed_rows_without_comparison() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c7_evidence_malformed";
        let user = "c7-evidence-malformed@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
        assert!(matches!(readable.answers, ModeAnswers::Shadow(_)));
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&[SITE_SERVICE_EVIDENCE, "list"]);
        let before = (checker.calls(user), compared.get(), evidence_mismatches());
        let streams = [format!("logs/{}", "x".repeat(300)), "unknown/name".into()];
        let memo = StreamReadMemo::default();
        assert_eq!(
            readable
                .evidence(org, user, &streams, false, false, &memo)
                .await,
            Ok(false)
        );
        assert_eq!(
            (checker.calls(user), compared.get(), evidence_mismatches()),
            before
        );
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
        let readable = ReadableStreams::load(org, user, &[], RumReads::Summaries)
            .await
            .unwrap();
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
    async fn shadow_evidence_counts_the_first_disagreement_in_different_denials() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "c4_evidence_different_denials";
        let user = "c4-evidence-different-denials@example.com";
        let checker = fake_checker();
        checker.set_list_mode(user, ListMode::Shadow);
        checker.set_shadow_sample(user, 1.0);
        checker.list_extra_once(user, StreamType::Traces, "new_only");
        // The RUM row makes the load list Logs before the later grant, so the answers disagree.
        let summaries = [row(org, "traces", "t1"), row(org, "rum", "_rumdata")];
        let readable = ReadableStreams::load(org, user, &summaries, RumReads::Summaries)
            .await
            .unwrap();
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
        assert_eq!(compared.get(), before + 2);
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
        let readable =
            ReadableStreams::load(org, user, &[row(org, "traces", "t1")], RumReads::Summaries)
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

    #[tokio::test]
    async fn a_rum_compare_reads_granted_rumdata_without_a_rum_summary() {
        let _serial = SHADOW_TESTS.lock().await;
        let org = "identity_rum_compare";
        let summaries = [row(org, "traces", "t1")];
        let rum_reads =
            RumReads::for_compare(&[serde_json::json!("traces"), serde_json::json!("rum")]);
        let checker = fake_checker();

        for mode in [ListMode::Off, ListMode::Shadow, ListMode::On] {
            let user = format!("identity-rum-compare-{mode:?}@example.com");
            checker.set_list_mode(&user, mode);
            checker.set_shadow_sample(&user, 1.0);
            checker.set_small_request_objects(&user, SMALL_REQUEST_OBJECTS);
            checker.grant_read(
                &user,
                &TypedStream {
                    org_id: org.into(),
                    stream_type: StreamType::Logs,
                    name: "_rumdata".into(),
                },
            );

            let readable = ReadableStreams::load(org, &user, &summaries, rum_reads)
                .await
                .unwrap();
            assert!(readable.rum, "{mode:?} must include granted _rumdata");
            assert!(readable.traces.is_empty());
            if mode == ListMode::Off {
                assert_eq!(checker.calls(&user).streams, 2);
            }
        }
    }

    #[tokio::test]
    async fn a_compare_without_rum_and_a_summary_only_load_skip_rumdata() {
        let org = "identity_compare_no_rum";
        let summaries = [row(org, "traces", "t1")];
        let rum_reads = RumReads::for_compare(&[serde_json::json!("traces")]);
        assert_eq!(rum_reads, RumReads::Summaries);
        assert_eq!(
            RumReads::for_compare(&[serde_json::json!("rum")]),
            RumReads::Raw
        );
        let checker = fake_checker();

        for mode in [ListMode::Off, ListMode::On] {
            let user = format!("identity-compare-no-rum-{mode:?}@example.com");
            checker.set_list_mode(&user, mode);
            checker.set_small_request_objects(&user, SMALL_REQUEST_OBJECTS);
            for (stream_type, name) in [(StreamType::Logs, "_rumdata"), (StreamType::Traces, "t1")]
            {
                checker.grant_read(
                    &user,
                    &TypedStream {
                        org_id: org.into(),
                        stream_type,
                        name: name.into(),
                    },
                );
            }
            checker.fail_stream_read_once(&user, "_rumdata");

            let readable = ReadableStreams::load(org, &user, &summaries, rum_reads)
                .await
                .unwrap();
            assert!(!readable.rum);
            assert_eq!(readable.traces, HashSet::from(["t1".to_string()]));
            assert_eq!(checker.calls(&user).streams, 1);
        }
    }
}
