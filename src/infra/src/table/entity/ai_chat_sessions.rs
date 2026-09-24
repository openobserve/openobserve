//! `SeaORM` Entity for the `ai_chat_sessions` table (server-side chat persistence).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_chat_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,
    /// Owner: the stable `users.id`, never the (mutable, reusable) email.
    pub user_id: String,
    /// Owner's email at creation, for audit and display only.
    pub user_email: String,
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
    /// Ownership epoch; bumped by every restore onto another replica.
    pub session_epoch: i64,
    /// Client-supplied id of the most recent turn, so a retried request does
    /// not start a second model run.
    pub last_turn_id: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
