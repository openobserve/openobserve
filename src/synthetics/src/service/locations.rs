use infra::db::{get_orm_client_ro, get_orm_client_rw};

use super::*;

// ── Location registry (synthetics_locations table) ───────────────────────────

/// Check types public (o2-operated) locations support without any registered
/// agents — the Lambda-served set. Agent capabilities extend this (e.g. ping).
const PUBLIC_BASE_TYPES: &[&str] = &["http", "api", "tcp", "tls", "ssh", "dns", "browser"];

/// An agent is considered live while its `last_seen_at` is within this window
/// (ZO_SYNTHETICS_AGENT_STALE_SECS, default 120).
pub(crate) fn agent_liveness_window_us() -> i64 {
    config::get_config().synthetics.agent_stale_secs.max(1) * 1_000_000
}

/// `skip_serializing_if` for flags that are absent unless set — keeps a field
/// added for super cluster out of a single-region deployment's payload.
fn is_false(v: &bool) -> bool {
    !*v
}

/// One location as returned by `GET /{org}/synthetics/locations` — a superset
/// of the legacy env-derived shape (`id`/`name`/`region`/`provider`) plus
/// registry fields and computed per-type availability.
#[derive(Debug, Serialize)]
pub struct LocationEntry {
    pub id: String,
    /// Display label — user/agent-chosen (private) or o2's friendly name (public).
    pub label: String,
    pub region: String,
    pub provider: String,
    pub kind: String,
    pub pool: String,
    pub enabled: bool,
    /// Check types runnable at this location (computed: base set for public
    /// rows, live agents' self-reported capabilities for private rows).
    pub types: Vec<String>,
    /// Number of live agents serving this location.
    pub live_agents: usize,
    /// Names of the live agents (most recently seen first) — shown as subtext
    /// in the check form's private-location rows.
    pub agent_names: Vec<String>,
    /// Total registered agents (live + stale).
    pub agents_total: usize,
    /// "online" (any live agent; public rows always), "offline" (agents
    /// registered but all stale), "pending" (private row, nothing registered).
    pub status: String,
    /// True when `status` is this region's best guess rather than an
    /// observation — see [`resolve_live_status`].
    ///
    /// Additive on purpose. Widening `status` itself with a fourth value would
    /// break every client that switches on it: the locations table renders
    /// `t("synthetics.privateLocations.status." + status)`, so an unrecognised
    /// value shows the raw key path, and the check form's tier mapping treats
    /// "not online and not pending" as offline — the exact false alarm this
    /// exists to remove. An unknown field is ignored instead.
    ///
    /// Skipped when false, so a deployment without super cluster serves a
    /// byte-identical payload to the one it served before this field existed.
    #[serde(skip_serializing_if = "is_false")]
    pub live_status_unknown: bool,
    /// Binary version of the most recently seen agent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Most recent agent `last_seen_at` (epoch µs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<i64>,
    /// Synthetics in the caller's org that run from this location.
    pub checks_count: usize,
    /// Σ 60/interval_secs over the enabled synthetics above.
    pub checks_per_min: f64,
}

/// Capabilities response sourced from the location registry.
#[derive(Debug, Serialize)]
pub struct SyntheticsCapabilitiesV2 {
    pub locations: Vec<LocationEntry>,
    pub browsers: Vec<String>,
    pub devices: Vec<config::meta::synthetics::SyntheticsDevice>,
}

// NOTE: there is deliberately no env-based location seeding. The
// `synthetics_locations` table is the single source of truth: public rows
// (`org_id` NULL, visible to every org) are inserted by root/ops — via the
// root-scoped locations CRUD once it ships (P2), or a one-time SQL INSERT
// until then. Public rows use the location id as their PK (e.g.
// `aws-us-east-1`) because synthetics reference locations by that string;
// private rows use KSUIDs.

