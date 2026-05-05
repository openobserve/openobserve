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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_fields_basic() {
        let m = Model {
            anomaly_id: "id1".to_string(),
            org_id: "org".to_string(),
            stream_name: "stream".to_string(),
            stream_type: "logs".to_string(),
            enabled: true,
            name: "test".to_string(),
            description: None,
            query_mode: "sql".to_string(),
            filters: None,
            custom_sql: None,
            detection_function: "rcf".to_string(),
            histogram_interval: "1h".to_string(),
            schedule_interval: "5m".to_string(),
            detection_window_seconds: 3600,
            training_window_days: 7,
            retrain_interval_days: 1,
            threshold: 95,
            seasonality: "none".to_string(),
            is_trained: false,
            training_started_at: None,
            training_completed_at: None,
            last_error: None,
            last_processed_timestamp: None,
            current_model_version: 0,
            rcf_num_trees: 50,
            rcf_tree_size: 256,
            rcf_shingle_size: 8,
            alert_enabled: false,
            alert_destinations: None,
            folder_id: "folder1".to_string(),
            owner: None,
            status: 0,
            retries: 0,
            last_updated: 0,
            created_at: 1000,
            updated_at: 1000,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.stream_type, "logs");
        assert!(m.enabled);
        assert!(!m.is_trained);
        assert_eq!(m.status, 0);
    }
}
