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

use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

// MCP Protocol Constants
/// Legacy protocol revision, negotiated through the `initialize` handshake.
pub const MCP_PROTOCOL_VERSION: &str = "2025-11-25";
/// Modern stateless protocol revision, declared per-request via `_meta`.
pub const MCP_PROTOCOL_VERSION_MODERN: &str = "2026-07-28";
/// Protocol revisions this server accepts, newest first.
pub const MCP_SUPPORTED_PROTOCOL_VERSIONS: [&str; 2] =
    [MCP_PROTOCOL_VERSION_MODERN, MCP_PROTOCOL_VERSION];
/// `_meta` key carrying the protocol version on modern requests.
pub const META_KEY_PROTOCOL_VERSION: &str = "io.modelcontextprotocol/protocolVersion";
/// `_meta` key carrying the server identity on modern results.
pub const META_KEY_SERVER_INFO: &str = "io.modelcontextprotocol/serverInfo";
pub const MCP_SERVER_NAME: &str = "openobserve-mcp";
pub const MCP_SERVER_VERSION: &str = "1.0.0";
pub const JSONRPC_VERSION: &str = "2.0";

pub fn is_supported_protocol_version(version: &str) -> bool {
    MCP_SUPPORTED_PROTOCOL_VERSIONS.contains(&version)
}

/// Decode a header value that may use the Base64 sentinel format
/// (`=?base64?{value}?=`) defined by the 2026-07-28 Streamable HTTP
/// transport for `Mcp-Name` / `Mcp-Param-*`. Plain values pass through
/// unchanged; a malformed sentinel yields `None`.
pub fn decode_mcp_header_value(value: &str) -> Option<String> {
    let Some(inner) = value
        .strip_prefix("=?base64?")
        .and_then(|v| v.strip_suffix("?="))
    else {
        return Some(value.to_string());
    };
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(inner)
        .ok()?;
    String::from_utf8(bytes).ok()
}

// MCP Methods
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum MCPMethod {
    Initialize,
    Ping,
    ToolsList,
    ToolsCall,
    /// server/discover — modern (2026-07-28) capability/version discovery
    ServerDiscover,
    /// notifications/initialized — sent by client after initialize, no response expected
    NotificationsInitialized,
}

impl MCPMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Initialize => "initialize",
            Self::Ping => "ping",
            Self::ToolsList => "tools/list",
            Self::ToolsCall => "tools/call",
            Self::ServerDiscover => "server/discover",
            Self::NotificationsInitialized => "notifications/initialized",
        }
    }

    /// Returns true if this method is a JSON-RPC notification (no response expected)
    pub fn is_notification(&self) -> bool {
        matches!(self, Self::NotificationsInitialized)
    }
}

impl FromStr for MCPMethod {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "initialize" => Ok(Self::Initialize),
            "ping" => Ok(Self::Ping),
            "tools/list" => Ok(Self::ToolsList),
            "tools/call" => Ok(Self::ToolsCall),
            "server/discover" => Ok(Self::ServerDiscover),
            "notifications/initialized" => Ok(Self::NotificationsInitialized),
            _ => Err(format!("'{s}' is not a valid MCP method")),
        }
    }
}

// MCP Error Codes with discriminant values
#[derive(Debug, Clone, PartialEq, Eq)]
#[repr(i32)]
pub enum MCPErrorCode {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
    ToolExecutionFailed = -32000,
    /// 2026-07-28: HTTP headers do not match the request body (-32020)
    HeaderMismatch = -32020,
    /// 2026-07-28: requested protocol version is not supported (-32022)
    UnsupportedProtocolVersion = -32022,
    Custom(i32),
}

impl MCPErrorCode {
    pub fn code(&self) -> i32 {
        match self {
            Self::ParseError => -32700,
            Self::InvalidRequest => -32600,
            Self::MethodNotFound => -32601,
            Self::InvalidParams => -32602,
            Self::InternalError => -32603,
            Self::ToolExecutionFailed => -32000,
            Self::HeaderMismatch => -32020,
            Self::UnsupportedProtocolVersion => -32022,
            Self::Custom(code) => *code,
        }
    }
}

impl From<i32> for MCPErrorCode {
    fn from(code: i32) -> Self {
        match code {
            -32700 => Self::ParseError,
            -32600 => Self::InvalidRequest,
            -32601 => Self::MethodNotFound,
            -32602 => Self::InvalidParams,
            -32603 => Self::InternalError,
            -32000 => Self::ToolExecutionFailed,
            -32020 => Self::HeaderMismatch,
            -32022 => Self::UnsupportedProtocolVersion,
            _ => Self::Custom(code),
        }
    }
}

// JSON-RPC Request
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct MCPRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl MCPRequest {
    /// Protocol version declared in the request's `_meta`, present on
    /// modern (2026-07-28) requests and absent on legacy ones.
    pub fn meta_protocol_version(&self) -> Option<&str> {
        self.params
            .get("_meta")?
            .get(META_KEY_PROTOCOL_VERSION)?
            .as_str()
    }

    /// True when the request uses modern per-request-metadata semantics.
    pub fn is_modern(&self) -> bool {
        self.meta_protocol_version() == Some(MCP_PROTOCOL_VERSION_MODERN)
    }
}

