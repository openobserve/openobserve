use sea_orm::{
    ActiveValue::NotSet, ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, Set, Statement, TransactionTrait,
};

use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    dist_lock,
};

const LAST_EXPECTED_MIGRATION: &str = "m20250109_092400_recreate_tables_with_ksuids";

pub async fn run() -> Result<(), anyhow::Error> {
    let locker = dist_lock::lock("/database/migration", 0).await?;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client.begin().await?;

    let mut migrations = entity::seaql_migrations::Entity::find()
        .order_by_asc(entity::seaql_migrations::Column::Version)
        .all(&txn)
        .await?;
    let Some(last) = migrations.pop() else {
        let msg = "there are no SeaORM migrations to roll back";
        return Err(anyhow::Error::msg(msg));
    };
    if last.version.as_str() != LAST_EXPECTED_MIGRATION {
        let msg = format!("can only downgrade from v14.2 to v12.2 if the last executed migration was {}, found {}", LAST_EXPECTED_MIGRATION, last.version);
        return Err(anyhow::Error::msg(msg));
    }

    // Copy folders to meta table.
    println!("Copying records for dashboard folders from folders table to meta table");
    let folders = crate::table::entity::folders::Entity::find()
        .filter(crate::table::entity::folders::Column::Type.eq(0))
        .all(&txn)
        .await?;
    let meta_active_models: Vec<_> = folders
        .into_iter()
        .map(|folder_model| {
            let key_1 = folder_model.org.clone();
            let key_2 = folder_model.folder_id.clone();
            let meta: meta::folders::Folder = folder_model.into();
            let json = serde_json::to_string(&meta).unwrap();
            entity::meta::ActiveModel {
                id: NotSet,
                module: Set("folders".to_owned()),
                key1: Set(key_1),
                key2: Set(key_2),
                start_dt: Set(0),
                value: Set(json),
            }
        })
        .collect();
    entity::meta::Entity::insert_many(meta_active_models)
        .exec(&txn)
        .await?;

    // Old alerts were never deleted from the meta table. Delete them now so that we can simply copy
    // all alerts from the new alerts table into the meta table without worrying about handling
    // potential unique key violoations or alerts that were deleted in the new alerts table but not
    // in the old meta table.
    println!("Deleting old alerts records from meta table");
    entity::meta::Entity::delete_many()
        .filter(entity::meta::Column::Module.eq("alerts"))
        .exec(&txn)
        .await?;

    // Copy alerts to meta table.
    println!("Copying records from alerts table to meta table");
    let mut alerts_pages = crate::table::entity::alerts::Entity::find()
        .order_by_asc(crate::table::entity::alerts::Column::Id)
        .paginate(&txn, 100);
    while let Some(alerts) = alerts_pages.fetch_and_next().await? {
        let meta_active_models: Vec<_> = alerts
            .into_iter()
            .map(|alert_model| {
                let key_1 = alert_model.org.clone();
                let key_2 = format!(
                    "{}/{}/{}",
                    alert_model.stream_type, alert_model.stream_name, alert_model.name
                );
                let meta: config::meta::alerts::alert::Alert = alert_model.try_into().unwrap();
                let json = serde_json::to_string(&meta).unwrap();
                entity::meta::ActiveModel {
                    id: NotSet,
                    module: Set("alerts".to_owned()),
                    key1: Set(key_1),
                    key2: Set(key_2),
                    start_dt: Set(0),
                    value: Set(json),
                }
            })
            .collect();
        entity::meta::Entity::insert_many(meta_active_models)
            .exec(&txn)
            .await?;
    }

    // Copy dashboards to meta table.
    println!("Copying records from dashboards table to meta table");
    let mut dashboards_pages = crate::table::entity::dashboards::Entity::find()
        .find_also_related(crate::table::entity::folders::Entity)
        .order_by_asc(crate::table::entity::dashboards::Column::Id)
        .paginate(&txn, 100);
    while let Some(dashboards) = dashboards_pages.fetch_and_next().await? {
        let meta_active_models: Vec<_> = dashboards
            .into_iter()
            .map(|(dashboard_model, maybe_folder_model)| {
                let folder_model = maybe_folder_model.unwrap();
                let key_1 = folder_model.org.clone();
                let key_2 = format!(
                    "{}/{}",
                    folder_model.folder_id, dashboard_model.dashboard_id
                );
                let meta: meta::dashboards::Dashboard = dashboard_model.into();
                let json = serde_json::to_string(&meta).unwrap();
                entity::meta::ActiveModel {
                    id: NotSet,
                    module: Set("dashboard".to_owned()),
                    key1: Set(key_1),
                    key2: Set(key_2),
                    start_dt: Set(0),
                    value: Set(json),
                }
            })
            .collect();
        entity::meta::Entity::insert_many(meta_active_models)
            .exec(&txn)
            .await?;
    }

    txn.commit().await?;

    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE search_job_results;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE search_job_partitions;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE search_jobs;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE search_queue;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE alerts;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE dashboards;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE folders;",
        ))
        .await?;
    client
        .query_one(Statement::from_string(
            client.get_database_backend(),
            "DROP TABLE seaql_migrations;",
        ))
        .await?;

    dist_lock::unlock(&locker).await?;
    Ok(())
}

