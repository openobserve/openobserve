use super::*;

/// The configured key, decoded and validated once at first use.
///
/// `Ok(None)` means unset — callers fall back to the per-org DEK. `Err` means
/// set but unusable, which is returned to the caller rather than swallowed: a
/// key that cannot be parsed must not silently become "no key", because that
/// would put the deployment back on the per-region DEK and reintroduce the very
/// bug this exists to fix, with no signal that it had happened.
///
/// Read once and pinned at first use — which in a super cluster is startup,
/// because [`crate::super_cluster_preflight`] resolves it there. `refresh_config`
/// swaps the whole config and only
/// *logs* that a key needs a restart, so re-reading would let a reload change
/// the key underneath checks whose secrets were encrypted with the old one.
/// Their credentials would then decrypt to empty
/// (`decrypt_secret(..).unwrap_or_default()`) and the checks would fail with
/// nothing to explain why.
pub(crate) fn configured_key() -> &'static Result<Option<Vec<u8>>, String> {
    static KEY: std::sync::OnceLock<Result<Option<Vec<u8>>, String>> = std::sync::OnceLock::new();
    KEY.get_or_init(|| resolve_key(&config::get_config().synthetics.encryption_key))
}

/// The decode step, split out so it can be tested without the process-global
/// cache above: once anything in the binary resolves the key, the cache is
/// fixed, and a test asserting on the config would then pass without
/// exercising anything.
pub(crate) fn resolve_key(raw: &str) -> Result<Option<Vec<u8>>, String> {
    if raw.is_empty() {
        return Ok(None);
    }
    config::utils::encryption::decode_encryption_key(raw).map(Some)
}

/// Domain separator for [`synthetics_dek`]. Versioned rather than edited:
/// changing it re-keys every check.
const DEK_CONTEXT: &str = "openobserve/synthetics/dek/v1/";

/// The key check secrets are encrypted under.
///
/// Prefers a key derived from `ZO_SYNTHETICS_ENCRYPTION_KEY`, because the
/// per-org DEK is minted at random by whichever region needs it first: a check
/// created in one region then carries secrets no other region can read. The row
/// replicates, the key does not, and the agent's `resolve` fails with
/// `AES decrypt failed` while the run is silently lost (o2-enterprise#2451).
/// Deriving from a value every region already shares makes the key identical
/// everywhere without putting key material on the super-cluster queue, and
/// leaves nothing to converge on, so there is no race.
///
/// Falls back to the per-org DEK when the key is unset, which is correct for a
/// single-region deployment and keeps existing checks readable there.
pub(crate) async fn synthetics_dek(org_id: &str) -> anyhow::Result<Vec<u8>> {
    match configured_key() {
        Ok(Some(key)) => Ok(derive_dek(key, org_id)),
        Ok(None) => cipher::get_dek(org_id)
            .await
            .map_err(|e| anyhow::anyhow!("DEK fetch failed: {e}")),
        Err(e) => Err(anyhow::anyhow!(
            "ZO_SYNTHETICS_ENCRYPTION_KEY is set but unusable ({e}); refusing to fall back to \
             the per-region key, which would make this check unreadable in other regions"
        )),
    }
}

/// HKDF-Expand (RFC 5869). Two blocks because AES-256-SIV takes 64 bytes and
/// HMAC-SHA256 emits 32.
fn derive_dek(secret: &[u8], org_id: &str) -> Vec<u8> {
    use hmac::Mac;
    type Hmac256 = hmac::Hmac<sha2::Sha256>;

    let info = format!("{DEK_CONTEXT}{org_id}");
    let mut out = Vec::with_capacity(64);
    let mut prev: Vec<u8> = Vec::new();
    for counter in 1u8..=2 {
        // HMAC accepts a key of any length, so this cannot fail.
        let mut mac = Hmac256::new_from_slice(secret).expect("HMAC accepts any key length");
        mac.update(&prev);
        mac.update(info.as_bytes());
        mac.update(&[counter]);
        prev = mac.finalize().into_bytes().to_vec();
        out.extend_from_slice(&prev);
    }
    out
}

// ── Auth encryption helpers ───────────────────────────────────────────────────

