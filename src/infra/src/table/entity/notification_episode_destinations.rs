//! `SeaORM` Entity for the `notification_episode_destinations` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "notification_episode_destinations")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub kind: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub episode_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub destination: String,
    pub channel: String,
    pub platform: Option<String>,
    pub trigger_outcome: String,
    pub first_sent_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
