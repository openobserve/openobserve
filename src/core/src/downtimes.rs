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

//! The downtimes service behind `/api/v2/{org}/downtimes`.

mod access;
pub mod inventory;
pub mod listing;
pub mod matching;
pub mod resources;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant},
};

use config::{
    meta::{
        downtimes::{
            AffectedItems, DimensionCondition, Downtime, DowntimeDetail, DowntimeListItem,
            DowntimeRequest, DowntimeWindow, MoveDowntimesRequest, PreviewMatch, PreviewRequest,
            PreviewResponse, ResourcesRequest, ResourcesResponse, TargetModule,
        },
        folder::{DEFAULT_FOLDER, Folder, FolderType},
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::{
    announcements::meta::{Banner, BannerCount, BannerCta, BannerVariant},
    common::config::get_config as get_o2_config,
    downtimes::{banner_message, generated_name, schedule, scope, validate},
    oncall::routing::normalize_value,
};
use serde::Serialize;
use utoipa::ToSchema;

pub use self::listing::{ListQuery, ListResponse};
use self::matching::{Inventory, Matches, Visibility};

/// Match counts are recomputed at most this often per downtime.
const MATCH_COUNTS_TTL: Duration = Duration::from_secs(60);
/// The `affected` lists of `GET /{id}` stop at this many names per module.
const AFFECTED_CAP: usize = 500;

/// The order modules are listed in on a combined banner.
const MODULE_ORDER: [TargetModule; 4] = [
    TargetModule::Alerts,
    TargetModule::AnomalyDetections,
    TargetModule::Synthetics,
    TargetModule::Slos,
];

/// `downtime_id -> (updated_at of the row, computed at, matches)`; an edit changes `updated_at`.
type MatchCountsCache = RwLock<HashMap<String, (i64, Instant, Arc<Matches>)>>;

static MATCH_COUNTS: LazyLock<MatchCountsCache> = LazyLock::new(Default::default);

#[derive(Debug)]
pub enum DowntimeError {
    /// `O2_DOWNTIMES_ENABLED` is off.
    Disabled,
    NotFound,
    BadRequest(String),
    Forbidden(String),
    Conflict(String),
    Internal(String),
}

impl std::fmt::Display for DowntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => f.write_str("Downtimes are not enabled"),
            Self::NotFound => f.write_str("Downtime not found"),
            Self::BadRequest(m) | Self::Forbidden(m) | Self::Conflict(m) | Self::Internal(m) => {
                f.write_str(m)
            }
        }
    }
}

impl std::error::Error for DowntimeError {}

