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

//! Own test binary: the hooks need the process-wide SQLite meta store, config and audit publisher.

#![cfg(feature = "enterprise")]

use std::sync::{Arc, LazyLock, Mutex};

use async_trait::async_trait;
#[cfg(feature = "cloud")]
use common::meta::organization::{DomainOrgMapping, OrganizationSetting};
use config::{
    META_ORG_ID,
    meta::destinations::{DestinationType, HTTPOutputFormat, HTTPType, Module},
    utils::json::{self, Value},
};
use o2_enterprise::enterprise::{
    common::auditor::{AuditMessage, Protocol, ResponseMeta},
    slack::hooks::{
        AlertViewKey, ChartSeries, SlackAppDestination, SlackHooks, WebhookDestination,
    },
};
use openobserve_jobs::job::slack_hooks;
use proto::cluster_rpc;

const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
});
static SETUP: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
static PUBLISHED: Mutex<Vec<cluster_rpc::IngestionRequest>> = Mutex::new(Vec::new());

struct Capture;

#[async_trait]
impl audit::AuditPublisher for Capture {
    async fn publish(
        &self,
        request: cluster_rpc::IngestionRequest,
    ) -> Result<cluster_rpc::IngestionResponse, anyhow::Error> {
        PUBLISHED.lock().unwrap().push(request);
        Ok(cluster_rpc::IngestionResponse::default())
    }
}

/// Every test runs on one runtime, because the database pool belongs to the runtime that opened it.
fn run<F: std::future::Future<Output = ()>>(test: F) {
    RUNTIME.block_on(async {
        SETUP.get_or_init(setup).await;
        test.await;
    });
}

