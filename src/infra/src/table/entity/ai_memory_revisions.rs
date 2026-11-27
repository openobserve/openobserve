//! `SeaORM` Entity for the `ai_memory_revisions` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_memory_revisions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub memory_id: String,
    pub org: String,
    pub rev: Option<i64>,
    pub state: String,
    pub base_rev: i64,
    /// JSON edit list, encrypted at rest with the org's DEK.
    pub edits: Option<String>,
    /// Encrypted at rest with the org's DEK; set on applied revisions only.
    pub content: Option<String>,
    pub updated_by: String,
    pub reason: Option<String>,
    pub evidence: Option<String>,
    pub origin_region: String,
    pub op_id: String,
    pub created_at: i64,
    /// JSON list of `EditFlag`s of a pending edit; NULL when it raised none.
    pub flags: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