impl From<infra::errors::Error> for DowntimeError {
    fn from(e: infra::errors::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<anyhow::Error> for DowntimeError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct MatchCounts {
    pub alerts: usize,
    pub anomalies: usize,
    pub synthetics: usize,
    pub slos: usize,
}

impl MatchCounts {
    pub fn of(&self, module: TargetModule) -> usize {
        match module {
            TargetModule::Alerts => self.alerts,
            TargetModule::AnomalyDetections => self.anomalies,
            TargetModule::Synthetics => self.synthetics,
            TargetModule::Slos => self.slos,
        }
    }
}

/// One active downtime row with its current window and what it matches.
struct ActiveWindow<'a> {
    row: &'a Downtime,
    window: DowntimeWindow,
    matches: Arc<Matches>,
}

pub fn ensure_enabled() -> Result<(), DowntimeError> {
    if get_o2_config().downtimes.enabled {
        Ok(())
    } else {
        Err(DowntimeError::Disabled)
    }
}

pub async fn list(
    org: &str,
    user_id: &str,
    query: &ListQuery,
) -> Result<ListResponse, DowntimeError> {
    ensure_enabled()?;
    let folders = access::listable_downtime_folders(org, user_id).await?;
    let now = now_micros();
    let inventory = inventory::cached(org).await?;
    let items = db::downtimes::list_cached(org)
        .iter()
        .filter(|row| folders.contains(&row.folder_id))
        .map(|row| list_item(row, &counts_of(&match_counts_with(row, &inventory)), now))
        .collect();
    let alert = query
        .alert_id
        .as_deref()
        .and_then(|id| inventory.find(TargetModule::Alerts, id));
    let alert_view = alert.map(|a| scope::TargetItem {
        id: &a.id,
        folder_id: &a.folder_id,
        dimensions: &a.dims,
        tags: &a.tags,
    });
    Ok(listing::list_page(items, query, alert_view.as_ref()))
}

pub async fn get(org: &str, user_id: &str, id: &str) -> Result<DowntimeDetail, DowntimeError> {
    ensure_enabled()?;
    let row = load(org, id).await?;
    access::authorize_row(org, user_id, &row, "GET").await?;
    let inventory = inventory::cached(org).await?;
    let matches = matches_of(&row, &inventory);
    let visibility = access::visibility(org, user_id).await?;
    Ok(DowntimeDetail {
        item: list_item(&row, &counts_of(&matches), now_micros()),
        affected: affected(&matches, &visibility),
    })
}

pub async fn create(
    org: &str,
    user_id: &str,
    req: DowntimeRequest,
) -> Result<Downtime, DowntimeError> {
    ensure_enabled()?;
    let folder_id = resolve_folder(org, &req.folder_id).await?;
    let req = checked_request(org, user_id, req).await?;
    let limit = get_o2_config().downtimes.max_per_org;
    if db::downtimes::list_cached(org).len() >= limit {
        return Err(DowntimeError::BadRequest(format!(
            "This organization already has {limit} downtimes, the most allowed. Delete ended ones first."
        )));
    }
    let now = now_micros();
    let downtime = Downtime {
        id: infra::table::downtimes::new_id(),
        org: org.to_string(),
        folder_id,
        name: name_of(&req, now),
        reason: req.reason.clone(),
        condition: req.condition.clone(),
        targets: req.targets.clone(),
        schedule: req.schedule.clone(),
        cancelled_at: None,
        cancelled_by: None,
        show_banner: req.show_banner,
        created_by: user_id.to_string(),
        created_at: now,
        updated_by: user_id.to_string(),
        updated_at: now,
    };
    db::downtimes::set(&downtime).await?;
    db::authz::set_ownership(org, "downtimes", db::downtimes::ownership(&downtime)).await;
    remeasure_slos(None, &downtime);
    Ok(downtime)
}

/// Edits everything but the folder, which only `move` changes.
pub async fn update(
    org: &str,
    user_id: &str,
    id: &str,
    req: DowntimeRequest,
) -> Result<Downtime, DowntimeError> {
    ensure_enabled()?;
    let before = load(org, id).await?;
    access::authorize_row(org, user_id, &before, "PUT").await?;
    let req = checked_request(org, user_id, req).await?;
    let now = now_micros();
    let after = Downtime {
        name: name_of(&req, now),
        reason: req.reason,
        condition: req.condition,
        targets: req.targets,
        schedule: req.schedule,
        show_banner: req.show_banner,
        updated_by: user_id.to_string(),
        updated_at: now,
        ..before.clone()
    };
    set_if_unchanged(&after, before.updated_at).await?;
    if !before.same_coverage(&after) {
        forget_recorded_mutes(&after.id).await;
    }
    remeasure_slos(Some(before), &after);
    Ok(after)
}

/// Ends an active window now or calls off a scheduled one; the row stays for history.
pub async fn cancel(org: &str, user_id: &str, id: &str) -> Result<Downtime, DowntimeError> {
    ensure_enabled()?;
    let before = load(org, id).await?;
    access::authorize_row(org, user_id, &before, "PUT").await?;
    if before.cancelled_at.is_some() {
        return Ok(before);
    }
    let now = now_micros();
    let after = Downtime {
        cancelled_at: Some(now),
        cancelled_by: Some(user_id.to_string()),
        updated_by: user_id.to_string(),
        updated_at: now,
        ..before.clone()
    };
    set_if_unchanged(&after, before.updated_at).await?;
    remeasure_slos(Some(before), &after);
    Ok(after)
}

pub async fn delete(org: &str, user_id: &str, id: &str) -> Result<(), DowntimeError> {
    ensure_enabled()?;
    let row = load(org, id).await?;
    access::authorize_row(org, user_id, &row, "DELETE").await?;
    check_deletable(&row, now_micros())?;
    db::downtimes::delete(org, id).await?;
    db::authz::remove_ownership(org, "downtimes", db::downtimes::ownership(&row)).await;
    Ok(())
}

/// One row at a time through `set`, so every node cache and every region sees the new folder.
pub async fn move_to_folder(
    org: &str,
    user_id: &str,
    req: &MoveDowntimesRequest,
) -> Result<(), DowntimeError> {
    ensure_enabled()?;
    let folder_id = resolve_folder(org, &req.dst_folder_id).await?;
    let mut rows = Vec::with_capacity(req.downtime_ids.len());
    for id in &req.downtime_ids {
        let row = load(org, id).await?;
        access::authorize_row(org, user_id, &row, "PUT").await?;
        rows.push(row);
    }
    let now = now_micros();
    for row in rows {
        let from = row.folder_id.clone();
        let expected = row.updated_at;
        let moved = Downtime {
            folder_id: folder_id.clone(),
            updated_by: user_id.to_string(),
            updated_at: now,
            ..row
        };
        set_if_unchanged(&moved, expected).await?;
        access::reparent(&moved.id, &from, &folder_id).await;
    }
    Ok(())
}

pub async fn preview(
    org: &str,
    user_id: &str,
    req: &PreviewRequest,
) -> Result<PreviewResponse, DowntimeError> {
    ensure_enabled()?;
    let condition = req.condition.as_ref().map(normalized_condition);
    let inventory = inventory::load(org).await?;
    let matches = matching::match_all(&inventory, condition.as_ref(), &req.targets);
    let visibility = access::visibility(org, user_id).await?;
    Ok(matching::to_preview(&matches, &visibility))
}

pub async fn resources(
    org: &str,
    user_id: &str,
    req: &ResourcesRequest,
) -> Result<ResourcesResponse, DowntimeError> {
    ensure_enabled()?;
    resources::resources(org, user_id, req).await
}

/// Counts of what a downtime covers today, cached for a minute per row version.
pub async fn match_counts(downtime: &Downtime) -> Result<MatchCounts, DowntimeError> {
    let inventory = inventory::cached(&downtime.org).await?;
    Ok(counts_of(&match_counts_with(downtime, &inventory)))
}

/// One banner for all active downtimes with `show_banner` (D19), and the next instant the set
/// changes.
pub async fn banners_for_org(
    org: &str,
    now: i64,
) -> Result<(Vec<Banner>, Option<i64>), DowntimeError> {
    let rows = db::downtimes::list_cached(org);
    let live: Vec<&Downtime> = rows
        .iter()
        .filter(|row| row.show_banner && row.cancelled_at.is_none())
        .collect();
    let windows: Vec<(&Downtime, DowntimeWindow)> = live
        .iter()
        .filter_map(|row| schedule::window_at(&row.schedule, now).map(|w| (*row, w)))
        .collect();
    let mut active = Vec::with_capacity(windows.len());
    if !windows.is_empty() {
        let inventory = inventory::cached(org).await?;
        for (row, window) in windows {
            let matches = match_counts_with(row, &inventory);
            active.push(ActiveWindow {
                row,
                window,
                matches,
            });
        }
    }
    Ok((
        combined_banner(&active).into_iter().collect(),
        next_banner_boundary(&live, now),
    ))
}

/// The downtime folders the user may LIST; the folder list route lets every caller through.
pub async fn listable_folders(org: &str, user_id: &str, folders: Vec<Folder>) -> Vec<Folder> {
    let ids = folders
        .iter()
        .map(|f| f.folder_id.clone())
        .collect::<Vec<_>>();
    let allowed = access::retain_listable_folders(org, user_id, ids).await;
    folders
        .into_iter()
        .filter(|f| allowed.contains(&f.folder_id))
        .collect()
}

/// A concurrent edit, cancel or delete since `expected_updated_at` makes this write a 409.
async fn set_if_unchanged(
    downtime: &Downtime,
    expected_updated_at: i64,
) -> Result<(), DowntimeError> {
    if db::downtimes::set_if_unchanged(downtime, expected_updated_at).await? {
        Ok(())
    } else {
        Err(DowntimeError::Conflict(
            "The downtime changed while you were editing it. Reload and try again.".to_string(),
        ))
    }
}

async fn load(org: &str, id: &str) -> Result<Downtime, DowntimeError> {
    infra::table::downtimes::get(org, id)
        .await?
        .ok_or(DowntimeError::NotFound)
}

/// An unknown folder is a 400; the default folder is created on first use.
async fn resolve_folder(org: &str, folder_id: &str) -> Result<String, DowntimeError> {
    let folder_id = if folder_id.trim().is_empty() {
        DEFAULT_FOLDER
    } else {
        folder_id
    };
    if folder_id == DEFAULT_FOLDER {
        db::folders::ensure_default_folder(org, FolderType::Downtimes)
            .await
            .map_err(|e| DowntimeError::Internal(e.to_string()))?;
        return Ok(DEFAULT_FOLDER.to_string());
    }
    if infra::table::folders::exists(org, folder_id, FolderType::Downtimes).await? {
        Ok(folder_id.to_string())
    } else {
        Err(DowntimeError::BadRequest(format!(
            "Downtime folder {folder_id} does not exist."
        )))
    }
}

/// Validates, normalizes as stored, then checks what the user may silence (WP6).
async fn checked_request(
    org: &str,
    user_id: &str,
    mut req: DowntimeRequest,
) -> Result<DowntimeRequest, DowntimeError> {
    let groups = db::system_settings::get_semantic_field_groups(org).await;
    validate(&req, &groups).map_err(DowntimeError::BadRequest)?;
    req.condition = req.condition.as_ref().map(normalized_condition);
    for target in &mut req.targets {
        target.tags = config::meta::alerts::tags::normalize_tags(&target.tags)
            .map_err(|e| DowntimeError::BadRequest(format!("{e}.")))?;
    }
    let inventory = inventory::load(org).await?;
    access::check_targets(org, user_id, &req.targets, &inventory).await?;
    Ok(req)
}

/// Pair values are stored the way ownership rules are, so evaluation needs no case folding.
fn normalized_condition(cond: &DimensionCondition) -> DimensionCondition {
    match cond {
        DimensionCondition::Group { op, items } => DimensionCondition::Group {
            op: *op,
            items: items.iter().map(normalized_condition).collect(),
        },
        DimensionCondition::Pair {
            key,
            operator,
            value,
        } => DimensionCondition::Pair {
            key: key.trim().to_string(),
            operator: *operator,
            value: normalize_value(value),
        },
    }
}

fn name_of(req: &DowntimeRequest, now: i64) -> String {
    req.name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| generated_name(req, now))
}