/// SeaORM entities that model the schemas of the folders, alerts, and dashboards tables.
mod entity {
    pub mod meta {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
        #[sea_orm(table_name = "meta")]
        pub struct Model {
            #[sea_orm(primary_key, auto_increment = true)]
            pub id: i64,
            pub module: String,
            pub key1: String,
            pub key2: String,
            pub start_dt: i64,
            pub value: String,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }

    pub mod seaql_migrations {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
        #[sea_orm(table_name = "seaql_migrations")]
        pub struct Model {
            #[sea_orm(primary_key, auto_increment = false)]
            pub version: String,
            pub applied_at: i64,
        }

        // There are relations but they are not important to this migration.
        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }
}

/// Data structures that model the JSON schemas of different record types when written into the meta
/// table.
mod meta {

    pub mod folders {
        use serde::Serialize;

        // We need to define this type instead of using config::meta::folders::Folder because that
        // type does not implement Serialize.
        #[derive(Serialize)]
        pub struct Folder {
            pub folder_id: String,
            pub name: String,
            pub description: String,
        }
    }

    pub mod dashboards {
        use serde::Serialize;

        // We define this type instead of using config::meta::dasshboards::Dashboard because it more
        // closely models the desiered JSON schema.
        #[derive(Serialize)]
        #[serde(untagged)]
        pub enum Dashboard {
            V1(DashboardV1),
            V2(config::meta::dashboards::v2::Dashboard),
            V3(config::meta::dashboards::v3::Dashboard),
            V4(config::meta::dashboards::v4::Dashboard),
            V5(config::meta::dashboards::v5::Dashboard),
        }

        // We define this type instead of using config::meta::dasshboards::v1::Dashboard so that we
        // can serialize the V1 dashboard struct with the additional version field.
        #[derive(Serialize)]
        pub struct DashboardV1 {
            pub version: i32,
            #[serde(flatten)]
            pub rest: config::meta::dashboards::v1::Dashboard,
        }
    }
}

impl From<crate::table::entity::folders::Model> for meta::folders::Folder {
    fn from(value: crate::table::entity::folders::Model) -> Self {
        Self {
            folder_id: value.folder_id.to_string(),
            name: value.name,
            description: value.description.unwrap_or_default(),
        }
    }
}

impl From<crate::table::entity::dashboards::Model> for meta::dashboards::Dashboard {
    fn from(value: crate::table::entity::dashboards::Model) -> Self {
        let d: config::meta::dashboards::Dashboard = value.try_into().unwrap();

        if let Some(inner) = d.v1 {
            Self::V1(meta::dashboards::DashboardV1 {
                version: 1,
                rest: inner,
            })
        } else if let Some(inner) = d.v2 {
            Self::V2(inner)
        } else if let Some(inner) = d.v3 {
            Self::V3(inner)
        } else if let Some(inner) = d.v4 {
            Self::V4(inner)
        } else if let Some(inner) = d.v5 {
            Self::V5(inner)
        } else {
            panic!("dashboard does not contain data compatible with any version")
        }
    }
}
