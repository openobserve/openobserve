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

//! Lazy materialization of a link's range: read path, due rules, build and outcomes (design 4, 5).

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, LazyLock},
    time::Duration,
};

use async_trait::async_trait;
use config::{
    get_config,
    meta::{
        dashboards::Dashboard,
        public_dashboards::{
            DataResponse, NotAvailableReason, NotReadyResponse, PanelResult, PanelState,
            PublicVariable, RangeState, RangeStatus, ResultBody, StaleReason, TimeRange, Window,
            WithheldPanel,
        },
    },
    metrics,
    utils::{
        hash::{Sum64, gxhash},
        time::now_micros,
    },
};
use dashmap::DashMap;
use infra::table::entity::public_dashboards::Model as PublicDashboard;

use super::{
    AuthorizerProbe, authz_check,
    flight::{Built, Failure, Flight, Flights, Kind, Outcome, Start, TraceFamily, Wait, drain_by},
    intent, mask,
    store::{
        self, Header, Manifest, ManifestPanel, PanelOutcome, PanelSummary, Stored, ValuesDependency,
    },
};

const SECOND: i64 = 1_000_000;
const BACKOFF_BASE_SECS: i64 = 30;
/// A failed build is bounded by the build caps, not by the window, so long windows retry as often.
const BACKOFF_MAX_SECS: i64 = 300;
/// Shortest poll hint and 202 Retry-After.
pub const MIN_RETRY_SECS: u64 = 3;

/// In-memory backoff of keys whose file could not be written; the next read is a cold miss.
static WRITE_BACKOFF: LazyLock<DashMap<String, Header>> = LazyLock::new(DashMap::new);

/// The rows a build or a deadline check reads from the primary at its start.
#[derive(Clone, Debug)]
pub struct Capture {
    pub link: PublicDashboard,
    /// None when the dashboard was deleted.
    pub dashboard: Option<Dashboard>,
    pub settings_rev: i64,
    pub org_enabled: bool,
}

/// The live revisions a file is compared with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Live {
    pub dashboard_updated_at: i64,
    pub link_rev: i64,
    pub settings_rev: i64,
}

impl Live {
    fn of(header: &Header) -> Self {
        Self {
            dashboard_updated_at: header.dashboard_updated_at,
            link_rev: header.link_rev,
            settings_rev: header.settings_rev,
        }
    }

    fn as_array(&self) -> [i64; 3] {
        [self.dashboard_updated_at, self.link_rev, self.settings_rev]
    }
}

/// Every database, search and authorizer call of the materializer; tests swap in a fake.
#[async_trait]
pub trait Engine: Send + Sync {
    /// The link, its dashboard and its org settings, from the primary.
    async fn capture(&self, link_id: &str) -> Result<Option<Capture>, anyhow::Error>;
    /// Runs every panel of the captured dashboard for one range under the build's trace family.
    #[allow(clippy::too_many_arguments)]
    async fn run_panels(
        &self,
        cap: &Capture,
        range: &TimeRange,
        range_key: &str,
        now: i64,
        family: &TraceFamily,
        flight: &Flight,
        probe: &AuthorizerProbe,
    ) -> Run;
    /// Whether the publisher is still an org member, from the primary.
    async fn is_member(&self, org: &str, user: &str) -> Result<bool, anyhow::Error>;
    async fn pause_departed(&self, link: &PublicDashboard);
    /// Whether `user` may still read everything one panel's data was built from.
    async fn authorize(
        &self,
        org: &str,
        user: &str,
        panel: &ManifestPanel,
        probe: &AuthorizerProbe,
    ) -> Result<bool, anyhow::Error>;
    /// Cloud: false when the org's trial has expired.
    async fn trial_ok(&self, org: &str) -> bool;
}

/// How one panel of a build ended (design 5.7).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Fresh,
    Partial,
    Truncated,
    Denied,
    Structural,
    Transient,
}

/// One panel's result, its provenance and how it ended.
#[derive(Clone, Debug)]
pub struct PanelRun {
    pub id: String,
    pub class: Class,
    pub result: PanelResult,
    pub manifest: ManifestPanel,
    pub error: Option<String>,
}

impl PanelRun {
    pub fn not_available(
        id: &str,
        class: Class,
        reason: NotAvailableReason,
        manifest: ManifestPanel,
        error: Option<String>,
    ) -> Self {
        let mut result = PanelResult::not_available(reason);
        result.intent = manifest.intent.clone();
        Self {
            id: id.to_string(),
            class,
            result,
            manifest,
            error,
        }
    }
}

/// The panels and variables one build produced.
#[derive(Clone, Debug, Default)]
pub struct Run {
    pub variables: Vec<PublicVariable>,
    /// The frozen-value key of each entry of `variables`.
    pub variable_keys: Vec<String>,
    /// Every values query a variable value came from, with its streams.
    pub values_dependencies: Vec<ValuesDependency>,
    pub panels: Vec<PanelRun>,
}

/// The build outcomes of design 5.7.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuildKind {
    Complete,
    Partial,
    Failed,
}

impl BuildKind {
    fn label(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Partial => "partial",
            Self::Failed => "failed",
        }
    }
}

/// A classified build, ready to write; a failed build has no body of its own.
#[derive(Clone, Debug)]
pub struct Assembled {
    pub header: Header,
    pub manifest: Manifest,
    pub body: Option<ResultBody>,
    pub kind: BuildKind,
}

/// The previous file of the key, decompressed, for retained panels and backoff.
#[derive(Clone, Debug)]
pub struct Prior {
    pub stored: Stored,
    pub body: Option<ResultBody>,
}

/// The due rules of design 5.1 for a file with a body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Due {
    /// The first rule that holds; the response is stale with this reason.
    pub reason: Option<StaleReason>,
    /// Whether a build starts: some rule holds and is not held back by the backoff.
    pub start: bool,
}

/// What the data route answers.
#[derive(Clone, Debug)]
pub enum Served {
    /// 200; `retry_hint` is the poll hint while refreshing, `outcome` the reads metric label.
    Data {
        response: Box<DataResponse>,
        retry_hint: Option<u64>,
        outcome: &'static str,
    },
    /// 202 with Retry-After from the estimate.
    Building(NotReadyResponse),
    /// 503 with Retry-After until `next_retry_at`.
    Cooldown(NotReadyResponse),
    /// 503: no permit for a cold build, or the authorization check failed closed.
    Unavailable { retry_after: u64 },
    /// 304: the reader already holds this rev; `retry_hint` as for a 200.
    NotModified {
        rev: String,
        retry_hint: Option<u64>,
    },
    /// The flight found the link no longer servable.
    Gone,
}

/// The request-time inputs of a read.
pub struct ReadRequest<'a> {
    pub link: &'a PublicDashboard,
    pub settings_rev: i64,
    pub dashboard: &'a Dashboard,
    pub range: TimeRange,
    pub now: i64,
    /// The request's If-None-Match; a matching rev is answered without reading the body.
    pub if_none_match: Option<&'a str>,
}

/// The read path of design 4.2 after the link gates: deadline check, due rules, flight, masking.
pub async fn read(
    engine: &'static dyn Engine,
    flights: &'static Flights,
    req: ReadRequest<'_>,
) -> Served {
    let link = req.link;
    let range_key = req.range.key();
    let key = store::key(&link.org_id, &link.id, &range_key);
    let frozen = super::parse_frozen_vars(link.frozen_variables.as_deref());
    let intents = intent::intents(req.dashboard, &frozen);
    let live = Live {
        dashboard_updated_at: req.dashboard.updated_at,
        link_rev: link.rev,
        settings_rev: req.settings_rev,
    };
    let mut header = store::read_header(&key).await;
    if header.as_ref().is_some_and(|h| deadline_passed(h, req.now)) {
        match authz_check::under_flight(engine, flights, &key, link, req.now).await {
            authz_check::Checked::Passed(fresh) => header = Some(fresh),
            authz_check::Checked::Missing => header = None,
            authz_check::Checked::Once(built) => {
                return once(&built, &req, &intents, live, "denied_masked");
            }
            authz_check::Checked::Unavailable => {
                count_read(&link.org_id, "error");
                return Served::Unavailable { retry_after: 60 };
            }
            authz_check::Checked::NotServable => return Served::Gone,
        }
    }
    let header = header.or_else(|| WRITE_BACKOFF.get(&key).map(|h| h.clone()));
    match header {
        Some(h) if h.has_body() => serve_file(engine, flights, &key, h, &req, &intents, live).await,
        other => serve_cold(engine, flights, &key, other, &req, &intents, live).await,
    }
}

/// The due rules in order; an edit or a masked screen after one failure skips the backoff once.
pub fn due(
    header: &Header,
    live: Live,
    relative: bool,
    eff_secs: i64,
    all_masked: bool,
    now: i64,
) -> Due {
    let backoff = in_backoff(header, now);
    let edited = |file: i64, live: i64, idx: usize| {
        file != live && header.attempted_revs.is_none_or(|revs| revs[idx] != live)
    };
    let rules = [
        (
            relative && header.built_at.is_some_and(|b| now > b + eff_secs * SECOND),
            StaleReason::Interval,
            false,
        ),
        (
            header.dashboard_updated_at != live.dashboard_updated_at,
            StaleReason::Dashboard,
            edited(header.dashboard_updated_at, live.dashboard_updated_at, 0),
        ),
        (
            header.link_rev != live.link_rev,
            StaleReason::Link,
            edited(header.link_rev, live.link_rev, 1),
        ),
        (
            header.incomplete_count > 0 && !backoff,
            StaleReason::Retry,
            false,
        ),
        (
            header.settings_rev != live.settings_rev,
            StaleReason::Settings,
            edited(header.settings_rev, live.settings_rev, 2),
        ),
        // Only the first retry: a failure that repeats waits out the capped backoff.
        (
            all_masked && header.fail_streak <= 1,
            StaleReason::Retry,
            true,
        ),
    ];
    Due {
        reason: rules.iter().find(|r| r.0).map(|r| r.1),
        start: rules
            .iter()
            .any(|(holds, _, bypass)| *holds && (*bypass || !backoff)),
    }
}

/// `now + min(30 s * 2^fail_streak, effective interval, 300 s) + jitter`, `jitter` in `0..=0.2`.
pub fn backoff_until(fail_streak: u16, eff_secs: i64, now: i64, jitter: f64) -> i64 {
    let base = BACKOFF_BASE_SECS
        .saturating_mul(1_i64 << fail_streak.min(30))
        .min(eff_secs.max(BACKOFF_BASE_SECS))
        .min(BACKOFF_MAX_SECS);
    now + base * SECOND + (base as f64 * jitter.clamp(0.0, 0.2) * SECOND as f64) as i64
}