/// A row that corrected SLO slices must outlive them, so it can be cancelled but not deleted.
fn check_deletable(row: &Downtime, now: i64) -> Result<(), DowntimeError> {
    let status = schedule::status(&row.schedule, row.cancelled_at, now);
    if matches!(
        status,
        config::meta::downtimes::DowntimeStatus::Active
            | config::meta::downtimes::DowntimeStatus::Scheduled
    ) {
        return Err(DowntimeError::Conflict(
            "This downtime is active or scheduled. Cancel it first.".to_string(),
        ));
    }
    let corrected = scope::target_for(&row.targets, TargetModule::Slos).is_some()
        && !schedule::windows_between(&row.schedule, row.cancelled_at, 0, now).is_empty();
    if corrected {
        return Err(DowntimeError::Conflict(
            "This downtime corrected SLO slices. Cancel it instead. Retention removes it after the SLO window has passed."
                .to_string(),
        ));
    }
    Ok(())
}

/// A coverage edit drops the Muted chips recorded under the row until firings record them again.
async fn forget_recorded_mutes(id: &str) {
    if let Err(e) = infra::table::alert_states::clear_last_downtime_id(id).await {
        log::warn!("[downtimes] could not clear the recorded mutes of {id}: {e}");
    }
}

/// Re-measures the slices a change touched on the SLO backfill lane (WP11).
fn remeasure_slos(before: Option<Downtime>, after: &Downtime) {
    let has_slos = |d: &Downtime| scope::target_for(&d.targets, TargetModule::Slos).is_some();
    if !has_slos(after) && !before.as_ref().is_some_and(has_slos) {
        return;
    }
    let after = after.clone();
    tokio::spawn(async move {
        if let Err(e) =
            crate::slo::corrections::remeasure_for_downtime(&after.org, before.as_ref(), &after)
                .await
        {
            log::warn!(
                "[DOWNTIMES] SLO re-measure for {}/{} failed: {e}",
                after.org,
                after.id
            );
        }
    });
}

