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

use std::{path::PathBuf, time::Duration};

use anyhow::{Context, ensure};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use base64::{Engine, prelude::BASE64_STANDARD};
use bytes::Bytes;
use config::metrics::DB_QUERY_NUMS;
use o2_enterprise::enterprise::common::settings;
use openobserve_api_http::handler::http::router::config_routes;
use sea_orm::ConnectionTrait;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tower::ServiceExt;

const REQUESTS_PER_PHASE: usize = 20;
const TEXT_KEY: &str = "/custom_logo/text";

#[derive(Clone, Copy)]
enum Mode {
    Check,
    Node,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
struct Branding {
    custom_logo_text: String,
    custom_logo_img: Option<String>,
    custom_logo_dark_img: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum NodeCommand {
    Read,
    Set { field: BrandingField, value: String },
    Delete { field: BrandingField },
    LegacySet { field: BrandingField, value: String },
    SeedReplica,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum BrandingField {
    Text,
    Image,
    DarkImage,
}

impl BrandingField {
    fn key(self) -> &'static str {
        match self {
            Self::Text => TEXT_KEY,
            Self::Image => "/custom_logo/img",
            Self::DarkImage => "/custom_logo/dark_img",
        }
    }

    fn stored_value(self, value: String) -> Bytes {
        match self {
            Self::Text => Bytes::from(value),
            Self::Image | Self::DarkImage => Bytes::from(BASE64_STANDARD.encode(value)),
        }
    }
}

#[derive(Serialize)]
struct NodeReply {
    branding: Option<Branding>,
    metadata_reads: u64,
}

fn main() -> anyhow::Result<()> {
    let mode = match std::env::args().nth(1).as_deref() {
        None => Mode::Check,
        Some("--node") => Mode::Node,
        Some(_) => anyhow::bail!("usage: config_branding_cache [--node]"),
    };
    let previous_dir = std::env::current_dir()?;
    let data_dir = configure(mode)?;
    std::env::set_current_dir(&data_dir)?;
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            match mode {
                Mode::Check => check().await,
                Mode::Node => run_node().await,
            }
        });
    std::env::set_current_dir(previous_dir)?;
    std::fs::remove_dir_all(data_dir)?;
    result
}

