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

//! Public dashboard links: CRUD with compare-and-set revisions and soft delete, validation, and
//! the panel build that runs each saved query server-side, checked against the publisher's access.

pub mod access;
mod authz_check;
mod defaults;
pub mod flight;
pub mod intent;
mod mask;
pub mod materialize;
pub mod store;
mod variables;

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::atomic::{AtomicUsize, Ordering},
};

use async_trait::async_trait;
use config::{
    get_config, ider,
    meta::{
        dashboards::{
            Dashboard,
            usage_report::DashboardInfo,
            v8::{Panel, Tab},
        },
        public_dashboards::{
            MAX_REFRESH_SECS, MIN_REFRESH_SECS, NotAvailableReason, PanelResult, PanelState,
            PublicDashboardConfig, PublicLinkState, PublicLinkStatus, PublicVariable, TimeRange,
            TimeRangePolicy, Window, public_dashboard_identity,
        },
        search,
        sql::{TableReferenceExt, resolve_stream_names, resolve_stream_names_with_type},
        stream::StreamType,
    },
    utils::{
        query_select_utils::replace_o2_custom_patterns, rand::generate_random_string,
        time::now_micros,
    },
};
use defaults::{Defaults, ValuesQuery};
use flight::{Flight, TraceFamily};
use futures::StreamExt;
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{
        dashboards,
        entity::{
            public_dashboard_org_settings::Model as OrgSettings,
            public_dashboards::Model as PublicDashboard,
        },
        public_dashboards::{self as pd_table, CreateOutcome},
    },
};
use materialize::{Capture, Class, Engine, PanelRun, Run};
use store::{ExecutedQuery, ManifestPanel, ValuesDependency};
use variables::{PanelVars, QueryVars};

const MAX_RANGES: usize = 10;
const MIN_RANGE_SECS: i64 = 60;
const MAX_RANGE_SECS: i64 = 365 * 86_400;
const MAX_FROZEN_VARIABLES_BYTES: usize = 64 * 1024;
/// A lost compare-and-set re-reads and re-applies the edit at most this many times.
const EDIT_ATTEMPTS: usize = 5;
/// Refusal for a dashboard the build can't render; the admin API maps it to 400.
pub const OLDER_FORMAT_ERROR: &str =
    "This dashboard uses an older format. Open it and save it once, then publish.";
pub const LINK_NOT_FOUND: &str = "public link not found";

/// Search-response fields the renderer reads; SQL, VRL errors and trace ids stay private.
const PUBLIC_META_FIELDS: [&str; 6] = [
    "histogram_interval",
    "total",
    "is_partial",
    "order_by",
    "new_start_time",
    "new_end_time",
];

/// The engine the public routes use.
pub static ENGINE: SearchEngine = SearchEngine;

/// The search engine, the primary database and the authorizer the materializer runs on.
pub struct SearchEngine;

#[async_trait]
impl Engine for SearchEngine {
    async fn capture(&self, link_id: &str) -> Result<Option<Capture>, anyhow::Error> {
        let db = get_orm_client_rw().await;
        let Some(link) = pd_table::get(db, link_id).await? else {
            return Ok(None);
        };
        let settings = pd_table::get_settings(db, &link.org_id).await?;
        let dashboard = dashboards::get_by_id_primary(&link.org_id, &link.dashboard_id)
            .await?
            .map(|(_, dash)| dash);
        Ok(Some(Capture {
            settings_rev: settings.as_ref().map_or(0, |s| s.rev),
            org_enabled: settings.as_ref().is_none_or(|s| s.enabled),
            link,
            dashboard,
        }))
    }

    async fn run_panels(
        &self,
        cap: &Capture,
        range: &TimeRange,
        range_key: &str,
        now: i64,
        family: &TraceFamily,
        flight: &Flight,
    ) -> Run {
        run_panels(cap, range, range_key, now, family, flight).await
    }

    async fn is_member(&self, org: &str, user: &str) -> Result<bool, anyhow::Error> {
        publisher_is_member(org, user).await
    }

    async fn pause_departed(&self, link: &PublicDashboard) {
        if let Err(e) = pause_for_departed_publisher(link.clone()).await {
            log::error!(
                "pausing public link {} of a departed publisher: {e}",
                link.id
            );
        }
    }

    async fn authorize(
        &self,
        org: &str,
        user: &str,
        panel: &ManifestPanel,
    ) -> Result<bool, anyhow::Error> {
        authorize_manifest(org, user, panel).await
    }

    #[cfg_attr(not(feature = "cloud"), allow(unused_variables))]
    async fn trial_ok(&self, org: &str) -> bool {
        #[cfg(feature = "cloud")]
        return matches!(
            crate::organization::is_org_in_free_trial_period(org).await,
            Ok(true)
        );
        #[cfg(not(feature = "cloud"))]
        true
    }
}

/// A request the admin API refuses with 400 and this message.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct Invalid(pub String);

/// Identifiers returned after publishing.
pub struct PublishResult {
    pub id: String,
    pub slug: String,
}

/// A link as the admin API returns it; the slug is a bearer secret for authenticated routes only.
#[derive(Clone, Debug, serde::Serialize)]
pub struct PublicLinkView {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub dashboard_id: String,
    pub dashboard_title: Option<String>,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub status: PublicLinkStatus,
    pub enabled: bool,
    pub time_range: TimeRangePolicy,
    pub frozen_variables: BTreeMap<String, serde_json::Value>,
    pub refresh_secs: i32,
    pub expires_at: Option<i64>,
    pub published_by: String,
    pub updated_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_accessed_at: Option<i64>,
    pub access_count: i64,
}

/// One build's fixed inputs for its searches.
struct Ctx<'a> {
    link: &'a PublicDashboard,
    dash: &'a Dashboard,
    identity: String,
    range_key: &'a str,
    start: i64,
    end: i64,
    now: i64,
    family: &'a TraceFamily,
}

impl Ctx<'_> {
    /// Names the link, range and panel on the usage row and in the query list.
    fn event_context(&self, panel_id: Option<&str>) -> search::SearchEventContext {
        search::SearchEventContext {
            dashboard_id: Some(self.link.dashboard_id.clone()),
            dashboard_name: self.dash.v8.as_ref().map(|v8| v8.title.clone()),
            dashboard_folder_id: Some(self.link.folder_id.clone()),
            public_dashboard_link_id: Some(self.link.id.clone()),
            range_key: Some(self.range_key.to_string()),
            panel_id: panel_id.map(str::to_string),
            ..Default::default()
        }
    }

    fn dashboard_info(&self, tab: &Tab, panel: &Panel) -> DashboardInfo {
        DashboardInfo {
            run_id: self.family.id().to_string(),
            panel_id: panel.id.clone(),
            panel_name: panel.title.clone(),
            tab_id: tab.tab_id.clone(),
            tab_name: tab.name.clone(),
        }
    }

    fn timeout(&self) -> i64 {
        i64::from(get_config().public_dashboards.query_timeout_secs)
    }

    fn panel_failed(&self, panel: &Panel, manifest: ManifestPanel, error: String) -> PanelRun {
        log::warn!(
            "public dashboard {} panel {} failed: {error}",
            self.link.id,
            panel.id
        );
        PanelRun::not_available(
            &panel.id,
            Class::Transient,
            NotAvailableReason::BuildError,
            manifest,
            Some(error),
        )
    }
}

/// What every panel of one build shares.
struct PanelScope<'a> {
    ctx: &'a Ctx<'a>,
    vars: &'a QueryVars,
    frozen: &'a BTreeMap<String, serde_json::Value>,
    values: &'a Values,
    flight: &'a Flight,
    done: &'a AtomicUsize,
    total: usize,
    max: usize,
}

impl PanelScope<'_> {
    /// Panels past `MAX_PANELS`, counted across tabs in order, are withheld as too many.
    async fn run(&self, i: usize, tab: &Tab, panel: &Panel) -> PanelRun {
        let run = if i < self.max {
            run_panel(self.ctx, self.vars, self.frozen, self.values, tab, panel).await
        } else {
            let manifest =
                panel_manifest(self.ctx, self.vars, self.frozen, self.values, tab, panel);
            PanelRun::not_available(
                &panel.id,
                Class::Structural,
                NotAvailableReason::TooManyPanels,
                manifest,
                None,
            )
        };
        let done = self.done.fetch_add(1, Ordering::Relaxed) + 1;
        self.flight.set_progress(done, self.total);
        run
    }
}

/// The link's values, missing ones filled as the live picker would, and denied or failed keys.
#[derive(Default)]
struct Values {
    values: BTreeMap<String, serde_json::Value>,
    denied: BTreeSet<String>,
    failed: BTreeSet<String>,
    deps: BTreeMap<String, ValuesDependency>,
}

/// One time shift: the gap in milliseconds and its label, as the live renderer names them.
#[derive(Clone, Debug, PartialEq)]
struct Shift {
    gap_ms: i64,
    label: String,
}

/// Panel results the run collected so far.
#[derive(Default)]
struct Collected {
    data: Vec<serde_json::Value>,
    meta: Vec<serde_json::Value>,
    queries: Vec<serde_json::Value>,
    partial: bool,
    truncated: bool,
    window: Option<Window>,
}

impl Collected {
    fn into_run(self, panel: &Panel, manifest: ManifestPanel, now: i64) -> PanelRun {
        let class = if self.partial {
            Class::Partial
        } else if self.truncated {
            Class::Truncated
        } else {
            Class::Fresh
        };
        PanelRun {
            id: panel.id.clone(),
            class,
            result: PanelResult {
                state: PanelState::Ok {
                    retained: false,
                    error_since: None,
                    partial: self.partial,
                    truncated: self.truncated,
                },
                intent: manifest.intent.clone(),
                built_at: Some(now),
                window: self.window,
                data: self.data,
                result_meta_data: self.meta,
                metadata: serde_json::json!({ "queries": self.queries }),
            },
            manifest,
            error: None,
        }
    }
}

