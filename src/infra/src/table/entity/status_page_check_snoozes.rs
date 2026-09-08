//! `SeaORM` Entity for the status_page_check_snoozes table.
//!
//! Org-wide per check: snoozing a 3am false positive silences it on every
//! page, not one.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_page_check_snoozes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub synthetics_id: String,
    pub snoozed_until: i64,
    pub owner: Option<String>,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
