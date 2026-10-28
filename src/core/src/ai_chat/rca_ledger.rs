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

use std::collections::HashMap;

use config::{
    meta::{
        alerts::rca_steering::{
            MAX_AGENT_NOTE_CHARS, STEER_NOTICE, SteerHeader, SteerStatus, parse_steer_header,
        },
        oncall::{
            confidence::{ToolCallRecord, signal_class, stream_type},
            rca_run::{
                LedgerCall, LedgerTool, RcaSubmit, evidence_target, exit_code, observed_window,
                parse_submit, summarize_result,
            },
        },
    },
    utils::json::{Map, Value},
};
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;

use super::{
    projection::{Folded, obj},
    rca_thread::{
        SUBMIT_REPORT, ThreadPart, ToolPart, error_text, key_arg, ms_to_us, tool_body,
        updated_part, user_text,
    },
};

const RECORD_HYPOTHESIS: &str = "record_hypothesis";
const RECORD_BLIND_SPOT: &str = "record_blind_spot";
const ACKNOWLEDGE_STEERING: &str = "acknowledge_steering";
pub(crate) const ASK_RESPONDERS: &str = "ask_responders";

/// A run's committed transcript as the verdict pipeline reads it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunTranscript {
    /// Completed `record_hypothesis` and `record_blind_spot` calls, in seq order.
    pub calls: Vec<LedgerCall>,
    /// Visible tool calls that completed or failed, in thread order.
    pub tool_log: Vec<ToolCallRecord>,
    /// The stages of the run's `record_step` calls, each once, in order.
    pub stages_run: Vec<String>,
    /// The input of the last completed `submit_report` that parses.
    pub submit: Option<RcaSubmit>,
    /// The steering messages in the session, in message order.
    pub steers: Vec<TranscriptSteer>,
    /// Completed `acknowledge_steering` calls, in seq order; the first per steer id counts.
    pub acks: Vec<TranscriptAck>,
    /// Completed `ask_responders` calls, in seq order.
    pub questions: Vec<TranscriptQuestion>,
    /// The last completed sentinel is an unanswered ask_responders call.
    pub open_question: Option<TranscriptQuestion>,
}

/// A steering message the session holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptSteer {
    pub steer_id: String,
    /// The opencode user message that carries it.
    pub opencode_message_id: String,
    /// µs: the message's `time.created`.
    pub created_us: i64,
    pub read_at_us: Option<i64>,
}

/// One completed `acknowledge_steering` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptAck {
    pub steer_id: String,
    /// `Applied` or `Declined`.
    pub action: SteerStatus,
    /// Trimmed, at most [MAX_AGENT_NOTE_CHARS]; `None` when empty.
    pub note: Option<String>,
    /// µs: the tool part's end time, else its start.
    pub acted_at_us: i64,
}

/// One completed `ask_responders` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptQuestion {
    /// The call's `callID`.
    pub question_id: String,
    pub question: String,
    pub need: String,
    pub hypothesis_id: Option<String>,
    /// µs: the call's start.
    pub at_us: i64,
}

/// One steering message inside a user message: its header and the responder's text.
pub(crate) struct SteerBlock {
    pub(crate) header: SteerHeader,
    /// Without the header and the fixed notice line, as the responder wrote it.
    pub(crate) text: String,
}

/// Only server headers at message boundaries split responder text into steering blocks.
pub(crate) fn split_steers(text: &str) -> (String, Vec<SteerBlock>) {
    let mut preamble: Vec<&str> = Vec::new();
    let mut blocks: Vec<(SteerHeader, Vec<&str>)> = Vec::new();
    let mut after_blank = true;
    for line in text.split('\n') {
        let header = if after_blank {
            parse_steer_header(line)
        } else {
            None
        };
        after_blank = line.trim().is_empty();
        if let Some(header) = header {
            blocks.push((header, Vec::new()));
        } else if let Some((_, body)) = blocks.last_mut() {
            body.push(line);
        } else {
            preamble.push(line);
        }
    }
    let blocks = blocks
        .into_iter()
        .map(|(header, body)| {
            let body = match body.first() {
                Some(first) if first.trim_end_matches('\r') == STEER_NOTICE => &body[1..],
                _ => &body[..],
            };
            let text = body
                .iter()
                .map(|&line| match line.strip_prefix(' ') {
                    Some(rest) if rest.starts_with("[o2-") => rest,
                    _ => line,
                })
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();
            SteerBlock { header, text }
        })
        .collect();
    (preamble.join("\n").trim().to_string(), blocks)
}

