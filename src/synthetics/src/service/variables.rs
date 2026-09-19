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

#[cfg(any(feature = "enterprise", test))]
use std::time::Duration;
use std::{
    collections::{BTreeSet, HashSet},
    future::Future,
};

use infra::db::{get_orm_client_ro, get_orm_client_rw};
use sea_orm::TransactionTrait;

use super::*;

/// Attempts per cross-region publish: the first try plus three retries.
#[cfg(any(feature = "enterprise", test))]
const PUBLISH_ATTEMPTS: u32 = 4;
#[cfg(feature = "enterprise")]
const PUBLISH_BACKOFF: Duration = Duration::from_millis(200);

#[cfg(test)]
thread_local! {
    static DROP_REPORTS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}
#[cfg(feature = "enterprise")]
static PUBLISH_QUEUE: std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<PublishJob>>> =
    std::sync::Mutex::new(None);

/// One shared secret released to a browser for replay.
pub struct ReplaySecret {
    pub name: String,
    /// The environment that governs it, and what the caller checks write permission against.
    pub environment: String,
    pub value: String,
}

#[cfg(any(feature = "enterprise", test))]
type PublishSend =
    Box<dyn FnMut() -> std::pin::Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> + Send>;

/// One cross-region message waiting for the publish worker.
#[cfg(any(feature = "enterprise", test))]
struct PublishJob {
    key: String,
    send: PublishSend,
    state: SendState,
}

#[cfg(any(feature = "enterprise", test))]
impl PublishJob {
    fn new<F, Fut>(key: String, mut send: F) -> Self
    where
        F: FnMut() -> Fut + Send + 'static,
        Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
    {
        Self {
            key,
            send: Box::new(move || Box::pin(send())),
            state: SendState::NotStarted,
        }
    }
}

#[cfg(any(feature = "enterprise", test))]
impl Drop for PublishJob {
    fn drop(&mut self) {
        if let Some(message) = drop_report(&self.key, self.state) {
            #[cfg(test)]
            DROP_REPORTS.with(|reports| reports.borrow_mut().push(message.clone()));
            log::error!("{message}");
        }
    }
}

/// How far a publish job got; anything short of `Done` is logged when the job drops.
#[cfg(any(feature = "enterprise", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SendState {
    NotStarted,
    Sending,
    Done,
}

/// Checks still reference the name; a client confirms and re-sends with `force`.
#[derive(Debug)]
pub struct UsageConflict(pub String);

impl std::fmt::Display for UsageConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for UsageConflict {}

/// What `_resync` actually enqueued, and the environments whose batch could not be built.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ResyncSummary {
    pub environments: usize,
    pub variables: usize,
    pub failed: Vec<String>,
}

/// A resync asked of a node that has no other region to send to.
#[derive(Debug)]
pub struct ResyncUnavailable;

impl std::fmt::Display for ResyncUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("super cluster is not enabled on this node, so there is nothing to resync")
    }
}

impl std::error::Error for ResyncUnavailable {}

/// The org's checks and shared rows, loaded once to answer which checks resolve which row.
struct UsageScan {
    checks: Vec<(Synthetic, BTreeSet<String>)>,
    shared: Vec<SyntheticsVariableRecord>,
    /// `(name, env)` of every shared row, so a shadow test is one lookup.
    defined: HashSet<(String, String)>,
    global_id: String,
}

impl UsageScan {
    fn new(
        checks: Vec<Synthetic>,
        shared: Vec<SyntheticsVariableRecord>,
        global_id: String,
    ) -> Self {
        let checks = checks
            .into_iter()
            .map(|check| {
                let names = placeholder_names(&check_placeholder_text(&check));
                (check, names)
            })
            .collect();
        let defined = shared
            .iter()
            .map(|v| (v.name.clone(), v.env.clone()))
            .collect();
        Self {
            checks,
            shared,
            defined,
            global_id,
        }
    }

    /// Checks that reference the row's name, do not define it, and run where the row applies.
    fn users(&self, row: &SyntheticsVariableRecord) -> Vec<&Synthetic> {
        self.checks
            .iter()
            .filter(|(check, names)| {
                names.contains(&row.name)
                    && !check.variables.iter().any(|v| v.name == row.name)
                    && self.runs_where_applies(check, row)
            })
            .map(|(check, _)| check)
            .collect()
    }

    /// A global row applies wherever no environment of the check shadows it with its own row.
    fn runs_where_applies(&self, check: &Synthetic, row: &SyntheticsVariableRecord) -> bool {
        if row.env != self.global_id {
            return check.environments.contains(&row.env);
        }
        check.environments.is_empty()
            || check
                .environments
                .iter()
                .any(|env| !self.defined.contains(&(row.name.clone(), env.clone())))
    }

    fn user_names(&self, row: &SyntheticsVariableRecord) -> Vec<String> {
        self.users(row)
            .into_iter()
            .map(|c| c.name.clone())
            .collect()
    }
}

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
    let (record, created) = synthetics_environments::get_or_create_global(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Not published: every region mints its own row under the same id.
    if created && ofga_enabled() {
        set_ownership(org_id, &environment_object(&record.name), "", "").await;
    }
    Ok(record)
}

/// Every environment in the org with its variables inline, the global one first.
pub async fn list_environments<F, Fut>(
    org_id: &str,
    readable_checks: F,
) -> anyhow::Result<Vec<SyntheticsEnvironmentView>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
    global_environment(org_id).await?;
    let conn = get_orm_client_rw().await;
    let mut envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    envs.sort_by_key(|env| !env.is_global);
    let counts = synthetics_checks::count_by_environment(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let scan = usage_scan(conn, org_id).await?;
    let rows: Vec<&SyntheticsVariableRecord> = scan.shared.iter().collect();
    let views = usage_views(org_id, &rows, &scan, readable_checks).await?;

    let mut projected: HashMap<&str, Vec<SyntheticsVariableView>> = HashMap::new();
    for (row, view) in rows.iter().zip(views) {
        projected.entry(row.env.as_str()).or_default().push(view);
    }

    Ok(envs
        .into_iter()
        .map(|env| SyntheticsEnvironmentView {
            checks_count: counts.get(&env.id).copied().unwrap_or(0),
            variables: projected.remove(env.id.as_str()).unwrap_or_default(),
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
    let name = req.name.trim().to_string();
    let record = SyntheticsEnvironmentRecord {
        id: synthetics_environments::environment_id(org_id, &name),
        org_id: org_id.to_string(),
        name,
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

    publish_environment_put(&record).await;
    grant_new_environment(org_id, &record.name).await;
    Ok(environment_view(record))
}

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
    publish_batch(org_id, &[&target], &copies, &[]).await;
    grant_new_environment(org_id, &target.name).await;
    Ok(environment_view(target))
}

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
    record.updated_at = next_updated_at(record.updated_at);
    let updated = synthetics_environments::update(
        conn,
        org_id,
        &record.id,
        &record.name,
        &record.description,
        record.updated_at,
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if !updated {
        return Ok(None);
    }
    publish_environment_put(&record).await;
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
        publish_environment_delete(&record).await;
        if ofga_enabled() {
            let object = environment_object(&record.name);
            remove_ownership(org_id, &object, "", "").await;
            // A later environment of the same name must not inherit this one's grants.
            remove_object_grants(org_id, &object).await;
        }
    }
    Ok(deleted)
}

/// The global environment's variables; open to every reader, so they carry no owner.
pub async fn list_global_variables<F, Fut>(
    org_id: &str,
    readable_checks: F,
) -> anyhow::Result<Vec<SyntheticsVariableView>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
    let conn = get_orm_client_ro().await;
    let global_id = synthetics_environments::global_environment_id(org_id);
    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if !shared.iter().any(|v| v.env == global_id) {
        return Ok(Vec::new());
    }
    let scan = UsageScan::new(
        checks_with_secret_slots(conn, org_id).await?,
        shared,
        global_id.clone(),
    );
    let rows: Vec<&SyntheticsVariableRecord> =
        scan.shared.iter().filter(|v| v.env == global_id).collect();
    usage_views(org_id, &rows, &scan, readable_checks).await
}

/// One environment's variables, or `None` when the environment does not exist.
pub async fn list_environment_variables<F, Fut>(
    org_id: &str,
    env_name: &str,
    readable_checks: F,
) -> anyhow::Result<Option<Vec<SyntheticsVariableView>>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
    let conn = get_orm_client_ro().await;
    let Some(env) = synthetics_environments::get_by_name(conn, org_id, env_name)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    else {
        return Ok(None);
    };
    let scan = usage_scan(conn, org_id).await?;
    let rows: Vec<&SyntheticsVariableRecord> =
        scan.shared.iter().filter(|v| v.env == env.id).collect();
    Ok(Some(
        usage_views(org_id, &rows, &scan, readable_checks).await?,
    ))
}

