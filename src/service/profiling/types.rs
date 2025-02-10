use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileMetadata {
    pub _timestamp: i64,
    pub instance_id: String,
}

#[derive(Debug)]
pub enum ProfileError {
    DecodeError(String),
    SerializationError(String),
    IngestError(String),
    ProcessError(String),
}

impl std::fmt::Display for ProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProfileError::DecodeError(e) => write!(f, "Decode error: {}", e),
            ProfileError::SerializationError(e) => write!(f, "Serialization error: {}", e),
            ProfileError::IngestError(e) => write!(f, "Ingest error: {}", e),
            ProfileError::ProcessError(e) => write!(f, "Process error: {}", e),
        }
    }
}

impl std::error::Error for ProfileError {}

pub type Result<T> = std::result::Result<T, ProfileError>;

#[derive(Debug, Serialize)]
pub struct StreamProfileData {
    pub instance_id: String,

    // Stack information for flame graphs (root to leaf order)
    pub stack_trace: Vec<String>,
    pub stack_depth: i32, // Depth in call tree

    // Quick access fields for querying
    #[serde(rename = "current_function")] // Current executing function
    pub leaf_function: String,
    #[serde(rename = "entry_point")] // Entry point of the call stack
    pub root_function: String,

    // Sample information
    pub value: u64, // Sample count/weight

    // Additional context
    pub metadata: ProfileMetadata,
}

#[derive(Debug, Serialize)]
pub struct NormalizedProfile {
    pub samples: Vec<StreamProfileData>,
}

impl StreamProfileData {
    pub fn to_json(&self) -> Result<String> {
        serde_json::to_string(self).map_err(|e| ProfileError::SerializationError(e.to_string()))
    }
}
