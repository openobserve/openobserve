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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, sea_query::OnConflict};
use serde::{Deserialize, Serialize};

use super::{entity::org_storage_providers::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Clone, Serialize, Deserialize)]
pub enum ProviderType {
    AwsCredential,
    GcpCredentials,
    AzureCredentials,
}

#[derive(Clone, Serialize, Deserialize)]
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
    pub access_key: String,
    pub secret_key: String,
}

impl From<String> for ProviderType {
    fn from(value: String) -> Self {
        match value.as_str().to_ascii_lowercase().as_str() {
            "aws_credentials" => Self::AwsCredential,
            "gcp_credentials" => Self::GcpCredentials,
            "azure_credentials" => Self::AzureCredentials,
            _ => Self::AwsCredential,
        }
    }
}

impl std::fmt::Display for ProviderType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AwsCredential => write!(f, "aws_credentials"),
            Self::AzureCredentials => write!(f, "azure_credentials"),
            Self::GcpCredentials => write!(f, "gcp_credentials"),
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

pub async fn add(entry: OrgStorageProvider) -> Result<(), errors::Error> {
    let model = ActiveModel {
        org_id: Set(entry.org_id),
        provider_type: Set(entry.provider_type.to_string()),
        created_at: Set(entry.created_at),
        updated_at: Set(entry.updated_at),
        data: Set(entry.data),
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

    Ok(())
}

pub async fn get_for_org(org_id: &str) -> Result<Option<OrgStorageProvider>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?;
    let ret = res.map(|v| v.into());
    Ok(ret)
}

pub async fn list_all() -> Result<Vec<OrgStorageProvider>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let res = Entity::find().all(client).await?;
    let ret = res.into_iter().map(|v| v.into()).collect();
    Ok(ret)
}
