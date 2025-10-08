//! `SeaORM` Entity for pipeline_last_errors table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "pipeline_last_errors")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub pipeline_id: String,
    pub org_id: String,
    pub pipeline_name: String,
    pub last_error_timestamp: i64,
    pub error_summary: Option<String>,
    pub node_errors: Option<Json>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
