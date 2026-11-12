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
    self_reporting::{evaluator::EVALUATOR_STREAM, llm_scores::LLM_SCORES_STREAM},
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, Schema, Set,
};
use serde::{Deserialize, Serialize};

pub mod completion_window;
pub mod span_selector;

pub use completion_window::*;
pub use span_selector::*;

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
    table::entity::online_eval_jobs::{ActiveModel, Column, Entity, Model},
};

/// Valid job states.
pub const VALID_STATUSES: &[&str] = &["draft", "active", "paused", "archived"];

pub type ScorerInputMapping = BTreeMap<String, String>;
pub type JobInputMapping = BTreeMap<String, ScorerInputMapping>;

pub fn is_reserved_eval_source_stream(stream: &str) -> bool {
    let stream = stream.trim().to_ascii_lowercase();
    stream == EVALUATOR_STREAM
        || stream == LLM_SCORES_STREAM
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

/// `paused → paused` turns a budget pause into a user's, so no auto-resume at 00:00 UTC.
pub fn is_valid_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("draft", "active")
            | ("active", "paused")
            | ("paused", "paused")
            | ("paused", "active")
            | (_, "archived")
    )
}

const DAY_US: i64 = 24 * 60 * 60 * 1_000_000;

/// 00:00 UTC of the day `at_us` falls in; Unix time has no leap seconds, so days are exact.
pub fn utc_day_start_us(at_us: i64) -> i64 {
    at_us - at_us.rem_euclid(DAY_US)
}

/// What the health pass does once a job's judge spend for the day reaches its budget.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BudgetAction {
    /// Pause until 00:00 UTC; the first health pass of the next day resumes the job.
    #[default]
    Pause,
    /// Keep scoring; the job only reads as over budget.
    KeepRunning,
}

/// A job's daily judge spend limit; one budget covers all regions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvalJobBudget {
    /// Judge spend allowed per UTC day, in USD.
    pub daily_usd: f64,
    #[serde(default)]
    pub on_reach: BudgetAction,
    /// When the health pass paused the job for this budget, in microseconds. Server-owned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_at: Option<i64>,
    /// The day's judge spend when the health pass paused the job, in USD. Server-owned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_spend_usd: Option<f64>,
    /// Server-owned "resume until 00:00 UTC" time (µs) before which the budget does not apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifted_until: Option<i64>,
}

/// What a job update asks of its budget.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BudgetPatch {
    /// The request has no `budget`: the stored one keeps applying.
    Keep,
    /// `"budget": null`: the job has no budget.
    Clear,
    /// A new limit; an omitted action keeps the stored one (`pause` when there is none).
    Set {
        daily_usd: f64,
        on_reach: Option<BudgetAction>,
    },
}

impl BudgetPatch {
    /// The job's budget after the update. A new limit keeps the stored pause state.
    pub fn apply(self, stored: Option<&EvalJobBudget>) -> Option<EvalJobBudget> {
        match self {
            Self::Keep => stored.cloned(),
            Self::Clear => None,
            Self::Set {
                daily_usd,
                on_reach,
            } => Some(
                EvalJobBudget {
                    daily_usd,
                    on_reach: on_reach.or(stored.map(|b| b.on_reach)).unwrap_or_default(),
                    paused_at: None,
                    paused_spend_usd: None,
                    lifted_until: None,
                }
                .with_server_state_of(stored),
            ),
        }
    }
}

impl EvalJobBudget {
    /// A request sets the limit and action only; the pause state stays the stored job's.
    pub fn with_server_state_of(mut self, stored: Option<&EvalJobBudget>) -> Self {
        self.paused_at = stored.and_then(|b| b.paused_at);
        self.paused_spend_usd = stored.and_then(|b| b.paused_spend_usd);
        self.lifted_until = stored.and_then(|b| b.lifted_until);
        self
    }

    /// A job this budget paused may run again once its limit is above the spend it paused at.
    pub fn allows_resume(&self) -> bool {
        self.paused_spend_usd
            .is_some_and(|spent| self.daily_usd > spent)
    }

