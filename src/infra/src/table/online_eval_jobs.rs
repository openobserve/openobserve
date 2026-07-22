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

use std::collections::BTreeMap;

use config::meta::{
    alerts::{ConditionGroup, ConditionList},
    pipeline::components::{ConditionParams, ScorerRef},
    self_reporting::{
        evaluator::EVALUATOR_STREAM, llm_scores::LLM_SCORES_STREAM,
        usage::is_reserved_self_reporting_stream,
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, Schema, Set,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::entity::online_eval_jobs::{ActiveModel, Column, Entity, Model},
};

/// Valid job states.
pub const VALID_STATUSES: &[&str] = &["draft", "active", "paused", "degraded", "archived"];

/// Lowest configurable idle window, matching the default scheduler poll interval.
pub const MIN_COMPLETION_IDLE_WINDOW_SECS: i64 = 45;
pub const DEFAULT_TRACE_IDLE_WINDOW_SECS: i64 = 2 * 60;
pub const DEFAULT_TRACE_MAX_AGE_SECS: i64 = 30 * 60;
pub const DEFAULT_SESSION_IDLE_WINDOW_SECS: i64 = 2 * 60;
pub const DEFAULT_SESSION_MAX_AGE_SECS: i64 = 4 * 60 * 60;

pub type ScorerInputMapping = BTreeMap<String, String>;
pub type JobInputMapping = BTreeMap<String, ScorerInputMapping>;
pub type SpanSelectorBindings = BTreeMap<String, String>;

pub const DEFAULT_SPAN_SELECTOR_MAXIMUM_SPANS: usize = 5;
pub const SPAN_SELECTOR_FIELD_VALUE_MAX_CHARS: usize = 1_000;
pub const SPAN_SELECTOR_OUTPUT_MAX_CHARS: usize = 40_000;
pub const DEFAULT_SPAN_SELECTOR_FIELDS: [&str; 8] = [
    "name",
    "status",
    "gen_ai_tool_name",
    "gen_ai_tool_call_id",
    "gen_ai_tool_call_arguments",
    "gen_ai_tool_call_result",
    "gen_ai_input_messages",
    "gen_ai_output_messages",
];

pub fn is_reserved_eval_source_stream(stream: &str) -> bool {
    let stream = stream.trim().to_ascii_lowercase();
    stream == EVALUATOR_STREAM
        || stream == LLM_SCORES_STREAM
        || is_reserved_self_reporting_stream(&stream)
        || matches!(
            stream.as_str(),
            "eval.task.span"
                | "eval.task.trace"
                | "eval.task.session"
                | "o2_eval_task_span"
                | "o2_eval_task_trace"
                | "o2_eval_task_session"
        )
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanSelectorFieldMode {
    #[default]
    Default,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SpanSelector {
    pub id: String,
    pub name: String,
    pub filter_condition: serde_json::Value,
    pub field_mode: SpanSelectorFieldMode,
    pub fields: Vec<String>,
    pub maximum_spans: usize,
}

impl Default for SpanSelector {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            filter_condition: serde_json::json!({}),
            field_mode: SpanSelectorFieldMode::Default,
            fields: Vec::new(),
            maximum_spans: DEFAULT_SPAN_SELECTOR_MAXIMUM_SPANS,
        }
    }
}

impl SpanSelector {
    pub fn field_count(&self) -> usize {
        match self.field_mode {
            SpanSelectorFieldMode::Default => DEFAULT_SPAN_SELECTOR_FIELDS.len(),
            SpanSelectorFieldMode::Custom => self.fields.len(),
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() {
            return Err("Span Selector id cannot be empty");
        }
        if self.name.trim().is_empty() {
            return Err("Span Selector name cannot be empty");
        }
        if self.maximum_spans == 0 {
            return Err("Span Selector maximumSpans must be greater than zero");
        }
        if !is_valid_selector_filter(&self.filter_condition) {
            return Err("Span Selector filterCondition is invalid");
        }

        if matches!(self.field_mode, SpanSelectorFieldMode::Custom) {
            if self.fields.is_empty() {
                return Err("Custom Span Selector schema requires at least one field");
            }
            let mut fields = std::collections::BTreeSet::new();
            for field in &self.fields {
                let field = field.trim();
                if field.is_empty() {
                    return Err("Span Selector field names cannot be empty");
                }
                if !fields.insert(field) {
                    return Err("Span Selector fields must be unique");
                }
            }
        }

        if self
            .maximum_spans
            .saturating_mul(self.field_count())
            .saturating_mul(SPAN_SELECTOR_FIELD_VALUE_MAX_CHARS)
            > SPAN_SELECTOR_OUTPUT_MAX_CHARS
        {
            return Err("Span Selector output budget exceeds 40000 characters");
        }
        Ok(())
    }
}

fn is_valid_selector_filter(filter: &serde_json::Value) -> bool {
    if filter.is_null()
        || filter.as_object().is_some_and(|value| value.is_empty())
        || filter
            .get("type")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("all"))
    {
        return true;
    }

    if let Ok(condition) = serde_json::from_value::<ConditionParams>(filter.clone()) {
        return match condition {
            ConditionParams::V1 { conditions } => conditions.has_conditions(),
            ConditionParams::V2 { conditions } => conditions.validate().is_ok(),
        };
    }
    if let Ok(conditions) = serde_json::from_value::<ConditionGroup>(filter.clone()) {
        return conditions.validate().is_ok();
    }
    serde_json::from_value::<ConditionList>(filter.clone())
        .is_ok_and(|conditions| conditions.has_conditions())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SamplingMode {
    #[default]
    Rate,
    All,
    Count,
}

impl SamplingMode {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Rate => "rate",
            Self::All => "all",
            Self::Count => "count",
        }
    }
}

