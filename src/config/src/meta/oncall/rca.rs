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

//! The RCA agent's context — subject-generic, so an alert-subject run and an incident-subject run
//! build the same shape.

use serde::{Deserialize, Serialize};

use super::subject::SubjectType;
use crate::meta::alerts::priority::AlertPriority;

/// What the RCA agent is told about the thing it is investigating.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RcaContext {
    pub subject_type: SubjectType,
    pub subject_id: String,
    // Omitted, never null: the agent routes on `"incident_id" in context`, which a null satisfies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_id: Option<String>,
    pub org_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_analysis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<AlertPriority>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub past_causes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(subject_type: SubjectType, incident_id: Option<String>) -> RcaContext {
        RcaContext {
            subject_type,
            subject_id: "al_ckt#1".to_string(),
            incident_id,
            org_id: "default".to_string(),
            previous_analysis: None,
            severity: None,
            past_causes: Vec::new(),
            alert_name: None,
            stream: None,
            dimensions: None,
        }
    }

    /// Pins the exact wire shape: an alert subject omits the key entirely,
    /// never sends it as `null`.
    #[test]
    fn test_incident_id_present_for_incident_absent_for_alert() {
        let incident = base(SubjectType::Incident, Some("inc_1".to_string()));
        let json = serde_json::to_value(&incident).unwrap();
        assert_eq!(json["incident_id"], serde_json::json!("inc_1"));

        let alert = base(SubjectType::Alert, None);
        let json = serde_json::to_value(&alert).unwrap();
        assert!(
            !json.as_object().unwrap().contains_key("incident_id"),
            "an alert subject must omit incident_id, not null it: {json}"
        );
    }

    #[test]
    fn test_past_causes_omitted_when_empty_present_when_not() {
        let empty = base(SubjectType::Alert, None);
        let json = serde_json::to_value(&empty).unwrap();
        assert!(!json.as_object().unwrap().contains_key("past_causes"));

        let mut with_causes = base(SubjectType::Alert, None);
        with_causes.past_causes = vec!["2x timeout".to_string()];
        let json = serde_json::to_value(&with_causes).unwrap();
        assert_eq!(json["past_causes"], serde_json::json!(["2x timeout"]));
    }
}
