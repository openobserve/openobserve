//! `SeaORM` Entity for `org_telephony`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "org_telephony")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    pub provider: String,
    pub data: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
