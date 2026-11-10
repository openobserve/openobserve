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

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query, rejection::JsonRejection},
    response::Response,
};
use config::meta::{
    search::{Query as SearchQuery, Request as SearchRequest},
    self_reporting::usage::TRIGGERS_STREAM,
    stream::StreamType,
};
use o2_enterprise::enterprise::security::sigma::{
    self, ApplicableRule, CatalogRule, MitreCoverage,
    attack::{MatrixDetection, matrix_detection},
    catalog::{self, SourceLogsource},
    compile::{CompiledSigma, UnseenField},
    correlation::{CompiledCorrelation, FiredGroup, fired_groups},
    types::SigmaRule,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{alerts::alert::get_by_id, auth::UserEmail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::{IntoParams, ToSchema};

use super::security_allowed;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Pasted rules are hand-written YAML; anything larger is not a rule.
const MAX_RULE_YAML: usize = 256 * 1024;

/// Evidence rows shown per fired group.
const EVIDENCE_ROWS: i64 = 50;

#[derive(Debug, Serialize, ToSchema)]
pub struct SigmaCatalogError {
    pub message: String,
    pub yaml: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SigmaCatalogResponse {
    /// Single-event rules, then correlations.
    pub rules: Vec<CatalogRule>,
    /// Shipped rules that failed to parse, surfaced rather than dropped.
    pub errors: Vec<SigmaCatalogError>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct SigmaCompileRequest {
    /// A pasted rule or correlation file; takes precedence over `rule_id`.
    #[serde(default)]
    pub rule_yaml: Option<String>,
    /// A catalog rule's key (its id, else its title).
    #[serde(default)]
    pub rule_id: Option<String>,
    /// The classifier's source type id; unknown or empty compiles with no source.
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub stream: Option<String>,
    /// Defaults to logs.
    #[serde(default)]
    pub stream_type: Option<String>,
    /// The stream's columns; loaded from its schema when omitted.
    #[serde(default)]
    pub fields: Option<Vec<String>>,
    /// Column to stored type; loaded with the schema when `fields` is omitted.
    #[serde(default)]
    pub field_types: Option<HashMap<String, String>>,
}

/// The OCSF class guard a rule runs under on an OCSF-native stream.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OcsfBridge {
    pub class_uid: u32,
    pub activity_id: Option<u32>,
    pub product: Option<String>,
}

#[derive(Debug, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SigmaCompileResponse {
    /// The rule that was compiled.
    pub rule: Option<CatalogRule>,
    pub compiled: Option<CompiledSigma>,
    /// The grouped SQL, for a correlation rule on a named stream.
    pub correlation: Option<CompiledCorrelation>,
    /// Set when runnable on a named stream; a detection saves it as its SQL.
    pub sql: Option<String>,
    /// Host and user columns the query projects so its firings group into one case.
    pub entity_fields: Vec<String>,
    /// False when the rule was written for another logsource than the source's.
    pub applies: bool,
    pub ocsf_bridge: Option<OcsfBridge>,
    /// When no rule is named, every catalog rule for the source, runnable and most severe first.
    pub applicable: Vec<ApplicableRule>,
    /// Why a pasted rule did not parse.
    pub parse_error: Option<String>,
    /// Columns no event has carried yet; a detection creates them so it is armed before the first.
    pub unseen_fields: Vec<UnseenField>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct EvidenceParams {
    /// The firing's trigger-row timestamp, in microseconds.
    pub firing_time: i64,
    /// The run's evaluated window, in microseconds; used when the firing stored no groups.
    pub start_time: i64,
    pub end_time: i64,
}

/// One group a firing fired on and the events behind it.
#[derive(Debug, Serialize, ToSchema)]
pub struct EvidenceGroup {
    #[serde(flatten)]
    pub group: FiredGroup,
    pub sql: String,
    #[schema(value_type = Vec<Object>)]
    pub rows: Vec<Value>,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct DetectionEvidence {
    pub stream: String,
    pub correlation: bool,
    /// False when the firing predates stored groups, so they were re-derived from its window.
    pub stored: bool,
    pub groups: Vec<EvidenceGroup>,
    /// Why there is no evidence query, such as a rule that no longer compiles on the stream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// GetSigmaCatalog
#[utoipa::path(
    get,
    path = "/{org_id}/security/sigma/catalog",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetSigmaCatalog",
    summary = "The shipped Sigma detection catalog",
    description = "Every built-in Sigma rule and correlation with its metadata, YAML and the source types it applies to",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SigmaCatalogResponse),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_catalog(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("The detection catalog needs the Security permission");
    }
    let errors = catalog::catalog_errors()
        .iter()
        .chain(catalog::correlation_catalog_errors())
        .map(|e| SigmaCatalogError {
            message: e.message.clone(),
            yaml: e.yaml.clone(),
        })
        .collect();
    MetaHttpResponse::json(SigmaCatalogResponse {
        rules: catalog::detection_catalog()
            .iter()
            .map(sigma::catalog_rule)
            .collect(),
        errors,
    })
}

/// CompileSigmaRule
#[utoipa::path(
    post,
    path = "/{org_id}/security/sigma/compile",
    context_path = "/api",
    tag = "Security",
    operation_id = "CompileSigmaRule",
    summary = "Compile a Sigma rule for a stream",
    description = "Compiles a catalog or pasted Sigma rule against a stream's columns into the SQL predicate (and, for a correlation, the grouped query) a detection runs, or the reason it cannot run; with no rule, compiles every catalog rule for the source. Read-only",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = SigmaCompileRequest, description = "Rule, source type and stream", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SigmaCompileResponse),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 404, description = "Rule not found", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn compile(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<SigmaCompileRequest>, JsonRejection>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("Compiling detections needs the Security permission");
    }
    let Json(req) = match body {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(e.body_text()),
    };
    if req
        .rule_yaml
        .as_ref()
        .is_some_and(|y| y.len() > MAX_RULE_YAML)
    {
        return MetaHttpResponse::bad_request("rule_yaml is too large");
    }
    let stream = req.stream.clone().unwrap_or_default();
    let source = stream_source(&org_id, &stream, req.source_type.as_deref()).await;
    let (fields, field_types) = match req.fields.clone() {
        Some(fields) => (fields, req.field_types.clone()),
        None if !stream.is_empty() => {
            let stream_type = StreamType::from(req.stream_type.as_deref().unwrap_or("logs"));
            match infra::schema::get(&org_id, &stream, stream_type).await {
                Ok(schema) => schema_fields(&schema),
                Err(e) => {
                    return MetaHttpResponse::internal_error(format!(
                        "Failed to read the stream schema: {e}"
                    ));
                }
            }
        }
        None => (Vec::new(), None),
    };
    match respond(
        &req,
        source.as_ref(),
        &stream,
        &fields,
        field_types.as_ref(),
    ) {
        Ok(response) => MetaHttpResponse::json(response),
        Err(response) => response,
    }
}

/// GetMitreCoverage
#[utoipa::path(
    get,
    path = "/{org_id}/security/mitre/coverage",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetMitreCoverage",
    summary = "ATT&CK coverage of the catalog and the org's detections",
    description = "The ATT&CK Enterprise matrix with the shipped Sigma rules (correlations included) and the org's SIEM detections placed on it, and the coverage summary; firing counts are not included",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MitreCoverage),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_mitre_coverage(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("ATT&CK coverage needs the Security permission");
    }
    let detections = siem_detections(&org_id).await;
    MetaHttpResponse::json(sigma::coverage(&detections, &[]))
}

