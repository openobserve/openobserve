// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import DowntimeDetail from "./DowntimeDetail.vue";
import downtimes, { type DowntimeDetail as Detail } from "@/services/downtimes";
import destination from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { dismissAll, toastRecords } from "@/lib/feedback/Toast/useToast";

vi.mock("@/services/downtimes", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    extend: vi.fn(),
    test: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    preview: vi.fn(),
    resources: vi.fn(),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), test: vi.fn(), testSend: vi.fn() },
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
      templates: [
        {
          destination: "slack-oncall",
          template_name: "play_downtime_card",
          template_source: "org_default",
        },
      ],
    },
  ],
} as unknown as Detail;

const testConfirm = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAllComponents(ConfirmDialog)
    .find((c) => c.props("title") === "Send a test message?")!;

const confirmSendTest = async (wrapper: ReturnType<typeof mount>) => {
  await wrapper.get('[data-test="downtime-detail-send-test"]').trigger("click");
  await flushPromises();
  testConfirm(wrapper).vm.$emit("update:ok");
  await flushPromises();
};

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
    vi.mocked(destination.test).mockReset();
    vi.mocked(destination.test).mockResolvedValue({ data: { success: true } } as any);
    vi.mocked(destination.testSend).mockReset();
    vi.mocked(destination.testSend).mockResolvedValue({ data: { success: true } } as any);
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

  it("names the template each destination sent with, including a stored org default row", async () => {
    const wrapper = await mountDetail();
    const text = wrapper.get('[data-test="downtime-detail-notifications-table"]').text();
    expect(text).toContain("Template");
    expect(text).toContain("slack-oncall: play_downtime_card (org default)");
    wrapper.unmount();
  });

  it("sends the test through the server's live path to the row's destinations", async () => {
    vi.mocked(downtimes.test).mockResolvedValue({
      data: [{ destination: "slack-oncall", ok: true }],
    } as any);
    const wrapper = await mountDetail();
    await confirmSendTest(wrapper);
    expect(downtimes.test).toHaveBeenCalledTimes(1);
    const [org, id, names] = vi.mocked(downtimes.test).mock.calls[0] as any;
    expect([org, id, names]).toEqual(["default", DETAIL.id, ["slack-oncall"]]);
    expect(destination.test).not.toHaveBeenCalled();
    expect(destination.testSend).not.toHaveBeenCalled();
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

  it("asks first and sends nothing until the test is confirmed", async () => {
    vi.mocked(downtimes.test).mockReset();
    const wrapper = await mountDetail();
    await wrapper.get('[data-test="downtime-detail-send-test"]').trigger("click");
    await flushPromises();
    const dialog = testConfirm(wrapper);
    expect(dialog.props("modelValue")).toBe(true);
    expect(dialog.props("message")).toContain("[TEST]");
    expect(dialog.props("message")).toContain("slack-oncall");
    dialog.vm.$emit("update:cancel");
    await flushPromises();
    expect(downtimes.test).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("names why each destination failed, in words for a platform skip", async () => {
    dismissAll();
    vi.mocked(downtimes.test).mockResolvedValue({
      data: [
        { destination: "slack-oncall", ok: false, error: "HTTP 405" },
        { destination: "pd", ok: false, unsupported: true, error: "PlatformNotForKind" },
        { destination: "mail", ok: false, unsupported: true, error: "NoOrgMemberRecipient" },
      ],
    } as any);
    const wrapper = await mountDetail();
    await confirmSendTest(wrapper);
    const error = toastRecords.find((r) => r.variant === "error");
    expect(String(error?.message)).toContain("slack-oncall (HTTP 405)");
    expect(String(error?.message)).toContain("pd (skipped, a live downtime does not notify");
    expect(String(error?.message)).toContain("mail (skipped, no recipient is a member");
    expect(String(error?.message)).not.toContain("PlatformNotForKind");
    dismissAll();
    wrapper.unmount();
  });

  it("shows the server's limit text when the test is rate limited", async () => {
    dismissAll();
    vi.mocked(downtimes.test).mockRejectedValue({
      response: {
        status: 429,
        data: { code: 429, message: "Too many test-sends — try again in 30s (limit: 6/min)" },
      },
    });
    const wrapper = await mountDetail();
    await confirmSendTest(wrapper);
    const error = toastRecords.find((r) => r.variant === "error");
    expect(String(error?.message)).toContain("try again in 30s");
    dismissAll();
    wrapper.unmount();
  });
});
