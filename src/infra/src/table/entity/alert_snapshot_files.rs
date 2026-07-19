//! `SeaORM` Entity for alert_snapshot_files table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_snapshot_files")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub snapshot_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub file_key: String,

    pub stream_type: String,
    pub stream_name: String,
    pub file_id: Option<i64>,
    /// Timestamps in microseconds
    pub min_ts: i64,
    pub max_ts: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::alert_snapshots::Entity",
        from = "Column::SnapshotId",
        to = "super::alert_snapshots::Column::SnapshotId"
    )]
    Snapshot,
}

impl Related<super::alert_snapshots::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Snapshot.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
