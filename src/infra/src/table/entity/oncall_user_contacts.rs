use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_user_contacts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub user_email: String,
    pub phone: Option<String>,
    pub phone_verified_at: Option<i64>,
    pub push_token: Option<String>,
    pub push_verified_at: Option<i64>,
    pub quiet_hours: Option<String>,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