/// GetDetectionEvidence
#[utoipa::path(
    get,
    path = "/{org_id}/security/detections/{alert_id}/evidence",
    context_path = "/api",
    tag = "Security",
    operation_id = "GetDetectionEvidence",
    summary = "The events behind one detection firing",
    description = "For each group a SIEM detection firing fired on, the query and rows that made it fire: for a correlation the group's own events (each counted value once), for a single-event rule the matches inside the firing's own event range",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "The detection's alert id"),
        EvidenceParams,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DetectionEvidence),
        (status = 403, description = "Forbidden", content_type = "application/json"),
        (status = 404, description = "Detection not found", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn get_detection_evidence(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(params): Query<EvidenceParams>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "GET").await {
        return MetaHttpResponse::forbidden("Detection evidence needs the Security permission");
    }
    let Ok(id) = alert_id.parse() else {
        return MetaHttpResponse::not_found(format!("No detection {alert_id}"));
    };
    let conn = infra::db::get_orm_client_ro().await;
    let (folder, alert) = match get_by_id(conn, &org_id, id).await {
        Ok((folder, alert)) if super::marks_siem(alert.context_attributes.as_ref()) => {
            (folder, alert)
        }
        _ => return MetaHttpResponse::not_found(format!("No detection {alert_id}")),
    };
    if let Err(resp) =
        super::guard_alert_read(&org_id, &user_id, &alert_id, &folder.folder_id).await
    {
        return resp;
    }
    if let Err(resp) =
        super::guard_stream_reads(&org_id, &user_id, [alert.stream_name.as_str()]).await
    {
        return resp;
    }
    let attrs = alert.context_attributes.clone().unwrap_or_default();
    let attr = |key: &str| attrs.get(key).cloned().unwrap_or_default();
    let stream = alert.stream_name.clone();
    let rule = match sigma::parse_any(&attr("sigma_yaml")) {
        Ok(rule) => rule,
        Err(e) => return MetaHttpResponse::bad_request(format!("The detection's rule: {e}")),
    };
    let source = stream_source(&org_id, &stream, Some(&attr("source_type"))).await;
    let (fields, field_types) = match infra::schema::get(&org_id, &stream, StreamType::Logs).await {
        Ok(schema) => schema_fields(&schema),
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "Failed to read the stream schema: {e}"
            ));
        }
    };
    let compiled = sigma::compile_rule(
        &rule,
        source.as_ref(),
        &stream,
        &fields,
        field_types.as_ref(),
    );
    let mut evidence = DetectionEvidence {
        stream: stream.clone(),
        correlation: rule.correlation.is_some(),
        ..Default::default()
    };
    let stored = stored_groups(&org_id, &user_id, &alert_id, params.firing_time).await;
    evidence.stored = stored.is_some();
    let groups = match stored {
        Some(groups) => groups,
        None => match &compiled.correlation {
            Some(correlation) if correlation.runnable => {
                let rows = search_rows(
                    &org_id,
                    &user_id,
                    &stream,
                    correlation.sql.clone(),
                    params.start_time,
                    params.end_time,
                    sigma::correlation::MAX_FIRED_GROUPS as i64,
                )
                .await
                .unwrap_or_default();
                let rows: Vec<Map<String, Value>> = rows
                    .into_iter()
                    .filter_map(|r| r.as_object().cloned())
                    .collect();
                fired_groups(&rows)
            }
            Some(_) => Vec::new(),
            None => vec![FiredGroup {
                values: Map::new(),
                first_seen: params.start_time,
                last_seen: params.end_time,
                event_count: 0,
            }],
        },
    };
    let queries = match sigma::evidence_queries(
        &rule,
        source.as_ref(),
        &stream,
        &fields,
        field_types.as_ref(),
        &groups,
    ) {
        Ok(queries) => queries,
        Err(reason) => {
            evidence.error = Some(reason);
            return MetaHttpResponse::json(evidence);
        }
    };
    for (group, sql) in groups.into_iter().zip(queries) {
        let rows = search_rows(
            &org_id,
            &user_id,
            &stream,
            sql.clone(),
            group.first_seen,
            group.last_seen + 1,
            EVIDENCE_ROWS,
        )
        .await
        .unwrap_or_default();
        evidence.groups.push(EvidenceGroup { group, sql, rows });
    }
    MetaHttpResponse::json(evidence)
}

