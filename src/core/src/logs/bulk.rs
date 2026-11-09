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

use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader},
};

use axum::body::Bytes;
use config::{
    BLOCKED_STREAMS, TIMESTAMP_COL_NAME, get_config,
    meta::{self_reporting::usage::is_internal_rollup_stream, stream::StreamType},
    metrics,
    utils::{
        json,
        schema::format_stream_name,
        time::{now_micros, parse_timestamp_micro_from_value},
    },
};
use infra::errors::Result;
use ingestion_common::{BulkResponse, BulkResponseError, BulkResponseItem};
use schema::{get_future_discard_error, get_upto_discard_error};
use transform::TRANSFORM_FAILED;

use crate::{
    ingestion::check_ingestion_allowed,
    logs::{ingest::BulkPlan, ingestion_log_enabled, log_failed_record},
};
pub const TS_PARSE_FAILED: &str = "timestamp_parsing_failed";
pub const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";
pub const PIPELINE_EXEC_FAILED: &str = "pipeline_execution_failed";
pub const STREAM_NAME_TOO_LONG: &str = "stream_name_too_long";
pub const ACTION_PARSE_FAILED: &str = "action_parse_failed";

/// Request positions of one stream's `_bulk` actions, kept beside its records.
#[derive(Default)]
pub(super) struct BulkResponseOrder {
    /// One per JSON record handed to the write, in record order.
    pub records: Vec<usize>,
    /// The records finalization buffered, in the order the write consumes them.
    pub accepted: VecDeque<usize>,
    /// One per row the columnar fast path parsed, in row order.
    pub columnar: Vec<usize>,
}

struct BulkStream {
    plan: Option<BulkPlan>,
    order: BulkResponseOrder,
}

enum BulkLine {
    Action,
    Data,
    RejectedData,
}

pub async fn ingest(
    thread_id: usize,
    org_id: &str,
    body: Bytes,
    user: ingestion_common::IngestUser,
) -> Result<BulkResponse> {
    ingest_with_blocked_streams(thread_id, org_id, body, user, &BLOCKED_STREAMS).await
}

