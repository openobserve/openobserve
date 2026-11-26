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

import { urlCarriesCredential } from "@/utils/drafts/urlCredentials";

import {
  emptyFormAuth,
  toolsetFormDefaults,
  type SecretRow,
  type ToolsetFormValues,
} from "./AssistantToolsetForm.schema";

/** The form as drafted; a preset's URL fields are copies of the URL, so they are not kept. */
export type ToolsetDraft = Omit<ToolsetFormValues, "mcp"> & {
  mcp: Omit<ToolsetFormValues["mcp"], "preset_params">;
};

export type DraftFieldLabel =
  { kind: "url" | "token_url" | "client_secret" } | { kind: "header"; name: string };

const URL_PATH = "/mcp/url";
const TOKEN_URL_PATH = "/mcp/auth/token_url";
const CLIENT_SECRET_PATH = "/mcp/auth/secret/value";
const HEADER_PATH = /^\/mcp\/headers\/(\d+)\/value$/;
const SECRET_STATES = new Set<SecretRow["state"]>(["unchanged", "replacing", "new"]);

export function toolsetDraftOf(values: ToolsetFormValues): ToolsetDraft {
  const { preset_params: _params, ...mcp } = values.mcp;
  return JSON.parse(JSON.stringify({ ...values, mcp })) as ToolsetDraft;
}

/** Header values and the client secret are secrets and a URL can embed a token, so none is drafted. */
export function redactToolsetDraft(draft: ToolsetDraft): { data: ToolsetDraft; paths: string[] } {
  const data = JSON.parse(JSON.stringify(draft)) as ToolsetDraft;
  const paths: string[] = [];
  const mcp = data.mcp;
  if (!mcp) return { data, paths };
  if (mcp.url && urlCarriesCredential(mcp.url)) {
    mcp.url = "";
    paths.push(URL_PATH);
  }
  if (mcp.auth?.token_url && urlCarriesCredential(mcp.auth.token_url)) {
    mcp.auth.token_url = "";
    paths.push(TOKEN_URL_PATH);
  }
  if (typeof mcp.auth?.secret?.value === "string" && mcp.auth.secret.value) {
    mcp.auth.secret.value = "";
    paths.push(CLIENT_SECRET_PATH);
  }
  (mcp.headers ?? []).forEach((row, index) => {
    if (typeof row.value !== "string" || !row.value) return;
    row.value = "";
    paths.push(`/mcp/headers/${index}/value`);
  });
  return { data, paths };
}

/** What each not-kept path was, for the restore dialog's list. */
export function draftRedactedLabels(paths: string[], data: ToolsetDraft): DraftFieldLabel[] {
  const seen = new Set<string>();
  return paths.flatMap((path): DraftFieldLabel[] => {
    let label: DraftFieldLabel | null = null;
    if (path === URL_PATH) label = { kind: "url" };
    else if (path === TOKEN_URL_PATH) label = { kind: "token_url" };
    else if (path === CLIENT_SECRET_PATH) label = { kind: "client_secret" };
    else {
      const match = HEADER_PATH.exec(path);
      if (match) label = { kind: "header", name: data.mcp?.headers?.[Number(match[1])]?.key ?? "" };
    }
    const key = JSON.stringify(label);
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
}

/** The form field a not-kept path is typed into again. */
export function draftFieldName(path: string): string | null {
  if (path === URL_PATH) return "mcp.url";
  if (path === TOKEN_URL_PATH) return "mcp.auth.token_url";
  if (path === CLIENT_SECRET_PATH) return "mcp.auth.secret.value";
  const match = HEADER_PATH.exec(path);
  return match ? `mcp.headers[${match[1]}].value` : null;
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function secretRowOf(value: unknown, key = ""): SecretRow {
  const row = isRecord(value) ? value : {};
  const state = SECRET_STATES.has(row.state as SecretRow["state"])
    ? (row.state as SecretRow["state"])
    : "new";
  return {
    key: str(row.key, key),
    value: state === "unchanged" ? null : str(row.value),
    state,
    ...(typeof row.stored === "string" && { stored: row.stored }),
  };
}

/** The form values of a stored draft; one written by an older form is read field by field. */
export function toolsetFormOfDraft(draft: unknown): ToolsetFormValues {
  const values = toolsetFormDefaults();
  if (!isRecord(draft)) return values;
  values.name = str(draft.name);
  if (draft.kind === "mcp" || draft.kind === "skill") values.kind = draft.kind;
  values.description = str(draft.description);
  values.region_only = draft.region_only === true;
  const skill = isRecord(draft.skill) ? draft.skill : {};
  values.skill = { content: str(skill.content) };
  const mcp = isRecord(draft.mcp) ? draft.mcp : {};
  const auth = isRecord(mcp.auth) ? mcp.auth : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : null);
  const timeout = Number(mcp.timeout_seconds);
  values.mcp = {
    ...values.mcp,
    url: str(mcp.url),
    timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 30,
    headers: (Array.isArray(mcp.headers) ? mcp.headers : []).map((row) => secretRowOf(row)),
    auth: {
      ...emptyFormAuth(),
      token_url: str(auth.token_url),
      client_id: str(auth.client_id),
      scope: str(auth.scope),
      secret: isRecord(auth.secret)
        ? secretRowOf(auth.secret, "client_secret")
        : emptyFormAuth().secret,
      extra: isRecord(auth.extra) ? auth.extra : {},
    },
    allowed_tools: "allowed_tools" in mcp ? list(mcp.allowed_tools) : values.mcp.allowed_tools,
    blocked_tools: list(mcp.blocked_tools),
    write_tools: list(mcp.write_tools),
    extra: isRecord(mcp.extra) ? mcp.extra : {},
  };
  return values;
}
