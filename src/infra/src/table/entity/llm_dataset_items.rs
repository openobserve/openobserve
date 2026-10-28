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
    /// The Dataset version shown for the write request that stored this row; every row of one
    /// request shares it, while `global_version` stays unique per row. NULL for rows written
    /// before the column existed or by an older node: such a row is its own write, numbered by
    /// `global_version`. Display only: two regions can label different writes with one value.
    #[serde(default)]
    pub write_version: Option<i64>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replicated_rows_preserve_write_versions_and_accept_older_payloads() {
        // EvalDatasetMessage carries this row as JSON; old nodes omit the new column.
        let legacy = serde_json::json!({
            "row_id": "row-1",
            "logical_id": "item-1",
            "org_id": "org-1",
            "dataset_id": "dataset-1",
            "input": "question",
            "expected_output": "answer",
            "global_version": 59,
            "is_deleted": false,
            "source": "manual",
            "updated_by": "owner@example.com",
            "updated_at": 100
        });
        let mut row: Model = serde_json::from_value(legacy).unwrap();
        assert_eq!(row.write_version, None);
        row.write_version = Some(57);
        let payload = serde_json::to_value(&row).unwrap();
        assert_eq!(payload["write_version"], 57);
        assert_eq!(serde_json::from_value::<Model>(payload).unwrap(), row);
    }
}
