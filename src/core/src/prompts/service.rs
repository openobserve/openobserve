// Copyright 2026 OpenObserve Inc.

use chrono::Utc;
use config::meta::folder::DEFAULT_FOLDER;
use infra::table::{
    entity::{
        llm_prompt_label_events as label_events, llm_prompt_labels as labels,
        llm_prompt_versions as versions, llm_prompt_webhook_deliveries as deliveries,
        llm_prompts as prompts,
    },
    folders, llm_prompts,
};
use sea_orm::{ConnectionTrait, IntoActiveModel, Set, TransactionTrait};
use serde::de::value::StrDeserializer;
use serde_json::json;

use super::{
    CreatePrompt, CreatePromptVersion, DeletePromptLabel, MovePromptLabel, MutationContext, Prompt,
    PromptActivity, PromptError, PromptLabel, PromptMutationResult, PromptSelector, PromptStatus,
    PromptVersion, ResolvePurpose, ResolvedPrompt, UpdatePromptHead, config_from_value,
    content_hash, normalize_tags, validate_commit_message, validate_label, validate_payload,
    validate_prompt_name,
};

pub async fn get_prompt(org_id: &str, entity_id: &str) -> Result<Prompt, PromptError> {
    let db = infra::db::get_orm_client_ro().await;
    let model = llm_prompts::get_head(db, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    prompt_from_model(db, model, true).await
}

pub async fn list_prompts(
    org_id: &str,
    include_archived: bool,
    folder_id: Option<&str>,
) -> Result<Vec<Prompt>, PromptError> {
    let db = infra::db::get_orm_client_ro().await;
    let physical_folder_id = match folder_id {
        Some(folder_id) => match folders::get_pk(
            db,
            org_id,
            folder_id,
            config::meta::folder::FolderType::Prompts,
        )
        .await?
        {
            Some(folder_pk) => Some(folder_pk),
            None if folder_id == DEFAULT_FOLDER => return Ok(Vec::new()),
            None => return Err(PromptError::FolderNotFound),
        },
        None => None,
    };
    let models =
        llm_prompts::list_heads(db, org_id, include_archived, physical_folder_id.as_deref())
            .await?;
    let mut prompts = Vec::with_capacity(models.len());
    for model in models {
        prompts.push(prompt_from_model(db, model, true).await?);
    }
    Ok(prompts)
}

pub async fn list_versions(
    org_id: &str,
    entity_id: &str,
) -> Result<Vec<PromptVersion>, PromptError> {
    let db = infra::db::get_orm_client_ro().await;
    if llm_prompts::get_head(db, org_id, entity_id)
        .await?
        .is_none()
    {
        return Err(PromptError::PromptNotFound);
    }
    llm_prompts::list_versions(db, org_id, entity_id)
        .await?
        .into_iter()
        .map(version_from_model)
        .collect()
}

pub async fn list_label_activity(
    org_id: &str,
    entity_id: &str,
) -> Result<Vec<PromptActivity>, PromptError> {
    let db = infra::db::get_orm_client_ro().await;
    if llm_prompts::get_head(db, org_id, entity_id)
        .await?
        .is_none()
    {
        return Err(PromptError::PromptNotFound);
    }
    llm_prompts::list_label_activity(db, entity_id)
        .await?
        .into_iter()
        .map(activity_from_model)
        .collect()
}

pub async fn find_content_matches(
    org_id: &str,
    hash: &str,
) -> Result<Vec<PromptVersion>, PromptError> {
    let db = infra::db::get_orm_client_ro().await;
    llm_prompts::find_content_matches(db, org_id, hash)
        .await?
        .into_iter()
        .map(version_from_model)
        .collect()
}

pub async fn resolve_prompt(
    org_id: &str,
    entity_id: &str,
    selector: PromptSelector,
    purpose: ResolvePurpose,
    folder_assertion: Option<&str>,
) -> Result<ResolvedPrompt, PromptError> {
    if let PromptSelector::Version(version) = &selector
        && *version > 0
    {
        if let Some(cached) = cached_for(
            super::cache::get_pinned(org_id, entity_id, *version),
            purpose,
        )? {
            return Ok(with_folder_assertion(cached, folder_assertion));
        }
        let db = infra::db::get_orm_client_ro().await;
        let resolved = resolve_prompt_with(
            db,
            org_id,
            entity_id,
            PromptSelector::Version(*version),
            purpose,
            None,
        )
        .await?;
        super::cache::insert_pinned(org_id, entity_id, *version, resolved.clone());
        return Ok(with_folder_assertion(resolved, folder_assertion));
    }
    let db = infra::db::get_orm_client_ro().await;
    resolve_prompt_with(db, org_id, entity_id, selector, purpose, folder_assertion).await
}

pub(crate) async fn resolve_prompt_with<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
    selector: PromptSelector,
    purpose: ResolvePurpose,
    folder_assertion: Option<&str>,
) -> Result<ResolvedPrompt, PromptError> {
    let head = llm_prompts::get_head(db, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    let label = match &selector {
        PromptSelector::Version(_) => None,
        PromptSelector::Label(label) => Some(label.clone()),
    };
    let version_number = match &selector {
        PromptSelector::Version(version) if *version > 0 => *version,
        PromptSelector::Version(_) => return Err(PromptError::InvalidSelector),
        PromptSelector::Label(label) if label == super::LATEST_LABEL => head.latest_version,
        PromptSelector::Label(label) => {
            let label = llm_prompts::get_label(db, entity_id, label)
                .await?
                .ok_or(PromptError::LabelNotFound)?;
            if label.deleted_at.is_some() || label.version.is_none() {
                return Err(PromptError::LabelGone);
            }
            label.version.expect("checked above")
        }
    };
    let pinned = match purpose {
        ResolvePurpose::Runtime => {
            llm_prompts::get_pinned_version(db, org_id, entity_id, version_number).await?
        }
        ResolvePurpose::NewReference => {
            llm_prompts::get_for_new_reference(db, org_id, entity_id, version_number).await?
        }
    }
    .ok_or_else(|| {
        if head.status == PromptStatus::Archived.as_str() && purpose == ResolvePurpose::NewReference
        {
            PromptError::ArchivedPrompt
        } else {
            PromptError::VersionNotFound
        }
    })?;
    let prompt = prompt_from_model(db, pinned.prompt, true).await?;
    let folder_assertion_mismatch =
        folder_assertion.is_some_and(|folder| folder != prompt.folder_id);
    Ok(ResolvedPrompt {
        prompt,
        version: version_from_model(pinned.version)?,
        label,
        folder_assertion_mismatch,
    })
}

pub(crate) async fn prompt_from_model<C: ConnectionTrait>(
    db: &C,
    model: prompts::Model,
    include_labels: bool,
) -> Result<Prompt, PromptError> {
    let folder_id = folders::get_public_id_by_pk(db, &model.folder_id)
        .await?
        .ok_or(PromptError::FolderNotFound)?;
    let labels = if include_labels {
        llm_prompts::list_labels(db, &model.entity_id)
            .await?
            .into_iter()
            .map(label_from_model)
            .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };
    Ok(Prompt {
        entity_id: model.entity_id,
        name: model.name,
        folder_id,
        prompt_type: parse_stored(&model.prompt_type)?,
        description: model.description,
        tags: serde_json::from_value(model.tags)
            .map_err(|error| PromptError::InvalidStoredData(error.to_string()))?,
        status: parse_stored(&model.status)?,
        latest_version: model.latest_version,
        created_by: model.created_by,
        created_at: model.created_at,
        updated_by: model.updated_by,
        updated_at: model.updated_at,
        labels,
    })
}

pub(crate) fn version_from_model(model: versions::Model) -> Result<PromptVersion, PromptError> {
    Ok(PromptVersion {
        id: model.id,
        entity_id: model.entity_id,
        version: model.version,
        payload: model.payload,
        config: config_from_value(model.config)?,
        commit_message: model.commit_message,
        source: parse_stored(&model.source)?,
        base_version: model.base_version,
        content_hash: model.content_hash,
        created_by: model.created_by,
        created_at: model.created_at,
    })
}

fn label_from_model(model: labels::Model) -> Result<PromptLabel, PromptError> {
    Ok(PromptLabel {
        name: model.name,
        version: model.version,
        deleted_at: model.deleted_at,
        updated_by: model.updated_by,
        updated_at: model.updated_at,
    })
}

fn activity_from_model(model: label_events::Model) -> Result<PromptActivity, PromptError> {
    Ok(PromptActivity {
        id: model.id,
        entity_id: model.entity_id,
        label: model.label,
        from_version: model.from_version,
        to_version: model.to_version,
        actor: model.actor,
        via: parse_stored(&model.via)?,
        created_at: model.created_at,
    })
}

/// Decodes a stored column through the same snake_case serde mapping used to write it.
pub(crate) fn parse_stored<T: serde::de::DeserializeOwned>(value: &str) -> Result<T, PromptError> {
    T::deserialize(StrDeserializer::<serde::de::value::Error>::new(value))
        .map_err(|_| PromptError::InvalidStoredData(value.to_string()))
}

pub async fn get_version(
    org_id: &str,
    entity_id: &str,
    version: i32,
) -> Result<PromptVersion, PromptError> {
    let db = infra::db::get_orm_client_ro().await;
    llm_prompts::get_version(db, org_id, entity_id, version)
        .await?
        .ok_or(PromptError::VersionNotFound)
        .and_then(version_from_model)
}

pub async fn resolve_by_name(
    org_id: &str,
    name: &str,
    selector: PromptSelector,
    purpose: ResolvePurpose,
    folder_assertion: Option<&str>,
) -> Result<ResolvedPrompt, PromptError> {
    let name = validate_prompt_name(name)?;
    let selector = match selector {
        PromptSelector::Label(label) => PromptSelector::Label(validate_label(&label)?),
        PromptSelector::Version(version) if version > 0 => PromptSelector::Version(version),
        PromptSelector::Version(_) => return Err(PromptError::InvalidSelector),
    };
    if let PromptSelector::Label(label) = &selector
        && let Some(cached) =
            cached_for(super::cache::get_name_label(org_id, &name, label), purpose)?
    {
        return Ok(with_folder_assertion(cached, folder_assertion));
    }
    let db = infra::db::get_orm_client_ro().await;
    let head = llm_prompts::get_head_by_name(db, org_id, &name)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    if let PromptSelector::Version(version) = &selector
        && let Some(cached) = cached_for(
            super::cache::get_pinned(org_id, &head.entity_id, *version),
            purpose,
        )?
    {
        return Ok(with_folder_assertion(cached, folder_assertion));
    }
    let resolved =
        resolve_prompt_with(db, org_id, &head.entity_id, selector.clone(), purpose, None).await?;
    match selector {
        PromptSelector::Label(label) => {
            super::cache::insert_name_label(org_id, &name, &label, resolved.clone())
        }
        PromptSelector::Version(version) => {
            super::cache::insert_pinned(org_id, &head.entity_id, version, resolved.clone())
        }
    }
    Ok(with_folder_assertion(resolved, folder_assertion))
}

/// Applies the archived-prompt rule that a cache hit skips by not re-reading the head.
fn cached_for(
    cached: Option<ResolvedPrompt>,
    purpose: ResolvePurpose,
) -> Result<Option<ResolvedPrompt>, PromptError> {
    match (cached, purpose) {
        (Some(cached), ResolvePurpose::NewReference) => {
            super::cache::enforce_new_reference(cached).map(Some)
        }
        (cached, _) => Ok(cached),
    }
}

fn with_folder_assertion(
    mut resolved: ResolvedPrompt,
    folder_assertion: Option<&str>,
) -> ResolvedPrompt {
    resolved.folder_assertion_mismatch =
        folder_assertion.is_some_and(|folder| folder != resolved.prompt.folder_id);
    resolved
}

pub async fn create_prompt(
    org_id: &str,
    context: &MutationContext,
    mut input: CreatePrompt,
    idempotency_key: Option<&str>,
) -> Result<PromptMutationResult, PromptError> {
    input.name = validate_prompt_name(&input.name)?;
    input.commit_message = validate_commit_message(&input.commit_message)?;
    input.tags = normalize_tags(input.tags);
    validate_payload(input.prompt_type, &input.payload)?;
    input.folder_id = input.folder_id.trim().to_string();
    if input.folder_id.is_empty() || input.folder_id == DEFAULT_FOLDER {
        input.folder_id =
            db::folders::ensure_default_folder(org_id, config::meta::folder::FolderType::Prompts)
                .await?
                .folder_id;
    }
    let webhook = webhook_for(
        org_id,
        db::prompt_settings::PromptWebhookEvent::VersionCreated,
    )
    .await?;
    let request = json!({
        "name": input.name,
        "folderId": input.folder_id,
        "type": input.prompt_type,
        "description": input.description,
        "tags": input.tags,
        "payload": input.payload,
        "config": input.config,
        "commitMessage": input.commit_message,
        "source": input.source,
    });
    let request_hash = infra::idempotency::request_hash(&request);
    let scope = infra::idempotency::Scope::prompt_create();
    let now = Utc::now().timestamp_millis();
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;

    if let Some(result) = replay(&txn, org_id, &scope, idempotency_key, &request_hash, now).await? {
        txn.commit().await?;
        return Ok(result);
    }
    if llm_prompts::get_head_by_name(&txn, org_id, &input.name)
        .await?
        .is_some()
    {
        return Err(PromptError::DuplicateName);
    }
    let folder_pk = folders::get_pk(
        &txn,
        org_id,
        &input.folder_id,
        config::meta::folder::FolderType::Prompts,
    )
    .await?
    .ok_or(PromptError::FolderNotFound)?;
    let entity_id = config::ider::generate();
    let version_id = config::ider::generate();
    let hash = content_hash(&input.payload, &input.config);
    let head = llm_prompts::insert_head(
        &txn,
        prompts::ActiveModel {
            entity_id: Set(entity_id.clone()),
            org_id: Set(org_id.to_string()),
            name: Set(input.name),
            folder_id: Set(folder_pk),
            prompt_type: Set(input.prompt_type.as_str().to_string()),
            description: Set(input.description.map(|value| value.trim().to_string())),
            tags: Set(serde_json::to_value(input.tags).expect("prompt tags serialize")),
            status: Set(PromptStatus::Active.as_str().to_string()),
            latest_version: Set(1),
            created_by: Set(context.actor.clone()),
            created_at: Set(now),
            updated_by: Set(context.actor.clone()),
            updated_at: Set(now),
        },
    )
    .await?;
    let version = llm_prompts::insert_version(
        &txn,
        versions::ActiveModel {
            id: Set(version_id),
            org_id: Set(org_id.to_string()),
            entity_id: Set(entity_id.clone()),
            version: Set(1),
            payload: Set(input.payload),
            config: Set(input.config.normalized_value()),
            commit_message: Set(input.commit_message),
            source: Set(input.source.as_str().to_string()),
            base_version: Set(None),
            content_hash: Set(hash),
            created_by: Set(context.actor.clone()),
            created_at: Set(now),
        },
    )
    .await?;
    llm_prompts::upsert_label(
        &txn,
        labels::ActiveModel {
            entity_id: Set(entity_id.clone()),
            name: Set(super::LATEST_LABEL.to_string()),
            version: Set(Some(1)),
            deleted_at: Set(None),
            updated_by: Set(context.actor.clone()),
            updated_at: Set(now),
        },
    )
    .await?;
    llm_prompts::insert_label_event(
        &txn,
        label_events::ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(org_id.to_string()),
            entity_id: Set(entity_id),
            label: Set(super::LATEST_LABEL.to_string()),
            from_version: Set(None),
            to_version: Set(Some(1)),
            actor: Set(context.actor.clone()),
            via: Set(context.via.as_str().to_string()),
            created_at: Set(now),
        },
    )
    .await?;
    let prompt = prompt_from_model(&txn, head, true).await?;
    let version = version_from_model(version)?;
    enqueue_webhook(
        &txn,
        org_id,
        context,
        webhook.as_ref(),
        WebhookMutation::VersionCreated {
            prompt: &prompt,
            version: &version,
        },
        now,
    )
    .await?;
    let result = PromptMutationResult {
        prompt,
        version,
        created: true,
        replayed: false,
    };
    record_replay(
        &txn,
        org_id,
        &scope,
        idempotency_key,
        &request_hash,
        &result,
        now,
    )
    .await?;
    txn.commit().await?;
    publish_version_created(org_id, &result.prompt.entity_id, result.version.version).await;
    Ok(result)
}

