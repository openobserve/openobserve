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

use std::collections::BTreeMap;

use config::meta::service_identity::{ServiceIdentityMessage, VersionDeletion};
use infra::{
    db::get_orm_client_rw,
    table::{
        self,
        entity::{
            service_version_deploys as deploys, service_version_verdicts as verdicts,
            service_where_summary as summaries,
        },
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
    sea_query::Expr,
};

const DAY: i64 = 86_400_000_000;
// Each purge transaction is bounded to avoid monopolizing the metadata writer.
const BATCH: u64 = 1000;
const KEEP_NEWEST: usize = 20;

pub async fn daily(org: &str, now: i64) -> anyhow::Result<()> {
    let key = format!("/service_signals/purge_last/{org}");
    let store = infra::db::get_db().await;
    if let Some((last, _)) = store.get_with_revision(&key).await? {
        let last: i64 = std::str::from_utf8(&last)?.parse()?;
        if now.saturating_sub(last) < DAY {
            return Ok(());
        }
    }
    let cutoff = now.saturating_sub(days(
        o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_JUNK_TTL_DAYS,
    ));
    loop {
        let keys = table::service_versions::purge_candidates_since(
            get_orm_client_rw().await,
            org,
            cutoff,
            now.saturating_sub(days(
                o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_DEPLOYS_RETENTION_DAYS,
            )),
            BATCH,
        )
        .await?;
        if keys.is_empty() {
            break;
        }
        let changed = tombstone(org, keys, cutoff, now, true).await?;
        if changed == 0 {
            break;
        }
    }
    if o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_VERSIONS_RETENTION_DAYS != 0 {
        aged_registry(
            org,
            now.saturating_sub(days(
                o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_VERSIONS_RETENTION_DAYS,
            )),
            o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_VERSIONS_KEEP_NEWEST,
            now,
        )
        .await?;
    }
    retained_history(org, now).await?;
    let cutoff = now.saturating_sub(30 * DAY);
    while table::service_identity_rules::purge_tombstones(get_orm_client_rw().await, org, cutoff)
        .await?
        == BATCH
    {}

    while table::service_versions::hard_delete_tombstones(
        get_orm_client_rw().await,
        org,
        cutoff,
        BATCH,
    )
    .await?
        == BATCH
    {}
    db::service_identity::invalidate_summaries(org).await;
    store.put(&key, now.to_string().into(), false, None).await?;
    Ok(())
}

async fn tombstone(
    org: &str,
    mut keys: Vec<String>,
    cutoff: i64,
    now: i64,
    protect_served: bool,
) -> anyhow::Result<usize> {
    let txn = get_orm_client_rw().await.begin().await?;
    let mut deleted = Vec::new();
    keys.sort();
    for key in keys {
        table::service_versions::transition_above_floor(&txn, org, &key, i64::MAX).await?;
        let current =
            table::service_versions::get_by_keys(&txn, org, std::slice::from_ref(&key)).await?;
        if !current
            .first()
            .is_some_and(|row| row.is_live() && row.last_seen < cutoff)
        {
            continue;
        }
        if protect_served
            && deploys::Entity::find()
                .filter(deploys::Column::OrgId.eq(org))
                .filter(deploys::Column::ToVersionKey.eq(&key))
                .one(&txn)
                .await?
                .is_some()
            || summaries::Entity::find()
                .filter(summaries::Column::OrgId.eq(org))
                .filter(summaries::Column::NewestVersionKey.eq(&key))
                .one(&txn)
                .await?
                .is_some()
        {
            continue;
        }
        if table::service_versions::tombstone_many(
            &txn,
            org,
            std::slice::from_ref(&key),
            now,
            Some(cutoff),
        )
        .await?
            == 0
        {
            continue;
        }
        let rows = table::service_versions::get_by_keys(&txn, org, &[key]).await?;
        for row in rows {
            let deletion = VersionDeletion {
                org_id: org.into(),
                service_name: row.service_name,
                where_key: row.where_key,
                version: row.version,
                image: row.image,
                scope_key: row.scope_key.clone(),
                version_key: row.version_key,
                deleted_at: now,
            };
            db::service_identity_sync::apply_remote_with(
                &txn,
                org,
                ServiceIdentityMessage::VersionsDelete {
                    org_id: org.into(),
                    records: vec![deletion.clone()],
                },
            )
            .await?;
            // Every row of the scope carries the scope-wide count; readers take the max.
            summaries::Entity::update_many()
                .col_expr(
                    summaries::Column::PurgedVersions,
                    Expr::col(summaries::Column::PurgedVersions).add(1),
                )
                .col_expr(summaries::Column::UpdatedAt, Expr::value(now))
                .filter(summaries::Column::OrgId.eq(org))
                .filter(summaries::Column::ScopeKey.eq(row.scope_key))
                .exec(&txn)
                .await?;
            deleted.push(deletion);
        }
    }
    txn.commit().await?;
    let count = deleted.len();
    db::service_identity_sync::publish_chunked(deleted, 512 * 1024, |records| {
        ServiceIdentityMessage::VersionsDelete {
            org_id: org.into(),
            records,
        }
    })
    .await;
    Ok(count)
}

async fn aged_registry(org: &str, cutoff: i64, keep: usize, now: i64) -> anyhow::Result<()> {
    let mut offset = 0;
    let mut scopes: BTreeMap<String, Vec<config::meta::service_identity::ServiceVersionRecord>> =
        BTreeMap::new();
    loop {
        let rows = table::service_versions::list(
            get_orm_client_rw().await,
            org,
            &table::service_versions::ListQuery {
                limit: BATCH,
                offset,
                ..Default::default()
            },
        )
        .await?;
        let count = rows.len();
        for row in rows {
            scopes.entry(row.scope_key.clone()).or_default().push(row);
        }
        if count < BATCH as usize {
            break;
        }
        offset += count as u64;
    }
    for mut rows in scopes.into_values() {
        rows.sort_by(|a, b| {
            b.first_seen
                .cmp(&a.first_seen)
                .then(a.version_key.cmp(&b.version_key))
        });
        let keys: Vec<_> = rows
            .into_iter()
            .skip(keep.max(1))
            .filter(|r| r.last_seen < cutoff)
            .map(|r| r.version_key)
            .collect();
        for chunk in keys.chunks(BATCH as usize) {
            tombstone(org, chunk.to_vec(), cutoff, now, false).await?;
        }
    }
    Ok(())
}

async fn retained_history(org: &str, now: i64) -> anyhow::Result<()> {
    retained_history_with(get_orm_client_rw().await, org, now).await
}

async fn retained_history_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org: &str,
    now: i64,
) -> anyhow::Result<()> {
    let rows = deploys::Entity::find()
        .filter(deploys::Column::OrgId.eq(org))
        .order_by_desc(deploys::Column::At)
        .order_by_asc(deploys::Column::DeployKey)
        .all(conn)
        .await?;
    let mut counts: BTreeMap<(String, String), usize> = BTreeMap::new();
    let mut expired = Vec::new();
    for row in rows {
        let count = counts
            .entry((row.scope_key.clone(), row.cluster.clone()))
            .or_default();
        *count += 1;
        if *count <= KEEP_NEWEST
            || row.at >= now.saturating_sub(days(o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_DEPLOYS_RETENTION_DAYS))
            || row.superseded_at.is_none()
        {
            continue;
        }
        let evaluations = verdicts::Entity::find()
            .filter(verdicts::Column::OrgId.eq(org))
            .filter(verdicts::Column::DeployKey.eq(&row.deploy_key))
            .all(conn)
            .await?;
        if evaluations.iter().any(|r| {
            r.state != "frozen"
                || r.frozen_at.is_none_or(|at| {
                    at >= now.saturating_sub(days(o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_VERDICTS_RETENTION_DAYS))
                })
        }) {
            continue;
        }
        expired.push(row);
    }
    expired.sort_by(|a, b| {
        (&a.to_version_key, &a.deploy_key).cmp(&(&b.to_version_key, &b.deploy_key))
    });
    for rows in expired.chunks(BATCH as usize) {
        let txn = conn.begin().await?;
        for snapshot in rows {
            table::service_versions::transition_above_floor(
                &txn,
                org,
                &snapshot.to_version_key,
                i64::MAX,
            )
            .await?;
            let Some(current) = deploys::Entity::find_by_id(&snapshot.deploy_key)
                .filter(deploys::Column::OrgId.eq(org))
                .one(&txn)
                .await?
            else {
                continue;
            };
            if current.updated_at != snapshot.updated_at || current.superseded_at.is_none() {
                continue;
            }
            let evaluations = verdicts::Entity::find()
                .filter(verdicts::Column::OrgId.eq(org))
                .filter(verdicts::Column::DeployKey.eq(&current.deploy_key))
                .all(&txn)
                .await?;
            if evaluations.iter().any(|row| {
                row.state != "frozen"
                    || row.frozen_at.is_none_or(|at| {
                        at >= now
                            .saturating_sub(days(o2_enterprise::enterprise::common::config::SERVICE_SIGNALS_VERDICTS_RETENTION_DAYS))
                    })
            }) {
                continue;
            }
            table::service_version_verdicts::delete_for_deploys(
                &txn,
                org,
                std::slice::from_ref(&current.deploy_key),
            )
            .await?;
            deploys::Entity::delete_many()
                .filter(deploys::Column::OrgId.eq(org))
                .filter(deploys::Column::DeployKey.eq(current.deploy_key))
                .exec(&txn)
                .await?;
        }
        txn.commit().await?;
    }
    Ok(())
}

fn days(days: u64) -> i64 {
    i64::try_from(days).unwrap_or(i64::MAX).saturating_mul(DAY)
}
