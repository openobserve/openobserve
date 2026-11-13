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

use std::future::Future;

use config::meta::service_identity::{
    AliasRow, Override, ServiceIdentityMessage as Message, ServiceVersionRecord, WhereSummaryRecord,
};
use infra::{errors, table::entity};
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, TransactionTrait};
use serde::Serialize;

const DAY: i64 = 86_400_000_000;
const TABLES: [(&str, &str, &str, i64); 6] = [
    ("service_versions", "version_key", "updated_at", 7),
    ("service_identity_rules", "rule_key", "updated_at", 0),
    ("service_name_aliases", "alias_key", "updated_at", 0),
    ("service_version_deploys", "deploy_key", "updated_at", 2),
    (
        "service_version_verdicts",
        "verdict_key",
        "last_evaluated_at",
        2,
    ),
    ("service_where_summary", "summary_key", "updated_at", 0),
];

pub async fn daily() -> anyhow::Result<()> {
    #[cfg(not(feature = "enterprise"))]
    {
        Ok(())
    }
    #[cfg(feature = "enterprise")]
    {
        if !o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
            || config::get_config().common.local_mode
        {
            return Ok(());
        }
        let lock = infra::dist_lock::lock("/service_signals/resync_lock", 0).await?;
        let result = run().await;
        let unlock = infra::dist_lock::unlock(&lock).await;
        result?;
        unlock?;
        Ok(())
    }
}

pub async fn walk<C, F, Fut>(conn: &C, now: i64, full: bool, send: F) -> anyhow::Result<()>
where
    C: ConnectionTrait + TransactionTrait,
    F: Fn(Message) -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    let org_sql = TABLES
        .iter()
        .map(|(table, ..)| format!("SELECT org_id FROM {table}"))
        .collect::<Vec<_>>()
        .join(" UNION ");
    let orgs = conn
        .query_all(Statement::from_string(conn.get_database_backend(), org_sql))
        .await?;
    for org in orgs {
        let org: String = org.try_get("", "org_id")?;
        for (table, key, time, days) in TABLES {
            let since = if full || days == 0 {
                i64::MIN
            } else {
                now.saturating_sub(days * DAY)
            };
            let mut cursor = String::new();
            loop {
                let sql = format!(
                    "SELECT * FROM {table} WHERE org_id=$1 AND {key}>$2 AND {time}>=$3 ORDER BY {key} LIMIT 500"
                );
                let rows = conn
                    .query_all(Statement::from_sql_and_values(
                        conn.get_database_backend(),
                        sql,
                        vec![org.clone().into(), cursor.clone().into(), since.into()],
                    ))
                    .await?;
                let count = rows.len();
                if let Some(last) = rows.last() {
                    cursor = last.try_get("", key)?;
                }
                if let Some(messages) = batches(&org, table, &rows)? {
                    for message in messages {
                        send(message).await?;
                    }
                } else {
                    for row in rows {
                        let message = message(conn, &org, table, &row).await?;
                        if let Some(message) = message {
                            send(message).await?;
                        }
                    }
                }
                if count < 500 {
                    break;
                }
            }
        }
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
async fn run() -> anyhow::Result<()> {
    let store = infra::db::get_db().await;
    let full = store
        .get_with_revision("/service_signals/resync_done/v97")
        .await?
        .is_none();
    let now = config::utils::time::now_micros();
    if !full
        && let Some((last, _)) = store
            .get_with_revision("/service_signals/resync_last")
            .await?
    {
        let last: i64 = std::str::from_utf8(&last)?.parse()?;
        if now.saturating_sub(last) < DAY {
            return Ok(());
        }
    }
    walk(
        infra::db::get_orm_client_rw().await,
        now,
        full,
        |message| async move {
            crate::service_identity_sync::publish_checked(message).await?;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            Ok(())
        },
    )
    .await?;
    store
        .put(
            "/service_signals/resync_done/v97",
            bytes::Bytes::from_static(b"1"),
            false,
            None,
        )
        .await?;
    store
        .put(
            "/service_signals/resync_last",
            now.to_string().into(),
            false,
            None,
        )
        .await?;
    Ok(())
}

fn batches(
    org: &str,
    table: &str,
    rows: &[sea_orm::QueryResult],
) -> anyhow::Result<Option<Vec<Message>>> {
    use crate::service_identity_sync::chunk_messages;
    Ok(Some(match table {
        "service_versions" => chunk_messages(
            rows.iter()
                .map(convert::<entity::service_versions::Model, ServiceVersionRecord>)
                .collect::<Result<Vec<_>, _>>()?,
            512 * 1024,
            |records| Message::VersionsPut {
                org_id: org.into(),
                records,
            },
        )?,
        "service_name_aliases" => chunk_messages(
            rows.iter()
                .map(convert::<entity::service_name_aliases::Model, AliasRow>)
                .collect::<Result<Vec<_>, _>>()?,
            512 * 1024,
            |rows| Message::AliasPut {
                org_id: org.into(),
                rows,
            },
        )?,
        "service_where_summary" => chunk_messages(
            rows.iter()
                .map(convert::<entity::service_where_summary::Model, WhereSummaryRecord>)
                .collect::<Result<Vec<_>, _>>()?,
            512 * 1024,
            |rows| Message::SummaryPut { rows },
        )?,
        "service_version_deploys" => chunk_messages(
            rows.iter()
                .map(|row| {
                    Ok(serde_json::to_value(
                        entity::service_version_deploys::Model::from_query_result(row, "")?,
                    )?)
                })
                .collect::<anyhow::Result<Vec<_>>>()?,
            512 * 1024,
            |rows| Message::DeployPut {
                org_id: org.into(),
                rows,
            },
        )?,
        _ => return Ok(None),
    }))
}

async fn message<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    table: &str,
    row: &sea_orm::QueryResult,
) -> anyhow::Result<Option<Message>> {
    Ok(Some(match table {
        "service_versions" => Message::VersionsPut {
            org_id: org.into(),
            records: vec![convert::<
                entity::service_versions::Model,
                ServiceVersionRecord,
            >(row)?],
        },
        "service_identity_rules" => {
            let model = entity::service_identity_rules::Model::from_query_result(row, "")?;
            if model.deleted_at.is_some() {
                Message::OverrideDelete {
                    org_id: org.into(),
                    rule_key: model.rule_key,
                    updated_at: model.updated_at,
                    writer_cluster: model.writer_cluster,
                }
            } else {
                Message::OverridePut {
                    row: Box::new(serde_json::from_value::<Override>(serde_json::to_value(
                        model,
                    )?)?),
                }
            }
        }
        "service_name_aliases" => Message::AliasPut {
            org_id: org.into(),
            rows: vec![convert::<entity::service_name_aliases::Model, AliasRow>(
                row,
            )?],
        },
        "service_version_deploys" => Message::DeployPut {
            org_id: org.into(),
            rows: vec![serde_json::to_value(
                entity::service_version_deploys::Model::from_query_result(row, "")?,
            )?],
        },
        "service_where_summary" => Message::SummaryPut {
            rows: vec![convert::<
                entity::service_where_summary::Model,
                WhereSummaryRecord,
            >(row)?],
        },
        "service_version_verdicts" => {
            let key: String = row.try_get("", "verdict_key")?;
            let txn = conn.begin().await?;
            txn.execute(Statement::from_sql_and_values(txn.get_database_backend(),"UPDATE service_version_verdicts SET updated_at=updated_at WHERE org_id=$1 AND verdict_key=$2",vec![org.into(),key.clone().into()])).await?;
            let Some(parent) = infra::table::service_version_verdicts::get(&txn, org, &key).await?
            else {
                txn.commit().await?;
                return Ok(None);
            };
            let metrics =
                infra::table::service_version_verdicts::metric_rows(&txn, org, &key).await?;
            txn.commit().await?;
            Message::VerdictPut {
                org_id: org.into(),
                rows: vec![serde_json::to_value(parent)?],
                metrics: metrics
                    .into_iter()
                    .map(|row| crate::service_identity_sync::verdict_metric_for_wire(org, &row))
                    .collect::<Result<_, _>>()?,
            }
        }
        _ => {
            return Err(
                errors::Error::Message("unknown service identity resync table".into()).into(),
            );
        }
    }))
}

