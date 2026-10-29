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

//! Alert acknowledgements: the `alert_acks` row and the ack API wire shapes.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::incidents::IncidentStatus;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AckSource {
    Ui,
    #[default]
    Api,
    Slack,
    Oncall,
    Incident,
}

/// What an `ack_event` history row records.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AckAction {
    Ack,
    Unack,
    TakeOver,
}

/// Which rule refused an Ack or a Mute.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RefusalRule {
    #[default]
    Role,
    Fga,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RefusalCode {
    #[default]
    AckRefused,
    MuteRefused,
}

/// One `alert_acks` row: the ack of one group's firing, keyed by (org, alert, group).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlertAck {
    pub org_id: String,
    pub alert_id: String,
    #[serde(default)]
    pub group_key: String,
    pub firing_started_at: i64,
    pub acked_by: String,
    pub acked_at: i64,
    #[serde(default)]
    pub ack_source: AckSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taken_over_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unacked_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unacked_by: Option<String>,
    pub updated_at: i64,
}

impl AlertAck {
    /// In force only for the firing it names, so a new firing always starts unacknowledged.
    pub fn in_force_for(&self, current_firing_started_at: Option<i64>) -> bool {
        self.unacked_at.is_none() && current_firing_started_at == Some(self.firing_started_at)
    }

    pub fn view(&self) -> AckView {
        AckView {
            group_key: self.group_key.clone(),
            firing_started_at: self.firing_started_at,
            acked_by: self.acked_by.clone(),
            acked_at: self.acked_at,
            ack_source: self.ack_source,
            taken_over_from: self.taken_over_from.clone(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AckView {
    #[serde(default)]
    pub group_key: String,
    pub firing_started_at: i64,
    pub acked_by: String,
    pub acked_at: i64,
    #[serde(default)]
    pub ack_source: AckSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub taken_over_from: Option<String>,
}

/// The alert list item's ack summary.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AlertAckSummary {
    pub acked_by: String,
    pub acked_at: i64,
    #[serde(default)]
    pub ack_source: AckSource,
    #[serde(default)]
    pub groups_acked: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct AckRequest {
    pub group_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub firing_started_at: Option<i64>,
    pub take_over: bool,
    pub all_groups: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct UnackRequest {
    pub group_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firing_started_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AckIncidentRef {
    pub id: String,
    pub status: IncidentStatus,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct StillPaging {
    pub response_id: String,
    pub team: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AckOncallOutcome {
    #[serde(default)]
    pub acknowledged: Vec<String>,
    #[serde(default)]
    pub still_paging: Vec<StillPaging>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AckResponse {
    pub changed: bool,
    #[serde(default)]
    pub acks: Vec<AckView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incident: Option<AckIncidentRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oncall: Option<AckOncallOutcome>,
    #[serde(default)]
    pub other_groups_unacked: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UnackResponse {
    pub changed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ack: Option<AckView>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AckListResponse {
    #[serde(default)]
    pub acks: Vec<AckView>,
}

/// The 409 bodies of `POST .../ack`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum AckConflict {
    NotFiring,
    FiringChanged { firing_started_at: i64 },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PersonRef {
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OnCallPersonRef {
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub team: String,
}

/// The 403 body shared by Ack and Mute: who is on call and who could act instead.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ActRefusal {
    pub code: RefusalCode,
    pub message: String,
    pub rule: RefusalRule,
    #[serde(default)]
    pub on_call: Vec<OnCallPersonRef>,
    #[serde(default)]
    pub can_act: Vec<PersonRef>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn ack(firing: i64) -> AlertAck {
        AlertAck {
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: "".into(),
            firing_started_at: firing,
            acked_by: "dana@acme.com".into(),
            acked_at: firing + 5,
            ack_source: AckSource::Slack,
            taken_over_from: None,
            unacked_at: None,
            unacked_by: None,
            updated_at: firing + 5,
        }
    }

    #[test]
    fn an_ack_is_in_force_only_for_its_own_firing_and_until_unacked() {
        let a = ack(100);
        assert!(a.in_force_for(Some(100)));
        assert!(!a.in_force_for(Some(200)));
        assert!(!a.in_force_for(None));
        let unacked = AlertAck {
            unacked_at: Some(300),
            ..a
        };
        assert!(!unacked.in_force_for(Some(100)));
    }

    #[test]
    fn sources_and_refusals_use_the_contract_strings() {
        for (source, text) in [
            (AckSource::Ui, "ui"),
            (AckSource::Api, "api"),
            (AckSource::Slack, "slack"),
            (AckSource::Oncall, "oncall"),
            (AckSource::Incident, "incident"),
        ] {
            assert_eq!(serde_json::to_value(source).unwrap(), json!(text));
        }
        assert_eq!(
            serde_json::to_value(AckConflict::NotFiring).unwrap(),
            json!({"code": "not_firing"})
        );
        assert_eq!(
            serde_json::to_value(AckConflict::FiringChanged {
                firing_started_at: 7
            })
            .unwrap(),
            json!({"code": "firing_changed", "firing_started_at": 7})
        );
        let refusal = ActRefusal {
            code: RefusalCode::MuteRefused,
            message: "m".into(),
            rule: RefusalRule::Fga,
            on_call: vec![OnCallPersonRef {
                email: "o@acme.com".into(),
                name: None,
                team: "sre".into(),
            }],
            can_act: vec![PersonRef {
                email: "admin@acme.com".into(),
                name: Some("Ada".into()),
            }],
        };
        assert_eq!(
            serde_json::to_value(&refusal).unwrap(),
            json!({
                "code": "mute_refused",
                "message": "m",
                "rule": "fga",
                "on_call": [{"email": "o@acme.com", "team": "sre"}],
                "can_act": [{"email": "admin@acme.com", "name": "Ada"}],
            })
        );
    }

    #[test]
    fn an_empty_ack_body_defaults_to_the_single_row_group() {
        let req: AckRequest = serde_json::from_value(json!({})).unwrap();
        assert_eq!(req, AckRequest::default());
        assert_eq!(req.group_key, "");
        let req: AckRequest =
            serde_json::from_value(json!({"take_over": true, "future": 1})).unwrap();
        assert!(req.take_over);
        let unack: UnackRequest = serde_json::from_value(json!({})).unwrap();
        assert_eq!(
            unack,
            UnackRequest::default(),
            "an unack names the same row as an ack"
        );
    }

    #[test]
    fn an_older_ack_row_decodes_and_a_newer_field_is_ignored() {
        let old: AlertAck = serde_json::from_value(json!({
            "org_id": "acme", "alert_id": "a1", "firing_started_at": 1,
            "acked_by": "d", "acked_at": 2, "updated_at": 2,
        }))
        .unwrap();
        assert_eq!(old.group_key, "");
        assert_eq!(old.ack_source, AckSource::Api);
        let newer: AlertAck = serde_json::from_value(json!({
            "org_id": "acme", "alert_id": "a1", "firing_started_at": 1,
            "acked_by": "d", "acked_at": 2, "updated_at": 2, "ack_note": "x",
        }))
        .unwrap();
        assert_eq!(newer, old);
        let a = ack(100);
        let back: AlertAck = serde_json::from_value(serde_json::to_value(&a).unwrap()).unwrap();
        assert_eq!(back, a);
        assert_eq!(a.view().ack_source, AckSource::Slack);
        assert!(
            serde_json::to_value(a.view())
                .unwrap()
                .get("taken_over_from")
                .is_none()
        );
    }
}
