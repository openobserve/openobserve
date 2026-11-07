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

//! The thread, summary and steering of an RCA run, for its GET routes and its live stream.

use std::{
    collections::{BTreeMap, HashMap},
    hash::{DefaultHasher, Hash, Hasher},
    sync::OnceLock,
    time::Duration,
};

use config::{
    meta::{
        alerts::{
            rca_runs::RunState,
            rca_steering::{SteerRecord, SteerStatus},
        },
        oncall::rca_run::{self, RcaRunRecord, RcaRunSummary},
    },
    metrics::RCA_LIVE_STREAMS,
};
use http::StatusCode;
use infra::table::{
    ai_chat_sessions::{self, Model as SessionRow},
    ai_chat_turns, alert_incidents,
    entity::alert_incidents::Model as IncidentRow,
    rca_runs::{self as runs_table, Model as RunRow},
    rca_steering as steering_table,
};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde::Serialize;
use tokio::sync::OnceCell;

use super::{
    rca_runs,
    rca_steering::{build_steering_view, steering_reads_transcript},
    rca_turn::RcaTurnError,
};
use crate::ai_chat::{
    CommittedPrefix, ReadError, fork,
    rca_ledger::{RunTranscript, decode_run},
    rca_thread::{self, RcaThread, Transcript},
    read_committed_prefix,
};

/// How often the node that holds a live stream reads the change markers.
pub const LIVE_PROBE_INTERVAL: Duration = Duration::from_secs(1);
/// A live stream closes after this long without `end`; the client reconnects.
pub const LIVE_STREAM_MAX: Duration = Duration::from_secs(300);
/// A heartbeat after this long with no output.
const HEARTBEAT_AFTER: Duration = Duration::from_secs(15);
/// A failed transcript read is retried after this long, changed or not.
const READ_RETRY_AFTER: Duration = Duration::from_secs(5);
/// How long a terminal run may wait for its stored record.
const SETTLE_WITHIN: Duration = Duration::from_secs(30);

/// The status and message a part's GET route answers with when it cannot build the part.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartError {
    pub status: StatusCode,
    pub error_code: Option<&'static str>,
    pub message: String,
}

/// The chat session behind a run's transcript.
#[derive(Debug, Clone)]
pub enum RunSession {
    /// The run has no transcript: it predates the thread, or its turn never started.
    None,
    /// The run had a session, and the session is gone.
    Expired,
    Present(Box<SessionRow>),
}

/// Reads the committed events of a session; a lost tail returns the prefix before it.
pub trait TranscriptReader: Sync {
    fn read(
        &self,
        session: &SessionRow,
    ) -> impl Future<Output = Result<CommittedPrefix, ReadError>> + Send;
}

/// The chat-events stream of this cluster.
pub struct StoreReader;

/// One run's parts; the transcript is read and decoded at most once, on first use.
pub struct RunParts<'a, R> {
    org_id: &'a str,
    run: &'a RunRow,
    session: &'a RunSession,
    reader: &'a R,
    events: OnceCell<Result<CommittedPrefix, ReadError>>,
    decoded: OnceLock<RunTranscript>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveFrame {
    Event { name: &'static str, data: String },
    Ping,
}

/// What one live stream follows, fixed at connect.
#[derive(Debug, Clone)]
pub struct LiveSpec {
    pub org_id: String,
    pub incident_id: String,
    /// Without a run the stream sends only `rca`, `error` and `end`.
    pub run_id: Option<String>,
    /// The org setting `ai_rca_thread_tool_output`, read once at connect.
    pub show_tool_io: bool,
    /// `can_run_incident_rca` for the user, evaluated once at connect.
    pub can_steer: bool,
}

/// One open live stream in `rca_live_streams`, until dropped.
pub struct OpenStream {
    org_id: String,
}

/// One live stream: a probe of the change markers, then the parts that changed.
pub struct LiveStream<R> {
    spec: LiveSpec,
    reader: R,
    started_us: i64,
    last_output_us: i64,
    incident_mark: Option<IncidentMark>,
    run_mark: Option<RunMark>,
    steer_marks: Option<Vec<SteerMark>>,
    /// After a 410 the stream sends no more `thread` or `summary`.
    transcript_gone: bool,
    /// When a failed transcript read is due again.
    retry_at_us: Option<i64>,
    /// When this stream first saw the run terminal.
    terminal_at_us: Option<i64>,
    /// What [LiveStream::head] left for [LiveStream::tail].
    pending: Option<Pending>,
    sink: Sink,
}

/// The run a probe read, for the half of the probe that reads its transcript.
struct Pending {
    run: RunRow,
    has_session: bool,
    latest_live: bool,
    /// Set when a marker changed: the parts to rebuild.
    rebuild: Option<Rebuild>,
}

struct Rebuild {
    session: RunSession,
    rows: Vec<SteerRecord>,
    /// The incident's latest run, for the steering view.
    latest_run_id: Option<String>,
    /// The head already sent the summary, built from the run row alone.
    summary_sent: bool,
    failure: Option<PartError>,
}

#[derive(Debug, PartialEq, Eq)]
struct IncidentMark {
    run_id: Option<String>,
    state: Option<String>,
    updated_at: Option<i64>,
    stale: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct RunMark {
    updated_at: i64,
    state: String,
    has_result: bool,
    /// `last_committed_seq` and `updated_at` of the session row.
    session: Option<(i64, i64)>,
}

/// A steering row of the fingerprint; a row has no `updated_at`.
#[derive(Debug, PartialEq, Eq)]
struct SteerMark {
    steer_id: String,
    status: SteerStatus,
    delivered_at: Option<i64>,
    read_at: Option<i64>,
    acted_at: Option<i64>,
    opencode_message_id: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum Part {
    /// The thread and the summary.
    Transcript,
    Steering,
    Rca,
}

/// The frames of one tick, and what the stream sent before.
#[derive(Default)]
struct Sink {
    frames: Vec<LiveFrame>,
    /// A hash of the last body sent, by event.
    sent: HashMap<&'static str, u64>,
    /// A hash of the last `error` body sent, by part.
    errors: HashMap<&'static str, u64>,
    done: bool,
}

impl PartError {
    pub fn not_found(message: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            error_code: None,
            message: message.to_string(),
        }
    }

    pub fn internal(error: impl std::fmt::Display) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error_code: None,
            message: error.to_string(),
        }
    }

    /// An unreadable transcript: 410 for a terminal run's corrupt or holed events, else 503.
    pub fn read(run_id: &str, session_id: &str, terminal: bool, error: &ReadError) -> Self {
        match error {
            ReadError::Gap { .. } | ReadError::Divergence { .. } | ReadError::Corrupt(_)
                if terminal =>
            {
                log::warn!(
                    "[INCIDENTS::RCA] thread of run {run_id} (session {session_id}) is incomplete: {error}"
                );
                Self {
                    status: StatusCode::GONE,
                    error_code: Some("transcript_incomplete"),
                    message: "Part of this analysis transcript could not be read".to_string(),
                }
            }
            // Logged and counted by the reader.
            _ => Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                error_code: Some("history_unavailable"),
                message: "This analysis transcript could not be read in full; please retry"
                    .to_string(),
            },
        }
    }

    fn expired() -> Self {
        Self {
            status: StatusCode::GONE,
            error_code: Some("transcript_expired"),
            message: "This analysis transcript has expired".to_string(),
        }
    }
}

