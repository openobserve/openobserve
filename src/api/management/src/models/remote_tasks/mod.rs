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

//! HTTP shapes for the Remote Task registry.
//!
//! Secret material never appears here in either direction. A request carries a
//! Secret reference, and a response carries whether one is configured — the
//! write-only rule the registration form depends on is enforced by the response
//! type not having a field to leak.

use openobserve_core::llm_evaluations::remote_tasks::{
    RemoteTask, RemoteTaskAuth, RemoteTaskHeader, RemoteTaskRetryPolicy, RemoteTaskSigning,
    RemoteTaskSpec, VerificationReport,
};
use openobserve_core::llm_evaluations::secrets::{
    SecretMaterial, SecretMetadata, SecretOwnerKind, SecretPurpose, WrittenSecret,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The configuration a registration or edit submits.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteTaskRequestBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub endpoint: String,
    #[serde(default)]
    pub http_method: Option<String>,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub auth: Option<RemoteTaskAuth>,
    #[serde(default)]
    #[schema(value_type = Vec<Object>)]
    pub custom_headers: Option<Vec<RemoteTaskHeader>>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub request_template: Option<String>,
    #[serde(default)]
    pub response_schema: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_attempts: Option<u32>,
    #[serde(default)]
    pub max_concurrency: Option<u32>,
    #[serde(default)]
    #[schema(value_type = Object)]
    pub signing: Option<RemoteTaskSigning>,
    /// The published version this edit started from. Ignored when a draft
    /// already exists, because a head has only one.
    #[serde(default)]
    pub from_version: Option<i32>,
}

impl RemoteTaskRequestBody {
    /// Fill the unstated fields with the documented defaults.
    pub fn into_spec(self) -> RemoteTaskSpec {
        use openobserve_core::llm_evaluations::remote_tasks::{
            DEFAULT_CONTENT_TYPE, DEFAULT_HTTP_METHOD, DEFAULT_MAX_CONCURRENCY,
            DEFAULT_RESPONSE_SCHEMA, DEFAULT_TIMEOUT_MS,
        };
        RemoteTaskSpec {
            name: self.name,
            endpoint: self.endpoint,
            http_method: self
                .http_method
                .unwrap_or_else(|| DEFAULT_HTTP_METHOD.to_string()),
            auth: self.auth.unwrap_or_default(),
            custom_headers: self.custom_headers.unwrap_or_default(),
            content_type: self
                .content_type
                .unwrap_or_else(|| DEFAULT_CONTENT_TYPE.to_string()),
            request_template: self.request_template,
            response_schema: self
                .response_schema
                .unwrap_or_else(|| DEFAULT_RESPONSE_SCHEMA.to_string()),
            timeout_ms: self.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
            retry_policy: self
                .max_attempts
                .map(|max_attempts| RemoteTaskRetryPolicy { max_attempts })
                .unwrap_or_default(),
            max_concurrency: self.max_concurrency.unwrap_or(DEFAULT_MAX_CONCURRENCY),
            signing: self.signing.unwrap_or_default(),
        }
    }
}

/// What a header looks like on the way out: its key, and its literal value only
/// when it has one. A header backed by a Secret reports that it is, never what.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTaskHeaderResponse {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub uses_secret: bool,
}

/// Auth on the way out: the shape, and whether a Secret is configured.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTaskAuthResponse {
    #[serde(rename = "type")]
    pub auth_type: String,
    pub uses_secret: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_name: Option<String>,
}

impl From<&RemoteTaskAuth> for RemoteTaskAuthResponse {
    fn from(auth: &RemoteTaskAuth) -> Self {
        let auth_type = match auth {
            RemoteTaskAuth::None => "none",
            RemoteTaskAuth::Bearer { .. } => "bearer",
            RemoteTaskAuth::Basic { .. } => "basic",
            RemoteTaskAuth::ApiKeyHeader { .. } => "api_key_header",
        };
        Self {
            auth_type: auth_type.to_string(),
            uses_secret: auth.secret_ref().is_some(),
            header_name: match auth {
                RemoteTaskAuth::ApiKeyHeader { header_name, .. } => Some(header_name.clone()),
                _ => None,
            },
        }
    }
}

/// Signing on the way out. The key id is shown because the receiver needs it to
/// select a key; the secret behind it is not.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTaskSigningResponse {
    pub enabled: bool,
    pub uses_secret: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_id: Option<String>,
}

