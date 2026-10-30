// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const listDatasets = vi.fn();
const listItems = vi.fn();
vi.mock("@/services/llm-datasets.service", () => ({
  default: {
    list: (...a: any[]) => listDatasets(...a),
    listItems: (...a: any[]) => listItems(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));

import RemoteTaskTestPanel from "./RemoteTaskTestPanel.vue";

const report = {
  rawRequest: '{"input":"hi"}',
  rawResponse: '{"output":"there"}',
  statusCode: 200,
  latencyMs: 42,
};

const OButtonStub = {
  emits: ["click"],
  props: ["disabled"],
  template: `<button v-bind="$attrs" :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
};

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(RemoteTaskTestPanel, {
    props: {
      orgId: "acme",
      input: "",
      metadata: "",
      canRun: true,
      state: "idle",
      report: null,
      errorMessage: null,
      ...props,
    },
    global: { stubs: { OButton: OButtonStub } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listDatasets.mockResolvedValue([{ id: "ds-1", name: "RAG regression set" }]);
});

describe("RemoteTaskTestPanel", () => {
  it("asks the page to run rather than calling anything itself", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-run-btn"]').trigger("click");
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("will not run until the configuration means something", async () => {
    const wrapper = mountPanel({ canRun: false });
    await flushPromises();
    expect(
      wrapper.get('[data-test="ai-remote-task-test-run-btn"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find('[data-test="ai-remote-task-test-disabled-hint"]').exists()).toBe(true);
  });

  // The sample is owned by the page, because the footer's primary button runs
  // the same test this panel does.
  it("reports edits upward instead of keeping its own copy", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-input"] textarea').setValue("what is 2 + 2");
    expect(wrapper.emitted("update:input")?.at(-1)).toEqual(["what is 2 + 2"]);
  });

  // The picker is a convenience the client builds: it reads one item and fills
  // the field, so what gets sent is still exactly what is on screen.
  it("fills the input from one dataset row", async () => {
    listItems.mockResolvedValue({ items: [{ input: "sampled question" }] });
    const wrapper = mountPanel();
    await flushPromises();

    await (wrapper.vm as any).onDatasetPicked("ds-1");
    await flushPromises();

    expect(listItems).toHaveBeenCalledWith("acme", "ds-1", { from: 0, size: 1 });
    expect(wrapper.emitted("update:input")?.at(-1)).toEqual(["sampled question"]);
  });

  it("says so when the chosen dataset has nothing to sample", async () => {
    listItems.mockResolvedValue({ items: [] });
    const wrapper = mountPanel();
    await flushPromises();
    await (wrapper.vm as any).onDatasetPicked("ds-1");
    await flushPromises();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    expect(wrapper.emitted("update:input")).toBeUndefined();
  });

  it("shows nothing but an explanation before the first run", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.find('[data-test="ai-remote-task-test-idle"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-remote-task-test-result"]').exists()).toBe(false);
  });

  // The raw exchange is what actually helps when someone else's service says no,
  // so it is present on failure, not only on success.
  it("shows the exchange and the reason on a failure", async () => {
    const wrapper = mountPanel({
      state: "failed",
      report,
      errorMessage: "Response has no value at '$.output'",
    });
    await flushPromises();
    expect(wrapper.get('[data-test="ai-remote-task-test-error"]').text()).toContain("$.output");
    expect(wrapper.get('[data-test="ai-remote-task-test-raw-request"]').text()).toContain("input");
    expect(wrapper.get('[data-test="ai-remote-task-test-raw-response"]').text()).toContain(
      "output",
    );
  });

  it("shows the extracted output and the latency on a pass", async () => {
    const wrapper = mountPanel({ state: "passed", report: { ...report, parsedOutput: "there" } });
    await flushPromises();
    expect(wrapper.get('[data-test="ai-remote-task-test-output"]').text()).toContain("there");
    expect(wrapper.get('[data-test="ai-remote-task-test-result"]').text()).toContain("42 ms");
    expect(wrapper.get('[data-test="ai-remote-task-test-result"]').text()).toContain("200");
  });
});
