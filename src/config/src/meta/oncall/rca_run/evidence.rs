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

//! The numbered evidence list: one entry per tool call that ran and that the
//! ledger cites (03 VE23–VE30).

use std::{borrow::Cow, collections::HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::{EvidenceLedger, Polarity, Strength};
use crate::meta::{
    oncall::confidence::{
        SignalClass, ToolCallRecord, UnverifiedCitation, match_citation, signal_class,
    },
    sql::resolve_stream_names,
};

/// The tools whose query is SQL in `request_body.query.sql` (VE25, VE26).
const SQL_TOOLS: [&str; 4] = [
    "SearchSQL",
    "SearchAround",
    "ExtractPatterns",
    "SearchValues",
];
const GET_LATEST_TRACES: &str = "GetLatestTraces";
const PROMQL_INSTANT_QUERY: &str = "PrometheusQuery";

fn is_sql_tool(tool: &str) -> bool {
    SQL_TOOLS.contains(&tool)
}

fn is_prometheus_tool(tool: &str) -> bool {
    tool.starts_with("Prometheus")
}

fn is_shell_tool(tool: &str) -> bool {
    matches!(tool, "bash" | "shell") || tool.starts_with("cli_")
}

/// What the web app needs to open the same query (VE26, VE29). Every value
/// comes from the persisted tool input, never from the ledger or the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EvidenceTarget {
    pub signal: SignalClass,
    #[serde(default)]
    pub streams: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promql: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// Microseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_us: Option<i64>,
    /// Microseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_us: Option<i64>,
    /// The command of a shell or `cli_*` call, for "Copy query" only; no link is
    /// built from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

fn non_empty_str(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

/// An integer, or a string that holds one.
fn as_i64(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// A Prometheus time: RFC 3339, or Unix seconds as a number or a string; µs.
fn prometheus_time_us(v: Option<&Value>) -> Option<i64> {
    let seconds = |s: f64| s.is_finite().then_some((s * 1_000_000.0) as i64);
    match v? {
        Value::Number(n) => n.as_f64().and_then(seconds),
        Value::String(s) => {
            let s = s.trim();
            match s.parse::<f64>() {
                Ok(secs) => seconds(secs),
                Err(_) => chrono::DateTime::parse_from_rfc3339(s)
                    .ok()
                    .map(|t| t.timestamp_micros()),
            }
        }
        _ => None,
    }
}

/// Stream, time range and query of one call, from its unwrapped input (VE26).
/// A value that is absent or does not parse stays empty.
pub fn evidence_target(tool: &str, input: &Value) -> EvidenceTarget {
    let mut target = EvidenceTarget {
        signal: signal_class(tool, input),
        streams: Vec::new(),
        sql: None,
        promql: None,
        filter: None,
        start_us: None,
        end_us: None,
        command: None,
    };
    if is_sql_tool(tool) {
        let query = input.pointer("/request_body/query");
        target.sql = non_empty_str(query.and_then(|q| q.get("sql")));
        target.streams = target
            .sql
            .as_deref()
            .and_then(|sql| resolve_stream_names(sql).ok())
            .unwrap_or_default();
        target.start_us = as_i64(query.and_then(|q| q.get("start_time")));
        target.end_us = as_i64(query.and_then(|q| q.get("end_time")));
    } else if is_prometheus_tool(tool) {
        target.promql = non_empty_str(input.get("query"))
            .or_else(|| non_empty_str(input.pointer("/request_body/query")));
        if tool == PROMQL_INSTANT_QUERY {
            target.start_us = prometheus_time_us(input.get("time"));
            target.end_us = target.start_us;
        } else {
            target.start_us = prometheus_time_us(input.get("start"));
            target.end_us = prometheus_time_us(input.get("end"));
        }
    } else if tool == GET_LATEST_TRACES {
        target.streams = non_empty_str(input.get("stream_name"))
            .into_iter()
            .collect();
        target.start_us = as_i64(input.get("start_time"));
        target.end_us = as_i64(input.get("end_time"));
        target.filter = non_empty_str(input.get("filter"));
    } else {
        // Shell, `cli_*` and any other tool whose key argument is its command.
        target.command =
            non_empty_str(input.get("command")).or_else(|| non_empty_str(input.get("cmd")));
    }
    target
}

/// The response body: a JSON string is parsed, and a `{"output": "<json>"}`
/// wrapper around a JSON value is unwrapped. Plain text stays as it is.
fn decode_output(output: &Value) -> Cow<'_, Value> {
    match output {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(v @ (Value::Object(_) | Value::Array(_))) => Cow::Owned(v),
            _ => Cow::Borrowed(output),
        },
        Value::Object(map) => match map.get("output").and_then(Value::as_str) {
            Some(text) => match serde_json::from_str::<Value>(text) {
                Ok(v @ (Value::Object(_) | Value::Array(_))) => Cow::Owned(v),
                _ => Cow::Borrowed(output),
            },
            None => Cow::Borrowed(output),
        },
        _ => Cow::Borrowed(output),
    }
}

fn plural(n: u64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn byte_size(bytes: usize) -> String {
    const KB: f64 = 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < KB * KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{:.1} MB", b / (KB * KB))
    }
}

/// Rows of a markdown table: table lines minus the header row and the
/// `|---|` separator.
fn md_table_rows(data: &str) -> u64 {
    let is_separator = |line: &str| {
        line.contains('-')
            && line
                .chars()
                .all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t'))
    };
    let rows = data
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with('|') && !is_separator(l))
        .count() as u64;
    rows.saturating_sub(1)
}

