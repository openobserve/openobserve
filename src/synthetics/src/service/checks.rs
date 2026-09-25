use config::meta::synthetics::ReferenceState;
use infra::db::{get_orm_client_ro, get_orm_client_rw};
use sea_orm::DatabaseConnection;

use super::{composition, composition_lock, *};

// ── Synthetics CRUD ──────────────────────────────────────────────────────────────

/// Creates a synthetic. If `folder_id` is empty or "default", auto-create the
/// default synthetics folder for the org if needed, then resolve to its PK (`folders.id`).
/// The FK on synthetics_checks.folder_id references folders.id (KSUID), not folders.folder_id.
pub async fn create_synthetic(
    org_id: &str,
    mut body: Synthetic,
    created_by: &str,
) -> anyhow::Result<Synthetic> {
    // Public folder slug — OpenFGA tuples must use this (not the KSUID PK):
    // the roles UI and ?folder= permission checks all reference public slugs.
    let folder_slug = if body.folder_id.is_empty() {
        DEFAULT_FOLDER.to_string()
    } else {
        body.folder_id.clone()
    };
    if body.folder_id.is_empty() || body.folder_id == DEFAULT_FOLDER {
        if !folders::exists(org_id, DEFAULT_FOLDER, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            create_default_synthetics_folder(org_id).await?;
        }
        let pk = folders::get_pk_by_name(org_id, DEFAULT_FOLDER, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("default synthetics folder missing after create"))?;
        body.folder_id = pk;
    } else {
        // Non-default folder: resolve slug → KSUID PK so the FK constraint is satisfied.
        // Falls back to the original value if get_pk_by_name returns None
        // (i.e. the value is already a KSUID PK).
        if let Some(pk) = folders::get_pk_by_name(org_id, &body.folder_id, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            body.folder_id = pk;
        }
    }
    // Normalise locations — ensure aws- prefix (UI may send "us-east-1" instead of "aws-us-east-1")
    body.locations = body.locations.into_iter().map(normalize_location).collect();

    // Validate the payload (field bounds, type-specific config shape, and
    // membership against this deployment's capabilities). Runs after location
    // normalisation so membership checks see canonical ids.
    validate_against_capabilities(org_id, "", &body, true).await?;

    let conn = get_orm_client_rw().await;
    let locked = needs_composition_lock(&body.check_type);
    let (org, by) = (org_id.to_owned(), created_by.to_owned());
    let mut result = run_composition_mutation(org_id, locked, async move {
        create_synthetic_under_lock(conn, &org, body, &by).await
    })
    .await?;

    // The public slug behind the stored PK. Derived from what was written
    // rather than from the request, so a request that named its folder by PK
    // still yields a slug — and computed once, because the broadcast below and
    // the API response at the bottom both want it.
    let stored_folder_slug = folders::get_name_by_pk(&result.folder_id)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| result.folder_id.clone());

    // Broadcast before the response is reshaped: `result` still carries the
    // encrypted credential blobs, which are stripped further down for the UI.
    // The id travels with it so every region stores the same primary key.
    //
    // The folder travels as its SLUG. `result.folder_id` is a KSUID this region
    // minted for itself — the default synthetics folder is created lazily and
    // locally, so no two regions agree on it, and a check carrying one fails
    // the folder FK everywhere else, forever. The receiver resolves the slug
    // against its own folders table.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_check_create(
            org_id,
            o2_enterprise::enterprise::super_cluster::queue::SyntheticsCheckPayload::for_wire(
                org_id,
                &result,
                &stored_folder_slug,
            )
            .await?,
        )
        .await?;
    }

    let synthetic_id = result.id.clone();

    if ofga_enabled() {
        let obj = format!("{}:{}", get_ofga_type("synthetics"), synthetic_id);
        let parent_type = get_ofga_type("synthetic_folder");
        // Parent by public slug — consistent with alerts and the roles UI.
        set_ownership(org_id, &obj, &folder_slug, &parent_type).await;
    }

    // Translate stored KSUID PK back to public slug for the API response.
    result.folder_id = stored_folder_slug;
    // Never return encrypted credential blobs to the UI.
    redact_synthetic_auth(&mut result);
    Ok(result)
}

pub async fn get_synthetic(org_id: &str, id: &str) -> anyhow::Result<Option<Synthetic>> {
    let conn = get_orm_client_ro().await;
    let mut check = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if let Some(ref mut m) = check {
        // Translate stored KSUID PK back to public slug for the API response.
        m.folder_id = folders::get_name_by_pk(&m.folder_id)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| m.folder_id.clone());
        // Decrypt credentials — get_by_id returns full plaintext values.
        // Requires write permission (checked by handler). secure flag is UI-only.
        decrypt_synthetic_secrets(org_id, m).await?;
    }
    Ok(check)
}

