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

use std::collections::{HashMap, HashSet};

use config::utils::json;
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

        // Get all templates first
        let templates: HashMap<(String, String), String> = templates::Entity::find()
            .all(&txn)
            .await?
            .into_iter()
            .map(|model| ((model.org, model.name), model.id))
            .collect();
        // a re-run finds destinations that are already in the table
        let copied: HashSet<(String, String)> = destinations::Entity::find()
            .select_only()
            .column(destinations::Column::Org)
            .column(destinations::Column::Name)
            .into_tuple()
            .all(&txn)
            .await?
            .into_iter()
            .collect();

        // Migrate pages of 100 records at a time to avoid loading too many
        // records into memory.
        let mut meta_pages = meta::Entity::find()
            .filter(meta::Column::Module.eq("destinations"))
            .order_by_asc(meta::Column::Id)
            .paginate(&txn, 100);

        while let Some(metas) = meta_pages.fetch_and_next().await? {
            let new_temp_results: Result<Vec<_>, DbErr> = metas
                .into_iter()
                // destination change events are written to meta with an empty value
                .filter(|meta| !meta.value.is_empty())
                .map(|meta| {
                    let old_dest: meta_destinations::Destination =
                        json::from_str(&meta.value).map_err(|e| DbErr::Migration(e.to_string()))?;
                    let id = ksuid_from_hash(&old_dest, &meta.key1).to_string();

                    let (module, new_type) = match old_dest.destination_type {
                        meta_destinations::DestinationType::Http => (
                            "alert".to_string(),
                            destinations::DestinationType::Http(destinations::Endpoint {
                                url: old_dest.url,
                                method: old_dest.method.into(),
                                skip_tls_verify: old_dest.skip_tls_verify,
                                headers: old_dest.headers,
                            }),
                        ),
                        meta_destinations::DestinationType::Email => (
                            "alert".to_string(),
                            destinations::DestinationType::Email(destinations::Email {
                                recipients: old_dest.emails,
                            }),
                        ),
                        meta_destinations::DestinationType::Sns => (
                            "alert".to_string(),
                            destinations::DestinationType::Sns(destinations::AwsSns {
                                sns_topic_arn: old_dest.sns_topic_arn.ok_or(DbErr::Migration(
                                    "SNS destination missing sns_topic_arn".to_string(),
                                ))?,
                                aws_region: old_dest.aws_region.ok_or(DbErr::Migration(
                                    "SNS destination missing aws region info".to_string(),
                                ))?,
                            }),
                        ),
                        meta_destinations::DestinationType::RemotePipeline => (
                            "pipeline".to_string(),
                            destinations::DestinationType::Http(destinations::Endpoint {
                                url: old_dest.url,
                                method: old_dest.method.into(),
                                skip_tls_verify: old_dest.skip_tls_verify,
                                headers: old_dest.headers,
                            }),
                        ),
                    };
                    let new_type =
                        json::to_value(new_type).map_err(|e| DbErr::Migration(e.to_string()))?;

                    let key = (meta.key1.clone(), old_dest.template.clone());
                    let template_id = templates
                        .get(&key)
                        .or_else(|| templates.get(&("default".to_string(), old_dest.template))) // template could be default org
                        .cloned();

                    if (template_id.is_none() && module == "alert")
                        || copied.contains(&(meta.key1.clone(), old_dest.name.clone()))
                    {
                        Ok(None)
                    } else {
                        Ok(Some(destinations::ActiveModel {
                            id: Set(id),
                            org: Set(meta.key1),
                            name: Set(old_dest.name),
                            module: Set(module),
                            template_id: Set(template_id),
                            r#type: Set(new_type),
                        }))
                    }
                })
                .filter_map(|result| match result {
                    Ok(None) => None, // no template for an alert destination, or already copied
                    Ok(Some(temp)) => Some(Ok(temp)),
                    Err(e) => Some(Err(e)),
                })
                .collect();
            let new_temps = new_temp_results?;
            if new_temps.is_empty() {
                continue;
            }
            destinations::Entity::insert_many(new_temps)
                .exec(&txn)
                .await?;
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        destinations::Entity::delete_many().exec(db).await?;
        Ok(())
    }
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

mod meta_destinations {

    use std::collections::HashMap;

    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub struct Destination {
        #[serde(default)]
        pub name: String,
        #[serde(default)]
        pub url: String,
        #[serde(default)]
        pub method: HTTPType,
        #[serde(default)]
        pub skip_tls_verify: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub headers: Option<HashMap<String, String>>,
        #[serde(default)]
        pub template: String,
        #[serde(default)]
        pub emails: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub sns_topic_arn: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub aws_region: Option<String>,
        #[serde(rename = "type")]
        #[serde(default)]
        pub destination_type: DestinationType,
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

    #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum HTTPType {
        #[default]
        Post,
        Put,
        Get,
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

/// Representation of the destinations table at the time this migration executes.
mod destinations {

    use std::collections::HashMap;

    use sea_orm::entity::prelude::*;
    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "destinations")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub name: String,
        pub module: String,
        pub template_id: Option<String>,
        pub r#type: Json,
    }

