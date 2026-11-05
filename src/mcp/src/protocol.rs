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

use std::str::FromStr;

use anyhow::{Result, anyhow};
use rmcp_openapi::error::{NetworkErrorCategory, ToolCallError, ToolCallExecutionError};
use serde_json::{Value, json};

use super::{
    response_filter::filter_response,
    tools::{get_pinned_tools, get_shared_http_client, get_tool_metadata, tool_search},
    types::*,
};

/// Answer given to tool calls when the MCP tool registry was never built.
const MCP_DISABLED_MESSAGE: &str = "MCP is disabled on this node (ZO_MCP_ENABLED=false)";

/// Largest upstream text a tool result carries; more would swamp most models' context windows.
const MAX_TOOL_RESULT_BYTES: usize = 1024 * 1024;

/// A failed request, carrying the JSON-RPC code the client should see.
struct RpcError {
    code: MCPErrorCode,
    message: String,
}

impl RpcError {
    fn invalid_params(message: String) -> Self {
        Self {
            code: MCPErrorCode::InvalidParams,
            message,
        }
    }
}

impl<E: Into<anyhow::Error>> From<E> for RpcError {
    fn from(error: E) -> Self {
        Self {
            code: MCPErrorCode::InternalError,
            message: error.into().to_string(),
        }
    }
}

/// Route an MCP request to the appropriate handler
pub async fn route_request(
    org_id: &str,
    request: MCPRequest,
    auth_token: Option<String>,
) -> Result<MCPResponse> {
    // Validate JSON-RPC version
    if request.jsonrpc != JSONRPC_VERSION {
        return Ok(MCPResponse::error(
            request.id,
            MCPErrorCode::InvalidRequest,
            format!("Invalid JSON-RPC version. Expected {JSONRPC_VERSION}"),
            None,
        ));
    }

    // Modern (2026-07-28) clients declare their protocol version on every
    // request. An unsupported version must be answered with
    // UnsupportedProtocolVersionError listing the versions we do support so
    // the client can retry with one of them.
    if let Some(version) = request.meta_protocol_version().map(str::to_owned)
        && !is_supported_protocol_version(&version)
    {
        return Ok(MCPResponse::error(
            request.id,
            MCPErrorCode::UnsupportedProtocolVersion,
            "Unsupported protocol version".to_string(),
            Some(json!({
                "supported": MCP_SUPPORTED_PROTOCOL_VERSIONS,
                "requested": version,
            })),
        ));
    }
    let modern = request.is_modern();

    // Parse method
    let method = match MCPMethod::from_str(&request.method) {
        Ok(m) => m,
        Err(e) => {
            return Ok(MCPResponse::error(
                request.id,
                MCPErrorCode::MethodNotFound,
                e,
                None,
            ));
        }
    };

    // `ZO_MCP_ENABLED=false` skips building the tool registry at boot, so there
    // is nothing to list or execute -- answer without touching it.
    let mcp_enabled = config::get_config().common.mcp_enabled;

    // Route to handler
    let result: Result<Value, RpcError> = match method {
        MCPMethod::Initialize => handle_initialize(request.params).map_err(RpcError::from),
        MCPMethod::Ping => handle_ping().map_err(RpcError::from),
        MCPMethod::ToolsList if !mcp_enabled => Ok(json!({ "tools": [] })),
        MCPMethod::ToolsCall if !mcp_enabled => Err(anyhow!(MCP_DISABLED_MESSAGE).into()),
        MCPMethod::ToolsList => handle_tools_list().map_err(RpcError::from),
        MCPMethod::ToolsCall => handle_tools_call(org_id, request.params, auth_token).await,
        MCPMethod::ServerDiscover => handle_server_discover().map_err(RpcError::from),
        // Notifications are one-way; no response body required (HTTP layer returns 202)
        MCPMethod::NotificationsInitialized => Ok(Value::Null),
    };

    match result {
        Ok(mut value) => {
            if modern {
                decorate_modern_result(&mut value, &method);
            }
            Ok(MCPResponse::success(request.id, value))
        }
        Err(e) => Ok(MCPResponse::error(request.id, e.code, e.message, None)),
    }
}

/// Cache lifetime advertised on `server/discover` results (1 hour); the
/// version/capability surface only changes across deployments.
const DISCOVER_TTL_MS: u64 = 3_600_000;
/// Cache lifetime advertised on modern `tools/list` results (5 minutes);
/// the tool set is fixed per process but kept shorter to bound staleness
/// across rolling upgrades.
const TOOLS_LIST_TTL_MS: u64 = 300_000;

/// Server identity for `_meta` (`io.modelcontextprotocol/serverInfo`).
fn server_info_meta() -> Value {
    json!({
        "name": MCP_SERVER_NAME,
        "version": MCP_SERVER_VERSION,
        "title": "OpenObserve MCP Server",
    })
}

/// Add the fields a 2026-07-28 result must or should carry: `resultType`,
/// `_meta` server identity, and cache-control fields on list results.
/// Legacy (initialize-negotiated) responses are left untouched so
/// 2025-11-25 clients never see fields their revision doesn't define.
fn decorate_modern_result(value: &mut Value, method: &MCPMethod) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    obj.entry("resultType").or_insert_with(|| json!("complete"));
    if matches!(method, MCPMethod::ToolsList) {
        obj.entry("ttlMs")
            .or_insert_with(|| json!(TOOLS_LIST_TTL_MS));
        obj.entry("cacheScope").or_insert_with(|| json!("public"));
    }
    let meta = obj
        .entry("_meta")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let Some(meta) = meta.as_object_mut() {
        meta.entry(META_KEY_SERVER_INFO)
            .or_insert_with(server_info_meta);
    }
}

