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

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use strum::EnumCount;
use utoipa::ToSchema;

use crate::meta::folder::FolderType;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    EnumCount,
)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Dashboard,
    Alert,
    Stream,
    Function,
    Pipeline,
    Synthetic,
    User,
    ServiceAccount,
}

impl ResourceKind {
    pub const ALL: [Self; Self::COUNT] = [
        Self::Dashboard,
        Self::Alert,
        Self::Stream,
        Self::Function,
        Self::Pipeline,
        Self::Synthetic,
        Self::User,
        Self::ServiceAccount,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dashboard => "dashboard",
            Self::Alert => "alert",
            Self::Stream => "stream",
            Self::Function => "function",
            Self::Pipeline => "pipeline",
            Self::Synthetic => "synthetic",
            Self::User => "user",
            Self::ServiceAccount => "service_account",
        }
    }

    /// The folder type that holds this kind; folder renames and moves refresh its catalog.
    pub const fn folder_type(self) -> Option<FolderType> {
        match self {
            Self::Dashboard => Some(FolderType::Dashboards),
            Self::Alert => Some(FolderType::Alerts),
            Self::Synthetic => Some(FolderType::Synthetics),
            Self::Stream | Self::Function | Self::Pipeline | Self::User | Self::ServiceAccount => {
                None
            }
        }
    }

    pub fn from_folder_type(folder_type: FolderType) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.folder_type() == Some(folder_type))
    }
}

impl fmt::Display for ResourceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ResourceKind {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
            .ok_or("unknown resource type")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ResourceAlertType {
    Scheduled,
    Realtime,
    Composite,
    AnomalyDetection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum ResourceRoute {
    Dashboard {
        dashboard_id: String,
        folder_id: String,
    },
    Alert {
        alert_id: String,
        folder_id: String,
        alert_type: ResourceAlertType,
    },
    Stream {
        stream_type: String,
        stream_name: String,
    },
    Function {
        function_name: String,
    },
    Pipeline {
        pipeline_id: String,
    },
    Synthetic {
        check_id: String,
        folder_id: String,
    },
    User {
        email: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ResourceSummary {
    #[serde(rename = "type")]
    pub kind: ResourceKind,
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
    pub route_ref: ResourceRoute,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip)]
    pub email: Option<String>,
    #[serde(skip)]
    pub is_siem: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MatchTier {
    ExactName,
    ExactId,
    NamePrefix,
    WordPrefix,
    NameSubstring,
    EmailSubstring,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ResourceHit {
    #[serde(flatten)]
    pub summary: ResourceSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_tier: Option<MatchTier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Complete,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceReason {
    Loading,
    Disabled,
    PermissionDenied,
    PermissionUnavailable,
    ResourceExhausted,
    SourceUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SourceResult {
    #[serde(rename = "type")]
    pub kind: ResourceKind,
    pub status: SourceStatus,
    pub has_more: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SourceReason>,
}

#[derive(Debug, Clone)]
pub struct SearchQuery {
    pub q: String,
    pub types: Vec<ResourceKind>,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SearchResponse {
    pub hits: Vec<ResourceHit>,
    pub sources: Vec<SourceResult>,
    pub took_ms: u64,
}

#[derive(Debug)]
pub struct SummaryPage {
    pub items: Vec<ResourceSummary>,
    pub next: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_does_not_serialize_internal_authorization_metadata() {
        let row = ResourceSummary {
            kind: ResourceKind::User,
            id: "user@example.invalid".into(),
            name: "Test user".into(),
            folder_id: None,
            folder_name: None,
            route_ref: ResourceRoute::User {
                email: "user@example.invalid".into(),
            },
            enabled: None,
            email: Some("user@example.invalid".into()),
            is_siem: false,
        };
        let json = serde_json::to_value(row).unwrap();
        assert_eq!(json["type"], "user");
        assert!(json.get("email").is_none());
        assert!(json.get("is_siem").is_none());
        assert!(json.get("folder_id").is_none());
    }

    #[test]
    fn all_lists_each_kind_once_and_round_trips_its_name() {
        let unique = ResourceKind::ALL
            .into_iter()
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(unique.len(), ResourceKind::COUNT);
        for kind in ResourceKind::ALL {
            assert_eq!(kind.as_str().parse::<ResourceKind>(), Ok(kind));
            if let Some(folder_type) = kind.folder_type() {
                assert_eq!(ResourceKind::from_folder_type(folder_type), Some(kind));
            }
        }
    }
}
