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

//! Shared variables and the environments that scope them.
//!
//! Nothing here returns a stored value. Reads project through
//! [`SyntheticsVariableView`], which has no value field, so a leak would have to
//! be a new type rather than a forgotten redaction.

use infra::db::{get_orm_client_ro, get_orm_client_rw};
use sea_orm::TransactionTrait;

use super::*;

/// Resolves an environment by the name the URL and OpenFGA both use.
pub async fn get_environment(
    org_id: &str,
    name: &str,
) -> anyhow::Result<Option<SyntheticsEnvironmentRecord>> {
    let conn = get_orm_client_ro().await;
    synthetics_environments::get_by_name(conn, org_id, name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// The name a grant is written against, for an environment held by id.
///
/// The check stores environment ids; OpenFGA objects are named by the
/// environment's name, so a permission check on a check's `environments` has to
/// cross that gap.
pub async fn get_environment_name(org_id: &str, id: &str) -> anyhow::Result<Option<String>> {
    let conn = get_orm_client_ro().await;
    Ok(synthetics_environments::get_by_id(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .map(|env| env.name))
}

/// Every environment in the org with its variables inline.
///
/// One call renders the whole Environments tab. Values are never included, so
/// the payload is bounded by metadata no matter how many secrets an environment
/// holds. The caller filters by permission — this is the unfiltered set.
pub async fn list_environments(org_id: &str) -> anyhow::Result<Vec<SyntheticsEnvironmentView>> {
    let conn = get_orm_client_ro().await;
    let envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let variables = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let counts = synthetics_checks::count_by_environment(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let usage = placeholder_usage(org_id).await?;

    Ok(envs
        .into_iter()
        .map(|env| SyntheticsEnvironmentView {
            checks_count: counts.get(&env.id).copied().unwrap_or(0),
            variables: with_usage(
                variables
                    .iter()
                    .filter(|v| v.env.as_deref() == Some(env.id.as_str()))
                    .map(|v| v.to_view())
                    .collect(),
                &usage,
            ),
            id: env.id,
            name: env.name,
            description: env.description,
            owner: env.owner,
            created_at: env.created_at,
            updated_at: env.updated_at,
        })
        .collect())
}

pub async fn create_environment(
    org_id: &str,
    req: SyntheticsEnvironmentRequest,
    created_by: &str,
) -> anyhow::Result<SyntheticsEnvironmentView> {
    validate_environment_request(&req).map_err(|e| anyhow::anyhow!(e))?;
    let now = config::utils::time::now_micros();
    let record = SyntheticsEnvironmentRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        name: req.name.trim().to_string(),
        description: req.description,
        owner: Some(created_by.to_string()),
        created_at: now,
        updated_at: now,
    };
    let conn = get_orm_client_rw().await;
    synthetics_environments::add(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if ofga_enabled() {
        set_ownership(org_id, &environment_object(&record.name), "", "").await;
    }

    Ok(environment_view(record))
}

/// Updates an environment's description.
///
/// A rename is refused rather than applied. The name is the OpenFGA object id,
/// so renaming would orphan every grant written against the old one — silently,
/// and in the direction that removes access from whoever was administering the
/// environment's secrets.
pub async fn update_environment(
    org_id: &str,
    name: &str,
    req: SyntheticsEnvironmentRequest,
) -> anyhow::Result<Option<SyntheticsEnvironmentView>> {
    validate_environment_request(&req).map_err(|e| anyhow::anyhow!(e))?;
    if req.name.trim() != name {
        anyhow::bail!(
            "name: an environment cannot be renamed — the name is its access-control identity"
        );
    }
    let conn = get_orm_client_rw().await;
    let Some(mut record) = synthetics_environments::get_by_name(conn, org_id, name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    record.description = req.description;
    record.updated_at = config::utils::time::now_micros();
    synthetics_environments::update(
        conn,
        org_id,
        &record.id,
        &record.name,
        &record.description,
        record.updated_at,
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(Some(environment_view(record)))
}

/// Deletes an environment and every plain variable scoped to it.
///
/// Three guards, in descending severity:
///
/// - **A secret refuses outright**, with no `force`. Its value is write-only, so a delete is
///   unrecoverable by anyone — there is no copy to restore from and no one who can read it back.
/// - **A pinned check refuses**, or the check would keep naming an environment that no longer
///   exists and its next run would resolve a different variable set than it was written against.
/// - **Plain variables need `force`**, which is the confirmation the UI collects after listing
///   them.
pub async fn delete_environment(org_id: &str, name: &str, force: bool) -> anyhow::Result<bool> {
    let conn = get_orm_client_rw().await;
    let Some(record) = synthetics_environments::get_by_name(conn, org_id, name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(false);
    };
    let counts = synthetics_checks::count_by_environment(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if let Some(n) = counts.get(&record.id).filter(|n| **n > 0) {
        anyhow::bail!("environment '{name}' is still used by {n} check(s)");
    }

    let scoped: Vec<_> = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .into_iter()
        .filter(|v| v.env.as_deref() == Some(record.id.as_str()))
        .collect();
    let secrets: Vec<&str> = scoped
        .iter()
        .filter(|v| v.is_secret())
        .map(|v| v.name.as_str())
        .collect();
    if !secrets.is_empty() {
        anyhow::bail!(
            "environment '{name}' still holds {} secret(s): {}. Delete them individually first — a \
             secret's value is write-only, so this cannot be undone.",
            secrets.len(),
            secrets.join(", ")
        );
    }
    if !force && !scoped.is_empty() {
        anyhow::bail!(
            "environment '{name}' still holds {} variable(s): {}. Re-send with force=true to \
             delete them with it.",
            scoped.len(),
            scoped
                .iter()
                .map(|v| v.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    let deleted = synthetics_environments::delete(conn, org_id, &record.id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if deleted {
        synthetics_variables::invalidate_and_publish(org_id).await;
        if ofga_enabled() {
            remove_ownership(org_id, &environment_object(&record.name), "", "").await;
        }
    }
    Ok(deleted)
}

/// Variable name → names of the checks whose definition references `{{NAME}}`.
///
/// One pass over the org's checks, because every list endpoint needs the count
/// for every row at once. `target` and `config` together carry every place a
/// placeholder can appear — steps, headers, URLs all live inside `config`.
async fn placeholder_usage(org_id: &str) -> anyhow::Result<HashMap<String, Vec<String>>> {
    let conn = get_orm_client_ro().await;
    let checks = synthetics_checks::list(conn, org_id, &ListSyntheticsParams::default())
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let mut usage: HashMap<String, Vec<String>> = HashMap::new();
    for check in checks {
        let mut text = check.target.clone();
        text.push(' ');
        text.push_str(&check.config.to_string());
        for name in placeholder_names(&text) {
            usage.entry(name).or_default().push(check.name.clone());
        }
    }
    Ok(usage)
}

/// Stamps `used_by_checks` onto a batch of views.
fn with_usage(
    mut views: Vec<SyntheticsVariableView>,
    usage: &HashMap<String, Vec<String>>,
) -> Vec<SyntheticsVariableView> {
    for view in &mut views {
        view.used_by_checks = usage.get(&view.name).map_or(0, |c| c.len() as u64);
    }
    views
}

/// The unscoped tier — variables that apply in every environment.
pub async fn list_global_variables(org_id: &str) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    let conn = get_orm_client_ro().await;
    let views: Vec<_> = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .iter()
        .filter(|v| v.env.is_none())
        .map(|v| v.to_view())
        .collect();
    Ok(with_usage(views, &placeholder_usage(org_id).await?))
}

/// One environment's variables, or `None` when the environment does not exist.
pub async fn list_environment_variables(
    org_id: &str,
    env_name: &str,
) -> anyhow::Result<Option<Vec<SyntheticsVariableView>>> {
    let conn = get_orm_client_ro().await;
    let Some(env) = synthetics_environments::get_by_name(conn, org_id, env_name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    let views: Vec<_> = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .iter()
        .filter(|v| v.env.as_deref() == Some(env.id.as_str()))
        .map(|v| v.to_view())
        .collect();
    Ok(Some(with_usage(views, &placeholder_usage(org_id).await?)))
}

/// Rejects a check that names an environment which does not exist.
///
/// Whether the caller may *use* the environment is a separate question, asked in
/// the handler — it needs the caller's identity, which nothing down here has.
pub async fn validate_environments(org_id: &str, ids: &[String]) -> anyhow::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = get_orm_client_ro().await;
    let known = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    for id in ids {
        if !known.iter().any(|e| &e.id == id) {
            anyhow::bail!("environments: no environment with id '{id}' in this org");
        }
    }
    Ok(())
}

pub async fn create_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    req: SyntheticsVariableRequest,
    created_by: &str,
) -> anyhow::Result<SyntheticsVariableView> {
    let env_id = env.map(|e| e.id.clone());
    validate_variable_request(&req, env_id.as_deref(), false).map_err(|e| anyhow::anyhow!(e))?;
    let name = normalize_variable_name(&req.name);
    let conn = get_orm_client_rw().await;
    reject_cross_scope_conflict(conn, org_id, &name, env_id.as_deref(), None).await?;

    let dek = synthetics_dek(org_id).await?;
    let now = config::utils::time::now_micros();
    let record = SyntheticsVariableRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        env: env_id,
        name,
        value: encrypt_secret(&dek, req.value.as_deref().unwrap_or_default())?,
        kind: kind_str(req.kind).to_string(),
        description: req.description,
        example: req.example,
        tags: req.tags,
        owner: Some(created_by.to_string()),
        created_at: now,
        updated_at: now,
    };
    synthetics_variables::add(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(record.to_view())
}

/// Replaces one variable. An omitted `value` keeps the stored one, which is the
/// only way to edit a write-only secret's metadata.
pub async fn update_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
    req: SyntheticsVariableRequest,
) -> anyhow::Result<Option<SyntheticsVariableView>> {
    let conn = get_orm_client_rw().await;
    let Some(mut record) = scoped_variable(conn, org_id, env, id).await? else {
        return Ok(None);
    };
    validate_variable_request(&req, record.env.as_deref(), !record.value.is_empty())
        .map_err(|e| anyhow::anyhow!(e))?;

    let name = normalize_variable_name(&req.name);
    reject_cross_scope_conflict(conn, org_id, &name, record.env.as_deref(), Some(id)).await?;

    if let Some(value) = req.value {
        let dek = synthetics_dek(org_id).await?;
        record.value = encrypt_secret(&dek, &value)?;
    }
    record.name = name;
    record.kind = kind_str(req.kind).to_string();
    record.description = req.description;
    record.example = req.example;
    record.tags = req.tags;
    record.updated_at = config::utils::time::now_micros();

    synthetics_variables::update(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(Some(record.to_view()))
}

/// Deletes a variable, refusing while checks still reference it.
///
/// `force` is the confirmation the UI collects after showing the list. The
/// names travel in the error rather than behind a second endpoint, so the
/// caller cannot render the guard without having been told what it guards.
pub async fn delete_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
    force: bool,
) -> anyhow::Result<bool> {
    let conn = get_orm_client_rw().await;
    let Some(record) = scoped_variable(conn, org_id, env, id).await? else {
        return Ok(false);
    };
    if !force
        && let Some(users) = placeholder_usage(org_id).await?.get(&record.name)
        && !users.is_empty()
    {
        anyhow::bail!(
            "'{}' is referenced by {} check(s): {}. Re-send with force=true to delete it anyway.",
            record.name,
            users.len(),
            users.join(", ")
        );
    }
    synthetics_variables::delete(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

/// A check's resolved set, name by name, with the scope each name comes from.
///
/// The check editor's Inherited group and the `{{` autocomplete both read this.
/// Values never appear — the merge is over metadata, so this is safe to hand to
/// anyone who may edit the check.
pub async fn resolved_variables(
    org_id: &str,
    check_id: &str,
) -> anyhow::Result<Option<Vec<ResolvedVariableView>>> {
    let conn = get_orm_client_ro().await;
    let Some(check) = synthetics_checks::get(conn, org_id, check_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    let env_id = check.environments.first().cloned();
    let envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Names the check defines itself. Looked up as a set because the shared
    // rows below need to know which of them the check shadows.
    let own: std::collections::HashSet<&str> =
        check.variables.iter().map(|v| v.name.as_str()).collect();

    let mut out: Vec<ResolvedVariableView> = shared
        .iter()
        .filter(|v| applies_to(v, env_id.as_deref()))
        .map(|v| ResolvedVariableView {
            scope: match &v.env {
                None => "global".to_string(),
                Some(id) => envs
                    .iter()
                    .find(|e| &e.id == id)
                    .map_or_else(|| id.clone(), |e| e.name.clone()),
            },
            overridden: own.contains(v.name.as_str()),
            name: v.name.clone(),
            kind: if v.is_secret() {
                SyntheticsVariableKind::Secret
            } else {
                SyntheticsVariableKind::Plain
            },
            example: v.example.clone(),
            description: v.description.clone(),
            has_value: !v.value.is_empty(),
        })
        .collect();

    out.extend(check.variables.iter().map(|v| ResolvedVariableView {
        name: v.name.clone(),
        // The check tier keeps the old `secure` flag, which is a display hint
        // rather than a storage property — so it is reported as plain here.
        kind: SyntheticsVariableKind::Plain,
        scope: "check".to_string(),
        overridden: false,
        example: v.example.clone(),
        description: String::new(),
        has_value: !v.value.is_empty(),
    }));
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.scope.cmp(&b.scope)));
    Ok(Some(out))
}

/// Moves a check-scoped variable up into the shared tier.
///
/// The ciphertext moves as-is. Both tiers are encrypted under the same org DEK,
/// so no plaintext has to materialise to promote a value — which also means a
/// caller who cannot read the value can still promote it.
pub async fn promote_check_variable(
    org_id: &str,
    check_id: &str,
    name: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    owner: &str,
) -> anyhow::Result<SyntheticsVariableView> {
    let conn = get_orm_client_rw().await;
    let mut check = synthetics_checks::get(conn, org_id, check_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {check_id}"))?;

    let normalized = normalize_variable_name(name);
    let position = check
        .variables
        .iter()
        .position(|v| normalize_variable_name(&v.name) == normalized)
        .ok_or_else(|| anyhow::anyhow!("check has no variable named '{name}'"))?;

    let env_id = env.map(|e| e.id.clone());
    reject_cross_scope_conflict(conn, org_id, &normalized, env_id.as_deref(), None).await?;

    let source = check.variables[position].clone();
    let now = config::utils::time::now_micros();
    let record = SyntheticsVariableRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        env: env_id,
        name: normalized,
        value: source.value.clone(),
        // Promoting does not make a check variable write-only: `secure` was a
        // display hint and the value stays readable through `get_synthetic`.
        // Calling it a secret here would claim a guarantee it does not have.
        kind: synthetics_variables::KIND_PLAIN.to_string(),
        description: String::new(),
        example: source.example.clone(),
        tags: Vec::new(),
        owner: Some(owner.to_string()),
        created_at: now,
        updated_at: now,
    };
    synthetics_variables::add(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Remove the check's copy only after the shared row exists, so a failure
    // leaves the value where it was rather than nowhere.
    check.variables.remove(position);
    synthetics_checks::update(conn, org_id, check_id, check)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(record.to_view())
}

/// Moves an environment-scoped variable to the unscoped tier.
pub async fn promote_to_global(
    org_id: &str,
    env: &SyntheticsEnvironmentRecord,
    id: &str,
) -> anyhow::Result<SyntheticsVariableView> {
    let conn = get_orm_client_rw().await;
    let mut record = scoped_variable(conn, org_id, Some(env), id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("variable not found in environment '{}'", env.name))?;

    if record.is_secret() {
        anyhow::bail!(
            "Secrets must belong to an environment. Change '{}' to a plain variable first.",
            record.name
        );
    }

    // The same name in another environment has no single correct global value,
    // so name the conflict rather than silently picking one.
    let others: Vec<String> = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .into_iter()
        .filter(|v| v.name == record.name && v.id != record.id && v.env.is_some())
        .map(|v| v.env.unwrap_or_default())
        .collect();
    if !others.is_empty() {
        anyhow::bail!(
            "'{}' also exists in {} other environment(s). Remove those first — there is no single \
             correct global value.",
            record.name,
            others.len()
        );
    }

    record.updated_at = config::utils::time::now_micros();
    synthetics_variables::set_env(conn, org_id, id, None, record.updated_at)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    record.env = None;
    Ok(record.to_view())
}

/// Splits one unscoped variable into per-environment rows.
///
/// A split, not a move: one row becomes N, each with its own value. Values
/// arrive with the request rather than being filled in afterwards, because the
/// half-finished state is one where checks have already stopped resolving.
pub async fn split_to_environments(
    org_id: &str,
    id: &str,
    targets: Vec<SplitTarget>,
    owner: &str,
) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    if targets.is_empty() {
        anyhow::bail!("targets: at least one environment is required");
    }
    let conn = get_orm_client_rw().await;
    let source = scoped_variable(conn, org_id, None, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("global variable not found: {id}"))?;

    let known = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut resolved = Vec::with_capacity(targets.len());
    for target in &targets {
        let env = known
            .iter()
            .find(|e| e.name == target.environment)
            .ok_or_else(|| anyhow::anyhow!("no environment named '{}'", target.environment))?;
        resolved.push((env.clone(), target.value.clone()));
    }

    let dek = synthetics_dek(org_id).await?;
    let now = config::utils::time::now_micros();
    let mut created = Vec::with_capacity(resolved.len());
    for (env, value) in resolved {
        created.push(SyntheticsVariableRecord {
            id: config::ider::uuid(),
            org_id: org_id.to_string(),
            env: Some(env.id.clone()),
            name: source.name.clone(),
            value: encrypt_secret(&dek, &value)?,
            kind: source.kind.clone(),
            description: source.description.clone(),
            example: source.example.clone(),
            tags: source.tags.clone(),
            owner: Some(owner.to_string()),
            created_at: now,
            updated_at: now,
        });
    }

    // One transaction: a half-applied split leaves the name defined both
    // globally and per-environment, which the cross-scope rule forbids and
    // which resolves non-deterministically until someone notices.
    let txn = conn.begin().await?;
    for record in &created {
        synthetics_variables::add(&txn, record)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    synthetics_variables::delete(&txn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    txn.commit().await?;
    synthetics_variables::invalidate_and_publish(org_id).await;

    Ok(created.iter().map(|r| r.to_view()).collect())
}

/// The shared tier for one job: every unscoped variable, plus the ones scoped to
/// the environment the check runs against, decrypted.
///
/// Takes the DEK rather than fetching one so `resolve` keeps making exactly one
/// `cipher::get_dek` call for both tiers.
pub async fn resolve_shared_variables(
    org_id: &str,
    env_id: Option<&str>,
    dek: &[u8],
) -> anyhow::Result<Vec<(String, String)>> {
    let conn = get_orm_client_ro().await;
    let rows = synthetics_variables::list_cached(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows.iter().filter(|v| applies_to(v, env_id)) {
        let value = if row.value.starts_with("AESenc:") {
            decrypt_secret(dek, &row.value)?
        } else {
            row.value.clone()
        };
        out.push((row.name.clone(), value));
    }
    Ok(out)
}

/// Whether an org has any shared variable at all.
///
/// `resolve` asks before fetching a DEK: a check with no inline secrets and no
/// shared variables must not pay for a key it will not use, and one with only
/// shared variables must not skip the key it does.
pub async fn org_has_shared_variables(org_id: &str) -> bool {
    let conn = get_orm_client_ro().await;
    match synthetics_variables::list_cached(conn, org_id).await {
        Ok(rows) => !rows.is_empty(),
        Err(e) => {
            log::error!("[synthetics] shared variable lookup failed for {org_id}: {e}");
            false
        }
    }
}

/// `var.env IS NULL OR var.env = <the environment being run>` — §4 of the design.
///
/// An environment filters; it never overrides. A variable with no environment
/// applies to every run, including an unscoped one.
fn applies_to(var: &SyntheticsVariableRecord, env_id: Option<&str>) -> bool {
    match (&var.env, env_id) {
        (None, _) => true,
        (Some(v), Some(job)) => v == job,
        (Some(_), None) => false,
    }
}

/// Whether an existing row makes `name` ambiguous in the scope being written.
///
/// Ambiguity is exactly the unscoped/scoped split: two rows with the same name,
/// one carrying an environment and one not, both match a run in that
/// environment. Two rows in *different* environments are fine — only one of them
/// ever applies.
fn conflicts_across_scopes(
    existing: &SyntheticsVariableRecord,
    name: &str,
    env_id: Option<&str>,
    skip_id: Option<&str>,
) -> bool {
    existing.name == name
        && Some(existing.id.as_str()) != skip_id
        && existing.env.is_none() != env_id.is_none()
}

fn kind_str(kind: SyntheticsVariableKind) -> &'static str {
    match kind {
        SyntheticsVariableKind::Secret => synthetics_variables::KIND_SECRET,
        SyntheticsVariableKind::Plain => synthetics_variables::KIND_PLAIN,
    }
}

fn environment_object(name: &str) -> String {
    format!("{}:{}", get_ofga_type("synthetic_environment"), name)
}

fn environment_view(record: SyntheticsEnvironmentRecord) -> SyntheticsEnvironmentView {
    SyntheticsEnvironmentView {
        id: record.id,
        name: record.name,
        description: record.description,
        owner: record.owner,
        created_at: record.created_at,
        updated_at: record.updated_at,
        checks_count: 0,
        variables: Vec::new(),
    }
}

/// Loads a variable and asserts it lives in the scope the URL addressed.
///
/// Without this, `DELETE /environments/staging/variables/{id}` would delete a
/// production variable for anyone holding staging — the route resolves its
/// permission from the path segment, so the row has to be checked against it.
async fn scoped_variable<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
) -> anyhow::Result<Option<SyntheticsVariableRecord>> {
    let found = synthetics_variables::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(found.filter(|v| v.env.as_deref() == env.map(|e| e.id.as_str())))
}

/// Rejects a name that would exist both unscoped and env-scoped.
///
/// Both rows would match the same run, so which value the check saw would
/// depend on row order. The unique index cannot see this — the two rows differ
/// in `env`, which is exactly what makes them unique to the database.
async fn reject_cross_scope_conflict<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
    name: &str,
    env_id: Option<&str>,
    skip_id: Option<&str>,
) -> anyhow::Result<()> {
    let rows = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let conflict = rows
        .iter()
        .find(|v| conflicts_across_scopes(v, name, env_id, skip_id));
    if let Some(other) = conflict {
        let (here, there) = match env_id {
            Some(_) => ("an environment", "no environment"),
            None => ("no environment", "an environment"),
        };
        anyhow::bail!(
            "name: '{name}' already exists with {there}; a name cannot be defined both with {here} \
             and without — both would apply to the same run (id {})",
            other.id
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn var(env: Option<&str>) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            id: "v1".into(),
            org_id: "acme".into(),
            env: env.map(str::to_string),
            name: "BASE_URL".into(),
            value: String::new(),
            kind: synthetics_variables::KIND_PLAIN.into(),
            description: String::new(),
            example: String::new(),
            tags: Vec::new(),
            owner: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn an_unscoped_variable_applies_to_every_run() {
        assert!(applies_to(&var(None), Some("prod")));
        assert!(applies_to(&var(None), None));
    }

    #[test]
    fn a_scoped_variable_applies_only_to_its_own_environment() {
        assert!(applies_to(&var(Some("prod")), Some("prod")));
        assert!(!applies_to(&var(Some("prod")), Some("staging")));
        // An unscoped run resolves the unscoped tier only.
        assert!(!applies_to(&var(Some("prod")), None));
    }

    #[test]
    fn a_name_cannot_be_both_unscoped_and_scoped() {
        // Both rows would apply to a prod run, so which value the check saw
        // would depend on row order. The unique index cannot see this: the two
        // rows differ in `env`, which is what makes them unique to the database.
        assert!(conflicts_across_scopes(
            &var(None),
            "BASE_URL",
            Some("prod"),
            None
        ));
        assert!(conflicts_across_scopes(
            &var(Some("prod")),
            "BASE_URL",
            None,
            None
        ));
    }

    #[test]
    fn the_same_name_in_two_environments_is_fine() {
        // Only one of them ever applies to a given run.
        assert!(!conflicts_across_scopes(
            &var(Some("prod")),
            "BASE_URL",
            Some("staging"),
            None
        ));
    }

    #[test]
    fn a_variable_does_not_conflict_with_itself_on_update() {
        assert!(!conflicts_across_scopes(
            &var(None),
            "BASE_URL",
            Some("prod"),
            Some("v1")
        ));
    }

    #[test]
    fn a_different_name_never_conflicts() {
        assert!(!conflicts_across_scopes(
            &var(None),
            "API_TOKEN",
            Some("prod"),
            None
        ));
    }

    #[test]
    fn usage_counts_are_stamped_by_name() {
        let views = vec![
            SyntheticsVariableView {
                name: "BASE_URL".into(),
                ..Default::default()
            },
            SyntheticsVariableView {
                name: "UNUSED".into(),
                ..Default::default()
            },
        ];
        let usage = HashMap::from([(
            "BASE_URL".to_string(),
            vec!["Checkout".to_string(), "Login".to_string()],
        )]);

        let stamped = with_usage(views, &usage);
        assert_eq!(stamped[0].used_by_checks, 2);
        // Absent from the index means genuinely unreferenced, not unknown.
        assert_eq!(stamped[1].used_by_checks, 0);
    }

    #[test]
    fn usage_matching_is_case_sensitive() {
        // `{{base_url}}` does not resolve a variable stored as `BASE_URL`, so it
        // must not be counted as a use of it — the count drives the deletion
        // guard, and a false count would guard the wrong thing.
        let views = vec![SyntheticsVariableView {
            name: "BASE_URL".into(),
            ..Default::default()
        }];
        let usage = HashMap::from([("base_url".to_string(), vec!["Checkout".to_string()])]);

        assert_eq!(with_usage(views, &usage)[0].used_by_checks, 0);
    }

    #[test]
    fn kinds_map_to_the_strings_the_check_constraint_reads() {
        assert_eq!(kind_str(SyntheticsVariableKind::Secret), "secret");
        assert_eq!(kind_str(SyntheticsVariableKind::Plain), "plain");
    }
}
