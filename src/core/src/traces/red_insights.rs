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

use std::collections::{BTreeMap, HashMap};

use config::utils::sql::{quote_identifier, quote_sql_string};

pub const MANAGED_TAG: &str = "auto:red-insights";
pub const FOLDER_NAME: &str = "RED insights";
pub const MAX_SERVICES: usize = 20;
pub const MIN_REQUESTS_24H: u64 = 10_000;
pub const MAX_CREATES: usize = 15;

const HISTOGRAM_INTERVAL: &str = "5m";
const SCHEDULE_INTERVAL: &str = "1h";
const DETECTION_WINDOW_SECONDS: i64 = 3_900;
const MIN_BUCKET_REQUESTS: u32 = 20;
const NAME_SEPARATOR: &str = " · ";
/// Alert names forbid `/`; U+2215 reads the same and the web strip maps it back.
const NAME_SLASH: char = '\u{2215}';
/// The enterprise custom-SQL check rejects these as substrings anywhere in the query.
const DESTRUCTIVE_KEYWORDS: [&str; 4] = ["update", "delete", "drop", "insert"];
/// Mirrors G4's `ERROR_VOCABULARY` in anomaly_detection.rs; the gated validator test pins it.
const ERROR_VOCABULARY: [&str; 6] = ["error", "errors", "fatal", "critical", "5xx", "50x"];
const SERVICE_MARKER: &str = " WHERE service_name = '";
/// An OR, not `IN ('2','5')`: the IN list's `[` in the aggregate name panics the top-k rule.
const KIND_PREDICATE: &str = "CAST(span_kind AS VARCHAR) = '2' OR CAST(span_kind AS VARCHAR) = '5'";
/// Any root span is a request, whatever its kind: a trace starting at a client span entered there.
const ROOT_ARM: &str = "OR (reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RedSignal {
    Rate,
    ErrorRatio,
    P95Latency,
}

impl RedSignal {
    pub const ALL: [RedSignal; 3] = [
        RedSignal::Rate,
        RedSignal::ErrorRatio,
        RedSignal::P95Latency,
    ];