/// The classifier's source for a stream, marked packed when an OCSF pack is attached to it.
async fn stream_source(
    org_id: &str,
    stream: &str,
    requested: Option<&str>,
) -> Option<SourceLogsource> {
    let setting = if stream.is_empty() {
        None
    } else {
        infra::schema::get_settings(org_id, stream, StreamType::Logs)
            .await
            .and_then(|s| s.security.clone())
    };
    let id = requested
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .or_else(|| setting.as_ref().map(|s| s.source_type.clone()))?;
    let mut source = catalog::source_logsource(&id)?.clone();
    source.packed = setting.is_some_and(|s| !s.pack_id.is_empty());
    Some(source)
}

/// The groups the scheduler stored on this firing's trigger row; `None` for older firings.
async fn stored_groups(
    org_id: &str,
    user_id: &str,
    alert_id: &str,
    firing_time: i64,
) -> Option<Vec<FiredGroup>> {
    let schema = infra::schema::get(org_id, TRIGGERS_STREAM, StreamType::Logs)
        .await
        .ok()?;
    schema.field_with_name("siem_groups").ok()?;
    let id = alert_id.replace('\'', "''").replace('%', "");
    let sql = format!(
        "SELECT siem_groups FROM \"{TRIGGERS_STREAM}\" WHERE key LIKE '%{id}%' AND siem_groups IS NOT NULL AND siem_groups <> ''"
    );
    let rows = search_rows(
        org_id,
        user_id,
        TRIGGERS_STREAM,
        sql,
        firing_time,
        firing_time + 1,
        1,
    )
    .await?;
    let text = rows.first()?.get("siem_groups")?.as_str()?.to_string();
    serde_json::from_str(&text).ok()
}

