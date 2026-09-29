// Copyright 2026 OpenObserve Inc.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Deserialize, Serialize)]
#[sea_orm(table_name = "llm_prompt_labels")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub entity_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub name: String,
    pub version: Option<i32>,
    pub deleted_at: Option<i64>,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