fn convert<M: FromQueryResult + Serialize, T: serde::de::DeserializeOwned>(
    row: &sea_orm::QueryResult,
) -> anyhow::Result<T> {
    Ok(serde_json::from_value(serde_json::to_value(
        M::from_query_result(row, "")?,
    )?)?)
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{EnvSource, ServiceVersionObservation, WhereKind};

    use super::*;

    #[tokio::test]
    async fn resync_repairs_lost_publications_and_propagates_transport_failure() {
        let sources =
            infra::table::service_versions::sqlite_and_postgres_for_tests("resync_source").await;
        let targets =
            infra::table::service_versions::sqlite_and_postgres_for_tests("resync_target").await;
        for (source, target) in sources.into_iter().zip(targets) {
            infra::table::service_versions::create_tables_for_tests(&source)
                .await
                .unwrap();
            infra::table::service_versions::create_tables_for_tests(&target)
                .await
                .unwrap();
            let org = "resync_fixture";
            let observation = ServiceVersionObservation {
                service_name: "checkout".into(),
                where_key: "env:prod".into(),
                where_kind: WhereKind::Env,
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "prod".into(),
                env_source: EnvSource::Attribute,
                env_source_value: "deployment.environment=prod".into(),
                version: "v1".into(),
                raw_version: None,
                version_source: "service.version".into(),
                image: None,
                image_ref: None,
                source_stream: "spans".into(),
                signal: "traces".into(),
                first_seen: 1,
                last_seen: 2,
            };
            let record = observation.to_record(org, 3);
            infra::table::service_versions::merge_upsert_many(&source, vec![record.clone()])
                .await
                .unwrap();
            infra::table::service_where_summary::upsert_many(
                &source,
                vec![observation.to_summary(org, &record, 3)],
            )
            .await
            .unwrap();
            infra::table::service_identity_rules::tombstone(
                &source,
                org,
                "deleted-rule",
                4,
                "region",
            )
            .await
            .unwrap();
            let failed = walk(&source, 10 * DAY, true, |_| async {
                Err(anyhow::anyhow!("simulated unavailable transport"))
            })
            .await;
            assert!(failed.is_err());
            walk(&source, 10 * DAY, true, |message| {
                let target = &target;
                async move {
                    let bytes = serde_json::to_vec(&message)?;
                    let message = serde_json::from_slice(&bytes)?;
                    crate::service_identity_sync::apply_remote_with(target, org, message).await?;
                    Ok(())
                }
            })
            .await
            .unwrap();
            let rows = infra::table::service_versions::get_by_keys(
                &target,
                org,
                std::slice::from_ref(&record.version_key),
            )
            .await
            .unwrap();
            assert_eq!(rows, vec![record]);
            let summaries = infra::table::service_where_summary::list_by_org(&target, org)
                .await
                .unwrap();
            assert_eq!(summaries[0].source_stream, "spans");
            assert!(
                infra::table::service_identity_rules::list(&target, org)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
    }
}
