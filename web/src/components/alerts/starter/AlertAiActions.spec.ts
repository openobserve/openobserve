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
      return { ok: true, status: 200, body: {} };
    });
    mocks.evaluate.mockResolvedValue({
      data: { end: 0, is_real_time: false, summary: { checks: 0, errors: 0 }, checks: [] },
    });
  });

  it.each([
    { name: "nobody", who: [] as string[] },
    { name: "an edited list", who: ["oncall-webhook"] },
  ])(
    "Create alert approves with Who to tell as shown ($name) and refreshes the list",
    async (c) => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const { w, controller } = await mountReady();
      controller.setDestinations(c.who);
      await flushPromises();
      expect(w.find("[data-test=alert-starter-ai-nobody-told]").exists()).toBe(!c.who.length);

      await w.find("[data-test=alert-starter-ai-create]").trigger("click");
      await new Promise((resolve) => setTimeout(resolve));
      await flushPromises();

      expect({
        evaluated: mocks.evaluate.mock.calls[0]?.[1]?.alert?.query_condition?.sql,
        sent: mocks.confirmAiTool.mock.calls.map((call) => call.slice(2)),
        created: w.findComponent(AlertAiActions).emitted("created")?.length,
        listRefreshed: invalidate.mock.calls.some(
          ([filters]) =>
            JSON.stringify((filters as { queryKey?: unknown[] })?.queryKey) ===
            '["org","org1","alerts"]',
        ),
      }).toEqual({
        evaluated: SQL,
        sent: [[true, { destinations: c.who }]],
        created: 1,
        listRefreshed: true,
      });
    },
  );

  const unknownDetail = {
    code: "unknown_destinations",
    unknown: ["no-such-dest"],
    message: "No destination named no-such-dest in this organization. Nothing was created.",
  };
  it.each([
    {
      name: "a 422",
      status: 422,
      body: { detail: unknownDetail },
      pending: true,
      says: "no-such-dest",
    },
    {
      name: "a relayed 500",
      status: 500,
      body: {
        code: 500,
        message: `Confirmation failed: ${JSON.stringify({ detail: unknownDetail })}`,
      },
      pending: true,
      says: "no-such-dest",
    },
    {
      name: "unchecked destinations",
      status: 503,
      body: {
        detail: { code: "destinations_unchecked", message: "Destinations could not be checked" },
      },
      pending: true,
      says: "Destinations could not be checked",
    },
    {
      name: "any other failure",
      status: 500,
      body: { message: "boom" },
      pending: false,
      says: null,
    },
  ])("a refused Create on $name", async (c) => {
    const { w, controller } = await mountReady();
    mocks.confirmAiTool.mockResolvedValueOnce({ ok: false, status: c.status, body: c.body });
    await w.find("[data-test=alert-starter-ai-create]").trigger("click");
    await flushPromises();

    const refused = controller.ai.refused.value;
    expect({
      phase: controller.ai.phase.value,
      canCreateAgain: w.find("[data-test=alert-starter-ai-create]").exists(),
      says: refused === null ? null : refused.includes(c.says ?? "") && c.says,
    }).toEqual({
      phase: c.pending ? "ready" : "failed",
      canCreateAgain: c.pending,
      says: c.says,
    });
  });

  it("Edit in form declines the proposal and opens the form with the edited prefill", async () => {
    const { w, controller } = await mountReady();
    controller.setDestinations(["oncall-webhook"]);
    await w.find("[data-test=alert-starter-ai-edit-in-form]").trigger("click");
    await flushPromises();

    const prefill = readAlertPrefill();
    expect({
      answers: mocks.confirmAiTool.mock.calls.map((c) => c[2]),
      route: mocks.push.mock.calls[0]?.[0].query.prefill,
      source: prefill?.source,
      stream: prefill?.streamName,
      who: prefill?.meta?.destinations,
      opened: w.findComponent(AlertAiActions).emitted("opened")?.length,
    }).toEqual({
      answers: [false],
      route: "assistant",
      source: "assistant",
      stream: "nginx",
      who: ["oncall-webhook"],
      opened: 1,
    });
  });
});
