//! `SeaORM` Entity for the `ai_toolset_health` table (per-region toolset call health).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_toolset_health")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub toolset: String,
    pub last_ok_at: Option<i64>,
    pub last_error_at: Option<i64>,
    pub failing_since: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