/// The question of a completed `ask_responders` part.
pub(crate) fn question_of(call: &ToolPart<'_>) -> TranscriptQuestion {
    let text = |key: &str| {
        call.arg(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string()
    };
    let hypothesis_id = Some(text("hypothesis_id")).filter(|id| !id.is_empty());
    TranscriptQuestion {
        question_id: call.call_id(),
        question: text("question"),
        need: text("need"),
        hypothesis_id,
        at_us: call.started_at().unwrap_or_default(),
    }
}

fn ack_of(call: &ToolPart<'_>) -> Option<TranscriptAck> {
    let steer_id = call.arg("steer_id")?.as_str()?.trim();
    if steer_id.is_empty() {
        return None;
    }
    let action = match call.arg("action")?.as_str()?.trim() {
        "applied" => SteerStatus::Applied,
        "declined" => SteerStatus::Declined,
        _ => return None,
    };
    let note = call
        .arg("note")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(|note| note.chars().take(MAX_AGENT_NOTE_CHARS).collect());
    Some(TranscriptAck {
        steer_id: steer_id.to_string(),
        action,
        note,
        acted_at_us: call
            .ended_at()
            .or_else(|| call.started_at())
            .unwrap_or_default(),
    })
}

/// Only a hypothesis, blind spot, report or new question closes an open question.
fn closes_question(call: &ToolPart<'_>) -> bool {
    [
        RECORD_HYPOTHESIS,
        RECORD_BLIND_SPOT,
        SUBMIT_REPORT,
        ASK_RESPONDERS,
    ]
    .contains(&call.tool)
}

/// Decode the committed events of an RCA session.
pub fn decode_run(events: &[DurableEvent]) -> RunTranscript {
    let folded = Folded::fold(events);
    let seqs: HashMap<&str, i64> = events
        .iter()
        .filter_map(|event| {
            let id = updated_part(event)?.get("id")?.as_str()?;
            Some((id, event.seq))
        })
        .collect();

    let mut transcript = RunTranscript::default();
    let mut submits: Vec<(i64, Value)> = Vec::new();
    let mut acks: Vec<(i64, TranscriptAck)> = Vec::new();
    let mut questions: Vec<(i64, TranscriptQuestion)> = Vec::new();
    // Steers not read yet; the next assistant message reads them all.
    let mut unread: Vec<usize> = Vec::new();
    let mut unanswered_user: Option<usize> = None;
    let mut last_read_user: Option<usize> = None;
    // The last completed closing sentinel: its seq, message position and question, if one.
    let mut last_sentinel: Option<(i64, usize, Option<TranscriptQuestion>)> = None;
    let empty = Map::new();
    for (position, (msg_id, info)) in folded.infos.iter().enumerate() {
        let created_us = obj(info.get("time")).and_then(|t| ms_to_us(t.get("created")));
        let parts = folded.parts.get(msg_id).unwrap_or(&empty);
        match info.get("role").and_then(Value::as_str) {
            Some("user") => {
                let (_, blocks) = split_steers(&user_text(parts));
                for block in blocks {
                    unread.push(transcript.steers.len());
                    transcript.steers.push(TranscriptSteer {
                        steer_id: block.header.steer_id,
                        opencode_message_id: msg_id.clone(),
                        created_us: created_us.unwrap_or_default(),
                        read_at_us: None,
                    });
                }
                unanswered_user = Some(position);
                continue;
            }
            Some("assistant") => {
                for i in unread.drain(..) {
                    transcript.steers[i].read_at_us = created_us;
                }
                if let Some(user) = unanswered_user.take() {
                    last_read_user = Some(user);
                }
            }
            _ => continue,
        }
        for part in parts.values().filter_map(Value::as_object) {
            let Some(call) = ToolPart::of(part) else {
                continue;
            };
            let seq = part
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| seqs.get(id).copied())
                .unwrap_or(-1);
            let mut question = None;
            match call.kind() {
                ThreadPart::Step(Some(stage)) => {
                    if !transcript.stages_run.iter().any(|s| s == stage) {
                        transcript.stages_run.push(stage.to_string());
                    }
                }
                ThreadPart::Step(None) | ThreadPart::FailedStep => {}
                ThreadPart::Hidden if call.status == "completed" => {
                    let tool = match call.tool {
                        RECORD_HYPOTHESIS => Some(LedgerTool::Hypothesis),
                        RECORD_BLIND_SPOT => Some(LedgerTool::BlindSpot),
                        SUBMIT_REPORT => {
                            submits.push((seq, Value::Object(call.args())));
                            None
                        }
                        ACKNOWLEDGE_STEERING => {
                            if let Some(ack) = ack_of(&call) {
                                acks.push((seq, ack));
                            }
                            None
                        }
                        ASK_RESPONDERS => {
                            let asked = question_of(&call);
                            questions.push((seq, asked.clone()));
                            question = Some(asked);
                            None
                        }
                        _ => None,
                    };
                    if let Some(tool) = tool {
                        transcript.calls.push(LedgerCall {
                            seq,
                            at_us: call.started_at().unwrap_or_default(),
                            tool,
                            input: Value::Object(call.args()),
                        });
                    }
                }
                ThreadPart::Hidden => {}
                ThreadPart::Row => {
                    if let Some(record) = tool_record(&call) {
                        transcript.tool_log.push(record);
                    }
                }
            }
            if call.status == "completed"
                && closes_question(&call)
                && last_sentinel.as_ref().is_none_or(|(last, ..)| seq >= *last)
            {
                last_sentinel = Some((seq, position, question));
            }
        }
    }
    transcript.calls.sort_by_key(|call| call.seq);
    submits.sort_by_key(|(seq, _)| std::cmp::Reverse(*seq));
    transcript.submit = submits.iter().find_map(|(_, input)| parse_submit(input));
    acks.sort_by_key(|(seq, _)| *seq);
    transcript.acks = acks.into_iter().map(|(_, ack)| ack).collect();
    questions.sort_by_key(|(seq, _)| *seq);
    transcript.questions = questions.into_iter().map(|(_, q)| q).collect();
    transcript.open_question = match last_sentinel {
        Some((_, position, Some(question)))
            if last_read_user.is_none_or(|user| user < position) =>
        {
            Some(question)
        }
        _ => None,
    };
    transcript
}

