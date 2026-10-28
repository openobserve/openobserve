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
    collections::{BTreeSet, HashMap, HashSet},
    ops::ControlFlow,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use config::meta::{
    histogram_origin::divides_histogram_origin,
    search::{Request, Response, SearchPartitionRequest, SearchPartitionResponse},
    stream::StreamType,
};
use o2_enterprise::enterprise::anomaly_detection::types::QueryDataPoint;
use search::sql::visitor::histogram_interval::validate_and_adjust_histogram_interval;
use sqlparser::{
    ast::{
        BinaryOperator, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, GroupByExpr,
        ObjectNamePart, Query, Select, SelectFlavor, SelectItem, SetExpr, Statement, TableFactor,
        Value, visit_expressions,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
};

use super::{LEGACY_VALUE_COLUMNS, TIMESTAMP_COLUMNS};

/// The filter builder's bucket and metric aliases; custom SQL names its own.
const BUCKET_COLUMN: &str = "time_bucket";
const VALUE_COLUMN: &str = "value";

const FILTER_AGGREGATES: [&str; 4] = ["avg", "sum", "min", "max"];

/// The literal quantiles the filter builder emits for p50, p95 and p99.
const GENERATED_QUANTILES: [&str; 3] = ["0.5", "0.95", "0.99"];

/// Field-and-literal predicate functions the filter builder emits.
const FILTER_PREDICATE_FUNCTIONS: [&str; 4] = [
    "str_match",
    "str_match_ignore_case",
    "re_match",
    "re_not_match",
];

/// Functions bound at query execution time, so each partition search would see its own value.
const VOLATILE_FUNCTIONS: [&str; 11] = [
    "now",
    "current_timestamp",
    "current_date",
    "current_time",
    "localtime",
    "localtimestamp",
    "today",
    "random",
    "rand",
    "uuid",
    "gen_random_uuid",
];

/// Functions that turn one bucket into several rows, which the slice reader rejects as duplicates.
const ROW_EXPANDING_FUNCTIONS: [&str; 1] = ["unnest"];

/// An unchanged fallback reason is logged once per config per interval, not on every tick.
const FALLBACK_LOG_INTERVAL: Duration = Duration::from_secs(3600);

static FALLBACK_LOGGED: LazyLock<Mutex<FallbackLog>> = LazyLock::new(|| Mutex::new(HashMap::new()));

type FallbackLog = HashMap<(String, String), (String, Instant)>;

/// The config facts eligibility reads, cached under one TTL.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct QueryMetadata {
    pub(super) query_mode: String,
    pub(super) stream_name: String,
    pub(super) stream_type: String,
    pub(super) histogram_interval: String,
    pub(super) value_column: Option<String>,
}

impl QueryMetadata {
    pub(super) fn from_model(
        model: &infra::table::entity::anomaly_detection_config::Model,
    ) -> Self {
        Self {
            query_mode: model.query_mode.clone(),
            stream_name: model.stream_name.clone(),
            stream_type: model.stream_type.clone(),
            histogram_interval: model.histogram_interval.clone(),
            value_column: super::declared_value_column(
                &model.query_mode,
                &model.detection_function,
            ),
        }
    }
}

/// A histogram width proven equal in the SQL literal, the planner metadata and the config.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct BucketGrid {
    interval_secs: i64,
    interval_us: i64,
}

/// The two result columns a supported query's rows are read from, by name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ResultColumns {
    bucket: String,
    value: String,
}

impl ResultColumns {
    fn generated() -> Self {
        Self {
            bucket: BUCKET_COLUMN.to_string(),
            value: VALUE_COLUMN.to_string(),
        }
    }
}

/// A query proven safe to search one bucket-aligned partition at a time, and how to read it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SupportedQuery {
    pub(super) grid: BucketGrid,
    pub(super) columns: ResultColumns,
}

/// The histogram item of a custom projection: its position, alias, call and interval literal.
struct CustomBucket<'a> {
    position: usize,
    alias: String,
    expr: &'a Expr,
    literal: &'a str,
}

/// One supported invocation: its identity, window, proven grid and per-search row budget.
struct SupportedRun<'a> {
    anomaly_id: &'a str,
    trace_id: &'a str,
    window: (i64, i64),
    grid: BucketGrid,
    columns: ResultColumns,
    budget: usize,
    size: i32,
}

impl<'a> SupportedRun<'a> {
    fn new(
        anomaly_id: &'a str,
        trace_id: &'a str,
        window: (i64, i64),
        query: SupportedQuery,
    ) -> Result<Self> {
        let SupportedQuery { grid, columns } = query;
        let context = || format!("[anomaly_detection {anomaly_id}] trace_id {trace_id}");
        let budget = bucket_budget(window.0, window.1, grid.interval_us).with_context(context)?;
        // The cluster request carries `size` as i32, so a larger budget would wrap on the wire.
        let size = i32::try_from(budget)
            .with_context(|| format!("{budget}-row budget exceeds the search size limit"))
            .with_context(context)?;
        Ok(Self {
            anomaly_id,
            trace_id,
            window,
            grid,
            columns,
            budget,
            size,
        })
    }

    fn search_request(&self, query_sql: &str) -> Request {
        let mut req = super::anomaly_search_request(
            query_sql,
            self.window.0,
            self.window.1,
            i64::from(self.size),
        );
        req.query.histogram_interval = self.grid.interval_secs;
        req
    }

    async fn execute<S: SliceSearch>(
        &self,
        engine: &S,
        query_sql: &str,
    ) -> Result<Vec<QueryDataPoint>> {
        let started = Instant::now();
        let req = self.search_request(query_sql);
        let slices = self.planned_slices(engine, &req).await?;
        self.search_slices(engine, &req, &slices, started).await
    }

    async fn planned_slices<S: SliceSearch>(
        &self,
        engine: &S,
        req: &Request,
    ) -> Result<Vec<[i64; 2]>> {
        let plan_req = SearchPartitionRequest::from(req);
        let plan = engine.plan(self.trace_id, &plan_req).await.map_err(|e| {
            anyhow::anyhow!(
                "[anomaly_detection {}] partition planning failed (trace_id {}): {e}",
                self.anomaly_id,
                self.trace_id
            )
        })?;
        let slices = validated_plan(&plan, self.window, self.grid).map_err(|e| {
            anyhow::anyhow!(
                "[anomaly_detection {}] partition plan rejected before any search (trace_id {}): {e}",
                self.anomaly_id,
                self.trace_id
            )
        })?;
        log::info!(
            "[anomaly_detection {}] partitioned search: trace_id {}, window [{}, {}), {} planned \
             partitions, planner file_num estimate {}, planner original_size estimate {} bytes",
            self.anomaly_id,
            self.trace_id,
            self.window.0,
            self.window.1,
            slices.len(),
            plan.file_num,
            plan.original_size
        );
        Ok(slices)
    }

    /// Awaits each search before the next starts; any failed slice fails the run, never a prefix.
    async fn search_slices<S: SliceSearch>(
        &self,
        engine: &S,
        req: &Request,
        slices: &[[i64; 2]],
        started: Instant,
    ) -> Result<Vec<QueryDataPoint>> {
        let mut series = SeriesAccumulator::default();
        for (idx, &slice) in slices.iter().enumerate() {
            let child_trace_id = if slices.len() > 1 {
                format!("{}-{idx}", self.trace_id)
            } else {
                self.trace_id.to_string()
            };
            let mut slice_req = req.clone();
            slice_req.query.start_time = slice[0];
            slice_req.query.end_time = slice[1];
            let response = engine
                .search(&child_trace_id, &slice_req)
                .await
                .map_err(|e| self.slice_error(&child_trace_id, slice, "search failed", e))?;
            series
                .add_slice(
                    &response,
                    slice,
                    self.grid.interval_us,
                    self.budget,
                    &self.columns,
                )
                .map_err(|e| self.slice_error(&child_trace_id, slice, "result rejected", e))?;
        }
        let (raw_hits, omitted_nulls) = (series.raw_hits, series.omitted_nulls);
        let points = series
            .finish(self.budget, &self.columns.value)
            .map_err(|e| anyhow::anyhow!("[anomaly_detection {}] {e}", self.anomaly_id))?;
        log::info!(
            "[anomaly_detection {}] supported search done: trace_id {}, executed {} searches, raw \
             hits {raw_hits}, omitted NULL values {omitted_nulls}, returned points {}, took {} ms",
            self.anomaly_id,
            self.trace_id,
            slices.len(),
            points.len(),
            started.elapsed().as_millis()
        );
        Ok(points)
    }

    fn slice_error(
        &self,
        child_trace_id: &str,
        slice: [i64; 2],
        what: &str,
        e: anyhow::Error,
    ) -> anyhow::Error {
        anyhow::anyhow!(
            "[anomaly_detection {}] {what} for partition [{}, {}) (trace_id {child_trace_id}): {e}",
            self.anomaly_id,
            slice[0],
            slice[1]
        )
    }
}

/// Parsed points plus every raw bucket timestamp, so NULL rows count toward duplicates and budget.
#[derive(Default)]
struct SeriesAccumulator {
    points: Vec<QueryDataPoint>,
    raw_buckets: HashSet<i64>,
    raw_hits: usize,
    omitted_nulls: usize,
    keys_seen: BTreeSet<String>,
}

impl SeriesAccumulator {
    fn add_slice(
        &mut self,
        response: &Response,
        slice: [i64; 2],
        interval_us: i64,
        budget: usize,
        columns: &ResultColumns,
    ) -> Result<()> {
        if response.is_partial {
            if response.function_error.is_empty() {
                anyhow::bail!("search returned partial results");
            }
            anyhow::bail!(
                "search returned partial results: {}",
                response.function_error.join("; ")
            );
        }
        let raw = response.hits.len();
        if raw >= budget {
            anyhow::bail!(
                "{raw} rows reached the {budget}-row budget, so the result may be truncated"
            );
        }
        self.raw_hits = self
            .raw_hits
            .checked_add(raw)
            .context("raw row count overflows")?;
        if raw == 0 {
            return Ok(());
        }
        response.hits.iter().try_for_each(|hit| {
            let Some(row) = hit.as_object() else {
                anyhow::bail!("row is not an object: {hit}");
            };
            self.note_keys(row);
            self.add_row(hit, row, columns, slice, interval_us)
        })
    }

    fn add_row(
        &mut self,
        hit: &serde_json::Value,
        row: &serde_json::Map<String, serde_json::Value>,
        columns: &ResultColumns,
        slice: [i64; 2],
        interval_us: i64,
    ) -> Result<()> {
        let bucket = row
            .get(&columns.bucket)
            .and_then(super::timestamp_from_value)
            .with_context(|| format!("row has no usable '{}': {hit}", columns.bucket))?;
        if bucket.rem_euclid(interval_us) != 0 {
            anyhow::bail!("bucket {bucket} is off the {interval_us}us grid");
        }
        if !bucket_intersects(bucket, interval_us, slice) {
            anyhow::bail!("bucket {bucket} lies outside the partition");
        }
        if !self.raw_buckets.insert(bucket) {
            anyhow::bail!("bucket {bucket} was returned more than once");
        }
        // Object rows omit SQL NULL fields; a column absent from every row fails in finish.
        let Some(value_cell) = row.get(&columns.value).filter(|v| !v.is_null()) else {
            self.omitted_nulls += 1;
            return Ok(());
        };
        let value = super::json_value_as_f64(value_cell)
            .filter(|v| v.is_finite())
            .with_context(|| format!("'{}' is not a finite number: {hit}", columns.value))?;
        self.points.push(QueryDataPoint {
            timestamp_us: bucket,
            value,
        });
        Ok(())
    }

    /// Object rows drop NULL keys, so the diagnostic needs keys from every row, not one.
    fn note_keys(&mut self, row: &serde_json::Map<String, serde_json::Value>) {
        // Only an all-NULL run reports the keys, so collecting stops at the first usable point.
        if !self.points.is_empty() {
            return;
        }
        for key in row.keys() {
            if !self.keys_seen.contains(key) {
                self.keys_seen.insert(key.clone());
            }
        }
    }

