//! `SeaORM` Entity for the `ai_chat_sessions` table (server-side chat persistence).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_chat_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,
    pub user_id: String,
    pub opencode_session_id: Option<String>,
    pub agent_type: String,
    pub title: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub first_event_at: Option<i64>,
    pub last_event_at: Option<i64>,
    /// Highest contiguous durably-committed opencode seq; -1 when none.
    pub last_committed_seq: i64,
    pub session_epoch: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
