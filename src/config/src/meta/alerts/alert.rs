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

use chrono::{DateTime, FixedOffset};
use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

use crate::{
    meta::{
        alerts::{
            QueryCondition, TriggerCondition, deduplication::DeduplicationConfig,
            priority::AlertPriority,
        },
        stream::StreamType,
        triggers::{ScheduledTriggerData, Trigger},
    },
    stats::MemorySize,
    utils::json,
};

#[derive(Clone, Copy, Default, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
#[repr(i16)]
pub enum RowTemplateType {
    #[default]
    String = 0,
    Json = 1,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct Alert {
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub id: Option<Ksuid>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub stream_type: StreamType,
    #[serde(default)]
    pub stream_name: String,
    #[serde(default)]
    pub is_real_time: bool,
    #[serde(default)]
    pub query_condition: QueryCondition,
    #[serde(default)]
    pub trigger_condition: TriggerCondition,
    pub destinations: Vec<String>,
    /// Optional template name. When specified, this template is used for all
    /// destinations instead of destination-level templates. This allows using
    /// different templates for different alerts while reusing the same destinations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_attributes: Option<HashMap<String, String>>,
    #[serde(default)]
    pub row_template: String,
    #[serde(default)]
    pub row_template_type: RowTemplateType,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    /// Timezone offset in minutes.
    /// The negative secs means the Western Hemisphere
    pub tz_offset: i32,
    /// Will be removed in the future.
    #[serde(default)]
    last_triggered_at: Option<i64>,
    #[serde(default)]
    /// Will be removed in the future.
    last_satisfied_at: Option<i64>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: Option<DateTime<FixedOffset>>,
    #[serde(default)]
    pub last_edited_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deduplication: Option<DeduplicationConfig>,
    /// When true, this alert creates/joins incidents instead of sending direct notifications.
    /// Notification is sent only when a new incident is created or a new alert type joins
    /// an existing incident. Repeated firings are suppressed.
    /// When false (default), the alert sends notifications directly and does not correlate
    /// to any incident.
    #[serde(default)]
    pub creates_incident: bool,
    #[serde(default)]
    pub workflows: Vec<String>,
    /// How much humans care about this alert (PT-1). `None` = unset, which is
    /// every pre-Feature-2 alert.
    ///
    /// **Mutable** configuration — editable on any update, like `name`.
    /// Display + propagation only: it must never influence evaluation,
    /// silence, delivery or incident severity (PT-5 / D19).
    ///
    /// `value_type` is required here because the enum serializes as an
    /// integer via serde `try_from`/`into`; without it the generated OpenAPI
    /// would advertise a string enum and lie about the payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<u8>, example = 3)]
    pub priority: Option<AlertPriority>,
    /// Selection tags (PT-6): bare (`prod`) or `key:value`
    /// (`service:checkout`), normalized and validated at save by
    /// `tags::normalize_tags`.
    ///
    /// NOT `context_attributes` — that field is free-form KV shipped into
    /// notification payloads with no validation. These are the filtering /
    /// scoping primitive.
    ///
    /// Skipped when empty so alerts that set no tags serialize exactly as
    /// they did before Feature 2 (G5).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

impl MemorySize for Alert {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Alert>()
            + self.id.mem_size()
            + self.name.mem_size()
            + self.org_id.mem_size()
            + self.stream_type.to_string().mem_size()
            + self.stream_name.mem_size()
            + self.query_condition.mem_size()
            + self.trigger_condition.mem_size()
            + self.destinations.mem_size()
            + self.context_attributes.mem_size()
            + self.template.mem_size()
            + self.row_template.mem_size()
            + self.description.mem_size()
            + self.owner.mem_size()
            + self.last_edited_by.mem_size()
            + self.deduplication.mem_size()
            + self.workflows.mem_size()
            + self.tags.mem_size()
            + std::mem::size_of::<Option<AlertPriority>>()
    }
}

impl PartialEq for Alert {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
            && self.stream_type == other.stream_type
            && self.stream_name == other.stream_name
    }
}

