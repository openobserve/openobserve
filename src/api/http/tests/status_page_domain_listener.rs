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

//! Own test binary: it sets the domain settings and binds the domain ports of this process.

#![cfg(feature = "enterprise")]

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{Engine, prelude::BASE64_STANDARD};
use config::meta::organization::OrganizationType;
use infra::{
    db::get_orm_client_rw,
    table::{
        entity::{status_page_custom_domains as claims, status_pages},
        organizations,
    },
};
use o2_enterprise::enterprise::status_pages::{
    cert_import::{ImportContext, import_with},
    cert_store::{self, Readiness},
    domain_key::DomainKey,
};
use openobserve_api_http::{domain_listener, server};
use sea_orm::{ActiveModelTrait, DatabaseConnection, IntoActiveModel};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tokio_rustls::{
    TlsConnector,
    rustls::{
        ClientConfig, RootCertStore,
        crypto::ring,
        pki_types::{CertificateDer, ServerName, pem::PemObject},
    },
};

const ORG: &str = "orga";
const PAGE: &str = "pagea";
const SLUG: &str = "brand-status";
const HOST: &str = "status.brand.test";
const TARGET: &str = "domains.brand.test";
const DAY_MICROS: i64 = 24 * 3_600 * 1_000_000;

/// The error lines of the process, so the test can see that a listener failure was logged.
static ERRORS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static LOGGER: Capture = Capture;

struct Capture;

impl log::Log for Capture {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Error
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            ERRORS.lock().unwrap().push(record.args().to_string());
        }
    }

    fn flush(&self) {}
}

fn set_env(key: &str, value: &str) {
    // SAFETY: the single test in this binary sets variables before reading config, then serially.
    unsafe { std::env::set_var(key, value) };
}

/// The free ports this process binds, kept in an environment the test reads back.
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

async fn boot() -> &'static DatabaseConnection {
    let data_dir = std::env::temp_dir().join(format!("o2-domain-listener-{}", std::process::id()));
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
    set_env(
        "ZO_STATUS_PAGE_DOMAIN_ENCRYPTION_KEY",
        &BASE64_STANDARD.encode([7u8; 64]),
    );
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    get_orm_client_rw().await
}

/// A page with a snapshot, and a holder claim for `HOST`.
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
    claims::Model {
        id: "claima".to_string(),
        org_id: ORG.to_string(),
        status_page_id: PAGE.to_string(),
        domain: HOST.to_string(),
        verification_token: "o2v_a".to_string(),
        verification_state: 1,
        held_domain: Some(HOST.to_string()),
        cname_label: Some("labelone".to_string()),
        created_at: 1,
        updated_at: 1,
        ..Default::default()
    }
    .into_active_model()
    .insert(db)
    .await
    .unwrap();
}

/// A test CA, the certificate it issues for `HOST`, and the roots a client trusts.
struct Pki {
    chain_pem: String,
    key_pem: String,
    roots: RootCertStore,
}

fn pki() -> Pki {
    let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.not_before = rcgen::date_time_ymd(2020, 1, 1);
    params.not_after = rcgen::date_time_ymd(2040, 1, 1);
    let ca =
        rcgen::CertifiedIssuer::self_signed(params, rcgen::KeyPair::generate().unwrap()).unwrap();
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from_pem_slice(ca.pem().as_bytes()).unwrap())
        .unwrap();
    let key = rcgen::KeyPair::generate().unwrap();
    let mut leaf = rcgen::CertificateParams::new(vec![HOST.to_string()]).unwrap();
    leaf.not_before = rcgen::date_time_ymd(2025, 1, 1);
    leaf.not_after = rcgen::date_time_ymd(2035, 1, 1);
    let leaf = leaf.signed_by(&key, &*ca).unwrap();
    Pki {
        chain_pem: format!("{}{}", leaf.pem(), ca.pem()),
        key_pem: key.serialize_pem(),
        roots,
    }
}

async fn import(db: &DatabaseConnection, pki: &Pki) {
    let key = DomainKey::from_settings(&BASE64_STANDARD.encode([7u8; 64]), "").unwrap();
    let context = ImportContext {
        roots: Arc::new(pki.roots.clone()),
        now: config::utils::time::now_micros(),
        key: &key,
        epoch: 1,
    };
    import_with(db, &context, HOST, &pki.chain_pem, &pki.key_pem)
        .await
        .unwrap();
    cert_store::announce_changed(&[HOST.to_string()]).await;
}

/// A TLS client that trusts the test CA and talks HTTP/1.1.
async fn https_get(
    addr: SocketAddr,
    roots: &RootCertStore,
    path: &str,
) -> Result<(u16, String), String> {
    let config = ClientConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots.clone())
        .with_no_client_auth();
    let tcp = TcpStream::connect(addr).await.map_err(|e| e.to_string())?;
    let name = ServerName::try_from(HOST.to_string()).unwrap();
    let mut tls = TlsConnector::from(Arc::new(config))
        .connect(name, tcp)
        .await
        .map_err(|e| e.to_string())?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: {HOST}\r\nConnection: close\r\n\r\n");
    tls.write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut text = Vec::new();
    tls.read_to_end(&mut text)
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&text).into_owned();
    let status = text
        .split(' ')
        .nth(1)
        .and_then(|status| status.parse().ok())
        .unwrap_or(0);
    Ok((status, text))
}

