//! `SeaORM` Entity for the `ai_turn_marks` table (running assistant turns and their confirmations).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_turn_marks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub session_id: String,
    pub user_email: String,
    /// `turn` | `confirmation`.
    pub kind: String,
    /// The tool a `confirmation` asks about.
    pub value: Option<String>,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
