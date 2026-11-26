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

//! Changes OpenObserve cannot detect itself, sent by CI or a user, kept in `_o2_change_events`.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::utils::json::{Map, Value};

/// Only `FeatureWriter::ChangeEvents` writes it; `is_feature_writer_stream` refuses every other
/// writer.
pub const CHANGE_EVENTS_STREAM: &str = "_o2_change_events";
/// The `incident_integrations.source_type` of a CI credential for the change intake.
pub const CHANGE_EVENTS_SOURCE_TYPE: &str = "change_events";
/// The `integration` value of an event a user added in the app.
pub const IN_APP_INTEGRATION: &str = "in-app";
pub const MAX_EVENTS_PER_REQUEST: usize = 100;
pub const MAX_ROLLBACK_CHARS: usize = 1000;
pub const RETENTION_DAYS: i64 = 90;
/// Fields only the server sets, whatever a payload claims.
const PROVENANCE_FIELDS: [&str; 4] = [
    "integration_id",
    "integration_name",
    "integration",
    "created_by",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Deploy,
    Config,
    Flag,
    Infra,
    Schema,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChangeRisk {
    Low,
    Medium,
    High,
}

/// One change; `service`, `kind` and `summary` are always present, the rest only when known.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChangeEvent {
    pub service: String,
    pub kind: ChangeKind,
    pub summary: String,
    /// Microseconds; absent means the time the server received it.
    #[serde(
        rename = "_timestamp",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub timestamp: Option<i64>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub ts_server_stamped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    pub git_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// A command or URL that undoes the change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rollback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk: Option<ChangeRisk>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk_reason: Option<String>,
    /// Accepted so a client may echo it, then replaced by the server.
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub integration_id: Option<String>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub integration_name: Option<String>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub integration: Option<String>,
    #[serde(default, skip_serializing)]
    #[schema(ignore)]
    pub created_by: Option<String>,
}

impl ChangeEvent {
    fn validate(&self, window: (i64, i64)) -> Result<(), String> {
        if self.service.trim().is_empty() {
            return Err("service cannot be empty".to_string());
        }
        if self.summary.trim().is_empty() {
            return Err("summary cannot be empty".to_string());
        }
        if self
            .rollback
            .as_ref()
            .is_some_and(|r| r.chars().count() > MAX_ROLLBACK_CHARS)
        {
            return Err(format!(
                "rollback cannot exceed {MAX_ROLLBACK_CHARS} characters"
            ));
        }
        // ingest drops a row outside its window, which would surface as a server error
        if self
            .timestamp
            .is_some_and(|ts| ts < window.0 || ts > window.1)
        {
            return Err(
                "_timestamp must be microseconds inside the ingestion time window".to_string(),
            );
        }
        Ok(())
    }

    /// The stream row: the event, its time, and the provenance the server vouches for.
    pub fn into_record(mut self, provenance: &Provenance, received_at: i64) -> Value {
        // readers match the service name exactly
        self.service = self.service.trim().to_string();
        self.summary = self.summary.trim().to_string();
        for field in [
            &mut self.env,
            &mut self.region,
            &mut self.source,
            &mut self.git_ref,
        ] {
            *field = field
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
        }
        let ts_server_stamped = self.timestamp.is_none();
        let timestamp = self.timestamp.unwrap_or(received_at);
        let mut row = match serde_json::to_value(self) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        };
        for field in PROVENANCE_FIELDS {
            row.remove(field);
        }
        row.insert("_timestamp".to_string(), Value::from(timestamp));
        row.insert(
            "ts_server_stamped".to_string(),
            Value::from(ts_server_stamped),
        );
        match provenance {
            Provenance::Integration { id, name } => {
                row.insert("integration_id".to_string(), Value::from(*id));
                row.insert("integration_name".to_string(), Value::from(*name));
            }
            Provenance::InApp { user } => {
                row.insert("integration".to_string(), Value::from(IN_APP_INTEGRATION));
                row.insert("created_by".to_string(), Value::from(*user));
            }
        }
        Value::Object(row)
    }
}

/// The request body: `{"events": [..]}` with 1 to 100 events, or one bare event.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum ChangeEventsRequest {
    Batch { events: Vec<ChangeEvent> },
    One(Box<ChangeEvent>),
}

/// Who the server says sent an event: an accepted CI token, or a signed-in user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provenance<'a> {
    Integration { id: &'a str, name: &'a str },
    InApp { user: &'a str },
}

