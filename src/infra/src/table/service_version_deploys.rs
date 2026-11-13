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
    ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, Iterable, QueryFilter, QueryOrder,
    QuerySelect, TransactionTrait,
    sea_query::{Expr, OnConflict},
};

use super::entity::service_version_deploys::{Column, Entity, Model};
use crate::errors;

#[derive(serde::Deserialize)]
struct ServingVersion {
    version: String,
    #[serde(default)]
    image: Option<String>,
    share: f64,
}

pub async fn put<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    mut row: Model,
) -> Result<bool, errors::Error> {
    let streams: Vec<String> = serde_json::from_str(&row.source_streams)?;
    let (streams, overflow) = bounded_source_streams(streams);
    row.source_streams = serde_json::to_string(&streams)?;
    row.source_streams_overflow |= overflow;
    validate(&row)?;
    let txn = conn.begin().await?;
    if !super::service_versions::transition_above_floor(
        &txn,
        &row.org_id,
        &row.to_version_key,
        row.at,
    )
    .await?
    {
        txn.commit().await?;
        return Ok(false);
    }
    let conflict = OnConflict::column(Column::DeployKey)
        .update_columns(Column::iter().filter(|column| !matches!(column, Column::DeployKey | Column::SourceStreamsOverflow)))
        .value(Column::SourceStreamsOverflow, Expr::cust(
            "excluded.source_streams_overflow OR service_version_deploys.source_streams_overflow"
        ))
        .action_and_where(Expr::cust(
            "excluded.updated_at > service_version_deploys.updated_at",
        ))
        .to_owned();
    let changed = Entity::insert(row.into_active_model())
        .on_conflict(conflict)
        .exec_without_returning(&txn)
        .await?
        > 0;
    txn.commit().await?;
    Ok(changed)
}

pub async fn put_batch<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    rows: Vec<Model>,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    for row in rows {
        put(&txn, row).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub async fn put_fenced_batch<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    region: &str,
    token: i64,
    rows: Vec<Model>,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    // Reusing the alias fence serializes every regional writer, including absent deploy keys.
    let statement = sea_orm::Statement::from_sql_and_values(
        txn.get_database_backend(),
        "INSERT INTO service_name_alias_fences (region, fencing_token) VALUES ($1, $2) ON CONFLICT (region) DO UPDATE SET fencing_token = excluded.fencing_token WHERE excluded.fencing_token >= service_name_alias_fences.fencing_token",
        vec![region.into(), token.into()],
    );
    if txn.execute(statement).await?.rows_affected() == 0 {
        return Err(errors::Error::Message(
            "service deploy ownership changed".into(),
        ));
    }
    for row in rows {
        if row.org_id != org_id || row.cluster != region {
            return Err(errors::Error::Message(
                "service deploy writer scope mismatch".into(),
            ));
        }
        put(&txn, row).await?;
    }
    txn.commit().await?;
    Ok(())
}

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    deploy_key: &str,
) -> Result<Option<Model>, errors::Error> {
    let row = Entity::find_by_id(deploy_key)
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await?;
    if let Some(row) = &row {
        validate(row)?;
    }
    Ok(row)
}

pub async fn history<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scope_key: &str,
    cluster: Option<&str>,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ScopeKey.eq(scope_key));
    if let Some(cluster) = cluster {
        query = query.filter(Column::Cluster.eq(cluster));
    }
    let rows = query
        .order_by_desc(Column::At)
        .order_by_asc(Column::DeployKey)
        .limit(limit)
        .all(conn)
        .await?;
    for row in &rows {
        validate(row)?;
    }
    Ok(rows)
}

pub async fn pending_verdicts<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    cluster: &str,
    limit: u64,
) -> Result<Vec<Model>, errors::Error> {
    // Assigned keys keep a crash before parent insertion discoverable.
    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Cluster.eq(cluster))
        .filter(Column::Kind.ne("pre_existing"))
        .filter(Column::VerdictKey.is_not_null())
        .filter(Expr::cust("NOT EXISTS (SELECT 1 FROM service_version_verdicts v WHERE v.org_id = service_version_deploys.org_id AND v.verdict_key = service_version_deploys.verdict_key)"))
        .order_by_asc(Column::At)
        .order_by_asc(Column::DeployKey)
        .limit(limit.min(super::service_versions::KEY_BATCH as u64))
        .all(conn)
        .await?;
    for row in &rows {
        validate(row)?;
    }
    Ok(rows)
}

pub async fn current<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    scope_key: &str,
    cluster: &str,
) -> Result<Option<Model>, errors::Error> {
    let row = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ScopeKey.eq(scope_key))
        .filter(Column::Cluster.eq(cluster))
        .filter(Column::SupersededAt.is_null())
        .order_by_desc(Column::At)
        .order_by_asc(Column::DeployKey)
        .one(conn)
        .await?;
    if let Some(row) = &row {
        validate(row)?;
    }
    Ok(row)
}

