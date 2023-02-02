use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Dashboard {
    pub name: String,
    pub details: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DashboardList {
    pub list: Vec<Dashboard>,
}
