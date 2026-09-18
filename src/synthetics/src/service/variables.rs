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
pub async fn get_environment_name(org_id: &str, id: &str) -> anyhow::Result<Option<String>> {
    let conn = get_orm_client_ro().await;
    Ok(synthetics_environments::get_by_id(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .map(|env| env.name))
}

/// The org's `global` environment, created on first use by whichever caller needs it.
pub async fn global_environment(org_id: &str) -> anyhow::Result<SyntheticsEnvironmentRecord> {
    let conn = get_orm_client_rw().await;
    let (record, created) = synthetics_environments::get_or_create_global(
        conn,
        org_id,
        config::utils::time::now_micros(),
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if created {
        publish_environment_put(&record).await?;
        if ofga_enabled() {
            set_ownership(org_id, &environment_object(&record.name), "", "").await;
        }
    }
    Ok(record)
}

/// Every environment in the org with its variables inline, the global one first.
pub async fn list_environments(org_id: &str) -> anyhow::Result<Vec<SyntheticsEnvironmentView>> {
    global_environment(org_id).await?;
    let conn = get_orm_client_rw().await;
    let mut envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    envs.sort_by_key(|env| !env.is_global);
    let variables = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let counts = synthetics_checks::count_by_environment(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let usage = placeholder_usage(org_id).await?;

    // Projected once for the whole response: every environment's variables come
    // out of the same read, so one DEK fetch covers them all.
    let mut projected: HashMap<&str, Vec<SyntheticsVariableView>> = HashMap::new();
    for (row, view) in variables
        .iter()
        .zip(project_views(org_id, variables.iter()).await?)
    {
        projected.entry(row.env.as_str()).or_default().push(view);
    }

    Ok(envs
        .into_iter()
        .map(|env| SyntheticsEnvironmentView {
            checks_count: counts.get(&env.id).copied().unwrap_or(0),
            variables: with_usage(
                projected.remove(env.id.as_str()).unwrap_or_default(),
                &usage,
            ),
            id: env.id,
            name: env.name,
            description: env.description,
            owner: env.owner,
            is_global: env.is_global,
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
        is_global: false,
        created_at: now,
        updated_at: now,
    };
    let conn = get_orm_client_rw().await;
    synthetics_environments::add(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    publish_environment_put(&record).await?;

    if ofga_enabled() {
        set_ownership(org_id, &environment_object(&record.name), "", "").await;
    }

    Ok(environment_view(record))
}

/// Copies an environment's variables into a new environment.
pub async fn duplicate_environment(
    org_id: &str,
    source: &str,
    new_name: &str,
    created_by: &str,
) -> anyhow::Result<SyntheticsEnvironmentView> {
    let request = SyntheticsEnvironmentRequest {
        name: new_name.trim().to_string(),
        description: String::new(),
    };
    validate_environment_request(&request).map_err(|e| anyhow::anyhow!(e))?;

    let conn = get_orm_client_rw().await;
    let source = synthetics_environments::get_by_name(conn, org_id, source)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("environment '{source}' not found"))?;

    let rows: Vec<_> = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .into_iter()
        .filter(|v| v.env == source.id)
        .collect();

    let now = config::utils::time::now_micros();
    let target = duplicate_target(&source, &request.name, created_by, now);

    // One transaction: a half-copied environment is worse than none, because it
    // looks complete in the rail while missing the values a run needs.
    let txn = conn.begin().await?;
    synthetics_environments::add(&txn, &target)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut copies = Vec::with_capacity(rows.len());
    for row in &rows {
        let copy = SyntheticsVariableRecord {
            id: config::ider::uuid(),
            org_id: org_id.to_string(),
            env: target.id.clone(),
            name: row.name.clone(),
            // The one line that matters: ciphertext for plain, nothing for a
            // secret. Both scopes share the DEK, so the plain copy needs no
            // decrypt and no plaintext ever enters this process.
            value: if row.is_secret() {
                String::new()
            } else {
                row.value.clone()
            },
            kind: row.kind.clone(),
            description: row.description.clone(),
            example: row.example.clone(),
            tags: row.tags.clone(),
            owner: Some(created_by.to_string()),
            created_at: now,
            updated_at: now,
        };
        synthetics_variables::insert_row(&txn, &copy)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        copies.push(copy);
    }
    txn.commit().await?;
    synthetics_variables::invalidate_and_publish(org_id).await;
    publish_batch(org_id, Some(&target), &copies, &[]).await?;

    if ofga_enabled() {
        set_ownership(org_id, &environment_object(&target.name), "", "").await;
    }
    Ok(environment_view(target))
}

/// Updates an environment's description.
pub async fn update_environment(
    org_id: &str,
    name: &str,
    req: SyntheticsEnvironmentRequest,
) -> anyhow::Result<Option<SyntheticsEnvironmentView>> {
    let conn = get_orm_client_rw().await;
    let Some(mut record) = synthetics_environments::get_by_name(conn, org_id, name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    if let Err(e) = validate_environment_update(&record, &req) {
        anyhow::bail!(e);
    }
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
    publish_environment_put(&record).await?;
    Ok(Some(environment_view(record)))
}

/// Deletes an environment and every plain variable scoped to it.
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
    let scoped: Vec<_> = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .into_iter()
        .filter(|v| v.env == record.id)
        .collect();
    if let Some(refusal) = environment_delete_refusal(
        &record,
        counts.get(&record.id).copied().unwrap_or(0),
        &scoped,
        force,
    ) {
        anyhow::bail!(refusal);
    }

    let deleted = synthetics_environments::delete(conn, org_id, &record.id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if deleted {
        synthetics_variables::invalidate_and_publish(org_id).await;
        publish_environment_delete(org_id, &record.id).await?;
        if ofga_enabled() {
            remove_ownership(org_id, &environment_object(&record.name), "", "").await;
        }
    }
    Ok(deleted)
}

/// Variable name → names of the checks whose definition references `{{NAME}}`.
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

/// Projects records to views, decrypting the plain ones.
async fn project_views(
    org_id: &str,
    rows: impl Iterator<Item = &SyntheticsVariableRecord>,
) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    let rows: Vec<_> = rows.collect();
    let needs_dek = rows
        .iter()
        .any(|v| !v.is_secret() && v.value.starts_with("AESenc:"));
    let dek = if needs_dek {
        Some(synthetics_dek(org_id).await?)
    } else {
        None
    };

    Ok(rows
        .into_iter()
        .map(|row| {
            let plain = (!row.is_secret()).then(|| {
                if !row.value.starts_with("AESenc:") {
                    return row.value.clone();
                }
                match dek.as_ref().map(|d| decrypt_secret(d, &row.value)) {
                    Some(Ok(v)) => v,
                    _ => {
                        log::error!(
                            "[synthetics] variable {} in {org_id} could not be decrypted",
                            row.name
                        );
                        String::new()
                    }
                }
            });
            row.to_view(plain)
        })
        .collect())
}

/// [`project_views`] for one record.
async fn project_view(
    org_id: &str,
    record: &SyntheticsVariableRecord,
) -> anyhow::Result<SyntheticsVariableView> {
    Ok(project_views(org_id, std::iter::once(record))
        .await?
        .pop()
        .unwrap_or_default())
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

/// The global environment's variables, which apply in every environment.
pub async fn list_global_variables(org_id: &str) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    let conn = get_orm_client_ro().await;
    let rows = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let global_id = synthetics_environments::global_environment_id(org_id);
    let views = project_views(org_id, rows.iter().filter(|v| v.env == global_id)).await?;
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
    let rows = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let views = project_views(org_id, rows.iter().filter(|v| v.env == env.id)).await?;
    Ok(Some(with_usage(views, &placeholder_usage(org_id).await?)))
}

/// Rejects a check that names an environment which does not exist.
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

/// Creates a variable in `env`, or in the global environment when `env` is None.
pub async fn create_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    req: SyntheticsVariableRequest,
    created_by: &str,
) -> anyhow::Result<SyntheticsVariableView> {
    let env = scope_or_global(org_id, env).await?;
    validate_variable_request(&req, env.is_global, false, None).map_err(|e| anyhow::anyhow!(e))?;
    let name = normalize_variable_name(&req.name);

    let before = org_variable_state(org_id).await?;
    let mut after = before.clone();
    after.shared.push(SharedVariableScope {
        name: name.clone(),
        env: cap_scope(&env),
    });
    if let Some(err) = variable_cap_error(&before, &after) {
        anyhow::bail!(err);
    }

    let conn = get_orm_client_rw().await;

    let dek = synthetics_dek(org_id).await?;
    let now = config::utils::time::now_micros();
    let record = SyntheticsVariableRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        env: env.id,
        name,
        value: store_value(&dek, req.value.as_deref().unwrap_or_default())?,
        kind: kind_str(req.kind.unwrap_or_default()).to_string(),
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
    publish_variable_put(&record).await?;
    project_view(org_id, &record).await
}

/// Replaces one variable. An omitted `value` keeps the stored one, which is the
/// only way to edit a write-only secret's metadata.
pub async fn update_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
    req: SyntheticsVariableRequest,
) -> anyhow::Result<Option<SyntheticsVariableView>> {
    let env = scope_or_global(org_id, env).await?;
    let conn = get_orm_client_rw().await;
    let Some(mut record) = scoped_variable(conn, org_id, &env, id).await? else {
        return Ok(None);
    };
    validate_variable_request(
        &req,
        env.is_global,
        !record.value.is_empty(),
        Some(stored_kind(&record)),
    )
    .map_err(|e| anyhow::anyhow!(e))?;

    let name = normalize_variable_name(&req.name);

    if name != record.name {
        let before = org_variable_state(org_id).await?;
        let mut after = before.clone();
        let scope = cap_scope(&env);
        if let Some(row) = after
            .shared
            .iter_mut()
            .find(|v| v.name == record.name && v.env == scope)
        {
            row.name = name.clone();
        }
        if let Some(err) = variable_cap_error(&before, &after) {
            anyhow::bail!(err);
        }
    }

    if let Some(value) = req.value {
        let dek = synthetics_dek(org_id).await?;
        record.value = store_value(&dek, &value)?;
    }
    record.name = name;
    record.description = req.description;
    record.example = req.example;
    record.tags = req.tags;
    record.updated_at = config::utils::time::now_micros();

    synthetics_variables::update(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    publish_variable_put(&record).await?;
    Ok(Some(project_view(org_id, &record).await?))
}

/// Deletes a variable, refusing while checks still reference it.
pub async fn delete_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
    force: bool,
) -> anyhow::Result<bool> {
    let env = scope_or_global(org_id, env).await?;
    let conn = get_orm_client_rw().await;
    let Some(record) = scoped_variable(conn, org_id, &env, id).await? else {
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
    let deleted = synthetics_variables::delete(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if deleted {
        publish_variable_delete(org_id, id).await?;
    }
    Ok(deleted)
}

/// A check's resolved set, name by name, with the scope each name comes from.
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
    let envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(Some(resolved_rows(
        &shared,
        &envs,
        &check.variables,
        check.environments.first().map(String::as_str),
        &synthetics_environments::global_environment_id(org_id),
    )))
}

/// Every environment's resolved set, keyed by environment name.
pub async fn resolved_variables_grouped(
    org_id: &str,
    check_id: &str,
) -> anyhow::Result<Option<ResolvedVariablesGrouped>> {
    let conn = get_orm_client_ro().await;
    let Some(check) = synthetics_checks::get(conn, org_id, check_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    let envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let global_id = synthetics_environments::global_environment_id(org_id);
    let mut grouped = ResolvedVariablesGrouped::default();
    if check.environments.is_empty() {
        grouped.environments.push(String::new());
        grouped.resolved.insert(
            String::new(),
            resolved_rows(&shared, &envs, &check.variables, None, &global_id),
        );
    }
    for id in &check.environments {
        let Some(env) = envs.iter().find(|e| &e.id == id) else {
            continue;
        };
        grouped.environments.push(env.name.clone());
        grouped.resolved.insert(
            env.name.clone(),
            resolved_rows(&shared, &envs, &check.variables, Some(id), &global_id),
        );
    }
    Ok(Some(grouped))
}

/// One environment's resolved rows, from already-loaded data.
fn resolved_rows(
    shared: &[SyntheticsVariableRecord],
    envs: &[SyntheticsEnvironmentRecord],
    check_vars: &[SyntheticVariable],
    env_id: Option<&str>,
    global_id: &str,
) -> Vec<ResolvedVariableView> {
    // Names the check defines itself. Looked up as a set because the shared
    // rows below need to know which of them the check shadows.
    let own: std::collections::HashSet<&str> = check_vars.iter().map(|v| v.name.as_str()).collect();
    // Names an applicable env row defines — each shadows its global fallback.
    let env_overrides: std::collections::HashSet<&str> = shared
        .iter()
        .filter(|v| v.env != global_id && applies_to(v, env_id, global_id))
        .map(|v| v.name.as_str())
        .collect();

    let mut out: Vec<ResolvedVariableView> = shared
        .iter()
        .filter(|v| applies_to(v, env_id, global_id))
        .map(|v| ResolvedVariableView {
            scope: if v.env == global_id {
                GLOBAL_ENVIRONMENT_NAME.to_string()
            } else {
                envs.iter()
                    .find(|e| e.id == v.env)
                    .map_or_else(|| v.env.clone(), |e| e.name.clone())
            },
            overridden: own.contains(v.name.as_str())
                || (v.env == global_id && env_overrides.contains(v.name.as_str())),
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

    out.extend(check_vars.iter().map(|v| ResolvedVariableView {
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
    out
}

/// One shared secret released to a browser for replay.
pub struct ReplaySecret {
    pub name: String,
    /// The environment that governs it, and what the caller checks write permission against.
    pub environment: String,
    pub value: String,
}

/// Decrypted shared secrets a check's steps reference, for replay auto-fill.
pub async fn replay_secrets(
    org_id: &str,
    check_id: &str,
) -> anyhow::Result<Option<Vec<ReplaySecret>>> {
    let conn = get_orm_client_ro().await;
    let Some(check) = synthetics_checks::get(conn, org_id, check_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };

    // Names the steps reference, from the same fields the probe substitutes.
    let mut referenced = std::collections::HashSet::new();
    let mut text = check.target.clone();
    text.push(' ');
    text.push_str(&check.config.to_string());
    for name in placeholder_names(&text) {
        referenced.insert(name);
    }
    // A name the check defines itself resolves from the check, so replay
    // already has it and there is nothing to release.
    for own in &check.variables {
        referenced.remove(&own.name);
    }
    if referenced.is_empty() {
        return Ok(Some(Vec::new()));
    }

    let envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let rows = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let global_id = synthetics_environments::global_environment_id(org_id);
    let job_env = check.environments.first().map(String::as_str);
    let candidates: Vec<_> = rows
        .iter()
        .filter(|v| v.is_secret() && referenced.contains(&v.name))
        // An unset secret has nothing to release, and decrypting an empty
        // column errors — which would fail the whole call, not just this row.
        .filter(|v| !v.value.is_empty())
        .filter(|v| applies_to(v, job_env, &global_id))
        .collect();
    if candidates.is_empty() {
        return Ok(Some(Vec::new()));
    }

    let dek = synthetics_dek(org_id).await?;
    let mut out = Vec::with_capacity(candidates.len());
    for row in candidates {
        let environment = envs
            .iter()
            .find(|e| e.id == row.env)
            .map_or_else(|| row.env.clone(), |e| e.name.clone());
        out.push(ReplaySecret {
            name: row.name.clone(),
            environment,
            value: decrypt_secret(&dek, &row.value)?,
        });
    }
    Ok(Some(out))
}

/// Moves a check-scoped variable up into the shared tier.
pub async fn promote_check_variable(
    org_id: &str,
    check_id: &str,
    name: &str,
    env: &SyntheticsEnvironmentRecord,
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

    let source = check.variables[position].clone();

    // The source check already resolved this name; every *other* check gains it.
    let before = org_variable_state(org_id).await?;
    let mut after = before.clone();
    after.shared.push(SharedVariableScope {
        name: normalized.clone(),
        env: cap_scope(env),
    });
    if let Some(err) = variable_cap_error(&before, &after) {
        anyhow::bail!(err);
    }

    let now = config::utils::time::now_micros();
    let record = SyntheticsVariableRecord {
        id: config::ider::uuid(),
        org_id: org_id.to_string(),
        env: env.id.clone(),
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
    publish_variable_put(&record).await?;

    check.variables.remove(position);
    synthetics_checks::update(conn, org_id, check_id, check.clone())
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // The check lost a variable, and this writes through the table layer rather than
    // `update_synthetic`, so nothing else broadcasts it.
    publish_check_update(org_id, check_id, &check).await?;
    project_view(org_id, &record).await
}

/// Moves an environment's variable into the global environment.
pub async fn promote_to_global(
    org_id: &str,
    env: &SyntheticsEnvironmentRecord,
    id: &str,
) -> anyhow::Result<SyntheticsVariableView> {
    if env.is_global {
        anyhow::bail!("the variable is already in the '{GLOBAL_ENVIRONMENT_NAME}' environment");
    }
    let global = global_environment(org_id).await?;
    let conn = get_orm_client_rw().await;
    let mut record = scoped_variable(conn, org_id, env, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("variable not found in environment '{}'", env.name))?;

    if record.is_secret() {
        anyhow::bail!(secret_cannot_be_global(&record.name));
    }

    // Moving to global widens the row from one environment to every check in the org.
    let before = org_variable_state(org_id).await?;
    let mut after = before.clone();
    if let Some(row) = after
        .shared
        .iter_mut()
        .find(|v| v.name == record.name && v.env.as_deref() == Some(env.id.as_str()))
    {
        row.env = cap_scope(&global);
    }
    if let Some(err) = variable_cap_error(&before, &after) {
        anyhow::bail!(err);
    }

    // Other environments may keep rows of the same name: they simply shadow
    // the promoted value, which becomes the fallback everywhere else.
    record.updated_at = config::utils::time::now_micros();
    synthetics_variables::set_env(conn, org_id, id, &global.id, record.updated_at)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    record.env = global.id;
    publish_variable_put(&record).await?;
    project_view(org_id, &record).await
}

/// Splits one global variable into per-environment rows.
pub async fn split_to_environments(
    org_id: &str,
    id: &str,
    targets: Vec<SplitTarget>,
    owner: &str,
) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    if targets.is_empty() {
        anyhow::bail!("targets: at least one environment is required");
    }
    let global = global_environment(org_id).await?;
    let conn = get_orm_client_rw().await;
    let source = scoped_variable(conn, org_id, &global, id)
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

    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let resolved = split_targets_without_own_row(&source.name, resolved, &shared);
    if resolved.is_empty() {
        anyhow::bail!(
            "every selected environment already has its own '{}' — deleting the global is a \
             delete, not a split",
            source.name
        );
    }

    let dek = synthetics_dek(org_id).await?;
    let now = config::utils::time::now_micros();
    let mut created = Vec::with_capacity(resolved.len());
    for (env, value) in resolved {
        created.push(SyntheticsVariableRecord {
            id: config::ider::uuid(),
            org_id: org_id.to_string(),
            env: env.id.clone(),
            name: source.name.clone(),
            value: store_value(&dek, &value)?,
            kind: source.kind.clone(),
            description: source.description.clone(),
            example: source.example.clone(),
            tags: source.tags.clone(),
            owner: Some(owner.to_string()),
            created_at: now,
            updated_at: now,
        });
    }

    // One transaction: a half-applied split deletes the fallback before every
    // copy exists, leaving some environments resolving nothing.
    let txn = conn.begin().await?;
    for record in &created {
        synthetics_variables::insert_row(&txn, record)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    synthetics_variables::delete_row(&txn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    txn.commit().await?;
    synthetics_variables::invalidate_and_publish(org_id).await;
    publish_batch(org_id, None, &created, std::slice::from_ref(&source.id)).await?;

    project_views(org_id, created.iter()).await
}

/// Every global variable plus the job environment's own, decrypted.
pub async fn resolve_shared_variables(
    org_id: &str,
    env_id: Option<&str>,
    dek: &[u8],
) -> anyhow::Result<Vec<(String, String)>> {
    let conn = get_orm_client_ro().await;
    let rows = synthetics_variables::list_cached(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let global_id = synthetics_environments::global_environment_id(org_id);
    let applicable = order_for_merge(
        rows.into_iter()
            .filter(|v| applies_to(v, env_id, &global_id))
            .collect(),
        &global_id,
    );
    let mut out = Vec::new();
    for row in applicable.iter() {
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

/// The org's checks and shared rows, as the write-time cap gate reads them.
pub(crate) async fn org_variable_state(org_id: &str) -> anyhow::Result<OrgVariableState> {
    let conn = get_orm_client_ro().await;
    let checks = synthetics_checks::list(conn, org_id, &ListSyntheticsParams::default())
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let global_id = synthetics_environments::global_environment_id(org_id);
    Ok(OrgVariableState {
        checks: checks.iter().map(|c| check_footprint(&c.id, c)).collect(),
        shared: shared
            .into_iter()
            .map(|v| SharedVariableScope {
                name: v.name,
                env: (v.env != global_id).then_some(v.env),
            })
            .collect(),
    })
}

/// One check reduced to what the cap needs: what it defines and where it runs.
pub(crate) fn check_footprint(id: &str, check: &Synthetic) -> CheckVariableFootprint {
    CheckVariableFootprint {
        id: id.to_string(),
        name: check.name.clone(),
        own_names: check.variables.iter().map(|v| v.name.clone()).collect(),
        environments: check.environments.clone(),
    }
}

// ── Super-cluster replication ───────────────────────────────────────────────── Values go on the
// wire as PLAINTEXT and each region encrypts under its own key.

/// The wire copy of one row, with its value decrypted for the receiving region.
#[cfg(feature = "enterprise")]
async fn variable_payload(
    record: &SyntheticsVariableRecord,
) -> anyhow::Result<o2_enterprise::enterprise::super_cluster::queue::SyntheticsVariablePayload> {
    // An unset secret stays unset: encrypting "" on the far side would report
    // it as set.
    let value = if record.value.starts_with("AESenc:") {
        let dek = synthetics_dek(&record.org_id).await?;
        decrypt_secret(&dek, &record.value)?
    } else {
        record.value.clone()
    };
    Ok(
        o2_enterprise::enterprise::super_cluster::queue::SyntheticsVariablePayload {
            id: record.id.clone(),
            org_id: record.org_id.clone(),
            env: Some(record.env.clone()),
            name: record.name.clone(),
            value,
            kind: record.kind.clone(),
            description: record.description.clone(),
            example: record.example.clone(),
            tags: record.tags.clone(),
            owner: record.owner.clone(),
            created_at: record.created_at,
            updated_at: record.updated_at,
        },
    )
}

#[cfg(feature = "enterprise")]
fn environment_payload(
    record: &SyntheticsEnvironmentRecord,
) -> o2_enterprise::enterprise::super_cluster::queue::SyntheticsEnvironmentPayload {
    o2_enterprise::enterprise::super_cluster::queue::SyntheticsEnvironmentPayload {
        id: record.id.clone(),
        org_id: record.org_id.clone(),
        name: record.name.clone(),
        description: record.description.clone(),
        owner: record.owner.clone(),
        is_global: record.is_global,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

async fn publish_variable_put(record: &SyntheticsVariableRecord) -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        queue::synthetics_variables(SyntheticsVariablesMessage::VariablePut {
            org_id: record.org_id.clone(),
            payload: variable_payload(record).await?,
        })
        .await?;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = record;
    Ok(())
}

async fn publish_variable_delete(org_id: &str, id: &str) -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        queue::synthetics_variables(SyntheticsVariablesMessage::VariableDelete {
            org_id: org_id.to_string(),
            id: id.to_string(),
        })
        .await?;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, id);
    Ok(())
}

async fn publish_environment_put(record: &SyntheticsEnvironmentRecord) -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        queue::synthetics_variables(SyntheticsVariablesMessage::EnvironmentPut {
            org_id: record.org_id.clone(),
            payload: environment_payload(record),
        })
        .await?;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = record;
    Ok(())
}

async fn publish_environment_delete(org_id: &str, id: &str) -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        queue::synthetics_variables(SyntheticsVariablesMessage::EnvironmentDelete {
            org_id: org_id.to_string(),
            id: id.to_string(),
        })
        .await?;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, id);
    Ok(())
}

/// Broadcasts the check a promote just edited.
async fn publish_check_update(
    org_id: &str,
    check_id: &str,
    check: &Synthetic,
) -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsCheckPayload};
        let slug = folders::get_name_by_pk(&check.folder_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .unwrap_or_default();
        queue::synthetics_check_update(
            org_id,
            check_id,
            SyntheticsCheckPayload::for_wire(org_id, check, &slug).await?,
        )
        .await?;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, check_id, check);
    Ok(())
}

/// One transaction on the far side too: a split and a duplicate each write
/// several rows at once, and a region holding half of one resolves a set no
/// region ever had.
async fn publish_batch(
    org_id: &str,
    environment: Option<&SyntheticsEnvironmentRecord>,
    puts: &[SyntheticsVariableRecord],
    deletes: &[String],
) -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{
            self, SyntheticsVariablesMessage, SyntheticsVariablesOp,
        };
        let mut ops = Vec::with_capacity(puts.len() + deletes.len() + 1);
        if let Some(record) = environment {
            ops.push(SyntheticsVariablesOp::EnvironmentPut(environment_payload(
                record,
            )));
        }
        for record in puts {
            ops.push(SyntheticsVariablesOp::VariablePut(
                variable_payload(record).await?,
            ));
        }
        for id in deletes {
            ops.push(SyntheticsVariablesOp::VariableDelete(id.clone()));
        }
        queue::synthetics_variables(SyntheticsVariablesMessage::Batch {
            org_id: org_id.to_string(),
            ops,
        })
        .await?;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, environment, puts, deletes);
    Ok(())
}

/// Why a secret cannot join the global environment.
fn secret_cannot_be_global(name: &str) -> String {
    format!(
        "'{name}' is a secret, and a secret's environment is its access boundary — it cannot be \
         made global. Create a plain variable instead."
    )
}

/// Why the global environment cannot be deleted.
fn global_delete_refusal() -> String {
    format!(
        "the '{GLOBAL_ENVIRONMENT_NAME}' environment cannot be deleted — every org has one, and \
         its variables apply in every other environment"
    )
}

/// The first rule blocking a delete; global outranks every other guard and `force`.
fn environment_delete_refusal(
    env: &SyntheticsEnvironmentRecord,
    checks_using: u64,
    scoped: &[SyntheticsVariableRecord],
    force: bool,
) -> Option<String> {
    let name = &env.name;
    if env.is_global {
        return Some(global_delete_refusal());
    }
    if checks_using > 0 {
        return Some(format!(
            "environment '{name}' is still used by {checks_using} check(s)"
        ));
    }
    let secrets: Vec<&str> = scoped
        .iter()
        .filter(|v| v.is_secret())
        .map(|v| v.name.as_str())
        .collect();
    if !secrets.is_empty() {
        return Some(format!(
            "environment '{name}' still holds {} secret(s): {}. Delete them individually first — a \
             secret's value is write-only, so this cannot be undone.",
            secrets.len(),
            secrets.join(", ")
        ));
    }
    if !force && !scoped.is_empty() {
        return Some(format!(
            "environment '{name}' still holds {} variable(s): {}. Re-send with force=true to \
             delete them with it.",
            scoped.len(),
            scoped
                .iter()
                .map(|v| v.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    None
}

/// No rename, and the global row's reserved name is exempt from the name rule.
fn validate_environment_update(
    stored: &SyntheticsEnvironmentRecord,
    req: &SyntheticsEnvironmentRequest,
) -> Result<(), String> {
    if req.name.trim() != stored.name {
        return Err(
            "name: an environment cannot be renamed — the name is its access-control identity"
                .to_string(),
        );
    }
    if stored.is_global {
        validate_environment_description(&req.description)
    } else {
        validate_environment_request(req)
    }
}

/// The copy a duplicate creates; never global, even when the source is.
fn duplicate_target(
    source: &SyntheticsEnvironmentRecord,
    name: &str,
    created_by: &str,
    now: i64,
) -> SyntheticsEnvironmentRecord {
    SyntheticsEnvironmentRecord {
        id: config::ider::uuid(),
        org_id: source.org_id.clone(),
        name: name.to_string(),
        description: source.description.clone(),
        owner: Some(created_by.to_string()),
        is_global: false,
        created_at: now,
        updated_at: now,
    }
}

/// `var.env = <global id> OR var.env = <the environment being run>` — §4 of the design.
fn applies_to(var: &SyntheticsVariableRecord, env_id: Option<&str>, global_id: &str) -> bool {
    var.env == global_id || env_id == Some(var.env.as_str())
}

/// Globals first, environment rows after, stable order within each half.
fn order_for_merge(
    mut rows: Vec<SyntheticsVariableRecord>,
    global_id: &str,
) -> Vec<SyntheticsVariableRecord> {
    rows.sort_by_key(|v| v.env != global_id);
    rows
}

/// The cap arithmetic's scope key, where `None` stands for the global environment.
fn cap_scope(env: &SyntheticsEnvironmentRecord) -> Option<String> {
    (!env.is_global).then(|| env.id.clone())
}

/// Split targets minus the environments that already define the name (S7).
fn split_targets_without_own_row(
    name: &str,
    targets: Vec<(SyntheticsEnvironmentRecord, String)>,
    shared: &[SyntheticsVariableRecord],
) -> Vec<(SyntheticsEnvironmentRecord, String)> {
    targets
        .into_iter()
        .filter(|(env, _)| !shared.iter().any(|v| v.name == name && v.env == env.id))
        .collect()
}

/// The stored kind, which is what makes `kind` immutable across an update.
fn stored_kind(record: &SyntheticsVariableRecord) -> SyntheticsVariableKind {
    if record.is_secret() {
        SyntheticsVariableKind::Secret
    } else {
        SyntheticsVariableKind::Plain
    }
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
        is_global: record.is_global,
        created_at: record.created_at,
        updated_at: record.updated_at,
        checks_count: 0,
        variables: Vec::new(),
    }
}

/// Loads a variable and asserts it lives in the scope the URL addressed.
async fn scoped_variable<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env: &SyntheticsEnvironmentRecord,
    id: &str,
) -> anyhow::Result<Option<SyntheticsVariableRecord>> {
    let found = synthetics_variables::get(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(found.filter(|v| in_scope(v, env)))
}

/// Whether a variable lives in the environment the URL addressed and was authorized for.
fn in_scope(var: &SyntheticsVariableRecord, env: &SyntheticsEnvironmentRecord) -> bool {
    var.env == env.id
}

/// The addressed environment, or the global one when the URL named none.
async fn scope_or_global(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
) -> anyhow::Result<SyntheticsEnvironmentRecord> {
    match env {
        Some(env) => Ok(env.clone()),
        None => global_environment(org_id).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GLOBAL: &str = "global_acme";

    fn var(env: &str) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            id: "v1".into(),
            org_id: "acme".into(),
            env: env.to_string(),
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
    fn the_global_id_is_the_one_the_table_layer_mints() {
        assert_eq!(
            synthetics_environments::global_environment_id("acme"),
            GLOBAL
        );
    }

    #[test]
    fn a_global_variable_applies_to_every_run() {
        assert!(applies_to(&var(GLOBAL), Some("prod"), GLOBAL));
        assert!(applies_to(&var(GLOBAL), Some(GLOBAL), GLOBAL));
        assert!(applies_to(&var(GLOBAL), None, GLOBAL));
    }

    #[test]
    fn a_scoped_variable_applies_only_to_its_own_environment() {
        assert!(applies_to(&var("prod"), Some("prod"), GLOBAL));
        assert!(!applies_to(&var("prod"), Some("staging"), GLOBAL));
        // A run with no environment resolves the global environment only.
        assert!(!applies_to(&var("prod"), None, GLOBAL));
    }

    /// Design §9.6: the probe folds last-writer-wins, so the merged map is what a job receives.
    #[test]
    fn a_global_variable_resolves_everywhere_and_an_environment_row_wins() {
        let rows = [
            SyntheticsVariableRecord {
                value: "prod-url".into(),
                ..named_var("s1", "URL", "e-prod")
            },
            SyntheticsVariableRecord {
                value: "global-url".into(),
                ..named_var("g1", "URL", GLOBAL)
            },
            named_var("g2", "ORG", GLOBAL),
        ];
        let merged = |env: Option<&str>| -> HashMap<String, String> {
            let applicable = rows
                .iter()
                .filter(|v| applies_to(v, env, GLOBAL))
                .cloned()
                .collect();
            order_for_merge(applicable, GLOBAL)
                .into_iter()
                .map(|v| (v.name, v.value))
                .collect()
        };
        for env in [Some("e-stg"), Some(GLOBAL), None] {
            let got = merged(env);
            assert_eq!(got["URL"], "global-url", "{env:?}");
            assert!(got.contains_key("ORG"), "{env:?}");
        }
        let prod = merged(Some("e-prod"));
        assert_eq!(prod["URL"], "prod-url");
        assert!(prod.contains_key("ORG"));
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

    /// The single link between the stored row and the immutability rule. Inverted, the whole
    /// demotion attack works again and every pure validator test still passes.
    #[test]
    fn a_stored_secret_reads_back_as_a_secret() {
        let secret = SyntheticsVariableRecord {
            kind: synthetics_variables::KIND_SECRET.into(),
            ..var("e-prod")
        };
        assert_eq!(stored_kind(&secret), SyntheticsVariableKind::Secret);
        assert_eq!(stored_kind(&var(GLOBAL)), SyntheticsVariableKind::Plain);
    }

    /// An update carries the check id in the URL and may leave it out of the body; a footprint
    /// built from an empty body id would be counted as a second check instead of replacing the
    /// stored one.
    #[test]
    fn a_footprint_takes_its_id_from_the_caller_not_the_body() {
        let check = Synthetic {
            id: String::new(),
            name: "Login".into(),
            variables: vec![check_var("BASE_URL")],
            environments: vec!["e-prod".into()],
            ..Default::default()
        };
        let footprint = check_footprint("check-from-the-url", &check);
        assert_eq!(footprint.id, "check-from-the-url");
        assert_eq!(footprint.name, "Login");
        assert_eq!(footprint.own_names, ["BASE_URL"]);
        assert_eq!(footprint.environments, ["e-prod"]);
    }

    #[test]
    fn the_promote_refusal_does_not_advise_a_demotion_nobody_can_perform() {
        // Kind is immutable, so the old "make it plain first" pointed at a door now locked.
        let msg = secret_cannot_be_global("API_KEY");
        assert!(msg.contains("API_KEY"), "{msg}");
        // Assert what it must say: a blacklist of one phrase is trivially slipped.
        assert!(msg.contains("access boundary"), "{msg}");
        assert!(msg.contains("Create a plain variable instead"), "{msg}");
        assert!(!msg.to_lowercase().contains("first"), "{msg}");
    }

    #[test]
    fn kinds_map_to_the_strings_the_check_constraint_reads() {
        assert_eq!(kind_str(SyntheticsVariableKind::Secret), "secret");
        assert_eq!(kind_str(SyntheticsVariableKind::Plain), "plain");
    }

    fn named_var(id: &str, name: &str, env: &str) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            id: id.into(),
            name: name.into(),
            value: "x".into(),
            ..var(env)
        }
    }

    fn env_record(id: &str, name: &str) -> SyntheticsEnvironmentRecord {
        SyntheticsEnvironmentRecord {
            id: id.into(),
            org_id: "acme".into(),
            name: name.into(),
            description: String::new(),
            owner: None,
            is_global: id == GLOBAL,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn check_var(name: &str) -> SyntheticVariable {
        SyntheticVariable {
            name: name.into(),
            value: "y".into(),
            secure: true,
            example: String::new(),
        }
    }

    #[test]
    fn a_global_row_resolves_in_every_environment_a_scoped_row_only_in_its_own() {
        let shared = vec![
            named_var("g1", "ORG", GLOBAL),
            named_var("s1", "BASE_URL", "e-stg"),
        ];
        let envs = vec![env_record("e-stg", "staging"), env_record("e-qa", "qa")];

        let staging = resolved_rows(&shared, &envs, &[], Some("e-stg"), GLOBAL);
        let qa = resolved_rows(&shared, &envs, &[], Some("e-qa"), GLOBAL);

        assert_eq!(
            staging.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(),
            ["BASE_URL", "ORG"]
        );
        assert_eq!(
            qa.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(),
            ["ORG"]
        );
    }

    #[test]
    fn scope_is_the_environment_name_global_or_check() {
        let shared = vec![
            named_var("g1", "ORG", GLOBAL),
            named_var("s1", "BASE_URL", "e-stg"),
        ];
        let envs = vec![env_record("e-stg", "staging")];

        let rows = resolved_rows(
            &shared,
            &envs,
            &[check_var("RETRY_LIMIT")],
            Some("e-stg"),
            GLOBAL,
        );
        let scope_of = |name: &str| rows.iter().find(|v| v.name == name).unwrap().scope.clone();

        assert_eq!(scope_of("BASE_URL"), "staging");
        assert_eq!(scope_of("ORG"), "global");
        assert_eq!(scope_of("RETRY_LIMIT"), "check");
    }

    #[test]
    fn overridden_varies_per_environment() {
        // The check shadows staging's row where it applies; in qa the check
        // variable is simply the only definition — nothing to mark.
        let shared = vec![named_var("s1", "CHECKOUT_USER", "e-stg")];
        let envs = vec![env_record("e-stg", "staging"), env_record("e-qa", "qa")];
        let own = [check_var("CHECKOUT_USER")];

        let staging = resolved_rows(&shared, &envs, &own, Some("e-stg"), GLOBAL);
        let qa = resolved_rows(&shared, &envs, &own, Some("e-qa"), GLOBAL);

        let shadowed = staging
            .iter()
            .find(|v| v.scope == "staging")
            .expect("staging row present");
        assert!(shadowed.overridden);
        assert_eq!(qa.len(), 1);
        assert_eq!(qa[0].scope, "check");
        assert!(!qa[0].overridden);
    }

    #[test]
    fn an_environment_row_marks_the_global_it_shadows_only_where_it_applies() {
        // S2 — staging overrides the global; prod still runs on it.
        let shared = vec![
            named_var("g1", "URL", GLOBAL),
            named_var("s1", "URL", "e-stg"),
        ];
        let envs = vec![env_record("e-stg", "staging"), env_record("e-prod", "prod")];

        let staging = resolved_rows(&shared, &envs, &[], Some("e-stg"), GLOBAL);
        let flags: Vec<(&str, bool)> = staging
            .iter()
            .map(|v| (v.scope.as_str(), v.overridden))
            .collect();
        // Loser kept and marked, winner identified by scope — same contract as
        // check-shadowing.
        assert_eq!(flags, [("global", true), ("staging", false)]);

        let prod = resolved_rows(&shared, &envs, &[], Some("e-prod"), GLOBAL);
        assert_eq!(prod.len(), 1);
        assert_eq!(prod[0].scope, "global");
        assert!(!prod[0].overridden);
    }

    #[test]
    fn a_check_variable_marks_both_shared_tiers_in_the_chain() {
        // S3 — check beats env beats global: every non-winner reads overridden.
        let shared = vec![
            named_var("g1", "URL", GLOBAL),
            named_var("s1", "URL", "e-stg"),
        ];
        let envs = vec![env_record("e-stg", "staging")];

        let rows = resolved_rows(&shared, &envs, &[check_var("URL")], Some("e-stg"), GLOBAL);
        let flags: Vec<(&str, bool)> = rows
            .iter()
            .map(|v| (v.scope.as_str(), v.overridden))
            .collect();
        assert_eq!(
            flags,
            [("check", false), ("global", true), ("staging", true)]
        );
    }

    #[test]
    fn an_unscoped_run_never_sees_an_environment_override() {
        // S9 — env rows filter by env; with no env, only the global applies.
        let shared = vec![
            named_var("g1", "URL", GLOBAL),
            named_var("s1", "URL", "e-stg"),
        ];
        let envs = vec![env_record("e-stg", "staging")];

        let rows = resolved_rows(&shared, &envs, &[], None, GLOBAL);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].scope, "global");
        assert!(!rows[0].overridden);
    }

    #[test]
    fn split_skips_environments_that_already_own_the_name() {
        // S7 — staging already overrides URL; its row survives untouched and
        // only prod gets a copy. Inserting into staging would trip the
        // same-scope unique index mid-transaction.
        let shared = vec![
            named_var("g1", "URL", GLOBAL),
            named_var("s1", "URL", "e-stg"),
        ];
        let targets = vec![
            (env_record("e-stg", "staging"), "ignored".to_string()),
            (env_record("e-prod", "prod"), "prod-value".to_string()),
        ];
        let kept = split_targets_without_own_row("URL", targets, &shared);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].0.id, "e-prod");
        assert_eq!(kept[0].1, "prod-value");
    }

    #[test]
    fn merge_order_puts_globals_before_environment_rows() {
        // The runtime map folds last-writer-wins, so this order IS the
        // env-beats-global rule.
        let rows = vec![
            named_var("s1", "URL", "e-stg"),
            named_var("g1", "URL", GLOBAL),
            named_var("g2", "ORG", GLOBAL),
        ];
        let ordered = order_for_merge(rows, GLOBAL);
        let ids: Vec<&str> = ordered.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids, ["g1", "g2", "s1"]);
    }

    #[test]
    fn an_unscoped_run_resolves_globals_and_check_variables_only() {
        let shared = vec![
            named_var("g1", "ORG", GLOBAL),
            named_var("s1", "BASE_URL", "e-stg"),
        ];
        let envs = vec![env_record("e-stg", "staging")];

        let rows = resolved_rows(&shared, &envs, &[check_var("RETRY_LIMIT")], None, GLOBAL);
        assert_eq!(
            rows.iter().map(|v| v.name.as_str()).collect::<Vec<_>>(),
            ["ORG", "RETRY_LIMIT"]
        );
    }

    #[test]
    fn rows_sort_by_name_then_scope_in_every_group() {
        let shared = vec![
            named_var("s1", "B_NAME", "e-stg"),
            named_var("g1", "A_NAME", GLOBAL),
        ];
        let envs = vec![env_record("e-stg", "staging")];

        let rows = resolved_rows(
            &shared,
            &envs,
            &[check_var("A_NAME")],
            Some("e-stg"),
            GLOBAL,
        );
        let keys: Vec<(&str, &str)> = rows
            .iter()
            .map(|v| (v.name.as_str(), v.scope.as_str()))
            .collect();
        assert_eq!(
            keys,
            [
                ("A_NAME", "check"),
                ("A_NAME", "global"),
                ("B_NAME", "staging")
            ]
        );
    }

    #[test]
    fn a_secure_check_variable_is_still_reported_plain() {
        // `secure` is a display hint, not a storage property — reporting it as
        // a secret would overclaim the write-only guarantee.
        let rows = resolved_rows(&[], &[], &[check_var("TOKEN")], None, GLOBAL);
        assert_eq!(rows[0].kind, SyntheticsVariableKind::Plain);
        assert!(rows[0].has_value);
    }

    fn secret(id: &str, name: &str, env: &str) -> SyntheticsVariableRecord {
        SyntheticsVariableRecord {
            kind: synthetics_variables::KIND_SECRET.into(),
            ..named_var(id, name, env)
        }
    }

    /// Design §9.3: checked before the check-count and secret guards, and `force` does not help.
    #[test]
    fn the_global_environment_refuses_deletion_before_every_other_guard() {
        let global = env_record(GLOBAL, "global");
        let held = [
            secret("g1", "TOKEN", GLOBAL),
            named_var("g2", "URL", GLOBAL),
        ];
        for force in [false, true] {
            for (checks, scoped) in [(0, &held[..0]), (3, &held[..]), (0, &held[1..])] {
                let refusal = environment_delete_refusal(&global, checks, scoped, force)
                    .expect("deleting global must be refused");
                assert_eq!(
                    refusal,
                    global_delete_refusal(),
                    "force={force} checks={checks}"
                );
            }
        }
    }

    #[test]
    fn an_ordinary_environment_keeps_its_guards() {
        let prod = env_record("e-prod", "prod");
        assert!(environment_delete_refusal(&prod, 0, &[], false).is_none());
        let used = environment_delete_refusal(&prod, 2, &[], true).unwrap();
        assert!(used.contains("2 check(s)"), "{used}");
        let held = [secret("s1", "TOKEN", "e-prod")];
        let blocked = environment_delete_refusal(&prod, 0, &held, true).unwrap();
        assert!(blocked.contains("secret(s)"), "{blocked}");
        let plain = [named_var("p1", "URL", "e-prod")];
        assert!(environment_delete_refusal(&prod, 0, &plain, false).is_some());
        assert!(environment_delete_refusal(&prod, 0, &plain, true).is_none());
    }

    fn env_request(name: &str, description: &str) -> SyntheticsEnvironmentRequest {
        SyntheticsEnvironmentRequest {
            name: name.into(),
            description: description.into(),
        }
    }

    /// Design §9.2, the rename half: no environment can take the reserved name.
    #[test]
    fn an_environment_cannot_be_renamed_to_global() {
        let staging = env_record("e-stg", "staging");
        for name in ["global", "Global", "GLOBAL"] {
            assert!(validate_environment_update(&staging, &env_request(name, "")).is_err());
        }
    }

    #[test]
    fn the_global_environments_description_can_still_be_edited() {
        let global = env_record(GLOBAL, "global");
        assert!(validate_environment_update(&global, &env_request("global", "defaults")).is_ok());
        assert!(validate_environment_update(&global, &env_request("GLOBAL", "")).is_err());
        let long = "x".repeat(4097);
        assert!(validate_environment_update(&global, &env_request("global", &long)).is_err());
    }

    /// Design §9.4, the duplicate half.
    #[test]
    fn duplicating_global_yields_an_ordinary_environment() {
        let global = env_record(GLOBAL, "global");
        let copy = duplicate_target(&global, "global_copy", "asha@acme.com", 7);
        assert!(!copy.is_global);
        assert_ne!(copy.id, global.id);
        assert_eq!(copy.name, "global_copy");
        assert_eq!(copy.owner.as_deref(), Some("asha@acme.com"));
    }

    /// Design §9.7, the service half: a grant on global reaches global rows and nothing else.
    #[test]
    fn a_global_scoped_write_cannot_reach_a_production_secret() {
        let global = env_record(GLOBAL, "global");
        let prod = env_record("e-prod", "prod");
        let global_url = named_var("g1", "URL", GLOBAL);
        let prod_token = secret("s1", "TOKEN", "e-prod");

        assert!(in_scope(&global_url, &global));
        assert!(!in_scope(&prod_token, &global));
        assert!(in_scope(&prod_token, &prod));
        assert!(!in_scope(&global_url, &prod));
    }

    #[test]
    fn the_cap_reads_the_global_environment_as_the_everywhere_scope() {
        assert_eq!(cap_scope(&env_record(GLOBAL, "global")), None);
        assert_eq!(
            cap_scope(&env_record("e-prod", "prod")),
            Some("e-prod".to_string())
        );
    }

    #[test]
    fn a_global_row_reports_its_scope_as_global() {
        let shared = vec![named_var("g1", "ORG", GLOBAL)];
        let envs = vec![env_record(GLOBAL, "global")];
        let rows = resolved_rows(&shared, &envs, &[], Some("e-prod"), GLOBAL);
        assert_eq!(rows[0].scope, "global");
    }
}
