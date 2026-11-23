//! `SeaORM` Entity for the status_page_domain_revocations table: certificates waiting to be
//! revoked at their CA. The certificate only, never a key.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_revocations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub hostname: String,
    pub cert_chain: String,
    pub ca_directory: String,
    /// `waiting`, `done` or `gave_up`.
    pub state: String,
    pub attempts: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
