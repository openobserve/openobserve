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

use config::meta::alerts::incidents::{
    ExternalAlertEvent, ExternalAlertStatus, map_external_severity,
};
use serde_json::Value;

use super::CLOCK_SKEW_TOLERANCE_MICROS;

/// Labels never surfaced on the normalized event (spec §4.2 deny-list).
const LABEL_DENY_LIST: &[&str] = &["job"];

fn labels_hash(labels: &serde_json::Map<String, Value>) -> String {
    let mut pairs: Vec<String> = labels
        .iter()
        .map(|(k, v)| format!("{k}={}", value_to_label_string(v)))
        .collect();
    pairs.sort();
    let joined = pairs.join("\n");
    format!(
        "{:016x}",
        config::utils::hash::sum64_bytes(joined.as_bytes())
    )
}

fn value_to_label_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn clamp_ts(ts: i64, now: i64) -> i64 {
    let lo = now - CLOCK_SKEW_TOLERANCE_MICROS;
    let hi = now + CLOCK_SKEW_TOLERANCE_MICROS;
    ts.clamp(lo, hi)
}

fn parse_rfc3339_micros(s: &str) -> Option<i64> {
    if s.is_empty() || s == "0001-01-01T00:00:00Z" {
        return None;
    }
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp_micros())
}

/// Normalize a Grafana or Alertmanager webhook payload — both share the same
/// wire format (`alerts[]` array of firing/resolved entries).
pub fn normalize_am_format(body: &Value, now: i64) -> Result<Vec<ExternalAlertEvent>, String> {
    let alerts = body
        .get("alerts")
        .and_then(|a| a.as_array())
        .ok_or_else(|| "missing alerts array".to_string())?;

    let mut events = Vec::with_capacity(alerts.len());
    for alert in alerts {
        let status_str = alert
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("firing");
        let status = if status_str == "resolved" {
            ExternalAlertStatus::Resolved
        } else {
            ExternalAlertStatus::Firing
        };

        let raw_labels = alert
            .get("labels")
            .and_then(|l| l.as_object())
            .cloned()
            .unwrap_or_default();

        let dedup_key = alert
            .get("fingerprint")
            .and_then(|f| f.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| labels_hash(&raw_labels));

        let severity_raw = raw_labels
            .get("severity")
            .and_then(|s| s.as_str())
            .unwrap_or("warning");
        let severity = map_external_severity(severity_raw);

        let mut labels: HashMap<String, String> = HashMap::new();
        for (k, v) in raw_labels.iter() {
            if LABEL_DENY_LIST.contains(&k.as_str()) {
                continue;
            }
            labels.insert(k.clone(), value_to_label_string(v));
        }

        let ts_field = if status == ExternalAlertStatus::Resolved {
            "endsAt"
        } else {
            "startsAt"
        };
        let event_ts = alert
            .get(ts_field)
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_micros)
            .unwrap_or(now);
        let event_ts = clamp_ts(event_ts, now);

        let title = labels
            .get("alertname")
            .cloned()
            .or_else(|| {
                alert
                    .get("annotations")
                    .and_then(|a| a.get("summary"))
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "external alert".to_string());

        let source_url = alert
            .get("generatorURL")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());

        events.push(ExternalAlertEvent {
            status,
            dedup_key,
            title,
            severity,
            labels,
            event_ts,
            source_url,
            raw: alert.clone(),
        });
    }

    Ok(events)
}
