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

//! Resume of a stopped RCA run (README §9, J7): which run may be resumed, and the seed
//! a resumed run starts from. [prepare_resume] only reads; the route starts the new run
//! with `context_used.resumed_from` ([ResumeSeed::resumed_from]) in its row, and the
//! launch (`incidents::trigger_rca_for_incident` with a seed) forks the session.

use config::meta::alerts::rca_runs::{RunMode, RunState, RunSubjectType, RunTrigger};
use infra::table::{
    ai_chat_sessions::{self, NO_SEQ, STATUS_ACTIVE},
    ai_chat_turns, alert_incidents,
    rca_runs::{self as runs_table, Model as RunRow},
};
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;
use serde::Serialize;
use serde_json::{Value, json};
use utoipa::ToSchema;

use super::{
    rca_runs::{
        ERROR_AGENT_NOT_CONFIGURED, ERROR_L0_OFF, ERROR_PERSISTENCE_FAILED, ERROR_RCA_DISABLED,
        ERROR_RESUME_FAILED, ERROR_TRANSCRIPT_DELETED, ERROR_USAGE_DENIED,
    },
    rca_turn::RcaTurnError,
};
use crate::ai_chat::{
    ReadError,
    fork::{ResumeRefusal, plan_resume},
    read_committed_events,
};

/// Run `error.code`s after which nothing can be reused, besides the turn start codes: the
/// transcript is gone or was never written, or no turn ever ran.
const NOT_RESUMABLE_CODES: [&str; 6] = [
    ERROR_TRANSCRIPT_DELETED,
    ERROR_PERSISTENCE_FAILED,
    ERROR_USAGE_DENIED,
    ERROR_RCA_DISABLED,
    ERROR_L0_OFF,
    ERROR_AGENT_NOT_CONFIGURED,
];

/// A step of the source run, as the thread names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ResumeStep {
    /// 1-based, counted over the run's `record_step` calls.
    pub index: u32,
    /// One of the seven stages; empty when the step named none.
    pub stage: String,
    pub title: String,
}

/// What a resumed run starts from: the source run's session and its events up to the cut.
#[derive(Debug, Clone)]
pub struct ResumeSeed {
    pub source_run_id: String,
    pub source_session: ai_chat_sessions::Model,
    /// Events `0..=cut_seq`, unmodified; the fork rewrites their ids.
    pub prefix: Vec<DurableEvent>,
    pub cut_seq: i64,
    /// Finished steps the prefix keeps.
    pub reused_steps: u32,
    /// The dropped step the resumed run does first.
    pub from_step: ResumeStep,
    /// The source run's mode.
    pub mode: RunMode,
}

impl ResumeSeed {
    /// The resumed run's `context_used.resumed_from`: `{run_id, steps, from_step}`.
    pub fn resumed_from(&self) -> Value {
        json!({
            "run_id": self.source_run_id,
            "steps": self.reused_steps,
            "from_step": self.from_step,
        })
    }
}

/// Why a run cannot be resumed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResumeError {
    /// 404: unknown incident or run, or a run of another incident.
    NotFound,
    /// 409 `not_resumable`, with the message for the user.
    NotResumable(String),
    /// 409 `nothing_to_resume`: no step finished.
    NothingToResume,
    /// 410 `transcript_expired`.
    TranscriptExpired,
    /// 503 `history_unavailable`: the transcript could not be read now; a retry may work.
    Unavailable(String),
    /// 500.
    Internal(String),
}

/// The seed of a Resume of `run_id` (J7): the incident's latest run (or the run a failed
/// Resume that never ran a turn tried to resume), an incident run that failed or was
/// cancelled with a session, an error that leaves something to reuse, a readable
/// transcript with at least one finished step and no committed report. Reads the runs
/// and one bounded copy of the committed events; writes nothing.
pub async fn prepare_resume(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
) -> Result<ResumeSeed, ResumeError> {
    prepare_resume_with(
        org_id,
        incident_id,
        run_id,
        async |source: &ai_chat_sessions::Model| read_committed_events(source, NO_SEQ).await,
    )
    .await
}

