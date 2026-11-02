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
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import autoobserve, { type AutoObserveSuggestion } from "@/services/autoobserve";
import OTable from "@/lib/core/Table/OTable.vue";
import AllSuggestionsDrawer from "./AllSuggestionsDrawer.vue";

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn() },
}));

const api = vi.mocked(autoobserve.suggestions);

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