/// The folder slug a check currently lives in, in the same public form request
/// bodies use — so a caller can tell an actual move from an unchanged round-trip.
pub async fn folder_of(org_id: &str, id: &str) -> anyhow::Result<Option<String>> {
    let conn = get_orm_client_ro().await;
    let Some(check) = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    Ok(Some(
        folders::get_name_by_pk(&check.folder_id)
            .await
            .unwrap_or(None)
            .unwrap_or(check.folder_id),
    ))
}

/// The environment ids a check runs in, read without decrypting its secrets; `None` when absent.
pub async fn environments_of(org_id: &str, id: &str) -> anyhow::Result<Option<Vec<String>>> {
    let conn = get_orm_client_ro().await;
    Ok(synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .map(|check| check.environments))
}

/// Updates a synthetic. Recomputes `next_run_at` if the frequency changed so the
/// scheduler fires on the correct schedule without waiting for the old window.
pub async fn update_synthetic(
    org_id: &str,
    id: &str,
    mut body: Synthetic,
) -> anyhow::Result<Synthetic> {
    let conn = get_orm_client_rw().await;
    let stored_type = keep_stored_type(conn, org_id, id, &mut body).await?;

    // Normalise locations exactly like create — a bare region stored on update
    // would never dispatch (region is derived from the "aws-" prefix).
    body.locations = body.locations.into_iter().map(normalize_location).collect();

    // Validate before touching anything — same rules as create, except the
    // `start` freshness check (edits round-trip the original start date).
    validate_against_capabilities(org_id, id, &body, false).await?;

    let locked = stored_type.as_ref().is_some_and(needs_composition_lock);
    let (org, check_id) = (org_id.to_owned(), id.to_owned());
    let (old_folder_pk, new_folder_pk, mut check) =
        run_composition_mutation(org_id, locked, async move {
            update_synthetic_under_lock(conn, &org, &check_id, body).await
        })
        .await?;

    // Recompute next_run_at so the scheduler uses the new frequency immediately.
    let now_us = config::utils::time::now_micros();
    let next_run_at = check
        .frequency
        .next_run_at(now_us, check.tz_offset)
        .unwrap_or(0);
    synthetics_checks::advance_schedule(conn, id, check.last_triggered_at, next_run_at)
        .await
        .map_err(|e| anyhow::anyhow!("[synthetics] advance_schedule after update: {e}"))?;

    // Same as create: the folder travels as its public slug, because the PK is
    // this region's alone. Derived from the row that was written, not from
    // `body.folder_id` — the request may name the folder either way.
    let stored_folder_slug = folders::get_name_by_pk(&check.folder_id)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| check.folder_id.clone());

    // Config only, and after every local write has landed. The
    // `advance_schedule` above is deliberately NOT replicated: `next_run_at` is
    // owned by whichever region runs the scheduler, and a region that takes the
    // role over skips forward to the next slot on its own. `check` still holds
    // the encrypted credential blobs, stripped further down for the UI.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_check_update(
            org_id,
            id,
            o2_enterprise::enterprise::super_cluster::queue::SyntheticsCheckPayload::for_wire(
                org_id,
                &check,
                &stored_folder_slug,
            )
            .await?,
        )
        .await?;
    }

    // Update OpenFGA parent relation if the folder changed.
    // Tuples use public folder slugs (not KSUID PKs) — consistent with alerts
    // and the roles UI / ?folder= permission checks.
    if ofga_enabled()
        && let (Some(old_pk), Some(new_pk)) = (&old_folder_pk, &new_folder_pk)
        && old_pk != new_pk
    {
        let old_slug = folders::get_name_by_pk(old_pk)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| old_pk.clone());
        let new_slug = folders::get_name_by_pk(new_pk)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| new_pk.clone());
        let syntype = get_ofga_type("synthetics");
        let foltype = get_ofga_type("synthetic_folder");
        set_parent_relation(id, &syntype, &new_slug, &foltype).await;
        remove_parent_relation(id, &syntype, &old_slug, &foltype).await;
    }

    // Translate stored KSUID PK back to public slug for the API response.
    check.folder_id = stored_folder_slug;
    // Never return encrypted credential blobs to the UI.
    redact_synthetic_auth(&mut check);

    Ok(check)
}

pub async fn delete_synthetic(org_id: &str, id: &str) -> anyhow::Result<bool> {
    let conn = get_orm_client_rw().await;

    let locked = holds_browser_check(conn, org_id, std::slice::from_ref(&id.to_owned())).await?;
    let (org, check_id) = (org_id.to_owned(), id.to_owned());
    let deleted = run_composition_mutation(org_id, locked, async move {
        delete_synthetic_under_lock(conn, &org, &check_id).await
    })
    .await?;
    #[cfg(feature = "enterprise")]
    if deleted
        && o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_check_delete(org_id, id)
            .await?;
    }
    if deleted && ofga_enabled() {
        let obj = format!("{}:{}", get_ofga_type("synthetics"), id);
        remove_ownership(org_id, &obj, "", "").await;
    }
    Ok(deleted)
}

