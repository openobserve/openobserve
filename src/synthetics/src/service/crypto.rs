use std::{collections::BTreeMap, fmt, future::Future};

use config::{
    meta::{
        secret_store::{ORG_ENV_ID, SecretErrorCode},
        synthetics::{
            SLOT_META_PREFIX, SlotMeta, effective_origin, header_is_secure, is_keep_marker,
            is_keep_value, set_marker, set_marker_value, slot_key_auth_password,
            slot_key_auth_token, slot_key_body, slot_key_cookie, slot_key_header, slot_key_secret,
            slot_key_ssh_secret, slot_key_step, slot_key_variable, substitute_vars,
        },
    },
    utils::encryption::{Algorithm, SECRET_PREFIX},
};
use serde_json::Value;

use super::*;

const VALUE_REQUIRED: SecretErrorCode = SecretErrorCode::SlotValueRequired;
const HOST_CHANGE: SecretErrorCode = SecretErrorCode::SlotValueRequiredOnHostChange;

pub type EnvVars = BTreeMap<String, Vec<(String, String)>>;
pub type Origins = BTreeMap<String, Vec<String>>;
pub(crate) type KeptMetadata = BTreeMap<String, Option<String>>;

#[derive(Debug)]
pub struct SlotRefusal {
    pub code: SecretErrorCode,
    pub field: String,
}

impl SlotRefusal {
    pub(crate) fn new(code: SecretErrorCode, field: impl Into<String>) -> Self {
        Self {
            code,
            field: field.into(),
        }
    }
}

impl fmt::Display for SlotRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.code.http_status() == Some(400) {
            f.write_str("validation: ")?;
        }
        write!(f, "{}: {}", self.code, self.field)
    }
}

impl std::error::Error for SlotRefusal {}

struct WriteMetadata<'a> {
    updated_by: &'a str,
    updated_at: i64,
    origins: &'a Origins,
    kept: &'a KeptMetadata,
}

struct StoredSlot<'a> {
    value: &'a str,
    encrypted: bool,
}

impl StoredSlot<'_> {
    fn plaintext(&self, dek: &[u8]) -> anyhow::Result<String> {
        if self.encrypted {
            decrypt_secret(dek, self.value)
        } else {
            Ok(self.value.to_owned())
        }
    }
}

/// The key this region encrypts check secrets with.
///
/// Region-local by design. Secrets cross the super-cluster queue in clear and
/// the applier re-encrypts them under the receiving region's own DEK, so no key
/// has to be shared or replicated (o2-enterprise#2451, option B).
pub(crate) async fn synthetics_dek(org_id: &str) -> anyhow::Result<Vec<u8>> {
    cipher::get_dek(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("DEK fetch failed: {e}"))
}

pub async fn encrypt_synthetic_auth(org_id: &str, check: Synthetic) -> anyhow::Result<Synthetic> {
    let mut check = check;
    reject_keep(&check)?;
    if save_needs_dek(&check, false) {
        encrypt_check(&mut check, &synthetics_dek(org_id).await?, None)?;
    }
    Ok(check)
}

pub async fn encrypt_synthetic_auth_write_only(
    org_id: &str,
    check: Synthetic,
    updated_by: &str,
    now_us: i64,
) -> anyhow::Result<Synthetic> {
    let mut check = check;
    reject_keep(&check)?;
    validate_slot_identities(&check)?;
    if save_needs_dek(&check, true) {
        let dek = synthetics_dek(org_id).await?;
        let vars = load_origin_vars(org_id, &check, &dek).await?;
        let origins = check_origins(&check, &vars);
        encrypt_for_write(
            &mut check,
            &dek,
            updated_by,
            now_us,
            &origins,
            &KeptMetadata::new(),
        )?;
    } else {
        check.config_secrets.clear();
    }
    Ok(check)
}

pub fn find_keep(check: &Synthetic) -> Option<String> {
    match &check.auth {
        Some(SyntheticAuth::Basic { password, .. }) if is_keep_marker(password) => {
            return Some("auth.password".into());
        }
        Some(SyntheticAuth::Bearer { token }) if is_keep_marker(token) => {
            return Some("auth.token".into());
        }
        _ => {}
    }
    if let Some(i) = check.cookies.iter().position(|c| is_keep_marker(&c.value)) {
        return Some(format!("cookies[{i}].value"));
    }
    if let Some(i) = check
        .variables
        .iter()
        .position(|v| is_keep_marker(&v.value))
    {
        return Some(format!("variables[{i}].value"));
    }
    find_config_keep(&check.config, "config")
}

pub(crate) fn reject_keep(check: &Synthetic) -> anyhow::Result<()> {
    if let Some(field) = find_keep(check) {
        return Err(SlotRefusal::new(VALUE_REQUIRED, field).into());
    }
    Ok(())
}

pub fn redact_write_only_slots(check: &mut Synthetic) {
    for path in check.check_type.write_only_split_paths() {
        let _ = for_each_string_at_path(&mut check.config, path, &mut |value| {
            value.clear();
            Ok::<(), ()>(())
        });
    }
}

pub(crate) async fn redact_for_edit(org_id: &str, check: &mut Synthetic) -> anyhow::Result<()> {
    let dek = if edit_needs_dek(check) {
        synthetics_dek(org_id).await?
    } else {
        Vec::new()
    };
    redact_edit_with_dek(check, &dek)
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

/// Edit clients can round-trip plaintext until the deployment writes its first write-only marker.
pub(crate) async fn decrypt_synthetic_secrets(
    org_id: &str,
    check: &mut Synthetic,
) -> anyhow::Result<()> {
    if !has_prefixed_typed_value(check) && !has_encrypted_config(check) {
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

    rehydrate_config_secrets(check, &dek)
}

/// Extracted `config_secrets`, or legacy `AESenc:` values still in place inside `config`.
pub(crate) fn has_encrypted_config(check: &mut Synthetic) -> bool {
    if !check.config_secrets.is_empty() {
        return true;
    }
    let mut found = false;
    for path in check.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            found |= s.starts_with("AESenc:");
            Ok::<(), ()>(())
        });
    }
    found
}

/// Restores config-embedded secrets (SSH password, headers, recorded secrets) into `config`.
pub(crate) fn rehydrate_config_secrets(check: &mut Synthetic, dek: &[u8]) -> anyhow::Result<()> {
    // An extracted value wins over legacy inline data, even when its plaintext starts with AESenc:.
    for pointer in check.config_secrets.keys() {
        if let Some(slot) = check.config.pointer_mut(pointer) {
            *slot = Value::Null;
        }
    }
    for path in check.check_type.secret_config_paths() {
        for_each_string_at_path(&mut check.config, path, &mut |s: &mut String| {
            if s.starts_with(SECRET_PREFIX) {
                *s = decrypt_secret(dek, s)?;
            }
            Ok::<(), anyhow::Error>(())
        })?;
    }
    for (pointer, encrypted) in std::mem::take(&mut check.config_secrets) {
        if pointer.starts_with(SLOT_META_PREFIX) {
            check.config_secrets.insert(pointer, encrypted);
        } else if let Some(slot) = check.config.pointer_mut(&pointer) {
            *slot = Value::String(decrypt_secret(dek, &encrypted)?);
        }
    }
    Ok(())
}

