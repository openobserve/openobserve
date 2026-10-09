//! `SeaORM` Entity for the `ai_chat_turns` table (one row per submitted chat turn).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_chat_turns")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub session_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub turn_id: String,
    /// `running` | `completed` | `cancelled` | `failed` | `interrupted`.
    pub status: String,
    pub error_code: Option<String>,
    /// First and last committed seq of the turn's events; NULL when it stored none.
    pub start_seq: Option<i64>,
    pub end_seq: Option<i64>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
