#[cfg(test)]
use std::sync::atomic::AtomicU8;
use std::{
    borrow::Cow,
    collections::{BTreeMap, BTreeSet},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};

use config::meta::{
    secret_store::{
        BindRequest, ConsumerType, Decision, GateState, ORG_ENV_ID, SecretErrorCode,
        SecretStoreAuthz,
        api::UsageEntry,
        digest::{BoundRef, DepEntry, KAuth},
        grammar::{self, RefKind, Slot},
    },
    synthetics::{ReferenceState, effective_origin},
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error as InfraError,
    secret_store::{
        bind::{self, BindError, BindPin, BindPlan, Preflight, SecretBindOption, StrictVerb},
        reauthorize::{ConsumerImage, k_auth_for},
        resolver::{self, RequestUrl, SyntheticsJob},
    },
    table::{
        entity::synthetics_locations as location_entity,
        org_secrets::{self, PrivateLocations},
        secret_aliases, secret_refs,
        secret_store_job_markers::{
            META_ORG, SYNTHETICS_WRITE_ONLY, get_marker_in, insert_if_absent_in,
        },
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, DatabaseTransaction,
    EntityTrait, QueryFilter, QueryOrder, QuerySelect, TransactionTrait, sea_query::LockType,
};
use serde_json::Value;

use super::{composition, composition_lock, *};

pub(super) const CHECK_CONSUMER: ConsumerType = ConsumerType::SyntheticsCheck;
const LOCK_BATCH_SIZE: usize = 200;
static WRITE_ONLY_READS: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
static TEST_LATCHED: AtomicU8 = AtomicU8::new(0);

/// What a list row may show about the children it references.
struct ChildFacts {
    counts: HashMap<String, usize>,
    nested: HashSet<String>,
    /// Children in folders the caller cannot list: their step counts stay unshown.
    hidden: HashSet<String>,
}

#[derive(Clone, Copy)]
pub struct CheckSaveActor<'a> {
    pub user_id: &'a str,
    pub role: &'a str,
    pub authz: &'a dyn SecretStoreAuthz,
}

#[derive(Debug, Serialize, thiserror::Error)]
#[error("{code}")]
pub struct CheckSecretRefusal {
    pub code: SecretErrorCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_hosts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locations: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Vec<UsageEntry>>,
}

impl CheckSecretRefusal {
    fn named(code: SecretErrorCode, name: &str) -> Self {
        Self {
            secret: Some(name.to_owned()),
            ..code.into()
        }
    }
}

impl From<SecretErrorCode> for CheckSecretRefusal {
    fn from(code: SecretErrorCode) -> Self {
        Self {
            code,
            secret: None,
            suggested_hosts: None,
            locations: None,
            usage: None,
        }
    }
}

#[derive(Debug, Default)]
struct CheckSlots {
    refs: Vec<(String, String)>,
    request_urls: Vec<String>,
    request_url_fields: Vec<String>,
    cookie_domains: Vec<String>,
    keyed_pointers: Vec<String>,
}

struct CheckSaver<'a> {
    updated_by: &'a str,
    actor: Option<CheckSaveActor<'a>>,
    binds: Vec<SecretBindOption>,
}

pub(super) struct SaveCompositionGuard<'a> {
    org_id: &'a str,
    guard: Option<composition_lock::CompositionGuard>,
}

impl<'a> SaveCompositionGuard<'a> {
    pub(super) async fn acquire(org_id: &'a str, locked: bool) -> anyhow::Result<Self> {
        let guard = if locked {
            Some(
                composition_lock::lock(org_id)
                    .await
                    .map_err(|e| composition::CompositionError::Lock(e.to_string()))?,
            )
        } else {
            None
        };
        Ok(Self { org_id, guard })
    }

    pub(super) async fn release(mut self) {
        if let Some(guard) = self.guard.take() {
            let org_id = self.org_id.to_owned();
            let _ =
                tokio::spawn(async move { release_composition_guard(guard, &org_id).await }).await;
        }
    }
}

impl Drop for SaveCompositionGuard<'_> {
    fn drop(&mut self) {
        if let Some(guard) = self.guard.take() {
            let org_id = self.org_id.to_owned();
            tokio::spawn(async move { release_composition_guard(guard, &org_id).await });
        }
    }
}

struct CheckBinding {
    plan: BindPlan,
    key: KAuth,
    old_updated_at: Option<i64>,
    old_refs: Vec<secret_refs::Model>,
    changed_uses: BTreeSet<String>,
    inline_refusal: Option<anyhow::Error>,
}

#[derive(Default)]
struct PrivateExposure {
    locations: BTreeSet<String>,
    adds_private: bool,
    new_embeddings: BTreeSet<String>,
}

struct WriteOnlySave<'a> {
    updated_by: &'a str,
    now: i64,
    dek: Vec<u8>,
    vars: EnvVars,
    private_locations: HashSet<String>,
}

impl<'a> WriteOnlySave<'a> {
    async fn prepare(
        org_id: &str,
        body: &Synthetic,
        updated_by: &'a str,
        has_keep: bool,
    ) -> anyhow::Result<Self> {
        let dek = if has_keep || save_needs_dek(body, true) {
            synthetics_dek(org_id).await?
        } else {
            Vec::new()
        };
        let vars = if dek.is_empty() {
            EnvVars::new()
        } else {
            load_origin_vars(org_id, body, &dek).await?
        };
        let mut private_locations = HashSet::new();
        if has_keep {
            // A concurrent update can remove a location before we lock the row.
            for id in &body.locations {
                if synthetics_locations::get(id)
                    .await?
                    .is_some_and(|row| row.kind == synthetics_locations::KIND_PRIVATE)
                {
                    private_locations.insert(id.clone());
                }
            }
        }
        Ok(Self {
            updated_by,
            now: config::utils::time::now_micros(),
            dek,
            vars,
            private_locations,
        })
    }
}

// ── Synthetics CRUD ──────────────────────────────────────────────────────────────

/// Creates a synthetic. If `folder_id` is empty or "default", auto-create the
/// default synthetics folder for the org if needed, then resolve to its PK (`folders.id`).
/// The FK on synthetics_checks.folder_id references folders.id (KSUID), not folders.folder_id.
pub async fn create_synthetic(
    org_id: &str,
    body: Synthetic,
    created_by: &str,
) -> anyhow::Result<Synthetic> {
    create_synthetic_with_binds(org_id, body, created_by, None, Vec::new())
        .await
        .map(|(check, _)| check)
}

