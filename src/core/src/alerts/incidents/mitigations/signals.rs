// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    num::NonZeroUsize,
    str::FromStr,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use anyhow::Context;
use common::meta::incidents_v2::{RecoverySettings, recovery_settings};
use config::{
    meta::{
        alerts::{
            AlertConditionParams, ConditionList, Operator, QueryCondition, QueryType,
            TriggerCondition,
            alert::Alert,
            incident_fields::{OnsetDirection, QueryMeasurement, median, recovery_alert_sql},
            incidents::{ContextKind, ContextTarget},
            level::threshold_context,
            recovery::Verdict,
            state::ROLLUP_GROUP_KEY,
        },
        oncall::confidence::SignalClass,
        promql::{
            MetricType,
            value::{Value as PromValue, labels_value},
        },
        search::SearchEventType,
        slo::{SliConfig, Slo, math, window::align_up},
        stream::StreamType,
    },
    utils::{
        sql::{quote_identifier, quote_sql_string},
        time::now_micros,
    },
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{
        alerts as alert_table, entity::incident_contexts as contexts, slo_backfill_jobs, slos,
    },
};
use lru::LruCache;
use promql_parser::{
    label::{MatchOp, Matcher},
    parser::{self as promql, Expr as PromExpr, VectorSelector},
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlparser::{
    ast::{BinaryOperator, Expr, Query, SetExpr, SetOperator, Statement, TableFactor},
    dialect::PostgreSqlDialect,
    parser::Parser,
};
use svix_ksuid::Ksuid;

use super::{
    Check, MAX_PER_ATTEMPT, MINUTE, MitigationError, PreparedWatch, Signal, SignalKind, Watch,
    incident, watch_inputs,
};
use crate::{
    alerts::{
        QueryConditionExt, ScheduledEvaluation,
        alert::{AlertError, get_by_id_db},
        build_sql,
        incidents::declare::{
            capture::{QueryRunner, onset_measurement, record_extreme},
            source,
        },
    },
    authz::{
        Denial, QuerySource, authorize_query_sources, resolve_query_sources, stream_access_message,
    },
    background_access::{alert_sources, slo_sources},
};

const HOUR: i64 = 60 * MINUTE;
const SECOND: i64 = 1_000_000;
const PROBE_LABEL: &str = "zo_recovery_probe";
static READ_ACCESS: LazyLock<Mutex<LruCache<String, ReadAccess>>> =
    LazyLock::new(|| Mutex::new(LruCache::new(NonZeroUsize::new(4096).unwrap())));

#[derive(Serialize)]
struct Target {
    #[serde(flatten)]
    query: ContextTarget,
    sources: Vec<QuerySource>,
}

#[derive(Deserialize)]
struct StoredSources {
    sources: Vec<QuerySource>,
}

struct SignalPlan {
    kind: SignalKind,
    reference: String,
    target: Target,
    measure: Measure,
    direction: OnsetDirection,
    alert_threshold: Option<f64>,
    eval_period_secs: i64,
    slo: Option<Slo>,
}

struct SloSources {
    queries: Vec<QuerySource>,
    alert_revision: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Measure {
    kind: Cow<'static, str>,
    numerator: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    denominator: Option<String>,
    reducer: Cow<'static, str>,
    unit: Cow<'static, str>,
    volume_probe: Option<String>,
    cv: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    group_rank: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slo_generation: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slo_alert_revision: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    rest: Vec<SampleScope>,
}

impl Measure {
    fn value(numerator: String, volume_probe: Option<String>, unit: &'static str) -> Self {
        Self {
            kind: "value".into(),
            numerator,
            denominator: None,
            reducer: "last".into(),
            unit: unit.into(),
            volume_probe,
            cv: 1,
            group_rank: None,
            slo_generation: None,
            slo_alert_revision: None,
            rest: Vec::new(),
        }
    }

    fn ratio(numerator: String, denominator: String) -> Self {
        Self {
            kind: "ratio".into(),
            numerator,
            denominator: Some(denominator.clone()),
            reducer: "sum".into(),
            unit: "%".into(),
            volume_probe: Some(denominator),
            cv: 1,
            group_rank: None,
            slo_generation: None,
            slo_alert_revision: None,
            rest: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct SampleScope {
    region: Option<String>,
    baseline_volume: Option<f64>,
    alert_threshold: f64,
    recover_threshold: f64,
    measure: Measure,
}

struct ReadAccess {
    checked_at: Instant,
    denied: Option<String>,
}

pub(in crate::alerts::incidents) struct Reading {
    pub verdict: Verdict,
    pub value: Option<f64>,
    pub volume_pct: Option<f64>,
    pub verification_blocked: bool,
}

impl Reading {
    pub fn without_values(verdict: Verdict) -> Self {
        Self {
            verdict,
            value: None,
            volume_pct: None,
            verification_blocked: false,
        }
    }
}

struct Baseline {
    value: Option<f64>,
    volume: Option<f64>,
    onset: Option<f64>,
    healthy_gate: bool,
}

#[derive(Default)]
struct PostOnset {
    breaches: BTreeMap<i64, bool>,
    interval: i64,
}

impl PostOnset {
    fn retain_worst(&mut self, other: &Self) {
        self.breaches.retain(|at, bad| {
            let Some(other) = other.breaches.get(at) else {
                return false;
            };
            *bad |= *other;
            true
        });
    }

    fn flap_period_secs(&self) -> Option<i32> {
        let mut previous = None;
        let mut safe_since = None;
        let mut cycles = 0;
        let mut longest = 0;
        for (&at, &bad) in &self.breaches {
            match previous {
                Some((prev, was_bad)) if at - prev == self.interval => {
                    if was_bad && !bad {
                        safe_since = Some(at);
                    } else if bad && let Some(start) = safe_since.take() {
                        cycles += 1;
                        longest = longest.max((at - start) / 1_000_000);
                    }
                }
                _ => safe_since = None,
            }
            previous = Some((at, bad));
        }
        (cycles >= 2).then(|| longest.min(i64::from(i32::MAX)) as i32)
    }
}

#[derive(Default)]
struct BaselineSeries {
    values: BTreeMap<i64, f64>,
    volumes: BTreeMap<i64, f64>,
    healthy_gates: BTreeSet<i64>,
}

impl BaselineSeries {
    fn at_onset(&self, onset: i64) -> Baseline {
        Baseline {
            value: median(self.values.range(..onset).map(|(_, n)| *n).collect()),
            volume: median(self.volumes.range(..onset).map(|(_, n)| *n).collect()),
            onset: self.values.get(&onset).copied(),
            healthy_gate: self.healthy_gates.range(..onset).next().is_some(),
        }
    }

    fn record_promql(
        &mut self,
        label: Option<&str>,
        at: i64,
        value: f64,
        direction: OnsetDirection,
    ) {
        let target = match label {
            Some("value") => &mut self.values,
            Some("volume") => &mut self.volumes,
            _ => return,
        };
        if value.is_finite() {
            record_extreme(target, at, value, direction);
        }
    }
}

pub async fn prepare_watch(
    row: &incident::Model,
    actor: &str,
    watch: Option<&Watch>,
    expect_effect_secs: i32,
    guard_logs: impl AsyncFnOnce(Vec<String>) -> Result<(), MitigationError>,
) -> Result<PreparedWatch, MitigationError> {
    let inputs = watch_inputs(get_orm_client_rw().await, row, watch).await?;
    let signal = match watch.and_then(|w| w.signal.clone()) {
        Some(signal) => signal,
        None => match default_signal(row, inputs.opening_alert.as_deref()).await? {
            Some(signal) => signal,
            None => return Ok(PreparedWatch::None),
        },
    };
    let Some(plan) = load_plan(row, signal).await? else {
        return Ok(PreparedWatch::CannotMeasure);
    };
    authorize_query_sources(actor, &plan.target.sources)
        .await
        .map_err(|_| MitigationError::Forbidden)?;
    let sources = resolve_query_sources(&plan.target.sources);
    if let Some(promql) = &plan.target.query.promql {
        let Some((_, _, counter)) = promql_measure(promql, None) else {
            return Ok(PreparedWatch::CannotMeasure);
        };
        let schema = infra::schema::get(&row.org_id, &counter, StreamType::Metrics)
            .await
            .map_err(anyhow::Error::from)?;
        if !crate::metrics::get_prom_metadata_from_schema(&schema)
            .is_some_and(|metadata| metadata.metric_type == MetricType::Counter)
        {
            return Ok(PreparedWatch::CannotMeasure);
        }
    }
    let logs = sources
        .streams
        .into_iter()
        .filter(|s| s.org_id == row.org_id && s.stream_type == StreamType::Logs)
        .map(|s| s.name)
        .collect();
    guard_logs(logs).await?;
    let regions = &inputs.regions;
    let minute = inputs.onset_minute;
    let settings = recovery_settings();
    let timeout = Duration::from_secs(settings.query_timeout_secs as u64);
    let observed_at = now_micros();
    let mut rows = Vec::with_capacity(regions.len());
    let mut measurements = Vec::with_capacity(regions.len());
    for region in regions {
        let Some(measure) = scope_measure(&plan, region.as_deref()) else {
            return Ok(PreparedWatch::CannotMeasure);
        };
        measurements.push(measure);
    }
    let reads = measurements.iter().zip(regions).map(|(measure, region)| {
        read_signal(
            &plan,
            measure,
            QueryRunner {
                org: &row.org_id,
                user: actor,
                target: &plan.target.query,
                timeout_secs: settings.query_timeout_secs,
            },
            (minute, observed_at),
            region.as_deref(),
            timeout,
        )
    });
    let target = serde_json::to_string(&plan.target).map_err(anyhow::Error::from)?;
    let reads = futures::future::join_all(reads).await;
    if let (Some(slo), Some(revision)) = (&plan.slo, plan.measure.slo_alert_revision)
        && !tokio::time::timeout(
            timeout,
            alert_revision_matches(get_orm_client_rw().await, slo, revision),
        )
        .await
        .context("Recovery source alert revision lookup timed out")??
    {
        return Ok(PreparedWatch::CannotMeasure);
    }
    for ((region, measure), read) in regions.iter().cloned().zip(measurements).zip(reads) {
        let (readings, history, interval) = match read {
            Ok(readings) => readings,
            Err(error) => {
                log::warn!(
                    "[INCIDENTS] Recovery baseline unavailable for {}: {error}",
                    row.id
                );
                return Ok(PreparedWatch::CannotMeasure);
            }
        };
        let Some(check) = scoped_check(
            row,
            actor,
            &plan,
            watch,
            expect_effect_secs,
            &target,
            (region, measure, readings),
        )?
        else {
            return Ok(PreparedWatch::CannotMeasure);
        };
        let history = post_onset(history, interval, &check);
        rows.push((check, history));
    }
    let rows = pack_scopes(rows, plan.eval_period_secs, &settings).map_err(anyhow::Error::from)?;
    Ok(PreparedWatch::Checks(rows, inputs))
}

pub(in crate::alerts::incidents) async fn may_read(viewer: &str, row: &Check) -> bool {
    stored_read_denial(viewer, row).await.is_none()
}

pub(in crate::alerts::incidents) async fn stored_read_denial(
    viewer: &str,
    row: &Check,
) -> Option<String> {
    let target = match serde_json::from_str::<StoredSources>(&row.target) {
        Ok(target) if !target.sources.is_empty() => target,
        Ok(_) | Err(_) => return Some("No stored recovery sources".to_owned()),
    };
    authorize_query_sources(viewer, &target.sources)
        .await
        .err()
        .map(|denied| stream_access_message(&row.org_id, &denied))
}

pub(in crate::alerts::incidents) fn revise_measure(
    check: &Check,
    alert: Option<f64>,
    recover: Option<f64>,
) -> Result<String, MitigationError> {
    let mut measure: Measure = serde_json::from_str(&check.measure).map_err(anyhow::Error::from)?;
    let direction = match check.comparator.as_str() {
        "gt" => OnsetDirection::Up,
        "lt" => OnsetDirection::Down,
        _ => return Err(anyhow::anyhow!("Unknown recovery threshold comparator").into()),
    };
    validate_thresholds(
        direction,
        &measure.unit,
        alert.unwrap_or(check.alert_threshold),
        recover.unwrap_or(check.recover_threshold),
    )?;
    measure.cv = measure
        .cv
        .checked_add(1)
        .context("Condition version overflow")?;
    for scope in &mut measure.rest {
        scope.alert_threshold = alert.unwrap_or(scope.alert_threshold);
        scope.recover_threshold = recover.unwrap_or(scope.recover_threshold);
        validate_thresholds(
            direction,
            &scope.measure.unit,
            scope.alert_threshold,
            scope.recover_threshold,
        )?;
        scope.measure.cv = measure.cv;
    }
    Ok(serde_json::to_string(&measure).map_err(anyhow::Error::from)?)
}

pub(in crate::alerts::incidents) async fn measure(
    db: &DatabaseConnection,
    check: &Check,
    sample_ts: i64,
    settings: &RecoverySettings,
) -> anyhow::Result<Reading> {
    let scopes = sample_scopes(check)?;
    if check.source == "slo" {
        return measure_slo(db, check, &scopes, settings).await;
    }
    let mut stored: serde_json::Map<String, Value> = serde_json::from_str(&check.target)?;
    stored.remove("sources");
    let target: ContextTarget = serde_json::from_value(Value::Object(stored))?;
    let timeout = Duration::from_secs(settings.query_timeout_secs as u64);
    if let Some(verdict) = tokio::time::timeout(
        timeout,
        query_read_denial(check, &target, &scopes, settings.permission_cache_secs),
    )
    .await
    .context("Recovery source authorization timed out")??
    {
        return Ok(Reading::without_values(verdict));
    }
    let start = sample_ts.saturating_sub(settings.window_secs.saturating_mul(1_000_000));
    let runner = QueryRunner {
        org: &check.org_id,
        user: &check.created_by,
        target: &target,
        timeout_secs: settings.query_timeout_secs,
    };
    let scheduled_timeout = (check.source == "alert").then_some(settings.query_timeout_secs);
    let reads =
        futures::future::try_join_all(scopes.iter().map(|scope| {
            measure_query(check, &runner, scope, (start, sample_ts), scheduled_timeout)
        }));
    let readings = tokio::time::timeout(timeout, reads)
        .await
        .context("Recovery query timed out")??;
    let mut reading = worst_reading(check, readings);
    if check.source == "alert"
        && matches!(reading.verdict, Verdict::Pass)
        && let Some(id) = &check.source_ref
        && tokio::time::timeout(
            timeout,
            infra::table::alert_states::get(id, ROLLUP_GROUP_KEY),
        )
        .await
        .context("Alert episode lookup timed out")??
        .is_some_and(|state| state.episode_id.is_some())
    {
        reading.verification_blocked = true;
    }
    Ok(reading)
}

async fn query_read_denial(
    check: &Check,
    target: &ContextTarget,
    scopes: &[SampleScope],
    cache_secs: i64,
) -> anyhow::Result<Option<Verdict>> {
    let mut sources = Vec::new();
    for scope in scopes {
        sources.extend(measurement_sources(check, target, &scope.measure)?);
    }
    if check.source == "alert" {
        let Some(alert) = load_alert(&check.org_id, check.source_ref.as_deref().unwrap_or(""))
            .await
            .map_err(anyhow::Error::new)?
        else {
            return Ok(Some(Verdict::NoData));
        };
        sources.extend(alert_sources(&check.org_id, &alert));
    }
    Ok(denied_reason(check, &sources, cache_secs)
        .await?
        .map(|reason| Verdict::Denied { reason }))
}

fn sample_scopes(check: &Check) -> serde_json::Result<Vec<SampleScope>> {
    let mut measure: Measure = serde_json::from_str(&check.measure)?;
    if !measure.rest.is_empty() {
        return Ok(std::mem::take(&mut measure.rest));
    }
    let scope = check
        .scope
        .as_deref()
        .map(serde_json::from_str::<Value>)
        .transpose()?;
    Ok(vec![SampleScope {
        region: scope.and_then(|scope| scope["region"].as_str().map(str::to_owned)),
        baseline_volume: check.baseline_volume,
        alert_threshold: check.alert_threshold,
        recover_threshold: check.recover_threshold,
        measure,
    }])
}

fn pack_scopes(
    mut rows: Vec<(Check, PostOnset)>,
    eval_period_secs: i64,
    settings: &RecoverySettings,
) -> serde_json::Result<Vec<Check>> {
    if rows.len() > MAX_PER_ATTEMPT {
        rows.sort_by(|(a, _), (b, _)| {
            b.baseline_volume
                .unwrap_or(0.0)
                .total_cmp(&a.baseline_volume.unwrap_or(0.0))
        });
        let rest = rows.split_off(MAX_PER_ATTEMPT - 1);
        rows.extend(pack_rest(rest)?);
    }
    Ok(rows
        .into_iter()
        .map(|(mut check, post_onset)| {
            check.flap_period_secs = post_onset.flap_period_secs();
            let flap = i64::from(check.flap_period_secs.unwrap_or(0));
            check.pass_window_secs = (2 * flap)
                .max(eval_period_secs.saturating_mul(2))
                .clamp(90, settings.pass_window_cap_secs)
                as i32;
            check.soak_secs = (3 * flap).clamp(
                i64::from(settings.soak_floor_secs),
                i64::from(settings.soak_cap_secs),
            ) as i32;
            check
        })
        .collect())
}

fn pack_rest(rest: Vec<(Check, PostOnset)>) -> serde_json::Result<Option<(Check, PostOnset)>> {
    let mut rest = rest.into_iter();
    let Some((mut packed, mut history)) = rest.next() else {
        return Ok(None);
    };
    let mut measure: Measure = serde_json::from_str(&packed.measure)?;
    measure.rest = sample_scopes(&packed)?;
    let down = packed.comparator == "lt";
    let worst = if down { f64::min } else { f64::max };
    for (row, member_history) in rest {
        measure.rest.extend(sample_scopes(&row)?);
        packed.alert_threshold = worst(packed.alert_threshold, row.alert_threshold);
        packed.recover_threshold = worst(packed.recover_threshold, row.recover_threshold);
        history.retain_worst(&member_history);
    }
    let regions: Vec<_> = measure
        .rest
        .iter()
        .filter_map(|scope| scope.region.as_deref())
        .collect();
    packed.scope = Some(json!({"rest": regions}).to_string());
    packed.measure = serde_json::to_string(&measure)?;
    Ok(Some((packed, history)))
}

fn worst_reading(check: &Check, readings: Vec<Reading>) -> Reading {
    let rank = |verdict: &Verdict| match verdict {
        Verdict::Denied { .. } | Verdict::Error | Verdict::RollbackObserved(_) => 5,
        Verdict::NoData => 4,
        Verdict::LowTraffic => 3,
        Verdict::Breach => 2,
        Verdict::NotYet => 1,
        Verdict::Pass => 0,
    };
    let min_volume = readings
        .iter()
        .filter_map(|reading| reading.volume_pct)
        .reduce(f64::min);
    let mut reading = readings
        .into_iter()
        .max_by(|a, b| {
            rank(&a.verdict)
                .cmp(&rank(&b.verdict))
                .then_with(|| match (a.value, b.value) {
                    (Some(a), Some(b)) if check.comparator == "lt" => b.total_cmp(&a),
                    (Some(a), Some(b)) => a.total_cmp(&b),
                    _ => a.value.is_some().cmp(&b.value.is_some()),
                })
        })
        .unwrap_or_else(|| Reading::without_values(Verdict::NoData));
    if reading.verdict.has_signal() {
        reading.volume_pct = min_volume;
    }
    reading
}

fn measurement_sources(
    check: &Check,
    target: &ContextTarget,
    measure: &Measure,
) -> anyhow::Result<Vec<QuerySource>> {
    let probe = measure
        .volume_probe
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("Missing recovery volume probe"))?;
    Ok([&measure.numerator, probe]
        .into_iter()
        .map(|query| {
            if target.promql.is_some() {
                QuerySource::PromQl {
                    org_id: check.org_id.clone(),
                    query: query.clone(),
                }
            } else {
                QuerySource::Sql {
                    org_id: check.org_id.clone(),
                    sql: query.clone(),
                    default_type: target.stream_type(),
                }
            }
        })
        .collect())
}

async fn denied_reason(
    check: &Check,
    sources: &[QuerySource],
    cache_secs: i64,
) -> anyhow::Result<Option<String>> {
    anyhow::ensure!(!sources.is_empty(), "Missing recovery query sources");
    let key = serde_json::to_string(&(&check.org_id, &check.created_by, sources))?;
    let cache_for = Duration::from_secs(cache_secs.max(0) as u64);
    if let Some(entry) = READ_ACCESS.lock().unwrap().get(&key)
        && entry.checked_at.elapsed() < cache_for
    {
        return Ok(entry.denied.clone());
    }
    let checked_at = Instant::now();
    let denied = authorize_query_sources(&check.created_by, sources)
        .await
        .err()
        .map(|denial| {
            denial
                .denials
                .iter()
                .find_map(|item| match item {
                    Denial::Stream(stream) => Some(format!(
                        "creator lost read access to stream {}",
                        stream.display(&check.org_id)
                    )),
                    _ => None,
                })
                .unwrap_or_else(|| "creator lost read access to recovery query".to_string())
                .chars()
                .take(256)
                .collect::<String>()
        });
    READ_ACCESS.lock().unwrap().put(
        key,
        ReadAccess {
            checked_at,
            denied: denied.clone(),
        },
    );
    Ok(denied)
}

async fn measure_query(
    check: &Check,
    runner: &QueryRunner<'_>,
    scope: &SampleScope,
    window: (i64, i64),
    scheduled_timeout: Option<i64>,
) -> anyhow::Result<Reading> {
    let measure = &scope.measure;
    let direction = if check.comparator == "lt" {
        OnsetDirection::Down
    } else {
        OnsetDirection::Up
    };
    let series = query_series(runner, measure, window, direction, scheduled_timeout).await?;
    let Some((&at, &volume)) = series.volumes.last_key_value() else {
        return Ok(Reading::without_values(Verdict::NoData));
    };
    let (value, volume) = if runner.target.promql.is_some() {
        (series.values.get(&at).copied(), volume)
    } else {
        let bucket_us = (window.1.min(at + MINUTE) - window.0.max(at)).max(1);
        let scale = MINUTE as f64 / bucket_us as f64;
        let value = series.values.get(&at).map(|&value| {
            if measure.kind == "rate" {
                value * scale
            } else {
                value
            }
        });
        (value, volume * scale)
    };
    Ok(classify(
        check,
        scope,
        value,
        volume,
        series.healthy_gates.contains(&at),
    ))
}

async fn measure_slo(
    db: &DatabaseConnection,
    check: &Check,
    scopes: &[SampleScope],
    settings: &RecoverySettings,
) -> anyhow::Result<Reading> {
    let id = check.source_ref.as_deref().unwrap_or("");
    let timeout = Duration::from_secs(settings.query_timeout_secs as u64);
    let Some((slo, sources)) =
        tokio::time::timeout(timeout, load_slo_signal(db, &check.org_id, id))
            .await
            .context("Recovery SLO source lookup timed out")??
    else {
        return Ok(Reading::without_values(Verdict::NoData));
    };
    if let Some(verdict) = tokio::time::timeout(
        timeout,
        slo_read_denial(
            check,
            scopes,
            &slo,
            &sources,
            settings.permission_cache_secs,
        ),
    )
    .await
    .context("Recovery SLO authorization timed out")??
    {
        return Ok(Reading::without_values(verdict));
    }
    let read = async {
        let reading = read_slo_status(db, check, scopes, &slo, sources.alert_revision).await?;
        if let Some(expected) = sources.alert_revision
            && !alert_revision_matches(db, &slo, expected).await?
        {
            return Ok(Reading::without_values(Verdict::NoData));
        }
        Ok(reading)
    };
    tokio::time::timeout(timeout, read)
        .await
        .context("Recovery SLO query timed out")?
}

async fn slo_read_denial(
    check: &Check,
    scopes: &[SampleScope],
    slo: &Slo,
    current: &SloSources,
    cache_secs: i64,
) -> anyhow::Result<Option<Verdict>> {
    let stored: StoredSources = serde_json::from_str(&check.target)?;
    if !same_slo_sources(scopes, slo.definition_generation, &stored.sources, current) {
        return Ok(Some(Verdict::NoData));
    }
    Ok(denied_reason(check, &current.queries, cache_secs)
        .await?
        .map(|reason| Verdict::Denied { reason }))
}

fn same_slo_sources(
    scopes: &[SampleScope],
    generation: i32,
    recorded: &[QuerySource],
    current: &SloSources,
) -> bool {
    !recorded.is_empty()
        && recorded == current.queries.as_slice()
        && scopes.iter().all(|scope| {
            scope
                .measure
                .slo_generation
                .is_none_or(|pinned| pinned == generation)
                && scope.measure.slo_alert_revision == current.alert_revision
        })
}

async fn read_slo_status(
    db: &DatabaseConnection,
    check: &Check,
    scopes: &[SampleScope],
    slo: &Slo,
    alert_revision: Option<i64>,
) -> anyhow::Result<Reading> {
    let Some((live_slo, Some(rollup))) =
        crate::slo::service::get_with_status(&check.org_id, &slo.id).await?
    else {
        return Ok(Reading::without_values(Verdict::NoData));
    };
    if rollup.no_data
        || rollup.stale_watermark
        || live_slo.definition_generation != slo.definition_generation
    {
        return Ok(Reading::without_values(Verdict::NoData));
    }
    if let Some(revision) = alert_revision
        && !rollup_covers_alert_revision(db, slo, rollup.watermark_end, revision).await?
    {
        return Ok(Reading::without_values(Verdict::NoData));
    }
    let groups = if scopes.iter().any(|scope| scope.region.is_some()) {
        crate::slo::service::group_status_for(&live_slo).await?
    } else {
        Vec::new()
    };
    let readings = scopes
        .iter()
        .map(|scope| {
            let views = if let Some(region) = &scope.region {
                let key =
                    crate::slo::query::group_key(&["region".to_owned()], &[Some(region.clone())]);
                groups
                    .iter()
                    .filter(|view| has_group_part(&view.group_key, &key))
                    .collect()
            } else {
                vec![&rollup]
            };
            slo_reading(check, scope, &live_slo, views)
        })
        .collect();
    Ok(worst_reading(check, readings))
}

async fn rollup_covers_alert_revision(
    db: &DatabaseConnection,
    slo: &Slo,
    watermark_end: Option<i64>,
    revision: i64,
) -> anyhow::Result<bool> {
    let floor = alert_revision_floor(slo, revision);
    if watermark_end.is_some_and(|end| end.saturating_sub(slo.definition.window_secs) >= floor) {
        return Ok(true);
    }
    // The persisted backfill range bounds older slices even when the rollup window starts earlier.
    Ok(
        slo_backfill_jobs::get(db, &slo.id, slo.definition_generation)
            .await?
            .is_some_and(|job| {
                job.kind == slo_backfill_jobs::KIND_BACKFILL && job.range_start >= floor
            }),
    )
}

fn alert_revision_floor(slo: &Slo, revision: i64) -> i64 {
    align_up(
        revision.div_euclid(SECOND) + i64::from(revision.rem_euclid(SECOND) != 0),
        slo.definition.slice_interval_secs,
    )
}

fn slo_reading(
    check: &Check,
    scope: &SampleScope,
    slo: &Slo,
    views: Vec<&config::meta::slo::SloStatusView>,
) -> Reading {
    if views.is_empty()
        || views
            .iter()
            .any(|view| view.no_data || view.stale_watermark)
    {
        return Reading::without_values(Verdict::NoData);
    }
    let good = views.iter().map(|view| view.good).sum();
    let total: f64 = views.iter().map(|view| view.total).sum();
    let coverage = views
        .iter()
        .map(|view| view.covered_slices)
        .max()
        .unwrap_or(1);
    let minutes = coverage
        .max(1)
        .saturating_mul(slo.definition.slice_interval_secs) as f64
        / 60.0;
    classify(check, scope, math::sli(good, total), total / minutes, false)
}

fn classify(
    check: &Check,
    scope: &SampleScope,
    value: Option<f64>,
    volume: f64,
    healthy_gate: bool,
) -> Reading {
    if !volume.is_finite() || volume <= 0.0 {
        return Reading::without_values(Verdict::NoData);
    }
    let value = value.filter(|value| value.is_finite());
    let volume_pct = scope
        .baseline_volume
        .filter(|&base| base > 0.0)
        .map(|base| volume / base * 100.0)
        .filter(|pct| pct.is_finite());
    let verdict = if volume_pct.is_some_and(|pct| pct < f64::from(check.volume_floor_pct)) {
        Verdict::LowTraffic
    } else if let Some(value) = value {
        let down = check.comparator == "lt";
        let safe = if down {
            value >= scope.recover_threshold
        } else {
            value <= scope.recover_threshold
        };
        match (safe, breaches(value, scope.alert_threshold, down)) {
            (_, true) => Verdict::Breach,
            (true, false) => Verdict::Pass,
            (false, false) => Verdict::NotYet,
        }
    } else if healthy_gate {
        Verdict::Pass
    } else {
        Verdict::NoData
    };
    Reading {
        verdict,
        value,
        volume_pct,
        verification_blocked: false,
    }
}

fn breaches(value: f64, threshold: f64, down: bool) -> bool {
    if down {
        value < threshold
    } else {
        value > threshold
    }
}

fn scoped_check(
    row: &incident::Model,
    actor: &str,
    plan: &SignalPlan,
    watch: Option<&Watch>,
    expect_effect_secs: i32,
    target: &str,
    (region, measure, readings): (Option<String>, Measure, Baseline),
) -> Result<Option<Check>, MitigationError> {
    let Some((alert_threshold, recover_threshold)) = thresholds(plan, watch, &readings)? else {
        return Ok(None);
    };
    Ok(Some(Check {
        org_id: row.org_id.clone(),
        incident_id: row.id.clone(),
        source: kind_name(plan.kind).to_owned(),
        source_ref: Some(plan.reference.clone()),
        target: target.to_owned(),
        measure: serde_json::to_string(&measure).map_err(anyhow::Error::from)?,
        baseline_volume: readings.volume,
        volume_floor_pct: watch.and_then(|w| w.volume_floor_pct).unwrap_or(50),
        scope: region.map(|region| json!({"region": region}).to_string()),
        comparator: if plan.direction == OnsetDirection::Up {
            "gt"
        } else {
            "lt"
        }
        .to_owned(),
        alert_threshold,
        recover_threshold,
        baseline: readings.value,
        expect_effect_secs,
        created_by: actor.to_owned(),
        ..Default::default()
    }))
}

fn kind_name(kind: SignalKind) -> &'static str {
    match kind {
        SignalKind::Alert => "alert",
        SignalKind::Slo => "slo",
        SignalKind::Query => "query",
        SignalKind::TracesRed => "traces_red",
    }
}

async fn default_signal(
    row: &incident::Model,
    opening_alert: Option<&str>,
) -> Result<Option<Signal>, MitigationError> {
    if let Some(id) = opening_alert
        && let Some(alert) = load_alert(&row.org_id, id).await?
    {
        return Ok(Some(match alert.query_condition.slo_condition {
            Some(cond) => Signal {
                kind: SignalKind::Slo,
                source_ref: cond.slo_id,
            },
            None => Signal {
                kind: SignalKind::Alert,
                source_ref: id.to_owned(),
            },
        }));
    }
    Ok(contexts::Entity::find()
        .filter(contexts::Column::OrgId.eq(&row.org_id))
        .filter(contexts::Column::IncidentId.eq(&row.id))
        .filter(contexts::Column::Role.eq("declared"))
        .filter(contexts::Column::DeletedAt.is_null())
        .one(get_orm_client_ro().await)
        .await?
        .map(|ctx| Signal {
            kind: SignalKind::Query,
            source_ref: ctx.id,
        }))
}

async fn load_plan(
    row: &incident::Model,
    signal: Signal,
) -> Result<Option<SignalPlan>, MitigationError> {
    if signal.source_ref.is_empty() || signal.source_ref.chars().count() > 128 {
        return Err(MitigationError::BadRequest(
            "Invalid watch signal reference",
        ));
    }
    let org = row.org_id.as_str();
    let reference = signal.source_ref;
    match signal.kind {
        SignalKind::Alert => {
            let Some(alert) = load_alert(org, &reference).await? else {
                return Ok(None);
            };
            alert_plan(org, reference, alert).await
        }
        SignalKind::Slo => slo_plan(org, reference).await,
        SignalKind::Query => {
            let db = get_orm_client_ro().await;
            let Some(ctx) =
                infra::table::incident_contexts::get(db, org, &row.id, &reference).await?
            else {
                return Err(MitigationError::BadRequest("Watch context not found"));
            };
            let query: ContextTarget =
                serde_json::from_str(&ctx.target).map_err(anyhow::Error::from)?;
            if !query.has_query() {
                return Ok(None);
            }
            let kind: ContextKind =
                serde_json::from_value(Value::String(ctx.kind)).map_err(anyhow::Error::from)?;
            let (sources, _) = source::queries(org, &query, kind)
                .map_err(|_| MitigationError::BadRequest("Invalid watch query"))?;
            query_plan(signal.kind, reference, Target { query, sources })
        }
        SignalKind::TracesRed => traces_plan(row, reference).await,
    }
}

async fn load_alert(org: &str, id: &str) -> Result<Option<Alert>, MitigationError> {
    let Ok(id) = Ksuid::from_str(id) else {
        return Ok(None);
    };
    match get_by_id_db(org, id).await {
        Ok(alert) => Ok(Some(alert)),
        Err(AlertError::AlertNotFound) => Ok(None),
        Err(err) => Err(anyhow::Error::new(err).into()),
    }
}

async fn alert_plan(
    org: &str,
    reference: String,
    alert: Alert,
) -> Result<Option<SignalPlan>, MitigationError> {
    let query = &alert.query_condition;
    if let Some(cond) = &query.slo_condition {
        return slo_plan(org, cond.slo_id.clone()).await;
    }
    let (op, threshold, warning) = threshold_context(&alert);
    let direction = match op {
        Operator::GreaterThan | Operator::GreaterThanEquals => OnsetDirection::Up,
        Operator::LessThan | Operator::LessThanEquals => OnsetDirection::Down,
        _ => return Ok(None),
    };
    let mut target = empty_target(alert.stream_type);
    target.streams.push(alert.stream_name.clone());
    let period = alert.trigger_condition.period.saturating_mul(60);
    if warning.is_some() || alert.trigger_condition.warning_threshold.is_some() {
        return Ok(None);
    }
    let measure = match query.query_type {
        QueryType::Custom | QueryType::SQL => {
            let Some(measure) =
                alert_sql_measure(org, &alert, &mut target, (op, threshold)).await?
            else {
                return Ok(None);
            };
            measure
        }
        QueryType::PromQL => {
            if matching_groups(&alert) != Some(1)
                || query.promql_multi_alert
                || query.promql_rule_mode
            {
                return Ok(None);
            }
            let Some(query) = &query.promql else {
                return Ok(None);
            };
            let Some((numerator, volume, _)) = promql_measure(query, None) else {
                return Ok(None);
            };
            target.promql = Some(query.clone());
            Measure::value(numerator, Some(volume), "value")
        }
        QueryType::Slo => return Ok(None),
    };
    Ok(Some(SignalPlan {
        kind: SignalKind::Alert,
        reference,
        target: Target {
            query: target,
            sources: alert_sources(org, &alert),
        },
        measure,
        direction,
        alert_threshold: Some(threshold),
        eval_period_secs: period,
        slo: None,
    }))
}

async fn alert_sql_measure(
    org: &str,
    alert: &Alert,
    target: &mut ContextTarget,
    (operator, threshold): (Operator, f64),
) -> Result<Option<Measure>, MitigationError> {
    let query = &alert.query_condition;
    if alert.trigger_condition.period != 1
        || query
            .search_event_type
            .is_some_and(|kind| kind != config::meta::search::SearchEventType::Alerts)
        || query.vrl_function.is_some()
        || query
            .multi_time_range
            .as_ref()
            .is_some_and(|ranges| !ranges.is_empty())
    {
        return Ok(None);
    }
    let custom = query.query_type == QueryType::Custom;
    let sql = if custom {
        let empty = AlertConditionParams::V1(ConditionList::AndNode { and: Vec::new() });
        let conditions = query.conditions.as_ref().unwrap_or(&empty);
        build_sql(
            org,
            &alert.stream_name,
            alert.stream_type,
            query,
            conditions,
        )
        .await?
    } else if let Some(sql) = &query.sql {
        sql.clone()
    } else {
        return Ok(None);
    };
    let (aggregate, group_rank) = if let Some(agg) = &query.aggregation {
        let Some(rank) = matching_groups(alert).filter(|_| !agg.multi_alert) else {
            return Ok(None);
        };
        let column = if custom {
            "alert_agg_value"
        } else {
            agg.having.column.as_str()
        };
        (Some((column, operator, threshold)), Some(rank))
    } else {
        (None, None)
    };
    let Some((numerator, volume)) = recovery_alert_sql(&sql, aggregate) else {
        return Ok(None);
    };
    target.sql = Some(sql);
    let mut measure = Measure::value(numerator, Some(volume), "value");
    measure.group_rank = group_rank;
    if group_rank.is_none() {
        measure.kind = "rate".into();
        measure.reducer = "sum".into();
        measure.unit = "rows/min".into();
    }
    Ok(Some(measure))
}

fn matching_groups(alert: &Alert) -> Option<usize> {
    let trigger = &alert.trigger_condition;
    let minimum = match trigger.operator {
        Operator::GreaterThan => trigger.threshold.checked_add(1)?,
        Operator::GreaterThanEquals => trigger.threshold,
        _ => return None,
    };
    usize::try_from(minimum).ok().filter(|count| *count > 0)
}

async fn slo_plan(org: &str, reference: String) -> Result<Option<SignalPlan>, MitigationError> {
    let Some((slo, sources)) = load_slo_signal(get_orm_client_rw().await, org, &reference).await?
    else {
        return Ok(None);
    };
    let mut measure = Measure::ratio("good".to_owned(), "total".to_owned());
    measure.slo_generation = Some(slo.definition_generation);
    measure.slo_alert_revision = sources.alert_revision;
    Ok(Some(SignalPlan {
        kind: SignalKind::Slo,
        reference,
        alert_threshold: Some(slo.target),
        direction: OnsetDirection::Down,
        eval_period_secs: 0,
        target: Target {
            query: empty_target(StreamType::Logs),
            sources: sources.queries,
        },
        measure,
        slo: Some(slo),
    }))
}

async fn load_slo_signal(
    db: &DatabaseConnection,
    org: &str,
    id: &str,
) -> anyhow::Result<Option<(Slo, SloSources)>> {
    let Some(slo) = slos::get(db, org, id).await? else {
        return Ok(None);
    };
    let sources = match &slo.definition.sli_config {
        SliConfig::Alert { alert_id } => {
            let Some(sources) = alert_slo_sources(db, &slo, alert_id).await? else {
                return Ok(None);
            };
            sources
        }
        SliConfig::Count { .. } | SliConfig::TimeSlice { .. } => SloSources {
            queries: slo_sources(&slo),
            alert_revision: None,
        },
    };
    Ok((!sources.queries.is_empty()).then_some((slo, sources)))
}

async fn alert_slo_sources(
    db: &DatabaseConnection,
    slo: &Slo,
    alert_id: &str,
) -> anyhow::Result<Option<SloSources>> {
    let Some(revision) = alert_table::last_written_us(db, &slo.org, alert_id).await? else {
        return Ok(None);
    };
    let reset = slos::generation_reset_time_for(db, slo).await?;
    if !epoch_covers_revision(reset, revision) {
        return Ok(None);
    }
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return Ok(None);
    };
    let Some((_, alert)) = alert_table::get_by_id(db, &slo.org, id).await? else {
        return Ok(None);
    };
    if !alert_revision_matches(db, slo, revision).await? {
        return Ok(None);
    }
    Ok(Some(SloSources {
        queries: alert_sources(&slo.org, &alert),
        alert_revision: Some(revision),
    }))
}

fn epoch_covers_revision(reset: Option<i64>, revision: i64) -> bool {
    // A seconds-resolution reset cannot prove it followed a source edit later in that second.
    reset.is_some_and(|reset| reset.saturating_mul(SECOND) > revision)
}

async fn alert_revision_matches(
    db: &DatabaseConnection,
    slo: &Slo,
    revision: i64,
) -> anyhow::Result<bool> {
    let SliConfig::Alert { alert_id } = &slo.definition.sli_config else {
        return Ok(false);
    };
    Ok(alert_table::last_written_us(db, &slo.org, alert_id).await? == Some(revision))
}

async fn traces_plan(
    row: &incident::Model,
    service: String,
) -> Result<Option<SignalPlan>, MitigationError> {
    let records = infra::table::service_streams::list_by_name(&row.org_id, &service)
        .await
        .map_err(anyhow::Error::from)?;
    let streams: BTreeSet<String> = records
        .into_iter()
        .map(|record| serde_json::from_value::<Vec<String>>(record.traces_streams))
        .collect::<Result<Vec<_>, _>>()
        .map_err(anyhow::Error::from)?
        .into_iter()
        .flatten()
        .collect();
    if streams.is_empty() {
        return Ok(None);
    }
    let service_literal = quote_sql_string(&service);
    let from = streams
        .iter()
        .map(|stream| {
            format!(
                "SELECT _timestamp, span_status FROM {} WHERE service_name = {service_literal}",
                quote_identifier(stream),
            )
        })
        .collect::<Vec<_>>()
        .join(" UNION ALL ");
    let bucket = |expr: &str| {
        format!(
            "SELECT histogram(_timestamp, '1 minute') AS bucket, MIN(_timestamp) AS zo_onset_at,
         {expr} AS zo_onset_value FROM ({from}) AS spans GROUP BY bucket",
        )
    };
    let numerator = bucket("COUNT(*) FILTER (WHERE span_status = 'ERROR')");
    let denominator = bucket("COUNT(*)");
    let mut query = empty_target(StreamType::Traces);
    query.streams = streams.into_iter().collect();
    query.sql = Some(numerator.clone());
    let sources = vec![QuerySource::Sql {
        org_id: row.org_id.clone(),
        sql: numerator.clone(),
        default_type: StreamType::Traces,
    }];
    Ok(Some(SignalPlan {
        kind: SignalKind::TracesRed,
        reference: service,
        target: Target { query, sources },
        measure: Measure::ratio(numerator, denominator),
        direction: OnsetDirection::Up,
        alert_threshold: None,
        eval_period_secs: 0,
        slo: None,
    }))
}

fn query_plan(
    kind: SignalKind,
    reference: String,
    target: Target,
) -> Result<Option<SignalPlan>, MitigationError> {
    let (measure, direction) = match onset_measurement(&target.query)? {
        QueryMeasurement::Unsupported => return Ok(None),
        QueryMeasurement::SqlRatio {
            numerator,
            denominator,
        } => (Measure::ratio(numerator, denominator), OnsetDirection::Up),
        QueryMeasurement::SqlValue {
            value,
            volume,
            direction,
        } => (Measure::value(value, Some(volume), "value"), direction),
        QueryMeasurement::SqlRate { rate, volume } => {
            let mut measure = Measure::value(rate, Some(volume), "rows/min");
            measure.kind = "rate".into();
            measure.reducer = "sum".into();
            (measure, OnsetDirection::Up)
        }
        QueryMeasurement::PromqlValue { query, direction } => {
            let Some((numerator, volume, _)) = promql_measure(&query, None) else {
                return Ok(None);
            };
            (Measure::value(numerator, Some(volume), "value"), direction)
        }
    };
    Ok(Some(SignalPlan {
        kind,
        reference,
        target,
        measure,
        direction,
        alert_threshold: None,
        eval_period_secs: 0,
        slo: None,
    }))
}

fn empty_target(stream_type: StreamType) -> ContextTarget {
    ContextTarget {
        signal: match stream_type {
            StreamType::Metrics => SignalClass::Metrics,
            StreamType::Traces => SignalClass::Traces,
            _ => SignalClass::Logs,
        },
        streams: Vec::new(),
        stream_type: Some(stream_type),
        sql: None,
        promql: None,
        filter: None,
        function: None,
        start_us: 0,
        end_us: 0,
        fingerprint: None,
    }
}

fn thresholds(
    plan: &SignalPlan,
    watch: Option<&Watch>,
    baseline: &Baseline,
) -> Result<Option<(f64, f64)>, MitigationError> {
    let Some(alert) = watch
        .and_then(|w| w.alert_threshold)
        .or(plan.alert_threshold)
        .or(baseline.onset)
    else {
        return Ok(None);
    };
    let Some(recover) = watch
        .and_then(|w| w.recover_threshold)
        .or_else(|| default_recovery_threshold(baseline, alert, plan.direction))
    else {
        return Ok(None);
    };
    validate_thresholds(plan.direction, &plan.measure.unit, alert, recover)?;
    Ok(Some((alert, recover)))
}

fn validate_thresholds(
    direction: OnsetDirection,
    unit: &str,
    alert: f64,
    recover: f64,
) -> Result<(), MitigationError> {
    let safe = match direction {
        OnsetDirection::Up => recover < alert,
        OnsetDirection::Down => recover > alert,
    };
    let valid = |v: f64| v.is_finite() && (unit != "%" || (0.0..=100.0).contains(&v));
    if !safe || !valid(recover) || !valid(alert) {
        return Err(MitigationError::BadRequest(
            "Recovery threshold must be strictly on the safe side of the alert threshold",
        ));
    }
    Ok(())
}

fn default_recovery_threshold(
    baseline: &Baseline,
    alert: f64,
    direction: OnsetDirection,
) -> Option<f64> {
    baseline
        .value
        .map(|value| value + (alert - value) / 2.0)
        .or_else(|| {
            // A healthy count gate bounds the missing value to the safe side of the alert line.
            baseline.healthy_gate.then(|| match direction {
                OnsetDirection::Up => alert.next_down(),
                OnsetDirection::Down => alert.next_up(),
            })
        })
}

fn scope_measure(plan: &SignalPlan, region: Option<&str>) -> Option<Measure> {
    let mut measure = plan.measure.clone();
    let Some(region) = region else {
        return Some(measure);
    };
    if let Some(slo) = &plan.slo {
        let grouped_by_region = slo
            .definition
            .group_by
            .as_ref()
            .is_some_and(|columns| columns.iter().any(|column| column == "region"));
        return grouped_by_region.then_some(measure);
    }
    if let Some(query) = &plan.target.query.promql {
        let (numerator, volume, _) = promql_measure(query, Some(region))?;
        measure.numerator = numerator;
        measure.volume_probe = Some(volume);
    } else {
        measure.numerator = region_sql(&measure.numerator, region)?;
        if let Some(probe) = &mut measure.volume_probe {
            *probe = region_sql(probe, region)?;
        }
        if let Some(denominator) = &mut measure.denominator {
            *denominator = region_sql(denominator, region)?;
        }
    }
    Some(measure)
}

fn region_sql(sql: &str, region: &str) -> Option<String> {
    let mut probe = Parser::parse_sql(
        &PostgreSqlDialect {},
        &format!("SELECT 1 WHERE region = {}", quote_sql_string(region),),
    )
    .ok()?;
    let [Statement::Query(probe)] = probe.as_mut_slice() else {
        return None;
    };
    let SetExpr::Select(select) = probe.body.as_mut() else {
        return None;
    };
    let predicate = select.selection.take()?;
    let mut statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).ok()?;
    let [Statement::Query(query)] = statements.as_mut_slice() else {
        return None;
    };
    scope_from(query, &predicate)?;
    Some(query.to_string())
}

fn scope_from(query: &mut Query, predicate: &Expr) -> Option<()> {
    if query.with.is_some() {
        return None;
    }
    scope_relation(query.body.as_mut(), predicate)
}

fn scope_relation(set: &mut SetExpr, predicate: &Expr) -> Option<()> {
    match set {
        SetExpr::Select(select) => {
            let [table] = select.from.as_mut_slice() else {
                return None;
            };
            if !table.joins.is_empty() {
                return None;
            }
            match &mut table.relation {
                TableFactor::Table { args: None, .. } => {
                    let predicate = predicate.clone();
                    select.selection = Some(match select.selection.take() {
                        Some(prior) => Expr::BinaryOp {
                            left: Box::new(Expr::Nested(Box::new(prior))),
                            op: BinaryOperator::And,
                            right: Box::new(predicate),
                        },
                        None => predicate,
                    });
                    Some(())
                }
                TableFactor::Derived { subquery, .. } => scope_from(subquery, predicate),
                _ => None,
            }
        }
        SetExpr::SetOperation {
            op: SetOperator::Union,
            left,
            right,
            ..
        } => {
            scope_relation(left, predicate)?;
            scope_relation(right, predicate)
        }
        _ => None,
    }
}

fn promql_measure(query: &str, region: Option<&str>) -> Option<(String, String, String)> {
    let mut expr = promql::parse(query).ok()?;
    let mut counters = BTreeSet::new();
    let mut unsupported = false;
    visit_selectors(&mut expr, &mut |selector| {
        if let Some(region) = region {
            selector
                .matchers
                .matchers
                .push(Matcher::new(MatchOp::Equal, "region", region));
        }
        let Some(name) = selector
            .name
            .as_deref()
            .filter(|name| matches!(*name, "http_requests_total" | "http_server_requests_total"))
        else {
            unsupported = true;
            return;
        };
        if selector.offset.is_some()
            || selector.at.is_some()
            || !selector.matchers.or_matchers.is_empty()
        {
            unsupported = true;
            return;
        }
        let mut raw = selector.clone();
        raw.matchers.matchers.retain(|matcher| {
            !matches!(
                matcher.name.as_str(),
                "status" | "status_code" | "code" | "http_status_code"
            )
        });
        counters.insert((name.to_owned(), raw.to_string()));
    });
    if unsupported || counters.len() != 1 {
        return None;
    }
    let (name, raw) = counters.into_iter().next()?;
    Some((
        expr.to_string(),
        format!("sum(increase({raw}[5m])) / 5"),
        name,
    ))
}

fn visit_selectors(expr: &mut PromExpr, visit: &mut impl FnMut(&mut VectorSelector)) {
    match expr {
        PromExpr::VectorSelector(selector) => visit(selector),
        PromExpr::MatrixSelector(selector) => visit(&mut selector.vs),
        PromExpr::Aggregate(aggregate) => {
            visit_selectors(&mut aggregate.expr, visit);
            if let Some(param) = &mut aggregate.param {
                visit_selectors(param, visit);
            }
        }
        PromExpr::Unary(unary) => visit_selectors(&mut unary.expr, visit),
        PromExpr::Binary(binary) => {
            visit_selectors(&mut binary.lhs, visit);
            visit_selectors(&mut binary.rhs, visit);
        }
        PromExpr::Paren(paren) => visit_selectors(&mut paren.expr, visit),
        PromExpr::Subquery(subquery) => visit_selectors(&mut subquery.expr, visit),
        PromExpr::Call(call) => {
            for argument in &mut call.args.args {
                visit_selectors(argument, visit);
            }
        }
        PromExpr::NumberLiteral(_) | PromExpr::StringLiteral(_) | PromExpr::Extension(_) => {}
    }
}

async fn read_signal(
    plan: &SignalPlan,
    measure: &Measure,
    runner: QueryRunner<'_>,
    (onset, now): (i64, i64),
    region: Option<&str>,
    timeout: Duration,
) -> anyhow::Result<(Baseline, BaselineSeries, i64)> {
    let read = |window| plan_series(&runner, plan, measure, window, region);
    let interval = plan
        .slo
        .as_ref()
        .map_or(MINUTE, |slo| slo.definition.slice_interval_secs * 1_000_000);
    let base_window = (onset.saturating_sub(HOUR).max(0), onset + MINUTE);
    let end = now - now.rem_euclid(interval);
    let history = async {
        if end - onset < 5 * interval {
            return BaselineSeries::default();
        }
        match tokio::time::timeout(timeout, read((onset, end))).await {
            Ok(Ok(mut series)) => {
                series.volumes.retain(|&at, _| at >= onset && at < end);
                series
            }
            Ok(Err(error)) => {
                log::warn!(
                    "[INCIDENTS] Recovery flap history unavailable for {}: {error}",
                    plan.reference
                );
                BaselineSeries::default()
            }
            Err(error) => {
                log::warn!(
                    "[INCIDENTS] Recovery flap history timed out for {}: {error}",
                    plan.reference
                );
                BaselineSeries::default()
            }
        }
    };
    let (baseline, history) =
        tokio::join!(tokio::time::timeout(timeout, read(base_window)), history);
    Ok((baseline??.at_onset(onset), history, interval))
}

async fn plan_series(
    runner: &QueryRunner<'_>,
    plan: &SignalPlan,
    measure: &Measure,
    window: (i64, i64),
    region: Option<&str>,
) -> anyhow::Result<BaselineSeries> {
    if let Some(slo) = &plan.slo {
        let start = measure.slo_alert_revision.map_or(window.0, |revision| {
            window.0.max(alert_revision_floor(slo, revision) * SECOND)
        });
        if start >= window.1 {
            return Ok(BaselineSeries::default());
        }
        slo_baseline(runner, slo, (start, window.1), region).await
    } else {
        query_series(runner, measure, window, plan.direction, None).await
    }
}

fn post_onset(series: BaselineSeries, interval: i64, check: &Check) -> PostOnset {
    let floor = check.baseline_volume.unwrap_or(0.0) * f64::from(check.volume_floor_pct) / 100.0;
    let down = check.comparator == "lt";
    let breaches = series
        .volumes
        .into_iter()
        .filter_map(|(at, volume)| {
            if !volume.is_finite() || volume <= 0.0 || volume < floor {
                return None;
            }
            if let Some(value) = series.values.get(&at).filter(|value| value.is_finite()) {
                Some((at, breaches(*value, check.alert_threshold, down)))
            } else {
                series.healthy_gates.contains(&at).then_some((at, false))
            }
        })
        .collect();
    PostOnset { breaches, interval }
}

async fn query_series(
    runner: &QueryRunner<'_>,
    measure: &Measure,
    window: (i64, i64),
    direction: OnsetDirection,
    scheduled_timeout: Option<i64>,
) -> anyhow::Result<BaselineSeries> {
    let probe = measure
        .volume_probe
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Missing recovery volume probe"))?;
    if runner.target.promql.is_some() {
        return promql_baseline(
            runner,
            &measure.numerator,
            probe,
            window,
            direction,
            scheduled_timeout,
        )
        .await;
    }
    let sql = format!(
        "SELECT zo_onset_at, CAST(zo_onset_value AS DOUBLE) AS zo_onset_value, false AS zo_is_volume
         FROM ({}) AS recovery_value
         UNION ALL
         SELECT zo_onset_at, CAST(zo_onset_value AS DOUBLE) AS zo_onset_value, true AS zo_is_volume
         FROM ({probe}) AS recovery_volume",
        measure.numerator,
    );
    let rows = if let Some(timeout) = scheduled_timeout {
        scheduled_sql_samples(runner, sql, window, timeout).await?
    } else {
        runner.sql(sql, window, None).await?.hits
    };
    Ok(sql_baseline_rows(rows, measure, direction))
}

async fn scheduled_sql_samples(
    runner: &QueryRunner<'_>,
    sql: String,
    window: (i64, i64),
    timeout_secs: i64,
) -> anyhow::Result<Vec<Value>> {
    runner.check_sql_window(&sql, window).await?;
    let condition = QueryCondition {
        query_type: QueryType::SQL,
        sql: Some(sql),
        // Recovery needs the healthy values that alert threshold filtering drops.
        search_event_type: Some(SearchEventType::UI),
        ..Default::default()
    };
    Ok(
        scheduled_samples(runner, condition, window, timeout_secs, None)
            .await?
            .into_iter()
            .map(Value::Object)
            .collect(),
    )
}

async fn scheduled_samples(
    runner: &QueryRunner<'_>,
    condition: QueryCondition,
    window: (i64, i64),
    timeout_secs: i64,
    raw_promql_step: Option<i64>,
) -> anyhow::Result<Vec<serde_json::Map<String, Value>>> {
    let result = condition
        .evaluate_scheduled(ScheduledEvaluation {
            org_id: runner.org,
            stream_name: None,
            stream_type: runner.target.stream_type(),
            trigger_condition: &TriggerCondition {
                period: (window.1 - window.0 + MINUTE - 1) / MINUTE,
                ..Default::default()
            },
            range: (Some(window.0), window.1),
            search_type: Some(SearchEventType::Alerts),
            search_event_context: None,
            trace_id: None,
            user_id: Some(runner.user),
            timeout_secs,
            raw_promql_step,
        })
        .await?;
    Ok(result.data.unwrap_or_default())
}

fn sql_baseline_rows(
    rows: Vec<Value>,
    measure: &Measure,
    direction: OnsetDirection,
) -> BaselineSeries {
    let mut values = BTreeMap::new();
    let mut volumes = BTreeMap::new();
    let mut groups = BTreeMap::<i64, Vec<f64>>::new();
    for row in rows {
        let (Some(at), Some(value)) = (row["zo_onset_at"].as_i64(), row["zo_onset_value"].as_f64())
        else {
            continue;
        };
        if row["zo_is_volume"].as_bool() == Some(true) {
            record_extreme(&mut volumes, at, value, OnsetDirection::Up);
        } else if measure.group_rank.is_some() {
            groups
                .entry(at - at.rem_euclid(MINUTE))
                .or_default()
                .push(value);
        } else {
            record_extreme(&mut values, at, value, direction);
        }
    }
    let mut healthy_gates = BTreeSet::new();
    if let Some(rank) = measure.group_rank {
        for (&at, _) in volumes.iter().filter(|(_, volume)| **volume > 0.0) {
            groups.entry(at).or_default();
        }
        for (at, mut group) in groups {
            if group.len() >= rank {
                let (_, value, _) =
                    group.select_nth_unstable_by(rank - 1, |left, right| match direction {
                        OnsetDirection::Up => right.total_cmp(left),
                        OnsetDirection::Down => left.total_cmp(right),
                    });
                values.insert(at, *value);
            } else {
                healthy_gates.insert(at);
            }
        }
    }
    if measure.denominator.is_some() || measure.kind == "rate" {
        for (at, volume) in volumes.iter().filter(|(_, volume)| **volume > 0.0) {
            let value = values.entry(*at).or_default();
            if measure.denominator.is_some() {
                *value *= 100.0 / volume;
            }
        }
    }
    BaselineSeries {
        values,
        volumes,
        healthy_gates,
    }
}

async fn promql_baseline(
    runner: &QueryRunner<'_>,
    numerator: &str,
    probe: &str,
    window: (i64, i64),
    direction: OnsetDirection,
    scheduled_timeout: Option<i64>,
) -> anyhow::Result<BaselineSeries> {
    let query = format!(
        r#"label_replace(({numerator}), "{PROBE_LABEL}", "value", "", "") or
           label_replace(({probe}), "{PROBE_LABEL}", "volume", "", "")"#
    );
    if let Some(timeout) = scheduled_timeout {
        search_service::check_org_search_allowed(runner.org)?;
        let condition = QueryCondition {
            query_type: QueryType::PromQL,
            promql: Some(query),
            ..Default::default()
        };
        let rows = scheduled_samples(
            runner,
            condition,
            (window.0, window.1 - 1),
            timeout,
            Some(MINUTE),
        )
        .await?;
        let mut baseline = BaselineSeries::default();
        for row in rows {
            if let (Some(at), Some(value)) = (
                row.get("_timestamp").and_then(Value::as_i64),
                row.get("value").and_then(Value::as_f64),
            ) {
                baseline.record_promql(
                    row.get(PROBE_LABEL).and_then(Value::as_str),
                    at,
                    value,
                    direction,
                );
            }
        }
        return Ok(baseline);
    }
    promql_baseline_series(runner.promql_value(&query, window).await?, direction)
}

fn promql_baseline_series(
    value: PromValue,
    direction: OnsetDirection,
) -> anyhow::Result<BaselineSeries> {
    let series = match value {
        PromValue::Matrix(series) => series,
        PromValue::Range(series) => vec![series],
        PromValue::None => Vec::new(),
        _ => anyhow::bail!("Expected a range of recovery measurements"),
    };
    let mut baseline = BaselineSeries::default();
    for series in series {
        let label = labels_value(&series.labels, PROBE_LABEL);
        for sample in series.samples {
            baseline.record_promql(label.as_deref(), sample.timestamp, sample.value, direction);
        }
    }
    Ok(baseline)
}

async fn slo_baseline(
    runner: &QueryRunner<'_>,
    slo: &Slo,
    window: (i64, i64),
    region: Option<&str>,
) -> anyhow::Result<BaselineSeries> {
    let target = empty_target(StreamType::Logs);
    let runner = QueryRunner {
        org: runner.org,
        user: runner.user,
        target: &target,
        timeout_secs: runner.timeout_secs,
    };
    let sql = crate::slo::job::trailing_slices_sql(
        &slo.id,
        slo.definition_generation,
        window.0 / 1_000_000,
        window.1 / 1_000_000,
        crate::slo::reconcile::slices_carry_corrections(runner.org).await,
        region.is_some(),
    );
    let hits = runner
        .sql(
            sql,
            (window.0.saturating_sub(HOUR).max(0), now_micros()),
            None,
        )
        .await?
        .hits;
    let group = region.map(|region| {
        crate::slo::query::group_key(&["region".to_owned()], &[Some(region.to_owned())])
    });
    let mut slices = BTreeMap::<i64, (f64, f64)>::new();
    for hit in hits {
        if let Some(group) = &group
            && !hit["group_key"]
                .as_str()
                .is_some_and(|key| has_group_part(key, group))
        {
            continue;
        }
        let (Some(at), Some(good), Some(total)) = (
            hit["slice_start"].as_i64(),
            hit["good"].as_f64(),
            hit["total"].as_f64(),
        ) else {
            continue;
        };
        let (sum_good, sum_total) = slices.entry(at.div_euclid(60) * MINUTE).or_default();
        *sum_good += good;
        *sum_total += total;
    }
    let values = slices
        .iter()
        .filter_map(|(&at, &(good, total))| math::sli(good, total).map(|value| (at, value)))
        .collect();
    let volumes = slices
        .into_iter()
        .map(|(at, (_, total))| (at, total * 60.0 / slo.definition.slice_interval_secs as f64))
        .collect();
    Ok(BaselineSeries {
        values,
        volumes,
        ..Default::default()
    })
}

fn has_group_part(key: &str, expected: &str) -> bool {
    let mut escaped = false;
    let mut start = 0;
    for (index, ch) in key.char_indices() {
        if escaped {
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == ',' {
            if &key[start..index] == expected {
                return true;
            }
            start = index + 1;
        }
    }
    &key[start..] == expected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_slo_epoch_requires_a_proven_source_revision() {
        let slo: Slo = serde_json::from_value(json!({
            "id": "slo", "org": "org", "name": "Availability", "description": "",
            "target": 99.9, "window_secs": 3600, "slice_interval_secs": 60,
            "sli_type": "alert", "config": {"alert_id": "source"}
        }))
        .unwrap();
        let revision = 120 * SECOND + 1;
        assert!(!epoch_covers_revision(None, revision));
        assert!(!epoch_covers_revision(Some(120), revision));
        assert!(epoch_covers_revision(Some(121), revision));
        assert_eq!(alert_revision_floor(&slo, revision), 180);
    }

    #[test]
    fn recovery_slo_samples_keep_their_recorded_sources() {
        let measure = Measure::ratio("good".to_owned(), "total".to_owned());
        let mut scopes = [SampleScope {
            region: None,
            baseline_volume: None,
            alert_threshold: 99.0,
            recover_threshold: 99.5,
            measure,
        }];
        let snapshot = |name: &str, alert_revision| SloSources {
            queries: vec![QuerySource::Stream {
                org_id: "org".to_owned(),
                stream_type: StreamType::Logs,
                name: name.to_owned(),
            }],
            alert_revision,
        };
        let direct = snapshot("original", None);
        assert!(same_slo_sources(&scopes, 2, &direct.queries, &direct));
        assert!(!same_slo_sources(
            &scopes,
            2,
            &direct.queries,
            &snapshot("new", None)
        ));
        assert!(!same_slo_sources(&scopes, 2, &[], &direct));
        scopes[0].measure.slo_generation = Some(2);
        let recorded = snapshot("original", Some(120));
        assert!(!same_slo_sources(&scopes, 2, &recorded.queries, &recorded));
        scopes[0].measure.slo_alert_revision = Some(120);
        assert!(same_slo_sources(&scopes, 2, &recorded.queries, &recorded));
        assert!(!same_slo_sources(&scopes, 3, &recorded.queries, &recorded));
        assert!(!same_slo_sources(
            &scopes,
            2,
            &recorded.queries,
            &snapshot("original", Some(121))
        ));
    }

    #[test]
    fn recovery_rest_classifies_each_scope_before_selecting_the_worst() {
        let strict = Check {
            comparator: "gt".to_owned(),
            volume_floor_pct: 50,
            baseline_volume: Some(100.0),
            alert_threshold: 2.0,
            recover_threshold: 1.0,
            measure: serde_json::to_string(&Measure::value(String::new(), None, "value")).unwrap(),
            ..Default::default()
        };
        let loose = Check {
            alert_threshold: 10.0,
            recover_threshold: 8.0,
            ..strict.clone()
        };
        let (check, _) = pack_rest(vec![
            (strict, PostOnset::default()),
            (loose, PostOnset::default()),
        ])
        .unwrap()
        .unwrap();
        let members = sample_scopes(&check).unwrap();
        let [strict, loose] = members.as_slice() else {
            panic!("expected two rest members");
        };
        let readings = vec![
            classify(&check, strict, Some(3.0), 100.0, false),
            classify(&check, loose, Some(6.0), 60.0, false),
        ];
        let selected = worst_reading(&check, readings);
        assert_eq!(selected.verdict, Verdict::Breach);
        assert_eq!(selected.value, Some(3.0));
        assert_eq!(selected.volume_pct, Some(60.0));
    }

    #[test]
    fn recovery_flap_requires_two_full_cycles_with_coverage() {
        let readings = [3.0, 0.5, 1.0, 3.0, 0.5, 3.0, 0.5];
        for down in [false, true] {
            let check = Check {
                comparator: if down { "lt" } else { "gt" }.to_owned(),
                alert_threshold: 2.0,
                ..Default::default()
            };
            let values = readings
                .into_iter()
                .enumerate()
                .map(|(i, value)| {
                    let value = if down { 4.0 - value } else { value };
                    (i as i64 * MINUTE, value)
                })
                .collect::<BTreeMap<_, _>>();
            let volumes = values.keys().map(|&at| (at, 100.0)).collect();
            let series = BaselineSeries {
                values,
                volumes,
                ..Default::default()
            };
            let mut history = post_onset(series, MINUTE, &check);
            assert_eq!(history.flap_period_secs(), Some(120));
            history.breaches.remove(&(2 * MINUTE));
            assert_eq!(history.flap_period_secs(), None);
        }
    }

    #[test]
    fn mitigation_region_filters_apply_before_sql_aggregation() {
        let sql = "SELECT count(*) FROM (SELECT host FROM logs WHERE level = 'error' OR level = 'warn') q";
        let scoped = region_sql(sql, "eu").unwrap();
        assert!(scoped.contains("(level = 'error' OR level = 'warn') AND region = 'eu'"));
        assert!(!scoped.ends_with("q WHERE region = 'eu'"));
    }

    #[test]
    fn mitigation_promql_probe_measures_requests_in_scope() {
        let (query, volume, counter) = promql_measure(
            r#"sum(rate(http_requests_total{env="prod",code=~"5.."}[5m]))"#,
            Some("eu"),
        )
        .unwrap();
        assert!(query.contains(r#"code=~"5..""#) && query.contains(r#"region="eu""#));
        assert_eq!(
            volume,
            r#"sum(increase(http_requests_total{env="prod",region="eu"}[5m])) / 5"#
        );
        assert_eq!(counter, "http_requests_total");
        assert!(promql_measure("up", None).is_none());
        assert!(promql_measure("rate(http_requests_total[5m]) + cpu", None).is_none());
    }

    #[test]
    fn mitigation_sql_uses_the_group_that_meets_the_count_gate() {
        let mut measure = Measure::value(String::new(), None, "value");
        measure.group_rank = Some(3);
        let values = [100.0, 4.0, 3.0, 1.0]
            .into_iter()
            .map(|value| json!({"zo_onset_at": 1, "zo_onset_value": value, "zo_is_volume": false}))
            .collect::<Vec<_>>();
        assert_eq!(
            sql_baseline_rows(values.clone(), &measure, OnsetDirection::Up).values[&0],
            3.0
        );
        let series = sql_baseline_rows(values[..2].to_vec(), &measure, OnsetDirection::Up);
        let baseline = series.at_onset(MINUTE);
        assert!(baseline.healthy_gate);
        assert_eq!(baseline.value, None);
        assert_eq!(
            default_recovery_threshold(&baseline, 5.0, OnsetDirection::Up),
            Some(5.0_f64.next_down())
        );
        assert_eq!(
            default_recovery_threshold(&baseline, 5.0, OnsetDirection::Down),
            Some(5.0_f64.next_up())
        );
        assert!(!series.at_onset(0).healthy_gate);
        let volume_only =
            vec![json!({"zo_onset_at": 1, "zo_onset_value": 20, "zo_is_volume": true})];
        let series = sql_baseline_rows(volume_only, &measure, OnsetDirection::Up);
        assert!(series.at_onset(MINUTE).healthy_gate);
        assert_eq!(
            sql_baseline_rows(values, &measure, OnsetDirection::Down).values[&0],
            4.0
        );
    }

    #[test]
    fn mitigation_explicit_thresholds_can_use_a_promql_stream_without_baseline() {
        let plan = SignalPlan {
            kind: SignalKind::Alert,
            reference: "alert".to_owned(),
            target: Target {
                query: ContextTarget {
                    promql: Some("rate(http_requests_total[5m])".to_owned()),
                    ..empty_target(StreamType::Metrics)
                },
                sources: Vec::new(),
            },
            measure: Measure::value(String::new(), None, "value"),
            direction: OnsetDirection::Up,
            alert_threshold: None,
            eval_period_secs: 60,
            slo: None,
        };
        let watch = Watch {
            signal: None,
            recover_threshold: Some(1.0),
            alert_threshold: Some(2.0),
            volume_floor_pct: None,
        };
        let baseline = promql_baseline_series(PromValue::None, OnsetDirection::Up)
            .unwrap()
            .at_onset(MINUTE);
        assert_eq!(baseline.volume, None);
        assert_eq!(
            thresholds(&plan, Some(&watch), &baseline).unwrap(),
            Some((2.0, 1.0))
        );
    }

    #[test]
    fn mitigation_region_leaves_scalar_lookup_unscoped() {
        let sql = "SELECT * FROM logs WHERE latency > (SELECT max(value) FROM lookup)";
        let scoped = region_sql(sql, "eu").unwrap();
        assert!(scoped.contains("(SELECT max(value) FROM lookup)"));
        assert_eq!(scoped.matches("region = 'eu'").count(), 1);
    }

    #[test]
    fn mitigation_slo_region_uses_exact_escaped_group_keys() {
        assert!(has_group_part(
            r"tier=pro,region=us\,east,team=api",
            r"region=us\,east"
        ));
        assert!(!has_group_part(
            r"tier=pro\,region=eu,team=api",
            "region=eu"
        ));
    }
}
