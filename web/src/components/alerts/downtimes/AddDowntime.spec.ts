// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import AddDowntime from "./AddDowntime.vue";
import downtimes from "@/services/downtimes";
import common from "@/services/common";
import { queryClient } from "@/composables/query/queryClient";
import { isoWeekday, utcMicrosToLocal } from "@/utils/downtimes/schedule";
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";

// The route guard opens this page only with downtimes on.
vi.mock("@/composables/downtimes/useDowntimesEnabled", async () => {
  const { computed } = await import("vue");
  return { useDowntimesEnabled: () => computed(() => true) };
});

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
    values: vi.fn(() => Promise.resolve({ data: { values: [], partial: false } })),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [{ name: "slack-oncall", type: "http" }] })),
    test: vi.fn(),
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
  // The submit can land a macrotask after the click, so a microtask flush alone may miss it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

// The first Save on a new downtime stops on an unseen schedule, so these open it first.
const seeSchedule = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get('[data-test="add-downtime-tab-schedule"]').trigger("click");
  await flushPromises();
};

describe("AddDowntime", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(common.list_Folders).mockImplementation(
      () => Promise.resolve({ data: { list: [] } }) as any,
    );
    vi.mocked(downtimes.preview).mockResolvedValue({ data: EMPTY_PREVIEW } as any);
    vi.mocked(downtimes.create).mockResolvedValue({ data: { id: "2f9K" } } as any);
    vi.mocked(downtimes.create).mockClear();
    vi.mocked(downtimes.preview).mockClear();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  const dialog = () =>
    document.body.querySelector<HTMLElement>('[data-test="add-downtime-mute-all-dialog"]');
  const dialogButton = async (which: "primary" | "secondary") => {
    dialog()!.querySelector<HTMLButtonElement>(`[data-test="o-dialog-${which}-btn"]`)!.click();
    await flushPromises();
  };

  it("asks before muting a whole module and names the impact", async () => {
    vi.mocked(downtimes.preview).mockResolvedValue({
      data: { ...EMPTY_PREVIEW, alerts_total: 12 },
    } as any);
    const { wrapper } = await mountPage();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();
    await seeSchedule(wrapper);
    await save(wrapper);
    expect(downtimes.create).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("Mute every alert in this org?");
    expect(dialog()?.textContent).toContain("Every alert in this organization");
    expect(dialog()?.textContent).toContain("12 alerts today");
    expect(dialog()?.textContent).toContain("Mute all");
    wrapper.unmount();
  });

  it("saves nothing when the dialog is cancelled", async () => {
    const { wrapper } = await mountPage();
    await seeSchedule(wrapper);
    await save(wrapper);
    await dialogButton("secondary");
    expect(downtimes.create).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it("creates the downtime once Mute all is confirmed", async () => {
    const { wrapper } = await mountPage();
    await seeSchedule(wrapper);
    await save(wrapper);
    await dialogButton("primary");
    expect(downtimes.create).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(downtimes.create).mock.calls[0];
    expect(body.targets).toEqual([{ module: "alerts", folders: { kind: "all" } }]);
    expect(body.schedule.repeat).toBe("none");
    wrapper.unmount();
  });

  it("files a new downtime in the first folder a folder-scoped user may use", async () => {
    vi.mocked(common.list_Folders).mockImplementation(
      (_org: string, type: string) =>
        Promise.resolve({
          data: {
            list:
              type === "downtimes" ? [{ folderId: "payments", name: "Payments maintenance" }] : [],
          },
        }) as any,
    );
    const { wrapper } = await mountPage();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();
    const folders = vi.mocked(downtimes.preview).mock.calls.map((call) => call[2]);
    expect(folders.length).toBeGreaterThan(0);
    expect(folders.every((f) => f === "payments")).toBe(true);
    await seeSchedule(wrapper);
    await save(wrapper);
    await dialogButton("primary");
    const [, body] = vi.mocked(downtimes.create).mock.calls[0];
    expect(body.folder_id).toBe("payments");
    wrapper.unmount();
  });

  it("keeps the last preview and asks to finish the condition while a row is incomplete", async () => {
    vi.mocked(downtimes.preview).mockResolvedValue({
      data: {
        ...EMPTY_PREVIEW,
        alerts: [{ id: "a1", name: "payments-api-errors" }],
        alerts_total: 1,
      },
    } as any);
    const { wrapper } = await mountPage();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();
    expect(wrapper.text()).toContain("payments-api-errors");
    const calls = vi.mocked(downtimes.preview).mock.calls.length;
    await wrapper.get('[data-test="downtime-condition-add"]').trigger("click");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();
    expect(wrapper.find('[data-test="add-downtime-preview-incomplete"]').text()).toBe(
      "Finish the condition to see a preview.",
    );
    expect(wrapper.text()).toContain("payments-api-errors");
    expect(vi.mocked(downtimes.preview).mock.calls.length).toBe(calls);
    wrapper.unmount();
  });

  it("notifies nobody until a destination is picked", async () => {
    const { wrapper } = await mountPage();
    const section = wrapper.get('[data-test="downtime-notify"]');
    expect(section.text()).toContain("Notify");
    expect(section.text()).toContain("Before it ends");
    expect(wrapper.find('[data-test="downtime-notify-lead"]').exists()).toBe(false);
    await seeSchedule(wrapper);
    await save(wrapper);
    await dialogButton("primary");
    const [, body] = vi.mocked(downtimes.create).mock.calls[0];
    expect(body.notifications).toBeUndefined();
    wrapper.unmount();
  });

  it("turns on the reminder and the end with the first destination and saves them", async () => {
    const { wrapper } = await mountPage();
    wrapper.findComponent(AlertDestinationsField).vm.$emit("update:destinations", ["slack-oncall"]);
    await flushPromises();
    expect(wrapper.find('[data-test="downtime-notify-lead"]').exists()).toBe(true);
    await seeSchedule(wrapper);
    await save(wrapper);
    await dialogButton("primary");
    const [, body] = vi.mocked(downtimes.create).mock.calls[0];
    expect(body.notifications).toEqual({
      destinations: ["slack-oncall"],
      events: { started: false, ending_soon: true, ended: true, cancelled: false, extended: false },
      ending_soon_lead_secs: 600,
    });
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

  it("saves nothing on two Enters in the name field", async () => {
    const { wrapper } = await mountPage();
    await seeSchedule(wrapper);
    await wrapper.get('[data-test="add-downtime-name-trigger"]').trigger("click");
    await wrapper.get('[data-test="add-downtime-name-input"]').setValue("Deploy");
    await wrapper.get('[data-test="add-downtime-name-input"]').trigger("keydown.enter");
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (document.activeElement as HTMLElement | null)?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(dialog()).toBeNull();
    expect(downtimes.create).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("focuses Cancel in the mute-all dialog, so Enter there saves nothing", async () => {
    const { wrapper } = await mountPage();
    await seeSchedule(wrapper);
    await save(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    const cancel = dialog()!.querySelector('[data-test="o-dialog-secondary-btn"]');
    expect(document.activeElement).toBe(cancel);
    wrapper.unmount();
  });

  it("shows the unseen schedule on the first Save and its window in the dialog", async () => {
    const { wrapper } = await mountPage();
    await save(wrapper);
    expect(dialog()).toBeNull();
    expect(downtimes.create).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="add-downtime-check-schedule"]').exists()).toBe(true);
    expect(wrapper.get('[data-tab-pane="schedule"]').isVisible()).toBe(true);
    await save(wrapper);
    expect(
      dialog()?.querySelector('[data-test="add-downtime-mute-all-window"]')?.textContent,
    ).toMatch(/^\s*Window: Once · /);
    wrapper.unmount();
  });

  it("titles a new downtime with its generated name as soon as it has a target", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.get('[data-test="add-downtime-name-value"]').text()).toMatch(
      /^All alerts · once /,
    );
    wrapper.unmount();
  });

  it("picks today's weekday and shows Starts on when the repeat becomes weekly", async () => {
    const { wrapper } = await mountPage();
    await seeSchedule(wrapper);
    await wrapper.get('[data-test="downtime-schedule-repeat-weekly"]').trigger("click");
    await flushPromises();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const today = utcMicrosToLocal(Date.now() * 1000, zone).date;
    const day = wrapper.get(`[data-test="downtime-schedule-weekday-${isoWeekday(today)}"]`);
    expect(day.attributes("data-state")).toBe("on");
    expect(wrapper.find('[data-test="downtime-schedule-starts-on"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