/// Handle server/discover (2026-07-28)
///
/// Required entry point for modern clients (and the stdio
/// backward-compatibility probe): advertises supported protocol versions,
/// capabilities, and identity in a single cacheable result.
fn handle_server_discover() -> Result<Value> {
    Ok(json!({
        "resultType": "complete",
        "supportedVersions": MCP_SUPPORTED_PROTOCOL_VERSIONS,
        "capabilities": {
            "tools": {},
        },
        "instructions": "OpenObserve observability tools. Call tool_search to discover tools for streams, logs, metrics, traces, alerts, dashboards, etc., then execute them via tools_call.",
        "ttlMs": DISCOVER_TTL_MS,
        "cacheScope": "public",
        "_meta": { (META_KEY_SERVER_INFO): server_info_meta() },
    }))
}

/// Handle initialize request
///
/// Per MCP 2025-11-25: reads the client's requested `protocolVersion` and
/// negotiates by responding with the version we support. If the client
/// requests a version we don't support we still respond with ours so the
/// client can decide whether to proceed.
fn handle_initialize(_params: Value) -> Result<Value> {
    let result = InitializeResult {
        protocol_version: MCP_PROTOCOL_VERSION.to_string(),
        capabilities: ServerCapabilities {
            tools: ToolsCapability {},
        },
        server_info: ServerInfo {
            name: MCP_SERVER_NAME.to_string(),
            version: MCP_SERVER_VERSION.to_string(),
            title: Some("OpenObserve MCP Server".to_string()),
        },
    };

    Ok(serde_json::to_value(result)?)
}

/// Handle ping request
fn handle_ping() -> Result<Value> {
    Ok(json!({}))
}

/// Handle tools/list request
/// Returns tool_search + tools_call (2-step pattern)
fn handle_tools_list() -> Result<Value> {
    let mut tools = vec![
        MCPTool {
            name: "tool_search".to_string(),
            title: Some("Search Tools".to_string()),
            description: Some("Search for available tools by name, description, or category. we have a lot of tools related to streams, logs, metrics, traces, alerts, dashboards, incidents, prometheus, patterns, etc. Returns matching tools with their full input schemas so you can call them immediately via tools_call.".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (e.g., 'create alert', 'list streams', 'search logs')"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results to return (default: 3, max: 20)"
                    }
                },
                "required": ["query"]
            }),
            output_schema: None,
            annotations: None,
            http_method: String::new(),
            http_path: String::new(),
            category: None,
            requires_confirmation: false,
            pinned: false,
        },
        MCPTool {
            name: "tools_call".to_string(),
            title: Some("Execute Tool".to_string()),
            description: Some("Execute a tool by name with the arguments from its schema. Use tool_search first to discover tools and their schemas.".to_string()),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "tool": {
                        "type": "string",
                        "description": "Tool name to execute"
                    },
                    "args": {
                        "type": "object",
                        "description": "Arguments matching the tool's inputSchema"
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["summary", "full"],
                        "default": "summary",
                        "description": "Response detail level. 'summary' returns key fields only (default), 'full' returns complete response."
                    }
                },
                "required": ["tool", "args"]
            }),
            output_schema: None,
            annotations: None,
            http_method: String::new(),
            http_path: String::new(),
            category: None,
            requires_confirmation: false,
            pinned: false,
        },
    ];

    // Append pinned tools so LLMs can call common tools without a tool_search round-trip
    tools.extend_from_slice(get_pinned_tools());

    let result = ToolsListResult { tools };
    Ok(serde_json::to_value(&result)?)
}

/// Default and maximum limits for tool_search results
const DEFAULT_SEARCH_LIMIT: usize = 3;
const MAX_SEARCH_LIMIT: usize = 20;

/// Handle tool_search - search for tools by query
fn handle_tool_search(query: &str, limit: Option<usize>) -> Result<Value> {
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT);
    let results = tool_search(query, limit);

    // Return tools with full schemas so the LLM can call them immediately
    let tool_summaries: Vec<ToolSummary> = results
        .into_iter()
        .map(|tool| ToolSummary {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            input_schema: tool.input_schema,
            requires_confirmation: if tool.requires_confirmation {
                Some(true)
            } else {
                None
            },
        })
        .collect();

    Ok(json!({ "tools": tool_summaries }))
}

/// Handle tools_call - execute a tool directly by name
async fn handle_direct_call(
    org_id: &str,
    tool_name: &str,
    args: Value,
    detail: &DetailLevel,
    auth_token: Option<String>,
) -> Result<Value, RpcError> {
    // Find the tool metadata for execution
    let tool_metadata = get_tool_metadata(tool_name)
        .ok_or_else(|| RpcError::invalid_params(format!("Unknown tool: {tool_name}")))?;

    let client = authorized_client(auth_token);
    let result = execute_tool(&client, org_id, &tool_metadata, args, detail).await;

    Ok(serde_json::to_value(result)?)
}

