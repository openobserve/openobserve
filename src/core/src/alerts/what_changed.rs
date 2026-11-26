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

use std::collections::{BTreeMap, BTreeSet, HashSet};

use config::{
    meta::{
        alerts::{
            change_events::{self, CHANGE_EVENTS_STREAM},
            incidents::{IncidentTopology, affected_services},
            what_changed::{
                ChangeCoverage, ChangeKind, ChangeRow, ChangeSource, OnsetRelation, WhatChanged,
            },
        },
        promql::value::{LabelsExt, Value as PromValue},
        search,
        service_identity::{
            EnvSource, OrgIdentity, SERVICE_DEPLOY_DETECTOR_COMPLETED, WhereKind,
            WhereSummaryRecord, service_key,
        },
        stream::StreamType,
    },
    utils::sql::quote_sql_string,
};
use infra::table::{self, entity::service_version_deploys::Model as Deploy};
use o2_enterprise::enterprise::service_identity::{
    infer::{self, InferredEnv, WhereIdentity},
    signals::series::{
        BASELINE_OFFSET_MICROS, L_CLUSTER, L_ENV, L_SERVICE, L_SOURCE, L_VERSION, M_REQUESTS,
        M_RUM_VIEWS,
    },
};
use sea_orm::ConnectionTrait;
use serde_json::Value;

use crate::{
    authz::{QuerySource, authorize_query_sources},
    service_identity::{
        access::ReadableStreams,
        signals::metrics::{self, ArmGrid},
    },
};

pub const CHANGE_LOOKBACK_US: i64 = 2 * 60 * 60 * MICROS_PER_SECOND;
const SOURCE_ROW_LIMIT: usize = 10_000;
const DEPLOY_DEDUP_US: i64 = 600_000_000;
const MICROS_PER_SECOND: i64 = 1_000_000;

type CompletedWindows = BTreeMap<String, BTreeMap<i64, i64>>;

#[derive(Debug, Clone, Copy)]
pub struct ChangeWindow {
    pub start_us: i64,
    pub end_us: i64,
    pub onset_us: i64,
    pub evaluation_period_secs: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ChangeScope {
    pub env: Option<String>,
    pub region: Option<String>,
}

impl ChangeScope {
    pub fn from_group_values(dimensions: &Value) -> Self {
        let dimension = |key: &str| {
            dimensions
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        };
        Self {
            env: dimension("env"),
            region: dimension("region"),
        }
    }
}

#[derive(Default, serde::Serialize)]
pub struct ChangeAccess {
    readable_streams: BTreeSet<String>,
    deploy_streams: BTreeSet<String>,
    org_wide_deploy: Option<bool>,
    denied_streams: BTreeSet<String>,
}

impl ChangeAccess {
    async fn load_deploy_streams(
        &mut self,
        org: &str,
        principal: &str,
        traces: HashSet<String>,
    ) -> ReadableStreams {
        let readable = ReadableStreams::load_for_traces(org, principal, traces).await;
        self.deploy_streams
            .extend(readable.traces.iter().map(|name| format!("traces/{name}")));
        if readable.rum {
            self.deploy_streams.insert("logs/_rumdata".into());
        }
        readable
    }

    async fn read_deploy_source(&mut self, org: &str, principal: &str, stream: &str) -> bool {
        if self.readable_streams.contains(stream) {
            return true;
        }
        if self.denied_streams.contains(stream) {
            return false;
        }
        let readable = deploy_source_readable(org, principal, stream, &self.deploy_streams).await;
        if readable {
            self.readable_streams.insert(stream.to_string());
        } else {
            self.denied_streams.insert(stream.to_string());
        }
        readable
    }

    async fn allow_overflow(&mut self, org: &str, principal: &str) -> bool {
        if let Some(granted) = self.org_wide_deploy {
            return granted;
        }
        let granted = crate::service_identity::access::org_wide_read(org, principal).await;
        self.org_wide_deploy = Some(granted);
        granted
    }
}

#[derive(Clone, Default)]
pub struct ChangeSources {
    events: bool,
    deploy_traces: Option<HashSet<String>>,
    deploy_evidence: BTreeSet<String>,
    overflow: bool,
}

impl ChangeSources {
    /// Recheck the provenance used by a cached result under the current viewer's grants.
    pub async fn access(&self, org: &str, principal: &str) -> ChangeAccess {
        let mut access = ChangeAccess::default();
        if self.events {
            authorize_events(org, principal, &mut access).await;
        }
        if let Some(traces) = &self.deploy_traces {
            access
                .load_deploy_streams(org, principal, traces.clone())
                .await;
        }
        for stream in &self.deploy_evidence {
            access.read_deploy_source(org, principal, stream).await;
        }
        if self.overflow {
            access.allow_overflow(org, principal).await;
        }
        access
    }
}

pub struct PreparedRead {
    input: ReadContext,
    access: ChangeAccess,
    sources: ChangeSources,
    detected: Vec<ChangeRow>,
    coverage: ChangeCoverage,
    events_readable: bool,
}

impl PreparedRead {
    /// The cache key must use the same grants as the read that fills the entry.
    pub fn access(&self) -> &ChangeAccess {
        &self.access
    }

    pub fn sources(&self) -> &ChangeSources {
        &self.sources
    }

    pub async fn read(mut self) -> WhatChanged {
        load_regional_coverage(&self.input, &self.access, &mut self.coverage).await;
        self.read_changes().await
    }

    async fn read_changes(mut self) -> WhatChanged {
        let events = if self.events_readable {
            load_events(
                &self.input,
                &mut self.coverage,
                Some(self.input.principal.clone()),
            )
            .await
        } else {
            Vec::new()
        };
        self.finish(events)
    }

