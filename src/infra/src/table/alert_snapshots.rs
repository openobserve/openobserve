// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Alert snapshot manifest table operations.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    SqlErr, TransactionTrait,
};
use svix_ksuid::KsuidLike;

use super::entity::{alert_snapshot_files, alert_snapshots};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewAlertSnapshotManifest {
    pub org_id: String,
    pub alert_id: String,
    pub alert_name: Option<String>,
    pub trigger_timestamp: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub created_at: i64,
    pub schema_version: i16,
    pub files: Vec<NewAlertSnapshotFile>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewAlertSnapshotFile {
    pub stream_type: String,
    pub stream_name: String,
    pub file_id: Option<i64>,
    pub file_key: String,
    pub min_ts: i64,
    pub max_ts: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlertSnapshotManifestRecord {
    pub snapshot: alert_snapshots::Model,
    pub files: Vec<alert_snapshot_files::Model>,
}

pub async fn create_snapshot_manifest(
    manifest: NewAlertSnapshotManifest,
) -> Result<AlertSnapshotManifestRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    create_snapshot_manifest_with_conn(client, manifest).await
}

pub async fn get_snapshot_manifest(
    org_id: &str,
    snapshot_id: &str,
) -> Result<Option<AlertSnapshotManifestRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    get_snapshot_manifest_with_conn(client, org_id, snapshot_id).await
}

pub async fn find_snapshot_by_occurrence(
    org_id: &str,
    alert_id: &str,
    window_start: i64,
    window_end: i64,
) -> Result<Option<AlertSnapshotManifestRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    find_snapshot_by_occurrence_with_conn(client, org_id, alert_id, window_start, window_end).await
}

pub async fn create_snapshot_manifest_with_conn<C>(
    conn: &C,
    manifest: NewAlertSnapshotManifest,
) -> Result<AlertSnapshotManifestRecord, errors::Error>
where
    C: ConnectionTrait + TransactionTrait,
{
    let snapshot_id = svix_ksuid::Ksuid::new(None, None).to_string();
    let files = canonicalize_files(manifest.files);
    let txn = conn.begin().await.map_err(db_err)?;

    let parent = alert_snapshots::ActiveModel {
        snapshot_id: Set(snapshot_id.clone()),
        org_id: Set(manifest.org_id.clone()),
        alert_id: Set(manifest.alert_id.clone()),
        alert_name: Set(manifest.alert_name),
        trigger_timestamp: Set(manifest.trigger_timestamp),
        window_start: Set(manifest.window_start),
        window_end: Set(manifest.window_end),
        created_at: Set(manifest.created_at),
        schema_version: Set(manifest.schema_version),
    };

    if let Err(e) = parent.insert(&txn).await {
        let should_load_existing = is_unique_constraint_error(&e);
        let err = db_err(e);
        let _ = txn.rollback().await;
        if should_load_existing
            && let Some(existing) = find_snapshot_by_occurrence_with_conn(
                conn,
                &manifest.org_id,
                &manifest.alert_id,
                manifest.window_start,
                manifest.window_end,
            )
            .await?
        {
            return Ok(existing);
        }
        return Err(err);
    }

    if !files.is_empty() {
        let child_rows = files
            .into_iter()
            .map(|file| alert_snapshot_files::ActiveModel {
                snapshot_id: Set(snapshot_id.clone()),
                stream_type: Set(file.stream_type),
                stream_name: Set(file.stream_name),
                file_id: Set(file.file_id),
                file_key: Set(file.file_key),
                min_ts: Set(file.min_ts),
                max_ts: Set(file.max_ts),
            })
            .collect::<Vec<_>>();

        if let Err(e) = alert_snapshot_files::Entity::insert_many(child_rows)
            .exec(&txn)
            .await
        {
            let _ = txn.rollback().await;
            return Err(db_err(e));
        }
    }

    txn.commit().await.map_err(db_err)?;

    get_snapshot_manifest_with_conn(conn, &manifest.org_id, &snapshot_id)
        .await?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(
                "alert snapshot not found after creation".to_string(),
            ))
        })
}

pub async fn get_snapshot_manifest_with_conn<C>(
    conn: &C,
    org_id: &str,
    snapshot_id: &str,
) -> Result<Option<AlertSnapshotManifestRecord>, errors::Error>
where
    C: ConnectionTrait,
{
    let Some(snapshot) = alert_snapshots::Entity::find_by_id(snapshot_id)
        .filter(alert_snapshots::Column::OrgId.eq(org_id))
        .one(conn)
        .await
        .map_err(db_err)?
    else {
        return Ok(None);
    };

    Ok(Some(AlertSnapshotManifestRecord {
        files: load_files_for_snapshot(conn, &snapshot.snapshot_id).await?,
        snapshot,
    }))
}

