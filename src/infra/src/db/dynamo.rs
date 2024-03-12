// Copyright 2023 Zinc Labs Inc.
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

use std::sync::Arc;

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
use config::CONFIG;
use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, OnceCell};

use crate::{
    db::{Event, Stats},
    errors::*,
};

static DB: OnceCell<DynamoDb> = OnceCell::const_new();
static DB_CLIENT: OnceCell<Client> = OnceCell::const_new();

pub async fn get_db() -> &'static DynamoDb {
    DB.get_or_init(default).await
}

pub async fn get_db_client() -> &'static Client {
    DB_CLIENT.get_or_init(connect).await
}

#[derive(Default)]
pub struct DynamoDb {}

pub enum DbOperation {
    Get,
    Put,
    Delete,
    List,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DynamoTableDetails {
    pub name: String,
    pub pk: String,
    pub rk: String,
    pub pk_value: String,
    pub rk_value: String,
    #[serde(default = "default_oper")]
    pub operation: String,
    pub entity: String,
}

fn default_oper() -> String {
    "query".to_string()
}

async fn default() -> DynamoDb {
    DynamoDb {}
}

async fn connect() -> Client {
    if CONFIG.common.local_mode {
        let region = Region::new("us-west-2");
        let shared_config = aws_config::from_env()
            .region(region)
            .endpoint_url("http://localhost:8000");
        Client::new(&shared_config.load().await)
    } else {
        Client::new(&aws_config::load_from_env().await)
    }
}

#[async_trait]
impl super::Db for DynamoDb {
    async fn create_table(&self) -> Result<()> {
        create_table().await
    }

    async fn stats(&self) -> Result<Stats> {
        Ok(Stats::default())
    }

    async fn get(&self, in_key: &str) -> Result<Bytes> {
        let table = get_dynamo_key(in_key, DbOperation::Get);
        let client = get_db_client().await.clone();
        match client
            .query()
            .table_name(&table.name)
            .key_condition_expression("#pk = :pk AND #rk = :rk")
            .expression_attribute_names("#pk", &table.pk)
            .expression_attribute_values(":pk", AttributeValue::S(table.pk_value))
            .expression_attribute_names("#rk", &table.rk)
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

    async fn put(
        &self,
        in_key: &str,
        value: Bytes,
        need_watch: bool,
        created_at: i64,
    ) -> Result<()> {
        let table: DynamoTableDetails = get_dynamo_key(in_key, DbOperation::Put);
        let client = get_db_client().await.clone();
        match client
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
            Ok(_output) => {}
            Err(err) => {
                log::error!("db save error: {:?}", err);
                return Err(Error::from(DbError::DBOperError(
                    err.to_string(),
                    in_key.to_string(),
                )));
            }
        }

        // event watch
        if need_watch {
            let cluster_coordinator = super::get_coordinator().await;
            cluster_coordinator
                .put(in_key, Bytes::from(""), true, created_at)
                .await?;
        }

        Ok(())
    }

