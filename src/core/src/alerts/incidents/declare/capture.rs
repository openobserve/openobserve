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
    collections::{BTreeMap, BTreeSet},
    future::Future,
    time::Duration,
};

use config::{
    QUERY_WITH_NO_LIMIT, TIMESTAMP_COL_NAME,
    meta::{
        alerts::{
            incident_fields::{self, MeasurementLanguage, OnsetDirection, QueryMeasurement},
            incidents::{ContextSource, ContextTarget, ResultSummary, SummarySeries},
        },
        promql::value::{Sample, Value as MetricValue},
        search,
        sql::TableReferenceExt,
        stream::StreamType,
        traces::build_trace_query,
    },
    utils::{
        query_range::clamp_start_time,
        query_select_utils::replace_o2_custom_patterns,
        sql::{quote_identifier, validate_optional_where_fragment},
    },
};
use serde_json::Value;
use sqlparser::{
    ast::{Expr, SelectItem, SetExpr, Statement, TableFactor},
    dialect::PostgreSqlDialect,
    parser::Parser,
};
use tokio::time::Instant;

use crate::authz::{TypedStream, resolve_sql_tables};

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(10);
const MINUTE_US: i64 = 60_000_000;
const LOOKBACK_US: i64 = 60 * MINUTE_US;
const SUMMARY_MAX_BYTES: usize = 4096;
const SUMMARY_MAX_BUCKETS: i64 = 120;
const SUMMARY_MAX_SAMPLES: usize = 5;
const BUCKET_OFFSET: &str = "zo_context_minute";
const BUCKET_COUNT: &str = "zo_context_count";

struct OnsetSeries {
    buckets: Vec<(i64, f64)>,
    direction: OnsetDirection,
}

pub(in crate::alerts::incidents) struct QueryRunner<'a> {
    pub org: &'a str,
    pub user: &'a str,
    pub target: &'a ContextTarget,
    pub timeout_secs: i64,
}

impl QueryRunner<'_> {
    pub(in crate::alerts::incidents) async fn sql(
        &self,
        sql: String,
        window: (i64, i64),
        function: Option<String>,
    ) -> anyhow::Result<search::Response> {
        self.check_sql_window(&sql, window).await?;
        let req = search::Request {
            query: search::Query {
                sql,
                start_time: window.0,
                end_time: window.1,
                size: QUERY_WITH_NO_LIMIT,
                query_fn: function,
                ..Default::default()
            },
            timeout: self.timeout_secs,
            search_type: Some(search::SearchEventType::UI),
            ..Default::default()
        };
        let trace = config::ider::generate_trace_id();
        let response = search_service::cache::search(
            &trace,
            self.org,
            self.target.stream_type(),
            Some(self.user.to_string()),
            &req,
            String::new(),
            false,
            None,
            false,
        )
        .await?;
        anyhow::ensure!(!response.is_partial, "partial context query result");
        anyhow::ensure!(
            response.function_error.is_empty(),
            "context query function failed"
        );
        Ok(response)
    }

    pub(in crate::alerts::incidents) async fn check_sql_window(
        &self,
        sql: &str,
        window: (i64, i64),
    ) -> anyhow::Result<()> {
        search_service::check_org_search_allowed(self.org)?;
        for stream in range_limited_sql_streams(self.org, sql, self.target.stream_type())? {
            let settings_max =
                infra::schema::get_settings(&stream.org_id, &stream.name, stream.stream_type)
                    .await
                    .map_or(0, |settings| settings.max_query_range);
            let effective_max = search_service::query_range::get_settings_max_query_range(
                settings_max,
                &stream.org_id,
                Some(self.user),
            )
            .await;
            enforce_query_window(window, &stream, effective_max)?;
        }
        Ok(())
    }

    async fn promql(&self, query: &str, window: (i64, i64)) -> anyhow::Result<Vec<Sample>> {
        Ok(metric_samples(
            self.promql_value(query, window).await?,
            window.0,
        ))
    }

    pub(in crate::alerts::incidents) async fn promql_value(
        &self,
        query: &str,
        (start, end): (i64, i64),
    ) -> anyhow::Result<MetricValue> {
        search_service::check_org_search_allowed(self.org)?;
        let req = promql_service::MetricsQueryRequest {
            query: query.to_string(),
            start,
            end: end - 1,
            step: MINUTE_US,
            query_exemplars: false,
            use_cache: None,
            search_type: Some(search::SearchEventType::UI),
            search_event_context: None,
            regions: Vec::new(),
            clusters: Vec::new(),
        };
        let trace = config::ider::generate_trace_id();
        let super_cluster = o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled;
        let response = promql_service::search::search(
            &trace,
            self.org,
            &req,
            self.user,
            self.timeout_secs,
            super_cluster,
        )
        .await?;
        anyhow::ensure!(
            response.warnings.is_empty(),
            "partial context metrics result"
        );
        Ok(response.value)
    }
}