/// Lists synthetics with pagination. Computed runtime fields (status, uptime, etc.)
/// are set to Unknown / None until the results stream integration is complete.
pub async fn list_synthetics(
    org_id: &str,
    params: &ListSyntheticsParams,
) -> anyhow::Result<SyntheticListResponse> {
    let conn = get_orm_client_rw().await;

    // synthetics_checks.folder_id stores the KSUID PK (folders.id), not the slug
    // (folders.folder_id). Resolve any slug → PK before filtering. Falls back to the
    // original value if get_pk_by_name returns None (value is already a KSUID PK).
    let resolved;
    let params = if let Some(folder_slug) = &params.folder_id {
        let pk = folders::get_pk_by_name(org_id, folder_slug, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        resolved = ListSyntheticsParams {
            folder_id: pk.or_else(|| Some(folder_slug.clone())),
            ..params.clone()
        };
        &resolved
    } else {
        params
    };

    let total = synthetics_checks::count(conn, org_id, params)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))? as i64;

    let checks = synthetics_checks::list(conn, org_id, params)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let ids: Vec<String> = checks.iter().map(|m| m.id.clone()).collect();
    let refs = synthetics_refs::refs_for_parents(conn, org_id, &ids)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let child_ids: Vec<String> = refs
        .values()
        .flatten()
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let counts = synthetics_refs::child_step_counts(conn, org_id, &child_ids)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Its own call: a child in another folder is not on this page, so `refs` has no entry for it.
    let nested: HashSet<String> = synthetics_refs::refs_for_parents(conn, org_id, &child_ids)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .into_keys()
        .collect();
    let used_by: HashMap<String, i32> = synthetics_refs::list_parents_for_many(conn, org_id, &ids)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .into_iter()
        .map(|(child, parents)| (child, parents.len() as i32))
        .collect();
    let own: HashMap<String, usize> = checks
        .iter()
        .map(|m| {
            (
                m.id.clone(),
                serde_json::from_value::<BrowserConfig>(m.config.clone())
                    .map(|c| c.steps.len())
                    .unwrap_or(0),
            )
        })
        .collect();

    // Translates stored KSUID PK (folders.id) back to the public slug
    // (folders.folder_id) so the API response matches the folder-list API.
    // Alerts/reports do this via a JOIN; synthetics does it with a lookup.
    //
    // The lookup is memoised per request rather than issued per check: almost
    // every check in an org sits in the same folder, so the un-memoised version
    // ran N identical point queries for one distinct answer (N=30 measured on
    // introspection; N=100 at target scale).
    let mut folder_slugs: HashMap<String, String> = HashMap::new();
    let mut items: Vec<SyntheticListItem> = Vec::with_capacity(checks.len());
    for m in checks {
        let folder_id = match folder_slugs.get(&m.folder_id) {
            Some(slug) => slug.clone(),
            None => {
                let slug = folders::get_name_by_pk(&m.folder_id)
                    .await
                    .unwrap_or(None)
                    .unwrap_or_else(|| m.folder_id.clone());
                folder_slugs.insert(m.folder_id.clone(), slug.clone());
                slug
            }
        };
        let (steps, referenced_by, references, reference_state) = composition_fields(
            &m.id,
            m.check_type == SyntheticType::Browser,
            &own,
            &refs,
            &counts,
            &used_by,
            &nested,
        );
        items.push(SyntheticListItem {
            id: m.id,
            org_id: m.org_id,
            folder_id,
            name: m.name,
            description: m.description,
            tags: m.tags,
            check_type: m.check_type,
            target: m.target,
            frequency: m.frequency,
            locations: m.locations,
            enabled: m.enabled,
            created_at: m.created_at,
            updated_at: m.updated_at,
            last_triggered_at: m.last_triggered_at,
            status: m.last_check_status,
            last_check_at: (m.last_triggered_at > 0).then_some(m.last_triggered_at),
            last_response_ms: None,
            steps,
            referenced_by,
            references,
            reference_state,
        });
    }

    Ok(SyntheticListResponse {
        checks: items,
        total,
    })
}

/// Enables or pauses a synthetic. Disabling leaves pending jobs in synthetics_jobs
/// (they expire via the reaper). Re-enabling resets next_run_at to 0 so the
/// scheduler fires immediately on the next tick.
pub async fn set_synthetic_enabled(org_id: &str, id: &str, enabled: bool) -> anyhow::Result<bool> {
    let conn = get_orm_client_rw().await;
    let changed = synthetics_checks::set_enabled(conn, org_id, id, enabled)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // On re-enable: reset next_run_at so the synthetic fires immediately.
    if changed && enabled {
        let check = synthetics_checks::get(conn, org_id, id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if let Some(m) = check {
            synthetics_checks::advance_schedule(conn, id, m.last_triggered_at, 0)
                .await
                .map_err(|e| anyhow::anyhow!("[synthetics] reset next_run_at on re-enable: {e}"))?;
        }
    }

    // `enabled` is a config column, so a pause in one region must pause
    // everywhere. Only that one column travels: the next_run_at reset above is
    // the scheduler region's own anchor, and sending the whole check here would
    // let a pause overwrite an edit this region has not seen yet.
    #[cfg(feature = "enterprise")]
    if changed
        && o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_check_set_enabled(
            org_id, id, enabled,
        )
        .await?;
    }

    Ok(changed)
}

