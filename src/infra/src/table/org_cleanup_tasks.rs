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

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, Schema,
    Set, entity::prelude::*,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "org_cleanup_tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub org_name: String,
    pub step: String,
    pub step_order: i32,
    pub status: String,
    pub attempts: i32,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

pub type CleanupTask = Model;

pub struct NewCleanupTask {
    pub org_id: String,
    pub org_name: String,
    pub step: String,
    pub step_order: i32,
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let builder = client.get_database_backend();
    let schema = Schema::new(builder);
    let stmt = builder.build(schema.create_table_from_entity(Entity).if_not_exists());
    client
        .execute(stmt)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(())
}

pub async fn add_batch(tasks: &[NewCleanupTask]) -> Result<(), errors::Error> {
    if tasks.is_empty() {
        return Ok(());
    }
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = config::utils::time::now_micros();
    let models: Vec<ActiveModel> = tasks
        .iter()
        .map(|t| ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(t.org_id.clone()),
            org_name: Set(t.org_name.clone()),
            step: Set(t.step.clone()),
            step_order: Set(t.step_order),
            status: Set("pending".to_string()),
            attempts: Set(0),
            last_error: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        })
        .collect();
    // INSERT OR IGNORE: ignore conflicts on (org_id, step) unique index
    Entity::insert_many(models)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([Column::OrgId, Column::Step])
                .do_nothing()
                .to_owned(),
        )
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(())
}

pub async fn list_pending(max_attempts: i32) -> Result<Vec<CleanupTask>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let tasks = Entity::find()
        .filter(
            Condition::any()
                .add(Column::Status.eq("pending"))
                .add(Column::Status.eq("failed")),
        )
        .filter(Column::Attempts.lt(max_attempts))
        .order_by(Column::StepOrder, Order::Asc)
        .all(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(tasks)
}

/// Atomically transition a task from any non-running state to 'running'.
/// Returns true if this node won the CAS; false if another node beat us.
pub async fn mark_running(id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = config::utils::time::now_micros();
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value("running"))
        .col_expr(Column::Attempts, Expr::col(Column::Attempts).add(1))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Id.eq(id))
        .filter(Column::Status.ne("running"))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected > 0)
}

pub async fn mark_done(id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = config::utils::time::now_micros();
    Entity::update_many()
        .col_expr(Column::Status, Expr::value("done"))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(())
}

pub async fn mark_failed(id: &str, error: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = config::utils::time::now_micros();
    Entity::update_many()
        .col_expr(Column::Status, Expr::value("failed"))
        .col_expr(Column::LastError, Expr::value(error))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(())
}

pub async fn list_by_org_status(
    org_id: &str,
    status: Option<&str>,
) -> Result<Vec<CleanupTask>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut q = Entity::find().filter(Column::OrgId.eq(org_id));
    if let Some(s) = status {
        q = q.filter(Column::Status.eq(s));
    }
    q.order_by(Column::StepOrder, Order::Asc)
        .all(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Delete all cleanup-task rows for an org. Called immediately when a deletion
/// completes (org gone) or when an org is resurrected — the ledger for a
/// nonexistent/restored org has no value.
pub async fn delete_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_cleanup_task_fields() {
        let t = NewCleanupTask {
            org_id: "myorg".to_string(),
            org_name: "My Org".to_string(),
            step: "delete_streams".to_string(),
            step_order: 100,
        };
        assert_eq!(t.step_order, 100);
    }

    #[test]
    fn test_cleanup_task_default_status() {
        // CleanupTask has a status field defaulting to "pending" when constructed from
        // NewCleanupTask We can only test the NewCleanupTask struct here since CleanupTask
        // comes from DB
        let t = NewCleanupTask {
            org_id: "org1".to_string(),
            org_name: "Org One".to_string(),
            step: "delete_streams".to_string(),
            step_order: 100,
        };
        assert_eq!(t.step, "delete_streams");
        assert_eq!(t.step_order, 100);
    }

    #[test]
    fn test_new_cleanup_task_step_order_zero_allowed() {
        let t = NewCleanupTask {
            org_id: "org".to_string(),
            org_name: "Org".to_string(),
            step: "custom".to_string(),
            step_order: 0,
        };
        assert_eq!(t.step_order, 0);
    }

    #[test]
    fn test_delete_by_org_builds_scoped_delete() {
        use sea_orm::{QueryTrait, sea_query::PostgresQueryBuilder};
        let stmt = Entity::delete_many()
            .filter(Column::OrgId.eq("myorg"))
            .into_query()
            .to_string(PostgresQueryBuilder);
        assert!(stmt.contains("org_cleanup_tasks"));
        assert!(stmt.contains("org_id"));
        assert!(stmt.contains("myorg"));
    }
}
