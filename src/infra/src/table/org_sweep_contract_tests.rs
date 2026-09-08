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

//! A child left unswept does not merely leak: its RESTRICT foreign key aborts the parent's delete.

use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, Database, DatabaseConnection,
    EntityTrait, PaginatorTrait, QueryFilter, Schema, Statement,
};

use crate::table::{
    entity::{folders, synthetics_checks},
    migration::create_synthetics_for_test,
};

const ORG: &str = "acme";
const OTHER_ORG: &str = "globex";
const FOLDER: &str = "folder-1";

/// Sets the foreign-key pragma explicitly, though sqlx already defaults it on per connection.
async fn db() -> DatabaseConnection {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    db.execute(Statement::from_string(
        db.get_database_backend(),
        "PRAGMA foreign_keys = ON",
    ))
    .await
    .unwrap();
    let schema = Schema::new(db.get_database_backend());
    db.execute(
        db.get_database_backend().build(
            schema
                .create_table_from_entity(folders::Entity)
                .if_not_exists(),
        ),
    )
    .await
    .unwrap();
    create_synthetics_for_test(&db).await.unwrap();
    db
}

async fn insert_folder(db: &DatabaseConnection, org: &str, id: &str) {
    folders::ActiveModel {
        id: Set(id.to_string()),
        org: Set(org.to_string()),
        folder_id: Set(format!("fid-{id}")),
        name: Set("Default".to_string()),
        description: Set(None),
        icon: Set(None),
        r#type: Set(1),
    }
    .insert(db)
    .await
    .unwrap();
}

async fn insert_check(db: &DatabaseConnection, org: &str, id: &str, folder: &str) {
    synthetics_checks::ActiveModel {
        id: Set(id.to_string()),
        org_id: Set(org.to_string()),
        folder_id: Set(folder.to_string()),
        tz_offset: Set(0),
        name: Set("Login Flow".to_string()),
        synthetics_type: Set("browser".to_string()),
        target: Set("https://app.example.com".to_string()),
        description: Set(String::new()),
        tags: Set(serde_json::json!([])),
        config: Set(serde_json::json!({})),
        frequency: Set(serde_json::json!({"type": "minutes", "interval": 5, "cron": ""})),
        locations: Set(serde_json::json!([])),
        enabled: Set(true),
        destinations: Set(serde_json::json!([])),
        settings: Set(serde_json::json!({})),
        secrets: Set("{}".to_string()),
        next_run_at: Set(0),
        last_triggered_at: Set(0),
        last_check_status: Set(0),
        consecutive_failures: Set(0),
        last_alert_at: Set(0),
        alerting: Set(false),
        degraded_notified_at: Set(0),
        owner: Set(None),
        created_at: Set(1_750_000_000_000_000),
        updated_at: Set(1_750_000_000_000_000),
    }
    .insert(db)
    .await
    .unwrap();
}

async fn delete_folders_of(db: &DatabaseConnection, org: &str) -> Result<(), sea_orm::DbErr> {
    folders::Entity::delete_many()
        .filter(folders::Column::Org.eq(org))
        .exec(db)
        .await
        .map(|_| ())
}

/// The outage, not the leak: `synthetics_folder_fk` carries no `ON DELETE`.
#[tokio::test]
async fn folder_delete_is_refused_while_a_synthetics_check_references_it() {
    let db = db().await;
    insert_folder(&db, ORG, FOLDER).await;
    insert_check(&db, ORG, "check-1", FOLDER).await;

    let err = delete_folders_of(&db, ORG)
        .await
        .expect_err("the folder delete must be refused while a check references it");
    let msg = err.to_string().to_uppercase();
    assert!(
        msg.contains("FOREIGN KEY"),
        "expected a foreign-key violation, got: {err}"
    );
}

#[tokio::test]
async fn sweeping_the_checks_first_lets_the_org_folder_delete_succeed() {
    let db = db().await;
    insert_folder(&db, ORG, FOLDER).await;
    insert_check(&db, ORG, "check-1", FOLDER).await;
    insert_folder(&db, OTHER_ORG, "folder-2").await;
    insert_check(&db, OTHER_ORG, "check-2", "folder-2").await;

    crate::table::synthetics_checks::delete_by_org(&db, ORG)
        .await
        .unwrap();
    delete_folders_of(&db, ORG)
        .await
        .expect("the folder delete must succeed once the checks are swept");

    assert_eq!(
        synthetics_checks::Entity::find().count(&db).await.unwrap(),
        1,
        "the other org's check must survive"
    );
    assert_eq!(
        folders::Entity::find().count(&db).await.unwrap(),
        1,
        "the other org's folder must survive"
    );
}
