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
    TEST_STATICS_LOCK, block_feature_for_report_failure, last_reported_timestamp,
    set_last_reported_timestamp_for_tests,
};
use openobserve_core::{
    auth::AuthExtractor,
    authz::{check_permissions, rbac_enforced},
    background_access,
};

const DAY_MICROS: i64 = 86_400_000_000;

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
    };
    assert!(!check_permissions("viewer@rbac.test", viewer_read, UserRole::Viewer, false).await);
}
