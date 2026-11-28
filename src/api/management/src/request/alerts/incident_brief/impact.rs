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

use std::collections::{BTreeMap, BTreeSet};

use arrow_schema::{DataType, Schema};
use config::{
    meta::{
        alerts::{
            Condition, Operator, QueryType, alert::Alert, incidents::firing_label_may_be_truncated,
        },
        correlation::FieldAlias,
        histogram_origin::histogram_bucket_offset,
        promql::value::Value as PromValue,
        search::{Query, Request, SearchEventType},
        slo::{SliConfig, Slo},
        stream::StreamType,
    },
    utils::sql::{quote_identifier, quote_sql_string},
};
use infra::table::entity::{
    alert_incident_alerts::Model as Firing, alert_incidents::Model as IncidentModel,
};
use openobserve_core::{
    alerts::{AlertSeries, alert_counts_rows, alert_series_sql},
    traces::red_insights::{self, StreamColumns, StreamRead},
};
use serde_json::Value;

use super::{
    Availability, EvidenceAgainstImpact, HiddenSection, Impact, ImpactScope, ImpactSource, Onset,
    Trend,
};

const MICROS_PER_SEC: i64 = 1_000_000;
const MINUTE_SECS: i64 = 60;
const BASELINE_MICROS: i64 = 3600 * MICROS_PER_SEC;
const MAX_POINTS: i64 = 1440;
const QUERY_TIMEOUT_SECS: i64 = 30;
const SERVICE_KEYS: &[&str] = &["service"];
const SERVICE_FIELDS: &[&str] = &["service_name", "service"];
const ENV_KEYS: &[&str] = &["env", "environment"];
const ENV_FIELDS: &[&str] = &[
    "deployment_environment_name",
    "deployment_environment",
    "env",
    "environment",
];
const REGION_KEYS: &[&str] = &["region"];
const REGION_FIELDS: &[&str] = &["cloud_region", "region"];

#[cfg(test)]
static SEARCH_ROWS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, SearchFixture>>,
> = std::sync::LazyLock::new(Default::default);

#[cfg(test)]
struct SearchFixture {
    rows: Vec<Value>,
    requests: Vec<Request>,
}

pub(super) struct ImpactPlan {
    pub onset: Onset,
    pub readable_streams: Vec<(String, String, String)>,
    pub readable_slos: Vec<String>,
    pub query_access: Vec<bool>,
    pub hidden: Vec<HiddenSection>,
    org: String,
    principal: String,
    scope: ImpactScope,
    sources: Vec<Candidate>,
    headline: Option<f64>,
}

impl ImpactPlan {
    pub(super) async fn read(
        &self,
        now: i64,
        raw_limit: &BTreeSet<String>,
    ) -> (Impact, Vec<EvidenceAgainstImpact>) {
        let window = ReadingWindow::new(self.onset.at, now);
        let input = ReadInput {
            org: &self.org,
            principal: &self.principal,
            scope: &self.scope,
            window,
            raw_limit,
        };
        let mut sources = self.sources.iter();
        let mut impact = read_primary(&input, sources.next(), self.headline).await;
        let mut evidence = Vec::new();
        for source in sources.filter(|candidate| candidate.allowed) {
            match source.signal.read(&input).await {
                Ok(reading) => evidence.extend(reading.evidence(source.signal.label())),
                Err(error) => log::warn!("[incident brief] {} impact evidence: {error}", self.org),
            }
        }
        impact.scope = self.scope.clone();
        (impact, evidence)
    }
}

struct Candidate {
    signal: Signal,
    allowed: bool,
}

enum Signal {
    Slo(Box<Slo>),
    Alert(Box<OpeningAlert>),
    TracesRed { stream: String, service: String },
}

impl Signal {
    fn label(&self) -> ImpactSource {
        match self {
            Self::Slo(slo) => ImpactSource::Slo {
                id: slo.id.clone(),
                name: slo.name.clone(),
            },
            Self::Alert(_) => ImpactSource::Alert,
            Self::TracesRed { stream, service } => ImpactSource::TracesRed {
                service: service.clone(),
                stream: stream.clone(),
            },
        }
    }

    async fn read(&self, input: &ReadInput<'_>) -> anyhow::Result<Reading> {
        let series = match self {
            Self::Slo(slo) => slo_series(slo, input.window).await?,
            Self::Alert(opening) => alert_series(opening, input).await?,
            Self::TracesRed { stream, service } => traces_series(stream, service, input).await?,
        };
        Ok(Reading::from_series(series, input.window.onset))
    }
}

struct OpeningAlert {
    alert: Alert,
    labels: Option<String>,
    group_values: Value,
}

#[derive(Clone, Copy)]
struct ReadingWindow {
    start: i64,
    onset: i64,
    end: i64,
    bucket_secs: i64,
}

impl ReadingWindow {
    fn new(onset: i64, now: i64) -> Self {
        let start = onset.saturating_sub(BASELINE_MICROS).max(1);
        let duration_secs = now.saturating_sub(start).max(0) / MICROS_PER_SEC;
        let bucket_secs = (duration_secs / (MAX_POINTS - 2) / MINUTE_SECS + 1) * MINUTE_SECS;
        Self {
            start,
            onset,
            end: now,
            bucket_secs,
        }
    }
}

#[derive(Clone, Copy)]
struct ReadInput<'a> {
    org: &'a str,
    principal: &'a str,
    scope: &'a ImpactScope,
    window: ReadingWindow,
    raw_limit: &'a BTreeSet<String>,
}

struct Reading {
    value: Option<f64>,
    baseline: Option<f64>,
    trend: Option<Trend>,
    series: Vec<(i64, f64)>,
    within_baseline: bool,
}

