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

#[cfg(test)]
mod tests {
    use core::time;
    use std::{env, fs, net::SocketAddr, str, sync::Once, thread};

    use actix_web::{App, http::header::ContentType, test, web};
    use arrow_flight::flight_service_server::FlightServiceServer;
    use bytes::{Bytes, BytesMut};
    use chrono::{Duration, Utc};
    use config::{
        get_config,
        meta::{
            alerts::{Operator, QueryCondition, TriggerCondition, alert::Alert},
            dashboards::{Dashboard, v1},
            pipeline::{
                Pipeline,
                components::{DerivedStream, PipelineSource},
            },
            stream::StreamType,
            triggers::{ScheduledTriggerData, Trigger, TriggerModule, TriggerStatus},
        },
        utils::json,
    };
    use openobserve::{
        common::meta::ingestion::IngestionResponse,
        handler::{
            grpc::{auth::check_auth, flight::FlightServiceImpl},
            http::{
                models::{
                    alerts::responses::{GetAlertResponseBody, ListAlertsResponseBody},
                    destinations::{Destination, DestinationType},
                },
                router::*,
            },
        },
        migration,
        service::{alerts::scheduler::handlers::handle_triggers, search::SEARCH_SERVER},
    };
    use prost::Message;
    use proto::{cluster_rpc::search_server::SearchServer, prometheus_rpc};
    use tonic::codec::CompressionEncoding;

    static START: Once = Once::new();

    fn setup() -> (&'static str, &'static str) {
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

        log::info!("starting gRPC server at {}", gaddr);
        tonic::transport::Server::builder()
            .layer(tonic::service::interceptor(check_auth))
            .add_service(search_svc)
            .add_service(flight_svc)
            .serve(gaddr)
            .await
            .expect("gRPC server init failed");
        Ok(())
    }

    async fn e2e_100_tear_down() {
        log::info!("Tear Down Invoked");
        fs::remove_dir_all("./data").expect("Delete local dir failed");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn e2e_test() {
        // make sure data dir is deleted before we run integration tests
        fs::remove_dir_all("./data")
            .unwrap_or_else(|e| log::info!("Error deleting local dir: {}", e));

        setup();

        // start gRPC server
        tokio::task::spawn(async move {
            init_grpc_server()
                .await
                .expect("router gRPC server init failed");
        });

        // register node
        openobserve::common::infra::cluster::register_and_keep_alive()
            .await
            .unwrap();
        // init config
        config::init().await.unwrap();
        // init infra
        migration::init_db().await.unwrap();
        infra::init().await.unwrap();
        // ensure database tables are created
        infra::db::create_table().await.unwrap();
        // db migration steps, since it's separated out
        infra::table::migrate().await.unwrap();
        openobserve::common::infra::init().await.unwrap();
        // ingester init
        ingester::init().await.unwrap();
        // init job
        openobserve::job::init().await.unwrap();

        for _i in 0..3 {
            e2e_1_post_bulk().await;
        }

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
        e2e_get_org().await;

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
            assert_eq!(list[0], board.clone());

            let board = e2e_update_dashboard(
                v1::Dashboard {
                    title: "e2e test".to_owned(),
                    description: "Logs flow downstream".to_owned(),
                    ..board.v1.unwrap()
                },
                board.hash,
            )
            .await;
            assert_eq!(
                e2e_get_dashboard(&board.clone().v1.unwrap().dashboard_id).await,
                board
            );
            e2e_delete_dashboard(&board.v1.unwrap().dashboard_id).await;
            assert!(e2e_list_dashboards().await.is_empty());
        }

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
        e2e_handle_derived_stream_evaluation_failure().await;
        e2e_cleanup_test_pipeline().await;

        // syslog
        e2e_post_syslog_route().await;
        e2e_list_syslog_routes().await;

        // others
        e2e_health_check().await;
        e2e_config().await;
        e2e_100_tear_down().await;

        // clear
        e2e_delete_stream().await;
    }

    async fn e2e_1_post_bulk() {
        let auth = setup();
        let path = "./tests/input.json";
        let body_str = fs::read_to_string(path).expect("Read file failed");
        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/_bulk", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_json() {
        let auth = setup();

        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;

        // timestamp in past
        let body_str = "[{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\",\"_timestamp\":1665136888163792}]";
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/_json", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
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
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/_json", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
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
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/_json", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
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
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/_json", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
        let res: IngestionResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(res.code, 200);
        assert_eq!(res.status.len(), 1);
        assert_eq!(res.status[0].status.successful, 1);
        assert_eq!(res.status[0].status.failed, 0);
    }

