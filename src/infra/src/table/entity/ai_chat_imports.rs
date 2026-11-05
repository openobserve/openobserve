//! `SeaORM` Entity for the `ai_chat_imports` table (browser-recorded chats moved to the server).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_chat_imports")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    /// `users.id` of the member who imported the chat.
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    /// The browser's id of the chat; one import per member and id.
    #[sea_orm(primary_key, auto_increment = false)]
    pub client_id: String,
    pub session_id: String,
    pub origin: String,
    /// The recorded turns, frames only.
    #[sea_orm(column_type = "Text")]
    pub turns: String,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
