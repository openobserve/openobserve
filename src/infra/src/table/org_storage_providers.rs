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
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect, Set, sea_query::OnConflict};
use serde::{Deserialize, Serialize};

use super::entity::org_storage_providers::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
    table::cipher,
};

/// Coordinator prefix of provider events; a Delete on `{OSP_PREFIX}{org_id}` evicts that org.
pub const OSP_PREFIX: &str = "/org_storage_providers/";

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

/// A row with no DEK cannot be decrypted, and minting one would leave a key behind.
async fn decrypt_stored(provider: &OrgStorageProvider) -> Result<String, errors::Error> {
    let dek = cipher::find_dek(&provider.org_id)
        .await?
        .ok_or_else(|| errors::Error::Message("the org has no DEK".to_string()))?;
    decrypt_data(&dek, &provider.data)
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

    let client = get_orm_client_rw().await;

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

    let client = get_orm_client_rw().await;

    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?;

    let ret = match res {
        Some(row) => {
            let mut provider = OrgStorageProvider::from(row);
            provider.data = decrypt_stored(&provider).await?;
            Some(provider)
        }
        None => None,
    };

    // we always cache even when it is None, cause the check is on a hot path,
    // so better to return No quickly from cache and bear pain of invalidation
    // than to hit db every time we check for an org for which it is not set
    {
        let mut cache = CACHE.write().unwrap();
        cache.insert(org_id.to_string(), ret.clone());
    }

    Ok(ret)
}

/// Whether the org has a provider row, read from the database and never from the cache.
pub async fn exists_for_org(org_id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_ro().await;
    let row = Entity::find()
        .select_only()
        .column(Column::OrgId)
        .filter(Column::OrgId.eq(org_id))
        .into_tuple::<String>()
        .one(client)
        .await?;
    Ok(row.is_some())
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

/// Every org's provider; a row that cannot be decrypted is skipped, so the other orgs still load.
pub async fn list_all() -> Result<Vec<OrgStorageProvider>, errors::Error> {
    let client = get_orm_client_ro().await;

    let res = Entity::find().all(client).await?;
    let temp: Vec<OrgStorageProvider> = res.into_iter().map(|v| v.into()).collect();
    let mut ret = Vec::with_capacity(temp.len());

    for mut t in temp.into_iter() {
        match decrypt_stored(&t).await {
            Ok(decrypted) => {
                t.data = decrypted;
                ret.push(t);
            }
            Err(e) => log::warn!(
                "[org_storage] org={}: skipped its provider row, which cannot be decrypted: {e}",
                t.org_id
            ),
        }
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

/// Deletes the storage provider entry for the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::ConnectionTrait;

    use super::*;

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            crate::db_init().await.expect("meta store");
            crate::table::migrate().await.expect("migrations");
            cipher::boot(None).await.expect("cipher");
        })
        .await;
        true
    }

    async fn add_provider(org: &str) {
        add(OrgStorageProvider {
            org_id: org.to_string(),
            provider_type: ProviderType::AwsCredentials,
            created_at: 1,
            updated_at: 1,
            data: "{\"bucket_name\":\"b\"}".to_string(),
        })
        .await
        .unwrap();
    }

    async fn has_dek(org: &str) -> bool {
        cipher::get_data(org, cipher::EntryKind::CipherKey, cipher::DEFAULT_DEK_NAME)
            .await
            .unwrap()
            .is_some()
    }

    #[tokio::test]
    async fn get_for_org_mints_no_key_for_an_org_without_a_row() {
        if !meta_store().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let (none, some) = (format!("t_osp_none_{now}"), format!("t_osp_some_{now}"));
        add_provider(&some).await;
        for org in [&none, &some] {
            remove_from_cache(org);
        }

        let missing = get_for_org(&none).await;
        let minted = has_dek(&none).await;
        let found = get_for_org(&some).await;
        for org in [&none, &some] {
            delete_by_org(org).await.unwrap();
            remove_from_cache(org);
            cipher::delete_by_org(org).await.unwrap();
        }

        assert!(missing.unwrap().is_none());
        assert!(
            !minted,
            "a read minted a DEK for an org with no provider row"
        );
        assert_eq!(found.unwrap().unwrap().data, "{\"bucket_name\":\"b\"}");
    }

    #[tokio::test]
    async fn list_all_skips_a_row_it_cannot_decrypt() {
        if !meta_store().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let live = format!("t_osp_live_{now}");
        let no_dek = format!("t_osp_no_dek_{now}");
        let garbled = format!("t_osp_garbled_{now}");
        for org in [&live, &no_dek, &garbled] {
            add_provider(org).await;
        }
        cipher::delete_by_org(&no_dek).await.unwrap();
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE org_storage_providers SET data = 'x' WHERE org_id = '{garbled}'"
            ))
            .await
            .unwrap();

        let listed = list_all().await;
        let minted = has_dek(&no_dek).await;
        for org in [&live, &no_dek, &garbled] {
            delete_by_org(org).await.unwrap();
            remove_from_cache(org);
            cipher::delete_by_org(org).await.unwrap();
        }

        let listed = listed.expect("one bad row failed the listing of every org");
        let found = |org: &str| listed.iter().find(|p| p.org_id == org);
        assert_eq!(found(&live).unwrap().data, "{\"bucket_name\":\"b\"}");
        assert!(found(&no_dek).is_none());
        assert!(found(&garbled).is_none());
        assert!(
            !minted,
            "the listing minted a DEK for a row it cannot decrypt"
        );
    }
}
