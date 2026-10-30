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
// Direct annotation has no bound dimension set and no N/N rule (that is the
// queue Workbench's contract), so what matters here is: dimensions are picked
// freely, only FILLED ones are written, and each score carries the pinned
// version's row id — the only identifier the annotations API accepts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const mockListConfigs = vi.fn();
const mockAnnotate = vi.fn();
const mockToast = vi.fn();

vi.mock("@/services/llm-queues.service", () => ({
  default: { listScoreConfigOptions: (...args: any[]) => mockListConfigs(...args) },
}));

vi.mock("@/services/llm-annotations.service", () => ({
  default: { annotate: (...args: any[]) => mockAnnotate(...args) },
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

vi.mock("@/lib/overlay/Drawer/ODrawer.vue", () => ({
  default: {
    name: "ODrawer",
    props: ["open", "primaryButtonDisabled"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: `<div class="o-drawer" :data-primary-disabled="primaryButtonDisabled"><slot /></div>`,
  },
}));

vi.mock("@/lib/forms/Select/OSelect.vue", () => ({
  default: {
    name: "OSelect",
    props: ["modelValue", "options", "loading"],
    emits: ["update:model-value"],
    template: `<div class="o-select" :data-count="(options || []).length" />`,
  },
}));

vi.mock("@/lib/forms/Slider/OSlider.vue", () => ({
  default: { name: "OSlider", props: ["modelValue", "min", "max", "step"], template: `<div />` },
}));
vi.mock("@/lib/forms/Radio/ORadioGroup.vue", () => ({
  default: { name: "ORadioGroup", props: ["modelValue"], template: `<div><slot /></div>` },
}));
vi.mock("@/lib/forms/Radio/ORadio.vue", () => ({
  default: { name: "ORadio", props: ["value", "label"], template: `<div />` },
}));
vi.mock("@/lib/forms/Input/OTextarea.vue", () => ({
  default: { name: "OTextarea", props: ["modelValue"], template: `<textarea />` },
}));

import AnnotateDrawer from "./AnnotateDrawer.vue";

const CONFIGS = [
  {
    id: "cfg-faith",
    name: "faithfulness",
    dataType: "numeric",
    versions: [1, 2],
    latestVersion: 2,
    versionDetails: {
      2: {
        rowId: "row-faith-v2",
        numericRange: { min: 0, max: 1 },
        healthyThreshold: { min: 0.7 },
      },
    },
  },
  {
    id: "cfg-sev",
    name: "hallucination_severity",
    dataType: "categorical",
    categories: ["none", "minor", "major"],
    versions: [1],
    latestVersion: 1,
    versionDetails: { 1: { rowId: "row-sev-v1", categories: ["none", "minor", "major"] } },
  },
];

const PROPS = {
  open: true,
  scope: "span" as const,
  targetId: "span-1",
  traceId: "trace-1",
  refTimestamp: 1_700_000_000_000_000,
  sourceStream: "default",
};

async function mountDrawer(overrides: Record<string, unknown> = {}) {
  const wrapper = mount(AnnotateDrawer, { props: { ...PROPS, ...overrides } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  mockListConfigs.mockReset().mockResolvedValue(CONFIGS);
  mockAnnotate.mockReset().mockResolvedValue({ annotationId: "ann-1", scoreIds: ["s1"] });
  mockToast.mockReset();
});

describe("AnnotateDrawer", () => {
  it("loads score configs when mounted already open", async () => {
    const wrapper = await mountDrawer();

    expect(mockListConfigs).toHaveBeenCalledWith("test-org");
    expect(wrapper.find(".o-select").attributes("data-count")).toBe("2");
  });

  it("starts with nothing to score and Save disabled", async () => {
    const wrapper = await mountDrawer();

    expect(wrapper.find('[data-test="annotate-drawer-empty"]').exists()).toBe(true);
    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("true");
  });

  it("adds a dimension at its latest pinned version and drops it from the picker", async () => {
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;

    state.addDimension("cfg-faith");
    await flushPromises();

    expect(state.picked[0]).toMatchObject({
      id: "cfg-faith",
      rowId: "row-faith-v2",
      version: 2,
      min: 0,
      max: 1,
      healthyMin: 0.7,
    });
    // Already picked, so it is no longer offered.
    expect(wrapper.find(".o-select").attributes("data-count")).toBe("1");
  });

  it("keeps Save disabled until a picked dimension actually has a value", async () => {
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;

    state.addDimension("cfg-faith");
    await flushPromises();
    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("true");

    state.setValue("row-faith-v2", 0.3);
    await flushPromises();
    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("false");
  });

  it("writes only filled dimensions, typed per data type, in one annotation", async () => {
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;

    state.addDimension("cfg-faith");
    state.addDimension("cfg-sev");
    await flushPromises();
    state.setValue("row-faith-v2", 0.3);
    state.reasons["row-faith-v2"] = "  invents a policy  ";
    await flushPromises();

    await state.save();
    await flushPromises();

    expect(mockAnnotate).toHaveBeenCalledTimes(1);
    const [org, payload] = mockAnnotate.mock.calls[0];
    expect(org).toBe("test-org");
    expect(payload).toMatchObject({
      scope: "span",
      targetId: "span-1",
      traceId: "trace-1",
      refTimestamp: 1_700_000_000_000_000,
      sourceStream: "default",
    });
    // hallucination_severity was picked but never filled — it must not be written.
    expect(payload.scores).toEqual([
      { scoreConfigRowId: "row-faith-v2", value: 0.3, reasoning: "  invents a policy  " },
    ]);
    expect(wrapper.emitted("annotated")).toHaveLength(1);
  });

  it("removing a dimension clears its value", async () => {
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;

    state.addDimension("cfg-faith");
    await flushPromises();
    state.setValue("row-faith-v2", 0.9);
    state.removeDimension("row-faith-v2");
    await flushPromises();

    expect(state.picked).toHaveLength(0);
    expect(wrapper.find(".o-drawer").attributes("data-primary-disabled")).toBe("true");
  });

  it("surfaces a failed save and keeps the drawer open", async () => {
    mockAnnotate.mockRejectedValueOnce(new Error("nope"));
    const wrapper = await mountDrawer();
    const state = (wrapper.vm as any).$.setupState;
    state.addDimension("cfg-faith");
    await flushPromises();
    state.setValue("row-faith-v2", 0.3);

    await state.save();
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });
});