impl RunSession {
    /// `row` is the run's session row, if it has one.
    pub fn of(run: &RunRow, row: Option<SessionRow>) -> Self {
        match (run.session_id.as_deref(), row) {
            (None, _) => Self::None,
            (Some(_), Some(row)) => Self::Present(Box::new(row)),
            // A run whose turn never started has its session id but never had a session.
            (Some(_), None) if never_started(run) => Self::None,
            (Some(_), None) => Self::Expired,
        }
    }

    pub async fn load(org_id: &str, run: &RunRow) -> anyhow::Result<Self> {
        let row = match run.session_id.as_deref() {
            Some(session_id) => ai_chat_sessions::get(org_id, session_id).await?,
            None => None,
        };
        Ok(Self::of(run, row))
    }
}

impl TranscriptReader for StoreReader {
    async fn read(&self, session: &SessionRow) -> Result<CommittedPrefix, ReadError> {
        read_committed_prefix(session, -1).await
    }
}

impl<T: TranscriptReader> TranscriptReader for &T {
    fn read(
        &self,
        session: &SessionRow,
    ) -> impl Future<Output = Result<CommittedPrefix, ReadError>> + Send {
        (**self).read(session)
    }
}

/// A lost tail is final only once the run ended; a running run may still be writing it.
fn settle_lost_tail(
    read: Result<CommittedPrefix, ReadError>,
    terminal: bool,
) -> Result<CommittedPrefix, ReadError> {
    match read {
        Ok(CommittedPrefix {
            lost_from: Some(expected),
            ..
        }) if !terminal => Err(ReadError::Gap {
            expected,
            found: None,
        }),
        other => other,
    }
}

impl<'a, R: TranscriptReader> RunParts<'a, R> {
    pub fn new(org_id: &'a str, run: &'a RunRow, session: &'a RunSession, reader: &'a R) -> Self {
        Self {
            org_id,
            run,
            session,
            reader,
            events: OnceCell::new(),
            decoded: OnceLock::new(),
        }
    }

    /// The thread's `state_version`; `None` when the thread is an error.
    pub fn thread_version(&self, show_tool_io: bool) -> Option<String> {
        match self.session {
            RunSession::None => Some(run_version(self.run)),
            RunSession::Expired => None,
            RunSession::Present(session) => Some(session_version(session, self.run, show_tool_io)),
        }
    }

    pub async fn thread(&self, show_tool_io: bool) -> Result<RcaThread, PartError> {
        let state = self.state();
        let active = state.is_some_and(|state| state.is_live());
        let run_id = &self.run.run_id;
        let session = match self.session {
            RunSession::None => {
                return Ok(RcaThread::without_transcript(
                    run_id,
                    run_version(self.run),
                    active,
                    Transcript::None,
                ));
            }
            RunSession::Expired => return Err(PartError::expired()),
            RunSession::Present(session) => session,
        };
        let terminal = state.is_some_and(|state| state.is_terminal());
        let prefix = self
            .events(session)
            .await
            .as_ref()
            .map_err(|e| PartError::read(run_id, &session.session_id, terminal, e))?;
        let turns = ai_chat_turns::list_for_session(self.org_id, &session.session_id)
            .await
            .map_err(PartError::internal)?;
        let mut thread =
            rca_thread::project_rca_thread(&prefix.events, &turns, active, show_tool_io);
        thread.run_id = run_id.clone();
        thread.state_version = session_version(session, self.run, show_tool_io);
        if !active {
            thread.reusable_steps = fork::reusable_steps(&prefix.events);
        }
        if let Some(lost_from) = prefix.lost_from {
            thread.truncated = true;
            thread.saved_through_seq = Some(lost_from - 1);
        }
        Ok(thread)
    }

    /// The summary's `state_version`; `None` when the summary is an error.
    pub fn summary_version(&self) -> Option<String> {
        let state = self.state()?;
        match self.session {
            RunSession::Present(session) if reads_session(self.run, state) => {
                Some(session_version(session, self.run, false))
            }
            RunSession::Expired if !state.is_terminal() => None,
            _ => Some(run_version(self.run)),
        }
    }

    /// The body of GET `…/summary`; `None` rows are read when an author is needed.
    pub async fn summary(
        &self,
        steer_rows: Option<&[SteerRecord]>,
    ) -> Result<RcaRunSummary, PartError> {
        let run = self.run;
        let run_id = &run.run_id;
        let state = run.state.parse::<RunState>().map_err(|_| {
            PartError::internal(format!("run {run_id} has an unknown state {}", run.state))
        })?;

        if state.is_terminal() {
            // Until the record is stored, the same record built from the transcript stands in.
            if reads_session(run, state)
                && let RunSession::Present(session) = self.session
            {
                let transcript = self
                    .decoded(session)
                    .await
                    .map_err(|e| PartError::read(run_id, &session.session_id, true, e))?;
                let authors = steer_authors(self.org_id, run_id, steer_rows).await;
                return Ok(partial_summary(
                    run_id,
                    state,
                    session_version(session, run, false),
                    transcript,
                    &authors,
                    run.ended_at.unwrap_or(run.updated_at),
                ));
            }
            let version = run_version(run);
            return Ok(match run.result.as_deref() {
                Some(result) => match serde_json::from_str::<RcaRunRecord>(result) {
                    Ok(record) => rca_run::summary_from_record(run_id, state, version, &record),
                    Err(e) => {
                        log::warn!(
                            "[INCIDENTS::RCA] run {run_id} has an unreadable result record, serving it as legacy: {e}"
                        );
                        rca_run::summary_legacy(run_id, state, version)
                    }
                },
                None => rca_run::summary_legacy(run_id, state, version),
            });
        }

        let session = match self.session {
            RunSession::None => {
                return Ok(rca_run::summary_live(
                    run_id,
                    state,
                    run_version(run),
                    &[],
                    &[],
                    &BTreeMap::new(),
                ));
            }
            RunSession::Expired => return Err(PartError::expired()),
            RunSession::Present(session) => session,
        };
        let transcript = self
            .decoded(session)
            .await
            .map_err(|e| PartError::read(run_id, &session.session_id, false, e))?;
        let authors = steer_authors(self.org_id, run_id, steer_rows).await;
        Ok(rca_run::summary_live(
            run_id,
            state,
            session_version(session, run, false),
            &transcript.calls,
            &transcript.tool_log,
            &authors,
        ))
    }