impl Reading {
    fn from_series(mut series: Vec<(i64, f64)>, onset: i64) -> Self {
        series.retain(|(_, value)| value.is_finite());
        series.sort_by_key(|&(at, _)| at);
        let pre_onset_end = series.partition_point(|&(at, _)| at < onset);
        let (before, current) = series.split_at(pre_onset_end);
        let baseline = mean(before.iter().map(|&(_, value)| value), before.len());
        let value = current.last().map(|&(_, value)| value);
        let trend = current
            .iter()
            .rev()
            .nth(1)
            .zip(value)
            .map(
                |(&(_, previous), latest)| match latest.total_cmp(&previous) {
                    std::cmp::Ordering::Greater => Trend::Rising,
                    std::cmp::Ordering::Equal => Trend::Steady,
                    std::cmp::Ordering::Less => Trend::Falling,
                },
            );
        let within_baseline = value.is_some_and(|value| {
            let min = before.iter().map(|&(_, n)| n).reduce(f64::min);
            let max = before.iter().map(|&(_, n)| n).reduce(f64::max);
            min.zip(max)
                .is_some_and(|(min, max)| (min..=max).contains(&value))
        });
        Self {
            value,
            baseline,
            trend,
            series,
            within_baseline,
        }
    }

    fn evidence(&self, source: ImpactSource) -> Option<EvidenceAgainstImpact> {
        self.within_baseline.then_some(())?;
        Some(EvidenceAgainstImpact {
            source,
            value: self.value?,
            baseline: self.baseline?,
        })
    }

    fn availability(&self) -> Availability {
        if self.series.is_empty() {
            Availability::NoData
        } else {
            Availability::Measured
        }
    }
}

pub(super) async fn plan(
    row: &IncidentModel,
    alert: Option<Alert>,
    opening: Option<&Firing>,
    scope: ImpactScope,
    principal: &str,
) -> anyhow::Result<ImpactPlan> {
    let mut plan = ImpactPlan {
        onset: Onset {
            at: row.impact_start_at.unwrap_or(row.first_alert_at),
            precision_secs: MINUTE_SECS.saturating_add(evaluation_period(alert.as_ref())),
        },
        readable_streams: Vec::new(),
        readable_slos: Vec::new(),
        query_access: Vec::new(),
        hidden: Vec::new(),
        org: row.org_id.clone(),
        principal: principal.to_string(),
        scope,
        sources: Vec::new(),
        headline: row
            .impact_headline
            .as_deref()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite()),
    };
    let service = plan.scope.services.first().cloned();
    add_slos(&mut plan, alert.as_ref(), service.as_deref()).await?;
    let traces = trace_candidates(&plan.org, service.as_deref(), alert.as_ref()).await?;
    if let Some(alert) = alert.filter(has_query) {
        let signal = Signal::Alert(Box::new(OpeningAlert {
            alert,
            labels: opening.and_then(|firing| firing.labels.clone()),
            group_values: row.group_values.clone(),
        }));
        let candidate = authorize_query(&mut plan, signal).await;
        plan.sources.push(candidate);
    }
    add_traces(&mut plan, traces).await;
    plan.readable_streams.sort();
    plan.readable_streams.dedup();
    Ok(plan)
}

#[cfg(test)]
pub(super) fn install_search_rows(org: &str, rows: Vec<Value>) {
    SEARCH_ROWS.lock().unwrap().insert(
        org.to_string(),
        SearchFixture {
            rows,
            requests: Vec::new(),
        },
    );
}

#[cfg(test)]
pub(super) fn search_count(org: &str) -> usize {
    SEARCH_ROWS
        .lock()
        .unwrap()
        .get(org)
        .map_or(0, |fixture| fixture.requests.len())
}

fn evaluation_period(alert: Option<&Alert>) -> i64 {
    alert.map_or(0, |alert| {
        alert
            .trigger_condition
            .period
            .max(0)
            .saturating_mul(MINUTE_SECS)
    })
}

fn has_query(alert: &Alert) -> bool {
    let condition = &alert.query_condition;
    match condition.query_type {
        QueryType::Custom => !alert.stream_name.is_empty(),
        QueryType::SQL => condition
            .sql
            .as_deref()
            .is_some_and(|sql| !sql.trim().is_empty()),
        QueryType::PromQL => condition
            .promql
            .as_deref()
            .is_some_and(|query| !query.trim().is_empty()),
        QueryType::Slo => false,
    }
}

async fn add_slos(
    plan: &mut ImpactPlan,
    alert: Option<&Alert>,
    service: Option<&str>,
) -> anyhow::Result<()> {
    if alert.is_none() && service.is_none() {
        return Ok(());
    }
    let db = infra::db::get_orm_client_ro().await;
    let alert_id = alert.and_then(|alert| alert.id).map(|id| id.to_string());
    let groups = db::system_settings::get_semantic_field_groups(&plan.org).await;
    let mut candidates = Vec::new();
    for slo in infra::table::slos::list(db, &plan.org, None).await? {
        if linked_slo(&slo, alert, alert_id.as_deref()) {
            candidates.push((false, slo));
            continue;
        }
        let matches_service = service.is_some_and(|service| {
            use o2_enterprise::enterprise::{
                downtimes::scope::slo_dimensions, oncall::routing::normalize_value,
            };
            slo_dimensions(&slo, &groups, None).get("service") == Some(&normalize_value(service))
        });
        if matches_service {
            candidates.push((true, slo));
        }
    }
    candidates.sort_by(|(a, left), (b, right)| (a, &left.id).cmp(&(b, &right.id)));
    for (_, slo) in candidates {
        if may_read_slo(&plan.principal, &slo).await {
            plan.readable_slos.push(slo.id.clone());
            plan.sources.push(Candidate {
                signal: Signal::Slo(Box::new(slo)),
                allowed: true,
            });
        } else {
            plan.hidden.push(HiddenSection {
                section: "impact",
                stream_type: "slo".into(),
                stream: slo.id,
            });
        }
    }
    plan.readable_slos.sort();
    Ok(())
}

