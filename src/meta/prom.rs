// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Metric {
    pub name: String,
    pub value: f64,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub collection: AHashMap<String, String>,
    pub _timestamp: i64,
    pub metric_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterLeader {
    pub name: String,
    pub last_received: i64,
}

impl Metric {
    pub fn new(
        name: String,
        value: f64,
        collection: AHashMap<String, String>,
        _timestamp: i64,
        metric_type: String,
    ) -> Self {
        Metric {
            name,
            value,
            collection,
            _timestamp,
            metric_type,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::common::json;

    #[test]
    fn test_response() {
        let name = "container_sockets";
        let metric = Metric::new(
            name.to_string(),
            4.0,
            AHashMap::new(),
            1667978900217,
            "Gauge".to_string(),
        );

        let str_met = json::to_string(&metric).unwrap();
        let loc_met: Metric = json::from_str(str_met.as_str()).unwrap();

        assert_eq!(loc_met.name, name);
    }
}
