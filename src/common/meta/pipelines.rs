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

use config::meta::stream::{RoutingCondition, StreamType};
use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PipeLine {
    pub name: String,
    pub description: String,
    pub stream_name: String,
    pub stream_type: StreamType,
    #[serde(skip_serializing_if = "Option::None")]
    pub routing: Option<HashMap<String, Vec<RoutingCondition>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PipeLineList {
    pub list: Vec<PipeLine>,
}