impl std::str::FromStr for SamplingMode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "rate" => Ok(Self::Rate),
            "all" => Ok(Self::All),
            "count" => Ok(Self::Count),
            _ => Err(value.to_string()),
        }
    }
}

impl std::fmt::Display for SamplingMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetScope {
    #[default]
    Span,
    Trace,
    Session,
    #[serde(other)]
    Unknown,
}

impl TargetScope {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Span => "span",
            Self::Trace => "trace",
            Self::Session => "session",
            Self::Unknown => "unknown",
        }
    }

    pub fn uses_hidden_pipeline(&self) -> bool {
        matches!(self, Self::Span)
    }
}

impl std::str::FromStr for TargetScope {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.to_ascii_lowercase().as_str() {
            "span" => Ok(Self::Span),
            "trace" => Ok(Self::Trace),
            "session" => Ok(Self::Session),
            "unknown" => Ok(Self::Unknown),
            _ => Err(value.to_string()),
        }
    }
}

impl std::fmt::Display for TargetScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TraceEvalConfig {
    pub idle_window_secs: i64,
    pub max_age_secs: i64,
    pub end_signal: Option<serde_json::Value>,
}

impl Default for TraceEvalConfig {
    fn default() -> Self {
        Self {
            idle_window_secs: DEFAULT_TRACE_IDLE_WINDOW_SECS,
            max_age_secs: DEFAULT_TRACE_MAX_AGE_SECS,
            end_signal: None,
        }
    }
}

impl TraceEvalConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_completion_window(self.idle_window_secs, self.max_age_secs)?;
        validate_end_signal(self.end_signal.as_ref())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SessionEvalConfig {
    pub idle_window_secs: i64,
    pub max_age_secs: i64,
    pub end_signal: Option<serde_json::Value>,
}

impl Default for SessionEvalConfig {
    fn default() -> Self {
        Self {
            idle_window_secs: DEFAULT_SESSION_IDLE_WINDOW_SECS,
            max_age_secs: DEFAULT_SESSION_MAX_AGE_SECS,
            end_signal: None,
        }
    }
}

impl SessionEvalConfig {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_completion_window(self.idle_window_secs, self.max_age_secs)?;
        validate_end_signal(self.end_signal.as_ref())
    }
}

fn validate_end_signal(end_signal: Option<&serde_json::Value>) -> Result<(), &'static str> {
    let Some(end_signal) = end_signal else {
        return Ok(());
    };

    let condition = serde_json::from_value::<ConditionParams>(end_signal.clone())
        .map_err(|_| "End signal must be a valid condition")?;

    match condition {
        ConditionParams::V1 { conditions } if conditions.has_conditions() => Ok(()),
        ConditionParams::V2 { conditions } if conditions.validate().is_ok() => Ok(()),
        _ => Err("End signal must contain at least one condition"),
    }
}

fn validate_completion_window(
    idle_window_secs: i64,
    max_age_secs: i64,
) -> Result<(), &'static str> {
    if idle_window_secs < MIN_COMPLETION_IDLE_WINDOW_SECS {
        return Err("Completion idle window must be at least 45 seconds");
    }
    if max_age_secs <= 0 {
        return Err("Completion max age must be greater than zero");
    }
    if idle_window_secs > max_age_secs {
        return Err("Completion idle window cannot exceed max age");
    }
    Ok(())
}

