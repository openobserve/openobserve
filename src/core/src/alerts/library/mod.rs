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

//! Ready-made alerts for one stream: library matches, what the org already runs, and starters.

pub mod index;
pub mod matcher;
pub mod needs;
pub mod starters;

use std::collections::HashSet;

use arrow_schema::DataType;
use config::meta::alerts::{Condition, Operator, QueryType, TriggerCondition, alert::Alert};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use self::{
    index::{IndexState, IndexedEntry},
    matcher::{Fit, Match, StreamFacts, match_entry, query_key, replace_relation, severity_rank},
    starters::{Slot, StarterShape},
};

pub const DEFAULT_LIMIT: usize = 4;
pub const MAX_LIMIT: usize = 50;
/// Keys a library file carries that a prefill must never set.
const NOT_PREFILLED: [&str; 4] = ["id", "name", "destinations", "folder_id"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LibraryState {
    Ready,
    Unavailable,
    UnsupportedFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionKind {
    Library,
    Starter,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct StreamRef {
    #[serde(rename = "type")]
    pub stream_type: String,
    pub name: String,
    pub schema_read: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, ToSchema)]
pub struct Counts {
    pub fits: usize,
    pub likely: usize,
    pub already_set_up: usize,
    pub starters: usize,
    pub total: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct StreamSwap {
    pub written_for: String,
    pub will_use: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct AlreadySetUp {
    pub alert_id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct LibraryRef {
    pub pack: String,
    pub path: String,
    pub content_hash: String,
    pub docs_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct StarterRef {
    pub shape: StarterShape,
    pub slots: Vec<Slot>,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct Suggestion {
    pub kind: SuggestionKind,
    pub id: String,
    pub title: Option<String>,
    pub sentence: Option<String>,
    pub severity: Option<String>,
    pub alert_type: String,
    pub query_type: String,
    pub fit: Fit,
    pub matched_fields: Vec<String>,
    pub missing: Vec<String>,
    pub stream_swap: Option<StreamSwap>,
    pub already_set_up: Vec<AlreadySetUp>,
    pub enterprise: bool,
    pub library: Option<LibraryRef>,
    pub starter: Option<StarterRef>,
    /// A create payload for the form's prefill; never sets name, destinations or folder.
    #[schema(value_type = Object)]
    pub prefill: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct SuggestResponse {
    pub library: LibraryState,
    pub library_version: Option<String>,
    pub stream: StreamRef,
    pub counts: Counts,
    pub suggestions: Vec<Suggestion>,
}

/// An alert the caller can see on the picked stream, reduced to what ties it to an entry.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExistingAlert {
    pub id: String,
    pub name: String,
    pub query_key: Option<String>,
    pub condition: Option<Threshold>,
}

impl ExistingAlert {
    pub fn of(alert: &Alert) -> Self {
        let qc = &alert.query_condition;
        let (query_key, condition) = match qc.query_type {
            QueryType::PromQL => (
                qc.promql.as_deref().map(|q| query_key(q, None)),
                qc.promql_condition.as_ref().map(Threshold::of_promql),
            ),
            QueryType::SQL => (
                qc.sql
                    .as_deref()
                    .map(|q| query_key(q, Some(&alert.stream_name))),
                Some(Threshold::of_trigger(&alert.trigger_condition)),
            ),
            _ => (None, None),
        };
        Self {
            id: alert.id.map(|id| id.to_string()).unwrap_or_default(),
            name: alert.name.clone(),
            query_key,
            condition,
        }
    }
}

/// When an alert fires: SQL compares its row count, PromQL each series value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Threshold {
    pub operator: Operator,
    pub value: f64,
}

impl Threshold {
    /// NaN equals nothing, so an unreadable value never ties two alerts.
    const UNREADABLE: Self = Self {
        operator: Operator::EqualTo,
        value: f64::NAN,
    };

    fn of_trigger(trigger: &TriggerCondition) -> Self {
        Self {
            operator: trigger.operator,
            value: trigger.threshold as f64,
        }
    }

    fn of_promql(condition: &Condition) -> Self {
        let value = &condition.value;
        let number = value
            .as_f64()
            .or_else(|| value.as_str().and_then(|s| s.trim().parse().ok()));
        Self {
            operator: condition.operator,
            value: number.unwrap_or(Self::UNREADABLE.value),
        }
    }
}

/// One request: the picked stream and the caller's view of the org.
#[derive(Clone, Debug, Default)]
pub struct SuggestRequest {
    pub facts: StreamFacts,
    /// The stream's schema fields with their types, in schema order.
    pub fields: Vec<(String, DataType)>,
    pub anomaly: bool,
    pub limit: usize,
    pub existing: Vec<ExistingAlert>,
}

pub async fn suggest(request: &SuggestRequest) -> SuggestResponse {
    let state = index::current().await;
    suggest_with(&state, request)
}

/// The answer for one stream from a given library state. Pure.
pub fn suggest_with(state: &IndexState, request: &SuggestRequest) -> SuggestResponse {
    let facts = &request.facts;
    let mut counts = Counts::default();
    let (library, version, mut suggestions) = match state {
        IndexState::Ready(index) => {
            let ranked = ranked_matches(&index.entries, request);
            counts.fits = ranked.iter().filter(|s| s.fit == Fit::Fits).count();
            counts.likely = ranked.len() - counts.fits;
            counts.already_set_up = ranked
                .iter()
                .filter(|s| !s.already_set_up.is_empty())
                .count();
            counts.total = ranked.len();
            let shown = ranked.into_iter().take(request.limit).collect();
            (LibraryState::Ready, Some(index.version.clone()), shown)
        }
        IndexState::Unavailable => (LibraryState::Unavailable, None, Vec::new()),
        IndexState::UnsupportedFormat => (LibraryState::UnsupportedFormat, None, Vec::new()),
    };
    let starters = starter_suggestions(request);
    counts.starters = starters.len();
    suggestions.extend(starters);
    SuggestResponse {
        library,
        library_version: version,
        stream: StreamRef {
            stream_type: facts.stream_type.to_string(),
            name: facts.name.clone(),
            schema_read: !request.fields.is_empty(),
        },
        counts,
        suggestions,
    }
}

/// Steps 4 and 5: not set up first, Fits before Likely, severity, needs met, title; deduped.
fn ranked_matches(entries: &[IndexedEntry], request: &SuggestRequest) -> Vec<Suggestion> {
    let mut found: Vec<(&IndexedEntry, Match, Vec<AlreadySetUp>)> = entries
        .iter()
        .filter(|e| e.anomaly == request.anomaly)
        .filter_map(|e| {
            let found = match_entry(e, &request.facts)?;
            let set_up = already_set_up(e, &request.existing);
            Some((e, found, set_up))
        })
        .collect();
    found.sort_by(|(a, am, au), (b, bm, bu)| {
        (!au.is_empty())
            .cmp(&!bu.is_empty())
            .then(am.fit.cmp(&bm.fit))
            .then(severity_rank(&a.entry.severity).cmp(&severity_rank(&b.entry.severity)))
            .then(bm.matched.len().cmp(&am.matched.len()))
            .then(a.entry.title.cmp(&b.entry.title))
    });
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter(|(e, ..)| seen.insert(format!("{:?}|{}", e.needs, entry_query_key(e))))
        .map(|(e, m, set_up)| library_suggestion(e, m, set_up, &request.facts))
        .collect()
}

fn library_suggestion(
    e: &IndexedEntry,
    found: Match,
    already_set_up: Vec<AlreadySetUp>,
    facts: &StreamFacts,
) -> Suggestion {
    let entry = &e.entry;
    let alert_type = entry.alert_type.clone().unwrap_or_else(|| {
        if e.anomaly {
            "anomaly_detection".to_string()
        } else {
            "scheduled".to_string()
        }
    });
    Suggestion {
        kind: SuggestionKind::Library,
        id: entry.id.clone(),
        title: Some(entry.title.clone()),
        sentence: Some(entry.description.clone()),
        severity: Some(entry.severity.clone()).filter(|s| !s.is_empty()),
        alert_type,
        query_type: entry.query_type.clone(),
        fit: found.fit,
        matched_fields: found.matched,
        missing: found.missing,
        stream_swap: found.swap.then(|| StreamSwap {
            written_for: written_for(e),
            will_use: facts.name.clone(),
        }),
        already_set_up,
        enterprise: e.anomaly,
        library: Some(LibraryRef {
            pack: entry.pack.clone(),
            path: entry.path.clone(),
            content_hash: entry.content_hash.clone(),
            docs_url: entry.docs_url.clone(),
        }),
        starter: None,
        prefill: prefill(e, found.swap, &facts.name),
    }
}

fn written_for(e: &IndexedEntry) -> String {
    e.file
        .get("stream_name")
        .and_then(Value::as_str)
        .unwrap_or(&e.entry.stream)
        .to_string()
}

/// The alert file as a create payload, re-pointed at `stream` when it was written for another.
fn prefill(e: &IndexedEntry, swap: bool, stream: &str) -> Value {
    let mut file = e.file.clone();
    let Some(obj) = file.as_object_mut() else {
        return Value::Null;
    };
    for key in NOT_PREFILLED {
        obj.remove(key);
    }
    if !swap {
        return file;
    }
    let from = written_for(e);
    obj.insert("stream_name".to_string(), Value::String(stream.to_string()));
    for (parent, key) in [("query_condition", "sql"), ("anomaly_config", "custom_sql")] {
        if let Some(sql) = obj
            .get_mut(parent)
            .and_then(|p| p.get_mut(key))
            .filter(|v| v.is_string())
        {
            let swapped = replace_relation(sql.as_str().unwrap_or_default(), &from, stream);
            *sql = Value::String(swapped);
        }
    }
    file
}

fn entry_query_key(e: &IndexedEntry) -> String {
    let qc = e.file.get("query_condition");
    let anomaly = e.file.get("anomaly_config");
    if let Some(promql) = str_of(qc, "promql").filter(|_| str_of(qc, "type") == Some("promql")) {
        return query_key(promql, None);
    }
    let stream = written_for(e);
    match str_of(qc, "sql").or_else(|| str_of(anomaly, "custom_sql")) {
        Some(sql) => query_key(sql, Some(&stream)),
        None => serde_json::to_string(&anomaly).unwrap_or_default(),
    }
}

fn str_of<'a>(value: Option<&'a Value>, key: &str) -> Option<&'a str> {
    value?.get(key)?.as_str()
}

/// The entry's firing rule as an installed alert stores it.
/// A PromQL entry without one compares inside its query, which the query key holds.
fn entry_condition(e: &IndexedEntry) -> Option<Threshold> {
    let qc = e.file.get("query_condition");
    if str_of(qc, "type") == Some("promql") {
        let condition = qc?.get("promql_condition").filter(|c| !c.is_null())?;
        let parsed = serde_json::from_value::<Condition>(condition.clone());
        return Some(parsed.map_or(Threshold::UNREADABLE, |c| Threshold::of_promql(&c)));
    }
    let trigger = e.file.get("trigger_condition")?;
    serde_json::from_value::<TriggerCondition>(trigger.clone())
        .ok()
        .map(|t| Threshold::of_trigger(&t))
}

/// The caller's alerts on this stream with the entry's query and firing rule.
fn already_set_up(e: &IndexedEntry, existing: &[ExistingAlert]) -> Vec<AlreadySetUp> {
    // Anomaly configs are not in the alert list, and a learned band has no threshold to compare.
    if e.anomaly || existing.is_empty() {
        return Vec::new();
    }
    let key = entry_query_key(e);
    let condition = entry_condition(e);
    existing
        .iter()
        .filter(|alert| alert.query_key.as_deref() == Some(key.as_str()))
        .filter(|alert| alert.condition == condition)
        .map(|alert| AlreadySetUp {
            alert_id: alert.id.clone(),
            name: alert.name.clone(),
        })
        .collect()
}

fn starter_suggestions(request: &SuggestRequest) -> Vec<Suggestion> {
    let stream_type = request.facts.stream_type.as_str();
    if request.anomaly || !matches!(stream_type, "logs" | "traces") {
        return Vec::new();
    }
    starters::starters(stream_type, &request.facts.name, &request.fields)
        .into_iter()
        .map(|s| Suggestion {
            kind: SuggestionKind::Starter,
            id: s.shape.id().to_string(),
            title: None,
            sentence: None,
            severity: None,
            alert_type: "scheduled".to_string(),
            query_type: "custom".to_string(),
            fit: Fit::Fits,
            matched_fields: Vec::new(),
            missing: Vec::new(),
            stream_swap: None,
            already_set_up: Vec::new(),
            enterprise: false,
            library: None,
            starter: Some(StarterRef {
                shape: s.shape,
                slots: s.slots,
            }),
            prefill: s.prefill,
        })
        .collect()
}

#[cfg(test)]
mod tests;