pub async fn find_snapshot_by_occurrence_with_conn<C>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
    window_start: i64,
    window_end: i64,
) -> Result<Option<AlertSnapshotManifestRecord>, errors::Error>
where
    C: ConnectionTrait,
{
    let Some(snapshot) = alert_snapshots::Entity::find()
        .filter(alert_snapshots::Column::OrgId.eq(org_id))
        .filter(alert_snapshots::Column::AlertId.eq(alert_id))
        .filter(alert_snapshots::Column::WindowStart.eq(window_start))
        .filter(alert_snapshots::Column::WindowEnd.eq(window_end))
        .one(conn)
        .await
        .map_err(db_err)?
    else {
        return Ok(None);
    };

    Ok(Some(AlertSnapshotManifestRecord {
        files: load_files_for_snapshot(conn, &snapshot.snapshot_id).await?,
        snapshot,
    }))
}

async fn load_files_for_snapshot<C>(
    conn: &C,
    snapshot_id: &str,
) -> Result<Vec<alert_snapshot_files::Model>, errors::Error>
where
    C: ConnectionTrait,
{
    alert_snapshot_files::Entity::find()
        .filter(alert_snapshot_files::Column::SnapshotId.eq(snapshot_id))
        .order_by_asc(alert_snapshot_files::Column::StreamType)
        .order_by_asc(alert_snapshot_files::Column::StreamName)
        .order_by_asc(alert_snapshot_files::Column::FileKey)
        .order_by_asc(alert_snapshot_files::Column::FileId)
        .order_by_asc(alert_snapshot_files::Column::MinTs)
        .order_by_asc(alert_snapshot_files::Column::MaxTs)
        .all(conn)
        .await
        .map_err(db_err)
}

fn canonicalize_files(mut files: Vec<NewAlertSnapshotFile>) -> Vec<NewAlertSnapshotFile> {
    files.sort_by(|a, b| file_sort_tuple(a).cmp(&file_sort_tuple(b)));
    files.dedup_by(|a, b| a.file_key == b.file_key);
    files
}

fn file_sort_tuple(file: &NewAlertSnapshotFile) -> (&str, &str, &str, bool, i64, i64, i64) {
    (
        file.stream_type.as_str(),
        file.stream_name.as_str(),
        file.file_key.as_str(),
        file.file_id.is_none(),
        file.file_id.unwrap_or_default(),
        file.min_ts,
        file.max_ts,
    )
}

fn db_err(err: sea_orm::DbErr) -> errors::Error {
    Error::DbError(DbError::SeaORMError(err.to_string()))
}

fn is_unique_constraint_error(err: &sea_orm::DbErr) -> bool {
    matches!(err.sql_err(), Some(SqlErr::UniqueConstraintViolation(_)))
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};

    use super::*;

    async fn test_db() -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            r#"
CREATE TABLE alert_snapshots (
    snapshot_id CHAR(27) NOT NULL PRIMARY KEY,
    org_id VARCHAR(128) NOT NULL,
    alert_id CHAR(27) NOT NULL,
    alert_name VARCHAR(256) NULL,
    trigger_timestamp BIGINT NOT NULL,
    window_start BIGINT NOT NULL,
    window_end BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    schema_version SMALLINT NOT NULL,
    UNIQUE (org_id, alert_id, window_start, window_end)
);
"#
            .to_string(),
        ))
        .await
        .unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            r#"
