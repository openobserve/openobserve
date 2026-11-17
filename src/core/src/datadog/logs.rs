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
//
// Portions ported from opentelemetry-collector-contrib receiver/datadogreceiver (Apache-2.0).

use config::{
    TIMESTAMP_COL_NAME,
    utils::time::{parse_f64_to_timestamp_micros, try_parse_i64_to_timestamp_micros},
};
use serde_json::{Map, Value};

use super::{
    DatadogError,
    tags::{HOST_NAME, SplitTags},
};

/// Flat logs-ingest records from a logs intake body; `{}`, `[]` or an empty body give none.
pub fn logs_to_records(body: &[u8]) -> Result<Vec<Value>, DatadogError> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(Vec::new());
    }
    let value: Value =
        serde_json::from_slice(body).map_err(|e| DatadogError::Decode(e.to_string()))?;
    let items = match value {
        Value::Array(items) => items,
        Value::Object(map) if map.is_empty() => return Ok(Vec::new()),
        object @ Value::Object(_) => vec![object],
        _ => {
            return Err(DatadogError::Decode(
                "logs body is not a JSON array or object".into(),
            ));
        }
    };
    items
        .into_iter()
        .map(|item| match item {
            Value::Object(record) => Ok(Value::Object(translate_record(record))),
            _ => Err(DatadogError::Decode(
                "log entry is not a JSON object".into(),
            )),
        })
        .collect()
}

fn translate_record(mut record: Map<String, Value>) -> Map<String, Value> {
    let envelope_timestamp = take_timestamp(&mut record, &["timestamp"], envelope_micros);
    let envelope_status = record.remove("status");
    expand_message(&mut record);
    // The logs write path reads `_id` as a string document ID and panics on any other type.
    if let Some(id) = record.get_mut("_id").filter(|id| !id.is_string()) {
        *id = Value::String(id.to_string());
    }
    if let Some(message) = record.remove("message") {
        record.insert("body".to_string(), message);
    }
    if let Some(severity) = message_severity(&record).or(envelope_status) {
        record.insert("severity".to_string(), severity);
    }
    let app_timestamp = take_timestamp(&mut record, &["@timestamp", "timestamp"], app_micros);
    if let Some(timestamp) = app_timestamp.or(envelope_timestamp) {
        record.insert(TIMESTAMP_COL_NAME.to_string(), timestamp.into());
    }
    if let Some(Value::String(ddtags)) = record.get("ddtags") {
        let tags = SplitTags::from_tags(ddtags.split(','));
        for (key, value) in tags.resource.into_iter().chain(tags.attributes) {
            record.entry(key).or_insert(Value::String(value));
        }
    }
    if let Some(hostname) = record.get("hostname").filter(|h| h.is_string()).cloned() {
        record.entry(HOST_NAME.to_string()).or_insert(hostname);
    }
    let trace_id = otel_hex_id(&record, "otel.trace_id", 32).or_else(|| dd_trace_id(&record));
    let span_id = otel_hex_id(&record, "otel.span_id", 16).or_else(|| dd_span_id(&record));
    if let Some(trace_id) = trace_id {
        record.insert("trace_id".to_string(), Value::String(trace_id));
    }
    if let Some(span_id) = span_id {
        record.insert("span_id".to_string(), Value::String(span_id));
    }
    record
}

/// A `message` holding a JSON object contributes its keys, which win over the envelope's.
fn expand_message(record: &mut Map<String, Value>) {
    let Some(Value::String(message)) = record.get("message") else {
        return;
    };
    if !message.trim_start().starts_with('{') {
        return;
    }
    let Ok(Value::Object(inner)) = serde_json::from_str::<Value>(message) else {
        return;
    };
    record.extend(inner);
}

/// The app's own level beats the envelope `status`, which the Agent defaults to `info`.
fn message_severity(record: &Map<String, Value>) -> Option<Value> {
    ["level", "severity", "status"]
        .into_iter()
        .find_map(|key| match record.get(key)? {
            Value::String(value) => Some(Value::String(value.clone())),
            value if key == "level" => {
                let severity = match value.as_u64()? {
                    10 => "trace",
                    20 => "debug",
                    30 => "info",
                    40 => "warn",
                    50 => "error",
                    60 => "fatal",
                    _ => return None,
                };
                Some(Value::String(severity.to_string()))
            }
            _ => None,
        })
}

