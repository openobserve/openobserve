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

use std::collections::HashSet;

#[cfg(feature = "enterprise")]
use axum::response::Response;
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, INDEX_FIELD_NAME_FOR_ALL, ORIGINAL_DATA_COL_NAME,
    TIMESTAMP_COL_NAME, meta::stream::StreamType,
};
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
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

use crate::service::search::sql::Sql;

// Check permissions on stream
#[cfg(feature = "enterprise")]
pub async fn check_stream_permissions(
    stream_name: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &StreamType,
) -> Option<Response> {
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

// ============================================================================
// Query Validation Helpers
// ============================================================================

/// Extracts a boolean query parameter
/// Accepts "true" (case-insensitive) as true, anything else as false
/// Returns false if parameter is not present
pub fn get_bool_from_request(query: &HashMap<String, String>, param_name: &str) -> bool {
    query
        .get(param_name)
        .and_then(|v| v.to_lowercase().parse::<bool>().ok())
        .unwrap_or(false)
}

/// Validates query fields against stream schema and User-Defined Schema (UDS)
/// Returns Ok(()) if validation passes, or error if fields are invalid
pub async fn validate_query_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    sql: &str,
) -> Result<(), Error> {
    // Step 1: Parse SQL to get columns (lightweight parsing)
    let search_query = proto::cluster_rpc::SearchQuery {
        sql: sql.to_string(),
        ..Default::default()
    };

    let sql = Sql::new_with_options(&search_query, org_id, stream_type, None, false).await?;

    // Step 2: Get schema and UDS fields (from cache)
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .map_err(|_| Error::ErrorCode(ErrorCodes::SearchStreamNotFound(stream_name.to_string())))?;

    let settings = infra::schema::get_settings(org_id, stream_name, stream_type).await;
    let uds_fields = infra::schema::get_stream_setting_defined_schema_fields(&settings);

    // Step 3: Get fields used in query
    let used_fields: HashSet<String> = sql.columns.values().flatten().cloned().collect();

    // Step 4: Validate each field
    for field in used_fields {
        // Skip system fields
        if is_system_field(&field) {
            continue;
        }

        // Check 1: Field must exist in schema
        if schema.field_with_name(&field).is_err() {
            return Err(Error::ErrorCode(ErrorCodes::SearchFieldNotFound(format!(
                "{}. Field not found in stream schema.",
                field
            ))));
        }

        // Check 2: If UDS is defined, field must be in UDS
        if !uds_fields.is_empty() && !uds_fields.contains(&field) {
            return Err(Error::ErrorCode(ErrorCodes::SearchFieldNotFound(format!(
                "{field}. Field exists but not in User-Defined Schema (UDS)",
            ))));
        }
    }

    Ok(())
}

