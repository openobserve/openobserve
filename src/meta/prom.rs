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
pub struct Collection {
    pub name: String,
    pub value: String,
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
