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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import autoobserve, { type AutoObserveSuggestion } from "@/services/autoobserve";
import OTable from "@/lib/core/Table/OTable.vue";
import AllSuggestionsDrawer from "./AllSuggestionsDrawer.vue";
import config from "@/aws-exports";
import router from "@/test/unit/helpers/router";

// The decision route answers 404 while its switch is off; this spec pins today's routes.
vi.mock("@/services/autoobserveDecisions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/autoobserveDecisions")>();
  const off = () =>
    Promise.reject(Object.assign(new Error("HTTP 404"), { response: { status: 404 } }));
  return { ...actual, default: { ...actual.default, list: vi.fn(off) } };
});
vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn() },
}));

const api = vi.mocked(autoobserve.suggestions);

// A drawer left mounted refetches when the cache is cleared, so its calls would land in the next test.
enableAutoUnmount(afterEach);

const suggestion = (id: string): AutoObserveSuggestion => ({
  id,
  org: "acme",
  analyzer: "coverage",
  kind: "coverage_gap",
  subject: { kind: "service", key_dims: { service_name: id } },
  evidence: { service_name: id, severity: "medium", cells: {} },
  score: 1,
  confidence: "sufficient",
  status: "proposed",
  decided_score: null,
  on_accept: null,
});

const page = (ids: string[], total: number) =>
  ({ data: { suggestions: ids.map(suggestion), total, limit: 25, offset: 0 } }) as never;

const pending = () => new Promise<never>(() => undefined);

const DrawerStub = {
  props: ["open"],
  template: "<div><slot name='header-left' /><slot /></div>",
};

const originalOrg = store.state.selectedOrganization;
const setOrg = (identifier: string) =>
  store.commit("setSelectedOrganization", { ...originalOrg, identifier });

// The test setup installs the app's query client for every mount, and clears it after each test.
const mountDrawer = () =>
  mount(AllSuggestionsDrawer, {
    props: { open: true },
    global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
  });

const rows = (wrapper: ReturnType<typeof mountDrawer>) =>
  wrapper.findComponent(OTable).props("data") as { id: string }[];

const COUNT = '[data-test="autoobserve2-suggestions-drawer-count"]';
const PAGER = '[data-test="o2-table-pagination-bottom"]';