pub async fn append_version(
    org_id: &str,
    entity_id: &str,
    context: &MutationContext,
    mut input: CreatePromptVersion,
    idempotency_key: Option<&str>,
) -> Result<PromptMutationResult, PromptError> {
    input.commit_message = validate_commit_message(&input.commit_message)?;
    if input.base_version.is_some() && input.base_hash.is_some() {
        return Err(PromptError::InvalidBase);
    }
    let webhook = webhook_for(
        org_id,
        db::prompt_settings::PromptWebhookEvent::VersionCreated,
    )
    .await?;
    let request = json!({
        "entityId": entity_id,
        "payload": input.payload,
        "config": input.config,
        "commitMessage": input.commit_message,
        "source": input.source,
        "baseVersion": input.base_version,
        "baseHash": input.base_hash,
        "ifHead": input.if_head,
    });
    let request_hash = infra::idempotency::request_hash(&request);
    let scope = infra::idempotency::Scope::prompt_version(entity_id);
    let now = Utc::now().timestamp_millis();
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    if let Some(result) = replay(&txn, org_id, &scope, idempotency_key, &request_hash, now).await? {
        txn.commit().await?;
        return Ok(result);
    }
    let head = llm_prompts::get_head_for_update(&txn, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    if head.status == PromptStatus::Archived.as_str() {
        return Err(PromptError::ArchivedPrompt);
    }
    if input
        .if_head
        .is_some_and(|expected| expected != head.latest_version)
    {
        return Err(PromptError::HeadAdvanced);
    }
    let prompt_type = parse_stored(&head.prompt_type)?;
    validate_payload(prompt_type, &input.payload)?;
    let base_version = if let Some(version) = input.base_version {
        llm_prompts::get_version(&txn, org_id, entity_id, version)
            .await?
            .ok_or(PromptError::VersionNotFound)?;
        Some(version)
    } else if let Some(base_hash) = input.base_hash.as_deref() {
        Some(
            llm_prompts::newest_version_by_hash(&txn, org_id, entity_id, base_hash)
                .await?
                .ok_or(PromptError::VersionNotFound)?
                .version,
        )
    } else {
        Some(head.latest_version)
    };
    let hash = content_hash(&input.payload, &input.config);
    let current = llm_prompts::get_version(&txn, org_id, entity_id, head.latest_version)
        .await?
        .ok_or(PromptError::VersionNotFound)?;
    if current.content_hash == hash {
        let prompt = prompt_from_model(&txn, head, true).await?;
        let version = version_from_model(current)?;
        let result = PromptMutationResult {
            prompt,
            version,
            created: false,
            replayed: false,
        };
        record_replay(
            &txn,
            org_id,
            &scope,
            idempotency_key,
            &request_hash,
            &result,
            now,
        )
        .await?;
        txn.commit().await?;
        return Ok(result);
    }
    let old_version = head.latest_version;
    let next_version = old_version
        .checked_add(1)
        .ok_or(PromptError::HeadAdvanced)?;
    let version = llm_prompts::insert_version(
        &txn,
        versions::ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(org_id.to_string()),
            entity_id: Set(entity_id.to_string()),
            version: Set(next_version),
            payload: Set(input.payload),
            config: Set(input.config.normalized_value()),
            commit_message: Set(input.commit_message),
            source: Set(input.source.as_str().to_string()),
            base_version: Set(base_version),
            content_hash: Set(hash),
            created_by: Set(context.actor.clone()),
            created_at: Set(now),
        },
    )
    .await?;
    let mut active = head.into_active_model();
    active.latest_version = Set(next_version);
    active.updated_by = Set(context.actor.clone());
    active.updated_at = Set(now);
    let head = llm_prompts::update_head(&txn, active).await?;
    llm_prompts::upsert_label(
        &txn,
        labels::ActiveModel {
            entity_id: Set(entity_id.to_string()),
            name: Set(super::LATEST_LABEL.to_string()),
            version: Set(Some(next_version)),
            deleted_at: Set(None),
            updated_by: Set(context.actor.clone()),
            updated_at: Set(now),
        },
    )
    .await?;
    llm_prompts::insert_label_event(
        &txn,
        label_events::ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(org_id.to_string()),
            entity_id: Set(entity_id.to_string()),
            label: Set(super::LATEST_LABEL.to_string()),
            from_version: Set(Some(old_version)),
            to_version: Set(Some(next_version)),
            actor: Set(context.actor.clone()),
            via: Set(context.via.as_str().to_string()),
            created_at: Set(now),
        },
    )
    .await?;
    let prompt = prompt_from_model(&txn, head, true).await?;
    let version = version_from_model(version)?;
    enqueue_webhook(
        &txn,
        org_id,
        context,
        webhook.as_ref(),
        WebhookMutation::VersionCreated {
            prompt: &prompt,
            version: &version,
        },
        now,
    )
    .await?;
    let result = PromptMutationResult {
        prompt,
        version,
        created: true,
        replayed: false,
    };
    record_replay(
        &txn,
        org_id,
        &scope,
        idempotency_key,
        &request_hash,
        &result,
        now,
    )
    .await?;
    txn.commit().await?;
    publish_version_created(org_id, &result.prompt.entity_id, result.version.version).await;
    Ok(result)
}

