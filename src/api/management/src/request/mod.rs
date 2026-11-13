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

#[cfg(feature = "enterprise")]
pub mod ai;
#[cfg(feature = "enterprise")]
pub mod alert_calibration;
#[cfg(feature = "enterprise")]
pub(crate) mod alert_grants;
pub mod alerts;
#[cfg(feature = "enterprise")]
pub mod annotation_queues;
#[cfg(feature = "enterprise")]
pub mod annotations;
pub mod announcements;
#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
pub mod authz;
#[cfg(feature = "enterprise")]
pub mod autoobserve;
#[cfg(feature = "cloud")]
pub mod cloud;
pub mod dashboards;
#[cfg(feature = "enterprise")]
pub mod datasets;
pub mod db_monitoring;
#[cfg(feature = "enterprise")]
pub mod discovery;
#[cfg(feature = "enterprise")]
pub mod domain_management;
pub mod downtimes;
#[cfg(feature = "enterprise")]
pub mod eval_jobs;
#[cfg(feature = "enterprise")]
pub mod experiments;
pub mod fleet;
#[allow(deprecated)]
pub mod folders;
pub mod gen_ai;
pub mod gen_ai_health;
pub mod ingest_rejections;
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod metrics_usage;
pub mod model_pricing;
pub mod oncall;
pub mod organization;
#[cfg(feature = "enterprise")]
pub mod password_policy;
#[cfg(feature = "enterprise")]
pub mod playground;
#[cfg(feature = "cpu-profiling")]
pub mod profiling;
#[cfg(feature = "enterprise")]
pub mod prompts;
#[cfg(feature = "enterprise")]
pub mod providers;
pub mod public_dashboards;
pub mod public_rate_limit;
#[cfg(feature = "enterprise")]
pub mod quality;
pub mod query_history;
#[cfg(feature = "enterprise")]
pub mod remote_tasks;
pub mod rum_analytics;
pub mod sample_data;
#[cfg(feature = "enterprise")]
pub mod score_configs;
#[cfg(feature = "enterprise")]
pub mod scorers;
pub mod security;
pub mod service_accounts;
pub mod service_identity;
pub mod service_streams;
pub mod service_versions;
pub mod short_url;
pub mod slack;
pub mod slos;
pub mod sourcemaps;
pub mod status;
pub mod status_pages;
pub mod stream;
pub mod synthetics;
pub mod users;
#[cfg(feature = "enterprise")]
pub mod workflows;

#[cfg(feature = "cloud")]
pub mod org_domains;

use openobserve_api_common::request::{BulkDeleteRequest, BulkDeleteResponse};
#[cfg(feature = "enterprise")]
use {axum::http::StatusCode, o2_enterprise::enterprise::common::auditor::AuditMessage};

#[cfg(feature = "enterprise")]
#[derive(Clone, Copy)]
pub(super) enum LoginFailure {
    InvalidCredentials,
    AccountLocked,
    InvalidLoginLink,
    LoginLinkExpired,
    InvalidLoginState,
    TokenExchangeFailed,
    TokenValidationFailed,
    LoginPolicyDenied,
}

#[cfg(feature = "enterprise")]
impl LoginFailure {
    fn prepare(
        self,
        mut message: AuditMessage,
        status: StatusCode,
        timestamp: i64,
    ) -> AuditMessage {
        let reason = match self {
            Self::InvalidCredentials => "invalid_credentials",
            Self::AccountLocked => "account_locked",
            Self::InvalidLoginLink => "invalid_login_link",
            Self::LoginLinkExpired => "login_link_expired",
            Self::InvalidLoginState => "invalid_login_state",
            Self::TokenExchangeFailed => "token_exchange_failed",
            Self::TokenValidationFailed => "token_validation_failed",
            Self::LoginPolicyDenied => "login_policy_denied",
        };
        message._timestamp = timestamp;
        message.response_meta.http_response_code = status.as_u16();
        message.response_meta.error_msg = Some(reason.to_string());
        message
    }
}

#[cfg(feature = "enterprise")]
async fn audit_login_failure(message: AuditMessage, failure: LoginFailure, status: StatusCode) {
    audit::audit(failure.prepare(message, status, config::utils::time::now_micros())).await;
}
