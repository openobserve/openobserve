// Copyright 2026 OpenObserve Inc.

//! Database-backed composite definition service.
//!
//! Every graph mutation is serialized by the organization graph lock and the
//! definition plus derived child index commit in one repository transaction.

use std::collections::{HashMap, HashSet};

use common::meta::authz::Authz;
use config::meta::{
    alerts::composite::{
        CompositeError, canonical_expression, collect_references, parse_expr, validate_children,
    },
    triggers::{Trigger, TriggerModule, TriggerStatus},
};
use db::authz::{remove_ownership, set_ownership};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    scheduler,
    table::{
        alert_composites,
        entity::{alert_composite_children, alert_composites as composite_entity},
    },
};
#[cfg(feature = "enterprise")]
use o2_openfga::{
    authorizer::authz::{get_ofga_type, remove_parent_relation, set_parent_relation},
    config::get_config as get_openfga_config,
};
use sea_orm::{ActiveValue::Set, DatabaseConnection, EntityTrait};
use svix_ksuid::{Ksuid, KsuidLike as _};

use crate::alerts::composite_graph_lock;
#[cfg(feature = "enterprise")]
use crate::auth::check_permissions;

/// Create/update payload for a composite alert — the internal form the API layer
/// builds from a `CreateAlertRequestBody` / `UpdateAlertRequestBody`.
///
/// Two fields carry encodings that only make sense once you know the API layer:
/// - [`Self::stale_child_policy`] is the persisted integer id from
///   `CompositeStaleChildPolicy::storage_id()` (0=use-last, 1=false, 2=true), not the wire string.
/// - [`Self::silence_seconds`] is seconds; the API `trigger_condition.silence` is minutes and is
///   multiplied by 60 before it reaches this struct.
#[derive(Clone, Debug)]
pub struct CompositeCreate {
    /// Stable composite id. Assigned by the service on create; identifies the
    /// record to update on update.
    pub id: Option<String>,
    pub org: String,
    /// Folder slug the composite lives in (validated to exist).
    pub folder_id: String,
    pub name: String,
    pub description: Option<String>,
    /// Boolean expression over child alert IDs.
    pub expression: String,
    /// Whether a `warning` child counts as firing.
    pub warning_counts_as_firing: bool,
    /// Stale-child policy as `CompositeStaleChildPolicy::storage_id()` (0/1/2).
    pub stale_child_policy: i16,
    pub destinations: Vec<String>,
    pub template: Option<String>,
    pub context_attributes: Option<serde_json::Value>,
    pub enabled: bool,
    /// Silence window in **seconds** (API minutes × 60).
    pub silence_seconds: i64,
    pub creates_incident: bool,
    pub workflows: Vec<String>,
    pub priority: Option<i32>,
    pub tags: Vec<String>,
    pub owner: Option<String>,
    pub last_edited_by: Option<String>,
}

