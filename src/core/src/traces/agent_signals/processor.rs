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

#![cfg(feature = "enterprise")]

/// R1 — failure taxonomy per (agent, class). Classifies from existing error columns; no marker.
pub(super) fn build_failure_sql(stream: &str, start: i64, end: i64) -> String {
    format!(
        r#"SELECT gen_ai_agent_name,
            CASE
              WHEN error_message LIKE 'Invalid arguments%' THEN 'malformed_tool_call'
              WHEN error_message LIKE '%Validation failed%' THEN 'validation_error'
              WHEN error_message LIKE '%timeout%' THEN 'tool_timeout'
              WHEN error_type = 'McpError' THEN 'mcp_error'
              WHEN error_type IS NOT NULL AND error_type != '' THEN 'provider_error'
              ELSE 'unclassified'
            END AS fail_class,
            COUNT(*) AS count
        FROM "{stream}"
        WHERE _timestamp >= {start} AND _timestamp < {end} AND span_status = 'ERROR'
        GROUP BY gen_ai_agent_name, fail_class"#
    )
}

/// R2 — loop ratio per (agent, tool) using an HLL distinct-trace count. Bounded memory.
pub(super) fn build_loop_ratio_sql(stream: &str, start: i64, end: i64) -> String {
    format!(
        r#"SELECT gen_ai_agent_name, gen_ai_tool_name,
            COUNT(*) AS calls,
            approx_distinct(trace_id) AS distinct_traces
        FROM "{stream}"
        WHERE _timestamp >= {start} AND _timestamp < {end}
          AND gen_ai_operation_name = 'execute_tool' AND gen_ai_tool_name IS NOT NULL
        GROUP BY gen_ai_agent_name, gen_ai_tool_name"#
    )
}

/// R4 — cost / failure / p95 per agent. Bounded by number of agents.
pub(super) fn build_cost_sql(stream: &str, start: i64, end: i64) -> String {
    format!(
        r#"SELECT gen_ai_agent_name,
            SUM(gen_ai_usage_cost) AS cost,
            SUM(gen_ai_usage_total_tokens) AS tokens,
            COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors,
            CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95
        FROM "{stream}"
        WHERE _timestamp >= {start} AND _timestamp < {end}
        GROUP BY gen_ai_agent_name"#
    )
}

use config::meta::agent_signals::AgentSignalRecord;

fn get_str(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string())
}
fn get_u64(v: &serde_json::Value, k: &str) -> Option<u64> {
    v.get(k).and_then(|x| x.as_u64())
}
fn get_f64(v: &serde_json::Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}

pub(super) fn map_failure_hits(
    org: &str, stream: &str, ts: i64, hits: &[serde_json::Value],
) -> Vec<AgentSignalRecord> {
    hits.iter().map(|h| AgentSignalRecord {
        timestamp: ts,
        org_id: org.to_string(),
        source_stream: stream.to_string(),
        signal_type: "failure".to_string(),
        agent_name: get_str(h, "gen_ai_agent_name"),
        tool_name: None,
        fail_class: get_str(h, "fail_class"),
        count: get_u64(h, "count").unwrap_or(0),
        calls: None, distinct_traces: None, cost: None, tokens: None, errors: None, p95_latency_ns: None,
    }).collect()
}

pub(super) fn map_loop_hits(
    org: &str, stream: &str, ts: i64, hits: &[serde_json::Value],
) -> Vec<AgentSignalRecord> {
    hits.iter().map(|h| AgentSignalRecord {
        timestamp: ts,
        org_id: org.to_string(),
        source_stream: stream.to_string(),
        signal_type: "loop".to_string(),
        agent_name: get_str(h, "gen_ai_agent_name"),
        tool_name: get_str(h, "gen_ai_tool_name"),
        fail_class: None,
        count: get_u64(h, "calls").unwrap_or(0),
        calls: get_u64(h, "calls"),
        distinct_traces: get_u64(h, "distinct_traces"),
        cost: None, tokens: None, errors: None, p95_latency_ns: None,
    }).collect()
}

