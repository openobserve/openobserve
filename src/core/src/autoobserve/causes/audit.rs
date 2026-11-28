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

//! Changes people made to the issue streams, their pipelines, alerts and ingestion credentials.

use std::collections::{BTreeMap, BTreeSet};

use config::{META_ORG_ID, meta::stream::StreamType};
use o2_enterprise::enterprise::{
    autoobserve::{
        context::{ChangeAsk, ChangeKind, ChangeRecord, Checked, Need, PROVIDER_TIMEOUT},
        contract::{Confidence, EntityRef},
        names::{dims, kinds},
        ports::{OssSource, SearchPort},
    },
    common::auditor::AUDIT_STREAM,
};
use serde_json::Value;

use super::{
    AlertStream, Fed, LiveLookups, Lookups, failed, fed_pipelines, issue_streams, link, quoted,
    stream_ref,
};
use crate::autoobserve::ports::SearchAdapter;

/// Newest audited writes read per ask; a full page marks the answer partial.
const ROWS: i64 = 200;
const BODY_CHARS: usize = 2048;
/// A cut body holds about 68 real pipeline ids, so more are short made-up ids; the cap keeps
/// one bulk call from crowding the other changes out of the provider's records.
const BULK_IDS: usize = 100;
/// Past this many streams one prefix covers them all, so the statement stays short.
const STREAM_PREFIXES: usize = 50;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub kind: ChangeKind,
    pub object: Object,
}

/// The changed object, named as far as the path and the cut body tell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Object {
    Stream(EntityRef),
    /// `named` is false for the passcode and the RUM token, which have no name of their own.
    Token {
        id: String,
        named: bool,
    },
    Pipeline {
        id: Option<String>,
        name: Option<String>,
        edit: PipelineEdit,
    },
    Alert {
        id: Option<String>,
        stream: Option<EntityRef>,
    },
}

/// A toggle (enable or disable) keeps the stored config; `Config` is a create, edit or delete.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PipelineEdit {
    Config,
    Toggle,
    /// An id read from a bulk call's body, which answers 200 whether or not the id exists.
    BulkToggle,
}

#[derive(Clone, Debug)]
struct Audited {
    at: i64,
    actor: String,
    deleted: bool,
    target: Option<String>,
    change: Change,
}

impl Audited {
    fn of(hit: &Value) -> Vec<Self> {
        let text = |k: &str| hit[k].as_str().unwrap_or_default();
        let method = text("http_method");
        let Some(at) = hit["_timestamp"].as_i64() else {
            return Vec::new();
        };
        let changes = change_of(
            method,
            text("http_path"),
            text("http_query_params"),
            text("body"),
        );
        changes
            .into_iter()
            .map(|change| Self {
                at,
                actor: text("user_email").to_string(),
                deleted: method.eq_ignore_ascii_case("DELETE"),
                target: Some(text("target").to_string()).filter(|t| !t.is_empty()),
                change,
            })
            .collect()
    }
}

pub async fn read(ask: &ChangeAsk) -> (Checked, Vec<ChangeRecord>) {
    read_with(&SearchAdapter, &LiveLookups, ask).await
}

pub async fn read_with(
    search: &dyn SearchPort,
    lookups: &dyn Lookups,
    ask: &ChangeAsk,
) -> (Checked, Vec<ChangeRecord>) {
    match changes(search, lookups, ask).await {
        Ok(answer) => answer,
        Err(e) => failed(OssSource::AuditTrail, &ask.org, e),
    }
}

