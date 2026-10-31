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

use serde::Serialize;
use strum::{EnumIter, EnumString, IntoEnumIterator, IntoStaticStr};

/// Product features as tags; the snake_case name is the gate-definition and license key.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, EnumString, IntoStaticStr, Serialize, EnumIter,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[repr(u64)]
pub enum Feature {
    AiObservability,
    AiAssistant,
    Workflows,
    Oncall,
    Incidents,
    Logs,
    Metrics,
    Traces,
    Rum,
    ProductAnalytics,
    Synthetics,
    DbMonitoring,
    Correlation,
    Dashboards,
    Reports,
    Alerts,
    Pipelines,
    AiToolsets,
    Mcp,
    Ratelimit,
    AnomalyDetection,
    ContinuousProfiling,
    KubernetesMonitoring,
    HostMonitoring,
    Sso,
    Rbac,
    AuditTrail,
    QueryManagement,
    SuperCluster,
    Byob,
}

impl Feature {
    /// Key of this feature in the entitlement set.
    #[inline]
    pub const fn index(self) -> u64 {
        self as u64
    }

    pub fn all() -> impl Iterator<Item = Feature> {
        <Self as IntoEnumIterator>::iter()
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FeatureState {
    Enabled,
    Locked,
    Hidden,
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, str::FromStr};

    use super::*;

    #[test]
    fn keys_round_trip() {
        for (key, f) in [
            ("ai_assistant", Feature::AiAssistant),
            ("oncall", Feature::Oncall),
            ("product_analytics", Feature::ProductAnalytics),
            ("correlation", Feature::Correlation),
            ("rbac", Feature::Rbac),
            ("byob", Feature::Byob),
        ] {
            assert_eq!(Feature::from_str(key).unwrap(), f);
            assert_eq!(<&str>::from(f), key);
        }
        assert!(Feature::from_str("ai").is_err());
        assert!(Feature::from_str("all").is_err());
        assert!(Feature::from_str("rum_source_maps").is_err());
        assert!(Feature::from_str("downtimes").is_err());
    }

    #[test]
    fn indices_are_unique() {
        let indices: HashSet<u64> = Feature::all().map(Feature::index).collect();
        assert_eq!(indices.len(), Feature::all().count());
        assert_eq!(Feature::all().count(), 30);
    }
}
