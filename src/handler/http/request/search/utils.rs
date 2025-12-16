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

use std::collections::HashSet;

use actix_web::HttpResponse;
use config::{
    TIMESTAMP_COL_NAME,
    meta::{sql::resolve_stream_names, stream::StreamType},
};
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::{
            meta::http::HttpResponse as MetaHttpResponse,
            utils::auth::{AuthExtractor, is_root_user},
        },
        service::users::get_user,
    },
    config::meta::user::User,
    o2_openfga::meta::mapping::OFGA_MODELS,
};

use crate::{
    common::utils::stream::get_settings_max_query_range,
    handler::http::request::search::error_utils::map_error_to_http_response,
    service::search::sql::Sql,
};

// Check permissions on stream
#[cfg(feature = "enterprise")]
pub async fn check_stream_permissions(
    stream_name: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &StreamType,
) -> Option<HttpResponse> {
    if !is_root_user(user_id) {
        let user: User = get_user(Some(org_id), user_id).await.unwrap();
        let stream_type_str = stream_type.as_str();

        if !crate::handler::http::auth::validator::check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: "GET".to_string(),
                o2_type: format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(stream_type_str)
                        .map_or(stream_type_str, |model| model.key),
                    stream_name
                ),
                org_id: org_id.to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
            },
            user.role,
            user.is_external,
        )
        .await
        {
            return Some(MetaHttpResponse::forbidden("Unauthorized Access"));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use hashbrown::HashMap;

    use super::*;

    #[test]
    fn test_get_bool_from_request() {
        let mut params = HashMap::new();

        // Test "true"
        params.insert("validate".to_string(), "true".to_string());
        assert!(get_bool_from_request(&params, "validate"));

        // Test "True" (case insensitive)
        params.insert("validate".to_string(), "True".to_string());
        assert!(get_bool_from_request(&params, "validate"));

        // Test "1"
        params.insert("validate".to_string(), "1".to_string());
        assert!(get_bool_from_request(&params, "validate"));

        // Test "false"
        params.insert("validate".to_string(), "false".to_string());
        assert!(!get_bool_from_request(&params, "validate"));

        // Test missing parameter
        params.clear();
        assert!(!get_bool_from_request(&params, "validate"));
    }

    #[test]
    fn test_is_system_field() {
        // Test system fields
        assert!(is_system_field("_timestamp"));
        assert!(is_system_field("_all"));
        assert!(is_system_field(config::TIMESTAMP_COL_NAME));

        // Test non-system fields
        assert!(!is_system_field("custom_field"));
        assert!(!is_system_field("user_id"));
        assert!(!is_system_field(""));
    }
}

// ============================================================================
// Query Validation Helpers
// ============================================================================

/// Extracts a boolean query parameter
/// Accepts "true" or "1" as true, anything else as false
/// Returns false if parameter is not present
pub fn get_bool_from_request(query: &HashMap<String, String>, param_name: &str) -> bool {
    query
        .get(param_name)
        .map(|v| v.to_lowercase() == "true" || v == "1")
        .unwrap_or(false)
}

/// Validates query fields against stream schema and User-Defined Schema (UDS)
/// Returns Ok(()) if validation passes, or error if fields are invalid
pub async fn validate_query_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    sql: &str,
) -> Result<(), infra::errors::Error> {
    // Step 1: Parse SQL to get columns (lightweight parsing)
    let search_query = proto::cluster_rpc::SearchQuery {
        sql: sql.to_string(),
        from: 0,
        size: 0,
        start_time: 0,
        end_time: 0,
        ..Default::default()
    };

    let sql_obj = Sql::new_with_options(&search_query, org_id, stream_type, None, false).await?;

    // Step 2: Get schema and UDS fields (from cache)
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .map_err(|_| {
            infra::errors::Error::ErrorCode(infra::errors::ErrorCodes::SearchStreamNotFound(
                stream_name.to_string(),
            ))
        })?;

    let settings = infra::schema::get_settings(org_id, stream_name, stream_type).await;
    let uds_fields = infra::schema::get_stream_setting_defined_schema_fields(&settings);

    // Step 3: Get fields used in query
    let used_fields: HashSet<String> = sql_obj.columns.values().flatten().cloned().collect();

    // Step 4: Validate each field
    for field in used_fields {
        // Skip system fields
        if is_system_field(&field) {
            continue;
        }

        // Skip aggregation functions
        if field == "count" {
            continue;
        }

        // Check 1: Field must exist in schema
        if schema.field_with_name(&field).is_err() {
            return Err(infra::errors::Error::ErrorCode(
                infra::errors::ErrorCodes::SearchFieldNotFound(format!(
                    "{}. Field not found in stream schema.",
                    field
                )),
            ));
        }

        // Check 2: If UDS is defined, field must be in UDS
        if !uds_fields.is_empty() && !uds_fields.contains(&field) {
            return Err(infra::errors::Error::ErrorCode(
                infra::errors::ErrorCodes::SearchFieldNotFound(format!(
                    "{}. Field exists but not in User-Defined Schema (UDS). Available UDS fields: {:?}",
                    field, uds_fields
                )),
            ));
        }
    }

    Ok(())
}

/// Validates and adjusts query time range based on max_query_range setting
/// Returns (adjusted_start_time, adjusted_end_time, error_message)
#[allow(dead_code)]
pub async fn validate_and_adjust_query_range(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    user_id: Option<&str>,
    start_time: i64,
    end_time: i64,
) -> (i64, i64, Option<String>) {
    if let Some(settings) = infra::schema::get_settings(org_id, stream_name, stream_type).await {
        let max_query_range =
            get_settings_max_query_range(settings.max_query_range, org_id, user_id).await;

        if max_query_range > 0 && (end_time - start_time) > max_query_range * 3600 * 1_000_000 {
            let adjusted_start = end_time - max_query_range * 3600 * 1_000_000;
            let error_msg = format!(
                "Query duration is modified due to query range restriction of {max_query_range} hours"
            );
            return (adjusted_start, end_time, Some(error_msg));
        }
    }

    (start_time, end_time, None)
}

/// Resolves stream names from SQL with standardized error handling
#[allow(dead_code)]
pub fn resolve_stream_names_or_error(
    sql: &str,
    trace_id: &str,
) -> Result<Vec<String>, HttpResponse> {
    match resolve_stream_names(sql) {
        Ok(v) => Ok(v.clone()),
        Err(e) => Err(map_error_to_http_response(
            &(e.into()),
            Some(trace_id.to_string()),
        )),
    }
}

/// Checks if a field is a system field that should always be allowed
fn is_system_field(field: &str) -> bool {
    field == "_timestamp" || field == "_all" || field == TIMESTAMP_COL_NAME
}

#[cfg(feature = "enterprise")]
pub async fn check_resource_permissions(
    org_id: &str,
    user_id: &str,
    resource_type: &str,
    resource_id: &str,
    method: &str,
) -> Option<HttpResponse> {
    if !is_root_user(user_id) {
        let user: User = get_user(Some(org_id), user_id).await.unwrap();

        if !crate::handler::http::auth::validator::check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: method.to_string(),
                o2_type: format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(resource_type)
                        .map_or(resource_type, |model| model.key),
                    resource_id
                ),
                org_id: org_id.to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
            },
            user.role,
            user.is_external,
        )
        .await
        {
            return Some(MetaHttpResponse::forbidden("Unauthorized Access"));
        }
    }
    None
}