/// Errors the composite service surfaces to the API layer; each variant maps to
/// a machine-readable `code` + HTTP status in `composite_error_response`.
#[derive(Debug, thiserror::Error)]
pub enum CompositeServiceError {
    #[error("client supplied composite IDs are not supported")]
    ClientSuppliedId,
    #[error("{0}")]
    InvalidExpression(String),
    #[error("one or more child alerts are not accessible")]
    ChildNotAccessible(Vec<String>),
    #[error("child alert {0} is not eligible for composite evaluation")]
    ChildNotEligible(String),
    #[error("composite graph contains a cycle")]
    Cycle,
    #[error("composite graph exceeds nesting depth two")]
    TooDeep,
    #[error("composite alert not found")]
    NotFound,
    #[error("composite target folder does not exist")]
    FolderNotFound,
    #[error("child alert is referenced by composite alerts")]
    ChildReferenced(Vec<composite_entity::Model>),
    #[error("composite graph lock unavailable: {0}")]
    Lock(String),
    #[error("composite writes are disabled")]
    WritesDisabled,
    #[error("permission denied")]
    PermissionDenied,
    #[error("composite alerts are unsupported in super-cluster mode")]
    SuperClusterUnsupported,
    #[error(transparent)]
    Database(#[from] sea_orm::DbErr),
    #[error(transparent)]
    Scheduler(#[from] anyhow::Error),
}

pub async fn create_composite(
    mut request: CompositeCreate,
) -> Result<composite_entity::Model, CompositeServiceError> {
    ensure_mutation_allowed()?;
    if request.id.is_some() {
        return Err(CompositeServiceError::ClientSuppliedId);
    }
    ensure_folder_exists(&request.org, &request.folder_id).await?;
    request.id = Some(Ksuid::new(None, None).to_string());
    persist(request, false).await
}

/// Composite resources are folder-scoped exactly like alerts: the target folder
/// must exist (the ordinary alert path creates the default folder on demand).
async fn ensure_folder_exists(org: &str, folder_id: &str) -> Result<(), CompositeServiceError> {
    use config::meta::folder::FolderType;
    match infra::table::folders::exists(org, folder_id, FolderType::Alerts).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(CompositeServiceError::FolderNotFound),
        Err(error) => Err(CompositeServiceError::Scheduler(error.into())),
    }
}

pub async fn update_composite(
    id: &str,
    mut request: CompositeCreate,
) -> Result<composite_entity::Model, CompositeServiceError> {
    ensure_mutation_allowed()?;
    request.id = Some(id.to_string());
    persist(request, true).await
}

pub async fn set_composite_enabled(
    org: &str,
    id: &str,
    enabled: bool,
) -> Result<(), CompositeServiceError> {
    if enabled {
        ensure_mutation_allowed()?;
    }
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};
    let db = get_orm_client_rw().await;
    let result = composite_entity::Entity::update_many()
        .col_expr(composite_entity::Column::Enabled, Expr::value(enabled))
        .col_expr(
            composite_entity::Column::EvaluationGeneration,
            Expr::col(composite_entity::Column::EvaluationGeneration).add(1),
        )
        .filter(composite_entity::Column::Org.eq(org))
        .filter(composite_entity::Column::Id.eq(id))
        .exec(db)
        .await?;
    if result.rows_affected != 1 {
        return Err(CompositeServiceError::NotFound);
    }
    if enabled {
        let definition = composite_entity::Entity::find_by_id(id)
            .filter(composite_entity::Column::Org.eq(org))
            .one(db)
            .await?
            .ok_or(CompositeServiceError::NotFound)?;
        schedule_definition(&definition).await;
    } else if let Err(error) = scheduler::delete(org, TriggerModule::CompositeAlert, id).await {
        log::error!("[COMPOSITE_ALERT] scheduler delete failed: {error}");
    }
    Ok(())
}

pub async fn trigger_composite(org: &str, id: &str) -> Result<(), CompositeServiceError> {
    ensure_mutation_allowed()?;
    increment_and_advance(org, id, config::utils::time::now_micros()).await
}

async fn increment_and_advance(
    org: &str,
    id: &str,
    next_run_at: i64,
) -> Result<(), CompositeServiceError> {
    ensure_mutation_allowed()?;
    let db = get_orm_client_rw().await;
    alert_composites::increment_evaluation_generation(db, org, id).await?;
    match scheduler::get(org, TriggerModule::CompositeAlert, id).await {
        Ok(mut trigger) => {
            trigger.next_run_at = trigger.next_run_at.min(next_run_at);
            scheduler::update_trigger(trigger, false)
                .await
                .map_err(|error| CompositeServiceError::Scheduler(error.into()))?;
        }
        Err(_) => {
            let definition = composite_entity::Entity::find_by_id(id)
                .one(db)
                .await?
                .ok_or(CompositeServiceError::NotFound)?;
            schedule_definition(&definition).await;
        }
    }
    Ok(())
}

