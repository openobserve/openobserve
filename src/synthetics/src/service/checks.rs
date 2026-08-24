use super::*;

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
    validate_against_capabilities(org_id, &body, true).await?;

    // Encrypt credential fields before persisting.
    body = encrypt_synthetic_auth(org_id, body).await?;
    body.owner = Some(created_by.to_owned());

    let conn = db()?;
    let mut result = synthetics_checks::create(conn, org_id, body, false)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

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
    let conn = db()?;
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

/// Updates a synthetic. Recomputes `next_run_at` if the frequency changed so the
/// scheduler fires on the correct schedule without waiting for the old window.
pub async fn update_synthetic(
    org_id: &str,
    id: &str,
    mut body: Synthetic,
) -> anyhow::Result<Synthetic> {
    let conn = db()?;

    // Normalise locations exactly like create — a bare region stored on update
    // would never dispatch (region is derived from the "aws-" prefix).
    body.locations = body.locations.into_iter().map(normalize_location).collect();

    // Validate before touching anything — same rules as create, except the
    // `start` freshness check (edits round-trip the original start date).
    validate_against_capabilities(org_id, &body, false).await?;

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

    let mut check = synthetics_checks::update(conn, org_id, id, body)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

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
    let conn = db()?;
    // Drain any queued checks before deleting.
    synthetics_jobs::drain_check(conn, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let deleted = synthetics_checks::delete(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
    let conn = db()?;

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
    let conn = db()?;
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
    let conn = db()?;
    let ofga = ofga_enabled();
    // Hoisted so the loop does not re-read the config per id.
    #[cfg(feature = "enterprise")]
    let replicate = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    for id in ids {
        synthetics_jobs::drain_check(conn, id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let deleted = synthetics_checks::delete(conn, org_id, id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        #[cfg(feature = "enterprise")]
        if deleted && replicate {
            o2_enterprise::enterprise::super_cluster::queue::synthetics_check_delete(org_id, id)
                .await?;
        }
        if deleted && ofga {
            let obj = format!("{}:{}", get_ofga_type("synthetics"), id);
            remove_ownership(org_id, &obj, "", "").await;
        }
    }
    Ok(())
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
    let conn = db()?;

    // Resolve slug → KSUID PK. Auto-create the default folder when necessary,
    // matching the behaviour of create_synthetic.
    let dst_pk = if dst_folder_id == DEFAULT_FOLDER {
        if !folders::exists(org_id, DEFAULT_FOLDER, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
        {
            let folder = Folder {
                folder_id: DEFAULT_FOLDER.to_owned(),
                name: "default".to_owned(),
                description: "default".to_owned(),
                icon: None,
            };
            folders::put(org_id, None, folder, FolderType::Synthetics)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        }
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
    let conn = db()?;
    let check = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {id}"))?;

    synthetics_checks::advance_schedule(conn, id, check.last_triggered_at, 0)
        .await
        .map_err(|e| anyhow::anyhow!("[synthetics] run_synthetic_now advance_schedule: {e}"))
}