pub(super) async fn capture(org: &str, user: &str, source: &ContextSource) -> ResultSummary {
    let target = &source.target;
    let runner = QueryRunner {
        org,
        user,
        target,
        timeout_secs: CAPTURE_TIMEOUT.as_secs() as i64,
    };
    let window = (target.start_us, target.end_us);
    if let Some(query) = &target.promql {
        return capture_within(
            async {
                let samples = runner.promql(query, window).await?;
                Ok(summarize_metrics(&samples, window))
            },
            CAPTURE_TIMEOUT,
        )
        .await;
    }
    let deadline = Instant::now() + CAPTURE_TIMEOUT;
    bounded_summary(capture_sql_summary(&runner, window, deadline).await)
}

pub(super) async fn onset(org: &str, user: &str, source: &ContextSource) -> Option<i64> {
    let target = &source.target;
    let end = target.start_us - target.start_us.rem_euclid(MINUTE_US);
    let start = end.saturating_sub(LOOKBACK_US);
    if start < 0 {
        return None;
    }
    let window = (start, end);
    let runner = QueryRunner {
        org,
        user,
        target,
        timeout_secs: CAPTURE_TIMEOUT.as_secs() as i64,
    };
    let result = tokio::time::timeout(CAPTURE_TIMEOUT, onset_series(&runner, window)).await;
    match result {
        Ok(Ok(series)) => incident_fields::impact_onset(&series.buckets, series.direction),
        Ok(Err(error)) => {
            log::warn!("[incident declare] {org}: could not measure onset: {error}");
            None
        }
        Err(_) => {
            log::warn!("[incident declare] {org}: onset query timed out");
            None
        }
    }
}

pub(super) fn filter_sql(streams: &[String], filter: &str) -> Result<String, String> {
    let [stream] = streams else {
        return Err("Filter source requires exactly one stream".to_string());
    };
    validate_optional_where_fragment(filter)?;
    let mut sql = format!("SELECT * FROM {}", quote_identifier(stream));
    if !filter.is_empty() {
        sql.push_str(&format!(" WHERE ({filter})"));
    }
    Ok(sql)
}

fn capture_sql(target: &ContextTarget) -> anyhow::Result<(String, String)> {
    if let (StreamType::Traces, Some(filter), [stream]) = (
        target.stream_type(),
        target.filter.as_deref(),
        target.streams.as_slice(),
    ) {
        let mut sql = build_trace_query(stream, "count(*) AS span_count");
        if !filter.is_empty() {
            sql.push_str(&format!(" WHERE ({filter})"));
        }
        sql.push_str(" GROUP BY trace_id ORDER BY zo_sql_timestamp DESC");
        return Ok((sql, "zo_sql_timestamp".to_owned()));
    }
    let sql = source_sql(target)?;
    let timestamp = capture_statement(&sql)
        .and_then(|query| {
            let SetExpr::Select(select) = *query.body else {
                return None;
            };
            select.projection.iter().find_map(timestamp_projection)
        })
        .unwrap_or_else(|| TIMESTAMP_COL_NAME.to_owned());
    Ok((sql, timestamp))
}

fn source_sql(target: &ContextTarget) -> anyhow::Result<String> {
    if let Some(sql) = &target.sql {
        return Ok(sql.clone());
    }
    let filter = target
        .filter
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Source has no query"))?;
    filter_sql(&target.streams, filter).map_err(anyhow::Error::msg)
}