impl Default for Alert {
    fn default() -> Self {
        Self {
            id: None,
            name: "".to_string(),
            org_id: "".to_string(),
            stream_type: StreamType::default(),
            stream_name: "".to_string(),
            is_real_time: false,
            query_condition: QueryCondition::default(),
            trigger_condition: TriggerCondition::default(),
            destinations: vec![],
            template: None,
            context_attributes: None,
            row_template: "".to_string(),
            row_template_type: RowTemplateType::default(),
            description: "".to_string(),
            enabled: false,
            tz_offset: 0, // UTC
            last_triggered_at: None,
            owner: None,
            updated_at: None,
            last_edited_by: None,
            last_satisfied_at: None,
            deduplication: None,
            creates_incident: false,
            workflows: vec![],
            priority: None,
            tags: vec![],
        }
    }
}

impl Alert {
    /// Get the unique identifier of the alert.
    /// For now it ruturns the `stream_type` and `stream_name` concatenated
    /// along with alert name. In future, once the migration to v2 alerts
    /// is complete, it will use the `id` of the alert.
    pub fn get_unique_key(&self) -> String {
        self.id
            .as_ref()
            .map_or("".to_string(), |id| id.to_string())
            .to_string()
    }

    /// Checks the last satisfied at time for the alert from the scheduled_jobs table first.
    /// If it is not present, then it uses the last_satisfied_at time from the alert table.
    /// Use this function instead of `get_last_satisfied_at_from_table` to get the actual timestamp.
    pub fn get_last_satisfied_at(&self, trigger: Option<&Trigger>) -> Option<i64> {
        if let Some(data) = trigger.map(|trigger| trigger.data.as_str()) {
            log::info!("Trigger data: {data}");

            // last_satisfied_at is now supposed to be part of the trigger data
            // but it was previously stored in the alert table. So, in case the trigger
            // data is not yet updated, we fallback to the value in the alert table.
            json::from_str::<ScheduledTriggerData>(data)
                .ok()
                .and_then(|trigger_data| trigger_data.last_satisfied_at)
                .or(self.last_satisfied_at)
        } else {
            self.last_satisfied_at
        }
    }

    /// Checks the last triggered at time for the alert from the scheduled_jobs table first.
    /// If it is not present, then it uses the last_triggered_at time from the alert table.
    /// Use this function instead of `get_last_triggered_at_from_table` to get the actual timestamp.
    pub fn get_last_triggered_at(&self, trigger: Option<&Trigger>) -> Option<i64> {
        if let Some(trigger) = trigger {
            // `last_triggered_at` is now supposed to be part of the trigger data
            // but it was previously stored in the alert table. So, in case the trigger
            // data is not yet updated, we fallback to the value in the alert table.
            trigger.start_time.or(self.last_triggered_at)
        } else {
            self.last_triggered_at
        }
    }

    /// Not to be used for new alerts.
    pub fn get_last_triggered_at_from_table(&self) -> Option<i64> {
        self.last_triggered_at
    }

    /// Not to be used for new alerts.
    pub fn get_last_satisfied_at_from_table(&self) -> Option<i64> {
        self.last_satisfied_at
    }

    /// Not to be used for new alerts.
    pub fn set_last_satisfied_at(&mut self, last_satisfied_at: Option<i64>) {
        self.last_satisfied_at = last_satisfied_at;
    }

    /// Not to be used for new alerts.
    pub fn set_last_triggered_at(&mut self, last_triggered_at: Option<i64>) {
        self.last_triggered_at = last_triggered_at;
    }
}

#[derive(Clone, Debug, Default)]
pub struct AlertListFilter {
    pub enabled: Option<bool>,
    pub owner: Option<String>,
}

/// Filters the alert list by alert type (scheduled, realtime, anomaly detection, or all).
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AlertTypeFilter {
    #[default]
    All,
    Scheduled,
    Realtime,
    AnomalyDetection,
}

