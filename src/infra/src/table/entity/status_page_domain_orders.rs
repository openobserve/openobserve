//! `SeaORM` Entity for the status_page_domain_orders table: one row per certificate order.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_orders")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub hostname: String,
    pub registered_domain: String,
    /// NULL for the domain target's own order.
    pub org_id: Option<String>,
    pub claim_id: Option<String>,
    /// `first`, `renewal` or `target`.
    pub kind: String,
    /// `started`, `finalize_sent`, `done`, `failed` or `abandoned`.
    pub state: String,
    pub order_url: Option<String>,
    /// A failure code, then the CA's message; empty until the order ends.
    pub outcome: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
