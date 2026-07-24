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

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, afterEach } from "vitest";
import PrefixFilterPanel from "./PrefixFilterPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const FACETS = [
  { id: "node_cpu", label: "node_cpu", count: 12 },
  { id: "node_memory", label: "node_memory", count: 5 },
  { id: "http_requests", label: "http_requests", count: 0 },
  { id: "misc", label: "Other", count: 3 },
];

const createWrapper = (props: Record<string, any> = {}) =>
  mount(PrefixFilterPanel, {
    props: {
      mode: "prefix",
      facets: FACETS,
      selected: new Set<string>(),
      ...props,
    },
    global: {
      plugins: [i18n, store],
    },
  });

/** Facet ids currently rendered in the list, in DOM order. */
const renderedIds = (wrapper: VueWrapper<any>, mode = "prefix") =>
  wrapper
    .findAll(`[data-test^="metrics-explorer-${mode}-facet-"]`)
    .map((el) => (el.attributes("data-test") ?? "").replace(`metrics-explorer-${mode}-facet-`, ""));

describe("PrefixFilterPanel", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("header", () => {
    // The visible title is the tab above the panel; here the mode title
    // survives as the facet group's accessible name.
    it("labels the facet group with the prefix title in prefix mode", () => {
      wrapper = createWrapper({ mode: "prefix" });
      expect(
        wrapper.find('[data-test="metrics-explorer-prefix-facets"]').attributes("aria-label"),
      ).toBe("Filter by prefix");
    });

    it("labels the facet group with the suffix title in suffix mode", () => {
      wrapper = createWrapper({ mode: "suffix" });
      expect(
        wrapper.find('[data-test="metrics-explorer-suffix-facets"]').attributes("aria-label"),
      ).toBe("Filter by suffix");
    });

    // Clear lives in the aside's title row (MetricsExplorer), not in the panel:
    // the panel renders only its search and list.
    it("always shows the 'Clear filters' control — disabled when nothing is selected", () => {
      // No disappearing controls: the button is always present and discoverable;
      // with no selection it is disabled and the count reads "0 selected", so the
      // row never changes size.
      wrapper = createWrapper({ selected: new Set(), hasSelection: false });
      const clear = wrapper.find('[data-test="metrics-explorer-prefix-clear"]');
      expect(clear.exists()).toBe(true);
      expect(clear.attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("0 selected");
    });

    it("enables 'Clear filters' and shows the count when there is a selection", () => {
      // Labelled "Clear filters", NOT bare "Clear", so it is never confused with
      // the search box's own inline ✕ (which clears the search text, not filters).
      wrapper = createWrapper({
        selected: new Set(["node_cpu", "node_memory"]),
        hasSelection: true,
      });
      const clear = wrapper.find('[data-test="metrics-explorer-prefix-clear"]');
      expect(clear.text()).toContain("Clear filters");
      expect(clear.attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).toContain("2 selected");
    });

    it("emits `clear` (distinct from search) when the clear-filters button is clicked", async () => {
      wrapper = createWrapper({
        selected: new Set(["node_cpu"]),
        hasSelection: true,
      });
      await wrapper.find('[data-test="metrics-explorer-prefix-clear"]').trigger("click");
      expect(wrapper.emitted("clear")).toHaveLength(1);
    });
  });

  describe("facet list rendering", () => {
    it("renders a row per non-empty facet with a mode-scoped data-test", () => {
      wrapper = createWrapper();
      // http_requests has count 0: a filter option that could only empty the
      // grid, so it is never offered. There is no switch to reveal it.
      expect(renderedIds(wrapper)).toEqual(["node_cpu", "node_memory", "misc"]);
    });

    it("scopes the data-test to the suffix mode", () => {
      wrapper = createWrapper({
        mode: "suffix",
        facets: [{ id: "total", label: "total", count: 4 }],
      });
      expect(wrapper.find('[data-test="metrics-explorer-suffix-facet-total"]').exists()).toBe(true);
    });

    it("renders the facet label and its count", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("node_cpu");
      expect(wrapper.find('[data-test="metrics-explorer-prefix-count-node_cpu"]').text()).toBe(
        "12",
      );
    });

    it('renders a count of 0 as "0", not as a blank chip', () => {
      // A selected facet is the only zero-count row still shown, and its count
      // has to say 0 — that IS the information (this selection now matches
      // nothing), and a blank chip would read as "still loading".
      wrapper = createWrapper({ selected: new Set(["http_requests"]) });
      expect(wrapper.find('[data-test="metrics-explorer-prefix-count-http_requests"]').text()).toBe(
        "0",
      );
    });
  });

  describe("search", () => {
    it("filters the facet list by substring on the label", async () => {
      wrapper = createWrapper();
      await wrapper.find("input").setValue("cpu");
      expect(renderedIds(wrapper)).toEqual(["node_cpu"]);
    });

    it("is case insensitive", async () => {
      wrapper = createWrapper();
      await wrapper.find("input").setValue("OTHER");
      expect(renderedIds(wrapper)).toEqual(["misc"]);
    });

    it("matches on the label, not the id", async () => {
      wrapper = createWrapper();
      // The `misc` facet's label is "Other" — searching its id must not match.
      await wrapper.find("input").setValue("misc");
      expect(renderedIds(wrapper)).toEqual([]);
    });

    it("shows an empty state when nothing matches", async () => {
      wrapper = createWrapper();
      await wrapper.find("input").setValue("zzzz");
      expect(wrapper.find('[data-test="metrics-explorer-prefix-empty"]').exists()).toBe(true);
    });

    it("restores the full list when the search is cleared", async () => {
      wrapper = createWrapper();
      await wrapper.find("input").setValue("cpu");
      await wrapper.find("input").setValue("");
      expect(renderedIds(wrapper)).toEqual(["node_cpu", "node_memory", "misc"]);
    });
  });

  describe("hide empty", () => {
    it("hides zero-count facets by default", () => {
      wrapper = createWrapper();
      expect(renderedIds(wrapper)).not.toContain("http_requests");
    });

    it("keeps a SELECTED zero-count facet visible so it stays deselectable", () => {
      wrapper = createWrapper({ selected: new Set(["http_requests"]) });
      expect(renderedIds(wrapper)).toContain("http_requests");
    });
  });

  describe("selection", () => {
    it("emits update:selected with the id added when an unchecked row is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="metrics-explorer-prefix-facet-node_cpu"]').trigger("click");

      const emitted = wrapper.emitted("update:selected");
      expect(emitted).toBeTruthy();
      expect([...(emitted![0][0] as Set<string>)]).toEqual(["node_cpu"]);
    });

    it("emits update:selected with the id removed when a checked row is clicked", async () => {
      wrapper = createWrapper({ selected: new Set(["node_cpu", "misc"]) });
      await wrapper.find('[data-test="metrics-explorer-prefix-facet-node_cpu"]').trigger("click");

      const emitted = wrapper.emitted("update:selected");
      expect([...(emitted![0][0] as Set<string>)]).toEqual(["misc"]);
    });

    it("supports multi-select across rows", async () => {
      const selected = new Set(["node_cpu"]);
      wrapper = createWrapper({ selected });
      await wrapper
        .find('[data-test="metrics-explorer-prefix-facet-node_memory"]')
        .trigger("click");

      const emitted = wrapper.emitted("update:selected");
      expect([...(emitted![0][0] as Set<string>)].sort()).toEqual(["node_cpu", "node_memory"]);
    });

    it("emits a NEW Set and never mutates the prop", async () => {
      const selected = new Set<string>(["node_cpu"]);
      wrapper = createWrapper({ selected });
      await wrapper
        .find('[data-test="metrics-explorer-prefix-facet-node_memory"]')
        .trigger("click");

      const next = wrapper.emitted("update:selected")![0][0] as Set<string>;
      expect(next).not.toBe(selected);
      // The prop Set is untouched.
      expect([...selected]).toEqual(["node_cpu"]);
    });

    it("reflects the selected prop as a checked checkbox", () => {
      wrapper = createWrapper({ selected: new Set(["node_cpu"]) });
      // OCheckbox's root is a <label>; the ARIA state lives on the nested button.
      const box = wrapper.find(
        '[data-test="metrics-explorer-prefix-facet-node_cpu"] button[role="checkbox"]',
      );
      expect(box.attributes("aria-checked")).toBe("true");
    });

    it("reflects an unselected facet as an unchecked checkbox", () => {
      wrapper = createWrapper({ selected: new Set() });
      const box = wrapper.find(
        '[data-test="metrics-explorer-prefix-facet-node_cpu"] button[role="checkbox"]',
      );
      expect(box.attributes("aria-checked")).toBe("false");
    });
  });
});
