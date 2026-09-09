//! `SeaORM` Entity for the alert_hygiene_configs table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "alert_hygiene_configs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// At most one row per organization, enforced by a unique index.
    pub org: String,
    pub enabled: bool,
    pub frequency_minutes: i32,
    pub window_minutes: i32,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
