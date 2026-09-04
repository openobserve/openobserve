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

use std::{fmt::Display, str::FromStr};

// define the organizations type
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum OrganizationType {
    Default,
    Custom,
    UserDefault,
}

impl From<OrganizationType> for i16 {
    fn from(org: OrganizationType) -> i16 {
        match org {
            OrganizationType::Default => 0,
            OrganizationType::Custom => 1,
            OrganizationType::UserDefault => 2,
        }
    }
}

impl From<i16> for OrganizationType {
    fn from(org: i16) -> Self {
        match org {
            0 => OrganizationType::Default,
            1 => OrganizationType::Custom,
            2 => OrganizationType::UserDefault,
            _ => OrganizationType::Custom,
        }
    }
}

impl FromStr for OrganizationType {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "default" => Ok(OrganizationType::Default),
            "custom" => Ok(OrganizationType::Custom),
            "user_default" => Ok(OrganizationType::UserDefault),
            _ => Ok(OrganizationType::Custom),
        }
    }
}

impl Display for OrganizationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrganizationType::Default => write!(f, "default"),
            OrganizationType::Custom => write!(f, "custom"),
            OrganizationType::UserDefault => write!(f, "user_default"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    #[test]
    fn test_organization_type_to_i16() {
        assert_eq!(i16::from(OrganizationType::Default), 0);
        assert_eq!(i16::from(OrganizationType::Custom), 1);
        assert_eq!(i16::from(OrganizationType::UserDefault), 2);
    }

    #[test]
    fn test_organization_type_from_i16() {
        assert_eq!(OrganizationType::from(0i16), OrganizationType::Default);
        assert_eq!(OrganizationType::from(1i16), OrganizationType::Custom);
        assert_eq!(OrganizationType::from(2i16), OrganizationType::UserDefault);
        // unknown value falls back to Custom
        assert_eq!(OrganizationType::from(99i16), OrganizationType::Custom);
        assert_eq!(OrganizationType::from(-1i16), OrganizationType::Custom);
    }

    #[test]
    fn test_organization_type_from_str() {
        assert_eq!(
            OrganizationType::from_str("default").unwrap(),
            OrganizationType::Default
        );
        assert_eq!(
            OrganizationType::from_str("custom").unwrap(),
            OrganizationType::Custom
        );
        assert_eq!(
            OrganizationType::from_str("user_default").unwrap(),
            OrganizationType::UserDefault
        );
        // unknown falls back to Custom
        assert_eq!(
            OrganizationType::from_str("unknown").unwrap(),
            OrganizationType::Custom
        );
        assert_eq!(
            OrganizationType::from_str("").unwrap(),
            OrganizationType::Custom
        );
    }

    #[test]
    fn test_organization_type_display() {
        assert_eq!(OrganizationType::Default.to_string(), "default");
        assert_eq!(OrganizationType::Custom.to_string(), "custom");
        assert_eq!(OrganizationType::UserDefault.to_string(), "user_default");
    }

    #[test]
    fn test_organization_type_display_roundtrip_with_from_str() {
        for variant in [
            OrganizationType::Default,
            OrganizationType::Custom,
            OrganizationType::UserDefault,
        ] {
            let s = variant.to_string();
            let parsed = OrganizationType::from_str(&s).unwrap();
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn test_organization_type_i16_roundtrip() {
        for variant in [
            OrganizationType::Default,
            OrganizationType::Custom,
            OrganizationType::UserDefault,
        ] {
            let n = i16::from(variant);
            let back = OrganizationType::from(n);
            assert_eq!(back, variant);
        }
    }
}