/// Merges an agent capabilities JSON blob into a type set.
fn merge_agent_capabilities(
    types: &mut std::collections::BTreeSet<String>,
    caps: &serde_json::Value,
) {
    if let Some(list) = caps.get("types").and_then(|t| t.as_array()) {
        for t in list.iter().filter_map(|v| v.as_str()) {
            types.insert(t.to_string());
        }
    }
    if caps.get("icmp").and_then(|v| v.as_bool()).unwrap_or(false) {
        types.insert("ping".to_string());
    }
}

/// Locations visible to an org (all public rows + the org's private rows) with
/// per-type availability computed from live agents' capabilities.
pub async fn list_locations_for_org(org_id: &str) -> anyhow::Result<SyntheticsCapabilitiesV2> {
    let rows = synthetics_locations::list_visible(org_id).await?;

    // One org-wide checks fetch, bucketed per location below — avoids a
    // JSON-contains query per row (locations arrays are filtered in Rust).
    let checks = synthetics_checks::list(
        get_orm_client_rw().await,
        org_id,
        &ListSyntheticsParams::default(),
    )
    .await
    .unwrap_or_default();

    // One agents query for every location, not one per location. The checks
    // fetch above was already hoisted out of this loop for the same reason.
    let location_ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
    let agents_by_location = synthetics_agents::list_by_locations(&location_ids)
        .await
        .unwrap_or_default();

    let mut locations = Vec::with_capacity(rows.len());
    for row in rows {
        let agents = agents_by_location.get(&row.id).cloned().unwrap_or_default();
        locations.push(location_entry(row, &agents, &checks));
    }

    let caps = config::meta::synthetics::list_capabilities();
    Ok(SyntheticsCapabilitiesV2 {
        locations,
        browsers: caps.browsers,
        devices: caps.devices,
    })
}

/// What this region is entitled to say about a location's agents.
#[derive(Debug, PartialEq)]
pub(crate) struct LiveStatus {
    /// The `status` string, unchanged from what this endpoint has always sent.
    status: &'static str,
    /// True when `status` is what this region assumes rather than what it saw.
    unknown: bool,
}

/// Decides `status` and whether it is knowable here, from the only four things
/// that bear on it. Pure and DB-free, so its tests are the whole contract.
///
/// ## Why the "no agents registered" case is not simply reportable
///
/// `synthetics_agents` is region-local and must never replicate (spec §3): an
/// agent registers against whichever region its poll endpoint resolves to —
/// `POST /{org}/synthetics/agent/register` is an ordinary ingester route with
/// no role or region steering — and replicating those rows would advertise
/// agents that can never be leased while multiplying `last_seen_at` writes by
/// the number of regions.
///
/// Locations, though, DO replicate as of this branch. So a private location
/// whose agents registered in r1 now also renders in r2 and r3, where it has
/// no agent rows at all and comes out as "pending" — this region telling the
/// customer to go install an agent for a location that is up and running
/// checks somewhere else. Zero rows means two different things:
///
/// - single region — nothing registered anywhere. An observation.
/// - super cluster — nothing registered *here*. Says nothing about elsewhere.
///
/// ## Why the condition is not "this region runs no scheduler"
///
/// That was the obvious candidate — the local cluster view already answers it
/// (`reaper::orphan::is_scan_leader`) — and it is wrong in both directions.
/// Registration is an ingester route gated only on `ZO_SYNTHETICS_ENABLED`, so
/// scheduler placement has no bearing on where agent rows land:
///
/// - a region that DOES run the scheduler still has no rows if the agents' `AGENT_POLL_ENDPOINT`
///   points somewhere else — it would keep lying;
/// - a region that runs NO scheduler still holds real rows for the agents that do poll it (§9's
///   mis-pointed agents, which lease nothing but are alive) — it would be told to discard evidence
///   it actually has.
///
/// It is also a coordinator read that falls back to "assume leader" when the
/// view is unavailable, which would flap this field on infra noise.
///
/// The question is not "does this region schedule" but "is this region's zero
/// evidence of absence", and the agent rows answer that on their own.
///
/// ## Why "offline" is left alone
///
/// Rows present and all stale is positive local evidence that those specific
/// agents are down, and it is the strongest evidence anywhere — no other
/// region can see them either. Widening `unknown` to cover it would suppress a
/// genuine outage, and a false "unknown" on a location that really is down is
/// the same defect as a false "offline", just quieter.
pub(crate) fn resolve_live_status(
    is_public: bool,
    agents_total: usize,
    live_agents: usize,
    super_cluster_enabled: bool,
) -> LiveStatus {
    // Public locations are o2-operated (Lambda venue) and not agent-derived —
    // always online, never in doubt.
    if is_public || live_agents > 0 {
        LiveStatus {
            status: "online",
            unknown: false,
        }
    } else if agents_total == 0 {
        LiveStatus {
            status: "pending",
            unknown: super_cluster_enabled,
        }
    } else {
        LiveStatus {
            status: "offline",
            unknown: false,
        }
    }
}

