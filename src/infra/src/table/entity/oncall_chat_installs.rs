//! `SeaORM` Entity for `oncall_chat_installs`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_chat_installs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub platform: i32,
    pub workspace_id: String,
    pub workspace_name: String,
    pub enterprise_id: Option<String>,
    pub app_id: String,
    pub bot_user_id: String,
    #[sea_orm(column_type = "Text")]
    pub bot_token_cipher: String,
    pub scopes: String,
    pub status: i32,
    pub installed_by: String,
    pub installed_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