/// The build window; a relative end snaps down to the minute so close builds share SQL and buckets.
pub fn window(range: &TimeRange, now: i64) -> (i64, i64) {
    match range {
        TimeRange::Relative { secs } => {
            let end = now - now.rem_euclid(60 * SECOND);
            (end - secs * SECOND, end)
        }
        TimeRange::Absolute { start, end } => (*start, *end),
    }
}

/// Classifies a build against the previous file (design 5.7); `retainable` panels may fall back.
#[allow(clippy::too_many_arguments)]
pub fn assemble(
    live: Live,
    window: (i64, i64),
    run: Run,
    prior: Option<&Prior>,
    retainable: &BTreeSet<String>,
    now: i64,
    build_ms: u64,
    eff_secs: i64,
    jitter: f64,
) -> Assembled {
    let max_age = max_age_micros();
    let ran = run
        .panels
        .iter()
        .any(|p| matches!(p.class, Class::Fresh | Class::Partial | Class::Truncated));
    let first_error = run.panels.iter().find_map(|p| p.error.clone());
    let transient = run.panels.iter().any(|p| p.class == Class::Transient);
    let prior_header = prior.map(|p| p.stored.header.clone());
    let denied: Vec<WithheldPanel> = run
        .panels
        .iter()
        .filter(|p| p.class == Class::Denied)
        .map(|p| WithheldPanel {
            panel_id: p.id.clone(),
            reason: NotAvailableReason::Unauthorized,
        })
        .collect();

    if transient && !ran {
        let mut header = prior_header.unwrap_or_else(|| Header {
            dashboard_updated_at: live.dashboard_updated_at,
            link_rev: live.link_rev,
            settings_rev: live.settings_rev,
            window_start: window.0,
            window_end: window.1,
            auth_checked_at: now,
            ..Default::default()
        });
        for w in denied {
            if !header.is_withheld(&w.panel_id) {
                header.withheld_panels.push(w);
            }
        }
        fail(&mut header, live, now, eff_secs, jitter, first_error);
        return Assembled {
            header,
            manifest: prior.map(|p| p.stored.manifest.clone()).unwrap_or_default(),
            body: None,
            kind: BuildKind::Failed,
        };
    }

    let prior_panels = prior.and_then(|p| p.body.as_ref()).map(|b| &b.panels);
    let mut header = Header {
        built_at: Some(now),
        build_ms,
        auth_checked_at: now,
        window_start: window.0,
        window_end: window.1,
        dashboard_updated_at: live.dashboard_updated_at,
        link_rev: live.link_rev,
        settings_rev: live.settings_rev,
        refresh_count: prior_header.as_ref().map_or(0, |h| h.refresh_count) + 1,
        fail_streak: prior_header.as_ref().map_or(0, |h| h.fail_streak),
        ..Default::default()
    };
    let mut panels = BTreeMap::new();
    let mut manifest = Manifest {
        variables: run.values_dependencies.clone(),
        ..Default::default()
    };
    for mut p in run.panels {
        match p.class {
            Class::Denied => {
                header.withheld_panels.push(WithheldPanel {
                    panel_id: p.id.clone(),
                    reason: NotAvailableReason::Unauthorized,
                });
                p.manifest.outcome = PanelOutcome::Withheld;
            }
            Class::Structural => p.manifest.outcome = PanelOutcome::Unsupported,
            Class::Partial => {
                header.incomplete_count += 1;
                p.manifest.outcome = PanelOutcome::Partial;
            }
            Class::Truncated => p.manifest.outcome = PanelOutcome::Truncated,
            Class::Fresh => p.manifest.outcome = PanelOutcome::Fresh,
            Class::Transient => {
                header.incomplete_count += 1;
                let old = prior_panels.and_then(|b| b.get(&p.id));
                let old_manifest = prior.and_then(|pr| pr.stored.manifest.panels.get(&p.id));
                match retain(old, old_manifest, &p, retainable, now, max_age) {
                    Some((result, m)) => {
                        header.retained_count += 1;
                        p.result = result;
                        p.manifest = m;
                    }
                    None => {
                        p.result = PanelResult::not_available(NotAvailableReason::BuildError);
                        p.result.intent = p.manifest.intent.clone();
                        p.manifest.outcome = PanelOutcome::Failed;
                    }
                }
            }
        }
        if matches!(p.result.state, PanelState::NotAvailable { .. }) {
            header.unavailable_count += 1;
        }
        manifest.panels.insert(p.id.clone(), p.manifest);
        panels.insert(p.id, p.result);
    }
    header.panel_count = u16::try_from(panels.len()).unwrap_or(u16::MAX);
    header.panels = panels
        .iter()
        .map(|(id, p)| PanelSummary {
            id: id.clone(),
            intent: p.intent.clone(),
            state: p.state.clone(),
            built_at: p.built_at,
        })
        .collect();
    let kind = if header.incomplete_count > 0 {
        header.attempted_revs = prior_header.as_ref().and_then(|h| h.attempted_revs);
        fail(&mut header, live, now, eff_secs, jitter, first_error);
        BuildKind::Partial
    } else {
        header.fail_streak = 0;
        BuildKind::Complete
    };
    Assembled {
        header,
        manifest,
        body: Some(ResultBody {
            panels,
            variables: run.variables,
            variable_keys: run.variable_keys,
        }),
        kind,
    }
}

/// The detached work of a build flight (design 5.4); `now` is the build's start.
pub async fn build(
    engine: &'static dyn Engine,
    key: String,
    link_id: String,
    range: TimeRange,
    now: i64,
    flight: Arc<Flight>,
) -> Outcome {
    let started = std::time::Instant::now();
    let cap = match engine.capture(&link_id).await {
        Ok(Some(cap)) => cap,
        Ok(None) => return not_servable(&key, None).await,
        Err(e) => {
            log::error!("public dashboard capture for {key} failed: {e}");
            return Err(Failure::Unavailable);
        }
    };
    let org = cap.link.org_id.clone();
    if !servable(&cap, &range, now) || !engine.trial_ok(&org).await {
        return not_servable(&key, Some(&org)).await;
    }
    match engine.is_member(&org, &cap.link.published_by).await {
        Ok(true) => {}
        Ok(false) => {
            engine.pause_departed(&cap.link).await;
            return not_servable(&key, Some(&org)).await;
        }
        Err(e) => {
            log::error!("public dashboard membership read for {key} failed: {e}");
            return Err(Failure::Unavailable);
        }
    }
    let Some(dashboard) = cap.dashboard.as_ref() else {
        return not_servable(&key, Some(&org)).await;
    };
    let live = Live {
        dashboard_updated_at: dashboard.updated_at,
        link_rev: cap.link.rev,
        settings_rev: cap.settings_rev,
    };
    let eff = effective_secs(&cap.link, &range);
    let prior = read_prior(&key).await;
    if let Some(p) = prior.as_ref().filter(|p| p.body.is_some()) {
        // A build that finished between the miss and this task already holds the answer.
        let h = &p.stored.header;
        let frozen = super::parse_frozen_vars(cap.link.frozen_variables.as_deref());
        let intents = intent::intents(dashboard, &frozen);
        let states = mask::visible_states(h, &intents, now, max_age_micros());
        let masked = all_masked(&intents, &states);
        if !due(h, live, range.is_relative(), eff, masked, now).start && !deadline_passed(h, now) {
            return Ok(Built {
                header: h.clone(),
                body: p.body.clone().map(Arc::new),
                stored: true,
            });
        }
    }
    let family = TraceFamily::new(&org);
    let deadline = tokio::time::Instant::now()
        + Duration::from_secs(u64::from(get_config().public_dashboards.build_timeout_secs));
    let probe = AuthorizerProbe::default();
    let run = drain_by(
        &family,
        deadline,
        engine.run_panels(&cap, &range, &range.key(), now, &family, &flight, &probe),
    )
    .await;
    let retainable = retainable(engine, &cap, prior.as_ref(), &run, &probe).await;
    let build_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let jitter = rand::random_range(0.0..=0.2);
    let assembled = assemble(
        live,
        window(&range, now),
        run,
        prior.as_ref(),
        &retainable,
        now,
        build_ms,
        eff,
        jitter,
    );
    // The file records the captured revisions; a write that moved meanwhile makes it due again.
    match engine.capture(&link_id).await {
        Ok(Some(again)) if servable(&again, &range, now) => {}
        Ok(_) => return not_servable(&key, Some(&org)).await,
        Err(e) => log::warn!("public dashboard revision re-read for {key} failed: {e}"),
    }
    let out = persist(&key, assembled, prior.as_ref()).await;
    metrics::PUBLIC_DASHBOARD_BUILD_SECONDS
        .with_label_values(&[&org])
        .observe(started.elapsed().as_secs_f64());
    out
}

/// Each offered range's state from this querier's files, for the publisher's status call.
pub async fn range_status(link: &PublicDashboard, with_sources: bool) -> Vec<RangeStatus> {
    let mut out = Vec::new();
    for range in super::time_ranges(link).ranges {
        let range_key = range.key();
        let key = store::key(&link.org_id, &link.id, &range_key);
        let building = super::flight::FLIGHTS
            .get(&key)
            .is_some_and(|f| f.kind == Kind::Build);
        let status = match store::read(&key).await {
            None => RangeStatus {
                key: range_key,
                state: if building {
                    RangeState::Building
                } else {
                    RangeState::NotCached
                },
                built_at: None,
                withheld_panels: vec![],
                unavailable_count: 0,
                incomplete_count: 0,
                last_error: None,
                next_retry_at: None,
                sources: None,
            },
            Some(stored) => file_status(range_key, stored, building, with_sources),
        };
        out.push(status);
    }
    out
}

/// Evicts the file of a range the link no longer offers, on the read that asks for it.
pub async fn evict_removed_range(link: &PublicDashboard, range_key: &str) {
    if is_range_key(range_key) {
        store::evict_if_indexed(&store::key(&link.org_id, &link.id, range_key)).await;
    }
}

/// `r{secs}` or `a{start}-{end}`, the only keys a range is stored under.
pub fn is_range_key(key: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    match key.split_at_checked(1) {
        Some(("r", secs)) => digits(secs),
        Some(("a", span)) => span
            .split_once('-')
            .is_some_and(|(a, b)| digits(a) && digits(b)),
        _ => false,
    }
}

/// Whether the captured rows still allow serving this range (design 5.4 step 2).
pub fn servable(cap: &Capture, range: &TimeRange, now: i64) -> bool {
    let link = &cap.link;
    cap.org_enabled
        && cap.dashboard.is_some()
        && link.deleted_at.is_none()
        && link.visibility == 1
        && link.enabled
        && link.expires_at.is_none_or(|exp| exp > now)
        && !db::org_status::is_blocked(&link.org_id)
        && super::time_ranges(link).ranges.contains(range)
}