    /// The transcript for the steering view; a failed read leaves it out, as GET does.
    pub async fn steering_transcript(&self) -> Option<&RunTranscript> {
        let RunSession::Present(session) = self.session else {
            return None;
        };
        match self.decoded(session).await {
            Ok(transcript) => Some(transcript),
            Err(e) => {
                log::warn!(
                    "[RCA_STEERING] could not read the transcript of run {}: {e:#}",
                    self.run.run_id
                );
                None
            }
        }
    }

    fn state(&self) -> Option<RunState> {
        self.run.state.parse().ok()
    }

    async fn events(&self, session: &SessionRow) -> &Result<CommittedPrefix, ReadError> {
        let terminal = self.state().is_some_and(|state| state.is_terminal());
        self.events
            .get_or_init(
                || async move { settle_lost_tail(self.reader.read(session).await, terminal) },
            )
            .await
    }

    async fn decoded(&self, session: &SessionRow) -> Result<&RunTranscript, &ReadError> {
        let prefix = self.events(session).await.as_ref()?;
        Ok(self.decoded.get_or_init(|| decode_run(&prefix.events)))
    }
}

impl LiveFrame {
    pub fn to_sse(&self) -> String {
        match self {
            Self::Event { name, data } => format!("event: {name}\ndata: {data}\n\n"),
            Self::Ping => ": ping\n\n".to_string(),
        }
    }
}

impl OpenStream {
    pub fn open(org_id: &str) -> Self {
        RCA_LIVE_STREAMS.with_label_values(&[org_id]).inc();
        Self {
            org_id: org_id.to_string(),
        }
    }
}

impl Drop for OpenStream {
    fn drop(&mut self) {
        RCA_LIVE_STREAMS.with_label_values(&[&self.org_id]).dec();
    }
}

impl<R: TranscriptReader> LiveStream<R> {
    pub fn new(spec: LiveSpec, reader: R, now_us: i64) -> Self {
        Self {
            spec,
            reader,
            started_us: now_us,
            last_output_us: now_us,
            incident_mark: None,
            run_mark: None,
            steer_marks: None,
            transcript_gone: false,
            retry_at_us: None,
            terminal_at_us: None,
            pending: None,
            sink: Sink::default(),
        }
    }

    /// The stream sent `end`, or reached [LIVE_STREAM_MAX]; the server closes it.
    pub fn is_done(&self) -> bool {
        self.sink.done
    }

    /// One probe at `now_us`: the frames to send, in order.
    pub async fn tick(&mut self, now_us: i64) -> Vec<LiveFrame> {
        let mut frames = self.head(now_us).await;
        frames.extend(self.tail(now_us).await);
        frames
    }

    /// The first half of a probe: `rca`, and a summary built from the run row alone.
    /// The stream sends it before [Self::tail] reads the transcript, which can take seconds.
    pub async fn head(&mut self, now_us: i64) -> Vec<LiveFrame> {
        if self.sink.done {
            return Vec::new();
        }
        if now_us - self.started_us >= micros(LIVE_STREAM_MAX) {
            self.sink.done = true;
            return Vec::new();
        }
        self.pending = self.probe(now_us).await;
        self.flush(now_us)
    }

    /// The second half: the parts that read the transcript, then `end` or a heartbeat.
    pub async fn tail(&mut self, now_us: i64) -> Vec<LiveFrame> {
        if let Some(pending) = self.pending.take() {
            self.finish(pending, now_us).await;
        }
        if self.sink.frames.is_empty()
            && !self.sink.done
            && now_us - self.last_output_us >= micros(HEARTBEAT_AFTER)
        {
            self.sink.frames.push(LiveFrame::Ping);
        }
        self.flush(now_us)
    }

    fn flush(&mut self, now_us: i64) -> Vec<LiveFrame> {
        let frames = std::mem::take(&mut self.sink.frames);
        if !frames.is_empty() {
            self.last_output_us = now_us;
        }
        frames
    }

    async fn probe(&mut self, now_us: i64) -> Option<Pending> {
        let org_id = self.spec.org_id.as_str();
        let incident = match alert_incidents::get(org_id, &self.spec.incident_id).await {
            Ok(Some(incident)) => incident,
            Ok(None) => {
                let error = PartError::not_found("Incident not found");
                self.sink.send_error(Part::Rca, &error);
                self.sink.end(None);
                return None;
            }
            Err(e) => {
                self.sink.send_error(Part::Rca, &PartError::internal(e));
                return None;
            }
        };

        // `rca` only when the incident part changed; a `stale` flip counts.
        let mark = IncidentMark::of(&incident, now_us);
        if self.incident_mark.as_ref() != Some(&mark) {
            match rca_runs::rca_detail_at(org_id, &incident, now_us).await {
                Ok(rca) => {
                    self.sink.send("rca", &rca);
                    self.sink.clear_error(Part::Rca);
                    self.incident_mark = Some(mark);
                }
                Err(e) => self.sink.send_error(Part::Rca, &PartError::internal(e)),
            }
        }
        // The stream stays while the latest run is live.
        let latest_live = incident
            .rca_state
            .as_deref()
            .and_then(|state| state.parse::<RunState>().ok())
            .is_some_and(|state| state.is_live());

        if self.spec.run_id.is_none() {
            if !latest_live {
                self.sink.end(incident.rca_state);
            }
            return None;
        }
        self.probe_run(&incident, latest_live, now_us).await
    }

    /// Rebuilds the parts whose markers changed, then ends once a terminal run is settled.
    async fn finish(&mut self, pending: Pending, now_us: i64) {
        let Pending {
            run,
            has_session,
            latest_live,
            rebuild,
        } = pending;
        if let Some(rebuild) = rebuild {
            self.rebuild(&run, rebuild, now_us).await;
        }

        // A terminal run is settled by its record, no session, or [SETTLE_WITHIN].
        let terminal = run
            .state
            .parse::<RunState>()
            .is_ok_and(|state| state.is_terminal());
        if !terminal || latest_live {
            return;
        }
        let terminal_at = *self.terminal_at_us.get_or_insert(now_us);
        if run.result.is_some() || !has_session || now_us - terminal_at >= micros(SETTLE_WITHIN) {
            self.sink.end(Some(run.state));
        }
    }

