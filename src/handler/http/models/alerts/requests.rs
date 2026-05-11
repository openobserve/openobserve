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

use config::meta::alerts::alert as meta_alerts;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

use super::{Alert, QueryCondition, StreamType};

/// HTTP request body for `CreateAlert` endpoint.
///
/// Creates a new alert with the specified configuration. The alert monitors
/// a stream (logs, metrics, or traces) and triggers notifications when conditions are met.
///
/// ## Example
///
/// ```json
/// {
///     "name": "High Error Rate Alert",
///     "stream_type": "logs",
///     "stream_name": "default",
///     "is_real_time": false,
///     "query_condition": {
///         "type": "sql",
///         "sql": "SELECT count(*) as count FROM \"default\" WHERE level = 'error'"
///     },
///     "trigger_condition": {
///         "period": 15,
///         "operator": ">=",
///         "threshold": 100,
///         "frequency": 5,
///         "frequency_type": "minutes",
///         "silence": 60
///     },
///     "destinations": ["slack-alerts"],
///     "enabled": true,
///     "description": "Alert when error count exceeds 100 in 15 minutes"
/// }
/// ```
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct CreateAlertRequestBody {
    /// Optional folder ID indicating the folder in which to create the alert.
    /// If omitted the alert will be created in the default folder.
    #[schema(example = "default")]
    pub folder_id: Option<String>,

    /// Discriminates the alert type. Defaults to scheduled alert when absent.
    /// Set to `"anomaly_detection"` to create an anomaly detection config instead.
    pub alert_type: Option<meta_alerts::AlertTypeFilter>,

    /// Anomaly-detection-specific fields (nested object).
    pub anomaly_config: Option<AnomalyAlertFields>,

    /// The alert configuration. All fields from Alert are flattened into this request body.
    #[serde(flatten)]
    #[schema(inline)]
    pub alert: Alert,
}

impl CreateAlertRequestBody {
    /// Return the anomaly config fields, combining `detection_function` +
    /// `detection_function_field` into the canonical "avg(field)" form.
    /// Returns `None` when no `anomaly_config` was supplied or when
    /// `detection_function` is missing (required).
    pub fn anomaly_fields(&self) -> Option<AnomalyAlertFields> {
        let mut base = self.anomaly_config.clone()?;
        base.detection_function = combine_detection_function(
            Some(base.detection_function),
            base.detection_function_field.take(),
        )?;
        Some(base)
    }
}

/// Anomaly-detection-specific fields for `CreateAlertRequestBody`.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AnomalyAlertFields {
    /// "filters" or "custom_sql"
    pub query_mode: String,
    pub filters: Option<serde_json::Value>,
    pub custom_sql: Option<String>,
    /// Aggregation function, e.g. "count(*)" or "avg(cpu_usage)"
    pub detection_function: String,
    /// Field to aggregate (required for avg/sum/min/max/pXX, ignored for count).
    /// Combined with `detection_function` into "avg(field)" before saving.
    pub detection_function_field: Option<String>,
    /// SQL histogram bucket size, e.g. "5m", "1h"
    pub histogram_interval: String,
    /// How often the detection job fires, e.g. "1h", "30m"
    pub schedule_interval: String,
    /// Look-back window per detection run, in seconds
    pub detection_window_seconds: i64,
    pub training_window_days: Option<i32>,
    /// 0 = never retrain automatically; otherwise days between retrains
    pub retrain_interval_days: Option<i32>,
    /// Percentile threshold (50.0–99.9). Default: 97.0
    /// Also accepts the name `threshold` (integer, e.g. 97) for API convenience.
    #[serde(alias = "threshold")]
    pub percentile: Option<f64>,
    pub rcf_num_trees: Option<i32>,
    pub rcf_tree_size: Option<i32>,
    pub rcf_shingle_size: Option<i32>,
    pub alert_enabled: Option<bool>,
}