/// Rejects a check that names an environment which does not exist, or the global one.
pub async fn validate_environments(org_id: &str, ids: &[String]) -> anyhow::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = get_orm_client_ro().await;
    let known = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    match check_environments_error(&known, ids) {
        Some(err) => anyhow::bail!(err),
        None => Ok(()),
    }
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
        env: env.id.clone(),
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
    publish_batch(org_id, &[&env], std::slice::from_ref(&record), &[]).await;
    project_view(org_id, &record).await
}

/// A rename honours `force`, the same guard a delete takes.
pub async fn update_variable(
    org_id: &str,
    env: Option<&SyntheticsEnvironmentRecord>,
    id: &str,
    req: SyntheticsVariableRequest,
    force: bool,
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
        let users = usage_scan(conn, org_id).await?.user_names(&record);
        if let Some(refusal) = rename_refusal(&record.name, &name, &users, force) {
            return Err(UsageConflict(refusal).into());
        }
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
    record.updated_at = next_updated_at(record.updated_at);

    // A delete that landed since the read leaves nothing to update, and nothing to publish.
    if !synthetics_variables::update(conn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    {
        return Ok(None);
    }
    publish_batch(org_id, &[&env], std::slice::from_ref(&record), &[]).await;
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
    if !force {
        let users = usage_scan(conn, org_id).await?.user_names(&record);
        if !users.is_empty() {
            return Err(UsageConflict(usage_refusal(&record.name, &users, "delete")).into());
        }
    }
    let deleted = synthetics_variables::delete(conn, org_id, id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if deleted {
        publish_variable_delete(org_id, id).await;
    }
    Ok(deleted)
}

/// A check's resolved set; an environment `readable_envs` withholds contributes no rows.
pub async fn resolved_variables<F, Fut>(
    org_id: &str,
    check_id: &str,
    readable_envs: F,
) -> anyhow::Result<Option<Vec<ResolvedVariableView>>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
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
    let first = check
        .environments
        .first()
        .and_then(|id| envs.iter().find(|e| &e.id == id));
    let readable = match first {
        Some(env) => readable_envs(vec![env.name.clone()]).await,
        None => HashSet::new(),
    };
    let env_id = first
        .filter(|env| readable.contains(&env.name))
        .map(|env| env.id.as_str());
    Ok(Some(resolved_rows(
        &shared,
        &envs,
        &check.variables,
        env_id,
        &synthetics_environments::global_environment_id(org_id),
    )))
}

/// Every readable environment's resolved set, keyed by environment name.
pub async fn resolved_variables_grouped<F, Fut>(
    org_id: &str,
    check_id: &str,
    readable_envs: F,
) -> anyhow::Result<Option<ResolvedVariablesGrouped>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
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
    let named: Vec<&SyntheticsEnvironmentRecord> = check
        .environments
        .iter()
        .filter_map(|id| envs.iter().find(|e| &e.id == id))
        .collect();
    let readable = if named.is_empty() {
        HashSet::new()
    } else {
        readable_envs(named.iter().map(|env| env.name.clone()).collect()).await
    };
    let mut grouped = ResolvedVariablesGrouped::default();
    if check.environments.is_empty() {
        grouped.environments.push(String::new());
        grouped.resolved.insert(
            String::new(),
            resolved_rows(&shared, &envs, &check.variables, None, &global_id),
        );
    }
    for env in named.into_iter().filter(|env| readable.contains(&env.name)) {
        grouped.environments.push(env.name.clone());
        grouped.resolved.insert(
            env.name.clone(),
            resolved_rows(&shared, &envs, &check.variables, Some(&env.id), &global_id),
        );
    }
    Ok(Some(grouped))
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

    let mut referenced = placeholder_names(&check_placeholder_text(&check));
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
    let (record, check) =
        promote_check_variable_in(conn, org_id, check_id, name, env, owner).await?;
    synthetics_variables::invalidate_and_publish(org_id).await;
    synthetics_checks::invalidate_and_publish(org_id, check_id).await;
    publish_batch(org_id, &[env], std::slice::from_ref(&record), &[]).await;
    publish_check_update(org_id, check_id, &check).await;
    project_view(org_id, &record).await
}

/// Moves an environment's variable into global; `None` when the environment holds no such variable.
pub async fn promote_to_global(
    org_id: &str,
    env: &SyntheticsEnvironmentRecord,
    id: &str,
) -> anyhow::Result<Option<SyntheticsVariableView>> {
    if env.is_global {
        anyhow::bail!("the variable is already in the '{GLOBAL_ENVIRONMENT_NAME}' environment");
    }
    let global = global_environment(org_id).await?;
    let conn = get_orm_client_rw().await;
    let Some(mut record) = scoped_variable(conn, org_id, env, id).await? else {
        return Ok(None);
    };

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

    record.updated_at = next_updated_at(record.updated_at);
    if !synthetics_variables::set_env(conn, org_id, id, &global.id, record.updated_at)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
    {
        return Ok(None);
    }
    record.env = global.id.clone();
    publish_batch(org_id, &[&global], std::slice::from_ref(&record), &[]).await;
    Ok(Some(project_view(org_id, &record).await?))
}

pub async fn split_to_environments(
    org_id: &str,
    id: &str,
    targets: Vec<SplitTarget>,
    owner: &str,
) -> anyhow::Result<Vec<SyntheticsVariableView>> {
    if let Some(err) = split_targets_error(&targets) {
        anyhow::bail!(err);
    }
    let global = global_environment(org_id).await?;
    let dek = synthetics_dek(org_id).await?;
    let conn = get_orm_client_rw().await;
    let (envs, created) =
        split_to_environments_in(conn, &global, id, &targets, owner, &dek).await?;
    synthetics_variables::invalidate_and_publish(org_id).await;
    let envs: Vec<&SyntheticsEnvironmentRecord> = envs.iter().collect();
    publish_batch(org_id, &envs, &created, &[id.to_string()]).await;
    project_views(org_id, created.iter()).await
}

