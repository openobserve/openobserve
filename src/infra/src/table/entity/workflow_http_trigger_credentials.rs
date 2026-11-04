//! `SeaORM` Entity for `workflow_http_trigger_credentials`.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "workflow_http_trigger_credentials")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub trigger_id: String,
    pub org_id: String,
    pub kind: String,
    pub display_prefix: String,
    pub token_sha256: Option<String>,
    pub secret_ref: Option<String>,
    pub state: String,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