pub async fn create_synthetic_with_binds(
    org_id: &str,
    mut body: Synthetic,
    created_by: &str,
    actor: Option<CheckSaveActor<'_>>,
    binds: Vec<SecretBindOption>,
) -> anyhow::Result<(Synthetic, Option<BindRequest>)> {
    reject_keep(&body)?;
    let has_refs = !inspect_check_refs(&body)?.refs.is_empty();
    if has_refs && actor.is_none() {
        return Err(CheckSecretRefusal::from(SecretErrorCode::SecretUseDenied).into());
    }
    validate_slot_identities(&body)?;
    // Public folder slug — OpenFGA tuples must use this (not the KSUID PK):
    // the roles UI and ?folder= permission checks all reference public slugs.
    let folder_slug = if body.folder_id.is_empty() {
        DEFAULT_FOLDER.to_string()
    } else {
        body.folder_id.clone()
    };
    body.folder_id = folder_slug.clone();
    if body.folder_id != DEFAULT_FOLDER
        && let Some(pk) = folders::get_pk_by_name(org_id, &body.folder_id, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
    {
        body.folder_id = pk;
    }
    // A new check alerts on down only unless it asks for any location (spec S7, Q3).
    body.alert_on
        .get_or_insert(config::meta::synthetics::AlertOn::Down);
    // Normalise locations — ensure aws- prefix (UI may send "us-east-1" instead of "aws-us-east-1")
    body.locations = body.locations.into_iter().map(normalize_location).collect();

    // Validate the payload (field bounds, type-specific config shape, and
    // membership against this deployment's capabilities). Runs after location
    // normalisation so membership checks see canonical ids.
    validate_against_capabilities(org_id, "", &url_validation_copy(&body), true).await?;

    let conn = get_orm_client_rw().await;
    let saver = CheckSaver {
        updated_by: created_by,
        actor,
        binds,
    };
    // Variable writes hold the same lock, so this save's variable reads and its signature land
    // wholly before or after a variable write that must re-sign it.
    let locked = has_refs || needs_composition_lock(&body.check_type);
    let guard = SaveCompositionGuard::acquire(org_id, locked).await?;
    let saved = create_synthetic_under_lock(conn, org_id, body, &saver).await;
    guard.release().await;
    let (mut result, request) = saved?;

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
    redact_save_response(org_id, &mut result).await;
    Ok((result, request))
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
        prepare_edit_view(org_id, m, &WRITE_ONLY_READS).await?;
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

/// A check's stored template override, read without decrypting its secrets; `None` when absent.
/// Read from the write connection: an update writes this value back, so a lagging replica would
/// restore an old override.
pub async fn template_of(org_id: &str, id: &str) -> anyhow::Result<Option<String>> {
    let conn = get_orm_client_rw().await;
    Ok(synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .and_then(|check| check.template))
}

/// Updates a synthetic. Recomputes `next_run_at` if the frequency changed so the
/// scheduler fires on the correct schedule without waiting for the old window.
pub async fn update_synthetic(
    org_id: &str,
    id: &str,
    body: Synthetic,
) -> anyhow::Result<Synthetic> {
    update_synthetic_as(org_id, id, body, "").await
}

pub async fn update_synthetic_as(
    org_id: &str,
    id: &str,
    body: Synthetic,
    updated_by: &str,
) -> anyhow::Result<Synthetic> {
    update_synthetic_with_binds(org_id, id, body, updated_by, None, Vec::new())
        .await
        .map(|(check, _)| check)
}

pub async fn update_synthetic_with_binds(
    org_id: &str,
    id: &str,
    mut body: Synthetic,
    updated_by: &str,
    actor: Option<CheckSaveActor<'_>>,
    binds: Vec<SecretBindOption>,
) -> anyhow::Result<(Synthetic, Option<BindRequest>)> {
    let keep = find_keep(&body);
    require_keep_gate(keep.as_deref(), store_latched())?;
    let conn = get_orm_client_rw().await;
    let stored_type = keep_stored_type(conn, org_id, id, &mut body).await?;

    // Normalise locations exactly like create — a bare region stored on update
    // would never dispatch (region is derived from the "aws-" prefix).
    body.locations = body.locations.into_iter().map(normalize_location).collect();

    // Validate before touching anything — same rules as create, except the
    // `start` freshness check (edits round-trip the original start date).
    let placeholder = if keep.is_some() {
        let copy = placeholder_copy(&body)?;
        validate_kept_snapshot(&copy)?;
        Some(copy)
    } else {
        validate_slot_identities(&body)?;
        None
    };
    let validation = placeholder.as_ref().unwrap_or(&body);
    let has_refs = !inspect_check_refs(validation)?.refs.is_empty();
    if has_refs && actor.is_none() {
        return Err(CheckSecretRefusal::from(SecretErrorCode::SecretUseDenied).into());
    }
    validate_against_capabilities(org_id, id, &url_validation_copy(validation), false).await?;

    let saver = CheckSaver {
        updated_by,
        actor,
        binds,
    };
    let locked = has_refs || stored_type.as_ref().is_some_and(needs_composition_lock);
    let guard = SaveCompositionGuard::acquire(org_id, locked).await?;
    let saved =
        update_synthetic_under_lock(conn, org_id, id, body, placeholder.as_ref(), &saver).await;
    guard.release().await;
    let (old_folder_pk, new_folder_pk, mut check, request) = saved?;

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
    redact_save_response(org_id, &mut check).await;

    Ok((check, request))
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
    let params = &with_folder_pks(conn, org_id, params).await?;

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
    let hidden = match &params.listable_folder_ids {
        Some(folder_pks) => {
            let visible = synthetics_checks::ids_in_folders(conn, org_id, &child_ids, folder_pks)
                .await
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            counts
                .keys()
                .filter(|id| !visible.contains(*id))
                .cloned()
                .collect()
        }
        None => HashSet::new(),
    };
    let children = ChildFacts {
        counts,
        nested,
        hidden,
    };
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
            &children,
            &used_by,
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
            last_run_class: m.last_run_class,
            last_run_class_at: m.last_run_class_at,
            last_check_at: (m.last_triggered_at > 0).then_some(m.last_triggered_at),
            last_response_ms: None,
            steps,
            referenced_by,
            references,
            reference_state,
            active_downtime: None,
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
    run_synthetic_now_with_secret_ids(org_id, id, &BTreeSet::new()).await
}

pub async fn bound_check_secret_ids(org_id: &str, id: &str) -> anyhow::Result<BTreeSet<String>> {
    let conn = get_orm_client_rw().await;
    Ok(bound_secret_ids(check_secret_refs(conn, org_id, id).await?))
}

pub async fn run_synthetic_now_with_secret_ids(
    org_id: &str,
    id: &str,
    authorized: &BTreeSet<String>,
) -> anyhow::Result<()> {
    let conn = get_orm_client_rw().await;
    let txn = conn.begin().await?;
    let check = locked_check(&txn, org_id, id).await?;
    let current = bound_secret_ids(check_secret_refs(&txn, org_id, id).await?);
    if !current.is_subset(authorized) {
        return Err(CheckSecretRefusal::from(SecretErrorCode::SecretUseDenied).into());
    }
    synthetics_checks::advance_schedule(&txn, id, check.last_triggered_at, 0).await?;
    txn.commit().await?;
    Ok(())
}

/// synthetics_checks.folder_id stores the folder PK (folders.id), so public folder ids resolve to
/// it; a `folder_id` with no folder of that name is kept as given, being a PK already.
pub(super) async fn with_folder_pks(
    conn: &DatabaseConnection,
    org_id: &str,
    params: &ListSyntheticsParams,
) -> anyhow::Result<ListSyntheticsParams> {
    let mut resolved = params.clone();
    if let Some(folder_slug) = &params.folder_id {
        let pk = folders::get_pk_by_name(org_id, folder_slug, FolderType::Synthetics)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        resolved.folder_id = pk.or_else(|| Some(folder_slug.clone()));
    }
    if let Some(slugs) = &params.listable_folder_ids {
        let pks = folders::get_pks_by_names(conn, org_id, slugs, FolderType::Synthetics).await?;
        resolved.listable_folder_ids = Some(pks);
    }
    Ok(resolved)
}

pub fn synthetics_consumer_image(
    snapshot: &Synthetic,
    deps: BTreeMap<String, Vec<DepEntry>>,
) -> Result<ConsumerImage, CheckSecretRefusal> {
    let stored = serialize_snapshot(snapshot)?;
    let slots = inspect_snapshot(snapshot, &stored)?;
    let deps = binding_environments(snapshot)
        .map(|env| (env.to_owned(), deps.get(env).cloned().unwrap_or_default()))
        .collect();
    Ok(ConsumerImage {
        name: snapshot.name.clone(),
        stored,
        keyed_pointers: slots.keyed_pointers,
        deps,
    })
}

/// Resolver input for an expanded snapshot in its save form: every inline value plaintext, so the
/// delivery digest is computed over the same bytes the save signed. `None` when it holds no ref.
pub(crate) async fn resolver_snapshot(
    conn: &DatabaseConnection,
    snapshot: &Synthetic,
    env_id: Option<&str>,
    job: SyntheticsJob,
    vars: &HashMap<String, String>,
    shared_rows: Option<&[SyntheticsVariableRecord]>,
) -> Result<Option<resolver::Snapshot>, SecretErrorCode> {
    let org = &snapshot.org_id;
    let stored = serialize_snapshot(snapshot).map_err(|e| e.code)?;
    let slots = inspect_snapshot(snapshot, &stored).map_err(|e| e.code)?;
    if slots.refs.is_empty() {
        return Ok(None);
    }
    let key = k_auth_for(org)
        .await
        .map_err(|_| SecretErrorCode::SecretUnavailable)?;
    let (deps, _) = check_dependencies(conn, snapshot, &key, shared_rows)
        .await
        .map_err(|e| {
            log::warn!(
                "[synthetics] check {}: dependency read failed: {e}",
                snapshot.id
            );
            SecretErrorCode::SecretUnavailable
        })?;
    let image = synthetics_consumer_image(snapshot, deps).map_err(|e| e.code)?;
    let global = synthetics_environments::global_environment_id(org);
    let env_id = match env_id {
        Some(env) if env != global => env.to_owned(),
        _ => ORG_ENV_ID.to_owned(),
    };
    let request_urls = slots
        .request_url_fields
        .into_iter()
        .zip(slots.request_urls)
        .map(|(field, raw)| RequestUrl {
            field,
            substituted: config::meta::synthetics_variables::substitute_placeholders(&raw, vars),
            store_dependency_ids: Vec::new(),
        })
        .collect();
    Ok(Some(resolver::Snapshot {
        org_id: org.clone(),
        consumer_type: CHECK_CONSUMER,
        consumer_id: snapshot.id.clone(),
        stored: image.stored,
        keyed_pointers: image.keyed_pointers,
        slot_pointers: slots
            .refs
            .into_iter()
            .map(|(field, _)| field)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        request_urls,
        write_only_names: write_only_url_names(snapshot)
            .into_iter()
            .map(str::to_owned)
            .collect(),
        deps: image.deps,
        env_id,
        job: Some(job),
    }))
}

/// Refuses a `{{NAME}}` of a write-only value in any request URL, because the runner fills URLs
/// from the same `env_inject` map that carries those values (D275 reversed, V40 N5).
pub fn refuse_write_only_url_placeholders(
    snapshot: &Synthetic,
    shared_secret_names: &[String],
) -> Result<(), SecretErrorCode> {
    let mut names = write_only_url_names(snapshot);
    names.extend(shared_secret_names.iter().map(String::as_str));
    let steps = snapshot.config["steps"].as_array().into_iter().flatten();
    let step_urls = steps.filter_map(|step| step["url"].as_str());
    let browser = snapshot.check_type == SyntheticType::Browser;
    let urls = std::iter::once(snapshot.target.as_str()).chain(step_urls.filter(|_| browser));
    for url in urls {
        for placeholder in url.split("{{").skip(1) {
            let Some((name, _)) = placeholder.split_once("}}") else {
                continue;
            };
            let name = name.trim();
            if name.starts_with(config::meta::synthetics_variables::RESERVED_VARIABLE_PREFIX)
                || (!name.starts_with("vars.") && names.contains(&name))
            {
                return Err(SecretErrorCode::RefNotAllowedInField);
            }
        }
    }
    Ok(())
}

/// Names of the org's shared `kind=secret` variables, which are write-only in a URL.
pub async fn shared_secret_names<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> anyhow::Result<Vec<String>> {
    Ok(synthetics_variables::list_cached(conn, org_id)
        .await?
        .into_iter()
        .filter(|var| var.kind == "secret")
        .map(|var| var.name)
        .collect())
}

pub(crate) fn store_var_url_for_validation(url: &str) -> Option<String> {
    let mut validation = None;
    for token in grammar::parse_refs(url).ok()?.into_iter().rev() {
        if token.kind == RefKind::Var {
            // The existing URL validator only recognizes unqualified placeholders.
            validation
                .get_or_insert_with(|| url.to_owned())
                .replace_range(token.start..token.end, "{{VALIDATION_VAR}}");
        }
    }
    validation
}

fn bound_secret_ids(refs: Vec<secret_refs::Model>) -> BTreeSet<String> {
    refs.into_iter().map(|r| r.secret_id).collect()
}

fn url_validation_copy(snapshot: &Synthetic) -> Cow<'_, Synthetic> {
    let mut validation = Cow::Borrowed(snapshot);
    if matches!(
        snapshot.check_type,
        SyntheticType::Http | SyntheticType::Browser
    ) && let Some(target) = store_var_url_for_validation(&snapshot.target)
    {
        validation.to_mut().target = target;
    }
    if snapshot.check_type == SyntheticType::Browser
        && let Some(steps) = snapshot.config["steps"].as_array()
    {
        for (i, step) in steps.iter().enumerate() {
            if let Some(url) = step["url"].as_str().and_then(store_var_url_for_validation) {
                validation.to_mut().config["steps"][i]["url"] = Value::String(url);
            }
        }
    }
    validation
}

fn binding_environments(snapshot: &Synthetic) -> impl Iterator<Item = &str> {
    snapshot
        .environments
        .iter()
        .map(|env| {
            if *env == synthetics_environments::global_environment_id(&snapshot.org_id) {
                ORG_ENV_ID
            } else {
                env.as_str()
            }
        })
        .chain(snapshot.environments.is_empty().then_some(ORG_ENV_ID))
}

fn serialize_snapshot(snapshot: &Synthetic) -> Result<Value, CheckSecretRefusal> {
    serde_json::to_value(snapshot).map_err(|_| SecretErrorCode::SecretUnavailable.into())
}

fn inspect_check_refs(snapshot: &Synthetic) -> Result<CheckSlots, CheckSecretRefusal> {
    inspect_snapshot(snapshot, &serialize_snapshot(snapshot)?)
}

fn inspect_snapshot(
    snapshot: &Synthetic,
    stored: &Value,
) -> Result<CheckSlots, CheckSecretRefusal> {
    let mut slots = CheckSlots::default();
    scan_snapshot(stored, "", snapshot, &mut slots)?;
    slots.refs.sort();
    slots.keyed_pointers.sort();
    if slots.refs.is_empty() {
        return Ok(slots);
    }
    if slots.request_urls.is_empty() {
        return Err(SecretErrorCode::InsecureTransport.into());
    }
    if let Some(headers) = stored.pointer("/config/headers").and_then(Value::as_array) {
        for name in headers.iter().filter_map(|v| v["name"].as_str()) {
            grammar::check_header_name(name, true)?;
        }
    }
    let skip_tls = stored["config"]["skip_tls_verify"].as_bool() == Some(true)
        || stored["config"]["ignore_https_errors"].as_bool() == Some(true);
    let write_only_names = write_only_url_names(snapshot);
    for url in &slots.request_urls {
        grammar::check_synthetics_url(url, &write_only_names)?;
        check_literal_request_url(url, skip_tls)?;
    }
    for domain in &slots.cookie_domains {
        let host = domain.strip_prefix('.').unwrap_or(domain);
        check_literal_request_url(&format!("https://{host}"), skip_tls)?;
        reqwest::Url::parse(&format!("https://{host}/"))
            .ok()
            .filter(|url| {
                url.has_host()
                    && url.path() == "/"
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.port().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none()
            })
            .ok_or(SecretErrorCode::InsecureTransport)?;
    }
    Ok(slots)
}

fn write_only_url_names(snapshot: &Synthetic) -> Vec<&str> {
    let mut names = vec![
        "_AUTH_USERNAME",
        "_AUTH_PASSWORD",
        "_AUTH_TOKEN",
        "_AUTH_COOKIES",
    ];
    names.extend(
        snapshot
            .variables
            .iter()
            .filter(|var| var.secure)
            .map(|var| var.name.as_str()),
    );
    if snapshot.check_type == SyntheticType::Browser
        && let Some(secrets) = snapshot.config["secrets"].as_array()
    {
        names.extend(secrets.iter().filter_map(|secret| secret["name"].as_str()));
    }
    names
}

fn check_literal_request_url(url: &str, skip_tls: bool) -> Result<(), SecretErrorCode> {
    // A query or fragment can follow the authority without a path.
    let boundary = url
        .split_once("://")
        .and_then(|(scheme, rest)| rest.find(['?', '#']).map(|i| scheme.len() + 3 + i));
    let authority_and_path = boundary.map_or(url, |i| &url[..i]);
    grammar::check_request_url(authority_and_path, skip_tls, true)?;
    if authority_and_path
        .split_once("://")
        .is_none_or(|(_, rest)| rest.is_empty() || rest.starts_with('/'))
        || authority_and_path.contains('\\')
        || !reqwest::Url::parse(url).is_ok_and(|parsed| parsed.has_host())
    {
        return Err(SecretErrorCode::InsecureTransport);
    }
    Ok(())
}

fn scan_snapshot(
    value: &Value,
    pointer: &str,
    snapshot: &Synthetic,
    slots: &mut CheckSlots,
) -> Result<(), SecretErrorCode> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if grammar::has_secret_ref(key) {
                    return Err(SecretErrorCode::RefNotAllowedInField);
                }
                let key = key.replace('~', "~0").replace('/', "~1");
                scan_snapshot(value, &format!("{pointer}/{key}"), snapshot, slots)?;
            }
        }
        Value::Array(array) => {
            for (index, value) in array.iter().enumerate() {
                scan_snapshot(value, &format!("{pointer}/{index}"), snapshot, slots)?;
            }
        }
        Value::String(text) => inspect_snapshot_field(pointer, text, snapshot, slots)?,
        _ => {}
    }
    Ok(())
}

