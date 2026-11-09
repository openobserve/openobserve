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

use config::meta::self_reporting::llm_scores::LlmScoreTargetScope;
use openobserve_core::llm_evaluations::annotations::{
    AnnotationScoreInput, AnnotationTargetMetadata, CreateAnnotation, PreparedAnnotation,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationScoreRequestBody {
    /// Physical row ID of the immutable Score Config version selected by the user.
    pub score_config_row_id: String,
    /// A number, string, or boolean matching the selected Score Config data type.
    pub value: serde_json::Value,
    #[serde(default)]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationTargetMetadataRequestBody {
    #[serde(default)]
    pub agent_name: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub agent_env: Option<String>,
    #[serde(default)]
    pub agent_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotateRequestBody {
    /// Evaluated target scope: span, trace, or session.
    #[schema(value_type = String)]
    pub scope: LlmScoreTargetScope,
    /// Span ID, trace ID, or session ID according to `scope`.
    pub target_id: String,
    /// Required for span annotations; optional context for trace annotations.
    #[serde(default)]
    pub trace_id: Option<String>,
    /// Optional parent context for span/trace annotations.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Original evaluated object's timestamp in microseconds.
    pub ref_timestamp: i64,
    /// Trace stream containing the evaluated target.
    pub source_stream: String,
    pub scores: Vec<AnnotationScoreRequestBody>,
    /// Agent identity copied from the selected target when available.
    #[serde(default)]
    pub target_metadata: Option<AnnotationTargetMetadataRequestBody>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotateResponseBody {
    pub annotation_id: String,
    pub score_ids: Vec<String>,
    pub annotated_at: i64,
}

impl From<AnnotationScoreRequestBody> for AnnotationScoreInput {
    fn from(value: AnnotationScoreRequestBody) -> Self {
        Self {
            score_config_row_id: value.score_config_row_id,
            value: value.value,
            reasoning: value.reasoning,
            metadata: value.metadata,
        }
    }
}

impl From<AnnotateRequestBody> for CreateAnnotation {
    fn from(value: AnnotateRequestBody) -> Self {
        Self {
            scope: value.scope,
            target_id: value.target_id,
            trace_id: value.trace_id,
            session_id: value.session_id,
            ref_timestamp: value.ref_timestamp,
            source_stream: value.source_stream,
            scores: value
                .scores
                .into_iter()
                .map(AnnotationScoreInput::from)
                .collect(),
            target_metadata: value.target_metadata.unwrap_or_default().into(),
            metadata: value.metadata,
            review: None,
        }
    }
}

impl From<AnnotationTargetMetadataRequestBody> for AnnotationTargetMetadata {
    fn from(value: AnnotationTargetMetadataRequestBody) -> Self {
        Self {
            agent_name: value.agent_name,
            agent_id: value.agent_id,
            agent_env: value.agent_env,
            agent_version: value.agent_version,
        }
    }
}

impl From<&PreparedAnnotation> for AnnotateResponseBody {
    fn from(value: &PreparedAnnotation) -> Self {
        Self {
            annotation_id: value.id.clone(),
            score_ids: value
                .records
                .iter()
                .map(|record| record.id.clone())
                .collect(),
            annotated_at: value.annotated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_rejects_unknown_fields() {
        let result: Result<AnnotateRequestBody, _> = serde_json::from_value(serde_json::json!({
            "scope": "trace",
            "targetId": "trace-1",
            "refTimestamp": 1,
            "sourceStream": "default",
            "scores": [],
            "queueId": "not-applicable"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn request_uses_target_scope_enum_and_agent_metadata() {
        let body: AnnotateRequestBody = serde_json::from_value(serde_json::json!({
            "scope": "session",
            "targetId": "session-1",
            "refTimestamp": 1,
            "sourceStream": "default",
            "scores": [],
            "targetMetadata": {
                "agentId": "agent-1",
                "agentEnv": "production",
                "agentVersion": "1.2.3"
            }
        }))
        .unwrap();

        assert_eq!(body.scope, LlmScoreTargetScope::Session);
        let input: CreateAnnotation = body.into();
        assert_eq!(input.target_metadata.agent_id.as_deref(), Some("agent-1"));
        assert_eq!(
            input.target_metadata.agent_env.as_deref(),
            Some("production")
        );
        assert_eq!(
            input.target_metadata.agent_version.as_deref(),
            Some("1.2.3")
        );
    }
}
