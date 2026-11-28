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
use utoipa::ToSchema;

use super::change_events::{self, ChangeRisk};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhatChanged {
    #[serde(default)]
    pub changes: Vec<ChangeRow>,
    #[serde(default)]
    pub coverage: ChangeCoverage,
}

impl WhatChanged {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty() && self.coverage == ChangeCoverage::default()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct ChangeCoverage {
    pub detected_deploys: bool,
    pub change_events: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unreadable_streams: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unavailable_sources: Vec<String>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub regions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Deploy,
    Rollback,
    Redeploy,
    Config,
    Flag,
    Infra,
    Schema,
    Other,
}

impl From<change_events::ChangeKind> for ChangeKind {
    fn from(kind: change_events::ChangeKind) -> Self {
        match kind {
            change_events::ChangeKind::Deploy => Self::Deploy,
            change_events::ChangeKind::Config => Self::Config,
            change_events::ChangeKind::Flag => Self::Flag,
            change_events::ChangeKind::Infra => Self::Infra,
            change_events::ChangeKind::Schema => Self::Schema,
            change_events::ChangeKind::Other => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ChangeRow {
    pub at_us: i64,
    pub precision_secs: i64,
    pub onset_relation: OnsetRelation,
    pub service: String,
    pub kind: ChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_ref: Option<String>,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub git_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    pub source: ChangeSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk: Option<ChangeRisk>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OnsetRelation {
    Before,
    About,
    After,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSource {
    Detected,
    Ci,
    DetectedCi,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coverage_and_changes_share_an_explicit_wire_contract() {
        let coverage = ChangeCoverage {
            detected_deploys: true,
            change_events: false,
            unreadable_streams: vec!["traces/private".into()],
            unavailable_sources: vec!["change_events".into()],
            truncated: true,
            regions: vec!["east".into()],
        };
        let json = serde_json::to_value(coverage).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "detected_deploys": true, "change_events": false,
                "unreadable_streams": ["traces/private"],
                "unavailable_sources": ["change_events"], "truncated": true, "regions": ["east"],
            })
        );
        let change = ChangeRow {
            at_us: 1,
            precision_secs: 60,
            onset_relation: OnsetRelation::About,
            service: "checkout".into(),
            kind: ChangeKind::Deploy,
            env: None,
            region: None,
            from_ref: None,
            git_ref: Some("v2".into()),
            from_image: None,
            to_image: None,
            verdict: None,
            source: ChangeSource::DetectedCi,
            summary: None,
            url: None,
            author: None,
            rollback: None,
            risk: None,
            risk_reason: None,
            integration_name: None,
        };
        let json = serde_json::to_value(change).unwrap();
        assert_eq!(json["source"], "detected_ci");
        assert_eq!(json["ref"], "v2");
        assert_eq!(json["onset_relation"], "about");
        for key in [
            "env",
            "region",
            "from_ref",
            "from_image",
            "to_image",
            "verdict",
            "summary",
            "url",
            "author",
            "rollback",
            "risk",
            "risk_reason",
            "integration_name",
        ] {
            assert!(json.get(key).is_none(), "{key}: {json}");
        }
    }
}