/// Builds one list entry from a location row, its registered agents, and the
/// org's checks (bucketed here by `locations` membership).
pub(crate) fn location_entry(
    row: synthetics_locations::SyntheticsLocationRecord,
    agents: &[synthetics_agents::SyntheticsAgentRecord],
    org_checks: &[Synthetic],
) -> LocationEntry {
    let now = config::utils::time::now_micros();
    let window = agent_liveness_window_us();
    let live: Vec<_> = agents
        .iter()
        .filter(|a| now - a.last_seen_at <= window)
        .collect();

    let mut types = std::collections::BTreeSet::new();
    if row.kind == synthetics_locations::KIND_PUBLIC {
        types.extend(PUBLIC_BASE_TYPES.iter().map(|s| s.to_string()));
    }
    for agent in &live {
        if let Some(caps) = &agent.capabilities {
            merge_agent_capabilities(&mut types, caps);
        }
    }

    let newest = agents.iter().max_by_key(|a| a.last_seen_at);
    // Reads the same flag the publishes guard on, and publishes nothing: it
    // decides whether a location's missing agent rows are evidence or just this
    // region's blind spot. Spelled out here rather than hidden behind a helper
    // so that `every_broadcast_is_gated_on_super_cluster_being_enabled` can
    // count it, which is what keeps its guard-per-publish assertion exact.
    #[cfg(feature = "enterprise")]
    let super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    #[cfg(not(feature = "enterprise"))]
    let super_cluster = false;

    let live_status = resolve_live_status(
        row.kind == synthetics_locations::KIND_PUBLIC,
        agents.len(),
        live.len(),
        super_cluster,
    );

    let referencing: Vec<_> = org_checks
        .iter()
        .filter(|m| m.locations.iter().any(|l| l == &row.id))
        .collect();
    let checks_per_min: f64 = referencing
        .iter()
        .filter(|m| m.enabled)
        .map(|m| 60.0 / m.frequency.interval_secs().max(1) as f64)
        .sum();

    LocationEntry {
        id: row.id,
        label: row.label,
        region: row.region,
        provider: row.provider,
        kind: row.kind,
        pool: row.pool,
        enabled: row.enabled,
        types: types.into_iter().collect(),
        agent_names: live.iter().map(|a| a.name.clone()).collect(),
        live_agents: live.len(),
        agents_total: agents.len(),
        status: live_status.status.to_string(),
        live_status_unknown: live_status.unknown,
        version: newest.and_then(|a| a.version.clone()),
        last_seen_at: newest.map(|a| a.last_seen_at),
        checks_count: referencing.len(),
        checks_per_min: (checks_per_min * 100.0).round() / 100.0,
    }
}

