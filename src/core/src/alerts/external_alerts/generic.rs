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

fn clamp_ts(ts: i64, now: i64) -> i64 {
    let lo = now - CLOCK_SKEW_TOLERANCE_MICROS;
    let hi = now + CLOCK_SKEW_TOLERANCE_MICROS;
    ts.clamp(lo, hi)
}

fn dedup_key_hash(labels: &HashMap<String, String>) -> String {
    let mut pairs: Vec<String> = labels.iter().map(|(k, v)| format!("{k}={v}")).collect();
    pairs.sort();
    let joined = pairs.join("\n");
    format!(
        "{:016x}",
        config::utils::hash::sum64_bytes(joined.as_bytes())
    )
}

fn normalize_one(item: &Value, now: i64) -> Result<ExternalAlertEvent, String> {
    let obj = item
        .as_object()
        .ok_or_else(|| "generic alert item must be an object".to_string())?;

    let status_str = obj
        .get("status")
        .and_then(|s| s.as_str())
        .ok_or_else(|| "generic alert item missing required 'status' field".to_string())?;
    let status = match status_str {
        "firing" => ExternalAlertStatus::Firing,
        "resolved" => ExternalAlertStatus::Resolved,
        other => return Err(format!("unrecognized status '{other}'")),
    };

    let raw_labels = obj
        .get("labels")
        .and_then(|l| l.as_object())
        .ok_or_else(|| "generic alert item missing required 'labels' field".to_string())?;

    let mut labels: HashMap<String, String> = HashMap::new();
    for (k, v) in raw_labels.iter() {
        let s = match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        labels.insert(k.clone(), s);
    }

    let severity_raw = obj
        .get("severity")
        .and_then(|s| s.as_str())
        .unwrap_or("warning");
    let severity = map_external_severity(severity_raw);

    let title = obj
        .get("title")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .or_else(|| labels.values().next().cloned())
        .unwrap_or_else(|| "external alert".to_string());

    let dedup_key = obj
        .get("dedup_key")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| dedup_key_hash(&labels));

    let event_ts = obj
        .get("event_ts")
        .and_then(|t| t.as_i64())
        .map(|t| clamp_ts(t, now))
        .unwrap_or(now);

    let source_url = obj
        .get("source_url")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    Ok(ExternalAlertEvent {
        status,
        dedup_key,
        title,
        severity,
        labels,
        event_ts,
        source_url,
        raw: item.clone(),
    })
}

/// Normalize a generic JSON payload — a single alert object or an array of
/// alert objects, each requiring `status` and `labels`.
pub fn normalize_generic(body: &Value, now: i64) -> Result<Vec<ExternalAlertEvent>, String> {
    if let Some(arr) = body.as_array() {
        return arr.iter().map(|item| normalize_one(item, now)).collect();
    }
    Ok(vec![normalize_one(body, now)?])
}
