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

use std::{collections::HashMap, fmt};

use anyhow::Result;
use config::meta::self_reporting::llm_scores::{LlmScoreDataSourceType, LlmScoreDataType};
use infra::table::{score_configs::ScoreConfigDataType, scorers::ScorerType};
use serde_json::Value;

use crate::service::llm_evaluations::{
    eval_jobs::executor_runtime::{SpanEvalContext, input_variables_with_context_defaults},
    evaluator_trace::{EvaluatorTrace, EvaluatorTraceInput, create_evaluator_trace},
    score_writer::{ScoreWriterInput, create_score},
    scorers::{llm_judge, remote_client},
};

#[derive(Debug)]
pub(crate) struct ScorerExecutionError {
    message: String,
    pub(crate) raw_response: Option<String>,
    pub(crate) scorer_input: Option<String>,
    pub(crate) provider_id: Option<String>,
    pub(crate) provider_name: Option<String>,
    pub(crate) provider_type: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) prompt_tokens: Option<i64>,
    pub(crate) completion_tokens: Option<i64>,
    pub(crate) total_tokens: Option<i64>,
    pub(crate) latency_ms: i64,
}

impl fmt::Display for ScorerExecutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ScorerExecutionError {}

pub(crate) struct ScoreResult {
    pub(crate) score_json: Value,
    pub(crate) evaluator_trace: EvaluatorTrace,
}

pub(crate) enum PreparedScorer {
    LlmJudge(PreparedLlmJudgeScorer),
    Remote(PreparedRemoteScorer),
}

impl PreparedScorer {
    pub(crate) async fn from_scorer(
        org_id: &str,
        scorer: infra::table::scorers::Scorer,
    ) -> Result<Self> {
        match scorer.scorer_type {
            ScorerType::LlmJudge => Ok(Self::LlmJudge(
                PreparedLlmJudgeScorer::prepare(org_id, &scorer).await?,
            )),
            ScorerType::Remote => Ok(Self::Remote(
                PreparedRemoteScorer::prepare(org_id, &scorer).await?,
            )),
        }
    }

    pub(crate) async fn execute(
        &self,
        span_ctx: &SpanEvalContext,
        input_variables: &HashMap<String, Value>,
    ) -> Result<Option<ScoreResult>> {
        match self {
            Self::LlmJudge(scorer) => scorer.execute(span_ctx, input_variables).await,
            Self::Remote(scorer) => scorer.execute(span_ctx, input_variables).await,
        }
    }
}

pub struct PreparedLlmJudgeScorer {
    scorer: infra::table::scorers::Scorer,
    provider: infra::provider::PreparedProvider,
    scorer_cfg: llm_judge::ScorerConfig,
    score_cfg_info: llm_judge::ScoreConfigInfo,
    extra_metadata_fields: Vec<String>,
    include_reasoning: bool,
}

impl PreparedLlmJudgeScorer {
    pub async fn prepare(org_id: &str, scorer: &infra::table::scorers::Scorer) -> Result<Self> {
        Self::prepare_with_score_config_info(org_id, scorer, None).await
    }

