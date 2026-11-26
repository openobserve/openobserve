//! `SeaORM` Entity for the status_page_domain_challenges table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_challenges")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub hostname: String,
    /// NULL for the domain target's own challenge.
    pub claim_id: Option<String>,
    pub token: String,
    /// SHA-256 of the key authorization, hex.
    pub key_auth_digest: String,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
