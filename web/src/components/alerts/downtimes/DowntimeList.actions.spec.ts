// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import DowntimeList from "./DowntimeList.vue";
import downtimes, { type DowntimeListItem } from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";

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

const row = (
  id: string,
  status: DowntimeListItem["status"],
  over: Partial<DowntimeListItem> = {},
) =>
  ({
    id,
    org: "default",
    folder_id: "default",
    name: `${id} window`,
    targets: [{ module: "alerts", folders: { kind: "all" } }],
    schedule: {
      repeat: "none",
      starts_at: NOW - HOUR,
      ends_at: NOW + HOUR,
      timezone: "UTC",
      duration_secs: 7200,
      weekdays: [],
    },
    show_banner: false,
    created_by: "lin@example.com",
    created_at: 0,
    updated_by: "lin@example.com",
    updated_at: 0,
    status,
    current_window: status === "active" ? { start: NOW - HOUR, end: NOW + HOUR } : null,
    next_window: null,
    matched_alerts: 1,
    matched_anomalies: 0,
    matched_synthetics: 0,
    matched_slos: 0,
    ...over,
  }) as DowntimeListItem;

const ROWS = [
  row("ended", "ended"),
  row("early", "ended_early", { cancelled_at: NOW - HOUR / 2 }),
  row("cancelled", "cancelled", { cancelled_at: NOW - 2 * HOUR }),
  row("scheduled", "scheduled", { next_window: { start: NOW + 2 * HOUR, end: NOW + 3 * HOUR } }),
  row("active", "active"),
];

const mountList = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/downtimes", name: "downtimes", component: DowntimeList },
      { path: "/downtimes/add", name: "addDowntime", component: { template: "<div />" } },
      { path: "/downtimes/:id/edit", name: "editDowntime", component: { template: "<div />" } },
      { path: "/downtimes/:id", name: "downtimeDetail", component: { template: "<div />" } },
    ],
  });
  await router.push({ name: "downtimes", query: { org_identifier: "default", folder: "default" } });
  await router.isReady();
  const wrapper = mount(DowntimeList, {
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
  return wrapper;
};

const cell = (wrapper: ReturnType<typeof mount>, id: string) =>
  wrapper.get(`[data-test="downtime-list-${id}-actions"]`);

const dialog = () => document.body.querySelector<HTMLElement>('[data-test="confirm-dialog"]');

describe("DowntimeList row actions", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.list).mockResolvedValue({
      data: {
        items: ROWS,
        total: ROWS.length,
        counts: { active: 1, scheduled: 1, recurring: 0, ended: 1, cancelled: 1, ended_early: 1 },
      },
    } as any);
    vi.mocked(downtimes.cancel)
      .mockReset()
      .mockResolvedValue({ data: {} } as any);
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  it("keeps five action slots on every row, disabling the ones that do not apply", async () => {
    const wrapper = await mountList();
    for (const r of ROWS) {
      const slots = cell(wrapper, r.id).element.children;
      expect(slots.length, r.id).toBe(5);
    }
    expect(
      cell(wrapper, "active").find('[data-test="downtime-list-active-extend"]').attributes(),
    ).not.toHaveProperty("disabled");
    expect(
      cell(wrapper, "ended").get('[data-test="downtime-list-ended-extend"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      cell(wrapper, "ended")
        .get('[data-test="downtime-list-ended-end-now"]')
        .attributes("disabled"),
    ).toBeDefined();
    expect(
      cell(wrapper, "scheduled").find('[data-test="downtime-list-scheduled-cancel"]').exists(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("hides Edit on finished rows and keeps Duplicate", async () => {
    const wrapper = await mountList();
    for (const id of ["ended", "early", "cancelled"]) {
      expect(wrapper.find(`[data-test="downtime-list-${id}-edit"]`).exists(), id).toBe(false);
      expect(wrapper.find(`[data-test="downtime-list-${id}-duplicate"]`).exists(), id).toBe(true);
    }
    for (const id of ["active", "scheduled"]) {
      expect(wrapper.find(`[data-test="downtime-list-${id}-edit"]`).exists(), id).toBe(true);
    }
    wrapper.unmount();
  });

  it("asks before ending a downtime now, and Keep running leaves it", async () => {
    const wrapper = await mountList();
    await wrapper.get('[data-test="downtime-list-active-end-now"]').trigger("click");
    await flushPromises();
    expect(dialog()?.textContent).toContain("End this downtime now?");
    expect(dialog()?.textContent).toContain("Keep running");
    dialog()!.querySelector<HTMLButtonElement>('[data-test="o-dialog-secondary-btn"]')!.click();
    await flushPromises();
    expect(downtimes.cancel).not.toHaveBeenCalled();

    await wrapper.get('[data-test="downtime-list-active-end-now"]').trigger("click");
    await flushPromises();
    const ok = dialog()!.querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!;
    expect(ok.textContent).toContain("End now");
    ok.click();
    await flushPromises();
    expect(downtimes.cancel).toHaveBeenCalledWith("default", "active", "default");
    wrapper.unmount();
  });

  it("shows the Ended early chip and its own stat tile", async () => {
    const wrapper = await mountList();
    expect(
      wrapper.get('[data-test="downtime-list-early-name"]').element.closest("tr")?.textContent,
    ).toContain("Ended early");
    const tile = wrapper.get('[data-test="downtime-summary-ended-early"]');
    expect(tile.text()).toContain("1");
    wrapper.unmount();
  });

  it("orders rows by status, then start, then id", async () => {
    const wrapper = await mountList();
    const order = [
      ...wrapper.element.querySelectorAll('[data-test^="downtime-list-"][data-test$="-actions"]'),
    ].map((el) =>
      el.getAttribute("data-test")!.replace("downtime-list-", "").replace("-actions", ""),
    );
    expect(order).toEqual(["active", "scheduled", "ended", "early", "cancelled"]);
    wrapper.unmount();
  });
});
