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

//! Service layer for the `providers` table.
//!
//! All functions operate with **plaintext** `auth_config` at the service
//! boundary. Encryption (write) and decryption (read) are handled transparently
//! using the org's per-org DEK via [`cipher::get_dek`].

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Schema, Set};
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::{
        cipher,
        entity::providers::{ActiveModel, Column, Entity, Model},
    },
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub provider_type: String,
    pub endpoint: Option<String>,
    pub default_model: String,
    pub available_models: Vec<String>,
    /// Plaintext auth config at the service layer (e.g. `{"api_key": "sk-..."}`).
    /// At rest, this is encrypted with the org's DEK before being stored.
    pub auth_config: serde_json::Value,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-SIV with the org DEK)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Model conversion
// ---------------------------------------------------------------------------

fn model_to_provider(model: Model, dek: &[u8]) -> Result<Provider, errors::Error> {
    let auth_config = match model.auth_config.as_deref() {
        Some(ct) if !ct.is_empty() => {
            let plaintext = decrypt_data(dek, ct)?;
            serde_json::from_str(&plaintext).map_err(|e| errors::Error::Message(e.to_string()))?
        }
        _ => serde_json::Value::Null,
    };
    Ok(Provider {
        id: model.id,
        org_id: model.org_id,
        name: model.name,
        provider_type: model.provider_type,
        endpoint: model.endpoint,
        default_model: model.default_model,
        available_models: serde_json::from_value(model.available_models).unwrap_or_default(),
        auth_config,
        is_default: model.is_default,
        created_at: model.created_at,
        updated_at: model.updated_at,
    })
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client.execute(builder.build(&create_table_stmt)).await?;

    Ok(())
}

pub async fn add(provider: &Provider) -> Result<(), errors::Error> {
    let encrypted_auth_config = if provider.auth_config.is_null() {
        None
    } else {
        let dek = cipher::get_dek(&provider.org_id).await?;
        let plaintext = serde_json::to_string(&provider.auth_config)
            .map_err(|e| errors::Error::Message(e.to_string()))?;
        Some(encrypt_data(&dek, &plaintext)?)
    };

    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(provider.id.clone()),
        org_id: Set(provider.org_id.clone()),
        name: Set(provider.name.clone()),
        provider_type: Set(provider.provider_type.clone()),
        endpoint: Set(provider.endpoint.clone()),
        default_model: Set(provider.default_model.clone()),
        available_models: Set(serde_json::json!(provider.available_models)),
        auth_config: Set(encrypted_auth_config),
        is_default: Set(provider.is_default),
        created_at: Set(provider.created_at),
        updated_at: Set(provider.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(provider: &Provider) -> Result<(), errors::Error> {
    let encrypted_auth_config = if provider.auth_config.is_null() {
        None
    } else {
        let dek = cipher::get_dek(&provider.org_id).await?;
        let plaintext = serde_json::to_string(&provider.auth_config)
            .map_err(|e| errors::Error::Message(e.to_string()))?;
        Some(encrypt_data(&dek, &plaintext)?)
    };

    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(provider.id.clone()),
        org_id: Set(provider.org_id.clone()),
        name: Set(provider.name.clone()),
        provider_type: Set(provider.provider_type.clone()),
        endpoint: Set(provider.endpoint.clone()),
        default_model: Set(provider.default_model.clone()),
        available_models: Set(serde_json::json!(provider.available_models)),
        auth_config: Set(encrypted_auth_config),
        is_default: Set(provider.is_default),
        created_at: Set(provider.created_at),
        updated_at: Set(provider.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<Provider>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let model = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

    match model {
        Some(m) => {
            let dek = cipher::get_dek(&m.org_id).await?;
            model_to_provider(m, &dek).map(Some)
        }
        None => Ok(None),
    }
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<Provider>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::CreatedAt, sea_orm::Order::Desc)
        .all(client)
        .await?;

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let dek = cipher::get_dek(org_id).await?;
    rows.into_iter()
        .map(|m| model_to_provider(m, &dek))
        .collect()
}

pub async fn get_default(org_id: &str) -> Result<Option<Provider>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let model = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsDefault.eq(true))
        .one(client)
        .await?;

    match model {
        Some(m) => {
            let dek = cipher::get_dek(org_id).await?;
            model_to_provider(m, &dek).map(Some)
        }
        None => Ok(None),
    }
}