    /// Budget after `new_status`; only budget pauses set `paused_at`, so user pauses never resume.
    pub fn after_transition(
        mut self,
        new_status: &str,
        budget_spend: Option<f64>,
        now_us: i64,
    ) -> Self {
        match new_status {
            "paused" => {
                self.paused_at = budget_spend.map(|_| now_us);
                self.paused_spend_usd = budget_spend;
                // The budget only pauses a job it is not lifted for, so any lift has ended.
                if budget_spend.is_some() {
                    self.lifted_until = None;
                }
            }
            "active" => {
                let today = utc_day_start_us(now_us);
                if self.paused_at.is_some_and(|at| at >= today) && !self.allows_resume() {
                    self.lifted_until = Some(today + DAY_US);
                }
                self.paused_at = None;
                self.paused_spend_usd = None;
            }
            _ => {}
        }
        self
    }
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
    #[serde(default)]
    pub budget: Option<EvalJobBudget>,
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
        if !is_readable_condition(&self.filter_condition) {
            return Err(
                "Filter condition is invalid or uses an operator this version does not support",
            );
        }
        self.validate_target_scope()?;
        self.validate_span_selectors()?;
        self.sampling_rate()?;
        if self
            .budget
            .as_ref()
            .is_some_and(|b| !(b.daily_usd.is_finite() && b.daily_usd > 0.0))
        {
            return Err("Daily budget must be a positive amount");
        }
        Ok(())
    }

    /// Extended-operator value checks on the job filter, end signals and span selector filters.
    pub fn validate_operator_values(&self) -> Result<(), String> {
        validate_condition_json_operator_values(&self.filter_condition)?;
        let end_signals = [
            self.trace_config
                .as_ref()
                .and_then(|c| c.end_signal.as_ref()),
            self.session_config
                .as_ref()
                .and_then(|c| c.end_signal.as_ref()),
        ];
        for signal in end_signals.into_iter().flatten() {
            validate_condition_json_operator_values(signal)?;
        }
        self.span_selectors.iter().try_for_each(|selector| {
            validate_condition_json_operator_values(&selector.filter_condition)
        })
    }

    /// Names the first set condition this version cannot parse; an unparsed filter would match all.
    pub fn unreadable_condition(&self) -> Option<&'static str> {
        let end_signal = |signal: Option<&serde_json::Value>| {
            signal.is_some_and(|signal| !is_readable_condition(signal))
        };
        if !is_readable_condition(&self.filter_condition) {
            Some("filter condition")
        } else if end_signal(
            self.trace_config
                .as_ref()
                .and_then(|c| c.end_signal.as_ref()),
        ) || end_signal(
            self.session_config
                .as_ref()
                .and_then(|c| c.end_signal.as_ref()),
        ) {
            Some("end signal")
        } else if self
            .span_selectors
            .iter()
            .any(|selector| !is_readable_condition(&selector.filter_condition))
        {
            Some("span selector filter")
        } else {
            None
        }
    }

    pub fn validate_for_activation(&self) -> Result<(), &'static str> {
        self.validate()?;
        if !matches!(self.target_scope, TargetScope::Trace) {
            return Ok(());
        }
        for scorer in &self.scorers {
            if self.scorer_uses_spans(&scorer.id)
                && !self.span_selector_bindings.contains_key(&scorer.id)
            {
                return Err("Every trace scorer that uses spans must have a Span Selector binding");
            }
        }
        Ok(())
    }

    fn scorer_uses_spans(&self, scorer_id: &str) -> bool {
        self.input_mapping
            .as_ref()
            .and_then(|mappings| mappings.get(scorer_id))
            .is_some_and(|mapping| {
                mapping.keys().any(|variable| variable.trim() == "spans")
                    || mapping.values().any(|source| {
                        source
                            .strip_prefix("{{")
                            .and_then(|value| value.strip_suffix("}}"))
                            .is_some_and(|value| value.trim() == "spans")
                    })
            })
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
            budget: model
                .budget
                .and_then(|budget| serde_json::from_str(&budget).ok()),
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
    let client = get_orm_client_rw().await;
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
        budget: Set(budget_json(job.budget.as_ref())),
        sampling_mode: Set(job.sampling_mode.to_string()),
        sampling_value: Set(job.sampling_value.clone()),
        status: Set(job.status.clone()),
        version: Set(job.version),
        pipeline_id: Set(job.pipeline_id.clone()),
        created_at: Set(job.created_at),
        updated_at: Set(job.updated_at),
    };

    let client = get_orm_client_rw().await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(job: &OnlineEvalJob) -> Result<(), errors::Error> {
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
        budget: Set(budget_json(job.budget.as_ref())),
        sampling_mode: Set(job.sampling_mode.to_string()),
        sampling_value: Set(job.sampling_value.clone()),
        status: Set(job.status.clone()),
        version: Set(job.version),
        pipeline_id: Set(job.pipeline_id.clone()),
        created_at: Set(job.created_at),
        updated_at: Set(job.updated_at),
    };

    let client = get_orm_client_rw().await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<OnlineEvalJob>, errors::Error> {
    let client = get_orm_client_ro().await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .map(OnlineEvalJob::from);

    Ok(record)
}