fn linked_slo(slo: &Slo, alert: Option<&Alert>, alert_id: Option<&str>) -> bool {
    alert.is_some_and(|alert| {
        alert
            .query_condition
            .slo_condition
            .as_ref()
            .is_some_and(|c| c.slo_id == slo.id)
    }) || matches!(
        &slo.definition.sli_config,
        SliConfig::Alert { alert_id: id } if alert_id == Some(id.as_str())
    )
}

async fn may_read_slo(principal: &str, slo: &Slo) -> bool {
    openobserve_core::auth::check_permissions(
        &slo.id,
        &slo.org,
        principal,
        "alerts",
        "GET",
        Some(&slo.folder_id),
        false,
        true,
        false,
    )
    .await
}

async fn trace_candidates(
    org: &str,
    service: Option<&str>,
    alert: Option<&Alert>,
) -> anyhow::Result<Vec<Signal>> {
    let Some(service) = service else {
        return Ok(Vec::new());
    };
    let records = infra::table::service_streams::list_by_name(org, service).await?;
    let mut streams = BTreeSet::new();
    for record in records {
        let names: Vec<String> = serde_json::from_value(record.traces_streams)?;
        streams.extend(names.into_iter().filter(|name| !name.is_empty()));
    }
    if let Some(alert) =
        alert.filter(|a| a.stream_type == StreamType::Traces && !a.stream_name.is_empty())
    {
        streams.insert(alert.stream_name.clone());
    }
    Ok(streams
        .into_iter()
        .map(|stream| Signal::TracesRed {
            stream,
            service: service.to_string(),
        })
        .collect())
}

async fn add_traces(plan: &mut ImpactPlan, traces: Vec<Signal>) {
    if traces.is_empty() {
        return;
    }
    let groups = db::system_settings::get_semantic_field_groups(&plan.org).await;
    let mut readable = Vec::new();
    let mut failed = Vec::new();
    let mut denied = Vec::new();
    for signal in traces {
        let candidate = authorize_query(plan, signal).await;
        if !candidate.allowed {
            denied.push(candidate);
            continue;
        }
        let Signal::TracesRed { stream, .. } = &candidate.signal else {
            continue;
        };
        match infra::schema::get(&plan.org, stream, StreamType::Traces).await {
            Ok(schema)
                if trace_columns(stream, &schema).is_some()
                    && trace_scope_filter(&plan.scope, &schema, &groups).is_some() =>
            {
                readable.push(candidate)
            }
            Ok(_) => {}
            Err(error) => {
                log::warn!("[incident brief] {} trace schema: {error}", plan.org);
                failed.push(candidate);
            }
        }
    }
    plan.sources.extend(readable);
    plan.sources.extend(failed);
    plan.sources.extend(denied);
}

async fn authorize_query(plan: &mut ImpactPlan, signal: Signal) -> Candidate {
    use openobserve_core::authz::{Denial, authorize_query_sources, resolve_query_sources};

    let query = query_sources(&signal, &plan.org);
    let resolved = resolve_query_sources(&query);
    let decision = authorize_query_sources(&plan.principal, &query).await;
    let denied = decision
        .err()
        .map(|error| error.denials)
        .unwrap_or_default();
    let allowed = denied.is_empty();
    for source in resolved.streams {
        if denied.contains(&Denial::Stream(source.clone())) {
            plan.hidden.push(HiddenSection {
                section: "impact",
                stream_type: source.stream_type.to_string(),
                stream: source.name,
            });
        } else {
            plan.readable_streams.push((
                source.org_id,
                source.stream_type.to_string(),
                source.name,
            ));
        }
    }
    for denial in denied {
        let (kind, name) = match denial {
            Denial::Stream(_) => continue,
            Denial::CipherKey(name) => ("cipher_key", name),
            Denial::Dashboard { id, .. } => ("dashboard", id),
            Denial::Unparseable { .. } => ("query", String::new()),
        };
        plan.hidden.push(HiddenSection {
            section: "impact",
            stream_type: kind.into(),
            stream: name,
        });
    }
    plan.query_access.push(allowed);
    Candidate { signal, allowed }
}

fn query_sources(signal: &Signal, org: &str) -> Vec<openobserve_core::authz::QuerySource> {
    use openobserve_core::authz::QuerySource;

    let stream = |stream_type, name: &str| QuerySource::Stream {
        org_id: org.into(),
        stream_type,
        name: name.into(),
    };
    match signal {
        Signal::Slo(_) => Vec::new(),
        Signal::TracesRed { stream: name, .. } => vec![stream(StreamType::Traces, name)],
        Signal::Alert(opening) => {
            let alert = &opening.alert;
            let condition = &alert.query_condition;
            let main = match condition.query_type {
                QueryType::Custom => stream(alert.stream_type, &alert.stream_name),
                QueryType::SQL => QuerySource::Sql {
                    org_id: org.into(),
                    sql: condition.sql.clone().unwrap_or_default(),
                    default_type: alert.stream_type,
                },
                QueryType::PromQL => QuerySource::PromQl {
                    org_id: org.into(),
                    query: condition.promql.clone().unwrap_or_default(),
                },
                QueryType::Slo => return Vec::new(),
            };
            let mut sources = vec![main];
            if let Some(encoded) = &condition.vrl_function {
                match config::utils::base64::decode_url(encoded) {
                    Ok(source) => sources.push(QuerySource::Vrl {
                        org_id: org.into(),
                        source,
                    }),
                    Err(error) => sources.push(QuerySource::Unparseable {
                        org_id: org.into(),
                        source: "alert transform".into(),
                        error: error.to_string(),
                    }),
                }
            }
            sources
        }
    }
}