    pub async fn prepare_with_score_config_info(
        org_id: &str,
        scorer: &infra::table::scorers::Scorer,
        score_config_info: Option<llm_judge::ScoreConfigInfo>,
    ) -> Result<Self> {
        use llm_judge::{LlmJudgeParams, ScoreConfigInfo, ScorerConfig};

        let params: LlmJudgeParams = serde_json::from_value(scorer.params.clone())
            .map_err(|e| anyhow::anyhow!("Invalid LLM judge scorer params: {e}"))?;

        let provider_id = params.provider_id.as_str();

        let provider = match infra::table::providers::get(provider_id).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                anyhow::bail!("Provider '{provider_id}' not found for LLM judge scorer");
            }
            Err(e) => {
                anyhow::bail!("Failed to look up provider '{provider_id}': {e}");
            }
        };

        let score_config_entity_id = scorer.produces_score_config_id.as_deref().unwrap_or("");

        let score_cfg_info = if let Some(score_config_info) = score_config_info {
            score_config_info
        } else if !score_config_entity_id.is_empty() {
            lookup_score_config_for_scorer(org_id, scorer)
                .await
                .as_ref()
                .map(ScoreConfigInfo::from)
                .unwrap_or_default()
        } else {
            ScoreConfigInfo::default()
        };

        let template = if scorer.template.trim().is_empty() {
            "Evaluate the given content and produce a score.".to_string()
        } else {
            scorer.template.clone()
        };

        let include_reasoning = params.include_reasoning.unwrap_or(true);
        let extra_metadata_fields = params.extra_metadata_fields.clone().unwrap_or_default();

        let scorer_cfg = ScorerConfig {
            scorer_entity_id: scorer.entity_id.clone(),
            scorer_version: scorer.version.to_string(),
            scorer_type: scorer.scorer_type,
            template,
            params,
        };

        let provider = infra::provider::PreparedProvider::parse((&provider).into())?;

        Ok(Self {
            scorer: scorer.clone(),
            provider,
            scorer_cfg,
            score_cfg_info,
            extra_metadata_fields,
            include_reasoning,
        })
    }

    pub async fn run(
        &self,
        input_variables: &HashMap<String, Value>,
    ) -> Result<llm_judge::LlmJudgeOutput> {
        llm_judge::run_llm_judge(
            &self.provider,
            &self.scorer_cfg,
            &self.score_cfg_info,
            input_variables,
            &self.extra_metadata_fields,
            self.include_reasoning,
        )
        .await
    }

    async fn execute(
        &self,
        span_ctx: &SpanEvalContext,
        input_variables: &HashMap<String, Value>,
    ) -> Result<Option<ScoreResult>> {
        let start = std::time::Instant::now();

        match self.run(input_variables).await {
            Ok(llm_output) => {
                let latency = start.elapsed();

                let (value_numeric, value_categorical, value_boolean, data_type) =
                    match self.score_cfg_info.data_type {
                        ScoreConfigDataType::Numeric => (
                            llm_output.value_numeric,
                            None,
                            None,
                            LlmScoreDataType::Numeric,
                        ),
                        ScoreConfigDataType::Categorical => (
                            None,
                            llm_output.value_categorical,
                            None,
                            LlmScoreDataType::Categorical,
                        ),
                        ScoreConfigDataType::Boolean => (
                            None,
                            None,
                            llm_output.value_boolean,
                            LlmScoreDataType::Boolean,
                        ),
                    };

                let score_name = self
                    .score_cfg_info
                    .score_config_name
                    .clone()
                    .unwrap_or_else(|| self.scorer.name.clone());

                let score = create_score(ScoreWriterInput {
                    span_id: span_ctx.span_id.clone(),
                    trace_id: span_ctx.trace_id.clone(),
                    session_id: span_ctx.session_id.clone(),
                    scorer_id: self.scorer_cfg.scorer_entity_id.clone(),
                    scorer_version: self.scorer_cfg.scorer_version.clone(),
                    score_config_id: self.score_cfg_info.score_config_entity_id.clone(),
                    score_config_version: self.score_cfg_info.score_config_version.clone(),
                    score_name: Some(score_name),
                    source_type: LlmScoreDataSourceType::LlmJudge,
                    source_stream: Some(span_ctx.source_stream.clone()),
                    job_id: span_ctx.job_id.clone(),
                    value_numeric,
                    value_categorical,
                    value_boolean,
                    data_type,
                    reasoning: llm_output.reasoning.clone(),
                    metadata: llm_output.metadata.clone(),
                    author: None,
                });

                let trace = create_evaluator_trace(EvaluatorTraceInput {
                    org_id: span_ctx.org_id.clone(),
                    evaluator_trace_id: span_ctx.evaluator_trace_id.clone(),
                    target_span_id: span_ctx.span_id.clone(),
                    target_trace_id: span_ctx.trace_id.clone(),
                    target_stream: span_ctx.source_stream.clone(),
                    scorer_id: Some(self.scorer_cfg.scorer_entity_id.clone()),
                    scorer_version: Some(self.scorer_cfg.scorer_version.clone()),
                    scorer_type: Some(self.scorer_cfg.scorer_type),
                    job_id: span_ctx.job_id.clone(),
                    score_config_id: self.score_cfg_info.score_config_entity_id.clone(),
                    score_config_version: self.score_cfg_info.score_config_version.clone(),
                    eval_run_id: span_ctx.eval_run_id.clone(),
                    provider_id: Some(self.provider.id.clone()),
                    provider_name: Some(self.provider.name.clone()),
                    provider_type: Some(self.provider.kind.as_str().to_string()),
                    model: Some(llm_output.model_used),
                    latency_ms: latency.as_millis() as i64,
                    prompt_tokens: llm_output.prompt_tokens,
                    completion_tokens: llm_output.completion_tokens,
                    total_tokens: llm_output.total_tokens,
                    sampling_rate: span_ctx.sampling_rate,
                    sampled: span_ctx.sampled,
                    status: config::meta::self_reporting::evaluator::status::SUCCESS.to_string(),
                    error_kind: None,
                    error_message: None,
                    skip_reason: None,
                    prompt: Some(llm_output.prompt_messages),
                    response: Some(llm_output.raw_response),
                });

                Ok(Some(ScoreResult {
                    score_json: score.json,
                    evaluator_trace: trace,
                }))
            }
            Err(e) => {
                let latency = start.elapsed();
                let structured_error = e.chain().find_map(|cause| {
                    cause.downcast_ref::<infra::provider::ProviderStructuredOutputError>()
                });
                let prompt_tokens = structured_error.and_then(|e| e.prompt_tokens);
                let completion_tokens = structured_error.and_then(|e| e.completion_tokens);
                let total_tokens = structured_error
                    .and_then(|e| e.total_tokens)
                    .or_else(|| prompt_tokens.zip(completion_tokens).map(|(p, c)| p + c));

                Err(ScorerExecutionError {
                    message: format!(
                        "LLM Judge scorer failed: {e} (latency: {}ms)",
                        latency.as_millis()
                    ),
                    raw_response: structured_error.map(|e| e.raw_response.clone()),
                    scorer_input: Some(llm_judge::build_prompt_messages_json(
                        &self.scorer_cfg,
                        input_variables,
                    )),
                    provider_id: Some(self.provider.id.clone()),
                    provider_name: Some(self.provider.name.clone()),
                    provider_type: Some(self.provider.kind.as_str().to_string()),
                    model: structured_error.map(|e| e.model_used.clone()).or_else(|| {
                        Some(
                            self.provider
                                .model_or_default(self.scorer_cfg.params.model.as_deref()),
                        )
                    }),
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    latency_ms: structured_error
                        .map(|e| e.latency_ms)
                        .unwrap_or(latency.as_millis() as i64),
                }
                .into())
            }
        }
    }
}