    pub fn tag(self) -> &'static str {
        match self {
            RedSignal::Rate => "red:rate",
            RedSignal::ErrorRatio => "red:errors",
            RedSignal::P95Latency => "red:p95",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            RedSignal::Rate => "rate",
            RedSignal::ErrorRatio => "errors",
            RedSignal::P95Latency => "p95",
        }
    }

    fn from_tag(tag: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.tag() == tag)
    }

    fn value_expr(self) -> &'static str {
        match self {
            RedSignal::Rate => "COUNT(*)",
            RedSignal::ErrorRatio => {
                "CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) / COUNT(*)"
            }
            RedSignal::P95Latency => "approx_percentile_cont(duration, 0.95)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceVolume {
    pub stream: String,
    pub service: String,
    pub requests_24h: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedDetector {
    pub id: String,
    pub stream: String,
    pub service: String,
    pub signal: RedSignal,
    pub enabled: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub create: Vec<(String, String, RedSignal)>,
    pub delete: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamColumns {
    pub has_parent: bool,
    pub has_status: bool,
    pub has_duration: bool,
}

/// What this cycle learned about a stream; a stream absent from the map counts as unread.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamRead {
    Read(StreamColumns),
    /// Its schema or volume read failed, so its detectors are left alone this cycle.
    Unread,
    /// Removed, or readable but unrankable, so its detectors are deleted.
    Retired,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectorTemplate {
    pub name: String,
    pub stream_name: String,
    pub stream_type: String,
    pub query_mode: String,
    pub custom_sql: String,
    pub detection_function: String,
    pub detection_function_field: Option<String>,
    pub histogram_interval: String,
    pub schedule_interval: String,
    pub detection_window_seconds: i64,
    pub alert_enabled: bool,
    pub alert_direction: String,
    pub tags: Vec<String>,
}

#[cfg(feature = "enterprise")]
impl DetectorTemplate {
    pub fn into_request(
        self,
        folder_id: &str,
    ) -> crate::anomaly_detection::CreateAnomalyConfigRequest {
        crate::anomaly_detection::CreateAnomalyConfigRequest {
            name: self.name,
            description: None,
            stream_name: self.stream_name,
            stream_type: self.stream_type,
            query_mode: self.query_mode,
            filters: None,
            custom_sql: Some(self.custom_sql),
            detection_function: self.detection_function,
            detection_function_field: self.detection_function_field,
            histogram_interval: self.histogram_interval,
            schedule_interval: self.schedule_interval,
            detection_window_seconds: self.detection_window_seconds,
            training_window_days: None,
            retrain_interval_days: None,
            percentile: None,
            alert_budget_per_day: None,
            level_half_width_seconds: None,
            rcf_num_trees: None,
            rcf_tree_size: None,
            rcf_shingle_size: None,
            band_width: None,
            alert_direction: Some(self.alert_direction),
            alert_window_buckets: None,
            alert_window_fire_pct: None,
            alert_window_recover_pct: None,
            alert_enabled: Some(self.alert_enabled),
            alert_destinations: vec![],
            enabled: None,
            folder_id: Some(folder_id.to_string()),
            owner: None,
            priority: None,
            tags: self.tags,
        }
    }
}

pub fn plan(
    enabled: bool,
    volumes: &[ServiceVolume],
    existing: &[ManagedDetector],
    max_services: usize,
    min_requests_24h: u64,
    max_creates: usize,
) -> Plan {
    if !enabled {
        let mut delete: Vec<String> = existing.iter().map(|d| d.id.clone()).collect();
        delete.sort();
        return Plan {
            create: vec![],
            delete,
        };
    }

    let mut ranked: Vec<&ServiceVolume> = volumes.iter().collect();
    ranked.sort_by(|a, b| {
        b.requests_24h
            .cmp(&a.requests_24h)
            .then_with(|| a.stream.cmp(&b.stream))
            .then_with(|| a.service.cmp(&b.service))
    });
    let kept: HashMap<(&str, &str), bool> = ranked
        .iter()
        .take(max_services.saturating_mul(2))
        .enumerate()
        .filter(|(_, v)| v.requests_24h >= min_requests_24h / 2)
        .map(|(rank, v)| {
            let selected = rank < max_services && v.requests_24h >= min_requests_24h;
            ((v.stream.as_str(), v.service.as_str()), selected)
        })
        .collect();

    let mut by_triple: BTreeMap<(&str, &str, RedSignal), Vec<&ManagedDetector>> = BTreeMap::new();
    for d in existing {
        by_triple
            .entry((d.stream.as_str(), d.service.as_str(), d.signal))
            .or_default()
            .push(d);
    }

    let mut delete = Vec::new();
    for (&(stream, service, _), group) in &by_triple {
        if kept.contains_key(&(stream, service)) {
            delete.extend(duplicates(group));
        } else {
            delete.extend(group.iter().map(|d| d.id.clone()));
        }
    }
    delete.sort();

    let create = ranked
        .iter()
        .filter(|v| kept.get(&(v.stream.as_str(), v.service.as_str())) == Some(&true))
        .flat_map(|v| RedSignal::ALL.map(|s| (v, s)))
        .filter(|(v, s)| !by_triple.contains_key(&(v.stream.as_str(), v.service.as_str(), *s)))
        .take(max_creates)
        .map(|(v, s)| (v.stream.clone(), v.service.clone(), s))
        .collect();

    Plan { create, delete }
}

/// Only a fully read or retired stream's detectors enter the plan, which may delete them.
pub fn on_read_streams(
    existing: Vec<ManagedDetector>,
    reads: &BTreeMap<String, StreamRead>,
) -> Vec<ManagedDetector> {
    existing
        .into_iter()
        .filter(|d| {
            matches!(
                reads.get(&d.stream),
                Some(StreamRead::Read(_) | StreamRead::Retired)
            )
        })
        .collect()
}

/// Classifies a stream whose schema read succeeded, `has` testing for a field.
pub fn read_stream(has: impl Fn(&str) -> bool) -> StreamRead {
    if !has("service_name") || !has("span_kind") {
        return StreamRead::Retired;
    }
    StreamRead::Read(StreamColumns {
        has_parent: has("reference_parent_span_id"),
        has_status: has("span_status"),
        has_duration: has("duration"),
    })
}

pub fn template(
    stream: &str,
    service: &str,
    signal: RedSignal,
    cols: &StreamColumns,
) -> Option<DetectorTemplate> {
    let skip = |reason: &str| {
        log::info!(
            "[RED insights] skipping {} for {stream}/{service}: {reason}",
            signal.label()
        );
        None
    };
    match signal {
        RedSignal::ErrorRatio if !cols.has_status => return skip("no span_status column"),
        RedSignal::P95Latency if !cols.has_duration => return skip("no duration column"),
        RedSignal::Rate if stream_name_is_error_restricted(stream) => {
            return skip("a count over an error-named stream fails the denominator rule");
        }
        _ => {}
    }
    let custom_sql = detector_sql(
        &quote_identifier(stream),
        &quote_sql_string(service),
        signal,
        cols.has_parent,
    );
    let lowered = custom_sql.to_lowercase();
    if DESTRUCTIVE_KEYWORDS.iter().any(|k| lowered.contains(k)) {
        return skip("the query would trip the destructive-keyword check");
    }
    let (detection_function, detection_function_field, alert_direction) = match signal {
        RedSignal::Rate => ("count", None, "both"),
        RedSignal::ErrorRatio => ("count", None, "above"),
        RedSignal::P95Latency => ("p95", Some("value".to_string()), "above"),
    };
    Some(DetectorTemplate {
        name: managed_name(stream, service, signal),
        stream_name: stream.to_string(),
        stream_type: "traces".to_string(),
        query_mode: "custom_sql".to_string(),
        custom_sql,
        detection_function: detection_function.to_string(),
        detection_function_field,
        histogram_interval: HISTOGRAM_INTERVAL.to_string(),
        schedule_interval: SCHEDULE_INTERVAL.to_string(),
        detection_window_seconds: DETECTION_WINDOW_SECONDS,
        alert_enabled: false,
        alert_direction: alert_direction.to_string(),
        tags: vec![MANAGED_TAG.to_string(), signal.tag().to_string()],
    })
}

/// Recovers `(service, signal)` from the tag and the exact template SQL, never the editable name.
pub fn parse_managed(tags: &[String], custom_sql: &str) -> Option<(String, RedSignal)> {
    let signal = tags.iter().find_map(|t| RedSignal::from_tag(t))?;
    let (head, rest) = custom_sql.split_once(SERVICE_MARKER)?;
    let quoted_stream = head.split_once(" AS value FROM ")?.1;
    let service = leading_sql_literal(rest)?;
    let quoted_service = quote_sql_string(&service);
    [true, false]
        .into_iter()
        .any(|has_parent| {
            detector_sql(quoted_stream, &quoted_service, signal, has_parent) == custom_sql
        })
        .then_some((service, signal))
}

/// Per-service request counts on one trace stream; the caller sets the 24h window.
pub fn volume_sql(stream: &str, cols: &StreamColumns) -> String {
    format!(
        "SELECT service_name, COUNT(*) FILTER (WHERE {}) AS requests FROM {} \
         GROUP BY service_name ORDER BY requests DESC LIMIT {}",
        request_predicate(cols.has_parent),
        quote_identifier(stream),
        MAX_SERVICES * 2
    )
}

/// Shared with the catalog's requestPredicate; unlike the service graph, roots of any kind count.
fn request_predicate(has_parent: bool) -> String {
    if has_parent {
        format!("{KIND_PREDICATE} {ROOT_ARM}")
    } else {
        KIND_PREDICATE.to_string()
    }
}

fn detector_sql(
    quoted_stream: &str,
    quoted_service: &str,
    signal: RedSignal,
    has_parent: bool,
) -> String {
    let having = match signal {
        RedSignal::Rate => String::new(),
        RedSignal::ErrorRatio | RedSignal::P95Latency => {
            format!(" HAVING COUNT(*) >= {MIN_BUCKET_REQUESTS}")
        }
    };
    format!(
        "SELECT histogram(_timestamp, '{HISTOGRAM_INTERVAL}') AS time_bucket, {} AS value \
         FROM {quoted_stream} WHERE service_name = {quoted_service} AND ({}) \
         GROUP BY time_bucket{having}",
        signal.value_expr(),
        request_predicate(has_parent),
    )
}

fn managed_name(stream: &str, service: &str, signal: RedSignal) -> String {
    [
        format!("RED {}", signal.label()),
        stream.to_string(),
        service.to_string(),
    ]
    .join(NAME_SEPARATOR)
    .replace('/', &NAME_SLASH.to_string())
}

/// Disabled detectors are the user's opt-out, so only enabled ones are ever deduplicated away.
fn duplicates(group: &[&ManagedDetector]) -> Vec<String> {
    let mut sorted = group.to_vec();
    // KSUIDs sort by creation time, so the smallest id is the oldest.
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let any_disabled = sorted.iter().any(|d| !d.enabled);
    sorted
        .iter()
        .enumerate()
        .filter(|(i, d)| d.enabled && (any_disabled || *i > 0))
        .map(|(_, d)| d.id.clone())
        .collect()
}

/// Reads a single-quoted SQL literal at the start of `s` (opening quote already consumed).
fn leading_sql_literal(s: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\'' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'\'') {
            chars.next();
            out.push('\'');
            continue;
        }
        return Some(out);
    }
    None
}

