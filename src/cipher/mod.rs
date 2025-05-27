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

use o2_enterprise::enterprise::cipher::http_repr::HttpKey;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod registry;

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct KeyAddRequest {
    pub name: String,
    pub key: HttpKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyGetResponse {
    pub name: String,
    pub key: HttpKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyInfo {
    pub name: String,
    pub key: HttpKey,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct KeyListResponse {
    pub keys: Vec<KeyInfo>,
}