CREATE TABLE alert_snapshot_files (
    snapshot_id CHAR(27) NOT NULL,
    file_key VARCHAR(1024) NOT NULL,
    stream_type VARCHAR(32) NOT NULL,
    stream_name VARCHAR(256) NOT NULL,
    file_id BIGINT NULL,
    min_ts BIGINT NOT NULL,
    max_ts BIGINT NOT NULL,
    PRIMARY KEY (snapshot_id, file_key),
    FOREIGN KEY (snapshot_id) REFERENCES alert_snapshots(snapshot_id) ON DELETE CASCADE
);
"#
            .to_string(),
        ))
        .await
        .unwrap();
        db.execute(Statement::from_string(
            DbBackend::Sqlite,
            "CREATE INDEX alert_snapshot_files_snapshot_idx ON alert_snapshot_files (snapshot_id);"
                .to_string(),
        ))
        .await
        .unwrap();
        db
    }

    fn manifest(org_id: &str, alert_id: &str, window_start: i64) -> NewAlertSnapshotManifest {
        NewAlertSnapshotManifest {
            org_id: org_id.to_string(),
            alert_id: alert_id.to_string(),
            alert_name: Some("cpu_high".to_string()),
            trigger_timestamp: window_start + 10,
            window_start,
            window_end: window_start + 10,
            created_at: window_start + 11,
            schema_version: 1,
            files: vec![file("logs", "app", Some(2), "files/org/logs/app/b.parquet")],
        }
    }

    fn file(
        stream_type: &str,
        stream_name: &str,
        file_id: Option<i64>,
        file_key: &str,
    ) -> NewAlertSnapshotFile {
        NewAlertSnapshotFile {
            stream_type: stream_type.to_string(),
            stream_name: stream_name.to_string(),
            file_id,
            file_key: file_key.to_string(),
            min_ts: 10,
            max_ts: 20,
        }
    }

    #[tokio::test]
    async fn create_snapshot_manifest_persists_parent_and_child_rows() {
        let db = test_db().await;
        let record = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();

        assert_eq!(record.snapshot.org_id, "org1");
        assert_eq!(record.snapshot.alert_id, "alert1");
        assert_eq!(record.snapshot.alert_name.as_deref(), Some("cpu_high"));
        assert_eq!(record.snapshot.schema_version, 1);
        assert_eq!(record.files.len(), 1);
        assert_eq!(record.files[0].file_key, "files/org/logs/app/b.parquet");
    }

    #[tokio::test]
    async fn retrieval_returns_complete_ordered_manifest_record() {
        let db = test_db().await;
        let mut input = manifest("org1", "alert1", 100);
        input.files = vec![
            file("logs", "app", Some(3), "files/org/logs/app/c.parquet"),
            file("logs", "app", Some(1), "files/org/logs/app/a.parquet"),
            file("logs", "app", Some(2), "files/org/logs/app/b.parquet"),
        ];
        let created = create_snapshot_manifest_with_conn(&db, input)
            .await
            .unwrap();
        let fetched = get_snapshot_manifest_with_conn(&db, "org1", &created.snapshot.snapshot_id)
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fetched.snapshot, created.snapshot);
        assert_eq!(
            fetched
                .files
                .iter()
                .map(|file| file.file_key.as_str())
                .collect::<Vec<_>>(),
            vec![
                "files/org/logs/app/a.parquet",
                "files/org/logs/app/b.parquet",
                "files/org/logs/app/c.parquet",
            ]
        );
    }

    #[tokio::test]
    async fn empty_file_list_is_valid() {
        let db = test_db().await;
        let mut input = manifest("org1", "alert1", 100);
        input.files.clear();

        let record = create_snapshot_manifest_with_conn(&db, input)
            .await
            .unwrap();

        assert!(record.files.is_empty());
    }

    #[tokio::test]
    async fn duplicate_occurrence_returns_existing_snapshot() {
        let db = test_db().await;
        let first = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();
        let second = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();

        assert_eq!(first.snapshot.snapshot_id, second.snapshot.snapshot_id);
        assert_eq!(first.files, second.files);
    }

    #[tokio::test]
    async fn duplicate_occurrence_with_changed_manifest_returns_original_snapshot() {
        let db = test_db().await;
        let first = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();
        let mut changed = manifest("org1", "alert1", 100);
        changed.alert_name = Some("renamed".to_string());
        changed.files = vec![
            file("logs", "app", Some(9), "files/org/logs/app/z.parquet"),
            file("logs", "app", Some(10), "files/org/logs/app/y.parquet"),
        ];

        let second = create_snapshot_manifest_with_conn(&db, changed)
            .await
            .unwrap();

        assert_eq!(first.snapshot.snapshot_id, second.snapshot.snapshot_id);
        assert_eq!(second.snapshot.alert_name.as_deref(), Some("cpu_high"));
        assert_eq!(second.files.len(), 1);
        assert_eq!(second.files[0].file_key, "files/org/logs/app/b.parquet");
    }

    #[tokio::test]
    async fn duplicate_occurrence_does_not_append_child_rows() {
        let db = test_db().await;
        create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();
        let mut changed = manifest("org1", "alert1", 100);
        changed.files = vec![file("logs", "app", Some(9), "files/org/logs/app/z.parquet")];

        let record = create_snapshot_manifest_with_conn(&db, changed)
            .await
            .unwrap();

        assert_eq!(record.files.len(), 1);
        assert_eq!(record.files[0].file_key, "files/org/logs/app/b.parquet");
    }

    #[tokio::test]
    async fn repeated_creation_is_idempotent() {
        let db = test_db().await;
        let first = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();

        for _ in 0..3 {
            let repeated = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
                .await
                .unwrap();
            assert_eq!(first.snapshot.snapshot_id, repeated.snapshot.snapshot_id);
        }
    }

    #[tokio::test]
    async fn different_windows_alerts_and_organizations_create_different_snapshots() {
        let db = test_db().await;
        let first = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();
        let different_window =
            create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 200))
                .await
                .unwrap();
        let different_alert =
            create_snapshot_manifest_with_conn(&db, manifest("org1", "alert2", 100))
                .await
                .unwrap();
        let different_org =
            create_snapshot_manifest_with_conn(&db, manifest("org2", "alert1", 100))
                .await
                .unwrap();

        assert_ne!(
            first.snapshot.snapshot_id,
            different_window.snapshot.snapshot_id
        );
        assert_ne!(
            first.snapshot.snapshot_id,
            different_alert.snapshot.snapshot_id
        );
        assert_ne!(
            first.snapshot.snapshot_id,
            different_org.snapshot.snapshot_id
        );
    }

    #[tokio::test]
    async fn cross_organization_retrieval_returns_missing() {
        let db = test_db().await;
        let created = create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();

        let fetched = get_snapshot_manifest_with_conn(&db, "org2", &created.snapshot.snapshot_id)
            .await
            .unwrap();

        assert!(fetched.is_none());
    }

    #[tokio::test]
    async fn find_snapshot_by_occurrence_is_org_scoped() {
        let db = test_db().await;
        create_snapshot_manifest_with_conn(&db, manifest("org1", "alert1", 100))
            .await
            .unwrap();

        assert!(
            find_snapshot_by_occurrence_with_conn(&db, "org1", "alert1", 100, 110)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            find_snapshot_by_occurrence_with_conn(&db, "org2", "alert1", 100, 110)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn duplicate_child_file_references_are_not_repeated() {
        let db = test_db().await;
        let mut input = manifest("org1", "alert1", 100);
        input.files = vec![
            file("logs", "app", Some(2), "files/org/logs/app/a.parquet"),
            file("logs", "app", Some(1), "files/org/logs/app/a.parquet"),
        ];

        let record = create_snapshot_manifest_with_conn(&db, input)
            .await
            .unwrap();

        assert_eq!(record.files.len(), 1);
        assert_eq!(record.files[0].file_id, Some(1));
    }

    #[tokio::test]
    async fn nullable_file_id_is_persisted() {
        let db = test_db().await;
        let mut input = manifest("org1", "alert1", 100);
        input.files = vec![file("logs", "app", None, "files/org/logs/app/a.parquet")];

        let record = create_snapshot_manifest_with_conn(&db, input)
            .await
            .unwrap();

        assert_eq!(record.files[0].file_id, None);
    }

    #[tokio::test]
    async fn schema_version_is_persisted() {
        let db = test_db().await;
        let mut input = manifest("org1", "alert1", 100);
        input.schema_version = 7;

        let record = create_snapshot_manifest_with_conn(&db, input)
            .await
            .unwrap();

        assert_eq!(record.snapshot.schema_version, 7);
    }

    #[tokio::test]
    async fn transaction_rollback_removes_parent_when_child_insert_fails() {
        let db = test_db().await;
        let txn = db.begin().await.unwrap();
        let snapshot_id = "rollback-snapshot".to_string();
        alert_snapshots::ActiveModel {
            snapshot_id: Set(snapshot_id.clone()),
            org_id: Set("org1".to_string()),
            alert_id: Set("alert1".to_string()),
            alert_name: Set(None),
            trigger_timestamp: Set(110),
            window_start: Set(100),
            window_end: Set(110),
            created_at: Set(111),
            schema_version: Set(1),
        }
        .insert(&txn)
        .await
        .unwrap();

        let duplicate = vec![
            alert_snapshot_files::ActiveModel {
                snapshot_id: Set(snapshot_id.clone()),
                file_key: Set("files/org/logs/app/a.parquet".to_string()),
                stream_type: Set("logs".to_string()),
                stream_name: Set("app".to_string()),
                file_id: Set(Some(1)),
                min_ts: Set(10),
                max_ts: Set(20),
            },
            alert_snapshot_files::ActiveModel {
                snapshot_id: Set(snapshot_id.clone()),
                file_key: Set("files/org/logs/app/a.parquet".to_string()),
                stream_type: Set("logs".to_string()),
                stream_name: Set("app".to_string()),
                file_id: Set(Some(2)),
                min_ts: Set(10),
                max_ts: Set(20),
            },
        ];

        assert!(
            alert_snapshot_files::Entity::insert_many(duplicate)
                .exec(&txn)
                .await
                .is_err()
        );
        txn.rollback().await.unwrap();

        assert!(
            get_snapshot_manifest_with_conn(&db, "org1", &snapshot_id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn non_unique_parent_insert_error_is_not_treated_as_idempotent() {
        let err = sea_orm::DbErr::Custom("non-unique parent insert failure".to_string());

        assert!(!is_unique_constraint_error(&err));
    }
}
