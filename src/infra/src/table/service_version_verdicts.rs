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

use config::meta::service_identity::scope_key;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, Iterable, JoinType, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, TransactionTrait,
    sea_query::{Expr, OnConflict},
};

use super::{
    entity::{
        service_version_verdict_metrics as metrics,
        service_version_verdicts::{Column, Entity, Model},
    },
    service_version_deploys::bounded_source_streams,
};
use crate::errors;

pub async fn put<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    mut row: Model,
    children: Vec<metrics::Model>,
) -> Result<bool, errors::Error> {
    let streams: Vec<String> = serde_json::from_str(&row.source_streams)?;
    let (streams, overflow) = bounded_source_streams(streams);
    row.source_streams = serde_json::to_string(&streams)?;
    row.source_streams_overflow |= overflow;
    validate(&row)?;
    validate_metrics(&row, &children)?;
    let txn = conn.begin().await?;
    if !super::service_versions::transition_above_floor(
        &txn,
        &row.org_id,
        &row.version_key,
        row.eval_start,
    )
    .await?
    {
        txn.commit().await?;
        return Ok(false);
    }
    // A frozen not_serving verdict may resume only when traffic starts a later evaluation.
    let conflict = OnConflict::column(Column::VerdictKey)
        .update_columns(Column::iter().filter(|column| !matches!(column, Column::VerdictKey | Column::SourceStreamsOverflow)))
        .value(Column::SourceStreamsOverflow, Expr::cust(
            "excluded.source_streams_overflow OR service_version_verdicts.source_streams_overflow"
        ))
        .action_and_where(Expr::cust(
            "excluded.org_id = service_version_verdicts.org_id AND (excluded.last_evaluated_at > service_version_verdicts.last_evaluated_at OR (excluded.last_evaluated_at = service_version_verdicts.last_evaluated_at AND service_version_verdicts.state = 'evaluating' AND excluded.state = 'frozen' AND excluded.reason_code = 'capped')) AND (service_version_verdicts.state != 'frozen' OR excluded.state = 'frozen' OR (service_version_verdicts.verdict = 'not_serving' AND excluded.verdict != 'not_serving' AND excluded.eval_start > service_version_verdicts.eval_start AND excluded.ns_first_requests_at IS NOT NULL AND excluded.ns_first_requests_at = excluded.eval_start AND excluded.ns_not_serving_since IS NULL))",
        ))
        .to_owned();
    let changed = Entity::insert(row.clone().into_active_model())
        .on_conflict(conflict)
        .exec_without_returning(&txn)
        .await?
        > 0;
    if changed {
        metrics::Entity::delete_many()
            .filter(metrics::Column::VerdictKey.eq(&row.verdict_key))
            .exec(&txn)
            .await?;
        for child in children {
            metrics::Entity::insert(child.into_active_model())
                .exec(&txn)
                .await?;
        }
    }
    txn.commit().await?;
    Ok(changed)
}

pub async fn put_fenced<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    region: &str,
    token: i64,
    row: Model,
    children: Vec<metrics::Model>,
) -> Result<bool, errors::Error> {
    if row.org_id != org_id || row.cluster != region {
        return Err(errors::Error::Message(
            "service verdict writer scope mismatch".into(),
        ));
    }
    let txn = conn.begin().await?;
    // The same regional fence protects deploy and verdict writes across owner takeover.
    super::service_version_deploys::put_fenced_batch(&txn, org_id, region, token, vec![]).await?;
    let changed = put(&txn, row, children).await?;
    txn.commit().await?;
    Ok(changed)
}

