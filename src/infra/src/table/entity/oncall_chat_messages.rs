use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_chat_messages")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub response_id: String,
    pub team_id: String,
    pub ladder_run: i32,
    /// `slack_installations.id`.
    pub installation_id: String,
    pub channel_id: String,
    pub message_ts: Option<String>,
    pub permalink: Option<String>,
    pub kind: i32,
    pub recipient: Option<String>,
    pub status: i32,
    #[sea_orm(column_type = "Text")]
    pub rendered: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
