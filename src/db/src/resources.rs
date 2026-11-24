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

use std::str::FromStr;

use anyhow::{Context, Result, anyhow, bail, ensure};
use config::meta::{
    meta_store::MetaStore,
    resources::{ResourceAlertType, ResourceKind, ResourceRoute, ResourceSummary, SummaryPage},
    self_reporting::ai_chat::is_protected_ai_chat_stream,
};
use infra::{
    db::{Event, get_orm_client_rw},
    table::folders::folder_type_from_i16,
};
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};
use serde::Deserialize;
use tokio::sync::mpsc;

const MAX_PAGE_SIZE: usize = 1000;
// Alert attributes are read only to derive the SIEM marker.
const MAX_ROW_TEXT: usize = 256 * 1024;
pub const PAGE_SIZE: usize = 512;
// Key prefixes parse_event_key maps to catalog changes.
const EVENT_PREFIXES: [&str; 12] = [
    "/alert_composites/",
    "/anomaly_detection/config/",
    "/folders/",
    "/dashboards/",
    "/alerts/",
    "/function/",
    "/schema/",
    "/synthetics/check/",
    "/pipelines/",
    "/user_record/",
    "/org_users/",
    "/user_bulk_refresh/",
];

struct SourceRead {
    sql: String,
    values: Vec<Value>,
}

impl SourceRead {
    fn page(org: &str, kind: ResourceKind, after: Option<&str>, limit: usize) -> Result<Self> {
        ensure!(
            (1..=MAX_PAGE_SIZE).contains(&limit),
            "invalid source page size"
        );
        Ok(Self {
            sql: format!(
                "SELECT {} FROM ({}) AS r WHERE id > $2 ORDER BY id LIMIT $3",
                summary_columns(),
                selection(kind)?
            ),
            values: vec![
                org.into(),
                after.unwrap_or("").into(),
                (limit as i64).into(),
            ],
        })
    }

    fn statement<C: ConnectionTrait>(&self, conn: &C) -> Statement {
        Statement::from_sql_and_values(
            conn.get_database_backend(),
            self.sql.clone(),
            self.values.clone(),
        )
    }
}

/// The catalog entries an event makes stale; no org means every org.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceChange {
    pub org: Option<String>,
    pub kinds: Vec<ResourceKind>,
}

impl ResourceChange {
    pub fn covers(&self, org: &str, kind: ResourceKind) -> bool {
        self.org.as_deref().is_none_or(|own| own == org) && self.kinds.contains(&kind)
    }
}

pub struct ResourceEvents {
    receiver: mpsc::Receiver<Event>,
}

impl ResourceEvents {
    pub async fn next(&mut self) -> Result<ResourceChange> {
        loop {
            let event = self
                .receiver
                .recv()
                .await
                .context("resource subscription closed")?;
            let key = match event {
                Event::Put(data) | Event::Delete(data) => data.key,
                Event::Empty => continue,
            };
            match parse_event_key(&key) {
                Ok(Some(change)) => return Ok(change),
                Ok(None) => {}
                Err(error) => {
                    log::warn!(
                        "[RESOURCE SEARCH] marking every catalog stale on event {key}: {error}"
                    );
                    return Ok(ResourceChange {
                        org: None,
                        kinds: ResourceKind::ALL.into(),
                    });
                }
            }
        }
    }
}

#[derive(Debug, FromQueryResult)]
struct SummaryRow {
    id: String,
    name: String,
    folder_id: Option<String>,
    folder_name: Option<String>,
    enabled: Option<bool>,
    attributes: Option<String>,
    alert_type: Option<String>,
    oversized: bool,
}