async fn read_primary(
    input: &ReadInput<'_>,
    candidate: Option<&Candidate>,
    headline: Option<f64>,
) -> Impact {
    let mut impact = Impact {
        value: headline,
        baseline: None,
        trend: None,
        series: None,
        source: None,
        availability: if headline.is_some() {
            Availability::Measured
        } else {
            Availability::NoData
        },
        scope: ImpactScope::default(),
    };
    let Some(candidate) = candidate else {
        return impact;
    };
    if !candidate.allowed {
        if headline.is_none() {
            impact.availability = Availability::Error;
        }
        return impact;
    }
    let signal = &candidate.signal;
    impact.source = Some(signal.label());
    match signal.read(input).await {
        Ok(reading) => {
            impact.availability = reading.availability();
            impact.baseline = reading.baseline;
            impact.trend = reading.trend;
            impact.value = headline.or(reading.value);
            impact.series = Some(reading.series);
        }
        Err(error) => {
            log::warn!("[incident brief] {} impact read: {error}", input.org);
            impact.availability = Availability::Error;
        }
    }
    impact
}

async fn alert_series(
    opening: &OpeningAlert,
    input: &ReadInput<'_>,
) -> anyhow::Result<Vec<(i64, f64)>> {
    let alert = &opening.alert;
    let condition = &alert.query_condition;
    match condition.query_type {
        QueryType::Custom => custom_series(opening, input).await,
        QueryType::SQL => {
            let sql = condition.sql.as_deref().unwrap_or_default();
            saved_sql_series(
                input,
                alert.stream_type,
                sql,
                condition.vrl_function.as_deref(),
            )
            .await
        }
        QueryType::PromQL => {
            let query = condition.promql.as_deref().unwrap_or_default();
            promql_series(input, query).await
        }
        QueryType::Slo => Ok(Vec::new()),
    }
}

async fn custom_series(
    opening: &OpeningAlert,
    input: &ReadInput<'_>,
) -> anyhow::Result<Vec<(i64, f64)>> {
    let alert = &opening.alert;
    let schema = infra::schema::get(input.org, &alert.stream_name, alert.stream_type).await?;
    let groups = db::system_settings::get_semantic_field_groups(input.org).await;
    let filters = custom_filters(opening, input.scope, &schema, &groups)?;
    let sql = alert_series_sql(
        alert,
        &schema,
        input.window.bucket_secs,
        AlertSeries::Impact(&filters),
    )
    .await?;
    let mut input = *input;
    if alert_counts_rows(alert) {
        let step = input.window.bucket_secs * MICROS_PER_SEC;
        input.window.end -= histogram_bucket_offset(input.window.end, step);
    }
    let hits = search_sql(
        &input,
        alert.stream_type,
        sql,
        alert.query_condition.vrl_function.as_deref(),
    )
    .await?;
    required_series(&hits)
}

fn custom_filters(
    opening: &OpeningAlert,
    scope: &ImpactScope,
    schema: &Schema,
    aliases: &[FieldAlias],
) -> anyhow::Result<Vec<Condition>> {
    let service: Vec<String> = opening.group_values["service"]
        .as_str()
        .filter(|s| !s.is_empty() && *s != "unknown")
        .map(str::to_owned)
        .into_iter()
        .collect();
    let mut filters = Vec::new();
    for (keys, defaults, values) in [
        (SERVICE_KEYS, SERVICE_FIELDS, service.as_slice()),
        (ENV_KEYS, ENV_FIELDS, scope.envs.as_slice()),
        (REGION_KEYS, REGION_FIELDS, scope.regions.as_slice()),
    ] {
        if values.is_empty() {
            continue;
        }
        let field = scope_field(schema, aliases, keys, defaults)
            .ok_or_else(|| anyhow::anyhow!("impact stream lacks a {} dimension", keys.join("/")))?;
        filters.push(Condition {
            column: field.into(),
            operator: Operator::In,
            value: serde_json::to_value(values)?,
            ignore_case: false,
            case_insensitive: Some(true),
        });
    }
    let group_filters = opening_group_filters(opening, schema)?;
    filters.extend(group_filters);
    Ok(filters)
}

fn opening_group_filters(
    opening: &OpeningAlert,
    schema: &Schema,
) -> anyhow::Result<Vec<Condition>> {
    let columns = opening
        .alert
        .query_condition
        .aggregation
        .as_ref()
        .and_then(|aggregation| aggregation.group_by.as_deref())
        .unwrap_or_default();
    if columns.is_empty() {
        return Ok(Vec::new());
    }
    let labels = opening
        .labels
        .as_deref()
        .map(serde_json::from_str::<BTreeMap<String, String>>)
        .transpose()?
        .unwrap_or_default();
    columns
        .iter()
        .map(|column| {
            let field = schema.field_with_name(column)?;
            let label = labels
                .get(column)
                .filter(|value| !firing_label_may_be_truncated(value))
                .ok_or_else(|| {
                    anyhow::anyhow!("opening firing lacks an exact group value for {column}")
                })?;
            let is_null = label == "null";
            anyhow::ensure!(
                !is_null
                    || !matches!(
                        field.data_type(),
                        DataType::Utf8 | DataType::Utf8View | DataType::LargeUtf8
                    ),
                "opening firing cannot distinguish null from a string in {column}"
            );
            Ok(Condition {
                column: column.clone(),
                operator: if is_null {
                    Operator::IsNull
                } else {
                    Operator::EqualTo
                },
                value: if is_null {
                    Value::Null
                } else {
                    Value::String(label.clone())
                },
                ignore_case: false,
                case_insensitive: None,
            })
        })
        .collect()
}

