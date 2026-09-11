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
use axum::body::Bytes;
use config::{
    get_config,
    meta::stream::{StreamParams, StreamType},
    utils::{json, schema::format_stream_name},
};
use hashbrown::HashMap;
use infra::errors::Result;
use ingestion_common::{
    HecResponse, HecStatus, IngestUser, IngestionRequest, IngestionResponse, IngestionValueType,
};
use serde::Deserialize;

use crate::{ingestion::check_ingestion_allowed, service::get_formatted_stream_name};

/// Why a HEC body could not be turned into records. Maps onto the collector's
/// status codes; the legacy route flattens all of these into its own codes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HecParseError {
    /// Body held no events at all.
    NoData,
    /// Malformed JSON, an unusable `time`, or an `event` that is not an object or string.
    InvalidFormat(String),
    /// `event` key missing from an entry.
    EventRequired,
    /// `event` present but empty.
    EventBlank,
    /// No index resolvable for an entry.
    InvalidIndex,
}

/// One HEC entry as it arrives on the wire.
#[derive(Deserialize, Clone)]
struct HecEntry {
    index: Option<String>,
    time: Option<json::Value>,
    host: Option<json::Value>,
    source: Option<json::Value>,
    sourcetype: Option<json::Value>,
    fields: Option<json::Value>,
    event: Option<json::Value>,
}

/// Events parsed out of one HEC body, already grouped by resolved stream name.
pub struct HecParsed {
    pub streams: HashMap<String, Vec<json::Value>>,
}

/// Ingest a HEC body on the legacy `/api/{org_id}/_hec` route.
///
/// Response shape is frozen: this route's `HecResponse` bodies must stay
/// byte-identical to what they were before the parser was fixed.
pub async fn ingest(
    thread_id: usize,
    org_id: &str,
    body: Bytes,
    user_email: &str,
) -> Result<HecResponse> {
    if check_ingestion_allowed(org_id, StreamType::Logs, None)
        .await
        .is_err()
    {
        return Ok(HecStatus::InvalidIndex.into());
    }

    let cfg = get_config();
    let parsed = match parse_body(org_id, &body, &cfg.common.default_hec_stream).await {
        Ok(v) => v,
        Err(HecParseError::InvalidIndex) => return Ok(HecStatus::InvalidIndex.into()),
        Err(HecParseError::NoData) => return Ok(HecStatus::Success.into()),
        Err(e) => {
            log::info!("error in ingesting hec data for org {org_id}: {e:?}");
            return Ok(HecStatus::InvalidFormat.into());
        }
    };

    for (stream, entries) in parsed.streams {
        let in_req = IngestionRequest::JsonValues(IngestionValueType::Hec, entries);
        if let Err(e) = super::ingest::ingest(
            thread_id,
            org_id,
            &stream,
            in_req,
            IngestUser::from_user_email(user_email.to_string()),
            None,
            false,
        )
        .await
        {
            return Ok(HecStatus::Custom(e.to_string(), 400).into());
        }
    }

    Ok(HecStatus::Success.into())
}

/// Ingest an already-parsed HEC body, returning each stream's write outcome.
///
/// Every stream group is validated and every event prepared by [`parse_body`]
/// before the first write, so a client-side rejection commits nothing. A write
/// failure partway through can still leave earlier streams committed; the
/// storage layer offers no cross-stream transaction to prevent that.
pub async fn ingest_parsed(
    thread_id: usize,
    org_id: &str,
    parsed: HecParsed,
    user: IngestUser,
) -> Result<Vec<IngestionResponse>> {
    let mut responses = Vec::with_capacity(parsed.streams.len());
    for (stream, entries) in parsed.streams {
        let in_req = IngestionRequest::JsonValues(IngestionValueType::Hec, entries);
        let resp = super::ingest::ingest(
            thread_id,
            org_id,
            &stream,
            in_req,
            user.clone(),
            None,
            false,
        )
        .await?;
        responses.push(resp);
    }
    Ok(responses)
}

