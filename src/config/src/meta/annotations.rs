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
pub struct AnnotationObj {
    pub dashboard_id: String,
    pub panels: Option<String>,
    pub annotations: Vec<Annotation>,
}

impl AnnotationObj {
    pub fn new(dashboard_id: String, panels: Option<String>, annotations: Vec<Annotation>) -> Self {
        Self {
            dashboard_id,
            panels,
            annotations,
        }
    }

    pub fn get_panels(&self) -> Vec<i64> {
        self.panels
            .as_ref()
            .map(|panels| {
                panels
                    .split(',')
                    .filter_map(|panel| panel.parse::<i64>().ok())
                    .collect()
            })
            .unwrap_or_default()
    }
}