pub async fn move_composite(
    org: &str,
    id: &str,
    folder_id: &str,
    editor: &str,
) -> Result<(), CompositeServiceError> {
    ensure_mutation_allowed()?;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};
    let db = get_orm_client_rw().await;
    // Resolve the current folder for the authorization check and OpenFGA
    // relation rewrite below, mirroring alert::move_to_folder.
    #[cfg(feature = "enterprise")]
    let current = composite_entity::Entity::find_by_id(id)
        .filter(composite_entity::Column::Org.eq(org))
        .one(db)
        .await?
        .ok_or(CompositeServiceError::NotFound)?;
    #[cfg(feature = "enterprise")]
    if get_openfga_config().enabled
        && !check_permissions(
            id,
            org,
            editor,
            "alerts",
            "PUT",
            Some(&current.folder_id),
            false,
            true,
            false,
        )
        .await
    {
        return Err(CompositeServiceError::PermissionDenied);
    }
    let result = composite_entity::Entity::update_many()
        .col_expr(composite_entity::Column::FolderId, Expr::value(folder_id))
        .col_expr(composite_entity::Column::LastEditedBy, Expr::value(editor))
        .col_expr(
            composite_entity::Column::UpdatedAt,
            Expr::value(config::utils::time::now_micros()),
        )
        .col_expr(
            composite_entity::Column::EvaluationGeneration,
            Expr::col(composite_entity::Column::EvaluationGeneration).add(1),
        )
        .filter(composite_entity::Column::Org.eq(org))
        .filter(composite_entity::Column::Id.eq(id))
        .exec(db)
        .await?;
    // released before the OpenFGA relation rewrites below
    #[cfg(feature = "enterprise")]
    if get_openfga_config().enabled {
        set_parent_relation(
            id,
            &get_ofga_type("alerts"),
            folder_id,
            &get_ofga_type("alert_folders"),
        )
        .await;
        remove_parent_relation(
            id,
            &get_ofga_type("alerts"),
            &current.folder_id,
            &get_ofga_type("alert_folders"),
        )
        .await;
    }
    if result.rows_affected == 1 {
        Ok(())
    } else {
        Err(CompositeServiceError::NotFound)
    }
}

pub async fn clone_composite(
    org: &str,
    id: &str,
    name: Option<String>,
    folder_id: Option<String>,
    editor: String,
) -> Result<composite_entity::Model, CompositeServiceError> {
    ensure_mutation_allowed()?;
    let current = get_composite(org, id)
        .await?
        .ok_or(CompositeServiceError::NotFound)?
        .definition;
    create_composite(CompositeCreate {
        id: None,
        org: org.to_string(),
        folder_id: folder_id.unwrap_or(current.folder_id),
        name: name.unwrap_or_else(|| format!("{}_copy", current.name)),
        description: current.description,
        expression: current.expression,
        warning_counts_as_firing: current.warning_counts_as_firing,
        stale_child_policy: current.stale_child_policy,
        destinations: serde_json::from_value(current.destinations).unwrap_or_default(),
        template: current.template,
        context_attributes: current.context_attributes,
        enabled: false,
        silence_seconds: current.silence_seconds,
        creates_incident: current.creates_incident,
        workflows: serde_json::from_value(current.workflows).unwrap_or_default(),
        priority: current.priority,
        tags: current
            .tags
            .and_then(|tags| serde_json::from_value(tags).ok())
            .unwrap_or_default(),
        owner: current.owner,
        last_edited_by: Some(editor),
    })
    .await
}

async fn persist(
    request: CompositeCreate,
    update: bool,
) -> Result<composite_entity::Model, CompositeServiceError> {
    let parsed = parse_expr(&request.expression)
        .map_err(|error| CompositeServiceError::InvalidExpression(error.to_string()))?;
    let references = collect_references(&parsed).map_err(map_expression_error)?;
    validate_children(&references).map_err(map_expression_error)?;
    let expression = canonical_expression(&parsed);
    let id = request.id.clone().expect("service assigns an ID");
    let graph_guard = composite_graph_lock::lock(&request.org)
        .await
        .map_err(|error| CompositeServiceError::Lock(error.to_string()))?;
    let db = get_orm_client_rw().await;
    let mutation = persist_under_lock(db, &id, request, expression, references, update).await;
    let unlock = graph_guard
        .release()
        .await
        .map_err(|error| CompositeServiceError::Lock(error.to_string()));
    let definition = mutation?;
    unlock?;

    // Register the composite as an OpenFGA object owned by its folder, exactly
    // like regular alerts (alert.rs `set_ownership`). A no-op in OSS; in
    // enterprise this is what makes folder-scoped RBAC apply. Idempotent, so
    // safe to re-assert on update as well as create.
    set_ownership(
        &definition.org,
        "alerts",
        Authz {
            obj_id: definition.id.clone(),
            parent_type: "alert_folders".to_owned(),
            parent: definition.folder_id.clone(),
        },
    )
    .await;

    schedule_definition(&definition).await;
    Ok(definition)
}