/// Rows of a CSV text: non-empty lines minus the header.
fn csv_rows(data: &str) -> u64 {
    let lines = data.lines().filter(|l| !l.trim().is_empty()).count() as u64;
    lines.saturating_sub(1)
}

/// Rows returned in a text `data` field (`agent_options.output_format`
/// `md_table` or `csv`); the `format` field decides when present.
fn data_rows(body: &Value) -> Option<u64> {
    let data = body
        .get("data")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())?;
    match body.get("format").and_then(Value::as_str) {
        Some("md_table" | "markdown" | "md") => Some(md_table_rows(data)),
        Some("csv") => Some(csv_rows(data)),
        Some(_) => None,
        None if data.trim_start().starts_with('|') => Some(md_table_rows(data)),
        None => Some(csv_rows(data)),
    }
}

fn sql_summary(body: &Value) -> Option<(String, Option<u64>)> {
    let hits = body.get("hits").and_then(Value::as_array);
    let has_text_data = body
        .get("data")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty());
    let rows = match hits {
        Some(h) if !h.is_empty() => h.len() as u64,
        // Rows returned as text: count them, or (unknown format) leave the size
        // fallback; empty `hits` beside text `data` are not "0 rows".
        _ if has_text_data => data_rows(body)?,
        _ => hits?.len() as u64,
    };
    let mut summary = plural(rows, "row", "rows");
    if let Some(total) = body.get("total").and_then(Value::as_u64)
        && total > rows
    {
        summary.push_str(&format!(" · {total} total"));
    }
    if let Some(took) = body.get("took").and_then(Value::as_u64) {
        summary.push_str(&format!(" · took {took} ms"));
    }
    Some((summary, Some(rows)))
}

/// An output with a `patterns` array (ExtractPatterns).
fn patterns_summary(body: &Value) -> Option<(String, Option<u64>)> {
    let patterns = body.get("patterns")?.as_array()?.len() as u64;
    Some((plural(patterns, "pattern", "patterns"), Some(patterns)))
}

fn prometheus_summary(body: &Value) -> Option<(String, Option<u64>)> {
    let series = body
        .pointer("/data/result")
        .or_else(|| body.get("result"))?
        .as_array()?;
    let points: u64 = series
        .iter()
        .map(|s| {
            let range = s
                .get("values")
                .and_then(Value::as_array)
                .map_or(0, |v| v.len() as u64);
            range + u64::from(s.get("value").is_some_and(Value::is_array))
        })
        .sum();
    let count = series.len() as u64;
    Some((
        format!("{count} series · {}", plural(points, "point", "points")),
        Some(count),
    ))
}

fn traces_summary(body: &Value) -> Option<(String, Option<u64>)> {
    let traces = body.get("hits")?.as_array()?.len() as u64;
    Some((plural(traces, "trace", "traces"), Some(traces)))
}

fn shell_summary(body: &Value) -> (String, Option<u64>) {
    let text = match body {
        Value::String(s) => s.as_str(),
        _ => body
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    };
    let exit = body
        .pointer("/metadata/exit")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let lines = text.lines().count() as u64;
    (
        format!("exit {exit} · {}", plural(lines, "line", "lines")),
        None,
    )
}

/// A one-line summary of a call's result, built from its persisted output, and
/// the result count when the output has one (VE27). `output` is the response
/// body (a JSON value), or the raw output string.
pub fn summarize_result(tool: &str, output: &Value) -> (String, Option<u64>) {
    if is_shell_tool(tool) {
        return shell_summary(output);
    }
    let body = decode_output(output);
    let specific = if is_prometheus_tool(tool) {
        prometheus_summary(&body)
    } else if tool == GET_LATEST_TRACES {
        traces_summary(&body)
    } else if let Some(patterns) = patterns_summary(&body) {
        Some(patterns)
    } else if is_sql_tool(tool) {
        sql_summary(&body)
    } else {
        None
    };
    specific.unwrap_or_else(|| {
        let size = match body.as_ref() {
            Value::String(s) => s.len(),
            other => other.to_string().len(),
        };
        (format!("OK · {}", byte_size(size)), None)
    })
}