// ── Location CRUD ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateLocationRequest {
    /// "public" (root only, visible to all orgs) | "private" (default).
    #[serde(default = "default_location_kind")]
    pub kind: String,
    /// Public rows may pin their id (e.g. "aws-us-east-1" — synthetics
    /// reference locations by this string). Ignored for private rows (KSUID).
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default = "default_location_provider")]
    pub provider: String,
    pub region: String,
    pub label: String,
    /// Queue routing key; defaults to `net-<id>` (public) or
    /// `private-<org>-<region>` (private).
    #[serde(default)]
    pub pool: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_location_kind() -> String {
    synthetics_locations::KIND_PRIVATE.to_string()
}
fn default_location_provider() -> String {
    "custom".to_string()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct UpdateLocationRequest {
    pub label: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// Legacy compat: old UIs sent bare AWS regions ("us-east-1") for public
/// locations, which are stored prefixed ("aws-us-east-1"). Only values shaped
/// like a bare cloud region get the prefix — anything else (private-location
/// KSUIDs, already-prefixed ids) passes through untouched.
pub(crate) fn normalize_location(loc: String) -> String {
    if loc.starts_with("aws-") || loc.starts_with("gcp-") || loc.starts_with("azure-") {
        return loc;
    }
    // Bare region shape: lowercase alpha groups separated by '-', ending in a
    // number (us-east-1, eu-west-2, ap-southeast-2).
    let mut parts = loc.split('-').collect::<Vec<_>>();
    let bare_region = parts.len() >= 3
        && parts
            .pop()
            .is_some_and(|p| p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty())
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase()));
    if bare_region {
        format!("aws-{loc}")
    } else {
        loc
    }
}

/// Loads a location and checks write access: public rows require root, private
/// rows must belong to the caller's org.
pub(crate) async fn location_for_write(
    org_id: &str,
    is_root: bool,
    id: &str,
) -> anyhow::Result<synthetics_locations::SyntheticsLocationRecord> {
    let loc = synthetics_locations::get(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("location not found: {id}"))?;
    match &loc.org_id {
        None if !is_root => Err(anyhow::anyhow!(
            "forbidden: public locations are managed by the root user"
        )),
        Some(owner) if owner != org_id => Err(anyhow::anyhow!("location not found: {id}")),
        _ => Ok(loc),
    }
}

/// Response for a location create: private rows carry the org's `o2syn_`
/// token and a ready-to-paste agent install command for the setup drawer.
#[derive(Debug, Serialize)]
pub struct CreateLocationResponse {
    pub location: synthetics_locations::SyntheticsLocationRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install: Option<String>,
}

/// Creates a location. Public rows (visible to every org) are root-only.
pub async fn create_location(
    org_id: &str,
    is_root: bool,
    req: CreateLocationRequest,
) -> anyhow::Result<CreateLocationResponse> {
    let record = match req.kind.as_str() {
        synthetics_locations::KIND_PUBLIC => {
            if !is_root {
                return Err(anyhow::anyhow!(
                    "forbidden: public locations are managed by the root user"
                ));
            }
            let id = req
                .id
                .clone()
                .unwrap_or_else(|| format!("{}-{}", req.provider, req.region));
            let pool = req.pool.clone().unwrap_or_else(|| format!("net-{id}"));
            (id, None, pool)
        }
        // A private location is a pool served by long-running agents inside a
        // customer VPC, and that fleet is the one part of synthetics that stays
        // enterprise. Refused rather than created: a private location an OSS
        // build cannot serve would accept checks and never run them, which
        // reads as a broken deployment rather than an unavailable feature.
        #[cfg(not(feature = "enterprise"))]
        synthetics_locations::KIND_PRIVATE => {
            // `validation:` is load-bearing, not decoration: `location_error_response`
            // keys the HTTP status off this prefix, and without it an unsupported
            // `kind` is reported as a 500 — a caller error dressed up as a server
            // fault. Same status as the unknown-`kind` arm below, which is the same
            // class of mistake.
            return Err(anyhow::anyhow!(
                "validation: private locations require enterprise — they are served by agents \
                 deployed inside your network. Use a public location backed by a Lambda probe \
                 instead."
            ));
        }
        #[cfg(feature = "enterprise")]
        synthetics_locations::KIND_PRIVATE => {
            let id = config::ider::uuid();
            let pool = req.pool.clone().unwrap_or_else(|| {
                format!(
                    "private-{org_id}-{}",
                    config::meta::synthetics::slugify(&req.region)
                )
            });
            (id, Some(org_id.to_owned()), pool)
        }
        other => return Err(anyhow::anyhow!("validation: invalid kind {other:?}")),
    };
    let (id, row_org, pool) = record;

    if synthetics_locations::get(&id).await?.is_some() {
        return Err(anyhow::anyhow!(
            "validation: location {id:?} already exists"
        ));
    }
    if synthetics_locations::find_by_pool(&pool).await?.is_some() {
        return Err(anyhow::anyhow!("validation: pool {pool:?} already in use"));
    }

    let now = config::utils::time::now_micros();
    let record = synthetics_locations::SyntheticsLocationRecord {
        id,
        org_id: row_org,
        kind: req.kind,
        provider: req.provider,
        region: req.region,
        label: req.label,
        pool,
        enabled: req.enabled,
        created_at: now,
        updated_at: now,
    };
    synthetics_locations::add(&record).await?;
    // A region that has never seen this row cannot render it, and its scheduler
    // cannot resolve the pool a job for it routes into. `org_id` and `kind`
    // both travel — the row stores its scope twice and `list_visible` filters
    // on `org_id`, so a private location arriving public would be handed to
    // every org in the cluster.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_location_create(
            (&record).into(),
        )
        .await?;
    }
    // Reads the org's default token to compose an install command; it mints
    // nothing, so there is no write here to replicate.
    let (token, install) = private_location_install(org_id, &record).await;
    Ok(CreateLocationResponse {
        location: record,
        token,
        install,
    })
}

