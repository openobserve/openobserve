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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  return {
    ...actual,
    default: {
      preview: vi.fn(),
      decide: vi.fn(),
      decideBatch: vi.fn(),
      undo: vi.fn(),
      list: vi.fn(),
    },
  };
});

import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { queryClient } from "@/composables/query/queryClient";
import autoobserveDecisions, { type DecisionView } from "@/services/autoobserveDecisions";
import { dismissAll } from "@/lib/feedback/Toast/useToast";
import { clearAppliedSession } from "../decisions/appliedChanges";
import LiveSurfaceEmpty from "../live/LiveSurfaceEmpty.vue";
import ChangesPage from "./ChangesPage.vue";
import AutoObserveActivityTab from "../AutoObserveActivityTab.vue";

const api = vi.mocked(autoobserveDecisions);

const view = (id: string, over: Partial<DecisionView> = {}): DecisionView => ({
  decision_id: `alert_finding:${id}`,
  family: "alert_finding",
  id,
  action: "apply",
  state: "applied",
  reason: null,
  note: null,
  has_note: false,
  actor: "ops@example.com",
  source: "ui",
  decided_at: Date.now() * 1000 - 60_000_000,
  until: null,
  revision: 4,
  change: {
    alert: { id: `al-${id}`, title: `disk latency ${id}` },
    fields: [{ field: "pending_period_secs", from: 0, to: 120 }],
  },
  via: "apply",
  ...over,
});

const list = (decisions: DecisionView[]) =>
  ({ data: { decisions, total: decisions.length, limit: 50, offset: 0 } }) as never;
const httpError = (status: number) => ({ response: { status, data: { message: "nope" } } });

const Blank = { template: "<div />" };
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: Blank },
    { path: "/alerts/:alert_id", name: "alertDetail", component: Blank },
  ],
});

let wrapper: VueWrapper | null = null;
const mountPage = async (
  comp: typeof ChangesPage | typeof AutoObserveActivityTab,
  props: Record<string, unknown> = {},
) => {
  wrapper = mount(comp as never, {
    props,
    attachTo: document.body,
    global: {
      plugins: [i18n, store, router, withQueryClient(queryClient)],
      stubs: { ReviewChangeDialog: true, AlertCalibrationDismissDialog: true },
    },
  });
  // The route probe and the list each take a round trip, so wait until the page says something.
  await vi.waitFor(() => expect(wrapper?.attributes("aria-busy")).not.toBe("true"), {
    timeout: 3_000,
  });
  await flushPromises();
  return wrapper;
};
const sel = (w: VueWrapper, test: string) => w.find(`[data-test="${test}"]`);

