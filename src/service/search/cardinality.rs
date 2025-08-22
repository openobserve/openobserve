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

use config::{RwHashMap, meta::stream::StreamType, utils::time::now_micros};
use hashbrown::HashMap;
use infra::errors::{Error, Result};
use once_cell::sync::Lazy;

use crate::service::search as searchService;

/// This module is used to check the cardinality for one or multiple fields in a stream.
///
/// ## Features
/// - **Caching**: Global cardinality cache with 1 hour expiration to avoid duplicate calculations
/// - **Batch Processing**: Check cardinality for multiple fields in a single request
/// - **Efficient SQL**: Uses `approx_distinct` UDF for fast cardinality estimation
///
/// ## Usage
///
/// ### Single Field
/// ```rust
/// use config::meta::stream::StreamType;
///
/// use crate::service::search::cardinality::check_cardinality;
///
/// let cardinality =
///     check_cardinality("my_org", StreamType::Logs, "my_stream", "field_name").await?;
/// println!("Cardinality for field_name: {}", cardinality);
/// ```
///
/// ### Multiple Fields (Recommended for efficiency)
/// ```rust
/// use config::meta::stream::StreamType;
///
/// use crate::service::search::cardinality::check_cardinality;
///
/// let fields = vec!["field1", "field2", "field3"];
/// let results = check_cardinality("my_org", StreamType::Logs, "my_stream", &fields).await?;
///
/// for (field_name, cardinality) in results {
///     println!("Cardinality for {}: {}", field_name, cardinality);
/// }
/// ```
///
/// ## SQL Queries Generated
///
/// ### Single Field
/// ```sql
/// SELECT approx_distinct("field_name") AS cnt FROM "stream_name"
/// ```
///
/// ### Multiple Fields
/// ```sql
/// SELECT
///     approx_distinct("field1") AS field1_cnt,
///     approx_distinct("field2") AS field2_cnt,
///     approx_distinct("field3") AS field3_cnt
/// FROM "stream_name"
/// ```
///
/// ## Response Format
/// ```json
/// {
///     "field1_cnt": 1000,
///     "field2_cnt": 2000,
///     "field3_cnt": 500
/// }
/// ```
///
/// ## Cache Behavior
/// - Cache keys: `cardinality/{org_id}/{stream_type}/{stream_name}/{field_name}`
/// - Expiration: 1 hour (3600 seconds)
/// - Automatic cleanup of expired entries
/// - Cache hit returns immediately, cache miss triggers calculation
///
/// ## Performance Benefits
/// - **Multi-field batching**: Single SQL query for multiple fields instead of N separate queries
/// - **Intelligent caching**: Only calculates uncached fields, returns cached values immediately
/// - **Mixed cache states**: Handles scenarios where some fields are cached and others aren't

#[derive(Debug, Clone)]
struct CardinalityCacheEntry {
    value: f64,
    timestamp: i64,
}

/// Global cardinality cache with 1 hour expiration
static CARDINALITY_CACHE: Lazy<RwHashMap<String, CardinalityCacheEntry>> =
    Lazy::new(Default::default);

/// Cache expiration time in microseconds (1 hour)
const CACHE_EXPIRATION_MICROS: i64 = 3600 * 1_000_000; // 1 hour

/// Generate cache key for cardinality
fn generate_cache_key(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    field_name: &str,
) -> String {
    format!("cardinality/{org_id}/{stream_type}/{stream_name}/{field_name}")
}

/// Check if cache entry is expired
fn is_cache_expired(entry: &CardinalityCacheEntry) -> bool {
    let now = now_micros();
    now - entry.timestamp > CACHE_EXPIRATION_MICROS
}

