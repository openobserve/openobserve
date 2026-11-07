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

export const makeToolsetFormSchema = (t: Translate, options: ToolsetSchemaOptions) =>
  z
    .object({
      name: z
        .string()
        .min(1, t("aiToolset.nameRequired"))
        .regex(aiToolsetNameRegex, t("aiToolset.nameInvalid"))
        .max(256, t("aiToolset.nameTooLong")),
      kind: z.enum(["mcp", "cli", "skill"]),
      description: z.string(),
      mcp: z.object({
        url: z.string(),
        timeout_seconds: z.coerce.number().int().positive(),
        headers: z.array(secretRow),
      }),
      cli: z.object({
        command: z.string(),
        allowed_subcommands_raw: z.string(),
        timeout_seconds: z.coerce.number().int().positive(),
        max_output_bytes: z.coerce.number().int().positive(),
        requires_confirmation: z.boolean(),
        blocked: z.array(z.string()).nullable(),
        env: z.array(secretRow),
        credFiles: z.array(secretRow),
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
      if (val.kind === "cli" && !val.cli.command.trim())
        issue(["cli", "command"], t("aiToolset.cliCommandRequired"));
      if (val.kind === "cli" && !splitList(val.cli.allowed_subcommands_raw).length)
        issue(["cli", "allowed_subcommands_raw"], t("assistant.toolsets.form.allowRequired"));
      if (val.kind === "skill" && !val.skill.content.trim())
        issue(["skill", "content"], t("aiToolset.skillContentRequired"));
      const lists: [string, string, SecretRow[]][] = [
        ["mcp", "headers", val.kind === "mcp" ? val.mcp.headers : []],
        ["cli", "env", val.kind === "cli" ? val.cli.env : []],
        ["cli", "credFiles", val.kind === "cli" ? val.cli.credFiles : []],
      ];
      for (const [group, field, rows] of lists)
        rows.forEach((row, i) => {
          if (!row.key.trim() || row.state === "unchanged") return;
          if (!row.value)
            issue([group, field, i, "value"], t("assistant.toolsets.form.enterAgain"));
          else if (row.value === SECRET_MASK)
            issue([group, field, i, "value"], t("assistant.toolsets.form.maskValue"));
        });
    });

export type ToolsetFormValues = z.infer<ReturnType<typeof makeToolsetFormSchema>>;

export const toolsetFormDefaults = (): ToolsetFormValues => ({
  name: "",
  kind: "mcp",
  description: "",
  mcp: { url: "", timeout_seconds: 30, headers: [] },
  cli: {
    command: "",
    allowed_subcommands_raw: "",
    timeout_seconds: 30,
    max_output_bytes: 100000,
    requires_confirmation: true,
    blocked: null,
    env: [],
    credFiles: [],
  },
  skill: { content: "" },
});

export function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

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
  if (record.kind === "mcp" || record.kind === "cli" || record.kind === "skill")
    values.kind = record.kind;
  values.description = typeof record.description === "string" ? record.description : "";
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  if (values.kind === "mcp") {
    values.mcp = {
      url: typeof data.url === "string" ? data.url : "",
      timeout_seconds: num(data.timeout_seconds, 30),
      headers: secretRowsOf(data.headers, mergeSecrets),
    };
  } else if (values.kind === "cli") {
    values.cli = {
      command: typeof data.command === "string" ? data.command : "",
      allowed_subcommands_raw: Array.isArray(data.allowed_subcommands)
        ? data.allowed_subcommands.filter((v) => typeof v === "string").join(", ")
        : "",
      timeout_seconds: num(data.timeout_seconds, 30),
      max_output_bytes: num(data.max_output_bytes, 100000),
      requires_confirmation: data.requires_confirmation === true,
      blocked: Array.isArray(data.blocked_subcommands)
        ? data.blocked_subcommands.filter((v): v is string => typeof v === "string")
        : null,
      env: secretRowsOf(data.env, mergeSecrets),
      credFiles: secretRowsOf(data.credential_files, mergeSecrets),
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
  if (values.kind === "cli")
    return {
      command: values.cli.command,
      allowed_subcommands: splitList(values.cli.allowed_subcommands_raw),
      timeout_seconds: Number(values.cli.timeout_seconds),
      max_output_bytes: Number(values.cli.max_output_bytes),
      requires_confirmation: values.cli.requires_confirmation,
      ...(values.cli.blocked ? { blocked_subcommands: values.cli.blocked } : {}),
      env: secretMap(values.cli.env, mergeSecrets),
      credential_files: secretMap(values.cli.credFiles, mergeSecrets),
    };
  return { content: values.skill.content };
}

/** Why a merging server would refuse to keep the stored secrets, or `null` when it keeps them. */
export type ReenterReason = "destination" | "secret";

const secretRowsOfKind = (values: ToolsetFormValues): SecretRow[] =>
  values.kind === "mcp"
    ? values.mcp.headers
    : values.kind === "cli"
      ? [...values.cli.env, ...values.cli.credFiles]
      : [];

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/** The server compares these fields with the stored record before it restores any kept secret. */
function destinationChanged(values: ToolsetFormValues, loaded: ToolsetFormValues): boolean {
  if (values.kind === "mcp") return values.mcp.url.trim() !== loaded.mcp.url.trim();
  if (values.kind !== "cli") return false;
  return (
    values.cli.command !== loaded.cli.command ||
    values.cli.requires_confirmation !== loaded.cli.requires_confirmation ||
    !sameList(
      splitList(values.cli.allowed_subcommands_raw),
      splitList(loaded.cli.allowed_subcommands_raw),
    )
  );
}

/** A kept secret cannot travel with a changed destination or next to a new or replaced secret. */
export function reenterReason(
  values: ToolsetFormValues,
  loaded: ToolsetFormValues | null,
  mergeSecrets: boolean,
): ReenterReason | null {
  if (!mergeSecrets || !loaded) return null;
  const rows = secretRowsOfKind(values).filter((row) => row.key.trim());
  if (!rows.some((row) => row.state === "unchanged")) return null;
  if (destinationChanged(values, loaded)) return "destination";
  return rows.some((row) => row.state !== "unchanged" && !!row.value) ? "secret" : null;
}

/** Field paths of every kept secret, which must be typed again before the server accepts the save. */
export function keptSecretPaths(values: ToolsetFormValues): string[] {
  const lists: [string, SecretRow[]][] =
    values.kind === "mcp"
      ? [["mcp.headers", values.mcp.headers]]
      : values.kind === "cli"
        ? [
            ["cli.env", values.cli.env],
            ["cli.credFiles", values.cli.credFiles],
          ]
        : [];
  return lists.flatMap(([field, rows]) =>
    rows.flatMap((row, i) => (row.state === "unchanged" ? [`${field}[${i}]`] : [])),
  );
}