/// The global and job-environment rows the check references, decrypted; an unset one fails the job.
pub async fn resolve_shared_variables(
    org_id: &str,
    env_id: Option<&str>,
    check: &Synthetic,
    dek: &[u8],
) -> anyhow::Result<Vec<(String, String)>> {
    let conn = get_orm_client_ro().await;
    resolve_shared_variables_in(conn, org_id, env_id, check, dek).await
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

/// Publishes every environment and variable of the org again; receivers apply a replay as a no-op.
pub async fn resync_environments(org_id: &str) -> anyhow::Result<ResyncSummary> {
    resync_precondition(super_cluster_enabled())?;
    let conn = get_orm_client_ro().await;
    let envs = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let rows = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut summary = ResyncSummary::default();
    for env in &envs {
        let puts: Vec<SyntheticsVariableRecord> =
            rows.iter().filter(|v| v.env == env.id).cloned().collect();
        if env.is_global && puts.is_empty() {
            continue;
        }
        if !publish_batch(org_id, &[env], &puts, &[]).await {
            summary.failed.push(env.name.clone());
            continue;
        }
        summary.environments += usize::from(!env.is_global);
        summary.variables += puts.len();
    }
    Ok(summary)
}

/// Starts the cross-region publish worker on the calling runtime; a no-op without super cluster.
pub fn start_publish_queue() {
    #[cfg(feature = "enterprise")]
    if super_cluster_enabled() {
        let mut slot = PUBLISH_QUEUE
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if slot.as_ref().is_none_or(|tx| tx.is_closed()) {
            *slot = Some(start_publish_worker(PUBLISH_BACKOFF));
        }
    }
}

/// The org's checks and shared rows, as the write-time cap gate reads them.
pub(crate) async fn org_variable_state(org_id: &str) -> anyhow::Result<OrgVariableState> {
    org_variable_state_in(get_orm_client_ro().await, org_id).await
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

async fn org_variable_state_in<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> anyhow::Result<OrgVariableState> {
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

/// The promote on `conn`: the shared row appears and the check's own copy goes in one transaction.
async fn promote_check_variable_in<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    check_id: &str,
    name: &str,
    env: &SyntheticsEnvironmentRecord,
    owner: &str,
) -> anyhow::Result<(SyntheticsVariableRecord, Synthetic)> {
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
    if let Some(refusal) = promote_refusal(&source, &normalized, env, &check.environments) {
        anyhow::bail!(refusal);
    }
    if env.is_global {
        let shared = synthetics_variables::list(conn, org_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let envs = synthetics_environments::list(conn, org_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if let Some(refusal) =
            shadowing_environment_refusal(&normalized, &check.environments, &shared, &envs)
        {
            anyhow::bail!(refusal);
        }
    }

    // The source check already resolved this name; every other check gains it.
    let before = org_variable_state_in(conn, org_id).await?;
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
        kind: promoted_kind(&source).to_string(),
        description: String::new(),
        example: source.example.clone(),
        tags: Vec::new(),
        owner: Some(owner.to_string()),
        created_at: now,
        updated_at: now,
    };
    check.variables.remove(position);
    let txn = conn.begin().await?;
    synthetics_variables::insert_row(&txn, &record)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let check = synthetics_checks::update_row(&txn, org_id, check_id, &check)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    txn.commit().await?;
    Ok((record, check))
}

/// The split on `conn`: refused while a check would lose the name, else one transaction.
async fn split_to_environments_in<C: sea_orm::ConnectionTrait + TransactionTrait>(
    conn: &C,
    global: &SyntheticsEnvironmentRecord,
    id: &str,
    targets: &[SplitTarget],
    owner: &str,
    dek: &[u8],
) -> anyhow::Result<(
    Vec<SyntheticsEnvironmentRecord>,
    Vec<SyntheticsVariableRecord>,
)> {
    let org_id = global.org_id.as_str();
    let source = scoped_variable(conn, org_id, global, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("global variable not found: {id}"))?;

    let known = synthetics_environments::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut resolved = Vec::with_capacity(targets.len());
    for target in targets {
        let env = known
            .iter()
            .find(|e| e.name == target.environment)
            .ok_or_else(|| anyhow::anyhow!("no environment named '{}'", target.environment))?;
        resolved.push((env.clone(), target.value.clone()));
    }

    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let checks = checks_with_secret_slots(conn, org_id).await?;
    let covered: HashSet<&str> = resolved
        .iter()
        .map(|(env, _)| env.id.as_str())
        .chain(
            shared
                .iter()
                .filter(|v| v.name == source.name && v.env != global.id)
                .map(|v| v.env.as_str()),
        )
        .collect();
    let losers = split_losers(&source.name, &checks, &covered);
    if !losers.is_empty() {
        anyhow::bail!(
            "'{}' is used by {} check(s) that would lose it: {}. Give each environment they run \
             in a value, or set the variable on the check, before splitting.",
            source.name,
            losers.len(),
            losers.join(", ")
        );
    }

    let resolved = split_targets_without_own_row(&source.name, resolved, &shared);
    if resolved.is_empty() {
        anyhow::bail!(
            "every selected environment already has its own '{}' — deleting the global is a \
             delete, not a split",
            source.name
        );
    }

    let now = config::utils::time::now_micros();
    let mut created = Vec::with_capacity(resolved.len());
    for (env, value) in &resolved {
        created.push(SyntheticsVariableRecord {
            id: config::ider::uuid(),
            org_id: org_id.to_string(),
            env: env.id.clone(),
            name: source.name.clone(),
            value: store_value(dek, value)?,
            kind: source.kind.clone(),
            description: source.description.clone(),
            example: source.example.clone(),
            tags: source.tags.clone(),
            owner: Some(owner.to_string()),
            created_at: now,
            updated_at: now,
        });
    }

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
    Ok((resolved.into_iter().map(|(env, _)| env).collect(), created))
}

async fn resolve_shared_variables_in<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env_id: Option<&str>,
    check: &Synthetic,
    dek: &[u8],
) -> anyhow::Result<Vec<(String, String)>> {
    let rows = synthetics_variables::list_cached(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let global_id = synthetics_environments::global_environment_id(org_id);
    let referenced = placeholder_names(&check_placeholder_text(check));
    // Only what the check names reaches the probe, which also redacts every value it is sent.
    let applicable = order_for_merge(
        rows.into_iter()
            .filter(|v| referenced.contains(&v.name) && applies_to(v, env_id, &global_id))
            .collect(),
        &global_id,
    );
    if let Some(unset) = first_unset_secret(&applicable, &check.variables, &referenced) {
        let env = synthetics_environments::get_by_id(conn, org_id, &unset.env)
            .await
            .ok()
            .flatten()
            .map_or_else(|| unset.env.clone(), |e| e.name);
        anyhow::bail!("secret {} in environment {env} is not set", unset.name);
    }
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

/// The org's checks and shared rows, ready to say which checks resolve a row.
async fn usage_scan<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> anyhow::Result<UsageScan> {
    let shared = synthetics_variables::list(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(UsageScan::new(
        checks_with_secret_slots(conn, org_id).await?,
        shared,
        synthetics_environments::global_environment_id(org_id),
    ))
}

/// Projects `rows` with their usage; `used_by` names only checks `readable_checks` returns.
async fn usage_views<F, Fut>(
    org_id: &str,
    rows: &[&SyntheticsVariableRecord],
    scan: &UsageScan,
    readable_checks: F,
) -> anyhow::Result<Vec<SyntheticsVariableView>>
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
    let users: Vec<Vec<&Synthetic>> = rows.iter().map(|row| scan.users(row)).collect();
    let ids: BTreeSet<String> = users.iter().flatten().map(|c| c.id.clone()).collect();
    let readable = if ids.is_empty() {
        HashSet::new()
    } else {
        readable_checks(ids.into_iter().collect()).await
    };
    let views = project_views(org_id, rows.iter().copied()).await?;
    Ok(views
        .into_iter()
        .zip(rows.iter().zip(users))
        .map(|(view, (row, users))| stamp_usage(view, row, &users, &readable, &scan.global_id))
        .collect())
}

/// The org's checks with secret config slots restored, so a `{{NAME}}` in a header counts.
async fn checks_with_secret_slots<C: sea_orm::ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> anyhow::Result<Vec<Synthetic>> {
    let mut checks = synthetics_checks::list(conn, org_id, &ListSyntheticsParams::default())
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if checks.iter_mut().any(has_encrypted_config) {
        let dek = synthetics_dek(org_id).await?;
        rehydrate_all(&mut checks, &dek);
    }
    Ok(checks)
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

async fn project_view(
    org_id: &str,
    record: &SyntheticsVariableRecord,
) -> anyhow::Result<SyntheticsVariableView> {
    Ok(project_views(org_id, std::iter::once(record))
        .await?
        .pop()
        .unwrap_or_default())
}

/// The wire copy of one row, with its value decrypted for the receiving region.
#[cfg(feature = "enterprise")]
async fn variable_payload(
    record: &SyntheticsVariableRecord,
) -> anyhow::Result<o2_enterprise::enterprise::super_cluster::queue::SyntheticsVariablePayload> {
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

async fn publish_variable_delete(org_id: &str, id: &str) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        let msg = SyntheticsVariablesMessage::VariableDelete {
            org_id: org_id.to_string(),
            id: id.to_string(),
        };
        let key = format!("{org_id}/variable/{id}");
        enqueue_publish(key, move || queue::synthetics_variables(msg.clone()));
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, id);
}

async fn publish_environment_put(record: &SyntheticsEnvironmentRecord) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        let msg = SyntheticsVariablesMessage::EnvironmentPut {
            org_id: record.org_id.clone(),
            payload: environment_payload(record),
        };
        let key = format!("{}/environment/{}", record.org_id, record.id);
        enqueue_publish(key, move || queue::synthetics_variables(msg.clone()));
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = record;
}

/// Carries `created_at`, so a late copy never deletes a namesake created after it.
async fn publish_environment_delete(record: &SyntheticsEnvironmentRecord) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsVariablesMessage};
        let msg = SyntheticsVariablesMessage::EnvironmentDelete {
            org_id: record.org_id.clone(),
            id: record.id.clone(),
            created_at: record.created_at,
        };
        let key = format!("{}/environment/{}", record.org_id, record.id);
        enqueue_publish(key, move || queue::synthetics_variables(msg.clone()));
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = record;
}

/// Broadcasts the check a promote just edited; a failure is logged, since the local write stands.
async fn publish_check_update(org_id: &str, check_id: &str, check: &Synthetic) {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{self, SyntheticsCheckPayload};
        let key = format!("{org_id}/check/{check_id}");
        let slug = match folders::get_name_by_pk(&check.folder_id).await {
            Ok(slug) => slug.unwrap_or_default(),
            Err(e) => {
                log::error!("[synthetics] publish {key} not sent; folder lookup failed: {e}");
                return;
            }
        };
        let payload = match SyntheticsCheckPayload::for_wire(org_id, check, &slug).await {
            Ok(payload) => payload,
            Err(e) => {
                log::error!("[synthetics] publish {key} not sent; payload failed: {e}");
                return;
            }
        };
        let (org, id) = (org_id.to_string(), check_id.to_string());
        enqueue_publish(key, move || {
            let (org, id, payload) = (org.clone(), id.clone(), payload.clone());
            async move { queue::synthetics_check_update(&org, &id, payload).await }
        });
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, check_id, check);
}

