use super::*;

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

    let dek = cipher::get_dek(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("DEK fetch failed: {e}"))?;

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

    let dek = cipher::get_dek(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("DEK fetch failed: {e}"))?;

    // Decrypt auth credential fields.
    check.auth = check.auth.take().map(|auth| match auth {
        SyntheticAuth::Basic { username, password } => SyntheticAuth::Basic {
            username,
            password: decrypt_secret(&dek, &password).unwrap_or_default(),
        },
        SyntheticAuth::Bearer { token } => SyntheticAuth::Bearer {
            token: decrypt_secret(&dek, &token).unwrap_or_default(),
        },
        other => other,
    });

    // Decrypt variable values.
    for var in &mut check.variables {
        if var.value.starts_with("AESenc:") {
            var.value = decrypt_secret(&dek, &var.value).unwrap_or_default();
        }
    }

    // Decrypt cookie values.
    for c in &mut check.cookies {
        if c.value.starts_with("AESenc:") {
            c.value = decrypt_secret(&dek, &c.value).unwrap_or_default();
        }
    }

    // Rehydrate extracted config secrets back into config for the edit form.
    for (pointer, encrypted) in std::mem::take(&mut check.config_secrets) {
        if let Some(slot) = check.config.pointer_mut(&pointer) {
            *slot = serde_json::Value::String(decrypt_secret(&dek, &encrypted).unwrap_or_default());
        }
    }

    // Legacy rows: decrypt AESenc: values still stored in-place inside config.
    for path in check.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            if s.starts_with("AESenc:") {
                *s = decrypt_secret(&dek, s).unwrap_or_default();
            }
            Ok::<(), ()>(())
        });
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
