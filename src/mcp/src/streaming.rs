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

//! Agent searches run on the HTTP streaming endpoints. A streamed tool keeps
//! its one-shot name, schema and response shape, so prompts and callers see no
//! change; only the route and the reading of the SSE body differ.

use anyhow::{Result, anyhow};
use config::meta::{
    agent_format,
    search::{AgentOptions, CAPPED_RESULTS_MSG, OutputFormat},
    stream_fold::{self, StreamError},
};
use rmcp_openapi::ToolMetadata;
use serde_json::Value;

/// A one-shot search tool and the streaming operation it runs on.
const STREAMED_TOOLS: &[(&str, &str)] = &[("SearchSQL", "SearchStreamHttp2")];

/// How one streamed call's SSE body becomes the one-shot response.
#[derive(Debug)]
pub(crate) struct StreamedCall {
    row_cap: Option<usize>,
    output_format: OutputFormat,
}

impl StreamedCall {
    /// `None` for a one-shot tool; for a streamed one, adjusts `arguments` for its stream.
    pub(crate) fn prepare(tool: &str, arguments: &mut Value) -> Option<Self> {
        STREAMED_TOOLS.iter().find(|(name, _)| *name == tool)?;
        let mut call = StreamedCall {
            row_cap: None,
            output_format: OutputFormat::Json,
        };
        let Some(body) = arguments.get_mut("request_body") else {
            return Some(call);
        };
        call.output_format = body
            .get("agent_options")
            .and_then(|o| serde_json::from_value::<AgentOptions>(o.clone()).ok())
            .map(|o| o.output_format)
            .unwrap_or_default();
        if let Some(size) = body.pointer_mut("/query/size")
            && size
                .as_i64()
                .is_some_and(|n| n <= 0 && n != config::QUERY_WITH_NO_LIMIT)
        {
            // `_search` flags a result cut at the default limit; one row more lets us do the same
            let default_limit = config::get_config().limit.query_default_limit;
            *size = Value::from(default_limit + 1);
            call.row_cap = Some(default_limit as usize);
        }
        Some(call)
    }

    /// The one-shot body for a finished stream, or the tool error text for its `error` event.
    pub(crate) fn finish(&self, body: &str, took_ms: usize) -> Result<String, String> {
        let mut res = stream_fold::collect_sse(body).map_err(|e| error_text(&e))?;
        res.took = took_ms;
        if let Some(cap) = self.row_cap
            && res.hits.len() > cap
        {
            res.hits.truncate(cap);
            res.total = cap;
            stream_fold::mark_partial(&mut res, CAPPED_RESULTS_MSG);
        }
        agent_format::apply_output_format(&mut res, self.output_format);
        serde_json::to_string(&res).map_err(|e| format!("Tool execution failed: {e}"))
    }
}

/// Run each streamed tool on its streaming twin's route; name, description and schema stay.
pub(crate) fn route_through_streams(mut tools: Vec<ToolMetadata>) -> Result<Vec<ToolMetadata>> {
    for (tool, streaming_op) in STREAMED_TOOLS {
        let (method, path) = tools
            .iter()
            .find(|t| t.name == *streaming_op)
            .map(|t| (t.method.clone(), t.path.clone()))
            .ok_or_else(|| {
                anyhow!("MCP tool {tool}: streaming operation {streaming_op} is missing")
            })?;
        let one_shot = tools
            .iter_mut()
            .find(|t| t.name == *tool)
            .ok_or_else(|| anyhow!("MCP tool {tool} is missing"))?;
        one_shot.method = method;
        one_shot.path = path;
    }
    Ok(tools)
}

/// Same form as a failed one-shot call: `Error <status>: <body>`, whose `code` is the error code.
fn error_text(e: &StreamError) -> String {
    let mut body = e.clone();
    if let Some(error_code) = body.error_code.take() {
        body.code = error_code;
    }
    format!(
        "Error {}: {}",
        e.code,
        serde_json::to_string(&body).unwrap_or_default()
    )
}
