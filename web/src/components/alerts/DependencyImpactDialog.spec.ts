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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import {
  useDependencyGraph as realUseDependencyGraph,
  type DepGraph,
} from "@/composables/alerts/useDependencyGraph";

const { buildGraph } = realUseDependencyGraph();

// slack: used by 3 alerts (one paused), uses tpl-http.
const graph: DepGraph = buildGraph(
  [
    { alert_id: "a1", name: "cpu", destinations: ["slack"], enabled: true },
    { alert_id: "a2", name: "mem", destinations: ["slack"], enabled: false },
    { alert_id: "a3", name: "disk", destinations: ["slack"], enabled: true },
  ],
  [{ name: "slack", type: "http", template: "tpl-http" }],
  [{ name: "tpl-http", type: "http" }],
);

const loadGraph = vi.fn();
const deleteAlert = vi.fn(() => Promise.resolve({ data: {} }));
vi.mock("@/services/alerts", () => ({
  default: { delete_by_alert_id: (...args: unknown[]) => deleteAlert(...args) },
}));
// Replace only the composable's fetch; keep the real graph-building helpers
// (buildFocusChain / focusSummary / kind helpers) so behaviour stays honest.
vi.mock("@/composables/alerts/useDependencyGraph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/alerts/useDependencyGraph")>();
  return {
    ...actual,
    default: () => ({
      graph: ref(graph),
      loading: ref(false),
      error: ref<string | null>(null),
      loadGraph,
      buildGraph: actual.useDependencyGraph().buildGraph,
    }),
  };
});

import DependencyImpactDialog from "./DependencyImpactDialog.vue";

const rowNames = () =>
  [...document.querySelectorAll('[data-test^="dependency-impact-row-"]')].map((el) =>
    el.getAttribute("data-test"),
  );

let wrapper: ReturnType<typeof mount> | null = null;
const mountDialog = (focus: any) => {
  wrapper = mount(DependencyImpactDialog, {
    props: { open: true, focus },
    attachTo: document.body,
    global: { provide: { store }, plugins: [i18n, router] },
  });
  return wrapper;
};