/// The events of a body, or why it is a 400; `window` bounds `_timestamp` as ingest does (µs).
pub fn parse_events(body: Value, window: (i64, i64)) -> Result<Vec<ChangeEvent>, String> {
    let events = match body {
        Value::Object(mut map) if map.contains_key("events") => {
            let events = map.remove("events").unwrap_or_default();
            if let Some(extra) = map.keys().next() {
                return Err(format!("unknown field `{extra}`, expected `events`"));
            }
            serde_json::from_value::<Vec<ChangeEvent>>(events).map_err(|e| e.to_string())?
        }
        body @ Value::Object(_) => {
            vec![serde_json::from_value::<ChangeEvent>(body).map_err(|e| e.to_string())?]
        }
        _ => return Err("expected a change event or {\"events\": [..]}".to_string()),
    };
    if events.is_empty() {
        return Err("events cannot be empty".to_string());
    }
    if events.len() > MAX_EVENTS_PER_REQUEST {
        return Err(format!(
            "too many events in one request: {} > {MAX_EVENTS_PER_REQUEST}",
            events.len()
        ));
    }
    for (i, event) in events.iter().enumerate() {
        event
            .validate(window)
            .map_err(|e| format!("events[{i}]: {e}"))?;
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const WINDOW: (i64, i64) = (1, 10);

    fn event() -> Value {
        json!({"service": "checkout", "kind": "config", "summary": "raise pool size"})
    }

    #[test]
    fn receive_timestamp_precision_is_server_owned() {
        for (timestamp, expected) in [(None, true), (Some(5), false)] {
            let mut value = event();
            if let Some(timestamp) = timestamp {
                value["_timestamp"] = json!(timestamp);
            }
            value["ts_server_stamped"] = json!(!expected);
            let accepted = parse_events(value, WINDOW).unwrap().remove(0);
            let row = accepted.into_record(
                &Provenance::InApp {
                    user: "ana@example.com",
                },
                7,
            );
            assert_eq!(row["ts_server_stamped"], expected);
            assert_eq!(row["_timestamp"], timestamp.unwrap_or(7));
        }
    }

    #[test]
    fn a_bare_event_and_a_batch_both_parse() {
        assert_eq!(parse_events(event(), WINDOW).unwrap().len(), 1);
        let batch = json!({"events": [event(), event()]});
        assert_eq!(parse_events(batch, WINDOW).unwrap().len(), 2);
    }

    #[test]
    fn missing_or_empty_required_fields_and_unknown_fields_are_refused() {
        let mut missing = event();
        missing.as_object_mut().unwrap().remove("summary");
        assert!(
            parse_events(missing, WINDOW)
                .unwrap_err()
                .contains("summary")
        );
        let mut empty = event();
        empty["service"] = json!("  ");
        assert!(parse_events(empty, WINDOW).unwrap_err().contains("service"));
        let mut kind = event();
        kind["kind"] = json!("release");
        assert!(parse_events(kind, WINDOW).is_err());
        let mut unknown = event();
        unknown["team"] = json!("payments");
        assert!(parse_events(unknown, WINDOW).unwrap_err().contains("team"));
        let extra = json!({"events": [event()], "dry_run": true});
        assert!(parse_events(extra, WINDOW).unwrap_err().contains("dry_run"));
        assert!(parse_events(json!([event()]), WINDOW).is_err());
    }

    #[test]
    fn a_timestamp_outside_the_ingest_window_is_refused() {
        let mut timed = event();
        for (ts, ok) in [(1, true), (10, true), (0, false), (11, false)] {
            timed["_timestamp"] = json!(ts);
            assert_eq!(parse_events(timed.clone(), WINDOW).is_ok(), ok, "{ts}");
        }
    }

    #[test]
    fn the_batch_bounds_hold() {
        assert!(parse_events(json!({"events": []}), WINDOW).is_err());
        let full = json!({"events": vec![event(); MAX_EVENTS_PER_REQUEST]});
        assert_eq!(
            parse_events(full, WINDOW).unwrap().len(),
            MAX_EVENTS_PER_REQUEST
        );
        let over = json!({"events": vec![event(); MAX_EVENTS_PER_REQUEST + 1]});
        assert!(
            parse_events(over, WINDOW)
                .unwrap_err()
                .contains("too many events")
        );
        let mut rollback = event();
        rollback["rollback"] = json!("x".repeat(MAX_ROLLBACK_CHARS));
        assert!(parse_events(rollback.clone(), WINDOW).is_ok());
        rollback["rollback"] = json!("x".repeat(MAX_ROLLBACK_CHARS + 1));
        assert!(
            parse_events(rollback, WINDOW)
                .unwrap_err()
                .contains("rollback")
        );
    }

    #[test]
    fn the_record_carries_server_provenance_and_never_the_payloads() {
        let mut claimed = event();
        claimed["integration_id"] = json!("forged-id");
        claimed["integration_name"] = json!("forged");
        claimed["integration"] = json!("forged");
        claimed["created_by"] = json!("mallory@example.com");
        claimed["ref"] = json!("v42");
        let ci = parse_events(claimed.clone(), WINDOW).unwrap().remove(0);
        let row = ci.into_record(
            &Provenance::Integration {
                id: "i1",
                name: "deploy-bot",
            },
            7,
        );
        assert_eq!(row["integration_id"], "i1");
        assert_eq!(row["integration_name"], "deploy-bot");
        assert!(row.get("integration").is_none());
        assert!(row.get("created_by").is_none());
        assert_eq!(row["ref"], "v42");
        assert_eq!(row["kind"], "config");
        assert_eq!(row["_timestamp"], 7);

        let mut timed = claimed;
        timed["_timestamp"] = json!(5);
        let in_app = parse_events(timed, WINDOW).unwrap().remove(0);
        let row = in_app.into_record(
            &Provenance::InApp {
                user: "ana@example.com",
            },
            7,
        );
        assert_eq!(row["integration"], IN_APP_INTEGRATION);
        assert_eq!(row["created_by"], "ana@example.com");
        assert!(row.get("integration_id").is_none());
        assert!(row.get("integration_name").is_none());
        assert_eq!(row["_timestamp"], 5);
    }

    #[test]
    fn the_record_stores_service_and_summary_trimmed() {
        let padded = json!({
            "service": " checkout ", "kind": "deploy", "summary": "v42\n",
            "env": " prod ", "region": "\t", "source": " pipeline ", "ref": " abc123\n",
        });
        let event = parse_events(padded, WINDOW).unwrap().remove(0);
        let row = event.into_record(
            &Provenance::InApp {
                user: "ana@example.com",
            },
            7,
        );
        assert_eq!(row["service"], "checkout");
        assert_eq!(row["summary"], "v42");
        assert_eq!(row["env"], "prod");
        assert!(row.get("region").is_none());
        assert_eq!(row["source"], "pipeline");
        assert_eq!(row["ref"], "abc123");
    }
}
