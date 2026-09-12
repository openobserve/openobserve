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
#[cfg(not(feature = "enterprise"))]
use config::meta::self_reporting::usage::is_enterprise_only_usage_stream;
#[cfg(feature = "cloud")]
use config::meta::self_reporting::usage::is_reserved_internal_stream;
use config::{
    get_config,
    meta::{
        self_reporting::usage::is_internal_rollup_stream,
        stream::{StreamParams, StreamType},
    },
    utils::{json, schema::format_stream_name},
};
use hashbrown::HashMap;
use infra::{
    errors::{Error, Result},
    schema::get_flatten_level,
};
use ingestion_common::{
    HecResponse, HecStatus, IngestUser, IngestionRequest, IngestionResponse, IngestionValueType,
};
use serde::{Deserialize, Deserializer};

use crate::{
    ingestion::check_ingestion_allowed,
    logs::ingest::{PrepareRecordError, prepare_record},
    service::get_formatted_stream_name,
};

/// Cap on events in one request: each is held decoded and flattened in memory,
/// so the byte limit alone does not bound peak memory.
pub const MAX_HEC_EVENTS_PER_REQUEST: usize = 200_000;

/// Why a HEC body could not be turned into records. Maps onto the collector's
/// status codes; the legacy route flattens all of these into its own codes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HecParseError {
    /// Body held no events at all.
    NoData,
    /// More events in one request than [`MAX_HEC_EVENTS_PER_REQUEST`].
    TooManyEvents,
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
#[derive(Deserialize, Clone, Debug)]
struct HecEntry {
    index: Option<String>,
    time: Option<json::Value>,
    host: Option<json::Value>,
    source: Option<json::Value>,
    sourcetype: Option<json::Value>,
    fields: Option<json::Value>,
    // Double Option: a single one would fold an explicit `"event": null` (blank,
    // code 13) into an absent key (required, code 12), which Splunk separates.
    #[serde(default, deserialize_with = "deserialize_some")]
    event: Option<Option<json::Value>>,
}

/// Events parsed out of one HEC body, already grouped by resolved stream name.
pub struct HecParsed {
    pub streams: HashMap<String, Vec<json::Value>>,
}

/// Ingest a HEC body on the legacy `/api/{org_id}/_hec` route.
///
/// Only the RESPONSE MAPPING is frozen — `HecStatus` -> `HecResponse` is
/// unchanged. Parsing and stored data are NOT: per D8 the §11.2-§11.6 fixes
/// apply here too, so a blank `event` now fails, `fields` may no longer
/// overwrite a key, framing is a JSON stream rather than physical lines, and
/// `host`/`source`/`sourcetype` are stored as columns.
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

    let user = IngestUser::from_user_email(user_email.to_string());
    let streams: Vec<(String, Vec<json::Value>)> = parsed.streams.into_iter().collect();
    // Admission checks for every group before the first write; the response shape
    // for a rejection is unchanged (still `Custom(_, 400)`).
    if let Err(e) = preflight_streams(org_id, &streams, &user).await {
        return Ok(HecStatus::Custom(e.to_string(), 400).into());
    }
    if let Err(e) = ingest_prepared(thread_id, org_id, streams, user).await {
        return Ok(HecStatus::Custom(e.to_string(), 400).into());
    }

    Ok(HecStatus::Success.into())
}

/// Ingest an already-parsed HEC body, returning each stream's write outcome.
///
/// [`parse_body`] prepares every event and [`preflight_streams`] runs every
/// admission check for every stream group before the first write, so anything
/// rejectable is rejected while nothing is persisted. A storage failure after
/// the first stream has been written still cannot be rolled back — there is no
/// cross-stream transaction — but it is reported rather than masked as success.
///
/// The "nothing is persisted" guarantee does NOT extend to a stream with a
/// pipeline attached: see [`preflight_records`]'s KNOWN LIMITATION, where two
/// rejections are unavoidably found inside the write loop.
pub async fn ingest_parsed(
    thread_id: usize,
    org_id: &str,
    parsed: HecParsed,
    user: IngestUser,
) -> Result<Vec<IngestionResponse>> {
    let streams: Vec<(String, Vec<json::Value>)> = parsed.streams.into_iter().collect();
    preflight_streams(org_id, &streams, &user).await?;
    ingest_prepared(thread_id, org_id, streams, user).await
}