    fn finish(mut self, events: Vec<Value>) -> WhatChanged {
        let changes = assemble(self.detected, events, &self.input, &mut self.coverage);
        self.coverage.unreadable_streams = self.access.denied_streams.into_iter().collect();
        self.coverage.regions.sort();
        self.coverage.regions.dedup();
        self.coverage.unavailable_sources.sort();
        self.coverage.unavailable_sources.dedup();
        WhatChanged {
            changes,
            coverage: self.coverage,
        }
    }
}

struct ReadContext {
    org: String,
    principal: String,
    window: ChangeWindow,
    services: Vec<String>,
    scope: ChangeScope,
}

struct RolloutSources {
    detected: Vec<(Deploy, Option<String>)>,
    ci: Vec<Value>,
}

struct AssembledChange {
    row: ChangeRow,
    matched_detection: Option<ChangeRow>,
}

impl AssembledChange {
    fn matches_visible(&self, visible: &ChangeRow) -> bool {
        let current = match visible.source {
            ChangeSource::Detected => self.matched_detection.as_ref().unwrap_or(&self.row),
            ChangeSource::Ci | ChangeSource::DetectedCi => &self.row,
        };
        current.at_us == visible.at_us
            && current.service == visible.service
            && current.git_ref == visible.git_ref
            && current.env == visible.env
            && current.region == visible.region
            && (visible.source != ChangeSource::Detected
                || (current.source == ChangeSource::Detected
                    && current.kind == visible.kind
                    && current.from_ref == visible.from_ref
                    && current.to_image == visible.to_image))
    }
}

pub async fn read(
    org: &str,
    principal: &str,
    window: ChangeWindow,
    services: &[String],
    scope: &ChangeScope,
) -> WhatChanged {
    prepare(org, principal, window, services, scope)
        .await
        .read()
        .await
}

pub async fn prepare(
    org: &str,
    principal: &str,
    window: ChangeWindow,
    services: &[String],
    scope: &ChangeScope,
) -> PreparedRead {
    prepare_with(
        infra::db::get_orm_client_rw().await,
        ReadContext {
            org: org.to_string(),
            principal: principal.to_string(),
            window,
            services: services.to_vec(),
            scope: scope.clone(),
        },
    )
    .await
}

pub(crate) async fn recovery_rollout(
    org: &str,
    service: &str,
    scope: ChangeScope,
    rest_regions: &[&str],
    window: ChangeWindow,
) -> anyhow::Result<Option<(String, i64)>> {
    let db = infra::db::get_orm_client_ro().await;
    let latest = latest_rollouts(
        db,
        org,
        service,
        scope,
        rest_regions,
        window,
        &mut ChangeCoverage::default(),
    )
    .await?;
    Ok(latest.map(|(key, _, at)| (key, at)))
}

pub(crate) async fn confirm_rollout(
    conn: &impl ConnectionTrait,
    incident: &infra::table::entity::alert_incidents::Model,
    viewer: &str,
    reference: &str,
    option_key: Option<&str>,
) -> anyhow::Result<Result<i64, Option<ChangeRow>>> {
    let topology: Option<IncidentTopology> = incident
        .topology_context
        .clone()
        .map(serde_json::from_value)
        .transpose()?;
    let services = affected_services(&incident.group_values, topology.as_ref());
    let target = option_key.and_then(|key| key.strip_prefix("deploy:")?.split_once(':'));
    let service = match (option_key, target) {
        (None, _) => services.first().map(String::as_str),
        (Some(_), Some((service, _))) if services.iter().any(|affected| affected == service) => {
            Some(service)
        }
        (Some(_), _) => None,
    };
    let Some(service) = service else {
        return Ok(Err(None));
    };
    let onset = incident.impact_start_at.unwrap_or(incident.first_alert_at);
    let input = ReadContext {
        org: incident.org_id.clone(),
        principal: viewer.to_owned(),
        window: ChangeWindow {
            start_us: onset.saturating_sub(CHANGE_LOOKBACK_US),
            end_us: config::utils::time::now_micros(),
            onset_us: onset,
            evaluation_period_secs: 0,
        },
        services: vec![service.to_owned()],
        scope: ChangeScope::from_group_values(&incident.group_values),
    };
    let mut coverage = ChangeCoverage::default();
    let sources = load_rollout_sources(conn, &input, &mut coverage).await?;
    let latest = latest_brief_rollout(sources, &input, &mut coverage);
    let visible = prepare_with(conn, input).await.read_changes().await.changes;
    let latest_visible = newest_rollout(&visible, onset);
    let option_matches = target.is_none_or(|(_, expected)| expected == reference);
    if let (Some(current), Some(row)) = (latest, latest_visible)
        && !coverage.truncated
        && coverage
            .unavailable_sources
            .iter()
            .all(|source| source == CHANGE_EVENTS_STREAM)
        && row.git_ref.as_deref() == Some(reference)
        && current.matches_visible(row)
        && option_matches
        && returned_to_prior_ref(row, &visible, reference)
    {
        return Ok(Ok(row.at_us));
    }
    Ok(Err(latest_visible.cloned()))
}

async fn latest_rollouts(
    db: &impl ConnectionTrait,
    org: &str,
    service: &str,
    scope: ChangeScope,
    rest_regions: &[&str],
    window: ChangeWindow,
    coverage: &mut ChangeCoverage,
) -> anyhow::Result<Option<(String, Option<String>, i64)>> {
    let input = ReadContext {
        org: org.to_string(),
        principal: String::new(),
        window,
        services: vec![service.to_string()],
        scope,
    };
    let sources = load_rollout_sources(db, &input, coverage).await?;
    let in_scope = |env: Option<&str>, region: Option<&str>| {
        input
            .scope
            .env
            .as_deref()
            .is_none_or(|wanted| env == Some(wanted))
            && region_matches(region, input.scope.region.as_deref())
            && (rest_regions.is_empty()
                || region.is_none_or(|region| rest_regions.contains(&region)))
    };
    let detected = sources
        .detected
        .into_iter()
        .filter(|(deploy, env)| in_scope(env.as_deref(), nonempty(&deploy.cluster)))
        .map(|(deploy, _)| {
            let version = nonempty(&deploy.to_version).map(str::to_string);
            (deploy.deploy_key, version, deploy.at)
        });
    let ci = sources
        .ci
        .iter()
        .filter_map(|event| event_row(event).ok())
        .filter(|row| {
            row.service == service
                && is_rollout(&row.kind)
                && in_scope(row.env.as_deref(), row.region.as_deref())
        })
        .map(|row| {
            let reference = row
                .git_ref
                .clone()
                .or(row.url)
                .unwrap_or_else(|| format!("{}:{}", row.service, row.at_us));
            (reference, row.git_ref, row.at_us)
        });
    Ok(detected.chain(ci).max_by_key(|(_, _, at)| *at))
}

async fn load_rollout_sources(
    db: &impl ConnectionTrait,
    input: &ReadContext,
    coverage: &mut ChangeCoverage,
) -> anyhow::Result<RolloutSources> {
    let org = &input.org;
    let window = input.window;
    let deploys = table::service_version_deploys::in_window(
        db,
        org,
        (window.start_us, window.end_us.saturating_add(1)),
        (SOURCE_ROW_LIMIT + 1) as u64,
    )
    .await?;
    coverage.truncated |= deploys.len() > SOURCE_ROW_LIMIT;
    let summaries = table::service_where_summary::list_by_org(db, org).await?;
    let identity = OrgIdentity {
        overrides: table::service_identity_rules::list(db, org).await?,
    };
    let detected = deploys
        .into_iter()
        .take(SOURCE_ROW_LIMIT)
        .filter(|deploy| input.services.contains(&deploy.service_name))
        .map(|deploy| {
            let env = deploy_env(&deploy, &summaries, &identity);
            (deploy, env)
        })
        .collect();
    let ci = load_events(input, coverage, None).await;
    Ok(RolloutSources { detected, ci })
}

fn latest_brief_rollout(
    mut sources: RolloutSources,
    input: &ReadContext,
    coverage: &mut ChangeCoverage,
) -> Option<AssembledChange> {
    let precision = detector_window_secs();
    let detected = sources
        .detected
        .into_iter()
        .map(|(deploy, env)| detected_row(deploy, env, None, precision))
        .collect();
    // System reads fetch newest first for truncation. The brief pairs CI rows oldest first.
    sources.ci.sort_by_key(|row| row["_timestamp"].as_i64());
    assemble_with_detection(detected, sources.ci, input, coverage)
        .into_iter()
        .filter(|change| is_rollout(&change.row.kind) && change.row.at_us > input.window.onset_us)
        .max_by_key(|change| change.row.at_us)
}

fn newest_rollout(changes: &[ChangeRow], onset: i64) -> Option<&ChangeRow> {
    changes
        .iter()
        .filter(|row| is_rollout(&row.kind) && row.at_us > onset)
        .max_by_key(|row| row.at_us)
}

fn is_rollout(kind: &ChangeKind) -> bool {
    matches!(
        kind,
        ChangeKind::Deploy | ChangeKind::Rollback | ChangeKind::Redeploy
    )
}

fn returned_to_prior_ref(latest: &ChangeRow, visible: &[ChangeRow], reference: &str) -> bool {
    if latest.kind == ChangeKind::Rollback {
        return true;
    }
    let Some(replaced) = latest.from_ref.as_deref() else {
        return false;
    };
    visible.iter().any(|row| {
        is_rollout(&row.kind)
            && row.at_us < latest.at_us
            && row.env == latest.env
            && row.region == latest.region
            && row.git_ref.as_deref() == Some(replaced)
            && row.from_ref.as_deref() == Some(reference)
    })
}

async fn prepare_with<C: ConnectionTrait>(conn: &C, input: ReadContext) -> PreparedRead {
    let mut prepared = PreparedRead {
        input,
        access: ChangeAccess::default(),
        sources: ChangeSources::default(),
        detected: Vec::new(),
        coverage: ChangeCoverage::default(),
        events_readable: false,
    };
    if prepared.input.services.is_empty() {
        prepared
            .coverage
            .unavailable_sources
            .push("affected_services".into());
        return prepared;
    }
    prepared.sources.events = true;
    prepared.events_readable = authorize_events(
        &prepared.input.org,
        &prepared.input.principal,
        &mut prepared.access,
    )
    .await;
    prepared.detected = load_deploys(
        conn,
        &prepared.input,
        &mut prepared.coverage,
        &mut prepared.access,
        &mut prepared.sources,
    )
    .await;
    prepared
}

async fn load_deploys<C: ConnectionTrait>(
    conn: &C,
    input: &ReadContext,
    coverage: &mut ChangeCoverage,
    access: &mut ChangeAccess,
    sources: &mut ChangeSources,
) -> Vec<ChangeRow> {
    let Some(expected_env) = input.scope.env.as_deref() else {
        return Vec::new();
    };
    let summaries = match table::service_where_summary::list_by_org(conn, &input.org).await {
        Ok(rows) => rows,
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("detected_deploys: {error}"));
            return Vec::new();
        }
    };
    let traces = ReadableStreams::trace_names(&summaries);
    let readable = access
        .load_deploy_streams(&input.org, &input.principal, traces.clone())
        .await;
    sources.deploy_traces = Some(traces);
    let summaries = readable.visible(&summaries);
    let identity = match table::service_identity_rules::list(conn, &input.org).await {
        Ok(overrides) => OrgIdentity { overrides },
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("service_identity_overrides: {error}"));
            return Vec::new();
        }
    };
    infra::race_point!("incident_brief.changes_before_deploy_scan");
    let mut deploys = match table::service_version_deploys::in_window(
        conn,
        &input.org,
        (input.window.start_us, input.window.end_us.saturating_add(1)),
        (SOURCE_ROW_LIMIT + 1) as u64,
    )
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("detected_deploys: {error}"));
            return Vec::new();
        }
    };
    coverage.detected_deploys = true;
    coverage.truncated |= deploys.len() > SOURCE_ROW_LIMIT;
    deploys.truncate(SOURCE_ROW_LIMIT);
    let precision = detector_window_secs();
    let mut rows = Vec::new();
    for mut deploy in deploys {
        if !input.services.contains(&deploy.service_name)
            || !region_matches(nonempty(&deploy.cluster), input.scope.region.as_deref())
        {
            continue;
        }
        let env = deploy_env(&deploy, &summaries, &identity);
        if env.as_deref().is_some_and(|env| env != expected_env) {
            continue;
        }
        if !sources_readable(
            input,
            &deploy.source_streams,
            deploy.source_streams_overflow,
            access,
            coverage,
            sources,
        )
        .await
            || env.is_none()
        {
            continue;
        }
        if deploy.from_image.is_some()
            && !previous_image_readable(conn, input, &deploy, access, coverage, sources).await
        {
            deploy.from_image = None;
        }
        let verdict = load_verdict(conn, input, &deploy, access, coverage, sources).await;
        rows.push(detected_row(deploy, env, verdict, precision));
    }
    rows
}