    // There are relations but they are not important to this migration.
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}

    #[derive(Serialize, Debug, Deserialize, Clone)]
    #[serde(tag = "type")]
    #[serde(rename_all = "snake_case")]
    pub enum DestinationType {
        Http(Endpoint),
        Email(Email),
        Sns(AwsSns),
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub struct Email {
        pub recipients: Vec<String>,
    }

    #[derive(Serialize, Debug, PartialEq, Eq, Deserialize, Clone)]
    pub struct Endpoint {
        pub url: String,
        #[serde(default)]
        pub method: HTTPType,
        #[serde(default)]
        pub skip_tls_verify: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub headers: Option<HashMap<String, String>>,
    }

    #[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum HTTPType {
        #[default]
        Post,
        Put,
        Get,
    }

    impl std::fmt::Display for HTTPType {
        fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            match self {
                HTTPType::Post => write!(f, "post"),
                HTTPType::Put => write!(f, "put"),
                HTTPType::Get => write!(f, "get"),
            }
        }
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub struct AwsSns {
        pub sns_topic_arn: String,
        pub aws_region: String,
    }
}

mod templates {
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

    // There are relations but they are not important to this migration.
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

impl From<meta_destinations::HTTPType> for destinations::HTTPType {
    fn from(value: meta_destinations::HTTPType) -> Self {
        match value {
            meta_destinations::HTTPType::Get => Self::Get,
            meta_destinations::HTTPType::Put => Self::Put,
            meta_destinations::HTTPType::Post => Self::Post,
        }
    }
}

fn ksuid_from_hash(
    destination: &meta_destinations::Destination,
    org_id: &str,
) -> svix_ksuid::Ksuid {
    use sha1::{Digest, Sha1};

    let mut hasher = Sha1::new();
    hasher.update(org_id);
    hasher.update(destination.name.clone());
    let hash = hasher.finalize();
    svix_ksuid::Ksuid::from_bytes(hash.into())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::{
        m20250125_102300_create_destinations_table as create_destinations,
        m20250125_115400_create_templates_table as create_templates,
    };

    fn make_dest(name: &str) -> meta_destinations::Destination {
        meta_destinations::Destination {
            name: name.to_string(),
            url: String::new(),
            method: meta_destinations::HTTPType::default(),
            skip_tls_verify: false,
            headers: None,
            template: String::new(),
            emails: vec![],
            sns_topic_arn: None,
            aws_region: None,
            destination_type: meta_destinations::DestinationType::default(),
        }
    }

    #[test]
    fn test_ksuid_from_hash_is_deterministic() {
        let d = make_dest("webhook-1");
        let k1 = ksuid_from_hash(&d, "org1");
        let k2 = ksuid_from_hash(&d, "org1");
        assert_eq!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_ksuid_from_hash_different_orgs_differ() {
        let d = make_dest("webhook-1");
        let k1 = ksuid_from_hash(&d, "org-a");
        let k2 = ksuid_from_hash(&d, "org-b");
        assert_ne!(k1.to_string(), k2.to_string());
    }

    #[test]
    fn test_ksuid_from_hash_different_names_differ() {
        let d1 = make_dest("dest-alpha");
        let d2 = make_dest("dest-beta");
        let k1 = ksuid_from_hash(&d1, "org1");
        let k2 = ksuid_from_hash(&d2, "org1");
        assert_ne!(k1.to_string(), k2.to_string());
    }

    async fn db_with(statements: &[&str]) -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        create_templates::Migration.up(&manager).await.unwrap();
        create_destinations::Migration.up(&manager).await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE meta (id INTEGER PRIMARY KEY AUTOINCREMENT, module TEXT NOT NULL, \
             key1 TEXT NOT NULL, key2 TEXT NOT NULL, start_dt BIGINT NOT NULL, \
             value TEXT NOT NULL)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO templates VALUES ('tid', 'default', 't1', 0, 'http', 'b', NULL)",
        )
        .await
        .unwrap();
        for sql in statements {
            db.execute_unprepared(sql).await.unwrap();
        }
        db
    }

    #[tokio::test]
    async fn test_up_skips_change_events_and_copied_destinations() {
        let db = db_with(&[
            r#"INSERT INTO meta (module, key1, key2, start_dt, value) VALUES
               ('destinations', 'default', 'webhook', 0, ''),
               ('destinations', 'default', 'copied', 0,
                '{"name":"copied","url":"http://a","template":"t1","type":"http"}'),
               ('destinations', 'default', 'new', 0,
                '{"name":"new","url":"http://b","template":"t1","type":"http"}')"#,
            r#"INSERT INTO destinations VALUES ('earlier', 'default', 'copied', 'alert', 'tid',
               '{"type":"http","url":"http://a"}')"#,
        ])
        .await;

        Migration
            .up(&SchemaManager::new(&db))
            .await
            .expect("empty change events and copied destinations must be skipped");
        let rows: Vec<(String, String)> = destinations::Entity::find()
            .select_only()
            .column(destinations::Column::Name)
            .column(destinations::Column::Id)
            .order_by_asc(destinations::Column::Name)
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
                              VALUES ('destinations', 'default', 'webhook', 0, '')"#])
        .await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration
            .up(&manager)
            .await
            .expect("a page with nothing to copy must not fail");
        assert_eq!(destinations::Entity::find().count(&db).await.unwrap(), 0);
    }
}