pub async fn get_by_org(id: &str, org_id: &str) -> Result<Option<OnlineEvalJob>, errors::Error> {
    let client = get_orm_client_ro().await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .map(OnlineEvalJob::from);

    Ok(record)
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = get_orm_client_ro().await;

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
    let client = get_orm_client_ro().await;

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

/// Skips jobs of an org that is being deleted or has no organizations row, and jobs with a
/// condition this version cannot read, which would otherwise run unfiltered.
pub async fn get_active_trace_session() -> Result<Vec<OnlineEvalJob>, errors::Error> {
    use sea_orm::sea_query::{Expr, Query};

    use crate::{coordinator::org_status::STATUS_ACTIVE, table::entity::organizations};

    let client = get_orm_client_ro().await;

    let records = Entity::find()
        .filter(Column::Status.eq("active"))
        .filter(Column::TargetScope.is_in(["trace", "session"]))
        .filter(
            Column::OrgId.in_subquery(
                Query::select()
                    .column(organizations::Column::Identifier)
                    .from(organizations::Entity)
                    .and_where(Expr::col(organizations::Column::Status).eq(STATUS_ACTIVE))
                    .to_owned(),
            ),
        )
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?;

    Ok(runnable_jobs(records))
}

/// Jobs the health pass measures, across all orgs; paused ones settle to "no recent runs".
pub async fn get_running_or_paused() -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = get_orm_client_ro().await;

    let records = Entity::find()
        .filter(Column::Status.is_in(["active", "paused"]))
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
    let client = get_orm_client_ro().await;

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

/// Unset ("all") or a shape the reconciler and scheduler parse; anything else they treat as
/// match-all.
fn is_readable_condition(condition: &serde_json::Value) -> bool {
    condition.is_null()
        || condition.as_object().is_some_and(|o| o.is_empty())
        || condition
            .get("type")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|v| v.eq_ignore_ascii_case("all"))
        || serde_json::from_value::<ConditionParams>(condition.clone()).is_ok()
        || serde_json::from_value::<ConditionGroup>(condition.clone()).is_ok()
        || serde_json::from_value::<ConditionList>(condition.clone()).is_ok()
}

fn runnable_jobs(models: Vec<Model>) -> Vec<OnlineEvalJob> {
    crate::table::convert_skipping_unreadable(
        "online_eval_jobs",
        models,
        |m| format!("org={} id={}", m.org_id, m.id),
        |m| {
            let job = OnlineEvalJob::from(m);
            match job.unreadable_condition() {
                Some(what) => Err(format!("its {what} cannot be read by this version")),
                None => Ok(job),
            }
        },
    )
}

