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

//! What an RCA run recorded, decoded from its chat session (03 VE10, VE26, VE27;
//! confidence design §5.2): the evidence ledger calls, the tool log, the stages that ran
//! and the submitted report. The finalizer and the summary route both read a run through
//! [decode_run]; tool parts are read as the thread reads them ([ToolPart]).

use std::collections::HashMap;

use config::{
    meta::oncall::{
        confidence::{ToolCallRecord, signal_class, stream_type},
        rca_run::{
            LedgerCall, LedgerTool, RcaSubmit, evidence_target, parse_submit, summarize_result,
        },
    },
    utils::json::{Map, Value},
};
use o2_enterprise::enterprise::ai::chat::batcher::DurableEvent;

use super::{
    projection::Folded,
    rca_thread::{
        SUBMIT_REPORT, ThreadPart, ToolPart, error_text, key_arg, tool_body, updated_part,
    },
};

const RECORD_HYPOTHESIS: &str = "record_hypothesis";
const RECORD_BLIND_SPOT: &str = "record_blind_spot";

/// A run's committed transcript as the verdict pipeline reads it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunTranscript {
    /// Completed `record_hypothesis` and `record_blind_spot` calls, in seq order.
    pub calls: Vec<LedgerCall>,
    /// Visible tool calls that completed or failed, in thread order.
    pub tool_log: Vec<ToolCallRecord>,
    /// The stages of the run's `record_step` calls, each once, in order.
    pub stages_run: Vec<String>,
    /// The input of the last completed `submit_report` that parses (TH19, E3).
    pub submit: Option<RcaSubmit>,
}

/// Decode the committed events of an RCA session. Each part counts in its final state;
/// a ledger call's `seq` is the seq of the event that carried that state.
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
    for (msg_id, info) in &folded.infos {
        if info.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(parts) = folded.parts.get(msg_id) else {
            continue;
        };
        for part in parts.values().filter_map(Value::as_object) {
            let Some(call) = ToolPart::of(part) else {
                continue;
            };
            let seq = || {
                part.get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| seqs.get(id).copied())
                    .unwrap_or(-1)
            };
            match call.kind() {
                ThreadPart::Step(Some(stage)) => {
                    if !transcript.stages_run.iter().any(|s| s == stage) {
                        transcript.stages_run.push(stage.to_string());
                    }
                }
                ThreadPart::Step(None) | ThreadPart::FailedStep => {}
                ThreadPart::Hidden if call.status == "completed" => {
                    let tool = match call.tool {
                        RECORD_HYPOTHESIS => LedgerTool::Hypothesis,
                        RECORD_BLIND_SPOT => LedgerTool::BlindSpot,
                        SUBMIT_REPORT => {
                            submits.push((seq(), Value::Object(call.args())));
                            continue;
                        }
                        _ => continue,
                    };
                    transcript.calls.push(LedgerCall {
                        seq: seq(),
                        at_us: call.started_at().unwrap_or_default(),
                        tool,
                        input: Value::Object(call.args()),
                    });
                }
                ThreadPart::Hidden => {}
                ThreadPart::Row => {
                    if let Some(record) = tool_record(&call) {
                        transcript.tool_log.push(record);
                    }
                }
            }
        }
    }
    transcript.calls.sort_by_key(|call| call.seq);
    submits.sort_by_key(|(seq, _)| std::cmp::Reverse(*seq));
    transcript.submit = submits.iter().find_map(|(_, input)| parse_submit(input));
    transcript
}

/// The tool log entry of a visible tool part that completed or failed (confidence §5.2).
fn tool_record(call: &ToolPart<'_>) -> Option<ToolCallRecord> {
    let success = match call.status {
        "completed" => true,
        "error" => false,
        _ => return None,
    };
    let args = call.args();
    let key_arg = key_arg(call.tool, &args).unwrap_or_default();
    let input = Value::Object(args);
    let empty = Map::new();
    let state = call.state.unwrap_or(&empty);
    let (result_summary, result_count, error_type) = if success {
        let (summary, count) = summarize_result(call.tool, &tool_body(state));
        (summary, count, None)
    } else {
        (String::new(), None, Some(error_text(state.get("error"))))
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
        target: evidence_target(call.tool, &input),
        result_summary,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use config::{
        meta::oncall::confidence::SignalClass,
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

    /// A run with one `record_step` per stage, a ledger and a tool log: GetIncident,
    /// SearchSQL, a `tools_call`-wrapped PrometheusRangeQuery, a failed SearchSQL, a hidden
    /// `bash` and a still-running GetLatestTraces; `h1` recorded twice (testing, then
    /// root_cause with one more pending update) around an errored `record_hypothesis`,
    /// `h2` ruled out, one blind spot. No report: callers add one.
    ///
    /// Graded, `h1` has decisive logs and metrics evidence and `h2` a verified rules-out
    /// item, so a high claim stays high; `e4` cites the failed call.
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

    /// VE10, F7: the ledger calls are the completed `record_hypothesis` and
    /// `record_blind_spot` parts in seq order, each at the seq of its final state and the
    /// µs start of its call, without the session argument; the errored call is not one.
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

    /// CG §5.2, VE26, VE27: the tool log holds only the visible calls that completed or
    /// failed (no hidden `bash`, no ledger sentinels, no running call), each with the
    /// thread's key argument, its stream type, signal, target and result summary.
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

    /// TH19, VE34: the stages that ran, each once in first-step order; the submit is the
    /// last completed `submit_report`, never an errored one.
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

    /// VE26: a visible shell or `cli_*` call carries its command in `target.command` (for
    /// "Copy query") and as its key argument; a hidden `bash` call is not in the log.
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
}