/// One batch per write, with its parent environments; `true` once enqueued, a failure is logged.
async fn publish_batch(
    org_id: &str,
    environments: &[&SyntheticsEnvironmentRecord],
    puts: &[SyntheticsVariableRecord],
    deletes: &[String],
) -> bool {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        use o2_enterprise::enterprise::super_cluster::queue::{
            self, SyntheticsVariablesMessage, SyntheticsVariablesOp,
        };
        let ids: Vec<&str> = puts
            .iter()
            .map(|r| r.id.as_str())
            .chain(deletes.iter().map(String::as_str))
            .collect();
        let key = format!("{org_id}/variables/{}", ids.join(","));
        let parents = batch_environments(environments);
        let mut ops = Vec::with_capacity(parents.len() + puts.len() + deletes.len());
        for record in parents {
            ops.push(SyntheticsVariablesOp::EnvironmentPut(environment_payload(
                record,
            )));
        }
        for record in puts {
            match variable_payload(record).await {
                Ok(payload) => ops.push(SyntheticsVariablesOp::VariablePut(payload)),
                Err(e) => {
                    log::error!(
                        "[synthetics] publish {key} not sent; other regions will not see this \
                         change: {e}"
                    );
                    return false;
                }
            }
        }
        for id in deletes {
            ops.push(SyntheticsVariablesOp::VariableDelete(id.clone()));
        }
        let msg = SyntheticsVariablesMessage::Batch {
            org_id: org_id.to_string(),
            ops,
        };
        enqueue_publish(key, move || queue::synthetics_variables(msg.clone()));
        return true;
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, environments, puts, deletes);
    false
}

/// Sends with backoff and logs the key once every attempt failed; `true` when one got through.
#[cfg(any(feature = "enterprise", test))]
async fn publish_with_retry<F, Fut>(key: &str, backoff: Duration, mut send: F) -> bool
where
    F: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    let mut delay = backoff;
    for attempt in 1..=PUBLISH_ATTEMPTS {
        match send().await {
            Ok(()) => return true,
            Err(e) if attempt < PUBLISH_ATTEMPTS => {
                log::warn!("[synthetics] publish {key} failed (attempt {attempt}): {e}");
                tokio::time::sleep(delay).await;
                delay *= 2;
            }
            Err(e) => log::error!(
                "[synthetics] publish {key} failed after {PUBLISH_ATTEMPTS} attempts; other \
                 regions will not see this change: {e}"
            ),
        }
    }
    false
}

/// Off the request path, in submission order, so a dependent message never overtakes its parent.
#[cfg(feature = "enterprise")]
fn enqueue_publish<F, Fut>(key: String, send: F)
where
    F: FnMut() -> Fut + Send + 'static,
    Fut: Future<Output = anyhow::Result<()>> + Send + 'static,
{
    send_or_restart(&PUBLISH_QUEUE, PUBLISH_BACKOFF, PublishJob::new(key, send));
}

/// Queues a job, starting a fresh worker when none is running or the old one has stopped.
#[cfg(any(feature = "enterprise", test))]
fn send_or_restart(
    slot: &std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<PublishJob>>>,
    backoff: Duration,
    job: PublishJob,
) {
    // Held across the send so two callers cannot each start a worker and split the order.
    let mut slot = slot
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let job = match slot.as_ref() {
        Some(tx) => match tx.send(job) {
            Ok(()) => return,
            Err(closed) => {
                log::warn!("[synthetics] publish worker stopped; starting a new one");
                closed.0
            }
        },
        None => job,
    };
    let tx = start_publish_worker(backoff);
    // A job the fresh queue refuses logs its own key as it drops.
    let _ = tx.send(job);
    *slot = Some(tx);
}

/// One worker drains the queue, retrying each job before it starts the next.
#[cfg(any(feature = "enterprise", test))]
fn start_publish_worker(backoff: Duration) -> tokio::sync::mpsc::UnboundedSender<PublishJob> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<PublishJob>();
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            // Awaited in turn, so order holds; a panic drops the job, whose Drop logs it once.
            let run = tokio::spawn(async move {
                let mut job = job;
                job.state = SendState::Sending;
                publish_with_retry(&job.key, backoff, &mut job.send).await;
                job.state = SendState::Done;
            });
            let _ = run.await;
        }
    });
    tx
}

/// What `Drop` logs for a job in `state`, or `None` when it finished.
#[cfg(any(feature = "enterprise", test))]
fn drop_report(key: &str, state: SendState) -> Option<String> {
    match state {
        SendState::NotStarted => Some(format!(
            "[synthetics] publish {key} dropped before it was sent; other regions will not see it"
        )),
        SendState::Sending => Some(format!(
            "[synthetics] publish {key} interrupted mid-send; other regions may not see it"
        )),
        SendState::Done => None,
    }
}

/// The parent rows a batch carries: named environments only, each once.
#[cfg(any(feature = "enterprise", test))]
fn batch_environments<'a>(
    environments: &[&'a SyntheticsEnvironmentRecord],
) -> Vec<&'a SyntheticsEnvironmentRecord> {
    let mut seen = HashSet::new();
    environments
        .iter()
        .copied()
        // Every region mints its own global row, so shipping one would only race its description.
        .filter(|env| !env.is_global && seen.insert(env.id.as_str()))
        .collect()
}

/// Restores every check's secret slots; one that will not decrypt is scanned as stored.
fn rehydrate_all(checks: &mut [Synthetic], dek: &[u8]) {
    for check in checks {
        if !has_encrypted_config(check) {
            continue;
        }
        let mut restored = check.clone();
        match rehydrate_config_secrets(&mut restored, dek) {
            Ok(()) => *check = restored,
            Err(_) => log::warn!(
                "[synthetics] check {} secret slots unreadable for the usage scan",
                check.id
            ),
        }
    }
}

/// The text a check's placeholders are read from, the same fields the probe substitutes.
pub(crate) fn check_placeholder_text(check: &Synthetic) -> String {
    format!("{} {}", check.target, check.config)
}

