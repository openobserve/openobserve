// Copyright 2025 OpenObserve Inc.
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
#[cfg(test)]
mod tests {
    use actix_http::Method;
    use actix_web::{FromRequest, test};
    use o2_openfga::meta::mapping::OFGA_MODELS;

    use super::super::auth::AuthExtractor;

    const API_ROOT_URI: &str = "https://test.com";
    const AUTH_HEADER_VAL: &str = "AUTH_HEADER_VAL";
    const AUTH_HEADER: (&str, &str) = ("Authorization", AUTH_HEADER_VAL);
    const ORG_ID: &str = "TEST_ORG_ID";
    const EMAIL_ID: &str = "TEST_EMAIL_ID";
    const STREAM_NAME: &str = "TEST_STREAM_NAME";
    const VIEW_ID: &str = "TEST_VIEW_ID";
    const JOB_ID: &str = "TEST_JOB_ID";
    const TRACE_ID: &str = "TEST_TRACE_ID";
    const FUNCTION_NAME: &str = "TEST_FUNCTION_NAME";
    const DASHBOARD_ID: &str = "TEST_DASHBOARD_ID";
    const REPORT_NAME: &str = "TEST_REPORT_NAME";
    const FOLDER_ID: &str = "TEST_FOLDER_ID";
    const FOLDER_NAME: &str = "TEST_FOLDER_NAME";
    const ALERT_NAME: &str = "TEST_ALERT_NAME";
    const TEMPLATE_NAME: &str = "TEST_TEMPLATE_NAME";
    const DESTINATION_NAME: &str = "TEST_DESTINATION_NAME";
    const KV_KEY: &str = "TEST_KV_KEY";
    const SYSLOG_ROUTE_ID: &str = "TEST_SYSLOG_ROUTE_ID";
    const ROLE_ID: &str = "TEST_ROLE_ID";
    const RESOURCE_NAME: &str = "TEST_RESOURCE_NAME";
    const GROUP_NAME: &str = "TEST_GROUP_NAME";
    const PIPELINE_ID: &str = "TEST_PIPELINE_ID";
    const SHORT_URL_ID: &str = "TEST_SHORT_URL_ID";
    const ACTION_KSUID: &str = "TEST_ACTION_KSUID";
    const CIPHER_KEY_ID: &str = "TEST_CIPHER_KEY_ID";

    const POST_METHOD: &str = "POST";
    const GET_METHOD: &str = "GET";
    const PUT_METHOD: &str = "PUT";
    const DELETE_METHOD: &str = "DELETE";
    const LIST_METHOD: &str = "LIST";

    // Tests for routes defined in handler::http::request::users.

