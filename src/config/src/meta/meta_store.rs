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

use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum MetaStore {
    Sqlite,
    Nats,
    PostgreSQL,
}

impl FromStr for MetaStore {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let lowered = s.to_lowercase();
        match lowered.as_str() {
            "sqlite" => Ok(Self::Sqlite),
            "nats" => Ok(Self::Nats),
            "postgres" | "postgresql" => Ok(Self::PostgreSQL),
            // backends this enum shipped and dropped: their operators need migration advice
            _ if lowered.starts_with("mysql") || lowered.starts_with("etcd") => Err(format!(
                "invalid value: {}, this backend is no longer supported; valid values are: \
                 sqlite, nats, postgres, postgresql",
                redacted(s)
            )),
            _ => Err(format!(
                "invalid value: {}, valid values are: sqlite, nats, postgres, postgresql",
                redacted(s)
            )),
        }
    }
}

// both env vars parsed into this are rejected at startup, so callers never hit the fallback
impl From<&str> for MetaStore {
    fn from(s: &str) -> Self {
        s.parse().unwrap_or(Self::Sqlite)
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
            Self::Nats => write!(f, "nats"),
            Self::PostgreSQL => write!(f, "postgresql"),
        }
    }
}

/// A DSN-shaped value carries a password, and this reaches stderr and crash reports.
fn redacted(s: &str) -> &str {
    s.split("://").next().unwrap_or(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metastore_from_str() {
        assert_eq!(MetaStore::from("sqlite"), MetaStore::Sqlite);
        assert_eq!(MetaStore::from("nats"), MetaStore::Nats);
        assert_eq!(MetaStore::from("postgres"), MetaStore::PostgreSQL);
        assert_eq!(MetaStore::from("postgresql"), MetaStore::PostgreSQL);

        // Case insensitive
        assert_eq!(MetaStore::from("SQLITE"), MetaStore::Sqlite);

        // Unknown values default to Sqlite
        assert_eq!(MetaStore::from("unknown"), MetaStore::Sqlite);
    }

    #[test]
    fn test_metastore_from_string() {
        assert_eq!(MetaStore::from("sqlite".to_string()), MetaStore::Sqlite);
    }

    #[test]
    fn test_metastore_display() {
        assert_eq!(MetaStore::Sqlite.to_string(), "sqlite");
        assert_eq!(MetaStore::Nats.to_string(), "nats");
        assert_eq!(MetaStore::PostgreSQL.to_string(), "postgresql");
    }

    #[test]
    fn test_metastore_serialization() {
        let metastore = MetaStore::Nats;
        let serialized = serde_json::to_string(&metastore).unwrap();
        assert_eq!(serialized, "\"nats\"");

        let deserialized: MetaStore = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized, MetaStore::Nats);
    }

    #[test]
    fn test_metastore_all_variants_serde_roundtrip() {
        for variant in [MetaStore::Sqlite, MetaStore::Nats, MetaStore::PostgreSQL] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: MetaStore = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_metastore_parse_supported_values() {
        assert_eq!("sqlite".parse::<MetaStore>(), Ok(MetaStore::Sqlite));
        assert_eq!("nats".parse::<MetaStore>(), Ok(MetaStore::Nats));
        assert_eq!("postgres".parse::<MetaStore>(), Ok(MetaStore::PostgreSQL));
        assert_eq!("postgresql".parse::<MetaStore>(), Ok(MetaStore::PostgreSQL));
        assert_eq!("SQLITE".parse::<MetaStore>(), Ok(MetaStore::Sqlite));
        assert_eq!("PostgreSQL".parse::<MetaStore>(), Ok(MetaStore::PostgreSQL));
    }

    #[test]
    fn test_metastore_parse_rejects_mysql_with_removal_notice() {
        for value in [
            "mysql",
            "MySQL",
            "mysql://user:pass@localhost:3306/openobserve",
        ] {
            let err = value.parse::<MetaStore>().unwrap_err();
            assert!(
                err.to_lowercase().contains("mysql"),
                "error must name the offending scheme {value}: {err}"
            );
            assert!(
                !err.contains("pass"),
                "a DSN password must never reach the startup error: {err}"
            );
            assert!(
                err.contains("no longer supported"),
                "error must state MySQL is no longer supported: {err}"
            );
        }
    }

    #[test]
    fn test_metastore_parse_rejects_etcd_with_removal_notice() {
        for value in ["etcd", "ETCD", "etcd://localhost:2379"] {
            let err = value.parse::<MetaStore>().unwrap_err();
            assert!(
                err.to_lowercase().contains("etcd"),
                "error must name the offending scheme {value}: {err}"
            );
            assert!(
                err.contains("no longer supported"),
                "error must state etcd is no longer supported: {err}"
            );
        }
    }

    #[test]
    fn test_metastore_parse_rejects_unknown_values() {
        for value in ["mongodb", "sqllite", "postgre"] {
            let err = value.parse::<MetaStore>().unwrap_err();
            assert!(
                err.contains(value),
                "error must name the offending value {value}: {err}"
            );
            assert!(
                !err.contains("no longer supported"),
                "a plain unknown value must not claim a removed backend: {err}"
            );
        }
    }

    #[test]
    fn test_metastore_parse_rejects_empty_value() {
        let err = "".parse::<MetaStore>().unwrap_err();
        assert!(
            err.contains("sqlite, nats, postgres, postgresql"),
            "an empty value must still list the supported stores: {err}"
        );
        assert!(
            !err.contains("no longer supported"),
            "an empty value must not claim a removed backend: {err}"
        );
    }

    #[test]
    fn test_metastore_parse_error_quotes_the_value_as_typed() {
        for value in ["MongoDB", "SqlLite", "MySQL", "ETCD"] {
            let err = value.parse::<MetaStore>().unwrap_err();
            assert!(
                err.contains(value),
                "error must quote what the operator typed, not a lowercased copy: {err}"
            );
        }
    }

    #[test]
    fn test_metastore_from_str_uppercase_postgres() {
        assert_eq!(MetaStore::from("POSTGRES"), MetaStore::PostgreSQL);
        assert_eq!(MetaStore::from("POSTGRESQL"), MetaStore::PostgreSQL);
        assert_eq!(MetaStore::from("NATS"), MetaStore::Nats);
    }
}
