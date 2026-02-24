//! `SeaORM` Entity for anomaly_detection_models table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "anomaly_detection_models")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub config_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub version: i64,
    pub s3_path: String,
    pub s3_bucket: String,
    pub model_size_bytes: i64,
    pub training_start_time: i64,
    pub training_end_time: i64,
    pub training_data_points: i32,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::anomaly_detection_config::Entity",
        from = "Column::ConfigId",
        to = "super::anomaly_detection_config::Column::ConfigId",
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
