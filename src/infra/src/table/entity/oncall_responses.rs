use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_responses")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub subject_type: i32,
    pub subject_id: String,
    pub team_id: String,
    pub priority: i32,
    pub state: i32,
    pub opened_at: i64,
    pub acked_by: Option<String>,
    pub acked_at: Option<i64>,
    pub closed_at: Option<i64>,
    pub incident_id: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
