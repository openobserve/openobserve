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

//! The AutoObserve listener's envelope: one shape for every change, symptom and response it reads.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The version this build writes; it also reads the one before, so a rolling upgrade is safe.
pub const ENVELOPE_VERSION: u16 = 1;
pub const MAX_ENVELOPE_BYTES: usize = 8 * 1024;
pub const MAX_RELATED: usize = 50;
pub const MAX_ATTRS: usize = 20;
pub const MAX_DIMS: usize = 16;
pub const MAX_DIM_VALUE_BYTES: usize = 256;

/// One real-world event; `event_id` is its natural key, never a surrogate id or a region.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u16,
    pub event_id: String,
    pub org_id: String,
    pub source: Source,
    pub kind: String,
    pub class: EventClass,
    pub subject: EntityRef,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub related: Vec<EntityRef>,
    /// Related entities left out past [`MAX_RELATED`].
    #[serde(default, skip_serializing_if = "is_zero")]
    pub related_more: u32,
    pub occurred_at_us: i64,
    pub observed_at_us: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorded_at_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<Window>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measure: Option<Measure>,
    #[serde(default)]
    pub severity_hint: Severity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<Actor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<Revision>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub proof: Vec<Link>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub covered_by: Option<EntityRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attrs: BTreeMap<String, String>,
}

impl Envelope {
    /// Keeps the first [`MAX_RELATED`] entities and counts the rest.
    pub fn set_related(&mut self, mut related: Vec<EntityRef>) {
        let more = related.len().saturating_sub(MAX_RELATED);
        related.truncate(MAX_RELATED);
        self.related = related;
        self.related_more = u32::try_from(more).unwrap_or(u32::MAX);
    }

    /// Clamps a future `occurred_at_us` to `observed_at_us`, then checks the contract.
    pub fn checked(mut self) -> Result<Self, EnvelopeError> {
        self.occurred_at_us = self.occurred_at_us.min(self.observed_at_us);
        if self.v != ENVELOPE_VERSION && self.v + 1 != ENVELOPE_VERSION {
            return Err(EnvelopeError::Version(self.v));
        }
        if self.event_id.is_empty() || self.org_id.is_empty() {
            return Err(EnvelopeError::MissingIdentity);
        }
        if self.related.len() > MAX_RELATED {
            return Err(EnvelopeError::TooManyRelated(self.related.len()));
        }
        if self.attrs.len() > MAX_ATTRS {
            return Err(EnvelopeError::TooManyAttrs(self.attrs.len()));
        }
        // The fingerprint reads at most this much, so anything longer could merge two entities.
        let entities = std::iter::once(&self.subject)
            .chain(&self.related)
            .chain(&self.covered_by);
        for entity in entities {
            let long = entity.dims.values().any(|v| v.len() > MAX_DIM_VALUE_BYTES);
            if entity.dims.len() > MAX_DIMS || long {
                return Err(EnvelopeError::Dims(entity.kind.clone()));
            }
        }
        let bytes = serde_json::to_vec(&self).map_or(usize::MAX, |b| b.len());
        if bytes > MAX_ENVELOPE_BYTES {
            return Err(EnvelopeError::Oversize(bytes));
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub module: Module,
    pub producer: String,
    pub node: String,
    /// An attribute only: identities never carry a region, so a replica is never a second event.
    pub region: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Module {
    Alerts,
    Incidents,
    Oncall,
    Pipelines,
    Fleet,
    Svcver,
    Anomaly,
    Slo,
    Synthetics,
    Calibration,
    Ingestion,
    Rum,
    AiObs,
    Siem,
    Dbm,
    Audit,
    Rca,
    AoSelf,
    /// A module a newer producer names; it is handled generically by class.
    #[serde(other)]
    Other,
}

/// What the funnel branches on; a new class is a breaking change and bumps [`ENVELOPE_VERSION`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventClass {
    Change,
    Symptom,
    Detector,
    Lifecycle,
    Response,
    Forecast,
    #[serde(rename = "self")]
    SelfHealth,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    #[default]
    Info,
    Warn,
    Error,
    Critical,
}

/// The thing an event is about, generic over the record's own dimensions.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityRef {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<StreamRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub dims: BTreeMap<String, String>,
}

impl EntityRef {
    /// Stable across processes and builds; dims enter sorted, at most 16, values cut at 256 bytes.
    pub fn fingerprint(&self, org_id: &str) -> u64 {
        let mut canonical = String::new();
        for part in [org_id, &self.kind, self.id.as_deref().unwrap_or_default()] {
            canonical.push_str(part);
            canonical.push('\u{1f}');
        }
        if let Some(stream) = &self.stream {
            canonical.push_str(&stream.stream_type);
            canonical.push('/');
            canonical.push_str(&stream.name);
        }
        for (name, value) in self.dims.iter().take(MAX_DIMS) {
            canonical.push('\u{1f}');
            canonical.push_str(name);
            canonical.push('=');
            canonical.push_str(cut(value, MAX_DIM_VALUE_BYTES));
        }
        stable_hash64(canonical.as_bytes())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StreamRef {
    #[serde(rename = "type")]
    pub stream_type: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    pub start_us: i64,
    pub end_us: i64,
}

/// The one number its producer already computed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Measure {
    pub name: String,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

/// Shown as plain text, never as a mention.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Actor {
    #[serde(rename = "type")]
    pub kind: ActorKind,
    pub id: String,
    #[serde(default)]
    pub display: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorKind {
    User,
    ServiceAccount,
    System,
}

/// What an exact undo of a change would restore.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Revision {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_hash: Option<String>,
}

/// Evidence by reference: a query over a time range, or an object's URL.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<Window>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum EnvelopeError {
    #[error("envelope version {0} is not readable by this build")]
    Version(u16),
    #[error("envelope has no event id or org")]
    MissingIdentity,
    #[error("envelope names {0} related entities")]
    TooManyRelated(usize),
    #[error("envelope carries {0} attributes")]
    TooManyAttrs(usize),
    #[error("a {0} entity has more than 16 dimensions or a value over 256 bytes")]
    Dims(String),
    #[error("envelope is {0} bytes")]
    Oversize(usize),
}

/// The delivery key of one on-call event, the same tuple the replica path dedupes on.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OncallEventKey<'a> {
    pub response_id: &'a str,
    pub kind: &'a str,
    pub at_us: i64,
    pub actor: &'a str,
    pub ladder_run: i64,
    pub rung_us: i64,
    pub recipient: &'a str,
    pub channel: &'a str,
    pub delivered: bool,
}

