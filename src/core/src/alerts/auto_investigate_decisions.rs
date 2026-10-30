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

//! Reads one org's rows of the `_meta` auto-investigate decision log.

use async_trait::async_trait;
use config::{
    META_ORG_ID, ider,
    meta::{
        alerts::auto_investigate::{
            AUTO_INVESTIGATE_DECISIONS_STREAM, DecisionRow, DecisionsQuery, GATE_WINDOW_SECS,
            ReasonCode,
        },
        cluster::RoleGroup,
        search::{Query, Request as SearchRequest, SearchEventType},
        stream::StreamType,
    },
    utils::json,
};

pub const DEFAULT_LIMIT: usize = 100;
pub const MAX_LIMIT: usize = 1000;
const MAX_TOKEN_LEN: usize = 256;
const MICROS_PER_SEC: i64 = 1_000_000;

/// A validated filter; every string it holds passed [`safe_token`], so it can sit in a SQL literal.
#[derive(Clone, Debug, PartialEq)]
pub struct DecisionFilter {
    alert_id: Option<String>,
    group_key: Option<String>,
    reason: Option<ReasonCode>,
    start_time: i64,
    end_time: i64,
    limit: usize,
}

impl DecisionFilter {
    /// Validates the route's query; a missing range is the trailing gate window ending `now`.
    pub fn from_query(query: &DecisionsQuery, now: i64) -> Result<Self, String> {
        let end_time = query.end_time.unwrap_or(now);
        let start_time = query
            .start_time
            .unwrap_or(end_time - GATE_WINDOW_SECS * MICROS_PER_SEC);
        if start_time >= end_time {
            return Err("start_time must be before end_time".to_string());
        }
        let alert_id = match query.alert_id.as_deref() {
            None | Some("") => None,
            Some(id) => Some(safe_token("alert_id", id)?.to_string()),
        };
        let group_key = match query.group_key.as_deref() {
            None => None,
            Some("") => Some(String::new()),
            Some(key) => Some(safe_token("group_key", key)?.to_string()),
        };
        let reason = match query.reason.as_deref() {
            None | Some("") => None,
            Some(r) => Some(ReasonCode::parse(r).ok_or_else(|| format!("unknown reason {r:?}"))?),
        };
        Ok(Self {
            alert_id,
            group_key,
            reason,
            start_time,
            end_time,
            limit: query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
        })
    }

    pub fn limit(&self) -> usize {
        self.limit
    }

    pub fn start_time(&self) -> i64 {
        self.start_time
    }

    pub fn end_time(&self) -> i64 {
        self.end_time
    }
}

/// Why listing failed.
#[derive(Debug)]
pub enum ListError {
    BadRequest(String),
    Search(anyhow::Error),
}

/// Runs the decision SQL; `Ok(None)` when the stream does not exist yet.
#[async_trait]
pub trait DecisionSource: Send + Sync {
    async fn query(
        &self,
        sql: String,
        filter: &DecisionFilter,
    ) -> anyhow::Result<Option<Vec<json::Value>>>;
}

/// The `_meta` stream in this region only; other regions' leaders log to their own `_meta`.
pub struct MetaStream;

#[async_trait]
impl DecisionSource for MetaStream {
    async fn query(
        &self,
        sql: String,
        filter: &DecisionFilter,
    ) -> anyhow::Result<Option<Vec<json::Value>>> {
        if !infra::schema::exists(
            META_ORG_ID,
            StreamType::Logs,
            AUTO_INVESTIGATE_DECISIONS_STREAM,
        )
        .await
        {
            return Ok(None);
        }
        let req = SearchRequest {
            query: Query {
                sql,
                from: 0,
                size: filter.limit as i64,
                start_time: filter.start_time,
                end_time: filter.end_time,
                ..Default::default()
            },
            regions: vec!["local".to_string()],
            clusters: vec!["local".to_string()],
            search_type: Some(SearchEventType::Other),
            use_cache: false,
            ..Default::default()
        };
        let resp = crate::search::grpc_search::grpc_search(
            &ider::uuid(),
            META_ORG_ID,
            StreamType::Logs,
            None,
            &req,
            Some(RoleGroup::Interactive),
        )
        .await?;
        if resp.is_partial {
            log::warn!(
                "[AUTO_INVESTIGATE] partial decision log read: {}",
                resp.function_error.join(", ")
            );
        }
        Ok(Some(resp.hits))
    }
}

