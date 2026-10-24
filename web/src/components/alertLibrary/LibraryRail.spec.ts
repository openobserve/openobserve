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
import { mount } from "@vue/test-utils";

import LibraryRail from "./LibraryRail.vue";
import type { LibraryCategoryFacet, LibraryFacet } from "./libraryFacets";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

const pack = (id: string, label: string) => ({ pack: id, packLabel: raw(label) });

const categories: LibraryCategoryFacet[] = [
  { id: "kafka", label: raw("Kafka"), count: 12, ready: 12, total: 15, ...pack("mq", "Queues") },
  {
    id: "clickhouse",
    label: raw("Clickhouse"),
    count: 23,
    ready: 23,
    total: 30,
    ...pack("databases", "Databases"),
  },
  // id-vs-label discriminator: "cert-m" is in the id, not in "Cert Manager".
  {
    id: "cert-manager",
    label: raw("Cert Manager"),
    count: 8,
    ready: 8,
    total: 8,
    ...pack("k8s", "Kubernetes"),
  },
  // The dead end.
  {
    id: "retired",
    label: raw("Retired"),
    count: 0,
    ready: 0,
    total: 4,
    ...pack("databases", "Databases"),
  },
];

const severities: LibraryFacet[] = [
  { id: "all", label: raw("All"), count: 86 },
  { id: "critical", label: raw("Critical"), count: 20 },
  { id: "warning", label: raw("Warning"), count: 60 },
  { id: "info", label: raw("Info"), count: 6 },
];

const mountRail = (props: Record<string, unknown> = {}) =>
  mount(LibraryRail, {
    props: {
      categories,
      selectedCategories: [],
      severities,
      severity: "all",
      search: "",
      ...props,
    },
    global: { plugins: [i18n] },
  });

type Rail = ReturnType<typeof mountRail>;

/** Rows are checkboxes; the click target is the box, not the label. */
const toggle = (wrapper: Rail, id: string) =>
  wrapper
    .find(`[data-test="alert-library-rail-category-${id}"]`)
    .find('[role="checkbox"]')
    .trigger("click");

// OInput sets inheritAttrs:false and re-derives child selectors, so the field
// itself is `<data-test>-field`.
const field = (wrapper: Rail) =>
  wrapper.find<HTMLInputElement>('[data-test="alert-library-rail-search-categories-field"]');

/**
 * The page owns the term (so its "Clear filters" can reset it), so typing only
 * EMITS — a real parent feeds the value back down. These tests play that parent.
 */
const type = async (wrapper: Rail, term: string) => {
  await field(wrapper).setValue(term);
  await wrapper.setProps({ search: term });
};