/// Runs `sql` over the stream with the caller's permissions; `None` when it cannot be read.
async fn search_rows(
    org_id: &str,
    user_id: &str,
    stream: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> Option<Vec<Value>> {
    search_service::check_search_allowed(org_id, Some((stream, StreamType::Logs))).ok()?;
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size,
            track_total_hits: false,
            ..Default::default()
        },
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    search_service::search(
        &trace_id,
        org_id,
        StreamType::Logs,
        Some(user_id.to_string()),
        &req,
    )
    .await
    .ok()
    .map(|res| res.hits)
}

/// The org's SIEM detections, as the matrix reads them, from the alert cache.
async fn siem_detections(org_id: &str) -> Vec<MatrixDetection> {
    let prefix = format!("{org_id}/");
    let cache = common::infra::config::ALERTS.read().await;
    let mut detections: Vec<MatrixDetection> = cache
        .iter()
        .filter(|(key, _)| key.starts_with(&prefix))
        .filter_map(|(_, (_, alert))| {
            let id = alert.id.map(|id| id.to_string()).unwrap_or_default();
            matrix_detection(
                &id,
                &alert.name,
                alert.enabled,
                alert.context_attributes.as_ref(),
            )
        })
        .collect();
    detections.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    detections
}

fn schema_fields(schema: &arrow_schema::Schema) -> (Vec<String>, Option<HashMap<String, String>>) {
    let fields = schema.fields().iter().map(|f| f.name().clone()).collect();
    let types = schema
        .fields()
        .iter()
        .map(|f| (f.name().clone(), f.data_type().to_string()))
        .collect();
    (fields, Some(types))
}

