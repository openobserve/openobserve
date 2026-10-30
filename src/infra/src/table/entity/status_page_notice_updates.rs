//! A notice's append-only update timeline; only an org deletion removes its rows.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_page_notice_updates")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub notice_id: String,
    pub org_id: String,
    pub body: String,
    pub owner: Option<String>,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