/// Encrypts credential fields in `check.auth` with the org's AES-256-SIV DEK.
///
/// The UI sends credentials as plain text over TLS (which is required for all O2
/// deployments). The backend AES-encrypts them before writing to Postgres so they
/// are never stored in plain text at rest.
///
/// Besides the three top-level fields (`auth`, `variables`, `cookies`), secrets
/// embedded inside the type-specific `config` blob are encrypted in-place at the
/// paths declared by `SyntheticType::secret_config_paths` (e.g. SSH's
/// `config.auth.secret`).
///
/// Credentials already stored with the `AESenc:` prefix are left unchanged so
/// that update calls that don't touch auth don't re-encrypt unnecessarily.
pub async fn encrypt_synthetic_auth(
    org_id: &str,
    mut check: Synthetic,
) -> anyhow::Result<Synthetic> {
    let has_auth = check.auth.is_some();
    let has_vars = !check.variables.is_empty();
    let has_cookies = !check.cookies.is_empty();
    let has_config_secrets = config_has_secret_values(&mut check);

    if !has_auth && !has_vars && !has_cookies && !has_config_secrets {
        return Ok(check);
    }

    let dek = synthetics_dek(org_id).await?;

    if let Some(auth) = check.auth.take() {
        check.auth = Some(match auth {
            SyntheticAuth::Basic { username, password } => SyntheticAuth::Basic {
                username,
                password: encrypt_secret(&dek, &password)?,
            },
            SyntheticAuth::Bearer { token } => SyntheticAuth::Bearer {
                token: encrypt_secret(&dek, &token)?,
            },
            other => other,
        });
    }

    // Encrypt ALL variable values regardless of the secure flag.
    // secure is a UI display hint only — encryption is always unconditional.
    for var in &mut check.variables {
        var.value = encrypt_secret(&dek, &var.value)?;
    }

    // Encrypt cookie values — orthogonal to auth type, always unconditional.
    for c in &mut check.cookies {
        c.value = encrypt_secret(&dek, &c.value)?;
    }

    // Extract secrets embedded in the type-specific config blob into the
    // dedicated secrets column (keyed by JSON pointer), leaving empty strings
    // behind — the config column stores no secret material, not even
    // ciphertext. encrypt_secret skips values already AESenc: (round-trips).
    for path in check.check_type.secret_config_paths() {
        for (pointer, value) in take_strings_at_path(&mut check.config, path) {
            check
                .config_secrets
                .insert(pointer, encrypt_secret(&dek, &value)?);
        }
    }

    Ok(check)
}

/// Returns true if the check's config contains at least one non-empty string
/// at a declared secret path — used to decide whether a DEK fetch is needed.
pub(crate) fn config_has_secret_values(check: &mut Synthetic) -> bool {
    let mut found = false;
    for path in check.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            if !s.is_empty() {
                found = true;
            }
            Ok::<(), ()>(())
        });
    }
    found
}

/// Redacts credential values for API responses (create / update / list).
/// Clears auth password/token and secure-variable values so ciphertext
/// and plaintext never leave the backend on mutating calls.
pub fn redact_synthetic_auth(check: &mut Synthetic) {
    check.auth = check.auth.take().map(|auth| match auth {
        SyntheticAuth::Basic { username, .. } => SyntheticAuth::Basic {
            username,
            password: String::new(),
        },
        SyntheticAuth::Bearer { .. } => SyntheticAuth::Bearer {
            token: String::new(),
        },
        other => other,
    });
    // Always clear variable values — all are encrypted at rest, none safe to return in responses.
    for var in &mut check.variables {
        var.value = String::new();
    }
    for c in &mut check.cookies {
        c.value = String::new();
    }
    // Clear config-embedded secrets — after extraction the config slots are
    // already empty, but blank them defensively (legacy in-place rows) and
    // never let the ciphertext map leave the backend on mutating calls.
    check.config_secrets.clear();
    for path in check.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            *s = String::new();
            Ok::<(), ()>(())
        });
    }
}

