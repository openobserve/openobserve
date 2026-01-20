// Copyright 2025 OpenObserve Inc.
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
        alerts::{QueryCondition, TriggerCondition, deduplication::DeduplicationConfig},
        stream::StreamType,
        triggers::{ScheduledTriggerData, Trigger},
    },
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
        }
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
}
