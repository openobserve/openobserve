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

use std::str::FromStr;

use config::meta::{alerts::alert as meta_alerts, folder as meta_folders, triggers::Trigger};
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

use super::{Alert, QueryCondition, TriggerCondition};

/// HTTP response body for `GetAlert` endpoint.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct GetAlertResponseBody(pub Alert);

/// HTTP response body for `ListAlerts` endpoint.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ListAlertsResponseBody {
    pub list: Vec<ListAlertsResponseBodyItem>,
}

/// An item in the list returned by the `ListAlerts` endpoint.
///
/// For `scheduled` and `realtime` alert types, `condition` and
/// `trigger_condition` are always present. For `anomaly_detection` items they
/// are absent; use `last_trained_at` and `status` instead.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ListAlertsResponseBodyItem {
    #[schema(value_type = String)]
    pub alert_id: Ksuid,
    pub folder_id: String,
    pub folder_name: String,
    pub name: String,
    pub owner: Option<String>,
    pub description: Option<String>,
    /// Discriminator: "scheduled" | "realtime" | "anomaly_detection"
    pub alert_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<QueryCondition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_condition: Option<TriggerCondition>,
    pub enabled: bool,
    pub last_triggered_at: Option<i64>,
    pub last_satisfied_at: Option<i64>,
    pub is_real_time: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_evaluations: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firing_count: Option<i64>,
    /// Timestamp (µs) when the anomaly model was last successfully trained.
    /// Only present for `anomaly_detection` items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_trained_at: Option<i64>,
    /// Scheduler status string. Only present for `anomaly_detection` items.
    /// Values: "waiting" | "active" | "training" | "failed" | "disabled"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// HTTP response body for `EnableAlert` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct EnableAlertResponseBody {
    pub enabled: bool,
}

impl From<(meta_alerts::Alert, Option<Trigger>)> for GetAlertResponseBody {
    fn from(value: (meta_alerts::Alert, Option<Trigger>)) -> Self {
        Self(value.into())
    }
}

impl TryFrom<Vec<(meta_folders::Folder, meta_alerts::Alert, Option<Trigger>)>>
    for ListAlertsResponseBody
{
    type Error = ();

    fn try_from(
        value: Vec<(meta_folders::Folder, meta_alerts::Alert, Option<Trigger>)>,
    ) -> Result<Self, Self::Error> {
        let rslt: Result<Vec<_>, _> = value
            .into_iter()
            .map(ListAlertsResponseBodyItem::try_from)
            .collect();
        Ok(Self { list: rslt? })
    }
}

impl TryFrom<(meta_folders::Folder, meta_alerts::Alert, Option<Trigger>)>
    for ListAlertsResponseBodyItem
{
    type Error = ();

    fn try_from(
        value: (meta_folders::Folder, meta_alerts::Alert, Option<Trigger>),
    ) -> Result<Self, Self::Error> {
        let folder = value.0;
        let alert = value.1;
        let trigger = value.2;
        let (last_triggered_at, last_satisfied_at) = (
            alert.get_last_triggered_at(trigger.as_ref()),
            alert.get_last_satisfied_at(trigger.as_ref()),
        );
        let alert_type = if alert.is_real_time {
            "realtime".to_string()
        } else {
            "scheduled".to_string()
        };
        Ok(Self {
            alert_id: alert.id.ok_or(())?,
            folder_id: folder.folder_id,
            folder_name: folder.name,
            name: alert.name,
            owner: alert.owner,
            description: Some(alert.description).filter(|d| !d.is_empty()),
            alert_type,
            condition: Some(alert.query_condition.into()),
            trigger_condition: Some(alert.trigger_condition.into()),
            enabled: alert.enabled,
            last_triggered_at,
            last_satisfied_at,
            is_real_time: alert.is_real_time,
            total_evaluations: None,
            firing_count: None,
            last_trained_at: None,
            status: None,
        })
    }
}

/// Converts a `serde_json::Value` returned by `anomaly_detection::list_configs`
/// into a `ListAlertsResponseBodyItem`. Returns `None` if required fields are
/// missing or the anomaly_id cannot be parsed as a KSUID.
pub fn anomaly_config_to_list_item(v: &serde_json::Value) -> Option<ListAlertsResponseBodyItem> {
    let anomaly_id_str = v.get("anomaly_id")?.as_str()?;
    let alert_id = Ksuid::from_str(anomaly_id_str).ok()?;

    let folder_id = v
        .get("folder_id")
        .and_then(|f| f.as_i64())
        .map(|id| id.to_string())
        .unwrap_or_else(|| "default".to_string());

    let status = v.get("status").and_then(|s| s.as_i64()).map(|s| {
        match s {
            0 => "waiting",
            1 => "active",
            2 => "training",
            3 => "failed",
            4 => "disabled",
            _ => "unknown",
        }
        .to_string()
    });

    Some(ListAlertsResponseBodyItem {
        alert_id,
        folder_id,
        folder_name: String::new(),
        name: v.get("name")?.as_str()?.to_string(),
        owner: v
            .get("owner")
            .and_then(|o| o.as_str())
            .map(String::from),
        description: v
            .get("description")
            .and_then(|d| d.as_str())
            .filter(|d| !d.is_empty())
            .map(String::from),
        alert_type: "anomaly_detection".to_string(),
        condition: None,
        trigger_condition: None,
        enabled: v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false),
        last_triggered_at: v.get("last_detection_run").and_then(|t| t.as_i64()),
        last_satisfied_at: v
            .get("last_anomaly_detected_at")
            .and_then(|t| t.as_i64()),
        is_real_time: false,
        total_evaluations: v.get("total_evaluations").and_then(|t| t.as_i64()),
        firing_count: v.get("firing_count").and_then(|t| t.as_i64()),
        last_trained_at: v
            .get("training_completed_at")
            .and_then(|t| t.as_i64()),
        status,
    })
}
#[derive(Default, Serialize, ToSchema)]
pub struct AlertBulkEnableResponse {
    #[schema(value_type = Vec<String>)]
    pub successful: Vec<Ksuid>,
    #[schema(value_type = Vec<String>)]
    pub unsuccessful: Vec<Ksuid>,
    pub err: Option<String>,
}

/// HTTP response body for `GenerateSql` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GenerateSqlResponseBody {
    /// The generated SQL query string
    #[schema(example = "SELECT * FROM \"my_stream\" WHERE field > 100")]
    pub sql: String,

    /// Optional metadata about the generated query
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<GenerateSqlMetadata>,
}

/// Metadata about the generated SQL query.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GenerateSqlMetadata {
    /// Whether aggregation is present
    pub has_aggregation: bool,

    /// Whether WHERE clause is present
    pub has_conditions: bool,

    /// Whether GROUP BY is present
    pub has_group_by: bool,
}