pub async fn update_head(
    org_id: &str,
    entity_id: &str,
    context: &MutationContext,
    input: UpdatePromptHead,
) -> Result<Prompt, PromptError> {
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    let head = llm_prompts::get_head_for_update(&txn, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    if head.status == PromptStatus::Archived.as_str() {
        return Err(PromptError::ArchivedPrompt);
    }
    let description = input
        .description
        .map(|value| Some(value.trim().to_string()).filter(|value| !value.is_empty()));
    let tags = input
        .tags
        .map(|tags| serde_json::to_value(normalize_tags(tags)).expect("prompt tags serialize"));
    let folder_id = match input.folder_id {
        Some(folder_id) => Some(
            folders::get_pk(
                &txn,
                org_id,
                folder_id.trim(),
                config::meta::folder::FolderType::Prompts,
            )
            .await?
            .ok_or(PromptError::FolderNotFound)?,
        ),
        None => None,
    };
    let unchanged = description
        .as_ref()
        .is_none_or(|description| description == &head.description)
        && tags.as_ref().is_none_or(|tags| tags == &head.tags)
        && folder_id
            .as_ref()
            .is_none_or(|folder_id| folder_id == &head.folder_id);
    if unchanged {
        let prompt = prompt_from_model(&txn, head, true).await?;
        txn.commit().await?;
        return Ok(prompt);
    }

    let mut active = head.into_active_model();
    if let Some(description) = description {
        active.description = Set(description);
    }
    if let Some(tags) = tags {
        active.tags = Set(tags);
    }
    if let Some(folder_id) = folder_id {
        active.folder_id = Set(folder_id);
    }
    active.updated_by = Set(context.actor.clone());
    active.updated_at = Set(Utc::now().timestamp_millis());
    let head = llm_prompts::update_head(&txn, active).await?;
    let prompt = prompt_from_model(&txn, head, true).await?;
    txn.commit().await?;
    publish_head(org_id, entity_id).await;
    Ok(prompt)
}

pub async fn archive(
    org_id: &str,
    entity_id: &str,
    context: &MutationContext,
) -> Result<Prompt, PromptError> {
    let webhook = webhook_for(org_id, db::prompt_settings::PromptWebhookEvent::Archived).await?;
    let now = Utc::now().timestamp_millis();
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    let head = llm_prompts::get_head_for_update(&txn, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    if head.status == PromptStatus::Archived.as_str() {
        let prompt = prompt_from_model(&txn, head, true).await?;
        txn.commit().await?;
        return Ok(prompt);
    }
    let mut active = head.into_active_model();
    active.status = Set(PromptStatus::Archived.as_str().to_string());
    active.updated_by = Set(context.actor.clone());
    active.updated_at = Set(now);
    let head = llm_prompts::update_head(&txn, active).await?;
    let prompt = prompt_from_model(&txn, head, true).await?;
    enqueue_webhook(
        &txn,
        org_id,
        context,
        webhook.as_ref(),
        WebhookMutation::Archived { prompt: &prompt },
        now,
    )
    .await?;
    txn.commit().await?;
    publish_head(org_id, entity_id).await;
    Ok(prompt)
}

pub async fn move_label(
    org_id: &str,
    entity_id: &str,
    label: &str,
    context: &MutationContext,
    input: MovePromptLabel,
    can_move_protected: bool,
) -> Result<PromptLabel, PromptError> {
    let label = validate_label(label)?;
    if label == super::LATEST_LABEL {
        return Err(PromptError::LatestLabelImmutable);
    }
    let settings = db::prompt_settings::get(org_id).await?;
    if settings.protected_labels.contains(&label) && !can_move_protected {
        return Err(PromptError::ProtectedLabelForbidden);
    }
    let webhook = webhook_from_settings(
        &settings,
        db::prompt_settings::PromptWebhookEvent::LabelMoved,
    );
    let now = Utc::now().timestamp_millis();
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    let head = llm_prompts::get_head_for_update(&txn, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    if head.status == PromptStatus::Archived.as_str() {
        return Err(PromptError::ArchivedPrompt);
    }
    if input.version <= 0
        || llm_prompts::get_version(&txn, org_id, entity_id, input.version)
            .await?
            .is_none()
    {
        return Err(PromptError::VersionNotFound);
    }
    let existing = llm_prompts::get_label_for_update(&txn, entity_id, &label).await?;
    let from_version = existing.as_ref().and_then(|model| model.version);
    if input
        .if_version
        .is_some_and(|expected| Some(expected) != from_version)
    {
        return Err(PromptError::HeadAdvanced);
    }
    llm_prompts::upsert_label(
        &txn,
        labels::ActiveModel {
            entity_id: Set(entity_id.to_string()),
            name: Set(label.clone()),
            version: Set(Some(input.version)),
            deleted_at: Set(None),
            updated_by: Set(context.actor.clone()),
            updated_at: Set(now),
        },
    )
    .await?;
    llm_prompts::insert_label_event(
        &txn,
        label_events::ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(org_id.to_string()),
            entity_id: Set(entity_id.to_string()),
            label: Set(label.clone()),
            from_version: Set(from_version),
            to_version: Set(Some(input.version)),
            actor: Set(context.actor.clone()),
            via: Set(context.via.as_str().to_string()),
            created_at: Set(now),
        },
    )
    .await?;
    let prompt = prompt_from_model(&txn, head, false).await?;
    enqueue_webhook(
        &txn,
        org_id,
        context,
        webhook.as_ref(),
        WebhookMutation::Label {
            prompt: &prompt,
            label: &label,
            from_version,
            to_version: Some(input.version),
        },
        now,
    )
    .await?;
    txn.commit().await?;
    publish_label(org_id, entity_id, &label).await;
    Ok(PromptLabel {
        name: label,
        version: Some(input.version),
        deleted_at: None,
        updated_by: context.actor.clone(),
        updated_at: now,
    })
}

pub async fn delete_label(
    org_id: &str,
    entity_id: &str,
    label: &str,
    context: &MutationContext,
    input: DeletePromptLabel,
    can_move_protected: bool,
) -> Result<PromptLabel, PromptError> {
    let label = validate_label(label)?;
    if label == super::LATEST_LABEL {
        return Err(PromptError::LatestLabelImmutable);
    }
    let settings = db::prompt_settings::get(org_id).await?;
    if settings.protected_labels.contains(&label) && !can_move_protected {
        return Err(PromptError::ProtectedLabelForbidden);
    }
    let webhook = webhook_from_settings(
        &settings,
        db::prompt_settings::PromptWebhookEvent::LabelDeleted,
    );
    let now = Utc::now().timestamp_millis();
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    let head = llm_prompts::get_head_for_update(&txn, org_id, entity_id)
        .await?
        .ok_or(PromptError::PromptNotFound)?;
    if head.status == PromptStatus::Archived.as_str() {
        return Err(PromptError::ArchivedPrompt);
    }
    let existing = llm_prompts::get_label_for_update(&txn, entity_id, &label)
        .await?
        .ok_or(PromptError::LabelNotFound)?;
    if existing.deleted_at.is_some() || existing.version.is_none() {
        return Err(PromptError::LabelGone);
    }
    if input
        .if_version
        .is_some_and(|expected| existing.version != Some(expected))
    {
        return Err(PromptError::HeadAdvanced);
    }
    let from_version = existing.version;
    llm_prompts::upsert_label(
        &txn,
        labels::ActiveModel {
            entity_id: Set(entity_id.to_string()),
            name: Set(label.clone()),
            version: Set(None),
            deleted_at: Set(Some(now)),
            updated_by: Set(context.actor.clone()),
            updated_at: Set(now),
        },
    )
    .await?;
    llm_prompts::insert_label_event(
        &txn,
        label_events::ActiveModel {
            id: Set(config::ider::generate()),
            org_id: Set(org_id.to_string()),
            entity_id: Set(entity_id.to_string()),
            label: Set(label.clone()),
            from_version: Set(from_version),
            to_version: Set(None),
            actor: Set(context.actor.clone()),
            via: Set(context.via.as_str().to_string()),
            created_at: Set(now),
        },
    )
    .await?;
    let prompt = prompt_from_model(&txn, head, false).await?;
    enqueue_webhook(
        &txn,
        org_id,
        context,
        webhook.as_ref(),
        WebhookMutation::Label {
            prompt: &prompt,
            label: &label,
            from_version,
            to_version: None,
        },
        now,
    )
    .await?;
    txn.commit().await?;
    publish_label(org_id, entity_id, &label).await;
    Ok(PromptLabel {
        name: label,
        version: None,
        deleted_at: Some(now),
        updated_by: context.actor.clone(),
        updated_at: now,
    })
}

fn map_idempotency(error: infra::idempotency::IdempotencyError) -> PromptError {
    match error {
        infra::idempotency::IdempotencyError::Conflict => PromptError::IdempotencyConflict,
        infra::idempotency::IdempotencyError::MalformedStoredResponse(message) => {
            PromptError::MalformedReplay(message)
        }
        other => PromptError::Idempotency(other),
    }
}

async fn replay<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    scope: &infra::idempotency::Scope,
    key: Option<&str>,
    request_hash: &infra::idempotency::RequestHash,
    now: i64,
) -> Result<Option<PromptMutationResult>, PromptError> {
    let Some(key) = key else {
        return Ok(None);
    };
    match infra::idempotency::lookup(db, org_id, scope, key, request_hash, now)
        .await
        .map_err(map_idempotency)?
    {
        infra::idempotency::Replay::Stored(value) => {
            let mut result: PromptMutationResult = serde_json::from_value(value)
                .map_err(|error| PromptError::MalformedReplay(error.to_string()))?;
            result.replayed = true;
            Ok(Some(result))
        }
        infra::idempotency::Replay::Fresh => Ok(None),
    }
}

async fn record_replay<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    scope: &infra::idempotency::Scope,
    key: Option<&str>,
    request_hash: &infra::idempotency::RequestHash,
    result: &PromptMutationResult,
    now: i64,
) -> Result<(), PromptError> {
    let Some(key) = key else {
        return Ok(());
    };
    infra::idempotency::record(
        db,
        org_id,
        scope,
        key,
        request_hash,
        serde_json::to_value(result).expect("prompt mutation result serializes"),
        now,
    )
    .await
    .map_err(map_idempotency)
}

