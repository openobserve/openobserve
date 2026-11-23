//! `SeaORM` Entity for the status_page_domain_acme_accounts table: one CA account per directory.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_acme_accounts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub ca_directory: String,
    /// The account credentials, AES-256-SIV under the domain key, base64.
    pub credentials: String,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
