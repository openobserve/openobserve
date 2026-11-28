use infra::table::synthetics_probe_tokens::{self as probe_tokens, SYNTHETICS_PROBE_TOKEN_PREFIX};
use serde::Serialize;

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
    /// A fixed mask; the value comes only from create, rotate and the audited view.
    pub token: String,
    pub pre_cutover: bool,
    pub is_default: bool,
    pub enabled: bool,
    /// How many agents last authenticated with this token — lets an operator
    /// disable it safely (when this reaches 0) instead of a blind click.
    pub agents: i64,
    pub created_by: String,
    pub created_at: i64,
}

/// A token value: returned only by create, rotate and the strict-admin view.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AgentTokenSecret {
    pub name: String,
    pub token: String,
}

pub fn masked_token() -> String {
    format!("{SYNTHETICS_PROBE_TOKEN_PREFIX}{}", "•".repeat(8))
}

/// List all of an org's agent tokens (enabled + disabled), masked.
pub async fn list_agent_tokens(org_id: &str) -> anyhow::Result<Vec<AgentTokenInfo>> {
    let rows = probe_tokens::list_by_org(org_id).await?;
    let cutover_at = probe_tokens::agent_token_cutover_at().await?;
    let counts = infra::table::synthetics_agents::count_by_token(org_id).await?;
    Ok(rows
        .into_iter()
        .map(|t| {
            let agents = counts.get(&t.id).copied().unwrap_or(0);
            AgentTokenInfo {
                name: t.name,
                token: masked_token(),
                pre_cutover: probe_tokens::is_pre_cutover(t.created_at, cutover_at),
                is_default: t.is_default,
                enabled: t.enabled,
                agents,
                created_by: t.created_by,
                created_at: t.created_at,
            }
        })
        .collect())
}

