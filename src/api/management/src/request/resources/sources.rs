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

#[cfg(not(feature = "cloud"))]
use common::infra::config::ROOT_USER;
use common::infra::config::{ORG_USERS, USERS};
#[cfg(not(feature = "cloud"))]
use config::DEFAULT_ORG;
use config::{
    get_config,
    meta::{
        alerts::alert::{AlertSortField, AlertTypeFilter, ListAlertsParams},
        dashboards::ListDashboardsParams,
        stream::StreamType,
        synthetics::ListSyntheticsParams,
    },
};
use infra::db::get_orm_client_ro;
use openobserve_core::{
    alerts::alert as alert_service, authz::list_objects_for_user, dashboards as dashboard_service,
    pipeline as pipeline_service,
};
use stream as stream_service;

use super::matching::{Permit, is_candidate};
use crate::models::resources::{ResourceHit, ResourceType};

/// Table-backed types fetch ahead of ranking so RBAC drops still leave enough rows to fill `limit`.
const FETCH_FACTOR: u64 = 5;
const FETCH_CAP: u64 = 500;
const SEARCHABLE_STREAM_TYPES: [StreamType; 3] =
    [StreamType::Logs, StreamType::Metrics, StreamType::Traces];

pub struct SourceContext<'a> {
    pub org_id: &'a str,
    pub user_id: &'a str,
    /// Already folded.
    pub q: &'a str,
    pub limit: u64,
}

/// Dispatches to the source for `kind`, returning its unranked candidate hits (the caller ranks).
pub async fn fetch(
    ctx: &SourceContext<'_>,
    kind: ResourceType,
) -> anyhow::Result<Vec<ResourceHit>> {
    match kind {
        ResourceType::Dashboard => dashboards(ctx).await,
        ResourceType::Alert => alerts(ctx).await,
        ResourceType::Stream => streams(ctx).await,
        ResourceType::SavedView => saved_views(ctx).await,
        ResourceType::Function => functions(ctx).await,
        ResourceType::Pipeline => pipelines(ctx).await,
        ResourceType::User => users(ctx).await,
        ResourceType::ServiceAccount => service_accounts(ctx).await,
        ResourceType::Synthetic => synthetics(ctx).await,
    }
}