pub async fn delete(id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_all_by_org(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn exists(id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

    Ok(record.is_some())
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::utils::rand::random_bytes;

    use super::*;

    fn make_model(auth_config: Option<String>) -> Model {
        Model {
            id: "prov-1".to_string(),
            org_id: "myorg".to_string(),
            name: "openai".to_string(),
            provider_type: "openai".to_string(),
            endpoint: None,
            default_model: "gpt-4o".to_string(),
            available_models: serde_json::json!(["gpt-4o", "gpt-4o-mini"]),
            auth_config,
            is_default: true,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    // -----------------------------------------------------------------------
    // encrypt_data / decrypt_data
    // -----------------------------------------------------------------------

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let dek = random_bytes(64);
        let plaintext = r#"{"api_key":"sk-secret-xyz"}"#;

        let encrypted = encrypt_data(&dek, plaintext).unwrap();
        // Encrypted value must differ from plaintext
        assert_ne!(encrypted, plaintext);
        // Must be valid base64
        assert!(BASE64_STANDARD.decode(&encrypted).is_ok());

        let decrypted = decrypt_data(&dek, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_decrypt_with_wrong_dek_fails() {
        let dek1 = random_bytes(64);
        let dek2 = random_bytes(64);
        let encrypted = encrypt_data(&dek1, r#"{"api_key":"sk-secret"}"#).unwrap();
        // Decrypting with a different key must fail (AES-SIV authentication)
        assert!(decrypt_data(&dek2, &encrypted).is_err());
    }

    // -----------------------------------------------------------------------
    // model_to_provider
    // -----------------------------------------------------------------------

    #[test]
    fn test_model_to_provider_returns_plaintext_auth_config() {
        let dek = random_bytes(64);
        let plaintext = r#"{"api_key":"sk-xxx"}"#;
        let encrypted = encrypt_data(&dek, plaintext).unwrap();

        let model = make_model(Some(encrypted));
        let p = model_to_provider(model, &dek).unwrap();
        assert_eq!(p.id, "prov-1");
        assert_eq!(p.org_id, "myorg");
        assert_eq!(p.name, "openai");
        assert_eq!(p.provider_type, "openai");
        assert!(p.is_default);
        assert_eq!(p.available_models, vec!["gpt-4o", "gpt-4o-mini"]);
        assert_eq!(p.auth_config, serde_json::json!({"api_key": "sk-xxx"}));
    }

    #[test]
    fn test_model_to_provider_handles_null_auth_config() {
        let dek = random_bytes(64);
        let model = make_model(None);
        let p = model_to_provider(model, &dek).unwrap();
        assert!(p.auth_config.is_null());
    }

    #[test]
    fn test_model_to_provider_with_endpoint() {
        let dek = random_bytes(64);
        let mut model = make_model(None);
        model.endpoint = Some("https://custom.openai.com".to_string());
        let p = model_to_provider(model, &dek).unwrap();
        assert_eq!(p.endpoint, Some("https://custom.openai.com".to_string()));
    }

    #[test]
    fn test_provider_available_models_defaults_empty() {
        let dek = random_bytes(64);
        let mut model = make_model(None);
        model.available_models = serde_json::json!(42);
        let p = model_to_provider(model, &dek).unwrap();
        assert!(p.available_models.is_empty());
    }

    #[test]
    fn test_model_to_provider_wrong_dek_fails() {
        let dek1 = random_bytes(64);
        let dek2 = random_bytes(64);
        let encrypted = encrypt_data(&dek1, r#"{"api_key":"sk-xxx"}"#).unwrap();
        let model = make_model(Some(encrypted));
        assert!(model_to_provider(model, &dek2).is_err());
    }
}
