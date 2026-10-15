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

use config::utils::json;
use hashbrown::HashSet;
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};
use sea_orm_migration::prelude::*;
use svix_ksuid::KsuidLike;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;
        // a re-run finds templates that are already in the table
        let copied: HashSet<(String, String)> = template::Entity::find()
            .select_only()
            .column(template::Column::Org)
            .column(template::Column::Name)
            .into_tuple()
            .all(&txn)
            .await?
            .into_iter()
            .collect();

        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        let mut meta_pages = meta::Entity::find()
            .filter(meta::Column::Module.eq("templates"))
            .order_by_asc(meta::Column::Id)
            .paginate(&txn, 100);

        while let Some(metas) = meta_pages.fetch_and_next().await? {
            let new_temp_results: Result<Vec<_>, DbErr> = metas
                .into_iter()
                // template change events are written to meta with an empty value
                .filter(|meta| !meta.value.is_empty())
                .map(|meta| {
                    let old_temp: meta_templates::Template =
                        json::from_str(&meta.value).map_err(|e| DbErr::Migration(e.to_string()))?;
                    let id = ksuid_from_hash(&old_temp, &meta.key1).to_string();
                    let title =
                        if let meta_templates::DestinationType::Email = old_temp.template_type {
                            Some(old_temp.title)
                        } else {
                            None
                        };
                    if matches!(
                        old_temp.template_type,
                        meta_templates::DestinationType::RemotePipeline
                    ) || copied.contains(&(meta.key1.clone(), old_temp.name.clone()))
                    {
                        Ok(None)
                    } else {
                        Ok(Some(template::ActiveModel {
                            id: Set(id),
                            org: Set(meta.key1),
                            name: Set(old_temp.name),
                            is_default: Set(old_temp.is_default.unwrap_or_default()),
                            r#type: Set(old_temp.template_type.to_string()),
                            body: Set(old_temp.body),
                            title: Set(title),
                        }))
                    }
                })
                .filter_map(|result| match result {
                    Ok(None) => None, // RemotePipeline and already copied templates are dropped
                    Ok(Some(temp)) => Some(Ok(temp)),
                    Err(e) => Some(Err(e)),
                })
                .collect();
            let new_temps = new_temp_results?;
            if new_temps.is_empty() {
                continue;
            }
            template::Entity::insert_many(new_temps).exec(&txn).await?;
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        template::Entity::delete_many().exec(db).await?;
        Ok(())
    }
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

mod meta_templates {

    use serde::{Deserialize, Serialize};

    /// A result from querying for templates from the meta table.
    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub struct Template {
        #[serde(default)]
        pub name: String,
        #[serde(default)]
        pub body: String,
        #[serde(rename = "isDefault")]
        #[serde(default)]
        pub is_default: Option<bool>,
        #[serde(rename = "type")]
        #[serde(default)]
        pub template_type: DestinationType,
        #[serde(default)]
        pub title: String,
    }

    #[derive(Serialize, Debug, Default, PartialEq, Eq, Deserialize, Clone)]
    #[serde(rename_all = "snake_case")]
    pub enum DestinationType {
        #[default]
        Http,
        Email,
        Sns,
        RemotePipeline,
    }

    impl std::fmt::Display for DestinationType {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            let s = match self {
                DestinationType::Http => "http",
                DestinationType::Email => "email",
                DestinationType::Sns => "sns",
                DestinationType::RemotePipeline => "remote_pipeline",
            };
            write!(f, "{s}")
        }
    }
}

/// Representation of the meta table at the time this migration executes.
mod meta {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "meta")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub module: String,
        pub key1: String,
        pub key2: String,
        pub start_dt: i64,
        #[sea_orm(column_type = "Text")]
        pub value: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the templates table at the time this migration executes.
mod template {

    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "templates")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub name: String,
        pub is_default: bool,
        pub r#type: String,
        #[sea_orm(column_type = "Text")]
        pub body: String,
        #[sea_orm(column_type = "Text", nullable)]
        pub title: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

fn ksuid_from_hash(template: &meta_templates::Template, org_id: &str) -> svix_ksuid::Ksuid {
    use sha1::{Digest, Sha1};

    let mut hasher = Sha1::new();
    hasher.update(org_id);
    hasher.update(template.name.clone());
    let hash = hasher.finalize();
    svix_ksuid::Ksuid::from_bytes(hash.into())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::m20250125_115400_create_templates_table as create_templates;

    fn make_template(name: &str) -> meta_templates::Template {
        meta_templates::Template {
            name: name.to_string(),
            body: String::new(),
            is_default: None,
            template_type: meta_templates::DestinationType::Http,
            title: String::new(),
        }
    }

    #[test]
    fn test_ksuid_from_hash_is_deterministic() {
        let t = make_template("my-template");
        let k1 = ksuid_from_hash(&t, "org1");
        let k2 = ksuid_from_hash(&t, "org1");
        assert_eq!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_ksuid_from_hash_different_orgs_differ() {
        let t = make_template("my-template");
        let k1 = ksuid_from_hash(&t, "org-a");
        let k2 = ksuid_from_hash(&t, "org-b");
        assert_ne!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_ksuid_from_hash_different_names_differ() {
        let t1 = make_template("template-alpha");
        let t2 = make_template("template-beta");
        let k1 = ksuid_from_hash(&t1, "org1");
        let k2 = ksuid_from_hash(&t2, "org1");
        assert_ne!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_destination_type_default_is_http() {
        let dt = meta_templates::DestinationType::default();
        assert_eq!(dt, meta_templates::DestinationType::Http);
    }

    async fn db_with(statements: &[&str]) -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_templates::Migration
            .up(&SchemaManager::new(&db))
            .await
            .unwrap();
        db.execute_unprepared(
            "CREATE TABLE meta (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, \
             key1 TEXT NOT NULL, key2 TEXT NOT NULL, start_dt BIGINT NOT NULL, \
             value TEXT NOT NULL)",
        )
        .await
        .unwrap();
        for sql in statements {
            db.execute_unprepared(sql).await.unwrap();
        }
        db
    }

    #[tokio::test]
    async fn test_up_skips_change_events_and_copied_templates() {
        let db = db_with(&[
            r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES
               ('templates', 'default', 'prebuilt_slack', 0, ''),
               ('templates', 'default', 'copied', 0, '{"name":"copied","body":"b"}'),
               ('templates', 'default', 'new', 0, '{"name":"new","body":"b"}')"#,
            "INSERT INTO templates VALUES ('earlier', 'default', 'copied', 0, 'http', 'b', NULL)",
        ])
        .await;

        Migration
            .up(&SchemaManager::new(&db))
            .await
            .expect("empty change events and copied templates must be skipped");
        let rows: Vec<(String, String)> = template::Entity::find()
            .select_only()
            .column(template::Column::Name)
            .column(template::Column::Id)
            .order_by_asc(template::Column::Name)
            .into_tuple()
            .all(&db)
            .await
            .unwrap();
        let names: Vec<&str> = rows.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["copied", "new"]);
        assert_eq!(rows[0].1, "earlier");
    }

    #[tokio::test]
    async fn test_up_reruns_with_only_change_events() {
        let db = db_with(&[r#"INSERT INTO meta (module, key1, key2, start_dt, value)
                              VALUES ('templates', 'default', 'prebuilt_slack', 0, '')"#])
        .await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("a page with nothing to copy must not fail");
        assert_eq!(template::Entity::find().count(&db).await.unwrap(), 0);
    }
}