    // TODO: support prefix mode
    async fn delete(&self, in_key: &str, _with_prefix: bool, need_watch: bool) -> Result<()> {
        // event watch
        if need_watch {
            let cluster_coordinator = super::get_coordinator().await;
            if let Err(e) = cluster_coordinator.delete(in_key, false, true).await {
                log::error!("[DYNAMODB] send event error: {}", e);
            }
        }

        let table = get_dynamo_key(in_key, DbOperation::Delete);
        let client = get_db_client().await.clone();
        match client
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

    async fn list(&self, prefix: &str) -> Result<HashMap<String, Bytes>> {
        let mut query_resp;
        let mut result = HashMap::default();
        let table = get_dynamo_key(prefix, DbOperation::List);
        let mut last_evaluated_key: Option<std::collections::HashMap<String, AttributeValue>> =
            None;
        let client = get_db_client().await.clone();
        if table.operation == "query" {
            loop {
                let mut query = client
                    .query()
                    .table_name(&table.name)
                    .key_condition_expression("#pk = :pk and begins_with(#rk , :rk)")
                    .expression_attribute_names("#pk", &table.pk)
                    .expression_attribute_values(":pk", AttributeValue::S(table.pk_value.clone()))
                    .expression_attribute_names("#rk", &table.rk)
                    .expression_attribute_values(":rk", AttributeValue::S(table.rk_value.clone()))
                    .select(Select::AllAttributes);

                if last_evaluated_key.is_some() {
                    query = query.set_exclusive_start_key(last_evaluated_key.clone());
                }

                query_resp = query.send().await;
                match query_resp {
                    Ok(q_resp) => {
                        last_evaluated_key = q_resp.last_evaluated_key;
                        let items = q_resp.items.unwrap();
                        if items.is_empty() {
                            return Ok(result);
                        }
                        for item in items {
                            match item.get("value") {
                                Some(attr) => match attr.as_s() {
                                    Ok(s) => {
                                        let res = s.as_bytes().to_vec().into();
                                        let local_key =
                                            item.get(&table.rk).unwrap().as_s().unwrap();
                                        let key = if table.name != CONFIG.dynamo.meta_table {
                                            let org = item.get(&table.pk).unwrap().as_s().unwrap();
                                            local_key.replace(
                                                &format!("{}/", table.entity),
                                                &format!("/{}/{}/", table.entity, org),
                                            )
                                        } else {
                                            (&local_key).to_string()
                                        };
                                        result.insert(key, res);
                                    }
                                    Err(_) => continue,
                                },
                                None => {
                                    return Err(Error::from(DbError::KeyNotExists(
                                        prefix.to_string(),
                                    )));
                                }
                            }
                        }
                        if last_evaluated_key.is_none() {
                            return Ok(result);
                        }
                    }
                    Err(err) => {
                        log::error!("err: {:?}", err);
                        return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
                    }
                }
            }
        } else {
            return scan_prefix(table, &client, prefix).await;
        }
    }

    async fn list_values(&self, prefix: &str) -> Result<Vec<Bytes>> {
        let mut result = Vec::new();
        let table = get_dynamo_key(prefix, DbOperation::List);
        let client = get_db_client().await.clone();
        let mut last_evaluated_key: Option<std::collections::HashMap<String, AttributeValue>> =
            None;
        loop {
            let mut query = client
                .query()
                .table_name(&table.name)
                .key_condition_expression("#pk = :pk and begins_with(#rk , :rk)")
                .expression_attribute_names("#pk", &table.pk)
                .expression_attribute_values(":pk", AttributeValue::S(table.pk_value.clone()))
                .expression_attribute_names("#rk", &table.rk)
                .expression_attribute_values(":rk", AttributeValue::S(table.rk_value.clone()))
                .select(Select::AllAttributes);
            if last_evaluated_key.is_some() {
                query = query.set_exclusive_start_key(last_evaluated_key.clone());
            }
            match query.send().await {
                Ok(resp) => {
                    last_evaluated_key = resp.last_evaluated_key;
                    let items = resp.items.unwrap();
                    if items.is_empty() {
                        return Ok(result);
                    }
                    for item in items {
                        match item.get("value") {
                            Some(attr) => match attr.as_s() {
                                Ok(s) => {
                                    let res = s.as_bytes().to_vec().into();
                                    result.push(res);
                                }
                                Err(_) => continue,
                            },
                            None => {
                                return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
                            }
                        }
                    }
                    if last_evaluated_key.is_none() {
                        return Ok(result);
                    }
                }
                Err(err) => {
                    log::error!("err: {:?}", err);
                    return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
                }
            }
        }
    }

    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>> {
        let mut result = Vec::new();
        let table = get_dynamo_key(prefix, DbOperation::List);
        let client = get_db_client().await.clone();
        let mut last_evaluated_key: Option<std::collections::HashMap<String, AttributeValue>> =
            None;
        if table.operation == "query" {
            loop {
                let mut query = client
                    .query()
                    .table_name(&table.name)
                    .key_condition_expression("#pk = :pk and begins_with(#rk , :rk)")
                    .expression_attribute_names("#pk", &table.pk)
                    .expression_attribute_values(":pk", AttributeValue::S(table.pk_value.clone()))
                    .expression_attribute_names("#rk", &table.rk)
                    .expression_attribute_values(":rk", AttributeValue::S(table.rk_value.clone()))
                    .select(Select::AllAttributes);
                if last_evaluated_key.is_some() {
                    query = query.set_exclusive_start_key(last_evaluated_key.clone());
                }
                match query.send().await {
                    Ok(resp) => {
                        last_evaluated_key = resp.last_evaluated_key;
                        let items = resp.items.unwrap();
                        if items.is_empty() {
                            return Ok(result);
                        }
                        for item in items {
                            match item.get("value") {
                                Some(_) => {
                                    let local_key = item.get(&table.rk).unwrap().as_s().unwrap();
                                    let key = if table.name != CONFIG.dynamo.meta_table {
                                        let org = item.get(&table.pk).unwrap().as_s().unwrap();
                                        local_key.replace(
                                            &format!("{}/", table.entity),
                                            &format!("/{}/{}/", table.entity, org),
                                        )
                                    } else {
                                        (&local_key).to_string()
                                    };
                                    result.push(key);
                                }
                                None => {
                                    return Err(Error::from(DbError::KeyNotExists(
                                        prefix.to_string(),
                                    )));
                                }
                            }
                        }
                        if last_evaluated_key.is_none() {
                            return Ok(result);
                        }
                    }
                    Err(err) => {
                        log::error!("err: {:?}", err);
                        return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
                    }
                }
            }
        } else {
            loop {
                let mut query = client
                    .scan()
                    .table_name(&table.name)
                    .filter_expression("begins_with(#rk , :rk)")
                    .expression_attribute_names("#rk", &table.rk)
                    .expression_attribute_values(":rk", AttributeValue::S(table.rk_value.clone()))
                    .select(Select::AllAttributes);
                if last_evaluated_key.is_some() {
                    query = query.set_exclusive_start_key(last_evaluated_key.clone());
                }
                match query.send().await {
                    Ok(resp) => {
                        last_evaluated_key = resp.last_evaluated_key;
                        let items = resp.items.unwrap();
                        if items.is_empty() {
                            return Ok(result);
                        }
                        for item in items {
                            match item.get("value") {
                                Some(_) => {
                                    let local_key = item.get(&table.rk).unwrap().as_s().unwrap();
                                    let key = if table.name != CONFIG.dynamo.meta_table {
                                        let org = item.get(&table.pk).unwrap().as_s().unwrap();
                                        local_key.replace(
                                            &format!("{}/", table.entity),
                                            &format!("/{}/{}/", table.entity, org),
                                        )
                                    } else {
                                        (&local_key).to_string()
                                    };
                                    result.push(key);
                                }
                                None => {
                                    return Err(Error::from(DbError::KeyNotExists(
                                        prefix.to_string(),
                                    )));
                                }
                            }
                        }
                        if last_evaluated_key.is_none() {
                            return Ok(result);
                        }
                    }
                    Err(err) => {
                        log::error!("err: {:?}", err);
                        return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
                    }
                }
            }
        }
    }

    async fn count(&self, _prefix: &str) -> Result<i64> {
        Ok(0)
    }

    async fn watch(&self, _prefix: &str) -> Result<Arc<mpsc::Receiver<Event>>> {
        Err(Error::NotImplemented)
    }

    async fn close(&self) -> Result<()> {
        Ok(())
    }
}

async fn scan_prefix(
    table: DynamoTableDetails,
    client: &aws_sdk_dynamodb::Client,
    prefix: &str,
) -> Result<HashMap<String, Bytes>> {
    let mut result = HashMap::default();
    let mut last_evaluated_key: Option<std::collections::HashMap<String, AttributeValue>> = None;
    loop {
        let mut query = client
            .clone()
            .scan()
            .table_name(&table.name)
            .filter_expression("begins_with(#rk , :rk)")
            .expression_attribute_names("#rk", &table.rk)
            .expression_attribute_values(":rk", AttributeValue::S(table.rk_value.clone()))
            .select(Select::AllAttributes);
        if last_evaluated_key.is_some() {
            query = query.set_exclusive_start_key(last_evaluated_key.clone());
        }
        match query.send().await {
            Ok(resp) => {
                last_evaluated_key = resp.last_evaluated_key;
                let items = resp.items.unwrap();
                if items.is_empty() {
                    return Ok(result);
                }
                for item in items {
                    match item.get("value") {
                        Some(attr) => match attr.as_s() {
                            Ok(s) => {
                                let res = s.as_bytes().to_vec().into();
                                let local_key = item.get(&table.rk).unwrap().as_s().unwrap();
                                let key = if local_key.starts_with("compact/delete/") {
                                    let org = item.get(&table.pk).unwrap().as_s().unwrap();
                                    local_key.replace(
                                        "compact/delete/",
                                        &format!("/{}/{}/", "compact/delete", org),
                                    )
                                } else if table.name != CONFIG.dynamo.meta_table {
                                    let org = item.get(&table.pk).unwrap().as_s().unwrap();
                                    local_key.replace(
                                        &format!("{}/", table.entity),
                                        &format!("/{}/{}/", table.entity, org),
                                    )
                                } else {
                                    (&local_key).to_string()
                                };

                                result.insert(key, res);
                            }
                            Err(_) => continue,
                        },
                        None => return Err(Error::from(DbError::KeyNotExists(prefix.to_string()))),
                    }
                }
                if last_evaluated_key.is_none() {
                    return Ok(result);
                }
            }
            Err(err) => {
                log::error!("err: {:?}", err);
                return Err(Error::from(DbError::KeyNotExists(prefix.to_string())));
            }
        }
    }
}

pub fn get_dynamo_key(db_key: &str, operation: DbOperation) -> DynamoTableDetails {
    let local_key = if let Some(key) = db_key.strip_prefix('/') {
        key
    } else {
        db_key
    };

    let mut parts = local_key.split('/').collect::<Vec<&str>>();
    let empty_str = "";
    let entity = parts[0];

    if db_key.starts_with("/user") {
        return DynamoTableDetails {
            name: CONFIG.dynamo.meta_table.clone(),
            pk_value: "users".to_string(),
            rk_value: db_key.to_string(),
            pk: "type".to_string(),
            rk: "key".to_string(),
            operation: "query".to_string(),
            entity: entity.to_string(),
        };
    } else if db_key.starts_with("/compact/file_list")
        || db_key.starts_with("/compact/stream_stats")
        || db_key.starts_with("/instance")
        || db_key.starts_with("/meta/kv/version")
        || db_key.starts_with("/syslog")
    {
        return DynamoTableDetails {
            name: CONFIG.dynamo.meta_table.clone(),
            pk_value: "meta".to_string(),
            rk_value: db_key.to_string(),
            pk: "type".to_string(),
            rk: "key".to_string(),
            operation: "query".to_string(),
            entity: entity.to_string(),
        };
    }

    match entity {
        "function" | "templates" | "destinations" | "kv" | "metrics_members" | "metrics_leader"
        | "trigger" | "folders" => match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => DynamoTableDetails {
                pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                rk_value: format!("{}/{}", parts[0], parts.get(2).unwrap_or(&empty_str)),
                name: CONFIG.dynamo.org_meta_table.clone(),
                pk: "org".to_string(),
                rk: "key".to_string(),
                operation: "query".to_string(),
                entity: entity.to_string(),
            },
            DbOperation::List => {
                if parts.len() == 1 || parts.get(1).unwrap_or(&empty_str).is_empty() {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.org_meta_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "scan".to_string(),
                        entity: entity.to_string(),
                    }
                } else {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.org_meta_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "query".to_string(),
                        entity: entity.to_string(),
                    }
                }
            }
        },

