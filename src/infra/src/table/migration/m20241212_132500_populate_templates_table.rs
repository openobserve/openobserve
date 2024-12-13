// Copyright 2024 OpenObserve Inc.
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

use ahash::HashMap;
use config::utils::json;
use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;

        // Migrate one org at a time to avoid loading too many records into memory.
        let meta_orgs = meta_org::Entity::find()
            .column(meta_org::Column::OrgId)
            .group_by(meta_org::Column::OrgId)
            .order_by_asc(meta_org::Column::OrgId)
            .all(&txn)
            .await?;

        for org in &meta_orgs {
            let meta_destination_results: Result<
                HashMap<String, meta_destinations::Destination>,
                DbErr,
            > = meta::Entity::find()
                .filter(meta::Column::Key1.eq(&org.org_id))
                .filter(meta::Column::Module.eq("destinations"))
                .order_by_asc(meta::Column::Id)
                .all(&txn)
                .await?
                .into_iter()
                .map(|meta| {
                    let dest: meta_destinations::Destination =
                        json::from_str(&meta.value).map_err(|e| DbErr::Migration(e.to_string()))?;
                    Ok((dest.template.clone(), dest))
                })
                .collect();
            let meta_destinations = meta_destination_results?;

            let meta_template_results: Result<Vec<meta_destinations::Template>, DbErr> =
                meta::Entity::find()
                    .filter(meta::Column::Key1.eq(&org.org_id))
                    .filter(meta::Column::Module.eq("templates"))
                    .order_by_asc(meta::Column::Id)
                    .all(&txn)
                    .await?
                    .into_iter()
                    .map(|meta| {
                        let template: meta_destinations::Template = json::from_str(&meta.value)
                            .map_err(|e| DbErr::Migration(e.to_string()))?;
                        Ok(template)
                    })
                    .collect();
            let meta_templates = meta_template_results?;

            let mut new_templates = vec![];
            for meta_template in meta_templates {
                let meta_dest =
                    meta_destinations
                        .get(&meta_template.name)
                        .ok_or(DbErr::Migration(
                            "Destination without template found".to_string(),
                        ))?;
                let dest_type = match meta_dest.destination_type {
                    meta_destinations::DestinationType::Http => {
                        template::DestinationType::Http(template::Endpoint {
                            url: meta_dest.url.clone(),
                            method: meta_dest.method.clone(),
                            skip_tls_verify: meta_dest.skip_tls_verify,
                            headers: meta_dest.headers.clone(),
                        })
                    }
                    meta_destinations::DestinationType::Email => {
                        template::DestinationType::Email(template::Email {
                            recipients: meta_dest.emails.clone(),
                            title: meta_template.title.clone(),
                        })
                    }
                    meta_destinations::DestinationType::Sns => {
                        template::DestinationType::Sns(template::AwsSns {
                            sns_topic_arn: meta_dest.sns_topic_arn.clone().ok_or(
                                DbErr::Migration(
                                    "SNS destination without sns_topic_arn found".to_string(),
                                ),
                            )?,
                            aws_region: meta_dest.aws_region.clone().ok_or(DbErr::Migration(
                                "SNS destination without aws_region found".to_string(),
                            ))?,
                        })
                    }
                };
                new_templates.push(template::ActiveModel {
                    id: Set(org.id.to_string()),
                    org: Set(org.org_id.to_string()),
                    name: Set(meta_template.name),
                    is_default: Set(meta_template.is_default.unwrap_or_default()),
                    body: Set(meta_template.body),
                    r#type: Set(json::to_value(dest_type).map_err(|e| {
                        DbErr::Migration(format!(
                            "Destination type failed to serialize to json value: {e}"
                        ))
                    })?),
                });
            }

            template::Entity::insert_many(new_templates)
                .exec(&txn)
                .await?;
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
        pub method: super::HTTPType,
        #[serde(default)]
        pub skip_tls_verify: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub headers: Option<HashMap<String, String>>,
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

    #[derive(Clone, Debug, Serialize, Deserialize, Default)]
    pub enum DestinationType {
        #[default]
        #[serde(rename = "http")]
        Http,
        #[serde(rename = "email")]
        Email,
        #[serde(rename = "sns")]
        Sns,
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

/// Representation of the meta table at the time this migration executes.
mod meta_org {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "meta")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub org_id: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the templates table at the time this migration executes.
mod template {

    use std::collections::HashMap;

    use sea_orm::entity::prelude::*;
    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "templates")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub name: String,
        pub is_default: bool,
        #[sea_orm(column_type = "Text")]
        pub body: String,
        pub r#type: Json,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}

    #[derive(Serialize, Debug, Deserialize, Clone)]
    #[serde(rename_all = "snake_case")]
    pub enum DestinationType {
        Http(Endpoint),
        Email(Email),
        Sns(AwsSns),
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub struct Email {
        pub recipients: Vec<String>,
        pub title: String,
    }

    #[derive(Serialize, Debug, PartialEq, Eq, Deserialize, Clone)]
    pub struct Endpoint {
        pub url: String,
        #[serde(default)]
        pub method: super::HTTPType,
        #[serde(default)]
        pub skip_tls_verify: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub headers: Option<HashMap<String, String>>,
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub struct AwsSns {
        pub sns_topic_arn: String,
        pub aws_region: String,
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum HTTPType {
    #[default]
    Post,
    Put,
    Get,
}
