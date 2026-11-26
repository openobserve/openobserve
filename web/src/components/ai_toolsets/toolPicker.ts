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

/** Which list an entry naming no listed tool came from. */
export interface OtherEntry {
  list: keyof ToolLists;
  entry: string;
}

export type ToolsetBadge = "allTools" | "noTools" | "notVerified";

/** A tool the server doesn't promise is harmless: no `readOnlyHint: true`, or `destructiveHint`. */
export function mayWrite(tool: DiscoveredTool): boolean {
  return tool.read_only_hint !== true || tool.destructive_hint === true;
}

// The agent matches the names opencode gives tools, so both sides get its replacement of characters.
const toolKey = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
const globKey = (glob: string) => glob.replace(/[^a-zA-Z0-9_*-]/g, "_");

/** The tool lists' glob: `*` is any run of characters, everything else literal, whole name. */
export function globMatches(rawGlob: string, rawName: string): boolean {
  const glob = globKey(rawGlob);
  const name = toolKey(rawName);
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

/** Without `write_tools`, a read-only turn gets only the tools that declare `readOnlyHint`. */
function impliedWrite(tool: DiscoveredTool): boolean {
  return tool.read_only_hint !== true;
}

/** What the agent's tool policy makes of `tool` under these lists. */
export function toolState(lists: ToolLists, tool: DiscoveredTool): ToolState {
  if (matchesAny(lists.blocked, tool.name)) return "off";
  if (lists.allowed !== null && !matchesAny(lists.allowed, tool.name)) return "off";
  const writes = lists.write === null ? impliedWrite(tool) : matchesAny(lists.write, tool.name);
  return writes ? "write" : "allowed";
}

/** Whether `entry` names exactly this tool, in the vendor's spelling or the agent's. */
const isOwn = (entry: string, name: string) =>
  !isGlob(entry) && (entry === name || entry === toolKey(name));

// A glob, or another spelling of the name, that decides this tool without being its own entry.
const decidesOther = (entry: string, name: string) =>
  !isOwn(entry, name) && globMatches(entry, name);

/** A blocked glob, not the exact name, keeps this tool off, so its checkbox can't turn it on. */
export function blockedByGlob(lists: ToolLists, name: string): boolean {
  return (lists.blocked ?? []).some((entry) => decidesOther(entry, name));
}

const without = (list: string[] | null, name: string) =>
  (list ?? []).filter((entry) => !isOwn(entry, name));
// The normalized name, as a `*` in the vendor's own would be a wildcard.
const withName = (list: string[] | null, name: string) =>
  (list ?? []).some((entry) => isOwn(entry, name))
    ? [...(list ?? [])]
    : [...(list ?? []), toolKey(name)];

const keysOf = (tools: DiscoveredTool[]) => [...new Set(tools.map((t) => toolKey(t.name)))];

// All that is allowed but not known to be read-only, so what no list showed stays off read-only turns.
const cautiousWrites = (lists: ToolLists, tools: DiscoveredTool[]) =>
  (lists.allowed ?? ["*"]).filter(
    (entry) => !tools.some((t) => isOwn(entry, t.name) && toolState(lists, t) === "allowed"),
  );

/** The lists after one tool's control is set; only exact names change. */
export function setToolState(
  lists: ToolLists,
  name: string,
  state: ToolState,
  tools: DiscoveredTool[] = [],
): ToolLists {
  const blocked = lists.blocked === null ? null : without(lists.blocked, name);
  const write = lists.write ?? cautiousWrites(lists, tools);
  if (state === "off") {
    return { allowed: without(lists.allowed, name), blocked, write: without(write, name) };
  }
  return {
    allowed: withName(lists.allowed, name),
    blocked,
    write: state === "write" ? withName(write, name) : without(write, name),
  };
}

/** Spells out what the picker shows once the tools are known, so a save stores exactly that. */
export function prefillFromDiscovery(lists: ToolLists, tools: DiscoveredTool[]): ToolLists {
  if (lists.allowed === null) return { ...lists, allowed: keysOf(tools) };
  // Today's tools can't stand for what a glob matches, so the agent's own rule stays.
  if (lists.write !== null || lists.allowed.some(isGlob)) return lists;
  return { ...lists, write: keysOf(tools.filter((t) => toolState(lists, t) === "write")) };
}

/** Entries naming no listed tool (globs, tools the server dropped); saved as they are. */
export function otherEntries(lists: ToolLists, tools: DiscoveredTool[] | null): OtherEntry[] {
  const rows: OtherEntry[] = [];
  for (const list of ["allowed", "blocked", "write"] as const) {
    for (const entry of lists[list] ?? []) {
      if (!(tools ?? []).some((t) => isOwn(entry, t.name))) rows.push({ list, entry });
    }
  }
  return rows;
}

export function removeEntry(lists: ToolLists, { list, entry }: OtherEntry): ToolLists {
  return { ...lists, [list]: lists[list]?.filter((e) => e !== entry) ?? null };
}

/** The literal start of a glob such as `apm_*`, or null for an exact name or a leading `*`. */
export function globPrefix(entry: string): string | null {
  if (!isGlob(entry)) return null;
  return entry.split("*")[0] || null;
}

/** Spells out the allowed globs that match `name` as the tools they match, so it can go off alone. */
export function expandGlobs(lists: ToolLists, name: string, tools: DiscoveredTool[]): ToolLists {
  if (lists.allowed === null) return { ...lists, allowed: keysOf(tools) };
  const globs = lists.allowed.filter((entry) => decidesOther(entry, name));
  if (!globs.length) return lists;
  const kept = lists.allowed.filter((entry) => !globs.includes(entry));
  const matched = tools.filter(
    (t) => matchesAny(globs, t.name) && !kept.some((entry) => isOwn(entry, t.name)),
  );
  return { ...lists, allowed: [...kept, ...keysOf(matched)] };
}

/** Turns one listed tool on or off; one that may write goes on as a write, so read-only turns refuse it. */
export function setToolOn(
  lists: ToolLists,
  tool: DiscoveredTool,
  on: boolean,
  tools: DiscoveredTool[],
): ToolLists {
  const { name } = tool;
  if ((toolState(lists, tool) !== "off") === on) return lists;
  if (!on) return setToolState(expandGlobs(lists, name, tools), name, "off", tools);
  if (blockedByGlob(lists, name)) return lists;
  const writes = mayWrite(tool) || matchesAny(lists.write, name);
  const from = lists.allowed === null ? expandGlobs(lists, name, tools) : lists;
  return setToolState(from, name, writes ? "write" : "allowed", tools);
}

/** Where a tool may run: write tools run only in chat, read-only ones also in Slack and RCA. */
export type ToolLevel = "off" | "chat" | "everywhere";

const LEVEL_OF: Record<ToolState, ToolLevel> = { off: "off", write: "chat", allowed: "everywhere" };

export const toolLevel = (lists: ToolLists, tool: DiscoveredTool): ToolLevel =>
  LEVEL_OF[toolState(lists, tool)];

/** Sets one tool's level; only exact names change, and a blocked glob keeps it off. */
export function setToolLevel(
  lists: ToolLists,
  tool: DiscoveredTool,
  level: ToolLevel,
  tools: DiscoveredTool[],
): ToolLists {
  if (toolLevel(lists, tool) === level) return lists;
  if (level === "off") return setToolOn(lists, tool, false, tools);
  if (blockedByGlob(lists, tool.name)) return lists;
  const from = lists.allowed === null ? expandGlobs(lists, tool.name, tools) : lists;
  return setToolState(from, tool.name, level === "chat" ? "write" : "allowed", tools);
}

/** Sets a group's tools; turning tools on skips destructive ones, which each need a confirm. */
export function setGroupLevel(
  lists: ToolLists,
  group: DiscoveredTool[],
  level: ToolLevel,
  tools: DiscoveredTool[],
): ToolLists {
  return group
    .filter((tool) => level === "off" || tool.destructive_hint !== true)
    .reduce((acc, tool) => {
      const own = level === "everywhere" && mayWrite(tool) ? "chat" : level;
      return setToolLevel(acc, tool, own, tools);
    }, lists);
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