    fn finish(mut self, budget: usize, value_column: &str) -> Result<Vec<QueryDataPoint>> {
        if self.raw_hits >= budget {
            anyhow::bail!(
                "{} rows across the run reached the {budget}-row budget, so the result may be \
                 truncated",
                self.raw_hits
            );
        }
        if self.raw_hits > 0 && self.points.is_empty() {
            anyhow::bail!(
                "query returned {} rows but none were usable: every '{value_column}' was SQL \
                 NULL, or the column is missing from the result (columns present: {:?})",
                self.raw_hits,
                self.keys_seen.iter().collect::<Vec<_>>()
            );
        }
        self.points.sort_by_key(|p| p.timestamp_us);
        Ok(self.points)
    }
}

/// The planner and search entry points, behind a private seam so the loop is testable.
trait SliceSearch {
    async fn plan(
        &self,
        trace_id: &str,
        req: &SearchPartitionRequest,
    ) -> Result<SearchPartitionResponse>;

    async fn search(&self, trace_id: &str, req: &Request) -> Result<Response>;
}

struct EngineSearch<'a> {
    org_id: &'a str,
    stream_type: StreamType,
}

impl SliceSearch for EngineSearch<'_> {
    async fn plan(
        &self,
        trace_id: &str,
        req: &SearchPartitionRequest,
    ) -> Result<SearchPartitionResponse> {
        // Skipping the range cap keeps today's direct search: no stream or role clamp applies.
        search_service::search_partition(
            trace_id,
            self.org_id,
            None,
            self.stream_type,
            req,
            true,
            false,
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn search(&self, trace_id: &str, req: &Request) -> Result<Response> {
        search_service::search(trace_id, self.org_id, self.stream_type, None, req)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }
}

/// The proven grid and columns of a supported query, or why it keeps the single-call path.
pub(super) fn supported_query(
    metadata: Option<&QueryMetadata>,
    query_sql: &str,
    stream_type: &str,
    window: (i64, i64),
    stream_fields: Option<&HashSet<String>>,
) -> Result<SupportedQuery, String> {
    let metadata = metadata.ok_or("eligibility metadata could not be loaded")?;
    if !metadata.stream_type.eq_ignore_ascii_case(stream_type) {
        return Err(format!(
            "executor stream type '{stream_type}' differs from the config's '{}'",
            metadata.stream_type
        ));
    }
    let statement = single_statement(query_sql)?;
    let (literal, columns) = if metadata.query_mode.eq_ignore_ascii_case("filters") {
        if let Some(column) = metadata
            .value_column
            .as_deref()
            .filter(|c| *c != VALUE_COLUMN)
        {
            return Err(format!(
                "declared value column '{column}' is not the generated '{VALUE_COLUMN}'"
            ));
        }
        check_filter_shape(&statement, &metadata.stream_name)?;
        let literal = statement_select(&statement)
            .and_then(histogram_literal)
            .ok_or("no histogram(_timestamp, '<interval>') AS time_bucket column")?;
        (literal, ResultColumns::generated())
    } else if metadata.query_mode.eq_ignore_ascii_case("custom_sql") {
        check_custom_shape(&statement, metadata, stream_fields)?
    } else {
        return Err(format!(
            "query mode '{}' is neither filters nor custom_sql",
            metadata.query_mode
        ));
    };
    let grid = proven_grid(literal, &metadata.histogram_interval, window)?;
    Ok(SupportedQuery { grid, columns })
}

/// Searches a supported query completely, one validated partition at a time.
pub(super) async fn execute_supported(
    org_id: &str,
    query_sql: &str,
    window: (i64, i64),
    anomaly_id: &str,
    stream_type: &str,
    trace_id: &str,
    query: SupportedQuery,
) -> Result<Vec<QueryDataPoint>> {
    let run = SupportedRun::new(anomaly_id, trace_id, window, query)?;
    let engine = EngineSearch {
        org_id,
        stream_type: StreamType::from(stream_type),
    };
    run.execute(&engine, query_sql).await
}

pub(super) fn log_fallback(org_id: &str, anomaly_id: &str, reason: &str) {
    let key = (org_id.to_string(), anomaly_id.to_string());
    let due = match FALLBACK_LOGGED.lock() {
        Ok(mut logged) => fallback_log_due(&mut logged, key, reason, Instant::now()),
        Err(_) => true,
    };
    if due {
        log::info!("[anomaly_detection {anomaly_id}] single-call search: {reason}");
    }
}

fn fallback_log_due(
    logged: &mut FallbackLog,
    key: (String, String),
    reason: &str,
    now: Instant,
) -> bool {
    if logged.get(&key).is_some_and(|(last, at)| {
        last == reason && now.saturating_duration_since(*at) < FALLBACK_LOG_INTERVAL
    }) {
        return false;
    }
    logged.insert(key, (reason.to_string(), now));
    true
}

fn single_statement(query_sql: &str) -> Result<Statement, String> {
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, query_sql)
        .map_err(|e| format!("SQL could not be parsed: {e}"))?;
    match (statements.pop(), statements.is_empty()) {
        (Some(statement), true) => Ok(statement),
        _ => Err("SQL is not exactly one statement".to_string()),
    }
}

fn statement_select(statement: &Statement) -> Option<&Select> {
    let Statement::Query(query) = statement else {
        return None;
    };
    match query.body.as_ref() {
        SetExpr::Select(select) => Some(select),
        _ => None,
    }
}

/// Holds filter-mode SQL to the builder's exact shape over validated pieces.
fn check_filter_shape(statement: &Statement, stream_name: &str) -> Result<(), String> {
    let select = statement_select(statement).ok_or("SQL is not a single SELECT")?;
    let [bucket, value] = select.projection.as_slice() else {
        return Err("SELECT is not exactly the bucket and value columns".to_string());
    };
    match value {
        SelectItem::ExprWithAlias { expr, alias }
            if alias.value == VALUE_COLUMN
                && alias.quote_style.is_none()
                && is_generated_aggregate(expr) => {}
        _ => return Err("value column is not a generated aggregate AS value".to_string()),
    }
    let [from] = select.from.as_slice() else {
        return Err("SQL does not read exactly one stream".to_string());
    };
    let TableFactor::Table { name, .. } = &from.relation else {
        return Err("SQL does not read an ordinary stream".to_string());
    };
    match name.0.as_slice() {
        [ObjectNamePart::Identifier(ident)] if ident.value == stream_name => {}
        _ => {
            return Err(format!(
                "SQL does not read the config's stream '{stream_name}'"
            ));
        }
    }
    if select
        .selection
        .as_ref()
        .is_some_and(|predicate| !is_generated_predicate(predicate))
    {
        return Err("WHERE is not a conjunction of generated filters".to_string());
    }
    let predicate = select
        .selection
        .as_ref()
        .map(|p| format!(" WHERE {p}"))
        .unwrap_or_default();
    let canonical = single_statement(&format!(
        "SELECT {bucket}, {value} FROM {name}{predicate} GROUP BY {BUCKET_COLUMN} ORDER BY \
         {BUCKET_COLUMN}"
    ))?;
    // Any clause the builder never emits survives in one rendering and not the other.
    if canonical.to_string() != statement.to_string() {
        return Err("SQL has clauses the filter builder does not generate".to_string());
    }
    Ok(())
}

/// Holds custom SQL to one SELECT whose every row is one bucket computed from that bucket's
/// rows alone, so bucket-aligned partitions return exactly the single-call rows.
fn check_custom_shape<'a>(
    statement: &'a Statement,
    metadata: &QueryMetadata,
    stream_fields: Option<&HashSet<String>>,
) -> Result<(&'a str, ResultColumns), String> {
    let Statement::Query(query) = statement else {
        return Err("SQL is not a SELECT query".to_string());
    };
    check_query_clauses(query)?;
    let SetExpr::Select(select) = query.body.as_ref() else {
        return Err("SQL is a set operation or VALUES, not one SELECT".to_string());
    };
    check_select_clauses(select)?;
    check_custom_source(select, &metadata.stream_name)?;
    check_row_local(statement)?;
    let bucket = custom_bucket(select)?;
    let names = projection_names(select);
    // The single-call reader takes the first timestamp-named column, so no other may exist.
    if let Some(name) = names
        .iter()
        .enumerate()
        .filter(|(position, _)| *position != bucket.position)
        .find_map(|(_, name)| name.filter(|n| TIMESTAMP_COLUMNS.contains(n)))
    {
        return Err(format!(
            "column '{name}' would be read as the timestamp instead of '{}'",
            bucket.alias
        ));
    }
    let value = custom_value_column(&names, metadata.value_column.as_deref())?;
    if value == bucket.alias {
        return Err(format!("value column '{value}' is the bucket column"));
    }
    check_custom_group_by(select, &bucket, stream_fields)?;
    Ok((
        bucket.literal,
        ResultColumns {
            bucket: bucket.alias,
            value,
        },
    ))
}

fn check_query_clauses(query: &Query) -> Result<(), String> {
    let clauses = [
        (query.with.is_some(), "WITH"),
        (query.limit_clause.is_some(), "LIMIT or OFFSET"),
        (query.fetch.is_some(), "FETCH"),
        (!query.locks.is_empty(), "FOR UPDATE or FOR SHARE"),
        (query.for_clause.is_some(), "FOR XML or FOR JSON"),
        (query.settings.is_some(), "SETTINGS"),
        (query.format_clause.is_some(), "FORMAT"),
        (!query.pipe_operators.is_empty(), "a pipe operator"),
    ];
    match clauses.iter().find(|(present, _)| *present) {
        Some((_, clause)) => Err(format!("SQL uses {clause}, which is not per bucket")),
        None => Ok(()),
    }
}

fn check_select_clauses(select: &Select) -> Result<(), String> {
    let clauses = [
        (select.distinct.is_some(), "DISTINCT"),
        (select.top.is_some(), "TOP"),
        (select.into.is_some(), "INTO"),
        (select.exclude.is_some(), "EXCLUDE"),
        (!select.lateral_views.is_empty(), "LATERAL VIEW"),
        (select.prewhere.is_some(), "PREWHERE"),
        (!select.connect_by.is_empty(), "CONNECT BY"),
        (!select.cluster_by.is_empty(), "CLUSTER BY"),
        (!select.distribute_by.is_empty(), "DISTRIBUTE BY"),
        (!select.sort_by.is_empty(), "SORT BY"),
        (!select.named_window.is_empty(), "WINDOW"),
        (select.qualify.is_some(), "QUALIFY"),
        (select.value_table_mode.is_some(), "AS STRUCT or AS VALUE"),
        (select.select_modifiers.is_some(), "a select modifier"),
        (!select.optimizer_hints.is_empty(), "an optimizer hint"),
        (select.flavor != SelectFlavor::Standard, "FROM-first syntax"),
    ];
    match clauses.iter().find(|(present, _)| *present) {
        Some((_, clause)) => Err(format!("SQL uses {clause}, which is not per bucket")),
        None => Ok(()),
    }
}

fn check_custom_source(select: &Select, stream_name: &str) -> Result<(), String> {
    let [from] = select.from.as_slice() else {
        return Err("SQL does not read exactly one stream".to_string());
    };
    if !from.joins.is_empty() {
        return Err("SQL joins another relation".to_string());
    }
    let TableFactor::Table {
        name,
        args,
        with_hints,
        version,
        with_ordinality,
        partitions,
        json_path,
        sample,
        index_hints,
        ..
    } = &from.relation
    else {
        return Err("SQL does not read an ordinary stream".to_string());
    };
    let modified = args.is_some()
        || !with_hints.is_empty()
        || version.is_some()
        || *with_ordinality
        || !partitions.is_empty()
        || json_path.is_some()
        || sample.is_some()
        || !index_hints.is_empty();
    if modified {
        return Err("stream reference carries arguments, hints, a version or a sample".to_string());
    }
    match name.0.as_slice() {
        [ObjectNamePart::Identifier(ident)] if ident.value == stream_name => Ok(()),
        _ => Err(format!(
            "SQL does not read the config's stream '{stream_name}'"
        )),
    }
}

/// Rejects expressions whose value depends on more than the bucket's own rows and the SQL text.
fn check_row_local(statement: &Statement) -> Result<(), String> {
    let walk = visit_expressions(statement, |expr| match expr {
        Expr::Subquery(_) | Expr::InSubquery { .. } | Expr::Exists { .. } => {
            ControlFlow::Break("SQL contains a subquery".to_string())
        }
        Expr::Function(function) if function.over.is_some() => {
            ControlFlow::Break("SQL contains a window function".to_string())
        }
        Expr::Function(function) => match function_name(&function.name) {
            Some(name) if VOLATILE_FUNCTIONS.contains(&name.as_str()) => {
                ControlFlow::Break(format!("SQL calls {name}(), bound at query time"))
            }
            Some(name) if ROW_EXPANDING_FUNCTIONS.contains(&name.as_str()) => ControlFlow::Break(
                format!("SQL calls {name}(), which expands a bucket into rows"),
            ),
            _ => ControlFlow::Continue(()),
        },
        _ => ControlFlow::Continue(()),
    });
    match walk {
        ControlFlow::Continue(()) => Ok(()),
        ControlFlow::Break(reason) => Err(reason),
    }
}

