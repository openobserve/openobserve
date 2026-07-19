//! `SeaORM` Entity for alert_snapshots table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_snapshots")]
pub struct Model {
    /// KSUID (27 chars)
    #[sea_orm(primary_key, auto_increment = false)]
    pub snapshot_id: String,
    pub org_id: String,
    pub alert_id: String,
    pub alert_name: Option<String>,
    /// Timestamps in microseconds
    pub trigger_timestamp: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub created_at: i64,
    pub schema_version: i16,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::alert_snapshot_files::Entity")]
    Files,
}

impl Related<super::alert_snapshot_files::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Files.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