fn stream_name_is_error_restricted(stream: &str) -> bool {
    stream
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|token| ERROR_VOCABULARY.contains(&token.to_ascii_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_COLS: StreamColumns = StreamColumns {
        has_parent: true,
        has_status: true,
        has_duration: true,
    };
    const ROOT_ARM: &str = "OR (reference_parent_span_id IS NULL OR reference_parent_span_id = '')";

    fn vol(stream: &str, service: &str, requests_24h: u64) -> ServiceVolume {
        ServiceVolume {
            stream: stream.to_string(),
            service: service.to_string(),
            requests_24h,
        }
    }

    fn det(id: &str, service: &str, signal: RedSignal, enabled: bool) -> ManagedDetector {
        ManagedDetector {
            id: id.to_string(),
            stream: "default".to_string(),
            service: service.to_string(),
            signal,
            enabled,
        }
    }

    fn all_signals(id_prefix: &str, service: &str, enabled: bool) -> Vec<ManagedDetector> {
        RedSignal::ALL
            .iter()
            .enumerate()
            .map(|(i, s)| det(&format!("{id_prefix}{i}"), service, *s, enabled))
            .collect()
    }

    fn created_services(p: &Plan) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for (_, service, _) in &p.create {
            if !out.contains(service) {
                out.push(service.clone());
            }
        }
        out
    }

    fn plan_default(volumes: &[ServiceVolume], existing: &[ManagedDetector]) -> Plan {
        plan(true, volumes, existing, 20, 10_000, usize::MAX)
    }

    #[test]
    fn selection_requires_the_volume_threshold() {
        let p = plan_default(
            &[
                vol("default", "busy", 10_000),
                vol("default", "quiet", 9_999),
            ],
            &[],
        );
        assert_eq!(created_services(&p), vec!["busy"]);
        assert_eq!(p.create.len(), 3);
        assert!(p.delete.is_empty());
    }

    #[test]
    fn selection_keeps_only_the_top_n_across_streams() {
        let volumes: Vec<_> = (0..25)
            .map(|i| {
                vol(
                    if i % 2 == 0 { "a" } else { "b" },
                    &format!("svc{i:02}"),
                    100_000 - i,
                )
            })
            .collect();
        let p = plan_default(&volumes, &[]);
        let services = created_services(&p);
        assert_eq!(services.len(), 20);
        assert_eq!(services.first().unwrap(), "svc00");
        assert_eq!(services.last().unwrap(), "svc19");
    }

    #[test]
    fn ties_break_by_stream_then_service() {
        let forward = [
            vol("b", "x", 50_000),
            vol("a", "z", 50_000),
            vol("a", "y", 50_000),
        ];
        let mut reversed = forward.clone();
        reversed.reverse();
        for volumes in [&forward[..], &reversed[..]] {
            let p = plan(true, volumes, &[], 2, 10_000, usize::MAX);
            let picked: Vec<_> = p
                .create
                .iter()
                .map(|(st, sv, _)| (st.as_str(), sv.as_str()))
                .collect();
            assert_eq!(picked[0], ("a", "y"));
            assert_eq!(picked[3], ("a", "z"));
            assert_eq!(p.create.len(), 6);
        }
    }

    #[test]
    fn hysteresis_keeps_but_does_not_create_at_60_percent_of_threshold() {
        let volumes = [
            vol("default", "kept", 6_000),
            vol("default", "fresh", 6_000),
        ];
        let existing = all_signals("k", "kept", true);
        let p = plan_default(&volumes, &existing);
        assert!(p.create.is_empty(), "{:?}", p.create);
        assert!(p.delete.is_empty(), "{:?}", p.delete);
    }

    #[test]
    fn hysteresis_keeps_but_does_not_create_at_rank_30() {
        let mut volumes: Vec<_> = (0..29)
            .map(|i| vol("default", &format!("top{i:02}"), 1_000_000 - i))
            .collect();
        volumes.push(vol("default", "rank30", 500_000));
        volumes.push(vol("default", "rank31", 400_000));
        let mut existing = all_signals("e", "rank30", true);
        for i in 0..20 {
            existing.extend(all_signals(
                &format!("t{i:02}-"),
                &format!("top{i:02}"),
                true,
            ));
        }
        let p = plan_default(&volumes, &existing);
        assert!(p.create.is_empty(), "{:?}", p.create);
        assert!(p.delete.is_empty(), "{:?}", p.delete);
    }

    #[test]
    fn detectors_outside_the_hysteresis_band_are_deleted() {
        let mut volumes: Vec<_> = (0..40)
            .map(|i| vol("default", &format!("top{i:02}"), 1_000_000 - i))
            .collect();
        volumes.push(vol("default", "rank41", 100_000));
        volumes.push(vol("default", "low", 4_999));
        let mut existing = vec![det("a", "rank41", RedSignal::Rate, true)];
        existing.push(det("b", "low", RedSignal::Rate, true));
        existing.push(det("c", "gone", RedSignal::Rate, true));
        let p = plan(true, &volumes, &existing, 20, 10_000, 0);
        assert_eq!(p.delete, vec!["a", "b", "c"]);
    }

    #[test]
    fn creates_are_capped_per_cycle_in_rank_order() {
        let volumes = [
            vol("default", "first", 90_000),
            vol("default", "second", 80_000),
        ];
        let p = plan(true, &volumes, &[], 20, 10_000, 4);
        assert_eq!(
            p.create,
            vec![
                ("default".to_string(), "first".to_string(), RedSignal::Rate),
                (
                    "default".to_string(),
                    "first".to_string(),
                    RedSignal::ErrorRatio
                ),
                (
                    "default".to_string(),
                    "first".to_string(),
                    RedSignal::P95Latency
                ),
                ("default".to_string(), "second".to_string(), RedSignal::Rate),
            ]
        );
    }

    #[test]
    fn duplicate_triples_keep_the_oldest_id() {
        let volumes = [vol("default", "svc", 50_000)];
        let mut existing = all_signals("x", "svc", true);
        existing.push(det("2CdupNewer", "svc", RedSignal::Rate, true));
        existing.push(det("2AdupOlder", "svc", RedSignal::Rate, true));
        existing.retain(|d| !(d.signal == RedSignal::Rate && d.id.starts_with('x')));
        let p = plan_default(&volumes, &existing);
        assert!(p.create.is_empty());
        assert_eq!(p.delete, vec!["2CdupNewer"]);
    }

    #[test]
    fn duplicate_triples_never_delete_a_disabled_detector() {
        let volumes = [vol("default", "svc", 50_000)];
        let existing = vec![
            det("1older", "svc", RedSignal::Rate, true),
            det("2newer", "svc", RedSignal::Rate, false),
            det("3", "svc", RedSignal::ErrorRatio, true),
            det("4", "svc", RedSignal::P95Latency, true),
        ];
        let p = plan_default(&volumes, &existing);
        assert_eq!(p.delete, vec!["1older"]);
    }

    #[test]
    fn disabling_deletes_every_managed_detector() {
        let volumes = [vol("default", "svc", 50_000)];
        let mut existing = all_signals("a", "svc", true);
        existing.push(det("off", "svc", RedSignal::Rate, false));
        let p = plan(false, &volumes, &existing, 20, 10_000, 15);
        assert!(p.create.is_empty());
        assert_eq!(p.delete, vec!["a0", "a1", "a2", "off"]);
    }

    #[test]
    fn user_disabled_detectors_are_left_alone_while_kept() {
        let volumes = [vol("default", "svc", 50_000)];
        let existing = all_signals("d", "svc", false);
        let p = plan_default(&volumes, &existing);
        assert!(p.create.is_empty());
        assert!(p.delete.is_empty());
    }

    #[test]
    fn user_disabled_detectors_go_on_rank_loss_and_setting_off() {
        let existing = all_signals("d", "svc", false);
        let lost = plan_default(&[vol("default", "svc", 100)], &existing);
        assert_eq!(lost.delete, vec!["d0", "d1", "d2"]);
        let off = plan(
            false,
            &[vol("default", "svc", 50_000)],
            &existing,
            20,
            10_000,
            15,
        );
        assert_eq!(off.delete, vec!["d0", "d1", "d2"]);
    }

    #[test]
    fn planning_against_its_own_output_is_empty() {
        let volumes: Vec<_> = (0..30)
            .map(|i| vol("default", &format!("svc{i:02}"), 200_000 - i * 5_000))
            .collect();
        let mut existing = all_signals("old", "retired", true);
        existing.push(det("dupe", "svc00", RedSignal::Rate, true));
        existing.push(det("dupf", "svc00", RedSignal::Rate, true));
        let first = plan_default(&volumes, &existing);
        assert!(!first.create.is_empty());
        existing.retain(|d| !first.delete.contains(&d.id));
        for (i, (stream, service, signal)) in first.create.iter().enumerate() {
            existing.push(ManagedDetector {
                id: format!("new{i:03}"),
                stream: stream.clone(),
                service: service.clone(),
                signal: *signal,
                enabled: true,
            });
        }
        let second = plan_default(&volumes, &existing);
        assert!(second.create.is_empty(), "{:?}", second.create);
        assert!(second.delete.is_empty(), "{:?}", second.delete);
    }

    fn sql_of(signal: RedSignal, cols: &StreamColumns) -> String {
        template("default", "checkout", signal, cols)
            .unwrap()
            .custom_sql
    }

    #[test]
    fn template_sql_uses_the_engine_aliases() {
        for signal in RedSignal::ALL {
            let sql = sql_of(signal, &ALL_COLS);
            assert!(
                sql.starts_with("SELECT histogram(_timestamp, '5m') AS time_bucket, "),
                "{sql}"
            );
            assert!(sql.contains(" AS value FROM "), "{sql}");
            assert!(sql.contains(" GROUP BY time_bucket"), "{sql}");
        }
        assert_eq!(
            sql_of(RedSignal::Rate, &ALL_COLS),
            format!(
                "SELECT histogram(_timestamp, '5m') AS time_bucket, COUNT(*) AS value FROM \"default\" \
                 WHERE service_name = 'checkout' AND (CAST(span_kind AS VARCHAR) = '2' OR CAST(span_kind AS VARCHAR) = '5' {ROOT_ARM}) \
                 GROUP BY time_bucket"
            )
        );
    }

    #[test]
    fn template_sql_ratio_and_latency_need_twenty_requests() {
        let errors = sql_of(RedSignal::ErrorRatio, &ALL_COLS);
        assert!(errors.contains(
            "CAST(SUM(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS DOUBLE) / COUNT(*) AS value"
        ));
        assert!(
            errors.ends_with("GROUP BY time_bucket HAVING COUNT(*) >= 20"),
            "{errors}"
        );
        let p95 = sql_of(RedSignal::P95Latency, &ALL_COLS);
        assert!(p95.contains("approx_percentile_cont(duration, 0.95) AS value"));
        assert!(
            p95.ends_with("GROUP BY time_bucket HAVING COUNT(*) >= 20"),
            "{p95}"
        );
        assert!(!sql_of(RedSignal::Rate, &ALL_COLS).contains("HAVING"));
    }

    #[test]
    fn template_sql_omits_the_root_arm_without_a_parent_column() {
        let cols = StreamColumns {
            has_parent: false,
            ..ALL_COLS
        };
        let sql = sql_of(RedSignal::Rate, &cols);
        assert!(
            sql.contains("AND (CAST(span_kind AS VARCHAR) = '2' OR CAST(span_kind AS VARCHAR) = '5') GROUP BY"),
            "{sql}"
        );
        assert!(!sql.contains("reference_parent_span_id"));
        assert!(sql_of(RedSignal::Rate, &ALL_COLS).contains(ROOT_ARM));
    }

    #[test]
    fn template_sql_quotes_the_service_and_the_stream() {
        let t = template("my\"stream", "o'brien", RedSignal::Rate, &ALL_COLS).unwrap();
        assert!(
            t.custom_sql
                .contains("FROM \"my\"\"stream\" WHERE service_name = 'o''brien' AND")
        );
        assert_eq!(t.stream_name, "my\"stream");
    }

    #[test]
    fn template_fields_match_the_engine_contract() {
        for signal in RedSignal::ALL {
            let t = template("default", "checkout", signal, &ALL_COLS).unwrap();
            assert_eq!(t.stream_type, "traces");
            assert_eq!(t.query_mode, "custom_sql");
            assert_eq!(t.histogram_interval, "5m");
            assert_eq!(t.schedule_interval, "1h");
            assert!(t.detection_window_seconds >= 3_600 + 300);
            assert!(!t.alert_enabled);
            assert_eq!(
                t.tags,
                vec![MANAGED_TAG.to_string(), signal.tag().to_string()]
            );
            assert!(
                t.name
                    .starts_with(&format!("RED {} · default · checkout", signal.label()))
            );
        }
        let rate = template("default", "checkout", RedSignal::Rate, &ALL_COLS).unwrap();
        assert_eq!(
            (
                rate.detection_function.as_str(),
                rate.alert_direction.as_str()
            ),
            ("count", "both")
        );
        assert_eq!(rate.detection_function_field, None);
        let errors = template("default", "checkout", RedSignal::ErrorRatio, &ALL_COLS).unwrap();
        assert_eq!(
            (
                errors.detection_function.as_str(),
                errors.alert_direction.as_str()
            ),
            ("count", "above")
        );
        let p95 = template("default", "checkout", RedSignal::P95Latency, &ALL_COLS).unwrap();
        assert_eq!(
            (
                p95.detection_function.as_str(),
                p95.alert_direction.as_str()
            ),
            ("p95", "above")
        );
        // In custom_sql mode the field names the result column the engine reads the value from.
        assert_eq!(p95.detection_function_field.as_deref(), Some("value"));
    }

    #[test]
    fn template_names_never_contain_a_slash() {
        let t = template("team/a", "api/v1", RedSignal::Rate, &ALL_COLS).unwrap();
        assert!(!t.name.contains('/'), "{}", t.name);
        assert_eq!(t.name, "RED rate · team\u{2215}a · api\u{2215}v1");
    }

    #[test]
    fn template_skips_signals_the_engine_would_reject() {
        assert!(
            template(
                "default",
                "inventory-update-svc",
                RedSignal::Rate,
                &ALL_COLS
            )
            .is_none()
        );
        assert!(template("dropzone", "svc", RedSignal::P95Latency, &ALL_COLS).is_none());
        assert!(template("app-errors", "svc", RedSignal::Rate, &ALL_COLS).is_none());
        assert!(template("app-errors", "svc", RedSignal::ErrorRatio, &ALL_COLS).is_some());
        assert!(template("terror_logs", "svc", RedSignal::Rate, &ALL_COLS).is_some());
        let no_status = StreamColumns {
            has_status: false,
            ..ALL_COLS
        };
        assert!(template("default", "svc", RedSignal::ErrorRatio, &no_status).is_none());
        assert!(template("default", "svc", RedSignal::Rate, &no_status).is_some());
        let no_duration = StreamColumns {
            has_duration: false,
            ..ALL_COLS
        };
        assert!(template("default", "svc", RedSignal::P95Latency, &no_duration).is_none());
        assert!(template("default", "svc", RedSignal::ErrorRatio, &no_duration).is_some());
    }

    #[test]
    fn detectors_on_unread_streams_are_left_out_of_the_plan() {
        let reads = BTreeMap::from([
            ("default".to_string(), StreamRead::Read(ALL_COLS)),
            ("flaky".to_string(), StreamRead::Unread),
        ]);
        let mut cold = det("b", "svc", RedSignal::Rate, false);
        cold.stream = "cold".to_string();
        let mut flaky = det("f", "svc", RedSignal::Rate, true);
        flaky.stream = "flaky".to_string();
        let read = det("a", "svc", RedSignal::Rate, true);
        let existing = on_read_streams(vec![read.clone(), cold, flaky], &reads);
        assert_eq!(existing, vec![read]);
        assert_eq!(plan_default(&[], &existing).delete, vec!["a".to_string()]);
    }

    #[test]
    fn a_failed_volume_search_spares_only_its_own_stream() {
        let reads = BTreeMap::from([
            ("default".to_string(), StreamRead::Read(ALL_COLS)),
            ("flaky".to_string(), StreamRead::Unread),
        ]);
        let mut flaky = det("f", "svc", RedSignal::Rate, true);
        flaky.stream = "flaky".to_string();
        let stale = det("s", "old", RedSignal::Rate, true);
        let existing = on_read_streams(vec![flaky, stale.clone()], &reads);
        assert_eq!(existing, vec![stale]);
        let p = plan_default(&[vol("default", "checkout", 50_000)], &existing);
        assert_eq!(p.delete, vec!["s".to_string()]);
        assert_eq!(created_services(&p), vec!["checkout".to_string()]);
    }

    #[test]
    fn detectors_on_retired_streams_are_deleted() {
        let reads = BTreeMap::from([
            ("default".to_string(), StreamRead::Read(ALL_COLS)),
            ("gone".to_string(), StreamRead::Retired),
        ]);
        let mut gone = det("g", "svc", RedSignal::Rate, true);
        gone.stream = "gone".to_string();
        let mut cold = det("c", "svc", RedSignal::Rate, true);
        cold.stream = "cold".to_string();
        let existing = on_read_streams(vec![gone.clone(), cold], &reads);
        assert_eq!(existing, vec![gone]);
        assert_eq!(plan_default(&[], &existing).delete, vec!["g".to_string()]);
    }

    #[test]
    fn a_stream_without_service_name_or_span_kind_is_retired() {
        let full = [
            "service_name",
            "span_kind",
            "reference_parent_span_id",
            "span_status",
            "duration",
        ];
        assert_eq!(
            read_stream(|name| full.contains(&name)),
            StreamRead::Read(ALL_COLS)
        );
        assert_eq!(
            read_stream(|name| ["service_name", "span_kind"].contains(&name)),
            StreamRead::Read(StreamColumns {
                has_parent: false,
                has_status: false,
                has_duration: false,
            })
        );
        assert_eq!(
            read_stream(|name| name != "service_name" && full.contains(&name)),
            StreamRead::Retired
        );
        assert_eq!(
            read_stream(|name| name != "span_kind" && full.contains(&name)),
            StreamRead::Retired
        );
    }

    #[test]
    fn parse_managed_round_trips_every_template() {
        for has_parent in [true, false] {
            let cols = StreamColumns {
                has_parent,
                ..ALL_COLS
            };
            for service in ["checkout", "o'brien's ''svc''", "a · b", "api/v1"] {
                for signal in RedSignal::ALL {
                    let t = template("my\"stream", service, signal, &cols).unwrap();
                    assert_eq!(
                        parse_managed(&t.tags, &t.custom_sql),
                        Some((service.to_string(), signal)),
                        "{}",
                        t.custom_sql
                    );
                }
            }
        }
    }

    #[test]
    fn parse_managed_rejects_edited_sql_and_missing_tags() {
        let t = template("default", "checkout", RedSignal::P95Latency, &ALL_COLS).unwrap();
        let edited = t.custom_sql.replace("0.95", "0.99");
        assert_eq!(parse_managed(&t.tags, &edited), None);
        let other_service = t.custom_sql.replace("= 'checkout'", "= 'cart' OR 1=1");
        assert_eq!(parse_managed(&t.tags, &other_service), None);
        let rate_tags = vec![MANAGED_TAG.to_string(), RedSignal::Rate.tag().to_string()];
        assert_eq!(parse_managed(&rate_tags, &t.custom_sql), None);
        assert_eq!(
            parse_managed(&[MANAGED_TAG.to_string()], &t.custom_sql),
            None
        );
        assert_eq!(parse_managed(&t.tags, ""), None);
    }

    #[test]
    fn volume_sql_counts_requests_per_service() {
        assert_eq!(
            volume_sql("my\"stream", &ALL_COLS),
            format!(
                "SELECT service_name, COUNT(*) FILTER (WHERE CAST(span_kind AS VARCHAR) = '2' OR CAST(span_kind AS VARCHAR) = '5' {ROOT_ARM}) \
                 AS requests FROM \"my\"\"stream\" GROUP BY service_name ORDER BY requests DESC LIMIT 40"
            )
        );
        let cols = StreamColumns {
            has_parent: false,
            ..ALL_COLS
        };
        assert_eq!(
            volume_sql("default", &cols),
            "SELECT service_name, COUNT(*) FILTER (WHERE CAST(span_kind AS VARCHAR) = '2' OR CAST(span_kind AS VARCHAR) = '5') \
             AS requests FROM \"default\" GROUP BY service_name ORDER BY requests DESC LIMIT 40"
        );
    }

    /// The top-k rule panics when the aggregate's name holds an IN list's `[`.
    #[tokio::test]
    async fn volume_sql_plans_through_the_topk_rule() {
        use std::sync::Arc;

        use arrow_schema::{DataType, Field, Schema};
        use datafusion::{
            config::ConfigOptions,
            physical_optimizer::PhysicalOptimizerRule,
            physical_plan::displayable,
            prelude::{SessionConfig, SessionContext},
        };
        use search::datafusion::{
            optimizer::physical_optimizer::aggregate_topk::AggregateTopkRule,
            table_provider::empty_table::NewEmptyTable,
        };

        let schema = Arc::new(Schema::new(vec![
            Field::new("service_name", DataType::Utf8, true),
            Field::new("span_kind", DataType::Utf8, true),
            Field::new("reference_parent_span_id", DataType::Utf8, true),
        ]));
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(2));
        ctx.register_table("default", Arc::new(NewEmptyTable::new("default", schema)))
            .unwrap();
        for has_parent in [true, false] {
            let cols = StreamColumns {
                has_parent,
                ..ALL_COLS
            };
            let sql = volume_sql("default", &cols);
            let plan = ctx
                .sql(&sql)
                .await
                .unwrap()
                .create_physical_plan()
                .await
                .unwrap();
            let plan = AggregateTopkRule::new(MAX_SERVICES as i64 * 2)
                .optimize(plan, &ConfigOptions::default())
                .unwrap();
            let shown = displayable(plan.as_ref()).indent(true).to_string();
            assert!(shown.contains("AggregateTopkExec"), "{sql}\n{shown}");
        }
    }
}