/// The first word of each command in a shell line.
fn command_words(command: &str) -> impl Iterator<Item = &str> {
    command
        .split(['\n', ';', '|', '&'])
        .filter_map(|segment| segment.split_whitespace().next())
}

/// The kind label of an entry, from the tool that ran (VE25).
pub fn evidence_kind(record: &ToolCallRecord) -> String {
    let tool = record.tool.as_str();
    if is_sql_tool(tool) {
        return "SQL".to_string();
    }
    if is_prometheus_tool(tool) {
        return "PromQL".to_string();
    }
    if tool == GET_LATEST_TRACES {
        return "Traces".to_string();
    }
    if tool.starts_with("cli_") {
        return "CLI".to_string();
    }
    if is_shell_tool(tool) {
        if command_words(&record.key_arg).any(|w| w == "gh") {
            return "GitHub".to_string();
        }
        if command_words(&record.key_arg).any(|w| w == "git") {
            return "Git".to_string();
        }
    }
    record.tool.clone()
}

/// One hypothesis' use of an evidence entry (VE23).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Citation {
    pub hypothesis_id: String,
    pub evidence_id: String,
    pub polarity: Polarity,
    pub strength: Strength,
    /// The agent's reading of the result; never shown as the result.
    pub observation: String,
}

/// One verified tool call that the ledger cites (VE23).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EvidenceEntry {
    /// 1-based, in the order of first citation (VE24).
    pub number: u32,
    /// The agent's evidence ids that map to this entry.
    pub ids: Vec<String>,
    pub call_id: String,
    /// VE25.
    pub kind: String,
    pub target: SignalClass,
    /// VE26/VE29: the web app builds the link from it.
    pub link: EvidenceTarget,
    /// VE27.
    pub result_summary: String,
    pub duration_ms: u64,
    /// VE28: at least one citation is decisive.
    pub decisive: bool,
    pub citations: Vec<Citation>,
}