/// Bulk-deletes a set of synthetics. Drains pending jobs for each check before
/// removing it, matching the single-delete behaviour.
pub async fn delete_synthetics_bulk(
    org_id: &str,
    ids: &[String],
    _folder_id: Option<&str>,
) -> anyhow::Result<()> {
    let conn = get_orm_client_rw().await;
    let locked = holds_browser_check(conn, org_id, ids).await?;
    let (org, batch) = (org_id.to_owned(), ids.to_vec());
    let (deleted, outcome) = run_composition_mutation(org_id, locked, async move {
        Ok(delete_synthetics_bulk_under_lock(conn, &org, &batch).await)
    })
    .await?;

    // Hoisted so the loop does not re-read the config per id.
    #[cfg(feature = "enterprise")]
    let replicate = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    let ofga = ofga_enabled();
    for id in &deleted {
        #[cfg(feature = "enterprise")]
        if replicate {
            o2_enterprise::enterprise::super_cluster::queue::synthetics_check_delete(org_id, id)
                .await?;
        }
        if ofga {
            let obj = format!("{}:{}", get_ofga_type("synthetics"), id);
            remove_ownership(org_id, &obj, "", "").await;
        }
    }
    outcome
}

/// Moves a batch of synthetics to a different folder.
///
/// `dst_folder_id` may be either the public slug (e.g. "default") or the KSUID
/// primary key. Slugs are resolved to PKs here because
/// `synthetics_checks.folder_id` stores the KSUID PK (`folders.id`), not the
/// slug (`folders.folder_id`).
pub async fn move_synthetics(
    org_id: &str,
    ids: &[String],
    dst_folder_id: &str,
) -> anyhow::Result<()> {
    let conn = get_orm_client_rw().await;

    // Resolve slug → KSUID PK. Auto-create the default folder when necessary,
    // matching the behaviour of create_synthetic.
    let dst_pk = if dst_folder_id == DEFAULT_FOLDER {
        let folder = Folder {
            folder_id: DEFAULT_FOLDER.to_owned(),
            name: "default".to_owned(),
            description: "default".to_owned(),
            icon: None,
        };
        folders::get_or_create(org_id, folder, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        folders::get_pk_by_name(org_id, DEFAULT_FOLDER, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("default synthetics folder missing after create"))?
    } else {
        // Non-default slug: resolve to PK. If it already IS a PK (KSUID), the
        // lookup returns None and we fall back to using it as-is.
        folders::get_pk_by_name(org_id, dst_folder_id, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .unwrap_or_else(|| dst_folder_id.to_owned())
    };

    let ofga = ofga_enabled();

    // Read current folder_id for each synthetic before the bulk move so we can
    // update OpenFGA parent relations (remove old, add new).
    let old_folder_pks: Vec<(String, String)> = if ofga {
        let mut pairs = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(m) = synthetics_checks::get(conn, org_id, id)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?
            {
                pairs.push((id.clone(), m.folder_id));
            }
        }
        pairs
    } else {
        vec![]
    };

    synthetics_checks::move_to_folder(conn, org_id, ids, &dst_pk)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Public slug for the destination — needed by the broadcast below and by
    // the OpenFGA tuples further down, so resolved once for both.
    let dst_slug = folders::get_name_by_pk(&dst_pk)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| dst_pk.clone());

    // The slug travels, not `dst_pk`. The default synthetics folder is minted
    // lazily per region, so its KSUID is local to this one and would fail the
    // folder FK in every other region; the receiver resolves the slug against
    // its own folders table.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_checks_move_to_folder(
            org_id, ids, &dst_slug,
        )
        .await?;
    }

    if ofga {
        // Tuples use public folder slugs — consistent with alerts and the roles UI.
        let syntype = get_ofga_type("synthetics");
        let foltype = get_ofga_type("synthetic_folder");
        for (id, old_pk) in &old_folder_pks {
            if old_pk != &dst_pk {
                let old_slug = folders::get_name_by_pk(old_pk)
                    .await
                    .unwrap_or(None)
                    .unwrap_or_else(|| old_pk.clone());
                set_parent_relation(id, &syntype, &dst_slug, &foltype).await;
                remove_parent_relation(id, &syntype, old_slug.as_str(), &foltype).await;
            }
        }
    }

    Ok(())
}