describe("DependencyImpactDialog", () => {
  beforeEach(() => {
    loadGraph.mockClear();
    deleteAlert.mockClear();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("loads the graph when opened", async () => {
    mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();
    expect(loadGraph).toHaveBeenCalled();
  });

  it("destination focus: only the alerts lane (no self or destination lane)", async () => {
    mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();
    expect(document.querySelector('[data-test="dependency-impact-lane-alert"]')).toBeTruthy();
    // Neither the removed self/focus lane nor a destinations lane is shown.
    expect(document.querySelector('[data-test="dependency-impact-lane-destination"]')).toBeFalsy();
    expect(document.querySelector('[data-test="dependency-impact-lane-template"]')).toBeFalsy();
    expect(rowNames()).toEqual(
      expect.arrayContaining([
        "dependency-impact-row-cpu",
        "dependency-impact-row-mem",
        "dependency-impact-row-disk",
      ]),
    );
  });

  it("template focus: destinations → alerts grouped by destination (no template lane)", async () => {
    mountDialog({ kind: "template", name: "tpl-http" });
    await flushPromises();
    // The self/template lane is gone; the flow starts at Destinations.
    expect(document.querySelector('[data-test="dependency-impact-lane-template"]')).toBeFalsy();
    expect(document.querySelector('[data-test="dependency-impact-lane-destination"]')).toBeTruthy();
    // The alerts lane carries a box grouped by the destination.
    expect(document.querySelector('[data-test="dependency-impact-group-slack"]')).toBeTruthy();
  });

  it("hovering a destination highlights its alert group; leaving clears it", async () => {
    mountDialog({ kind: "template", name: "tpl-http" });
    await flushPromises();
    const group = document.querySelector(
      '[data-test="dependency-impact-group-slack"]',
    ) as HTMLElement;
    const card = document.querySelector(
      '[data-test="dependency-impact-lane-destination"] [data-test="dependency-impact-card-slack"]',
    ) as HTMLElement;
    expect(group.className).not.toContain("bg-surface-accent");
    card.dispatchEvent(new MouseEvent("mouseenter"));
    await flushPromises();
    expect(group.className).toContain("bg-surface-accent");
    // Nothing stays highlighted once the cursor leaves.
    card.dispatchEvent(new MouseEvent("mouseleave"));
    await flushPromises();
    expect(group.className).not.toContain("bg-surface-accent");
  });

  it("hovering an alert highlights its destination card, not the box", async () => {
    mountDialog({ kind: "template", name: "tpl-http" });
    await flushPromises();
    const card = document.querySelector(
      '[data-test="dependency-impact-lane-destination"] [data-test="dependency-impact-card-slack"]',
    ) as HTMLElement;
    const group = document.querySelector(
      '[data-test="dependency-impact-group-slack"]',
    ) as HTMLElement;
    const alertRow = document.querySelector(
      '[data-test="dependency-impact-group-slack"] [data-test="dependency-impact-row-cpu"]',
    ) as HTMLElement;
    alertRow.dispatchEvent(new MouseEvent("mouseenter"));
    await flushPromises();
    // The alert's destination card lights up…
    expect(card.className).toContain("bg-surface-accent");
    // …but the box it sits in is NOT filled (that's reserved for hovering the dest).
    expect(group.className).not.toContain("bg-surface-accent");
  });

  it("clicking a destination scrolls its alert group into view", async () => {
    mountDialog({ kind: "template", name: "tpl-http" });
    await flushPromises();
    const group = document.querySelector(
      '[data-test="dependency-impact-group-slack"]',
    ) as HTMLElement;
    // jsdom doesn't implement scrollIntoView, so provide it as a mock.
    const scrollSpy = vi.fn();
    group.scrollIntoView = scrollSpy;
    (
      document.querySelector(
        '[data-test="dependency-impact-lane-destination"] [data-test="dependency-impact-card-slack"]',
      ) as HTMLElement
    ).click();
    await flushPromises();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("search keeps the Destinations and Alerts lanes in sync", async () => {
    // slack has alert 'cpu'; a search matching that alert must keep slack visible
    // in BOTH the destinations lane and as an alerts box.
    mountDialog({ kind: "template", name: "tpl-http" });
    await flushPromises();
    const input = document.querySelector(
      '[data-test="dependency-impact-search"] input',
    ) as HTMLInputElement;
    input.value = "cpu";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(
      document.querySelector(
        '[data-test="dependency-impact-lane-destination"] [data-test="dependency-impact-card-slack"]',
      ),
    ).toBeTruthy();
    expect(document.querySelector('[data-test="dependency-impact-group-slack"]')).toBeTruthy();
  });

  it("filters rows by the search box", async () => {
    mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();
    const input = document.querySelector(
      '[data-test="dependency-impact-search"] input',
    ) as HTMLInputElement;
    input.value = "cpu";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(rowNames()).toContain("dependency-impact-row-cpu");
    expect(rowNames()).not.toContain("dependency-impact-row-mem");
  });

  it("opens a redirect in a new browser tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();
    (document.querySelector('[data-test="dependency-impact-open-cpu"]') as HTMLElement).click();
    expect(openSpy).toHaveBeenCalledWith(expect.any(String), "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("emits update:open=false when Close is clicked", async () => {
    const w = mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();
    (document.querySelector('[data-test="dependency-impact-close"]') as HTMLElement).click();
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  const confirmDelete = async (name: string) => {
    (
      document.querySelector(`[data-test="dependency-impact-delete-${name}"]`) as HTMLElement
    ).click();
    await flushPromises();
    (
      document.querySelector(
        '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
      ) as HTMLElement
    ).click();
    await flushPromises();
  };

  it("closes when the row deleted IS the entity the dialog is focused on", async () => {
    const w = mountDialog({ kind: "alert", alertId: "a1" });
    await flushPromises();

    await confirmDelete("cpu");

    // The focus id has to be read before the prune: afterwards the focused entity
    // is out of the graph, so re-deriving it finds nothing to match on.
    expect(w.emitted("update:open")).toEqual([[false]]);
  });

  it("holds each in-flight row disabled when a second delete starts", async () => {
    let finishFirst!: (value: unknown) => void;
    deleteAlert.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)) as Promise<{ data: object }>,
    );
    mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();

    await confirmDelete("cpu");
    await confirmDelete("mem");

    // mem's delete has landed; cpu's has not, so cpu must not offer its button
    // again — a second DELETE would 404 and error-toast a delete that worked.
    expect(rowNames()).not.toContain("dependency-impact-row-mem");
    expect(document.querySelector('[data-test="dependency-impact-delete-cpu"]')).toBeFalsy();

    finishFirst({ data: {} });
    await flushPromises();
    expect(rowNames()).not.toContain("dependency-impact-row-cpu");
  });

  it("deleting an alert prunes it in place — no refetch, no reload of the lanes", async () => {
    const w = mountDialog({ kind: "destination", name: "slack" });
    await flushPromises();
    loadGraph.mockClear();

    (document.querySelector('[data-test="dependency-impact-delete-cpu"]') as HTMLElement).click();
    await flushPromises();
    (
      document.querySelector(
        '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
      ) as HTMLElement
    ).click();
    await flushPromises();

    expect(deleteAlert).toHaveBeenCalled();
    // The row leaves the lane without the graph being fetched again.
    expect(loadGraph).not.toHaveBeenCalled();
    expect(rowNames()).not.toContain("dependency-impact-row-cpu");
    expect(rowNames()).toContain("dependency-impact-row-mem");
    // The host is told what went, so a list only reloads when its own kind did.
    expect(w.emitted("deleted")).toEqual([["alert"]]);
    expect(w.emitted("update:open")).toBeUndefined();
  });
});