/// Checks if a field is a system field that should always be allowed
fn is_system_field(field: &str) -> bool {
    field == TIMESTAMP_COL_NAME
        || field == INDEX_FIELD_NAME_FOR_ALL
        || field == ID_COL_NAME
        || field == ORIGINAL_DATA_COL_NAME
        || field == ALL_VALUES_COL_NAME
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

        // Test "false"
        params.insert("validate".to_string(), "false".to_string());
        assert!(!get_bool_from_request(&params, "validate"));

        // Test "False" (case insensitive)
        params.insert("validate".to_string(), "False".to_string());
        assert!(!get_bool_from_request(&params, "validate"));

        // Test invalid value (treated as false)
        params.insert("validate".to_string(), "1".to_string());
        assert!(!get_bool_from_request(&params, "validate"));

        // Test missing parameter
        params.clear();
        assert!(!get_bool_from_request(&params, "validate"));
    }

    #[test]
    fn test_is_system_field() {
        // Test all system fields using constants
        assert!(is_system_field(config::TIMESTAMP_COL_NAME)); // "_timestamp"
        assert!(is_system_field(config::INDEX_FIELD_NAME_FOR_ALL)); // "_all"
        assert!(is_system_field(config::ID_COL_NAME)); // "_o2_id"
        assert!(is_system_field(config::ORIGINAL_DATA_COL_NAME)); // "_original"
        assert!(is_system_field(config::ALL_VALUES_COL_NAME)); // "_all_values"

        // Test non-system fields
        assert!(!is_system_field("custom_field"));
        assert!(!is_system_field("user_id"));
        assert!(!is_system_field("message")); // MESSAGE_COL_NAME is not a system field
        assert!(!is_system_field(""));
    }

    #[tokio::test]
    async fn test_validate_query_fields_join_with_mixed_uds() {
        use arrow_schema::{DataType, Field, Schema};
        use config::meta::stream::{StreamSettings, StreamType};
        use infra::schema::{STREAM_SCHEMAS_LATEST, STREAM_SETTINGS, SchemaCache};

        let org_id = "test_org_join_uds";
        let stream_name_a = "oly";
        let stream_name_b = "test1";
        let stream_type = StreamType::Logs;

        // Create schema for table "oly" with field "continent"
        let schema_a = Schema::new(vec![
            Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("continent", DataType::Utf8, true),
        ]);

        // Create schema for table "test1" with field "continent"
        let schema_b = Schema::new(vec![
            Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("continent", DataType::Utf8, true),
        ]);

        // Create cache keys
        let cache_key_a = format!("{}/{}/{}", org_id, stream_type, stream_name_a);
        let cache_key_b = format!("{}/{}/{}", org_id, stream_type, stream_name_b);

        // Store schemas in cache
        {
            let mut w = STREAM_SCHEMAS_LATEST.write().await;
            w.insert(cache_key_a.clone(), SchemaCache::new(schema_a));
            w.insert(cache_key_b.clone(), SchemaCache::new(schema_b));
        }

        // Create UDS settings:
        // - "oly" has UDS with "continent" field (allowed)
        // - "test1" has UDS with "other_field" but NOT "continent" (should fail)
        let settings_a = StreamSettings {
            defined_schema_fields: vec!["continent".to_string()],
            ..Default::default()
        };

        let settings_b = StreamSettings {
            defined_schema_fields: vec!["other_field".to_string()], // UDS without continent
            ..Default::default()
        };

        {
            let mut w = STREAM_SETTINGS.write().await;
            w.insert(cache_key_a.clone(), settings_a.clone());
            w.insert(cache_key_b.clone(), settings_b.clone());

            // Also update the atomic cache which is used by get_settings
            let mut atomic_cache = hashbrown::HashMap::new();
            atomic_cache.insert(cache_key_a.clone(), settings_a);
            atomic_cache.insert(cache_key_b.clone(), settings_b);
            infra::schema::set_stream_settings_atomic(atomic_cache);
        }

        // Test the JOIN query where:
        // - a.continent is valid (exists in schema AND in UDS for "oly")
        // - b.continent should FAIL (exists in schema but NOT in UDS for "test1")
        let sql = r#"SELECT a.continent AS "namespace_a", b.continent AS "namespace_b"
FROM "oly" AS a
JOIN "test1" AS b"#;

        // Validate both streams:
        // - stream_name_a (oly) should pass (continent is in UDS)
        // - stream_name_b (test1) should fail (continent is NOT in UDS)
        let result_a = validate_query_fields(org_id, stream_name_a, stream_type, sql).await;
        assert!(result_a.is_ok(), "Expected oly validation to pass");

        let result = validate_query_fields(org_id, stream_name_b, stream_type, sql).await;

        // Cleanup
        {
            let mut w = STREAM_SCHEMAS_LATEST.write().await;
            w.remove(&cache_key_a);
            w.remove(&cache_key_b);
        }
        {
            let mut w = STREAM_SETTINGS.write().await;
            w.remove(&cache_key_a);
            w.remove(&cache_key_b);
        }

        // Assert that validation fails with the correct error
        assert!(
            result.is_err(),
            "Expected validation to fail for JOIN with mixed UDS"
        );

        let err = result.unwrap_err();
        let err_msg = format!("{:?}", err);
        assert!(
            err_msg.contains("continent") && err_msg.contains("User-Defined Schema"),
            "Expected error about field not in UDS, got: {}",
            err_msg
        );
    }
}

// ============================================================================
// Query Field Validation Tests with UDS - Edge Cases Testing
// ============================================================================

#[cfg(test)]
mod validate_query_edge_cases {
    //! Edge case tests for query field validation across different UDS configurations.
    //!
    //! **Validation Strategy:** Based on DataFusion CLI testing,
    //! OpenObserve implements STRICT validation that aligns with DataFusion's behavior:
    //! - All fields must exist in the stream's schema
    //! - All fields must be in the stream's UDS (if UDS is defined)
    //! - Validation is per-table in JOIN queries
    //! - Applies to all query types: SELECT, JOIN, subquery, CTE, UNION

    use super::*;

    mod helpers {
        use arrow_schema::{DataType, Field, Schema};
        use config::meta::stream::{StreamSettings, StreamType};
        use infra::schema::{STREAM_SCHEMAS_LATEST, STREAM_SETTINGS, SchemaCache};

