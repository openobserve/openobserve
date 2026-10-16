// Copyright 2026 OpenObserve Inc.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Deserialize, Serialize)]
#[sea_orm(table_name = "llm_prompts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub entity_id: String,
    pub org_id: String,
    pub name: String,
    pub folder_id: String,
    pub prompt_type: String,
    pub description: Option<String>,
    pub tags: Json,
    pub status: String,
    pub latest_version: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
