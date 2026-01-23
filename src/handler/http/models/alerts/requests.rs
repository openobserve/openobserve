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

use config::meta::alerts::alert as meta_alerts;
use serde::Deserialize;
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

    /// The alert configuration. All fields from Alert are flattened into this request body.
    #[serde(flatten)]
    #[schema(inline)]
    pub alert: Alert,
}

/// HTTP request body for `UpdateAlert` endpoint.
///
/// Updates an existing alert. Provide the full alert configuration - this replaces
/// the existing alert entirely (not a partial update). The request body is the same
/// structure as Alert.
///
/// ## Example
///
/// ```json
/// {
///     "name": "Updated Alert Name",
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
///     "description": "Updated description"
/// }
/// ```
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct UpdateAlertRequestBody(#[schema(inline)] pub Alert);

/// HTTP request body for `MoveAlerts` endpoint.
#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct MoveAlertsRequestBody {
    /// IDs of the alerts to move.
    #[schema(value_type = Vec<String>)]
    pub alert_ids: Vec<Ksuid>,

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
}

/// HTTP URL query component that contains parameters for enabling alerts.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
#[serde(rename_all = "snake_case")]
pub struct EnableAlertQuery {
    /// Set to `true` to enable the alert or `false` to disable the alert.
    pub value: bool,
}

impl From<CreateAlertRequestBody> for meta_alerts::Alert {
    fn from(value: CreateAlertRequestBody) -> Self {
        value.alert.into()
    }
}

impl From<UpdateAlertRequestBody> for meta_alerts::Alert {
    fn from(value: UpdateAlertRequestBody) -> Self {
        value.0.into()
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
        }
    }
}

#[derive(Deserialize, ToSchema)]
pub struct AlertBulkEnableRequest {
    #[schema(value_type = Vec<String>)]
    pub ids: Vec<Ksuid>,
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