/// Natural-key event ids; each part is escaped, so no two tuples share an id.
pub mod ids {
    use super::OncallEventKey;

    pub fn alert(alert_id: &str, group_key: &str, at_us: i64) -> String {
        join("alert", &[alert_id, group_key, &at_us.to_string()])
    }

    /// `version` is the row's revision column, else its `updated_at`, else a content hash.
    pub fn config(module: &str, object_id: &str, version: &str) -> String {
        join("cfg", &[module, object_id, version])
    }

    pub fn config_deleted(module: &str, object_id: &str) -> String {
        join("cfg", &[module, object_id, "deleted"])
    }

    pub fn incident(id: &str, updated_at_us: i64, field: &str) -> String {
        join("incident", &[id, &updated_at_us.to_string(), field])
    }

    pub fn rollout(id: &str, rev: i64) -> String {
        join("rollout", &[id, &rev.to_string()])
    }

    pub fn detector(module: &str, id: &str, field: &str, at_us: i64) -> String {
        join(module, &[id, field, &at_us.to_string()])
    }

    pub fn flow(org: &str, stream_type: &str, stream: &str, kind: &str, onset_us: i64) -> String {
        let minute = onset_us.div_euclid(60_000_000) * 60_000_000;
        join(
            "flow",
            &[org, stream_type, stream, kind, &minute.to_string()],
        )
    }

    pub fn dbm(org: &str, instance: &str, kind: &str, at_us: i64) -> String {
        let minute = at_us.div_euclid(60_000_000) * 60_000_000;
        join("dbm", &[org, instance, kind, &minute.to_string()])
    }

    pub fn oncall(key: &OncallEventKey<'_>) -> String {
        let delivered = if key.delivered {
            "delivered"
        } else {
            "pending"
        };
        let parts = [
            key.response_id,
            key.kind,
            &key.at_us.to_string(),
            key.actor,
            &key.ladder_run.to_string(),
            &key.rung_us.to_string(),
            key.recipient,
            key.channel,
            delivered,
        ];
        join("oncall", &parts)
    }