impl SummaryRow {
    fn stream(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            name: id.to_owned(),
            folder_id: None,
            folder_name: None,
            enabled: None,
            attributes: None,
            alert_type: None,
            oversized: false,
        }
    }

    /// A row that cannot be parsed is skipped with a warning so it never hides the rest of its
    /// kind.
    fn into_summary(self, org: &str, kind: ResourceKind) -> Option<ResourceSummary> {
        if self.oversized {
            log::warn!(
                "[RESOURCE SEARCH] skipping {kind} {} in {org}: source text exceeds {MAX_ROW_TEXT} characters",
                self.id
            );
            return None;
        }
        let parsed = self.route(kind).and_then(|route| {
            let is_siem = self.attributes.as_deref().map(siem_marker).transpose()?;
            Ok(route.map(|route| (route, is_siem.unwrap_or(false))))
        });
        let ((id, name, route_ref), is_siem) = match parsed {
            Ok(parsed) => parsed?,
            Err(error) => {
                log::warn!(
                    "[RESOURCE SEARCH] skipping {kind} {} in {org}: {error:#}",
                    self.id
                );
                return None;
            }
        };
        let email =
            matches!(kind, ResourceKind::User | ResourceKind::ServiceAccount).then(|| id.clone());
        Some(ResourceSummary {
            kind,
            name: if name.trim().is_empty() {
                id.clone()
            } else {
                name
            },
            id,
            folder_id: self.folder_id,
            folder_name: self.folder_name,
            route_ref,
            enabled: self.enabled,
            email,
            is_siem,
        })
    }

    fn route(&self, kind: ResourceKind) -> Result<Option<(String, String, ResourceRoute)>> {
        let id = self.id.clone();
        let route = match kind {
            ResourceKind::Dashboard => ResourceRoute::Dashboard {
                dashboard_id: id.clone(),
                folder_id: self.folder()?,
            },
            ResourceKind::Alert => ResourceRoute::Alert {
                alert_id: id.clone(),
                folder_id: self.folder()?,
                alert_type: self.alert_type()?,
            },
            ResourceKind::Synthetic => ResourceRoute::Synthetic {
                check_id: id.clone(),
                folder_id: self.folder()?,
            },
            ResourceKind::Stream => return stream_route(&id),
            ResourceKind::Function => ResourceRoute::Function {
                function_name: id.clone(),
            },
            ResourceKind::Pipeline => ResourceRoute::Pipeline {
                pipeline_id: id.clone(),
            },
            ResourceKind::User | ResourceKind::ServiceAccount => {
                ResourceRoute::User { email: id.clone() }
            }
        };
        Ok(Some((id, self.name.clone(), route)))
    }

    fn alert_type(&self) -> Result<ResourceAlertType> {
        match self.alert_type.as_deref() {
            Some("scheduled") => Ok(ResourceAlertType::Scheduled),
            Some("realtime") => Ok(ResourceAlertType::Realtime),
            Some("composite") => Ok(ResourceAlertType::Composite),
            Some("anomaly_detection") => Ok(ResourceAlertType::AnomalyDetection),
            _ => bail!("invalid alert subtype"),
        }
    }

    fn folder(&self) -> Result<String> {
        self.folder_id
            .clone()
            .filter(|id| !id.is_empty())
            .context("resource folder missing")
    }
}

#[derive(Deserialize)]
struct SiemAttributes {
    siem: Option<String>,
}

pub async fn subscribe() -> Result<ResourceEvents> {
    let coordinator = infra::db::get_coordinator().await;
    let mut receivers = vec![coordinator.watch("/").await?];
    // NATS writes keys under KV-watched modules only to KV, never to the events stream.
    if !config::get_config().common.local_mode {
        for prefix in kv_watched_prefixes(config::NATS_KV_WATCH_MODULES.iter()) {
            receivers.push(coordinator.watch(prefix).await?);
        }
    }
    let mut receivers = receivers
        .into_iter()
        .map(|receiver| {
            std::sync::Arc::try_unwrap(receiver)
                .map_err(|_| anyhow!("resource subscription unexpectedly shared"))
        })
        .collect::<Result<Vec<_>>>()?;
    let receiver = match receivers.pop() {
        Some(receiver) if receivers.is_empty() => receiver,
        last => merge(receivers.into_iter().chain(last)),
    };
    Ok(ResourceEvents { receiver })
}