/// The lowercased last part of a function name, so `pg_catalog.now` and `NOW` read the same.
fn function_name(name: &sqlparser::ast::ObjectName) -> Option<String> {
    match name.0.last()? {
        ObjectNamePart::Identifier(ident) => Some(ident.value.to_ascii_lowercase()),
        _ => None,
    }
}

/// The one `histogram(_timestamp, '<lit>') AS <timestamp name>` item of a custom projection.
fn custom_bucket(select: &Select) -> Result<CustomBucket<'_>, String> {
    let mut found = None;
    for (position, item) in select.projection.iter().enumerate() {
        let (expr, alias) = match item {
            SelectItem::ExprWithAlias { expr, alias } => (expr, Some(alias)),
            SelectItem::UnnamedExpr(expr) => (expr, None),
            _ => return Err("SELECT uses a wildcard".to_string()),
        };
        let Some((name, args)) = plain_call(expr).filter(|(name, _)| name == "histogram") else {
            continue;
        };
        if found.is_some() {
            return Err("SELECT has more than one histogram column".to_string());
        }
        let literal = histogram_args(args).ok_or_else(|| {
            format!("{name}() is not histogram(_timestamp, '<interval>') with two arguments")
        })?;
        let alias = alias.ok_or("histogram column has no alias")?;
        if !TIMESTAMP_COLUMNS.contains(&alias.value.as_str()) {
            return Err(format!(
                "histogram alias '{}' is none of the timestamp names {}",
                alias.value,
                TIMESTAMP_COLUMNS.join(", ")
            ));
        }
        found = Some(CustomBucket {
            position,
            alias: alias.value.clone(),
            expr,
            literal,
        });
    }
    found.ok_or_else(|| "no histogram(_timestamp, '<interval>') column".to_string())
}

/// Each projection item's result column name, where a plain alias or identifier gives it.
fn projection_names(select: &Select) -> Vec<Option<&str>> {
    select
        .projection
        .iter()
        .map(|item| match item {
            SelectItem::ExprWithAlias { alias, .. } => Some(alias.value.as_str()),
            SelectItem::UnnamedExpr(Expr::Identifier(ident)) => Some(ident.value.as_str()),
            SelectItem::UnnamedExpr(Expr::CompoundIdentifier(parts)) => {
                parts.last().map(|part| part.value.as_str())
            }
            _ => None,
        })
        .collect()
}

/// The declared value column, else the one legacy name present; two legacy names stay single-call.
fn custom_value_column(names: &[Option<&str>], declared: Option<&str>) -> Result<String, String> {
    let present = |column: &str| names.contains(&Some(column));
    if let Some(column) = declared.map(str::trim).filter(|c| !c.is_empty()) {
        return if present(column) {
            Ok(column.to_string())
        } else {
            Err(format!(
                "declared value column '{column}' is not a SELECT column"
            ))
        };
    }
    // The single-call reader falls through legacy names per row, so one candidate keeps them equal.
    let candidates: Vec<&str> = LEGACY_VALUE_COLUMNS
        .iter()
        .copied()
        .filter(|column| present(column))
        .collect();
    match candidates.as_slice() {
        [column] => Ok(column.to_string()),
        [] => Err(format!(
            "no value column: none of {} is a SELECT column",
            LEGACY_VALUE_COLUMNS.join(", ")
        )),
        several => Err(format!(
            "legacy value names {} are all SELECT columns; declare one",
            several.join(", ")
        )),
    }
}

/// GROUP BY must be the bucket alone: by alias, by ordinal, or by the histogram call itself.
fn check_custom_group_by(
    select: &Select,
    bucket: &CustomBucket<'_>,
    stream_fields: Option<&HashSet<String>>,
) -> Result<(), String> {
    let GroupByExpr::Expressions(exprs, modifiers) = &select.group_by else {
        return Err("GROUP BY ALL does not name the bucket".to_string());
    };
    let ([expr], []) = (exprs.as_slice(), modifiers.as_slice()) else {
        return Err("GROUP BY is not exactly the histogram bucket".to_string());
    };
    let ordinal = (bucket.position + 1).to_string();
    let is_bucket = match expr {
        Expr::Identifier(ident) if ident.value == bucket.alias => {
            alias_free_of_stream_fields(&bucket.alias, stream_fields)?;
            true
        }
        Expr::Identifier(_) => false,
        Expr::Value(v) => matches!(&v.value, Value::Number(n, false) if *n == ordinal),
        other => other.to_string() == bucket.expr.to_string(),
    };
    if is_bucket {
        Ok(())
    } else {
        Err("GROUP BY is not exactly the histogram bucket".to_string())
    }
}

/// The engine binds a GROUP BY name to a stream field before a projection alias of that name.
fn alias_free_of_stream_fields(
    alias: &str,
    stream_fields: Option<&HashSet<String>>,
) -> Result<(), String> {
    let hint = "use GROUP BY <ordinal> or the histogram call";
    if alias == "_timestamp" {
        return Err(format!(
            "GROUP BY _timestamp groups by the stream column, not the bucket: {hint}"
        ));
    }
    match stream_fields {
        None => Err(format!(
            "stream schema unavailable to prove that GROUP BY {alias} is the bucket: {hint}"
        )),
        Some(fields) if fields.contains(alias) => Err(format!(
            "GROUP BY {alias} groups by the stream field of that name, not the bucket: {hint}"
        )),
        Some(_) => Ok(()),
    }
}

/// The interval literal of `histogram(_timestamp, '<lit>') AS time_bucket`, the first column.
fn histogram_literal(select: &Select) -> Option<&str> {
    let SelectItem::ExprWithAlias { expr, alias } = select.projection.first()? else {
        return None;
    };
    if alias.value != BUCKET_COLUMN || alias.quote_style.is_some() {
        return None;
    }
    let (name, args) = plain_call(expr)?;
    if name != "histogram" {
        return None;
    }
    histogram_args(args)
}

/// The interval literal of histogram's exact generated arguments: bare `_timestamp` and a string.
fn histogram_args(args: &[FunctionArg]) -> Option<&str> {
    let [column, interval] = args else {
        return None;
    };
    let is_timestamp = matches!(
        unnamed_expr(column)?,
        Expr::Identifier(ident) if ident.value == "_timestamp" && ident.quote_style.is_none()
    );
    if !is_timestamp {
        return None;
    }
    unnamed_expr(interval).and_then(string_literal)
}

/// The literal width must survive the engine's adjustment, divide the origin, and equal the config.
fn proven_grid(
    literal: &str,
    configured_interval: &str,
    window: (i64, i64),
) -> Result<BucketGrid, String> {
    let interval_secs = super::custom_sql_interval_seconds(literal).map_err(|e| e.to_string())?;
    if interval_secs <= 0 {
        return Err(format!("histogram interval '{literal}' is not positive"));
    }
    let interval_us = interval_secs
        .checked_mul(1_000_000)
        .ok_or_else(|| format!("histogram interval '{literal}' overflows microseconds"))?;
    if validate_and_adjust_histogram_interval(interval_secs, window) != interval_secs {
        return Err(format!(
            "histogram interval '{literal}' is adjusted by the search engine"
        ));
    }
    if !divides_histogram_origin(interval_secs) {
        return Err(format!(
            "histogram interval '{literal}' does not divide the histogram origin"
        ));
    }
    match super::parse_interval(configured_interval) {
        Ok(configured) if configured == interval_secs => Ok(BucketGrid {
            interval_secs,
            interval_us,
        }),
        _ => Err(format!(
            "histogram interval '{literal}' differs from the configured '{configured_interval}'"
        )),
    }
}

/// At most `ceil(window / interval) + 1` buckets intersect, so `+ 2` keeps a full result under it.
fn bucket_budget(start_us: i64, end_us: i64, interval_us: i64) -> Result<usize> {
    if interval_us <= 0 {
        anyhow::bail!("histogram interval {interval_us}us is not positive");
    }
    if end_us <= start_us {
        anyhow::bail!("requested window [{start_us}, {end_us}) is empty or reversed");
    }
    let window_us = end_us
        .checked_sub(start_us)
        .with_context(|| format!("requested window [{start_us}, {end_us}) overflows"))?;
    let buckets = window_us / interval_us + i64::from(window_us % interval_us != 0);
    let budget = buckets.checked_add(2).context("bucket budget overflows")?;
    usize::try_from(budget).context("bucket budget does not fit a row count")
}

fn validated_plan(
    plan: &SearchPartitionResponse,
    window: (i64, i64),
    grid: BucketGrid,
) -> Result<Vec<[i64; 2]>> {
    if plan.streaming_aggs {
        anyhow::bail!("planner returned a streaming aggregation plan");
    }
    if plan.histogram_interval != Some(grid.interval_secs) {
        anyhow::bail!(
            "planner histogram interval {:?}s differs from the proven {}s",
            plan.histogram_interval,
            grid.interval_secs
        );
    }
    validated_ranges(&plan.partitions, window, grid.interval_us)
}

/// Half-open ranges that tile the window exactly, with every internal cut on the bucket grid.
fn validated_ranges(
    partitions: &[[i64; 2]],
    window: (i64, i64),
    interval_us: i64,
) -> Result<Vec<[i64; 2]>> {
    let mut ranges = partitions.to_vec();
    ranges.sort_unstable_by_key(|r| r[0]);
    let (Some(first), Some(last)) = (ranges.first(), ranges.last()) else {
        anyhow::bail!("planner returned no partitions");
    };
    if first[0] != window.0 || last[1] != window.1 {
        anyhow::bail!(
            "partitions cover [{}, {}), not the requested [{}, {})",
            first[0],
            last[1],
            window.0,
            window.1
        );
    }
    let mut covered_to = window.0;
    for (idx, &[start, end]) in ranges.iter().enumerate() {
        if start >= end {
            anyhow::bail!("partition [{start}, {end}) is empty or reversed");
        }
        if start != covered_to {
            anyhow::bail!("partition [{start}, {end}) leaves a gap or overlap at {covered_to}");
        }
        if idx > 0 && start.rem_euclid(interval_us) != 0 {
            anyhow::bail!("internal cut {start} is off the {interval_us}us bucket grid");
        }
        covered_to = end;
    }
    Ok(ranges)
}

/// Whether bucket `[bucket, bucket + interval)` meets the half-open slice.
fn bucket_intersects(bucket: i64, interval_us: i64, slice: [i64; 2]) -> bool {
    let bucket = i128::from(bucket);
    bucket < i128::from(slice[1]) && bucket + i128::from(interval_us) > i128::from(slice[0])
}

fn is_generated_aggregate(expr: &Expr) -> bool {
    let Some((name, args)) = plain_call(expr) else {
        return false;
    };
    match (name.as_str(), args) {
        ("count", [FunctionArg::Unnamed(FunctionArgExpr::Wildcard)]) => true,
        ("approx_percentile_cont", [field, quantile]) => {
            unnamed_expr(field).is_some_and(is_field)
                && unnamed_expr(quantile)
                    .and_then(number_literal)
                    .is_some_and(|q| GENERATED_QUANTILES.contains(&q))
        }
        (function, [field]) if FILTER_AGGREGATES.contains(&function) => {
            unnamed_expr(field).is_some_and(is_field)
        }
        _ => false,
    }
}

/// Row-local `field <op> 'literal'` forms of `build_single_filter`, joined only by AND.
fn is_generated_predicate(expr: &Expr) -> bool {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => is_generated_predicate(left) && is_generated_predicate(right),
        Expr::BinaryOp { left, op, right } => {
            matches!(
                op,
                BinaryOperator::Eq
                    | BinaryOperator::NotEq
                    | BinaryOperator::Gt
                    | BinaryOperator::Lt
                    | BinaryOperator::GtEq
                    | BinaryOperator::LtEq
            ) && is_field(left)
                && string_literal(right).is_some()
        }
        Expr::Like {
            any: false,
            expr,
            pattern,
            escape_char: None,
            ..
        } => is_field(expr) && string_literal(pattern).is_some(),
        Expr::IsNull(field) | Expr::IsNotNull(field) => is_field(field),
        Expr::InList { expr, list, .. } => {
            is_field(expr) && !list.is_empty() && list.iter().all(|e| string_literal(e).is_some())
        }
        Expr::Function(_) => is_generated_filter_call(expr),
        _ => false,
    }
}

