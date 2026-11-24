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

//! Synthetics checks as a respell target: refs renamed in place after a secret rename.

use std::{collections::HashMap, future::Future, pin::Pin};

use config::{
    meta::{
        secret_store::{ConsumerType, SecretErrorCode, digest::KAuth},
        synthetics::{Synthetic, SyntheticAuth},
    },
    utils::encryption::SECRET_PREFIX,
};
use infra::{
    errors::Error,
    secret_store::{
        reauthorize::ConsumerImage,
        respell::{RespellTarget, respell_text},
    },
    table::{
        entity::synthetics_checks as check_entity, org_secrets, secret_refs, synthetics_checks,
        synthetics_refs, synthetics_variables,
    },
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, DatabaseTransaction, EntityTrait, IntoActiveModel,
};
use serde_json::Value;

use super::{
    CheckSecretRefusal, checks,
    crypto::{decrypt_synthetic_secrets, request_urls},
    encrypt_secret, synthetics_dek, variables,
};

type Answer<'a, T> = Pin<Box<dyn Future<Output = Result<T, Error>> + Send + 'a>>;

/// Rewrites only text the check row owns; a spliced child step is left for the child's own pass.
pub struct CheckRespell;

// The crate has no `async_trait` dependency; this is the macro's expansion written out.
impl RespellTarget for CheckRespell {
    fn consumer_type(&self) -> ConsumerType {
        ConsumerType::SyntheticsCheck
    }

    fn load_locked<'s, 't, 'o, 'c, 'k, 'at>(
        &'s self,
        txn: &'t DatabaseTransaction,
        org_id: &'o str,
        consumer_id: &'c str,
        k_auth: &'k KAuth,
    ) -> Answer<'at, Option<ConsumerImage>>
    where
        's: 'at,
        't: 'at,
        'o: 'at,
        'c: 'at,
        'k: 'at,
        Self: 'at,
    {
        Box::pin(async move {
            locked_image(txn, org_id, consumer_id, k_auth)
                .await
                .map_err(store_error)
        })
    }

    fn store_in<'s, 't, 'o, 'c, 'v, 'at>(
        &'s self,
        txn: &'t DatabaseTransaction,
        org_id: &'o str,
        consumer_id: &'c str,
        stored: &'v Value,
    ) -> Answer<'at, ()>
    where
        's: 'at,
        't: 'at,
        'o: 'at,
        'c: 'at,
        'v: 'at,
        Self: 'at,
    {
        Box::pin(async move {
            store_owned_text(txn, org_id, consumer_id, stored)
                .await
                .map_err(store_error)
        })
    }

    fn request_urls<'s, 't, 'o, 'c, 'at>(
        &'s self,
        txn: &'t DatabaseTransaction,
        org_id: &'o str,
        consumer_id: &'c str,
    ) -> Answer<'at, Vec<String>>
    where
        's: 'at,
        't: 'at,
        'o: 'at,
        'c: 'at,
        Self: 'at,
    {
        Box::pin(async move {
            let check = synthetics_checks::get(txn, org_id, consumer_id).await?;
            Ok(check.as_ref().map(request_urls).unwrap_or_default())
        })
    }

    fn after_commit<'s, 'o, 'c, 'at>(
        &'s self,
        org_id: &'o str,
        consumer_id: &'c str,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'at>>
    where
        's: 'at,
        'o: 'at,
        'c: 'at,
        Self: 'at,
    {
        Box::pin(synthetics_checks::invalidate_and_publish(
            org_id,
            consumer_id,
        ))
    }
}

/// The image a check save signs, built from the row locked FOR UPDATE.
async fn locked_image(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    k_auth: &KAuth,
) -> anyhow::Result<Option<ConsumerImage>> {
    if checks::lock_check(txn, org_id, id).await?.is_none() {
        return Ok(None);
    }
    let rows = synthetics_variables::list(txn, org_id).await?;
    let dek = synthetics_dek(org_id).await?;
    let (image, _) =
        variables::variable_check_image(txn, org_id, id, k_auth, &rows, &dek, false).await?;
    Ok(Some(image))
}

async fn store_owned_text(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    respelled: &Value,
) -> anyhow::Result<()> {
    let stale = || CheckSecretRefusal::from(SecretErrorCode::DeliveryStale);
    let mut row = checks::lock_check(txn, org_id, id)
        .await?
        .ok_or_else(stale)?;
    // Spliced text belongs to the child: renamed there, so this image's names match its text.
    for child in child_ids(&row) {
        respell_embedded_child(txn, org_id, &child).await?;
    }
    let mut form = row.clone();
    decrypt_synthetic_secrets(org_id, &mut form).await?;
    crate::job_api::expand_snapshot_for_save(txn, &mut form).await?;
    let signed = serde_json::to_value(&form)?;
    let mut changes = Vec::new();
    changed_text(&signed, respelled, &mut String::new(), &mut changes).ok_or_else(stale)?;
    let dek = synthetics_dek(org_id).await?;
    for (pointer, text) in changes {
        let pointer = owned_pointer(&pointer, &signed, &row).ok_or_else(stale)?;
        write_text(&mut row, &pointer, &text, &dek)?;
    }
    persist_slots(txn, org_id, id, &row).await?;
    sync_embedders(txn, org_id, id).await
}

