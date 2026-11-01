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

//! The Resume fork of an RCA run's session: cut at the last finished step, copy under fresh ids.

use std::{borrow::Cow, collections::HashMap, sync::LazyLock};

use anyhow::{Context, Result, bail};
use config::{
    meta::oncall::rca_run::parse_submit,
    utils::{
        json::{Map, Value},
        time::now_micros,
    },
};
use infra::table::ai_chat_sessions::{self, Binding, NO_SEQ};
use o2_enterprise::enterprise::ai::{
    chat::{ChatStore, PersistSettings, RecordContext, batcher::DurableEvent, record::to_records},
    client::RCA_AGENT_TYPE,
};
use regex::{Captures, Regex};
use sha2::{Digest, Sha256};

use super::{
    REFRESH_BATCH, StreamChatStore,
    projection::truthy,
    rca_thread::{
        RECORD_STEP, SUBMIT_REPORT, ThreadPart, ToolPart, rca_stage, step_title, updated_part,
    },
    read_committed_events,
};

/// An opencode id: 4-letter family, `_`, 12 time-ordered chars and a 14-char base62 tail; others
/// stay as they are.
static OPENCODE_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:evt|ses|msg|prt)_[0-9A-Za-z]{26}\b").expect("valid pattern")
});
/// Bytes of an id that a rewrite keeps: the family, `_` and the time-ordered prefix.
const KEPT_ID_BYTES: usize = 4 + 12;
/// Base62 digits that replace an id's tail.
const ID_TAIL_CHARS: usize = 14;
const BASE62: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Where a resumed run starts over in its source session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumePlan {
    /// Last seq kept: before the last `record_step`'s message, or its call after only text.
    pub cut_seq: i64,
    /// Steps the kept events show, the thread's implicit first step included.
    pub reused_steps: u32,
    /// The first step the cut drops, which the resumed run does again.
    pub from_step: PlannedStep,
}

/// A `record_step` call as the thread names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedStep {
    /// 1-based, counted over `record_step` calls.
    pub index: u32,
    pub stage: Option<&'static str>,
    pub title: String,
}

/// Why a session has nothing a Resume could reuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResumeRefusal {
    /// A committed `submit_report`: the run has its report.
    ReportSubmitted,
    /// No `record_step` finished before the last one.
    NoFinishedStep,
}

/// A forked session, committed up to `last_seq` and bound to its own opencode session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunFork {
    pub session_id: String,
    pub last_seq: i64,
}

/// A `record_step` call over the updates of its part.
struct StepCall<'a> {
    message_id: &'a str,
    /// Seq of the call's first update, whatever its status.
    opened_seq: i64,
    /// Seq of the first update that shows the call running or completed.
    first_seq: Option<i64>,
    /// `state.status` of the latest update.
    status: &'a str,
    stage: Option<&'a Value>,
    title: Option<&'a Value>,
}

/// Keep whole steps before the final step; repeat that step on resume.
pub fn plan_resume(events: &[DurableEvent]) -> Result<ResumePlan, ResumeRefusal> {
    let mut calls: Vec<StepCall> = Vec::new();
    let mut by_call_id: HashMap<String, usize> = HashMap::new();
    // The first visible tool row: before every step, the thread shows it in an implicit step.
    let mut first_row_seq: Option<i64> = None;
    for event in events {
        let Some(part) = updated_part(event) else {
            continue;
        };
        let Some(call) = ToolPart::of(part) else {
            continue;
        };
        match call.tool {
            // A blank report is no report: the run failed without one.
            SUBMIT_REPORT
                if call.status == "completed"
                    && parse_submit(&Value::Object(call.args())).is_some() =>
            {
                return Err(ResumeRefusal::ReportSubmitted);
            }
            RECORD_STEP => {}
            _ => {
                if first_row_seq.is_none() && call.kind() == ThreadPart::Row {
                    first_row_seq = Some(event.seq);
                }
                continue;
            }
        }
        let Some(message_id) = part.get("messageID").and_then(Value::as_str) else {
            continue;
        };
        let index = *by_call_id.entry(call.call_id()).or_insert_with(|| {
            calls.push(StepCall {
                message_id,
                opened_seq: event.seq,
                first_seq: None,
                status: "",
                stage: None,
                title: None,
            });
            calls.len() - 1
        });
        let step = &mut calls[index];
        step.status = call.status;
        if step.first_seq.is_none() && matches!(call.status, "running" | "completed") {
            step.first_seq = Some(event.seq);
        }
        step.stage = call.arg("stage").or(step.stage);
        step.title = call.arg("title").or(step.title);
    }

    let mut steps: Vec<(i64, &StepCall)> = calls
        .iter()
        .filter(|step| step.status != "error")
        .filter_map(|step| step.first_seq.map(|seq| (seq, step)))
        .collect();
    // Stable: calls that started at one seq keep their order in the transcript.
    steps.sort_by_key(|(seq, _)| *seq);
    let Some((_, last)) = steps.last() else {
        return Err(ResumeRefusal::NoFinishedStep);
    };
    let opens = events
        .iter()
        .filter(|event| message_of(event) == Some(last.message_id))
        .map(|event| event.seq)
        .min()
        .ok_or(ResumeRefusal::NoFinishedStep)?;
    // The text before the dropped call is the note of the last kept step.
    let cut_seq = if only_text_before(events, last.message_id, opens, last.opened_seq) {
        last.opened_seq - 1
    } else {
        opens - 1
    };
    let first_step_seq = calls
        .iter()
        .filter(|step| step.status != "error")
        .map(|step| step.opened_seq)
        .min();
    let implicit = first_row_seq
        .is_some_and(|row| row <= cut_seq && first_step_seq.is_none_or(|step| row < step));
    let reused = steps.iter().filter(|(seq, _)| *seq <= cut_seq).count() + usize::from(implicit);
    let Some((_, dropped)) = steps.iter().find(|(seq, _)| *seq > cut_seq) else {
        return Err(ResumeRefusal::NoFinishedStep);
    };
    if reused == 0 {
        return Err(ResumeRefusal::NoFinishedStep);
    }
    let index = reused + 1;
    Ok(ResumePlan {
        cut_seq,
        reused_steps: u32::try_from(reused).unwrap_or(u32::MAX),
        from_step: PlannedStep {
            index: u32::try_from(index).unwrap_or(u32::MAX),
            stage: rca_stage(dropped.stage),
            title: step_title(dropped.title, index),
        },
    })
}

