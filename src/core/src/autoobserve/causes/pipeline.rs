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

//! Pipelines of the issue streams that logged errors in the window: one aggregate over `errors`.

use std::collections::{BTreeMap, BTreeSet, btree_map::Entry};

use config::{
    META_ORG_ID,
    meta::self_reporting::{error::NodeErrors, usage::ERROR_STREAM},
};
use o2_enterprise::enterprise::autoobserve::{
    context::{ChangeAsk, ChangeKind, ChangeRecord, Checked, PROVIDER_TIMEOUT},
    contract::{Confidence, EntityRef, SECOND_US},
    names::{dims, kinds},
    ports::SearchPort,
};
use serde_json::Value;

use super::{Fed, LiveLookups, Lookups, failed, fed_pipelines, issue_streams, link, quoted};
use crate::autoobserve::ports::SearchAdapter;

const PROVIDER: &str = "pipelines";
/// The enterprise build publishes `errors` at least this often.
const PUBLISH_CAP_SECS: i64 = 600;
/// One row per pipeline and name it ran under in the window, and a renamed pipeline is rare.
const ROWS: i64 = 1_000;
const ERROR_CHARS: usize = 200;

/// One pipeline's error rows in the window, folded across names and partitions.
#[derive(Debug, Default)]
struct Failing {
    name: String,
    first: i64,
    last: i64,
    count: u64,
    sample: Option<String>,
}

pub async fn read(ask: &ChangeAsk) -> (Checked, Vec<ChangeRecord>) {
    read_with(&SearchAdapter, &LiveLookups, ask).await
}

pub async fn read_with(
    search: &dyn SearchPort,
    lookups: &dyn Lookups,
    ask: &ChangeAsk,
) -> (Checked, Vec<ChangeRecord>) {
    let streams = issue_streams(ask);
    if streams.is_empty() {
        return (Checked::Ok, Vec::new());
    }
    let pipelines = match lookups.pipelines(&ask.org).await {
        Ok(pipelines) => pipelines,
        Err(e) => return failed(PROVIDER, &ask.org, e),
    };
    let (fed, cut) = fed_pipelines(&pipelines, &streams);
    if fed.is_empty() {
        return (Checked::Ok, Vec::new());
    }
    let fields = match lookups.meta_fields(ERROR_STREAM).await {
        Ok(fields) => fields,
        Err(e) => return failed(PROVIDER, &ask.org, e),
    };
    if !fields.contains("pipeline_id") {
        return (Checked::Ok, Vec::new());
    }
    let sql = errors_sql(&ask.org, fed.keys(), &fields);
    let page = match search
        .sql_streamed(
            META_ORG_ID,
            &sql,
            (ask.from, ask.to),
            ROWS,
            PROVIDER_TIMEOUT,
        )
        .await
    {
        Ok(page) => page,
        Err(e) => return failed(PROVIDER, &ask.org, e),
    };
    let partial = cut || page.is_partial || page.hits.len() >= ROWS as usize;
    let settled_before = ask.to - publish_interval_us();
    let records = fold(&page.hits)
        .into_iter()
        .filter_map(|(id, f)| Some(record(&id, f, fed.get(&id)?, settled_before)))
        .collect();
    let state = if partial {
        Checked::Partial
    } else {
        Checked::Ok
    };
    (state, records)
}

/// A field no error row has carried yet is not in the schema, and naming it fails the search.
fn errors_sql<'a>(
    org: &str,
    ids: impl Iterator<Item = &'a String>,
    fields: &BTreeSet<String>,
) -> String {
    let ids: Vec<String> = ids.map(|id| quoted(id)).collect();
    let mut samples = String::new();
    for (field, alias) in [("error", "sample"), ("pipeline_node_errors", "node_errors")] {
        if fields.contains(field) {
            samples.push_str(&format!(", max({field}) AS {alias}"));
        }
    }
    format!(
        "SELECT pipeline_id, pipeline_name, min(_timestamp) AS first_at, \
         max(_timestamp) AS last_at, count(*) AS n{samples} \
         FROM \"{ERROR_STREAM}\" WHERE org_id = {} AND error_source = 'pipeline' \
         AND pipeline_id IN ({}) GROUP BY pipeline_id, pipeline_name",
        quoted(org),
        ids.join(", ")
    )
}