/// Publish a link; it runs no query until someone opens it.
pub async fn create(
    org: &str,
    dashboard_id: &str,
    cfg: PublicDashboardConfig,
    publisher: &str,
) -> Result<PublishResult, anyhow::Error> {
    let Some((folder, dash)) = dashboards::get_by_id(org, dashboard_id).await? else {
        return Err(anyhow::anyhow!("dashboard not found"));
    };
    check_format(&dash)?;
    let now = now_micros();
    validate_dashboard(&dash, &cfg.frozen_variables, now).map_err(Invalid)?;

    let db = get_orm_client_rw().await;
    let org_max = org_link_limit(pd_table::get_settings(db, org).await?.as_ref());
    let dashboard_max = get_config().public_dashboards.max_links_per_dashboard;
    let id = ider::uuid();
    let slug = gen_unique_slug().await?;
    let model = PublicDashboard {
        id: id.clone(),
        org_id: org.to_string(),
        folder_id: folder.folder_id.clone(),
        dashboard_id: dashboard_id.to_string(),
        slug: slug.clone(),
        name: cfg.name.trim().to_string(),
        visibility: cfg.visibility.to_i32(),
        time_ranges: Some(serde_json::to_string(&cfg.time_range.ranges)?),
        default_range_key: Some(cfg.time_range.default.key()),
        frozen_variables: Some(serde_json::to_string(&cfg.frozen_variables)?),
        refresh_secs: cfg.refresh_secs,
        dashboard_version: dash.version,
        published_by: publisher.to_string(),
        enabled: true,
        expires_at: cfg.expires_at,
        created_by: publisher.to_string(),
        updated_by: None,
        created_at: now,
        updated_at: now,
        rev: now,
        deleted_at: None,
        last_accessed_at: None,
        access_count: 0,
    };
    match pd_table::insert_capped(db, &model, org_max, dashboard_max).await? {
        CreateOutcome::Created => Ok(PublishResult { id, slug }),
        CreateOutcome::OrgFull => Err(Invalid(format!(
            "This organization has reached its limit of {org_max} public links. Revoke one to add another."
        ))
        .into()),
        CreateOutcome::DashboardFull => Err(Invalid(format!(
            "This dashboard has reached its limit of {dashboard_max} public links. Revoke one to add another."
        ))
        .into()),
    }
}

pub async fn list(org: &str) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::list(get_orm_client_ro().await, org).await?)
}

pub async fn list_for_dashboard(
    org: &str,
    dashboard_id: &str,
) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::list_by_dashboard(get_orm_client_ro().await, org, dashboard_id).await?)
}

/// Attach each link's dashboard title, current folder and lifecycle status, with one dashboard
/// lookup.
pub async fn views(
    org: &str,
    links: Vec<PublicDashboard>,
) -> Result<Vec<PublicLinkView>, anyhow::Error> {
    let ids: Vec<String> = links
        .iter()
        .map(|l| l.dashboard_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let labels = dashboards::labels_by_ids(org, &ids).await?;
    let now = now_micros();
    Ok(links
        .into_iter()
        .map(|link| {
            let label = labels.get(&link.dashboard_id);
            let status = PublicLinkStatus::derive(
                &PublicLinkState {
                    dashboard_exists: label.is_some(),
                    enabled: link.enabled,
                    expires_at: link.expires_at,
                    access_count: link.access_count,
                },
                now,
            );
            PublicLinkView {
                dashboard_title: label.map(|l| l.title.clone()),
                folder_id: label.map(|l| l.folder_id.clone()),
                folder_name: label.map(|l| l.folder_name.clone()),
                status,
                enabled: link.enabled,
                time_range: time_ranges(&link),
                frozen_variables: parse_frozen_vars(link.frozen_variables.as_deref()),
                refresh_secs: link.refresh_secs,
                expires_at: link.expires_at,
                published_by: link.published_by,
                updated_by: link.updated_by,
                created_at: link.created_at,
                updated_at: link.updated_at,
                last_accessed_at: link.last_accessed_at,
                access_count: link.access_count,
                id: link.id,
                name: link.name,
                slug: link.slug,
                dashboard_id: link.dashboard_id,
            }
        })
        .collect())
}

/// A live link only when it belongs to both this org and this dashboard, so an id from another
/// dashboard can't be reached by editing the URL. Read from the primary, as every edit starts here.
pub async fn get_link(
    org: &str,
    dashboard_id: &str,
    id: &str,
) -> Result<Option<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::get_on_dashboard(get_orm_client_rw().await, org, dashboard_id, id).await?)
}

/// Replace a link's settings in place; its slug never changes.
pub async fn update_link(
    link: PublicDashboard,
    cfg: PublicDashboardConfig,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    let dash = current_dashboard(&link.org_id, &link.dashboard_id).await?;
    let now = now_micros();
    validate_dashboard(&dash, &cfg.frozen_variables, now).map_err(Invalid)?;
    // The Enterprise editor stream check for changed frozen variables (design 6.3) belongs here.
    let ranges = serde_json::to_string(&cfg.time_range.ranges)?;
    let frozen = serde_json::to_string(&cfg.frozen_variables)?;
    edit(&link.org_id, &link.id, |l| {
        l.updated_by = Some(user_id.to_string());
        l.name = cfg.name.trim().to_string();
        l.visibility = cfg.visibility.to_i32();
        l.time_ranges = Some(ranges.clone());
        l.default_range_key = Some(cfg.time_range.default.key());
        l.frozen_variables = Some(frozen.clone());
        l.refresh_secs = cfg.refresh_secs;
        l.expires_at = cfg.expires_at;
        l.updated_at = now;
        Ok(())
    })
    .await
}

/// Stop serving; the slug and settings are kept.
pub async fn pause_link(
    link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    set_paused(&link, Some(user_id.to_string())).await
}

/// Whether the publisher left the link's org, from the primary; a failed lookup is not leaving.
pub async fn publisher_left(link: &PublicDashboard) -> bool {
    matches!(
        publisher_is_member(&link.org_id, &link.published_by).await,
        Ok(false)
    )
}

/// Org membership from the primary, so a departure is never read from a lagging replica.
pub async fn publisher_is_member(org: &str, user: &str) -> Result<bool, anyhow::Error> {
    if db::user::is_root_user(user) {
        return Ok(true);
    }
    Ok(infra::table::org_users::get_optional_primary(org, user)
        .await?
        .is_some())
}

/// Pause a link whose publisher left the org; the queries ran with that person's access.
pub async fn pause_for_departed_publisher(link: PublicDashboard) -> Result<(), anyhow::Error> {
    let updated_by = link.updated_by.clone();
    set_paused(&link, updated_by).await.map(|_| ())
}

/// Serve again at the same address; the next view builds.
pub async fn resume_link(
    link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    let now = now_micros();
    if is_expired(link.expires_at, now) {
        return Err(Invalid(
            "this link has expired; extend its expiry date to bring it back".to_string(),
        )
        .into());
    }
    current_dashboard(&link.org_id, &link.dashboard_id).await?;
    edit(&link.org_id, &link.id, |l| {
        l.enabled = true;
        l.updated_by = Some(user_id.to_string());
        l.updated_at = now;
        Ok(())
    })
    .await
}

/// Make every result of the link due on its next view; runs no query.
pub async fn refresh_now(link: PublicDashboard) -> Result<PublicDashboard, anyhow::Error> {
    if !link.enabled {
        return Err(Invalid("resume this link before refreshing it".to_string()).into());
    }
    if is_expired(link.expires_at, now_micros()) {
        return Err(Invalid(
            "this link has expired; extend its expiry date to bring it back".to_string(),
        )
        .into());
    }
    edit(&link.org_id, &link.id, |_| Ok(())).await
}

/// Revoke: soft-delete the link, so its slug stays reserved and replicas cannot revive it.
pub async fn delete(org: &str, id: &str) -> Result<bool, anyhow::Error> {
    let now = now_micros();
    match edit(org, id, |l| {
        l.deleted_at = Some(now);
        Ok(())
    })
    .await
    {
        Ok(_) => Ok(true),
        Err(e) if e.to_string() == LINK_NOT_FOUND => Ok(false),
        Err(e) => Err(e),
    }
}

/// Revoke every link on a dashboard; called when the dashboard is deleted.
pub async fn revoke_all_for_dashboard(org: &str, dashboard_id: &str) -> Result<(), anyhow::Error> {
    for link in pd_table::list_by_dashboard(get_orm_client_rw().await, org, dashboard_id).await? {
        delete(org, &link.id).await?;
    }
    Ok(())
}

/// Revoke every link in an org; called by org cleanup.
pub async fn revoke_all_for_org(org: &str) -> Result<(), anyhow::Error> {
    for link in pd_table::list(get_orm_client_rw().await, org).await? {
        delete(org, &link.id).await?;
    }
    Ok(())
}

/// Hard-delete links whose 30-day soft-delete memory has run out.
pub async fn purge_deleted() -> Result<u64, anyhow::Error> {
    let before = now_micros() - pd_table::DELETED_RETENTION_MICROS;
    Ok(pd_table::purge_deleted(get_orm_client_rw().await, before).await?)
}

/// Reject a create request the server would otherwise have to rewrite or store unbounded.
pub fn validate_config(cfg: &PublicDashboardConfig) -> Result<(), String> {
    let now = now_micros();
    check_expiry(cfg.expires_at, now)?;
    validate_limits(cfg, now)
}

