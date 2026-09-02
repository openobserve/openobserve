//! `SeaORM` Entity for the status_page_components table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_page_components")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub status_page_id: String,
    pub org_id: String,
    /// The ONLY publicly visible name; check names never leave the admin UI.
    pub name: String,
    pub description: Option<String>,
    pub sort_order: i32,
    /// One-time publish backfill (JSON day estimates); immutable, then aged out.
    pub backfill_days: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
