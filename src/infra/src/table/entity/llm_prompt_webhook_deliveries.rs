// Copyright 2026 OpenObserve Inc.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Deserialize, Serialize)]
#[sea_orm(table_name = "llm_prompt_webhook_deliveries")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub event_type: String,
    pub payload: Json,
    pub endpoint: String,
    pub secret_ref: String,
    pub status: String,
    pub attempt_count: i32,
    pub next_attempt_at: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub delivered_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
