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

//! Super-cluster facade for the service identity tables: every message is chunked.

use config::meta::service_identity::ServiceIdentityMessage;
use infra::{errors, table};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, TransactionTrait};
use serde::Serialize;

/// A message is cut before its 500th-and-one row, whatever its size.
pub const MAX_ROWS_PER_MESSAGE: usize = 500;

#[cfg(test)]
static SENT: std::sync::Mutex<Vec<ServiceIdentityMessage>> = std::sync::Mutex::new(Vec::new());

pub async fn apply_remote(org_id: &str, msg: ServiceIdentityMessage) -> Result<(), errors::Error> {
    apply_remote_with(infra::db::get_orm_client_rw().await, org_id, msg).await?;
    crate::service_identity::invalidate_summaries(org_id).await;
    crate::service_identity::invalidate_aliases(org_id).await;
    crate::service_identity::reload_org_with(infra::db::get_orm_client_rw().await, org_id).await;
    infra::coordinator::service_identity::emit_reload_event(org_id).await
}

pub async fn apply_remote_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    msg: ServiceIdentityMessage,
) -> Result<(), errors::Error> {
    if !org_of(&msg).is_empty() && org_of(&msg) != org_id {
        return Err(errors::Error::Message(
            "service identity organization mismatch".into(),
        ));
    }
    let txn = conn.begin().await?;
    match msg {
        ServiceIdentityMessage::VersionsPut { mut records, .. } => {
            records.sort_by(|a, b| a.version_key.cmp(&b.version_key));
            for row in &records {
                validate_org(org_id, &row.org_id)?;
                validate_version_key(
                    &row.org_id,
                    &row.service_name,
                    &row.where_key,
                    (&row.version, row.image.as_deref()),
                    &row.version_key,
                    &row.scope_key,
                )?;
            }
            for row in &records {
                if let Some(deleted_at) = row.deleted_at {
                    apply_version_delete(
                        &txn,
                        config::meta::service_identity::VersionDeletion {
                            org_id: row.org_id.clone(),
                            service_name: row.service_name.clone(),
                            where_key: row.where_key.clone(),
                            version: row.version.clone(),
                            image: row.image.clone(),
                            scope_key: row.scope_key.clone(),
                            version_key: row.version_key.clone(),
                            deleted_at,
                        },
                    )
                    .await?;
                }
            }
            table::service_versions::merge_upsert_many(&txn, records).await?;
        }
        ServiceIdentityMessage::VersionsDelete { records, .. } => {
            for row in records {
                validate_org(org_id, &row.org_id)?;
                validate_version_key(
                    &row.org_id,
                    &row.service_name,
                    &row.where_key,
                    (&row.version, row.image.as_deref()),
                    &row.version_key,
                    &row.scope_key,
                )?;
                apply_version_delete(&txn, row).await?;
            }
        }
        ServiceIdentityMessage::SummaryPut { rows } => {
            for row in &rows {
                validate_org(org_id, &row.org_id)?;
                if row.summary_key
                    != config::meta::service_identity::summary_key(
                        org_id,
                        &row.service_name,
                        &row.where_key,
                        &row.source_stream,
                    )
                    || row.scope_key
                        != config::meta::service_identity::scope_key(
                            org_id,
                            &row.service_name,
                            &row.where_key,
                        )
                {
                    return Err(errors::Error::Message(
                        "service summary key mismatch".into(),
                    ));
                }
            }
            table::service_where_summary::upsert_many(&txn, rows).await?;
        }
        ServiceIdentityMessage::OverridePut { row } => {
            validate_org(org_id, &row.org_id)?;
            table::service_identity_rules::upsert(&txn, &row).await?;
        }
        ServiceIdentityMessage::OverrideDelete {
            rule_key,
            updated_at,
            writer_cluster,
            ..
        } => {
            table::service_identity_rules::tombstone(
                &txn,
                org_id,
                &rule_key,
                updated_at,
                &writer_cluster,
            )
            .await?;
        }
        ServiceIdentityMessage::AliasPut { mut rows, .. } => {
            table::service_name_aliases::lock_org(&txn, org_id).await?;
            rows.sort_by(|a, b| a.alias_key.cmp(&b.alias_key));
            for row in rows {
                validate_org(org_id, &row.org_id)?;
                table::service_name_aliases::upsert(&txn, &row).await?;
            }
            table::service_name_aliases::recompute_conflicts(&txn, org_id).await?;
        }
        ServiceIdentityMessage::AliasDelete {
            alias_key,
            updated_at,
            writer_cluster,
            ..
        } => {
            table::service_name_aliases::lock_org(&txn, org_id).await?;
            table::service_name_aliases::tombstone(
                &txn,
                org_id,
                &alias_key,
                updated_at,
                &writer_cluster,
            )
            .await?;
            table::service_name_aliases::recompute_conflicts(&txn, org_id).await?;
        }
        ServiceIdentityMessage::DeployPut { rows, .. } => {
            for value in rows {
                let row: table::entity::service_version_deploys::Model =
                    serde_json::from_value(value)?;
                validate_org(org_id, &row.org_id)?;
                if above_floor(&txn, org_id, &row.to_version_key, row.at).await? {
                    table::service_version_deploys::put(&txn, row).await?;
                }
            }
        }
        ServiceIdentityMessage::VerdictPut { rows, metrics, .. } => {
            apply_verdicts(&txn, org_id, rows, metrics).await?;
        }
    }
    txn.commit().await?;
    Ok(())
}

