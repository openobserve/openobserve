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

import { computed, ref, watch, type Ref } from "vue";

import {
  prefillFromDiscovery,
  removeEntry,
  type DiscoveredTool,
  type OtherEntry,
  type ToolLists,
} from "@/components/ai_toolsets/toolPicker";
import { authPayload, authReady } from "@/components/ai_toolsets/toolsetAuth";
import aiToolsetsService from "@/services/ai_toolsets";

import { SECRET_MASK, type SecretRow, type ToolsetFormValues } from "./AssistantToolsetForm.schema";

type Mcp = ToolsetFormValues["mcp"];

export type DiscoveryStatus = "idle" | "loading" | "ok" | "failed";

/** A row's value as a discovery sends it: a kept secret goes as the mask, merged by id. */
const sentValue = (row: SecretRow) => (row.state === "unchanged" ? SECRET_MASK : (row.value ?? ""));

function headerMap(mcp: Mcp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of mcp.headers) {
    const key = row.key.trim();
    if (key) out[key] = sentValue(row);
  }
  return out;
}

function authOf(mcp: Mcp) {
  return authPayload({ ...mcp.auth, client_secret: sentValue(mcp.auth.secret) });
}

/** Every row, half-typed ones included, so typing anywhere voids a result in flight. */
export function discoveryKey(mcp: Mcp): string {
  return JSON.stringify([
    mcp.url,
    Number(mcp.timeout_seconds) || 30,
    mcp.headers.map((row) => [row.key, row.state, row.value ?? ""]),
    authOf(mcp) ?? "",
  ]);
}

/** Every credential is filled in, so a discovery never runs on half-typed ones. */
export function readyToDiscover(mcp: Mcp): boolean {
  const secret = sentValue(mcp.auth.secret);
  return (
    !!mcp.url.trim() &&
    authReady({ ...mcp.auth, client_secret: secret }) &&
    mcp.headers.every((row) => !row.key.trim() === !sentValue(row))
  );
}

/** The org's own form lists, unless a current discovery spells out what is shown. */
function formLists(mcp: Mcp): ToolLists {
  return { allowed: mcp.allowed_tools, blocked: mcp.blocked_tools, write: mcp.write_tools };
}

/** Lists the server's tools through `_discover` and keeps the picker's lists in the form. */
export function useToolsetTools(options: {
  org: string;
  editId: () => string | undefined;
  mcp: Ref<Mcp>;
  setLists: (lists: ToolLists) => void;
}) {
  const tools = ref<DiscoveredTool[] | null>(null);
  const status = ref<DiscoveryStatus>("idle");
  const error = ref("");
  // The request the last successful discovery made, and when it ran (microseconds).
  const verified = ref<{ key: string; at: number } | null>(null);
  let seq = 0;

  const current = computed(
    () => !!tools.value && verified.value?.key === discoveryKey(options.mcp.value),
  );
  const lists = computed(() =>
    current.value
      ? prefillFromDiscovery(formLists(options.mcp.value), tools.value ?? [])
      : formLists(options.mcp.value),
  );

  // Any endpoint change voids the request in flight and the tools shown.
  watch(
    () => discoveryKey(options.mcp.value),
    (key, previous) => {
      if (key === previous) return;
      seq++;
      tools.value = null;
      status.value = "idle";
      error.value = "";
    },
  );

  async function discover() {
    const mcp = options.mcp.value;
    if (!readyToDiscover(mcp)) return;
    const key = discoveryKey(mcp);
    const auth = authOf(mcp);
    const config = {
      url: mcp.url,
      headers: headerMap(mcp),
      timeout_seconds: Number(mcp.timeout_seconds) || 30,
      ...(auth ? { auth } : {}),
    };
    const id = options.editId();
    // An override left out keeps the stored value, so headers only is sent as such.
    const body = id ? { id, overrides: { auth: { type: "headers" }, ...config } } : config;
    const mine = ++seq;
    status.value = "loading";
    try {
      const res = await aiToolsetsService.discover(options.org, body);
      if (mine !== seq) return;
      // Set before the tools, whose change is what makes the shown lists recompute.
      verified.value = { key, at: Date.now() * 1000 };
      tools.value = res.data?.tools ?? [];
      status.value = "ok";
      error.value = "";
    } catch (err) {
      if (mine !== seq) return;
      const res = (err as { response?: { data?: { message?: unknown } }; message?: string }) ?? {};
      tools.value = null;
      status.value = "failed";
      error.value =
        typeof res.response?.data?.message === "string"
          ? res.response.data.message.slice(0, 500)
          : "";
      if (verified.value?.key === key) verified.value = null;
    }
  }

  /** The `tools_verified_at` to save: only when the saved endpoint is the one listed. */
  function verifiedAt(mcp: Mcp): number | undefined {
    return verified.value?.key === discoveryKey(mcp) ? verified.value.at : undefined;
  }

  return {
    tools,
    status,
    error,
    lists,
    discover,
    verifiedAt,
    setLists: options.setLists,
    remove: (entry: OtherEntry) =>
      options.setLists(removeEntry(formLists(options.mcp.value), entry)),
  };
}
