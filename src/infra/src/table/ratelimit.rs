// Copyright 2025 OpenObserve Inc.
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

use anyhow::{Context, anyhow};
use bytes::Bytes;
use config::{
    meta::ratelimit::{DEFAULT_STAT_INTERVAL_MS, RatelimitRule, RatelimitRuleType},
    utils::time::now,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    orm_err,
    table::{
        entity::rate_limit_rules::{ActiveModel, Column, Entity},
        migration::{Expr, Order},
    },
};

pub const RULE_EXISTS: &str = "Rule already exists";
pub const RULE_NOT_FOUND: &str = "Rule not found";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RuleEntry {
    Single(RatelimitRule),
    Batch(Vec<RatelimitRule>),
    UpsertBatch(Vec<RatelimitRule>),
}

impl TryFrom<&Bytes> for RuleEntry {
    type Error = anyhow::Error;

    fn try_from(bytes: &Bytes) -> Result<Self, Self::Error> {
        serde_json::from_slice(bytes).context("Failed to deserialize RatelimitRule")
    }
}

pub async fn fetch_rules(
    mut default_rules: Vec<RatelimitRule>,
    org_id: Option<String>,
    user_role: Option<String>,
) -> Result<Vec<RatelimitRule>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::RuleId)
        .column(Column::RuleType)
        .column(Column::UserRole)
        .column(Column::ApiGroupName)
        .column(Column::ApiGroupOperation)
        .column(Column::UserId)
        .column(Column::Threshold)
        .column(Column::StatIntervalMs)
        .order_by(Column::Threshold, Order::Asc);

    if let Some(org_id) = org_id {
        res = res.filter(Column::Org.eq(org_id));
    };

    if let Some(user_role) = user_role {
        res = res.filter(Column::UserRole.eq(user_role));
    };

    let records = res
        .into_model::<RatelimitRule>()
        .all(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;

    default_rules.extend(records);
    Ok(default_rules)
}

pub async fn fetch_rules_by_id(rule_id: &str) -> Result<Option<RatelimitRule>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::RuleId)
        .column(Column::RuleType)
        .column(Column::UserRole)
        .column(Column::ApiGroupName)
        .column(Column::ApiGroupOperation)
        .column(Column::UserId)
        .column(Column::Threshold)
        .column(Column::StatIntervalMs)
        .filter(Column::RuleId.eq(rule_id));
    let record = res
        .into_model::<RatelimitRule>()
        .one(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;
    Ok(record)
}

pub async fn add(rule: RuleEntry) -> Result<(), anyhow::Error> {
    match rule {
        RuleEntry::Single(rule) => add_single(rule).await,
        RuleEntry::Batch(rules) => add_batch(rules).await,
        RuleEntry::UpsertBatch(rules) => add_upsert_batch(rules).await,
    }
}