// Thin wrappers over the shared implementation in `config::utils::encryption`,
// which the super-cluster producer and applier also use. One prefix, one
// double-wrap rule, one place — the applier cannot depend on this crate, so a
// local copy here would be a second definition free to drift.
pub(crate) fn decrypt_secret(dek: &[u8], stored: &str) -> anyhow::Result<String> {
    config::utils::encryption::decrypt_secret_value(dek, stored)
        .map_err(|e| anyhow::anyhow!("AES decrypt failed: {e}"))
}

pub(crate) fn encrypt_secret(dek: &[u8], value: &str) -> anyhow::Result<String> {
    config::utils::encryption::encrypt_secret_value(dek, value)
        .map_err(|e| anyhow::anyhow!("AES encrypt failed: {e}"))
}

pub(crate) fn encrypt_literal(dek: &[u8], value: &str) -> anyhow::Result<String> {
    let ciphertext = Algorithm::Aes256Siv.encrypt(dek, value)?;
    Ok(format!("{SECRET_PREFIX}{ciphertext}"))
}

/// Encrypts a value for storage, keeping an empty one empty.
pub(crate) fn store_value(dek: &[u8], value: &str) -> anyhow::Result<String> {
    if value.is_empty() {
        return Ok(String::new());
    }
    encrypt_secret(dek, value)
}

pub fn check_origins(check: &Synthetic, shared: &EnvVars) -> Origins {
    let urls = request_urls(check);
    let local = check
        .variables
        .iter()
        .map(|v| (v.name.clone(), v.value.clone()));
    environment_keys(check)
        .map(|env| {
            let vars: Vec<_> = shared
                .get(env)
                .into_iter()
                .flatten()
                .cloned()
                .chain(local.clone())
                .collect();
            let mut origins: Vec<_> = urls
                .iter()
                .map(|url| effective_origin(&substitute_vars(url, &vars)))
                .collect();
            origins.sort_unstable();
            origins.dedup();
            (env.to_owned(), origins)
        })
        .collect()
}

pub fn slot_origins_allowed(
    check: &Synthetic,
    dek: &[u8],
    origins_now: &Origins,
) -> Result<(), SecretErrorCode> {
    if check_slot_origins(check, dek, origins_now)? {
        Ok(())
    } else {
        Err(SecretErrorCode::SlotOriginChanged)
    }
}

pub(crate) async fn slot_origins_allowed_at_resolve(
    check: &Synthetic,
    dek: &[u8],
    origins_now: &Origins,
    backfill_done: impl Future<Output = bool>,
) -> Result<(), SecretErrorCode> {
    if check_slot_origins(check, dek, origins_now)? || !backfill_done.await {
        Ok(())
    } else {
        Err(SecretErrorCode::SlotOriginChanged)
    }
}

/// True when the snapshot holds a non-empty V39 or S03 write-only value; callers OR in
/// `needs_lease` for store refs.
pub fn carries_write_only(check: &Synthetic) -> bool {
    !stored_slots(check).is_empty()
}

/// Keys of the snapshot's non-empty inline write-only slots; empty exactly when
/// [`carries_write_only`] is false.
pub fn write_only_slot_keys(check: &Synthetic) -> Vec<String> {
    stored_slots(check)
        .into_iter()
        .map(|(key, _)| key)
        .collect()
}

/// Turns off every artifact and RUM capture, so a secret-bearing attempt leaves no evidence.
pub fn force_capture_off(check: &mut Synthetic) {
    check.collect_rum_data = false;
    check.session_replay = false;
    if check.check_type == SyntheticType::Browser
        && let Some(config) = check.config.as_object_mut()
    {
        config.insert(
            "capture".into(),
            serde_json::json!({"screenshot": "off", "trace": "off", "video": "off"}),
        );
    }
}

/// Plaintexts of a stored check's write-only slots, for redacting run output.
pub fn stored_write_only_values(check: &Synthetic, dek: &[u8]) -> Vec<String> {
    let username = match &check.auth {
        Some(SyntheticAuth::Basic { username, .. }) => Some(username.as_str()),
        _ => None,
    };
    let mut values = Vec::new();
    for (key, slot) in stored_slots(check) {
        // A legacy row may hold a typed `AESenc:` literal unencrypted; that text is the value.
        let value = slot
            .plaintext(dek)
            .unwrap_or_else(|_| slot.value.to_owned());
        if value.is_empty() {
            continue;
        }
        if let Some(username) = username
            && key == slot_key_auth_password()
        {
            values.push(format!("{username}:{value}"));
        }
        values.push(value);
    }
    values
}

pub(crate) async fn load_origin_vars(
    org: &str,
    check: &Synthetic,
    dek: &[u8],
) -> anyhow::Result<EnvVars> {
    let mut vars = EnvVars::new();
    if request_urls(check).iter().any(|url| url.contains("{{")) {
        for env in environment_keys(check) {
            let env_id = (!check.environments.is_empty()).then_some(env);
            vars.insert(
                env.to_owned(),
                resolve_shared_variables(org, env_id, check, dek).await?,
            );
        }
    }
    Ok(vars)
}

pub(crate) async fn stored_check_origins(
    org: &str,
    check: &Synthetic,
    dek: &[u8],
) -> anyhow::Result<Origins> {
    let mut view = check.clone();
    for variable in &mut view.variables {
        if variable.value.starts_with(SECRET_PREFIX) {
            variable.value = decrypt_secret(dek, &variable.value)?;
        }
    }
    let shared = load_origin_vars(org, &view, dek).await?;
    Ok(check_origins(&view, &shared))
}

pub(crate) fn placeholder_copy(check: &Synthetic) -> anyhow::Result<Synthetic> {
    validate_slot_identities(check)?;
    let mut copy = check.clone();
    replace_keeps(&mut copy, |_, _| Ok("placeholder".into()))?;
    Ok(copy)
}

pub(crate) fn validate_slot_identities(check: &Synthetic) -> anyhow::Result<()> {
    check_unique_slots(check, |_| true, SecretErrorCode::DuplicateSlotIdentity)
}

pub(crate) fn resolve_keeps(
    check: &mut Synthetic,
    stored: &Synthetic,
    dek: &[u8],
    shared: &EnvVars,
    private_locations: &HashSet<String>,
) -> anyhow::Result<KeptMetadata> {
    validate_slot_identities(check)?;
    check_keep_context(check, stored, private_locations)?;
    let slots: BTreeMap<_, _> = stored_slots(stored).into_iter().collect();
    let mut kept = KeptMetadata::new();
    replace_keeps(check, |key, field| {
        let slot = slots
            .get(key)
            .ok_or_else(|| SlotRefusal::new(VALUE_REQUIRED, field))?;
        let value = slot.plaintext(dek)?;
        if value.is_empty() {
            return Err(SlotRefusal::new(VALUE_REQUIRED, field).into());
        }
        kept.insert(
            key.to_owned(),
            stored
                .config_secrets
                .get(&format!("{SLOT_META_PREFIX}{key}"))
                .cloned(),
        );
        Ok(value)
    })?;
    // Legacy rows can contain duplicate names, so only an unambiguous stored identity may satisfy a
    // keep.
    check_unique_slots(stored, |key| kept.contains_key(key), VALUE_REQUIRED)?;
    let origins = check_origins(check, shared);
    for key in kept.keys() {
        let meta = read_slot_meta(&stored.config_secrets, key, dek)?;
        if !origins_allowed(&origins, meta.as_ref()) {
            let field = key.split('/').next().unwrap_or("slot");
            return Err(SlotRefusal::new(HOST_CHANGE, field).into());
        }
    }
    Ok(kept)
}

