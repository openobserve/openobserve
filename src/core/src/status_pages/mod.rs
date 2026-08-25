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

//! Status-pages admin service layer: CRUD orchestration, slug generation, and
//! the folder-gated component mapping (R-1). Every function is org-scoped by
//! the caller-supplied `org_id` (from the authenticated context, never the
//! request body — R-3).
//!
//! Password handling (R-6): `password_hash` is Argon2id at rest and is never
//! returned; the admin view carries only `password_set`.

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use config::{
    meta::status_pages::{
        CreateNoticeRequest, CreatePageRequest, NoticeAdminView, NoticeUpdateRequest,
        PageAdminView, PreviewResponse, SetComponentsRequest, UpdateNoticeRequest,
        UpdatePageRequest,
    },
    utils::{rand::generate_random_string, time::now_micros},
};
use infra::table::{
    entity::{status_page_notice_updates, status_pages as page_entity},
    status_pages as table,
};

/// 22 base62 chars ≈ 131 bits of CSPRNG entropy — the public identifier.
const SLUG_LEN: usize = 22;
// Visibility encoding: 0 = draft, 1 = public, 2 = password-protected.
const VIS_DRAFT: i32 = 0;
const VIS_PASSWORD: i32 = 2;

/// Creates a draft page with secure defaults. Slug is CSPRNG-random and
/// retried on the (astronomically unlikely) unique-index collision.
pub async fn create_page(
    org_id: &str,
    req: CreatePageRequest,
    owner: &str,
) -> Result<PageAdminView, anyhow::Error> {
    if req.name.trim().is_empty() {
        anyhow::bail!("validation: name is required");
    }
    let now = now_micros();
    let model = page_entity::Model {
        id: config::ider::generate(),
        org_id: org_id.to_string(),
        name: req.name,
        slug: unique_slug(org_id).await?,
        description: req.description,
        visibility: VIS_DRAFT,
        password_hash: None,
        noindex: true,
        show_uptime_percent: true,
        show_timeline_bars: true,
        show_response_time: false,
        confirm_failures: 2,
        confirm_recovery: 2,
        confirm_after_secs: None,
        brand_name: None,
        accent_color: None,
        display_tz: None,
        tracking_since: None,
        owner: Some(owner.to_string()),
        created_at: now,
        updated_at: now,
    };
    table::insert_page(&model).await?;
    emit_upsert(org_id, "status_pages", &model).await;
    Ok(to_admin_view(model, None, 0))
}

/// Applies a partial update. Setting `password` (non-empty) hashes it and moves
/// visibility to password; an empty `password` clears it. `password_hash` is
/// never read back out.
pub async fn update_page(
    org_id: &str,
    id: &str,
    req: UpdatePageRequest,
) -> Result<PageAdminView, anyhow::Error> {
    let mut model = table::get_page_by_id(org_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("not found"))?;

    if let Some(color) = &req.accent_color
        && !color.is_empty()
        && !is_valid_hex_color(color)
    {
        anyhow::bail!("validation: accent_color must be #RRGGBB");
    }
    apply_display_fields(&mut model, &req);
    if let Some(v) = req.name {
        model.name = v;
    }
    if let Some(v) = req.description {
        model.description = Some(v);
    }

    // Password + visibility, together, because they constrain each other.
    match req.password.as_deref() {
        Some("") => {
            model.password_hash = None;
        }
        Some(pw) => {
            model.password_hash = Some(hash_password(pw)?);
        }
        None => {}
    }
    if let Some(v) = req.visibility {
        if v == VIS_PASSWORD && model.password_hash.is_none() {
            anyhow::bail!("validation: a password must be set before visibility=password");
        }
        if !(VIS_DRAFT..=VIS_PASSWORD).contains(&v) {
            anyhow::bail!("validation: visibility must be 0, 1, or 2");
        }
        // First transition out of draft stamps tracking_since.
        if model.visibility == VIS_DRAFT && v != VIS_DRAFT && model.tracking_since.is_none() {
            model.tracking_since = Some(now_micros());
        }
        model.visibility = v;
    }
    model.updated_at = now_micros();
    table::update_page(&model).await?;
    emit_upsert(org_id, "status_pages", &model).await;
    let count = table::count_components(org_id, id).await?;
    Ok(to_admin_view(model, None, count))
}

