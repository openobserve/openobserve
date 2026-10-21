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
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, QueryOrder,
    QuerySelect, Set, SqlErr, TransactionTrait, sea_query::Expr,
};

pub use super::entity::{fleet_config_versions::Model as VersionModel, fleet_configs::Model};
use super::entity::{
    fleet_config_versions::{
        ActiveModel as VersionActiveModel, Column as VersionColumn, Entity as VersionEntity,
    },
    fleet_configs::{ActiveModel, Column, Entity},
};
use crate::{
    db::get_orm_client_rw,
    errors::{DbError, Error},
};

/// 2 binds per pair plus the org stays far under SQLite's 32,766 parameters.
pub const VERSION_YAML_CHUNK: usize = 1000;

#[derive(Debug, FromQueryResult)]
pub struct ConfigRow {
    pub org_id: String,
    pub id: String,
    pub description: String,
    pub latest_version: i64,
    pub updated_at: i64,
    pub updated_by: String,
    pub live_version: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
pub struct VersionRow {
    pub version: i64,
    pub message: String,
    pub author: String,
    pub created_at: i64,
}

#[derive(Debug, FromQueryResult)]
pub struct VersionYaml {
    pub config_id: String,
    pub version: i64,
    pub yaml: String,
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<ConfigRow>, Error> {
    Ok(Entity::find()
        .select_only()
        .columns([
            Column::OrgId,
            Column::Id,
            Column::Description,
            Column::LatestVersion,
            Column::UpdatedAt,
            Column::UpdatedBy,
            Column::LiveVersion,
        ])
        .filter(Column::OrgId.eq(org_id))
        .order_by_asc(Column::Id)
        .into_model::<ConfigRow>()
        .all(conn)
        .await?)
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await?)
}

pub async fn insert_with<C: ConnectionTrait>(conn: &C, row: Model) -> Result<(), Error> {
    let record = ActiveModel {
        org_id: Set(row.org_id),
        id: Set(row.id),
        description: Set(row.description),
        latest_version: Set(row.latest_version),
        draft_yaml: Set(row.draft_yaml),
        draft_by: Set(row.draft_by),
        draft_at: Set(row.draft_at),
        updated_at: Set(row.updated_at),
        updated_by: Set(row.updated_by),
        live_version: Set(row.live_version),
    };
    unique(Entity::insert(record).exec_without_returning(conn).await)
}

pub async fn save_draft_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    yaml: &str,
    by: &str,
    at_us: i64,
) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::DraftYaml, Expr::value(yaml))
        .col_expr(Column::DraftBy, Expr::value(by))
        .col_expr(Column::DraftAt, Expr::value(at_us))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Compare-and-set: 0 rows means the config is gone or another publish moved latest_version first.
pub async fn bump_latest_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    expected: i64,
    by: &str,
    at_us: i64,
) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::LatestVersion, Expr::value(expected + 1))
        .col_expr(Column::DraftYaml, Expr::value(Option::<String>::None))
        .col_expr(Column::DraftBy, Expr::value(Option::<String>::None))
        .col_expr(Column::DraftAt, Expr::value(Option::<i64>::None))
        .col_expr(Column::UpdatedAt, Expr::value(at_us))
        .col_expr(Column::UpdatedBy, Expr::value(by))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::LatestVersion.eq(expected))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn insert_version_with<C: ConnectionTrait>(
    conn: &C,
    row: VersionModel,
) -> Result<(), Error> {
    let record = VersionActiveModel {
        org_id: Set(row.org_id),
        config_id: Set(row.config_id),
        version: Set(row.version),
        yaml: Set(row.yaml),
        hash: Set(row.hash),
        message: Set(row.message),
        author: Set(row.author),
        created_at: Set(row.created_at),
    };
    unique(
        VersionEntity::insert(record)
            .exec_without_returning(conn)
            .await,
    )
}