async fn saved_sql_series(
    input: &ReadInput<'_>,
    stream_type: StreamType,
    sql: &str,
    vrl: Option<&str>,
) -> anyhow::Result<Vec<(i64, f64)>> {
    let hits = search_sql(input, stream_type, sql.to_owned(), vrl).await?;
    let series = numeric_series(&hits);
    if !series.is_empty() || hits.is_empty() {
        return Ok(series);
    }
    let baseline = ReadingWindow {
        end: input.window.onset,
        ..input.window
    };
    let current = ReadingWindow {
        start: input.window.onset,
        ..input.window
    };
    let mut series = Vec::new();
    for window in [baseline, current] {
        if window.start < window.end {
            let sample_input = ReadInput { window, ..*input };
            let hits = search_sql(&sample_input, stream_type, sql.to_owned(), vrl).await?;
            if let Some(value) = scalar_value(&hits) {
                series.push((window.end - 1, value));
            }
        }
    }
    Ok(series)
}

async fn traces_series(
    stream: &str,
    service: &str,
    input: &ReadInput<'_>,
) -> anyhow::Result<Vec<(i64, f64)>> {
    let schema = infra::schema::get(input.org, stream, StreamType::Traces).await?;
    let Some(columns) = trace_columns(stream, &schema) else {
        return Ok(Vec::new());
    };
    let groups = db::system_settings::get_semantic_field_groups(input.org).await;
    let Some(scope_filter) = trace_scope_filter(input.scope, &schema, &groups) else {
        return Ok(Vec::new());
    };
    let Some(sql) = red_insights::impact_sql(
        stream,
        service,
        &columns,
        input.window.bucket_secs,
        &scope_filter,
    ) else {
        return Ok(Vec::new());
    };
    let hits = search_sql(input, StreamType::Traces, sql, None).await?;
    required_series(&hits)
}

fn trace_columns(stream: &str, schema: &arrow_schema::Schema) -> Option<StreamColumns> {
    let StreamRead::Read(columns) =
        red_insights::read_stream(|field| schema.field_with_name(field).is_ok())
    else {
        return None;
    };
    red_insights::supports_impact(stream, &columns).then_some(columns)
}

fn trace_scope_filter(
    scope: &ImpactScope,
    schema: &Schema,
    groups: &[FieldAlias],
) -> Option<String> {
    use std::fmt::Write;

    let mut filters = String::new();
    for (keys, defaults, values) in [
        (ENV_KEYS, ENV_FIELDS, &scope.envs),
        (REGION_KEYS, REGION_FIELDS, &scope.regions),
    ] {
        if values.is_empty() {
            continue;
        }
        let field = quote_identifier(scope_field(schema, groups, keys, defaults)?);
        let list = values
            .iter()
            .map(|v| quote_sql_string(v))
            .collect::<Vec<_>>()
            .join(", ");
        write!(filters, " AND {field} IN ({list})").expect("String writes cannot fail");
    }
    Some(filters)
}

fn scope_field<'a>(
    schema: &Schema,
    aliases: &'a [FieldAlias],
    keys: &[&str],
    defaults: &'a [&'a str],
) -> Option<&'a str> {
    aliases
        .iter()
        .filter(|group| keys.contains(&group.id.as_str()))
        .flat_map(|group| group.fields.iter().map(String::as_str))
        .chain(defaults.iter().copied())
        .find(|name| schema.field_with_name(name).is_ok())
}

async fn slo_series(slo: &Slo, window: ReadingWindow) -> anyhow::Result<Vec<(i64, f64)>> {
    use openobserve_core::slo::{job::trailing_rollup_sql, reconcile};

    let Some((current, Some(status))) =
        openobserve_core::slo::service::get_with_status(&slo.org, &slo.id).await?
    else {
        return Ok(Vec::new());
    };
    anyhow::ensure!(
        current.folder_id == slo.folder_id
            && current.definition_generation == slo.definition_generation,
        "SLO changed during brief computation"
    );
    let Some(watermark) = status.watermark_end else {
        return Ok(Vec::new());
    };
    let from = window.start / MICROS_PER_SEC;
    let to = watermark.min(window.end / MICROS_PER_SEC);
    if to <= from {
        return Ok(Vec::new());
    }
    let sql = trailing_rollup_sql(
        &slo.id,
        slo.definition_generation,
        from,
        to,
        reconcile::tombstones_possible(slo).await,
    );
    let hits = reconcile::search_all_slices(&slo.org, &sql, from).await?;
    let mut buckets = BTreeMap::<i64, (f64, f64)>::new();
    for hit in &hits {
        let (Some(at), Some(good), Some(total)) = (
            hit["slice_start"].as_i64(),
            hit["good"].as_f64(),
            hit["total"].as_f64(),
        ) else {
            anyhow::bail!("SLO series returned a malformed slice");
        };
        let step = window.bucket_secs.max(slo.definition.slice_interval_secs);
        let (bucket_good, bucket_total) = buckets.entry(at - at.rem_euclid(step)).or_default();
        *bucket_good += good;
        *bucket_total += total;
    }
    Ok(buckets
        .into_iter()
        .filter_map(|(at, (good, total))| {
            (total > 0.0).then_some((at * MICROS_PER_SEC, 100.0 * (1.0 - good / total)))
        })
        .collect())
}

async fn promql_series(input: &ReadInput<'_>, query: &str) -> anyhow::Result<Vec<(i64, f64)>> {
    let super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    let request = promql_service::MetricsQueryRequest {
        query: query.into(),
        start: input.window.start,
        end: input.window.end,
        step: input.window.bucket_secs * MICROS_PER_SEC,
        query_exemplars: false,
        use_cache: Some(false),
        search_type: Some(SearchEventType::Alerts),
        regions: input.scope.regions.clone(),
        clusters: Vec::new(),
        search_event_context: None,
    };
    let response = promql_service::search::search(
        &config::ider::generate_trace_id(),
        input.org,
        &request,
        input.principal,
        QUERY_TIMEOUT_SECS,
        super_cluster,
    )
    .await?;
    promql_points(response)
}

