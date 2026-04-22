//! `SeaORM` Entity for model_pricing table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "model_pricing")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub name: String,
    pub match_pattern: String,
    pub enabled: bool,
    pub tiers: Json,
    pub valid_from: Option<i64>,
    pub sort_order: i32,
    pub source: String,
    pub provider: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