fn detector_window_secs() -> i64 {
    i64::try_from(
        o2_enterprise::enterprise::common::config::get_config()
            .service_signals
            .window_secs,
    )
    .unwrap_or(i64::MAX)
}

async fn load_regional_coverage(
    input: &ReadContext,
    access: &ChangeAccess,
    coverage: &mut ChangeCoverage,
) {
    let Some(env) = input.scope.env.as_deref() else {
        return;
    };
    let step = detector_window_secs()
        .max(1)
        .saturating_mul(MICROS_PER_SECOND);
    let grid = ArmGrid {
        start: input.window.start_us,
        end: input.window.end_us,
        step,
        hourly: false,
    };
    if grid.start >= grid.end || input.services.is_empty() {
        return;
    }

    let traces = access
        .deploy_streams
        .iter()
        .filter_map(|source| source.strip_prefix("traces/"))
        .collect::<Vec<_>>();
    let rum = access
        .deploy_streams
        .contains("logs/_rumdata")
        .then_some("_rumdata")
        .into_iter()
        .collect::<Vec<_>>();
    if traces.is_empty() && rum.is_empty() {
        return;
    }
    let completed =
        match coverage_metric(input, SERVICE_DEPLOY_DETECTOR_COMPLETED, vec![], grid).await {
            Ok(value) => completed_windows(&value, grid),
            Err(error) => {
                log::warn!("[WhatChanged] regional detector completion unavailable: {error}");
                coverage
                    .unavailable_sources
                    .push("regional_deploy_coverage".into());
                return;
            }
        };
    if completed.is_empty() {
        return;
    }
    for (family, streams) in [(M_REQUESTS, traces), (M_RUM_VIEWS, rum)] {
        if streams.is_empty() {
            continue;
        }
        match coverage_series(input, family, env, &streams, grid).await {
            Ok(value) => coverage
                .regions
                .extend(observed_regions(&value, input, &streams, &completed)),
            Err(error) => {
                log::warn!("[WhatChanged] {family} regional coverage unavailable: {error}");
                coverage
                    .unavailable_sources
                    .push("regional_deploy_coverage".into());
            }
        }
    }
}

async fn coverage_series(
    input: &ReadContext,
    family: &str,
    env: &str,
    streams: &[&str],
    grid: ArmGrid,
) -> anyhow::Result<PromValue> {
    let services: Vec<_> = input
        .services
        .iter()
        .map(|name| service_key(name))
        .collect();
    // The detector counters inherit the grants on the source_stream labels.
    let labels = vec![
        format!("{L_ENV}={}", metrics::literal(env)),
        format!(
            "{L_SERVICE}=~{}",
            metrics::any_of(services.iter().map(String::as_str))
        ),
        format!("{L_SOURCE}=~{}", metrics::any_of(streams.iter().copied())),
    ];
    coverage_metric(input, family, labels, grid).await
}

async fn coverage_metric(
    input: &ReadContext,
    family: &str,
    mut labels: Vec<String>,
    grid: ArmGrid,
) -> anyhow::Result<PromValue> {
    if let Some(region) = input.scope.region.as_deref() {
        labels.push(format!("{L_CLUSTER}={}", metrics::literal(region)));
    }
    let selector = format!("{family}{{{}}}", labels.join(","));
    let query = metrics::arm_query(&selector, grid.start, grid.end, grid.step).0;
    metrics::range_uncached(&input.org, &query, grid).await
}

fn completed_windows(value: &PromValue, grid: ArmGrid) -> CompletedWindows {
    let mut completed = CompletedWindows::new();
    let PromValue::Matrix(series) = value else {
        return completed;
    };
    for region in series {
        let cluster = region.labels.get_value(L_CLUSTER);
        if cluster.is_empty() {
            continue;
        }
        for sample in &region.samples {
            if sample.value.is_finite()
                && sample.value > 0.0
                && grid.start < sample.timestamp
                && sample.timestamp <= grid.end
            {
                let start = sample.timestamp.saturating_sub(sample.value as i64);
                completed
                    .entry(cluster.clone())
                    .or_default()
                    .insert(sample.timestamp, start);
            }
        }
    }
    completed
}

fn observed_regions(
    value: &PromValue,
    input: &ReadContext,
    streams: &[&str],
    completed: &CompletedWindows,
) -> BTreeSet<String> {
    let PromValue::Matrix(series) = value else {
        return BTreeSet::new();
    };
    series
        .iter()
        .filter_map(|series| {
            let label = |key| series.labels.get_value(key);
            let service = label(L_SERVICE);
            let env = label(L_ENV);
            let region = label(L_CLUSTER);
            let source = label(L_SOURCE);
            let complete = completed.get(&region)?;
            (!label(L_VERSION).is_empty()
                && streams.contains(&source.as_str())
                && input
                    .services
                    .iter()
                    .any(|name| service_key(name) == service)
                && scope_matches(nonempty(&env), Some(&region), &input.scope)
                && series.samples.array_windows().any(|[before, after]| {
                    let Some(&start) = complete.get(&after.timestamp) else {
                        return false;
                    };
                    let baseline_at = after.timestamp.saturating_sub(BASELINE_OFFSET_MICROS);
                    after.value > 0.0
                        && after.value != before.value
                        && (before.timestamp == start
                            || (before.timestamp == baseline_at && before.value == 0.0))
                }))
            .then_some(region)
        })
        .collect()
}

async fn previous_image_readable<C: ConnectionTrait>(
    conn: &C,
    input: &ReadContext,
    deploy: &Deploy,
    access: &mut ChangeAccess,
    coverage: &mut ChangeCoverage,
    sources: &mut ChangeSources,
) -> bool {
    // The destination's sources carry no authority over the image it replaced.
    match table::service_version_deploys::previous_image_deploy(conn, deploy).await {
        Ok(Some(prior)) => {
            sources_readable(
                input,
                &prior.source_streams,
                prior.source_streams_overflow,
                access,
                coverage,
                sources,
            )
            .await
        }
        Ok(None) => {
            coverage
                .unavailable_sources
                .push("previous_image_provenance".into());
            false
        }
        Err(error) => {
            log::warn!("[WhatChanged] previous image provenance unavailable: {error}");
            coverage
                .unavailable_sources
                .push("previous_image_provenance".into());
            false
        }
    }
}

async fn load_verdict<C: ConnectionTrait>(
    conn: &C,
    input: &ReadContext,
    deploy: &Deploy,
    access: &mut ChangeAccess,
    coverage: &mut ChangeCoverage,
    sources: &mut ChangeSources,
) -> Option<String> {
    let key = deploy.verdict_key.as_deref()?;
    match table::service_version_verdicts::get(conn, &input.org, key).await {
        Ok(Some(verdict)) => {
            if sources_readable(
                input,
                &verdict.source_streams,
                verdict.source_streams_overflow,
                access,
                coverage,
                sources,
            )
            .await
            {
                Some(verdict.verdict)
            } else {
                None
            }
        }
        Ok(None) => None,
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("deploy_verdict: {error}"));
            None
        }
    }
}

async fn sources_readable(
    input: &ReadContext,
    encoded: &str,
    overflow: bool,
    access: &mut ChangeAccess,
    coverage: &mut ChangeCoverage,
    sources: &mut ChangeSources,
) -> bool {
    let streams: Vec<String> = match serde_json::from_str(encoded) {
        Ok(streams) => streams,
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("detected_deploys.source_streams: {error}"));
            return false;
        }
    };
    if streams.is_empty() {
        coverage
            .unavailable_sources
            .push("detected_deploys.source_streams_incomplete".into());
        return false;
    }
    if overflow {
        sources.overflow = true;
        let org_wide = access.allow_overflow(&input.org, &input.principal).await;
        if org_wide
            && crate::service_identity::access::evidence(
                &input.org,
                &input.principal,
                &streams,
                overflow,
                org_wide,
                &crate::authz::StreamReadMemo::default(),
            )
            .await
        {
            return true;
        }
        coverage
            .unavailable_sources
            .push("detected_deploys.source_streams_incomplete".into());
        return false;
    }
    let mut allowed = true;
    for stream in streams {
        allowed &= access
            .read_deploy_source(&input.org, &input.principal, &stream)
            .await;
        sources.deploy_evidence.insert(stream);
    }
    allowed
}