/// HTTP request body for `UpdateAlert` endpoint.
///
/// Updates an existing alert. Provide the full alert configuration — this replaces
/// the existing alert entirely (not a partial update). The request body is the same
/// structure as Alert.
///
/// For anomaly detection configs, set `alert_type = "anomaly_detection"` and supply
/// anomaly-specific fields directly at the top level (flat). Only fields present in
/// the request body will be updated (partial update semantics for anomaly fields).
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct UpdateAlertRequestBody {
    /// Discriminates the alert type. When `"anomaly_detection"`, delegates to the
    /// anomaly config update path.
    pub alert_type: Option<meta_alerts::AlertTypeFilter>,

    /// Anomaly-detection-specific fields to update (partial — only supplied fields
    /// are changed).
    pub anomaly_config: Option<UpdateAnomalyAlertFields>,

    /// Alert configuration fields (used for scheduled/realtime alerts).
    #[serde(flatten)]
    #[schema(inline)]
    pub alert: Alert,
}

impl UpdateAlertRequestBody {
    /// Return the anomaly config fields, combining `detection_function` +
    /// `detection_function_field` into the canonical "avg(field)" form when both are present.
    pub fn anomaly_fields(&self) -> UpdateAnomalyAlertFields {
        let mut base = self.anomaly_config.clone().unwrap_or_default();
        // Combine detection_function + detection_function_field if either is supplied.
        if base.detection_function.is_some() || base.detection_function_field.is_some() {
            base.detection_function = combine_detection_function(
                base.detection_function,
                base.detection_function_field.take(),
            );
        }
        base
    }
}

/// Anomaly-detection-specific fields for `UpdateAlertRequestBody` (all optional).
#[derive(Clone, Debug, Default, Deserialize, Serialize, ToSchema)]
pub struct UpdateAnomalyAlertFields {
    pub name: Option<String>,
    pub description: Option<String>,
    pub query_mode: Option<String>,
    pub filters: Option<serde_json::Value>,
    pub custom_sql: Option<String>,
    pub detection_function: Option<String>,
    /// Field to aggregate. Combined with `detection_function` into "avg(field)" before saving.
    pub detection_function_field: Option<String>,
    pub histogram_interval: Option<String>,
    pub schedule_interval: Option<String>,
    pub detection_window_seconds: Option<i64>,
    pub training_window_days: Option<i32>,
    pub retrain_interval_days: Option<i32>,
    pub percentile: Option<f64>,
    pub alert_enabled: Option<bool>,
    pub enabled: Option<bool>,
    pub folder_id: Option<String>,
    pub owner: Option<String>,
}

/// HTTP request body for `MoveAlerts` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct MoveAlertsRequestBody {
    /// IDs of the alerts to move.
    #[schema(value_type = Vec<String>)]
    pub alert_ids: Vec<Ksuid>,

    /// IDs of anomaly detection configs to move. Defaults to empty when not
    /// provided. Callers should always supply this to avoid per-ID DB lookups.
    #[schema(value_type = Vec<String>)]
    #[serde(default)]
    pub anomaly_config_ids: Vec<Ksuid>,

    /// Indicates the folder to which alerts should be moved.
    pub dst_folder_id: String,
}

/// HTTP URL query component that contains parameters for listing alerts.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
#[serde(rename_all = "snake_case")]
#[into_params(rename_all = "snake_case")]
pub struct ListAlertsQuery {
    /// Optional folder ID filter parameter.
    pub folder: Option<String>,

    /// Optional stream type filter parameter.
    pub stream_type: Option<StreamType>,

    /// Optional stream name filter parameter.
    ///
    /// This parameter is only used if `stream_type` is also provided.
    pub stream_name: Option<String>,

    /// Optional case-insensitive name substring filter parameter.
    pub alert_name_substring: Option<String>,

    /// Optional owner user filter parameter.
    pub owner: Option<String>,

    /// Optional enabled filter parameter.
    pub enabled: Option<bool>,

    /// The optional number of alerts to retrieve. If not set then all alerts
    /// that match the query parameters will be returned.
    pub page_size: Option<u64>,

    /// The optional page index. If not set then defaults to `0`.
    ///
    /// This parameter is only used if `page_size` is also set.
    pub page_idx: Option<u64>,

    /// Optional alert type filter: `all` (default), `scheduled`, `realtime`,
    /// or `anomaly_detection`.
    pub alert_type: Option<meta_alerts::AlertTypeFilter>,
}