fn inspect_snapshot_field(
    pointer: &str,
    text: &str,
    snapshot: &Synthetic,
    slots: &mut CheckSlots,
) -> Result<(), SecretErrorCode> {
    let path: Vec<_> = pointer.split('/').skip(1).collect();
    let indexed = |key: &str, index: &str| {
        index.parse::<usize>().is_ok() && snapshot.config.get(key).is_some_and(Value::is_array)
    };
    let slot = match path.as_slice() {
        ["target"] => Some(Slot::CheckUrl),
        ["config", "steps", i, "url"]
            if snapshot.check_type == SyntheticType::Browser && indexed("steps", i) =>
        {
            Some(Slot::CheckUrl)
        }
        ["auth", "password"] => Some(Slot::BasicPassword),
        ["auth", "token"] => Some(Slot::BearerToken),
        ["cookies", _, "value"] => Some(Slot::CookieValue),
        ["cookies", _, "domain"] => Some(Slot::CookieDomain),
        ["config", "headers", i, "value"]
            if matches!(
                snapshot.check_type,
                SyntheticType::Http | SyntheticType::Browser
            ) && indexed("headers", i) =>
        {
            Some(Slot::CheckHeaderValue)
        }
        ["config", "secrets", i, "value"]
            if snapshot.check_type == SyntheticType::Browser && indexed("secrets", i) =>
        {
            Some(Slot::BrowserSecretSlot)
        }
        ["config", "steps", i, "value"]
            if snapshot.check_type == SyntheticType::Browser && indexed("steps", i) =>
        {
            Some(Slot::StepValue)
        }
        _ => None,
    };
    let credential = match slot {
        Some(Slot::CheckUrl) => {
            if !text.is_empty()
                && matches!(
                    snapshot.check_type,
                    SyntheticType::Http | SyntheticType::Browser
                )
            {
                slots.request_urls.push(text.to_owned());
                slots.request_url_fields.push(pointer.to_owned());
            }
            false
        }
        Some(Slot::CookieDomain) => {
            slots.cookie_domains.push(text.to_owned());
            false
        }
        Some(_) => true,
        None => match path.as_slice() {
            ["variables", i, "value"] => i
                .parse::<usize>()
                .ok()
                .and_then(|i| snapshot.variables.get(i))
                .is_some_and(|var| var.secure),
            ["config", "body"] => snapshot.check_type == SyntheticType::Http,
            ["config", "auth", "secret"] => snapshot.check_type == SyntheticType::Ssh,
            _ => false,
        },
    };
    let tokens = match slot {
        Some(Slot::CookieDomain) | None if grammar::has_secret_ref(text) => {
            return Err(SecretErrorCode::RefNotAllowedInField);
        }
        Some(Slot::CookieDomain) | None => Vec::new(),
        Some(slot) => grammar::check_slot(CHECK_CONSUMER, &slot, text)?,
    };
    if credential && !text.is_empty() && tokens.is_empty() {
        slots.keyed_pointers.push(pointer.to_owned());
    }
    slots.refs.extend(
        tokens
            .into_iter()
            .filter(|token| token.kind == RefKind::Secret)
            .map(|token| (pointer.to_owned(), token.name)),
    );
    Ok(())
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
    let Some(stored) = synthetics_checks::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    body.check_type = stored.check_type.clone();
    keep_stored_settings(body, &stored);
    Ok(Some(stored.check_type))
}

/// A client that does not send a setting keeps the stored one, so an edit from an older UI never
/// turns "any location" into "down only", and an editor without the confirm setting never turns
/// it back on.
fn keep_stored_settings(body: &mut Synthetic, stored: &Synthetic) {
    if body.alert_on.is_none() {
        body.alert_on = stored.alert_on;
    }
    if body.confirm_failures.is_none() {
        body.confirm_failures = stored.confirm_failures;
    }
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
    saver: &CheckSaver<'_>,
) -> anyhow::Result<(Synthetic, Option<BindRequest>)> {
    // On the RW connection: a lagging read replica would reopen the race the lock closes.
    composition::validate_for_save(conn, org_id, None, &body)
        .await
        .map_err(anyhow::Error::new)?;
    body.owner = Some(saver.updated_by.to_owned());
    save_check(conn, org_id, None, body, saver).await
}

/// Returns the old and new folder PKs, so the caller handles a move after the lock is released.
async fn update_synthetic_under_lock(
    conn: &DatabaseConnection,
    org_id: &str,
    id: &str,
    mut body: Synthetic,
    placeholder: Option<&Synthetic>,
    saver: &CheckSaver<'_>,
) -> anyhow::Result<(
    Option<String>,
    Option<String>,
    Synthetic,
    Option<BindRequest>,
)> {
    // On the RW connection: a lagging read replica would reopen the race the lock closes.
    composition::validate_for_save(conn, org_id, Some(id), placeholder.unwrap_or(&body))
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

    let (check, request) = save_check(conn, org_id, Some(id), body, saver).await?;

    Ok((old_folder_pk, new_folder_pk, check, request))
}

pub(crate) fn store_latched() -> bool {
    #[cfg(test)]
    match TEST_LATCHED.load(Ordering::Relaxed) {
        1 => return false,
        2 => return true,
        _ => {}
    }
    infra::secret_store::gate::require(GateState::Latched).is_ok()
}

/// True once values are write-only. The latch alone counts and writes the marker, so the first
/// latch needs no check save before reads redact and agent tokens must be rotated.
pub(crate) async fn write_only_live_in<C: ConnectionTrait>(
    conn: &C,
    latched: bool,
    durable: impl Future<Output = anyhow::Result<bool>>,
) -> anyhow::Result<bool> {
    if get_marker_in(conn, META_ORG, SYNTHETICS_WRITE_ONLY)
        .await?
        .is_some()
    {
        return Ok(true);
    }
    // A stale or suspended view must not decrypt: the latch on record decides.
    let latched = latched || durable.await?;
    if latched {
        insert_if_absent_in(
            conn,
            META_ORG,
            SYNTHETICS_WRITE_ONLY,
            config::utils::time::now_micros(),
        )
        .await?;
    }
    Ok(latched)
}

/// The store latch on record; tests inject it instead.
pub(crate) async fn durably_latched() -> anyhow::Result<bool> {
    #[cfg(test)]
    {
        Ok(store_latched())
    }
    #[cfg(not(test))]
    {
        Ok(infra::secret_store::gate::durably_latched().await?)
    }
}

