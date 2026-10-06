//! `SeaORM` Entity for the `ai_chat_shares` table (sharing persisted AI chats).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_chat_shares")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub session_id: String,
    /// `users.id` of the chat owner who created the share.
    pub created_by: String,
    #[sea_orm(unique)]
    pub token: String,
    /// `snapshot` | `live`.
    pub mode: String,
    /// For a snapshot: the last committed seq the share shows.
    pub snapshot_seq: Option<i64>,
    /// `org` | `public`.
    pub visibility: String,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    pub access_count: i64,
    pub last_accessed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