/// The tool log entry of a visible tool part that completed or failed.
fn tool_record(call: &ToolPart<'_>) -> Option<ToolCallRecord> {
    let completed = match call.status {
        "completed" => true,
        "error" => false,
        _ => return None,
    };
    let args = call.args();
    let key_arg = key_arg(call.tool, &args).unwrap_or_default();
    let input = Value::Object(args);
    let target = evidence_target(call.tool, &input);
    let empty = Map::new();
    let state = call.state.unwrap_or(&empty);
    let body = completed.then(|| tool_body(state));
    let failure = body
        .as_ref()
        .and_then(|body| completed_call_failure(call.tool, state, body));
    let success = completed && failure.is_none();
    let (result_summary, result_count, error_type, observed) = match (body, failure) {
        (Some(body), None) => {
            let (summary, count) = summarize_result(call.tool, &body);
            (
                summary,
                count,
                None,
                observed_window(call.tool, &body, &target),
            )
        }
        (_, failure) => (
            String::new(),
            None,
            Some(failure.unwrap_or_else(|| error_text(state.get("error")))),
            None,
        ),
    };
    let started_at = call.started_at();
    let duration_ms = started_at.zip(call.ended_at()).map_or(0, |(start, end)| {
        u64::try_from((end - start) / 1000).unwrap_or(0)
    });
    Some(ToolCallRecord {
        call_id: call.call_id(),
        tool: call.tool.to_string(),
        key_arg,
        stream_type: stream_type(call.tool, &input),
        success,
        result_count,
        started_at_us: started_at.unwrap_or_default(),
        duration_ms,
        error_type,
        signal: signal_class(call.tool, &input),
        target,
        observed,
        result_summary,
    })
}

