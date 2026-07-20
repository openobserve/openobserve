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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::utils::json;

/// Caps for the failure-taxonomy config. These bound the size of the generated
/// SQL `CASE` and keep org-supplied input from ballooning the query.
const MAX_ERROR_DETAIL_FIELDS: usize = 20;
const MAX_ERROR_DETAIL_FIELD_LEN: usize = 256;
const MAX_FAILURE_RULES: usize = 100;
const MAX_PATTERNS_PER_RULE: usize = 50;
const MAX_CLASS_LEN: usize = 128;
const MAX_PATTERN_LEN: usize = 512;

/// One failure-taxonomy rule: a class name and the SQL LIKE patterns that map to
/// it. Patterns are stored bare — the enterprise SQL builder adds `%` wildcards
/// and escapes at generation time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FailureRule {
    pub class: String,
    pub patterns: Vec<String>,
}

/// The agent-signals failure taxonomy: which span columns carry error detail (in
/// priority order) and the ordered, first-match-wins classification rules.
///
/// Resolved per-org as: org override (system_settings) → repo file default →
/// embedded fallback → OSS minimal default. Mirrors [`super::gen_ai`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AgentSignalsTaxonomy {
    /// Span columns that may carry error detail, in priority order. COALESCEd into
    /// a single string the classifier matches against.
    #[serde(default)]
    pub error_detail_fields: Vec<String>,

    /// Failure-taxonomy rules, evaluated top-to-bottom (first match wins).
    #[serde(default)]
    pub failure_rules: Vec<FailureRule>,
}

impl AgentSignalsTaxonomy {
    /// Trim and validate on save/load. Enforces caps and rejects any `'` or `;`
    /// in patterns/classes — these values are compiled into generated SQL `LIKE`
    /// clauses, so org-supplied input is the trust boundary here.
    pub fn normalize_and_validate(mut self) -> Result<Self, String> {
        self.error_detail_fields = self
            .error_detail_fields
            .into_iter()
            .map(|f| f.trim().to_string())
            .filter(|f| !f.is_empty())
            .collect();

        if self.error_detail_fields.len() > MAX_ERROR_DETAIL_FIELDS {
            return Err(format!(
                "error_detail_fields cannot exceed {MAX_ERROR_DETAIL_FIELDS} fields"
            ));
        }
        let mut seen_fields = HashSet::new();
        for field in &self.error_detail_fields {
            if field.len() > MAX_ERROR_DETAIL_FIELD_LEN {
                return Err(format!(
                    "error_detail_fields field '{field}' cannot exceed {MAX_ERROR_DETAIL_FIELD_LEN} characters"
                ));
            }
            if !is_safe_column(field) {
                return Err(format!(
                    "error_detail_fields field '{field}' contains invalid characters"
                ));
            }
            if !seen_fields.insert(field.as_str()) {
                return Err(format!(
                    "error_detail_fields contains duplicate field '{field}'"
                ));
            }
        }

        let mut rules = Vec::with_capacity(self.failure_rules.len());
        for rule in self.failure_rules {
            let class = rule.class.trim().to_string();
            if class.is_empty() {
                return Err("failure rule class cannot be empty".to_string());
            }
            if class.len() > MAX_CLASS_LEN {
                return Err(format!(
                    "failure rule class '{class}' cannot exceed {MAX_CLASS_LEN} characters"
                ));
            }
            if contains_sql_meta(&class) {
                return Err(format!(
                    "failure rule class '{class}' must not contain ' or ;"
                ));
            }
            let patterns: Vec<String> = rule
                .patterns
                .into_iter()
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect();
            if patterns.is_empty() {
                return Err(format!("failure rule '{class}' has no patterns"));
            }
            if patterns.len() > MAX_PATTERNS_PER_RULE {
                return Err(format!(
                    "failure rule '{class}' cannot exceed {MAX_PATTERNS_PER_RULE} patterns"
                ));
            }
            for pat in &patterns {
                if pat.len() > MAX_PATTERN_LEN {
                    return Err(format!(
                        "failure rule '{class}' pattern cannot exceed {MAX_PATTERN_LEN} characters"
                    ));
                }
                if contains_sql_meta(pat) {
                    return Err(format!(
                        "failure rule '{class}' pattern '{pat}' must not contain ' or ;"
                    ));
                }
            }
            rules.push(FailureRule { class, patterns });
        }

        if rules.len() > MAX_FAILURE_RULES {
            return Err(format!(
                "failure_rules cannot exceed {MAX_FAILURE_RULES} rules"
            ));
        }
        self.failure_rules = rules;

        Ok(self)
    }
}