fn is_generated_filter_call(expr: &Expr) -> bool {
    let Some((name, args)) = plain_call(expr) else {
        return false;
    };
    match (name.as_str(), args) {
        ("match_all", [pattern]) => unnamed_expr(pattern).and_then(string_literal).is_some(),
        (function, [field, pattern]) if FILTER_PREDICATE_FUNCTIONS.contains(&function) => {
            unnamed_expr(field).is_some_and(is_field)
                && unnamed_expr(pattern).and_then(string_literal).is_some()
        }
        _ => false,
    }
}

/// A lowercased unqualified function name and its arguments, with no modifier of any kind.
fn plain_call(expr: &Expr) -> Option<(String, &[FunctionArg])> {
    let Expr::Function(function) = expr else {
        return None;
    };
    let [ObjectNamePart::Identifier(name)] = function.name.0.as_slice() else {
        return None;
    };
    let FunctionArguments::List(list) = &function.args else {
        return None;
    };
    let unmodified = name.quote_style.is_none()
        && !function.uses_odbc_syntax
        && matches!(function.parameters, FunctionArguments::None)
        && function.filter.is_none()
        && function.null_treatment.is_none()
        && function.over.is_none()
        && function.within_group.is_empty()
        && list.duplicate_treatment.is_none()
        && list.clauses.is_empty();
    unmodified.then(|| (name.value.to_ascii_lowercase(), list.args.as_slice()))
}

fn unnamed_expr(arg: &FunctionArg) -> Option<&Expr> {
    match arg {
        FunctionArg::Unnamed(FunctionArgExpr::Expr(expr)) => Some(expr),
        _ => None,
    }
}

fn is_field(expr: &Expr) -> bool {
    matches!(expr, Expr::Identifier(_))
}

fn string_literal(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Value(v) => match &v.value {
            Value::SingleQuotedString(s) => Some(s),
            _ => None,
        },
        _ => None,
    }
}

