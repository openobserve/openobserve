// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! What each piece of facility plant serves, so incident correlation can put a
//! plant fault into the incident of the racks it feeds.
//!
//! A building-management system describes its plant in the `bms_metadata` logs
//! stream: each record names an object (`object_id`) and the racks or objects it
//! serves (`serves_id`). A CDU serves racks, a chiller serves CDUs, a cooling
//! tower serves chillers.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use config::meta::stream::StreamType;
use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

/// The dimension an incident stores a firing's facility object under.
pub const FACILITY_OBJECT_DIMENSION: &str = "facility-object";
/// The rack semantic group; its value is the rack's id in the topology.
pub const RACK_DIMENSION: &str = "rack";
/// The result-row field that names a facility object, as in the BMS streams.
pub const OBJECT_ID_FIELD: &str = "object_id";

const STREAM: &str = "bms_metadata";
/// A BMS republishes every point's metadata every 100 s, so a routine refresh
/// reads the last hour; a read that finds nothing keeps the previous topology.
const REFRESH_LOOKBACK: Duration = Duration::from_secs(3600);
/// With no topology yet, a first read reaches back a day, past a feed paused for
/// hours. Each object's latest record counts.
const FIRST_LOOKBACK: Duration = Duration::from_secs(24 * 3600);
/// How long a read topology is used before it is read again.
const TTL: Duration = Duration::from_secs(300);
/// How long after a failed read it is tried again.
const RETRY: Duration = Duration::from_secs(30);
const MAX_ROWS: i64 = 10_000;
/// Longer object or served ids are dropped.
const MAX_ID_LEN: usize = 256;
/// Served ids kept per object; the rest are dropped.
const MAX_SERVED: usize = 1024;

/// An org's topology, when it was last read, and when to retry a failed read.
#[derive(Clone, Default)]
struct Cached {
    topology: Arc<Topology>,
    read_at: Option<Instant>,
    retry_at: Option<Instant>,
}

/// An org's cached topology, and the lock one read holds while it runs.
#[derive(Default)]
struct OrgSlot {
    cached: std::sync::Mutex<Option<Cached>>,
    reading: Mutex<()>,
}

type Slot = Arc<OrgSlot>;

static CACHE: LazyLock<RwLock<HashMap<String, Slot>>> = LazyLock::new(Default::default);

/// Which ids each facility object serves.
#[derive(Debug, Default)]
pub struct Topology {
    serves: HashMap<String, Vec<String>>,
}

/// The racks and plant a firing reaches through the topology, computed once per
/// firing and checked against each open incident.
pub struct Reach<'a> {
    ids: HashSet<&'a str>,
    plant: bool,
}

