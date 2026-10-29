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

import type { RouteLocationRaw } from "vue-router";

import type { ApprovalBlockData } from "./reducer";

/** What an approval does, in the user's words; `null` when the card names no change (a permission or a CLI prompt). */
export type ApprovalVerb = "pause" | "resume" | "create" | "update" | "delete";

/** One changed field: `before` is absent when the server sent no current value. */
export interface ApprovalDiffRow {
  field: string;
  after: unknown;
  before?: unknown;
}

/** The changed fields of a card, and whether the server sent the current values. */
export interface ApprovalDiff {
  rows: ApprovalDiffRow[];
  oneSided: boolean;
}

/** The native editor a single change can be handed to instead of approved. */
export interface ApprovalEditor {
  /** The entity whose editor label names the button, e.g. `alert` → "alert editor". */
  type: string;
  route: RouteLocationRaw;
}

type Card = Pick<ApprovalBlockData, "kind" | "tool" | "targets" | "args">;

/** The diff stops here; Details keeps the full arguments. */
export const MAX_DIFF_ROWS = 20;

// A toggle tool names its entity after "enable": EnableAlert, enable_pipeline, o2_EnableReport.
const TOGGLE_TOOL = /enable(alert|pipeline|report|dashboard|function|stream)s?$/;

// Where the object lives, not what changes about it.
const PLACEMENT_FIELDS: ReadonlySet<string> = new Set([
  "org_id",
  "org",
  "org_identifier",
  "organization",
  "folder",
  "folder_id",
]);

const ENABLED_FIELDS = ["value", "enabled", "enable"] as const;

// Entity types with an in-app editor that opens one object by id.
const EDITOR_ROUTES: Readonly<
  Record<string, (id: string, name: string, org: string) => RouteLocationRaw>
> = {
  alert: (id, name, org) => ({
    name: "alertList",
    query: { action: "update", alert_id: id, name, org_identifier: org },
  }),
};

/** The verb of a card: a toggle tool reads as pause or resume, a typed change as its kind. */
export function approvalVerb(card: Card): ApprovalVerb | null {
  const toggle = toggleOf(card);
  if (toggle) return toggle.enabled ? "resume" : "pause";
  if (card.kind === "create" || card.kind === "update" || card.kind === "delete") return card.kind;
  return null;
}

/** The entity a toggle tool acts on, when the targets do not say. */
export function approvalToolEntity(card: Pick<ApprovalBlockData, "tool">): string | null {
  return normalTool(card.tool).match(TOGGLE_TOOL)?.[1] ?? null;
}

/** The changed object's name: the target's, else the request body's; `null` when the card has none. */
export function approvalName(card: Card): string | null {
  const target = card.targets[0]?.name;
  if (target) return target;
  const body = recordOf(card.args?.request_body);
  const name = body?.name ?? card.args?.name;
  return typeof name === "string" && name.trim() ? name : null;
}

/** The changed object's id: the target's, else the last `*_id` argument (how o2-ai names the card). */
export function approvalObjectId(card: Card): string | null {
  const target = card.targets[0]?.id;
  if (target) return target;
  const ids = Object.entries(card.args ?? {}).filter(
    ([key, value]) =>
      key.endsWith("_id") && !PLACEMENT_FIELDS.has(key) && typeof value === "string",
  );
  const last = ids.at(-1)?.[1];
  return typeof last === "string" && last ? last : null;
}

/** The fields a change sets, without placement fields; a toggle is its one `enabled` field. */
export function approvalDiff(
  card: Card & Pick<ApprovalBlockData, "before" | "after">,
): ApprovalDiff | null {
  const toggle = toggleOf(card);
  const before = recordOf(card.before);
  if (toggle) {
    const was = before && "enabled" in before ? { before: before.enabled } : {};
    return { rows: [{ field: "enabled", after: toggle.enabled, ...was }], oneSided: !before };
  }
  if (card.kind !== "update" && card.kind !== "create") return null;
  const raw = recordOf(card.after);
  const after = recordOf(raw?.request_body) ?? raw;
  if (!after) return null;
  const id = approvalObjectId(card);
  const rows = Object.entries(after)
    .filter(
      ([field, value]) => !PLACEMENT_FIELDS.has(field) && !(field.endsWith("_id") && value === id),
    )
    .filter(([field, value]) => !before || JSON.stringify(before[field]) !== JSON.stringify(value))
    .slice(0, MAX_DIFF_ROWS)
    .map(([field, value]) => ({
      field,
      after: value,
      ...(before && field in before && { before: before[field] }),
    }));
  return rows.length ? { rows, oneSided: !before && card.kind === "update" } : null;
}

/** The native editor a single update can move to; `null` for a batch, a create or a type without one. */
export function approvalEditor(
  card: Card & Pick<ApprovalBlockData, "destructive">,
  org: string,
): ApprovalEditor | null {
  const verb = approvalVerb(card);
  if (card.destructive || card.targets.length > 1) return null;
  if (verb !== "update" && verb !== "pause" && verb !== "resume") return null;
  const type = card.targets[0]?.type ?? approvalToolEntity(card);
  const open = type ? EDITOR_ROUTES[type] : undefined;
  const id = approvalObjectId(card);
  if (!type || !open || !id) return null;
  return { type, route: open(id, approvalName(card) ?? "", org) };
}

/** Whether a card changes something, so the scope select only shows on a batch of them. */
export function isApprovalChange(card: Card): boolean {
  return approvalVerb(card) !== null;
}

// A toggle names its new state in one of a few argument names, sometimes as a string.
function toggleOf(card: Pick<ApprovalBlockData, "tool" | "args">): { enabled: boolean } | null {
  if (!TOGGLE_TOOL.test(normalTool(card.tool))) return null;
  const sources = [card.args, recordOf(card.args?.request_body)];
  for (const source of sources) {
    for (const key of ENABLED_FIELDS) {
      const value = source?.[key];
      if (typeof value === "boolean") return { enabled: value };
      if (value === "true" || value === "false") return { enabled: value === "true" };
    }
  }
  return null;
}

function normalTool(tool: string): string {
  return tool.toLowerCase().replace(/[^a-z]/g, "");
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