fn promql_points(
    response: promql_service::search::SearchResponse,
) -> anyhow::Result<Vec<(i64, f64)>> {
    anyhow::ensure!(
        response.warnings.is_empty(),
        "incomplete PromQL impact query"
    );
    let matrix = match response.value {
        PromValue::Matrix(matrix) => matrix,
        PromValue::None => return Ok(Vec::new()),
        _ => anyhow::bail!("PromQL impact query did not return a range result"),
    };
    let mut points = BTreeMap::<i64, f64>::new();
    for sample in matrix.iter().flat_map(|series| &series.samples) {
        *points.entry(sample.timestamp).or_default() += sample.value;
    }
    Ok(points.into_iter().collect())
}

async fn search_sql(
    input: &ReadInput<'_>,
    stream_type: StreamType,
    sql: String,
    query_fn: Option<&str>,
) -> anyhow::Result<Vec<Value>> {
    if input.window.start >= input.window.end {
        return Ok(Vec::new());
    }
    let mut request = Request {
        query: Query {
            sql,
            start_time: input.window.start,
            end_time: input.window.end,
            size: MAX_POINTS,
            query_fn: query_fn
                .map(config::utils::base64::decode_url)
                .transpose()?,
            ..Default::default()
        },
        regions: input.scope.regions.clone(),
        timeout: QUERY_TIMEOUT_SECS,
        search_type: Some(SearchEventType::Alerts),
        use_cache: false,
        use_index: true,
        ..Default::default()
    };
    #[cfg(test)]
    if let Some(fixture) = SEARCH_ROWS.lock().unwrap().get_mut(input.org) {
        fixture.requests.push(request);
        return Ok(fixture.rows.clone());
    }
    let trace_id = config::ider::generate_trace_id();
    search_service::raw_streams::resolve_request_with_raw_limit(
        &trace_id,
        input.org,
        stream_type,
        Some(input.principal),
        &mut request,
        input.raw_limit,
    )
    .await;
    let response = search_service::search(
        &trace_id,
        input.org,
        stream_type,
        Some(input.principal.to_string()),
        &request,
    )
    .await?;
    anyhow::ensure!(
        !response.is_partial && response.function_error.is_empty(),
        "incomplete impact query"
    );
    Ok(response.hits)
}

fn numeric_series(hits: &[Value]) -> Vec<(i64, f64)> {
    let mut points = BTreeMap::<i64, f64>::new();
    for row in hits {
        let Some(at) = ["zo_onset_at", "_timestamp", "zo_sql_max_time"]
            .into_iter()
            .find_map(|key| row.get(key).and_then(Value::as_i64))
        else {
            continue;
        };
        *points.entry(at).or_default() += numeric_value(row).unwrap_or(1.0);
    }
    points.into_iter().collect()
}

fn required_series(hits: &[Value]) -> anyhow::Result<Vec<(i64, f64)>> {
    hits.iter()
        .map(|hit| {
            Some((
                hit.get("zo_onset_at")?.as_i64()?,
                hit.get("zo_onset_value")?.as_f64()?,
            ))
        })
        .collect::<Option<_>>()
        .ok_or_else(|| anyhow::anyhow!("impact query returned a malformed numeric sample"))
}

fn numeric_value(row: &Value) -> Option<f64> {
    ["zo_onset_value", "alert_agg_value", "value"]
        .into_iter()
        .find_map(|key| row.get(key).and_then(Value::as_f64))
}

fn scalar_value(rows: &[Value]) -> Option<f64> {
    if rows.len() == 1
        && let Some(row) = rows.first()
    {
        if let Some(value) = numeric_value(row) {
            return Some(value);
        }
        let mut values = row.as_object()?.values().filter_map(Value::as_f64);
        if let Some(value) = values.next()
            && values.next().is_none()
        {
            return Some(value);
        }
    }
    (!rows.is_empty()).then_some(rows.len() as f64)
}