// ── Location detail ───────────────────────────────────────────────────────────

/// A registered agent as shown on the location detail page (read-only —
/// agents self-register; there is nothing to edit).
#[derive(Debug, Serialize)]
pub struct LocationAgentInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<serde_json::Value>,
    pub last_seen_at: i64,
    pub created_at: i64,
    pub live: bool,
}

/// One synthetic assigned to the location, for the detail page's checks table.
#[derive(Debug, Serialize)]
pub struct LocationCheckSummary {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub check_type: config::meta::synthetics::SyntheticType,
    pub interval_secs: i64,
    pub enabled: bool,
    pub last_check_status: config::meta::synthetics::SyntheticStatus,
}

/// `GET /{org}/synthetics/locations/{id}` — the location entry (same stats as
/// the list) plus its agents and assigned checks.
#[derive(Debug, Serialize)]
pub struct LocationDetail {
    #[serde(flatten)]
    pub location: LocationEntry,
    pub agents: Vec<LocationAgentInfo>,
    pub checks: Vec<LocationCheckSummary>,
    /// Install command for private rows (setup drawer's "copy" action).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install: Option<String>,
}

pub async fn location_detail(org_id: &str, id: &str) -> anyhow::Result<LocationDetail> {
    let row = synthetics_locations::get(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("location not found: {id}"))?;
    // Private rows of another org are invisible, same as list_visible.
    if let Some(loc_org) = &row.org_id
        && loc_org != org_id
    {
        return Err(anyhow::anyhow!("location not found: {id}"));
    }

    let agents = synthetics_agents::list_by_location(&row.id)
        .await
        .unwrap_or_default();
    let checks =
        synthetics_checks::list_referencing_location(get_orm_client_rw().await, org_id, &row.id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let now = config::utils::time::now_micros();
    let window = agent_liveness_window_us();
    let agent_infos = agents
        .iter()
        .map(|a| LocationAgentInfo {
            id: a.id.clone(),
            name: a.name.clone(),
            version: a.version.clone(),
            capabilities: a.capabilities.clone(),
            last_seen_at: a.last_seen_at,
            created_at: a.created_at,
            live: now - a.last_seen_at <= window,
        })
        .collect();
    let check_summaries = checks
        .iter()
        .map(|s| LocationCheckSummary {
            id: s.id.clone(),
            name: s.name.clone(),
            check_type: s.check_type.clone(),
            interval_secs: s.frequency.interval_secs(),
            enabled: s.enabled,
            last_check_status: s.last_check_status.clone(),
        })
        .collect();

    let (_, install) = private_location_install(org_id, &row).await;
    Ok(LocationDetail {
        location: location_entry(row, &agents, &checks),
        agents: agent_infos,
        checks: check_summaries,
        install,
    })
}

/// Updates label/enabled on a location.
pub async fn update_location(
    org_id: &str,
    is_root: bool,
    id: &str,
    req: UpdateLocationRequest,
) -> anyhow::Result<synthetics_locations::SyntheticsLocationRecord> {
    location_for_write(org_id, is_root, id).await?;
    synthetics_locations::update(id, &req.label, req.enabled).await?;
    // The two columns the write touched, not the row: sending a row would carry
    // `down_notified_at` with it, and that flag is the claim on the right to
    // send one "location down" notification.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_location_update(
            id,
            &req.label,
            req.enabled,
        )
        .await?;
    }
    synthetics_locations::get(id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("location not found: {id}"))
}

