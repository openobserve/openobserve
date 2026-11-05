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

import { vi } from "vitest";
import { computed } from "vue";

import type { ConfirmBody, ConfirmResponse, UndoResponse } from "@/services/assistant";
import type { ChatMessage } from "@/ts/interfaces/chat";
import type { TranslateFn } from "@/types/i18n";

import { createAssistantStore, inertAssistantDeps } from "../../assistantStore";
import type {
  AssistantCapability,
  AssistantStoreDeps,
  HostRegistry,
} from "../../assistantStore.types";
import { createDraftStore } from "../../drafts";
import type { ActionEnv } from "../registry";

export const CAPABILITY: AssistantCapability = {
  gate: "available",
  edition: "cloud",
  configured: true,
  health: "ok",
  canChat: "yes",
  canWrite: "yes",
  canShare: "yes",
  canShareRead: "yes",
  persistence: false,
  publicLinks: false,
  publicMaxExpiryDays: 30,
  creditMode: "pay_as_you_go",
  isAdmin: false,
  rcaEnabled: false,
  source: "heuristic",
  reasonCode: "available",
};

export const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as TranslateFn;

/** A real store with one session in `org1`, and an app whose router, tabs and services are spies. */
export function makeEnv(
  over: { messages?: ChatMessage[]; deps?: Partial<AssistantStoreDeps> } = {},
) {
  // Annotations persist per user and org, so a fresh env starts without a previous spec's.
  localStorage.clear();
  let n = 0;
  const deps = inertAssistantDeps({
    getOrg: () => ({ identifier: "org1", name: "Org 1" }),
    getUser: () => ({ email: "a@b.c", role: "admin" }),
    now: () => 1_000_000,
    uuid: () => `0190f3a0-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
    ...over.deps,
  });
  const store = createAssistantStore(deps, {
    drafts: createDraftStore({ delayMs: 0 }),
    viewportRem: () => 80,
  });
  store.setIdentity({ userOrgKey: "k1", org: "org1" });
  store.syncCapability(CAPABILITY);
  const sid = store.createSession({
    origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    thread: "new",
    ...(over.messages && { messages: over.messages }),
  });
  const hosts: HostRegistry = {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(() => undefined),
    has: vi.fn(() => false),
    mounted: computed(() => []),
  };
  const router = {
    push: vi.fn(async (_to: unknown) => undefined as unknown),
    resolve: vi.fn((to: { name: string }) => ({ href: `/web/${to.name}` })),
  };
  const env = {
    store: () => store,
    router: () => router,
    hosts,
    capability: vi.fn(() => CAPABILITY),
    currentOrg: vi.fn(() => "org1"),
    currentUser: vi.fn(() => "a@b.c"),
    now: () => 2_000_000,
    t,
    openTab: vi.fn(() => true),
    copy: vi.fn(async () => true),
    search: vi.fn(async () => ({}) as Record<string, unknown>),
    feedback: vi.fn(async () => undefined),
    confirm: vi.fn(
      async (_org: string, _sid: string, _body: ConfirmBody) => ({}) as ConfirmResponse,
    ),
    undo: vi.fn(async (_org: string, _ledgerId: string) => ({}) as UndoResponse),
    requestAlert: vi.fn(),
    requestDashboard: vi.fn(),
  } satisfies ActionEnv;
  return { env: env as unknown as ActionEnv & typeof env, store, sid, router, deps };
}
