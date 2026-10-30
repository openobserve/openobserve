// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import DowntimeDetail from "./DowntimeDetail.vue";
import downtimes, { type DowntimeDetail as Detail } from "@/services/downtimes";
import destination from "@/services/alert_destination";
import template from "@/services/alert_templates";
import { queryClient } from "@/composables/query/queryClient";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";

vi.mock("@/services/downtimes", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    extend: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    preview: vi.fn(),
    resources: vi.fn(),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), test: vi.fn() },
}));

vi.mock("@/services/alert_templates", () => ({
  default: { get_by_name: vi.fn() },
}));

vi.mock("@/services/alerts", () => ({
  default: { getHistory: vi.fn(() => Promise.resolve({ data: { hits: [], total: 0 } })) },
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

const HOUR = 3_600_000_000;
const NOW = Date.now() * 1000;

const DETAIL = {
  id: "2f9K",
  org: "default",
  folder_id: "default",
  name: "Nightly deploy",
  targets: [{ module: "alerts", folders: { kind: "all" } }],
  schedule: {
    repeat: "none",
    starts_at: NOW + HOUR,
    ends_at: NOW + 2 * HOUR,
    timezone: "UTC",
    duration_secs: 3600,
    weekdays: [],
  },
  show_banner: false,
  notifications: {
    destinations: ["slack-oncall"],
    events: { started: true, ending_soon: true, ended: true, cancelled: false, extended: false },
    ending_soon_lead_secs: 600,
  },
  created_by: "lin@example.com",
  created_at: 0,
  updated_by: "lin@example.com",
  updated_at: 0,
  status: "scheduled",
  current_window: null,
  next_window: { start: NOW + HOUR, end: NOW + 2 * HOUR },
  matched_alerts: 3,
  matched_anomalies: 0,
  matched_synthetics: 0,
  matched_slos: 0,
  affected: { alerts: [], anomalies: [], synthetics: [], slos: [] },
  notification_log: [
    {
      window_start: NOW - 24 * HOUR,
      event: "ended",
      sent_at: NOW - 23 * HOUR,
      destinations: ["slack-oncall"],
      result: "slack-oncall: 500 Internal Server Error",
    },
    {
      window_start: NOW - 24 * HOUR,
      event: "started",
      sent_at: NOW - 24 * HOUR,
      destinations: ["slack-oncall"],
      result: "ok",
    },
  ],
} as unknown as Detail;

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/downtimes", name: "downtimes", component: { template: "<div />" } },
      { path: "/downtimes/:id", name: "downtimeDetail", component: DowntimeDetail },
      { path: "/downtimes/:id/edit", name: "editDowntime", component: { template: "<div />" } },
    ],
  });

const mountDetail = async () => {
  const router = makeRouter();
  await router.push({
    name: "downtimeDetail",
    params: { id: "2f9K" },
    query: { org_identifier: "default" },
  });
  await router.isReady();
  const wrapper = mount(DowntimeDetail, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  wrapper.findComponent(OTabs).vm.$emit("update:modelValue", "notifications");
  await flushPromises();
  return wrapper;
};

describe("DowntimeDetail notifications tab", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.get).mockResolvedValue({ data: DETAIL } as any);
    vi.mocked(destination.list).mockResolvedValue({
      data: [
        { name: "slack-oncall", type: "http", url: "https://hooks.example.com", method: "post" },
      ],
    } as any);
    vi.mocked(template.get_by_name).mockResolvedValue({
      data: { body: '{"text": "{downtime_name}: {downtime_event}"}' },
    } as any);
    vi.mocked(destination.test).mockReset();
    vi.mocked(destination.test).mockResolvedValue({ data: { success: true } } as any);
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  it("lists the sends newest first with their event, destinations and result", async () => {
    const wrapper = await mountDetail();
    const tab = wrapper.get('[data-test="downtime-detail-notifications"]');
    expect(tab.text()).toContain("Notifies slack-oncall: when it starts, 10 min before it ends");
    const text = wrapper.get('[data-test="downtime-detail-notifications-table"]').text();
    expect(text).toContain("Ended");
    expect(text).toContain("slack-oncall: 500 Internal Server Error");
    expect(text).toContain("Started");
    expect(text).toContain("Sent");
    expect(text.indexOf("Ended")).toBeLessThan(text.indexOf("Started"));
    wrapper.unmount();
  });

  it("sends the started message through the destination test path", async () => {
    const wrapper = await mountDetail();
    await wrapper.get('[data-test="downtime-detail-send-test"]').trigger("click");
    await flushPromises();
    expect(template.get_by_name).toHaveBeenCalledWith({
      org_identifier: "default",
      template_name: "prebuilt_downtime",
    });
    expect(destination.test).toHaveBeenCalledTimes(1);
    const [{ data }] = vi.mocked(destination.test).mock.calls[0] as any;
    expect(data).toMatchObject({ type: "http", url: "https://hooks.example.com" });
    expect(JSON.parse(data.body)).toEqual({ text: "Nightly deploy: started" });
    wrapper.unmount();
  });

  it("shows an empty log for a row that has sent nothing", async () => {
    vi.mocked(downtimes.get).mockResolvedValue({
      data: { ...DETAIL, notification_log: [] },
    } as any);
    const wrapper = await mountDetail();
    expect(wrapper.find('[data-test="downtime-detail-notifications-empty"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
