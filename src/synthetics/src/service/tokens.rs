use super::*;

// ── Agent token management (rotate / revoke / list) ─────────────────────────
//
// Implements the design's token lifecycle (`designs/synthetics/01-server-
// architecture.md` §7.2): an org holds multiple named `o2syn_` tokens; rotation
// = create-new + keep-old (overlap window), revocation = disable. There is no
// TTL and no validator cache, so a disable takes effect on the next request.

/// One agent token as surfaced to the management UI.
#[derive(Debug, Serialize)]
pub struct AgentTokenInfo {
    pub name: String,
    /// Raw token value, e.g. `o2syn_…`. Listed in full so an operator can
    /// re-copy it (the IAM page is RBAC-gated); trades the shown-once secrecy
    /// for retrievability by explicit product decision.
    pub token: String,
    pub is_default: bool,
    pub enabled: bool,
    /// How many agents last authenticated with this token — lets an operator
    /// disable it safely (when this reaches 0) instead of a blind click.
    pub agents: i64,
    pub created_by: String,
    pub created_at: i64,
}

/// A freshly created/rotated token — the ONLY response that carries the raw
/// value (shown once, then only ever masked).
#[derive(Debug, Serialize)]
pub struct AgentTokenSecret {
    pub name: String,
    pub token: String,
}

/// List all of an org's agent tokens (enabled + disabled), with raw values so the
/// UI can re-copy them (RBAC-gated; shown-once secrecy deliberately traded away).
pub async fn list_agent_tokens(org_id: &str) -> anyhow::Result<Vec<AgentTokenInfo>> {
    let rows = infra::table::synthetics_probe_tokens::list_by_org(org_id).await?;
    let counts = infra::table::synthetics_agents::count_by_token(org_id).await?;
    Ok(rows
        .into_iter()
        .map(|t| {
            let agents = counts.get(&t.id).copied().unwrap_or(0);
            AgentTokenInfo {
                name: t.name,
                token: t.token,
                is_default: t.is_default,
                enabled: t.enabled,
                agents,
                created_by: t.created_by,
                created_at: t.created_at,
            }
        })
        .collect())
}

/// Create a NEW named, **non-default**, enabled token (org-level). Named tokens
/// let an operator scope a credential to a region/site by convention (Prabhat
/// "one per region/agent") and embed it in that region's agents — without
/// touching the default token the Lambda dispatcher uses. Returns the raw value
/// (shown once). Fails if the name is taken (unique `(org, name)`).
pub async fn create_agent_token(
    org_id: &str,
    name: &str,
    created_by: &str,
) -> anyhow::Result<AgentTokenSecret> {
    use infra::table::synthetics_probe_tokens as tokens;
    let name = name.trim();
    if name.is_empty() {
        anyhow::bail!("token name is required");
    }
    if name == tokens::DEFAULT_TOKEN_NAME {
        anyhow::bail!(
            "'{}' is reserved — use rotate to replace the default token",
            tokens::DEFAULT_TOKEN_NAME
        );
    }
    let token = tokens::generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    let record = tokens::SyntheticsProbeTokenRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        name: name.to_string(),
        token: token.clone(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
        updated_at: now,
    };
    tokens::add(&record).await?;
    // `find_global` is the auth middleware's lookup and it has no org filter and
    // no region awareness — a token that lives in one region's meta DB 401s
    // everywhere else, and which region that is depends on nothing but where
    // the operator's browser landed. The raw value travels, matching
    // `org_ingestion_token_put`; see the producer for why.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_probe_token_create(
            (&record).into(),
        )
        .await?;
    }
    Ok(AgentTokenSecret {
        name: name.to_string(),
        token,
    })
}

/// Rotate: mint a NEW enabled token and make it the default, leaving the old
/// default ENABLED so in-field agents keep working during the overlap window.
/// The operator disables the old token (via [`set_agent_token_enabled`]) once
/// every agent has been re-provisioned. `name` lets an operator label a
/// per-region/per-agent token; omitted → a timestamped name. Returns the raw
/// value (shown once).
pub async fn rotate_agent_token(
    org_id: &str,
    name: Option<String>,
    created_by: &str,
) -> anyhow::Result<AgentTokenSecret> {
    use infra::table::synthetics_probe_tokens as tokens;
    let name = name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("agent-token-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    let token = tokens::generate_token();
    let now = chrono::Utc::now().timestamp_micros();
    // Insert as non-default first, then flip via set_default (clears the old
    // default's flag in one txn) so there is never a two-default window.
    let record = tokens::SyntheticsProbeTokenRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        name: name.clone(),
        token: token.clone(),
        is_default: false,
        enabled: true,
        created_by: created_by.to_string(),
        created_at: now,
        updated_at: now,
    };
    tokens::add(&record).await?;
    tokens::set_default(org_id, &name).await?;
    // One message for both writes. Splitting them would let a region apply the
    // insert and not the default flip (or the reverse), and `find_default` —
    // which the Lambda dispatcher and the install drawer both call — would then
    // pick arbitrarily between two defaults, or find none. Both writes have
    // landed locally first: publishing earlier would let a broker blip abort
    // this function with `?` and leave the rotation half-done here.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_probe_token_rotate(
            (&record).into(),
        )
        .await?;
    }
    Ok(AgentTokenSecret { name, token })
}

/// Enable/disable a named token. Disabling is how a token is revoked. Refuses to
/// disable the current default (that would break new installs + Lambda dispatch)
/// — rotate first (which moves the default), then disable the old token.
pub async fn set_agent_token_enabled(
    org_id: &str,
    name: &str,
    enabled: bool,
) -> anyhow::Result<()> {
    use infra::table::synthetics_probe_tokens as tokens;
    let Some(existing) = tokens::get_by_name(org_id, name).await? else {
        anyhow::bail!("token not found");
    };
    if !enabled && existing.is_default {
        anyhow::bail!("cannot disable the default token; rotate first, then disable the old token");
    }
    tokens::set_enabled(org_id, name, enabled).await?;
    // Revocation has to reach every region or the token keeps working wherever
    // the message did not land. Applying it there goes through the same
    // `set_enabled`, which emits that region's coordinator event, so its nodes
    // drop the token from their validator caches on arrival rather than waiting
    // out the 10 s TTL — the window is queue latency, with the TTL only as the
    // fallback for a node that missed the event.
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_probe_token_set_enabled(
            org_id, name, enabled,
        )
        .await?;
    }
    Ok(())
}