// JSON-RPC Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<MCPError>,
}

impl MCPResponse {
    pub fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(
        id: Option<Value>,
        code: MCPErrorCode,
        message: String,
        data: Option<Value>,
    ) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: Some(MCPError {
                code: code.code(),
                message,
                data,
            }),
        }
    }
}

// JSON-RPC Error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

// Initialize Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeResult {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
    pub capabilities: ServerCapabilities,
    #[serde(rename = "serverInfo")]
    pub server_info: ServerInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub tools: ToolsCapability,
    /// Advertise completions capability (argument autocompletion) per 2025-11-25
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completions: Option<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsCapability {
    // Empty object for now, can add listChanged: true later
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    /// Human-readable display title (new in 2025-11-25)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

// Ping Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingResult {
    // Empty object per spec
}

// Tools List Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsListResult {
    pub tools: Vec<MCPTool>,
}

// MCP Tool Definition (Full)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    pub name: String,
    /// Human-readable display title (new in 2025-11-25)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value, // JSON Schema
    /// Optional JSON Schema for the tool's output (new in 2025-11-25)
    #[serde(rename = "outputSchema", skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    /// Optional annotations describing tool behavior (new in 2025-11-25)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    // Internal fields for HTTP execution (not serialized to clients)
    #[serde(skip)]
    pub http_method: String,
    #[serde(skip)]
    pub http_path: String,
    #[serde(skip)]
    pub category: Option<String>,
    /// Whether this tool requires user confirmation before execution
    #[serde(skip)]
    pub requires_confirmation: bool,
    /// Whether this tool is always included in tools/list (no discovery needed)
    #[serde(skip)]
    pub pinned: bool,
}

// Tool search arguments
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSearchArgs {
    pub query: String,
    /// Max number of results to return (default: 3, max: 20)
    pub limit: Option<usize>,
}

/// Detail level for MCP tool responses.
///
/// Controls how much data is returned from tool calls:
/// - `Summary` (default): Returns key fields only (names, IDs, counts, essential metadata)
/// - `Full`: Returns complete API response (current behavior)
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetailLevel {
    #[default]
    Summary,
    Full,
}

impl fmt::Display for DetailLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DetailLevel::Summary => write!(f, "summary"),
            DetailLevel::Full => write!(f, "full"),
        }
    }
}

// Simplified tools_call arguments (no category needed)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsCallSimpleArgs {
    pub tool: String,
    pub args: Value,
    /// Detail level for the response (default: "summary")
    #[serde(default)]
    pub detail: DetailLevel,
}

// Tool Summary (name, description, schema)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSummary {
    pub name: String,
    /// Human-readable display title (new in 2025-11-25)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
    /// Whether this tool requires user confirmation before execution
    #[serde(
        rename = "requiresConfirmation",
        skip_serializing_if = "Option::is_none"
    )]
    pub requires_confirmation: Option<bool>,
}

// Tools Call Request Parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsCallParams {
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
}

// Tools Call Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsCallResult {
    pub content: Vec<ToolContent>,
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    /// Structured JSON output alongside text content (new in 2025-11-25)
    #[serde(rename = "structuredContent", skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "resource")]
    Resource { resource: ResourceContent },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceContent {
    pub uri: String,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>, // base64 encoded
}

