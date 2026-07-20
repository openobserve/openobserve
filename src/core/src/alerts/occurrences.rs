// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Bounded audit records for scheduled alert occurrences.
//!
//! Occurrences explain why a scheduled alert fired. They are intentionally not
//! replay manifests: no Parquet file references, WAL inputs, or reconstructed
//! scan state are captured here.

use anyhow::{Result, anyhow, bail};
use config::{
    meta::alerts::{QueryType, TriggerEvalResults, alert::Alert},
    utils::{json, md5, time::now_micros},
};
use infra::table::alert_occurrences as occurrence_table;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;

const SCHEMA_VERSION: i16 = 1;
pub const MAX_RESULT_PREVIEW_ROWS: usize = 10;
pub const MAX_RESULT_PREVIEW_BYTES: usize = 64 * 1024;
pub const DEFAULT_OCCURRENCE_LIST_LIMIT: u64 = 50;
pub const MAX_OCCURRENCE_LIST_LIMIT: u64 = 100;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ScheduledOccurrenceInput {
    pub(crate) org_id: String,
    pub(crate) alert: Alert,
    pub(crate) window_start: i64,
    pub(crate) window_end: i64,
    pub(crate) trigger_timestamp: i64,
    pub(crate) trace_id: Option<String>,
    pub(crate) query_took: Option<i64>,
    pub(crate) result_preview: AlertOccurrenceResultPreview,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AlertOccurrenceResultPreview {
    pub matched_count: i64,
    pub rows: Vec<json::Value>,
    pub truncated: bool,
    pub max_rows: usize,
    pub max_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AlertOccurrenceView {
    pub occurrence_id: Ksuid,
    pub org_id: String,
    pub alert_id: Ksuid,
    pub alert_name: Option<String>,
    pub alert_updated_at: Option<i64>,
    pub config_hash: String,
    pub window_start: i64,
    pub window_end: i64,
    pub trigger_timestamp: i64,
    pub query_type: String,
    pub condition_operator: String,
    pub threshold_value: Option<i64>,
    pub matched_count: i64,
    pub result_preview: AlertOccurrenceResultPreview,
    pub query_took: Option<i64>,
    pub trace_id: Option<String>,
    pub created_at: i64,
    pub schema_version: i16,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AlertOccurrenceSummary {
    pub occurrence_id: Ksuid,
    pub org_id: String,
    pub alert_id: Ksuid,
    pub alert_name: Option<String>,
    pub alert_updated_at: Option<i64>,
    pub config_hash: String,
    pub window_start: i64,
    pub window_end: i64,
    pub trigger_timestamp: i64,
    pub query_type: String,
    pub condition_operator: String,
    pub threshold_value: Option<i64>,
    pub matched_count: i64,
    pub result_truncated: bool,
    pub trace_id: Option<String>,
    pub created_at: i64,
    pub schema_version: i16,
}

pub(crate) async fn create_scheduled_occurrence(
    input: ScheduledOccurrenceInput,
) -> Result<AlertOccurrenceView> {
    let occurrence = build_scheduled_occurrence(input)?;
    let record = occurrence_table::create_occurrence(occurrence)
        .await
        .map_err(|e| anyhow!("alert occurrence persistence failed: {e}"))?;
    to_view(record)
}

pub async fn get_occurrence_view(
    org_id: &str,
    occurrence_id: Ksuid,
) -> Result<Option<AlertOccurrenceView>> {
    occurrence_table::get_occurrence(org_id, &occurrence_id.to_string())
        .await
        .map_err(|e| anyhow!("alert occurrence lookup failed: {e}"))?
        .map(to_view)
        .transpose()
}

pub async fn list_occurrence_summaries(
    org_id: &str,
    alert_id: Ksuid,
    limit: u64,
    offset: u64,
) -> Result<Vec<AlertOccurrenceSummary>> {
    let limit = clamp_list_limit(limit);
    occurrence_table::list_occurrences(org_id, &alert_id.to_string(), limit, offset)
        .await
        .map_err(|e| anyhow!("alert occurrence list failed: {e}"))?
        .into_iter()
        .map(to_summary)
        .collect()
}

pub fn clamp_list_limit(limit: u64) -> u64 {
    match limit {
        0 => DEFAULT_OCCURRENCE_LIST_LIMIT,
        value => value.min(MAX_OCCURRENCE_LIST_LIMIT),
    }
}

pub fn alert_config_hash(alert: &Alert) -> String {
    // The hash covers the scheduled query and trigger semantics only. Runtime
    // state such as updated_at, last_satisfied_at, destinations, owner, and
    // scheduler timestamps is intentionally excluded.
    let stable = serde_json::json!({
        "stream_type": alert.stream_type,
        "stream_name": alert.stream_name,
        "is_real_time": alert.is_real_time,
        "query_condition": alert.query_condition,
        "trigger_condition": alert.trigger_condition,
        "deduplication": alert.deduplication,
        "creates_incident": alert.creates_incident,
    });
    format!(
        "md5:{}",
        md5::hash(&serde_json::to_string(&stable).unwrap_or_default())
    )
}

pub fn bounded_result_preview(
    rows: &[json::Map<String, json::Value>],
) -> AlertOccurrenceResultPreview {
    let mut preview = AlertOccurrenceResultPreview {
        matched_count: rows.len() as i64,
        rows: Vec::new(),
        truncated: false,
        max_rows: MAX_RESULT_PREVIEW_ROWS,
        max_bytes: MAX_RESULT_PREVIEW_BYTES,
    };

    for row in rows.iter().take(MAX_RESULT_PREVIEW_ROWS) {
        let value = json::Value::Object(row.clone());
        let mut candidate = preview.clone();
        candidate.rows.push(value);

        if serialized_result_preview_len(&candidate) <= MAX_RESULT_PREVIEW_BYTES {
            preview = candidate;
        } else {
            preview.truncated = true;
        }
    }

    if preview.rows.len() < rows.len() {
        preview.truncated = true;
    }

    while serialized_result_preview_len(&preview) > MAX_RESULT_PREVIEW_BYTES
        && !preview.rows.is_empty()
    {
        preview.rows.pop();
        preview.truncated = true;
    }

    debug_assert!(serialized_result_preview_len(&preview) <= MAX_RESULT_PREVIEW_BYTES);
    preview
}

fn serialized_result_preview_len(preview: &AlertOccurrenceResultPreview) -> usize {
    serde_json::to_vec(preview)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

pub(crate) fn scheduled_occurrence_input(
    org_id: &str,
    alert: &Alert,
    trigger_results: &TriggerEvalResults,
    result_preview: AlertOccurrenceResultPreview,
    window_start: i64,
    trace_id: Option<String>,
) -> ScheduledOccurrenceInput {
    ScheduledOccurrenceInput {
        org_id: org_id.to_string(),
        alert: alert.clone(),
        window_start,
        window_end: trigger_results.end_time,
        trigger_timestamp: trigger_results.end_time,
        trace_id,
        query_took: trigger_results.query_took,
        result_preview,
        created_at: now_micros(),
    }
}

fn build_scheduled_occurrence(
    input: ScheduledOccurrenceInput,
) -> Result<occurrence_table::NewAlertOccurrence> {
    if input.org_id.trim().is_empty() {
        bail!("invalid alert occurrence input: org_id is required");
    }
    if input.window_start > input.window_end {
        bail!("invalid alert occurrence window: window_start must be <= window_end");
    }
    let alert_id = input
        .alert
        .id
        .ok_or_else(|| anyhow!("alert occurrence requires alert id"))?;
    let preview = input.result_preview;
    let result_truncated = preview.truncated;
    let matched_count = preview.matched_count;
    let alert_updated_at = input
        .alert
        .updated_at
        .as_ref()
        .map(|dt| dt.timestamp_micros());

    Ok(occurrence_table::NewAlertOccurrence {
        occurrence_id: None,
        org_id: input.org_id,
        alert_id: alert_id.to_string(),
        alert_name: (!input.alert.name.is_empty()).then_some(input.alert.name.clone()),
        alert_updated_at,
        config_hash: alert_config_hash(&input.alert),
        window_start: input.window_start,
        window_end: input.window_end,
        trigger_timestamp: input.trigger_timestamp,
        query_type: query_type_name(input.alert.query_condition.query_type).to_string(),
        condition_operator: input.alert.trigger_condition.operator.to_string(),
        threshold_value: Some(input.alert.trigger_condition.threshold),
        matched_count,
        result_preview: serde_json::to_value(preview)?,
        result_truncated,
        query_took: input.query_took,
        trace_id: input.trace_id.filter(|v| !v.is_empty()),
        created_at: input.created_at,
        schema_version: SCHEMA_VERSION,
    })
}

fn query_type_name(query_type: QueryType) -> &'static str {
    match query_type {
        QueryType::Custom => "custom",
        QueryType::SQL => "sql",
        QueryType::PromQL => "promql",
    }
}

fn to_view(record: infra::table::entity::alert_occurrences::Model) -> Result<AlertOccurrenceView> {
    let occurrence_id = record
        .occurrence_id
        .parse::<Ksuid>()
        .map_err(|e| anyhow!("invalid alert occurrence_id in database: {e}"))?;
    let alert_id = record
        .alert_id
        .parse::<Ksuid>()
        .map_err(|e| anyhow!("invalid alert_id in alert occurrence database row: {e}"))?;
    let result_preview = serde_json::from_value(record.result_preview.clone())
        .map_err(|e| anyhow!("invalid alert occurrence result_preview: {e}"))?;

    Ok(AlertOccurrenceView {
        occurrence_id,
        org_id: record.org_id,
        alert_id,
        alert_name: record.alert_name,
        alert_updated_at: record.alert_updated_at,
        config_hash: record.config_hash,
        window_start: record.window_start,
        window_end: record.window_end,
        trigger_timestamp: record.trigger_timestamp,
        query_type: record.query_type,
        condition_operator: record.condition_operator,
        threshold_value: record.threshold_value,
        matched_count: record.matched_count,
        result_preview,
        query_took: record.query_took,
        trace_id: record.trace_id,
        created_at: record.created_at,
        schema_version: record.schema_version,
    })
}

fn to_summary(
    record: infra::table::entity::alert_occurrences::Model,
) -> Result<AlertOccurrenceSummary> {
    let occurrence_id = record
        .occurrence_id
        .parse::<Ksuid>()
        .map_err(|e| anyhow!("invalid alert occurrence_id in database: {e}"))?;
    let alert_id = record
        .alert_id
        .parse::<Ksuid>()
        .map_err(|e| anyhow!("invalid alert_id in alert occurrence database row: {e}"))?;

    Ok(AlertOccurrenceSummary {
        occurrence_id,
        org_id: record.org_id,
        alert_id,
        alert_name: record.alert_name,
        alert_updated_at: record.alert_updated_at,
        config_hash: record.config_hash,
        window_start: record.window_start,
        window_end: record.window_end,
        trigger_timestamp: record.trigger_timestamp,
        query_type: record.query_type,
        condition_operator: record.condition_operator,
        threshold_value: record.threshold_value,
        matched_count: record.matched_count,
        result_truncated: record.result_truncated,
        trace_id: record.trace_id,
        created_at: record.created_at,
        schema_version: record.schema_version,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::{Operator, QueryCondition, QueryType, TriggerCondition},
        stream::StreamType,
    };

    use super::*;

    fn alert() -> Alert {
        let mut alert = Alert::default();
        alert.id = Some("2XQ4VdD2xcWd1FJV6m2ndOg7qxp".parse().unwrap());
        alert.name = "cpu_high".to_string();
        alert.stream_type = StreamType::Logs;
        alert.stream_name = "app".to_string();
        alert.query_condition = QueryCondition {
            query_type: QueryType::SQL,
            sql: Some("select count(*) as count from app".to_string()),
            ..Default::default()
        };
        alert.trigger_condition = TriggerCondition {
            operator: Operator::GreaterThanEquals,
            threshold: 3,
            period: 10,
            ..Default::default()
        };
        alert.updated_at = Some(
            chrono::DateTime::from_timestamp_micros(1234)
                .unwrap()
                .with_timezone(&chrono::FixedOffset::east_opt(0).unwrap()),
        );
        alert
    }

    fn row(value: i64) -> json::Map<String, json::Value> {
        let mut row = json::Map::new();
        row.insert("count".to_string(), value.into());
        row
    }

    fn large_row(bytes: usize) -> json::Map<String, json::Value> {
        let mut row = json::Map::new();
        row.insert("message".to_string(), "x".repeat(bytes).into());
        row
    }

    #[test]
    fn alert_config_hash_is_deterministic_and_ignores_updated_at() {
        let mut first = alert();
        let mut second = first.clone();
        second.updated_at = Some(
            chrono::DateTime::from_timestamp_micros(9999)
                .unwrap()
                .with_timezone(&chrono::FixedOffset::east_opt(0).unwrap()),
        );

        assert_eq!(alert_config_hash(&first), alert_config_hash(&second));

        first.trigger_condition.threshold = 4;
        assert_ne!(alert_config_hash(&first), alert_config_hash(&second));
    }

    #[test]
    fn bounded_result_preview_enforces_row_limit() {
        let rows = (0..20).map(row).collect::<Vec<_>>();
        let preview = bounded_result_preview(&rows);

        assert_eq!(preview.matched_count, 20);
        assert_eq!(preview.rows.len(), MAX_RESULT_PREVIEW_ROWS);
        assert!(preview.truncated);
        assert!(serialized_result_preview_len(&preview) <= MAX_RESULT_PREVIEW_BYTES);
    }

    #[test]
    fn bounded_result_preview_limits_complete_serialized_object() {
        let rows = (0..20)
            .map(|_| large_row(MAX_RESULT_PREVIEW_BYTES / 4))
            .collect::<Vec<_>>();
        let preview = bounded_result_preview(&rows);

        assert_eq!(preview.matched_count, 20);
        assert!(preview.rows.len() <= MAX_RESULT_PREVIEW_ROWS);
        assert!(preview.rows.len() < rows.len());
        assert!(preview.truncated);
        assert!(serialized_result_preview_len(&preview) <= MAX_RESULT_PREVIEW_BYTES);
    }

    #[test]
    fn bounded_result_preview_excludes_single_oversized_row_and_stays_valid_json() {
        let preview = bounded_result_preview(&[large_row(MAX_RESULT_PREVIEW_BYTES + 1)]);
        let serialized = serde_json::to_vec(&preview).unwrap();
        let reparsed: AlertOccurrenceResultPreview = serde_json::from_slice(&serialized).unwrap();

        assert_eq!(preview.matched_count, 1);
        assert!(preview.rows.is_empty());
        assert!(preview.truncated);
        assert_eq!(reparsed, preview);
        assert!(serialized.len() <= MAX_RESULT_PREVIEW_BYTES);
    }

    #[test]
    fn bounded_result_preview_preserves_truncation_metadata() {
        let rows = (0..11).map(row).collect::<Vec<_>>();
        let preview = bounded_result_preview(&rows);

        assert_eq!(preview.matched_count, 11);
        assert_eq!(preview.max_rows, MAX_RESULT_PREVIEW_ROWS);
        assert_eq!(preview.max_bytes, MAX_RESULT_PREVIEW_BYTES);
        assert_eq!(preview.rows.len(), MAX_RESULT_PREVIEW_ROWS);
        assert!(preview.truncated);
    }

    #[test]
    fn build_scheduled_occurrence_captures_condition_summary_without_trace_id() {
        let result_preview = bounded_result_preview(&[row(4)]);
        let input = ScheduledOccurrenceInput {
            org_id: "org1".to_string(),
            alert: alert(),
            window_start: 10,
            window_end: 20,
            trigger_timestamp: 20,
            trace_id: None,
            query_took: Some(7),
            result_preview,
            created_at: 21,
        };

        let occurrence = build_scheduled_occurrence(input).unwrap();

        assert_eq!(occurrence.query_type, "sql");
        assert_eq!(occurrence.condition_operator, ">=");
        assert_eq!(occurrence.threshold_value, Some(3));
        assert_eq!(occurrence.matched_count, 1);
        assert_eq!(occurrence.trace_id, None);
        assert!(
            serde_json::to_vec(&occurrence.result_preview)
                .unwrap()
                .len()
                <= MAX_RESULT_PREVIEW_BYTES
        );
    }
}