pub(super) fn map_cost_hits(
    org: &str, stream: &str, ts: i64, hits: &[serde_json::Value],
) -> Vec<AgentSignalRecord> {
    hits.iter().map(|h| AgentSignalRecord {
        timestamp: ts,
        org_id: org.to_string(),
        source_stream: stream.to_string(),
        signal_type: "cost".to_string(),
        agent_name: get_str(h, "gen_ai_agent_name"),
        tool_name: None,
        fail_class: None,
        count: get_u64(h, "errors").unwrap_or(0),
        calls: None, distinct_traces: None,
        cost: get_f64(h, "cost"),
        tokens: get_u64(h, "tokens"),
        errors: get_u64(h, "errors"),
        p95_latency_ns: get_u64(h, "p95"),
    }).collect()
}

#[cfg(all(test, feature = "enterprise"))]
mod test {
    #[test]
    fn test_failure_sql_groups_on_bounded_keys_only() {
        let sql = super::build_failure_sql("mystream", 100, 200);
        // must group by agent + class, never by trace_id
        assert!(sql.contains("GROUP BY gen_ai_agent_name"));
        assert!(sql.contains("fail_class"));
        assert!(!sql.to_lowercase().contains("group by trace_id"));
        // window-bounded
        assert!(sql.contains("_timestamp >= 100"));
        assert!(sql.contains("_timestamp < 200"));
        // classifies from existing columns (no marker)
        assert!(sql.contains("error_message"));
        assert!(sql.contains("'malformed_tool_call'"));
    }

    #[test]
    fn test_loop_ratio_sql_uses_hll_and_bounded_keys() {
        let sql = super::build_loop_ratio_sql("mystream", 100, 200);
        assert!(sql.contains("approx_distinct(trace_id)"));
        assert!(sql.contains("GROUP BY gen_ai_agent_name, gen_ai_tool_name"));
        assert!(!sql.to_lowercase().contains("group by trace_id"));
        assert!(sql.contains("execute_tool"));
    }

    #[test]
    fn test_cost_sql_groups_by_agent_only() {
        let sql = super::build_cost_sql("mystream", 100, 200);
        assert!(sql.contains("SUM(gen_ai_usage_cost)"));
        assert!(sql.contains("approx_percentile_cont(end_time - start_time, 0.95)"));
        assert!(sql.contains("GROUP BY gen_ai_agent_name"));
        assert!(!sql.to_lowercase().contains("group by trace_id"));
    }

    #[test]
    fn test_map_failure_hits_builds_records() {
        let hits = vec![serde_json::json!({
            "gen_ai_agent_name": "sre_rca_agent",
            "fail_class": "malformed_tool_call",
            "count": 161
        })];
        let recs = super::map_failure_hits("default", "s1", 1_000, &hits);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].signal_type, "failure");
        assert_eq!(recs[0].fail_class.as_deref(), Some("malformed_tool_call"));
        assert_eq!(recs[0].count, 161);
        assert_eq!(recs[0].tool_name, None);
        assert_eq!(recs[0].timestamp, 1_000);
    }

    #[test]
    fn test_map_loop_hits_carries_calls_and_traces() {
        let hits = vec![serde_json::json!({
            "gen_ai_agent_name": "a", "gen_ai_tool_name": "cli_kubectl",
            "calls": 1646, "distinct_traces": 71
        })];
        let recs = super::map_loop_hits("default", "s1", 1_000, &hits);
        assert_eq!(recs[0].signal_type, "loop");
        assert_eq!(recs[0].tool_name.as_deref(), Some("cli_kubectl"));
        assert_eq!(recs[0].calls, Some(1646));
        assert_eq!(recs[0].distinct_traces, Some(71));
    }
}
