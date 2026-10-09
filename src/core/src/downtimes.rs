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
pub mod notify;
pub mod resources;
pub mod values;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant},
};

use config::{
    meta::{
        downtimes::{
            AffectedItems, DimensionCondition, Downtime, DowntimeDetail, DowntimeListItem,
            DowntimeNotifications, DowntimeRequest, DowntimeSchedule, DowntimeStatus,
            DowntimeWindow, ExtendDowntimeRequest, ExtendDowntimeResponse, MoveDowntimesRequest,
            NotificationEvent, PreviewMatch, PreviewRequest, PreviewResponse, Repeat,
            ResourcesRequest, ResourcesResponse, TargetModule, ValuesRequest, ValuesResponse,
        },
        folder::{DEFAULT_FOLDER, Folder, FolderType},
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::{
    announcements::meta::{Banner, BannerCount, BannerCta, BannerVariant},
    common::config::get_config as get_o2_config,
    downtimes::{
        MAX_NAME_LEN, MAX_NOTIFY_DESTINATIONS, banner_message, generated_name, schedule, scope,
        validate, validate_notifications,
    },
    oncall::routing::normalize_value,
};
use serde::Serialize;
use utoipa::ToSchema;

pub use self::listing::{ListQuery, ListResponse};
use self::{
    matching::{Inventory, Matches, Visibility},
    notify::DueEvent,
};

/// Match counts are recomputed at most this often per downtime.
const MATCH_COUNTS_TTL: Duration = Duration::from_secs(60);
/// The `affected` lists of `GET /{id}` stop at this many names per module.
const AFFECTED_CAP: usize = 500;
/// A move takes at most this many ids, each a write and an authorization check.
const MAX_MOVE_IDS: usize = 100;
const MICROS_PER_SEC: i64 = 1_000_000;
/// Appended to the name of the one-time row that extends a recurring one.
const EXTENDED_SUFFIX: &str = " (extended)";
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
    let rows = db::downtimes::list_cached(org);
    let outside: Vec<(String, String)> = rows
        .iter()
        .filter(|row| !folders.contains(&row.folder_id))
        .map(|row| (row.id.clone(), row.folder_id.clone()))
        .collect();
    let granted = access::individually_readable(org, user_id, outside).await;
    let items = rows
        .iter()
        .filter(|row| folders.contains(&row.folder_id) || granted.contains(&row.id))
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
        notification_log: notify::log_for(org, id).await?,
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
    check_room(org)?;
    let mut downtime = created(org, folder_id, &req, user_id, now_micros());
    downtime.notifications = with_continues(req.notifications.clone(), None);
    downtime.origin_region = origin_region();
    db::downtimes::set(&downtime).await?;
    db::authz::set_ownership(org, "downtimes", db::downtimes::ownership(&downtime)).await;
    remeasure_slos(None, &downtime).await;
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
    let continues = before
        .notifications
        .as_ref()
        .and_then(|n| n.continues.clone());
    let notifications = with_continues(req.notifications.clone(), continues);
    let mut after = edited(&before, req, user_id, now_micros());
    after.notifications = notifications;
    set_if_unchanged(&after, before.updated_at).await?;
    if !before.same_coverage(&after) {
        forget_recorded_mutes(&after.id).await;
    }
    remeasure_slos(Some(&before), &after).await;
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
    let after = cancelled(&before, user_id, now);
    set_if_unchanged(&after, before.updated_at).await?;
    if let Some(window) = cancelled_window(&before, now) {
        notify::deliver_in_background(
            after.clone(),
            DueEvent::of_window(NotificationEvent::Cancelled, window),
        );
    }
    remeasure_slos(Some(&before), &after).await;
    Ok(after)
}

/// Lengthens the active window; a recurring row gets a one-time follow-up instead.
pub async fn extend(
    org: &str,
    user_id: &str,
    id: &str,
    req: &ExtendDowntimeRequest,
) -> Result<ExtendDowntimeResponse, DowntimeError> {
    ensure_enabled()?;
    let before = load(org, id).await?;
    access::authorize_row(org, user_id, &before, "PUT").await?;
    let now = now_micros();
    let window = extendable_window(&before, now)?;
    let new_end = extended_end(window.end, req, now)?;
    if before.schedule.repeat == Repeat::None {
        let after = extended_once(&before, new_end, user_id, now);
        checked_request(org, user_id, request_of(&after)).await?;
        set_if_unchanged(&after, before.updated_at).await?;
        notify::deliver_in_background(after.clone(), extended_event(window.start, new_end));
        remeasure_slos(Some(&before), &after).await;
        return Ok(ExtendDowntimeResponse {
            downtime: after,
            created_id: None,
        });
    }
    if !crate::auth::check_folder_write_permissions(
        org,
        user_id,
        "downtime_folders",
        &before.folder_id,
    )
    .await
    {
        return Err(DowntimeError::Forbidden(
            "Extending a recurring downtime creates a new one, and you cannot create downtimes in its folder."
                .to_string(),
        ));
    }
    let follow_up = follow_up(&before, window.end, new_end, user_id, now);
    checked_request(org, user_id, request_of(&follow_up)).await?;
    check_room(org)?;
    if !db::downtimes::set_if_parent_unchanged(&follow_up, &before.id, before.updated_at).await? {
        return Err(changed_meanwhile());
    }
    db::authz::set_ownership(org, "downtimes", db::downtimes::ownership(&follow_up)).await;
    notify::deliver_in_background(before.clone(), extended_event(window.start, new_end));
    remeasure_slos(None, &follow_up).await;
    Ok(ExtendDowntimeResponse {
        created_id: Some(follow_up.id.clone()),
        downtime: follow_up,
    })
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

/// One `set_if_unchanged` per row, so every node and region sees it; this node reloads once.
pub async fn move_to_folder(
    org: &str,
    user_id: &str,
    req: &MoveDowntimesRequest,
) -> Result<(), DowntimeError> {
    ensure_enabled()?;
    let ids = move_ids(&req.downtime_ids)?;
    let folder_id = resolve_folder(org, &req.dst_folder_id).await?;
    let mut rows = Vec::with_capacity(ids.len());
    for id in ids {
        let row = load(org, id).await?;
        access::authorize_row(org, user_id, &row, "PUT").await?;
        rows.push(row);
    }
    let now = now_micros();
    let froms: Vec<String> = rows.iter().map(|row| row.folder_id.clone()).collect();
    let moves: Vec<(Downtime, i64)> = rows
        .into_iter()
        .map(|row| (moved(&row, &folder_id, user_id, now), row.updated_at))
        .collect();
    let (written, outcome) = write_moves(
        &moves,
        async |moved, expected| Ok(db::downtimes::write_if_unchanged(moved, expected).await?),
        async || Ok(db::downtimes::reload_org(org).await?),
    )
    .await;
    for ((moved, _), from) in moves.iter().zip(&froms).take(written) {
        access::reparent(&moved.id, from, &folder_id).await;
    }
    outcome
}

pub async fn preview(
    org: &str,
    user_id: &str,
    req: &PreviewRequest,
) -> Result<PreviewResponse, DowntimeError> {
    ensure_enabled()?;
    check_preview(
        req,
        &db::system_settings::get_semantic_field_groups(org).await,
    )?;
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

pub async fn values(
    org: &str,
    user_id: &str,
    req: &ValuesRequest,
) -> Result<ValuesResponse, DowntimeError> {
    ensure_enabled()?;
    values::values(org, user_id, req).await
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
    // The org inventory is read only for a row whose counts are not cached at its version.
    let mut inventory = None;
    for (row, window) in windows {
        let matches = match cached_matches(row) {
            Some(matches) => matches,
            None => {
                let inventory = match &inventory {
                    Some(inventory) => Arc::clone(inventory),
                    None => inventory.insert(inventory::cached(org).await?).clone(),
                };
                match_counts_with(row, &inventory)
            }
        };
        active.push(ActiveWindow {
            row,
            window,
            matches,
        });
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

/// Replicated rows answer this, so every region sees that a follow-up continues `parent`'s window.
pub fn continues_window(follow_up: &Downtime, parent: &Downtime, window_end: i64, at: i64) -> bool {
    let continues = follow_up
        .notifications
        .as_ref()
        .and_then(|n| n.continues.as_deref());
    follow_up.org == parent.org
        && continues == Some(parent.id.as_str())
        && schedule::window_at(&follow_up.schedule, window_end).is_some()
        && follow_up
            .cancelled_at
            .is_none_or(|cancelled| cancelled > at)
}

/// A concurrent edit, cancel or delete since `expected_updated_at` makes this write a 409.
async fn set_if_unchanged(
    downtime: &Downtime,
    expected_updated_at: i64,
) -> Result<(), DowntimeError> {
    if db::downtimes::set_if_unchanged(downtime, expected_updated_at).await? {
        Ok(())
    } else {
        Err(changed_meanwhile())
    }
}

fn changed_meanwhile() -> DowntimeError {
    DowntimeError::Conflict(
        "The downtime changed while you were editing it. Reload and try again.".to_string(),
    )
}

/// Writes the moves in order up to the first conflict, then reloads once; returns how many landed.
async fn write_moves(
    moves: &[(Downtime, i64)],
    mut write: impl AsyncFnMut(&Downtime, i64) -> Result<bool, DowntimeError>,
    reload: impl AsyncFnOnce() -> Result<(), DowntimeError>,
) -> (usize, Result<(), DowntimeError>) {
    let mut written = 0;
    let mut outcome = Ok(());
    for (moved, expected) in moves {
        match write(moved, *expected).await {
            Ok(true) => written += 1,
            Ok(false) => {
                outcome = Err(changed_meanwhile());
                break;
            }
            Err(e) => {
                outcome = Err(e);
                break;
            }
        }
    }
    let reloaded = reload().await;
    (written, outcome.and(reloaded))
}

/// The ids of a move, deduplicated in request order; more than [MAX_MOVE_IDS] is a 400.
fn move_ids(ids: &[String]) -> Result<Vec<&str>, DowntimeError> {
    if ids.len() > MAX_MOVE_IDS {
        return Err(DowntimeError::BadRequest(format!(
            "A move takes at most {MAX_MOVE_IDS} downtimes at a time."
        )));
    }
    let mut seen = HashSet::new();
    Ok(ids
        .iter()
        .map(String::as_str)
        .filter(|id| seen.insert(*id))
        .collect())
}

/// A preview has no schedule, so a valid placeholder lets `validate` check targets and condition.
fn check_preview(
    req: &PreviewRequest,
    groups: &[config::meta::correlation::FieldAlias],
) -> Result<(), DowntimeError> {
    let placeholder = DowntimeRequest {
        folder_id: DEFAULT_FOLDER.to_string(),
        name: None,
        reason: None,
        condition: req.condition.clone(),
        targets: req.targets.clone(),
        schedule: config::meta::downtimes::DowntimeSchedule {
            repeat: config::meta::downtimes::Repeat::None,
            starts_at: 0,
            ends_at: Some(3600 * 1_000_000),
            timezone: "UTC".to_string(),
            start_time_local: None,
            duration_secs: 3600,
            weekdays: vec![],
        },
        show_banner: false,
        notifications: None,
    };
    validate(&placeholder, groups).map_err(DowntimeError::BadRequest)
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

fn check_room(org: &str) -> Result<(), DowntimeError> {
    let limit = get_o2_config().downtimes.max_per_org;
    if db::downtimes::list_cached(org).len() >= limit {
        return Err(DowntimeError::BadRequest(format!(
            "This organization already has {limit} downtimes, the most allowed. Delete ended ones first."
        )));
    }
    Ok(())
}

/// Validates, normalizes as stored, then checks what the user may silence (WP6).
async fn checked_request(
    org: &str,
    user_id: &str,
    mut req: DowntimeRequest,
) -> Result<DowntimeRequest, DowntimeError> {
    let groups = db::system_settings::get_semantic_field_groups(org).await;
    validate(&req, &groups).map_err(DowntimeError::BadRequest)?;
    span_as_duration(&mut req.schedule);
    if let Some(notifications) = &req.notifications {
        let known = existing_destinations(org, notifications).await?;
        validate_notifications(notifications, &req.schedule, |name| known.contains(name))
            .map_err(DowntimeError::BadRequest)?;
    }
    req.condition = req.condition.as_ref().map(normalized_condition);
    for target in &mut req.targets {
        target.tags = config::meta::alerts::tags::normalize_tags(&target.tags)
            .map_err(|e| DowntimeError::BadRequest(format!("{e}.")))?;
    }
    let inventory = inventory::load(org).await?;
    access::check_targets(org, user_id, &req.targets, &inventory).await?;
    Ok(req)
}

async fn existing_destinations(
    org: &str,
    notifications: &DowntimeNotifications,
) -> Result<HashSet<String>, DowntimeError> {
    let mut known = HashSet::new();
    for name in notifications
        .destinations
        .iter()
        .take(MAX_NOTIFY_DESTINATIONS)
    {
        match db::alerts::destinations::get(org, name).await {
            Ok(dest)
                if matches!(
                    dest.module,
                    config::meta::destinations::Module::Alert { .. }
                ) =>
            {
                known.insert(name.clone());
            }
            Ok(_) | Err(db::alerts::destinations::DestinationError::NotFound) => {}
            Err(e) => return Err(DowntimeError::Internal(e.to_string())),
        }
    }
    Ok(known)
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

/// A one-time window is its span, so the stored `duration_secs` cannot disagree with it.
fn span_as_duration(schedule: &mut config::meta::downtimes::DowntimeSchedule) {
    if schedule.repeat == config::meta::downtimes::Repeat::None
        && let Some(end) = schedule.ends_at
        && let Some(span) = end.checked_sub(schedule.starts_at)
    {
        schedule.duration_secs = span / 1_000_000;
    }
}

/// A new row starts at version 1; replication orders writes by version, not by clocks.
fn created(
    org: &str,
    folder_id: String,
    req: &DowntimeRequest,
    user_id: &str,
    now: i64,
) -> Downtime {
    Downtime {
        id: infra::table::downtimes::new_id(),
        org: org.to_string(),
        folder_id,
        name: name_of(req, now),
        reason: req.reason.clone(),
        condition: req.condition.clone(),
        targets: req.targets.clone(),
        schedule: req.schedule.clone(),
        cancelled_at: None,
        cancelled_by: None,
        show_banner: req.show_banner,
        notifications: None,
        origin_region: None,
        version: 1,
        created_by: user_id.to_string(),
        created_at: now,
        updated_by: user_id.to_string(),
        updated_at: now,
    }
}

fn edited(before: &Downtime, req: DowntimeRequest, user_id: &str, now: i64) -> Downtime {
    Downtime {
        name: name_of(&req, now),
        reason: req.reason,
        condition: req.condition,
        targets: req.targets,
        schedule: req.schedule,
        show_banner: req.show_banner,
        version: before.version + 1,
        updated_by: user_id.to_string(),
        updated_at: now,
        ..before.clone()
    }
}

fn cancelled(before: &Downtime, user_id: &str, now: i64) -> Downtime {
    Downtime {
        cancelled_at: Some(now),
        cancelled_by: Some(user_id.to_string()),
        version: before.version + 1,
        updated_by: user_id.to_string(),
        updated_at: now,
        ..before.clone()
    }
}

fn moved(before: &Downtime, folder_id: &str, user_id: &str, now: i64) -> Downtime {
    Downtime {
        folder_id: folder_id.to_string(),
        version: before.version + 1,
        updated_by: user_id.to_string(),
        updated_at: now,
        ..before.clone()
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

/// The request an edit to `row` would send, so an extension is validated like an edit.
fn request_of(row: &Downtime) -> DowntimeRequest {
    DowntimeRequest {
        folder_id: row.folder_id.clone(),
        name: Some(row.name.clone()),
        reason: row.reason.clone(),
        condition: row.condition.clone(),
        targets: row.targets.clone(),
        schedule: row.schedule.clone(),
        show_banner: row.show_banner,
        notifications: row.notifications.clone(),
    }
}

fn origin_region() -> Option<String> {
    Some(notify::this_region()).filter(|region| !region.is_empty())
}

fn cancelled_window(row: &Downtime, now: i64) -> Option<DowntimeWindow> {
    schedule::window_at(&row.schedule, now)
        .map(|w| DowntimeWindow {
            start: w.start,
            end: now,
        })
        .or_else(|| schedule::next_window(&row.schedule, now))
}

/// Each extension is its own event, so it is keyed by its new end rather than the window start.
fn extended_event(start: i64, new_end: i64) -> DueEvent {
    DueEvent {
        event: NotificationEvent::Extended,
        window: DowntimeWindow {
            start,
            end: new_end,
        },
        key: new_end,
    }
}

/// Always set, even without destinations, because `continues` is what links it to its parent.
fn follow_up_notifications(parent: &Downtime, window_secs: i64) -> DowntimeNotifications {
    let own = parent.notifications.clone().unwrap_or_default();
    let mut events = own.events;
    events.started = false;
    let destinations = if events.any() {
        own.destinations
    } else {
        vec![]
    };
    DowntimeNotifications {
        destinations,
        events,
        ending_soon_lead_secs: own.ending_soon_lead_secs.min(window_secs),
        continues: Some(parent.id.clone()),
    }
}

/// A request never sets `continues`; an edit keeps the one the row was created with.
fn with_continues(
    requested: Option<DowntimeNotifications>,
    continues: Option<String>,
) -> Option<DowntimeNotifications> {
    match (requested, continues) {
        (Some(n), continues) => Some(DowntimeNotifications { continues, ..n }),
        (None, Some(continues)) => Some(DowntimeNotifications {
            continues: Some(continues),
            ..Default::default()
        }),
        (None, None) => None,
    }
}

/// Only a window in force now can be extended; anything else is edited or recreated instead.
fn extendable_window(row: &Downtime, now: i64) -> Result<DowntimeWindow, DowntimeError> {
    let refuse = |m: &str| Err(DowntimeError::BadRequest(m.to_string()));
    match schedule::status(&row.schedule, row.cancelled_at, now) {
        DowntimeStatus::Active => schedule::window_at(&row.schedule, now)
            .map_or_else(|| refuse("This downtime is not in a window now."), Ok),
        DowntimeStatus::Scheduled => {
            refuse("This downtime has not started yet. Edit its schedule instead.")
        }
        DowntimeStatus::Ended => refuse("This downtime has ended and cannot be extended."),
        DowntimeStatus::Cancelled | DowntimeStatus::EndedEarly => {
            refuse("This downtime was cancelled and cannot be extended.")
        }
    }
}

/// `by_secs` counts from the later of the current end and now; `until` must be past both.
fn extended_end(
    current_end: i64,
    req: &ExtendDowntimeRequest,
    now: i64,
) -> Result<i64, DowntimeError> {
    let from = current_end.max(now);
    let bad = |m: &str| DowntimeError::BadRequest(m.to_string());
    match (req.by_secs, req.until) {
        (Some(secs), None) if secs > 0 => secs
            .checked_mul(MICROS_PER_SEC)
            .and_then(|by| from.checked_add(by))
            .ok_or_else(|| bad("The extension is too long.")),
        (Some(_), None) => Err(bad("The extension must be at least one second.")),
        (None, Some(until)) if until > from => Ok(until),
        (None, Some(_)) => Err(bad("The new end must be later than the current end.")),
        _ => Err(bad("Give either by_secs or until.")),
    }
}

fn extended_once(before: &Downtime, new_end: i64, user_id: &str, now: i64) -> Downtime {
    Downtime {
        schedule: DowntimeSchedule {
            ends_at: Some(new_end),
            duration_secs: (new_end - before.schedule.starts_at) / MICROS_PER_SEC,
            ..before.schedule.clone()
        },
        version: before.version + 1,
        updated_by: user_id.to_string(),
        updated_at: now,
        ..before.clone()
    }
}

/// A one-time row from `start` to `end` that covers what `parent` covers, in its folder.
fn follow_up_name(parent: &Downtime) -> String {
    let base: String = parent
        .name
        .chars()
        .take(MAX_NAME_LEN - EXTENDED_SUFFIX.chars().count())
        .collect();
    format!("{}{EXTENDED_SUFFIX}", base.trim_end())
}

fn follow_up(parent: &Downtime, start: i64, end: i64, user_id: &str, now: i64) -> Downtime {
    Downtime {
        id: infra::table::downtimes::new_id(),
        name: follow_up_name(parent),
        schedule: DowntimeSchedule {
            repeat: Repeat::None,
            starts_at: start,
            ends_at: Some(end),
            timezone: parent.schedule.timezone.clone(),
            start_time_local: None,
            duration_secs: (end - start) / MICROS_PER_SEC,
            weekdays: vec![],
        },
        cancelled_at: None,
        cancelled_by: None,
        notifications: Some(follow_up_notifications(
            parent,
            (end - start) / MICROS_PER_SEC,
        )),
        origin_region: parent.origin_region.clone(),
        version: 1,
        created_by: user_id.to_string(),
        created_at: now,
        updated_by: user_id.to_string(),
        updated_at: now,
        ..parent.clone()
    }
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

/// Queues the re-measures before the request answers, so a restart cannot drop them (WP11).
async fn remeasure_slos(before: Option<&Downtime>, after: &Downtime) {
    if !corrections_may_change(before, after) {
        return;
    }
    if let Err(e) = crate::slo::corrections::remeasure_for_downtime(&after.org, before, after).await
    {
        log::warn!(
            "[DOWNTIMES] SLO re-measure for {}/{} failed: {e}",
            after.org,
            after.id
        );
    }
}

/// Only the schedule, the targets with their `slo_mode`, the condition and a cancel move a window.
fn corrections_may_change(before: Option<&Downtime>, after: &Downtime) -> bool {
    let has_slos = |d: &Downtime| scope::target_for(&d.targets, TargetModule::Slos).is_some();
    if !has_slos(after) && !before.is_some_and(has_slos) {
        return false;
    }
    before.is_none_or(|before| {
        before.schedule != after.schedule
            || before.targets != after.targets
            || before.condition != after.condition
            || before.cancelled_at != after.cancelled_at
    })
}

fn matches_of(downtime: &Downtime, inventory: &Inventory) -> Matches {
    matching::match_all(inventory, downtime.condition.as_ref(), &downtime.targets)
}

fn match_counts_with(downtime: &Downtime, inventory: &Inventory) -> Arc<Matches> {
    if let Some(matches) = cached_matches(downtime) {
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

/// The counts cached for this row version, while they are fresh.
fn cached_matches(downtime: &Downtime) -> Option<Arc<Matches>> {
    MATCH_COUNTS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(&downtime.id)
        .filter(|(version, at, _)| {
            *version == downtime.updated_at && at.elapsed() < MATCH_COUNTS_TTL
        })
        .map(|(_, _, matches)| matches.clone())
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
        DowntimeTarget, LogicalOp, NotificationEvents, PairOperator, TargetFolders,
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
                    incident_mode: Default::default(),
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
            notifications: None,
            origin_region: None,
            version: 0,
            created_by: "lin".to_string(),
            created_at: 0,
            updated_by: "lin".to_string(),
            updated_at: 0,
        }
    }

    #[test]
    fn banner_counts_come_from_the_cache_until_the_row_changes() {
        let mut d = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        d.id = "banner-cache".to_string();
        assert!(cached_matches(&d).is_none());
        let counted = match_counts_with(&d, &Inventory::default());
        assert!(Arc::ptr_eq(&cached_matches(&d).unwrap(), &counted));
        d.updated_at += 1;
        assert!(cached_matches(&d).is_none(), "an edit recounts");
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
            notifications: None,
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

    fn by(secs: i64) -> ExtendDowntimeRequest {
        ExtendDowntimeRequest {
            by_secs: Some(secs),
            until: None,
        }
    }

    fn until(at: i64) -> ExtendDowntimeRequest {
        ExtendDowntimeRequest {
            by_secs: None,
            until: Some(at),
        }
    }

    fn daily(start_time: &str, duration_secs: i64) -> Downtime {
        let mut d = row(vec![TargetModule::Alerts, TargetModule::Slos], 0, 0);
        d.name = "Nightly deploy".to_string();
        d.schedule = DowntimeSchedule {
            repeat: Repeat::Daily,
            starts_at: 0,
            ends_at: None,
            timezone: "UTC".to_string(),
            start_time_local: Some(start_time.to_string()),
            duration_secs,
            weekdays: vec![],
        };
        d
    }

    #[test]
    fn a_one_time_extension_moves_the_end_and_remeasures_the_extra_time() {
        let before = row(vec![TargetModule::Slos], 10 * HOUR, 12 * HOUR);
        let now = 11 * HOUR;
        let current = extendable_window(&before, now).unwrap();
        let end = extended_end(current.end, &by(3_600), now).unwrap();
        let after = extended_once(&before, end, "ops", now);
        assert_eq!(after.schedule.ends_at, Some(13 * HOUR));
        assert_eq!(after.schedule.duration_secs, 3 * 3_600);
        assert_eq!(after.schedule.starts_at, before.schedule.starts_at);
        assert_eq!(after.version, before.version + 1);
        assert_eq!((after.updated_by.as_str(), after.updated_at), ("ops", now));
        assert!(validate(&request_of(&after), &[]).is_ok());
        assert!(corrections_may_change(Some(&before), &after));
        assert_eq!(
            schedule::windows_between(&after.schedule, None, 12 * HOUR, 14 * HOUR),
            vec![window(12 * HOUR, 13 * HOUR)]
        );
        let alerts_only = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        assert!(!corrections_may_change(Some(&alerts_only), &alerts_only));
    }

    #[test]
    fn until_sets_the_end_and_must_be_past_the_current_end() {
        assert_eq!(
            extended_end(12 * HOUR, &until(15 * HOUR), 11 * HOUR).unwrap(),
            15 * HOUR
        );
        for req in [
            until(12 * HOUR),
            until(11 * HOUR),
            by(0),
            by(-60),
            ExtendDowntimeRequest::default(),
            ExtendDowntimeRequest {
                by_secs: Some(60),
                until: Some(15 * HOUR),
            },
        ] {
            assert!(
                matches!(
                    extended_end(12 * HOUR, &req, 11 * HOUR),
                    Err(DowntimeError::BadRequest(_))
                ),
                "{req:?}"
            );
        }
        assert!(matches!(
            extended_end(12 * HOUR, &by(i64::MAX), 11 * HOUR),
            Err(DowntimeError::BadRequest(_))
        ));
    }

    #[test]
    fn an_extension_past_seven_days_is_rejected_by_the_edit_rules() {
        let before = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        let end = extended_end(12 * HOUR, &by(7 * 24 * 3_600), 11 * HOUR).unwrap();
        let after = extended_once(&before, end, "ops", 11 * HOUR);
        assert!(validate(&request_of(&after), &[]).is_err());
    }

    #[test]
    fn an_ended_cancelled_or_scheduled_row_cannot_be_extended() {
        let d = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        let refused = |d: &Downtime, now: i64| {
            matches!(extendable_window(d, now), Err(DowntimeError::BadRequest(_)))
        };
        assert!(refused(&d, 13 * HOUR), "ended");
        assert!(refused(&d, 9 * HOUR), "not started");
        let mut ended_early = d.clone();
        ended_early.cancelled_at = Some(11 * HOUR);
        assert!(refused(&ended_early, 11 * HOUR + 1), "ended early");
        let mut cancelled = d.clone();
        cancelled.cancelled_at = Some(9 * HOUR);
        assert!(refused(&cancelled, 11 * HOUR), "cancelled");
        assert_eq!(
            extendable_window(&d, 11 * HOUR).unwrap(),
            window(10 * HOUR, 12 * HOUR)
        );
        let between = daily("02:00", 3_600);
        assert!(refused(&between, 5 * HOUR), "between two windows");
    }

    #[test]
    fn a_recurring_extension_creates_a_follow_up_with_the_same_coverage() {
        let mut parent = daily("02:00", 3_600);
        parent.folder_id = "planned".to_string();
        parent.reason = Some("CHG-9".to_string());
        parent.condition = Some(DimensionCondition::Pair {
            key: "service".to_string(),
            operator: PairOperator::Eq,
            value: "payments".to_string(),
        });
        parent.show_banner = false;
        let now = 2 * HOUR + HOUR / 2;
        let current = extendable_window(&parent, now).unwrap();
        assert_eq!(current.end, 3 * HOUR);
        let end = extended_end(current.end, &by(2 * 3_600), now).unwrap();
        let next = follow_up(&parent, current.end, end, "ops", now);
        assert_ne!(next.id, parent.id);
        assert_eq!(next.name, "Nightly deploy (extended)");
        assert_eq!(next.folder_id, "planned");
        assert_eq!(next.targets, parent.targets);
        assert_eq!(next.condition, parent.condition);
        assert_eq!(next.reason, parent.reason);
        assert!(!next.show_banner);
        assert_eq!(next.schedule.repeat, Repeat::None);
        assert_eq!(next.schedule.starts_at, 3 * HOUR);
        assert_eq!(next.schedule.ends_at, Some(5 * HOUR));
        assert_eq!(next.schedule.duration_secs, 2 * 3_600);
        assert!(next.schedule.start_time_local.is_none());
        assert_eq!(next.created_by, "ops");
        assert_eq!(next.cancelled_at, None);
        let schedule_only = DowntimeRequest {
            condition: None,
            ..request_of(&next)
        };
        assert_eq!(validate(&schedule_only, &[]), Ok(()));
        assert_eq!(
            parent.schedule.duration_secs, 3_600,
            "later windows keep their length"
        );
    }

    #[test]
    fn a_follow_up_name_fits_the_name_limit() {
        let mut parent = daily("02:00", 3_600);
        parent.name = "x".repeat(MAX_NAME_LEN);
        let next = follow_up(&parent, 3 * HOUR, 4 * HOUR, "ops", 0);
        assert_eq!(next.name.chars().count(), MAX_NAME_LEN);
        assert!(next.name.ends_with(EXTENDED_SUFFIX));
    }

    fn notifying(mut d: Downtime, events: NotificationEvents, lead: i64) -> Downtime {
        d.notifications = Some(DowntimeNotifications {
            destinations: vec!["slack".to_string()],
            events,
            ending_soon_lead_secs: lead,
            continues: None,
        });
        d
    }

    #[test]
    fn a_cancel_reports_the_window_it_cut_short_or_the_one_it_called_off() {
        let d = row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR);
        assert_eq!(
            cancelled_window(&d, 11 * HOUR),
            Some(window(10 * HOUR, 11 * HOUR))
        );
        assert_eq!(
            cancelled_window(&d, 9 * HOUR),
            Some(window(10 * HOUR, 12 * HOUR))
        );
        let nightly = daily("02:00", 3_600);
        assert_eq!(
            cancelled_window(&nightly, 5 * HOUR),
            Some(window(26 * HOUR, 27 * HOUR))
        );
    }

    #[test]
    fn every_extension_is_keyed_by_its_new_end_so_a_second_one_also_sends() {
        let first = extended_event(10 * HOUR, 13 * HOUR);
        let second = extended_event(10 * HOUR, 14 * HOUR);
        assert_eq!(first.event, NotificationEvent::Extended);
        assert_eq!(first.window, window(10 * HOUR, 13 * HOUR));
        assert_ne!(first.key, second.key);
    }

    #[test]
    fn a_follow_up_keeps_the_destinations_but_not_the_start_and_fits_the_reminder() {
        let all = NotificationEvents {
            started: true,
            ending_soon: true,
            ended: true,
            cancelled: true,
            extended: true,
        };
        let parent = notifying(daily("02:00", 3_600), all, 1_800);
        let next = follow_up(&parent, 3 * HOUR, 3 * HOUR + 600 * 1_000_000, "ops", 0);
        let n = next.notifications.clone().unwrap();
        assert_eq!(n.destinations, ["slack"]);
        assert!(!n.events.started);
        assert!(n.events.ending_soon && n.events.ended);
        assert_eq!(n.ending_soon_lead_secs, 600);
        assert_eq!(n.continues.as_deref(), Some("d1"));
        assert_eq!(
            validate_notifications(&n, &request_of(&next).schedule, |_| true),
            Ok(())
        );

        let start_only = NotificationEvents {
            started: true,
            ..Default::default()
        };
        let quiet = notifying(daily("02:00", 3_600), start_only, 600);
        for parent in [quiet, daily("02:00", 3_600)] {
            let next = follow_up(&parent, 3 * HOUR, 4 * HOUR, "ops", 0);
            let n = next.notifications.clone().unwrap();
            assert!(n.destinations.is_empty());
            assert_eq!(n.continues.as_deref(), Some("d1"));
            assert_eq!(
                validate_notifications(&n, &request_of(&next).schedule, |_| false),
                Ok(())
            );
        }
    }

    #[test]
    fn a_follow_up_continues_its_parents_window_in_every_region() {
        let mut parent = daily("02:00", 3_600);
        parent.origin_region = Some("us-east".to_string());
        let next = follow_up(&parent, 3 * HOUR, 5 * HOUR, "ops", 0);
        assert_eq!(next.origin_region.as_deref(), Some("us-east"));
        assert!(continues_window(&next, &parent, 3 * HOUR, 3 * HOUR));
        assert!(!continues_window(&next, &parent, 27 * HOUR, 27 * HOUR));
        assert!(!continues_window(&parent, &parent, 3 * HOUR, 3 * HOUR));
        let mut cancelled = next.clone();
        cancelled.cancelled_at = Some(2 * HOUR + HOUR / 2);
        assert!(!continues_window(&cancelled, &parent, 3 * HOUR, 3 * HOUR));
        assert!(continues_window(
            &cancelled,
            &parent,
            3 * HOUR,
            2 * HOUR + HOUR / 4
        ));
        let mut unrelated = next.clone();
        unrelated.notifications.as_mut().unwrap().continues = None;
        assert!(!continues_window(&unrelated, &parent, 3 * HOUR, 3 * HOUR));
        let mut ended = next.clone();
        ended.schedule.ends_at = Some(3 * HOUR);
        assert!(!continues_window(&ended, &parent, 3 * HOUR, 3 * HOUR));
    }

    #[test]
    fn a_follow_up_edited_into_a_rule_inactive_at_the_parents_end_does_not_continue_it() {
        let parent = daily("02:00", 3_600);
        let next = follow_up(&parent, 3 * HOUR, 5 * HOUR, "ops", 0);
        assert!(continues_window(&next, &parent, 3 * HOUR, 3 * HOUR));
        let recurring = Downtime {
            schedule: DowntimeSchedule {
                repeat: Repeat::Daily,
                start_time_local: Some("04:00".to_string()),
                duration_secs: 3_600,
                ..next.schedule.clone()
            },
            ..next.clone()
        };
        assert!(!continues_window(&recurring, &parent, 3 * HOUR, 3 * HOUR));
        let covering = Downtime {
            schedule: DowntimeSchedule {
                start_time_local: Some("03:00".to_string()),
                ..recurring.schedule.clone()
            },
            ..recurring
        };
        assert!(continues_window(&covering, &parent, 3 * HOUR, 3 * HOUR));
    }

    #[test]
    fn a_renamed_or_moved_follow_up_still_continues_its_parent() {
        let parent = daily("02:00", 3_600);
        let next = follow_up(&parent, 3 * HOUR, 5 * HOUR, "ops", 0);
        let renamed = Downtime {
            name: "Payments cutover, second hour".to_string(),
            ..next.clone()
        };
        assert!(continues_window(&renamed, &parent, 3 * HOUR, 3 * HOUR));
        let moved = Downtime {
            folder_id: "planned".to_string(),
            ..next.clone()
        };
        assert!(continues_window(&moved, &parent, 3 * HOUR, 3 * HOUR));
        let lookalike = Downtime {
            id: "other".to_string(),
            notifications: None,
            ..next
        };
        assert!(!continues_window(&lookalike, &parent, 3 * HOUR, 3 * HOUR));
    }

    #[test]
    fn a_request_cannot_set_continues_and_an_edit_keeps_it() {
        let asked = DowntimeNotifications {
            continues: Some("someone-else".to_string()),
            ..Default::default()
        };
        assert_eq!(
            with_continues(Some(asked.clone()), None).unwrap().continues,
            None
        );
        let kept = with_continues(Some(asked), Some("d1".to_string())).unwrap();
        assert_eq!(kept.continues.as_deref(), Some("d1"));
        let cleared = with_continues(None, Some("d1".to_string())).unwrap();
        assert!(cleared.destinations.is_empty());
        assert_eq!(cleared.continues.as_deref(), Some("d1"));
        assert_eq!(with_continues(None, None), None);
    }

    #[test]
    fn an_edit_request_carries_the_notifications() {
        let events = NotificationEvents {
            ended: true,
            ..Default::default()
        };
        let d = notifying(
            row(vec![TargetModule::Alerts], 10 * HOUR, 12 * HOUR),
            events,
            600,
        );
        assert_eq!(request_of(&d).notifications, d.notifications);
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

    #[test]
    fn an_invalid_preview_is_a_bad_request() {
        let alerts = DowntimeTarget {
            module: TargetModule::Alerts,
            folders: TargetFolders::All,
            tags: vec![],
            ids: vec![],
            slo_mode: None,
            incident_mode: Default::default(),
        };
        let valid = PreviewRequest {
            condition: None,
            targets: vec![alerts.clone()],
        };
        assert!(check_preview(&valid, &[]).is_ok());
        let no_targets = PreviewRequest {
            condition: None,
            targets: vec![],
        };
        assert!(matches!(
            check_preview(&no_targets, &[]),
            Err(DowntimeError::BadRequest(_))
        ));
        let twice = PreviewRequest {
            condition: None,
            targets: vec![alerts.clone(), alerts],
        };
        assert!(matches!(
            check_preview(&twice, &[]),
            Err(DowntimeError::BadRequest(_))
        ));
    }

    #[test]
    fn a_move_of_more_than_a_hundred_ids_is_a_bad_request() {
        let ids: Vec<String> = (0..=MAX_MOVE_IDS).map(|i| format!("d{i}")).collect();
        assert!(matches!(move_ids(&ids), Err(DowntimeError::BadRequest(_))));
        assert_eq!(move_ids(&ids[..MAX_MOVE_IDS]).unwrap().len(), MAX_MOVE_IDS);
        let repeated = ["b", "a", "b", "a"].map(String::from);
        assert_eq!(move_ids(&repeated).unwrap(), ["b", "a"]);
    }

    #[tokio::test]
    async fn a_move_of_three_rows_reloads_once() {
        let moves: Vec<(Downtime, i64)> = ["d1", "d2", "d3"]
            .into_iter()
            .map(|id| {
                let mut moved = row(vec![TargetModule::Alerts], 0, HOUR);
                moved.id = id.to_string();
                (moved, 1)
            })
            .collect();
        let mut writes = 0;
        let mut reloads = 0;
        let (written, outcome) = write_moves(
            &moves,
            async |_, _| {
                writes += 1;
                Ok(true)
            },
            async || {
                reloads += 1;
                Ok(())
            },
        )
        .await;
        assert!(outcome.is_ok());
        assert_eq!((written, writes, reloads), (3, 3, 1));

        let mut reloads = 0;
        let (written, outcome) = write_moves(
            &moves,
            async |moved, _| Ok(moved.id != "d2"),
            async || {
                reloads += 1;
                Ok(())
            },
        )
        .await;
        assert!(matches!(outcome, Err(DowntimeError::Conflict(_))));
        assert_eq!(
            (written, reloads),
            (1, 1),
            "a conflict stops the move and still reloads"
        );
    }

    #[test]
    fn a_rename_moves_no_correction() {
        let before = row(vec![TargetModule::Slos], 0, HOUR);
        let after = Downtime {
            name: "renamed".to_string(),
            reason: Some("why".to_string()),
            show_banner: false,
            ..before.clone()
        };
        assert!(!corrections_may_change(Some(&before), &after));
    }

    #[test]
    fn a_schedule_target_condition_or_cancel_edit_may_move_a_correction() {
        let before = row(vec![TargetModule::Slos], 0, HOUR);
        let mut schedule = before.clone();
        schedule.schedule.ends_at = Some(2 * HOUR);
        let mut mode = before.clone();
        mode.targets[0].slo_mode = Some(config::meta::downtimes::SloCorrectionMode::CountAsGood);
        let mut condition = before.clone();
        condition.condition = Some(config::meta::downtimes::DimensionCondition::Pair {
            key: "service".to_string(),
            operator: PairOperator::Eq,
            value: "payments".to_string(),
        });
        let mut cancel = before.clone();
        cancel.cancelled_at = Some(HOUR / 2);
        for after in [schedule, mode, condition, cancel] {
            assert!(corrections_may_change(Some(&before), &after));
        }
        assert!(
            corrections_may_change(None, &before),
            "a new row is measured"
        );
    }

    #[test]
    fn a_one_time_duration_is_set_from_its_span() {
        let mut once = row(vec![TargetModule::Alerts], 0, 2 * HOUR).schedule;
        once.duration_secs = 60;
        span_as_duration(&mut once);
        assert_eq!(once.duration_secs, 7200);
        let mut daily = DowntimeSchedule {
            repeat: Repeat::Daily,
            ..once.clone()
        };
        daily.duration_secs = 60;
        span_as_duration(&mut daily);
        assert_eq!(daily.duration_secs, 60, "a recurring length is its own");
    }

    #[test]
    fn every_writer_bumps_the_version() {
        let req = DowntimeRequest {
            folder_id: "default".to_string(),
            name: None,
            reason: None,
            condition: None,
            targets: vec![],
            schedule: row(vec![TargetModule::Alerts], 0, HOUR).schedule,
            show_banner: false,
            notifications: None,
        };
        let new = created("acme", "default".to_string(), &req, "lin", 5);
        assert_eq!(new.version, 1);
        let mut before = row(vec![TargetModule::Alerts], 0, HOUR);
        before.version = 4;
        assert_eq!(edited(&before, req, "lin", 6).version, 5);
        assert_eq!(cancelled(&before, "lin", 6).version, 5);
        let moved = moved(&before, "planned", "lin", 6);
        assert_eq!((moved.version, moved.folder_id.as_str()), (5, "planned"));
    }

    #[test]
    fn a_row_without_an_slos_target_moves_no_correction() {
        let before = row(vec![TargetModule::Alerts], 0, HOUR);
        let mut after = before.clone();
        after.schedule.ends_at = Some(2 * HOUR);
        assert!(!corrections_may_change(Some(&before), &after));
        let dropped = row(vec![TargetModule::Alerts], 0, HOUR);
        assert!(corrections_may_change(
            Some(&row(vec![TargetModule::Slos], 0, HOUR)),
            &dropped
        ));
    }
}
