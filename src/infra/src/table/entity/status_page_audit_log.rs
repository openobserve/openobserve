//! `SeaORM` Entity for the status_page_audit_log table.
//!
//! Append-only ledger of uptime-affecting mutations (R-4). No update/delete
//! path exists — the table op layer only inserts.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_audit_log")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub notice_id: Option<String>,
    /// Small action code; the human label is in `detail`.
    pub action: i32,
    pub actor: String,
    pub at: i64,
    pub detail: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
