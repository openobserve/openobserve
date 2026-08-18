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

//! Last-check columns for the synthetics list, read from the results stream.
//!
//! `last_check_status` replicates across a super cluster only when it changes,
//! `last_triggered_at` is a runtime column that does not replicate at all, and
//! `last_response_ms` was never populated. Outside the region whose scheduler
//! runs a check the list therefore showed a stale status and two blank columns.
//!
//! The results stream carries all three and is federated by default, so this
//! reads it rather than replicating the columns: no queue traffic, no schema
//! change. Every step is best-effort — on any miss the item keeps the values
//! the DB already supplied, because a config-plane list must not fail when
//! search does.

use std::collections::HashMap;

use config::meta::{
    search::{Query, Request},
    stream::StreamType,
    synthetics::SyntheticListItem,
};
use openobserve_synthetics::RESULTS_STREAM;
use serde_json::Value;

const LOOKBACK_MICROS: i64 = 24 * 60 * 60 * 1_000_000;

/// The search API rejects a query naming a field the stream schema does not
/// have, and the schema only contains what some row has actually carried. On a
/// deployment where no check has run yet the stream does not exist at all, so
/// without this guard every list load would issue a failing search and log a
/// warning.
const REQUIRED_FIELDS: [&str; 4] = ["synthetics_id", "status", "response_time_ms", "_timestamp"];

pub(super) async fn enrich(org_id: &str, items: &mut [SyntheticListItem]) {
    if items.is_empty() || !stream_is_queryable(org_id).await {
        return;
    }
    let Some(latest) = latest_result_per_check(org_id, items).await else {
        return;
    };
    for item in items.iter_mut() {
        if let Some(hit) = latest.get(&item.id) {
            apply(item, hit);
        }
    }
}

async fn stream_is_queryable(org_id: &str) -> bool {
    match infra::schema::get(org_id, RESULTS_STREAM, StreamType::Logs).await {
        Ok(schema) => REQUIRED_FIELDS
            .iter()
            .all(|f| schema.field_with_name(f).is_ok()),
        Err(_) => false,
    }
}

/// `row_number()` keeps this to one query: a plain `max(_timestamp) GROUP BY`
/// yields the timestamp without the row it came from, so status and response
/// would need a second pass.
///
/// The projection is four scalar columns on purpose — the stream also carries
/// `evidence_by_step`, `recorded_steps`, `last_attempt_steps` and
/// `retry_history`, JSON blobs measured at ~20 MB across a 5 000-row read.
fn latest_result_sql(ids: &[&str]) -> String {
    let id_list = ids
        .iter()
        .map(|id| format!("'{}'", id.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "SELECT synthetics_id, status, response_time_ms, _timestamp FROM (\
           SELECT synthetics_id, status, response_time_ms, _timestamp, \
                  row_number() OVER (PARTITION BY synthetics_id ORDER BY _timestamp DESC) AS rn \
           FROM {RESULTS_STREAM} WHERE synthetics_id IN ({id_list})\
         ) WHERE rn = 1"
    )
}

async fn latest_result_per_check(
    org_id: &str,
    items: &[SyntheticListItem],
) -> Option<HashMap<String, Value>> {
    let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
    let end_time = chrono::Utc::now().timestamp_micros();

    let req = Request {
        query: Query {
            sql: latest_result_sql(&ids),
            size: ids.len() as i64,
            start_time: end_time - LOOKBACK_MICROS,
            end_time,
            ..Default::default()
        },
        // A cache hit predating the last run would reintroduce the staleness
        // this exists to remove.
        use_cache: false,
        ..Default::default()
    };

    let resp = search_service::cache::search(
        &config::ider::uuid(),
        org_id,
        StreamType::Logs,
        None,
        &req,
        String::new(),
        false,
        None,
        false,
    )
    .await;

    match resp {
        Ok(resp) => Some(
            resp.hits
                .into_iter()
                .filter_map(|hit| {
                    let id = hit.get("synthetics_id")?.as_str()?.to_string();
                    Some((id, hit))
                })
                .collect(),
        ),
        Err(e) => {
            tracing::warn!("[synthetics] last-check lookup failed, keeping stored values: {e}");
            None
        }
    }
}

fn apply(item: &mut SyntheticListItem, hit: &Value) {
    if let Some(status) = hit
        .get("status")
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_value(Value::String(s.to_owned())).ok())
    {
        item.status = status;
    }
    if let Some(ts) = hit.get("_timestamp").and_then(Value::as_i64) {
        item.last_check_at = Some(ts);
    }
    if let Some(ms) = hit.get("response_time_ms").and_then(Value::as_f64) {
        item.last_response_ms = Some(ms);
    }
}