async fn setup() {
    let data_dir = std::env::temp_dir().join(format!("o2-slack-hooks-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&data_dir);
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    let dir = format!("{}/", data_dir.display());
    // SAFETY: set before any thread reads the config, which is loaded once on first use.
    unsafe {
        std::env::set_var("ZO_LOCAL_MODE", "true");
        std::env::set_var("ZO_META_STORE", "sqlite");
        std::env::set_var("ZO_DATA_DIR", &dir);
        std::env::set_var("ZO_DATA_DB_DIR", format!("{dir}db/"));
        std::env::set_var("ZO_WEB_URL", "http://o2.test:5080");
        std::env::set_var("ZO_SKIP_SSRF_CHECKS", "true");
        std::env::set_var("O2_AUDIT_ENABLED", "true");
        std::env::set_var("O2_AUDIT_BATCH_SIZE", "1");
    }
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    assert!(audit::set_audit_publisher(Arc::new(Capture)).is_ok());
}

fn hooks() -> SlackHooks {
    slack_hooks::hooks()
}

fn webhook(org_id: &str, name: &str) -> WebhookDestination {
    WebhookDestination {
        org_id: org_id.to_string(),
        name: name.to_string(),
        webhook_url: "https://hooks.slack.com/services/T0TEAM/B0HOOK/secret".to_string(),
        channel: "#alerts".to_string(),
        channel_id: "C0ALERTS".to_string(),
        team_id: "T0TEAM".to_string(),
        team_name: "Acme".to_string(),
    }
}

fn series(points: usize) -> ChartSeries {
    let start_us = 1_760_000_000_000_000_i64;
    ChartSeries {
        title: "p95 latency".to_string(),
        x_unit: "us".to_string(),
        series: vec![(
            "p95".to_string(),
            (0..points)
                .map(|i| (start_us + i as i64 * 60_000_000, (i % 7) as f64 * 1.5))
                .collect(),
        )],
    }
}

#[cfg(feature = "cloud")]
fn mapping(domain: &str, org_id: &str) -> DomainOrgMapping {
    DomainOrgMapping {
        domain: domain.to_string(),
        org_id: org_id.to_string(),
        base_role: "admin".to_string(),
        role_claim_name: None,
        create_missing_roles: false,
    }
}

#[test]
fn create_webhook_destination_writes_a_prebuilt_slack_destination() {
    run(async {
        let created = (hooks().create_webhook_destination)(webhook("acme", "slack-alerts"))
            .await
            .expect("destination saved");
        assert_eq!(created.name, "slack-alerts");
        assert!(!created.id.is_empty(), "the saved id is returned");

        let stored = infra::table::destinations::get("acme", "slack-alerts")
            .await
            .unwrap()
            .expect("row written");
        assert_eq!(stored.id.map(|id| id.to_string()), Some(created.id));
        let Module::Alert {
            template,
            destination_type: DestinationType::Http(endpoint),
        } = stored.module
        else {
            panic!("an alert webhook destination: {:?}", stored.module);
        };
        assert_eq!(template.as_deref(), Some("prebuilt_slack"));
        assert_eq!(
            endpoint.url,
            "https://hooks.slack.com/services/T0TEAM/B0HOOK/secret"
        );
        assert_eq!(endpoint.method, HTTPType::POST);
        assert!(!endpoint.skip_tls_verify);
        assert_eq!(endpoint.output_format, Some(HTTPOutputFormat::JSON));
        assert_eq!(endpoint.destination_type.as_deref(), Some("slack"));
        let headers = endpoint.headers.expect("headers");
        assert_eq!(
            headers.get("Content-Type").map(String::as_str),
            Some("application/json")
        );
        let mut metadata: Vec<_> = endpoint.metadata.into_iter().collect();
        metadata.sort();
        let expected = [
            ("credential_channel", "#alerts"),
            ("prebuilt_type", "slack"),
            ("setup_method", "oauth"),
            ("slack_channel_id", "C0ALERTS"),
            ("slack_team_id", "T0TEAM"),
            ("slack_team_name", "Acme"),
        ]
        .map(|(k, v)| (k.to_string(), v.to_string()));
        assert_eq!(metadata, expected);
        assert!(
            db::alerts::templates::get("acme", "prebuilt_slack")
                .await
                .is_ok(),
            "the prebuilt template is created for the org"
        );

        let again = (hooks().create_webhook_destination)(webhook("acme", "slack-alerts")).await;
        assert!(again.is_err(), "a second destination with the same name");
    });
}

#[test]
fn shorten_url_stores_a_resolvable_org_scoped_short_url() {
    run(async {
        let long = "http://o2.test:5080/web/logs?org_identifier=acme&sql=c2VsZWN0IDE";
        let short = (hooks().shorten_url)("acme".to_string(), long.to_string())
            .await
            .expect("shortened");
        assert!(
            short.starts_with("http://o2.test:5080/web/short/"),
            "{short}"
        );
        let short_id = short
            .split("/short/")
            .nth(1)
            .and_then(|rest| rest.split('?').next())
            .expect("short id");
        assert_eq!(
            openobserve_core::short_url::retrieve("acme", short_id)
                .await
                .as_deref(),
            Some(long)
        );
        assert_eq!(
            openobserve_core::short_url::retrieve("other", short_id).await,
            None
        );
    });
}

#[test]
fn render_chart_png_renders_a_png() {
    run(async {
        let png = (hooks().render_chart_png)(series(30))
            .await
            .expect("rendered");
        assert!(png.starts_with(PNG_MAGIC), "PNG magic bytes");
        let many = (hooks().render_chart_png)(series(500))
            .await
            .expect("long series are downsampled, not refused");
        assert!(many.starts_with(PNG_MAGIC));
        assert_eq!((hooks().render_chart_png)(series(1)).await, None);
        let empty = ChartSeries {
            series: vec![],
            ..series(0)
        };
        assert_eq!((hooks().render_chart_png)(empty).await, None);
    });
}

#[test]
fn is_org_blocked_follows_the_org_status() {
    run(async {
        assert!(!(hooks().is_org_blocked)("going"));
        db::org_status::broadcast_pending_deletion("going")
            .await
            .unwrap();
        assert!((hooks().is_org_blocked)("going"));
        db::org_status::set_active("going").await.unwrap();
        assert!(!(hooks().is_org_blocked)("going"));
    });
}

#[test]
fn audit_publishes_a_slack_record_to_the_meta_audit_stream() {
    run(async {
        PUBLISHED.lock().unwrap().clear();
        (hooks().audit)(AuditMessage {
            user_email: "alice@acme.com".to_string(),
            org_id: "acme".to_string(),
            _timestamp: 1_760_000_000_000_000,
            protocol: Protocol::Slack,
            response_meta: ResponseMeta {
                http_method: "POST".to_string(),
                http_path: "/api/slack/events".to_string(),
                http_query_params: String::new(),
                http_body: String::new(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
            delegated: None,
        })
        .await;
        let published = std::mem::take(&mut *PUBLISHED.lock().unwrap());
        assert_eq!(published.len(), 1, "one batch of one");
        let request = &published[0];
        assert_eq!(request.org_id, META_ORG_ID);
        assert_eq!(request.stream_name, "audit");
        let rows: Vec<Value> =
            json::from_slice(&request.data.as_ref().expect("rows").data).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["protocol"], "Slack");
        assert_eq!(rows[0]["org_id"], "acme");
        assert_eq!(rows[0]["http_path"], "/api/slack/events");
    });
}

#[cfg(not(feature = "cloud"))]
#[test]
fn domain_mappings_are_empty_outside_cloud() {
    run(async {
        let domains = (hooks().domain_mappings_for_org)("mapped".to_string())
            .await
            .unwrap();
        assert!(domains.is_empty(), "{domains:?}");
    });
}

#[test]
fn alert_message_view_reads_a_deleted_alert_as_gone_and_a_malformed_id_as_none() {
    run(async {
        let key = |alert_id: &str| AlertViewKey {
            org_id: "acme".to_string(),
            alert_id: alert_id.to_string(),
            group_key: String::new(),
            firing_started_at: 1_760_000_000_000_000,
        };
        let none = (hooks().alert_message_view)(key("not-a-ksuid"))
            .await
            .unwrap();
        assert!(none.is_none());
        let gone = (hooks().alert_message_view)(key("2i4WBnxsiDiRR1dh7O4qcIfUyBW"))
            .await
            .unwrap()
            .expect("a well-formed id always gets a view");
        assert_eq!(
            gone.phase,
            config::meta::slack::AlertMessagePhase::Gone(
                config::meta::slack::GoneKind::AlertDeleted
            )
        );
        assert!(
            gone.open_url
                .ends_with("alert_id=2i4WBnxsiDiRR1dh7O4qcIfUyBW"),
            "{}",
            gone.open_url
        );
    });
}

#[test]
fn create_slack_app_destination_goes_through_the_destination_checks() {
    run(async {
        let err = (hooks().create_slack_app_destination)(SlackAppDestination {
            org_id: "acme".to_string(),
            name: "slack-sre-prod".to_string(),
            target: config::meta::destinations::SlackAppTarget {
                installation_id: "I0FAKE00009".to_string(),
                channel_id: "C0FAKE00001".to_string(),
                channel_name: "sre-prod".to_string(),
                ..Default::default()
            },
            created_by: "admin@acme.test".to_string(),
        })
        .await
        .expect_err("Slack is off in this binary, so the save refuses");
        assert!(err.to_string().contains("Slack"), "{err}");
        assert!(
            db::alerts::destinations::get("acme", "slack-sre-prod")
                .await
                .is_err(),
            "nothing was written"
        );
    });
}

#[cfg(feature = "cloud")]
#[test]
fn domain_mappings_follow_the_first_match_rule() {
    run(async {
        let settings = OrganizationSetting {
            domain_org_mappings: vec![
                mapping("acme.com", "mapped"),
                mapping("ACME.io", "mapped"),
                mapping("shared.com", "first"),
                mapping("shared.com", "mapped"),
                mapping("blocked.com", "blocked-org"),
            ],
            ..Default::default()
        };
        db::organization::set_org_setting(META_ORG_ID, &settings)
            .await
            .unwrap();
        db::org_status::broadcast_pending_deletion("blocked-org")
            .await
            .unwrap();
        let mapped = (hooks().domain_mappings_for_org)("mapped".to_string())
            .await
            .unwrap();
        assert_eq!(mapped, vec!["acme.com", "acme.io"]);
        let blocked = (hooks().domain_mappings_for_org)("blocked-org".to_string())
            .await
            .unwrap();
        assert!(blocked.is_empty(), "a blocked org gets no domains");
    });
}
