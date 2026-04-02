//! `SeaORM` Entity for anomaly_detection_config table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "anomaly_detection_config")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub anomaly_id: String,
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
    pub histogram_interval: String,
    pub schedule_interval: String,
    /// Look-back window per detection run, in seconds. Mirrors alerts' trigger_period_seconds.
    pub detection_window_seconds: i64,
    pub training_window_days: i32,
    pub retrain_interval_days: i32,
    pub threshold: i32,
    pub seasonality: String,
    pub is_trained: bool,
    pub training_started_at: Option<i64>,
    pub training_completed_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_processed_timestamp: Option<i64>,
    pub current_model_version: i64,
    pub rcf_num_trees: i32,
    pub rcf_tree_size: i32,
    pub rcf_shingle_size: i32,
    pub alert_enabled: bool,
    pub alert_destinations: Option<Json>,
    /// Folder PK (folders.id KSUID). Stores the same FK as the alerts table.
    pub folder_id: String,
    pub owner: Option<String>,
    /// 0=waiting, 1=ready, 2=training, 3=failed, 4=disabled
    pub status: i32,
    pub retries: i32,
    pub last_updated: i64,
    pub created_at: i64,
    pub updated_at: i64,
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