fn mean(values: impl Iterator<Item = f64>, len: usize) -> Option<f64> {
    (len > 0).then(|| values.sum::<f64>() / len as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_and_trend_use_pre_onset_and_current_samples() {
        let series = vec![(10, 0.0), (20, 2.0), (30, 4.0), (40, 6.0)];
        let reading = Reading::from_series(series, 30);
        assert_eq!(reading.value, Some(6.0));
        assert_eq!(reading.baseline, Some(1.0));
        assert_eq!(reading.trend, Some(Trend::Rising));
        assert!(!reading.within_baseline);
    }

    #[test]
    fn an_independent_signal_within_its_baseline_is_counterevidence() {
        let reading = Reading::from_series(vec![(10, 3.0), (20, 3.0), (30, 3.0)], 30);
        assert!(reading.within_baseline);
        assert_eq!(reading.trend, None);
    }

    #[test]
    fn a_partial_promql_read_is_an_error_even_with_samples() {
        use config::meta::promql::value::{RangeValue, Sample};

        let value = PromValue::Matrix(vec![RangeValue {
            labels: vec![],
            samples: vec![Sample {
                timestamp: 30,
                value: 4.0,
            }],
            exemplars: None,
            time_window: None,
        }]);
        let partial = promql_points(promql_service::search::SearchResponse {
            value: value.clone(),
            warnings: vec!["querier unavailable".into()],
        });
        assert!(partial.is_err());
        let complete = promql_points(promql_service::search::SearchResponse {
            value,
            warnings: vec![],
        });
        assert_eq!(complete.unwrap(), vec![(30, 4.0)]);
    }

    #[tokio::test]
    async fn a_denied_source_only_returns_a_published_headline() {
        use openobserve_core::authz::fake_checker;
        use serde_json::json;

        crate::request::security::tests::meta_store().await;
        fake_checker();
        let org = format!("brief-denied-{}", config::ider::generate());
        let viewer = format!("{org}@brief.example");
        let onset = 1_800_000_000_000_000;
        let mut incident = IncidentModel {
            org_id: org.clone(),
            impact_start_at: Some(onset),
            ..Default::default()
        };
        install_search_rows(
            &org,
            vec![json!({"zo_onset_at": onset + 1, "zo_onset_value": 1})],
        );
        for kind in [QueryType::Custom, QueryType::SQL, QueryType::PromQL] {
            let mut alert = Alert::default();
            alert.org_id = org.clone();
            alert.stream_name = "private_app".into();
            alert.query_condition = config::meta::alerts::QueryCondition {
                query_type: kind,
                sql: Some("SELECT COUNT(*) FROM private_app".into()),
                promql: Some("private_app".into()),
                ..Default::default()
            };
            for published in [None, Some("7")] {
                incident.impact_headline = published.map(str::to_owned);
                let plan = plan(
                    &incident,
                    Some(alert.clone()),
                    None,
                    ImpactScope::default(),
                    &viewer,
                )
                .await
                .unwrap();
                assert!(plan.hidden.iter().any(|item| item.stream == "private_app"));
                let (impact, evidence) = plan
                    .read(onset + 2 * 60 * MICROS_PER_SEC, &BTreeSet::new())
                    .await;
                assert_eq!(impact.value, published.map(|_| 7.0));
                assert!(impact.series.is_none());
                assert!(impact.source.is_none());
                assert!(evidence.is_empty());
            }
        }
        assert_eq!(search_count(&org), 0);
    }

    async fn scoped_count_alert() -> (OpeningAlert, ImpactScope) {
        use arrow_schema::Field;
        use config::meta::alerts::{
            AggFunction, Aggregation, AlertConditionParams, ConditionList, QueryCondition,
            incidents::{firing_labels, firing_labels_json},
        };
        use serde_json::json;

        crate::request::security::tests::meta_store().await;
        let org = format!("brief-group-{}", config::ider::generate());
        let stream = "logs";
        let schema = Schema::new(
            ["service", "env", "region", "pod", "level"]
                .map(|name| Field::new(name, DataType::Utf8, true))
                .to_vec(),
        );
        infra::schema::merge(&org, stream, StreamType::Logs, &schema, None)
            .await
            .unwrap();
        let condition = |column: &str, value| Condition {
            column: column.into(),
            operator: Operator::EqualTo,
            value,
            ignore_case: false,
            case_insensitive: None,
        };
        let query = QueryCondition {
            conditions: Some(AlertConditionParams::V1(ConditionList::EndCondition(
                condition("level", json!("error")),
            ))),
            aggregation: Some(Aggregation {
                group_by: Some(vec!["pod".into()]),
                function: AggFunction::Count,
                having: condition("level", json!(3)),
                warning_value: None,
                multi_alert: true,
            }),
            ..Default::default()
        };
        let observed = json!({"pod": "api-2", "count": 4});
        let labels = firing_labels_json(&firing_labels(&query, observed.as_object().unwrap()));
        let mut alert = Alert::default();
        alert.org_id = org;
        alert.stream_name = stream.into();
        alert.query_condition = query;
        let opening = OpeningAlert {
            alert,
            labels,
            group_values: json!({"service": "checkout", "env": "prod", "region": "east"}),
        };
        let scope = ImpactScope {
            services: vec!["checkout".into()],
            envs: vec!["prod".into()],
            regions: vec!["east".into()],
        };
        (opening, scope)
    }

    #[tokio::test]
    async fn custom_count_scopes_the_opening_group_and_measures_observed_zero() {
        use serde_json::json;

        let (opening, scope) = scoped_count_alert().await;
        let org = &opening.alert.org_id;
        let onset = 1_800_000_000_000_000;
        let minute = 60 * MICROS_PER_SEC;
        install_search_rows(
            org,
            vec![
                json!({"zo_onset_at": onset + 1, "zo_onset_value": 4}),
                json!({"zo_onset_at": onset + minute + 1, "zo_onset_value": 0}),
            ],
        );
        let input = ReadInput {
            org,
            principal: "viewer",
            scope: &scope,
            window: ReadingWindow::new(onset, onset + 2 * minute + 10),
            raw_limit: &BTreeSet::new(),
        };
        let series = custom_series(&opening, &input).await.unwrap();
        assert_eq!(Reading::from_series(series, onset).value, Some(0.0));
        let fixtures = SEARCH_ROWS.lock().unwrap();
        let request = &fixtures[org].requests[0];
        let sql = &request.query.sql;
        assert!(sql.contains("COUNT(\"level\") FILTER (WHERE"), "{sql}");
        assert!(sql.contains("\"level\" = 'error'"), "{sql}");
        assert!(sql.contains("\"pod\" = 'api-2'"), "{sql}");
        assert!(sql.contains("lower(\"service\") IN ('checkout')"), "{sql}");
        assert!(sql.contains("lower(\"env\") IN ('prod')"), "{sql}");
        assert!(sql.contains("lower(\"region\") IN ('east')"), "{sql}");
        assert_eq!(request.query.end_time, onset + 2 * minute);
    }

    #[tokio::test]
    async fn custom_count_search_ends_at_the_exclusive_histogram_boundary() {
        use config::meta::histogram_origin::DATE_BIN_ORIGIN_SECS;

        let (opening, scope) = scoped_count_alert().await;
        let org = &opening.alert.org_id;
        install_search_rows(org, Vec::new());
        let minute = 60 * MICROS_PER_SEC;
        let histogram_edge = DATE_BIN_ORIGIN_SECS * MICROS_PER_SEC + 1_000_000 * 7 * minute;
        assert_ne!(histogram_edge.rem_euclid(7 * minute), 0);
        let onset = histogram_edge - (MAX_POINTS - 2) * 6 * minute;
        for now in [histogram_edge, histogram_edge + 9] {
            let input = ReadInput {
                org,
                principal: "viewer",
                scope: &scope,
                window: ReadingWindow::new(onset, now),
                raw_limit: &BTreeSet::new(),
            };
            assert_eq!(input.window.bucket_secs, 420);
            custom_series(&opening, &input).await.unwrap();
            let fixtures = SEARCH_ROWS.lock().unwrap();
            let request = fixtures[org].requests.last().unwrap();
            assert_eq!(request.query.end_time, histogram_edge);
        }
    }

    #[tokio::test]
    async fn truncated_or_missing_firing_labels_never_issue_a_custom_impact_query() {
        use config::meta::alerts::incidents::{firing_labels, firing_labels_json};
        use serde_json::json;

        let (mut opening, scope) = scoped_count_alert().await;
        let org = &opening.alert.org_id;
        install_search_rows(org, Vec::new());
        let onset = 1_800_000_000_000_000;
        let input = ReadInput {
            org,
            principal: "viewer",
            scope: &scope,
            window: ReadingWindow::new(onset, onset + 120 * MICROS_PER_SEC),
            raw_limit: &BTreeSet::new(),
        };
        for pod in [format!("{}💡", "p".repeat(253)), "p".repeat(257)] {
            let observed = json!({"pod": pod});
            opening.labels = firing_labels_json(&firing_labels(
                &opening.alert.query_condition,
                observed.as_object().unwrap(),
            ));
            assert!(custom_series(&opening, &input).await.is_err());
        }
        opening.labels = None;
        opening.group_values["pod"] = json!("another-group");
        assert!(custom_series(&opening, &input).await.is_err());
        assert_eq!(search_count(org), 0);
    }

    #[tokio::test]
    async fn traces_red_skips_readable_streams_missing_the_signal_or_incident_scope() {
        use arrow_schema::Field;
        use infra::table::service_streams::{self, ServiceRecord};
        use openobserve_core::authz::{TypedStream, fake_checker};
        use serde_json::json;

        crate::request::security::tests::meta_store().await;
        let org = format!("brief-red-{}", config::ider::generate());
        let viewer = format!("{org}@brief.example");
        let streams = ["a_obsolete", "b_no_env", "c_no_region", "d_current"];
        for stream in streams {
            let mut fields = vec![
                Field::new("service_name", DataType::Utf8, true),
                Field::new("span_kind", DataType::Int64, true),
            ];
            if stream != "a_obsolete" {
                fields.push(Field::new("span_status", DataType::Utf8, true));
            }
            if stream == "c_no_region" || stream == "d_current" {
                fields.push(Field::new("env", DataType::Utf8, true));
            }
            if stream == "b_no_env" || stream == "d_current" {
                fields.push(Field::new("region", DataType::Utf8, true));
            }
            infra::schema::merge(&org, stream, StreamType::Traces, &Schema::new(fields), None)
                .await
                .unwrap();
            fake_checker().grant_read(
                &viewer,
                &TypedStream {
                    org_id: org.clone(),
                    stream_type: StreamType::Traces,
                    name: stream.into(),
                },
            );
        }
        let mut record = ServiceRecord::new(&org, "checkout", "brief_set", json!({}));
        record.traces_streams = json!(streams);
        let outcome = service_streams::put(&org, record, 5).await.unwrap();
        assert!(outcome.changed);
        let onset = 1_800_000_000_000_000;
        install_search_rows(
            &org,
            vec![json!({"zo_onset_at": onset + 1, "zo_onset_value": 18})],
        );
        let incident = IncidentModel {
            org_id: org.clone(),
            impact_start_at: Some(onset),
            ..Default::default()
        };
        let scope = ImpactScope {
            services: vec!["checkout".into()],
            envs: vec!["prod".into()],
            regions: vec!["east".into()],
        };
        let plan = plan(&incident, None, None, scope, &viewer).await.unwrap();
        let (impact, _) = plan
            .read(onset + 60 * MICROS_PER_SEC, &BTreeSet::new())
            .await;
        assert!(
            matches!(impact.source, Some(ImpactSource::TracesRed { stream, .. }) if stream == "d_current")
        );
        assert_eq!(impact.value, Some(18.0));
        assert_eq!(search_count(&org), 1);
        let fixtures = SEARCH_ROWS.lock().unwrap();
        let sql = &fixtures[&org].requests[0].query.sql;
        assert!(sql.contains("\"env\" IN ('prod')"), "{sql}");
        assert!(sql.contains("\"region\" IN ('east')"), "{sql}");
    }

    #[tokio::test]
    async fn a_slo_without_read_permission_never_enters_the_query_plan() {
        use config::meta::slo::SloDefinition;
        use infra::table::slos;
        use svix_ksuid::KsuidLike;

        crate::request::security::tests::meta_store().await;
        let org = format!("brief-slo-{}", config::ider::generate());
        let alert_id = svix_ksuid::Ksuid::new(None, None);
        let slo = Slo {
            id: config::ider::generate(),
            org: org.clone(),
            folder_id: "default".to_owned(),
            name: "Restricted SLO".into(),
            description: String::new(),
            definition: SloDefinition {
                sli_config: SliConfig::Alert {
                    alert_id: alert_id.to_string(),
                },
                group_by: None,
                window_secs: 3600,
                slice_interval_secs: 60,
            },
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 0,
        };
        let db = infra::db::get_orm_client_rw().await;
        slos::create(db, &slo, 1, None).await.unwrap();
        let incident = IncidentModel {
            org_id: org.clone(),
            ..Default::default()
        };
        let mut alert = Alert::default();
        alert.id = Some(alert_id);
        alert.org_id = org.clone();

        let plan = plan(
            &incident,
            Some(alert),
            None,
            ImpactScope::default(),
            "missing-user@brief.example",
        )
        .await
        .unwrap();

        assert!(plan.readable_slos.is_empty());
        assert!(plan.hidden.iter().any(|item| item.stream_type == "slo"));
        let (impact, evidence) = plan.read(60_000_000, &BTreeSet::new()).await;
        assert!(impact.source.is_none());
        assert!(evidence.is_empty());
        assert!(slos::delete(db, &org, &slo.id).await.unwrap());
    }
}