pub async fn delete_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?
        .rows_affected)
}

pub async fn purge_before<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    cutoff: i64,
    limit: u64,
) -> Result<u64, errors::Error> {
    let txn = conn.begin().await?;
    // A live serving snapshot must survive even after its transition ages out of retention.
    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SupersededAt.lt(cutoff))
        .filter(Column::UpdatedAt.lt(cutoff))
        .order_by_asc(Column::At)
        .limit(limit.min(super::service_versions::KEY_BATCH as u64))
        .all(&txn)
        .await?;
    let keys: Vec<_> = rows.into_iter().map(|row| row.deploy_key).collect();
    if keys.is_empty() {
        txn.commit().await?;
        return Ok(0);
    }
    super::service_version_verdicts::delete_for_deploys(&txn, org_id, &keys).await?;
    let count = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DeployKey.is_in(keys))
        .exec(&txn)
        .await?
        .rows_affected;
    txn.commit().await?;
    Ok(count)
}

pub fn bounded_source_streams(streams: impl IntoIterator<Item = String>) -> (Vec<String>, bool) {
    let mut streams: Vec<_> = streams
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    // Stored evidence is bounded while overflow requires org-wide stream read.
    let overflow = streams.len() > 256;
    streams.truncate(256);
    (streams, overflow)
}

pub fn evidence_readable(
    streams: &[String],
    overflow: bool,
    org_wide_read: bool,
    readable: &std::collections::HashSet<String>,
) -> bool {
    streams.iter().all(|stream| {
        stream.split_once('/').is_some_and(|(kind, name)| {
            matches!(kind, "traces" | "logs" | "metrics") && !name.is_empty()
        })
    }) && (org_wide_read || (!overflow && streams.iter().all(|stream| readable.contains(stream))))
}

fn validate(row: &Model) -> Result<(), errors::Error> {
    if !matches!(
        row.kind.as_str(),
        "deploy" | "rollback" | "redeploy" | "pre_existing"
    ) || !matches!(row.entry_source.as_str(), "traffic" | "k8s")
    {
        return Err(errors::Error::Message("unknown stored deploy code".into()));
    }
    let expected = sha256::digest(
        match &row.to_image {
            Some(image) => serde_json::json!([
                row.org_id,
                row.service_name,
                row.where_key,
                row.cluster,
                row.to_version,
                image,
                row.at
            ]),
            None => serde_json::json!([
                row.org_id,
                row.service_name,
                row.where_key,
                row.cluster,
                row.to_version,
                row.at
            ]),
        }
        .to_string(),
    );
    if expected != row.deploy_key {
        return Err(errors::Error::Message("invalid deploy key".into()));
    }
    validate_serving(row)?;
    let streams: Vec<String> = serde_json::from_str(&row.source_streams)?;
    if streams.len() > 256 || streams.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(errors::Error::Message(
            "invalid stored source streams".into(),
        ));
    }
    Ok(())
}

