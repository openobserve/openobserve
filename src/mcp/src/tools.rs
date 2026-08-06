// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.

use std::collections::HashMap;

use anyhow::{Ok, Result};
use config::tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build};
use serde::Deserialize;
use tantivy::{
    Index, IndexWriter, TantivyDocument,
    collector::TopDocs,
    query::QueryParser,
    schema::{
        Field, IndexRecordOption, STORED, Schema, TEXT, TextFieldIndexing, TextOptions, Value as _,
    },
};
use tokio::sync::OnceCell;
use utoipa::openapi::OpenApi;

use super::{
    schema::simplify_schema,
    types::{MCPTool, SummaryFieldsConfig},
};

/// MCP extension configuration from x-o2-mcp OpenAPI extension
///
/// Example usage in utoipa::path:
/// ```ignore
/// extensions(
///     ("x-o2-mcp" = json!({"enabled": false}))  // Disable MCP tool
/// )
/// extensions(
///     ("x-o2-mcp" = json!({"description": "Short description"}))  // Custom description
/// )
/// extensions(
///     ("x-o2-mcp" = json!({"enabled": true, "description": "Short description", "category": "logs", "pinned": true}))
/// )
/// ```
#[derive(Debug, Clone, Deserialize, Default)]
pub struct McpExtension {
    /// Whether this tool should be exposed via MCP (default: true)
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Custom short description for MCP (overrides OpenAPI summary/description)
    pub description: Option<String>,
    /// Tool category for hierarchical organization (e.g., "logs", "metrics", "alerts")
    pub category: Option<String>,
    /// Whether this tool requires user confirmation before execution (destructive ops)
    pub requires_confirmation: Option<bool>,
    /// Declarative summary field configuration for response filtering
    pub summary_fields: Option<SummaryFieldsConfig>,
    /// Whether this tool is pinned — always included in tools/list without needing tool_search.
    /// Use for high-frequency tools (e.g., StreamList, SearchSQL) so LLMs can call them
    /// directly without a discovery round-trip.
    #[serde(default)]
    pub pinned: bool,
}

fn default_enabled() -> bool {
    true
}

/// Extension key for MCP configuration
const MCP_EXTENSION_KEY: &str = "x-o2-mcp";

/// Extract MCP extensions from OpenAPI spec
///
/// Returns a map of operation_id -> McpExtension
fn extract_mcp_extensions(api: &OpenApi) -> HashMap<String, McpExtension> {
    let mut extensions = HashMap::new();

    for path_item in api.paths.paths.values() {
        // Check all HTTP methods
        for operation in [
            path_item.get.as_ref(),
            path_item.post.as_ref(),
            path_item.put.as_ref(),
            path_item.delete.as_ref(),
            path_item.patch.as_ref(),
            path_item.head.as_ref(),
            path_item.options.as_ref(),
            path_item.trace.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            if let Some(operation_id) = &operation.operation_id {
                // Check if this operation has x-o2-mcp extension
                if let Some(ext_map) = &operation.extensions
                    && let Some(mcp_value) = ext_map.get(MCP_EXTENSION_KEY)
                {
                    // Parse the extension
                    match serde_json::from_value::<McpExtension>(mcp_value.clone()) {
                        std::result::Result::Ok(mcp_ext) => {
                            extensions.insert(operation_id.clone(), mcp_ext);
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to parse {MCP_EXTENSION_KEY} extension for {operation_id}: {e}"
                            );
                        }
                    }
                }
            }
        }
    }

    extensions
}

static TOOLS_CACHE: OnceCell<Vec<MCPTool>> = OnceCell::const_new();
static PINNED_TOOLS_CACHE: OnceCell<Vec<MCPTool>> = OnceCell::const_new();
/// Store only ToolMetadata instead of full Tool to avoid creating 200+ HTTP clients
static TOOL_METADATA_CACHE: OnceCell<HashMap<String, rmcp_openapi::ToolMetadata>> =
    OnceCell::const_new();
/// Single shared HTTP client for all tool executions
static SHARED_HTTP_CLIENT: OnceCell<rmcp_openapi::HttpClient> = OnceCell::const_new();
/// Full-text search index for tool discovery
static TOOL_SEARCH_INDEX: OnceCell<ToolSearchIndex> = OnceCell::const_new();
/// Summary field configurations extracted from x-o2-mcp extensions, keyed by tool name
static SUMMARY_CONFIG_CACHE: OnceCell<HashMap<String, SummaryFieldsConfig>> = OnceCell::const_new();