pub async fn put_admitted_fenced<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    token: i64,
    row: Model,
    children: Vec<metrics::Model>,
    eviction: Option<(Model, Vec<metrics::Model>)>,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;
    // The org fence serializes admissions without comparing independent regional tokens.
    super::service_version_deploys::put_fenced_batch(
        &txn,
        &row.org_id,
        &format!("__verdict_admission__:{}", row.org_id),
        0,
        vec![],
    )
    .await?;
    super::service_version_deploys::put_fenced_batch(
        &txn,
        &row.org_id,
        &row.cluster,
        token,
        vec![],
    )
    .await?;
    if let Some((victim, metrics)) = eviction {
        let current = get(&txn, &row.org_id, &victim.verdict_key).await?;
        if victim.org_id != row.org_id
            || victim.cluster != row.cluster
            || victim.verdict_key == row.verdict_key
            || victim.state != "frozen"
            || victim.reason_code != "capped"
            || !current.is_some_and(|old| old.state == "evaluating")
            || !put(&txn, victim, metrics).await?
        {
            return Err(errors::Error::Message(
                "verdict eviction lost admission slot".into(),
            ));
        }
    }
    let current = get(&txn, &row.org_id, &row.verdict_key).await?;
    if row.state == "evaluating" && current.is_none_or(|old| old.state != "evaluating") {
        let active = Entity::find()
            .filter(Column::OrgId.eq(&row.org_id))
            .filter(Column::State.eq("evaluating"))
            .count(&txn)
            .await?;
        // Every org is limited to 200 active evaluations, including resumptions.
        if active >= 200 {
            return Err(errors::Error::Message(
                "verdict admission capacity changed".into(),
            ));
        }
    }
    let changed = put(&txn, row, children).await?;
    if !changed {
        return Err(errors::Error::Message(
            "verdict admission write rejected".into(),
        ));
    }
    txn.commit().await?;
    Ok(changed)
}

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    verdict_key: &str,
) -> Result<Option<Model>, errors::Error> {
    let row = Entity::find_by_id(verdict_key)
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await?;
    if let Some(row) = &row {
        validate(row)?;
    }
    Ok(row)
}

pub async fn list_evaluating<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    cluster: &str,
) -> Result<Vec<Model>, errors::Error> {
    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Cluster.eq(cluster))
        .filter(Column::State.eq("evaluating"))
        .order_by_desc(Column::EvalPriority)
        .order_by_asc(Column::EvalStart)
        .all(conn)
        .await?;
    for row in &rows {
        validate(row)?;
    }
    Ok(rows)
}

/// Verdicts of one version text in a scope, every image unless `image` narrows to one.
pub async fn list_by_version<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    service_name: &str,
    where_key: &str,
    version: &str,
    image: Option<&str>,
) -> Result<Vec<Model>, errors::Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ScopeKey.eq(scope_key(org_id, service_name, where_key)))
        .filter(Column::Version.eq(version));
    if let Some(image) = image {
        query = query.filter(Column::Image.eq(image));
    }
    Ok(query
        .order_by_desc(Column::LastEvaluatedAt)
        .order_by_asc(Column::VerdictKey)
        .all(conn)
        .await?)
}

pub async fn metric_rows<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    verdict_key: &str,
) -> Result<Vec<metrics::Model>, errors::Error> {
    // One statement: a rewrite committed between two reads would mix two writes' rows.
    let rows = Entity::find_by_id(verdict_key)
        .filter(Column::OrgId.eq(org_id))
        .join(
            JoinType::LeftJoin,
            Entity::belongs_to(metrics::Entity)
                .from(Column::VerdictKey)
                .to(metrics::Column::VerdictKey)
                .into(),
        )
        .select_also(metrics::Entity)
        .order_by_asc(metrics::Column::Metric)
        .all(conn)
        .await?;
    let Some((parent, _)) = rows.first() else {
        return Ok(Vec::new());
    };
    validate(parent)?;
    let children: Vec<_> = rows.iter().filter_map(|(_, child)| child.clone()).collect();
    validate_metrics(parent, &children)?;
    Ok(children)
}

pub async fn delete_by_org<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let txn = conn.begin().await?;
    let parents = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(&txn)
        .await?;
    for parent in parents {
        metrics::Entity::delete_many()
            .filter(metrics::Column::VerdictKey.eq(parent.verdict_key))
            .exec(&txn)
            .await?;
    }
    let count = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?
        .rows_affected;
    txn.commit().await?;
    Ok(count)
}

pub async fn delete_for_deploys<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    deploy_keys: &[String],
) -> Result<u64, errors::Error> {
    let txn = conn.begin().await?;
    let mut count = 0;
    for keys in deploy_keys.chunks(super::service_versions::KEY_BATCH) {
        let parents = Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::DeployKey.is_in(keys.to_vec()))
            .all(&txn)
            .await?;
        let verdict_keys: Vec<_> = parents.into_iter().map(|row| row.verdict_key).collect();
        if verdict_keys.is_empty() {
            continue;
        }
        metrics::Entity::delete_many()
            .filter(metrics::Column::VerdictKey.is_in(verdict_keys.clone()))
            .exec(&txn)
            .await?;
        count += Entity::delete_many()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::VerdictKey.is_in(verdict_keys))
            .exec(&txn)
            .await?
            .rows_affected;
    }
    txn.commit().await?;
    Ok(count)
}