/// List pages for the admin list view, each with a live worst-component health
/// chip and component count.
pub async fn list_pages_view(
    org_id: &str,
) -> Result<config::meta::status_pages::PageListResponse, anyhow::Error> {
    let models = table::list_pages(org_id).await?;
    let total = models.len() as i64;
    let mut pages = Vec::with_capacity(models.len());
    for m in models {
        let id = m.id.clone();
        let count = table::count_components(org_id, &id).await?;
        // Health from the already-built snapshot's `overall`, if present.
        let health = table::get_snapshot_overall(org_id, &id).await?;
        pages.push(to_admin_view(m, health, count));
    }
    Ok(config::meta::status_pages::PageListResponse { pages, total })
}

/// R-4: append one immutable audit-log row for an uptime-affecting mutation.
pub async fn write_audit(
    org_id: &str,
    actor: &str,
    action: &str,
    notice_id: Option<&str>,
) -> Result<(), anyhow::Error> {
    table::insert_audit(org_id, actor, action, notice_id, now_micros()).await?;
    Ok(())
}

pub async fn get_page(org_id: &str, id: &str) -> Result<Option<PageAdminView>, anyhow::Error> {
    let Some(model) = table::get_page_by_id(org_id, id).await? else {
        return Ok(None);
    };
    let count = table::count_components(org_id, id).await?;
    let mut view = to_admin_view(model, None, count);
    // Detail GET carries the full component→check mapping so the edit UI can
    // render and round-trip it (the list GET omits it).
    view.components = Some(table::list_components_with_checks(org_id, id).await?);
    Ok(Some(view))
}

pub async fn rotate_slug(org_id: &str, id: &str) -> Result<String, anyhow::Error> {
    let mut model = table::get_page_by_id(org_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("not found"))?;
    model.slug = unique_slug(org_id).await?;
    model.updated_at = now_micros();
    table::update_page(&model).await?;
    emit_upsert(org_id, "status_pages", &model).await;
    Ok(model.slug)
}

pub async fn delete_page(org_id: &str, id: &str) -> Result<bool, anyhow::Error> {
    let deleted = table::delete_page(org_id, id).await?;
    if deleted {
        emit_delete(org_id, "status_pages", id).await;
    }
    Ok(deleted)
}

/// Bulk component replace. **R-1 (top build risk):** every mapped check is
/// verified for folder-level synthetics READ by the CALLER before this runs —
/// the handler passes only checks the user may see. This function additionally
/// enforces that each check belongs to `org_id` (defense in depth).
pub async fn set_components(
    org_id: &str,
    page_id: &str,
    req: SetComponentsRequest,
) -> Result<(), anyhow::Error> {
    // Page must exist in this org (R-3).
    if table::get_page_by_id(org_id, page_id).await?.is_none() {
        anyhow::bail!("not found");
    }
    for comp in &req.components {
        if comp.name.trim().is_empty() {
            anyhow::bail!("validation: component name is required");
        }
        for check_id in &comp.check_ids {
            if !synthetics_check_in_org(org_id, check_id).await? {
                anyhow::bail!("validation: check {check_id} is not in this org");
            }
        }
    }
    table::replace_components(org_id, page_id, &req.components, now_micros()).await?;
    emit_replace_components(org_id, page_id, &req.components).await;
    Ok(())
}

// NOTE (R-1): the per-check folder-authz composition lives in the HANDLER
// layer (`api/management/.../status_pages/admin.rs`), not here — it needs both
// `openobserve_synthetics::service::get_synthetic` (→ folder_id) and
// `check_permissions`, and the handler crate already depends on both. The
// handler calls `set_components` only AFTER clearing every mapped check.
// (core does depend on openobserve-synthetics — see `preview` below, which
// reuses the rebuilder's snapshot serializer — but that dependency carries no
// authz responsibility of its own.)

// ── Notices (manual half; auto-incidents are rebuilder-owned) ────────────────
// Notices are org-scoped objects (design: one outage, one narrative on every
// page that shows an affected component); `page_id` here is a convenience —
// it only supplies the default `component_ids` and filters the list view.

