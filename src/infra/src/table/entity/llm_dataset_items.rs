// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "llm_dataset_items")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub row_id: String,
    pub logical_id: String,
    pub org_id: String,
    pub dataset_id: String,
    pub input: Json,
    pub expected_output: Json,
    pub global_version: i64,
    pub is_deleted: bool,
    pub source: String,
    pub source_ref: Option<String>,
    pub source_span_id: Option<String>,
    pub metadata: Option<Json>,
    pub tags: Option<Json>,
    pub queue_id: Option<String>,
    pub review_submission_id: Option<String>,
    pub import_filename: Option<String>,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
