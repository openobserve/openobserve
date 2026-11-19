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

/** One tool an MCP server lists, as `_discover` returns it. */
export interface DiscoveredTool {
  name: string;
  description?: string;
  read_only_hint?: boolean | null;
  destructive_hint?: boolean | null;
}

/** The stored tool lists; `null` is an absent key (the agent's default applies). */
export interface ToolLists {
  allowed: string[] | null;
  blocked: string[] | null;
  write: string[] | null;
}

export type ToolState = "off" | "allowed" | "write";

/** Which list an "Other entries" row came from. */
export interface OtherEntry {
  list: keyof ToolLists;
  entry: string;
}

export type ToolsetBadge = "allTools" | "noTools" | "notVerified";

/** A tool the server doesn't promise is harmless: no `readOnlyHint: true`, or `destructiveHint`. */
export function mayWrite(tool: DiscoveredTool): boolean {
  return tool.read_only_hint !== true || tool.destructive_hint === true;
}

/** The gateway's glob: `*` is any run of characters, everything else literal, whole name. */
export function globMatches(glob: string, name: string): boolean {
  const parts = glob.split("*");
  if (parts.length === 1) return glob === name;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!name.startsWith(first) || name.length < first.length + last.length) return false;
  let at = first.length;
  for (const middle of parts.slice(1, -1)) {
    const found = name.indexOf(middle, at);
    if (found < 0) return false;
    at = found + middle.length;
  }
  return name.endsWith(last) && name.length - last.length >= at;
}

const matchesAny = (list: string[] | null, name: string) =>
  (list ?? []).some((g) => globMatches(g, name));

const isGlob = (entry: string) => entry.includes("*");

/** The gateway's rule without `write_tools`: a tool may write unless it declares `readOnlyHint`. */
function impliedWrite(tool: DiscoveredTool): boolean {
  return tool.read_only_hint !== true;
}

/** What the gateway does with `name` under these lists. */
export function toolState(lists: ToolLists, tool: DiscoveredTool): ToolState {
  if (matchesAny(lists.blocked, tool.name)) return "off";
  if (lists.allowed !== null && !matchesAny(lists.allowed, tool.name)) return "off";
  const writes = lists.write === null ? impliedWrite(tool) : matchesAny(lists.write, tool.name);
  return writes ? "write" : "allowed";
}

/** A glob, not an exact name, decides this tool, so its control can't change it. */
export function setByGlob(lists: ToolLists, name: string): boolean {
  return [lists.allowed, lists.blocked, lists.write].some((list) =>
    (list ?? []).some((g) => isGlob(g) && globMatches(g, name)),
  );
}

const without = (list: string[] | null, name: string) => (list ?? []).filter((e) => e !== name);
const withName = (list: string[] | null, name: string) =>
  (list ?? []).includes(name) ? [...(list ?? [])] : [...(list ?? []), name];

/** The lists after one tool's control is set; only exact names change. */
export function setToolState(lists: ToolLists, name: string, state: ToolState): ToolLists {
  const blocked = lists.blocked === null ? null : without(lists.blocked, name);
  if (state === "off") {
    return { allowed: without(lists.allowed, name), blocked, write: without(lists.write, name) };
  }
  return {
    allowed: withName(lists.allowed, name),
    blocked,
    write: state === "write" ? withName(lists.write, name) : without(lists.write, name),
  };
}

/** Spells out what the picker shows once the tools are known, so a save stores exactly that. */
export function prefillFromDiscovery(lists: ToolLists, tools: DiscoveredTool[]): ToolLists {
  if (lists.allowed === null) {
    return {
      allowed: tools.map((t) => t.name),
      blocked: lists.blocked,
      write: lists.write ?? tools.filter(mayWrite).map((t) => t.name),
    };
  }
  if (lists.write === null) {
    return {
      ...lists,
      write: tools.filter((t) => toolState(lists, t) === "write").map((t) => t.name),
    };
  }
  return lists;
}

/** "Allow all" turns every tool on, tagged ones as "can change things"; globs keep their say. */
export function allowAll(lists: ToolLists, tools: DiscoveredTool[]): ToolLists {
  return tools
    .filter((t) => !setByGlob(lists, t.name))
    .reduce((acc, t) => setToolState(acc, t.name, mayWrite(t) ? "write" : "allowed"), lists);
}

/** "Allow read-only" turns on only the tools the server marks read-only; the rest go off. */
export function allowReadOnly(lists: ToolLists, tools: DiscoveredTool[]): ToolLists {
  return tools
    .filter((t) => !setByGlob(lists, t.name))
    .reduce((acc, t) => setToolState(acc, t.name, mayWrite(t) ? "off" : "allowed"), lists);
}

/** Entries naming no listed tool (globs, typed names, tools the server dropped); saved as they are. */
export function otherEntries(lists: ToolLists, tools: DiscoveredTool[] | null): OtherEntry[] {
  const names = new Set((tools ?? []).map((t) => t.name));
  const rows: OtherEntry[] = [];
  for (const list of ["allowed", "blocked", "write"] as const) {
    for (const entry of lists[list] ?? []) {
      if (!names.has(entry)) rows.push({ list, entry });
    }
  }
  return rows;
}

export function removeEntry(lists: ToolLists, { list, entry }: OtherEntry): ToolLists {
  return { ...lists, [list]: lists[list] === null ? null : without(lists[list], entry) };
}

/** Why a typed tool name can't be added; the field takes exact names, never globs. */
export function typedToolError(name: string): "glob" | null {
  return name.includes("*") ? "glob" : null;
}

/** A typed tool name, for when the server can't be listed. */
export function addTypedTool(lists: ToolLists, name: string, canWrite: boolean): ToolLists {
  const trimmed = name.trim();
  if (!trimmed || typedToolError(trimmed)) return lists;
  return setToolState(lists, trimmed, canWrite ? "write" : "allowed");
}

/** The list page's badges for a saved MCP toolset's `data`. */
export function toolsetBadges(data: Record<string, any> | null | undefined): ToolsetBadge[] {
  if (!data) return [];
  const allowed = data.allowed_tools;
  if (allowed === undefined || allowed === null) return ["allTools"];
  const badges: ToolsetBadge[] = [];
  if (Array.isArray(allowed) && allowed.length === 0) badges.push("noTools");
  if (!data.tools_verified_at) badges.push("notVerified");
  return badges;
}

/** A toolset's last call outcomes, as `GET` toolsets returns them (microseconds). */
export interface ToolsetHealth {
  last_ok_at?: number | null;
  last_error_at?: number | null;
  failing_since?: number | null;
  last_error?: string | null;
}

const FAILING_WINDOW_US = 15 * 60 * 1_000_000;

/** "Failing since" shows only while every call of the last 15 minutes failed. */
export function failingSince(
  health: ToolsetHealth | null | undefined,
  nowUs: number,
): { since: number; error: string } | null {
  if (!health?.failing_since || !health.last_error_at) return null;
  if (nowUs - health.last_error_at > FAILING_WINDOW_US) return null;
  return { since: health.failing_since, error: health.last_error ?? "" };
}