fn matches_of(downtime: &Downtime, inventory: &Inventory) -> Matches {
    matching::match_all(inventory, downtime.condition.as_ref(), &downtime.targets)
}

fn match_counts_with(downtime: &Downtime, inventory: &Inventory) -> Arc<Matches> {
    let cached = MATCH_COUNTS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&downtime.id)
        .filter(|(version, at, _)| {
            *version == downtime.updated_at && at.elapsed() < MATCH_COUNTS_TTL
        })
        .map(|(_, _, matches)| matches.clone());
    if let Some(matches) = cached {
        return matches;
    }
    let matches = Arc::new(matches_of(downtime, inventory));
    let mut cache = MATCH_COUNTS.write().unwrap_or_else(|e| e.into_inner());
    // Expired entries go on every write, so deleted or unlisted ids do not pile up.
    cache.retain(|_, (_, at, _)| at.elapsed() < MATCH_COUNTS_TTL);
    cache.insert(
        downtime.id.clone(),
        (downtime.updated_at, Instant::now(), matches.clone()),
    );
    matches
}

fn counts_of(matches: &Matches) -> MatchCounts {
    MatchCounts {
        alerts: matches.alerts.matched.len(),
        anomalies: matches.anomalies.matched.len(),
        synthetics: matches.synthetics.matched.len(),
        slos: matches.slos.matched.len(),
    }
}

