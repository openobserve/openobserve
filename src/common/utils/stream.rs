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

use std::io::Error;

use arrow::array::{Int64Array, RecordBatch};
use axum::response::Response;
use config::{
    FILE_EXT_JSON, TIMESTAMP_COL_NAME, get_config,
    meta::{
        stream::{FileMeta, StreamType},
        user::{User, UserRole},
    },
};

use crate::service::users;

#[inline(always)]
pub fn stream_type_query_param_error() -> Result<Response, Error> {
    Err(Error::other(
        "only 'type' query param with value 'logs' or 'metrics' allowed",
    ))
}

#[inline(always)]
pub fn increment_stream_file_num_v1(file_name: &str) -> u32 {
    let last_file_suffix_stream = &file_name.rfind('_').unwrap() + 1;
    let last_file_suffix =
        &file_name[last_file_suffix_stream..file_name.len() - FILE_EXT_JSON.len()];
    last_file_suffix.parse::<u32>().unwrap() + 1
}

#[inline(always)]
pub fn get_stream_file_num_v1(file_name: &str) -> u32 {
    let last_file_suffix_stream = &file_name.rfind('_').unwrap() + 1;
    let last_file_suffix =
        &file_name[last_file_suffix_stream..file_name.len() - FILE_EXT_JSON.len()];
    last_file_suffix.parse::<u32>().unwrap()
}

#[inline(always)]
pub fn get_file_name_v1(org_id: &str, stream_name: &str, suffix: u32) -> String {
    // creates file name like
    // "./data/openobserve/olympics/olympics#2022#09#13#13_1.json"
    format!(
        "{}{}/{}/{}/{}_{}{}",
        get_config().common.data_wal_dir,
        org_id,
        StreamType::Logs,
        stream_name,
        stream_name,
        suffix,
        FILE_EXT_JSON
    )
}

pub async fn populate_file_meta(
    batches: &[&RecordBatch],
    file_meta: &mut FileMeta,
    min_field: Option<&str>,
    max_field: Option<&str>,
) -> Result<(), anyhow::Error> {
    if batches.is_empty() {
        return Ok(());
    }
    let min_field = min_field.unwrap_or(TIMESTAMP_COL_NAME);
    let max_field = max_field.unwrap_or(TIMESTAMP_COL_NAME);

    let total = batches.iter().map(|batch| batch.num_rows()).sum::<usize>();
    let mut min_val = i64::MAX;
    let mut max_val = 0;
    for batch in batches.iter() {
        let num_row = batch.num_rows();
        let Some(min_field) = batch.column_by_name(min_field) else {
            return Err(anyhow::anyhow!("No min_field found: {}", min_field));
        };
        let Some(max_field) = batch.column_by_name(max_field) else {
            return Err(anyhow::anyhow!("No max_field found: {}", max_field));
        };
        let min_col = min_field.as_any().downcast_ref::<Int64Array>().unwrap();
        let max_col = max_field.as_any().downcast_ref::<Int64Array>().unwrap();
        for i in 0..num_row {
            let val = min_col.value(i);
            if val < min_val {
                min_val = val;
            }
            let val = max_col.value(i);
            if val > max_val {
                max_val = val;
            }
        }
    }
    if min_val == i64::MAX {
        min_val = 0;
    }

    file_meta.min_ts = min_val;
    file_meta.max_ts = max_val;
    file_meta.records = total as i64;
    Ok(())
}

/// Get the default maximum query range in hours considering the stream setting max query range
/// and the environment variable ZO_DEFAULT_MAX_QUERY_RANGE_DAYS
pub fn get_default_max_query_range(stream_max_query_range: i64) -> i64 {
    let cfg = get_config();
    let default_max_query_range = cfg.limit.default_max_query_range_days * 24;

    // This will allow the stream setting to override the global setting
    if stream_max_query_range > 0 {
        stream_max_query_range
    } else {
        default_max_query_range
    }
}

/// Get the maximum query range considering service account specific restrictions,
/// stream setting max query range and the environment variable ZO_DEFAULT_MAX_QUERY_RANGE_DAYS
pub async fn get_settings_max_query_range(
    stream_max_query_range: i64,
    org_id: &str,
    user_id: Option<&str>,
) -> i64 {
    let effective_max_query_range = get_default_max_query_range(stream_max_query_range);
    if user_id.is_none() {
        return effective_max_query_range;
    }

    if let Some(user) = users::get_user(Some(org_id), user_id.unwrap()).await {
        // get_max_query_range_by_user_role will use the effective max query range internally
        // Hence using the stream_max_query_range passed in
        get_max_query_range_by_user_role(stream_max_query_range, &user)
    } else {
        effective_max_query_range
    }
}

