use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Annotation {
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub title: String,
    pub text: Option<String>,
    pub tags: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Annotations {
    pub dashboard_id: String,
    pub panels: Option<String>,
    pub annotations: Vec<Annotation>,
}