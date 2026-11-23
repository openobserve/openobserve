//! `SeaORM` Entity for the status_page_domain_certs table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_certs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub hostname: String,
    /// The holder claim; NULL for the domain target's own certificate.
    pub claim_id: Option<String>,
    pub org_id: Option<String>,
    /// The CA directory that issued it; empty for an imported certificate.
    pub ca_directory: String,
    /// PEM, leaf first.
    pub cert_chain: String,
    /// AES-256-SIV with the domain key, base64. Never plaintext.
    pub private_key: String,
    /// SHA-256 of the leaf, hex.
    pub fingerprint: String,
    pub previous_fingerprint: Option<String>,
    pub not_before: i64,
    pub not_after: i64,
    pub renew_at: Option<i64>,
    /// `acme`, `imported` or `target`.
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