/// [prepare_resume] reading the source's committed events with `read_events`.
async fn prepare_resume_with<R>(
    org_id: &str,
    incident_id: &str,
    run_id: &str,
    read_events: R,
) -> Result<ResumeSeed, ResumeError>
where
    R: AsyncFnOnce(&ai_chat_sessions::Model) -> Result<Vec<DurableEvent>, ReadError>,
{
    // The primary: the run may have ended just now.
    let incident = alert_incidents::get_rw(org_id, incident_id)
        .await
        .map_err(internal)?
        .ok_or(ResumeError::NotFound)?;
    let run = runs_table::get_rw(org_id, run_id)
        .await
        .map_err(internal)?
        .filter(|run| run.incident_id.as_deref() == Some(incident_id))
        .ok_or(ResumeError::NotFound)?;
    let latest = match incident.rca_run_id.as_deref() {
        Some(latest) if latest == run_id => true,
        Some(latest) => is_transparent_resume_of(org_id, latest, run_id).await?,
        None => false,
    };
    let (session_id, mode) = check_resumable(latest, &run)?;

    let source = match ai_chat_sessions::get(org_id, session_id)
        .await
        .map_err(internal)?
    {
        Some(source) if source.status == STATUS_ACTIVE => source,
        _ => return Err(ResumeError::TranscriptExpired),
    };
    if source.last_committed_seq == NO_SEQ {
        return Err(ResumeError::NothingToResume);
    }
    let mut events = read_events(&source).await.map_err(|e| match e {
        // An ended run's history never grows again: a missing or bad event is final.
        ReadError::Gap { .. } | ReadError::Divergence { .. } | ReadError::Corrupt(_) => {
            ResumeError::TranscriptExpired
        }
        ReadError::NoTimeRange | ReadError::Search(_) => ResumeError::Unavailable(e.to_string()),
    })?;
    let plan = plan_resume(&events).map_err(|refusal| match refusal {
        ResumeRefusal::ReportSubmitted => ResumeError::NotResumable(
            "This analysis already submitted its report; re-analyze instead".to_string(),
        ),
        ResumeRefusal::NoFinishedStep => ResumeError::NothingToResume,
    })?;
    // Committed events are contiguous from seq 0, so the kept ones are the first cut+1.
    events.truncate(usize::try_from(plan.cut_seq + 1).unwrap_or(0));

    Ok(ResumeSeed {
        source_run_id: run.run_id,
        source_session: source,
        prefix: events,
        cut_seq: plan.cut_seq,
        reused_steps: plan.reused_steps,
        from_step: ResumeStep {
            index: plan.from_step.index,
            stage: plan.from_step.stage.unwrap_or_default().to_string(),
            title: plan.from_step.title,
        },
        mode,
    })
}

/// Whether the incident's latest run `latest_id` is a Resume of `run_id` that ended
/// (`failed` or `cancelled`) without running a turn on its fork: a failed one whose launch
/// failed (`resume_failed` or a start code), or either state with no session or a session
/// that holds nothing past the copied events. Such a run hides nothing of the source, so
/// the source stays resumable.
async fn is_transparent_resume_of(
    org_id: &str,
    latest_id: &str,
    run_id: &str,
) -> Result<bool, ResumeError> {
    let Some(latest) = runs_table::get_rw(org_id, latest_id)
        .await
        .map_err(internal)?
    else {
        return Ok(false);
    };
    let item = runs_table::to_item(&latest);
    let resumes_run = latest
        .context_used
        .as_ref()
        .and_then(|used| used["resumed_from"]["run_id"].as_str())
        == Some(run_id);
    if item.trigger != RunTrigger::Resume
        || !matches!(item.state, RunState::Failed | RunState::Cancelled)
        || !resumes_run
    {
        return Ok(false);
    }
    // A cancel carries no error code; only a failed launch names why no turn ran.
    if item.state == RunState::Failed
        && error_code(&latest)
            .is_some_and(|code| code == ERROR_RESUME_FAILED || RcaTurnError::is_start_code(code))
    {
        return Ok(true);
    }
    let Some(session_id) = latest.session_id.as_deref() else {
        return Ok(true);
    };
    let primary = infra::db::get_orm_client_rw().await;
    let Some(session) = ai_chat_sessions::get_with(primary, org_id, session_id)
        .await
        .map_err(internal)?
    else {
        return Ok(true);
    };
    let turns = ai_chat_turns::list_for_session_with(primary, org_id, session_id)
        .await
        .map_err(internal)?;
    // The fork's first turn was admitted right after the copied events.
    Ok(match turns.first().and_then(|turn| turn.start_seq) {
        Some(start_seq) => session.last_committed_seq < start_seq,
        None => true,
    })
}

