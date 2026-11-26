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

//! The domain manager against the real `pebble`: the installation check, a claim from CNAME to
//! Serving over TLS-ALPN-01 with the `tlsserver` profile, a renewal, a failed validation and its
//! backoff, a switch of CA directory, and a release that removes the row and queues the
//! revocation. One test function, because the ports are fixed by the environment.

#![cfg(feature = "enterprise")]

use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};

use base64::{Engine, prelude::BASE64_STANDARD};
use config::meta::organization::OrganizationType;
use infra::{
    db::get_orm_client_rw,
    table::{
        entity::{
            status_page_custom_domains as claims, status_page_domain_certs as certs,
            status_page_domain_revocations as revocations, status_pages,
        },
        organizations, status_page_domains as domains,
    },
};
use o2_enterprise::enterprise::status_pages::{
    cert_store::{self, enabled},
    domain_manager::{Options, Timings, run_with},
    domain_verifier::{CheckRules, check_claim, proof_lookup_at},
};
use openobserve_api_http::server;
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, IntoActiveModel};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

const ORG: &str = "acmeorg";
const PAGE: &str = "acmepage";
const SLUG: &str = "brand";
const HOST: &str = "status.brand.test";
const TARGET: &str = "domains.brand.test";
const CLAIM: &str = "acmeclaim";
const MICROS_PER_MINUTE: i64 = 60_000_000;
/// The listener answers a TLS handshake in under this long once the store loaded.
const READY_DEADLINE: Duration = Duration::from_secs(180);

/// A logger that prints, so the manager's failures reach the test output.
struct Print;

impl log::Log for Print {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        eprintln!("[{}] {}", record.level(), record.args());
    }

    fn flush(&self) {}
}

static PRINT: Print = Print;

/// The environment `scripts/pebble-test-env.sh` prints; the test is skipped when it is absent.
struct Env {
    dns: SocketAddr,
    admin: String,
    directory: String,
    second_directory: String,
    management: String,
    ca_root: Vec<u8>,
    tls_port: u16,
}

impl Env {
    fn read() -> Option<Self> {
        let var = |name: &str| std::env::var(name).ok();
        let dns = var("ZO_TEST_PEBBLE_DNS")?;
        let ca_root = var("ZO_TEST_PEBBLE_CA_ROOT")?;
        let tls_port = var("ZO_TEST_PEBBLE_TLS_PORT")?;
        Some(Self {
            dns: dns.parse().expect("ZO_TEST_PEBBLE_DNS is host:port"),
            admin: var("ZO_TEST_PEBBLE_DNS_ADMIN_URL")?,
            directory: var("ZO_TEST_PEBBLE_DIRECTORY_URL")?,
            second_directory: var("ZO_TEST_PEBBLE_SECOND_DIRECTORY_URL")?,
            management: var("ZO_TEST_PEBBLE_MANAGEMENT_URL")?,
            ca_root: std::fs::read(ca_root).ok()?,
            tls_port: tls_port.parse().expect("ZO_TEST_PEBBLE_TLS_PORT is a port"),
        })
    }
}

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets every variable before any config read.
    unsafe { std::env::set_var(key, value) };
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn local(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

/// Boots the meta store and the configuration with built-in TLS on this test's port.
async fn boot(env: &Env) -> &'static DatabaseConnection {
    let data_dir = std::env::temp_dir().join(format!("o2-domain-acme-{}", std::process::id()));
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    // An explicit config file stops config loading from finding a developer `.env` up the tree.
    let env_file = data_dir.join("empty.env");
    std::fs::write(&env_file, "").unwrap();
    config::config_path_manager::set_config_file_path(env_file).unwrap();
    let dir = format!("{}/", data_dir.display());
    set_env("ZO_LOCAL_MODE", "true");
    set_env("ZO_META_STORE", "sqlite");
    set_env("ZO_DATA_DIR", &dir);
    set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
    set_env("ZO_SYNTHETICS_ENABLED", "true");
    set_env("ZO_STATUS_PAGE_DOMAIN_TARGET", TARGET);
    set_env("ZO_STATUS_PAGE_DOMAIN_ACME_DIRECTORY", &env.directory);
    set_env("ZO_STATUS_PAGE_DOMAIN_TLS", "built_in");
    set_env("ZO_STATUS_PAGE_DOMAIN_PROXY_PROTOCOL", "false");
    set_env("ZO_HTTP_IPV6_ENABLED", "false");
    set_env(
        "ZO_STATUS_PAGE_DOMAIN_HTTPS_PORT",
        &env.tls_port.to_string(),
    );
    set_env("ZO_STATUS_PAGE_DOMAIN_HTTP_PORT", &free_port().to_string());
    set_env("ZO_HTTP_PORT", &free_port().to_string());
    set_env(
        "ZO_STATUS_PAGE_DOMAIN_HEALTH_PORT",
        &free_port().to_string(),
    );
    set_env(
        "ZO_STATUS_PAGE_DOMAIN_ENCRYPTION_KEY",
        &BASE64_STANDARD.encode([7u8; 64]),
    );
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    get_orm_client_rw().await
}