fn list_item(row: &Downtime, counts: &MatchCounts, now: i64) -> DowntimeListItem {
    DowntimeListItem {
        downtime: row.clone(),
        status: schedule::status(&row.schedule, row.cancelled_at, now),
        current_window: row
            .cancelled_at
            .is_none()
            .then(|| schedule::window_at(&row.schedule, now))
            .flatten(),
        next_window: row
            .cancelled_at
            .is_none()
            .then(|| schedule::next_window(&row.schedule, now))
            .flatten(),
        matched_alerts: counts.alerts,
        matched_anomalies: counts.anomalies,
        matched_synthetics: counts.synthetics,
        matched_slos: counts.slos,
    }
}

/// The id names every active row and window, so a dismissal lasts until that set changes.
fn combined_banner(active: &[ActiveWindow]) -> Option<Banner> {
    let mut keys: Vec<String> = active
        .iter()
        .map(|a| format!("{}:{}", a.row.id, a.window.start))
        .collect();
    keys.sort();
    let id = format!("downtime:{}", keys.join(","));
    let (message, cta, per_module) = match active {
        [] => return None,
        [one] => {
            let counts = counts_of(&one.matches);
            let per_module: Vec<(TargetModule, usize)> = one
                .row
                .targets
                .iter()
                .map(|t| (t.module, counts.of(t.module)))
                .collect();
            let cta = BannerCta {
                text: "View downtime".to_string(),
                url: format!("/web/downtimes/{}", one.row.id),
            };
            (banner_message(&one.row.name, &per_module), cta, per_module)
        }
        many => {
            let per_module = merged_counts(many);
            let cta = BannerCta {
                text: "View downtimes".to_string(),
                url: "/web/downtimes?status=active&scope=all".to_string(),
            };
            (merged_message(many.len(), &per_module), cta, per_module)
        }
    };
    Some(Banner {
        message,
        id: Some(id),
        variant: BannerVariant::Warning,
        starts_at: active.iter().map(|a| a.window.start).min(),
        ends_at: active.iter().map(|a| a.window.end).min(),
        dismissible: true,
        cta: Some(cta),
        orgs: None,
        counts: Some(
            per_module
                .iter()
                .map(|(module, count)| BannerCount {
                    module: module_key(*module).to_string(),
                    count: *count,
                })
                .collect(),
        ),
    })
}