/// Why a completed shell or `cli_*` call failed: a non-zero exit, or the CLI endpoint's error.
fn completed_call_failure(tool: &str, state: &Map<String, Value>, body: &Value) -> Option<String> {
    match exit_code(tool, state.get("metadata"), body) {
        Some(0) => None,
        Some(code) => Some(format!("exit {code}")),
        None if tool.starts_with("cli_") => body.get("error").map(|e| error_text(Some(e))),
        None => None,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use config::{
        meta::{alerts::rca_steering::SteerKind, oncall::confidence::SignalClass},
        utils::json::{Value, json},
    };

    use super::*;
    use crate::ai_chat::rca_thread::tests::{Session, T, hits, search_sql};

    pub(crate) const SQL_ERRORS: &str = "SELECT count(*) FROM app_logs WHERE level = 'error'";
    pub(crate) const SQL_FAILED: &str = "SELECT * FROM db_logs";
    pub(crate) const PROMQL: &str = "sum(rate(db_pool_wait_seconds[5m]))";
    pub(crate) const INCIDENT_ARG: &str = r#"{"incident_id":"inc_1"}"#;
    pub(crate) const H1: &str = "The orders-db pool ran dry";
    pub(crate) const H2: &str = "A node ran out of CPU";

    /// One evidence item of a `record_hypothesis` input.
    pub(crate) fn item(id: &str, tool: &str, query: &str, polarity: &str, strength: &str) -> Value {
        json!({"id": id, "tool": tool, "query": query, "polarity": polarity, "strength": strength, "observation": format!("{id} observed")})
    }

    pub(crate) fn hypothesis(
        id: &str,
        statement: &str,
        status: &str,
        evidence: Vec<Value>,
    ) -> Value {
        json!({"id": id, "statement": statement, "status": status, "reason": format!("{id} is {status}"), "evidence": evidence})
    }

    /// A `submit_report` verdict.
    pub(crate) fn verdict(probable_cause: &str, confidence: &str, outcome: &str) -> Value {
        json!({
            "probable_cause": probable_cause,
            "claimed_confidence": confidence,
            "claimed_outcome": outcome,
            "page_recommendation": {"action": "page", "reason": "customers see errors"},
            "report_ref": "report",
        })
    }

    pub(crate) fn ledger_session(stages: &[&str]) -> Session {
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        for (i, stage) in stages.iter().enumerate() {
            let at = 100 + i as i64 * 10;
            s.tool(
                "msg_a1",
                &format!("prt_s{i}"),
                "record_step",
                "completed",
                json!({"stage": stage, "title": format!("Step {stage}")}),
                json!({"output": "{\"type\":\"rca_step\"}"}),
                at,
                at + 1,
            );
        }
        s.tool(
            "msg_a1",
            "prt_g1",
            "o2_GetIncident",
            "completed",
            json!({"incident_id": "inc_1", "_o2_session": "secret"}),
            json!({"output": "{\"id\":\"inc_1\",\"title\":\"checkout errors\"}"}),
            200,
            260,
        );
        s.tool(
            "msg_a1",
            "prt_b1",
            "bash",
            "completed",
            json!({"command": "ls"}),
            json!({"output": "a\nb"}),
            300,
            310,
        );
        s.tool(
            "msg_a1",
            "prt_t1",
            "o2_SearchSQL",
            "completed",
            search_sql(SQL_ERRORS),
            hits(42),
            1_100,
            1_142,
        );
        let mut h1a = hypothesis(
            "h1",
            H1,
            "testing",
            vec![item(
                "e1",
                "SearchSQL",
                SQL_ERRORS,
                "supports",
                "supporting",
            )],
        );
        h1a["_o2_session"] = json!("secret");
        s.tool(
            "msg_a1",
            "prt_h1a",
            "record_hypothesis",
            "completed",
            h1a,
            json!({"output": "{\"type\":\"rca_hypothesis\"}"}),
            1_200,
            1_201,
        );
        s.tool(
            "msg_a1",
            "prt_t2",
            "o2_tools_call",
            "completed",
            json!({"tool": "o2_PrometheusRangeQuery", "args": {"query": PROMQL}}),
            json!({"output": "{\"data\":{\"result\":[{\"values\":[[1,\"1\"],[2,\"2\"]]},{\"values\":[[1,\"3\"]]}]}}"}),
            2_100,
            2_350,
        );
        s.tool(
            "msg_a1",
            "prt_t3",
            "o2_SearchSQL",
            "error",
            search_sql(SQL_FAILED),
            json!({"error": "connection refused"}),
            2_400,
            2_410,
        );
        s.tool(
            "msg_a1",
            "prt_hx",
            "record_hypothesis",
            "error",
            hypothesis("h1", "An errored call", "symptom", vec![]),
            json!({"error": "invalid input"}),
            2_500,
            2_501,
        );
        s.tool(
            "msg_a1",
            "prt_t4",
            "o2_GetLatestTraces",
            "running",
            json!({"stream_name": "default"}),
            json!({}),
            2_600,
            2_600,
        );
        s.tool(
            "msg_a1",
            "prt_h2",
            "record_hypothesis",
            "completed",
            hypothesis(
                "h2",
                H2,
                "ruled_out",
                vec![item(
                    "e3",
                    "GetIncident",
                    INCIDENT_ARG,
                    "rules_out",
                    "decisive",
                )],
            ),
            json!({"output": "{}"}),
            2_700,
            2_701,
        );
        let h1b = hypothesis(
            "h1",
            H1,
            "root_cause",
            vec![
                item("e1", "SearchSQL", SQL_ERRORS, "supports", "decisive"),
                item("e2", "PrometheusRangeQuery", PROMQL, "supports", "decisive"),
                item("e4", "SearchSQL", SQL_FAILED, "supports", "supporting"),
            ],
        );
        s.tool(
            "msg_a1",
            "prt_h1b",
            "record_hypothesis",
            "pending",
            h1b.clone(),
            json!({}),
            3_000,
            3_000,
        );
        s.tool(
            "msg_a1",
            "prt_h1b",
            "record_hypothesis",
            "completed",
            h1b,
            json!({"output": "{}"}),
            3_000,
            3_001,
        );
        s.tool(
            "msg_a1",
            "prt_l1",
            "record_blind_spot",
            "completed",
            json!({"id": "b1", "axis": "traces", "title": "Trace sampling at 1%", "why": "Few traces kept", "fix": "sampling_rules"}),
            json!({"output": "{}"}),
            3_100,
            3_101,
        );
        s
    }

    /// Adds one `submit_report` part.
    pub(crate) fn submit(s: &mut Session, id: &str, status: &str, input: Value, at: i64) {
        s.tool(
            "msg_a1",
            id,
            "submit_report",
            status,
            input,
            json!({"output": "{\"type\":\"rca_report\"}"}),
            at,
            at + 1,
        );
    }

    fn seq_of(events: &[DurableEvent], part_id: &str) -> i64 {
        events
            .iter()
            .filter(|e| e.data["part"]["id"] == part_id)
            .map(|e| e.seq)
            .next_back()
            .unwrap()
    }

    fn us(ms: i64) -> i64 {
        (T + ms) * 1000
    }

    #[test]
    fn ledger_calls_are_the_completed_record_calls_in_seq_order() {
        let events = ledger_session(&["context"]).events;
        let run = decode_run(&events);

        let calls: Vec<(LedgerTool, &str, i64, i64)> = run
            .calls
            .iter()
            .map(|c| (c.tool, c.input["id"].as_str().unwrap(), c.seq, c.at_us))
            .collect();
        assert_eq!(
            calls,
            vec![
                (
                    LedgerTool::Hypothesis,
                    "h1",
                    seq_of(&events, "prt_h1a"),
                    us(1_200)
                ),
                (
                    LedgerTool::Hypothesis,
                    "h2",
                    seq_of(&events, "prt_h2"),
                    us(2_700)
                ),
                (
                    LedgerTool::Hypothesis,
                    "h1",
                    seq_of(&events, "prt_h1b"),
                    us(3_000)
                ),
                (
                    LedgerTool::BlindSpot,
                    "b1",
                    seq_of(&events, "prt_l1"),
                    us(3_100)
                ),
            ]
        );
        assert!(
            run.calls.windows(2).all(|w| w[0].seq < w[1].seq),
            "seq order"
        );
        assert_eq!(run.calls[0].input["status"], "testing");
        assert_eq!(run.calls[2].input["status"], "root_cause");
        assert!(
            run.calls
                .iter()
                .all(|c| c.input.get("_o2_session").is_none()),
            "the session argument is not the agent's input"
        );
        assert!(
            run.calls
                .iter()
                .all(|c| c.input["statement"] != "An errored call"),
            "an errored call is not in the ledger"
        );
    }

    #[test]
    fn the_tool_log_holds_the_visible_finished_calls_as_the_thread_names_them() {
        let events = ledger_session(&["context"]).events;
        let run = decode_run(&events);

        let ids: Vec<&str> = run.tool_log.iter().map(|r| r.call_id.as_str()).collect();
        assert_eq!(
            ids,
            ["call_prt_g1", "call_prt_t1", "call_prt_t2", "call_prt_t3"]
        );
        let (get, sql, prom, failed) = (
            &run.tool_log[0],
            &run.tool_log[1],
            &run.tool_log[2],
            &run.tool_log[3],
        );

        // The thread's key argument, for the same parts.
        let thread_key =
            |tool: &str, input: Value| key_arg(tool, input.as_object().unwrap()).unwrap();
        assert_eq!(get.tool, "GetIncident");
        assert_eq!(get.key_arg, INCIDENT_ARG);
        assert_eq!(
            get.key_arg,
            thread_key("GetIncident", json!({"incident_id": "inc_1"}))
        );
        assert_eq!(get.signal, SignalClass::Context);
        assert_eq!(get.stream_type, None);
        assert!(get.success);

        assert_eq!(sql.tool, "SearchSQL");
        assert_eq!(sql.key_arg, SQL_ERRORS);
        assert_eq!(sql.key_arg, thread_key("SearchSQL", search_sql(SQL_ERRORS)));
        assert_eq!(sql.stream_type.as_deref(), Some("logs"));
        assert_eq!(sql.signal, SignalClass::Logs);
        assert_eq!(
            sql.target,
            evidence_target("SearchSQL", &search_sql(SQL_ERRORS))
        );
        assert_eq!(sql.target.sql.as_deref(), Some(SQL_ERRORS));
        assert_eq!(sql.target.streams, ["app_logs"]);
        assert_eq!(sql.result_summary, "42 rows · took 3 ms");
        assert_eq!(sql.result_count, Some(42));
        assert_eq!((sql.started_at_us, sql.duration_ms), (us(1_100), 42));
        assert!(sql.success);
        assert_eq!(sql.error_type, None);

        assert_eq!(prom.tool, "PrometheusRangeQuery", "tools_call is unwrapped");
        assert_eq!(prom.key_arg, PROMQL);
        assert_eq!(
            prom.key_arg,
            thread_key("PrometheusRangeQuery", json!({"query": PROMQL}))
        );
        assert_eq!(prom.stream_type, None);
        assert_eq!(prom.signal, SignalClass::Metrics);
        assert_eq!(prom.target.promql.as_deref(), Some(PROMQL));
        assert_eq!(prom.result_summary, "2 series · 3 points");
        assert_eq!(prom.result_count, Some(2));
        assert_eq!((prom.started_at_us, prom.duration_ms), (us(2_100), 250));

        assert_eq!(failed.tool, "SearchSQL");
        assert_eq!(failed.key_arg, SQL_FAILED);
        assert!(!failed.success);
        assert_eq!(failed.result_count, None);
        assert!(
            failed
                .error_type
                .as_deref()
                .is_some_and(|e| e.contains("connection refused")),
            "{:?}",
            failed.error_type
        );
    }

    /// Impact-window cap: a finished search records the span of data timestamps its rows showed.
    #[test]
    fn a_tool_record_keeps_the_span_of_data_its_rows_showed() {
        use config::meta::oncall::rca_run::TimeWindow;

        // Queried 19:05–19:50; the rows end at 19:35:08.
        let input = json!({"type": "logs", "request_body": {"query": {
            "sql": SQL_ERRORS, "start_time": 1_792_177_500_000_000_i64, "end_time": 1_792_180_200_000_000_i64}}});
        let rows = json!({"took": 3, "total": 2, "hits": [
            {"_timestamp": 1_792_178_590_943_220_i64, "status": 503},
            {"_timestamp": 1_792_179_308_166_386_i64, "status": 503},
        ]});
        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        s.tool(
            "msg_a1",
            "prt_t1",
            "o2_SearchSQL",
            "completed",
            input.clone(),
            json!({"output": rows.to_string()}),
            1_100,
            1_142,
        );
        s.tool(
            "msg_a1",
            "prt_t2",
            "o2_SearchSQL",
            "error",
            input,
            json!({"error": "connection refused"}),
            1_200,
            1_210,
        );
        let run = decode_run(&s.events);

        assert_eq!(
            run.tool_log[0].observed,
            Some(TimeWindow {
                start: 1_792_178_590_943_220,
                end: 1_792_179_308_166_386
            })
        );
        assert_eq!(run.tool_log[1].observed, None);
    }

    /// An org AI Toolset call keeps opencode's `<server>_<tool>` name in the tool log.
    #[test]
    fn toolset_calls_are_recorded_with_their_server_and_cited_by_their_tool() {
        use config::meta::oncall::confidence::match_citation;

        let mut s = Session::new();
        s.message("msg_u1", "user", json!({"created": T}));
        s.message("msg_a1", "assistant", json!({"created": T + 100}));
        s.tool(
            "msg_a1",
            "prt_c1",
            "orca-demo-code_read_file",
            "completed",
            json!({"path": "src/payment/charge.js"}),
            json!({"output": "module.exports.charge = ..."}),
            1_100,
            1_112,
        );
        s.tool(
            "msg_a1",
            "prt_c2",
            "orca-demo-code_git_show",
            "completed",
            json!({"sha": "4f2c1e"}),
            json!({"output": "diff --git a/src/payment/charge.js"}),
            1_200,
            1_220,
        );
        let run = decode_run(&s.events);

        let (read, show) = (&run.tool_log[0], &run.tool_log[1]);
        assert_eq!(read.tool, "orca-demo-code_read_file");
        assert_eq!(read.signal, SignalClass::Context);
        assert_eq!(show.tool, "orca-demo-code_git_show");
        assert_eq!(show.signal, SignalClass::Change);
        for cited in ["read_file", "orca-demo-code_read_file"] {
            let matched =
                match_citation(cited, r#"{"path":"src/payment/charge.js"}"#, &run.tool_log);
            assert_eq!(
                matched.map(|r| r.call_id.as_str()),
                Ok("call_prt_c1"),
                "{cited}"
            );
        }
        let matched = match_citation("git_show", r#"{"sha":"4f2c1e"}"#, &run.tool_log);
        assert_eq!(matched.map(|r| r.call_id.as_str()), Ok("call_prt_c2"));
    }

    #[test]
    fn stages_run_once_each_and_the_last_completed_report_is_the_submit() {
        let mut s = ledger_session(&["context", "topology", "context", "gather", "changes"]);
        submit(
            &mut s,
            "prt_p1",
            "completed",
            json!({"markdown": "first", "verdict": verdict(H1, "low", "inconclusive")}),
            4_000,
        );
        submit(
            &mut s,
            "prt_p2",
            "completed",
            json!({"markdown": "second", "verdict": verdict(H1, "high", "root_cause_identified")}),
            4_100,
        );
        submit(
            &mut s,
            "prt_p3",
            "error",
            json!({"markdown": "third"}),
            4_200,
        );
        let run = decode_run(&s.events);

        assert_eq!(run.stages_run, ["context", "topology", "changes"]);
        let submit = run.submit.expect("a submit");
        assert_eq!(submit.markdown, "second");
        assert_eq!(submit.verdict.unwrap().probable_cause, H1);
        assert_eq!(decode_run(&ledger_session(&[]).events).submit, None);
    }

    #[test]
    fn a_shell_call_carries_its_command_in_the_target() {
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        for (id, tool, input) in [
            (
                "prt_c1",
                "cli_kubectl",
                json!({"command": "kubectl get pods"}),
            ),
            ("prt_c2", "shell", json!({"cmd": "git show abc"})),
            ("prt_c3", "bash", json!({"command": "gh pr diff 812"})),
        ] {
            s.tool(
                "msg_a1",
                id,
                tool,
                "completed",
                input,
                json!({"output": "a\nb", "metadata": {"exit": 0}}),
                100,
                110,
            );
        }
        let run = decode_run(&s.events);

        let log: Vec<(&str, &str, Option<&str>)> = run
            .tool_log
            .iter()
            .map(|r| {
                (
                    r.tool.as_str(),
                    r.key_arg.as_str(),
                    r.target.command.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            log,
            [
                ("cli_kubectl", "kubectl get pods", Some("kubectl get pods")),
                ("shell", "git show abc", Some("git show abc")),
            ]
        );
        assert_eq!(run.tool_log[0].signal, SignalClass::Infra);
    }

    /// A shell or CLI call that exits non-zero, or whose CLI endpoint failed, ran but read nothing.
    #[test]
    fn a_completed_call_that_exited_non_zero_failed() {
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        for (id, tool, output) in [
            (
                "prt_c1",
                "shell",
                json!({"output": "diff --git", "metadata": {"exit": 0}}),
            ),
            (
                "prt_c2",
                "shell",
                json!({"output": "HTTP 403", "metadata": {"exit": 1}}),
            ),
            (
                "prt_c3",
                "cli_gh",
                json!({"output": "{\"return_code\": 0, \"stdout\": \"a\\nb\"}"}),
            ),
            (
                "prt_c4",
                "cli_gh",
                json!({"output": "{\"return_code\": 2, \"stderr\": \"no\"}"}),
            ),
            (
                "prt_c5",
                "cli_gh",
                json!({"output": "{\"error\": \"HTTP 502\"}"}),
            ),
        ] {
            s.tool(
                "msg_a1",
                id,
                tool,
                "completed",
                json!({"command": "gh pr diff 812"}),
                output,
                100,
                110,
            );
        }
        let run = decode_run(&s.events);
        let log: Vec<(bool, Option<&str>, &str)> = run
            .tool_log
            .iter()
            .map(|r| {
                (
                    r.success,
                    r.error_type.as_deref(),
                    r.result_summary.as_str(),
                )
            })
            .collect();
        assert_eq!(
            log,
            [
                (true, None, "exit 0 · 1 line"),
                (false, Some("exit 1"), ""),
                (true, None, "exit 0 · 2 lines"),
                (false, Some("exit 2"), ""),
                (false, Some("HTTP 502"), ""),
            ]
        );
    }

    /// The `[ref …]` line o2-ai appends does not break reading the result.
    #[test]
    fn a_result_with_its_ref_line_still_parses() {
        let mut s = Session::new();
        s.message("msg_a1", "assistant", json!({"created": T}));
        let mut output = hits(3);
        output["output"] = json!(format!(
            "{}\n\n[ref tkx3uh]",
            output["output"].as_str().unwrap()
        ));
        s.tool(
            "msg_a1",
            "prt_c1",
            "o2_SearchSQL",
            "completed",
            search_sql("SELECT 1"),
            output,
            100,
            110,
        );
        let run = decode_run(&s.events);
        assert_eq!(run.tool_log[0].result_count, Some(3));
    }

    // ---- steering and questions in the transcript ----

    pub(crate) const RESPONDER: &str = "a.rao@acme.io";
    pub(crate) const S1: &str = "stg_2NjLm8W3pXyZqR7tVbK9cDfGhJ1";
    pub(crate) const S2: &str = "stg_2NjLm8W3pXyZqR7tVbK9cDfGhJ2";
    pub(crate) const S3: &str = "stg_2NjLm8W3pXyZqR7tVbK9cDfGhJ3";

    /// A steering message of [RESPONDER] as the relay sends it.
    pub(crate) fn steer_message(
        steer_id: &str,
        kind: SteerKind,
        question_id: Option<&str>,
        text: &str,
    ) -> String {
        let header = SteerHeader {
            steer_id: steer_id.to_string(),
            author: RESPONDER.to_string(),
            at_us: T * 1000,
            kind,
            question_id: question_id.map(str::to_string),
        };
        config::meta::alerts::rca_steering::render_steer_message(&header, text)
    }

    /// A user message with one text part, `created` ms after [T].
    pub(crate) fn user_message(s: &mut Session, id: &str, text: &str, created: i64) {
        s.message(id, "user", json!({"created": T + created}));
        s.part(
            id,
            json!({"id": format!("prt_{id}"), "type": "text", "text": text}),
        );
    }

    /// A completed `ask_responders` call about `h1`.
    pub(crate) fn ask(s: &mut Session, message_id: &str, id: &str, question: &str, at: i64) {
        s.tool(
            message_id,
            id,
            ASK_RESPONDERS,
            "completed",
            json!({"question": question, "need": "deploy time of checkout-api", "hypothesis_id": "h1"}),
            json!({"output": "{\"type\":\"ask_responders\"}"}),
            at,
            at + 1,
        );
    }

    /// A completed `acknowledge_steering` call.
    pub(crate) fn ack(
        s: &mut Session,
        message_id: &str,
        id: &str,
        steer_id: &str,
        action: &str,
        note: &str,
        at: i64,
    ) {
        s.tool(
            message_id,
            id,
            ACKNOWLEDGE_STEERING,
            "completed",
            json!({"steer_id": steer_id, "action": action, "note": note}),
            json!({"output": "{\"type\":\"steering_ack\"}"}),
            at,
            at + 5,
        );
    }

    #[test]
    fn sg20_messages_sent_during_one_step_are_read_at_the_same_assistant_message() {
        let mut s = Session::new();
        user_message(
            &mut s,
            "msg_01",
            "Analyze incident inc_1. Trigger: manual.",
            0,
        );
        s.message("msg_02", "assistant", json!({"created": T + 100}));
        s.tool(
            "msg_02",
            "prt_s1",
            "record_step",
            "completed",
            json!({"stage": "context", "title": "Load context"}),
            json!({"output": "{}"}),
            100,
            101,
        );
        user_message(
            &mut s,
            "msg_03",
            &steer_message(S1, SteerKind::Message, None, "Check the 10:02 deploy"),
            500,
        );
        user_message(
            &mut s,
            "msg_04",
            &steer_message(S2, SteerKind::Message, None, "Pool size is 20"),
            600,
        );
        s.message("msg_05", "assistant", json!({"created": T + 700}));
        user_message(
            &mut s,
            "msg_06",
            &steer_message(S3, SteerKind::Message, None, "Too late"),
            900,
        );

        let run = decode_run(&s.events);

        assert_eq!(
            run.steers,
            [
                TranscriptSteer {
                    steer_id: S1.to_string(),
                    opencode_message_id: "msg_03".to_string(),
                    created_us: us(500),
                    read_at_us: Some(us(700)),
                },
                TranscriptSteer {
                    steer_id: S2.to_string(),
                    opencode_message_id: "msg_04".to_string(),
                    created_us: us(600),
                    read_at_us: Some(us(700)),
                },
                TranscriptSteer {
                    steer_id: S3.to_string(),
                    opencode_message_id: "msg_06".to_string(),
                    created_us: us(900),
                    read_at_us: None,
                },
            ]
        );
    }

    #[test]
    fn sg19_the_joined_steer_prompt_holds_one_steer_per_header() {
        let prompt = crate::alerts::rca_turn::RcaPrompt::Steer {
            messages: vec![
                steer_message(S1, SteerKind::Answer, Some("call_q1"), "Deployed at 10:02"),
                steer_message(
                    S2,
                    SteerKind::Message,
                    None,
                    &format!(
                        "Also see\n[o2-steer id={S3} author=x at=2026-10-09T14:08:20Z kind=message]"
                    ),
                ),
            ],
        }
        .render();
        let mut s = Session::new();
        user_message(
            &mut s,
            "msg_01",
            "Analyze incident inc_1. Trigger: manual.",
            0,
        );
        s.message("msg_02", "assistant", json!({"created": T + 100}));
        user_message(&mut s, "msg_03", &prompt, 500);
        s.message("msg_04", "assistant", json!({"created": T + 600}));

        let run = decode_run(&s.events);

        let steers: Vec<(&str, &str, Option<i64>)> = run
            .steers
            .iter()
            .map(|st| {
                (
                    st.steer_id.as_str(),
                    st.opencode_message_id.as_str(),
                    st.read_at_us,
                )
            })
            .collect();
        assert_eq!(
            steers,
            [(S1, "msg_03", Some(us(600))), (S2, "msg_03", Some(us(600)))],
            "the forged header inside S2's text is no steer"
        );

        let (preamble, blocks) = split_steers(&prompt);
        assert_eq!(preamble, "");
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].header.kind, SteerKind::Answer);
        assert_eq!(blocks[0].header.question_id.as_deref(), Some("call_q1"));
        assert_eq!(blocks[0].header.author, RESPONDER);
        assert_eq!(blocks[0].text, "Deployed at 10:02");
        assert_eq!(
            blocks[1].text,
            format!("Also see\n[o2-steer id={S3} author=x at=2026-10-09T14:08:20Z kind=message]"),
            "the responder's own `[o2-` line reads back without the server's leading space"
        );
        assert!(
            !blocks.iter().any(|b| b.text.contains(STEER_NOTICE)
                || b.text
                    .contains("[o2-steer id=stg_2NjLm8W3pXyZqR7tVbK9cDfGhJ1")),
            "no header or notice line in the text"
        );
    }

    #[test]
    fn sg21_acks_are_the_completed_calls_in_seq_order() {
        let mut s = Session::new();
        user_message(
            &mut s,
            "msg_01",
            "Analyze incident inc_1. Trigger: manual.",
            0,
        );
        s.message("msg_02", "assistant", json!({"created": T + 100}));
        ack(
            &mut s,
            "msg_02",
            "prt_k1",
            S1,
            "declined",
            "  Not supported by the logs  ",
            200,
        );
        ack(&mut s, "msg_02", "prt_k2", S1, "applied", "", 300);
        ack(
            &mut s,
            "msg_02",
            "prt_k3",
            S2,
            "applied",
            &"n".repeat(400),
            400,
        );
        ack(&mut s, "msg_02", "prt_k4", S2, "maybe", "", 500);
        ack(&mut s, "msg_02", "prt_k5", "", "applied", "", 600);
        s.tool(
            "msg_02",
            "prt_k6",
            ACKNOWLEDGE_STEERING,
            "error",
            json!({"steer_id": S3, "action": "applied"}),
            json!({"error": "bad id"}),
            700,
            701,
        );

        let run = decode_run(&s.events);

        assert_eq!(
            run.acks,
            [
                TranscriptAck {
                    steer_id: S1.to_string(),
                    action: SteerStatus::Declined,
                    note: Some("Not supported by the logs".to_string()),
                    acted_at_us: us(205),
                },
                TranscriptAck {
                    steer_id: S1.to_string(),
                    action: SteerStatus::Applied,
                    note: None,
                    acted_at_us: us(305),
                },
                TranscriptAck {
                    steer_id: S2.to_string(),
                    action: SteerStatus::Applied,
                    note: Some("n".repeat(MAX_AGENT_NOTE_CHARS)),
                    acted_at_us: us(405),
                },
            ]
        );
        assert!(run.calls.is_empty(), "an ack is no ledger call");
        assert!(run.tool_log.is_empty(), "an ack is no tool row");
    }

    /// Each completed `ask_responders` is a question whose id is the call's `callID`.
    #[test]
    fn sg25_questions_carry_the_call_id() {
        let mut s = Session::new();
        user_message(
            &mut s,
            "msg_01",
            "Analyze incident inc_1. Trigger: manual.",
            0,
        );
        s.message("msg_02", "assistant", json!({"created": T + 100}));
        ask(
            &mut s,
            "msg_02",
            "prt_q1",
            "  When did checkout-api deploy?  ",
            200,
        );
        s.tool(
            "msg_02",
            "prt_q2",
            ASK_RESPONDERS,
            "error",
            json!({"question": "x", "need": "y"}),
            json!({"error": "limit"}),
            300,
            301,
        );

        let run = decode_run(&s.events);

        assert_eq!(
            run.questions,
            [TranscriptQuestion {
                question_id: "call_prt_q1".to_string(),
                question: "When did checkout-api deploy?".to_string(),
                need: "deploy time of checkout-api".to_string(),
                hypothesis_id: Some("h1".to_string()),
                at_us: us(200),
            }]
        );
        assert_eq!(run.open_question, Some(run.questions[0].clone()));
    }

    #[test]
    fn sg26_the_open_question_predicate() {
        let base = || {
            let mut s = Session::new();
            user_message(
                &mut s,
                "msg_01",
                "Analyze incident inc_1. Trigger: manual.",
                0,
            );
            s.message("msg_02", "assistant", json!({"created": T + 100}));
            s.tool(
                "msg_02",
                "prt_s1",
                "record_step",
                "completed",
                json!({"stage": "changes", "title": "Changes"}),
                json!({"output": "{}"}),
                100,
                101,
            );
            ask(
                &mut s,
                "msg_02",
                "prt_q1",
                "When did checkout-api deploy?",
                200,
            );
            s
        };
        let open = |s: &Session| decode_run(&s.events).open_question.map(|q| q.question_id);

        let s = base();
        assert_eq!(
            open(&s).as_deref(),
            Some("call_prt_q1"),
            "the last sentinel"
        );

        let mut visible_after = base();
        visible_after.tool(
            "msg_02",
            "prt_t1",
            "o2_SearchSQL",
            "completed",
            search_sql(SQL_ERRORS),
            hits(1),
            300,
            310,
        );
        assert_eq!(
            open(&visible_after).as_deref(),
            Some("call_prt_q1"),
            "a visible tool call is no sentinel"
        );

        let mut stepped = base();
        stepped.tool(
            "msg_02",
            "prt_s2",
            "record_step",
            "completed",
            json!({"title": "Await flag change actor"}),
            json!({"output": "{}"}),
            300,
            301,
        );
        assert_eq!(
            open(&stepped).as_deref(),
            Some("call_prt_q1"),
            "a step marker after the ask keeps it open"
        );

        let mut acked = base();
        ack(&mut acked, "msg_02", "prt_a1", S1, "applied", "ok", 300);
        assert_eq!(
            open(&acked).as_deref(),
            Some("call_prt_q1"),
            "a steering ack after the ask keeps it open"
        );

        let mut submitted = base();
        submitted.tool(
            "msg_02",
            "prt_p1",
            "submit_report",
            "completed",
            json!({"markdown": "report"}),
            json!({"output": "{}"}),
            300,
            301,
        );
        assert_eq!(open(&submitted), None, "a report follows");

        let mut recorded = base();
        recorded.tool(
            "msg_02",
            "prt_h1",
            "record_hypothesis",
            "completed",
            hypothesis("h1", H1, "testing", vec![]),
            json!({"output": "{}"}),
            300,
            301,
        );
        assert_eq!(open(&recorded), None, "another sentinel came after it");

        let mut answered = base();
        user_message(
            &mut answered,
            "msg_03",
            &steer_message(S1, SteerKind::Answer, Some("call_prt_q1"), "10:02"),
            500,
        );
        assert_eq!(
            open(&answered).as_deref(),
            Some("call_prt_q1"),
            "an answer the agent has not read yet leaves it open"
        );
        answered.message("msg_04", "assistant", json!({"created": T + 600}));
        assert_eq!(open(&answered), None, "a steering message read after it");

        let mut pending = base();
        pending.tool(
            "msg_02",
            "prt_q2",
            ASK_RESPONDERS,
            "running",
            json!({"question": "x", "need": "y"}),
            json!({}),
            300,
            300,
        );
        assert_eq!(
            open(&pending).as_deref(),
            Some("call_prt_q1"),
            "only a completed call is a sentinel"
        );
    }
}