/// An edit that keeps an expired link's date is allowed, so only a changed expiry must be in the
/// future.
pub fn validate_edit(cfg: &PublicDashboardConfig, link: &PublicDashboard) -> Result<(), String> {
    let now = now_micros();
    if cfg.expires_at != link.expires_at {
        check_expiry(cfg.expires_at, now)?;
    }
    validate_limits(cfg, now)
}

/// The dashboard as a link would show it: at most `MAX_PANELS` panels across every tab, and no
/// SQL panel with an explicit LIMIT above the default row cap.
pub fn validate_dashboard(
    dash: &Dashboard,
    frozen: &BTreeMap<String, serde_json::Value>,
    now: i64,
) -> Result<(), String> {
    let cfg = get_config();
    let Some(v8) = dash.v8.as_ref() else {
        return Ok(());
    };
    let panels: Vec<_> = v8
        .tabs
        .iter()
        .flat_map(|tab| tab.panels.iter().map(move |panel| (tab, panel)))
        .collect();
    let max = cfg.public_dashboards.max_panels as usize;
    if panels.len() > max {
        return Err(format!(
            "This dashboard has {} panels; a public link can show at most {max}.",
            panels.len()
        ));
    }
    let cap = cfg.limit.query_default_limit;
    let vars = QueryVars::new(dash, frozen.clone(), None);
    let (start, end) = (now - 3_600_000_000, now);
    for (tab, panel) in panels {
        if panel.query_type == "promql" || panel.typ == "custom_chart" {
            continue;
        }
        let panel_vars = vars.for_panel(&tab.tab_id, &panel.id);
        let over = panel
            .queries
            .iter()
            .filter_map(|q| q.query.as_deref())
            .filter_map(|sql| explicit_limit(&panel_vars.substitute(sql, "sql", start, end)))
            .find(|n| *n > cap);
        if let Some(n) = over {
            return Err(format!(
                "Panel \"{}\" has LIMIT {n}, above the public cap of {cap} rows. Lower it or aggregate.",
                panel.title
            ));
        }
    }
    Ok(())
}

/// A link's ranges and default; a default no range matches falls back to the first range.
pub fn time_ranges(link: &PublicDashboard) -> TimeRangePolicy {
    let ranges: Vec<TimeRange> = link
        .time_ranges
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let default = ranges
        .iter()
        .find(|r| link.default_range_key.as_deref() == Some(r.key().as_str()))
        .or(ranges.first())
        .copied()
        .unwrap_or(TimeRange::Relative { secs: 3600 });
    TimeRangePolicy { ranges, default }
}

/// Runs every panel of the captured dashboard for one window (design 5.4 steps 3 to 6).
pub(crate) async fn run_panels(
    cap: &Capture,
    range: &TimeRange,
    range_key: &str,
    now: i64,
    family: &TraceFamily,
    flight: &Flight,
) -> Run {
    let Some(dash) = cap.dashboard.as_ref() else {
        return Run::default();
    };
    let link = &cap.link;
    let (start, end) = materialize::window(range, now);
    let ctx = Ctx {
        link,
        dash,
        identity: public_dashboard_identity(&link.org_id),
        range_key,
        start,
        end,
        now,
        family,
    };
    let scrape = db::organization::get_org_setting(&link.org_id)
        .await
        .ok()
        .map(|s| f64::from(s.scrape_interval));
    let frozen = parse_frozen_vars(link.frozen_variables.as_deref());
    let values = fill_defaults(&ctx, frozen.clone()).await;
    let variables = PublicVariable::list(dash, &values.values);
    let vars = QueryVars::new(dash, values.values.clone(), scrape);
    let Some(v8) = dash.v8.as_ref() else {
        return Run {
            variables,
            panels: vec![],
        };
    };
    // Collected up front: an iterator adapter held across the awaits below isn't Send.
    let panels: Vec<(&Tab, &Panel)> = v8
        .tabs
        .iter()
        .flat_map(|tab| tab.panels.iter().map(move |panel| (tab, panel)))
        .collect();
    let cfg = &get_config().public_dashboards;
    let max = cfg.max_panels as usize;
    publish_estimate(&ctx, &vars, &panels[..panels.len().min(max)], flight).await;
    let total = panels.len();
    let done = AtomicUsize::new(0);
    let scope = PanelScope {
        ctx: &ctx,
        vars: &vars,
        frozen: &frozen,
        values: &values,
        flight,
        done: &done,
        total,
        max,
    };
    let pending: Vec<_> = panels
        .into_iter()
        .enumerate()
        .map(|(i, (tab, panel))| scope.run(i, tab, panel))
        .collect();
    let runs = futures::stream::iter(pending)
        .buffered(cfg.panel_concurrency.max(1) as usize)
        .collect()
        .await;
    Run {
        variables,
        panels: runs,
    }
}

/// Checks every stream the final query reads and returns them; OSS has no stream permissions.
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn authorize_query(
    org: &str,
    user_id: &str,
    query_type: &str,
    text: &str,
    target: (StreamType, &str),
) -> Result<Vec<(StreamType, String)>, NotAvailableReason> {
    #[cfg(feature = "enterprise")]
    {
        use crate::authz::{
            StreamPermissionResourceType, check_cipher_key_permissions, check_stream_permissions,
        };
        // An unreadable query can't be proven safe, so it is withheld rather than run.
        let streams = query_streams(query_type, text, target.0)
            .map_err(|_| NotAvailableReason::Unauthorized)?;
        for (stream, stream_type) in &streams {
            let denied = check_stream_permissions(
                stream,
                org,
                user_id,
                stream_type,
                StreamPermissionResourceType::Search,
            )
            .await
            .is_some();
            if denied {
                return Err(NotAvailableReason::Unauthorized);
            }
        }
        if query_type != "promql"
            && check_cipher_key_permissions(org, user_id, text)
                .await
                .is_some()
        {
            return Err(NotAvailableReason::Unauthorized);
        }
        Ok(streams.into_iter().map(|(s, t)| (t, s)).collect())
    }
    #[cfg(not(feature = "enterprise"))]
    Ok(typed_sources(query_type, text, target))
}

/// Re-authorizes the data one panel was built from, from its manifest, as `user`.
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn authorize_manifest(
    org: &str,
    user_id: &str,
    panel: &ManifestPanel,
) -> Result<bool, anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        use crate::authz::{
            StreamPermissionResourceType, check_stream_permissions, denied_cipher_keys,
        };
        let streams = panel.sources.iter().chain(
            panel
                .values_dependencies
                .iter()
                .flat_map(|d| d.sources.iter()),
        );
        for (stream_type, stream) in streams {
            let denied = check_stream_permissions(
                stream,
                org,
                user_id,
                stream_type,
                StreamPermissionResourceType::Search,
            )
            .await
            .is_some();
            if denied {
                return Ok(false);
            }
        }
        let sqls: Vec<&str> = panel
            .queries
            .iter()
            .filter(|q| q.query_type == "sql")
            .map(|q| q.text.as_str())
            .collect();
        if !matches!(denied_cipher_keys(org, user_id, &sqls).await, Ok(d) if d.is_empty()) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Applies `change` to the live row and writes it with a compare-and-set on rev; a lost race
/// re-reads the row and applies the change again.
async fn edit<F>(org: &str, id: &str, mut change: F) -> Result<PublicDashboard, anyhow::Error>
where
    F: FnMut(&mut PublicDashboard) -> Result<(), anyhow::Error>,
{
    let db = get_orm_client_rw().await;
    for _ in 0..EDIT_ATTEMPTS {
        let Some(mut row) = pd_table::get(db, id)
            .await?
            .filter(|l| l.org_id == org && l.deleted_at.is_none())
        else {
            return Err(anyhow::anyhow!(LINK_NOT_FOUND));
        };
        let seen = row.rev;
        change(&mut row)?;
        row.rev = pd_table::next_rev(seen, now_micros());
        if pd_table::update_cas(db, &row, seen).await? {
            return Ok(row);
        }
    }
    Err(anyhow::anyhow!(
        "the public link kept changing while saving; try again"
    ))
}

async fn set_paused(
    link: &PublicDashboard,
    updated_by: Option<String>,
) -> Result<PublicDashboard, anyhow::Error> {
    let now = now_micros();
    edit(&link.org_id, &link.id, |l| {
        l.enabled = false;
        l.updated_by = updated_by.clone();
        l.updated_at = now;
        Ok(())
    })
    .await
}

/// The org's link limit: its settings row's, never above the env limit.
fn org_link_limit(settings: Option<&OrgSettings>) -> u32 {
    let env = get_config().public_dashboards.max_links_per_org;
    settings
        .and_then(|s| s.max_links)
        .map_or(env, |max| u32::try_from(max).unwrap_or(0).min(env))
}

/// The outermost explicit LIMIT of a SQL query; None without one or when it does not parse.
fn explicit_limit(sql: &str) -> Option<i64> {
    use sqlparser::{
        ast::{Expr, LimitClause, Statement, Value, ValueWithSpan},
        dialect::PostgreSqlDialect,
        parser::Parser,
    };
    let sql = replace_o2_custom_patterns(sql).unwrap_or_else(|_| sql.to_string());
    let Statement::Query(query) = Parser::parse_sql(&PostgreSqlDialect {}, &sql).ok()?.pop()?
    else {
        return None;
    };
    let LimitClause::LimitOffset {
        limit:
            Some(Expr::Value(ValueWithSpan {
                value: Value::Number(n, _),
                ..
            })),
        ..
    } = query.limit_clause?
    else {
        return None;
    };
    n.parse().ok()
}