/// A streamed aggregate can return one group per partition, so groups are merged here.
fn fold(hits: &[Value]) -> BTreeMap<String, Failing> {
    let mut out: BTreeMap<String, Failing> = BTreeMap::new();
    for hit in hits {
        let (Some(id), Some(first), Some(last)) = (
            hit["pipeline_id"].as_str(),
            hit["first_at"].as_i64(),
            hit["last_at"].as_i64(),
        ) else {
            continue;
        };
        let name = hit["pipeline_name"].as_str().unwrap_or_default();
        let count = hit["n"].as_u64().unwrap_or(0);
        let sample = error_text(hit);
        match out.entry(id.to_string()) {
            Entry::Vacant(slot) => {
                slot.insert(Failing {
                    name: name.to_string(),
                    first,
                    last,
                    count,
                    sample,
                });
            }
            Entry::Occupied(mut slot) => {
                let f = slot.get_mut();
                if last > f.last {
                    f.name = name.to_string();
                }
                f.first = f.first.min(first);
                f.last = f.last.max(last);
                f.count += count;
                f.sample = f.sample.take().or(sample);
            }
        }
    }
    out
}

/// Runtime failures name their node and function only in `pipeline_node_errors`.
fn error_text(hit: &Value) -> Option<String> {
    if let Some(error) = hit["sample"].as_str().filter(|e| !e.is_empty()) {
        return Some(error.to_string());
    }
    let nodes: BTreeMap<String, NodeErrors> =
        serde_json::from_str(hit["node_errors"].as_str()?).ok()?;
    let node = nodes.values().next()?;
    let message = node.errors.iter().map(|(m, _)| m).min()?;
    Some(match &node.function_name {
        Some(function) => format!("function {function}: {message}"),
        None => message.clone(),
    })
}

/// Rows publish in batches, so an error seen within one interval may still be happening.
fn record(id: &str, f: Failing, fed: &Fed, settled_before: i64) -> ChangeRecord {
    let name = if f.name.is_empty() {
        fed.name.clone()
    } else {
        f.name
    };
    let mut facts = BTreeMap::from([
        ("pipeline_name".to_string(), name.clone()),
        ("count".to_string(), f.count.to_string()),
    ]);
    if let Some(error) = f.sample {
        facts.insert(
            "error".to_string(),
            error.chars().take(ERROR_CHARS).collect(),
        );
    }
    ChangeRecord {
        provider: PROVIDER.to_string(),
        kind: ChangeKind::PipelineFailing,
        at: f.first,
        until: (f.last < settled_before).then_some(f.last),
        actor: None,
        subject: EntityRef::new(kinds::PIPELINE, &[(dims::ENTITY_ID, id)]),
        subject_name: name,
        affects: fed.affects.clone(),
        link: Confidence::Exact,
        count: None,
        facts,
        needs: None,
        open: link("pipeline/pipelines/edit", &[("id", id)]),
    }
}

fn publish_interval_us() -> i64 {
    let secs = PUBLISH_CAP_SECS.min(config::get_config().common.usage_publish_interval);
    secs.saturating_mul(SECOND_US)
}

#[cfg(test)]
mod tests {
    use config::meta::{
        pipeline::{
            Pipeline,
            components::{Edge, Node, NodeData, PipelineSource},
        },
        self_reporting::error::{ErrorData, ErrorSource, PipelineError},
        stream::{StreamParams, StreamType},
    };

    use super::{
        super::{
            stream_ref,
            tests::{FakeLookups, MemSearch, ask, fields},
        },
        *,
    };

    const MIN: i64 = 60 * SECOND_US;

