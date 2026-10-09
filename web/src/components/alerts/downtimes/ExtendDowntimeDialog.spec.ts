// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { gt } from "@/types/i18n";
import store from "@/test/unit/helpers/store";
import downtimes, { type DowntimeListItem } from "@/services/downtimes";
import { queryClient } from "@/composables/query/queryClient";
import ExtendDowntimeDialog from "./ExtendDowntimeDialog.vue";
import { makeExtendSchema, type ExtendForm } from "./ExtendDowntimeDialog.schema";

vi.mock("@/services/downtimes", () => ({ default: { extend: vi.fn() } }));

const HOUR = 3_600_000_000;
const START = Date.parse("2026-09-17T14:00:00Z") * 1000;

const row = (repeat: "none" | "daily"): DowntimeListItem =>
  ({
    id: "d1",
    org: "default",
    folder_id: "planned",
    name: "Nightly deploy",
    targets: [{ module: "alerts", folders: { kind: "all" } }],
    schedule: {
      repeat,
      starts_at: START,
      ends_at: repeat === "none" ? START + 2 * HOUR : null,
      timezone: "UTC",
      start_time_local: repeat === "none" ? null : "14:00",
      duration_secs: 7200,
      weekdays: [],
    },
    show_banner: false,
    created_by: "lin",
    created_at: 0,
    updated_by: "lin",
    updated_at: 0,
    status: "active",
    current_window: { start: START, end: START + 2 * HOUR },
    next_window: null,
    matched_alerts: 1,
    matched_anomalies: 0,
    matched_synthetics: 0,
    matched_slos: 0,
  }) as DowntimeListItem;

const mountDialog = async (downtime: DowntimeListItem) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "downtimes", component: { template: "<div />" } }],
  });
  await router.push("/");
  const wrapper = mount(ExtendDowntimeDialog, {
    props: { open: false, downtime },
    global: { plugins: [store, router] },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
};

const dialog = () =>
  document.body.querySelector<HTMLElement>('[data-test="extend-downtime-dialog"]');

describe("ExtendDowntimeDialog", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(downtimes.extend).mockReset();
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  it("names the follow-up downtime a recurring extension creates", async () => {
    const wrapper = await mountDialog(row("daily"));
    const note = document.body.querySelector('[data-test="extend-downtime-follow-up"]');
    expect(note?.textContent).toContain("Nightly deploy (extended)");
    wrapper.unmount();
  });

  it("says nothing about a follow-up for a one-time downtime", async () => {
    const wrapper = await mountDialog(row("none"));
    expect(dialog()).not.toBeNull();
    expect(document.body.querySelector('[data-test="extend-downtime-follow-up"]')).toBeNull();
    wrapper.unmount();
  });

  it("sends the default end, an hour past the current one, as until", async () => {
    vi.mocked(downtimes.extend).mockResolvedValue({
      data: { ...row("none"), schedule: { ...row("none").schedule, ends_at: START + 3 * HOUR } },
    } as any);
    const wrapper = await mountDialog(row("none"));
    dialog()!.querySelector<HTMLButtonElement>('[data-test="o-dialog-primary-btn"]')!.click();
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    const call = vi.mocked(downtimes.extend).mock.calls[0];
    expect(call[1]).toBe("d1");
    expect(call[3]).toBe("planned");
    expect((call[2] as { until: number }).until).toBe(START + 3 * HOUR);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });
});

describe("extend form", () => {
  const bounds = { currentEnd: START + 2 * HOUR, start: START };
  const schema = makeExtendSchema(gt, "UTC", () => bounds);
  const check = (end_time: string, end_date = "2026-09-17") =>
    schema.safeParse({ end_date, end_time } satisfies ExtendForm);

  it("accepts an end past the current one", () => {
    expect(check("17:00").success).toBe(true);
  });

  it("rejects an end at or before the current one", () => {
    const result = check("16:00");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("The new end must be later than the current end.");
  });

  it("rejects a window longer than 7 days", () => {
    const result = check("15:00", "2026-09-24");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("A window can last at most 7 days.");
  });
});