fn take_timestamp(
    record: &mut Map<String, Value>,
    keys: &[&str],
    parse: fn(&Value) -> Option<i64>,
) -> Option<i64> {
    for key in keys {
        if let Some(timestamp) = record.get(*key).and_then(parse) {
            record.remove(*key);
            return Some(timestamp);
        }
    }
    None
}

/// Microseconds from the Agent's envelope, whose numbers are always Unix milliseconds.
fn envelope_micros(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n
            .as_i64()
            .map(|ms| ms.saturating_mul(1000))
            .or_else(|| n.as_f64().map(|ms| (ms * 1000.0) as i64)),
        _ => rfc3339_micros(value),
    }
}

/// Microseconds from an app's own field, whose numeric unit is told apart by magnitude.
fn app_micros(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => match n.as_i64() {
            Some(v) => try_parse_i64_to_timestamp_micros(v),
            None => n
                .as_f64()
                .map(parse_f64_to_timestamp_micros)
                .filter(|&t| t != i64::MIN),
        },
        _ => rfc3339_micros(value),
    }
}

fn rfc3339_micros(value: &Value) -> Option<i64> {
    let parsed = chrono::DateTime::parse_from_rfc3339(value.as_str()?).ok()?;
    Some(parsed.timestamp_micros())
}

