//! `SeaORM` Entity for the `notification_episodes` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "notification_episodes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub kind: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub episode_id: String,
    pub object_id: String,
    pub opened_at: i64,
    pub closed_at: Option<i64>,
    pub closed_by: Option<String>,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