/// Counts every check using the row, names only readable ones, and hides a global row's owner.
fn stamp_usage(
    mut view: SyntheticsVariableView,
    row: &SyntheticsVariableRecord,
    users: &[&Synthetic],
    readable: &HashSet<String>,
    global_id: &str,
) -> SyntheticsVariableView {
    view.used_by_checks = users.len() as u64;
    view.used_by = users
        .iter()
        .filter(|c| readable.contains(&c.id))
        .map(|c| c.name.clone())
        .collect();
    if row.env == global_id {
        view.owner = None;
    }
    view
}

/// One environment's resolved rows, from already-loaded data.
fn resolved_rows(
    shared: &[SyntheticsVariableRecord],
    envs: &[SyntheticsEnvironmentRecord],
    check_vars: &[SyntheticVariable],
    env_id: Option<&str>,
    global_id: &str,
) -> Vec<ResolvedVariableView> {
    let own: HashSet<&str> = check_vars.iter().map(|v| v.name.as_str()).collect();
    // Each name an applicable environment row defines shadows its global fallback.
    let env_overrides: HashSet<&str> = shared
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
            kind: stored_kind(v),
            example: v.example.clone(),
            description: v.description.clone(),
            has_value: !v.value.is_empty(),
        })
        .collect();

    out.extend(check_vars.iter().map(|v| ResolvedVariableView {
        name: v.name.clone(),
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

/// The guard shared by delete and rename: checks still reference the name.
fn usage_refusal(name: &str, users: &[String], action: &str) -> String {
    format!(
        "'{name}' is referenced by {} check(s): {}. Re-send with force=true to {action} it anyway.",
        users.len(),
        users.join(", ")
    )
}

/// A rename breaks every `{{OLD}}` still in a check, so it takes the delete guard.
fn rename_refusal(old: &str, new: &str, users: &[String], force: bool) -> Option<String> {
    if old == new || force || users.is_empty() {
        return None;
    }
    Some(usage_refusal(old, users, "rename"))
}

/// Why a check variable cannot move to `env`, if it cannot.
fn promote_refusal(
    source: &SyntheticVariable,
    normalized: &str,
    env: &SyntheticsEnvironmentRecord,
    check_environments: &[String],
) -> Option<String> {
    if source.name != normalized {
        return Some(format!(
            "shared names are upper case, so '{}' would stop resolving; rename it to {normalized} \
             in the check first",
            source.name
        ));
    }
    if source.secure && env.is_global {
        return Some("secret values cannot go to global; promote to an environment".to_string());
    }
    if !env.is_global && !check_environments.contains(&env.id) {
        return Some(format!(
            "the check does not run in environment '{}'; promote to one it runs in, or to global",
            env.name
        ));
    }
    None
}

/// Promoting to global drops the check's value, so a same-name row where it runs would win.
fn shadowing_environment_refusal(
    name: &str,
    check_environments: &[String],
    shared: &[SyntheticsVariableRecord],
    envs: &[SyntheticsEnvironmentRecord],
) -> Option<String> {
    let id = check_environments
        .iter()
        .find(|id| shared.iter().any(|v| v.name == name && &v.env == *id))?;
    let env = envs
        .iter()
        .find(|e| &e.id == id)
        .map_or(id.as_str(), |e| e.name.as_str());
    Some(format!(
        "environment '{env}' defines its own '{name}', which would replace this check's value \
         there once it moves to global; promote it to '{env}' or rename one of them first"
    ))
}

/// A `secure` check variable stays write-only once shared.
fn promoted_kind(source: &SyntheticVariable) -> &'static str {
    if source.secure {
        synthetics_variables::KIND_SECRET
    } else {
        synthetics_variables::KIND_PLAIN
    }
}

/// An empty target would replace the only copy of the value with nothing.
fn split_targets_error(targets: &[SplitTarget]) -> Option<String> {
    if targets.is_empty() {
        return Some("targets: at least one environment is required".to_string());
    }
    targets
        .iter()
        .find(|t| t.value.is_empty())
        .map(|t| format!("targets: environment '{}' needs a value", t.environment))
}

/// Checks that use `{{NAME}}` and would resolve nothing once the global row is gone.
fn split_losers(name: &str, checks: &[Synthetic], covered: &HashSet<&str>) -> Vec<String> {
    checks
        .iter()
        .filter(|check| !check.variables.iter().any(|v| v.name == name))
        .filter(|check| placeholder_names(&check_placeholder_text(check)).contains(name))
        .filter(|check| {
            check.environments.is_empty()
                || check
                    .environments
                    .iter()
                    .any(|env| !covered.contains(env.as_str()))
        })
        .map(|check| check.name.clone())
        .collect()
}

/// The first applicable secret with no value that the check references and does not define.
fn first_unset_secret<'a>(
    applicable: &'a [SyntheticsVariableRecord],
    check_variables: &[SyntheticVariable],
    referenced: &std::collections::BTreeSet<String>,
) -> Option<&'a SyntheticsVariableRecord> {
    applicable.iter().find(|v| {
        v.is_secret()
            && v.value.is_empty()
            && referenced.contains(&v.name)
            && !check_variables.iter().any(|own| own.name == v.name)
    })
}

/// Why a check's environment list is refused, if it is.
fn check_environments_error(
    known: &[SyntheticsEnvironmentRecord],
    ids: &[String],
) -> Option<String> {
    for id in ids {
        match known.iter().find(|e| &e.id == id) {
            None => {
                return Some(format!(
                    "environments: no environment with id '{id}' in this org"
                ));
            }
            Some(env) if env.is_global => {
                return Some(format!(
                    "environments: '{GLOBAL_ENVIRONMENT_NAME}' already applies to every run and \
                     cannot be selected"
                ));
            }
            Some(_) => {}
        }
    }
    None
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
        id: synthetics_environments::environment_id(&source.org_id, name),
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

/// A resync needs another region to send to.
fn resync_precondition(super_cluster_enabled: bool) -> Result<(), ResyncUnavailable> {
    if super_cluster_enabled {
        Ok(())
    } else {
        Err(ResyncUnavailable)
    }
}

/// The one flag read here that guards no publish; `start_publish_queue` and `_resync` share it.
fn super_cluster_enabled() -> bool {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
    }
    #[cfg(not(feature = "enterprise"))]
    {
        false
    }
}

/// Never behind the stored stamp, so a region with a slow clock still wins with its own later edit.
fn next_updated_at(stored: i64) -> i64 {
    config::utils::time::now_micros().max(stored + 1)
}