async fn seed(db: &DatabaseConnection) {
    organizations::add(ORG, ORG, OrganizationType::Custom)
        .await
        .unwrap();
    status_pages::Model {
        id: PAGE.to_string(),
        org_id: ORG.to_string(),
        name: "Brand".to_string(),
        slug: SLUG.to_string(),
        description: None,
        visibility: 1,
        password_hash: None,
        noindex: false,
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
        tracking_since: None,
        owner: None,
        created_at: 1,
        updated_at: 1,
    }
    .into_active_model()
    .insert(db)
    .await
    .unwrap();
    infra::table::status_pages::upsert_snapshot(
        db,
        PAGE,
        ORG,
        Some(r#"{"days":[]}"#),
        Some(r#"{"overall":"operational"}"#),
        1,
    )
    .await
    .unwrap();
}

async fn claim(db: &DatabaseConnection, id: &str) -> claims::Model {
    claims::Entity::find_by_id(id)
        .one(db)
        .await
        .unwrap()
        .unwrap()
}

async fn add_claim(db: &DatabaseConnection, env: &Env, (id, host, label): (&str, &str, &str)) {
    claims::Model {
        id: id.to_string(),
        org_id: ORG.to_string(),
        status_page_id: PAGE.to_string(),
        domain: host.to_string(),
        verification_token: format!("o2v_{id}"),
        verification_state: 0,
        cname_label: Some(label.to_string()),
        created_at: 1,
        updated_at: 1,
        ..Default::default()
    }
    .into_active_model()
    .insert(db)
    .await
    .unwrap();
    manage(
        env,
        "set-cname",
        serde_json::json!({"host": host, "target": format!("{label}.{TARGET}")}),
    )
    .await;
}

/// A management call of challtestsrv, unsigned (its DNS management API needs no HMAC).
async fn manage(env: &Env, call: &str, body: serde_json::Value) {
    let response = reqwest::Client::new()
        .post(format!("{}/{call}", env.admin))
        .body(body.to_string())
        .send()
        .await
        .unwrap_or_else(|e| panic!("{call}: {e}"));
    assert!(
        response.status().is_success(),
        "{call}: {}",
        response.status()
    );
}

async fn wait_for<F, Fut>(what: &str, mut ready: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let deadline = Instant::now() + READY_DEADLINE;
    while Instant::now() < deadline {
        if ready().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    if let Some(db) = DIAG_DB.get() {
        let now = config::utils::time::now_micros();
        eprintln!(
            "diag manager: {:?}",
            infra::table::status_page_domains::get_manager(*db).await
        );
        eprintln!(
            "diag listeners: {:?}",
            infra::table::status_page_domains::list_reporting_listeners(*db, now).await
        );
        eprintln!(
            "diag claim: {:?}",
            claims::Entity::find_by_id("acmeclaim").one(*db).await
        );
        eprintln!(
            "diag host orders: {:?}",
            infra::table::status_page_domains::list_hostname_orders(*db, HOST, 20).await
        );
        if let Some(port) = DIAG_PORT.get() {
            eprintln!("diag fetch: {:?}", fetch_head(*port).await);
        }
        eprintln!(
            "diag target orders: {:?}",
            infra::table::status_page_domains::list_hostname_orders(*db, TARGET, 20).await
        );
    }
    panic!("timed out waiting for {what}");
}

static DIAG_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
static DIAG_DB: std::sync::OnceLock<&'static DatabaseConnection> = std::sync::OnceLock::new();

/// A TLS handshake against the domain listener for `HOST`, which pebble's chain must answer.
async fn handshake(port: u16) -> Result<(), String> {
    connect_host(port).await.map(|_| ())
}

/// What the manager's probe asks: the public-by-host path, and the head of the answer.
async fn fetch_head(port: u16) -> Result<String, String> {
    let mut tls = connect_host(port).await?;
    let request = format!(
        "GET /api/status_pages_public_by_host HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n"
    );
    tls.write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut head = vec![0u8; 300];
    let read = tls.read(&mut head).await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&head[..read]).to_string())
}

async fn connect_host(port: u16) -> Result<tokio_rustls::client::TlsStream<TcpStream>, String> {
    let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    let config = tokio_rustls::rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("the ring provider has the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny))
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let tcp = TcpStream::connect(local(port))
        .await
        .map_err(|e| e.to_string())?;
    let name = tokio_rustls::rustls::pki_types::ServerName::try_from(HOST.to_string())
        .map_err(|e| e.to_string())?;
    connector
        .connect(name, tcp)
        .await
        .map_err(|e| e.to_string())
}

/// Accepts any certificate: the test only asks whether a handshake completes.
#[derive(Debug)]
struct AcceptAny;

impl tokio_rustls::rustls::client::danger::ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _end_entity: &tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[tokio_rustls::rustls::pki_types::CertificateDer<'_>],
        _server_name: &tokio_rustls::rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: tokio_rustls::rustls::pki_types::UnixTime,
    ) -> Result<tokio_rustls::rustls::client::danger::ServerCertVerified, tokio_rustls::rustls::Error>
    {
        Ok(tokio_rustls::rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        _dss: &tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        tokio_rustls::rustls::Error,
    > {
        Ok(tokio_rustls::rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &tokio_rustls::rustls::pki_types::CertificateDer<'_>,
        _dss: &tokio_rustls::rustls::DigitallySignedStruct,
    ) -> Result<
        tokio_rustls::rustls::client::danger::HandshakeSignatureValid,
        tokio_rustls::rustls::Error,
    > {
        Ok(tokio_rustls::rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<tokio_rustls::rustls::SignatureScheme> {
        tokio_rustls::rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pebble_issues_serves_and_revokes_a_custom_domain() {
    let Some(env) = Env::read() else {
        eprintln!("skipped: needs the variables from scripts/pebble-test-env.sh");
        return;
    };
    let _ = log::set_logger(&PRINT);
    log::set_max_level(log::LevelFilter::Info);
    let db = boot(&env).await;
    assert!(enabled(), "built-in TLS is on: the target is set");
    seed(db).await;
    manage(
        &env,
        "set-default-ipv4",
        serde_json::json!({"ip": "127.0.0.1"}),
    )
    .await;
    add_claim(db, &env, (CLAIM, HOST, "labelacmeaaaaaaa")).await;

    tokio::spawn(server::run(|_| {
        axum::Router::new().fallback(|| async { "ok" })
    }));
    cert_store::spawn_tasks();
    cert_store::loaded().await;
    DIAG_DB.set(db).unwrap();
    DIAG_PORT.set(env.tls_port).unwrap();
    let options = Options {
        dns_server: Some(env.dns),
        timings: Timings {
            cycle: Duration::from_secs(1),
            recheck_gap: Duration::from_secs(2),
            settle_wait: Duration::from_secs(6),
            probe_pace: Duration::from_millis(50),
            lease_renew: Duration::from_secs(5),
            window_refresh: Duration::from_secs(2),
        },
        extra_root: Some(env.ca_root.clone()),
        acme_directory: None,
    };
    let running = tokio::spawn(run_with(options.clone()));
    wait_for_installation(db).await;
    let first = first_issuance(db, &env).await;
    renew_at_pebble(db, &env, &first).await;
    check_validation_backoff(db, &env).await;

    running.abort();
    assert!(running.await.unwrap_err().is_cancelled());
    let switched = tokio::spawn(run_with(Options {
        acme_directory: Some(env.second_directory.clone()),
        ..options
    }));
    for host in [TARGET, HOST] {
        wait_for(
            "reissuance by the second CA after lease handover",
            || async {
                domains::get_cert(db, host)
                    .await
                    .unwrap()
                    .is_some_and(|row| row.cert.ca_directory == env.second_directory)
            },
        )
        .await;
    }
    release_and_check_revocation(db).await;
    switched.abort();
}

async fn wait_for_installation(db: &DatabaseConnection) {
    use o2_enterprise::enterprise::status_pages::domain_verifier::{Installation, installation_of};

    wait_for("the installation ready", || async {
        let row = domains::get_manager(db).await.unwrap().unwrap();
        let now = config::utils::time::now_micros();
        matches!(
            installation_of(row.installation_status.as_deref(), TARGET, now),
            Installation::Ready | Installation::ReadyForADay
        )
    })
    .await;
    assert_eq!(
        domains::get_cert(db, TARGET)
            .await
            .unwrap()
            .unwrap()
            .cert
            .source,
        "target"
    );
}

async fn claim_with_cname(db: &DatabaseConnection, env: &Env, id: &str) {
    let rules = CheckRules {
        displacement_allowed: true,
        holder_clock: true,
        lapse_allowed: false,
        stored_epoch: None,
    };
    wait_for("a claim to become the holder", || async {
        let row = claim(db, id).await;
        if row.held_domain.is_some() {
            return true;
        }
        let now = config::utils::time::now_micros();
        check_claim(db, &row, now, rules, &proof_lookup_at(env.dns))
            .await
            .unwrap();
        claim(db, id).await.held_domain.is_some()
    })
    .await;
}

async fn first_issuance(db: &DatabaseConnection, env: &Env) -> certs::Model {
    claim_with_cname(db, env, CLAIM).await;
    wait_for("the claim to serve", || async {
        claim(db, CLAIM).await.serving_state.as_deref() == Some("serving")
    })
    .await;
    handshake(env.tls_port)
        .await
        .expect("pebble's certificate answers");
    let first = domains::get_cert(db, HOST).await.unwrap().unwrap().cert;
    assert_eq!(first.ca_directory, env.directory);
    assert_eq!(
        first.not_after - first.not_before,
        45 * 24 * 60 * MICROS_PER_MINUTE - 1_000_000,
        "Pebble issued the tlsserver profile, not its 90-day default"
    );
    first
}

async fn renew_at_pebble(db: &DatabaseConnection, env: &Env, first: &certs::Model) {
    let client = reqwest::Client::builder()
        .user_agent("OpenObserve Pebble integration test")
        .add_root_certificate(reqwest::Certificate::from_pem(&env.ca_root).unwrap())
        .build()
        .unwrap();
    let ari = serde_json::json!({
        "suggestedWindow": {"start": "2020-01-01T00:00:00Z", "end": "2020-01-02T00:00:00Z"},
    });
    let response = client
        .post(format!("{}/set-renewal-info/", env.management))
        .json(&serde_json::json!({"certificate": first.cert_chain, "ariResponse": ari.to_string()}))
        .send()
        .await
        .unwrap();
    let status = response.status();
    assert!(
        status.is_success(),
        "set-renewal-info: {status}: {}",
        response.text().await.unwrap()
    );
    wait_for("a replacement issued after the CA's ARI update", || async {
        let cert = domains::get_cert(db, HOST).await.unwrap().unwrap().cert;
        cert.fingerprint != first.fingerprint
            && cert.previous_fingerprint.as_deref() == Some(first.fingerprint.as_str())
            && domains::list_hostname_orders(db, HOST, 20)
                .await
                .unwrap()
                .iter()
                .any(|order| order.kind == "renewal" && order.state == domains::ORDER_DONE)
    })
    .await;
}

async fn check_validation_backoff(db: &DatabaseConnection, env: &Env) {
    let (id, host, label) = ("failclaim", "fails.brand.test", "invalidacmeaaaaa");
    // The IPv6 endpoint completes TLS but presents a certificate without the ACME extension.
    let rejection_listener = serve_wrong_challenge_certificate(env.tls_port, host).await;
    manage(
        env,
        "add-aaaa",
        serde_json::json!({
            "host": format!("{label}.{TARGET}"), "addresses": ["::1"],
        }),
    )
    .await;
    add_claim(db, env, (id, host, label)).await;
    claim_with_cname(db, env, id).await;

    wait_for(
        "Pebble's validation failure and the retry deadline",
        || async {
            let orders = domains::list_hostname_orders(db, host, 20).await.unwrap();
            let row = claim(db, id).await;
            matches!(orders.as_slice(), [order] if order.state == domains::ORDER_FAILED
            && order.outcome.as_deref().is_some_and(|reason| reason.contains("Missing acmeValidationV1 extension"))
            && row.serving_reason.as_deref() == Some("ca_other")
            && row.next_action_at == Some(order.updated_at + 60 * MICROS_PER_MINUTE))
        },
    )
    .await;
    assert!(domains::get_cert(db, host).await.unwrap().is_none());
    rejection_listener.abort();
    assert!(rejection_listener.await.unwrap_err().is_cancelled());
}

async fn serve_wrong_challenge_certificate(port: u16, host: &str) -> tokio::task::JoinHandle<()> {
    use tokio_rustls::rustls::{ServerConfig, crypto::ring, pki_types::PrivatePkcs8KeyDer};

    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(vec![host.to_string()]).unwrap();
    let mut tls = ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.der().clone()],
            PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
        )
        .unwrap();
    tls.alpn_protocols = vec![b"acme-tls/1".to_vec()];
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls));
    let listener = tokio::net::TcpListener::bind((std::net::Ipv6Addr::LOCALHOST, port))
        .await
        .unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            acceptor
                .accept(tcp)
                .await
                .expect("Pebble's validation handshake");
        }
    })
}

async fn release_and_check_revocation(db: &DatabaseConnection) {
    use sea_orm::{ColumnTrait, QueryFilter};

    let released = infra::table::status_pages::release_domain(
        db,
        ORG,
        CLAIM,
        config::utils::time::now_micros(),
        1,
    )
    .await
    .unwrap();
    assert!(released.is_some());
    tokio::time::timeout(
        Duration::from_secs(60),
        wait_for("the released certificate to go", || async {
            domains::get_cert(db, HOST).await.unwrap().is_none()
                && revocations::Entity::find()
                    .filter(revocations::Column::Hostname.eq(HOST))
                    .one(db)
                    .await
                    .unwrap()
                    .is_some()
        }),
    )
    .await
    .expect("release queues the certificate in at most 60 seconds");
}