    fn pipeline(id: &str, from: &str, to: &str) -> Pipeline {
        let stream = |n: &str| NodeData::Stream(StreamParams::new("acme", n, StreamType::Logs));
        Pipeline {
            id: id.to_string(),
            version: 1,
            enabled: true,
            org: "acme".to_string(),
            name: format!("{id}-name"),
            description: String::new(),
            source: PipelineSource::Realtime(StreamParams::new("acme", from, StreamType::Logs)),
            kind: Default::default(),
            nodes: vec![
                Node::new("in".into(), stream(from), 0.0, 0.0, "input".into()),
                Node::new("out".into(), stream(to), 0.0, 0.0, "output".into()),
            ],
            edges: vec![Edge::new("in".into(), "out".into())],
        }
    }

    /// `node_error` is a runtime failure of a function node, which leaves `error` unset.
    fn error_row(
        id: &str,
        stream: &str,
        at: i64,
        error: Option<&str>,
        node_error: Option<(&str, &str)>,
    ) -> serde_json::Value {
        let mut failure = PipelineError::new(id, &format!("{id}-name"));
        failure.error = error.map(str::to_string);
        if let Some((function, message)) = node_error {
            let (node, kind) = ("n1".to_string(), "function".to_string());
            failure.add_node_error(node, kind, message.into(), Some(function.into()), None);
        }
        let row = ErrorData {
            _timestamp: at,
            stream_params: StreamParams::new("acme", stream, StreamType::Logs),
            error_source: ErrorSource::Pipeline(failure),
        };
        serde_json::to_value(row).unwrap()
    }

    /// Source and derived streams both count; a pipeline still failing at the ask has no end.
    #[tokio::test]
    async fn error_rows_of_an_issue_streams_pipelines_become_failing_pipelines() {
        let (from, to) = (0, 70 * MIN);
        let rows = vec![
            error_row(
                "mask",
                "app",
                10 * MIN,
                Some("failed to compile function"),
                None,
            ),
            error_row("mask", "app", 69 * MIN, None, None),
            error_row(
                "fan",
                "raw",
                20 * MIN,
                None,
                Some(("redact_email", "undefined variable")),
            ),
            error_row("other", "x", 30 * MIN, Some("unrelated"), None),
            error_row("mask", "app", 71 * MIN, None, None),
        ];
        let written = fields(&rows);
        let search = MemSearch::new(vec![(ERROR_STREAM, rows)]);
        let lookups = FakeLookups {
            pipelines: vec![
                pipeline("mask", "app", "app_copy"),
                pipeline("fan", "raw", "derived"),
                pipeline("other", "x", "y"),
            ],
            alerts: Vec::new(),
            audit_enabled: true,
            fields: written,
        };
        let ask = ask("acme", &[("logs", "app"), ("logs", "derived")], (from, to));
        let (state, records) = read_with(&search, &lookups, &ask).await;

        assert_eq!(state, Checked::Ok);
        let got: Vec<_> = records
            .iter()
            .map(|r| {
                let fact = |k: &str| r.facts.get(k).cloned().unwrap_or_default();
                let pipeline = r.subject.key_dims[dims::ENTITY_ID].as_str();
                (
                    pipeline,
                    r.at,
                    r.until,
                    r.affects.clone(),
                    fact("count"),
                    fact("error"),
                )
            })
            .collect();
        let derived = vec![stream_ref(StreamType::Logs, "derived")];
        let app = vec![stream_ref(StreamType::Logs, "app")];
        let fan_error = "function redact_email: undefined variable".to_string();
        let mask_error = "failed to compile function".to_string();
        assert_eq!(
            got,
            [
                (
                    "fan",
                    20 * MIN,
                    Some(20 * MIN),
                    derived,
                    "1".to_string(),
                    fan_error
                ),
                ("mask", 10 * MIN, None, app, "2".to_string(), mask_error),
            ]
        );
        assert!(
            records
                .iter()
                .all(|r| r.kind == ChangeKind::PipelineFailing)
        );
        assert_eq!(records[1].subject_name, "mask-name");
        assert_eq!(*search.orgs.lock().unwrap(), [META_ORG_ID]);
    }
}