async fn write_only_reads(seen: &AtomicBool) -> anyhow::Result<bool> {
    write_only_reads_in(
        get_orm_client_rw().await,
        seen,
        store_latched(),
        durably_latched(),
    )
    .await
}

async fn write_only_reads_in<C: ConnectionTrait>(
    conn: &C,
    seen: &AtomicBool,
    latched: bool,
    durable: impl Future<Output = anyhow::Result<bool>>,
) -> anyhow::Result<bool> {
    if seen.load(Ordering::Relaxed) {
        return Ok(true);
    }
    if write_only_live_in(conn, latched, durable).await? {
        seen.store(true, Ordering::Relaxed);
    }
    Ok(seen.load(Ordering::Relaxed))
}

async fn prepare_edit_view(
    org_id: &str,
    check: &mut Synthetic,
    seen: &AtomicBool,
) -> anyhow::Result<()> {
    if write_only_reads(seen).await? {
        redact_for_edit(org_id, check).await
    } else {
        decrypt_synthetic_secrets(org_id, check).await
    }
}

/// Once values are write-only, a save answers with the edit view GET returns: only secure values
/// hide.
async fn redact_save_response(org_id: &str, check: &mut Synthetic) {
    redact_save_response_in(org_id, check, write_only_reads(&WRITE_ONLY_READS)).await;
}

/// The check is already saved, so a failed lookup answers with the full redaction, not an error.
async fn redact_save_response_in(
    org_id: &str,
    check: &mut Synthetic,
    write_only: impl Future<Output = anyhow::Result<bool>>,
) {
    let error = match write_only.await {
        Ok(true) => match redact_for_edit(org_id, check).await {
            Ok(()) => return,
            Err(error) => error,
        },
        Ok(false) => return redact_synthetic_auth(check),
        Err(error) => error,
    };
    log::error!(
        "[SYNTHETICS] saved check {} answered fully redacted: {error}",
        check.id
    );
    redact_synthetic_auth(check);
}

async fn save_check(
    conn: &DatabaseConnection,
    org_id: &str,
    id: Option<&str>,
    mut body: Synthetic,
    saver: &CheckSaver<'_>,
) -> anyhow::Result<(Synthetic, Option<BindRequest>)> {
    let latched = store_latched();
    let keep = find_keep(&body);
    require_keep_gate(keep.as_deref(), latched)?;
    let stored = match id {
        Some(id) => Some(
            synthetics_checks::get(conn, org_id, id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("check not found: {id}"))?,
        ),
        None => None,
    };
    let consumer_id = id.map_or_else(config::ider::ksuid, str::to_owned);
    body.id.clone_from(&consumer_id);
    body.org_id = org_id.to_owned();
    let write = if latched {
        Some(WriteOnlySave::prepare(org_id, &body, saver.updated_by, keep.is_some()).await?)
    } else {
        None
    };
    let mut snapshot = body.clone();
    restore_kept_values(&mut snapshot, stored.as_ref(), write.as_ref())?;
    crate::job_api::expand_snapshot_for_save(conn, &mut snapshot).await?;
    let slots = inspect_check_refs(&snapshot)?;
    refuse_write_only_url_placeholders(&snapshot, &shared_secret_names(conn, org_id).await?)
        .map_err(CheckSecretRefusal::from)?;
    let old_refs = match id {
        Some(id) => check_secret_refs(conn, org_id, id).await?,
        None => Vec::new(),
    };
    let bound = !slots.refs.is_empty() || !old_refs.is_empty();
    let actor = if bound {
        Some(
            saver
                .actor
                .ok_or_else(|| CheckSecretRefusal::from(SecretErrorCode::SecretUseDenied))?,
        )
    } else {
        if let Some(option) = saver.binds.first() {
            return Err(CheckSecretRefusal::named(
                SecretErrorCode::SecretUseDenied,
                &option.secret_id,
            )
            .into());
        }
        None
    };
    if let Some(id) = id
        && body.check_type == SyntheticType::Browser
    {
        require_current_parent_secret_use(conn, org_id, id, saver.actor).await?;
    }
    let inline = if latched {
        composition::refuse_private_embedding(conn, org_id, id, &body).await
    } else {
        Ok(())
    };
    let (saved, request) = if let Some(actor) = actor {
        let write = write.as_ref().ok_or_else(|| {
            let code = if config::get_config().common.secret_store_refs_enabled
                && infra::secret_store::mode::require_single_cluster().is_ok()
            {
                SecretErrorCode::StoreGateClosed
            } else {
                SecretErrorCode::StoreDisabled
            };
            CheckSecretRefusal::from(code)
        })?;
        let mut binding =
            prepare_check_binding(conn, &snapshot, slots, stored, old_refs, saver).await?;
        binding.inline_refusal = inline.err();
        persist_bound_check(conn, id, body, write, binding, actor).await?
    } else {
        if !latched {
            body = encrypt_synthetic_auth(org_id, body).await?;
        }
        (
            persist_check(conn, org_id, id, body, write.as_ref(), inline).await?,
            None,
        )
    };
    if latched {
        WRITE_ONLY_READS.store(true, Ordering::Relaxed);
    }
    synthetics_checks::invalidate_and_publish(org_id, &saved.id).await;
    Ok((saved, request))
}

async fn check_secret_refs<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Vec<secret_refs::Model>, InfraError> {
    secret_refs::list_for_consumer_in(conn, org, CHECK_CONSUMER.as_str(), id).await
}

async fn require_current_parent_secret_use(
    conn: &DatabaseConnection,
    org: &str,
    id: &str,
    actor: Option<CheckSaveActor<'_>>,
) -> anyhow::Result<()> {
    // An embedding or parent bind may have committed since the route's authorization check.
    let mut decisions = HashMap::new();
    let mut lacking = Vec::new();
    let parents = synthetics_refs::list_parents(conn, org, id).await?;
    let mut bound = parent_secret_ids(conn, org, &parents).await?;
    for parent in parents {
        for secret in bound.remove(&parent.id).unwrap_or_default() {
            let decision = if let Some(decision) = decisions.get(&secret) {
                *decision
            } else if let Some(actor) = actor {
                let decision = actor
                    .authz
                    .check_strict(
                        org,
                        actor.user_id,
                        actor.role,
                        &format!("secrets:{secret}"),
                        "GET",
                    )
                    .await
                    .map_err(CheckSecretRefusal::from)?;
                decisions.insert(secret, decision);
                decision
            } else {
                Decision::Deny
            };
            if decision == Decision::Deny {
                lacking.push(parent);
                break;
            }
        }
    }
    if lacking.is_empty() {
        return Ok(());
    }
    Err(composition::CompositionError::ParentSecretUseRequired(
        composition::to_public_refs(lacking).await,
    )
    .into())
}

/// The secrets each parent binds, 200 parents per statement.
async fn parent_secret_ids(
    conn: &DatabaseConnection,
    org: &str,
    parents: &[synthetics_refs::ParentRef],
) -> Result<HashMap<String, BTreeSet<String>>, InfraError> {
    use secret_refs::{Column, Entity};

    let mut bound: HashMap<String, BTreeSet<String>> = HashMap::new();
    for chunk in parents.chunks(LOCK_BATCH_SIZE) {
        #[cfg(test)]
        crate::job_api::cost::hit(org, "parent_refs_statement");
        let rows = Entity::find()
            .select_only()
            .columns([Column::ConsumerId, Column::SecretId])
            .filter(Column::OrgId.eq(org))
            .filter(Column::ConsumerType.eq(CHECK_CONSUMER.as_str()))
            .filter(Column::ConsumerId.is_in(chunk.iter().map(|parent| parent.id.clone())))
            .into_tuple::<(String, String)>()
            .all(conn)
            .await?;
        for (consumer, secret) in rows {
            bound.entry(consumer).or_default().insert(secret);
        }
    }
    Ok(bound)
}

async fn prepare_check_binding(
    conn: &DatabaseConnection,
    snapshot: &Synthetic,
    slots: CheckSlots,
    previous: Option<Synthetic>,
    old_refs: Vec<secret_refs::Model>,
    saver: &CheckSaver<'_>,
) -> anyhow::Result<CheckBinding> {
    let org = &snapshot.org_id;
    let key = k_auth_for(org).await.map_err(bind_refusal)?;
    let old_updated_at = previous.as_ref().map(|old| old.updated_at);
    let role = saver.actor.map_or("", |actor| actor.role);
    let (refs, changed_secret_ids) =
        resolve_bind_refs(conn, org, slots.refs, &old_refs, role).await?;
    for option in &saver.binds {
        if !refs.iter().any(|bound| bound.secret_id == option.secret_id) {
            return Err(CheckSecretRefusal::named(
                SecretErrorCode::SecretUseDenied,
                &option.secret_id,
            )
            .into());
        }
        if matches!(&option.pin, BindPin::Hosts(hosts) if hosts.is_empty()) {
            return Err(CheckSecretRefusal::from(SecretErrorCode::PinHostsEmpty).into());
        }
    }
    let mut previous = previous;
    if let Some(old) = &mut previous
        && !refs.is_empty()
    {
        decrypt_synthetic_secrets(org, old).await?;
        if let Err(error) = crate::job_api::expand_snapshot_for_save(conn, old).await {
            if !error.is::<crate::job_api::ConfigError>() {
                return Err(error);
            }
            // A broken old journey cannot establish that the request hosts stayed the same.
            previous = None;
        }
    }
    let (deps, dep_keys) = if refs.is_empty() {
        (BTreeMap::new(), Vec::new())
    } else {
        check_dependencies(conn, snapshot, &key, None).await?
    };
    let image = synthetics_consumer_image(snapshot, deps)?;
    let old_image = previous.as_ref().map(serialize_snapshot).transpose()?;
    let changed_uses = refs
        .iter()
        .filter(|r| {
            old_image.as_ref().and_then(|old| old.pointer(&r.field))
                != image.stored.pointer(&r.field)
        })
        .map(|r| r.secret_id.clone())
        .collect();
    let host_changed = previous.as_ref().is_none_or(|old| {
        inspect_check_refs(old).map_or(true, |old| {
            request_origins(&old.request_urls) != request_origins(&slots.request_urls)
        })
    });
    Ok(CheckBinding {
        plan: BindPlan {
            org_id: org.clone(),
            consumer_type: CHECK_CONSUMER,
            consumer_id: snapshot.id.clone(),
            saved_by: saver
                .actor
                .map_or(saver.updated_by, |actor| actor.user_id)
                .to_owned(),
            image,
            refs,
            changed_secret_ids,
            host_changed,
            request_urls: slots.request_urls,
            dep_keys,
            dep_secret_ids: Vec::new(),
            binds: saver.binds.clone(),
        },
        key,
        old_updated_at,
        old_refs,
        changed_uses,
        inline_refusal: None,
    })
}