/// Maps an audited call, its path below `/api`, to the changes it made; reads and acks are none.
pub fn change_of(method: &str, path: &str, query: &str, body: &str) -> Vec<Change> {
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let method = method.to_ascii_uppercase();
    // One change per pipeline, so each is ranked against the streams it feeds.
    if let ("POST", [_, "pipelines", "bulk", "enable"]) = (method.as_str(), parts.as_slice()) {
        let ids = body_ids(body);
        let mut seen = BTreeSet::new();
        let changes: Vec<Change> = ids
            .iter()
            .filter(|id| seen.insert(id.as_str()))
            .take(BULK_IDS)
            .map(|id| Change {
                kind: ChangeKind::PipelineChanged,
                object: pipeline_id(id, PipelineEdit::BulkToggle),
            })
            .collect();
        if changes.len() < ids.len() {
            log::debug!(
                "[autoobserve] bulk pipeline toggle: dropped {} of {} ids (repeats, or past {BULK_IDS})",
                ids.len() - changes.len(),
                ids.len()
            );
        }
        return changes;
    }
    let (kind, object) = match (method.as_str(), parts.as_slice()) {
        (
            "PUT",
            [
                _,
                "streams",
                name,
                "settings" | "update_fields" | "delete_fields",
            ],
        ) => (
            ChangeKind::SettingsChanged,
            Object::Stream(stream_ref(stream_type_of(query), name)),
        ),
        ("DELETE", [_, "streams", name]) => (
            ChangeKind::StreamDeleted,
            Object::Stream(stream_ref(stream_type_of(query), name)),
        ),
        ("PUT", [_, "passcode"]) => (ChangeKind::TokenChanged, token("passcode", false)),
        ("POST" | "PUT", [_, "rumtoken"]) => (ChangeKind::TokenChanged, token("rumtoken", false)),
        ("POST", [_, "ingestion-tokens"]) => (
            ChangeKind::TokenChanged,
            token(&body_field(body, "name").unwrap_or_default(), true),
        ),
        ("PATCH", [_, "ingestion-tokens", name]) => (ChangeKind::TokenChanged, token(name, true)),
        ("POST" | "PUT", [_, "pipelines"]) => {
            // A create without `overwrite` gets its id from the server, not from the body.
            let kept =
                method == "PUT" || query_value(query, "overwrite").as_deref() == Some("true");
            (
                ChangeKind::PipelineChanged,
                Object::Pipeline {
                    id: body_field(body, "pipeline_id").filter(|id| kept && !id.is_empty()),
                    name: body_field(body, "name"),
                    edit: PipelineEdit::Config,
                },
            )
        }
        ("DELETE", [_, "pipelines", id]) if *id != "bulk" => (
            ChangeKind::PipelineChanged,
            pipeline_id(id, PipelineEdit::Config),
        ),
        // Enabling a realtime pipeline can silence its source: it gets only rows written back.
        ("PUT", [_, "pipelines", id, "enable"]) => (
            ChangeKind::PipelineChanged,
            pipeline_id(id, PipelineEdit::Toggle),
        ),
        ("POST", ["v2", _, "alerts"]) => (
            ChangeKind::AlertChanged,
            Object::Alert {
                id: None,
                stream: body_stream(body),
            },
        ),
        ("PUT" | "DELETE", ["v2", _, "alerts", id]) if *id != "bulk" => (
            ChangeKind::AlertChanged,
            Object::Alert {
                id: Some(id.to_string()),
                stream: body_stream(body),
            },
        ),
        _ => return Vec::new(),
    };
    vec![Change { kind, object }]
}

async fn changes(
    search: &dyn SearchPort,
    lookups: &dyn Lookups,
    ask: &ChangeAsk,
) -> anyhow::Result<(Checked, Vec<ChangeRecord>)> {
    // Guarded as the Security audit read; audit is on by default, so no stream yet is not off.
    if !lookups.audit_enabled() {
        return Ok((Checked::Off, Vec::new()));
    }
    let fields = lookups.meta_fields(AUDIT_STREAM).await?;
    if fields.is_empty() {
        return Ok((Checked::Ok, Vec::new()));
    }
    let has_target = fields.contains("target");
    let streams = issue_streams(ask);
    if streams.is_empty() {
        return Ok((Checked::Ok, Vec::new()));
    }
    let sql = audit_sql(&ask.org, &streams, has_target);
    let page = search
        .sql_streamed(
            META_ORG_ID,
            &sql,
            (ask.from, ask.to),
            ROWS,
            PROVIDER_TIMEOUT,
        )
        .await?;
    let audited: Vec<Audited> = page.hits.iter().flat_map(Audited::of).collect();
    let wants = |f: fn(&Object) -> bool| audited.iter().any(|a| f(&a.change.object));
    let (names, fed, cut) = if wants(|o| matches!(o, Object::Pipeline { .. })) {
        let pipelines = lookups.pipelines(&ask.org).await?;
        let (fed, cut) = fed_pipelines(&pipelines, &streams);
        let names = pipelines.into_iter().map(|p| (p.id, p.name)).collect();
        (names, fed, cut)
    } else {
        (BTreeMap::new(), BTreeMap::new(), false)
    };
    let alerts = if wants(|o| matches!(o, Object::Alert { .. })) {
        lookups.alerts(&ask.org).await?
    } else {
        Vec::new()
    };
    let records = audited
        .into_iter()
        .filter_map(|a| record(a, &streams, (&names, &fed), &alerts))
        .collect();
    let partial = cut || page.is_partial || page.hits.len() >= ROWS as usize;
    let state = if partial {
        Checked::Partial
    } else {
        Checked::Ok
    };
    Ok((state, records))
}

