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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { VueQueryPlugin } from "@tanstack/vue-query";

const mocks = vi.hoisted(() => ({
  fetchAiChat: vi.fn(),
  confirmAiTool: vi.fn(),
  evaluate: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "org1" } } },
}));
vi.mock("@/composables/useAiChat", () => ({
  default: () => ({
    fetchAiChat: mocks.fetchAiChat,
    confirmAiTool: mocks.confirmAiTool,
    cancelAiChat: vi.fn(() => Promise.resolve()),
    getStructuredContext: async () => ({}),
    chatHistoryServer: () => ({ enabled: () => false }),
  }),
}));
vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: () => ({ adoptServerChat: vi.fn() }),
}));
vi.mock("@/services/alerts", () => ({ default: { evaluate: mocks.evaluate } }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: mocks.push, currentRoute: { value: { query: {} } } }),
}));

import AlertAiActions from "./AlertAiActions.vue";
import { useAlertAiDraft, type AlertAiDraft } from "./useAlertAiDraft";
import { queryClient } from "@/composables/query/queryClient";
import { readAlertPrefill } from "@/utils/alerts/alertPrefillStorage";

const SQL = 'SELECT vhost, COUNT(*) AS c FROM "nginx" GROUP BY vhost HAVING c > 5';
const args = {
  name: "nginx_5xx_per_vhost",
  stream_type: "logs",
  stream_name: "nginx",
  is_real_time: false,
  query_condition: { type: "sql", sql: SQL },
  trigger_condition: { period: 10, frequency: 5, threshold: 1, operator: ">=", silence: 10 },
  destinations: [],
};
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

let release: (approved: boolean) => void = () => undefined;
// The agent stays paused on its proposal until the confirm call answers it.
const pausedTurn = () => {
  const parts: Array<string | null> = [
    sse({
      type: "confirmation_required",
      tool: "CreateAlert",
      args: { org_id: "org1", request_body: args },
      message: "Create?",
    }),
    null,
  ];
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (!parts.length) return { done: true };
          const part = parts.shift();
          const text =
            part ??
            sse(
              {
                type: "tool_result",
                tool: "CreateAlert",
                success: await new Promise<boolean>((resolve) => (release = resolve)),
              },
              { type: "complete" },
            );
          return { done: false, value: new TextEncoder().encode(text) };
        },
      }),
    },
  };
};

const mountReady = async () => {
  let controller!: AlertAiDraft;
  const store = createStore({
    state: { selectedOrganization: { identifier: "org1" }, zoConfig: {} },
  });
  const w = mount(
    defineComponent({
      setup() {
        controller = useAlertAiDraft(() => "f1");
        return () => h(AlertAiActions, { controller, prompt: "nginx 5xx per vhost" });
      },
    }),
    { global: { plugins: [store, [VueQueryPlugin, { queryClient }]] } },
  );
  void controller.ai.start("nginx 5xx per vhost");
  await flushPromises();
  return { w, controller };
};

describe("AlertAiActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.fetchAiChat.mockResolvedValue(pausedTurn());
    mocks.confirmAiTool.mockImplementation(async (_o, _s, approved: boolean) => {
      setTimeout(() => release(approved));
      return true;
    });
    mocks.evaluate.mockResolvedValue({
      data: { end: 0, is_real_time: false, summary: { checks: 0, errors: 0 }, checks: [] },
    });
  });

  it("Create alert approves the checked proposal and refreshes the alert list once it is created", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { w } = await mountReady();
    expect(w.find("[data-test=alert-starter-ai-nobody-told]").exists()).toBe(true);

    await w.find("[data-test=alert-starter-ai-create]").trigger("click");
    await new Promise((resolve) => setTimeout(resolve));
    await flushPromises();

    expect({
      evaluated: mocks.evaluate.mock.calls[0]?.[1]?.alert?.query_condition?.sql,
      answers: mocks.confirmAiTool.mock.calls.map((c) => c[2]),
      created: w.findComponent(AlertAiActions).emitted("created")?.length,
      listRefreshed: invalidate.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown[] })?.queryKey) ===
          '["org","org1","alerts"]',
      ),
    }).toEqual({ evaluated: SQL, answers: [true], created: 1, listRefreshed: true });
  });

  it("Edit in form declines the proposal and opens the form with the assistant prefill", async () => {
    const { w } = await mountReady();
    await w.find("[data-test=alert-starter-ai-edit-in-form]").trigger("click");
    await flushPromises();

    const prefill = readAlertPrefill();
    expect({
      answers: mocks.confirmAiTool.mock.calls.map((c) => c[2]),
      route: mocks.push.mock.calls[0]?.[0].query.prefill,
      source: prefill?.source,
      stream: prefill?.streamName,
      opened: w.findComponent(AlertAiActions).emitted("opened")?.length,
    }).toEqual({
      answers: [false],
      route: "assistant",
      source: "assistant",
      stream: "nginx",
      opened: 1,
    });
  });
});