async fn resolve_bind_refs(
    conn: &DatabaseConnection,
    org: &str,
    slots: Vec<(String, String)>,
    old_refs: &[secret_refs::Model],
    role: &str,
) -> anyhow::Result<(Vec<BoundRef>, BTreeSet<String>)> {
    let mut refs = BTreeMap::new();
    let mut changed = BTreeSet::new();
    for (field, token_name) in slots.into_iter().collect::<BTreeSet<_>>() {
        let old_ref = old_refs
            .iter()
            .find(|r| r.field == field && r.token_name == token_name);
        let row = match old_ref {
            Some(old) => org_secrets::get_secret_in(conn, org, &old.secret_id).await?,
            None => resolve_check_secret(conn, org, &token_name).await?,
        }
        .filter(|row| row.state == "active")
        .ok_or_else(|| CheckSecretRefusal::named(bind::missing_secret_code(role), &token_name))?;
        if !old_refs
            .iter()
            .any(|r| r.field == field && r.secret_id == row.id)
        {
            changed.insert(row.id.clone());
        }
        let bound = BoundRef {
            field: field.clone(),
            token_name,
            secret_id: row.id.clone(),
        };
        if refs.insert((field, row.id), bound).is_some() {
            return Err(
                CheckSecretRefusal::named(SecretErrorCode::SecretConflict, &row.name).into(),
            );
        }
    }
    Ok((refs.into_values().collect(), changed))
}

async fn resolve_check_secret(
    conn: &DatabaseConnection,
    org: &str,
    name: &str,
) -> Result<Option<org_secrets::Model>, InfraError> {
    if let Some(row) = org_secrets::get_live_by_name_in(conn, org, name).await? {
        return Ok(Some(row));
    }
    let now = config::utils::time::now_micros();
    match secret_aliases::get_alias_in(conn, org, name, now).await? {
        Some(alias) => org_secrets::get_secret_in(conn, org, &alias.secret_id).await,
        None => Ok(None),
    }
}

fn request_origins(urls: &[String]) -> BTreeSet<String> {
    urls.iter().map(|url| effective_origin(url)).collect()
}

/// `rows` is the caller's fresh read when given; otherwise one is taken here.
async fn check_dependencies(
    conn: &DatabaseConnection,
    snapshot: &Synthetic,
    key: &KAuth,
    rows: Option<&[SyntheticsVariableRecord]>,
) -> anyhow::Result<(BTreeMap<String, Vec<DepEntry>>, Vec<String>)> {
    let names = placeholder_names(&super::variables::check_placeholder_text(snapshot));
    if names.is_empty() {
        return Ok((BTreeMap::new(), Vec::new()));
    }
    let org = &snapshot.org_id;
    let read;
    let rows = match rows {
        Some(rows) => rows,
        None => {
            read = synthetics_variables::list(conn, org).await?;
            &read
        }
    };
    let dek = synthetics_dek(org).await?;
    let deps = check_dependencies_from_rows(snapshot, key, &names, rows, &dek)?;
    Ok((deps, names.into_iter().collect()))
}

pub(super) fn check_dependencies_from_rows(
    snapshot: &Synthetic,
    key: &KAuth,
    names: &BTreeSet<String>,
    rows: &[SyntheticsVariableRecord],
    dek: &[u8],
) -> anyhow::Result<BTreeMap<String, Vec<DepEntry>>> {
    let global_id = synthetics_environments::global_environment_id(&snapshot.org_id);
    let mut deps = BTreeMap::new();
    for env in binding_environments(snapshot) {
        let mut entries = Vec::new();
        for name in names {
            let entry = if snapshot.variables.iter().any(|var| var.name == *name) {
                DepEntry::Local { name: name.clone() }
            } else if let Some(row) = rows
                .iter()
                .find(|row| row.name == *name && row.env == env)
                .or_else(|| {
                    rows.iter()
                        .find(|row| row.name == *name && row.env == global_id)
                })
            {
                let decrypted;
                let value = if row.value.starts_with("AESenc:") {
                    decrypted = decrypt_secret(dek, &row.value)?;
                    &decrypted
                } else {
                    &row.value
                };
                DepEntry::legacy(key, name, &row.id, row.updated_at, value)
            } else {
                DepEntry::Absent { name: name.clone() }
            };
            entries.push(entry);
        }
        deps.insert(env.to_owned(), entries);
    }
    Ok(deps)
}

async fn private_exposure<C: ConnectionTrait>(
    conn: &C,
    body: &Synthetic,
    previous: Option<&Synthetic>,
) -> anyhow::Result<PrivateExposure> {
    let org = &body.org_id;
    let mut locations: BTreeSet<_> = body.locations.iter().cloned().collect();
    if previous.is_some() && body.check_type == SyntheticType::Browser {
        for (_, parent) in composition::parents_of_child_in(conn, org, &body.id).await? {
            locations.extend(parent.locations);
        }
    }
    let locations: BTreeSet<_> = if locations.is_empty() {
        locations
    } else {
        location_entity::Entity::find()
            .select_only()
            .column(location_entity::Column::Id)
            .filter(location_entity::Column::Id.is_in(locations))
            .filter(location_entity::Column::Kind.eq(synthetics_locations::KIND_PRIVATE))
            .into_tuple::<String>()
            .all(conn)
            .await?
            .into_iter()
            .collect()
    };
    let adds_private = body
        .locations
        .iter()
        .any(|id| locations.contains(id) && previous.is_none_or(|old| !old.locations.contains(id)));
    let mut new_embeddings = BTreeSet::new();
    if !locations.is_empty() {
        let old = previous.map(synthetics_refs::refs_of).unwrap_or_default();
        for child in synthetics_refs::refs_of(body)
            .into_iter()
            .filter(|id| adds_private || !old.contains(id))
        {
            new_embeddings.extend(
                check_secret_refs(conn, org, &child)
                    .await?
                    .into_iter()
                    .map(|r| r.secret_id),
            );
        }
    }
    Ok(PrivateExposure {
        locations,
        adds_private,
        new_embeddings,
    })
}

fn private_location_refusal(
    policy: PrivateLocations,
    newly_exposed: bool,
    name: &str,
    locations: &BTreeSet<String>,
) -> Option<CheckSecretRefusal> {
    let refused =
        policy == PrivateLocations::Off || (policy == PrivateLocations::Legacy && newly_exposed);
    (refused && !locations.is_empty()).then(|| CheckSecretRefusal {
        locations: Some(locations.iter().cloned().collect()),
        ..CheckSecretRefusal::named(SecretErrorCode::SecretPrivateLocationRefused, name)
    })
}

async fn validate_private_policy(
    txn: &DatabaseTransaction,
    org: &str,
    exposure: &PrivateExposure,
    binding: Option<(&BindPlan, &Preflight)>,
) -> Result<Option<CheckSecretRefusal>, BindError> {
    if exposure.locations.is_empty() {
        return Ok(None);
    }
    let ref_ids: BTreeSet<_> = binding
        .into_iter()
        .flat_map(|(plan, _)| plan.refs.iter().map(|r| &r.secret_id))
        .collect();
    let ids: BTreeSet<_> = exposure
        .new_embeddings
        .iter()
        .chain(ref_ids.iter().copied())
        .collect();
    if ids.is_empty() {
        return Ok(None);
    }
    let rows = lock_private_policies(txn, org, ids, binding.map(|(plan, _)| plan)).await?;
    if let Some((_, checked)) = binding
        && rows.iter().any(|row| {
            ref_ids.contains(&row.id) && checked.policy_revs.get(&row.id) != Some(&row.policy_rev)
        })
    {
        return Err(BindError::Retry);
    }
    let changed =
        |id: &String| binding.is_some_and(|(plan, _)| plan.changed_secret_ids.contains(id));
    Ok(rows
        .iter()
        .filter(|row| row.kind == "secret")
        .find_map(|row| {
            let newly_exposed = exposure.adds_private
                || exposure.new_embeddings.contains(&row.id)
                || changed(&row.id);
            private_location_refusal(
                row.private_locations,
                newly_exposed,
                &row.name,
                &exposure.locations,
            )
        }))
}

async fn lock_private_policies(
    txn: &DatabaseTransaction,
    org: &str,
    ids: BTreeSet<&String>,
    plan: Option<&BindPlan>,
) -> Result<Vec<org_secrets::Model>, InfraError> {
    let mut query = org_secrets::Entity::find()
        .filter(org_secrets::Column::OrgId.eq(org))
        .filter(org_secrets::Column::Id.is_in(ids.into_iter().map(String::as_str)))
        .order_by_asc(org_secrets::Column::Id);
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        // Take the strongest lock up front so bind_in never upgrades a shared lock.
        let writes_policy = plan.is_some_and(|plan| {
            plan.binds
                .iter()
                .any(|opt| opt.allow_this_consumer || opt.pin != BindPin::Keep)
        });
        query = query.lock(if writes_policy {
            LockType::Update
        } else {
            LockType::Share
        });
    }
    Ok(query.all(txn).await?)
}
fn require_keep_gate(field: Option<&str>, latched: bool) -> anyhow::Result<()> {
    if let Some(field) = field
        && !latched
    {
        return Err(SlotRefusal {
            code: config::meta::secret_store::SecretErrorCode::StoreGateClosed,
            field: field.to_owned(),
        }
        .into());
    }
    Ok(())
}

fn validate_kept_snapshot(body: &Synthetic) -> anyhow::Result<()> {
    let caps = config::meta::synthetics::list_capabilities();
    let devices: Vec<_> = caps.devices.into_iter().map(|d| d.id).collect();
    // Registry membership is checked on the placeholder snapshot before the transaction.
    url_validation_copy(body)
        .validate_quiet(&body.locations, &caps.browsers, &devices, false)
        .map_err(|e| anyhow::anyhow!("validation: {e}"))
}

fn bind_refusal(error: impl Into<BindError>) -> CheckSecretRefusal {
    error.into().code().into()
}

fn named_bind_refusal(error: BindError, plan: &BindPlan) -> CheckSecretRefusal {
    let code = error.code();
    let (id, suggested_hosts) = match error {
        BindError::PinRequired {
            secret_id,
            suggested_hosts,
        } => (secret_id, Some(suggested_hosts)),
        BindError::ConsumerNotAllowed { secret_id, .. } => (secret_id, None),
        _ => return code.into(),
    };
    let name = plan
        .refs
        .iter()
        .find(|r| r.secret_id == id)
        .map_or(id.as_str(), |r| &r.token_name);
    CheckSecretRefusal {
        suggested_hosts,
        ..CheckSecretRefusal::named(code, name)
    }
}

