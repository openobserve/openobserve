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

//! Renders an alert's `incident_title_template` into an incident title.

use std::collections::HashMap;

use config::{
    TIMESTAMP_COL_NAME,
    meta::alerts::alert::Alert,
    utils::json::{Map, Value},
};

/// Manual title edits are capped at the same length.
const MAX_TITLE_CHARS: usize = 255;

/// `None` when the template is unset, renders blank, or has any unresolved variable.
pub fn render(
    alert: &Alert,
    org_name: &str,
    result_row: &Map<String, Value>,
    dimensions: &[&HashMap<String, String>],
    triggered_at: i64,
) -> Option<String> {
    let template = alert.incident_title_template.as_deref()?;
    let mut vars = result_row.clone();
    for (key, value) in dimensions
        .iter()
        .flat_map(|d| d.iter())
        .chain(alert.context_attributes.iter().flatten())
    {
        vars.entry(key.as_str())
            .or_insert_with(|| Value::String(value.clone()));
    }
    let window_start = triggered_at - alert.trigger_condition.period * 60_000_000;
    let (start, end) = row_time_range(result_row);
    let trigger_time = format_micros(triggered_at);
    let start_time = format_micros(start.unwrap_or(window_start));
    let end_time = format_micros(end.unwrap_or(triggered_at));
    for (key, value) in [
        ("alert_name", alert.name.as_str()),
        ("org_name", org_name),
        ("stream_name", alert.stream_name.as_str()),
        ("stream_type", alert.stream_type.as_str()),
        ("alert_trigger_time_str", trigger_time.as_str()),
        ("alert_time", trigger_time.as_str()),
        ("alert_start_time", start_time.as_str()),
        ("alert_end_time", end_time.as_str()),
    ] {
        vars.insert(key.to_string(), Value::String(value.to_string()));
    }
    let mut unknown = Vec::new();
    let title = super::notifications::resolve::substitute_raw_row(template, &vars, &mut unknown);
    // Row values can carry newlines into email subjects, and Postgres still has `title` as
    // varchar(500).
    let title: String = title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TITLE_CHARS)
        .collect();
    (unknown.is_empty() && !title.is_empty()).then_some(title)
}

/// Same bounds `process_row_template` derives `{alert_start_time}`/`{alert_end_time}` from.
fn row_time_range(row: &Map<String, Value>) -> (Option<i64>, Option<i64>) {
    let micros = |key: &str| {
        row.get(key).and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
    };
    let ts = micros(TIMESTAMP_COL_NAME);
    let start = [ts, micros("zo_sql_min_time")].into_iter().flatten().min();
    let end = [ts, micros("zo_sql_max_time")].into_iter().flatten().max();
    (start, end)
}

fn format_micros(micros: i64) -> String {
    chrono::DateTime::from_timestamp_micros(micros)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn renders_or_falls_back() {
        let mut alert = Alert::default();
        alert.name = "HighErrors".to_string();
        alert.stream_name = "app".into();
        let r = row(serde_json::json!({"service": "checkout", "count": 42}));

        assert_eq!(render(&alert, "acme", &r, &[], 0), None);

        alert.incident_title_template =
            Some("{alert_name}: {service} x{count} ({stream_name}, {org_name})".into());
        assert_eq!(
            render(&alert, "acme", &r, &[], 0).as_deref(),
            Some("HighErrors: checkout x42 (app, acme)")
        );

        let group = HashMap::from([
            ("service".to_string(), "ignored".to_string()),
            ("host".to_string(), "web-1".to_string()),
        ]);
        alert.incident_title_template = Some("{service} on {host}".into());
        assert_eq!(
            render(&alert, "acme", &r, &[&group], 0).as_deref(),
            Some("checkout on web-1")
        );

        alert.incident_title_template = Some("{service} {missing}".into());
        assert_eq!(render(&alert, "acme", &r, &[], 0), None);

        alert.incident_title_template = Some("   ".into());
        assert_eq!(render(&alert, "acme", &r, &[], 0), None);
    }

    #[test]
    fn sanitizes_and_caps_row_values() {
        let mut alert = Alert::default();
        alert.incident_title_template = Some("{msg}".into());
        let r = row(serde_json::json!({"msg": format!("a\r\nb\t{}", "x".repeat(400))}));
        let title = render(&alert, "acme", &r, &[], 0).unwrap();
        assert!(title.starts_with("a b x"));
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn start_and_end_time_come_from_the_row_or_the_window() {
        let mut alert = Alert::default();
        alert.trigger_condition.period = 10;
        alert.incident_title_template = Some("{alert_start_time} - {alert_end_time}".into());
        let triggered_at = 1_782_303_000_000_000;

        let r = row(
            serde_json::json!({"zo_sql_min_time": 1_782_302_700_000_000_i64, "zo_sql_max_time": "1782302940000000"}),
        );
        assert_eq!(
            render(&alert, "acme", &r, &[], triggered_at).as_deref(),
            Some("2026-06-24T12:05:00Z - 2026-06-24T12:09:00Z")
        );

        assert_eq!(
            render(&alert, "acme", &Map::new(), &[], triggered_at).as_deref(),
            Some("2026-06-24T12:00:00Z - 2026-06-24T12:10:00Z")
        );
    }
}
