//! `SeaORM` Entity for anomaly_detection_config table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "anomaly_detection_config")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub config_id: String,
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: String,
    pub enabled: bool,
    pub name: String,
    pub description: Option<String>,
    pub query_mode: String,
    pub filters: Option<Json>,
    pub custom_sql: Option<String>,
    pub detection_function: String,
    pub detection_interval: String,
    pub training_window_days: i32,
    pub sensitivity: i32,
    pub is_trained: bool,
    pub training_started_at: Option<DateTime>,
    pub training_completed_at: Option<DateTime>,
    pub last_processed_timestamp: Option<i64>,
    pub last_detection_run: Option<DateTime>,
    pub next_run_at: i64,
    pub current_model_version: i64,
    pub rcf_num_trees: i32,
    pub rcf_tree_size: i32,
    pub rcf_shingle_size: i32,
    pub alert_enabled: bool,
    pub alert_destination_id: Option<String>,
    pub status: String,
    pub retries: i32,
    pub last_updated: DateTime,
    pub processing_node: Option<String>,
    pub created_by: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::anomaly_detection_models::Entity")]
    AnomalyDetectionModels,
}

impl Related<super::anomaly_detection_models::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AnomalyDetectionModels.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
