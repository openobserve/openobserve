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

//! The OSS records behind "what changed just before": one read per ask, covering all its issues.
//! Records leave `provider` empty, since the enterprise context provider stamps its own id.

pub mod audit;
pub mod deploy;
pub mod pipeline;

use std::collections::{BTreeMap, BTreeSet};

use async_trait::async_trait;
use config::meta::{
    alerts::alert::ListAlertsParams,
    pipeline::{Pipeline, components::PipelineSource},
    stream::{StreamParams, StreamType},
};
use o2_enterprise::enterprise::autoobserve::{
    context::{ChangeAsk, ChangeRecord, Checked, DeepLink, subject_of},
    contract::EntityRef,
    names::{dims, kinds},
    ports::OssSource,
};

/// The pipeline ids one read filters on, so its statement stays short.
const MAX_PIPELINES: usize = 200;

/// An alert and the stream it reads, as stored now.
#[derive(Clone, Debug, PartialEq)]
pub struct AlertStream {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub stream: EntityRef,
}

/// Behind a trait so the reads are tested on the rows their producers serialise.
#[async_trait]
pub trait Lookups: Send + Sync {
    async fn pipelines(&self, org: &str) -> anyhow::Result<Vec<Pipeline>>;
    async fn alerts(&self, org: &str) -> anyhow::Result<Vec<AlertStream>>;
    fn audit_enabled(&self) -> bool;
    /// A `_meta` stream's fields; none until its first row, and a search of it errors.
    async fn meta_fields(&self, stream: &str) -> anyhow::Result<BTreeSet<String>>;
}

pub struct LiveLookups;

#[async_trait]
impl Lookups for LiveLookups {
    async fn pipelines(&self, org: &str) -> anyhow::Result<Vec<Pipeline>> {
        Ok(infra::pipeline::list_by_org(org).await?)
    }

    async fn alerts(&self, org: &str) -> anyhow::Result<Vec<AlertStream>> {
        let conn = infra::db::get_orm_client_ro().await;
        let alerts = db::alerts::alert::list_with_folders(conn, ListAlertsParams::new(org)).await?;
        Ok(alerts
            .into_iter()
            .filter_map(|(folder, a)| {
                Some(AlertStream {
                    id: a.id?.to_string(),
                    stream: stream_ref(a.stream_type, &a.stream_name),
                    name: a.name,
                    folder: folder.folder_id,
                })
            })
            .collect())
    }

    fn audit_enabled(&self) -> bool {
        o2_enterprise::enterprise::common::config::get_config()
            .common
            .audit_enabled
    }

    async fn meta_fields(&self, stream: &str) -> anyhow::Result<BTreeSet<String>> {
        let schema = infra::schema::get(config::META_ORG_ID, stream, StreamType::Logs).await?;
        Ok(schema.fields().iter().map(|f| f.name().clone()).collect())
    }
}

/// A pipeline that reads or writes an issue stream, with the issue streams it touches.
#[derive(Clone, Debug, PartialEq)]
pub struct Fed {
    pub name: String,
    pub affects: Vec<EntityRef>,
}

/// The ask's stream issues; other subjects have no OSS change record.
pub fn issue_streams(ask: &ChangeAsk) -> BTreeSet<EntityRef> {
    ask.issues
        .iter()
        .map(|i| i.subject.clone())
        .filter(|s| {
            s.kind == kinds::STREAM
                && s.key_dims.contains_key(dims::STREAM_TYPE)
                && s.key_dims.contains_key(dims::STREAM_NAME)
        })
        .collect()
}

pub fn stream_ref(stream_type: StreamType, name: &str) -> EntityRef {
    subject_of(kinds::STREAM, &format!("{stream_type}/{name}"))
}

/// Pipelines whose source or destination is an issue stream; the flag says the list was cut.
pub fn fed_pipelines(
    pipelines: &[Pipeline],
    streams: &BTreeSet<EntityRef>,
) -> (BTreeMap<String, Fed>, bool) {
    let of = |p: &StreamParams| stream_ref(p.stream_type, &p.stream_name);
    let mut fed = BTreeMap::new();
    for p in pipelines {
        let mut touched: BTreeSet<EntityRef> = BTreeSet::new();
        if let PipelineSource::Realtime(source) = &p.source {
            touched.insert(of(source));
        }
        let nodes = p.get_node_map();
        if let Ok(graph) = p.build_adjacency_list(&nodes) {
            touched.extend(p.get_all_destination_streams(&nodes, &graph).iter().map(of));
        }
        let affects: Vec<EntityRef> = touched.intersection(streams).cloned().collect();
        if !affects.is_empty() {
            let name = p.name.clone();
            fed.insert(p.id.clone(), Fed { name, affects });
        }
    }
    let cut = fed.len() > MAX_PIPELINES;
    let fed = fed.into_iter().take(MAX_PIPELINES).collect();
    (fed, cut)
}

