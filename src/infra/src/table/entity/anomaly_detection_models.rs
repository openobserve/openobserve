//! `SeaORM` Entity for anomaly_detection_models table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "anomaly_detection_models")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub anomaly_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub version: i64,
    pub s3_path: String,
    pub s3_bucket: String,
    pub model_size_bytes: i64,
    pub training_start_time: i64,
    pub training_end_time: i64,
    pub training_data_points: i32,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::anomaly_detection_config::Entity",
        from = "Column::AnomalyId",
        to = "super::anomaly_detection_config::Column::AnomalyId",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    AnomalyDetectionConfig,
}

impl Related<super::anomaly_detection_config::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AnomalyDetectionConfig.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_fields() {
        let m = Model {
            anomaly_id: "anom-1".to_string(),
            version: 1,
            s3_path: "/path/to/model".to_string(),
            s3_bucket: "my-bucket".to_string(),
            model_size_bytes: 1024,
            training_start_time: 1000,
            training_end_time: 2000,
            training_data_points: 500,
            created_at: 1000,
        };
        assert_eq!(m.anomaly_id, "anom-1");
        assert_eq!(m.version, 1);
        assert_eq!(m.model_size_bytes, 1024);
        assert_eq!(m.training_data_points, 500);
    }
}