async fn add_batch(rules: Vec<RatelimitRule>) -> Result<(), anyhow::Error> {
    if rules.is_empty() {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Collect all rule IDs and validate
    let rule_ids: Vec<String> = rules
        .iter()
        .map(|rule| {
            rule.rule_id
                .clone()
                .ok_or_else(|| anyhow!("Rule ID is required for batch operations"))
        })
        .collect::<Result<Vec<String>, _>>()?;

    // Check for existing rules
    let existing_rules = Entity::find()
        .filter(Column::RuleId.is_in(rule_ids.clone()))
        .all(client)
        .await
        .map_err(|e| anyhow!("DbError# Failed to fetch existing rules: {}", e))?;

    // If any rule exists, return error with details
    if !existing_rules.is_empty() {
        let existing_ids: Vec<String> = existing_rules
            .iter()
            .map(|rule| rule.rule_id.clone())
            .collect();

        return Err(anyhow!(
            "Cannot add batch: following rules already exist: {}",
            existing_ids.join(", ")
        ));
    }

    // Prepare batch insert
    let current_timestamp = now().timestamp();
    let active_rules: Vec<ActiveModel> = rules
        .into_iter()
        .map(|rule| ActiveModel {
            org: Set(rule.org),
            rule_id: Set(rule.rule_id.unwrap()),
            rule_type: Set(rule
                .rule_type
                .unwrap_or(RatelimitRuleType::Exact.to_string())),
            user_role: Set(rule.user_role.unwrap_or_default()),
            user_id: Set(rule.user_id.unwrap_or_default()),
            api_group_name: Set(rule.api_group_name.unwrap_or_default()),
            api_group_operation: Set(rule.api_group_operation.unwrap_or_default()),
            threshold: Set(rule.threshold),
            stat_interval_ms: Set(rule.stat_interval_ms.unwrap_or(DEFAULT_STAT_INTERVAL_MS)),
            created_at: Set(current_timestamp),
        })
        .collect();

    // Execute batch insert in a transaction
    let txn = client
        .begin()
        .await
        .map_err(|e| anyhow!("DbError# Failed to start transaction: {}", e))?;

    match Entity::insert_many(active_rules)
        .exec(&txn)
        .await
        .map_err(|e| anyhow!("DbError# Failed to insert rules: {}", e))
    {
        Ok(_) => {
            txn.commit()
                .await
                .map_err(|e| anyhow!("DbError# Failed to commit transaction: {}", e))?;
        }
        Err(e) => {
            txn.rollback()
                .await
                .map_err(|e| anyhow!("DbError# Failed to rollback transaction: {}", e))?;
            return Err(e);
        }
    }

    Ok(())
}

async fn add_upsert_batch(rules: Vec<RatelimitRule>) -> Result<(), anyhow::Error> {
    if rules.is_empty() {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let current_time = config::utils::time::now_micros();

    // Start transaction
    let txn = client
        .begin()
        .await
        .map_err(|e| anyhow!("DbError# Failed to start transaction: {}", e))?;

    for rule in rules {
        // Check if rule exists
        let existing_rule = Entity::find()
            .filter(Column::Org.eq(rule.org.clone()))
            .filter(Column::UserRole.eq(rule.user_role.clone().unwrap_or_default()))
            .filter(Column::UserId.eq(rule.user_id.clone().unwrap_or_default()))
            .filter(Column::ApiGroupName.eq(rule.api_group_name.clone().unwrap_or_default()))
            .filter(
                Column::ApiGroupOperation.eq(rule.api_group_operation.clone().unwrap_or_default()),
            )
            .filter(
                Column::StatIntervalMs
                    .eq(rule.stat_interval_ms.unwrap_or(DEFAULT_STAT_INTERVAL_MS)),
            )
            .one(&txn)
            .await
            .map_err(|e| anyhow!("DbError# Failed to fetch existing rule: {}", e))?;

        match existing_rule {
            Some(existing) => {
                // Update existing rule using the Model's primary key
                let mut active_model: ActiveModel = existing.clone().into();

                // Update only the fields that should change
                active_model.org = Set(rule.org);
                active_model.rule_id = Set(existing.rule_id.clone());
                active_model.rule_type = Set(rule
                    .rule_type
                    .unwrap_or(RatelimitRuleType::Exact.to_string()));
                active_model.user_role = Set(rule.user_role.unwrap_or_default());
                active_model.user_id = Set(rule.user_id.unwrap_or_default());
                active_model.api_group_name = Set(rule.api_group_name.unwrap_or_default());
                active_model.api_group_operation =
                    Set(rule.api_group_operation.unwrap_or_default());
                active_model.threshold = Set(rule.threshold);
                active_model.stat_interval_ms =
                    Set(rule.stat_interval_ms.unwrap_or(DEFAULT_STAT_INTERVAL_MS));
                active_model.created_at = Set(existing.created_at);

                if let Err(e) = active_model.save(&txn).await {
                    txn.rollback()
                        .await
                        .map_err(|e| anyhow!("DbError# Failed to rollback transaction: {}", e))?;

                    return Err(anyhow!(
                        "DbError# Failed to update rule: {:?}, {}",
                        existing,
                        e
                    ));
                }
            }
            None => {
                // if threshold <= 0 (which means no limit) and no record in the table,
                // we should not insert a new record
                if rule.threshold > 0 {
                    // Insert new rule
                    let active_model = ActiveModel {
                        org: Set(rule.org),
                        rule_id: Set(rule.rule_id.unwrap()),
                        rule_type: Set(rule
                            .rule_type
                            .unwrap_or(RatelimitRuleType::Exact.to_string())),
                        user_role: Set(rule.user_role.unwrap_or_default()),
                        user_id: Set(rule.user_id.unwrap_or_default()),
                        api_group_name: Set(rule.api_group_name.unwrap_or_default()),
                        api_group_operation: Set(rule.api_group_operation.unwrap_or_default()),
                        threshold: Set(rule.threshold),
                        stat_interval_ms: Set(rule
                            .stat_interval_ms
                            .unwrap_or(DEFAULT_STAT_INTERVAL_MS)),
                        created_at: Set(current_time),
                    };
                    log::debug!("add_upsert_batch insert active_model: {active_model:?} ");
                    if let Err(e) = Entity::insert(active_model).exec(&txn).await {
                        txn.rollback().await.map_err(|e| {
                            anyhow!("DbError# Failed to rollback transaction: {}", e)
                        })?;

                        return Err(anyhow!("DbError# Failed to insert rule: {}", e));
                    }
                }
            }
        }
        // wait for a while to reduce the databases load
        tokio::task::yield_now().await;
    }

    // Commit transaction
    txn.commit()
        .await
        .map_err(|e| anyhow!("DbError# Failed to commit transaction: {}", e))?;

    Ok(())
}

async fn add_single(rule: RatelimitRule) -> Result<(), anyhow::Error> {
    let rule_id = rule.rule_id.clone();
    match fetch_rules_by_id(rule_id.unwrap().as_str()).await {
        Ok(None) => {
            let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
            let active_rule = ActiveModel {
                org: Set(rule.org),
                rule_id: Set(rule.rule_id.unwrap()),
                rule_type: Set(rule
                    .rule_type
                    .unwrap_or(RatelimitRuleType::Exact.to_string())),
                user_role: Set(rule.user_role.unwrap_or("".to_string())),
                user_id: Set(rule.user_id.unwrap_or_default()),
                api_group_name: Set(rule.api_group_name.unwrap_or_default()),
                api_group_operation: Set(rule.api_group_operation.unwrap_or_default()),
                threshold: Set(rule.threshold),
                stat_interval_ms: Set(rule.stat_interval_ms.unwrap_or(DEFAULT_STAT_INTERVAL_MS)),
                created_at: Set(now().timestamp()),
            };
            match Entity::insert(active_rule)
                .exec(client)
                .await
                .map_err(|e| anyhow!("DbError# {e}"))
            {
                Ok(_) => Ok(()),
                Err(e) => orm_err!(format!("Add ratelimit rule error: {e}"))
                    .map_err(|e| anyhow!("DbError# {e}"))?,
            }
        }
        Ok(Some(_)) => Err(anyhow::anyhow!(RULE_EXISTS)),
        Err(e) => {
            log::error!("Add Rule Error fetching rule: {:?}", e.to_string());
            Err(anyhow::anyhow!(e.to_string()))
        }
    }
}

pub async fn update(rule: RuleEntry) -> Result<(), anyhow::Error> {
    match rule {
        RuleEntry::Single(rule) => update_single(rule).await,
        RuleEntry::Batch(rules) => update_batch(rules).await,
        RuleEntry::UpsertBatch(rules) => add_upsert_batch(rules).await,
    }
}

async fn update_single(rule: RatelimitRule) -> Result<(), anyhow::Error> {
    let rule_id = rule
        .rule_id
        .clone()
        .ok_or_else(|| anyhow!("Rule ID is required"))?;

    match fetch_rules_by_id(rule_id.as_str()).await {
        Ok(Some(_)) => {
            let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
            match Entity::update_many()
                .col_expr(Column::Org, Expr::value(&rule.org))
                .col_expr(
                    Column::RuleType,
                    Expr::value(
                        rule.rule_type
                            .unwrap_or(RatelimitRuleType::Exact.to_string()),
                    ),
                )
                .col_expr(Column::Threshold, Expr::value(rule.threshold))
                .col_expr(
                    Column::UserRole,
                    Expr::value(rule.user_role.unwrap_or_default()),
                )
                .col_expr(
                    Column::ApiGroupName,
                    Expr::value(rule.api_group_name.unwrap_or_default()),
                )
                .col_expr(
                    Column::ApiGroupOperation,
                    Expr::value(rule.api_group_operation.unwrap_or_default()),
                )
                .filter(Column::RuleId.eq(rule_id))
                .exec(client)
                .await
                .map_err(|e| anyhow!("DbError# {e}"))
            {
                Ok(_) => Ok(()),
                Err(e) => orm_err!(format!("update ratelimit rule error: {e}"))
                    .map_err(|e| anyhow!("DbError# {e}"))?,
            }
        }
        Ok(None) => Err(anyhow::anyhow!(RULE_NOT_FOUND)),
        Err(e) => {
            log::error!("Update rule Error fetching rule: {:?}", e.to_string());
            Err(anyhow::anyhow!(e.to_string()))
        }
    }
}

async fn update_batch(rules: Vec<RatelimitRule>) -> Result<(), anyhow::Error> {
    if rules.is_empty() {
        return Ok(());
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client
        .begin()
        .await
        .map_err(|e| anyhow!("DbError# Failed to start transaction: {}", e))?;

    // Collect all rule IDs
    let rule_ids: Vec<String> = rules
        .iter()
        .map(|rule| {
            rule.rule_id
                .clone()
                .ok_or_else(|| anyhow!("Rule ID is required for batch operations"))
        })
        .collect::<Result<Vec<String>, _>>()?;

    // Check if all rules exist
    let existing_rules = Entity::find()
        .filter(Column::RuleId.is_in(rule_ids.clone()))
        .all(&txn)
        .await
        .map_err(|e| anyhow!("DbError# Failed to fetch existing rules: {}", e))?;

    if existing_rules.len() != rule_ids.len() {
        let existing_ids: std::collections::HashSet<String> = existing_rules
            .iter()
            .map(|rule| rule.rule_id.clone())
            .collect();
        let missing_ids: Vec<String> = rule_ids
            .iter()
            .filter(|id| !existing_ids.contains(*id))
            .cloned()
            .collect();

        return Err(anyhow!(
            "The following rules do not exist: rules id {}",
            missing_ids.join(", ")
        ));
    }

    // Update each rule in transaction
    for rule in rules {
        let rule_id = rule.rule_id.clone().unwrap();
        match Entity::update_many()
            .col_expr(Column::Org, Expr::value(&rule.org))
            .col_expr(
                Column::RuleType,
                Expr::value(
                    rule.rule_type
                        .unwrap_or(RatelimitRuleType::Exact.to_string()),
                ),
            )
            .col_expr(Column::Threshold, Expr::value(rule.threshold))
            .col_expr(
                Column::UserRole,
                Expr::value(rule.user_role.unwrap_or_default()),
            )
            .col_expr(
                Column::ApiGroupName,
                Expr::value(rule.api_group_name.unwrap_or_default()),
            )
            .col_expr(
                Column::ApiGroupOperation,
                Expr::value(rule.api_group_operation.unwrap_or_default()),
            )
            .filter(Column::RuleId.eq(rule_id))
            .exec(&txn)
            .await
        {
            Ok(_) => continue,
            Err(e) => {
                txn.rollback()
                    .await
                    .map_err(|e| anyhow!("DbError# Failed to rollback transaction: {}", e))?;
                return Err(anyhow!("DbError# Failed to update rule: {}", e));
            }
        }
    }

    // Commit transaction
    txn.commit()
        .await
        .map_err(|e| anyhow!("DbError# Failed to commit transaction: {}", e))?;

    Ok(())
}

pub async fn delete(rule_id: String) -> Result<(), anyhow::Error> {
    match fetch_rules_by_id(rule_id.as_str()).await {
        Ok(Some(_)) => {
            let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
            match Entity::delete_many()
                .filter(Column::RuleId.eq(rule_id))
                .exec(client)
                .await
                .map_err(|e| anyhow!("DbError# {e}"))
            {
                Ok(_) => Ok(()),
                Err(e) => orm_err!(format!("Delete ratelimit rule error: {e}"))
                    .map_err(|e| anyhow!("DbError# {e}"))?,
            }
        }
        Ok(None) => Err(anyhow::anyhow!(RULE_NOT_FOUND)),
        Err(e) => {
            log::error!("Delete rule Error fetching rule: {:?}", e.to_string());
            Err(anyhow::anyhow!(e.to_string()))
        }
    }
}

pub async fn list(
    org: &str,
    api: Option<&str>,
    user_id: Option<&str>,
) -> Result<Vec<RatelimitRule>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::find()
        .select_only()
        .column(Column::Org)
        .column(Column::RuleId)
        .column(Column::RuleType)
        .column(Column::UserRole)
        .column(Column::ApiGroupName)
        .column(Column::ApiGroupOperation)
        .column(Column::Threshold)
        .filter(Column::Org.eq(org));

    if let Some(api) = api {
        query = query.filter(Column::ApiGroupName.eq(api));
    }

    if let Some(user_id) = user_id {
        query = query.filter(Column::UserRole.eq(user_id));
    }

    let records = query
        .into_model::<RatelimitRule>()
        .all(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;

    Ok(records)
}

#[cfg(test)]
mod tests {
    use std::sync::Once;

    use bytes::Bytes;
    use sea_orm::{DatabaseBackend, DbErr, MockDatabase, MockExecResult};
    use serde_json::json;

    use super::*;
    use crate::table::entity::rate_limit_rules::Model;

    fn create_test_rule() -> RatelimitRule {
        RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("test_rule".to_string()),
            user_role: Some("test_user_role".to_string()),
            user_id: Some("test_user_id".to_string()),
            api_group_name: Some("test_group_name".to_string()),
            api_group_operation: Some("test_operation".to_string()),
            threshold: 100,
            stat_interval_ms: Some(DEFAULT_STAT_INTERVAL_MS),
        }
    }

    fn create_test_model() -> Model {
        Model {
            org: "test_org".to_string(),
            rule_type: "exact".to_string(),
            rule_id: "test_rule".to_string(),
            user_role: "test_user_role".to_string(),
            user_id: "test_user_id".to_string(),
            api_group_name: "api_group_name".to_string(),
            api_group_operation: "operation".to_string(),
            threshold: 100,
            stat_interval_ms: DEFAULT_STAT_INTERVAL_MS,
            created_at: 0,
        }
    }

    #[tokio::test]
    async fn test_fetch_rules() -> Result<(), DbErr> {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![create_test_model()]])
            .into_connection();

        // Override the ORM_CLIENT for testing
        let rules = Entity::find()
            .select_only()
            .column(Column::Org)
            .column(Column::RuleId)
            .column(Column::RuleType)
            .column(Column::UserRole)
            .column(Column::ApiGroupName)
            .column(Column::Threshold)
            .order_by(Column::Threshold, Order::Asc)
            .into_model::<RatelimitRule>()
            .all(&db)
            .await?;

        assert_eq!(rules.len(), 1);
        let rule = &rules[0];
        assert_eq!(rule.org, "test_org");
        assert_eq!(rule.rule_type, Some("exact".to_string()));
        assert_eq!(rule.rule_id, Some("test_rule".to_string()));
        assert_eq!(rule.user_role, Some("test_user_role".to_string()));
        assert_eq!(rule.api_group_name, Some("api_group_name".to_string()));
        assert_eq!(rule.threshold, 100);

        Ok(())
    }

    #[tokio::test]
    async fn test_fetch_rules_by_id() {
        let test_rule = create_test_model();

        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results(vec![vec![test_rule.clone()], vec![]])
            .into_connection();

        let result = Entity::find()
            .select_only()
            .column(Column::Org)
            .column(Column::RuleId)
            .column(Column::RuleType)
            .column(Column::UserRole)
            .column(Column::Threshold)
            .filter(Column::RuleId.eq("test_rule"))
            .into_model::<RatelimitRule>()
            .one(&db)
            .await;

        assert!(result.is_ok());
        let rule = result.unwrap().unwrap();
        assert_eq!(rule.rule_id, Some("test_rule".to_string()));
        assert_eq!(rule.org, "test_org");

        let result = Entity::find()
            .select_only()
            .column(Column::Org)
            .column(Column::RuleId)
            .column(Column::RuleType)
            .column(Column::UserRole)
            .column(Column::Threshold)
            .filter(Column::RuleId.eq("non_existent"))
            .into_model::<RatelimitRule>()
            .one(&db)
            .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_update_rule() -> Result<(), DbErr> {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_exec_results(vec![MockExecResult {
                last_insert_id: 0,
                rows_affected: 1,
            }])
            .into_connection();

        let rule = create_test_rule();

        // Test update
        let result = Entity::update_many()
            .col_expr(Column::Org, Expr::value(&rule.org))
            .col_expr(Column::RuleType, Expr::value(&rule.rule_type.unwrap()))
            .col_expr(Column::UserRole, Expr::value(&rule.user_role.unwrap()))
            .col_expr(Column::Threshold, Expr::value(rule.threshold))
            .filter(Column::RuleId.eq(&rule.rule_id.unwrap()))
            .exec(&db)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().rows_affected, 1);

        Ok(())
    }

    #[test]
    fn test_try_from_bytes() {
        // Test valid JSON
        let json_data = json!({
            "org": "test_org",
            "rule_type": "exact",
            "rule_id": "test_rule_id",
            "user_role": "user_role",
            "user_id": "test_user_id",
            "api": "test_api",
            "threshold": 100,
        });
        let bytes = Bytes::from(json_data.to_string());

        let result = RatelimitRule::try_from(&bytes);
        assert!(result.is_ok());

        let rule = result.unwrap();
        assert_eq!(rule.org, "test_org");
        assert_eq!(rule.rule_type, Some("exact".to_string()));
        assert_eq!(rule.rule_id, Some("test_rule_id".to_string()));
        assert_eq!(rule.user_role, Some("user_role".to_string()));
        assert_eq!(rule.threshold, 100);

        // Test invalid JSON
        let invalid_bytes = Bytes::from("invalid json");
        let result = RatelimitRule::try_from(&invalid_bytes);
        assert!(result.is_err());

        // Test missing fields
        let invalid_json = json!({
            "org": "test_org"
        });
        let bytes = Bytes::from(invalid_json.to_string());
        let result = RatelimitRule::try_from(&bytes);
        assert!(result.is_err());
    }

    #[test]
    fn test_ratelimit_rule_type() {
        assert!(matches!(
            RatelimitRuleType::try_from("exact"),
            Ok(RatelimitRuleType::Exact)
        ));
        assert!(matches!(
            RatelimitRuleType::try_from("regex"),
            Ok(RatelimitRuleType::Regex)
        ));
        assert_eq!(
            RatelimitRuleType::try_from("invalid").unwrap().to_string(),
            RatelimitRuleType::Exact.to_string()
        );
        assert_eq!(RatelimitRuleType::Exact.to_string(), "exact");
        assert_eq!(RatelimitRuleType::Regex.to_string(), "regex");
    }

    static INIT: Once = Once::new();

    async fn setup_test_db(mock_db: sea_orm::DatabaseConnection) {
        INIT.call_once(|| {
            // Initialize ORM_CLIENT only once
            ORM_CLIENT
                .set(mock_db)
                .expect("Failed to set mock database");
        });
    }

    #[tokio::test]
    async fn test_add_batch_empty() {
        let result = add_batch(vec![]).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_add_batch_missing_rule_id() {
        let rules = vec![RatelimitRule {
            org: "test_org".to_string(),
            rule_id: None,
            ..Default::default()
        }];

        // Create mock database
        let db = MockDatabase::new(DatabaseBackend::Postgres).into_connection();

        // Setup test database
        setup_test_db(db).await;

        let result = add_batch(rules).await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Rule ID is required")
        );
    }
}
