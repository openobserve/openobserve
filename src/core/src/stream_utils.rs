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

#[cfg(test)]
mod tests {
    use config::{
        get_config, meta::stream::StreamType, utils::query_range::get_default_max_query_range,
    };
    use search_service::query_range::{
        get_max_query_range, get_max_query_range_by_user_role, get_settings_max_query_range,
    };

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
}