/// Posts a manual notice. Impact ≥ partial_outage accrues downtime the same
/// way an auto-incident does; `starts_at` in the future makes it a scheduled
/// maintenance window (kind=1 callers set this), not an active incident. An
/// empty `component_ids` defaults to every component on `page_id`.
pub async fn create_notice(
    org_id: &str,
    page_id: &str,
    req: CreateNoticeRequest,
    owner: &str,
) -> Result<NoticeAdminView, anyhow::Error> {
    if req.title.trim().is_empty() {
        anyhow::bail!("validation: title is required");
    }
    if !(0..=2).contains(&req.kind) {
        anyhow::bail!("validation: kind must be 0, 1, or 2");
    }
    if !(0..=3).contains(&req.impact) {
        anyhow::bail!("validation: impact must be 0-3");
    }
    let component_ids = if req.component_ids.is_empty() {
        table::list_components_with_checks(org_id, page_id)
            .await?
            .into_iter()
            .map(|c| c.id)
            .collect()
    } else {
        req.component_ids
    };
    let now = now_micros();
    let starts_at = req.starts_at.unwrap_or(now);
    // Scheduled (future-dated) maintenance starts life in state=0; everything
    // else is active immediately — there is no manual "draft" state.
    let state = if req.kind == 1 && starts_at > now {
        0
    } else {
        1
    };
    let model = infra::table::entity::status_page_notices::Model {
        id: config::ider::generate(),
        org_id: org_id.to_string(),
        kind: req.kind,
        impact: req.impact,
        source: 1,
        title: req.title,
        body: req.body,
        state,
        starts_at,
        resolved_at: None,
        segments: segments_json(starts_at, state),
        excluded_from_uptime: false,
        deleted_at: None,
        auto_check_id: None,
        auto_recovery_streak: 0,
        owner: Some(owner.to_string()),
        created_at: now,
        updated_at: now,
    };
    let conn = infra::db::ORM_CLIENT
        .get_or_init(infra::db::connect_to_orm)
        .await;
    table::insert_notice(conn, model.clone()).await?;
    table::replace_notice_components(org_id, &model.id, &component_ids).await?;
    emit_notice_upsert(org_id, "status_page_notices", &model).await;
    refresh_affected_pages(org_id, &component_ids).await;
    Ok(to_notice_view(model, component_ids))
}

/// Notices touching any component on `page_id` — a filtered view over the
/// org's full notice set, for the page's "past updates" panel.
pub async fn list_notices_for_page(
    org_id: &str,
    page_id: &str,
) -> Result<Vec<NoticeAdminView>, anyhow::Error> {
    let page_component_ids: std::collections::HashSet<String> =
        table::list_components_with_checks(org_id, page_id)
            .await?
            .into_iter()
            .map(|c| c.id)
            .collect();
    let notices = table::list_notices_for_org(org_id).await?;
    let ids: Vec<String> = notices.iter().map(|n| n.id.clone()).collect();
    let conn = infra::db::ORM_CLIENT
        .get_or_init(infra::db::connect_to_orm)
        .await;
    let joins = table::list_notice_components(conn, &ids).await?;
    Ok(notices
        .into_iter()
        .filter_map(|n| {
            let component_ids: Vec<String> = joins
                .iter()
                .filter(|j| j.notice_id == n.id)
                .map(|j| j.component_id.clone())
                .collect();
            component_ids
                .iter()
                .any(|c| page_component_ids.contains(c))
                .then(|| to_notice_view(n, component_ids))
        })
        .collect())
}

/// Edits a manual notice's narrative, impact, mapped components, or resolves
/// it by hand. Rejects touching an auto-sourced notice's `state`/`impact` —
/// those are rebuilder-owned; use [`mark_false_positive`] to override one.
pub async fn update_notice(
    org_id: &str,
    id: &str,
    req: UpdateNoticeRequest,
) -> Result<NoticeAdminView, anyhow::Error> {
    let mut model = table::get_notice_by_id(org_id, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("not found"))?;
    if model.source == 0 && (req.state.is_some() || req.impact.is_some()) {
        anyhow::bail!(
            "validation: this notice is auto-managed; use mark_false_positive to override it"
        );
    }
    if let Some(v) = req.impact {
        if !(0..=3).contains(&v) {
            anyhow::bail!("validation: impact must be 0-3");
        }
        model.impact = v;
    }
    if let Some(v) = req.title {
        if v.trim().is_empty() {
            anyhow::bail!("validation: title is required");
        }
        model.title = v;
    }
    if let Some(v) = req.body {
        model.body = v;
    }
    let now = now_micros();
    if let Some(v) = req.state {
        if !(0..=2).contains(&v) {
            anyhow::bail!("validation: state must be 0, 1, or 2");
        }
        if v == 2 && model.state != 2 {
            close_open_segment(&mut model, now);
            model.resolved_at = Some(now);
        }
        model.state = v;
    }
    model.updated_at = now;
    table::put_notice(&model).await?;
    let component_ids = match req.component_ids {
        Some(ids) => {
            table::replace_notice_components(org_id, id, &ids).await?;
            ids
        }
        None => {
            let conn = infra::db::ORM_CLIENT
                .get_or_init(infra::db::connect_to_orm)
                .await;
            table::list_notice_components(conn, &[id.to_string()])
                .await?
                .into_iter()
                .map(|j| j.component_id)
                .collect()
        }
    };
    emit_notice_upsert(org_id, "status_page_notices", &model).await;
    refresh_affected_pages(org_id, &component_ids).await;
    Ok(to_notice_view(model, component_ids))
}