fn child_ids(row: &Synthetic) -> Vec<String> {
    let steps = row.config["steps"].as_array().into_iter().flatten();
    steps
        .filter(|step| {
            step["action"]
                .as_str()
                .is_some_and(config::meta::synthetics::is_composition_action)
        })
        .filter_map(|step| step.pointer("/subtest/id")?.as_str().map(str::to_owned))
        .collect()
}

/// Renames a child's own stale ref names in its text and its ref rows together; its delivery
/// digest maps names to secret ids, so its signature stays valid without a re-sign.
async fn respell_embedded_child(
    txn: &DatabaseTransaction,
    org_id: &str,
    child_id: &str,
) -> anyhow::Result<()> {
    let refs = secret_refs::list_for_consumer_in(
        txn,
        org_id,
        ConsumerType::SyntheticsCheck.as_str(),
        child_id,
    )
    .await?;
    let names = active_names(txn, org_id, &refs).await?;
    let pending: Vec<_> = refs
        .into_iter()
        .filter_map(|r| {
            let to = names.get(&r.secret_id)?.clone();
            (r.token_name != to).then_some((r, to))
        })
        .collect();
    if pending.is_empty() {
        return Ok(());
    }
    let stale = || CheckSecretRefusal::from(SecretErrorCode::DeliveryStale);
    let mut row = checks::lock_check(txn, org_id, child_id)
        .await?
        .ok_or_else(stale)?;
    let mut form = row.clone();
    decrypt_synthetic_secrets(org_id, &mut form).await?;
    let mut text = serde_json::to_value(&form)?;
    let dek = synthetics_dek(org_id).await?;
    for (r, to) in pending {
        let slot = text.pointer_mut(&r.field).ok_or_else(stale)?;
        let old = slot.as_str().ok_or_else(stale)?;
        let new = respell_text(old, &r.token_name, &to).map_err(CheckSecretRefusal::from)?;
        write_text(&mut row, &r.field, &new, &dek)?;
        *slot = Value::String(new);
        let mut update = r.into_active_model();
        update.token_name = Set(to);
        update.update(txn).await?;
    }
    persist_slots(txn, org_id, child_id, &row).await?;
    sync_embedders(txn, org_id, child_id).await
}

/// Aligns each embedding parent's recorded name with the child text it now splices in, so the
/// parent's signature stays valid.
async fn sync_embedders(
    txn: &DatabaseTransaction,
    org_id: &str,
    child_id: &str,
) -> anyhow::Result<()> {
    for parent in synthetics_refs::list_parents(txn, org_id, child_id).await? {
        let Some(mut form) = checks::lock_check(txn, org_id, &parent.id).await? else {
            continue;
        };
        decrypt_synthetic_secrets(org_id, &mut form).await?;
        crate::job_api::expand_snapshot_for_save(txn, &mut form).await?;
        let text = serde_json::to_value(&form)?;
        let refs = secret_refs::list_for_consumer_in(
            txn,
            org_id,
            ConsumerType::SyntheticsCheck.as_str(),
            &parent.id,
        )
        .await?;
        let names = active_names(txn, org_id, &refs).await?;
        for r in refs {
            let Some(to) = names.get(&r.secret_id).filter(|to| **to != r.token_name) else {
                continue;
            };
            let spliced = text
                .pointer(&r.field)
                .and_then(Value::as_str)
                .is_some_and(|t| {
                    t.contains(&format!("{{{{secrets.{to}}}}}"))
                        && !t.contains(&format!("{{{{secrets.{}}}}}", r.token_name))
                });
            if spliced {
                let to = to.clone();
                let mut update = r.into_active_model();
                update.token_name = Set(to);
                update.update(txn).await?;
            }
        }
    }
    Ok(())
}

async fn active_names(
    txn: &DatabaseTransaction,
    org_id: &str,
    refs: &[secret_refs::Model],
) -> anyhow::Result<HashMap<String, String>> {
    let mut ids: Vec<_> = refs.iter().map(|r| r.secret_id.clone()).collect();
    ids.sort_unstable();
    ids.dedup();
    Ok(org_secrets::lock_for_share(txn, org_id, &ids)
        .await?
        .into_iter()
        .filter(|secret| secret.state == "active")
        .map(|secret| (secret.id, secret.name))
        .collect())
}