pub async fn list_versions_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Vec<VersionRow>, Error> {
    Ok(VersionEntity::find()
        .select_only()
        .columns([
            VersionColumn::Version,
            VersionColumn::Message,
            VersionColumn::Author,
            VersionColumn::CreatedAt,
        ])
        .filter(VersionColumn::OrgId.eq(org_id))
        .filter(VersionColumn::ConfigId.eq(id))
        .order_by_desc(VersionColumn::Version)
        .into_model::<VersionRow>()
        .all(conn)
        .await?)
}

pub async fn get_version_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    version: i64,
) -> Result<Option<VersionModel>, Error> {
    Ok(VersionEntity::find()
        .filter(VersionColumn::OrgId.eq(org_id))
        .filter(VersionColumn::ConfigId.eq(id))
        .filter(VersionColumn::Version.eq(version))
        .one(conn)
        .await?)
}

pub async fn versions_yaml_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    keys: &[(String, i64)],
) -> Result<Vec<VersionYaml>, Error> {
    let mut out = Vec::with_capacity(keys.len());
    for chunk in keys.chunks(VERSION_YAML_CHUNK) {
        // A row-value IN, because 1000 OR-ed pairs overflow the stack.
        let pairs = Expr::tuple([
            Expr::col(VersionColumn::ConfigId).into(),
            Expr::col(VersionColumn::Version).into(),
        ])
        .in_tuples(chunk.iter().cloned());
        out.extend(
            VersionEntity::find()
                .select_only()
                .columns([
                    VersionColumn::ConfigId,
                    VersionColumn::Version,
                    VersionColumn::Yaml,
                ])
                .filter(VersionColumn::OrgId.eq(org_id))
                .filter(pairs)
                .into_model::<VersionYaml>()
                .all(conn)
                .await?,
        );
    }
    Ok(out)
}