        use super::*;

        /// Test context holding stream configurations
        pub(super) struct TestContext {
            pub(super) org_id: String,
            pub(super) stream_type: StreamType,
            pub(super) cache_key_oly: String,
            pub(super) cache_key_test1: String,
        }

        impl TestContext {
            pub(super) async fn cleanup(&self) {
                {
                    let mut w = STREAM_SCHEMAS_LATEST.write().await;
                    w.remove(&self.cache_key_oly);
                    w.remove(&self.cache_key_test1);
                }
                {
                    let mut w = STREAM_SETTINGS.write().await;
                    w.remove(&self.cache_key_oly);
                    w.remove(&self.cache_key_test1);
                }
            }
        }

        /// Helper to create realistic schema for Olympic data streams
        pub(super) fn create_olympic_schema() -> Schema {
            Schema::new(vec![
                Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new("body", DataType::Utf8, true),
                Field::new("bronze_medals", DataType::Int64, true),
                Field::new("continent", DataType::Utf8, true),
                Field::new("flag_url", DataType::Utf8, true),
                Field::new("gold_medals", DataType::Int64, true),
                Field::new("id", DataType::Utf8, true),
                Field::new("name", DataType::Utf8, true),
                Field::new("rank", DataType::Int64, true),
                Field::new("total_medals", DataType::Int64, true),
                Field::new("unique_id", DataType::Utf8, true),
            ])
        }

        /// UDS Configuration: No UDS defined (all fields allowed)
        pub(super) fn uds_empty() -> StreamSettings {
            StreamSettings::default()
        }

        /// UDS Configuration: UDS WITHOUT continent field
        /// Fields: body, id, name, total_medals, unique_id
        pub(super) fn uds_without_continent() -> StreamSettings {
            StreamSettings {
                defined_schema_fields: vec![
                    "body".to_string(),
                    "id".to_string(),
                    "name".to_string(),
                    "total_medals".to_string(),
                    "unique_id".to_string(),
                ],
                ..Default::default()
            }
        }

        /// UDS Configuration: UDS WITH continent field
        /// Fields: body, continent, id, name, total_medals, unique_id
        pub(super) fn uds_with_continent() -> StreamSettings {
            StreamSettings {
                defined_schema_fields: vec![
                    "body".to_string(),
                    "continent".to_string(),
                    "id".to_string(),
                    "name".to_string(),
                    "total_medals".to_string(),
                    "unique_id".to_string(),
                ],
                ..Default::default()
            }
        }

        /// Initialize test context with schemas and UDS settings
        pub(super) async fn init_test_context(
            test_name: &str,
            oly_uds: StreamSettings,
            test1_uds: StreamSettings,
        ) -> TestContext {
            let org_id = format!("test_org_{}", test_name);
            let stream_type = StreamType::Logs;

            let cache_key_oly = format!("{}/{}/{}", org_id, stream_type, "oly");
            let cache_key_test1 = format!("{}/{}/{}", org_id, stream_type, "test1");

            // Setup schemas
            {
                let mut w = STREAM_SCHEMAS_LATEST.write().await;
                w.insert(
                    cache_key_oly.clone(),
                    SchemaCache::new(create_olympic_schema()),
                );
                w.insert(
                    cache_key_test1.clone(),
                    SchemaCache::new(create_olympic_schema()),
                );
            }

            // Setup UDS settings
            {
                let mut w = STREAM_SETTINGS.write().await;
                w.insert(cache_key_oly.clone(), oly_uds.clone());
                w.insert(cache_key_test1.clone(), test1_uds.clone());

                // Update atomic cache
                let mut atomic_cache = hashbrown::HashMap::new();
                atomic_cache.insert(cache_key_oly.clone(), oly_uds);
                atomic_cache.insert(cache_key_test1.clone(), test1_uds);
                infra::schema::set_stream_settings_atomic(atomic_cache);
            }

            TestContext {
                org_id,
                stream_type,
                cache_key_oly,
                cache_key_test1,
            }
        }

        // ========================================================================
        // Test 1: Basic SELECT Queries
        // ========================================================================

        #[tokio::test]
        async fn test_basic_select_no_uds() {
            let ctx = init_test_context(
                "basic_no_uds",
                uds_empty(), // oly: no UDS
                uds_empty(), // test1: no UDS
            )
            .await;

            let sql = r#"SELECT continent FROM "oly""#;
            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // Should PASS: no UDS restrictions
            println!("Basic SELECT (no UDS): {:?}", result);
            assert!(result.is_ok(), "Should pass when no UDS is defined");
        }

