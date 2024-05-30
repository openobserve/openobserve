// Copyright 2024 Zinc Labs Inc.
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

use ipnetwork::IpNetwork;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyslogRoute {
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub stream_name: String,
    #[serde(default)]
    #[schema(value_type = Vec<String>)]
    pub subnets: Vec<IpNetwork>,
    #[serde(default)]
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SyslogRoutes {
    pub routes: Vec<SyslogRoute>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyslogServer {
    pub state: bool,
}