pub(crate) fn save_needs_dek(check: &Synthetic, write_only: bool) -> bool {
    check.auth.is_some()
        || !check.variables.is_empty()
        || !check.cookies.is_empty()
        || config_slots(check).into_iter().any(|(pointer, _)| {
            (write_only || !(pointer == "/body" || pointer.starts_with("/steps/")))
                && check
                    .config
                    .pointer(&pointer)
                    .is_some_and(|v| v.as_str().is_some_and(|s| !s.is_empty()) || is_keep_value(v))
        })
}

pub(crate) fn encrypt_for_write(
    check: &mut Synthetic,
    dek: &[u8],
    updated_by: &str,
    updated_at: i64,
    origins: &Origins,
    kept: &KeptMetadata,
) -> anyhow::Result<()> {
    encrypt_check(
        check,
        dek,
        Some(&WriteMetadata {
            updated_by,
            updated_at,
            origins,
            kept,
        }),
    )
}

fn check_slot_origins(
    check: &Synthetic,
    dek: &[u8],
    origins_now: &Origins,
) -> Result<bool, SecretErrorCode> {
    let mut empty = None;
    let mut bound = true;
    for (key, slot) in stored_slots(check) {
        let meta = read_slot_meta(&check.config_secrets, &key, dek)
            .map_err(|_| SecretErrorCode::SlotOriginChanged)?;
        // Legacy writers encrypted empty typed values with deterministic AES-SIV.
        if meta.is_none()
            && slot.encrypted
            && (key.starts_with("auth/")
                || key.starts_with("variable/")
                || key.starts_with("cookie/"))
        {
            if empty.is_none() {
                empty =
                    Some(encrypt_literal(dek, "").map_err(|_| SecretErrorCode::SlotOriginChanged)?);
            }
            if let Some(cipher) = &empty
                && (slot.value == cipher || Some(slot.value) == cipher.strip_prefix(SECRET_PREFIX))
            {
                continue;
            }
        }
        if meta.as_ref().is_none_or(|meta| meta.origins.is_none()) {
            bound = false;
            continue;
        }
        if !origins_allowed(origins_now, meta.as_ref()) {
            return Err(SecretErrorCode::SlotOriginChanged);
        }
    }
    Ok(bound)
}

fn check_unique_slots(
    check: &Synthetic,
    relevant: impl Fn(&str) -> bool,
    code: SecretErrorCode,
) -> anyhow::Result<()> {
    let mut seen = HashSet::new();
    let mut unique = |key: String, field: &str| -> anyhow::Result<()> {
        if relevant(&key) && !seen.insert(key) {
            return Err(SlotRefusal::new(code, field).into());
        }
        Ok(())
    };
    for cookie in &check.cookies {
        unique(
            slot_key_cookie(&cookie.name, &cookie.domain, &cookie.path),
            "cookies",
        )?;
    }
    for var in &check.variables {
        unique(slot_key_variable(&var.name), "variables")?;
    }
    if matches!(
        check.check_type,
        SyntheticType::Http | SyntheticType::Browser
    ) {
        for item in config_items(&check.config, "headers") {
            unique(
                slot_key_header(item["name"].as_str().unwrap_or_default()),
                "config.headers",
            )?;
        }
    }
    if check.check_type == SyntheticType::Browser {
        for item in config_items(&check.config, "secrets") {
            unique(
                slot_key_secret(item["name"].as_str().unwrap_or_default()),
                "config.secrets",
            )?;
        }
        for step in config_items(&check.config, "steps") {
            unique(
                slot_key_step(step["id"].as_str().unwrap_or_default()),
                "config.steps",
            )?;
        }
    }
    Ok(())
}

pub(crate) fn request_urls(check: &Synthetic) -> Vec<String> {
    match check.check_type {
        SyntheticType::Tcp | SyntheticType::Tls => Vec::new(),
        SyntheticType::Ssh => {
            let port = check.config["port"].as_u64().unwrap_or(22);
            vec![format!("ssh://{}:{port}", check.target)]
        }
        SyntheticType::Http => vec![check.target.clone()],
        SyntheticType::Browser => {
            let mut urls = vec![check.target.clone()];
            urls.extend(
                config_items(&check.config, "steps")
                    .iter()
                    .filter(|step| step["action"] == "navigate")
                    .filter_map(|step| step["url"].as_str().map(str::to_owned)),
            );
            urls
        }
    }
}

fn environment_keys(check: &Synthetic) -> impl Iterator<Item = &str> {
    check
        .environments
        .iter()
        .map(String::as_str)
        .chain(check.environments.is_empty().then_some(ORG_ENV_ID))
}

fn origins_allowed(origins: &Origins, meta: Option<&SlotMeta>) -> bool {
    let Some(recorded) = meta.and_then(|m| m.origins.as_ref()) else {
        return false;
    };
    origins.iter().all(|(env, now)| {
        recorded
            .get(env)
            .is_some_and(|allowed| now.iter().all(|origin| allowed.contains(origin)))
    })
}

fn replace_keeps(
    check: &mut Synthetic,
    mut resolve: impl FnMut(&str, &str) -> anyhow::Result<String>,
) -> anyhow::Result<()> {
    if matches!(check.check_type, SyntheticType::Tcp | SyntheticType::Tls) {
        return reject_keep(check);
    }
    visit_typed_slots(check, |value, key, field| {
        if is_keep_marker(value) {
            let key = key.ok_or_else(|| SlotRefusal::new(VALUE_REQUIRED, field))?;
            *value = resolve(&key, field)?;
        }
        Ok(())
    })?;
    for (pointer, key) in config_slots(check) {
        if let Some(slot) = check.config.pointer_mut(&pointer)
            && is_keep_value(slot)
        {
            let field = format!("config{pointer}");
            let key = key.ok_or_else(|| SlotRefusal::new(VALUE_REQUIRED, &field))?;
            if key == "step/" {
                return Err(SlotRefusal::new(VALUE_REQUIRED, field).into());
            }
            *slot = Value::String(resolve(&key, &field)?);
        }
    }
    if let Some(field) = find_config_keep(&check.config, "config") {
        return Err(SlotRefusal::new(VALUE_REQUIRED, field).into());
    }
    Ok(())
}