    /// The run and, when a marker changed, the parts to rebuild; `None` when this probe cannot go
    /// on. A summary built from the run row alone goes out now, ahead of the transcript read.
    async fn probe_run(
        &mut self,
        incident: &IncidentRow,
        latest_live: bool,
        now_us: i64,
    ) -> Option<Pending> {
        let org_id = self.spec.org_id.as_str();
        let run_id = self.spec.run_id.as_deref()?;
        let run = match runs_table::get(org_id, run_id).await {
            Ok(Some(run)) if run.incident_id.as_deref() == Some(incident.id.as_str()) => run,
            // Pruned while the stream was open.
            Ok(_) => {
                let error = PartError::not_found("Run not found");
                self.sink.send_error(Part::Transcript, &error);
                self.sink.end(None);
                return None;
            }
            Err(e) => {
                self.sink
                    .send_error(Part::Transcript, &PartError::internal(e));
                return None;
            }
        };
        let session_row = match run.session_id.as_deref() {
            Some(session_id) => match ai_chat_sessions::get(org_id, session_id).await {
                Ok(row) => row,
                Err(e) => {
                    self.sink
                        .send_error(Part::Transcript, &PartError::internal(e));
                    return None;
                }
            },
            None => None,
        };
        let rows = match steering_table::list_for_run(org_id, run_id).await {
            Ok(rows) => rows,
            Err(e) => {
                self.sink
                    .send_error(Part::Steering, &PartError::internal(e));
                return None;
            }
        };
        let has_session = session_row.is_some();

        let run_mark = RunMark::of(&run, session_row.as_ref());
        let steer_marks: Vec<SteerMark> = rows.iter().map(SteerMark::of).collect();
        let retry_due = self.retry_at_us.is_some_and(|at| now_us >= at);
        if self.run_mark.as_ref() == Some(&run_mark)
            && self.steer_marks.as_ref() == Some(&steer_marks)
            && !retry_due
        {
            return Some(Pending {
                run,
                has_session,
                latest_live,
                rebuild: None,
            });
        }
        self.retry_at_us = None;
        self.run_mark = Some(run_mark);
        self.steer_marks = Some(steer_marks);

        let session = RunSession::of(&run, session_row);
        let summary_sent = !self.transcript_gone && !summary_reads_session(&run);
        let failure = if summary_sent {
            let summary = RunParts::new(org_id, &run, &session, &self.reader)
                .summary(Some(&rows))
                .await;
            self.sink.send_part("summary", summary)
        } else {
            None
        };
        Some(Pending {
            run,
            has_session,
            latest_live,
            rebuild: Some(Rebuild {
                session,
                rows,
                latest_run_id: incident.rca_run_id.clone(),
                summary_sent,
                failure,
            }),
        })
    }

    /// One transcript read builds the thread, the summary the head did not send, and the steering
    /// view.
    async fn rebuild(&mut self, run: &RunRow, rebuild: Rebuild, now_us: i64) {
        let Rebuild {
            session,
            rows,
            latest_run_id,
            summary_sent,
            mut failure,
        } = rebuild;
        let parts = RunParts::new(&self.spec.org_id, run, &session, &self.reader);
        if !self.transcript_gone {
            let thread = parts.thread(self.spec.show_tool_io).await;
            failure = self.sink.send_part("thread", thread).or(failure);
            if !summary_sent {
                let summary = parts.summary(Some(&rows)).await;
                failure = failure.or(self.sink.send_part("summary", summary));
            }
        }
        let transcript = if steering_reads_transcript(run, &rows) {
            parts.steering_transcript().await
        } else {
            None
        };
        let steering = build_steering_view(
            latest_run_id.as_deref(),
            run,
            rows,
            transcript,
            self.spec.can_steer,
        );
        self.sink.send("steering", &steering);
        self.sink.clear_error(Part::Steering);

        match failure {
            Some(error) => {
                if error.status == StatusCode::GONE {
                    self.transcript_gone = true;
                } else if error.status.is_server_error() {
                    self.retry_at_us = Some(now_us + micros(READ_RETRY_AFTER));
                }
                self.sink.send_error(Part::Transcript, &error);
            }
            None => self.sink.clear_error(Part::Transcript),
        }
    }
}

impl IncidentMark {
    fn of(incident: &IncidentRow, now_us: i64) -> Self {
        let timeout = get_o2_config().incidents.rca_timeout_secs;
        Self {
            run_id: incident.rca_run_id.clone(),
            state: incident.rca_state.clone(),
            updated_at: incident.rca_updated_at,
            stale: runs_table::summary_from_incident(incident, now_us, timeout)
                .is_some_and(|summary| summary.stale),
        }
    }
}

impl RunMark {
    fn of(run: &RunRow, session: Option<&SessionRow>) -> Self {
        Self {
            updated_at: run.updated_at,
            state: run.state.clone(),
            has_result: run.result.is_some(),
            session: session.map(|s| (s.last_committed_seq, s.updated_at)),
        }
    }
}

impl SteerMark {
    fn of(row: &SteerRecord) -> Self {
        Self {
            steer_id: row.steer_id.clone(),
            status: row.status,
            delivered_at: row.delivered_at,
            read_at: row.read_at,
            acted_at: row.acted_at,
            opencode_message_id: row.opencode_message_id.clone(),
        }
    }
}

impl Part {
    fn as_str(self) -> &'static str {
        match self {
            Self::Transcript => "transcript",
            Self::Steering => "steering",
            Self::Rca => "rca",
        }
    }
}

impl Sink {
    /// A part goes out only when its body differs from the last one sent.
    fn send(&mut self, name: &'static str, value: &impl Serialize) {
        let data = body(value);
        let hash = hash_of(&data);
        if self.sent.insert(name, hash) != Some(hash) {
            self.frames.push(LiveFrame::Event { name, data });
        }
    }

    /// Sends a part that built; a failed one is forgotten and its error returned.
    fn send_part(
        &mut self,
        name: &'static str,
        part: Result<impl Serialize, PartError>,
    ) -> Option<PartError> {
        match part {
            Ok(value) => {
                self.send(name, &value);
                None
            }
            Err(e) => {
                self.forget(name);
                Some(e)
            }
        }
    }

    /// The next build of `name` goes out even when its body did not change.
    fn forget(&mut self, name: &'static str) {
        self.sent.remove(name);
    }