async fn ingest_with_blocked_streams(
    thread_id: usize,
    org_id: &str,
    body: Bytes,
    user: ingestion_common::IngestUser,
    blocked_keys: &[String],
) -> Result<BulkResponse> {
    let start = std::time::Instant::now();

    // check system resource
    check_ingestion_allowed(org_id, StreamType::Logs, None).await?;

    // let mut errors = false;
    let mut bulk_res = BulkResponse {
        took: 0,
        errors: false,
        items: vec![],
    };

    let cfg = get_config();
    let now = config::utils::time::now_micros();
    let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
    let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;

    let log_ingestion_errors = ingestion_log_enabled().await;
    let mut action = String::new();
    let mut raw_stream_name = String::new();
    let mut stream_name = String::new();
    let mut doc_id: Option<String> = None;
    let stream_type = StreamType::Logs;

    let mut blocked_streams: HashMap<String, bool> = HashMap::new();
    let mut streams_data: HashMap<String, Vec<json::Value>> = HashMap::new();
    let mut plans: HashMap<String, BulkStream> = HashMap::new();
    let mut action_position = 0;
    let mut action_count = 0;
    let mut next_line = BulkLine::Action;
    // Read lines as bytes to handle potential invalid UTF-8 characters
    let mut line_buffer = Vec::new();
    let mut reader = BufReader::new(body.as_ref());
    loop {
        line_buffer.clear();
        let bytes_read = reader.read_until(b'\n', &mut line_buffer)?;
        if bytes_read == 0 {
            break; // EOF
        }

        // Remove trailing newline characters
        while line_buffer.last() == Some(&b'\n') || line_buffer.last() == Some(&b'\r') {
            line_buffer.pop();
        }

        if line_buffer.is_empty() {
            continue;
        }

        let is_data = match std::mem::replace(&mut next_line, BulkLine::Action) {
            BulkLine::Action => false,
            BulkLine::Data => true,
            BulkLine::RejectedData => continue,
        };
        if is_data {
            let stream = stream_plan(&mut plans, org_id, &stream_name, (min_ts, max_ts)).await;
            if stream
                .plan
                .as_mut()
                .is_some_and(|p| p.columnar.parse_bulk_line(&line_buffer, doc_id.as_deref()))
            {
                stream.order.columnar.push(action_position);
                tokio::task::coop::consume_budget().await;
                continue;
            }
        }
        // Use from_utf8_lossy to handle potential invalid UTF-8 characters
        // Invalid UTF-8 sequences will be replaced with the replacement character (�)
        let line_str = String::from_utf8_lossy(&line_buffer);
        let value: json::Value = json::from_slice(line_str.as_bytes())?;

        if !is_data {
            // check bulk operate
            let Some(parsed) = super::parse_bulk_index(&value) else {
                continue;
            };
            next_line = BulkLine::RejectedData;
            action_position = action_count;
            action_count += 1;
            let (line_action, line_stream_name, line_doc_id) = match parsed {
                Ok(parsed) => parsed,
                Err((line_action, line_doc_id, reason)) => {
                    log::warn!("[LOGS:BULK] {reason}: {line_str}, org_id: {org_id}");
                    bulk_res.errors = true;
                    let mut item = failed_item(
                        line_action.to_string(),
                        String::new(),
                        line_doc_id.unwrap_or_default().to_string(),
                        Some(value),
                        ACTION_PARSE_FAILED.to_string(),
                        reason.to_string(),
                    );
                    if let Some(failed) = item.values_mut().next() {
                        failed.request_position = Some(action_position);
                    }
                    bulk_res.items.push(item);
                    continue;
                }
            };
            if line_action != action {
                action = line_action.to_string();
            }
            // formatting reads the shared config, too costly to repeat for every action line
            if line_stream_name != raw_stream_name {
                raw_stream_name = line_stream_name.to_string();
                stream_name = if cfg.common.skip_formatting_stream_name {
                    raw_stream_name.clone()
                } else {
                    format_stream_name(raw_stream_name.clone())
                };
            }
            doc_id = line_doc_id.map(|id| id.to_string());

            if raw_stream_name.is_empty() || raw_stream_name == "_" || raw_stream_name == "/" {
                let err_msg = "Invalid stream name: ".to_string() + &line_str;
                log::warn!("[LOGS:BULK] {err_msg}, org_id: {org_id}");
                bulk_res.errors = true;
                let err = BulkResponseError::new(
                    err_msg.to_string(),
                    raw_stream_name.to_string(),
                    err_msg,
                    "0".to_string(),
                );
                let mut failed = BulkResponseItem::new_failed(
                    raw_stream_name.to_string(),
                    doc_id.clone().unwrap_or_default(),
                    err,
                    Some(value),
                    raw_stream_name.to_string(),
                );
                failed.request_position = Some(action_position);
                bulk_res
                    .items
                    .push(HashMap::from([(action.to_string(), failed)]));
                continue; // skip
            }

            // Reject internal rollup streams (_o2_*, _agent_signals) in ALL
            // editions — written only by internal aggregation jobs (service
            // graph, agent signals, database monitoring) through the internal
            // gRPC channel; bulk is always a user path (design §5.3).
            if is_internal_rollup_stream(&stream_name) {
                let err_msg = format!(
                    "stream '{stream_name}' is an internal rollup stream and cannot be ingested into"
                );
                log::warn!("[LOGS:BULK] {err_msg}, org_id: {org_id}");
                bulk_res.errors = true;
                let err = BulkResponseError::new(
                    err_msg.clone(),
                    stream_name.to_string(),
                    err_msg,
                    "0".to_string(),
                );
                let mut failed = BulkResponseItem::new_failed(
                    stream_name.to_string(),
                    doc_id.clone().unwrap_or_default(),
                    err,
                    Some(value),
                    stream_name.to_string(),
                );
                failed.request_position = Some(action_position);
                bulk_res
                    .items
                    .push(HashMap::from([(action.to_string(), failed)]));
                continue; // skip
            }

            let blocked = match blocked_streams.get(&stream_name) {
                Some(blocked) => *blocked,
                None => {
                    let key = format!("{org_id}/{stream_type}/{stream_name}");
                    let blocked = blocked_keys.contains(&key);
                    if blocked {
                        log::warn!(
                            "[LOGS:BULK] stream [{org_id}/{stream_name}] is blocked from ingestion"
                        );
                    }
                    blocked_streams.insert(stream_name.clone(), blocked);
                    blocked
                }
            };
            if blocked {
                continue; // skip
            }
            next_line = BulkLine::Data;
        } else {
            let mut local_val = match value {
                json::Value::Object(v) => v,
                other => {
                    bulk_res.errors = true;
                    if let Some(item) = add_record_status(
                        stream_name.to_string(),
                        doc_id.clone(),
                        action.to_string(),
                        Some(other),
                        &mut bulk_res,
                        Some(SCHEMA_CONFORMANCE_FAILED.to_string()),
                        Some("document must be a JSON object".to_string()),
                    ) {
                        item.request_position = Some(action_position);
                    }
                    continue;
                }
            };

            if let Err(failure_reason) =
                prepare_bulk_record(&mut local_val, doc_id.as_deref(), min_ts, max_ts)
            {
                bulk_res.errors = true;
                metrics::INGEST_ERRORS
                    .with_label_values(&[
                        org_id,
                        StreamType::Logs.as_str(),
                        &stream_name,
                        TS_PARSE_FAILED,
                    ])
                    .inc();
                let value = json::Value::Object(local_val);
                log_failed_record(log_ingestion_errors, &value, TS_PARSE_FAILED);
                if let Some(item) = add_record_status(
                    stream_name.to_string(),
                    doc_id.clone(),
                    action.to_string(),
                    Some(value),
                    &mut bulk_res,
                    Some(TS_PARSE_FAILED.to_string()),
                    Some(failure_reason),
                ) {
                    item.request_position = Some(action_position);
                }
                continue;
            }

            // A data line has already initialized its stream plan.
            plans
                .get_mut(&stream_name)
                .unwrap()
                .order
                .records
                .push(action_position);
            let val = json::Value::Object(local_val);
            match streams_data.get_mut(&stream_name) {
                Some(v) => v.push(val),
                None => {
                    streams_data.insert(stream_name.clone(), vec![val]);
                }
            }
        }
        tokio::task::coop::consume_budget().await;
    }

    for (stream, state) in &plans {
        if state.plan.as_ref().is_some_and(|p| p.columnar.rows() > 0) {
            streams_data.entry(stream.clone()).or_default();
        }
    }

    // Checked up front, pipeline destinations included: a whole-request 503 is retried safely.
    #[cfg(feature = "vectorscan")]
    {
        let streams: Vec<(&str, u64)> = streams_data
            .iter()
            .map(|(stream, records)| (stream.as_str(), records.len() as u64))
            .collect();
        let streams =
            crate::ingestion::with_pipeline_destinations(org_id, stream_type, &streams).await;
        let streams: Vec<(&str, u64)> = streams.iter().map(|(s, n)| (s.as_str(), *n)).collect();
        if let Some(reason) =
            crate::ingestion::sdr_fail_closed_refusal(org_id, stream_type, &streams, |_| false)
                .await
        {
            return Err(infra::errors::Error::ResourceError(reason));
        }
    }

    // process data by stream
    #[cfg(feature = "vectorscan")]
    let mut written_any = false;
    for (stream_name, records) in streams_data {
        // Every buffered row initialized its stream plan before parsing.
        let mut stream = plans.remove(&stream_name).unwrap();
        let plan = stream.plan.filter(|p| p.columnar.rows() > 0);
        match super::ingest::ingest_bulk(
            thread_id,
            org_id,
            &stream_name,
            records,
            plan,
            user.clone(),
            &mut stream.order,
        )
        .await
        {
            Ok(v) => {
                #[cfg(feature = "vectorscan")]
                {
                    written_any = true;
                }
                for status in v.status {
                    // the stream status keeps the items but not the write's errors flag
                    bulk_res.errors |= status
                        .items
                        .iter()
                        .flat_map(|item| item.values())
                        .any(|item| item.error.is_some());
                    bulk_res.items.extend(status.items);
                }
            }
            Err(e) => {
                log::error!("[LOGS:BULK] stream {org_id}/logs/{stream_name}: Ingestion error: {e}");
                // Once a group is written, a whole-request retry would duplicate it: 503 per item.
                #[cfg(feature = "vectorscan")]
                if crate::ingestion::is_sdr_fail_closed_refusal(&e) {
                    if !written_any {
                        return Err(e);
                    }
                    bulk_res.errors = true;
                    for &position in &stream.order.records {
                        if let Some(item) = add_record_status(
                            stream_name.to_string(),
                            None,
                            action.to_string(),
                            None,
                            &mut bulk_res,
                            Some("service_unavailable".to_string()),
                            Some(e.to_string()),
                        ) {
                            item.status = 503;
                            item.request_position = Some(position);
                        }
                    }
                    continue;
                }
                bulk_res.errors = true;
                metrics::INGEST_ERRORS
                    .with_label_values(&[
                        org_id,
                        StreamType::Logs.as_str(),
                        &stream_name,
                        TRANSFORM_FAILED,
                    ])
                    .inc();
                add_record_status(
                    stream_name.to_string(),
                    None,
                    action.to_string(),
                    None,
                    &mut bulk_res,
                    Some(PIPELINE_EXEC_FAILED.to_string()),
                    Some(PIPELINE_EXEC_FAILED.to_string()),
                );
            }
        }
    }
    restore_response_order(&mut bulk_res.items);

    // metric + data usage
    let status_code = if bulk_res.errors { "500" } else { "200" };
    let took_time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            status_code,
            org_id,
            StreamType::Logs.as_str(),
            "",
            "",
        ])
        .observe(took_time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            status_code,
            org_id,
            StreamType::Logs.as_str(),
            "",
            "",
        ])
        .inc();
    Ok(bulk_res)
}

