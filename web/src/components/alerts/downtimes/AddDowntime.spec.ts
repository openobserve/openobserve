// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import AddDowntime from "./AddDowntime.vue";
import downtimes from "@/services/downtimes";

vi.mock("@/services/downtimes", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    preview: vi.fn(),
    resources: vi.fn(),
  },
}));

vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFoldersListByType: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/services/common", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      list_Folders: vi.fn(() => Promise.resolve({ data: { list: [] } })),
    },
  };
});

const EMPTY_PREVIEW = {
  alerts: [],
  resolved_at_fire_time: [],
  anomalies: [],
  synthetics: [],
  slos: [],
  alerts_total: 0,
  anomalies_total: 0,
  synthetics_total: 0,
  slos_total: 0,
};

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/downtimes", name: "downtimes", component: { template: "<div />" } },
      { path: "/downtimes/add", name: "addDowntime", component: AddDowntime },
      { path: "/downtimes/:id", name: "downtimeDetail", component: { template: "<div />" } },
    ],
  });

const mountPage = async () => {
  const router = makeRouter();
  await router.push({ name: "addDowntime", query: { org_identifier: "default" } });
  await router.isReady();
  const wrapper = mount(AddDowntime, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
};

// A click on the submit button runs the tab jump, then jsdom submits the page form.
const save = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get('[data-test="add-downtime-save"]').trigger("click");
  await flushPromises();
};

const tick = async (wrapper: ReturnType<typeof mount>, dataTest: string) => {
  const root = wrapper.get(`[data-test="${dataTest}"]`);
  const control = ["BUTTON", "INPUT"].includes(root.element.tagName)
    ? root
    : root.get("button, input");
  await control.trigger("click");
  await flushPromises();
};

describe("AddDowntime", () => {
  beforeEach(() => {
    vi.mocked(downtimes.preview).mockResolvedValue({ data: EMPTY_PREVIEW } as any);
    vi.mocked(downtimes.create).mockResolvedValue({ data: { id: "2f9K" } } as any);
    vi.mocked(downtimes.create).mockClear();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  it("refuses a whole-module downtime until the confirmation is ticked", async () => {
    const { wrapper } = await mountPage();
    await save(wrapper);
    expect(downtimes.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(
      "Tick the box to confirm that this downtime silences whole modules.",
    );
    wrapper.unmount();
  });

  it("creates the downtime once the confirmation is ticked", async () => {
    const { wrapper } = await mountPage();
    await tick(wrapper, "downtime-summary-confirm");
    await save(wrapper);
    expect(downtimes.create).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(downtimes.create).mock.calls[0];
    expect(body.targets).toEqual([{ module: "alerts", folders: { kind: "all" } }]);
    expect(body.schedule.repeat).toBe("none");
    expect(body).not.toHaveProperty("confirm_all");
    wrapper.unmount();
  });

  it("shows the condition rule under the builder when a row is empty", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('[data-test="downtime-condition-add"]').trigger("click");
    await flushPromises();
    await save(wrapper);
    expect(downtimes.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Choose a dimension for every row.");
    wrapper.unmount();
  });
});
