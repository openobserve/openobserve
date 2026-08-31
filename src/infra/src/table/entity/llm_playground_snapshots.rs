// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// A shared Playground snapshot.
///
/// `payload` holds the whole workbench by value — columns, rows, results and
/// scores — so the snapshot keeps rendering after the dataset, scorer or
/// provider it was taken from has moved on. Every field is immutable except
/// `last_accessed_at`, which the sliding TTL renews on each read.
///
/// `Serialize`/`Deserialize` are load-bearing: the model travels verbatim over
/// the super-cluster queue.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "llm_playground_snapshots")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub payload: Json,
    /// Weak reference to the snapshot this one was forked from. The parent may
    /// be purged first, so this is never a foreign key and readers must treat
    /// a missing parent as "lineage unavailable" rather than an error.
    pub parent_snapshot_id: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub last_accessed_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