fn number_literal(expr: &Expr) -> Option<&str> {
    match expr {
        Expr::Value(v) => match &v.value {
            Value::Number(n, false) => Some(n),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use datafusion::arrow::{
        array::{ArrayRef, Float64Array, TimestampMicrosecondArray},
        record_batch::RecordBatch,
    };
    use o2_enterprise::enterprise::anomaly_detection::{
        query_builder::build_training_query,
        types::{AnomalyConfig, DetectionFunction, Filter, QueryMode, Status},
    };
    use serde_json::json;

    use super::*;
    use crate::traces::red_insights::{RedSignal, StreamColumns, template};

    const MINUTE_US: i64 = 60_000_000;
    const FIVE_MIN_US: i64 = 5 * MINUTE_US;
    const DAY_US: i64 = 86_400_000_000;
    /// 2026-01-01T00:00:00Z, on every grid used here.
    const T0: i64 = 1_767_225_600_000_000;
    const GRID_5M: BucketGrid = BucketGrid {
        interval_secs: 300,
        interval_us: FIVE_MIN_US,
    };

    fn generated_query() -> SupportedQuery {
        SupportedQuery {
            grid: GRID_5M,
            columns: ResultColumns::generated(),
        }
    }

    const WINDOW: (i64, i64) = (T0, T0 + 3 * FIVE_MIN_US);
    const SQL: &str = "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \
                       default GROUP BY time_bucket ORDER BY time_bucket";

    #[derive(Default)]
    struct ScriptedSearch {
        plan: Option<std::result::Result<SearchPartitionResponse, String>>,
        responses: Mutex<VecDeque<std::result::Result<Response, String>>>,
        searched: Mutex<Vec<(String, i64, i64, i64)>>,
        planned: AtomicUsize,
        gate: Option<tokio::sync::Notify>,
    }

    impl ScriptedSearch {
        fn new(
            plan: Option<SearchPartitionResponse>,
            responses: Vec<std::result::Result<Response, String>>,
        ) -> Self {
            Self {
                plan: plan.map(Ok),
                responses: Mutex::new(responses.into()),
                ..Default::default()
            }
        }

        fn searched(&self) -> Vec<(String, i64, i64, i64)> {
            self.searched.lock().unwrap().clone()
        }
    }

    impl SliceSearch for ScriptedSearch {
        async fn plan(
            &self,
            _trace_id: &str,
            req: &SearchPartitionRequest,
        ) -> Result<SearchPartitionResponse> {
            assert_eq!(req.histogram_interval, 300);
            assert!(!req.streaming_output);
            self.planned.fetch_add(1, Ordering::SeqCst);
            match self.plan.clone() {
                Some(Ok(plan)) => Ok(plan),
                Some(Err(e)) => Err(anyhow::anyhow!(e)),
                None => panic!("planner response was not configured"),
            }
        }

        async fn search(&self, trace_id: &str, req: &Request) -> Result<Response> {
            let call = (
                trace_id.to_string(),
                req.query.start_time,
                req.query.end_time,
                req.query.size,
            );
            let first = {
                let mut searched = self.searched.lock().unwrap();
                searched.push(call);
                searched.len() == 1
            };
            if first && let Some(gate) = &self.gate {
                gate.notified().await;
            }
            let next = self.responses.lock().unwrap().pop_front();
            next.expect("unscripted search")
                .map_err(|e| anyhow::anyhow!(e))
        }
    }

    /// Uses the leader JSON row conversion so null handling matches production.
    struct ArrowSearch {
        plan: Option<SearchPartitionResponse>,
        batches: Mutex<VecDeque<RecordBatch>>,
        searched: AtomicUsize,
    }

    impl SliceSearch for ArrowSearch {
        async fn plan(
            &self,
            _trace_id: &str,
            _req: &SearchPartitionRequest,
        ) -> Result<SearchPartitionResponse> {
            Ok(self
                .plan
                .clone()
                .expect("planner response was not configured"))
        }

        async fn search(&self, _trace_id: &str, _req: &Request) -> Result<Response> {
            self.searched.fetch_add(1, Ordering::SeqCst);
            let batch = self
                .batches
                .lock()
                .unwrap()
                .pop_front()
                .expect("unscripted search");
            Ok(object_response(&batch))
        }
    }

    fn builder_config(
        function: DetectionFunction,
        field: Option<&str>,
        filters: Vec<Filter>,
        interval: &str,
    ) -> AnomalyConfig {
        AnomalyConfig {
            anomaly_id: "a1".to_string(),
            org_id: "org".to_string(),
            stream_name: "default".to_string(),
            stream_type: o2_enterprise::enterprise::anomaly_detection::types::StreamType::Logs,
            enabled: true,
            name: "n".to_string(),
            description: None,
            query_mode: QueryMode::Filters,
            filters,
            custom_sql: None,
            detection_function: function,
            detection_field: field.map(str::to_string),
            histogram_interval: interval.to_string(),
            schedule_interval: "1h".to_string(),
            detection_window_seconds: 7200,
            training_window_days: 21,
            retrain_interval_days: 7,
            threshold: 97,
            alert_budget_per_day: None,
            band_width: None,
            alert_window_buckets: 1,
            is_trained: false,
            training_started_at: None,
            training_completed_at: None,
            last_processed_timestamp: None,
            current_model_version: None,
            alert_enabled: false,
            alert_destinations: vec![],
            status: Status::Waiting,
            retries: 0,
            last_updated: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn filter(field: &str, operator: &str, value: &str) -> Filter {
        Filter {
            field: field.to_string(),
            operator: operator.to_string(),
            value: value.to_string(),
        }
    }

    fn filter_metadata(interval: &str) -> QueryMetadata {
        QueryMetadata {
            query_mode: "filters".to_string(),
            stream_name: "default".to_string(),
            stream_type: "logs".to_string(),
            histogram_interval: interval.to_string(),
            value_column: None,
        }
    }

    fn red_metadata(signal: RedSignal, stream: &str) -> QueryMetadata {
        QueryMetadata {
            query_mode: "custom_sql".to_string(),
            stream_name: stream.to_string(),
            stream_type: "traces".to_string(),
            histogram_interval: "5m".to_string(),
            value_column: (signal == RedSignal::P95Latency).then(|| "value".to_string()),
        }
    }

    /// Custom SQL on the logs stream `default`, with the declared value column if any.
    fn custom_metadata(value_column: Option<&str>) -> QueryMetadata {
        QueryMetadata {
            query_mode: "custom_sql".to_string(),
            value_column: value_column.map(str::to_string),
            ..filter_metadata("5m")
        }
    }

    fn red_sql(signal: RedSignal, has_parent: bool) -> String {
        let cols = StreamColumns {
            has_parent,
            has_status: true,
            has_duration: true,
        };
        template("default", "checkout", signal, &cols)
            .unwrap()
            .custom_sql
    }

    fn training_window() -> (i64, i64) {
        (T0 - 21 * DAY_US, T0)
    }

    fn eligible(metadata: &QueryMetadata, sql: &str) -> Result<BucketGrid, String> {
        supported(metadata, sql).map(|query| query.grid)
    }

    fn supported(metadata: &QueryMetadata, sql: &str) -> Result<SupportedQuery, String> {
        supported_with(metadata, sql, Some(&stream_fields()))
    }

    fn supported_with(
        metadata: &QueryMetadata,
        sql: &str,
        fields: Option<&HashSet<String>>,
    ) -> Result<SupportedQuery, String> {
        supported_query(
            Some(metadata),
            sql,
            &metadata.stream_type,
            training_window(),
            fields,
        )
    }

    /// The seed stream's fields: `time` is deliberately absent, `_timestamp` always present.
    fn stream_fields() -> HashSet<String> {
        [
            "_timestamp",
            "level",
            "latency",
            "service",
            "bytes",
            "duration",
            "id",
        ]
        .map(str::to_string)
        .into()
    }

    fn columns(bucket: &str, value: &str) -> ResultColumns {
        ResultColumns {
            bucket: bucket.to_string(),
            value: value.to_string(),
        }
    }

    fn filter_sql(where_clause: &str) -> String {
        format!(
            "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM default \
             {where_clause}GROUP BY time_bucket ORDER BY time_bucket"
        )
    }

    #[test]
    fn every_builder_aggregate_qualifies() {
        let functions = [
            (DetectionFunction::Count, None),
            (DetectionFunction::Avg, Some("latency")),
            (DetectionFunction::Sum, Some("bytes")),
            (DetectionFunction::Min, Some("latency")),
            (DetectionFunction::Max, Some("latency")),
            (DetectionFunction::P50, Some("latency")),
            (DetectionFunction::P95, Some("latency")),
            (DetectionFunction::P99, Some("latency")),
            (DetectionFunction::Avg, None),
        ];
        for (function, field) in functions {
            let sql = build_training_query(&builder_config(function, field, vec![], "5m")).unwrap();
            assert_eq!(eligible(&filter_metadata("5m"), &sql), Ok(GRID_5M), "{sql}");
        }
    }

    #[test]
    fn every_builder_filter_operator_qualifies_alone_and_combined() {
        let mut all = vec![];
        for operator in super::super::SUPPORTED_FILTER_OPERATORS {
            let value = if operator.contains("in") && !operator.contains("contains") {
                "a, 'b''c'"
            } else {
                "it's"
            };
            let f = filter("level", operator, value);
            all.push(f.clone());
            let config = builder_config(DetectionFunction::Count, None, vec![f], "5m");
            let sql = build_training_query(&config).unwrap();
            assert_eq!(eligible(&filter_metadata("5m"), &sql), Ok(GRID_5M), "{sql}");
        }
        let contains_ui = filter("message", "Contains", "x");
        all.push(contains_ui);
        let sql = build_training_query(&builder_config(DetectionFunction::Count, None, all, "5m"))
            .unwrap();
        assert_eq!(eligible(&filter_metadata("5m"), &sql), Ok(GRID_5M), "{sql}");
    }

    #[test]
    fn filter_shape_deviations_fall_back() {
        let base = filter_sql("WHERE level = 'error' ");
        assert!(eligible(&filter_metadata("5m"), &base).is_ok());
        let deviations = [
            base.replace(" ORDER BY time_bucket", " ORDER BY time_bucket LIMIT 10"),
            base.replace(" ORDER BY time_bucket", " ORDER BY time_bucket OFFSET 5"),
            base.replace(" ORDER BY time_bucket", " ORDER BY time_bucket DESC"),
            base.replace(" ORDER BY time_bucket", ""),
            base.replace("GROUP BY time_bucket", "GROUP BY time_bucket, level"),
            base.replace(
                "GROUP BY time_bucket",
                "GROUP BY time_bucket HAVING count(*) > 1",
            ),
            base.replace("SELECT ", "SELECT DISTINCT "),
            base.replace("count(*)", "count(DISTINCT level)"),
            base.replace("count(*)", "count(*) FILTER (WHERE level = 'x')"),
            base.replace("count(*)", "count(*) OVER ()"),
            base.replace("count(*)", "sum(latency * 2)"),
            base.replace("count(*)", "sum(abs(latency))"),
            base.replace("count(*)", "approx_percentile_cont(latency, 0.9)"),
            base.replace("count(*) AS value", "count(*) AS value, max(x) AS other"),
            base.replace("AS value", "AS v"),
            base.replace("FROM default", "FROM default AS d"),
            base.replace("FROM default", "FROM other"),
            base.replace(
                "FROM default",
                "FROM default JOIN other ON default.a = other.a",
            ),
            base.replace("FROM default", "FROM (SELECT * FROM default) AS s"),
            base.replace(
                "level = 'error'",
                "level IN (SELECT level FROM other) AND level = 'e'",
            ),
            base.replace("level = 'error'", "level = 'error' OR level = 'warn'"),
            base.replace("level = 'error'", "level = random()"),
            base.replace("level = 'error'", "now() > '1'"),
            base.replace("level = 'error'", "(level = 'error')"),
            base.replace("level = 'error'", "level = other_field"),
            base.replace("level = 'error'", "lower(level) = 'error'"),
            base.replace("level = 'error'", "level LIKE 'a%' ESCAPE '!'"),
            format!("WITH c AS (SELECT 1) {base}"),
            format!(
                "{} UNION ALL {base}",
                base.replace(" ORDER BY time_bucket", "")
            ),
            format!("{base}; {base}"),
            "not sql at all".to_string(),
        ];
        for sql in deviations {
            assert!(eligible(&filter_metadata("5m"), &sql).is_err(), "{sql}");
        }
    }

    #[test]
    fn current_red_templates_qualify_with_and_without_the_parent_column() {
        for signal in RedSignal::ALL {
            for has_parent in [true, false] {
                let sql = red_sql(signal, has_parent);
                assert_eq!(
                    eligible(&red_metadata(signal, "default"), &sql),
                    Ok(GRID_5M),
                    "{sql}"
                );
            }
        }
    }

    #[test]
    fn edited_or_untagged_red_sql_still_qualifies_on_its_own_shape() {
        let sql = red_sql(RedSignal::ErrorRatio, true);
        let ratio = red_metadata(RedSignal::ErrorRatio, "default");
        let edited = sql.replace(">= 20", ">= 10");
        assert_eq!(eligible(&ratio, &edited), Ok(GRID_5M));
        let reformatted = sql.replace(" FROM ", "  FROM ");
        assert_eq!(eligible(&ratio, &reformatted), Ok(GRID_5M));
        let rate = red_metadata(RedSignal::Rate, "default");
        assert_eq!(eligible(&rate, &sql), Ok(GRID_5M));
        assert_eq!(eligible(&rate, &filter_sql("")), Ok(GRID_5M));
        let other_stream = red_metadata(RedSignal::ErrorRatio, "other");
        let reason = eligible(&other_stream, &sql).unwrap_err();
        assert!(reason.contains("config's stream"), "{reason}");
    }

    #[test]
    fn plain_custom_sql_with_a_bucket_grid_qualifies() {
        let logs_page = "SELECT histogram(_timestamp, '5m') AS zo_sql_timestamp, count(*) AS \
                         zo_sql_num FROM \"default\" GROUP BY zo_sql_timestamp ORDER BY \
                         zo_sql_timestamp DESC";
        assert_eq!(
            supported(&custom_metadata(Some("zo_sql_num")), logs_page),
            Ok(SupportedQuery {
                grid: GRID_5M,
                columns: columns("zo_sql_timestamp", "zo_sql_num"),
            })
        );
        let value_first_by_ordinal = "SELECT avg(latency) AS value, histogram(_timestamp, \
                                      '5m') AS time_bucket FROM default GROUP BY 2";
        let by_expression = "SELECT histogram(_timestamp, '5m') AS _timestamp, max(bytes) AS \
                             metric FROM default d WHERE d.level = 'error' AND _timestamp > 0 \
                             GROUP BY histogram(_timestamp, '5m') HAVING count(*) >= 20";
        let per_bucket_arithmetic = "SELECT histogram(_timestamp, '5m') AS time, count(*) AS \
                                     n, count(*) FILTER (WHERE level = 'error') * 1.0 / \
                                     count(*) AS value FROM default GROUP BY time";
        let legacy_count = "SELECT histogram(_timestamp, '300s') AS time_bucket, count(*) AS \
                            count, approx_percentile_cont(duration, 0.5) WITHIN GROUP (ORDER \
                            BY duration) AS p50 FROM default GROUP BY time_bucket";
        for (sql, bucket, value) in [
            (value_first_by_ordinal, "time_bucket", "value"),
            (by_expression, "_timestamp", "metric"),
            (per_bucket_arithmetic, "time", "value"),
            (legacy_count, "time_bucket", "count"),
        ] {
            assert_eq!(
                supported(&custom_metadata(None), sql),
                Ok(SupportedQuery {
                    grid: GRID_5M,
                    columns: columns(bucket, value),
                }),
                "{sql}"
            );
        }
        let declared_over_legacy = supported(&custom_metadata(Some("p50")), legacy_count);
        assert_eq!(
            declared_over_legacy.unwrap().columns,
            columns("time_bucket", "p50")
        );
        let two_legacy = "SELECT histogram(_timestamp, '5m') AS time_bucket, avg(latency) AS \
                          value, count(*) AS count FROM default GROUP BY time_bucket";
        let declared = supported(&custom_metadata(Some("count")), two_legacy);
        assert_eq!(declared.unwrap().columns, columns("time_bucket", "count"));
        let deterministic_time = "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) \
                                  AS value FROM default WHERE _timestamp > \
                                  to_timestamp('2026-01-01') GROUP BY time_bucket";
        assert_eq!(
            eligible(&custom_metadata(None), deterministic_time),
            Ok(GRID_5M)
        );
    }

    #[test]
    fn a_group_by_alias_that_names_a_stream_field_falls_back() {
        let meta = custom_metadata(None);
        let by_timestamp = "SELECT histogram(_timestamp, '5m') AS _timestamp, count(*) AS value \
                            FROM default GROUP BY _timestamp";
        let reason = supported(&meta, by_timestamp).unwrap_err();
        assert!(
            reason.contains("GROUP BY _timestamp groups by the stream column"),
            "{reason}"
        );
        let by_ordinal = by_timestamp.replace("GROUP BY _timestamp", "GROUP BY 1");
        assert_eq!(
            supported(&meta, &by_ordinal).unwrap().columns,
            columns("_timestamp", "value")
        );
        let by_time = "SELECT histogram(_timestamp, '5m') AS time, count(*) AS value FROM \
                       default GROUP BY time";
        assert_eq!(
            supported(&meta, by_time).unwrap().columns,
            columns("time", "value")
        );
        let mut with_time_field = stream_fields();
        with_time_field.insert("time".to_string());
        let reason = supported_with(&meta, by_time, Some(&with_time_field)).unwrap_err();
        assert!(reason.contains("stream field of that name"), "{reason}");
        let no_schema = supported_with(&meta, &filter_sql(""), None).unwrap_err();
        assert!(no_schema.contains("schema unavailable"), "{no_schema}");
        let ordinal_without_schema = filter_sql("").replace("GROUP BY time_bucket", "GROUP BY 1");
        assert!(supported_with(&meta, &ordinal_without_schema, None).is_ok());
    }

    #[test]
    fn custom_sql_that_reads_across_buckets_or_rows_falls_back() {
        let base = "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \
                    default";
        let cases = [
            (format!("{base} GROUP BY time_bucket LIMIT 10"), "LIMIT"),
            (
                format!("{base} GROUP BY time_bucket OFFSET 10"),
                "LIMIT or OFFSET",
            ),
            (
                format!("WITH t AS (SELECT * FROM default) {base} GROUP BY time_bucket"),
                "WITH",
            ),
            (
                format!("{base} GROUP BY time_bucket UNION ALL {base} GROUP BY time_bucket"),
                "set operation",
            ),
            (
                format!("{base} WHERE id IN (SELECT id FROM other) GROUP BY time_bucket"),
                "subquery",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) / (SELECT \
                 count(*) FROM default) AS value FROM default GROUP BY time_bucket"
                    .to_string(),
                "subquery",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) - lag(count(*)) \
                 OVER (ORDER BY 1) AS value FROM default GROUP BY time_bucket"
                    .to_string(),
                "window function",
            ),
            (
                format!("{base} JOIN other ON default.id = other.id GROUP BY time_bucket"),
                "joins",
            ),
            (
                "SELECT DISTINCT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value \
                 FROM default GROUP BY time_bucket"
                    .to_string(),
                "DISTINCT",
            ),
            (format!("{base} GROUP BY time_bucket, level"), "GROUP BY"),
            (format!("{base} GROUP BY level"), "GROUP BY"),
            (format!("{base} GROUP BY 2"), "GROUP BY"),
            (format!("{base} GROUP BY ROLLUP (time_bucket)"), "GROUP BY"),
            (base.to_string(), "GROUP BY"),
            (
                "SELECT histogram(_timestamp, '5m'), count(*) AS value FROM default GROUP BY 1"
                    .to_string(),
                "no alias",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS bucket, count(*) AS value FROM default \
                 GROUP BY bucket"
                    .to_string(),
                "timestamp names",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, max(_timestamp) AS \
                 _timestamp, count(*) AS value FROM default GROUP BY time_bucket"
                    .to_string(),
                "read as the timestamp",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS requests FROM \
                 default GROUP BY time_bucket"
                    .to_string(),
                "no value column",
            ),
            (
                "SELECT histogram(created, '5m') AS time_bucket, count(*) AS value FROM \
                 default GROUP BY time_bucket"
                    .to_string(),
                "two arguments",
            ),
            (
                "SELECT histogram(_timestamp, '5m', 'UTC') AS time_bucket, count(*) AS value \
                 FROM default GROUP BY time_bucket"
                    .to_string(),
                "two arguments",
            ),
            (
                "SELECT histogram(_timestamp) AS time_bucket, count(*) AS value FROM default \
                 GROUP BY time_bucket"
                    .to_string(),
                "two arguments",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, histogram(_timestamp, \
                 '1h') AS time, count(*) AS value FROM default GROUP BY time_bucket"
                    .to_string(),
                "more than one histogram",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, * FROM default GROUP BY \
                 time_bucket"
                    .to_string(),
                "wildcard",
            ),
            (
                format!(
                    "{} GROUP BY time_bucket",
                    base.replace("FROM default", "FROM other")
                ),
                "config's stream",
            ),
            (
                format!(
                    "{} GROUP BY time_bucket",
                    base.replace("FROM default", "FROM (SELECT * FROM default) d")
                ),
                "ordinary stream",
            ),
            (
                format!("{} GROUP BY time_bucket", base.replace("'5m'", "'10m'")),
                "differs from the configured",
            ),
            (
                format!("{base} GROUP BY time_bucket; SELECT 1"),
                "one statement",
            ),
            ("VALUES (1, 2)".to_string(), "set operation"),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) / extract(epoch \
                 FROM now()) AS value FROM default GROUP BY time_bucket"
                    .to_string(),
                "now(), bound at query time",
            ),
            (
                format!(
                    "{base} WHERE _timestamp > CURRENT_TIMESTAMP - INTERVAL '1 day' GROUP BY \
                     time_bucket"
                ),
                "current_timestamp(), bound at query time",
            ),
            (
                format!("{base} GROUP BY time_bucket HAVING count(*) > random() * 10"),
                "random(), bound at query time",
            ),
            (
                format!("{base} GROUP BY time_bucket ORDER BY pg_catalog.NOW()"),
                "now(), bound at query time",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, unnest(array_agg(latency)) \
                 AS value FROM default GROUP BY time_bucket"
                    .to_string(),
                "unnest(), which expands a bucket into rows",
            ),
            (
                "SELECT histogram(_timestamp, '5m') AS time_bucket, avg(latency) AS value, \
                 count(*) AS count FROM default GROUP BY time_bucket"
                    .to_string(),
                "legacy value names value, count are all SELECT columns",
            ),
        ];
        for (sql, expected) in cases {
            let reason = supported(&custom_metadata(None), &sql).unwrap_err();
            assert!(reason.contains(expected), "{sql}\n  got: {reason}");
        }
        let sql = format!("{base} GROUP BY time_bucket");
        let absent = supported(&custom_metadata(Some("requests")), &sql).unwrap_err();
        assert!(absent.contains("not a SELECT column"), "{absent}");
        let bucket = supported(&custom_metadata(Some("time_bucket")), &sql).unwrap_err();
        assert!(bucket.contains("is the bucket column"), "{bucket}");
    }

    #[test]
    fn metadata_mismatches_fall_back() {
        let sql = filter_sql("");
        let fields = stream_fields();
        assert!(supported_query(None, &sql, "logs", training_window(), Some(&fields)).is_err());
        let meta = filter_metadata("5m");
        assert!(
            supported_query(
                Some(&meta),
                &sql,
                "traces",
                training_window(),
                Some(&fields)
            )
            .is_err()
        );
        let mut conflicting = filter_metadata("5m");
        conflicting.value_column = Some("requests".to_string());
        assert!(eligible(&conflicting, &sql).is_err());
        let mut declared_value = filter_metadata("5m");
        declared_value.value_column = Some("value".to_string());
        assert!(eligible(&declared_value, &sql).is_ok());
        assert_eq!(eligible(&custom_metadata(None), &sql), Ok(GRID_5M));
        let mut unknown = filter_metadata("5m");
        unknown.query_mode = "promql".to_string();
        assert!(eligible(&unknown, &sql).is_err());
    }

    #[test]
    fn metadata_snapshot_reads_the_declared_column() {
        let model = infra::table::entity::anomaly_detection_config::Model {
            query_mode: "custom_sql".to_string(),
            stream_name: "default".to_string(),
            stream_type: "traces".to_string(),
            histogram_interval: "5m".to_string(),
            detection_function: "p95(value)".to_string(),
            ..sample_model()
        };
        let meta = QueryMetadata::from_model(&model);
        assert_eq!(meta.value_column.as_deref(), Some("value"));
        assert_eq!(meta.histogram_interval, "5m");
    }

    fn sample_model() -> infra::table::entity::anomaly_detection_config::Model {
        infra::table::entity::anomaly_detection_config::Model {
            anomaly_id: String::new(),
            org_id: String::new(),
            stream_name: String::new(),
            stream_type: String::new(),
            enabled: true,
            name: String::new(),
            description: None,
            query_mode: String::new(),
            filters: None,
            custom_sql: None,
            detection_function: String::new(),
            histogram_interval: String::new(),
            schedule_interval: String::new(),
            detection_window_seconds: 0,
            training_window_days: 0,
            retrain_interval_days: 0,
            threshold: 0,
            alert_budget_per_day: None,
            level_half_width_seconds: None,
            band_width: None,
            alert_direction: None,
            alert_window_buckets: None,
            alert_window_fire_pct: None,
            alert_window_recover_pct: None,
            band_grouping: None,
            band_k: None,
            seasonality: String::new(),
            is_trained: false,
            training_started_at: None,
            training_completed_at: None,
            last_error: None,
            last_processed_timestamp: None,
            current_model_version: 0,
            rcf_num_trees: 0,
            rcf_tree_size: 0,
            rcf_shingle_size: 0,
            alert_enabled: false,
            alert_destinations: None,
            folder_id: String::new(),
            owner: None,
            priority: None,
            tags: None,
            status: 0,
            retries: 0,
            last_failed_at: None,
            last_alert_fired_at: None,
            last_recovery_notified_at: None,
            detection_lease_us: None,
            last_updated: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn a_repeated_fallback_reason_is_logged_once_per_interval() {
        let mut logged = FallbackLog::new();
        let key = || ("org".to_string(), "a1".to_string());
        let now = Instant::now();
        assert!(fallback_log_due(&mut logged, key(), "custom", now));
        assert!(!fallback_log_due(&mut logged, key(), "custom", now));
        assert!(fallback_log_due(&mut logged, key(), "other", now));
        let later = now + FALLBACK_LOG_INTERVAL;
        assert!(fallback_log_due(&mut logged, key(), "other", later));
    }

    #[test]
    fn canonical_widths_qualify() {
        for (interval, secs) in [
            ("5m", 300),
            ("1m", 60),
            ("1h", 3600),
            ("30s", 30),
            ("1d", 86400),
        ] {
            let sql = filter_sql("").replace("'5m'", &format!("'{interval}'"));
            assert_eq!(
                eligible(&filter_metadata(interval), &sql),
                Ok(BucketGrid {
                    interval_secs: secs,
                    interval_us: secs * 1_000_000
                }),
                "{interval}"
            );
        }
        let spelled = filter_sql("").replace("'5m'", "'5 minutes'");
        assert_eq!(eligible(&filter_metadata("300s"), &spelled), Ok(GRID_5M));
    }

    #[test]
    fn adjusted_skewed_zoned_or_mismatched_widths_fall_back() {
        let cases = [
            ("13s", "adjusted"),
            ("7m", "adjusted"),
            ("2d", "origin"),
            ("0s", "not positive"),
            ("1mon", "calendar unit"),
            ("9999999999999999d", "out of range"),
        ];
        for (interval, reason) in cases {
            let sql = filter_sql("").replace("'5m'", &format!("'{interval}'"));
            let err = eligible(&filter_metadata(interval), &sql).unwrap_err();
            assert!(err.contains(reason), "{interval}: {err}");
        }
        let zoned = filter_sql("").replace("'5m')", "'5m', 'Asia/Kolkata')");
        assert!(eligible(&filter_metadata("5m"), &zoned).is_err());
        let implicit = filter_sql("").replace(", '5m')", ")");
        assert!(eligible(&filter_metadata("5m"), &implicit).is_err());
        let other_column = filter_sql("").replace("(_timestamp", "(ts");
        assert!(eligible(&filter_metadata("5m"), &other_column).is_err());
        let err = eligible(&filter_metadata("1m"), &filter_sql("")).unwrap_err();
        assert!(err.contains("differs from the configured"), "{err}");
        assert!(eligible(&filter_metadata("garbage"), &filter_sql("")).is_err());
    }

    #[test]
    fn the_budget_matches_the_design_examples() {
        assert_eq!(bucket_budget(0, 21 * DAY_US, FIVE_MIN_US).unwrap(), 6_050);
        assert_eq!(bucket_budget(0, 21 * DAY_US, MINUTE_US).unwrap(), 30_242);
        assert_eq!(bucket_budget(0, 3 * MINUTE_US, FIVE_MIN_US).unwrap(), 3);
        assert!(bucket_budget(0, 21 * DAY_US, MINUTE_US).unwrap() > 10_000);
        assert_eq!(bucket_budget(1, 1 + FIVE_MIN_US, FIVE_MIN_US).unwrap(), 3);
        assert_eq!(bucket_budget(-7, 1, FIVE_MIN_US).unwrap(), 3);
    }

    #[test]
    fn an_unaligned_dense_result_stays_under_the_budget() {
        let window = (T0 + MINUTE_US, T0 + 7 * FIVE_MIN_US + MINUTE_US);
        let budget = bucket_budget(window.0, window.1, FIVE_MIN_US).unwrap();
        let intersecting = (0..=8)
            .map(|i| T0 + i * FIVE_MIN_US)
            .filter(|b| bucket_intersects(*b, FIVE_MIN_US, [window.0, window.1]))
            .count();
        assert_eq!(intersecting, 8);
        assert!(intersecting < budget);
    }

    #[test]
    fn invalid_ranges_and_overflow_are_errors() {
        assert!(bucket_budget(10, 10, FIVE_MIN_US).is_err());
        assert!(bucket_budget(10, 5, FIVE_MIN_US).is_err());
        assert!(bucket_budget(0, 10, 0).is_err());
        assert!(bucket_budget(0, 10, -1).is_err());
        assert!(bucket_budget(i64::MIN, i64::MAX, FIVE_MIN_US).is_err());
        assert!(bucket_budget(0, i64::MAX, 1).is_err());
        let run = SupportedRun::new("a1", "t", (T0, T0), generated_query());
        assert!(run.is_err());
    }

    #[test]
    fn the_budget_must_survive_the_i32_wire_size() {
        let one_second = || SupportedQuery {
            grid: BucketGrid {
                interval_secs: 1,
                interval_us: 1_000_000,
            },
            columns: ResultColumns::generated(),
        };
        let widest = (i64::from(i32::MAX) - 2) * 1_000_000;
        let run = SupportedRun::new("a1", "t", (0, widest), one_second()).unwrap();
        assert_eq!(run.budget, i32::MAX as usize);
        let wire = proto::cluster_rpc::SearchQuery::from(run.search_request(SQL).query);
        assert_eq!(wire.size, i32::MAX);

        let err = SupportedRun::new("a1", "t", (0, widest + 1), one_second())
            .err()
            .unwrap();
        assert!(format!("{err:#}").contains("search size limit"), "{err:#}");
        let reported = (0, 4_294_967_300 * 1_000_000);
        assert!(SupportedRun::new("a1", "t", reported, one_second()).is_err());
    }

    fn plan(partitions: Vec<[i64; 2]>) -> SearchPartitionResponse {
        SearchPartitionResponse {
            histogram_interval: Some(300),
            partitions,
            ..Default::default()
        }
    }

    #[test]
    fn a_valid_plan_is_returned_ascending_whatever_its_order() {
        let window = (T0 + MINUTE_US, T0 + 4 * FIVE_MIN_US + MINUTE_US);
        let a = [window.0, T0 + FIVE_MIN_US];
        let b = [T0 + FIVE_MIN_US, T0 + 4 * FIVE_MIN_US];
        let c = [T0 + 4 * FIVE_MIN_US, window.1];
        assert_eq!(
            validated_plan(&plan(vec![c, b, a]), window, GRID_5M).unwrap(),
            vec![a, b, c]
        );
        let sub_bucket = (T0 + MINUTE_US, T0 + 2 * MINUTE_US);
        assert_eq!(
            validated_plan(
                &plan(vec![[sub_bucket.0, sub_bucket.1]]),
                sub_bucket,
                GRID_5M
            )
            .unwrap(),
            vec![[sub_bucket.0, sub_bucket.1]]
        );
        let negative = (-2 * FIVE_MIN_US - 7, FIVE_MIN_US);
        let parts = vec![
            [negative.0, -FIVE_MIN_US],
            [-FIVE_MIN_US, 0],
            [0, FIVE_MIN_US],
        ];
        assert!(validated_plan(&plan(parts), negative, GRID_5M).is_ok());
    }

    #[test]
    fn invalid_plans_fail() {
        let window = (T0, T0 + 3 * FIVE_MIN_US);
        let cut = T0 + FIVE_MIN_US;
        let invalid = [
            vec![],
            vec![[T0, cut], [cut + FIVE_MIN_US, window.1]],
            vec![[T0, cut + FIVE_MIN_US], [cut, window.1]],
            vec![[T0, cut], [cut, window.1 - FIVE_MIN_US]],
            vec![[T0 + FIVE_MIN_US, window.1]],
            vec![[T0, cut + 1], [cut + 1, window.1]],
            vec![[T0, cut], [cut, cut], [cut, window.1]],
            vec![[T0, cut], [cut, window.1], [cut, window.1]],
            vec![[T0, cut], [window.1, cut]],
            vec![[T0 - FIVE_MIN_US, cut], [cut, window.1]],
            vec![[T0, cut], [cut, window.1 + FIVE_MIN_US]],
        ];
        for parts in invalid {
            assert!(
                validated_plan(&plan(parts.clone()), window, GRID_5M).is_err(),
                "{parts:?}"
            );
        }
        let mut streaming = plan(vec![[window.0, window.1]]);
        streaming.streaming_aggs = true;
        assert!(validated_plan(&streaming, window, GRID_5M).is_err());
        let mut adjusted = plan(vec![[window.0, window.1]]);
        adjusted.histogram_interval = Some(600);
        assert!(validated_plan(&adjusted, window, GRID_5M).is_err());
        adjusted.histogram_interval = None;
        assert!(validated_plan(&adjusted, window, GRID_5M).is_err());
    }

    fn response(hits: Vec<serde_json::Value>) -> Response {
        Response {
            hits,
            ..Default::default()
        }
    }

    fn row(bucket: i64, value: serde_json::Value) -> serde_json::Value {
        json!({BUCKET_COLUMN: bucket, VALUE_COLUMN: value})
    }

    /// An object row whose SQL NULL value was omitted, as the leader JSON writer does.
    fn null_row(bucket: i64) -> serde_json::Value {
        json!({ BUCKET_COLUMN: bucket })
    }

    fn parse_one(resp: &Response, slice: [i64; 2]) -> Result<Vec<QueryDataPoint>> {
        let mut series = SeriesAccumulator::default();
        series.add_slice(resp, slice, FIVE_MIN_US, 100, &ResultColumns::generated())?;
        series.finish(100, VALUE_COLUMN)
    }

    #[test]
    fn malformed_rows_fail_even_beside_valid_rows() {
        let slice = [T0, T0 + 4 * FIVE_MIN_US];
        let next = T0 + FIVE_MIN_US;
        let good = row(T0, json!(1.0));
        let bad = [
            json!([next, 1.0]),
            json!(T0),
            json!(null),
            json!({ VALUE_COLUMN: 1.0 }),
            json!({BUCKET_COLUMN: null, VALUE_COLUMN: 1.0}),
            json!({BUCKET_COLUMN: "yesterday", VALUE_COLUMN: 1.0}),
            json!({BUCKET_COLUMN: true, VALUE_COLUMN: 1.0}),
            row(next, json!("1.0")),
            row(next, json!("NaN")),
            row(next, json!("inf")),
            row(next, json!(true)),
            row(next, json!({"v": 1})),
            row(next, json!([1.0])),
            row(T0 + 1, json!(1.0)),
            row(T0 - FIVE_MIN_US, json!(1.0)),
            row(T0 + 4 * FIVE_MIN_US, json!(1.0)),
            row(T0, json!(2.0)),
            row(T0, serde_json::Value::Null),
            null_row(T0),
        ];
        for b in bad {
            let resp = response(vec![good.clone(), b.clone()]);
            assert!(parse_one(&resp, slice).is_err(), "{b}");
        }
    }

    #[test]
    fn string_buckets_parse_and_an_unaligned_start_keeps_its_first_bucket() {
        let slice = [T0 + MINUTE_US, T0 + 2 * FIVE_MIN_US];
        let resp = response(vec![
            json!({BUCKET_COLUMN: "2026-01-01T00:05:00", VALUE_COLUMN: 2}),
            row(T0, json!(1.5)),
        ]);
        let points = parse_one(&resp, slice).unwrap();
        let got: Vec<_> = points.iter().map(|p| (p.timestamp_us, p.value)).collect();
        assert_eq!(got, vec![(T0, 1.5), (T0 + FIVE_MIN_US, 2.0)]);
    }

    #[test]
    fn omitted_and_explicit_null_values_are_counted_and_never_zero() {
        let slice = [T0, T0 + 4 * FIVE_MIN_US];
        let resp = response(vec![
            row(T0, json!(1.0)),
            null_row(T0 + FIVE_MIN_US),
            row(T0 + 2 * FIVE_MIN_US, serde_json::Value::Null),
            row(T0 + 3 * FIVE_MIN_US, json!(3.0)),
        ]);
        let mut series = SeriesAccumulator::default();
        series
            .add_slice(&resp, slice, FIVE_MIN_US, 100, &ResultColumns::generated())
            .unwrap();
        assert_eq!((series.raw_hits, series.omitted_nulls), (4, 2));
        let points = series.finish(100, VALUE_COLUMN).unwrap();
        let got: Vec<_> = points.iter().map(|p| (p.timestamp_us, p.value)).collect();
        assert_eq!(got, vec![(T0, 1.0), (T0 + 3 * FIVE_MIN_US, 3.0)]);
    }

    #[test]
    fn a_column_missing_from_every_row_fails_the_run_naming_the_keys_seen() {
        let first = [T0, T0 + FIVE_MIN_US];
        let second = [T0 + FIVE_MIN_US, T0 + 2 * FIVE_MIN_US];
        let mut series = SeriesAccumulator::default();
        for (slice, bucket) in [(first, T0), (second, T0 + FIVE_MIN_US)] {
            let rows = response(vec![json!({BUCKET_COLUMN: bucket, "count": 3})]);
            series
                .add_slice(&rows, slice, FIVE_MIN_US, 100, &ResultColumns::generated())
                .unwrap();
        }
        assert_eq!(series.omitted_nulls, 2);
        let err = series.finish(100, VALUE_COLUMN).unwrap_err().to_string();
        assert!(err.contains("2 rows"), "{err}");
        assert!(err.contains("every 'value' was SQL NULL"), "{err}");
        assert!(err.contains("missing from the result"), "{err}");
        assert!(
            err.contains(r#"columns present: ["count", "time_bucket"]"#),
            "{err}"
        );

        let custom = columns("zo_sql_timestamp", "Cnt");
        let mut series = SeriesAccumulator::default();
        for (slice, hit) in [
            (first, json!({ "zo_sql_timestamp": T0 })),
            (
                second,
                json!({"zo_sql_timestamp": T0 + FIVE_MIN_US, "cnt": 4}),
            ),
        ] {
            series
                .add_slice(&response(vec![hit]), slice, FIVE_MIN_US, 100, &custom)
                .unwrap();
        }
        let err = series.finish(100, "Cnt").unwrap_err().to_string();
        assert!(
            err.contains(r#"columns present: ["cnt", "zo_sql_timestamp"]"#),
            "{err}"
        );

        let wide: serde_json::Map<_, _> = (0..128)
            .map(|i| (format!("k{i:03}"), json!(1)))
            .chain([(BUCKET_COLUMN.to_string(), json!(T0))])
            .collect();
        let mut series = SeriesAccumulator::default();
        series
            .add_slice(
                &response(vec![serde_json::Value::Object(wide)]),
                first,
                FIVE_MIN_US,
                100,
                &ResultColumns::generated(),
            )
            .unwrap();
        assert_eq!(series.keys_seen.len(), 129);
        assert!(series.keys_seen.contains(BUCKET_COLUMN));

        let slice = [T0, T0 + 2 * FIVE_MIN_US];
        let no_bucket = response(vec![json!({ VALUE_COLUMN: 1 })]);
        let err = parse_one(&no_bucket, slice).unwrap_err().to_string();
        assert!(err.contains("no usable 'time_bucket'"), "{err}");

        let extra = response(vec![
            json!({BUCKET_COLUMN: T0, VALUE_COLUMN: 1.0, "other": 2.0}),
        ]);
        assert_eq!(parse_one(&extra, slice).unwrap()[0].value, 1.0);

        assert!(parse_one(&response(vec![]), slice).unwrap().is_empty());
    }

    #[test]
    fn custom_columns_are_read_by_name_from_object_rows() {
        let slice = [T0, T0 + 3 * FIVE_MIN_US];
        let custom = columns("zo_sql_timestamp", "zo_sql_num");
        let resp = response(vec![
            json!({"zo_sql_num": 7, "n": 99, "zo_sql_timestamp": T0}),
            json!({"n": 99, "zo_sql_timestamp": T0 + FIVE_MIN_US}),
            json!({"zo_sql_timestamp": T0 + 2 * FIVE_MIN_US, VALUE_COLUMN: 5}),
        ]);
        let mut series = SeriesAccumulator::default();
        series
            .add_slice(&resp, slice, FIVE_MIN_US, 100, &custom)
            .unwrap();
        assert_eq!(series.omitted_nulls, 2);
        let points = series.finish(100, VALUE_COLUMN).unwrap();
        let got: Vec<_> = points.iter().map(|p| (p.timestamp_us, p.value)).collect();
        assert_eq!(got, vec![(T0, 7.0)]);

        let mut series = SeriesAccumulator::default();
        let err = series
            .add_slice(
                &resp,
                slice,
                FIVE_MIN_US,
                100,
                &columns("time_bucket", "zo_sql_num"),
            )
            .unwrap_err()
            .to_string();
        assert!(err.contains("'time_bucket'"), "{err}");
    }

    #[test]
    fn a_null_only_slice_is_fine_but_an_all_null_run_is_an_error() {
        let first = [T0, T0 + FIVE_MIN_US];
        let second = [T0 + FIVE_MIN_US, T0 + 2 * FIVE_MIN_US];
        for nulls in [
            response(vec![null_row(T0)]),
            response(vec![row(T0, serde_json::Value::Null)]),
        ] {
            let mut series = SeriesAccumulator::default();
            series
                .add_slice(&nulls, first, FIVE_MIN_US, 100, &ResultColumns::generated())
                .unwrap();
            let numbers = response(vec![row(T0 + FIVE_MIN_US, json!(4))]);
            series
                .add_slice(
                    &numbers,
                    second,
                    FIVE_MIN_US,
                    100,
                    &ResultColumns::generated(),
                )
                .unwrap();
            let points = series.finish(100, VALUE_COLUMN).unwrap();
            assert_eq!(
                points
                    .iter()
                    .map(|p| (p.timestamp_us, p.value))
                    .collect::<Vec<_>>(),
                vec![(T0 + FIVE_MIN_US, 4.0)]
            );

            let mut all_null = SeriesAccumulator::default();
            all_null
                .add_slice(&nulls, first, FIVE_MIN_US, 100, &ResultColumns::generated())
                .unwrap();
            let err = all_null.finish(100, VALUE_COLUMN).unwrap_err().to_string();
            assert!(err.contains("NULL"), "{err}");
        }

        let mut empty_run = SeriesAccumulator::default();
        for slice in [first, second] {
            empty_run
                .add_slice(
                    &response(vec![]),
                    slice,
                    FIVE_MIN_US,
                    100,
                    &ResultColumns::generated(),
                )
                .unwrap();
        }
        assert!(empty_run.finish(100, VALUE_COLUMN).unwrap().is_empty());
    }

    #[test]
    fn a_null_row_still_counts_toward_duplicates_across_slices() {
        let slice = [T0, T0 + FIVE_MIN_US];
        for nulls in [
            response(vec![null_row(T0)]),
            response(vec![row(T0, serde_json::Value::Null)]),
        ] {
            let mut series = SeriesAccumulator::default();
            series
                .add_slice(&nulls, slice, FIVE_MIN_US, 100, &ResultColumns::generated())
                .unwrap();
            let again = response(vec![row(T0, json!(1))]);
            assert!(
                series
                    .add_slice(&again, slice, FIVE_MIN_US, 100, &ResultColumns::generated())
                    .is_err()
            );
        }
    }

    #[test]
    fn partial_responses_keep_their_reason_and_exhausted_budgets_fail() {
        let slice = [T0, T0 + FIVE_MIN_US];
        let mut partial = response(vec![row(T0, json!(1))]);
        partial.is_partial = true;
        let err = parse_one(&partial, slice).unwrap_err().to_string();
        assert_eq!(err, "search returned partial results");
        partial.function_error = vec!["querier timeout".to_string()];
        let err = parse_one(&partial, slice).unwrap_err().to_string();
        assert!(err.contains("querier timeout"), "{err}");

        let wide = [T0, T0 + 2 * FIVE_MIN_US];
        let full = response(vec![null_row(T0), null_row(T0 + FIVE_MIN_US)]);
        let mut series = SeriesAccumulator::default();
        let err = series
            .add_slice(&full, wide, FIVE_MIN_US, 2, &ResultColumns::generated())
            .unwrap_err()
            .to_string();
        assert!(err.contains("budget"), "{err}");

        let mut series = SeriesAccumulator::default();
        let one = response(vec![row(T0, json!(1))]);
        series
            .add_slice(&one, wide, FIVE_MIN_US, 2, &ResultColumns::generated())
            .unwrap();
        let two = response(vec![null_row(T0 + FIVE_MIN_US)]);
        series
            .add_slice(&two, wide, FIVE_MIN_US, 2, &ResultColumns::generated())
            .unwrap();
        assert!(series.finish(2, VALUE_COLUMN).is_err());
    }

    fn three_slices() -> SearchPartitionResponse {
        plan(vec![
            [T0 + 2 * FIVE_MIN_US, WINDOW.1],
            [T0 + FIVE_MIN_US, T0 + 2 * FIVE_MIN_US],
            [T0, T0 + FIVE_MIN_US],
        ])
    }

    fn slice_ok(bucket: i64, value: f64) -> std::result::Result<Response, String> {
        Ok(response(vec![row(bucket, json!(value))]))
    }

    async fn run(engine: &ScriptedSearch) -> Result<Vec<QueryDataPoint>> {
        let run = SupportedRun::new("a1", "trace", WINDOW, generated_query())?;
        run.execute(engine, SQL).await
    }

    #[tokio::test]
    async fn searches_each_slice_in_ascending_order_with_the_full_budget() {
        let engine = ScriptedSearch::new(
            Some(three_slices()),
            vec![
                slice_ok(T0, 1.0),
                Ok(response(vec![])),
                slice_ok(T0 + 2 * FIVE_MIN_US, 3.0),
            ],
        );
        let points = run(&engine).await.unwrap();
        let got: Vec<_> = points.iter().map(|p| (p.timestamp_us, p.value)).collect();
        assert_eq!(got, vec![(T0, 1.0), (T0 + 2 * FIVE_MIN_US, 3.0)]);
        let budget = 5;
        assert_eq!(
            engine.searched(),
            vec![
                ("trace-0".to_string(), T0, T0 + FIVE_MIN_US, budget),
                (
                    "trace-1".to_string(),
                    T0 + FIVE_MIN_US,
                    T0 + 2 * FIVE_MIN_US,
                    budget
                ),
                (
                    "trace-2".to_string(),
                    T0 + 2 * FIVE_MIN_US,
                    WINDOW.1,
                    budget
                ),
            ]
        );
    }

    #[tokio::test]
    async fn a_single_partition_plan_keeps_the_same_validation() {
        let engine = ScriptedSearch::new(
            Some(plan(vec![[WINDOW.0, WINDOW.1]])),
            vec![slice_ok(T0 + FIVE_MIN_US, 2.0)],
        );
        let points = run(&engine).await.unwrap();
        assert_eq!(points.len(), 1);
        assert_eq!(engine.planned.load(Ordering::SeqCst), 1);
        assert_eq!(
            engine.searched(),
            vec![("trace".to_string(), WINDOW.0, WINDOW.1, 5)]
        );

        let malformed = response(vec![row(T0, json!(1)), row(T0 + 1, json!(1))]);
        let engine =
            ScriptedSearch::new(Some(plan(vec![[WINDOW.0, WINDOW.1]])), vec![Ok(malformed)]);
        assert!(run(&engine).await.is_err());

        let engine = ScriptedSearch::new(
            Some(plan(vec![[WINDOW.0, WINDOW.1]])),
            vec![Ok(response(
                (0..5).map(|i| row(T0 + i, json!(1))).collect(),
            ))],
        );
        let err = run(&engine).await.unwrap_err().to_string();
        assert!(err.contains("budget"), "{err}");
    }

    #[tokio::test]
    async fn a_blocked_slice_holds_back_every_later_slice() {
        let engine = ScriptedSearch {
            gate: Some(tokio::sync::Notify::new()),
            ..ScriptedSearch::new(
                Some(three_slices()),
                vec![
                    slice_ok(T0, 1.0),
                    slice_ok(T0 + FIVE_MIN_US, 2.0),
                    slice_ok(T0 + 2 * FIVE_MIN_US, 3.0),
                ],
            )
        };
        let (result, ()) = tokio::join!(run(&engine), async {
            for _ in 0..20 {
                tokio::task::yield_now().await;
            }
            assert_eq!(engine.searched().len(), 1);
            engine.gate.as_ref().unwrap().notify_one();
        });
        assert_eq!(result.unwrap().len(), 3);
        assert_eq!(engine.searched().len(), 3);
    }

    #[tokio::test]
    async fn a_later_failure_or_partial_returns_an_error_never_the_prefix() {
        let engine = ScriptedSearch::new(
            Some(three_slices()),
            vec![slice_ok(T0, 1.0), Err("querier crashed".to_string())],
        );
        let err = run(&engine).await.unwrap_err().to_string();
        assert!(err.contains("querier crashed"), "{err}");
        assert!(err.contains("trace-1"), "{err}");
        assert!(
            err.contains(&format!("[{}, {})", T0 + FIVE_MIN_US, T0 + 2 * FIVE_MIN_US)),
            "{err}"
        );
        assert_eq!(engine.searched().len(), 2);

        let mut partial = response(vec![row(T0 + FIVE_MIN_US, json!(2))]);
        partial.is_partial = true;
        partial.function_error = vec!["file list truncated".to_string()];
        let engine = ScriptedSearch::new(
            Some(three_slices()),
            vec![
                slice_ok(T0, 1.0),
                Ok(partial),
                slice_ok(T0 + 2 * FIVE_MIN_US, 3.0),
            ],
        );
        let err = run(&engine).await.unwrap_err().to_string();
        assert!(err.contains("file list truncated"), "{err}");
        assert!(err.contains("trace-1"), "{err}");
        assert_eq!(engine.searched().len(), 2);

        let engine = ScriptedSearch::new(
            Some(three_slices()),
            vec![
                slice_ok(T0, 1.0),
                slice_ok(T0, 2.0),
                slice_ok(T0 + 2 * FIVE_MIN_US, 3.0),
            ],
        );
        assert!(run(&engine).await.is_err());
    }

    #[tokio::test]
    async fn bad_plans_fail_before_any_search() {
        let mut streaming = three_slices();
        streaming.streaming_aggs = true;
        let plans = [
            plan(vec![]),
            streaming,
            plan(vec![
                [T0, T0 + FIVE_MIN_US],
                [T0 + 2 * FIVE_MIN_US, WINDOW.1],
            ]),
        ];
        for p in plans {
            let engine = ScriptedSearch::new(Some(p), vec![]);
            assert!(run(&engine).await.is_err());
            assert!(engine.searched().is_empty());
        }
        let engine = ScriptedSearch {
            plan: Some(Err("planner down".to_string())),
            ..Default::default()
        };
        let err = run(&engine).await.unwrap_err().to_string();
        assert!(err.contains("planner down"), "{err}");
        assert!(engine.searched().is_empty());
    }

    #[tokio::test]
    async fn a_one_slice_plan_behaves_like_one_search() {
        let engine = ScriptedSearch::new(
            Some(plan(vec![[WINDOW.0, WINDOW.1]])),
            vec![slice_ok(T0, 1.0)],
        );
        assert_eq!(run(&engine).await.unwrap().len(), 1);
        assert_eq!(
            engine.searched(),
            vec![("trace".to_string(), WINDOW.0, WINDOW.1, 5)]
        );
    }

    /// Mirrors the leader: real JSON rows with empty objects dropped.
    fn object_response(batch: &RecordBatch) -> Response {
        let rows = config::utils::arrow::record_batches_to_json_rows(&[batch]).unwrap();
        response(
            rows.into_iter()
                .filter(|v| !v.is_empty())
                .map(serde_json::Value::Object)
                .collect(),
        )
    }

    fn arrow_rows(rows: &[(i64, Option<f64>)]) -> RecordBatch {
        let buckets = TimestampMicrosecondArray::from(rows.iter().map(|r| r.0).collect::<Vec<_>>());
        let values = Float64Array::from(rows.iter().map(|r| r.1).collect::<Vec<_>>());
        RecordBatch::try_from_iter(vec![
            (BUCKET_COLUMN, Arc::new(buckets) as ArrayRef),
            (VALUE_COLUMN, Arc::new(values) as ArrayRef),
        ])
        .unwrap()
    }

    fn arrow_engine(
        plan: Option<SearchPartitionResponse>,
        slices: Vec<RecordBatch>,
    ) -> ArrowSearch {
        ArrowSearch {
            plan,
            batches: Mutex::new(slices.into()),
            searched: AtomicUsize::new(0),
        }
    }

    #[test]
    fn json_output_alone_cannot_tell_a_nonfinite_value_from_null() {
        let batch = arrow_rows(&[
            (T0, Some(2.0)),
            (T0 + FIVE_MIN_US, None),
            (T0 + 2 * FIVE_MIN_US, Some(f64::INFINITY)),
        ]);
        let resp = object_response(&batch);
        let hits = &resp.hits;
        assert!(
            hits[1].get(VALUE_COLUMN).is_none()
                && hits[2]
                    .get(VALUE_COLUMN)
                    .is_none_or(serde_json::Value::is_null),
            "{hits:?}"
        );
        let mut series = SeriesAccumulator::default();
        series
            .add_slice(
                &resp,
                [WINDOW.0, WINDOW.1],
                FIVE_MIN_US,
                5,
                &ResultColumns::generated(),
            )
            .unwrap();
        assert_eq!(series.omitted_nulls, 2);
    }

    #[tokio::test]
    async fn an_entirely_null_value_partition_is_skipped_never_zeroed() {
        let all_null = arrow_rows(&[(T0 + FIVE_MIN_US, None)]);
        let resp = object_response(&all_null);
        assert!(
            !resp.hits.is_empty() && resp.hits.iter().all(|hit| hit.get(VALUE_COLUMN).is_none()),
            "{:?}",
            resp.hits
        );

        let engine = arrow_engine(
            Some(three_slices()),
            vec![
                arrow_rows(&[(T0, Some(2.0))]),
                all_null,
                arrow_rows(&[(T0 + 2 * FIVE_MIN_US, Some(0.5))]),
            ],
        );
        let points = run_arrow(&engine).await.unwrap();
        let got: Vec<_> = points.iter().map(|p| (p.timestamp_us, p.value)).collect();
        assert_eq!(got, vec![(T0, 2.0), (T0 + 2 * FIVE_MIN_US, 0.5)]);

        let only_nulls = arrow_rows(&[(T0, None), (T0 + FIVE_MIN_US, None)]);
        let engine = arrow_engine(Some(plan(vec![[WINDOW.0, WINDOW.1]])), vec![only_nulls]);
        let err = run_arrow(&engine).await.unwrap_err().to_string();
        assert!(err.contains("SQL NULL"), "{err}");
        assert!(err.contains(r#"columns present: ["time_bucket"]"#), "{err}");
    }

    #[tokio::test]
    async fn nonfinite_aggregates_become_nulls_for_one_or_many_partitions() {
        let finite_and_null = || {
            vec![
                arrow_rows(&[(T0, Some(2.0))]),
                arrow_rows(&[(T0 + FIVE_MIN_US, None)]),
                arrow_rows(&[(T0 + 2 * FIVE_MIN_US, Some(3.5))]),
            ]
        };
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut sliced = finite_and_null();
            sliced[2] = arrow_rows(&[(T0 + 2 * FIVE_MIN_US, Some(bad))]);
            let engine = arrow_engine(Some(three_slices()), sliced);
            let points = run_arrow(&engine).await.unwrap();
            assert_eq!(points.len(), 1);
            assert_eq!((points[0].timestamp_us, points[0].value), (T0, 2.0));
            assert_eq!(engine.searched.load(Ordering::SeqCst), 3);

            let whole = arrow_rows(&[
                (T0, Some(2.0)),
                (T0 + FIVE_MIN_US, None),
                (T0 + 2 * FIVE_MIN_US, Some(bad)),
            ]);
            let engine = arrow_engine(Some(plan(vec![[WINDOW.0, WINDOW.1]])), vec![whole]);
            let points = run_arrow(&engine).await.unwrap();
            assert_eq!(points.len(), 1);
            assert_eq!((points[0].timestamp_us, points[0].value), (T0, 2.0));
        }

        let engine = arrow_engine(Some(three_slices()), finite_and_null());
        let sliced = run_arrow(&engine).await.unwrap();
        let whole = arrow_rows(&[
            (T0, Some(2.0)),
            (T0 + FIVE_MIN_US, None),
            (T0 + 2 * FIVE_MIN_US, Some(3.5)),
        ]);
        let engine = arrow_engine(Some(plan(vec![[WINDOW.0, WINDOW.1]])), vec![whole]);
        let single = run_arrow(&engine).await.unwrap();
        for points in [sliced, single] {
            let got: Vec<_> = points.iter().map(|p| (p.timestamp_us, p.value)).collect();
            assert_eq!(got, vec![(T0, 2.0), (T0 + 2 * FIVE_MIN_US, 3.5)]);
        }
    }

    async fn run_arrow(engine: &ArrowSearch) -> Result<Vec<QueryDataPoint>> {
        let run = SupportedRun::new("a1", "trace", WINDOW, generated_query())?;
        run.execute(engine, SQL).await
    }
}