pub fn deadline_passed(header: &Header, now: i64) -> bool {
    header.has_body() && now - header.auth_checked_at >= authz_check::AUTH_DEADLINE_MICROS
}

/// The hex rev over everything visible in a response (design 4.4), from the header alone.
pub fn rev(
    header: &Header,
    states: &[(String, PanelState)],
    stale_reason: Option<StaleReason>,
    refreshing: bool,
    next_retry_at: Option<i64>,
    fresh_until: Option<i64>,
) -> String {
    let doc = serde_json::json!([
        header.incarnation,
        header.withheld_panels,
        header.withheld_variables,
        states,
        stale_reason.is_some(),
        stale_reason,
        refreshing,
        next_retry_at,
        header.last_error_at,
        header.dashboard_updated_at,
        header.link_rev,
        header.settings_rev,
        fresh_until,
    ]);
    format!("{:016x}", gxhash::new().sum64(&doc.to_string()))
}

/// Whether an If-None-Match value names this rev, weak or strong, alone or in a list.
pub fn etag_matches(header_value: &str, rev: &str) -> bool {
    header_value.split(',').any(|tag| {
        let tag = tag.trim();
        let tag = tag.strip_prefix("W/").unwrap_or(tag);
        tag == "*" || tag.trim_matches('"') == rev
    })
}

/// The poll hint while refreshing: `max(3 s, the remaining expected build time)` plus up to 20%.
pub fn retry_hint(flight: Option<&Flight>, last_build_ms: u64, now: i64, jitter: f64) -> u64 {
    let expected = flight.map_or(0, |f| {
        let by_estimate = f.remaining_secs(now);
        let elapsed = u64::try_from((now - f.started_at) / SECOND).unwrap_or(0);
        by_estimate.max((last_build_ms / 1000).saturating_sub(elapsed))
    });
    let base = expected.max(MIN_RETRY_SECS);
    base + (base as f64 * jitter.clamp(0.0, 0.2)).round() as u64
}

pub fn effective_secs(link: &PublicDashboard, range: &TimeRange) -> i64 {
    let min = i64::from(get_config().public_dashboards.min_refresh_secs);
    range.effective_refresh_secs(i64::from(link.refresh_secs), min)
}

/// Counts one data read by outcome (design 8.5).
pub fn count_read(org: &str, outcome: &str) {
    metrics::PUBLIC_DASHBOARD_READS_TOTAL
        .with_label_values(&[org, outcome])
        .inc();
}

fn in_backoff(header: &Header, now: i64) -> bool {
    header.next_retry_at.is_some_and(|t| t > now)
}

fn fail(
    header: &mut Header,
    live: Live,
    now: i64,
    eff_secs: i64,
    jitter: f64,
    error: Option<String>,
) {
    // The streak counts failures of one set of revisions, so an edit starts it over.
    if header.attempted_revs != Some(live.as_array()) {
        header.fail_streak = 0;
    }
    header.next_retry_at = Some(backoff_until(header.fail_streak, eff_secs, now, jitter));
    header.fail_streak = header.fail_streak.saturating_add(1);
    header.last_error_at = Some(now);
    header.last_error = error.or_else(|| Some("the build failed".to_string()));
    header.attempted_revs = Some(live.as_array());
}

/// A failed panel's prior data, kept with an unchanged intent, young data, passing sources.
fn retain(
    old: Option<&PanelResult>,
    old_manifest: Option<&ManifestPanel>,
    run: &PanelRun,
    retainable: &BTreeSet<String>,
    now: i64,
    max_age: i64,
) -> Option<(PanelResult, ManifestPanel)> {
    let old = old?;
    let PanelState::Ok {
        retained,
        error_since,
        partial,
        truncated,
    } = &old.state
    else {
        return None;
    };
    let young = old.built_at.is_some_and(|at| at >= now - max_age);
    if old.intent != run.manifest.intent || !young || !retainable.contains(&run.id) {
        return None;
    }
    let mut result = old.clone();
    result.state = PanelState::Ok {
        retained: true,
        error_since: if *retained { *error_since } else { Some(now) },
        partial: *partial,
        truncated: *truncated,
    };
    let mut manifest = old_manifest
        .cloned()
        .unwrap_or_else(|| run.manifest.clone());
    manifest.outcome = PanelOutcome::Retained;
    Some((result, manifest))
}

/// Prior panels a transient failure may fall back to, re-authorized against their own manifest.
async fn retainable(
    engine: &'static dyn Engine,
    cap: &Capture,
    prior: Option<&Prior>,
    run: &Run,
    probe: &AuthorizerProbe,
) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let Some(prior) = prior else {
        return out;
    };
    for p in run.panels.iter().filter(|p| p.class == Class::Transient) {
        let Some(m) = prior.stored.manifest.panels.get(&p.id) else {
            continue;
        };
        if prior.stored.header.is_withheld(&p.id) {
            continue;
        }
        if let Ok(true) = engine
            .authorize(&cap.link.org_id, &cap.link.published_by, m, probe)
            .await
        {
            out.insert(p.id.clone());
        }
    }
    out
}

async fn read_prior(key: &str) -> Option<Prior> {
    let stored = store::read(key).await?;
    let body = if stored.body_zst.is_empty() {
        None
    } else {
        store::decompress_body(&stored.body_zst)
            .ok()
            .and_then(|json| serde_json::from_slice(&json).ok())
    };
    Some(Prior { stored, body })
}

/// Writes the build; on failure waiters still get it, the old file goes and the key backs off.
async fn persist(key: &str, assembled: Assembled, prior: Option<&Prior>) -> Outcome {
    let org = key.split('/').nth(1).unwrap_or_default().to_string();
    let Assembled {
        mut header,
        manifest,
        body,
        kind,
    } = assembled;
    metrics::PUBLIC_DASHBOARD_BUILDS_TOTAL
        .with_label_values(&[&org, kind.label()])
        .inc();
    let (written, body) = match body {
        Some(b) => (
            store::write(key, &mut header, &manifest, Some(&b)).await,
            Some(Arc::new(b)),
        ),
        None => {
            let old_zst = prior.map(|p| p.stored.body_zst.clone()).unwrap_or_default();
            let old_body = prior.and_then(|p| p.body.clone()).map(Arc::new);
            (
                store::write_raw(key, &mut header, &manifest, old_zst).await,
                old_body,
            )
        }
    };
    match written {
        Ok(_) => {
            WRITE_BACKOFF.remove(key);
            metrics::PUBLIC_DASHBOARD_RESULT_BYTES
                .with_label_values(&[&org])
                .observe(f64::from(header.size_bytes));
            Ok(Built {
                header,
                body,
                stored: true,
            })
        }
        Err(e) => {
            log::error!("public dashboard file {key} write failed: {e}");
            store::evict(key).await;
            let mut held = Header {
                built_at: None,
                ..header.clone()
            };
            if held.next_retry_at.is_none() {
                let eff = (header.window_end - header.window_start) / SECOND;
                held.next_retry_at = Some(backoff_until(0, eff.max(60), now_micros(), 0.0));
            }
            held.last_error_at = Some(now_micros());
            WRITE_BACKOFF.insert(key.to_string(), held);
            Ok(Built {
                header,
                body,
                stored: false,
            })
        }
    }
}

async fn not_servable(key: &str, org: Option<&str>) -> Outcome {
    store::evict(key).await;
    if let Some(org) = org {
        metrics::PUBLIC_DASHBOARD_BUILDS_TOTAL
            .with_label_values(&[org, "not_servable"])
            .inc();
    }
    Err(Failure::NotServable)
}

async fn serve_file(
    engine: &'static dyn Engine,
    flights: &'static Flights,
    key: &str,
    header: Header,
    req: &ReadRequest<'_>,
    intents: &BTreeMap<String, String>,
    live: Live,
) -> Served {
    let link = req.link;
    let eff = effective_secs(link, &req.range);
    let states = mask::visible_states(&header, intents, req.now, max_age_micros());
    // A build already running is joined by start_build, never started twice.
    let due = due(
        &header,
        live,
        req.range.is_relative(),
        eff,
        all_masked(intents, &states),
        req.now,
    );
    let flight = if due.start {
        match start_build(engine, flights, key, link, &req.range, req.now) {
            Start::Leader(f) => Some(f),
            Start::Follower(f) => (f.kind == Kind::Build).then_some(f),
            Start::Capacity => None,
        }
    } else {
        flights.get(key).filter(|f| f.kind == Kind::Build)
    };
    let retry_hint = flight.as_ref().map(|f| {
        retry_hint(
            Some(f),
            header.build_ms,
            req.now,
            rand::random_range(0.0..=0.2),
        )
    });
    let rev = rev_for(&header, &states, req, due.reason, flight.is_some(), eff);
    if req.if_none_match.is_some_and(|v| etag_matches(v, &rev)) {
        return Served::NotModified { rev, retry_hint };
    }
    let Some(body) = store::body(key, &header).await else {
        // Replaced or evicted since the header read: answer as a miss.
        return serve_cold(engine, flights, key, None, req, intents, live).await;
    };
    let response = envelope(
        &header,
        &body,
        req,
        intents,
        due.reason,
        flight.is_some(),
        eff,
        rev,
    );
    Served::Data {
        response: Box::new(response),
        retry_hint,
        outcome: if due.reason.is_some() {
            "stale"
        } else {
            "fresh"
        },
    }
}

async fn serve_cold(
    engine: &'static dyn Engine,
    flights: &'static Flights,
    key: &str,
    held: Option<Header>,
    req: &ReadRequest<'_>,
    intents: &BTreeMap<String, String>,
    live: Live,
) -> Served {
    let link = req.link;
    let cfg = &get_config().public_dashboards;
    if let Some(h) = held.as_ref() {
        let edited = live != Live::of(h) && h.attempted_revs != Some(live.as_array());
        if in_backoff(h, req.now) && !edited {
            count_read(&link.org_id, "cooldown_503");
            return Served::Cooldown(NotReadyResponse::Cooldown {
                last_error_at: h.last_error_at,
                next_retry_at: h.next_retry_at.unwrap_or(req.now),
            });
        }
    }
    // A cold read that starts the build is a miss; one that joins it is a wait.
    let (flight, label) = match start_build(engine, flights, key, link, &req.range, req.now) {
        Start::Leader(f) => (f, "cold_miss"),
        Start::Follower(f) if f.kind == Kind::Build => (f, "cold_wait"),
        // A deadline check holds the key: its file appeared or went since this read began.
        Start::Follower(f) => {
            count_read(&link.org_id, "building_202");
            return Served::Building(f.building(now_micros()));
        }
        Start::Capacity => {
            count_read(&link.org_id, "error");
            return Served::Unavailable {
                retry_after: MIN_RETRY_SECS * 2,
            };
        }
    };
    let timeout = Duration::from_secs(u64::from(cfg.query_timeout_secs));
    let outcome = match flight.wait(timeout, cfg.max_cold_waiters).await {
        Wait::Done(outcome) => *outcome,
        Wait::Full | Wait::TimedOut => {
            count_read(&link.org_id, "building_202");
            return Served::Building(flight.building(now_micros()));
        }
    };
    match outcome {
        Ok(built) => match built.body.as_ref() {
            Some(_) => once(&built, req, intents, live, label),
            None => {
                count_read(&link.org_id, "cooldown_503");
                Served::Cooldown(NotReadyResponse::Cooldown {
                    last_error_at: built.header.last_error_at,
                    next_retry_at: built.header.next_retry_at.unwrap_or(req.now),
                })
            }
        },
        Err(Failure::NotServable) => Served::Gone,
        Err(_) => {
            count_read(&link.org_id, "error");
            Served::Unavailable {
                retry_after: MIN_RETRY_SECS * 2,
            }
        }
    }
}