/// The org's decisions newest first; the org filter is in the SQL and checked again on each row.
pub async fn list(
    org_id: &str,
    filter: &DecisionFilter,
    source: &dyn DecisionSource,
) -> Result<Vec<DecisionRow>, ListError> {
    let sql = decisions_sql(org_id, filter).map_err(ListError::BadRequest)?;
    let hits = match source.query(sql, filter).await {
        Ok(Some(hits)) => hits,
        Ok(None) => return Ok(Vec::new()),
        Err(e) if e.to_string().to_lowercase().contains("not found") => return Ok(Vec::new()),
        Err(e) => return Err(ListError::Search(e)),
    };
    let mut rows = Vec::with_capacity(hits.len());
    for hit in hits {
        match json::from_value::<DecisionRow>(hit) {
            Ok(row) if row.org_id == org_id => rows.push(row),
            Ok(row) => log::error!(
                "[AUTO_INVESTIGATE] dropped a decision row of org {} read for {org_id}",
                row.org_id
            ),
            Err(e) => log::warn!("[AUTO_INVESTIGATE] skipped an unreadable decision row: {e}"),
        }
    }
    Ok(rows)
}

/// Builds only from validated tokens, integers and enum names, never from raw user text.
pub fn decisions_sql(org_id: &str, filter: &DecisionFilter) -> Result<String, String> {
    let org_id = safe_token("org_id", org_id)?;
    let mut sql = format!(
        "SELECT * FROM \"{AUTO_INVESTIGATE_DECISIONS_STREAM}\" WHERE org_id = '{org_id}' \
         AND _timestamp >= {} AND _timestamp < {}",
        filter.start_time, filter.end_time
    );
    if let Some(alert_id) = &filter.alert_id {
        sql.push_str(&format!(" AND alert_id = '{alert_id}'"));
    }
    if let Some(group_key) = &filter.group_key {
        sql.push_str(&format!(" AND group_key = '{group_key}'"));
    }
    if let Some(reason) = filter.reason {
        sql.push_str(&format!(" AND reason = '{}'", reason.as_str()));
    }
    sql.push_str(&format!(" ORDER BY _timestamp DESC LIMIT {}", filter.limit));
    Ok(sql)
}

/// Org names, ksuid alert ids and hex group keys all fit; a quote or backslash never does.
fn safe_token<'a>(name: &str, value: &'a str) -> Result<&'a str, String> {
    let ok = !value.is_empty()
        && value.len() <= MAX_TOKEN_LEN
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if ok {
        Ok(value)
    } else {
        Err(format!(
            "{name} may hold only letters, digits, '_', '-' and '.', up to {MAX_TOKEN_LEN} characters"
        ))
    }
}

#[cfg(any(test, feature = "test-utils"))]
pub mod test_support {
    use std::{io::Cursor, sync::Arc};

    use arrow::json::{ReaderBuilder, reader::infer_json_schema};
    use config::meta::alerts::auto_investigate::{
        BudgetCheck, DecisionContext, GateInputs, GateSettings, MarkLookup, decide_auto_investigate,
    };
    use datafusion::prelude::SessionContext;

    use super::*;

    /// One logged decision for `org`/`alert`/`group` at `at`.
    pub fn decision_row(
        org: &str,
        alert: &str,
        group: &str,
        at: i64,
        budget: BudgetCheck,
    ) -> DecisionRow {
        let inputs = GateInputs {
            is_new_fire: true,
            level: Some(config::meta::alerts::level::AlertLevel::Critical),
            rca_running: false,
            last_auto_investigated_at: None,
            protected: false,
            mark_lookup: MarkLookup::NotChecked,
            onsets_7d: 2,
            evaluations_7d: 30,
            fire_share_7d: 0.2,
            budget,
            now: at,
            settings: GateSettings::default(),
            settings_version: None,
        };
        DecisionRow::new(
            &decide_auto_investigate(&inputs),
            &inputs,
            DecisionContext {
                org_id: org.to_string(),
                alert_id: alert.to_string(),
                group_key: group.to_string(),
                firing_started_at: at,
                destination: "slack".to_string(),
                node: "n1".to_string(),
                rca_run_id: None,
            },
        )
    }

    /// Runs the real SQL with DataFusion over seeded rows; no rows means the stream is absent.
    pub struct SeededDecisions(pub Vec<DecisionRow>);

