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

/** Allowed entries naming no listed tool (globs, tools the server dropped); saved as they are. */
export function otherEntries(lists: ToolLists, tools: DiscoveredTool[] | null): string[] {
  const names = new Set((tools ?? []).map((t) => t.name));
  return (lists.allowed ?? []).filter((entry) => !names.has(entry));
}

/** The literal start of a glob such as `apm_*`, or null for an exact name or a leading `*`. */
export function globPrefix(entry: string): string | null {
  if (!isGlob(entry)) return null;
  return entry.split("*")[0] || null;
}

/** Turns one exact tool on or off in `allowed`; `write` is only ever trimmed, never added to. */
export function setToolOn(lists: ToolLists, name: string, on: boolean): ToolLists {
  if (!on) return setToolState(lists, name, "off");
  return {
    allowed: withName(lists.allowed, name),
    blocked: lists.blocked === null ? null : without(lists.blocked, name),
    write: lists.write,
  };
}

/** Spells globs out as the discovered names they match (a glob matching none stays), so one switch changes exactly one tool. */
export function expandGlobs(lists: ToolLists, tools: DiscoveredTool[]): ToolLists {
  const allowed = lists.allowed;
  if (allowed === null) return { ...lists, allowed: tools.map((t) => t.name) };
  if (!allowed.some(isGlob)) return lists;
  const kept = allowed.filter((e) => !isGlob(e) || !tools.some((t) => globMatches(e, t.name)));
  const matched = tools.filter((t) => matchesAny(allowed, t.name)).map((t) => t.name);
  return { ...lists, allowed: [...new Set([...kept, ...matched])] };
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
