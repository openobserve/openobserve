// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::HashMap;
use async_once::AsyncOnce;
use async_trait::async_trait;
use aws_sdk_dynamodb::{
    config::Region,
    types::{
        AttributeDefinition, AttributeValue, BillingMode, KeySchemaElement, KeyType,
        ScalarAttributeType, Select,
    },
    Client,
};
use bytes::Bytes;
use std::sync::Arc;
use tokio::sync::mpsc;

use super::Event;
use super::Stats;
use crate::common::infra::{config::CONFIG, errors::*};

lazy_static! {
    pub static ref DYNAMO_DB: AsyncOnce<DynamoDb> = AsyncOnce::new(async { DynamoDb {} });
    pub static ref DYNAMO_DB_CLIENT: AsyncOnce<Client> =
        AsyncOnce::new(async { DynamoDb::connect().await });
}

pub struct DynamoDb {}

impl Default for DynamoDb {
    fn default() -> Self {
        DynamoDb {}
    }
}

pub enum DbOperation {
    Get,
    Put,
    Delete,
    List,
}

pub struct DynamoTableDetails {
    pub name: String,
    pub pk: String,
    pub rk: String,
    pub pk_value: String,
    pub rk_value: String,
}

impl DynamoDb {
    pub async fn connect() -> Client {
        if CONFIG.common.local_mode {
            let region = Region::new("us-west-2");
            let shared_config = aws_config::from_env()
                .region(region)
                .endpoint_url("http://localhost:8000");
            Client::new(&shared_config.load().await)
        } else {
            Client::new(&get_dynamo_config().await)
        }
    }
}

pub async fn get_dynamo_config() -> aws_config::SdkConfig {
    aws_config::load_from_env().await
}

pub async fn create_dynamo_tables() {
    let client = DYNAMO_DB_CLIENT.get().await;
    create_table(
        client,
        &CONFIG.common.dynamo_file_list_table,
        "stream",
        "file",
    )
    .await
    .unwrap();
    create_table(client, &CONFIG.common.dynamo_org_meta_table, "org", "key")
        .await
        .unwrap();
    create_table(client, &CONFIG.common.dynamo_meta_table, "type", "key")
        .await
        .unwrap();
}

async fn create_table(
    client: &aws_sdk_dynamodb::Client,
    table_name: &str,
    hash_key: &str,
    range_key: &str,
) -> std::result::Result<(), aws_sdk_dynamodb::Error> {
    let tables = client.list_tables().send().await?;
    if !tables
        .table_names()
        .unwrap_or(&[])
        .contains(&table_name.to_string())
    {
        log::info!("Table not found, creating table {}", table_name);
        let key_schema = vec![
            KeySchemaElement::builder()
                .attribute_name(hash_key)
                .key_type(KeyType::Hash)
                .build(),
            KeySchemaElement::builder()
                .attribute_name(range_key)
                .key_type(KeyType::Range)
                .build(),
        ];
        let attribute_definitions = vec![
            AttributeDefinition::builder()
                .attribute_name(hash_key)
                .attribute_type(ScalarAttributeType::S)
                .build(),
            AttributeDefinition::builder()
                .attribute_name(range_key)
                .attribute_type(ScalarAttributeType::S)
                .build(),
        ];
        client
            .create_table()
            .table_name(table_name)
            .set_key_schema(Some(key_schema))
            .set_attribute_definitions(Some(attribute_definitions))
            .billing_mode(BillingMode::PayPerRequest)
            .send()
            .await?;

        log::info!("Table {} created successfully", table_name);
    }
    Ok(())
}

pub fn get_dynamo_key(db_key: &str, operation: DbOperation) -> DynamoTableDetails {
    if db_key.starts_with("/user") {
        return DynamoTableDetails {
            name: CONFIG.common.dynamo_meta_table.clone(),
            pk_value: "users".to_string(),
            rk_value: db_key.to_string(),
            pk: "type".to_string(),
            rk: "key".to_string(),
        };
    } else if db_key.starts_with("/compact/file_list")
        || db_key.starts_with("/instance")
        || db_key.starts_with("/meta/kv/version")
        || db_key.starts_with("/syslog")
    {
        return DynamoTableDetails {
            name: CONFIG.common.dynamo_meta_table.clone(),
            pk_value: "meta".to_string(),
            rk_value: db_key.to_string(),
            pk: "type".to_string(),
            rk: "key".to_string(),
        };
    }

    let local_key = if db_key.starts_with('/') {
        &db_key[1..]
    } else {
        db_key
    };

    let parts = local_key.split('/').collect::<Vec<&str>>();

    let entity = parts[0];
    match entity {
        "function" | "templates" | "destinations" => match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => {
                return DynamoTableDetails {
                    pk_value: parts[1].to_string(),
                    rk_value: format!("{}/{}", parts[0], parts[2]),
                    name: CONFIG.common.dynamo_org_meta_table.clone(),
                    pk: "org".to_string(),
                    rk: "key".to_string(),
                }
            }
            DbOperation::List => {
                return DynamoTableDetails {
                    pk_value: parts[1].to_string(),
                    rk_value: parts[0].to_string(),
                    name: CONFIG.common.dynamo_org_meta_table.clone(),
                    pk: "org".to_string(),
                    rk: "key".to_string(),
                }
            }
        },

        _ => {
            return DynamoTableDetails {
                pk_value: parts[1].to_string(),
                rk_value: parts[0].to_string(),
                name: CONFIG.common.dynamo_org_meta_table.clone(),
                pk: "org".to_string(),
                rk: "key".to_string(),
            }
        }
    }
}