fn check_keep_context(
    check: &Synthetic,
    stored: &Synthetic,
    private: &HashSet<String>,
) -> anyhow::Result<()> {
    if check
        .locations
        .iter()
        .any(|id| private.contains(id) && !stored.locations.contains(id))
    {
        return Err(SlotRefusal::new(HOST_CHANGE, "locations").into());
    }
    for cookie in check.cookies.iter().filter(|c| is_keep_marker(&c.value)) {
        let mut named = stored
            .cookies
            .iter()
            .filter(|c| c.name == cookie.name)
            .peekable();
        if named.peek().is_none() {
            return Err(SlotRefusal::new(VALUE_REQUIRED, "cookies").into());
        }
        if !named.any(|c| {
            c.domain == cookie.domain && c.path == cookie.path && c.secure == cookie.secure
        }) {
            return Err(SlotRefusal::new(HOST_CHANGE, "cookies").into());
        }
    }
    if check.check_type == SyntheticType::Ssh
        && check
            .config
            .pointer("/auth/secret")
            .is_some_and(is_keep_value)
        && check.config["port"].as_u64().unwrap_or(22)
            != stored.config["port"].as_u64().unwrap_or(22)
    {
        return Err(SlotRefusal::new(HOST_CHANGE, "config.port").into());
    }
    if check.check_type == SyntheticType::Browser {
        let stored_steps: HashMap<_, _> = config_items(&stored.config, "steps")
            .iter()
            .filter_map(|s| Some((s["id"].as_str()?, s)))
            .collect();
        for step in config_items(&check.config, "steps")
            .iter()
            .filter(|s| is_keep_value(&s["value"]))
        {
            if let Some(old) = step["id"].as_str().and_then(|id| stored_steps.get(id))
                && (old["action"] != step["action"] || old["locator"] != step["locator"])
            {
                return Err(SlotRefusal::new(HOST_CHANGE, "config.steps").into());
            }
        }
    }
    Ok(())
}

fn stored_slots<'a>(check: &'a Synthetic) -> Vec<(String, StoredSlot<'a>)> {
    let mut slots = Vec::new();
    if matches!(check.check_type, SyntheticType::Tcp | SyntheticType::Tls) {
        return slots;
    }
    let mut add = |key, value: &'a str, encrypted| {
        if !value.is_empty() {
            slots.push((key, StoredSlot { value, encrypted }));
        }
    };
    match &check.auth {
        Some(SyntheticAuth::Basic { password, .. }) => {
            add(slot_key_auth_password(), password, true)
        }
        Some(SyntheticAuth::Bearer { token }) => add(slot_key_auth_token(), token, true),
        Some(SyntheticAuth::Secret { .. }) | None => {}
    }
    for cookie in &check.cookies {
        add(
            slot_key_cookie(&cookie.name, &cookie.domain, &cookie.path),
            &cookie.value,
            cookie.value.starts_with(SECRET_PREFIX),
        );
    }
    for var in check.variables.iter().filter(|v| v.secure) {
        add(
            slot_key_variable(&var.name),
            &var.value,
            var.value.starts_with(SECRET_PREFIX),
        );
    }
    for (pointer, key) in config_slots(check) {
        let Some(key) = key else { continue };
        if let Some(value) = check.config_secrets.get(&pointer) {
            add(key, value, true);
        } else if let Some(value) = check.config.pointer(&pointer).and_then(Value::as_str) {
            let legacy_cipher = !pointer.starts_with("/steps/")
                && pointer != "/body"
                && value.starts_with(SECRET_PREFIX);
            add(key, value, legacy_cipher);
        }
    }
    slots
}

fn find_config_keep(value: &Value, path: &str) -> Option<String> {
    if is_keep_value(value) {
        return Some(path.to_owned());
    }
    match value {
        Value::Object(fields) => fields
            .iter()
            .find_map(|(name, value)| find_config_keep(value, &format!("{path}.{name}"))),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(index, value)| find_config_keep(value, &format!("{path}[{index}]"))),
        _ => None,
    }
}

fn storage_paths(kind: &SyntheticType, write_only: bool) -> impl Iterator<Item = &'static str> {
    let split = if write_only {
        kind.write_only_split_paths()
    } else {
        &[]
    };
    kind.secret_config_paths().iter().chain(split).copied()
}

fn encrypt_check(
    check: &mut Synthetic,
    dek: &[u8],
    update: Option<&WriteMetadata<'_>>,
) -> anyhow::Result<()> {
    let mut secrets = std::mem::take(&mut check.config_secrets);
    if let Some(update) = update {
        secrets.clear();
        let meta = SlotMeta {
            updated_at: update.updated_at,
            updated_by: update.updated_by.to_owned(),
            origins: Some(update.origins.clone()),
        };
        let slots = stored_slots(check);
        if !slots.is_empty() {
            let fresh = encrypt_literal(dek, &serde_json::to_string(&meta)?)?;
            for (key, _) in slots {
                let ciphertext = match update.kept.get(&key) {
                    Some(stored) => stored.as_ref(),
                    None => Some(&fresh),
                };
                if let Some(ciphertext) = ciphertext {
                    secrets.insert(format!("{SLOT_META_PREFIX}{key}"), ciphertext.clone());
                }
            }
        }
    }
    let encrypt = if update.is_some() {
        encrypt_literal
    } else {
        encrypt_secret
    };
    visit_typed_slots(check, |value, _, _| {
        if update.is_some() && value.is_empty() {
            return Ok(());
        }
        *value = encrypt(dek, value)?;
        Ok(())
    })?;
    for path in storage_paths(&check.check_type, update.is_some()) {
        for (pointer, value) in take_strings_at_path(&mut check.config, path) {
            secrets.insert(pointer, encrypt(dek, &value)?);
        }
    }
    check.config_secrets = secrets;
    Ok(())
}

fn visit_typed_slots(
    check: &mut Synthetic,
    mut visit: impl FnMut(&mut String, Option<String>, &str) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    match &mut check.auth {
        Some(SyntheticAuth::Basic { password, .. }) => {
            visit(password, Some(slot_key_auth_password()), "auth.password")?
        }
        Some(SyntheticAuth::Bearer { token }) => {
            visit(token, Some(slot_key_auth_token()), "auth.token")?
        }
        Some(SyntheticAuth::Secret { .. }) | None => {}
    }
    for (i, cookie) in check.cookies.iter_mut().enumerate() {
        visit(
            &mut cookie.value,
            Some(slot_key_cookie(&cookie.name, &cookie.domain, &cookie.path)),
            &format!("cookies[{i}].value"),
        )?;
    }
    for (i, variable) in check.variables.iter_mut().enumerate() {
        visit(
            &mut variable.value,
            variable.secure.then(|| slot_key_variable(&variable.name)),
            &format!("variables[{i}].value"),
        )?;
    }
    Ok(())
}

fn config_slots(check: &Synthetic) -> Vec<(String, Option<String>)> {
    let mut slots = Vec::new();
    if matches!(
        check.check_type,
        SyntheticType::Browser | SyntheticType::Http
    ) {
        for (index, header) in config_items(&check.config, "headers").iter().enumerate() {
            let name = header["name"].as_str().unwrap_or_default();
            let key =
                header_is_secure(name, header["secure"].as_bool()).then(|| slot_key_header(name));
            slots.push((format!("/headers/{index}/value"), key));
        }
    }
    match check.check_type {
        SyntheticType::Http => slots.push(("/body".into(), Some(slot_key_body()))),
        SyntheticType::Ssh => slots.push(("/auth/secret".into(), Some(slot_key_ssh_secret()))),
        SyntheticType::Browser => {
            for (index, secret) in config_items(&check.config, "secrets").iter().enumerate() {
                let name = secret["name"].as_str().unwrap_or_default();
                slots.push((
                    format!("/secrets/{index}/value"),
                    Some(slot_key_secret(name)),
                ));
            }
            for (index, step) in config_items(&check.config, "steps").iter().enumerate() {
                let id = step["id"].as_str().unwrap_or_default();
                slots.push((format!("/steps/{index}/value"), Some(slot_key_step(id))));
            }
        }
        SyntheticType::Tcp | SyntheticType::Tls => {}
    }
    slots
}

