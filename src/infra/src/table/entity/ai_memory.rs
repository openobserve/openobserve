//! `SeaORM` Entity for the `ai_memory` table (one memory per org, toolset or user).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_memory")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub scope: String,
    pub scope_key: String,
    /// Encrypted at rest with the org's DEK.
    pub content: String,
    pub rev: i64,
    pub op_id: Option<String>,
    pub updated_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub agent_memory_writes: Option<String>,
    pub max_bytes: Option<i64>,
    pub user_max_bytes: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