/// A span column name is safe if it looks like an identifier path: starts with a
/// letter or `_`, and contains only alphanumerics, `_`, or `.` after that.
fn is_safe_column(field: &str) -> bool {
    let Some(first) = field.chars().next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && field
            .chars()
            .skip(1)
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '.')
}

/// Reject the two characters that would break out of a generated SQL `LIKE`
/// clause or the CASE statement. Patterns are otherwise free-form substrings
/// (including `%` and spaces), so we do not restrict them to identifiers.
fn contains_sql_meta(s: &str) -> bool {
    s.contains('\'') || s.contains(';')
}

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
        if let Some(obj) = v.as_object_mut()
            && let Some(ts) = obj.remove("timestamp")
        {
            obj.insert("_timestamp".to_string(), ts);
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

    fn valid_taxonomy() -> AgentSignalsTaxonomy {
        AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string(), "error_message".to_string()],
            failure_rules: vec![FailureRule {
                class: "rate_limited".to_string(),
                patterns: vec!["RateLimit".to_string(), "429".to_string()],
            }],
        }
    }

    #[test]
    fn test_taxonomy_json_round_trip() {
        let taxonomy = valid_taxonomy();
        let json_str = serde_json::to_string(&taxonomy).unwrap();
        let back: AgentSignalsTaxonomy = serde_json::from_str(&json_str).unwrap();
        assert_eq!(taxonomy, back);
    }

    #[test]
    fn test_taxonomy_normalizes_and_trims() {
        let taxonomy = AgentSignalsTaxonomy {
            error_detail_fields: vec!["  status_message  ".to_string(), "".to_string()],
            failure_rules: vec![FailureRule {
                class: " rate_limited ".to_string(),
                patterns: vec![" 429 ".to_string(), "".to_string()],
            }],
        }
        .normalize_and_validate()
        .unwrap();

        assert_eq!(taxonomy.error_detail_fields, vec!["status_message"]);
        assert_eq!(taxonomy.failure_rules[0].class, "rate_limited");
        assert_eq!(taxonomy.failure_rules[0].patterns, vec!["429"]);
    }

    #[test]
    fn test_taxonomy_rejects_single_quote_in_pattern() {
        let err = AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string()],
            failure_rules: vec![FailureRule {
                class: "inject".to_string(),
                patterns: vec!["x' OR '1'='1".to_string()],
            }],
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("' or ;"), "unexpected err: {err}");
    }

    #[test]
    fn test_taxonomy_rejects_semicolon_in_pattern() {
        let err = AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string()],
            failure_rules: vec![FailureRule {
                class: "inject".to_string(),
                patterns: vec!["x; DROP TABLE".to_string()],
            }],
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("' or ;"), "unexpected err: {err}");
    }

    #[test]
    fn test_taxonomy_rejects_unsafe_error_detail_field() {
        let err = AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message; DROP".to_string()],
            failure_rules: vec![],
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("invalid characters"), "unexpected err: {err}");
    }

    #[test]
    fn test_taxonomy_rejects_empty_class() {
        let err = AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string()],
            failure_rules: vec![FailureRule {
                class: "   ".to_string(),
                patterns: vec!["x".to_string()],
            }],
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(
            err.contains("class cannot be empty"),
            "unexpected err: {err}"
        );
    }

    #[test]
    fn test_taxonomy_rejects_rule_with_no_patterns() {
        let err = AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string()],
            failure_rules: vec![FailureRule {
                class: "empty".to_string(),
                patterns: vec!["".to_string(), "  ".to_string()],
            }],
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("no patterns"), "unexpected err: {err}");
    }

    #[test]
    fn test_taxonomy_rejects_duplicate_error_detail_field() {
        let err = AgentSignalsTaxonomy {
            error_detail_fields: vec!["status_message".to_string(), "status_message".to_string()],
            failure_rules: vec![],
        }
        .normalize_and_validate()
        .unwrap_err();
        assert!(err.contains("duplicate"), "unexpected err: {err}");
    }

    #[test]
    fn test_taxonomy_valid_passes() {
        assert!(valid_taxonomy().normalize_and_validate().is_ok());
    }
}
