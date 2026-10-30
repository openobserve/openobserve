//! `SeaORM` Entity for the `ai_chat_feedback` table (a member's vote on one assistant turn).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_chat_feedback")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub turn_id: String,
    /// `users.id` of the member who voted.
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    /// `up` | `down`.
    pub rating: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub comment: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
