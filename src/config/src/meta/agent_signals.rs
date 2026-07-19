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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::utils::json;

/// One agent-signals rollup record. Written to the `_agent_signals` stream.
/// Grouped only on bounded keys (agent, tool, fail_class) — never trace_id.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AgentSignalRecord {
    pub timestamp: i64,
    pub org_id: String,
    pub source_stream: String,
    /// "failure" | "loop" | "cost"
    pub signal_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fail_class: Option<String>,
    pub count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calls: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distinct_traces: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub p95_latency_ns: Option<u64>,
}

impl AgentSignalRecord {
    /// Serialize for ingestion: `timestamp` becomes `_timestamp`, None optionals omitted.
    pub fn to_json(&self) -> json::Value {
        let mut v = json::to_value(self).unwrap_or(json::Value::Null);
        if let Some(obj) = v.as_object_mut() {
            if let Some(ts) = obj.remove("timestamp") {
                obj.insert("_timestamp".to_string(), ts);
            }
        }
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_record() -> AgentSignalRecord {
        AgentSignalRecord {
            timestamp: 1_000_000,
            org_id: "default".to_string(),
            source_stream: "sre_agent_traces".to_string(),
            signal_type: "failure".to_string(),
            agent_name: Some("sre_rca_agent".to_string()),
            tool_name: None,
            fail_class: Some("malformed_tool_call".to_string()),
            count: 161,
            calls: None,
            distinct_traces: None,
            cost: None,
            tokens: None,
            errors: None,
            p95_latency_ns: None,
        }
    }

    #[test]
    fn test_to_json_maps_timestamp_and_required_fields() {
        let val = make_record().to_json();
        assert_eq!(val["_timestamp"], 1_000_000_i64);
        assert_eq!(val["org_id"], "default");
        assert_eq!(val["signal_type"], "failure");
        assert_eq!(val["fail_class"], "malformed_tool_call");
        assert_eq!(val["count"], 161_u64);
    }

    #[test]
    fn test_to_json_omits_none_optionals() {
        let val = make_record().to_json();
        assert!(val.get("tool_name").is_none());
        assert!(val.get("cost").is_none());
    }
}
