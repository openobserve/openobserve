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

import {
  AI_TOOLSET_NAME_MAX,
  aiToolsetNameRegex,
} from "@/components/ai_toolsets/AddAiToolset.schema";
import {
  authFromData,
  authPayload,
  isAuthorizationHeader,
  isHttpsUrl,
  usesClientCredentials,
} from "@/components/ai_toolsets/toolsetAuth";
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
  /** A row replicated without this region's client secret saves without one. */
  missingSecretOk?: () => boolean;
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

/** OAuth client credentials; `secret` is the client secret, kept or replaced like a header. */
const authSchema = z.object({
  token_url: z.string(),
  client_id: z.string(),
  scope: z.string(),
  secret: secretRow,
  /** Stored keys this form doesn't edit (e.g. `extra_params`), sent back as they are. */
  extra: z.record(z.string(), z.any()),
});

export type ToolsetFormAuth = z.infer<typeof authSchema>;

/** The `data` keys the form edits; every other stored key rides along in `mcp.extra`. */
const MCP_FORM_KEYS = new Set([
  "schema",
  "url",
  "headers",
  "auth",
  "timeout_seconds",
  "allowed_tools",
  "blocked_tools",
  "write_tools",
  "tools_verified_at",
]);

type Translate = (key: string, params?: Record<string, unknown>) => string;

export const makeToolsetFormSchema = (t: Translate, options: ToolsetSchemaOptions) => {
  const whole = t("assistant.toolsets.form.wholeNumber");
  return z
    .object({
      name: z.string().min(1, t("aiToolset.nameRequired")),
      kind: z.enum(["mcp", "skill"]),
      description: z.string(),
      region_only: z.boolean(),
      mcp: z.object({
        url: z.string(),
        timeout_seconds: z.coerce.number().int(whole).positive(whole),
        headers: z.array(secretRow),
        /** A preset's URL-template fields; the URL is rebuilt from them, so none is saved. */
        preset_params: z.record(z.string(), z.string()),
        auth: authSchema,
        /** `null` is an absent key, so the agent's default for that list applies. */
        allowed_tools: z.array(z.string()).nullable(),
        blocked_tools: z.array(z.string()).nullable(),
        write_tools: z.array(z.string()).nullable(),
        extra: z.record(z.string(), z.any()),
      }),
      skill: z.object({ content: z.string() }),
    })
    .superRefine((val, ctx) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      // Saved toolsets keep legacy names, so the server's name rule only gates a create.
      if (!options.editing && val.name && !aiToolsetNameRegex.test(val.name))
        issue(["name"], t("aiToolset.nameInvalid"));
      else if (!options.editing && val.name.length > AI_TOOLSET_NAME_MAX)
        issue(["name"], t("aiToolset.nameTooLong"));
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
      for (const [param, value] of Object.entries(val.mcp.preset_params)) {
        if (!value.trim())
          issue(["mcp", "preset_params", param], t("aiToolset.presetParamRequired"));
      }
      refineAuth(val.mcp, issue, t, options);
    });
};

type Issue = (path: (string | number)[], message: string) => void;

function refineAuth(
  mcp: { auth: ToolsetFormAuth; headers: SecretRow[] },
  issue: Issue,
  t: Translate,
  options: ToolsetSchemaOptions,
) {
  const { auth } = mcp;
  const secret = auth.secret;
  const typed = secret.state !== "unchanged" && !!secret.value;
  if (!usesClientCredentials(auth)) {
    // Without a client id the secret would be dropped without a word.
    if (typed) issue(["mcp", "auth", "client_id"], t("aiToolset.clientIdRequired"));
    return;
  }
  if (!auth.token_url.trim()) issue(["mcp", "auth", "token_url"], t("aiToolset.tokenUrlRequired"));
  else if (!isHttpsUrl(auth.token_url))
    issue(["mcp", "auth", "token_url"], t("aiToolset.tokenUrlHttps"));
  if (secret.state !== "unchanged" && !options.missingSecretOk?.()) {
    if (!secret.value)
      issue(["mcp", "auth", "secret", "value"], t("aiToolset.clientSecretRequired"));
    else if (secret.value === SECRET_MASK)
      issue(["mcp", "auth", "secret", "value"], t("assistant.toolsets.form.maskValue"));
  }
  mcp.headers.forEach((row, i) => {
    if (isAuthorizationHeader(row) && row.state !== "unchanged" && !!row.value)
      issue(["mcp", "headers", i, "key"], t("aiToolset.authorizationWithOauth"));
  });
}

export type ToolsetFormValues = z.infer<ReturnType<typeof makeToolsetFormSchema>>;

const emptySecret = (): SecretRow => ({ key: "client_secret", value: "", state: "new" });