async fn run_panel(
    ctx: &Ctx<'_>,
    vars: &QueryVars,
    frozen: &BTreeMap<String, serde_json::Value>,
    values: &Values,
    tab: &Tab,
    panel: &Panel,
) -> PanelRun {
    let manifest = panel_manifest(ctx, vars, frozen, values, tab, panel);
    let structural = |reason, manifest| {
        PanelRun::not_available(&panel.id, Class::Structural, reason, manifest, None)
    };
    // A custom chart runs the author's JavaScript in the viewer's origin, so it is never public.
    if panel.typ == "custom_chart" {
        return structural(NotAvailableReason::Unsupported, manifest);
    }
    let used: Vec<String> = manifest.resolved_variables.keys().cloned().collect();
    if used.iter().any(|k| values.denied.contains(k)) {
        return PanelRun::not_available(
            &panel.id,
            Class::Denied,
            NotAvailableReason::Unauthorized,
            manifest,
            None,
        );
    }
    if used.iter().any(|k| values.failed.contains(k)) {
        let error = "a variable's values query failed".to_string();
        return ctx.panel_failed(panel, manifest, error);
    }
    if !panel.queries.iter().any(|q| query_text(q).is_some()) {
        return structural(NotAvailableReason::NoQuery, manifest);
    }
    let is_promql = panel.query_type == "promql";
    let shifted = panel
        .queries
        .iter()
        .any(|q| !time_shifts(q, ctx.end, is_promql).is_empty());
    if shifted && !get_config().public_dashboards.time_shifts {
        return structural(NotAvailableReason::Unsupported, manifest);
    }
    let panel_vars = vars.for_panel(&tab.tab_id, &panel.id);
    if is_promql {
        run_promql_panel(ctx, panel, &panel_vars, manifest).await
    } else {
        run_sql_panel(ctx, tab, panel, &panel_vars, manifest).await
    }
}

/// The panel's provenance before any query: its intent and the scoped values it reads.
fn panel_manifest(
    ctx: &Ctx<'_>,
    vars: &QueryVars,
    frozen: &BTreeMap<String, serde_json::Value>,
    values: &Values,
    tab: &Tab,
    panel: &Panel,
) -> ManifestPanel {
    let texts: Vec<&str> = panel
        .queries
        .iter()
        .flat_map(|q| [q.query.as_deref(), q.vrl_function_query.as_deref()])
        .flatten()
        .collect();
    let used = vars.referenced(&tab.tab_id, &panel.id, &texts);
    ManifestPanel {
        intent: intent::panel_intent(ctx.dash, vars, frozen, tab, panel),
        resolved_variables: used
            .iter()
            .map(|(_, key)| {
                let value = values.values.get(key).cloned();
                (key.clone(), value.unwrap_or(serde_json::Value::Null))
            })
            .collect(),
        values_dependencies: used
            .iter()
            .filter_map(|(_, key)| values.deps.get(key).cloned())
            .collect(),
        built_at: Some(ctx.now),
        ..Default::default()
    }
}

async fn run_sql_panel(
    ctx: &Ctx<'_>,
    tab: &Tab,
    panel: &Panel,
    vars: &PanelVars,
    mut manifest: ManifestPanel,
) -> PanelRun {
    let cap = get_config().limit.query_default_limit;
    let mut out = Collected::default();
    for (qi, q) in panel.queries.iter().enumerate() {
        let Some(tmpl) = query_text(q) else {
            continue;
        };
        let base = vars.substitute(tmpl, "sql", ctx.start, ctx.end);
        let limit = explicit_limit(&base);
        if limit.is_some_and(|n| n > cap) {
            return PanelRun::not_available(
                &panel.id,
                Class::Structural,
                NotAvailableReason::TooLarge,
                manifest,
                None,
            );
        }
        let target = (q.fields.stream_type, q.fields.stream.as_str());
        record_sources(&mut manifest, "sql", &base, target);
        if let Err(reason) = authorize_query(
            &ctx.link.org_id,
            &ctx.link.published_by,
            "sql",
            &base,
            target,
        )
        .await
        {
            return PanelRun::not_available(&panel.id, Class::Denied, reason, manifest, None);
        }
        let shifts = time_shifts(q, ctx.end, false);
        for shift in std::iter::once(None).chain(shifts.iter().map(Some)) {
            if ctx.family.is_cancelled() {
                return ctx.panel_failed(panel, manifest, "the build timed out".to_string());
            }
            let gap = shift.map_or(0, |s| s.gap_ms * 1000);
            let (start, end) = (ctx.start - gap, ctx.end - gap);
            let sql = vars.substitute(tmpl, "sql", start, end);
            let (start, range_error) = clamp_start(
                &ctx.link.org_id,
                &ctx.identity,
                &sql,
                q.fields.stream_type,
                start,
                end,
            )
            .await;
            let req = sql_request(
                ctx,
                &panel.id,
                sql.clone(),
                start,
                end,
                q.vrl_function_query.as_deref(),
            );
            let trace_id = ctx.family.child();
            let clamped = !range_error.is_empty();
            let resp = match search_service::cache::search(
                &trace_id,
                &ctx.link.org_id,
                q.fields.stream_type,
                Some(ctx.identity.clone()),
                &req,
                range_error,
                false,
                Some(ctx.dashboard_info(tab, panel)),
                false,
            )
            .await
            {
                Ok(resp) => resp,
                Err(e) => return ctx.panel_failed(panel, manifest, e.to_string()),
            };
            let hits = resp.hits.len();
            // The wrapper also flags a clamped window as partial; only a real gap is retried.
            let partial = resp.is_partial
                && (!clamped
                    || resp
                        .function_error
                        .iter()
                        .any(|e| e == search::PARTIAL_ERROR_RESPONSE_MESSAGE));
            out.partial |= partial;
            out.truncated |= limit.is_none() && i64::try_from(hits).unwrap_or(i64::MAX) >= cap;
            if shift.is_none() && out.window.is_none() {
                out.window = Some(Window { start, end });
            }
            manifest.queries.push(ExecutedQuery {
                text: sql,
                query_type: "sql".to_string(),
                window: Window { start, end },
                time_shift_micros: gap,
                is_partial: partial,
                hits,
                trace_id,
            });
            let mut full = serde_json::to_value(&resp).unwrap_or_default();
            let hits = full
                .as_object_mut()
                .and_then(|obj| obj.remove("hits"))
                .unwrap_or_else(|| serde_json::Value::Array(vec![]));
            out.data.push(hits);
            out.meta.push(public_meta(&full));
            out.queries.push(query_meta(start, end, "sql", qi, shift));
        }
    }
    out.into_run(panel, manifest, ctx.now)
}

async fn run_promql_panel(
    ctx: &Ctx<'_>,
    panel: &Panel,
    vars: &PanelVars,
    mut manifest: ManifestPanel,
) -> PanelRun {
    let max_series = get_config().limit.max_dashboard_series;
    let queries: Vec<(usize, &config::meta::dashboards::v8::Query, String)> = panel
        .queries
        .iter()
        .enumerate()
        .filter_map(|(qi, q)| {
            let expr = vars.substitute(query_text(q)?, "promql", ctx.start, ctx.end);
            Some((qi, q, expr))
        })
        .collect();
    for (_, q, expr) in &queries {
        let target = (q.fields.stream_type, q.fields.stream.as_str());
        record_sources(&mut manifest, "promql", expr, target);
        if let Err(reason) = authorize_query(
            &ctx.link.org_id,
            &ctx.link.published_by,
            "promql",
            expr,
            target,
        )
        .await
        {
            return PanelRun::not_available(&panel.id, Class::Denied, reason, manifest, None);
        }
    }
    let mut out = Collected {
        window: Some(Window {
            start: ctx.start,
            end: ctx.end,
        }),
        ..Default::default()
    };
    let mut kept: Vec<Vec<serde_json::Value>> = Vec::with_capacity(queries.len());
    // The live renderer sends every unshifted query first, then each query's shifts.
    let shifted: Vec<(usize, &str, Option<Shift>)> = queries
        .iter()
        .enumerate()
        .map(|(i, (_, _, expr))| (i, expr.as_str(), None))
        .chain(queries.iter().enumerate().flat_map(|(i, (_, q, expr))| {
            time_shifts(q, ctx.end, true)
                .into_iter()
                .map(move |s| (i, expr.as_str(), Some(s)))
        }))
        .collect();
    for (i, expr, shift) in shifted {
        if ctx.family.is_cancelled() {
            return ctx.panel_failed(panel, manifest, "the build timed out".to_string());
        }
        let gap = shift.as_ref().map_or(0, |s| s.gap_ms * 1000);
        let (start, end) = (ctx.start - gap, ctx.end - gap);
        let trace_id = ctx.family.child();
        let (mut data, partial) =
            match run_promql(ctx, &panel.id, &trace_id, expr, start, end).await {
                Ok(v) => v,
                Err(e) => return ctx.panel_failed(panel, manifest, e),
            };
        let keep = shift.as_ref().and_then(|_| kept.get(i)).map(Vec::as_slice);
        let metrics = cut_series(&mut data, max_series, keep);
        if shift.is_none() {
            kept.push(metrics);
        }
        out.partial |= partial;
        manifest.queries.push(ExecutedQuery {
            text: expr.to_string(),
            query_type: "promql".to_string(),
            window: Window { start, end },
            time_shift_micros: gap,
            is_partial: partial,
            hits: data["result"].as_array().map_or(0, Vec::len),
            trace_id,
        });
        out.data.push(data);
        out.meta.push(serde_json::Value::Null);
        out.queries.push(query_meta(
            start,
            end,
            "promql",
            queries[i].0,
            shift.as_ref(),
        ));
    }
    out.into_run(panel, manifest, ctx.now)
}

