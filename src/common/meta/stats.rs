use serde::{Deserialize, Serialize};

use super::StreamType;
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub records: i64,
    pub stream_type: StreamType,
    pub org_id: String,
    pub stream_name: String,
    pub original_size: f64,
    #[serde(default)]
    pub _timestamp: i64,
}
