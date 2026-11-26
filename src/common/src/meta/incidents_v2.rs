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

//! The Incidents v2 switch as OSS code reads it, and the response a v2 route sends while it is off.

use axum::response::Response;

use crate::meta::http::HttpResponse as MetaHttpResponse;

pub const INCIDENTS_V2_OFF_MESSAGE: &str = "Incidents v2 is off on this deployment";

#[cfg(feature = "enterprise")]
#[derive(Debug, Clone, Copy)]
pub struct RecoverySettings {
    pub max_held_watches_per_org: usize,
    pub grid_secs: i64,
    pub held_interval_secs: i64,
    pub query_timeout_secs: i64,
    pub window_secs: i64,
    pub permission_cache_secs: i64,
    pub expect_effect_secs: i32,
    pub relapse_secs: i32,
    pub deadline_secs: i64,
    pub pass_window_cap_secs: i64,
    pub soak_floor_secs: i32,
    pub soak_cap_secs: i32,
}

/// The only switch OSS code reads; the rule (and its super-cluster guard) lives in ENT config.
#[cfg(feature = "enterprise")]
pub fn incidents_v2_enabled() -> bool {
    o2_enterprise::enterprise::common::config::incidents_v2_enabled()
}

/// The only switch OSS code reads; a build without `enterprise` has no Incidents v2.
#[cfg(not(feature = "enterprise"))]
pub fn incidents_v2_enabled() -> bool {
    false
}

/// The 409 every v2 route returns while [`incidents_v2_enabled`] is false.
pub fn incidents_v2_off_response() -> Response {
    MetaHttpResponse::conflict(INCIDENTS_V2_OFF_MESSAGE)
}

#[cfg(feature = "enterprise")]
pub fn recovery_max_checks_per_org() -> usize {
    o2_enterprise::enterprise::common::config::get_config()
        .incidents
        .recovery_max_checks_per_org
}

#[cfg(feature = "enterprise")]
pub fn recovery_settings() -> RecoverySettings {
    let cfg = o2_enterprise::enterprise::common::config::get_config();
    let incidents = &cfg.incidents;
    RecoverySettings {
        max_held_watches_per_org: incidents.recovery_max_held_watches_per_org,
        grid_secs: incidents.recovery_grid_secs.into(),
        held_interval_secs: incidents.recovery_held_interval_secs.into(),
        query_timeout_secs: incidents.recovery_query_timeout_secs.into(),
        window_secs: incidents.recovery_window_secs.into(),
        permission_cache_secs: incidents.recovery_permission_cache_secs.into(),
        expect_effect_secs: incidents.recovery_expect_effect_secs,
        relapse_secs: incidents.recovery_relapse_secs,
        deadline_secs: incidents.recovery_deadline_secs.into(),
        pass_window_cap_secs: incidents.recovery_pass_window_cap_secs.into(),
        soak_floor_secs: incidents.recovery_soak_floor_secs,
        soak_cap_secs: incidents.recovery_soak_cap_secs,
    }
}

#[cfg(feature = "enterprise")]
pub fn recovery_is_unlicensed() -> bool {
    o2_enterprise::enterprise::common::config::incidents_v2_is_unlicensed()
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode};

    use super::*;

    #[cfg(not(feature = "enterprise"))]
    #[test]
    fn test_incidents_v2_is_off_without_enterprise() {
        assert!(!incidents_v2_enabled());
    }

    #[tokio::test]
    async fn test_incidents_v2_off_response_is_409_with_the_exact_text() {
        let response = incidents_v2_off_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: MetaHttpResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.code, StatusCode::CONFLICT.as_u16());
        assert_eq!(body.message, "Incidents v2 is off on this deployment");
    }
}
