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

use std::sync::{LazyLock as Lazy, RwLock};

use hashbrown::HashMap;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, sea_query::OnConflict};
use serde::{Deserialize, Serialize};

use super::{entity::org_storage_providers::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::cipher,
};

// we cannot use service level cache in infra, and we have a 'if-storage-set' check on a hot path
// which means we cannot hit the db for non-existing orgs.
// hence we must also set up a cache here and take care of properly invalidating it in service layer
static CACHE: Lazy<RwLock<HashMap<String, Option<OrgStorageProvider>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
pub enum ProviderType {
    AwsCredentials,
    AwsRoleArn,
    GcpCredentials,
    AzureCredentials,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct OrgStorageProvider {
    pub org_id: String,
    pub provider_type: ProviderType,
    pub created_at: i64,
    pub updated_at: i64,
    pub data: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct AwsCredentials {
    pub bucket_name: String,
    pub server_url: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GcpCredentials {
    pub bucket_name: String,
    pub server_url: String,
    pub access_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct AzureCredentials {
    pub bucket_name: String,
    pub server_url: String,
    pub storage_account: String,
    pub secret_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct AwsRoleArn {
    pub bucket_name: String,
    pub region: String,
    pub role_arn: String,
    pub external_id: String,
}

impl From<String> for ProviderType {
    fn from(value: String) -> Self {
        match value.as_str() {
            "AwsCredentials" => Self::AwsCredentials,
            "GcpCredentials" => Self::GcpCredentials,
            "AzureCredentials" => Self::AzureCredentials,
            "AwsRoleArn" => Self::AwsRoleArn,
            _ => Self::AwsCredentials,
        }
    }
}

impl std::fmt::Display for ProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AwsCredentials => write!(f, "AwsCredentials"),
            Self::AwsRoleArn => write!(f, "AwsRoleArn"),
            Self::AzureCredentials => write!(f, "AzureCredentials"),
            Self::GcpCredentials => write!(f, "GcpCredentials"),
        }
    }
}

impl From<Model> for OrgStorageProvider {
    fn from(value: Model) -> Self {
        Self {
            org_id: value.org_id,
            provider_type: value.provider_type.into(),
            created_at: value.created_at,
            updated_at: value.updated_at,
            data: value.data,
        }
    }
}

fn encrypt_data(dek: &[u8], plaintext: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .encrypt(dek, plaintext)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

fn decrypt_data(dek: &[u8], ciphertext_b64: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .decrypt(dek, ciphertext_b64)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

pub async fn add(entry: OrgStorageProvider) -> Result<(), errors::Error> {
    let cache_entry = entry.clone();

    let dek = cipher::get_dek(&entry.org_id).await?;

    let encrypted_data = encrypt_data(&dek, &entry.data)?;

    let model = ActiveModel {
        org_id: Set(entry.org_id),
        provider_type: Set(entry.provider_type.to_string()),
        created_at: Set(entry.created_at),
        updated_at: Set(entry.updated_at),
        data: Set(encrypted_data),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    Entity::insert(model)
        .on_conflict(
            OnConflict::column(Column::OrgId)
                .update_columns([Column::UpdatedAt, Column::Data, Column::ProviderType])
                .to_owned(),
        )
        .exec(client)
        .await?;

    {
        let mut cache = CACHE.write().unwrap();
        cache.insert(cache_entry.org_id.clone(), Some(cache_entry.clone()));
    }

    Ok(())
}

pub async fn get_for_org(org_id: &str) -> Result<Option<OrgStorageProvider>, errors::Error> {
    {
        let cache = CACHE.read().unwrap();
        if let Some(v) = cache.get(org_id) {
            return Ok(v.clone());
        }
    }

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?;
    // we must drop lock here, as the get_dek itself can attempt lock, which results in deadlock
    drop(_lock);

    let dek = cipher::get_dek(org_id).await?;
    let ret = res
    // first decrypt the data, and if successful, replace the model's data field with decrypted
        .map(|mut v| {
            let decrypted = decrypt_data(&dek, &v.data);
            decrypted.map(|data| {
                v.data = data;
                v
            })
        })
        // then convert Option<result> to result<option>, and propagate error
        .transpose()?
        // finally if all went well, convert to OrgStorageProvider
        .map(|v| v.into());

    // we always cache even when it is None, cause the check is on a hot path,
    // so better to return No quickly from cache and bear pain of invalidation
    // than to hit db every time we check for an org for which it is not set
    {
        let mut cache = CACHE.write().unwrap();
        cache.insert(org_id.to_string(), ret.clone());
    }

    Ok(ret)
}

pub fn get_for_org_from_cache(org_id: &str) -> Option<OrgStorageProvider> {
    let cache = CACHE.read().unwrap();
    cache.get(org_id).and_then(|v| v.clone())
}

pub fn update_cache(org_id: &str, provider_info: OrgStorageProvider) {
    let mut cache = CACHE.write().unwrap();
    cache.insert(org_id.to_string(), Some(provider_info));
}

// be careful when using this fn. Ideally this should only be used when completely
// removing the org level storage for an org.
pub fn remove_from_cache(org_id: &str) {
    let mut cache = CACHE.write().unwrap();
    cache.remove(org_id);
}

pub async fn list_all() -> Result<Vec<OrgStorageProvider>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::find().all(client).await?;
    let temp: Vec<OrgStorageProvider> = res.into_iter().map(|v| v.into()).collect();
    let mut ret = Vec::with_capacity(temp.len());

    for mut t in temp.into_iter() {
        let dek = cipher::get_dek(&t.org_id).await?;
        let decrypted = decrypt_data(&dek, &t.data)?;
        t.data = decrypted;
        ret.push(t);
    }

    Ok(ret)
}

pub async fn prime_cache() -> Result<(), anyhow::Error> {
    let all = list_all().await?;
    let mut cache = CACHE.write().unwrap();
    for v in all {
        cache.insert(v.org_id.clone(), Some(v));
    }
    Ok(())
}