/// Get the maximum query range with service account specific restrictions
pub fn get_max_query_range_by_user_role(stream_max_query_range: i64, user: &User) -> i64 {
    let cfg = get_config();
    let effective_max_query_range = get_default_max_query_range(stream_max_query_range);
    // Then apply service account specific restrictions if applicable
    if user.role == UserRole::ServiceAccount {
        let max_query_range_sa = cfg.limit.max_query_range_for_sa;
        return if max_query_range_sa > 0 && effective_max_query_range > 0 {
            std::cmp::min(effective_max_query_range, max_query_range_sa)
        } else if max_query_range_sa > 0 {
            max_query_range_sa
        } else {
            effective_max_query_range
        };
    }

    log::debug!(
        "get_max_query_range_if_sa stream_max_query_range: {effective_max_query_range}, user_role: {:?}",
        user.role
    );

    effective_max_query_range
}

/// Get the maximum query range for a list of streams in hours
pub async fn get_max_query_range(
    stream_names: &[String],
    org_id: &str,
    user_id: &str,
    stream_type: StreamType,
) -> i64 {
    let user = users::get_user(Some(org_id), user_id).await;

    futures::future::join_all(
        stream_names
            .iter()
            .map(|stream_name| infra::schema::get_settings(org_id, stream_name, stream_type)),
    )
    .await
    .into_iter()
    .filter_map(|settings| {
        settings.map(|s| {
            if let Some(user) = &user {
                get_max_query_range_by_user_role(s.max_query_range, user)
            } else {
                s.max_query_range
            }
        })
    })
    .max()
    .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::arrow::{
        array::StringArray,
        datatypes::{DataType, Field, Schema},
    };

    use super::*;

    #[test]
    fn test_increment_stream_file_num_v1() {
        let suffix_nums = [1, 9, 11, 78, 100, 234, 546];

        for &suffix in &suffix_nums {
            let new_suffix = increment_stream_file_num_v1(&format!(
                "./data/openobserve/WAL/nexus/logs/olympics/1663064862606912_{suffix}.json"
            ));
            assert_eq!(new_suffix as usize, suffix + 1);
        }
    }

    #[test]
    fn test_get_file_name_v1() {
        let file_key = get_file_name_v1("nexus", "Olympics", 2);
        assert!(
            file_key
                .as_str()
                .ends_with("/wal/nexus/logs/Olympics/Olympics_2.json")
        );
    }

    #[test]
    fn test_get_stream_file_num_v1() {
        let file_key =
            get_stream_file_num_v1("./data/openobserve/WAL/logs/nexus/Olympics/Olympics_2.json");
        assert_eq!(file_key, 2);
    }

    #[tokio::test]
    async fn test_populate_file_meta() {
        // define a schema.
        let val: i64 = 1666093521151350;
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c", "d"])),
                Arc::new(Int64Array::from(vec![1, 2, 1, 2])),
                Arc::new(Int64Array::from(vec![val - 100, val - 10, val - 90, val])),
            ],
        )
        .unwrap();
        // let file_name = path.file_name();
        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 1000,
            compressed_size: 700,
            flattened: false,
            index_size: 0,
        };
        populate_file_meta(&[&batch], &mut file_meta, None, None)
            .await
            .unwrap();
        assert_eq!(file_meta.records, 4);
        assert_eq!(file_meta.min_ts, val - 100);
    }

    #[tokio::test]
    async fn test_populate_file_meta_with_custom_field() {
        // define a schema.
        let val: i64 = 1666093521151350;
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
            Field::new("time", DataType::Int64, false),
        ]));

        // define data.
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c", "d"])),
                Arc::new(Int64Array::from(vec![1, 2, 1, 2])),
                Arc::new(Int64Array::from(vec![val - 100, val - 10, val - 90, val])),
            ],
        )
        .unwrap();
        // let file_name = path.file_name();
        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 1000,
            compressed_size: 700,
            flattened: false,
            index_size: 0,
        };
        populate_file_meta(&[&batch], &mut file_meta, Some("time"), Some("time"))
            .await
            .unwrap();
        assert_eq!(file_meta.records, 4);
        assert_eq!(file_meta.min_ts, val - 100);
    }

    #[test]
    fn test_stream_type_query_param_error() {
        let res = stream_type_query_param_error();
        assert!(res.is_err());
    }

    #[test]
    fn test_get_default_max_query_range() {
        // Test with positive stream max query range
        let stream_max_query_range = 48; // 48 hours
        let result = get_default_max_query_range(stream_max_query_range);
        assert_eq!(result, 48);

        // Test with zero stream max query range (should use default)
        let stream_max_query_range = 0;
        let result = get_default_max_query_range(stream_max_query_range);
        let expected = get_config().limit.default_max_query_range_days * 24;
        assert_eq!(result, expected);

        // Test with negative stream max query range (should use default)
        let stream_max_query_range = -10;
        let result = get_default_max_query_range(stream_max_query_range);
        let expected = get_config().limit.default_max_query_range_days * 24;
        assert_eq!(result, expected);
    }

    #[tokio::test]
    async fn test_get_settings_max_query_range() {
        // Test with no user_id (should return effective max query range)
        let stream_max_query_range = 24;
        let org_id = "test_org";
        let user_id = None;
        let result = get_settings_max_query_range(stream_max_query_range, org_id, user_id).await;
        assert_eq!(result, 24);

        // Test with user_id but user not found (should return effective max query range)
        let user_id = Some("nonexistent_user");
        let result = get_settings_max_query_range(stream_max_query_range, org_id, user_id).await;
        assert_eq!(result, 24);
    }

    #[test]
    fn test_get_max_query_range_by_user_role() {
        use config::meta::user::User;

        // Test with regular user (should return effective max query range)
        let stream_max_query_range = 48;
        let user = User {
            email: "test@example.com".to_string(),
            password: "".to_string(),
            role: config::meta::user::UserRole::Admin,
            first_name: "".to_string(),
            last_name: "".to_string(),
            is_external: false,
            token: "".to_string(),
            salt: "".to_string(),
            rum_token: Some("".to_string()),
            org: "".to_string(),
            password_ext: Some("".to_string()),
        };
        let result = get_max_query_range_by_user_role(stream_max_query_range, &user);
        assert_eq!(result, 48);

        // Test with service account user
        let user = User {
            email: "service@example.com".to_string(),
            password: "".to_string(),
            role: config::meta::user::UserRole::ServiceAccount,
            first_name: "".to_string(),
            last_name: "".to_string(),
            is_external: false,
            token: "".to_string(),
            salt: "".to_string(),
            rum_token: Some("".to_string()),
            org: "".to_string(),
            password_ext: Some("".to_string()),
        };
        let result = get_max_query_range_by_user_role(stream_max_query_range, &user);
        // Should be limited by service account max query range if configured
        let sa_max = get_config().limit.max_query_range_for_sa;
        if sa_max > 0 {
            assert_eq!(result, std::cmp::min(stream_max_query_range, sa_max));
        } else {
            assert_eq!(result, stream_max_query_range);
        }
    }

    #[tokio::test]
    async fn test_get_max_query_range() {
        // Test with empty stream names
        let stream_names: Vec<String> = vec![];
        let org_id = "test_org";
        let user_id = "test_user";
        let stream_type = StreamType::Logs;
        let result = get_max_query_range(&stream_names, org_id, user_id, stream_type).await;
        assert_eq!(result, 0);

        // Test with single stream
        let stream_names = vec!["test_stream".to_string()];
        let result = get_max_query_range(&stream_names, org_id, user_id, stream_type).await;
        // Result depends on stream settings, but should be >= 0
        assert!(result >= 0);

        // Test with multiple streams
        let stream_names = vec![
            "stream1".to_string(),
            "stream2".to_string(),
            "stream3".to_string(),
        ];
        let result = get_max_query_range(&stream_names, org_id, user_id, stream_type).await;
        // Result depends on stream settings, but should be >= 0
        assert!(result >= 0);
    }

    #[tokio::test]
    async fn test_populate_file_meta_with_missing_field() {
        // define a schema without the expected timestamp field
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("pod_id", DataType::Int64, false),
        ]));

        // define data without timestamp field
        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c", "d"])),
                Arc::new(Int64Array::from(vec![1, 2, 1, 2])),
            ],
        )
        .unwrap();

        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 1000,
            compressed_size: 700,
            flattened: false,
            index_size: 0,
        };

        // This should fail because the _timestamp field is missing
        let result = populate_file_meta(&[&batch], &mut file_meta, None, None).await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("No min_field found")
        );
    }

    #[tokio::test]
    async fn test_populate_file_meta_with_multiple_batches() {
        // define a schema
        let val: i64 = 1666093521151350;
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        // define first batch
        let batch1 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["a", "b"])),
                Arc::new(Int64Array::from(vec![val - 100, val - 50])),
            ],
        )
        .unwrap();

        // define second batch with different min/max
        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["c", "d", "e"])),
                Arc::new(Int64Array::from(vec![val - 200, val, val - 150])),
            ],
        )
        .unwrap();

        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 1000,
            compressed_size: 700,
            flattened: false,
            index_size: 0,
        };

        populate_file_meta(&[&batch1, &batch2], &mut file_meta, None, None)
            .await
            .unwrap();

        assert_eq!(file_meta.records, 5); // 2 + 3 records
        assert_eq!(file_meta.min_ts, val - 200); // minimum from both batches
        assert_eq!(file_meta.max_ts, val); // maximum from both batches
    }

    #[tokio::test]
    async fn test_populate_file_meta_with_empty_batches() {
        let mut file_meta = FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 5,
            original_size: 1000,
            compressed_size: 700,
            flattened: false,
            index_size: 0,
        };

        // Test with empty batches array
        let result = populate_file_meta(&[], &mut file_meta, None, None).await;
        assert!(result.is_ok());

        // File meta should remain unchanged
        assert_eq!(file_meta.records, 5);
        assert_eq!(file_meta.min_ts, 100);
        assert_eq!(file_meta.max_ts, 200);
    }

    #[test]
    fn test_get_max_query_range_by_user_role_with_zero_stream_max() {
        use config::meta::user::User;

        // Test with service account and zero stream max query range
        let stream_max_query_range = 0;
        let user = User {
            email: "service@example.com".to_string(),
            password: "".to_string(),
            role: config::meta::user::UserRole::ServiceAccount,
            first_name: "".to_string(),
            last_name: "".to_string(),
            is_external: false,
            token: "".to_string(),
            salt: "".to_string(),
            rum_token: Some("".to_string()),
            org: "".to_string(),
            password_ext: Some("".to_string()),
        };

        let result = get_max_query_range_by_user_role(stream_max_query_range, &user);
        let cfg = get_config();
        let default_max = cfg.limit.default_max_query_range_days * 24;
        let sa_max = cfg.limit.max_query_range_for_sa;

        if sa_max > 0 && default_max > 0 {
            assert_eq!(result, std::cmp::min(default_max, sa_max));
        } else if sa_max > 0 {
            assert_eq!(result, sa_max);
        } else {
            assert_eq!(result, default_max);
        }
    }

    #[test]
    fn test_increment_stream_file_num_v1_edge_cases() {
        // Test with larger suffix numbers
        let new_suffix = increment_stream_file_num_v1(
            "./data/openobserve/WAL/nexus/logs/olympics/1663064862606912_999.json",
        );
        assert_eq!(new_suffix, 1000);

        // Test with suffix 0
        let new_suffix = increment_stream_file_num_v1(
            "./data/openobserve/WAL/nexus/logs/olympics/1663064862606912_0.json",
        );
        assert_eq!(new_suffix, 1);
    }

    #[test]
    fn test_get_stream_file_num_v1_edge_cases() {
        // Test with larger suffix numbers
        let file_num =
            get_stream_file_num_v1("./data/openobserve/WAL/logs/nexus/Olympics/Olympics_9999.json");
        assert_eq!(file_num, 9999);

        // Test with suffix 0
        let file_num =
            get_stream_file_num_v1("./data/openobserve/WAL/logs/nexus/Olympics/Olympics_0.json");
        assert_eq!(file_num, 0);
    }

    #[tokio::test]
    async fn test_populate_file_meta_with_custom_min_max_fields() {
        // Test with different min and max fields
        let val: i64 = 1666093521151350;
        let schema = Arc::new(Schema::new(vec![
            Field::new("log", DataType::Utf8, false),
            Field::new("start_time", DataType::Int64, false),
            Field::new("end_time", DataType::Int64, false),
        ]));

        let batch = RecordBatch::try_new(
            schema,
            vec![
                Arc::new(StringArray::from(vec!["a", "b", "c"])),
                Arc::new(Int64Array::from(vec![val - 100, val - 200, val - 150])),
                Arc::new(Int64Array::from(vec![val, val + 50, val + 100])),
            ],
        )
        .unwrap();

        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: 1000,
            compressed_size: 700,
            flattened: false,
            index_size: 0,
        };

        populate_file_meta(
            &[&batch],
            &mut file_meta,
            Some("start_time"),
            Some("end_time"),
        )
        .await
        .unwrap();

        assert_eq!(file_meta.records, 3);
        assert_eq!(file_meta.min_ts, val - 200); // minimum from start_time
        assert_eq!(file_meta.max_ts, val + 100); // maximum from end_time
    }
}