#[cfg(test)]
mod tests {
    use config::meta::synthetics::SyntheticStatus;
    use serde_json::json;

    use super::*;

    /// Stored values are non-empty so a test can tell "overwritten" from
    /// "blanked".
    fn item(id: &str) -> SyntheticListItem {
        SyntheticListItem {
            id: id.to_owned(),
            org_id: "default".to_owned(),
            folder_id: "default".to_owned(),
            name: "check".to_owned(),
            description: String::new(),
            tags: vec![],
            check_type: config::meta::synthetics::SyntheticType::Http,
            target: "https://example.com".to_owned(),
            frequency: config::meta::synthetics::SyntheticFrequency {
                frequency_type: config::meta::synthetics::SyntheticFrequencyType::Minutes,
                interval: 5,
                cron: String::new(),
                timezone: None,
            },
            locations: vec![],
            enabled: true,
            created_at: 0,
            updated_at: 0,
            last_triggered_at: 0,
            status: SyntheticStatus::Unknown,
            last_check_at: Some(111),
            last_response_ms: Some(1.0),
        }
    }

    #[test]
    fn sql_scopes_to_the_given_ids_and_reads_one_row_each() {
        let sql = latest_result_sql(&["a", "b"]);
        assert!(sql.contains("synthetics_id IN ('a','b')"));
        assert!(sql.contains("rn = 1"));
        assert!(sql.contains(RESULTS_STREAM));
    }

    /// Ids reach the query as literals, so a quote must not end the string.
    #[test]
    fn sql_escapes_quotes_in_ids() {
        assert!(latest_result_sql(&["a'b"]).contains("'a''b'"));
    }

    /// Blob columns are ~20 MB across a wide read and must stay out.
    #[test]
    fn sql_selects_no_blob_columns() {
        let sql = latest_result_sql(&["a"]);
        for blob in [
            "evidence_by_step",
            "recorded_steps",
            "last_attempt_steps",
            "retry_history",
        ] {
            assert!(!sql.contains(blob), "{blob} must not be selected");
        }
    }

    #[test]
    fn apply_overwrites_all_three_columns() {
        let mut it = item("a");
        apply(
            &mut it,
            &json!({"status": "failed", "_timestamp": 999, "response_time_ms": 12.5}),
        );
        assert_eq!(it.status, SyntheticStatus::Failed);
        assert_eq!(it.last_check_at, Some(999));
        assert_eq!(it.last_response_ms, Some(12.5));
    }

    /// A partial or unrecognised row must not blank a column the DB filled.
    #[test]
    fn apply_keeps_stored_values_for_missing_or_bad_fields() {
        let mut it = item("a");
        apply(&mut it, &json!({"status": "not_a_status"}));
        assert_eq!(it.status, SyntheticStatus::Unknown);
        assert_eq!(it.last_check_at, Some(111));
        assert_eq!(it.last_response_ms, Some(1.0));
    }

    #[test]
    fn response_time_reads_an_integer_as_well_as_a_float() {
        let mut it = item("a");
        apply(&mut it, &json!({"response_time_ms": 12}));
        assert_eq!(it.last_response_ms, Some(12.0));
    }
}
