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

import { z } from "zod";

import { aiToolsetNameRegex } from "@/components/ai_toolsets/AddAiToolset.schema";
import type { SecretInputState } from "@/lib/forms/SecretInput/OSecretInput.types";
import type { ToolsetCreateRequest } from "@/services/ai_toolsets";

import { agentNameOf } from "./assistantToolsets";

export interface ToolsetSchemaOptions {
  /** True when another toolset in this org already reaches the agent under this name. */
  isTaken: (agent: string) => boolean;
  /** The name is locked on edit, so an existing clash must not block other changes. */
  editing: boolean;
  /** The server keeps an unchanged secret when it receives the mask. */
  mergeSecrets: boolean;
}

/** What a merging server reads as "keep the stored value". */
export const SECRET_MASK = "***";

const secretRow = z.object({
  key: z.string(),
  value: z.string().nullable(),
  state: z.enum(["unchanged", "replacing", "new"]),
  /** The key the server stored this secret under; a kept secret is always sent back under it. */
  stored: z.string().optional(),
});

export type SecretRow = z.infer<typeof secretRow>;

type Translate = (key: string, params?: Record<string, unknown>) => string;

export const makeToolsetFormSchema = (t: Translate, options: ToolsetSchemaOptions) => {
  const whole = t("assistant.toolsets.form.wholeNumber");
  return z
    .object({
      name: z
        .string()
        .min(1, t("aiToolset.nameRequired"))
        .regex(aiToolsetNameRegex, t("aiToolset.nameInvalid"))
        .max(256, t("aiToolset.nameTooLong")),
      kind: z.enum(["mcp", "skill"]),
      description: z.string(),
      mcp: z.object({
        url: z.string(),
        timeout_seconds: z.coerce.number().int(whole).positive(whole),
        headers: z.array(secretRow),
      }),
      skill: z.object({ content: z.string() }),
    })
    .superRefine((val, ctx) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      if (!options.editing && options.isTaken(agentNameOf(val.name)))
        issue(["name"], t("assistant.toolsets.form.nameClash", { agent: agentNameOf(val.name) }));
      if (val.kind === "mcp" && !val.mcp.url.trim())
        issue(["mcp", "url"], t("aiToolset.mcpUrlRequired"));
      if (val.kind === "skill" && !val.skill.content.trim())
        issue(["skill", "content"], t("aiToolset.skillContentRequired"));
      if (val.kind !== "mcp") return;
      val.mcp.headers.forEach((row, i) => {
        if (!row.key.trim() || row.state === "unchanged") return;
        if (!row.value)
          issue(["mcp", "headers", i, "value"], t("assistant.toolsets.form.enterAgain"));
        else if (row.value === SECRET_MASK)
          issue(["mcp", "headers", i, "value"], t("assistant.toolsets.form.maskValue"));
      });
    });
};

export type ToolsetFormValues = z.infer<ReturnType<typeof makeToolsetFormSchema>>;

export const toolsetFormDefaults = (): ToolsetFormValues => ({
  name: "",
  kind: "mcp",
  description: "",
  mcp: { url: "", timeout_seconds: 30, headers: [] },
  skill: { content: "" },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Stored secrets never enter the form: each starts unchanged, or must be typed again when the server cannot keep it. */
function secretRowsOf(value: unknown, mergeSecrets: boolean): SecretRow[] {
  if (!isRecord(value)) return [];
  const state: SecretInputState = mergeSecrets ? "unchanged" : "new";
  return Object.keys(value)
    .slice(0, 100)
    .map((key) => ({ key, value: mergeSecrets ? null : "", state, stored: key }));
}

/** The form for a stored record; the server's masked values are dropped, never shown or sent back. */
export function toolsetFormOf(record: unknown, mergeSecrets: boolean): ToolsetFormValues {
  const values = toolsetFormDefaults();
  if (!isRecord(record)) return values;
  const data = isRecord(record.data) ? record.data : {};
  values.name = typeof record.name === "string" ? record.name : "";
  if (record.kind === "mcp" || record.kind === "skill") values.kind = record.kind;
  values.description = typeof record.description === "string" ? record.description : "";
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  if (values.kind === "mcp") {
    values.mcp = {
      url: typeof data.url === "string" ? data.url : "",
      timeout_seconds: num(data.timeout_seconds, 30),
      headers: secretRowsOf(data.headers, mergeSecrets),
    };
  } else {
    values.skill = { content: typeof data.content === "string" ? data.content : "" };
  }
  return values;
}

/** An unchanged secret is sent as the mask only to a server that merges it; any other row carries what was typed. */
function secretMap(rows: SecretRow[], mergeSecrets: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (row.state === "unchanged") {
      if (mergeSecrets) out[row.stored ?? key] = SECRET_MASK;
      continue;
    }
    if (row.value && row.value !== SECRET_MASK) out[key] = row.value;
  }
  return out;
}

export function toolsetDataOf(
  values: ToolsetFormValues,
  mergeSecrets: boolean,
): NonNullable<ToolsetCreateRequest["data"]> {
  if (values.kind === "mcp")
    return {
      url: values.mcp.url,
      headers: secretMap(values.mcp.headers, mergeSecrets),
      timeout_seconds: Number(values.mcp.timeout_seconds),
    };
  return { content: values.skill.content };
}

/** Why a merging server would refuse to keep the stored secrets, or `null` when it keeps them. */
export type ReenterReason = "destination" | "secret";

/** A kept secret cannot travel with a changed destination or next to a new or replaced secret. */
export function reenterReason(
  values: ToolsetFormValues,
  loaded: ToolsetFormValues | null,
  mergeSecrets: boolean,
): ReenterReason | null {
  if (!mergeSecrets || !loaded || values.kind !== "mcp") return null;
  const rows = values.mcp.headers.filter((row) => row.key.trim());
  if (!rows.some((row) => row.state === "unchanged")) return null;
  if (values.mcp.url.trim() !== loaded.mcp.url.trim()) return "destination";
  return rows.some((row) => row.state !== "unchanged" && !!row.value) ? "secret" : null;
}

/** Field paths of every kept secret, which must be typed again before the server accepts the save. */
export function keptSecretPaths(values: ToolsetFormValues): string[] {
  if (values.kind !== "mcp") return [];
  return values.mcp.headers.flatMap((row, i) =>
    row.state === "unchanged" ? [`mcp.headers[${i}]`] : [],
  );
}
