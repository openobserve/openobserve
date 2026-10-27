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

import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import LabelFilterBar from "./LabelFilterBar.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import type { LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

let wrapper: VueWrapper<any> | null = null;

const createWrapper = (props: Record<string, any> = {}) => {
  wrapper = mount(LabelFilterBar, {
    props: {
      filters: [] as LabelFilter[],
      labelNames: ["job", "instance", "code"],
      labelNamesLoading: false,
      schemaLoading: false,
      loadValues: vi.fn().mockResolvedValue(["api", "web"]),
      ...props,
    },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
  return wrapper;
};

const filter = (label: string, value: string, operator?: string): LabelFilter => ({
  label: raw(label),
  value,
  ...(operator ? { operator } : {}),
});

const input = () =>
  (document.body.querySelector<HTMLInputElement>('[data-test="metrics-explorer-label-search"]') ??
    document.body.querySelector<HTMLInputElement>('[data-test="metrics-explorer-label-input"]'))!;

async function focus() {
  await wrapper!.find('[data-test="metrics-explorer-label-input"]').trigger("click");
  await flushPromises();
}

async function type(text: string) {
  input().value = text;
  input().dispatchEvent(new Event("input"));
  await flushPromises();
}

async function press(key: string) {
  input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  await flushPromises();
  await nextTick();
}

const rowKeys = () =>
  Array.from(
    document.body.querySelectorAll('[data-test^="metrics-explorer-label-suggest-item-"]'),
  ).map((row) =>
    row.getAttribute("data-test")!.replace("metrics-explorer-label-suggest-item-", ""),
  );

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("LabelFilterBar", () => {
  it("renders one chip per matcher, keyed by label for the e2e page object", () => {
    createWrapper({ filters: [filter("job", "api"), filter("job", "web", "!=")] });
    const chips = wrapper!.findAll('[data-test="metrics-explorer-label-chip-job"]');
    expect(chips).toHaveLength(2);
    expect(chips[0].text()).toContain("job");
    expect(chips[0].text()).toContain("api");
    expect(chips[1].text()).toContain("!=");
  });

  it("defaults a filter without an operator to =", () => {
    createWrapper({ filters: [filter("job", "api")] });
    expect(wrapper!.find('[data-test="metrics-explorer-label-chip-job"]').text()).toContain("=");
  });

  it("emits focus-picker on every open so label names load lazily", async () => {
    createWrapper();
    await focus();
    await press("Escape");
    await focus();
    expect(wrapper!.emitted("focus-picker")).toHaveLength(2);
  });

  it("adds a matcher with the keyboard and asks loadValues for that label", async () => {
    const loadValues = vi.fn().mockResolvedValue(["api", "web"]);
    createWrapper({ loadValues });
    await focus();
    await type("job");
    await press("Enter");
    expect(rowKeys()).toEqual(["eq", "neq", "regex", "not_regex", "in", "not_in"]);
    await press("Enter");
    await vi.waitFor(() => expect(rowKeys()).toContain("api"));
    expect(loadValues).toHaveBeenCalledWith("job");
    await press("Enter");
    expect(wrapper!.emitted("add")).toEqual([[{ label: "job", operator: "=", value: "api" }]]);
  });

  it.each([
    ["neq", "!="],
    ["regex", "=~"],
    ["not_regex", "!~"],
  ])("carries the %s matcher as %s", async (operator, symbol) => {
    createWrapper();
    await focus();
    await type("job");
    await press("Enter");
    const index = rowKeys().indexOf(operator);
    for (let i = 0; i < index; i++) await press("ArrowDown");
    await press("Enter");
    await type("x");
    await press("Enter");
    expect(wrapper!.emitted("add")![0][0]).toEqual({ label: "job", operator: symbol, value: "x" });
  });

  it("shows a plain alternation as is any of, and keeps a real pattern as a regex", () => {
    createWrapper({
      filters: [filter("job", "a\\.b|c", "=~"), filter("pod", "api-.*", "=~")],
    });
    const job = wrapper!.find('[data-test="metrics-explorer-label-chip-job"]').text();
    expect(job).toContain("is any of");
    expect(job).toContain("a.b, c");
    expect(wrapper!.find('[data-test="metrics-explorer-label-chip-pod-operator"]').text()).toBe(
      "=~",
    );
  });

  it("turns is any of into an escaped regex alternation", async () => {
    createWrapper({ loadValues: vi.fn().mockResolvedValue([]) });
    await focus();
    await type("job");
    await press("Enter");
    await type("any");
    await press("Enter");
    await type("a.b");
    await press("Enter");
    await type("c");
    await press("Enter");
    await press("Enter");
    expect(wrapper!.emitted("add")![0][0]).toEqual({
      label: "job",
      operator: "=~",
      value: "a\\.b|c",
    });
  });

  it("still adds a typed value when loadValues rejects", async () => {
    createWrapper({ loadValues: vi.fn().mockRejectedValue(new Error("boom")) });
    await focus();
    await type("job=api");
    await press("Enter");
    expect(wrapper!.emitted("add")![0][0]).toEqual({ label: "job", operator: "=", value: "api" });
  });

  it("offers a label that is not loaded yet and refuses an invalid PromQL name", async () => {
    createWrapper({ labelNames: [] });
    await focus();
    await type("pod");
    expect(rowKeys()).toHaveLength(1);
    await type("job-name");
    expect(rowKeys()).toHaveLength(0);
  });

  it("emits remove with the whole matcher", async () => {
    const target = filter("job", "web", "!=");
    createWrapper({ filters: [filter("job", "api"), target] });
    const chips = wrapper!.findAll('[data-test="metrics-explorer-label-chip-job"]');
    await chips[1].find('[data-test="metrics-explorer-label-chip-job-remove"]').trigger("click");
    expect(wrapper!.emitted("remove")).toEqual([[target]]);
  });

  it("emits replace when a chip is edited, so it keeps its place", async () => {
    const original = filter("job", "api");
    createWrapper({ filters: [original, filter("code", "200")] });
    await wrapper!.find('[data-test="metrics-explorer-label-chip-job-value"]').trigger("click");
    await flushPromises();
    await type("web");
    await press("Enter");
    expect(wrapper!.emitted("replace")).toEqual([
      [original, { label: "job", operator: "=", value: "web" }],
    ]);
    expect(wrapper!.emitted("remove")).toBeUndefined();
    expect(wrapper!.emitted("add")).toBeUndefined();
  });

  it("emits clear-all from the clear button when several filters are set", async () => {
    createWrapper({ filters: [filter("job", "api"), filter("code", "200")] });
    await wrapper!.find('[data-test="metrics-explorer-label-clear"]').trigger("click");
    expect(wrapper!.emitted("clear-all")).toHaveLength(1);
    expect(wrapper!.emitted("remove")).toBeUndefined();
  });

  it("does not offer AND/OR: PromQL ANDs every matcher", () => {
    createWrapper({ filters: [filter("job", "api"), filter("code", "200")] });
    expect(wrapper!.find('[data-test="metrics-explorer-label-mode"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test^="metrics-explorer-label-connector-"]').exists()).toBe(false);
  });
});