pub async fn load_page(
    org: &str,
    kind: ResourceKind,
    after: Option<&str>,
    limit: usize,
) -> Result<SummaryPage> {
    if kind == ResourceKind::Stream {
        let schemas = infra::schema::STREAM_SCHEMAS_LATEST.read().await;
        return stream_page(org, schemas.keys(), after, limit);
    }
    require_sql_store()?;
    load_page_with(get_orm_client_rw().await, org, kind, after, limit).await
}

fn require_sql_store() -> Result<()> {
    let cfg = config::get_config();
    let store = MetaStore::from_str(&cfg.common.meta_store).map_err(anyhow::Error::msg)?;
    ensure!(
        matches!(store, MetaStore::Sqlite | MetaStore::PostgreSQL),
        "resource catalog requires a SQL metadata store"
    );
    Ok(())
}

async fn load_page_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    kind: ResourceKind,
    after: Option<&str>,
    limit: usize,
) -> Result<SummaryPage> {
    let read = SourceRead::page(org, kind, after, limit)?;
    let rows = SummaryRow::find_by_statement(read.statement(conn))
        .all(conn)
        .await?;
    let next = (rows.len() == limit).then(|| rows[limit - 1].id.clone());
    let items = rows
        .into_iter()
        .filter_map(|row| row.into_summary(org, kind))
        .collect();
    Ok(SummaryPage { items, next })
}

/// Pages one org's logs, metrics and traces streams out of `org/type/name` schema cache keys.
fn stream_page<'a>(
    org: &str,
    keys: impl Iterator<Item = &'a String>,
    after: Option<&str>,
    limit: usize,
) -> Result<SummaryPage> {
    ensure!(
        (1..=MAX_PAGE_SIZE).contains(&limit),
        "invalid source page size"
    );
    let prefix = format!("{org}/");
    let mut ids = keys
        .filter_map(|key| key.strip_prefix(&prefix))
        .filter(|id| {
            id.split_once('/')
                .is_some_and(|(signal, _)| matches!(signal, "logs" | "metrics" | "traces"))
                && after.is_none_or(|after| *id > after)
        })
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids.truncate(limit);
    let next = (ids.len() == limit).then(|| ids[limit - 1].to_owned());
    let items = ids
        .into_iter()
        .filter_map(|id| SummaryRow::stream(id).into_summary(org, ResourceKind::Stream))
        .collect();
    Ok(SummaryPage { items, next })
}

fn summary_columns() -> String {
    format!(
        "id,name,folder_id,folder_name,enabled,\
         CASE WHEN length(attributes) <= {MAX_ROW_TEXT} THEN attributes END AS attributes,alert_type,\
         COALESCE(length(attributes),0) > {MAX_ROW_TEXT} AS oversized"
    )
}

