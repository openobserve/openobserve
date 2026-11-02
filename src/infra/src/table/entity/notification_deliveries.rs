//! `SeaORM` Entity for the `notification_deliveries` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "notification_deliveries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub kind: String,
    pub object_id: String,
    pub episode_id: String,
    pub event: String,
    pub destination: String,
    pub channel: String,
    pub template_source: String,
    pub template_name: String,
    pub template_skipped: String,
    pub opens_episode: bool,
    pub status: String,
    pub attempt: i32,
    pub max_attempts: i32,
    pub retryable: bool,
    pub status_code: Option<i32>,
    pub error: Option<String>,
    pub skip_reason: Option<String>,
    pub subject: Option<String>,
    pub payload: String,
    pub claim_token: Option<String>,
    pub claimed_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub next_retry_at: Option<i64>,
    pub created_at: i64,
    pub episode_closed_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