pub struct PreparedRemoteScorer {
    scorer: infra::table::scorers::Scorer,
    remote_cfg: remote_client::RemoteScorerConfig,
    score_config: Option<infra::table::score_configs::ScoreConfig>,
}

impl PreparedRemoteScorer {
    pub async fn prepare(org_id: &str, scorer: &infra::table::scorers::Scorer) -> Result<Self> {
        let mut remote_cfg = remote_client::parse_remote_config(&scorer.params)?;
        if !scorer.template.trim().is_empty() {
            remote_cfg.request_body_template = Some(scorer.template.clone());
        }

        let score_config = match scorer.produces_score_config_id.as_deref() {
            Some(entity_id) if !entity_id.is_empty() => {
                lookup_score_config_for_scorer(org_id, scorer).await
            }
            _ => None,
        };

        Ok(Self {
            scorer: scorer.clone(),
            remote_cfg,
            score_config,
        })
    }

    pub async fn run(
        &self,
        input_variables: &HashMap<String, Value>,
    ) -> Result<remote_client::RemoteScorerOutput> {
        remote_client::run_remote_scorer(&self.remote_cfg, input_variables).await
    }

    async fn execute(
        &self,
        span_ctx: &SpanEvalContext,
        input_variables: &HashMap<String, Value>,
    ) -> Result<Option<ScoreResult>> {
        let start = std::time::Instant::now();
        let input_variables = input_variables_with_context_defaults(input_variables, span_ctx);

        match self.run(&input_variables).await {
            Ok(remote_output) => {
                let latency = start.elapsed();

                let value = &remote_output.value;
                let (value_numeric, value_categorical, value_boolean) = if value.is_number() {
                    (value.as_f64(), None, None)
                } else if value.is_string() {
                    (None, value.as_str().map(|s| s.to_string()), None)
                } else if value.is_boolean() {
                    (None, None, value.as_bool())
                } else {
                    (None, Some(value.to_string()), None)
                };

                let data_type = if value_numeric.is_some() {
                    LlmScoreDataType::Numeric
                } else if value_boolean.is_some() {
                    LlmScoreDataType::Boolean
                } else {
                    LlmScoreDataType::Categorical
                };

                let score_name = self
                    .score_config
                    .as_ref()
                    .map(|sc| sc.name.clone())
                    .unwrap_or_else(|| self.scorer.name.clone());

                let score = create_score(ScoreWriterInput {
                    span_id: span_ctx.span_id.clone(),
                    trace_id: span_ctx.trace_id.clone(),
                    session_id: span_ctx.session_id.clone(),
                    scorer_id: self.scorer.entity_id.clone(),
                    scorer_version: self.scorer.version.to_string(),
                    score_config_id: self.score_config.as_ref().map(|sc| sc.entity_id.clone()),
                    score_config_version: self
                        .score_config
                        .as_ref()
                        .map(|sc| sc.version.to_string()),
                    score_name: Some(score_name),
                    source_type: LlmScoreDataSourceType::Remote,
                    source_stream: Some(span_ctx.source_stream.clone()),
                    job_id: span_ctx.job_id.clone(),
                    value_numeric,
                    value_categorical,
                    value_boolean,
                    data_type,
                    reasoning: remote_output.reasoning.clone(),
                    metadata: remote_output.metadata.clone(),
                    author: None,
                });

                let trace = create_evaluator_trace(EvaluatorTraceInput {
                    org_id: span_ctx.org_id.clone(),
                    evaluator_trace_id: span_ctx.evaluator_trace_id.clone(),
                    target_span_id: span_ctx.span_id.clone(),
                    target_trace_id: span_ctx.trace_id.clone(),
                    target_stream: span_ctx.source_stream.clone(),
                    scorer_id: Some(self.scorer.entity_id.clone()),
                    scorer_version: Some(self.scorer.version.to_string()),
                    scorer_type: Some(self.scorer.scorer_type),
                    job_id: span_ctx.job_id.clone(),
                    score_config_id: self.score_config.as_ref().map(|sc| sc.entity_id.clone()),
                    score_config_version: self
                        .score_config
                        .as_ref()
                        .map(|sc| sc.version.to_string()),
                    eval_run_id: span_ctx.eval_run_id.clone(),
                    provider_id: None,
                    provider_name: None,
                    provider_type: None,
                    model: None,
                    latency_ms: latency.as_millis() as i64,
                    prompt_tokens: None,
                    completion_tokens: None,
                    total_tokens: None,
                    sampling_rate: span_ctx.sampling_rate,
                    sampled: span_ctx.sampled,
                    status: config::meta::self_reporting::evaluator::status::SUCCESS.to_string(),
                    error_kind: None,
                    error_message: None,
                    skip_reason: None,
                    prompt: None,
                    response: Some(remote_output.raw_response),
                });

                Ok(Some(ScoreResult {
                    score_json: score.json,
                    evaluator_trace: trace,
                }))
            }
            Err(e) => {
                let latency = start.elapsed();
                anyhow::bail!(
                    "Remote scorer failed: {e} (latency: {}ms)",
                    latency.as_millis()
                );
            }
        }
    }
}

async fn lookup_score_config_for_scorer(
    org_id: &str,
    scorer: &infra::table::scorers::Scorer,
) -> Option<infra::table::score_configs::ScoreConfig> {
    let entity_id = scorer.produces_score_config_id.as_deref()?;
    match scorer.produces_score_config_version {
        Some(version) => {
            infra::table::score_configs::get_by_entity_id_and_version(org_id, entity_id, version)
                .await
                .ok()
                .flatten()
        }
        None => infra::table::score_configs::get_by_entity_id(org_id, entity_id)
            .await
            .ok()
            .flatten(),
    }
}