fn selection(kind: ResourceKind) -> Result<&'static str> {
    Ok(match kind {
        ResourceKind::Dashboard => {
            "SELECT d.dashboard_id AS id,d.title AS name,f.folder_id,f.name AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS alert_type FROM dashboards d JOIN folders f ON f.id=d.folder_id WHERE f.org=$1 AND f.type=0"
        }
        ResourceKind::Alert => {
            "SELECT a.id,a.name,f.folder_id,f.name AS folder_name,a.enabled,CAST(a.context_attributes AS TEXT) AS attributes,CASE WHEN a.is_real_time THEN 'realtime' ELSE 'scheduled' END AS alert_type FROM alerts a JOIN folders f ON f.id=a.folder_id WHERE a.org=$1 AND f.org=$1 AND f.type=1 UNION ALL SELECT a.id,a.name,f.folder_id,f.name AS folder_name,a.enabled,CAST(a.context_attributes AS TEXT) AS attributes,'composite' AS alert_type FROM alert_composites a JOIN folders f ON f.folder_id=a.folder_id AND f.org=a.org AND f.type=1 WHERE a.org=$1 UNION ALL SELECT a.anomaly_id AS id,a.name,f.folder_id,f.name AS folder_name,a.enabled,NULL AS attributes,'anomaly_detection' AS alert_type FROM anomaly_detection_config a JOIN folders f ON f.id=a.folder_id WHERE a.org_id=$1 AND f.org=$1 AND f.type=1"
        }
        ResourceKind::Stream => bail!("streams are read from the schema cache"),
        ResourceKind::Function => {
            "SELECT DISTINCT key2 AS id,key2 AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS alert_type FROM meta WHERE module='function' AND key1=$1"
        }
        ResourceKind::Pipeline => {
            "SELECT id,name,NULL AS folder_id,NULL AS folder_name,enabled,NULL AS attributes,NULL AS alert_type FROM pipeline WHERE org=$1 AND kind='user'"
        }
        ResourceKind::Synthetic => {
            "SELECT s.id,s.name,f.folder_id,f.name AS folder_name,s.enabled,NULL AS attributes,NULL AS alert_type FROM synthetics s JOIN folders f ON f.id=s.folder_id WHERE s.org_id=$1 AND f.org=$1 AND f.type=3"
        }
        ResourceKind::User => {
            "SELECT u.email AS id,trim(u.first_name || ' ' || u.last_name) AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS alert_type FROM org_users o JOIN users u ON u.email=o.email WHERE o.org_id=$1 AND o.role NOT IN (5,6)"
        }
        ResourceKind::ServiceAccount => {
            "SELECT u.email AS id,trim(u.first_name || ' ' || u.last_name) AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS alert_type FROM org_users o JOIN users u ON u.email=o.email WHERE o.org_id=$1 AND o.role IN (5,6)"
        }
    })
}

fn stream_route(key: &str) -> Result<Option<(String, String, ResourceRoute)>> {
    let mut parts = key.split('/');
    let signal = parts.next().context("stream type missing")?;
    let name = parts
        .next()
        .filter(|s| !s.is_empty())
        .context("stream name missing")?;
    if let Some(version) = parts.next() {
        ensure!(
            version.parse::<i64>().is_ok() && parts.next().is_none(),
            "invalid schema version key"
        );
    }
    if is_protected_ai_chat_stream(name) {
        return Ok(None);
    }
    ensure!(
        matches!(signal, "logs" | "metrics" | "traces"),
        "invalid stream type"
    );
    Ok(Some((
        format!("{signal}/{name}"),
        name.to_owned(),
        ResourceRoute::Stream {
            stream_type: signal.to_owned(),
            stream_name: name.to_owned(),
        },
    )))
}

fn siem_marker(value: &str) -> Result<bool> {
    let attributes: SiemAttributes =
        serde_json::from_str(value).context("invalid alert attributes")?;
    Ok(attributes.siem.as_deref() == Some("true"))
}

fn kv_watched_prefixes<'a>(modules: impl Iterator<Item = &'a String>) -> Vec<&'a str> {
    modules
        .map(String::as_str)
        .filter(|module| {
            EVENT_PREFIXES
                .iter()
                .any(|prefix| module.starts_with(prefix) || prefix.starts_with(module))
        })
        .collect()
}

fn merge(receivers: impl Iterator<Item = mpsc::Receiver<Event>>) -> mpsc::Receiver<Event> {
    let (tx, rx) = mpsc::channel(1024);
    for mut receiver in receivers {
        let tx = tx.clone();
        tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                if tx.send(event).await.is_err() {
                    return;
                }
            }
        });
    }
    rx
}