fn fetch_size(limit: u64) -> u64 {
    limit.saturating_mul(FETCH_FACTOR).clamp(1, FETCH_CAP)
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

#[cfg(feature = "enterprise")]
fn ofga_key(resource: &str) -> &str {
    o2_openfga::meta::mapping::OFGA_MODELS
        .get(resource)
        .map_or(resource, |model| model.key)
}

#[cfg(not(feature = "enterprise"))]
fn ofga_key(resource: &str) -> &str {
    resource
}

async fn permitted_objects(
    ctx: &SourceContext<'_>,
    key: &str,
) -> anyhow::Result<Option<Vec<String>>> {
    list_objects_for_user(ctx.org_id, ctx.user_id, "GET", key).await
}

/// The same key drives both the list call and the `Permit`, so the two never disagree on the object
/// prefix.
async fn permit_for(ctx: &SourceContext<'_>, resource: &str) -> anyhow::Result<Permit> {
    let key = ofga_key(resource);
    let objects = permitted_objects(ctx, key).await?;
    Ok(Permit::new(objects, key, ctx.org_id))
}

/// Same core list the Dashboards page uses, so folder and per-dashboard permissions apply
/// unchanged.
async fn dashboards(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    let mut params = ListDashboardsParams::new(ctx.org_id).paginate(fetch_size(ctx.limit), 0);
    if !ctx.q.is_empty() {
        params = params.where_title_contains(ctx.q);
    }
    let rows = dashboard_service::list_dashboards(ctx.user_id, params)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(rows
        .into_iter()
        .filter_map(|(folder, dashboard)| {
            let id = dashboard.dashboard_id()?;
            let mut hit = ResourceHit::new(
                ResourceType::Dashboard,
                id,
                dashboard.title().unwrap_or_default(),
            );
            hit.folder_id = Some(folder.folder_id);
            hit.folder_name = Some(folder.name);
            hit.description = dashboard.description().and_then(non_empty);
            Some(hit)
        })
        .collect())
}

async fn alerts(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    let params = ListAlertsParams {
        org_id: ctx.org_id.to_owned(),
        folder_id: None,
        name_substring: non_empty(ctx.q),
        stream_type_and_name: None,
        enabled: None,
        owner: None,
        page_size_and_idx: Some((fetch_size(ctx.limit), 0)),
        alert_type: AlertTypeFilter::All,
        priority: None,
        tag_alert_ids: None,
        sort_by: Some(AlertSortField::Name),
        sort_desc: false,
        slo_id: None,
    };
    let conn = get_orm_client_ro().await;
    let rows = alert_service::list_v2(conn, Some(ctx.user_id), params)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(rows
        .into_iter()
        .filter_map(|(folder, alert)| {
            let id = alert.id?.to_string();
            let mut hit = ResourceHit::new(ResourceType::Alert, id, alert.name);
            hit.folder_id = Some(folder.folder_id);
            hit.folder_name = Some(folder.name);
            hit.enabled = Some(alert.enabled);
            hit.description = non_empty(&alert.description);
            Some(hit)
        })
        .collect())
}

/// Per type, because the stream permission filter only applies when a type is given.
async fn streams(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    let mut hits = Vec::new();
    for stream_type in SEARCHABLE_STREAM_TYPES {
        let key = stream_type.as_str();
        let permitted = permitted_objects(ctx, ofga_key(key)).await?;
        let rows =
            stream_service::get_streams(ctx.org_id, Some(stream_type), false, permitted).await;
        for row in rows {
            if !is_candidate(&row.name, "", "", ctx.q) {
                continue;
            }
            let mut hit = ResourceHit::new(
                ResourceType::Stream,
                format!("{key}/{}", row.name),
                row.name,
            );
            hit.stream_type = Some(key.to_owned());
            hits.push(hit);
        }
    }
    Ok(hits)
}

async fn saved_views(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    let permit = permit_for(ctx, "savedviews").await?;
    let views = db::saved_view::get_views_list_only(ctx.org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(views
        .views
        .into_iter()
        .filter(|v| permit.allows(&v.view_id) && is_candidate(&v.view_name, &v.view_id, "", ctx.q))
        .map(|v| ResourceHit::new(ResourceType::SavedView, v.view_id, v.view_name))
        .collect())
}

async fn functions(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    let permit = permit_for(ctx, "function").await?;
    let rows = db::functions::list(ctx.org_id).await?;
    Ok(rows
        .into_iter()
        .filter(|f| permit.allows(&f.name) && is_candidate(&f.name, "", "", ctx.q))
        .map(|f| ResourceHit::new(ResourceType::Function, f.name.clone(), f.name))
        .collect())
}

async fn pipelines(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    let permitted = permitted_objects(ctx, ofga_key("pipelines")).await?;
    let rows = pipeline_service::list_user_pipelines(ctx.org_id, permitted)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(rows
        .into_iter()
        .filter(|p| is_candidate(&p.name, &p.id, &p.description, ctx.q))
        .map(|p| {
            let mut hit = ResourceHit::new(ResourceType::Pipeline, p.id, p.name);
            hit.enabled = Some(p.enabled);
            hit.description = non_empty(&p.description);
            hit
        })
        .collect())
}

fn person_hit(kind: ResourceType, email: &str, role: &str) -> ResourceHit {
    let (first, last) = USERS
        .get(&email.to_lowercase())
        .map(|u| (u.first_name.clone(), u.last_name.clone()))
        .unwrap_or_default();
    let full_name = format!("{first} {last}").trim().to_owned();
    let name = if full_name.is_empty() {
        email
    } else {
        &full_name
    };
    let mut hit = ResourceHit::new(kind, email, name);
    hit.email = Some(email.to_owned());
    hit.role = Some(role.to_owned());
    hit
}

/// The Users page gate: a boolean list permission, not a per-user object list.
#[cfg(feature = "enterprise")]
async fn may_list_users(ctx: &SourceContext<'_>) -> bool {
    !o2_openfga::config::get_config().enabled
        || openobserve_core::auth::check_permissions(
            ctx.org_id,
            ctx.org_id,
            ctx.user_id,
            "users",
            "GET",
            None,
            true,
            false,
            false,
        )
        .await
}

#[cfg(not(feature = "enterprise"))]
async fn may_list_users(_ctx: &SourceContext<'_>) -> bool {
    true
}

async fn users(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    if !may_list_users(ctx).await {
        return Ok(Vec::new());
    }
    let prefix = format!("{}/", ctx.org_id);
    let mut hits: Vec<ResourceHit> = ORG_USERS
        .iter()
        .filter(|entry| {
            entry.key().starts_with(&prefix) && !entry.value().role.is_service_account()
        })
        .map(|entry| {
            person_hit(
                ResourceType::User,
                &entry.value().email,
                &entry.value().role.to_string(),
            )
        })
        .collect();
    // The Users page appends the root user outside the default org; keep the two lists equal.
    #[cfg(not(feature = "cloud"))]
    if ctx.org_id != DEFAULT_ORG
        && let Some(root) = ROOT_USER.get("root")
    {
        hits.push(person_hit(
            ResourceType::User,
            &root.email,
            &root.role.to_string(),
        ));
    }
    hits.retain(|h| is_candidate(&h.name, &h.id, "", ctx.q));
    Ok(hits)
}

async fn service_accounts(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    // Match the list endpoint: when the feature is off, service accounts are not discoverable.
    if !get_config().auth.service_account_enabled {
        return Ok(Vec::new());
    }
    let permit = permit_for(ctx, "service_accounts").await?;
    let prefix = format!("{}/", ctx.org_id);
    Ok(ORG_USERS
        .iter()
        .filter(|entry| {
            let user = entry.value();
            entry.key().starts_with(&prefix)
                && user.role.is_service_account()
                && permit.allows(&user.email)
        })
        .map(|entry| {
            person_hit(
                ResourceType::ServiceAccount,
                &entry.value().email,
                &entry.value().role.to_string(),
            )
        })
        .filter(|h| is_candidate(&h.name, &h.id, "", ctx.q))
        .collect())
}

async fn synthetics(ctx: &SourceContext<'_>) -> anyhow::Result<Vec<ResourceHit>> {
    if !get_config().synthetics.enabled {
        return Ok(Vec::new());
    }
    let permit = permit_for(ctx, "synthetics").await?;
    let resp = openobserve_synthetics::service::list_synthetics(
        ctx.org_id,
        &ListSyntheticsParams::default(),
    )
    .await?;
    Ok(resp
        .checks
        .into_iter()
        .filter(|c| permit.allows(&c.id) && is_candidate(&c.name, &c.id, &c.description, ctx.q))
        .map(|c| {
            let mut hit = ResourceHit::new(ResourceType::Synthetic, c.id, c.name);
            hit.folder_id = Some(c.folder_id);
            hit.enabled = Some(c.enabled);
            hit.description = non_empty(&c.description);
            hit
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_size_scales_and_caps() {
        assert_eq!(fetch_size(1), 5);
        assert_eq!(fetch_size(20), 100);
        assert_eq!(fetch_size(100), 500);
        assert_eq!(fetch_size(u64::MAX), FETCH_CAP);
    }

    #[test]
    fn person_hit_falls_back_to_email_when_no_name_is_cached() {
        let hit = person_hit(ResourceType::User, "nobody@example.com", "admin");
        assert_eq!(hit.name, "nobody@example.com");
        assert_eq!(hit.email.as_deref(), Some("nobody@example.com"));
        assert_eq!(hit.role.as_deref(), Some("admin"));
    }
}
