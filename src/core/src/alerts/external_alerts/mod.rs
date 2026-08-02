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

pub mod detect;
pub mod generic;
pub mod grafana;

use config::meta::alerts::incidents::ExternalAlertEvent;
pub use detect::{DetectedSource, detect_source};

/// Tolerance applied when clamping a source-reported event timestamp against
/// our own receipt clock — guards against wildly skewed sender clocks
/// (spec §4.2).
pub const CLOCK_SKEW_TOLERANCE_MICROS: i64 = 3_600_000_000; // 1h

/// Dispatch to the per-format normalizer for `detected`.
pub fn normalize(
    detected: DetectedSource,
    body: &serde_json::Value,
    now_micros: i64,
) -> Result<Vec<ExternalAlertEvent>, String> {
    match detected {
        DetectedSource::Grafana | DetectedSource::Alertmanager => {
            grafana::normalize_am_format(body, now_micros)
        }
        DetectedSource::Generic => generic::normalize_generic(body, now_micros),
        DetectedSource::Unknown => Err("unrecognized payload format".to_string()),
    }
}

/// Derives a display label for the sender of a batch of normalized events,
/// from the first event's `source` label (spec §1: single request = single
/// label). Returns `None` when absent, empty, or whitespace-only — callers
/// fall back to the already-detected system name (spec §2).
pub fn derive_sender_label(events: &[ExternalAlertEvent]) -> Option<String> {
    events
        .first()
        .and_then(|e| e.labels.get("source"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Resolves the display name shown in the status panel: the sender-provided
/// label when present, otherwise the detected system name (grafana /
/// alertmanager / generic) — exactly today's behavior.
pub fn resolve_display_name(detected_source: &str, sender_label: Option<&str>) -> String {
    sender_label
        .filter(|s| !s.is_empty())
        .unwrap_or(detected_source)
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn grafana_payload() -> serde_json::Value {
        serde_json::json!({
            "receiver": "o2", "status": "firing", "orgId": 1,
            "title": "[FIRING:1]", "state": "alerting", "groupKey": "{}:{}",
            "version": "1", "externalURL": "https://grafana.example",
            "alerts": [{
                "status": "firing",
                "labels": {"alertname": "HighCPU", "namespace": "prod", "deployment": "checkout", "severity": "critical", "job": "kube-state-metrics"},
                "annotations": {"summary": "CPU high"},
                "startsAt": "2026-07-30T10:02:00Z", "endsAt": "0001-01-01T00:00:00Z",
                "generatorURL": "https://grafana.example/alerting/rule1",
                "fingerprint": "abcdef0123456789"
            }]
        })
    }

    fn alertmanager_payload() -> serde_json::Value {
        serde_json::json!({
            "version": "4", "groupKey": "{}:{alertname=\"DiskLatency\"}",
            "status": "firing", "receiver": "o2",
            "groupLabels": {}, "commonLabels": {}, "commonAnnotations": {},
            "externalURL": "http://am:9093", "truncatedAlerts": 0,
            "alerts": [{
                "status": "resolved",
                "labels": {"alertname": "DiskLatency", "namespace": "prod", "severity": "warning"},
                "annotations": {},
                "startsAt": "2026-07-30T10:00:00Z", "endsAt": "2026-07-30T10:30:00Z",
                "generatorURL": "http://prom/graph",
                "fingerprint": "ffff000011112222"
            }]
        })
    }

    const NOW: i64 = 1_785_405_600_000_000; // fixed "now" for clamp determinism

    #[test]
    fn test_detect_grafana_vs_alertmanager_vs_generic() {
        assert_eq!(
            detect_source(Some("Grafana/12.0"), &grafana_payload()),
            DetectedSource::Grafana
        );
        assert_eq!(
            detect_source(None, &grafana_payload()),
            DetectedSource::Grafana
        ); // orgId/title/state keys
        assert_eq!(
            detect_source(Some("Alertmanager/0.27.0"), &alertmanager_payload()),
            DetectedSource::Alertmanager
        );
        let generic =
            serde_json::json!({"status": "firing", "labels": {"service": "x"}, "title": "t"});
        assert_eq!(detect_source(None, &generic), DetectedSource::Generic);
        assert_eq!(
            detect_source(None, &serde_json::json!({"hello": 1})),
            DetectedSource::Unknown
        );
    }

    #[test]
    fn test_normalize_grafana_extracts_event_and_denies_job_label() {
        let evs = normalize(DetectedSource::Grafana, &grafana_payload(), NOW).unwrap();
        assert_eq!(evs.len(), 1);
        let ev = &evs[0];
        assert_eq!(ev.dedup_key, "abcdef0123456789");
        assert_eq!(
            ev.status,
            config::meta::alerts::incidents::ExternalAlertStatus::Firing
        );
        assert_eq!(
            ev.severity,
            config::meta::alerts::incidents::IncidentSeverity::P1
        ); // critical
        assert_eq!(ev.title, "HighCPU");
        assert_eq!(ev.labels.get("namespace").unwrap(), "prod");
        assert!(
            !ev.labels.contains_key("job"),
            "job label must be deny-listed"
        );
        assert_eq!(
            ev.source_url.as_deref(),
            Some("https://grafana.example/alerting/rule1")
        );
    }

    #[test]
    fn test_normalize_alertmanager_resolved_uses_endsat() {
        let evs = normalize(DetectedSource::Alertmanager, &alertmanager_payload(), NOW).unwrap();
        let ev = &evs[0];
        assert_eq!(
            ev.status,
            config::meta::alerts::incidents::ExternalAlertStatus::Resolved
        );
        // 2026-07-30T10:30:00Z in micros
        let expected = chrono::DateTime::parse_from_rfc3339("2026-07-30T10:30:00Z")
            .unwrap()
            .timestamp_micros();
        assert_eq!(ev.event_ts, expected);
    }

    #[test]
    fn test_event_ts_clamped_to_now_when_source_clock_is_wild() {
        let mut p = grafana_payload();
        p["alerts"][0]["startsAt"] = serde_json::json!("1999-01-01T00:00:00Z");
        let evs = normalize(DetectedSource::Grafana, &p, NOW).unwrap();
        assert_eq!(evs[0].event_ts, NOW - CLOCK_SKEW_TOLERANCE_MICROS);
    }

    #[test]
    fn test_normalize_generic_object_and_array() {
        let one = serde_json::json!({"status": "firing", "severity": "warning", "title": "db slow", "dedup_key": "k1", "labels": {"service": "db"}});
        let evs = normalize(DetectedSource::Generic, &one, NOW).unwrap();
        assert_eq!(evs.len(), 1);
        assert_eq!(
            evs[0].severity,
            config::meta::alerts::incidents::IncidentSeverity::P3
        );
        assert_eq!(evs[0].event_ts, NOW); // no ts supplied → receipt time

        let arr = serde_json::json!([one.clone(), {"status": "resolved", "title": "x", "labels": {"service": "db"}}]);
        let evs = normalize(DetectedSource::Generic, &arr, NOW).unwrap();
        assert_eq!(evs.len(), 2);
        // no dedup_key on second → hash of sorted labels, deterministic
        let evs2 = normalize(DetectedSource::Generic, &arr, NOW).unwrap();
        assert_eq!(evs[1].dedup_key, evs2[1].dedup_key);
        assert!(!evs[1].dedup_key.is_empty());
    }

    #[test]
    fn test_unknown_format_errors() {
        assert!(normalize(DetectedSource::Unknown, &serde_json::json!({"x": 1}), NOW).is_err());
    }

    fn event_with_label(source_label: Option<&str>) -> ExternalAlertEvent {
        let mut labels = HashMap::new();
        if let Some(s) = source_label {
            labels.insert("source".to_string(), s.to_string());
        }
        labels.insert("alertname".to_string(), "test".to_string());
        ExternalAlertEvent {
            status: config::meta::alerts::incidents::ExternalAlertStatus::Firing,
            dedup_key: "k".to_string(),
            title: "t".to_string(),
            severity: config::meta::alerts::incidents::IncidentSeverity::P3,
            labels,
            event_ts: 0,
            source_url: None,
            raw: serde_json::json!({}),
        }
    }

    #[test]
    fn test_derive_sender_label_present() {
        let events = vec![event_with_label(Some("solarwinds"))];
        assert_eq!(derive_sender_label(&events), Some("solarwinds".to_string()));
    }

    #[test]
    fn test_derive_sender_label_absent() {
        let events = vec![event_with_label(None)];
        assert_eq!(derive_sender_label(&events), None);
    }

    #[test]
    fn test_derive_sender_label_empty_string_treated_as_absent() {
        let events = vec![event_with_label(Some(""))];
        assert_eq!(derive_sender_label(&events), None);
    }

    #[test]
    fn test_derive_sender_label_whitespace_only_treated_as_absent() {
        let events = vec![event_with_label(Some("   "))];
        assert_eq!(derive_sender_label(&events), None);
    }

    #[test]
    fn test_derive_sender_label_trims_whitespace() {
        let events = vec![event_with_label(Some("  solarwinds  "))];
        assert_eq!(derive_sender_label(&events), Some("solarwinds".to_string()));
    }

    #[test]
    fn test_derive_sender_label_empty_events_list() {
        let events: Vec<ExternalAlertEvent> = vec![];
        assert_eq!(derive_sender_label(&events), None);
    }

    #[test]
    fn test_derive_sender_label_uses_first_event_only() {
        let first = event_with_label(Some("first-sender"));
        let mut second_labels = HashMap::new();
        second_labels.insert("source".to_string(), "second-sender".to_string());
        let second = ExternalAlertEvent {
            labels: second_labels,
            ..event_with_label(None)
        };
        let events = vec![first, second];
        assert_eq!(
            derive_sender_label(&events),
            Some("first-sender".to_string())
        );
    }

    #[test]
    fn test_resolve_display_name_with_label() {
        assert_eq!(
            resolve_display_name("generic", Some("solarwinds")),
            "solarwinds"
        );
    }

    #[test]
    fn test_resolve_display_name_without_label() {
        assert_eq!(resolve_display_name("generic", None), "generic");
    }

    #[test]
    fn test_resolve_display_name_empty_label_falls_back() {
        assert_eq!(resolve_display_name("grafana", Some("")), "grafana");
    }
}
