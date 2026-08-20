// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Deserialize, Serialize)]
#[sea_orm(table_name = "llm_experiments")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub dataset_id: String,
    pub dataset_version: i64,
    pub dataset_filter: Option<Json>,
    pub task_config: Json,
    pub scorers: Json,
    pub trial_count: i32,
    pub metadata: Option<Json>,
    pub status: String,
    pub status_reason: Option<String>,
    pub deadline_at: i64,
    pub completed_at: Option<i64>,
    pub lifecycle_version: i64,
    pub retry_count: i32,
    /// When the runner last confirmed every score pointer for this Experiment
    /// resolved terminal. `NULL` keeps it in the recovery sweep.
    pub scores_settled_at: Option<i64>,
    pub idempotency_key: Option<String>,
    /// At most one row per organization and Dataset carries the Baseline flag.
    pub is_baseline: bool,
    /// When early deletion started. A marked row is unavailable to every read
    /// while asynchronous cleanup finishes.
    pub deleted_at: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
