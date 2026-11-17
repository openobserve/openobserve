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

//! `service_identity_rules`: env overrides, last writer wins on (`updated_at`, `writer_cluster`).

use config::meta::service_identity::{Override, RULE_TYPE_ENV_OVERRIDE};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbBackend, DbErr, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
    sea_query::{Expr, OnConflict},
};

use super::{
    entity::service_identity_rules::{ActiveModel, Column, Entity, Model},
    service_versions::Dialect,
};
use crate::errors;

const TABLE: &str = "service_identity_rules";

/// Writes `row` (a live override or a tombstone) unless the stored row is newer; true if applied.
pub async fn upsert<C: ConnectionTrait>(conn: &C, row: &Override) -> Result<bool, errors::Error> {
    let on_conflict = OnConflict::column(Column::RuleKey)
        .update_columns([
            Column::RuleType,
            Column::Scope,
            Column::K8sCluster,
            Column::WhereKey,
            Column::ServiceName,
            Column::Value,
            Column::InferredValue,
            Column::InferredSource,
            Column::CreatedBy,
            Column::UpdatedBy,
            Column::CreatedAt,
            Column::UpdatedAt,
            Column::DeletedAt,
            Column::WriterCluster,
        ])
        .action_and_where(Expr::cust(lww_condition(conn.get_database_backend())))
        .to_owned();
    let result = Entity::insert(to_active_model(row))
        .on_conflict(on_conflict)
        .exec_without_returning(conn)
        .await?;
    Ok(result > 0)
}

/// Stores a tombstone even with no row yet, so a delete that outruns its put still wins.
pub async fn tombstone<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    rule_key: &str,
    updated_at: i64,
    writer_cluster: &str,
) -> Result<bool, errors::Error> {
    let stone = ActiveModel {
        rule_key: Set(rule_key.to_string()),
        org_id: Set(org_id.to_string()),
        rule_type: Set(RULE_TYPE_ENV_OVERRIDE.to_string()),
        scope: Set(String::new()),
        k8s_cluster: Set(String::new()),
        where_key: Set(String::new()),
        service_name: Set(String::new()),
        value: Set(String::new()),
        inferred_value: Set(String::new()),
        inferred_source: Set(String::new()),
        created_by: Set(String::new()),
        updated_by: Set(String::new()),
        created_at: Set(updated_at),
        updated_at: Set(updated_at),
        deleted_at: Set(Some(updated_at)),
        writer_cluster: Set(writer_cluster.to_string()),
    };
    let on_conflict = OnConflict::column(Column::RuleKey)
        .update_columns([Column::UpdatedAt, Column::DeletedAt, Column::WriterCluster])
        .action_and_where(Expr::cust(lww_condition(conn.get_database_backend())))
        .to_owned();
    let result = Entity::insert(stone)
        .on_conflict(on_conflict)
        .exec_without_returning(conn)
        .await?;
    Ok(result > 0)
}

/// The org's live overrides; tombstones are skipped.
pub async fn list<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<Override>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DeletedAt.is_null())
        .order_by_desc(Column::UpdatedAt)
        .order_by_asc(Column::RuleKey)
        .all(conn)
        .await?
        .into_iter()
        .map(to_override)
        .collect()
}

/// Matches the exact `org_id` only, so a sibling org with a shared prefix keeps its rows.
pub async fn delete_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(result.rows_affected)
}

/// Total order (updated_at, writer_cluster, tombstone, value): ties never diverge across regions.
pub async fn purge_tombstones<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    before: i64,
) -> Result<u64, errors::Error> {
    let keys = Entity::find()
        .select_only()
        .column(Column::RuleKey)
        .filter(Column::OrgId.eq(org))
        .filter(Column::DeletedAt.lt(before))
        .limit(1000)
        .into_tuple::<String>()
        .all(conn)
        .await?;
    if keys.is_empty() {
        return Ok(0);
    }
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org))
        .filter(Column::RuleKey.is_in(keys))
        .filter(Column::DeletedAt.lt(before))
        .exec(conn)
        .await?
        .rows_affected)
}

fn lww_condition(backend: DbBackend) -> String {
    let sql = Dialect::new(backend, TABLE);
    let rank = |side: &dyn Fn(&str) -> String| {
        sql.rank(&[
            side("updated_at"),
            sql.bytes(&side("writer_cluster")),
            format!("CASE WHEN {} IS NULL THEN 0 ELSE 1 END", side("deleted_at")),
            sql.bytes(&side("value")),
        ])
    };
    format!(
        "{} > {}",
        rank(&|c: &str| sql.incoming(c)),
        rank(&|c: &str| sql.stored(c))
    )
}

fn to_active_model(row: &Override) -> ActiveModel {
    ActiveModel {
        rule_key: Set(row.rule_key.clone()),
        org_id: Set(row.org_id.clone()),
        rule_type: Set(row.rule_type.clone()),
        scope: Set(row.scope.as_str().to_string()),
        k8s_cluster: Set(row.k8s_cluster.clone()),
        where_key: Set(row.where_key.clone()),
        service_name: Set(row.service_name.clone()),
        value: Set(row.value.clone()),
        inferred_value: Set(row.inferred_value.clone()),
        inferred_source: Set(row.inferred_source.as_str().to_string()),
        created_by: Set(row.created_by.clone()),
        updated_by: Set(row.updated_by.clone()),
        created_at: Set(row.created_at),
        updated_at: Set(row.updated_at),
        deleted_at: Set(row.deleted_at),
        writer_cluster: Set(row.writer_cluster.clone()),
    }
}

