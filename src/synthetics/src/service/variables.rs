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

    Ok(envs
        .into_iter()
        .map(|env| SyntheticsEnvironmentView {
            checks_count: counts.get(&env.id).copied().unwrap_or(0),
            variables: variables
                .iter()
                .filter(|v| v.env.as_deref() == Some(env.id.as_str()))
                .map(|v| v.to_view())
                .collect(),
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

/// Deletes an environment and every variable scoped to it.
///
/// Refused while a check is still pinned to it: the check would otherwise keep
/// naming an environment that no longer exists, and its next run would resolve
/// a different variable set than the one it was written against.
pub async fn delete_environment(org_id: &str, name: &str) -> anyhow::Result<bool> {
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

/// The unscoped tier — variables that apply in every environment.
pub async fn list_global_variables(org_id: &str) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    let conn = get_orm_client_ro().await;
    Ok(synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .iter()
        .filter(|v| v.env.is_none())
        .map(|v| v.to_view())
        .collect())
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
    Ok(Some(
        synthetics_variables::list(conn, org_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .iter()
            .filter(|v| v.env.as_deref() == Some(env.id.as_str()))
            .map(|v| v.to_view())
            .collect(),
    ))
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

pub async fn delete_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
) -> anyhow::Result<bool> {
    let conn = get_orm_client_rw().await;
    if scoped_variable(conn, org_id, env, id).await?.is_none() {
        return Ok(false);
    }
    synthetics_variables::delete(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
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
    fn kinds_map_to_the_strings_the_check_constraint_reads() {
        assert_eq!(kind_str(SyntheticsVariableKind::Secret), "secret");
        assert_eq!(kind_str(SyntheticsVariableKind::Plain), "plain");
    }
}