describe("AllSuggestionsDrawer (journey 3)", () => {
  beforeEach(() => {
    api.mockReset();
    setOrg("org-a");
  });

  afterEach(() => {
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("never shows the previous org's suggestions after an org switch", async () => {
    api.mockResolvedValueOnce(page(["a1", "a2"], 12));
    const wrapper = mountDrawer();
    await flushPromises();
    expect(rows(wrapper).map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(wrapper.find(COUNT).text()).toBe("12");

    api.mockReturnValueOnce(pending());
    setOrg("org-b");
    await flushPromises();
    expect(api).toHaveBeenLastCalledWith("org-b", expect.objectContaining({ offset: 0 }));
    expect(rows(wrapper)).toEqual([]);
    expect(wrapper.find(COUNT).exists()).toBe(false);
  });

  it("keeps the current page dimmed while the next page of the same org loads", async () => {
    api.mockResolvedValueOnce(page(["a1"], 30));
    const wrapper = mountDrawer();
    await flushPromises();
    api.mockReturnValueOnce(pending());
    wrapper.findComponent(OTable).vm.$emit("pagination-change", { page: 2, pageSize: 25 });
    await flushPromises();
    expect(api).toHaveBeenLastCalledWith("org-a", expect.objectContaining({ offset: 25 }));
    expect(rows(wrapper).map((r) => r.id)).toEqual(["a1"]);
    expect(wrapper.findComponent(OTable).props("loading")).toBe(true);
  });

  it("shows no empty state and holds the count's place while the first page loads", async () => {
    api.mockReturnValue(pending());
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-suggestions-drawer-pending"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="autoobserve2-suggestions-drawer-empty"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("No suggestions right now");
    expect(wrapper.find(PAGER).exists()).toBe(false);
    expect(
      wrapper.find('[data-test="autoobserve2-suggestions-drawer-count-skeleton"]').exists(),
    ).toBe(true);
  });

  it("speaks in the first person in its intro line, not of 'the engine'", async () => {
    api.mockResolvedValueOnce(page(["a"], 1));
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.text()).toContain("Open a row for what I found.");
    expect(wrapper.text()).not.toContain("the engine");
  });

  it("says there is nothing left when every suggestion was decided", async () => {
    api.mockResolvedValueOnce(page([], 0));
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.find('[data-test="autoobserve2-suggestions-drawer-empty"]').text()).toContain(
      "No suggestions right now",
    );
    expect(wrapper.find(COUNT).text()).toBe("0");
    expect(wrapper.find(PAGER).exists()).toBe(false);
  });

  it("has no page-size select, since the page size is fixed", async () => {
    api.mockResolvedValueOnce(page(["a1", "a2"], 60));
    const wrapper = mountDrawer();
    await flushPromises();
    expect(wrapper.findComponent(OTable).props("pageSizeOptions")).toEqual([]);
    expect(wrapper.find(PAGER).exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table-page-size-select"]').exists()).toBe(false);
  });

  it("keeps the rows under a red line when a refresh fails", async () => {
    api.mockResolvedValueOnce(page(["a1"], 1));
    const wrapper = mountDrawer();
    await flushPromises();
    api.mockRejectedValueOnce({ response: { status: 500, data: { message: "boom" } } });
    await queryClient.refetchQueries();
    await flushPromises();
    expect(rows(wrapper).map((r) => r.id)).toEqual(["a1"]);
    const line = wrapper.find('[data-test="autoobserve2-suggestions-drawer-refresh-failed"]');
    expect(line.attributes("role")).toBe("alert");
  });

  it("keeps the failure up with Retry spinning while a retry runs", async () => {
    api.mockRejectedValueOnce({ response: { status: 500, data: { message: "boom" } } });
    const wrapper = mountDrawer();
    await flushPromises();
    const ERROR = '[data-test="autoobserve2-suggestions-drawer-error"]';
    const RETRY = '[data-test="autoobserve2-suggestions-drawer-retry"]';
    expect(wrapper.find(ERROR).exists()).toBe(true);
    api.mockReturnValueOnce(pending());
    await wrapper.find(RETRY).trigger("click");
    await flushPromises();
    expect(wrapper.find(ERROR).exists()).toBe(true);
    expect(wrapper.find(RETRY).attributes("aria-busy")).toBe("true");
  });

  it("keeps page 2's failure up while its retry runs, never flashing page 1's rows", async () => {
    api.mockResolvedValueOnce(page(["a1"], 30));
    const wrapper = mountDrawer();
    await flushPromises();
    const ERROR = '[data-test="autoobserve2-suggestions-drawer-error"]';
    const RETRY = '[data-test="autoobserve2-suggestions-drawer-retry"]';
    api.mockRejectedValueOnce({ response: { status: 500, data: { message: "boom" } } });
    wrapper.findComponent(OTable).vm.$emit("pagination-change", { page: 2, pageSize: 25 });
    await flushPromises();
    expect(wrapper.find(ERROR).exists()).toBe(true);
    api.mockReturnValueOnce(pending());
    await wrapper.find(RETRY).trigger("click");
    await flushPromises();
    expect(api).toHaveBeenLastCalledWith("org-a", expect.objectContaining({ offset: 25 }));
    expect(wrapper.find(ERROR).exists()).toBe(true);
    expect(wrapper.find(RETRY).attributes("aria-busy")).toBe("true");
    expect(wrapper.findComponent(OTable).exists()).toBe(false);
  });

  it("renames its column headers when the language changes", async () => {
    api.mockResolvedValueOnce(page(["a1"], 1));
    const wrapper = mountDrawer();
    await flushPromises();
    const global = i18n.global as unknown as {
      locale: string | { value: string };
      mergeLocaleMessage: (l: string, m: unknown) => void;
    };
    const setLocale = (next: string) => {
      if (typeof global.locale === "string") global.locale = next;
      else global.locale.value = next;
    };
    const before = typeof global.locale === "string" ? global.locale : global.locale.value;
    global.mergeLocaleMessage("xx-test", {
      autoobserveLive: { suggestions: { columns: { suggestion: "Proposal" } } },
    });
    setLocale("xx-test");
    await nextTick();
    const headers = (wrapper.findComponent(OTable).props("columns") as { header: string }[]).map(
      (c) => c.header,
    );
    setLocale(before);
    expect(headers[0]).toBe("Proposal");
  });

  it("goes back to the last page that exists when the total shrinks, without an empty flash", async () => {
    api.mockResolvedValueOnce(page(["a1"], 30));
    const wrapper = mountDrawer();
    await flushPromises();
    api.mockResolvedValueOnce(page([], 24));
    let release: (value: unknown) => void = () => undefined;
    api.mockReturnValueOnce(new Promise((resolve) => (release = resolve)) as never);
    wrapper.findComponent(OTable).vm.$emit("pagination-change", { page: 2, pageSize: 25 });
    await flushPromises();
    expect(api).toHaveBeenLastCalledWith("org-a", expect.objectContaining({ offset: 0 }));
    expect(wrapper.findComponent(OTable).props("currentPage")).toBe(1);
    expect(wrapper.findComponent(OTable).props("loading")).toBe(true);
    expect(wrapper.find(COUNT).text()).toBe("24");
    expect(wrapper.find('[data-test="autoobserve2-suggestions-drawer-empty"]').exists()).toBe(
      false,
    );
    release(page(["a1"], 24));
    await flushPromises();
    expect(rows(wrapper).map((r) => r.id)).toEqual(["a1"]);
    expect(wrapper.find(COUNT).text()).toBe("24");
    expect(wrapper.findComponent(OTable).props("loading")).toBe(false);
  });

  it("never shows the previous org's held total when the org switches mid-clamp", async () => {
    api.mockResolvedValueOnce(page(["a1"], 30));
    const wrapper = mountDrawer();
    await flushPromises();
    api.mockResolvedValueOnce(page([], 24));
    let release: (value: unknown) => void = () => undefined;
    api.mockReturnValueOnce(new Promise((resolve) => (release = resolve)) as never);
    wrapper.findComponent(OTable).vm.$emit("pagination-change", { page: 2, pageSize: 25 });
    await flushPromises();
    expect(wrapper.find(COUNT).text()).toBe("24");
    api.mockResolvedValueOnce(page(["b1"], 1));
    setOrg("org-b");
    await flushPromises();
    expect(rows(wrapper).map((r) => r.id)).toEqual(["b1"]);
    expect(wrapper.find(COUNT).text()).toBe("1");
    expect(wrapper.findComponent(OTable).props("loading")).toBe(false);
    release(page(["a1"], 24));
    await flushPromises();
    expect(rows(wrapper).map((r) => r.id)).toEqual(["b1"]);
    expect(wrapper.find(COUNT).text()).toBe("1");
    expect(wrapper.findComponent(OTable).props("loading")).toBe(false);
  });

  it("keeps the new org's own clamp when the old org's clamp refetch settles late", async () => {
    const held = () => {
      let release: (value: unknown) => void = () => undefined;
      const promise = new Promise((resolve) => (release = resolve));
      return { promise: promise as never, release: (v: unknown) => release(v) };
    };
    const toPage2 = () =>
      wrapper.findComponent(OTable).vm.$emit("pagination-change", { page: 2, pageSize: 25 });
    api.mockResolvedValueOnce(page(["a1"], 30));
    const wrapper = mountDrawer();
    await flushPromises();
    const orgA = held();
    api.mockResolvedValueOnce(page([], 24)).mockReturnValueOnce(orgA.promise);
    toPage2();
    await flushPromises();
    api.mockResolvedValueOnce(page(["b1"], 30));
    setOrg("org-b");
    await flushPromises();
    const orgB = held();
    api.mockResolvedValueOnce(page([], 20)).mockReturnValueOnce(orgB.promise);
    toPage2();
    await flushPromises();
    expect(wrapper.find(COUNT).text()).toBe("20");
    orgA.release(page(["a1"], 24));
    await flushPromises();
    expect(wrapper.find(COUNT).text()).toBe("20");
    expect(wrapper.findComponent(OTable).props("loading")).toBe(true);
    orgB.release(page(["b1"], 20));
    await flushPromises();
    expect(wrapper.find(COUNT).text()).toBe("20");
    expect(wrapper.findComponent(OTable).props("loading")).toBe(false);
  });
});

describe("AllSuggestionsDrawer: a monitor that notifies no one (demo bug 4)", () => {
  beforeEach(() => {
    api.mockReset();
    setOrg("org-a");
  });

  afterEach(() => {
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("shows the kind in amber and the why and next under the headline", async () => {
    api.mockResolvedValueOnce({
      data: {
        suggestions: [
          suggestion("gap"),
          {
            ...suggestion("silent"),
            kind: "silent_coverage",
            subject: { kind: "alert", key_dims: { entity_id: "a1" } },
            evidence: {
              monitor_name: "svc-no-data",
              classes: ["absence"],
              services: ["svc-y"],
              service_count: 1,
            },
          },
        ],
        total: 2,
        limit: 25,
        offset: 0,
      },
    } as never);
    const wrapper = mountDrawer();
    await flushPromises();
    const kind = wrapper.findComponent('[data-test="autoobserve2-suggestions-kind-silent"]');
    expect(kind.text()).toBe("Notifies no one");
    expect(kind.props("variant")).toBe("amber-soft");
    expect(
      wrapper.findComponent('[data-test="autoobserve2-suggestions-kind-gap"]').props("variant"),
    ).toBe("amber-soft");
    expect(wrapper.get('[data-test="autoobserve2-suggestions-note-silent"]').text()).toBe(
      "svc-no-data would notice svc-y stopping, but it notifies no one. Give it a destination.",
    );
    expect(wrapper.find('[data-test="autoobserve2-suggestions-note-gap"]').exists()).toBe(false);
  });
});

describe("AllSuggestionsDrawer: Next step and the row's Details (test 15)", () => {
  const NOT_WORKING_ID = "f49d3499f38e5e8a374debbca25af38c40c34d9b6c9e96ba68746e17883073f9";

  const notWorking = (over: Partial<AutoObserveSuggestion> = {}): AutoObserveSuggestion => ({
    id: NOT_WORKING_ID,
    org: "default",
    analyzer: "alert_calibration",
    kind: "alert_not_working",
    subject: { kind: "alert", key_dims: { entity_id: "a2" } },
    evidence: {
      alert_name: "payments-latency",
      pattern: "field_missing",
      rule_id: "failure",
      finding_id: NOT_WORKING_ID,
      field: "duration_ms",
      evaluation_errors: 4,
      evaluations: 9,
      severity: "high",
      run_window_start: 1_762_000_000_000_000,
      run_window_end: 1_762_300_000_000_000,
    },
    score: null,
    confidence: "suggestive",
    status: "proposed",
    decided_score: null,
    on_accept: null,
    tier: "A",
    advice: "check_missing_field",
    limitations: [],
    actions: [{ type: "review_alert", alert_id: "a2", focus: "query" }],
    ...over,
  });

  let enterprise: string;

  beforeEach(() => {
    enterprise = config.isEnterprise;
    config.isEnterprise = "true";
    api.mockReset();
    setOrg("org-a");
  });

  afterEach(() => {
    config.isEnterprise = enterprise;
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("puts the CTA in Next step, the red chip in Kind, and Details in the expanded row", async () => {
    api.mockResolvedValueOnce({
      data: { suggestions: [notWorking(), suggestion("gap")], total: 2, limit: 25, offset: 0 },
    } as never);
    const wrapper = mount(AllSuggestionsDrawer, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [i18n, store, router], stubs: { ODrawer: DrawerStub } },
    });
    await flushPromises();
    const headers = (wrapper.findComponent(OTable).props("columns") as { header: string }[]).map(
      (c) => c.header,
    );
    expect(headers.at(-1)).toBe("Next step");
    const kind = wrapper.findComponent(
      `[data-test="autoobserve2-suggestions-kind-${NOT_WORKING_ID}"]`,
    );
    expect(kind.text()).toBe("Not working");
    expect(kind.props("variant")).toBe("error-soft");
    expect(
      wrapper.get(`[data-test="autoobserve2-suggestions-next-${NOT_WORKING_ID}"]`).text(),
    ).toBe("Review alert");
    expect(wrapper.get('[data-test="autoobserve2-suggestions-next-gap"]').text()).toBe(
      "Open service",
    );
    const details = `[data-test="insight-block-${NOT_WORKING_ID}-details"]`;
    expect(wrapper.find(details).exists()).toBe(false);
    await wrapper
      .get(`[data-test="autoobserve2-suggestions-next-${NOT_WORKING_ID}"]`)
      .element.closest("tr")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.get(details).text()).toContain(
      "Check the field the query filters on: none of its streams has it.",
    );
    expect(wrapper.get(`[data-test="insight-block-${NOT_WORKING_ID}-dismiss"]`).text()).toBe(
      "Dismiss…",
    );
    await wrapper.get(`[data-test="insight-block-${NOT_WORKING_ID}-dismiss"]`).trigger("click");
    await flushPromises();
    expect(
      document.body.querySelectorAll('[data-test="alert-calibration-dismiss-dialog"]'),
    ).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("AllSuggestionsDrawer: Slack deep links (C4)", () => {
  const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `s${from + i}`);

  // The locate scan reads 500 at a time; the drawer's own pages read 25.
  const serve = (all: string[]) =>
    api.mockImplementation(async (_org, params) => {
      const offset = params.offset ?? 0;
      const slice = all.slice(offset, offset + (params.limit ?? 25));
      return {
        data: { suggestions: slice.map(suggestion), total: all.length, limit: 25, offset },
      } as never;
    });

  const mountWith = (props: Record<string, unknown>) =>
    mount(AllSuggestionsDrawer, {
      props: { open: true, ...props },
      global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
    });

  beforeEach(() => {
    api.mockReset();
    setOrg("org-a");
  });

  afterEach(() => {
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("opens on the page that holds the linked suggestion, expanded and marked", async () => {
    serve(ids(60));
    const wrapper = mountWith({ focusId: "s30" });
    await flushPromises();
    expect(api).toHaveBeenCalledWith("org-a", expect.objectContaining({ offset: 25, limit: 25 }));
    expect(api).not.toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({ offset: 0, limit: 25 }),
    );
    const table = wrapper.findComponent(OTable);
    expect(rows(wrapper).map((r) => r.id)).toContain("s30");
    expect(table.props("currentPage")).toBe(2);
    expect(table.props("expandedIds")).toEqual(["s30"]);
    expect(table.props("activeRowIndex")).toBe(5);
    expect(wrapper.text()).not.toContain("This suggestion is no longer open.");
  });

  it("scrolls the linked row into view even when the drawer body mounts after the data (T1-N3)", async () => {
    serve(ids(60));
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    // The real drawer mounts its body a few frames after it opens, behind its open animation.
    const LateBodyStub = {
      props: ["open"],
      data: () => ({ ready: false }),
      mounted(this: { ready: boolean }) {
        setTimeout(() => (this.ready = true), 60);
      },
      template: "<div><slot name='header-left' /><slot v-if='ready' /></div>",
    };
    try {
      mount(AllSuggestionsDrawer, {
        props: { open: true, focusId: "s30" },
        attachTo: document.body,
        global: { plugins: [i18n, store], stubs: { ODrawer: LateBodyStub } },
      });
      await flushPromises();
      await new Promise((r) => setTimeout(r, 400));
      await flushPromises();
      const row = document.querySelector('[data-test="autoobserve2-suggestions-row-s30"]');
      expect(row).not.toBeNull();
      expect(scroll.mock.contexts).toContain(row);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("says a linked suggestion is no longer open, on page 1, without an error", async () => {
    serve(ids(3));
    const wrapper = mountWith({ focusId: "gone" });
    await flushPromises();
    expect(wrapper.text()).toContain("This suggestion is no longer open.");
    expect(rows(wrapper).map((r) => r.id)).toEqual(["s0", "s1", "s2"]);
    expect(wrapper.findComponent(OTable).props("activeRowIndex")).toBeNull();
    expect(wrapper.find('[data-test="autoobserve2-suggestions-drawer-error"]').exists()).toBe(
      false,
    );
  });

  it("filters to the linked kind and names it in a chip that clears the filter", async () => {
    serve(ids(2));
    const wrapper = mountWith({ kind: "coverage_gap" });
    await flushPromises();
    expect(api).toHaveBeenCalledWith("org-a", expect.objectContaining({ kind: "coverage_gap" }));
    const chip = wrapper.findComponent('[data-test="autoobserve2-suggestions-drawer-kind"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("Coverage gap");
    chip.vm.$emit("remove");
    expect(wrapper.emitted("update:kind")).toEqual([[null]]);
  });

  it("says a kind has nothing open and offers every open suggestion instead (T1-N4)", async () => {
    api.mockImplementation(async (_org, params) => {
      const all = params.kind === "coverage_lost" ? [] : ids(26);
      return {
        data: {
          suggestions: all.slice(0, 25).map(suggestion),
          total: all.length,
          limit: 25,
          offset: 0,
        },
      } as never;
    });
    const wrapper = mountWith({ kind: "coverage_lost" });
    await flushPromises();
    const empty = wrapper.get('[data-test="autoobserve2-suggestions-drawer-empty"]');
    expect(empty.text()).toContain("No open suggestions of the kind Coverage lost");
    expect(empty.text()).toContain("26 other suggestions are open.");
    expect(empty.text()).not.toContain("No suggestions right now");
    await empty.get("button").trigger("click");
    expect(wrapper.emitted("update:kind")).toEqual([[null]]);
  });

  it("keeps the plain empty state when nothing at all is open, filter or not", async () => {
    serve([]);
    const wrapper = mountWith({ kind: "coverage_lost" });
    await flushPromises();
    expect(wrapper.get('[data-test="autoobserve2-suggestions-drawer-empty"]').text()).toContain(
      "No suggestions right now",
    );
  });

  it("ignores a kind it doesn't know rather than showing an empty list", async () => {
    serve(ids(2));
    const wrapper = mountWith({ kind: "bogus" });
    await flushPromises();
    expect(api).not.toHaveBeenCalledWith("org-a", expect.objectContaining({ kind: "bogus" }));
    expect(wrapper.find('[data-test="autoobserve2-suggestions-drawer-kind"]').exists()).toBe(false);
    expect(rows(wrapper).map((r) => r.id)).toEqual(["s0", "s1"]);
  });
});