fn validate_serving(row: &Model) -> Result<(), errors::Error> {
    let full: Vec<ServingVersion> = serde_json::from_str(&row.full_serving)?;
    let displayed: Vec<ServingVersion> = serde_json::from_str(&row.serving_versions)?;
    let mut versions = std::collections::HashSet::new();
    let mut ranked: Vec<_> = full.iter().collect();
    ranked.sort_by(|a, b| {
        b.share
            .total_cmp(&a.share)
            .then(a.version.cmp(&b.version))
            .then(a.image.cmp(&b.image))
    });
    // The display cap must not erase the full detector membership needed after restart.
    if full.iter().any(|member| {
        member.version.is_empty()
            || !member.share.is_finite()
            || !(0.0..=1.0).contains(&member.share)
            || !versions.insert((&member.version, &member.image))
    }) || displayed.len() != full.len().min(10)
        || row.overflow_count != i32::try_from(full.len().saturating_sub(10)).unwrap_or(i32::MAX)
        || displayed
            .iter()
            .zip(ranked)
            .any(|(a, b)| a.version != b.version || a.image != b.image || a.share != b.share)
    {
        return Err(errors::Error::Message(
            "invalid stored serving state".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{bounded_source_streams, evidence_readable};

    #[test]
    fn typed_evidence_cannot_borrow_another_stream_types_grant() {
        let evidence = vec!["metrics/kube_pod_container_info".to_string()];
        let traces_only = HashSet::from(["traces/kube_pod_container_info".to_string()]);
        assert!(!evidence_readable(&evidence, false, false, &traces_only));
        let metrics = HashSet::from(["metrics/kube_pod_container_info".to_string()]);
        assert!(evidence_readable(&evidence, false, false, &metrics));
        for stream in ["kube_pod_container_info", "unknown/name", "traces/"] {
            let evidence = vec![stream.to_string()];
            let grants = HashSet::from([stream.to_string()]);
            assert!(!evidence_readable(&evidence, false, false, &grants));
            assert!(!evidence_readable(&evidence, false, true, &grants));
        }
    }

    #[test]
    fn restart_serving_state_preserves_hidden_members_and_rejects_corruption() {
        let full: Vec<_> = (0..12)
            .map(|index| serde_json::json!({"version": format!("v{index:02}"), "share": 0.06}))
            .collect();
        let mut row = super::Model {
            full_serving: serde_json::to_string(&full).unwrap(),
            serving_versions: serde_json::to_string(&full[..10]).unwrap(),
            overflow_count: 2,
            ..Default::default()
        };
        super::validate_serving(&row).unwrap();
        row.full_serving = row.serving_versions.clone();
        assert!(super::validate_serving(&row).is_err());
        row.full_serving = serde_json::to_string(&full).unwrap();
        row.serving_versions = serde_json::to_string(&full[2..]).unwrap();
        assert!(super::validate_serving(&row).is_err());
        row.full_serving = "null".into();
        assert!(super::validate_serving(&row).is_err());
    }

    #[test]
    fn seventeen_source_streams_remain_complete() {
        let input: Vec<_> = (0..17)
            .map(|index| format!("traces/stream-{index:03}"))
            .collect();
        let (stored, overflow) = bounded_source_streams(input.clone());
        assert_eq!(stored, input);
        assert!(!overflow);
        assert!(evidence_readable(
            &stored,
            overflow,
            false,
            &input.into_iter().collect()
        ));
    }

    #[test]
    fn overflow_requires_org_wide_read() {
        let input: Vec<_> = (0..257)
            .map(|index| format!("traces/stream-{index:03}"))
            .collect();
        let readable = input.iter().cloned().collect();
        let (stored, overflow) = bounded_source_streams(input);
        assert_eq!(stored.len(), 256);
        assert!(overflow);
        assert!(!evidence_readable(&stored, overflow, false, &readable));
        assert!(evidence_readable(&stored, overflow, true, &HashSet::new()));
    }

    #[test]
    fn source_streams_are_sorted_unique_and_require_every_grant() {
        let (stored, overflow) =
            bounded_source_streams(["traces/b", "traces/a", "traces/b"].map(str::to_owned));
        assert_eq!(stored, ["traces/a", "traces/b"]);
        assert!(!overflow);
        assert!(!evidence_readable(
            &stored,
            overflow,
            false,
            &HashSet::from(["traces/a".into()])
        ));
    }

    #[tokio::test]
    async fn regional_fence_rejects_stale_absent_key_and_retention_keeps_current() {
        use crate::table::migration::{
            create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
        };
        for conn in sqlite_and_postgres_for_test("deploy_lifecycle").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let key = sha256::digest(
                serde_json::json!(["org", "svc", "where", "region", "v2", 100]).to_string(),
            );
            let row = super::Model {
                deploy_key: key.clone(),
                org_id: "org".into(),
                service_name: "svc".into(),
                where_key: "where".into(),
                scope_key: "scope".into(),
                cluster: "region".into(),
                to_version: "v2".into(),
                kind: "deploy".into(),
                entry_source: "traffic".into(),
                at: 100,
                updated_at: 200,
                source_streams: "[]".into(),
                serving_versions: "[]".into(),
                full_serving: "[]".into(),
                ..Default::default()
            };
            super::put_fenced_batch(&conn, "org", "region", 20, vec![])
                .await
                .unwrap();
            assert!(
                super::put_fenced_batch(&conn, "org", "region", 19, vec![row.clone()])
                    .await
                    .is_err()
            );
            assert!(super::get(&conn, "org", &key).await.unwrap().is_none());
            super::put_fenced_batch(&conn, "org", "region", 20, vec![row.clone()])
                .await
                .unwrap();
            assert_eq!(
                super::purge_before(&conn, "org", 500, 100).await.unwrap(),
                0
            );
            let mut superseded = row;
            superseded.superseded_at = Some(250);
            superseded.updated_at = 300;
            super::put_fenced_batch(&conn, "org", "region", 21, vec![superseded])
                .await
                .unwrap();
            assert_eq!(
                super::purge_before(&conn, "other", 500, 100).await.unwrap(),
                0
            );
            assert_eq!(
                super::purge_before(&conn, "org", 500, 100).await.unwrap(),
                1
            );
            assert!(super::get(&conn, "org", &key).await.unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn assigned_verdict_key_survives_crash_and_discovers_only_missing_parent() {
        use sea_orm::{EntityTrait, IntoActiveModel};

        use crate::table::migration::{
            create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
        };

        for conn in sqlite_and_postgres_for_test("deploy_discovery").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let deploy_key = sha256::digest(
                serde_json::json!(["org", "svc", "where", "region", "v2", 100]).to_string(),
            );
            let verdict_key = sha256::digest(serde_json::json!(["org", deploy_key]).to_string());
            let row = super::Model {
                deploy_key: deploy_key.clone(),
                org_id: "org".into(),
                service_name: "svc".into(),
                where_key: "where".into(),
                scope_key: "scope".into(),
                cluster: "region".into(),
                to_version: "v2".into(),
                kind: "deploy".into(),
                entry_source: "traffic".into(),
                at: 100,
                updated_at: 200,
                source_streams: "[]".into(),
                serving_versions: "[]".into(),
                full_serving: "[]".into(),
                verdict_key: Some(verdict_key.clone()),
                ..Default::default()
            };
            super::put(&conn, row.clone()).await.unwrap();
            assert_eq!(
                super::pending_verdicts(&conn, "org", "region", 100)
                    .await
                    .unwrap(),
                vec![row.clone()]
            );
            assert!(
                super::pending_verdicts(&conn, "other", "region", 100)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(
                super::pending_verdicts(&conn, "org", "other", 100)
                    .await
                    .unwrap()
                    .is_empty()
            );
            let parent = crate::table::entity::service_version_verdicts::Model {
                verdict_key: verdict_key.clone(),
                org_id: "other".into(),
                ..Default::default()
            };
            crate::table::entity::service_version_verdicts::Entity::insert(
                parent.clone().into_active_model(),
            )
            .exec(&conn)
            .await
            .unwrap();
            assert_eq!(
                super::pending_verdicts(&conn, "org", "region", 100)
                    .await
                    .unwrap()
                    .len(),
                1
            );
            crate::table::entity::service_version_verdicts::Entity::delete_by_id(
                verdict_key.clone(),
            )
            .exec(&conn)
            .await
            .unwrap();
            let parent = crate::table::entity::service_version_verdicts::Model {
                org_id: "org".into(),
                ..parent
            };
            crate::table::entity::service_version_verdicts::Entity::insert(
                parent.into_active_model(),
            )
            .exec(&conn)
            .await
            .unwrap();
            assert!(
                super::pending_verdicts(&conn, "org", "region", 100)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(!super::put(&conn, row).await.unwrap());
            assert!(
                super::pending_verdicts(&conn, "org", "region", 100)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[tokio::test]
    async fn deploy_evidence_round_trip_and_org_isolation() {
        use super::{Model, get, history, put};
        use crate::table::migration::{
            create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
        };

        for conn in sqlite_and_postgres_for_test("deploy_evidence").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let key = sha256::digest(
                serde_json::json!(["org", "svc", "where", "region", "v2", 100]).to_string(),
            );
            let mut row = Model {
                deploy_key: key.clone(),
                org_id: "org".into(),
                service_name: "svc".into(),
                where_key: "where".into(),
                scope_key: "scope".into(),
                cluster: "region".into(),
                to_version: "v2".into(),
                kind: "deploy".into(),
                entry_source: "traffic".into(),
                at: 100,
                updated_at: 200,
                serving_versions: "[]".into(),
                full_serving: "[]".into(),
                source_streams: serde_json::to_string(
                    &(0..17)
                        .map(|i| format!("traces/stream-{i:03}"))
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
                ..Default::default()
            };
            assert!(put(&conn, row.clone()).await.unwrap());
            let stored = get(&conn, "org", &key).await.unwrap().unwrap();
            assert_eq!(
                serde_json::from_str::<Vec<String>>(&stored.source_streams)
                    .unwrap()
                    .len(),
                17
            );
            assert!(!stored.source_streams_overflow);
            assert!(get(&conn, "other", &key).await.unwrap().is_none());
            assert!(
                history(&conn, "other", "scope", None, 10)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert!(!put(&conn, row.clone()).await.unwrap());
            row.updated_at = 300;
            row.source_streams = serde_json::to_string(
                &(0..257)
                    .map(|i| format!("traces/stream-{i:03}"))
                    .collect::<Vec<_>>(),
            )
            .unwrap();
            assert!(put(&conn, row).await.unwrap());
            let stored = get(&conn, "org", &key).await.unwrap().unwrap();
            let streams: Vec<String> = serde_json::from_str(&stored.source_streams).unwrap();
            assert_eq!(streams.len(), 256);
            assert!(stored.source_streams_overflow);
            assert!(!evidence_readable(
                &streams,
                true,
                false,
                &streams.iter().cloned().collect()
            ));
            let mut restored = stored;
            restored.source_streams_overflow = false;
            restored.updated_at += 1;
            assert!(put(&conn, restored).await.unwrap());
            assert!(
                get(&conn, "org", &key)
                    .await
                    .unwrap()
                    .unwrap()
                    .source_streams_overflow
            );
        }
    }
}
