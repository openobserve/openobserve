use serde::{Deserialize, Serialize};
use std::fmt;
use utoipa::ToSchema;

pub mod alert;
pub mod common;
pub mod dashboards;
pub mod dialect;
pub mod functions;
pub mod http;
pub mod ingestion;
pub mod organization;
pub mod prom;
pub mod search;
pub mod service;
pub mod sql;
pub mod stream;
pub mod traces;
pub mod user;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum StreamType {
    #[default]
    #[serde(rename = "logs")]
    Logs,
    #[serde(rename = "metrics")]
    Metrics,
    #[serde(rename = "traces")]
    Traces,
    #[serde(rename = "metadata")]
    Metadata,
    #[serde(rename = "file_list")]
    Filelist,
}

impl From<&str> for StreamType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "logs" => StreamType::Logs,
            "metrics" => StreamType::Metrics,
            "traces" => StreamType::Traces,
            "metadata" => StreamType::Metadata,
            "file_list" => StreamType::Filelist,
            _ => StreamType::Logs,
        }
    }
}

impl fmt::Display for StreamType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            StreamType::Logs => write!(f, "logs"),
            StreamType::Metrics => write!(f, "metrics"),
            StreamType::Traces => write!(f, "traces"),
            StreamType::Metadata => write!(f, "metadata"),
            StreamType::Filelist => write!(f, "file_list"),
        }
    }
}