async fn capture_within(
    capture: impl Future<Output = anyhow::Result<ResultSummary>>,
    timeout: Duration,
) -> ResultSummary {
    match tokio::time::timeout(timeout, capture).await {
        Ok(result) => bounded_summary(result),
        Err(_) => uncaptured(),
    }
}

fn bounded_summary(result: anyhow::Result<ResultSummary>) -> ResultSummary {
    let mut summary = match result {
        Ok(summary) => summary,
        Err(error) => {
            log::warn!("[incident declare] could not capture query summary: {error}");
            return uncaptured();
        }
    };
    loop {
        let Ok(bytes) = serde_json::to_vec(&summary) else {
            return uncaptured();
        };
        if bytes.len() <= SUMMARY_MAX_BYTES {
            return summary;
        }
        if summary.sample.pop().is_none() && summary.columns.pop().is_none() {
            return uncaptured();
        }
    }
}

fn uncaptured() -> ResultSummary {
    ResultSummary {
        message: Some("Summary not captured".to_string()),
        ..Default::default()
    }
}

fn range_limited_sql_streams(
    org: &str,
    sql: &str,
    stream_type: StreamType,
) -> anyhow::Result<Vec<TypedStream>> {
    Ok(resolve_sql_tables(sql)?
        .into_iter()
        .map(|table| TypedStream {
            org_id: org.to_string(),
            stream_type: table.get_stream_type(stream_type),
            name: table.stream_name(),
        })
        .filter(|stream| stream.stream_type != StreamType::EnrichmentTables)
        .collect())
}

fn enforce_query_window(
    window: (i64, i64),
    stream: &TypedStream,
    max_hours: i64,
) -> anyhow::Result<()> {
    // A clamped result would describe a different window from the persisted evidence.
    anyhow::ensure!(
        clamp_start_time(window.0, window.1, max_hours).is_none(),
        "context window exceeds the {max_hours}-hour query range for {}/{}",
        stream.stream_type,
        stream.name,
    );
    Ok(())
}

async fn capture_sql_summary(
    runner: &QueryRunner<'_>,
    window: (i64, i64),
    deadline: Instant,
) -> anyhow::Result<ResultSummary> {
    let (sql, timestamp) = capture_sql(runner.target)?;
    let function = runner.target.function.clone();
    let response =
        tokio::time::timeout_at(deadline, runner.sql(sql.clone(), window, function)).await??;
    let mut summary = summarize_sql(response, &timestamp, window);
    if summary.rows > 0
        && summary.buckets.is_empty()
        && runner.target.function.is_none()
        && let Some(sql) = capture_bucket_query(&sql, window)
    {
        let result = tokio::time::timeout_at(deadline, runner.sql(sql, window, None)).await;
        match result {
            Ok(Ok(response)) => summary.buckets = bucket_query_rows(response),
            Ok(Err(error)) => log::warn!("[incident declare] could not capture buckets: {error}"),
            Err(_) => log::warn!("[incident declare] bucket query timed out"),
        }
    }
    Ok(summary)
}

fn capture_statement(sql: &str) -> Option<Box<sqlparser::ast::Query>> {
    let rewritten = replace_o2_custom_patterns(sql).unwrap_or_else(|_| sql.to_string());
    let statements = Parser::parse_sql(&PostgreSqlDialect {}, &rewritten).ok()?;
    let [Statement::Query(query)] = statements.as_slice() else {
        return None;
    };
    Some(query.clone())
}

