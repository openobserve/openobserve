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
// The host (TraceDetails) sets the target and `open` in the same tick, so this
// drawer is CREATED with open already true. A plain (non-immediate) watcher on
// `open` never fires in that case and the picker renders "No options found"
// even when datasets exist — the bug these tests exist to prevent.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mockListDatasets = vi.fn();
const mockAddTelemetryItem = vi.fn();
const mockToast = vi.fn();

vi.mock("@/services/llm-datasets.service", () => ({
  default: {
    list: (...args: any[]) => mockListDatasets(...args),
    addTelemetryItem: (...args: any[]) => mockAddTelemetryItem(...args),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("@/types/i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

vi.mock("@/lib/overlay/Drawer/ODrawer.vue", () => ({
  default: {
    name: "ODrawer",
    props: ["open", "primaryButtonDisabled", "primaryButtonLoading"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: `<div class="o-drawer" :data-open="open" :data-primary-disabled="primaryButtonDisabled"><slot /></div>`,
  },
}));

vi.mock("@/lib/forms/Select/OSelect.vue", () => ({
  default: {
    name: "OSelect",
    props: ["modelValue", "options", "loading"],
    emits: ["update:model-value"],
    template: `<div class="o-select" :data-count="(options || []).length" :data-loading="loading" />`,
  },
}));

vi.mock("@/lib/forms/Input/OTextarea.vue", () => ({
  default: {
    name: "OTextarea",
    props: ["modelValue"],
    emits: ["update:model-value"],
    template: `<textarea class="o-textarea" />`,
  },
}));

vi.mock("@/lib/forms/TagInput/OTagInput.vue", () => ({
  default: { name: "OTagInput", props: ["modelValue"], template: `<div class="o-tag-input" />` },
}));

import AddToDatasetDrawer from "./AddToDatasetDrawer.vue";

const PROPS = {
  open: true,
  orgId: "test-org",
  refType: "span" as const,
  refId: "span-1",
  sourceStream: "default",
  refTraceStartTime: 1_700_000_000_000_000,
};

async function mountDrawer(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(AddToDatasetDrawer, { props: { ...PROPS, ...overrides } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mockListDatasets.mockReset().mockResolvedValue([
    { id: "ds-1", name: "RAG goldens" },
    { id: "ds-2", name: "Refund goldens" },
  ]);
  mockAddTelemetryItem.mockReset().mockResolvedValue({ id: "item-1" });
  mockToast.mockReset();
});

describe("AddToDatasetDrawer", () => {
  it("loads datasets when mounted already open", async () => {
    const wrapper = await mountDrawer();

    expect(mockListDatasets).toHaveBeenCalledWith("test-org");
    expect(wrapper.find(".o-select").attributes("data-count")).toBe("2");
  });

  it("does not load anything while closed", async () => {
    await mountDrawer({ open: false });

    expect(mockListDatasets).not.toHaveBeenCalled();
  });

  it("keeps Save disabled until a dataset and an answer are both given", async () => {
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;

    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("true");

    state.selectedDatasetId = "ds-1";
    await flushPromises();
    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("true");

    state.expectedOutput = "the golden answer";
    await flushPromises();
    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("false");
  });

  it("pushes the telemetry reference — never an input, which the server hydrates", async () => {
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;
    state.selectedDatasetId = "ds-1";
    state.expectedOutput = "  the golden answer  ";
    state.tags = ["refund"];
    await flushPromises();

    await state.submit();
    await flushPromises();

    expect(mockAddTelemetryItem).toHaveBeenCalledWith("test-org", "ds-1", {
      refType: "span",
      refId: "span-1",
      sourceStream: "default",
      refTraceStartTime: 1_700_000_000_000_000,
      expectedOutput: "the golden answer",
      tags: ["refund"],
    });
    expect(wrapper.emitted("added")?.[0]).toEqual(["ds-1"]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("surfaces a failed push and leaves the drawer open", async () => {
    mockAddTelemetryItem.mockRejectedValueOnce(new Error("nope"));
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;
    state.selectedDatasetId = "ds-1";
    state.expectedOutput = "answer";
    await flushPromises();

    await state.submit();
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });
});
