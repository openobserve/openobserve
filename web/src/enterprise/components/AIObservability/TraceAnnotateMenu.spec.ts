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
//
// @vitest-environment jsdom
//
// Annotate is a one-field decision, so it drops off the button rather than
// opening a form: these tests pin that the queue list loads only when the menu
// opens, and that the enqueue carries the reference the review API needs.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mockListQueues = vi.fn();
const mockAddToQueue = vi.fn();
const mockToast = vi.fn();

vi.mock("@/services/llm-queues.service", () => ({
  default: { list: (...args: any[]) => mockListQueues(...args) },
}));

vi.mock("@/services/llm-discovery.service", () => ({
  default: { addToQueue: (...args: any[]) => mockAddToQueue(...args) },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "test-org" } } }),
}));

vi.mock("./AddToQueueMenu.vue", () => ({
  default: {
    name: "AddToQueueMenu",
    props: ["scope", "queues", "loading", "busy", "label", "variant", "dataTest"],
    emits: ["select", "open"],
    template: `<button class="add-to-queue-menu" :data-scope="scope"
      :data-queues="(queues || []).length" :data-busy="busy" @click="$emit('open')" />`,
  },
}));

import TraceAnnotateMenu from "./TraceAnnotateMenu.vue";

const PROPS = {
  refType: "span" as const,
  refId: "span-1",
  refTraceId: "trace-1",
  refTraceStartTime: 1_700_000_000_000_000,
};

async function mountMenu(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(TraceAnnotateMenu, { props: { ...PROPS, ...overrides } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mockListQueues.mockReset().mockResolvedValue([{ id: "q1", name: "Safety", allowedRefTypes: [] }]);
  mockAddToQueue.mockReset().mockResolvedValue(1);
  mockToast.mockReset();
});

describe("TraceAnnotateMenu", () => {
  it("does not touch the queues API until the menu is opened", async () => {
    const wrapper = await mountMenu();

    expect(mockListQueues).not.toHaveBeenCalled();

    await wrapper.find(".add-to-queue-menu").trigger("click");
    await flushPromises();

    expect(mockListQueues).toHaveBeenCalledWith("test-org");
    expect(wrapper.find(".add-to-queue-menu").attributes("data-queues")).toBe("1");
  });

  it("loads the queue list at most once", async () => {
    const wrapper = await mountMenu();

    await wrapper.find(".add-to-queue-menu").trigger("click");
    await flushPromises();
    await wrapper.find(".add-to-queue-menu").trigger("click");
    await flushPromises();

    expect(mockListQueues).toHaveBeenCalledTimes(1);
  });

  it("passes the scope down so ineligible queues are filtered by the menu", async () => {
    const spanMenu = await mountMenu();
    expect(spanMenu.find(".add-to-queue-menu").attributes("data-scope")).toBe("span");

    const traceMenu = await mountMenu({ refType: "trace", refId: "trace-1" });
    expect(traceMenu.find(".add-to-queue-menu").attributes("data-scope")).toBe("trace");
  });

  it("enqueues with the trace reference and reports it", async () => {
    const wrapper = await mountMenu();
    const queue = { id: "q1", name: "Safety", allowedRefTypes: [] };

    await (wrapper.vm as any).$.setupState.enqueue(queue);
    await flushPromises();

    expect(mockAddToQueue).toHaveBeenCalledWith("test-org", "q1", [
      {
        scope: "span",
        targetId: "span-1",
        traceId: "trace-1",
        refTimestamp: 1_700_000_000_000_000,
      },
    ]);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect(wrapper.emitted("annotated")?.[0]).toEqual([queue]);
  });

  it("surfaces a failed enqueue", async () => {
    mockAddToQueue.mockRejectedValueOnce(new Error("nope"));
    const wrapper = await mountMenu();

    await (wrapper.vm as any).$.setupState.enqueue({ id: "q1", name: "Safety" });
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(wrapper.emitted("annotated")).toBeUndefined();
  });
});