/// Triggers an immediate run by resetting `next_run_at` to 0. The scheduler
/// picks it up on the next tick (within 5 seconds) and inserts jobs.
pub async fn run_synthetic_now(org_id: &str, id: &str) -> anyhow::Result<()> {
    let conn = get_orm_client_rw().await;
    let check = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {id}"))?;

    synthetics_checks::advance_schedule(conn, id, check.last_triggered_at, 0)
        .await
        .map_err(|e| anyhow::anyhow!("[synthetics] run_synthetic_now advance_schedule: {e}"))
}

// A completed mutation must not surface as an unlock failure: the lock expires on its own.
async fn release_composition_guard(guard: composition_lock::CompositionGuard, org_id: &str) {
    if let Err(e) = guard.release().await {
        log::warn!(
            "[SYNTHETICS] org {org_id}: composition unlock failed, the lock will expire on its own: {e}"
        );
    }
}

/// When `locked`, lock, mutation and release run in a spawned task a dropped caller cannot cancel.
async fn run_composition_mutation<T, F>(
    org_id: &str,
    locked: bool,
    mutation: F,
) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: std::future::Future<Output = anyhow::Result<T>> + Send + 'static,
{
    if !locked {
        return mutation.await;
    }
    let org_id = org_id.to_owned();
    tokio::spawn(async move {
        let guard = composition_lock::lock(&org_id)
            .await
            .map_err(|e| anyhow::Error::new(composition::CompositionError::Lock(e.to_string())))?;
        let outcome = mutation.await;
        release_composition_guard(guard, &org_id).await;
        outcome
    })
    .await
    .map_err(|e| anyhow::anyhow!("composition mutation task failed: {e}"))?
}

// Only a browser check can hold or be a reference, and a check's type never changes.
fn needs_composition_lock(check_type: &SyntheticType) -> bool {
    *check_type == SyntheticType::Browser
}

// The table update keeps the stored type; validating the body's type checks the wrong rules.
async fn keep_stored_type(
    conn: &DatabaseConnection,
    org_id: &str,
    id: &str,
    body: &mut Synthetic,
) -> anyhow::Result<Option<SyntheticType>> {
    let stored = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .map(|c| c.check_type);
    if let Some(check_type) = &stored {
        body.check_type = check_type.clone();
    }
    Ok(stored)
}

