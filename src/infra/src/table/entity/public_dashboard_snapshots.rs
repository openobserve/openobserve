//! `SeaORM` Entity for the public_dashboard_snapshots table.
//!
//! One materialized row per (public dashboard, time-range preset). `data` is a
//! serialized snapshot of the panels' rendered query results; the anonymous
//! public plane point-reads this and never runs a query.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "public_dashboard_snapshots")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub public_dashboard_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub preset_secs: i64,
    pub data: String,
    pub built_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