    async fn e2e_post_hec() {
        let auth = setup();
        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;

        // test case : missing index in metadata
        let body_str = "{\"event\":\"hello\"}";
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/_hec", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // test case : valid payload
        let body_str = "{\"event\":\"hello\",\"index\":\"hec_test\"}";
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/_hec", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // test case : json event
        let body_str =
            "{\"event\":{\"log\":\"hello\",\"severity\":\"info\"},\"index\":\"hec_test\"}";
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/_hec", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // test case : ndjson
        let body_str = r#"
                { "index": "hec_test", "event": "test log", "time": 1749113798091 }
                { "index": "hec_test", "event": {"log":"test log","severity":"info"}, "fields": {"cluster":"c1", "namespace":"n1"} }
                { "index": "hec_test", "event": {"log":"test log","severity":"info"}, "source" : "e2e_test", "fields": {"cluster":"c1", "namespace":"n1"}}
            "#;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/_hec", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_multi() {
        let auth = setup();
        let body_str = "{\"Year\": 1896, \"City\": \"Athens\", \"Sport\": \"Aquatics\", \"Discipline\": \"Swimming\", \"Athlete\": \"HERSCHMANN, Otto\", \"Country\": \"AUT\", \"Gender\": \"Men\", \"Event\": \"100M Freestyle\", \"Medal\": \"Silver\", \"Season\": \"summer\",\"_timestamp\":1665136888163792}";
        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/_multi", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_stream() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/streams", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_stream_schema() {
        let auth = setup();
        let one_sec = time::Duration::from_secs(2);
        thread::sleep(one_sec);
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/{}/streams/{}/schema",
                "e2e", "olympics_schema"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_stream_settings() {
        let auth = setup();
        let body_str = r#"{"partition_keys":{"add":[{"field":"test_key"}],"remove":[]}, "full_text_search_keys":{"add":["city"],"remove":[]}}"#;
        // app
        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::put()
            .uri(&format!(
                "/api/{}/streams/{}/settings",
                "e2e", "olympics_schema"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_stream() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!("/api/{}/streams/{}", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_org() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_function() {
        let auth = setup();
        let body_str = r#"{
            "name": "e2etestfn",
            "function":".sqNew,err = .Year*.Year \n .",
            "params":"row"
        }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/functions", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = test::read_body(resp).await;
            let body_str = String::from_utf8_lossy(&body);
            println!("e2e_post_function response status: {status:?}");
            println!("e2e_post_function response body: {body_str:?}");

            // If function already exists, that's OK for our test
            if status == actix_web::http::StatusCode::BAD_REQUEST
                && body_str.contains("Function already exist")
            {
                println!("Function already exists, continuing with test");
                return;
            }

            panic!("e2e_post_function failed with status: {status:?}");
        }
        assert!(resp.status().is_success());
    }

    async fn e2e_list_functions() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/functions", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_function() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!("/api/{}/functions/{}", "e2e", "e2etestfn"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/_search", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_search_around() {
        let auth = setup();

        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let ts = chrono::Utc::now().timestamp_micros();

        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/{}/{}/_around?key={}&size=10",
                "e2e", "olympics_schema", ts
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_list_users() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/users", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_organizations() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/organizations")
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_user_passcode() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/passcode", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_update_user_passcode() {
        let auth = setup();
        let body_str = "";
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::put()
            .uri(&format!("/api/{}/passcode", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_user_authentication() {
        let _auth = setup();
        let body_str = r#"{
                                "name": "root@example.com",
                                "password": "Complexpass#123"
                            }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri("/auth/login")
            .insert_header(ContentType::json())
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_user_authentication_with_error() {
        let _auth = setup();
        let body_str = r#"{
                                "name": "root2@example.com",
                                "password": "Complexpass#123"
                            }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri("/auth/login")
            .insert_header(ContentType::json())
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(!resp.status().is_success());
    }

    async fn e2e_post_user() {
        let auth = setup();
        let body_str = r#"{
                                "email": "nonadmin@example.com",
                                "password": "Abcd12345",
                                "role": "admin"
                            }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/users", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        println!("post user resp: {resp:?}");
        assert!(resp.status().is_success());
    }

    async fn e2e_update_user() {
        let auth = setup();
        let body_str = r#"{
                                "email": "nonadmin@example.com",
                                "new_password": "12345678",
                                "change_password": true
                            }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::put()
            .uri(&format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_update_user_with_empty() {
        let auth = setup();
        let body_str = r#"{}"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::put()
            .uri(&format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(!resp.status().is_success());
    }

    async fn e2e_add_user_to_org() {
        let auth = setup();
        let body_str = r#"{
            "role":"member"
        }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/users/{}", "e2e", "root@example.com"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_user() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!("/api/{}/users/{}", "e2e", "nonadmin@example.com"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_create_dashboard() -> Dashboard {
        let auth = setup();
        let body_str = r##"{"title":"b2","dashboardId":"","description":"desc2","role":"","owner":"root@example.com","created":"2023-03-30T07:49:41.744+00:00","panels":[{"id":"Panel_ID7857010","type":"bar","fields":{"stream":"default","stream_type":"logs","x":[{"label":"Timestamp","alias":"x_axis_1","column":"_timestamp","color":null,"aggregationFunction":"histogram"}],"y":[{"label":"Kubernetes Host","alias":"y_axis_1","column":"kubernetes_host","color":"#5960b2","aggregationFunction":"count"}],"filter":[{"type":"condition","values":[],"column":"method","operator":"Is Not Null","value":null}]},"config":{"title":"p5","description":"sample config blah blah blah","show_legends":true},"query":"SELECT histogram(_timestamp) as \"x_axis_1\", count(kubernetes_host) as \"y_axis_1\"  FROM \"default\" WHERE method IS NOT NULL GROUP BY \"x_axis_1\" ORDER BY \"x_axis_1\"","customQuery":false}],"layouts":[{"x":0,"y":0,"w":12,"h":13,"i":1,"panelId":"Panel_ID7857010","static":false}]}"##;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/dashboards", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();

        let body = test::call_and_read_body(&app, req).await;
        json::from_slice(&body).unwrap()
    }

    async fn e2e_list_dashboards() -> Vec<Dashboard> {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/dashboards", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();

        // Try to parse the response body as a list of dashboards.
        let body = test::call_and_read_body(&app, req).await;
        let mut body_json: json::Value = json::from_slice(&body).unwrap();
        let list_json = body_json
            .as_object_mut()
            .unwrap()
            .remove("dashboards")
            .unwrap();
        let dashboards: Vec<Dashboard> = json::from_value(list_json).unwrap();

        dashboards
    }

    async fn e2e_update_dashboard(dashboard: v1::Dashboard, hash: String) -> Dashboard {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::put()
            .uri(&format!(
                "/api/{}/dashboards/{}?hash={}",
                "e2e", dashboard.dashboard_id, hash
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(json::to_string(&dashboard).unwrap())
            .to_request();

        let body = test::call_and_read_body(&app, req).await;
        json::from_slice(&body).unwrap()
    }

    async fn e2e_get_dashboard(dashboard_id: &str) -> Dashboard {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/dashboards/{dashboard_id}", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();

        let body = test::call_and_read_body(&app, req).await;
        json::from_slice(&body).unwrap()
    }

    async fn e2e_delete_dashboard(dashboard_id: &str) {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!("/api/{}/dashboards/{dashboard_id}", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_trace() {
        let auth = setup();
        let path = "./tests/trace_input.json";
        let body_str = fs::read_to_string(path).expect("Read file failed");

        // app
        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/traces", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
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
        let loc_exemp: Vec<prometheus_rpc::Exemplar> = vec![];
        let loc_hist: Vec<prometheus_rpc::Histogram> = vec![];

        let ts = prometheus_rpc::TimeSeries {
            labels: loc_label,
            samples: loc_samples,
            exemplars: loc_exemp,
            histograms: loc_hist,
        };

        let metadata: Vec<prometheus_rpc::MetricMetadata> = vec![];
        let wr_req: prometheus_rpc::WriteRequest = prometheus_rpc::WriteRequest {
            timeseries: vec![ts],
            metadata,
        };
        let mut out = BytesMut::with_capacity(wr_req.encoded_len());
        wr_req.encode(&mut out).expect("Out of memory");
        let data: Bytes = out.into();
        let body = snap::raw::Encoder::new()
            .compress_vec(&data)
            .expect("Out of memory");

        // app
        let thread_id: usize = 0;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .app_data(web::Data::new(thread_id))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/prometheus/api/v1/write", "e2e"))
            .insert_header(("X-Prometheus-Remote-Write-Version", "0.1.0"))
            .insert_header(("Content-Encoding", "snappy"))
            .insert_header(("Content-Type", "application/x-protobuf"))
            .append_header(auth)
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_org_summary() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/summary", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        log::info!("{:?}", resp.status());
        assert!(resp.status().is_success());
    }

    async fn e2e_post_alert_template() {
        let auth = setup();
        let body_str = r#"{"name":"slackTemplate","body":"{\"text\":\"For stream {stream_name} of organization {org_name} alert {alert_name} of type {alert_type} is active app_name {app_name}\"}"}"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/templates", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_alert_template() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/{}/alerts/templates/{}",
                "e2e", "slackTemplate"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_alert_template() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!(
                "/api/{}/alerts/templates/{}",
                "e2e", "slackTemplate"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_alert_email_template() {
        let auth = setup();
        let body_str = r#"{"name":"email_template","body":"This is email for {alert_name}.","type":"email","title":"Email Subject"}"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/templates", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_alert_email_template() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/{}/alerts/templates/{}",
                "e2e", "email_template"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_alert_email_template() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!(
                "/api/{}/alerts/templates/{}",
                "e2e", "email_template"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_list_alert_template() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/alerts/templates", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/destinations", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_alert_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/alerts/destinations/{}", "e2e", "slack"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_alert_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!("/api/{}/alerts/destinations/{}", "e2e", "slack"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        log::info!("{:?}", resp.status());
        assert!(resp.status().is_success());
    }

    async fn e2e_post_alert_email_destination() {
        let auth = setup();
        let body_str = r#"{"url":"","method":"post","skip_tls_verify":false,"template":"email_template","headers":{},"name":"email","type":"email","emails":["nonadmin@example.com"]}"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/destinations", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_alert_email_destination_should_fail() {
        let auth = setup();
        let body_str = r#"{"url":"","method":"post","skip_tls_verify":false,"template":"email_template","headers":{},"name":"email_fail","type":"email","emails":["nonadmin2@example.com"]}"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/destinations", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_client_error());
    }

    async fn e2e_get_alert_email_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/alerts/destinations/{}", "e2e", "email"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_alert_email_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!("/api/{}/alerts/destinations/{}", "e2e", "email"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_list_alert_destinations() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/alerts/destinations", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_sns_alert_template() {
        let auth = setup();
        let body_str = r#"{
            "name": "snsTemplate",
            "body": "{\"default\": \"SNS alert {alert_name} triggered for {stream_name} in {org_name}\"}"
        }"#;
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/templates", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/alerts/destinations", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_get_sns_alert_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!(
                "/api/{}/alerts/destinations/{}",
                "e2e", "sns_alert"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // Optionally, deserialize and check the response body
        let body = test::read_body(resp).await;
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/alerts/destinations", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // Optionally, deserialize and check the response body
        let body = test::read_body(resp).await;
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::put()
            .uri(&format!(
                "/api/{}/alerts/destinations/{}",
                "e2e", "sns_alert"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_sns_alert_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!(
                "/api/{}/alerts/destinations/{}",
                "e2e", "sns_alert"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/alerts", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_delete_alert_with_sns_destination() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::delete()
            .uri(&format!(
                "/api/{}/{}/alerts/{}",
                "e2e", "olympics_schema", "sns_test_alert"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/{}/alerts", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        // Get the alert with the same stream name
        let alert = openobserve::service::db::alerts::alert::get_by_name(
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
        let trigger = openobserve::service::db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger);
    }

    async fn e2e_delete_alert_multirange() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;

        // Get the alert with the same stream name
        let alert = openobserve::service::db::alerts::alert::get_by_name(
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
        let req = test::TestRequest::delete()
            .uri(&format!("/api/v2/{}/alerts/{}", "e2e", id))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());

        let trigger = openobserve::service::db::scheduler::exists(
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/v2/{}/alerts", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        println!("{:?}", resp.status());
        println!("{:?}", resp.response().body());
        assert!(resp.status().is_success());

        // Get the alert list
        let req = test::TestRequest::get()
            .uri(&format!("/api/v2/{}/alerts", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
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
        let trigger = openobserve::service::db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger);
    }

    async fn e2e_get_alert() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;

        // Get the alert list
        let req = test::TestRequest::get()
            .uri(&format!("/api/v2/{}/alerts", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
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

        let req = test::TestRequest::get()
            .uri(&format!("/api/v2/{}/alerts/{}", "e2e", id))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        log::info!("{:?}", resp.status());
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
        let alert_response: GetAlertResponseBody = serde_json::from_slice(&body).unwrap();
        assert_eq!(alert_response.0.name, "alertChk");
        assert_eq!(
            alert_response.0.stream_type,
            openobserve::handler::http::models::alerts::StreamType::Logs
        );
        assert_eq!(alert_response.0.stream_name, "olympics_schema");
        assert!(alert_response.0.enabled);
    }

    async fn e2e_handle_alert_after_destination_retries() {
        let alert = openobserve::service::db::alerts::alert::get_by_name(
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
        // This alert has an invalid destination
        assert!(res.is_ok());

        let trigger = openobserve::service::db::scheduler::get(
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
        let alert = openobserve::service::db::alerts::alert::get_by_name(
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

        let trigger = openobserve::service::db::scheduler::get(
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
            query_type: "sql".into(),
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

        let res = openobserve::service::db::alerts::alert::set("e2e", alert, true).await;
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

        let trigger = openobserve::service::db::scheduler::get(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.next_run_at > now && trigger.retries == 0);

        let res = openobserve::service::db::alerts::alert::delete_by_name(
            "e2e",
            config::meta::stream::StreamType::Logs,
            "olympics_schema",
            "test_alert_wrong_sql",
        )
        .await;
        assert!(res.is_ok());
    }

    async fn e2e_delete_alert() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;

        let alert = openobserve::service::db::alerts::alert::get_by_name(
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

        let req = test::TestRequest::delete()
            .uri(&format!(
                "/api/{}/{}/alerts/{}",
                "e2e", "olympics_schema", "alertChk"
            ))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        log::info!("{:?}", resp.status());
        assert!(resp.status().is_success());

        let trigger = openobserve::service::db::scheduler::exists(
            "e2e",
            config::meta::triggers::TriggerModule::Alert,
            &id.to_string(),
        )
        .await;
        assert!(!trigger);
    }

    async fn e2e_list_alerts() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/alerts", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_list_real_time_alerts() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/{}/alerts", "e2e", "olympics_schema"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_health_check() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/healthz")
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_config() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_config_routes)
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/config")
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_post_syslog_route() {
        let auth = setup();
        let body_str = r#"{
                                "orgId": "acceptLogs",
                                "streamName":"syslog",
                                "subnets": [
                                            "192.168.0.0/16",
                                            "127.0.0.0/8",
                                            "172.16.0.0/12"
                                        ]
                            }"#;

        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/syslog-routes", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    async fn e2e_list_syslog_routes() {
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes)
                .configure(get_basic_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri(&format!("/api/{}/syslog-routes", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    // Helper function to create pipeline via API
    async fn e2e_post_pipeline(pipeline_data: Pipeline) {
        let auth = setup();
        let body_str = serde_json::to_string(&pipeline_data).unwrap();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes),
        )
        .await;
        let req = test::TestRequest::post()
            .uri(&format!("/api/{}/pipelines", "e2e"))
            .insert_header(ContentType::json())
            .append_header(auth)
            .set_payload(body_str)
            .to_request();
        let resp = test::call_service(&app, req).await;
        if !resp.status().is_success() {
            let body = test::read_body(resp).await;
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/e2e/pipelines")
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
        let pipeline_list: openobserve::handler::http::models::pipelines::PipelineList =
            json::from_slice(&body).unwrap();
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

        let trigger = Trigger {
            id: 1,
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

        // Verify trigger was updated
        let trigger = openobserve::service::db::scheduler::get(
            "e2e",
            TriggerModule::DerivedStream,
            &module_key,
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        let scheduled_trigger_data: ScheduledTriggerData =
            serde_json::from_str(&trigger.data).unwrap();
        assert!(scheduled_trigger_data.period_end_time.is_some());
        assert!(scheduled_trigger_data.period_end_time.unwrap() > 0);
        assert!(trigger.status == TriggerStatus::Waiting);
        assert!(trigger.next_run_at > now && trigger.retries == 0);
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
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/e2e/pipelines")
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
        let pipeline_list: openobserve::handler::http::models::pipelines::PipelineList =
            json::from_slice(&body).unwrap();
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
        let trigger = openobserve::service::db::scheduler::get(
            "e2e",
            TriggerModule::DerivedStream,
            &module_key,
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.next_run_at > now && trigger.retries == 0);
    }

    async fn e2e_handle_derived_stream_evaluation_failure() {
        let auth = setup();
        // Create a pipeline with invalid SQL to cause evaluation failure
        let pipeline_data = Pipeline {
            id: "test_derived_stream_pipeline_invalid".to_string(),
            version: 1,
            enabled: true,
            org: "e2e".to_string(),
            name: "test_derived_stream_invalid".to_string(),
            description: "Test pipeline with invalid SQL".to_string(),
            source: PipelineSource::Scheduled(DerivedStream {
                org_id: "e2e".to_string(),
                stream_type: StreamType::Logs,
                query_condition: QueryCondition {
                    query_type: config::meta::alerts::QueryType::SQL,
                    sql: Some("SELECT _timestamp, city FROM \"olympics_schema\"".to_string()), /* Invalid
                                                                                                * SQL */
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
            nodes: vec![
                // Source node (query node for scheduled pipeline with invalid SQL)
                config::meta::pipeline::components::Node::new(
                    "source-node-2".to_string(),
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

        // Save pipeline using API call
        e2e_post_pipeline(pipeline_data.clone()).await;

        // Check if pipeline was saved successfully by doing a list using API
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes),
        )
        .await;

        // delete the city field from the stream
        // Make a PUT call to `e2e/streams/olympics_schema/delete_fields` api
        // with `{"fields":["method"]}` as the payload
        let delete_fields_url = "/api/e2e/streams/olympics_schema/delete_fields";
        let delete_fields_payload = serde_json::json!({"fields": ["city"]});

        let req = test::TestRequest::put()
            .uri(delete_fields_url)
            .append_header(auth)
            .set_json(&delete_fields_payload)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success(), "Failed to delete fields");

        let req = test::TestRequest::get()
            .uri("/api/e2e/pipelines")
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success(), "Failed to list pipelines");
        let body = test::read_body(resp).await;
        let pipeline_response: openobserve::handler::http::models::pipelines::PipelineList =
            json::from_slice(&body).unwrap();
        // Get the pipeline that matches the pipeline name
        let pipeline = pipeline_response
            .list
            .iter()
            .find(|p| p.name == pipeline_data.name);
        assert!(pipeline.is_some(), "Pipeline not found");
        let pipeline = pipeline.unwrap();

        let now = Utc::now().timestamp_micros();
        let mins_5_later = now
            + Duration::try_minutes(5)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let module_key = format!("logs/e2e/test_derived_stream_invalid/{}", pipeline.id);

        let trigger = Trigger {
            id: 4,
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
        let trigger = openobserve::service::db::scheduler::get(
            "e2e",
            TriggerModule::DerivedStream,
            &module_key,
        )
        .await;
        assert!(trigger.is_ok());
        let trigger = trigger.unwrap();
        assert!(trigger.retries > 0);

        // Clean up the invalid pipeline
        let _ = openobserve::service::db::pipeline::delete(&pipeline.id).await;
    }

    async fn e2e_cleanup_test_pipeline() {
        // list the pipelines and choose the first one using API
        let auth = setup();
        let app = test::init_service(
            App::new()
                .app_data(web::JsonConfig::default().limit(get_config().limit.req_json_limit))
                .app_data(web::PayloadConfig::new(
                    get_config().limit.req_payload_limit,
                ))
                .configure(get_service_routes),
        )
        .await;
        let req = test::TestRequest::get()
            .uri("/api/e2e/pipelines")
            .append_header(auth)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
        let body = test::read_body(resp).await;
        let pipeline_list: openobserve::handler::http::models::pipelines::PipelineList =
            json::from_slice(&body).unwrap();
        let pipeline = pipeline_list.list.first();
        assert!(pipeline.is_some());
        let pipeline = pipeline.unwrap();

        // Clean up test pipelines
        let _ = openobserve::service::db::pipeline::delete(&pipeline.id).await;
    }
}