/// J7 on the run row alone: the session id and mode of a run that may be resumed.
/// `latest`: the run is the incident's latest, or only a transparent Resume follows it.
fn check_resumable(latest: bool, run: &RunRow) -> Result<(&str, RunMode), ResumeError> {
    let item = runs_table::to_item(run);
    if item.subject_type != RunSubjectType::Incident || !latest {
        return Err(not_resumable(
            "Only the latest analysis of the incident can be resumed",
        ));
    }
    if !matches!(item.state, RunState::Failed | RunState::Cancelled) {
        return Err(not_resumable(
            "Only a failed or cancelled analysis can be resumed",
        ));
    }
    if error_code(run).is_some_and(|code| {
        RcaTurnError::is_start_code(code) || NOT_RESUMABLE_CODES.contains(&code)
    }) {
        return Err(not_resumable(
            "This analysis stopped before anything could be reused",
        ));
    }
    let Some(session_id) = run.session_id.as_deref() else {
        return Err(not_resumable("This analysis has no transcript to resume"));
    };
    Ok((session_id, item.mode))
}

fn error_code(run: &RunRow) -> Option<&str> {
    run.error
        .as_ref()
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
}

fn not_resumable(message: &str) -> ResumeError {
    ResumeError::NotResumable(message.to_string())
}

