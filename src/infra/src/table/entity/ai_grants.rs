//! `SeaORM` Entity for the `ai_grants` table (standing approvals of assistant tool calls).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_grants")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    /// The member the grant lets the assistant act for without asking.
    pub user_email: String,
    pub tool: String,
    pub operation: String,
    /// `always` | `chat`.
    pub scope: String,
    /// Set only for a `chat` grant.
    pub chat_id: Option<String>,
    pub granted_by: String,
    pub granted_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