async fn deploy_source_readable(
    org: &str,
    principal: &str,
    stream: &str,
    deploy_streams: &BTreeSet<String>,
) -> bool {
    if deploy_streams.contains(stream) {
        return true;
    }
    match stream.split_once('/') {
        Some(("traces", name)) if !name.is_empty() => {
            authorize_stream(org, principal, name, StreamType::Traces).await
        }
        Some(("logs", "_rumdata")) => false,
        Some(("logs", name)) if !name.is_empty() => {
            authorize_stream(org, principal, name, StreamType::Logs).await
        }
        Some(("metrics", name)) if !name.is_empty() => {
            authorize_stream(org, principal, name, StreamType::Metrics).await
        }
        _ => false,
    }
}

async fn authorize_stream(org: &str, principal: &str, name: &str, stream_type: StreamType) -> bool {
    authorize_query_sources(
        principal,
        &[QuerySource::Stream {
            org_id: org.into(),
            stream_type,
            name: name.into(),
        }],
    )
    .await
    .is_ok()
}

async fn authorize_events(org: &str, principal: &str, access: &mut ChangeAccess) -> bool {
    let readable = authorize_stream(org, principal, CHANGE_EVENTS_STREAM, StreamType::Logs).await;
    let stream = format!("logs/{CHANGE_EVENTS_STREAM}");
    if readable {
        access.readable_streams.insert(stream);
    } else {
        access.denied_streams.insert(stream);
    }
    readable
}

async fn load_events(
    input: &ReadContext,
    coverage: &mut ChangeCoverage,
    principal: Option<String>,
) -> Vec<Value> {
    let schema = match infra::schema::get(&input.org, CHANGE_EVENTS_STREAM, StreamType::Logs).await
    {
        Ok(schema) => schema,
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("{CHANGE_EVENTS_STREAM}: {error}"));
            return Vec::new();
        }
    };
    if schema.fields().is_empty() {
        coverage
            .unavailable_sources
            .push(CHANGE_EVENTS_STREAM.into());
        return Vec::new();
    }
    if ["_timestamp", "service", "kind", "summary", "env"]
        .iter()
        .any(|name| schema.field_with_name(name).is_err())
    {
        coverage.unavailable_sources.push(format!(
            "{CHANGE_EVENTS_STREAM}: missing required scope or change fields"
        ));
        return Vec::new();
    }
    let services = input
        .services
        .iter()
        .map(|value| quote_sql_string(value))
        .collect::<Vec<_>>()
        .join(", ");
    let order = if principal.is_some() { "ASC" } else { "DESC" };
    let request = search::Request {
        query: search::Query {
            sql: format!(
                "SELECT * FROM \"{CHANGE_EVENTS_STREAM}\" WHERE service IN ({services}) ORDER BY _timestamp {order}"
            ),
            start_time: input.window.start_us,
            end_time: input.window.end_us,
            size: (SOURCE_ROW_LIMIT + 1) as i64,
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };
    match crate::search::search(
        &config::ider::generate(),
        &input.org,
        StreamType::Logs,
        principal,
        &request,
    )
    .await
    {
        Ok(mut response) => {
            coverage.change_events = !response.is_partial;
            coverage.truncated |= response.is_partial || response.hits.len() > SOURCE_ROW_LIMIT;
            if response.is_partial {
                coverage
                    .unavailable_sources
                    .push(format!("{CHANGE_EVENTS_STREAM}: partial search"));
            }
            response.hits.truncate(SOURCE_ROW_LIMIT);
            response.hits
        }
        Err(error) => {
            coverage
                .unavailable_sources
                .push(format!("{CHANGE_EVENTS_STREAM}: {error}"));
            Vec::new()
        }
    }
}

fn assemble(
    detected: Vec<ChangeRow>,
    events: Vec<Value>,
    input: &ReadContext,
    coverage: &mut ChangeCoverage,
) -> Vec<ChangeRow> {
    assemble_with_detection(detected, events, input, coverage)
        .into_iter()
        .map(|change| change.row)
        .collect()
}

fn assemble_with_detection(
    mut detected: Vec<ChangeRow>,
    events: Vec<Value>,
    input: &ReadContext,
    coverage: &mut ChangeCoverage,
) -> Vec<AssembledChange> {
    let window = input.window;
    detected.retain(|change| in_scope(change, window, &input.services, &input.scope));
    let detected = first_markers(detected);
    let mut detected: Vec<_> = detected.into_iter().map(Some).collect();
    let mut changes = Vec::new();
    for event in events {
        let mut row = match event_row(&event) {
            Ok(row) => row,
            Err(error) => {
                coverage
                    .unavailable_sources
                    .push(format!("{CHANGE_EVENTS_STREAM}: {error}"));
                continue;
            }
        };
        if !in_scope(&row, window, &input.services, &input.scope) {
            continue;
        }
        let matching = detected
            .iter()
            .enumerate()
            .filter_map(|(index, candidate)| {
                candidate
                    .as_ref()
                    .filter(|change| dedup_matches(change, &row))
                    .map(|change| (index, change.at_us.abs_diff(row.at_us)))
            })
            .min_by_key(|(_, distance)| *distance)
            .map(|(index, _)| index);
        let matched_detection = matching.and_then(|index| detected.get_mut(index)?.take());
        if let Some(change) = &matched_detection {
            row.source = ChangeSource::DetectedCi;
            row.kind = change.kind;
            row.verdict.clone_from(&change.verdict);
            row.from_image.clone_from(&change.from_image);
            row.to_image.clone_from(&change.to_image);
            if row.from_ref.is_none() {
                row.from_ref.clone_from(&change.from_ref);
            }
        }
        row.onset_relation = onset_relation(row.at_us, row.precision_secs, window);
        changes.push(AssembledChange {
            row,
            matched_detection,
        });
    }
    for mut row in detected.into_iter().flatten() {
        row.onset_relation = onset_relation(row.at_us, row.precision_secs, window);
        changes.push(AssembledChange {
            row,
            matched_detection: None,
        });
    }
    changes.sort_by(|a, b| {
        let (a, b) = (&a.row, &b.row);
        (a.onset_relation == OnsetRelation::After)
            .cmp(&(b.onset_relation == OnsetRelation::After))
            .then(
                a.at_us
                    .abs_diff(window.onset_us)
                    .cmp(&b.at_us.abs_diff(window.onset_us)),
            )
            .then(a.service.cmp(&b.service))
            .then(a.at_us.cmp(&b.at_us))
    });
    changes
}

fn first_markers(mut detected: Vec<ChangeRow>) -> Vec<ChangeRow> {
    detected.sort_by(|a, b| a.at_us.cmp(&b.at_us).then(a.service.cmp(&b.service)));
    let mut current: BTreeMap<(String, Option<String>, Option<String>), usize> = BTreeMap::new();
    let mut rows: Vec<ChangeRow> = Vec::new();
    for change in detected {
        let scope = (
            change.service.clone(),
            change.env.clone(),
            change.region.clone(),
        );
        if let Some(previous) = current.get(&scope).and_then(|index| rows.get_mut(*index)) {
            if previous.git_ref == change.git_ref
                && previous.to_image == change.to_image
                && previous.kind == change.kind
                && change.kind != ChangeKind::Redeploy
            {
                if change.verdict.is_some() {
                    previous.verdict = change.verdict;
                }
                continue;
            }
        }
        current.insert(scope, rows.len());
        rows.push(change);
    }
    rows
}

fn detected_row(
    deploy: Deploy,
    env: Option<String>,
    verdict: Option<String>,
    precision_secs: i64,
) -> ChangeRow {
    // The table reader validates the kind and excludes pre_existing before conversion.
    let kind = match deploy.kind.as_str() {
        "deploy" => ChangeKind::Deploy,
        "rollback" => ChangeKind::Rollback,
        "redeploy" => ChangeKind::Redeploy,
        _ => unreachable!("validated deploy kind"),
    };
    ChangeRow {
        at_us: deploy.at,
        precision_secs,
        onset_relation: OnsetRelation::About,
        service: deploy.service_name,
        kind,
        env,
        region: nonempty(&deploy.cluster).map(str::to_string),
        from_ref: deploy.from_version,
        git_ref: nonempty(&deploy.to_version).map(str::to_string),
        from_image: deploy.from_image,
        to_image: deploy.to_image,
        verdict,
        source: ChangeSource::Detected,
        summary: None,
        url: None,
        author: None,
        rollback: None,
        risk: None,
        risk_reason: None,
        integration_name: None,
    }
}