pub fn verdict_metric_for_wire(
    org_id: &str,
    row: &table::entity::service_version_verdict_metrics::Model,
) -> Result<serde_json::Value, serde_json::Error> {
    let mut value = serde_json::to_value(row)?;
    value["org_id"] = org_id.into();
    Ok(value)
}

pub async fn publish(msg: ServiceIdentityMessage) {
    if let Err(error) = publish_checked(msg).await {
        log::error!("service identity replication failed: {error}");
    }
}

pub async fn publish_checked(msg: ServiceIdentityMessage) -> anyhow::Result<()> {
    if envelope_len(&msg)? > 512 * 1024 || message_rows(&msg)? > MAX_ROWS_PER_MESSAGE {
        dropped(org_of(&msg));
        return Ok(());
    }
    #[cfg(test)]
    SENT.lock()
        .unwrap_or_else(|error| error.into_inner())
        .push(msg.clone());
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled && !config::get_config().common.local_mode {
        o2_enterprise::enterprise::super_cluster::queue::service_identity(msg).await?;
    }
    Ok(())
}

pub async fn publish_chunked<T: Serialize>(
    rows: Vec<T>,
    max_bytes: usize,
    make: impl Fn(Vec<T>) -> ServiceIdentityMessage,
) {
    if let Err(error) = publish_chunked_checked(rows, max_bytes, make).await {
        log::error!("service identity batch replication failed: {error}");
    }
}

pub async fn publish_chunked_checked<T: Serialize>(
    rows: Vec<T>,
    max_bytes: usize,
    make: impl Fn(Vec<T>) -> ServiceIdentityMessage,
) -> anyhow::Result<()> {
    for message in chunk_messages(rows, max_bytes, make)? {
        publish_checked(message).await?;
    }
    Ok(())
}

pub fn chunk_messages<T: Serialize>(
    rows: Vec<T>,
    max_bytes: usize,
    make: impl Fn(Vec<T>) -> ServiceIdentityMessage,
) -> anyhow::Result<Vec<ServiceIdentityMessage>> {
    let mut messages = Vec::new();
    let empty = make(Vec::new());
    let base = envelope_len(&empty)?;
    let fixed_rows = message_rows(&empty)?;
    let budget = max_bytes.min(512 * 1024);
    let mut chunk = Vec::new();
    let mut bytes = base;
    for row in rows {
        let value = serde_json::to_value(&row)?;
        let size = serde_json::to_vec(&value)?.len();
        let org_extra = if org_of(&empty).is_empty() {
            value
                .get("org_id")
                .and_then(serde_json::Value::as_str)
                .map_or(0, str::len)
        } else {
            0
        };
        if base.saturating_add(size).saturating_add(org_extra) > budget
            || fixed_rows >= MAX_ROWS_PER_MESSAGE
        {
            dropped(org_of(&empty));
            continue;
        }
        if !chunk.is_empty()
            && (bytes + size + 1 + org_extra > budget
                || chunk.len() + fixed_rows >= MAX_ROWS_PER_MESSAGE)
        {
            messages.push(make(std::mem::take(&mut chunk)));
            bytes = base;
        }
        bytes += size + usize::from(!chunk.is_empty());
        chunk.push(row);
    }
    if !chunk.is_empty() {
        messages.push(make(chunk));
    }
    Ok(messages)
}

/// Splits `rows` in order; a row larger than `max_bytes` travels alone.
pub fn chunk_rows<T: Serialize>(rows: Vec<T>, max_bytes: usize, max_rows: usize) -> Vec<Vec<T>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_bytes = 0usize;
    for row in rows {
        let size = serde_json::to_vec(&row).map_or(0, |bytes| bytes.len());
        if !current.is_empty() && (current.len() >= max_rows || current_bytes + size > max_bytes) {
            chunks.push(std::mem::take(&mut current));
            current_bytes = 0;
        }
        current_bytes += size;
        current.push(row);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Messages recorded for `org_id` since the last call, oldest first.
#[cfg(test)]
pub(crate) fn take_sent(org_id: &str) -> Vec<ServiceIdentityMessage> {
    let mut sent = SENT.lock().unwrap_or_else(|e| e.into_inner());
    let (mine, rest) = std::mem::take(&mut *sent)
        .into_iter()
        .partition(|msg| org_of(msg) == org_id);
    *sent = rest;
    mine
}

fn org_of(msg: &ServiceIdentityMessage) -> &str {
    match msg {
        ServiceIdentityMessage::DeployPut { org_id, .. }
        | ServiceIdentityMessage::VerdictPut { org_id, .. }
        | ServiceIdentityMessage::VersionsPut { org_id, .. }
        | ServiceIdentityMessage::VersionsDelete { org_id, .. }
        | ServiceIdentityMessage::OverrideDelete { org_id, .. }
        | ServiceIdentityMessage::AliasPut { org_id, .. }
        | ServiceIdentityMessage::AliasDelete { org_id, .. } => org_id,
        ServiceIdentityMessage::OverridePut { row } => &row.org_id,
        ServiceIdentityMessage::SummaryPut { rows } => {
            rows.first().map_or("", |row| row.org_id.as_str())
        }
    }
}

fn envelope_len(msg: &ServiceIdentityMessage) -> anyhow::Result<usize> {
    let payload = serde_json::to_vec(msg)?;
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};
        let kind = if matches!(msg, ServiceIdentityMessage::SummaryPut { .. }) {
            MessageType::ServiceIdentitySummaryTable
        } else {
            MessageType::ServiceIdentityTable
        };
        let message = Message::new(
            format!("/service_identity/{}", org_of(msg)),
            Some(payload.into()),
            None,
            true,
            kind,
        );
        Ok(bytes::Bytes::try_from(&message)?.len())
    }
    #[cfg(not(feature = "enterprise"))]
    {
        Ok(payload.len() + 36 + org_of(msg).len() + config::get_cluster_name().len())
    }
}

