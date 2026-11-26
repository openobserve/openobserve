//! `SeaORM` Entity for the status_page_domain_listeners table: one heartbeat row per node.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "status_page_domain_listeners")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub node_uuid: String,
    pub node_name: String,
    /// `ip:https_port`.
    pub address: String,
    pub last_seen_at: i64,
    pub certs_loaded: i32,
    pub last_sync_at: i64,
    /// Every connection seen in the last hour came from a private address.
    pub private_peers_only: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