/// Parameters for listing alerts.
#[derive(Debug, Clone)]
pub struct ListAlertsParams {
    /// The optional org ID surrogate key with which to filter alerts.
    pub org_id: String,

    /// The optional folder ID surrogate key with which to filter alerts.
    pub folder_id: Option<String>,

    /// The optional case-insensitive alert name substring with which to filter alerts.
    pub name_substring: Option<String>,

    /// The optional stream type and stream name with which to filter alerts.
    ///
    /// The stream name can only be provided if the stream type is also provide.
    pub stream_type_and_name: Option<(StreamType, Option<String>)>,

    /// The optional filter on the enabled field. `Some(true)` indicates that
    /// only enabled alerts should be returned, while `Some(false)` indicates
    /// that only disabled alerts should be returned.
    pub enabled: Option<bool>,

    /// The optional owner with which to filter alerts.
    pub owner: Option<String>,

    /// The optional page size and page index of results to retrieve.
    pub page_size_and_idx: Option<(u64, u64)>,

    /// The optional alert type filter. Defaults to `All`.
    pub alert_type: AlertTypeFilter,

    /// Optional priority filter (PT-3). Multiple values are OR-ed, so
    /// `?priority=1&priority=2` returns P1 **or** P2.
    ///
    /// `None` = no filter. `Some(empty)` = the caller asked for priorities but
    /// none were valid, which MUST match nothing — collapsing that back to
    /// "no filter" would make `?priority=P9` return every alert, the same
    /// match-all bug the tag filter guards against.
    ///
    /// Alerts with no priority are excluded whenever a filter is present:
    /// "show me the P1s" must not surface unprioritized alerts.
    pub priority: Option<Vec<AlertPriority>>,

    /// Tag filter (PT-8), **already resolved to alert IDs** by the service
    /// layer, which owns the in-memory alert cache the infra layer cannot
    /// reach. `None` = no tag filter.
    ///
    /// `Some(empty)` means "no alert carries these tags" and MUST match
    /// nothing — collapsing it back to `None` would turn a zero-result filter
    /// into a match-all, the same class of bug the filter parser guards
    /// against.
    pub tag_alert_ids: Option<Vec<String>>,

    /// Optional sort column (PT-3). `None` keeps the historical ordering
    /// (name, then folder name).
    pub sort_by: Option<AlertSortField>,

    /// Sort direction; ignored when `sort_by` is `None`.
    pub sort_desc: bool,
}

/// Columns the alert list can be sorted by (PT-3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertSortField {
    /// Ascending = most urgent first, because P1 stores as 1.
    Priority,
    Name,
}

impl ListAlertsParams {
    /// Returns new parameters to list dashboards for the given org ID surrogate
    /// key.
    pub fn new(org_id: &str) -> Self {
        Self {
            org_id: org_id.to_owned(),
            folder_id: None,
            name_substring: None,
            stream_type_and_name: None,
            enabled: None,
            owner: None,
            page_size_and_idx: None,
            alert_type: AlertTypeFilter::All,
            priority: None,
            tag_alert_ids: None,
            sort_by: None,
            sort_desc: false,
        }
    }

    /// Filter by one or more priorities (OR). An empty vec means "matched
    /// nothing", NOT "no filter" — see the field docs.
    pub fn with_priorities(mut self, priorities: Vec<AlertPriority>) -> Self {
        self.priority = Some(priorities);
        self
    }

    /// Filter by a tag-resolved alert-ID set (see `tag_alert_ids`).
    pub fn with_tag_alert_ids(mut self, ids: Vec<String>) -> Self {
        self.tag_alert_ids = Some(ids);
        self
    }

    /// Sort by a column. Ascending priority = most urgent first (PT-3).
    pub fn sorted_by(mut self, field: AlertSortField, desc: bool) -> Self {
        self.sort_by = Some(field);
        self.sort_desc = desc;
        self
    }

