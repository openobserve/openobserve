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

// macOS ld cannot encode compact-unwind offsets once __eh_frame exceeds 16MB;
// harmless for a binary this size (only slows panic unwinding), so silence it.
#![allow(linker_messages)]
#![recursion_limit = "256"]

#[cfg(test)]
mod tests {
    use core::time;
    use std::{
        env, fs,
        net::SocketAddr,
        str,
        sync::{Arc, Once},
        thread,
    };

    use arrow_flight::flight_service_server::FlightServiceServer;
    use axum::{
        Router,
        body::Body,
        http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header},
    };
    use bytes::{Bytes, BytesMut};
    use chrono::{Duration, Utc};
    use common::meta::user::UserList;
    use config::{
        get_config,
        meta::{
            alerts::{Operator, QueryCondition, TriggerCondition, alert::Alert},
            dashboards::{Dashboard, v5},
            pipeline::{
                Pipeline,
                components::{DerivedStream, PipelineSource},
            },
            stream::StreamType,
            triggers::{ScheduledTriggerData, Trigger, TriggerModule, TriggerStatus},
        },
        utils::{
            enrichment_local_cache::{
                get_key, get_metadata_content, get_metadata_path, get_table_dir, get_table_path,
            },
            json,
        },
    };
    use enrichment_data::enrichment::storage::{Values, local};
    use infra::schema::{STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST};
    use ingestion_common::IngestionResponse;
    use openobserve::migration;
    use openobserve_api_grpc::handler::grpc::{
        auth::check_internal_auth, flight::FlightServiceImpl, request::logs::LogsServer,
    };
    use openobserve_api_http::handler::http::router::{
        basic_routes, config_routes, other_service_routes, service_routes,
    };
    use openobserve_api_management::{
        models::{
            alerts::responses::{GetAlertResponseBody, ListAlertsResponseBody},
            destinations::{Destination, DestinationType},
        },
        request::alerts::external_events::inactive_org_response,
    };
    use openobserve_api_pipelines::models::pipelines::{Pipeline as ApiPipeline, PipelineList};
    use openobserve_core::alerts::scheduler::handlers::handle_triggers;
    use opentelemetry_proto::tonic::{
        collector::logs::v1::{
            ExportLogsServiceRequest, logs_service_client::LogsServiceClient,
            logs_service_server::LogsServiceServer,
        },
        common::v1::{AnyValue, any_value},
        logs::v1::{LogRecord, ResourceLogs, ScopeLogs},
    };
    use prost::Message;
    use proto::{cluster_rpc::search_server::SearchServer, prometheus_rpc};
    use search_service::SEARCH_SERVER;
    use serde_json::json;
    use tonic::codec::CompressionEncoding;
    use tower::ServiceExt;
    use transform::enrichment::ENRICHMENT_TABLES;

    /// Tables of Task 0.17 that carry an org column, and that column.
    const KV_COVERAGE_TABLES: [(&str, &str); 10] = [
        ("stream_stats", "org"),
        ("file_list_history", "org"),
        ("file_list_jobs", "org"),
        ("pipeline_last_errors", "org_id"),
        ("kv_store", "org_id"),
        ("system_settings", "org_id"),
        ("short_urls", "org_id"),
        ("backfill_jobs", "org"),
        ("enrichment_tables", "org"),
        ("enrichment_table_urls", "org"),
    ];

    static START: Once = Once::new();
    // A sub-test that calls `setup()` after `tear_down` fails fast instead of using deleted state.
    static TORN_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    struct CoverageRows {
        check_id: String,
        integration_id: String,
        anomaly_id: String,
        workflow_id: String,
        probe_token: String,
        agent_id: String,
        location_id: String,
        artifact: String,
        pricing_model: String,
        team_id: String,
        response_id: String,
        policy_id: String,
        dek: Vec<u8>,
    }

    /// The e2e's own data dir, ports, config file and Postgres database, removed by `tear_down`.
    struct Sandbox {
        dir: tempfile::TempDir,
        postgres: Option<OwnDatabase>,
    }

    impl Sandbox {
        /// Runs before the first `get_config`, which reads the env this sets exactly once.
        async fn create() -> Self {
            let dir = tempfile::Builder::new()
                .prefix("o2-e2e-")
                .tempdir()
                .expect("e2e temp dir");
            let config_file = dir.path().join("e2e.env");
            fs::write(&config_file, "").expect("e2e config file");
            config::config_path_manager::set_config_file_path(config_file)
                .expect("e2e config file path");
            // The enterprise config also loads a `.env` from the working directory.
            env::set_current_dir(dir.path()).expect("enter the e2e temp dir");
            let postgres = OwnDatabase::create().await;
            let [grpc_port, http_port] = free_ports();
            unsafe {
                env::set_var("ZO_DATA_DIR", format!("{}/data/", dir.path().display()));
                for derived in [
                    "ZO_DATA_WAL_DIR",
                    "ZO_DATA_STREAM_DIR",
                    "ZO_DATA_DB_DIR",
                    "ZO_DATA_CACHE_DIR",
                    "ZO_DATA_TMP_DIR",
                ] {
                    env::remove_var(derived);
                }
                env::set_var("ZO_GRPC_ADDR", "127.0.0.1");
                env::set_var("ZO_GRPC_PORT", grpc_port.to_string());
                env::set_var("ZO_HTTP_ADDR", "127.0.0.1");
                env::set_var("ZO_HTTP_PORT", http_port.to_string());
            }
            Self { dir, postgres }
        }

        /// Panics unless the config that every pool connects from names this database.
        fn assert_config_uses_it(&self) {
            let Some(postgres) = &self.postgres else {
                return;
            };
            let cfg = get_config();
            let dsn = url::Url::parse(&cfg.common.meta_postgres_dsn).expect("e2e DSN is a URL");
            assert_eq!(dsn.path(), format!("/{}", postgres.name));
            assert!(cfg.common.meta_postgres_ro_dsn.is_empty());
            assert!(cfg.common.meta_ddl_dsn.is_empty());
        }

        async fn tear_down(self) {
            log::info!("Tear Down Invoked");
            TORN_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
            let data = self.dir.path().join("data");
            // The WAL push job can still be moving the last ingests' files while the dir goes.
            let mut result = fs::remove_dir_all(&data);
            for _ in 0..20 {
                if result.is_ok() {
                    break;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                result = fs::remove_dir_all(&data);
            }
            result.expect("Delete local dir failed");
            if let Some(postgres) = self.postgres {
                postgres.drop_database().await;
            }
        }
    }

    /// A database made from the CI DSN, so the e2e never writes into the one the unit tests share.
    struct OwnDatabase {
        admin_dsn: String,
        name: String,
        dropped: bool,
    }

    impl OwnDatabase {
        async fn create() -> Option<Self> {
            use sqlx::Connection;

            if env::var("ZO_META_STORE").ok()?.as_str() != "postgres" {
                return None;
            }
            let admin_dsn = env::var("ZO_META_POSTGRES_DSN")
                .ok()
                .filter(|dsn| !dsn.is_empty())
                .expect("the Postgres e2e makes its own database from ZO_META_POSTGRES_DSN");
            let name = format!(
                "o2_e2e_{}_{}",
                std::process::id(),
                Utc::now().timestamp_micros()
            );
            let mut conn = sqlx::PgConnection::connect(&admin_dsn)
                .await
                .expect("connect to the CI Postgres");
            sqlx::query(&format!("CREATE DATABASE {name}"))
                .execute(&mut conn)
                .await
                .expect("create the e2e database");
            let mut dsn = url::Url::parse(&admin_dsn).expect("ZO_META_POSTGRES_DSN is a URL");
            dsn.set_path(&format!("/{name}"));
            unsafe {
                env::set_var("ZO_META_POSTGRES_DSN", dsn.as_str());
                env::remove_var("ZO_META_POSTGRES_RO_DSN");
                env::remove_var("ZO_META_DDL_DSN");
            }
            Some(Self {
                admin_dsn,
                name,
                dropped: false,
            })
        }

        async fn drop_database(mut self) {
            Self::drop_named(&self.admin_dsn, &self.name)
                .await
                .expect("drop the e2e database");
            self.dropped = true;
        }

        async fn drop_named(admin_dsn: &str, name: &str) -> Result<(), sqlx::Error> {
            use sqlx::Connection;

            let mut conn = sqlx::PgConnection::connect(admin_dsn).await?;
            // FORCE ends the pools this process still holds on the database.
            sqlx::query(&format!("DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
                .execute(&mut conn)
                .await?;
            Ok(())
        }
    }

    impl Drop for OwnDatabase {
        /// Also runs on unwind; on a new thread because no runtime starts inside the test's.
        fn drop(&mut self) {
            if self.dropped {
                return;
            }
            let (admin_dsn, name) = (self.admin_dsn.clone(), self.name.clone());
            let dropped = std::thread::spawn(move || {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| e.to_string())?
                    .block_on(Self::drop_named(&admin_dsn, &name))
                    .map_err(|e| e.to_string())
            })
            .join();
            if !matches!(dropped, Ok(Ok(()))) {
                eprintln!(
                    "the e2e database {} was not dropped: {dropped:?}",
                    self.name
                );
            }
        }
    }

    fn setup() -> (&'static str, &'static str) {
        assert!(
            !TORN_DOWN.load(std::sync::atomic::Ordering::SeqCst),
            "a sub-test ran after tear_down removed the e2e's data dir and database"
        );
        START.call_once(|| unsafe {
            env::set_var("ZO_ROOT_USER_EMAIL", "root@example.com");
            env::set_var("ZO_ROOT_USER_PASSWORD", "Complexpass#123");
            env::set_var("ZO_LOCAL_MODE", "true");
            env::set_var("ZO_MAX_FILE_SIZE_ON_DISK", "1");
            env::set_var("ZO_FILE_PUSH_INTERVAL", "1");
            env::set_var("ZO_PAYLOAD_LIMIT", "209715200");
            env::set_var("ZO_JSON_LIMIT", "209715200");
            env::set_var("ZO_RESULT_CACHE_ENABLED", "false");
            env::set_var("ZO_PRINT_KEY_SQL", "true");
            env::set_var("ZO_SMTP_ENABLED", "true");
            env::set_var("ZO_CREATE_ORG_THROUGH_INGESTION", "true");
            env::set_var("ZO_ORG_CLEANUP_POLL_INTERVAL_SECS", "1");
            env::set_var("ZO_COMPACT_DELETE_FILES_DELAY_MINUTES", "0");
            env::set_var("ZO_SYNTHETICS_ENABLED", "true");
            env::set_var("ZO_SKIP_SSRF_CHECKS", "true");
            env::set_var("O2_ORG_DELETION_GRACE_PERIOD_DAYS", "0");

            env_logger::init_from_env(
                env_logger::Env::new().default_filter_or(&get_config().log.level),
            );

            log::info!("setup Invoked");
        });
        (
            "Authorization",
            "Basic cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM=",
        )
    }

    /// Initialize test router with service and basic routes
    fn init_test_router() -> Router {
        Router::new()
            .merge(basic_routes())
            .nest("/config", config_routes())
            .nest("/api", service_routes())
    }

    /// Make a test request and return the response
    async fn make_request(
        app: &Router,
        method: Method,
        uri: &str,
        headers: Option<HeaderMap>,
        body: Option<String>,
    ) -> (StatusCode, Bytes) {
        let mut req_builder = Request::builder().method(method).uri(uri);

        if let Some(hdrs) = headers {
            for (key, value) in hdrs.iter() {
                req_builder = req_builder.header(key, value);
            }
        }

        let req = if let Some(body_str) = body {
            req_builder
                .body(Body::from(body_str))
                .expect("Failed to build request")
        } else {
            req_builder
                .body(Body::empty())
                .expect("Failed to build request")
        };

        let response = app
            .clone()
            .oneshot(req)
            .await
            .expect("Failed to execute request");

        let status = response.status();
        let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");

        (status, body_bytes)
    }

    /// Helper to create headers with auth
    fn auth_headers(auth: (&str, &str)) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(auth.1).expect("Invalid auth header"),
        );
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        headers
    }

    async fn init_grpc_server() -> Result<(), anyhow::Error> {
        let cfg = get_config();
        let ip = if !cfg.grpc.addr.is_empty() {
            cfg.grpc.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        let gaddr: SocketAddr = format!("{}:{}", ip, cfg.grpc.port).parse()?;
        let search_svc = SearchServer::new(SEARCH_SERVER.clone())
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip);
        let flight_svc = FlightServiceServer::new(FlightServiceImpl)
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip);
        let logs_svc = LogsServiceServer::new(LogsServer);

        log::info!("starting gRPC server at {}", gaddr);
        tonic::transport::Server::builder()
            .layer(tonic::service::InterceptorLayer::new(check_internal_auth))
            .add_service(search_svc)
            .add_service(flight_svc)
            .add_service(logs_svc)
            .serve(gaddr)
            .await
            .expect("gRPC server init failed");
        Ok(())
    }

    /// Ports free now; both listeners stay open until both are picked, so they differ.
    fn free_ports() -> [u16; 2] {
        let listeners = [(); 2]
            .map(|_| std::net::TcpListener::bind("127.0.0.1:0").expect("bind an ephemeral port"));
        listeners.map(|l| l.local_addr().expect("ephemeral port").port())
    }

    /// Helper function to flush memtable to ensure proper test isolation
    /// This prevents memtable overflow errors when running sequential ingestion tests
    async fn flush_memtable() {
        if let Err(e) = ingester::flush_all().await {
            log::warn!("Failed to flush memtable: {}", e);
        }
    }

    /// Cleanup any leftover state from previous test runs/retries.
    /// Order matters: alerts first (they reference destinations), then destinations, then
    /// templates. This ensures idempotency when tests are retried.
    async fn cleanup_previous_test_state() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        // 1. Delete alerts first (they reference destinations)
        // List alerts and delete by ID
        let (status, body) = make_request(
            &app,
            Method::GET,
            "/api/v2/e2e/alerts?stream_type=logs",
            Some(headers.clone()),
            None,
        )
        .await;

        if status.is_success()
            && let Ok(alerts) = serde_json::from_slice::<serde_json::Value>(&body)
            && let Some(list) = alerts.get("list").and_then(|l| l.as_array())
        {
            let alert_names = ["alertChk", "sns_test_alert", "multirange_alert"];
            for alert in list {
                if let Some(name) = alert.get("name").and_then(|n| n.as_str())
                    && alert_names.contains(&name)
                    && let Some(id) = alert.get("alert_id").and_then(|id| id.as_str())
                {
                    let _ = make_request(
                        &app,
                        Method::DELETE,
                        &format!("/api/v2/e2e/alerts/{}?type=logs", id),
                        Some(headers.clone()),
                        None,
                    )
                    .await;
                    log::info!("Cleanup: deleted alert {}", name);
                }
            }
        }

        // 2. Delete destinations (they reference templates)
        for dest in ["slack", "email", "sns_alert"] {
            let _ = make_request(
                &app,
                Method::DELETE,
                &format!("/api/e2e/alerts/destinations/{}", dest),
                Some(headers.clone()),
                None,
            )
            .await;
        }

        // 3. Delete templates last
        for template in ["slackTemplate", "email_template", "snsTemplate"] {
            let _ = make_request(
                &app,
                Method::DELETE,
                &format!("/api/e2e/alerts/templates/{}", template),
                Some(headers.clone()),
                None,
            )
            .await;
        }

        // 4. Delete user if exists
        let _ = make_request(
            &app,
            Method::DELETE,
            "/api/e2e/users/nonadmin@example.com",
            Some(headers.clone()),
            None,
        )
        .await;

        log::info!("Cleanup: finished cleaning up previous test state");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn e2e_test() {
        let sandbox = Sandbox::create().await;
        setup();
        sandbox.assert_config_uses_it();

        // start gRPC server
        tokio::task::spawn(async move {
            init_grpc_server()
                .await
                .expect("router gRPC server init failed");
        });

        // register node
        common::infra::cluster::register_and_keep_alive()
            .await
            .unwrap();
        // init config
        config::init().await.unwrap();
        // init infra
        migration::init_db().await.unwrap();
        // ensure database tables are created
        infra::db::create_table().await.unwrap();
        // db migration steps, since it's separated out
        infra::table::migrate().await.unwrap();
        infra::init().await.unwrap();
        #[cfg(feature = "enterprise")]
        let master_key = Some(
            o2_enterprise::enterprise::common::config::get_config()
                .encryption
                .master_key
                .clone(),
        );
        #[cfg(not(feature = "enterprise"))]
        let master_key: Option<String> = None;
        infra::table::cipher::boot(master_key.as_deref())
            .await
            .unwrap();
        openobserve_core::bootstrap::init().await.unwrap();
        // ingester init
        ingester::init().await.unwrap();
        // init job
        openobserve_jobs::job::init().await.unwrap();

        // Wait for async initialization tasks (like default user creation) to complete
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Clean up any leftover state from previous test runs/retries
        // This ensures tests are idempotent
        cleanup_previous_test_state().await;

        for _i in 0..3 {
            e2e_1_post_bulk().await;
        }

        // Flush memtable after bulk ingestion to ensure proper test isolation
        // This prevents memtable overflow when subsequent tests try to ingest data
        flush_memtable().await;

        // ingest
        e2e_post_json().await;
        e2e_post_multi().await;
        e2e_post_trace().await;
        e2e_post_metrics().await;
        e2e_post_hec().await;
        // e2e_post_kinesis_data().await;

        // streams
        e2e_get_stream().await;
        e2e_get_stream_schema().await;
        e2e_get_org_summary().await;
        e2e_post_stream_settings().await;
        e2e_get_es_settings().await;

        // functions
        e2e_post_function().await;
        e2e_list_functions().await;
        e2e_delete_function().await;

        // search
        e2e_search().await;
        e2e_search_around().await;

        // users
        e2e_post_user().await;
        e2e_update_user().await;
        e2e_update_user_with_empty().await;
        e2e_add_user_to_org().await;
        e2e_add_root_user_to_org().await;
        e2e_list_users().await;
        e2e_get_organizations().await;
        e2e_get_user_passcode().await;
        e2e_update_user_passcode().await;
        e2e_user_authentication().await;
        e2e_user_authentication_with_error().await;

        // dashboards
        {
            let board = e2e_create_dashboard().await;
            let list = e2e_list_dashboards().await;
            assert_eq!(list[0], board);

            let mut v5_board = board.v5.unwrap();
            v5_board.title = "e2e test".to_owned();
            v5_board.description = "Logs flow downstream".to_owned();

            let board = e2e_update_dashboard(v5_board, board.hash).await;
            assert_eq!(
                e2e_get_dashboard(&board.v5.as_ref().unwrap().dashboard_id).await,
                board
            );
            e2e_delete_dashboard(&board.v5.unwrap().dashboard_id).await;
            assert!(e2e_list_dashboards().await.is_empty());
        }

        // A panel whose column is wrapped in a cast must come back with the
        // nesting intact — the model used to flatten it, which silently dropped
        // the y column from the query on the next edit.
        e2e_dashboard_nested_cast_round_trip().await;

        // alert
        e2e_post_alert_template().await;
        e2e_get_alert_template().await;
        e2e_list_alert_template().await;
        e2e_post_alert_destination().await;
        e2e_get_alert_destination().await;
        e2e_list_alert_destinations().await;
        e2e_post_alert_multirange().await;
        e2e_delete_alert_multirange().await;
        e2e_post_alert().await;
        e2e_get_alert().await;
        e2e_handle_alert_after_destination_retries().await;
        e2e_handle_alert_after_evaluation_retries().await;
        e2e_handle_alert_reached_max_retries().await;
        e2e_list_alerts().await;
        e2e_list_real_time_alerts().await;
        e2e_delete_alert().await;
        e2e_delete_alert_destination().await;
        e2e_delete_alert_template().await;

        // Email-specific alert tests
        e2e_post_alert_email_template().await;
        e2e_get_alert_email_template().await;
        e2e_post_alert_email_destination().await;
        e2e_get_alert_email_destination().await;
        e2e_post_alert_email_destination_should_fail().await;

        e2e_delete_alert_email_destination().await;
        e2e_delete_alert_email_template().await;

        // Clean-up user here after email destinations deleted
        e2e_delete_user().await;

        // SNS-specific alert tests
        // Set up templates
        e2e_post_alert_template().await;
        e2e_post_sns_alert_template().await;

        // SNS destination tests
        e2e_post_sns_alert_destination().await;
        e2e_get_sns_alert_destination().await;
        e2e_list_alert_destinations_with_sns().await;
        e2e_update_sns_alert_destination().await;

        // Create and test alert with SNS destination
        e2e_post_alert_with_sns_destination().await;

        // Cleanup
        e2e_delete_alert_with_sns_destination().await;
        e2e_delete_sns_alert_destination().await;

        // derived streams
        e2e_create_test_pipeline().await;
        e2e_handle_derived_stream_success().await;
        e2e_handle_derived_stream_pipeline_not_found().await;
        e2e_handle_derived_stream_max_retries().await;
        test_derived_stream_invalid_timerange_delay_scenario().await;
        test_derived_stream_invalid_timerange_with_cron_frequency().await;
        e2e_handle_derived_stream_evaluation_failure().await;
        e2e_cleanup_test_pipeline().await;

        // enrichment table
        test_enrichment_table_integration().await;
        test_enrichment_table_local_all_sequential().await;

        // backfill jobs
        test_backfill_job_list_and_delete().await;
        test_backfill_job_get_nonexistent().await;
        test_backfill_job_delete_by_pipeline().await;
        test_backfill_job_enable_disable().await;

        // Own fn: inline spawns widen e2e_test's frame and overflow the debug stack.
        e2e_org_deletion().await;

        // others
        e2e_health_check().await;
        e2e_config().await;

        // clear
        e2e_delete_stream().await;
        sandbox.tear_down().await;
    }

    async fn e2e_org_deletion() {
        // org deletion: each runs in its own task so one red test does not hide the others
        let saved_config = config::CONFIG.load_full();
        set_cleanup_test_config(0);
        // A worker poll already sleeping when the pause lands still runs once.
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
        let mut failed = Vec::new();
        let file_list = tokio::spawn(e2e_file_list_step_moves_every_stream_to_deleted()).await;
        if file_list.is_err() {
            failed.push("e2e_file_list_step_moves_every_stream_to_deleted");
        }
        if tokio::spawn(e2e_public_paths_refuse_blocked_org())
            .await
            .is_err()
        {
            failed.push("e2e_public_paths_refuse_blocked_org");
        }
        #[cfg(feature = "enterprise")]
        if tokio::spawn(e2e_incident_webhook_refuses_inactive_org())
            .await
            .is_err()
        {
            failed.push("e2e_incident_webhook_refuses_inactive_org");
        }
        if tokio::spawn(e2e_org_delete_completes()).await.is_err() {
            failed.push("e2e_org_delete_completes");
        }
        if tokio::spawn(e2e_online_eval_runner_skips_deleting_org())
            .await
            .is_err()
        {
            failed.push("e2e_online_eval_runner_skips_deleting_org");
        }
        #[cfg(feature = "enterprise")]
        if tokio::spawn(e2e_host_routed_status_page_refuses_blocked_org())
            .await
            .is_err()
        {
            failed.push("e2e_host_routed_status_page_refuses_blocked_org");
        }
        if tokio::spawn(e2e_org_delete_removes_memberships())
            .await
            .is_err()
        {
            failed.push("e2e_org_delete_removes_memberships");
        }
        if tokio::spawn(e2e_meta_prefix_reads_are_org_exact())
            .await
            .is_err()
        {
            failed.push("e2e_meta_prefix_reads_are_org_exact");
        }
        if tokio::spawn(e2e_org_delete_rejects_old_credentials())
            .await
            .is_err()
        {
            failed.push("e2e_org_delete_rejects_old_credentials");
        }
        if tokio::spawn(e2e_org_setting_writers_do_not_lose_updates())
            .await
            .is_err()
        {
            failed.push("e2e_org_setting_writers_do_not_lose_updates");
        }
        if tokio::spawn(e2e_ingestion_blocked_during_deletion())
            .await
            .is_err()
        {
            failed.push("e2e_ingestion_blocked_during_deletion");
        }
        #[cfg(feature = "enterprise")]
        if tokio::spawn(test_initiate_refused_under_super_cluster())
            .await
            .is_err()
        {
            failed.push("test_initiate_refused_under_super_cluster");
        }
        if tokio::spawn(e2e_drain_retry_keeps_attempts_at_zero())
            .await
            .is_err()
        {
            failed.push("e2e_drain_retry_keeps_attempts_at_zero");
        }
        if tokio::spawn(e2e_drain_stalled_row_is_marked_failed())
            .await
            .is_err()
        {
            failed.push("e2e_drain_stalled_row_is_marked_failed");
        }
        if tokio::spawn(e2e_drain_keeps_rows_when_an_object_cannot_be_deleted())
            .await
            .is_err()
        {
            failed.push("e2e_drain_keeps_rows_when_an_object_cannot_be_deleted");
        }
        if tokio::spawn(e2e_drain_refuses_an_unloaded_storage_account())
            .await
            .is_err()
        {
            failed.push("e2e_drain_refuses_an_unloaded_storage_account");
        }
        if tokio::spawn(e2e_drain_failure_spends_an_attempt_each_pass())
            .await
            .is_err()
        {
            failed.push("e2e_drain_failure_spends_an_attempt_each_pass");
        }
        if tokio::spawn(e2e_resurrect_releases_parked_triggers())
            .await
            .is_err()
        {
            failed.push("e2e_resurrect_releases_parked_triggers");
        }
        if tokio::spawn(e2e_blocked_org_reaches_only_its_cleanup_retry())
            .await
            .is_err()
        {
            failed.push("e2e_blocked_org_reaches_only_its_cleanup_retry");
        }
        if tokio::spawn(e2e_compactor_pass_keeps_rows_of_a_deleting_org())
            .await
            .is_err()
        {
            failed.push("e2e_compactor_pass_keeps_rows_of_a_deleting_org");
        }
        if tokio::spawn(e2e_compactor_pass_refuses_an_unloaded_account_of_a_deleting_org())
            .await
            .is_err()
        {
            failed.push("e2e_compactor_pass_refuses_an_unloaded_account_of_a_deleting_org");
        }
        if tokio::spawn(e2e_compactor_removal_waits_for_deletion_start())
            .await
            .is_err()
        {
            failed.push("e2e_compactor_removal_waits_for_deletion_start");
        }
        if tokio::spawn(e2e_retry_backfills_missing_steps_and_resets_attempts())
            .await
            .is_err()
        {
            failed.push("e2e_retry_backfills_missing_steps_and_resets_attempts");
        }
        if tokio::spawn(e2e_scan_failed_sets_gauge_and_emits_once())
            .await
            .is_err()
        {
            failed.push("e2e_scan_failed_sets_gauge_and_emits_once");
        }
        if tokio::spawn(e2e_reconcile_requeues_deleting_org_without_tasks())
            .await
            .is_err()
        {
            failed.push("e2e_reconcile_requeues_deleting_org_without_tasks");
        }
        if tokio::spawn(e2e_delete_org_record_is_idempotent())
            .await
            .is_err()
        {
            failed.push("e2e_delete_org_record_is_idempotent");
        }
        if tokio::spawn(e2e_initiate_rolls_back_status_when_add_batch_fails())
            .await
            .is_err()
        {
            failed.push("e2e_initiate_rolls_back_status_when_add_batch_fails");
        }
        if tokio::spawn(e2e_org_delete_retry_after_exhaustion())
            .await
            .is_err()
        {
            failed.push("e2e_org_delete_retry_after_exhaustion");
        }
        if tokio::spawn(e2e_two_workers_never_run_one_step_twice())
            .await
            .is_err()
        {
            failed.push("e2e_two_workers_never_run_one_step_twice");
        }
        config::CONFIG.store(saved_config);
        assert!(failed.is_empty(), "org deletion e2e failed: {failed:?}");
    }

    fn run_suffix() -> String {
        (Utc::now().timestamp_micros() % 1_000_000_000).to_string()
    }

    /// Ingests one record so the org is auto-created (`ZO_CREATE_ORG_THROUGH_INGESTION`).
    async fn ingest_one(app: &Router, headers: &HeaderMap, org: &str) {
        let (status, body) = make_request(
            app,
            Method::POST,
            &format!("/api/{org}/orgdel/_json"),
            Some(headers.clone()),
            Some(r#"[{"a":1}]"#.to_string()),
        )
        .await;
        assert!(
            status.is_success(),
            "ingest into {org}: {status} {}",
            String::from_utf8_lossy(&body)
        );
        flush_memtable().await;
    }

    /// Pauses the background cleanup and promotion jobs, so only the test drives them.
    fn set_cleanup_test_config(delete_files_delay_minutes: i64) {
        let mut cfg = config::config::init();
        cfg.common.org_cleanup_poll_interval_secs = 0;
        // Set here, not by env: config raises a delay below 1 minute to 120.
        cfg.compact.delete_files_delay_minutes = delete_files_delay_minutes;
        config::CONFIG.store(Arc::new(cfg));
    }

    async fn run_cleanup_once() {
        let cleanup: Arc<dyn openobserve_core::org_cleanup::StreamDataCleanup> =
            Arc::new(openobserve_jobs::job::CompactionStreamDataCleanup);
        openobserve_core::org_cleanup::run_once(cleanup).await;
    }

    async fn cleanup_task(org: &str, step: &str) -> infra::table::org_cleanup_tasks::CleanupTask {
        infra::table::org_cleanup_tasks::list_by_org_status(org, None)
            .await
            .unwrap()
            .into_iter()
            .find(|t| t.step == step)
            .unwrap_or_else(|| panic!("{org} has no {step} task"))
    }

    async fn add_tasks(org: &str, steps: &[(&str, i32)]) {
        let tasks: Vec<_> = steps
            .iter()
            .map(
                |(step, order)| infra::table::org_cleanup_tasks::NewCleanupTask {
                    org_id: org.to_string(),
                    org_name: org.to_string(),
                    step: step.to_string(),
                    step_order: *order,
                },
            )
            .collect();
        infra::table::org_cleanup_tasks::add_batch(&tasks)
            .await
            .unwrap();
    }

    /// Spends every attempt of the step the way the worker does: claim, then fail.
    async fn exhaust_task(org: &str, step: &str) {
        let id = cleanup_task(org, step).await.id;
        for _ in 0..10 {
            let claim = infra::table::org_cleanup_tasks::mark_running(&id)
                .await
                .unwrap()
                .expect("an idle task can be claimed");
            assert!(
                infra::table::org_cleanup_tasks::mark_failed(&claim, "e2e failure")
                    .await
                    .unwrap()
            );
        }
    }

    fn deleted_file(org: &str, name: &str) -> config::meta::stream::FileListDeleted {
        config::meta::stream::FileListDeleted {
            file: format!("files/{org}/logs/s1/2026/01/01/00/{name}.parquet"),
            ..Default::default()
        }
    }

    async fn remove_deleted_rows(org: &str) {
        let rows = infra::file_list::query_deleted(org, i64::MAX, 1000)
            .await
            .unwrap();
        let keys: Vec<_> = rows
            .into_iter()
            .map(|r| {
                config::meta::stream::FileKey::new(
                    r.id,
                    r.account,
                    r.file,
                    config::meta::stream::FileMeta::default(),
                    false,
                )
            })
            .collect();
        infra::file_list::batch_remove_deleted(&keys).await.unwrap();
    }

    async fn add_deleting_org(org: &str) {
        infra::table::organizations::add(
            org,
            org,
            config::meta::organization::OrganizationType::Default,
        )
        .await
        .unwrap();
        infra::table::organizations::set_status(org, "deleting")
            .await
            .unwrap();
    }

    async fn org_status_of(org: &str) -> Option<String> {
        infra::table::organizations::get_status_uncached(org)
            .await
            .unwrap()
    }

    fn failed_steps_gauge(org: &str) -> i64 {
        config::metrics::ORG_CLEANUP_FAILED_STEPS
            .with_label_values(&[org])
            .get()
    }

    /// A stored file of a stream without a schema, so only steps 200 and 250 can remove it.
    /// An object and its file_list row in a stream with no schema or stats row.
    async fn seed_orphan_file(org: &str, stream: &str) -> String {
        let key = format!("files/{org}/logs/{stream}/2026/01/01/00/a.parquet");
        infra::storage::put("", &key, Bytes::from_static(b"orphan"))
            .await
            .unwrap();
        let meta = config::meta::stream::FileMeta {
            min_ts: 1,
            max_ts: 2,
            records: 1,
            original_size: 6,
            compressed_size: 6,
            ..Default::default()
        };
        infra::file_list::add("", &key, &meta).await.unwrap();
        key
    }

    async fn seed_synthetic_with_children(org: &str) -> String {
        use config::meta::folder::{Folder, FolderType};
        use infra::table::{synthetics_checks, synthetics_jobs, synthetics_refs, synthetics_runs};

        let folder = Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Default::default()
        };
        let (folder_pk, ..) =
            infra::table::folders::get_or_create(org, folder, FolderType::Synthetics)
                .await
                .unwrap();
        let check = config::meta::synthetics::Synthetic {
            name: "orgdel check".to_string(),
            target: "https://example.com".to_string(),
            folder_id: folder_pk.to_string(),
            ..Default::default()
        };
        let conn = infra::db::get_orm_client_rw().await;
        let check = synthetics_checks::create(conn, org, check, false)
            .await
            .unwrap();
        let now = Utc::now().timestamp_micros();
        let run_id = config::ider::generate();
        synthetics_runs::insert_run(
            conn,
            synthetics_runs::InsertRunParams {
                id: &run_id,
                synthetics_id: &check.id,
                org_id: org,
                scheduled_ts: now,
                trigger_type: "manual",
                job_count: 1,
                created_at: now,
            },
        )
        .await
        .unwrap();
        synthetics_jobs::enqueue(
            conn,
            synthetics_jobs::EnqueueParams {
                synthetics_id: &check.id,
                synthetics_name: &check.name,
                org_id: org,
                location: "local",
                env: None,
                pool: "default",
                scheduled_ts: now,
                valid_until: now + 60_000_000,
                run_id: &run_id,
                browser_devices: None,
                steps_configured: 1,
                metadata: "{}",
            },
        )
        .await
        .unwrap();
        synthetics_refs::replace_for_parent(conn, org, &check.id, &["orgdel-child".to_string()])
            .await
            .unwrap();
        check.id
    }

    async fn count_org_rows(table: &str, org: &str) -> i64 {
        use sea_orm::{ConnectionTrait, Statement};

        let conn = infra::db::get_orm_client_ro().await;
        let row = conn
            .query_one(Statement::from_sql_and_values(
                conn.get_database_backend(),
                format!("SELECT COUNT(*) AS n FROM {table} WHERE org_id = $1"),
                [org.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        row.try_get("", "n").unwrap()
    }

    async fn count_rows(table: &str, column: &str, value: &str) -> i64 {
        use sea_orm::{ConnectionTrait, Statement};

        let conn = infra::db::get_orm_client_ro().await;
        let row = conn
            .query_one(Statement::from_sql_and_values(
                conn.get_database_backend(),
                format!("SELECT COUNT(*) AS n FROM {table} WHERE {column} = $1"),
                [value.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        row.try_get("", "n").unwrap()
    }

    async fn insert_entity_row<E>(row: serde_json::Value)
    where
        E: sea_orm::EntityTrait,
        E::Model: serde::de::DeserializeOwned + sea_orm::IntoActiveModel<E::ActiveModel>,
    {
        use sea_orm::IntoActiveModel;

        let model: E::Model = serde_json::from_value(row).unwrap();
        E::insert(model.into_active_model())
            .exec_without_returning(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    async fn seed_coverage_rows(org: &str) -> CoverageRows {
        let check_id = seed_synthetic_with_children(org).await;
        seed_status_page_rows(org, &check_id).await;
        let integration_id = seed_incident_rows(org).await;
        let (probe_token, agent_id, location_id) = seed_synthetics_registry_rows(org).await;
        let workflow_id = seed_workflow_rows(org).await;
        let anomaly_id = seed_anomaly_rows(org).await;
        let artifact = format!("synthetics/{org}/{check_id}/run1/screenshot.png");
        infra::storage::put("", &artifact, Bytes::from_static(b"png"))
            .await
            .unwrap();
        let pricing_model = seed_llm_rows(org).await;
        let (team_id, response_id, policy_id) = seed_oncall_rows(org).await;
        seed_ai_chat_rows(org).await;
        let dek = infra::table::cipher::get_dek(org).await.unwrap();
        CoverageRows {
            check_id,
            integration_id,
            anomaly_id,
            workflow_id,
            probe_token,
            agent_id,
            location_id,
            artifact,
            pricing_model,
            team_id,
            response_id,
            policy_id,
            dek,
        }
    }

    async fn insert_active<A>(row: A)
    where
        A: sea_orm::ActiveModelTrait,
        <A::Entity as sea_orm::EntityTrait>::Model: sea_orm::IntoActiveModel<A>,
    {
        use sea_orm::EntityTrait;

        <A::Entity as EntityTrait>::insert(row)
            .exec_without_returning(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
    }

    async fn seed_llm_rows(org: &str) -> String {
        use infra::table::entity::{
            llm_annotation_queue_bindings, llm_annotation_queue_items, llm_annotation_queues,
            llm_dataset_items, llm_datasets, llm_experiment_slot_retries, llm_experiments,
            llm_idempotency_records, llm_playground_snapshots, score_configs,
        };
        use sea_orm::Set;

        let now = Utc::now().timestamp_micros();
        let id = config::ider::generate;
        let (dataset, queue, score_config, experiment) = (id(), id(), id(), id());
        insert_active(llm_datasets::ActiveModel {
            id: Set(dataset.clone()),
            org_id: Set(org.to_string()),
            name: Set(format!("orgdel {dataset}")),
            global_version: Set(1),
            created_by: Set("root@example.com".to_string()),
            created_at: Set(now),
            updated_by: Set("root@example.com".to_string()),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_dataset_items::ActiveModel {
            row_id: Set(id()),
            logical_id: Set(id()),
            org_id: Set(org.to_string()),
            dataset_id: Set(dataset.clone()),
            input: Set(json!({"q": "a"})),
            expected_output: Set(json!({"a": "b"})),
            global_version: Set(1),
            is_deleted: Set(false),
            source: Set("manual".to_string()),
            updated_by: Set("root@example.com".to_string()),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_annotation_queues::ActiveModel {
            id: Set(queue.clone()),
            org_id: Set(org.to_string()),
            name: Set(format!("orgdel {queue}")),
            allowed_ref_types: Set(json!(["trace"])),
            created_by: Set("root@example.com".to_string()),
            created_at: Set(now),
            updated_by: Set("root@example.com".to_string()),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_annotation_queue_items::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            queue_id: Set(queue.clone()),
            ref_type: Set("trace".to_string()),
            ref_id: Set(id()),
            ref_trace_start_time: Set(now),
            status: Set("pending".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(score_configs::ActiveModel {
            id: Set(score_config.clone()),
            org_id: Set(org.to_string()),
            entity_id: Set(id()),
            name: Set(format!("orgdel {score_config}")),
            version: Set(1),
            data_type: Set("numeric".to_string()),
            is_active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_annotation_queue_bindings::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            queue_id: Set(queue),
            score_config_row_id: Set(score_config),
            created_at: Set(now),
        })
        .await;
        insert_active(llm_experiments::ActiveModel {
            id: Set(experiment.clone()),
            org_id: Set(org.to_string()),
            name: Set(format!("orgdel {experiment}")),
            dataset_id: Set(dataset),
            dataset_version: Set(1),
            task_config: Set(json!({})),
            scorers: Set(json!([])),
            trial_count: Set(1),
            status: Set("completed".to_string()),
            deadline_at: Set(now),
            lifecycle_version: Set(1),
            retry_count: Set(0),
            is_baseline: Set(false),
            created_by: Set("root@example.com".to_string()),
            created_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_experiment_slot_retries::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            experiment_id: Set(experiment),
            row_id: Set(id()),
            trial_index: Set(0),
            idempotency_key: Set(id()),
            state: Set("done".to_string()),
            execution: Set(json!({})),
            created_at: Set(now),
            updated_at: Set(now),
            expires_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_idempotency_records::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            scope: Set("experiment".to_string()),
            idempotency_key: Set(id()),
            request_hash: Set("h".to_string()),
            response: Set(json!({})),
            created_at: Set(now),
            expires_at: Set(now),
        })
        .await;
        insert_active(llm_playground_snapshots::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            payload: Set(json!({})),
            created_by: Set("root@example.com".to_string()),
            created_at: Set(now),
            last_accessed_at: Set(now),
            ..Default::default()
        })
        .await;
        seed_eval_job(org, now).await;
        seed_ai_rows(org, now).await;
        seed_pricing_and_rate_limit(org, now).await
    }

    async fn seed_eval_job(org: &str, now: i64) -> String {
        use infra::table::entity::online_eval_jobs;
        use sea_orm::Set;

        let eval_job_id = config::ider::generate();
        insert_active(online_eval_jobs::ActiveModel {
            id: Set(eval_job_id.clone()),
            org_id: Set(org.to_string()),
            name: Set(format!("orgdel {eval_job_id}")),
            stream: Set("orgdel".to_string()),
            stream_type: Set("traces".to_string()),
            target_scope: Set("trace".to_string()),
            filter_condition: Set(json!({})),
            scorers: Set(json!([])),
            sampling_mode: Set("rate".to_string()),
            sampling_value: Set(json!(0)),
            status: Set("active".to_string()),
            version: Set(1),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        eval_job_id
    }

    async fn seed_ai_rows(org: &str, now: i64) {
        use infra::table::entity::{
            gen_ai_agents, llm_secrets, org_ai_toolsets, providers, scorers,
        };
        use sea_orm::Set;

        let id = config::ider::generate;
        insert_active(scorers::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            entity_id: Set(id()),
            name: Set(format!("orgdel {}", id())),
            version: Set(1),
            scorer_type: Set(scorers::ScorerType::LlmJudge),
            template: Set("t".to_string()),
            params: Set(json!({})),
            is_active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(providers::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            name: Set(format!("orgdel {}", id())),
            provider_type: Set("openai".to_string()),
            default_model: Set("gpt".to_string()),
            available_models: Set(json!(["gpt"])),
            is_default: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(llm_secrets::ActiveModel {
            id: Set(id()),
            secret_ref: Set(id()),
            org_id: Set(org.to_string()),
            owner_kind: Set("provider".to_string()),
            owner_id: Set(id()),
            purpose: Set("api_key".to_string()),
            state: Set("active".to_string()),
            ciphertext: Set("c".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(org_ai_toolsets::ActiveModel {
            id: Set(id()),
            org: Set(org.to_string()),
            name: Set(format!("orgdel {}", id())),
            kind: Set("mcp".to_string()),
            created_by: Set("root@example.com".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(gen_ai_agents::ActiveModel {
            agent_key: Set(id()),
            org_id: Set(org.to_string()),
            stream_type: Set("traces".to_string()),
            stream_name: Set("orgdel".to_string()),
            identity_source: Set("attribute".to_string()),
            first_seen: Set(now),
            last_seen: Set(now),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        #[cfg(feature = "enterprise")]
        insert_active(infra::table::entity::llm_remote_tasks::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            entity_id: Set(id()),
            name: Set(format!("orgdel {}", id())),
            version: Set(1),
            endpoint: Set("https://dummy/task".to_string()),
            http_method: Set("POST".to_string()),
            auth: Set(json!({})),
            custom_headers: Set(json!({})),
            content_type: Set("application/json".to_string()),
            response_schema: Set("{}".to_string()),
            timeout_ms: Set(1000),
            retry_policy: Set(json!({})),
            max_concurrency: Set(1),
            signing: Set(json!({})),
            verification_status: Set("unverified".to_string()),
            is_active: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
    }

    async fn seed_pricing_and_rate_limit(org: &str, now: i64) -> String {
        use config::meta::model_pricing::{ModelPricingDefinition, PricingTierDefinition};
        use sea_orm::Set;

        let pricing_model = format!("orgdel-model-{org}");
        infra::table::model_pricing::put(ModelPricingDefinition {
            org_id: org.to_string(),
            name: pricing_model.clone(),
            match_pattern: "(?i)^orgdel".to_string(),
            enabled: true,
            tiers: vec![PricingTierDefinition {
                name: "Default".to_string(),
                condition: None,
                prices: Default::default(),
                utc_windows: Vec::new(),
                rules: Vec::new(),
                priority: 0,
            }],
            ..Default::default()
        })
        .await
        .unwrap();
        insert_active(infra::table::entity::rate_limit_rules::ActiveModel {
            rule_id: Set(config::ider::generate()),
            org: Set(org.to_string()),
            rule_type: Set("exact".to_string()),
            user_role: Set("admin".to_string()),
            user_id: Set(".*".to_string()),
            api_group_name: Set("logs".to_string()),
            api_group_operation: Set("list".to_string()),
            threshold: Set(10),
            stat_interval_ms: Set(1000),
            created_at: Set(now),
        })
        .await;
        pricing_model
    }

    /// A chat with a revoked share and a turn record, as a persisted AI chat leaves them.
    async fn seed_ai_chat_rows(org: &str) {
        use infra::table::{ai_chat_sessions, ai_chat_shares, ai_chat_turns};

        let now = Utc::now().timestamp_micros();
        let session = config::ider::uuid();
        ai_chat_sessions::get_or_create(org, &session, "orgdel-user", "a@x", "o2-ai", now)
            .await
            .unwrap();
        let share = ai_chat_shares::NewShare {
            org_id: org,
            session_id: &session,
            created_by: "orgdel-user",
            mode: ai_chat_shares::MODE_LIVE,
            snapshot_seq: None,
            visibility: ai_chat_shares::VISIBILITY_ORG,
            expires_at: None,
            redact_tools: false,
            hide_attachments: false,
        };
        let share = ai_chat_shares::insert(&share, now).await.unwrap();
        ai_chat_shares::revoke(org, &share.id, now).await.unwrap();
        ai_chat_turns::admit(org, &session, "orgdel-turn", 0, now)
            .await
            .unwrap();
        // Deleted by their user before: one the sweep still re-purges, one past that window.
        let window = ai_chat_sessions::REPLICA_REPURGE_WINDOW_MICROS;
        for purged_at in [now, now - window - 1] {
            let session = config::ider::uuid();
            ai_chat_sessions::get_or_create(org, &session, "orgdel-user", "a@x", "o2-ai", now)
                .await
                .unwrap();
            assert!(
                ai_chat_sessions::mark_deleted(org, &session, "orgdel-user", now)
                    .await
                    .unwrap()
            );
            ai_chat_sessions::mark_replica_purged(org, &session, purged_at)
                .await
                .unwrap();
        }
    }

    /// Chat rows step 300 removes: all but deleted chats the retention sweep still re-purges.
    async fn count_unheld_chats(org: &str) -> i64 {
        use sea_orm::{ConnectionTrait, Statement};

        let repurge_since = Utc::now().timestamp_micros()
            - infra::table::ai_chat_sessions::REPLICA_REPURGE_WINDOW_MICROS;
        let conn = infra::db::get_orm_client_ro().await;
        let row = conn
            .query_one(Statement::from_sql_and_values(
                conn.get_database_backend(),
                "SELECT COUNT(*) AS n FROM ai_chat_sessions WHERE org_id = $1 \
                 AND (status <> 'deleted' OR replica_purged_at IS NULL OR replica_purged_at <= $2)",
                [org.into(), repurge_since.into()],
            ))
            .await
            .unwrap()
            .unwrap();
        row.try_get("", "n").unwrap()
    }

    async fn seed_oncall_rows(org: &str) -> (String, String, String) {
        use infra::table::entity::{
            oncall_delivery_reads, oncall_overrides, oncall_ownership_rules, oncall_policies,
            oncall_response_events, oncall_response_reports, oncall_responses,
            oncall_routing_config, oncall_schedules, oncall_team_members, oncall_teams,
            oncall_unavailability, oncall_unrouted_signals, oncall_user_contacts,
        };
        use sea_orm::Set;

        let now = Utc::now().timestamp_micros();
        let id = config::ider::generate;
        let who = || "oncall@example.com".to_string();
        let (team, response, policy) = (id(), id(), id());
        insert_active(oncall_teams::ActiveModel {
            id: Set(team.clone()),
            org_id: Set(org.to_string()),
            name: Set(format!("orgdel {team}")),
            timezone: Set("UTC".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(oncall_team_members::ActiveModel {
            id: Set(id()),
            team_id: Set(team.clone()),
            user_email: Set(who()),
            created_at: Set(now),
        })
        .await;
        insert_active(oncall_schedules::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            team_id: Set(team.clone()),
            timezone: Set("UTC".to_string()),
            rotations: Set("[]".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
        })
        .await;
        insert_active(oncall_overrides::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            team_id: Set(team.clone()),
            rotation_id: Set(id()),
            user_email: Set(who()),
            start_at: Set(now),
            end_at: Set(now + 1),
            created_by: Set(who()),
            created_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(oncall_policies::ActiveModel {
            id: Set(policy.clone()),
            org_id: Set(org.to_string()),
            team_id: Set(team.clone()),
            rungs: Set("[]".to_string()),
            destinations: Set("[]".to_string()),
            l0_json: Set("{}".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
        })
        .await;
        insert_active(oncall_ownership_rules::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            team_id: Set(team.clone()),
            path: Set("orgdel".to_string()),
            dimensions: Set("{}".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
        })
        .await;
        insert_active(oncall_routing_config::ActiveModel {
            org_id: Set(org.to_string()),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(oncall_responses::ActiveModel {
            id: Set(response.clone()),
            org_id: Set(org.to_string()),
            subject_type: Set(0),
            subject_id: Set(id()),
            responder_role: Set(0),
            priority: Set(0),
            state: Set(0),
            opened_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        let event = id();
        insert_active(oncall_response_events::ActiveModel {
            id: Set(event.clone()),
            response_id: Set(response.clone()),
            kind: Set(0),
            at: Set(now),
            actor: Set(who()),
            body: Set("{}".to_string()),
            ..Default::default()
        })
        .await;
        insert_active(oncall_response_reports::ActiveModel {
            org_id: Set(org.to_string()),
            response_id: Set(response.clone()),
            report: Set("{}".to_string()),
            generated_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(oncall_delivery_reads::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            user_email: Set(who()),
            event_id: Set(event),
            read_at: Set(now),
        })
        .await;
        insert_active(oncall_unavailability::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            user_email: Set(who()),
            start_at: Set(now),
            end_at: Set(now + 1),
            created_by: Set(who()),
            created_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(oncall_unrouted_signals::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            path: Set(format!("orgdel/{}", id())),
            dimensions: Set("{}".to_string()),
            occurrences: Set(1),
            first_seen_at: Set(now),
            last_seen_at: Set(now),
            ..Default::default()
        })
        .await;
        insert_active(oncall_user_contacts::ActiveModel {
            id: Set(id()),
            org_id: Set(org.to_string()),
            user_email: Set(who()),
            updated_at: Set(now),
            ..Default::default()
        })
        .await;
        (team, response, policy)
    }

    async fn seed_status_page_rows(org: &str, check_id: &str) {
        use infra::table::entity::{
            status_page_component_checks, status_page_components, status_page_notice_components,
            status_page_notice_updates, status_page_notices,
        };

        let slug = insert_public_status_page(org).await;
        let page = infra::table::status_pages::get_page_by_slug_any(&slug)
            .await
            .unwrap()
            .unwrap();
        let now = Utc::now().timestamp_micros();
        let (component, notice) = (config::ider::generate(), config::ider::generate());
        insert_entity_row::<status_page_components::Entity>(json!({
            "id": component, "status_page_id": page.id, "org_id": org, "name": "api",
            "sort_order": 0, "created_at": now, "updated_at": now,
        }))
        .await;
        insert_entity_row::<status_page_component_checks::Entity>(json!({
            "id": config::ider::generate(), "component_id": component,
            "synthetics_id": check_id, "org_id": org,
        }))
        .await;
        insert_entity_row::<status_page_notices::Entity>(json!({
            "id": notice, "org_id": org, "kind": 0, "impact": 1, "source": 0,
            "title": "outage", "body": "", "state": 0, "starts_at": now, "segments": "[]",
            "excluded_from_uptime": false, "auto_recovery_streak": 0,
            "created_at": now, "updated_at": now,
        }))
        .await;
        insert_entity_row::<status_page_notice_components::Entity>(json!({
            "id": config::ider::generate(), "notice_id": notice, "component_id": component,
            "org_id": org,
        }))
        .await;
        insert_entity_row::<status_page_notice_updates::Entity>(json!({
            "id": config::ider::generate(), "notice_id": notice, "org_id": org,
            "body": "investigating", "created_at": now,
        }))
        .await;
        infra::table::status_pages::upsert_check_snooze(org, check_id, now + 60_000_000, None, now)
            .await
            .unwrap();
        infra::table::status_pages::insert_audit(
            org,
            "root@example.com",
            "create",
            Some(&notice),
            now,
        )
        .await
        .unwrap();
        let claim = infra::table::entity::status_page_custom_domains::Model {
            id: config::ider::generate(),
            org_id: org.to_string(),
            status_page_id: page.id,
            domain: format!("{org}.status.example.com"),
            verification_token: config::ider::generate(),
            verification_state: 1,
            verification_failure_reason: None,
            verified_at: Some(now),
            released_at: None,
            last_checked_at: None,
            created_at: now,
            updated_at: now,
        };
        assert!(
            infra::table::status_pages::insert_domain_if_unclaimed(&claim)
                .await
                .unwrap()
        );
    }

    async fn seed_incident_rows(org: &str) -> String {
        use infra::table::incident_integrations;
        use sea_orm::{EntityTrait, IntoActiveModel};

        let now = Utc::now().timestamp_micros();
        let integration = incident_integrations::IncidentIntegrationRecord {
            id: config::ider::generate(),
            org_id: org.to_string(),
            name: "orgdel".to_string(),
            source_type: "generic".to_string(),
            token: incident_integrations::generate_token(),
            enabled: true,
            config: json!({}),
            destinations: vec![],
            created_by: "root@example.com".to_string(),
            created_at: now,
            updated_at: now,
        };
        incident_integrations::add(&integration).await.unwrap();
        incident_integrations::touch_sender(incident_integrations::TouchSenderParams {
            integration_id: &integration.id,
            detected_source: "generic",
            sender_label: None,
            now,
            accepted: 1,
            rejected: 0,
            saw_resolved: false,
        })
        .await
        .unwrap();
        let alert = infra::table::entity::external_alerts::Model {
            id: config::ider::generate(),
            org_id: org.to_string(),
            integration_id: integration.id.clone(),
            detected_source: "generic".to_string(),
            dedup_key: "orgdel".to_string(),
            title: "orgdel".to_string(),
            severity: "critical".to_string(),
            state: "firing".to_string(),
            labels: "{}".to_string(),
            source_url: None,
            last_payload: "{}".to_string(),
            first_seen_at: now,
            last_seen_at: now,
            resolved_at: None,
        };
        infra::table::entity::external_alerts::Entity::insert(alert.into_active_model())
            .exec_without_returning(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        integration.id
    }

    async fn seed_synthetics_registry_rows(org: &str) -> (String, String, String) {
        use infra::table::{
            synthetics_agents, synthetics_environments, synthetics_locations,
            synthetics_probe_tokens, synthetics_variables,
        };

        let now = Utc::now().timestamp_micros();
        let has_default = synthetics_probe_tokens::find_default(org).await.unwrap();
        let token = synthetics_probe_tokens::SyntheticsProbeTokenRecord {
            id: config::ider::uuid(),
            org_id: org.to_string(),
            name: "orgdel".to_string(),
            token: synthetics_probe_tokens::generate_token(),
            is_default: has_default.is_none(),
            enabled: true,
            created_by: "root@example.com".to_string(),
            created_at: now,
            updated_at: now,
        };
        synthetics_probe_tokens::add(&token).await.unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let (env, _) = synthetics_environments::get_or_create_global(conn, org)
            .await
            .unwrap();
        let variable = synthetics_variables::SyntheticsVariableRecord {
            id: config::ider::generate(),
            org_id: org.to_string(),
            env: env.id,
            name: "orgdel".to_string(),
            value: "1".to_string(),
            kind: synthetics_variables::KIND_PLAIN.to_string(),
            description: String::new(),
            example: String::new(),
            tags: vec![],
            owner: None,
            created_at: now,
            updated_at: now,
        };
        synthetics_variables::add(conn, &variable).await.unwrap();
        let location_id = config::ider::generate();
        synthetics_locations::add(&synthetics_locations::SyntheticsLocationRecord {
            id: location_id.clone(),
            org_id: Some(org.to_string()),
            kind: synthetics_locations::KIND_PRIVATE.to_string(),
            provider: "self".to_string(),
            region: "local".to_string(),
            label: format!("{org} private"),
            pool: format!("private-{location_id}"),
            enabled: false,
            created_at: now,
            updated_at: now,
        })
        .await
        .unwrap();
        let agent_id = config::ider::generate();
        synthetics_agents::register(&synthetics_agents::SyntheticsAgentRecord {
            id: agent_id.clone(),
            org_id: org.to_string(),
            location_id: location_id.clone(),
            name: "orgdel-agent".to_string(),
            version: None,
            capabilities: None,
            token_id: Some(token.id),
            last_seen_at: now,
            created_at: now,
        })
        .await
        .unwrap();
        (token.token, agent_id, location_id)
    }

    async fn seed_workflow_rows(org: &str) -> String {
        use config::meta::folder::{Folder, FolderType};
        use infra::table::workflows;

        let folder = Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Default::default()
        };
        let (folder_pk, ..) =
            infra::table::folders::get_or_create(org, folder, FolderType::Workflows)
                .await
                .unwrap();
        let now = Utc::now().timestamp_micros();
        let workflow = |id: &str| workflows::Workflow {
            id: id.to_string(),
            org_id: org.to_string(),
            folder_id: folder_pk.to_string(),
            created_at: now,
            updated_at: now,
            created_by: "root@example.com".to_string(),
            enabled: false,
            name: format!("orgdel {id}"),
            description: String::new(),
            nodes: vec![],
            edges: vec![],
        };
        let id = config::ider::generate();
        workflows::save_workflow(workflow(&id)).await.unwrap();
        workflows::save_draft(workflow(&config::ider::generate()))
            .await
            .unwrap();
        let run_id = config::ider::generate();
        workflows::save_workflow_errors(workflows::WorkflowRunErrors {
            id: 0,
            cluster: "local".to_string(),
            org_id: org.to_string(),
            workflow_id: id.clone(),
            run_id: run_id.clone(),
            ran_at: now,
            data: vec![],
            input_data: None,
        })
        .await
        .unwrap();
        workflows::save_workflow_run_data(workflows::WorkflowRunData {
            id: 0,
            org_id: org.to_string(),
            workflow_id: id.clone(),
            run_id,
            triggered_at: now,
            data: "{}".to_string(),
        })
        .await
        .unwrap();
        workflows::add_workflow_association(workflows::WorkflowAssociation {
            id: 0,
            org_id: org.to_string(),
            entity_id: "orgdel-alert".to_string(),
            entity_type: "alert".to_string(),
            workflow_id: id.clone(),
            trigger_type: "manual".to_string(),
            created_at: now,
        })
        .await
        .unwrap();
        id
    }

    async fn seed_anomaly_rows(org: &str) -> String {
        use config::meta::folder::{Folder, FolderType};
        use infra::table::entity::{anomaly_detection_config, anomaly_detection_models};

        let folder = Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Default::default()
        };
        let (folder_pk, ..) = infra::table::folders::get_or_create(org, folder, FolderType::Alerts)
            .await
            .unwrap();
        let now = Utc::now().timestamp_micros();
        let anomaly_id = config::ider::generate();
        insert_entity_row::<anomaly_detection_config::Entity>(json!({
            "anomaly_id": anomaly_id, "org_id": org, "stream_name": "orgdel",
            "stream_type": "logs", "enabled": false, "name": format!("orgdel {anomaly_id}"),
            "query_mode": "filters", "detection_function": "count",
            "histogram_interval": "5m", "schedule_interval": "5m",
            "detection_window_seconds": 3600, "training_window_days": 7,
            "retrain_interval_days": 1, "threshold": 97, "seasonality": "none",
            "is_trained": true, "current_model_version": 1, "rcf_num_trees": 50,
            "rcf_tree_size": 256, "rcf_shingle_size": 1, "alert_enabled": false,
            "folder_id": folder_pk.to_string(), "status": 4, "retries": 0,
            "last_updated": now, "created_at": now, "updated_at": now,
        }))
        .await;
        insert_entity_row::<anomaly_detection_models::Entity>(json!({
            "anomaly_id": anomaly_id, "version": 1,
            "s3_path": format!("s3://bucket/anomaly_models/{org}/{anomaly_id}/1.bin.zst"),
            "s3_bucket": "bucket", "model_size_bytes": 1, "training_start_time": now,
            "training_end_time": now, "training_data_points": 1, "created_at": now,
        }))
        .await;
        #[cfg(feature = "enterprise")]
        infra::storage::put(
            "",
            &format!("anomaly_models/{org}/{anomaly_id}/1.bin.zst"),
            Bytes::from_static(b"model"),
        )
        .await
        .unwrap();
        anomaly_id
    }

    async fn coverage_counts(org: &str, rows: &CoverageRows) -> Vec<(&'static str, i64)> {
        let org_tables = [
            "ai_chat_shares",
            "ai_chat_turns",
            "status_pages",
            "status_page_snapshots",
            "status_page_components",
            "status_page_component_checks",
            "status_page_notices",
            "status_page_notice_components",
            "status_page_notice_updates",
            "status_page_check_snoozes",
            "status_page_audit_log",
            "status_page_custom_domains",
            "incident_integrations",
            "external_alerts",
            "synthetics",
            "synthetics_runs",
            "synthetics_jobs",
            "synthetics_refs",
            "synthetics_probe_tokens",
            "synthetics_variables",
            "synthetics_environments",
            "synthetics_locations",
            "synthetics_agents",
            "workflows",
            "workflow_drafts",
            "workflow_associations",
            "workflow_errors",
            "workflow_run_data",
            "anomaly_detection_config",
            "llm_annotation_queue_bindings",
            "llm_annotation_queue_items",
            "llm_annotation_queues",
            "llm_dataset_items",
            "llm_datasets",
            "llm_experiment_slot_retries",
            "llm_experiments",
            "llm_idempotency_records",
            "llm_playground_snapshots",
            "score_configs",
            "scorers",
            "online_eval_jobs",
            "providers",
            "llm_secrets",
            "gen_ai_agents",
            "oncall_teams",
            "oncall_schedules",
            "oncall_overrides",
            "oncall_policies",
            "oncall_ownership_rules",
            "oncall_routing_config",
            "oncall_responses",
            "oncall_response_reports",
            "oncall_delivery_reads",
            "oncall_unavailability",
            "oncall_unrouted_signals",
            "oncall_user_contacts",
        ];
        let mut counts = vec![("ai_chat_sessions", count_unheld_chats(org).await)];
        for table in org_tables {
            counts.push((table, count_org_rows(table, org).await));
        }
        #[cfg(feature = "enterprise")]
        counts.push((
            "llm_remote_tasks",
            count_org_rows("llm_remote_tasks", org).await,
        ));
        for table in [
            "org_ai_toolsets",
            "model_pricing",
            "rate_limit_rules",
            "cipher_keys",
        ] {
            counts.push((table, count_rows(table, "org", org).await));
        }
        counts.push((
            "oncall_team_members",
            count_rows("oncall_team_members", "team_id", &rows.team_id).await,
        ));
        counts.push((
            "oncall_response_events",
            count_rows("oncall_response_events", "response_id", &rows.response_id).await,
        ));
        // These two tables carry no org column, so they are counted by the parent row's id.
        counts.push((
            "incident_integration_senders",
            count_rows(
                "incident_integration_senders",
                "integration_id",
                &rows.integration_id,
            )
            .await,
        ));
        counts.push((
            "anomaly_detection_models",
            count_rows("anomaly_detection_models", "anomaly_id", &rows.anomaly_id).await,
        ));
        counts
    }

    async fn object_exists(key: &str) -> bool {
        infra::storage::head("", key).await.is_ok()
    }

    async fn assert_coverage(org: &str, rows: &CoverageRows, present: bool) {
        for (table, n) in coverage_counts(org, rows).await {
            assert_eq!(n > 0, present, "{table} holds {n} rows of {org}");
        }
        let workflow = infra::table::workflows::get_by_org_wid(org, &rows.workflow_id).await;
        assert_eq!(workflow.unwrap().is_some(), present, "{}", rows.workflow_id);
        assert_eq!(
            object_exists(&rows.artifact).await,
            present,
            "{}",
            rows.artifact
        );
        #[cfg(feature = "enterprise")]
        {
            let model = format!("anomaly_models/{org}/{}/1.bin.zst", rows.anomaly_id);
            assert_eq!(object_exists(&model).await, present, "{model}");
        }
    }

    async fn warm_coverage_caches(org: &str, rows: &CoverageRows) {
        use infra::table::{
            synthetics_agents, synthetics_checks, synthetics_locations, synthetics_probe_tokens,
            synthetics_variables,
        };

        let conn = infra::db::get_orm_client_ro().await;
        let cached = synthetics_checks::get_cached(conn, org, &rows.check_id).await;
        assert!(cached.unwrap().is_some());
        let token = synthetics_probe_tokens::find_global(&rows.probe_token).await;
        assert!(token.unwrap().is_some());
        let default_token = synthetics_probe_tokens::find_default(org).await;
        assert!(default_token.unwrap().is_some());
        let variables = synthetics_variables::list_cached(conn, org).await;
        assert!(!variables.unwrap().is_empty());
        let location = synthetics_locations::get(&rows.location_id).await;
        assert!(location.unwrap().is_some());
        let agent = synthetics_agents::get_cached(&rows.agent_id).await;
        assert!(agent.unwrap().is_some());
        #[cfg(feature = "enterprise")]
        {
            let workflow = db::workflows::get_workflow(org, &rows.workflow_id).await;
            assert!(workflow.unwrap().is_some());
        }
        warm_llm_and_oncall_caches(org, rows).await;
    }

    async fn warm_llm_and_oncall_caches(org: &str, rows: &CoverageRows) {
        use infra::table::{
            cipher, oncall_ownership, oncall_policies, oncall_schedules, oncall_teams,
        };

        db::model_pricing::cache().await.unwrap();
        let pricing = db::model_pricing::get_org_pricing_entries(org);
        assert!(
            pricing
                .iter()
                .any(|e| e.definition.name == rows.pricing_model)
        );
        let team = oncall_teams::get_cached(org, &rows.team_id).await;
        assert!(team.unwrap().is_some());
        assert!(oncall_teams::has_any_cached(org).await.unwrap());
        let members = oncall_teams::list_members_cached(&rows.team_id).await;
        assert!(!members.unwrap().is_empty());
        let schedule = oncall_schedules::get_by_team_cached(org, &rows.team_id).await;
        assert!(schedule.unwrap().is_some());
        let rules = oncall_ownership::list_cached(org).await;
        assert!(!rules.unwrap().is_empty());
        let policy = oncall_policies::get_or_create_cached(org, &rows.team_id).await;
        assert_eq!(policy.unwrap().id, rows.policy_id);
        assert_eq!(cipher::get_dek(org).await.unwrap(), rows.dek);
        #[cfg(feature = "enterprise")]
        {
            let org_rules = infra::table::ratelimit::list(org, None, None)
                .await
                .unwrap();
            assert!(!org_rules.is_empty());
            o2_ratelimit::dataresource::db::RATELIMIT_RULES_CACHE
                .write()
                .await
                .extend(org_rules);
        }
    }

    /// Each read below serves a cache hit while the entry lives, so `None` proves the eviction.
    async fn assert_coverage_caches_evicted(
        org: &str,
        rows: &CoverageRows,
        warmed: std::time::Instant,
    ) {
        use infra::table::{
            synthetics_agents, synthetics_checks, synthetics_locations, synthetics_probe_tokens,
            synthetics_variables,
        };

        let since = warmed.elapsed();
        let conn = infra::db::get_orm_client_ro().await;
        let cached = synthetics_checks::get_cached(conn, org, &rows.check_id).await;
        assert!(
            cached.unwrap().is_none(),
            "SYNTHETIC_CACHE kept {org} ({since:?})"
        );
        let token = synthetics_probe_tokens::find_global(&rows.probe_token).await;
        assert!(
            token.unwrap().is_none(),
            "TOKEN_CACHE kept {org} ({since:?})"
        );
        let default_token = synthetics_probe_tokens::find_default(org).await;
        assert!(
            default_token.unwrap().is_none(),
            "DEFAULT_TOKEN_CACHE kept {org} ({since:?})"
        );
        let variables = synthetics_variables::list_cached(conn, org).await;
        assert!(
            variables.unwrap().is_empty(),
            "VARIABLE_CACHE kept {org} ({since:?})"
        );
        let location = synthetics_locations::get(&rows.location_id).await;
        assert!(
            location.unwrap().is_none(),
            "LOCATIONS_CACHE kept {org} ({since:?})"
        );
        let agent = synthetics_agents::get_cached(&rows.agent_id).await;
        assert!(
            agent.unwrap().is_none(),
            "AGENT_CACHE kept {org} ({since:?})"
        );
        #[cfg(feature = "enterprise")]
        {
            let workflow = db::workflows::get_workflow(org, &rows.workflow_id).await;
            assert!(workflow.unwrap().is_none(), "workflows CACHE kept {org}");
        }
        assert_llm_and_oncall_caches_evicted(org, rows, since).await;
    }

    async fn assert_llm_and_oncall_caches_evicted(
        org: &str,
        rows: &CoverageRows,
        since: std::time::Duration,
    ) {
        use infra::table::{oncall_ownership, oncall_schedules, oncall_teams};

        let pricing = db::model_pricing::get_org_pricing_entries(org);
        assert!(
            !pricing
                .iter()
                .any(|e| e.definition.name == rows.pricing_model),
            "model pricing CACHE kept {org} ({since:?})"
        );
        let team = oncall_teams::get_cached(org, &rows.team_id).await;
        assert!(team.unwrap().is_none(), "TEAM_CACHE kept {org} ({since:?})");
        assert!(
            !oncall_teams::has_any_cached(org).await.unwrap(),
            "ORG_HAS_TEAMS_CACHE kept {org} ({since:?})"
        );
        let members = oncall_teams::list_members_cached(&rows.team_id).await;
        assert!(
            members.unwrap().is_empty(),
            "MEMBERS_CACHE kept {org} ({since:?})"
        );
        let schedule = oncall_schedules::get_by_team_cached(org, &rows.team_id).await;
        assert!(
            schedule.unwrap().is_none(),
            "SCHEDULE_CACHE kept {org} ({since:?})"
        );
        let rules = oncall_ownership::list_cached(org).await;
        assert!(
            rules.unwrap().is_empty(),
            "RULES_CACHE kept {org} ({since:?})"
        );
        #[cfg(feature = "enterprise")]
        assert!(
            !o2_ratelimit::dataresource::db::RATELIMIT_RULES_CACHE
                .read()
                .await
                .iter()
                .any(|r| r.org == org),
            "RATELIMIT_RULES_CACHE kept {org}"
        );
    }

    /// A miss here mints a new policy and DEK, so a different id or key proves the eviction.
    async fn assert_reminting_caches_evicted(org: &str, rows: &CoverageRows) {
        use infra::table::{cipher, oncall_policies, oncall_teams};

        let policy = oncall_policies::get_or_create_cached(org, &rows.team_id).await;
        let dek = cipher::get_dek(org).await.unwrap();
        oncall_teams::delete_by_org(org).await.unwrap();
        cipher::delete_by_org(org).await.unwrap();
        assert_ne!(
            policy.unwrap().id,
            rows.policy_id,
            "POLICY_CACHE kept {org}"
        );
        assert_ne!(dek, rows.dek, "DEK_CACHE kept {org}");
    }

    async fn drop_coverage_rows(org: &str, rows: &CoverageRows) {
        use infra::table::{
            anomaly_detection, external_alerts, folders, incident_integrations, status_pages,
            synthetics_agents, synthetics_checks, synthetics_environments, synthetics_locations,
            synthetics_probe_tokens, synthetics_variables, workflows,
        };

        let conn = infra::db::get_orm_client_rw().await;
        status_pages::delete_by_org(org).await.unwrap();
        incident_integrations::delete_by_org(org).await.unwrap();
        external_alerts::delete_by_org(org).await.unwrap();
        synthetics_checks::delete_by_org(org).await.unwrap();
        synthetics_probe_tokens::delete_by_org(org).await.unwrap();
        synthetics_variables::delete_by_org(conn, org)
            .await
            .unwrap();
        synthetics_environments::delete_by_org(conn, org)
            .await
            .unwrap();
        synthetics_agents::delete_by_org(org).await.unwrap();
        synthetics_locations::delete_by_org(org).await.unwrap();
        infra::storage::del_org_prefix_strict(org, &format!("synthetics/{org}/"))
            .await
            .unwrap();
        workflows::delete_children_by_org(org).await.unwrap();
        workflows::delete_drafts_by_org(org).await.unwrap();
        workflows::delete_by_org(org).await.unwrap();
        anomaly_detection::models::delete_by_org(conn, org)
            .await
            .unwrap();
        anomaly_detection::config::delete_by_org(conn, org)
            .await
            .unwrap();
        #[cfg(feature = "enterprise")]
        o2_enterprise::enterprise::anomaly_detection::storage::delete_org_models(org)
            .await
            .unwrap();
        folders::delete_by_org(org).await.unwrap();
        drop_llm_and_oncall_rows(org).await;
        assert_coverage(org, rows, false).await;
    }

    async fn drop_llm_and_oncall_rows(org: &str) {
        use infra::table::{
            ai_chat_sessions, ai_chat_shares, ai_chat_turns, cipher, gen_ai_agents, llm_eval,
            llm_secrets, oncall_teams, online_eval_jobs, org_ai_toolsets, providers, ratelimit,
            score_configs, scorers,
        };

        #[cfg(feature = "enterprise")]
        o2_enterprise::enterprise::llm_evaluations::remote_tasks::delete_all_by_org(org)
            .await
            .unwrap();
        llm_eval::delete_by_org(org).await.unwrap();
        score_configs::delete_all_by_org(org).await.unwrap();
        scorers::delete_all_by_org(org).await.unwrap();
        online_eval_jobs::delete_all_by_org(org).await.unwrap();
        providers::delete_all_by_org(org).await.unwrap();
        llm_secrets::delete_by_org(org).await.unwrap();
        org_ai_toolsets::delete_by_org(org).await.unwrap();
        gen_ai_agents::delete_by_org(org).await.unwrap();
        db::model_pricing::delete_by_org(org).await.unwrap();
        ratelimit::delete_by_org(org).await.unwrap();
        oncall_teams::delete_by_org(org).await.unwrap();
        cipher::delete_by_org(org).await.unwrap();
        ai_chat_turns::delete_by_org(org).await.unwrap();
        ai_chat_shares::delete_by_org(org).await.unwrap();
        ai_chat_sessions::delete_by_org(org).await.unwrap();
    }

    /// Rows only the deleted org gets: a dashboard made through the API, and a report on it.
    async fn seed_raw_routed_rows(app: &Router, headers: &HeaderMap, org: &str) -> String {
        use config::meta::{
            dashboards::reports::Report,
            folder::{Folder, FolderType},
        };

        let board = r#"{"version":5,"title":"orgdelBoard","dashboardId":"","description":"","role":"","owner":"root@example.com","created":"2023-03-30T07:49:41.744+00:00","tabs":[{"tabId":"tab1","name":"Main","panels":[]}]}"#;
        let (status, body) = make_request(
            app,
            Method::POST,
            &format!("/api/{org}/dashboards"),
            Some(headers.clone()),
            Some(board.to_string()),
        )
        .await;
        assert!(status.is_success(), "{}", String::from_utf8_lossy(&body));
        let dashboard: Dashboard = json::from_slice(&body).unwrap();
        let dashboard_id = dashboard.dashboard_id().unwrap().to_string();
        common::infra::config::DASHBOARD_ID_TO_ORG
            .write()
            .await
            .insert(dashboard_id.clone(), org.to_string());
        let folder = Folder {
            folder_id: String::new(),
            name: "orgdelReports".to_string(),
            description: String::new(),
            icon: None,
        };
        let folder = db::folders::save_folder(org, folder, FolderType::Reports, false)
            .await
            .unwrap();
        let report: Report = serde_json::from_value(json!({
            "name": "orgdelReport",
            "orgId": org,
            "dashboards": [{"dashboard": dashboard_id, "folder": "default", "tabs": ["tab1"]}],
            "destinations": []
        }))
        .unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        infra::table::reports::create_report(conn, &folder.folder_id, report, None)
            .await
            .unwrap();
        dashboard_id
    }

    async fn seed_shared_templates(org: &str, kept: &str) -> [String; 4] {
        use config::meta::destinations::{Destination, Module};
        use infra::table::entity::{destinations, templates};
        use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

        let conn = infra::db::get_orm_client_rw().await;
        let twin = format!("{org}Twin");
        let fallback = format!("{org}Fallback");
        let mut ids = Vec::new();
        for (owner, name) in [
            (config::DEFAULT_ORG, twin.as_str()),
            (org, twin.as_str()),
            (kept, twin.as_str()),
            (config::DEFAULT_ORG, fallback.as_str()),
        ] {
            let id = config::ider::uuid();
            templates::ActiveModel {
                id: Set(id.clone()),
                org: Set(owner.to_string()),
                name: Set(name.to_string()),
                is_default: Set(false),
                r#type: Set("http".to_string()),
                body: Set(r#"{"text":"{alert_name}"}"#.to_string()),
                title: Set(None),
                kind: Set("custom".to_string()),
            }
            .insert(conn)
            .await
            .unwrap();
            ids.push(id);
        }
        let dest = infra::table::destinations::get(org, "orgdelDest")
            .await
            .unwrap()
            .unwrap();
        let Module::Alert {
            destination_type, ..
        } = dest.module
        else {
            panic!("orgdelDest is an alert destination");
        };
        for (name, template, expected_id) in [
            ("orgdelOwnedDest", twin, &ids[2]),
            ("orgdelDefaultDest", fallback, &ids[3]),
        ] {
            infra::table::destinations::put(Destination {
                org_id: kept.to_string(),
                name: name.to_string(),
                module: Module::Alert {
                    template: Some(template),
                    destination_type: destination_type.clone(),
                },
                ..Default::default()
            })
            .await
            .unwrap();
            let stored = destinations::Entity::find()
                .filter(destinations::Column::Org.eq(kept))
                .filter(destinations::Column::Name.eq(name))
                .one(conn)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(stored.template_id.as_ref(), Some(expected_id));
        }
        ids.try_into().unwrap()
    }

    async fn assert_shared_templates(org: &str, kept: &str, ids: &[String; 4]) {
        let ids_of = |rows: Vec<(String, String)>| -> Vec<String> {
            rows.into_iter().map(|(id, _)| id).collect()
        };
        let defaults = ids_of(
            infra::table::templates::list_ids_by_org(config::DEFAULT_ORG)
                .await
                .unwrap(),
        );
        assert!(defaults.contains(&ids[0]), "the default twin was deleted");
        assert!(
            defaults.contains(&ids[3]),
            "the default fallback was deleted"
        );
        assert!(
            infra::table::templates::list_ids_by_org(org)
                .await
                .unwrap()
                .is_empty(),
            "the deleted organization's templates remain"
        );
        let survivors = infra::table::templates::list_ids_by_org(kept)
            .await
            .unwrap();
        assert!(
            ids_of(survivors).contains(&ids[2]),
            "the live twin was deleted"
        );
        for destination in ["orgdelOwnedDest", "orgdelDefaultDest"] {
            assert!(
                infra::table::destinations::get(kept, destination)
                    .await
                    .unwrap()
                    .is_some()
            );
            infra::table::destinations::delete(kept, destination)
                .await
                .unwrap();
        }
        assert!(
            !infra::table::templates::delete_by_id(org, &ids[0])
                .await
                .unwrap()
        );
        for (owner, id) in [
            (config::DEFAULT_ORG, &ids[0]),
            (kept, &ids[2]),
            (config::DEFAULT_ORG, &ids[3]),
        ] {
            assert!(
                infra::table::templates::delete_by_id(owner, id)
                    .await
                    .unwrap()
            );
        }
    }

    /// Asserts the raw-routed rows and the caches their db-layer deletes evict.
    async fn assert_raw_routed_rows(org: &str, dashboard_id: &str, present: bool) {
        use common::infra::config::{ALERTS_TEMPLATES, DASHBOARD_ID_TO_ORG, DESTINATIONS};

        let dashboard = infra::table::dashboards::get_by_id(org, dashboard_id).await;
        assert_eq!(dashboard.unwrap().is_some(), present, "dashboard of {org}");
        let mapped = DASHBOARD_ID_TO_ORG.read().await.contains_key(dashboard_id);
        assert_eq!(mapped, present, "DASHBOARD_ID_TO_ORG for {org}");
        for (table, column) in [
            ("reports", "org"),
            ("folders", "org"),
            ("destinations", "org"),
            ("templates", "org"),
        ] {
            let n = count_rows(table, column, org).await;
            assert_eq!(n > 0, present, "{table} holds {n} rows of {org}");
        }
        let destination = &format!("{org}/orgdelDest");
        let template = &format!("{org}/orgdelTemplate");
        eventually(
            &format!("DESTINATIONS and ALERTS_TEMPLATES for {org}"),
            || async move {
                DESTINATIONS.contains_key(destination) == present
                    && ALERTS_TEMPLATES.contains_key(template) == present
            },
        )
        .await;
        let org_key = format!("/organization/org/{org}");
        let coordinator = infra::db::get_coordinator().await;
        assert_eq!(
            coordinator.get(&org_key).await.is_ok(),
            present,
            "{org_key}"
        );
    }

    async fn eventually<F, Fut>(what: &str, mut check: F)
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = bool>,
    {
        for _ in 0..50 {
            if check().await {
                return;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        }
        panic!("{what} never reached the expected state");
    }

    /// Meta-store keys of Task 0.17, each under an org-exact prefix.
    fn kv_coverage_keys(org: &str) -> Vec<String> {
        vec![
            format!("/compact/organization/{org}/retention"),
            format!("/compact/files/{org}/logs/kvstream"),
            format!("/compact/downsampling/{org}/metrics/kvstream/60/10"),
            format!("/service_graph/v4/offsets/{org}/kvstream"),
            format!("/db_monitoring/offsets/{org}/kvstream"),
            format!("/metrics_members/{org}/c1"),
            format!("/metrics_leader/{org}/c1"),
            format!("/function/{org}/orgdelfn"),
            format!("/organization/setting/{org}"),
            format!("/enrichment_table_meta_stream_stats/{org}/orgdel_et"),
        ]
    }

    fn disk_cache_keys(org: &str) -> [String; 2] {
        [
            format!("results/{org}/logs/kvstream/123/1_2_0_0.json"),
            format!(
                "metrics_results/{org}/2026/01/01/00/v2_b235015c612525ad7c11c109e3fdc261_1_2_1.pb"
            ),
        ]
    }

    /// A service-graph v4 snapshot for the deleted org and for the kept one.
    fn seed_service_graph_snapshots(org: &str, kept: &str) -> [std::path::PathBuf; 2] {
        use openobserve_core::traces::service_graph::v4::resolution::{
            snapshot_path, write_snapshot_file,
        };
        let paths = [snapshot_path(org), snapshot_path(kept)];
        for path in &paths {
            write_snapshot_file(path, b"{}").unwrap();
        }
        paths
    }

    fn assert_service_graph_snapshots([gone, kept]: &[std::path::PathBuf; 2]) {
        assert!(!gone.exists(), "{} survived the deletion", gone.display());
        assert!(
            kept.exists(),
            "{} of the kept org was removed",
            kept.display()
        );
        std::fs::remove_file(kept).unwrap();
    }

    fn short_url_id(org: &str) -> String {
        format!("s{org}")
    }

    /// One key, offset, cache entry and stats row per Task 0.17 row, named after the org.
    async fn seed_kv_and_cache_rows(org: &str) {
        use config::meta::{
            function::Transform, promql::ClusterLeader, system_settings::SystemSetting,
        };

        let function = Transform {
            function: ".".to_string(),
            name: "orgdelfn".to_string(),
            params: "row".to_string(),
            num_args: 1,
            trans_type: Some(0),
            streams: None,
        };
        db::functions::set(org, "orgdelfn", &function)
            .await
            .unwrap();
        transform::QUERY_FUNCTIONS.insert(format!("{org}/orgdelfn"), function);
        db::organization::set_org_setting(org, &Default::default())
            .await
            .unwrap();
        let meta_db = infra::db::get_db().await;
        for key in &kv_coverage_keys(org)[..5] {
            meta_db
                .put(
                    key,
                    Bytes::from_static(b"1"),
                    infra::db::NO_NEED_WATCH,
                    None,
                )
                .await
                .unwrap();
        }
        db::compact::files::set_offset(org, StreamType::Logs, "kvstream", 9, Some("node"))
            .await
            .unwrap();
        let cluster = format!("{org}/c1");
        let leader = ClusterLeader {
            name: "r1".to_string(),
            last_received: 1,
            updated_by: "node".to_string(),
        };
        db::metrics::set_prom_cluster_info(&cluster, &["r1".to_string()])
            .await
            .unwrap();
        db::metrics::set_prom_cluster_leader(&cluster, &leader)
            .await
            .unwrap();
        let leaders = common::infra::config::METRIC_CLUSTER_LEADER.clone();
        leaders.write().await.insert(cluster.clone(), leader);
        let members = common::infra::config::METRIC_CLUSTER_MAP.clone();
        members
            .write()
            .await
            .insert(cluster, vec!["r1".to_string()]);
        for key in disk_cache_keys(org) {
            infra::cache::file_data::disk::set(&key, Bytes::from_static(b"{}"))
                .await
                .unwrap();
        }
        infra::cache::file_data::disk::add_result_cache_meta(&disk_cache_keys(org)[0]).await;
        seed_enrichment_and_stats_rows(org).await;
        db::kv::set(org, "orgdel_key", Bytes::from_static(b"v"))
            .await
            .unwrap();
        let setting = SystemSetting::new_org(org, "orgdel_setting", json!(1));
        db::system_settings::set(&setting).await.unwrap();
        let short_id = short_url_id(org);
        let short = infra::table::short_urls::ShortUrlRecord::new(&short_id, "https://dummy", org);
        assert!(db::short_url::set(&short_id, short).await.unwrap());
    }

    async fn seed_enrichment_and_stats_rows(org: &str) {
        use config::meta::{
            enrichment_table::EnrichmentTableUrlJob,
            stream::{EnrichmentTableMetaStreamStats, FileMeta, StreamStats},
        };

        db::enrichment_table::save_enrichment_data_to_db(
            org,
            "orgdel_et",
            &vec![json!({"a": 1})],
            1,
        )
        .await
        .unwrap();
        let job = EnrichmentTableUrlJob::new(
            org.to_string(),
            "orgdel_et".to_string(),
            "https://dummy/et.csv".to_string(),
            false,
        );
        db::enrichment_table::save_url_job(&job).await.unwrap();
        let stats = EnrichmentTableMetaStreamStats {
            start_time: 1,
            end_time: 2,
            size: 1,
        };
        db::enrichment_table::update_meta_table_stats(org, "orgdel_et", stats)
            .await
            .unwrap();
        ENRICHMENT_TABLES.insert(
            format!("{org}/enrichment_tables/orgdel_et"),
            transform::enrichment::StreamTable {
                org_id: org.to_string(),
                stream_name: "orgdel_et".to_string(),
                data: Arc::new(Vec::new()),
            },
        );
        let stats = StreamStats {
            doc_num: 1,
            file_num: 1,
            ..Default::default()
        };
        infra::file_list::set_stream_stats(org, StreamType::Logs, "kvstream", &stats, false)
            .await
            .unwrap();
        let meta = FileMeta {
            min_ts: 1,
            max_ts: 2,
            records: 1,
            original_size: 6,
            compressed_size: 6,
            ..Default::default()
        };
        let history = format!("files/{org}/logs/kvstream/2026/01/01/00/h.parquet");
        infra::file_list::add_history("", &history, &meta)
            .await
            .unwrap();
        infra::file_list::add_job(org, StreamType::Logs, "kvstream", 1)
            .await
            .unwrap();
        let error = config::meta::self_reporting::error::PipelineError::new("p", "p");
        let now = Utc::now().timestamp_micros();
        db::pipeline_errors::upsert(&format!("{org}-p"), "p", org, now, &error)
            .await
            .unwrap();
        let backfill = infra::table::backfill_jobs::BackfillJob {
            id: config::ider::generate(),
            org: org.to_string(),
            pipeline_id: format!("{org}-p"),
            start_time: 1,
            end_time: 2,
            chunk_period_minutes: None,
            delay_between_chunks_secs: None,
            delete_before_backfill: false,
            created_at: now,
            enabled: true,
        };
        db::backfill::add(backfill).await.unwrap();
    }

    /// The stored side of Task 0.17: meta keys, disk cache files, stats and rows.
    async fn assert_kv_and_cache_rows(org: &str, present: bool) {
        let meta_db = infra::db::get_db().await;
        for key in kv_coverage_keys(org) {
            assert_eq!(meta_db.get(&key).await.is_ok(), present, "{key}");
        }
        for key in disk_cache_keys(org) {
            let exists = infra::cache::file_data::disk::exist(&key).await;
            assert_eq!(exists, present, "{key}");
        }
        for (table, column) in KV_COVERAGE_TABLES {
            let n = count_rows(table, column, org).await;
            assert_eq!(n > 0, present, "{table} holds {n} rows of {org}");
        }
        let stats = infra::file_list::get_stream_stats(org, None, None).await;
        assert_eq!(!stats.unwrap().is_empty(), present, "stream stats of {org}");
    }

    /// The node-cache side of Task 0.17; a watcher-driven eviction gets a few seconds.
    async fn assert_kv_caches(org: &str, present: bool) {
        use common::infra::config::{
            KVS, METRIC_CLUSTER_LEADER, METRIC_CLUSTER_MAP, ORGANIZATION_SETTING, SHORT_URLS,
        };
        use config::meta::system_settings::SettingScope;

        let function = &format!("{org}/orgdelfn");
        let cluster = &format!("{org}/c1");
        let setting_key = &format!("/organization/setting/{org}");
        let enrichment = &format!("{org}/enrichment_tables/orgdel_et");
        let short_id = &short_url_id(org);
        let query_key = &format!("{org}_logs_kvstream_123");
        let kv_key = &format!("{org}/orgdel_key");
        eventually(&format!("Task 0.17 caches of {org}"), || async move {
            let setting = db::system_settings::get_cached(
                &SettingScope::Org,
                Some(org),
                None,
                "orgdel_setting",
            )
            .await;
            let offset =
                db::compact::files::get_offset_from_cache(org, StreamType::Logs, "kvstream").await;
            let results = infra::cache::file_data::disk::QUERY_RESULT_CACHE
                .read()
                .await
                .contains_key(query_key);
            [
                transform::QUERY_FUNCTIONS.contains_key(function),
                ORGANIZATION_SETTING.read().await.contains_key(setting_key),
                METRIC_CLUSTER_LEADER.read().await.contains_key(cluster),
                METRIC_CLUSTER_MAP.read().await.contains_key(cluster),
                offset.is_some(),
                KVS.contains_key(kv_key),
                setting.is_some(),
                SHORT_URLS.contains_key(short_id),
                ENRICHMENT_TABLES.contains_key(enrichment),
                results,
            ]
            .iter()
            .all(|held| *held == present)
        })
        .await;
    }

    /// Removes the surviving org's Task 0.17 rows through the same deletes the cleanup runs.
    async fn drop_kv_and_cache_rows(org: &str) {
        db::functions::delete_by_org(org).await.unwrap();
        db::organization::delete_org_setting(org).await.unwrap();
        db::compact::files::delete_by_org(org).await.unwrap();
        db::metrics::delete_by_org(org).await.unwrap();
        let meta_db = infra::db::get_db().await;
        for key in kv_coverage_keys(org) {
            meta_db.delete_if_exists(&key, false, false).await.unwrap();
        }
        for key in disk_cache_keys(org) {
            infra::cache::file_data::disk::remove(&key).await.unwrap();
        }
        infra::cache::file_data::disk::remove_result_cache_metas(&disk_cache_keys(org)[..1]).await;
        infra::file_list::del_stream_stats(org, StreamType::Logs, "kvstream")
            .await
            .unwrap();
        let stream = format!("{org}/logs/kvstream");
        let history = infra::file_list::StreamRowsTable::History;
        infra::file_list::remove_stream_batch(history, org, &stream, 100, false)
            .await
            .unwrap();
        infra::file_list::delete_jobs_by_streams(org, &[stream])
            .await
            .unwrap();
        db::pipeline_errors::delete_by_org(org).await.unwrap();
        db::kv::delete(org, "orgdel_key").await.unwrap();
        db::system_settings::delete_org_settings(org).await.unwrap();
        db::short_url::delete_by_org(org).await.unwrap();
        infra::table::backfill_jobs::delete_by_org(org)
            .await
            .unwrap();
        infra::table::enrichment_tables::delete_by_org(org)
            .await
            .unwrap();
        infra::table::enrichment_table_urls::delete_by_org(org)
            .await
            .unwrap();
        ENRICHMENT_TABLES.remove(&format!("{org}/enrichment_tables/orgdel_et"));
        assert_kv_and_cache_rows(org, false).await;
    }

    /// A cached workflow whose row is gone, as after a crash between row delete and eviction.
    #[cfg(feature = "enterprise")]
    async fn strand_cached_workflow(org: &str, like: &str) -> String {
        let mut workflow = infra::table::workflows::get_by_org_wid(org, like)
            .await
            .unwrap()
            .unwrap();
        workflow.id = config::ider::generate();
        infra::table::workflows::save_workflow(workflow.clone())
            .await
            .unwrap();
        let cached = db::workflows::get_workflow(org, &workflow.id).await;
        assert!(cached.unwrap().is_some());
        infra::table::workflows::delete_workflow(&workflow.id)
            .await
            .unwrap();
        workflow.id
    }

    async fn drive_cleanup_until_step_done(org: &str, step: &str, max_rounds: usize) {
        let cleanup: Arc<dyn openobserve_core::org_cleanup::StreamDataCleanup> =
            Arc::new(openobserve_jobs::job::CompactionStreamDataCleanup);
        for _ in 0..max_rounds {
            openobserve_core::org_cleanup::run_once(Arc::clone(&cleanup)).await;
            if cleanup_task(org, step).await.status == "done" {
                return;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        panic!("org {org} step {step} not done after {max_rounds} rounds");
    }

    async fn drive_cleanup_until_done(org: &str, max_rounds: usize) {
        let cleanup: Arc<dyn openobserve_core::org_cleanup::StreamDataCleanup> =
            Arc::new(openobserve_jobs::job::CompactionStreamDataCleanup);
        let mut tasks = Vec::new();
        for _ in 0..max_rounds {
            openobserve_core::org_cleanup::run_once(Arc::clone(&cleanup)).await;
            tasks = infra::table::org_cleanup_tasks::list_by_org_status(org, None)
                .await
                .unwrap();
            if tasks.iter().all(|t| t.status == "done") {
                return;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        panic!("org {org} cleanup not done after {max_rounds} rounds: {tasks:#?}");
    }

    async fn insert_public_status_page(org_id: &str) -> String {
        let now = Utc::now().timestamp_micros();
        let slug = config::ider::generate();
        let page = infra::table::entity::status_pages::Model {
            id: config::ider::generate(),
            org_id: org_id.to_string(),
            name: format!("e2e page {slug}"),
            slug: slug.clone(),
            description: None,
            visibility: 1,
            password_hash: None,
            noindex: true,
            show_uptime_percent: false,
            show_timeline_bars: false,
            show_response_time: false,
            confirm_failures: 1,
            confirm_recovery: 1,
            confirm_after_secs: None,
            brand_name: None,
            accent_color: None,
            logo_img: None,
            favicon_img: None,
            tracking_since: Some(now),
            owner: None,
            created_at: now,
            updated_at: now,
        };
        infra::table::status_pages::insert_page(&page)
            .await
            .unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        infra::table::status_pages::upsert_snapshot(
            conn,
            &page.id,
            org_id,
            Some("[]"),
            Some("{}"),
            now,
        )
        .await
        .unwrap();
        slug
    }

    async fn e2e_file_list_step_moves_every_stream_to_deleted() {
        let suffix = run_suffix();
        let (gone, kept) = (format!("fldel{suffix}"), format!("flkeep{suffix}"));
        let meta = config::meta::stream::FileMeta {
            min_ts: 1,
            max_ts: 2,
            records: 1,
            original_size: 1,
            compressed_size: 1,
            flattened: false,
            index_size: 5,
            mindex_size: 0,
            bloom_ver: 0,
        };
        // Neither stream has a schema, stats row or task row: only their fresh rows lead to them.
        let key =
            |org: &str, stream: &str| format!("files/{org}/logs/{stream}/2026/01/01/00/a.parquet");
        for org in [&gone, &kept] {
            for stream in ["s1", "late"] {
                infra::file_list::add("", &key(org, stream), &meta)
                    .await
                    .unwrap();
            }
        }
        add_tasks(&gone, &[("delete_file_list", 200)]).await;
        run_cleanup_once().await;
        let step = cleanup_task(&gone, "delete_file_list").await;
        let deleted = infra::file_list::query_deleted(&gone, i64::MAX, 100)
            .await
            .unwrap();
        let mut left = Vec::new();
        for (org, stream) in [
            (&gone, "s1"),
            (&gone, "late"),
            (&kept, "s1"),
            (&kept, "late"),
        ] {
            left.push(infra::file_list::contains(&key(org, stream)).await.unwrap());
        }
        let kept_deleted = infra::file_list::query_deleted(&kept, i64::MAX, 100)
            .await
            .unwrap();
        infra::table::org_cleanup_tasks::delete_by_org(&gone)
            .await
            .unwrap();
        remove_deleted_rows(&gone).await;
        for stream in ["s1", "late"] {
            infra::file_list::remove(&key(&kept, stream)).await.unwrap();
        }

        assert_eq!(step.status, "done", "{step:?}");
        assert_eq!(deleted.len(), 2, "{deleted:?}");
        assert!(
            deleted.iter().all(|f| f.index_file),
            "index_size > 0 must map to index_file = true"
        );
        assert_eq!(left, [false, false, true, true]);
        assert!(kept_deleted.is_empty(), "{kept_deleted:?}");
    }

    async fn e2e_public_paths_refuse_blocked_org() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("spblock{}", run_suffix());
        let ghost = format!("spghost{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        let live = insert_public_status_page(&org).await;
        let blocked = insert_public_status_page(&org).await;
        let orphan = insert_public_status_page(&ghost).await;

        let (status, _) = make_request(
            &app,
            Method::GET,
            &format!("/api/status_pages_public/{live}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "an active org's page is served");
        let (status, _) = make_request(
            &app,
            Method::GET,
            &format!("/api/status_pages_public/{orphan}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "a page of a missing org");

        db::org_status::broadcast_deleting(&org).await.unwrap();
        let (status, _) = make_request(
            &app,
            Method::GET,
            &format!("/api/status_pages_public/{blocked}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "a page of a deleting org");
        let (status, _) = make_request(
            &app,
            Method::GET,
            &format!("/api/status_pages_public/{live}"),
            None,
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "a page cached while its org was active"
        );
        // The webhook route is enterprise only, so its org guard is called directly.
        let refuses = |r: Option<axum::response::Response>| r.map(|r| r.status());
        assert_eq!(
            refuses(inactive_org_response(&org).await),
            Some(StatusCode::FORBIDDEN),
            "webhook token of a deleting org"
        );
        assert_eq!(
            refuses(inactive_org_response(&ghost).await),
            Some(StatusCode::FORBIDDEN),
            "webhook token of a missing org"
        );
        db::org_status::set_active(&org).await.unwrap();
        assert!(
            inactive_org_response(&org).await.is_none(),
            "an active org's webhook token is accepted"
        );

        // A probe token whose org row is gone must stop authorizing probe calls (D-11).
        let token =
            infra::table::synthetics_probe_tokens::create_for_org(&ghost, "root@example.com")
                .await
                .unwrap();
        let mut probe_headers = HeaderMap::new();
        let basic = config::utils::base64::encode(&format!("probe:{}", token.token));
        probe_headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Basic {basic}")).unwrap(),
        );
        probe_headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{ghost}/synthetics/jobs/ack"),
            Some(probe_headers),
            Some(r#"{"acks":[]}"#.to_string()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{}",
            String::from_utf8_lossy(&body)
        );
        assert!(String::from_utf8_lossy(&body).contains("not active"));
    }

    #[cfg(feature = "enterprise")]
    async fn post_incident_event(app: &Router, uri: &str, bearer: Option<&str>) -> StatusCode {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        if let Some(token) = bearer {
            headers.insert(
                header::AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
            );
        }
        let body = r#"{"status":"firing","labels":{"alertname":"orgdel"},"title":"orgdel"}"#;
        let (status, resp) = make_request(
            app,
            Method::POST,
            uri,
            Some(headers),
            Some(body.to_string()),
        )
        .await;
        log::info!(
            "incident webhook {uri}: {status} {}",
            String::from_utf8_lossy(&resp)
        );
        status
    }

    #[cfg(feature = "enterprise")]
    async fn e2e_incident_webhook_refuses_inactive_org() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("iwblock{}", run_suffix());
        let ghost = format!("iwghost{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        // SAFETY: the org-deletion e2e tasks run one at a time, so no thread reads the env here.
        unsafe { env::set_var("O2_INCIDENTS_ENABLED", "true") };
        o2_enterprise::enterprise::common::config::refresh_config().unwrap();
        let live =
            infra::table::incident_integrations::ensure_default_for_org(&org, "root@example.com")
                .await
                .unwrap();
        let orphan =
            infra::table::incident_integrations::ensure_default_for_org(&ghost, "root@example.com")
                .await
                .unwrap();
        let bearer_uri = format!("/api/v2/{org}/incidents/events");

        let active = post_incident_event(&app, &bearer_uri, Some(&live.token)).await;
        let ghost_uri = format!("/api/v2/{ghost}/incidents/events/{}", orphan.token);
        let missing = post_incident_event(&app, &ghost_uri, None).await;
        db::org_status::broadcast_deleting(&org).await.unwrap();
        let deleting = post_incident_event(&app, &bearer_uri, Some(&live.token)).await;
        db::org_status::set_active(&org).await.unwrap();
        // SAFETY: restored before asserting so a failure does not leak incidents into later tests.
        unsafe { env::remove_var("O2_INCIDENTS_ENABLED") };
        o2_enterprise::enterprise::common::config::refresh_config().unwrap();
        assert_eq!(active, StatusCode::ACCEPTED, "an active org's event");
        assert_eq!(missing, StatusCode::FORBIDDEN, "a missing org's token");
        assert_eq!(deleting, StatusCode::FORBIDDEN, "a deleting org's token");
    }

    async fn e2e_org_delete_completes() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        // POST /api/organizations generates ids, so the org is created by ingestion instead.
        let org = format!("orgdel{}", run_suffix());
        ingest_one(&app, &headers, &org).await;

        // An alert outside the default folder exercises D-05 and the folders FK.
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{org}/alerts/templates"),
            Some(headers.clone()),
            Some(r#"{"name":"orgdelTemplate","body":"{\"text\":\"{alert_name}\"}"}"#.to_string()),
        )
        .await;
        assert!(status.is_success(), "{}", String::from_utf8_lossy(&body));
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{org}/alerts/destinations"),
            Some(headers.clone()),
            Some(
                r#"{"name":"orgdelDest","url":"https://dummy/alert","method":"post","template":"orgdelTemplate"}"#
                    .to_string(),
            ),
        )
        .await;
        assert!(status.is_success(), "{}", String::from_utf8_lossy(&body));
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/v2/{org}/folders/alerts"),
            Some(headers.clone()),
            Some(r#"{"name":"f1","description":""}"#.to_string()),
        )
        .await;
        assert!(status.is_success(), "{}", String::from_utf8_lossy(&body));
        let folder: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let folder_id = folder["folderId"].as_str().unwrap().to_string();
        let alert = json!({
            "name": "orgdelAlert",
            "stream_type": "logs",
            "stream_name": "orgdel",
            "is_real_time": false,
            "enabled": true,
            "query_condition": {"conditions": [{"column": "a", "operator": "=", "value": "1"}]},
            "trigger_condition": {"period": 60, "threshold": 1, "silence": 0, "frequency": 60, "operator": ">="},
            "destinations": ["orgdelDest"]
        });
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/v2/{org}/alerts?folder={folder_id}"),
            Some(headers.clone()),
            Some(alert.to_string()),
        )
        .await;
        assert!(status.is_success(), "{}", String::from_utf8_lossy(&body));
        let orphan = seed_orphan_file(&org, "orphan").await;
        // A legacy row, written long before the deletion: only step 200's org-wide read sees it.
        sea_orm::ConnectionTrait::execute_unprepared(
            infra::db::get_orm_client_rw().await,
            &format!("UPDATE file_list SET updated_at = 1 WHERE stream = '{org}/logs/orphan'"),
        )
        .await
        .unwrap();
        let orphan_path = format!("{}{orphan}", get_config().common.data_stream_dir);
        assert!(std::path::Path::new(&orphan_path).exists());
        let kept = format!("orgkeep{}", run_suffix());
        let gone_rows = seed_coverage_rows(&org).await;
        let kept_rows = seed_coverage_rows(&kept).await;
        assert_coverage(&org, &gone_rows, true).await;
        let dashboard_id = seed_raw_routed_rows(&app, &headers, &org).await;
        let shared_templates = seed_shared_templates(&org, &kept).await;
        assert_raw_routed_rows(&org, &dashboard_id, true).await;
        seed_kv_and_cache_rows(&org).await;
        seed_kv_and_cache_rows(&kept).await;
        assert_kv_and_cache_rows(&org, true).await;
        assert_kv_caches(&org, true).await;
        #[cfg(feature = "enterprise")]
        let stranded = strand_cached_workflow(&org, &gone_rows.workflow_id).await;
        #[cfg(feature = "enterprise")]
        let mut org_evictions = infra::coordinator::get_coordinator()
            .await
            .watch(&format!("/workflows/org/{org}"))
            .await
            .unwrap();
        warm_coverage_caches(&org, &gone_rows).await;
        let warmed = std::time::Instant::now();
        let snapshots = seed_service_graph_snapshots(&org, &kept);

        openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com")
            .await
            .unwrap();
        // Hold the deletion at step 600, past both drains of step 200's rows, then write late.
        unsafe { env::set_var("ZO_ORG_CLEANUP_FAIL_STEP", "delete_users") };
        drive_cleanup_until_step_done(&org, "drain_deleted_files", 10).await;
        let late = seed_orphan_file(&org, "late").await;
        unsafe { env::remove_var("ZO_ORG_CLEANUP_FAIL_STEP") };
        let late_path = format!("{}{late}", get_config().common.data_stream_dir);
        drive_cleanup_until_done(&org, 20).await;
        assert_service_graph_snapshots(&snapshots);
        assert!(
            !std::path::Path::new(&late_path).exists(),
            "{late_path}, written after step 200, survived the deletion"
        );

        assert!(
            infra::file_list::query_deleted(&org, i64::MAX, 1)
                .await
                .unwrap()
                .is_empty(),
            "file_list_deleted still holds rows of {org}"
        );
        assert!(
            !std::path::Path::new(&orphan_path).exists(),
            "{orphan_path} survived the deletion"
        );
        // On local disk the drain also removes the org's folder, so the rows prove the queueing.
        for table in ["file_list", "file_list_history"] {
            let sql = format!("SELECT COUNT(*) FROM {table} WHERE org = '{org}'");
            let conn = infra::db::get_orm_client_rw().await;
            let row = sea_orm::ConnectionTrait::query_one(
                conn,
                sea_orm::Statement::from_string(
                    sea_orm::ConnectionTrait::get_database_backend(conn),
                    sql,
                ),
            )
            .await
            .unwrap()
            .unwrap();
            let left: i64 = row.try_get_by_index(0).unwrap();
            assert_eq!(left, 0, "{table} still holds rows of {org}");
        }
        let files_dir = format!("{}files/{org}", get_config().common.data_stream_dir);
        assert!(
            !std::path::Path::new(&files_dir).exists(),
            "{files_dir} survived the deletion"
        );
        assert_coverage_caches_evicted(&org, &gone_rows, warmed).await;
        #[cfg(feature = "enterprise")]
        {
            let cached = db::workflows::get_workflow(&org, &stranded).await;
            assert!(
                cached.unwrap().is_none(),
                "the stranded workflow stayed cached"
            );
            let event = tokio::time::timeout(
                tokio::time::Duration::from_secs(5),
                Arc::get_mut(&mut org_evictions).unwrap().recv(),
            )
            .await;
            assert!(
                matches!(event, Ok(Some(infra::db::Event::Delete(_)))),
                "no org-scoped workflow eviction reached the watchers: {event:?}"
            );
        }
        assert_coverage(&org, &gone_rows, false).await;
        assert_coverage(&kept, &kept_rows, true).await;
        drop_coverage_rows(&kept, &kept_rows).await;
        assert_shared_templates(&org, &kept, &shared_templates).await;
        assert_raw_routed_rows(&org, &dashboard_id, false).await;
        assert_kv_and_cache_rows(&org, false).await;
        assert!(
            infra::file_list::get_stream_stats(&org, None, None)
                .await
                .unwrap()
                .is_empty()
        );
        assert_kv_caches(&org, false).await;
        assert_kv_and_cache_rows(&kept, true).await;
        assert_kv_caches(&kept, true).await;
        drop_kv_and_cache_rows(&kept).await;
        assert_reminting_caches_evicted(&org, &gone_rows).await;
        // Step 900 removes the task rows last, so an empty list means every step ran.
        let tasks = infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
            .await
            .unwrap();
        assert!(tasks.is_empty(), "{tasks:#?}");
        assert!(
            db::alerts::alert::list_all_for_cleanup(&org)
                .await
                .unwrap()
                .is_empty()
        );
        assert_org_is_tombstone(&app, &headers, &org).await;
        assert!(
            !db::organization::tombstone_org(&org).await.unwrap(),
            "a step 900 retry must not count as the transition that emits OrgDeleted"
        );
        assert_tombstone_sweep(&org).await;
        assert_stale_mark_spares_reused_id(&org).await;
    }

    async fn e2e_online_eval_runner_skips_deleting_org() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("orgeval{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        let job = seed_eval_job(&org, Utc::now().timestamp_micros()).await;
        assert!(eval_job_is_scheduled(&job).await);

        openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com")
            .await
            .unwrap();
        let scheduled = eval_job_is_scheduled(&job).await;
        drive_cleanup_until_done(&org, 20).await;
        assert!(
            !scheduled,
            "the runner still schedules a job of a deleting org"
        );
    }

    async fn eval_job_is_scheduled(job_id: &str) -> bool {
        infra::table::online_eval_jobs::get_active_trace_session()
            .await
            .unwrap()
            .iter()
            .any(|j| j.id == job_id)
    }

    /// Step 900 keeps a `deleted` row that refuses ingestion, auto-create and the org list.
    async fn assert_org_is_tombstone(app: &Router, headers: &HeaderMap, org: &str) {
        assert!(get_config().common.create_org_through_ingestion);
        let row = infra::table::organizations::get(org).await.unwrap();
        assert_eq!(row.status, "deleted");
        assert!(db::org_status::is_blocked(org));
        let (status, body) = make_request(
            app,
            Method::POST,
            &format!("/api/{org}/orgdel/_json"),
            Some(headers.clone()),
            Some(r#"[{"a":2}]"#.to_string()),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{}",
            String::from_utf8_lossy(&body)
        );
        assert!(
            openobserve_core::organization::check_and_create_org(org)
                .await
                .is_err()
        );
        assert_eq!(
            infra::table::organizations::get(org).await.unwrap().status,
            "deleted",
            "auto-create revived the tombstone"
        );
        let (status, body) = make_request(
            app,
            Method::GET,
            "/api/organizations?page_size=1000",
            Some(headers.clone()),
            None,
        )
        .await;
        assert!(status.is_success());
        let listed: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(
            !listed["data"]
                .as_array()
                .unwrap()
                .iter()
                .any(|o| o["identifier"] == org),
            "the org list shows a tombstone"
        );
    }

    /// Only tombstones older than the cutoff are listed, and removal frees the id.
    async fn assert_tombstone_sweep(org: &str) {
        let now = Utc::now().timestamp_micros();
        let month_ago = now - Duration::days(30).num_microseconds().unwrap();
        let fresh = infra::table::organizations::list_expired_tombstone_rows(month_ago)
            .await
            .unwrap();
        assert!(!fresh.iter().any(|t| t.identifier == org), "{fresh:?}");
        let expired = infra::table::organizations::list_expired_tombstone_rows(now + 1_000_000)
            .await
            .unwrap();
        assert!(expired.iter().any(|t| t.identifier == org), "{expired:?}");

        // Only the chat the retention sweep still re-purges outlives step 300, until this sweep.
        assert_eq!(count_org_rows("ai_chat_sessions", org).await, 1);

        use infra::table::entity::{
            ai_chat_sessions,
            organizations::{Column, Entity},
        };
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};
        // The chat first, so a concurrent sweep never sees the aged tombstone with a fresh purge.
        ai_chat_sessions::Entity::update_many()
            .col_expr(
                ai_chat_sessions::Column::ReplicaPurgedAt,
                Expr::value(Some(month_ago - 2_000_000)),
            )
            .filter(ai_chat_sessions::Column::OrgId.eq(org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        // Age the tombstone past the window so the scheduler's own sweep picks it up.
        Entity::update_many()
            .col_expr(Column::UpdatedAt, Expr::value(month_ago - 1_000_000))
            .filter(Column::Identifier.eq(org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        // The promotion scheduler may sweep the same row concurrently, so wait for the end state.
        let mut swept = false;
        for _ in 0..20 {
            openobserve_core::org_cleanup::sweep_tombstones()
                .await
                .unwrap();
            let marks = infra::db::get_db()
                .await
                .list_keys("/org_cleanup/tombstone_purge/")
                .await
                .unwrap();
            swept = infra::table::organizations::get(org).await.is_err()
                && !db::org_status::is_blocked(org)
                && !marks
                    .iter()
                    .any(|k| k.contains(&format!("/tombstone_purge/{org}/")));
            if swept {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        }
        assert!(swept, "{org}: the expired tombstone was not fully swept");
        assert_eq!(count_org_rows("ai_chat_sessions", org).await, 0);
    }

    /// A purge mark left by a failed unmark must neither delete nor unblock a later tombstone.
    async fn assert_stale_mark_spares_reused_id(org: &str) {
        let marks_of_org = format!("/tombstone_purge/{org}/");
        infra::db::get_db()
            .await
            .put(
                &format!("/org_cleanup/tombstone_purge/{org}/1"),
                "1".to_string().into(),
                false,
                None,
            )
            .await
            .unwrap();
        infra::table::organizations::add(
            org,
            org,
            config::meta::organization::OrganizationType::Default,
        )
        .await
        .unwrap();
        assert!(
            infra::table::organizations::set_status_if(org, "active", "deleted")
                .await
                .unwrap()
        );
        db::org_status::broadcast_deleted(org).await.unwrap();

        let mut dropped = false;
        for _ in 0..20 {
            openobserve_core::org_cleanup::sweep_tombstones()
                .await
                .unwrap();
            let marks = infra::db::get_db()
                .await
                .list_keys("/org_cleanup/tombstone_purge/")
                .await
                .unwrap();
            dropped = !marks.iter().any(|k| k.contains(&marks_of_org));
            if dropped {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        }
        assert!(dropped, "{org}: the stale purge mark was never dropped");
        assert_eq!(
            infra::table::organizations::get_status_uncached(org)
                .await
                .unwrap()
                .as_deref(),
            Some("deleted"),
            "{org}: the stale mark removed a fresh tombstone"
        );
        assert!(
            db::org_status::is_blocked(org),
            "{org}: the stale mark unblocked a fresh tombstone"
        );
        let tombstone = infra::table::organizations::get_from_db(org).await.unwrap();
        assert!(
            infra::table::organizations::remove_tombstone_at(org, tombstone.updated_at)
                .await
                .unwrap()
        );
        db::org_status::evict(org).await.unwrap();
    }

    /// A status eviction must also drop a node's cached row, or a swept id stays refused there.
    async fn assert_eviction_drops_cached_row(org: &str) {
        assert_eq!(
            infra::table::organizations::get(org).await.unwrap().status,
            "deleted",
            "precondition: the tombstone row is cached"
        );
        // Delete the row behind the cache's back, as another node's sweep does.
        use infra::table::entity::organizations::{Column, Entity};
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
        Entity::delete_many()
            .filter(Column::Identifier.eq(org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        infra::coordinator::org_status::emit_evict_event(org)
            .await
            .unwrap();
        for _ in 0..40 {
            if infra::table::organizations::get(org).await.is_err() {
                return;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        }
        panic!("{org}: the swept tombstone row is still served from the cache");
    }

    #[cfg(feature = "enterprise")]
    async fn e2e_host_routed_status_page_refuses_blocked_org() {
        let auth = setup();
        let app = init_test_router().layer(axum::middleware::from_fn(
            openobserve_api_management::request::status_pages::public::host_route_middleware,
        ));
        let headers = auth_headers(auth);
        let suffix = run_suffix();
        let org = format!("hrblock{suffix}");
        ingest_one(&app, &headers, &org).await;
        let mut hosts = Vec::new();
        for name in ["live", "blocked"] {
            let slug = insert_public_status_page(&org).await;
            let page = infra::table::status_pages::get_page_by_slug_any(&slug)
                .await
                .unwrap()
                .unwrap();
            let now = Utc::now().timestamp_micros();
            let host = format!("{name}-{suffix}.status.example.com");
            let claim = infra::table::entity::status_page_custom_domains::Model {
                id: config::ider::generate(),
                org_id: org.clone(),
                status_page_id: page.id,
                domain: host.clone(),
                verification_token: config::ider::generate(),
                verification_state: 1,
                verification_failure_reason: None,
                verified_at: Some(now),
                released_at: None,
                last_checked_at: None,
                created_at: now,
                updated_at: now,
            };
            assert!(
                infra::table::status_pages::insert_domain_if_unclaimed(&claim)
                    .await
                    .unwrap()
            );
            hosts.push(host);
        }
        let by_host = |host: &str| {
            let mut h = HeaderMap::new();
            h.insert(header::HOST, HeaderValue::from_str(host).unwrap());
            h
        };

        // Both pages are fetched first, so the blocked one is refused from a warm cache too.
        for host in &hosts {
            let (status, body) = make_request(
                &app,
                Method::GET,
                "/api/status_pages_public_by_host",
                Some(by_host(host)),
                None,
            )
            .await;
            assert_eq!(
                status,
                StatusCode::OK,
                "an active org's custom domain is served: {}",
                String::from_utf8_lossy(&body)
            );
        }
        db::org_status::broadcast_deleting(&org).await.unwrap();
        let (status, _) = make_request(
            &app,
            Method::GET,
            "/api/status_pages_public_by_host",
            Some(by_host(&hosts[1])),
            None,
        )
        .await;
        db::org_status::set_active(&org).await.unwrap();
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "a deleting org's custom domain"
        );
    }

    /// Creates `email` with a password in `org`, or adds the existing user to `org`.
    async fn put_org_user(app: &Router, headers: &HeaderMap, org: &str, email: &str) {
        let exists = infra::table::users::get(email).await.is_ok();
        let (uri, body) = if exists {
            (
                format!("/api/{org}/users/{email}"),
                json!({"role": "admin"}),
            )
        } else {
            (
                format!("/api/{org}/users"),
                json!({"email": email, "password": "Abcd12345!Zyxwv", "role": "admin"}),
            )
        };
        let (status, resp) = make_request(
            app,
            Method::POST,
            &uri,
            Some(headers.clone()),
            Some(body.to_string()),
        )
        .await;
        assert!(
            status.is_success(),
            "add {email} to {org}: {status} {}",
            String::from_utf8_lossy(&resp)
        );
    }

    async fn ingest_as(app: &Router, org: &str, user: &str, password: &str) -> StatusCode {
        let mut headers = HeaderMap::new();
        let basic = config::utils::base64::encode(&format!("{user}:{password}"));
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Basic {basic}")).unwrap(),
        );
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let (status, _) = make_request(
            app,
            Method::POST,
            &format!("/api/{org}/orgdel/_json"),
            Some(headers),
            Some(r#"[{"a":2}]"#.to_string()),
        )
        .await;
        status
    }

    async fn e2e_org_delete_removes_memberships() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let suffix = run_suffix();
        let (org, other) = (format!("orgmem{suffix}"), format!("orgmemkeep{suffix}"));
        let (solo, shared) = (
            format!("solo{suffix}@example.com"),
            format!("shared{suffix}@example.com"),
        );
        ingest_one(&app, &headers, &org).await;
        ingest_one(&app, &headers, &other).await;
        put_org_user(&app, &headers, &org, &solo).await;
        put_org_user(&app, &headers, &org, &shared).await;
        put_org_user(&app, &headers, &other, &shared).await;

        openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com")
            .await
            .unwrap();
        drive_cleanup_until_done(&org, 20).await;

        assert!(
            infra::table::org_users::list_users_by_org(&org)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(infra::table::users::get(&solo).await.is_err());
        let kept: Vec<String> = infra::table::org_users::list_orgs_by_user(&shared)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.org_id)
            .collect();
        assert_eq!(kept, vec![other.clone()]);
        assert!(
            common::infra::config::USERS.get(&solo).is_none(),
            "the deleted user stays cached"
        );
        for email in [&solo, &shared] {
            assert!(
                common::infra::config::ORG_USERS
                    .get(&format!("{org}/{email}"))
                    .is_none(),
                "{email}'s membership stays cached"
            );
        }
    }

    async fn e2e_meta_prefix_reads_are_org_exact() {
        setup();
        let db = infra::db::get_db().await;
        let suffix = run_suffix();
        let orgs = ["a_b", "aXb", "a-b", "A_B"].map(|o| format!("{o}{suffix}"));
        for org in &orgs {
            db.put(
                &format!("/organization/savedviews/{org}/v1"),
                "{}".into(),
                false,
                None,
            )
            .await
            .unwrap();
        }
        let target = format!("/organization/savedviews/{}/", orgs[0]);
        let keys = db.list_keys(&target).await.unwrap();
        assert_eq!(keys.len(), 1, "{keys:?}");
        assert_eq!(db.count(&target).await.unwrap(), 1);
        db.delete(&target, true, false, None).await.unwrap();
        for org in &orgs[1..] {
            let keys = db
                .list_keys(&format!("/organization/savedviews/{org}/"))
                .await
                .unwrap();
            assert_eq!(keys.len(), 1, "{org} lost its view: {keys:?}");
        }
    }

    async fn e2e_org_setting_writers_do_not_lose_updates() {
        setup();
        let org = format!("orgsetw{}", run_suffix());
        let writers: Vec<_> = (0..16)
            .map(|i| {
                let org = org.clone();
                tokio::spawn(async move {
                    db::organization::update_org_setting(&org, move |s| {
                        s.cross_links.push(config::meta::stream::CrossLink {
                            name: format!("link{i}"),
                            url: "https://example.com".to_string(),
                            fields: vec![],
                        });
                        true
                    })
                    .await
                    .unwrap()
                })
            })
            .collect();
        for writer in writers {
            assert!(writer.await.unwrap());
        }
        let stored = db::organization::get_org_setting(&org).await.unwrap();
        assert_eq!(
            stored.cross_links.len(),
            16,
            "concurrent settings writes were lost"
        );
    }

    async fn e2e_org_delete_rejects_old_credentials() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let suffix = run_suffix();
        let org = format!("orgcred{suffix}");
        let user = format!("cred{suffix}@example.com");
        ingest_one(&app, &headers, &org).await;
        put_org_user(&app, &headers, &org, &user).await;
        let now = Utc::now().timestamp_micros();
        let token = infra::table::org_ingestion_tokens::generate_token();
        db::org_ingestion_tokens::add(
            &infra::table::org_ingestion_tokens::OrgIngestionTokenRecord {
                id: config::ider::generate(),
                org_id: org.clone(),
                name: format!("orgdel{suffix}"),
                token: token.clone(),
                description: String::new(),
                is_default: false,
                enabled: true,
                created_by: "root@example.com".to_string(),
                created_at: now,
                updated_at: now,
                splunk_token: None,
            },
        )
        .await
        .unwrap();
        assert!(
            ingest_as(&app, &org, &user, "Abcd12345!Zyxwv")
                .await
                .is_success()
        );
        assert!(ingest_as(&app, &org, "anyone", &token).await.is_success());
        assert!(
            common::infra::config::ORGANIZATIONS
                .read()
                .await
                .contains_key(&org),
            "precondition: the org is cached"
        );

        openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com")
            .await
            .unwrap();
        drive_cleanup_until_done(&org, 20).await;

        let refused = |s: StatusCode| s == StatusCode::UNAUTHORIZED || s == StatusCode::FORBIDDEN;
        let status = ingest_as(&app, &org, &user, "Abcd12345!Zyxwv").await;
        assert!(refused(status), "a deleted member's password: {status}");
        let status = ingest_as(&app, &org, "anyone", &token).await;
        assert!(refused(status), "a deleted org's ingestion token: {status}");
        assert_eq!(
            infra::table::organizations::get(&org).await.unwrap().status,
            "deleted"
        );
        assert!(
            !common::infra::config::ORGANIZATIONS
                .read()
                .await
                .contains_key(&org),
            "the deleted org stays cached"
        );
        assert_eviction_drops_cached_row(&org).await;
    }

    /// One OTLP log export to `org` over the test gRPC server, authenticated as a cluster peer.
    async fn grpc_export_log(org: &str) -> Result<(), tonic::Status> {
        let cfg = get_config();
        let channel =
            tonic::transport::Endpoint::from_shared(format!("http://127.0.0.1:{}", cfg.grpc.port))
                .unwrap()
                .connect()
                .await
                .unwrap();
        let record = LogRecord {
            time_unix_nano: Utc::now().timestamp_nanos_opt().unwrap() as u64,
            body: Some(AnyValue {
                value: Some(any_value::Value::StringValue("blocked?".to_string())),
            }),
            ..Default::default()
        };
        let mut request = tonic::Request::new(ExportLogsServiceRequest {
            resource_logs: vec![ResourceLogs {
                scope_logs: vec![ScopeLogs {
                    log_records: vec![record],
                    ..Default::default()
                }],
                ..Default::default()
            }],
        });
        let token = config::meta::cluster::get_internal_grpc_token();
        request
            .metadata_mut()
            .insert("authorization", token.parse().unwrap());
        request.metadata_mut().insert(
            tonic::metadata::MetadataKey::from_bytes(cfg.grpc.org_header_key.as_bytes()).unwrap(),
            org.parse().unwrap(),
        );
        LogsServiceClient::new(channel)
            .export(request)
            .await
            .map(|_| ())
    }

    /// Status of each ingestion path for `org`: JSON, Firehose, RUM and v2 alerts.
    async fn ingest_paths(
        app: &Router,
        headers: &HeaderMap,
        org: &str,
        rum_token: &str,
    ) -> Vec<(&'static str, StatusCode)> {
        let (json, _) = make_request(
            app,
            Method::POST,
            &format!("/api/{org}/orgdel/_json"),
            Some(headers.clone()),
            Some(r#"[{"a":3}]"#.to_string()),
        )
        .await;
        let mut firehose_headers = HeaderMap::new();
        let basic = headers[header::AUTHORIZATION].to_str().unwrap();
        firehose_headers.insert(
            "X-Amz-Firehose-Access-Key",
            HeaderValue::from_str(basic.trim_start_matches("Basic ")).unwrap(),
        );
        firehose_headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let record = config::utils::base64::encode(r#"{"a":4}"#);
        let (firehose, _) = make_request(
            app,
            Method::POST,
            &format!("/aws/{org}/orgdel/_kinesis_firehose"),
            Some(firehose_headers),
            Some(format!(
                r#"{{"requestId":"r1","timestamp":{},"records":[{{"data":"{record}"}}]}}"#,
                Utc::now().timestamp_millis()
            )),
        )
        .await;
        let (rum, _) = make_request(
            app,
            Method::POST,
            &format!("/rum/v1/{org}/logs?oo-api-key={rum_token}"),
            None,
            Some("{\"a\":5}\n".to_string()),
        )
        .await;
        let (alerts, _) = make_request(
            app,
            Method::GET,
            &format!("/api/v2/{org}/alerts"),
            Some(headers.clone()),
            None,
        )
        .await;
        vec![
            ("json", json),
            ("firehose", firehose),
            ("rum", rum),
            ("v2 alerts", alerts),
        ]
    }

    async fn e2e_ingestion_blocked_during_deletion() {
        let auth = setup();
        let app = init_test_router().merge(other_service_routes());
        let headers = auth_headers(auth);
        let org = format!("orgblk{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        let root = "root@example.com";
        let rum_token = match openobserve_core::organization::get_rum_token(Some("default"), root)
            .await
            .unwrap()
            .rum_token
        {
            Some(token) => token,
            None => openobserve_core::organization::update_rum_token(Some("default"), root)
                .await
                .unwrap()
                .rum_token
                .unwrap(),
        };

        // Every path must accept the org first, or a 403 below could come from auth instead.
        for (path, status) in ingest_paths(&app, &headers, &org, &rum_token).await {
            assert!(status.is_success(), "{path} before the block: {status}");
        }
        grpc_export_log(&org).await.unwrap();

        db::org_status::broadcast_deleting(&org).await.unwrap();
        let blocked = ingest_paths(&app, &headers, &org, &rum_token).await;
        let (alert_post, _) = make_request(
            &app,
            Method::POST,
            &format!("/api/v2/{org}/alerts"),
            Some(headers.clone()),
            Some("{}".to_string()),
        )
        .await;
        let grpc = grpc_export_log(&org).await;
        db::org_status::set_active(&org).await.unwrap();

        let mut open: Vec<String> = blocked
            .into_iter()
            .chain([("v2 alert create", alert_post)])
            .filter(|(_, status)| *status != StatusCode::FORBIDDEN)
            .map(|(path, status)| format!("{path}: {status}"))
            .collect();
        match grpc {
            Err(e) if e.code() == tonic::Code::PermissionDenied => {}
            other => open.push(format!("gRPC OTLP: {other:?}")),
        }
        assert!(
            open.is_empty(),
            "paths still open during deletion: {open:?}"
        );
    }

    /// Deletion refuses to start with super-cluster on, before writing anything.
    #[cfg(feature = "enterprise")]
    async fn test_initiate_refused_under_super_cluster() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("orgsc{}", run_suffix());
        ingest_one(&app, &headers, &org).await;

        unsafe { env::set_var("O2_SUPER_CLUSTER_ENABLED", "true") };
        o2_enterprise::enterprise::common::config::refresh_config().unwrap();
        let enabled = openobserve_core::org_cleanup::super_cluster_enabled();
        let refused =
            openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com").await;
        unsafe { env::remove_var("O2_SUPER_CLUSTER_ENABLED") };
        o2_enterprise::enterprise::common::config::refresh_config().unwrap();

        assert!(enabled);
        assert_eq!(
            refused.unwrap_err().to_string(),
            "Organization delete is not supported with super-cluster enabled yet"
        );
        assert_eq!(
            infra::table::organizations::get(&org).await.unwrap().status,
            "active"
        );
        assert!(!db::org_status::is_blocked(&org));
        assert!(
            infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
                .await
                .unwrap()
                .is_empty()
        );
    }

    async fn e2e_drain_retry_keeps_attempts_at_zero() {
        let org = format!("t4drain{}", run_suffix());
        add_tasks(&org, &[("drain_deleted_files", 250)]).await;
        let files = [deleted_file(&org, "a"), deleted_file(&org, "b")];
        infra::file_list::batch_add_deleted(&org, Utc::now().timestamp_micros(), &files)
            .await
            .unwrap();

        set_cleanup_test_config(120);
        for _ in 0..3 {
            run_cleanup_once().await;
        }
        let waiting = cleanup_task(&org, "drain_deleted_files").await;
        set_cleanup_test_config(0);
        run_cleanup_once().await;
        let drained = cleanup_task(&org, "drain_deleted_files").await;
        let left = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap();
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();

        assert_eq!(
            (waiting.status.as_str(), waiting.attempts),
            ("pending", 0),
            "{waiting:?}"
        );
        assert_eq!(drained.status, "done", "{drained:?}");
        assert!(left.is_empty(), "{left:?}");
    }

    async fn e2e_drain_stalled_row_is_marked_failed() {
        use infra::table::entity::org_cleanup_tasks::{Column, Entity};
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};

        let org = format!("t5stall{}", run_suffix());
        add_tasks(&org, &[("drain_deleted_files", 250)]).await;
        let day_and_hour_ago = Utc::now().timestamp_micros() - 25 * 3600 * 1_000_000;
        Entity::update_many()
            .col_expr(Column::CreatedAt, Expr::value(day_and_hour_ago))
            .filter(Column::OrgId.eq(&org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        // Rows stamped a year ahead never mature.
        let year_ahead = Utc::now().timestamp_micros() + 365 * 24 * 3600 * 1_000_000;
        infra::file_list::batch_add_deleted(&org, year_ahead, &[deleted_file(&org, "a")])
            .await
            .unwrap();

        // A day-old step alone is not stalled: the clock starts at the first pass without progress.
        run_cleanup_once().await;
        let first = cleanup_task(&org, "drain_deleted_files").await;
        let stall_clock = infra::table::org_cleanup_tasks::stall_clock_message(day_and_hour_ago);
        Entity::update_many()
            .col_expr(Column::LastError, Expr::value(stall_clock))
            .filter(Column::OrgId.eq(&org))
            .exec(infra::db::get_orm_client_rw().await)
            .await
            .unwrap();
        run_cleanup_once().await;
        let row = cleanup_task(&org, "drain_deleted_files").await;
        // The stalled attempt keeps the clock, so the next quiet pass spends an attempt too.
        run_cleanup_once().await;
        let again = cleanup_task(&org, "drain_deleted_files").await;
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();
        remove_deleted_rows(&org).await;

        assert_eq!(
            (first.status.as_str(), first.attempts),
            ("pending", 0),
            "{first:?}"
        );
        assert_eq!(
            (row.status.as_str(), row.attempts),
            ("failed", 1),
            "{row:?}"
        );
        assert!(
            row.last_error
                .as_deref()
                .is_some_and(|e| e.contains("drain stalled")),
            "{row:?}"
        );
        assert_eq!(
            (again.status.as_str(), again.attempts),
            ("failed", 2),
            "{again:?}"
        );
    }

    async fn e2e_drain_keeps_rows_when_an_object_cannot_be_deleted() {
        let org = format!("t11undeletable{}", run_suffix());
        add_tasks(
            &org,
            &[("drain_deleted_files", 250), ("delete_db_resources", 300)],
        )
        .await;
        let file = deleted_file(&org, "a");
        // A directory at the object's path makes the local store's delete fail with an IO error.
        let blocker = format!("{}{}", get_config().common.data_stream_dir, file.file);
        std::fs::create_dir_all(format!("{blocker}/child")).unwrap();
        infra::file_list::batch_add_deleted(&org, Utc::now().timestamp_micros(), &[file])
            .await
            .unwrap();

        run_cleanup_once().await;
        let drain = cleanup_task(&org, "drain_deleted_files").await;
        let provider_step = cleanup_task(&org, "delete_db_resources").await;
        let left = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap();
        let _ = std::fs::remove_dir_all(&blocker);
        remove_deleted_rows(&org).await;
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();

        assert_eq!(drain.status, "failed", "{drain:?}");
        assert_eq!(
            (provider_step.status.as_str(), provider_step.attempts),
            ("pending", 0),
            "{provider_step:?}"
        );
        assert_eq!(left.len(), 1, "the row of the surviving object was removed");
    }

    async fn e2e_drain_refuses_an_unloaded_storage_account() {
        let org = format!("t12account{}", run_suffix());
        add_tasks(
            &org,
            &[("drain_deleted_files", 250), ("delete_db_resources", 300)],
        )
        .await;
        let file = config::meta::stream::FileListDeleted {
            account: format!("{org}_gone:default"),
            ..deleted_file(&org, "a")
        };
        // The same key on the default store must survive: the row names another bucket.
        infra::storage::put("", &file.file, Bytes::from_static(b"kept"))
            .await
            .unwrap();
        let path = format!("{}{}", get_config().common.data_stream_dir, file.file);
        infra::file_list::batch_add_deleted(&org, Utc::now().timestamp_micros(), &[file])
            .await
            .unwrap();

        run_cleanup_once().await;
        let drain = cleanup_task(&org, "drain_deleted_files").await;
        let provider_step = cleanup_task(&org, "delete_db_resources").await;
        let left = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap();
        let survived = std::path::Path::new(&path).exists();
        let _ = std::fs::remove_file(&path);
        remove_deleted_rows(&org).await;
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();

        assert_eq!(drain.status, "failed", "{drain:?}");
        assert!(
            drain
                .last_error
                .as_deref()
                .is_some_and(|e| e.contains("not loaded")),
            "{drain:?}"
        );
        assert_eq!(provider_step.status, "pending", "{provider_step:?}");
        assert_eq!(
            left.len(),
            1,
            "the row of an unreachable account was removed"
        );
        assert!(survived, "the default store's object was deleted instead");
    }

    async fn e2e_drain_failure_spends_an_attempt_each_pass() {
        let org = format!("t15outage{}", run_suffix());
        add_deleting_org(&org).await;
        add_tasks(&org, &[("drain_deleted_files", 250)]).await;
        let file = deleted_file(&org, "a");
        // A directory at the object's path makes the local store's delete fail with an IO error.
        let blocker = format!("{}{}", get_config().common.data_stream_dir, file.file);
        std::fs::create_dir_all(format!("{blocker}/child")).unwrap();
        let matured = Utc::now().timestamp_micros() - 3 * 3600 * 1_000_000;
        infra::file_list::batch_add_deleted(&org, matured, &[file])
            .await
            .unwrap();

        set_cleanup_test_config(120);
        for _ in 0..3 {
            run_cleanup_once().await;
        }
        let failing = cleanup_task(&org, "drain_deleted_files").await;
        // Checked, not queried: a Postgres query claims the rows and pushes them behind the delay.
        let kept = infra::file_list::has_deleted_by_org(&org).await.unwrap();
        std::fs::remove_dir_all(&blocker).unwrap();
        run_cleanup_once().await;
        let drained = cleanup_task(&org, "drain_deleted_files").await;
        let left = infra::file_list::has_deleted_by_org(&org).await.unwrap();
        set_cleanup_test_config(0);
        remove_deleted_rows(&org).await;
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();
        infra::table::organizations::remove(&org).await.unwrap();

        assert_eq!(
            (failing.status.as_str(), failing.attempts),
            ("failed", 3),
            "{failing:?}"
        );
        assert!(kept, "a failed delete dropped its row");
        assert_eq!(drained.status, "done", "{drained:?}");
        assert!(!left, "the pass after the outage left rows behind");
    }

    async fn e2e_resurrect_releases_parked_triggers() {
        let org = format!("t16parked{}", run_suffix());
        infra::table::organizations::add(
            &org,
            &org,
            config::meta::organization::OrganizationType::Default,
        )
        .await
        .unwrap();
        let hour = 3600 * 1_000_000;
        let deleted_at = Utc::now().timestamp_micros() - 90 * 60 * 1_000_000;
        infra::table::organizations::set_status_if_with_deleted_at(
            &org,
            "active",
            "pending_deletion",
            Some(deleted_at),
        )
        .await
        .unwrap();
        db::org_status::broadcast_pending_deletion(&org)
            .await
            .unwrap();
        let now = Utc::now().timestamp_micros();
        let scheduled = now + 30 * 60 * 1_000_000;
        for (key, next_run_at) in [("due", now - 1_000_000), ("scheduled", scheduled)] {
            infra::scheduler::push(Trigger {
                org: org.clone(),
                module: TriggerModule::Alert,
                module_key: key.to_string(),
                next_run_at,
                status: TriggerStatus::Waiting,
                ..Default::default()
            })
            .await
            .unwrap();
        }
        let next_run = |key: &'static str| {
            let org = org.clone();
            async move {
                infra::scheduler::get(&org, TriggerModule::Alert, key)
                    .await
                    .unwrap()
                    .next_run_at
            }
        };

        let due = infra::scheduler::get(&org, TriggerModule::Alert, "due")
            .await
            .unwrap();
        handle_triggers("e2e-parked", due).await.unwrap();
        let parked = next_run("due").await;
        openobserve_core::org_cleanup::resurrect_org(&org, "root@example.com")
            .await
            .unwrap();
        let resurrected = Utc::now().timestamp_micros();
        let released = next_run("due").await;
        let untouched = next_run("scheduled").await;
        for key in ["due", "scheduled"] {
            infra::scheduler::delete(&org, TriggerModule::Alert, key)
                .await
                .unwrap();
        }
        infra::table::organizations::remove(&org).await.unwrap();

        assert!(parked > now && parked <= now + hour, "parked at {parked}");
        assert_eq!((parked - deleted_at) % hour, 0, "parked off the grid");
        assert!(released <= resurrected, "still parked after the resurrect");
        assert_eq!(untouched, scheduled, "a real schedule was moved");
    }

    async fn e2e_blocked_org_reaches_only_its_cleanup_retry() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("orgretry{}", run_suffix());
        ingest_one(&app, &headers, &org).await;

        db::org_status::broadcast_deleting(&org).await.unwrap();
        let mut answers = vec![];
        for (method, uri) in [
            (
                Method::POST,
                format!("/api/{org}/org_cleanup_tasks/{org}/retry"),
            ),
            (
                Method::POST,
                format!("/api/{org}/org_cleanup_tasks/default/retry"),
            ),
            (Method::GET, format!("/api/{org}/org_cleanup_tasks/{org}")),
            (Method::GET, format!("/api/{org}/streams")),
        ] {
            let (status, body) =
                make_request(&app, method, &uri, Some(headers.clone()), None).await;
            answers.push((uri, status, String::from_utf8_lossy(&body).to_string()));
        }
        db::org_status::set_active(&org).await.unwrap();

        let (own, rest) = answers.split_first().unwrap();
        // This build's handler answers in place of the gate.
        assert!(
            own.2.contains("Not supported on this deployment"),
            "{own:?}"
        );
        for (uri, status, body) in rest {
            assert_eq!(
                (*status, body.as_str()),
                (StatusCode::FORBIDDEN, "Organization is deleted"),
                "{uri}"
            );
        }
    }

    async fn e2e_compactor_pass_keeps_rows_of_a_deleting_org() {
        let org = format!("t13overlap{}", run_suffix());
        add_deleting_org(&org).await;
        add_tasks(
            &org,
            &[("drain_deleted_files", 250), ("delete_db_resources", 300)],
        )
        .await;
        let file = deleted_file(&org, "a");
        // A directory at the object's path makes the local store's delete fail with an IO error.
        let blocker = format!("{}{}", get_config().common.data_stream_dir, file.file);
        std::fs::create_dir_all(format!("{blocker}/child")).unwrap();
        infra::file_list::batch_add_deleted(&org, Utc::now().timestamp_micros(), &[file])
            .await
            .unwrap();

        // The compactor's delayed deletion, as a pass that listed the org before its cleanup began.
        let pass = compaction::deleted::delete(&org, Utc::now().timestamp_micros()).await;
        let kept = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap()
            .len();
        run_cleanup_once().await;
        let drain = cleanup_task(&org, "drain_deleted_files").await;
        let provider_step = cleanup_task(&org, "delete_db_resources").await;
        let _ = std::fs::remove_dir_all(&blocker);
        remove_deleted_rows(&org).await;
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();
        infra::table::organizations::remove(&org).await.unwrap();

        assert!(pass.is_err(), "{pass:?}");
        assert_eq!(
            kept, 1,
            "the compactor removed the row of a surviving object"
        );
        assert_eq!(drain.status, "failed", "{drain:?}");
        assert_eq!(
            (provider_step.status.as_str(), provider_step.attempts),
            ("pending", 0),
            "{provider_step:?}"
        );
    }

    async fn e2e_compactor_pass_refuses_an_unloaded_account_of_a_deleting_org() {
        let org = format!("t14account{}", run_suffix());
        add_deleting_org(&org).await;
        let file = config::meta::stream::FileListDeleted {
            account: format!("{org}_gone:default"),
            ..deleted_file(&org, "a")
        };
        // The same key on the default store must survive: the row names another bucket.
        infra::storage::put("", &file.file, Bytes::from_static(b"kept"))
            .await
            .unwrap();
        let path = format!("{}{}", get_config().common.data_stream_dir, file.file);
        infra::file_list::batch_add_deleted(&org, Utc::now().timestamp_micros(), &[file])
            .await
            .unwrap();

        let pass = compaction::deleted::delete(&org, Utc::now().timestamp_micros()).await;
        let left = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap()
            .len();
        let survived = std::path::Path::new(&path).exists();
        let _ = std::fs::remove_file(&path);
        remove_deleted_rows(&org).await;
        infra::table::organizations::remove(&org).await.unwrap();

        assert!(
            pass.as_ref()
                .is_err_and(|e| e.to_string().contains("not loaded")),
            "{pass:?}"
        );
        assert_eq!(left, 1, "the row of an unreachable account was removed");
        assert!(survived, "the default store's object was deleted instead");
    }

    async fn e2e_compactor_removal_waits_for_deletion_start() {
        let org = format!("t15window{}", run_suffix());
        infra::table::organizations::add(
            &org,
            &org,
            config::meta::organization::OrganizationType::Default,
        )
        .await
        .unwrap();
        let file = deleted_file(&org, "a");
        // A directory at the object's path fails the delete, and the lenient pass swallows it.
        let blocker = format!("{}{}", get_config().common.data_stream_dir, file.file);
        std::fs::create_dir_all(format!("{blocker}/child")).unwrap();
        infra::file_list::batch_add_deleted(&org, Utc::now().timestamp_micros(), &[file])
            .await
            .unwrap();

        let (reached, resume) = compaction::deleted::pause_before_removal(&org);
        let mut pass = tokio::spawn({
            let org = org.clone();
            async move { compaction::deleted::delete(&org, Utc::now().timestamp_micros()).await }
        });
        tokio::select! {
            r = reached => r.unwrap(),
            done = &mut pass => panic!("the batch never reached its row removal: {done:?}"),
        }
        let mut deletion = tokio::spawn({
            let org = org.clone();
            async move {
                openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com").await
            }
        });
        let early = tokio::time::timeout(tokio::time::Duration::from_secs(3), &mut deletion).await;
        let started_early = early.is_ok();
        let status_while_paused = org_status_of(&org).await;
        resume.send(()).unwrap();
        let pass = pass.await.unwrap();
        let deletion = match early {
            Ok(done) => done.unwrap(),
            Err(_) => deletion.await.unwrap(),
        };
        let status_after = org_status_of(&org).await;
        let left = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap()
            .len();
        let _ = std::fs::remove_dir_all(&blocker);
        remove_deleted_rows(&org).await;
        infra::table::organizations::remove(&org).await.unwrap();
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();

        assert!(
            !started_early,
            "the deletion started while a lenient batch held rows it was about to remove"
        );
        assert_eq!(status_while_paused.as_deref(), Some("active"));
        assert_eq!(pass.unwrap(), 1, "the paused batch did not remove its row");
        assert_eq!(left, 0);
        assert!(deletion.is_ok(), "{deletion:?}");
        assert_eq!(status_after.as_deref(), Some("deleting"));
    }

    async fn e2e_retry_backfills_missing_steps_and_resets_attempts() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("t3retry{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        assert!(
            openobserve_core::org_cleanup::retry(&org).await.is_err(),
            "retry must refuse an active org"
        );

        assert!(
            infra::table::organizations::set_status_if(&org, "active", "deleting")
                .await
                .unwrap()
        );
        db::org_status::broadcast_deleting(&org).await.unwrap();
        // The six step names that orgs enqueued before Phase 0 carry.
        add_tasks(
            &org,
            &[
                ("delete_streams", 100),
                ("delete_file_list", 200),
                ("delete_db_resources", 300),
                ("delete_scheduler_triggers", 400),
                ("delete_users", 600),
                ("delete_org_record", 900),
            ],
        )
        .await;
        exhaust_task(&org, "delete_file_list").await;

        openobserve_core::org_cleanup::retry(&org).await.unwrap();
        // Every row now exists, so this insert conflicts on all of them.
        openobserve_core::org_cleanup::retry(&org).await.unwrap();
        let tasks = infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
            .await
            .unwrap();
        for step in openobserve_core::org_cleanup::fixed_steps(&org, &org) {
            assert!(
                tasks.iter().any(|t| t.step == step.step),
                "{} not backfilled: {tasks:#?}",
                step.step
            );
        }
        assert!(tasks.iter().all(|t| t.attempts < 10), "{tasks:#?}");

        drive_cleanup_until_done(&org, 30).await;
        assert_eq!(org_status_of(&org).await.as_deref(), Some("deleted"));
    }

    async fn e2e_scan_failed_sets_gauge_and_emits_once() {
        let org = format!("t6scan{}", run_suffix());
        add_tasks(&org, &[("delete_db_resources", 300)]).await;
        exhaust_task(&org, "delete_db_resources").await;

        let first = openobserve_core::org_cleanup::scan_failed().await.unwrap();
        let second = openobserve_core::org_cleanup::scan_failed().await.unwrap();
        let gauge = failed_steps_gauge(&org);
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();
        let after_recovery = openobserve_core::org_cleanup::scan_failed().await.unwrap();

        assert!(first.contains(&org), "{first:?}");
        assert!(!second.contains(&org), "alerted twice: {second:?}");
        assert!(!after_recovery.contains(&org));
        assert_eq!(gauge, 1);
        assert_eq!(failed_steps_gauge(&org), 0);
    }

    async fn e2e_reconcile_requeues_deleting_org_without_tasks() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("t7recon{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        assert!(
            infra::table::organizations::set_status_if(&org, "active", "deleting")
                .await
                .unwrap()
        );
        db::org_status::broadcast_deleting(&org).await.unwrap();

        let requeued = openobserve_core::org_cleanup::reconcile().await.unwrap();
        let tasks = infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
            .await
            .unwrap();
        assert!(requeued >= 1);
        assert_eq!(
            tasks.len(),
            openobserve_core::org_cleanup::fixed_steps(&org, &org).len(),
            "{tasks:#?}"
        );

        drive_cleanup_until_done(&org, 30).await;
        assert_eq!(org_status_of(&org).await.as_deref(), Some("deleted"));
        openobserve_core::org_cleanup::reconcile().await.unwrap();
        assert!(
            infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
                .await
                .unwrap()
                .is_empty(),
            "reconcile revived a finished deletion"
        );
    }

    async fn e2e_delete_org_record_is_idempotent() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("t8rec{}", run_suffix());
        ingest_one(&app, &headers, &org).await;
        assert!(
            infra::table::organizations::set_status_if(&org, "active", "deleting")
                .await
                .unwrap()
        );
        add_tasks(&org, &[("delete_org_record", 900)]).await;
        assert!(
            infra::coordinator::ingest_rejection::put_if_revision(
                &org,
                Bytes::from_static(b"[]"),
                None
            )
            .await
            .unwrap()
        );

        let first = openobserve_core::org_cleanup::step_delete_org_record(&org).await;
        let second = openobserve_core::org_cleanup::step_delete_org_record(&org).await;

        assert!(first.unwrap(), "the first run tombstones the org");
        assert!(
            !second.unwrap(),
            "a repeat must succeed without counting as the transition that emits OrgDeleted"
        );
        assert_eq!(org_status_of(&org).await.as_deref(), Some("deleted"));
        assert!(db::org_status::is_blocked(&org));
        assert!(
            infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(
            infra::coordinator::ingest_rejection::get(&org)
                .await
                .unwrap()
                .is_none(),
            "the org's ingest rejection key outlived the deletion"
        );
    }

    async fn e2e_initiate_rolls_back_status_when_add_batch_fails() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("t9atomic{}", run_suffix());
        ingest_one(&app, &headers, &org).await;

        unsafe { env::set_var("ZO_ORG_CLEANUP_FAIL_STEP", "enqueue") };
        let result =
            openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com").await;
        unsafe { env::remove_var("ZO_ORG_CLEANUP_FAIL_STEP") };

        assert!(result.is_err());
        assert_eq!(org_status_of(&org).await.as_deref(), Some("active"));
        assert!(!db::org_status::is_blocked(&org));
        assert!(
            infra::table::org_cleanup_tasks::list_by_org_status(&org, None)
                .await
                .unwrap()
                .is_empty()
        );
    }

    async fn e2e_org_delete_retry_after_exhaustion() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let org = format!("t10exh{}", run_suffix());
        ingest_one(&app, &headers, &org).await;

        unsafe { env::set_var("ZO_ORG_CLEANUP_FAIL_STEP", "delete_db_resources") };
        openobserve_core::org_cleanup::initiate_deletion(&org, "root@example.com")
            .await
            .unwrap();
        let mut stuck = cleanup_task(&org, "delete_db_resources").await;
        for _ in 0..40 {
            if openobserve_core::org_cleanup::is_exhausted(&stuck) {
                break;
            }
            run_cleanup_once().await;
            stuck = cleanup_task(&org, "delete_db_resources").await;
        }
        let gauge_when_stuck = failed_steps_gauge(&org);
        unsafe { env::remove_var("ZO_ORG_CLEANUP_FAIL_STEP") };
        run_cleanup_once().await;
        let still_stuck = cleanup_task(&org, "delete_db_resources").await;

        openobserve_core::org_cleanup::retry(&org).await.unwrap();
        drive_cleanup_until_done(&org, 30).await;

        assert!(
            openobserve_core::org_cleanup::is_exhausted(&stuck),
            "{stuck:?}"
        );
        assert_eq!(gauge_when_stuck, 1);
        assert_eq!(
            still_stuck.attempts, 10,
            "an exhausted step must wait for retry: {still_stuck:?}"
        );
        assert_eq!(org_status_of(&org).await.as_deref(), Some("deleted"));
        assert_eq!(failed_steps_gauge(&org), 0);
    }

    async fn e2e_1_post_bulk() {
        let auth = setup();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/input.json");
        let body_str = fs::read_to_string(path).expect("Read file failed");
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/_bulk", "e2e"),
            Some(headers),
            Some(body_str),
        )
        .await;
        if !status.is_success() {
            let body_str = String::from_utf8_lossy(&body);
            panic!(
                "e2e_1_post_bulk failed with status {}: {}",
                status, body_str
            );
        }
    }

    async fn e2e_post_json() {
        let auth = setup();

        let app = init_test_router();
        let headers = auth_headers(auth);

        // timestamp in past
        let body_str = "[{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\",\"_timestamp\":1665136888163792}]";
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/{}/_json", "e2e", "olympics_schema"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
        let res: IngestionResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(res.code, 200);
        assert_eq!(res.status.len(), 1);
        assert_eq!(res.status[0].status.successful, 0);
        assert_eq!(res.status[0].status.failed, 1);
        assert!(res.status[0].status.error.contains("Too old data"));
        assert!(
            res.status[0]
                .status
                .error
                .contains("ZO_INGEST_ALLOWED_UPTO=")
        );

        // timestamp in future
        let body_str = "[{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\",\"_timestamp\":9999999999999999}]";
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/{}/_json", "e2e", "olympics_schema"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
        let res: IngestionResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(res.code, 200);
        assert_eq!(res.status.len(), 1);
        assert_eq!(res.status[0].status.successful, 0);
        assert_eq!(res.status[0].status.failed, 1);
        assert!(res.status[0].status.error.contains("Too far data"));
        assert!(
            res.status[0]
                .status
                .error
                .contains("ZO_INGEST_ALLOWED_IN_FUTURE=")
        );

        // timestamp not present
        let body_str = "[{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\"}]";
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/{}/_json", "e2e", "olympics_schema"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
        let res: IngestionResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(res.code, 200);
        assert_eq!(res.status.len(), 1);
        assert_eq!(res.status[0].status.successful, 1);
        assert_eq!(res.status[0].status.failed, 0);

        // timestamp just right
        let ts = chrono::Utc::now().timestamp_micros();
        let body_str = format!(
            "[{{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\",\"_timestamp\":{ts}}}]"
        );
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/{}/_json", "e2e", "olympics_schema"),
            Some(headers.clone()),
            Some(body_str),
        )
        .await;
        assert!(status.is_success());
        let res: IngestionResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(res.code, 200);
        assert_eq!(res.status.len(), 1);
        assert_eq!(res.status[0].status.successful, 1);
        assert_eq!(res.status[0].status.failed, 0);
    }

    async fn e2e_post_hec() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        // test case : missing index in metadata
        let body_str = "{\"event\":\"hello\"}";
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/_hec", "e2e"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());

        // test case : valid payload
        let body_str = "{\"event\":\"hello\",\"index\":\"hec_test\"}";
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/_hec", "e2e"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());

        // test case : json event
        let body_str =
            "{\"event\":{\"log\":\"hello\",\"severity\":\"info\"},\"index\":\"hec_test\"}";
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/_hec", "e2e"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());

        // test case : ndjson
        let body_str = r#"
                { "index": "hec_test", "event": "test log", "time": 1749113798091 }
                { "index": "hec_test", "event": {"log":"test log","severity":"info"}, "fields": {"cluster":"c1", "namespace":"n1"} }
                { "index": "hec_test", "event": {"log":"test log","severity":"info"}, "source" : "e2e_test", "fields": {"cluster":"c1", "namespace":"n1"}}
            "#;
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/_hec", "e2e"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_multi() {
        let auth = setup();
        let body_str = "{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\",\"_timestamp\":1665136888163792}";
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/{}/_multi", "e2e", "olympics_schema"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_get_stream() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/streams", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_get_stream_schema() {
        let auth = setup();
        let one_sec = time::Duration::from_secs(2);
        thread::sleep(one_sec);
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/streams/{}/schema", "e2e", "olympics_schema"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_stream_settings() {
        let auth = setup();
        let body_str = r#"{"partition_keys":{"add":[{"field":"test_key"}],"remove":[]}, "full_text_search_keys":{"add":["city"],"remove":[]}}"#;
        // app
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::PUT,
            &format!("/api/{}/streams/{}/settings", "e2e", "olympics_schema"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_stream() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/streams/{}", "e2e", "olympics_schema"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_get_es_settings() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_function() {
        let auth = setup();
        let body_str = r#"{
            "name": "e2etestfn",
            "function":".sqNew,err = .Year*.Year \n .",
            "params":"row"
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/functions", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        if !status.is_success() {
            let body_str = String::from_utf8_lossy(&body);
            println!("e2e_post_function response status: {status:?}");
            println!("e2e_post_function response body: {body_str:?}");

            // If function already exists, that's OK for our test
            if status == StatusCode::BAD_REQUEST && body_str.contains("Function already exist") {
                println!("Function already exists, continuing with test");
                return;
            }

            panic!("e2e_post_function failed with status: {status:?}");
        }
        assert!(status.is_success());
    }

    async fn e2e_list_functions() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/functions", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_function() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/functions/{}", "e2e", "e2etestfn"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_search() {
        let auth = setup();
        let body_str = r#"{
            "query": {
                "sql": "select * from olympics_schema",
                "from": 0,
                "size": 100,
                "start_time": 1714857600000,
                "end_time": 1714944000000
            }
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/_search", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_search_around() {
        let auth = setup();

        let app = init_test_router();
        let ts = chrono::Utc::now().timestamp_micros();

        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!(
                "/api/{}/{}/_around?key={}&size=10",
                "e2e", "olympics_schema", ts
            ),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_list_users() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/users", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
        let body_str = String::from_utf8_lossy(&body);
        println!("list users resp: {body_str:?}");
        // deserialize the body into UserList
        let user_list: UserList = serde_json::from_str(&body_str).unwrap();
        assert!(!user_list.data.is_empty());
        assert!(
            user_list
                .data
                .iter()
                .any(|user| user.email == "admin@example.com")
        );
        assert!(
            user_list
                .data
                .iter()
                .any(|user| user.email == "nonadmin@example.com")
        );
    }

    async fn e2e_get_organizations() {
        use base64::Engine;

        let auth = setup();
        let app = init_test_router();
        // The non-root path lists orgs through memberships, whose own created_at must not leak.
        let member_auth = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD
                .encode("nonadmin@example.com:Newpass12!Abcde")
        );
        for headers in [
            auth_headers(auth),
            auth_headers((auth.0, member_auth.as_str())),
        ] {
            let (status, body) =
                make_request(&app, Method::GET, "/api/organizations", Some(headers), None).await;
            assert!(status.is_success());
            let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let orgs = json["data"].as_array().unwrap();
            assert!(!orgs.is_empty());
            for org in orgs {
                let stored = infra::table::organizations::get(org["identifier"].as_str().unwrap())
                    .await
                    .unwrap();
                assert_eq!(org["created_at"].as_i64(), Some(stored.created_at), "{org}");
                assert!(stored.created_at > 0);
            }
        }
    }

    async fn e2e_get_user_passcode() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/passcode", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_update_user_passcode() {
        let auth = setup();
        let body_str = "";
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::PUT,
            &format!("/api/{}/passcode", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_user_authentication() {
        let _auth = setup();
        let body_str = r#"{
                                "name": "root@example.com",
                                "password": "Complexpass#123"
                            }"#;
        let app = init_test_router();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let (status, _body) = make_request(
            &app,
            Method::POST,
            "/auth/login",
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_user_authentication_with_error() {
        let _auth = setup();
        let body_str = r#"{
                                "name": "root2@example.com",
                                "password": "Complexpass#123"
                            }"#;
        let app = init_test_router();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        let (status, _body) = make_request(
            &app,
            Method::POST,
            "/auth/login",
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(!status.is_success());
    }

    async fn e2e_post_user() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        // Delete user if it exists from previous test runs to avoid conflicts
        let _ = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"),
            Some(headers.clone()),
            None,
        )
        .await;

        let body_str = r#"{
                                "email": "nonadmin@example.com",
                                "password": "Abcd12345!Zyxwv",
                                "role": "admin"
                            }"#;
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/users", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        // print the body from resp
        println!("post user status: {status:?}");
        println!("post user body: {}", String::from_utf8_lossy(&body));
        assert!(status.is_success());
    }

    async fn e2e_update_user() {
        let auth = setup();
        let body_str = r#"{
                                "email": "nonadmin@example.com",
                                "new_password": "Newpass12!Abcde",
                                "change_password": true
                            }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::PUT,
            &format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_update_user_with_empty() {
        let auth = setup();
        let body_str = r#"{}"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::PUT,
            &format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(!status.is_success());
    }

    async fn e2e_add_root_user_to_org() {
        let auth = setup();
        let body_str = r#"{
            "role":"member"
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/users/{}", "e2e", "root@example.com"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        // It should fail as root user cannot be added to an organization
        assert!(!status.is_success());
    }

    async fn e2e_add_user_to_org() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        // Check if admin@example.com already exists from initialization
        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/users", "e2e"),
            Some(headers.clone()),
            None,
        )
        .await;
        assert!(status.is_success());
        let body_str = String::from_utf8_lossy(&body);
        let user_list: UserList = serde_json::from_str(&body_str).unwrap();
        let admin_exists = user_list
            .data
            .iter()
            .any(|user| user.email == "admin@example.com");

        if !admin_exists {
            // Test that adding user to org fails when user doesn't exist
            let body_str = r#"{
                "role":"admin"
            }"#;
            let (status, _body) = make_request(
                &app,
                Method::POST,
                &format!("/api/{}/users/{}", "e2e", "admin@example.com"),
                Some(headers.clone()),
                Some(body_str.to_string()),
            )
            .await;
            // Should fail as the user still does not exist
            assert!(status.is_client_error());

            // Add the user
            let body_str = r#"{
                "email": "admin@example.com",
                "password": "Abcd12345!Zyxwv",
                "role": "admin"
            }"#;

            let (status, _body) = make_request(
                &app,
                Method::POST,
                &format!("/api/{}/users", "e2e"),
                Some(headers.clone()),
                Some(body_str.to_string()),
            )
            .await;
            assert!(status.is_success());
        }

        // Role in the default organization
        let body_str = r#"{
            "role":"admin"
        }"#;

        // Add the user to the default organization with role admin
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/users/{}", "default", "admin@example.com"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        println!(
            "add user to default org body: {}",
            String::from_utf8_lossy(&body)
        );
        // Accept both success (user added) and conflict (user already in org) as valid outcomes
        assert!(status.is_success() || status.as_u16() == 409);
    }

    async fn e2e_delete_user() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_create_dashboard() -> Dashboard {
        let auth = setup();
        let body_str = r##"{"version":5,"title":"b2","dashboardId":"","description":"desc2","role":"","owner":"root@example.com","created":"2023-03-30T07:49:41.744+00:00","tabs":[{"tabId":"tab1","name":"Main","panels":[{"id":"Panel_ID7857010","type":"bar","title":"p5","description":"sample config blah blah blah","config":{"show_legends":true},"queryType":"sql","queries":[{"query":"SELECT histogram(_timestamp) as \"x_axis_1\", count(kubernetes_host) as \"y_axis_1\" FROM \"default\" GROUP BY \"x_axis_1\" ORDER BY \"x_axis_1\"","customQuery":false,"fields":{"stream":"default","stream_type":"logs","x":[{"label":"Timestamp","alias":"x_axis_1","column":"_timestamp","color":null,"aggregationFunction":"histogram"}],"y":[{"label":"Kubernetes Host","alias":"y_axis_1","column":"kubernetes_host","color":"#5960b2","aggregationFunction":"count"}],"filter":{"filterType":"group","logicalOperator":"AND","conditions":[]}},"config":{"promql_legend":""}}],"layout":{"x":0,"y":0,"w":12,"h":13,"i":1}}]}]}"##;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (_status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/dashboards", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;

        let body_str = String::from_utf8_lossy(&body);
        let result: Dashboard = json::from_slice(&body)
            .unwrap_or_else(|e| panic!("Failed to deserialize dashboard: {e}\nBody: {body_str}"));
        result
    }

    async fn e2e_list_dashboards() -> Vec<Dashboard> {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (_status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/dashboards", "e2e"),
            Some(headers),
            None,
        )
        .await;

        // Try to parse the response body as a list of dashboards.
        let mut body_json: json::Value = json::from_slice(&body).unwrap();
        let list_json = body_json
            .as_object_mut()
            .unwrap()
            .remove("dashboards")
            .unwrap();
        let dashboards: Vec<Dashboard> = json::from_value(list_json).unwrap();

        dashboards
    }

    async fn e2e_update_dashboard(dashboard: v5::Dashboard, hash: String) -> Dashboard {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (_status, body) = make_request(
            &app,
            Method::PUT,
            &format!(
                "/api/{}/dashboards/{}?hash={}",
                "e2e", dashboard.dashboard_id, hash
            ),
            Some(headers),
            Some(json::to_string(&dashboard).unwrap()),
        )
        .await;

        json::from_slice(&body).unwrap()
    }

    async fn e2e_get_dashboard(dashboard_id: &str) -> Dashboard {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (_status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/dashboards/{dashboard_id}", "e2e"),
            Some(headers),
            None,
        )
        .await;

        json::from_slice(&body).unwrap()
    }

    async fn e2e_dashboard_nested_cast_round_trip() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        // sum(TRY_CAST(usage_amount AS DOUBLE)) exactly as the panel builder writes it.
        let body_str = r#"{"version":8,"title":"cast","dashboardId":"","description":"","role":"","owner":"root@example.com","created":"2023-03-30T07:49:41.744+00:00","tabs":[{"tabId":"tab1","name":"Main","panels":[{"id":"Panel_cast","type":"bar","title":"cast","description":"","config":{"show_legends":true},"queryType":"sql","queries":[{"query":"SELECT sum(TRY_CAST(usage_amount AS DOUBLE)) as \"y_axis_1\" FROM \"default\"","customQuery":false,"fields":{"stream":"default","stream_type":"logs","filter":{"filterType":"group","logicalOperator":"AND","conditions":[]},"x":[],"y":[{"label":"Usage","alias":"y_axis_1","type":"build","functionName":"sum","args":[{"type":"function","value":{"functionName":"try_cast","args":[{"type":"field","value":{"field":"usage_amount","streamAlias":null}},{"type":"castType","value":"DOUBLE"}]}}]}]},"config":{"promql_legend":""}}],"layout":{"x":0,"y":0,"w":12,"h":13,"i":1}}]}]}"#;

        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/dashboards", "e2e"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        assert!(
            status.is_success(),
            "create failed: {}",
            String::from_utf8_lossy(&body)
        );

        let created: json::Value = json::from_slice(&body).unwrap();
        let dashboard_id = created["v8"]["dashboardId"].as_str().unwrap().to_string();

        let (_status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/dashboards/{dashboard_id}", "e2e"),
            Some(headers),
            None,
        )
        .await;
        let fetched: json::Value = json::from_slice(&body).unwrap();

        let y = &fetched["v8"]["tabs"][0]["panels"][0]["queries"][0]["fields"]["y"][0];
        assert_eq!(y["functionName"], "sum");

        let cast = &y["args"][0]["value"];
        assert_eq!(cast["functionName"], "try_cast");
        assert_eq!(cast["args"][0]["value"]["field"], "usage_amount");
        assert_eq!(cast["args"][1]["value"], "DOUBLE");

        e2e_delete_dashboard(&dashboard_id).await;
    }

    async fn e2e_delete_dashboard(dashboard_id: &str) {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/dashboards/{dashboard_id}", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_trace() {
        let auth = setup();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/trace_input.json");
        let body_str = fs::read_to_string(path).expect("Read file failed");

        // app
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/traces", "e2e"),
            Some(headers),
            Some(body_str),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_metrics() {
        let auth = setup();

        let loc_label: Vec<prometheus_rpc::Label> = vec![
            prometheus_rpc::Label {
                name: "__name__".to_string(),
                value: "grafana_api_dashboard_save_milliseconds_count".to_string(),
            },
            prometheus_rpc::Label {
                name: "cluster".to_string(),
                value: "prom-k8s".to_string(),
            },
            prometheus_rpc::Label {
                name: "__replica__".to_string(),
                value: "prom-k8s-0".to_string(),
            },
        ];

        let mut loc_samples: Vec<prometheus_rpc::Sample> = vec![];

        for i in 1..2 {
            loc_samples.push(prometheus_rpc::Sample {
                value: i as f64,
                timestamp: Utc::now().timestamp_micros(),
            });
        }
        loc_samples.push(prometheus_rpc::Sample {
            value: f64::NEG_INFINITY,
            timestamp: Utc::now().timestamp_micros(),
        });
        loc_samples.push(prometheus_rpc::Sample {
            value: f64::INFINITY,
            timestamp: Utc::now().timestamp_micros(),
        });

        loc_samples.push(prometheus_rpc::Sample {
            value: f64::NAN,
            timestamp: Utc::now().timestamp_micros(),
        });
        let exemplar = |trace_id: &str| prometheus_rpc::Exemplar {
            labels: vec![
                prometheus_rpc::Label {
                    name: "trace_id".to_string(),
                    value: trace_id.to_string(),
                },
                prometheus_rpc::Label {
                    name: "span_id".to_string(),
                    value: "def".to_string(),
                },
            ],
            value: 1.0,
            timestamp: Utc::now().timestamp_millis(),
        };
        let loc_hist: Vec<prometheus_rpc::Histogram> = vec![];

        let ts = prometheus_rpc::TimeSeries {
            labels: loc_label.clone(),
            samples: loc_samples,
            exemplars: vec![exemplar("with-sample")],
            histograms: loc_hist,
        };
        // Prometheus sends an exemplar as a series entry of its own, without the sample
        let exemplar_only = prometheus_rpc::TimeSeries {
            labels: loc_label,
            samples: vec![],
            exemplars: vec![exemplar("exemplar-only")],
            histograms: vec![],
        };

        let metadata: Vec<prometheus_rpc::MetricMetadata> = vec![];
        let wr_req: prometheus_rpc::WriteRequest = prometheus_rpc::WriteRequest {
            timeseries: vec![ts, exemplar_only],
            metadata,
        };
        let mut out = BytesMut::with_capacity(wr_req.encoded_len());
        wr_req.encode(&mut out).expect("Out of memory");
        let data: Bytes = out.into();
        let body = snap::raw::Encoder::new()
            .compress_vec(&data)
            .expect("Out of memory");

        // app
        let app = init_test_router();
        let mut headers = HeaderMap::new();
        headers.insert(
            "X-Prometheus-Remote-Write-Version",
            HeaderValue::from_static("0.1.0"),
        );
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("snappy"));
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-protobuf"),
        );
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(auth.1).expect("Invalid auth header"),
        );

        let req = Request::builder()
            .method(Method::POST)
            .uri(format!("/api/{}/prometheus/api/v1/write", "e2e"));
        let mut req_builder = req;
        for (key, value) in headers.iter() {
            req_builder = req_builder.header(key, value);
        }
        let req = req_builder
            .body(Body::from(body))
            .expect("Failed to build request");

        let response = app
            .clone()
            .oneshot(req)
            .await
            .expect("Failed to execute request");
        let status = response.status();
        assert!(
            status.is_success(),
            "Prometheus write failed with status: {}. This may indicate memtable overflow or resource constraints.",
            status
        );
    }

    async fn e2e_get_org_summary() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/summary", "e2e"),
            Some(headers),
            None,
        )
        .await;
        log::info!("{:?}", status);
        assert!(status.is_success());
    }

    async fn e2e_post_alert_template() {
        let auth = setup();
        let body_str = r#"{"name":"slackTemplate","body":"{\"text\":\"For stream {stream_name} of organization {org_name} alert {alert_name} of type {alert_type} is active app_name {app_name}\"}"}"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/templates", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        let text = String::from_utf8_lossy(&body).to_string();
        println!("e2e_post_alert_template: status: {status:?}, text: {text:?}");
        assert!(status.is_success());
    }

    async fn e2e_get_alert_template() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/templates/{}", "e2e", "slackTemplate"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_alert_template() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/alerts/templates/{}", "e2e", "slackTemplate"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_alert_email_template() {
        let auth = setup();
        let body_str = r#"{"name":"email_template","body":"This is email for {alert_name}.","type":"email","title":"Email Subject"}"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/templates", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_get_alert_email_template() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/templates/{}", "e2e", "email_template"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_alert_email_template() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/alerts/templates/{}", "e2e", "email_template"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_list_alert_template() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/templates", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_alert_destination() {
        let auth = setup();
        let body_str = r#"{
                "name": "slack",
                "url": "https://dummy/alert",
                "method": "post",
                "template": "slackTemplate",
                "headers":{
                    "x_org_id":"Test_header"
                }
            }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/destinations", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_get_alert_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "slack"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_alert_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "slack"),
            Some(headers),
            None,
        )
        .await;
        log::info!("{:?}", status);
        assert!(status.is_success());
    }

    async fn e2e_post_alert_email_destination() {
        let auth = setup();
        let body_str = r#"{"url":"","method":"post","skip_tls_verify":false,"template":"email_template","headers":{},"name":"email","type":"email","emails":["nonadmin@example.com"]}"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/destinations", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_alert_email_destination_should_fail() {
        let auth = setup();
        let body_str = r#"{"url":"","method":"post","skip_tls_verify":false,"template":"email_template","headers":{},"name":"email_fail","type":"email","emails":["nonadmin2@example.com"]}"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/destinations", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_client_error());
    }

    async fn e2e_get_alert_email_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "email"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_alert_email_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "email"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_list_alert_destinations() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/destinations", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_sns_alert_template() {
        let auth = setup();
        let body_str = r#"{
            "name": "snsTemplate",
            "body": "{\"default\": \"SNS alert {alert_name} triggered for {stream_name} in {org_name}\"}"
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/templates", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_sns_alert_destination() {
        let auth = setup();
        let body_str = r#"{
            "name": "sns_alert",
            "type": "sns",
            "sns_topic_arn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
            "aws_region": "us-east-1",
            "template": "snsTemplate"
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/alerts/destinations", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_get_sns_alert_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "sns_alert"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());

        // Optionally, deserialize and check the response body
        let destination: Destination = serde_json::from_slice(&body).unwrap();
        assert_eq!(destination.destination_type, DestinationType::Sns);
        assert_eq!(
            destination.sns_topic_arn,
            Some("arn:aws:sns:us-east-1:123456789012:MyTopic".to_string())
        );
        assert_eq!(destination.aws_region, Some("us-east-1".to_string()));
    }

    async fn e2e_list_alert_destinations_with_sns() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/{}/alerts/destinations", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());

        // Optionally, deserialize and check the response body
        let destinations: Vec<Destination> = serde_json::from_slice(&body).unwrap();
        assert!(
            destinations
                .iter()
                .any(|d| d.destination_type == DestinationType::Sns)
        );
    }

    async fn e2e_update_sns_alert_destination() {
        let auth = setup();
        let body_str = r#"{
            "name": "sns_alert",
            "type": "sns",
            "sns_topic_arn": "arn:aws:sns:us-west-2:123456789012:UpdatedTopic",
            "aws_region": "us-west-2",
            "template": "snsTemplate"
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::PUT,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "sns_alert"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_sns_alert_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/{}/alerts/destinations/{}", "e2e", "sns_alert"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_alert_with_sns_destination() {
        let auth = setup();
        let body_str = r#"{
            "name": "sns_test_alert",
            "stream_type": "logs",
            "stream_name": "olympics_schema",
            "is_real_time": false,
            "query_condition": {
                "conditions": [{
                    "column": "level",
                    "operator": "=",
                    "value": "error"
                }]
            },
            "trigger_condition": {
                "period": 5,
                "threshold": 1,
                "silence": 10
            },
            "destinations": ["sns_alert"],
            "context_attributes": {
                "app_name": "TestApp"
            }
        }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_delete_alert_with_sns_destination() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        let alert = db::alerts::alert::get_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "sns_test_alert",
        )
        .await;
        assert!(alert.is_ok());
        let alert = alert.unwrap();
        assert!(alert.is_some());
        let alert = alert.unwrap();
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/v2/{}/alerts/{}", "e2e", id),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_post_alert_multirange() {
        let auth = setup();
        let body_str = r#"{
                                "name": "alert_multi_range",
                                "stream_type": "logs",
                                "stream_name": "olympics_schema",
                                "is_real_time": false,
                                "query_condition": {
                                    "conditions": [{
                                        "column": "country",
                                        "operator": "=",
                                        "value": "USA"
                                    }],
                                    "multi_time_range": [{
                                        "offSet": "1440m"
                                    }]
                                },
                                "trigger_condition": {
                                    "period": 5,
                                    "threshold": 1,
                                    "silence": 0,
                                    "frequency": 1
                                },
                                "destinations": ["slack"],
                                "context_attributes":{
                                    "app_name":"App1"
                                }
                            }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers),
            Some(body_str.to_string()),
        )
        .await;
        assert!(status.is_success());

        // Get the alert with the same stream name
        let alert = db::alerts::alert::get_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "alert_multi_range",
        )
        .await;
        assert!(alert.is_ok());
        let alert = alert.unwrap();
        assert!(alert.is_some());
        let alert = alert.unwrap();
        assert_eq!(alert.stream_type, config::meta::stream::StreamType::Logs);
        assert_eq!(alert.stream_name, "olympics_schema");
        assert_eq!(alert.name, "alert_multi_range");
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();
        // Check the trigger
        let trigger = db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger);
    }

    async fn e2e_delete_alert_multirange() {
        let auth = setup();
        let app = init_test_router();

        // Get the alert with the same stream name
        let alert = db::alerts::alert::get_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "alert_multi_range",
        )
        .await;
        assert!(alert.is_ok());
        let alert = alert.unwrap();
        assert!(alert.is_some());
        let alert = alert.unwrap();
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();

        // Use the v2 api to delete the alert
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/v2/{}/alerts/{}", "e2e", id),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());

        let trigger = db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(!trigger);
    }

    async fn e2e_post_alert() {
        let auth = setup();
        let body_str = r#"{
                                "name": "alertChk",
                                "stream_type": "logs",
                                "stream_name": "olympics_schema",
                                "is_real_time": false,
                                "enabled": true,
                                "query_condition": {
                                    "conditions": [{
                                        "column": "country",
                                        "operator": "NotContains",
                                        "value": "AUT"
                                    }]
                                },
                                "trigger_condition": {
                                    "period": 60,
                                    "threshold": 1,
                                    "silence": 0,
                                    "frequency": 60,
                                    "operator": ">="
                                },
                                "destinations": ["slack"],
                                "context_attributes":{
                                    "app_name":"App1"
                                }
                            }"#;
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers.clone()),
            Some(body_str.to_string()),
        )
        .await;
        println!("{:?}", status);
        assert!(status.is_success());

        // Get the alert list
        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
        let alert_list_response: ListAlertsResponseBody = serde_json::from_slice(&body).unwrap();
        assert!(!alert_list_response.list.is_empty());
        let alert = alert_list_response
            .list
            .iter()
            .find(|a| a.name == "alertChk");
        assert!(alert.is_some());
        let alert = alert.unwrap();
        assert_eq!(alert.name, "alertChk");
        assert!(alert.enabled);
        let id = alert.alert_id;
        let id = id.to_string();

        // Check the trigger
        let trigger = db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger);
    }

    async fn e2e_get_alert() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);

        // Get the alert list
        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers.clone()),
            None,
        )
        .await;
        assert!(status.is_success());
        let alert_list_response: ListAlertsResponseBody = serde_json::from_slice(&body).unwrap();
        assert!(!alert_list_response.list.is_empty());
        let alert = alert_list_response
            .list
            .iter()
            .find(|a| a.name == "alertChk");
        assert!(alert.is_some());
        let alert = alert.unwrap();
        assert_eq!(alert.name, "alertChk");
        assert!(alert.enabled);
        let id = alert.alert_id;
        let id = id.to_string();

        let (status, body) = make_request(
            &app,
            Method::GET,
            &format!("/api/v2/{}/alerts/{}", "e2e", id),
            Some(headers),
            None,
        )
        .await;
        log::info!("{:?}", status);
        assert!(status.is_success());
        let alert_response: GetAlertResponseBody = serde_json::from_slice(&body).unwrap();
        assert_eq!(alert_response.0.name, "alertChk");
        assert_eq!(
            alert_response.0.stream_type,
            openobserve_api_management::models::alerts::StreamType::Logs
        );
        assert_eq!(alert_response.0.stream_name, "olympics_schema");
        assert!(alert_response.0.enabled);
    }

    async fn e2e_handle_alert_after_destination_retries() {
        let alert = db::alerts::alert::get_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "alertChk",
        )
        .await;
        assert!(alert.is_ok());
        let alert = alert.unwrap();
        assert!(alert.is_some());
        let alert = alert.unwrap();
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();

        let now = Utc::now().timestamp_micros();
        let mins_3_later = now
            + Duration::try_minutes(3)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let trigger = Trigger {
            id: 1,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: config::meta::triggers::TriggerModule::Alert,
            module_key: id.to_string(),
            start_time: Some(now),
            end_time: Some(mins_3_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 2,
            data: "{}".to_string(),
        };

        let trace_id = "test_trace_id";
        let res = handle_triggers(trace_id, trigger).await;
        // This alert has an invalid destination, but handle_triggers should succeed.
        // Note: May get partial results if files are cleaned up during test execution.
        if let Err(ref e) = res {
            let err_msg = e.to_string();
            // Accept partial response errors due to file cleanup race conditions in tests
            if !err_msg.contains("Partial response") && !err_msg.contains("parquet file not found")
            {
                panic!("handle_triggers failed unexpectedly: {:?}", res);
            }
        }

        let trigger = db::scheduler::get(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.next_run_at > now && trigger.retries == 0);
    }

    async fn e2e_handle_alert_reached_max_retries() {
        let now = Utc::now().timestamp_micros();
        let mins_3_later = now
            + Duration::try_minutes(3)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let alert = db::alerts::alert::get_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "alertChk",
        )
        .await;
        assert!(alert.is_ok());
        let alert = alert.unwrap();
        assert!(alert.is_some());
        let alert = alert.unwrap();
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();
        let trigger = Trigger {
            id: 1,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: config::meta::triggers::TriggerModule::Alert,
            module_key: id.to_string(),
            start_time: Some(now),
            end_time: Some(mins_3_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 3,
            data: "{}".to_string(),
        };

        let trace_id = "test_trace_id";
        let res = handle_triggers(trace_id, trigger).await;
        // This alert has an invalid destination
        assert!(res.is_ok());

        let trigger = db::scheduler::get(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.next_run_at > now && trigger.retries == 0);
    }

    async fn e2e_handle_alert_after_evaluation_retries() {
        let mut alert: Alert = Default::default();
        alert.name = "test_alert_wrong_sql".to_string();
        alert.stream_type = "logs".into();
        alert.stream_name = "olympics_schema".to_string();
        alert.is_real_time = false;
        alert.enabled = true;
        alert.query_condition = QueryCondition {
            query_type: config::meta::alerts::QueryType::SQL,
            conditions: None,
            sql: Some("SELEC country FROM \"olympics_schema\"".to_string()),
            ..Default::default()
        };
        alert.trigger_condition = TriggerCondition {
            period: 60,
            threshold: 1,
            silence: 0,
            frequency: 3600,
            operator: Operator::GreaterThanEquals,
            ..Default::default()
        };
        alert.destinations = vec!["slack".to_string()];

        let res = db::alerts::alert::set("e2e", alert, true).await;
        assert!(res.is_ok());
        let alert = res.unwrap();
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();

        let now = Utc::now().timestamp_micros();
        let mins_3_later = now
            + Duration::try_minutes(3)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let trigger = Trigger {
            id: 1,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: config::meta::triggers::TriggerModule::Alert,
            module_key: id.to_string(),
            start_time: Some(now),
            end_time: Some(mins_3_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 2,
            data: "{}".to_string(),
        };

        let trace_id = "test_trace_id";
        let res = handle_triggers(trace_id, trigger).await;
        // In case of alert evaluation errors, this error is returned
        assert!(res.is_err());

        let trigger = db::scheduler::get(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.next_run_at > now && trigger.retries == 0);

        let res =
            db::alerts::alert::delete_by_id(infra::db::get_orm_client_rw().await, "e2e", id).await;
        assert!(res.is_ok());
    }

    async fn e2e_delete_alert() {
        let auth = setup();
        let app = init_test_router();

        let alert = db::alerts::alert::get_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "alertChk",
        )
        .await;
        assert!(alert.is_ok());
        let alert = alert.unwrap();
        assert!(alert.is_some());
        let alert = alert.unwrap();
        let id = alert.id;
        assert!(id.is_some());
        let id = id.unwrap();

        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::DELETE,
            &format!("/api/v2/{}/alerts/{}", "e2e", id),
            Some(headers),
            None,
        )
        .await;
        log::info!("{:?}", status);
        assert!(status.is_success());

        let trigger = db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(!trigger);
    }

    async fn e2e_list_alerts() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_list_real_time_alerts() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::GET,
            &format!("/api/v2/{}/alerts", "e2e"),
            Some(headers),
            None,
        )
        .await;
        assert!(status.is_success());
    }

    async fn e2e_health_check() {
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, _body) =
            make_request(&app, Method::GET, "/healthz", Some(headers), None).await;
        assert!(status.is_success());
    }

    async fn e2e_config() {
        let auth = setup();
        let app = init_test_router();
        let (status, body) = make_request(&app, Method::GET, "/config", None, None).await;
        assert!(status.is_success());
        let bootstrap: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(bootstrap.get("rum").is_none(), "{bootstrap}");
        assert!(bootstrap.get("commit_hash").is_some(), "{bootstrap}");

        let headers = auth_headers(auth);
        let (status, body) =
            make_request(&app, Method::GET, "/api/e2e/config", Some(headers), None).await;
        assert!(status.is_success());
        let full: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(full["rum"]["version"], config::VERSION, "{full}");
        assert!(full["rum"].get("client_token").is_some(), "{full}");
    }

    // Helper function to create pipeline via API
    async fn e2e_post_pipeline(pipeline_data: Pipeline) {
        let auth = setup();
        let body_str = serde_json::to_string(&pipeline_data).unwrap();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) = make_request(
            &app,
            Method::POST,
            &format!("/api/{}/pipelines", "e2e"),
            Some(headers),
            Some(body_str),
        )
        .await;
        if !status.is_success() {
            println!("Response body: {}", String::from_utf8_lossy(&body));
            panic!("Failed to create pipeline");
        }
    }

    // Derived Stream Integration Tests
    async fn e2e_create_test_pipeline() {
        // Create a test pipeline with derived stream for testing
        let pipeline_data = Pipeline {
            id: "test_derived_stream_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "e2e".to_string(),
            name: "test_derived_stream".to_string(),
            description: "Test pipeline for derived stream integration tests".to_string(),
            source: PipelineSource::Scheduled(DerivedStream {
                org_id: "e2e".to_string(),
                stream_type: StreamType::Logs,
                query_condition: QueryCondition {
                    query_type: config::meta::alerts::QueryType::SQL,
                    sql: Some("SELECT _timestamp FROM \"olympics_schema\"".to_string()),
                    ..Default::default()
                },
                trigger_condition: TriggerCondition {
                    period: 5,      // 5 minutes
                    frequency: 300, // 5 minutes in seconds
                    ..Default::default()
                },
                tz_offset: 0,
                start_at: None,
                delay: None,
            }),
            kind: Default::default(),
            nodes: vec![
                // Source node (query node for scheduled pipeline)
                config::meta::pipeline::components::Node::new(
                    "source-node-1".to_string(),
                    config::meta::pipeline::components::NodeData::Query(DerivedStream {
                        org_id: "e2e".to_string(),
                        stream_type: StreamType::Logs,
                        query_condition: QueryCondition {
                            query_type: config::meta::alerts::QueryType::SQL,
                            sql: Some("SELECT _timestamp FROM \"olympics_schema\"".to_string()),
                            ..Default::default()
                        },
                        trigger_condition: TriggerCondition {
                            period: 5,
                            frequency: 300,
                            ..Default::default()
                        },
                        tz_offset: 0,
                        start_at: None,
                        delay: None,
                    }),
                    100.0,
                    50.0,
                    "input".to_string(),
                ),
                // Destination node (output stream)
                config::meta::pipeline::components::Node::new(
                    "dest-node-1".to_string(),
                    config::meta::pipeline::components::NodeData::Stream(
                        config::meta::stream::StreamParams {
                            org_id: "e2e".to_string().into(),
                            stream_name: "test_derived_output_stream".to_string().into(),
                            stream_type: StreamType::Logs,
                        },
                    ),
                    100.0,
                    200.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![config::meta::pipeline::components::Edge::new(
                "source-node-1".to_string(),
                "dest-node-1".to_string(),
            )],
        };

        // Save pipeline using API call
        e2e_post_pipeline(pipeline_data).await;
    }

    async fn e2e_handle_derived_stream_success() {
        // list the pipelines and choose the first one using API
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) =
            make_request(&app, Method::GET, "/api/e2e/pipelines", Some(headers), None).await;
        assert!(status.is_success());
        let pipeline_list: PipelineList = json::from_slice(&body).unwrap();
        let pipeline = pipeline_list.list.first();
        assert!(pipeline.is_some());
        let pipeline = pipeline.unwrap();

        let now = Utc::now().timestamp_micros();
        let mins_5_later = now
            + Duration::try_minutes(5)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let module_key = format!("logs/e2e/test_derived_stream/{}", pipeline.id);
        println!(
            "e2e handle derived stream success module_key: {}, where pipeline name is {}",
            module_key, pipeline.name
        );

        let trigger = Trigger {
            id: 1,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: TriggerModule::DerivedStream,
            module_key: module_key.clone(),
            start_time: Some(now),
            end_time: Some(mins_5_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 0,
            data: "{}".to_string(),
        };

        let trace_id = "test_derived_stream_trace_id";
        let res = handle_triggers(trace_id, trigger).await;
        // Should succeed even with empty data
        assert!(res.is_ok());

        // Verify trigger was updated - retry with exponential backoff since trigger processing
        // is async and involves batch updates that may not flush immediately in CI
        let mut attempts = 0;
        let max_attempts = 20;
        let mut delay_ms = 100u64;
        let mut trigger_updated = false;

        while attempts < max_attempts {
            let trigger =
                db::scheduler::get("e2e", TriggerModule::DerivedStream, &module_key).await;

            if let Ok(trigger) = trigger
                && let Ok(scheduled_trigger_data) =
                    serde_json::from_str::<ScheduledTriggerData>(&trigger.data)
                && scheduled_trigger_data.period_end_time.is_some()
            {
                assert!(scheduled_trigger_data.period_end_time.unwrap() > 0);
                assert!(trigger.status == TriggerStatus::Waiting);
                assert!(trigger.next_run_at > now && trigger.retries == 0);
                trigger_updated = true;
                break;
            }

            attempts += 1;
            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
            // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1000ms (capped)
            delay_ms = std::cmp::min(delay_ms * 2, 1000);
        }

        assert!(
            trigger_updated,
            "Trigger was not updated after {max_attempts} attempts"
        );
    }

    async fn e2e_handle_derived_stream_pipeline_not_found() {
        let now = Utc::now().timestamp_micros();
        let mins_5_later = now
            + Duration::try_minutes(5)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let module_key = "logs/e2e/nonexistent_pipeline/invalid_id".to_string();

        let trigger = Trigger {
            id: 2,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: TriggerModule::DerivedStream,
            module_key,
            start_time: Some(now),
            end_time: Some(mins_5_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 0,
            data: "{}".to_string(),
        };

        let trace_id = "test_derived_stream_not_found_trace_id";
        let res = handle_triggers(trace_id, trigger).await;
        // Should fail with pipeline not found error
        assert!(res.is_err());
        assert!(
            res.unwrap_err()
                .to_string()
                .contains("Pipeline associated with trigger not found")
        );
    }

    async fn e2e_handle_derived_stream_max_retries() {
        // list pipelines using API
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) =
            make_request(&app, Method::GET, "/api/e2e/pipelines", Some(headers), None).await;
        assert!(status.is_success());
        let pipeline_list: PipelineList = json::from_slice(&body).unwrap();
        let pipelines = pipeline_list.list.first();
        assert!(pipelines.is_some());
        let pipeline = pipelines.unwrap();

        let now = Utc::now().timestamp_micros();
        let mins_5_later = now
            + Duration::try_minutes(5)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let module_key = format!("logs/e2e/test_derived_stream/{}", pipeline.id);

        let trigger = Trigger {
            id: 3,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: TriggerModule::DerivedStream,
            module_key: module_key.clone(),
            start_time: Some(now),
            end_time: Some(mins_5_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 5, // Max retries reached
            data: "{}".to_string(),
        };

        let trace_id = "test_derived_stream_max_retries_trace_id";
        let res = handle_triggers(trace_id, trigger).await;
        // Should succeed but skip to next run due to max retries
        assert!(res.is_ok());

        // Verify trigger was updated with next run time and retries reset
        let trigger = db::scheduler::get("e2e", TriggerModule::DerivedStream, &module_key).await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.next_run_at > now && trigger.retries == 0);
    }

    async fn e2e_handle_derived_stream_evaluation_failure() {
        // Create a pipeline that queries a non-existent stream to cause evaluation failure.
        // evaluate_scheduled() returns Err when the stream is not found in schema cache,
        // which should increment the trigger's retries counter.
        let pipeline_data = Pipeline {
            id: "test_derived_stream_pipeline_invalid".to_string(),
            version: 1,
            enabled: true,
            org: "e2e".to_string(),
            name: "test_derived_stream_invalid".to_string(),
            description: "Test pipeline with non-existent stream to cause evaluation failure"
                .to_string(),
            source: PipelineSource::Scheduled(DerivedStream {
                org_id: "e2e".to_string(),
                stream_type: StreamType::Logs,
                query_condition: QueryCondition {
                    query_type: config::meta::alerts::QueryType::SQL,
                    sql: Some("SELECT * FROM \"nonexistent_stream_xyz_abc_test\"".to_string()),
                    ..Default::default()
                },
                trigger_condition: TriggerCondition {
                    period: 5,
                    frequency: 300,
                    ..Default::default()
                },
                tz_offset: 0,
                start_at: None,
                delay: None,
            }),
            kind: Default::default(),
            nodes: vec![
                // Source node (query node for scheduled pipeline with non-existent stream)
                config::meta::pipeline::components::Node::new(
                    "source-node-2".to_string(),
                    config::meta::pipeline::components::NodeData::Query(DerivedStream {
                        org_id: "e2e".to_string(),
                        stream_type: StreamType::Logs,
                        query_condition: QueryCondition {
                            query_type: config::meta::alerts::QueryType::SQL,
                            sql: Some(
                                "SELECT * FROM \"nonexistent_stream_xyz_abc_test\"".to_string(),
                            ),
                            ..Default::default()
                        },
                        trigger_condition: TriggerCondition {
                            period: 5,
                            frequency: 300,
                            ..Default::default()
                        },
                        tz_offset: 0,
                        start_at: None,
                        delay: None,
                    }),
                    150.0,
                    50.0,
                    "input".to_string(),
                ),
                // Destination node (output stream)
                config::meta::pipeline::components::Node::new(
                    "dest-node-2".to_string(),
                    config::meta::pipeline::components::NodeData::Stream(
                        config::meta::stream::StreamParams {
                            org_id: "e2e".to_string().into(),
                            stream_name: "test_invalid_pipeline_output".to_string().into(),
                            stream_type: StreamType::Logs,
                        },
                    ),
                    150.0,
                    200.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![config::meta::pipeline::components::Edge::new(
                "source-node-2".to_string(),
                "dest-node-2".to_string(),
            )],
        };

        // Save pipeline directly to DB (bypassing API validation) to simulate a pipeline
        // with an invalid query that was saved before validation was added, or to test
        // what happens at evaluation time when the stream does not exist.
        openobserve_core::pipeline::db::set(&pipeline_data)
            .await
            .expect("Failed to set pipeline in DB");
        // Create the scheduler trigger directly with needs_validated=false so the
        // non-existent stream does not fail the pre-save test run.
        let derived_stream = match &pipeline_data.source {
            PipelineSource::Scheduled(ds) => ds.clone(),
            _ => panic!("Expected scheduled pipeline"),
        };
        openobserve_core::alerts::derived_streams::save(
            derived_stream,
            &pipeline_data.name,
            &pipeline_data.id,
            false,
        )
        .await
        .expect("Failed to save derived stream trigger");

        let pipeline = get_pipeline_from_api(pipeline_data.name.as_str()).await;

        let now = Utc::now().timestamp_micros();
        let mins_5_later = now
            + Duration::try_minutes(5)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let module_key = format!("logs/e2e/test_derived_stream_invalid/{}", pipeline.id);

        let trigger = Trigger {
            id: 4,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: TriggerModule::DerivedStream,
            module_key: module_key.clone(),
            start_time: Some(now),
            end_time: Some(mins_5_later),
            next_run_at: now,
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 0,
            data: "{}".to_string(),
        };

        let trace_id = "test_derived_stream_eval_failure_trace_id";
        let _ = handle_triggers(trace_id, trigger).await;
        // Should succeed (handler handles errors gracefully) but increment retries
        // Verify trigger retries were incremented
        let trigger = db::scheduler::get("e2e", TriggerModule::DerivedStream, &module_key).await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.retries > 0);

        // Clean up the invalid pipeline
        let _ = openobserve_core::pipeline::db::delete(&pipeline.id).await;
    }

    // Test to handle case where pipeline triggers for invalid timerange where start time
    // is greater than end time because of the delay feature which is turned on after alert
    // is already created and is running for some time.

    async fn test_derived_stream_invalid_timerange_delay_scenario() {
        // Create a pipeline with derived stream that has delay configured
        let pipeline_data = Pipeline {
            id: "test_invalid_timerange_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "e2e".to_string(),
            name: "test_invalid_timerange_pipeline".to_string(),
            description: "Test pipeline for invalid timerange delay scenario".to_string(),
            source: PipelineSource::Scheduled(DerivedStream {
                org_id: "e2e".to_string(),
                stream_type: StreamType::Logs,
                query_condition: QueryCondition {
                    query_type: config::meta::alerts::QueryType::SQL,
                    sql: Some("SELECT _timestamp, city FROM \"olympics_schema\"".to_string()),
                    ..Default::default()
                },
                trigger_condition: TriggerCondition {
                    period: 5,      // 5 minutes
                    frequency: 300, // 5 minutes in seconds
                    ..Default::default()
                },
                tz_offset: 0,
                start_at: None,
                delay: Some(10), // 10 minutes delay
            }),
            kind: Default::default(),
            nodes: vec![
                // Source node (query node for scheduled pipeline)
                config::meta::pipeline::components::Node::new(
                    "source-node-1".to_string(),
                    config::meta::pipeline::components::NodeData::Query(DerivedStream {
                        org_id: "e2e".to_string(),
                        stream_type: StreamType::Logs,
                        query_condition: QueryCondition {
                            query_type: config::meta::alerts::QueryType::SQL,
                            sql: Some(
                                "SELECT _timestamp, city FROM \"olympics_schema\"".to_string(),
                            ),
                            ..Default::default()
                        },
                        trigger_condition: TriggerCondition {
                            period: 5,
                            frequency: 300,
                            ..Default::default()
                        },
                        tz_offset: 0,
                        start_at: None,
                        delay: Some(10), // 10 minutes delay
                    }),
                    100.0,
                    50.0,
                    "input".to_string(),
                ),
                // Destination node (output stream)
                config::meta::pipeline::components::Node::new(
                    "dest-node-1".to_string(),
                    config::meta::pipeline::components::NodeData::Stream(
                        config::meta::stream::StreamParams {
                            org_id: "e2e".to_string().into(),
                            stream_name: "derived_stream".to_string().into(),
                            stream_type: StreamType::Logs,
                        },
                    ),
                    100.0,
                    200.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![config::meta::pipeline::components::Edge::new(
                "source-node-1".to_string(),
                "dest-node-1".to_string(),
            )],
        };

        // Create the pipeline
        e2e_post_pipeline(pipeline_data.clone()).await;
        let pipeline = get_pipeline_from_api(pipeline_data.name.as_str()).await;

        // Create a trigger that will cause invalid timerange scenario
        // Simulate a scenario where the trigger was created before delay was enabled
        // and now the start time is greater than end time due to delay
        let current_time = Utc::now().timestamp_micros();
        // 5 minutes is period of the pipeline and 1 min is delay in processing the pipeline
        let period_micros = Duration::try_minutes(6)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let timeout = Duration::try_minutes(2)
            .unwrap()
            .num_microseconds()
            .unwrap();

        // Create trigger with start time that will be greater than end time after delay
        let trigger_start_time = current_time - period_micros; // 5 minutes ago

        let trigger = Trigger {
            id: 1,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: TriggerModule::DerivedStream,
            module_key: format!("logs/e2e/test_invalid_timerange_pipeline/{}", pipeline.id),
            next_run_at: current_time,
            start_time: Some(current_time),
            end_time: Some(current_time + timeout),
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 0,
            data: serde_json::json!({
                "period_end_time": trigger_start_time // This will cause start > end
            })
            .to_string(),
        };

        // Process the trigger - this should handle invalid timerange gracefully
        let trace_id = "test_invalid_timerange_trace_id";
        let result = handle_triggers(trace_id, trigger).await;

        // Should not return an error, but should handle invalid timerange gracefully
        assert!(result.is_ok());

        // Get the trigger from the database
        let trigger = db::scheduler::get(
            "e2e",
            TriggerModule::DerivedStream,
            &format!("logs/e2e/test_invalid_timerange_pipeline/{}", pipeline.id),
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        // Next run at should be greater than current time
        assert!(trigger.next_run_at > current_time);

        // And last period end time should not change
        assert_eq!(
            trigger.data,
            serde_json::json!({
                "period_end_time": trigger_start_time
            })
            .to_string()
        );

        // Clean up
        let _ = openobserve_core::pipeline::db::delete(&pipeline.id).await;
        // Also delete the trigger job from scheduled jobs table
        let _ = db::scheduler::delete(
            "e2e",
            TriggerModule::DerivedStream,
            &format!("logs/e2e/test_invalid_timerange_pipeline/{}", pipeline.id),
        )
        .await;
    }

    async fn test_derived_stream_invalid_timerange_with_cron_frequency() {
        let auth = setup();
        let app = init_test_router();

        // Create a pipeline with derived stream using cron frequency
        let pipeline_data = Pipeline {
            id: "test_cron_invalid_timerange_pipeline".to_string(),
            version: 1,
            enabled: true,
            org: "e2e".to_string(),
            name: "test_cron_invalid_timerange_pipeline".to_string(),
            description: "Test pipeline for invalid timerange with cron frequency".to_string(),
            source: PipelineSource::Scheduled(DerivedStream {
                org_id: "e2e".to_string(),
                stream_type: StreamType::Logs,
                query_condition: QueryCondition {
                    query_type: config::meta::alerts::QueryType::SQL,
                    sql: Some("SELECT _timestamp, city FROM \"olympics_schema\"".to_string()),
                    ..Default::default()
                },
                trigger_condition: TriggerCondition {
                    period: 5,                         // 5 minutes
                    frequency: 0,                      // 0 for cron frequency
                    cron: "0 */5 * * * *".to_string(), // Every 5 minutes
                    frequency_type: config::meta::alerts::FrequencyType::Cron,
                    ..Default::default()
                },
                tz_offset: 0,
                start_at: None,
                delay: Some(10), // 10 minutes delay
            }),
            kind: Default::default(),
            nodes: vec![
                // Source node (query node for scheduled pipeline)
                config::meta::pipeline::components::Node::new(
                    "source-node-1".to_string(),
                    config::meta::pipeline::components::NodeData::Query(DerivedStream {
                        org_id: "e2e".to_string(),
                        stream_type: StreamType::Logs,
                        query_condition: QueryCondition {
                            query_type: config::meta::alerts::QueryType::SQL,
                            sql: Some(
                                "SELECT _timestamp, city FROM \"olympics_schema\"".to_string(),
                            ),
                            ..Default::default()
                        },
                        trigger_condition: TriggerCondition {
                            period: 5,
                            frequency: 0,
                            cron: "0 */5 * * * *".to_string(),
                            frequency_type: config::meta::alerts::FrequencyType::Cron,
                            ..Default::default()
                        },
                        tz_offset: 0,
                        start_at: None,
                        delay: Some(10), // 10 minutes delay
                    }),
                    100.0,
                    50.0,
                    "input".to_string(),
                ),
                // Destination node (output stream)
                config::meta::pipeline::components::Node::new(
                    "dest-node-1".to_string(),
                    config::meta::pipeline::components::NodeData::Stream(
                        config::meta::stream::StreamParams {
                            org_id: "e2e".to_string().into(),
                            stream_name: "derived_stream".to_string().into(),
                            stream_type: StreamType::Logs,
                        },
                    ),
                    100.0,
                    200.0,
                    "output".to_string(),
                ),
            ],
            edges: vec![config::meta::pipeline::components::Edge::new(
                "source-node-1".to_string(),
                "dest-node-1".to_string(),
            )],
        };

        // Create the pipeline
        let headers = auth_headers(auth);
        let (status, _body) = make_request(
            &app,
            Method::POST,
            "/api/e2e/pipelines",
            Some(headers),
            Some(serde_json::to_string(&pipeline_data).unwrap()),
        )
        .await;
        println!("test derived stream invalid timerange with cron frequency status: {status:?}");
        assert!(status.is_success());

        let pipeline = get_pipeline_from_api(pipeline_data.name.as_str()).await;

        // Create trigger that will cause invalid timerange with cron frequency
        let current_time = Utc::now().timestamp_micros();
        let dur_20_mins = Duration::try_minutes(20)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let period_micros = Duration::try_minutes(5)
            .unwrap()
            .num_microseconds()
            .unwrap();

        // Say, this trigger was last run at 15 mins ago
        let last_end_time = current_time - dur_20_mins;
        // Current end time needs to be aligned (as this is cron frequency)
        let current_next_run_time =
            TriggerCondition::align_time(last_end_time + period_micros, 0, Some(300), None); // This will cause start > end
        let timeout = Duration::try_minutes(2)
            .unwrap()
            .num_microseconds()
            .unwrap();

        let trigger = Trigger {
            id: 3,
            claim_epoch: 0,
            org: "e2e".to_string(),
            module: TriggerModule::DerivedStream,
            module_key: format!(
                "logs/e2e/test_cron_invalid_timerange_pipeline/{}",
                pipeline.id
            ),
            next_run_at: current_next_run_time,
            start_time: Some(current_time),
            end_time: Some(current_time + timeout), // end < start
            is_realtime: false,
            is_silenced: false,
            status: config::meta::triggers::TriggerStatus::Processing,
            retries: 0,
            data: serde_json::json!({
                "period_end_time": last_end_time // This will cause start > end
            })
            .to_string(),
        };

        // Process the trigger
        let trace_id = "test_cron_invalid_timerange_trace_id";
        let result = handle_triggers(trace_id, trigger).await;

        // Should handle invalid timerange with cron frequency gracefully
        assert!(result.is_ok());

        // Get the trigger from the database
        let trigger = db::scheduler::get(
            "e2e",
            TriggerModule::DerivedStream,
            &format!(
                "logs/e2e/test_cron_invalid_timerange_pipeline/{}",
                pipeline.id
            ),
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        // Next run at should be greater than current time
        assert!(trigger.next_run_at > current_next_run_time);
        // Next run at should be less than current time, because the frequency is 5 mins
        assert!(trigger.next_run_at < current_time);
        assert_eq!(
            trigger.data,
            serde_json::json!({
                "period_end_time": last_end_time
            })
            .to_string()
        );

        // Clean up
        let _ = openobserve_core::pipeline::db::delete(&pipeline.id).await;
        // Also delete the trigger job from scheduled jobs table
        let _ = db::scheduler::delete(
            "e2e",
            TriggerModule::DerivedStream,
            &format!(
                "logs/e2e/test_cron_invalid_timerange_pipeline/{}",
                pipeline.id
            ),
        )
        .await;
    }

    async fn e2e_cleanup_test_pipeline() {
        // list the pipelines and choose the first one using API
        let auth = setup();
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) =
            make_request(&app, Method::GET, "/api/e2e/pipelines", Some(headers), None).await;
        assert!(status.is_success());
        let pipeline_list: PipelineList = json::from_slice(&body).unwrap();
        let pipeline = pipeline_list.list.first();
        assert!(pipeline.is_some());
        let pipeline = pipeline.unwrap();

        // Clean up test pipelines
        let _ = openobserve_core::pipeline::db::delete(&pipeline.id).await;
    }

    async fn get_pipeline_from_api(pipeline_name: &str) -> ApiPipeline {
        let auth = setup();
        // Check if pipeline was saved successfully by doing a list using API
        let app = init_test_router();
        let headers = auth_headers(auth);
        let (status, body) =
            make_request(&app, Method::GET, "/api/e2e/pipelines", Some(headers), None).await;
        assert!(status.is_success(), "Failed to list pipelines");
        let pipeline_response: PipelineList = json::from_slice(&body).unwrap();
        // Get the pipeline that matches the pipeline name
        let pipeline = pipeline_response
            .list
            .iter()
            .find(|p| p.name == pipeline_name);
        assert!(pipeline.is_some(), "Pipeline not found");
        let pipeline = pipeline.unwrap();
        pipeline.clone()
    }

    // ==================== ENRICHMENT TABLE TESTS ====================

    async fn e2e_save_enrichment_data_new_table() {
        let _auth = setup();
        let org_id = "e2e";
        let table_name = "test_enrichment_table";

        // Create test data
        let mut payload = Vec::new();
        let mut record1 = json::Map::new();
        record1.insert("name".to_string(), json::Value::String("John".to_string()));
        record1.insert("age".to_string(), json::Value::String("25".to_string()));
        record1.insert(
            "city".to_string(),
            json::Value::String("New York".to_string()),
        );
        payload.push(record1);

        let mut record2 = json::Map::new();
        record2.insert("name".to_string(), json::Value::String("Jane".to_string()));
        record2.insert("age".to_string(), json::Value::String("30".to_string()));
        record2.insert(
            "city".to_string(),
            json::Value::String("Los Angeles".to_string()),
        );
        payload.push(record2);

        // Call save_enrichment_data
        let result = enrichment_data::enrichment_table::save_enrichment_data(
            org_id, table_name, payload, false, // append_data = false
        )
        .await;

        assert!(result.is_ok());
        let response = result.unwrap();
        assert!(response.status().is_success());

        // Verify schema was created in database
        let schema_exists = schema::stream_schema_exists(
            org_id,
            table_name,
            config::meta::stream::StreamType::EnrichmentTables,
            &mut std::collections::HashMap::new(),
        )
        .await;

        println!("schema_exists: {schema_exists:?}");

        assert!(schema_exists.has_fields);

        // Verify schema cache was updated
        let schema_key = format!(
            "{}/{}/{}",
            org_id,
            config::meta::stream::StreamType::EnrichmentTables,
            table_name
        );
        let stream_schemas = STREAM_SCHEMAS.read().await;
        assert!(stream_schemas.contains_key(&schema_key));
        drop(stream_schemas);

        // Verify latest schema cache was updated
        let stream_schemas_latest = STREAM_SCHEMAS_LATEST.read().await;
        assert!(stream_schemas_latest.contains_key(&schema_key));
        drop(stream_schemas_latest);

        // Verify stream settings cache was updated
        assert!(infra::schema::get_stream_settings_atomic(&schema_key).is_some());

        // Get the meta table stats for enrichment table
        let meta_table_stats = db::enrichment_table::get_meta_table_stats(org_id, table_name).await;
        assert!(meta_table_stats.is_some());
        let meta_table_stats = meta_table_stats.unwrap();
        assert_ne!(meta_table_stats.size, 0);
        assert_ne!(meta_table_stats.start_time, 0);

        // Check get_enrichment_table function, it should return same data
        let data =
            enrichment_data::enrichment::get_enrichment_table(org_id, table_name, false).await;
        assert!(data.is_ok());
        let data = data.unwrap();
        assert!(data.len() == 2);
        println!("save enrichment data new tabledata: {data:?}");
        println!(
            "save enrichment data new table data[0]: {:?}",
            data[0].get("name").unwrap().to_string()
        );
        assert!(data[0].get("name").unwrap().to_string().eq("\"John\""));
        assert!(data[1].get("name").unwrap().to_string().eq("\"Jane\""));
        assert!(data[0].get("age").unwrap().to_string().eq("\"25\""));
        assert!(data[1].get("age").unwrap().to_string().eq("\"30\""));
        assert!(data[0].get("city").unwrap().to_string().eq("\"New York\""));
        assert!(
            data[1]
                .get("city")
                .unwrap()
                .to_string()
                .eq("\"Los Angeles\"")
        );

        // wait for 1 second
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        // Check the ENRICHMENT_TABLES cache to check if the table is created
        let enrichment_tables = ENRICHMENT_TABLES.clone();
        println!("save enrichment data new table enrichment_tables: {enrichment_tables:?}");
        assert!(enrichment_tables.contains_key(&schema_key));
        assert!(enrichment_tables.get(&schema_key).unwrap().data.len() == 2);

        drop(enrichment_tables);

        println!("save enrichment data new table meta_table_stats: {meta_table_stats:?}");
        // Also, it should store the cache in the disk
        check_enrichment_table_local_disk_cache(org_id, table_name, meta_table_stats.end_time)
            .await;
        // Clean up
        e2e_cleanup_enrichment_table(org_id, table_name).await;
    }

    async fn e2e_cleanup_enrichment_table(org_id: &str, stream_name: &str) {
        // Clean up the enrichment table and its schema
        enrichment_data::enrichment_table::delete_enrichment_table(
            org_id,
            stream_name,
            config::meta::stream::StreamType::EnrichmentTables,
            (0, chrono::Utc::now().timestamp_micros()),
        )
        .await;

        // Verify schema caches are cleaned up
        let schema_key = format!(
            "{}/{}/{}",
            org_id,
            config::meta::stream::StreamType::EnrichmentTables,
            stream_name
        );

        // Check that schema caches are cleared
        let stream_schemas = STREAM_SCHEMAS.read().await;
        assert!(!stream_schemas.contains_key(&schema_key));
        drop(stream_schemas);

        let stream_schemas_latest = STREAM_SCHEMAS_LATEST.read().await;
        assert!(!stream_schemas_latest.contains_key(&schema_key));
        drop(stream_schemas_latest);

        assert!(infra::schema::get_stream_settings_atomic(&schema_key).is_none());

        // wait for 2 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Check the ENRICHMENT_TABLES cache to check if the table is deleted
        let enrichment_tables = ENRICHMENT_TABLES.clone();
        println!("enrichment data cleanup enrichment_tables: {enrichment_tables:?}");
        assert!(!enrichment_tables.contains_key(&schema_key));
        drop(enrichment_tables);

        // Check the local disk cache to check if the table is deleted
        check_enrichment_table_local_disk_cache_deleted(org_id, stream_name).await;
    }

    async fn e2e_save_enrichment_data_append_mode() {
        let _auth = setup();
        let org_id = "e2e";
        let table_name = "test_enrichment_table_append";

        // First, create initial data
        let mut initial_payload = Vec::new();
        let mut record1 = json::Map::new();
        record1.insert("name".to_string(), json::Value::String("John".to_string()));
        record1.insert("age".to_string(), json::Value::String("25".to_string()));
        record1.insert(
            "city".to_string(),
            json::Value::String("New York".to_string()),
        );
        initial_payload.push(record1);

        let result1 = enrichment_data::enrichment_table::save_enrichment_data(
            org_id,
            table_name,
            initial_payload,
            false, // append_data = false
        )
        .await;
        assert!(result1.is_ok());

        // Get the meta table stats for enrichment table
        let meta_table_stats_first =
            db::enrichment_table::get_meta_table_stats(org_id, table_name).await;
        assert!(meta_table_stats_first.is_some());
        let meta_table_stats_first = meta_table_stats_first.unwrap();
        assert_ne!(meta_table_stats_first.size, 0);
        assert_ne!(meta_table_stats_first.start_time, 0);
        let schema_key = format!(
            "{}/{}/{}",
            org_id,
            config::meta::stream::StreamType::EnrichmentTables,
            table_name
        );

        // Wait for 2 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Check the ENRICHMENT_TABLES cache to check if the table is created
        let enrichment_tables = ENRICHMENT_TABLES.clone();
        assert!(enrichment_tables.contains_key(&schema_key));
        assert!(enrichment_tables.get(&schema_key).unwrap().data.len() == 1);
        drop(enrichment_tables);

        println!(
            "save enrichment data append mode check_enrichment_table_local_disk_cache meta_table_stats_first.start_time 1: {:?}",
            meta_table_stats_first.start_time
        );
        // Check the local disk cache to check if the table is created
        check_enrichment_table_local_disk_cache(
            org_id,
            table_name,
            meta_table_stats_first.end_time,
        )
        .await;

        // Now append more data
        let mut append_payload = Vec::new();
        let mut record2 = json::Map::new();
        record2.insert("name".to_string(), json::Value::String("Jane".to_string()));
        record2.insert("age".to_string(), json::Value::String("30".to_string()));
        record2.insert(
            "city".to_string(),
            json::Value::String("Los Angeles".to_string()),
        );
        append_payload.push(record2);

        let result2 = enrichment_data::enrichment_table::save_enrichment_data(
            org_id,
            table_name,
            append_payload,
            true, // append_data = true
        )
        .await;
        assert!(result2.is_ok());

        // Verify schema still exists and is valid
        let schema_exists = schema::stream_schema_exists(
            org_id,
            table_name,
            config::meta::stream::StreamType::EnrichmentTables,
            &mut std::collections::HashMap::new(),
        )
        .await;

        assert!(schema_exists.has_fields);

        // Get the meta table stats for enrichment table
        let meta_table_stats_second =
            db::enrichment_table::get_meta_table_stats(org_id, table_name).await;
        assert!(meta_table_stats_second.is_some());
        let meta_table_stats_second = meta_table_stats_second.unwrap();
        assert_ne!(meta_table_stats_second.size, 0);
        assert_ne!(meta_table_stats_second.start_time, 0);
        assert_eq!(
            meta_table_stats_second.start_time,
            meta_table_stats_first.start_time
        );
        assert!(meta_table_stats_second.end_time > meta_table_stats_first.end_time);

        // Wait for 2 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Check the ENRICHMENT_TABLES cache to check if the table is created
        let enrichment_tables = ENRICHMENT_TABLES.clone();
        assert!(enrichment_tables.contains_key(&schema_key));
        assert!(enrichment_tables.get(&schema_key).unwrap().data.len() == 2);
        drop(enrichment_tables);
        println!(
            "save enrichment data append mode check_enrichment_table_local_disk_cache meta_table_stats_second.start_time 2: {:?}",
            meta_table_stats_second.start_time
        );

        // Check the local disk cache to check if the table is created
        check_enrichment_table_local_disk_cache(
            org_id,
            table_name,
            meta_table_stats_second.end_time,
        )
        .await;

        // Clean up
        e2e_cleanup_enrichment_table(org_id, table_name).await;
    }

    async fn e2e_save_enrichment_data_schema_evolution() {
        let _auth = setup();
        let org_id = "e2e";
        let table_name = "test_enrichment_table_evolution";

        // First, create initial data with basic fields
        let mut initial_payload = Vec::new();
        let mut record1 = json::Map::new();
        record1.insert("name".to_string(), json::Value::String("John".to_string()));
        record1.insert("age".to_string(), json::Value::String("25".to_string()));
        initial_payload.push(record1);

        let result1 = enrichment_data::enrichment_table::save_enrichment_data(
            org_id,
            table_name,
            initial_payload,
            false, // append_data = false
        )
        .await;
        assert!(result1.is_ok());

        let schema_key = format!(
            "{}/{}/{}",
            org_id,
            config::meta::stream::StreamType::EnrichmentTables,
            table_name
        );

        // wait for 2 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Check the ENRICHMENT_TABLES cache to check if the table is created
        let enrichment_tables = ENRICHMENT_TABLES.clone();
        assert!(enrichment_tables.contains_key(&schema_key));
        assert!(enrichment_tables.get(&schema_key).unwrap().data.len() == 1);
        drop(enrichment_tables);

        // Now append data with additional fields (schema evolution)
        let mut append_payload = Vec::new();
        let mut record2 = json::Map::new();
        record2.insert("name".to_string(), json::Value::String("Jane".to_string()));
        record2.insert("age".to_string(), json::Value::String("30".to_string()));
        record2.insert(
            "city".to_string(),
            json::Value::String("Los Angeles".to_string()),
        ); // New field
        record2.insert(
            "country".to_string(),
            json::Value::String("USA".to_string()),
        ); // New field
        append_payload.push(record2);

        let result2 = enrichment_data::enrichment_table::save_enrichment_data(
            org_id,
            table_name,
            append_payload,
            true, // append_data = true
        )
        .await;
        assert!(result2.is_ok());
        let result = result2.unwrap();
        assert!(!result.status().is_success());
        // wait for 2 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Clean up
        e2e_cleanup_enrichment_table(org_id, table_name).await;
    }

    // Test runner function that calls all enrichment table tests
    async fn test_enrichment_table_integration() {
        e2e_save_enrichment_data_new_table().await;
        e2e_save_enrichment_data_append_mode().await;
        e2e_save_enrichment_data_schema_evolution().await;
    }

    async fn check_enrichment_table_local_disk_cache(
        org_id: &str,
        table_name: &str,
        updated_at: i64,
    ) {
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        let file_path = get_table_path(table_dir.to_str().unwrap(), updated_at);
        assert!(file_path.exists());
    }

    async fn check_enrichment_table_local_disk_cache_deleted(org_id: &str, table_name: &str) {
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        assert!(!table_dir.exists());
    }

    // Helper function to setup schema for enrichment tables in tests
    async fn setup_enrichment_table_schema(org_id: &str, table_name: &str) {
        use arrow::datatypes::{DataType, Field, Schema};
        use config::meta::stream::StreamType;

        // Create a simple schema that matches our test data
        let schema = Schema::new(vec![
            Field::new("id", DataType::Int64, true),
            Field::new("name", DataType::Utf8, true),
            Field::new("age", DataType::Int64, true),
            Field::new("data", DataType::Utf8, true),
            Field::new("version", DataType::Utf8, true),
            Field::new("nested", DataType::Utf8, true),
            Field::new("special_chars", DataType::Utf8, true),
        ]);

        // Use infra::schema::merge to create/update the schema in the database
        let result = infra::schema::merge(
            org_id,
            table_name,
            StreamType::EnrichmentTables,
            &schema,
            None,
        )
        .await;

        // Ignore error if schema already exists
        match result {
            Ok(_) => {}
            Err(e) => {
                log::debug!("Schema setup for {}/{}: {:?}", org_id, table_name, e);
            }
        }
    }

    async fn test_enrichment_table_local_all_sequential() {
        // Run all tests sequentially to avoid directory conflicts
        test_store_and_retrieve().await;
        test_store_multiple_versions().await;
        test_retrieve_nonexistent_table().await;
        test_delete().await;
        test_delete_nonexistent_table().await;
        test_get_last_updated_at().await;
        test_store_data_if_needed().await;
        test_store_data_if_needed_background().await;
        test_metadata_persistence().await;
        test_large_data_handling().await;
        test_error_handling().await;
    }

    async fn test_store_and_retrieve() {
        let org_id = "test_org";
        let table_name = "test_table";
        let test_data = vec![
            json!({"id": 1, "name": "Alice", "age": 25}),
            json!({"id": 2, "name": "Bob", "age": 30}),
        ];
        let updated_at = 1640995200;

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Test store function
        let test_data = Values::Json(Arc::new(test_data));
        let result = local::store(org_id, table_name, test_data, updated_at).await;
        println!("Store result: {result:?}");
        assert!(result.is_ok(), "Store should succeed");

        // Verify file was created
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        let file_path = get_table_path(table_dir.to_str().unwrap(), updated_at);
        assert!(file_path.exists(), "Data file should exist");

        // Verify metadata was created
        let metadata_path = get_metadata_path();
        assert!(metadata_path.exists(), "Metadata file should exist");

        // Test retrieve function
        let retrieved_data = local::retrieve(org_id, table_name).await;
        assert!(retrieved_data.is_ok(), "Retrieve should succeed");

        let retrieved_data = retrieved_data.unwrap().to_json().unwrap();
        assert_eq!(retrieved_data.len(), 2, "Should retrieve 2 records");
        assert_eq!(
            retrieved_data[0]["id"],
            json!(1),
            "First record should match"
        );
        assert_eq!(
            retrieved_data[1]["id"],
            json!(2),
            "Second record should match"
        );
    }

    async fn test_store_multiple_versions() {
        let org_id = "test_org";
        let table_name = "versioned_table";

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Store first version
        let data_v1 = Values::Json(Arc::new(vec![json!({"id": 1, "version": "v1"})]));
        let updated_at_v1 = 1640995200;
        let result = local::store(org_id, table_name, data_v1, updated_at_v1).await;
        assert!(result.is_ok(), "First store should succeed");

        // Store second version
        let data_v2 = Values::Json(Arc::new(vec![json!({"id": 2, "version": "v2"})]));
        let updated_at_v2 = 1640995300;
        let result = local::store(org_id, table_name, data_v2, updated_at_v2).await;
        assert!(result.is_ok(), "Second store should succeed");

        // Retrieve should get both versions
        let retrieved_data = local::retrieve(org_id, table_name).await.unwrap();
        assert_eq!(retrieved_data.len(), 2, "Should retrieve both versions");
    }

    async fn test_retrieve_nonexistent_table() {
        let result = local::retrieve("nonexistent_org", "nonexistent_table").await;
        assert!(
            result.is_err(),
            "Should return an error for nonexistent table"
        );
    }

    async fn test_delete() {
        let org_id = "test_org";
        let table_name = "delete_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "test"})]));
        let updated_at = 1640995200;

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // First store some data
        let result = local::store(org_id, table_name, test_data, updated_at).await;
        assert!(result.is_ok(), "Store should succeed");

        // Verify data exists
        let key = get_key(org_id, table_name);
        let table_dir = get_table_dir(&key);
        assert!(table_dir.exists(), "Table directory should exist");

        // Test delete function
        let result = local::delete(org_id, table_name).await;
        assert!(result.is_ok(), "Delete should succeed");

        // Verify directory was removed
        assert!(!table_dir.exists(), "Table directory should be removed");

        // Verify metadata was updated
        let metadata_content = get_metadata_content().await.unwrap();
        assert!(
            !metadata_content.contains_key(&key),
            "Key should be removed from metadata"
        );
    }

    async fn test_delete_nonexistent_table() {
        // Delete non-existent table should succeed gracefully
        let result = local::delete("nonexistent_org", "nonexistent_table").await;
        assert!(
            result.is_ok(),
            "Delete should handle nonexistent table gracefully"
        );
    }

    async fn test_get_last_updated_at() {
        let org_id = "test_org";
        let table_name = "timestamp_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "test"})]));
        let updated_at = 1640995200;

        // Test getting timestamp before storing data
        let result = local::get_last_updated_at(org_id, table_name).await;
        assert!(result.is_ok(), "Get last updated should succeed");
        assert_eq!(result.unwrap(), 0, "Should return 0 for non-existent table");

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Store data
        local::store(org_id, table_name, test_data, updated_at)
            .await
            .unwrap();

        // Test getting timestamp after storing data
        let result = local::get_last_updated_at(org_id, table_name).await;
        assert!(result.is_ok(), "Get last updated should succeed");
        assert_eq!(
            result.unwrap(),
            updated_at,
            "Should return correct timestamp"
        );
    }

    async fn test_store_data_if_needed() {
        let org_id = "test_org";
        let table_name = "conditional_test_table";
        let test_data_v1 = Values::Json(Arc::new(vec![json!({"id": 1, "version": "v1"})]));
        let test_data_v2 = Values::Json(Arc::new(vec![json!({"id": 1, "version": "v2"})]));
        let updated_at_v1 = 1640995200;
        let updated_at_v2 = 1640995300;

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Store initial data
        let result =
            local::store_data_if_needed(org_id, table_name, test_data_v1, updated_at_v1).await;
        assert!(result.is_ok(), "Initial store should succeed");

        // Verify data was stored
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data[0]["version"],
            json!("v1"),
            "Should have v1 data"
        );

        // Try to store older data (should be ignored)
        let old_updated_at = 1640995100;
        let result =
            local::store_data_if_needed(org_id, table_name, test_data_v2.clone(), old_updated_at)
                .await;
        assert!(
            result.is_ok(),
            "Store with old timestamp should succeed but not update"
        );

        // Verify data wasn't changed
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data[0]["version"],
            json!("v1"),
            "Should still have v1 data"
        );

        // Store newer data (should update)
        let result =
            local::store_data_if_needed(org_id, table_name, test_data_v2, updated_at_v2).await;
        assert!(result.is_ok(), "Store with newer timestamp should succeed");

        // Verify data was updated
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data[0]["version"],
            json!("v2"),
            "Should now have v2 data"
        );
    }

    async fn test_store_data_if_needed_background() {
        let org_id = "test_org";
        let table_name = "background_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "background"})]));
        let updated_at = 1640995200;

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Test background store
        let result =
            local::store_data_if_needed_background(org_id, table_name, test_data, updated_at).await;
        assert!(result.is_ok(), "Background store should succeed");

        // Wait a bit for background task to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Verify data was eventually stored
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(retrieved_data.len(), 1, "Should have stored 1 record");
        assert_eq!(
            retrieved_data[0]["data"],
            json!("background"),
            "Should have correct data"
        );
    }

    async fn test_metadata_persistence() {
        let org_id = "test_org";
        let table_name = "metadata_test_table";
        let test_data = Values::Json(Arc::new(vec![json!({"id": 1, "data": "test"})]));
        let updated_at = 1640995200;

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Store data
        local::store(org_id, table_name, test_data, updated_at)
            .await
            .unwrap();

        // Manually read metadata file
        let metadata_path = get_metadata_path();
        let metadata_content = tokio::fs::read_to_string(&metadata_path).await.unwrap();
        let metadata: std::collections::HashMap<String, i64> =
            serde_json::from_str(&metadata_content).unwrap();

        let key = get_key(org_id, table_name);
        assert!(
            metadata.contains_key(&key),
            "Metadata should contain the key"
        );
        assert_eq!(
            metadata[&key], updated_at,
            "Metadata should have correct timestamp"
        );
    }

    async fn test_large_data_handling() {
        let org_id = "test_org";
        let table_name = "large_data_table";

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Create large dataset (1000 records)
        let large_data: Vec<_> = (0..1000)
            .map(|i| {
                json!({
                    "id": i,
                    "name": format!("name_{}", i),
                    "data": "x".repeat(100), // 100 characters per record
                    "nested": {
                        "field1": i * 2,
                        "field2": format!("nested_value_{}", i)
                    }
                })
            })
            .collect();

        let updated_at = 1640995200;

        // Test storing large data
        let large_data = Values::Json(Arc::new(large_data));
        let result = local::store(org_id, table_name, large_data, updated_at).await;
        assert!(result.is_ok(), "Should handle large data successfully");

        // Test retrieving large data
        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(
            retrieved_data.len(),
            1000,
            "Should retrieve all 1000 records"
        );
        assert_eq!(
            retrieved_data[0]["id"],
            json!(0),
            "First record should be correct"
        );
        assert_eq!(
            retrieved_data[999]["id"],
            json!(999),
            "Last record should be correct"
        );
    }

    async fn test_error_handling() {
        // Test with invalid JSON data
        let org_id = "test_org";
        let table_name = "error_test_table";

        // Setup schema before storing data
        setup_enrichment_table_schema(org_id, table_name).await;

        // Create data that will serialize fine but test edge cases
        let test_data = Values::Json(Arc::new(vec![
            json!({"id": 1, "data": null}),
            json!({"id": 2, "special_chars": "!@#$%^&*()"}),
        ]));
        let updated_at = 1640995200;

        let result = local::store(org_id, table_name, test_data, updated_at).await;
        assert!(
            result.is_ok(),
            "Should handle special characters and null values"
        );

        let retrieved_data = local::retrieve(org_id, table_name)
            .await
            .unwrap()
            .to_json()
            .unwrap();
        assert_eq!(retrieved_data.len(), 2, "Should retrieve both records");
        assert!(
            retrieved_data[0]["data"].is_null(),
            "Should preserve null values"
        );
    }

    // ========================================================================
    // Backfill Jobs Integration Tests
    // ========================================================================

    async fn test_backfill_job_list_and_delete() {
        use openobserve_core::alerts::backfill::{delete_backfill_job, list_backfill_jobs};

        // Test listing backfill jobs
        let org_id = "e2e";
        let jobs_result = list_backfill_jobs(org_id).await;
        assert!(
            jobs_result.is_ok(),
            "Should successfully list backfill jobs"
        );

        let jobs = jobs_result.unwrap();
        // If there are any jobs, test delete functionality
        if let Some(first_job) = jobs.first() {
            let job_id = first_job.job_id.clone();
            let delete_result = delete_backfill_job(org_id, &job_id).await;
            // Delete may fail if job is in progress, which is acceptable
            match delete_result {
                Ok(_) => log::info!("Successfully deleted backfill job: {}", job_id),
                Err(e) => log::warn!("Could not delete backfill job (may be in progress): {}", e),
            }
        }
    }

    async fn test_backfill_job_get_nonexistent() {
        use openobserve_core::alerts::backfill::get_backfill_job;

        // Test getting a non-existent job
        let org_id = "e2e";
        let fake_job_id = "nonexistent_job_12345";
        let result = get_backfill_job(org_id, fake_job_id).await;
        assert!(result.is_err(), "Should fail to get non-existent job");
    }

    async fn test_backfill_job_delete_by_pipeline() {
        use openobserve_core::alerts::backfill::delete_backfill_jobs_by_pipeline;

        // Test deleting jobs by pipeline
        let org_id = "e2e";
        let pipeline_id = "test_nonexistent_pipeline";

        // Should succeed even if no jobs exist for this pipeline
        let result = delete_backfill_jobs_by_pipeline(org_id, pipeline_id).await;
        assert!(
            result.is_ok(),
            "Should successfully delete jobs by pipeline (even if none exist)"
        );
    }

    async fn test_backfill_job_enable_disable() {
        use openobserve_core::alerts::backfill::{enable_backfill_job, list_backfill_jobs};

        // Test enable/disable on existing jobs
        let org_id = "e2e";
        let jobs_result = list_backfill_jobs(org_id).await;

        if let Ok(jobs) = jobs_result
            && let Some(first_job) = jobs.first()
        {
            let job_id = first_job.job_id.clone();

            // Try to disable
            let disable_result = enable_backfill_job(org_id, &job_id, false).await;
            match disable_result {
                Ok(_) => {
                    log::info!("Successfully disabled backfill job: {}", job_id);

                    // Try to enable back
                    let enable_result = enable_backfill_job(org_id, &job_id, true).await;
                    if enable_result.is_ok() {
                        log::info!("Successfully re-enabled backfill job: {}", job_id);
                    }
                }
                Err(e) => log::warn!("Could not modify job state: {}", e),
            }
        }
    }

    /// Two workers race one slow step; a compactor restarts past one lease and a third polls.
    async fn e2e_two_workers_never_run_one_step_twice() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use config::meta::stream::StreamType;
        use openobserve_core::org_cleanup::{StreamDataCleanup, run_once};

        struct SlowStep {
            org: String,
            runs: AtomicUsize,
        }

        #[async_trait::async_trait]
        impl StreamDataCleanup for SlowStep {
            async fn delete_stream_data(
                &self,
                org_id: &str,
                stream_type: StreamType,
                stream_name: &str,
            ) -> Result<(), anyhow::Error> {
                if org_id != self.org {
                    return openobserve_jobs::job::CompactionStreamDataCleanup
                        .delete_stream_data(org_id, stream_type, stream_name)
                        .await;
                }
                self.runs.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                Ok(())
            }

            async fn drain_deleted_files(
                &self,
                org_id: &str,
            ) -> Result<openobserve_core::org_cleanup::DrainPass, anyhow::Error> {
                openobserve_jobs::job::CompactionStreamDataCleanup
                    .drain_deleted_files(org_id)
                    .await
            }
        }

        let org = format!("t19lease{}", run_suffix());
        let step = "delete_stream:logs/slow";
        add_tasks(&org, &[(step, 150)]).await;
        let slow = Arc::new(SlowStep {
            org: org.clone(),
            runs: AtomicUsize::new(0),
        });
        let cleanup: Arc<dyn StreamDataCleanup> = slow.clone();
        // With the worker paused the lease is 2 s, so the 5 s step outlives two lease periods.
        assert_eq!(infra::table::org_cleanup_tasks::lease_micros(), 2_000_000);

        let first = tokio::spawn(run_once(Arc::clone(&cleanup)));
        let second = tokio::spawn(run_once(Arc::clone(&cleanup)));
        eventually("the slow step to start", || async {
            slow.runs.load(Ordering::SeqCst) > 0
        })
        .await;
        tokio::time::sleep(tokio::time::Duration::from_millis(2500)).await;
        infra::table::org_cleanup_tasks::requeue_running()
            .await
            .unwrap();
        let third = tokio::spawn(run_once(Arc::clone(&cleanup)));
        for worker in [first, second, third] {
            worker.await.unwrap();
        }
        let task = cleanup_task(&org, step).await;
        run_once(Arc::clone(&cleanup)).await;
        let runs = slow.runs.load(Ordering::SeqCst);
        infra::table::org_cleanup_tasks::delete_by_org(&org)
            .await
            .unwrap();

        assert_eq!(runs, 1, "the step ran {runs} times");
        assert_eq!(
            (task.status.as_str(), task.attempts),
            ("done", 1),
            "{task:?}"
        );
    }
}