/// HTTP URL query component that contains parameters for enabling alerts.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
#[serde(rename_all = "snake_case")]
pub struct EnableAlertQuery {
    /// Set to `true` to enable the alert or `false` to disable the alert.
    pub value: bool,
    /// Pass the folder id, required for rbac
    pub folder: String,
}

impl From<CreateAlertRequestBody> for meta_alerts::Alert {
    fn from(value: CreateAlertRequestBody) -> Self {
        value.alert.into()
    }
}

impl From<UpdateAlertRequestBody> for meta_alerts::Alert {
    fn from(value: UpdateAlertRequestBody) -> Self {
        value.alert.into()
    }
}

impl ListAlertsQuery {
    pub fn into(self, org_id: &str) -> meta_alerts::ListAlertsParams {
        meta_alerts::ListAlertsParams {
            org_id: org_id.to_string(),
            folder_id: self.folder,
            name_substring: self.alert_name_substring,
            stream_type_and_name: self
                .stream_type
                .map(|stream_type| (stream_type.into(), self.stream_name)),
            enabled: self.enabled,
            owner: self.owner,
            page_size_and_idx: self
                .page_size
                .map(|page_size| (page_size, self.page_idx.unwrap_or(0))),
            alert_type: self.alert_type.unwrap_or_default(),
        }
    }
}

#[derive(Deserialize, ToSchema)]
pub struct AlertBulkEnableRequest {
    #[schema(value_type = Vec<String>)]
    pub ids: Vec<Ksuid>,
}

/// HTTP request body for `CloneAlert` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct CloneAlertRequestBody {
    /// Optional new name for the cloned alert. Defaults to `<source_name>_copy`.
    pub name: Option<String>,

    /// Optional folder ID to place the clone in. Defaults to the source folder.
    pub folder_id: Option<String>,
}

