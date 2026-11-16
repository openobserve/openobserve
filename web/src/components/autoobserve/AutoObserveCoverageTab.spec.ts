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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { gt } from "@/types/i18n";
import type { AutoObserveCoverage } from "@/services/autoobserve";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import AutoObserveCoverageTab from "./AutoObserveCoverageTab.vue";
import { toCoverageSource, type CoverageSource, type SourceState } from "./live/liveAdapter";

const routeQuery: Record<string, string> = {};
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ query: routeQuery }),
}));

const HexMapStub = { name: "CoverageHexMap", props: ["items"], template: "<div />" };

const cell = (state: string) => ({ state, evidence: [], counts: {} });
const row = (name: string, errors: string, absence = "none") => ({
  service_name: name,
  cluster: "prod-eu",
  namespace: "billing",
  streams: [],
  cells: { errors: cell(errors), latency: cell("none"), absence: cell(absence) },
});

const coverage = (rows: unknown[], passAt: number | null = Date.now() * 1000) =>
  ({
    view: "strict",
    pass_at: passAt,
    refreshed_at: null,
    quality: null,
    classes: [],
    rows,
  }) as unknown as AutoObserveCoverage;

const READY: SourceState = { status: "ready", retry: () => undefined };

const live = (data?: AutoObserveCoverage, state: Partial<SourceState> = {}): CoverageSource =>
  toCoverageSource(gt, data, { ...READY, ...state }, "en-US");

// Every check covered; row() covers only the checks it names.
const watched = (name: string) => ({
  ...row(name, "covered", "covered"),
  cells: { errors: cell("covered"), latency: cell("covered"), absence: cell("covered") },
});

const FEW = coverage([watched("api"), row("web", "none"), watched("db")]);

const mountTab = (source: CoverageSource, skeleton = false) =>
  mount(AutoObserveCoverageTab, {
    props: { source, skeleton, explain: true },
    global: {
      plugins: [i18n, store],
      stubs: { CoverageHexMap: HexMapStub, CoverageServiceDrawer: true },
    },
  });

const mountUnderHeaderBar = (source: CoverageSource, skeleton = false) =>
  mount(AutoObserveCoverageTab, {
    props: { source, skeleton, explain: true, headerBar: true },
    global: {
      plugins: [i18n, store],
      stubs: { CoverageHexMap: HexMapStub, CoverageServiceDrawer: true },
    },
  });

describe("AutoObserveCoverageTab under the page's coverage bar", () => {
  it("draws no second watched-and-gap bar, loaded or loading", () => {
    const loaded = mountUnderHeaderBar(live(FEW));
    expect(loaded.find('[data-test="autoobserve-coverage-summary"]').exists()).toBe(true);
    expect(loaded.find('[data-test="autoobserve-coverage-split"]').exists()).toBe(false);
    const loading = mountUnderHeaderBar(live(FEW), true);
    expect(loading.find('[data-test="autoobserve-coverage-skeleton-split"]').exists()).toBe(false);
  });

  it("keeps the bar where the page has none", () => {
    expect(has(mountTab(live(FEW)), "autoobserve-coverage-split")).toBe(true);
    expect(has(mountTab(live(FEW), true), "autoobserve-coverage-skeleton-split")).toBe(true);
  });
});

describe("AutoObserveCoverageTab map beside an open service drawer", () => {
  it("makes room for the drawer, so it doesn't cover the hexes", async () => {
    const wrapper = mountTab(live(FEW));
    const scroller = () => wrapper.find('[data-test="autoobserve-coverage-map-scroller"]');
    expect(scroller().classes()).not.toContain("xl:pe-160");
    wrapper.findComponent(HexMapStub).vm.$emit("select", "api");
    await flushPromises();
    expect(scroller().classes()).toContain("xl:pe-160");
  });
});

const has = (wrapper: ReturnType<typeof mountTab>, test: string) =>
  wrapper.find(`[data-test="${test}"]`).exists();

