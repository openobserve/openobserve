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
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct ListAlertsResponseBodyItem {
    #[schema(value_type = String)]
    pub alert_id: Ksuid,
    pub folder_id: String,
    pub folder_name: String,
    pub name: String,
    pub owner: Option<String>,
    pub description: Option<String>,
    pub condition: QueryCondition,
    pub trigger_condition: TriggerCondition,
    pub enabled: bool,
    pub last_triggered_at: Option<i64>,
    pub last_satisfied_at: Option<i64>,
    pub is_real_time: bool,
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
        Ok(Self {
            alert_id: alert.id.ok_or(())?,
            folder_id: folder.folder_id,
            folder_name: folder.name,
            name: alert.name,
            owner: alert.owner,
            description: Some(alert.description).filter(|d| !d.is_empty()),
            condition: alert.query_condition.into(),
            trigger_condition: alert.trigger_condition.into(),
            enabled: alert.enabled,
            last_triggered_at,
            last_satisfied_at,
            is_real_time: alert.is_real_time,
        })
    }
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