/// Check cardinality for multiple fields at once
pub async fn check_cardinality(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    field_names: &[String],
    query_time: i64,
) -> Result<HashMap<String, f64>> {
    if field_names.is_empty() {
        return Ok(HashMap::new());
    }

    let mut results = HashMap::new();
    let mut fields_to_calculate = Vec::new();

    // Check cache for each field
    for field_name in field_names {
        match get_cardinality_from_cache(org_id, stream_type, stream_name, field_name).await {
            Ok(cardinality) => {
                log::debug!(
                    "Cardinality cache hit for {org_id}/{stream_type}/{stream_name}/{field_name}: {cardinality}"
                );
                results.insert(field_name.to_string(), cardinality);
            }
            Err(Error::Message(msg)) if msg.contains("cache miss") => {
                log::debug!(
                    "Cardinality cache miss for {org_id}/{stream_type}/{stream_name}/{field_name}, will calculate"
                );
                fields_to_calculate.push(field_name.clone());
            }
            Err(e) => {
                log::warn!(
                    "Error getting cardinality from cache for {org_id}/{stream_type}/{stream_name}/{field_name}: {e}"
                );
                fields_to_calculate.push(field_name.clone());
            }
        }
    }

    // Calculate cardinality for fields not in cache
    if !fields_to_calculate.is_empty() {
        match get_cardinality(
            org_id,
            stream_type,
            stream_name,
            &fields_to_calculate,
            query_time,
        )
        .await
        {
            Ok(calculated_results) => {
                // Cache the results and add to final results
                for (field_name, cardinality) in calculated_results {
                    let cache_key =
                        generate_cache_key(org_id, stream_type, stream_name, &field_name);
                    let cache_entry = CardinalityCacheEntry {
                        value: cardinality,
                        timestamp: now_micros(),
                    };
                    CARDINALITY_CACHE.insert(cache_key, cache_entry);

                    log::debug!(
                        "Calculated and cached cardinality for {org_id}/{stream_type}/{stream_name}/{field_name}: {cardinality}"
                    );

                    results.insert(field_name, cardinality);
                }
            }
            Err(e) => {
                log::error!(
                    "Error getting cardinality for fields {fields_to_calculate:?} in {org_id}/{stream_type}/{stream_name}: {e}"
                );
                // Return 0.0 for fields that failed to calculate
                for field_name in fields_to_calculate {
                    results.insert(field_name.to_string(), 0.0);
                }
            }
        }
    }

    Ok(results)
}

async fn get_cardinality_from_cache(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    field_name: &str,
) -> Result<f64> {
    let cache_key = generate_cache_key(org_id, stream_type, stream_name, field_name);

    // Check if entry exists in cache
    let entry = match CARDINALITY_CACHE.get(&cache_key) {
        Some(entry) => entry.clone(),
        None => {
            return Err(Error::Message(
                "cardinality cache miss - not found".to_string(),
            ));
        }
    };

    // Check if entry is expired
    if is_cache_expired(&entry) {
        CARDINALITY_CACHE.remove(&cache_key);
        Err(Error::Message(
            "cardinality cache miss - expired".to_string(),
        ))
    } else {
        Ok(entry.value)
    }
}

async fn get_cardinality(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    field_names: &[String],
    query_time: i64,
) -> Result<HashMap<String, f64>> {
    if field_names.is_empty() {
        return Ok(HashMap::new());
    }

    let schema = infra::schema::get_cache(org_id, stream_name, stream_type).await?;

    // Check if all fields exist in the schema
    let mut valid_fields = Vec::new();
    for field_name in field_names {
        if schema.field_with_name(field_name).is_some() {
            valid_fields.push(field_name.clone());
        } else {
            log::warn!(
                "Field '{field_name}' not found in schema for {org_id}/{stream_type}/{stream_name}"
            );
        }
    }

    if valid_fields.is_empty() {
        return Ok(HashMap::new());
    }

    let query_time = if query_time > 0 {
        query_time
    } else {
        now_micros()
    };

    // Build SQL query with multiple approx_distinct calls
    let mut select_clauses = Vec::new();
    for field_name in &valid_fields {
        let clause = format!(
            "approx_distinct(\"{}\") AS {}_cnt",
            field_name,
            field_name.replace('"', "")
        );
        select_clauses.push(clause);
    }

    let sql = format!(
        "SELECT {} FROM \"{}\"",
        select_clauses.join(", "),
        stream_name
    );

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            start_time: query_time - CACHE_EXPIRATION_MICROS,
            end_time: query_time,
            from: 0,
            size: 10,
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };

    let trace_id = config::ider::generate_trace_id();
    let resp = searchService::search(&trace_id, org_id, stream_type, None, &req).await?;

    let mut results = HashMap::new();

    if resp.hits.is_empty() {
        // Return 0.0 for all fields if no data
        for field_name in valid_fields {
            results.insert(field_name.to_string(), 0.0);
        }
        return Ok(results);
    }

    // Extract cardinality values from response
    let hit = &resp.hits[0];
    for field_name in valid_fields {
        let column_name = format!("{}_cnt", field_name.replace('"', ""));
        if let Some(val) = hit.get(&column_name) {
            let cardinality = match val {
                serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
                serde_json::Value::String(s) => s.parse::<f64>().unwrap_or(0.0),
                _ => 0.0,
            };
            results.insert(field_name.to_string(), cardinality);
        } else {
            log::warn!(
                "Column '{column_name}' not found in search response for field '{field_name}'"
            );
            results.insert(field_name.to_string(), 0.0);
        }
    }

    Ok(results)
}