/// Handle tools/call request
/// Routes to tool_search or tools_call
async fn handle_tools_call(
    org_id: &str,
    params: Value,
    auth_token: Option<String>,
) -> Result<Value, RpcError> {
    // Parse parameters
    let call_params: ToolsCallParams = serde_json::from_value(params)
        .map_err(|e| RpcError::invalid_params(format!("Invalid tools/call parameters: {e}")))?;

    match call_params.name.as_str() {
        "tool_search" => {
            let args: ToolSearchArgs =
                serde_json::from_value(call_params.arguments).map_err(|e| {
                    RpcError::invalid_params(format!("Invalid arguments for tool_search: {e}"))
                })?;
            let result = handle_tool_search(&args.query, args.limit)?;
            Ok(json!({
                "content": [{"type": "text", "text": serde_json::to_string(&result)?}]
            }))
        }
        "tools_call" => {
            let args: ToolsCallSimpleArgs =
                serde_json::from_value(call_params.arguments).map_err(|e| {
                    RpcError::invalid_params(format!("Invalid arguments for tools_call: {e}"))
                })?;
            handle_direct_call(org_id, &args.tool, args.args, &args.detail, auth_token).await
        }
        // Pinned tools are exposed directly in tools/list and called by name.
        // Route them straight to execution with their arguments.
        name => {
            handle_direct_call(
                org_id,
                name,
                call_params.arguments,
                &DetailLevel::default(),
                auth_token,
            )
            .await
        }
    }
}

/// Move top-level arguments that actually belong in `request_body` into it.
///
/// rmcp-openapi nests an operation's body under a `request_body` property while
/// path/query params stay top-level. LLMs don't reliably honor that split and
/// often place body fields at the top level. For each top-level argument key
/// that is *not* a declared top-level parameter but *is* a property of the
/// tool's `request_body` schema, relocate it into `request_body`. Existing
/// `request_body` values always win, and genuinely unknown keys are left
/// untouched so they still surface as validation errors.
fn normalize_request_body_fields(schema: &Value, arguments: &mut Value) {
    let Some(args_obj) = arguments.as_object_mut() else {
        return;
    };

    // Top-level declared properties of the tool's input schema.
    let Some(top_props) = schema.get("properties").and_then(Value::as_object) else {
        return;
    };

    // The body sub-schema must be an object with its own properties; otherwise
    // there is nowhere to relocate fields to (e.g. body-less tools).
    let Some(body_props) = top_props
        .get("request_body")
        .and_then(|rb| rb.get("properties"))
        .and_then(Value::as_object)
    else {
        return;
    };

    // Keys present at the top level that are body fields, not top-level params.
    let movable: Vec<String> = args_obj
        .keys()
        .filter(|k| {
            k.as_str() != "request_body"
                && !top_props.contains_key(k.as_str())
                && body_props.contains_key(k.as_str())
        })
        .cloned()
        .collect();

    if movable.is_empty() {
        return;
    }

    // Pull the values out before borrowing request_body mutably.
    let mut moved = serde_json::Map::new();
    for key in movable {
        if let Some(val) = args_obj.remove(&key) {
            moved.insert(key, val);
        }
    }

    let request_body = args_obj
        .entry("request_body")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let Some(body_obj) = request_body.as_object_mut() else {
        // request_body provided but not an object — restore and let it error.
        for (key, val) in moved {
            args_obj.insert(key, val);
        }
        return;
    };
    for (key, val) in moved {
        body_obj.entry(key).or_insert(val);
    }
}

/// Bind path-scoped tool calls to the organization selected by the MCP endpoint URL.
fn bind_organization(http_path: &str, arguments: &mut Value, org_id: &str) {
    if !http_path.contains("{org_id}") {
        return;
    }
    let Some(arguments) = arguments.as_object_mut() else {
        return;
    };
    arguments.insert("org_id".to_string(), Value::String(org_id.to_string()));
}