/// A `LIKE` prefix can match a longer name, so `record` keeps only exact issue streams.
fn audit_sql(org: &str, streams: &BTreeSet<EntityRef>, has_target: bool) -> String {
    let names: BTreeSet<&str> = streams
        .iter()
        .filter_map(|s| s.key_dims.get(dims::STREAM_NAME).map(String::as_str))
        .collect();
    let mut prefixes: Vec<String> = if names.len() > STREAM_PREFIXES {
        vec![format!("{org}/streams/")]
    } else {
        names.iter().map(|n| format!("{org}/streams/{n}")).collect()
    };
    for route in ["pipelines", "ingestion-tokens", "passcode", "rumtoken"] {
        prefixes.push(format!("{org}/{route}"));
    }
    prefixes.push(format!("v2/{org}/alerts"));
    let paths: Vec<String> = prefixes
        .iter()
        .map(|p| format!("http_path LIKE {}", quoted(&format!("{p}%"))))
        .collect();
    let target = if has_target { ", target" } else { "" };
    format!(
        "SELECT _timestamp, user_email, http_method, http_path, http_query_params, \
         substr(http_body, 1, {BODY_CHARS}) AS body{target} FROM \"{AUDIT_STREAM}\" \
         WHERE org_id = {} AND http_method IN ('POST', 'PUT', 'PATCH', 'DELETE') \
         AND http_response_code >= 200 AND http_response_code < 300 AND ({}) \
         ORDER BY _timestamp DESC LIMIT {ROWS}",
        quoted(org),
        paths.join(" OR ")
    )
}

