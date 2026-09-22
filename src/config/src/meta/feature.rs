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

use serde::{Deserialize, Deserializer, Serialize};
use strum::{EnumString, IntoStaticStr};

/// License-gated enterprise features, one bit each; the snake_case name is the license key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, EnumString, IntoStaticStr, Serialize)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[repr(u64)]
pub enum Feature {
    /// Every bit set, so it also matches features added after the license was issued.
    All = u64::MAX,
    Ai = 1 << 0,
    Incidents = 1 << 1,
    Oncall = 1 << 2,
    Workflows = 1 << 3,
}

// unknown keys are dropped so a newer license still loads on an older binary
pub fn deserialize_list<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<Feature>>, D::Error> {
    Ok(Option::<Vec<String>>::deserialize(d)?
        .map(|keys| keys.iter().filter_map(|k| k.parse().ok()).collect()))
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    #[derive(Deserialize)]
    struct Holder {
        #[serde(default, deserialize_with = "deserialize_list")]
        features: Option<Vec<Feature>>,
    }

    fn parse(json: &str) -> Option<Vec<Feature>> {
        serde_json::from_str::<Holder>(json).unwrap().features
    }

    #[test]
    fn deserialize_list_matrix() {
        assert_eq!(parse("{}"), None);
        assert_eq!(parse(r#"{"features":["all"]}"#), Some(vec![Feature::All]));
        assert_eq!(
            parse(r#"{"features":["ai","oncall"]}"#),
            Some(vec![Feature::Ai, Feature::Oncall])
        );
        assert_eq!(parse(r#"{"features":[]}"#), Some(vec![]));
        assert_eq!(
            parse(r#"{"features":["ai","future_thing"]}"#),
            Some(vec![Feature::Ai])
        );
    }

    #[test]
    fn keys_round_trip() {
        for (key, f) in [
            ("all", Feature::All),
            ("ai", Feature::Ai),
            ("incidents", Feature::Incidents),
            ("oncall", Feature::Oncall),
            ("workflows", Feature::Workflows),
        ] {
            assert_eq!(Feature::from_str(key).unwrap(), f);
            assert_eq!(<&str>::from(f), key);
        }
        assert!(Feature::from_str("nope").is_err());
    }

    #[test]
    fn all_covers_every_bit() {
        for f in [
            Feature::Ai,
            Feature::Incidents,
            Feature::Oncall,
            Feature::Workflows,
        ] {
            assert_ne!(Feature::All as u64 & f as u64, 0);
        }
    }
}