/// Finished steps a Resume keeps: 0 when none finished, `None` once the report was submitted.
pub fn reusable_steps(events: &[DurableEvent]) -> Option<u32> {
    match plan_resume(events) {
        Ok(plan) => Some(plan.reused_steps),
        Err(ResumeRefusal::NoFinishedStep) => Some(0),
        Err(ResumeRefusal::ReportSubmitted) => None,
    }
}

/// Whether `message_id`'s events in `from..to` are only its text, some of it visible.
fn only_text_before(events: &[DurableEvent], message_id: &str, from: i64, to: i64) -> bool {
    let mut visible = false;
    for event in events
        .iter()
        .filter(|event| (from..to).contains(&event.seq))
    {
        if message_of(event).is_some_and(|id| id != message_id) {
            return false;
        }
        let Some(part) = updated_part(event) else {
            continue;
        };
        match part.get("type").and_then(Value::as_str) {
            Some("text") => visible |= is_visible_text(part),
            Some("reasoning" | "step-start") => {}
            _ => return false,
        }
    }
    visible
}

/// A text part the thread shows as a note.
fn is_visible_text(part: &Map<String, Value>) -> bool {
    let hidden =
        part.get("synthetic").is_some_and(truthy) || part.get("ignored").is_some_and(truthy);
    !hidden
        && part
            .get("text")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
}

/// The opencode message an event belongs to: a message's own update, or one of its parts.
fn message_of(event: &DurableEvent) -> Option<&str> {
    let data = &event.data;
    if event.event_type.starts_with("message.updated") {
        return data["info"]["id"].as_str();
    }
    match data.get("part") {
        Some(Value::Object(part)) => part.get("messageID").and_then(Value::as_str),
        _ => data.get("messageID").and_then(Value::as_str),
    }
}

/// Rewrite ids consistently per fork while preserving family and sort prefix.
pub fn rewrite_ids(events: Vec<DurableEvent>, key: &str) -> Vec<DurableEvent> {
    let mut ids = IdMap {
        key,
        ids: HashMap::new(),
    };
    events
        .into_iter()
        .map(|event| DurableEvent {
            id: ids.rewrite(event.id),
            aggregate_id: ids.rewrite(event.aggregate_id),
            seq: event.seq,
            event_type: event.event_type,
            data: ids.rewrite_value(event.data),
        })
        .collect()
}

struct IdMap<'k> {
    key: &'k str,
    ids: HashMap<String, String>,
}

impl IdMap<'_> {
    fn rewrite_value(&mut self, value: Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.rewrite(text)),
            Value::Array(items) => {
                Value::Array(items.into_iter().map(|v| self.rewrite_value(v)).collect())
            }
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .map(|(k, v)| (self.rewrite(k), self.rewrite_value(v)))
                    .collect::<Map<String, Value>>(),
            ),
            other => other,
        }
    }

    fn rewrite(&mut self, text: String) -> String {
        let rewritten =
            match OPENCODE_ID.replace_all(&text, |caps: &Captures| self.new_id(&caps[0])) {
                Cow::Owned(rewritten) => Some(rewritten),
                Cow::Borrowed(_) => None,
            };
        rewritten.unwrap_or(text)
    }

    fn new_id(&mut self, old: &str) -> String {
        if let Some(new) = self.ids.get(old) {
            return new.clone();
        }
        let mut digest = [0u8; 32];
        digest.copy_from_slice(
            &Sha256::new()
                .chain_update(self.key.as_bytes())
                .chain_update(old.as_bytes())
                .finalize(),
        );
        let mut new = String::with_capacity(old.len());
        new.push_str(&old[..KEPT_ID_BYTES]);
        push_base62(&mut new, digest);
        self.ids.insert(old.to_string(), new.clone());
        new
    }
}

/// Appends the [ID_TAIL_CHARS] least significant base62 digits of the big-endian `n`.
fn push_base62(out: &mut String, mut n: [u8; 32]) {
    for _ in 0..ID_TAIL_CHARS {
        let mut rem = 0u32;
        for byte in n.iter_mut() {
            let acc = (rem << 8) | u32::from(*byte);
            *byte = (acc / 62) as u8;
            rem = acc % 62;
        }
        out.push(char::from(BASE62[rem as usize]));
    }
}

/// Verify the copied prefix before publishing the fork watermark.
pub async fn fork_run_session(
    org_id: &str,
    source: &ai_chat_sessions::Model,
    prefix: Vec<DurableEvent>,
    source_run_id: &str,
) -> Result<RunFork> {
    let store = StreamChatStore::new(PersistSettings::for_rca().retention_days);
    fork_run_session_with(
        &store,
        async |row: &ai_chat_sessions::Model| read_committed_events(row, NO_SEQ).await,
        org_id,
        source,
        prefix,
        source_run_id,
    )
    .await
}

