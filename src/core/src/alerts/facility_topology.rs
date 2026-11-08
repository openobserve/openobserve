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
use tokio::sync::RwLock;

/// The dimension an incident stores a firing's facility object under.
pub const FACILITY_OBJECT_DIMENSION: &str = "facility-object";
/// The rack semantic group; its value is the rack's id in the topology.
pub const RACK_DIMENSION: &str = "rack";
/// The result-row field that names a facility object, as in the BMS streams.
pub const OBJECT_ID_FIELD: &str = "object_id";

const STREAM: &str = "bms_metadata";
/// A BMS re-sends its metadata rarely, so the window reaches well back.
const LOOKBACK: Duration = Duration::from_secs(24 * 3600);
/// How long a loaded topology is used before it is read again.
const TTL: Duration = Duration::from_secs(300);
const MAX_ROWS: i64 = 10_000;

/// Each org's topology and when it was read.
type Cached = (Instant, Arc<Topology>);

static CACHE: LazyLock<RwLock<HashMap<String, Cached>>> = LazyLock::new(Default::default);

/// Which ids each facility object serves.
#[derive(Debug, Default)]
pub struct Topology {
    serves: HashMap<String, Vec<String>>,
}

impl Topology {
    /// Builds the topology from `object_id`, `serves_id` rows. `serves_id` is a
    /// list, stored as a JSON array or as the JSON text of one.
    pub fn from_rows(rows: &[Value]) -> Self {
        let mut serves: HashMap<String, Vec<String>> = HashMap::new();
        for row in rows {
            let Some(object) = row.get("object_id").and_then(Value::as_str) else {
                continue;
            };
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
            for id in served {
                if !id.is_empty() && !entry.contains(&id) {
                    entry.push(id);
                }
            }
        }
        serves.retain(|_, ids| !ids.is_empty());
        Self { serves }
    }

    /// Whether `id` is plant that serves something.
    pub fn serves_anything(&self, id: &str) -> bool {
        self.serves.contains_key(id)
    }

    /// The rack and facility object in `dims`, and everything they serve,
    /// directly or through other plant.
    fn scope<'a>(&'a self, dims: &'a HashMap<String, String>) -> HashSet<&'a str> {
        let mut reached = HashSet::new();
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

    /// Whether one side is facility plant that serves, directly or through other
    /// plant, a rack or object of the other side.
    pub fn linked(&self, a: &HashMap<String, String>, b: &HashMap<String, String>) -> bool {
        if !a.contains_key(FACILITY_OBJECT_DIMENSION) && !b.contains_key(FACILITY_OBJECT_DIMENSION)
        {
            return false;
        }
        !self.scope(a).is_disjoint(&self.scope(b))
    }
}

/// The org's facility topology, read at most once per [`TTL`]. Empty when the
/// org has no `bms_metadata` stream or the read fails.
pub async fn get(org_id: &str) -> Arc<Topology> {
    if let Some((at, topology)) = CACHE.read().await.get(org_id)
        && at.elapsed() < TTL
    {
        return topology.clone();
    }
    let topology = Arc::new(load(org_id).await.unwrap_or_else(|e| {
        log::warn!("[incidents] facility topology for {org_id} unreadable: {e}");
        Topology::default()
    }));
    CACHE
        .write()
        .await
        .insert(org_id.to_string(), (Instant::now(), topology.clone()));
    topology
}

async fn load(org_id: &str) -> Result<Topology, anyhow::Error> {
    if !infra::schema::exists(org_id, StreamType::Logs, STREAM).await {
        return Ok(Topology::default());
    }
    let end_time = chrono::Utc::now().timestamp_micros();
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: format!(
                r#"SELECT object_id, serves_id FROM "{STREAM}" WHERE serves_id IS NOT NULL GROUP BY object_id, serves_id"#
            ),
            from: 0,
            size: MAX_ROWS,
            start_time: end_time - LOOKBACK.as_micros() as i64,
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
    Ok(Topology::from_rows(&resp.hits))
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

    /// The plant `bms_metadata` describes in the DSX dummy-bms scenario.
    fn dsx_plant() -> Topology {
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
        let plant = dsx_plant();
        assert!(plant.serves_anything("C-F00-CDU-05"));
        assert!(plant.serves_anything("CUB-CT-01"));
        assert!(!plant.serves_anything("EnvSensorsPod1C"));
        assert!(!plant.serves_anything("Pod1C-E02"));
    }

    #[test]
    fn plant_links_to_the_racks_it_serves_through_any_number_of_hops() {
        let plant = dsx_plant();
        let rack = dims(&[("rack", "Pod1C-E03")]);
        for object in ["C-F00-CDU-05", "CUB-CH-01", "CUB-CT-01"] {
            let fault = dims(&[("facility-object", object)]);
            assert!(plant.linked(&fault, &rack), "{object}");
            assert!(plant.linked(&rack, &fault), "{object}");
        }
        let other_cdu = dims(&[("facility-object", "C-F01-CDU-06")]);
        assert!(!plant.linked(&other_cdu, &rack));
    }

    #[test]
    fn racks_alone_never_link() {
        let plant = dsx_plant();
        let e02 = dims(&[("rack", "Pod1C-E02")]);
        let e03 = dims(&[("rack", "Pod1C-E03")]);
        assert!(!plant.linked(&e02, &e03));
        assert!(!plant.linked(&e02, &e02));
    }

    #[test]
    fn an_incident_holding_plant_links_every_rack_that_plant_serves() {
        let plant = dsx_plant();
        let incident = dims(&[("rack", "Pod1C-E02"), ("facility-object", "C-F00-CDU-05")]);
        assert!(plant.linked(&incident, &dims(&[("rack", "Pod1C-E04")])));
        assert!(!plant.linked(&incident, &dims(&[("rack", "Pod1C-F02")])));
    }

    #[test]
    fn a_serves_cycle_terminates() {
        let plant = Topology::from_rows(&[
            json!({"object_id": "A", "serves_id": "[\"B\"]"}),
            json!({"object_id": "B", "serves_id": "[\"A\"]"}),
        ]);
        let a = dims(&[("facility-object", "A")]);
        assert!(!plant.linked(&a, &dims(&[("rack", "R")])));
    }
}