/// Parse a HEC body into per-stream record batches.
///
/// Streams are keyed by their RESOLVED name, so `App` and `app` form one group
/// rather than two writes racing for the same stream.
pub async fn parse_body(
    org_id: &str,
    body: &Bytes,
    default_stream: &str,
) -> std::result::Result<HecParsed, HecParseError> {
    let cfg = get_config();
    let entries = deserialize_entries(body)?;
    if entries.is_empty() {
        return Err(HecParseError::NoData);
    }

    let mut streams: HashMap<String, Vec<json::Value>> = HashMap::new();
    let mut resolved: HashMap<String, String> = HashMap::new();
    for entry in entries {
        let data = build_record(&entry, cfg.limit.req_cols_per_record_limit)?;
        let index = match entry.index.as_deref().map(str::trim) {
            Some(idx) if !idx.is_empty() => idx.to_string(),
            _ if !default_stream.is_empty() => default_stream.to_string(),
            _ => return Err(HecParseError::InvalidIndex),
        };
        let stream = match resolved.get(&index) {
            Some(name) => name.clone(),
            None => {
                let name = resolve_stream_name(org_id, &index).await?;
                resolved.insert(index, name.clone());
                name
            }
        };
        streams.entry(stream).or_default().push(data);
    }

    Ok(HecParsed { streams })
}

/// Deserialize a whole body as a stream of JSON values.
///
/// Real senders emit concatenated `{...}{...}`, pretty-printed multi-line JSON
/// and NDJSON interchangeably, so framing on physical lines rejects valid input.
fn deserialize_entries(body: &Bytes) -> std::result::Result<Vec<HecEntry>, HecParseError> {
    let mut entries = Vec::new();
    let de = serde_json::Deserializer::from_slice(body.as_ref());
    for value in de.into_iter::<HecEntry>() {
        match value {
            Ok(v) => entries.push(v),
            Err(e) if e.is_eof() && entries.is_empty() && body_is_blank(body) => break,
            Err(e) => return Err(HecParseError::InvalidFormat(e.to_string())),
        }
    }
    Ok(entries)
}

/// True when the body carries nothing but whitespace.
fn body_is_blank(body: &Bytes) -> bool {
    body.iter().all(|b| b.is_ascii_whitespace())
}

/// Build one output record from a HEC entry, applying HEC precedence.
///
/// Highest precedence first: envelope metadata (`_timestamp`, `host`, `source`,
/// `sourcetype`) > `event` body keys > `fields`. `fields` may only add keys.
fn build_record(
    entry: &HecEntry,
    col_limit: usize,
) -> std::result::Result<json::Value, HecParseError> {
    let event = entry.event.as_ref().ok_or(HecParseError::EventRequired)?;
    let mut data = match event {
        json::Value::String(s) if s.is_empty() => return Err(HecParseError::EventBlank),
        json::Value::String(s) => json::json!({ "log": s.to_owned() }),
        json::Value::Object(o) if o.is_empty() => return Err(HecParseError::EventBlank),
        json::Value::Object(_) => event.to_owned(),
        json::Value::Null => return Err(HecParseError::EventBlank),
        _ => {
            return Err(HecParseError::InvalidFormat(
                "event must be an object or a string".to_string(),
            ));
        }
    };

    if let Some(time) = &entry.time {
        data["_timestamp"] = parse_hec_time(time)?.into();
    }
    for (key, value) in [
        ("host", &entry.host),
        ("source", &entry.source),
        ("sourcetype", &entry.sourcetype),
    ] {
        if let Some(v) = value
            && !v.is_null()
        {
            data[key] = v.to_owned();
        }
    }

    if let Some(fields) = &entry.fields
        && let Some(o) = fields.as_object()
        && let Some(map) = data.as_object_mut()
    {
        for (f, v) in o {
            // `fields` is the lowest-precedence source; it may add keys but
            // never shadow the envelope or the event body.
            if !map.contains_key(f) && map.len() < col_limit {
                map.insert(f.clone(), v.to_owned());
            }
        }
    }

    Ok(data)
}