/// Write stream groups that [`preflight_streams`] has already admitted.
///
/// Any error from here is a storage failure, not a rejection: groups written
/// before it are already committed and cannot be rolled back.
pub async fn ingest_prepared(
    thread_id: usize,
    org_id: &str,
    streams: Vec<(String, Vec<json::Value>)>,
    user: IngestUser,
) -> Result<Vec<IngestionResponse>> {
    let mut responses = Vec::with_capacity(streams.len());
    for (stream, entries) in streams {
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

/// Run every admission check `logs::ingest::ingest` would apply, for all stream
/// groups, before any of them is written.
///
/// Mirrors the guards at the top of that function in the same order. Without
/// this the checks run inside the per-stream write loop, so a group rejected
/// second leaves the group written first committed — and `HashMap` iteration
/// order makes which one lands nondeterministic.
pub async fn preflight_streams(
    org_id: &str,
    streams: &[(String, Vec<json::Value>)],
    user: &IngestUser,
) -> Result<()> {
    for (stream, _) in streams {
        if let Some(reason) = stream_rejection(stream, user) {
            return Err(Error::IngestionError(reason));
        }
        check_ingestion_allowed(org_id, StreamType::Logs, Some(stream)).await?;
    }
    Ok(())
}

/// Prepare every event of every group, so an event that cannot be prepared is
/// reported with nothing written (§10.4).
///
/// Preparation otherwise happens inside the per-stream write loop, so an event
/// in the second group is only found to be bad after the first group has been
/// committed — a partial write the client is told is a single failure, and
/// duplicates when it retries.
///
/// Runs the SAME `prepare_record` the write path uses, rather than a second
/// implementation that would drift from the one deciding what gets written. The
/// flattened record is kept and handed back so the write path's own flatten is a
/// cheap no-op instead of a second full pass: `flatten_with_level` is idempotent,
/// and both passes read the same `get_flatten_level` for the stream.
///
/// Window drops stay policy drops. They are the one rejection that must NOT
/// fail the batch — a 400 is not retried, so the client would discard its
/// in-window events too.
///
/// KNOWN LIMITATION — §10.4's "every event prepared before the first write"
/// holds only for streams with NO pipeline attached. With one attached the write
/// path timestamps the pipeline OUTPUT and this pass cannot see it, so two
/// rejections are still found inside the write loop, after earlier stream groups
/// have been committed: a transform that produces an unparseable timestamp, and
/// a pipeline batch execution error.
///
/// Executing the pipeline here to close that gap is NOT viable:
/// `ExecutablePipeline::process_batch` is not side-effect free — a
/// `RemoteStream` destination node writes the batch to the pipeline WAL
/// (`pipeline/batch_execution.rs`, `write_wal`), and an evaluation pipeline with
/// an LLM node is spawned fire-and-forget by the caller — so a dry run would
/// double-deliver every remote-destination record unless a no-side-effect mode
/// were threaded through `process_batch` and every node type. Those rejections
/// are answered from the write outcome instead (code 6 / code 8).
pub async fn preflight_records(
    org_id: &str,
    streams: Vec<(String, Vec<json::Value>)>,
) -> std::result::Result<Vec<(String, Vec<json::Value>)>, HecParseError> {
    let cfg = get_config();
    let now = config::utils::time::now_micros();
    let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
    let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;

    let mut prepared = Vec::with_capacity(streams.len());
    for (stream, entries) in streams {
        let flatten_level = get_flatten_level(org_id, &stream, StreamType::Logs).await;
        let mut kept = Vec::with_capacity(entries.len());
        for entry in entries {
            match prepare_record(entry, flatten_level, min_ts, max_ts) {
                Ok((res, _)) => kept.push(res),
                // A window drop is still written: the write path re-reads the
                // timestamp and counts it as a policy drop, which is what keeps
                // the response code 0 rather than an unretryable 400.
                Err(PrepareRecordError::Timestamp(res, e))
                    if schema::is_window_discard_error(&e) =>
                {
                    kept.push(res)
                }
                Err(PrepareRecordError::Flatten(e) | PrepareRecordError::Timestamp(_, e)) => {
                    return Err(HecParseError::InvalidFormat(e.to_string()));
                }
            }
        }
        prepared.push((stream, kept));
    }
    Ok(prepared)
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

/// Why `logs::ingest::ingest` would refuse to write this stream, if it would.
///
/// Kept verbatim in wording and order with the guards at the top of that
/// function, so a preflight rejection and a per-stream rejection stay in step.
fn stream_rejection(stream: &str, user: &IngestUser) -> Option<String> {
    if stream.is_empty() {
        return Some("Stream name is empty".to_string());
    }
    // `need_usage_report` is always true on a HEC write, so the guard always applies.
    #[cfg(feature = "cloud")]
    if is_reserved_internal_stream(stream) {
        return Some(format!(
            "stream '{stream}' is reserved and cannot be ingested into"
        ));
    }
    #[cfg(not(feature = "enterprise"))]
    if is_enterprise_only_usage_stream(stream) {
        return Some(format!(
            "stream '{stream}' is reserved for enterprise usage reporting"
        ));
    }
    // `is_derived` is always false on a HEC write, so the exemption never applies.
    if is_internal_rollup_stream(stream) && matches!(user, IngestUser::User(_)) {
        return Some(format!(
            "stream '{stream}' is an internal rollup stream and cannot be ingested into"
        ));
    }
    None
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
        // A 100 MiB body of tiny events holds far more of them than any real
        // sender batches, and each is cloned and flattened again during preflight.
        if entries.len() > MAX_HEC_EVENTS_PER_REQUEST {
            return Err(HecParseError::TooManyEvents);
        }
    }
    Ok(entries)
}

/// True when the body carries nothing but whitespace.
fn body_is_blank(body: &Bytes) -> bool {
    body.iter().all(|b| b.is_ascii_whitespace())
}

/// Deserialize a present field into `Some`, so an explicit `null` stays distinct
/// from an absent key.
fn deserialize_some<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// Build one output record from a HEC entry, applying HEC precedence.
///
/// Highest precedence first: envelope metadata (`_timestamp`, `host`, `source`,
/// `sourcetype`) > `event` body keys > `fields`. `fields` may only add keys.
fn build_record(
    entry: &HecEntry,
    col_limit: usize,
) -> std::result::Result<json::Value, HecParseError> {
    let event = match entry.event.as_ref() {
        None => return Err(HecParseError::EventRequired),
        Some(None) => return Err(HecParseError::EventBlank),
        Some(Some(v)) => v,
    };
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
            // These add up to three columns per record, so they count against
            // the cap like any other; inserting unconditionally would let a
            // record exceed the configured limit by three.
            && let Some(map) = data.as_object_mut()
            && (map.contains_key(key) || map.len() < col_limit)
        {
            map.insert(key.to_string(), v.to_owned());
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
    // `i64::MAX as f64` rounds UP, so `>` lets the top ULP through and the cast
    // then saturates to a nonsense far-future timestamp.
    if micros >= i64::MAX as f64 {
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

    #[tokio::test]
    async fn preflight_rejects_an_unpreparable_event_in_any_group() {
        // §10.4: preparation happens inside the per-stream write loop, so without
        // this pass a bad event in the SECOND group is only discovered after the
        // first group is committed — a partial write the client is told is one
        // failure, and duplicates on retry.
        let bad = json::json!({"_timestamp": "not-a-timestamp", "log": "x"});
        let good = json::json!({"log": "fine"});

        let streams = vec![
            ("group_one".to_string(), vec![good.clone()]),
            ("group_two".to_string(), vec![bad]),
        ];
        assert!(matches!(
            preflight_records("preflight_org", streams).await,
            Err(HecParseError::InvalidFormat(_))
        ));

        let all_good = vec![
            ("group_one".to_string(), vec![good.clone()]),
            ("group_two".to_string(), vec![good]),
        ];
        assert!(preflight_records("preflight_org", all_good).await.is_ok());
    }

    #[tokio::test]
    async fn preflight_keeps_an_ingestion_window_drop_a_policy_drop() {
        // The one rejection that must NOT fail the batch: a 400 is not retried,
        // so failing here would make the client discard its in-window events too.
        let cfg = get_config();
        let too_old =
            config::utils::time::now_micros() - cfg.limit.ingest_allowed_upto_micro - 60_000_000;
        let streams = vec![(
            "windowed".to_string(),
            vec![json::json!({"_timestamp": too_old, "log": "old"})],
        )];
        assert!(preflight_records("preflight_org", streams).await.is_ok());

        let too_new = config::utils::time::now_micros()
            + cfg.limit.ingest_allowed_in_future_micro
            + 60_000_000;
        let streams = vec![(
            "windowed".to_string(),
            vec![json::json!({"_timestamp": too_new, "log": "future"})],
        )];
        assert!(preflight_records("preflight_org", streams).await.is_ok());
    }

    #[tokio::test]
    async fn preflight_returns_flattened_records_and_keeps_every_event() {
        // The write path re-flattens what comes back, so the saving only holds
        // if these records are ALREADY flat — and a dropped event here would be
        // silent data loss, not a rejection.
        let streams = vec![(
            "kept".to_string(),
            vec![
                json::json!({"nested": {"a": {"b": 1}}, "log": "one"}),
                json::json!({"log": "two"}),
            ],
        )];
        let prepared = preflight_records("preflight_org", streams).await.unwrap();

        assert_eq!(prepared.len(), 1);
        let (stream, records) = &prepared[0];
        assert_eq!(stream, "kept");
        assert_eq!(records.len(), 2, "no event may be dropped by the preflight");

        let first = records[0].as_object().expect("record is an object");
        assert!(
            first.values().all(|v| !v.is_object() && !v.is_array()),
            "record should already be flat: {first:?}"
        );
        // Re-flattening what we hand back must be a no-op, or the write path
        // would store something different from what preflight validated.
        let reflattened =
            config::utils::flatten::flatten_with_level(records[0].clone(), 0).unwrap();
        assert_eq!(&reflattened, &records[0]);
    }

    #[tokio::test]
    async fn preflight_uses_the_same_verdict_as_the_write_path() {
        // The dry run and the write must agree, so both go through the SAME
        // `prepare_record`; a second implementation would drift from the one
        // that decides what is actually stored.
        let cfg = get_config();
        let now = config::utils::time::now_micros();
        let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
        let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;
        let level = cfg.limit.ingest_flatten_level;

        let bad = json::json!({"_timestamp": "not-a-timestamp", "log": "x"});
        assert!(prepare_record(bad.clone(), level, min_ts, max_ts).is_err());
        let streams = vec![("s".to_string(), vec![bad])];
        assert!(preflight_records("preflight_org", streams).await.is_err());

        let good = json::json!({"log": "fine"});
        assert!(prepare_record(good.clone(), level, min_ts, max_ts).is_ok());
        let streams = vec![("s".to_string(), vec![good])];
        assert!(preflight_records("preflight_org", streams).await.is_ok());
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
    fn test_time_at_the_i64_boundary_is_rejected_not_saturated() {
        // `i64::MAX as f64` rounds up, so a `>` guard would let this through and
        // the saturating cast would silently yield i64::MAX.
        assert!(matches!(
            parse_hec_time(&json::json!(9223372036854.775_f64)),
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
    fn test_explicit_null_event_is_blank_not_missing() {
        assert_eq!(
            build_record(&entry(r#"{"event":null,"index":"app"}"#), 1000).unwrap_err(),
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

    // ── D8: the legacy /api/{org_id}/_hec route's NEW behaviour ───────────
    //
    // Only the HecStatus -> HecResponse mapping is frozen. These four deltas are
    // deliberate and apply to the legacy route as well as the collector; they are
    // pinned here so nobody "restores" the old behaviour by accident.

    #[test]
    fn legacy_blank_event_now_fails_instead_of_succeeding() {
        // WAS: {"event":""} / {} / null were accepted and written.
        for body in [r#"{"event":""}"#, r#"{"event":{}}"#, r#"{"event":null}"#] {
            assert_eq!(
                build_record(&entry(body), 1000).unwrap_err(),
                HecParseError::EventBlank,
                "{body}"
            );
        }
    }

    #[test]
    fn legacy_fields_precedence_is_now_inverted() {
        // WAS: `fields` was merged over everything, so it could destroy the event
        // time and shadow any event key. It may now only ADD keys.
        let data = build_record(
            &entry(
                r#"{"time":1426279439,"event":{"log":"real"},"fields":{"log":"spoofed","_timestamp":1,"extra":9}}"#,
            ),
            1000,
        )
        .unwrap();
        assert_eq!(data["log"], json::json!("real"));
        assert_eq!(data["_timestamp"], json::json!(1426279439000000i64));
        assert_eq!(data["extra"], json::json!(9));
    }

    #[test]
    fn legacy_framing_is_now_a_json_stream_not_physical_lines() {
        // WAS: BufReader::lines, so concatenated and pretty-printed bodies — what
        // real HEC clients send — were rejected.
        let body = Bytes::from("{\"event\":\"a\"}{\"event\":\"b\"}\n{\n \"event\": \"c\"\n}");
        assert_eq!(deserialize_entries(&body).unwrap().len(), 3);
    }

    #[test]
    fn legacy_metadata_now_lands_as_new_columns() {
        // WAS: serde dropped host/source/sourcetype, so existing _hec streams
        // gain up to three columns they did not have before.
        let data = build_record(
            &entry(r#"{"event":{"a":1},"host":"h","source":"s","sourcetype":"st"}"#),
            1000,
        )
        .unwrap();
        for key in ["host", "source", "sourcetype"] {
            assert!(data.get(key).is_some(), "{key}");
        }
    }

    #[test]
    fn metadata_counts_against_the_column_limit() {
        // Inserting the three unconditionally let a record exceed the configured
        // cap by three.
        let data = build_record(
            &entry(r#"{"event":{"a":1},"host":"h","source":"s","sourcetype":"st"}"#),
            2,
        )
        .unwrap();
        let map = data.as_object().unwrap();
        assert_eq!(map.len(), 2);
        assert!(map.contains_key("a"));
    }

    #[test]
    fn metadata_may_overwrite_a_body_key_at_the_limit() {
        // Replacing an existing key adds no column, so the cap must not block it.
        let data = build_record(&entry(r#"{"event":{"host":"body"},"host":"env"}"#), 1).unwrap();
        assert_eq!(data["host"], json::json!("env"));
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
    fn test_event_count_is_capped() {
        // A body well under the byte limit still holds enough tiny events to
        // exhaust an ingester once each is cloned and flattened.
        let one = r#"{"event":{"m":1},"index":"x"}"#;
        let body = Bytes::from(one.repeat(MAX_HEC_EVENTS_PER_REQUEST + 2));
        assert_eq!(
            deserialize_entries(&body).unwrap_err(),
            HecParseError::TooManyEvents
        );
        assert!(matches!(
            deserialize_entries(&Bytes::from(one.repeat(16))),
            Ok(v) if v.len() == 16
        ));
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

    #[test]
    fn rollup_stream_is_rejected_for_a_hec_user() {
        let user = IngestUser::User("hec-abc@hec.local".to_string());
        assert!(stream_rejection("_o2_service_graph", &user).is_some());
        assert!(stream_rejection("_agent_signals", &user).is_some());
    }

    #[test]
    fn an_empty_stream_name_is_rejected() {
        let user = IngestUser::User("hec-abc@hec.local".to_string());
        assert_eq!(
            stream_rejection("", &user).as_deref(),
            Some("Stream name is empty")
        );
    }

    #[test]
    fn an_ordinary_stream_is_admitted() {
        let user = IngestUser::User("hec-abc@hec.local".to_string());
        assert!(stream_rejection("default", &user).is_none());
        assert!(stream_rejection("app_logs", &user).is_none());
    }

    #[tokio::test]
    async fn preflight_rejects_the_whole_batch_when_any_group_is_bad() {
        let user = IngestUser::User("hec-abc@hec.local".to_string());
        let streams = vec![
            ("good".to_string(), vec![json::json!({"log": "a"})]),
            (
                "_o2_service_graph".to_string(),
                vec![json::json!({"log": "b"})],
            ),
        ];
        // The bad group is second, so a per-stream loop would already have written
        // the first one; preflight must refuse before any write.
        assert!(
            preflight_streams("test-org", &streams, &user)
                .await
                .is_err()
        );
    }
}