/// Per targeted module, the distinct items muted by any of the rows, so an overlap counts once.
fn merged_counts(active: &[ActiveWindow]) -> Vec<(TargetModule, usize)> {
    MODULE_ORDER
        .into_iter()
        .filter(|m| {
            active
                .iter()
                .any(|a| a.row.targets.iter().any(|t| t.module == *m))
        })
        .map(|m| {
            let ids: HashSet<&str> = active
                .iter()
                .flat_map(|a| a.matches.module(m).matched.iter().map(|x| x.id.as_str()))
                .collect();
            (m, ids.len())
        })
        .collect()
}

fn merged_message(active: usize, per_module: &[(TargetModule, usize)]) -> String {
    let subject = format!("{active} downtimes");
    // `banner_message` words its subject as a single downtime.
    banner_message(&subject, per_module).replacen(
        &format!("{subject} is active."),
        &format!("{subject} are active."),
        1,
    )
}

/// The nearest window start or end after `now` among the rows that show a banner.
fn next_banner_boundary(rows: &[&Downtime], now: i64) -> Option<i64> {
    rows.iter()
        .flat_map(|row| {
            let current_end = schedule::window_at(&row.schedule, now).map(|w| w.end);
            let next_start = schedule::next_window(&row.schedule, now).map(|w| w.start);
            [current_end, next_start]
        })
        .flatten()
        .filter(|at| *at > now)
        .min()
}

fn module_key(module: TargetModule) -> &'static str {
    match module {
        TargetModule::Alerts => "alerts",
        TargetModule::AnomalyDetections => "anomaly_detections",
        TargetModule::Synthetics => "synthetics",
        TargetModule::Slos => "slos",
    }
}

fn affected(matches: &Matches, visibility: &Visibility) -> AffectedItems {
    let visible = |module: TargetModule, list: &[PreviewMatch]| -> Vec<PreviewMatch> {
        list.iter()
            .filter(|m| visibility.sees(module, &m.folder_id))
            .take(AFFECTED_CAP)
            .cloned()
            .collect()
    };
    AffectedItems {
        alerts: visible(TargetModule::Alerts, &matches.alerts.matched),
        resolved_at_fire_time: visible(TargetModule::Alerts, &matches.alerts.at_fire_time),
        anomalies: visible(TargetModule::AnomalyDetections, &matches.anomalies.matched),
        synthetics: visible(TargetModule::Synthetics, &matches.synthetics.matched),
        slos: visible(TargetModule::Slos, &matches.slos.matched),
    }
}

#[cfg(test)]
mod tests {
    use config::meta::downtimes::{
        DowntimeSchedule, DowntimeTarget, LogicalOp, PairOperator, Repeat, TargetFolders,
    };

    use super::{matching::ModuleMatch, *};

    const HOUR: i64 = 3_600_000_000;