fn capture_bucket_query(sql: &str, window: (i64, i64)) -> Option<String> {
    let query = capture_statement(sql)?;
    let SetExpr::Select(select) = query.body.as_ref() else {
        return None;
    };
    let [source] = select.from.as_slice() else {
        return None;
    };
    if select.distinct.is_some()
        || ((query.fetch.is_some() || query.limit_clause.is_some())
            && !incident_fields::has_grouped_projection(select))
    {
        return None;
    }

    let timestamp = match &source.relation {
        TableFactor::Table { name, alias, .. } if !source.joins.is_empty() => {
            let name = alias.as_ref().map(|alias| &alias.name).or_else(|| {
                name.0
                    .last()
                    .and_then(sqlparser::ast::ObjectNamePart::as_ident)
            })?;
            format!("{name}.{TIMESTAMP_COL_NAME}")
        }
        TableFactor::Table { .. } | TableFactor::Derived { .. } if source.joins.is_empty() => {
            TIMESTAMP_COL_NAME.to_owned()
        }
        _ => return None,
    };
    let (start, end) = window;
    let width = bucket_width_minutes(window);
    let interval = width * MINUTE_US;
    let prefix = query
        .with
        .as_ref()
        .map_or_else(String::new, |with| format!("{with} "));
    let mut sql = format!(
        "{prefix}SELECT (({timestamp} - {start}) / {interval}) * {width} AS {BUCKET_OFFSET}, \
         count(*) AS {BUCKET_COUNT} FROM {source} \
         WHERE {timestamp} >= {start} AND {timestamp} < {end}"
    );
    if let Some(filter) = &select.selection {
        sql.push_str(&format!(" AND ({filter})"));
    }
    sql.push_str(&format!(
        " GROUP BY {BUCKET_OFFSET} ORDER BY {BUCKET_OFFSET}"
    ));
    Some(sql)
}

fn bucket_query_rows(response: search::Response) -> Vec<(u32, u64)> {
    response
        .hits
        .iter()
        .filter_map(|row| {
            let minute = row.get(BUCKET_OFFSET)?.as_u64()?.try_into().ok()?;
            let count = row.get(BUCKET_COUNT)?.as_u64()?;
            Some((minute, count))
        })
        .take(SUMMARY_MAX_BUCKETS as usize)
        .collect()
}

fn timestamp_projection(item: &SelectItem) -> Option<String> {
    match item {
        SelectItem::Wildcard(_) | SelectItem::QualifiedWildcard(..) => {
            Some(TIMESTAMP_COL_NAME.to_string())
        }
        SelectItem::UnnamedExpr(Expr::Identifier(id))
            if id.value.eq_ignore_ascii_case(TIMESTAMP_COL_NAME) =>
        {
            Some(id.value.clone())
        }
        SelectItem::ExprWithAlias { expr, alias } if is_timestamp_expr(expr) => {
            Some(alias.value.clone())
        }
        _ => None,
    }
}

fn is_timestamp_expr(expr: &Expr) -> bool {
    match expr {
        Expr::Identifier(id) => id.value.eq_ignore_ascii_case(TIMESTAMP_COL_NAME),
        Expr::CompoundIdentifier(ids) => ids
            .last()
            .is_some_and(|id| id.value.eq_ignore_ascii_case(TIMESTAMP_COL_NAME)),
        Expr::Function(f) => matches!(
            f.name.to_string().to_lowercase().as_str(),
            "histogram" | "date_bin" | "date_trunc" | "time_bucket"
        ),
        _ => false,
    }
}

fn summarize_sql(
    mut result: search::Response,
    timestamp: &str,
    window: (i64, i64),
) -> ResultSummary {
    let buckets = count_buckets(
        result.hits.iter().filter_map(|row| {
            let time = row.get(timestamp)?;
            time.as_i64().or_else(|| {
                time.as_str()
                    .and_then(config::utils::time::parse_str_to_timestamp_micros_as_option)
            })
        }),
        window,
    );
    if result.columns.is_empty() {
        let columns = result
            .hits
            .iter()
            .filter_map(Value::as_object)
            .flat_map(|row| row.keys());
        result.columns = columns
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
    }
    let rows = result.hits.len();
    let sample = result.hits.into_iter().take(SUMMARY_MAX_SAMPLES).collect();
    ResultSummary {
        rows,
        columns: result.columns,
        sample,
        buckets,
        ..Default::default()
    }
}

fn summarize_metrics(samples: &[Sample], window: (i64, i64)) -> ResultSummary {
    let finite = || samples.iter().filter(|sample| sample.value.is_finite());
    let series = finite()
        .max_by_key(|sample| sample.timestamp)
        .map(|last| SummarySeries {
            min: finite()
                .map(|sample| sample.value)
                .fold(f64::INFINITY, f64::min),
            max: finite()
                .map(|sample| sample.value)
                .fold(f64::NEG_INFINITY, f64::max),
            last: last.value,
        });
    ResultSummary {
        rows: samples.len(),
        series,
        buckets: count_buckets(samples.iter().map(|sample| sample.timestamp), window),
        ..Default::default()
    }
}

