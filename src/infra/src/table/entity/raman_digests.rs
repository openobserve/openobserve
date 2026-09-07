//! `SeaORM` Entity for the raman_digests table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "raman_digests")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub config_id: String,
    /// Empty outside a super-cluster; keeps per-cluster runs of one window apart.
    pub cluster: String,
    pub window_start: i64,
    pub window_end: i64,
    pub generated_at: i64,
    /// Denormalized so a listing never parses `findings`.
    pub finding_count: i32,
    pub findings: Json,
    pub coverage_gap: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