pub async fn has_non_archived_by_scorer_ref(
    org_id: &str,
    scorer_entity_id: &str,
) -> Result<bool, errors::Error> {
    let client = get_orm_client_ro().await;

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
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_all_by_org(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn exists(id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_ro().await;
    let record = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

    Ok(record.is_some())
}

fn budget_json(budget: Option<&EvalJobBudget>) -> Option<String> {
    budget.and_then(|budget| serde_json::to_string(budget).ok())
}

/// Update only status, pipeline_id and budget; the budget carries the transition's pause state.
pub async fn update_status(
    id: &str,
    status: &str,
    pipeline_id: Option<&str>,
    budget: Option<&EvalJobBudget>,
    updated_at: i64,
) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let model = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .ok_or_else(|| errors::Error::Message("Job not found".to_string()))?;

    let update = ActiveModel {
        status: Set(status.to_string()),
        pipeline_id: Set(pipeline_id.map(|pid| pid.to_string())),
        budget: Set(budget_json(budget)),
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
            budget: None,
            sampling_mode: "rate".to_string(),
            sampling_value: serde_json::json!({"rate": 0.1}),
            status: "draft".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    fn future_operator(condition: serde_json::Value) -> serde_json::Value {
        let mut condition = condition;
        condition["conditions"]["conditions"][0]["operator"] = serde_json::json!("future_op");
        condition
    }

    fn with_operator(operator: &str) -> serde_json::Value {
        let mut condition = end_signal();
        condition["conditions"]["conditions"][0]["operator"] = serde_json::json!(operator);
        condition
    }

    #[test]
    fn test_extended_operators_in_filter_end_signals_and_selectors_are_readable() {
        let mut job = trace_job_with_selector();
        job.filter_condition = with_operator("in");
        job.trace_config = Some(TraceEvalConfig {
            end_signal: Some(with_operator("starts_with")),
            ..Default::default()
        });
        job.span_selectors[0].filter_condition = with_operator("re_match");
        job.span_selectors[0].filter_condition["conditions"]["conditions"][0]["case_insensitive"] =
            serde_json::json!(true);
        assert_eq!(job.unreadable_condition(), None);
        assert!(job.validate().is_ok());
    }

    #[test]
    fn test_an_unreadable_filter_fails_validation_instead_of_matching_all() {
        let mut job = OnlineEvalJob::from(make_model());
        for unset in [
            serde_json::Value::Null,
            serde_json::json!({}),
            serde_json::json!({"type": "all"}),
        ] {
            job.filter_condition = unset;
            assert!(job.validate().is_ok());
            assert_eq!(job.unreadable_condition(), None);
        }
        job.filter_condition = end_signal();
        assert!(job.validate().is_ok());

        job.filter_condition = future_operator(end_signal());
        assert!(job.validate().is_err());
        assert_eq!(job.unreadable_condition(), Some("filter condition"));

        job.filter_condition = serde_json::json!({"filterType": "group", "logicalOperator": "AND",
            "conditions": [{"filterType": "condition", "column": "span_id",
                            "operator": "is_not_null", "value": "", "logicalOperator": "AND"}]});
        assert!(job.validate().is_ok());
        // The scheduler cannot parse this field/operator shape, so it would match every span.
        job.filter_condition =
            serde_json::json!({"type": "condition", "field": "span_id", "operator": "exists"});
        assert!(job.validate().is_err());
    }

    #[test]
    fn test_unreadable_end_signal_and_selector_filters_are_named() {
        let mut model = make_model();
        model.target_scope = "trace".to_string();
        model.trace_config = Some(serde_json::json!({"endSignal": future_operator(end_signal())}));
        let job = OnlineEvalJob::from(model);
        assert_eq!(job.unreadable_condition(), Some("end signal"));

        let mut job = trace_job_with_selector();
        assert_eq!(job.unreadable_condition(), None);
        job.span_selectors[0].filter_condition = future_operator(end_signal());
        assert_eq!(job.unreadable_condition(), Some("span selector filter"));
    }

    #[test]
    fn test_runnable_jobs_skip_and_log_jobs_with_unreadable_conditions() {
        crate::table::testing::capture_error_logs();
        let mut good = make_model();
        good.id = "job-good".to_string();
        let mut bad = make_model();
        bad.id = "job-in-filter".to_string();
        bad.filter_condition = future_operator(end_signal());

        let ids: Vec<String> = runnable_jobs(vec![good, bad])
            .into_iter()
            .map(|job| job.id)
            .collect();

        assert_eq!(ids, ["job-good"]);
        let logged = crate::table::testing::logged_errors_containing("id=job-in-filter");
        assert!(
            logged.iter().any(|l| l.contains("filter condition")),
            "{logged:?}"
        );
    }

    #[test]
    fn test_validate_operator_values_checks_filter_and_end_signal() {
        let mut job = OnlineEvalJob::from(make_model());
        assert!(job.validate_operator_values().is_ok());

        job.filter_condition = end_signal();
        assert!(job.validate_operator_values().is_ok());

        let mut bad_signal = end_signal();
        bad_signal["conditions"]["conditions"][0]["operator"] = serde_json::json!("re_match");
        bad_signal["conditions"]["conditions"][0]["value"] = serde_json::json!("(");
        job.trace_config = Some(TraceEvalConfig {
            end_signal: Some(bad_signal.clone()),
            ..TraceEvalConfig::default()
        });
        assert!(job.validate_operator_values().is_err());

        job.trace_config = None;
        job.filter_condition = bad_signal["conditions"].clone();
        assert!(job.validate_operator_values().is_err());
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
        // Keep paused: a budget pause becomes the user's.
        assert!(is_valid_transition("paused", "paused"));
        assert!(!is_valid_transition("active", "degraded"));
        assert!(is_valid_transition("draft", "archived"));
        assert!(is_valid_transition("active", "archived"));
        assert!(is_valid_transition("paused", "archived"));
        assert!(!is_valid_transition("archived", "active"));
    }

    #[test]
    fn test_trace_scope_model_defaults_trace_config() {
        let mut model = make_model();
        model.target_scope = "trace".to_string();
        let job = OnlineEvalJob::from(model);

        assert_eq!(job.target_scope, TargetScope::Trace);
        assert_eq!(
            job.trace_config.as_ref().unwrap().idle_window_secs,
            DEFAULT_TRACE_IDLE_WINDOW_SECS
        );
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
            budget: None,
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
        assert_eq!(
            job.session_config.as_ref().unwrap().idle_window_secs,
            DEFAULT_SESSION_IDLE_WINDOW_SECS
        );
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
        for stream in ["_evaluator", "_LLM_SCORES", "eval.task.trace"] {
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
    fn test_trace_activation_requires_a_binding_only_for_scorers_using_spans() {
        let mut job = trace_job_with_selector();
        job.input_mapping = Some(BTreeMap::from([
            (
                "s1".to_string(),
                BTreeMap::from([("evidence".to_string(), "{{ spans }}".to_string())]),
            ),
            (
                "s2".to_string(),
                BTreeMap::from([("question".to_string(), "{{ input }}".to_string())]),
            ),
        ]));
        assert!(job.validate_for_activation().is_ok());
        assert_eq!(
            job.selector_for_scorer("s1")
                .map(|selector| selector.name.as_str()),
            Some("tool-spans")
        );

        job.span_selector_bindings.remove("s2");
        assert!(job.validate_for_activation().is_ok());

        job.span_selector_bindings.remove("s1");
        assert_eq!(
            job.validate_for_activation(),
            Err("Every trace scorer that uses spans must have a Span Selector binding")
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

    fn budget(paused_at: Option<i64>) -> EvalJobBudget {
        EvalJobBudget {
            daily_usd: 5.0,
            on_reach: BudgetAction::Pause,
            paused_at,
            paused_spend_usd: None,
            lifted_until: None,
        }
    }

    const DAY: i64 = 24 * 60 * 60 * 1_000_000;

    #[test]
    fn test_utc_day_start() {
        assert_eq!(utc_day_start_us(3 * DAY + 17), 3 * DAY);
        assert_eq!(utc_day_start_us(3 * DAY), 3 * DAY);
    }

    #[test]
    fn test_budget_pause_state_follows_transitions() {
        let now = 10 * DAY + 5;
        // Only a budget pause auto-resumes; it also ends an expired lift.
        let mut expired_lift = budget(None);
        expired_lift.lifted_until = Some(10 * DAY);
        let paused = expired_lift.after_transition("paused", Some(6.21), now);
        assert_eq!(
            (
                paused.paused_at,
                paused.paused_spend_usd,
                paused.lifted_until
            ),
            (Some(now), Some(6.21), None)
        );
        let mut lifted = budget(None);
        lifted.lifted_until = Some(11 * DAY);
        let user_paused = lifted.after_transition("paused", None, now);
        assert_eq!(
            (user_paused.paused_at, user_paused.paused_spend_usd),
            (None, None)
        );
        assert_eq!(user_paused.lifted_until, Some(11 * DAY));
        // Keep paused turns a budget pause into the user's: it no longer resumes on its own.
        let kept = budget(None)
            .after_transition("paused", Some(6.21), 10 * DAY + 1)
            .after_transition("paused", None, now);
        assert_eq!((kept.paused_at, kept.paused_spend_usd), (None, None));

        // Resumed the day it paused, still over its limit: the budget is lifted until 00:00 UTC.
        let same_day = budget(None)
            .after_transition("paused", Some(6.21), 10 * DAY + 1)
            .after_transition("active", None, now);
        assert_eq!(
            (same_day.paused_at, same_day.paused_spend_usd),
            (None, None)
        );
        assert_eq!(same_day.lifted_until, Some(11 * DAY));
        // A pause recorded without its spend is lifted the same way.
        let unknown_spend = budget(Some(10 * DAY + 1)).after_transition("active", None, now);
        assert_eq!(unknown_spend.lifted_until, Some(11 * DAY));

        // The next day's resume starts a fresh day under the budget.
        let next_day = budget(None)
            .after_transition("paused", Some(6.21), 9 * DAY + 1)
            .after_transition("active", None, now);
        assert_eq!(next_day.paused_at, None);
        assert_eq!(next_day.lifted_until, None);
    }

    #[test]
    fn test_raised_budget_resumes_under_the_new_limit() {
        let now = 10 * DAY + 5;
        let paused = budget(None).after_transition("paused", Some(6.21), 10 * DAY + 1);
        assert!(!paused.allows_resume());

        // Raised above the spend it paused at: it may run, and the new limit applies today.
        let mut raised = budget(None);
        raised.daily_usd = 20.0;
        let raised = raised.with_server_state_of(Some(&paused));
        assert!(raised.allows_resume());
        let resumed = raised.after_transition("active", None, now);
        assert_eq!(
            (
                resumed.paused_at,
                resumed.paused_spend_usd,
                resumed.lifted_until
            ),
            (None, None, None)
        );

        // Raised only to the spend: it stays paused, and a resume lifts the budget.
        let mut matched = budget(None);
        matched.daily_usd = 6.21;
        let matched = matched.with_server_state_of(Some(&paused));
        assert!(!matched.allows_resume());
        assert_eq!(
            matched.after_transition("active", None, now).lifted_until,
            Some(11 * DAY)
        );

        // A job the user paused never resumes on a budget edit.
        let mut user_paused = budget(None);
        user_paused.daily_usd = 20.0;
        assert!(!user_paused.allows_resume());
    }

    #[test]
    fn test_budget_patch_keeps_clears_or_sets_over_the_stored_budget() {
        let mut stored = budget(Some(7));
        stored.on_reach = BudgetAction::KeepRunning;
        stored.paused_spend_usd = Some(6.0);
        stored.lifted_until = Some(9);

        assert_eq!(BudgetPatch::Keep.apply(Some(&stored)), Some(stored.clone()));
        assert_eq!(BudgetPatch::Keep.apply(None), None);
        assert_eq!(BudgetPatch::Clear.apply(Some(&stored)), None);

        // A new limit keeps the stored pause state, and an omitted action the stored one.
        let set = |on_reach| BudgetPatch::Set {
            daily_usd: 10.0,
            on_reach,
        };
        let merged = set(None).apply(Some(&stored)).unwrap();
        assert_eq!(
            (
                merged.daily_usd,
                merged.on_reach,
                merged.paused_at,
                merged.paused_spend_usd,
                merged.lifted_until
            ),
            (10.0, BudgetAction::KeepRunning, Some(7), Some(6.0), Some(9))
        );
        let paused = set(Some(BudgetAction::Pause)).apply(Some(&stored)).unwrap();
        assert_eq!(paused.on_reach, BudgetAction::Pause);
        // A first budget pauses by default and has no pause state.
        let first = set(None).apply(None).unwrap();
        assert_eq!(
            (first.on_reach, first.paused_at, first.lifted_until),
            (BudgetAction::Pause, None, None)
        );
    }

    #[test]
    fn test_budget_must_be_positive_and_old_rows_have_none() {
        let mut job = OnlineEvalJob::from(make_model());
        assert!(job.budget.is_none());
        job.budget = Some(EvalJobBudget {
            daily_usd: 0.0,
            ..budget(None)
        });
        assert_eq!(
            job.validate(),
            Err("Daily budget must be a positive amount")
        );

        let mut model = make_model();
        model.budget = Some(r#"{"dailyUsd": 5, "onReach": "keep_running"}"#.to_string());
        let job = OnlineEvalJob::from(model);
        let budget = job.budget.as_ref().unwrap();
        assert_eq!(budget.on_reach, BudgetAction::KeepRunning);
        assert!(job.validate().is_ok());
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