impl Topology {
    /// Builds the topology from each object's latest `object_id`, `serves_id` row.
    /// `serves_id` is a list, stored as a JSON array or as the JSON text of one;
    /// an empty or missing one gives the object no links. Ids longer than
    /// [`MAX_ID_LEN`] and served ids past [`MAX_SERVED`] per object are dropped.
    pub fn from_rows(rows: &[Value]) -> Self {
        let mut serves: HashMap<String, Vec<String>> = HashMap::new();
        let mut seen: HashMap<String, HashSet<String>> = HashMap::new();
        let mut dropped = 0usize;
        for row in rows {
            let Some(object) = row
                .get("object_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|o| !o.is_empty())
            else {
                continue;
            };
            if object.len() > MAX_ID_LEN {
                dropped += 1;
                continue;
            }
            let served: Vec<String> = match row.get("serves_id") {
                Some(Value::Array(ids)) => ids
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect(),
                Some(Value::String(s)) => {
                    serde_json::from_str(s).unwrap_or_else(|_| vec![s.to_string()])
                }
                _ => continue,
            };
            let entry = serves.entry(object.to_string()).or_default();
            let entry_seen = seen.entry(object.to_string()).or_default();
            for id in served {
                let id = id.trim();
                if id.is_empty() || entry_seen.contains(id) {
                    continue;
                }
                if id.len() > MAX_ID_LEN || entry.len() >= MAX_SERVED {
                    dropped += 1;
                    continue;
                }
                entry_seen.insert(id.to_string());
                entry.push(id.to_string());
            }
        }
        if dropped > 0 {
            log::warn!(
                "[incidents] facility topology dropped {dropped} ids longer than {MAX_ID_LEN} bytes or past {MAX_SERVED} served ids per object"
            );
        }
        serves.retain(|_, ids| !ids.is_empty());
        Self { serves }
    }

    pub fn is_empty(&self) -> bool {
        self.serves.is_empty()
    }

    /// Whether `id` is plant that serves something.
    pub fn serves_anything(&self, id: &str) -> bool {
        self.serves.contains_key(id)
    }

    /// The rack and facility object in `dims`, and everything they serve,
    /// directly or through other plant.
    fn scope<'a>(&'a self, dims: &'a HashMap<String, String>) -> HashSet<&'a str> {
        let mut reached = HashSet::new();
        if self.serves.is_empty() {
            return reached;
        }
        let mut pending: Vec<&str> = [RACK_DIMENSION, FACILITY_OBJECT_DIMENSION]
            .iter()
            .filter_map(|k| dims.get(*k).map(String::as_str))
            .collect();
        while let Some(id) = pending.pop() {
            if reached.insert(id)
                && let Some(served) = self.serves.get(id)
            {
                pending.extend(served.iter().map(String::as_str));
            }
        }
        reached
    }

    /// What a firing with `dims` reaches.
    pub fn reach<'a>(&'a self, dims: &'a HashMap<String, String>) -> Reach<'a> {
        Reach {
            ids: self.scope(dims),
            plant: dims.contains_key(FACILITY_OBJECT_DIMENSION),
        }
    }
}

impl Reach<'_> {
    /// Whether one side is facility plant that serves, directly or through other
    /// plant, a rack or object of the other side.
    pub fn links(&self, topology: &Topology, incident: &HashMap<String, String>) -> bool {
        if self.ids.is_empty() || (!self.plant && !incident.contains_key(FACILITY_OBJECT_DIMENSION))
        {
            return false;
        }
        topology
            .scope(incident)
            .iter()
            .any(|id| self.ids.contains(id))
    }
}

/// The org's facility topology, read at most once per [`TTL`] by one caller at a
/// time; while it reads, others get the previous topology, and wait only when
/// there is none. Empty when the org has no `bms_metadata` stream. A failed
/// read, or one that finds no object, keeps the topology read before it; a
/// failed read is tried again after [`RETRY`].
pub async fn get(org_id: &str) -> Arc<Topology> {
    let slot = {
        let existing = CACHE.read().await.get(org_id).cloned();
        match existing {
            Some(slot) => slot,
            None => CACHE
                .write()
                .await
                .entry(org_id.to_string())
                .or_default()
                .clone(),
        }
    };
    // The topology to use without reading, and whether one is cached at all.
    let fresh = |slot: &OrgSlot| -> (Option<Arc<Topology>>, Option<Arc<Topology>>) {
        let cached = slot.cached.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        match cached.as_ref() {
            Some(c)
                if c.read_at.is_some_and(|at| at.elapsed() < TTL)
                    || c.retry_at.is_some_and(|at| now < at) =>
            {
                (Some(c.topology.clone()), Some(c.topology.clone()))
            }
            Some(c) => (None, Some(c.topology.clone())),
            None => (None, None),
        }
    };
    let (use_now, previous) = fresh(&slot);
    if let Some(topology) = use_now {
        return topology;
    }
    let _reading = match (slot.reading.try_lock(), previous) {
        (Ok(guard), _) => guard,
        (Err(_), Some(previous)) => return previous,
        (Err(_), None) => slot.reading.lock().await,
    };
    // Another caller may have read it while this one waited.
    if let (Some(topology), _) = fresh(&slot) {
        return topology;
    }
    let previous = slot
        .cached
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_default();
    let lookback = if previous.topology.is_empty() {
        FIRST_LOOKBACK
    } else {
        REFRESH_LOOKBACK
    };
    let now = Instant::now();
    let next = match load(org_id, lookback).await {
        Ok(topology) if topology.is_empty() && !previous.topology.is_empty() => Cached {
            read_at: Some(now),
            retry_at: None,
            ..previous
        },
        Ok(topology) => Cached {
            topology: Arc::new(topology),
            read_at: Some(now),
            retry_at: None,
        },
        Err(e) => {
            log::warn!("[incidents] facility topology for {org_id} unreadable: {e}");
            Cached {
                retry_at: Some(now + RETRY),
                ..previous
            }
        }
    };
    let topology = next.topology.clone();
    *slot.cached.lock().unwrap_or_else(|e| e.into_inner()) = Some(next);
    topology
}

