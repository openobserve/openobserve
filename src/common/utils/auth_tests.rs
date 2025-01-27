#[cfg(feature = "enterprise")]
#[cfg(test)]
mod tests {
    use actix_http::Method;
    use actix_web::{test, FromRequest};

    use super::super::auth::AuthExtractor;

    const API_ROOT_URI: &str = "https://test.com";
    const AUTH_HEADER_VAL: &str = "AUTH_HEADER_VAL";
    const AUTH_HEADER: (&str, &str) = ("Authorization", AUTH_HEADER_VAL);
    const ORG_ID: &str = "TEST_ORG_ID";
    const EMAIL_ID: &str = "TEST_EMAIL_ID";

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
            format!("api/organizations"),
            AuthExtractor {
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{LIST_METHOD}"),
                // In subsequent authorization steps `##user_id##` is replaced
                // with the actual user ID.
                o2_type: format!("org:##user_id##"),
                org_id: format!("organizations"), // This is expected.
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                // LIST is used instead of GET because there is no resource ID
                // associated with a summary.
                method: format!("{LIST_METHOD}"),
                o2_type: format!("summary:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                // LIST is used instead of GET because there is no resource ID
                // associated with a passcode.
                method: format!("{LIST_METHOD}"),
                o2_type: format!("passcode:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("passcode:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                // LIST is used instead of GET because there is no resource ID
                // associated with a rumtoken.
                method: format!("{LIST_METHOD}"),
                o2_type: format!("rumtoken:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("rumtoken:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{POST_METHOD}"),
                o2_type: format!("rumtoken:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{GET_METHOD}"),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                // In OpenFGA we treat this operation as PUT rather than DELETE.
                method: format!("{PUT_METHOD}"),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("settings:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{GET_METHOD}"),
                o2_type: format!("stream:STREAM_NAME"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{POST_METHOD}"),
                o2_type: format!("stream:STREAM_NAME"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("stream:STREAM_NAME"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{PUT_METHOD}"),
                o2_type: format!("stream:STREAM_NAME"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{DELETE_METHOD}"),
                o2_type: format!("stream:STREAM_NAME"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{LIST_METHOD}"),
                // o2_type is intentially stream:TEST_ORG_ID instead of
                // stream:STREAM_NAME because stream:TEST_ORG_ID indicates
                // permission for listing all streams that belong to the
                // organization.
                o2_type: format!("stream:{ORG_ID}"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
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
                auth: format!("{AUTH_HEADER_VAL}"),
                method: format!("{DELETE_METHOD}"),
                o2_type: format!("stream:STREAM_NAME"),
                org_id: format!("{ORG_ID}"),
                bypass_check: false,
                parent_id: format!("default"),
            },
        )
        .await
    }

    // Routes defined in handler::http::request::logs::ingest are all ignored by
    // AuthExtractor so they are omitted from these tests.

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
    #[allow(deprecated)]
    fn mock_config() -> config::Config {
        config::Config {
            auth: config::Auth {
                root_user_email: String::default(),
                root_user_password: String::default(),
                cookie_max_age: i64::default(),
                cookie_same_site_lax: bool::default(),
                cookie_secure_only: bool::default(),
                ext_auth_salt: String::default(),
            },
            report_server: config::ReportServer {
                enable_report_server: bool::default(),
                user_email: String::default(),
                user_password: String::default(),
                port: u16::default(),
                addr: String::default(),
                ipv6_enabled: bool::default(),
            },
            http: config::Http {
                port: u16::default(),
                addr: String::default(),
                ipv6_enabled: bool::default(),
                tls_enabled: bool::default(),
                tls_cert_path: String::default(),
                tls_key_path: String::default(),
                tls_min_version: String::default(),
                tls_root_certificates: String::default(),
            },
            grpc: config::Grpc {
                port: u16::default(),
                addr: String::default(),
                org_header_key: String::default(),
                stream_header_key: String::default(),
                internal_grpc_token: String::default(),
                max_message_size: usize::default(),
                connect_timeout: u64::default(),
                channel_cache_disabled: bool::default(),
                tls_enabled: bool::default(),
                tls_cert_domain: String::default(),
                tls_cert_path: String::default(),
                tls_key_path: String::default(),
            },
            route: config::Route {
                timeout: u64::default(),
                max_connections: usize::default(),
            },
            common: config::Common {
                app_name: String::default(),
                local_mode: bool::default(),
                local_mode_storage: String::default(),
                cluster_coordinator: String::default(),
                queue_store: String::default(),
                meta_store: String::default(),
                meta_store_external: bool::default(),
                meta_postgres_dsn: String::default(),
                meta_mysql_dsn: String::default(),
                node_role: String::default(),
                node_role_group: String::default(),
                cluster_name: String::default(),
                instance_name: String::default(),
                instance_name_short: String::default(),
                web_url: String::default(),
                base_uri: String::default(),
                data_dir: String::default(),
                data_wal_dir: String::default(),
                data_stream_dir: String::default(),
                data_db_dir: String::default(),
                data_cache_dir: String::default(),
                column_timestamp: String::default(),
                column_all: String::default(),
                feature_per_thread_lock: bool::default(),
                feature_fulltext_extra_fields: String::default(),
                feature_secondary_index_extra_fields: String::default(),
                feature_distinct_extra_fields: String::default(),
                feature_quick_mode_fields: String::default(),
                feature_filelist_dedup_enabled: bool::default(),
                feature_query_queue_enabled: bool::default(),
                feature_query_partition_strategy: String::default(),
                feature_query_infer_schema: bool::default(),
                feature_query_exclude_all: bool::default(),
                feature_query_without_index: bool::default(),
                feature_query_remove_filter_with_index: bool::default(),
                feature_query_streaming_aggs: bool::default(),
                feature_join_match_one_enabled: bool::default(),
                feature_join_right_side_max_rows: usize::default(),
                ui_enabled: bool::default(),
                ui_sql_base64_enabled: bool::default(),
                metrics_dedup_enabled: bool::default(),
                bloom_filter_enabled: bool::default(),
                bloom_filter_disabled_on_search: bool::default(),
                bloom_filter_default_fields: String::default(),
                bloom_filter_ndv_ratio: u64::default(),
                wal_fsync_disabled: bool::default(),
                tracing_enabled: bool::default(),
                tracing_search_enabled: bool::default(),
                otel_otlp_url: String::default(),
                otel_otlp_grpc_url: String::default(),
                tracing_grpc_header_org: String::default(),
                tracing_grpc_header_stream_name: String::default(),
                tracing_header_key: String::default(),
                tracing_header_value: String::default(),
                telemetry_enabled: bool::default(),
                telemetry_url: String::default(),
                telemetry_heartbeat: i64::default(),
                prometheus_enabled: bool::default(),
                print_key_config: bool::default(),
                print_key_event: bool::default(),
                print_key_sql: bool::default(),
                usage_enabled: bool::default(),
                usage_org: String::default(),
                usage_reporting_mode: String::default(),
                usage_reporting_url: String::default(),
                usage_reporting_creds: String::default(),
                usage_batch_size: usize::default(),
                usage_publish_interval: i64::default(),
                mmdb_data_dir: String::default(),
                mmdb_disable_download: bool::default(),
                mmdb_update_duration: u64::default(),
                mmdb_geolite_citydb_url: String::default(),
                mmdb_geolite_asndb_url: String::default(),
                mmdb_geolite_citydb_sha256_url: String::default(),
                mmdb_geolite_asndb_sha256_url: String::default(),
                default_scrape_interval: u32::default(),
                memory_circuit_breaker_enable: bool::default(),
                memory_circuit_breaker_ratio: usize::default(),
                restricted_routes_on_empty_data: bool::default(),
                inverted_index_enabled: bool::default(),
                inverted_index_cache_enabled: bool::default(),
                inverted_index_split_chars: String::default(),
                inverted_index_old_format: bool::default(),
                inverted_index_store_format: String::default(),
                inverted_index_search_format: String::default(),
                inverted_index_tantivy_mode: String::default(),
                inverted_index_count_optimizer_enabled: bool::default(),
                full_text_search_type: String::default(),
                query_on_stream_selection: bool::default(),
                show_stream_dates_doc_num: bool::default(),
                blocked_streams: String::default(),
                report_user_name: String::default(),
                report_user_password: String::default(),
                report_server_url: String::default(),
                report_server_skip_tls_verify: bool::default(),
                schema_cache_compress_enabled: bool::default(),
                skip_formatting_stream_name: bool::default(),
                bulk_api_response_errors_only: bool::default(),
                allow_user_defined_schemas: bool::default(),
                mem_table_individual_streams: String::default(),
                traces_span_metrics_enabled: bool::default(),
                traces_span_metrics_export_interval: u64::default(),
                traces_span_metrics_channel_buffer: usize::default(),
                self_metrics_consumption_enabled: bool::default(),
                self_metrics_consumption_interval: u64::default(),
                self_metrics_consumption_whitelist: String::default(),
                result_cache_enabled: bool::default(),
                use_multi_result_cache: bool::default(),
                result_cache_selection_strategy: String::default(),
                result_cache_discard_duration: i64::default(),
                metrics_cache_enabled: bool::default(),
                swagger_enabled: bool::default(),
                fake_es_version: String::default(),
                websocket_enabled: bool::default(),
                min_auto_refresh_interval: u32::default(),
            },
            limit: config::Limit {
                cpu_num: usize::default(),
                real_cpu_num: usize::default(),
                mem_total: usize::default(),
                disk_total: usize::default(),
                disk_free: usize::default(),
                req_json_limit: usize::default(),
                req_payload_limit: usize::default(),
                max_file_retention_time: u64::default(),
                max_file_size_on_disk: usize::default(),
                max_file_size_in_memory: usize::default(),
                udschema_max_fields: usize::default(),
                schema_max_fields_to_enable_uds: usize::default(),
                user_defined_schema_max_fields: usize::default(),
                mem_table_max_size: usize::default(),
                mem_table_bucket_num: usize::default(),
                mem_persist_interval: u64::default(),
                wal_write_buffer_size: usize::default(),
                file_push_interval: u64::default(),
                file_push_limit: usize::default(),
                file_move_fields_limit: usize::default(),
                file_move_thread_num: usize::default(),
                file_merge_thread_num: usize::default(),
                mem_dump_thread_num: usize::default(),
                usage_reporting_thread_num: usize::default(),
                query_thread_num: usize::default(),
                query_timeout: u64::default(),
                query_default_limit: i64::default(),
                query_partition_by_secs: usize::default(),
                query_group_base_speed: usize::default(),
                ingest_allowed_upto: i64::default(),
                ingest_flatten_level: u32::default(),
                ignore_file_retention_by_stream: bool::default(),
                logs_file_retention: String::default(),
                traces_file_retention: String::default(),
                metrics_file_retention: String::default(),
                metrics_leader_push_interval: u64::default(),
                metrics_leader_election_interval: i64::default(),
                metrics_max_series_per_query: usize::default(),
                metrics_max_points_per_series: usize::default(),
                metrics_cache_max_entries: usize::default(),
                req_cols_per_record_limit: usize::default(),
                node_heartbeat_ttl: i64::default(),
                http_worker_num: usize::default(),
                http_worker_max_blocking: usize::default(),
                grpc_runtime_worker_num: usize::default(),
                grpc_runtime_blocking_worker_num: usize::default(),
                grpc_runtime_shutdown_timeout: u64::default(),
                job_runtime_worker_num: usize::default(),
                job_runtime_blocking_worker_num: usize::default(),
                job_runtime_shutdown_timeout: u64::default(),
                calculate_stats_interval: u64::default(),
                enrichment_table_limit: usize::default(),
                request_timeout: u64::default(),
                keep_alive: u64::default(),
                keep_alive_disabled: bool::default(),
                http_slow_log_threshold: u64::default(),
                http_shutdown_timeout: u64::default(),
                alert_schedule_interval: i64::default(),
                alert_schedule_concurrency: i64::default(),
                alert_schedule_timeout: i64::default(),
                report_schedule_timeout: i64::default(),
                derived_stream_schedule_interval: i64::default(),
                scheduler_max_retries: i32::default(),
                pause_alerts_on_retries: bool::default(),
                alert_considerable_delay: i32::default(),
                scheduler_clean_interval: i64::default(),
                scheduler_watch_interval: i64::default(),
                search_job_workers: i64::default(),
                search_job_scheduler_interval: i64::default(),
                search_job_run_timeout: i64::default(),
                search_job_delete_interval: i64::default(),
                search_job_timeout: i64::default(),
                search_job_retention: i64::default(),
                starting_expect_querier_num: usize::default(),
                query_optimization_num_fields: usize::default(),
                quick_mode_enabled: bool::default(),
                quick_mode_force_enabled: bool::default(),
                quick_mode_num_fields: usize::default(),
                quick_mode_strategy: String::default(),
                sql_db_connections_min: u32::default(),
                sql_db_connections_max: u32::default(),
                sql_db_connections_acquire_timeout: u64::default(),
                sql_db_connections_idle_timeout: u64::default(),
                sql_db_connections_max_lifetime: u64::default(),
                meta_transaction_retries: usize::default(),
                meta_transaction_lock_timeout: usize::default(),
                file_list_id_batch_size: usize::default(),
                file_list_multi_thread: bool::default(),
                distinct_values_interval: u64::default(),
                distinct_values_hourly: bool::default(),
                consistent_hash_vnodes: usize::default(),
                datafusion_file_stat_cache_max_entries: usize::default(),
                datafusion_streaming_aggs_cache_max_entries: usize::default(),
                datafusion_min_partition_num: usize::default(),
                max_enrichment_table_size: usize::default(),
                short_url_retention_days: i64::default(),
                inverted_index_cache_max_entries: usize::default(),
                inverted_index_skip_threshold: usize::default(),
                max_query_range_for_sa: i64::default(),
            },
            compact: config::Compact {
                enabled: bool::default(),
                interval: u64::default(),
                old_data_interval: u64::default(),
                strategy: String::default(),
                sync_to_db_interval: u64::default(),
                max_file_size: usize::default(),
                extended_data_retention_days: i64::default(),
                data_retention_days: i64::default(),
                old_data_max_days: i64::default(),
                old_data_min_hours: i64::default(),
                old_data_min_records: i64::default(),
                old_data_min_files: i64::default(),
                delete_files_delay_hours: i64::default(),
                blocked_orgs: String::default(),
                data_retention_history: bool::default(),
                batch_size: i64::default(),
                job_run_timeout: i64::default(),
                job_clean_wait_time: i64::default(),
                pending_jobs_metric_interval: u64::default(),
                downsampling_interval: i64::default(),
                metrics_downsampling_rules: String::default(),
            },
            memory_cache: config::MemoryCache {
                enabled: bool::default(),
                cache_strategy: String::default(),
                bucket_num: usize::default(),
                cache_latest_files: bool::default(),
                max_size: usize::default(),
                skip_size: usize::default(),
                release_size: usize::default(),
                gc_size: usize::default(),
                gc_interval: u64::default(),
                skip_disk_check: bool::default(),
                datafusion_max_size: usize::default(),
                datafusion_memory_pool: String::default(),
            },
            disk_cache: config::DiskCache {
                enabled: bool::default(),
                cache_strategy: String::default(),
                bucket_num: usize::default(),
                max_size: usize::default(),
                result_max_size: usize::default(),
                skip_size: usize::default(),
                release_size: usize::default(),
                gc_size: usize::default(),
                gc_interval: u64::default(),
                multi_dir: String::default(),
            },
            log: config::Log {
                level: String::default(),
                json_format: bool::default(),
                file_dir: String::default(),
                file_name_prefix: String::default(),
                local_time_format: String::default(),
                events_enabled: bool::default(),
                events_auth: String::default(),
                events_url: String::default(),
                events_batch_size: usize::default(),
            },
            etcd: config::Etcd {
                addr: String::default(),
                prefix: String::default(),
                connect_timeout: u64::default(),
                command_timeout: u64::default(),
                lock_wait_timeout: u64::default(),
                user: String::default(),
                password: String::default(),
                cert_auth: bool::default(),
                ca_file: String::default(),
                cert_file: String::default(),
                key_file: String::default(),
                domain_name: String::default(),
                load_page_size: i64::default(),
            },
            nats: config::Nats {
                addr: String::default(),
                prefix: String::default(),
                user: String::default(),
                password: String::default(),
                replicas: usize::default(),
                history: i64::default(),
                deliver_policy: String::default(),
                connect_timeout: u64::default(),
                command_timeout: u64::default(),
                lock_wait_timeout: u64::default(),
                subscription_capacity: usize::default(),
                queue_max_age: u64::default(),
            },
            s3: config::S3 {
                provider: String::default(),
                server_url: String::default(),
                region_name: String::default(),
                access_key: String::default(),
                secret_key: String::default(),
                bucket_name: String::default(),
                bucket_prefix: String::default(),
                connect_timeout: u64::default(),
                request_timeout: u64::default(),
                feature_force_path_style: bool::default(),
                feature_force_hosted_style: bool::default(),
                feature_http1_only: bool::default(),
                feature_http2_only: bool::default(),
                allow_invalid_certificates: bool::default(),
                sync_to_cache_interval: u64::default(),
                max_retries: usize::default(),
                max_idle_per_host: usize::default(),
            },
            sns: config::Sns {
                endpoint: String::default(),
                connect_timeout: u64::default(),
                operation_timeout: u64::default(),
            },
            tcp: config::TCP {
                tcp_port: u16::default(),
                udp_port: u16::default(),
            },
            prom: config::Prometheus {
                ha_cluster_label: String::default(),
                ha_replica_label: String::default(),
            },
            profiling: config::Pyroscope {
                enabled: bool::default(),
                server_url: String::default(),
                project_name: String::default(),
            },
            smtp: config::Smtp {
                smtp_enabled: bool::default(),
                smtp_host: String::default(),
                smtp_port: u16::default(),
                smtp_username: String::default(),
                smtp_password: String::default(),
                smtp_reply_to: String::default(),
                smtp_from_email: String::default(),
                smtp_encryption: String::default(),
            },
            rum: config::RUM {
                enabled: bool::default(),
                client_token: String::default(),
                application_id: String::default(),
                site: String::default(),
                service: String::default(),
                env: String::default(),
                version: String::default(),
                organization_identifier: String::default(),
                api_version: String::default(),
                insecure_http: bool::default(),
            },
            chrome: config::Chrome {
                chrome_enabled: bool::default(),
                chrome_path: String::default(),
                chrome_check_default: bool::default(),
                chrome_auto_download: bool::default(),
                chrome_download_path: String::default(),
                chrome_no_sandbox: bool::default(),
                chrome_with_head: bool::default(),
                chrome_sleep_secs: u16::default(),
                chrome_window_width: u32::default(),
                chrome_window_height: u32::default(),
            },
            tokio_console: config::TokioConsole {
                tokio_console_server_addr: String::default(),
                tokio_console_server_port: u16::default(),
                tokio_console_retention: u64::default(),
            },
            health_check: config::HealthCheck {
                enabled: bool::default(),
                timeout: u64::default(),
                failed_times: usize::default(),
            },
        }
    }
}