async fn persist_under_lock(
    db: &DatabaseConnection,
    id: &str,
    request: CompositeCreate,
    expression: String,
    references: Vec<String>,
    update: bool,
) -> Result<composite_entity::Model, CompositeServiceError> {
    let resolved = resolve_children(db, &request.org, &references).await?;
    let mut graph = alert_composites::load_graph(db, &request.org).await?;
    graph.insert(
        id.to_string(),
        resolved
            .iter()
            .filter(|(_, kind)| *kind == alert_composites::ChildKind::Composite)
            .map(|(id, _)| id.clone())
            .collect(),
    );
    validate_candidate_graph(&graph)?;

    let model = composite_entity::ActiveModel {
        id: Set(id.to_string()),
        org: Set(request.org),
        folder_id: Set(request.folder_id),
        name: Set(request.name),
        description: Set(request.description),
        expression: Set(expression),
        warning_counts_as_firing: Set(request.warning_counts_as_firing),
        stale_child_policy: Set(request.stale_child_policy),
        destinations: Set(serde_json::json!(request.destinations)),
        template: Set(request.template),
        context_attributes: Set(request.context_attributes),
        enabled: Set(request.enabled),
        silence_seconds: Set(request.silence_seconds),
        creates_incident: Set(request.creates_incident),
        workflows: Set(serde_json::json!(request.workflows)),
        priority: Set(request.priority),
        tags: Set(Some(serde_json::json!(request.tags))),
        owner: Set(request.owner),
        last_edited_by: Set(request.last_edited_by),
        updated_at: Set(Some(config::utils::time::now_micros())),
        evaluation_generation: Set(0),
    };
    let children = resolved
        .into_iter()
        .enumerate()
        .map(
            |(display_order, (child_alert_id, kind))| alert_composite_children::ActiveModel {
                composite_id: Set(id.to_string()),
                child_alert_id: Set(child_alert_id),
                child_kind: Set(kind as i16),
                display_order: Set(display_order as i32),
            },
        )
        .collect();
    let saved = if update {
        alert_composites::update_with_children(db, model, children)
            .await
            .map_err(map_update_error)?
    } else {
        alert_composites::create_with_children(db, model, children).await?
    };
    Ok(saved.definition)
}

async fn resolve_children(
    db: &DatabaseConnection,
    org: &str,
    references: &[String],
) -> Result<Vec<(String, alert_composites::ChildKind)>, CompositeServiceError> {
    // Resolve the whole reference set in one batched query, rather than a
    // `resolve_by_id` round trip per child.
    let resolved_map = alert_composites::resolve_many(db, org, references).await?;
    let mut resolved = Vec::with_capacity(references.len());
    let mut inaccessible = Vec::new();
    for id in references {
        match resolved_map.get(id) {
            Some(alert_composites::Resolution::Alert(alert)) => {
                if alert.is_real_time {
                    return Err(CompositeServiceError::ChildNotEligible(id.clone()));
                }
                resolved.push((id.clone(), alert_composites::ChildKind::Alert));
            }
            Some(alert_composites::Resolution::Composite(_)) => {
                resolved.push((id.clone(), alert_composites::ChildKind::Composite));
            }
            _ => inaccessible.push(id.clone()),
        }
    }
    if inaccessible.is_empty() {
        Ok(resolved)
    } else {
        Err(CompositeServiceError::ChildNotAccessible(inaccessible))
    }
}

fn validate_candidate_graph(
    graph: &HashMap<String, Vec<String>>,
) -> Result<(), CompositeServiceError> {
    // Memoize depth per node so validation is O(V + E), not a DFS re-run from
    // every node. Cycle detection still happens via `visiting`, which never
    // memoizes an incomplete traversal.
    let mut memo: HashMap<String, usize> = HashMap::new();
    for id in graph.keys() {
        match depth(id, graph, &mut HashSet::new(), &mut memo) {
            Err(()) => return Err(CompositeServiceError::Cycle),
            Ok(value) if value > 2 => return Err(CompositeServiceError::TooDeep),
            Ok(_) => {}
        }
    }
    Ok(())
}