/// Valid state transitions. Maps from current state to allowed next states.
pub fn is_valid_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("draft", "active")
            | ("active", "paused")
            | ("active", "degraded")
            | ("paused", "active")
            | ("degraded", "paused")
            | ("degraded", "active")
            | (_, "archived")
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OnlineEvalJob {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub stream: String,
    pub stream_type: String,
    #[serde(default)]
    pub target_scope: TargetScope,
    pub filter_condition: serde_json::Value,
    pub scorers: Vec<ScorerRef>,
    pub input_mapping: Option<JobInputMapping>,
    #[serde(default)]
    pub span_selectors: Vec<SpanSelector>,
    #[serde(default)]
    pub span_selector_bindings: SpanSelectorBindings,
    #[serde(default)]
    pub trace_config: Option<TraceEvalConfig>,
    #[serde(default)]
    pub session_config: Option<SessionEvalConfig>,
    pub sampling_mode: SamplingMode,
    pub sampling_value: serde_json::Value,
    pub status: String,
    pub version: i32,
    pub pipeline_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl OnlineEvalJob {
    /// Return the effective whole-target sampling rate for this job.
    ///
    /// The public API uses a scalar `samplingValue` for rate sampling. Older
    /// persisted jobs used `{ "rate": value }`, so keep accepting that shape
    /// while treating malformed or unsupported configurations as errors.
    pub fn sampling_rate(&self) -> Result<f64, &'static str> {
        match self.sampling_mode {
            SamplingMode::All => Ok(1.0),
            SamplingMode::Rate => {
                let rate = self.sampling_value.as_f64().or_else(|| {
                    self.sampling_value
                        .get("rate")
                        .and_then(serde_json::Value::as_f64)
                });

                match rate {
                    Some(rate) if (0.0..=1.0).contains(&rate) => Ok(rate),
                    _ => Err("Rate sampling requires samplingValue to be a number between 0 and 1"),
                }
            }
            SamplingMode::Count => Err("Count sampling is not supported; use rate or all"),
        }
    }

    /// Validate and convert sampling values to the canonical public API shape.
    /// Rate values are stored as a scalar and all-mode values as JSON null.
    pub fn normalize_sampling(&mut self) -> Result<(), &'static str> {
        let rate = self.sampling_rate()?;
        self.sampling_value = match self.sampling_mode {
            SamplingMode::Rate => serde_json::json!(rate),
            SamplingMode::All => serde_json::Value::Null,
            SamplingMode::Count => unreachable!("count mode is rejected by sampling_rate"),
        };
        Ok(())
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if is_reserved_eval_source_stream(&self.stream) {
            return Err("Internal streams cannot be used as online eval sources");
        }
        self.validate_target_scope()?;
        self.validate_span_selectors()?;
        self.sampling_rate()?;
        Ok(())
    }

    pub fn validate_for_activation(&self) -> Result<(), &'static str> {
        self.validate()?;
        if !matches!(self.target_scope, TargetScope::Trace) {
            return Ok(());
        }
        for scorer in &self.scorers {
            if !self.span_selector_bindings.contains_key(&scorer.id) {
                return Err("Every trace scorer must have a Span Selector binding");
            }
        }
        Ok(())
    }

    pub fn selector_for_scorer(&self, scorer_id: &str) -> Option<&SpanSelector> {
        let selector_id = self.span_selector_bindings.get(scorer_id)?;
        self.span_selectors
            .iter()
            .find(|selector| selector.id == *selector_id)
    }

    fn validate_span_selectors(&self) -> Result<(), &'static str> {
        if !matches!(self.target_scope, TargetScope::Trace) {
            if !self.span_selectors.is_empty() || !self.span_selector_bindings.is_empty() {
                return Err("Span Selectors are supported only for trace eval jobs");
            }
            return Ok(());
        }

        let scorer_ids = self
            .scorers
            .iter()
            .map(|scorer| scorer.id.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        let mut selector_ids = std::collections::BTreeSet::new();
        let mut selector_names = std::collections::BTreeSet::new();
        for selector in &self.span_selectors {
            selector.validate()?;
            if !selector_ids.insert(selector.id.as_str()) {
                return Err("Span Selector ids must be unique within a job");
            }
            if !selector_names.insert(selector.name.trim().to_ascii_lowercase()) {
                return Err("Span Selector names must be unique within a job");
            }
        }
        for (scorer_id, selector_id) in &self.span_selector_bindings {
            if !scorer_ids.contains(scorer_id.as_str()) {
                return Err("Span Selector binding references an unselected scorer");
            }
            if !selector_ids.contains(selector_id.as_str()) {
                return Err("Span Selector binding references an unknown selector");
            }
        }
        Ok(())
    }

    pub fn apply_target_scope_defaults(&mut self) {
        match self.target_scope {
            TargetScope::Span => {
                self.trace_config = None;
                self.session_config = None;
            }
            TargetScope::Trace => {
                self.trace_config
                    .get_or_insert_with(TraceEvalConfig::default);
                self.session_config = None;
            }
            TargetScope::Session => {
                self.trace_config = None;
                self.session_config
                    .get_or_insert_with(SessionEvalConfig::default);
            }
            TargetScope::Unknown => {
                self.trace_config = None;
                self.session_config = None;
                self.pipeline_id = None;
            }
        }
    }

    pub fn validate_target_scope(&self) -> Result<(), &'static str> {
        if matches!(self.target_scope, TargetScope::Unknown) {
            return Err("Invalid target scope");
        }

        if !self.stream_type.eq_ignore_ascii_case("traces") {
            return Err("Online eval jobs require a traces stream");
        }

        match self.target_scope {
            TargetScope::Span => Ok(()),
            TargetScope::Trace => self
                .trace_config
                .as_ref()
                .ok_or("Trace eval jobs require trace config")?
                .validate(),
            TargetScope::Session => self
                .session_config
                .as_ref()
                .ok_or("Session eval jobs require session config")?
                .validate(),
            TargetScope::Unknown => Err("Invalid target scope"),
        }
    }

    pub fn uses_hidden_pipeline(&self) -> bool {
        self.target_scope.uses_hidden_pipeline()
    }
}