fn metric_samples(value: MetricValue, start: i64) -> Vec<Sample> {
    match value {
        MetricValue::Matrix(matrix) => matrix
            .into_iter()
            .flat_map(|series| series.samples)
            .collect(),
        MetricValue::Range(range) => range.samples,
        MetricValue::Vector(vector) => vector.into_iter().map(|series| series.sample).collect(),
        MetricValue::Instant(instant) => vec![instant.sample],
        MetricValue::Sample(sample) => vec![sample],
        MetricValue::Float(value) => vec![Sample {
            timestamp: start,
            value,
        }],
        MetricValue::String(_) | MetricValue::None => Vec::new(),
    }
}

fn count_buckets(
    timestamps: impl IntoIterator<Item = i64>,
    (start, end): (i64, i64),
) -> Vec<(u32, u64)> {
    let width = bucket_width_minutes((start, end));
    let mut counts = BTreeMap::new();
    for at in timestamps {
        if (start..end).contains(&at) {
            let minute = (at - start) / MINUTE_US;
            let offset = minute - minute.rem_euclid(width);
            if let Ok(offset) = u32::try_from(offset) {
                *counts.entry(offset).or_insert(0) += 1;
            }
        }
    }
    counts.into_iter().collect()
}

fn bucket_width_minutes((start, end): (i64, i64)) -> i64 {
    let minutes = ceil_div(end.saturating_sub(start), MINUTE_US);
    ceil_div(minutes, SUMMARY_MAX_BUCKETS).max(1)
}

fn ceil_div(number: i64, divisor: i64) -> i64 {
    number.div_euclid(divisor) + i64::from(number.rem_euclid(divisor) > 0)
}

pub(in crate::alerts::incidents) fn onset_measurement(
    target: &ContextTarget,
) -> anyhow::Result<QueryMeasurement> {
    if target.function.is_some() {
        return Ok(QueryMeasurement::Unsupported);
    }
    Ok(match &target.promql {
        Some(query) => incident_fields::classify_measurement(query, MeasurementLanguage::Promql),
        None => {
            incident_fields::classify_measurement(&source_sql(target)?, MeasurementLanguage::Sql)
        }
    })
}

async fn onset_series(runner: &QueryRunner<'_>, window: (i64, i64)) -> anyhow::Result<OnsetSeries> {
    let measurement = onset_measurement(runner.target)?;
    let (buckets, direction, missing) = match measurement {
        QueryMeasurement::SqlRatio {
            numerator,
            denominator,
        } => {
            let series = ratio_buckets(runner, numerator, denominator, window).await?;
            (series, OnsetDirection::Up, f64::NAN)
        }
        QueryMeasurement::SqlValue {
            value, direction, ..
        } => {
            let series = sql_buckets(runner, value, window, direction).await?;
            (series, direction, f64::NAN)
        }
        QueryMeasurement::SqlRate { rate, .. } => {
            let direction = OnsetDirection::Up;
            let series = sql_buckets(runner, rate, window, direction).await?;
            (series, direction, 0.0)
        }
        QueryMeasurement::PromqlValue { query, direction } => {
            let result = runner.promql(&query, window).await?;
            let mut series = BTreeMap::new();
            for sample in result {
                if sample.value.is_finite() {
                    record_extreme(&mut series, sample.timestamp, sample.value, direction);
                }
            }
            (series, direction, f64::NAN)
        }
        QueryMeasurement::Unsupported => {
            return Ok(OnsetSeries {
                buckets: Vec::new(),
                direction: OnsetDirection::Up,
            });
        }
    };
    let buckets = buckets.into_iter().collect::<Vec<_>>();
    Ok(OnsetSeries {
        buckets: incident_fields::fill_steps(&buckets, window.0, window.1, MINUTE_US, missing),
        direction,
    })
}