    #[tokio::test]
    async fn list_users() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/users"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("user:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_user() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/users/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("user:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_user() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/users/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("user:{EMAIL_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn add_user_to_organization() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/users/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("user:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn remove_user_from_organization() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/users/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("user:{EMAIL_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::organization::org.

    #[tokio::test]
    async fn get_organizations() {
        test_auth(
            Method::GET,
            "api/organizations".to_string(),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                // In subsequent authorization steps `##user_id##` is replaced
                // with the actual user ID.
                o2_type: "org:##user_id##".to_string(),
                org_id: "organizations".to_string(), // This is expected.
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn org_summary() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/summary"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // LIST is used instead of GET because there is no resource ID
                // associated with a summary.
                method: LIST_METHOD.to_string(),
                o2_type: format!("summary:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_user_passcode() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/passcode"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // LIST is used instead of GET because there is no resource ID
                // associated with a passcode.
                method: LIST_METHOD.to_string(),
                o2_type: format!("passcode:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_user_passcode() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/passcode"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("passcode:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_user_rumtoken() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/rumtoken"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // LIST is used instead of GET because there is no resource ID
                // associated with a rumtoken.
                method: LIST_METHOD.to_string(),
                o2_type: format!("rumtoken:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_user_rumtoken() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/rumtoken"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("rumtoken:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_user_rumtoken() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/rumtoken"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("rumtoken:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // TODO: Add test for organization creation after org_cloud_singe branch is
    // merged.

    // Tests for routes defined in handler::http::request::organization::setings.

    #[tokio::test]
    async fn create_organization_settings() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/settings"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_organization_settings() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/settings"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn upload_logo() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/settings/logo"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_logo() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/settings/logo"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // In OpenFGA we treat this operation as PUT rather than DELETE.
                method: PUT_METHOD.to_string(),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn set_logo_test() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/settings/logo/text"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_logo_text() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/settings/logo/text"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Routes defined in handler::http::request::organization::es are all
    // ignored by the AuthExtractor so they are omitted from these tests.

    // Tests for routes defined in handler::http::request::stream.

    #[tokio::test]
    async fn get_schema() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/streams/STREAM_NAME/schema"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_stream_settings() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/streams/STREAM_NAME/settings"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_stream_settings() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/streams/STREAM_NAME/settings"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_stream_fields() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/streams/STREAM_NAME/delete_fields"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_stream() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/streams/STREAM_NAME"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_streams() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/streams"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                // o2_type is intentially stream:TEST_ORG_ID instead of
                // stream:STREAM_NAME because stream:TEST_ORG_ID indicates
                // permission for listing all streams that belong to the
                // organization.
                o2_type: format!("stream:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_stream_cache() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/streams/STREAM_NAME/cache/results"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Routes defined in handler::http::request::logs::ingest are all ignored by
    // AuthExtractor so they are omitted from these tests.

    // Tests for routes defined in handler::http::request::traces.

    #[tokio::test]
    async fn traces_write() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/traces"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("stream:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn otlp_traces_write() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/v1/traces"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("stream:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_latest_traces() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/STREAM_NAME/traces/latest"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Are these empty strings correct?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::metrics::ingest.

    #[tokio::test]
    async fn otlp_metrics_write() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/v1/metrics"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("stream:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn metrics_json() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/ingest/metrics/_json"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("stream:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::promql.

    #[tokio::test]
    async fn promql_remote_write() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/write"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("stream:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_query_get() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/query"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_query_post() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/query"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_query_range_get() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/query_range"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_query_range_post() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/query_range"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_query_exemplars_get() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/query_exemplars"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_query_exemplars_post() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/query_exemplars"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_metadata() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/metadata"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: "prometheus:api".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_series_get() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/series"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_series_post() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/series"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_labels_get() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/labels"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: "prometheus:api".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_labels_post() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/labels"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: "prometheus:api".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_label_values() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/label/LABEL_NAME/values"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: "prometheus:api".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_format_query_get() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/prometheus/api/v1/format_query"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn promql_format_query_post() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/prometheus/api/v1/format_query"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::enrichement_table.

    #[tokio::test]
    async fn save_enrichment_table() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/enrichment_tables/TABLE_NAME"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("enrichment_table:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::search.

    #[tokio::test]
    async fn search_stream_data() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/_search"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn search_around() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/STREAM_NAME/_around"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn search_top_n_values() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/STREAM_NAME/_values"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: "stream:STREAM_NAME".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn search_partition() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/_search_partition"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn search_history() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/_search_history"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::search::saved_view.

    #[tokio::test]
    async fn get_search_view() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/savedviews/{VIEW_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("savedviews:{VIEW_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_search_views() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/savedviews"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("savedviews:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_search_view() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/savedviews/{VIEW_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("savedviews:{VIEW_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_search_view() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/savedviews"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("savedviews:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_search_view() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/savedviews/{VIEW_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("savedviews:{VIEW_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::search::multi_streams.

    #[tokio::test]
    async fn search_multi() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/_search_multi"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn _search_partition_multi() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/_search_partition_multi"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn around_multi() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/{STREAM_NAME}/_around_multi"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("stream:{STREAM_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::search::search_job.

    #[tokio::test]
    async fn submit_job() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/search_jobs"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("search_jobs:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_job_status() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/search_jobs"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("search_jobs:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_job_status() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/search_jobs/{JOB_ID}/status"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("search_jobs:{JOB_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn cancel_job() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/search_jobs/{JOB_ID}/cancel"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("search_jobs:{JOB_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_job_result() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/search_jobs/{JOB_ID}/result"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("search_jobs:{JOB_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_job() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/search_jobs/{JOB_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("search_jobs:{JOB_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn retry_job() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/search_jobs/{JOB_ID}/retry"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("search_jobs:{JOB_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::search::job.

    #[tokio::test]
    async fn cancel_query() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/query_manager/{TRACE_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn cancel_multiple_query() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/query_manager/cancel"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn query_status() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/query_manager/status"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::functions.

    #[tokio::test]
    async fn save_function() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/functions"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("function:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_functions() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/functions"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("function:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_function() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/functions/{FUNCTION_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("function:{FUNCTION_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_function() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/functions/{FUNCTION_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("function:{FUNCTION_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_pipeline_dependencies() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/functions/{FUNCTION_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("function:{FUNCTION_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn test_function() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/functions/test"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: "function:test".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::dashboards.

    #[tokio::test]
    async fn create_dashboard_in_default_folder() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/dashboards"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: "dfolder:default".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_dashboard_in_folder() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/dashboards?folder={FOLDER_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("dfolder:{FOLDER_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: FOLDER_ID.to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_dashboard() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/dashboards/{DASHBOARD_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("dashboard:{DASHBOARD_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_dashboards_in_default_folder() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/dashboards"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: "dfolder:default".to_string(),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_dashboards_in_folder() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/dashboards?folder={FOLDER_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("dfolder:{FOLDER_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: FOLDER_ID.to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_dashboard() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/dashboards/{DASHBOARD_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("dashboard:{DASHBOARD_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_dashboard() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/dashboards/{DASHBOARD_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("dashboard:{DASHBOARD_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn move_dashboard() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/folders/dashboards/{DASHBOARD_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("dashboard:{DASHBOARD_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::dashboards::reports.

    #[tokio::test]
    async fn create_report() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/reports"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("report:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_report() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/reports/{REPORT_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("report:{REPORT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_reports() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/reports"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("report:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_report() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/reports/{REPORT_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("report:{REPORT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_report() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/reports/{REPORT_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("report:{REPORT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn enable_report() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/reports/{REPORT_NAME}/enable"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("report:{REPORT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn trigger_report() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/reports/{REPORT_NAME}/trigger"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("report:{REPORT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::folders::deprecated.

    #[tokio::test]
    async fn create_folder() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/folders"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("dfolder:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_folder() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/folders/{FOLDER_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("dfolder:{FOLDER_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_folders() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/folders"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("dfolder:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_folder() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/folders/{FOLDER_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("dfolder:{FOLDER_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_folder_by_name() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/folders/name/{FOLDER_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("dfolder:_all_{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_folder() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/folders/{FOLDER_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("dfolder:{FOLDER_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::alerts::deprecated.

    #[tokio::test]
    async fn save_alert() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("alert:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_alert() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts/{ALERT_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("alert:{ALERT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_stream_alerts() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("alert:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_alerts() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/alerts"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("alert:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_alert() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts/{ALERT_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                // Is this correct? Can two streams have the same name if they
                // have different types?
                o2_type: format!("alert:{ALERT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_alert() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts/{ALERT_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("alert:{ALERT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn enable_alert() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts/{ALERT_NAME}/enable"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("alert:{ALERT_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn trigger_alert() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/{STREAM_NAME}/alerts/{ALERT_NAME}/trigger"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                // Is this correct? This seems like a potential bug. Shouldn't
                // the first part be a type name?
                o2_type: format!("{STREAM_NAME}:alerts"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::alerts::templates.

    #[tokio::test]
    async fn save_template() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/alerts/templates"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("template:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_template() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/alerts/templates/{TEMPLATE_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("template:{TEMPLATE_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_template() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/alerts/templates/{TEMPLATE_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("template:{TEMPLATE_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_templates() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/alerts/templates"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("template:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_template() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/alerts/templates/{TEMPLATE_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("template:{TEMPLATE_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::alerts::destinations.

    #[tokio::test]
    async fn save_destination() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/alerts/destinations"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("destination:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_destination() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/alerts/destinations/{DESTINATION_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("destination:{DESTINATION_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_destination() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/alerts/destinations/{DESTINATION_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("destination:{DESTINATION_NAME}"), // Is this correct?
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_destinations() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/alerts/destinations"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("destination:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_destination() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/alerts/destinations/{DESTINATION_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("destination:{DESTINATION_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::kv.

    #[tokio::test]
    async fn get_kv() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/kv/{KV_KEY}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("kv:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn set_kv() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/kv/{KV_KEY}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("kv:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_kv() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/kv/{KV_KEY}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("kv:{KV_KEY}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_kv() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/kv"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("kv:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::syslog.

    #[tokio::test]
    async fn toggle_syslog_state() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/syslog-server"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("syslog-server:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_syslog_route() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/syslog-routes"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("syslog-route:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_syslog_route() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/syslog-routes/{SYSLOG_ROUTE_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("syslog-route:{SYSLOG_ROUTE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_syslog_routes() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/syslog-routes"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("syslog-route:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_syslog_route() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/syslog-routes/{SYSLOG_ROUTE_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("syslog-route:{SYSLOG_ROUTE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::authz::fga.

    #[tokio::test]
    async fn create_role() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/roles"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("role:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_role() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/roles/{ROLE_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("role:{ORG_ID}/{ROLE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_roles() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/roles"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("role:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_role() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/roles/{ROLE_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("role:{ORG_ID}/{ROLE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_role_permissions() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/roles/{ROLE_ID}/permissions/{RESOURCE_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("role:{ORG_ID}/{ROLE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_users_with_role() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/roles/{ROLE_ID}/users"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("role:{ORG_ID}/{ROLE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn create_group() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/groups"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("group:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_group() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/groups/{GROUP_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("group:{ORG_ID}/{GROUP_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_groups() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/groups"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("group:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_group_details() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/groups/{GROUP_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("group:{ORG_ID}/{GROUP_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_resources() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/resources"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_group() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/groups/{GROUP_NAME}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("group:{ORG_ID}/{GROUP_NAME}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::clusters.

    #[tokio::test]
    async fn list_clusters() {
        test_auth(
            Method::GET,
            "api/clusters".to_string(),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::pipeline.

    #[tokio::test]
    async fn save_pipeline() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/pipelines"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("pipeline:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_pipelines() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/pipelines"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!("pipeline:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_streams_with_pipeline() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/pipelines/streams"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(), // Should this be LIST?
                o2_type: format!("pipeline:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_pipeline() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/pipelines/{PIPELINE_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("pipeline:{PIPELINE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_pipeline() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/pipelines"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("pipeline:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn enable_pipeline() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/pipelines/{PIPELINE_ID}/enable"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("pipeline:{PIPELINE_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::short_url.

    #[tokio::test]
    async fn shorten() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/short"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn retrieve_short_url() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/short/{SHORT_URL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                // Should these be empty strings?
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::service_accounts.

    #[tokio::test]
    async fn save_service_account() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/service_accounts"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!("service_accounts:{ORG_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_service_account() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/service_accounts/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!("service_accounts:{EMAIL_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_service_account() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/service_accounts/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!("service_accounts:{EMAIL_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_api_token() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/service_accounts/{EMAIL_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!("service_accounts:{EMAIL_ID}"),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::actions.

    #[tokio::test]
    async fn delete_action() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/actions/{ACTION_KSUID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ACTION_KSUID}",
                    OFGA_MODELS
                        .get("actions")
                        .map_or("actions", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn serve_action_zip() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/actions/download/{ACTION_KSUID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ACTION_KSUID}",
                    OFGA_MODELS
                        .get("actions")
                        .map_or("actions", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_action() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/actions/{ACTION_KSUID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ACTION_KSUID}",
                    OFGA_MODELS
                        .get("actions")
                        .map_or("actions", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_actions() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/actions"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ORG_ID}",
                    OFGA_MODELS
                        .get("actions")
                        .map_or("actions", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_single_action() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/actions/{ACTION_KSUID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ACTION_KSUID}",
                    OFGA_MODELS
                        .get("actions")
                        .map_or("actions", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn upload_action() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/actions/upload"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    // Tests for routes defined in handler::http::request::keys.

    #[tokio::test]
    async fn save_cipher_keys() {
        test_auth(
            Method::POST,
            format!("api/{ORG_ID}/cipher_keys"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: POST_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ORG_ID}",
                    OFGA_MODELS
                        .get("cipher_keys")
                        .map_or("cipher_keys", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn get_cipher_key() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/cipher_keys/{CIPHER_KEY_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: GET_METHOD.to_string(),
                o2_type: format!(
                    "{}:{CIPHER_KEY_ID}",
                    OFGA_MODELS
                        .get("cipher_keys")
                        .map_or("cipher_keys", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn list_cipher_keys() {
        test_auth(
            Method::GET,
            format!("api/{ORG_ID}/cipher_keys"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: LIST_METHOD.to_string(),
                o2_type: format!(
                    "{}:{ORG_ID}",
                    OFGA_MODELS
                        .get("cipher_keys")
                        .map_or("cipher_keys", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn delete_cipher_key() {
        test_auth(
            Method::DELETE,
            format!("api/{ORG_ID}/cipher_keys/{CIPHER_KEY_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: DELETE_METHOD.to_string(),
                o2_type: format!(
                    "{}:{CIPHER_KEY_ID}",
                    OFGA_MODELS
                        .get("cipher_keys")
                        .map_or("cipher_keys", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    #[tokio::test]
    async fn update_cipher_key() {
        test_auth(
            Method::PUT,
            format!("api/{ORG_ID}/cipher_keys/{CIPHER_KEY_ID}"),
            AuthExtractor {
                auth: AUTH_HEADER_VAL.to_string(),
                method: PUT_METHOD.to_string(),
                o2_type: format!(
                    "{}:{CIPHER_KEY_ID}",
                    OFGA_MODELS
                        .get("cipher_keys")
                        .map_or("cipher_keys", |model| model.key)
                ),
                org_id: ORG_ID.to_string(),
                bypass_check: false,
                parent_id: "default".to_string(),
            },
        )
        .await
    }

    /// Tests that the correct authorization information is extracted from a
    /// request to the given path.
    async fn test_auth(method: Method, path: String, expected: AuthExtractor) {
        use std::sync::Arc;

        let mut config = mock_config();
        config.common.web_url = API_ROOT_URI.to_string();
        config.common.base_uri = "".to_string(); // API_BASE_COMP.to_string();
        config::config::CONFIG.store(Arc::new(config));

        let req = test::TestRequest::default()
            .method(method)
            .uri(&format!("{API_ROOT_URI}/{path}"))
            .append_header(AUTH_HEADER)
            .to_http_request();
        let actual = AuthExtractor::extract(&req).await.unwrap();
        assert_eq!(actual, expected);
    }

    /// Returns a mock configuration with fields set to default values.
    fn mock_config() -> config::Config {
        // Only some of the values differ from the
        // default values of their respective types.
        config::Config {
            common: config::Common {
                is_local_storage: true,
                ..Default::default()
            },
            limit: config::Limit {
                mem_table_bucket_num: 1,
                ..Default::default()
            },
            memory_cache: config::MemoryCache {
                bucket_num: 1,
                ..Default::default()
            },
            disk_cache: config::DiskCache {
                bucket_num: 1,
                ..Default::default()
            },
            ..Default::default()
        }
    }
}