fn validate(row: &Model) -> Result<(), errors::Error> {
    if !matches!(row.state.as_str(), "evaluating" | "frozen")
        || !matches!(
            row.verdict.as_str(),
            "ok" | "insufficient" | "watch" | "not_serving" | "regressed"
        )
        || !matches!(row.signal.as_str(), "traces" | "rum")
        || !baseline_rule(&row.baseline_rule)
        || !baseline_rule(&row.baseline_rule_initial)
        || !reason_code(&row.reason_code)
        || row
            .reason
            .as_deref()
            .is_some_and(|value| !reason_code(value))
        || row
            .recheck_verdict
            .as_deref()
            .is_some_and(|value| !verdict_code(value))
        || row
            .rollback_outcome
            .as_deref()
            .is_some_and(|value| !matches!(value, "recovered" | "not_recovered" | "pending"))
        || row.baseline_switch_reason.as_deref().is_some_and(|value| {
            !matches!(
                value,
                "canary_drained" | "canary_below_min" | "canary_changed" | "baseline_redetected"
            )
        })
        || row
            .headline_ci_kind
            .as_deref()
            .is_some_and(|value| !matches!(value, "variance" | "sketch_band" | "histogram_band"))
        || [&row.headline_metric, &row.second_metric, &row.needs_metric]
            .into_iter()
            .flatten()
            .any(|value| !metric_code(value))
        || !matches!(row.deploy_kind.as_str(), "deploy" | "rollback" | "redeploy")
    {
        return Err(errors::Error::Message("unknown stored verdict code".into()));
    }
    if row.consecutive_regressed < 0
        || row.traces_consecutive_regressed < 0
        || row.rum_consecutive_regressed < 0
    {
        return Err(errors::Error::Message(
            "invalid stored verdict debounce".into(),
        ));
    }
    let streams: Vec<String> = serde_json::from_str(&row.source_streams)?;
    if streams.len() > 256 || streams.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(errors::Error::Message(
            "invalid stored source streams".into(),
        ));
    }
    Ok(())
}

fn verdict_code(value: &str) -> bool {
    matches!(
        value,
        "ok" | "insufficient" | "watch" | "not_serving" | "regressed"
    )
}

fn reason_code(value: &str) -> bool {
    matches!(
        value,
        "regressed_significant"
            | "new_error_types"
            | "within_good_band"
            | "below_min_effect"
            | "within_noise"
            | "improved"
            | "not_significant_yet"
            | "debounce_pending"
            | "minor_new_error"
            | "no_previous_version"
            | "below_min_count"
            | "capped"
            | "seen_in_k8s_no_requests"
            | "traffic_drop"
            | "pre_existing"
            | "rolled_back"
    )
}

fn metric_code(value: &str) -> bool {
    matches!(
        value,
        "requests"
            | "error_rate"
            | "p50"
            | "p95"
            | "p99"
            | "error_view_rate"
            | "lcp_p75"
            | "inp_p75"
            | "cls_p75"
            | "js_errors_per_1k_views"
            | "new_error_types"
    )
}

fn baseline_rule(value: &str) -> bool {
    matches!(value, "canary" | "previous" | "env_fallback" | "none")
}