impl From<&RemoteTaskSigning> for RemoteTaskSigningResponse {
    fn from(signing: &RemoteTaskSigning) -> Self {
        Self {
            enabled: signing.enabled,
            uses_secret: signing
                .secret_ref
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            key_id: signing.key_id.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTaskResponseBody {
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    /// `0` marks the head's draft, which no Experiment can reference.
    pub version: i32,
    pub is_draft: bool,
    /// Whether an Experiment may pin this row.
    pub is_referenceable: bool,
    /// `name@version`, present only when there is a version to pin.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_ref: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub endpoint: String,
    pub http_method: String,
    pub auth: RemoteTaskAuthResponse,
    pub custom_headers: Vec<RemoteTaskHeaderResponse>,
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_template: Option<String>,
    pub response_schema: String,
    pub timeout_ms: u64,
    pub max_attempts: u32,
    pub max_concurrency: u32,
    pub signing: RemoteTaskSigningResponse,
    pub verification_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_source_version: Option<i32>,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<RemoteTask> for RemoteTaskResponseBody {
    fn from(task: RemoteTask) -> Self {
        let is_draft = task.is_draft();
        let is_referenceable = task.is_referenceable();
        let task_ref = (!is_draft).then(|| format!("{}@{}", task.spec.name, task.version));
        Self {
            id: task.id,
            org_id: task.org_id,
            entity_id: task.entity_id,
            version: task.version,
            is_draft,
            is_referenceable,
            task_ref,
            name: task.spec.name,
            description: task.description,
            endpoint: task.spec.endpoint,
            http_method: task.spec.http_method,
            auth: RemoteTaskAuthResponse::from(&task.spec.auth),
            custom_headers: task
                .spec
                .custom_headers
                .iter()
                .map(|header| RemoteTaskHeaderResponse {
                    key: header.key.clone(),
                    value: header.value.clone(),
                    uses_secret: header.secret_ref.is_some(),
                })
                .collect(),
            content_type: task.spec.content_type,
            request_template: task.spec.request_template,
            response_schema: task.spec.response_schema,
            timeout_ms: task.spec.timeout_ms,
            max_attempts: task.spec.retry_policy.max_attempts,
            max_concurrency: task.spec.max_concurrency,
            signing: RemoteTaskSigningResponse::from(&task.spec.signing),
            verification_status: task.verification_status.as_str().to_string(),
            verification_error: task.verification_error,
            verified_at: task.verified_at,
            draft_source_version: task.draft_source_version,
            is_active: task.is_active,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListRemoteTasksResponseBody {
    pub list: Vec<RemoteTaskResponseBody>,
}

impl From<Vec<RemoteTask>> for ListRemoteTasksResponseBody {
    fn from(tasks: Vec<RemoteTask>) -> Self {
        Self {
            list: tasks.into_iter().map(Into::into).collect(),
        }
    }
}

/// The sample a test connection sends. Hand-entered, because the wizard's Test
/// connection stays at one row.
#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestConnectionRequestBody {
    #[serde(default)]
    pub input: Option<serde_json::Value>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

/// The raw exchange a test connection produced, shown to the operator whether
/// it passed or failed.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReportBody {
    pub raw_request: String,
    pub raw_response: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_output: Option<serde_json::Value>,
    pub latency_ms: i64,
}

impl From<VerificationReport> for VerificationReportBody {
    fn from(report: VerificationReport) -> Self {
        Self {
            raw_request: report.raw_request,
            raw_response: report.raw_response,
            status_code: report.status_code,
            parsed_output: report.parsed_output,
            latency_ms: report.latency_ms,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublishRemoteTaskResponseBody {
    /// False when the test connection failed. No version was published and the
    /// draft is unchanged apart from the recorded reason.
    pub published: bool,
    /// Whether the publish minted a new version. A description-only edit
    /// publishes none.
    pub version_bumped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub task: RemoteTaskResponseBody,
    pub report: VerificationReportBody,
}

#[cfg(test)]
mod tests {
    use openobserve_core::llm_evaluations::remote_tasks::{RemoteTaskAuth, VerificationStatus};

    use super::*;

    fn task(version: i32, status: VerificationStatus) -> RemoteTask {
        RemoteTask {
            id: "rt-1".to_string(),
            org_id: "org".to_string(),
            entity_id: "head-1".to_string(),
            version,
            description: None,
            spec: RemoteTaskSpec {
                name: "summarizer".to_string(),
                endpoint: "https://tasks.example.com/run".to_string(),
                http_method: "POST".to_string(),
                auth: RemoteTaskAuth::Bearer {
                    secret_ref: "super-secret-reference".to_string(),
                },
                custom_headers: vec![
                    RemoteTaskHeader {
                        key: "x-team".to_string(),
                        value: Some("search".to_string()),
                        secret_ref: None,
                    },
                    RemoteTaskHeader {
                        key: "x-api-key".to_string(),
                        value: None,
                        secret_ref: Some("header-secret-reference".to_string()),
                    },
                ],
                content_type: "application/json".to_string(),
                request_template: None,
                response_schema: "$.output".to_string(),
                timeout_ms: 60_000,
                retry_policy: RemoteTaskRetryPolicy { max_attempts: 3 },
                max_concurrency: 4,
                signing: RemoteTaskSigning {
                    enabled: true,
                    secret_ref: Some("signing-secret-reference".to_string()),
                    key_id: Some("k1".to_string()),
                },
            },
            verification_status: status,
            verification_error: None,
            verified_at: Some(5),
            draft_source_version: None,
            is_active: true,
            created_at: 1,
            updated_at: 2,
        }
    }

    #[test]
    fn no_secret_reference_survives_the_trip_to_the_client() {
        let body = RemoteTaskResponseBody::from(task(2, VerificationStatus::Verified));
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("super-secret-reference"));
        assert!(!json.contains("header-secret-reference"));
        assert!(!json.contains("signing-secret-reference"));
        assert!(!json.contains("secretRef"));
        assert!(!json.contains("secret_ref"));
    }

    #[test]
    fn a_configured_secret_is_reported_as_present_without_its_value() {
        let body = RemoteTaskResponseBody::from(task(2, VerificationStatus::Verified));
        assert_eq!(body.auth.auth_type, "bearer");
        assert!(body.auth.uses_secret);
        assert!(body.signing.enabled);
        assert!(body.signing.uses_secret);
        assert_eq!(body.signing.key_id.as_deref(), Some("k1"));

        let literal = &body.custom_headers[0];
        assert_eq!(literal.value.as_deref(), Some("search"));
        assert!(!literal.uses_secret);

        let secret = &body.custom_headers[1];
        assert_eq!(secret.value, None);
        assert!(secret.uses_secret);
    }

    #[test]
    fn a_published_version_carries_the_reference_an_experiment_pins() {
        let body = RemoteTaskResponseBody::from(task(2, VerificationStatus::Verified));
        assert_eq!(body.task_ref.as_deref(), Some("summarizer@2"));
        assert!(body.is_referenceable);
        assert!(!body.is_draft);
    }

    #[test]
    fn a_draft_offers_no_reference_to_pin() {
        let body = RemoteTaskResponseBody::from(task(0, VerificationStatus::Unverified));
        assert_eq!(body.task_ref, None);
        assert!(body.is_draft);
        assert!(!body.is_referenceable);
    }

    #[test]
    fn an_unstated_field_becomes_the_documented_default() {
        let spec = RemoteTaskRequestBody {
            name: "summarizer".to_string(),
            description: None,
            endpoint: "https://tasks.example.com/run".to_string(),
            http_method: None,
            auth: None,
            custom_headers: None,
            content_type: None,
            request_template: None,
            response_schema: None,
            timeout_ms: None,
            max_attempts: None,
            max_concurrency: None,
            signing: None,
            from_version: None,
        }
        .into_spec();
        assert_eq!(spec.http_method, "POST");
        assert_eq!(spec.content_type, "application/json");
        assert_eq!(spec.response_schema, "$.output");
        assert_eq!(spec.timeout_ms, 60_000);
        assert_eq!(spec.retry_policy.max_attempts, 3);
        assert_eq!(spec.max_concurrency, 4);
        assert_eq!(spec.auth, RemoteTaskAuth::None);
        assert!(!spec.signing.enabled);
    }
}

// --- Test-run bench (#2442) ---

/// One sample a test run should try: a hand-entered input or a Dataset row the
/// caller already resolved.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestRunSampleBody {
    /// A stable handle to line a result back up with its input. A Dataset row
    /// id, or a caller-chosen label for a hand-entered sample.
    #[serde(default)]
    pub row_id: Option<String>,
    pub input: serde_json::Value,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestRunRequestBody {
    /// At most ten samples. Enforced again server-side.
    pub samples: Vec<TestRunSampleBody>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TestRunRowResultBody {
    pub row_id: String,
    pub input: serde_json::Value,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_output: Option<serde_json::Value>,
    pub raw_request: String,
    pub raw_response: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    pub latency_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<openobserve_core::llm_evaluations::remote_tasks::bench::BenchRowResult>
    for TestRunRowResultBody
{
    fn from(
        result: openobserve_core::llm_evaluations::remote_tasks::bench::BenchRowResult,
    ) -> Self {
        Self {
            row_id: result.row_id,
            input: result.input,
            status: result.status.as_str().to_string(),
            parsed_output: result.parsed_output,
            raw_request: result.raw_request,
            raw_response: result.raw_response,
            http_status: result.http_status,
            latency_ms: result.latency_ms,
            error: result.error,
        }
    }
}

/// The whole test-run result. Volatile: it is this response and nothing else —
/// no Experiment, no execution records, no history.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TestRunResponseBody {
    pub results: Vec<TestRunRowResultBody>,
}

// --- Encrypted, write-only Remote Task secrets (#2437) ---

#[derive(Clone, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RemoteTaskSecretMaterialBody {
    Token { value: String },
    Basic { username: String, password: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RemoteTaskSecretPurposeBody {
    Auth,
    Signing,
}

impl From<RemoteTaskSecretPurposeBody> for SecretPurpose {
    fn from(value: RemoteTaskSecretPurposeBody) -> Self {
        match value {
            RemoteTaskSecretPurposeBody::Auth => Self::Auth,
            RemoteTaskSecretPurposeBody::Signing => Self::Signing,
        }
    }
}

impl From<SecretPurpose> for RemoteTaskSecretPurposeBody {
    fn from(value: SecretPurpose) -> Self {
        match value {
            SecretPurpose::Auth => Self::Auth,
            SecretPurpose::Signing => Self::Signing,
        }
    }
}

impl From<RemoteTaskSecretMaterialBody> for SecretMaterial {
    fn from(value: RemoteTaskSecretMaterialBody) -> Self {
        match value {
            RemoteTaskSecretMaterialBody::Token { value } => Self::Token { value },
            RemoteTaskSecretMaterialBody::Basic { username, password } => {
                Self::Basic { username, password }
            }
        }
    }
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRemoteTaskSecretRequestBody {
    pub purpose: RemoteTaskSecretPurposeBody,
    /// Optional only for signing secrets, where OpenObserve generates a
    /// cryptographically random value and returns it exactly once.
    pub material: Option<RemoteTaskSecretMaterialBody>,
    pub key_id: Option<String>,
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRemoteTaskSecretRequestBody {
    pub material: RemoteTaskSecretMaterialBody,
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RotateRemoteTaskSecretRequestBody {
    /// Normally omitted so OpenObserve creates the candidate and shows it
    /// exactly once. Accepted for deterministic external key-management flows.
    pub material: Option<RemoteTaskSecretMaterialBody>,
    pub key_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivateRemoteTaskSecretRequestBody {
    pub grace_period_ms: i64,
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RemoteTaskSecretMaterialResponseBody {
    Token { value: String },
    Basic { username: String, password: String },
}

impl From<SecretMaterial> for RemoteTaskSecretMaterialResponseBody {
    fn from(value: SecretMaterial) -> Self {
        match value {
            SecretMaterial::Token { value } => Self::Token { value },
            SecretMaterial::Basic { username, password } => Self::Basic { username, password },
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTaskSecretMetadataBody {
    pub secret_ref: String,
    pub purpose: RemoteTaskSecretPurposeBody,
    pub key_id: Option<String>,
    pub state: String,
    pub last_verified_at: Option<i64>,
    pub grace_expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<SecretMetadata> for RemoteTaskSecretMetadataBody {
    fn from(value: SecretMetadata) -> Self {
        debug_assert_eq!(value.owner_kind, SecretOwnerKind::Task);
        Self {
            secret_ref: value.secret_ref,
            purpose: value.purpose.into(),
            key_id: value.key_id,
            state: value.state,
            last_verified_at: value.last_verified_at,
            grace_expires_at: value.grace_expires_at,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WrittenRemoteTaskSecretResponseBody {
    #[serde(flatten)]
    pub metadata: RemoteTaskSecretMetadataBody,
    /// Returned only from this create/rotate response. No read route
    /// exposes it later.
    pub material: RemoteTaskSecretMaterialResponseBody,
}

impl From<WrittenSecret> for WrittenRemoteTaskSecretResponseBody {
    fn from(value: WrittenSecret) -> Self {
        Self {
            metadata: value.metadata.into(),
            material: value.material.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListRemoteTaskSecretsResponseBody {
    pub list: Vec<RemoteTaskSecretMetadataBody>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TestRemoteTaskSecretCandidateResponseBody {
    pub verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<RemoteTaskSecretMetadataBody>,
    pub report: VerificationReportBody,
}
