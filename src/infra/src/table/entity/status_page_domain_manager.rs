//! `SeaORM` Entity for the status_page_domain_manager table: one row, `id = 1`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_manager")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: i32,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<i64>,
    /// The SIV ciphertext of the key check constant; NULL until the first node with a key.
    pub key_check: Option<String>,
    pub epoch: i64,
    /// JSON text written by the domain manager.
    pub installation_status: Option<String>,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
