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

#![cfg(feature = "enterprise")]

use config::meta::user::UserRole;
use o2_enterprise::enterprise::license::{
    License, TEST_STATICS_LOCK, block_feature_for_report_failure, last_reported_timestamp,
    replace_license_for_tests, set_last_reported_timestamp_for_tests,
};
use openobserve_core::{
    auth::AuthExtractor,
    authz::{check_permissions, rbac_enforced},
    background_access,
};

const DAY_MICROS: i64 = 86_400_000_000;

fn report_grace_license(now: i64, active: bool) -> License {
    serde_json::from_value(serde_json::json!({
        "version":2,"license_id":"grace-authz","installation_id":"*","active":true,
        "created_at":now-1_000_000,"expires_at":now+DAY_MICROS,"msv":"0.0.0",
        "company":"Test Co","address":"1 Test Way","contact_name":"Test User",
        "contact_email":"test@example.com","additional_emails":[],"base_urls":[],
        "limits":{"Ingestion":{"typ":"PerDayCount","value":100}},"company_id":"test",
        "environment_type":"online","limit_breach_allowed_count":0,
        "allow_search_after_limit_exceeded":false,"validator_url":"","validator_auth":"",
        "no_usage_report_allowed_duration":1,
        "waivers":[{"id":"g","type":"report_grace","starts_at":now-3_600_000_000i64,
            "ends_at":if active {now+3_600_000_000i64} else {now-1}}]
    }))
    .unwrap()
}

#[tokio::test]
async fn rbac_stays_enforced_when_usage_reporting_fails() {
    // SAFETY: this binary holds only this test, so no other thread reads the environment
    unsafe {
        std::env::set_var("O2_OPENFGA_ENABLED", "true");
        std::env::set_var("O2_OPENFGA_BASE_URL", "http://127.0.0.1:1/stores");
    }
    o2_openfga::config::refresh_config().unwrap();
    assert!(o2_openfga::config::get_config().enabled);
    let statics = TEST_STATICS_LOCK.lock().await;
    let now = chrono::Utc::now().timestamp_micros();
    set_last_reported_timestamp_for_tests(&statics, now - 8 * DAY_MICROS);
    assert!(block_feature_for_report_failure().await);
    assert!(last_reported_timestamp().await > 0);

    assert!(rbac_enforced().await);
    assert!(background_access::rbac_enforced().await);
    let viewer_read = AuthExtractor {
        auth: String::new(),
        method: "GET".to_string(),
        o2_type: "stream:rbac_report_failure".to_string(),
        org_id: "default".to_string(),
        bypass_check: false,
        parent_id: String::new(),
        use_all_org: false,
        use_self_context: false,
        use_self_parent: false,
        feature: None,
    };
    assert!(
        !check_permissions(
            "viewer@rbac.test",
            viewer_read.clone(),
            UserRole::Viewer,
            false
        )
        .await
    );

    for active in [true, false] {
        let grace = report_grace_license(now, active);
        replace_license_for_tests(&statics, Some(("grace".into(), grace))).await;
        assert_eq!(block_feature_for_report_failure().await, !active);
        assert!(
            !check_permissions(
                "viewer@rbac.test",
                viewer_read.clone(),
                UserRole::Viewer,
                false
            )
            .await,
            "report grace active: {active}"
        );
    }
}
