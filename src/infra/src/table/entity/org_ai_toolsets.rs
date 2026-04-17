//! `SeaORM` Entity for the `org_ai_toolsets` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "org_ai_toolsets")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub name: String,
    pub kind: String,
    pub description: Option<String>,
    /// Encrypted at rest with the org's DEK. `None` when no config is needed.
    pub data: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