pub async fn delete_notice(org_id: &str, id: &str) -> Result<bool, anyhow::Error> {
    let component_ids = notice_component_ids(id).await.unwrap_or_default();
    let deleted = table::soft_delete_notice(org_id, id, now_micros()).await?;
    if deleted {
        emit_notice_delete(org_id, "status_page_notices", id).await;
        refresh_affected_pages(org_id, &component_ids).await;
    }
    Ok(deleted)
}

/// Appends a timestamped narrative update to a notice's public timeline.
pub async fn add_notice_update(
    org_id: &str,
    notice_id: &str,
    req: NoticeUpdateRequest,
    owner: &str,
) -> Result<(), anyhow::Error> {
    if req.body.trim().is_empty() {
        anyhow::bail!("validation: body is required");
    }
    if table::get_notice_by_id(org_id, notice_id).await?.is_none() {
        anyhow::bail!("not found");
    }
    table::insert_notice_update(status_page_notice_updates::Model {
        id: config::ider::generate(),
        notice_id: notice_id.to_string(),
        org_id: org_id.to_string(),
        body: req.body,
        owner: Some(owner.to_string()),
        created_at: now_micros(),
    })
    .await?;
    // A narrative update never changes impact/state, but it does change what
    // the public snapshot's `notices[].updates` should show — refresh so it
    // is not stuck behind the rebuilder's own tick either.
    let component_ids = notice_component_ids(notice_id).await.unwrap_or_default();
    refresh_affected_pages(org_id, &component_ids).await;
    Ok(())
}

/// The 3am escape hatch: resolves an auto-incident, excludes it from the
/// uptime math (reversible via a later `update_notice`), and snoozes the
/// underlying check org-wide so the same flap does not immediately reopen it.
pub async fn mark_false_positive(
    org_id: &str,
    notice_id: &str,
    snooze_hours: i64,
    actor: &str,
) -> Result<(), anyhow::Error> {
    let mut model = table::get_notice_by_id(org_id, notice_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("not found"))?;
    let now = now_micros();
    close_open_segment(&mut model, now);
    model.state = 2;
    model.resolved_at = Some(now);
    model.excluded_from_uptime = true;
    model.updated_at = now;
    table::put_notice(&model).await?;
    if let Some(check_id) = &model.auto_check_id {
        table::upsert_check_snooze(
            org_id,
            check_id,
            now + snooze_hours.max(1) * 3_600_000_000,
            Some(actor),
            now,
        )
        .await?;
    }
    emit_notice_upsert(org_id, "status_page_notices", &model).await;
    let component_ids = notice_component_ids(notice_id).await.unwrap_or_default();
    refresh_affected_pages(org_id, &component_ids).await;
    Ok(())
}

pub async fn list_notice_updates(
    org_id: &str,
    notice_id: &str,
) -> Result<Vec<config::meta::status_pages::NoticeUpdateView>, anyhow::Error> {
    Ok(table::list_notice_updates(org_id, notice_id)
        .await?
        .into_iter()
        .map(|u| config::meta::status_pages::NoticeUpdateView {
            id: u.id,
            body: u.body,
            owner: u.owner,
            created_at: u.created_at,
        })
        .collect())
}

/// Renders the exact bytes a visitor would see if the page were published
/// right now, through the same serializer the public plane uses — preview
/// cannot diverge from production output (design requirement).
pub async fn preview(
    org_id: &str,
    page_id: &str,
) -> Result<Option<PreviewResponse>, anyhow::Error> {
    let Some((current, history)) =
        openobserve_synthetics::status_pages::preview_snapshot(org_id, page_id).await?
    else {
        return Ok(None);
    };
    Ok(Some(PreviewResponse { current, history }))
}

/// Claims a candidate domain for a page. Lowercases/punycodes before the
/// live-uniqueness check so `Status.Brandname.COM` and
/// `status.brandname.com` collide as the same string (R-3 note: the row is
/// still org-scoped by `org_id`, but domain uniqueness is deliberately
/// global — a second org must never be able to claim a domain another org
/// already holds).
pub async fn create_domain(
    org_id: &str,
    page_id: &str,
    req: config::meta::status_pages::CreateDomainRequest,
) -> Result<config::meta::status_pages::CreateDomainResponse, anyhow::Error> {
    let domain = normalize_domain(&req.domain)?;
    if table::get_page_by_id(org_id, page_id).await?.is_none() {
        anyhow::bail!("validation: page not found");
    }
    let now = now_micros();
    let token = format!("o2v_{}", generate_random_string(32));
    let model = infra::table::entity::status_page_custom_domains::Model {
        id: config::ider::generate(),
        org_id: org_id.to_string(),
        status_page_id: page_id.to_string(),
        domain: domain.clone(),
        verification_token: token.clone(),
        verification_state: 0,
        verification_failure_reason: None,
        verified_at: None,
        released_at: None,
        last_checked_at: None,
        created_at: now,
        updated_at: now,
    };
    let claimed = table::insert_domain_if_unclaimed(&model).await?;
    if !claimed {
        anyhow::bail!("validation: domain is already claimed");
    }
    Ok(config::meta::status_pages::CreateDomainResponse {
        id: model.id,
        domain,
        txt_name: format!("_o2-verify.{}", model.domain),
        txt_value: token,
    })
}

