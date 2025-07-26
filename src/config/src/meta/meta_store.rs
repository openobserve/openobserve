// Copyright 2025 OpenObserve Inc.
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

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MetaStore {
    Sqlite,
    Etcd,
    Nats,
    MySQL,
    PostgreSQL,
}

impl From<&str> for MetaStore {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "sqlite" => Self::Sqlite,
            "etcd" => Self::Etcd,
            "nats" => Self::Nats,
            "mysql" => Self::MySQL,
            "postgres" | "postgresql" => Self::PostgreSQL,
            _ => Self::Sqlite,
        }
    }
}

impl From<String> for MetaStore {
    fn from(s: String) -> Self {
        Self::from(s.as_str())
    }
}

impl std::fmt::Display for MetaStore {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::Sqlite => write!(f, "sqlite"),
            Self::Etcd => write!(f, "etcd"),
            Self::Nats => write!(f, "nats"),
            Self::MySQL => write!(f, "mysql"),
            Self::PostgreSQL => write!(f, "postgresql"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metastore_from_str() {
        assert_eq!(MetaStore::from("sqlite"), MetaStore::Sqlite);
        assert_eq!(MetaStore::from("etcd"), MetaStore::Etcd);
        assert_eq!(MetaStore::from("nats"), MetaStore::Nats);
        assert_eq!(MetaStore::from("mysql"), MetaStore::MySQL);
        assert_eq!(MetaStore::from("postgres"), MetaStore::PostgreSQL);
        assert_eq!(MetaStore::from("postgresql"), MetaStore::PostgreSQL);

        // Case insensitive
        assert_eq!(MetaStore::from("SQLITE"), MetaStore::Sqlite);
        assert_eq!(MetaStore::from("ETCD"), MetaStore::Etcd);

        // Unknown values default to Sqlite
        assert_eq!(MetaStore::from("unknown"), MetaStore::Sqlite);
    }

    #[test]
    fn test_metastore_from_string() {
        assert_eq!(MetaStore::from("sqlite".to_string()), MetaStore::Sqlite);
        assert_eq!(MetaStore::from("etcd".to_string()), MetaStore::Etcd);
    }

    #[test]
    fn test_metastore_display() {
        assert_eq!(MetaStore::Sqlite.to_string(), "sqlite");
        assert_eq!(MetaStore::Etcd.to_string(), "etcd");
        assert_eq!(MetaStore::Nats.to_string(), "nats");
        assert_eq!(MetaStore::MySQL.to_string(), "mysql");
        assert_eq!(MetaStore::PostgreSQL.to_string(), "postgresql");
    }

    #[test]
    fn test_metastore_equality() {
        assert_eq!(MetaStore::Sqlite, MetaStore::Sqlite);
        assert_ne!(MetaStore::Sqlite, MetaStore::Etcd);
    }

    #[test]
    fn test_metastore_serialization() {
        let metastore = MetaStore::Etcd;
        let serialized = serde_json::to_string(&metastore).unwrap();
        assert_eq!(serialized, "\"etcd\"");

        let deserialized: MetaStore = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized, MetaStore::Etcd);
    }
}