async fn holds_browser_check(
    conn: &DatabaseConnection,
    org_id: &str,
    ids: &[String],
) -> anyhow::Result<bool> {
    for id in ids {
        let stored = synthetics_checks::get(conn, org_id, id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if stored.is_some_and(|c| needs_composition_lock(&c.check_type)) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Its own `?` scope, so the caller releases the lock exactly once on every outcome.
async fn create_synthetic_under_lock(
    conn: &DatabaseConnection,
    org_id: &str,
    mut body: Synthetic,
    created_by: &str,
) -> anyhow::Result<Synthetic> {
    // On the RW connection: a lagging read replica would reopen the race the lock closes.
    composition::validate_for_save(conn, org_id, None, &body)
        .await
        .map_err(anyhow::Error::new)?;

    // Encrypt credential fields before persisting.
    body = encrypt_synthetic_auth(org_id, body).await?;
    body.owner = Some(created_by.to_owned());

    synthetics_checks::create(conn, org_id, body, false)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// Returns the old and new folder PKs, so the caller handles a move after the lock is released.
async fn update_synthetic_under_lock(
    conn: &DatabaseConnection,
    org_id: &str,
    id: &str,
    mut body: Synthetic,
) -> anyhow::Result<(Option<String>, Option<String>, Synthetic)> {
    // On the RW connection: a lagging read replica would reopen the race the lock closes.
    composition::validate_for_save(conn, org_id, Some(id), &body)
        .await
        .map_err(anyhow::Error::new)?;

    // Read current folder_id (KSUID PK) before update — needed for OpenFGA relation change.
    let old_folder_pk = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .map(|m| m.folder_id);

    // Resolve folder slug → KSUID PK (FK constraint requires folders.id, not folders.folder_id).
    // Falls back to the original value if not found (already a PK).
    let new_folder_pk = if !body.folder_id.is_empty() {
        let pk = folders::get_pk_by_name(org_id, &body.folder_id, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if let Some(ref p) = pk {
            body.folder_id = p.clone();
        }
        pk.or_else(|| Some(body.folder_id.clone()))
    } else {
        None
    };

    // Encrypt credential fields before persisting.
    body = encrypt_synthetic_auth(org_id, body).await?;

    let check = synthetics_checks::update(conn, org_id, id, body)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    Ok((old_folder_pk, new_folder_pk, check))
}

/// Refuses a still-referenced check, then drains and deletes it.
async fn delete_synthetic_under_lock(
    conn: &DatabaseConnection,
    org_id: &str,
    id: &str,
) -> anyhow::Result<bool> {
    composition::ensure_not_referenced(conn, org_id, std::slice::from_ref(&id.to_owned()))
        .await
        .map_err(anyhow::Error::new)?;

    // Drain any queued checks before deleting.
    synthetics_jobs::drain_check(conn, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    synthetics_checks::delete(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// Returns the ids the bulk delete removed, plus the error that stopped it part-way, if any.
async fn delete_synthetics_bulk_under_lock(
    conn: &DatabaseConnection,
    org_id: &str,
    ids: &[String],
) -> (Vec<String>, anyhow::Result<()>) {
    let mut deleted = Vec::new();
    let outcome = delete_each_parents_first(conn, org_id, ids, &mut deleted).await;
    (deleted, outcome)
}

// Parents go first, so a failure part-way never leaves a parent whose child is gone.
async fn delete_each_parents_first(
    conn: &DatabaseConnection,
    org_id: &str,
    ids: &[String],
    deleted: &mut Vec<String>,
) -> anyhow::Result<()> {
    composition::ensure_not_referenced(conn, org_id, ids)
        .await
        .map_err(anyhow::Error::new)?;
    let parents = synthetics_refs::refs_for_parents(conn, org_id, ids)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let (first, last): (Vec<&String>, Vec<&String>) =
        ids.iter().partition(|id| parents.contains_key(*id));
    for id in first.into_iter().chain(last) {
        synthetics_jobs::drain_check(conn, id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if synthetics_checks::delete(conn, org_id, id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            deleted.push(id.clone());
        }
    }
    Ok(())
}

/// Returns (expanded steps, referenced-by count, references held, reference state) for a row.
fn composition_fields(
    id: &str,
    is_browser: bool,
    own: &HashMap<String, usize>,
    refs: &HashMap<String, Vec<String>>,
    counts: &HashMap<String, usize>,
    used_by: &HashMap<String, i32>,
    nested: &HashSet<String>,
) -> (Option<i32>, i32, Option<i32>, Option<ReferenceState>) {
    let referenced_by = used_by.get(id).copied().unwrap_or(0);
    if !is_browser {
        return (None, referenced_by, None, None);
    }
    let own_steps = own.get(id).copied().unwrap_or(0);
    let expanded = match refs.get(id) {
        Some(children) => {
            config::meta::synthetics_composition::expanded_step_count(own_steps, children, counts)
        }
        None => own_steps,
    };
    let references = refs
        .get(id)
        .map_or(0, |c| i32::try_from(c.len()).unwrap_or(i32::MAX));
    let reference_state = refs.get(id).filter(|c| !c.is_empty()).map(|children| {
        if children.iter().any(|c| !counts.contains_key(c)) {
            ReferenceState::Missing
        } else if children.iter().any(|c| nested.contains(c)) {
            ReferenceState::Nested
        } else {
            ReferenceState::Ok
        }
    });
    (
        Some(i32::try_from(expanded).unwrap_or(i32::MAX)),
        referenced_by,
        Some(references),
        reference_state,
    )
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, HashSet},
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
    };

    use config::meta::synthetics::{ReferenceState, Synthetic, SyntheticType};
    use infra::table::{synthetics_checks, synthetics_refs};

    use super::{
        composition_fields, create_synthetic_under_lock, delete_synthetic_under_lock,
        delete_synthetics_bulk_under_lock, holds_browser_check, keep_stored_type,
        needs_composition_lock, run_composition_mutation,
    };
    use crate::service::{
        composition::{
            CompositionError,
            tests::{db_with_synthetics_defaults, subtests_flag},
            validate_for_save,
        },
        composition_lock,
    };

    fn lock_calls(org_id: &str) -> usize {
        composition_lock::LOCK_CALLS
            .lock()
            .unwrap()
            .get(org_id)
            .copied()
            .unwrap_or(0)
    }

    fn check(id: &str, check_type: SyntheticType) -> Synthetic {
        Synthetic {
            id: id.into(),
            org_id: "org1".into(),
            name: id.into(),
            check_type,
            config: serde_json::json!({ "steps": [] }),
            ..Synthetic::default()
        }
    }

    #[tokio::test]
    async fn an_http_save_does_not_take_the_composition_lock() {
        let org = "org-b5-http";
        let locked = needs_composition_lock(&SyntheticType::Http);
        run_composition_mutation(org, locked, async { Ok(()) })
            .await
            .unwrap();
        assert_eq!(lock_calls(org), 0);

        let org = "org-b5-browser";
        let locked = needs_composition_lock(&SyntheticType::Browser);
        run_composition_mutation(org, locked, async { Ok(()) })
            .await
            .unwrap();
        assert_eq!(lock_calls(org), 1);
    }

    #[tokio::test]
    async fn only_a_stored_browser_check_makes_an_update_or_delete_lock() {
        let db = db_with_synthetics_defaults().await;
        synthetics_checks::create(&db, "org1", check("h", SyntheticType::Http), true)
            .await
            .unwrap();
        synthetics_checks::create(&db, "org1", check("b", SyntheticType::Browser), true)
            .await
            .unwrap();
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(
            !holds_browser_check(&db, "org1", &ids(&["h"]))
                .await
                .unwrap()
        );
        assert!(
            !holds_browser_check(&db, "org1", &ids(&["gone"]))
                .await
                .unwrap()
        );
        assert!(
            holds_browser_check(&db, "org1", &ids(&["h", "b"]))
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn a_dropped_caller_cannot_cancel_a_locked_mutation() {
        let org = "org-b5-cancel";
        let done = Arc::new(AtomicBool::new(false));
        let flag = done.clone();
        let caller = run_composition_mutation(org, true, async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            flag.store(true, Ordering::SeqCst);
            Ok(())
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), caller)
                .await
                .is_err()
        );
        let guard = composition_lock::lock(org).await.unwrap();
        assert!(
            done.load(Ordering::SeqCst),
            "the lock was free before the mutation ended"
        );
        guard.release().await.unwrap();
    }

    #[test]
    fn expanded_steps_and_referenced_by_are_attached_per_row() {
        let own = HashMap::from([
            ("p".to_string(), 4usize),
            ("a".to_string(), 13usize),
            ("q".to_string(), 4usize),
            ("m".to_string(), 2usize),
            ("n".to_string(), 2usize),
            ("b".to_string(), 2usize),
        ]);
        // `refs` holds one entry per occurrence, so `q` referencing `a` twice lists it twice.
        let refs = HashMap::from([
            ("p".to_string(), vec!["a".to_string()]),
            ("q".to_string(), vec!["a".to_string(), "a".to_string()]),
            ("m".to_string(), vec!["gone".to_string()]),
            ("n".to_string(), vec!["elsewhere".to_string()]),
            (
                "b".to_string(),
                vec!["gone".to_string(), "elsewhere".to_string()],
            ),
        ]);
        let counts = HashMap::from([
            ("a".to_string(), 13usize),
            ("elsewhere".to_string(), 3usize),
        ]);
        let used_by = HashMap::from([("a".to_string(), 2i32)]);
        // `elsewhere` is not on this page, so only the second refs call knows it holds a subtest.
        let nested = HashSet::from(["elsewhere".to_string()]);
        let row = |id: &str, browser: bool| {
            composition_fields(id, browser, &own, &refs, &counts, &used_by, &nested)
        };
        assert_eq!(
            row("p", true),
            (Some(16), 0, Some(1), Some(ReferenceState::Ok))
        );
        assert_eq!(row("a", true), (Some(13), 2, Some(0), None));
        assert_eq!(
            row("q", true),
            (Some(28), 0, Some(2), Some(ReferenceState::Ok))
        );
        assert_eq!(row("h", false), (None, 0, None, None));
        assert_eq!(row("m", true).3, Some(ReferenceState::Missing));
        assert_eq!(row("n", true).3, Some(ReferenceState::Nested));
        assert_eq!(row("b", true).3, Some(ReferenceState::Missing));
    }

    // The delete path drains `synthetics_jobs`, so it needs that table too.
    async fn db_with_jobs() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectionTrait, Schema};
        let db = db_with_synthetics_defaults().await;
        let backend = db.get_database_backend();
        db.execute(
            backend.build(
                &Schema::new(backend)
                    .create_table_from_entity(infra::table::entity::synthetics_jobs::Entity),
            ),
        )
        .await
        .unwrap();
        db
    }

    async fn parent_and_child(db: &sea_orm::DatabaseConnection, org: &str) {
        let nav = serde_json::json!({ "id": "s0", "action": "navigate", "url": "https://x" });
        synthetics_checks::create(
            db,
            org,
            browser_in(org, "child", serde_json::json!([nav])),
            true,
        )
        .await
        .unwrap();
        synthetics_checks::create(
            db,
            org,
            browser_in(
                org,
                "parent",
                serde_json::json!([nav, { "id": "r0", "action": "subtest", "subtest": { "id": "child" } }]),
            ),
            true,
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_bulk_delete_of_a_parent_and_its_child_leaves_no_refs_rows() {
        let org = "org-t3-delete";
        let db = db_with_jobs().await;
        parent_and_child(&db, org).await;
        let ids = vec!["child".to_string(), "parent".to_string()];
        let (mut deleted, outcome) = delete_synthetics_bulk_under_lock(&db, org, &ids).await;
        outcome.unwrap();
        deleted.sort();
        assert_eq!(deleted, ids);
        assert!(
            synthetics_refs::refs_for_parents(&db, org, &ids)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            synthetics_refs::list_parents_for_many(&db, org, &ids)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_folder_move_of_a_child_leaves_its_refs_rows_unchanged() {
        let org = "org-t3-move";
        let db = db_with_synthetics_defaults().await;
        parent_and_child(&db, org).await;
        let parent = ["parent".to_string()];
        let child = ["child".to_string()];
        let refs_before = synthetics_refs::refs_for_parents(&db, org, &parent)
            .await
            .unwrap();
        let parents_before = synthetics_refs::list_parents_for_many(&db, org, &child)
            .await
            .unwrap();
        assert_eq!(
            synthetics_checks::move_to_folder(&db, org, &child, "folder-2")
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            synthetics_refs::refs_for_parents(&db, org, &parent)
                .await
                .unwrap(),
            refs_before
        );
        assert_eq!(
            synthetics_refs::list_parents_for_many(&db, org, &child)
                .await
                .unwrap(),
            parents_before
        );
        assert_eq!(refs_before["parent"], ["child"]);
    }

    #[tokio::test]
    async fn an_update_cannot_relabel_a_browser_check_to_skip_the_save_rules() {
        let _flag = subtests_flag(false).await;
        let org = "org-x1";
        let db = db_with_synthetics_defaults().await;
        parent_and_child(&db, org).await;
        let mut body = browser_in(
            org,
            "child",
            serde_json::json!([{ "id": "r0", "action": "subtest", "subtest": { "id": "parent" } }]),
        );
        body.check_type = SyntheticType::Http;
        validate_for_save(&db, org, Some("child"), &body)
            .await
            .expect("an http body skips the browser save rules");

        let stored = keep_stored_type(&db, org, "child", &mut body)
            .await
            .unwrap();
        assert_eq!(stored, Some(SyntheticType::Browser));
        assert_eq!(body.check_type, SyntheticType::Browser);
        let err = validate_for_save(&db, org, Some("child"), &body)
            .await
            .unwrap_err();
        assert!(matches!(err, CompositionError::WritesDisabled), "{err:?}");

        let mut missing = check("gone", SyntheticType::Http);
        assert_eq!(
            keep_stored_type(&db, org, "gone", &mut missing)
                .await
                .unwrap(),
            None
        );
        assert_eq!(missing.check_type, SyntheticType::Http);
    }

    fn browser_in(org_id: &str, id: &str, steps: serde_json::Value) -> Synthetic {
        Synthetic {
            id: id.into(),
            org_id: org_id.into(),
            folder_id: "folder-1".into(),
            name: id.into(),
            check_type: SyntheticType::Browser,
            config: serde_json::json!({ "steps": steps }),
            ..Synthetic::default()
        }
    }

    #[tokio::test]
    async fn a_parent_save_racing_a_child_delete_cannot_commit_a_dangling_reference() {
        let _flag = subtests_flag(true).await;
        race_parent_save_against_child_delete("org-t1-save-first", true).await;
        race_parent_save_against_child_delete("org-t1-delete-first", false).await;
    }

    async fn race_parent_save_against_child_delete(org: &str, save_polled_first: bool) {
        let db = db_with_jobs().await;
        let nav = serde_json::json!({ "id": "s0", "action": "navigate", "url": "https://x" });
        synthetics_checks::create(
            &db,
            org,
            browser_in(org, "child", serde_json::json!([nav])),
            true,
        )
        .await
        .unwrap();
        let parent = browser_in(
            org,
            "",
            serde_json::json!([nav, { "id": "r0", "action": "subtest", "subtest": { "id": "child" } }]),
        );

        let save = async {
            let guard = composition_lock::lock(org).await.unwrap();
            let saved = create_synthetic_under_lock(&db, org, parent, "u@x").await;
            guard.release().await.unwrap();
            saved
        };
        let delete = async {
            let guard = composition_lock::lock(org).await.unwrap();
            let deleted = delete_synthetic_under_lock(&db, org, "child").await;
            guard.release().await.unwrap();
            deleted
        };
        let (saved, deleted) = if save_polled_first {
            tokio::join!(save, delete)
        } else {
            let (deleted, saved) = tokio::join!(delete, save);
            (saved, deleted)
        };

        let child_exists = synthetics_checks::get(&db, org, "child")
            .await
            .unwrap()
            .is_some();
        match (saved, deleted) {
            (Ok(parent), Err(e)) => {
                assert!(
                    matches!(
                        e.downcast_ref::<CompositionError>(),
                        Some(CompositionError::ReferencedBy(_))
                    ),
                    "{e}"
                );
                assert!(child_exists);
                assert!(
                    synthetics_checks::get(&db, org, &parent.id)
                        .await
                        .unwrap()
                        .is_some()
                );
            }
            (Err(e), Ok(true)) => {
                assert!(
                    matches!(
                        e.downcast_ref::<CompositionError>(),
                        Some(CompositionError::Invalid(m)) if m.contains("'child'")
                    ),
                    "{e}"
                );
                assert!(!child_exists);
            }
            (saved, deleted) => panic!("no serial order ends here: {saved:?} / {deleted:?}"),
        }
    }
}