impl From<Model> for OnlineEvalJob {
    fn from(model: Model) -> Self {
        let target_scope = model.target_scope.parse().unwrap_or(TargetScope::Unknown);
        let mut job = Self {
            id: model.id,
            org_id: model.org_id,
            name: model.name,
            description: model.description,
            stream: model.stream,
            stream_type: model.stream_type,
            target_scope,
            filter_condition: model.filter_condition,
            scorers: serde_json::from_value(model.scorers).unwrap_or_default(),
            input_mapping: model
                .input_mapping
                .and_then(|mapping| serde_json::from_value(mapping).ok()),
            span_selectors: model
                .span_selectors
                .and_then(|selectors| serde_json::from_value(selectors).ok())
                .unwrap_or_default(),
            span_selector_bindings: model
                .span_selector_bindings
                .and_then(|bindings| serde_json::from_value(bindings).ok())
                .unwrap_or_default(),
            trace_config: model
                .trace_config
                .and_then(|config| serde_json::from_value(config).ok()),
            session_config: model
                .session_config
                .and_then(|config| serde_json::from_value(config).ok()),
            sampling_mode: model.sampling_mode.parse().unwrap_or_default(),
            sampling_value: model.sampling_value,
            status: model.status,
            version: model.version,
            pipeline_id: model.pipeline_id,
            created_at: model.created_at,
            updated_at: model.updated_at,
        };
        job.apply_target_scope_defaults();
        job
    }
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client.execute(builder.build(&create_table_stmt)).await?;

    Ok(())
}

pub async fn add(job: &OnlineEvalJob) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(job.id.clone()),
        org_id: Set(job.org_id.clone()),
        name: Set(job.name.clone()),
        description: Set(job.description.clone()),
        stream: Set(job.stream.clone()),
        stream_type: Set(job.stream_type.clone()),
        target_scope: Set(job.target_scope.to_string()),
        filter_condition: Set(job.filter_condition.clone()),
        scorers: Set(serde_json::json!(job.scorers)),
        input_mapping: Set(job
            .input_mapping
            .as_ref()
            .map(|mapping| serde_json::json!(mapping))),
        span_selectors: Set(Some(serde_json::json!(job.span_selectors))),
        span_selector_bindings: Set(Some(serde_json::json!(job.span_selector_bindings))),
        trace_config: Set(job
            .trace_config
            .as_ref()
            .map(|config| serde_json::json!(config))),
        session_config: Set(job
            .session_config
            .as_ref()
            .map(|config| serde_json::json!(config))),
        sampling_mode: Set(job.sampling_mode.to_string()),
        sampling_value: Set(job.sampling_value.clone()),
        status: Set(job.status.clone()),
        version: Set(job.version),
        pipeline_id: Set(job.pipeline_id.clone()),
        created_at: Set(job.created_at),
        updated_at: Set(job.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(job: &OnlineEvalJob) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(job.id.clone()),
        org_id: Set(job.org_id.clone()),
        name: Set(job.name.clone()),
        description: Set(job.description.clone()),
        stream: Set(job.stream.clone()),
        stream_type: Set(job.stream_type.clone()),
        target_scope: Set(job.target_scope.to_string()),
        filter_condition: Set(job.filter_condition.clone()),
        scorers: Set(serde_json::json!(job.scorers)),
        input_mapping: Set(job
            .input_mapping
            .as_ref()
            .map(|mapping| serde_json::json!(mapping))),
        span_selectors: Set(Some(serde_json::json!(job.span_selectors))),
        span_selector_bindings: Set(Some(serde_json::json!(job.span_selector_bindings))),
        trace_config: Set(job
            .trace_config
            .as_ref()
            .map(|config| serde_json::json!(config))),
        session_config: Set(job
            .session_config
            .as_ref()
            .map(|config| serde_json::json!(config))),
        sampling_mode: Set(job.sampling_mode.to_string()),
        sampling_value: Set(job.sampling_value.clone()),
        status: Set(job.status.clone()),
        version: Set(job.version),
        pipeline_id: Set(job.pipeline_id.clone()),
        created_at: Set(job.created_at),
        updated_at: Set(job.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .map(OnlineEvalJob::from);

    Ok(record)
}

pub async fn get_by_org(id: &str, org_id: &str) -> Result<Option<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .map(OnlineEvalJob::from);

    Ok(record)
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

pub async fn get_by_status(
    org_id: &str,
    status: &str,
) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.eq(status))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