/// Percent-encode path arguments as single segments; rmcp-openapi substitutes them raw.
fn encode_path_parameters(
    metadata: &rmcp_openapi::ToolMetadata,
    arguments: &mut Value,
) -> Result<()> {
    let Some(arguments) = arguments.as_object_mut() else {
        return Ok(());
    };
    for (name, mapping) in &metadata.parameter_mappings {
        if mapping.location != "path" {
            continue;
        }
        let Some(value) = arguments.get_mut(name) else {
            continue;
        };
        match value {
            Value::String(s) if s.is_empty() || s == "." || s == ".." => {
                return Err(anyhow!("Invalid path parameter '{name}'"));
            }
            Value::String(s) => *s = encode_path_segment(s),
            Value::Array(_) | Value::Object(_) => {
                return Err(anyhow!("Path parameter '{name}' must be a scalar"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Encode only what can reroute or re-substitute a value; permission checks read the raw path.
fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for c in value.chars() {
        // The URL parser drops tab/LF/CR and trailing spaces, which can leave a bare `..`.
        if matches!(c, '%' | '/' | '\\' | '?' | '#' | ' ' | '{' | '}') || c.is_ascii_control() {
            encoded.push_str(&format!("%{:02X}", c as u32));
        } else {
            encoded.push(c);
        }
    }
    encoded
}

fn structured_content(content_text: &str) -> Option<Value> {
    // The spec types structuredContent as an object; arrays and scalars stay text-only
    serde_json::from_str::<Value>(content_text)
        .ok()
        .filter(Value::is_object)
}

/// The shared HTTP client, carrying the caller's own credentials when it sent any.
fn authorized_client(auth_token: Option<String>) -> rmcp_openapi::HttpClient {
    let shared_client = get_shared_http_client();
    match auth_token {
        Some(token) => shared_client.with_authorization(&token),
        None => shared_client.clone(),
    }
}

/// What a client may be told of a failed API request; the cause stays in the server log.
fn execution_failure_text(
    error: &ToolCallExecutionError,
    tool: &rmcp_openapi::ToolMetadata,
) -> &'static str {
    // rmcp-openapi adds `timeout_seconds` only to tools with query, header or cookie parameters.
    let accepts_timeout = tool.parameters["properties"]
        .get("timeout_seconds")
        .is_some();
    match error {
        ToolCallExecutionError::NetworkError {
            category: NetworkErrorCategory::Timeout,
            ..
        } => {
            if accepts_timeout {
                "the request timed out; retry with a narrower request or a larger `timeout_seconds`"
            } else {
                "the request timed out; retry with a narrower request"
            }
        }
        ToolCallExecutionError::NetworkError { .. }
        | ToolCallExecutionError::HttpError { .. }
        | ToolCallExecutionError::ResponseParsingError { .. } => {
            "the request to the OpenObserve API could not be completed"
        }
    }
}

/// `text` cut to `MAX_TOOL_RESULT_BYTES` at a character boundary, marked when it was longer.
fn clipped(text: String) -> String {
    if text.len() <= MAX_TOOL_RESULT_BYTES {
        return text;
    }
    let mut end = MAX_TOOL_RESULT_BYTES;
    // Index 0 is always a character boundary, so this stops before `end` underflows.
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [truncated]", &text[..end])
}

fn error_result(text: String) -> ToolsCallResult {
    ToolsCallResult {
        content: vec![ToolContent::Text { text }],
        is_error: Some(true),
        structured_content: None,
    }
}

/// Execute a tool through `client`; every failure comes back as an `isError` result.
async fn execute_tool(
    client: &rmcp_openapi::HttpClient,
    org_id: &str,
    metadata: &rmcp_openapi::ToolMetadata,
    mut arguments: Value,
    detail: &DetailLevel,
) -> ToolsCallResult {
    // LLMs frequently hoist request-body fields to the top level of the tool
    // arguments (e.g. `tabId` on AddPanel/UpdatePanel, which the schema nests
    // under `request_body`). That fails rmcp-openapi validation with
    // "invalid parameter '<field>'". Be liberal in what we accept at the MCP
    // adapter — relocate such fields into `request_body` before validation —
    // so the underlying HTTP API contract stays untouched.
    normalize_request_body_fields(&metadata.parameters, &mut arguments);
    bind_organization(&metadata.path, &mut arguments, org_id);
    if let Err(e) = encode_path_parameters(metadata, &mut arguments) {
        return error_result(format!("Tool execution failed: {e}"));
    }

    let http_response = match client.execute_tool_call(metadata, &arguments).await {
        Ok(response) => response,
        Err(ToolCallError::Validation(e)) => {
            return error_result(format!("Tool execution failed: {e}"));
        }
        Err(ToolCallError::Execution(e)) => {
            log::warn!("MCP tool {} failed: {e}", metadata.name);
            let reason = execution_failure_text(&e, metadata);
            return error_result(format!("Tool execution failed: {reason}"));
        }
    };

    if !http_response.is_success {
        return error_result(format!(
            "Error {}: {}",
            http_response.status_code,
            clipped(http_response.body)
        ));
    }

    let content_text = filter_response(&metadata.name, &http_response.body, detail);
    if content_text.len() > MAX_TOOL_RESULT_BYTES {
        return error_result(format!(
            "Result too large: {} bytes exceeds the {MAX_TOOL_RESULT_BYTES}-byte limit. Retry \
             with a narrower request (smaller `size` or `limit`, a shorter time range, fewer \
             fields).",
            content_text.len()
        ));
    }

    ToolsCallResult {
        structured_content: structured_content(&content_text),
        content: vec![ToolContent::Text { text: content_text }],
        is_error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools;

    #[test]
    fn structured_content_is_only_ever_an_object() {
        assert_eq!(
            structured_content(r#"{"total":1}"#),
            Some(json!({"total": 1}))
        );
        for text in ["[]", r#"[{"id":"a"}]"#, "42", r#""ok""#, "null", "not json"] {
            assert_eq!(structured_content(text), None, "{text}");
        }
    }

    /// Schema shaped like AddPanel: top-level params + a nested request_body
    /// whose properties include `tabId`.
    fn add_panel_schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "org_id": {"type": "string"},
                "dashboard_id": {"type": "string"},
                "hash": {"type": "string"},
                "request_body": {
                    "type": "object",
                    "properties": {
                        "panel": {"type": "object"},
                        "tabId": {"type": "string"}
                    }
                }
            }
        })
    }

    #[test]
    fn hoisted_body_field_is_moved_into_request_body() {
        let schema = add_panel_schema();
        let mut args = json!({
            "org_id": "default",
            "dashboard_id": "d1",
            "hash": "h0",
            "tabId": "tab-1",
            "request_body": { "panel": {"id": "p1"} }
        });
        normalize_request_body_fields(&schema, &mut args);

        assert!(
            args.get("tabId").is_none(),
            "top-level tabId should be removed"
        );
        assert_eq!(args["request_body"]["tabId"], json!("tab-1"));
        assert_eq!(args["request_body"]["panel"]["id"], json!("p1"));
    }

    #[test]
    fn creates_request_body_when_absent() {
        let schema = add_panel_schema();
        let mut args = json!({"org_id": "default", "tabId": "tab-2"});
        normalize_request_body_fields(&schema, &mut args);
        assert_eq!(args["request_body"]["tabId"], json!("tab-2"));
    }

    #[test]
    fn existing_body_value_takes_precedence() {
        let schema = add_panel_schema();
        let mut args = json!({
            "tabId": "top",
            "request_body": {"tabId": "body"}
        });
        normalize_request_body_fields(&schema, &mut args);
        assert_eq!(args["request_body"]["tabId"], json!("body"));
        assert!(args.get("tabId").is_none());
    }

    #[test]
    fn declared_top_level_param_is_left_in_place() {
        // DeletePanel-style: tabId is a real top-level param, no request_body.
        let schema = json!({
            "type": "object",
            "properties": {
                "org_id": {"type": "string"},
                "tabId": {"type": "string"}
            }
        });
        let mut args = json!({"org_id": "default", "tabId": "tab-1"});
        normalize_request_body_fields(&schema, &mut args);
        assert_eq!(args["tabId"], json!("tab-1"));
        assert!(args.get("request_body").is_none());
    }

    #[test]
    fn unknown_key_is_left_untouched() {
        let schema = add_panel_schema();
        let mut args = json!({"org_id": "default", "bogus": 1});
        normalize_request_body_fields(&schema, &mut args);
        assert_eq!(args["bogus"], json!(1));
        assert!(args.get("request_body").is_none());
    }

    #[test]
    fn organization_path_argument_is_injected_and_overwritten() {
        for (arguments, expected) in [
            (json!({}), json!({"org_id": "acme"})),
            (json!({"org_id": "acme"}), json!({"org_id": "acme"})),
            (json!({"org_id": "other"}), json!({"org_id": "acme"})),
        ] {
            let mut arguments = arguments;
            bind_organization("/api/{org_id}/streams", &mut arguments, "acme");
            assert_eq!(arguments, expected);
        }
    }

    #[test]
    fn organization_is_not_injected_without_path_parameter() {
        let mut arguments = json!({"request_body": {"org_id": "body-org"}});
        bind_organization("/api/organizations", &mut arguments, "acme");
        assert_eq!(arguments, json!({"request_body": {"org_id": "body-org"}}));
    }

    fn dashboard_tool() -> rmcp_openapi::ToolMetadata {
        let mapping = |name: &str| {
            (
                name.to_string(),
                rmcp_openapi::tool::ParameterMapping {
                    sanitized_name: name.to_string(),
                    original_name: name.to_string(),
                    location: "path".to_string(),
                    explode: false,
                },
            )
        };
        rmcp_openapi::ToolMetadata {
            name: "GetDashboard".to_string(),
            title: None,
            description: None,
            parameters: json!({
                "type": "object",
                "properties": {
                    "org_id": {"type": "string"},
                    "dashboard_id": {"type": "string"}
                }
            }),
            output_schema: None,
            method: "GET".to_string(),
            path: "/api/{org_id}/dashboards/{dashboard_id}".to_string(),
            security: None,
            parameter_mappings: [mapping("org_id"), mapping("dashboard_id")].into(),
        }
    }

    async fn loopback_request_line(dashboard_id: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = url::Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 1024];
            while !buf.windows(2).any(|w| w == b"\r\n") {
                let n = socket.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}")
                .await
                .unwrap();
            String::from_utf8_lossy(&buf)
                .lines()
                .next()
                .unwrap()
                .to_string()
        });

        let metadata = dashboard_tool();
        let mut arguments = json!({"org_id": "acme", "dashboard_id": dashboard_id});
        encode_path_parameters(&metadata, &mut arguments).unwrap();
        rmcp_openapi::HttpClient::new()
            .with_base_url(base)
            .unwrap()
            .execute_tool_call(&metadata, &arguments)
            .await
            .unwrap();
        server.await.unwrap()
    }

    #[test]
    fn path_parameter_encodes_only_route_changing_characters() {
        for (raw, expected) in [
            ("job:http_requests:rate5m", "job:http_requests:rate5m"),
            ("user@example.com", "user@example.com"),
            ("../../other/x?y#z%2e", "..%2F..%2Fother%2Fx%3Fy%23z%252e"),
            (".\t.", ".%09."),
            ("\\..\\x", "%5C..%5Cx"),
            (".. ", "..%20"),
            ("{org_id}", "%7Borg_id%7D"),
        ] {
            let mut arguments = json!({"org_id": "acme", "dashboard_id": raw});
            encode_path_parameters(&dashboard_tool(), &mut arguments).unwrap();
            assert_eq!(
                arguments,
                json!({"org_id": "acme", "dashboard_id": expected}),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn empty_dot_segment_and_non_scalar_path_parameters_are_rejected() {
        for dashboard_id in [
            json!(""),
            json!("."),
            json!(".."),
            json!(["../x"]),
            json!({"a": "../x"}),
        ] {
            let mut arguments = json!({"org_id": "acme", "dashboard_id": dashboard_id});
            assert!(
                encode_path_parameters(&dashboard_tool(), &mut arguments).is_err(),
                "{dashboard_id}"
            );
        }
    }

    #[tokio::test]
    async fn traversal_argument_stays_on_its_route() {
        for (raw, expected) in [
            (
                "../../other/secret",
                "/api/acme/dashboards/..%2F..%2Fother%2Fsecret",
            ),
            (".\t.", "/api/acme/dashboards/.%09."),
            ("\\..\\..\\other", "/api/acme/dashboards/%5C..%5C..%5Cother"),
            (".. ", "/api/acme/dashboards/..%20"),
            (
                "job:http_requests:rate5m",
                "/api/acme/dashboards/job:http_requests:rate5m",
            ),
            ("user@example.com", "/api/acme/dashboards/user@example.com"),
            ("%2e%2e", "/api/acme/dashboards/%252e%252e"),
            (".%2E", "/api/acme/dashboards/.%252E"),
            ("x?y#z", "/api/acme/dashboards/x%3Fy%23z"),
        ] {
            assert_eq!(
                loopback_request_line(raw).await,
                format!("GET {expected} HTTP/1.1"),
                "{raw:?}"
            );
        }
    }

    #[tokio::test]
    async fn placeholder_argument_is_not_substituted_twice() {
        assert_eq!(
            loopback_request_line("{org_id}").await,
            "GET /api/acme/dashboards/%7Borg_id%7D HTTP/1.1"
        );
    }

    #[tokio::test]
    async fn test_handle_initialize() {
        let result = handle_initialize(Value::Null);
        assert!(result.is_ok());

        let value = result.unwrap();
        assert!(value.is_object());

        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("protocolVersion"));
        assert!(obj.contains_key("capabilities"));
        assert!(obj.contains_key("serverInfo"));
    }

    #[tokio::test]
    async fn test_handle_ping() {
        let result = handle_ping();
        assert!(result.is_ok());

        let value = result.unwrap();
        assert!(value.is_object());
        assert_eq!(value.as_object().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_route_request_invalid_jsonrpc_version() {
        let request = MCPRequest {
            jsonrpc: "1.0".to_string(),
            id: Some(Value::from(1)),
            method: "ping".to_string(),
            params: Value::Null,
        };

        let response = route_request("default", request, None).await.unwrap();
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32600);
    }

    #[tokio::test]
    async fn test_route_request_method_not_found() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "invalid_method".to_string(),
            params: Value::Null,
        };

        let response = route_request("default", request, None).await.unwrap();
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32601);
    }

    #[tokio::test]
    async fn test_route_request_initialize_success() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "initialize".to_string(),
            params: Value::Null,
        };

        let response = route_request("default", request, None).await.unwrap();
        assert!(response.result.is_some());
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_server_discover() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "server/discover".to_string(),
            params: json!({
                "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
            }),
        };

        let response = route_request("default", request, None).await.unwrap();
        assert!(response.error.is_none());
        let result = response.result.unwrap();
        assert_eq!(result["resultType"], json!("complete"));
        let versions = result["supportedVersions"].as_array().unwrap();
        assert!(versions.contains(&json!("2026-07-28")));
        assert!(versions.contains(&json!("2025-11-25")));
        assert!(result["capabilities"]["tools"].is_object());
        assert!(result["ttlMs"].is_u64());
        assert_eq!(result["cacheScope"], json!("public"));
        assert_eq!(
            result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
            json!(MCP_SERVER_NAME)
        );
    }

    #[test]
    fn initialize_advertises_only_implemented_capabilities() {
        let result = handle_initialize(Value::Null).unwrap();
        assert_eq!(result["capabilities"], json!({ "tools": {} }));
    }

    #[test]
    fn server_discover_advertises_only_implemented_capabilities() {
        let result = handle_server_discover().unwrap();
        assert_eq!(result["capabilities"], json!({ "tools": {} }));
    }

    #[tokio::test]
    async fn test_unsupported_meta_protocol_version() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/list".to_string(),
            params: json!({
                "_meta": { "io.modelcontextprotocol/protocolVersion": "1900-01-01" }
            }),
        };

        let response = route_request("default", request, None).await.unwrap();
        let error = response.error.unwrap();
        assert_eq!(error.code, -32022);
        let data = error.data.unwrap();
        assert_eq!(data["requested"], json!("1900-01-01"));
        assert!(
            data["supported"]
                .as_array()
                .unwrap()
                .contains(&json!("2026-07-28"))
        );
    }

    #[tokio::test]
    async fn test_modern_tools_list_is_decorated() {
        tools::init_test_tools().await;

        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/list".to_string(),
            params: json!({
                "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
            }),
        };

        let response = route_request("default", request, None).await.unwrap();
        let result = response.result.unwrap();
        assert_eq!(result["resultType"], json!("complete"));
        assert!(result["ttlMs"].is_u64());
        assert_eq!(result["cacheScope"], json!("public"));
        assert!(result["_meta"]["io.modelcontextprotocol/serverInfo"].is_object());
        assert!(result["tools"].is_array());
    }

    #[tokio::test]
    async fn test_legacy_tools_list_is_not_decorated() {
        tools::init_test_tools().await;

        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/list".to_string(),
            params: Value::Null,
        };

        let response = route_request("default", request, None).await.unwrap();
        let result = response.result.unwrap();
        let obj = result.as_object().unwrap();
        assert!(!obj.contains_key("resultType"));
        assert!(!obj.contains_key("ttlMs"));
        assert!(!obj.contains_key("cacheScope"));
        assert!(!obj.contains_key("_meta"));
    }

    #[tokio::test]
    async fn test_route_request_ping_success() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(2)),
            method: "ping".to_string(),
            params: Value::Null,
        };

        let response = route_request("default", request, None).await.unwrap();
        assert!(response.result.is_some());
        assert!(response.error.is_none());
        assert_eq!(response.id, Some(Value::from(2)));
    }

    #[tokio::test]
    async fn test_handle_tools_list() {
        // Initialize MCP tools before testing
        tools::init_test_tools().await;

        let result = handle_tools_list();
        assert!(result.is_ok());

        let value = result.unwrap();
        assert!(value.is_object());

        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("tools"));

        // Should return exactly tool_search + tools_call
        let tools = obj.get("tools").unwrap().as_array().unwrap();
        assert_eq!(tools.len(), 2);

        let tool_names: Vec<&str> = tools
            .iter()
            .map(|t| t.get("name").unwrap().as_str().unwrap())
            .collect();
        assert!(tool_names.contains(&"tool_search"));
        assert!(tool_names.contains(&"tools_call"));
    }

    #[tokio::test]
    async fn test_tool_search_flow() {
        // Initialize MCP tools before testing
        tools::init_test_tools().await;

        // Step 1: Call tools/list - should return tool_search + tools_call
        let list_request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/list".to_string(),
            params: Value::Null,
        };

        let list_response = route_request("default", list_request, None).await.unwrap();
        assert!(list_response.result.is_some());

        let tools_list = list_response.result.unwrap();
        let tools = tools_list.get("tools").unwrap().as_array().unwrap();
        assert_eq!(
            tools.len(),
            2,
            "Should return exactly tool_search + tools_call"
        );

        let tool_names: Vec<&str> = tools
            .iter()
            .map(|t| t.get("name").unwrap().as_str().unwrap())
            .collect();
        assert!(tool_names.contains(&"tool_search"));
        assert!(tool_names.contains(&"tools_call"));

        // Step 2: Call tool_search - should return results (empty for test data)
        let search_request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(2)),
            method: "tools/call".to_string(),
            params: json!({
                "name": "tool_search",
                "arguments": {
                    "query": "create alert"
                }
            }),
        };

        let search_response = route_request("default", search_request, None)
            .await
            .unwrap();
        assert!(search_response.result.is_some());
        assert!(search_response.error.is_none());
    }

    #[tokio::test]
    async fn test_handle_tool_search() {
        // Initialize MCP tools before testing
        tools::init_test_tools().await;

        let result = handle_tool_search("some query", None);
        assert!(result.is_ok());

        let value = result.unwrap();
        assert!(value.is_object());
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("tools"));
    }

    #[tokio::test]
    async fn test_unknown_tool_call() {
        // Initialize MCP tools before testing
        tools::init_test_tools().await;

        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/call".to_string(),
            params: json!({
                "name": "unknown_tool",
                "arguments": {}
            }),
        };

        let response = route_request("default", request, None).await.unwrap();
        let error = response.error.unwrap();
        assert_eq!(error.code, -32602);
        assert_eq!(error.message, "Unknown tool: unknown_tool");
    }

    #[tokio::test]
    async fn malformed_tools_call_requests_are_invalid_params() {
        tools::init_test_tools().await;

        for params in [
            json!({}),
            json!({ "name": "tool_search", "arguments": {} }),
            json!({ "name": "tools_call", "arguments": { "tool": "x" } }),
            json!({ "name": "tools_call", "arguments": { "tool": "x", "args": {}, "detail": "everything" } }),
        ] {
            let request = MCPRequest {
                jsonrpc: JSONRPC_VERSION.to_string(),
                id: Some(Value::from(1)),
                method: "tools/call".to_string(),
                params: params.clone(),
            };
            let response = route_request("default", request, None).await.unwrap();
            assert_eq!(response.error.unwrap().code, -32602, "{params}");
        }
    }

    #[test]
    fn unexpected_failures_stay_internal_errors() {
        let error = RpcError::from(anyhow!("boom"));
        assert_eq!(error.code, MCPErrorCode::InternalError);
        assert_eq!(error.message, "boom");
    }

    /// Schema like a real tool's: required path parameters plus `timeout_seconds`.
    fn lookup_tool() -> rmcp_openapi::ToolMetadata {
        let mut tool = dashboard_tool();
        tool.parameters = json!({
            "type": "object",
            "properties": {
                "org_id": {"type": "string"},
                "dashboard_id": {"type": "string"},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300}
            },
            "required": ["org_id", "dashboard_id"]
        });
        tool
    }

    async fn loopback_listener() -> (tokio::net::TcpListener, url::Url) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = url::Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        (listener, base)
    }

    async fn client_answering(status: &'static str, body: Vec<u8>) -> rmcp_openapi::HttpClient {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (listener, base) = loopback_listener().await;
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let (mut request, mut chunk) = (Vec::new(), [0u8; 1024]);
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = socket.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..n]);
            }
            let head = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(&body).await;
        });
        rmcp_openapi::HttpClient::new().with_base_url(base).unwrap()
    }

    async fn client_never_answered() -> rmcp_openapi::HttpClient {
        let (listener, base) = loopback_listener().await;
        tokio::spawn(async move {
            let _held = listener.accept().await;
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        });
        rmcp_openapi::HttpClient::new().with_base_url(base).unwrap()
    }

    async fn client_refused() -> rmcp_openapi::HttpClient {
        let (listener, base) = loopback_listener().await;
        drop(listener);
        rmcp_openapi::HttpClient::new().with_base_url(base).unwrap()
    }

    async fn run(client: &rmcp_openapi::HttpClient, arguments: Value) -> ToolsCallResult {
        execute_tool(
            client,
            "acme",
            &lookup_tool(),
            arguments,
            &DetailLevel::Summary,
        )
        .await
    }

    fn text_of(result: &ToolsCallResult) -> &str {
        match &result.content[..] {
            [ToolContent::Text { text }] => text,
            other => panic!("expected one text block, got {other:?}"),
        }
    }

    fn json_body_of(len: usize) -> Vec<u8> {
        let pad = "x".repeat(len - r#"{"pad":""}"#.len());
        format!(r#"{{"pad":"{pad}"}}"#).into_bytes()
    }

    #[tokio::test]
    async fn invalid_arguments_are_a_tool_error_with_the_validation_message() {
        // Validation fails before any request is sent, so the server is never reached.
        let client = client_refused().await;
        for (arguments, expected) in [
            (json!({ "dashboard_id": "d1", "bogus": 1 }), "bogus"),
            (json!({}), "dashboard_id"),
            (json!({ "dashboard_id": 5 }), "not of type"),
            (json!({ "dashboard_id": ".." }), "dashboard_id"),
        ] {
            let result = run(&client, arguments.clone()).await;
            assert_eq!(result.is_error, Some(true), "{arguments}");
            let text = text_of(&result);
            assert!(text.contains(expected), "{arguments}: {text}");
        }
    }

    #[tokio::test]
    async fn an_unreachable_api_is_a_tool_error_that_hides_the_address() {
        let result = run(&client_refused().await, json!({ "dashboard_id": "d1" })).await;

        assert_eq!(result.is_error, Some(true));
        let text = text_of(&result);
        assert!(text.contains("could not be completed"), "{text}");
        assert!(
            !text.contains("127.0.0.1") && !text.contains("localhost"),
            "{text}"
        );
    }

    #[tokio::test]
    async fn a_timeout_is_a_tool_error_that_says_how_to_retry() {
        let client = client_never_answered().await;
        let arguments = json!({ "dashboard_id": "d1", "timeout_seconds": 1 });
        let result = run(&client, arguments).await;

        assert_eq!(result.is_error, Some(true));
        let text = text_of(&result);
        assert!(
            text.contains("timed out") && text.contains("`timeout_seconds`"),
            "{text}"
        );
        assert!(!text.contains("127.0.0.1"), "{text}");
    }

    #[tokio::test]
    async fn an_upstream_error_status_stays_a_tool_error() {
        let client = client_answering("404 Not Found", br#"{"message":"nope"}"#.to_vec()).await;
        let result = run(&client, json!({ "dashboard_id": "d1" })).await;

        assert_eq!(result.is_error, Some(true));
        assert_eq!(text_of(&result), r#"Error 404: {"message":"nope"}"#);
    }

    #[tokio::test]
    async fn a_successful_object_result_carries_structured_content() {
        let client = client_answering("200 OK", br#"{"id":"d1"}"#.to_vec()).await;
        let result = run(&client, json!({ "dashboard_id": "d1" })).await;

        assert_eq!(result.is_error, None);
        assert_eq!(result.structured_content, Some(json!({ "id": "d1" })));
    }

    #[tokio::test]
    async fn a_result_over_the_limit_is_refused_with_guidance() {
        let body = json_body_of(MAX_TOOL_RESULT_BYTES + 1);
        let result = run(
            &client_answering("200 OK", body).await,
            json!({ "dashboard_id": "d1" }),
        )
        .await;

        assert_eq!(result.is_error, Some(true));
        assert_eq!(result.structured_content, None);
        let text = text_of(&result);
        assert!(text.starts_with("Result too large"), "{text}");
        assert!(
            text.contains(&(MAX_TOOL_RESULT_BYTES + 1).to_string()),
            "{text}"
        );
        assert!(
            text.contains(&format!("{MAX_TOOL_RESULT_BYTES}-byte limit")),
            "{text}"
        );
        assert!(text.contains("narrower request"), "{text}");
        assert!(text.len() < 512, "{}", text.len());
    }

    #[tokio::test]
    async fn an_oversized_error_body_keeps_its_status_and_is_clipped() {
        let body = json_body_of(2 * MAX_TOOL_RESULT_BYTES);
        let client = client_answering("500 Internal Server Error", body).await;
        let result = run(&client, json!({ "dashboard_id": "d1" })).await;

        assert_eq!(result.is_error, Some(true));
        let text = text_of(&result);
        assert!(
            text.starts_with(r#"Error 500: {"pad":"x"#),
            "{}",
            &text[..40]
        );
        assert!(text.ends_with("… [truncated]"));
        assert!(text.len() < MAX_TOOL_RESULT_BYTES + 64, "{}", text.len());
    }

    #[test]
    fn clipping_cuts_at_a_character_boundary() {
        assert_eq!(clipped("short".to_string()), "short");

        // 3-byte characters: the limit falls inside one, so the cut must move back.
        let clipped_text = clipped("€".repeat(MAX_TOOL_RESULT_BYTES));
        let kept = clipped_text.strip_suffix("… [truncated]").unwrap();
        assert!(kept.len() <= MAX_TOOL_RESULT_BYTES);
        assert!(kept.chars().all(|c| c == '€'));
    }

    #[test]
    fn the_timeout_hint_names_timeout_seconds_only_for_tools_that_accept_it() {
        let timeout = ToolCallExecutionError::NetworkError {
            message: String::new(),
            category: NetworkErrorCategory::Timeout,
        };
        let mut without = lookup_tool();
        without.parameters["properties"]
            .as_object_mut()
            .unwrap()
            .remove("timeout_seconds");

        assert!(execution_failure_text(&timeout, &lookup_tool()).contains("`timeout_seconds`"));
        let text = execution_failure_text(&timeout, &without);
        assert!(
            text.contains("timed out") && !text.contains("timeout_seconds"),
            "{text}"
        );
    }

    struct CapturedLogs;

    static LOGGED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

    impl log::Log for CapturedLogs {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }

        fn log(&self, record: &log::Record) {
            LOGGED.lock().unwrap().push(record.args().to_string());
        }

        fn flush(&self) {}
    }

    #[tokio::test]
    async fn the_cause_of_a_failed_call_is_logged_but_not_shown() {
        let _ = log::set_logger(&CapturedLogs);
        log::set_max_level(log::LevelFilter::Warn);

        let result = run(&client_refused().await, json!({ "dashboard_id": "d1" })).await;

        assert!(!text_of(&result).contains("127.0.0.1"));
        // Copied out so a failed assertion cannot poison the lock the logger takes.
        let logged = LOGGED.lock().unwrap().clone();
        assert!(
            logged
                .iter()
                .any(|line| line.contains("MCP tool GetDashboard failed")
                    && line.contains("127.0.0.1")),
            "{logged:?}"
        );
    }

    #[tokio::test]
    async fn a_result_at_the_limit_is_returned_unchanged() {
        let body = json_body_of(MAX_TOOL_RESULT_BYTES);
        let result = run(
            &client_answering("200 OK", body).await,
            json!({ "dashboard_id": "d1" }),
        )
        .await;

        assert_eq!(result.is_error, None);
        assert_eq!(text_of(&result).len(), MAX_TOOL_RESULT_BYTES);
    }
}