fn config_items<'a>(config: &'a Value, field: &str) -> &'a [Value] {
    config[field]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn has_prefixed_typed_value(check: &Synthetic) -> bool {
    let encrypted_auth = match &check.auth {
        Some(SyntheticAuth::Basic { password, .. }) => password.starts_with(SECRET_PREFIX),
        Some(SyntheticAuth::Bearer { token }) => token.starts_with(SECRET_PREFIX),
        Some(SyntheticAuth::Secret { .. }) | None => false,
    };
    encrypted_auth
        || check
            .variables
            .iter()
            .any(|v| v.value.starts_with(SECRET_PREFIX))
        || check
            .cookies
            .iter()
            .any(|c| c.value.starts_with(SECRET_PREFIX))
}

fn edit_needs_dek(check: &Synthetic) -> bool {
    has_prefixed_typed_value(check)
        || check
            .config_secrets
            .keys()
            .any(|key| key.starts_with(SLOT_META_PREFIX))
        || config_slots(check).iter().any(|(pointer, key)| {
            key.is_none()
                && (check.config_secrets.contains_key(pointer)
                    || check
                        .config
                        .pointer(pointer)
                        .and_then(Value::as_str)
                        .is_some_and(|s| s.starts_with(SECRET_PREFIX)))
        })
}

fn redact_edit_with_dek(check: &mut Synthetic, dek: &[u8]) -> anyhow::Result<()> {
    let secrets = std::mem::take(&mut check.config_secrets);
    // Legacy writers encrypted even empty typed values. AES-SIV gives their ciphertext a stable
    // identity.
    let encrypted_empty = if dek.is_empty() {
        String::new()
    } else {
        encrypt_literal(dek, "")?
    };
    visit_typed_slots(check, |value, key, _| {
        if value.is_empty() || *value == encrypted_empty {
            value.clear();
        } else if let Some(key) = key {
            let meta = read_slot_meta(&secrets, &key, dek)?;
            *value = set_marker(
                meta.as_ref().map(|m| m.updated_at),
                meta.as_ref().map(|m| m.updated_by.as_str()),
            );
        } else if value.starts_with(SECRET_PREFIX) {
            *value = decrypt_secret(dek, value)?;
        }
        Ok(())
    })?;
    for (pointer, key) in config_slots(check) {
        let extracted = secrets.get(&pointer);
        let inline = check
            .config
            .pointer(&pointer)
            .and_then(Value::as_str)
            .unwrap_or_default();
        if inline.is_empty() && extracted.is_none() {
            continue;
        }
        let value = if let Some(key) = key {
            let meta = read_slot_meta(&secrets, &key, dek)?;
            set_marker_value(
                meta.as_ref().map(|m| m.updated_at),
                meta.as_ref().map(|m| m.updated_by.as_str()),
            )
        } else if let Some(ciphertext) = extracted {
            Value::String(decrypt_secret(dek, ciphertext)?)
        } else if inline.starts_with(SECRET_PREFIX) {
            Value::String(decrypt_secret(dek, inline)?)
        } else {
            continue;
        };
        if let Some((parent, field)) = pointer.rsplit_once('/')
            && let Some(object) = check
                .config
                .pointer_mut(parent)
                .and_then(Value::as_object_mut)
        {
            object.insert(field.to_owned(), value);
        }
    }
    Ok(())
}

fn read_slot_meta(
    secrets: &BTreeMap<String, String>,
    key: &str,
    dek: &[u8],
) -> anyhow::Result<Option<SlotMeta>> {
    let Some(ciphertext) = secrets.get(&format!("{SLOT_META_PREFIX}{key}")) else {
        return Ok(None);
    };
    let json = decrypt_secret(dek, ciphertext)?;
    serde_json::from_str(&json)
        .map(Some)
        .map_err(|_| anyhow::anyhow!("invalid slot metadata"))
}

#[cfg(test)]
mod dek_tests {
    use config::meta::synthetics::SyntheticCookie;
    use serde_json::{Value, json};

    use super::*;

    const TEST_DEK: &[u8] = &[7; 64];

    fn stored_check(body: &Synthetic, vars: &EnvVars) -> Synthetic {
        let mut stored = body.clone();
        let origins = check_origins(body, vars);
        encrypt_for_write(
            &mut stored,
            TEST_DEK,
            "owner",
            10,
            &origins,
            &KeptMetadata::new(),
        )
        .unwrap();
        stored
    }

    fn keep(body: &mut Synthetic, stored: &Synthetic) -> anyhow::Result<KeptMetadata> {
        resolve_keeps(body, stored, TEST_DEK, &EnvVars::new(), &HashSet::new())
    }

    fn encrypt_fixture(
        check: &mut Synthetic,
        dek: &[u8],
        update: Option<(&str, i64)>,
    ) -> anyhow::Result<()> {
        if let Some((by, at)) = update {
            let origins = check_origins(check, &EnvVars::new());
            encrypt_for_write(check, dek, by, at, &origins, &KeptMetadata::new())
        } else {
            encrypt_check(check, dek, None)
        }
    }

    fn refusal(error: anyhow::Error) -> SecretErrorCode {
        error.downcast_ref::<SlotRefusal>().unwrap().code
    }

