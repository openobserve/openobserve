//! `SeaORM` Entity for `ai_memory_tombstones`: a deleted memory's key, kept 30 days.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_memory_tombstones")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub scope: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub scope_key: String,
    pub deleted_at: i64,
    pub region: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