        #[tokio::test]
        async fn test_basic_select_old_uds_without_continent() {
            let ctx =
                init_test_context("basic_old_uds", uds_without_continent(), uds_empty()).await;

            let sql = r#"SELECT continent FROM "oly""#;
            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // Should FAIL: continent not in old UDS
            println!("Basic SELECT (old UDS, no continent): {:?}", result);
            assert!(result.is_err(), "Should fail when field not in UDS");

            let err_msg = format!("{:?}", result.unwrap_err());
            assert!(err_msg.contains("continent") && err_msg.contains("User-Defined Schema"));
        }

        #[tokio::test]
        async fn test_basic_select_new_uds_with_continent() {
            let ctx = init_test_context(
                "basic_new_uds",
                uds_with_continent(), // oly: new UDS WITH continent
                uds_empty(),
            )
            .await;

            let sql = r#"SELECT continent FROM "oly""#;
            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // Should PASS: continent is in new UDS
            println!("Basic SELECT (new UDS with continent): {:?}", result);
            assert!(result.is_ok(), "Should pass when field is in UDS");
        }

        // ========================================================================
        // Test 2: JOIN Queries
        // ========================================================================

        #[tokio::test]
        async fn test_join_both_no_uds() {
            let ctx = init_test_context(
                "join_both_no_uds",
                uds_empty(), // oly: no UDS
                uds_empty(), // test1: no UDS
            )
            .await;

            let sql = r#"SELECT a.continent AS "oly_continent", b.continent AS "test1_continent"
FROM "oly" AS a
JOIN "test1" AS b ON a._timestamp = b._timestamp"#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;
            let result_test1 =
                validate_query_fields(&ctx.org_id, "test1", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // Both should PASS: no UDS restrictions
            println!(
                "JOIN (both no UDS) - oly: {:?}, test1: {:?}",
                result_oly, result_test1
            );
            assert!(
                result_oly.is_ok() && result_test1.is_ok(),
                "Should pass when no UDS"
            );
        }

        #[tokio::test]
        async fn test_join_oly_old_uds_test1_no_uds() {
            let ctx = init_test_context(
                "join_mixed_uds",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),             // test1: no UDS
            )
            .await;

            let sql = r#"SELECT a.continent AS "oly_continent", b.continent AS "test1_continent"
FROM "oly" AS a
JOIN "test1" AS b ON a._timestamp = b._timestamp"#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;
            let result_test1 =
                validate_query_fields(&ctx.org_id, "test1", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion uses STRICT validation: oly.continent not in UDS should fail
            assert!(
                result_oly.is_err(),
                "Should fail when field not in oly's UDS"
            );
            assert!(
                result_test1.is_ok(),
                "Should pass for test1 (no UDS restrictions)"
            );
        }

        #[tokio::test]
        async fn test_join_both_new_uds() {
            let ctx = init_test_context(
                "join_both_new_uds",
                uds_with_continent(), // oly: new UDS WITH continent
                uds_with_continent(), // test1: new UDS WITH continent
            )
            .await;

            let sql = r#"SELECT a.continent AS "oly_continent", b.continent AS "test1_continent"
FROM "oly" AS a
JOIN "test1" AS b ON a._timestamp = b._timestamp"#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;
            let result_test1 =
                validate_query_fields(&ctx.org_id, "test1", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // Should PASS: both have continent in UDS (aligns with DataFusion)
            assert!(
                result_oly.is_ok() && result_test1.is_ok(),
                "Should pass when field in both UDS"
            );
        }

        #[tokio::test]
        async fn test_join_mixed_fields() {
            let ctx = init_test_context(
                "join_mixed_fields",
                uds_without_continent(), // oly: has 'name' in UDS, not 'continent'
                uds_empty(),             // test1: no UDS
            )
            .await;

            let sql = r#"SELECT a.name, a.continent, b.continent
FROM "oly" AS a
JOIN "test1" AS b ON a._timestamp = b._timestamp"#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // Should FAIL: a.continent not in oly UDS (DataFusion strict validation)
            assert!(result_oly.is_err(), "Should fail when any field not in UDS");
        }

        // ========================================================================
        // Test 3: Subquery Tests
        // ========================================================================

        #[tokio::test]
        async fn test_subquery_field_in_where_not_in_uds() {
            let ctx = init_test_context(
                "subquery_where",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),             // test1: no UDS
            )
            .await;

            let sql = r#"SELECT a.name
FROM "oly" AS a
WHERE a.continent IN (
    SELECT b.continent FROM "test1" AS b
)"#;

            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: a.continent not in UDS should fail
            assert!(
                result.is_err(),
                "Should fail when WHERE clause uses field not in UDS"
            );
        }

        #[tokio::test]
        async fn test_subquery_in_select_not_in_uds() {
            let ctx = init_test_context(
                "subquery_select",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),
            )
            .await;

            let sql = r#"SELECT
    a.name,
    (SELECT COUNT(*) FROM "test1" WHERE continent = a.continent) as match_count
FROM "oly" AS a"#;

            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: a.continent not in UDS should fail
            assert!(
                result.is_err(),
                "Should fail when subquery references field not in UDS"
            );
        }