async fn preflight_check(
    conn: &DatabaseConnection,
    binding: &CheckBinding,
    actor: CheckSaveActor<'_>,
) -> Result<Preflight, BindError> {
    let plan = &binding.plan;
    let mut checked = bind::preflight_in(conn, plan, &binding.key).await?;
    checked.checks.extend(
        binding
            .changed_uses
            .iter()
            .map(|id| (id.clone(), StrictVerb::Use)),
    );
    for (id, verb) in &checked.checks {
        check_secret_strict(&plan.org_id, actor, id, *verb).await?;
    }
    Ok(checked)
}

pub(super) async fn check_secret_strict(
    org: &str,
    actor: CheckSaveActor<'_>,
    id: &str,
    verb: StrictVerb,
) -> Result<(), SecretErrorCode> {
    let (resource, method, denied) = match verb {
        StrictVerb::Use => ("secrets", "GET", SecretErrorCode::SecretUseDenied),
        StrictVerb::Manage => ("secrets", "PUT", SecretErrorCode::SecretUseDenied),
        StrictVerb::AccessPut => (
            "secret_access",
            "PUT",
            SecretErrorCode::SecretAccessRequired,
        ),
    };
    let object = format!("{resource}:{id}");
    match actor
        .authz
        .check_strict(org, actor.user_id, actor.role, &object, method)
        .await?
    {
        Decision::Allow => Ok(()),
        Decision::Deny => Err(denied),
    }
}

async fn persist_bound_check(
    conn: &DatabaseConnection,
    id: Option<&str>,
    body: Synthetic,
    write: &WriteOnlySave<'_>,
    mut binding: CheckBinding,
    actor: CheckSaveActor<'_>,
) -> anyhow::Result<(Synthetic, Option<BindRequest>)> {
    let saved = OnceLock::new();
    let refusal = OnceLock::new();
    let request = bind::bind_with_retry(
        || preflight_check(conn, &binding, actor),
        |checked| {
            let (body, saved, refusal, binding) = (&body, &saved, &refusal, &binding);
            async move {
                let txn = conn.begin().await.map_err(InfraError::from)?;
                match write_bound_check(&txn, id, body.clone(), write, binding, &checked, refusal)
                    .await
                {
                    Ok((check, created_folder, request)) => {
                        txn.commit().await.map_err(InfraError::from)?;
                        saved.get_or_init(|| (check, created_folder));
                        Ok(request)
                    }
                    Err(error) => {
                        txn.rollback().await.map_err(InfraError::from)?;
                        Err(error)
                    }
                }
            }
        },
    )
    .await
    .map_err(|e| {
        if e.code() == SecretErrorCode::SlotValueRequiredOnHostChange
            && let Some(inline) = binding.inline_refusal.take()
        {
            return inline;
        }
        refusal
            .into_inner()
            .unwrap_or_else(|| named_bind_refusal(e, &binding.plan))
            .into()
    })?;
    let (check, created_folder) = saved
        .into_inner()
        .ok_or(SecretErrorCode::SecretUnavailable)
        .map_err(CheckSecretRefusal::from)?;
    if created_folder {
        publish_default_folder(&binding.plan.org_id).await;
    }
    Ok((check, request))
}

async fn write_bound_check(
    txn: &DatabaseTransaction,
    id: Option<&str>,
    mut body: Synthetic,
    write: &WriteOnlySave<'_>,
    binding: &CheckBinding,
    checked: &Preflight,
    refusal: &OnceLock<CheckSecretRefusal>,
) -> Result<(Synthetic, bool, Option<BindRequest>), BindError> {
    let plan = &binding.plan;
    let org = &plan.org_id;
    let stored = match id {
        Some(id) => Some(locked_check(txn, org, id).await.map_err(bind_infra)?),
        None => None,
    };
    if stored.as_ref().map(|s| s.updated_at) != binding.old_updated_at
        || (id.is_some()
            && check_secret_refs(txn, org, &plan.consumer_id).await? != binding.old_refs)
    {
        return Err(BindError::Retry);
    }
    let exposure = private_exposure(txn, &body, stored.as_ref())
        .await
        .map_err(bind_infra)?;
    if let Some(error) = validate_private_policy(txn, org, &exposure, Some((plan, checked))).await?
    {
        let code = error.code;
        refusal.get_or_init(|| error);
        return Err(code.into());
    }
    if binding.inline_refusal.is_some() {
        return Err(SecretErrorCode::SlotValueRequiredOnHostChange.into());
    }
    let created_folder = if id.is_none() {
        resolve_default_folder_in(txn, org, &mut body).await?
    } else {
        false
    };
    let check = write_check_in(txn, org, id, body, Some(write), stored.as_ref())
        .await
        .map_err(bind_infra)?;
    let request = bind::bind_in(txn, plan, checked, &binding.key).await?;
    Ok((check, created_folder, request))
}

fn bind_infra(error: anyhow::Error) -> BindError {
    BindError::Infra(InfraError::Message(error.to_string()))
}

async fn resolve_default_folder_in(
    txn: &DatabaseTransaction,
    org: &str,
    body: &mut Synthetic,
) -> Result<bool, InfraError> {
    if body.folder_id != DEFAULT_FOLDER {
        return Ok(false);
    }
    let folder = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: "default".into(),
        description: "default".into(),
        icon: None,
    };
    // A concurrent default-folder insert must not poison the check transaction.
    let savepoint = txn.begin().await?;
    let ensured =
        folders::get_or_create_with(&savepoint, org, folder.clone(), FolderType::Synthetics).await;
    let (pk, _, created) = match ensured {
        Ok(row) => {
            savepoint.commit().await?;
            row
        }
        Err(_) => {
            savepoint.rollback().await?;
            folders::get_or_create_with(txn, org, folder, FolderType::Synthetics).await?
        }
    };
    body.folder_id = pk.to_string();
    Ok(created)
}

async fn publish_default_folder(org: &str) {
    if let Err(e) =
        infra::coordinator::folders::emit_put_event(org, FolderType::Synthetics, DEFAULT_FOLDER)
            .await
    {
        log::error!("[synthetics] publish default folder for {org}: {e}");
    }
    if ofga_enabled() {
        let obj = format!("{}:{DEFAULT_FOLDER}", get_ofga_type("synthetic_folder"));
        set_ownership(org, &obj, "", "").await;
    }
}

async fn locked_check(txn: &DatabaseTransaction, org: &str, id: &str) -> anyhow::Result<Synthetic> {
    lock_check(txn, org, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("check not found: {id}"))
}

pub(super) async fn lock_check(
    txn: &DatabaseTransaction,
    org: &str,
    id: &str,
) -> anyhow::Result<Option<Synthetic>> {
    use infra::table::entity::synthetics_checks::{Column, Entity};

    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org))
        .filter(Column::Id.eq(id));
    if txn.get_database_backend() != DatabaseBackend::Sqlite {
        query = query.lock_exclusive();
    }
    Ok(query.one(txn).await?.map(Synthetic::try_from).transpose()?)
}

/// Row-locks the checks `ids` (sorted) in id order, 200 per statement.
pub(super) async fn lock_checks(
    txn: &DatabaseTransaction,
    org: &str,
    ids: &[String],
) -> anyhow::Result<()> {
    use infra::table::entity::synthetics_checks::{Column, Entity};

    for chunk in ids.chunks(LOCK_BATCH_SIZE) {
        #[cfg(test)]
        crate::job_api::cost::hit(org, "check_lock_statement");
        let mut query = Entity::find()
            .select_only()
            .column(Column::Id)
            .filter(Column::OrgId.eq(org))
            .filter(Column::Id.is_in(chunk.iter().cloned()))
            .order_by_asc(Column::Id);
        if txn.get_database_backend() != DatabaseBackend::Sqlite {
            query = query.lock_exclusive();
        }
        query.into_tuple::<String>().all(txn).await?;
    }
    Ok(())
}

// The first split row and the marker must become visible in the same commit.
async fn persist_check(
    conn: &DatabaseConnection,
    org_id: &str,
    id: Option<&str>,
    mut body: Synthetic,
    write: Option<&WriteOnlySave<'_>>,
    inline: anyhow::Result<()>,
) -> anyhow::Result<Synthetic> {
    let txn = conn.begin().await?;
    let stored = match id {
        Some(id) => {
            let stored = locked_check(&txn, org_id, id).await?;
            if !check_secret_refs(&txn, org_id, id).await?.is_empty() {
                return Err(CheckSecretRefusal::from(SecretErrorCode::PolicyChanged).into());
            }
            Some(stored)
        }
        None => None,
    };
    if body.check_type == SyntheticType::Browser && !synthetics_refs::refs_of(&body).is_empty() {
        let exposure = private_exposure(&txn, &body, stored.as_ref()).await?;
        if let Some(refusal) = validate_private_policy(&txn, org_id, &exposure, None)
            .await
            .map_err(bind_refusal)?
        {
            return Err(refusal.into());
        }
    }
    inline?;
    let created_folder = if id.is_none() {
        body.id = config::ider::ksuid();
        resolve_default_folder_in(&txn, org_id, &mut body).await?
    } else {
        false
    };
    let saved = write_check_in(&txn, org_id, id, body, write, stored.as_ref()).await?;
    txn.commit().await?;
    if created_folder {
        publish_default_folder(org_id).await;
    }
    Ok(saved)
}

async fn write_check_in(
    txn: &DatabaseTransaction,
    org: &str,
    id: Option<&str>,
    mut body: Synthetic,
    write: Option<&WriteOnlySave<'_>>,
    stored: Option<&Synthetic>,
) -> anyhow::Result<Synthetic> {
    if let Some(write) = write {
        insert_if_absent_in(txn, META_ORG, SYNTHETICS_WRITE_ONLY, write.now).await?;
        let kept = restore_kept_values(&mut body, stored, Some(write))?;
        let origins = check_origins(&body, &write.vars);
        encrypt_for_write(
            &mut body,
            &write.dek,
            write.updated_by,
            write.now,
            &origins,
            &kept,
        )?;
    }
    Ok(match id {
        Some(id) => synthetics_checks::update_row(txn, org, id, &body).await?,
        None => synthetics_checks::insert_row(txn, org, &body.id, &body).await?,
    })
}