#[async_trait]
impl super::Db for DynamoDb {
    async fn stats(&self) -> Result<Stats> {
        Ok(Stats::default())
    }
    async fn get(&self, in_key: &str) -> Result<Bytes> {
        let table = get_dynamo_key(in_key, DbOperation::Get);
        let client = DYNAMO_DB_CLIENT.get().await.clone();
        match client
            .query()
            .table_name(table.name)
            .key_condition_expression("#pk = :pk AND #rk = :rk")
            .expression_attribute_names("#pk", table.pk)
            .expression_attribute_values(":pk", AttributeValue::S(table.pk_value))
            .expression_attribute_names("#rk", table.rk.to_string())
            .expression_attribute_values(":rk", AttributeValue::S(table.rk_value))
            .select(Select::AllAttributes)
            .send()
            .await
        {
            Ok(resp) => {
                let items = resp.items().unwrap();
                if items.is_empty() {
                    return Err(Error::from(DbError::KeyNotExists(in_key.to_string())));
                }
                match &items[0].get("value") {
                    Some(attr) => match attr.as_s() {
                        Ok(s) => Ok(Bytes::from(s.clone())),
                        Err(_) => Err(Error::from(DbError::KeyNotExists(in_key.to_string()))),
                    },
                    None => Err(Error::from(DbError::KeyNotExists(in_key.to_string()))),
                }
            }
            Err(_) => Err(Error::from(DbError::KeyNotExists(in_key.to_string()))),
        }
    }
    async fn put(&self, in_key: &str, value: Bytes) -> Result<()> {
        let table: DynamoTableDetails = get_dynamo_key(in_key, DbOperation::Put);
        let client = DYNAMO_DB_CLIENT.get().await.clone();
        match client
            .clone()
            .put_item()
            .table_name(table.name)
            .item(table.pk, AttributeValue::S(table.pk_value))
            .item(table.rk, AttributeValue::S(table.rk_value))
            .item(
                "value",
                AttributeValue::S(String::from_utf8(value.to_vec()).expect("Invalid UTF-8 data")),
            )
            .send()
            .await
        {
            Ok(_output) => Ok(()),
            Err(err) => {
                log::error!("db save error: {:?}", err);
                Ok(())
            }
        }
    }
    async fn delete(&self, in_key: &str, with_prefix: bool) -> Result<()> {
        let table = get_dynamo_key(in_key, DbOperation::Delete);
        let client = DYNAMO_DB_CLIENT.get().await.clone();
        match client
            .clone()
            .delete_item()
            .table_name(table.name)
            .key(table.pk, AttributeValue::S(table.pk_value))
            .key(table.rk, AttributeValue::S(table.rk_value))
            .send()
            .await
        {
            Ok(_) => {}
            Err(_) => {
                return Err(Error::from(DbError::KeyNotExists(in_key.to_string())));
            }
        }
        Ok(())
    }

    /// Contrary to `delete`, this call won't fail if `key` is missing.
    async fn delete_if_exists(&self, in_key: &str, with_prefix: bool) -> Result<()> {
        use crate::common::infra::errors::{DbError, Error};

        match self.delete(in_key, with_prefix).await {
            Ok(()) | Err(Error::DbError(DbError::KeyNotExists(_))) => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let mut result = HashMap::default();
        let table = get_dynamo_key(prefix, DbOperation::List);
        let client = DYNAMO_DB_CLIENT.get().await.clone();
        match client
            .clone()
            .query()
            .table_name(table.name)
            .key_condition_expression("#pk = :pk and begins_with(#rk , :rk)")
            .expression_attribute_names("#pk", table.pk)
            .expression_attribute_values(":pk", AttributeValue::S(table.pk_value))
            .expression_attribute_names("#rk", table.rk.clone())
            .expression_attribute_values(":rk", AttributeValue::S(table.rk_value))
            .select(Select::AllAttributes)
            .send()
            .await
        {
            Ok(resp) => {
                let items = resp.items().unwrap();
                if items.is_empty() {
                    return Ok(result);
                }
                for item in items {
                    match item.get("value") {
                        Some(attr) => match attr.as_s() {
                            Ok(s) => {
                                let res = s.as_bytes().to_vec().into();
                                result.insert(
                                    item.get(&table.rk).unwrap().as_s().unwrap().to_owned(),
                                    res,
                                );
                            }
                            Err(_) => continue,
                        },
                        None => return Err(Error::from(DbError::KeyNotExists(prefix.to_string()))),
                    }
                }
            }
            Err(err) => {
                println!("err: {:?}", err);
                return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
            }
        }

        Ok(result)
    }
    async fn list_use_channel(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<(String, Bytes)>>> {
        Ok(Arc::new(mpsc::channel(1).1))
    }
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        Ok(Vec::default())
    }
    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        Ok(Vec::default())
    }
    async fn count(&self, prefix: &str) -> Result<usize> {
        Ok(0)
    }
    async fn watch(&self, prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>> {
        Ok(Arc::new(mpsc::channel(1).1))
    }
    async fn transaction(
        &self,
        check_key: &str, // check the key exists
        and_ops: Vec<Event>,
        else_ops: Vec<Event>,
    ) -> Result<()> {
        Ok(())
    }
}
