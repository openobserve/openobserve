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
use serde_json::{Value, json};

use super::{
    response_filter::filter_response,
    tools::{get_pinned_tools, get_shared_http_client, get_tool_metadata, tool_search},
    types::*,
};

/// Route an MCP request to the appropriate handler
pub async fn route_request(request: MCPRequest, auth_token: Option<String>) -> Result<MCPResponse> {
    // Validate JSON-RPC version
    if request.jsonrpc != JSONRPC_VERSION {
        return Ok(MCPResponse::error(
            request.id,
            MCPErrorCode::InvalidRequest,
            format!("Invalid JSON-RPC version. Expected {JSONRPC_VERSION}"),
            None,
        ));
    }

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

    // Route to handler
    let result = match method {
        MCPMethod::Initialize => handle_initialize(request.params),
        MCPMethod::Ping => handle_ping(),
        MCPMethod::ToolsList => handle_tools_list(),
        MCPMethod::ToolsCall => handle_tools_call(request.params, auth_token).await,
        // Notifications are one-way; no response body required (HTTP layer returns 202)
        MCPMethod::NotificationsInitialized => Ok(Value::Null),
    };

    match result {
        Ok(value) => Ok(MCPResponse::success(request.id, value)),
        Err(e) => Ok(MCPResponse::error(
            request.id,
            MCPErrorCode::InternalError,
            e.to_string(),
            None,
        )),
    }
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
            completions: Some(serde_json::Map::new()),
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
    tool_name: &str,
    args: Value,
    detail: &DetailLevel,
    auth_token: Option<String>,
) -> Result<Value> {
    // Find the tool metadata for execution
    let tool_metadata =
        get_tool_metadata(tool_name).ok_or_else(|| anyhow!("Tool '{}' not found", tool_name))?;

    // Execute the tool using shared HTTP client
    let result = execute_tool(&tool_metadata, args, detail, auth_token).await?;

    Ok(serde_json::to_value(result)?)
}

/// Handle tools/call request
/// Routes to tool_search or tools_call
async fn handle_tools_call(params: Value, auth_token: Option<String>) -> Result<Value> {
    // Parse parameters
    let call_params: ToolsCallParams = serde_json::from_value(params)
        .map_err(|e| anyhow!("Invalid tools/call parameters: {e}"))?;

    match call_params.name.as_str() {
        "tool_search" => {
            let args: ToolSearchArgs = serde_json::from_value(call_params.arguments)
                .map_err(|e| anyhow!("Invalid arguments for tool_search: {}", e))?;
            let result = handle_tool_search(&args.query, args.limit)?;
            Ok(json!({
                "content": [{"type": "text", "text": serde_json::to_string(&result)?}]
            }))
        }
        "tools_call" => {
            let args: ToolsCallSimpleArgs = serde_json::from_value(call_params.arguments)
                .map_err(|e| anyhow!("Invalid arguments for tools_call: {}", e))?;
            handle_direct_call(&args.tool, args.args, &args.detail, auth_token).await
        }
        // Pinned tools are exposed directly in tools/list and called by name.
        // Route them straight to execution with their arguments.
        name => {
            handle_direct_call(
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

/// Execute a tool using the shared HTTP client
async fn execute_tool(
    metadata: &rmcp_openapi::ToolMetadata,
    mut arguments: Value,
    detail: &DetailLevel,
    auth_token: Option<String>,
) -> Result<ToolsCallResult> {
    // LLMs frequently hoist request-body fields to the top level of the tool
    // arguments (e.g. `tabId` on AddPanel/UpdatePanel, which the schema nests
    // under `request_body`). That fails rmcp-openapi validation with
    // "invalid parameter '<field>'". Be liberal in what we accept at the MCP
    // adapter — relocate such fields into `request_body` before validation —
    // so the underlying HTTP API contract stays untouched.
    normalize_request_body_fields(&metadata.parameters, &mut arguments);

    // Get the shared HTTP client
    let shared_client = get_shared_http_client();

    // If we have an auth token, create a client with authorization header
    // Otherwise use the shared client directly
    let http_client = if let Some(token) = auth_token {
        shared_client.with_authorization(&token)
    } else {
        shared_client.clone()
    };

    // Execute the HTTP request using the shared client
    let http_response = http_client
        .execute_tool_call(metadata, &arguments)
        .await
        .map_err(|e| anyhow!("Tool execution failed: {}", e))?;

    // Convert HTTP response to our format
    let is_error = !http_response.is_success;
    let content_text = if is_error {
        format!(
            "Error {}: {}",
            http_response.status_code, http_response.body
        )
    } else {
        // Apply response filtering based on detail level
        filter_response(&metadata.name, &http_response.body, detail)
    };

    // Parse content as structured JSON for structuredContent field (2025-11-25)
    let structured_content = if !is_error {
        serde_json::from_str::<Value>(&content_text).ok()
    } else {
        None
    };

    Ok(ToolsCallResult {
        content: vec![ToolContent::Text { text: content_text }],
        is_error: if is_error { Some(true) } else { None },
        structured_content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools;

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

        let response = route_request(request, None).await.unwrap();
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

        let response = route_request(request, None).await.unwrap();
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

        let response = route_request(request, None).await.unwrap();
        assert!(response.result.is_some());
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_route_request_ping_success() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(2)),
            method: "ping".to_string(),
            params: Value::Null,
        };

        let response = route_request(request, None).await.unwrap();
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

        let list_response = route_request(list_request, None).await.unwrap();
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

        let search_response = route_request(search_request, None).await.unwrap();
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

        let response = route_request(request, None).await.unwrap();
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32603); // InternalError
    }
}