pub fn quoted(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

pub fn link(path: &str, query: &[(&str, &str)]) -> Option<DeepLink> {
    Some(DeepLink {
        path: path.to_string(),
        query: query
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    })
}

pub fn failed(source: OssSource, org: &str, e: anyhow::Error) -> (Checked, Vec<ChangeRecord>) {
    log::warn!("[autoobserve] org {org}: reading {source:?} for issue context failed: {e}");
    (Checked::Failed(e.to_string()), Vec::new())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use config::utils::{
        arrow::record_batches_to_json_rows, record_batch_ext::convert_json_to_record_batch,
        schema::infer_json_schema_from_values,
    };
    use datafusion::{
        config::Dialect,
        prelude::{SessionConfig, SessionContext},
    };
    use o2_enterprise::enterprise::autoobserve::{context::IssueRef, ports::SearchPage};
    use serde_json::Value;

    use super::*;

    /// Runs each read's SQL over rows the producers serialised, and records the org it searched.
    pub(super) struct MemSearch {
        pub streams: Vec<(&'static str, Vec<Value>)>,
        pub orgs: Mutex<Vec<String>>,
    }

    impl MemSearch {
        pub fn new(streams: Vec<(&'static str, Vec<Value>)>) -> Self {
            Self {
                streams,
                orgs: Mutex::default(),
            }
        }
    }

    #[async_trait]
    impl o2_enterprise::enterprise::autoobserve::ports::SearchPort for MemSearch {
        async fn sql(
            &self,
            org: &str,
            sql: &str,
            range: (i64, i64),
            _page: (i64, i64),
        ) -> anyhow::Result<SearchPage> {
            self.orgs.lock().unwrap().push(org.to_string());
            let mut config = SessionConfig::new();
            config.options_mut().sql_parser.dialect = Dialect::PostgreSQL;
            let ctx = SessionContext::new_with_config(config);
            for (stream, rows) in &self.streams {
                let schema = Arc::new(infer_json_schema_from_values(
                    stream,
                    StreamType::Logs,
                    rows.iter(),
                )?);
                let in_range: Vec<Arc<Value>> = rows
                    .iter()
                    .filter(|r| {
                        r["_timestamp"]
                            .as_i64()
                            .is_some_and(|t| t >= range.0 && t < range.1)
                    })
                    .map(|r| Arc::new(r.clone()))
                    .collect();
                ctx.register_batch(*stream, convert_json_to_record_batch(&schema, &in_range)?)?;
            }
            let batches = ctx.sql(sql).await?.collect().await?;
            let hits = record_batches_to_json_rows(&batches.iter().collect::<Vec<_>>())?
                .into_iter()
                .map(Value::Object)
                .collect();
            Ok(SearchPage {
                hits,
                is_partial: false,
            })
        }

        async fn promql(&self, _: &str, _: &str, _: i64, _: i64, _: i64) -> anyhow::Result<Value> {
            anyhow::bail!("not used")
        }
    }

    pub(super) struct FakeLookups {
        pub pipelines: Vec<Pipeline>,
        pub alerts: Vec<AlertStream>,
        pub audit_enabled: bool,
        pub fields: BTreeSet<String>,
    }

    #[async_trait]
    impl Lookups for FakeLookups {
        async fn pipelines(&self, _: &str) -> anyhow::Result<Vec<Pipeline>> {
            Ok(self.pipelines.clone())
        }

        async fn alerts(&self, _: &str) -> anyhow::Result<Vec<AlertStream>> {
            Ok(self.alerts.clone())
        }

        fn audit_enabled(&self) -> bool {
            self.audit_enabled
        }

        async fn meta_fields(&self, _: &str) -> anyhow::Result<BTreeSet<String>> {
            Ok(self.fields.clone())
        }
    }

    /// The fields the schema would hold after these rows were ingested.
    pub(super) fn fields(rows: &[Value]) -> BTreeSet<String> {
        rows.iter()
            .filter_map(Value::as_object)
            .flat_map(|row| row.keys().cloned())
            .collect()
    }

    pub(super) fn ask(org: &str, streams: &[(&str, &str)], (from, to): (i64, i64)) -> ChangeAsk {
        let issues = streams
            .iter()
            .map(|(t, n)| IssueRef {
                org: org.to_string(),
                decision_kind: "stream_silence".to_string(),
                subject: subject_of(kinds::STREAM, &format!("{t}/{n}")),
                decision_id: format!("{t}/{n}"),
                onset_us: to,
                detected_us: to,
                recovered_us: None,
                shadow: false,
                source: None,
            })
            .collect();
        ChangeAsk {
            org: org.to_string(),
            from,
            to,
            issues,
        }
    }
}