pub async fn get_active_trace_session() -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::Status.eq("active"))
        .filter(Column::TargetScope.is_in(["trace", "session"]))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

pub async fn get_by_stream(
    org_id: &str,
    stream: &str,
    stream_type: &str,
) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StreamType.eq(stream_type))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

fn scorer_refs_contain(scorers: &[ScorerRef], scorer_entity_id: &str) -> bool {
    scorers.iter().any(|scorer| scorer.id == scorer_entity_id)
}

pub async fn has_non_archived_by_scorer_ref(
    org_id: &str,
    scorer_entity_id: &str,
) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let jobs = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.ne("archived"))
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from);

    Ok(jobs
        .into_iter()
        .any(|job| scorer_refs_contain(&job.scorers, scorer_entity_id)))
}

pub async fn delete(id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_all_by_org(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn exists(id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

    Ok(record.is_some())
}

/// Update only the status and pipeline_id fields of a job.
pub async fn update_status(
    id: &str,
    status: &str,
    pipeline_id: Option<&str>,
    updated_at: i64,
) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .ok_or_else(|| errors::Error::Message("Job not found".to_string()))?;

    let update = ActiveModel {
        status: Set(status.to_string()),
        pipeline_id: Set(pipeline_id.map(|pid| pid.to_string())),
        updated_at: Set(updated_at),
        ..model.into()
    };
    Entity::update(update).exec(client).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn end_signal() -> serde_json::Value {
        serde_json::json!({
            "version": 2,
            "conditions": {
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [{
                    "filterType": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "complete",
                    "logicalOperator": "AND"
                }]
            }
        })
    }

    fn make_model() -> Model {
        Model {
            id: "job-1".to_string(),
            org_id: "myorg".to_string(),
            name: "qa-eval".to_string(),
            description: Some("Evaluate QA pipeline traces".to_string()),
            stream: "production-logs".to_string(),
            stream_type: "traces".to_string(),
            target_scope: "span".to_string(),
            filter_condition: serde_json::json!({"type": "custom", "conditions": []}),
            scorers: serde_json::json!(["faithfulness_judge"]),
            input_mapping: None,
            span_selectors: None,
            span_selector_bindings: None,
            trace_config: None,
            session_config: None,
            sampling_mode: "rate".to_string(),
            sampling_value: serde_json::json!({"rate": 0.1}),
            status: "draft".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_job_from_model_fields() {
        let model = make_model();
        let job = OnlineEvalJob::from(model);
        assert_eq!(job.id, "job-1");
        assert_eq!(job.org_id, "myorg");
        assert_eq!(job.name, "qa-eval");
        assert_eq!(job.status, "draft");
        assert_eq!(job.version, 1);
        assert_eq!(job.sampling_mode, SamplingMode::Rate);
        assert_eq!(job.target_scope, TargetScope::Span);
        assert_eq!(job.stream, "production-logs");
        assert!(job.pipeline_id.is_none());
    }

    #[test]
    fn test_sampling_rate_accepts_scalar_api_value() {
        let mut model = make_model();
        model.sampling_value = serde_json::json!(0.25);
        let mut job = OnlineEvalJob::from(model);

        assert!((job.sampling_rate().unwrap() - 0.25).abs() < f64::EPSILON);
        assert!(job.validate().is_ok());

        job.sampling_value = serde_json::json!(0.0);
        assert_eq!(job.sampling_rate(), Ok(0.0));
        job.sampling_value = serde_json::json!(1.0);
        assert_eq!(job.sampling_rate(), Ok(1.0));
    }

    #[test]
    fn test_sampling_rate_accepts_legacy_object_value() {
        let mut job = OnlineEvalJob::from(make_model());

        assert!((job.sampling_rate().unwrap() - 0.1).abs() < f64::EPSILON);
        job.normalize_sampling().unwrap();
        assert_eq!(job.sampling_value, serde_json::json!(0.1));
    }

    #[test]
    fn test_normalize_sampling_all_uses_null_value() {
        let mut job = OnlineEvalJob::from(make_model());
        job.sampling_mode = SamplingMode::All;
        job.sampling_value = serde_json::json!({});

        job.normalize_sampling().unwrap();

        assert!(job.sampling_value.is_null());
    }

    #[test]
    fn test_sampling_rate_rejects_invalid_or_unsupported_values() {
        let mut model = make_model();
        model.sampling_value = serde_json::json!(1.01);
        let mut job = OnlineEvalJob::from(model);
        assert_eq!(
            job.sampling_rate(),
            Err("Rate sampling requires samplingValue to be a number between 0 and 1")
        );

        job.sampling_value = serde_json::json!("0.1");
        assert!(job.sampling_rate().is_err());

        job.sampling_value = serde_json::json!(-0.01);
        assert!(job.sampling_rate().is_err());

        job.sampling_mode = SamplingMode::Count;
        job.sampling_value = serde_json::json!(100);
        assert_eq!(
            job.sampling_rate(),
            Err("Count sampling is not supported; use rate or all")
        );
    }

    #[test]
    fn test_job_from_model_active_state() {
        let mut model = make_model();
        model.status = "active".to_string();
        model.pipeline_id = Some("pipeline-1".to_string());
        let job = OnlineEvalJob::from(model);
        assert_eq!(job.status, "active");
        assert_eq!(job.pipeline_id, Some("pipeline-1".to_string()));
    }

    #[test]
    fn test_job_scorers_deserialized() {
        let mut model = make_model();
        model.scorers = serde_json::json!(["s1", "s2", "s3"]);
        let job = OnlineEvalJob::from(model);
        assert_eq!(
            job.scorers,
            vec![
                ScorerRef {
                    id: "s1".to_string(),
                    version: None
                },
                ScorerRef {
                    id: "s2".to_string(),
                    version: None
                },
                ScorerRef {
                    id: "s3".to_string(),
                    version: None
                },
            ]
        );
    }

    #[test]
    fn test_scorer_refs_contain_string_and_pinned_refs() {
        let scorer_refs = vec![
            ScorerRef {
                id: "latest-scorer".to_string(),
                version: None,
            },
            ScorerRef {
                id: "pinned-scorer".to_string(),
                version: Some(2),
            },
        ];

        assert!(scorer_refs_contain(&scorer_refs, "latest-scorer"));
        assert!(scorer_refs_contain(&scorer_refs, "pinned-scorer"));
        assert!(!scorer_refs_contain(&scorer_refs, "missing-scorer"));
    }

    #[test]
    fn test_valid_transitions() {
        assert!(is_valid_transition("draft", "active"));
        assert!(is_valid_transition("active", "paused"));
        assert!(is_valid_transition("paused", "active"));
        assert!(is_valid_transition("active", "degraded"));
        assert!(is_valid_transition("degraded", "paused"));
        assert!(is_valid_transition("degraded", "active"));
        assert!(is_valid_transition("draft", "archived"));
        assert!(is_valid_transition("active", "archived"));
        assert!(is_valid_transition("paused", "archived"));
        assert!(is_valid_transition("degraded", "archived"));
    }

    #[test]
    fn test_trace_scope_model_defaults_trace_config() {
        let mut model = make_model();
        model.target_scope = "trace".to_string();
        let job = OnlineEvalJob::from(model);

        assert_eq!(job.target_scope, TargetScope::Trace);
        assert_eq!(job.trace_config.as_ref().unwrap().idle_window_secs, 120);
        assert!(job.session_config.is_none());
        assert!(!job.uses_hidden_pipeline());
    }

    #[test]
    fn test_session_scope_defaults_and_validates_completion_window() {
        let mut job = OnlineEvalJob {
            id: "job-1".to_string(),
            org_id: "myorg".to_string(),
            name: "session-eval".to_string(),
            description: None,
            stream: "traces".to_string(),
            stream_type: "traces".to_string(),
            target_scope: TargetScope::Session,
            filter_condition: serde_json::json!({}),
            scorers: vec![ScorerRef {
                id: "s1".to_string(),
                version: None,
            }],
            input_mapping: None,
            span_selectors: Vec::new(),
            span_selector_bindings: BTreeMap::new(),
            trace_config: None,
            session_config: Some(SessionEvalConfig {
                idle_window_secs: 10,
                max_age_secs: 5,
                end_signal: None,
            }),
            sampling_mode: SamplingMode::All,
            sampling_value: serde_json::json!(null),
            status: "draft".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 0,
            updated_at: 0,
        };

        assert!(job.validate_target_scope().is_err());
        job.session_config = None;
        job.apply_target_scope_defaults();
        assert_eq!(job.session_config.as_ref().unwrap().idle_window_secs, 120);
        assert_eq!(
            job.session_config.as_ref().unwrap().max_age_secs,
            DEFAULT_SESSION_MAX_AGE_SECS
        );
        assert!(job.trace_config.is_none());
    }

    #[test]
    fn test_trace_end_signal_survives_persisted_json_round_trip() {
        let signal = end_signal();
        let config = TraceEvalConfig {
            idle_window_secs: MIN_COMPLETION_IDLE_WINDOW_SECS,
            max_age_secs: 300,
            end_signal: Some(signal.clone()),
        };
        let persisted_config = serde_json::to_value(&config).unwrap();

        assert_eq!(persisted_config["endSignal"], signal);

        let mut model = make_model();
        model.target_scope = "trace".to_string();
        model.trace_config = Some(persisted_config);
        let job = OnlineEvalJob::from(model);

        assert_eq!(job.trace_config.as_ref().unwrap(), &config);
        assert!(job.validate_target_scope().is_ok());
        assert!(job.session_config.is_none());
    }

    #[test]
    fn test_completion_config_enforces_scheduler_poll_interval_minimum() {
        let below_minimum = TraceEvalConfig {
            idle_window_secs: MIN_COMPLETION_IDLE_WINDOW_SECS - 1,
            ..TraceEvalConfig::default()
        };
        assert_eq!(
            below_minimum.validate(),
            Err("Completion idle window must be at least 45 seconds")
        );

        let at_minimum = TraceEvalConfig {
            idle_window_secs: MIN_COMPLETION_IDLE_WINDOW_SECS,
            ..TraceEvalConfig::default()
        };
        assert!(at_minimum.validate().is_ok());
    }

    #[test]
    fn test_completion_config_rejects_invalid_or_empty_end_signal() {
        let invalid = TraceEvalConfig {
            end_signal: Some(serde_json::json!({"field": "status"})),
            ..TraceEvalConfig::default()
        };
        assert_eq!(
            invalid.validate(),
            Err("End signal must be a valid condition")
        );

        let empty = SessionEvalConfig {
            end_signal: Some(serde_json::json!({
                "version": 2,
                "conditions": {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": []
                }
            })),
            ..SessionEvalConfig::default()
        };
        assert_eq!(
            empty.validate(),
            Err("End signal must contain at least one condition")
        );
    }

    #[test]
    fn test_non_span_scope_requires_trace_stream() {
        let mut model = make_model();
        model.target_scope = "trace".to_string();
        model.stream_type = "logs".to_string();
        let job = OnlineEvalJob::from(model);

        assert_eq!(
            job.validate_target_scope(),
            Err("Online eval jobs require a traces stream")
        );
    }

    #[test]
    fn test_span_scope_requires_trace_stream() {
        let mut model = make_model();
        model.target_scope = "span".to_string();
        model.stream_type = "logs".to_string();
        let job = OnlineEvalJob::from(model);

        assert_eq!(
            job.validate_target_scope(),
            Err("Online eval jobs require a traces stream")
        );
    }

    #[test]
    fn test_internal_streams_cannot_be_eval_sources() {
        for stream in ["_evaluator", "_LLM_SCORES", "usage", "eval.task.trace"] {
            let mut model = make_model();
            model.stream = stream.to_string();
            let job = OnlineEvalJob::from(model);

            assert_eq!(
                job.validate(),
                Err("Internal streams cannot be used as online eval sources")
            );
        }

        let job = OnlineEvalJob::from(make_model());
        assert!(job.validate().is_ok());
    }

    #[test]
    fn test_invalid_persisted_target_scope_is_quarantined() {
        let mut model = make_model();
        model.target_scope = "bogus".to_string();
        model.pipeline_id = Some("pipe-1".to_string());

        let job = OnlineEvalJob::from(model);

        assert_eq!(job.target_scope, TargetScope::Unknown);
        assert!(!job.uses_hidden_pipeline());
        assert!(job.pipeline_id.is_none());
        assert_eq!(job.validate_target_scope(), Err("Invalid target scope"));
    }

    fn trace_job_with_selector() -> OnlineEvalJob {
        let mut model = make_model();
        model.target_scope = "trace".to_string();
        model.scorers = serde_json::json!(["s1", "s2"]);
        let mut job = OnlineEvalJob::from(model);
        job.span_selectors = vec![SpanSelector {
            id: "selector-1".to_string(),
            name: "tool-spans".to_string(),
            ..SpanSelector::default()
        }];
        job.span_selector_bindings = BTreeMap::from([
            ("s1".to_string(), "selector-1".to_string()),
            ("s2".to_string(), "selector-1".to_string()),
        ]);
        job
    }

    #[test]
    fn test_span_selector_default_schema_and_camel_case_wire_shape() {
        let selector = SpanSelector {
            id: "selector-1".to_string(),
            name: "default".to_string(),
            ..SpanSelector::default()
        };

        assert_eq!(selector.field_count(), DEFAULT_SPAN_SELECTOR_FIELDS.len());
        assert!(selector.validate().is_ok());

        let value = serde_json::to_value(selector).unwrap();
        assert_eq!(value["fieldMode"], "default");
        assert_eq!(value["maximumSpans"], DEFAULT_SPAN_SELECTOR_MAXIMUM_SPANS);
        assert!(value.get("filterCondition").is_some());
    }

    #[test]
    fn test_span_selector_rejects_invalid_custom_schema_and_output_budget() {
        let mut selector = SpanSelector {
            id: "selector-1".to_string(),
            name: "custom".to_string(),
            field_mode: SpanSelectorFieldMode::Custom,
            fields: Vec::new(),
            maximum_spans: 1,
            ..SpanSelector::default()
        };

        assert_eq!(
            selector.validate(),
            Err("Custom Span Selector schema requires at least one field")
        );

        selector.fields = vec!["name".to_string(), "name".to_string()];
        assert_eq!(
            selector.validate(),
            Err("Span Selector fields must be unique")
        );

        selector.fields = (0..9).map(|idx| format!("field_{idx}")).collect();
        selector.maximum_spans = 5;
        assert_eq!(
            selector.validate(),
            Err("Span Selector output budget exceeds 40000 characters")
        );
    }

    #[test]
    fn test_span_selector_rejects_an_incomplete_filter_condition() {
        let selector = SpanSelector {
            id: "selector-1".to_string(),
            name: "invalid-filter".to_string(),
            filter_condition: serde_json::json!({
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [{
                    "filterType": "condition",
                    "column": "span_status",
                    "operator": "=",
                    "logicalOperator": "AND"
                }]
            }),
            ..SpanSelector::default()
        };

        assert_eq!(
            selector.validate(),
            Err("Span Selector filterCondition is invalid")
        );
    }

    #[test]
    fn test_trace_activation_requires_a_valid_binding_for_every_scorer() {
        let mut job = trace_job_with_selector();
        assert!(job.validate_for_activation().is_ok());
        assert_eq!(
            job.selector_for_scorer("s1")
                .map(|selector| selector.name.as_str()),
            Some("tool-spans")
        );

        job.span_selector_bindings.remove("s2");
        assert_eq!(
            job.validate_for_activation(),
            Err("Every trace scorer must have a Span Selector binding")
        );

        job.span_selector_bindings
            .insert("s2".to_string(), "missing".to_string());
        assert_eq!(
            job.validate(),
            Err("Span Selector binding references an unknown selector")
        );
    }

    #[test]
    fn test_span_selectors_are_trace_only_and_names_are_unique() {
        let mut job = trace_job_with_selector();
        job.span_selectors.push(SpanSelector {
            id: "selector-2".to_string(),
            name: " TOOL-SPANS ".to_string(),
            ..SpanSelector::default()
        });
        assert_eq!(
            job.validate(),
            Err("Span Selector names must be unique within a job")
        );

        job.span_selectors.pop();
        job.target_scope = TargetScope::Span;
        job.trace_config = None;
        assert_eq!(
            job.validate(),
            Err("Span Selectors are supported only for trace eval jobs")
        );
    }

    #[test]
    fn test_invalid_transitions() {
        assert!(!is_valid_transition("active", "draft"));
        assert!(!is_valid_transition("paused", "draft"));
        assert!(!is_valid_transition("archived", "active"));
        assert!(!is_valid_transition("archived", "paused"));
        assert!(!is_valid_transition("draft", "paused"));
    }
}
