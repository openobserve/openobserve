use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_response_events")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub response_id: String,
    pub kind: i32,
    pub at: i64,
    pub actor: String,
    pub body: String,
    pub rung_micros: Option<i64>,
    pub ladder_run: Option<i32>,
    pub recipient: Option<String>,
    pub channel: Option<i32>,
    pub delivered: Option<bool>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
