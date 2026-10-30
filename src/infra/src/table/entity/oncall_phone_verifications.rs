use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_phone_verifications")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub user_email: String,
    pub target: String,
    pub code_hash: Option<String>,
    pub attempts: i32,
    pub sent_at: i64,
    pub sends_today: i64,
    pub day_started_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
