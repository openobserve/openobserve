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

import type { I18nKey } from "@/types/i18n";

export type ToolsetKindId = "mcp" | "cli" | "skill" | "generic";

export type ToolsetHealth = "ok" | "failing" | "never" | "disabled";

/** One toolset as the list shows it; the health fields are present only on a server that reports them. */
export interface ToolsetRow {
  id: string;
  name: string;
  kind: ToolsetKindId;
  description: string;
  agentName: string;
  enabled?: boolean;
  health?: "ok" | "failing" | "never";
  failingSince?: number;
  lastError?: string;
  lastUsedAt?: number;
  command?: string;
  allowList: string[];
  requiresConfirmation?: boolean;
}

export const MAX_TOOLSETS = 1000;

const MAX_TEXT = 500;

const MAX_AGENT_NAME = 64;

const SERVER_STATES: Record<string, ToolsetRow["health"]> = {
  ok: "ok",
  failing: "failing",
  never_used: "never",
};

const KINDS: ReadonlySet<string> = new Set(["mcp", "cli", "skill", "generic"]);

export const KIND_LABEL_KEYS: Record<ToolsetKindId, I18nKey> = {
  mcp: "assistant.toolsets.kinds.mcp",
  cli: "assistant.toolsets.kinds.cli",
  skill: "assistant.toolsets.kinds.skill",
  generic: "assistant.toolsets.kinds.generic",
};

/** Read-only verbs a preset fills in; anything wider is added by hand. */
export const CLI_PRESETS = [
  {
    id: "kubectl",
    command: "kubectl",
    allow: "get, describe, logs, top",
    env: [],
    files: ["KUBECONFIG"],
  },
  { id: "gh", command: "gh", allow: "pr view, issue view, run view", env: ["GH_TOKEN"], files: [] },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length <= MAX_TEXT ? value : undefined;

const time = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

/** The name the agent sees, computed exactly as the server does so previews and clashes match. */
export function agentNameOf(name: string): string {
  const folded = Array.from(name, (c) => {
    const lo = c.length === 1 && c >= "A" && c <= "Z" ? c.toLowerCase() : c;
    return /^[a-z0-9]$/.test(lo) ? lo : "-";
  })
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return Array.from(folded).slice(0, MAX_AGENT_NAME).join("") || "toolset";
}

/** Server rows are untrusted: unknown kinds, oversize text and non-string ids drop the row. */
export function parseToolsetRows(list: unknown): ToolsetRow[] {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_TOOLSETS)
    .map(parseToolsetRow)
    .filter((row): row is ToolsetRow => row !== null);
}

function parseToolsetRow(value: unknown): ToolsetRow | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  const kind = text(value.kind);
  if (!id || !name || !kind || !KINDS.has(kind)) return null;
  const data = isRecord(value.data) ? value.data : {};
  const row: ToolsetRow = {
    id,
    name,
    kind: kind as ToolsetKindId,
    description: text(value.description) ?? "",
    agentName: agentNameOf(name),
    allowList: Array.isArray(data.allowed_subcommands)
      ? data.allowed_subcommands.map(text).filter((v): v is string => !!v)
      : [],
  };
  if (typeof value.enabled === "boolean") row.enabled = value.enabled;
  readStatus(row, value.status);
  row.lastUsedAt = time(value.last_used_at);
  if (kind === "cli") {
    row.command = text(data.command);
    if (typeof data.requires_confirmation === "boolean")
      row.requiresConfirmation = data.requires_confirmation;
  }
  return row;
}

/** `status` is `{state, since, last_error}`; `disabled` follows the enable flag instead. */
function readStatus(row: ToolsetRow, status: unknown): void {
  if (!isRecord(status) || typeof status.state !== "string") return;
  if (status.state === "disabled") {
    row.enabled ??= false;
    return;
  }
  const health = SERVER_STATES[status.state];
  if (!health) return;
  row.health = health;
  if (health !== "failing") return;
  row.failingSince = time(status.since);
  row.lastError = text(status.last_error);
}

/** The server reports health when any record carries its status or its enable flag. */
export function hasToolsetHealth(rows: ToolsetRow[]): boolean {
  return rows.some((row) => row.enabled !== undefined || row.health !== undefined);
}

/** Never inferred from `last_used_at`: a used toolset may be failing now. */
export function healthOf(row: ToolsetRow): ToolsetHealth {
  if (row.enabled === false) return "disabled";
  return row.health ?? "never";
}

/** A CLI toolset saved before approval defaulted on, with nothing to stop any subcommand. */
export function runsWithoutApproval(row: ToolsetRow): boolean {
  return row.kind === "cli" && row.requiresConfirmation === false && row.allowList.length === 0;
}

/** Agent names reached by more than one toolset, where one hides the other. */
export function clashingNames(rows: ToolsetRow[]): Set<string> {
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.agentName, (seen.get(row.agentName) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([agent]) => agent));
}

/** Search covers the label a person reads for the kind, not its raw id. */
export function matchesToolset(row: ToolsetRow, query: string, kindLabel: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.description, kindLabel].some((field) => field.toLowerCase().includes(q));
}