pub async fn list_domains(
    org_id: &str,
    page_id: &str,
) -> Result<Vec<config::meta::status_pages::DomainAdminView>, anyhow::Error> {
    Ok(table::list_domains_for_page(org_id, page_id)
        .await?
        .into_iter()
        .map(to_domain_view)
        .collect())
}

/// Tombstones the claim (R-3: org-scoped, so a delete for another org's
/// domain id is a no-op returning false, not a leak).
pub async fn delete_domain(org_id: &str, id: &str) -> Result<bool, anyhow::Error> {
    Ok(table::release_domain(org_id, id, now_micros()).await?)
}

/// Runs one immediate verification pass for a single domain — the admin-facing
/// "Verify now" action, distinct from the background loop's periodic sweep, so
/// an admin who just fixed their DNS doesn't have to wait for the next tick.
pub async fn verify_domain_now(
    org_id: &str,
    id: &str,
) -> Result<config::meta::status_pages::DomainAdminView, anyhow::Error> {
    let Some(model) = table::get_domain_by_id(org_id, id).await? else {
        anyhow::bail!("validation: domain not found");
    };
    let checked = openobserve_synthetics::status_pages::check_domain_ownership(model).await?;
    table::update_domain(&checked).await?;
    Ok(to_domain_view(checked))
}

// ── Super-cluster emit (enterprise, gated on super_cluster.enabled) ──────────
// Follows the synthetics idiom: cfg(enterprise) + super_cluster.enabled (NO
// !local_mode — synthetics does not gate on it). Best-effort: a publish failure
// is logged, not propagated, so a super-cluster hiccup never fails a local
// admin write. `password_hash` travels verbatim inside the row JSON (Argon2id
// is a one-way self-contained hash; no DEK envelope needed).

async fn emit_upsert(_org_id: &str, _table: &str, _model: &page_entity::Model) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let json = match serde_json::to_string(_model) {
            Ok(j) => j,
            Err(e) => {
                log::error!("[status_pages] emit_upsert serialize: {e}");
                return;
            }
        };
        if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::status_pages_upsert(
            _org_id, _table, json,
        )
        .await
        {
            log::error!("[status_pages] super-cluster upsert publish failed: {e}");
        }
    }
}

async fn emit_delete(_org_id: &str, _table: &str, _id: &str) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::status_pages_delete(
            _org_id, _table, _id,
        )
        .await
    {
        log::error!("[status_pages] super-cluster delete publish failed: {e}");
    }
}

async fn emit_replace_components(
    _org_id: &str,
    _page_id: &str,
    _components: &[config::meta::status_pages::ComponentInput],
) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let json = match serde_json::to_string(_components) {
            Ok(j) => j,
            Err(e) => {
                log::error!("[status_pages] emit_replace_components serialize: {e}");
                return;
            }
        };
        if let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::status_pages_replace_components(
                _org_id, _page_id, json,
            )
            .await
        {
            log::error!("[status_pages] super-cluster replace_components publish failed: {e}");
        }
    }
}

async fn emit_notice_upsert(
    _org_id: &str,
    _table: &str,
    _model: &infra::table::entity::status_page_notices::Model,
) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let json = match serde_json::to_string(_model) {
            Ok(j) => j,
            Err(e) => {
                log::error!("[status_pages] emit_notice_upsert serialize: {e}");
                return;
            }
        };
        if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::status_pages_upsert(
            _org_id, _table, json,
        )
        .await
        {
            log::error!("[status_pages] super-cluster notice upsert publish failed: {e}");
        }
    }
}

async fn emit_notice_delete(_org_id: &str, _table: &str, _id: &str) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::status_pages_delete(
            _org_id, _table, _id,
        )
        .await
    {
        log::error!("[status_pages] super-cluster notice delete publish failed: {e}");
    }
}

// ── Password unlock (public plane, R-5/R-7) ──────────────────────────────────