/// [fork_run_session] through `store`, reading the committed copy back with `read_back`.
async fn fork_run_session_with<S, R>(
    store: &S,
    read_back: R,
    org_id: &str,
    source: &ai_chat_sessions::Model,
    prefix: Vec<DurableEvent>,
    source_run_id: &str,
) -> Result<RunFork>
where
    S: ChatStore,
    R: AsyncFnOnce(
        &ai_chat_sessions::Model,
    ) -> std::result::Result<Vec<DurableEvent>, super::ReadError>,
{
    let Some(last_seq) = prefix.last().map(|event| event.seq) else {
        bail!("no events to copy");
    };
    if let Some((i, event)) = prefix
        .iter()
        .enumerate()
        .find(|(i, event)| event.seq != *i as i64)
    {
        bail!("the events to copy skip seq {i} (found {})", event.seq);
    }
    let session_id = sea_orm::prelude::Uuid::new_v4().to_string();
    let events = rewrite_ids(prefix, &session_id);
    let opencode_session_id = events[0].aggregate_id.clone();
    if source.opencode_session_id.as_deref() == Some(opencode_session_id.as_str()) {
        bail!("the copy kept the source's opencode session {opencode_session_id}");
    }

    let row = ai_chat_sessions::get_or_create(
        org_id,
        &session_id,
        &source.user_id,
        &source.user_email,
        RCA_AGENT_TYPE,
        now_micros(),
    )
    .await
    .context("creating the session")?;
    let settings = PersistSettings::for_rca();
    match store
        .bind_opencode_session(org_id, &session_id, &opencode_session_id)
        .await
        .context("binding the opencode session")?
    {
        Binding::Bound { .. } => {}
        Binding::Forked {
            bound_opencode_session_id,
        } => bail!("the new session is bound to {bound_opencode_session_id} already"),
    }

    let ctx = RecordContext {
        org_id: org_id.to_string(),
        user_id: source.user_id.clone(),
        session_id: session_id.clone(),
        opencode_session_id: opencode_session_id.clone(),
        session_epoch: row.session_epoch,
        turn_id: format!("resume-{source_run_id}"),
    };
    let mut first_at = None;
    let mut last_at = 0;
    for chunk in events.chunks(REFRESH_BATCH) {
        last_at = now_micros().max(last_at);
        first_at.get_or_insert(last_at);
        let rows = chunk
            .iter()
            .flat_map(|event| to_records(&ctx, event, last_at, settings.max_event_bytes))
            .collect();
        store
            .write_events(org_id, rows)
            .await
            .context("writing the copied events")?;
    }
    let first_at = first_at.unwrap_or(last_at);

    if !source.title.is_empty() {
        ai_chat_sessions::set_prompt_title(org_id, &session_id, &source.title, now_micros())
            .await
            .context("setting the title")?;
    }
    // Last: from here on the copy is the session's committed history.
    let advanced = store
        .advance_watermark(
            org_id,
            &session_id,
            row.session_epoch,
            NO_SEQ,
            last_seq,
            first_at,
            last_at,
        )
        .await
        .context("committing the copied events")?;
    if !advanced {
        bail!("the new session moved while its events were copied");
    }

    let committed =
        ai_chat_sessions::get_with(infra::db::get_orm_client_rw().await, org_id, &session_id)
            .await
            .context("reading the new session")?
            .context("the new session is gone")?;
    let read = read_back(&committed)
        .await
        .context("reading the copied events back")?;
    if read.len() as i64 != last_seq + 1 {
        bail!("{} of {} copied events read back", read.len(), last_seq + 1);
    }
    Ok(RunFork {
        session_id,
        last_seq,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::{HashMap, HashSet};

    use config::utils::json::json;
    use infra::table::{
        ai_chat_sessions::{STATUS_ACTIVE, TITLE_FROM_PROMPT},
        ai_chat_turns,
        entity::ai_chat_sessions as session_rows,
    };
    use o2_enterprise::enterprise::ai::chat::AiChatEventRecord;
    use parking_lot::Mutex;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    use super::*;
    use crate::{
        ai_chat::{
            ReadError, Resolver,
            rca_thread::{
                project_rca_thread,
                tests::{Session, T, hits, load_replay, search_sql},
            },
            verify_window,
        },
        alerts::rca_runs::tests::db,
    };

    // ---- the fixture: an RCA session with three steps ----

    /// A `record_step` part; a rejected one carries the tool's error.
    fn step(s: &mut Session, message: &str, id: &str, status: &str, stage: &str, title: &str) {
        let at = s.events.len() as i64 * 100;
        let result = if status == "error" {
            json!({"error": "unknown stage"})
        } else {
            json!({"output": "{\"type\":\"rca_step\"}"})
        };
        s.tool(
            message,
            id,
            "record_step",
            status,
            json!({"stage": stage, "title": title}),
            result,
            at,
            at + 1,
        );
    }

    fn query(s: &mut Session, message: &str, id: &str, status: &str) {
        let at = s.events.len() as i64 * 100;
        s.tool(
            message,
            id,
            "o2_SearchSQL",
            status,
            search_sql("SELECT count(*) FROM app_logs"),
            hits(1),
            at,
            at + 10,
        );
    }

    fn prompt(s: &mut Session) {
        s.message("msg_u1", "user", json!({"created": T}));
        s.part(
            "msg_u1",
            json!({"id": "prt_u1", "type": "text", "text": "Analyze incident inc_1. Trigger: manual."}),
        );
    }

    fn assistant(s: &mut Session, id: &str) {
        let at = s.events.len() as i64 * 100;
        s.message(id, "assistant", json!({"created": T + at}));
    }

    /// Three steps, one assistant message each; the third is still running.
    pub(crate) fn three_steps() -> Vec<DurableEvent> {
        let mut s = Session::new();
        prompt(&mut s); // 0, 1
        s.message("msg_a1", "assistant", json!({"created": T + 100})); // 2
        step(
            &mut s,
            "msg_a1",
            "prt_s1",
            "running",
            "context",
            "Load incident context",
        ); // 3
        step(
            &mut s,
            "msg_a1",
            "prt_s1",
            "completed",
            "context",
            "Load incident context",
        ); // 4
        query(&mut s, "msg_a1", "prt_q1", "completed"); // 5
        s.text(
            "msg_a1",
            "prt_n1",
            "Errors began at 10:02 [e1].",
            1_200,
            1_300,
        ); // 6
        s.tokens("msg_a1", "prt_f1", 1_000, 200, 50, 300); // 7
        s.message(
            "msg_a1",
            "assistant",
            json!({"created": T + 100, "completed": T + 1_400}),
        ); // 8
        s.message("msg_a2", "assistant", json!({"created": T + 1_500})); // 9
        step(
            &mut s,
            "msg_a2",
            "prt_s2",
            "completed",
            "metrics",
            "Check pool saturation",
        ); // 10
        query(&mut s, "msg_a2", "prt_q2", "completed"); // 11
        s.tokens("msg_a2", "prt_f2", 2_000, 400, 0, 100); // 12
        s.message(
            "msg_a2",
            "assistant",
            json!({"created": T + 1_500, "completed": T + 2_400}),
        ); // 13
        s.message("msg_a3", "assistant", json!({"created": T + 2_500})); // 14
        s.text(
            "msg_a3",
            "prt_x3",
            "Next, the recent deploys.",
            2_550,
            2_600,
        ); // 15
        step(
            &mut s,
            "msg_a3",
            "prt_s3",
            "running",
            "changes",
            "Check recent deploys",
        ); // 16
        query(&mut s, "msg_a3", "prt_q3", "running"); // 17
        s.events
    }

    /// The last seq [three_steps] keeps: `msg_a3`'s text, the note of step 2, before its step call.
    pub(crate) const THREE_STEPS_CUT: i64 = 15;

    fn titles(events: &[DurableEvent]) -> Vec<String> {
        project_rca_thread(events, &[], false, false)
            .steps
            .into_iter()
            .map(|s| s.title)
            .collect()
    }

    fn planned(index: u32, stage: Option<&'static str>, title: &str) -> PlannedStep {
        PlannedStep {
            index,
            stage,
            title: title.to_string(),
        }
    }

    // ---- plan_resume ----

    #[test]
    fn the_cut_drops_the_last_steps_call_and_keeps_the_note_before_it() {
        let events = three_steps();
        let plan = plan_resume(&events).unwrap();
        assert_eq!(
            plan,
            ResumePlan {
                cut_seq: THREE_STEPS_CUT,
                reused_steps: 2,
                from_step: planned(3, Some("changes"), "Check recent deploys"),
            }
        );
        let cut = plan.cut_seq as usize;
        assert_eq!(
            events[cut + 1].data["part"]["tool"],
            "record_step",
            "the last step is dropped from its call's first update on"
        );
        assert_eq!(
            titles(&events[..=cut]),
            ["Load incident context", "Check pool saturation"],
            "the kept events show the reused steps whole"
        );
        let kept = project_rca_thread(&events[..=cut], &[], false, false);
        let source = project_rca_thread(&events, &[], false, false);
        assert!(source.steps[1].note.is_some());
        assert_eq!(
            kept.steps[1].note, source.steps[1].note,
            "the last reused step keeps its note"
        );
        let full = project_rca_thread(&events, &[], true, false);
        let third = &full.steps[2];
        assert_eq!(
            (third.index, third.stage.as_deref(), third.title.as_str()),
            (3, Some("changes"), "Check recent deploys"),
            "from_step is the step the thread showed"
        );
    }

    #[test]
    fn steps_are_numbered_as_the_thread_numbers_them() {
        let mut s = Session::new();
        prompt(&mut s);
        assistant(&mut s, "msg_a1");
        query(&mut s, "msg_a1", "prt_q0", "completed");
        assistant(&mut s, "msg_a2");
        step(
            &mut s,
            "msg_a2",
            "prt_s1",
            "completed",
            "metrics",
            "Check pool saturation",
        );
        query(&mut s, "msg_a2", "prt_q1", "completed");
        assistant(&mut s, "msg_a3");
        step(&mut s, "msg_a3", "prt_s2", "running", "changes", " ");

        let plan = plan_resume(&s.events).unwrap();
        let thread = project_rca_thread(&s.events, &[], true, false);
        let redone = &thread.steps[plan.reused_steps as usize];
        assert_eq!(
            (plan.from_step.index, plan.from_step.title.as_str()),
            (redone.index, redone.title.as_str()),
            "the tool calls before the first record_step are the thread's first step"
        );
        assert_eq!(
            titles(&s.events[..=plan.cut_seq as usize]).len(),
            plan.reused_steps as usize
        );

        // That implicit step alone is a finished step to keep.
        let mut only = Session::new();
        prompt(&mut only);
        assistant(&mut only, "msg_a1");
        query(&mut only, "msg_a1", "prt_q0", "completed");
        assistant(&mut only, "msg_a2");
        step(
            &mut only,
            "msg_a2",
            "prt_s1",
            "running",
            "metrics",
            "Check pool saturation",
        );
        let plan = plan_resume(&only.events).unwrap();
        assert_eq!(
            (plan.reused_steps, plan.from_step.index),
            (1, 2),
            "{plan:?}"
        );
    }

    #[test]
    fn two_steps_in_one_message_are_dropped_together() {
        let mut s = Session::new();
        prompt(&mut s);
        assistant(&mut s, "msg_a1");
        step(
            &mut s,
            "msg_a1",
            "prt_s1",
            "completed",
            "context",
            "Load incident context",
        );
        query(&mut s, "msg_a1", "prt_q1", "completed");
        assistant(&mut s, "msg_a2");
        let opens = s.events.len() as i64 - 1;
        step(
            &mut s,
            "msg_a2",
            "prt_s2",
            "completed",
            "topology",
            "Map the services",
        );
        query(&mut s, "msg_a2", "prt_q2", "completed");
        step(
            &mut s,
            "msg_a2",
            "prt_s3",
            "completed",
            "changes",
            "Check recent deploys",
        );
        query(&mut s, "msg_a2", "prt_q3", "completed");

        let plan = plan_resume(&s.events).unwrap();
        assert_eq!(plan.cut_seq, opens - 1);
        assert_eq!(plan.reused_steps, 1);
        assert_eq!(
            plan.from_step,
            planned(2, Some("topology"), "Map the services")
        );
        assert_eq!(
            titles(&s.events[..=plan.cut_seq as usize]),
            ["Load incident context"]
        );
    }

    #[test]
    fn a_rejected_or_unstarted_record_step_is_no_step() {
        for last in ["error", "pending"] {
            let mut s = Session::new();
            prompt(&mut s);
            assistant(&mut s, "msg_a1");
            step(
                &mut s,
                "msg_a1",
                "prt_s1",
                "completed",
                "context",
                "Load incident context",
            );
            assistant(&mut s, "msg_a2");
            let opens = s.events.len() as i64 - 1;
            step(
                &mut s,
                "msg_a2",
                "prt_s2",
                "completed",
                "metrics",
                "Check pool saturation",
            );
            assistant(&mut s, "msg_a3");
            step(
                &mut s,
                "msg_a3",
                "prt_s3",
                "pending",
                "changes",
                "Check deploys",
            );
            if last == "error" {
                step(
                    &mut s,
                    "msg_a3",
                    "prt_s3",
                    "running",
                    "changes",
                    "Check deploys",
                );
                step(
                    &mut s,
                    "msg_a3",
                    "prt_s3",
                    "error",
                    "changes",
                    "Check deploys",
                );
            }

            let plan = plan_resume(&s.events).unwrap();
            assert_eq!(plan.cut_seq, opens - 1, "{last}");
            assert_eq!(plan.reused_steps, 1, "{last}");
            assert_eq!(
                plan.from_step,
                planned(2, Some("metrics"), "Check pool saturation"),
                "{last}"
            );
        }

        // A rejected call among the kept ones is not counted as reused.
        let mut s = Session::new();
        prompt(&mut s);
        assistant(&mut s, "msg_a1");
        step(
            &mut s,
            "msg_a1",
            "prt_s1",
            "completed",
            "context",
            "Load incident context",
        );
        step(&mut s, "msg_a1", "prt_bad", "error", "nowhere", "Rejected");
        assistant(&mut s, "msg_a2");
        step(
            &mut s,
            "msg_a2",
            "prt_s2",
            "completed",
            "metrics",
            "Check pool saturation",
        );
        assistant(&mut s, "msg_a3");
        step(
            &mut s,
            "msg_a3",
            "prt_s3",
            "running",
            "changes",
            "Check recent deploys",
        );
        let plan = plan_resume(&s.events).unwrap();
        assert_eq!(plan.reused_steps, 2);
        assert_eq!(
            plan.from_step,
            planned(3, Some("changes"), "Check recent deploys")
        );
        assert_eq!(
            titles(&s.events[..=plan.cut_seq as usize]).len(),
            2,
            "the thread of the kept events agrees"
        );
    }

    #[test]
    fn only_a_committed_report_refuses_the_resume() {
        for (status, markdown, refused) in [
            ("completed", "## Root cause", true),
            ("completed", "  ", false),
            ("error", "## Root cause", false),
            ("running", "## Root cause", false),
        ] {
            let mut s = Session {
                events: three_steps(),
            };
            s.tool(
                "msg_a3",
                "prt_p1",
                "submit_report",
                status,
                json!({"markdown": markdown}),
                json!({}),
                5_000,
                5_001,
            );
            let plan = plan_resume(&s.events);
            if refused {
                assert_eq!(plan, Err(ResumeRefusal::ReportSubmitted), "{status}");
            } else {
                assert_eq!(
                    plan.unwrap().cut_seq,
                    THREE_STEPS_CUT,
                    "{status} {markdown:?}"
                );
            }
        }
        // Wherever the report sits, even before the last step.
        let mut events = three_steps();
        let mut s = Session::new();
        s.tool(
            "msg_a1",
            "prt_p0",
            "o2_submit_report",
            "completed",
            json!({"markdown": "## Early"}),
            json!({}),
            1,
            2,
        );
        let mut report = s.events.remove(0);
        report.seq = 5;
        events.insert(5, report);
        for (seq, event) in events.iter_mut().enumerate() {
            event.seq = seq as i64;
        }
        assert_eq!(plan_resume(&events), Err(ResumeRefusal::ReportSubmitted));
    }

    /// Nothing to resume when no step would be left before the cut.
    #[test]
    fn no_step_before_the_cut_is_nothing_to_resume() {
        assert_eq!(plan_resume(&[]), Err(ResumeRefusal::NoFinishedStep));
        assert_eq!(
            plan_resume(&load_replay()),
            Err(ResumeRefusal::NoFinishedStep),
            "a recorded session with tool calls but no record_step"
        );

        let mut one = Session::new();
        prompt(&mut one);
        assistant(&mut one, "msg_a1");
        query(&mut one, "msg_a1", "prt_q0", "completed");
        step(
            &mut one,
            "msg_a1",
            "prt_s1",
            "completed",
            "context",
            "Load incident context",
        );
        query(&mut one, "msg_a1", "prt_q1", "completed");
        assert_eq!(
            plan_resume(&one.events),
            Err(ResumeRefusal::NoFinishedStep),
            "a single step is the one to redo"
        );

        step(
            &mut one,
            "msg_a1",
            "prt_s2",
            "completed",
            "metrics",
            "Check pool saturation",
        );
        assert_eq!(
            plan_resume(&one.events),
            Err(ResumeRefusal::NoFinishedStep),
            "two steps in the only assistant message are dropped together"
        );
    }

    #[test]
    fn an_untitled_step_is_named_by_its_index() {
        let mut events = three_steps();
        for event in &mut events[16..] {
            if event.data["part"]["tool"] == "record_step" {
                event.data["part"]["state"]["input"] = json!({"stage": "deploys", "title": "  "});
            }
        }
        let plan = plan_resume(&events).unwrap();
        assert_eq!(plan.from_step, planned(3, None, "Step 3"));
    }

    // ---- rewrite_ids ----

    /// Opencode ids as the replay-probe rules define them.
    static ID: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\b(?:evt|ses|msg|prt)_[0-9A-Za-z]{26}\b").expect("valid pattern")
    });

    fn ids_in(text: &str) -> Vec<String> {
        ID.find_iter(text).map(|m| m.as_str().to_string()).collect()
    }

    /// `text` with each id cut to its kept prefix.
    fn mask_str(text: &str) -> String {
        ID.replace_all(text, |c: &Captures| format!("{}*", &c[0][..16]))
            .into_owned()
    }

    fn mask(value: &Value) -> Value {
        match value {
            Value::String(s) => Value::String(mask_str(s)),
            Value::Array(items) => Value::Array(items.iter().map(mask).collect()),
            Value::Object(map) => {
                Value::Object(map.iter().map(|(k, v)| (mask_str(k), mask(v))).collect())
            }
            other => other.clone(),
        }
    }

    /// Every `(old, new)` id pair at the same place of `old` and `new`.
    fn pairs_in(old: &Value, new: &Value, out: &mut Vec<(String, String)>) {
        match (old, new) {
            (Value::String(a), Value::String(b)) => {
                let (a, b) = (ids_in(a), ids_in(b));
                assert_eq!(a.len(), b.len());
                out.extend(a.into_iter().zip(b));
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len());
                for (a, b) in a.iter().zip(b) {
                    pairs_in(a, b, out);
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(a.len(), b.len());
                for (ka, va) in a {
                    let matching: Vec<_> = b
                        .iter()
                        .filter(|(kb, _)| mask_str(kb) == mask_str(ka))
                        .collect();
                    assert_eq!(matching.len(), 1, "key {ka}");
                    let (kb, vb) = matching[0];
                    pairs_in(&Value::String(ka.clone()), &Value::String(kb.clone()), out);
                    pairs_in(va, vb, out);
                }
            }
            (a, b) => assert_eq!(a, b),
        }
    }

    fn id_map(old: &[DurableEvent], new: &[DurableEvent]) -> HashMap<String, String> {
        assert_eq!(old.len(), new.len());
        let mut pairs = Vec::new();
        for (a, b) in old.iter().zip(new) {
            assert_eq!((a.seq, &a.event_type), (b.seq, &b.event_type));
            assert_eq!(mask_str(&a.id), mask_str(&b.id));
            assert_eq!(mask_str(&a.aggregate_id), mask_str(&b.aggregate_id));
            assert_eq!(mask(&a.data), mask(&b.data), "seq {}", a.seq);
            pairs.push((a.id.clone(), b.id.clone()));
            pairs.push((a.aggregate_id.clone(), b.aggregate_id.clone()));
            pairs_in(&a.data, &b.data, &mut pairs);
        }
        let mut map: HashMap<String, String> = HashMap::new();
        for (a, b) in pairs {
            assert!(ID.is_match(&a), "{a}");
            let mapped = map.entry(a.clone()).or_insert_with(|| b.clone());
            assert_eq!(*mapped, b, "{a} is rewritten one way everywhere");
        }
        let targets: HashSet<&String> = map.values().collect();
        assert_eq!(targets.len(), map.len(), "no two ids share a new id");
        for (a, b) in &map {
            assert_ne!(a, b);
            assert_eq!(a.len(), b.len());
            assert_eq!(
                a[..16],
                b[..16],
                "{a} → {b} keeps its family and time prefix"
            );
            assert!(b[16..].bytes().all(|c| c.is_ascii_alphanumeric()), "{b}");
        }
        map
    }

    fn every_id(events: &[DurableEvent]) -> HashSet<String> {
        events
            .iter()
            .flat_map(|e| {
                [
                    e.id.clone(),
                    e.aggregate_id.clone(),
                    serde_json::to_string(&e.data).unwrap(),
                ]
            })
            .flat_map(|text| ids_in(&text))
            .collect()
    }

    /// An opencode-shaped id: `family`, `_`, a 12-char time prefix ending in `n`, 14 more.
    fn oc_id(family: &str, n: u32) -> String {
        let id = format!("{family}_0817c56{n:05}AbCdEfGhIjKlMn");
        assert_eq!(id.len(), 30);
        id
    }

    fn every_place() -> (DurableEvent, [String; 4]) {
        let (ses, msg, prt, evt) = (
            oc_id("ses", 1),
            oc_id("msg", 2),
            oc_id("prt", 3),
            oc_id("evt", 4),
        );
        let event = DurableEvent {
            id: evt.clone(),
            aggregate_id: ses.clone(),
            seq: 7,
            event_type: "message.part.updated.1".to_string(),
            data: json!({
                "sessionID": ses,
                "part": {
                    "id": prt, "sessionID": ses, "messageID": msg, "type": "tool",
                    "callID": "call_00_leFP0ufpLLkBCRM6o48m0788", "tool": "o2_steer_ack",
                    "state": {
                        "status": "completed",
                        "input": {"steer_id": oc_id("stg", 5), "note": format!("after {msg}/{prt}.")},
                        "time": {"start": T, "end": T + 5},
                    },
                },
                "index": {msg.clone(): [prt.clone()], format!("{prt}:meta"): {"by": ses}},
                "lookalike": format!("{}X", oc_id("ses", 6)),
            }),
        };
        (event, [ses, msg, prt, evt])
    }

    #[test]
    fn every_opencode_id_is_rewritten_one_way_and_nothing_else() {
        let (event, olds) = every_place();
        let new = rewrite_ids(vec![event.clone()], "fork-a");
        let map = id_map(std::slice::from_ref(&event), &new);
        let mut seen: Vec<&String> = map.keys().collect();
        seen.sort();
        let mut expected: Vec<&String> = olds.iter().collect();
        expected.sort();
        assert_eq!(
            seen, expected,
            "exactly the four ids, no steer id, no lookalike"
        );
        let data = &new[0].data;
        assert_eq!(
            data["part"]["callID"], "call_00_leFP0ufpLLkBCRM6o48m0788",
            "call ids stay"
        );
        assert_eq!(data["part"]["state"]["input"]["steer_id"], oc_id("stg", 5));
        assert_eq!(data["lookalike"], format!("{}X", oc_id("ses", 6)));
        let new_msg = &map[&olds[1]];
        assert_eq!(data["part"]["messageID"], json!(new_msg));
        assert!(
            data["index"].get(new_msg).is_some(),
            "a key is rewritten like the value it names"
        );
        assert!(every_id(&new).is_disjoint(&olds.into_iter().collect()));
    }

    #[test]
    fn a_recorded_session_is_rewritten_whole_and_in_order() {
        let events = load_replay();
        let old_ids = every_id(&events);
        assert!(old_ids.iter().any(|id| id.starts_with("prt_")));

        let fork = rewrite_ids(events.clone(), "fork-a");
        let map = id_map(&events, &fork);
        assert_eq!(
            map.keys().cloned().collect::<HashSet<_>>(),
            old_ids,
            "every id is mapped"
        );
        assert!(
            every_id(&fork).is_disjoint(&old_ids),
            "no id of the source is left"
        );
        let mut sorted: Vec<&String> = map.keys().collect();
        sorted.sort();
        for pair in sorted.windows(2) {
            assert!(
                map[pair[0]] < map[pair[1]],
                "{} < {} keeps its order",
                pair[0],
                pair[1]
            );
        }

        assert_eq!(
            rewrite_ids(events.clone(), "fork-a"),
            fork,
            "one key, one rewrite"
        );
        let other = rewrite_ids(events.clone(), "fork-b");
        let other_map = id_map(&events, &other);
        for (old, new) in &map {
            assert_ne!(
                &other_map[old], new,
                "another fork gets other ids for {old}"
            );
        }

        let fork_of_fork = rewrite_ids(fork.clone(), "fork-c");
        let second = id_map(&fork, &fork_of_fork);
        let fork_ids = every_id(&fork);
        let second_ids = every_id(&fork_of_fork);
        assert!(second_ids.is_disjoint(&fork_ids));
        assert!(second_ids.is_disjoint(&old_ids));
        assert_eq!(second.len(), map.len());
    }

    // ---- fork_run_session ----

    /// A chat store over the meta database that keeps the rows it is given and logs calls.
    #[derive(Default)]
    struct Store {
        rows: Mutex<Vec<AiChatEventRecord>>,
        calls: Mutex<Vec<&'static str>>,
        refuse_writes: bool,
    }

    #[async_trait::async_trait]
    impl ChatStore for Store {
        async fn write_events(&self, _org_id: &str, records: Vec<AiChatEventRecord>) -> Result<()> {
            self.calls.lock().push("write");
            if self.refuse_writes {
                bail!("the stream refused the batch");
            }
            self.rows.lock().extend(records);
            Ok(())
        }

        async fn bind_opencode_session(
            &self,
            org_id: &str,
            session_id: &str,
            opencode_session_id: &str,
        ) -> Result<Binding> {
            self.calls.lock().push("bind");
            ai_chat_sessions::bind_opencode_session(
                org_id,
                session_id,
                opencode_session_id,
                now_micros(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
        }

        async fn advance_watermark(
            &self,
            org_id: &str,
            session_id: &str,
            epoch: i64,
            expected_prev_seq: i64,
            new_seq: i64,
            first_event_at: i64,
            last_event_at: i64,
        ) -> Result<bool> {
            self.calls.lock().push("advance");
            ai_chat_sessions::advance_watermark(
                org_id,
                session_id,
                epoch,
                expected_prev_seq,
                new_seq,
                first_event_at,
                last_event_at,
                now_micros(),
            )
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
        }

        async fn set_auto_title(&self, _: &str, _: &str, _: &str) -> Result<()> {
            unreachable!("a fork keeps the source's title")
        }

        async fn bump_epoch(&self, _: &str, _: &str, _: i64) -> Result<Option<i64>> {
            unreachable!("a fork starts at its first epoch")
        }

        async fn read_committed_events(
            &self,
            _: &str,
            _: &str,
            _: i64,
        ) -> Result<Vec<DurableEvent>> {
            unreachable!("the fork reads back through its own reader")
        }
    }

    impl Store {
        async fn read(
            &self,
            row: &ai_chat_sessions::Model,
        ) -> std::result::Result<Vec<DurableEvent>, ReadError> {
            if row.last_committed_seq == NO_SEQ {
                return Ok(Vec::new());
            }
            let turns = ai_chat_turns::list_for_session(&row.org_id, &row.session_id)
                .await
                .unwrap();
            let rows = self.rows.lock().clone();
            let resolver = Resolver::new(row, &turns);
            Ok(
                verify_window(rows, NO_SEQ, row.last_committed_seq, &resolver)?
                    .into_iter()
                    .map(|(_, event)| event)
                    .collect(),
            )
        }
    }

    /// The source run's session, as SysRcaAgent's `sre-rca` chat.
    fn source_session(org_id: &str, events: &[DurableEvent]) -> ai_chat_sessions::Model {
        session_rows::Model {
            org_id: org_id.to_string(),
            session_id: "0195a1b2-c3d4-7e5f-8a9b-50a7ce000001".to_string(),
            user_id: "sys-rca-agent-id".to_string(),
            user_email: "sre-agent@rca.openobserve.ai".to_string(),
            opencode_session_id: Some(events[0].aggregate_id.clone()),
            agent_type: RCA_AGENT_TYPE.to_string(),
            title: "Analyze incident inc_1 \"checkout errors\"".to_string(),
            title_source: TITLE_FROM_PROMPT.to_string(),
            status: STATUS_ACTIVE.to_string(),
            created_at: 1,
            updated_at: 1,
            first_event_at: Some(1),
            last_event_at: Some(2),
            last_committed_seq: events.last().map_or(NO_SEQ, |e| e.seq),
            session_epoch: 3,
            last_turn_id: None,
            forked_from_share: None,
            fork_seed_seq: None,
            replica_purged_at: None,
            pinned: false,
            pinned_at: None,
            seed: None,
            search_text: None,
        }
    }

    fn new_org() -> String {
        format!("fork_{}", sea_orm::prelude::Uuid::new_v4().simple())
    }

    async fn org_sessions(org_id: &str) -> Vec<ai_chat_sessions::Model> {
        session_rows::Entity::find()
            .filter(session_rows::Column::OrgId.eq(org_id))
            .all(infra::db::get_orm_client_rw().await)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_fork_commits_the_prefix_under_new_ids_in_a_new_session() {
        let _db = db().await;
        let org = new_org();
        let events = load_replay();
        let cut = 30;
        assert!(events.len() > cut + 1);
        let prefix = events[..=cut].to_vec();
        let source = source_session(&org, &events);
        let store = Store::default();

        let fork = fork_run_session_with(
            &store,
            async |row: &ai_chat_sessions::Model| store.read(row).await,
            &org,
            &source,
            prefix.clone(),
            "run_src",
        )
        .await
        .unwrap();

        assert_eq!(fork.last_seq, cut as i64);
        assert_ne!(fork.session_id, source.session_id);
        let row = ai_chat_sessions::get(&org, &fork.session_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.agent_type, RCA_AGENT_TYPE);
        assert_eq!(
            (row.user_id.as_str(), row.user_email.as_str()),
            (source.user_id.as_str(), source.user_email.as_str())
        );
        assert_eq!(row.title, source.title);
        assert_eq!(row.status, STATUS_ACTIVE);
        assert_eq!(row.last_committed_seq, cut as i64);
        assert!(row.first_event_at.is_some() && row.last_event_at >= row.first_event_at);
        assert_eq!(org_sessions(&org).await.len(), 1);

        let read = store.read(&row).await.unwrap();
        assert_eq!(
            read.iter().map(|e| e.seq).collect::<Vec<_>>(),
            (0..=cut as i64).collect::<Vec<_>>()
        );
        id_map(&prefix, &read);
        assert!(every_id(&read).is_disjoint(&every_id(&prefix)));
        assert!(
            read.iter()
                .all(|e| Some(e.aggregate_id.as_str()) == row.opencode_session_id.as_deref())
        );
        assert!(
            store
                .rows
                .lock()
                .iter()
                .all(|r| r.turn_id == "resume-run_src" && r.session_id == fork.session_id)
        );
        let calls = store.calls.lock().clone();
        assert_eq!(calls.first(), Some(&"bind"));
        assert_eq!(
            calls.last(),
            Some(&"advance"),
            "the watermark moves after every write: {calls:?}"
        );
        assert_eq!(calls.iter().filter(|c| **c == "advance").count(), 1);

        // A fork of the fork: fresh ids again, the same events.
        let store2 = Store::default();
        let again = fork_run_session_with(
            &store2,
            async |row: &ai_chat_sessions::Model| store2.read(row).await,
            &org,
            &row,
            read.clone(),
            "run_resumed",
        )
        .await
        .unwrap();
        let row2 = ai_chat_sessions::get(&org, &again.session_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row2.title, source.title);
        let read2 = store2.read(&row2).await.unwrap();
        id_map(&read, &read2);
        id_map(&prefix, &read2);
        let ids2 = every_id(&read2);
        assert!(ids2.is_disjoint(&every_id(&read)) && ids2.is_disjoint(&every_id(&prefix)));
    }

    #[tokio::test]
    async fn a_failed_copy_leaves_no_readable_session() {
        let _db = db().await;
        let org = new_org();
        let events = load_replay();
        let source = source_session(&org, &events);
        let store = Store {
            refuse_writes: true,
            ..Default::default()
        };

        let result = fork_run_session_with(
            &store,
            async |row: &ai_chat_sessions::Model| store.read(row).await,
            &org,
            &source,
            events.clone(),
            "run_src",
        )
        .await;

        assert!(result.is_err());
        assert!(!store.calls.lock().contains(&"advance"));
        let rows = org_sessions(&org).await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].last_committed_seq, NO_SEQ);
        assert!(
            crate::ai_chat::read_committed_events(&rows[0], NO_SEQ)
                .await
                .unwrap()
                .is_empty(),
            "no committed history"
        );

        let short = Store::default();
        let result = fork_run_session_with(
            &short,
            async |_row: &ai_chat_sessions::Model| Ok::<_, ReadError>(Vec::new()),
            &org,
            &source,
            events.clone(),
            "run_src",
        )
        .await;
        assert!(
            result.is_err(),
            "a copy that does not read back whole is no fork"
        );
    }

    #[tokio::test]
    async fn a_prefix_that_is_not_contiguous_from_seq_0_is_refused() {
        let _db = db().await;
        let org = new_org();
        let events = load_replay();
        let source = source_session(&org, &events);
        let mut holed = events[..=10].to_vec();
        holed.remove(5);
        for prefix in [Vec::new(), events[1..=10].to_vec(), holed] {
            let store = Store::default();
            let result = fork_run_session_with(
                &store,
                async |row: &ai_chat_sessions::Model| store.read(row).await,
                &org,
                &source,
                prefix,
                "run_src",
            )
            .await;
            assert!(result.is_err());
            assert!(store.calls.lock().is_empty());
        }
        assert!(org_sessions(&org).await.is_empty());
    }
}