/// In-memory tantivy search index for tool discovery
struct ToolSearchIndex {
    index: Index,
    reader: tantivy::IndexReader,
    name_field: Field,
    description_field: Field,
    category_field: Field,
    tool_name_field: Field,
    /// Pre-built name→tool map to avoid rebuilding on every search
    tools_by_name: HashMap<String, MCPTool>,
}

/// Build the tantivy search index from the list of MCP tools.
fn build_search_index(tools: &[MCPTool]) -> Result<()> {
    // Idempotent: skip if already initialized (e.g., by test init)
    if TOOL_SEARCH_INDEX.get().is_some() {
        log::debug!("Tool search index already initialized; skipping rebuild");
        return Ok(());
    }

    let start = std::time::Instant::now();

    // Use the O2 tokenizer for the name field to handle CamelCase splitting
    // (e.g., "CreateDashboard" → "create", "dashboard"; "HTTPClient" → "http", "client")
    let o2_text_opts = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_index_option(IndexRecordOption::WithFreqsAndPositions)
            .set_tokenizer(O2_TOKENIZER),
    );

    let mut schema_builder = Schema::builder();
    let name_field = schema_builder.add_text_field("name", o2_text_opts);
    let description_field = schema_builder.add_text_field("description", TEXT);
    let category_field = schema_builder.add_text_field("category", TEXT);
    let tool_name_field = schema_builder.add_text_field("tool_name", STORED);
    let schema = schema_builder.build();

    let index = Index::create_in_ram(schema);

    // Register the O2 tokenizer for indexing (Ingest mode emits root + split tokens)
    index
        .tokenizers()
        .register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));

    let mut writer: IndexWriter = index.writer(15_000_000)?;

    for tool in tools {
        let mut doc = TantivyDocument::new();
        // The O2 tokenizer handles CamelCase splitting at index time
        doc.add_text(name_field, &tool.name);
        if let Some(ref desc) = tool.description {
            doc.add_text(description_field, desc);
        }
        if let Some(ref cat) = tool.category {
            doc.add_text(category_field, cat);
        }
        // Store the exact tool name for lookup
        doc.add_text(tool_name_field, &tool.name);
        writer.add_document(doc)?;
    }
    writer.commit()?;

    // Re-register with Search mode for query-time tokenization
    // (Search mode emits only split tokens, no root token)
    index
        .tokenizers()
        .register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Search));

    // Create a long-lived reader (avoids per-query reader creation)
    let reader = index
        .reader()
        .map_err(|e| anyhow::anyhow!("Failed to create index reader: {e}"))?;

    // Pre-build name→tool map (avoids per-query HashMap allocation)
    let tools_by_name: HashMap<String, MCPTool> =
        tools.iter().map(|t| (t.name.clone(), t.clone())).collect();

    TOOL_SEARCH_INDEX
        .set(ToolSearchIndex {
            index,
            reader,
            name_field,
            description_field,
            category_field,
            tool_name_field,
            tools_by_name,
        })
        .map_err(|_| anyhow::anyhow!("Tool search index should've been empty at this point"))?;

    log::info!(
        "Built tool search index for {} tools in {:?}",
        tools.len(),
        start.elapsed()
    );

    Ok(())
}

/// Maximum allowed query length to prevent DoS via pathological inputs
const MAX_SEARCH_QUERY_LEN: usize = 500;

