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

pub const EVENT_RESOLVED: &str = "resolved";
pub const EVENT_ACKNOWLEDGED: &str = "acknowledged";

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

    /// What `event` does to a PagerDuty, Opsgenie or ServiceNow record of this kind.
    pub fn platform_event(self, event: &str) -> PlatformEvent {
        let head = event.split(':').next().unwrap_or_default();
        match (self, head) {
            (NotificationKind::Alert, EVENT_RESOLVED) => PlatformEvent::Resolve,
            (NotificationKind::Alert, _) => PlatformEvent::Trigger,
            (NotificationKind::Downtime, _) => PlatformEvent::NotForKind,
            (_, EVENT_RESOLVED) => PlatformEvent::Resolve,
            (NotificationKind::OnCall, EVENT_ACKNOWLEDGED) => PlatformEvent::NoAck,
            (NotificationKind::Anomaly, "firing")
            | (NotificationKind::Incident, "opened" | "updated")
            | (NotificationKind::Synthetics, "firing" | "down")
            | (NotificationKind::OnCall, "paged" | "handoff") => PlatformEvent::Trigger,
            _ => PlatformEvent::NotForKind,
        }
    }

    /// True for the events that open or extend a platform record, the only ones closure refuses.
    pub fn opens_episode(self, event: &str) -> bool {
        self != NotificationKind::Alert && self.platform_event(event) == PlatformEvent::Trigger
    }

    /// True for events whose episode has no lifecycle, so it closes at insert.
    pub fn closed_at_insert(self, event: &str) -> bool {
        let head = event.split(':').next().unwrap_or_default();
        match self {
            NotificationKind::Downtime => true,
            NotificationKind::Synthetics => {
                matches!(head, "degraded" | "flaky" | "cert_expiring")
            }
            NotificationKind::OnCall => head == "test",
            _ => false,
        }
    }
}

impl std::fmt::Display for NotificationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlatformEvent {
    Trigger,
    Resolve,
    NoAck,
    NotForKind,
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
    }

    #[test]
    fn platform_rule_table() {
        use NotificationKind::*;
        use PlatformEvent::*;
        let cases = [
            (Anomaly, "firing:1700", Trigger),
            (Anomaly, "resolved", Resolve),
            (Incident, "opened", Trigger),
            (Incident, "updated:severity_changed:1", Trigger),
            (Incident, "resolved", Resolve),
            (Synthetics, "firing:r1", Trigger),
            (Synthetics, "down", Trigger),
            (Synthetics, "degraded:r1", NotForKind),
            (Synthetics, "flaky:r1", NotForKind),
            (Synthetics, "cert_expiring:r1", NotForKind),
            (Synthetics, "resolved", Resolve),
            (Downtime, "started", NotForKind),
            (Downtime, "resolved", NotForKind),
            (OnCall, "paged:1", Trigger),
            (OnCall, "handoff:2:9", Trigger),
            (OnCall, "acknowledged", NoAck),
            (OnCall, "coverage_gap:1", NotForKind),
            (OnCall, "verdict:5", NotForKind),
            (OnCall, "test", NotForKind),
            (OnCall, "resolved", Resolve),
        ];
        for (kind, event, want) in cases {
            assert_eq!(kind.platform_event(event), want, "{kind} {event}");
        }
    }

    #[test]
    fn opening_and_closed_at_insert_events() {
        use NotificationKind::*;
        assert!(Anomaly.opens_episode("firing:1"));
        assert!(!Anomaly.opens_episode("resolved"));
        assert!(Incident.opens_episode("updated:x:1"));
        assert!(!OnCall.opens_episode("acknowledged"));
        assert!(!Downtime.opens_episode("started"));
        assert!(!Alert.opens_episode("firing"));
        assert!(Downtime.closed_at_insert("started"));
        assert!(Synthetics.closed_at_insert("degraded:r1"));
        assert!(!Synthetics.closed_at_insert("firing:r1"));
        assert!(OnCall.closed_at_insert("test"));
        assert!(!Anomaly.closed_at_insert("firing:1"));
    }
}