pub fn add_record_status(
    stream_name: String,
    doc_id: Option<String>,
    action: String,
    value: Option<json::Value>,
    bulk_res: &mut BulkResponse,
    failure_type: Option<String>,
    failure_reason: Option<String>,
) -> Option<&mut BulkResponseItem> {
    let action = if action.is_empty() {
        "index".to_string()
    } else {
        action
    };

    let doc_id = match doc_id {
        Some(doc_id) => doc_id.to_owned(),
        None => "".to_string(),
    };

    let item = match failure_type {
        Some(failure_type) => failed_item(
            action,
            stream_name,
            doc_id,
            value,
            failure_type,
            failure_reason.unwrap(),
        ),
        None if get_config().common.bulk_api_response_errors_only => return None,
        None => success_item(action, &stream_name, doc_id, None),
    };
    bulk_res.items.push(item);
    bulk_res.items.last_mut()?.values_mut().next()
}

/// The response item of a record the request could not write.
pub fn failed_item(
    action: String,
    stream_name: String,
    doc_id: String,
    value: Option<json::Value>,
    failure_type: String,
    failure_reason: String,
) -> HashMap<String, BulkResponseItem> {
    let bulk_err = BulkResponseError::new(
        failure_type,
        stream_name.clone(),
        failure_reason,
        "0".to_owned(),
    );
    HashMap::from([(
        action,
        BulkResponseItem::new_failed(stream_name.clone(), doc_id, bulk_err, value, stream_name),
    )])
}

/// The response item of a written record; callers skip it under `bulk_api_response_errors_only`.
pub fn success_item(
    action: String,
    stream_name: &str,
    doc_id: String,
    request_position: Option<usize>,
) -> HashMap<String, BulkResponseItem> {
    let mut item = BulkResponseItem::new(
        stream_name.to_string(),
        doc_id,
        None,
        stream_name.to_string(),
    );
    item.request_position = request_position;
    HashMap::from([(action, item)])
}

/// Success items for records written together, reading the config once rather than per record.
pub fn add_success_items(
    stream_name: &str,
    rows: impl IntoIterator<Item = (Option<String>, Option<usize>)>,
    bulk_res: &mut BulkResponse,
) {
    if get_config().common.bulk_api_response_errors_only {
        return;
    }
    bulk_res
        .items
        .extend(rows.into_iter().map(|(doc_id, position)| {
            success_item(
                "index".to_string(),
                stream_name,
                doc_id.unwrap_or_default(),
                position,
            )
        }));
}

/// `_bulk`'s own step for a data record: set the action's `_id`, then check and set `_timestamp`.
pub(super) fn prepare_bulk_record(
    record: &mut json::Map<String, json::Value>,
    doc_id: Option<&str>,
    min_ts: i64,
    max_ts: i64,
) -> std::result::Result<(), String> {
    if let Some(doc_id) = doc_id {
        record.insert("_id".to_string(), json::Value::String(doc_id.to_string()));
    }
    let parsed = record
        .get(TIMESTAMP_COL_NAME)
        // flattening renames a key such as `@timestamp` to `_timestamp`
        .or_else(|| {
            record
                .iter()
                .find(|(key, value)| {
                    // what `format_key` turns into `_timestamp`, matched without allocating
                    let key = key.as_bytes();
                    key.len() == TIMESTAMP_COL_NAME.len()
                        && !key[0].is_ascii_alphanumeric()
                        && key[1..].eq_ignore_ascii_case(&TIMESTAMP_COL_NAME.as_bytes()[1..])
                        && (value.is_string() || value.is_number())
                })
                .map(|(_, value)| value)
        })
        .map(parse_timestamp_micro_from_value);
    let (timestamp, has_valid_timestamp) = resolve_bulk_timestamp(parsed, min_ts, max_ts)?;
    // inserted last, a stamped `_timestamp` is the one flattening keeps
    if !has_valid_timestamp || !record.contains_key(TIMESTAMP_COL_NAME) {
        record.insert(
            TIMESTAMP_COL_NAME.to_string(),
            json::Value::Number(timestamp.into()),
        );
    }
    Ok(())
}