#[derive(Clone)]
struct WebhookSnapshot {
    endpoint: String,
    secret_ref: String,
    event_type: &'static str,
}

async fn webhook_for(
    org_id: &str,
    event: db::prompt_settings::PromptWebhookEvent,
) -> Result<Option<WebhookSnapshot>, PromptError> {
    let settings = db::prompt_settings::get(org_id).await?;
    Ok(webhook_from_settings(&settings, event))
}

fn webhook_from_settings(
    settings: &db::prompt_settings::PromptSettings,
    event: db::prompt_settings::PromptWebhookEvent,
) -> Option<WebhookSnapshot> {
    let webhook = settings.webhook.as_ref()?;
    if !webhook.events.contains(&event) || webhook.endpoint.is_empty() {
        return None;
    }
    Some(WebhookSnapshot {
        endpoint: webhook.endpoint.clone(),
        secret_ref: webhook.secret_ref.clone()?,
        event_type: event.as_event_type(),
    })
}

enum WebhookMutation<'a> {
    VersionCreated {
        prompt: &'a Prompt,
        version: &'a PromptVersion,
    },
    Label {
        prompt: &'a Prompt,
        label: &'a str,
        from_version: Option<i32>,
        to_version: Option<i32>,
    },
    Archived {
        prompt: &'a Prompt,
    },
}