    /// An `error` event, once until the part builds again or the error changes.
    fn send_error(&mut self, part: Part, error: &PartError) {
        let data = serde_json::json!({
            "part": part.as_str(),
            "status": error.status.as_u16(),
            "error_code": error.error_code,
            "message": error.message,
        })
        .to_string();
        let hash = hash_of(&data);
        if self.errors.insert(part.as_str(), hash) != Some(hash) {
            self.frames.push(LiveFrame::Event {
                name: "error",
                data,
            });
        }
    }

    fn clear_error(&mut self, part: Part) {
        self.errors.remove(part.as_str());
    }

    fn end(&mut self, state: Option<String>) {
        self.frames.push(LiveFrame::Event {
            name: "end",
            data: serde_json::json!({ "state": state }).to_string(),
        });
        self.done = true;
    }
}

/// Whether [RunParts::summary] can use the run's session.
pub fn summary_reads_session(run: &RunRow) -> bool {
    run.state
        .parse::<RunState>()
        .is_ok_and(|state| reads_session(run, state))
}

/// A live summary reads the session; so does an ended one until its record is stored.
fn reads_session(run: &RunRow, state: RunState) -> bool {
    !state.is_terminal()
        || (run.result.is_none() && matches!(state, RunState::Failed | RunState::Cancelled))
}

fn never_started(run: &RunRow) -> bool {
    runs_table::error_of(run).is_some_and(|error| RcaTurnError::is_start_code(&error.code))
}

/// The version of a part built from the run row alone.
fn run_version(run: &RunRow) -> String {
    rca_thread::state_version(-1, 0, run.updated_at, false)
}

fn session_version(session: &SessionRow, run: &RunRow, show_tool_io: bool) -> String {
    rca_thread::state_version(
        session.last_committed_seq,
        session.updated_at,
        run.updated_at,
        show_tool_io,
    )
}

/// The run's steer authors by steer id; a failed read only drops the names.
async fn steer_authors(
    org_id: &str,
    run_id: &str,
    rows: Option<&[SteerRecord]>,
) -> BTreeMap<String, String> {
    let by_id = |rows: &[SteerRecord]| {
        rows.iter()
            .map(|row| (row.steer_id.clone(), row.author_email.clone()))
            .collect()
    };
    if let Some(rows) = rows {
        return by_id(rows);
    }
    match steering_table::list_for_run(org_id, run_id).await {
        Ok(rows) => by_id(&rows),
        Err(e) => {
            log::warn!("[INCIDENTS::RCA] steering rows of run {run_id} could not be read: {e}");
            BTreeMap::new()
        }
    }
}

/// The record the finalizer will store for an ended run, built from its transcript.
fn partial_summary(
    run_id: &str,
    state: RunState,
    version: String,
    transcript: &RunTranscript,
    steer_authors: &BTreeMap<String, String>,
    ended_at_us: i64,
) -> RcaRunSummary {
    let end = rca_run::record_run_end(&rca_run::RunEndInput {
        submit: None,
        calls: &transcript.calls,
        tool_log: &transcript.tool_log,
        stages_run: &transcript.stages_run,
        ended_by: rca_run::EndedBy::Agent,
        completed: false,
        steer_authors,
        ended_at_us,
    });
    rca_run::summary_from_record(run_id, state, version, &end.record)
}

fn micros(duration: Duration) -> i64 {
    duration.as_micros() as i64
}

fn body(value: &impl Serialize) -> String {
    serde_json::to_string(value).unwrap_or_else(|e| {
        log::error!("[INCIDENTS::RCA] live stream part did not serialize: {e}");
        "null".to_string()
    })
}