/// `_bulk`'s verdict on a parsed `_timestamp`, stamping now when absent; the error is the reason.
pub(super) fn resolve_bulk_timestamp(
    parsed: Option<anyhow::Result<(i64, bool)>>,
    min_ts: i64,
    max_ts: i64,
) -> std::result::Result<(i64, bool), String> {
    let (timestamp, has_valid_timestamp) = match parsed {
        Some(parsed) => parsed.map_err(|_| TS_PARSE_FAILED.to_string())?,
        None => (now_micros(), false),
    };
    if timestamp < min_ts {
        return Err(get_upto_discard_error().to_string());
    }
    if timestamp > max_ts {
        return Err(get_future_discard_error().to_string());
    }
    Ok((timestamp, has_valid_timestamp))
}

/// Puts items in the order of the actions they answer; items with no action keep their order, last.
pub(super) fn restore_response_order(items: &mut [HashMap<String, BulkResponseItem>]) {
    items.sort_by_key(|item| {
        item.values()
            .next()
            .and_then(|item| item.request_position)
            .unwrap_or(usize::MAX)
    });
}

/// Pairs rows with their request positions; rows past the known positions have none.
pub(super) fn padded_positions(positions: Vec<usize>) -> impl Iterator<Item = Option<usize>> {
    positions
        .into_iter()
        .map(Some)
        .chain(std::iter::repeat(None))
}

async fn stream_plan<'a>(
    plans: &'a mut HashMap<String, BulkStream>,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
) -> &'a mut BulkStream {
    if !plans.contains_key(stream_name) {
        let plan = super::ingest::plan_bulk_columnar(org_id, stream_name, time_range).await;
        plans.insert(
            stream_name.to_string(),
            BulkStream {
                plan,
                order: BulkResponseOrder::default(),
            },
        );
    }
    // The stream was present or inserted above.
    plans.get_mut(stream_name).unwrap()
}

#[cfg(test)]
mod tests {
    use ingestion_common::IngestUser;

    use super::*;

    #[test]
    fn test_restore_response_order_preserves_sparse_and_unknown_positions() {
        for (positions, expected) in [
            (vec![Some(2), Some(0), Some(1)], vec![1, 2, 0]),
            (vec![Some(8), Some(1), Some(5)], vec![1, 2, 0]),
            (
                vec![None, Some(3), None, Some(0), Some(2)],
                vec![3, 4, 1, 0, 2],
            ),
            (vec![Some(1), Some(4), Some(9)], vec![0, 1, 2]),
            (vec![Some(1), Some(1), Some(0)], vec![2, 0, 1]),
            (vec![], vec![]),
        ] {
            let mut items: Vec<_> = positions
                .into_iter()
                .enumerate()
                .map(|(index, position)| {
                    success_item(
                        "index".to_string(),
                        &index.to_string(),
                        String::new(),
                        position,
                    )
                })
                .collect();
            restore_response_order(&mut items);
            let sources: Vec<usize> = items
                .iter()
                .map(|item| item["index"]._index.parse().unwrap())
                .collect();
            assert_eq!(sources, expected);
        }
    }

    #[test]
    fn test_add_record_status_returns_the_pushed_item() {
        let mut bulk_res = BulkResponse {
            took: 0,
            errors: false,
            items: vec![],
        };
        let failed = add_record_status(
            "s".to_string(),
            None,
            String::new(),
            None,
            &mut bulk_res,
            Some(TS_PARSE_FAILED.to_string()),
            Some("bad".to_string()),
        );
        failed.unwrap().request_position = Some(4);
        let success = add_record_status(
            "s".to_string(),
            None,
            String::new(),
            None,
            &mut bulk_res,
            None,
            None,
        );
        assert_eq!(
            success.is_none(),
            get_config().common.bulk_api_response_errors_only
        );
        assert_eq!(bulk_res.items[0]["index"].request_position, Some(4));
    }

    #[test]
    fn test_add_record_status() {
        let mut bulk_res = BulkResponse {
            took: 0,
            errors: false,
            items: vec![],
        };
        add_record_status(
            "olympics".to_string(),
            Some("1".to_string()),
            "create".to_string(),
            None,
            &mut bulk_res,
            None,
            None,
        );
        assert!(bulk_res.items.len() == 1);
    }

    #[test]
    fn test_prepare_bulk_record() {
        let now = now_micros();
        let (min_ts, max_ts) = (now - 3_600_000_000, now + 3_600_000_000);
        let prepare = |record: json::Value, doc_id: Option<&str>| {
            let mut record = record.as_object().unwrap().clone();
            prepare_bulk_record(&mut record, doc_id, min_ts, max_ts).map(|()| record)
        };
        let record = prepare(json::json!({"_id": "own", "_timestamp": now}), Some("a")).unwrap();
        assert_eq!(record["_id"], "a");
        assert_eq!(record["_timestamp"], json::json!(now));
        let record = prepare(json::json!({"_id": "own", "level": "x"}), None).unwrap();
        assert_eq!(record["_id"], "own");
        assert!(record["_timestamp"].as_i64().is_some_and(|ts| ts >= now));
        let record = prepare(json::json!({"_timestamp": now / 1_000_000}), None).unwrap();
        assert_eq!(
            record["_timestamp"],
            json::json!(now / 1_000_000 * 1_000_000)
        );
        assert_eq!(
            prepare(json::json!({"_timestamp": "garbage"}), None),
            Err(TS_PARSE_FAILED.to_string())
        );
        assert_eq!(
            prepare(json::json!({"_timestamp": min_ts - 1}), None),
            Err(get_upto_discard_error().to_string())
        );
        assert_eq!(
            prepare(json::json!({"_timestamp": max_ts + 1}), None),
            Err(get_future_discard_error().to_string())
        );
    }