fn text(record: &Map<String, Value>, key: &str) -> Option<String> {
    let value = record.get(key).or_else(|| {
        let (namespace, field) = key.split_once('.')?;
        record.get(namespace)?.get(field)
    })?;
    match value {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn otel_hex_id(record: &Map<String, Value>, key: &str, width: usize) -> Option<String> {
    let id = text(record, key)?;
    let valid = id.len() == width
        && id.bytes().all(|b| b.is_ascii_hexdigit())
        && id.bytes().any(|b| b != b'0');
    valid.then(|| id.to_ascii_lowercase())
}

fn has_hex_letter(id: &str) -> bool {
    id.bytes().any(|b| matches!(b, b'a'..=b'f' | b'A'..=b'F'))
}

fn dd_trace_id(record: &Map<String, Value>) -> Option<String> {
    let id = text(record, "dd.trace_id")?;
    // A 32-char ID is always hex, even when every digit is 0-9.
    let parsed = if id.len() == 32 {
        u128::from_str_radix(&id, 16).ok()?
    } else if id.len() == 16 && has_hex_letter(&id) {
        u128::from(u64::from_str_radix(&id, 16).ok()?)
    } else {
        id.parse::<u128>().ok()?
    };
    let upper = text(record, "_dd.p.tid").and_then(|tid| u64::from_str_radix(&tid, 16).ok());
    let full = match upper {
        Some(upper) if parsed >> 64 == 0 => (u128::from(upper) << 64) | parsed,
        _ => parsed,
    };
    (full != 0).then(|| format!("{full:032x}"))
}

fn dd_span_id(record: &Map<String, Value>) -> Option<String> {
    let id = text(record, "dd.span_id")?;
    let parsed = if id.len() == 16 && has_hex_letter(&id) {
        u64::from_str_radix(&id, 16).ok()?
    } else {
        id.parse::<u64>().ok()?
    };
    (parsed != 0).then(|| format!("{parsed:016x}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn one(body: Value) -> Map<String, Value> {
        let records = logs_to_records(body.to_string().as_bytes()).unwrap();
        assert_eq!(records.len(), 1);
        records
            .into_iter()
            .next()
            .unwrap()
            .as_object()
            .unwrap()
            .clone()
    }

    #[test]
    fn test_empty_bodies_give_no_records() {
        for body in [&b""[..], b"  \n", b"{}", b"[]"] {
            assert!(logs_to_records(body).unwrap().is_empty());
        }
        assert!(logs_to_records(b"not json").is_err());
        assert!(logs_to_records(b"[1]").is_err());
    }

    #[test]
    fn test_envelope_fields_are_mapped() {
        let r = one(json!([{
            "message": "plain text line",
            "status": "error",
            "timestamp": 1_700_000_000_123i64,
            "hostname": "web-1",
            "service": "checkout",
            "ddsource": "java",
            "ddtags": "env:prod,team:payments,standalone"
        }]));
        assert_eq!(r["body"], "plain text line");
        assert_eq!(r["severity"], "error");
        assert_eq!(r[TIMESTAMP_COL_NAME], 1_700_000_000_123_000i64);
        assert_eq!(r["hostname"], "web-1");
        assert_eq!(r["service"], "checkout");
        assert_eq!(r["ddsource"], "java");
        assert_eq!(r["deployment.environment.name"], "prod");
        assert_eq!(r["team"], "payments");
        assert_eq!(r["standalone"], "");
        assert_eq!(r["host.name"], "web-1");
        assert!(!r.contains_key("message"));
        assert!(!r.contains_key("trace_id"));
    }

    #[test]
    fn test_json_message_is_expanded_and_at_timestamp_used() {
        let message = json!({
            "@timestamp": "2024-01-02T03:04:05.678Z",
            "level": "WARN",
            "message": "payment declined",
            "dd.trace_id": "1234",
            "dd.span_id": "5678",
            "order": {"id": 7}
        });
        let r = one(json!([{
            "message": message.to_string(),
            "status": "info",
            "timestamp": 1_700_000_000_000i64
        }]));
        assert_eq!(r["body"], "payment declined");
        assert_eq!(r["level"], "WARN");
        assert_eq!(r["severity"], "WARN");
        assert_eq!(r["order"], json!({"id": 7}));
        assert_eq!(r[TIMESTAMP_COL_NAME], 1_704_164_645_678_000i64);
        assert_eq!(r["trace_id"], format!("{:032x}", 1234));
        assert_eq!(r["span_id"], format!("{:016x}", 5678));
        assert_eq!(r["dd.trace_id"], "1234");
    }

    #[test]
    fn test_inner_numeric_timestamp_unit_is_detected_and_the_envelope_stays_ms() {
        let envelope = 1_700_000_000_000i64;
        for inner in [
            json!(1_704_164_645i64),
            json!(1_704_164_645_000i64),
            json!(1_704_164_645_000_000i64),
            json!(1_704_164_645_000_000_000i64),
            json!(1_704_164_645.0f64),
        ] {
            let message = json!({"timestamp": inner, "message": "m"}).to_string();
            let r = one(json!([{"message": message, "timestamp": envelope}]));
            assert_eq!(r[TIMESTAMP_COL_NAME], 1_704_164_645_000_000i64, "{inner}");
        }
        let r = one(json!([{"message": "plain", "timestamp": 1_000_000i64}]));
        assert_eq!(r[TIMESTAMP_COL_NAME], 1_000_000_000i64);
        let message = json!({"timestamp": "not a time", "message": "m"}).to_string();
        let r = one(json!([{"message": message, "timestamp": envelope}]));
        assert_eq!(r[TIMESTAMP_COL_NAME], 1_700_000_000_000_000i64);
        assert_eq!(r["timestamp"], "not a time");
    }

    #[test]
    fn test_severity_prefers_level_then_severity_then_string_status() {
        let cases = [
            (
                json!({"level": "error", "severity": "warn", "status": "debug"}),
                "error",
            ),
            (json!({"severity": "warn", "status": "debug"}), "warn"),
            (json!({"status": "debug"}), "debug"),
            (json!({"level": 3, "status": 500}), "info"),
            (json!({"msg": "no level"}), "info"),
        ];
        for (message, expected) in cases {
            let r = one(json!([{"message": message.to_string(), "status": "info"}]));
            assert_eq!(r["severity"], expected, "message {message}");
        }
        let r = one(json!([{"message": "plain", "status": "warn"}]));
        assert_eq!(r["severity"], "warn");
        assert!(!r.contains_key("status"));
    }

    #[test]
    fn test_host_tag_wins_over_hostname() {
        let r = one(json!([{"message": "m", "hostname": "web-1", "ddtags": "host:node-7"}]));
        assert_eq!(r["host.name"], "node-7");
        assert_eq!(r["hostname"], "web-1");
    }

    #[test]
    fn test_non_string_id_is_stored_as_its_json_text() {
        for (id, expected) in [
            (json!(123), "123"),
            (json!({"a": 1}), r#"{"a":1}"#),
            (json!(null), "null"),
            (json!("abc"), "abc"),
        ] {
            let message = json!({"_id": id, "message": "m"}).to_string();
            let r = one(json!([{"message": message}]));
            assert_eq!(r["_id"], expected, "{id}");
        }
        let r = one(json!([{"message": "m", "_id": 7}]));
        assert_eq!(r["_id"], "7");
    }

    #[test]
    fn test_json_message_without_message_key_keeps_original_text() {
        let text = r#"{"user":"ann"}"#;
        let r = one(json!([{"message": text, "timestamp": 1_700_000_000_000i64}]));
        assert_eq!(r["body"], text);
        assert_eq!(r["user"], "ann");
        assert_eq!(r[TIMESTAMP_COL_NAME], 1_700_000_000_000_000i64);
    }

    #[test]
    fn test_otel_ids_win_over_dd_ids() {
        let r = one(json!([{
            "message": "m",
            "otel.trace_id": "0AF7651916CD43DD8448EB211C80319C",
            "otel.span_id": "b7ad6b7169203331",
            "dd.trace_id": "1",
            "dd.span_id": "2"
        }]));
        assert_eq!(r["trace_id"], "0af7651916cd43dd8448eb211c80319c");
        assert_eq!(r["span_id"], "b7ad6b7169203331");
    }

    #[test]
    fn test_64_bit_dd_trace_id_with_tid_matches_128_bit_trace() {
        let r = one(json!([{
            "message": "m",
            "dd.trace_id": 13_835_058_055_282_163_712u64,
            "_dd.p.tid": "6553f1a400000000",
            "dd.span_id": "9223372036854775808"
        }]));
        assert_eq!(r["trace_id"], "6553f1a400000000c000000000000000");
        assert_eq!(r["span_id"], "8000000000000000");
    }

    #[test]
    fn test_dd_trace_id_widths() {
        let cases = [
            (
                "12345678901234567890123456789012",
                "12345678901234567890123456789012",
            ),
            (
                "00000000000000000000000000000abc",
                "00000000000000000000000000000abc",
            ),
            ("00000000000000ab", "000000000000000000000000000000ab"),
            ("1234567890123456", "0000000000000000000462d53c8abac0"),
        ];
        for (input, expected) in cases {
            let r = one(json!([{"message": "m", "dd.trace_id": input}]));
            assert_eq!(r["trace_id"], expected, "input {input}");
        }
        let r = one(json!([{"message": "m", "dd.trace_id": "0", "dd.span_id": "x"}]));
        assert!(!r.contains_key("trace_id"));
        assert!(!r.contains_key("span_id"));
    }

    #[test]
    fn test_nested_log_injection_produces_canonical_ids() {
        for message in [
            json!({"dd": {"trace_id": "1234", "span_id": "5678"}}),
            json!({"dd": {"trace_id": "000000000000000000000000000004d2", "span_id": "5678"}}),
            json!({"otel": {"trace_id": "000000000000000000000000000004d2", "span_id": "000000000000162e"}}),
            json!({"dd.trace_id": "1234", "dd.span_id": "5678", "dd": {"trace_id": "9", "span_id": "8"}}),
        ] {
            let record = one(json!([{"message": message.to_string()}]));
            assert_eq!(record["trace_id"], format!("{:032x}", 1234), "{message}");
            assert_eq!(record["span_id"], format!("{:016x}", 5678), "{message}");
        }
    }

    #[test]
    fn test_pino_numeric_levels_override_the_agent_envelope() {
        for (level, expected) in [
            (10, "trace"),
            (20, "debug"),
            (30, "info"),
            (40, "warn"),
            (50, "error"),
            (60, "fatal"),
            (35, "info"),
        ] {
            let message = json!({"level": level, "msg": "payment"}).to_string();
            let record = one(json!([{"message": message, "status": "info"}]));
            assert_eq!(record["severity"], expected, "level {level}");
            assert_eq!(record["level"], level);
        }
    }
}