/// Search for tools matching a query string using BM25 scoring.
/// Returns the top `limit` matching MCPTool objects with full schemas.
pub fn tool_search(query: &str, limit: usize) -> Vec<MCPTool> {
    // Validate input
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        log::debug!("tool_search: empty query or zero limit");
        return Vec::new();
    }

    // Truncate overly long queries to prevent excessive CPU/memory usage.
    // Walk back from MAX_SEARCH_QUERY_LEN to a valid UTF-8 char boundary to
    // avoid a panic on multi-byte characters (e.g. CJK, emoji).
    let query = if query.len() > MAX_SEARCH_QUERY_LEN {
        log::warn!(
            "tool_search: query length {} exceeds max {}, truncating",
            query.len(),
            MAX_SEARCH_QUERY_LEN
        );
        let mut safe_len = MAX_SEARCH_QUERY_LEN;
        while !query.is_char_boundary(safe_len) {
            safe_len -= 1;
        }
        &query[..safe_len]
    } else {
        query
    };

    let search_index = match TOOL_SEARCH_INDEX.get() {
        Some(idx) => idx,
        None => {
            log::error!("tool_search: search index not initialized");
            return Vec::new();
        }
    };

    // Use the cached reader instead of creating one per query
    let searcher = search_index.reader.searcher();

    let mut query_parser = QueryParser::for_index(
        &search_index.index,
        vec![
            search_index.name_field,
            search_index.description_field,
            search_index.category_field,
        ],
    );
    query_parser.set_field_boost(search_index.name_field, 5.0);

    // Try parsing the query; fall back to a lenient parse if it fails
    let parsed_query = match query_parser.parse_query(query) {
        std::result::Result::Ok(q) => q,
        Err(e) => {
            log::debug!(
                "tool_search: strict parse failed ({}), using lenient parse",
                e
            );
            let (q, _) = query_parser.parse_query_lenient(query);
            q
        }
    };

    let top_docs =
        match searcher.search(&parsed_query, &TopDocs::with_limit(limit).order_by_score()) {
            std::result::Result::Ok(docs) => docs,
            Err(e) => {
                log::error!("tool_search: search failed for query '{}': {}", query, e);
                return Vec::new();
            }
        };

    // Use the pre-built name→tool map instead of rebuilding per query
    let mut results = Vec::new();
    for (_score, doc_address) in top_docs {
        if let std::result::Result::Ok(doc) = searcher.doc::<TantivyDocument>(doc_address)
            && let Some(tool_name_value) = doc.get_first(search_index.tool_name_field)
            && let Some(tool_name) = tool_name_value.as_str()
            && let Some(tool) = search_index.tools_by_name.get(tool_name)
        {
            results.push(tool.clone());
        } else {
            log::warn!(
                "tool_search: failed to retrieve tool from document at {:?}",
                doc_address
            );
        }
    }

    log::debug!(
        "tool_search: query '{}' returned {} results",
        query,
        results.len()
    );
    results
}