/// Matches each ledger item to the tool call that ran it (CG §5.3.1) and merges
/// the items of one call into one numbered entry (VE23, VE24, VE28). Items with
/// no successful call go to the unverified list (VE30).
pub fn build_evidence(
    ledger: Option<&EvidenceLedger>,
    tool_log: &[ToolCallRecord],
) -> (Vec<EvidenceEntry>, Vec<UnverifiedCitation>) {
    struct Acc<'a> {
        record: &'a ToolCallRecord,
        first_cited_seq: i64,
        ids: Vec<(i64, String)>,
        citations: Vec<Citation>,
    }

    let mut accs: Vec<Acc<'_>> = Vec::new();
    let mut by_call: HashMap<&str, usize> = HashMap::new();
    let mut unverified = Vec::new();
    for h in ledger.map(|l| l.hypotheses.as_slice()).unwrap_or_default() {
        for item in &h.evidence {
            let record = match match_citation(&item.tool, &item.query, tool_log) {
                Ok(record) => record,
                Err(reason) => {
                    unverified.push(UnverifiedCitation {
                        hypothesis_id: h.id.clone(),
                        evidence_id: item.id.clone(),
                        tool: item.tool.clone(),
                        query: item.query.clone(),
                        reason,
                    });
                    continue;
                }
            };
            let i = *by_call.entry(record.call_id.as_str()).or_insert_with(|| {
                accs.push(Acc {
                    record,
                    first_cited_seq: item.first_cited_seq,
                    ids: Vec::new(),
                    citations: Vec::new(),
                });
                accs.len() - 1
            });
            let acc = &mut accs[i];
            acc.first_cited_seq = acc.first_cited_seq.min(item.first_cited_seq);
            if !acc.ids.iter().any(|(_, id)| *id == item.id) {
                acc.ids.push((item.first_cited_seq, item.id.clone()));
            }
            acc.citations.push(Citation {
                hypothesis_id: h.id.clone(),
                evidence_id: item.id.clone(),
                polarity: item.polarity,
                strength: item.strength,
                observation: item.observation.clone(),
            });
        }
    }

    accs.sort_by(|a, b| {
        (a.first_cited_seq, a.record.started_at_us, &a.record.call_id).cmp(&(
            b.first_cited_seq,
            b.record.started_at_us,
            &b.record.call_id,
        ))
    });
    let entries = accs
        .into_iter()
        .zip(1u32..)
        .map(|(mut acc, number)| {
            acc.ids.sort_by_key(|(seq, _)| *seq);
            EvidenceEntry {
                number,
                ids: acc.ids.into_iter().map(|(_, id)| id).collect(),
                call_id: acc.record.call_id.clone(),
                kind: evidence_kind(acc.record),
                target: acc.record.signal,
                link: acc.record.target.clone(),
                result_summary: acc.record.result_summary.clone(),
                duration_ms: acc.record.duration_ms,
                decisive: acc
                    .citations
                    .iter()
                    .any(|c| c.strength == Strength::Decisive),
                citations: acc.citations,
            }
        })
        .collect();
    (entries, unverified)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::meta::oncall::{
        confidence::UnverifiedReason,
        rca_run::fixtures::{BASH, PROM, SQL, hyp, item, ledger_of, logs, prom, rec, shell},
    };

    /// VE23: `e2` on `h1` and `e7` on `h4` that both match `c9` merge into one entry.
    #[test]
    fn items_of_one_call_merge_into_one_entry() {
        let ledger = ledger_of(&[
            hyp(
                1,
                "h1",
                "root_cause",
                vec![item("e2", PROM, "rate(x[5m])", "supports", "decisive")],
            ),
            hyp(
                2,
                "h4",
                "ruled_out",
                vec![item("e7", PROM, "rate(x[5m]) ;", "rules_out", "supporting")],
            ),
        ]);
        let log = [prom("c9", "rate(x[5m])", 10)];
        let (entries, unverified) = build_evidence(ledger.as_ref(), &log);
        assert_eq!(unverified, vec![]);
        assert_eq!(entries.len(), 1);
        let e = &entries[0];
        assert_eq!(e.call_id, "c9");
        assert_eq!(e.ids, ["e2", "e7"]);
        assert_eq!(
            e.citations,
            vec![
                Citation {
                    hypothesis_id: "h1".into(),
                    evidence_id: "e2".into(),
                    polarity: Polarity::Supports,
                    strength: Strength::Decisive,
                    observation: "e2 obs".into(),
                },
                Citation {
                    hypothesis_id: "h4".into(),
                    evidence_id: "e7".into(),
                    polarity: Polarity::RulesOut,
                    strength: Strength::Supporting,
                    observation: "e7 obs".into(),
                },
            ]
        );
        // VE5: one id on two hypotheses is one entry with two citations too.
        let ledger = ledger_of(&[
            hyp(
                1,
                "h1",
                "root_cause",
                vec![item("e1", PROM, "q", "supports", "decisive")],
            ),
            hyp(
                2,
                "h2",
                "ruled_out",
                vec![item("e1", PROM, "q", "rules_out", "decisive")],
            ),
        ]);
        let (entries, _) = build_evidence(ledger.as_ref(), &[prom("c1", "q", 1)]);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ids, ["e1"]);
        assert_eq!(entries[0].citations.len(), 2);
    }

    /// VE24: numbers follow the first citation seq, not the call time.
    #[test]
    fn entries_are_numbered_by_first_citation() {
        let ledger = ledger_of(&[
            hyp(
                10,
                "h1",
                "testing",
                vec![item("e5", PROM, "late", "supports", "supporting")],
            ),
            hyp(
                14,
                "h2",
                "testing",
                vec![item("e1", PROM, "early", "supports", "supporting")],
            ),
        ]);
        let log = [prom("c1", "early", 1), prom("c2", "late", 50)];
        let (entries, _) = build_evidence(ledger.as_ref(), &log);
        let numbers: Vec<(u32, &str, &str)> = entries
            .iter()
            .map(|e| (e.number, e.ids[0].as_str(), e.call_id.as_str()))
            .collect();
        assert_eq!(numbers, [(1, "e5", "c2"), (2, "e1", "c1")]);
    }

    /// VE25: kind and target come from the tool that ran.
    #[test]
    fn kind_and_target_come_from_the_tool() {
        let cases = [
            (logs("c", "SELECT * FROM t", 1), "SQL", SignalClass::Logs),
            (
                rec("c", "SearchAround", "q", json!({"type": "traces"}), 1, true),
                "SQL",
                SignalClass::Traces,
            ),
            (
                rec(
                    "c",
                    "ExtractPatterns",
                    "q",
                    json!({"type": "metrics"}),
                    1,
                    true,
                ),
                "SQL",
                SignalClass::Metrics,
            ),
            (prom("c", "up", 1), "PromQL", SignalClass::Metrics),
            (
                rec("c", "PrometheusQuery", "up", json!({}), 1, true),
                "PromQL",
                SignalClass::Metrics,
            ),
            (
                rec("c", "PrometheusSeries", "up", json!({}), 1, true),
                "PromQL",
                SignalClass::Metrics,
            ),
            (
                rec("c", "GetLatestTraces", "f", json!({}), 1, true),
                "Traces",
                SignalClass::Traces,
            ),
            (
                shell("c", "gh pr diff 812", 1, true),
                "GitHub",
                SignalClass::Change,
            ),
            (
                shell("c", "cd /repo && git show abc123", 1, true),
                "Git",
                SignalClass::Change,
            ),
            (
                rec(
                    "c",
                    "cli_kubectl",
                    "kubectl get pods",
                    json!({"command": "kubectl get pods"}),
                    1,
                    true,
                ),
                "CLI",
                SignalClass::Infra,
            ),
            (
                rec("c", "GetIncident", "inc_1", json!({}), 1, true),
                "GetIncident",
                SignalClass::Context,
            ),
            (
                rec("c", "ExecuteCode", "x", json!({}), 1, true),
                "ExecuteCode",
                SignalClass::Unclassified,
            ),
        ];
        for (record, kind, target) in cases {
            assert_eq!(evidence_kind(&record), kind, "{}", record.tool);
            assert_eq!(record.signal, target, "{}", record.tool);
        }
        // Through build_evidence: whatever the item says, the entry reads the call.
        let ledger = ledger_of(&[hyp(
            1,
            "h1",
            "root_cause",
            vec![item("e1", PROM, "up", "supports", "decisive")],
        )]);
        let (entries, _) = build_evidence(ledger.as_ref(), &[prom("c1", "up", 1)]);
        assert_eq!(
            (entries[0].kind.as_str(), entries[0].target),
            ("PromQL", SignalClass::Metrics)
        );
        assert_eq!(
            serde_json::to_value(entries[0].target).unwrap(),
            json!("metrics")
        );
    }

    /// VE26: stream, times and query come from the persisted input.
    #[test]
    fn targets_are_extracted_from_the_tool_input() {
        let sql = r#"SELECT count(*) FROM "checkout_api" WHERE code >= 500"#;
        let t = evidence_target(
            SQL,
            &json!({"type": "logs", "request_body": {"query": {"sql": sql, "start_time": 1_000, "end_time": "2000"}}}),
        );
        assert_eq!(t.signal, SignalClass::Logs);
        assert_eq!(t.streams, ["checkout_api"]);
        assert_eq!(t.sql.as_deref(), Some(sql));
        assert_eq!((t.start_us, t.end_us), (Some(1_000), Some(2_000)));
        assert_eq!((t.promql, t.filter), (None, None));

        let t = evidence_target(
            "PrometheusRangeQuery",
            &json!({"query": "rate(x[5m])", "start": "2026-10-16T10:00:00Z", "end": 1_792_145_000}),
        );
        assert_eq!(t.signal, SignalClass::Metrics);
        assert_eq!(t.promql.as_deref(), Some("rate(x[5m])"));
        assert_eq!(t.start_us, Some(1_792_144_800_000_000));
        assert_eq!(t.end_us, Some(1_792_145_000_000_000));
        assert!(t.streams.is_empty());
        let t = evidence_target(
            "PrometheusRangeQuery",
            &json!({"query": "up", "start": "1792144800.5", "end": "soon"}),
        );
        assert_eq!((t.start_us, t.end_us), (Some(1_792_144_800_500_000), None));
        let t = evidence_target(
            "PrometheusQuery",
            &json!({"query": "up", "time": "2026-10-16T10:00:00+02:00"}),
        );
        assert_eq!(t.start_us, Some(1_792_137_600_000_000));
        assert_eq!(t.end_us, t.start_us, "an instant query is a point");

        let t = evidence_target(
            "GetLatestTraces",
            &json!({"stream_name": "default", "start_time": 5, "end_time": 9, "filter": "service_name='checkout'"}),
        );
        assert_eq!(t.signal, SignalClass::Traces);
        assert_eq!(t.streams, ["default"]);
        assert_eq!((t.start_us, t.end_us), (Some(5), Some(9)));
        assert_eq!(t.filter.as_deref(), Some("service_name='checkout'"));

        let t = evidence_target(BASH, &json!({"command": "git diff HEAD~1"}));
        assert_eq!(
            t,
            EvidenceTarget {
                signal: SignalClass::Change,
                streams: vec![],
                sql: None,
                promql: None,
                filter: None,
                start_us: None,
                end_us: None,
                command: Some("git diff HEAD~1".into()),
            }
        );
        // Absent or unparsable values stay empty.
        let t = evidence_target(
            SQL,
            &json!({"request_body": {"query": {"sql": "", "start_time": "later"}}}),
        );
        assert_eq!((t.sql, t.streams.len(), t.start_us), (None, 0, None));

        // Shell and cli_* calls carry their command for "Copy query" only.
        let record = shell("c1", "git diff HEAD~1 -- src/pool.rs", 1, true);
        assert_eq!(
            record.target.command.as_deref(),
            Some("git diff HEAD~1 -- src/pool.rs")
        );
        assert_eq!(
            (
                record.target.sql,
                record.target.promql,
                record.target.filter
            ),
            (None, None, None)
        );
        let t = evidence_target("shell", &json!({"cmd": "git show abc"}));
        assert_eq!(t.command.as_deref(), Some("git show abc"));
        let t = evidence_target("cli_kubectl", &json!({"command": "kubectl get pods"}));
        assert_eq!(
            (t.signal, t.command.as_deref()),
            (SignalClass::Infra, Some("kubectl get pods"))
        );
        assert_eq!(
            evidence_target(
                SQL,
                &json!({"command": "x", "request_body": {"query": {"sql": "SELECT 1"}}})
            )
            .command,
            None
        );
        assert_eq!(
            evidence_target(PROM, &json!({"query": "up", "command": "x"})).command,
            None
        );
        assert!(
            serde_json::to_value(evidence_target(PROM, &json!({"query": "up"})))
                .unwrap()
                .get("command")
                .is_none()
        );
    }

    /// VE27: the summary comes from the output.
    #[test]
    fn result_summaries_are_built_from_the_output() {
        let series: Vec<_> = (0..6)
            .map(|i| json!({"metric": {"pod": i}, "values": (0..40).map(|t| json!([t, "1"])).collect::<Vec<_>>()}))
            .collect();
        let output =
            json!({"status": "success", "data": {"resultType": "matrix", "result": series}});
        assert_eq!(
            summarize_result("PrometheusRangeQuery", &output),
            ("6 series · 240 points".to_string(), Some(6))
        );
        // A JSON string body and an `{"output": "<json>"}` wrapper read the same.
        assert_eq!(
            summarize_result("PrometheusRangeQuery", &json!(output.to_string())).0,
            "6 series · 240 points"
        );
        assert_eq!(
            summarize_result(
                "PrometheusRangeQuery",
                &json!({"output": output.to_string()})
            )
            .0,
            "6 series · 240 points"
        );
        let instant = json!({"data": {"result": [{"value": [1, "1"]}]}});
        assert_eq!(
            summarize_result("PrometheusQuery", &instant).0,
            "1 series · 1 point"
        );

        let hits = json!({"hits": [{}, {}, {}], "total": 120, "took": 15});
        assert_eq!(
            summarize_result(SQL, &hits),
            ("3 rows · 120 total · took 15 ms".to_string(), Some(3))
        );
        let all = json!({"hits": [{}], "total": 1, "took": 4});
        assert_eq!(summarize_result(SQL, &all).0, "1 row · took 4 ms");

        let traces = json!({"hits": [{}, {}]});
        assert_eq!(
            summarize_result("GetLatestTraces", &traces),
            ("2 traces".to_string(), Some(2))
        );

        let sh = json!({"output": "a\nb\nc", "metadata": {"exit": 1}});
        assert_eq!(
            summarize_result(BASH, &sh),
            ("exit 1 · 3 lines".to_string(), None)
        );
        assert_eq!(
            summarize_result("cli_kubectl", &json!("one line")).0,
            "exit 0 · 1 line"
        );

        assert_eq!(
            summarize_result("GetIncident", &json!("hello")),
            ("OK · 5 B".to_string(), None)
        );
    }

    /// D2: SQL outputs with `agent_options.output_format` carry rows in a text
    /// `data` field. Fixtures are the real outputs of the Phase 3 E2E runs
    /// (`artifacts/phase-3/e2e/S1-call01-output.txt`, md_table, cut to its first
    /// three complete rows; `R-S4-call00-output.txt`, csv, whole).
    #[test]
    fn text_table_outputs_count_their_rows() {
        let s1_table = "| _timestamp | service_name | level | message | http_status | latency_ms | upstream | k8s_namespace_name |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1792125252548309 | checkout_p3s1 | error | payment gateway timeout after 5000ms calling POST /v1/charges | 504 | 5283 | payments-gateway | shop |\n| 1792125246548309 | checkout_p3s1 | info | checkout completed | 200 | 120 |  | shop |\n| 1792125240548309 | checkout_p3s1 | info | checkout completed | 200 | 50 |  | shop |\n";
        let s1 = json!({"took": 45, "hits": [], "total": 40, "from": 0, "size": 100,
                        "columns": ["_timestamp", "service_name", "level", "message", "http_status", "latency_ms", "upstream", "k8s_namespace_name"],
                        "scan_size": 0, "data": s1_table});
        // The tool part stores the body as a string (`output_type: str`).
        assert_eq!(
            summarize_result(SQL, &json!(s1.to_string())),
            ("3 rows · 40 total · took 45 ms".to_string(), Some(3))
        );
        let mut s1_tagged = s1.clone();
        s1_tagged["format"] = json!("md_table");
        assert_eq!(
            summarize_result(SQL, &s1_tagged).0,
            "3 rows · 40 total · took 45 ms"
        );

        let r_s4 = r#"{"took":39,"hits":[],"total":1,"from":0,"size":10,"columns":["max_ts","min_ts","total","errors"],"scan_size":0,"data":"max_ts,min_ts,total,errors\n1792126625823314,1792126391823314,40,14","format":"csv"}"#;
        assert_eq!(
            summarize_result(SQL, &json!(r_s4)),
            ("1 row · took 39 ms".to_string(), Some(1))
        );
        let mut untagged: serde_json::Value = serde_json::from_str(r_s4).unwrap();
        untagged.as_object_mut().unwrap().remove("format");
        assert_eq!(
            summarize_result(SQL, &untagged).0,
            "1 row · took 39 ms",
            "csv without `format`"
        );
        assert_eq!(
            summarize_result(SQL, &json!({"output": r_s4})).0,
            "1 row · took 39 ms"
        );

        // Non-empty `hits` win over `data`.
        let both = json!({"hits": [{}, {}], "total": 2, "took": 3, "data": "a\n1\n2\n3\n4\n5", "format": "csv"});
        assert_eq!(
            summarize_result(SQL, &both),
            ("2 rows · took 3 ms".to_string(), Some(2))
        );
        // `total` shows only when larger than the rows.
        let csv =
            |total: u64| json!({"hits": [], "total": total, "data": "a\n1\n2", "format": "csv"});
        assert_eq!(summarize_result(SQL, &csv(2)).0, "2 rows");
        assert_eq!(summarize_result(SQL, &csv(9)).0, "2 rows · 9 total");
        // A header-only table is zero rows.
        let empty = json!({"hits": [], "total": 0, "took": 1, "data": "| a | b |\n|---|---|\n", "format": "md_table"});
        assert_eq!(
            summarize_result(SQL, &empty),
            ("0 rows · took 1 ms".to_string(), Some(0))
        );

        // An unknown format with no hits is "OK · <size>".
        let unknown = json!({"took": 3, "data": "PAR1....", "format": "parquet"});
        assert_eq!(
            summarize_result(SQL, &unknown),
            (format!("OK · {} B", unknown.to_string().len()), None)
        );
    }

    /// D2: an output with a `patterns` array counts patterns.
    #[test]
    fn pattern_outputs_count_patterns() {
        let out = json!({"patterns": [{"template": "a"}, {"template": "b"}, {"template": "c"}], "took": 5});
        assert_eq!(
            summarize_result("ExtractPatterns", &out),
            ("3 patterns".to_string(), Some(3))
        );
        assert_eq!(
            summarize_result("ExtractPatterns", &json!(out.to_string())).0,
            "3 patterns"
        );
        assert_eq!(
            summarize_result("ExtractPatterns", &json!({"patterns": [{}]})).0,
            "1 pattern"
        );
    }

    /// D2: the real search body always has `hits: []` next to a text `data`; an
    /// unknown format still reads "OK · <size>", not "0 rows".
    #[test]
    fn an_unknown_format_with_empty_hits_is_ok_with_size() {
        let unknown =
            json!({"took": 3, "hits": [], "total": 7, "data": "PAR1....", "format": "parquet"});
        assert_eq!(
            summarize_result(SQL, &unknown),
            (format!("OK · {} B", unknown.to_string().len()), None)
        );
    }

    /// VE28: one decisive citation makes the entry decisive.
    #[test]
    fn an_entry_with_a_decisive_citation_is_decisive() {
        let ledger = ledger_of(&[
            hyp(
                1,
                "h1",
                "root_cause",
                vec![item("e1", PROM, "q", "supports", "supporting")],
            ),
            hyp(
                2,
                "h2",
                "ruled_out",
                vec![item("e2", PROM, "q", "rules_out", "decisive")],
            ),
            hyp(
                3,
                "h3",
                "symptom",
                vec![item("e3", PROM, "other", "supports", "supporting")],
            ),
        ]);
        let (entries, _) = build_evidence(
            ledger.as_ref(),
            &[prom("c1", "q", 1), prom("c2", "other", 2)],
        );
        assert_eq!(
            entries.iter().map(|e| e.decisive).collect::<Vec<_>>(),
            [true, false]
        );
    }

    /// VE30: an item with no successful call is unverified (`not_run` or `failed`), never an entry.
    #[test]
    fn unverified_items_are_listed_apart() {
        let ledger = ledger_of(&[hyp(
            1,
            "h1",
            "root_cause",
            vec![
                item("e7", PROM, "never ran", "supports", "decisive"),
                item("e8", BASH, "gh pr diff 812", "supports", "decisive"),
                item("e9", PROM, "q", "supports", "decisive"),
            ],
        )]);
        let log = [shell("c1", "gh pr diff 812", 1, false), prom("c2", "q", 2)];
        let (entries, unverified) = build_evidence(ledger.as_ref(), &log);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ids, ["e9"]);
        assert_eq!(
            unverified,
            vec![
                UnverifiedCitation {
                    hypothesis_id: "h1".into(),
                    evidence_id: "e7".into(),
                    tool: PROM.into(),
                    query: "never ran".into(),
                    reason: UnverifiedReason::NotRun,
                },
                UnverifiedCitation {
                    hypothesis_id: "h1".into(),
                    evidence_id: "e8".into(),
                    tool: BASH.into(),
                    query: "gh pr diff 812".into(),
                    reason: UnverifiedReason::Failed,
                },
            ]
        );
        assert_eq!(
            serde_json::to_value(UnverifiedReason::NotRun).unwrap(),
            json!("not_run")
        );
        assert_eq!(
            serde_json::to_value(UnverifiedReason::Failed).unwrap(),
            json!("failed")
        );
    }

    /// VE5/VE24: a reused id with a different query is a different item; each
    /// entry numbers by its own item's first citation.
    #[test]
    fn a_reused_id_with_another_query_numbers_by_its_own_first_citation() {
        let ledger = ledger_of(&[
            hyp(
                3,
                "h1",
                "testing",
                vec![item("e2", PROM, "q_late", "supports", "supporting")],
            ),
            hyp(
                5,
                "h3",
                "testing",
                vec![item("e4", PROM, "q_mid", "supports", "supporting")],
            ),
            hyp(
                8,
                "h2",
                "testing",
                vec![item("e2", PROM, "q_early", "supports", "decisive")],
            ),
        ])
        .unwrap();
        let seqs: Vec<(&str, &str, i64)> = ledger
            .hypotheses
            .iter()
            .flat_map(|h| {
                h.evidence
                    .iter()
                    .map(move |e| (h.id.as_str(), e.query.as_str(), e.first_cited_seq))
            })
            .collect();
        assert_eq!(
            seqs,
            [
                ("h1", "q_late", 3),
                ("h3", "q_mid", 5),
                ("h2", "q_early", 8)
            ]
        );

        let log = [
            prom("c_early", "q_early", 1),
            prom("c_mid", "q_mid", 2),
            prom("c_late", "q_late", 50),
        ];
        let (entries, unverified) = build_evidence(Some(&ledger), &log);
        assert!(unverified.is_empty());
        let numbered: Vec<(u32, &str, Vec<&str>)> = entries
            .iter()
            .map(|e| {
                (
                    e.number,
                    e.call_id.as_str(),
                    e.ids.iter().map(String::as_str).collect(),
                )
            })
            .collect();
        assert_eq!(
            numbered,
            [
                (1, "c_late", vec!["e2"]),
                (2, "c_mid", vec!["e4"]),
                (3, "c_early", vec!["e2"])
            ]
        );
    }

    /// VE5/VE24: the same id, tool and query on a later call keeps the first seq;
    /// an `o2_` prefix and whitespace do not make it a new item.
    #[test]
    fn the_same_item_reused_keeps_one_first_seq() {
        let ledger = ledger_of(&[
            hyp(
                4,
                "h1",
                "testing",
                vec![item("e1", PROM, "rate(x[5m])", "supports", "supporting")],
            ),
            hyp(
                6,
                "h3",
                "testing",
                vec![item("e3", PROM, "other", "supports", "supporting")],
            ),
            hyp(
                9,
                "h2",
                "ruled_out",
                vec![item(
                    "e1",
                    "o2_PrometheusRangeQuery",
                    " rate(x[5m]) ;",
                    "rules_out",
                    "decisive",
                )],
            ),
            hyp(
                11,
                "h1",
                "root_cause",
                vec![item("e1", PROM, "rate(x[5m])", "supports", "decisive")],
            ),
        ])
        .unwrap();
        let firsts: Vec<i64> = ledger
            .hypotheses
            .iter()
            .flat_map(|h| {
                h.evidence
                    .iter()
                    .filter(|e| e.id == "e1")
                    .map(|e| e.first_cited_seq)
            })
            .collect();
        assert_eq!(firsts, [4, 4]);
        let (entries, _) = build_evidence(
            Some(&ledger),
            &[prom("c_other", "other", 1), prom("c1", "rate(x[5m])", 2)],
        );
        let numbered: Vec<(u32, &str, usize)> = entries
            .iter()
            .map(|e| (e.number, e.call_id.as_str(), e.citations.len()))
            .collect();
        assert_eq!(numbered, [(1, "c1", 2), (2, "c_other", 1)]);
    }
}