fn internal(e: impl std::fmt::Display) -> ResumeError {
    ResumeError::Internal(e.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use infra::table::{
        ai_chat_sessions::{STATUS_DELETED, TITLE_FROM_PROMPT},
        entity::{ai_chat_sessions as session_rows, ai_chat_turns as turn_rows},
    };
    use o2_enterprise::enterprise::ai::client::RCA_AGENT_TYPE;
    use sea_orm::{ActiveModelTrait, EntityTrait};

    use super::*;
    use crate::{
        ai_chat::{
            admission::TURN_LIMIT,
            fork::tests::{THREE_STEPS_CUT, three_steps},
            rca_thread::tests::Session,
        },
        alerts::rca_runs::{
            self, ERROR_AGENT_ERROR, ERROR_AGENT_UNAVAILABLE, ERROR_CREDENTIALS, ERROR_INTERRUPTED,
            ERROR_NO_REPORT, ERROR_TIMEOUT, RESUME_FAILED_REASON, RunPatch, StartOutcome, StartRun,
            complete_run, fail_run, start_run,
            tests::{add_incident, cancel_write, db, incident_start, new_incident, stored},
        },
    };

    type Prepared = Result<ResumeSeed, ResumeError>;

    /// SysRcaAgent's `sre-rca` chat, committed up to `last_seq`.
    pub(crate) fn session_row(
        org_id: &str,
        session_id: &str,
        last_seq: i64,
        status: &str,
    ) -> ai_chat_sessions::Model {
        let committed = last_seq != NO_SEQ;
        session_rows::Model {
            org_id: org_id.to_string(),
            session_id: session_id.to_string(),
            user_id: "sys-rca-agent-id".to_string(),
            user_email: "sre-agent@rca.openobserve.ai".to_string(),
            opencode_session_id: Some("ses_0817c5614ffea1NfBrR9UndbIa".to_string()),
            agent_type: RCA_AGENT_TYPE.to_string(),
            title: "Analyze incident".to_string(),
            title_source: TITLE_FROM_PROMPT.to_string(),
            status: status.to_string(),
            created_at: 1,
            updated_at: 1,
            first_event_at: committed.then_some(1),
            last_event_at: committed.then_some(2),
            last_committed_seq: last_seq,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
        }
    }

    async fn add_session(row: ai_chat_sessions::Model) {
        session_rows::Entity::insert(session_rows::ActiveModel::from(row).reset_all())
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    /// The first turn of `session_id`, admitted after seq `start_seq - 1`.
    async fn add_turn(org_id: &str, session_id: &str, start_seq: i64) {
        let row = turn_rows::Model {
            org_id: org_id.to_string(),
            session_id: session_id.to_string(),
            turn_id: "turn-1".to_string(),
            status: "failed".to_string(),
            error_code: None,
            start_seq: Some(start_seq),
            end_seq: None,
            started_at: 1,
            ended_at: Some(2),
        };
        turn_rows::Entity::insert(turn_rows::ActiveModel::from(row).reset_all())
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    async fn start_with(
        org_id: &str,
        incident_id: &str,
        trigger: RunTrigger,
        mode: RunMode,
    ) -> String {
        let start = StartRun {
            mode,
            ..incident_start(org_id, incident_id, trigger)
        };
        match start_run(start).await.unwrap() {
            StartOutcome::Started { run_id } => run_id,
            other => panic!("the run did not start: {other:?}"),
        }
    }

    async fn with_session(org_id: &str, run_id: &str, session_id: &str) {
        let patch = RunPatch {
            session_id: Some(session_id.to_string()),
            ..Default::default()
        };
        assert!(rca_runs::update_run(org_id, run_id, patch).await.unwrap());
    }

    /// Ends the run failed with `code`, or cancelled (`None`).
    async fn stop(org_id: &str, run_id: &str, trigger: RunTrigger, code: Option<&str>) {
        match code {
            Some(code) => assert!(
                fail_run(org_id, run_id, trigger, code, "stopped", None)
                    .await
                    .unwrap()
            ),
            None => cancel_write(org_id, run_id).await,
        }
    }

    /// A "Build on previous" run of the incident that committed [three_steps] and stopped
    /// with `code` (`None`: cancelled).
    async fn stopped(org_id: &str, incident_id: &str, code: Option<&str>) -> String {
        let run_id = start_with(
            org_id,
            incident_id,
            RunTrigger::Manual,
            RunMode::BuildOnPrevious,
        )
        .await;
        let session_id = format!("ses-{run_id}");
        with_session(org_id, &run_id, &session_id).await;
        let last = three_steps().len() as i64 - 1;
        add_session(session_row(org_id, &session_id, last, STATUS_ACTIVE)).await;
        stop(org_id, &run_id, RunTrigger::Manual, code).await;
        run_id
    }

    /// [prepare_resume_with] reading `read`, and how often it read.
    async fn prepare(
        org_id: &str,
        incident_id: &str,
        run_id: &str,
        read: Result<Vec<DurableEvent>, ReadError>,
    ) -> (Prepared, usize) {
        let reads = AtomicUsize::new(0);
        let result = prepare_resume_with(
            org_id,
            incident_id,
            run_id,
            async |_source: &ai_chat_sessions::Model| {
                reads.fetch_add(1, Ordering::SeqCst);
                read
            },
        )
        .await;
        (result, reads.load(Ordering::SeqCst))
    }

    async fn prepare_three(org_id: &str, incident_id: &str, run_id: &str) -> Prepared {
        prepare(org_id, incident_id, run_id, Ok(three_steps()))
            .await
            .0
    }

    fn not_resumable(result: &Prepared) -> bool {
        matches!(result, Err(ResumeError::NotResumable(_)))
    }

    /// J7: only the incident's latest run, failed or cancelled with a code that leaves
    /// something to reuse and with a session, is resumed; the run is checked before the
    /// transcript is read.
    #[tokio::test]
    async fn only_the_latest_stopped_run_with_a_session_is_resumable() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run = stopped(&org, &inc, Some(ERROR_AGENT_ERROR)).await;
        let other = add_incident(&org, None).await;
        let (other_org, _) = new_incident(None).await;
        for (org_id, incident, run_id) in [
            (org.as_str(), "missing", run.as_str()),
            (org.as_str(), inc.as_str(), "missing"),
            (org.as_str(), other.as_str(), run.as_str()),
            (other_org.as_str(), inc.as_str(), run.as_str()),
        ] {
            let (result, reads) = prepare(org_id, incident, run_id, Ok(three_steps())).await;
            assert!(
                matches!(result, Err(ResumeError::NotFound)),
                "{org_id}/{incident}/{run_id}: {result:?}"
            );
            assert_eq!(reads, 0);
        }

        let start_codes = [
            TURN_LIMIT,
            ERROR_CREDENTIALS,
            ERROR_AGENT_UNAVAILABLE,
            RcaTurnError::Busy.error_code(),
        ];
        for code in start_codes.into_iter().chain(NOT_RESUMABLE_CODES) {
            let (org, inc) = new_incident(None).await;
            let run = stopped(&org, &inc, Some(code)).await;
            let (result, reads) = prepare(&org, &inc, &run, Ok(three_steps())).await;
            assert!(not_resumable(&result), "{code}: {result:?}");
            assert_eq!(reads, 0, "{code}");
        }
        for code in [
            Some(ERROR_AGENT_ERROR),
            Some(ERROR_TIMEOUT),
            Some(ERROR_INTERRUPTED),
            Some(ERROR_NO_REPORT),
            Some(runs_table::STALE_ERROR_CODE),
            None,
        ] {
            let (org, inc) = new_incident(None).await;
            let run = stopped(&org, &inc, code).await;
            let (result, reads) = prepare(&org, &inc, &run, Ok(three_steps())).await;
            assert!(result.is_ok(), "{code:?}: {result:?}");
            assert_eq!(reads, 1);
        }

        // Still running, or completed.
        let (org, inc) = new_incident(None).await;
        let running = start_with(&org, &inc, RunTrigger::Manual, RunMode::Fresh).await;
        with_session(&org, &running, "ses-running").await;
        add_session(session_row(&org, "ses-running", 17, STATUS_ACTIVE)).await;
        assert!(not_resumable(&prepare_three(&org, &inc, &running).await));
        assert!(
            complete_run(&org, &running, "## Root cause", RunPatch::default())
                .await
                .unwrap()
        );
        assert!(not_resumable(&prepare_three(&org, &inc, &running).await));

        // Not the latest.
        let (org, inc) = new_incident(None).await;
        let older = stopped(&org, &inc, Some(ERROR_TIMEOUT)).await;
        let latest = stopped(&org, &inc, Some(ERROR_TIMEOUT)).await;
        let (result, reads) = prepare(&org, &inc, &older, Ok(three_steps())).await;
        assert!(not_resumable(&result), "{result:?}");
        assert_eq!(reads, 0);
        assert!(prepare_three(&org, &inc, &latest).await.is_ok());

        // No session.
        let (org, inc) = new_incident(None).await;
        let bare = start_with(&org, &inc, RunTrigger::Manual, RunMode::Fresh).await;
        stop(&org, &bare, RunTrigger::Manual, Some(ERROR_AGENT_ERROR)).await;
        assert!(not_resumable(&prepare_three(&org, &inc, &bare).await));
    }

    /// J7: a transcript that is gone or broken is expired (410); one that cannot be read now
    /// is unavailable (503); a session that committed nothing has nothing to resume.
    #[tokio::test]
    async fn a_missing_or_unreadable_transcript_is_expired_or_unavailable() {
        let _db = db().await;
        for (last, status, expected) in [
            (None, STATUS_ACTIVE, ResumeError::TranscriptExpired),
            (Some(17), STATUS_DELETED, ResumeError::TranscriptExpired),
            (Some(NO_SEQ), STATUS_ACTIVE, ResumeError::NothingToResume),
        ] {
            let (org, inc) = new_incident(None).await;
            let run = start_with(&org, &inc, RunTrigger::Manual, RunMode::Fresh).await;
            with_session(&org, &run, "ses-1").await;
            if let Some(last) = last {
                add_session(session_row(&org, "ses-1", last, status)).await;
            }
            stop(&org, &run, RunTrigger::Manual, Some(ERROR_TIMEOUT)).await;
            let (result, reads) = prepare(&org, &inc, &run, Ok(three_steps())).await;
            assert_eq!(result.unwrap_err(), expected, "{last:?} {status}");
            assert_eq!(reads, 0);
        }

        let (org, inc) = new_incident(None).await;
        let run = stopped(&org, &inc, Some(ERROR_TIMEOUT)).await;
        let errors = [
            (
                ReadError::Gap {
                    expected: 4,
                    found: None,
                },
                true,
            ),
            (
                ReadError::Divergence {
                    seq: 4,
                    a: "sha256:a".to_string(),
                    b: "sha256:b".to_string(),
                },
                true,
            ),
            (ReadError::Corrupt("bad hash".to_string()), true),
            (ReadError::Search("search is down".to_string()), false),
            (ReadError::NoTimeRange, false),
        ];
        for (error, expired) in errors {
            let label = error.to_string();
            let (result, reads) = prepare(&org, &inc, &run, Err(error)).await;
            assert_eq!(reads, 1);
            match result {
                Err(ResumeError::TranscriptExpired) => assert!(expired, "{label}"),
                Err(ResumeError::Unavailable(_)) => assert!(!expired, "{label}"),
                other => panic!("{label}: {other:?}"),
            }
        }
    }

    /// J7, J8: the seed is the source's events up to the last step's message, its finished
    /// steps, the step to redo and the source's mode; a committed report or a single step
    /// is refused.
    #[tokio::test]
    async fn the_seed_keeps_the_events_before_the_last_steps_message() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let run = stopped(&org, &inc, Some(ERROR_TIMEOUT)).await;
        let events = three_steps();

        let seed = prepare(&org, &inc, &run, Ok(events.clone()))
            .await
            .0
            .unwrap();

        assert_eq!(seed.source_run_id, run);
        assert_eq!(seed.source_session.session_id, format!("ses-{run}"));
        assert_eq!(seed.cut_seq, THREE_STEPS_CUT);
        assert_eq!(seed.prefix, events[..=THREE_STEPS_CUT as usize]);
        assert_eq!(seed.reused_steps, 2);
        assert_eq!(
            seed.from_step,
            ResumeStep {
                index: 3,
                stage: "changes".to_string(),
                title: "Check recent deploys".to_string(),
            }
        );
        assert_eq!(seed.mode, RunMode::BuildOnPrevious);
        assert_eq!(
            seed.resumed_from(),
            json!({
                "run_id": run,
                "steps": 2,
                "from_step": {"index": 3, "stage": "changes", "title": "Check recent deploys"},
            })
        );

        let mut reported = Session { events };
        reported.tool(
            "msg_a3",
            "prt_p1",
            "submit_report",
            "completed",
            json!({"markdown": "## Root cause"}),
            json!({}),
            5_000,
            5_001,
        );
        let (result, _) = prepare(&org, &inc, &run, Ok(reported.events)).await;
        assert!(not_resumable(&result), "{result:?}");

        let single: Vec<DurableEvent> = three_steps()[..=8].to_vec();
        let (result, _) = prepare(&org, &inc, &run, Ok(single)).await;
        assert_eq!(result.unwrap_err(), ResumeError::NothingToResume);
    }

    /// Review M1: a Resume that failed before its fork ran a turn hides nothing; the
    /// source it names stays resumable, and the failed Resume keeps its lineage.
    #[tokio::test]
    async fn a_resume_that_failed_to_launch_leaves_its_source_resumable() {
        let _db = db().await;
        let (org, inc) = new_incident(None).await;
        let source = stopped(&org, &inc, Some(ERROR_TIMEOUT)).await;
        let seed = prepare_three(&org, &inc, &source).await.unwrap();
        let start = StartRun {
            mode: seed.mode,
            context_used: Some(json!({"resumed_from": seed.resumed_from()})),
            ..incident_start(&org, &inc, RunTrigger::Resume)
        };
        let StartOutcome::Started { run_id: resumed } = start_run(start).await.unwrap() else {
            panic!("the resume did not start");
        };
        assert!(
            not_resumable(&prepare_three(&org, &inc, &source).await),
            "not while the resume runs"
        );

        assert_eq!(
            stored(&org, &resumed).await.context_used,
            Some(json!({"resumed_from": seed.resumed_from()}))
        );
        assert!(
            fail_run(
                &org,
                &resumed,
                RunTrigger::Resume,
                ERROR_RESUME_FAILED,
                RESUME_FAILED_REASON,
                Some("the stream refused the batch".to_string()),
            )
            .await
            .unwrap()
        );
        let failed = stored(&org, &resumed).await;
        assert_eq!(failed.state, RunState::Failed);
        assert_eq!(failed.error.unwrap().code, ERROR_RESUME_FAILED);
        assert_eq!(
            failed.context_used.unwrap()["resumed_from"],
            seed.resumed_from(),
            "the lineage stays"
        );

        let again = prepare_three(&org, &inc, &source).await.unwrap();
        assert_eq!(
            (again.source_run_id.as_str(), again.cut_seq),
            (source.as_str(), seed.cut_seq)
        );
        assert!(
            not_resumable(&prepare_three(&org, &inc, &resumed).await),
            "the failed resume has no transcript of its own"
        );
    }

    /// How the fork of a Resume got before the Resume ended.
    #[derive(Debug, Clone, Copy)]
    enum Fork {
        /// The run never named a session.
        NoSession,
        /// The run names a session that has no row.
        NoRow,
        /// The copy is committed; no turn was admitted.
        Copied,
        /// A turn was admitted after the copy and committed nothing.
        Admitted,
        /// A turn committed events past the copy.
        Committed,
    }

    /// Review M1: the source stays resumable only while the latest run is a failed or
    /// cancelled Resume of it whose fork never committed a turn of its own.
    #[tokio::test]
    async fn only_a_resume_that_ran_no_turn_is_transparent() {
        let _db = db().await;
        let cut = THREE_STEPS_CUT;
        // (case, trigger, names the source, fork, end: None running / Some(None) cancelled /
        // Some(Some(code)) failed, transparent)
        let resume = RunTrigger::Resume;
        type Case<'a> = (
            &'a str,
            RunTrigger,
            bool,
            Fork,
            Option<Option<&'a str>>,
            bool,
        );
        let cases: [Case; 12] = [
            (
                "failed: launch failed",
                resume,
                true,
                Fork::NoSession,
                Some(Some(ERROR_RESUME_FAILED)),
                true,
            ),
            (
                "failed: start code after the first write",
                resume,
                true,
                Fork::Copied,
                Some(Some(ERROR_CREDENTIALS)),
                true,
            ),
            (
                "failed: fork session never written",
                resume,
                true,
                Fork::NoRow,
                Some(Some(ERROR_AGENT_ERROR)),
                true,
            ),
            (
                "failed: turn admitted, nothing committed",
                resume,
                true,
                Fork::Admitted,
                Some(Some(ERROR_AGENT_ERROR)),
                true,
            ),
            (
                "failed: turn committed past the copy",
                resume,
                true,
                Fork::Committed,
                Some(Some(ERROR_TIMEOUT)),
                false,
            ),
            (
                "cancelled: no session",
                resume,
                true,
                Fork::NoSession,
                Some(None),
                true,
            ),
            (
                "cancelled: fork session never written",
                resume,
                true,
                Fork::NoRow,
                Some(None),
                true,
            ),
            (
                "cancelled: turn admitted, nothing committed",
                resume,
                true,
                Fork::Admitted,
                Some(None),
                true,
            ),
            (
                "cancelled: turn committed past the copy",
                resume,
                true,
                Fork::Committed,
                Some(None),
                false,
            ),
            (
                "a resume of another run",
                resume,
                false,
                Fork::NoSession,
                Some(Some(ERROR_RESUME_FAILED)),
                false,
            ),
            (
                "a manual run naming the source",
                RunTrigger::Manual,
                true,
                Fork::NoSession,
                Some(Some(ERROR_RESUME_FAILED)),
                false,
            ),
            (
                "a resume that is still running",
                resume,
                true,
                Fork::NoSession,
                None,
                false,
            ),
        ];
        for (case, trigger, names_source, fork_state, end, transparent) in cases {
            let (org, inc) = new_incident(None).await;
            let source = stopped(&org, &inc, Some(ERROR_TIMEOUT)).await;
            let seed = prepare_three(&org, &inc, &source).await.unwrap();
            let resumed = start_with(&org, &inc, trigger, seed.mode).await;
            let lineage = if names_source {
                json!({"resumed_from": seed.resumed_from(), "toolsets": []})
            } else {
                json!({"resumed_from": {"run_id": "another-run", "steps": 2}})
            };
            let fork = format!("fork-{resumed}");
            let patch = RunPatch {
                context_used: Some(lineage),
                session_id: (!matches!(fork_state, Fork::NoSession)).then(|| fork.clone()),
                ..Default::default()
            };
            assert!(rca_runs::update_run(&org, &resumed, patch).await.unwrap());
            match fork_state {
                Fork::NoSession | Fork::NoRow => {}
                Fork::Copied => add_session(session_row(&org, &fork, cut, STATUS_ACTIVE)).await,
                Fork::Admitted => {
                    add_session(session_row(&org, &fork, cut, STATUS_ACTIVE)).await;
                    add_turn(&org, &fork, cut + 1).await;
                }
                Fork::Committed => {
                    add_session(session_row(&org, &fork, cut + 3, STATUS_ACTIVE)).await;
                    add_turn(&org, &fork, cut + 1).await;
                }
            }
            if let Some(code) = end {
                stop(&org, &resumed, trigger, code).await;
            }

            let (result, _) = prepare(&org, &inc, &source, Ok(three_steps())).await;
            if transparent {
                assert!(result.is_ok(), "{case}: {result:?}");
            } else {
                assert!(not_resumable(&result), "{case}: {result:?}");
            }
        }
    }
}
