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

//! System Settings Table Operations
//!
//! Provides CRUD operations for the multi-level settings system.
//! Settings resolution order (most specific wins):
//! 1. User level (if user_id provided)
//! 2. Org level (if org_id provided)
//! 3. System level (global defaults)

use anyhow::anyhow;
use config::meta::system_settings::{SettingScope, SystemSetting};
use sea_orm::{
    ActiveModelTrait,
    ActiveValue::{NotSet, Set},
    ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, QueryFilter, QueryOrder, Schema,
};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::entity::system_settings::{ActiveModel, Column, Entity, Model},
};

/// The columns a setting's cache key is built from, in [`SettingRowKey`] order.
const SETTING_KEY_COLUMNS: [Column; 4] = [
    Column::Scope,
    Column::OrgId,
    Column::UserId,
    Column::SettingKey,
];

/// `(scope, org_id, user_id, setting_key)` of one setting row.
pub type SettingRowKey = (String, Option<String>, Option<String>, String);

/// Create the table from the entity, for callers that stand up a schema without running the
/// migrations that own it in production.
pub async fn create_table() -> Result<(), anyhow::Error> {
    let client = get_orm_client_rw().await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client.execute(builder.build(&create_table_stmt)).await?;

    Ok(())
}

/// Get a single setting by scope, org_id, user_id, and key
pub async fn get(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> Result<Option<SystemSetting>, anyhow::Error> {
    let client = get_orm_client_ro().await;

    let mut query = Entity::find()
        .filter(Column::Scope.eq(scope.as_str()))
        .filter(Column::SettingKey.eq(key));

    match scope {
        SettingScope::System => {
            query = query
                .filter(Column::OrgId.is_null())
                .filter(Column::UserId.is_null());
        }
        SettingScope::Org => {
            if let Some(org) = org_id {
                query = query.filter(Column::OrgId.eq(org));
            } else {
                return Err(anyhow!("org_id required for org scope"));
            }
            query = query.filter(Column::UserId.is_null());
        }
        SettingScope::User => {
            if let Some(org) = org_id {
                query = query.filter(Column::OrgId.eq(org));
            } else {
                return Err(anyhow!("org_id required for user scope"));
            }
            if let Some(user) = user_id {
                query = query.filter(Column::UserId.eq(user));
            } else {
                return Err(anyhow!("user_id required for user scope"));
            }
        }
    }

    let result = query
        .one(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;

    Ok(result.map(model_to_setting))
}

/// Get a resolved setting value by checking all levels (user -> org -> system)
/// Returns the most specific setting found
pub async fn get_resolved(
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> Result<Option<SystemSetting>, anyhow::Error> {
    // Check user level first if user_id provided
    if let (Some(org), Some(user)) = (org_id, user_id)
        && let Some(setting) = get(&SettingScope::User, Some(org), Some(user), key).await?
    {
        return Ok(Some(setting));
    }

    // Check org level if org_id provided
    if let Some(org) = org_id
        && let Some(setting) = get(&SettingScope::Org, Some(org), None, key).await?
    {
        return Ok(Some(setting));
    }

    // Check system level
    get(&SettingScope::System, None, None, key).await
}

/// List all settings for a given scope
pub async fn list(
    scope: Option<&SettingScope>,
    org_id: Option<&str>,
    user_id: Option<&str>,
    category: Option<&str>,
) -> Result<Vec<SystemSetting>, anyhow::Error> {
    let client = get_orm_client_ro().await;

    let mut query = Entity::find().order_by_asc(Column::SettingKey);

    if let Some(scope) = scope {
        query = query.filter(Column::Scope.eq(scope.as_str()));
    }

    if let Some(org) = org_id {
        query = query.filter(Column::OrgId.eq(org));
    }

    if let Some(user) = user_id {
        query = query.filter(Column::UserId.eq(user));
    }

    if let Some(cat) = category {
        query = query.filter(Column::SettingCategory.eq(cat));
    }

    let results = query
        .all(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;

    Ok(results.into_iter().map(model_to_setting).collect())
}

/// `(scope, org_id, user_id, setting_key)` of every setting row of the org, at any scope.
pub async fn list_keys_by_org(org_id: &str) -> Result<Vec<SettingRowKey>, anyhow::Error> {
    use sea_orm::QuerySelect;
    let client = get_orm_client_ro().await;
    Entity::find()
        .select_only()
        .columns(SETTING_KEY_COLUMNS)
        .filter(Column::OrgId.eq(org_id))
        .into_tuple()
        .all(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))
}

/// List all resolved settings for org/user (merging all levels)
pub async fn list_resolved(
    org_id: Option<&str>,
    user_id: Option<&str>,
    category: Option<&str>,
) -> Result<std::collections::HashMap<String, SystemSetting>, anyhow::Error> {
    let mut resolved = std::collections::HashMap::new();

    // Get system-level settings first (lowest priority)
    let system_settings = list(Some(&SettingScope::System), None, None, category).await?;
    for setting in system_settings {
        resolved.insert(setting.setting_key.clone(), setting);
    }

    // Override with org-level settings if org_id provided
    if let Some(org) = org_id {
        let org_settings = list(Some(&SettingScope::Org), Some(org), None, category).await?;
        for setting in org_settings {
            resolved.insert(setting.setting_key.clone(), setting);
        }
    }

    // Override with user-level settings if both org_id and user_id provided
    if let (Some(org), Some(user)) = (org_id, user_id) {
        let user_settings =
            list(Some(&SettingScope::User), Some(org), Some(user), category).await?;
        for setting in user_settings {
            resolved.insert(setting.setting_key.clone(), setting);
        }
    }

    Ok(resolved)
}

/// Create or update a setting (upsert)
pub async fn set(setting: &SystemSetting) -> Result<SystemSetting, anyhow::Error> {
    setting.validate().map_err(|e| anyhow!(e))?;

    let client = get_orm_client_rw().await;
    let now = chrono::Utc::now().timestamp_micros();

    // Check if setting already exists
    let existing = get(
        &setting.scope,
        setting.org_id.as_deref(),
        setting.user_id.as_deref(),
        &setting.setting_key,
    )
    .await?;

    if let Some(existing) = existing {
        // Update existing
        let active_model = ActiveModel {
            id: Set(existing.id.unwrap()),
            scope: Set(setting.scope.as_str().to_string()),
            org_id: Set(setting.org_id.clone()),
            user_id: Set(setting.user_id.clone()),
            setting_key: Set(setting.setting_key.clone()),
            setting_category: Set(setting.setting_category.clone()),
            setting_value: Set(setting.setting_value.clone()),
            description: Set(setting.description.clone()),
            created_at: Set(existing.created_at),
            updated_at: Set(now),
            created_by: Set(existing.created_by.clone()),
            updated_by: Set(setting.updated_by.clone()),
        };

        let result = active_model
            .update(client)
            .await
            .map_err(|e| anyhow!("DbError# {e}"))?;

        Ok(model_to_setting(result))
    } else {
        // Insert new
        let active_model = ActiveModel {
            id: NotSet, // Auto-increment - let database assign
            scope: Set(setting.scope.as_str().to_string()),
            org_id: Set(setting.org_id.clone()),
            user_id: Set(setting.user_id.clone()),
            setting_key: Set(setting.setting_key.clone()),
            setting_category: Set(setting.setting_category.clone()),
            setting_value: Set(setting.setting_value.clone()),
            description: Set(setting.description.clone()),
            created_at: Set(now),
            updated_at: Set(now),
            created_by: Set(setting.created_by.clone()),
            updated_by: Set(setting.updated_by.clone()),
        };

        let result = active_model
            .insert(client)
            .await
            .map_err(|e| anyhow!("DbError# {e}"))?;

        Ok(model_to_setting(result))
    }
}

/// Delete a setting
pub async fn delete(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> Result<bool, anyhow::Error> {
    let client = get_orm_client_rw().await;

    let mut query = Entity::delete_many()
        .filter(Column::Scope.eq(scope.as_str()))
        .filter(Column::SettingKey.eq(key));

    match scope {
        SettingScope::System => {
            query = query
                .filter(Column::OrgId.is_null())
                .filter(Column::UserId.is_null());
        }
        SettingScope::Org => {
            if let Some(org) = org_id {
                query = query.filter(Column::OrgId.eq(org));
            } else {
                return Err(anyhow!("org_id required for org scope"));
            }
            query = query.filter(Column::UserId.is_null());
        }
        SettingScope::User => {
            if let Some(org) = org_id {
                query = query.filter(Column::OrgId.eq(org));
            } else {
                return Err(anyhow!("org_id required for user scope"));
            }
            if let Some(user) = user_id {
                query = query.filter(Column::UserId.eq(user));
            } else {
                return Err(anyhow!("user_id required for user scope"));
            }
        }
    }

    let result = query
        .exec(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;

    Ok(result.rows_affected > 0)
}

/// Delete the row only if its `updated_at` and value are unchanged; else `Ok(false)`.
pub async fn delete_if_unchanged(
    id: i64,
    updated_at: i64,
    value: &serde_json::Value,
) -> Result<bool, anyhow::Error> {
    delete_if_unchanged_with(get_orm_client_rw().await, id, updated_at, value).await
}

/// Delete all settings for an organization and return the key of each deleted row.
pub async fn delete_org_settings(org_id: &str) -> Result<Vec<SettingRowKey>, anyhow::Error> {
    let client = get_orm_client_rw().await;
    let delete = Entity::delete_many().filter(Column::OrgId.eq(org_id));
    super::delete_returning(client, delete, &SETTING_KEY_COLUMNS)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))
}

/// Delete all settings for a user in an organization
pub async fn delete_user_settings(org_id: &str, user_id: &str) -> Result<u64, anyhow::Error> {
    let client = get_orm_client_rw().await;

    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserId.eq(user_id))
        .exec(client)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;

    Ok(result.rows_affected)
}

async fn delete_if_unchanged_with<C: ConnectionTrait>(
    conn: &C,
    id: i64,
    updated_at: i64,
    value: &serde_json::Value,
) -> Result<bool, anyhow::Error> {
    // Only Postgres stores jsonb; other backends store the serialized text the binder wrote.
    let same_value = match conn.get_database_backend() {
        DbBackend::Postgres => Column::SettingValue.eq(value.clone()),
        _ => Column::SettingValue.eq(serde_json::to_string(value)?),
    };
    let result = Entity::delete_many()
        .filter(Column::Id.eq(id))
        .filter(Column::UpdatedAt.eq(updated_at))
        .filter(same_value)
        .exec(conn)
        .await
        .map_err(|e| anyhow!("DbError# {e}"))?;
    Ok(result.rows_affected > 0)
}

/// Convert DB model to domain type
fn model_to_setting(model: Model) -> SystemSetting {
    SystemSetting {
        id: Some(model.id),
        scope: model.scope.parse().unwrap_or(SettingScope::System),
        org_id: model.org_id,
        user_id: model.user_id,
        setting_key: model.setting_key,
        setting_category: model.setting_category,
        setting_value: model.setting_value,
        description: model.description,
        created_at: model.created_at,
        updated_at: model.updated_at,
        created_by: model.created_by,
        updated_by: model.updated_by,
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::*;

    async fn db_with_row(updated_at: i64) -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity).take();
        db.execute(backend.build(&stmt)).await.unwrap();
        ActiveModel {
            id: Set(1),
            scope: Set("org".to_string()),
            org_id: Set(Some("default".to_string())),
            user_id: Set(None),
            setting_key: Set("default_alert_destination".to_string()),
            setting_category: Set(Some("alerts".to_string())),
            setting_value: Set(serde_json::json!({"destination": "ops-slack"})),
            description: Set(None),
            created_at: Set(1),
            updated_at: Set(updated_at),
            created_by: Set(None),
            updated_by: Set(None),
        }
        .insert(&db)
        .await
        .unwrap();
        db
    }

    fn read_value() -> serde_json::Value {
        serde_json::json!({"destination": "ops-slack"})
    }

    #[tokio::test]
    async fn delete_if_unchanged_removes_a_row_read_at_its_current_version() {
        let db = db_with_row(100).await;
        assert!(
            delete_if_unchanged_with(&db, 1, 100, &read_value())
                .await
                .unwrap()
        );
        assert!(Entity::find_by_id(1).one(&db).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_if_unchanged_keeps_a_row_updated_since_it_was_read() {
        let db = db_with_row(200).await;
        assert!(
            !delete_if_unchanged_with(&db, 1, 100, &read_value())
                .await
                .unwrap()
        );
        assert!(Entity::find_by_id(1).one(&db).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn delete_if_unchanged_keeps_a_row_rewritten_in_the_same_microsecond() {
        let db = db_with_row(100).await;
        let stale = serde_json::json!({"destination": "ops-email"});
        assert!(!delete_if_unchanged_with(&db, 1, 100, &stale).await.unwrap());
        assert!(Entity::find_by_id(1).one(&db).await.unwrap().is_some());
    }

    #[test]
    fn test_model_to_setting() {
        let model = Model {
            id: 1,
            scope: "org".to_string(),
            org_id: Some("default".to_string()),
            user_id: None,
            setting_key: "test_key".to_string(),
            setting_category: Some("correlation".to_string()),
            setting_value: serde_json::json!(["a", "b", "c"]),
            description: Some("Test setting".to_string()),
            created_at: 1000000,
            updated_at: 2000000,
            created_by: Some("admin".to_string()),
            updated_by: Some("admin".to_string()),
        };

        let setting = model_to_setting(model);

        assert_eq!(setting.id, Some(1));
        assert_eq!(setting.scope, SettingScope::Org);
        assert_eq!(setting.org_id, Some("default".to_string()));
        assert_eq!(setting.user_id, None);
        assert_eq!(setting.setting_key, "test_key");
        assert_eq!(setting.setting_value, serde_json::json!(["a", "b", "c"]));
    }

    #[tokio::test]
    async fn test_org_settings_delete_returns_the_key_of_each_row_it_removed() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        let org = crate::table::testing::unique("t_settings");
        let other = format!("{org}_other");
        for (org, key) in [(&org, "a"), (&org, "b"), (&other, "a")] {
            set(&SystemSetting::new_org(
                org.as_str(),
                key,
                serde_json::json!(1),
            ))
            .await
            .unwrap();
        }

        let mut removed = delete_org_settings(&org).await.unwrap();
        removed.sort_by(|x, y| x.3.cmp(&y.3));
        let left = list_keys_by_org(&org).await.unwrap();
        let kept = delete_org_settings(&other).await.unwrap();

        let org_row = |key: &str| ("org".to_string(), Some(org.clone()), None, key.to_string());
        assert_eq!(removed, [org_row("a"), org_row("b")]);
        assert!(left.is_empty());
        assert_eq!(kept.len(), 1, "another org's setting went with this org's");
    }
}
