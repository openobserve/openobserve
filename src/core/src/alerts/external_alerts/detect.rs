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

use serde_json::Value;

/// Result of inspecting an inbound webhook payload to figure out which
/// external alerting system produced it (spec §4.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedSource {
    Grafana,
    Alertmanager,
    Generic,
    Unknown,
}

impl DetectedSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            DetectedSource::Grafana => "grafana",
            DetectedSource::Alertmanager => "alertmanager",
            DetectedSource::Generic => "generic",
            DetectedSource::Unknown => "unknown",
        }
    }
}

fn object_has_status_and_labels(obj: &serde_json::Map<String, Value>) -> bool {
    matches!(obj.get("status"), Some(Value::String(_)))
        && matches!(obj.get("labels"), Some(Value::Object(_)))
}

/// Detect which external alerting system produced `body`, using the
/// `user_agent` header as a secondary signal for the Grafana/Alertmanager
/// ambiguity (both share the same `alerts[]` wire format).
pub fn detect_source(user_agent: Option<&str>, body: &Value) -> DetectedSource {
    if let Some(obj) = body.as_object() {
        let has_alerts_array = matches!(obj.get("alerts"), Some(Value::Array(_)));
        let has_group_or_version = obj.contains_key("groupKey") || obj.contains_key("version");
        if has_alerts_array && has_group_or_version {
            let ua_is_grafana = user_agent.map(|ua| ua.contains("Grafana")).unwrap_or(false);
            let has_grafana_keys =
                obj.contains_key("orgId") || obj.contains_key("title") || obj.contains_key("state");
            return if ua_is_grafana || has_grafana_keys {
                DetectedSource::Grafana
            } else {
                DetectedSource::Alertmanager
            };
        }

        if matches!(obj.get("source"), Some(Value::String(_))) {
            return DetectedSource::Generic;
        }

        if object_has_status_and_labels(obj) {
            return DetectedSource::Generic;
        }

        return DetectedSource::Unknown;
    }

    if let Some(arr) = body.as_array() {
        if !arr.is_empty()
            && arr.iter().all(|item| {
                item.as_object()
                    .map(|o| {
                        matches!(o.get("source"), Some(Value::String(_)))
                            || object_has_status_and_labels(o)
                    })
                    .unwrap_or(false)
            })
        {
            return DetectedSource::Generic;
        }
        return DetectedSource::Unknown;
    }

    DetectedSource::Unknown
}