/// One PromQL range query as the public identity; a response with warnings is partial.
async fn run_promql(
    ctx: &Ctx<'_>,
    panel_id: &str,
    trace_id: &str,
    expr: &str,
    start: i64,
    end: i64,
) -> Result<(serde_json::Value, bool), String> {
    let req = promql_request(ctx, panel_id, expr, start, end);
    #[cfg(not(feature = "enterprise"))]
    let is_super_cluster = false;
    #[cfg(feature = "enterprise")]
    let is_super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    let resp = promql_service::search::search(
        trace_id,
        &ctx.link.org_id,
        &req,
        &ctx.identity,
        ctx.timeout(),
        is_super_cluster,
    )
    .await
    .map_err(|e| e.to_string())?;
    let data = serde_json::json!({
        "resultType": resp.value.get_type().to_string(),
        "result": resp.value,
    });
    Ok((data, !resp.warnings.is_empty()))
}

/// The search a PromQL panel query runs: its cache on, typed and timed for public dashboards.
fn promql_request(
    ctx: &Ctx<'_>,
    panel_id: &str,
    expr: &str,
    start: i64,
    end: i64,
) -> promql_service::MetricsQueryRequest {
    promql_service::MetricsQueryRequest {
        query: expr.to_string(),
        start,
        end,
        step: ((end - start) / 400).max(1_000_000),
        query_exemplars: false,
        use_cache: Some(true),
        search_type: Some(search::SearchEventType::PublicDashboard),
        search_event_context: Some(ctx.event_context(Some(panel_id))),
        regions: vec![],
        clusters: vec![],
    }
}

/// The search a SQL panel query runs, with the panel's VRL function applied as on the live panel.
fn sql_request(
    ctx: &Ctx<'_>,
    panel_id: &str,
    sql: String,
    start: i64,
    end: i64,
    vrl: Option<&str>,
) -> search::Request {
    search::Request {
        query: search::Query {
            sql,
            start_time: start,
            end_time: end,
            // Same as the live panel loader; the server caps it at ZO_QUERY_DEFAULT_LIMIT.
            size: -1,
            track_total_hits: false,
            // Stored as plain text; search() expects it decoded, unlike the HTTP API.
            query_fn: vrl
                .map(str::trim)
                .filter(|f| !f.is_empty())
                .map(str::to_string),
            ..Default::default()
        },
        use_cache: true,
        timeout: ctx.timeout(),
        search_type: Some(search::SearchEventType::PublicDashboard),
        search_event_context: Some(ctx.event_context(Some(panel_id))),
        ..Default::default()
    }
}

/// Fills each missing variable as the live picker would, through the panels' path and identity.
async fn fill_defaults(ctx: &Ctx<'_>, frozen: BTreeMap<String, serde_json::Value>) -> Values {
    let mut defaults = Defaults::new(ctx.dash, frozen);
    let mut out = Values::default();
    while let Some(pending) = defaults.next_query() {
        let key = pending.key.clone();
        if pending.depends_on.iter().any(|k| out.denied.contains(k)) {
            out.denied.insert(key);
            defaults.settle(pending, None);
            continue;
        }
        let q = &pending.query;
        let sources = typed_sources("sql", &q.sql, (q.stream_type, q.stream.as_str()));
        out.deps.insert(
            key.clone(),
            ValuesDependency {
                variable: key.clone(),
                sources: sources.clone(),
            },
        );
        let target = (q.stream_type, q.stream.as_str());
        let keys = match authorize_query(
            &ctx.link.org_id,
            &ctx.link.published_by,
            "sql",
            &q.sql,
            target,
        )
        .await
        {
            Err(_) => {
                out.denied.insert(key);
                None
            }
            Ok(_) => match run_values(ctx, q).await {
                Ok(keys) => Some(keys),
                Err(e) => {
                    log::warn!("public dashboard variable values query failed: {e}");
                    out.failed.insert(key);
                    None
                }
            },
        };
        defaults.settle(pending, keys);
    }
    out.values = defaults.into_values();
    out
}

async fn run_values(ctx: &Ctx<'_>, q: &ValuesQuery) -> Result<Vec<String>, String> {
    let req = search::Request {
        query: search::Query {
            sql: q.sql.clone(),
            start_time: ctx.start,
            end_time: ctx.end,
            size: q.size,
            track_total_hits: false,
            ..Default::default()
        },
        use_cache: true,
        timeout: ctx.timeout(),
        search_type: Some(search::SearchEventType::PublicDashboard),
        search_event_context: Some(ctx.event_context(None)),
        ..Default::default()
    };
    let resp = search_service::cache::search(
        &ctx.family.child(),
        &ctx.link.org_id,
        q.stream_type,
        Some(ctx.identity.clone()),
        &req,
        String::new(),
        false,
        None,
        false,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(resp
        .hits
        .iter()
        .filter_map(|hit| hit.get("zo_sql_key"))
        .filter(|key| !key.is_null())
        .map(variables::js_string)
        .collect())
}

/// Publishes the build's estimate from the search partition call before any panel runs.
async fn publish_estimate(
    ctx: &Ctx<'_>,
    vars: &QueryVars,
    panels: &[(&Tab, &Panel)],
    flight: &Flight,
) {
    let cfg = get_config();
    let mut size = 0usize;
    for (tab, panel) in panels.iter().filter(|(_, p)| p.query_type != "promql") {
        let panel_vars = vars.for_panel(&tab.tab_id, &panel.id);
        for q in &panel.queries {
            let Some(tmpl) = query_text(q) else {
                continue;
            };
            let req = search::SearchPartitionRequest {
                sql: panel_vars.substitute(tmpl, "sql", ctx.start, ctx.end),
                start_time: ctx.start,
                end_time: ctx.end,
                encoding: Default::default(),
                regions: vec![],
                clusters: vec![],
                query_fn: None,
                streaming_output: false,
                histogram_interval: 0,
                sampling_ratio: None,
                search_type: Some(search::SearchEventType::PublicDashboard),
            };
            if let Ok(resp) = search_service::search_partition(
                &ctx.family.child(),
                &ctx.link.org_id,
                Some(&ctx.identity),
                q.fields.stream_type,
                &req,
                false,
                true,
            )
            .await
            {
                size += resp.original_size;
            }
        }
    }
    let speed = cfg.limit.query_group_base_speed.max(1) * cfg.limit.cpu_num.max(1);
    flight.set_estimate(u64::try_from(size.div_ceil(speed)).unwrap_or(u64::MAX));
}

/// The window start after each stream's max_query_range, as the HTTP search handler clamps it.
async fn clamp_start(
    org: &str,
    identity: &str,
    sql: &str,
    stream_type: StreamType,
    start: i64,
    end: i64,
) -> (i64, String) {
    let Ok(names) = resolve_stream_names(sql) else {
        return (start, String::new());
    };
    let (mut start, mut range_error) = (start, String::new());
    for name in names {
        let Some(settings) = infra::schema::get_settings(org, &name, stream_type).await else {
            continue;
        };
        let max_hours = search_service::query_range::get_settings_max_query_range(
            settings.max_query_range,
            org,
            Some(identity),
        )
        .await;
        if let Some(clamped) = clamped_start(stream_type, start, end, max_hours) {
            start = clamped;
            range_error = format!(
                "Query duration is modified due to query range restriction of {max_hours} hours"
            );
        }
    }
    (start, range_error)
}

fn clamped_start(stream_type: StreamType, start: i64, end: i64, max_hours: i64) -> Option<i64> {
    let max = max_hours * 3600 * 1_000_000;
    (stream_type != StreamType::EnrichmentTables && max_hours > 0 && end - start > max)
        .then_some(end - max)
}

/// The shifts the live renderer runs; PromQL takes fixed units only and none when instant.
fn time_shifts(q: &config::meta::dashboards::v8::Query, end: i64, promql: bool) -> Vec<Shift> {
    let cfg = serde_json::to_value(&q.config).unwrap_or_default();
    if promql && cfg.get("query_type").and_then(|v| v.as_str()) == Some("instant") {
        return vec![];
    }
    cfg.get("time_shift")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|s| s.get("offSet").and_then(|v| v.as_str()))
        .filter_map(|off| shift_gap(off, end, promql))
        .collect()
}

/// `1h` → 3,600,000 ms "1 Hour ago"; `M` is a calendar month back from the window end.
fn shift_gap(offset: &str, end: i64, fixed_only: bool) -> Option<Shift> {
    let unit = offset.chars().last()?;
    let n: i64 = offset[..offset.len() - unit.len_utf8()].parse().ok()?;
    let (gap_ms, word) = match unit {
        's' => (n * 1_000, "Second"),
        'm' => (n * 60_000, "Minute"),
        'h' => (n * 3_600_000, "Hour"),
        'd' => (n * 86_400_000, "Day"),
        'w' => (n * 604_800_000, "Week"),
        'M' if !fixed_only => {
            let end_at = chrono::DateTime::from_timestamp_micros(end)?;
            let back = end_at.checked_sub_months(chrono::Months::new(u32::try_from(n).ok()?))?;
            ((end_at - back).num_milliseconds(), "Month")
        }
        _ => return None,
    };
    (gap_ms > 0).then(|| Shift {
        gap_ms,
        label: format!("{n} {word}{} ago", if n == 1 { "" } else { "s" }),
    })
}

/// The per-query metadata the live loader builds; `timeRangeGap.seconds` holds milliseconds.
fn query_meta(
    start: i64,
    end: i64,
    query_type: &str,
    qi: usize,
    shift: Option<&Shift>,
) -> serde_json::Value {
    serde_json::json!({
        "startTime": start,
        "endTime": end,
        "queryType": query_type,
        "timeRangeGap": {
            "seconds": shift.map_or(0, |s| s.gap_ms),
            "periodAsStr": shift.map_or("", |s| s.label.as_str()),
        },
        "panelQueryIndex": qi,
    })
}