fn parse_event_key(key: &str) -> Result<Option<ResourceChange>> {
    const ACCOUNTS: [ResourceKind; 2] = [ResourceKind::User, ResourceKind::ServiceAccount];
    let parts = key.trim_start_matches('/').split('/').collect::<Vec<_>>();
    match parts.as_slice() {
        ["folders", org, folder_type, folder_id] => {
            let folder_type = folder_type
                .parse()
                .ok()
                .and_then(folder_type_from_i16)
                .context("invalid folder type")?;
            match ResourceKind::from_folder_type(folder_type) {
                Some(kind) => scoped(org, folder_id, &[kind]),
                None => Ok(None),
            }
        }
        ["alerts", org, id]
        | ["alert_composites", org, id]
        | ["anomaly_detection", "config", org, id] => scoped(org, id, &[ResourceKind::Alert]),
        ["dashboards", org, id] => scoped(org, id, &[ResourceKind::Dashboard]),
        ["function", org, rest @ ..] => scoped(org, &rest.join("/"), &[ResourceKind::Function]),
        ["schema", org, _, name, ..] => scoped(org, name, &[ResourceKind::Stream]),
        ["synthetics", "check", org, id] => scoped(org, id, &[ResourceKind::Synthetic]),
        ["org_users", "single", org, email] => scoped(org, email, &ACCOUNTS),
        ["pipelines", _] => Ok(Some(ResourceChange {
            org: None,
            kinds: vec![ResourceKind::Pipeline],
        })),
        ["user_record", _] | ["org_users", "many", "user", _] | ["user_bulk_refresh", ""] => {
            Ok(Some(ResourceChange {
                org: None,
                kinds: ACCOUNTS.into(),
            }))
        }
        [
            "dashboards" | "alerts" | "alert_composites" | "folders" | "function" | "schema"
            | "pipelines" | "user_record" | "org_users",
            ..,
        ]
        | ["anomaly_detection", "config", ..]
        | ["synthetics", "check", ..] => bail!("malformed resource event"),
        _ => Ok(None),
    }
}