    /// Filter alerts by the given folder ID surrogate key.
    pub fn in_folder(mut self, folder_id: &str) -> Self {
        self.folder_id = Some(folder_id.to_string());
        self
    }

    /// Filter alerts by the given case-insensitive name substring.
    pub fn with_name_substring(mut self, name_substring: &str) -> Self {
        self.name_substring = Some(name_substring.to_string());
        self
    }

    /// Filter alerts by the given stream type and optional stream name.
    pub fn for_stream(mut self, stream_type: StreamType, stream_name: Option<&str>) -> Self {
        self.stream_type_and_name = Some((stream_type, stream_name.map(|n| n.to_string())));
        self
    }

    /// Paginate the results by the given page size and page index.
    pub fn paginate(mut self, page_size: u64, page_idx: u64) -> Self {
        self.page_size_and_idx = Some((page_size, page_idx));
        self
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use serde_json;
    use svix_ksuid::Ksuid;

    use super::*;
    use crate::ider;

    #[test]
    fn test_alert_default() {
        let alert = Alert::default();

        assert_eq!(alert.id, None);
        assert_eq!(alert.name, "");
        assert_eq!(alert.org_id, "");
        assert_eq!(alert.stream_type, StreamType::default());
        assert_eq!(alert.stream_name, "");
        assert_eq!(alert.is_real_time, false);
        assert_eq!(alert.query_condition, QueryCondition::default());
        assert_eq!(alert.trigger_condition, TriggerCondition::default());
        assert!(alert.destinations.is_empty());
        assert_eq!(alert.context_attributes, None);
        assert_eq!(alert.row_template, "");
        assert_eq!(alert.row_template_type, RowTemplateType::String);
        assert_eq!(alert.description, "");
        assert_eq!(alert.enabled, false);
        assert_eq!(alert.tz_offset, 0);
        assert_eq!(alert.last_triggered_at, None);
        assert_eq!(alert.last_satisfied_at, None);
        assert_eq!(alert.owner, None);
        assert_eq!(alert.updated_at, None);
        assert_eq!(alert.last_edited_by, None);
    }

    #[test]
    fn test_alert_partial_eq() {
        let alert1 = Alert {
            name: "test_alert".to_string(),
            stream_type: StreamType::Logs,
            stream_name: "test_stream".to_string(),
            ..Default::default()
        };

        let alert2 = Alert {
            name: "test_alert".to_string(),
            stream_type: StreamType::Logs,
            stream_name: "test_stream".to_string(),
            org_id: "different_org".to_string(), // Different org_id
            ..Default::default()
        };

        let alert3 = Alert {
            name: "different_alert".to_string(), // Different name
            stream_type: StreamType::Logs,
            stream_name: "test_stream".to_string(),
            ..Default::default()
        };

        // Should be equal because only name, stream_type, and stream_name matter
        assert_eq!(alert1, alert2);

        // Should not be equal because name is different
        assert_ne!(alert1, alert3);
    }

    #[test]
    fn test_get_unique_key_with_id() {
        let ksuid_str = ider::uuid();
        let ksuid = Ksuid::from_str(&ksuid_str).unwrap();
        let alert = Alert {
            id: Some(ksuid),
            ..Default::default()
        };

        assert_eq!(alert.get_unique_key(), ksuid_str);
    }

    #[test]
    fn test_get_unique_key_without_id() {
        let alert = Alert {
            id: None,
            ..Default::default()
        };

        assert_eq!(alert.get_unique_key(), "");
    }

    #[test]
    fn test_get_last_satisfied_at_from_trigger_data() {
        let trigger_data = ScheduledTriggerData {
            last_satisfied_at: Some(1234567890),
            ..Default::default()
        };
        let trigger_data_json = serde_json::to_string(&trigger_data).unwrap();

        let trigger = Trigger {
            data: trigger_data_json,
            ..Default::default()
        };

        let alert = Alert {
            last_satisfied_at: Some(987654321), // This should be ignored
            ..Default::default()
        };

        let result = alert.get_last_satisfied_at(Some(&trigger));
        assert_eq!(result, Some(1234567890));
    }

    #[test]
    fn test_get_last_satisfied_at_fallback_to_alert_table() {
        let trigger = Trigger {
            data: "invalid_json".to_string(), // Invalid JSON
            ..Default::default()
        };

        let alert = Alert {
            last_satisfied_at: Some(987654321),
            ..Default::default()
        };

        let result = alert.get_last_satisfied_at(Some(&trigger));
        assert_eq!(result, Some(987654321));
    }

    #[test]
    fn test_get_last_satisfied_at_no_trigger() {
        let alert = Alert {
            last_satisfied_at: Some(987654321),
            ..Default::default()
        };

        let result = alert.get_last_satisfied_at(None);
        assert_eq!(result, Some(987654321));
    }

    #[test]
    fn test_get_last_satisfied_at_none() {
        let alert = Alert {
            last_satisfied_at: None,
            ..Default::default()
        };

        let result = alert.get_last_satisfied_at(None);
        assert_eq!(result, None);
    }

    #[test]
    fn test_get_last_triggered_at_from_trigger() {
        let trigger = Trigger {
            start_time: Some(1234567890),
            ..Default::default()
        };

        let alert = Alert {
            last_triggered_at: Some(987654321), // This should be ignored
            ..Default::default()
        };

        let result = alert.get_last_triggered_at(Some(&trigger));
        assert_eq!(result, Some(1234567890));
    }

    #[test]
    fn test_get_last_triggered_at_fallback_to_alert_table() {
        let trigger = Trigger {
            start_time: None,
            ..Default::default()
        };

        let alert = Alert {
            last_triggered_at: Some(987654321),
            ..Default::default()
        };

        let result = alert.get_last_triggered_at(Some(&trigger));
        assert_eq!(result, Some(987654321));
    }

    #[test]
    fn test_get_last_triggered_at_no_trigger() {
        let alert = Alert {
            last_triggered_at: Some(987654321),
            ..Default::default()
        };

        let result = alert.get_last_triggered_at(None);
        assert_eq!(result, Some(987654321));
    }

    #[test]
    fn test_get_last_triggered_at_none() {
        let alert = Alert {
            last_triggered_at: None,
            ..Default::default()
        };

        let result = alert.get_last_triggered_at(None);
        assert_eq!(result, None);
    }

    #[test]
    fn test_get_last_triggered_at_from_table() {
        let alert = Alert {
            last_triggered_at: Some(1234567890),
            ..Default::default()
        };

        assert_eq!(alert.get_last_triggered_at_from_table(), Some(1234567890));
    }

    #[test]
    fn test_get_last_satisfied_at_from_table() {
        let alert = Alert {
            last_satisfied_at: Some(1234567890),
            ..Default::default()
        };

        assert_eq!(alert.get_last_satisfied_at_from_table(), Some(1234567890));
    }

    #[test]
    fn test_set_last_satisfied_at() {
        let mut alert = Alert::default();

        alert.set_last_satisfied_at(Some(1234567890));
        assert_eq!(alert.last_satisfied_at, Some(1234567890));

        alert.set_last_satisfied_at(None);
        assert_eq!(alert.last_satisfied_at, None);
    }

    #[test]
    fn test_set_last_triggered_at() {
        let mut alert = Alert::default();

        alert.set_last_triggered_at(Some(1234567890));
        assert_eq!(alert.last_triggered_at, Some(1234567890));

        alert.set_last_triggered_at(None);
        assert_eq!(alert.last_triggered_at, None);
    }

    #[test]
    fn test_list_alerts_params_new() {
        let params = ListAlertsParams::new("test_org");

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.folder_id, None);
        assert_eq!(params.name_substring, None);
        assert_eq!(params.stream_type_and_name, None);
        assert_eq!(params.enabled, None);
        assert_eq!(params.owner, None);
        assert_eq!(params.page_size_and_idx, None);
    }