async fn plain_get(addr: SocketAddr, path: &str) -> Result<(u16, String), String> {
    let mut tcp = TcpStream::connect(addr).await.map_err(|e| e.to_string())?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    tcp.write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut text = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(5), tcp.read_to_end(&mut text)).await;
    let text = String::from_utf8_lossy(&text).into_owned();
    let status = text
        .split(' ')
        .nth(1)
        .and_then(|status| status.parse().ok())
        .unwrap_or(0);
    Ok((status, text))
}

/// Waits for a port to answer, which the listener only starts doing after its first load.
async fn wait_for(addr: SocketAddr, path: &str, want: u16) -> (u16, String) {
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut last = (0, String::new());
    while Instant::now() < deadline {
        if let Ok(answer) = plain_get(addr, path).await
            && answer.0 == want
        {
            return answer;
        }
        last = plain_get(addr, path).await.unwrap_or((0, String::new()));
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("{addr}{path} never answered {want}, last {last:?}");
}

/// Waits for the handshake of `HOST` to stop working after the claim is released.
async fn wait_for_handshake_failure(addr: SocketAddr, roots: &RootCertStore) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if https_get(addr, roots, "/").await.is_err() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the handshake for {HOST} still succeeds after the release");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_listener_serves_a_holders_page_and_never_stops_the_main_server() {
    log::set_logger(&LOGGER).expect("no other logger in this test binary");
    log::set_max_level(log::LevelFilter::Error);
    let db = boot().await;
    let pki = pki();
    seed(db).await;
    import(db, &pki).await;

    let (main, https, health) = (free_port(), free_port(), free_port());
    set_env("ZO_HTTP_PORT", &main.to_string());
    set_env("ZO_STATUS_PAGE_DOMAIN_HTTPS_PORT", &https.to_string());
    set_env("ZO_STATUS_PAGE_DOMAIN_HEALTH_PORT", &health.to_string());
    set_env("ZO_STATUS_PAGE_DOMAIN_HTTP_PORT", &free_port().to_string());
    config::refresh_config().unwrap();
    let first = tokio::spawn(server::run(|_| axum::Router::new()));
    let (main_addr, https_addr, health_addr) = (local(main), local(https), local(health));

    // The store has not loaded yet: the main app answers, the listener's health port says so, and
    // its TLS port refuses.
    assert_ne!(cert_store::readiness(), Readiness::Ready);
    assert_eq!(wait_for(main_addr, "/healthz", 200).await.0, 200);
    let (status, text) = wait_for(health_addr, "/healthz", 503).await;
    assert!(status == 503 && text.contains("loading"), "{text}");
    assert!(TcpStream::connect(https_addr).await.is_err());

    cert_store::spawn_tasks();
    assert_eq!(wait_for(health_addr, "/healthz", 200).await.0, 200);
    let (status, text) = https_get(https_addr, &pki.roots, &format!("/status/{SLUG}"))
        .await
        .unwrap();
    assert_eq!(status, 301, "{text}");
    assert!(text.contains("location: /"), "{text}");
    let (status, text) = https_get(https_addr, &pki.roots, "/").await.unwrap();
    assert_eq!(status, 200, "{text}");
    assert!(text.contains("status_page"), "{text}");
    let (status, text) = https_get(https_addr, &pki.roots, "/api/orga/_search")
        .await
        .unwrap();
    assert!(
        status == 404 || text.contains("status_page"),
        "{status} {text}"
    );
    assert_eq!(plain_get(main_addr, "/healthz").await.unwrap().0, 200);

    let released = infra::table::status_pages::release_domain(
        db,
        ORG,
        "claima",
        2 * DAY_MICROS,
        infra::table::status_pages::RELEASED_BY_ORG,
    )
    .await
    .unwrap();
    assert!(released.is_some());
    wait_for_handshake_failure(https_addr, &pki.roots).await;

    // A second main server whose TLS port is taken by another socket and whose redirect port is
    // its own HTTP port: both domain ports fail to bind, the main server serves.
    let (main2, https2, health2) = (free_port(), free_port(), free_port());
    let taken = std::net::TcpListener::bind(("0.0.0.0", https2)).unwrap();
    set_env("ZO_HTTP_PORT", &main2.to_string());
    set_env("ZO_STATUS_PAGE_DOMAIN_HTTPS_PORT", &https2.to_string());
    set_env("ZO_STATUS_PAGE_DOMAIN_HEALTH_PORT", &health2.to_string());
    set_env("ZO_STATUS_PAGE_DOMAIN_HTTP_PORT", &main2.to_string());
    config::refresh_config().unwrap();
    let second = tokio::spawn(server::run(|_| axum::Router::new()));
    assert_eq!(wait_for(local(main2), "/healthz", 200).await.0, 200);
    let (status, text) = wait_for(local(health2), "/healthz", 503).await;
    assert!(status == 503 && text.contains("not listening"), "{text}");
    assert_eq!(domain_listener::health_state().as_str(), "not listening");
    // the TLS failure alone turns the health port to 503, so wait for both errors to be logged
    let deadline = Instant::now() + Duration::from_secs(30);
    let errors = loop {
        let errors = ERRORS.lock().unwrap().join("\n");
        let both = errors.contains("the domain TLS port could not be bound")
            && errors.contains("the domain redirect port could not be bound");
        if both || Instant::now() > deadline {
            break errors;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    assert!(
        errors.contains("the domain TLS port could not be bound"),
        "{errors}"
    );
    assert!(
        errors.contains("the domain redirect port could not be bound"),
        "{errors}"
    );
    assert!(
        !first.is_finished() && !second.is_finished(),
        "a domain port never stops a main server"
    );
    assert_eq!(plain_get(local(main2), "/healthz").await.unwrap().0, 200);
    drop(taken);
}