describe("AutoObserveCoverageTab in live mode", () => {
  beforeEach(() => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  });

  describe("which notice it shows", () => {
    it("shows the skeleton shaped like the map, the view that opens", () => {
      const wrapper = mountTab(live(undefined, { status: "loading" }), true);
      const skeleton = wrapper.find('[data-test="autoobserve-coverage-skeleton"]');
      expect(skeleton.attributes("data-skeleton-view")).toBe("map");
      expect(skeleton.findComponent(OTable).exists()).toBe(false);
    });

    it("shows a table skeleton when the table view opens", () => {
      routeQuery.cov = "table";
      const wrapper = mountTab(live(undefined, { status: "loading" }), true);
      expect(
        wrapper
          .find('[data-test="autoobserve-coverage-skeleton"]')
          .attributes("data-skeleton-view"),
      ).toBe("table");
      expect(wrapper.findComponent(OTable).exists()).toBe(true);
    });

    it("names each failure with its own notice", () => {
      for (const failure of ["denied", "off", "unavailable", "failed"] as const) {
        const wrapper = mountTab(live(undefined, { status: "error", failure }));
        expect(has(wrapper, `autoobserve-coverage-${failure}`)).toBe(true);
        expect(has(wrapper, "autoobserve-coverage-summary")).toBe(false);
      }
    });

    it("tells 'no check yet' from 'a check found no services'", () => {
      expect(has(mountTab(live(coverage([], null))), "autoobserve-coverage-no-pass")).toBe(true);
      const passAt = (Date.now() - 1439 * 60_000) * 1000;
      const found = mountTab(live(coverage([], passAt)));
      expect(found.find('[data-test="autoobserve-coverage-no-services"]').text()).toContain(
        "My last check, 23 hours ago, found no services.",
      );
    });

    it("shows a failed refresh over zero services without moving the notice", () => {
      const wrapper = mountTab(
        live(coverage([]), { failure: "failed", stale: { failedAt: 2_000, dataAt: 1_000 } }),
      );
      const line = wrapper.find('[data-test="autoobserve-coverage-refresh-failed"]');
      expect(line.exists()).toBe(true);
      expect(line.element.parentElement?.className).toContain("absolute");
      expect(has(wrapper, "autoobserve-coverage-no-services")).toBe(true);
    });
  });

  describe("the refresh-failed line with rows kept", () => {
    it("sits in the summary row in place of the detector count", () => {
      const wrapper = mountTab(
        live(FEW, { failure: "failed", stale: { failedAt: 2_000, dataAt: 1_000 } }),
      );
      const summary = wrapper.find('[data-test="autoobserve-coverage-summary"]');
      expect(summary.find('[data-test="autoobserve-coverage-refresh-failed"]').exists()).toBe(true);
      expect(summary.find('[data-test="autoobserve-coverage-detectors"]').exists()).toBe(false);
      expect(
        summary.element.previousElementSibling?.querySelector(
          '[data-test="autoobserve-coverage-refresh-failed"]',
        ),
      ).toBeFalsy();
    });

    it("shows the detector count when nothing failed", () => {
      const summary = mountTab(live(FEW)).find('[data-test="autoobserve-coverage-summary"]');
      expect(summary.find('[data-test="autoobserve-coverage-detectors"]').exists()).toBe(true);
    });
  });

  describe("the live state words", () => {
    it("gives the map legend Coverage gap and Watched, and no empty state", () => {
      const wrapper = mountTab(live(FEW));
      const chips = wrapper.findAll('[data-test^="autoobserve-coverage-legend-"]');
      const text = chips.map((c) => c.text()).join(" ");
      expect(has(wrapper, "autoobserve-coverage-legend-gap")).toBe(true);
      expect(has(wrapper, "autoobserve-coverage-legend-watched")).toBe(true);
      expect(has(wrapper, "autoobserve-coverage-legend-learning")).toBe(false);
      expect(has(wrapper, "autoobserve-coverage-legend-partial")).toBe(false);
      expect(wrapper.find('[data-test="autoobserve-coverage-legend-gap"]').text()).toContain(
        "Coverage gap",
      );
      expect(text).not.toMatch(/learning|partly/i);
    });

    it("a service with one or two of three checks reads Partly watched everywhere", async () => {
      routeQuery.cov = "table";
      const wrapper = mountTab(
        live(coverage([watched("api"), row("cart", "covered"), row("web", "none")])),
      );
      expect(wrapper.find('[data-test="autoobserve-coverage-state-cart"]').text()).toBe(
        "Partly watched",
      );
      const tag = wrapper
        .findAllComponents({ name: "OTag" })
        .find((c) => String(c.props("label")) === "Partly watched");
      expect(tag?.props("variant")).toBe("warning-outline");
      const filters = wrapper.findAll('[data-test^="autoobserve-coverage-filter-"]');
      expect(filters.map((f) => f.attributes("data-test"))).toContain(
        "autoobserve-coverage-filter-partial",
      );
      wrapper
        .findComponent('[data-test="autoobserve-coverage-filter"]')
        .vm.$emit("update:modelValue", "partial");
      await flushPromises();
      const shown = (wrapper.findComponent(OTable).props("data") as { service: string }[]).map(
        (r) => r.service,
      );
      expect(shown).toEqual(["cart"]);
      const rail = wrapper.findComponent(OTable).props("rowRailTone") as (r: unknown) => string;
      expect(rail(wrapper.findComponent(OTable).props("data")[0])).toBeNull();
    });

    it("the map legend counts Partly watched only while a service is partly watched", () => {
      const wrapper = mountTab(live(coverage([watched("api"), row("cart", "covered")])));
      expect(wrapper.find('[data-test="autoobserve-coverage-legend-partial"]').text()).toContain(
        "Partly watched",
      );
      const items = wrapper.findComponent(HexMapStub).props("items") as {
        key: string;
        cls: string;
      }[];
      expect(items.find((i) => i.key === "cart")?.cls).toBe("partial");
    });

    it("opens on the filter a link names, by its own name or the home's", () => {
      routeQuery.cov = "table";
      routeQuery.filter = "attention";
      const gaps = mountTab(live(FEW));
      const shown = (w: ReturnType<typeof mountTab>) =>
        (w.findComponent(OTable).props("data") as { service: string }[]).map((r) => r.service);
      expect(shown(gaps)).toEqual(["web"]);
      routeQuery.filter = "watched";
      expect(shown(mountTab(live(FEW)))).toEqual(["api", "db"]);
      routeQuery.filter = "learning";
      expect(shown(mountTab(live(FEW)))).toEqual(["web", "api", "db"]);
    });

    it("keeps the filter a link names while the first read is still loading", async () => {
      routeQuery.cov = "table";
      routeQuery.filter = "learning";
      const w = mountTab(live(undefined, { status: "loading" }), true);
      const young = {
        ...row("young", "none"),
        streams: [
          { type: "logs", name: "young_logs", learning_until: (Date.now() + 86_400_000) * 1000 },
        ],
      };
      await w.setProps({ source: live(coverage([young, watched("ready")])), skeleton: false });
      const shown = w.findComponent(OTable).props("data") as { service: string }[];
      expect(shown.map((r) => r.service)).toEqual(["young"]);
    });

    it("counts the legend over the services the search matches", async () => {
      routeQuery.cov = "map";
      const wrapper = mountTab(
        live(coverage([row("api", "covered"), row("web", "none"), row("db", "none")])),
      );
      await wrapper.find('[data-test="autoobserve-coverage-search"] input').setValue("web");
      expect(wrapper.find('[data-test="autoobserve-coverage-legend-gap"]').text()).toContain("1");
      expect(wrapper.find('[data-test="autoobserve-coverage-legend-watched"]').text()).toContain(
        "0",
      );
    });

    it("buckets detector counts for three checks: 3+, 2, 1 or none", async () => {
      routeQuery.cov = "map";
      const wrapper = mountTab(live(FEW));
      wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "detectors");
      await flushPromises();
      const labels = wrapper
        .findAll('[data-test^="autoobserve-coverage-legend-"]')
        .filter((c) => !c.attributes("data-test")!.endsWith("chips"))
        .map((c) => c.findAll("span")[1].text());
      expect(labels).toEqual(["3 or more", "2", "1", "None"]);
    });

    it("offers no learning fill", () => {
      const options = mountTab(live(FEW)).findComponent(OSelect).props("options") as {
        value: string;
      }[];
      expect(options.map((o) => o.value)).toEqual(["state", "detectors", "scanned"]);
    });

    it("filters the table by All, Watched, Partly watched and Coverage gap while nothing learns", () => {
      routeQuery.cov = "table";
      const wrapper = mountTab(live(FEW));
      const filters = wrapper.findAll('[data-test^="autoobserve-coverage-filter-"]');
      expect(filters.map((f) => f.attributes("data-test"))).toEqual([
        "autoobserve-coverage-filter-all",
        "autoobserve-coverage-filter-watched",
        "autoobserve-coverage-filter-partial",
        "autoobserve-coverage-filter-gaps",
      ]);
      expect(filters[3].text()).toContain("Coverage gap");
      const key = wrapper.find('[data-test="autoobserve-coverage-legend"]').text();
      expect(key).not.toMatch(/learning/i);
    });

    it("names a gap hex by its state word, not the reason sentence", () => {
      const items = mountTab(live(FEW)).findComponent(HexMapStub).props("items") as {
        key: string;
        state: string;
        name: string;
      }[];
      const web = items.find((i) => i.key === "web");
      expect(web?.state).toBe("Coverage gap");
      expect(web?.name).not.toContain("No scoped monitor");
    });
  });

  describe("the live table", () => {
    const MIXED = coverage([
      watched("api"),
      row("web", "none"),
      row("db", "silent"),
      row("cart", "none", "covered"),
    ]);
    const mountTable = (data = MIXED) => {
      routeQuery.cov = "table";
      return mountTab(live(data));
    };
    const text = (wrapper: ReturnType<typeof mountTab>, test: string) =>
      wrapper.find(`[data-test="${test}"]`).text();

    it("has the columns Service, Where, Errors, Latency, Absence, State, Last checked", () => {
      const headers = mountTable()
        .findComponent(OTable)
        .props("columns")
        .map((c: { header: string }) => c.header);
      expect(headers).toEqual([
        "Service",
        "Where",
        "Errors",
        "Latency",
        "Stops sending",
        "State",
        "Last checked",
      ]);
    });

    it("marks a gap cell with the Gap chip and keeps each cell's state in its label", () => {
      const wrapper = mountTable();
      const cell = (id: string) => wrapper.find(`[data-test="autoobserve-coverage-cell-${id}"]`);
      expect(cell("web-errors").findComponent({ name: "OTag" }).exists()).toBe(true);
      expect(cell("api-errors").findComponent({ name: "OTag" }).exists()).toBe(false);
      expect(cell("web-errors").attributes("aria-label")).toMatch(/gap/i);
      expect(text(wrapper, "autoobserve-coverage-matrix")).not.toMatch(
        /Requests|Saturation|Log patterns|Dependencies/,
      );
    });

    it("tags each service by its three cells: all Watched, some Partly watched, none a gap", () => {
      const wrapper = mountTable();
      expect(text(wrapper, "autoobserve-coverage-state-api")).toBe("Watched");
      expect(text(wrapper, "autoobserve-coverage-state-cart")).toBe("Partly watched");
      expect(text(wrapper, "autoobserve-coverage-state-web")).toBe("Coverage gap");
      expect(text(wrapper, "autoobserve-coverage-state-db")).toBe("Coverage gap");
    });

    it("keys the check cells in the footer", () => {
      const key = text(mountTable(), "autoobserve-coverage-legend");
      expect(key).toContain("Watched");
      expect(key).toContain("Coverage gap");
      expect(key).not.toMatch(
        /GAP|Anomaly|Threshold|Not applicable|Covered|Not watched|Falls short/,
      );
    });

    it("searches the Where column it shows, not the stream it hides", async () => {
      const us = { ...row("pay", "none"), cluster: "prod-us" };
      const hidden = { ...row("ship", "none"), streams: [{ name: "ship-logs", type: "logs" }] };
      const wrapper = mountTable(coverage([row("api", "covered"), us, hidden]));
      const input = wrapper.find('[data-test="autoobserve-coverage-search"] input');
      expect(input.attributes("placeholder")).toBe("Search service, cluster or namespace");
      const shown = () =>
        (wrapper.findComponent(OTable).props("data") as { service: string }[]).map(
          (r) => r.service,
        );
      await input.setValue("prod-us");
      expect(shown()).toEqual(["pay"]);
      await input.setValue("ship-logs");
      expect(shown()).toEqual([]);
    });

    it("says the filter hides the matches, not that nothing matches", async () => {
      const wrapper = mountTable(coverage([row("api", "none"), row("web", "none")]));
      await wrapper.find('[data-test="autoobserve-coverage-search"] input').setValue("prod-eu");
      const watched = wrapper.findComponent('[data-test="autoobserve-coverage-filter"]');
      watched.vm.$emit("update:modelValue", "watched");
      await flushPromises();
      expect(has(wrapper, "autoobserve-coverage-no-match")).toBe(false);
      const hidden = wrapper.find('[data-test="autoobserve-coverage-filter-hides"]');
      expect(hidden.text()).toContain("2 services match “prod-eu”, but none is Watched");
    });

    it("names what the live search matches when nothing does", async () => {
      const wrapper = mountTable(coverage([row("api", "none")]));
      await wrapper.find('[data-test="autoobserve-coverage-search"] input').setValue("zzz");
      expect(text(wrapper, "autoobserve-coverage-no-match")).toContain(
        "No service, cluster or namespace matches “zzz”",
      );
    });

    it("rails a Coverage gap row in the Coverage gap chip's amber, not the warning yellow", () => {
      const tone = mountTable().findComponent(OTable).props("rowRailTone") as (r: {
        service: string;
      }) => string | null;
      const rows = mountTable().findComponent(OTable).props("data") as { service: string }[];
      const byName = (name: string) => tone(rows.find((r) => r.service === name)!);
      expect(byName("web")).toBe("amber");
      expect(byName("api")).toBeNull();
    });

    it("sorts by every column", () => {
      const columns = mountTable().findComponent(OTable).props("columns") as {
        id: string;
        sortable?: boolean;
      }[];
      expect(columns.every((c) => c.sortable)).toBe(true);
    });
  });

  it("announces coverage loaded once a load lands", async () => {
    const wrapper = mountTab(live(undefined, { status: "loading" }), true);
    const announce = () => wrapper.find('[data-test="autoobserve-coverage-announce"]');
    expect(announce().text()).toBe("Loading coverage");
    await wrapper.setProps({ source: live(FEW), skeleton: false });
    expect(announce().text()).toBe("Coverage loaded");
  });

  it("opens the drawer on the clicked check, Absence included", async () => {
    routeQuery.cov = "table";
    const wrapper = mountTab(live(coverage([row("api", "covered"), row("web", "none")])));
    const drawer = () => wrapper.findComponent({ name: "CoverageServiceDrawer" });
    const absence = '[data-test="autoobserve-coverage-cell-web-absence"]';
    await wrapper.find('[data-test="autoobserve-coverage-cell-api-errors"]').trigger("click");
    expect(drawer().props("expanded")).toBe("errors");
    await wrapper.find(absence).trigger("click");
    expect(drawer().props("row").service).toBe("web");
    expect(drawer().props("expanded")).toBe("absence");
    expect(wrapper.find(absence).attributes("aria-pressed")).toBe("true");
  });
});