/// A no-op write that takes the parent row's lock on PostgreSQL; 0 means the config is gone.
pub async fn lock_with<C: ConnectionTrait>(conn: &C, org_id: &str, id: &str) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::LatestVersion, Expr::cust("latest_version"))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn set_live_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    version: i64,
) -> Result<u64, Error> {
    let res = Entity::update_many()
        .col_expr(Column::LiveVersion, Expr::value(version))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Parent row first, so a concurrent publish's compare-and-set serializes against it.
pub async fn delete_parent_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_versions_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<(), Error> {
    VersionEntity::delete_many()
        .filter(VersionColumn::OrgId.eq(org_id))
        .filter(VersionColumn::ConfigId.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<(), Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: TransactionTrait>(db: &C, org_id: &str) -> Result<(), Error> {
    let txn = db.begin().await?;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    VersionEntity::delete_many()
        .filter(VersionColumn::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

fn unique<T>(res: Result<T, sea_orm::DbErr>) -> Result<(), Error> {
    match res {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                Err(Error::DbError(DbError::UniqueViolation))
            }
            _ => Err(e.into()),
        },
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection};

    use super::*;
    use crate::table::migration::create_fleet_collectors_for_test;

    const NOW: i64 = 1_790_000_000_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_fleet_collectors_for_test(&db).await.unwrap();
        db
    }

    fn config(org_id: &str, id: &str) -> Model {
        Model {
            org_id: org_id.to_string(),
            id: id.to_string(),
            description: format!("{id} description"),
            latest_version: 0,
            draft_yaml: Some("receivers: {}\n".to_string()),
            draft_by: Some("a@example.com".to_string()),
            draft_at: Some(NOW),
            updated_at: NOW,
            updated_by: "a@example.com".to_string(),
            live_version: None,
        }
    }

    fn version(org_id: &str, id: &str, version: i64) -> VersionModel {
        VersionModel {
            org_id: org_id.to_string(),
            config_id: id.to_string(),
            version,
            yaml: format!("# v{version}\n"),
            hash: vec![version as u8; 32],
            message: format!("m{version}"),
            author: "a@example.com".to_string(),
            created_at: NOW + version,
        }
    }

    async fn seed<C: ConnectionTrait>(db: &C, configs: &[Model], versions: &[VersionModel]) {
        for c in configs {
            insert_with(db, c.clone()).await.unwrap();
        }
        for v in versions {
            insert_version_with(db, v.clone()).await.unwrap();
        }
    }

    async fn version_numbers<C: ConnectionTrait>(db: &C, org_id: &str, id: &str) -> Vec<i64> {
        list_versions_with(db, org_id, id)
            .await
            .unwrap()
            .into_iter()
            .map(|v| v.version)
            .collect()
    }

    #[tokio::test]
    async fn list_is_org_scoped_ordered_by_id_and_ids_are_unique_per_org() {
        let db = db().await;
        seed(
            &db,
            &[
                config("o1", "zeta"),
                config("o1", "alpha"),
                config("o2", "beta"),
            ],
            &[],
        )
        .await;
        let rows = list_with(&db, "o1").await.unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["alpha", "zeta"]);
        assert_eq!(rows[0].description, "alpha description");
        assert_eq!(rows[0].updated_by, "a@example.com");

        assert!(matches!(
            insert_with(&db, config("o1", "alpha")).await,
            Err(Error::DbError(DbError::UniqueViolation))
        ));
        insert_with(&db, config("o2", "alpha"))
            .await
            .expect("another org");
    }

    #[tokio::test]
    async fn save_draft_sets_the_three_columns_and_is_org_scoped() {
        let db = db().await;
        seed(&db, &[config("o1", "a")], &[]).await;
        assert_eq!(
            save_draft_with(&db, "o1", "a", "exporters: {}\n", "b@example.com", NOW + 5)
                .await
                .unwrap(),
            1
        );
        let row = get_with(&db, "o1", "a").await.unwrap().unwrap();
        assert_eq!(row.draft_yaml.as_deref(), Some("exporters: {}\n"));
        assert_eq!(row.draft_by.as_deref(), Some("b@example.com"));
        assert_eq!(row.draft_at, Some(NOW + 5));
        assert_eq!(row.updated_at, NOW, "a draft is not an update");
        for (org, id) in [("o1", "missing"), ("o2", "a")] {
            assert_eq!(
                save_draft_with(&db, org, id, "", "b", NOW).await.unwrap(),
                0
            );
        }
    }

    #[tokio::test]
    async fn bump_latest_is_a_compare_and_set_that_clears_the_draft() {
        let db = db().await;
        seed(&db, &[config("o1", "a")], &[]).await;
        assert_eq!(
            bump_latest_with(&db, "o1", "a", 0, "p@example.com", NOW + 9)
                .await
                .unwrap(),
            1
        );
        let row = get_with(&db, "o1", "a").await.unwrap().unwrap();
        assert_eq!(row.latest_version, 1);
        assert_eq!(
            (row.draft_yaml, row.draft_by, row.draft_at),
            (None, None, None)
        );
        assert_eq!(
            (row.updated_at, row.updated_by.as_str()),
            (NOW + 9, "p@example.com")
        );

        save_draft_with(&db, "o1", "a", "x: 1\n", "b", NOW)
            .await
            .unwrap();
        assert_eq!(
            bump_latest_with(&db, "o1", "a", 0, "q", NOW + 10)
                .await
                .unwrap(),
            0
        );
        let unchanged = get_with(&db, "o1", "a").await.unwrap().unwrap();
        assert_eq!(unchanged.latest_version, 1);
        assert_eq!(unchanged.draft_yaml.as_deref(), Some("x: 1\n"));
        assert_eq!(unchanged.updated_by, "p@example.com");
    }

    #[tokio::test]
    async fn versions_list_newest_first_without_yaml_and_are_unique() {
        let db = db().await;
        seed(
            &db,
            &[config("o1", "a")],
            &[
                version("o1", "a", 1),
                version("o1", "a", 2),
                version("o1", "b", 1),
            ],
        )
        .await;
        let rows = list_versions_with(&db, "o1", "a").await.unwrap();
        assert_eq!(
            rows.iter()
                .map(|r| (r.version, r.message.as_str()))
                .collect::<Vec<_>>(),
            vec![(2, "m2"), (1, "m1")]
        );
        assert_eq!(rows[0].author, "a@example.com");
        assert_eq!(rows[0].created_at, NOW + 2);

        let got = get_version_with(&db, "o1", "a", 2).await.unwrap().unwrap();
        assert_eq!(got, version("o1", "a", 2));
        assert!(get_version_with(&db, "o1", "a", 3).await.unwrap().is_none());
        assert!(get_version_with(&db, "o2", "a", 2).await.unwrap().is_none());
        assert!(matches!(
            insert_version_with(&db, version("o1", "a", 2)).await,
            Err(Error::DbError(DbError::UniqueViolation))
        ));
    }

    #[tokio::test]
    async fn delete_removes_the_config_and_only_its_versions() {
        let db = db().await;
        seed(
            &db,
            &[config("o1", "a"), config("o1", "b"), config("o2", "a")],
            &[
                version("o1", "a", 1),
                version("o1", "a", 2),
                version("o1", "b", 1),
                version("o2", "a", 1),
            ],
        )
        .await;
        assert_eq!(delete_parent_with(&db, "o1", "a").await.unwrap(), 1);
        delete_versions_with(&db, "o1", "a").await.unwrap();
        assert!(get_with(&db, "o1", "a").await.unwrap().is_none());
        assert!(version_numbers(&db, "o1", "a").await.is_empty());
        assert_eq!(version_numbers(&db, "o1", "b").await, vec![1]);
        assert_eq!(version_numbers(&db, "o2", "a").await, vec![1]);
        assert!(get_with(&db, "o2", "a").await.unwrap().is_some());
        assert_eq!(delete_parent_with(&db, "o1", "missing").await.unwrap(), 0);
    }

    #[tokio::test]
    async fn lock_and_set_live_touch_only_an_existing_config() {
        let db = db().await;
        seed(&db, &[config("o1", "a")], &[]).await;
        assert_eq!(lock_with(&db, "o1", "a").await.unwrap(), 1);
        assert_eq!(lock_with(&db, "o1", "missing").await.unwrap(), 0);
        let row = get_with(&db, "o1", "a").await.unwrap().unwrap();
        assert_eq!((row.latest_version, row.live_version), (0, None));
        assert_eq!(set_live_with(&db, "o1", "a", 3).await.unwrap(), 1);
        assert_eq!(set_live_with(&db, "o2", "a", 3).await.unwrap(), 0);
        assert_eq!(list_with(&db, "o1").await.unwrap()[0].live_version, Some(3));
    }

    #[tokio::test]
    async fn delete_by_org_is_org_scoped_and_atomic() {
        let db = db().await;
        seed(
            &db,
            &[config("o1", "a"), config("o2", "a")],
            &[version("o1", "a", 1), version("o2", "a", 1)],
        )
        .await;
        delete_by_org_with(&db, "o1").await.unwrap();
        assert!(list_with(&db, "o1").await.unwrap().is_empty());
        assert!(version_numbers(&db, "o1", "a").await.is_empty());
        assert_eq!(list_with(&db, "o2").await.unwrap().len(), 1);
        assert_eq!(version_numbers(&db, "o2", "a").await, vec![1]);

        db.execute_unprepared("DROP TABLE fleet_config_versions")
            .await
            .unwrap();
        assert!(delete_by_org_with(&db, "o2").await.is_err());
        assert_eq!(
            list_with(&db, "o2").await.unwrap().len(),
            1,
            "the config delete rolled back with the failed version delete"
        );
    }

    #[tokio::test]
    async fn versions_yaml_reads_exactly_the_asked_pairs() {
        let db = db().await;
        let history: Vec<VersionModel> = (1..=10).map(|v| version("o1", "c", v)).collect();
        seed(&db, &[config("o1", "c")], &history).await;
        seed(&db, &[config("o2", "c")], &[version("o2", "c", 12)]).await;
        let mut rows = versions_yaml_with(
            &db,
            "o1",
            &[
                ("c".to_string(), 2),
                ("c".to_string(), 9),
                ("c".to_string(), 11),
                ("c".to_string(), 12),
            ],
        )
        .await
        .unwrap();
        rows.sort_by_key(|r| r.version);
        assert_eq!(
            rows.iter()
                .map(|r| (r.config_id.as_str(), r.version, r.yaml.as_str()))
                .collect::<Vec<_>>(),
            vec![("c", 2, "# v2\n"), ("c", 9, "# v9\n")]
        );

        db.execute_unprepared("DROP TABLE fleet_config_versions")
            .await
            .unwrap();
        assert!(
            versions_yaml_with(&db, "o1", &[]).await.unwrap().is_empty(),
            "an empty list never queries"
        );
    }

    #[tokio::test]
    async fn versions_yaml_reads_beyond_one_chunk() {
        let db = db().await;
        let n = VERSION_YAML_CHUNK as i64 + 1;
        let versions: Vec<VersionModel> = (1..=n).map(|v| version("o1", "c", v)).collect();
        seed(&db, &[config("o1", "c")], &versions).await;
        let keys: Vec<(String, i64)> = (1..=n).map(|v| ("c".to_string(), v)).collect();
        let mut got: Vec<i64> = versions_yaml_with(&db, "o1", &keys)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.version)
            .collect();
        got.sort_unstable();
        assert_eq!(got, (1..=n).collect::<Vec<_>>());
    }

    async fn postgres_pools(
        n: usize,
    ) -> Option<(DatabaseConnection, String, Vec<DatabaseConnection>)> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        // The SQLite lane sets the variable empty rather than unsetting it.
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!("fleet_configs_test_{}", config::ider::generate());
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut pools = Vec::new();
        for _ in 0..n {
            let mut options = sea_orm::ConnectOptions::new(dsn.clone());
            options
                .max_connections(1)
                .min_connections(1)
                .set_schema_search_path(schema.clone());
            pools.push(Database::connect(options).await.unwrap());
        }
        create_fleet_collectors_for_test(&pools[0]).await.unwrap();
        Some((admin, schema, pools))
    }

    #[tokio::test]
    async fn postgres_serializes_racing_publishes_and_deletes_when_ci_provides_it() {
        let Some((admin, schema, mut pools)) = postgres_pools(2).await else {
            return;
        };
        let b = std::sync::Arc::new(pools.pop().unwrap());
        let a = &pools[0];
        seed(a, &[config("o1", "race"), config("o1", "gone")], &[]).await;

        let first = a.begin().await.unwrap();
        let second = b.begin().await.unwrap();
        for txn in [&first, &second] {
            let row = get_with(txn, "o1", "race").await.unwrap().unwrap();
            assert_eq!(row.latest_version, 0);
        }
        assert_eq!(
            bump_latest_with(&first, "o1", "race", 0, "a", NOW)
                .await
                .unwrap(),
            1
        );
        let blocked = tokio::spawn(async move {
            let rows = bump_latest_with(&second, "o1", "race", 0, "b", NOW)
                .await
                .unwrap();
            second.rollback().await.unwrap();
            rows
        });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert!(!blocked.is_finished(), "the second CAS waits for the first");
        first.commit().await.unwrap();
        assert_eq!(blocked.await.unwrap(), 0);

        let publish = a.begin().await.unwrap();
        bump_latest_with(&publish, "o1", "gone", 0, "a", NOW)
            .await
            .unwrap();
        insert_version_with(&publish, version("o1", "gone", 1))
            .await
            .unwrap();
        let deleter = b.clone();
        let delete = tokio::spawn(async move {
            let txn = deleter.begin().await.unwrap();
            let rows = delete_parent_with(&txn, "o1", "gone").await.unwrap();
            delete_versions_with(&txn, "o1", "gone").await.unwrap();
            txn.commit().await.unwrap();
            rows
        });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        publish.commit().await.unwrap();
        assert_eq!(delete.await.unwrap(), 1);
        assert!(version_numbers(a, "o1", "gone").await.is_empty());

        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .await
            .unwrap();
    }
}