/// A new environment starts from no grants, even ones left behind by a deleted namesake.
async fn grant_new_environment(org_id: &str, name: &str) {
    if ofga_enabled() {
        let object = environment_object(name);
        remove_object_grants(org_id, &object).await;
        set_ownership(org_id, &object, "", "").await;
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
    fn usage_is_counted_in_full_but_names_only_readable_checks() {
        let row = named_var("g1", "BASE_URL", GLOBAL);
        let login = Synthetic {
            id: "c-login".into(),
            ..synthetic("Login", "{{BASE_URL}}/login", &[], &[])
        };
        let checkout = Synthetic {
            id: "c-checkout".into(),
            ..synthetic("Checkout", "{{BASE_URL}}/pay", &[], &[])
        };
        let users = [&login, &checkout];
        let readable = HashSet::from(["c-login".to_string()]);
        let view = SyntheticsVariableView {
            owner: Some("asha@acme.com".into()),
            ..Default::default()
        };

        let stamped = stamp_usage(view.clone(), &row, &users, &readable, GLOBAL);
        assert_eq!(stamped.used_by_checks, 2);
        assert_eq!(stamped.used_by, ["Login"]);
        assert_eq!(
            stamped.owner, None,
            "the open global list never shows an owner"
        );

        let scoped = named_var("s1", "BASE_URL", "e-stg");
        assert_eq!(
            stamp_usage(view, &scoped, &users, &readable, GLOBAL)
                .owner
                .as_deref(),
            Some("asha@acme.com")
        );
    }

    #[test]
    fn usage_matching_is_case_sensitive() {
        let scan = UsageScan::new(
            vec![synthetic("Checkout", "{{base_url}}", &[], &[])],
            vec![named_var("g1", "BASE_URL", GLOBAL)],
            GLOBAL.to_string(),
        );
        assert!(scan.users(&scan.shared[0]).is_empty());
    }

    #[test]
    fn a_row_counts_only_the_checks_that_resolve_it() {
        let stg_url = named_var("s1", "URL", "e-stg");
        let global_url = named_var("g1", "URL", GLOBAL);
        let scan = UsageScan::new(
            vec![
                synthetic("Prod only", "{{URL}}", &["e-prod"], &[]),
                synthetic("Staging", "{{URL}}", &["e-stg"], &[]),
                synthetic("Both", "{{URL}}", &["e-stg", "e-prod"], &[]),
                synthetic("Own value", "{{URL}}", &["e-stg"], &["URL"]),
                synthetic("Unscoped", "{{URL}}", &[], &[]),
            ],
            vec![stg_url.clone(), global_url.clone()],
            GLOBAL.to_string(),
        );
        assert_eq!(scan.user_names(&stg_url), ["Staging", "Both"]);
        assert_eq!(
            scan.user_names(&global_url),
            ["Prod only", "Both", "Unscoped"]
        );
    }

    #[test]
    fn a_stored_secret_reads_back_as_a_secret() {
        let secret = SyntheticsVariableRecord {
            kind: synthetics_variables::KIND_SECRET.into(),
            ..var("e-prod")
        };
        assert_eq!(stored_kind(&secret), SyntheticsVariableKind::Secret);
        assert_eq!(stored_kind(&var(GLOBAL)), SyntheticsVariableKind::Plain);
    }

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
        let msg = secret_cannot_be_global("API_KEY");
        assert!(msg.contains("API_KEY"), "{msg}");
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

    fn synthetic(name: &str, target: &str, envs: &[&str], own: &[&str]) -> Synthetic {
        Synthetic {
            name: name.into(),
            target: target.into(),
            environments: envs.iter().map(|e| e.to_string()).collect(),
            variables: own.iter().map(|n| check_var(n)).collect(),
            ..Default::default()
        }
    }

    fn plain_check_var(name: &str) -> SyntheticVariable {
        SyntheticVariable {
            secure: false,
            ..check_var(name)
        }
    }

    #[test]
    fn a_secure_check_variable_cannot_be_promoted_to_global() {
        let global = env_record(GLOBAL, "global");
        let err = promote_refusal(&check_var("TOKEN"), "TOKEN", &global, &[]).unwrap();
        assert!(err.contains("promote to an environment"), "{err}");
        assert!(promote_refusal(&plain_check_var("URL"), "URL", &global, &[]).is_none());
    }

    #[test]
    fn a_secure_check_variable_is_promoted_as_a_secret() {
        let prod = env_record("e-prod", "prod");
        assert!(promote_refusal(&check_var("TOKEN"), "TOKEN", &prod, &["e-prod".into()]).is_none());
        assert_eq!(
            promoted_kind(&check_var("TOKEN")),
            synthetics_variables::KIND_SECRET
        );
        assert_eq!(
            promoted_kind(&plain_check_var("URL")),
            synthetics_variables::KIND_PLAIN
        );
    }

    #[test]
    fn a_promote_that_would_rename_the_variable_is_refused() {
        let global = env_record(GLOBAL, "global");
        let err = promote_refusal(&plain_check_var("base_url"), "BASE_URL", &global, &[]).unwrap();
        assert!(
            err.contains("rename it to BASE_URL in the check first"),
            "{err}"
        );
    }

    #[test]
    fn a_promote_into_an_environment_the_check_does_not_run_in_is_refused() {
        let prod = env_record("e-prod", "prod");
        let var = plain_check_var("URL");
        let err = promote_refusal(&var, "URL", &prod, &["e-stg".into()]).unwrap();
        assert!(err.contains("'prod'"), "{err}");
        assert!(promote_refusal(&var, "URL", &prod, &["e-prod".into()]).is_none());
        let global = env_record(GLOBAL, "global");
        assert!(promote_refusal(&var, "URL", &global, &["e-stg".into()]).is_none());
    }

    #[test]
    fn a_split_target_without_a_value_is_refused() {
        let target = |env: &str, value: &str| SplitTarget {
            environment: env.into(),
            value: value.into(),
        };
        assert!(split_targets_error(&[]).is_some());
        let err = split_targets_error(&[target("prod", "x"), target("stg", "")]).unwrap();
        assert!(err.contains("'stg'"), "{err}");
        assert!(split_targets_error(&[target("prod", "x")]).is_none());
    }

    #[test]
    fn a_split_is_refused_while_a_check_would_lose_the_name() {
        let checks = [
            synthetic("Unscoped", "{{URL}}/login", &[], &[]),
            synthetic("Prod only", "{{URL}}/a", &["e-prod"], &[]),
            synthetic("Prod and qa", "{{URL}}/b", &["e-prod", "e-qa"], &[]),
            synthetic("Own value", "{{URL}}/c", &[], &["URL"]),
            synthetic("Unrelated", "https://x.test", &[], &[]),
        ];
        let covered = HashSet::from(["e-prod"]);
        assert_eq!(
            split_losers("URL", &checks, &covered),
            ["Unscoped", "Prod and qa"]
        );
        let covered = HashSet::from(["e-prod", "e-qa"]);
        assert_eq!(split_losers("URL", &checks, &covered), ["Unscoped"]);
    }

    #[test]
    fn an_unset_secret_is_found_unless_the_check_defines_the_name() {
        let rows = [
            named_var("g1", "URL", GLOBAL),
            SyntheticsVariableRecord {
                value: String::new(),
                ..secret("s1", "PASSWORD", "e-stg")
            },
        ];
        let referenced = placeholder_names("{{PASSWORD}} {{URL}}");
        assert_eq!(
            first_unset_secret(&rows, &[], &referenced).map(|v| v.name.as_str()),
            Some("PASSWORD")
        );
        assert!(first_unset_secret(&rows, &[check_var("PASSWORD")], &referenced).is_none());
        assert!(first_unset_secret(&rows[..1], &[], &referenced).is_none());
    }

    #[test]
    fn an_unset_secret_the_check_never_references_does_not_fail_the_job() {
        let rows = [SyntheticsVariableRecord {
            value: String::new(),
            ..secret("s1", "SMTP_TOKEN", "e-stg")
        }];
        let referenced = placeholder_names("{{DB_PASSWORD}}");
        assert!(first_unset_secret(&rows, &[], &referenced).is_none());
    }

    #[test]
    fn a_rename_takes_the_same_guard_as_a_delete() {
        let users = ["Login".to_string()];
        let err = rename_refusal("URL", "BASE_URL", &users, false).unwrap();
        assert!(err.contains("Login") && err.contains("force=true"), "{err}");
        assert!(rename_refusal("URL", "BASE_URL", &users, true).is_none());
        assert!(rename_refusal("URL", "URL", &users, false).is_none());
        assert!(rename_refusal("OTHER", "NEW", &[], false).is_none());
    }

    #[test]
    fn promoting_to_global_is_refused_where_an_environment_defines_the_name() {
        let shared = [
            named_var("s1", "URL", "e-stg"),
            named_var("g1", "URL", GLOBAL),
        ];
        let envs = [env_record("e-stg", "staging"), env_record("e-prod", "prod")];
        let err = shadowing_environment_refusal(
            "URL",
            &["e-prod".into(), "e-stg".into()],
            &shared,
            &envs,
        )
        .unwrap();
        assert!(err.contains("'staging'"), "{err}");
        assert!(shadowing_environment_refusal("URL", &["e-prod".into()], &shared, &envs).is_none());
        assert!(shadowing_environment_refusal("URL", &[], &shared, &envs).is_none());
    }

    #[test]
    fn a_local_write_stamps_past_the_stored_time_even_from_a_slow_clock() {
        let ahead = config::utils::time::now_micros() + 60_000_000;
        assert_eq!(next_updated_at(ahead), ahead + 1);
        assert!(next_updated_at(0) > 1);
    }

    #[test]
    fn a_check_cannot_select_the_global_environment() {
        let known = [env_record(GLOBAL, "global"), env_record("e-prod", "prod")];
        assert!(check_environments_error(&known, &["e-prod".into()]).is_none());
        let err = check_environments_error(&known, &[GLOBAL.into()]).unwrap();
        assert!(err.contains("global"), "{err}");
        assert!(check_environments_error(&known, &["nope".into()]).is_some());
    }

    #[test]
    fn the_lazy_global_create_is_not_published() {
        let source = include_str!("variables.rs");
        let start = source.find("pub async fn global_environment").unwrap();
        let end = start + source[start..].find("\n}\n").unwrap();
        let body = &source[start..end];
        assert!(!body.contains("publish_"), "{body}");
    }

    #[test]
    fn a_batch_carries_named_parents_once_and_never_global() {
        let global = env_record(GLOBAL, "global");
        let prod = env_record("e-prod", "prod");
        let parents = batch_environments(&[&global, &prod, &prod]);
        assert_eq!(parents.len(), 1);
        assert_eq!(parents[0].id, "e-prod");
    }

    #[tokio::test]
    async fn a_failed_publish_is_retried_then_given_up() {
        let calls = std::cell::Cell::new(0);
        let sent = publish_with_retry("acme/variable/v1", Duration::ZERO, || {
            calls.set(calls.get() + 1);
            let ok = calls.get() == 3;
            async move {
                if ok {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("nats down"))
                }
            }
        })
        .await;
        assert!(sent);
        assert_eq!(calls.get(), 3);

        calls.set(0);
        let sent = publish_with_retry("acme/variable/v1", Duration::ZERO, || {
            calls.set(calls.get() + 1);
            async { Err(anyhow::anyhow!("nats down")) }
        })
        .await;
        assert!(!sent);
        assert_eq!(calls.get(), PUBLISH_ATTEMPTS);
    }

    #[tokio::test]
    async fn queued_publishes_go_out_in_order_even_when_the_first_is_retried() {
        let sent = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let queue = start_publish_worker(Duration::ZERO);

        let (log, mut failures) = (sent.clone(), 0);
        let batch = PublishJob::new("acme/variables/v1".to_string(), move || {
            failures += 1;
            let ok = failures > 2;
            if ok {
                log.lock().unwrap().push("batch");
            }
            async move {
                if ok {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("nats down"))
                }
            }
        });
        let log = sent.clone();
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let mut done_tx = Some(done_tx);
        let check = PublishJob::new("acme/check/c1".to_string(), move || {
            log.lock().unwrap().push("check");
            if let Some(tx) = done_tx.take() {
                let _ = tx.send(());
            }
            async { Ok(()) }
        });

        queue.send(batch).ok().unwrap();
        queue.send(check).ok().unwrap();
        done_rx.await.unwrap();

        assert_eq!(*sent.lock().unwrap(), ["batch", "check"]);
    }

    #[tokio::test]
    async fn a_stopped_publish_worker_is_replaced_instead_of_dropping_the_message() {
        let (dead, rx) = tokio::sync::mpsc::unbounded_channel::<PublishJob>();
        drop(rx);
        let slot = std::sync::Mutex::new(Some(dead));
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let mut done_tx = Some(done_tx);
        let job = PublishJob::new("acme/variable/v1".to_string(), move || {
            if let Some(tx) = done_tx.take() {
                let _ = tx.send(());
            }
            async { Ok(()) }
        });

        send_or_restart(&slot, Duration::ZERO, job);

        done_rx.await.unwrap();
        assert!(!slot.lock().unwrap().as_ref().unwrap().is_closed());
    }

    #[test]
    fn a_variable_used_only_in_a_secret_header_counts_as_used() {
        let dek = vec![7u8; 64];
        let mut header_only = Synthetic {
            id: "c1".into(),
            name: "Orders API".into(),
            check_type: config::meta::synthetics::SyntheticType::Http,
            target: "https://shop.test/orders".into(),
            config: serde_json::json!({
                "method": "GET",
                "headers": [{ "key": "Authorization", "value": "" }]
            }),
            ..Default::default()
        };
        header_only.config_secrets.insert(
            "/headers/0/value".into(),
            encrypt_secret(&dek, "Bearer {{API_TOKEN}}").unwrap(),
        );
        let mut checks = vec![header_only];
        assert!(checks.iter_mut().any(has_encrypted_config));
        let row = named_var("g1", "API_TOKEN", GLOBAL);
        let scan = UsageScan::new(checks.clone(), vec![row.clone()], GLOBAL.to_string());
        assert!(scan.user_names(&row).is_empty());

        rehydrate_all(&mut checks, &dek);

        let scan = UsageScan::new(checks, vec![row.clone()], GLOBAL.to_string());
        assert_eq!(scan.user_names(&row), ["Orders API"]);
    }

    #[test]
    fn an_unreadable_secret_slot_leaves_the_check_as_stored() {
        let mut check = Synthetic {
            name: "Broken".into(),
            check_type: config::meta::synthetics::SyntheticType::Http,
            target: "{{BASE_URL}}".into(),
            config: serde_json::json!({ "headers": [{ "key": "X", "value": "" }] }),
            ..Default::default()
        };
        check
            .config_secrets
            .insert("/headers/0/value".into(), "AESenc:not-ciphertext".into());
        let mut checks = vec![check];

        rehydrate_all(&mut checks, &[7u8; 64]);

        let row = named_var("g1", "BASE_URL", GLOBAL);
        let scan = UsageScan::new(checks, vec![row.clone()], GLOBAL.to_string());
        assert_eq!(scan.user_names(&row), ["Broken"]);
    }

    #[tokio::test]
    async fn a_panicking_publish_does_not_stop_the_worker() {
        let queue = start_publish_worker(Duration::ZERO);
        let panics = PublishJob::new("acme/variables/bad".to_string(), || async {
            panic!("broken payload")
        });
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let mut done_tx = Some(done_tx);
        let next = PublishJob::new("acme/variables/next".to_string(), move || {
            if let Some(tx) = done_tx.take() {
                let _ = tx.send(());
            }
            async { Ok(()) }
        });

        queue.send(panics).ok().unwrap();
        queue.send(next).ok().unwrap();

        tokio::time::timeout(Duration::from_secs(5), done_rx)
            .await
            .expect("the job after the panic must still be sent")
            .unwrap();
        assert!(!queue.is_closed());
    }

    #[test]
    fn dropping_a_job_reports_whether_it_never_started_or_was_interrupted() {
        let job = |key: &str, state| {
            let mut job = PublishJob::new(key.to_string(), || async { Ok(()) });
            job.state = state;
            job
        };
        DROP_REPORTS.with(|reports| reports.borrow_mut().clear());

        drop(job("acme/variable/queued", SendState::NotStarted));
        drop(job("acme/variable/cut", SendState::Sending));
        drop(job("acme/variable/sent", SendState::Done));

        let reports = DROP_REPORTS.with(|reports| reports.borrow().clone());
        assert_eq!(reports.len(), 2, "{reports:?}");
        assert!(reports[0].contains("acme/variable/queued"), "{reports:?}");
        assert!(reports[0].contains("before it was sent"), "{reports:?}");
        assert!(reports[1].contains("acme/variable/cut"), "{reports:?}");
        assert!(reports[1].contains("interrupted mid-send"), "{reports:?}");
    }

    #[test]
    fn a_new_environment_id_comes_from_the_org_and_name() {
        let prod = env_record("e-prod", "prod");
        let copy = duplicate_target(&prod, "prod-eu", "asha@acme.com", 7);
        assert_eq!(
            copy.id,
            synthetics_environments::environment_id("acme", "prod-eu")
        );
    }

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn variables_db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectOptions, ConnectionTrait, Database, Schema};

        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        let mut checks = backend
            .build(
                &schema.create_table_from_entity(infra::table::entity::synthetics_checks::Entity),
            )
            .to_string();
        // The migration defaults the runtime columns to 0; a table built from the entity does not.
        for col in [
            "tz_offset",
            "last_triggered_at",
            "last_check_status",
            "consecutive_failures",
            "last_alert_at",
            "alerting",
            "degraded_notified_at",
        ] {
            let start = checks.find(&format!("\"{col}\"")).unwrap();
            let at = start + checks[start..].find("NOT NULL").unwrap() + "NOT NULL".len();
            checks.insert_str(at, " DEFAULT 0");
        }
        db.execute_unprepared(&checks).await.unwrap();
        for table in [
            schema.create_table_from_entity(infra::table::entity::synthetics_environments::Entity),
            schema.create_table_from_entity(infra::table::entity::synthetics_variables::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        db.execute_unprepared("CREATE UNIQUE INDEX u ON synthetics_variables (org_id, env, name)")
            .await
            .unwrap();
        db
    }

    async fn stored_env(
        db: &sea_orm::DatabaseConnection,
        org: &str,
        name: &str,
    ) -> SyntheticsEnvironmentRecord {
        if name == GLOBAL_ENVIRONMENT_NAME {
            return synthetics_environments::get_or_create_global(db, org)
                .await
                .unwrap()
                .0;
        }
        let record = SyntheticsEnvironmentRecord {
            id: synthetics_environments::environment_id(org, name),
            org_id: org.into(),
            name: name.into(),
            description: String::new(),
            owner: None,
            is_global: false,
            created_at: 1,
            updated_at: 1,
        };
        synthetics_environments::add(db, &record).await.unwrap();
        record
    }

    async fn stored_var(
        db: &sea_orm::DatabaseConnection,
        env: &SyntheticsEnvironmentRecord,
        name: &str,
        kind: &str,
        value: &str,
    ) -> SyntheticsVariableRecord {
        let record = SyntheticsVariableRecord {
            id: format!("{}-{name}", env.name),
            org_id: env.org_id.clone(),
            env: env.id.clone(),
            name: name.into(),
            value: value.into(),
            kind: kind.into(),
            ..var(&env.id)
        };
        synthetics_variables::insert_row(db, &record).await.unwrap();
        record
    }

    async fn stored_check(
        db: &sea_orm::DatabaseConnection,
        org: &str,
        id: &str,
        check: Synthetic,
    ) -> Synthetic {
        synthetics_checks::insert_row(db, org, id, &check)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_job_receives_only_the_shared_rows_its_check_references() {
        let db = variables_db().await;
        let org = "f14-resolve";
        let global = stored_env(&db, org, GLOBAL_ENVIRONMENT_NAME).await;
        let staging = stored_env(&db, org, "staging").await;
        stored_var(&db, &global, "URL", "plain", "https://global.test").await;
        stored_var(&db, &staging, "URL", "plain", "https://staging.test").await;
        stored_var(&db, &staging, "SMTP_TOKEN", "secret", "unrelated").await;
        stored_var(&db, &staging, "PASSWORD", "secret", "").await;

        let check = synthetic("Login", "{{URL}}/login", &[&staging.id], &[]);
        let sent = resolve_shared_variables_in(&db, org, Some(&staging.id), &check, &[7u8; 64])
            .await
            .unwrap();
        assert_eq!(
            sent,
            [
                ("URL".to_string(), "https://global.test".to_string()),
                ("URL".to_string(), "https://staging.test".to_string()),
            ]
        );

        let check = synthetic("Login", "{{URL}}?p={{PASSWORD}}", &[&staging.id], &[]);
        let err = resolve_shared_variables_in(&db, org, Some(&staging.id), &check, &[7u8; 64])
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("PASSWORD") && err.contains("staging"), "{err}");
    }

    #[tokio::test]
    async fn a_promote_to_global_moves_the_value_and_removes_the_checks_copy() {
        let db = variables_db().await;
        let org = "f14-promote";
        let global = stored_env(&db, org, GLOBAL_ENVIRONMENT_NAME).await;
        let staging = stored_env(&db, org, "staging").await;
        let check = Synthetic {
            variables: vec![plain_check_var("API_HOST")],
            ..synthetic("Login", "https://{{API_HOST}}/login", &[&staging.id], &[])
        };
        stored_check(&db, org, "c1", check).await;

        let (record, check) =
            promote_check_variable_in(&db, org, "c1", "API_HOST", &global, "asha@acme.com")
                .await
                .unwrap();
        assert_eq!(record.env, global.id);
        assert_eq!(record.value, "y");
        assert!(check.variables.is_empty());

        let shared = synthetics_variables::list(&db, org).await.unwrap();
        assert_eq!(shared.len(), 1);
        let reread = synthetics_checks::get(&db, org, "c1")
            .await
            .unwrap()
            .unwrap();
        assert!(reread.variables.is_empty());
    }

    #[tokio::test]
    async fn a_promote_to_global_is_refused_where_the_checks_environment_defines_the_name() {
        let db = variables_db().await;
        let org = "f14-promote-shadowed";
        let global = stored_env(&db, org, GLOBAL_ENVIRONMENT_NAME).await;
        let staging = stored_env(&db, org, "staging").await;
        stored_var(&db, &staging, "API_HOST", "plain", "staging.test").await;
        let check = Synthetic {
            variables: vec![plain_check_var("API_HOST")],
            ..synthetic("Login", "https://{{API_HOST}}/login", &[&staging.id], &[])
        };
        stored_check(&db, org, "c1", check).await;

        let err = promote_check_variable_in(&db, org, "c1", "API_HOST", &global, "asha@acme.com")
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("'staging'"), "{err}");
        let reread = synthetics_checks::get(&db, org, "c1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reread.variables.len(), 1, "the check keeps its own value");
        assert_eq!(synthetics_variables::list(&db, org).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_split_replaces_the_global_row_with_per_environment_rows() {
        let db = variables_db().await;
        let org = "f14-split";
        let global = stored_env(&db, org, GLOBAL_ENVIRONMENT_NAME).await;
        let prod = stored_env(&db, org, "prod").await;
        let staging = stored_env(&db, org, "staging").await;
        let source = stored_var(&db, &global, "URL", "plain", "https://global.test").await;
        stored_check(
            &db,
            org,
            "c1",
            synthetic("Prod", "{{URL}}/x", &[&prod.id], &[]),
        )
        .await;
        stored_check(
            &db,
            org,
            "c2",
            synthetic("Both", "{{URL}}/y", &[&prod.id, &staging.id], &[]),
        )
        .await;
        let target = |env: &str, value: &str| SplitTarget {
            environment: env.into(),
            value: value.into(),
        };

        let err = split_to_environments_in(
            &db,
            &global,
            &source.id,
            &[target("prod", "https://prod.test")],
            "asha@acme.com",
            &[7u8; 64],
        )
        .await
        .unwrap_err()
        .to_string();
        assert!(err.contains("Both"), "{err}");
        assert_eq!(synthetics_variables::list(&db, org).await.unwrap().len(), 1);

        let (envs, created) = split_to_environments_in(
            &db,
            &global,
            &source.id,
            &[
                target("prod", "https://prod.test"),
                target("staging", "https://staging.test"),
            ],
            "asha@acme.com",
            &[7u8; 64],
        )
        .await
        .unwrap();
        assert_eq!(envs.len(), 2);
        assert_eq!(created.len(), 2);
        let rows = synthetics_variables::list(&db, org).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|v| v.env != global.id && v.name == "URL"));
    }

    #[test]
    fn a_resync_without_super_cluster_reports_it_instead_of_counting() {
        assert!(resync_precondition(false).is_err());
        assert!(resync_precondition(true).is_ok());
    }

    #[test]
    fn a_global_row_shadowed_in_every_environment_has_no_users() {
        let global_url = named_var("g1", "URL", GLOBAL);
        let scan = UsageScan::new(
            vec![synthetic("Both", "{{URL}}", &["e-stg", "e-prod"], &[])],
            vec![
                global_url.clone(),
                named_var("s1", "URL", "e-stg"),
                named_var("p1", "URL", "e-prod"),
            ],
            GLOBAL.to_string(),
        );
        assert!(scan.users(&global_url).is_empty());
    }
}