export const emptyFormAuth = (): ToolsetFormAuth => ({
  token_url: "",
  client_id: "",
  scope: "",
  secret: emptySecret(),
  extra: {},
});

// A new custom MCP starts with every tool off; the picker turns tools on.
export const toolsetFormDefaults = (): ToolsetFormValues => ({
  name: "",
  kind: "mcp",
  description: "",
  region_only: false,
  mcp: {
    url: "",
    timeout_seconds: 30,
    headers: [],
    preset_params: {},
    auth: emptyFormAuth(),
    allowed_tools: [],
    blocked_tools: null,
    write_tools: null,
    extra: {},
  },
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
  values.region_only = record.region_only === true;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : null);
  if (values.kind === "mcp") {
    values.mcp = {
      url: typeof data.url === "string" ? data.url : "",
      timeout_seconds: num(data.timeout_seconds, 30),
      headers: secretRowsOf(data.headers, mergeSecrets),
      preset_params: {},
      auth: formAuthOf(data.auth, mergeSecrets),
      allowed_tools: list(data.allowed_tools),
      blocked_tools: list(data.blocked_tools),
      write_tools: list(data.write_tools),
      extra: extraOf(data),
    };
  } else {
    values.skill = { content: typeof data.content === "string" ? data.content : "" };
  }
  return values;
}

/** The stored client secret starts unchanged; an empty one is a secret this region lacks. */
function formAuthOf(stored: unknown, mergeSecrets: boolean): ToolsetFormAuth {
  const auth = authFromData(isRecord(stored) ? stored : null);
  const kept = mergeSecrets && !!auth.client_secret;
  return {
    token_url: auth.token_url,
    client_id: auth.client_id,
    scope: auth.scope,
    secret: kept
      ? { key: "client_secret", value: null, state: "unchanged", stored: "client_secret" }
      : emptySecret(),
    extra: auth.extra,
  };
}

/** Stored keys the form doesn't show; older preset metadata may copy the URL, so it is dropped. */
function extraOf(data: Record<string, unknown>): Record<string, unknown> {
  const extra = Object.fromEntries(Object.entries(data).filter(([key]) => !MCP_FORM_KEYS.has(key)));
  if (isRecord(extra.preset) && "params" in extra.preset) {
    const { params: _params, ...preset } = extra.preset;
    extra.preset = preset;
  }
  return extra;
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
  if (values.kind === "mcp") return mcpDataOf(values.mcp, mergeSecrets);
  return { content: values.skill.content };
}

/** `schema: 2` replaces the stored config, so every key the form doesn't edit is sent back. */
function mcpDataOf(
  mcp: ToolsetFormValues["mcp"],
  mergeSecrets: boolean,
): NonNullable<ToolsetCreateRequest["data"]> {
  const oauth = usesClientCredentials(mcp.auth);
  // With client credentials O2 sets `Authorization`, so a stored or empty one isn't sent.
  const rows = oauth ? mcp.headers.filter((row) => !isAuthorizationHeader(row)) : mcp.headers;
  const data: Record<string, unknown> = {
    ...mcp.extra,
    schema: 2,
    url: mcp.url,
    headers: secretMap(rows, mergeSecrets),
    timeout_seconds: Number(mcp.timeout_seconds),
  };
  const secret = secretMap([mcp.auth.secret], mergeSecrets).client_secret ?? "";
  const auth = authPayload({ ...mcp.auth, client_secret: secret });
  if (auth) data.auth = auth;
  if (mcp.allowed_tools !== null) data.allowed_tools = mcp.allowed_tools;
  if (mcp.blocked_tools !== null) data.blocked_tools = mcp.blocked_tools;
  // An empty list would let every tool run on read-only turns, so an unknown one stays absent.
  if (mcp.write_tools !== null) data.write_tools = mcp.write_tools;
  return data;
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
  const authKept = values.mcp.auth.secret.state === "unchanged";
  if (!rows.some((row) => row.state === "unchanged") && !authKept) return null;
  if (values.mcp.url.trim() !== loaded.mcp.url.trim()) return "destination";
  // A client secret is sent to the token URL, so a new one counts as a changed destination.
  if (authKept && values.mcp.auth.token_url.trim() !== loaded.mcp.auth.token_url.trim())
    return "destination";
  return rows.some((row) => row.state !== "unchanged" && !!row.value) ? "secret" : null;
}

/** Field paths of every kept secret, which must be typed again before the server accepts the save. */
export function keptSecretPaths(values: ToolsetFormValues): string[] {
  if (values.kind !== "mcp") return [];
  const headers = values.mcp.headers.flatMap((row, i) =>
    row.state === "unchanged" ? [`mcp.headers[${i}]`] : [],
  );
  return values.mcp.auth.secret.state === "unchanged" ? [...headers, "mcp.auth.secret"] : headers;
}
