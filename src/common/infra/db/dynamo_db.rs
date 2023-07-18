// Copyright 2022 Zinc Labs Inc. and Contributors
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

use async_once::AsyncOnce;
use aws_sdk_dynamodb::{
    config::Region,
    types::{AttributeDefinition, BillingMode, KeySchemaElement, KeyType, ScalarAttributeType},
    Client,
};

use crate::common::infra::config::CONFIG;

lazy_static! {
    pub static ref DYNAMO_DB_CLIENT: AsyncOnce<Client> =
        AsyncOnce::new(async { DynamoDb::new().await.client });
}

pub struct DynamoDb {
    client: Client,
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
    create_file_list_table(&client, table_name).await.unwrap();
}

async fn create_file_list_table(
    client: &aws_sdk_dynamodb::Client,
    table_name: &str,
) -> Result<(), aws_sdk_dynamodb::Error> {
    let tables = client.list_tables().send().await?;
    if tables
        .table_names()
        .unwrap_or(&[])
        .contains(&table_name.to_string())
    {
        log::info!("Table {} already exists", table_name);
    } else {
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