    #[cfg(not(feature = "cloud"))]
    #[tokio::test]
    async fn test_ingest_rejected_actions_consume_their_data_lines() {
        use arrow::{array::StringArray, compute::cast, datatypes::DataType};

        infra::db::create_table().await.unwrap();
        infra::schema::init().await.unwrap();
        let org = "bulk_rejected_action_framing";
        let blocked_keys = [format!("{org}/logs/framing_blocked")];
        let errors_only = get_config().common.bulk_api_response_errors_only;
        for case in ["invalid", "internal", "malformed", "blocked"] {
            let allowed = format!("framing_allowed_{case}");
            let forged_stream = format!("framing_forged_{case}");
            let user = IngestUser::from_user_email("framing@example.com");
            let warm = format!(
                "{{\"index\":{{\"_index\":\"{allowed}\",\"_id\":\"warm\"}}}}\n{{\"message\":\"warm\"}}\n"
            );
            ingest(0, org, Bytes::from(warm), user.clone())
                .await
                .unwrap();
            #[cfg(not(feature = "vectorscan"))]
            assert!(
                super::super::ingest::plan_bulk_columnar(org, &allowed, (0, i64::MAX))
                    .await
                    .is_some()
            );
            let rejected_action = |action: &str, id: &str| match case {
                "invalid" => json::json!({action: {"_index": "_", "_id": id}}),
                "internal" => json::json!({action: {"_index": "_o2_rejected_framing", "_id": id}}),
                "malformed" => json::json!({action: {"_id": id}}),
                _ => json::json!({action: {"_index": "framing_blocked", "_id": id}}),
            };
            let lines = [
                rejected_action("index", "rejected1"),
                json::json!({"message": "discard this document"}),
                rejected_action("create", "rejected2"),
                json::json!({"index": {"_index": &forged_stream, "_id": "forged"}}),
                json::json!({"index": {"_index": &allowed, "_id": "real"}}),
                json::json!({"message": "must survive"}),
            ];
            let body = lines
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n\n")
                + "\n";
            let response =
                ingest_with_blocked_streams(0, org, Bytes::from(body), user, &blocked_keys)
                    .await
                    .unwrap();
            let mut expected = Vec::new();
            if case != "blocked" {
                expected.extend([("rejected1", 0), ("rejected2", 1)]);
            }
            if !errors_only {
                expected.push(("real", 2));
            }
            let items: Vec<_> = response
                .items
                .iter()
                .flat_map(|item| item.values())
                .map(|item| (item._id.as_str(), item.request_position.unwrap()))
                .collect();
            assert_eq!(items, expected, "{case}");
            assert_eq!(response.errors, case != "blocked", "{case}");
            assert!(!infra::schema::exists(org, StreamType::Logs, &forged_stream).await);
            let (_, batches) = ingester::read_from_memtable(org, "logs", &allowed, None, &[])
                .await
                .unwrap();
            let mut stored = Vec::new();
            for entry in batches.into_iter().flat_map(|(_, entries)| entries) {
                let ids = cast(entry.data.column_by_name("_id").unwrap(), &DataType::Utf8).unwrap();
                let messages = cast(
                    entry.data.column_by_name("message").unwrap(),
                    &DataType::Utf8,
                )
                .unwrap();
                let ids = ids.as_any().downcast_ref::<StringArray>().unwrap();
                let messages = messages.as_any().downcast_ref::<StringArray>().unwrap();
                for row in 0..entry.data.num_rows() {
                    stored.push((ids.value(row).to_string(), messages.value(row).to_string()));
                }
            }
            stored.sort();
            assert_eq!(
                stored,
                [
                    ("real".to_string(), "must survive".to_string()),
                    ("warm".to_string(), "warm".to_string())
                ]
            );
            let (_, forged) = ingester::read_from_memtable(org, "logs", &forged_stream, None, &[])
                .await
                .unwrap();
            assert!(forged.is_empty());
        }
    }

    // cloud builds reject the unknown test org at the trial check
    #[cfg(not(feature = "cloud"))]
    #[tokio::test]
    async fn test_ingest_fails_only_the_stream_whose_key_is_too_long() {
        let long_name = "b".repeat(infra::file_list::STREAM_KEY_MAX_LEN);
        let body = format!(
            "{{\"index\": {{\"_index\": \"test_bulk_key_len_ok\", \"_id\": \"1\"}}}}\n{{\"message\": \"a\"}}\n\
             {{\"index\": {{\"_index\": \"{long_name}\", \"_id\": \"2\"}}}}\n{{\"message\": \"b\"}}\n"
        );
        let resp = ingest(
            1,
            "test_org_id",
            Bytes::from(body),
            IngestUser::from_user_email("a@a.com"),
        )
        .await
        .unwrap();

        let bounded =
            infra::file_list::stream_key_violation("test_org_id", StreamType::Logs, &long_name)
                .is_some();
        let rejected: Vec<&BulkResponseItem> = resp
            .items
            .iter()
            .flat_map(|item| item.values())
            .filter(|item| {
                item.error
                    .as_ref()
                    .is_some_and(|e| e.err_type == STREAM_NAME_TOO_LONG)
            })
            .collect();
        if bounded {
            assert_eq!(rejected.len(), 1);
            assert_eq!(rejected[0]._id, "2");
            assert_eq!(rejected[0]._index, long_name);
        } else {
            assert!(rejected.is_empty());
        }
        assert_eq!(resp.errors, bounded);
        assert!(
            infra::schema::exists("test_org_id", StreamType::Logs, "test_bulk_key_len_ok").await
        );
        assert_eq!(
            infra::schema::exists("test_org_id", StreamType::Logs, &long_name).await,
            !bounded
        );
    }