/// Verifies a plaintext password against a page's stored Argon2id hash.
/// Constant-time via the argon2 crate. Returns Ok(false) for a wrong password,
/// Err only on a malformed stored hash (never leaks which).
pub fn verify_password(stored_hash: &str, candidate: &str) -> Result<bool, anyhow::Error> {
    use argon2::{PasswordHash, PasswordVerifier};
    let parsed =
        PasswordHash::new(stored_hash).map_err(|e| anyhow::anyhow!("bad stored hash: {e}"))?;
    Ok(Argon2::default()
        .verify_password(candidate.as_bytes(), &parsed)
        .is_ok())
}

/// The unlock cookie value: `{slug}.{exp}.{hex hmac}`. HMAC keyed by a
/// per-instance secret derived from the same material the chart signer uses
/// (consistent across nodes via the shared meta DB). `pw_version` (a short
/// prefix of the current password hash) is folded into the MAC input so a
/// password change invalidates all outstanding cookies.
pub async fn issue_unlock_cookie(slug: &str, pw_version: &str, ttl_secs: i64) -> Option<String> {
    let key = crate::alerts::notifications::chart::signing_key().await?;
    let exp = (now_micros() / 1_000_000) + ttl_secs;
    let mac = unlock_mac(key, slug, pw_version, exp);
    Some(format!("{slug}.{exp}.{mac}"))
}

/// Verifies an unlock cookie for `slug` against the current `pw_version`.
pub async fn verify_unlock_cookie(cookie: &str, slug: &str, pw_version: &str) -> bool {
    let Some(key) = crate::alerts::notifications::chart::signing_key().await else {
        return false;
    };
    let mut parts = cookie.splitn(3, '.');
    let (Some(c_slug), Some(exp_s), Some(mac)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if c_slug != slug {
        return false;
    }
    let Ok(exp) = exp_s.parse::<i64>() else {
        return false;
    };
    if (now_micros() / 1_000_000) > exp {
        return false;
    }
    let expected = unlock_mac(key, slug, pw_version, exp);
    // Constant-time compare.
    constant_time_eq(mac.as_bytes(), expected.as_bytes())
}

/// Short stable version tag of a password hash — folded into the cookie MAC so
/// a password change (new hash) invalidates outstanding cookies.
pub fn pw_version(password_hash: &str) -> String {
    // The Argon2 salt+digest tail is stable per password and opaque; take a
    // short hash of the whole PHC string.
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    password_hash.hash(&mut h);
    format!("{:08x}", h.finish() as u32)
}

/// Real HMAC-SHA256 over a domain-separated message — the same primitive the
/// chart signer uses. NOT a plain hash: an auth cookie needs a keyed MAC.
fn unlock_mac(key: &[u8], slug: &str, pw_version: &str, exp: i64) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = <Hmac<Sha256>>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(b"o2-status-unlock-v1\x00");
    mac.update(slug.as_bytes());
    mac.update(b"\x00");
    mac.update(pw_version.as_bytes());
    mac.update(b"\x00");
    mac.update(&exp.to_be_bytes());
    hex_encode(&mac.finalize().into_bytes())
}

fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn apply_display_fields(model: &mut page_entity::Model, req: &UpdatePageRequest) {
    if let Some(v) = req.noindex {
        model.noindex = v;
    }
    if let Some(v) = req.show_uptime_percent {
        model.show_uptime_percent = v;
    }
    if let Some(v) = req.show_timeline_bars {
        model.show_timeline_bars = v;
    }
    if let Some(v) = req.show_response_time {
        model.show_response_time = v;
    }
    if let Some(v) = req.confirm_failures {
        model.confirm_failures = v.clamp(1, 10);
    }
    if let Some(v) = req.confirm_recovery {
        model.confirm_recovery = v.clamp(1, 10);
    }
    if req.confirm_after_secs.is_some() {
        model.confirm_after_secs = req.confirm_after_secs;
    }
    if let Some(v) = &req.brand_name {
        model.brand_name = Some(v.clone());
    }
    if let Some(v) = &req.accent_color {
        model.accent_color = Some(v.clone());
    }
    if let Some(v) = &req.display_tz {
        model.display_tz = Some(v.clone());
    }
}

async fn unique_slug(_org_id: &str) -> Result<String, anyhow::Error> {
    for _ in 0..5 {
        let slug = generate_random_string(SLUG_LEN);
        if table::get_page_by_slug_any(&slug).await?.is_none() {
            return Ok(slug);
        }
    }
    anyhow::bail!("could not generate a unique slug")
}