/// The compile answer for a request whose stream columns are already known.
fn respond(
    req: &SigmaCompileRequest,
    source: Option<&SourceLogsource>,
    stream: &str,
    fields: &[String],
    field_types: Option<&HashMap<String, String>>,
) -> Result<SigmaCompileResponse, Response> {
    let rule: SigmaRule = match (&req.rule_yaml, &req.rule_id) {
        (Some(yaml), _) => match sigma::parse_any(yaml) {
            Ok(rule) => rule,
            Err(parse_error) => {
                return Ok(SigmaCompileResponse {
                    parse_error: Some(parse_error),
                    ..Default::default()
                });
            }
        },
        (None, Some(id)) => match catalog::detection_catalog().iter().find(|r| r.key() == id) {
            Some(rule) => rule.clone(),
            None => return Err(MetaHttpResponse::not_found(format!("No catalog rule {id}"))),
        },
        (None, None) => {
            let Some(source) = source else {
                return Err(MetaHttpResponse::bad_request(
                    "source_type is required to list the rules for a stream",
                ));
            };
            return Ok(SigmaCompileResponse {
                applies: true,
                applicable: sigma::applicable_rules(source, stream, fields, field_types),
                ..Default::default()
            });
        }
    };
    let result = sigma::compile_rule(&rule, source, stream, fields, field_types);
    Ok(SigmaCompileResponse {
        applies: source.is_none_or(|s| sigma::rule_applies_to(&rule, s)),
        ocsf_bridge: sigma::ocsf_bridge(&rule, source).map(|p| OcsfBridge {
            class_uid: p.class_uid,
            activity_id: p.activity_id,
            product: p.product.map(str::to_string),
        }),
        rule: Some(sigma::catalog_rule(&rule)),
        sql: result.sql,
        entity_fields: result.entity_fields,
        unseen_fields: result.compiled.unseen_fields.clone(),
        compiled: Some(result.compiled),
        // A correlation's SQL names the stream, so it is only meaningful for a named one.
        correlation: result.correlation.filter(|_| !stream.is_empty()),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(rule_id: Option<&str>, rule_yaml: Option<&str>) -> SigmaCompileRequest {
        SigmaCompileRequest {
            rule_id: rule_id.map(str::to_string),
            rule_yaml: rule_yaml.map(str::to_string),
            source_type: Some("okta_system_log".to_string()),
            ..Default::default()
        }
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn test_compiles_a_catalog_correlation_with_its_grouped_sql() {
        let travel = catalog::detection_catalog()
            .iter()
            .find(|r| r.title == "Okta Impossible Travel")
            .unwrap();
        let fields = strings(&[
            "_timestamp",
            "eventtype",
            "outcome_result",
            "actor_alternateid",
            "client_geographicalcontext_country",
        ]);
        let source = catalog::source_logsource("okta_system_log");
        let response = respond(
            &request(Some(travel.key()), None),
            source,
            "okta_auth",
            &fields,
            None,
        )
        .unwrap();
        assert!(response.applies);
        assert!(response.compiled.unwrap().runnable);
        let correlation = response.correlation.unwrap();
        assert!(correlation.sql.contains("FROM \"okta_auth\""));
        assert_eq!(correlation.timespan_minutes, 60);
        assert!(response.rule.unwrap().correlation);
    }

    #[test]
    fn test_a_single_event_rule_answers_its_sql_with_the_entity_columns() {
        let yaml = "title: T\nlogsource: {product: windows, service: security}\ndetection: {s: {EventID: 4625}, condition: s}";
        let source = catalog::source_logsource("windows_security");
        let mut req = request(None, Some(yaml));
        req.source_type = Some("windows_security".to_string());
        let response = respond(
            &req,
            source,
            "winsec",
            &strings(&["_timestamp", "eventid", "computer", "targetusername"]),
            None,
        )
        .unwrap();
        assert_eq!(
            response.entity_fields,
            strings(&["computer", "targetusername"])
        );
        assert_eq!(
            response.sql.as_deref(),
            Some(
                "SELECT \"_timestamp\", \"eventid\", \"computer\", \"targetusername\" FROM \"winsec\" WHERE TRY_CAST(\"eventid\" AS DOUBLE) = 4625"
            )
        );
        let body = serde_json::to_value(&response).unwrap();
        assert!(body["sql"].is_string());
        assert_eq!(
            body["entityFields"],
            serde_json::json!(["computer", "targetusername"])
        );
    }

    #[test]
    fn test_answers_the_columns_a_detection_must_create_first() {
        let root = catalog::detection_catalog()
            .iter()
            .find(|r| r.title == "AWS Root Account Activity")
            .unwrap();
        let response = respond(
            &request(Some(root.key()), None),
            catalog::source_logsource("aws_cloudtrail"),
            "aws_cloudtrail",
            &strings(&[
                "_timestamp",
                "eventname",
                "eventsource",
                "useridentity_type",
            ]),
            None,
        )
        .unwrap();
        assert!(response.compiled.as_ref().unwrap().runnable);
        assert_eq!(response.unseen_fields.len(), 1);
        assert_eq!(response.unseen_fields[0].name, "eventtype");
        let body = serde_json::to_value(&response).unwrap();
        assert_eq!(body["unseenFields"][0]["type"], "Utf8");
        assert!(response.sql.unwrap().contains("\"eventtype\""));
    }

    #[test]
    fn test_reports_a_pasted_rule_that_does_not_parse() {
        let response = respond(
            &request(None, Some("title: [unclosed")),
            None,
            "",
            &[],
            None,
        )
        .unwrap();
        assert!(response.parse_error.is_some());
        assert!(response.compiled.is_none());
    }

    #[test]
    fn test_flags_a_rule_written_for_another_logsource() {
        let yaml = "title: T\nlogsource: {product: windows, service: security}\ndetection: {s: {EventID: 1}, condition: s}";
        let source = catalog::source_logsource("okta_system_log");
        let response = respond(
            &request(None, Some(yaml)),
            source,
            "s",
            &strings(&["EventID"]),
            None,
        )
        .unwrap();
        assert!(!response.applies);
        assert!(response.compiled.unwrap().runnable);
    }

    #[test]
    fn test_lists_applicable_rules_and_refuses_an_unknown_rule() {
        let source = catalog::source_logsource("okta_system_log");
        let listed = respond(
            &request(None, None),
            source,
            "s",
            &strings(&["eventType"]),
            None,
        )
        .unwrap();
        assert!(!listed.applicable.is_empty());
        // Okta's documented fields arm its rules before any event and name the new columns.
        assert!(
            listed
                .applicable
                .iter()
                .any(|r| r.runnable && !r.compiled.unseen_fields.is_empty())
        );
        let ocsf = respond(
            &request(None, None),
            catalog::source_logsource("ocsf_native"),
            "s",
            &strings(&["class_uid"]),
            None,
        )
        .unwrap();
        assert!(
            ocsf.applicable
                .iter()
                .any(|r| !r.runnable && r.reason.is_some())
        );
        assert!(respond(&request(Some("nope"), None), source, "s", &[], None).is_err());
        let mut no_source = request(None, None);
        no_source.source_type = None;
        assert!(respond(&no_source, None, "s", &[], None).is_err());
    }

    #[test]
    fn test_schema_fields_carry_arrow_type_names() {
        let schema = arrow_schema::Schema::new(vec![
            arrow_schema::Field::new("eventid", arrow_schema::DataType::Int64, true),
            arrow_schema::Field::new("user", arrow_schema::DataType::Utf8, true),
        ]);
        let (fields, types) = schema_fields(&schema);
        assert_eq!(fields, strings(&["eventid", "user"]));
        let types = types.unwrap();
        assert_eq!(types["eventid"], "Int64");
        assert_eq!(types["user"], "Utf8");
    }

    #[test]
    fn test_reads_detections_off_siem_attributes_only() {
        let attrs: hashbrown::HashMap<String, String> = [
            ("siem", "true"),
            ("sigma_id", "x"),
            ("sigma_level", "HIGH"),
            ("mitre_techniques", "T1110, T1078.004,"),
            ("mitre_tactics", "credential_access"),
        ]
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let detection = matrix_detection("1", "d", true, Some(&attrs)).unwrap();
        assert_eq!(detection.techniques, strings(&["T1110", "T1078.004"]));
        assert_eq!(detection.level, "high");
        assert!(matrix_detection("2", "plain", true, None).is_none());
    }
}
