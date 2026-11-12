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

const listByFolderId = vi.fn();
const createAlert = vi.fn(async () => ({}));
const streamLists: Record<string, Array<{ name: string; settings: object }>> = {};

vi.mock("@/services/alerts", () => ({
  default: {
    listByFolderId: (...args: unknown[]) => listByFolderId(...args),
    create_by_alert_id: (...args: unknown[]) => createAlert(...(args as [])),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn(async (type: string) => ({ list: streamLists[type] ?? [] })),
  }),
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(async () => ({ data: [] })) },
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn(async () => [{ folderId: "f1", name: "AI agents" }]),
  createFolderByType: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: { selectedOrganization: { identifier: "o" }, userInfo: { email: "u" }, timezone: "UTC" },
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: object) =>
      params && typeof params === "object" ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AiAlertPackDialog from "./AiAlertPackDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

const ODialogStub = {
  props: ["open", "primaryButtonLabel", "primaryButtonDisabled"],
  emits: ["click:primary"],
  template: `<div><slot /><button data-test="primary" :disabled="primaryButtonDisabled"
    @click="$emit('click:primary')">{{ primaryButtonLabel }}</button></div>`,
};

async function mountDialog() {
  const wrapper = mount(AiAlertPackDialog, {
    props: { open: true, defaultStream: "default" },
    global: { stubs: { ODialog: ODialogStub, OSelect: true } },
  });
  await flushPromises();
  return wrapper;
}

const installed = (...names: string[]) => ({
  data: { list: names.map((name) => ({ name, stream_name: "default" })) },
});
const createdNames = () => createAlert.mock.calls.map((c: any[]) => c[1].name);

beforeEach(() => {
  vi.clearAllMocks();
  createAlert.mockImplementation(async () => ({}));
  streamLists.traces = [{ name: "default", settings: {} }];
  streamLists.logs = [];
});

describe("AiAlertPackDialog — alerts already installed", () => {
  it("marks an installed rule and installs only the others", async () => {
    listByFolderId.mockResolvedValue(installed("ai_failure_rate"));
    const wrapper = await mountDialog();

    const row = wrapper.find('[data-test="ai-alert-pack-rule-failure_rate"]');
    expect(row.find('[data-test="ai-alert-pack-rule-installed"]').exists()).toBe(true);
    await wrapper.find('[data-test="primary"]').trigger("click");
    await flushPromises();

    expect(createdNames()).not.toContain("ai_failure_rate");
    expect(createdNames()).toEqual(
      expect.arrayContaining(["ai_repeated_tool_calls", "ai_hourly_cost"]),
    );
  });

  it("offers nothing to install once every ready rule is there", async () => {
    listByFolderId.mockResolvedValue(
      installed(
        "ai_repeated_tool_calls",
        "ai_repeated_failing_tool_calls",
        "ai_failure_rate",
        "ai_hourly_cost",
      ),
    );
    const wrapper = await mountDialog();
    const button = wrapper.find('[data-test="primary"]');
    expect(button.text()).toBe("aiAlertPack.allInstalled");
    expect(button.attributes("disabled")).toBeDefined();
  });
});

describe("AiAlertPackDialog — each rule waits for its own stream", () => {
  it("installs the score rules when _llm_scores exists, but not the _evaluator one", async () => {
    listByFolderId.mockResolvedValue(installed());
    streamLists.logs = [{ name: "_llm_scores", settings: {} }];
    const wrapper = await mountDialog();

    const judge = wrapper.find('[data-test="ai-alert-pack-rule-eval_judge_error_rate"]');
    expect(judge.text()).not.toContain("aiAlertPack.runsNow");
    await wrapper.find('[data-test="primary"]').trigger("click");
    await flushPromises();

    expect(createdNames()).toEqual(
      expect.arrayContaining(["ai_evaluator_lag", "ai_eval_scores_stopped"]),
    );
    expect(createdNames()).not.toContain("ai_eval_judge_error_rate");
  });

  it("installs the judge rule once _evaluator exists", async () => {
    listByFolderId.mockResolvedValue(installed());
    streamLists.traces.push({ name: "_evaluator", settings: {} });
    const wrapper = await mountDialog();
    await wrapper.find('[data-test="primary"]').trigger("click");
    await flushPromises();
    expect(createdNames()).toContain("ai_eval_judge_error_rate");
  });

  it("says what each missing stream is: a trace stream, evaluator spans or scores", async () => {
    listByFolderId.mockResolvedValue(installed());
    streamLists.traces = [];
    const wrapper = await mountDialog();
    const badge = (id: string) => wrapper.find(`[data-test="ai-alert-pack-rule-${id}"]`).text();

    expect(badge("repeated_tool_calls")).toContain("aiAlertPack.waits.traceStream");
    expect(badge("cost")).toContain("aiAlertPack.waits.traceStream");
    expect(badge("eval_judge_error_rate")).toContain("aiAlertPack.waits.evaluator");
    expect(badge("evaluator_lag")).toContain("aiAlertPack.waits.scores");
    // No trace stream: guidance instead of a summary of alerts it cannot add.
    expect(wrapper.find('[data-test="ai-alert-pack-no-trace-stream"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-alert-pack-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="primary"]').attributes("disabled")).toBeDefined();
  });
});

describe("AiAlertPackDialog — after a partial install", () => {
  it("retries only the rules that failed", async () => {
    listByFolderId.mockResolvedValue(installed());
    createAlert.mockImplementation(async (...args: unknown[]) => {
      const payload = args[1] as { name: string }; // the create payload
      if (payload.name === "ai_hourly_cost") throw new Error("boom");
      return {};
    });
    const wrapper = await mountDialog();
    await wrapper.find('[data-test="primary"]').trigger("click");
    await flushPromises();
    const first = createdNames();
    expect(first).toContain("ai_hourly_cost");

    createAlert.mockClear();
    await wrapper.find('[data-test="primary"]').trigger("click");
    await flushPromises();
    expect(createdNames()).toEqual(["ai_hourly_cost"]);
    // The toast names the server's reason beside the rule.
    expect(JSON.stringify(vi.mocked(toast).mock.calls[0])).toContain("boom");
    expect(
      wrapper
        .find('[data-test="ai-alert-pack-rule-failure_rate"]')
        .find('[data-test="ai-alert-pack-rule-installed"]')
        .exists(),
    ).toBe(true);
  });
});
