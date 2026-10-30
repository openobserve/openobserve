//! `SeaORM` Entity for the status_page_snapshots table.
//!
//! Region-local derived data, never replicated. Hot/cold split: `current`
//! (~1-2KB) rewrites on state change; `history` (~30KB, TOASTed) rewrites only
//! on day rollover or notice change — a status flip never re-WALs the history.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_snapshots")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub status_page_id: String,
    pub org_id: String,
    pub history: String,
    pub current: String,
    pub history_generated_at: i64,
    pub current_generated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
