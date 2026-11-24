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

//! Composite definition writes; each one publishes to the other regions of a super cluster.

#[cfg(feature = "enterprise")]
use std::future::Future;

use infra::table::{
    alert_composites::{self, CompositeWithChildren},
    entity::{alert_composite_children, alert_composites as composite_entity},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config, super_cluster::queue,
};
use sea_orm::{ConnectionTrait, DbErr, TransactionTrait};

pub async fn create<C>(
    conn: &C,
    definition: composite_entity::ActiveModel,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let saved = alert_composites::create_with_children(conn, definition, children).await?;
    #[cfg(feature = "enterprise")]
    publish(
        &saved.definition.org,
        &saved.definition.id,
        queue::alert_composites_create(&saved),
    )
    .await;
    Ok(saved)
}

pub async fn update<C>(
    conn: &C,
    replacement: composite_entity::ActiveModel,
    children: Vec<alert_composite_children::ActiveModel>,
) -> Result<CompositeWithChildren, DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let saved = alert_composites::update_with_children(conn, replacement, children).await?;
    #[cfg(feature = "enterprise")]
    publish(
        &saved.definition.org,
        &saved.definition.id,
        queue::alert_composites_update(&saved),
    )
    .await;
    Ok(saved)
}

/// `None` when the id is absent; nothing is published then.
pub async fn set_enabled<C>(
    conn: &C,
    org: &str,
    id: &str,
    enabled: bool,
    updated_at: i64,
) -> Result<Option<CompositeWithChildren>, DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let saved = alert_composites::set_enabled(conn, org, id, enabled, updated_at).await?;
    #[cfg(feature = "enterprise")]
    if let Some(saved) = saved.as_ref() {
        publish(org, id, queue::alert_composites_update(saved)).await;
    }
    Ok(saved)
}

/// `None` when the id is absent; nothing is published then.
pub async fn move_to_folder<C>(
    conn: &C,
    org: &str,
    id: &str,
    folder_id: &str,
    editor: &str,
    updated_at: i64,
) -> Result<Option<CompositeWithChildren>, DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let saved =
        alert_composites::move_to_folder(conn, org, id, folder_id, editor, updated_at).await?;
    #[cfg(feature = "enterprise")]
    if let Some(saved) = saved.as_ref() {
        publish(org, id, queue::alert_composites_update(saved)).await;
    }
    Ok(saved)
}

pub async fn delete<C>(conn: &C, org: &str, id: &str) -> Result<(), DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    alert_composites::delete_by_id(conn, org, id).await?;
    #[cfg(feature = "enterprise")]
    publish(org, id, queue::alert_composites_delete(org, id)).await;
    Ok(())
}

/// Sends one change; a failure is logged because the local write already committed.
#[cfg(feature = "enterprise")]
async fn publish(org: &str, id: &str, send: impl Future<Output = Result<(), anyhow::Error>>) {
    if !get_o2_config().super_cluster.enabled {
        return;
    }
    if let Err(e) = send.await {
        log::error!("[SUPER_CLUSTER:sync] Failed to publish composite {org}/{id}: {e}");
    }
}