async fn load(org_id: &str, lookback: Duration) -> Result<Topology, anyhow::Error> {
    if !infra::schema::exists(org_id, StreamType::Logs, STREAM).await {
        return Ok(Topology::default());
    }
    let end_time = chrono::Utc::now().timestamp_micros();
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: format!(
                r#"SELECT object_id, last_value(serves_id ORDER BY _timestamp) AS serves_id FROM "{STREAM}" WHERE object_id IS NOT NULL GROUP BY object_id"#
            ),
            from: 0,
            size: MAX_ROWS,
            start_time: end_time - lookback.as_micros() as i64,
            end_time,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        use_index: true,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Logs, None, &req).await?;
    if resp.is_partial {
        anyhow::bail!("{STREAM} search returned a partial result");
    }
    if resp.hits.len() as i64 >= MAX_ROWS {
        log::warn!(
            "[incidents] {org_id}/{STREAM} has more than {MAX_ROWS} objects; the facility topology holds only the first {MAX_ROWS}"
        );
    }
    let topology = Topology::from_rows(&resp.hits);
    if topology.serves.is_empty() {
        log::warn!(
            "[incidents] {org_id}/{STREAM} has no object with serves_id in the last {} s; the topology read before, if any, stays in use",
            lookback.as_secs()
        );
    }
    Ok(topology)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn dims(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn linked(plant: &Topology, a: &HashMap<String, String>, b: &HashMap<String, String>) -> bool {
        plant.reach(a).links(plant, b)
    }

    /// A cooling plant: tower → chiller → CDU → racks, and a second CDU.
    fn cooling_plant() -> Topology {
        Topology::from_rows(&[
            json!({"object_id": "C-F00-CDU-05", "serves_id": "[\"Pod1C-E02\",\"Pod1C-E03\",\"Pod1C-E04\"]"}),
            json!({"object_id": "CUB-CH-01", "serves_id": "[\"C-F00-CDU-05\"]"}),
            json!({"object_id": "CUB-CT-01", "serves_id": ["CUB-CH-01"]}),
            json!({"object_id": "C-F01-CDU-06", "serves_id": "[\"Pod1C-F02\"]"}),
            json!({"object_id": "EnvSensorsPod1C"}),
        ])
    }

    #[test]
    fn serves_id_is_read_as_json_text_or_array() {
        let plant = cooling_plant();
        assert!(plant.serves_anything("C-F00-CDU-05"));
        assert!(plant.serves_anything("CUB-CT-01"));
        assert!(!plant.serves_anything("EnvSensorsPod1C"));
        assert!(!plant.serves_anything("Pod1C-E02"));
    }

    #[test]
    fn a_cleared_serves_id_gives_no_links() {
        let plant = Topology::from_rows(&[
            json!({"object_id": "CDU-1", "serves_id": null}),
            json!({"object_id": "CDU-2", "serves_id": "[]"}),
            json!({"object_id": "CDU-3", "serves_id": ""}),
        ]);
        for object in ["CDU-1", "CDU-2", "CDU-3"] {
            assert!(!plant.serves_anything(object), "{object}");
        }
    }

    #[test]
    fn ids_longer_than_the_cap_are_dropped() {
        let long = "x".repeat(MAX_ID_LEN + 1);
        let plant = Topology::from_rows(&[
            json!({"object_id": "CDU-1", "serves_id": [long.clone(), "R1"]}),
            json!({"object_id": long.clone(), "serves_id": ["R2"]}),
        ]);
        assert!(plant.serves_anything("CDU-1"));
        assert!(!plant.serves_anything(&long));
        assert_eq!(plant.serves["CDU-1"], vec!["R1".to_string()]);
    }

    #[test]
    fn served_ids_past_the_cap_are_dropped_and_duplicates_kept_once() {
        let ids: Vec<String> = (0..MAX_SERVED + 10)
            .flat_map(|i| [format!("R{i}"), format!("R{i}")])
            .collect();
        let plant = Topology::from_rows(&[json!({"object_id": "CDU-1", "serves_id": ids})]);
        let served = &plant.serves["CDU-1"];
        assert_eq!(served.len(), MAX_SERVED);
        assert_eq!(served[0], "R0");
        assert_eq!(served[MAX_SERVED - 1], format!("R{}", MAX_SERVED - 1));
    }

    #[test]
    fn ids_are_trimmed() {
        let plant = Topology::from_rows(&[
            json!({"object_id": " CDU-1 ", "serves_id": "[\" R1 \", \"\"]"}),
            json!({"object_id": "  ", "serves_id": "[\"R2\"]"}),
        ]);
        assert!(plant.serves_anything("CDU-1"));
        assert!(!plant.serves_anything(""));
        assert!(linked(
            &plant,
            &dims(&[("facility-object", "CDU-1")]),
            &dims(&[("rack", "R1")])
        ));
    }

    #[test]
    fn plant_links_to_the_racks_it_serves_through_any_number_of_hops() {
        let plant = cooling_plant();
        let rack = dims(&[("rack", "Pod1C-E03")]);
        for object in ["C-F00-CDU-05", "CUB-CH-01", "CUB-CT-01"] {
            let fault = dims(&[("facility-object", object)]);
            assert!(linked(&plant, &fault, &rack), "{object}");
            assert!(linked(&plant, &rack, &fault), "{object}");
        }
        let other_cdu = dims(&[("facility-object", "C-F01-CDU-06")]);
        assert!(!linked(&plant, &other_cdu, &rack));
    }

    #[test]
    fn racks_alone_never_link() {
        let plant = cooling_plant();
        let e02 = dims(&[("rack", "Pod1C-E02")]);
        let e03 = dims(&[("rack", "Pod1C-E03")]);
        assert!(!linked(&plant, &e02, &e03));
        assert!(!linked(&plant, &e02, &e02));
    }

    #[test]
    fn an_incident_holding_plant_links_every_rack_that_plant_serves() {
        let plant = cooling_plant();
        let incident = dims(&[("rack", "Pod1C-E02"), ("facility-object", "C-F00-CDU-05")]);
        assert!(linked(&plant, &dims(&[("rack", "Pod1C-E04")]), &incident));
        assert!(!linked(&plant, &dims(&[("rack", "Pod1C-F02")]), &incident));
    }

    #[test]
    fn a_serves_cycle_terminates() {
        let plant = Topology::from_rows(&[
            json!({"object_id": "A", "serves_id": "[\"B\"]"}),
            json!({"object_id": "B", "serves_id": "[\"A\"]"}),
        ]);
        let a = dims(&[("facility-object", "A")]);
        assert!(!linked(&plant, &a, &dims(&[("rack", "R")])));
    }
}