/// Combine a detection function name and optional field into the stored form.
///
/// "avg" + Some("cpu_millicores") → Some("avg(cpu_millicores)")
/// "count" + _ → Some("count(*)")
/// "avg" + None → Some("avg")  (legacy — field will use fallback at query-build time)
/// None → None
pub fn combine_detection_function(
    function: Option<String>,
    field: Option<String>,
) -> Option<String> {
    let fn_name = function?;
    if fn_name.contains('(') {
        // Already in combined form (e.g. "avg(cpu_millicores)") — pass through.
        return Some(fn_name);
    }
    let combined = match fn_name.as_str() {
        "count" => "count(*)".to_string(),
        other => match field {
            Some(f) if !f.is_empty() => format!("{}({})", other, f),
            _ => fn_name, // no field yet — store bare name, query builder will warn
        },
    };
    Some(combined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_combine_none_function_returns_none() {
        assert_eq!(combine_detection_function(None, None), None);
        assert_eq!(
            combine_detection_function(None, Some("field".to_string())),
            None
        );
    }

    #[test]
    fn test_combine_count_always_produces_star() {
        assert_eq!(
            combine_detection_function(Some("count".to_string()), None),
            Some("count(*)".to_string())
        );
        assert_eq!(
            combine_detection_function(Some("count".to_string()), Some("col".to_string())),
            Some("count(*)".to_string())
        );
    }

    #[test]
    fn test_combine_avg_with_field() {
        assert_eq!(
            combine_detection_function(Some("avg".to_string()), Some("cpu_usage".to_string())),
            Some("avg(cpu_usage)".to_string())
        );
        assert_eq!(
            combine_detection_function(Some("sum".to_string()), Some("bytes".to_string())),
            Some("sum(bytes)".to_string())
        );
    }

    #[test]
    fn test_combine_already_combined_passthrough() {
        assert_eq!(
            combine_detection_function(Some("avg(cpu)".to_string()), None),
            Some("avg(cpu)".to_string())
        );
        assert_eq!(
            combine_detection_function(Some("count(*)".to_string()), Some("field".to_string())),
            Some("count(*)".to_string())
        );
    }

    #[test]
    fn test_combine_without_field_returns_bare_name() {
        assert_eq!(
            combine_detection_function(Some("avg".to_string()), None),
            Some("avg".to_string())
        );
    }

    #[test]
    fn test_combine_empty_field_treated_as_missing() {
        assert_eq!(
            combine_detection_function(Some("avg".to_string()), Some("".to_string())),
            Some("avg".to_string())
        );
    }

    #[test]
    fn test_create_alert_anomaly_fields_none_when_no_anomaly_config() {
        let req: CreateAlertRequestBody = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(req.anomaly_fields().is_none());
    }

    #[test]
    fn test_create_alert_anomaly_fields_combines_function_and_field() {
        let req: CreateAlertRequestBody = serde_json::from_value(serde_json::json!({
            "anomaly_config": {
                "query_mode": "filters",
                "detection_function": "avg",
                "detection_function_field": "cpu_usage",
                "histogram_interval": "5m",
                "schedule_interval": "1h",
                "detection_window_seconds": 3600
            }
        }))
        .unwrap();
        let fields = req.anomaly_fields().unwrap();
        assert_eq!(fields.detection_function, "avg(cpu_usage)");
    }

    #[test]
    fn test_create_alert_anomaly_fields_passthrough_when_already_combined() {
        let req: CreateAlertRequestBody = serde_json::from_value(serde_json::json!({
            "anomaly_config": {
                "query_mode": "filters",
                "detection_function": "count(*)",
                "histogram_interval": "5m",
                "schedule_interval": "1h",
                "detection_window_seconds": 3600
            }
        }))
        .unwrap();
        let fields = req.anomaly_fields().unwrap();
        assert_eq!(fields.detection_function, "count(*)");
    }

    #[test]
    fn test_update_alert_anomaly_fields_default_when_no_anomaly_config() {
        let req: UpdateAlertRequestBody = serde_json::from_value(serde_json::json!({})).unwrap();
        let fields = req.anomaly_fields();
        assert!(fields.detection_function.is_none());
        assert!(fields.detection_function_field.is_none());
    }

    #[test]
    fn test_update_alert_anomaly_fields_combines_when_both_set() {
        let req: UpdateAlertRequestBody = serde_json::from_value(serde_json::json!({
            "anomaly_config": {
                "detection_function": "avg",
                "detection_function_field": "memory"
            }
        }))
        .unwrap();
        let fields = req.anomaly_fields();
        assert_eq!(fields.detection_function, Some("avg(memory)".to_string()));
    }

    #[test]
    fn test_list_alerts_query_into_all_fields() {
        let q = ListAlertsQuery {
            folder: Some("f1".to_string()),
            stream_type: None,
            stream_name: None,
            alert_name_substring: Some("test_alert".to_string()),
            owner: Some("user@example.com".to_string()),
            enabled: Some(true),
            page_size: Some(20),
            page_idx: Some(1),
            alert_type: None,
        };
        let params = q.into("my_org");
        assert_eq!(params.org_id, "my_org");
        assert_eq!(params.folder_id.as_deref(), Some("f1"));
        assert_eq!(params.name_substring.as_deref(), Some("test_alert"));
        assert_eq!(params.enabled, Some(true));
        assert_eq!(params.page_size_and_idx, Some((20, 1)));
    }

    #[test]
    fn test_list_alerts_query_into_defaults() {
        let q = ListAlertsQuery {
            folder: None,
            stream_type: None,
            stream_name: None,
            alert_name_substring: None,
            owner: None,
            enabled: None,
            page_size: None,
            page_idx: None,
            alert_type: None,
        };
        let params = q.into("org2");
        assert_eq!(params.org_id, "org2");
        assert!(params.folder_id.is_none());
        assert!(params.page_size_and_idx.is_none());
    }

    #[test]
    fn test_list_alerts_query_page_idx_defaults_to_zero() {
        let q = ListAlertsQuery {
            folder: None,
            stream_type: None,
            stream_name: None,
            alert_name_substring: None,
            owner: None,
            enabled: None,
            page_size: Some(5),
            page_idx: None,
            alert_type: None,
        };
        let params = q.into("org3");
        assert_eq!(params.page_size_and_idx, Some((5, 0)));
    }
}

/// HTTP request body for `GenerateSql` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct GenerateSqlRequestBody {
    /// Stream name to query
    #[schema(example = "default")]
    pub stream_name: String,

    /// Type of stream (logs, metrics, traces, etc.)
    pub stream_type: StreamType,

    /// Query condition containing aggregation and WHERE conditions
    /// The conditions field within QueryCondition supports both V1 and V2 formats
    pub query_condition: QueryCondition,
}