async fn synthetics_check_in_org(org_id: &str, check_id: &str) -> Result<bool, anyhow::Error> {
    Ok(table::synthetics_check_belongs_to_org(org_id, check_id).await?)
}

fn hash_password(pw: &str) -> Result<String, anyhow::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("password hashing failed: {e}"))
}

fn is_valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Lowercases and strips a trailing dot; rejects anything that isn't a
/// plausible hostname. Real DNS validity (does it resolve, is it an apex,
/// etc.) is the verifier job's problem, not this fast synchronous check's.
fn normalize_domain(raw: &str) -> Result<String, anyhow::Error> {
    let d = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if d.is_empty() || d.len() > 253 || !d.contains('.') {
        anyhow::bail!("validation: not a valid domain");
    }
    let valid = d.split('.').all(|label| {
        !label.is_empty()
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    });
    if !valid {
        anyhow::bail!("validation: not a valid domain");
    }
    Ok(d)
}

fn to_admin_view(
    m: page_entity::Model,
    health: Option<config::meta::status_pages::ComponentStatus>,
    component_count: i64,
) -> PageAdminView {
    PageAdminView {
        id: m.id,
        name: m.name,
        slug: m.slug,
        description: m.description,
        visibility: m.visibility,
        password_set: m.password_hash.is_some(),
        noindex: m.noindex,
        show_uptime_percent: m.show_uptime_percent,
        show_timeline_bars: m.show_timeline_bars,
        show_response_time: m.show_response_time,
        confirm_failures: m.confirm_failures,
        confirm_recovery: m.confirm_recovery,
        confirm_after_secs: m.confirm_after_secs,
        brand_name: m.brand_name,
        accent_color: m.accent_color,
        display_tz: m.display_tz,
        tracking_since: m.tracking_since,
        owner: m.owner,
        created_at: m.created_at,
        updated_at: m.updated_at,
        health,
        component_count,
        components: None,
    }
}

