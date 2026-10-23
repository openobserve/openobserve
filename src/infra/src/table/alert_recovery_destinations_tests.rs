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

//! `alerts.recovery_destinations` persistence against the shipped TEXT column, on both backends.

use config::meta::{
    alerts::alert::{Alert as MetaAlert, ListAlertsParams},
    folder::FolderType,
    stream::StreamType,
};
use sea_orm::{
    ActiveValue::Set, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, EntityTrait,
    Schema, Statement,
};
use svix_ksuid::{Ksuid, KsuidLike as _};

use super::{
    alerts::{create, get_by_id, list, update},
    entity::{alerts, folders},
    folders::folder_type_into_i16,
    migration::add_alert_recovery_destinations_for_test,
};

const ORG: &str = "org-a";
const FOLDER: &str = "folder-a";

struct PostgresSchema {
    admin: DatabaseConnection,
    db: DatabaseConnection,
    name: String,
}

impl PostgresSchema {
    /// `None` on the SQLite lane, which leaves the DSN unset or empty.
    async fn connect() -> Option<Self> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        if dsn.trim().is_empty() {
            return None;
        }
        let admin = Database::connect(&dsn).await.unwrap();
        let name = format!(
            "recovery_destinations_test_{}",
            Ksuid::new(None, None).to_string().to_ascii_lowercase()
        );
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{name}""#))
            .await
            .unwrap();
        // One connection, so the search_path below applies to every query the test runs.
        let mut options = ConnectOptions::new(dsn);
        options.max_connections(1).min_connections(1);
        let db = Database::connect(options).await.unwrap();
        db.execute_unprepared(&format!(r#"SET search_path TO "{name}""#))
            .await
            .unwrap();
        Some(Self { admin, db, name })
    }

    async fn cleanup(self) {
        self.db.close().await.unwrap();
        self.admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{}" CASCADE"#, self.name))
            .await
            .unwrap();
    }
}

async fn create_tables(db: &DatabaseConnection) {
    let backend = db.get_database_backend();
    let schema = Schema::new(backend);
    db.execute(backend.build(&schema.create_table_from_entity(folders::Entity)))
        .await
        .unwrap();
    db.execute(backend.build(&schema.create_table_from_entity(alerts::Entity)))
        .await
        .unwrap();
    // The entity is not the source of truth for this column; the shipped migration is.
    db.execute_unprepared("ALTER TABLE alerts DROP COLUMN recovery_destinations")
        .await
        .unwrap();
    add_alert_recovery_destinations_for_test(db).await.unwrap();
    folders::Entity::insert(folders::ActiveModel {
        id: Set(Ksuid::new(None, None).to_string()),
        org: Set(ORG.to_string()),
        folder_id: Set(FOLDER.to_string()),
        name: Set("alerts".to_string()),
        description: Set(None),
        r#type: Set(folder_type_into_i16(FolderType::Alerts)),
        icon: Set(None),
    })
    .exec(db)
    .await
    .unwrap();
}

fn new_alert(name: &str, recovery_destinations: &[&str]) -> MetaAlert {
    let mut alert = MetaAlert::default();
    alert.name = name.to_string();
    alert.org_id = ORG.to_string();
    alert.stream_type = StreamType::Logs;
    alert.stream_name = "default".to_string();
    alert.destinations = vec!["dest_fire".to_string()];
    alert.recovery_destinations = recovery_destinations
        .iter()
        .map(|d| d.to_string())
        .collect();
    alert
}

async fn column_type(db: &DatabaseConnection) -> String {
    let sql = match db.get_database_backend() {
        sea_orm::DbBackend::Postgres => {
            "SELECT data_type AS ty FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'alerts' AND column_name = 'recovery_destinations'"
        }
        _ => {
            "SELECT type AS ty FROM pragma_table_info('alerts') WHERE name = 'recovery_destinations'"
        }
    };
    let row = db
        .query_one(Statement::from_string(
            db.get_database_backend(),
            sql.to_string(),
        ))
        .await
        .unwrap()
        .unwrap();
    row.try_get::<String>("", "ty").unwrap().to_lowercase()
}

async fn raw_value(db: &DatabaseConnection, id: Ksuid) -> Option<String> {
    let row = db
        .query_one(Statement::from_string(
            db.get_database_backend(),
            format!("SELECT recovery_destinations FROM alerts WHERE id = '{id}'"),
        ))
        .await
        .unwrap()
        .unwrap();
    row.try_get("", "recovery_destinations").unwrap()
}

async fn set_raw_value(db: &DatabaseConnection, id: Ksuid, sql_value: &str) {
    db.execute_unprepared(&format!(
        "UPDATE alerts SET recovery_destinations = {sql_value} WHERE id = '{id}'"
    ))
    .await
    .unwrap();
}

async fn stored(db: &DatabaseConnection, id: Ksuid) -> Vec<String> {
    get_by_id(db, ORG, id)
        .await
        .unwrap()
        .unwrap()
        .1
        .recovery_destinations
}

async fn assert_round_trips(db: &DatabaseConnection) {
    assert_eq!(column_type(db).await, "text");

    let created = create(db, ORG, FOLDER, new_alert("a", &["dest_recover"]), false)
        .await
        .unwrap();
    let id = created.id.unwrap();
    assert_eq!(created.recovery_destinations, vec!["dest_recover"]);
    assert_eq!(
        raw_value(db, id).await.as_deref(),
        Some(r#"["dest_recover"]"#)
    );
    assert_eq!(stored(db, id).await, vec!["dest_recover"]);

    let mut changed = created.clone();
    changed.recovery_destinations = vec!["r1".to_string(), "r2".to_string()];
    let updated = update(db, ORG, None, changed).await.unwrap();
    assert_eq!(updated.recovery_destinations, vec!["r1", "r2"]);
    assert_eq!(raw_value(db, id).await.as_deref(), Some(r#"["r1","r2"]"#));

    let mut cleared = updated.clone();
    cleared.recovery_destinations = vec![];
    let updated = update(db, ORG, None, cleared).await.unwrap();
    assert!(updated.recovery_destinations.is_empty());
    assert_eq!(raw_value(db, id).await, None);
    assert!(stored(db, id).await.is_empty());

    let empty = create(db, ORG, FOLDER, new_alert("b", &[]), false)
        .await
        .unwrap();
    assert_eq!(raw_value(db, empty.id.unwrap()).await, None);

    let listed = list(db, ListAlertsParams::new(ORG)).await.unwrap();
    assert_eq!(listed.len(), 2);
}

async fn assert_existing_rows_load(db: &DatabaseConnection) {
    let id = create(db, ORG, FOLDER, new_alert("legacy", &[]), false)
        .await
        .unwrap()
        .id
        .unwrap();

    set_raw_value(db, id, "NULL").await;
    assert!(stored(db, id).await.is_empty());

    set_raw_value(db, id, r#"'[ "legacy_a", "legacy_b" ]'"#).await;
    assert_eq!(stored(db, id).await, vec!["legacy_a", "legacy_b"]);
}

async fn assert_bad_payload_is_reported(db: &DatabaseConnection) {
    let id = create(db, ORG, FOLDER, new_alert("bad", &[]), false)
        .await
        .unwrap()
        .id
        .unwrap();

    for bad in ["'not json'", r#"'{"dest": "x"}'"#, "'[1, 2]'", "''"] {
        set_raw_value(db, id, bad).await;
        let err = get_by_id(db, ORG, id).await.unwrap_err().to_string();
        assert!(
            err.contains(&format!(
                "alert {id} has an invalid recovery_destinations value"
            )),
            "{bad}: {err}"
        );
        assert!(list(db, ListAlertsParams::new(ORG)).await.is_err(), "{bad}");
    }
}

async fn assert_all(db: &DatabaseConnection) {
    assert_round_trips(db).await;
    assert_existing_rows_load(db).await;
    assert_bad_payload_is_reported(db).await;
}

#[tokio::test]
async fn sqlite_round_trips_on_the_shipped_text_column() {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    create_tables(&db).await;
    assert_all(&db).await;
}

#[tokio::test]
async fn postgres_round_trips_on_the_shipped_text_column() {
    let Some(pg) = PostgresSchema::connect().await else {
        return;
    };
    create_tables(&pg.db).await;
    assert_all(&pg.db).await;
    pg.cleanup().await;
}