fn message_rows(msg: &ServiceIdentityMessage) -> anyhow::Result<usize> {
    let value = serde_json::to_value(msg)?;
    let body = value
        .as_object()
        .and_then(|v| v.values().next())
        .ok_or_else(|| anyhow::anyhow!("invalid service identity envelope"))?;
    let arrays: [&str; 3] = ["records", "rows", "metrics"];
    let count = arrays
        .iter()
        .filter_map(|key| body.get(key).and_then(serde_json::Value::as_array))
        .map(Vec::len)
        .sum();
    Ok(if arrays.iter().any(|key| body.get(key).is_some()) {
        count
    } else {
        1
    })
}

fn dropped(org: &str) {
    config::metrics::SERVICE_VERSIONS_DROPPED_TOTAL
        .with_label_values(&[org, "replication_envelope"])
        .inc();
    log::error!("service identity replication skipped oversized envelope for {org}");
}

fn validate_version_key(
    org: &str,
    service: &str,
    place: &str,
    (version, image): (&str, Option<&str>),
    key: &str,
    scope: &str,
) -> Result<(), errors::Error> {
    use config::meta::service_identity::{scope_key, version_key_for};
    if key != version_key_for(org, service, place, version, image)
        || scope != scope_key(org, service, place)
    {
        return Err(errors::Error::Message(
            "service identity key mismatch".into(),
        ));
    }
    Ok(())
}

fn validate_org(expected: &str, actual: &str) -> Result<(), errors::Error> {
    if expected != actual {
        return Err(errors::Error::Message(
            "service identity organization mismatch".into(),
        ));
    }
    Ok(())
}

async fn above_floor<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    key: &str,
    at: i64,
) -> Result<bool, errors::Error> {
    conn.execute(sea_orm::Statement::from_sql_and_values(
        conn.get_database_backend(),
        "UPDATE service_versions SET updated_at = updated_at WHERE org_id = $1 AND version_key = $2",
        vec![org.into(), key.into()],
    )).await?;
    let rows = table::service_versions::get_by_keys(conn, org, &[key.into()]).await?;
    let Some(row) = rows.first() else {
        return Err(errors::Error::Message(
            "service identity registry parent not yet replicated".into(),
        ));
    };
    Ok(row.deleted_at.is_none_or(|floor| at > floor))
}

async fn apply_verdicts<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    rows: Vec<serde_json::Value>,
    metrics: Vec<serde_json::Value>,
) -> Result<(), errors::Error> {
    let rows: Vec<table::entity::service_version_verdicts::Model> = rows
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<_, _>>()?;
    for metric in &metrics {
        if let Some(metric_org) = metric.get("org_id") {
            validate_org(org, metric_org.as_str().unwrap_or_default())?;
        }
    }
    let metrics: Vec<table::entity::service_version_verdict_metrics::Model> = metrics
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<_, _>>()?;
    for child in &metrics {
        if !rows
            .iter()
            .any(|row| row.verdict_key == child.verdict_key && row.org_id == org)
        {
            return Err(errors::Error::Message(
                "orphan service verdict metric".into(),
            ));
        }
    }
    for row in rows {
        validate_org(org, &row.org_id)?;
        let children = metrics
            .iter()
            .filter(|child| child.verdict_key == row.verdict_key)
            .cloned()
            .collect();
        if above_floor(conn, org, &row.version_key, row.eval_start).await? {
            table::service_version_verdicts::put(conn, row, children).await?;
        }
    }
    Ok(())
}