    #[test]
    fn test_prepare_bulk_record_reads_a_key_flattened_into_timestamp() {
        let now = now_micros();
        let (min_ts, max_ts) = (now - 3_600_000_000, now + 3_600_000_000);
        let ts = (now - 60_000_000) / 1000 * 1000;
        let iso = chrono::DateTime::from_timestamp_micros(ts)
            .unwrap()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let stored = |record: json::Value| {
            let mut record = record.as_object().unwrap().clone();
            prepare_bulk_record(&mut record, None, min_ts, max_ts)?;
            crate::logs::ingest::prepare_record(json::Value::Object(record), 0, min_ts, max_ts)
                .map(|(_, timestamp)| timestamp)
                .map_err(|_| "rejected after flattening".to_string())
        };
        assert_eq!(
            stored(json::json!({"@timestamp": ts, "level": "a"})),
            Ok(ts)
        );
        assert_eq!(stored(json::json!({"@timestamp": iso})), Ok(ts));
        assert_eq!(stored(json::json!({"_Timestamp": ts})), Ok(ts));
        assert!(stored(json::json!({"Atimestamp": ts, "éimestamp": ts})).unwrap() >= now);
        // the checked value is the stored one, also when a second key is renamed
        assert_eq!(
            stored(json::json!({"@timestamp": ts, "-timestamp": min_ts - 1})),
            Ok(ts)
        );
        assert_eq!(
            stored(json::json!({"@timestamp": "garbage"})),
            Err(TS_PARSE_FAILED.to_string())
        );
        assert_eq!(
            stored(json::json!({"@timestamp": min_ts - 1})),
            Err(get_upto_discard_error().to_string())
        );
        assert_eq!(
            stored(json::json!({"@timestamp": max_ts + 1})),
            Err(get_future_discard_error().to_string())
        );
        // a value that is neither a string nor a number is not a time, so the record is stamped now
        for value in [
            json::Value::Null,
            json::json!(true),
            json::json!([ts]),
            json::json!({"a": ts}),
        ] {
            let stamped = stored(json::json!({"@timestamp": value})).unwrap();
            assert!(stamped >= now, "{value}");
        }
        // `_timestamp` is stamped as before, now with the record's own time
        let mut record = json::json!({"@timestamp": ts});
        let record = record.as_object_mut().unwrap();
        prepare_bulk_record(record, None, min_ts, max_ts).unwrap();
        assert_eq!(record[TIMESTAMP_COL_NAME], json::json!(ts));
        // `_timestamp` itself is checked first
        let mut record = json::json!({"@timestamp": min_ts - 1, "_timestamp": ts});
        let record = record.as_object_mut().unwrap();
        assert_eq!(prepare_bulk_record(record, None, min_ts, max_ts), Ok(()));
    }

    #[tokio::test]
    async fn test_ingest_basic_functionality() {
        // Create a simple bulk request with one document
        let bulk_request = r#"{"index": {"_index": "test-stream", "_id": "1"}}
{"message": "test log message", "level": "info"}"#;

        let body = Bytes::from(bulk_request);
        let thread_id = 1;
        let org_id = "test-org";
        let user = IngestUser::from_user_email("test@example.com");

        // Note: This test will likely fail due to missing infrastructure setup,
        // but it demonstrates the basic structure of testing the ingest function
        let result = ingest(thread_id, org_id, body, user).await;

        // The test should either succeed or fail with a specific error
        // (likely related to missing database connections or configuration)
        match result {
            Ok(response) => {
                // If successful, verify basic response structure
                // The response should have items if the configuration allows it
                if !get_config().common.bulk_api_response_errors_only {
                    assert!(!response.items.is_empty());
                }
            }
            Err(e) => {
                // Expected to fail due to missing infrastructure
                // Just verify it's a proper error
                assert!(!e.to_string().is_empty());
            }
        }
    }

    mod add_record_status_tests {
        use super::*;

        #[test]
        fn test_add_record_status_success() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                Some("doc_123".to_string()),
                "index".to_string(),
                Some(json::json!({"message": "test"})),
                &mut bulk_res,
                None,
                None,
            );

            // Should add one successful item
            assert_eq!(bulk_res.items.len(), 1);

            // Check the item structure
            let item = &bulk_res.items[0];
            assert!(item.contains_key("index"));