/// Decrypts credential values in `check.auth` and `check.variables` in-place.
/// Called only by `get_synthetic` — the edit endpoint returns full plaintext.
/// `secure` on variables is a UI display flag only; decryption is unconditional.
pub(crate) async fn decrypt_synthetic_secrets(
    org_id: &str,
    check: &mut Synthetic,
) -> anyhow::Result<()> {
    let has_encrypted_auth = check.auth.as_ref().is_some_and(|a| match a {
        SyntheticAuth::Basic { password, .. } => password.starts_with("AESenc:"),
        SyntheticAuth::Bearer { token } => token.starts_with("AESenc:"),
        _ => false,
    });
    let has_encrypted_vars = check
        .variables
        .iter()
        .any(|v| v.value.starts_with("AESenc:"));
    let has_encrypted_cookies = check.cookies.iter().any(|c| c.value.starts_with("AESenc:"));
    // Extracted config secrets live in config_secrets; legacy rows may still
    // carry AESenc: values in-place inside config.
    let mut has_encrypted_config = !check.config_secrets.is_empty();
    for path in check.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            if s.starts_with("AESenc:") {
                has_encrypted_config = true;
            }
            Ok::<(), ()>(())
        });
    }

    if !has_encrypted_auth && !has_encrypted_vars && !has_encrypted_cookies && !has_encrypted_config
    {
        return Ok(());
    }

    let dek = synthetics_dek(org_id).await?;

    // Every failure below propagates. Defaulting to an empty string here used
    // to be silent and was destructive: the edit form rendered blanks, and
    // saving that form re-encrypted them over ciphertext that was merely
    // unreadable, losing the secret permanently. Failing the read keeps the
    // stored value intact and tells the caller why.
    check.auth = match check.auth.take() {
        Some(SyntheticAuth::Basic { username, password }) => Some(SyntheticAuth::Basic {
            username,
            password: decrypt_secret(&dek, &password)?,
        }),
        Some(SyntheticAuth::Bearer { token }) => Some(SyntheticAuth::Bearer {
            token: decrypt_secret(&dek, &token)?,
        }),
        other => other,
    };

    for var in &mut check.variables {
        if var.value.starts_with("AESenc:") {
            var.value = decrypt_secret(&dek, &var.value)?;
        }
    }

    for c in &mut check.cookies {
        if c.value.starts_with("AESenc:") {
            c.value = decrypt_secret(&dek, &c.value)?;
        }
    }

    // Rehydrate extracted config secrets back into config for the edit form.
    for (pointer, encrypted) in std::mem::take(&mut check.config_secrets) {
        if let Some(slot) = check.config.pointer_mut(&pointer) {
            *slot = serde_json::Value::String(decrypt_secret(&dek, &encrypted)?);
        }
    }

    // Legacy rows: decrypt AESenc: values still stored in-place inside config.
    for path in check.check_type.secret_config_paths() {
        for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            if s.starts_with("AESenc:") {
                *s = decrypt_secret(&dek, s)?;
            }
            Ok::<(), anyhow::Error>(())
        })?;
    }

    Ok(())
}

pub(crate) fn decrypt_secret(dek: &[u8], stored: &str) -> anyhow::Result<String> {
    let b64 = stored.strip_prefix("AESenc:").unwrap_or(stored);
    Algorithm::Aes256Siv
        .decrypt(dek, b64)
        .map_err(|e| anyhow::anyhow!("AES decrypt failed: {e}"))
}

pub(crate) fn encrypt_secret(dek: &[u8], value: &str) -> anyhow::Result<String> {
    // Already encrypted — skip to avoid double-wrapping on updates.
    if value.starts_with("AESenc:") {
        return Ok(value.to_string());
    }
    let ciphertext = Algorithm::Aes256Siv
        .encrypt(dek, value)
        .map_err(|e| anyhow::anyhow!("AES encrypt failed: {e}"))?;
    Ok(format!("AESenc:{ciphertext}"))
}

#[cfg(test)]
mod dek_tests {
    use super::*;

    /// The whole point: two regions holding the same configured key must reach
    /// the same DEK without exchanging anything.
    /// The mirror of `orphan_detection_enabled_is_read_per_pass`: this one must
    /// NOT follow a reload. `refresh_config` swaps the whole config and only
    /// logs that a restart is needed, so if the key were re-read, a reload
    /// would change it under checks already encrypted with the old one and
    /// `configured_key` must cache, so a config reload cannot swap the key
    /// under checks whose secrets were encrypted with the old one — their
    /// credentials would fail to decrypt and, before the Gap 1 fix, would have
    /// been silently blanked.
    ///
    /// Asserted by identity rather than by swapping the config: the cache is
    /// process-global, so any earlier test that touched the encrypt path has
    /// already fixed it, and a config-swap assertion would pass without
    /// proving anything. The decode branches are covered on `resolve_key`.
    #[test]
    fn the_configured_key_is_resolved_once_and_cached() {
        assert!(std::ptr::eq(configured_key(), configured_key()));
    }

