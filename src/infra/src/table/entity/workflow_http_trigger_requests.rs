//! `SeaORM` Entity for `workflow_http_trigger_requests`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "workflow_http_trigger_requests")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub trigger_id: String,
    pub org_id: String,
    pub workflow_id: String,
    pub run_id: String,
    pub idem_key: Option<String>,
    pub body_sha256: String,
    pub body_bytes: i64,
    pub content_type: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub meta: String,
    pub status: String,
    pub claimed_by: Option<String>,
    pub claimed_at: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    pub credential_id: String,
    pub credential_prefix: String,
    pub caller_ip: String,
    pub received_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