/// Deletes a location — rejected while any synthetic still references it.
pub async fn delete_location(org_id: &str, is_root: bool, id: &str) -> anyhow::Result<()> {
    location_for_write(org_id, is_root, id).await?;
    let conn = get_orm_client_ro().await;
    let refs = synthetics_checks::count_referencing_location(conn, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if refs > 0 {
        return Err(anyhow::anyhow!(
            "validation: location {id:?} is referenced by {refs} synthetic(s) — remove it from them first"
        ));
    }
    synthetics_locations::remove(id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // The "still referenced?" check above only sees this region's checks, and
    // `locations` is a JSON column with no foreign key, so the delete cannot be
    // refused elsewhere. Replicating it anyway is the lesser evil: a location
    // left behind in another region stays selectable in its UI and keeps
    // routing jobs into a pool nobody serves.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_location_delete(id).await?;
    }
    Ok(())
}

/// Validates a create/update payload against this deployment's capabilities.
/// Locations are validated against the registry (public + the org's private
/// rows); browsers/devices stay env-controlled.
/// Errors are prefixed with "validation: " so handlers can map them to 400.
pub(crate) async fn validate_against_capabilities(
    org_id: &str,
    body: &Synthetic,
    is_create: bool,
) -> anyhow::Result<()> {
    let caps = config::meta::synthetics::list_capabilities();
    // The location registry is the single source of truth — no env fallback.
    // An empty registry (fresh deployment before public rows are inserted)
    // correctly rejects creates with an unknown-location error.
    let allowed_locations: Vec<String> = synthetics_locations::list_visible(org_id)
        .await?
        .into_iter()
        .filter(|r| r.enabled)
        .map(|r| r.id)
        .collect();
    let allowed_devices: Vec<String> = caps.devices.iter().map(|d| d.id.clone()).collect();
    body.validate(
        &allowed_locations,
        &caps.browsers,
        &allowed_devices,
        is_create,
    )
    .map_err(|e| anyhow::anyhow!("validation: {e}"))
}

/// The org token and install command a private location hands back, or
/// `(None, None)` for a public row.
///
/// Enterprise-only, and not merely gated: composing it means naming an agent
/// image and an install script for a fleet an OSS build has no way to run. A
/// public row has no install step at all, so OSS returns exactly what a public
/// row has always returned.
async fn private_location_install(
    org_id: &str,
    row: &synthetics_locations::SyntheticsLocationRecord,
) -> (Option<String>, Option<String>) {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::synthetics::service::private_location_install(org_id, row).await
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, row);
        (None, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Moved from the enterprise config module with the reader it pins.
    ///
    /// Decides whether a location shows Offline and whether the staleness
    /// watcher notifies. If it ever captured the value, raising the window to
    /// stop flapping alerts would do nothing until a restart.
    #[test]
    fn agent_stale_secs_is_read_at_call_time_not_captured_at_boot() {
        let _guard = crate::CONFIG_SWAP_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let saved = config::CONFIG.load_full();

        let install = |secs: i64| {
            let mut cfg = config::Config::init().unwrap();
            cfg.synthetics.agent_stale_secs = secs;
            config::CONFIG.store(std::sync::Arc::new(cfg));
        };

        install(30);
        assert_eq!(agent_liveness_window_us(), 30 * 1_000_000);

        // Second read, no restart in between.
        install(300);
        assert_eq!(agent_liveness_window_us(), 300 * 1_000_000);

        // Floor: a zero or negative window would mark every agent stale the
        // instant it registers.
        install(0);
        assert_eq!(agent_liveness_window_us(), 1_000_000);

        config::CONFIG.store(saved);
    }
    /// Spec §7 option A. A region that cannot see a location's agents must say
    /// so instead of reporting the customer's monitoring as not set up.
    ///
    /// The table is the contract: `status` never changes value, so no existing
    /// client sees anything new; `unknown` is the whole of the addition.
    #[test]
    fn live_status_is_unknown_only_where_this_region_cannot_know() {
        let online = |unknown| LiveStatus {
            status: "online",
            unknown,
        };
        let pending = |unknown| LiveStatus {
            status: "pending",
            unknown,
        };
        let offline = |unknown| LiveStatus {
            status: "offline",
            unknown,
        };

        for super_cluster in [false, true] {
            // Live agents here — an observation, wherever it is made.
            assert_eq!(
                resolve_live_status(false, 2, 2, super_cluster),
                online(false)
            );
            // Public rows are Lambda-served, not agent-derived.
            assert_eq!(
                resolve_live_status(true, 0, 0, super_cluster),
                online(false)
            );
            // Rows present and all stale: this region watched these agents go
            // away. Nowhere else can see them, so nobody is better placed.
            assert_eq!(
                resolve_live_status(false, 3, 0, super_cluster),
                offline(false)
            );
        }

        // The one case that moves: nothing registered here. Alone in a single
        // region that means nothing registered at all; in a super cluster the
        // agents may be alive in the region they actually poll.
        assert_eq!(resolve_live_status(false, 0, 0, false), pending(false));
        assert_eq!(resolve_live_status(false, 0, 0, true), pending(true));
    }

    /// Spec §14: super cluster disabled must be byte-identical to today. With
    /// the flag off, `unknown` is false for every input, so
    /// `skip_serializing_if` drops the field and the payload is the one that
    /// shipped before it existed.
    #[test]
    fn nothing_is_unknown_without_super_cluster() {
        for is_public in [false, true] {
            for agents_total in 0..3usize {
                for live_agents in 0..=agents_total {
                    assert!(
                        !resolve_live_status(is_public, agents_total, live_agents, false).unknown,
                        "public={is_public} total={agents_total} live={live_agents}"
                    );
                }
            }
        }
    }

    /// The backward-compatibility claim in [`LocationEntry`], asserted rather
    /// than asserted-in-a-comment: an older client must see the payload it has
    /// always seen, and `status` must never take a fourth value.
    ///
    /// The `skip_serializing_if` is what makes that true, and it is one
    /// attribute away from silently emitting `"live_status_unknown": false`
    /// into every single-region response.
    #[test]
    fn the_unknown_flag_is_absent_unless_it_is_set() {
        let entry = |live: LiveStatus| LocationEntry {
            id: "loc".into(),
            label: "Corp HQ".into(),
            region: "corp".into(),
            provider: "custom".into(),
            kind: "private".into(),
            pool: "private-corp".into(),
            enabled: true,
            types: vec![],
            live_agents: 0,
            agent_names: vec![],
            agents_total: 0,
            status: live.status.to_string(),
            live_status_unknown: live.unknown,
            version: None,
            last_seen_at: None,
            checks_count: 0,
            checks_per_min: 0.0,
        };

        let known = serde_json::to_value(entry(LiveStatus {
            status: "pending",
            unknown: false,
        }))
        .unwrap();
        assert_eq!(
            known.get("status").and_then(|v| v.as_str()),
            Some("pending")
        );
        assert!(
            known.get("live_status_unknown").is_none(),
            "a single-region payload must not grow a field: {known}"
        );

        let unknown = serde_json::to_value(entry(LiveStatus {
            status: "pending",
            unknown: true,
        }))
        .unwrap();
        assert_eq!(
            unknown.get("status").and_then(|v| v.as_str()),
            Some("pending"),
            "an old client keeps reading a value it understands"
        );
        assert_eq!(
            unknown.get("live_status_unknown").and_then(|v| v.as_bool()),
            Some(true)
        );
    }
}
