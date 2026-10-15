//! `SeaORM` Entity for `oncall_chat_identities`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_chat_identities")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub platform: i32,
    pub workspace_id: String,
    pub platform_user_id: String,
    pub enterprise_user_id: Option<String>,
    pub user_email: String,
    pub linked_at: i64,
    pub unlinked_at: Option<i64>,
    pub changed_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