async fn ratio_buckets(
    runner: &QueryRunner<'_>,
    numerator: String,
    denominator: String,
    window: (i64, i64),
) -> anyhow::Result<BTreeMap<i64, f64>> {
    let direction = OnsetDirection::Up;
    let (bad, total) = tokio::try_join!(
        sql_buckets(runner, numerator, window, direction),
        sql_buckets(runner, denominator, window, direction),
    )?;
    Ok(total
        .into_iter()
        .filter(|(_, n)| *n > 0.0)
        .map(|(at, n)| (at, 100.0 * bad.get(&at).copied().unwrap_or_default() / n))
        .collect())
}

async fn sql_buckets(
    runner: &QueryRunner<'_>,
    sql: String,
    window: (i64, i64),
    direction: OnsetDirection,
) -> anyhow::Result<BTreeMap<i64, f64>> {
    let response = runner.sql(sql, window, None).await?;
    let mut buckets = BTreeMap::new();
    for hit in response.hits {
        let (Some(at), Some(value)) = (
            hit.get("zo_onset_at").and_then(Value::as_i64),
            hit.get("zo_onset_value").and_then(Value::as_f64),
        ) else {
            continue;
        };
        record_extreme(&mut buckets, at, value, direction);
    }
    Ok(buckets)
}

pub(in crate::alerts::incidents) fn record_extreme(
    buckets: &mut BTreeMap<i64, f64>,
    at: i64,
    value: f64,
    direction: OnsetDirection,
) {
    let minute = at - at.rem_euclid(MINUTE_US);
    let stored = buckets.entry(minute).or_insert(value);
    *stored = match direction {
        OnsetDirection::Up => stored.max(value),
        OnsetDirection::Down => stored.min(value),
    };
}

#[cfg(test)]
mod tests {
    use datafusion::prelude::SessionContext;

    use super::*;

    #[test]
    fn declare_capture_checks_effective_policies_on_the_resolved_stream_types() {
        let streams = range_limited_sql_streams(
            "acme",
            r#"SELECT * FROM "logs"."requests"
               JOIN "traces"."backend" ON requests.id = backend.id
               JOIN "enrichment_tables"."codes" ON requests.code = codes.code"#,
            StreamType::Logs,
        )
        .unwrap();
        let logs = streams
            .iter()
            .find(|stream| stream.name == "requests")
            .unwrap();
        let traces = streams
            .iter()
            .find(|stream| stream.name == "backend")
            .unwrap();
        assert_eq!(logs.stream_type, StreamType::Logs);
        assert_eq!(traces.stream_type, StreamType::Traces);

        let window = (0, 3 * LOOKBACK_US);
        assert!(enforce_query_window(window, logs, 6).is_ok());
        assert!(enforce_query_window(window, traces, 2).is_err());
        assert_eq!(streams.len(), 2);
        assert!(!streams.iter().any(|stream| stream.name == "codes"));
    }

    #[test]
    fn declare_onset_rejects_pre_transform_measurements() {
        let mut target: ContextTarget = serde_json::from_value(serde_json::json!({
            "signal": "logs",
            "sql": "SELECT count(*) FROM logs WHERE status_code >= 500",
            "start_us": LOOKBACK_US,
            "end_us": 2 * LOOKBACK_US,
        }))
        .unwrap();
        assert!(matches!(
            onset_measurement(&target).unwrap(),
            QueryMeasurement::SqlRatio { .. }
        ));
        target.function = Some(".status_code = 200".to_string());
        assert_eq!(
            onset_measurement(&target).unwrap(),
            QueryMeasurement::Unsupported
        );
    }

    #[tokio::test]
    async fn declare_capture_preserves_aggregate_results_and_counts_their_source_by_minute() {
        let window = (1_800_000_000_000_000_i64, 1_800_000_180_000_000_i64);
        let ctx = SessionContext::new();
        ctx.sql(&format!(
            "CREATE VIEW logs AS SELECT {} + x * 30000000 AS _timestamp, CASE WHEN x % 2 = 0 THEN 'prod' ELSE 'dev' END AS env FROM range(6) AS t(x)",
            window.0,
        ))
        .await
        .unwrap()
        .collect()
        .await
        .unwrap();
        let target: ContextTarget = serde_json::from_value(serde_json::json!({
            "signal": "logs",
            "sql": "SELECT count(*) AS errors FROM logs WHERE env = 'prod'",
            "start_us": window.0,
            "end_us": window.1,
        }))
        .unwrap();
        let (sample_sql, timestamp) = capture_sql(&target).unwrap();
        assert_eq!(sample_sql, target.sql.as_deref().unwrap());
        let mut summary =
            summarize_sql(query_response(&ctx, &sample_sql).await, &timestamp, window);
        assert_eq!(summary.rows, 1);
        assert!(summary.buckets.is_empty());
        assert_eq!(summary.sample, [serde_json::json!({"errors":3})]);

        let buckets_sql = capture_bucket_query(&sample_sql, window).unwrap();
        summary.buckets = bucket_query_rows(query_response(&ctx, &buckets_sql).await);
        assert_eq!(summary.buckets, [(0, 1), (1, 1), (2, 1)]);
        assert_eq!(summary.sample, [serde_json::json!({"errors":3})]);
    }