/// String leaves that differ, by JSON pointer; `None` when the two shapes differ.
fn changed_text(
    before: &Value,
    after: &Value,
    pointer: &mut String,
    out: &mut Vec<(String, String)>,
) -> Option<()> {
    let len = pointer.len();
    match (before, after) {
        (Value::String(old), Value::String(new)) => {
            if old != new {
                out.push((pointer.clone(), new.clone()));
            }
        }
        (Value::Array(old), Value::Array(new)) if old.len() == new.len() => {
            for (i, (old, new)) in old.iter().zip(new).enumerate() {
                pointer.push_str(&format!("/{i}"));
                changed_text(old, new, pointer, out)?;
                pointer.truncate(len);
            }
        }
        (Value::Object(old), Value::Object(new)) if old.len() == new.len() => {
            for (key, old) in old {
                pointer.push('/');
                pointer.push_str(&key.replace('~', "~0").replace('/', "~1"));
                changed_text(old, new.get(key)?, pointer, out)?;
                pointer.truncate(len);
            }
        }
        (old, new) if old == new => {}
        _ => return None,
    }
    Some(())
}

/// The row's own pointer for an image pointer; `None` for a step spliced in from a child.
fn owned_pointer(pointer: &str, signed: &Value, row: &Synthetic) -> Option<String> {
    let Some(rest) = pointer.strip_prefix("/config/steps/") else {
        return Some(pointer.to_owned());
    };
    let (index, field) = rest.split_once('/').unwrap_or((rest, ""));
    let step_id = signed
        .pointer(&format!("/config/steps/{index}/id"))?
        .as_str()?;
    let own = row.config["steps"]
        .as_array()?
        .iter()
        .position(|step| step["id"].as_str() == Some(step_id))?;
    Some(format!("/config/steps/{own}/{field}"))
}

/// Writes `text` where the row keeps that slot, sealed when the stored value is sealed.
fn write_text(row: &mut Synthetic, pointer: &str, text: &str, dek: &[u8]) -> anyhow::Result<()> {
    let seal = |old: &str| -> anyhow::Result<String> {
        if old.starts_with(SECRET_PREFIX) {
            encrypt_secret(dek, text)
        } else {
            Ok(text.to_owned())
        }
    };
    let path: Vec<&str> = pointer.split('/').skip(1).collect();
    let slot = match (path.as_slice(), &mut row.auth) {
        (["auth", "password"], Some(SyntheticAuth::Basic { password, .. })) => Some(password),
        (["auth", "token"], Some(SyntheticAuth::Bearer { token })) => Some(token),
        _ => None,
    };
    if let Some(slot) = slot {
        *slot = seal(slot)?;
        return Ok(());
    }
    if let ["cookies", index, "value"] = path.as_slice()
        && let Some(cookie) = index
            .parse::<usize>()
            .ok()
            .and_then(|i| row.cookies.get_mut(i))
    {
        cookie.value = seal(&cookie.value)?;
        return Ok(());
    }
    if let Some(inner) = pointer.strip_prefix("/config") {
        if let Some(sealed) = row.config_secrets.get_mut(inner) {
            *sealed = encrypt_secret(dek, text)?;
            return Ok(());
        }
        if let Some(Value::String(slot)) = row.config.pointer_mut(inner) {
            *slot = seal(slot)?;
            return Ok(());
        }
    }
    Err(CheckSecretRefusal::from(SecretErrorCode::DeliveryStale).into())
}

/// Only the slot columns change; `updated_at` is part of the signed image and stays.
async fn persist_slots(
    txn: &DatabaseTransaction,
    org_id: &str,
    id: &str,
    row: &Synthetic,
) -> anyhow::Result<()> {
    let model = check_entity::Entity::find_by_id(id.to_owned())
        .one(txn)
        .await?
        .filter(|model| model.org_id == org_id)
        .ok_or_else(|| CheckSecretRefusal::from(SecretErrorCode::DeliveryStale))?;
    let mut secrets: Value = if model.secrets.is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str(&model.secrets)?
    };
    secrets["auth"] = serde_json::to_value(&row.auth)?;
    secrets["cookies"] = serde_json::to_value(&row.cookies)?;
    secrets["config"] = serde_json::to_value(&row.config_secrets)?;
    let mut update: check_entity::ActiveModel = model.into();
    update.config = Set(row.config.clone());
    update.secrets = Set(serde_json::to_string(&secrets)?);
    update.update(txn).await?;
    Ok(())
}

fn store_error(error: anyhow::Error) -> Error {
    match error.downcast_ref::<CheckSecretRefusal>() {
        Some(refusal) => Error::SecretStore(refusal.code),
        None => Error::Message(format!("synthetics respell: {error:#}")),
    }
}
