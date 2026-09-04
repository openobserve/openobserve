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

//! Queue backend selection.
//!
//! Unlike [`crate::meta::meta_store::MetaStore`], parsing is strict: an
//! unknown `ZO_QUEUE_STORE` value is a configuration error instead of a
//! silent fallback to another backend.

use std::{fmt, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueStore {
    Nats,
    Memory,
}

impl TryFrom<&str> for QueueStore {
    type Error = String;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s.to_lowercase().as_str() {
            "nats" => Ok(Self::Nats),
            "memory" => Ok(Self::Memory),
            _ => Err(format!(
                "invalid queue store: {s}, valid values are: nats, memory"
            )),
        }
    }
}

impl FromStr for QueueStore {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::try_from(s)
    }
}

impl fmt::Display for QueueStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Nats => write!(f, "nats"),
            Self::Memory => write!(f, "memory"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_values() {
        assert_eq!(QueueStore::try_from("nats"), Ok(QueueStore::Nats));
        assert_eq!(QueueStore::try_from("NATS"), Ok(QueueStore::Nats));
        assert_eq!(QueueStore::try_from("memory"), Ok(QueueStore::Memory));
        assert_eq!(QueueStore::try_from("Memory"), Ok(QueueStore::Memory));
    }

    #[test]
    fn test_parse_invalid_values_fail() {
        assert!(QueueStore::try_from("").is_err());
        assert!(QueueStore::try_from("sqlite").is_err());
        assert!(QueueStore::try_from("postgres").is_err());
        assert!(QueueStore::try_from("natsx").is_err());
        assert!(QueueStore::try_from("mem").is_err());
    }

    #[test]
    fn test_from_str() {
        assert_eq!("nats".parse::<QueueStore>(), Ok(QueueStore::Nats));
        assert_eq!("memory".parse::<QueueStore>(), Ok(QueueStore::Memory));
        assert!("unknown".parse::<QueueStore>().is_err());
    }

    #[test]
    fn test_display() {
        assert_eq!(QueueStore::Nats.to_string(), "nats");
        assert_eq!(QueueStore::Memory.to_string(), "memory");
    }
}