fn configure(mode: Mode) -> anyhow::Result<PathBuf> {
    let primary = loopback_url("O2_BRANDING_PRIMARY_DSN", "postgresql")?;
    let replica = loopback_url("O2_BRANDING_REPLICA_DSN", "postgresql")?;
    ensure!(
        primary != replica,
        "use separate primary and replica databases"
    );
    let data_dir = std::env::temp_dir().join(format!(
        "o2-branding-check-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    std::fs::create_dir(&data_dir)?;
    let config_file = data_dir.join(".env");
    std::fs::write(&config_file, "")?;
    config::config_path_manager::set_config_file_path(config_file)?;
    let mut variables = vec![
        ("ZO_LOCAL_MODE", matches!(mode, Mode::Check).to_string()),
        ("ZO_META_STORE", "postgres".to_string()),
        ("ZO_META_POSTGRES_DSN", primary.to_string()),
        ("ZO_META_POSTGRES_RO_DSN", replica.to_string()),
        ("ZO_META_DDL_DSN", primary.to_string()),
        ("ZO_DATA_DIR", format!("{}/", data_dir.display())),
        ("ZO_DATA_DB_DIR", format!("{}/db/", data_dir.display())),
        ("O2_CUSTOM_LOGO_TEXT", "default-brand".to_string()),
        ("ZO_QUEUE_STORE", "nats".to_string()),
        ("ZO_NATS_REPLICAS", "1".to_string()),
        (
            "ZO_INSTANCE_NAME",
            format!("branding-check-{}", std::process::id()),
        ),
    ];
    if let Mode::Node = mode {
        let nats = loopback_url("O2_BRANDING_NATS_ADDR", "nats")?;
        let prefix = std::env::var("O2_BRANDING_NATS_PREFIX")?;
        ensure!(
            prefix.starts_with("o2_branding_check_"),
            "use an isolated NATS prefix"
        );
        variables.extend([
            ("ZO_NATS_ADDR", nats.to_string()),
            ("ZO_NATS_PREFIX", prefix),
            (
                "ZO_NATS_KV_WATCH_MODULES",
                match std::env::var("ZO_NATS_KV_WATCH_MODULES") {
                    Ok(value) => value,
                    Err(std::env::VarError::NotPresent) => String::new(),
                    Err(error) => return Err(error.into()),
                },
            ),
            ("ZO_NATS_USER", String::new()),
            ("ZO_NATS_PASSWORD", String::new()),
        ]);
    }
    for (key, value) in variables {
        // No runtime or background task exists while this example sets its configuration.
        unsafe { std::env::set_var(key, value) };
    }
    Ok(data_dir)
}

fn loopback_url(name: &str, scheme: &str) -> anyhow::Result<url::Url> {
    let value =
        std::env::var(name).with_context(|| format!("set {name} to a fresh local test DB"))?;
    let dsn = url::Url::parse(&value)?;
    ensure!(
        matches!(dsn.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        "{name} must point at a loopback server"
    );
    ensure!(dsn.scheme() == scheme, "{name} must use {scheme}://");
    Ok(dsn)
}

async fn check() -> anyhow::Result<()> {
    let app = bootstrap().await?;
    seed_replica().await?;
    let absent = Branding {
        custom_logo_text: "default-brand".to_string(),
        custom_logo_img: None,
        custom_logo_dark_img: None,
    };
    let before = reads();
    ensure!(
        request(&app).await? == absent,
        "cold /config did not use the primary"
    );
    ensure!(
        reads() - before == 3,
        "cold /config must read each branding key once"
    );
    println!("cold absent /config: 3 metadata SELECTs");
    cached_requests(&app, &absent, "absent").await?;

    settings::set_logo_text(Bytes::from_static(b"brand-v1")).await?;
    settings::upload_logo(b"light-v1".to_vec(), None).await?;
    settings::upload_logo(b"dark-v1".to_vec(), Some("dark".to_string())).await?;
    let configured = Branding {
        custom_logo_text: "brand-v1".to_string(),
        custom_logo_img: Some(BASE64_STANDARD.encode(b"light-v1")),
        custom_logo_dark_img: Some(BASE64_STANDARD.encode(b"dark-v1")),
    };
    settled_requests(&app, &configured, "configured").await?;
    let replica_value = infra::db::get_db().await.get(TEXT_KEY).await?;
    ensure!(
        replica_value == "stale-replica",
        "replica fixture must remain stale"
    );
    println!("replica remains stale while /config returns primary values");

    settings::set_logo_text(Bytes::from_static(b"brand-v2")).await?;
    settings::upload_logo(b"light-v2".to_vec(), None).await?;
    settings::upload_logo(b"dark-v2".to_vec(), Some("dark".to_string())).await?;
    let updated = Branding {
        custom_logo_text: "brand-v2".to_string(),
        custom_logo_img: Some(BASE64_STANDARD.encode(b"light-v2")),
        custom_logo_dark_img: Some(BASE64_STANDARD.encode(b"dark-v2")),
    };
    settled_requests(&app, &updated, "updated").await?;

    settings::delete_logo_text().await?;
    settings::delete_logo(None).await?;
    settings::delete_logo(Some("dark".to_string())).await?;
    settled_requests(&app, &absent, "deleted").await
}

async fn bootstrap() -> anyhow::Result<Router> {
    infra::db::create_table().await?;
    if !config::get_config().common.local_mode {
        infra::coordinator::events::init().await?;
    }
    settings::init_cache().await?;
    settings::init_cache().await?;
    Ok(Router::new().nest("/config", config_routes()))
}

async fn run_node() -> anyhow::Result<()> {
    let app = bootstrap().await?;
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    reply(
        &mut output,
        NodeReply {
            branding: None,
            metadata_reads: 0,
        },
    )
    .await?;
    while let Some(line) = input.next_line().await? {
        let before = reads();
        let branding = match serde_json::from_str::<NodeCommand>(&line)? {
            NodeCommand::Read => Some(request(&app).await?),
            NodeCommand::Set { field, value } => {
                set_branding(field, value).await?;
                None
            }
            NodeCommand::Delete { field } => {
                delete_branding(field).await?;
                None
            }
            NodeCommand::LegacySet { field, value } => {
                infra::db::get_db()
                    .await
                    .put(
                        field.key(),
                        field.stored_value(value),
                        infra::db::NO_NEED_WATCH,
                        None,
                    )
                    .await?;
                None
            }
            NodeCommand::SeedReplica => {
                seed_replica().await?;
                None
            }
        };
        reply(
            &mut output,
            NodeReply {
                branding,
                metadata_reads: reads() - before,
            },
        )
        .await?;
    }
    Ok(())
}

async fn reply(output: &mut tokio::io::Stdout, value: NodeReply) -> anyhow::Result<()> {
    let mut bytes = serde_json::to_vec(&value)?;
    bytes.push(b'\n');
    output.write_all(&bytes).await?;
    output.flush().await?;
    Ok(())
}

async fn set_branding(field: BrandingField, value: String) -> anyhow::Result<()> {
    match field {
        BrandingField::Text => settings::set_logo_text(Bytes::from(value)).await,
        BrandingField::Image => settings::upload_logo(value.into_bytes(), None).await,
        BrandingField::DarkImage => {
            settings::upload_logo(value.into_bytes(), Some("dark".to_string())).await
        }
    }
}

async fn delete_branding(field: BrandingField) -> anyhow::Result<()> {
    match field {
        BrandingField::Text => settings::delete_logo_text().await,
        BrandingField::Image => settings::delete_logo(None).await,
        BrandingField::DarkImage => settings::delete_logo(Some("dark".to_string())).await,
    }
}

async fn seed_replica() -> anyhow::Result<()> {
    let replica = infra::db::get_orm_client_ro().await;
    for sql in [
        "CREATE TABLE meta (module TEXT, key1 TEXT, key2 TEXT, start_dt BIGINT, value TEXT)",
        "INSERT INTO meta VALUES ('custom_logo', 'text', '', 0, 'stale-replica'), \
             ('custom_logo', 'img', '', 0, 'stale-light'), \
             ('custom_logo', 'dark_img', '', 0, 'stale-dark')",
    ] {
        replica.execute_unprepared(sql).await?;
    }
    Ok(())
}

fn reads() -> u64 {
    DB_QUERY_NUMS.with_label_values(&["select", "meta"]).get()
}

async fn request(app: &Router) -> anyhow::Result<Branding> {
    let response = app
        .clone()
        .oneshot(Request::builder().uri("/config").body(Body::empty())?)
        .await?;
    ensure!(
        response.status() == StatusCode::OK,
        "/config must return 200"
    );
    let body = to_bytes(response.into_body(), 1024 * 1024).await?;
    Ok(serde_json::from_slice(&body)?)
}

async fn cached_requests(app: &Router, expected: &Branding, phase: &str) -> anyhow::Result<()> {
    let before = reads();
    for _ in 0..REQUESTS_PER_PHASE {
        ensure!(
            &request(app).await? == expected,
            "{phase}: unexpected branding"
        );
    }
    let delta = reads() - before;
    ensure!(
        delta == 0,
        "{phase}: warm /config performed {delta} metadata SELECTs"
    );
    println!("{phase}: {REQUESTS_PER_PHASE} repeated /config requests, {delta} metadata SELECTs");
    Ok(())
}

async fn settled_requests(app: &Router, expected: &Branding, phase: &str) -> anyhow::Result<()> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if &request(app).await? == expected {
                let before = reads();
                for _ in 0..REQUESTS_PER_PHASE {
                    ensure!(&request(app).await? == expected, "{phase}: stale branding");
                }
                if reads() == before {
                    println!("{phase}: {REQUESTS_PER_PHASE} repeated /config requests, 0 metadata SELECTs");
                    return Ok::<_, anyhow::Error>(());
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await??;
    Ok(())
}
