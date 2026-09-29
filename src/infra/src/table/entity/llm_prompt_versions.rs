// Copyright 2026 OpenObserve Inc.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Deserialize, Serialize)]
#[sea_orm(table_name = "llm_prompt_versions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    pub version: i32,
    pub payload: Json,
    pub config: Json,
    pub commit_message: String,
    pub source: String,
    pub base_version: Option<i32>,
    pub content_hash: String,
    pub created_by: String,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