fn event_row(event: &Value) -> Result<ChangeRow, String> {
    let text = |key: &str| {
        event
            .get(key)
            .and_then(Value::as_str)
            .and_then(nonempty)
            .map(str::to_string)
    };
    let row = ChangeRow {
        at_us: event
            .get("_timestamp")
            .and_then(Value::as_i64)
            .ok_or("missing event timestamp")?,
        precision_secs: if event.get("ts_server_stamped").and_then(Value::as_bool) == Some(true) {
            60
        } else {
            0
        },
        onset_relation: OnsetRelation::About,
        service: text("service").ok_or("missing event service")?,
        kind: serde_json::from_value::<change_events::ChangeKind>(
            event.get("kind").ok_or("missing event kind")?.clone(),
        )
        .map_err(|error| format!("invalid event kind: {error}"))?
        .into(),
        env: text("env"),
        region: text("region"),
        from_ref: text("from_ref"),
        git_ref: text("ref"),
        from_image: None,
        to_image: None,
        verdict: None,
        source: ChangeSource::Ci,
        summary: Some(text("summary").ok_or("missing event summary")?),
        url: text("url"),
        author: text("author"),
        rollback: text("rollback"),
        risk: event
            .get("risk")
            .filter(|value| !value.is_null())
            .map(|risk| serde_json::from_value(risk.clone()))
            .transpose()
            .map_err(|error| format!("invalid event risk: {error}"))?,
        risk_reason: text("risk_reason"),
        integration_name: text("integration_name"),
    };
    Ok(row)
}

fn deploy_env(
    deploy: &Deploy,
    summaries: &[WhereSummaryRecord],
    identity: &OrgIdentity,
) -> Option<String> {
    let summary = summaries
        .iter()
        .filter(|row| row.service_name == deploy.service_name && row.where_key == deploy.where_key)
        .min_by_key(|row| (row.first_seen, &row.summary_key));
    let env = summary
        .and_then(|row| nonempty(&row.env))
        .or_else(|| deploy.where_key.strip_prefix("env:").and_then(nonempty))
        .unwrap_or_default();
    let resolved = infer::resolve_env(
        identity,
        &deploy.service_name,
        &WhereIdentity {
            where_key: deploy.where_key.clone(),
            where_kind: if deploy.where_key.starts_with("k8s:") {
                WhereKind::K8s
            } else if deploy.where_key.starts_with("env:") {
                WhereKind::Env
            } else {
                WhereKind::Default
            },
            k8s_cluster: summary
                .map(|row| row.k8s_cluster.clone())
                .unwrap_or_default(),
            k8s_namespace: summary
                .map(|row| row.k8s_namespace.clone())
                .unwrap_or_default(),
        },
        InferredEnv {
            env: env.to_string(),
            env_source: summary.map_or(EnvSource::Default, |row| row.env_source),
            env_source_value: summary
                .map(|row| row.env_source_value.clone())
                .unwrap_or_default(),
            applied_override: None,
        },
    );
    nonempty(&resolved.env).map(str::to_string)
}

fn in_scope(
    row: &ChangeRow,
    window: ChangeWindow,
    services: &[String],
    scope: &ChangeScope,
) -> bool {
    services.contains(&row.service)
        && row.at_us >= window.start_us
        && row.at_us <= window.end_us
        && scope_matches(row.env.as_deref(), row.region.as_deref(), scope)
}

fn scope_matches(env: Option<&str>, region: Option<&str>, scope: &ChangeScope) -> bool {
    env.is_some_and(|env| !env.is_empty() && scope.env.as_deref() == Some(env))
        && region_matches(region, scope.region.as_deref())
}

fn region_matches(region: Option<&str>, incident: Option<&str>) -> bool {
    match (region, incident) {
        (Some(region), Some(incident)) => region == incident,
        _ => true,
    }
}

fn dedup_matches(detected: &ChangeRow, event: &ChangeRow) -> bool {
    event.kind == ChangeKind::Deploy
        && detected.service == event.service
        && event.git_ref.as_ref().is_some_and(|git_ref| {
            detected.git_ref.as_ref() == Some(git_ref)
                || detected.to_image.as_ref() == Some(git_ref)
        })
        && detected.at_us.abs_diff(event.at_us) <= DEPLOY_DEDUP_US as u64
        && scope_matches(
            detected.env.as_deref(),
            detected.region.as_deref(),
            &ChangeScope {
                env: event.env.clone(),
                region: event.region.clone(),
            },
        )
}

fn onset_relation(at_us: i64, precision_secs: i64, window: ChangeWindow) -> OnsetRelation {
    let band = 60_i64
        .saturating_add(window.evaluation_period_secs.max(0))
        .saturating_add(precision_secs.max(0))
        .saturating_mul(MICROS_PER_SECOND);
    if at_us.abs_diff(window.onset_us) <= band as u64 {
        OnsetRelation::About
    } else if at_us < window.onset_us {
        OnsetRelation::Before
    } else {
        OnsetRelation::After
    }
}

fn nonempty(value: &str) -> Option<&str> {
    (!value.trim().is_empty()).then_some(value)
}

#[cfg(test)]
pub(crate) mod tests {
    use config::meta::alerts::change_events::{Provenance, parse_events};
    use serde_json::json;

    use super::*;

    const ONSET: i64 = 50_220_000_000;

    fn window() -> ChangeWindow {
        ChangeWindow {
            start_us: ONSET - 7_200_000_000,
            end_us: ONSET + 3_600_000_000,
            onset_us: ONSET,
            evaluation_period_secs: 0,
        }
    }

    fn scope() -> ChangeScope {
        ChangeScope {
            env: Some("prod".into()),
            region: Some("east".into()),
        }
    }

    pub(crate) fn deploy(at: i64, version: &str) -> Deploy {
        Deploy {
            deploy_key: format!("deploy-{at}-{version}"),
            org_id: "org".into(),
            service_name: "checkout".into(),
            where_key: "env:prod".into(),
            scope_key: "checkout-prod".into(),
            cluster: "east".into(),
            to_version: version.into(),
            from_version: Some("v1".into()),
            source_streams: r#"["traces/payments"]"#.into(),
            kind: "deploy".into(),
            entry_source: "traffic".into(),
            at,
            serving_versions: "[]".into(),
            full_serving: "[]".into(),
            ..Default::default()
        }
    }

    fn event(at: Option<i64>, env: Option<&str>, kind: &str) -> Value {
        let mut payload = json!({
            "service": "checkout", "kind": kind, "summary": "deploy v2", "ref": "v2",
            "region": "east", "url": "https://ci.example/run/1", "author": "Ana",
            "rollback": "restore v1", "risk": "high", "risk_reason": "changes pool size"
        });
        if let Some(at) = at {
            payload["_timestamp"] = json!(at);
        }
        if let Some(env) = env {
            payload["env"] = json!(env);
        }
        parse_events(payload, (1, i64::MAX))
            .unwrap()
            .remove(0)
            .into_record(
                &Provenance::Integration {
                    id: "ci-1",
                    name: "deploy-bot",
                },
                ONSET,
            )
    }

    fn produce(
        detected: Vec<ChangeRow>,
        events: Vec<Value>,
        window: ChangeWindow,
        services: &[String],
        scope: &ChangeScope,
    ) -> Vec<ChangeRow> {
        let input = ReadContext {
            org: "org".into(),
            principal: "sre@example.com".into(),
            window,
            services: services.to_vec(),
            scope: scope.clone(),
        };
        assemble(detected, events, &input, &mut ChangeCoverage::default())
    }

    #[cfg(feature = "test-utils")]
    async fn databases() -> Vec<sea_orm::DatabaseConnection> {
        use sea_orm::{ConnectOptions, Database};

        let mut sqlite = ConnectOptions::new("sqlite::memory:");
        sqlite.max_connections(1).min_connections(1);
        let mut connections = vec![Database::connect(sqlite).await.unwrap()];
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if !dsn.is_empty() {
            let schema = format!("s18_changes_{}", config::ider::generate().to_lowercase());
            Database::connect(&dsn)
                .await
                .unwrap()
                .execute_unprepared(&format!("CREATE SCHEMA \"{schema}\""))
                .await
                .unwrap();
            let mut options = ConnectOptions::new(dsn);
            options.max_connections(1).set_schema_search_path(schema);
            connections.push(Database::connect(options).await.unwrap());
        }
        connections
    }