async fn enqueue_webhook<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    context: &MutationContext,
    webhook: Option<&WebhookSnapshot>,
    mutation: WebhookMutation<'_>,
    now: i64,
) -> Result<(), PromptError> {
    let Some(webhook) = webhook else {
        return Ok(());
    };
    let delivery_id = config::ider::generate();
    let (prompt, variant) = match mutation {
        WebhookMutation::VersionCreated { prompt, version } => (
            prompt,
            json!({
                "version": {
                    "id": version.id,
                    "number": version.version,
                    "contentHash": version.content_hash,
                    "baseVersion": version.base_version,
                }
            }),
        ),
        WebhookMutation::Label {
            prompt,
            label,
            from_version,
            to_version,
        } => (
            prompt,
            json!({
                "label": {
                    "name": label,
                    "fromVersion": from_version,
                    "toVersion": to_version,
                }
            }),
        ),
        WebhookMutation::Archived { prompt } => (prompt, json!({})),
    };
    let mut payload = json!({
        "id": delivery_id,
        "type": webhook.event_type,
        "occurredAt": now,
        "orgId": org_id,
        "actor": context.actor,
        "source": context.via,
        "prompt": {
            "entityId": prompt.entity_id,
            "name": prompt.name,
            "folderId": prompt.folder_id,
        }
    });
    payload
        .as_object_mut()
        .expect("webhook payload is an object")
        .extend(
            variant
                .as_object()
                .expect("webhook variant is an object")
                .clone(),
        );
    llm_prompts::insert_delivery(
        db,
        deliveries::ActiveModel {
            id: Set(delivery_id),
            org_id: Set(org_id.to_string()),
            event_type: Set(webhook.event_type.to_string()),
            payload: Set(payload),
            endpoint: Set(webhook.endpoint.clone()),
            secret_ref: Set(webhook.secret_ref.clone()),
            status: Set("pending".to_string()),
            attempt_count: Set(0),
            next_attempt_at: Set(now),
            last_error: Set(None),
            created_at: Set(now),
            delivered_at: Set(None),
        },
    )
    .await?;
    Ok(())
}