fn depth(
    id: &str,
    graph: &HashMap<String, Vec<String>>,
    visiting: &mut HashSet<String>,
    memo: &mut HashMap<String, usize>,
) -> Result<usize, ()> {
    if let Some(cached) = memo.get(id) {
        return Ok(*cached);
    }
    let Some(children) = graph.get(id) else {
        return Ok(0);
    };
    if !visiting.insert(id.to_string()) {
        return Err(());
    }
    let mut maximum = 0;
    for child in children {
        maximum = maximum.max(depth(child, graph, visiting, memo)?);
    }
    visiting.remove(id);
    let value = maximum + 1;
    memo.insert(id.to_string(), value);
    Ok(value)
}

async fn schedule_definition(definition: &composite_entity::Model) {
    if definition.enabled {
        let now = config::utils::time::now_micros();
        if let Ok(mut existing) = scheduler::get(
            &definition.org,
            TriggerModule::CompositeAlert,
            &definition.id,
        )
        .await
        {
            existing.next_run_at = existing.next_run_at.min(now);
            existing.status = TriggerStatus::Waiting;
            if let Err(error) = scheduler::update_trigger(existing, false).await {
                log::error!("[COMPOSITE_ALERT] scheduler update failed: {error}");
            }
            return;
        }
        let trigger = Trigger {
            id: 0,
            org: definition.org.clone(),
            module: TriggerModule::CompositeAlert,
            module_key: definition.id.clone(),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: TriggerStatus::Waiting,
            start_time: None,
            end_time: None,
            retries: 0,
            claim_epoch: 0,
            data: String::new(),
        };
        if let Err(error) = scheduler::push(trigger).await {
            log::error!("[COMPOSITE_ALERT] scheduler push failed: {error}");
        }
    }
}

pub async fn get_composite(
    org: &str,
    id: &str,
) -> Result<Option<alert_composites::CompositeWithChildren>, CompositeServiceError> {
    let db = get_orm_client_ro().await;
    Ok(alert_composites::get_by_id(db, org, id).await?)
}

/// Resolve a set of child IDs into evaluator inputs over their current rollup
/// states — one batched definition read and one batched state read. Fails on a
/// missing/corrupt child rather than fabricating a truth value.
async fn resolve_child_inputs(
    db: &DatabaseConnection,
    org: &str,
    child_ids: &[String],
    stale_k: i64,
    sweep_secs: i64,
) -> Result<Vec<super::CompositeStateInput>, anyhow::Error> {
    use config::meta::alerts::composite::alert_stale_deadline_micros;

    let resolved = alert_composites::resolve_many(db, org, child_ids).await?;
    let states = infra::table::alert_states::get_rollups(child_ids)
        .await?
        .into_iter()
        .map(|state| (state.alert_id.clone(), state))
        .collect::<HashMap<_, _>>();

    let mut inputs = Vec::with_capacity(child_ids.len());
    for id in child_ids {
        let state = states.get(id);
        let (name, alert_type, enabled, cadence_seconds, stale_deadline) = match resolved.get(id) {
            Some(alert_composites::Resolution::Alert(model)) => {
                let alert: config::meta::alerts::alert::Alert = (**model).clone().try_into()?;
                if alert.is_real_time {
                    anyhow::bail!("composite child is not eligible");
                }
                let stale_deadline = state
                    .and_then(|state| state.level_at)
                    .map(|level_at| {
                        alert_stale_deadline_micros(
                            level_at,
                            &alert.trigger_condition,
                            alert.tz_offset,
                            stale_k,
                        )
                    })
                    .transpose()?;
                (
                    alert.name,
                    if alert.query_condition.slo_condition.is_some() {
                        "slo"
                    } else {
                        "scheduled"
                    },
                    alert.enabled,
                    alert.trigger_condition.frequency.max(1),
                    stale_deadline,
                )
            }
            Some(alert_composites::Resolution::Composite(model)) => (
                model.name.clone(),
                "composite",
                model.enabled,
                sweep_secs,
                state.and_then(|state| state.level_at).and_then(|level_at| {
                    sweep_secs
                        .checked_mul(stale_k)
                        .and_then(|seconds| seconds.checked_mul(1_000_000))
                        .and_then(|window| level_at.checked_add(window))
                }),
            ),
            _ => anyhow::bail!("composite child definition missing"),
        };
        inputs.push(super::CompositeStateInput {
            alert_id: id.clone(),
            name,
            alert_type: alert_type.to_string(),
            enabled,
            level: state.and_then(|state| state.level),
            level_at: state.and_then(|state| state.level_at),
            effective_cadence_seconds: cadence_seconds,
            stale_deadline,
        });
    }
    Ok(inputs)
}

