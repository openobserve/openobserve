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

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

pub const DEFAULT_LIMIT: u64 = 20;
pub const MAX_LIMIT: u64 = 100;

/// Kinds of org metadata the resource search can return.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResourceType {
    Dashboard,
    Alert,
    Stream,
    SavedView,
    Function,
    Pipeline,
    User,
    ServiceAccount,
    Synthetic,
}

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchResourcesQuery {
    /// Text matched against names and ids; empty lists the alphabetical head of each type.
    #[serde(default)]
    pub q: String,
    /// Comma-separated subset of resource types; every type when absent.
    pub types: Option<String>,
    /// Rows returned per type, 1 to 100.
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ResourceHit {
    #[serde(rename = "type")]
    pub kind: ResourceType,
    pub id: String,
    pub name: String,
    pub score: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchResourcesResponse {
    pub hits: Vec<ResourceHit>,
    /// Types that matched more rows than `limit`.
    pub truncated: Vec<ResourceType>,
    pub took_ms: u64,
}

impl ResourceType {
    pub const ALL: [ResourceType; 9] = [
        ResourceType::Dashboard,
        ResourceType::Alert,
        ResourceType::Stream,
        ResourceType::SavedView,
        ResourceType::Function,
        ResourceType::Pipeline,
        ResourceType::User,
        ResourceType::ServiceAccount,
        ResourceType::Synthetic,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "dashboard" => Some(Self::Dashboard),
            "alert" => Some(Self::Alert),
            "stream" => Some(Self::Stream),
            "saved_view" => Some(Self::SavedView),
            "function" => Some(Self::Function),
            "pipeline" => Some(Self::Pipeline),
            "user" => Some(Self::User),
            "service_account" => Some(Self::ServiceAccount),
            "synthetic" => Some(Self::Synthetic),
            _ => None,
        }
    }
}

impl ResourceHit {
    pub fn new(kind: ResourceType, id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
            name: name.into(),
            score: 0,
            folder_id: None,
            folder_name: None,
            stream_type: None,
            enabled: None,
            email: None,
            role: None,
            description: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_every_wire_name_and_rejects_unknown() {
        for kind in ResourceType::ALL {
            let wire = serde_json::to_value(kind).unwrap();
            assert_eq!(ResourceType::parse(wire.as_str().unwrap()), Some(kind));
        }
        assert_eq!(ResourceType::parse(" alert "), Some(ResourceType::Alert));
        assert_eq!(ResourceType::parse("Dashboard"), None);
        assert_eq!(ResourceType::parse(""), None);
    }

    #[test]
    fn hit_serialises_type_and_omits_empty_optionals() {
        let hit = ResourceHit::new(ResourceType::SavedView, "v1", "errors");
        let json = serde_json::to_value(hit).unwrap();
        assert_eq!(json["type"], "saved_view");
        assert_eq!(json["score"], 0);
        assert!(json.get("folder_id").is_none());
    }
}