describe("LibraryRail", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists one axis only — categories — with no pack switcher", () => {
    // A pack is a coarse bucket; the category is what people come looking for.
    // Two axes over one catalogue put the useful one behind a tab.
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="alert-library-rail-axis"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Category");
    expect(wrapper.text()).not.toContain("Packs");
  });

  it("lists every category with its alert count", () => {
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="alert-library-rail-category-kafka"]').text()).toContain(
      "Kafka",
    );
    expect(wrapper.find('[data-test="alert-library-rail-count-kafka"]').text()).toBe("12");
  });

  // ── severity ─────────────────────────────────────────────────────────────
  it("puts severity above the category list, outside the scrolling area", () => {
    // Below the list it collided with the rows and scrolled out of reach after
    // a hundred categories. It must sit in the pinned block, not the scroller.
    const wrapper = mountRail();
    const severityGroup = wrapper.find('[data-test="alert-library-rail-severity"]').element;
    const firstRow = wrapper.find('[data-test="alert-library-rail-category-kafka"]').element;
    expect(severityGroup.compareDocumentPosition(firstRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const scroller = wrapper.find(".overflow-y-auto").element;
    expect(scroller.contains(firstRow)).toBe(true);
    expect(scroller.contains(severityGroup)).toBe(false);
  });

  it("emits the severity the user picked", async () => {
    const wrapper = mountRail();
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    expect(wrapper.emitted("update:severity")).toEqual([["critical"]]);
  });

  it("keeps the severity selected when its own chip is re-clicked", async () => {
    // You widen it with the explicit All chip, never by accidentally clearing
    // the one you just chose.
    const wrapper = mountRail({ severity: "critical" });
    await wrapper.find('[data-test="alert-library-rail-severity-critical"]').trigger("click");
    expect(wrapper.emitted("update:severity")).toBeUndefined();
  });

  // ── selection ────────────────────────────────────────────────────────────
  it("adds a category to the selection rather than replacing it", async () => {
    const wrapper = mountRail({ selectedCategories: ["kafka"] });
    await toggle(wrapper, "clickhouse");
    expect(wrapper.emitted("update:selectedCategories")).toEqual([[["kafka", "clickhouse"]]]);
  });

  it("removes a category when its own box is unticked", async () => {
    const wrapper = mountRail({ selectedCategories: ["kafka", "clickhouse"] });
    await toggle(wrapper, "kafka");
    expect(wrapper.emitted("update:selectedCategories")).toEqual([[["clickhouse"]]]);
  });

  it("shows the tick on exactly the selected rows", () => {
    const wrapper = mountRail({ selectedCategories: ["clickhouse"] });
    const checked = (id: string) =>
      wrapper
        .find(`[data-test="alert-library-rail-category-${id}"]`)
        .find('[role="checkbox"]')
        .attributes("aria-checked");
    expect(checked("clickhouse")).toBe("true");
    expect(checked("kafka")).toBe("false");
  });

  // ── search ───────────────────────────────────────────────────────────────
  it("filters the listed rows as you type, case-insensitively", async () => {
    const wrapper = mountRail();
    await type(wrapper, "KAF");
    expect(wrapper.find('[data-test="alert-library-rail-category-kafka"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-category-clickhouse"]').exists()).toBe(
      false,
    );
  });

  it("searches the label people read, not the id", async () => {
    // "cert-manager" is the id; "Cert Manager" is what the row says.
    const wrapper = mountRail();
    await type(wrapper, "cert-m");
    expect(wrapper.find('[data-test="alert-library-rail-category-cert-manager"]').exists()).toBe(
      false,
    );
  });

  it("filters rows without touching the selection", async () => {
    // A search is a view over the list. Typing must never silently deselect
    // the category whose alerts are on screen.
    const wrapper = mountRail({ selectedCategories: ["clickhouse"] });
    await type(wrapper, "kafka");
    expect(wrapper.emitted("update:selectedCategories")).toBeUndefined();
  });

  it("says so when nothing matches, instead of showing a blank rail", async () => {
    const wrapper = mountRail();
    await type(wrapper, "zzzz");
    expect(wrapper.find('[data-test="alert-library-rail-empty-categories"]').exists()).toBe(true);
  });

  it("hides a dead-end row, unless it is the one you have selected", async () => {
    // A zero-count row filters to nothing, so offering it wastes a click — but
    // hiding a SELECTED one would strand the user with no way to untick it.
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(false);

    await wrapper.setProps({ selectedCategories: ["retired"] });
    expect(wrapper.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(true);
  });

  // ── clearing ─────────────────────────────────────────────────────────────
  it("counts the selection and clears it", async () => {
    const wrapper = mountRail({ selectedCategories: ["kafka", "clickhouse"] });
    expect(wrapper.find('[data-test="alert-library-rail-selected-categories"]').text()).toContain(
      "2",
    );

    await wrapper.find('[data-test="alert-library-rail-clear-categories"]').trigger("click");
    expect(wrapper.emitted("update:selectedCategories")).toEqual([[[]]]);
    // Severity is a separate question and is left alone.
    expect(wrapper.emitted("update:severity")).toBeUndefined();
  });

  it("disables clear when there is nothing to clear", () => {
    const wrapper = mountRail();
    expect(
      wrapper.find('[data-test="alert-library-rail-clear-categories"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("carries no availability facet — the rail navigates, the strip filters", () => {
    // Needles read from the catalogue, not typed as literals: a copy change
    // would otherwise leave this passing while testing nothing.
    const ready = i18n.global.t("alert_library.statReady");
    const needsData = i18n.global.t("alert_library.statNeedsData");
    expect(ready).not.toContain("alert_library.");
    expect(needsData).not.toContain("alert_library.");

    const text = mountRail().text();
    expect(text).not.toContain(ready);
    expect(text).not.toContain(needsData);
  });

  it("never hides a row you have ticked, whatever you type", () => {
    // The grid stays filtered to it, so hiding the row leaves a filter whose
    // effect you can see and whose control you cannot reach.
    const wrapper = mountRail({ selectedCategories: ["kafka"], search: "redis" });
    expect(wrapper.find('[data-test="alert-library-rail-category-kafka"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-rail-category-clickhouse"]').exists()).toBe(
      false,
    );
  });

  it("emits the term rather than holding it, so the page can clear it", async () => {
    const wrapper = mountRail();
    await field(wrapper).setValue("kafka");
    expect(wrapper.emitted("update:search")).toEqual([["kafka"]]);
  });

  it("cuts a long category name with a cut-only tooltip instead of an always-on title", () => {
    const label = mountRail().find(
      '[data-test="alert-library-rail-category-kafka"] [data-test="o-truncated-text"]',
    );
    expect(label.text()).toBe("Kafka");
    expect(label.attributes("title")).toBeUndefined();
    expect(label.attributes("data-o-tooltip-trigger")).toBe("overflow");
  });

  // ── pack grouping ────────────────────────────────────────────────────────
  describe("pack grouping", () => {
    const SHOW_ALL = '[data-test="alert-library-rail-show-all"]';
    const heading = (wrapper: Rail, id: string) =>
      wrapper.find(`[data-test="alert-library-rail-pack-heading-${id}"]`);

    it("lists categories under pack headings, the pack with most ready first", () => {
      const wrapper = mountRail();
      const headings = wrapper
        .findAll('[data-test^="alert-library-rail-pack-heading-"]')
        .map((h) => h.attributes("data-test")?.replace("alert-library-rail-pack-heading-", ""));
      expect(headings).toEqual(["databases", "mq", "k8s"]);

      const kafka = wrapper.find('[data-test="alert-library-rail-category-kafka"]').element;
      const mq = heading(wrapper, "mq").element;
      const k8s = heading(wrapper, "k8s").element;
      expect(mq.compareDocumentPosition(kafka)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(k8s.compareDocumentPosition(kafka)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    });

    it("shows ready / total on each pack heading, counting its hidden rows too", () => {
      const wrapper = mountRail();
      expect(heading(wrapper, "databases").text()).toContain("Databases");
      expect(
        heading(wrapper, "databases").find('[data-test="alert-library-rail-pack-count"]').text(),
      ).toBe("23 / 34");
    });

    it("drops a pack heading whose rows are all hidden", async () => {
      const wrapper = mountRail();
      await type(wrapper, "kafka");
      expect(heading(wrapper, "mq").exists()).toBe(true);
      expect(heading(wrapper, "databases").exists()).toBe(false);
    });

    it("shows the empty rows on Show all, and hides them again", async () => {
      const wrapper = mountRail();
      expect(wrapper.find(SHOW_ALL).text()).toBe(
        i18n.global.t("alert_library.showAllCategories", { count: 4 }, 4),
      );

      await wrapper.find(SHOW_ALL).trigger("click");
      expect(wrapper.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(true);
      expect(wrapper.find(SHOW_ALL).text()).toBe(
        i18n.global.t("alert_library.hideEmptyCategories"),
      );

      await wrapper.find(SHOW_ALL).trigger("click");
      expect(wrapper.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(
        false,
      );
    });

    it("remembers Show all for the next visit", async () => {
      await mountRail().find(SHOW_ALL).trigger("click");
      const again = mountRail();
      expect(again.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(true);

      await again.find(SHOW_ALL).trigger("click");
      expect(mountRail().find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(
        false,
      );
    });

    it("still works when storage is unavailable", async () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      });
      const wrapper = mountRail();
      expect(wrapper.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(
        false,
      );
      await wrapper.find(SHOW_ALL).trigger("click");
      expect(wrapper.find('[data-test="alert-library-rail-category-retired"]').exists()).toBe(true);
    });

    it("offers no Show all when no row is empty", () => {
      const wrapper = mountRail({ categories: categories.filter((c) => c.count > 0) });
      expect(wrapper.find(SHOW_ALL).exists()).toBe(false);
    });
  });

  describe("added packs", () => {
    it("marks a pack heading the org already has alerts from", () => {
      const wrapper = mountRail({ addedPacks: ["k8s"] });
      const k8s = wrapper.find('[data-test="alert-library-rail-pack-heading-k8s"]');
      expect(k8s.find('[data-test="alert-library-rail-pack-added"]').text()).toBe("Added");
      const mq = wrapper.find('[data-test="alert-library-rail-pack-heading-mq"]');
      expect(mq.find('[data-test="alert-library-rail-pack-added"]').exists()).toBe(false);
    });
  });
});