describe.each([
  ["Changes page", ChangesPage, "autoobserve2-activity", "autoobserve2-change-"],
  ["Activity ledger", AutoObserveActivityTab, "autoobserve-activity", "autoobserve-ledger-"],
] as const)("%s (live)", (_name, comp, prefix, rowPrefix) => {
  beforeEach(() => {
    queryClient.clear();
    clearAppliedSession();
    dismissAll();
    store.state.selectedOrganization.identifier = "demo-org";
    api.list.mockReset();
    api.undo.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("a denied read is red and says what failed, never an empty page", async () => {
    api.list.mockRejectedValue(httpError(403));
    const w = await mountPage(comp);
    const error = sel(w, `${prefix}-error`);
    expect(error.exists()).toBe(true);
    expect(error.attributes("role")).toBe("alert");
    expect(w.find(`[data-test^="${rowPrefix}"]`).exists()).toBe(false);
  });

  it("a failed read offers Retry, and a retry that works shows the rows", async () => {
    api.list.mockRejectedValue(httpError(500));
    const w = await mountPage(comp);
    expect(sel(w, `${prefix}-error`).exists()).toBe(true);
    api.list.mockResolvedValue(list([view("f-1")]));
    await w.find('[data-test$="-retry"]').trigger("click");
    await vi.waitFor(() => expect(w.text()).toContain("disk latency f-1"), { timeout: 3_000 });
    expect(sel(w, `${prefix}-error`).exists()).toBe(false);
  });

  it("lists one, a few and many changes, newest first, with Undo on those in force", async () => {
    const views = [
      view("f-1"),
      view("f-2", { state: "undone", decided_at: Date.now() * 1000 - 120_000_000 }),
      ...Array.from({ length: 10 }, (_, i) =>
        view(`m-${i}`, { decided_at: Date.now() * 1000 - (200 + i) * 1_000_000 }),
      ),
    ];
    api.list.mockResolvedValue(list(views));
    const w = await mountPage(comp);
    expect(w.text()).toContain("disk latency f-1");
    expect(w.text()).toContain("disk latency m-9");
    const undo = w.find(`[data-test="${rowPrefix}alert_finding:f-1-undo"]`);
    expect(undo.exists()).toBe(true);
    expect(w.find(`[data-test="${rowPrefix}alert_finding:f-2-undo"]`).exists()).toBe(false);
    api.undo.mockResolvedValue({ data: view("f-1", { state: "undone" }) } as never);
    await undo.trigger("click");
    await flushPromises();
    expect(api.undo).toHaveBeenCalledWith("demo-org", "alert_finding:f-1", expect.anything());
  });

  it("shows the newest 20 changes of a long list, says how many more, and opens the rest", async () => {
    const views = Array.from({ length: 23 }, (_, i) =>
      view(`m-${String(i).padStart(2, "0")}`, {
        decided_at: Date.now() * 1000 - (100 + i) * 1_000_000,
      }),
    );
    api.list.mockResolvedValue(list(views));
    const w = await mountPage(comp);
    expect(w.text()).toContain("disk latency m-19");
    expect(w.text()).not.toContain("disk latency m-20");
    const more = sel(w, `${prefix}-more`);
    expect(more.text()).toBe("Show 3 more changes");
    await more.trigger("click");
    expect(w.text()).toContain("disk latency m-22");
    expect(sel(w, `${prefix}-more`).exists()).toBe(false);
  });

  it("details show what a change was applied on, and say so when that was not recorded", async () => {
    const saw = {
      confidence: "High",
      rule_id: "noise",
      pattern: "short_blips",
      schema_version: 2,
      title: "Fires in short blips",
      columns: {
        evidence_shortblips_complete_episodes: 12,
        evidence_shortblips_would_not_alert: 9,
      },
    } as const;
    const kept = view("f-1");
    kept.change = { ...kept.change!, evidence: saw };
    api.list.mockResolvedValue(list([kept, view("f-2")]));
    const w = await mountPage(comp);
    for (const id of ["f-1", "f-2"])
      await w
        .find(`[data-test^="${rowPrefix}alert_finding:${id}-"][aria-expanded]`)
        .trigger("click");
    const details = (id: string, part: string) =>
      sel(w, `autoobserve2-change-alert_finding:${id}-${part}`);
    expect(details("f-1", "confidence").text()).toBe("High");
    const shown = details("f-1", "evidence").text();
    expect(shown).toContain("Fires in short blips");
    expect(shown).toMatch(/12.*9/s);
    expect(details("f-1", "evidence-none").exists()).toBe(false);
    expect(details("f-2", "confidence").exists()).toBe(false);
    expect(details("f-2", "evidence-none").exists()).toBe(true);
  });

  it("says nothing more when the list fits", async () => {
    api.list.mockResolvedValue(list([view("f-1")]));
    const w = await mountPage(comp);
    expect(w.text()).toContain("disk latency f-1");
    expect(sel(w, `${prefix}-more`).exists()).toBe(false);
  });
});

describe("Changes page empty and loading", () => {
  beforeEach(() => {
    queryClient.clear();
    clearAppliedSession();
    store.state.selectedOrganization.identifier = "demo-org";
    api.list.mockReset();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("holds a skeleton while the read is slow, then says nothing changed yet with a way on", async () => {
    vi.useFakeTimers();
    let resolve: (v: unknown) => void = () => undefined;
    api.list.mockReturnValue(new Promise((r) => (resolve = r)) as never);
    wrapper = mount(ChangesPage, {
      global: { plugins: [i18n, store, router, withQueryClient(queryClient)] },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(sel(wrapper, "autoobserve2-activity-skeleton").exists()).toBe(true);
    expect(sel(wrapper, "autoobserve2-activity-page").attributes("aria-busy")).toBe("true");
    resolve(list([]));
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    await flushPromises();
    const empty = sel(wrapper, "autoobserve2-activity-empty");
    expect(empty.text()).toContain("No changes yet");
    wrapper.findComponent(LiveSurfaceEmpty).vm.$emit("action");
    expect(wrapper.emitted("see-suggestions")).toHaveLength(1);
  });

  it("filters to undone changes and names the filter's own empty state", async () => {
    api.list.mockResolvedValue(list([view("f-1")]));
    const w = await mountPage(ChangesPage);
    expect(sel(w, "autoobserve2-activity-stat-made").text()).toContain("1");
    w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "inForce");
    await flushPromises();
    expect(w.text()).toContain("disk latency f-1");
    expect(sel(w, "autoobserve2-activity-filter-undone").attributes("disabled")).toBeDefined();
  });
});

describe("Activity ledger approvals", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("counts approvals in All and names the alert each one changes", async () => {
    queryClient.clear();
    api.list.mockResolvedValue(list([view("f-1")]));
    const request = {
      id: "r1",
      insight: {
        headline: "Wait 2 minutes before firing",
        why: null,
        meta: "From the calibration run 18 hours ago",
        dismissable: true,
        cta: { target: { type: "review_change", change: { alertName: "checkout-latency" } } },
      },
    };
    const w = await mountPage(AutoObserveActivityTab, { requests: [request] });
    expect(sel(w, "autoobserve-activity-chip-all").text()).toContain("2");
    const row = sel(w, "autoobserve-ledger-pending-r1").text();
    expect(row).toContain("checkout-latency");
    expect(row).not.toContain("calibration run");
  });
});