    #[async_trait]
    impl DecisionSource for SeededDecisions {
        async fn query(
            &self,
            sql: String,
            _filter: &DecisionFilter,
        ) -> anyhow::Result<Option<Vec<json::Value>>> {
            if self.0.is_empty() {
                return Ok(None);
            }
            let ndjson = self
                .0
                .iter()
                .map(json::to_string)
                .collect::<Result<Vec<_>, _>>()?
                .join(
                    "
",
                );
            let (schema, _) = infer_json_schema(Cursor::new(ndjson.as_bytes()), None)?;
            let batch = ReaderBuilder::new(Arc::new(schema))
                .with_batch_size(self.0.len())
                .build(Cursor::new(ndjson.as_bytes()))?
                .next()
                .ok_or_else(|| anyhow::anyhow!("no batch"))??;
            let ctx = SessionContext::new();
            ctx.register_batch(AUTO_INVESTIGATE_DECISIONS_STREAM, batch)?;
            let batches = ctx.sql(&sql).await?.collect().await?;
            let refs: Vec<_> = batches.iter().collect();
            let rows = config::utils::arrow::record_batches_to_json_rows(&refs)?;
            Ok(Some(rows.into_iter().map(json::Value::Object).collect()))
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::auto_investigate::BudgetCheck;

    use super::{
        test_support::{SeededDecisions, decision_row as row},
        *,
    };

    const NOW: i64 = 1_000 * 86_400 * MICROS_PER_SEC;

    fn query() -> DecisionsQuery {
        DecisionsQuery::default()
    }

    #[test]
    fn the_filter_defaults_and_caps() {
        let f = DecisionFilter::from_query(&query(), NOW).unwrap();
        assert_eq!(f.limit(), DEFAULT_LIMIT);
        assert_eq!(f.end_time(), NOW);
        assert_eq!(f.start_time(), NOW - GATE_WINDOW_SECS * MICROS_PER_SEC);
        let big = DecisionsQuery {
            limit: Some(5_000),
            ..query()
        };
        assert_eq!(
            DecisionFilter::from_query(&big, NOW).unwrap().limit(),
            MAX_LIMIT
        );
        let backwards = DecisionsQuery {
            start_time: Some(NOW),
            end_time: Some(NOW - 1),
            ..query()
        };
        assert!(DecisionFilter::from_query(&backwards, NOW).is_err());
    }

    #[test]
    fn user_text_that_could_leave_a_sql_literal_is_refused() {
        for bad in ["a'b", "a\\b", "a b", "x' OR '1'='1", "a;b", "a\"b"] {
            for q in [
                DecisionsQuery {
                    alert_id: Some(bad.to_string()),
                    ..query()
                },
                DecisionsQuery {
                    group_key: Some(bad.to_string()),
                    ..query()
                },
                DecisionsQuery {
                    reason: Some(bad.to_string()),
                    ..query()
                },
            ] {
                assert!(
                    DecisionFilter::from_query(&q, NOW).is_err(),
                    "{bad} in {q:?}"
                );
            }
        }
        let f = DecisionFilter::from_query(&query(), NOW).unwrap();
        assert!(decisions_sql("ac'me", &f).is_err());
        let sql = decisions_sql("acme", &f).unwrap();
        assert!(sql.contains("org_id = 'acme'"), "{sql}");
        assert!(sql.ends_with("ORDER BY _timestamp DESC LIMIT 100"), "{sql}");
    }

    #[tokio::test]
    async fn an_absent_stream_lists_nothing() {
        let f = DecisionFilter::from_query(&query(), NOW).unwrap();
        let rows = list("acme", &f, &SeededDecisions(vec![])).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn the_seeded_log_is_filtered_by_org_and_ordered_newest_first() {
        let seeded = SeededDecisions(vec![
            row("acme", "a1", "g1", NOW - 3_000, BudgetCheck::Allowed),
            row("acme", "a1", "g1", NOW - 1_000, BudgetCheck::TurnLimit),
            row("other", "a1", "g1", NOW - 500, BudgetCheck::Allowed),
        ]);
        let f = DecisionFilter::from_query(&query(), NOW).unwrap();
        let rows = list("acme", &f, &seeded).await.unwrap();
        let at: Vec<i64> = rows.iter().map(|r| r.timestamp).collect();
        assert_eq!(at, vec![NOW - 1_000, NOW - 3_000]);
        assert!(rows.iter().all(|r| r.org_id == "acme"));
        assert_eq!(rows[0].budget_check, Some(BudgetCheck::TurnLimit));
        assert_eq!(rows[1].budget_check, None);
    }
}