/// Initialize MCP tools from OpenAPI spec using rmcp-openapi
///
/// OPTIMIZATION: Instead of creating 200+ HTTP clients (one per tool via `generate_openapi_tools`),
/// we now:
/// 1. Only extract ToolMetadata (fast, ~186ms)
/// 2. Create a single shared HttpClient (fast, ~93ms for one client)
/// 3. Store ToolMetadata separately for tool execution
///
/// This reduces init time from ~20s to ~300ms.
///
/// ## Tool Filtering and Description
///
/// Tools are filtered and described using the `x-o2-mcp` OpenAPI extension:
///
/// - `enabled: false` - Tool is excluded from MCP
/// - `description: "..."` - Uses custom short description (falls back to OpenAPI description)
#[inline(always)]
pub fn init_mcp_tools(api: &OpenApi) -> Result<()> {
    let start = std::time::Instant::now();

    // Extract x-o2-mcp extensions from OpenAPI spec BEFORE converting to rmcp_openapi
    let mcp_extensions = extract_mcp_extensions(api);
    log::debug!(
        "Found {} operations with x-o2-mcp extensions",
        mcp_extensions.len()
    );

    let api_json = serde_json::to_value(api)?;
    let spec = rmcp_openapi::Spec::from_value(api_json)?;

    let zo_config = config::get_config();
    let base_url = url::Url::parse(&format!("http://localhost:{}", zo_config.http.port))
        .map_err(|e| anyhow::anyhow!("Invalid base URL: {e}"))?;

    // Set default headers including x-o2-mcp for MCP-initiated calls
    let mut default_headers = reqwest::header::HeaderMap::new();
    default_headers.insert("x-o2-mcp", "true".parse().unwrap());

    // Create a single shared HTTP client instead of 200+ clients
    let shared_client = rmcp_openapi::HttpClient::new()
        .with_base_url(base_url)?
        .with_default_headers(default_headers);

    // Only extract metadata - this is fast (~186ms for 209 tools)
    // We skip generate_openapi_tools which creates 200+ HTTP clients (~19.5s)
    let tools_metadata = spec.to_tool_metadata(None, false, false)?;

    let mut tools: Vec<MCPTool> = Vec::with_capacity(tools_metadata.len());
    let mut metadata_map: HashMap<String, rmcp_openapi::ToolMetadata> =
        HashMap::with_capacity(tools_metadata.len());

    let mut summary_configs: HashMap<String, SummaryFieldsConfig> = HashMap::new();
    let mut excluded_count = 0;
    let mut custom_desc_count = 0;

    for metadata in tools_metadata {
        // Check x-o2-mcp extension for enabled/disabled
        if let Some(mcp_ext) = mcp_extensions.get(&metadata.name)
            && !mcp_ext.enabled
        {
            excluded_count += 1;
            continue;
        }

        // rmcp-openapi handles Draft 2020-12 compatibility, but has a bug where it doesn't
        // deduplicate the `required` array when merging path + query parameters
        let mut input_schema = metadata.parameters.clone();

        // Deduplicate the required array
        if let Some(obj) = input_schema.as_object_mut()
            && let Some(required) = obj.get_mut("required")
            && let Some(required_arr) = required.as_array_mut()
        {
            let mut seen = std::collections::HashSet::new();
            required_arr.retain(|item| seen.insert(item.clone()));
        }

        // Simplify schema for tools with large versioned schemas (e.g., Dashboard v1-v8)
        let input_schema = simplify_schema(&metadata.name, input_schema);

        // Get description from x-o2-mcp extension or fall back to OpenAPI description
        let description = if let Some(mcp_ext) = mcp_extensions.get(&metadata.name) {
            if let Some(ref desc) = mcp_ext.description {
                custom_desc_count += 1;
                Some(desc.clone())
            } else {
                metadata.description.clone()
            }
        } else {
            metadata.description.clone()
        };

        // Get category from x-o2-mcp extension
        let category = mcp_extensions
            .get(&metadata.name)
            .and_then(|ext| ext.category.clone());

        // Get requires_confirmation from x-o2-mcp extension
        let requires_confirmation = mcp_extensions
            .get(&metadata.name)
            .and_then(|ext| ext.requires_confirmation)
            .unwrap_or(false);

        // Get pinned from x-o2-mcp extension
        let pinned = mcp_extensions
            .get(&metadata.name)
            .map(|ext| ext.pinned)
            .unwrap_or(false);

        // Collect summary_fields config for response filtering
        if let Some(mcp_ext) = mcp_extensions.get(&metadata.name)
            && let Some(ref sf) = mcp_ext.summary_fields
        {
            summary_configs.insert(metadata.name.clone(), sf.clone());
        }

        let mcp_tool = MCPTool {
            name: metadata.name.clone(),
            title: None,
            description,
            input_schema: input_schema.clone(),
            output_schema: None,
            annotations: None,
            http_method: metadata.method.clone(),
            http_path: metadata.path.clone(),
            category,
            requires_confirmation,
            pinned,
        };

        // IMPORTANT: Also update the metadata's parameters with simplified schema
        // to avoid oneOf validation errors when rmcp-openapi validates arguments
        let mut updated_metadata = metadata;
        updated_metadata.parameters = input_schema;

        metadata_map.insert(updated_metadata.name.clone(), updated_metadata);
        tools.push(mcp_tool);
    }
    tools.sort_by(|a, b| a.name.cmp(&b.name));

    log::info!(
        "Converted {} OpenAPI operations to MCP tools (excluded {}, {} custom descriptions) in {:?}",
        tools.len(),
        excluded_count,
        custom_desc_count,
        start.elapsed()
    );

    TOOLS_CACHE
        .set(tools)
        .expect("MCP tools should've been empty at this point");

    // Collect pinned tools for direct exposure in tools/list
    let pinned_tools: Vec<MCPTool> = TOOLS_CACHE
        .get()
        .unwrap()
        .iter()
        .filter(|t| t.pinned)
        .cloned()
        .collect();
    log::info!(
        "Pinned {} MCP tools for direct tools/list exposure",
        pinned_tools.len()
    );
    PINNED_TOOLS_CACHE
        .set(pinned_tools)
        .expect("Pinned tools cache should've been empty at this point");

    // Build the full-text search index for tool_search
    if let Some(cached_tools) = TOOLS_CACHE.get() {
        build_search_index(cached_tools)?;
    }

    TOOL_METADATA_CACHE
        .set(metadata_map)
        .map_err(|_| anyhow::anyhow!("Tool metadata should've been empty at this point"))?;

    SHARED_HTTP_CLIENT
        .set(shared_client)
        .map_err(|_| anyhow::anyhow!("Shared HTTP client should've been empty at this point"))?;

    log::info!(
        "Loaded {} summary_fields configs for response filtering",
        summary_configs.len()
    );
    log::debug!(
        "Summary config tools: {:?}",
        summary_configs.keys().collect::<Vec<_>>()
    );
    SUMMARY_CONFIG_CACHE
        .set(summary_configs)
        .map_err(|_| anyhow::anyhow!("Summary config cache should've been empty at this point"))?;

    Ok(())
}

/// Get all MCP tools derived from OpenObserve's OpenAPI spec
pub fn get_mcp_tools() -> Vec<MCPTool> {
    TOOLS_CACHE
        .get()
        .expect("MCP tools should've been set at this point")
        .clone()
}

/// Get tools marked as pinned — always exposed in tools/list without tool_search
pub fn get_pinned_tools() -> &'static [MCPTool] {
    PINNED_TOOLS_CACHE
        .get()
        .expect("Pinned tools cache should've been set at this point")
}

