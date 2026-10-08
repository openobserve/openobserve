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
    meta::alerts::alert::Alert,
    utils::json::{Map, Value},
};

use super::alert::{format_alert_time, get_alert_start_end_time, get_row_column_map};

const MAX_TITLE_CHARS: usize = 255;

#[derive(Debug, Clone, Copy)]
pub struct TitleInputs<'a> {
    pub alert: &'a Alert,
    pub result_row: &'a Map<String, Value>,
    pub notify_rows: &'a [Map<String, Value>],
    pub labels: &'a HashMap<String, String>,
}

/// `None` when the template is unset, renders blank, or has any unresolved variable.
pub fn render(
    inputs: &TitleInputs<'_>,
    org_name: &str,
    group_values: &HashMap<String, String>,
    triggered_at: i64,
) -> Option<String> {
    let alert = inputs.alert;
    let template = alert.incident_title_template.as_deref()?;
    let mut vars = inputs.result_row.clone();
    for (key, value) in inputs
        .labels
        .iter()
        .chain(group_values.iter())
        .chain(alert.context_attributes.iter().flatten())
    {
        vars.entry(key.as_str())
            .or_insert_with(|| Value::String(value.clone()));
    }
    let use_given_time = alert
        .query_condition
        .multi_time_range
        .as_ref()
        .is_some_and(|tr| !tr.is_empty());
    let (start, end) = get_alert_start_end_time(
        &get_row_column_map(inputs.notify_rows),
        alert.trigger_condition.period,
        triggered_at,
        None,
        use_given_time,
    );
    let trigger_time = format_alert_time(triggered_at);
    let start_time = format_alert_time(start);
    let end_time = format_alert_time(end);
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
    // Row values may hold newlines, and Postgres `title` is varchar(500).
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

#[cfg(test)]
mod tests {
    use super::*;

    fn row(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    fn render_with(
        alert: &Alert,
        r: &Map<String, Value>,
        group: &HashMap<String, String>,
        triggered_at: i64,
    ) -> Option<String> {
        let inputs = TitleInputs {
            alert,
            result_row: r,
            notify_rows: std::slice::from_ref(r),
            labels: &HashMap::new(),
        };
        render(&inputs, "acme", group, triggered_at)
    }

    #[test]
    fn renders_or_falls_back() {
        let mut alert = Alert::default();
        alert.name = "HighErrors".to_string();
        alert.stream_name = "app".into();
        let r = row(serde_json::json!({"service": "checkout", "count": 42}));
        let none = HashMap::new();

        assert_eq!(render_with(&alert, &r, &none, 0), None);

        alert.incident_title_template =
            Some("{alert_name}: {service} x{count} ({stream_name}, {org_name})".into());
        assert_eq!(
            render_with(&alert, &r, &none, 0).as_deref(),
            Some("HighErrors: checkout x42 (app, acme)")
        );

        let group = HashMap::from([
            ("service".to_string(), "ignored".to_string()),
            ("host".to_string(), "web-1".to_string()),
        ]);
        alert.incident_title_template = Some("{service} on {host}".into());
        assert_eq!(
            render_with(&alert, &r, &group, 0).as_deref(),
            Some("checkout on web-1")
        );

        alert.incident_title_template = Some("{service} {missing}".into());
        assert_eq!(render_with(&alert, &r, &none, 0), None);

        alert.incident_title_template = Some("   ".into());
        assert_eq!(render_with(&alert, &r, &none, 0), None);
    }

    #[test]
    fn sanitizes_and_caps_row_values() {
        let mut alert = Alert::default();
        alert.incident_title_template = Some("{msg}".into());
        let r = row(serde_json::json!({"msg": format!("a\r\nb\t{}", "x".repeat(400))}));
        let title = render_with(&alert, &r, &HashMap::new(), 0).unwrap();
        assert!(title.starts_with("a b x"));
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn times_match_the_notification_values() {
        let mut alert = Alert::default();
        alert.trigger_condition.period = 10;
        alert.incident_title_template = Some("{alert_start_time} - {alert_end_time}".into());
        let triggered_at = 1_782_303_000_000_000;
        let minute = 60_000_000;
        let none = HashMap::new();

        let r = row(
            serde_json::json!({"zo_sql_min_time": 1_782_302_700_000_000_i64, "zo_sql_max_time": "1782302940000000"}),
        );
        let expected = format!(
            "{} - {}",
            format_alert_time(1_782_302_700_000_000),
            format_alert_time(1_782_302_940_000_000 + minute)
        );
        assert_eq!(
            render_with(&alert, &r, &none, triggered_at).as_deref(),
            Some(expected.as_str())
        );

        let expected = format!(
            "{} - {}",
            format_alert_time(triggered_at - 10 * minute),
            format_alert_time(triggered_at)
        );
        assert_eq!(
            render_with(&alert, &Map::new(), &none, triggered_at).as_deref(),
            Some(expected.as_str())
        );
    }
}