fn to_override(m: Model) -> Result<Override, errors::Error> {
    Ok(Override {
        scope: m.scope.parse().map_err(DbErr::Type)?,
        inferred_source: m.inferred_source.parse().map_err(DbErr::Type)?,
        rule_key: m.rule_key,
        org_id: m.org_id,
        rule_type: m.rule_type,
        k8s_cluster: m.k8s_cluster,
        where_key: m.where_key,
        service_name: m.service_name,
        value: m.value,
        inferred_value: m.inferred_value,
        created_by: m.created_by,
        updated_by: m.updated_by,
        created_at: m.created_at,
        updated_at: m.updated_at,
        deleted_at: m.deleted_at,
        writer_cluster: m.writer_cluster,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{EnvSource, OverrideScope, rule_key};
    use sea_orm::DatabaseConnection;

    use super::*;
    use crate::table::migration::{
        create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
    };

    const ORG: &str = "acme";
    const WHERE: &str = "k8s:obs-region/openobserve";

    async fn dbs(label: &str) -> Vec<DatabaseConnection> {
        let dbs = sqlite_and_postgres_for_test(label).await;
        for db in &dbs {
            create_service_identity_tables_for_test(db).await.unwrap();
        }
        dbs
    }

    fn put(value: &str, updated_at: i64, writer_cluster: &str) -> Override {
        Override {
            rule_key: rule_key(ORG, OverrideScope::Where.as_str(), "obs-region", WHERE, ""),
            org_id: ORG.to_string(),
            rule_type: RULE_TYPE_ENV_OVERRIDE.to_string(),
            scope: OverrideScope::Where,
            k8s_cluster: "obs-region".to_string(),
            where_key: WHERE.to_string(),
            service_name: String::new(),
            value: value.to_string(),
            inferred_value: "obs-region".to_string(),
            inferred_source: EnvSource::ClusterName,
            created_by: "alice@example.com".to_string(),
            updated_by: "alice@example.com".to_string(),
            created_at: updated_at,
            updated_at,
            deleted_at: None,
            writer_cluster: writer_cluster.to_string(),
        }
    }

    async fn stored(db: &DatabaseConnection) -> Model {
        Entity::find()
            .filter(Column::OrgId.eq(ORG))
            .one(db)
            .await
            .unwrap()
            .expect("one row")
    }

    #[tokio::test]
    async fn rules_lww_then_writer_cluster_tie_break() {
        let writes = [
            put("prod", 100, "us"),
            put("staging", 90, "zz"),
            put("dev", 100, "eu"),
            put("qa", 100, "zz"),
        ];
        for db in dbs("rules_lww").await {
            for order in [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]] {
                delete_by_org(&db, ORG).await.unwrap();
                for i in order {
                    upsert(&db, &writes[i]).await.unwrap();
                }
                assert_eq!(
                    list(&db, ORG).await.unwrap(),
                    vec![writes[3].clone()],
                    "{order:?}"
                );
            }
            delete_by_org(&db, ORG).await.unwrap();
            assert!(upsert(&db, &writes[0]).await.unwrap());
            assert!(!upsert(&db, &writes[1]).await.unwrap(), "older loses");
            assert!(
                !upsert(&db, &writes[2]).await.unwrap(),
                "same time, smaller cluster loses"
            );
            assert!(
                upsert(&db, &writes[3]).await.unwrap(),
                "same time, larger cluster wins"
            );
            assert!(
                !upsert(&db, &writes[3]).await.unwrap(),
                "a redelivery is a no-op"
            );
        }
    }

    #[tokio::test]
    async fn rules_delete_before_put_keeps_tombstone() {
        let region_a_put = put("prod", 100, "us");
        let key = region_a_put.rule_key.clone();
        for db in dbs("rules_tombstone").await {
            delete_by_org(&db, ORG).await.unwrap();
            assert!(tombstone(&db, ORG, &key, 200, "eu").await.unwrap());
            assert!(
                !upsert(&db, &region_a_put).await.unwrap(),
                "the late put is ignored"
            );
            assert!(list(&db, ORG).await.unwrap().is_empty());
            let in_b = stored(&db).await;

            delete_by_org(&db, ORG).await.unwrap();
            assert!(upsert(&db, &region_a_put).await.unwrap());
            assert!(tombstone(&db, ORG, &key, 200, "eu").await.unwrap());
            assert!(list(&db, ORG).await.unwrap().is_empty());
            let in_a = stored(&db).await;
            assert_eq!(
                (
                    in_a.deleted_at,
                    in_a.updated_at,
                    in_a.writer_cluster.as_str()
                ),
                (
                    in_b.deleted_at,
                    in_b.updated_at,
                    in_b.writer_cluster.as_str()
                )
            );
            assert_eq!(in_a.deleted_at, Some(200));
            assert_eq!(in_a.value, "prod", "a tombstone keeps the row it hides");

            assert!(
                !tombstone(&db, ORG, &key, 150, "zz").await.unwrap(),
                "older delete"
            );
            let tie = put("dev", 200, "eu");
            assert!(
                !upsert(&db, &tie).await.unwrap(),
                "a delete wins a full tie"
            );
            let later = put("dev", 300, "us");
            assert!(upsert(&db, &later).await.unwrap());
            assert_eq!(list(&db, ORG).await.unwrap(), vec![later]);
        }
    }
}
