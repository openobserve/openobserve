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

//! Raw, unescaped notification values, computed once per notification.
//!
//! Every side effect a notification needs — `build_sql`, alert-URL shortening,
//! time formatting, row-column collection — happens while building this struct.
//! Rendering (`super::custom::apply_custom_template`) is then pure, which is
//! what makes it lockable by a golden corpus.

use std::collections::{BTreeMap, HashMap, HashSet};

use config::{
    meta::alerts::level::AlertLevel,
    utils::json::{Map, Value},
};

/// Raw (unescaped) values for one notification render.
///
/// Values are stored exactly as computed; escaping is the renderer's job
/// (`format_variable_value`), so a value used in two places escapes
/// identically.
#[derive(Debug, Clone, Default)]
pub struct NotificationContext {
    pub org_name: String,
    pub stream_type: String,
    pub stream_name: String,
    pub alert_name: String,
    /// "realtime" | "scheduled"
    pub alert_type: String,
    pub alert_period: String,
    pub alert_operator: String,
    pub alert_threshold: String,
    pub alert_count: String,
    pub alert_agg_value: String,
    pub alert_level: String,
    pub alert_priority: String,
    pub alert_tags: String,
    pub alert_threshold_crit: String,
    pub alert_threshold_warn: String,
    /// Formatted local time; "N/A" when unknown.
    pub alert_start_time: String,
    pub alert_end_time: String,
    /// Already shortened; falls back to the long URL when shortening fails.
    pub alert_url: String,
    /// Stateless signed chart-render URL (the URL carries the chart data;
    /// see notifications::chart). Set per destination by `send_notification`:
    /// only when THAT destination's template enables the chart, so a shared
    /// context never leaks a chart into a template that didn't ask for one.
    pub chart_url: Option<String>,
    /// Send-time-rendered PNG for channels that carry bytes in the send
    /// itself (email CID attachment, Discord multipart upload). Same
    /// per-destination lifecycle as `chart_url`.
    pub chart_png: Option<std::sync::Arc<Vec<u8>>>,
    /// Trigger (evaluation) timestamp in microseconds.
    pub alert_trigger_time: i64,
    pub alert_trigger_time_str: String,
    pub alert_description: String,
    pub promql_operator: Option<String>,
    pub promql_value: Option<String>,
    pub rows: Vec<Map<String, Value>>,
    pub rows_tpl_val: Vec<Value>,
    /// Row columns in row-encounter order, values deduped preserving
    /// first-seen order — the deterministic-ordering rule.
    pub row_columns: Vec<(String, Vec<String>)>,
    pub context_attributes: Vec<(String, String)>,
    pub metadata: Vec<(String, String)>,
    pub group_labels: Option<BTreeMap<String, String>>,
    pub level: Option<AlertLevel>,
}

/// Collect row columns in deterministic order.
///
/// Replaces `get_row_column_map`'s `HashMap<String, HashSet<String>>` at the
/// context boundary. Same per-value stringification
/// ([`super::custom::stringify_row_value`]), same dedup semantics — but keys
/// come out in row-encounter order and values in first-seen order, so a
/// multi-value `{host}` joins as `web-1, web-2` on every run instead of
/// whichever order the hasher happened to produce.
pub fn build_row_columns(rows: &[Map<String, Value>]) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    let mut idx: HashMap<String, usize> = HashMap::new();
    let mut seen: HashMap<String, HashSet<String>> = HashMap::new();
    for row in rows {
        for (k, v) in row {
            let s = super::custom::stringify_row_value(v);
            let i = *idx.entry(k.clone()).or_insert_with(|| {
                out.push((k.clone(), Vec::new()));
                out.len() - 1
            });
            if seen.entry(k.clone()).or_default().insert(s.clone()) {
                out[i].1.push(s);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(s: &str) -> Map<String, Value> {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn build_row_columns_preserves_encounter_order() {
        // Within-row key order depends on serde_json's Map backing: BTreeMap
        // (sorted) in a plain build, IndexMap (insertion) when any crate in
        // the build graph enables `preserve_order` — which --workspace builds
        // do via the rmcp deps. The first row's keys are alphabetical AND in
        // insertion order so both backings iterate them identically; "app" in
        // the second row sorts before both but must land last because
        // encounter order across rows wins.
        let rows = vec![
            row(r#"{"cpu":92.5,"host":"web-1"}"#),
            row(r#"{"app":"api","cpu":88.1,"host":"web-2"}"#),
        ];
        let cols = build_row_columns(&rows);
        assert_eq!(
            cols,
            vec![
                (
                    "cpu".to_string(),
                    vec!["92.5".to_string(), "88.1".to_string()]
                ),
                (
                    "host".to_string(),
                    vec!["web-1".to_string(), "web-2".to_string()]
                ),
                ("app".to_string(), vec!["api".to_string()]),
            ]
        );
    }

    #[test]
    fn build_row_columns_dedupes_keeping_first_seen() {
        let rows = vec![
            row(r#"{"host":"web-1"}"#),
            row(r#"{"host":"web-1"}"#),
            row(r#"{"host":"web-2"}"#),
        ];
        let cols = build_row_columns(&rows);
        assert_eq!(
            cols,
            vec![(
                "host".to_string(),
                vec!["web-1".to_string(), "web-2".to_string()]
            )]
        );
    }

    #[test]
    fn build_row_columns_empty() {
        assert!(build_row_columns(&[]).is_empty());
    }
}
