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

// The server's `NOT_TOOLSET_SERVERS` and `FIRST_PARTY_TOOLS` (`meta/oncall/confidence.rs`).
const NOT_TOOLSET_SERVERS = new Set(["o2", "cli", "custom"]);
const FIRST_PARTY_TOOLS = new Set([
  "acknowledge_steering",
  "apply_patch",
  "ask_responders",
  "ask_user",
  "calculate_time_range",
  "convert_time_to_microseconds",
  "correlate_streams",
  "create_navigation",
  "fetch_openobserve_docs",
  "format_timestamp_for_display",
  "list_mcp_resource_templates",
  "list_mcp_resources",
  "plan_enter",
  "plan_exit",
  "read_mcp_resource",
  "record_blind_spot",
  "record_hypothesis",
  "record_step",
  "submit_report",
  "tool_search",
  "toolset_read_output",
  "tools_call",
  "update_memory",
]);
const SERVER_NAME = /^[a-z0-9-]+$/;

/** `toolset · tool` for a `<toolset>_<tool>` call of one of `toolsets`, as stored chats show it; else null. */
export function vendorToolLabel(
  tool: string,
  toolsets: ReadonlySet<string> | undefined,
): string | null {
  if (!toolsets?.size || FIRST_PARTY_TOOLS.has(tool)) return null;
  const at = tool.indexOf("_");
  if (at <= 0) return null;
  const server = tool.slice(0, at);
  const bare = tool.slice(at + 1);
  if (!bare || !SERVER_NAME.test(server) || NOT_TOOLSET_SERVERS.has(server)) return null;
  return toolsets.has(server) ? `${server} · ${bare}` : null;
}
