//! `SeaORM` Entity for the status_page_notice_updates table.
//!
//! One append-only row per posted narrative update on a notice — the
//! "Elevated errors — investigating / mitigated / resolved" timeline visitors
//! see under a notice. No update/delete op: the timeline is immutable.

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