fn validate_metrics(parent: &Model, children: &[metrics::Model]) -> Result<(), errors::Error> {
    let mut seen = std::collections::HashSet::new();
    for child in children {
        if child.verdict_key != parent.verdict_key
            || child.updated_at != parent.updated_at
            || !seen.insert(&child.metric)
            || !metric_code(&child.metric)
            || !matches!(
                child.ci_kind.as_str(),
                "variance" | "sketch_band" | "histogram_band" | "none"
            )
            || !matches!(
                child.badge.as_str(),
                "worse" | "possible" | "same" | "better" | "insufficient" | "info"
            )
            || [&child.band_new, &child.band_base]
                .into_iter()
                .flatten()
                .any(|value| !matches!(value.as_str(), "good" | "ni" | "poor"))
        {
            return Err(errors::Error::Message(
                "invalid stored verdict metric".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::migration::{
        create_service_identity_tables_for_test, sqlite_and_postgres_for_test,
    };

    // Commits a concurrent verdict rewrite right after the first read returns.
    struct WriteAfterFirstRead<'a> {
        inner: &'a sea_orm::DatabaseConnection,
        rewrite: std::sync::Mutex<Option<(Model, Vec<metrics::Model>)>>,
    }

    impl WriteAfterFirstRead<'_> {
        async fn write_once(&self) {
            let rewrite = self.rewrite.lock().unwrap().take();
            if let Some((row, children)) = rewrite {
                assert!(put(self.inner, row, children).await.unwrap());
            }
        }
    }

    #[async_trait::async_trait]
    impl ConnectionTrait for WriteAfterFirstRead<'_> {
        fn get_database_backend(&self) -> sea_orm::DbBackend {
            self.inner.get_database_backend()
        }

        async fn execute(
            &self,
            stmt: sea_orm::Statement,
        ) -> Result<sea_orm::ExecResult, sea_orm::DbErr> {
            self.inner.execute(stmt).await
        }

        async fn execute_unprepared(
            &self,
            sql: &str,
        ) -> Result<sea_orm::ExecResult, sea_orm::DbErr> {
            self.inner.execute_unprepared(sql).await
        }

        async fn query_one(
            &self,
            stmt: sea_orm::Statement,
        ) -> Result<Option<sea_orm::QueryResult>, sea_orm::DbErr> {
            let result = self.inner.query_one(stmt).await;
            self.write_once().await;
            result
        }

        async fn query_all(
            &self,
            stmt: sea_orm::Statement,
        ) -> Result<Vec<sea_orm::QueryResult>, sea_orm::DbErr> {
            let result = self.inner.query_all(stmt).await;
            self.write_once().await;
            result
        }
    }

    fn verdict() -> Model {
        Model {
            verdict_key: "verdict".into(),
            deploy_key: "deploy".into(),
            org_id: "org".into(),
            deploy_kind: "deploy".into(),
            state: "evaluating".into(),
            verdict: "watch".into(),
            reason_code: "debounce_pending".into(),
            signal: "traces".into(),
            baseline_rule: "previous".into(),
            baseline_rule_initial: "previous".into(),
            source_streams: "[]".into(),
            eval_start: 10,
            updated_at: 100,
            last_evaluated_at: 100,
            ..Default::default()
        }
    }

    #[test]
    fn every_baseline_switch_reason_is_a_valid_row() {
        for reason in [
            "canary_drained",
            "canary_below_min",
            "canary_changed",
            "baseline_redetected",
        ] {
            let row = Model {
                baseline_switched_at: Some(100),
                baseline_switch_reason: Some(reason.into()),
                ..verdict()
            };
            assert!(validate(&row).is_ok(), "{reason}");
        }
        let unknown = Model {
            baseline_switch_reason: Some("moved".into()),
            ..verdict()
        };
        assert!(validate(&unknown).is_err());
    }

    #[test]
    fn every_ci_kind_a_verdict_writes_is_a_valid_row() {
        for kind in ["variance", "sketch_band", "histogram_band"] {
            let row = Model {
                headline_ci_kind: Some(kind.into()),
                ..verdict()
            };
            assert!(validate(&row).is_ok(), "{kind}");
            let child = metrics::Model {
                ci_kind: kind.into(),
                updated_at: row.updated_at,
                ..metric(row.updated_at, 1.0)
            };
            assert!(validate_metrics(&row, &[child]).is_ok(), "{kind}");
        }
        let unknown = Model {
            headline_ci_kind: Some("bootstrap".into()),
            ..verdict()
        };
        assert!(validate(&unknown).is_err());
    }

    fn metric(updated_at: i64, new_value: f64) -> metrics::Model {
        metrics::Model {
            verdict_key: "verdict".into(),
            metric: "error_rate".into(),
            ci_kind: "variance".into(),
            badge: "possible".into(),
            new_value: Some(new_value),
            updated_at,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn admission_evicts_same_tick_and_guards_resumption_atomically() {
        for conn in sqlite_and_postgres_for_test("verdict_admission").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            for index in 0..200 {
                let mut row = verdict();
                row.verdict_key = format!("active-{index}");
                row.cluster = "region".into();
                row.last_evaluated_at = 200;
                row.updated_at = 200;
                assert!(put(&conn, row, vec![]).await.unwrap());
            }
            let mut resumed = verdict();
            resumed.verdict_key = "resumed".into();
            resumed.cluster = "region".into();
            resumed.state = "frozen".into();
            resumed.verdict = "not_serving".into();
            assert!(put(&conn, resumed.clone(), vec![]).await.unwrap());
            resumed.state = "evaluating".into();
            resumed.verdict = "watch".into();
            resumed.eval_start = 150;
            resumed.ns_first_requests_at = Some(150);
            resumed.last_evaluated_at = 200;
            resumed.updated_at = 200;
            assert!(
                put_admitted_fenced(&conn, 1, resumed.clone(), vec![], None)
                    .await
                    .is_err()
            );
            assert_eq!(
                get(&conn, "org", "resumed").await.unwrap().unwrap().state,
                "frozen"
            );
            let mut victim = get(&conn, "org", "active-0").await.unwrap().unwrap();
            victim.state = "frozen".into();
            victim.verdict = "insufficient".into();
            victim.reason_code = "capped".into();
            victim.reason = Some("capped".into());
            victim.frozen_at = Some(200);
            let mut invalid = resumed.clone();
            invalid.signal = "invalid".into();
            assert!(
                put_admitted_fenced(&conn, 1, invalid, vec![], Some((victim.clone(), vec![])))
                    .await
                    .is_err()
            );
            assert_eq!(
                get(&conn, "org", "active-0").await.unwrap().unwrap().state,
                "evaluating"
            );
            assert!(
                put_admitted_fenced(
                    &conn,
                    1,
                    resumed.clone(),
                    vec![],
                    Some((victim.clone(), vec![]))
                )
                .await
                .unwrap()
            );
            assert_eq!(
                list_evaluating(&conn, "org", "region").await.unwrap().len(),
                200
            );
            assert_eq!(
                get(&conn, "org", "active-0")
                    .await
                    .unwrap()
                    .unwrap()
                    .last_evaluated_at,
                200
            );
            let mut incoming = verdict();
            incoming.verdict_key = "incoming".into();
            incoming.cluster = "region".into();
            assert!(
                put_admitted_fenced(&conn, 1, incoming.clone(), vec![], Some((victim, vec![])))
                    .await
                    .is_err()
            );
            assert!(get(&conn, "org", "incoming").await.unwrap().is_none());
            incoming.cluster = "other-region".into();
            assert!(
                put_admitted_fenced(&conn, 1, incoming.clone(), vec![], None)
                    .await
                    .is_err()
            );
            Entity::delete_by_id("active-1").exec(&conn).await.unwrap();
            let mut competing = incoming.clone();
            competing.verdict_key = "competing".into();
            let (first, second) = tokio::join!(
                put_admitted_fenced(&conn, 1, incoming, vec![], None),
                put_admitted_fenced(&conn, 1, competing, vec![], None)
            );
            assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
            assert_eq!(
                Entity::find()
                    .filter(Column::OrgId.eq("org"))
                    .filter(Column::State.eq("evaluating"))
                    .count(&conn)
                    .await
                    .unwrap(),
                200
            );
        }
    }

    #[tokio::test]
    async fn per_section_debounce_survives_restart_on_both_databases() {
        for conn in sqlite_and_postgres_for_test("verdict_sections").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let mut row = verdict();
            row.traces_consecutive_regressed = 2;
            row.rum_consecutive_regressed = 1;
            assert!(put(&conn, row.clone(), vec![]).await.unwrap());
            assert_eq!(
                get(&conn, &row.org_id, &row.verdict_key).await.unwrap(),
                Some(row.clone())
            );
            row.traces_consecutive_regressed = -1;
            assert!(put(&conn, row, vec![]).await.is_err());
        }
    }

    #[tokio::test]
    async fn verdict_fence_rejects_stale_absent_parent_and_metric_updates() {
        for conn in sqlite_and_postgres_for_test("verdict_fence").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let mut row = verdict();
            row.cluster = "region".into();
            super::super::service_version_deploys::put_fenced_batch(
                &conn,
                "org",
                "region",
                20,
                vec![],
            )
            .await
            .unwrap();
            assert!(
                put_fenced(
                    &conn,
                    "org",
                    "region",
                    19,
                    row.clone(),
                    vec![metric(100, 0.1)]
                )
                .await
                .is_err()
            );
            assert!(get(&conn, "org", "verdict").await.unwrap().is_none());
            assert!(
                put_fenced(
                    &conn,
                    "org",
                    "region",
                    20,
                    row.clone(),
                    vec![metric(100, 0.1)]
                )
                .await
                .unwrap()
            );
            row.last_evaluated_at = 200;
            row.updated_at = 200;
            assert!(
                put_fenced(
                    &conn,
                    "org",
                    "region",
                    19,
                    row.clone(),
                    vec![metric(200, 0.9)]
                )
                .await
                .is_err()
            );
            assert_eq!(
                metric_rows(&conn, "org", "verdict").await.unwrap()[0].new_value,
                Some(0.1)
            );
            assert!(
                put_fenced(&conn, "other", "region", 21, row, vec![])
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn a_verdict_rewritten_between_reads_returns_one_consistent_set_of_metrics() {
        for conn in sqlite_and_postgres_for_test("verdict_reread").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            assert!(put(&conn, verdict(), vec![metric(100, 0.1)]).await.unwrap());
            let mut rewritten = verdict();
            rewritten.updated_at = 200;
            rewritten.last_evaluated_at = 200;
            let reader = WriteAfterFirstRead {
                inner: &conn,
                rewrite: std::sync::Mutex::new(Some((rewritten, vec![metric(200, 0.5)]))),
            };
            let read = metric_rows(&reader, "org", "verdict").await.unwrap();
            assert_eq!(
                read.iter()
                    .map(|row| (row.updated_at, row.new_value))
                    .collect::<Vec<_>>(),
                vec![(100, Some(0.1))]
            );
            assert!(reader.rewrite.lock().unwrap().is_none());
            assert_eq!(
                metric_rows(&conn, "org", "verdict").await.unwrap()[0].new_value,
                Some(0.5)
            );
        }
    }

    #[tokio::test]
    async fn verdict_metrics_lww_and_frozen_resume() {
        for conn in sqlite_and_postgres_for_test("verdict_atomic").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let mut row = verdict();
            assert!(
                put(&conn, row.clone(), vec![metric(100, 0.1)])
                    .await
                    .unwrap()
            );
            assert!(
                !put(&conn, row.clone(), vec![metric(100, 0.9)])
                    .await
                    .unwrap()
            );
            assert_eq!(
                metric_rows(&conn, "org", "verdict").await.unwrap()[0].new_value,
                Some(0.1)
            );
            assert!(get(&conn, "other", "verdict").await.unwrap().is_none());
            assert!(
                metric_rows(&conn, "other", "verdict")
                    .await
                    .unwrap()
                    .is_empty()
            );
            row.state = "frozen".into();
            row.verdict = "not_serving".into();
            row.updated_at = 200;
            row.last_evaluated_at = 200;
            row.frozen_at = Some(200);
            assert!(
                put(&conn, row.clone(), vec![metric(200, 0.0)])
                    .await
                    .unwrap()
            );
            let mut stale = row.clone();
            stale.state = "evaluating".into();
            stale.verdict = "watch".into();
            stale.updated_at = 300;
            stale.last_evaluated_at = 300;
            assert!(
                !put(&conn, stale.clone(), vec![metric(300, 0.3)])
                    .await
                    .unwrap()
            );
            assert_eq!(get(&conn, "org", "verdict").await.unwrap().unwrap(), row);
            stale.eval_start = 250;
            stale.ns_first_requests_at = Some(250);
            stale.frozen_at = None;
            assert!(
                put(&conn, stale.clone(), vec![metric(300, 0.3)])
                    .await
                    .unwrap()
            );
            assert_eq!(get(&conn, "org", "verdict").await.unwrap().unwrap(), stale);
            assert_eq!(delete_by_org(&conn, "other").await.unwrap(), 0);
            assert_eq!(delete_by_org(&conn, "org").await.unwrap(), 1);
            assert!(
                metric_rows(&conn, "org", "verdict")
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }

    #[tokio::test]
    async fn deploy_cascade_is_org_scoped_and_removes_metric_children() {
        for conn in sqlite_and_postgres_for_test("verdict_cascade").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let row = verdict();
            put(&conn, row.clone(), vec![metric(100, 0.1)])
                .await
                .unwrap();
            let keys = vec![row.deploy_key.clone()];
            assert_eq!(delete_for_deploys(&conn, "other", &keys).await.unwrap(), 0);
            assert!(get(&conn, "org", &row.verdict_key).await.unwrap().is_some());
            assert_eq!(delete_for_deploys(&conn, "org", &keys).await.unwrap(), 1);
            assert!(get(&conn, "org", &row.verdict_key).await.unwrap().is_none());
            assert!(metrics::Entity::find().all(&conn).await.unwrap().is_empty());
            assert_eq!(delete_for_deploys(&conn, "org", &keys).await.unwrap(), 0);
        }
    }

    #[tokio::test]
    async fn child_write_failure_rolls_back_parent_and_metrics() {
        for conn in sqlite_and_postgres_for_test("verdict_rollback").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let row = verdict();
            assert!(
                put(&conn, row.clone(), vec![metric(100, 0.1)])
                    .await
                    .unwrap()
            );
            conn.execute_unprepared("DROP TABLE service_version_verdict_metrics")
                .await
                .unwrap();
            let mut next = row.clone();
            next.updated_at = 200;
            next.last_evaluated_at = 200;
            assert!(put(&conn, next, vec![metric(200, 0.2)]).await.is_err());
            assert_eq!(get(&conn, "org", "verdict").await.unwrap().unwrap(), row);
        }
    }

    #[tokio::test]
    async fn ok_verdicts_within_noise_or_improved_are_stored() {
        for conn in sqlite_and_postgres_for_test("verdicts_ok_reasons").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            for reason in ["within_noise", "improved"] {
                let row = Model {
                    verdict_key: format!("verdict-{reason}"),
                    verdict: "ok".into(),
                    reason_code: reason.into(),
                    ..verdict()
                };
                put(&conn, row.clone(), Vec::new()).await.unwrap();
                let stored = get(&conn, "org", &row.verdict_key).await.unwrap().unwrap();
                assert_eq!(stored.reason_code, reason);
            }
        }
    }

    #[tokio::test]
    async fn version_reads_find_every_image_of_the_text_and_image_narrows_to_one() {
        for conn in sqlite_and_postgres_for_test("verdict_versions").await {
            create_service_identity_tables_for_test(&conn)
                .await
                .unwrap();
            let stored = [
                ("plain", "checkout", "2.4.0", None),
                ("img-a", "checkout", "2.4.0", Some("9c1e4b7")),
                ("img-b", "checkout", "2.4.0", Some("3f9c2ab")),
                ("longer", "checkout", "2.4.01", None),
                ("longer-img", "checkout", "2.4.01", Some("9c1e4b7")),
                ("case", "checkout", "V2.4.0", None),
                ("wild", "checkout", "2%4_0", Some("9c1e4b7")),
                ("other", "cart", "2.4.0", Some("9c1e4b7")),
            ];
            for (at, (key, service, version, image)) in (100..).zip(stored) {
                let row = Model {
                    verdict_key: key.into(),
                    version_key: key.into(),
                    scope_key: config::meta::service_identity::scope_key(
                        "org", service, "env:prod",
                    ),
                    service_name: service.into(),
                    where_key: "env:prod".into(),
                    version: version.into(),
                    image: image.map(str::to_string),
                    updated_at: at,
                    last_evaluated_at: at,
                    ..verdict()
                };
                put(&conn, row, Vec::new()).await.unwrap();
            }
            let read = async |version: &str, image: Option<&str>| {
                list_by_version(&conn, "org", "checkout", "env:prod", version, image)
                    .await
                    .unwrap()
                    .into_iter()
                    .map(|row| row.verdict_key)
                    .collect::<Vec<_>>()
            };
            assert_eq!(read("2.4.0", None).await, ["img-b", "img-a", "plain"]);
            assert_eq!(read("2.4.0", Some("9c1e4b7")).await, ["img-a"]);
            assert!(read("2.4.0", Some("0000000")).await.is_empty());
            assert_eq!(read("2.4.01", None).await, ["longer-img", "longer"]);
            assert_eq!(read("2%4_0", None).await, ["wild"]);
            assert!(read("2.4", None).await.is_empty());
            assert!(read("2.4.0", Some("9C1E4B7")).await.is_empty());
            let variant =
                list_by_version(&conn, "org", "Checkout.service", "env:prod", "2.4.0", None)
                    .await
                    .unwrap();
            assert_eq!(variant.len(), 3);
        }
    }
}