fn to_notice_view(
    m: infra::table::entity::status_page_notices::Model,
    component_ids: Vec<String>,
) -> NoticeAdminView {
    NoticeAdminView {
        id: m.id,
        kind: m.kind,
        impact: m.impact,
        source: m.source,
        title: m.title,
        body: m.body,
        state: m.state,
        starts_at: m.starts_at,
        resolved_at: m.resolved_at,
        excluded_from_uptime: m.excluded_from_uptime,
        component_ids,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn to_domain_view(
    m: infra::table::entity::status_page_custom_domains::Model,
) -> config::meta::status_pages::DomainAdminView {
    config::meta::status_pages::DomainAdminView {
        id: m.id,
        domain: m.domain,
        verification_state: m.verification_state,
        verification_failure_reason: m.verification_failure_reason,
        verified_at: m.verified_at,
        last_checked_at: m.last_checked_at,
        created_at: m.created_at,
    }
}

/// A fresh notice's initial segment: open (`to: None`) once active, empty
/// while merely scheduled — scheduled maintenance has not started accruing
/// anything yet.
fn segments_json(starts_at: i64, state: i32) -> String {
    if state == 0 {
        return "[]".to_string();
    }
    serde_json::to_string(&[config::meta::status_pages::Segment {
        from: starts_at,
        to: None,
    }])
    .unwrap_or_else(|_| "[]".to_string())
}

/// Closes a notice's still-open segment at `at` — the manual-resolve
/// counterpart of the rebuilder's own `Resolve` action.
fn close_open_segment(model: &mut infra::table::entity::status_page_notices::Model, at: i64) {
    let mut segments: Vec<config::meta::status_pages::Segment> =
        serde_json::from_str(&model.segments).unwrap_or_default();
    if let Some(open) = segments.iter_mut().find(|s| s.to.is_none()) {
        open.to = Some(at);
    }
    model.segments = serde_json::to_string(&segments).unwrap_or_else(|_| "[]".to_string());
}

/// Recomputes and writes the cached snapshot for every page one of a
/// notice's mapped components belongs to, right after a notice write — so
/// the admin list's Health column and the public page reflect the change
/// immediately instead of waiting for the rebuilder's next tick (up to
/// `ZO_STATUS_PAGE_REBUILD_INTERVAL`, default 60s). Best-effort: a failure
/// here is logged, not propagated — the write itself already succeeded, and
/// the next scheduled tick would correct the cache regardless.
async fn refresh_affected_pages(org_id: &str, component_ids: &[String]) {
    if component_ids.is_empty() {
        return;
    }
    let page_ids = match table::pages_for_components(org_id, component_ids).await {
        Ok(ids) => ids,
        Err(e) => {
            log::error!("[status_pages] refresh_affected_pages: resolve pages failed: {e}");
            return;
        }
    };
    for page_id in page_ids {
        if let Err(e) =
            openobserve_synthetics::status_pages::refresh_snapshot(org_id, &page_id).await
        {
            log::error!("[status_pages] refresh_affected_pages: refresh {page_id} failed: {e}");
        }
    }
}

/// A notice's current mapped component ids — needed by write paths
/// (delete/mark_false_positive/add_notice_update) that only receive the
/// notice id, to resolve which pages' caches to refresh.
async fn notice_component_ids(notice_id: &str) -> Result<Vec<String>, anyhow::Error> {
    let conn = infra::db::ORM_CLIENT
        .get_or_init(infra::db::connect_to_orm)
        .await;
    Ok(
        table::list_notice_components(conn, &[notice_id.to_string()])
            .await?
            .into_iter()
            .map(|j| j.component_id)
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_color_validation() {
        assert!(is_valid_hex_color("#3f7994"));
        assert!(is_valid_hex_color("#FFFFFF"));
        assert!(!is_valid_hex_color("3f7994")); // no hash
        assert!(!is_valid_hex_color("#fff")); // short
        assert!(!is_valid_hex_color("#gggggg")); // non-hex
        assert!(!is_valid_hex_color("#3f7994 ")); // trailing space
    }

    #[test]
    fn unlock_mac_is_hmac_and_tamper_evident() {
        let key = b"instance-secret-key";
        let good = unlock_mac(key, "slug1", "v1", 1000);
        // 32-byte HMAC-SHA256 → 64 hex chars.
        assert_eq!(good.len(), 64);
        // Any input change flips the MAC.
        assert_ne!(good, unlock_mac(key, "slug2", "v1", 1000)); // slug
        assert_ne!(good, unlock_mac(key, "slug1", "v2", 1000)); // pw_version
        assert_ne!(good, unlock_mac(key, "slug1", "v1", 1001)); // exp
        assert_ne!(good, unlock_mac(b"other-key", "slug1", "v1", 1000)); // key
    }

    #[test]
    fn constant_time_eq_matches_only_equal() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn pw_version_changes_with_hash() {
        let a = pw_version("$argon2id$v=19$...aaa");
        let b = pw_version("$argon2id$v=19$...bbb");
        assert_ne!(a, b);
        assert_eq!(a, pw_version("$argon2id$v=19$...aaa")); // stable
    }

    #[test]
    fn segments_json_is_empty_for_scheduled_maintenance() {
        assert_eq!(segments_json(1_000, 0), "[]");
    }

    #[test]
    fn segments_json_opens_a_segment_for_active_notices() {
        let json = segments_json(1_000, 1);
        let segs: Vec<config::meta::status_pages::Segment> = serde_json::from_str(&json).unwrap();
        assert_eq!(
            segs,
            vec![config::meta::status_pages::Segment {
                from: 1_000,
                to: None
            }]
        );
    }

    #[test]
    fn close_open_segment_closes_only_the_open_one() {
        let mut model = infra::table::entity::status_page_notices::Model {
            id: "n1".into(),
            org_id: "org1".into(),
            kind: 0,
            impact: 2,
            source: 0,
            title: "t".into(),
            body: "b".into(),
            state: 1,
            starts_at: 0,
            resolved_at: None,
            segments: serde_json::to_string(&[
                config::meta::status_pages::Segment {
                    from: 0,
                    to: Some(100),
                },
                config::meta::status_pages::Segment {
                    from: 200,
                    to: None,
                },
            ])
            .unwrap(),
            excluded_from_uptime: false,
            deleted_at: None,
            auto_check_id: None,
            auto_recovery_streak: 0,
            owner: None,
            created_at: 0,
            updated_at: 0,
        };
        close_open_segment(&mut model, 300);
        let segs: Vec<config::meta::status_pages::Segment> =
            serde_json::from_str(&model.segments).unwrap();
        assert_eq!(segs[0].to, Some(100));
        assert_eq!(segs[1].to, Some(300));
    }

    #[test]
    fn argon2_hash_is_phc_and_verifies_password() {
        use argon2::{PasswordHash, PasswordVerifier};
        let h = hash_password("s3cret").unwrap();
        assert!(h.starts_with("$argon2id$"), "{h}"); // Argon2id PHC string
        let parsed = PasswordHash::new(&h).unwrap();
        assert!(
            Argon2::default()
                .verify_password("s3cret".as_bytes(), &parsed)
                .is_ok()
        );
        assert!(
            Argon2::default()
                .verify_password("wrong".as_bytes(), &parsed)
                .is_err()
        );
    }
}