/// Keeps the series the live chart keeps (a shifted query keeps its base's) and returns them.
fn cut_series(
    data: &mut serde_json::Value,
    max: usize,
    keep: Option<&[serde_json::Value]>,
) -> Vec<serde_json::Value> {
    let Some(series) = data.get_mut("result").and_then(|r| r.as_array_mut()) else {
        return vec![];
    };
    if let Some(keep) = keep {
        series.retain(|s| s.get("metric").is_some_and(|m| keep.contains(m)));
    }
    series.truncate(max);
    series
        .iter()
        .map(|s| s.get("metric").cloned().unwrap_or_default())
        .collect()
}

fn query_text(q: &config::meta::dashboards::v8::Query) -> Option<&str> {
    q.query.as_deref().filter(|t| !t.trim().is_empty())
}

/// Records the streams and cipher keys a query reads, denied or not, for the deadline check.
fn record_sources(
    manifest: &mut ManifestPanel,
    query_type: &str,
    text: &str,
    target: (StreamType, &str),
) {
    manifest
        .sources
        .extend(typed_sources(query_type, text, target));
    manifest
        .sources
        .sort_by(|a, b| (a.0.as_str(), &a.1).cmp(&(b.0.as_str(), &b.1)));
    manifest.sources.dedup();
    #[cfg(feature = "enterprise")]
    if query_type != "promql"
        && let Ok(keys) = ::search::sql::visitor::cipher_key::get_cipher_key_names(text)
    {
        manifest.cipher_keys.extend(keys);
        manifest.cipher_keys.sort();
        manifest.cipher_keys.dedup();
    }
}

fn public_meta(full: &serde_json::Value) -> serde_json::Value {
    let kept = PUBLIC_META_FIELDS
        .iter()
        .filter_map(|&k| full.get(k).map(|v| (k.to_string(), v.clone())))
        .collect();
    serde_json::Value::Object(kept)
}

fn parse_frozen_vars(json: Option<&str>) -> BTreeMap<String, serde_json::Value> {
    json.and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default()
}

/// The typed streams a query reads; one that does not parse falls back to the panel's stream.
fn typed_sources(
    query_type: &str,
    text: &str,
    target: (StreamType, &str),
) -> Vec<(StreamType, String)> {
    match query_streams(query_type, text, target.0) {
        Ok(streams) => streams.into_iter().map(|(s, t)| (t, s)).collect(),
        Err(_) if target.1.is_empty() => vec![],
        Err(_) => vec![(target.0, target.1.to_string())],
    }
}