    fn join(head: &str, parts: &[&str]) -> String {
        let mut id = escape(head);
        for part in parts {
            id.push(':');
            id.push_str(&escape(part));
        }
        id
    }

    fn escape(part: &str) -> String {
        part.replace('%', "%25").replace(':', "%3A")
    }
}

/// The partition an org belongs to; changing it moves orgs, so it is pinned by a test.
pub fn partition_of(org_id: &str, partitions: u32) -> u32 {
    let n = u64::from(partitions.max(1));
    // FNV-1a's low bits see only each byte's low bits, so mix (murmur3 fmix64) before the modulo.
    let mut h = stable_hash64(org_id.as_bytes());
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^= h >> 33;
    u32::try_from(h % n).unwrap_or_default()
}

/// FNV-1a 64: the same value in every process and build, unlike the std or gx hashers.
pub fn stable_hash64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

fn cut(value: &str, max: usize) -> &str {
    let mut end = value.len().min(max);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(class: EventClass, kind: &str) -> Envelope {
        Envelope {
            v: ENVELOPE_VERSION,
            event_id: ids::config("alerts", "a1", "7"),
            org_id: "o1".to_string(),
            source: Source {
                module: Module::Alerts,
                producer: "poller".to_string(),
                node: "n1".to_string(),
                region: "r1".to_string(),
            },
            kind: kind.to_string(),
            class,
            subject: EntityRef {
                kind: "stream".to_string(),
                stream: Some(StreamRef {
                    stream_type: "logs".to_string(),
                    name: "s".to_string(),
                }),
                ..Default::default()
            },
            related: Vec::new(),
            related_more: 0,
            occurred_at_us: 10,
            observed_at_us: 20,
            recorded_at_us: None,
            window: None,
            measure: None,
            severity_hint: Severity::Warn,
            actor: None,
            revision: None,
            proof: Vec::new(),
            covered_by: None,
            trace_id: None,
            attrs: BTreeMap::new(),
        }
    }

    #[test]
    fn every_class_round_trips_through_json() {
        let mut change = sample(EventClass::Change, "config.changed");
        change.actor = Some(Actor {
            kind: ActorKind::ServiceAccount,
            id: "sa".to_string(),
            display: "Deploy bot".to_string(),
        });
        change.revision = Some(Revision {
            before: Some("1".to_string()),
            after: Some("2".to_string()),
            ..Default::default()
        });
        let mut symptom = sample(EventClass::Symptom, "telemetry.flow.stopped");
        symptom.window = Some(Window {
            start_us: 1,
            end_us: 2,
        });
        symptom.measure = Some(Measure {
            name: "rows_per_minute".to_string(),
            value: 0.0,
            baseline: Some(120.0),
            unit: None,
        });
        symptom.proof = vec![Link {
            label: "rows".to_string(),
            query: Some("q".to_string()),
            window: symptom.window,
            url: None,
        }];
        let mut lifecycle = sample(EventClass::Lifecycle, "alert.fired");
        lifecycle.covered_by = Some(EntityRef {
            kind: "alert".to_string(),
            id: Some("a1".to_string()),
            ..Default::default()
        });
        lifecycle.attrs.insert("group".to_string(), "g".to_string());
        for envelope in [
            change,
            symptom,
            lifecycle,
            sample(EventClass::Detector, "anomaly.flagged"),
            sample(EventClass::Response, "oncall.page.acked"),
            sample(EventClass::Forecast, "quota.forecast"),
            sample(EventClass::SelfHealth, "ao.self.blind"),
        ] {
            let json = serde_json::to_string(&envelope).unwrap();
            let back: Envelope = serde_json::from_str(&json).unwrap();
            assert_eq!(back, envelope, "{json}");
        }
        let json = serde_json::to_string(&sample(EventClass::SelfHealth, "x")).unwrap();
        assert!(json.contains(r#""class":"self""#));
    }

    #[test]
    fn the_contract_accepts_this_and_the_previous_version_and_bounds_size() {
        let unknown = serde_json::to_string(&sample(EventClass::Change, "x"))
            .unwrap()
            .replace(r#""module":"alerts""#, r#""module":"a_new_pack""#);
        let read: Envelope = serde_json::from_str(&unknown).unwrap();
        assert_eq!(read.source.module, Module::Other);

        let at = |v: u16| Envelope {
            v,
            ..sample(EventClass::Change, "x")
        };
        assert!(at(ENVELOPE_VERSION).checked().is_ok());
        assert_eq!(
            at(ENVELOPE_VERSION + 1).checked(),
            Err(EnvelopeError::Version(ENVELOPE_VERSION + 1))
        );
        let mut future = sample(EventClass::Symptom, "x");
        future.occurred_at_us = future.observed_at_us + 5;
        assert_eq!(future.checked().unwrap().occurred_at_us, 20);

        let mut many = sample(EventClass::Detector, "x");
        many.set_related(vec![EntityRef::default(); MAX_RELATED + 7]);
        assert_eq!((many.related.len(), many.related_more), (MAX_RELATED, 7));
        assert!(many.clone().checked().is_ok());
        many.related.push(EntityRef::default());
        assert_eq!(many.checked(), Err(EnvelopeError::TooManyRelated(51)));
        let mut wide = sample(EventClass::Symptom, "x");
        wide.subject.dims = (0..=MAX_DIMS)
            .map(|i| (i.to_string(), String::new()))
            .collect();
        assert_eq!(
            wide.checked(),
            Err(EnvelopeError::Dims("stream".to_string()))
        );
        let mut long = sample(EventClass::Symptom, "x");
        let value = "v".repeat(MAX_DIM_VALUE_BYTES + 1);
        long.covered_by = Some(EntityRef {
            kind: "alert".to_string(),
            dims: BTreeMap::from([("k".to_string(), value)]),
            ..Default::default()
        });
        assert_eq!(
            long.checked(),
            Err(EnvelopeError::Dims("alert".to_string()))
        );
        let mut big = sample(EventClass::Symptom, "x");
        big.trace_id = Some("t".repeat(MAX_ENVELOPE_BYTES));
        assert!(matches!(big.checked(), Err(EnvelopeError::Oversize(_))));
    }

    #[test]
    fn fingerprints_ignore_dim_order_and_cut_long_values() {
        let entity = |dims: &[(&str, String)]| EntityRef {
            kind: "service".to_string(),
            dims: dims
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            ..Default::default()
        };
        let long = "x".repeat(MAX_DIM_VALUE_BYTES);
        let a = entity(&[("a", "1".to_string()), ("b", format!("{long}tail"))]);
        let b = entity(&[("b", format!("{long}other")), ("a", "1".to_string())]);
        assert_eq!(a.fingerprint("o"), b.fingerprint("o"));
        assert_ne!(a.fingerprint("o"), a.fingerprint("p"));
        assert_ne!(
            a.fingerprint("o"),
            entity(&[("a", "2".to_string())]).fingerprint("o")
        );
    }

    #[test]
    fn ids_escape_their_parts_and_partitions_never_move() {
        assert_eq!(ids::alert("a", "b:c", 1), "alert:a:b%3Ac:1");
        assert_ne!(ids::alert("a", "b:c", 1), ids::alert("a:b", "c", 1));
        assert_eq!(
            ids::config_deleted("pipelines", "p1"),
            "cfg:pipelines:p1:deleted"
        );
        assert_eq!(
            ids::flow("o", "logs", "s", "stopped", 61_000_000),
            "flow:o:logs:s:stopped:60000000"
        );
        // Pinned: a changed hash would move every org to another owner at the next deploy.
        let pinned: Vec<u32> = ["default", "_meta", "org_1"]
            .iter()
            .map(|o| partition_of(o, 32))
            .collect();
        assert_eq!(pinned, [13, 28, 12]);
        assert_eq!(partition_of("default", 0), 0);
        // Ids that differ only in each byte's high bits (here, letter case) still spread.
        let cased: std::collections::BTreeSet<u32> =
            ["acme", "Acme", "aCme", "acMe", "acmE", "ACME", "AcMe"]
                .iter()
                .map(|o| partition_of(o, 32))
                .collect();
        assert!(cased.len() > 3, "{cased:?}");
    }
}