/// Keeps a change only when it touches an issue stream, or is org-wide like a token.
/// `names` holds every pipeline's name by id, `fed` those that touch an issue stream.
fn record(
    a: Audited,
    streams: &BTreeSet<EntityRef>,
    (names, fed): (&BTreeMap<String, String>, &BTreeMap<String, Fed>),
    alerts: &[AlertStream],
) -> Option<ChangeRecord> {
    let (subject, name, affects, open) = match a.change.object {
        Object::Stream(stream) => {
            if !streams.contains(&stream) {
                return None;
            }
            let dim = |k: &str| stream.key_dims.get(k).cloned().unwrap_or_default();
            let (stream_type, stream_name) = (dim(dims::STREAM_TYPE), dim(dims::STREAM_NAME));
            let open = link(
                "streams",
                &[("dialog", &stream_name), ("stream_type", &stream_type)],
            );
            let name = a.target.clone().unwrap_or(stream_name);
            // Naming the stream keeps the change off other issues of the same ask.
            let affects = vec![stream.clone()];
            (stream, name, affects, open.filter(|_| !a.deleted))
        }
        Object::Token { id, named } => {
            let subject = EntityRef::new(kinds::INGESTION_TOKEN, &[(dims::ENTITY_ID, &id)]);
            let name = if named {
                a.target.clone().unwrap_or(id)
            } else {
                String::new()
            };
            let open = link("iam/ingestionTokens", &[]).filter(|_| named);
            (subject, name, Vec::new(), open)
        }
        Object::Pipeline { id, name, edit } => {
            let named = a.target.clone().or(name);
            let created = id.is_none();
            let id = id.or_else(|| only_named(names, named.as_deref()?))?;
            let subject = EntityRef::new(kinds::PIPELINE, &[(dims::ENTITY_ID, &id)]);
            let open = link("pipeline/pipelines/edit", &[("id", &id)])
                .filter(|_| !a.deleted && names.contains_key(&id));
            match fed.get(&id) {
                Some(f) => {
                    let name = a.target.clone().unwrap_or_else(|| f.name.clone());
                    (subject, name, f.affects.clone(), open)
                }
                // A create, or a toggle of a pipeline not in `fed`, cannot have cut a stream off;
                // a single toggle of one gone since is kept: unlike a bulk id, it surely existed.
                None if created
                    || edit == PipelineEdit::BulkToggle
                    || (edit == PipelineEdit::Toggle && names.contains_key(&id)) =>
                {
                    return None;
                }
                // Only the current config is stored, so what an edit cut off is unknown: org-wide.
                None => {
                    let name = named.or_else(|| names.get(&id).cloned());
                    (subject, name.unwrap_or_default(), Vec::new(), open)
                }
            }
        }
        Object::Alert { id, stream } => {
            let stored = alerts.iter().find(|s| match &id {
                Some(id) => s.id == *id,
                None => {
                    a.target.as_deref() == Some(s.name.as_str())
                        && stream.as_ref().is_none_or(|st| *st == s.stream)
                }
            });
            let stream = stream.or_else(|| stored.map(|s| s.stream.clone()));
            let id = id.or_else(|| stored.map(|s| s.id.clone()))?;
            let affects = match stream {
                Some(stream) if streams.contains(&stream) => vec![stream],
                Some(_) => return None,
                // Gone since, so the stream it read is unknown and the change counts org-wide.
                None => Vec::new(),
            };
            let open = stored.filter(|_| !a.deleted).and_then(|s| {
                link(
                    "alerts",
                    &[
                        ("action", "update"),
                        ("alert_id", &id),
                        ("folder", &s.folder),
                    ],
                )
            });
            let name = a
                .target
                .clone()
                .or_else(|| stored.map(|s| s.name.clone()))
                .unwrap_or_default();
            let subject = EntityRef::new(kinds::ALERT, &[(dims::ENTITY_ID, &id)]);
            (subject, name, affects, open)
        }
    };
    Some(ChangeRecord {
        provider: String::new(),
        kind: a.change.kind,
        at: a.at,
        until: None,
        actor: Some(a.actor).filter(|actor| !actor.is_empty()),
        subject,
        subject_name: name,
        affects,
        link: Confidence::Exact,
        count: None,
        facts: BTreeMap::new(),
        needs: Some(Need::Subject),
        open,
    })
}

/// Pipeline names are not unique, so only a single match names the pipeline a call created.
fn only_named(names: &BTreeMap<String, String>, name: &str) -> Option<String> {
    let name = name.trim().to_lowercase();
    let mut ids = names
        .iter()
        .filter(|(_, n)| n.trim().to_lowercase() == name)
        .map(|(id, _)| id);
    match (ids.next(), ids.next()) {
        (Some(id), None) => Some(id.clone()),
        _ => None,
    }
}

fn pipeline_id(id: &str, edit: PipelineEdit) -> Object {
    Object::Pipeline {
        id: Some(id.to_string()),
        name: None,
        edit,
    }
}

fn token(id: &str, named: bool) -> Object {
    Object::Token {
        id: id.to_string(),
        named,
    }
}

/// Decoded the way the handlers' query extractor decodes it, so `%6detrics` reads as `metrics`.
fn query_value(query: &str, key: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes())
        .find_map(|(k, v)| (k == key).then(|| v.into_owned()))
}

/// The stream routes default to logs when the call names no type.
fn stream_type_of(query: &str) -> StreamType {
    query_value(query, "type").map_or(StreamType::Logs, |t| StreamType::from(t.as_str()))
}

fn body_stream(body: &str) -> Option<EntityRef> {
    let name = body_field(body, "stream_name")?;
    let stream_type =
        body_field(body, "stream_type").map_or(StreamType::Logs, |t| StreamType::from(t.as_str()));
    Some(stream_ref(stream_type, &name))
}