fn composite_stale_k() -> i64 {
    config::get_config().alert_composite.stale_k.max(1)
}

fn composite_sweep_secs() -> i64 {
    config::get_config().alert_composite.sweep_secs.max(1)
}

/// Evaluate a composite definition over its persisted children and current
/// rollup states, exactly as the scheduler would. Shared by the detail and
/// validate endpoints so they render the same truth without re-running any
/// child query. `Err` means the definition cannot currently be evaluated
/// (missing/corrupt child, invalid cadence); callers degrade to a null result.
pub async fn evaluate_definition(
    db: &DatabaseConnection,
    definition: &composite_entity::Model,
    children: &[alert_composite_children::Model],
) -> Result<super::CompositeEvaluation, anyhow::Error> {
    use config::meta::alerts::composite::StaleChildPolicy;

    let child_ids = children
        .iter()
        .map(|child| child.child_alert_id.clone())
        .collect::<Vec<_>>();
    let inputs = resolve_child_inputs(
        db,
        &definition.org,
        &child_ids,
        composite_stale_k(),
        composite_sweep_secs(),
    )
    .await?;
    let stale_policy = match definition.stale_child_policy {
        1 => StaleChildPolicy::TreatAsFalse,
        2 => StaleChildPolicy::TreatAsTrue,
        _ => StaleChildPolicy::UseLastState,
    };
    Ok(super::CompositeEvaluator::evaluate(
        &definition.expression,
        inputs,
        definition.warning_counts_as_firing,
        stale_policy,
        config::utils::time::now_micros(),
    )?)
}

/// Evaluate a draft expression over its referenced children, for the advisory
/// validate/preview endpoint. Resolves the operand set from the expression, not
/// a persisted child index.
pub async fn evaluate_expression(
    db: &DatabaseConnection,
    org: &str,
    expression: &str,
    warning_counts_as_firing: bool,
    stale_child_policy: i16,
) -> Result<super::CompositeEvaluation, anyhow::Error> {
    use config::meta::alerts::composite::{StaleChildPolicy, collect_references, parse_expr};

    let references = collect_references(&parse_expr(expression)?)?;
    let inputs = resolve_child_inputs(
        db,
        org,
        &references,
        composite_stale_k(),
        composite_sweep_secs(),
    )
    .await?;
    let stale_policy = match stale_child_policy {
        1 => StaleChildPolicy::TreatAsFalse,
        2 => StaleChildPolicy::TreatAsTrue,
        _ => StaleChildPolicy::UseLastState,
    };
    Ok(super::CompositeEvaluator::evaluate(
        expression,
        inputs,
        warning_counts_as_firing,
        stale_policy,
        config::utils::time::now_micros(),
    )?)
}

/// Advisory graph validation used by preview. Persistence repeats the same
/// checks while holding the organization graph lock.
pub async fn validate_composite_graph(
    org: &str,
    composite_id: Option<&str>,
    expression: &str,
) -> Result<String, CompositeServiceError> {
    let parsed = parse_expr(expression).map_err(map_expression_error)?;
    let references = collect_references(&parsed).map_err(map_expression_error)?;
    validate_children(&references).map_err(map_expression_error)?;
    let db = get_orm_client_rw().await;
    let resolved = resolve_children(db, org, &references).await?;
    let mut graph = alert_composites::load_graph(db, org).await?;
    let candidate_id = composite_id.unwrap_or("__composite_preview__");
    if composite_id.is_some() && !graph.contains_key(candidate_id) {
        return Err(CompositeServiceError::NotFound);
    }
    graph.insert(
        candidate_id.to_string(),
        resolved
            .into_iter()
            .filter(|(_, kind)| *kind == alert_composites::ChildKind::Composite)
            .map(|(id, _)| id)
            .collect(),
    );
    validate_candidate_graph(&graph)?;
    Ok(canonical_expression(&parsed))
}

