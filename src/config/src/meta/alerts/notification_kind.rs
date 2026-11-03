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

//! Which producer a notification comes from, and what each of its events does on a platform.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    #[default]
    Alert,
    Incident,
    Anomaly,
    Synthetics,
    Downtime,
    OnCall,
}

impl NotificationKind {
    pub const ALL: [NotificationKind; 6] = [
        NotificationKind::Alert,
        NotificationKind::Incident,
        NotificationKind::Anomaly,
        NotificationKind::Synthetics,
        NotificationKind::Downtime,
        NotificationKind::OnCall,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            NotificationKind::Alert => "alert",
            NotificationKind::Incident => "incident",
            NotificationKind::Anomaly => "anomaly",
            NotificationKind::Synthetics => "synthetics",
            NotificationKind::Downtime => "downtime",
            NotificationKind::OnCall => "on_call",
        }
    }

    pub fn parse(s: &str) -> Option<NotificationKind> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }

    /// The reserved name of the kind's compiled default; alerts keep `o2_default_content`.
    pub fn compiled_default_name(self) -> &'static str {
        match self {
            NotificationKind::Alert => "o2_default_content",
            NotificationKind::Incident => "o2_default_incident",
            NotificationKind::Anomaly => "o2_default_anomaly",
            NotificationKind::Synthetics => "o2_default_synthetics",
            NotificationKind::Downtime => "o2_default_downtime",
            NotificationKind::OnCall => "o2_default_on_call",
        }
    }

    /// What `event` does to a PagerDuty, Opsgenie or ServiceNow record of this kind (D8).
    pub fn platform_action(self, event: NotificationEvent) -> PlatformAction {
        match (self, event) {
            (NotificationKind::Downtime, _) | (_, NotificationEvent::Informational) => {
                PlatformAction::Skip
            }
            (_, NotificationEvent::Firing) => PlatformAction::Trigger,
            (_, NotificationEvent::Resolved) => PlatformAction::Resolve,
        }
    }
}

impl std::fmt::Display for NotificationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NotificationEvent {
    #[default]
    Firing,
    Resolved,
    Informational,
}

impl NotificationEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            NotificationEvent::Firing => "firing",
            NotificationEvent::Resolved => "resolved",
            NotificationEvent::Informational => "informational",
        }
    }
}

impl std::fmt::Display for NotificationEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlatformAction {
    Trigger,
    Resolve,
    Skip,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_spelling_round_trips() {
        for kind in NotificationKind::ALL {
            assert_eq!(NotificationKind::parse(kind.as_str()), Some(kind));
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, format!("\"{}\"", kind.as_str()));
        }
        assert_eq!(NotificationKind::OnCall.as_str(), "on_call");
        assert_eq!(NotificationKind::parse("pages"), None);
        let event = serde_json::to_string(&NotificationEvent::Informational).unwrap();
        assert_eq!(event, "\"informational\"");
    }

    #[test]
    fn platform_rule_table() {
        use NotificationEvent::*;
        use NotificationKind::*;
        use PlatformAction::*;
        let cases = [
            (Alert, Firing, Trigger),
            (Alert, Resolved, Resolve),
            (Anomaly, Firing, Trigger),
            (Anomaly, Resolved, Resolve),
            (Incident, Firing, Trigger),
            (Incident, Resolved, Resolve),
            (Synthetics, Firing, Trigger),
            (Synthetics, Resolved, Resolve),
            (Synthetics, Informational, Skip),
            (Downtime, Firing, Skip),
            (Downtime, Resolved, Skip),
            (Downtime, Informational, Skip),
            (OnCall, Firing, Trigger),
            (OnCall, Resolved, Resolve),
            (OnCall, Informational, Skip),
        ];
        for (kind, event, want) in cases {
            assert_eq!(kind.platform_action(event), want, "{kind} {event}");
        }
    }
}