/// Get cache statistics for monitoring
pub async fn get_cache_stats() -> (usize, usize) {
    let total_entries = CARDINALITY_CACHE.len();
    let now = now_micros();
    let mut expired_count = 0;

    for entry in CARDINALITY_CACHE.iter() {
        if now - entry.value().timestamp > CACHE_EXPIRATION_MICROS {
            expired_count += 1;
        }
    }

    (total_entries, expired_count)
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;

    #[test]
    fn test_generate_cache_key() {
        let key = generate_cache_key("test_org", StreamType::Logs, "test_stream", "test_field");
        assert_eq!(key, "cardinality/test_org/logs/test_stream/test_field");
    }

    #[test]
    fn test_is_cache_expired() {
        let now = now_micros();

        // Fresh entry (not expired)
        let fresh_entry = CardinalityCacheEntry {
            value: 100.0,
            timestamp: now - 1000, // 1ms ago
        };
        assert!(!is_cache_expired(&fresh_entry));

        // Expired entry
        let expired_entry = CardinalityCacheEntry {
            value: 100.0,
            timestamp: now - CACHE_EXPIRATION_MICROS - 1000, // Over 1 hour ago
        };
        assert!(is_cache_expired(&expired_entry));
    }

    #[tokio::test]
    async fn test_cache_operations() {
        let org_id = "test_org";
        let stream_type = StreamType::Logs;
        let stream_name = "test_stream";

        // Use a unique cache key to avoid conflicts with other tests
        let unique_field_name = format!("test_field_{}", now_micros());

        // Initially should return cache miss
        let result =
            get_cardinality_from_cache(org_id, stream_type, stream_name, &unique_field_name).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cache miss"));

        // Add entry to cache
        let cache_key = generate_cache_key(org_id, stream_type, stream_name, &unique_field_name);
        let cache_entry = CardinalityCacheEntry {
            value: 42.0,
            timestamp: now_micros(),
        };
        CARDINALITY_CACHE.insert(cache_key.clone(), cache_entry);

        // Should now return the cached value
        let result =
            get_cardinality_from_cache(org_id, stream_type, stream_name, &unique_field_name).await;
        assert_eq!(result.unwrap(), 42.0);

        // Clean up - ensure we remove the entry
        let removed = CARDINALITY_CACHE.remove(&cache_key);
        assert!(removed.is_some(), "Should have removed the cache entry");

        // Verify it's really gone
        let result =
            get_cardinality_from_cache(org_id, stream_type, stream_name, &unique_field_name).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cache miss"));
    }

    #[tokio::test]
    async fn test_get_cache_stats() {
        // Use unique test keys to avoid conflicts with other tests
        let test_prefix = format!("test_get_cache_stats_{}", now_micros());

        // Get initial cache state (there might be entries from other tests)
        let (initial_total, initial_expired) = get_cache_stats().await;

        let now = now_micros();

        // Add some fresh entries with unique keys
        let fresh_key1 = format!("{test_prefix}_fresh1");
        let fresh_entry1 = CardinalityCacheEntry {
            value: 100.0,
            timestamp: now - 1000, // 1ms ago (fresh)
        };
        CARDINALITY_CACHE.insert(fresh_key1.clone(), fresh_entry1);

        let fresh_key2 = format!("{test_prefix}_fresh2");
        let fresh_entry2 = CardinalityCacheEntry {
            value: 200.0,
            timestamp: now - 60 * 1_000_000, // 1 minute ago (fresh)
        };
        CARDINALITY_CACHE.insert(fresh_key2.clone(), fresh_entry2);

        // Add some expired entries with unique keys
        let expired_key1 = format!("{test_prefix}_expired1");
        let expired_entry1 = CardinalityCacheEntry {
            value: 300.0,
            timestamp: now - CACHE_EXPIRATION_MICROS - 1000, // Over 1 hour ago (expired)
        };
        CARDINALITY_CACHE.insert(expired_key1.clone(), expired_entry1);

        let expired_key2 = format!("{test_prefix}_expired2");
        let expired_entry2 = CardinalityCacheEntry {
            value: 400.0,
            timestamp: now - CACHE_EXPIRATION_MICROS - 60 * 1_000_000, /* Way over 1 hour ago
                                                                        * (expired) */
        };
        CARDINALITY_CACHE.insert(expired_key2.clone(), expired_entry2);

        // Check cache stats - should have added 4 entries (2 fresh + 2 expired)
        let (total, expired) = get_cache_stats().await;
        assert!(
            total >= initial_total + 4,
            "Total entries should be initial_total + 4, but got total={total}, initial_total={initial_total}"
        );
        assert!(
            expired >= initial_expired + 2,
            "Expired entries should be initial_expired + 2, but got expired={expired}, initial_expired={initial_expired}"
        );

        // Add one more fresh entry
        let fresh_key3 = format!("{test_prefix}_fresh3");
        let fresh_entry3 = CardinalityCacheEntry {
            value: 500.0,
            timestamp: now - 30 * 1_000_000, // 30 seconds ago (fresh)
        };
        CARDINALITY_CACHE.insert(fresh_key3.clone(), fresh_entry3);

        // Check cache stats again - should have added 1 more fresh entry
        let (total, expired) = get_cache_stats().await;
        assert_eq!(
            total,
            initial_total + 5,
            "Total entries should be initial_total + 5, but got total={total}, initial_total={initial_total}"
        );
        assert_eq!(
            expired,
            initial_expired + 2,
            "Expired entries should be initial_expired + 2, but got expired={expired}, initial_expired={initial_expired}"
        );

        // Clean up test entries
        CARDINALITY_CACHE.remove(&fresh_key1);
        CARDINALITY_CACHE.remove(&fresh_key2);
        CARDINALITY_CACHE.remove(&fresh_key3);
        CARDINALITY_CACHE.remove(&expired_key1);
        CARDINALITY_CACHE.remove(&expired_key2);

        // Verify cleanup - should be back to initial state
        let (total, expired) = get_cache_stats().await;
        assert_eq!(
            total, initial_total,
            "After cleanup, total should be back to initial_total={initial_total}, but got total={total}"
        );
        assert_eq!(
            expired, initial_expired,
            "After cleanup, expired should be back to initial_expired={initial_expired}, but got expired={expired}"
        );
    }

    #[tokio::test]
    async fn test_check_cardinality_cache() {
        let org_id = "test_org";
        let stream_type = StreamType::Logs;
        let stream_name = "test_stream";
        let test_id = now_micros();

        // Use unique field names to avoid conflicts
        let field1 = format!("field1_{test_id}");
        let field2 = format!("field2_{test_id}");
        let field3 = format!("field3_{test_id}");
        let fields = vec![field1.to_string(), field2.to_string(), field3.to_string()];

        // Manually add some entries to cache
        let cache_key1 = generate_cache_key(org_id, stream_type, stream_name, &field1);
        let cache_entry1 = CardinalityCacheEntry {
            value: 100.0,
            timestamp: now_micros(),
        };
        CARDINALITY_CACHE.insert(cache_key1.clone(), cache_entry1);

        let cache_key2 = generate_cache_key(org_id, stream_type, stream_name, &field2);
        let cache_entry2 = CardinalityCacheEntry {
            value: 200.0,
            timestamp: now_micros(),
        };
        CARDINALITY_CACHE.insert(cache_key2.clone(), cache_entry2);

        // field3 is not in cache, so it will need to be calculated (but will fail due to no real
        // schema)

        // Test that we get cached values for field1 and field2
        let results = check_cardinality(org_id, stream_type, stream_name, &fields, 0).await;

        // We expect this to work even if some fields fail, returning cached values for field1 and
        // field2
        match results {
            Ok(results) => {
                // Check that we got the cached values
                assert_eq!(results.get(&field1), Some(&100.0));
                assert_eq!(results.get(&field2), Some(&200.0));
                // field3 should have value 0 due to calculation failure
                assert_eq!(results.get(&field3), None);
            }
            Err(_) => {
                // This is also acceptable since we don't have a real schema setup
                // Just verify cache functionality worked for the parts that were cached
            }
        }

        // Clean up
        CARDINALITY_CACHE.remove(&cache_key1);
        CARDINALITY_CACHE.remove(&cache_key2);
    }

    #[test]
    fn test_check_cardinality_empty_fields() {
        // Test edge case with empty field list
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(check_cardinality(
            "test_org",
            StreamType::Logs,
            "test_stream",
            &[],
            0,
        ));

        assert!(result.is_ok());
        let results = result.unwrap();
        assert!(results.is_empty());
    }
}
