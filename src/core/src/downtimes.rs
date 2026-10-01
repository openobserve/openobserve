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
    collections::HashMap,
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant},
};

use config::{
    meta::{
        downtimes::{
            AffectedItems, DimensionCondition, Downtime, DowntimeDetail, DowntimeListItem,
            DowntimeRequest, MoveDowntimesRequest, PreviewMatch, PreviewRequest, PreviewResponse,
            ResourcesRequest, ResourcesResponse, TargetModule,
        },
        folder::{DEFAULT_FOLDER, FolderType},
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
    db::downtimes::set(&after).await?;
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
    db::downtimes::set(&after).await?;
    remeasure_slos(Some(before), &after);
    Ok(after)
}

pub async fn delete(org: &str, user_id: &str, id: &str) -> Result<(), DowntimeError> {
    ensure_enabled()?;
    let row = load(org, id).await?;
    access::authorize_row(org, user_id, &row, "DELETE").await?;
    check_deletable(&row, now_micros())?;
    db::downtimes::delete(org, id).await?;
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
        let moved = Downtime {
            folder_id: folder_id.clone(),
            updated_by: user_id.to_string(),
            updated_at: now,
            ..row
        };
        db::downtimes::set(&moved).await?;
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
    req: &ResourcesRequest,
) -> Result<ResourcesResponse, DowntimeError> {
    ensure_enabled()?;
    resources::resources(org, req).await
}

/// Counts of what a downtime covers today, cached for a minute per row version.
pub async fn match_counts(downtime: &Downtime) -> Result<MatchCounts, DowntimeError> {
    let inventory = inventory::cached(&downtime.org).await?;
    Ok(counts_of(&match_counts_with(downtime, &inventory)))
}

/// One banner per active downtime with `show_banner` (D19), and the next instant the set changes.
pub async fn banners_for_org(
    org: &str,
    now: i64,
) -> Result<(Vec<Banner>, Option<i64>), DowntimeError> {
    let rows = db::downtimes::list_cached(org);
    let live: Vec<&Downtime> = rows
        .iter()
        .filter(|row| row.show_banner && row.cancelled_at.is_none())
        .collect();
    let mut banners = Vec::new();
    for row in &live {
        if let Some(window) = schedule::window_at(&row.schedule, now) {
            let counts = match_counts(row).await?;
            banners.push(banner_of(row, &window, &counts));
        }
    }
    Ok((banners, next_banner_boundary(&live, now)))
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

/// The id changes per window, so a dismissal lasts for this window only.
fn banner_of(
    row: &Downtime,
    window: &config::meta::downtimes::DowntimeWindow,
    counts: &MatchCounts,
) -> Banner {
    let per_module: Vec<(TargetModule, usize)> = row
        .targets
        .iter()
        .map(|t| (t.module, counts.of(t.module)))
        .collect();
    Banner {
        message: banner_message(&row.name, &per_module),
        id: Some(format!("downtime:{}:{}", row.id, window.start)),
        variant: BannerVariant::Warning,
        starts_at: Some(window.start),
        ends_at: Some(window.end),
        dismissible: true,
        cta: Some(BannerCta {
            text: "View downtime".to_string(),
            url: format!("/web/downtimes/{}", row.id),
        }),
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
    }
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

    use super::*;

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

    #[test]
    fn a_banner_names_the_downtime_and_counts_and_its_id_changes_per_window() {
        let d = row(
            vec![TargetModule::Alerts, TargetModule::Slos],
            10 * HOUR,
            12 * HOUR,
        );
        let counts = MatchCounts {
            alerts: 7,
            slos: 3,
            ..Default::default()
        };
        let first = config::meta::downtimes::DowntimeWindow {
            start: 10 * HOUR,
            end: 12 * HOUR,
        };
        let banner = banner_of(&d, &first, &counts);
        assert_eq!(
            banner.message,
            "d1 is active. 7 alerts and 3 SLOs are muted."
        );
        assert_eq!(banner.variant, BannerVariant::Warning);
        assert_eq!(banner.ends_at, Some(12 * HOUR));
        assert_eq!(banner.id.as_deref(), Some("downtime:d1:36000000000"));
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
        let next = config::meta::downtimes::DowntimeWindow {
            start: 34 * HOUR,
            end: 36 * HOUR,
        };
        assert_ne!(
            banner_of(&d, &next, &counts).id,
            Some("downtime:d1:36000000000".to_string())
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
}
