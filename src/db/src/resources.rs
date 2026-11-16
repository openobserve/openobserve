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

use std::{collections::VecDeque, str::FromStr};

use anyhow::{Context, Result, anyhow, bail, ensure};
use config::meta::{
    meta_store::MetaStore,
    resources::{ResourceAlertType, ResourceKind, ResourceRoute, ResourceSummary, SummaryPage},
    self_reporting::ai_chat::is_protected_ai_chat_stream,
};
use infra::db::{Event, get_orm_client_rw};
use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement, Value};
use serde::Deserialize;
use tokio::sync::mpsc;

const COLUMNS: &str = "id,name,folder_id,folder_name,enabled,attributes,payload,alert_type";
const MAX_PAGE_SIZE: usize = 1000;
// Driver rows, decoding, and routed summary strings can coexist during conversion.
const SOURCE_COPIES: usize = 8;
const SUMMARY_STRINGS: &[&str] = &[
    "id",
    "name",
    "folder_id",
    "folder_name",
    "attributes",
    "payload",
    "alert_type",
];
const FOLDER_STRINGS: &[&str] = &["id", "folder_id", "name"];

#[derive(Debug, thiserror::Error)]
#[error("resource source requires {required_bytes} bytes of construction memory")]
pub struct ResourceExhausted {
    pub required_bytes: usize,
}

struct SourceRead {
    sql: String,
    values: Vec<Value>,
    columns: &'static str,
    strings: &'static [&'static str],
    overhead: usize,
}

impl SourceRead {
    fn page(org: &str, kind: ResourceKind, after: Option<&str>, limit: usize) -> Result<Self> {
        ensure!(
            (1..=MAX_PAGE_SIZE).contains(&limit),
            "invalid source page size"
        );
        Ok(Self {
            sql: format!(
                "SELECT {COLUMNS} FROM ({}) AS r WHERE id > $2 ORDER BY id LIMIT $3",
                selection(kind)
            ),
            values: vec![
                org.into(),
                after.unwrap_or("").into(),
                (limit as i64).into(),
            ],
            columns: COLUMNS,
            strings: SUMMARY_STRINGS,
            overhead: std::mem::size_of::<SummaryRow>() + std::mem::size_of::<ResourceSummary>(),
        })
    }

    fn refresh(org: &str, kind: ResourceKind, id: &str) -> Self {
        let key = if kind == ResourceKind::SavedView {
            format!("{org}/{id}")
        } else {
            id.to_owned()
        };
        let predicate = if kind == ResourceKind::Stream {
            "id = $2 OR substr(id, 1, $3) = $4"
        } else {
            "id = $2"
        };
        let mut values = vec![org.into(), key.clone().into()];
        if kind == ResourceKind::Stream {
            let prefix = format!("{key}/");
            values.extend([(prefix.chars().count() as i64).into(), prefix.into()]);
        }
        Self {
            sql: format!(
                "SELECT {COLUMNS} FROM ({}) AS r WHERE {predicate} ORDER BY id LIMIT 1",
                selection(kind)
            ),
            values,
            columns: COLUMNS,
            strings: SUMMARY_STRINGS,
            overhead: std::mem::size_of::<SummaryRow>() + std::mem::size_of::<ResourceSummary>(),
        }
    }

    fn folders(org: &str, after: Option<&str>, limit: usize) -> Result<Self> {
        ensure!(
            (1..=MAX_PAGE_SIZE).contains(&limit),
            "invalid folder page size"
        );
        Ok(Self {sql:"SELECT id,folder_id,name,type AS kind FROM folders WHERE org=$1 AND type IN (0,1,3) AND id>$2 ORDER BY id LIMIT $3".into(),
            values:vec![org.into(),after.unwrap_or("").into(),(limit as i64).into()],
            columns:"id,folder_id,name,kind",strings:FOLDER_STRINGS,
            overhead:std::mem::size_of::<FolderRow>()+std::mem::size_of::<(ResourceKind,String,String)>()})
    }