/// Configuration for declarative summary field extraction from `x-o2-mcp` extensions.
///
/// A simple list of field names to extract from each item in a list response.
/// Supports dot notation for nested fields (e.g., "stats.storage_size").
///
/// The response is automatically normalized to `{ "total": N, "items": [...] }`
/// by detecting the array in the response (checking common keys like "list",
/// "data", "dashboards", or root arrays).
pub type SummaryFieldsConfig = Vec<String>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_method_as_str() {
        assert_eq!(MCPMethod::Initialize.as_str(), "initialize");
        assert_eq!(MCPMethod::Ping.as_str(), "ping");
        assert_eq!(MCPMethod::ToolsList.as_str(), "tools/list");
        assert_eq!(MCPMethod::ToolsCall.as_str(), "tools/call");
        assert_eq!(
            MCPMethod::NotificationsInitialized.as_str(),
            "notifications/initialized"
        );
    }

    #[test]
    fn test_mcp_method_from_str() {
        assert_eq!(
            MCPMethod::from_str("initialize").unwrap(),
            MCPMethod::Initialize
        );
        assert_eq!(MCPMethod::from_str("ping").unwrap(), MCPMethod::Ping);
        assert_eq!(
            MCPMethod::from_str("tools/list").unwrap(),
            MCPMethod::ToolsList
        );
        assert_eq!(
            MCPMethod::from_str("tools/call").unwrap(),
            MCPMethod::ToolsCall
        );
        assert_eq!(
            MCPMethod::from_str("notifications/initialized").unwrap(),
            MCPMethod::NotificationsInitialized
        );
        assert!(MCPMethod::from_str("invalid").is_err());
    }

    #[test]
    fn test_server_discover_method() {
        assert_eq!(MCPMethod::ServerDiscover.as_str(), "server/discover");
        assert_eq!(
            MCPMethod::from_str("server/discover").unwrap(),
            MCPMethod::ServerDiscover
        );
        assert!(!MCPMethod::ServerDiscover.is_notification());
    }

    #[test]
    fn test_is_supported_protocol_version() {
        assert!(is_supported_protocol_version("2026-07-28"));
        assert!(is_supported_protocol_version("2025-11-25"));
        assert!(!is_supported_protocol_version("2025-03-26"));
        assert!(!is_supported_protocol_version("unsupported"));
    }

    #[test]
    fn test_meta_protocol_version() {
        let request = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/list".to_string(),
            params: serde_json::json!({
                "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
            }),
        };
        assert_eq!(request.meta_protocol_version(), Some("2026-07-28"));
        assert!(request.is_modern());

        let legacy = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "tools/list".to_string(),
            params: Value::Null,
        };
        assert_eq!(legacy.meta_protocol_version(), None);
        assert!(!legacy.is_modern());
    }

    #[test]
    fn test_decode_mcp_header_value() {
        // Plain values pass through unchanged
        assert_eq!(
            decode_mcp_header_value("get_weather").as_deref(),
            Some("get_weather")
        );
        // Base64 sentinel is decoded ("Hello, 世界")
        assert_eq!(
            decode_mcp_header_value("=?base64?SGVsbG8sIOS4lueVjA==?=").as_deref(),
            Some("Hello, 世界")
        );
        // Malformed sentinel payload yields None
        assert_eq!(decode_mcp_header_value("=?base64?!!!?="), None);
    }

    #[test]
    fn test_mcp_method_is_notification() {
        assert!(MCPMethod::NotificationsInitialized.is_notification());
        assert!(!MCPMethod::Initialize.is_notification());
        assert!(!MCPMethod::Ping.is_notification());
        assert!(!MCPMethod::ToolsList.is_notification());
        assert!(!MCPMethod::ToolsCall.is_notification());
    }

    #[test]
    fn test_mcp_error_code() {
        assert_eq!(MCPErrorCode::ParseError.code(), -32700);
        assert_eq!(MCPErrorCode::InvalidRequest.code(), -32600);
        assert_eq!(MCPErrorCode::Custom(999).code(), 999);
    }

    #[test]
    fn test_mcp_error_code_from_i32() {
        assert_eq!(MCPErrorCode::from(-32700), MCPErrorCode::ParseError);
        assert_eq!(MCPErrorCode::from(-32600), MCPErrorCode::InvalidRequest);
        assert_eq!(MCPErrorCode::from(999), MCPErrorCode::Custom(999));
    }

    #[test]
    fn test_mcp_response_success() {
        let resp = MCPResponse::success(Some(Value::from(1)), Value::from("ok"));
        assert_eq!(resp.jsonrpc, JSONRPC_VERSION);
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_mcp_response_error() {
        let resp = MCPResponse::error(
            Some(Value::from(1)),
            MCPErrorCode::InvalidRequest,
            "bad".to_string(),
            None,
        );
        assert_eq!(resp.jsonrpc, JSONRPC_VERSION);
        assert!(resp.result.is_none());
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, -32600);
    }

    #[test]
    fn test_mcp_request_serde() {
        let req = MCPRequest {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id: Some(Value::from(1)),
            method: "ping".to_string(),
            params: Value::Null,
        };
        let json = serde_json::to_string(&req).unwrap();
        let parsed: MCPRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.method, "ping");
    }

    #[test]
    fn test_tool_content_text() {
        let content = ToolContent::Text {
            text: "hello".to_string(),
        };
        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("text"));
    }

    #[test]
    fn test_detail_level_default() {
        assert_eq!(DetailLevel::default(), DetailLevel::Summary);
    }

    #[test]
    fn test_detail_level_serde() {
        let summary: DetailLevel = serde_json::from_str("\"summary\"").unwrap();
        assert_eq!(summary, DetailLevel::Summary);
        let full: DetailLevel = serde_json::from_str("\"full\"").unwrap();
        assert_eq!(full, DetailLevel::Full);
    }

    #[test]
    fn test_detail_level_display() {
        assert_eq!(DetailLevel::Summary.to_string(), "summary");
        assert_eq!(DetailLevel::Full.to_string(), "full");
    }

    #[test]
    fn test_tools_call_simple_args_default_detail() {
        let args: ToolsCallSimpleArgs =
            serde_json::from_str(r#"{"tool":"ListStreams","args":{}}"#).unwrap();
        assert_eq!(args.detail, DetailLevel::Summary);
    }

    #[test]
    fn test_tools_call_simple_args_explicit_detail() {
        let args: ToolsCallSimpleArgs =
            serde_json::from_str(r#"{"tool":"ListStreams","args":{},"detail":"full"}"#).unwrap();
        assert_eq!(args.detail, DetailLevel::Full);
    }

    #[test]
    fn test_summary_fields_config_serde() {
        let config: SummaryFieldsConfig =
            serde_json::from_str(r#"["name","stream_type"]"#).unwrap();
        assert_eq!(config, vec!["name", "stream_type"]);
    }
}
