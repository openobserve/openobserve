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
    pub static ref DYNAMO_DB: AsyncOnce<DynamoDb> = AsyncOnce::new(async { DynamoDb::new().await });
    pub static ref DYNAMO_DB_CLIENT: AsyncOnce<Client> =
        AsyncOnce::new(async { DYNAMO_DB.get().await.client.clone() });
}

pub struct DynamoDb {
    client: Client,
}

pub enum DbOperation {
    Get,
    Put,
    Delete,
    List,
}

impl DynamoDb {
    pub async fn new() -> DynamoDb {
        let client = if CONFIG.common.local_mode {
            let region = Region::new("us-west-2");
            let shared_config = aws_config::from_env()
                .region(region)
                .endpoint_url("http://localhost:8000");
            Client::new(&shared_config.load().await)
        } else {
            Client::new(&get_dynamo_config().await)
        };
        DynamoDb { client }
    }
}

pub async fn get_dynamo_config() -> aws_config::SdkConfig {
    aws_config::load_from_env().await
}

pub async fn create_dynamo_tables() {
    let client = DYNAMO_DB_CLIENT.get().await;
    let table_name = &CONFIG.common.dynamo_file_list_table;
    create_file_list_table(client, table_name).await.unwrap();
    create_meta_table(client, &CONFIG.common.dynamo_meta_table)
        .await
        .unwrap();
}

async fn create_file_list_table(
    client: &aws_sdk_dynamodb::Client,
    table_name: &str,
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
                .attribute_name("stream")
                .key_type(KeyType::Hash)
                .build(),
            KeySchemaElement::builder()
                .attribute_name("file")
                .key_type(KeyType::Range)
                .build(),
        ];
        let attribute_definitions = vec![
            AttributeDefinition::builder()
                .attribute_name("stream")
                .attribute_type(ScalarAttributeType::S)
                .build(),
            AttributeDefinition::builder()
                .attribute_name("file")
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

async fn create_meta_table(
    client: &aws_sdk_dynamodb::Client,
    table_name: &str,
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
                .attribute_name("org")
                .key_type(KeyType::Hash)
                .build(),
            KeySchemaElement::builder()
                .attribute_name("key")
                .key_type(KeyType::Range)
                .build(),
        ];
        let attribute_definitions = vec![
            AttributeDefinition::builder()
                .attribute_name("org")
                .attribute_type(ScalarAttributeType::S)
                .build(),
            AttributeDefinition::builder()
                .attribute_name("key")
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

pub fn get_dynamo_key(db_key: &str, operation: DbOperation) -> (String, String) {
    //db_key.split('/'().unwrap()
    let local_key = if db_key.starts_with('/') {
        &db_key[1..]
    } else {
        db_key
    };

    let parts = local_key.split('/').collect::<Vec<&str>>();

    if parts[0].eq("function") {
        match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => {
                (parts[1].to_string(), format!("{}/{}", parts[0], parts[2]))
            }
            DbOperation::List => (parts[1].to_string(), parts[0].to_string()),
        }
    } else {
        ("a".to_string(), "b".to_string())
    }
}

#[async_trait]
impl super::Db for DynamoDb {
    async fn stats(&self) -> Result<Stats> {
        Ok(Stats::default())
    }
    async fn get(&self, in_key: &str) -> Result<Bytes> {
        let (org, key) = get_dynamo_key(in_key, DbOperation::Get);
        match self
            .client
            .clone()
            .query()
            .table_name(&CONFIG.common.dynamo_meta_table)
            .key_condition_expression("#org = :org AND #key = :key")
            .expression_attribute_names("#org", "org".to_string())
            .expression_attribute_values(":org", AttributeValue::S(org))
            .expression_attribute_names("#key", "key".to_string())
            .expression_attribute_values(":key", AttributeValue::S(key))
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
    async fn put(&self, key: &str, value: Bytes) -> Result<()> {
        let (pk, rk) = get_dynamo_key(key, DbOperation::Put);
        match self
            .client
            .clone()
            .put_item()
            .table_name(&CONFIG.common.dynamo_meta_table)
            .item("org", AttributeValue::S(pk))
            .item("key", AttributeValue::S(rk))
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
    async fn delete(&self, key: &str, with_prefix: bool) -> Result<()> {
        let (pk, rk) = get_dynamo_key(key, DbOperation::Delete);
        match self
            .client
            .clone()
            .delete_item()
            .table_name(&CONFIG.common.dynamo_meta_table)
            .key("org", AttributeValue::S(pk))
            .key("key", AttributeValue::S(rk))
            .send()
            .await
        {
            Ok(_) => {}
            Err(err) => {
                return Err(Error::from(DbError::KeyNotExists(key.to_string())));
            }
        }
        Ok(())
    }

    /// Contrary to `delete`, this call won't fail if `key` is missing.
    async fn delete_if_exists(&self, key: &str, with_prefix: bool) -> Result<()> {
        use crate::common::infra::errors::{DbError, Error};

        match self.delete(key, with_prefix).await {
            Ok(()) | Err(Error::DbError(DbError::KeyNotExists(_))) => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let mut result = HashMap::default();
        let (org, key) = get_dynamo_key(prefix, DbOperation::Put);
        match self
            .client
            .clone()
            .query()
            .table_name(&CONFIG.common.dynamo_meta_table)
            .key_condition_expression("#org = :org and begins_with(#key , :key)")
            .expression_attribute_names("#org", "org".to_string())
            .expression_attribute_values(":org", AttributeValue::S(org))
            .expression_attribute_names("#key", "key".to_string())
            .expression_attribute_values(":key", AttributeValue::S(key))
            .select(Select::AllAttributes)
            .send()
            .await
        {
            Ok(resp) => {
                let items = resp.items().unwrap();
                if items.is_empty() {
                    return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
                }
                for item in items {
                    match item.get("value") {
                        Some(attr) => match attr.as_s() {
                            Ok(s) => {
                                let res = s.as_bytes().to_vec().into();
                                result.insert(
                                    item.get("key").unwrap().as_s().unwrap().to_owned(),
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
                println!("err is {:?}", err);
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