fn restore_kept_values(
    body: &mut Synthetic,
    stored: Option<&Synthetic>,
    write: Option<&WriteOnlySave<'_>>,
) -> anyhow::Result<KeptMetadata> {
    let (Some(stored), Some(write)) = (stored, write) else {
        return Ok(KeptMetadata::new());
    };
    if find_keep(body).is_none() {
        return Ok(KeptMetadata::new());
    }
    let kept = resolve_keeps(
        body,
        stored,
        &write.dek,
        &write.vars,
        &write.private_locations,
    )?;
    validate_kept_snapshot(body)?;
    Ok(kept)
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
    synthetics_jobs::drain_check(conn, org_id, id)
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
        synthetics_jobs::drain_check(conn, org_id, id)
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
    children: &ChildFacts,
    used_by: &HashMap<String, i32>,
) -> (Option<i32>, i32, Option<i32>, Option<ReferenceState>) {
    let referenced_by = used_by.get(id).copied().unwrap_or(0);
    if !is_browser {
        return (None, referenced_by, None, None);
    }
    let own_steps = own.get(id).copied().unwrap_or(0);
    let held = refs.get(id).map_or(&[][..], Vec::as_slice);
    let expanded = config::meta::synthetics_composition::expanded_step_count(
        own_steps,
        held,
        &children.counts,
    );
    let references = i32::try_from(held.len()).unwrap_or(i32::MAX);
    let reference_state = (!held.is_empty()).then(|| {
        if held.iter().any(|c| !children.counts.contains_key(c)) {
            ReferenceState::Missing
        } else if held.iter().any(|c| children.nested.contains(c)) {
            // Shown even for a hidden child: expansion rejects the parent either way.
            ReferenceState::Nested
        } else {
            ReferenceState::Ok
        }
    });
    // A total would reveal a hidden child's step count; null already reads as "not known".
    let steps = (!held.iter().any(|c| children.hidden.contains(c)))
        .then(|| i32::try_from(expanded).unwrap_or(i32::MAX));
    (steps, referenced_by, Some(references), reference_state)
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
        CheckSaver, ChildFacts, composition_fields, create_synthetic_under_lock,
        delete_synthetic_under_lock, delete_synthetics_bulk_under_lock, holds_browser_check,
        keep_stored_settings, keep_stored_type, needs_composition_lock, run_composition_mutation,
    };
    use crate::service::{
        composition::{CompositionError, tests::db_with_synthetics_defaults, validate_for_save},
        composition_lock,
    };

    #[tokio::test]
    async fn missing_check_secret_is_hidden_only_from_non_admins() {
        use config::meta::secret_store::SecretErrorCode;
        use infra::table::{org_secrets, secret_aliases};
        use sea_orm::{DatabaseBackend, MockDatabase};

        for (role, code) in [
            ("root", SecretErrorCode::SecretNotFound),
            ("admin", SecretErrorCode::SecretNotFound),
            ("editor", SecretErrorCode::SecretUseDenied),
            ("", SecretErrorCode::SecretUseDenied),
        ] {
            let conn = MockDatabase::new(DatabaseBackend::Sqlite)
                .append_query_results([Vec::<org_secrets::Model>::new()])
                .append_query_results([Vec::<secret_aliases::Model>::new()])
                .into_connection();
            let error = super::resolve_bind_refs(
                &conn,
                "org",
                vec![("/auth/token".into(), "MISSING".into())],
                &[],
                role,
            )
            .await
            .unwrap_err();
            let refusal = error.downcast_ref::<super::CheckSecretRefusal>().unwrap();
            assert_eq!(refusal.code, code);
            assert_eq!(refusal.secret.as_deref(), Some("MISSING"));
        }
    }

    /// S3-04: the check is committed by then, so a failed latch lookup must not turn it into an
    /// error.
    #[tokio::test]
    async fn a_failed_latch_lookup_after_a_save_answers_fully_redacted() {
        use config::meta::synthetics::{SyntheticAuth, SyntheticVariable};

        let mut check = Synthetic {
            auth: Some(SyntheticAuth::Basic {
                username: "u".into(),
                password: "s3-04-pw".into(),
            }),
            variables: vec![SyntheticVariable {
                name: "V".into(),
                value: "s3-04-var".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        super::redact_save_response_in("org", &mut check, async {
            Err(anyhow::anyhow!("coordinator unreachable"))
        })
        .await;
        let SyntheticAuth::Basic { password, .. } = check.auth.unwrap() else {
            panic!("auth kept its kind");
        };
        assert_eq!(password, "");
        assert_eq!(check.variables[0].value, "");
    }

    #[test]
    fn expanded_store_refs_use_only_credential_slots() {
        use config::meta::synthetics::{SyntheticAuth, SyntheticCookie};
        use serde_json::json;

        let check = Synthetic {
            check_type: SyntheticType::Browser,
            target: "https://example.test?path={{vars.PATH}}".into(),
            auth: Some(SyntheticAuth::Basic {
                username: "u".into(),
                password: "{{secrets.PASS}}".into(),
            }),
            cookies: vec![SyntheticCookie {
                domain: ".example.test".into(),
                value: "{{secrets.COOKIE}}".into(),
                ..Default::default()
            }],
            config: json!({
                "headers": [{"name": "X-Token", "value": "Bearer {{secrets.HEADER}}"}],
                "secrets": [{"name": "browserToken", "value": "{{secrets.BROWSER}}"}],
                "steps": [
                    {"id": "open", "action": "navigate", "url": "https://example.test/{{vars.PATH}}"},
                    {"id": "child_fill", "action": "fill", "value": "{{secrets.STEP}}"},
                    {"id": "fill", "action": "fill", "value": "inline credential"}
                ]
            }),
            ..Default::default()
        };
        let slots = super::inspect_check_refs(&check).unwrap();
        let refs: Vec<_> = slots
            .refs
            .iter()
            .map(|(p, name)| (p.as_str(), name.as_str()))
            .collect();
        assert_eq!(
            refs,
            [
                ("/auth/password", "PASS"),
                ("/config/headers/0/value", "HEADER"),
                ("/config/secrets/0/value", "BROWSER"),
                ("/config/steps/1/value", "STEP"),
                ("/cookies/0/value", "COOKIE"),
            ]
        );
        assert_eq!(slots.request_urls.len(), 2);
        assert_eq!(slots.keyed_pointers, ["/config/steps/2/value"]);
        let validation = super::url_validation_copy(&check);
        config::meta::synthetics::validate_http_url_quietly("target", &validation.target).unwrap();
        config::meta::synthetics::validate_http_url_quietly(
            "step URL",
            validation.config["steps"][0]["url"].as_str().unwrap(),
        )
        .unwrap();
        drop(validation);

        let bearer = Synthetic {
            auth: Some(SyntheticAuth::Bearer {
                token: "{{secrets.TOKEN}}".into(),
            }),
            ..check
        };
        assert!(
            super::inspect_check_refs(&bearer)
                .unwrap()
                .refs
                .contains(&("/auth/token".into(), "TOKEN".into()))
        );
    }

    #[test]
    fn store_refs_refuse_noncredential_fields_and_unsafe_authorities() {
        use config::meta::secret_store::SecretErrorCode::*;
        use serde_json::json;

        let browser = Synthetic {
            check_type: SyntheticType::Browser,
            target: "https://example.test/".into(),
            config: json!({"steps": [{"id": "fill", "action": "fill", "value": "{{secrets.S}}"}]}),
            ..Default::default()
        };
        for (target, code) in [
            (
                "https://example.test/?q={{secrets.S}}",
                RefNotAllowedInField,
            ),
            ("https://{{vars.HOST}}/", TemplatedAuthorityRefused),
            ("http://example.test/", InsecureTransport),
        ] {
            let mut check = browser.clone();
            check.target = target.into();
            assert_eq!(super::inspect_check_refs(&check).unwrap_err().code, code);
        }
        for config in [
            json!({"steps": [{"id": "open", "action": "navigate", "url": "https://example.test/{{secrets.S}}"}]}),
            json!({"body": "{{secrets.S}}"}),
        ] {
            let mut check = browser.clone();
            check.config = config;
            assert_eq!(
                super::inspect_check_refs(&check).unwrap_err().code,
                RefNotAllowedInField
            );
        }
        let mut check = browser.clone();
        check
            .cookies
            .push(config::meta::synthetics::SyntheticCookie {
                value: "literal".into(),
                domain: "{{HOST}}".into(),
                ..Default::default()
            });
        assert_eq!(
            super::inspect_check_refs(&check).unwrap_err().code,
            TemplatedAuthorityRefused
        );
        check.cookies[0].domain = "{{vars.HOST}}".into();
        assert_eq!(
            super::inspect_check_refs(&check).unwrap_err().code,
            TemplatedAuthorityRefused
        );
        check.cookies[0].domain = "{{secrets.HOST}}".into();
        assert_eq!(
            super::inspect_check_refs(&check).unwrap_err().code,
            RefNotAllowedInField
        );
    }

    #[test]
    fn consumer_image_digest_survives_snapshot_round_trip() {
        use config::meta::{
            secret_store::{
                ORG_ENV_ID,
                digest::{KAuth, delivery_digest},
            },
            synthetics::SyntheticAuth,
        };
        use serde_json::json;

        let check = Synthetic {
            name: "check".into(),
            target: "https://example.test/".into(),
            auth: Some(SyntheticAuth::Basic {
                username: "u".into(),
                password: "inline password".into(),
            }),
            config: json!({"headers":[{"name":"X-Token","value":"{{secrets.TOKEN}}"}]}),
            ..Default::default()
        };
        let image = super::synthetics_consumer_image(&check, Default::default()).unwrap();
        let snapshot = serde_json::from_value(image.stored.clone()).unwrap();
        let decoded = super::synthetics_consumer_image(&snapshot, Default::default()).unwrap();
        assert_eq!(image.name, decoded.name);
        assert_eq!(image.deps, decoded.deps);
        assert_eq!(
            image.deps.keys().map(String::as_str).collect::<Vec<_>>(),
            [ORG_ENV_ID]
        );
        assert_eq!(image.keyed_pointers, ["/auth/password"]);
        let key = KAuth::derive(&[7; 64]);
        let digest = |image: &infra::secret_store::reauthorize::ConsumerImage| {
            delivery_digest(
                super::CHECK_CONSUMER,
                &image.stored,
                &image.keyed_pointers,
                &key,
                |_, name| (name == "TOKEN").then(|| "secret-id".into()),
            )
            .unwrap()
        };
        assert_eq!(digest(&image), digest(&decoded));
    }

    #[test]
    fn private_location_policy_preserves_only_existing_legacy_exposure() {
        use config::meta::secret_store::SecretErrorCode::SecretPrivateLocationRefused;
        use infra::table::org_secrets::PrivateLocations::{Legacy, Off, On};

        let private = ["private-1".to_owned(), "private-2".to_owned()]
            .into_iter()
            .collect();
        for (policy, new, refused) in [
            (Off, false, true),
            (Off, true, true),
            (On, true, false),
            (Legacy, true, true),
            (Legacy, false, false),
        ] {
            let result = super::private_location_refusal(policy, new, "TOKEN", &private);
            assert_eq!(result.is_some(), refused);
            if let Some(result) = result {
                assert_eq!(result.code, SecretPrivateLocationRefused);
                assert_eq!(result.secret.as_deref(), Some("TOKEN"));
                assert_eq!(result.locations.unwrap(), ["private-1", "private-2"]);
            }
        }
        assert!(super::private_location_refusal(Off, true, "TOKEN", &Default::default()).is_none());
    }

    #[tokio::test]
    async fn a_cached_marker_keeps_edit_reads_write_only_after_the_gate_closes() {
        use super::{TEST_LATCHED, prepare_edit_view, store_latched};

        TEST_LATCHED.store(1, Ordering::Relaxed);
        assert!(!store_latched());
        let cached_marker = AtomicBool::new(true);
        let mut body = check("legacy", SyntheticType::Http);
        body.config = serde_json::json!({"body":"private-body"});
        prepare_edit_view("org1", &mut body, &cached_marker)
            .await
            .unwrap();
        assert_eq!(
            body.config["body"],
            serde_json::json!({
                "set":true, "updated_at":null, "updated_by":null
            })
        );
        TEST_LATCHED.store(0, Ordering::Relaxed);
    }

    #[tokio::test]
    async fn create_rejects_keep_and_update_requires_the_store_gate() {
        use super::{SlotRefusal, create_synthetic, update_synthetic_as};

        let mut body = check("id", SyntheticType::Http);
        body.config =
            serde_json::json!({"headers":[{"name":"Authorization","value":{"set":true}}]});
        let create = create_synthetic("org", body.clone(), "writer")
            .await
            .unwrap_err();
        assert_eq!(
            create.downcast_ref::<SlotRefusal>().unwrap().code.as_str(),
            "slot_value_required"
        );
        let update = update_synthetic_as("org", "id", body, "writer")
            .await
            .unwrap_err();
        assert_eq!(
            update.downcast_ref::<SlotRefusal>().unwrap().code.as_str(),
            "store_gate_closed"
        );
    }

    #[tokio::test]
    async fn the_first_latch_makes_edit_reads_write_only_before_any_save() {
        use infra::table::secret_store_job_markers::Entity;
        use sea_orm::{ConnectionTrait, Schema};

        use super::{META_ORG, SYNTHETICS_WRITE_ONLY, get_marker_in, write_only_reads_in};

        let db = db_with_synthetics_defaults().await;
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        let seen = AtomicBool::new(false);
        let off = || async { Ok(false) };
        assert!(!write_only_reads_in(&db, &seen, false, off()).await.unwrap());
        let marker = || get_marker_in(&db, META_ORG, SYNTHETICS_WRITE_ONLY);
        assert!(marker().await.unwrap().is_none());

        assert!(write_only_reads_in(&db, &seen, true, off()).await.unwrap());
        assert!(marker().await.unwrap().is_some());
        let restarted = AtomicBool::new(false);
        assert!(
            write_only_reads_in(&db, &restarted, false, off())
                .await
                .unwrap()
        );
    }

    /// N01: a node whose cached gate is stale or suspended still redacts once the latch is on
    /// record, and writes the marker for the nodes after it.
    #[tokio::test]
    async fn a_stale_gate_view_redacts_once_the_latch_is_on_record() {
        use infra::table::secret_store_job_markers::Entity;
        use sea_orm::{ConnectionTrait, Schema};

        use super::{META_ORG, SYNTHETICS_WRITE_ONLY, get_marker_in, write_only_reads_in};

        let db = db_with_synthetics_defaults().await;
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        let seen = AtomicBool::new(false);
        assert!(
            write_only_reads_in(&db, &seen, false, async { Ok(true) })
                .await
                .unwrap()
        );
        let marker = get_marker_in(&db, META_ORG, SYNTHETICS_WRITE_ONLY).await;
        assert!(marker.unwrap().is_some());
    }

    #[tokio::test]
    async fn only_a_committed_latched_save_sets_the_deployment_marker() {
        use infra::table::secret_store_job_markers::Entity;
        use sea_orm::{ConnectionTrait, Schema};

        use super::{META_ORG, SYNTHETICS_WRITE_ONLY, WriteOnlySave, get_marker_in, persist_check};

        let db = db_with_synthetics_defaults().await;
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        let body = check("client-id", SyntheticType::Http);
        let saved = persist_check(&db, "org", None, body.clone(), None, Ok(()))
            .await
            .unwrap();
        assert_ne!(saved.id, body.id);
        let mut write = WriteOnlySave {
            updated_by: "writer",
            now: 1,
            dek: vec![7; 64],
            vars: Default::default(),
            private_locations: Default::default(),
        };
        assert!(
            persist_check(
                &db,
                "org",
                Some("missing"),
                body.clone(),
                Some(&write),
                Ok(())
            )
            .await
            .is_err()
        );
        assert!(
            get_marker_in(&db, META_ORG, SYNTHETICS_WRITE_ONLY)
                .await
                .unwrap()
                .is_none()
        );
        for time in [10, 20] {
            write.now = time;
            persist_check(
                &db,
                "org",
                Some(&saved.id),
                body.clone(),
                Some(&write),
                Ok(()),
            )
            .await
            .unwrap();
            let marker = get_marker_in(&db, META_ORG, SYNTHETICS_WRITE_ONLY)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(marker.done_at, 10);
        }
    }

    #[tokio::test]
    async fn keep_uses_the_current_row_and_refusal_rolls_back_the_edit() {
        use infra::table::secret_store_job_markers::Entity;
        use sea_orm::{ConnectionTrait, Schema};

        use super::{SlotRefusal, WriteOnlySave, persist_check};

        let db = db_with_synthetics_defaults().await;
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        let mut write = WriteOnlySave {
            updated_by: "writer",
            now: 1,
            dek: vec![7; 64],
            vars: Default::default(),
            private_locations: Default::default(),
        };
        let mut request = check("first", SyntheticType::Http);
        request.alert_if_fails = 1;
        request.locations = vec!["aws-us-east-1".into()];
        request.target = "https://a.example/".into();
        request.config = serde_json::json!({"body": "first value"});
        let first = persist_check(&db, "org", None, request.clone(), Some(&write), Ok(()))
            .await
            .unwrap();

        write.now += 1;
        request.config["body"] = "latest value".into();
        let latest = persist_check(
            &db,
            "org",
            Some(&first.id),
            request.clone(),
            Some(&write),
            Ok(()),
        )
        .await
        .unwrap();
        assert_ne!(first.config_secrets, latest.config_secrets);

        write.now += 1;
        request.config["body"] = serde_json::json!({"set":true,"updated_at":1});
        let kept = persist_check(
            &db,
            "org",
            Some(&first.id),
            request.clone(),
            Some(&write),
            Ok(()),
        )
        .await
        .unwrap();
        assert_eq!(kept.config_secrets, latest.config_secrets);

        request.target = "https://b.example/".into();
        let err = persist_check(&db, "org", Some(&first.id), request, Some(&write), Ok(()))
            .await
            .unwrap_err();
        assert_eq!(
            err.downcast_ref::<SlotRefusal>().unwrap().code.as_str(),
            "slot_value_required_on_host_change"
        );
        let stored = synthetics_checks::get(&db, "org", &first.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.target, kept.target);
        assert_eq!(stored.updated_at, kept.updated_at);
        assert_eq!(stored.config_secrets, kept.config_secrets);
    }

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
        let mut children = ChildFacts {
            counts,
            nested,
            hidden: HashSet::new(),
        };
        let row = |id: &str, browser: bool, children: &ChildFacts| {
            composition_fields(id, browser, &own, &refs, children, &used_by)
        };
        let row_of = |id: &str, browser: bool| row(id, browser, &children);
        assert_eq!(
            row_of("p", true),
            (Some(16), 0, Some(1), Some(ReferenceState::Ok))
        );
        assert_eq!(row_of("a", true), (Some(13), 2, Some(0), None));
        assert_eq!(
            row_of("q", true),
            (Some(28), 0, Some(2), Some(ReferenceState::Ok))
        );
        assert_eq!(row_of("h", false), (None, 0, None, None));
        assert_eq!(row_of("m", true).3, Some(ReferenceState::Missing));
        assert_eq!(row_of("n", true).3, Some(ReferenceState::Nested));
        assert_eq!(row_of("b", true).3, Some(ReferenceState::Missing));

        // A hidden child hides its steps, but its nesting still blocks the parent from running.
        children.hidden = HashSet::from(["a".to_string(), "elsewhere".to_string()]);
        assert_eq!(
            row("p", true, &children),
            (None, 0, Some(1), Some(ReferenceState::Ok))
        );
        assert_eq!(
            row("n", true, &children),
            (None, 0, Some(1), Some(ReferenceState::Nested))
        );
        assert_eq!(row("b", true, &children).3, Some(ReferenceState::Missing));
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

    #[test]
    fn an_update_that_omits_the_confirm_setting_keeps_the_stored_one() {
        let mut stored = check("c", SyntheticType::Http);
        stored.confirm_failures = Some(false);
        let mut body = check("c", SyntheticType::Http);
        body.confirm_failures = None;
        keep_stored_settings(&mut body, &stored);
        assert_eq!(body.confirm_failures, Some(false));
        // A client that sends it wins.
        body.confirm_failures = Some(true);
        keep_stored_settings(&mut body, &stored);
        assert_eq!(body.confirm_failures, Some(true));
    }

    #[tokio::test]
    async fn an_update_cannot_relabel_a_browser_check_to_skip_the_save_rules() {
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
        assert!(
            matches!(err, CompositionError::ReferencedCannotHoldSubtest(_)),
            "{err:?}"
        );

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
            let saver = CheckSaver {
                updated_by: "u@x",
                actor: None,
                binds: Vec::new(),
            };
            let saved = create_synthetic_under_lock(&db, org, parent, &saver).await;
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
            (Ok((parent, _)), Err(e)) => {
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