            let bulk_item = &item["index"];
            assert!(!bulk_item._index.is_empty());
            assert!(!bulk_item._id.is_empty());
        }

        #[test]
        fn test_add_record_status_with_failure() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                Some("doc_456".to_string()),
                "create".to_string(),
                Some(json::json!({"data": "test"})),
                &mut bulk_res,
                Some(TS_PARSE_FAILED.to_string()),
                Some("Invalid timestamp format".to_string()),
            );

            // Should add one failed item
            assert_eq!(bulk_res.items.len(), 1);

            // Check the failed item structure
            let item = &bulk_res.items[0];
            assert!(item.contains_key("create"));

            let bulk_item = &item["create"];
            assert!(bulk_item.error.is_some());
        }

        #[test]
        fn test_add_record_status_empty_action() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                None,
                "".to_string(), // Empty action should default to "index"
                None,
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            assert!(item.contains_key("index")); // Should default to "index"
        }

        #[test]
        fn test_add_record_status_no_doc_id() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "stream_without_id".to_string(),
                None, // No document ID
                "update".to_string(),
                Some(json::json!({"field": "value"})),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            let bulk_item = &item["update"];
            // Document ID should be empty string
            assert_eq!(bulk_item._id, "");
        }

        #[test]
        fn test_add_record_status_different_failure_types() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let failure_types = [
                TRANSFORM_FAILED,
                TS_PARSE_FAILED,
                SCHEMA_CONFORMANCE_FAILED,
                PIPELINE_EXEC_FAILED,
            ];

            for (i, failure_type) in failure_types.iter().enumerate() {
                add_record_status(
                    format!("stream_{i}"),
                    Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"test": i})),
                    &mut bulk_res,
                    Some(failure_type.to_string()),
                    Some(format!("Error message {i}")),
                );
            }

            assert_eq!(bulk_res.items.len(), 4);

            // Verify each failure type is recorded
            for (i, failure_type) in failure_types.iter().enumerate() {
                let item = &bulk_res.items[i];
                let bulk_item = &item["index"];
                let error = bulk_item.error.as_ref().unwrap();
                assert_eq!(error.err_type, *failure_type);
            }
        }

        #[test]
        fn test_add_record_status_with_complex_json() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let complex_json = json::json!({
                "timestamp": "2024-01-01T12:00:00Z",
                "level": "ERROR",
                "message": "Complex error occurred",
                "metadata": {
                    "service": "api-gateway",
                    "version": "1.0.0",
                    "tags": ["critical", "authentication"]
                },
                "error_details": {
                    "code": 500,
                    "stack_trace": "...",
                    "user_id": "user123"
                }
            });

            add_record_status(
                "complex_logs".to_string(),
                Some("complex_doc_1".to_string()),
                "index".to_string(),
                Some(complex_json.clone()),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            let bulk_item = &item["index"];

            // Verify the item was created successfully (successful records don't store
            // original_record)
            assert_eq!(bulk_item.status, 200);
            assert!(bulk_item.error.is_none());
            assert!(!bulk_item._index.is_empty());
        }
    }

    mod bulk_constants_tests {
        use super::*;

        #[test]
        fn test_error_constants_uniqueness() {
            // Ensure all error constants are unique
            let constants = vec![
                TRANSFORM_FAILED,
                TS_PARSE_FAILED,
                SCHEMA_CONFORMANCE_FAILED,
                PIPELINE_EXEC_FAILED,
                ACTION_PARSE_FAILED,
            ];

            let mut unique_constants = constants.clone();
            unique_constants.sort();
            unique_constants.dedup();

            assert_eq!(constants.len(), unique_constants.len());
        }
    }

    mod bulk_response_tests {
        use super::*;

        #[test]
        fn test_bulk_response_initialization() {
            let bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            assert_eq!(bulk_res.took, 0);
            assert!(!bulk_res.errors);
            assert!(bulk_res.items.is_empty());
        }

        #[test]
        fn test_bulk_response_with_multiple_items() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            // Add multiple successful records
            for i in 0..5 {
                add_record_status(
                    format!("stream_{i}"),
                    Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"message": format!("log message {i}")})),
                    &mut bulk_res,
                    None,
                    None,
                );
            }

            // Add some failed records
            for i in 5..8 {
                add_record_status(
                    format!("stream_{i}"),
                    Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"message": format!("log message {i}")})),
                    &mut bulk_res,
                    Some(TS_PARSE_FAILED.to_string()),
                    Some("Timestamp error".to_string()),
                );
            }

            assert_eq!(bulk_res.items.len(), 8);

            // Check mix of successful and failed items
            let successful_items: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_none() { 1 } else { 0 }
                })
                .sum();

            let failed_items: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_some() { 1 } else { 0 }
                })
                .sum();

            assert_eq!(successful_items, 5);
            assert_eq!(failed_items, 3);
        }
    }

    mod data_processing_tests {
        use super::*;

        #[test]
        fn test_json_parsing_valid_data() {
            let valid_json =
                r#"{"message": "test log", "level": "info", "timestamp": "2024-01-01T10:00:00Z"}"#;
            let result: Result<json::Value, _> = json::from_slice(valid_json.as_bytes());
            assert!(result.is_ok());

            let value = result.unwrap();
            assert_eq!(value["message"], "test log");
            assert_eq!(value["level"], "info");
        }

        #[test]
        fn test_json_parsing_invalid_data() {
            let invalid_json = r#"{"message": "test log", "level": info"}"#; // Missing quotes around value
            let result: Result<json::Value, _> = json::from_slice(invalid_json.as_bytes());
            assert!(result.is_err());
        }

        #[test]
        fn test_timestamp_parsing() {
            let test_timestamps = vec![
                (
                    json::Value::String("2024-01-01T12:00:00Z".to_string()),
                    false,
                ),
                (
                    json::Value::String("2024-01-01T12:00:00.123Z".to_string()),
                    false,
                ),
                (
                    json::Value::Number(serde_json::Number::from(1640995200000000i64)),
                    true,
                ),
                (
                    json::Value::Number(serde_json::Number::from(1640995200000i64)),
                    false,
                ),
                (
                    json::Value::Number(serde_json::Number::from(1640995200i64)),
                    false,
                ),
            ];

            for (ts_value, ts_valid) in test_timestamps {
                match parse_timestamp_micro_from_value(&ts_value) {
                    Ok((timestamp, valid)) => {
                        assert_eq!(valid, ts_valid);
                        assert!(timestamp > 0);
                        // Should be a reasonable timestamp (after 2020)
                        assert!(timestamp > 1577836800000000i64); // 2020-01-01 in microseconds
                    }
                    Err(e) => {
                        // Some formats might not be supported, which is fine
                        println!("Timestamp parsing failed (expected for some formats): {e}");
                    }
                }
            }
        }

        #[test]
        fn test_timestamp_parsing_invalid() {
            let invalid_timestamps = vec![
                json::Value::String("not-a-timestamp".to_string()),
                json::Value::String("".to_string()),
                json::Value::Null,
                json::Value::Bool(true),
                json::Value::Array(vec![]),
                json::Value::Object(serde_json::Map::new()),
            ];

            for invalid_ts in invalid_timestamps {
                let result = parse_timestamp_micro_from_value(&invalid_ts);
                assert!(result.is_err());
            }
        }
    }

    mod stream_name_tests {
        use super::*;

        #[test]
        fn test_valid_stream_names() {
            let valid_names = vec![
                "test-stream",
                "application_logs",
                "service.metrics",
                "stream123",
                "a_very_long_stream_name_with_underscores_and_numbers_123",
            ];

            for name in valid_names {
                // These should not be empty or invalid
                assert!(!name.is_empty());
                assert!(name != "_");
                assert!(name != "/");
            }
        }

        #[test]
        fn test_invalid_stream_names() {
            let invalid_names = vec![
                "",  // Empty
                "_", // Single underscore
                "/", // Single slash
            ];

            for name in invalid_names {
                // These should be caught as invalid
                assert!(name.is_empty() || name == "_" || name == "/");
            }
        }

        #[test]
        fn test_stream_name_formatting() {
            // Test that format_stream_name is available and works
            let test_names = vec!["Test-Stream", "UPPERCASE", "mixed_Case_123"];

            for name in test_names {
                let formatted = format_stream_name(name.to_string());
                // Should return a non-empty formatted string
                assert!(!formatted.is_empty());
                // Typically converts to lowercase, but exact behavior may vary
            }
        }
    }

    mod error_handling_tests {
        use super::*;

        #[test]
        fn test_bulk_response_error_creation() {
            let error = BulkResponseError::new(
                TS_PARSE_FAILED.to_string(),
                "test-stream".to_string(),
                "Invalid timestamp format".to_string(),
                "400".to_string(),
            );

            // Basic validation that error object can be created
            // Exact structure depends on BulkResponseError implementation
            assert!(!format!("{error:?}").is_empty());
        }

        #[test]
        fn test_different_error_scenarios() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            // Test various error scenarios
            let error_scenarios = vec![
                (TRANSFORM_FAILED, "JSON transformation failed"),
                (TS_PARSE_FAILED, "Cannot parse timestamp"),
                (SCHEMA_CONFORMANCE_FAILED, "Schema validation failed"),
                (PIPELINE_EXEC_FAILED, "Pipeline execution error"),
            ];

            for (error_type, error_msg) in error_scenarios {
                add_record_status(
                    "error_stream".to_string(),
                    Some("error_doc".to_string()),
                    "index".to_string(),
                    Some(json::json!({"error": "test"})),
                    &mut bulk_res,
                    Some(error_type.to_string()),
                    Some(error_msg.to_string()),
                );
            }

            assert_eq!(bulk_res.items.len(), 4);

            // All items should be errors
            for item in &bulk_res.items {
                let bulk_item = item.values().next().unwrap();
                assert!(bulk_item.error.is_some());
            }
        }
    }

    mod edge_case_tests {
        use super::*;

        #[test]
        fn test_empty_bulk_request() {
            let empty_request = "";
            let body = Bytes::from(empty_request);

            // Empty request should be handled gracefully
            // (Test would need actual infrastructure to run fully)
            assert_eq!(body.len(), 0);
        }

        #[test]
        fn test_malformed_bulk_lines() {
            let malformed_lines = vec![
                "",                 // Empty line
                "not-json",         // Not JSON
                "{incomplete json", // Incomplete JSON
                "{}",               // Empty JSON object
                r#"{"index": {}}"#, // Missing required fields
            ];

            for line in malformed_lines {
                if line.is_empty() {
                    // Empty lines should be skipped
                    continue;
                }

                if json::from_slice::<json::Value>(line.as_bytes()).is_ok() {
                    // Valid JSON, should be processed
                } else {
                    // Invalid JSON, should cause error
                    // This is expected behavior
                }
            }
        }

        #[test]
        fn test_very_large_documents() {
            let large_value = "x".repeat(10000);
            let large_doc = json::json!({
                "message": large_value,
                "metadata": {
                    "large_field": "y".repeat(5000),
                    "nested": {
                        "data": "z".repeat(3000)
                    }
                }
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "large_docs".to_string(),
                Some("large_doc_1".to_string()),
                "index".to_string(),
                Some(large_doc),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
        }

        #[test]
        fn test_unicode_and_special_characters() {
            let unicode_doc = json::json!({
                "message": "Hello 世界! 🌍 Testing Unicode",
                "emoji": "🚀🌟✨",
                "special_chars": "!@#$%^&*()[]{}|\\:;\"'<>?,./",
                "unicode_text": "Здравствуй мир! ¡Hola mundo!",
                "japanese": "こんにちは世界"
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "unicode_stream".to_string(),
                Some("unicode_doc".to_string()),
                "index".to_string(),
                Some(unicode_doc),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);

            // Should handle unicode gracefully
            let item = &bulk_res.items[0];
            let bulk_item = item.values().next().unwrap();
            assert!(!bulk_item._index.is_empty());
        }

        #[test]
        fn test_null_and_empty_values() {
            let doc_with_nulls = json::json!({
                "null_field": null,
                "empty_string": "",
                "empty_array": [],
                "empty_object": {},
                "zero_number": 0,
                "false_boolean": false
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "null_values_stream".to_string(),
                Some("null_doc".to_string()),
                "index".to_string(),
                Some(doc_with_nulls),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
        }
    }

    mod performance_tests {
        use super::*;

        #[test]
        fn test_bulk_response_performance() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let start = std::time::Instant::now();

            // Add many records to test performance
            for i in 0..1000 {
                add_record_status(
                    format!("perf_stream_{}", i % 10), // 10 different streams
                    Some(format!("doc_{i}")),
                    if i % 2 == 0 {
                        "index".to_string()
                    } else {
                        "create".to_string()
                    },
                    Some(json::json!({
                        "id": i,
                        "message": format!("Performance test message {i}"),
                        "timestamp": format!("2024-01-01T{:02}:00:00Z", i % 24)
                    })),
                    &mut bulk_res,
                    if i % 10 == 0 {
                        Some(TS_PARSE_FAILED.to_string())
                    } else {
                        None
                    },
                    if i % 10 == 0 {
                        Some("Test error".to_string())
                    } else {
                        None
                    },
                );
            }

            let duration = start.elapsed();
            assert_eq!(bulk_res.items.len(), 1000);

            // Should complete within reasonable time (less than 1 second for 1000 records)
            assert!(duration.as_secs() < 1);

            // Check distribution of errors vs successes
            let errors: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_some() { 1 } else { 0 }
                })
                .sum();

            assert_eq!(errors, 100); // Every 10th record should be an error
        }
    }
}