    #[tokio::test]
    async fn declare_capture_buckets_a_limited_aggregate_with_a_join_and_cte() {
        let start = 1_800_000_000_000_000_i64;
        let window = (start, start + 3 * MINUTE_US);
        let ctx = SessionContext::new();
        let sql = format!(
            "WITH logs AS (SELECT x AS id, {start} + x * {MINUTE_US} AS _timestamp FROM range(3) AS t(x)), \
             matched_rows AS (SELECT x AS id, {start} AS _timestamp FROM range(1, 3) AS t(x)) \
             SELECT count(*) AS total FROM logs l JOIN matched_rows m ON l.id = m.id LIMIT 1"
        );
        let summary = summarize_sql(query_response(&ctx, &sql).await, "_timestamp", window);
        assert_eq!(summary.sample, [serde_json::json!({"total": 2})]);

        let bucket_sql = capture_bucket_query(&sql, window).unwrap();
        assert_eq!(
            bucket_query_rows(query_response(&ctx, &bucket_sql).await),
            [(1, 1), (2, 1)]
        );
    }

    #[test]
    fn declare_capture_does_not_drop_limits_from_non_grouped_projections() {
        let window = (LOOKBACK_US, 2 * LOOKBACK_US);
        for sql in [
            "SELECT sum(duration) OVER () AS total FROM logs LIMIT 1",
            "SELECT (SELECT count(*) FROM metrics) AS total FROM logs LIMIT 1",
        ] {
            assert!(capture_bucket_query(sql, window).is_none(), "{sql}");
        }
    }

    async fn query_response(ctx: &SessionContext, sql: &str) -> search::Response {
        let batches = ctx.sql(sql).await.unwrap().collect().await.unwrap();
        let hits =
            config::utils::arrow::record_batches_to_json_rows(&batches.iter().collect::<Vec<_>>())
                .unwrap()
                .into_iter()
                .map(Value::Object)
                .collect();
        search::Response {
            hits,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn declare_capture_bounds_a_query_result_and_drops_samples_first() {
        let start = 1_800_000_000_000_000_i64;
        let end = start + 240 * MINUTE_US;
        let sql = format!(
            "SELECT {start} + x * {MINUTE_US} AS _timestamp, repeat('x', 5000) AS message \
             FROM range(240) AS t(x) ORDER BY x"
        );
        let ctx = SessionContext::new();
        let summary = capture_within(
            async {
                let result = query_response(&ctx, &sql).await;
                Ok(summarize_sql(result, "_timestamp", (start, end)))
            },
            CAPTURE_TIMEOUT,
        )
        .await;

        assert_eq!(summary.rows, 240);
        assert_eq!(summary.columns, ["_timestamp", "message"]);
        assert_eq!(summary.buckets.len(), 120);
        assert_eq!(summary.buckets[0], (0, 2));
        assert_eq!(summary.buckets[119], (238, 2));
        assert!(summary.sample.is_empty());
        assert!(serde_json::to_vec(&summary).unwrap().len() <= SUMMARY_MAX_BYTES);
    }

    #[tokio::test(start_paused = true)]
    async fn declare_capture_times_out_with_the_stored_message() {
        let started = tokio::time::Instant::now();
        let summary = capture_within(std::future::pending(), CAPTURE_TIMEOUT).await;

        assert_eq!(started.elapsed(), Duration::from_secs(10));
        assert_eq!(summary.message.as_deref(), Some("Summary not captured"));
    }
}