/// The distinct streams a SQL or PromQL query reads; an unqualified table takes `default_type`.
fn query_streams(
    query_type: &str,
    text: &str,
    default_type: StreamType,
) -> Result<Vec<(String, StreamType)>, String> {
    let mut out: Vec<(String, StreamType)> = Vec::new();
    if query_type == "promql" {
        let ast = promql_parser::parser::parse(text).map_err(|e| e.to_string())?;
        let mut visitor = promql::ast::name_visitor::MetricNameVisitor::default();
        promql::ast::visitor::walk_expr(&mut visitor, &ast).map_err(|e| e.to_string())?;
        let mut names: Vec<String> = visitor.into_names().into_iter().collect();
        names.sort();
        out.extend(names.into_iter().map(|n| (n, StreamType::Metrics)));
        return Ok(out);
    }
    let sql = replace_o2_custom_patterns(text).unwrap_or_else(|_| text.to_string());
    for table in resolve_stream_names_with_type(&sql).map_err(|e| e.to_string())? {
        let pair = (table.stream_name(), table.get_stream_type(default_type));
        if !out.contains(&pair) {
            out.push(pair);
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

async fn current_dashboard(org: &str, dashboard_id: &str) -> Result<Dashboard, anyhow::Error> {
    let Some((_folder, dash)) = dashboards::get_by_id(org, dashboard_id).await? else {
        return Err(anyhow::anyhow!("dashboard not found"));
    };
    check_format(&dash)?;
    Ok(dash)
}

fn validate_limits(cfg: &PublicDashboardConfig, now: i64) -> Result<(), String> {
    check_refresh_secs(cfg.refresh_secs)?;
    let name = cfg.name.trim();
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    if name.chars().count() > 256 {
        return Err("name must be at most 256 characters".to_string());
    }
    check_ranges(&cfg.time_range, now)?;
    let vars_len = serde_json::to_string(&cfg.frozen_variables).map_or(0, |s| s.len());
    if vars_len > MAX_FROZEN_VARIABLES_BYTES {
        return Err("frozen variables must be at most 64 KB".to_string());
    }
    Ok(())
}

fn check_ranges(tr: &TimeRangePolicy, now: i64) -> Result<(), String> {
    if tr.ranges.is_empty() {
        return Err("at least one time range is required".to_string());
    }
    if tr.ranges.len() > MAX_RANGES {
        return Err(format!("at most {MAX_RANGES} time ranges are allowed"));
    }
    let keys: BTreeSet<String> = tr.ranges.iter().map(TimeRange::key).collect();
    if keys.len() != tr.ranges.len() {
        return Err("each time range can be listed only once".to_string());
    }
    if !keys.contains(&tr.default.key()) {
        return Err("the default time range must be one of the time ranges".to_string());
    }
    for range in &tr.ranges {
        check_range(range, now)?;
    }
    Ok(())
}

fn check_range(range: &TimeRange, now: i64) -> Result<(), String> {
    match range {
        TimeRange::Relative { secs } if *secs < MIN_RANGE_SECS => {
            return Err("a relative time range must be at least 1 minute".to_string());
        }
        TimeRange::Relative { secs } if *secs % 60 != 0 => {
            return Err("a relative time range must be a whole number of minutes".to_string());
        }
        TimeRange::Absolute { start, .. } if *start < 0 => {
            return Err("an absolute time range can't start before 1970".to_string());
        }
        TimeRange::Absolute { start, end } if start >= end => {
            return Err("an absolute time range must start before it ends".to_string());
        }
        TimeRange::Absolute { end, .. } if *end > now => {
            return Err("an absolute time range must end in the past".to_string());
        }
        _ => {}
    }
    if range.length_secs() > MAX_RANGE_SECS {
        return Err("time ranges can be at most 365 days".to_string());
    }
    Ok(())
}

// Range floors and the operator minimum apply at read and build time, never at save.
fn check_refresh_secs(secs: i32) -> Result<(), String> {
    if !(MIN_REFRESH_SECS..=MAX_REFRESH_SECS).contains(&secs) {
        return Err("refresh_secs must be between 60 seconds and 30 days".to_string());
    }
    Ok(())
}

fn check_expiry(expires_at: Option<i64>, now: i64) -> Result<(), String> {
    if is_expired(expires_at, now) {
        return Err("expiry must be in the future".to_string());
    }
    Ok(())
}

fn is_expired(expires_at: Option<i64>, now: i64) -> bool {
    expires_at.is_some_and(|exp| exp <= now)
}

// The build only renders v8 panels, so an older dashboard would publish as an empty page.
fn check_format(dash: &Dashboard) -> Result<(), anyhow::Error> {
    if dash.v8.is_none() {
        return Err(Invalid(OLDER_FORMAT_ERROR.to_string()).into());
    }
    Ok(())
}

async fn gen_unique_slug() -> Result<String, anyhow::Error> {
    for _ in 0..5 {
        let slug = generate_random_string(22);
        if pd_table::get_by_slug(get_orm_client_rw().await, &slug)
            .await?
            .is_none()
        {
            return Ok(slug);
        }
    }
    Err(anyhow::anyhow!("could not generate a unique slug"))
}

#[cfg(test)]
mod tests {
    use config::meta::public_dashboards::Visibility;
    use serde_json::json;

    use super::*;

    #[test]
    fn expiry_must_be_in_the_future() {
        assert!(check_expiry(None, 100).is_ok());
        assert!(check_expiry(Some(101), 100).is_ok());
        assert_eq!(
            check_expiry(Some(100), 100).unwrap_err(),
            "expiry must be in the future"
        );
    }

    #[test]
    fn a_link_expires_at_its_expiry_instant() {
        assert!(!is_expired(None, 100));
        assert!(!is_expired(Some(101), 100));
        assert!(is_expired(Some(100), 100));
        assert!(is_expired(Some(5), 100));
    }

    #[test]
    fn only_a_v8_dashboard_can_be_published() {
        let old = Dashboard {
            version: 3,
            ..Default::default()
        };
        let err = check_format(&old).unwrap_err();
        assert_eq!(err.to_string(), OLDER_FORMAT_ERROR);
        assert!(err.downcast_ref::<Invalid>().is_some());
        let current = Dashboard {
            version: 8,
            v8: Some(Default::default()),
            ..Default::default()
        };
        assert!(check_format(&current).is_ok());
    }

    #[test]
    fn refresh_secs_is_one_minute_to_thirty_days() {
        assert!(check_refresh_secs(60).is_ok());
        assert!(check_refresh_secs(300).is_ok());
        assert!(check_refresh_secs(30 * 86_400).is_ok());
        assert_eq!(
            check_refresh_secs(59).unwrap_err(),
            "refresh_secs must be between 60 seconds and 30 days"
        );
        assert!(check_refresh_secs(30 * 86_400 + 1).is_err());
        assert!(check_refresh_secs(-5).is_err());
    }

    #[test]
    fn parse_frozen_vars_handles_valid_invalid_and_none() {
        let m = parse_frozen_vars(Some(r#"{"a":"b"}"#));
        assert_eq!(m.get("a").unwrap(), &json!("b"));
        assert!(parse_frozen_vars(Some("garbage")).is_empty());
        assert!(parse_frozen_vars(None).is_empty());
    }

    fn names(streams: Vec<(String, StreamType)>) -> Vec<String> {
        streams.into_iter().map(|(s, _)| s).collect()
    }

    #[test]
    fn query_streams_reads_every_stream_the_sql_touches() {
        let sql = r#"WITH x AS (SELECT * FROM "b") SELECT a.k FROM "a" a JOIN "c" c ON a.k = c.k
            WHERE a.k IN (SELECT k FROM "d") UNION ALL SELECT k FROM x"#;
        let got = names(query_streams("sql", sql, StreamType::Logs).unwrap());
        assert_eq!(got, ["a", "b", "c", "d"]);
    }

    #[test]
    fn query_streams_takes_the_type_from_a_qualified_table() {
        let got = query_streams(
            "sql",
            r#"SELECT * FROM "metrics"."cpu" JOIN "e" ON true"#,
            StreamType::Logs,
        )
        .unwrap();
        assert_eq!(
            got,
            [
                ("cpu".to_string(), StreamType::Metrics),
                ("e".to_string(), StreamType::Logs)
            ]
        );
    }

    #[test]
    fn query_streams_reads_every_promql_metric() {
        let got = query_streams(
            "promql",
            "sum(rate(errors_total[5m])) / sum(rate(requests_total[5m]))",
            StreamType::Logs,
        )
        .unwrap();
        assert_eq!(
            got,
            [
                ("errors_total".to_string(), StreamType::Metrics),
                ("requests_total".to_string(), StreamType::Metrics)
            ]
        );
    }

    #[test]
    fn query_streams_rejects_what_it_cant_tie_to_a_stream() {
        assert!(query_streams("promql", r#"{job="x"}"#, StreamType::Logs).is_err());
        assert!(query_streams("sql", "SELEC * FRM", StreamType::Logs).is_err());
    }

    #[test]
    fn public_meta_keeps_only_renderer_fields() {
        let full = json!({
            "histogram_interval": 60,
            "total": 3,
            "converted_histogram_query": "SELECT secret FROM s",
            "function_error": ["vrl leak"],
            "trace_id": "abc",
        });
        assert_eq!(
            public_meta(&full),
            json!({ "histogram_interval": 60, "total": 3 })
        );
    }

    fn rel(secs: i64) -> TimeRange {
        TimeRange::Relative { secs }
    }

    #[test]
    fn ranges_are_capped_in_count_and_unique_with_a_listed_default() {
        let tr = |ranges: Vec<TimeRange>, default: TimeRange| TimeRangePolicy { ranges, default };
        assert!(check_ranges(&tr(vec![rel(60), rel(3600)], rel(3600)), 0).is_ok());
        assert!(check_ranges(&tr(vec![], rel(3600)), 0).is_err());
        let eleven = (1..=11).map(|i| rel(i * 60)).collect();
        assert!(check_ranges(&tr(eleven, rel(60)), 0).is_err());
        assert!(check_ranges(&tr(vec![rel(60), rel(60)], rel(60)), 0).is_err());
        assert_eq!(
            check_ranges(&tr(vec![rel(60)], rel(3600)), 0).unwrap_err(),
            "the default time range must be one of the time ranges"
        );
    }

    #[test]
    fn each_range_is_checked_by_type() {
        let now = 1_000 * 86_400 * 1_000_000;
        let abs = |start: i64, end: i64| TimeRange::Absolute { start, end };
        let day = 86_400 * 1_000_000;
        assert!(check_range(&rel(30), now).is_err());
        assert!(check_range(&rel(120), now).is_ok());
        assert_eq!(
            check_range(&rel(61), now).unwrap_err(),
            "a relative time range must be a whole number of minutes"
        );
        assert!(check_range(&rel(365 * 86_400), now).is_ok());
        assert!(check_range(&rel(366 * 86_400), now).is_err());
        assert!(check_range(&rel(90 * 86_400), now).is_ok());
        assert!(check_range(&abs(now - 365 * day, now), now).is_ok());
        assert!(check_range(&abs(now - 366 * day, now), now).is_err());
        assert!(check_range(&abs(now, now - day), now).is_err());
        assert!(check_range(&abs(0, day), now).is_ok());
        assert_eq!(
            check_range(&abs(-1, day), now).unwrap_err(),
            "an absolute time range can't start before 1970"
        );
        assert_eq!(
            check_range(&abs(now - day, now + 1), now).unwrap_err(),
            "an absolute time range must end in the past"
        );
    }

    fn cfg(name: &str, refresh_secs: i32) -> PublicDashboardConfig {
        PublicDashboardConfig {
            name: name.to_string(),
            visibility: Visibility::Public,
            time_range: TimeRangePolicy {
                ranges: vec![rel(3600)],
                default: rel(3600),
            },
            frozen_variables: BTreeMap::new(),
            refresh_secs,
            expires_at: None,
        }
    }

    #[test]
    fn name_is_required_and_capped() {
        assert_eq!(
            validate_limits(&cfg("   ", 300), 0).unwrap_err(),
            "name is required"
        );
        assert!(validate_limits(&cfg(&"x".repeat(257), 300), 0).is_err());
        assert!(validate_limits(&cfg("NOC wall", 300), 0).is_ok());
    }

    #[test]
    fn a_range_floor_above_the_selection_is_not_refused_at_save() {
        let mut long = cfg("wall", 60);
        long.time_range = TimeRangePolicy {
            ranges: vec![rel(30 * 86_400)],
            default: rel(30 * 86_400),
        };
        assert!(validate_limits(&long, 0).is_ok());
        assert!(validate_limits(&cfg("wall", 30), 0).is_err());
    }

    #[test]
    fn the_org_limit_comes_from_settings_but_never_exceeds_the_env() {
        let row = |max_links| OrgSettings {
            org_id: "o".into(),
            rev: 1,
            enabled: true,
            max_links,
            updated_at: 1,
            updated_by: "a".into(),
        };
        assert_eq!(org_link_limit(None), 50);
        assert_eq!(org_link_limit(Some(&row(None))), 50);
        assert_eq!(org_link_limit(Some(&row(Some(3)))), 3);
        assert_eq!(org_link_limit(Some(&row(Some(80)))), 50);
        assert_eq!(org_link_limit(Some(&row(Some(-1)))), 0);
    }

    #[test]
    fn explicit_limit_reads_only_the_outermost_numeric_limit() {
        assert_eq!(explicit_limit("SELECT * FROM t LIMIT 50000"), Some(50_000));
        assert_eq!(
            explicit_limit("SELECT * FROM (SELECT * FROM t LIMIT 9) LIMIT 20 OFFSET 5"),
            Some(20)
        );
        assert_eq!(
            explicit_limit("SELECT * FROM (SELECT * FROM t LIMIT 9)"),
            None
        );
        assert_eq!(explicit_limit("SELECT * FROM t"), None);
        assert_eq!(explicit_limit("SELEC * FRM"), None);
    }

    fn panel(id: &str, sql: Option<&str>) -> serde_json::Value {
        let queries = sql.map_or_else(Vec::new, |sql| {
            vec![json!({
                "query": sql, "customQuery": true,
                "fields": { "stream": "s", "stream_type": "logs", "x": [], "y": [],
                            "filter": { "filterType": "group", "logicalOperator": "AND", "conditions": [] } },
                "config": { "promql_legend": "" }
            })]
        });
        json!({
            "id": id, "type": "table", "title": format!("Panel {id}"), "description": "",
            "config": { "show_legends": false, "legends_position": null },
            "queries": queries
        })
    }

    fn dashboard(tabs: Vec<Vec<serde_json::Value>>) -> Dashboard {
        let tabs: Vec<_> = tabs
            .into_iter()
            .enumerate()
            .map(|(i, panels)| json!({ "tabId": format!("t{i}"), "name": "", "panels": panels }))
            .collect();
        Dashboard {
            version: 8,
            v8: Some(serde_json::from_value(json!({ "tabs": tabs })).unwrap()),
            ..Default::default()
        }
    }

    #[test]
    fn panels_are_counted_across_every_tab() {
        let ten: Vec<_> = (0..10).map(|i| panel(&format!("p{i}"), None)).collect();
        let frozen = BTreeMap::new();
        assert!(validate_dashboard(&dashboard(vec![ten.clone()]), &frozen, 0).is_ok());
        let four: Vec<_> = (10..14).map(|i| panel(&format!("p{i}"), None)).collect();
        assert_eq!(
            validate_dashboard(&dashboard(vec![ten, four]), &frozen, 0).unwrap_err(),
            "This dashboard has 14 panels; a public link can show at most 10."
        );
    }

    #[test]
    fn a_limit_above_the_default_is_refused_naming_the_panel() {
        let frozen = BTreeMap::new();
        let ok = dashboard(vec![vec![panel("a", Some("SELECT * FROM s LIMIT 1000"))]]);
        assert!(validate_dashboard(&ok, &frozen, 0).is_ok());
        let big = dashboard(vec![
            vec![panel("a", Some("SELECT * FROM s"))],
            vec![panel("b", Some("SELECT * FROM s LIMIT 50000"))],
        ]);
        assert_eq!(
            validate_dashboard(&big, &frozen, 0).unwrap_err(),
            "Panel \"Panel b\" has LIMIT 50000, above the public cap of 1000 rows. Lower it or aggregate."
        );
    }

    fn ctx_parts() -> (PublicDashboard, Dashboard, TraceFamily) {
        let link = PublicDashboard {
            id: "l1".into(),
            org_id: "o1".into(),
            folder_id: "f1".into(),
            dashboard_id: "d1".into(),
            slug: "s".into(),
            name: "n".into(),
            visibility: 1,
            time_ranges: None,
            default_range_key: None,
            frozen_variables: None,
            refresh_secs: 300,
            dashboard_version: 8,
            published_by: "p@x".into(),
            enabled: true,
            expires_at: None,
            created_by: "p@x".into(),
            updated_by: None,
            created_at: 0,
            updated_at: 0,
            rev: 1,
            deleted_at: None,
            last_accessed_at: None,
            access_count: 0,
        };
        (
            link,
            dashboard(vec![vec![panel("a", Some("SELECT 1"))]]),
            TraceFamily::default(),
        )
    }

    fn ctx<'a>(link: &'a PublicDashboard, dash: &'a Dashboard, family: &'a TraceFamily) -> Ctx<'a> {
        Ctx {
            link,
            dash,
            identity: public_dashboard_identity(&link.org_id),
            range_key: "r3600",
            start: 10,
            end: 20,
            now: 20,
            family,
        }
    }

    #[test]
    fn gate16_the_sql_request_is_the_live_panels_with_cache_type_identity_and_timeout() {
        let (link, dash, family) = ctx_parts();
        let ctx = ctx(&link, &dash, &family);
        let req = sql_request(
            &ctx,
            "a",
            "SELECT 1".into(),
            10,
            20,
            Some("  del(.email)\n "),
        );
        assert_eq!(req.query.query_fn.as_deref(), Some("del(.email)"));
        assert_eq!((req.query.start_time, req.query.end_time), (10, 20));
        assert_eq!(req.query.size, -1);
        assert!(req.use_cache);
        assert_eq!(req.timeout, 60);
        assert_eq!(
            req.search_type,
            Some(search::SearchEventType::PublicDashboard)
        );
        let ec = req.search_event_context.unwrap();
        assert_eq!(ec.public_dashboard_link_id.as_deref(), Some("l1"));
        assert_eq!(ec.dashboard_id.as_deref(), Some("d1"));
        assert_eq!(ec.range_key.as_deref(), Some("r3600"));
        assert_eq!(ec.panel_id.as_deref(), Some("a"));
        assert!(
            sql_request(&ctx, "a", "SELECT 1".into(), 0, 1, Some("  "))
                .query
                .query_fn
                .is_none()
        );
        let info = ctx.dashboard_info(
            &dash.v8.as_ref().unwrap().tabs[0],
            &dash.v8.as_ref().unwrap().tabs[0].panels[0],
        );
        assert_eq!((info.panel_id.as_str(), info.tab_id.as_str()), ("a", "t0"));
        assert_eq!(info.run_id, family.id());
        assert_eq!(ctx.identity, "public-dashboard.org-o1@openobserve.internal");
    }

    #[test]
    fn gate16_the_promql_request_uses_its_cache_the_public_type_and_the_live_step() {
        let (link, dash, family) = ctx_parts();
        let ctx = ctx(&link, &dash, &family);
        let req = promql_request(&ctx, "a", "up", 0, 4_000_000_000);
        assert_eq!(req.use_cache, Some(true));
        assert_eq!(
            req.search_type,
            Some(search::SearchEventType::PublicDashboard)
        );
        assert_eq!(req.step, 10_000_000);
        assert_eq!(
            promql_request(&ctx, "a", "up", 0, 60_000_000).step,
            1_000_000
        );
        assert_eq!(
            req.search_event_context.unwrap().panel_id.as_deref(),
            Some("a")
        );
    }

    fn query_with_shifts(shifts: &[&str], instant: bool) -> config::meta::dashboards::v8::Query {
        let mut config = json!({ "promql_legend": "" });
        config["time_shift"] = json!(
            shifts
                .iter()
                .map(|s| json!({ "offSet": s }))
                .collect::<Vec<_>>()
        );
        if instant {
            config["query_type"] = json!("instant");
        }
        serde_json::from_value(json!({
            "query": "SELECT 1", "customQuery": true,
            "fields": { "stream": "s", "stream_type": "logs", "x": [], "y": [],
                        "filter": { "filterType": "group", "logicalOperator": "AND", "conditions": [] } },
            "config": config
        }))
        .unwrap()
    }

    #[test]
    fn gate16_time_shifts_run_as_the_live_renderer_names_them() {
        // 2026-03-31T00:00:00Z: a calendar month back is February's end.
        let end = 1_774_915_200_000_000;
        let q = query_with_shifts(&["1h", "2d", "1w", "1M", "bad", "0h"], false);
        let sql: Vec<(i64, String)> = time_shifts(&q, end, false)
            .into_iter()
            .map(|s| (s.gap_ms, s.label))
            .collect();
        assert_eq!(
            sql,
            [
                (3_600_000, "1 Hour ago".to_string()),
                (172_800_000, "2 Days ago".to_string()),
                (604_800_000, "1 Week ago".to_string()),
                (31 * 86_400_000, "1 Month ago".to_string()),
            ]
        );
        // PromQL takes fixed units only, and none for an instant query.
        assert_eq!(time_shifts(&q, end, true).len(), 3);
        assert!(time_shifts(&query_with_shifts(&["1h"], true), end, true).is_empty());
        let shift = Shift {
            gap_ms: 3_600_000,
            label: "1 Hour ago".into(),
        };
        assert_eq!(
            query_meta(1, 2, "sql", 0, Some(&shift)),
            json!({ "startTime": 1, "endTime": 2, "queryType": "sql",
                    "timeRangeGap": { "seconds": 3_600_000, "periodAsStr": "1 Hour ago" },
                    "panelQueryIndex": 0 })
        );
        assert_eq!(
            query_meta(1, 2, "promql", 1, None)["timeRangeGap"]["seconds"],
            0
        );
    }

    #[test]
    fn gate16_series_are_cut_as_the_chart_cuts_them() {
        let series = |names: &[&str]| json!({ "resultType": "matrix", "result": names.iter().map(|n| json!({ "metric": { "pod": n }, "values": [] })).collect::<Vec<_>>() });
        let mut base = series(&["a", "b", "c"]);
        let kept = cut_series(&mut base, 2, None);
        assert_eq!(kept, [json!({ "pod": "a" }), json!({ "pod": "b" })]);
        assert_eq!(base["result"].as_array().unwrap().len(), 2);
        let mut shifted = series(&["c", "b", "z", "a"]);
        cut_series(&mut shifted, 2, Some(&kept));
        let pods: Vec<_> = shifted["result"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["metric"]["pod"].clone())
            .collect();
        assert_eq!(pods, [json!("b"), json!("a")]);
    }

    #[test]
    fn gate16_a_window_is_clamped_per_stream_as_the_search_handler_clamps_it() {
        let hour = 3_600_000_000;
        assert_eq!(
            clamped_start(StreamType::Logs, 0, 48 * hour, 24),
            Some(24 * hour)
        );
        assert_eq!(
            clamped_start(StreamType::Logs, 30 * hour, 48 * hour, 24),
            None
        );
        assert_eq!(clamped_start(StreamType::Logs, 0, 48 * hour, 0), None);
        assert_eq!(
            clamped_start(StreamType::EnrichmentTables, 0, 48 * hour, 24),
            None
        );
    }

    #[test]
    fn gate16_partial_and_truncated_results_are_served_and_flagged() {
        let (_, dash, _) = ctx_parts();
        let panel = &dash.v8.as_ref().unwrap().tabs[0].panels[0];
        let run = |partial, truncated| {
            Collected {
                data: vec![json!([1])],
                partial,
                truncated,
                ..Default::default()
            }
            .into_run(panel, ManifestPanel::default(), 5)
        };
        let partial = run(true, false);
        assert_eq!(partial.class, Class::Partial);
        assert_eq!(
            serde_json::to_value(&partial.result.state).unwrap(),
            json!({ "state": "ok", "partial": true })
        );
        let truncated = run(false, true);
        assert_eq!(truncated.class, Class::Truncated);
        assert_eq!(
            serde_json::to_value(&truncated.result.state).unwrap(),
            json!({ "state": "ok", "truncated": true })
        );
        assert_eq!(truncated.result.data, [json!([1])]);
        assert_eq!(run(false, false).class, Class::Fresh);
    }

    #[test]
    fn gate05_the_build_and_the_config_route_compute_the_same_intent() {
        let (link, mut dash, family) = ctx_parts();
        let v8 = dash.v8.as_mut().unwrap();
        v8.tabs[0].panels[0].queries[0].query =
            Some("SELECT * FROM s WHERE svc = '$svc' AND _timestamp > $__range".into());
        v8.variables = Some(
            serde_json::from_value(
                json!({ "list": [{ "type": "query_values", "name": "svc", "label": "Svc",
                "query_data": { "stream_type": "logs", "stream": "s", "field": "svc" } }] }),
            )
            .unwrap(),
        );
        let frozen = BTreeMap::new();
        let config_side = intent::intents(&dash, &frozen);
        // The build resolves the unset default with a values query; the intent ignores values.
        let values = Values {
            values: [("svc".to_string(), json!("api"))].into_iter().collect(),
            ..Default::default()
        };
        let vars = QueryVars::new(&dash, values.values.clone(), None);
        let ctx = ctx(&link, &dash, &family);
        let tab = &dash.v8.as_ref().unwrap().tabs[0];
        let manifest = panel_manifest(&ctx, &vars, &frozen, &values, tab, &tab.panels[0]);
        assert_eq!(manifest.intent, config_side["a"]);
        assert_eq!(manifest.resolved_variables["svc"], json!("api"));
    }
}