        "alerts" => match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => DynamoTableDetails {
                pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                rk_value: format!(
                    "{}/{}/{}/{}",
                    parts[0],
                    parts.get(2).unwrap_or(&empty_str),
                    parts.get(3).unwrap_or(&empty_str),
                    parts.get(4).unwrap_or(&empty_str)
                ),
                name: CONFIG.dynamo.org_meta_table.clone(),
                pk: "org".to_string(),
                rk: "key".to_string(),
                operation: "query".to_string(),
                entity: entity.to_string(),
            },
            DbOperation::List => {
                if parts.len() == 1 || parts.get(1).unwrap_or(&empty_str).is_empty() {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.org_meta_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "scan".to_string(),
                        entity: entity.to_string(),
                    }
                } else {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.org_meta_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "query".to_string(),
                        entity: entity.to_string(),
                    }
                }
            }
        },
        "schema" => match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => DynamoTableDetails {
                pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                rk_value: format!(
                    "{}/{}/{}",
                    parts[0],
                    parts.get(2).unwrap_or(&empty_str),
                    parts.get(3).unwrap_or(&empty_str)
                ),
                name: CONFIG.dynamo.schema_table.clone(),
                pk: "org".to_string(),
                rk: "key".to_string(),
                operation: "query".to_string(),
                entity: entity.to_string(),
            },
            DbOperation::List => {
                if parts.len() == 1 || parts.get(1).unwrap_or(&empty_str).is_empty() {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.schema_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "scan".to_string(),
                        entity: entity.to_string(),
                    }
                } else {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.schema_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "query".to_string(),
                        entity: entity.to_string(),
                    }
                }
            }
        },
        "dashboard" => match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => DynamoTableDetails {
                pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                rk_value: format!(
                    "{}/{}/{}",
                    parts[0],
                    parts.get(2).unwrap_or(&empty_str),
                    parts.get(3).unwrap_or(&empty_str)
                ),
                name: CONFIG.dynamo.org_meta_table.clone(),
                pk: "org".to_string(),
                rk: "key".to_string(),
                operation: "query".to_string(),
                entity: entity.to_string(),
            },
            DbOperation::List => {
                if parts.len() == 1 || parts.get(1).unwrap_or(&empty_str).is_empty() {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.org_meta_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "scan".to_string(),
                        entity: entity.to_string(),
                    }
                } else {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: format!("{}/{}", parts[0], parts.get(2).unwrap_or(&empty_str)),
                        name: CONFIG.dynamo.org_meta_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "query".to_string(),
                        entity: entity.to_string(),
                    }
                }
            }
        },
        "compact" => match operation {
            DbOperation::Get | DbOperation::Put | DbOperation::Delete => {
                parts.swap(1, 2);
                let rk_value = if local_key.starts_with("compact/organization/") {
                    format!("{}/{}", parts[0], parts.get(2).unwrap_or(&empty_str))
                } else if local_key.starts_with("compact/delete/") {
                    format!(
                        "{}/{}/{}/{}/{}",
                        parts[0],
                        parts.get(2).unwrap_or(&empty_str),
                        parts.get(3).unwrap_or(&empty_str),
                        parts.get(4).unwrap_or(&empty_str),
                        parts.get(5).unwrap_or(&empty_str)
                    )
                } else {
                    format!(
                        "{}/{}/{}",
                        parts[0],
                        parts.get(2).unwrap_or(&empty_str),
                        parts.get(3).unwrap_or(&empty_str)
                    )
                };

                DynamoTableDetails {
                    pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                    rk_value,
                    name: CONFIG.dynamo.compact_table.clone(),
                    pk: "org".to_string(),
                    rk: "key".to_string(),
                    operation: "query".to_string(),
                    entity: entity.to_string(),
                }
            }
            DbOperation::List => {
                let rk_value = if local_key.eq("compact/delete/") {
                    local_key.to_string()
                } else {
                    parts[0].to_string()
                };
                if parts.len() == 1
                    || parts.get(1).unwrap_or(&empty_str).is_empty()
                    || local_key.eq("compact/delete/")
                {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value,
                        name: CONFIG.dynamo.compact_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "scan".to_string(),
                        entity: entity.to_string(),
                    }
                } else {
                    DynamoTableDetails {
                        pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
                        rk_value: parts[0].to_string(),
                        name: CONFIG.dynamo.compact_table.clone(),
                        pk: "org".to_string(),
                        rk: "key".to_string(),
                        operation: "query".to_string(),
                        entity: entity.to_string(),
                    }
                }
            }
        },

        _ => DynamoTableDetails {
            pk_value: parts.get(1).unwrap_or(&empty_str).to_string(),
            rk_value: parts[0].to_string(),
            name: CONFIG.dynamo.org_meta_table.clone(),
            pk: "org".to_string(),
            rk: "key".to_string(),
            operation: "query".to_string(),
            entity: entity.to_string(),
        },
    }
}

pub async fn create_table() -> Result<()> {
    create_table_inner(&CONFIG.dynamo.org_meta_table, "org", "key")
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    create_table_inner(&CONFIG.dynamo.meta_table, "type", "key")
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    create_table_inner(&CONFIG.dynamo.schema_table, "org", "key")
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    create_table_inner(&CONFIG.dynamo.compact_table, "org", "key")
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    Ok(())
}

async fn create_table_inner(
    table_name: &str,
    hash_key: &str,
    range_key: &str,
) -> std::result::Result<(), aws_sdk_dynamodb::Error> {
    let client = get_db_client().await.clone();
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