/// The audit keeps only the first `BODY_CHARS` of a body, so a cut body is scanned, not parsed.
fn body_field(body: &str, key: &str) -> Option<String> {
    if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(body) {
        return map.get(key)?.as_str().map(str::to_string);
    }
    let needle = format!("\"{key}\"");
    let rest = body[body.find(&needle)? + needle.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start().strip_prefix('"')?;
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => out.push(chars.next()?),
            c => out.push(c),
        }
    }
    None
}

/// A cut body still names every id whose closing quote it kept.
fn body_ids(body: &str) -> Vec<String> {
    if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(body) {
        let ids = map.get("ids").and_then(Value::as_array);
        return ids
            .into_iter()
            .flatten()
            .filter_map(|id| id.as_str().map(str::to_string))
            .collect();
    }
    let Some((_, list)) = body
        .split_once("\"ids\"")
        .and_then(|(_, r)| r.split_once('['))
    else {
        return Vec::new();
    };
    let pieces: Vec<&str> = list
        .split(']')
        .next()
        .unwrap_or_default()
        .split('"')
        .collect();
    (1..pieces.len().saturating_sub(1))
        .step_by(2)
        .map(|i| pieces[i].to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::{
        pipeline::{
            Pipeline,
            components::{Node, NodeData, PipelineSource},
        },
        stream::StreamParams,
    };
    use o2_enterprise::enterprise::{
        autoobserve::context,
        common::auditor::{AuditMessage, Protocol, ResponseMeta},
    };

    use super::{
        super::tests::{FakeLookups, MemSearch, ask, fields},
        *,
    };

    fn logs(name: &str) -> EntityRef {
        stream_ref(StreamType::Logs, name)
    }

    #[test]
    fn audited_calls_map_to_the_change_they_made() {
        let change = |kind, object| vec![Change { kind, object }];
        let pipeline = |id: Option<&str>, name: Option<&str>| Object::Pipeline {
            id: id.map(str::to_string),
            name: name.map(str::to_string),
            edit: PipelineEdit::Config,
        };
        let alert = |id: Option<&str>, stream: Option<EntityRef>| Object::Alert {
            id: id.map(str::to_string),
            stream,
        };
        let toggle = |id| {
            change(
                ChangeKind::PipelineChanged,
                pipeline_id(id, PipelineEdit::Toggle),
            )
        };
        let bulk = |id| {
            change(
                ChangeKind::PipelineChanged,
                pipeline_id(id, PipelineEdit::BulkToggle),
            )
        };
        let (p1, p2) = (bulk("p1"), bulk("p2"));
        let ids: Vec<String> = (0..=BULK_IDS).map(|i| format!("p{i}")).collect();
        let many = serde_json::json!({ "ids": ids }).to_string();
        let capped: Vec<Change> = ids[..BULK_IDS]
            .iter()
            .flat_map(|id| bulk(id.as_str()))
            .collect();
        let alert_body = r#"{"name":"5xx","stream_type":"logs","stream_name":"app","query_condition":{"sql":"SELECT"#;
        let cases = [
            (
                "PUT",
                "acme/streams/app/settings",
                "type=logs",
                "",
                change(ChangeKind::SettingsChanged, Object::Stream(logs("app"))),
            ),
            (
                "PUT",
                "acme/streams/cpu/update_fields",
                "type=metrics",
                "",
                change(
                    ChangeKind::SettingsChanged,
                    Object::Stream(stream_ref(StreamType::Metrics, "cpu")),
                ),
            ),
            (
                "PUT",
                "acme/streams/cpu/settings",
                "type=%6detrics",
                "",
                change(
                    ChangeKind::SettingsChanged,
                    Object::Stream(stream_ref(StreamType::Metrics, "cpu")),
                ),
            ),
            (
                "DELETE",
                "acme/streams/app",
                "",
                "",
                change(ChangeKind::StreamDeleted, Object::Stream(logs("app"))),
            ),
            (
                "DELETE",
                "acme/streams/app/cache/results",
                "",
                "",
                Vec::new(),
            ),
            (
                "PUT",
                "acme/passcode",
                "",
                "",
                change(ChangeKind::TokenChanged, token("passcode", false)),
            ),
            (
                "POST",
                "acme/rumtoken",
                "",
                "",
                change(ChangeKind::TokenChanged, token("rumtoken", false)),
            ),
            (
                "POST",
                "acme/ingestion-tokens",
                "",
                r#"{"name":"ci"}"#,
                change(ChangeKind::TokenChanged, token("ci", true)),
            ),
            (
                "PATCH",
                "acme/ingestion-tokens/ci",
                "",
                "",
                change(ChangeKind::TokenChanged, token("ci", true)),
            ),
            (
                "PUT",
                "acme/pipelines",
                "",
                r#"{"name":"mask","pipeline_id":"p1","nodes":[{"id":"#,
                change(
                    ChangeKind::PipelineChanged,
                    pipeline(Some("p1"), Some("mask")),
                ),
            ),
            (
                "POST",
                "acme/pipelines",
                "",
                r#"{"pipeline_id":"p1","name":"mask"}"#,
                change(ChangeKind::PipelineChanged, pipeline(None, Some("mask"))),
            ),
            (
                "POST",
                "acme/pipelines",
                "overwrite=true",
                r#"{"pipeline_id":"p1","name":"mask"}"#,
                change(
                    ChangeKind::PipelineChanged,
                    pipeline(Some("p1"), Some("mask")),
                ),
            ),
            (
                "POST",
                "acme/pipelines",
                "overwrite=%74rue",
                r#"{"pipeline_id":"p1","name":"mask"}"#,
                change(
                    ChangeKind::PipelineChanged,
                    pipeline(Some("p1"), Some("mask")),
                ),
            ),
            (
                "DELETE",
                "acme/pipelines/p1",
                "",
                "",
                change(ChangeKind::PipelineChanged, pipeline(Some("p1"), None)),
            ),
            (
                "PUT",
                "acme/pipelines/p1/enable",
                "value=false",
                "",
                toggle("p1"),
            ),
            (
                "PUT",
                "acme/pipelines/p1/enable",
                "value=true",
                "",
                toggle("p1"),
            ),
            (
                "PUT",
                "acme/pipelines/p1/enable",
                "value=%66alse",
                "",
                toggle("p1"),
            ),
            ("DELETE", "acme/pipelines/bulk", "", "", Vec::new()),
            (
                "POST",
                "acme/pipelines/bulk/enable",
                "value=true",
                r#"{"ids":["p1","p2"]}"#,
                [p1.clone(), p2].concat(),
            ),
            (
                "POST",
                "acme/pipelines/bulk/enable",
                "value=false",
                r#"{"ids":["p1","p"#,
                p1.clone(),
            ),
            (
                "POST",
                "acme/pipelines/bulk/enable",
                "value=true",
                r#"{"ids":["p1","p1"]}"#,
                p1,
            ),
            (
                "POST",
                "acme/pipelines/bulk/enable",
                "value=true",
                &many,
                capped,
            ),
            (
                "POST",
                "v2/acme/alerts",
                "",
                alert_body,
                change(ChangeKind::AlertChanged, alert(None, Some(logs("app")))),
            ),
            (
                "PUT",
                "v2/acme/alerts/a1",
                "",
                alert_body,
                change(
                    ChangeKind::AlertChanged,
                    alert(Some("a1"), Some(logs("app"))),
                ),
            ),
            (
                "DELETE",
                "v2/acme/alerts/a1",
                "",
                "",
                change(ChangeKind::AlertChanged, alert(Some("a1"), None)),
            ),
            ("POST", "v2/acme/alerts/a1/ack", "", "", Vec::new()),
            ("POST", "v2/acme/alerts/a1/unack", "", "", Vec::new()),
            (
                "POST",
                "v2/acme/alerts/a1/mute",
                "",
                r#"{"duration":60}"#,
                Vec::new(),
            ),
            ("GET", "acme/streams/app/schema", "", "", Vec::new()),
        ];
        for (method, path, query, body, want) in cases {
            assert_eq!(
                change_of(method, path, query, body),
                want,
                "{method} {path}?{query}"
            );
        }
    }

    fn audit_row(at: i64, method: &str, path: &str, query: &str, body: &str) -> Value {
        let msg = AuditMessage {
            user_email: "priya@acme.io".to_string(),
            org_id: "acme".to_string(),
            _timestamp: at,
            protocol: Protocol::Http,
            login_ip: None,
            user_agent: None,
            response_meta: ResponseMeta {
                http_method: method.to_string(),
                http_path: path.to_string(),
                http_query_params: query.to_string(),
                http_body: body.to_string(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
            delegated: None,
            fleet_id: None,
            target: None,
        };
        serde_json::to_value(msg).unwrap()
    }

    fn pipeline(id: &str, source: &str) -> Pipeline {
        let params = StreamParams::new("acme", source, StreamType::Logs);
        Pipeline {
            id: id.to_string(),
            version: 1,
            enabled: true,
            org: "acme".to_string(),
            name: id.to_string(),
            description: String::new(),
            source: PipelineSource::Realtime(params.clone()),
            kind: Default::default(),
            nodes: vec![Node::new(
                "in".into(),
                NodeData::Stream(params),
                0.0,
                0.0,
                "input".into(),
            )],
            edges: Vec::new(),
        }
    }

    /// Calls on other streams, other orgs, reads, acks, failed calls, bulk toggles of pipelines the
    /// org does not have and calls outside the window are dropped.
    #[tokio::test]
    async fn audit_rows_become_changes_that_touch_the_issue_streams() {
        let rows = vec![
            audit_row(100, "PUT", "acme/streams/app/settings", "type=logs", "{}"),
            audit_row(110, "DELETE", "acme/streams/app_old", "type=logs", ""),
            audit_row(115, "DELETE", "acme/streams/api", "type=logs", ""),
            audit_row(120, "PATCH", "acme/ingestion-tokens/ci", "", "{}"),
            audit_row(130, "PUT", "acme/pipelines", "", r#"{"pipeline_id":"p1"}"#),
            audit_row(
                132,
                "POST",
                "acme/pipelines",
                "",
                r#"{"name":"Mask-App ","nodes":[{"id":"#,
            ),
            audit_row(
                133,
                "POST",
                "acme/pipelines",
                "",
                r#"{"name":"p9","nodes":[{"id":"#,
            ),
            audit_row(134, "PUT", "acme/pipelines/p8/enable", "value=false", ""),
            audit_row(135, "PUT", "acme/pipelines", "", r#"{"pipeline_id":"p9"}"#),
            audit_row(136, "PUT", "acme/pipelines/p1/enable", "value=false", ""),
            audit_row(137, "DELETE", "acme/pipelines/p7", "", ""),
            audit_row(138, "PUT", "acme/pipelines/p1/enable", "value=true", ""),
            audit_row(
                139,
                "POST",
                "acme/pipelines/bulk/enable",
                "value=true",
                r#"{"ids":["p2","p9","p404"]}"#,
            ),
            audit_row(140, "PUT", "v2/acme/alerts/a1", "", "{}"),
            audit_row(142, "DELETE", "v2/acme/alerts/a7", "", ""),
            audit_row(145, "POST", "v2/acme/alerts/a1/ack", "", ""),
            audit_row(150, "GET", "acme/streams/app/schema", "", ""),
            audit_row(5_000, "PUT", "acme/streams/app/settings", "", "{}"),
        ];
        let mut rows = rows;
        let alert = rows.iter_mut().find(|r| r["_timestamp"] == 140).unwrap();
        alert["target"] = "5xx".into();
        for (at, method, path, code) in [
            (105, "PUT", "acme/streams/app/settings", 400),
            (125, "DELETE", "acme/streams/api", 500),
        ] {
            let mut failed = audit_row(at, method, path, "type=logs", "");
            failed["http_response_code"] = code.into();
            rows.push(failed);
        }
        let mut other_org = audit_row(160, "DELETE", "other/streams/app", "", "");
        other_org["org_id"] = "other".into();
        let mut all = rows;
        all.push(other_org);
        let written = fields(&all);
        let search = MemSearch::new(vec![(AUDIT_STREAM, all)]);
        let mut lookups = FakeLookups {
            pipelines: vec![
                pipeline("p1", "app"),
                Pipeline {
                    name: "mask-app".to_string(),
                    ..pipeline("p2", "app")
                },
                pipeline("p9", "elsewhere"),
            ],
            alerts: vec![AlertStream {
                id: "a1".to_string(),
                name: "5xx".to_string(),
                folder: "ops".to_string(),
                stream: logs("app"),
            }],
            audit_enabled: false,
            fields: Default::default(),
        };
        let ask = ask("acme", &[("logs", "app"), ("logs", "api")], (0, 1_000));

        assert_eq!(
            read_with(&search, &lookups, &ask).await,
            (Checked::Off, Vec::new())
        );
        lookups.audit_enabled = true;
        assert_eq!(
            read_with(&search, &lookups, &ask).await,
            (Checked::Ok, Vec::new())
        );
        lookups.fields = written;
        let (state, records) = read_with(&search, &lookups, &ask).await;

        assert_eq!(state, Checked::Ok);
        let got: Vec<_> = records
            .iter()
            .map(|r| (r.at, r.kind, r.subject.kind.as_str(), r.affects.clone()))
            .collect();
        assert_eq!(
            got,
            [
                (142, ChangeKind::AlertChanged, kinds::ALERT, Vec::new()),
                (
                    140,
                    ChangeKind::AlertChanged,
                    kinds::ALERT,
                    vec![logs("app")]
                ),
                (
                    139,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    vec![logs("app")]
                ),
                (
                    138,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    vec![logs("app")]
                ),
                (
                    137,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    Vec::new()
                ),
                (
                    136,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    vec![logs("app")]
                ),
                (
                    135,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    Vec::new()
                ),
                (
                    134,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    Vec::new()
                ),
                (
                    132,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    vec![logs("app")]
                ),
                (
                    130,
                    ChangeKind::PipelineChanged,
                    kinds::PIPELINE,
                    vec![logs("app")]
                ),
                (
                    120,
                    ChangeKind::TokenChanged,
                    kinds::INGESTION_TOKEN,
                    Vec::new()
                ),
                (
                    115,
                    ChangeKind::StreamDeleted,
                    kinds::STREAM,
                    vec![logs("api")]
                ),
                (
                    100,
                    ChangeKind::SettingsChanged,
                    kinds::STREAM,
                    vec![logs("app")]
                ),
            ]
        );
        for issue in &ask.issues {
            let ranked = context::rank(records.clone(), issue, &[]).top;
            // p9 no longer touches app, but the edit may be what cut app off.
            assert!(
                ranked.iter().any(|(r, ..)| r.at == 135),
                "{}",
                issue.decision_id
            );
            // Enabling a pipeline can route its source stream away, so it is a candidate cause.
            assert_eq!(
                ranked.iter().any(|(r, ..)| r.at == 138),
                issue.subject == logs("app"),
                "{}",
                issue.decision_id
            );
            assert!(
                ranked
                    .iter()
                    .all(|(r, ..)| r.subject.kind != kinds::STREAM || r.subject == issue.subject),
                "{}",
                issue.decision_id
            );
        }
        assert!(
            records
                .iter()
                .all(|r| r.actor.as_deref() == Some("priya@acme.io")
                    && r.needs == Some(Need::Subject))
        );
        let at = |t: i64| records.iter().find(|r| r.at == t).unwrap();
        assert_eq!(at(140).subject_name, "5xx");
        assert_eq!(at(100).subject_name, "app");
        assert_eq!(
            at(140).open.as_ref().map(|l| l.query["folder"].as_str()),
            Some("ops")
        );
        assert_eq!(at(132).subject.key_dims[dims::ENTITY_ID], "p2");
        assert_eq!(at(139).subject.key_dims[dims::ENTITY_ID], "p2");
        assert!(at(137).open.is_none() && at(142).open.is_none());
        assert_eq!(*search.orgs.lock().unwrap(), [META_ORG_ID]);
    }
}