async fn publish_version_created(org_id: &str, entity_id: &str, version: i32) {
    super::cache::invalidate_entity(org_id, entity_id);
    log_coordinator_result(
        "version",
        infra::coordinator::prompts::emit_version(org_id, entity_id, version).await,
    );
    log_coordinator_result(
        "latest label",
        infra::coordinator::prompts::emit_label(org_id, entity_id, super::LATEST_LABEL).await,
    );
    log_coordinator_result(
        "head",
        infra::coordinator::prompts::emit_head(org_id, entity_id).await,
    );
}

async fn publish_label(org_id: &str, entity_id: &str, label: &str) {
    super::cache::invalidate_label(org_id, entity_id, label);
    log_coordinator_result(
        "label",
        infra::coordinator::prompts::emit_label(org_id, entity_id, label).await,
    );
}

async fn publish_head(org_id: &str, entity_id: &str) {
    super::cache::invalidate_entity(org_id, entity_id);
    log_coordinator_result(
        "head",
        infra::coordinator::prompts::emit_head(org_id, entity_id).await,
    );
}

fn log_coordinator_result(kind: &str, result: Result<(), infra::errors::Error>) {
    if let Err(error) = result {
        log::warn!(
            "[prompts] {kind} cache invalidation was not published; local cache is invalidated and remote label entries expire within 60 seconds: {error}"
        );
    }
}
