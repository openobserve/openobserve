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

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::meta::folder::DEFAULT_FOLDER;

pub const DEFAULT_ENDING_SOON_LEAD_SECS: i64 = 600;
/// The most alert groups one downtime can name (R-118).
pub const MAX_ALERT_GROUPS: usize = 50;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Downtime {
    pub id: String,
    pub org: String,
    #[serde(default = "default_folder")]
    pub folder_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// One per downtime (D20). Applied to every target whose module has an identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<DimensionCondition>,
    pub targets: Vec<DowntimeTarget>,
    /// Narrows targets to these groups; older nodes ignore it and mute the whole alert.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alert_groups: Option<Vec<AlertGroupRef>>,
    /// Set by "Until it clears": the clear of the firing cancels the row (R-117).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_on_clear: Option<EndOnClear>,
    /// Who made an alert-scoped quick mute; unset on rows made through the downtime routes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<MuteSource>,
    pub schedule: DowntimeSchedule,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_by: Option<String>,
    /// Show a warning banner to everyone in the org while a window is active (D19).
    #[serde(default = "default_true")]
    pub show_banner: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notifications: Option<DowntimeNotifications>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_region: Option<String>,
    #[serde(default)]
    pub version: i64,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

impl Downtime {
    /// Same items covered: only the condition, the targets and the alert groups decide.
    pub fn same_coverage(&self, other: &Downtime) -> bool {
        self.condition == other.condition
            && self.targets == other.targets
            && group_keys(self.alert_groups.as_deref()) == group_keys(other.alert_groups.as_deref())
    }
}

/// At most one per module (D14); every present field narrows the module's items (D15).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DowntimeTarget {
    pub module: TargetModule,
    pub folders: TargetFolders,
    /// Synthetics only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ids: Vec<String>,
    /// Read only when `module == Slos` (D10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slo_mode: Option<SloCorrectionMode>,
    /// Read only when `module == Alerts`; a row saved before the field reads as `Muted`.
    #[serde(default, skip_serializing_if = "IncidentMode::is_muted")]
    pub incident_mode: IncidentMode,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TargetFolders {
    All,
    Some { folder_ids: Vec<String> },
}

/// A tree of dimension tests (D17); one AND group of `=` pairs is an on-call `OwnershipRule`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DimensionCondition {
    Group {
        op: LogicalOp,
        // An opaque item keeps the schema acyclic: the MCP tool generator rejects self-references.
        #[schema(value_type = Vec<Object>)]
        items: Vec<DimensionCondition>,
    },
    /// `value` may end in `*`, a prefix, as in ownership rules.
    Pair {
        key: String,
        operator: PairOperator,
        value: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LogicalOp {
    And,
    Or,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum PairOperator {
    #[serde(rename = "=")]
    Eq,
    #[serde(rename = "!=")]
    Ne,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TargetModule {
    Alerts,
    AnomalyDetections,
    Synthetics,
    Slos,
}

impl TargetModule {
    pub fn has_identity(self) -> bool {
        !matches!(self, Self::Synthetics)
    }

    pub fn has_tags(self) -> bool {
        matches!(self, Self::Synthetics)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DowntimeSchedule {
    pub repeat: Repeat,
    /// Microseconds UTC.
    pub starts_at: i64,
    /// Microseconds UTC; a recurring row reads only its local date, an inclusive last day.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
    pub timezone: String,
    /// `HH:MM` in `timezone`, recurring rows only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time_local: Option<String>,
    pub duration_secs: i64,
    /// ISO weekdays, 1 is Monday.
    #[serde(default)]
    pub weekdays: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Repeat {
    #[default]
    None,
    Daily,
    Weekly,
}

impl Repeat {
    /// Stored in `downtimes.repeat`; never reorder, 3 is reserved for monthly.
    pub fn to_i16(self) -> i16 {
        match self {
            Self::None => 0,
            Self::Daily => 1,
            Self::Weekly => 2,
        }
    }

    pub fn from_i16(value: i16) -> Option<Self> {
        match value {
            0 => Some(Self::None),
            1 => Some(Self::Daily),
            2 => Some(Self::Weekly),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DowntimeStatus {
    Scheduled,
    Active,
    Ended,
    Cancelled,
    /// Cancelled inside a window, which it cut short.
    EndedEarly,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DowntimeWindow {
    pub start: i64,
    pub end: i64,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct DowntimeListItem {
    #[serde(flatten)]
    pub downtime: Downtime,
    pub status: DowntimeStatus,
    pub current_window: Option<DowntimeWindow>,
    pub next_window: Option<DowntimeWindow>,
    pub matched_alerts: usize,
    pub matched_anomalies: usize,
    pub matched_synthetics: usize,
    pub matched_slos: usize,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct DowntimeRequest {
    #[serde(default = "default_folder")]
    pub folder_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub condition: Option<DimensionCondition>,
    pub targets: Vec<DowntimeTarget>,
    pub schedule: DowntimeSchedule,
    #[serde(default = "default_true")]
    pub show_banner: bool,
    #[serde(default)]
    pub notifications: Option<DowntimeNotifications>,
    /// The version the edit was loaded at; a newer stored row makes the edit a 409.
    #[serde(default)]
    pub version: Option<i64>,
    #[serde(default)]
    pub alert_groups: Option<Vec<AlertGroupRef>>,
    #[serde(default)]
    pub end_on_clear: Option<EndOnClear>,
}

impl DowntimeRequest {
    /// Alert groups and the end-on-clear alert must be alerts this request names by id.
    pub fn check_alert_targets(&self) -> Result<(), String> {
        let ids: BTreeSet<&str> = self
            .targets
            .iter()
            .filter(|t| t.module == TargetModule::Alerts)
            .flat_map(|t| t.ids.iter().map(String::as_str))
            .collect();
        let groups = self.alert_groups.as_deref().unwrap_or_default();
        if groups.len() > MAX_ALERT_GROUPS {
            return Err(format!(
                "A downtime can name at most {MAX_ALERT_GROUPS} alert groups."
            ));
        }
        if let Some(g) = groups.iter().find(|g| !ids.contains(g.alert_id.as_str())) {
            return Err(format!(
                "Alert group {:?} is of alert {}, which the downtime does not name.",
                g.group_key, g.alert_id
            ));
        }
        let Some(end) = &self.end_on_clear else {
            return Ok(());
        };
        if !ids.contains(end.alert_id.as_str()) {
            return Err(format!(
                "Until it clears names alert {}, which the downtime does not name.",
                end.alert_id
            ));
        }
        if self.schedule.repeat != Repeat::None || self.schedule.ends_at.is_none() {
            return Err("An until-it-clears downtime is one-time and has an end.".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DowntimeNotifications {
    #[serde(default)]
    pub destinations: Vec<String>,
    #[serde(default)]
    pub events: NotificationEvents,
    #[serde(default = "default_ending_soon_lead_secs")]
    pub ending_soon_lead_secs: i64,
    /// The id of the recurring downtime whose window this extension follow-up continues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continues: Option<String>,
}

impl Default for DowntimeNotifications {
    fn default() -> Self {
        Self {
            destinations: vec![],
            events: NotificationEvents::default(),
            ending_soon_lead_secs: DEFAULT_ENDING_SOON_LEAD_SECS,
            continues: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct NotificationEvents {
    #[serde(default)]
    pub started: bool,
    #[serde(default)]
    pub ending_soon: bool,
    #[serde(default)]
    pub ended: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub extended: bool,
}

impl NotificationEvents {
    pub fn any(&self) -> bool {
        self.started || self.ending_soon || self.ended || self.cancelled || self.extended
    }

    pub fn wants(&self, event: NotificationEvent) -> bool {
        match event {
            NotificationEvent::Started => self.started,
            NotificationEvent::EndingSoon => self.ending_soon,
            NotificationEvent::Ended => self.ended,
            NotificationEvent::Cancelled => self.cancelled,
            NotificationEvent::Extended => self.extended,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    Started,
    EndingSoon,
    Ended,
    Cancelled,
    Extended,
}

impl NotificationEvent {
    /// Stored in `downtime_notifications.event`; never rename.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::EndingSoon => "ending_soon",
            Self::Ended => "ended",
            Self::Cancelled => "cancelled",
            Self::Extended => "extended",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
pub struct DowntimeNotificationLogEntry {
    pub window_start: i64,
    pub event: String,
    pub sent_at: i64,
    pub destinations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct ResourcesRequest {
    pub condition: DimensionCondition,
    pub refine_by: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ResourceValue {
    pub value: String,
    pub last_seen: i64,
    /// Flattened from `ServiceStreams` as `<type>/<name>`.
    pub streams: Vec<String>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ResourcesResponse {
    pub dimension: String,
    pub values: Vec<ResourceValue>,
    pub total: usize,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct ValuesRequest {
    /// A semantic group id, as `refine_by` in `ResourcesRequest`.
    pub key: String,
    /// Case-insensitive prefix; empty lists the top values.
    #[serde(default)]
    pub prefix: String,
    /// The condition typed so far; only its And-spine pairs narrow the sources.
    #[serde(default)]
    pub condition: Option<DimensionCondition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
pub struct ValueSuggestion {
    pub value: String,
    /// `inventory`, `registry` or `search`.
    pub source: String,
    /// Alerts, anomaly detections and SLOs whose identity carries this value.
    pub items: usize,
    /// Newest sighting in microseconds, when a source knows one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
pub struct ValuesResponse {
    pub values: Vec<ValueSuggestion>,
    /// True when a source timed out; the list is what answered in time.
    pub partial: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SloCorrectionMode {
    #[default]
    Exclude,
    CountAsGood,
}

/// What a suppressed alert firing does to incidents during the window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IncidentMode {
    #[default]
    Muted,
    None,
}

impl IncidentMode {
    pub fn is_muted(&self) -> bool {
        matches!(self, Self::Muted)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CorrectionWindow {
    pub downtime_id: String,
    pub start: i64,
    pub end: i64,
    pub mode: SloCorrectionMode,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct PreviewRequest {
    #[serde(default)]
    pub condition: Option<DimensionCondition>,
    pub targets: Vec<DowntimeTarget>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct PreviewMatch {
    pub id: String,
    pub name: String,
    pub folder_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<String>,
    /// SLOs on the detail page: false when the current or next window holds no slice start.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applies: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
pub struct PreviewResponse {
    pub alerts: Vec<PreviewMatch>,
    pub resolved_at_fire_time: Vec<PreviewMatch>,
    pub anomalies: Vec<PreviewMatch>,
    pub synthetics: Vec<PreviewMatch>,
    pub slos: Vec<PreviewMatch>,
    pub alerts_total: usize,
    pub anomalies_total: usize,
    pub synthetics_total: usize,
    pub slos_total: usize,
    pub undecidable: HashMap<String, Vec<PreviewMatch>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ActiveDowntime {
    pub id: String,
    pub name: String,
    pub ends_at: i64,
    #[serde(default, skip_serializing_if = "IncidentMode::is_muted")]
    pub incident_mode: IncidentMode,
    /// The row's version, which an extend sends back; 0 from an older node.
    #[serde(default)]
    pub version: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alert_groups: Option<Vec<AlertGroupRef>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_on_clear: Option<EndOnClear>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<MuteSource>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CorrectionRef {
    pub downtime_id: String,
    pub name: String,
    pub status: DowntimeStatus,
    /// False when the window holds no slice start, so it corrects no minute of this SLO.
    #[serde(default = "default_true")]
    pub applies: bool,
}

/// Query of `GET /v2/{org}/downtimes`.
#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListDowntimesQuery {
    /// Absent means every folder the user may list.
    pub folder_id: Option<String>,
    /// `scheduled`, `active`, `ended`, `ended_early` or `cancelled`.
    pub status: Option<String>,
    /// `none`, `daily`, `weekly`, or `recurring` for both.
    pub repeat: Option<String>,
    pub search: Option<String>,
    /// Rows whose alerts target names this alert, or whose condition matches its dimensions.
    pub alert_id: Option<String>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct DowntimeStatusCounts {
    pub active: usize,
    pub scheduled: usize,
    pub recurring: usize,
    pub ended: usize,
    pub cancelled: usize,
    pub ended_early: usize,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ListDowntimesResponse {
    pub items: Vec<DowntimeListItem>,
    pub total: usize,
    pub counts: DowntimeStatusCounts,
}

/// `GET /v2/{org}/downtimes/{id}`: the list item and what it covers, as far as the user may see.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct DowntimeDetail {
    #[serde(flatten)]
    pub item: DowntimeListItem,
    pub affected: AffectedItems,
    pub notification_log: Vec<DowntimeNotificationLogEntry>,
}

#[derive(Clone, Debug, Default, Serialize, ToSchema)]
pub struct AffectedItems {
    pub alerts: Vec<PreviewMatch>,
    pub resolved_at_fire_time: Vec<PreviewMatch>,
    pub anomalies: Vec<PreviewMatch>,
    pub synthetics: Vec<PreviewMatch>,
    pub slos: Vec<PreviewMatch>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct MoveDowntimesRequest {
    pub downtime_ids: Vec<String>,
    pub dst_folder_id: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct CreateDowntimeResponse {
    pub id: String,
}

/// `POST /v2/{org}/downtimes/{id}/extend`: exactly one of `by_secs` and `until`.
#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
pub struct ExtendDowntimeRequest {
    /// Added to the later of the current end and now.
    #[serde(default)]
    pub by_secs: Option<i64>,
    /// The new end, microseconds UTC.
    #[serde(default)]
    pub until: Option<i64>,
    /// The version the row was loaded at; a newer stored row makes the extension a 409.
    #[serde(default)]
    pub version: Option<i64>,
}

/// The row that now ends later: the extended one-time row, or the follow-up of a recurring one.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ExtendDowntimeResponse {
    #[serde(flatten)]
    pub downtime: Downtime,
    /// Set when a recurring row got a one-time follow-up instead of a longer window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_id: Option<String>,
}

/// One alert group a downtime mutes; `group_key` is `""` for single-row and composite alerts.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct AlertGroupRef {
    pub alert_id: String,
    #[serde(default)]
    pub group_key: String,
    /// Captured at mute time because `group_key` is a hash the UI cannot show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_labels: Option<BTreeMap<String, String>>,
}

/// Where a quick mute came from; the web app's own calls are `openobserve`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MuteSource {
    Slack,
    Openobserve,
    Api,
}

impl MuteSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Slack => "slack",
            Self::Openobserve => "openobserve",
            Self::Api => "api",
        }
    }

    /// A value a newer node wrote reads as unknown, not as an error.
    pub fn parse(stored: &str) -> Option<Self> {
        match stored {
            "slack" => Some(Self::Slack),
            "openobserve" => Some(Self::Openobserve),
            "api" => Some(Self::Api),
            _ => None,
        }
    }
}

/// "Until it clears": `group_key` null ends the downtime when no group of the alert is firing.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct EndOnClear {
    pub alert_id: String,
    #[serde(default)]
    pub group_key: Option<String>,
}

/// `POST /v2/{org}/alerts/{alert_id}/mute`: exactly one of `until_clear`, `minutes` and `ends_at`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct AlertMuteRequest {
    pub until_clear: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_keys: Option<Vec<String>>,
    pub all_groups: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firing_started_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

/// `POST .../mute/{downtime_id}/extend`: exactly one of `minutes`, `until_clear` and `ends_at`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AlertMuteExtendRequest {
    pub version: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minutes: Option<u32>,
    #[serde(default)]
    pub until_clear: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AlertMuteResponse {
    pub downtime_id: String,
    pub version: i64,
    pub ends_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_on_clear: Option<EndOnClear>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alert_groups: Option<Vec<AlertGroupRef>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AlertMuteExtendResponse {
    pub version: i64,
    pub ends_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_on_clear: Option<EndOnClear>,
}

/// The 409 bodies of the alert-scoped mute routes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum AlertMuteConflict {
    DowntimeCap {
        message: String,
    },
    AlreadyMuted {
        downtime_id: String,
        version: i64,
        ends_at: i64,
    },
    VersionChanged {
        version: i64,
        ends_at: i64,
    },
    NotAQuickMute,
}

pub fn default_folder() -> String {
    DEFAULT_FOLDER.to_string()
}

/// Labels are display only, so two lists naming the same groups cover the same.
fn group_keys(groups: Option<&[AlertGroupRef]>) -> BTreeSet<(&str, &str)> {
    groups
        .unwrap_or_default()
        .iter()
        .map(|g| (g.alert_id.as_str(), g.group_key.as_str()))
        .collect()
}

fn default_true() -> bool {
    true
}

fn default_ending_soon_lead_secs() -> i64 {
    DEFAULT_ENDING_SOON_LEAD_SECS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal() -> Downtime {
        Downtime {
            alert_groups: None,
            end_on_clear: None,
            source: None,
            id: "2f9KQe4b7Nq1vH3sT0mLzXpRcWd".to_string(),
            org: "default".to_string(),
            folder_id: DEFAULT_FOLDER.to_string(),
            name: "Staging teardown".to_string(),
            reason: None,
            condition: None,
            targets: vec![DowntimeTarget {
                module: TargetModule::Alerts,
                folders: TargetFolders::All,
                tags: vec![],
                ids: vec![],
                slo_mode: None,
                incident_mode: Default::default(),
            }],
            schedule: DowntimeSchedule {
                repeat: Repeat::None,
                starts_at: 1_789_855_200_000_000,
                ends_at: Some(1_789_905_600_000_000),
                timezone: "UTC".to_string(),
                start_time_local: None,
                duration_secs: 50_400,
                weekdays: vec![],
            },
            cancelled_at: None,
            cancelled_by: None,
            show_banner: true,
            notifications: None,
            origin_region: None,
            version: 0,
            created_by: "lin".to_string(),
            created_at: 1,
            updated_by: "lin".to_string(),
            updated_at: 1,
        }
    }

    #[test]
    fn notification_events_are_stored_by_their_snake_case_names() {
        for (event, name) in [
            (NotificationEvent::Started, "started"),
            (NotificationEvent::EndingSoon, "ending_soon"),
            (NotificationEvent::Ended, "ended"),
            (NotificationEvent::Cancelled, "cancelled"),
            (NotificationEvent::Extended, "extended"),
        ] {
            assert_eq!(event.as_str(), name);
            assert_eq!(serde_json::to_value(event).unwrap(), name);
        }
    }

    #[test]
    fn repeat_round_trips_through_its_stored_number() {
        for repeat in [Repeat::None, Repeat::Daily, Repeat::Weekly] {
            assert_eq!(Repeat::from_i16(repeat.to_i16()), Some(repeat));
        }
        assert_eq!(Repeat::None.to_i16(), 0);
        assert_eq!(Repeat::Daily.to_i16(), 1);
        assert_eq!(Repeat::Weekly.to_i16(), 2);
        assert_eq!(Repeat::from_i16(3), None);
    }

    #[test]
    fn only_the_condition_and_the_targets_change_the_coverage() {
        let before = minimal();
        let cosmetic = Downtime {
            name: "Renamed".to_string(),
            reason: Some("typo".to_string()),
            folder_id: "planned".to_string(),
            show_banner: false,
            cancelled_at: Some(5),
            updated_at: 9,
            ..before.clone()
        };
        assert!(before.same_coverage(&cosmetic));

        let narrowed = Downtime {
            condition: Some(DimensionCondition::Pair {
                key: "service".to_string(),
                operator: PairOperator::Eq,
                value: "payments".to_string(),
            }),
            ..before.clone()
        };
        assert!(!before.same_coverage(&narrowed));

        let mut other_module = before.clone();
        other_module.targets[0].module = TargetModule::Synthetics;
        assert!(!before.same_coverage(&other_module));

        let group = |key: &str, label: Option<&str>| AlertGroupRef {
            alert_id: "a1".to_string(),
            group_key: key.to_string(),
            group_labels: label.map(|v| BTreeMap::from([("city".to_string(), v.to_string())])),
        };
        let one_group = Downtime {
            alert_groups: Some(vec![group("k1", Some("pune"))]),
            ..before.clone()
        };
        assert!(!before.same_coverage(&one_group));
        let relabelled = Downtime {
            alert_groups: Some(vec![group("k1", None)]),
            ..before.clone()
        };
        assert!(
            one_group.same_coverage(&relabelled),
            "labels are display only"
        );
        let empty = Downtime {
            alert_groups: Some(vec![]),
            ..before.clone()
        };
        assert!(before.same_coverage(&empty));
    }

    #[test]
    fn an_older_row_reads_without_the_mute_fields_and_a_newer_field_is_ignored() {
        let mut json = serde_json::to_value(minimal()).unwrap();
        for absent in ["alert_groups", "end_on_clear", "source"] {
            assert!(
                json.get(absent).is_none(),
                "{absent} is not written when unset"
            );
        }
        json["a_field_from_a_newer_node"] = serde_json::json!(1);
        let old = serde_json::from_value::<Downtime>(json).unwrap();
        assert!(old.alert_groups.is_none() && old.end_on_clear.is_none() && old.source.is_none());

        let quick = Downtime {
            alert_groups: Some(vec![AlertGroupRef {
                alert_id: "a1".to_string(),
                group_key: "k1".to_string(),
                group_labels: None,
            }]),
            end_on_clear: Some(EndOnClear {
                alert_id: "a1".to_string(),
                group_key: Some("k1".to_string()),
            }),
            source: Some(MuteSource::Slack),
            ..minimal()
        };
        let json = serde_json::to_value(&quick).unwrap();
        assert_eq!(json["source"], "slack");
        assert_eq!(json["end_on_clear"]["group_key"], "k1");
        assert_eq!(serde_json::from_value::<Downtime>(json).unwrap(), quick);
        assert_eq!(
            MuteSource::parse("openobserve"),
            Some(MuteSource::Openobserve)
        );
        assert_eq!(MuteSource::parse("later"), None);

        let active: ActiveDowntime =
            serde_json::from_str(r#"{"id":"d1","name":"n","ends_at":5}"#).unwrap();
        assert_eq!(active.version, 0);
        assert!(active.end_on_clear.is_none() && active.alert_groups.is_none());
    }

    #[test]
    fn alert_groups_and_end_on_clear_must_name_targeted_alerts() {
        let request = |groups: Vec<&str>, end: Option<&str>, ids: Vec<&str>| DowntimeRequest {
            folder_id: DEFAULT_FOLDER.to_string(),
            name: None,
            reason: None,
            condition: None,
            targets: vec![DowntimeTarget {
                module: TargetModule::Alerts,
                folders: TargetFolders::All,
                tags: vec![],
                ids: ids.into_iter().map(str::to_string).collect(),
                slo_mode: None,
                incident_mode: IncidentMode::Muted,
            }],
            schedule: minimal().schedule,
            show_banner: false,
            notifications: None,
            version: None,
            alert_groups: Some(
                groups
                    .into_iter()
                    .map(|alert_id| AlertGroupRef {
                        alert_id: alert_id.to_string(),
                        group_key: "k".to_string(),
                        group_labels: None,
                    })
                    .collect(),
            ),
            end_on_clear: end.map(|alert_id| EndOnClear {
                alert_id: alert_id.to_string(),
                group_key: None,
            }),
        };
        assert!(
            request(vec!["a1"], Some("a1"), vec!["a1"])
                .check_alert_targets()
                .is_ok()
        );
        assert!(
            request(vec!["a2"], None, vec!["a1"])
                .check_alert_targets()
                .is_err()
        );
        assert!(
            request(vec![], Some("a2"), vec!["a1"])
                .check_alert_targets()
                .is_err()
        );
        assert!(
            request(vec!["a1"; 51], None, vec!["a1"])
                .check_alert_targets()
                .is_err()
        );
        let mut recurring = request(vec![], Some("a1"), vec!["a1"]);
        recurring.schedule.repeat = Repeat::Daily;
        assert!(recurring.check_alert_targets().is_err());
    }

    #[test]
    fn mute_shapes_use_the_contract_json() {
        let all_groups = EndOnClear {
            alert_id: "a1".into(),
            group_key: None,
        };
        assert_eq!(
            serde_json::to_value(&all_groups).unwrap(),
            serde_json::json!({"alert_id": "a1", "group_key": null})
        );
        let old: EndOnClear = serde_json::from_str(r#"{"alert_id":"a1"}"#).unwrap();
        assert_eq!(old, all_groups);
        let group: AlertGroupRef =
            serde_json::from_str(r#"{"alert_id":"a1","group_key":"k","later":1}"#).unwrap();
        assert_eq!(group.group_key, "k");
        assert!(group.group_labels.is_none());
        let labelled = AlertGroupRef {
            group_labels: Some(BTreeMap::from([(
                "cluster".to_string(),
                "prod-eu".to_string(),
            )])),
            ..group.clone()
        };
        assert_eq!(
            serde_json::to_value(&labelled).unwrap(),
            serde_json::json!({"alert_id": "a1", "group_key": "k", "group_labels": {"cluster": "prod-eu"}})
        );
        assert!(
            serde_json::to_value(&group)
                .unwrap()
                .get("group_labels")
                .is_none()
        );
        assert_eq!(
            serde_json::to_value(AlertMuteConflict::NotAQuickMute).unwrap(),
            serde_json::json!({"code": "not_a_quick_mute"})
        );
        assert_eq!(
            serde_json::to_value(AlertMuteConflict::AlreadyMuted {
                downtime_id: "d1".into(),
                version: 2,
                ends_at: 9,
            })
            .unwrap(),
            serde_json::json!({"code": "already_muted", "downtime_id": "d1", "version": 2, "ends_at": 9})
        );
        let req: AlertMuteRequest =
            serde_json::from_str(r#"{"minutes":30,"unknown_later":true}"#).unwrap();
        assert_eq!(req.minutes, Some(30));
        assert!(!req.until_clear && req.group_keys.is_none());
        let extend: AlertMuteExtendRequest =
            serde_json::from_str(r#"{"version":3,"until_clear":true}"#).unwrap();
        assert!(extend.until_clear && extend.minutes.is_none());
    }
}