    pub(crate) async fn create_change_tables(conn: &sea_orm::DatabaseConnection) {
        use sea_orm::Schema;

        let builder = conn.get_database_backend();
        let schema = Schema::new(builder);
        for statement in [
            schema.create_table_from_entity(table::entity::service_versions::Entity),
            schema.create_table_from_entity(table::entity::service_version_deploys::Entity),
            schema.create_table_from_entity(table::entity::service_where_summary::Entity),
            schema.create_table_from_entity(table::entity::service_version_verdicts::Entity),
            schema.create_table_from_entity(table::entity::service_identity_rules::Entity),
        ] {
            conn.execute(builder.build(&statement)).await.unwrap();
        }
    }

    #[test]
    fn producer_merges_real_ci_and_detected_rows_at_ci_time() {
        let detected = detected_row(
            deploy(ONSET - 240_000_000, "v2"),
            Some("prod".into()),
            Some("regressed".into()),
            300,
        );
        let changes = produce(
            vec![detected],
            vec![event(Some(ONSET), Some("prod"), "deploy")],
            window(),
            &["checkout".into()],
            &scope(),
        );
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].source, ChangeSource::DetectedCi);
        assert_eq!(changes[0].at_us, ONSET);
        assert_eq!(changes[0].precision_secs, 0);
        assert_eq!(changes[0].verdict.as_deref(), Some("regressed"));
        assert_eq!(changes[0].integration_name.as_deref(), Some("deploy-bot"));
        assert_eq!(changes[0].url.as_deref(), Some("https://ci.example/run/1"));
        assert_eq!(changes[0].rollback.as_deref(), Some("restore v1"));
    }

    #[test]
    fn rollback_confirmation_uses_the_merged_ci_timestamp() {
        let ci_at = ONSET + 60 * MICROS_PER_SECOND;
        let mut detected = deploy(ci_at + 3 * 60 * MICROS_PER_SECOND, "v2");
        detected.kind = "rollback".into();
        let ci = vec![event(Some(ci_at), Some("prod"), "deploy")];
        let input = ReadContext {
            org: "org".into(),
            principal: "viewer".into(),
            window: window(),
            services: vec!["checkout".into()],
            scope: scope(),
        };
        let visible = produce(
            vec![detected_row(
                detected.clone(),
                Some("prod".into()),
                None,
                300,
            )],
            ci.clone(),
            input.window,
            &input.services,
            &input.scope,
        );
        let rechecked = latest_brief_rollout(
            RolloutSources {
                detected: vec![(detected, Some("prod".into()))],
                ci,
            },
            &input,
            &mut ChangeCoverage::default(),
        )
        .unwrap();
        assert!(rechecked.matches_visible(newest_rollout(&visible, ONSET).unwrap()));
        assert_eq!(rechecked.row.at_us, ci_at);
        assert_eq!(rechecked.row.kind, ChangeKind::Rollback);
        assert!(returned_to_prior_ref(&rechecked.row, &visible, "v2"));
    }

    #[test]
    fn rollback_confirmation_matches_the_detection_only_representation() {
        let ci_at = ONSET + 60 * MICROS_PER_SECOND;
        let detected_at = ci_at + 3 * 60 * MICROS_PER_SECOND;
        let mut detected = deploy(detected_at, "v2");
        detected.kind = "rollback".into();
        let input = ReadContext {
            org: "org".into(),
            principal: "viewer".into(),
            window: window(),
            services: vec!["checkout".into()],
            scope: scope(),
        };
        let visible = produce(
            vec![detected_row(
                detected.clone(),
                Some("prod".into()),
                None,
                300,
            )],
            Vec::new(),
            input.window,
            &input.services,
            &input.scope,
        );
        let row = newest_rollout(&visible, ONSET).unwrap();
        assert_eq!(row.source, ChangeSource::Detected);
        assert_eq!(row.at_us, detected_at);
        assert!(returned_to_prior_ref(row, &visible, "v2"));

        let mut ci = vec![event(Some(ci_at), Some("prod"), "deploy")];
        for (newer, expected) in [(false, true), (true, false)] {
            if newer {
                ci.push(event(
                    Some(detected_at + 60 * MICROS_PER_SECOND),
                    Some("prod"),
                    "deploy",
                ));
            }
            let rechecked = latest_brief_rollout(
                RolloutSources {
                    detected: vec![(detected.clone(), Some("prod".into()))],
                    ci: ci.clone(),
                },
                &input,
                &mut ChangeCoverage::default(),
            )
            .unwrap();
            assert_ne!(rechecked.row.at_us, detected_at);
            assert_eq!(rechecked.row.git_ref, row.git_ref);
            assert_eq!(rechecked.matches_visible(row), expected);
        }
    }

    #[test]
    fn producer_never_joins_staging_unknown_environment_or_wrong_region() {
        let mut elsewhere = event(Some(ONSET), Some("prod"), "deploy");
        elsewhere["region"] = json!("west");
        let records = vec![
            event(Some(ONSET), Some("staging"), "deploy"),
            event(Some(ONSET), None, "deploy"),
            elsewhere,
        ];
        assert!(produce(vec![], records, window(), &["checkout".into()], &scope()).is_empty());
    }

    #[test]
    fn producer_applies_only_live_environment_overrides_before_scope_matching() {
        use config::meta::service_identity::{Override, OverrideScope, RULE_TYPE_ENV_OVERRIDE};

        let stored = deploy(ONSET, "v2");
        let mut identity = OrgIdentity {
            overrides: vec![Override {
                rule_key: "checkout-env".into(),
                org_id: stored.org_id.clone(),
                rule_type: RULE_TYPE_ENV_OVERRIDE.into(),
                scope: OverrideScope::Service,
                k8s_cluster: String::new(),
                where_key: stored.where_key.clone(),
                service_name: stored.service_name.clone(),
                value: "staging".into(),
                inferred_value: "prod".into(),
                inferred_source: EnvSource::Attribute,
                created_by: "owner@example.com".into(),
                updated_by: "owner@example.com".into(),
                created_at: ONSET,
                updated_at: ONSET,
                deleted_at: None,
                writer_cluster: "east".into(),
            }],
        };
        for (deleted_at, expected) in [(None, 0), (Some(ONSET), 1)] {
            identity.overrides[0].deleted_at = deleted_at;
            let env = deploy_env(&stored, &[], &identity);
            let rows = produce(
                vec![detected_row(stored.clone(), env, None, 300)],
                vec![],
                window(),
                &["checkout".into()],
                &scope(),
            );
            assert_eq!(rows.len(), expected, "{deleted_at:?}");
        }
        identity.overrides[0].value = "prod".into();
        identity.overrides[0].deleted_at = None;
        let mut stored = stored;
        stored.where_key = "env:staging".into();
        identity.overrides[0].where_key = stored.where_key.clone();
        let env = deploy_env(&stored, &[], &identity);
        let rows = produce(
            vec![detected_row(stored, env, None, 300)],
            vec![],
            window(),
            &["checkout".into()],
            &scope(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].env.as_deref(), Some("prod"));
    }

    #[test]
    fn detected_rollback_keeps_both_images_when_the_service_version_does_not_change() {
        let mut stored = deploy(ONSET + 400 * MICROS_PER_SECOND, "v2");
        stored.from_version = Some("v2".into());
        stored.from_image = Some("checkout:broken".into());
        stored.to_image = Some("checkout:last-good".into());
        stored.kind = "rollback".into();
        let rows = produce(
            vec![detected_row(stored, Some("prod".into()), None, 300)],
            vec![],
            window(),
            &["checkout".into()],
            &scope(),
        );
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.onset_relation, OnsetRelation::After);
        assert_eq!(row.from_ref.as_deref(), Some("v2"));
        assert_eq!(row.git_ref.as_deref(), Some("v2"));
        assert_eq!(row.from_image.as_deref(), Some("checkout:broken"));
        assert_eq!(row.to_image.as_deref(), Some("checkout:last-good"));
    }

    #[test]
    fn producer_preserves_detected_rollback_kind_when_ci_matches() {
        let mut rollback = deploy(ONSET, "v1");
        rollback.kind = "rollback".into();
        rollback.from_version = Some("v2".into());
        rollback.from_image = Some("checkout:broken".into());
        rollback.to_image = Some("checkout:last-good".into());
        let detected = detected_row(rollback, Some("prod".into()), Some("ok".into()), 300);
        let mut ci = event(Some(ONSET), Some("prod"), "deploy");
        ci["ref"] = json!("v1");
        let rows = produce(
            vec![detected],
            vec![ci],
            window(),
            &["checkout".into()],
            &scope(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source, ChangeSource::DetectedCi);
        assert_eq!(rows[0].kind, ChangeKind::Rollback);
        assert_eq!(rows[0].from_image.as_deref(), Some("checkout:broken"));
        assert_eq!(rows[0].to_image.as_deref(), Some("checkout:last-good"));
    }

    #[test]
    fn producer_deduplicates_at_ten_minutes_for_matching_version_or_image() {
        for (seconds, count) in [(600, 1), (601, 2)] {
            let detected = detected_row(
                deploy(ONSET - seconds * MICROS_PER_SECOND, "v2"),
                Some("prod".into()),
                None,
                300,
            );
            let rows = produce(
                vec![detected],
                vec![event(Some(ONSET), Some("prod"), "deploy")],
                window(),
                &["checkout".into()],
                &scope(),
            );
            assert_eq!(rows.len(), count, "{seconds}");
        }
        let mut stored = deploy(ONSET, "v2");
        stored.to_image = Some("image:v2".into());
        let detected = detected_row(stored, Some("prod".into()), None, 300);
        let mut ci = event(Some(ONSET), Some("prod"), "deploy");
        ci["ref"] = json!("image:v2");
        assert_eq!(
            produce(
                vec![detected],
                vec![ci],
                window(),
                &["checkout".into()],
                &scope()
            )
            .len(),
            1
        );
    }

    #[test]
    fn producer_allows_missing_region_but_rejects_two_different_known_regions() {
        let mut ci = event(Some(ONSET), Some("prod"), "deploy");
        ci.as_object_mut().unwrap().remove("region");
        let detected = detected_row(deploy(ONSET, "v2"), Some("prod".into()), None, 300);
        let rows = produce(
            vec![detected],
            vec![ci],
            window(),
            &["checkout".into()],
            &scope(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source, ChangeSource::DetectedCi);
        let mut without_region = scope();
        without_region.region = None;
        let rows = produce(
            vec![],
            vec![event(Some(ONSET), Some("prod"), "deploy")],
            window(),
            &["checkout".into()],
            &without_region,
        );
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn producer_preserves_timestamp_precision_for_stamped_and_legacy_rows() {
        let stamped = event(None, Some("prod"), "config");
        assert_eq!(stamped["ts_server_stamped"], true);
        let mut legacy = event(Some(ONSET), Some("prod"), "flag");
        legacy.as_object_mut().unwrap().remove("ts_server_stamped");
        let changes = produce(
            vec![],
            vec![stamped, legacy],
            window(),
            &["checkout".into()],
            &scope(),
        );
        assert_eq!(
            changes.iter().map(|r| r.precision_secs).collect::<Vec<_>>(),
            [60, 0]
        );
    }

    #[test]
    fn producer_uses_sum_of_precision_at_both_band_edges() {
        for (delta, expected) in [
            (-61, OnsetRelation::Before),
            (-60, OnsetRelation::About),
            (60, OnsetRelation::About),
            (61, OnsetRelation::After),
        ] {
            let records = vec![event(
                Some(ONSET + delta * 1_000_000),
                Some("prod"),
                "deploy",
            )];
            let rows = produce(vec![], records, window(), &["checkout".into()], &scope());
            assert_eq!(rows[0].onset_relation, expected);
        }
        let mut alert_window = window();
        alert_window.evaluation_period_secs = 120;
        let records = vec![event(Some(ONSET + 180_000_000), Some("prod"), "deploy")];
        assert_eq!(
            produce(
                vec![],
                records,
                alert_window,
                &["checkout".into()],
                &scope()
            )[0]
            .onset_relation,
            OnsetRelation::About
        );
        for (delta, expected) in [(360, OnsetRelation::About), (361, OnsetRelation::After)] {
            let rows = produce(
                vec![detected_row(
                    deploy(ONSET + delta * 1_000_000, "v2"),
                    Some("prod".into()),
                    None,
                    300,
                )],
                vec![],
                window(),
                &["checkout".into()],
                &scope(),
            );
            assert_eq!(rows[0].onset_relation, expected);
        }
    }

    #[test]
    fn only_completed_detector_windows_report_covered_regions_without_deploy_markers() {
        use config::meta::promql::{
            NAME_LABEL, VALUE_LABEL,
            value::{Labels, RangeValue, Sample},
        };
        use o2_enterprise::enterprise::service_identity::signals::{
            mappers::SignalRow,
            series::{L_STATUS, OrgSeries, window_groups},
        };

        let step = 300 * MICROS_PER_SECOND;
        let grid = ArmGrid {
            start: ONSET - 2 * step,
            end: ONSET,
            step,
            hourly: false,
        };
        let input = ReadContext {
            org: "org".into(),
            principal: "sre@example.com".into(),
            window: window(),
            services: vec!["checkout".into()],
            scope: ChangeScope {
                region: None,
                ..scope()
            },
        };
        let mut ranges = Vec::new();
        for (region, env, source, version) in [
            ("east", "prod", "app_a", "v1"),
            ("west", "prod", "private", "v1"),
            ("south", "staging", "app_a", "v1"),
            ("north", "prod", "app_a", ""),
            ("failed", "prod", "app_a", "v1"),
            ("earlier_only", "prod", "app_a", "v1"),
            ("steady", "prod", "app_a", "v1"),
            ("missing_sample", "prod", "app_a", "v1"),
        ] {
            let row = SignalRow {
                signal: "traces".into(),
                service: "checkout".into(),
                where_key: format!("env:{env}"),
                env: env.into(),
                source_stream: source.into(),
                version: version.into(),
                requests: Some(5),
                ..Default::default()
            };
            let mut signals = OrgSeries::default();
            let previous = grid.end - step;
            let mut records = match region {
                "steady" => {
                    signals.apply(grid.start, previous, window_groups([&row], &[]));
                    let records = signals.render(previous, region);
                    signals.mark_written();
                    signals.apply(previous, grid.end, vec![]);
                    records
                }
                "missing_sample" => {
                    signals.apply(grid.start - step, grid.start, window_groups([&row], &[]));
                    let records = signals.render(grid.start, region);
                    signals.mark_written();
                    signals.apply(grid.start, previous, window_groups([&row], &[]));
                    signals.apply(previous, grid.end, vec![]);
                    records
                }
                _ => {
                    signals.apply(previous, grid.end, window_groups([&row], &[]));
                    Vec::new()
                }
            };
            records.extend(signals.render(grid.end, region));
            let mut series_by_status = BTreeMap::<String, RangeValue>::new();
            for sample in records {
                if sample[NAME_LABEL] != M_REQUESTS {
                    continue;
                }
                let status = sample[L_STATUS].as_str().unwrap();
                let series = series_by_status
                    .entry(status.to_string())
                    .or_insert_with(|| {
                        let mut labels = Labels::default();
                        for field in [L_SERVICE, L_ENV, L_SOURCE, L_CLUSTER, L_VERSION] {
                            if let Some(value) = sample[field].as_str() {
                                labels.set(field, value);
                            }
                        }
                        RangeValue::new(labels, [])
                    });
                series.samples.push(Sample::new(
                    sample["_timestamp"].as_i64().unwrap(),
                    sample[VALUE_LABEL].as_f64().unwrap(),
                ));
            }
            ranges.extend(series_by_status.into_values());
        }
        let completion_samples = [
            ("east", grid.end),
            ("west", grid.end),
            ("south", grid.end),
            ("north", grid.end),
            ("earlier_only", grid.end - step),
            ("steady", grid.end),
            ("missing_sample", grid.end),
        ]
        .into_iter()
        .map(|(region, end)| {
            let record = crate::service_identity::signals::writer::detector_completion_record(
                end - step,
                end,
                region,
            );
            let mut labels = Labels::default();
            labels.set(L_CLUSTER, record[L_CLUSTER].as_str().unwrap());
            RangeValue::new(
                labels,
                [Sample::new(
                    record["_timestamp"].as_i64().unwrap(),
                    record[VALUE_LABEL].as_f64().unwrap(),
                )],
            )
        })
        .collect();
        let completed = completed_windows(&PromValue::Matrix(completion_samples), grid);
        assert_eq!(
            observed_regions(&PromValue::Matrix(ranges), &input, &["app_a"], &completed),
            BTreeSet::from(["east".to_string()]),
        );
    }

    #[test]
    fn producer_uses_first_marker_for_staged_rollout_and_keeps_later_redeploy() {
        let rows = [(-500, "v2"), (-200, "v2"), (0, "v1"), (100, "v2")]
            .into_iter()
            .map(|(seconds, version)| {
                detected_row(
                    deploy(ONSET + seconds * 1_000_000, version),
                    Some("prod".into()),
                    None,
                    300,
                )
            })
            .collect();
        let changes = produce(rows, vec![], window(), &["checkout".into()], &scope());
        assert_eq!(changes.len(), 3);
        assert!(changes.iter().any(|row| row.git_ref.as_deref() == Some("v2") && row.at_us == ONSET - 500_000_000));
        assert!(changes.iter().any(|row| row.git_ref.as_deref() == Some("v2") && row.at_us == ONSET + 100_000_000));
        let rows = [-100, 0]
            .into_iter()
            .map(|seconds| {
                let mut stored = deploy(ONSET + seconds * MICROS_PER_SECOND, "v2");
                stored.kind = "redeploy".into();
                detected_row(stored, Some("prod".into()), None, 300)
            })
            .collect();
        let changes = produce(rows, vec![], window(), &["checkout".into()], &scope());
        assert_eq!(changes.len(), 2);
        assert!(changes.iter().all(|row| row.kind == ChangeKind::Redeploy));
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn a_rollback_only_exposes_the_previous_image_to_readers_of_its_provenance() {
        use config::meta::service_identity::scope_key;

        use crate::authz::{TypedStream, fake_checker};

        for conn in databases().await {
            create_change_tables(&conn).await;
            let org = format!("s22-previous-image-{}", config::ider::generate());
            let marker = |at: i64, region: &str, image: &str, source_streams: &str| {
                let mut row = deploy(at, "v2");
                row.org_id = org.clone();
                row.scope_key = scope_key(&org, &row.service_name, &row.where_key);
                row.cluster = region.into();
                row.to_image = Some(image.into());
                row.to_version_key = row
                    .to_identity()
                    .key(&org, &row.service_name, &row.where_key);
                row.source_streams = source_streams.into();
                row.deploy_key = infra::idempotency::canonical_sha256(&json!([
                    org,
                    row.service_name,
                    row.where_key,
                    region,
                    row.to_version,
                    image,
                    at,
                ]));
                row
            };
            let before = window().start_us - MICROS_PER_SECOND;
            let mut prior = marker(before, "east", "checkout:broken", r#"["logs/private"]"#);
            prior.kind = "pre_existing".into();
            let mut rollback = marker(ONSET, "east", "checkout:last-good", r#"["logs/public"]"#);
            rollback.kind = "rollback".into();
            rollback.from_version = Some(prior.to_version.clone());
            rollback.from_image = prior.to_image.clone();
            rollback.from_version_key = Some(prior.to_version_key.clone());
            let other_region = marker(before, "west", "checkout:broken", r#"["logs/public"]"#);
            table::service_version_deploys::put_batch(&conn, vec![prior, other_region, rollback])
                .await
                .unwrap();

            let viewer = format!("{org}@example.com");
            let checker = fake_checker();
            let streams = |name: &str| TypedStream {
                org_id: org.clone(),
                stream_type: StreamType::Logs,
                name: name.into(),
            };
            checker.grant_read(&viewer, &streams("public"));
            let input = || ReadContext {
                org: org.clone(),
                principal: viewer.clone(),
                window: window(),
                services: vec!["checkout".into()],
                scope: scope(),
            };
            let restricted = prepare_with(&conn, input()).await;
            let access = serde_json::to_value(restricted.access()).unwrap();
            let sources = restricted.sources().clone();
            let result = restricted.finish(vec![]);
            assert_eq!(result.changes.len(), 1);
            assert_eq!(
                result.changes[0].to_image.as_deref(),
                Some("checkout:last-good")
            );
            assert_eq!(result.changes[0].from_image, None);
            assert!(
                result
                    .coverage
                    .unreadable_streams
                    .contains(&"logs/private".into())
            );

            checker.grant_read(&viewer, &streams("private"));
            let allowed = prepare_with(&conn, input()).await;
            let current_access = serde_json::to_value(sources.access(&org, &viewer).await).unwrap();
            assert_ne!(access, current_access);
            assert_eq!(
                serde_json::to_value(allowed.access()).unwrap(),
                current_access
            );
            let result = allowed.finish(vec![]);
            assert_eq!(
                result.changes[0].from_image.as_deref(),
                Some("checkout:broken")
            );
        }
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn prepared_brief_changes_use_detected_and_ci_producers_under_viewer_grants() {
        use sea_orm::{EntityTrait, IntoActiveModel};

        use crate::authz::{TypedStream, fake_checker};

        // Without the fake checker installed, the production checker admits every stream.
        fake_checker();
        for conn in databases().await {
            create_change_tables(&conn).await;
            let org = format!("s18-restricted-{}", config::ider::generate());
            let principal = format!("{org}@example.com");
            let mut stored = deploy(ONSET, "v2");
            stored.org_id = org.clone();
            stored.where_key = "k8s:cluster/payments".into();
            stored.deploy_key = infra::idempotency::canonical_sha256(&json!([
                org,
                stored.service_name,
                stored.where_key,
                stored.cluster,
                stored.to_version,
                stored.at,
            ]));
            let summary = infra::table::entity::service_where_summary::Model {
                summary_key: format!("summary-{org}"),
                org_id: org.clone(),
                service_name: stored.service_name.clone(),
                where_key: stored.where_key.clone(),
                scope_key: stored.scope_key.clone(),
                source_stream: "payments".into(),
                signal: "traces".into(),
                k8s_cluster: "cluster".into(),
                k8s_namespace: "payments".into(),
                env: "prod".into(),
                env_source: EnvSource::Attribute.as_str().into(),
                env_source_value: "deployment.environment=prod".into(),
                envs: r#"["prod"]"#.into(),
                newest_version: "v2".into(),
                newest_version_key: String::new(),
                newest_first_seen: ONSET,
                has_version: true,
                first_seen: ONSET,
                last_seen: ONSET,
                purged_versions: 0,
                updated_at: ONSET,
            };
            let denied_summary = infra::table::entity::service_where_summary::Model {
                summary_key: format!("denied-summary-{org}"),
                source_stream: "private".into(),
                env: "staging".into(),
                env_source_value: "deployment.environment=staging".into(),
                envs: r#"["staging"]"#.into(),
                first_seen: ONSET - MICROS_PER_SECOND,
                ..summary.clone()
            };
            infra::table::entity::service_where_summary::Entity::insert_many(
                [summary, denied_summary].map(IntoActiveModel::into_active_model),
            )
            .exec(&conn)
            .await
            .unwrap();
            assert!(
                table::service_version_deploys::put(&conn, stored)
                    .await
                    .unwrap()
            );
            let services = ["checkout".into()];
            let scope = scope();
            let input = || ReadContext {
                org: org.clone(),
                principal: principal.clone(),
                window: window(),
                services: services.to_vec(),
                scope: scope.clone(),
            };
            let denied = prepare_with(&conn, input()).await;
            assert!(!denied.access().readable_streams.contains("traces/payments"));
            let denied = denied.read().await;
            assert!(denied.changes.is_empty());
            assert!(
                denied
                    .coverage
                    .unreadable_streams
                    .iter()
                    .any(|source| source == "traces/payments")
            );
            fake_checker().grant_read(
                &principal,
                &TypedStream {
                    org_id: org.clone(),
                    stream_type: StreamType::Traces,
                    name: "payments".into(),
                },
            );
            fake_checker().grant_read(
                &principal,
                &TypedStream {
                    org_id: org.clone(),
                    stream_type: StreamType::Logs,
                    name: CHANGE_EVENTS_STREAM.into(),
                },
            );
            let prepared = prepare_with(&conn, input()).await;
            assert!(prepared.events_readable);
            assert!(
                prepared
                    .access()
                    .readable_streams
                    .contains("traces/payments")
            );
            let records = [-61, -60, 60, 61]
                .into_iter()
                .map(|seconds| {
                    let kind = if seconds == 60 { "deploy" } else { "config" };
                    event(
                        Some(ONSET + seconds * MICROS_PER_SECOND),
                        Some("prod"),
                        kind,
                    )
                })
                .chain([event(Some(ONSET), Some("staging"), "deploy")])
                .collect();
            let result = prepared.finish(records);
            assert!(result.coverage.unreadable_streams.is_empty());
            assert!(result.coverage.regions.is_empty());
            assert_eq!(result.changes.len(), 4);
            let mut rows = result.changes;
            rows.sort_by_key(|row| row.at_us);
            assert_eq!(rows[2].source, ChangeSource::DetectedCi);
            assert_eq!(rows[2].at_us, ONSET + 60 * MICROS_PER_SECOND);
            assert!(rows.iter().all(|row| row.precision_secs == 0));
            assert_eq!(
                rows.iter()
                    .map(|row| row.onset_relation)
                    .collect::<Vec<_>>(),
                [
                    OnsetRelation::Before,
                    OnsetRelation::About,
                    OnsetRelation::About,
                    OnsetRelation::After,
                ],
            );
        }
    }

    #[cfg(feature = "test-utils")]
    #[tokio::test]
    async fn event_stream_denial_is_reported_without_searching_it() {
        // Without the fake checker installed, the production checker admits every stream.
        crate::authz::fake_checker();
        let mut access = ChangeAccess::default();
        assert!(
            !authorize_events(
                "s18-denied-events",
                "s18-denied-events@example.com",
                &mut access,
            )
            .await
        );
        assert_eq!(
            access.denied_streams,
            BTreeSet::from([format!("logs/{CHANGE_EVENTS_STREAM}")]),
        );
    }
}