fn scoped(org: &str, id: &str, kinds: &[ResourceKind]) -> Result<Option<ResourceChange>> {
    ensure!(
        !org.is_empty() && !id.is_empty(),
        "empty resource event identity"
    );
    Ok(Some(ResourceChange {
        org: Some(org.into()),
        kinds: kinds.into(),
    }))
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, IntoActiveModel, Schema, Set};

    use super::*;

    async fn fixture() -> DatabaseConnection {
        let conn = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE folders (id TEXT PRIMARY KEY,org TEXT,type INTEGER,folder_id TEXT,name TEXT)",
            "CREATE TABLE dashboards (dashboard_id TEXT,folder_id TEXT,title TEXT,data TEXT)",
            "CREATE TABLE alerts (id TEXT,org TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN,is_real_time BOOLEAN,context_attributes TEXT)",
            "CREATE TABLE alert_composites (id TEXT,org TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN,context_attributes TEXT)",
            "CREATE TABLE anomaly_detection_config (anomaly_id TEXT,org_id TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN)",
            "CREATE TABLE pipeline (id TEXT,org TEXT,name TEXT,enabled BOOLEAN,kind TEXT)",
            "CREATE TABLE users (email TEXT,first_name TEXT,last_name TEXT)",
            "CREATE TABLE org_users (email TEXT,org_id TEXT,role INTEGER)",
            "CREATE TABLE meta (module TEXT,key1 TEXT,key2 TEXT,start_dt BIGINT,value TEXT)",
            "INSERT INTO folders VALUES ('pk1','org',0,'public1','Production'),('pk2','org',0,'public2','Staging'),('pk3','other',0,'other','Hidden'),('pa','org',1,'alerts','Alert folder'),('ps','org',3,'synthetics','Probe folder')",
        ] {
            conn.execute_unprepared(sql).await.unwrap();
        }
        conn
    }

    #[tokio::test]
    async fn dashboard_projection_pages_by_id_without_reading_body() {
        let conn = fixture().await;
        conn.execute_unprepared("INSERT INTO dashboards VALUES ('a','pk1','Alpha','malformed JSON'),('b','pk2','Beta','body'),('c','pk3','Other org','body')").await.unwrap();
        let page = load_page_with(&conn, "org", ResourceKind::Dashboard, None, 1)
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "a");
        assert_eq!(page.items[0].folder_id.as_deref(), Some("public1"));
        let next = load_page_with(
            &conn,
            "org",
            ResourceKind::Dashboard,
            page.next.as_deref(),
            1,
        )
        .await
        .unwrap();
        assert_eq!(next.items[0].id, "b");
        let end = load_page_with(
            &conn,
            "org",
            ResourceKind::Dashboard,
            next.next.as_deref(),
            1,
        )
        .await
        .unwrap();
        assert!(end.items.is_empty() && end.next.is_none());
    }

    #[tokio::test]
    async fn alert_projection_unions_subtypes_and_retains_siem_filter_metadata() {
        let conn = fixture().await;
        for sql in [
            "INSERT INTO alerts VALUES ('a','org','pa','Ordinary',false,false,'{\"siem\":\"true\"}')",
            "INSERT INTO alert_composites VALUES ('b','org','alerts','Composite',true,NULL)",
            "INSERT INTO anomaly_detection_config VALUES ('c','org','pa','Anomaly',false)",
            "INSERT INTO alerts VALUES ('z','other','pa','Not owned',true,false,NULL)",
        ] {
            conn.execute_unprepared(sql).await.unwrap();
        }
        let page = load_page_with(&conn, "org", ResourceKind::Alert, None, 20)
            .await
            .unwrap();
        assert_eq!(
            page.items.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
        assert!(page.items[0].is_siem);
        assert!(!page.items[1].is_siem);
        assert!(
            page.items
                .iter()
                .all(|r| r.folder_id.as_deref() == Some("alerts"))
        );
    }

    #[tokio::test]
    async fn function_pages_use_exact_org_boundaries() {
        let conn = fixture().await;
        conn.execute_unprepared(
            "INSERT INTO meta VALUES ('function','org','Alpha',0,'not VRL'),('function','org2','Leaked',0,'body')",
        )
        .await
        .unwrap();
        let functions = load_page_with(&conn, "org", ResourceKind::Function, None, 20)
            .await
            .unwrap();
        assert_eq!(functions.items.len(), 1);
    }

    #[test]
    fn stream_pages_come_from_cache_keys_of_one_org() {
        let keys = [
            "org/traces/payment",
            "org/logs/payment",
            "org/logs/_o2_ai_chat_events",
            "org/enrichment_tables/lookup",
            "org/metrics/cpu",
            "org2/logs/leaked",
            "orgx/logs/leaked",
        ]
        .map(String::from);
        let ids = |page: &SummaryPage| page.items.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
        let first = stream_page("org", keys.iter(), None, 2).unwrap();
        assert_eq!(ids(&first), ["logs/payment"]);
        assert_eq!(first.next.as_deref(), Some("logs/payment"));
        let rest = stream_page("org", keys.iter(), first.next.as_deref(), 2).unwrap();
        assert_eq!(ids(&rest), ["metrics/cpu", "traces/payment"]);
        assert_eq!(rest.items[1].name, "payment");
        let end = stream_page("org", keys.iter(), rest.next.as_deref(), 2).unwrap();
        assert!(end.items.is_empty() && end.next.is_none());
    }

    #[tokio::test]
    async fn safe_projections_keep_disabled_user_pipelines_and_separate_account_roles() {
        let conn = fixture().await;
        for sql in [
            "INSERT INTO pipeline VALUES ('user','org','Disabled',false,'user'),('internal','org','Internal',true,'evaluation')",
            "INSERT INTO users VALUES ('a@x','A',''),('sa@x','S','')",
            "INSERT INTO org_users VALUES ('a@x','org',4),('sa@x','org',5)",
        ] {
            conn.execute_unprepared(sql).await.unwrap();
        }
        let pipelines = load_page_with(&conn, "org", ResourceKind::Pipeline, None, 20)
            .await
            .unwrap();
        assert_eq!(pipelines.items.len(), 1);
        assert_eq!(pipelines.items[0].enabled, Some(false));
        let humans = load_page_with(&conn, "org", ResourceKind::User, None, 20)
            .await
            .unwrap();
        assert_eq!(humans.items.len(), 1);
        let accounts = load_page_with(&conn, "org", ResourceKind::ServiceAccount, None, 20)
            .await
            .unwrap();
        assert_eq!(accounts.items.len(), 1);
        assert!(
            load_page_with(&conn, "org' OR 1=1 --", ResourceKind::User, None, 20)
                .await
                .unwrap()
                .items
                .is_empty()
        );
    }

    #[tokio::test]
    async fn synthetic_projection_uses_the_actual_entity_schema_without_secret_columns() {
        use infra::table::entity::{folders, synthetics_checks};

        let conn = Database::connect("sqlite::memory:").await.unwrap();
        let backend = conn.get_database_backend();
        let schema = Schema::new(backend);
        for statement in [
            schema.create_table_from_entity(folders::Entity),
            schema.create_table_from_entity(synthetics_checks::Entity),
        ] {
            conn.execute(backend.build(&statement)).await.unwrap();
        }
        folders::ActiveModel {
            id: Set("folder-primary-key".into()),
            org: Set("org".into()),
            folder_id: Set("public-folder".into()),
            name: Set("Probe folder".into()),
            description: Set(None),
            icon: Set(None),
            r#type: Set(3),
        }
        .insert(&conn)
        .await
        .unwrap();
        synthetics_checks::Model {
            id: "check".into(),
            org_id: "org".into(),
            folder_id: "folder-primary-key".into(),
            name: "Probe".into(),
            enabled: false,
            target: "target".into(),
            secrets: "secret".into(),
            ..Default::default()
        }
        .into_active_model()
        .insert(&conn)
        .await
        .unwrap();
        let page = load_page_with(&conn, "org", ResourceKind::Synthetic, None, 20)
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        let check = &page.items[0];
        assert_eq!(check.folder_id.as_deref(), Some("public-folder"));
        assert_eq!(
            check.route_ref,
            ResourceRoute::Synthetic {
                check_id: "check".into(),
                folder_id: "public-folder".into()
            }
        );
        let json = serde_json::to_value(check).unwrap();
        assert!(json.get("secrets").is_none() && json.get("target").is_none());
    }

    #[tokio::test]
    async fn oversized_alert_attributes_are_skipped_without_reading_them() {
        let conn = fixture().await;
        conn.execute_unprepared(
            "INSERT INTO alerts VALUES ('alert','org','pa','Alert',true,false,'{}')",
        )
        .await
        .unwrap();
        conn.execute_unprepared("UPDATE alerts SET context_attributes='{\"large\":\"' || replace(hex(zeroblob(262144)),'00','x') || '\"}'").await.unwrap();
        let read = SourceRead::page("org", ResourceKind::Alert, None, 20).unwrap();
        let raw = SummaryRow::find_by_statement(read.statement(&conn))
            .all(&conn)
            .await
            .unwrap();
        assert!(
            raw.iter()
                .all(|row| row.oversized && row.attributes.is_none())
        );
        let loaded = load_page_with(&conn, "org", ResourceKind::Alert, None, 20)
            .await
            .unwrap();
        assert!(loaded.items.is_empty());
        assert!(loaded.next.is_none());
    }

    #[test]
    fn kv_watched_modules_that_overlap_catalog_events_are_subscribed() {
        let modules = ["/dashboards/", "/folders/", "/nodes/", "/schema/org1/"].map(String::from);
        assert_eq!(
            kv_watched_prefixes(modules.iter()),
            ["/dashboards/", "/folders/", "/schema/org1/"]
        );
    }

    #[tokio::test]
    async fn merged_receivers_forward_every_source() {
        let (a, ra) = mpsc::channel(1);
        let (b, rb) = mpsc::channel(1);
        let mut merged = merge([ra, rb].into_iter());
        for (sender, key) in [(&a, "/a"), (&b, "/b")] {
            sender
                .send(Event::Put(infra::db::EventData {
                    key: key.into(),
                    value: None,
                    start_dt: None,
                }))
                .await
                .unwrap();
        }
        let mut keys = Vec::new();
        for _ in 0..2 {
            if let Some(Event::Put(data)) = merged.recv().await {
                keys.push(data.key);
            }
        }
        keys.sort_unstable();
        assert_eq!(keys, ["/a", "/b"]);
    }

    #[tokio::test]
    async fn subscription_distinguishes_empty_explicit_gap_malformed_and_closed_channel() {
        let (sender, receiver) = mpsc::channel(4);
        sender.send(Event::Empty).await.unwrap();
        for key in ["/dashboards/malformed", "/dashboards/org/d1"] {
            sender
                .send(Event::Put(infra::db::EventData {
                    key: key.into(),
                    value: None,
                    start_dt: None,
                }))
                .await
                .unwrap();
        }
        drop(sender);
        let mut events = ResourceEvents { receiver };
        let all = events.next().await.unwrap();
        assert!(all.org.is_none() && all.kinds.len() == ResourceKind::ALL.len());
        assert_eq!(
            events.next().await.unwrap(),
            ResourceChange {
                org: Some("org".into()),
                kinds: vec![ResourceKind::Dashboard],
            }
        );
        assert!(events.next().await.is_err());
    }

    #[test]
    fn event_parser_marks_scopes_without_using_payload() {
        let change = |key| parse_event_key(key).unwrap().unwrap();
        assert!(change("/dashboards/org/id").covers("org", ResourceKind::Dashboard));
        assert!(!change("/dashboards/org/id").covers("other", ResourceKind::Dashboard));
        assert!(change("/pipelines/id").covers("any", ResourceKind::Pipeline));
        let account = change("/user_record/u@example.invalid");
        assert!(account.covers("any", ResourceKind::User));
        assert!(account.covers("any", ResourceKind::ServiceAccount));
        assert_eq!(
            change("/folders/org/1/ops"),
            ResourceChange {
                org: Some("org".into()),
                kinds: vec![ResourceKind::Alert],
            }
        );
        assert!(parse_event_key("/folders/org/6/ops").unwrap().is_none());
        assert!(parse_event_key("/folders/org/x/ops").is_err());
        for key in [
            "/alert_composites/org/c1",
            "/anomaly_detection/config/org/c1",
        ] {
            assert!(change(key).covers("org", ResourceKind::Alert));
        }
        assert!(
            parse_event_key("/anomaly_detection/write_intent/w1")
                .unwrap()
                .is_none()
        );
        assert!(parse_event_key("/unrelated/org/id").unwrap().is_none());
        assert!(parse_event_key("/dashboards/malformed").is_err());
    }

    #[test]
    fn every_kind_has_an_event_that_marks_it_stale() {
        // A kind without an event key is only rebuilt when its snapshot ages out.
        for kind in ResourceKind::ALL {
            let key = match kind {
                ResourceKind::Dashboard => "/dashboards/org/d1",
                ResourceKind::Alert => "/alerts/org/a1",
                ResourceKind::Stream => "/schema/org/logs/s1",
                ResourceKind::Function => "/function/org/f1",
                ResourceKind::Pipeline => "/pipelines/p1",
                ResourceKind::Synthetic => "/synthetics/check/org/c1",
                ResourceKind::User | ResourceKind::ServiceAccount => "/org_users/single/org/u@x",
            };
            let change = parse_event_key(key).unwrap().unwrap();
            assert!(change.covers("org", kind), "{kind} is not marked by {key}");
        }
    }
}