    #[test]
    fn test_list_alerts_params_in_folder() {
        let params = ListAlertsParams::new("test_org").in_folder("test_folder");

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.folder_id, Some("test_folder".to_string()));
    }

    #[test]
    fn test_list_alerts_params_with_name_substring() {
        let params = ListAlertsParams::new("test_org").with_name_substring("test");

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.name_substring, Some("test".to_string()));
    }

    #[test]
    fn test_list_alerts_params_for_stream() {
        let params =
            ListAlertsParams::new("test_org").for_stream(StreamType::Logs, Some("test_stream"));

        assert_eq!(params.org_id, "test_org");
        assert_eq!(
            params.stream_type_and_name,
            Some((StreamType::Logs, Some("test_stream".to_string())))
        );
    }

    #[test]
    fn test_list_alerts_params_for_stream_no_name() {
        let params = ListAlertsParams::new("test_org").for_stream(StreamType::Metrics, None);

        assert_eq!(params.org_id, "test_org");
        assert_eq!(
            params.stream_type_and_name,
            Some((StreamType::Metrics, None))
        );
    }

    #[test]
    fn test_list_alerts_params_paginate() {
        let params = ListAlertsParams::new("test_org").paginate(10, 2);

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.page_size_and_idx, Some((10, 2)));
    }

    #[test]
    fn test_list_alerts_params_chaining() {
        let params = ListAlertsParams::new("test_org")
            .in_folder("test_folder")
            .with_name_substring("test")
            .for_stream(StreamType::Logs, Some("test_stream"))
            .paginate(20, 1);

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.folder_id, Some("test_folder".to_string()));
        assert_eq!(params.name_substring, Some("test".to_string()));
        assert_eq!(
            params.stream_type_and_name,
            Some((StreamType::Logs, Some("test_stream".to_string())))
        );
        assert_eq!(params.page_size_and_idx, Some((20, 1)));
    }

    #[test]
    fn test_creates_incident_defaults_to_false() {
        // Deserializing an alert JSON without creates_incident should default to false
        let json = r#"{
            "name": "test_alert",
            "org_id": "test_org",
            "stream_type": "logs",
            "stream_name": "test_stream",
            "is_real_time": false,
            "destinations": [],
            "description": "",
            "enabled": false,
            "tz_offset": 0
        }"#;
        let alert: Alert = serde_json::from_str(json).unwrap();
        assert_eq!(alert.creates_incident, false);
    }

    #[test]
    fn test_row_template_type_backward_compatibility() {
        // Test that deserializing an alert without the row_template_type field
        // defaults to String variant for backward compatibility
        let json_without_field = r#"{
            "name": "test_alert",
            "org_id": "test_org",
            "stream_type": "logs",
            "stream_name": "test_stream",
            "is_real_time": false,
            "destinations": [],
            "row_template": "",
            "description": "",
            "enabled": false,
            "tz_offset": 0
        }"#;

        let alert: Alert = serde_json::from_str(json_without_field).unwrap();
        assert_eq!(alert.row_template_type, RowTemplateType::String);

        // Test that deserializing an alert with row_template_type set to Json works
        let json_with_json_variant = r#"{
            "name": "test_alert",
            "org_id": "test_org",
            "stream_type": "logs",
            "stream_name": "test_stream",
            "is_real_time": false,
            "destinations": [],
            "row_template": "",
            "row_template_type": "Json",
            "description": "",
            "enabled": false,
            "tz_offset": 0
        }"#;

        let alert: Alert = serde_json::from_str(json_with_json_variant).unwrap();
        assert_eq!(alert.row_template_type, RowTemplateType::Json);
    }

    #[test]
    fn test_alert_skip_serializing_if_none_fields_absent() {
        let alert = Alert {
            template: None,
            context_attributes: None,
            updated_at: None,
            deduplication: None,
            ..Default::default()
        };
        let json = serde_json::to_value(&alert).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("template"));
        assert!(!obj.contains_key("context_attributes"));
        assert!(!obj.contains_key("updated_at"));
        assert!(!obj.contains_key("deduplication"));
    }

    #[test]
    fn test_alert_skip_serializing_if_some_fields_present() {
        use chrono::TimeZone;

        use crate::meta::alerts::deduplication::DeduplicationConfig;
        let mut ctx = HashMap::new();
        ctx.insert("env".to_string(), "prod".to_string());
        let tz = chrono::FixedOffset::east_opt(0).unwrap();
        let dt = tz.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let alert = Alert {
            template: Some("my_template".to_string()),
            context_attributes: Some(ctx),
            updated_at: Some(dt),
            deduplication: Some(DeduplicationConfig::default()),
            ..Default::default()
        };
        let json = serde_json::to_value(&alert).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("template"));
        assert_eq!(obj["template"], serde_json::json!("my_template"));
        assert!(obj.contains_key("context_attributes"));
        assert!(obj.contains_key("updated_at"));
        assert!(obj.contains_key("deduplication"));
    }

    // ── Feature 2: list params (PT-3, PT-8) ─────────────────────────────────

    #[test]
    fn test_list_params_default_to_no_priority_tag_or_sort_filters() {
        let p = ListAlertsParams::new("org");
        assert_eq!(p.priority, None);
        assert_eq!(p.tag_alert_ids, None, "None = no tag filter at all");
        assert_eq!(p.sort_by, None, "None keeps the historical ordering");
        assert!(!p.sort_desc);
    }

    #[test]
    fn test_priority_filter_accepts_multiple_values_for_or_semantics() {
        let p = ListAlertsParams::new("org")
            .with_priorities(vec![AlertPriority::P1, AlertPriority::P2]);
        assert_eq!(p.priority, Some(vec![AlertPriority::P1, AlertPriority::P2]));
    }

    /// Same distinction the tag filter needs: "no filter" and "a filter that
    /// matched nothing" must not collapse together, or `?priority=P9` returns
    /// every alert instead of none.
    #[test]
    fn test_empty_priority_set_is_distinct_from_no_priority_filter() {
        let no_filter = ListAlertsParams::new("org");
        assert_eq!(no_filter.priority, None);

        let matched_nothing = ListAlertsParams::new("org").with_priorities(vec![]);
        assert_eq!(matched_nothing.priority, Some(vec![]));
        assert_ne!(no_filter.priority, matched_nothing.priority);
    }

    /// The distinction that prevents a match-all bug: "no tag filter" (`None`)
    /// and "a tag filter that matched nothing" (`Some(vec![])`) must stay
    /// different, or a zero-result filter silently returns every alert.
    #[test]
    fn test_empty_resolved_tag_set_is_distinct_from_no_tag_filter() {
        let no_filter = ListAlertsParams::new("org");
        assert_eq!(no_filter.tag_alert_ids, None);

        let matched_nothing = ListAlertsParams::new("org").with_tag_alert_ids(vec![]);
        assert_eq!(matched_nothing.tag_alert_ids, Some(vec![]));
        assert_ne!(no_filter.tag_alert_ids, matched_nothing.tag_alert_ids);
    }

    #[test]
    fn test_sort_builder_records_field_and_direction() {
        let asc = ListAlertsParams::new("org").sorted_by(AlertSortField::Priority, false);
        assert_eq!(asc.sort_by, Some(AlertSortField::Priority));
        assert!(!asc.sort_desc);

        let desc = ListAlertsParams::new("org").sorted_by(AlertSortField::Name, true);
        assert_eq!(desc.sort_by, Some(AlertSortField::Name));
        assert!(desc.sort_desc);
    }

    // ── Feature 2: priority & tags (PT-1, PT-6) ─────────────────────────────
    // These test the PRODUCTION `Alert`, unlike the stand-in pattern test in
    // `priority.rs` which proves only serde-attribute behaviour.

    #[test]
    fn test_alert_defaults_have_no_priority_and_no_tags() {
        let alert = Alert::default();
        assert_eq!(alert.priority, None, "unset is the default, never P1");
        assert!(alert.tags.is_empty());
    }

    /// G5: an alert that configures neither field must serialize EXACTLY as it
    /// did before Feature 2 — no new keys, so stored JSON and API payloads are
    /// byte-identical for every existing alert.
    #[test]
    fn test_unset_priority_and_empty_tags_are_omitted_entirely() {
        let alert = Alert::default();
        let json = serde_json::to_value(&alert).unwrap();
        let obj = json.as_object().unwrap();
        assert!(
            !obj.contains_key("priority"),
            "unset priority must not appear"
        );
        assert!(!obj.contains_key("tags"), "empty tags must not appear");
    }

    #[test]
    fn test_priority_and_tags_round_trip_through_serde() {
        let alert = Alert {
            priority: Some(AlertPriority::P2),
            tags: vec!["prod".to_string(), "service:checkout".to_string()],
            ..Default::default()
        };
        let json = serde_json::to_value(&alert).unwrap();
        // Integer wire form (D17) — matches the storage column exactly.
        assert_eq!(json["priority"], serde_json::json!(2));
        assert_eq!(
            json["tags"],
            serde_json::json!(["prod", "service:checkout"])
        );

        let back: Alert = serde_json::from_value(json).unwrap();
        assert_eq!(back.priority, Some(AlertPriority::P2));
        assert_eq!(back.tags, alert.tags);
    }

    /// PT-1: priority is MUTABLE static configuration. "Static" contrasts it
    /// with evaluated state; it does not mean write-once. An edit must be able
    /// to raise it, lower it, and clear it back to unset.
    #[test]
    fn test_priority_is_mutable_including_back_to_unset() {
        let mut alert = Alert::default();
        alert.priority = Some(AlertPriority::P4);
        assert_eq!(alert.priority, Some(AlertPriority::P4));

        alert.priority = Some(AlertPriority::P1); // raised
        assert_eq!(alert.priority, Some(AlertPriority::P1));

        alert.priority = None; // cleared
        let json = serde_json::to_value(&alert).unwrap();
        assert!(
            !json.as_object().unwrap().contains_key("priority"),
            "clearing must return to absent, not leave a stale value"
        );
    }

    #[test]
    fn test_tags_are_mutable_including_back_to_empty() {
        let mut alert = Alert::default();
        alert.tags = vec!["prod".to_string()];
        alert.tags.clear();
        let json = serde_json::to_value(&alert).unwrap();
        assert!(!json.as_object().unwrap().contains_key("tags"));
    }

    /// PT-1/PT-6: unlike the warning family (rejected on realtime by D12),
    /// priority and tags are inert metadata and ARE allowed on realtime
    /// alerts — excluding them would punch holes in list filtering.
    #[test]
    fn test_realtime_alerts_may_carry_priority_and_tags() {
        let alert = Alert {
            is_real_time: true,
            priority: Some(AlertPriority::P3),
            tags: vec!["prod".to_string()],
            ..Default::default()
        };
        let json = serde_json::to_value(&alert).unwrap();
        assert_eq!(json["priority"], serde_json::json!(3));
        assert_eq!(json["tags"], serde_json::json!(["prod"]));
    }

    /// Old payloads (no such keys) must still deserialize — the fields are
    /// additive.
    #[test]
    fn test_pre_feature2_payload_still_deserializes() {
        let legacy = serde_json::json!({ "name": "old", "org_id": "o" });
        let alert: Alert = serde_json::from_value(legacy).unwrap();
        assert_eq!(alert.name, "old");
        assert_eq!(alert.priority, None);
        assert!(alert.tags.is_empty());
    }
}
