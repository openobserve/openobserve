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

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MetaStore {
    Sled,
    Sqlite,
    Etcd,
    DynamoDB,
    PostgreSQL,
}

impl From<&str> for MetaStore {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "sled" => MetaStore::Sled,
            "sqlite" => MetaStore::Sqlite,
            "etcd" => MetaStore::Etcd,
            "dynamo" | "dynamodb" => MetaStore::DynamoDB,
            "postgres" | "postgresql" => MetaStore::PostgreSQL,
            _ => MetaStore::Sqlite,
        }
    }
}

impl From<String> for MetaStore {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "sled" => MetaStore::Sled,
            "sqlite" => MetaStore::Sqlite,
            "etcd" => MetaStore::Etcd,
            "dynamo" | "dynamodb" => MetaStore::DynamoDB,
            "postgres" | "postgresql" => MetaStore::PostgreSQL,
            _ => MetaStore::Sqlite,
        }
    }
}

impl std::fmt::Display for MetaStore {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            MetaStore::Sled => write!(f, "sled"),
            MetaStore::Sqlite => write!(f, "sqlite"),
            MetaStore::Etcd => write!(f, "etcd"),
            MetaStore::DynamoDB => write!(f, "dynamodb"),
            MetaStore::PostgreSQL => write!(f, "postgresql"),
        }
    }
}