pub async fn view_agent_token(
    org_id: &str,
    name: &str,
) -> anyhow::Result<Option<AgentTokenSecret>> {
    Ok(probe_tokens::view_by_name(org_id, name)
        .await?
        .map(|record| AgentTokenSecret {
            name: record.name,
            token: record.token,
        }))
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
        id: config::ider::ksuid(),
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
        id: config::ider::ksuid(),
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

#[cfg(test)]
mod tests {
    use config::{meta::cluster::Node, utils::time::now_micros};
    use infra::{
        db::get_orm_client_rw,
        secret_store::{
            capability::{
                FgaMode, LEVEL_P1_11, LEVEL_STORE, STORE_FLOOR_VERSION, own_record, write_record_in,
            },
            gate,
        },
        secrets::CURRENT,
        table::{
            cipher,
            credential_values::{self, ProbeTokenAd, SlotClass},
            entity::synthetics_probe_tokens::{ActiveModel, Column, Entity, Model},
        },
    };
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, sea_query::Expr};

    use super::*;

    const ORG: &str = "probe-token-test";

    #[test]
    fn masked_token_hides_the_entire_suffix() {
        let mask = masked_token();
        let suffix = mask.strip_prefix(SYNTHETICS_PROBE_TOKEN_PREFIX).unwrap();
        assert_eq!(suffix, "••••••••");
        assert!(!suffix.chars().any(char::is_alphanumeric));
    }

    #[tokio::test]
    async fn agent_token_blanking_follows_live_node_level() {
        const CHILD: &str = "O2_PROBE_TOKEN_BLANK_TEST";
        if std::env::var(CHILD).as_deref() == Ok("1") {
            exercise_probe_token_blanking().await;
            return;
        }

        // The capability snapshot and database pool are process-wide.
        let dir = std::env::temp_dir().join(config::ider::ksuid());
        std::fs::create_dir(&dir).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        for (key, _) in
            std::env::vars_os().filter(|(key, _)| key.to_string_lossy().starts_with("ZO_"))
        {
            command.env_remove(key);
        }
        let output = command
            .current_dir(&dir)
            .env(CHILD, "1")
            .env("ZO_LOCAL_MODE", "true")
            .env("ZO_META_STORE", "sqlite")
            .env("ZO_DATA_DIR", &dir)
            .args([
                "--exact",
                "service::tokens::tests::agent_token_blanking_follows_live_node_level",
                "--nocapture",
            ])
            .output();
        std::fs::remove_dir_all(dir).unwrap();
        let output = output.unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success() && stdout.contains("1 passed"),
            "{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    async fn exercise_probe_token_blanking() {
        infra::db_init().await.unwrap();
        infra::table::migrate().await.unwrap();
        cipher::boot(None).await.unwrap();
        publish_capabilities(LEVEL_STORE).await;

        let minted = probe_tokens::create_for_org(ORG, "system").await.unwrap();
        let bad_hash = create_agent_token(ORG, "bad-hash", "admin").await.unwrap();
        let bad_ciphertext = rotate_agent_token(ORG, Some("old-default".into()), "admin")
            .await
            .unwrap();
        let legacy = insert_legacy_token().await;
        let closed = probe_tokens::blank_plaintext_pass().await.unwrap();
        assert_eq!(
            (closed.blanked, closed.mismatched, closed.skipped),
            (0, 0, 0)
        );
        for (name, token) in [
            (&minted.name, &minted.token),
            (&bad_hash.name, &bad_hash.token),
            (&bad_ciphertext.name, &bad_ciphertext.token),
            (&legacy.name, &legacy.token),
        ] {
            assert!(stored_token(ORG, name).await.token == *token);
        }
        let legacy_row = stored_token(ORG, &legacy.name).await;
        assert!(legacy_row.token_sha256.is_empty());
        assert!(legacy_row.token_ref.is_none());

        Entity::update_many()
            .col_expr(
                Column::TokenSha256,
                Expr::value(probe_tokens::token_sha256("wrong")),
            )
            .col_expr(Column::TokenRef, Expr::value(None::<String>))
            .filter(Column::OrgId.eq(ORG))
            .filter(Column::Name.eq(&bad_hash.name))
            .exec(get_orm_client_rw().await)
            .await
            .unwrap();
        change_owned_value(&bad_ciphertext.name).await;
        publish_capabilities(LEVEL_P1_11).await;

        let open = probe_tokens::blank_plaintext_pass().await.unwrap();
        assert_eq!((open.blanked, open.mismatched, open.skipped), (2, 2, 0));
        for secret in [&bad_hash, &bad_ciphertext] {
            assert!(stored_token(ORG, &secret.name).await.token == secret.token);
        }
        let bad_hash_row = stored_token(ORG, &bad_hash.name).await;
        assert!(bad_hash_row.token_sha256 == probe_tokens::token_sha256("wrong"));
        assert!(bad_hash_row.token_ref.is_none());

        let created = create_agent_token(ORG, "sealed", "admin").await.unwrap();
        let rotated = rotate_agent_token(ORG, Some("new-default".into()), "admin")
            .await
            .unwrap();
        let new_org = "probe-token-test-new-org";
        let new_mint = probe_tokens::create_for_org(new_org, "system")
            .await
            .unwrap();
        for (org, name, token) in [
            (ORG, &minted.name, &minted.token),
            (ORG, &legacy.name, &legacy.token),
            (ORG, &created.name, &created.token),
            (ORG, &rotated.name, &rotated.token),
            (new_org, &new_mint.name, &new_mint.token),
        ] {
            assert!(stored_token(org, name).await.token.is_empty());
            let found = probe_tokens::find_global(token).await.unwrap().unwrap();
            assert_eq!(
                (found.org_id.as_str(), found.name.as_str()),
                (org, name.as_str())
            );
        }
        assert!(
            probe_tokens::find_default(ORG)
                .await
                .unwrap()
                .unwrap()
                .token
                == rotated.token
        );

        // T04: the periodic repair pass seals a legacy row and then blanks its plaintext.
        let late = insert_legacy_named("late-legacy").await;
        let (repair, blank) = infra::secret_store::probe_token_repair::run_pass()
            .await
            .unwrap();
        // The bad-ciphertext row above still fails repair; only the new legacy row is sealed.
        assert_eq!(repair.repaired, 1);
        assert_eq!(blank.blanked, 1);
        assert!(stored_token(ORG, &late.name).await.token.is_empty());
        let found = probe_tokens::find_global(&late.token)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.name, late.name);
    }

    async fn publish_capabilities(peer_level: u32) {
        let coordinator = infra::db::get_coordinator().await.as_ref();
        let now = now_micros();
        let mut record = own_record(FgaMode::On, now);
        // Blanking also needs the durable latch, which only a refs-on cluster records.
        record.refs_enabled = peer_level == LEVEL_P1_11;
        let mut nodes = Vec::new();
        for (uuid, level) in [("local", LEVEL_P1_11), ("peer", peer_level)] {
            record.level = level;
            write_record_in(coordinator, uuid, &record).await.unwrap();
            nodes.push(Node {
                uuid: uuid.into(),
                name: uuid.into(),
                version: STORE_FLOOR_VERSION.into(),
                ..Default::default()
            });
        }
        gate::evaluate_once_in(coordinator, nodes, now)
            .await
            .unwrap();
        assert_eq!(
            gate::all_live_nodes_at_level(LEVEL_P1_11),
            peer_level == LEVEL_P1_11
        );
    }

    async fn stored_token(org: &str, name: &str) -> Model {
        Entity::find()
            .filter(Column::OrgId.eq(org))
            .filter(Column::Name.eq(name))
            .one(get_orm_client_rw().await)
            .await
            .unwrap()
            .unwrap()
    }

    async fn insert_legacy_token() -> AgentTokenSecret {
        insert_legacy_named("legacy").await
    }

    async fn insert_legacy_named(name: &str) -> AgentTokenSecret {
        let name = name.to_owned();
        let token = probe_tokens::generate_token();
        Entity::insert(ActiveModel {
            id: Set(config::ider::ksuid()),
            org_id: Set(ORG.into()),
            name: Set(name.clone()),
            token: Set(token.clone()),
            token_sha256: Set(String::new()),
            token_ref: Set(None),
            enabled: Set(true),
            is_default: Set(false),
            created_by: Set("legacy".into()),
            created_at: Set(1),
            updated_at: Set(1),
        })
        .exec(get_orm_client_rw().await)
        .await
        .unwrap();
        AgentTokenSecret { name, token }
    }

    async fn change_owned_value(name: &str) {
        let db = get_orm_client_rw().await;
        let row = stored_token(ORG, name).await;
        let secret_ref = row.token_ref.as_deref().unwrap();
        let slot = SlotClass::ProbeToken(ProbeTokenAd {
            org_id: ORG,
            token_id: &row.id,
            secret_ref,
            token_sha256: &row.token_sha256,
        });
        let model = credential_values::find_state(db, ORG, secret_ref, CURRENT)
            .await
            .unwrap()
            .unwrap();
        let mut secret = credential_values::decrypt_model(model, &slot)
            .await
            .unwrap();
        secret.value = probe_tokens::generate_token().into();
        let sealed = credential_values::encrypted_active_model(&secret, &slot)
            .await
            .unwrap();
        credential_values::update(db, sealed).await.unwrap();
    }
}