/// Convert a HEC `time` into epoch microseconds.
///
/// Splunk sends epoch SECONDS, as a number or a numeric string, with an optional
/// fraction; `<= 0` and absent both mean "stamp at receipt".
fn parse_hec_time(value: &json::Value) -> std::result::Result<i64, HecParseError> {
    let seconds = match value {
        json::Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| HecParseError::InvalidFormat("time is not a number".to_string()))?,
        json::Value::String(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| HecParseError::InvalidFormat(format!("time '{s}' is not a number")))?,
        _ => {
            return Err(HecParseError::InvalidFormat(
                "time must be a number or a numeric string".to_string(),
            ));
        }
    };
    if !seconds.is_finite() {
        return Err(HecParseError::InvalidFormat(
            "time is not finite".to_string(),
        ));
    }
    if seconds <= 0.0 {
        return Ok(chrono::Utc::now().timestamp_micros());
    }
    let micros = seconds * 1_000_000.0;
    if micros > i64::MAX as f64 {
        return Err(HecParseError::InvalidFormat(
            "time is out of range".to_string(),
        ));
    }
    Ok(micros.round() as i64)
}

/// Resolve an index to the stream name the writer will actually use.
///
/// Note the branch reads inverted against its own name: `skip_formatting_stream_name`
/// selects `get_formatted_stream_name`. This mirrors `logs::ingest::ingest` so the
/// grouping key matches what is written.
async fn resolve_stream_name(
    org_id: &str,
    index: &str,
) -> std::result::Result<String, HecParseError> {
    let cfg = get_config();
    let name = if cfg.common.skip_formatting_stream_name {
        get_formatted_stream_name(StreamParams::new(org_id, index, StreamType::Logs))
            .await
            .map_err(|e| HecParseError::InvalidFormat(e.to_string()))?
    } else {
        format_stream_name(index.to_string())
    };
    if name.is_empty() {
        return Err(HecParseError::InvalidIndex);
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(body: &str) -> HecEntry {
        json::from_str(body).unwrap()
    }

    #[test]
    fn test_time_integer_seconds_becomes_micros() {
        assert_eq!(
            parse_hec_time(&json::json!(1426279439)).unwrap(),
            1426279439000000
        );
    }

    #[test]
    fn test_time_fractional_seconds_keep_microseconds() {
        assert_eq!(
            parse_hec_time(&json::json!(1426279439.123)).unwrap(),
            1426279439123000
        );
    }

    #[test]
    fn test_time_numeric_string_is_accepted() {
        assert_eq!(
            parse_hec_time(&json::json!("1426279439.123")).unwrap(),
            1426279439123000
        );
    }

    #[test]
    fn test_time_non_numeric_string_is_rejected() {
        assert!(matches!(
            parse_hec_time(&json::json!("yesterday")),
            Err(HecParseError::InvalidFormat(_))
        ));
    }

    #[test]
    fn test_time_bool_is_rejected() {
        assert!(matches!(
            parse_hec_time(&json::json!(true)),
            Err(HecParseError::InvalidFormat(_))
        ));
    }

    #[test]
    fn test_time_zero_and_negative_use_receipt_time() {
        let before = chrono::Utc::now().timestamp_micros();
        let zero = parse_hec_time(&json::json!(0)).unwrap();
        let negative = parse_hec_time(&json::json!(-5)).unwrap();
        assert!(zero >= before);
        assert!(negative >= before);
    }

    #[test]
    fn test_time_overflow_is_rejected() {
        assert!(matches!(
            parse_hec_time(&json::json!(1e300)),
            Err(HecParseError::InvalidFormat(_))
        ));
    }

    #[test]
    fn test_missing_event_is_event_required() {
        let e = entry(r#"{"index":"app"}"#);
        assert_eq!(
            build_record(&e, 1000).unwrap_err(),
            HecParseError::EventRequired
        );
    }

    #[test]
    fn test_blank_event_is_event_blank() {
        assert_eq!(
            build_record(&entry(r#"{"event":""}"#), 1000).unwrap_err(),
            HecParseError::EventBlank
        );
        assert_eq!(
            build_record(&entry(r#"{"event":{}}"#), 1000).unwrap_err(),
            HecParseError::EventBlank
        );
    }

    #[test]
    fn test_string_event_becomes_log_field() {
        let data = build_record(&entry(r#"{"event":"hello"}"#), 1000).unwrap();
        assert_eq!(data["log"], json::json!("hello"));
    }

    #[test]
    fn test_fields_cannot_overwrite_event_body() {
        let data = build_record(
            &entry(r#"{"event":{"log":"real"},"fields":{"log":"spoofed"}}"#),
            1000,
        )
        .unwrap();
        assert_eq!(data["log"], json::json!("real"));
    }

    #[test]
    fn test_fields_cannot_overwrite_timestamp() {
        let data = build_record(
            &entry(r#"{"time":1426279439,"event":{"a":1},"fields":{"_timestamp":1}}"#),
            1000,
        )
        .unwrap();
        assert_eq!(data["_timestamp"], json::json!(1426279439000000i64));
    }

    #[test]
    fn test_fields_add_new_keys() {
        let data = build_record(&entry(r#"{"event":{"a":1},"fields":{"b":2}}"#), 1000).unwrap();
        assert_eq!(data["b"], json::json!(2));
    }

    #[test]
    fn test_fields_respect_column_limit() {
        let data = build_record(&entry(r#"{"event":{"a":1},"fields":{"b":2}}"#), 1).unwrap();
        assert!(data.get("b").is_none());
    }

    #[test]
    fn test_metadata_lands_as_columns() {
        let data = build_record(
            &entry(r#"{"event":{"a":1},"host":"h1","source":"s1","sourcetype":"st1"}"#),
            1000,
        )
        .unwrap();
        assert_eq!(data["host"], json::json!("h1"));
        assert_eq!(data["source"], json::json!("s1"));
        assert_eq!(data["sourcetype"], json::json!("st1"));
    }

    #[test]
    fn test_metadata_outranks_event_body() {
        let data = build_record(
            &entry(r#"{"event":{"host":"from-body"},"host":"from-envelope"}"#),
            1000,
        )
        .unwrap();
        assert_eq!(data["host"], json::json!("from-envelope"));
    }

    #[test]
    fn test_concatenated_json_is_framed() {
        let body = Bytes::from(r#"{"event":"a"}{"event":"b"}"#);
        assert_eq!(deserialize_entries(&body).unwrap().len(), 2);
    }

    #[test]
    fn test_pretty_printed_json_is_framed() {
        let body = Bytes::from("{\n  \"event\": \"a\"\n}\n{\n  \"event\": \"b\"\n}\n");
        assert_eq!(deserialize_entries(&body).unwrap().len(), 2);
    }

    #[test]
    fn test_ndjson_is_framed() {
        let body = Bytes::from("{\"event\":\"a\"}\n{\"event\":\"b\"}\n");
        assert_eq!(deserialize_entries(&body).unwrap().len(), 2);
    }

    #[test]
    fn test_empty_body_yields_no_entries() {
        assert!(deserialize_entries(&Bytes::from("")).unwrap().is_empty());
        assert!(
            deserialize_entries(&Bytes::from("  \n\t "))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_invalid_json_is_rejected() {
        assert!(matches!(
            deserialize_entries(&Bytes::from(r#"{"invalid": json}"#)),
            Err(HecParseError::InvalidFormat(_))
        ));
    }

    #[test]
    fn test_truncated_json_is_rejected_not_silently_dropped() {
        assert!(matches!(
            deserialize_entries(&Bytes::from(r#"{"event":"a""#)),
            Err(HecParseError::InvalidFormat(_))
        ));
    }

    #[tokio::test]
    async fn test_ingest_invalid_json() {
        // Test with invalid JSON data
        let invalid_data = r#"{"invalid": json}"#;
        let body = Bytes::from(invalid_data);
        let thread_id = 1;
        let org_id = "test-org";
        let user_email = "test@example.com";

        let result = ingest(thread_id, org_id, body, user_email).await;

        match result {
            Ok(response) => {
                // Should return InvalidFormat status for malformed JSON
                assert!(matches!(response.code, 400));
            }
            Err(e) => {
                // If it fails with an error, that's also acceptable
                assert!(!e.to_string().is_empty());
            }
        }
    }
}