/// Get tool metadata by name for execution
pub fn get_tool_metadata(name: &str) -> Option<rmcp_openapi::ToolMetadata> {
    TOOL_METADATA_CACHE
        .get()
        .expect("Tool metadata should've been set at this point")
        .get(name)
        .cloned()
}

/// Get the summary fields config for a tool (if configured via x-o2-mcp extension)
pub fn get_summary_config(tool_name: &str) -> Option<SummaryFieldsConfig> {
    SUMMARY_CONFIG_CACHE
        .get()
        .and_then(|cache| cache.get(tool_name).cloned())
}

/// Register summary field configs for testing (safe to call multiple times).
pub fn register_summary_configs(configs: HashMap<String, SummaryFieldsConfig>) {
    let _ = SUMMARY_CONFIG_CACHE.set(configs);
}

/// Get the shared HTTP client for tool execution
pub fn get_shared_http_client() -> &'static rmcp_openapi::HttpClient {
    SHARED_HTTP_CLIENT
        .get()
        .expect("Shared HTTP client should've been set at this point")
}

/// Initialize MCP tools for testing with a minimal OpenAPI spec
/// This is safe to call multiple times - it will only initialize once
#[cfg(test)]
pub async fn init_test_tools() {
    use utoipa::openapi::{Info, OpenApi, Paths};

    // Use get_or_init to safely initialize only once, even with concurrent calls
    let _ = TOOLS_CACHE
        .get_or_init(|| async {
            let api = OpenApi::new(Info::new("Test API", "1.0.0"), Paths::new());

            // Convert to rmcp_openapi spec and extract metadata
            let api_json = serde_json::to_value(&api).unwrap_or_default();
            let spec = rmcp_openapi::Spec::from_value(api_json).unwrap();
            let tools_metadata = spec.to_tool_metadata(None, false, false).unwrap();

            // Convert to MCPTool format with simplified schemas
            let mut tools: Vec<MCPTool> = tools_metadata
                .into_iter()
                .map(|metadata| {
                    let input_schema = simplify_schema(&metadata.name, metadata.parameters);
                    MCPTool {
                        name: metadata.name,
                        title: None,
                        description: metadata.description,
                        input_schema,
                        output_schema: None,
                        annotations: None,
                        http_method: metadata.method,
                        http_path: metadata.path,
                        category: None,
                        requires_confirmation: false,
                        pinned: false,
                    }
                })
                .collect();

            tools.sort_by(|a, b| a.name.cmp(&b.name));
            tools
        })
        .await;

    // Initialize empty pinned tools cache for tests
    PINNED_TOOLS_CACHE
        .get_or_init(|| async { Vec::new() })
        .await;

    // Initialize the shared HTTP client for tests (using a mock base URL)
    SHARED_HTTP_CLIENT
        .get_or_init(|| async {
            rmcp_openapi::HttpClient::new()
                .with_base_url(url::Url::parse("http://localhost:5080").unwrap())
                .unwrap()
        })
        .await;

    // Initialize empty metadata cache for tests
    TOOL_METADATA_CACHE
        .get_or_init(|| async { std::collections::HashMap::new() })
        .await;

    // Initialize empty summary config cache for tests
    SUMMARY_CONFIG_CACHE
        .get_or_init(|| async { std::collections::HashMap::new() })
        .await;

    // Initialize empty search index for tests
    TOOL_SEARCH_INDEX
        .get_or_init(|| async {
            let o2_text_opts = TextOptions::default().set_indexing_options(
                TextFieldIndexing::default()
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions)
                    .set_tokenizer(O2_TOKENIZER),
            );

            let mut schema_builder = Schema::builder();
            let name_field = schema_builder.add_text_field("name", o2_text_opts);
            let description_field = schema_builder.add_text_field("description", TEXT);
            let category_field = schema_builder.add_text_field("category", TEXT);
            let tool_name_field = schema_builder.add_text_field("tool_name", STORED);
            let schema = schema_builder.build();

            let index = Index::create_in_ram(schema);
            index
                .tokenizers()
                .register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));

            let mut writer: IndexWriter = index.writer(15_000_000).unwrap();
            writer.commit().unwrap();

            // Re-register with Search mode for query-time tokenization
            index
                .tokenizers()
                .register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Search));

            let reader = index.reader().unwrap();

            ToolSearchIndex {
                index,
                reader,
                name_field,
                description_field,
                category_field,
                tool_name_field,
                tools_by_name: HashMap::new(),
            }
        })
        .await;
}