fn hash_of(data: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{
        collections::VecDeque,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use config::{
        meta::alerts::{
            rca_runs::{RunTrigger, stale_threshold_us},
            rca_steering::{SteerKind, SteerStatus},
        },
        utils::{json::json, time::now_micros},
    };
    use infra::table::{
        entity::{ai_chat_sessions as session_rows, rca_runs as run_rows},
        rca_runs::RunUpdate,
        rca_steering::SteerPatch,
    };
    use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;
    use parking_lot::Mutex;
    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};

    use super::*;
    use crate::alerts::{
        rca_runs::{
            complete_run,
            tests::{age, cancel_write, db, new_incident, start},
            update_run,
        },
        rca_steering::guidance_row,
    };

    const SESSION: &str = "ses_live_stream";
    const SEC: i64 = 1_000_000;

    /// The transcript store as a test scripts it: a queue of failures, then `events`.
    struct Reader {
        events: Mutex<Vec<DurableEvent>>,
        failures: Mutex<VecDeque<ReadError>>,
        reads: AtomicUsize,
    }

    impl Reader {
        fn new(events: Vec<DurableEvent>) -> Self {
            Self {
                events: Mutex::new(events),
                failures: Mutex::new(VecDeque::new()),
                reads: AtomicUsize::new(0),
            }
        }

        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }
    }

    impl TranscriptReader for Reader {
        async fn read(&self, _session: &SessionRow) -> Result<CommittedPrefix, ReadError> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            match self.failures.lock().pop_front() {
                Some(error) => Err(error),
                None => Ok(CommittedPrefix {
                    events: self.events.lock().clone(),
                    lost_from: None,
                }),
            }
        }
    }

    #[test]
    fn a_lost_tail_is_served_only_once_the_run_ended() {
        let lost = || {
            Ok(CommittedPrefix {
                events: Vec::new(),
                lost_from: Some(4),
            })
        };
        assert!(matches!(
            settle_lost_tail(lost(), false),
            Err(ReadError::Gap {
                expected: 4,
                found: None
            })
        ));
        assert_eq!(settle_lost_tail(lost(), true).unwrap().lost_from, Some(4));
    }

    fn spec(org: &str, inc: &str, run_id: Option<&str>) -> LiveSpec {
        LiveSpec {
            org_id: org.to_string(),
            incident_id: inc.to_string(),
            run_id: run_id.map(str::to_string),
            show_tool_io: false,
            can_steer: true,
        }
    }

    /// The event names of `frames`; a heartbeat is `ping`.
    fn names(frames: &[LiveFrame]) -> Vec<&'static str> {
        frames
            .iter()
            .map(|frame| match frame {
                LiveFrame::Event { name, .. } => *name,
                LiveFrame::Ping => "ping",
            })
            .collect()
    }

    /// The data of the last `name` event in `frames`.
    fn data(frames: &[LiveFrame], name: &str) -> serde_json::Value {
        frames
            .iter()
            .rev()
            .find_map(|frame| match frame {
                LiveFrame::Event { name: n, data } if *n == name => {
                    Some(serde_json::from_str(data).unwrap())
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("no {name} frame in {frames:?}"))
    }

    async fn insert_session(org: &str, last_committed_seq: i64) {
        let row = session_rows::Model {
            org_id: org.to_string(),
            session_id: SESSION.to_string(),
            user_id: "sys".to_string(),
            user_email: "sys@acme.io".to_string(),
            opencode_session_id: None,
            agent_type: "sre-rca".to_string(),
            title: "Analyze incident".to_string(),
            title_source: "prompt".to_string(),
            status: "active".to_string(),
            created_at: 1_000,
            updated_at: 1_500,
            first_event_at: None,
            last_event_at: None,
            last_committed_seq,
            session_epoch: 1,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
        };
        session_rows::ActiveModel::from(row)
            .reset_all()
            .insert(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    /// The turn commits events: the watermark advances.
    async fn commit(org: &str, last_committed_seq: i64) {
        session_rows::Entity::update_many()
            .col_expr(
                session_rows::Column::LastCommittedSeq,
                Expr::value(last_committed_seq),
            )
            .filter(session_rows::Column::OrgId.eq(org))
            .filter(session_rows::Column::SessionId.eq(SESSION))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    /// A fresh incident with a running run whose session is [SESSION].
    async fn live_run() -> (String, String, String) {
        let (org, inc) = new_incident(None).await;
        let run_id = start(&org, &inc, RunTrigger::Manual).await;
        let patch = RunUpdate {
            session_id: Some(SESSION.to_string()),
            ..Default::default()
        };
        assert!(update_run(&org, &run_id, patch).await.unwrap());
        insert_session(&org, 5).await;
        (org, inc, run_id)
    }

    /// The record the finalizer stores for [hypothesis_events].
    fn record() -> serde_json::Value {
        let transcript = decode_run(&hypothesis_events());
        let end = rca_run::record_run_end(&rca_run::RunEndInput {
            submit: None,
            calls: &transcript.calls,
            tool_log: &transcript.tool_log,
            stages_run: &transcript.stages_run,
            ended_by: rca_run::EndedBy::Agent,
            completed: false,
            steer_authors: &BTreeMap::new(),
            ended_at_us: 0,
        });
        serde_json::to_value(&end.record).unwrap()
    }

    #[tokio::test]
    async fn lu6_a_terminal_run_sends_every_part_once_then_end() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let patch = RunUpdate {
            result: Some(record()),
            ..Default::default()
        };
        assert!(complete_run(&org, &run_id, "report", patch).await.unwrap());
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();

        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        let head = live.head(now).await;
        assert_eq!(names(&head), ["rca", "summary"]);
        assert_eq!(
            reader.reads(),
            0,
            "the stored summary goes out before the read"
        );
        let tail = live.tail(now).await;
        assert_eq!(names(&tail), ["thread", "steering", "end"]);
        let frames = [head, tail].concat();
        assert_eq!(data(&frames, "rca")["run_id"], run_id.as_str());
        assert_eq!(data(&frames, "summary")["state"], "completed");
        assert_eq!(data(&frames, "end"), json!({"state": "completed"}));
        assert!(live.is_done());
        assert_eq!(reader.reads(), 1, "one read builds the thread");
        assert!(live.tick(now + SEC).await.is_empty());

        // A reconnect gets the same snapshots: there is no resume token.
        let mut again = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        assert_eq!(again.tick(now).await, frames);
    }

    #[tokio::test]
    async fn lu1_without_a_run_the_stream_sends_only_rca() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();

        let mut live = LiveStream::new(spec(&org, &inc, None), &reader, now);
        let frames = live.tick(now).await;
        assert_eq!(names(&frames), ["rca"]);
        assert_eq!(data(&frames, "rca")["state"], "running");
        assert!(!live.is_done(), "the latest run is live");

        let patch = RunUpdate {
            result: Some(record()),
            ..Default::default()
        };
        assert!(complete_run(&org, &run_id, "report", patch).await.unwrap());
        let frames = live.tick(now + SEC).await;
        assert_eq!(names(&frames), ["rca", "end"]);
        assert_eq!(data(&frames, "end"), json!({"state": "completed"}));
        assert_eq!(reader.reads(), 0);
    }

    #[tokio::test]
    async fn lu7_lu8_only_a_changed_marker_reads_the_transcript_once() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let mut events = hypothesis_events();
        let later = events.split_off(4);
        let reader = Reader::new(events);
        let now = now_micros();

        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        let frames = live.tick(now).await;
        assert_eq!(names(&frames), ["rca", "thread", "summary", "steering"]);
        assert_eq!(data(&frames, "summary")["state"], "running");
        assert_eq!(reader.reads(), 1);

        for second in 1..=10 {
            assert!(live.tick(now + second * SEC).await.is_empty());
        }
        assert_eq!(reader.reads(), 1, "no write, no transcript read");

        // The turn commits more events: one read rebuilds the thread and the summary.
        reader.events.lock().extend(later);
        commit(&org, 6).await;
        let frames = live.tick(now + 11 * SEC).await;
        assert_eq!(names(&frames), ["thread", "summary"]);
        assert_eq!(reader.reads(), 2);
        let version = data(&frames, "thread")["state_version"].clone();
        assert!(
            version.as_str().unwrap().starts_with("6.1500."),
            "{version}"
        );
        let hypotheses = data(&frames, "summary")["hypotheses"].clone();
        assert_eq!(hypotheses.as_array().map(Vec::len), Some(2), "{hypotheses}");
    }

    #[tokio::test]
    async fn lu9_a_steering_change_sends_steering_and_no_thread() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        live.tick(now).await;

        let mut row = guidance_row(
            &org,
            &run_id,
            &inc,
            "a.rao@acme.io",
            "Check the deploy",
            now,
        );
        row.kind = SteerKind::Message;
        steering_table::insert(&row).await.unwrap();
        let frames = live.tick(now + SEC).await;
        assert_eq!(names(&frames), ["steering"]);
        assert_eq!(data(&frames, "steering")["items"][0]["status"], "queued");

        let delivered = SteerPatch {
            delivered_at: Some(now + SEC),
            ..Default::default()
        };
        assert!(
            steering_table::set_status(&org, &row.steer_id, SteerStatus::Delivered, delivered)
                .await
                .unwrap()
        );
        let frames = live.tick(now + 2 * SEC).await;
        assert_eq!(names(&frames), ["steering"]);
        assert_eq!(data(&frames, "steering")["items"][0]["status"], "delivered");
    }

    #[tokio::test]
    async fn lu10_a_run_that_passes_the_stale_limit_sends_rca_with_stale() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let threshold = stale_threshold_us(get_o2_config().incidents.rca_timeout_secs);
        // The last write was 2 s short of the limit.
        age(&org, &inc, &run_id, threshold / SEC - 2).await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        let frames = live.tick(now).await;
        assert_eq!(data(&frames, "rca")["stale"], false);

        // No write: only the clock passes the limit.
        let frames = live.tick(now + 3 * SEC).await;
        assert_eq!(names(&frames), ["rca"]);
        assert_eq!(data(&frames, "rca")["stale"], true);
        assert_eq!(reader.reads(), 1);
    }

    #[tokio::test]
    async fn lu11_a_failed_read_is_an_error_and_is_read_again_5_s_later() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let reader = Reader::new(hypothesis_events());
        reader
            .failures
            .lock()
            .push_back(ReadError::Search("timeout".to_string()));
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);

        let frames = live.tick(now).await;
        assert_eq!(names(&frames), ["rca", "steering", "error"]);
        assert_eq!(
            data(&frames, "error"),
            json!({
                "part": "transcript",
                "status": 503,
                "error_code": "history_unavailable",
                "message": "This analysis transcript could not be read in full; please retry",
            })
        );
        for second in 1..5 {
            assert!(live.tick(now + second * SEC).await.is_empty());
        }
        let frames = live.tick(now + 5 * SEC).await;
        assert_eq!(names(&frames), ["thread", "summary"]);
        assert_eq!(reader.reads(), 2);
    }

    #[tokio::test]
    async fn lu11_a_lost_session_is_410_once_and_ends_the_transcript_parts() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        session_rows::Entity::delete_many()
            .filter(session_rows::Column::OrgId.eq(&org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);

        let frames = live.tick(now).await;
        assert_eq!(names(&frames), ["rca", "steering", "error"]);
        assert_eq!(data(&frames, "error")["status"], 410);
        assert_eq!(data(&frames, "error")["error_code"], "transcript_expired");

        // The run moves on: steering and rca still go out, the transcript parts do not.
        cancel_write(&org, &run_id).await;
        let frames = live.tick(now + SEC).await;
        assert!(
            !names(&frames)
                .iter()
                .any(|name| matches!(*name, "thread" | "summary" | "error")),
            "{frames:?}"
        );
        assert!(names(&frames).contains(&"rca"));
    }

    #[tokio::test]
    async fn lu13_a_cancelled_run_sends_its_partial_then_its_stored_summary_then_end() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        live.tick(now).await;

        // A cancel commits the state before the finalizer stores the record.
        cancel_write(&org, &run_id).await;
        let frames = live.tick(now + SEC).await;
        let partial = data(&frames, "summary");
        assert_eq!(partial["state"], "cancelled");
        assert_eq!(partial["legacy"], false);
        assert!(
            !partial["state_version"]
                .as_str()
                .unwrap()
                .starts_with("-1.")
        );
        assert!(
            !names(&frames).contains(&"end"),
            "the record is not stored yet"
        );
        assert!(live.tick(now + 2 * SEC).await.is_empty());

        let stored = RunUpdate {
            result: Some(record()),
            final_stats_only: true,
            ..Default::default()
        };
        assert!(update_run(&org, &run_id, stored).await.unwrap());
        let frames = live.tick(now + 3 * SEC).await;
        let summary = data(&frames, "summary");
        assert!(
            summary["state_version"]
                .as_str()
                .unwrap()
                .starts_with("-1.0.")
        );
        assert_eq!(names(&frames).last(), Some(&"end"));
        assert_eq!(data(&frames, "end"), json!({"state": "cancelled"}));
        assert!(live.is_done());
    }

    /// The cancel banner counts the finished steps a Resume keeps; a live run offers none.
    #[tokio::test]
    async fn a_cancelled_runs_thread_counts_the_steps_a_resume_keeps() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let events = crate::ai_chat::fork::tests::three_steps();
        let kept = fork::plan_resume(&events).unwrap().reused_steps;
        assert_ne!(kept, 0);
        let reader = Reader::new(events);
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        let frames = live.tick(now).await;
        assert!(data(&frames, "thread").get("reusable_steps").is_none());

        cancel_write(&org, &run_id).await;
        let frames = live.tick(now + SEC).await;
        assert_eq!(data(&frames, "thread")["reusable_steps"], kept);
    }

    #[tokio::test]
    async fn lu13_a_terminal_run_without_its_record_ends_30_s_after_the_stream_saw_it() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        cancel_write(&org, &run_id).await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);

        assert!(!names(&live.tick(now).await).contains(&"end"));
        assert!(!names(&live.tick(now + 29 * SEC).await).contains(&"end"));
        assert_eq!(names(&live.tick(now + 30 * SEC).await), ["end"]);
    }

    #[tokio::test]
    async fn lu9_a_part_that_keeps_failing_sends_its_error_once() {
        let _db = db().await;
        let (org, inc, first) = live_run().await;
        let done = RunUpdate {
            result: Some(record()),
            ..Default::default()
        };
        assert!(complete_run(&org, &first, "report", done).await.unwrap());
        start(&org, &inc, RunTrigger::Manual).await;
        let reader = Reader::new(hypothesis_events());
        for _ in 0..3 {
            reader
                .failures
                .lock()
                .push_back(ReadError::Search("timeout".to_string()));
        }
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&first)), &reader, now);

        // The stored record builds the summary; only the thread needs the transcript.
        let frames = live.tick(now).await;
        assert_eq!(names(&frames), ["rca", "summary", "steering", "error"]);
        assert!(live.tick(now + 5 * SEC).await.is_empty());
        assert!(live.tick(now + 10 * SEC).await.is_empty());
        assert_eq!(reader.reads(), 3);

        let frames = live.tick(now + 15 * SEC).await;
        assert_eq!(names(&frames), ["thread"]);
    }

    #[tokio::test]
    async fn lu13_an_ended_run_whose_session_is_gone_ends_at_once() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        cancel_write(&org, &run_id).await;
        session_rows::Entity::delete_many()
            .filter(session_rows::Column::OrgId.eq(&org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);

        let frames = live.tick(now).await;
        assert_eq!(
            names(&frames),
            ["rca", "summary", "steering", "error", "end"]
        );
        assert_eq!(data(&frames, "summary")["legacy"], true);
        assert_eq!(data(&frames, "error")["error_code"], "transcript_expired");
    }

    #[tokio::test]
    async fn lu13_a_history_run_stays_open_while_the_latest_run_is_live() {
        let _db = db().await;
        let (org, inc, first) = live_run().await;
        let done = RunUpdate {
            result: Some(record()),
            ..Default::default()
        };
        assert!(complete_run(&org, &first, "report", done).await.unwrap());
        let latest = start(&org, &inc, RunTrigger::Manual).await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&first)), &reader, now);

        let frames = live.tick(now).await;
        assert_eq!(names(&frames), ["rca", "summary", "thread", "steering"]);
        assert_eq!(data(&frames, "rca")["run_id"], latest.as_str());

        let done = RunUpdate {
            result: Some(record()),
            ..Default::default()
        };
        assert!(complete_run(&org, &latest, "report", done).await.unwrap());
        let frames = live.tick(now + SEC).await;
        assert_eq!(names(&frames), ["rca", "end"]);
        assert_eq!(data(&frames, "end"), json!({"state": "completed"}));
    }

    #[tokio::test]
    async fn lu14_a_quiet_stream_pings_after_15_s_and_closes_after_300_s() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        live.tick(now).await;

        assert!(live.tick(now + 14 * SEC).await.is_empty());
        assert_eq!(live.tick(now + 15 * SEC).await, [LiveFrame::Ping]);
        assert!(live.tick(now + 16 * SEC).await.is_empty());

        assert!(live.tick(now + 300 * SEC).await.is_empty(), "no end");
        assert!(live.is_done());
    }

    #[tokio::test]
    async fn a_pruned_run_is_a_404_then_end() {
        let _db = db().await;
        let (org, inc, run_id) = live_run().await;
        let reader = Reader::new(hypothesis_events());
        let now = now_micros();
        let mut live = LiveStream::new(spec(&org, &inc, Some(&run_id)), &reader, now);
        live.tick(now).await;

        run_rows::Entity::delete_many()
            .filter(run_rows::Column::OrgId.eq(&org))
            .filter(run_rows::Column::RunId.eq(&run_id))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        let frames = live.tick(now + SEC).await;
        assert_eq!(names(&frames), ["error", "end"]);
        assert_eq!(data(&frames, "error")["part"], "transcript");
        assert_eq!(data(&frames, "error")["status"], 404);
        assert_eq!(data(&frames, "end"), json!({"state": null}));
    }

    #[test]
    fn lu5_each_frame_is_one_server_sent_event() {
        let frame = LiveFrame::Event {
            name: "end",
            data: r#"{"state":"completed"}"#.to_string(),
        };
        assert_eq!(
            frame.to_sse(),
            "event: end\ndata: {\"state\":\"completed\"}\n\n"
        );
        assert_eq!(LiveFrame::Ping.to_sse(), ": ping\n\n");
    }

    pub(crate) fn tool_event(
        seq: i64,
        id: &str,
        tool: &str,
        input: serde_json::Value,
        output: &str,
    ) -> DurableEvent {
        DurableEvent {
            id: format!("evt_{seq}"),
            aggregate_id: "ses_partial".to_string(),
            seq,
            event_type: "message.part.updated.1".to_string(),
            data: json!({"sessionID": "ses_partial", "part": {
                "id": id, "type": "tool", "callID": format!("call_{id}"), "tool": tool,
                "sessionID": "ses_partial", "messageID": "msg_a1",
                "state": {"status": "completed", "input": input, "output": output,
                          "time": {"start": 1_000 + seq, "end": 1_010 + seq}},
            }}),
        }
    }

    pub(crate) const SQL: &str = "SELECT count(*) FROM app_logs WHERE level = 'error'";

    /// Two steps, one search, `h1` testing on `e1` and `h2` likely.
    pub(crate) fn hypothesis_events() -> Vec<DurableEvent> {
        vec![
            DurableEvent {
                id: "evt_0".to_string(),
                aggregate_id: "ses_partial".to_string(),
                seq: 0,
                event_type: "message.updated.1".to_string(),
                data: json!({"sessionID": "ses_partial", "info": {"id": "msg_a1", "sessionID": "ses_partial", "role": "assistant", "time": {"created": 1_000}}}),
            },
            tool_event(
                1,
                "prt_s1",
                "record_step",
                json!({"stage": "context", "title": "Context"}),
                "{}",
            ),
            tool_event(
                2,
                "prt_s2",
                "record_step",
                json!({"stage": "topology", "title": "Topology"}),
                "{}",
            ),
            tool_event(
                3,
                "prt_t1",
                "o2_SearchSQL",
                json!({"org_id": "default", "type": "logs", "request_body": {"query": {"sql": SQL}}}),
                r#"{"took": 3, "hits": [{}, {}], "total": 2}"#,
            ),
            tool_event(
                4,
                "prt_h1",
                "record_hypothesis",
                json!({"id": "h1", "statement": "The pool ran dry", "status": "testing", "reason": "r", "evidence": [
                    {"id": "e1", "tool": "SearchSQL", "query": SQL, "polarity": "supports", "strength": "decisive", "observation": "errors rose"}
                ]}),
                "{}",
            ),
            tool_event(
                5,
                "prt_h2",
                "record_hypothesis",
                json!({"id": "h2", "statement": "A node ran hot", "status": "likely", "reason": "r"}),
                "{}",
            ),
        ]
    }

    #[test]
    fn the_partial_summary_is_the_partial_record_of_the_transcript() {
        let summary = partial_summary(
            "run_1",
            RunState::Cancelled,
            "5.1700.2000".to_string(),
            &decode_run(&hypothesis_events()),
            &BTreeMap::new(),
            0,
        );
        let body = serde_json::to_value(&summary).unwrap();
        assert_eq!(body["legacy"], false);
        assert_eq!(body["state"], "cancelled");
        assert_eq!(body["state_version"], "5.1700.2000");
        assert!(body["card"]["outcome"].is_null() && body["card"]["band"].is_null());
        assert!(body["card"]["headline"].is_null());
        let hypotheses: Vec<(&str, &str)> = body["hypotheses"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| (h["id"].as_str().unwrap(), h["status"].as_str().unwrap()))
            .collect();
        assert_eq!(hypotheses, [("h2", "likely"), ("h1", "untested")]);
        assert_eq!(body["evidence"][0]["ids"], json!(["e1"]));
        assert_eq!(body["evidence"][0]["result_summary"], "2 rows · took 3 ms");
        assert_eq!(body["timeline"], json!([]));
        let run_end = body["blind_spots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["id"] == "run_end")
            .expect("the run_end blind spot");
        assert_eq!(run_end["title"], "5 stages did not run");
        assert_eq!(
            run_end["why"],
            "Changes, Traces, Log patterns, Metrics, Converge"
        );
        assert_eq!(run_end["fix"], "resume_run");
    }
}
