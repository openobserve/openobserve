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

pub mod distributed_plan;
pub mod exec;
pub mod merge;
pub mod optimizer;
pub mod peak_memory_pool;
pub mod plan;
pub mod planner;
pub mod storage;
pub mod table_provider;
pub mod udaf;
pub mod udf;

#[derive(PartialEq, Debug)]
pub enum MemoryPoolType {
    Greedy,
    Fair,
    None,
}

impl FromStr for MemoryPoolType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "greedy" | "" => Ok(MemoryPoolType::Greedy),
            "fair" => Ok(MemoryPoolType::Fair),
            "none" | "off" => Ok(MemoryPoolType::None),
            _ => Err(format!("Invalid memory pool type '{s}'")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_pool_type_from_str_greedy() {
        assert_eq!(
            "greedy".parse::<MemoryPoolType>(),
            Ok(MemoryPoolType::Greedy)
        );
        assert_eq!(
            "GREEDY".parse::<MemoryPoolType>(),
            Ok(MemoryPoolType::Greedy)
        );
        assert_eq!("".parse::<MemoryPoolType>(), Ok(MemoryPoolType::Greedy));
    }

    #[test]
    fn test_memory_pool_type_from_str_fair() {
        assert_eq!("fair".parse::<MemoryPoolType>(), Ok(MemoryPoolType::Fair));
        assert_eq!("FAIR".parse::<MemoryPoolType>(), Ok(MemoryPoolType::Fair));
    }

    #[test]
    fn test_memory_pool_type_from_str_none() {
        assert_eq!("none".parse::<MemoryPoolType>(), Ok(MemoryPoolType::None));
        assert_eq!("off".parse::<MemoryPoolType>(), Ok(MemoryPoolType::None));
        assert_eq!("OFF".parse::<MemoryPoolType>(), Ok(MemoryPoolType::None));
    }

    #[test]
    fn test_memory_pool_type_from_str_invalid() {
        assert!("unknown".parse::<MemoryPoolType>().is_err());
        assert!("pool".parse::<MemoryPoolType>().is_err());
    }
}
