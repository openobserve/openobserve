// Copyright 2026 OpenObserve Inc.
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const testRun = vi.fn();
vi.mock("@/services/remote-tasks.service", () => ({
  default: { testRun: (...a: any[]) => testRun(...a) },
}));
const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));

import RemoteTaskTestRunPanel from "./RemoteTaskTestRunPanel.vue";

const OButtonStub = {
  emits: ["click"],
  props: ["disabled"],
  template: `<button v-bind="$attrs" :disabled="disabled" @click="$emit('click', $event)"><slot /></button>`,
};
const OTableStub = {
  props: ["data", "columns"],
  template: `<table><tbody><tr v-for="row in data" :key="row.rowId">
    <td v-for="column in columns" :key="column.id">
      <slot :name="'cell-' + column.id" :row="row">{{ row[column.accessorKey] }}</slot>
    </td></tr></tbody></table>`,
};

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(RemoteTaskTestRunPanel, {
    props: { orgId: "acme", entityId: "head-1", canRun: true, maxAttempts: 3, ...props },
    global: { stubs: { OButton: OButtonStub, OTable: OTableStub } },
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    rowId: "sample-1",
    input: "hi",
    status: "ok",
    parsedOutput: "there",
    rawRequest: "{}",
    rawResponse: "{}",
    httpStatus: 200,
    latencyMs: 120,
    attempts: 1,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("RemoteTaskTestRunPanel", () => {
  // The bench always runs the latest PUBLISHED version, so a head that has never
  // published one has nothing to run against.
  it("explains itself instead of offering a run with no published version", () => {
    const wrapper = mountPanel({ canRun: false });
    expect(wrapper.find('[data-test="ai-remote-task-test-run-blocked"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-remote-task-test-run-btn"]').exists()).toBe(false);
  });

  it("will not run with nothing to send", async () => {
    const wrapper = mountPanel();
    expect(
      wrapper.get('[data-test="ai-remote-task-test-run-btn"]').attributes("disabled"),
    ).toBeDefined();
    (wrapper.vm as any).samples = ["hello"];
    await flushPromises();
    expect(
      wrapper.get('[data-test="ai-remote-task-test-run-btn"]').attributes("disabled"),
    ).toBeUndefined();
  });

  // Ten is the server's own cap; stopping here turns a guaranteed 400 into a
  // disabled button.
  it("stops adding samples at the server's limit", async () => {
    const wrapper = mountPanel();
    for (let i = 0; i < 20; i += 1) {
      await wrapper.get('[data-test="ai-remote-task-test-run-add"]').trigger("click");
    }
    await flushPromises();
    expect((wrapper.vm as any).samples).toHaveLength(10);
    expect(
      wrapper.get('[data-test="ai-remote-task-test-run-add"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("keeps at least one sample row", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-test="ai-remote-task-test-run-remove-0"]').trigger("click");
    await flushPromises();
    expect((wrapper.vm as any).samples).toHaveLength(1);
  });

  // Deleting a NON-LAST row must shift the remaining values, not the bindings.
  it("removes the row the operator pointed at", async () => {
    const wrapper = mountPanel();
    (wrapper.vm as any).samples = ["a", "b", "c"];
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-run-remove-1"]').trigger("click");
    await flushPromises();
    expect((wrapper.vm as any).samples).toEqual(["a", "c"]);
  });

  it("sends only the filled samples, each with a stable handle", async () => {
    testRun.mockResolvedValue([]);
    const wrapper = mountPanel();
    (wrapper.vm as any).samples = ["first", "  ", '{"q":2}'];
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-run-btn"]').trigger("click");
    await flushPromises();

    expect(testRun).toHaveBeenCalledWith("acme", "head-1", [
      { rowId: "sample-1", input: "first" },
      { rowId: "sample-3", input: { q: 2 } },
    ]);
  });

  // The bench runs the registered retry policy, so a retried sample has to read
  // as one — a bare "1" would describe a different task than the one under test.
  it("reports how many attempts a sample took, against the policy", async () => {
    testRun.mockResolvedValue([row({ attempts: 3 })]);
    const wrapper = mountPanel();
    (wrapper.vm as any).samples = ["hello"];
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-run-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("3 of 3");
    expect(wrapper.text()).toContain("120 ms");
  });

  it("shows the reason on an errored sample instead of a blank output", async () => {
    testRun.mockResolvedValue([
      row({ status: "error", parsedOutput: undefined, error: "remote task 504" }),
    ]);
    const wrapper = mountPanel();
    (wrapper.vm as any).samples = ["hello"];
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-run-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("remote task 504");
  });

  it("reports a failed run", async () => {
    testRun.mockRejectedValue({ response: { data: { message: "nope" } } });
    const wrapper = mountPanel();
    (wrapper.vm as any).samples = ["hello"];
    await flushPromises();
    await wrapper.get('[data-test="ai-remote-task-test-run-btn"]').trigger("click");
    await flushPromises();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "nope" }),
    );
  });
});