    #[test]
    fn password_keep_checks_substituted_origins_and_preserves_metadata() {
        let mut body = Synthetic {
            target: "https://{{HOST}}/".into(),
            variables: vec![SyntheticVariable {
                name: "HOST".into(),
                value: "a.example".into(),
                ..Default::default()
            }],
            auth: Some(SyntheticAuth::Basic {
                username: "user".into(),
                password: "old".into(),
            }),
            ..Default::default()
        };
        let stored = stored_check(&body, &EnvVars::new());
        let meta = read_slot_meta(&stored.config_secrets, "auth/password", TEST_DEK)
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(meta.origins).unwrap(),
            json!({"_org":["https://a.example:443"]})
        );
        if let Some(SyntheticAuth::Basic { password, .. }) = &mut body.auth {
            *password = config::meta::synthetics::KEEP_MARKER.into();
        }
        let mut changed = body.clone();
        changed.variables[0].value = "evil.example".into();
        assert_eq!(
            refusal(keep(&mut changed, &stored).unwrap_err()),
            HOST_CHANGE
        );
        let kept = keep(&mut body, &stored).unwrap();
        assert!(
            matches!(&body.auth, Some(SyntheticAuth::Basic {password, ..}) if password == "old")
        );
        let origins = check_origins(&body, &EnvVars::new());
        encrypt_for_write(&mut body, TEST_DEK, "editor", 20, &origins, &kept).unwrap();
        assert_eq!(
            body.config_secrets["#m/auth/password"],
            stored.config_secrets["#m/auth/password"]
        );
    }

    #[test]
    fn unbound_slots_refuse_delivery_and_keep_before_origins_backfill() {
        let mut body = Synthetic {
            target: "https://a.example".into(),
            config: json!({"body":"payload"}),
            ..Default::default()
        };
        let mut stored = stored_check(&body, &EnvVars::new());
        stored.config_secrets.remove("#m/body");
        let origins = check_origins(&body, &EnvVars::new());
        assert_eq!(
            slot_origins_allowed(&stored, TEST_DEK, &origins),
            Err(SecretErrorCode::SlotOriginChanged)
        );
        body.config["body"] = json!({"keep":true});
        assert_eq!(refusal(keep(&mut body, &stored).unwrap_err()), HOST_CHANGE);
    }

    #[test]
    fn shared_host_drift_and_missing_metadata_gate_probe_delivery() {
        let body = Synthetic {
            target: "https://{{HOST}}".into(),
            config: json!({"body":"payload"}),
            ..Default::default()
        };
        let vars =
            |host: &str| EnvVars::from([("_org".into(), vec![("HOST".into(), host.into())])]);
        let mut stored = stored_check(&body, &vars("a.example"));
        let moved = check_origins(&body, &vars("b.example"));
        let same = check_origins(&body, &vars("a.example"));
        assert_eq!(slot_origins_allowed(&stored, TEST_DEK, &same), Ok(()));
        assert_eq!(
            slot_origins_allowed(&stored, TEST_DEK, &moved),
            Err(SecretErrorCode::SlotOriginChanged)
        );
        let legacy = SlotMeta {
            updated_at: 1,
            updated_by: "old".into(),
            origins: None,
        };
        stored.config_secrets.insert(
            "#m/body".into(),
            encrypt_secret(TEST_DEK, &serde_json::to_string(&legacy).unwrap()).unwrap(),
        );
        assert_eq!(
            slot_origins_allowed(&stored, TEST_DEK, &moved),
            Err(SecretErrorCode::SlotOriginChanged)
        );
    }

    #[test]
    fn kept_secure_variables_participate_in_each_environments_origins() {
        let mut body = Synthetic {
            target: "https://{{HOST}}/path".into(),
            check_type: SyntheticType::Browser,
            environments: vec!["prod".into(), "stage".into()],
            variables: vec![SyntheticVariable {
                name: "HOST".into(),
                value: "a.example".into(),
                secure: true,
                ..Default::default()
            }],
            config: json!({"steps":[
                {"id":"n", "action":"navigate","url":"{{SERVICE}}/dashboard"},
                {"id":"n2", "action":"navigate","url":"https://{{HOST}}/signin"},
                {"id":"other","action":"click","url":"unused.example"}
            ]}),
            ..Default::default()
        };
        let vars = EnvVars::from([
            (
                "prod".into(),
                vec![
                    ("SERVICE".into(), "p.example".into()),
                    ("HOST".into(), "shadowed.example".into()),
                ],
            ),
            ("stage".into(), vec![("SERVICE".into(), "s.example".into())]),
        ]);
        let stored = stored_check(&body, &vars);
        body.variables[0].value = config::meta::synthetics::KEEP_MARKER.into();
        resolve_keeps(&mut body, &stored, TEST_DEK, &vars, &HashSet::new()).unwrap();
        assert_eq!(
            serde_json::to_value(check_origins(&body, &vars)).unwrap(),
            json!({
                "prod":["https://a.example:443","https://p.example:443"],
                "stage":["https://a.example:443","https://s.example:443"]
            })
        );
        body.variables[0].value = config::meta::synthetics::KEEP_MARKER.into();
        body.variables[0].secure = false;
        assert_eq!(
            refusal(placeholder_copy(&body).unwrap_err()),
            VALUE_REQUIRED
        );
    }

    #[test]
    fn legacy_keep_without_origins_requires_a_new_value() {
        let mut body = Synthetic {
            config: json!({"body":"stored"}),
            ..Default::default()
        };
        let mut stored = stored_check(&body, &EnvVars::new());
        stored.config_secrets.remove("#m/body");
        body.config["body"] = json!({"keep":true});
        assert_eq!(refusal(keep(&mut body, &stored).unwrap_err()), HOST_CHANGE);
    }

    #[test]
    fn a_rehydrated_ciphertext_literal_stays_bound_to_its_origin() {
        let literal = encrypt_literal(TEST_DEK, "").unwrap();
        let body = Synthetic {
            target: "https://a.example".into(),
            config: json!({"headers":[{"name":"x-key","value":literal}]}),
            variables: vec![SyntheticVariable {
                name: "TOKEN".into(),
                value: literal.clone(),
                secure: true,
                ..Default::default()
            }],
            ..Default::default()
        };
        let mut stored = stored_check(&body, &EnvVars::new());
        rehydrate_config_secrets(&mut stored, TEST_DEK).unwrap();
        let mut variable = stored.variables.pop().unwrap();
        variable.value = literal;
        let moved = Origins::from([("_org".into(), vec!["https://b.example:443".into()])]);
        assert_eq!(
            slot_origins_allowed(&stored, TEST_DEK, &moved),
            Err(SecretErrorCode::SlotOriginChanged)
        );
        stored.config["headers"] = json!([]);
        stored.variables.push(variable);
        assert_eq!(
            slot_origins_allowed(&stored, TEST_DEK, &moved),
            Err(SecretErrorCode::SlotOriginChanged)
        );
    }

    #[test]
    fn write_only_values_turn_capture_off_and_feed_the_redactor() {
        let plain = Synthetic {
            check_type: SyntheticType::Browser,
            config: json!({"headers":[{"name":"Accept","value":"json"}],"steps":[{"id":"A","action":"click"}]}),
            collect_rum_data: true,
            ..Default::default()
        };
        assert!(!carries_write_only(&plain));
        let mut body = Synthetic {
            config: json!({"steps":[{"id":"A","action":"fill","value":"typed-step"}]}),
            auth: Some(SyntheticAuth::Basic {
                username: "u".into(),
                password: "pw".into(),
            }),
            ..plain.clone()
        };
        assert!(carries_write_only(&body));
        let stored = stored_check(&body, &EnvVars::new());
        assert!(carries_write_only(&stored));
        let mut values = stored_write_only_values(&stored, TEST_DEK);
        values.sort();
        assert_eq!(values, ["pw", "typed-step", "u:pw"]);

        body.session_replay = true;
        force_capture_off(&mut body);
        assert!(!body.collect_rum_data && !body.session_replay);
        assert_eq!(
            body.config["capture"],
            json!({"screenshot":"off","trace":"off","video":"off"})
        );
    }

    #[test]
    fn reordered_headers_and_steps_resolve_by_identity() {
        let mut body = Synthetic {
            check_type: SyntheticType::Browser,
            config: json!({
                "headers":[{"name":"A-Key","value":"one"},{"name":"B-Key","value":"two"}],
                "steps":[{"id":"A","action":"fill","value":"three"},{"id":"B","action":"fill","value":"four"}]
            }),
            ..Default::default()
        };
        let stored = stored_check(&body, &EnvVars::new());
        for field in ["headers", "steps"] {
            let rows = body.config[field].as_array_mut().unwrap();
            rows.reverse();
            for row in rows {
                row["value"] = json!({"keep":true});
            }
        }
        keep(&mut body, &stored).unwrap();
        assert_eq!(body.config["headers"][0]["value"], "two");
        assert_eq!(body.config["headers"][1]["value"], "one");
        assert_eq!(body.config["steps"][0]["value"], "four");
        assert_eq!(body.config["steps"][1]["value"], "three");
        body.config["headers"][1]["name"] = json!("b-key");
        assert_eq!(
            refusal(validate_slot_identities(&body).unwrap_err()),
            SecretErrorCode::DuplicateSlotIdentity
        );
    }

    #[test]
    fn cookie_keep_requires_the_exact_tuple_even_when_metadata_keys_collide() {
        let mut body = Synthetic {
            cookies: vec![SyntheticCookie {
                name: "a|b".into(),
                domain: "c".into(),
                path: "/".into(),
                value: "cookie".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let stored = stored_check(&body, &EnvVars::new());
        body.cookies[0].name = "a".into();
        body.cookies[0].domain = "b|c".into();
        body.cookies[0].value = config::meta::synthetics::KEEP_MARKER.into();
        assert_eq!(
            refusal(keep(&mut body, &stored).unwrap_err()),
            VALUE_REQUIRED
        );
    }

    #[test]
    fn keep_rejects_changed_destination_and_missing_or_public_slots() {
        let mut body = Synthetic {
            cookies: vec![SyntheticCookie {
                name: "sid".into(),
                domain: "example.org".into(),
                value: "cookie".into(),
                ..Default::default()
            }],
            config: json!({"headers":[{"name":"X-Key","value":"typed"}]}),
            ..Default::default()
        };
        let stored = stored_check(&body, &EnvVars::new());
        let mut changed = body.clone();
        changed.cookies[0].value = config::meta::synthetics::KEEP_MARKER.into();
        changed.cookies[0].domain = "other.example".into();
        assert_eq!(
            refusal(keep(&mut changed, &stored).unwrap_err()),
            HOST_CHANGE
        );
        body.config["headers"][0]["secure"] = json!(false);
        assert!(placeholder_copy(&body).is_ok());
        body.config["headers"][0]["value"] = json!({"set":true});
        assert_eq!(
            refusal(placeholder_copy(&body).unwrap_err()),
            VALUE_REQUIRED
        );
        for (kind, config, ptr, changed_field, new_value, reason) in [
            (
                SyntheticType::Ssh,
                json!({"port":22,"auth":{"secret":"pass"}}),
                "/auth/secret",
                "/port",
                json!(23),
                HOST_CHANGE,
            ),
            (
                SyntheticType::Browser,
                json!({"steps":[{"id":"a","action":"fill","locator":{"id":"old"},"value":"pass"}]}),
                "/steps/0/value",
                "/steps/0/locator",
                json!({"id":"new"}),
                HOST_CHANGE,
            ),
            (
                SyntheticType::Browser,
                json!({"steps":[{"id":"a","action":"fill","value":"pass"}]}),
                "/steps/0/value",
                "/steps/0/id",
                json!("missing"),
                VALUE_REQUIRED,
            ),
        ] {
            let mut body = Synthetic {
                check_type: kind,
                config,
                ..Default::default()
            };
            let stored = stored_check(&body, &EnvVars::new());
            *body.config.pointer_mut(ptr).unwrap() = json!({"keep":true});
            *body.config.pointer_mut(changed_field).unwrap() = new_value;
            assert_eq!(refusal(keep(&mut body, &stored).unwrap_err()), reason);
        }
        let mut body = Synthetic {
            config: json!({"body":"pass"}),
            ..Default::default()
        };
        let stored = stored_check(&body, &EnvVars::new());
        body.config["body"] = json!({"keep":true});
        body.locations.push("private".into());
        let err = resolve_keeps(
            &mut body,
            &stored,
            TEST_DEK,
            &EnvVars::new(),
            &HashSet::from(["private".into()]),
        )
        .unwrap_err();
        assert_eq!(refusal(err), HOST_CHANGE);
    }

    #[test]
    fn latched_edit_serializes_only_metadata_for_credentials() {
        let mut check = Synthetic {
            check_type: SyntheticType::Browser,
            auth: Some(SyntheticAuth::Basic {
                username: "alice".into(),
                password: "private-password".into(),
            }),
            cookies: vec![SyntheticCookie {
                name: "sid".into(),
                domain: "example.org".into(),
                path: "/".into(),
                value: "private-cookie".into(),
                ..Default::default()
            }],
            variables: vec![
                SyntheticVariable {
                    name: "TOKEN".into(),
                    secure: true,
                    value: "private-variable".into(),
                    ..Default::default()
                },
                SyntheticVariable {
                    name: "COLOR".into(),
                    value: "green".into(),
                    ..Default::default()
                },
            ],
            config: json!({
                "secrets": [{"name":"login", "value":"private-login"}],
                "headers": [
                    {"name":"Authorization", "value":"private-authorization"},
                    {"name":"X-Api-Key", "value":"private-api-key"},
                    {"name":"Accept", "value":"text/plain"},
                    {"name":"X-Debug", "secure":true, "value":"private-debug"},
                    {"name":"X-Client-Token", "secure":false, "value":"public-token"}
                ]
            }),
            ..Default::default()
        };
        encrypt_fixture(&mut check, TEST_DEK, Some(("alice", 17))).unwrap();
        for key in [
            "auth/password",
            "cookie/sid|example.org|/",
            "variable/TOKEN",
            "secret/login",
            "header/authorization",
            "header/x-api-key",
            "header/x-debug",
        ] {
            let meta = &check.config_secrets[&format!("#m/{key}")];
            let meta: Value =
                serde_json::from_str(&decrypt_secret(TEST_DEK, meta).unwrap()).unwrap();
            assert_eq!(
                meta,
                json!({"updated_at":17,"updated_by":"alice","origins":{"_org":[""]}})
            );
        }
        assert!(!check.config_secrets.contains_key("#m/header/accept"));
        redact_edit_with_dek(&mut check, TEST_DEK).unwrap();
        assert!(check.config_secrets.is_empty());
        let view = serde_json::to_value(check).unwrap();
        let marker = json!({"set":true,"updated_at":17,"updated_by":"alice"});
        for path in [
            "/auth/password",
            "/cookies/0/value",
            "/variables/0/value",
            "/config/secrets/0/value",
            "/config/headers/0/value",
            "/config/headers/1/value",
            "/config/headers/3/value",
        ] {
            assert_eq!(view.pointer(path), Some(&marker), "{path}");
        }
        assert!(!view.to_string().contains("private-"));
        assert_eq!(view["variables"][1]["value"], "green");
        assert_eq!(view["config"]["headers"][2]["value"], "text/plain");
        assert_eq!(view["config"]["headers"][4]["value"], "public-token");
    }

    #[test]
    fn bearer_and_ssh_secrets_are_write_only_even_if_their_ciphertext_is_unreadable() {
        let mut check = Synthetic {
            auth: Some(SyntheticAuth::Bearer {
                token: "private-bearer".into(),
            }),
            check_type: SyntheticType::Ssh,
            config: json!({"auth":{"secret":"private-ssh"}}),
            ..Default::default()
        };
        encrypt_fixture(&mut check, TEST_DEK, Some(("bob", 21))).unwrap();
        for key in ["#m/auth/token", "#m/ssh/secret"] {
            assert!(check.config_secrets.contains_key(key));
        }
        if let Some(SyntheticAuth::Bearer { token }) = &mut check.auth {
            *token = "AESenc:broken".into();
        }
        check
            .config_secrets
            .insert("/auth/secret".into(), "AESenc:broken".into());
        redact_edit_with_dek(&mut check, TEST_DEK).unwrap();
        let view = serde_json::to_value(check).unwrap();
        let marker = json!({"set":true, "updated_at":21, "updated_by":"bob"});
        assert_eq!(view["auth"]["token"], marker);
        assert_eq!(view["config"]["auth"]["secret"], marker);
        assert!(!view.to_string().contains("private-"));
    }

    #[test]
    fn body_and_step_values_split_only_on_latched_writes_and_rehydrate_for_probes() {
        let target = "https://example.org/?q=1&token=abc";
        for (kind, config, path, key, value) in [
            (
                SyntheticType::Http,
                json!({"body":"t-body-1"}),
                "/body",
                "#m/body",
                "t-body-1",
            ),
            (
                SyntheticType::Browser,
                json!({"steps":[{"id":"s1","value":"t-step-2"}]}),
                "/steps/0/value",
                "#m/step/s1",
                "t-step-2",
            ),
        ] {
            let original = Synthetic {
                check_type: kind,
                config,
                target: target.into(),
                ..Default::default()
            };
            for update in [None, Some(("writer", 123))] {
                let mut stored = original.clone();
                encrypt_fixture(&mut stored, TEST_DEK, update).unwrap();
                if update.is_some() {
                    assert_eq!(stored.config.pointer(path), Some(&json!("")));
                    assert_ne!(stored.config_secrets[path], value);
                    assert!(stored.config_secrets.contains_key(key));
                    assert!(!stored.config.to_string().contains(value));
                } else {
                    assert_eq!(stored.config.pointer(path), Some(&json!(value)));
                    assert!(stored.config_secrets.is_empty());
                }
                assert_eq!(stored.target, target);
                assert!(!stored.config_secrets.keys().any(|k| k.starts_with("#q/")));
                let mut edit = stored.clone();
                redact_edit_with_dek(&mut edit, TEST_DEK).unwrap();
                assert_eq!(edit.target, target);
                assert_eq!(edit.config.pointer(path).unwrap()["set"], true);
                assert!(!serde_json::to_string(&edit).unwrap().contains(value));
                let mut response = original.clone();
                redact_write_only_slots(&mut response);
                assert_eq!(response.config.pointer(path), Some(&json!("")));
                rehydrate_config_secrets(&mut stored, TEST_DEK).unwrap();
                assert_eq!(stored.config.pointer(path), Some(&json!(value)));
                assert_eq!(stored.config_secrets.contains_key(key), update.is_some());
                assert!(!stored.config_secrets.contains_key(path));
            }
        }
    }

    #[test]
    fn a_legacy_secure_header_is_redacted_without_metadata() {
        let mut check = Synthetic {
            config: json!({"headers":[{"name":"Authorization","value":"private-header"}]}),
            ..Default::default()
        };
        encrypt_fixture(&mut check, TEST_DEK, None).unwrap();
        let stored = check.config_secrets["/headers/0/value"].clone();
        for legacy_in_place in [false, true] {
            let mut edit = check.clone();
            if legacy_in_place {
                edit.config_secrets.clear();
                edit.config["headers"][0]["value"] = json!(stored);
            }
            redact_edit_with_dek(&mut edit, TEST_DEK).unwrap();
            assert_eq!(
                edit.config["headers"][0]["value"],
                json!({"set":true,"updated_at":null,"updated_by":null})
            );
        }
    }

    #[test]
    fn literal_ciphertext_prefix_round_trips_once_through_probe_and_edit_reads() {
        let value = "AESenc:abc";
        let mut check = Synthetic {
            config: json!({"headers":[{"name":"Accept","value":value}]}),
            variables: vec![SyntheticVariable {
                value: value.into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        encrypt_fixture(&mut check, TEST_DEK, Some(("writer", 5))).unwrap();
        assert_ne!(check.config_secrets["/headers/0/value"], value);
        assert_eq!(
            decrypt_secret(TEST_DEK, &check.variables[0].value).unwrap(),
            value
        );
        let mut probe = check.clone();
        rehydrate_config_secrets(&mut probe, TEST_DEK).unwrap();
        assert_eq!(probe.config["headers"][0]["value"], value);
        redact_edit_with_dek(&mut check, TEST_DEK).unwrap();
        assert_eq!(check.config["headers"][0]["value"], value);
        assert_eq!(check.variables[0].value, value);
    }

    #[test]
    fn empty_credentials_stay_empty_on_edit_in_both_storage_forms() {
        for update in [None, Some(("writer", 123))] {
            let mut check = Synthetic {
                auth: Some(SyntheticAuth::Bearer {
                    token: String::new(),
                }),
                config: json!({"body":null, "headers":[{"name":"Authorization", "value":""}]}),
                cookies: vec![SyntheticCookie::default()],
                variables: vec![SyntheticVariable {
                    secure: true,
                    ..Default::default()
                }],
                ..Default::default()
            };
            encrypt_fixture(&mut check, TEST_DEK, update).unwrap();
            assert!(check.config_secrets.is_empty());
            redact_edit_with_dek(&mut check, TEST_DEK).unwrap();
            let view = serde_json::to_value(check).unwrap();
            for path in [
                "/auth/token",
                "/variables/0/value",
                "/cookies/0/value",
                "/config/headers/0/value",
            ] {
                assert_eq!(view.pointer(path), Some(&json!("")), "{path}");
            }
            assert_eq!(view["config"]["body"], Value::Null);
        }
    }

    /// Wrong key must surface as an error. Defaulting to an empty string let
    /// the edit form render blanks, and saving that form re-encrypted them over
    /// ciphertext that was only unreadable — destroying the secret.
    #[test]
    fn decrypting_with_the_wrong_key_is_an_error_not_a_blank() {
        let right = vec![1u8; 64];
        let wrong = vec![2u8; 64];
        let stored = encrypt_secret(&right, "hunter2").unwrap();

        assert_eq!(decrypt_secret(&right, &stored).unwrap(), "hunter2");
        assert!(
            decrypt_secret(&wrong, &stored).is_err(),
            "a wrong key must not decrypt to a value a later save would persist"
        );
    }

    #[test]
    fn a_secret_round_trips_through_one_regions_key() {
        let dek = vec![9u8; 64];
        let stored = encrypt_secret(&dek, "s3cret").unwrap();
        assert!(stored.starts_with("AESenc:"));
        assert_eq!(decrypt_secret(&dek, &stored).unwrap(), "s3cret");
    }

    #[test]
    fn an_empty_value_is_stored_empty_not_as_ciphertext() {
        let dek = vec![3u8; 64];
        assert_eq!(store_value(&dek, "").unwrap(), "");
        assert!(!encrypt_secret(&dek, "").unwrap().is_empty());
    }

    #[test]
    fn a_non_empty_value_still_round_trips_through_store_value() {
        let dek = vec![3u8; 64];
        let stored = store_value(&dek, "hunter2").unwrap();
        assert!(stored.starts_with("AESenc:"));
        assert_eq!(decrypt_secret(&dek, &stored).unwrap(), "hunter2");
    }
}
