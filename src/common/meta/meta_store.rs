use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MetaStore {
    Sled,
    Etcd,
    DynamoDB,
}

impl From<&str> for MetaStore {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "sled" => MetaStore::Sled,
            "etcd" => MetaStore::Etcd,
            "dynamodb" => MetaStore::DynamoDB,
            _ => MetaStore::Sled,
        }
    }
}

impl From<String> for MetaStore {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "sled" => MetaStore::Sled,
            "etcd" => MetaStore::Etcd,
            "dynamodb" => MetaStore::DynamoDB,
            _ => MetaStore::Sled,
        }
    }
}

impl std::fmt::Display for MetaStore {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            MetaStore::Sled => write!(f, "sled"),
            MetaStore::Etcd => write!(f, "etcd"),
            MetaStore::DynamoDB => write!(f, "dynamodb"),
        }
    }
}