/// A flight's own result, masked, with no refresh in progress.
fn once(
    built: &Built,
    req: &ReadRequest<'_>,
    intents: &BTreeMap<String, String>,
    live: Live,
    outcome: &'static str,
) -> Served {
    let Some(body) = built.body.as_ref() else {
        return Served::Unavailable {
            retry_after: MIN_RETRY_SECS * 2,
        };
    };
    let eff = effective_secs(req.link, &req.range);
    let states = mask::visible_states(&built.header, intents, req.now, max_age_micros());
    let relative = req.range.is_relative();
    let due = due(
        &built.header,
        live,
        relative,
        eff,
        all_masked(intents, &states),
        req.now,
    );
    let rev = rev_for(&built.header, &states, req, due.reason, false, eff);
    if req.if_none_match.is_some_and(|v| etag_matches(v, &rev)) {
        return Served::NotModified {
            rev,
            retry_hint: None,
        };
    }
    let response = envelope(
        &built.header,
        body,
        req,
        intents,
        due.reason,
        false,
        eff,
        rev,
    );
    Served::Data {
        response: Box::new(response),
        retry_hint: None,
        outcome,
    }
}

fn start_build(
    engine: &'static dyn Engine,
    flights: &'static Flights,
    key: &str,
    link: &PublicDashboard,
    range: &TimeRange,
    now: i64,
) -> Start {
    let (key_owned, link_id, range) = (key.to_string(), link.id.clone(), *range);
    flights.start(key, &link.org_id, Kind::Build, move |flight| {
        build(engine, key_owned, link_id, range, now, flight)
    })
}

#[allow(clippy::too_many_arguments)]
fn envelope(
    header: &Header,
    body: &ResultBody,
    req: &ReadRequest<'_>,
    intents: &BTreeMap<String, String>,
    reason: Option<StaleReason>,
    refreshing: bool,
    eff: i64,
    rev: String,
) -> DataResponse {
    DataResponse {
        rev,
        built_at: header.built_at.unwrap_or_default(),
        window: Window {
            start: header.window_start,
            end: header.window_end,
        },
        refresh_secs: eff,
        fresh_until: fresh_until(header, req, eff),
        stale: reason.is_some(),
        stale_reason: reason,
        refreshing,
        next_retry_at: header.next_retry_at.filter(|t| *t > req.now),
        last_error_at: header.last_error_at,
        dashboard_updated_at: header.dashboard_updated_at,
        link_rev: header.link_rev,
        settings_rev: header.settings_rev,
        variables: mask::variables(body, header),
        panels: mask::mask(body, header, intents, req.now, max_age_micros()),
    }
}

fn rev_for(
    header: &Header,
    states: &[(String, PanelState)],
    req: &ReadRequest<'_>,
    reason: Option<StaleReason>,
    refreshing: bool,
    eff: i64,
) -> String {
    let next_retry_at = header.next_retry_at.filter(|t| *t > req.now);
    rev(
        header,
        states,
        reason,
        refreshing,
        next_retry_at,
        fresh_until(header, req, eff),
    )
}

/// Nothing useful is on screen: every live panel is new since the build or hidden as changed.
fn all_masked(intents: &BTreeMap<String, String>, states: &[(String, PanelState)]) -> bool {
    let changed = PanelState::NotAvailable {
        reason: NotAvailableReason::Changed,
    };
    !intents.is_empty()
        && intents.keys().all(|id| {
            states
                .iter()
                .find(|(shown, _)| shown == id)
                .is_none_or(|(_, state)| *state == changed)
        })
}

fn fresh_until(header: &Header, req: &ReadRequest<'_>, eff: i64) -> Option<i64> {
    req.range
        .is_relative()
        .then_some(header.built_at.unwrap_or_default() + eff * SECOND)
}

fn max_age_micros() -> i64 {
    i64::from(get_config().public_dashboards.max_panel_age_hours) * 3600 * SECOND
}

fn file_status(
    range_key: String,
    stored: Stored,
    building: bool,
    with_sources: bool,
) -> RangeStatus {
    let h = &stored.header;
    let attention = h.last_error_at.is_some() || !h.withheld_panels.is_empty();
    let state = if building {
        RangeState::Building
    } else if !h.has_body() || attention {
        RangeState::NeedsAttention
    } else {
        RangeState::Cached
    };
    let sources = with_sources.then(|| {
        stored
            .manifest
            .panels
            .iter()
            .map(|(id, m)| (id.clone(), m.sources.clone()))
            .collect()
    });
    RangeStatus {
        key: range_key,
        state,
        built_at: h.built_at,
        withheld_panels: h.withheld_panels.clone(),
        unavailable_count: h.unavailable_count,
        incomplete_count: h.incomplete_count,
        last_error: h.last_error.clone(),
        next_retry_at: h.next_retry_at,
        sources,
    }
}

