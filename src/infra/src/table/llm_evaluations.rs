// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Org teardown for the LLM evaluation tables that have no service-layer sweep.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};

use crate::{
    errors,
    table::entity::{
        llm_annotation_queue_bindings, llm_annotation_queue_items, llm_annotation_queues,
        llm_dataset_items, llm_datasets, llm_experiments, llm_idempotency_records,
        llm_playground_snapshots, llm_remote_tasks,
    },
};

/// Removes every LLM evaluation row belonging to an org, children first.
pub async fn delete_by_org(db: &DatabaseConnection, org_id: &str) -> Result<(), errors::Error> {
    let txn = db.begin().await?;

    // No cascade fires on SQLite: sea-orm never sets `PRAGMA foreign_keys=ON`.
    llm_annotation_queue_bindings::Entity::delete_many()
        .filter(llm_annotation_queue_bindings::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_annotation_queue_items::Entity::delete_many()
        .filter(llm_annotation_queue_items::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_dataset_items::Entity::delete_many()
        .filter(llm_dataset_items::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_experiments::Entity::delete_many()
        .filter(llm_experiments::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_annotation_queues::Entity::delete_many()
        .filter(llm_annotation_queues::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_datasets::Entity::delete_many()
        .filter(llm_datasets::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_remote_tasks::Entity::delete_many()
        .filter(llm_remote_tasks::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_playground_snapshots::Entity::delete_many()
        .filter(llm_playground_snapshots::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    llm_idempotency_records::Entity::delete_many()
        .filter(llm_idempotency_records::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;

    txn.commit().await?;
    Ok(())
}
