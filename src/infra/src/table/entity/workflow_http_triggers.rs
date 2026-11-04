//! `SeaORM` Entity for `workflow_http_triggers`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "workflow_http_triggers")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub workflow_id: String,
    pub enabled: bool,
    pub auth_mode: String,
    pub max_body_bytes: i64,
    pub rate_limit_per_minute: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub version: i64,
    pub origin_cluster: String,
    pub deleted_at: Option<i64>,
    pub last_invoked_at: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub rejections: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
