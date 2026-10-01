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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::meta::folder::DEFAULT_FOLDER;

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
    pub schedule: DowntimeSchedule,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled_by: Option<String>,
    /// Show a warning banner to everyone in the org while a window is active (D19).
    #[serde(default = "default_true")]
    pub show_banner: bool,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

impl Downtime {
    /// Same items covered: only the condition and the targets decide which items match.
    pub fn same_coverage(&self, other: &Downtime) -> bool {
        self.condition == other.condition && self.targets == other.targets
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
#[schema(no_recursion)]
pub enum DimensionCondition {
    Group {
        op: LogicalOp,
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SloCorrectionMode {
    #[default]
    Exclude,
    CountAsGood,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ActiveDowntime {
    pub id: String,
    pub name: String,
    pub ends_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CorrectionRef {
    pub downtime_id: String,
    pub name: String,
    pub status: DowntimeStatus,
}

/// Query of `GET /v2/{org}/downtimes`.
#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListDowntimesQuery {
    /// Absent means every folder the user may list.
    pub folder_id: Option<String>,
    /// `scheduled`, `active`, `ended` or `cancelled`.
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

pub fn default_folder() -> String {
    DEFAULT_FOLDER.to_string()
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal() -> Downtime {
        Downtime {
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
            created_by: "lin".to_string(),
            created_at: 1,
            updated_by: "lin".to_string(),
            updated_at: 1,
        }
    }

    fn full() -> Downtime {
        Downtime {
            reason: Some("CHG-4471".to_string()),
            condition: Some(DimensionCondition::Group {
                op: LogicalOp::And,
                items: vec![
                    DimensionCondition::Pair {
                        key: "service".to_string(),
                        operator: PairOperator::Eq,
                        value: "payments".to_string(),
                    },
                    DimensionCondition::Group {
                        op: LogicalOp::Or,
                        items: vec![DimensionCondition::Pair {
                            key: "host".to_string(),
                            operator: PairOperator::Ne,
                            value: "db-*".to_string(),
                        }],
                    },
                ],
            }),
            targets: vec![
                DowntimeTarget {
                    module: TargetModule::Synthetics,
                    folders: TargetFolders::Some {
                        folder_ids: vec!["4Kc1staging".to_string()],
                    },
                    tags: vec!["service:payments".to_string()],
                    ids: vec!["syn_41".to_string()],
                    slo_mode: None,
                },
                DowntimeTarget {
                    module: TargetModule::Slos,
                    folders: TargetFolders::All,
                    tags: vec![],
                    ids: vec![],
                    slo_mode: Some(SloCorrectionMode::CountAsGood),
                },
            ],
            schedule: DowntimeSchedule {
                repeat: Repeat::Weekly,
                starts_at: 1_789_603_200_000_000,
                ends_at: None,
                timezone: "Europe/Berlin".to_string(),
                start_time_local: Some("02:00".to_string()),
                duration_secs: 5400,
                weekdays: vec![7],
            },
            cancelled_at: Some(5),
            cancelled_by: Some("lin".to_string()),
            show_banner: false,
            ..minimal()
        }
    }

    #[test]
    fn a_downtime_round_trips_with_every_optional_field_absent() {
        let d = minimal();
        let json = serde_json::to_value(&d).unwrap();
        for absent in ["reason", "condition", "cancelled_at", "cancelled_by"] {
            assert!(json.get(absent).is_none(), "{absent} must be skipped");
        }
        assert!(json["targets"][0].get("tags").is_none());
        assert!(json["targets"][0].get("slo_mode").is_none());
        assert!(json["schedule"].get("ends_at").is_some());
        assert_eq!(serde_json::from_value::<Downtime>(json).unwrap(), d);
    }

    #[test]
    fn a_downtime_round_trips_with_every_optional_field_present() {
        let d = full();
        let json = serde_json::to_string(&d).unwrap();
        assert_eq!(serde_json::from_str::<Downtime>(&json).unwrap(), d);
    }

    #[test]
    fn stored_names_are_the_wire_contract() {
        let json = serde_json::to_value(full()).unwrap();
        assert_eq!(json["condition"]["type"], "group");
        assert_eq!(json["condition"]["op"], "and");
        assert_eq!(json["condition"]["items"][0]["operator"], "=");
        assert_eq!(json["condition"]["items"][1]["items"][0]["operator"], "!=");
        assert_eq!(json["targets"][0]["module"], "synthetics");
        assert_eq!(json["targets"][0]["folders"]["kind"], "some");
        assert_eq!(json["targets"][1]["folders"]["kind"], "all");
        assert_eq!(json["targets"][1]["slo_mode"], "count_as_good");
        assert_eq!(json["schedule"]["repeat"], "weekly");
        assert_eq!(
            serde_json::to_value(TargetModule::AnomalyDetections).unwrap(),
            "anomaly_detections"
        );
    }

    #[test]
    fn missing_folder_and_banner_take_their_defaults() {
        let mut json = serde_json::to_value(minimal()).unwrap();
        let obj = json.as_object_mut().unwrap();
        obj.remove("folder_id");
        obj.remove("show_banner");
        let d: Downtime = serde_json::from_value(json).unwrap();
        assert_eq!(d.folder_id, DEFAULT_FOLDER);
        assert!(d.show_banner);
    }

    #[test]
    fn the_api_example_request_parses() {
        let body = r#"{
          "folder_id": "planned-maintenance",
          "name": "Payments failover · weekly",
          "condition": { "type": "group", "op": "and", "items": [
            { "type": "pair", "key": "service", "operator": "=", "value": "payments" },
            { "type": "pair", "key": "env", "operator": "=", "value": "prod" } ] },
          "targets": [
            { "module": "alerts", "folders": { "kind": "all" } },
            { "module": "synthetics", "folders": { "kind": "all" }, "tags": ["service:payments"] },
            { "module": "slos", "folders": { "kind": "all" }, "slo_mode": "exclude" }
          ],
          "schedule": { "repeat": "weekly", "starts_at": 1789603200000000, "ends_at": null,
                        "timezone": "Europe/Berlin", "start_time_local": "02:00",
                        "duration_secs": 5400, "weekdays": [7] }
        }"#;
        let req: DowntimeRequest = serde_json::from_str(body).unwrap();
        assert_eq!(req.targets.len(), 3);
        assert_eq!(req.schedule.ends_at, None);
        assert!(req.show_banner);
        assert_eq!(req.targets[2].slo_mode, Some(SloCorrectionMode::Exclude));

        let quick: DowntimeRequest = serde_json::from_str(
            r#"{ "targets": [ { "module": "anomaly_detections", "folders": { "kind": "all" }, "ids": ["ad_7c1"] } ],
                 "schedule": { "repeat": "none", "starts_at": 1, "ends_at": 2, "timezone": "UTC", "duration_secs": 60 },
                 "show_banner": false }"#,
        )
        .unwrap();
        assert_eq!(quick.folder_id, DEFAULT_FOLDER);
        assert!(!quick.show_banner);
        assert!(quick.schedule.weekdays.is_empty());
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
    fn only_synthetics_has_tags_and_no_identity() {
        for module in [
            TargetModule::Alerts,
            TargetModule::AnomalyDetections,
            TargetModule::Slos,
        ] {
            assert!(module.has_identity());
            assert!(!module.has_tags());
        }
        assert!(!TargetModule::Synthetics.has_identity());
        assert!(TargetModule::Synthetics.has_tags());
    }

    #[test]
    fn a_list_item_flattens_the_downtime() {
        let item = DowntimeListItem {
            downtime: minimal(),
            status: DowntimeStatus::Scheduled,
            current_window: None,
            next_window: Some(DowntimeWindow { start: 1, end: 2 }),
            matched_alerts: 7,
            matched_anomalies: 0,
            matched_synthetics: 2,
            matched_slos: 3,
        };
        let json = serde_json::to_value(item).unwrap();
        assert_eq!(json["id"], "2f9KQe4b7Nq1vH3sT0mLzXpRcWd");
        assert_eq!(json["status"], "scheduled");
        assert!(json["current_window"].is_null());
        assert_eq!(json["next_window"]["end"], 2);
    }

    #[test]
    fn preview_match_omits_unset_reasons() {
        let m = PreviewMatch {
            id: "a".to_string(),
            name: "n".to_string(),
            folder_id: "default".to_string(),
            matched_by: None,
            missing: Some("host".to_string()),
        };
        let json = serde_json::to_value(m).unwrap();
        assert!(json.get("matched_by").is_none());
        assert_eq!(json["missing"], "host");
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
    }
}
