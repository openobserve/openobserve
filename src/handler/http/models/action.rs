// Copyright (c) 2025. OpenObserve Inc.
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

use anyhow::anyhow;
use chrono::{DateTime, Utc};
use config::meta::actions::action::{Action, ActionStatus, ExecutionDetailsType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GetActionInfoResponse {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_run_at: DateTime<Utc>,
    pub created_by: String,
    pub description: String,
    pub status: ActionStatus,
}

impl TryFrom<Action> for GetActionInfoResponse {
    type Error = anyhow::Error;

    fn try_from(value: Action) -> Result<Self, Self::Error> {
        Ok(GetActionInfoResponse {
            id: value.id.ok_or(anyhow!("No Id for action"))?.to_string(),
            name: value.name,
            created_at: value.created_at,
            last_run_at: value.last_executed_at.unwrap_or(value.created_at),
            created_by: value.created_by,
            description: value.description,
            status: value.status,
        })
    }
}

pub struct GetActionListResponse {
    pub actions: Vec<GetActionInfoResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetActionDetailsResponse {
    pub id: String,
    pub name: String,
    pub environment_variables: HashMap<String, String>,
    pub frequency: ExecutionDetailsType,
    pub created_at: DateTime<Utc>,
    pub cron_expr: String,
    pub zip_file_name: String,
}

impl TryFrom<Action> for GetActionDetailsResponse {
    type Error = anyhow::Error;

    fn try_from(value: Action) -> Result<Self, Self::Error> {
        Ok(GetActionDetailsResponse {
            id: value.id.ok_or(anyhow!("No Id for action"))?.to_string(),
            name: value.name,
            environment_variables: value.environment_variables,
            frequency: value.execution_details,
            created_at: value.created_at,
            cron_expr: value.cron_expr.unwrap_or_else(|| "".to_string()),
            zip_file_name: value.zip_file_name,
        })
    }
}
