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

    /// The name a person reads in a message; `as_str` stays the machine value.
    pub fn label(self) -> &'static str {
        match self {
            NotificationKind::Alert => "Alert",
            NotificationKind::Incident => "Incident",
            NotificationKind::Anomaly => "Anomaly",
            NotificationKind::Synthetics => "Synthetics",
            NotificationKind::Downtime => "Downtime",
            NotificationKind::OnCall => "On-call",
        }
    }

    pub fn parse(s: &str) -> Option<NotificationKind> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }

    /// The event as a person reads it for this kind: a downtime starts and ends, a page is paged.
    pub fn event_label(self, event: NotificationEvent) -> &'static str {
        match (self, event) {
            (NotificationKind::Downtime, NotificationEvent::Firing) => "Started",
            (NotificationKind::Downtime, NotificationEvent::Resolved) => "Ended",
            (NotificationKind::OnCall, NotificationEvent::Firing) => "Paged",
            (NotificationKind::OnCall, NotificationEvent::Resolved) => "Acknowledged",
            _ => event.label(),
        }
    }

    /// What `event` does to a PagerDuty, Opsgenie or ServiceNow record of this kind (D8).
    pub fn platform_action(self, event: NotificationEvent) -> PlatformAction {
        match (self, event) {
            (NotificationKind::Downtime, _) | (_, NotificationEvent::Informational) => {
                PlatformAction::Skip
            }
            (_, NotificationEvent::Firing) => PlatformAction::Trigger,
            // A resolve only where the module sends a recovery today (strict D8).
            (
                NotificationKind::Incident | NotificationKind::OnCall,
                NotificationEvent::Resolved,
            ) => PlatformAction::Skip,
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

    /// The name a person reads in a message; `as_str` stays the machine value.
    pub fn label(self) -> &'static str {
        match self {
            NotificationEvent::Firing => "Firing",
            NotificationEvent::Resolved => "Resolved",
            NotificationEvent::Informational => "Informational",
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
    fn a_downtime_and_a_page_read_their_own_event_words() {
        use NotificationEvent::*;
        assert_eq!(NotificationKind::Downtime.event_label(Firing), "Started");
        assert_eq!(NotificationKind::Downtime.event_label(Resolved), "Ended");
        assert_eq!(NotificationKind::OnCall.event_label(Firing), "Paged");
        assert_eq!(
            NotificationKind::OnCall.event_label(Resolved),
            "Acknowledged"
        );
        assert_eq!(NotificationKind::Alert.event_label(Firing), "Firing");
        assert_eq!(
            NotificationKind::Downtime.event_label(Informational),
            "Informational"
        );
    }

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
            (Incident, Resolved, Skip),
            (Synthetics, Firing, Trigger),
            (Synthetics, Resolved, Resolve),
            (Synthetics, Informational, Skip),
            (Downtime, Firing, Skip),
            (Downtime, Resolved, Skip),
            (Downtime, Informational, Skip),
            (OnCall, Firing, Trigger),
            (OnCall, Resolved, Skip),
            (OnCall, Informational, Skip),
        ];
        for (kind, event, want) in cases {
            assert_eq!(kind.platform_action(event), want, "{kind} {event}");
        }
    }
}