    #[test]
    fn resolve_key_treats_unset_as_no_key_rather_than_an_error() {
        assert_eq!(resolve_key(""), Ok(None));
    }

    #[test]
    fn resolve_key_rejects_a_malformed_value() {
        assert!(resolve_key("hunter2").is_err());
    }

    #[test]
    fn resolve_key_accepts_a_valid_key() {
        use base64::{Engine, prelude::BASE64_STANDARD};
        let good = BASE64_STANDARD.encode([7u8; 64]);
        assert_eq!(resolve_key(&good), Ok(Some(vec![7u8; 64])));
    }

    /// A weak or malformed value must be refused, not quietly used as key
    /// material — `hunter2` derived a perfectly valid-looking key before this.
    #[test]
    fn a_non_base64_key_is_rejected() {
        assert!(config::utils::encryption::decode_encryption_key("hunter2").is_err());
    }

    /// Right alphabet, wrong length: 32 bytes is not enough for AES-256-SIV.
    #[test]
    fn a_base64_key_of_the_wrong_length_is_rejected() {
        use base64::{Engine, prelude::BASE64_STANDARD};
        let short = BASE64_STANDARD.encode([7u8; 32]);
        assert!(config::utils::encryption::decode_encryption_key(&short).is_err());
    }

    #[test]
    fn a_valid_key_decodes_to_64_bytes() {
        use base64::{Engine, prelude::BASE64_STANDARD};
        let good = BASE64_STANDARD.encode([7u8; 64]);
        assert_eq!(
            config::utils::encryption::decode_encryption_key(&good)
                .unwrap()
                .len(),
            64
        );
    }

    /// Gap 1: a wrong key must surface as an error. Defaulting to an empty
    /// string let the edit form render blanks, and saving that form
    /// re-encrypted them over ciphertext that was only unreadable — destroying
    /// the secret. The read has to fail so the stored value survives.
    #[test]
    fn decrypting_with_the_wrong_key_is_an_error_not_a_blank() {
        let right = derive_dek(&[1u8; 64], "acme");
        let wrong = derive_dek(&[2u8; 64], "acme");
        let stored = encrypt_secret(&right, "hunter2").unwrap();

        assert_eq!(decrypt_secret(&right, &stored).unwrap(), "hunter2");
        assert!(
            decrypt_secret(&wrong, &stored).is_err(),
            "a wrong key must not decrypt to a value a later save would persist"
        );
    }

    /// The ciphertext must be readable by the same key on another region, which
    /// is the entire point of deriving rather than minting.
    #[test]
    fn a_secret_encrypted_under_a_derived_key_round_trips() {
        let dek = derive_dek(&[9u8; 64], "acme");
        let stored = encrypt_secret(&dek, "s3cret").unwrap();
        assert!(stored.starts_with("AESenc:"));
        // Same inputs, independently derived — as a second region would.
        let elsewhere = derive_dek(&[9u8; 64], "acme");
        assert_eq!(decrypt_secret(&elsewhere, &stored).unwrap(), "s3cret");
    }

    #[test]
    fn derivation_is_deterministic() {
        assert_eq!(
            derive_dek(b"shared-secret", "acme"),
            derive_dek(b"shared-secret", "acme")
        );
    }

    #[test]
    fn derivation_fills_the_64_bytes_aes_256_siv_needs() {
        let out = derive_dek(b"shared-secret", "acme");
        assert_eq!(out.len(), 64);
        // Two HMAC-SHA256 blocks, so the halves must not be one block repeated.
        assert_ne!(out[..32], out[32..]);
    }

    #[test]
    fn each_org_gets_its_own_key() {
        assert_ne!(
            derive_dek(b"shared-secret", "acme"),
            derive_dek(b"shared-secret", "other")
        );
    }

    #[test]
    fn a_different_configured_key_derives_a_different_dek() {
        assert_ne!(
            derive_dek(b"secret-a", "acme"),
            derive_dek(b"secret-b", "acme")
        );
    }
}