#[cfg(test)]
pub(super) mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicI64, AtomicU64, AtomicUsize, Ordering},
    };

    use config::meta::stream::StreamType;
    use serde_json::json;

    use super::{super::store::ExecutedQuery, *};

    const MIN: i64 = 60 * SECOND;
    const DAY_SECS: i64 = 86_400;

    /// An in-process engine: panels end as `classes` says; `denied` streams and tables are refused.
    pub(in super::super) struct Fake {
        link: Mutex<PublicDashboard>,
        dashboard: Mutex<Option<Dashboard>>,
        settings_rev: AtomicI64,
        classes: Mutex<BTreeMap<String, Class>>,
        pub(in super::super) denied: Mutex<BTreeSet<String>>,
        /// None: the membership read fails.
        member: Mutex<Option<bool>>,
        authz_down: AtomicBool,
        builds: AtomicUsize,
        authz_calls: AtomicUsize,
        delay_ms: AtomicU64,
        panic: AtomicBool,
    }

    #[async_trait]
    impl Engine for Fake {
        async fn capture(&self, _link_id: &str) -> Result<Option<Capture>, anyhow::Error> {
            Ok(Some(Capture {
                link: self.link.lock().unwrap().clone(),
                dashboard: self.dashboard.lock().unwrap().clone(),
                settings_rev: self.settings_rev.load(Ordering::SeqCst),
                org_enabled: true,
            }))
        }

        #[allow(clippy::too_many_arguments)]
        async fn run_panels(
            &self,
            cap: &Capture,
            _range: &TimeRange,
            _range_key: &str,
            now: i64,
            _family: &TraceFamily,
            _flight: &Flight,
            _probe: &AuthorizerProbe,
        ) -> Run {
            let n = self.builds.fetch_add(1, Ordering::SeqCst) + 1;
            let delay = self.delay_ms.load(Ordering::SeqCst);
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            assert!(!self.panic.load(Ordering::SeqCst), "the fake build panics");
            let dash = cap.dashboard.as_ref().unwrap();
            let frozen = super::super::parse_frozen_vars(cap.link.frozen_variables.as_deref());
            let classes = self.classes.lock().unwrap().clone();
            let panels = intent::intents(dash, &frozen)
                .into_iter()
                .map(|(id, intent)| {
                    let stream = stream_of(dash, &id);
                    let manifest = ManifestPanel {
                        intent,
                        sources: vec![(StreamType::Logs, stream.clone())],
                        queries: vec![ExecutedQuery {
                            text: format!("SELECT * FROM \"{stream}\""),
                            query_type: "sql".into(),
                            ..Default::default()
                        }],
                        built_at: Some(now),
                        ..Default::default()
                    };
                    fake_run(id, &classes, manifest, n, now)
                })
                .collect();
            // One variable whose value came from a values query on stream `vals`.
            Run {
                panels,
                variables: vec![PublicVariable {
                    label: "svc".into(),
                    value: json!("checkout"),
                    tab_id: None,
                    panel_id: None,
                }],
                variable_keys: vec!["svc".into()],
                values_dependencies: vec![ValuesDependency {
                    variable: "svc".into(),
                    sources: vec![(StreamType::Logs, "vals".into())],
                }],
            }
        }

        async fn is_member(&self, _org: &str, _user: &str) -> Result<bool, anyhow::Error> {
            self.member
                .lock()
                .unwrap()
                .ok_or_else(|| anyhow::anyhow!("the database is down"))
        }

        async fn pause_departed(&self, _link: &PublicDashboard) {
            self.link.lock().unwrap().enabled = false;
        }

        async fn authorize(
            &self,
            _org: &str,
            _user: &str,
            panel: &ManifestPanel,
            _probe: &AuthorizerProbe,
        ) -> Result<bool, anyhow::Error> {
            self.authz_calls.fetch_add(1, Ordering::SeqCst);
            if self.authz_down.load(Ordering::SeqCst) {
                anyhow::bail!("the authorizer is down");
            }
            let denied = self.denied.lock().unwrap();
            let mut streams = panel.sources.iter().chain(
                panel
                    .values_dependencies
                    .iter()
                    .flat_map(|d| d.sources.iter()),
            );
            Ok(!streams.any(|(_, s)| denied.contains(s))
                && !panel
                    .enrichment_tables
                    .iter()
                    .any(|(_, t)| denied.contains(t)))
        }

        async fn trial_ok(&self, _org: &str) -> bool {
            true
        }
    }

    fn fake_run(
        id: String,
        classes: &BTreeMap<String, Class>,
        manifest: ManifestPanel,
        build: usize,
        now: i64,
    ) -> PanelRun {
        let class = classes.get(&id).copied().unwrap_or(Class::Fresh);
        match class {
            Class::Denied => PanelRun::not_available(
                &id,
                class,
                NotAvailableReason::Unauthorized,
                manifest,
                None,
            ),
            Class::Structural => {
                PanelRun::not_available(&id, class, NotAvailableReason::Unsupported, manifest, None)
            }
            Class::Transient => PanelRun::not_available(
                &id,
                class,
                NotAvailableReason::BuildError,
                manifest,
                Some("querier unavailable".into()),
            ),
            Class::Fresh | Class::Partial | Class::Truncated => PanelRun {
                result: PanelResult {
                    state: PanelState::Ok {
                        retained: false,
                        error_since: None,
                        partial: class == Class::Partial,
                        truncated: class == Class::Truncated,
                    },
                    intent: manifest.intent.clone(),
                    built_at: Some(now),
                    window: Some(Window { start: 0, end: 1 }),
                    data: vec![json!({ "build": build })],
                    result_meta_data: vec![],
                    metadata: json!({ "queries": [] }),
                },
                id,
                class,
                manifest,
                error: None,
            },
        }
    }

    fn stream_of(dash: &Dashboard, panel_id: &str) -> String {
        dash.v8
            .as_ref()
            .and_then(|v8| {
                v8.tabs
                    .iter()
                    .flat_map(|t| t.panels.iter())
                    .find(|p| p.id == panel_id)
            })
            .and_then(|p| p.queries.first())
            .map(|q| q.fields.stream.clone())
            .unwrap_or_default()
    }

    fn dashboard(panels: &[(&str, &str)]) -> Dashboard {
        let panels: Vec<serde_json::Value> = panels
            .iter()
            .map(|(id, stream)| {
                json!({
                    "id": id, "type": "table", "title": id, "description": "",
                    "config": { "show_legends": false, "legends_position": null },
                    "queryType": "sql",
                    "queries": [{
                        "query": format!("SELECT * FROM \"{stream}\""), "customQuery": true,
                        "fields": { "stream": stream, "stream_type": "logs", "x": [], "y": [],
                                    "filter": { "filterType": "group", "logicalOperator": "AND", "conditions": [] } },
                        "config": { "promql_legend": "" }
                    }]
                })
            })
            .collect();
        Dashboard {
            version: 8,
            updated_at: 1_000,
            v8: Some(
                serde_json::from_value(json!({ "title": "t", "tabs": [{ "tabId": "t1", "name": "", "panels": panels }] }))
                    .unwrap(),
            ),
            ..Default::default()
        }
    }

    fn link(ranges: serde_json::Value) -> PublicDashboard {
        let id = config::ider::uuid();
        PublicDashboard {
            org_id: format!("org-{id}"),
            folder_id: "f".into(),
            dashboard_id: "d".into(),
            slug: id.chars().take(22).collect(),
            name: "n".into(),
            visibility: 1,
            time_ranges: Some(ranges.to_string()),
            default_range_key: None,
            frozen_variables: None,
            refresh_secs: 300,
            dashboard_version: 8,
            published_by: "publisher@example.com".into(),
            enabled: true,
            expires_at: None,
            created_by: "publisher@example.com".into(),
            updated_by: None,
            created_at: 1,
            updated_at: 1,
            rev: 7,
            deleted_at: None,
            last_accessed_at: None,
            access_count: 0,
            id,
        }
    }

    pub(in super::super) fn fake(link: &PublicDashboard, dash: &Dashboard) -> &'static Fake {
        Box::leak(Box::new(Fake {
            link: Mutex::new(link.clone()),
            dashboard: Mutex::new(Some(dash.clone())),
            settings_rev: AtomicI64::new(0),
            classes: Mutex::new(BTreeMap::new()),
            denied: Mutex::new(BTreeSet::new()),
            member: Mutex::new(Some(true)),
            authz_down: AtomicBool::new(false),
            builds: AtomicUsize::new(0),
            authz_calls: AtomicUsize::new(0),
            delay_ms: AtomicU64::new(0),
            panic: AtomicBool::new(false),
        }))
    }

    fn flights(max: u32, per_org: u32) -> &'static Flights {
        Box::leak(Box::new(Flights::new(max, per_org)))
    }

    fn rel(secs: i64) -> TimeRange {
        TimeRange::Relative { secs }
    }

    async fn read_at(
        engine: &'static Fake,
        flights: &'static Flights,
        link: &PublicDashboard,
        dash: &Dashboard,
        range: TimeRange,
        now: i64,
    ) -> Served {
        read(
            engine,
            flights,
            ReadRequest {
                link,
                settings_rev: engine.settings_rev.load(Ordering::SeqCst),
                dashboard: dash,
                range,
                now,
                if_none_match: None,
            },
        )
        .await
    }

    fn data(served: &Served) -> &DataResponse {
        match served {
            Served::Data { response, .. } => response,
            other => panic!("expected data, got {other:?}"),
        }
    }

    fn reason(resp: &DataResponse, id: &str) -> Option<NotAvailableReason> {
        match resp.panels[id].state {
            PanelState::NotAvailable { reason } => Some(reason),
            PanelState::Ok { .. } => None,
        }
    }

    fn build_no(resp: &DataResponse, id: &str) -> i64 {
        resp.panels[id].data[0]["build"].as_i64().unwrap()
    }

    async fn settle(flights: &'static Flights) {
        for _ in 0..200 {
            if flights.in_flight() == 0 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("a flight never finished");
    }

    async fn header(link: &PublicDashboard, range: &TimeRange) -> Header {
        store::read_header(&store::key(&link.org_id, &link.id, &range.key()))
            .await
            .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn gate01_one_hundred_cold_reads_start_one_build_and_all_get_its_outcome() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
        let engine = fake(&link, &dash);
        engine.delay_ms.store(200, Ordering::SeqCst);
        let flights = flights(8, 1);
        let now = now_micros();
        let tasks: Vec<_> = (0..100)
            .map(|_| {
                let (link, dash) = (link.clone(), dash.clone());
                tokio::spawn(
                    async move { read_at(engine, flights, &link, &dash, rel(3600), now).await },
                )
            })
            .collect();
        let mut revs = BTreeSet::new();
        for task in tasks {
            revs.insert(data(&task.await.unwrap()).rev.clone());
        }
        assert_eq!(engine.builds.load(Ordering::SeqCst), 1);
        assert_eq!(revs.len(), 1, "every waiter got the one build's outcome");
        settle(flights).await;
        assert_eq!(flights.available_permits(), 8);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn gate01_with_a_per_org_cap_above_one_each_key_still_builds_once() {
        let link = link(json!([
            { "type": "relative", "secs": 3600 },
            { "type": "relative", "secs": 86400 }
        ]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        engine.delay_ms.store(200, Ordering::SeqCst);
        let flights = flights(8, 2);
        let now = now_micros();
        let tasks: Vec<_> = (0..100)
            .map(|i| {
                let (link, dash) = (link.clone(), dash.clone());
                let range = if i % 2 == 0 { rel(3600) } else { rel(DAY_SECS) };
                tokio::spawn(
                    async move { read_at(engine, flights, &link, &dash, range, now).await },
                )
            })
            .collect();
        for task in tasks {
            data(&task.await.unwrap());
        }
        // Two keys of one org ran side by side under a cap of two, one build each.
        assert_eq!(engine.builds.load(Ordering::SeqCst), 2);
        settle(flights).await;
    }

    #[tokio::test]
    async fn gate01_a_panicking_build_leaves_no_placeholder_and_frees_its_permits() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        engine.panic.store(true, Ordering::SeqCst);
        let flights = flights(1, 1);
        let served = read_at(engine, flights, &link, &dash, rel(3600), now_micros()).await;
        assert!(matches!(served, Served::Unavailable { .. }), "{served:?}");
        settle(flights).await;
        assert_eq!(flights.available_permits(), 1);
        engine.panic.store(false, Ordering::SeqCst);
        let served = read_at(engine, flights, &link, &dash, rel(3600), now_micros()).await;
        data(&served);
    }

    #[tokio::test]
    async fn gate01_a_failed_write_serves_the_result_once_and_holds_the_key_in_backoff() {
        let key = "public_dashboards/o/../../escape/r60".to_string();
        let assembled = Assembled {
            header: Header {
                built_at: Some(1),
                window_start: 0,
                window_end: 60 * SECOND,
                ..Default::default()
            },
            manifest: Manifest::default(),
            body: Some(ResultBody::default()),
            kind: BuildKind::Complete,
        };
        let built = persist(&key, assembled, None).await.unwrap();
        assert!(!built.stored);
        assert!(built.body.is_some(), "current waiters still get the result");
        let held = WRITE_BACKOFF.get(&key).unwrap().clone();
        assert!(!held.has_body());
        assert!(held.next_retry_at.unwrap() > now_micros());
    }

    #[tokio::test]
    async fn gate02_the_deadline_withholds_a_lost_stream_on_relative_and_absolute_files() {
        let link = link(json!([
            { "type": "relative", "secs": 30 * DAY_SECS },
            { "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }
        ]));
        let dash = dashboard(&[("p1", "secret"), ("p2", "public")]);
        let engine = fake(&link, &dash);
        let abs = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let now = now_micros();
        for range in [rel(30 * DAY_SECS), abs] {
            assert_eq!(
                reason(
                    data(&read_at(engine, flights(8, 1), &link, &dash, range, now).await),
                    "p1"
                ),
                None
            );
        }
        // The publisher loses the stream; every rebuild would fail and no build can start.
        engine.denied.lock().unwrap().insert("secret".into());
        engine.classes.lock().unwrap().extend([
            ("p1".to_string(), Class::Transient),
            ("p2".to_string(), Class::Transient),
        ]);
        let full = flights(1, 1);
        let blocker = full.start("other-key", &link.org_id, Kind::Build, |_| async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            Err(Failure::Panic)
        });
        assert!(matches!(blocker, Start::Leader(_)));
        let builds = engine.builds.load(Ordering::SeqCst);
        let later = now + 16 * MIN;
        for range in [rel(30 * DAY_SECS), abs] {
            let served = read_at(engine, full, &link, &dash, range, later).await;
            let resp = data(&served);
            assert_eq!(reason(resp, "p1"), Some(NotAvailableReason::Unauthorized));
            assert!(resp.panels["p1"].data.is_empty());
            assert_eq!(reason(resp, "p2"), None);
            let h = header(&link, &range).await;
            assert!(h.is_withheld("p1"));
            assert!(h.auth_checked_at >= later);
        }
        assert_eq!(engine.builds.load(Ordering::SeqCst), builds, "no build ran");
    }

    #[tokio::test]
    async fn gate02_a_failing_authorizer_or_membership_read_fails_closed_with_503() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &dash, rel(3600), now).await);
        let before = header(&link, &rel(3600)).await;
        engine.authz_down.store(true, Ordering::SeqCst);
        let served = read_at(engine, flights, &link, &dash, rel(3600), now + 16 * MIN).await;
        assert!(matches!(served, Served::Unavailable { .. }), "{served:?}");
        // An outage records nothing: the header is not rewritten and no panel is withheld.
        assert_eq!(header(&link, &rel(3600)).await, before);
        engine.authz_down.store(false, Ordering::SeqCst);
        *engine.member.lock().unwrap() = None;
        let served = read_at(engine, flights, &link, &dash, rel(3600), now + 16 * MIN).await;
        assert!(matches!(served, Served::Unavailable { .. }), "{served:?}");
        // A departed publisher pauses the link and its file goes.
        *engine.member.lock().unwrap() = Some(false);
        let served = read_at(engine, flights, &link, &dash, rel(3600), now + 16 * MIN).await;
        assert!(matches!(served, Served::Gone), "{served:?}");
        assert!(!engine.link.lock().unwrap().enabled);
        assert!(
            store::read_header(&store::key(&link.org_id, &link.id, "r3600"))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn gate02_reading_one_range_does_not_postpone_another_ranges_deadline() {
        let link = link(json!([
            { "type": "relative", "secs": 3600 },
            { "type": "relative", "secs": 86400 }
        ]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        for range in [rel(3600), rel(DAY_SECS)] {
            data(&read_at(engine, flights, &link, &dash, range, now).await);
        }
        settle(flights).await;
        let before = header(&link, &rel(DAY_SECS)).await.auth_checked_at;
        data(&read_at(engine, flights, &link, &dash, rel(3600), now + 16 * MIN).await);
        settle(flights).await;
        assert!(header(&link, &rel(3600)).await.auth_checked_at >= now + 16 * MIN);
        assert_eq!(header(&link, &rel(DAY_SECS)).await.auth_checked_at, before);
        engine.denied.lock().unwrap().insert("s1".into());
        let resp = read_at(engine, flights, &link, &dash, rel(DAY_SECS), now + 16 * MIN).await;
        assert_eq!(
            reason(data(&resp), "p1"),
            Some(NotAvailableReason::Unauthorized)
        );
        settle(flights).await;
    }

    #[tokio::test]
    async fn gate03_the_deadline_checks_the_stream_the_data_came_from_not_the_live_query() {
        let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let built_from = dashboard(&[("p1", "private_s")]);
        let engine = fake(&link, &built_from);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &built_from, range, now).await);
        // The query moves to stream T, its rebuild fails, and the publisher loses S only.
        let mut edited = dashboard(&[("p1", "public_t")]);
        edited.updated_at = 2_000;
        *engine.dashboard.lock().unwrap() = Some(edited.clone());
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p1".into(), Class::Transient);
        engine.denied.lock().unwrap().insert("private_s".into());
        let resp = read_at(engine, flights, &link, &edited, range, now + 16 * MIN).await;
        assert_eq!(
            reason(data(&resp), "p1"),
            Some(NotAvailableReason::Unauthorized)
        );
        settle(flights).await;
        let h = header(&link, &range).await;
        assert!(h.is_withheld("p1"));
        // The anonymous body never carries the manifest.
        let json = serde_json::to_string(data(&resp)).unwrap();
        assert!(
            !json.contains("private_s") && !json.contains("sources"),
            "{json}"
        );
    }

    #[tokio::test]
    async fn gate03_a_narrowed_frozen_filter_masks_the_old_panel_before_any_rebuild() {
        let ranges = json!([{ "type": "relative", "secs": 3600 }]);
        let mut link = link(ranges);
        let mut dash = dashboard(&[("p1", "s1")]);
        let v8 = dash.v8.as_mut().unwrap();
        v8.tabs[0].panels[0].queries[0].query =
            Some("SELECT * FROM \"s1\" WHERE env = '$env'".into());
        v8.variables = Some(
            serde_json::from_value(
                json!({ "list": [{ "type": "custom", "name": "env", "label": "Env" }] }),
            )
            .unwrap(),
        );
        link.frozen_variables = Some(r#"{"env":"prod"}"#.into());
        let engine = fake(&link, &dash);
        let now = now_micros();
        data(&read_at(engine, flights(8, 1), &link, &dash, rel(3600), now).await);
        link.frozen_variables = Some(r#"{"env":"staging"}"#.into());
        link.rev += 1;
        // No build capacity: the old body is all there is, and its panel is masked.
        let full = flights(1, 1);
        let _blocker = full.start("blocker", &link.org_id, Kind::Build, |_| async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            Err(Failure::Panic)
        });
        let resp = read_at(engine, full, &link, &dash, rel(3600), now + MIN).await;
        assert_eq!(reason(data(&resp), "p1"), Some(NotAvailableReason::Changed));
        assert_eq!(data(&resp).stale_reason, Some(StaleReason::Link));
    }

    #[tokio::test]
    async fn gate06_an_evicted_and_rebuilt_range_never_serves_the_older_body() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        let first = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        assert_eq!(build_no(&first, "p1"), 1);
        let hot = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        assert_eq!(hot.rev, first.rev);
        let key = store::key(&link.org_id, &link.id, "r3600");
        let old_incarnation = store::read_header(&key).await.unwrap().incarnation;
        store::evict(&key).await;
        let rebuilt = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        assert_eq!(build_no(&rebuilt, "p1"), 2);
        assert_ne!(rebuilt.rev, first.rev);
        assert!(store::read_header(&key).await.unwrap().incarnation > old_incarnation);
    }

    #[tokio::test]
    async fn gate11_a_cold_partial_absolute_build_is_retried_at_next_retry_at() {
        let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
        let engine = fake(&link, &dash);
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p1".into(), Class::Transient);
        let flights = flights(8, 1);
        let now = now_micros();
        let resp = data(&read_at(engine, flights, &link, &dash, range, now).await).clone();
        assert_eq!(reason(&resp, "p1"), Some(NotAvailableReason::BuildError));
        let h = header(&link, &range).await;
        assert_eq!((h.incomplete_count, h.fail_streak), (1, 1));
        let retry_at = h.next_retry_at.unwrap();
        assert!(retry_at >= now + 30 * SECOND && retry_at <= now_micros() + 36 * SECOND);
        let early =
            data(&read_at(engine, flights, &link, &dash, range, retry_at - SECOND).await).clone();
        assert!(!early.refreshing && early.next_retry_at == Some(retry_at));
        assert_eq!(engine.builds.load(Ordering::SeqCst), 1);
        engine.classes.lock().unwrap().clear();
        let due =
            data(&read_at(engine, flights, &link, &dash, range, retry_at + SECOND).await).clone();
        assert_eq!(due.stale_reason, Some(StaleReason::Retry));
        assert!(due.refreshing);
        settle(flights).await;
        assert_eq!(engine.builds.load(Ordering::SeqCst), 2);
        let h = header(&link, &range).await;
        assert_eq!(
            (h.incomplete_count, h.fail_streak, h.next_retry_at),
            (0, 0, None)
        );
    }

    #[tokio::test]
    async fn gate11_a_link_edit_during_backoff_builds_at_once_and_only_once() {
        let mut link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &dash, rel(3600), now).await);
        // A whole failure keeps the old body and sets the backoff.
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p1".into(), Class::Transient);
        let stale =
            data(&read_at(engine, flights, &link, &dash, rel(3600), now + 6 * MIN).await).clone();
        assert!(stale.refreshing);
        settle(flights).await;
        let h = header(&link, &rel(3600)).await;
        assert_eq!((h.fail_streak, h.has_body()), (1, true));
        assert_eq!(engine.builds.load(Ordering::SeqCst), 2);
        let backoff_read =
            data(&read_at(engine, flights, &link, &dash, rel(3600), now + 6 * MIN).await).clone();
        assert!(
            !backoff_read.refreshing,
            "the backoff holds the interval rule"
        );
        // "Refresh now" bumps rev: a build starts during the backoff.
        link.rev += 1;
        engine.link.lock().unwrap().rev = link.rev;
        let edited =
            data(&read_at(engine, flights, &link, &dash, rel(3600), now + 6 * MIN).await).clone();
        assert_eq!(edited.stale_reason, Some(StaleReason::Interval));
        assert!(edited.refreshing);
        settle(flights).await;
        assert_eq!(engine.builds.load(Ordering::SeqCst), 3);
        // That attempt failed too; the same edit does not bypass the new backoff again.
        let again =
            data(&read_at(engine, flights, &link, &dash, rel(3600), now + 6 * MIN).await).clone();
        assert!(!again.refreshing);
        assert_eq!(engine.builds.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn gate11_an_all_denied_build_is_complete_and_a_restored_permission_is_picked_up() {
        let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
        let engine = fake(&link, &dash);
        engine.classes.lock().unwrap().extend([
            ("p1".to_string(), Class::Denied),
            ("p2".to_string(), Class::Denied),
        ]);
        let flights = flights(8, 1);
        let now = now_micros();
        let resp = data(&read_at(engine, flights, &link, &dash, range, now).await).clone();
        assert_eq!(reason(&resp, "p1"), Some(NotAvailableReason::Unauthorized));
        let h = header(&link, &range).await;
        assert_eq!((h.incomplete_count, h.fail_streak), (0, 0));
        assert_eq!(h.withheld_panels.len(), 2);
        // Access comes back; the next deadline check clears p1 and makes the file due.
        engine.classes.lock().unwrap().clear();
        let resp =
            data(&read_at(engine, flights, &link, &dash, range, now + 16 * MIN).await).clone();
        assert_eq!(resp.stale_reason, Some(StaleReason::Retry));
        assert!(resp.refreshing);
        settle(flights).await;
        let resp =
            data(&read_at(engine, flights, &link, &dash, range, now + 17 * MIN).await).clone();
        assert_eq!(reason(&resp, "p1"), None);
        assert!(header(&link, &range).await.withheld_panels.is_empty());
    }

    #[tokio::test]
    async fn gate11_a_transient_failure_retains_young_data_with_its_own_build_time() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        let first = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p1".into(), Class::Transient);
        data(&read_at(engine, flights, &link, &dash, rel(3600), now + 6 * MIN).await);
        settle(flights).await;
        let resp =
            data(&read_at(engine, flights, &link, &dash, rel(3600), now + 6 * MIN).await).clone();
        let PanelState::Ok {
            retained,
            error_since,
            ..
        } = resp.panels["p1"].state
        else {
            panic!("p1 is retained");
        };
        assert!(retained && error_since.is_some());
        assert_eq!(resp.panels["p1"].built_at, first.panels["p1"].built_at);
        assert_eq!(build_no(&resp, "p1"), 1);
        assert_eq!(build_no(&resp, "p2"), 2);
        assert!(resp.last_error_at.is_some() && resp.next_retry_at.is_some());
        let h = header(&link, &rel(3600)).await;
        assert_eq!((h.retained_count, h.incomplete_count), (1, 1));
    }

    #[tokio::test]
    async fn gate16_after_a_restart_a_fresh_file_is_served_without_a_build_and_a_due_one_refreshes()
    {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let before = fake(&link, &dash);
        let now = now_micros();
        let built =
            data(&read_at(before, flights(8, 1), &link, &dash, rel(3600), now).await).clone();
        // A new process: fresh flights and engine, nothing in memory, the file on disk.
        let after = fake(&link, &dash);
        let flights = flights(8, 1);
        let served =
            data(&read_at(after, flights, &link, &dash, rel(3600), now + MIN).await).clone();
        assert_eq!(
            after.builds.load(Ordering::SeqCst),
            0,
            "no rebuild after a restart"
        );
        assert_eq!(build_no(&served, "p1"), build_no(&built, "p1"));
        assert!(!served.stale);
        let due =
            data(&read_at(after, flights, &link, &dash, rel(3600), now + 6 * MIN).await).clone();
        assert_eq!(due.stale_reason, Some(StaleReason::Interval));
        assert!(due.refreshing);
        assert_eq!(
            build_no(&due, "p1"),
            build_no(&built, "p1"),
            "served while refreshing"
        );
        settle(flights).await;
        assert_eq!(after.builds.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn gate16_a_missing_or_unreadable_file_is_the_normal_miss_path() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &dash, rel(3600), now).await);
        let key = store::key(&link.org_id, &link.id, "r3600");
        infra::cache::file_data::disk::public_dashboards_replace(
            &key,
            store::next_incarnation(),
            bytes::Bytes::from_static(b"an older format"),
        )
        .await
        .unwrap();
        let resp = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        assert_eq!(build_no(&resp, "p1"), 2);
        store::evict(&key).await;
        let resp = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        assert_eq!(build_no(&resp, "p1"), 3);
    }

    #[test]
    fn gate11_backoff_doubles_from_thirty_seconds_up_to_the_interval_with_jitter() {
        assert_eq!(backoff_until(0, 300, 0, 0.0), 30 * SECOND);
        assert_eq!(backoff_until(1, 300, 0, 0.0), 60 * SECOND);
        assert_eq!(backoff_until(3, 300, 0, 0.0), 240 * SECOND);
        assert_eq!(backoff_until(4, 300, 0, 0.0), 300 * SECOND);
        assert_eq!(backoff_until(40, 300, 0, 0.0), 300 * SECOND);
        assert_eq!(backoff_until(0, 300, 0, 0.2), 36 * SECOND);
        assert_eq!(backoff_until(0, 300, 0, 9.0), 36 * SECOND);
    }

    #[test]
    fn gate11_a_110_day_absolute_window_retries_within_five_minutes_after_failures() {
        let link =
            link(json!([{ "type": "absolute", "start": 0, "end": 110 * DAY_SECS * SECOND }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 110 * DAY_SECS * SECOND,
        };
        let eff = effective_secs(&link, &range);
        assert!(
            eff > 300 * 100,
            "the window alone allows a backoff of hours: {eff}"
        );
        let live = Live {
            dashboard_updated_at: 1,
            link_rev: 2,
            settings_rev: 3,
        };
        let mut h = Header::default();
        // Three failures as reported, then more: from the fifth the uncapped wait passes 300 s.
        for failures in 1..=8_u16 {
            fail(&mut h, live, 0, eff, 0.2, None);
            assert_eq!(h.fail_streak, failures);
            let wait = h.next_retry_at.unwrap();
            assert!(wait <= 360 * SECOND, "{failures} failures: {wait}");
        }
        assert_eq!(h.next_retry_at, Some(360 * SECOND));
    }

    #[tokio::test]
    async fn an_edit_whose_rebuild_failed_wholly_is_rebuilt_on_the_next_read_if_nothing_shows() {
        let changed_both = [("p1", "t1"), ("p2", "t2")];
        let changed_one = [("p1", "t1"), ("p2", "s2")];
        for (edit, rebuilds) in [(&changed_both, true), (&changed_one, false)] {
            let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
            let range = TimeRange::Absolute {
                start: 0,
                end: 3_600_000_000,
            };
            let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
            let engine = fake(&link, &dash);
            let flights = flights(8, 1);
            let now = now_micros();
            data(&read_at(engine, flights, &link, &dash, range, now).await);
            let mut edited = dashboard(edit);
            edited.updated_at = 2_000;
            *engine.dashboard.lock().unwrap() = Some(edited.clone());
            engine.classes.lock().unwrap().extend([
                ("p1".to_string(), Class::Transient),
                ("p2".to_string(), Class::Transient),
            ]);
            let first = read_at(engine, flights, &link, &edited, range, now + SECOND).await;
            assert!(
                data(&first).refreshing,
                "the edit itself bypasses the backoff"
            );
            settle(flights).await;
            let h = header(&link, &range).await;
            assert_eq!((h.fail_streak, h.has_body()), (1, true));
            assert!(h.next_retry_at.unwrap() > now + 2 * SECOND);
            assert_eq!(engine.builds.load(Ordering::SeqCst), 2);
            let next = read_at(engine, flights, &link, &edited, range, now + 2 * SECOND).await;
            let next = data(&next).clone();
            let shown = next
                .panels
                .values()
                .filter(|p| {
                    p.state
                        != PanelState::NotAvailable {
                            reason: NotAvailableReason::Changed,
                        }
                })
                .count();
            assert_eq!(shown, usize::from(!rebuilds), "{edit:?}");
            assert_eq!(next.refreshing, rebuilds, "{edit:?}");
            settle(flights).await;
            let builds = if rebuilds { 3 } else { 2 };
            assert_eq!(engine.builds.load(Ordering::SeqCst), builds, "{edit:?}");
        }
    }

    /// An absolute two-panel link built once, then edited to `edit`, whose rebuilds all fail.
    async fn failing_edit(
        edit: &[(&str, &str)],
    ) -> (
        &'static Fake,
        &'static Flights,
        PublicDashboard,
        Dashboard,
        TimeRange,
        i64,
    ) {
        let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &dash, range, now).await);
        let mut edited = dashboard(edit);
        edited.updated_at = 2_000;
        *engine.dashboard.lock().unwrap() = Some(edited.clone());
        let failing = edit
            .iter()
            .map(|(id, _)| (id.to_string(), Class::Transient));
        engine.classes.lock().unwrap().extend(failing);
        let first = read_at(engine, flights, &link, &edited, range, now + SECOND).await;
        assert!(
            data(&first).refreshing,
            "the edit itself bypasses the backoff"
        );
        settle(flights).await;
        assert_eq!(header(&link, &range).await.fail_streak, 1);
        assert_eq!(engine.builds.load(Ordering::SeqCst), 2);
        (engine, flights, link, edited, range, now)
    }

    #[tokio::test]
    async fn a_masked_screen_retries_once_at_once_then_waits_for_the_backoff() {
        let (engine, flights, link, edited, range, now) =
            failing_edit(&[("p1", "t1"), ("p2", "t2")]).await;
        let retry = read_at(engine, flights, &link, &edited, range, now + 2 * SECOND).await;
        assert!(data(&retry).refreshing);
        settle(flights).await;
        let h = header(&link, &range).await;
        assert_eq!(
            (h.fail_streak, engine.builds.load(Ordering::SeqCst)),
            (2, 3)
        );
        let polled = read_at(engine, flights, &link, &edited, range, now + 3 * SECOND).await;
        assert!(
            !data(&polled).refreshing,
            "a second failure waits for its backoff"
        );
        settle(flights).await;
        assert_eq!(engine.builds.load(Ordering::SeqCst), 3);
        let after = h.next_retry_at.unwrap() + SECOND;
        let due = read_at(engine, flights, &link, &edited, range, after).await;
        assert!(data(&due).refreshing);
        settle(flights).await;
        assert_eq!(engine.builds.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn an_earlier_partial_failure_keeps_the_immediate_retry_after_an_edit() {
        let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let dash = dashboard(&[("p1", "s1"), ("p2", "s2")]);
        let engine = fake(&link, &dash);
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p1".into(), Class::Transient);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &dash, range, now).await);
        assert_eq!(
            header(&link, &range).await.fail_streak,
            1,
            "a partial build"
        );
        let mut edited = dashboard(&[("p1", "t1"), ("p2", "t2")]);
        edited.updated_at = 2_000;
        *engine.dashboard.lock().unwrap() = Some(edited.clone());
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p2".into(), Class::Transient);
        let first = read_at(engine, flights, &link, &edited, range, now + SECOND).await;
        assert!(data(&first).refreshing);
        settle(flights).await;
        let h = header(&link, &range).await;
        assert_eq!(
            (h.fail_streak, h.has_body()),
            (1, true),
            "the edit's own first failure"
        );
        let next = read_at(engine, flights, &link, &edited, range, now + 2 * SECOND).await;
        assert!(data(&next).refreshing);
        settle(flights).await;
        assert_eq!(engine.builds.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn a_masked_screen_of_replaced_panels_retries_on_the_next_read() {
        let (engine, flights, link, edited, range, now) =
            failing_edit(&[("q1", "s1"), ("q2", "s2")]).await;
        let next = read_at(engine, flights, &link, &edited, range, now + 2 * SECOND).await;
        assert!(data(&next).refreshing, "no live panel has a result to show");
        settle(flights).await;
        assert_eq!(engine.builds.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn due_rules_follow_their_order_and_only_edits_bypass_the_backoff() {
        let live = Live {
            dashboard_updated_at: 1,
            link_rev: 2,
            settings_rev: 3,
        };
        let fresh = Header {
            built_at: Some(100 * MIN),
            dashboard_updated_at: 1,
            link_rev: 2,
            settings_rev: 3,
            ..Default::default()
        };
        let at = |min: i64| 100 * MIN + min * MIN;
        assert_eq!(due(&fresh, live, true, 300, false, at(4)).reason, None);
        let interval = due(&fresh, live, true, 300, false, at(6));
        assert_eq!(
            (interval.reason, interval.start),
            (Some(StaleReason::Interval), true)
        );
        assert_eq!(
            due(&fresh, live, false, 300, false, at(600)).reason,
            None,
            "absolute never ages"
        );
        let backoff = Header {
            next_retry_at: Some(at(10)),
            ..fresh.clone()
        };
        assert!(!due(&backoff, live, true, 300, false, at(6)).start);
        let edited = Live {
            link_rev: 9,
            ..live
        };
        let d = due(&backoff, edited, true, 300, false, at(6));
        assert_eq!((d.reason, d.start), (Some(StaleReason::Interval), true));
        let d = due(
            &backoff,
            Live {
                settings_rev: 9,
                ..live
            },
            false,
            300,
            false,
            at(6),
        );
        assert_eq!((d.reason, d.start), (Some(StaleReason::Settings), true));
        let d = due(
            &backoff,
            Live {
                dashboard_updated_at: 9,
                ..live
            },
            false,
            300,
            false,
            at(6),
        );
        assert_eq!((d.reason, d.start), (Some(StaleReason::Dashboard), true));
        let partial = Header {
            incomplete_count: 1,
            next_retry_at: Some(at(1)),
            ..fresh
        };
        assert!(!due(&partial, live, false, 300, false, at(0)).start);
        let d = due(&partial, live, false, 300, false, at(2));
        assert_eq!((d.reason, d.start), (Some(StaleReason::Retry), true));
    }

    #[test]
    fn a_relative_window_ends_on_the_minute() {
        let now = 1_000 * MIN + 17 * SECOND;
        assert_eq!(
            window(&rel(3600), now),
            (1_000 * MIN - 3600 * SECOND, 1_000 * MIN)
        );
        let abs = TimeRange::Absolute { start: 5, end: 9 };
        assert_eq!(window(&abs, now), (5, 9));
    }

    #[test]
    fn the_refresh_hint_is_at_least_three_seconds_with_up_to_a_fifth_more() {
        assert_eq!(retry_hint(None, 0, 0, 0.0), 3);
        assert_eq!(retry_hint(None, 0, 0, 0.2), 4);
        assert_eq!(retry_hint(None, 0, 0, 5.0), 4);
    }

    #[test]
    fn gate15_panels_beyond_the_cap_are_withheld_as_too_many() {
        let run = Run {
            panels: vec![PanelRun::not_available(
                "p11",
                Class::Structural,
                NotAvailableReason::TooManyPanels,
                ManifestPanel {
                    intent: "i".into(),
                    ..Default::default()
                },
                None,
            )],
            ..Default::default()
        };
        let live = Live {
            dashboard_updated_at: 1,
            link_rev: 1,
            settings_rev: 0,
        };
        let a = assemble(live, (0, 1), run, None, &BTreeSet::new(), 5, 0, 300, 0.0);
        assert_eq!(a.kind, BuildKind::Complete);
        assert_eq!(a.header.unavailable_count, 1);
        let body = a.body.unwrap();
        assert_eq!(
            body.panels["p11"].state,
            PanelState::NotAvailable {
                reason: NotAvailableReason::TooManyPanels
            }
        );
    }

    #[tokio::test]
    async fn gate02_a_variable_from_a_lost_values_stream_is_nulled_at_the_deadline() {
        let link = link(json!([{ "type": "absolute", "start": 0, "end": 3_600_000_000_i64 }]));
        let range = TimeRange::Absolute {
            start: 0,
            end: 3_600_000_000,
        };
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        let resp = data(&read_at(engine, flights, &link, &dash, range, now).await).clone();
        assert_eq!(resp.variables[0].value, json!("checkout"));
        engine.denied.lock().unwrap().insert("vals".into());
        let resp =
            data(&read_at(engine, flights, &link, &dash, range, now + 16 * MIN).await).clone();
        assert_eq!(resp.variables[0].value, serde_json::Value::Null);
        assert_eq!(header(&link, &range).await.withheld_variables, ["svc"]);
        let json = serde_json::to_string(&resp).unwrap();
        assert!(
            !json.contains("checkout") && !json.contains("variable_keys"),
            "{json}"
        );
        // Access comes back: the value returns and the file is due for a rebuild.
        engine.denied.lock().unwrap().clear();
        let resp =
            data(&read_at(engine, flights, &link, &dash, range, now + 32 * MIN).await).clone();
        assert_eq!(resp.variables[0].value, json!("checkout"));
        assert_eq!(resp.stale_reason, Some(StaleReason::Retry));
        settle(flights).await;
    }

    #[tokio::test]
    async fn gate06_a_failed_denial_rewrite_serves_the_masked_result_once_and_evicts_the_file() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "secret"), ("p2", "public")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        data(&read_at(engine, flights, &link, &dash, rel(3600), now).await);
        let key = store::key(&link.org_id, &link.id, "r3600");
        engine.denied.lock().unwrap().insert("secret".into());
        store::FAIL_WRITES.insert(key.clone());
        let served = read_at(engine, flights, &link, &dash, rel(3600), now + 16 * MIN).await;
        store::FAIL_WRITES.remove(&key);
        let Served::Data {
            response, outcome, ..
        } = &served
        else {
            panic!("expected data, got {served:?}");
        };
        assert_eq!(*outcome, "denied_masked");
        assert_eq!(
            reason(response, "p1"),
            Some(NotAvailableReason::Unauthorized)
        );
        assert!(response.panels["p1"].data.is_empty());
        assert!(
            store::read_header(&key).await.is_none(),
            "the old file is gone"
        );
        // The next read is a miss and builds; p1 stays withheld by the new build's own check.
        engine
            .classes
            .lock()
            .unwrap()
            .insert("p1".into(), Class::Denied);
        let resp =
            data(&read_at(engine, flights, &link, &dash, rel(3600), now + 16 * MIN).await).clone();
        assert_eq!(reason(&resp, "p1"), Some(NotAvailableReason::Unauthorized));
        assert_eq!(build_no(&resp, "p2"), 2);
    }

    #[tokio::test]
    async fn gate06_a_removed_and_re_added_range_serves_only_the_newest_body() {
        let both = json!([
            { "type": "relative", "secs": 3600 },
            { "type": "relative", "secs": 86400 }
        ]);
        let mut link = link(both.clone());
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        let first = data(&read_at(engine, flights, &link, &dash, rel(DAY_SECS), now).await).clone();
        assert_eq!(build_no(&first, "p1"), 1);
        let key = store::key(&link.org_id, &link.id, "r86400");
        // The range leaves the link; a read asks for it and the handler evicts before its 404.
        link.time_ranges = Some(json!([{ "type": "relative", "secs": 3600 }]).to_string());
        link.rev += 1;
        assert!(
            !super::super::time_ranges(&link)
                .ranges
                .contains(&rel(DAY_SECS))
        );
        evict_removed_range(&link, "r86400").await;
        assert!(
            store::read_header(&key).await.is_none(),
            "the removed range's file is gone"
        );
        // The range comes back: the next read is a cold build with none of the old data.
        link.time_ranges = Some(both.to_string());
        link.rev += 1;
        *engine.link.lock().unwrap() = link.clone();
        let served = read_at(engine, flights, &link, &dash, rel(DAY_SECS), now + MIN).await;
        let Served::Data {
            response, outcome, ..
        } = &served
        else {
            panic!("expected data, got {served:?}");
        };
        assert_eq!(*outcome, "cold_miss");
        assert!(!response.stale && !response.refreshing);
        assert_eq!(build_no(response, "p1"), 2);
        assert_eq!(response.link_rev, link.rev);
        assert_ne!(response.rev, first.rev);
    }

    #[tokio::test]
    async fn gate06_a_matching_etag_is_answered_from_the_header_with_the_poll_hint() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        let flights = flights(8, 1);
        let now = now_micros();
        let first = data(&read_at(engine, flights, &link, &dash, rel(3600), now).await).clone();
        let key = store::key(&link.org_id, &link.id, "r3600");
        let tag = format!("\"{}\"", first.rev);
        let served = read(
            engine,
            flights,
            ReadRequest {
                link: &link,
                settings_rev: 0,
                dashboard: &dash,
                range: rel(3600),
                now,
                if_none_match: Some(&tag),
            },
        )
        .await;
        assert!(
            matches!(&served, Served::NotModified { rev, retry_hint: None } if *rev == first.rev)
        );
        // Due: the refresh changes rev, and a poll that already holds it gets a 304 with the hint.
        engine.delay_ms.store(500, Ordering::SeqCst);
        let request = |tag| ReadRequest {
            link: &link,
            settings_rev: 0,
            dashboard: &dash,
            range: rel(3600),
            now: now + 6 * MIN,
            if_none_match: tag,
        };
        let refreshing = data(&read(engine, flights, request(Some(&tag))).await).clone();
        assert!(refreshing.refreshing);
        let tag = format!("\"{}\"", refreshing.rev);
        let served = read(engine, flights, request(Some(&tag))).await;
        assert!(
            matches!(&served, Served::NotModified { retry_hint: Some(s), .. } if *s >= MIN_RETRY_SECS),
            "{served:?}"
        );
        settle(flights).await;
        assert!(store::read_header(&key).await.is_some());
    }

    #[test]
    fn if_none_match_accepts_weak_strong_and_listed_tags() {
        assert!(etag_matches("\"abc\"", "abc"));
        assert!(etag_matches("W/\"abc\"", "abc"));
        assert!(etag_matches("\"x\", \"abc\"", "abc"));
        assert!(!etag_matches("\"abd\"", "abc"));
    }

    #[tokio::test]
    async fn gate11_a_panel_with_an_unparseable_query_is_never_restored_by_the_deadline() {
        let link = link(json!([{ "type": "relative", "secs": 3600 }]));
        let dash = dashboard(&[("p1", "s1")]);
        let engine = fake(&link, &dash);
        for (unparsed, restored) in [(true, false), (false, true)] {
            let mut manifest = Manifest::default();
            // The other query of the panel proved a stream; one query still did not parse.
            manifest.panels.insert(
                "p1".into(),
                ManifestPanel {
                    sources: vec![(StreamType::Logs, "s1".into())],
                    outcome: PanelOutcome::Withheld,
                    unparsed,
                    ..Default::default()
                },
            );
            let stored = Stored {
                header: Header {
                    built_at: Some(1),
                    withheld_panels: vec![WithheldPanel {
                        panel_id: "p1".into(),
                        reason: NotAvailableReason::Unauthorized,
                    }],
                    ..Default::default()
                },
                manifest,
                body_zst: bytes::Bytes::new(),
            };
            let header = authz_check::recheck(engine, &link, &stored, 100)
                .await
                .unwrap();
            assert_eq!(
                header.withheld_panels.is_empty(),
                restored,
                "unparsed {unparsed}"
            );
            assert_eq!(
                header.next_retry_at == Some(100),
                restored,
                "unparsed {unparsed}"
            );
        }
    }

    #[test]
    fn only_the_two_stored_range_key_forms_are_evicted() {
        for key in ["r3600", "a10-20", "a0-1"] {
            assert!(is_range_key(key), "{key}");
        }
        for key in [
            "", "r", "r-1", "r36x", "a10", "a-20", "a10-", "x3600", "../r60", "r60/..",
        ] {
            assert!(!is_range_key(key), "{key}");
        }
    }
}