        // ========================================================================
        // Test 4: CTE Tests
        // ========================================================================

        #[tokio::test]
        async fn test_cte_field_not_in_uds() {
            let ctx = init_test_context(
                "cte_basic",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),
            )
            .await;

            let sql = r#"WITH oly_data AS (
    SELECT _timestamp, continent
    FROM "oly"
)
SELECT continent, COUNT(*) as cnt
FROM oly_data
GROUP BY continent"#;

            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: continent not in UDS should fail
            assert!(
                result.is_err(),
                "Should fail when CTE uses field not in UDS"
            );
        }

        #[tokio::test]
        async fn test_cte_with_join() {
            let ctx = init_test_context(
                "cte_join",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),             // test1: no UDS
            )
            .await;

            let sql = r#"WITH oly_continents AS (
    SELECT continent, _timestamp FROM "oly"
),
test1_continents AS (
    SELECT continent, _timestamp FROM "test1"
)
SELECT a.continent, b.continent
FROM oly_continents AS a
JOIN test1_continents AS b ON a._timestamp = b._timestamp"#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;
            let result_test1 =
                validate_query_fields(&ctx.org_id, "test1", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: oly's continent not in UDS should fail
            assert!(
                result_oly.is_err(),
                "Should fail when CTE references field not in oly's UDS"
            );
            assert!(
                result_test1.is_ok(),
                "Should pass for test1 (no UDS restrictions)"
            );
        }

        // ========================================================================
        // Test 5: UNION Tests
        // ========================================================================

        #[tokio::test]
        async fn test_union_oly_old_uds_test1_no_uds() {
            let ctx = init_test_context(
                "union_mixed",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),             // test1: no UDS
            )
            .await;

            let sql = r#"SELECT continent FROM "oly"
UNION
SELECT continent FROM "test1""#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;
            let result_test1 =
                validate_query_fields(&ctx.org_id, "test1", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: validates per-table
            assert!(
                result_oly.is_err(),
                "Should fail when oly's continent not in UDS"
            );
            assert!(
                result_test1.is_ok(),
                "Should pass for test1 (no UDS restrictions)"
            );
        }

        #[tokio::test]
        async fn test_union_all_with_where() {
            let ctx = init_test_context(
                "union_all_where",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),
            )
            .await;

            let sql = r#"SELECT continent FROM "oly" WHERE continent = 'Europe'
UNION ALL
SELECT continent FROM "test1" WHERE continent = 'Asia'"#;

            let result_oly = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: continent not in oly's UDS should fail
            assert!(
                result_oly.is_err(),
                "Should fail when UNION uses field not in UDS"
            );
        }

        // ========================================================================
        // Test 6: Complex Mixed Queries
        // ========================================================================

        #[tokio::test]
        async fn test_complex_cte_join_subquery() {
            let ctx = init_test_context(
                "complex_mixed",
                uds_without_continent(), // oly: old UDS WITHOUT continent
                uds_empty(),
            )
            .await;

            let sql = r#"WITH base_data AS (
    SELECT continent, _timestamp FROM "oly"
)
SELECT
    a.continent,
    b.continent,
    (SELECT COUNT(*) FROM "test1" WHERE continent = a.continent) as match_count
FROM base_data AS a
JOIN "test1" AS b ON a._timestamp = b._timestamp"#;

            let result = validate_query_fields(&ctx.org_id, "oly", ctx.stream_type, sql).await;

            ctx.cleanup().await;

            // DataFusion strict validation: continent not in oly's UDS should fail
            assert!(
                result.is_err(),
                "Should fail when complex query uses field not in UDS"
            );
        }
    }
}