    fn row(targets: Vec<TargetModule>, start: i64, end: i64) -> Downtime {
        Downtime {
            id: "d1".to_string(),
            org: "acme".to_string(),
            folder_id: "default".to_string(),
            name: "d1".to_string(),
            reason: None,
            condition: None,
            targets: targets
                .into_iter()
                .map(|module| DowntimeTarget {
                    module,
                    folders: TargetFolders::All,
                    tags: vec![],
                    ids: vec![],
                    slo_mode: None,
                })
                .collect(),
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: start,
                ends_at: Some(end),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: (end - start) / 1_000_000,
                weekdays: vec![],
            },
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            created_by: "lin".to_string(),
            created_at: 0,
            updated_by: "lin".to_string(),
            updated_at: 0,
        }
    }

    #[test]
    fn an_active_or_scheduled_row_cannot_be_deleted() {
        let d = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        assert!(matches!(
            check_deletable(&d, 11 * HOUR),
            Err(DowntimeError::Conflict(_))
        ));
        assert!(matches!(
            check_deletable(&d, 9 * HOUR),
            Err(DowntimeError::Conflict(_))
        ));
        assert!(check_deletable(&d, 13 * HOUR).is_ok());
    }

    #[test]
    fn a_row_that_corrected_slices_cannot_be_deleted_but_one_cancelled_before_its_window_can() {
        let ran = row(vec![TargetModule::Slos], 10 * HOUR, 12 * HOUR);
        let err = check_deletable(&ran, 13 * HOUR).unwrap_err();
        assert!(err.to_string().contains("corrected SLO slices"));

        let mut never_ran = row(vec![TargetModule::Slos], 10 * HOUR, 12 * HOUR);
        never_ran.cancelled_at = Some(9 * HOUR);
        assert!(check_deletable(&never_ran, 13 * HOUR).is_ok());
    }

    #[test]
    fn pair_values_are_normalized_like_ownership_rules() {
        let cond = DimensionCondition::Group {
            op: LogicalOp::And,
            items: vec![DimensionCondition::Pair {
                key: " service ".to_string(),
                operator: PairOperator::Eq,
                value: " Payments ".to_string(),
            }],
        };
        assert_eq!(
            normalized_condition(&cond),
            DimensionCondition::Group {
                op: LogicalOp::And,
                items: vec![DimensionCondition::Pair {
                    key: "service".to_string(),
                    operator: PairOperator::Eq,
                    value: "payments".to_string(),
                }],
            }
        );
    }

    #[test]
    fn an_empty_name_is_generated() {
        let d = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        let req = DowntimeRequest {
            folder_id: "default".to_string(),
            name: Some("  ".to_string()),
            reason: None,
            condition: None,
            targets: d.targets.clone(),
            schedule: d.schedule.clone(),
            show_banner: false,
        };
        assert_eq!(name_of(&req, 0), "All alerts · once 1 Jan");
        let named = DowntimeRequest {
            name: Some(" CDN cutover ".to_string()),
            ..req
        };
        assert_eq!(name_of(&named, 0), "CDN cutover");
    }

    fn matched(ids: &[&str]) -> ModuleMatch {
        ModuleMatch {
            matched: ids
                .iter()
                .map(|id| PreviewMatch {
                    id: (*id).to_string(),
                    name: (*id).to_string(),
                    folder_id: "default".to_string(),
                    matched_by: None,
                    missing: None,
                })
                .collect(),
            ..Default::default()
        }
    }

    fn window(start: i64, end: i64) -> DowntimeWindow {
        DowntimeWindow { start, end }
    }

    #[test]
    fn one_active_downtime_gets_its_own_banner_whose_id_changes_per_window() {
        let d = row(
            vec![TargetModule::Alerts, TargetModule::Slos],
            10 * HOUR,
            12 * HOUR,
        );
        let matches = Arc::new(Matches {
            alerts: matched(&["a1", "a2", "a3", "a4", "a5", "a6", "a7"]),
            slos: matched(&["s1", "s2", "s3"]),
            ..Default::default()
        });
        let active = [ActiveWindow {
            row: &d,
            window: window(10 * HOUR, 12 * HOUR),
            matches: matches.clone(),
        }];
        let banner = combined_banner(&active).unwrap();
        assert_eq!(
            banner.message,
            "d1 is active. 7 alerts and 3 SLOs are muted."
        );
        assert_eq!(banner.variant, BannerVariant::Warning);
        assert_eq!(banner.ends_at, Some(12 * HOUR));
        assert_eq!(banner.id.as_deref(), Some("downtime:d1:36000000000"));
        assert_eq!(banner.cta.unwrap().url, "/web/downtimes/d1");
        assert_eq!(
            banner.counts.unwrap(),
            vec![
                BannerCount {
                    module: "alerts".to_string(),
                    count: 7
                },
                BannerCount {
                    module: "slos".to_string(),
                    count: 3
                },
            ]
        );
        let next = [ActiveWindow {
            row: &d,
            window: window(34 * HOUR, 36 * HOUR),
            matches,
        }];
        assert_ne!(
            combined_banner(&next).unwrap().id,
            Some("downtime:d1:36000000000".to_string())
        );
    }

    #[test]
    fn no_active_downtime_gets_no_banner() {
        assert!(combined_banner(&[]).is_none());
    }

    #[test]
    fn several_active_downtimes_share_one_banner_with_distinct_counts_and_the_soonest_end() {
        let d1 = row(vec![TargetModule::Alerts], 10 * HOUR, 14 * HOUR);
        let mut d2 = row(
            vec![TargetModule::Alerts, TargetModule::Synthetics],
            9 * HOUR,
            12 * HOUR,
        );
        d2.id = "d2".to_string();
        let mut d3 = row(vec![TargetModule::Alerts], 11 * HOUR, 20 * HOUR);
        d3.id = "d3".to_string();
        let active = [
            ActiveWindow {
                row: &d3,
                window: window(11 * HOUR, 20 * HOUR),
                matches: Arc::new(Matches {
                    alerts: matched(&["a1"]),
                    ..Default::default()
                }),
            },
            ActiveWindow {
                row: &d1,
                window: window(10 * HOUR, 14 * HOUR),
                matches: Arc::new(Matches {
                    alerts: matched(&["a1", "a2", "a3"]),
                    ..Default::default()
                }),
            },
            ActiveWindow {
                row: &d2,
                window: window(9 * HOUR, 12 * HOUR),
                matches: Arc::new(Matches {
                    alerts: matched(&["a2", "a4"]),
                    synthetics: matched(&["c1", "c2"]),
                    ..Default::default()
                }),
            },
        ];
        let banner = combined_banner(&active).unwrap();
        assert_eq!(
            banner.message,
            "3 downtimes are active. 4 alerts and 2 synthetics checks are muted."
        );
        assert_eq!(banner.ends_at, Some(12 * HOUR));
        assert_eq!(banner.starts_at, Some(9 * HOUR));
        assert_eq!(
            banner.id.as_deref(),
            Some("downtime:d1:36000000000,d2:32400000000,d3:39600000000")
        );
        let cta = banner.cta.unwrap();
        assert_eq!(cta.text, "View downtimes");
        assert_eq!(cta.url, "/web/downtimes?status=active&scope=all");
        assert_eq!(
            banner.counts.unwrap(),
            vec![
                BannerCount {
                    module: "alerts".to_string(),
                    count: 4
                },
                BannerCount {
                    module: "synthetics".to_string(),
                    count: 2
                },
            ]
        );
        let ended_early = combined_banner(&active[..2]).unwrap();
        assert_ne!(
            ended_early.id,
            Some("downtime:d1:36000000000,d2:32400000000,d3:39600000000".to_string())
        );
        assert_eq!(
            ended_early.message,
            "2 downtimes are active. 3 alerts are muted."
        );
    }

    #[test]
    fn the_next_boundary_is_the_nearest_start_or_end() {
        let active = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        let mut later = row(vec![TargetModule::Alerts], 11 * HOUR, 20 * HOUR);
        later.id = "d2".to_string();
        let mut past = row(vec![TargetModule::Alerts], HOUR, 2 * HOUR);
        past.id = "d3".to_string();
        assert_eq!(
            next_banner_boundary(&[&active, &later, &past], 10 * HOUR + 1),
            Some(11 * HOUR)
        );
        assert_eq!(
            next_banner_boundary(&[&active], 10 * HOUR + 1),
            Some(12 * HOUR)
        );
        assert_eq!(next_banner_boundary(&[&past], 10 * HOUR), None);
    }

    #[test]
    fn a_list_item_has_no_windows_once_cancelled() {
        let mut d = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        let live = list_item(&d, &MatchCounts::default(), 11 * HOUR);
        assert!(live.current_window.is_some());
        d.cancelled_at = Some(10 * HOUR + 1);
        let cancelled = list_item(&d, &MatchCounts::default(), 11 * HOUR);
        assert!(cancelled.current_window.is_none());
        assert!(cancelled.next_window.is_none());
    }

    fn folder(id: &str) -> Folder {
        Folder {
            folder_id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            icon: None,
        }
    }

    #[tokio::test]
    async fn root_lists_every_downtime_folder() {
        let root = "root-downtime-folders@example.com";
        crate::common::infra::config::ORG_USERS.insert(
            format!("{}/{root}", config::DEFAULT_ORG),
            infra::table::org_users::OrgUserRecord {
                role: config::meta::user::UserRole::Root,
                token: String::new(),
                rum_token: None,
                org_id: config::DEFAULT_ORG.to_string(),
                email: root.to_string(),
                created_at: 0,
                allow_static_token: false,
            },
        );
        let kept =
            listable_folders("acme", root, vec![folder("default"), folder("payments")]).await;
        let ids: Vec<_> = kept.iter().map(|f| f.folder_id.as_str()).collect();
        assert_eq!(ids, ["default", "payments"]);
        assert!(listable_folders("acme", root, vec![]).await.is_empty());
    }
}