pub async fn delete_composite(org: &str, id: &str) -> Result<(), CompositeServiceError> {
    let graph_guard = composite_graph_lock::lock(org)
        .await
        .map_err(|error| CompositeServiceError::Lock(error.to_string()))?;
    let db = get_orm_client_rw().await;
    let result = async {
        let parents =
            alert_composites::list_parents(db, org, alert_composites::ChildKind::Composite, id)
                .await?;
        if parents.is_empty() {
            alert_composites::delete_by_id(db, org, id).await?;
            remove_ownership(org, "alerts", Authz::new(id)).await;
            Ok(())
        } else {
            Err(CompositeServiceError::ChildReferenced(parents))
        }
    }
    .await;
    let unlock = graph_guard
        .release()
        .await
        .map_err(|error| CompositeServiceError::Lock(error.to_string()));
    if result.is_ok() {
        unlock?;
    }
    if result.is_ok()
        && let Err(error) = scheduler::delete(org, TriggerModule::CompositeAlert, id).await
    {
        log::error!("[COMPOSITE_ALERT] scheduler delete failed: {error}");
    }
    result
}

fn map_expression_error(error: CompositeError) -> CompositeServiceError {
    CompositeServiceError::InvalidExpression(error.to_string())
}

/// An update that finds no matching definition is a 404, not an internal error.
fn map_update_error(error: sea_orm::DbErr) -> CompositeServiceError {
    match error {
        sea_orm::DbErr::RecordNotFound(_) => CompositeServiceError::NotFound,
        other => CompositeServiceError::Database(other),
    }
}

/// Gates every composite write (create/update/move/trigger).
///
/// `ZO_ALERT_COMPOSITE_WRITES_ENABLED` is an opt-out kill-switch: composite
/// mutation is enabled unless the flag is explicitly set to `false` (see
/// [`config::AlertComposite::writes_enabled`]).
fn ensure_mutation_allowed() -> Result<(), CompositeServiceError> {
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return Err(CompositeServiceError::SuperClusterUnsupported);
    }
    if config::get_config().alert_composite.writes_enabled {
        Ok(())
    } else {
        Err(CompositeServiceError::WritesDisabled)
    }
}

/// Fatal on startup when super-cluster mode is enabled but composite
/// definitions or `CompositeAlert` jobs remain (§18). Super-cluster replication
/// cannot guarantee a cycle-sensitive graph, so operators must drain composites
/// before enabling it; this fails closed rather than serving a corrupt graph.
#[derive(Debug, thiserror::Error)]
#[error(
    "composite alerts are unsupported in super-cluster mode ({code}): {definition_count} definitions and {job_count} jobs remain"
)]
pub struct StartupPreflightError {
    pub code: &'static str,
    pub definition_count: usize,
    pub job_count: usize,
}

/// Startup gate for super-cluster mode. A no-op when super-cluster is off (or
/// in OSS, where it cannot be enabled). Requires the ORM and scheduler clients
/// to be initialised first.
pub async fn startup_preflight() -> anyhow::Result<()> {
    #[cfg(feature = "enterprise")]
    let super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    #[cfg(not(feature = "enterprise"))]
    let super_cluster = false;

    if !super_cluster {
        return Ok(());
    }

    let db = get_orm_client_ro().await;
    let definition_count = alert_composites::count_all(db).await? as usize;
    // `list` (not `len_module`) so a scheduler read failure fails the preflight
    // closed rather than silently reporting zero jobs.
    let job_count = scheduler::list(Some(TriggerModule::CompositeAlert))
        .await?
        .len();
    if definition_count == 0 && job_count == 0 {
        Ok(())
    } else {
        Err(StartupPreflightError {
            code: "composite_super_cluster_startup_blocked",
            definition_count,
            job_count,
        }
        .into())
    }
}