    fn byte_cost(&self, backend: DbBackend) -> Result<String> {
        let mut costs = vec![format!("CAST({} AS BIGINT)", self.overhead)];
        for column in self.strings {
            let length = match backend {
                DbBackend::Sqlite => format!("length(CAST({column} AS BLOB))"),
                DbBackend::Postgres => format!("octet_length(CAST({column} AS TEXT))"),
                _ => bail!("unsupported resource source database"),
            };
            costs.push(format!("COALESCE({length},0)"));
        }
        Ok(format!("({})*{SOURCE_COPIES}", costs.join("+")))
    }

    async fn scratch_bytes<C: ConnectionTrait>(&self, conn: &C) -> Result<usize> {
        let cost = self.byte_cost(conn.get_database_backend())?;
        let sql = format!(
            "SELECT CAST(COALESCE(SUM({cost}),0) AS BIGINT) AS required_bytes FROM ({}) AS source_page",
            self.sql
        );
        let row = conn
            .query_one(Statement::from_sql_and_values(
                conn.get_database_backend(),
                sql,
                self.values.clone(),
            ))
            .await?
            .context("source memory estimate missing")?;
        byte_count(row.try_get("", "required_bytes")?)
    }

    fn bounded_statement<C: ConnectionTrait>(
        &self,
        conn: &C,
        max_bytes: usize,
    ) -> Result<Statement> {
        let cost = self.byte_cost(conn.get_database_backend())?;
        let parameter = self.values.len() + 1;
        let columns=self.columns.split(',').map(|column| {
            if !self.strings.contains(&column) {return column.to_owned()}
            let fallback=if column=="id"||column=="name"||self.columns=="id,folder_id,name,kind" {"''"} else {"NULL"};
            format!("CASE WHEN required_bytes <= ${parameter} THEN {column} ELSE {fallback} END AS {column}")
        }).collect::<Vec<_>>().join(",");
        let sql = format!(
            "WITH source_page AS ({}),checked_page AS (SELECT source_page.*,CAST(SUM({cost}) OVER () AS BIGINT) AS required_bytes FROM source_page) SELECT {columns},required_bytes FROM checked_page ORDER BY checked_page.id",
            self.sql
        );
        let mut values = self.values.clone();
        values.push(i64::try_from(max_bytes).unwrap_or(i64::MAX).into());
        Ok(Statement::from_sql_and_values(
            conn.get_database_backend(),
            sql,
            values,
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceChange {
    Resource {
        org: String,
        kind: ResourceKind,
        id: String,
    },
    GlobalResource {
        kind: ResourceKind,
        id: String,
    },
    Folder {
        org: String,
    },
    Scope {
        org: Option<String>,
        kinds: Vec<ResourceKind>,
    },
    InvalidateAll,
}

pub struct ResourceEvents {
    receiver: mpsc::Receiver<Event>,
    pending: VecDeque<ResourceChange>,
}

impl ResourceEvents {
    pub async fn next(&mut self) -> Result<ResourceChange> {
        loop {
            if let Some(change) = self.pending.pop_front() {
                return Ok(change);
            }
            let event = self
                .receiver
                .recv()
                .await
                .context("resource subscription closed")?;
            let key = match event {
                Event::Put(data) | Event::Delete(data) => data.key,
                Event::Empty => continue,
            };
            self.pending.extend(parse_event_key(&key)?);
        }
    }
}

#[derive(Debug)]
pub struct FolderPage {
    pub items: Vec<(ResourceKind, String, String)>,
    pub next: Option<String>,
}

#[derive(Debug, FromQueryResult)]
struct FolderRow {
    id: String,
    folder_id: String,
    name: String,
    kind: i16,
    required_bytes: i64,
}

#[derive(Debug, FromQueryResult)]
struct SummaryRow {
    id: String,
    name: String,
    folder_id: Option<String>,
    folder_name: Option<String>,
    enabled: Option<bool>,
    attributes: Option<String>,
    payload: Option<String>,
    alert_type: Option<String>,
    required_bytes: i64,
}

impl SummaryRow {
    fn into_summary(self, org: &str, kind: ResourceKind) -> Result<Option<ResourceSummary>> {
        let route_ref = self.route(org, kind)?;
        let Some((id, name, route_ref)) = route_ref else {
            return Ok(None);
        };
        let email =
            matches!(kind, ResourceKind::User | ResourceKind::ServiceAccount).then(|| id.clone());
        let is_siem = self
            .attributes
            .as_deref()
            .map(siem_marker)
            .transpose()?
            .unwrap_or(false);
        Ok(Some(ResourceSummary {
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
        }))
    }

    fn route(
        &self,
        org: &str,
        kind: ResourceKind,
    ) -> Result<Option<(String, String, ResourceRoute)>> {
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
            ResourceKind::SavedView => return saved_view_route(org, &id, self.payload.as_deref()),
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

#[derive(Deserialize)]
struct SavedSummary {
    org_id: String,
    view_id: String,
    view_name: String,
    view_type: Option<String>,
}

pub async fn subscribe() -> Result<ResourceEvents> {
    let receiver = infra::db::get_coordinator().await.watch("/").await?;
    let receiver = std::sync::Arc::try_unwrap(receiver)
        .map_err(|_| anyhow!("resource subscription unexpectedly shared"))?;
    infra::coordinator::resources::local_subscription_ready();
    Ok(ResourceEvents {
        receiver,
        pending: VecDeque::new(),
    })
}

pub async fn page_scratch_bytes(
    org: &str,
    kind: ResourceKind,
    after: Option<&str>,
    limit: usize,
) -> Result<usize> {
    require_sql_store()?;
    SourceRead::page(org, kind, after, limit)?
        .scratch_bytes(get_orm_client_rw().await)
        .await
}

pub async fn refresh_scratch_bytes(org: &str, kind: ResourceKind, id: &str) -> Result<usize> {
    require_sql_store()?;
    SourceRead::refresh(org, kind, id)
        .scratch_bytes(get_orm_client_rw().await)
        .await
}

pub async fn folder_scratch_bytes(org: &str, after: Option<&str>, limit: usize) -> Result<usize> {
    require_sql_store()?;
    SourceRead::folders(org, after, limit)?
        .scratch_bytes(get_orm_client_rw().await)
        .await
}

pub async fn load_page(
    org: &str,
    kind: ResourceKind,
    after: Option<&str>,
    limit: usize,
    max_bytes: usize,
) -> Result<SummaryPage> {
    require_sql_store()?;
    load_page_with(
        get_orm_client_rw().await,
        org,
        kind,
        after,
        limit,
        max_bytes,
    )
    .await
}

pub async fn refresh(
    org: &str,
    kind: ResourceKind,
    id: &str,
    max_bytes: usize,
) -> Result<Option<ResourceSummary>> {
    require_sql_store()?;
    refresh_with(get_orm_client_rw().await, org, kind, id, max_bytes).await
}

pub async fn folder_page(
    org: &str,
    after: Option<&str>,
    limit: usize,
    max_bytes: usize,
) -> Result<FolderPage> {
    require_sql_store()?;
    folder_page_with(get_orm_client_rw().await, org, after, limit, max_bytes).await
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
    max_bytes: usize,
) -> Result<SummaryPage> {
    let read = SourceRead::page(org, kind, after, limit)?;
    let rows = SummaryRow::find_by_statement(read.bounded_statement(conn, max_bytes)?)
        .all(conn)
        .await?;
    if let Some(row) = rows.first() {
        check_scratch(row.required_bytes, max_bytes)?;
    }
    let next = (rows.len() == limit).then(|| rows[limit - 1].id.clone());
    let items = rows
        .into_iter()
        .map(|row| row.into_summary(org, kind))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();
    Ok(SummaryPage { items, next })
}

async fn refresh_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    kind: ResourceKind,
    id: &str,
    max_bytes: usize,
) -> Result<Option<ResourceSummary>> {
    let read = SourceRead::refresh(org, kind, id);
    let row = SummaryRow::find_by_statement(read.bounded_statement(conn, max_bytes)?)
        .one(conn)
        .await?;
    if let Some(row) = &row {
        check_scratch(row.required_bytes, max_bytes)?;
    }
    row.map(|row| row.into_summary(org, kind))
        .transpose()
        .map(Option::flatten)
}

async fn folder_page_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    after: Option<&str>,
    limit: usize,
    max_bytes: usize,
) -> Result<FolderPage> {
    let read = SourceRead::folders(org, after, limit)?;
    let rows = FolderRow::find_by_statement(read.bounded_statement(conn, max_bytes)?)
        .all(conn)
        .await?;
    if let Some(row) = rows.first() {
        check_scratch(row.required_bytes, max_bytes)?;
    }
    let next = (rows.len() == limit).then(|| rows[limit - 1].id.clone());
    let items = rows
        .into_iter()
        .map(|row| {
            let kind = match row.kind {
                0 => ResourceKind::Dashboard,
                1 => ResourceKind::Alert,
                3 => ResourceKind::Synthetic,
                _ => bail!("invalid resource folder kind"),
            };
            Ok((kind, row.folder_id, row.name))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(FolderPage { items, next })
}

fn byte_count(bytes: i64) -> Result<usize> {
    usize::try_from(bytes).map_err(|_| {
        ResourceExhausted {
            required_bytes: usize::MAX,
        }
        .into()
    })
}

fn check_scratch(required: i64, max_bytes: usize) -> Result<()> {
    let required_bytes = byte_count(required)?;
    if required_bytes > max_bytes {
        return Err(ResourceExhausted { required_bytes }.into());
    }
    Ok(())
}

fn selection(kind: ResourceKind) -> &'static str {
    match kind {
        ResourceKind::Dashboard => {
            "SELECT d.dashboard_id AS id,d.title AS name,f.folder_id,f.name AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM dashboards d JOIN folders f ON f.id=d.folder_id WHERE f.org=$1 AND f.type=0"
        }
        ResourceKind::Alert => {
            "SELECT a.id,a.name,f.folder_id,f.name AS folder_name,a.enabled,CAST(a.context_attributes AS TEXT) AS attributes,NULL AS payload,CASE WHEN a.is_real_time THEN 'realtime' ELSE 'scheduled' END AS alert_type FROM alerts a JOIN folders f ON f.id=a.folder_id WHERE a.org=$1 AND f.org=$1 AND f.type=1 UNION ALL SELECT a.id,a.name,f.folder_id,f.name AS folder_name,a.enabled,CAST(a.context_attributes AS TEXT) AS attributes,NULL AS payload,'composite' AS alert_type FROM alert_composites a JOIN folders f ON f.folder_id=a.folder_id AND f.org=a.org AND f.type=1 WHERE a.org=$1 UNION ALL SELECT a.anomaly_id AS id,a.name,f.folder_id,f.name AS folder_name,a.enabled,NULL AS attributes,NULL AS payload,'anomaly_detection' AS alert_type FROM anomaly_detection_config a JOIN folders f ON f.id=a.folder_id WHERE a.org_id=$1 AND f.org=$1 AND f.type=1"
        }
        ResourceKind::Stream => {
            "SELECT DISTINCT key2 AS id,key2 AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM meta WHERE module='schema' AND key1=$1 AND (key2 LIKE 'logs/%' OR key2 LIKE 'metrics/%' OR key2 LIKE 'traces/%')"
        }
        ResourceKind::SavedView => {
            "SELECT key2 AS id,'' AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,value AS payload,NULL AS alert_type FROM meta WHERE module='organization' AND key1='savedviews' AND substr(key2,1,length($1)+1)=$1 || '/'"
        }
        ResourceKind::Function => {
            "SELECT DISTINCT key2 AS id,key2 AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM meta WHERE module='function' AND key1=$1"
        }
        ResourceKind::Pipeline => {
            "SELECT id,name,NULL AS folder_id,NULL AS folder_name,enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM pipeline WHERE org=$1 AND kind='user'"
        }
        ResourceKind::Synthetic => {
            "SELECT s.id,s.name,f.folder_id,f.name AS folder_name,s.enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM synthetics_checks s JOIN folders f ON f.id=s.folder_id WHERE s.org_id=$1 AND f.org=$1 AND f.type=3"
        }
        ResourceKind::User => {
            "SELECT u.email AS id,trim(u.first_name || ' ' || u.last_name) AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM org_users o JOIN users u ON u.email=o.email WHERE o.org_id=$1 AND o.role NOT IN (5,6)"
        }
        ResourceKind::ServiceAccount => {
            "SELECT u.email AS id,trim(u.first_name || ' ' || u.last_name) AS name,NULL AS folder_id,NULL AS folder_name,NULL AS enabled,NULL AS attributes,NULL AS payload,NULL AS alert_type FROM org_users o JOIN users u ON u.email=o.email WHERE o.org_id=$1 AND o.role IN (5,6)"
        }
    }
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

fn saved_view_route(
    org: &str,
    key: &str,
    payload: Option<&str>,
) -> Result<Option<(String, String, ResourceRoute)>> {
    let value: SavedSummary = serde_json::from_str(payload.context("saved view summary missing")?)
        .context("invalid saved view summary")?;
    let id = key
        .strip_prefix(&format!("{org}/"))
        .context("saved view scope mismatch")?;
    ensure!(
        value.org_id == org && value.view_id == id,
        "saved view identity mismatch"
    );
    let view_type = value.view_type.unwrap_or_else(|| "logs".into());
    ensure!(
        matches!(view_type.as_str(), "logs" | "traces" | "metrics_explorer"),
        "invalid saved view type"
    );
    Ok(Some((
        id.to_owned(),
        value.view_name,
        ResourceRoute::SavedView {
            view_id: id.to_owned(),
            view_type,
        },
    )))
}

fn siem_marker(value: &str) -> Result<bool> {
    let attributes: SiemAttributes =
        serde_json::from_str(value).context("invalid alert attributes")?;
    Ok(attributes.siem.as_deref() == Some("true"))
}

fn parse_event_key(key: &str) -> Result<Vec<ResourceChange>> {
    let parts = key.trim_start_matches('/').split('/').collect::<Vec<_>>();
    match parts.as_slice() {
        [
            "resource_catalog",
            "_continuity_lost" | "_continuity_restored",
        ] => Ok(vec![ResourceChange::InvalidateAll]),
        ["resource_catalog", "folder", org] => {
            Ok(vec![ResourceChange::Folder { org: (*org).into() }])
        }
        ["resource_catalog", kind, org, rest @ ..] => {
            let kind = kind.parse().map_err(anyhow::Error::msg)?;
            scoped_change(org, kind, rest.join("/"))
        }
        ["dashboards", org, id] => scoped_change(org, ResourceKind::Dashboard, (*id).into()),
        ["alerts", org, id] => scoped_change(org, ResourceKind::Alert, (*id).into()),
        ["function", org, rest @ ..] => scoped_change(org, ResourceKind::Function, rest.join("/")),
        ["schema", org, signal, name, ..] => {
            scoped_change(org, ResourceKind::Stream, format!("{signal}/{name}"))
        }
        ["organization", "savedviews", org, id] => {
            scoped_change(org, ResourceKind::SavedView, (*id).into())
        }
        ["synthetics", "check", org, id] => {
            scoped_change(org, ResourceKind::Synthetic, (*id).into())
        }
        ["pipelines", id] => Ok(vec![ResourceChange::GlobalResource {
            kind: ResourceKind::Pipeline,
            id: (*id).into(),
        }]),
        ["user_record", email] | ["org_users", "many", "user", email] => {
            Ok(account_changes(None, email))
        }
        ["org_users", "single", org, email] => Ok(account_changes(Some(org), email)),
        ["user_bulk_refresh", ""] => Ok(vec![ResourceChange::Scope {
            org: None,
            kinds: vec![ResourceKind::User, ResourceKind::ServiceAccount],
        }]),
        [
            "dashboards" | "alerts" | "function" | "schema" | "resource_catalog" | "pipelines"
            | "user_record" | "org_users",
            ..,
        ]
        | ["organization", "savedviews", ..]
        | ["synthetics", "check", ..] => bail!("malformed resource event"),
        _ => Ok(vec![]),
    }
}

fn scoped_change(org: &str, kind: ResourceKind, id: String) -> Result<Vec<ResourceChange>> {
    ensure!(
        !org.is_empty() && !id.is_empty(),
        "empty resource event identity"
    );
    Ok(vec![ResourceChange::Resource {
        org: org.into(),
        kind,
        id,
    }])
}

fn account_changes(org: Option<&str>, email: &str) -> Vec<ResourceChange> {
    [ResourceKind::User, ResourceKind::ServiceAccount]
        .into_iter()
        .map(|kind| match org {
            Some(org) => ResourceChange::Resource {
                org: org.into(),
                kind,
                id: email.into(),
            },
            None => ResourceChange::GlobalResource {
                kind,
                id: email.into(),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests;