async fn apply_version_delete<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    deletion: config::meta::service_identity::VersionDeletion,
) -> Result<(), errors::Error> {
    use config::meta::service_identity::{EnvSource, ServiceVersionRecord, WhereKind};
    use table::entity::{
        service_version_deploys as deploys, service_version_verdict_metrics as metrics,
        service_version_verdicts as verdicts,
    };
    let row = ServiceVersionRecord {
        org_id: deletion.org_id.clone(),
        service_name: deletion.service_name,
        where_key: deletion.where_key,
        version: deletion.version,
        scope_key: deletion.scope_key,
        version_key: deletion.version_key.clone(),
        where_kind: WhereKind::Env,
        k8s_cluster: String::new(),
        k8s_namespace: String::new(),
        env: String::new(),
        raw_version: None,
        version_source: String::new(),
        image: deletion.image,
        image_ref: None,
        env_source: EnvSource::Default,
        env_source_value: String::new(),
        first_seen: deletion.deleted_at,
        last_seen: 0,
        traces_first_seen: None,
        traces_last_seen: None,
        rum_first_seen: None,
        rum_last_seen: None,
        deleted_at: Some(deletion.deleted_at),
        created_at: deletion.deleted_at,
        updated_at: deletion.deleted_at,
    };
    table::service_versions::merge_upsert_many(conn, vec![row]).await?;
    let parents = verdicts::Entity::find()
        .filter(verdicts::Column::OrgId.eq(&deletion.org_id))
        .filter(verdicts::Column::VersionKey.eq(&deletion.version_key))
        .filter(verdicts::Column::EvalStart.lte(deletion.deleted_at))
        .all(conn)
        .await?;
    for parent in parents {
        metrics::Entity::delete_many()
            .filter(metrics::Column::VerdictKey.eq(&parent.verdict_key))
            .exec(conn)
            .await?;
        verdicts::Entity::delete_by_id(parent.verdict_key)
            .exec(conn)
            .await?;
    }
    deploys::Entity::delete_many()
        .filter(deploys::Column::OrgId.eq(deletion.org_id))
        .filter(deploys::Column::ToVersionKey.eq(deletion.version_key))
        .filter(deploys::Column::At.lte(deletion.deleted_at))
        .exec(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::{
        EnvSource, SIGNAL_TRACES, ServiceVersionObservation, ServiceVersionRecord, WhereKind,
    };

    use super::*;

    fn record(org_id: &str, version: &str, where_len: usize) -> ServiceVersionRecord {
        ServiceVersionObservation {
            service_name: "checkout".to_string(),
            where_key: format!("env:{}", "w".repeat(where_len)),
            where_kind: WhereKind::Env,
            k8s_cluster: String::new(),
            k8s_namespace: String::new(),
            env: "production".to_string(),
            env_source: EnvSource::Attribute,
            env_source_value: "deployment.environment=production".to_string(),
            version: version.to_string(),
            raw_version: Some(version.to_string()),
            version_source: "service.version".to_string(),
            image: None,
            image_ref: None,
            source_stream: "default".to_string(),
            signal: SIGNAL_TRACES.to_string(),
            first_seen: 1,
            last_seen: 2,
        }
        .to_record(org_id, 3)
    }

    fn sizes(msgs: &[ServiceIdentityMessage]) -> Vec<(usize, usize)> {
        msgs.iter()
            .map(|msg| match msg {
                ServiceIdentityMessage::VersionsPut { records, .. } => (
                    records.len(),
                    records
                        .iter()
                        .map(|r| serde_json::to_vec(r).unwrap().len())
                        .sum(),
                ),
                other => panic!("unexpected {other:?}"),
            })
            .collect()
    }

    fn deletion(row: &ServiceVersionRecord, at: i64) -> ServiceIdentityMessage {
        ServiceIdentityMessage::VersionsDelete {
            org_id: row.org_id.clone(),
            records: vec![config::meta::service_identity::VersionDeletion {
                org_id: row.org_id.clone(),
                service_name: row.service_name.clone(),
                where_key: row.where_key.clone(),
                scope_key: row.scope_key.clone(),
                version: row.version.clone(),
                image: row.image.clone(),
                version_key: row.version_key.clone(),
                deleted_at: at,
            }],
        }
    }

    async fn wire_apply(
        conn: &sea_orm::DatabaseConnection,
        org: &str,
        msg: ServiceIdentityMessage,
    ) {
        assert_eq!(org_of(&msg), org);
        #[cfg(feature = "enterprise")]
        apply_encoded(conn, msg).await.unwrap();
        #[cfg(not(feature = "enterprise"))]
        {
            let wire = serde_json::to_vec(&msg).unwrap();
            apply_remote_with(conn, org, serde_json::from_slice(&wire).unwrap())
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn remote_summary_and_override_retain_provenance_and_lww() {
        use config::meta::service_identity::{Override, OverrideScope, ServiceVersionObservation};
        for conn in table::service_versions::sqlite_and_postgres_for_tests("remote_summary").await {
            table::service_versions::create_tables_for_tests(&conn)
                .await
                .unwrap();
            let org = "remote_summary";
            let observation = ServiceVersionObservation {
                service_name: "checkout".into(),
                where_key: "env:production".into(),
                where_kind: WhereKind::Env,
                k8s_cluster: String::new(),
                k8s_namespace: String::new(),
                env: "production".into(),
                env_source: EnvSource::Attribute,
                env_source_value: "deployment.environment=production".into(),
                version: "v1".into(),
                raw_version: None,
                version_source: "service.version".into(),
                image: None,
                image_ref: None,
                source_stream: "source_a".into(),
                signal: SIGNAL_TRACES.into(),
                first_seen: 1,
                last_seen: 2,
            };
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::VersionsPut {
                    org_id: org.into(),
                    records: vec![observation.to_record(org, 3)],
                },
            )
            .await;
            let summary = observation.to_summary(org, &observation.to_record(org, 3), 3);
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::SummaryPut {
                    rows: vec![summary.clone()],
                },
            )
            .await;
            let summaries = table::service_where_summary::list_by_org(&conn, org)
                .await
                .unwrap();
            assert_eq!(summaries.len(), 1);
            assert_eq!(summaries[0].source_stream, "source_a");
            let key = config::meta::service_identity::rule_key(org, "service", "", "", "checkout");
            let row = Override {
                rule_key: key.clone(),
                org_id: org.into(),
                rule_type: "env_override".into(),
                scope: OverrideScope::Service,
                k8s_cluster: String::new(),
                where_key: String::new(),
                service_name: "checkout".into(),
                value: "production".into(),
                inferred_value: String::new(),
                inferred_source: EnvSource::Default,
                created_by: "user@example.com".into(),
                updated_by: "user@example.com".into(),
                created_at: 1,
                updated_at: 10,
                deleted_at: None,
                writer_cluster: "a".into(),
            };
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::OverrideDelete {
                    org_id: org.into(),
                    rule_key: key,
                    updated_at: 20,
                    writer_cluster: "z".into(),
                },
            )
            .await;
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::OverridePut { row: Box::new(row) },
            )
            .await;
            assert!(
                table::service_identity_rules::list(&conn, org)
                    .await
                    .unwrap()
                    .is_empty()
            );
            let invalid = ServiceIdentityMessage::SummaryPut {
                rows: vec![config::meta::service_identity::WhereSummaryRecord {
                    org_id: "other".into(),
                    ..summary
                }],
            };
            assert!(apply_remote_with(&conn, org, invalid).await.is_err());
        }
    }

    #[tokio::test]
    async fn remote_deploy_verdict_metrics_are_atomic_and_obey_delete_floor() {
        use table::entity::{
            service_version_deploys as deploys, service_version_verdict_metrics as metrics,
            service_version_verdicts as verdicts,
        };
        for conn in table::service_versions::sqlite_and_postgres_for_tests("remote_parent").await {
            table::service_versions::create_tables_for_tests(&conn)
                .await
                .unwrap();
            let org = "remote_parent";
            let registry = record(org, "v1", 8);
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::VersionsPut {
                    org_id: org.into(),
                    records: vec![registry.clone()],
                },
            )
            .await;
            let deploy = deploys::Model {
                deploy_key: sha256::digest(
                    serde_json::json!([
                        org,
                        registry.service_name,
                        registry.where_key,
                        "region",
                        "v1",
                        1
                    ])
                    .to_string(),
                ),
                org_id: org.into(),
                service_name: registry.service_name.clone(),
                where_key: registry.where_key.clone(),
                scope_key: registry.scope_key.clone(),
                cluster: "region".into(),
                to_version: "v1".into(),
                to_version_key: registry.version_key.clone(),
                kind: "deploy".into(),
                entry_source: "traffic".into(),
                at: 1,
                updated_at: 10,
                source_streams: "[]".into(),
                serving_versions: "[]".into(),
                full_serving: "[]".into(),
                ..Default::default()
            };
            let deploy_msg = ServiceIdentityMessage::DeployPut {
                org_id: org.into(),
                rows: vec![serde_json::to_value(&deploy).unwrap()],
            };
            wire_apply(&conn, org, deploy_msg.clone()).await;
            let verdict = verdicts::Model {
                verdict_key: "verdict".into(),
                deploy_key: deploy.deploy_key.clone(),
                org_id: org.into(),
                version_key: registry.version_key.clone(),
                deploy_kind: "deploy".into(),
                state: "evaluating".into(),
                verdict: "watch".into(),
                reason_code: "debounce_pending".into(),
                signal: "traces".into(),
                baseline_rule: "previous".into(),
                baseline_rule_initial: "previous".into(),
                source_streams: "[]".into(),
                eval_start: 1,
                updated_at: 10,
                last_evaluated_at: 10,
                ..Default::default()
            };
            let child = metrics::Model {
                verdict_key: "verdict".into(),
                metric: "error_rate".into(),
                ci_kind: "variance".into(),
                badge: "possible".into(),
                updated_at: 10,
                ..Default::default()
            };
            let msg = ServiceIdentityMessage::VerdictPut {
                org_id: org.into(),
                rows: vec![serde_json::to_value(&verdict).unwrap()],
                metrics: vec![verdict_metric_for_wire(org, &child).unwrap()],
            };
            wire_apply(&conn, org, msg.clone()).await;
            wire_apply(&conn, org, msg.clone()).await;
            let mut foreign_metric = verdict_metric_for_wire(org, &child).unwrap();
            foreign_metric["org_id"] = "other".into();
            assert!(
                apply_remote_with(
                    &conn,
                    org,
                    ServiceIdentityMessage::VerdictPut {
                        org_id: org.into(),
                        rows: vec![serde_json::to_value(&verdict).unwrap()],
                        metrics: vec![foreign_metric],
                    },
                )
                .await
                .is_err()
            );
            assert_eq!(
                table::service_version_verdicts::metric_rows(&conn, org, "verdict")
                    .await
                    .unwrap()
                    .len(),
                1
            );
            let mut newer = verdict.clone();
            newer.updated_at = 20;
            newer.last_evaluated_at = 20;
            let invalid = ServiceIdentityMessage::VerdictPut {
                org_id: org.into(),
                rows: vec![serde_json::to_value(newer).unwrap()],
                metrics: vec![verdict_metric_for_wire(org, &child).unwrap()],
            };
            assert!(apply_remote_with(&conn, org, invalid).await.is_err());
            assert_eq!(
                table::service_version_verdicts::get(&conn, org, "verdict")
                    .await
                    .unwrap()
                    .unwrap()
                    .updated_at,
                10
            );
            wire_apply(&conn, org, deletion(&registry, 30)).await;
            wire_apply(&conn, org, deploy_msg).await;
            wire_apply(&conn, org, msg).await;
            assert!(
                table::service_version_deploys::get(&conn, org, &deploy.deploy_key)
                    .await
                    .unwrap()
                    .is_none()
            );
            assert!(
                table::service_version_verdicts::get(&conn, org, "verdict")
                    .await
                    .unwrap()
                    .is_none()
            );
            assert!(
                metrics::Entity::find_by_id(("verdict".to_string(), "error_rate".to_string()))
                    .one(&conn)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[test]
    fn deploy_and_verdict_image_columns_are_additive_on_the_wire() {
        use table::entity::{service_version_deploys, service_version_verdicts};
        fn round_trip<
            T: serde::Serialize + serde::de::DeserializeOwned + PartialEq + std::fmt::Debug,
        >(
            row: &T,
            imageless: &T,
            fields: &[&str],
        ) {
            let mut value = serde_json::to_value(row).unwrap();
            for field in fields {
                assert!(value.get(*field).is_some(), "{field} rides the row");
            }
            value["field_from_a_newer_node"] = serde_json::json!({"x": 1});
            assert_eq!(&serde_json::from_value::<T>(value.clone()).unwrap(), row);
            let object = value.as_object_mut().unwrap();
            for field in fields {
                object.remove(*field);
            }
            assert_eq!(&serde_json::from_value::<T>(value).unwrap(), imageless);
        }
        let deploy = service_version_deploys::Model {
            deploy_key: "d".into(),
            to_version: "2.4.0".into(),
            to_image: Some("9c1e4b7".into()),
            from_version: Some("2.4.0".into()),
            from_image: Some("3f9c2ab".into()),
            ..Default::default()
        };
        round_trip(
            &deploy,
            &service_version_deploys::Model {
                to_image: None,
                from_image: None,
                ..deploy.clone()
            },
            &["to_image", "from_image"],
        );
        let verdict = service_version_verdicts::Model {
            verdict_key: "v".into(),
            version: "2.4.0".into(),
            image: Some("9c1e4b7".into()),
            baseline_version: Some("2.4.0".into()),
            baseline_image: Some("3f9c2ab".into()),
            baseline_image_initial: Some("3f9c2ab".into()),
            ..Default::default()
        };
        round_trip(
            &verdict,
            &service_version_verdicts::Model {
                image: None,
                baseline_image: None,
                baseline_image_initial: None,
                ..verdict.clone()
            },
            &["image", "baseline_image", "baseline_image_initial"],
        );
    }

    #[tokio::test]
    async fn remote_image_rows_put_and_delete_under_their_own_keys() {
        for conn in table::service_versions::sqlite_and_postgres_for_tests("remote_image").await {
            table::service_versions::create_tables_for_tests(&conn)
                .await
                .unwrap();
            let org = "remote_image";
            let rows: Vec<_> = ["3f9c2ab", "9c1e4b7"]
                .into_iter()
                .map(|image| {
                    let mut row = record(org, "2.4.0", 8);
                    row.image = Some(image.to_string());
                    row.version_key = config::meta::service_identity::version_key_for(
                        org,
                        &row.service_name,
                        &row.where_key,
                        &row.version,
                        Some(image),
                    );
                    row
                })
                .collect();
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::VersionsPut {
                    org_id: org.into(),
                    records: rows.clone(),
                },
            )
            .await;
            let keys: Vec<_> = rows.iter().map(|row| row.version_key.clone()).collect();
            let stored = table::service_versions::get_by_keys(&conn, org, &keys)
                .await
                .unwrap();
            assert_eq!(stored.len(), 2);
            wire_apply(&conn, org, deletion(&rows[0], 10)).await;
            let stored = table::service_versions::get_by_keys(&conn, org, &keys)
                .await
                .unwrap();
            assert_eq!(stored.iter().filter(|row| row.is_live()).count(), 1);
            let mut forged = rows[1].clone();
            forged.image = Some("0000000".to_string());
            let rejected = apply_remote_with(
                &conn,
                org,
                ServiceIdentityMessage::VersionsPut {
                    org_id: org.into(),
                    records: vec![forged],
                },
            )
            .await;
            assert!(
                rejected.is_err(),
                "a key that does not match its image is rejected"
            );
        }
    }

    #[tokio::test]
    async fn remote_delete_before_put_and_revival() {
        for conn in table::service_versions::sqlite_and_postgres_for_tests("remote_delete").await {
            table::service_versions::create_tables_for_tests(&conn)
                .await
                .unwrap();
            let org = "remote_delete";
            let row = record(org, "v1", 8);
            wire_apply(&conn, org, deletion(&row, 10)).await;
            let put = ServiceIdentityMessage::VersionsPut {
                org_id: org.into(),
                records: vec![row.clone()],
            };
            wire_apply(&conn, org, put.clone()).await;
            wire_apply(&conn, org, put).await;
            let stored = table::service_versions::get_by_keys(
                &conn,
                org,
                std::slice::from_ref(&row.version_key),
            )
            .await
            .unwrap();
            assert!(!stored[0].is_live());
            assert_eq!(stored[0].deleted_at, Some(10));
            let mut newer = row.clone();
            newer.first_seen = 20;
            newer.last_seen = 30;
            newer.updated_at = 30;
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::VersionsPut {
                    org_id: org.into(),
                    records: vec![newer],
                },
            )
            .await;
            let stored = table::service_versions::get_by_keys(
                &conn,
                org,
                std::slice::from_ref(&row.version_key),
            )
            .await
            .unwrap();
            assert!(stored[0].is_live());
            assert_eq!(stored[0].first_seen, 10);
            wire_apply(&conn, org, deletion(&row, 40)).await;
            assert!(
                !table::service_versions::get_by_keys(&conn, org, &[row.version_key])
                    .await
                    .unwrap()[0]
                    .is_live()
            );
        }
    }

    #[tokio::test]
    async fn remote_image_delete_before_put_resyncs_and_holds_an_older_put() {
        let sources =
            table::service_versions::sqlite_and_postgres_for_tests("remote_image_tomb").await;
        let targets =
            table::service_versions::sqlite_and_postgres_for_tests("remote_image_tomb_peer").await;
        for (source, target) in sources.into_iter().zip(targets) {
            for conn in [&source, &target] {
                table::service_versions::create_tables_for_tests(conn)
                    .await
                    .unwrap();
            }
            let org = "remote_image_tomb";
            let mut row = record(org, "2.4.0", 8);
            row.image = Some("3f9c2ab".to_string());
            row.version_key = config::meta::service_identity::version_key_for(
                org,
                &row.service_name,
                &row.where_key,
                &row.version,
                Some("3f9c2ab"),
            );
            let keys = std::slice::from_ref(&row.version_key);
            wire_apply(&source, org, deletion(&row, 10)).await;
            let stored = table::service_versions::get_by_keys(&source, org, keys)
                .await
                .unwrap();
            assert_eq!(stored[0].image.as_deref(), Some("3f9c2ab"));
            crate::service_identity_resync::walk(
                &source,
                config::utils::time::now_micros(),
                true,
                |message| {
                    let target = &target;
                    async move {
                        let bytes = serde_json::to_vec(&message)?;
                        apply_remote_with(target, org, serde_json::from_slice(&bytes)?).await?;
                        Ok(())
                    }
                },
            )
            .await
            .unwrap();
            wire_apply(
                &target,
                org,
                ServiceIdentityMessage::VersionsPut {
                    org_id: org.into(),
                    records: vec![row.clone()],
                },
            )
            .await;
            let stored = table::service_versions::get_by_keys(&target, org, keys)
                .await
                .unwrap();
            assert_eq!(stored.len(), 1);
            assert!(!stored[0].is_live());
            assert_eq!(stored[0].deleted_at, Some(10));
            assert_eq!(stored[0].image.as_deref(), Some("3f9c2ab"));
        }
    }

    #[tokio::test]
    async fn remote_alias_ignores_regional_fence_and_preserves_token() {
        use config::meta::service_identity::AliasRow;
        for conn in table::service_versions::sqlite_and_postgres_for_tests("remote_alias").await {
            table::service_versions::create_tables_for_tests(&conn)
                .await
                .unwrap();
            let org = "remote_alias";
            let key = config::meta::service_identity::alias_key(org, "service", "", "checkout");
            let mut row = AliasRow {
                alias_key: key,
                org_id: org.into(),
                canonical: "checkout".into(),
                origin: "learned".into(),
                status: "accepted".into(),
                updated_at: 10,
                fencing_token: 100,
                ..Default::default()
            };
            table::service_name_aliases::put_learned_batch(&conn, "region", 100, &[row.clone()])
                .await
                .unwrap();
            row.updated_at = 20;
            row.fencing_token = 1;
            row.canonical = "new".into();
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::AliasPut {
                    org_id: org.into(),
                    rows: vec![row.clone()],
                },
            )
            .await;
            let rows = table::service_name_aliases::list(&conn, org).await.unwrap();
            assert_eq!(rows[0].canonical, "new");
            assert_eq!(rows[0].fencing_token, 1);
            let result =
                table::service_name_aliases::put_learned_batch(&conn, "region", 99, &[]).await;
            assert!(result.is_err());
            row.updated_at = 21;
            let invalid = ServiceIdentityMessage::AliasPut {
                org_id: org.into(),
                rows: vec![AliasRow {
                    org_id: "other".into(),
                    ..row
                }],
            };
            assert!(apply_remote_with(&conn, org, invalid).await.is_err());
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::AliasDelete {
                    org_id: org.into(),
                    alias_key: rows[0].alias_key.clone(),
                    updated_at: 30,
                    writer_cluster: "z".into(),
                },
            )
            .await;
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::AliasPut {
                    org_id: org.into(),
                    rows,
                },
            )
            .await;
            assert_eq!(
                table::service_name_aliases::list(&conn, org).await.unwrap()[0].deleted_at,
                Some(30)
            );
            let mut remote = table::service_name_aliases::list(&conn, org)
                .await
                .unwrap()
                .remove(0);
            remote.updated_at = 40;
            remote.deleted_at = None;
            remote.fencing_token = 1000;
            wire_apply(
                &conn,
                org,
                ServiceIdentityMessage::AliasPut {
                    org_id: org.into(),
                    rows: vec![remote],
                },
            )
            .await;
            assert!(
                table::service_name_aliases::put_learned_batch(&conn, "region", 100, &[])
                    .await
                    .is_ok()
            );
        }
    }

    #[cfg(feature = "enterprise")]
    async fn apply_encoded(
        conn: &sea_orm::DatabaseConnection,
        message: ServiceIdentityMessage,
    ) -> anyhow::Result<()> {
        use o2_enterprise::enterprise::super_cluster::queue::{
            Message,
            service_identity::{decode, encode},
        };
        let bytes = encode(message)?
            .ok_or_else(|| anyhow::anyhow!("producer envelope unexpectedly skipped"))?;
        assert!(bytes.len() <= 512 * 1024);
        let (org, message) = decode(Message::try_from(&bytes)?)?
            .ok_or_else(|| anyhow::anyhow!("producer variant unexpectedly skipped"))?;
        apply_remote_with(conn, &org, message).await?;
        Ok(())
    }

    #[tokio::test]
    async fn complete_envelopes_include_metric_rows_and_skip_oversized_singletons() {
        let org = "envelope_bounds";
        let message = ServiceIdentityMessage::VerdictPut {
            org_id: org.into(),
            rows: vec![serde_json::json!({})],
            metrics: vec![serde_json::json!({}); 499],
        };
        publish_checked(message).await.unwrap();
        assert_eq!(take_sent(org).len(), 1);
        let message = ServiceIdentityMessage::VerdictPut {
            org_id: org.into(),
            rows: vec![serde_json::json!({})],
            metrics: vec![serde_json::json!({}); 500],
        };
        publish_checked(message).await.unwrap();
        assert!(take_sent(org).is_empty());
        publish_chunked(
            vec![record(org, "oversized", 600_000), record(org, "small", 8)],
            512 * 1024,
            |records| ServiceIdentityMessage::VersionsPut {
                org_id: org.into(),
                records,
            },
        )
        .await;
        let sent = take_sent(org);
        assert_eq!(sent.len(), 1);
        assert!(envelope_len(&sent[0]).unwrap() <= 512 * 1024);
        let ServiceIdentityMessage::VersionsPut { records, .. } = &sent[0] else {
            panic!("wrong message");
        };
        assert_eq!(records[0].version, "small");
    }

    #[tokio::test]
    async fn publish_chunks_at_msg_max_bytes_or_500_rows() {
        let org = "sync_chunks";
        let small: Vec<_> = (0..1201)
            .map(|i| record(org, &format!("v{i}"), 8))
            .collect();
        publish_chunked(small, 524_288, |records| {
            ServiceIdentityMessage::VersionsPut {
                org_id: org.to_string(),
                records,
            }
        })
        .await;
        let counts: Vec<usize> = sizes(&take_sent(org)).into_iter().map(|(n, _)| n).collect();
        assert_eq!(counts, vec![500, 500, 201], "row cap");

        let wide: Vec<_> = (0..10)
            .map(|i| record(org, &format!("v{i}"), 500))
            .collect();
        let row_bytes = serde_json::to_vec(&wide[0]).unwrap().len();
        let max_bytes = row_bytes * 3 + row_bytes / 2;
        publish_chunked(wide, max_bytes, |records| {
            ServiceIdentityMessage::VersionsPut {
                org_id: org.to_string(),
                records,
            }
        })
        .await;
        let sent = sizes(&take_sent(org));
        assert_eq!(
            sent.iter().map(|(n, _)| *n).collect::<Vec<_>>(),
            vec![3, 3, 3, 1],
            "byte cap"
        );
        assert!(sent.iter().all(|(_, bytes)| *bytes <= max_bytes));

        let huge = vec![record(org, "big", 4000), record(org, "next", 8)];
        let chunks = chunk_rows(huge, 1024, MAX_ROWS_PER_MESSAGE);
        assert_eq!(
            chunks.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![1, 1],
            "an oversized row travels alone"
        );
    }
}
